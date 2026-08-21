/**
 * The local Tesseract OCR pass, bounded so it can fail but cannot hang or escape.
 *
 * Discovery Campaign 03 measured three separate ways the previous call went wrong, and all three
 * are answered here.
 *
 * **It reached the internet.** `createWorker("eng")` with no path configuration resolves its cache
 * against the process working directory and, finding nothing, requests the model from a public CDN.
 * Here the language path is pinned to AION's own model directory, and `gzip: false` with it — the
 * library appends `.gz` at the default, so a correctly provisioned plain `eng.traineddata` would
 * otherwise fail closed for the wrong reason and read as "model missing". Measured, not assumed.
 *
 * **It hung.** `createWorker` ends with `.catch(() => {})` over the load chain and returns a promise
 * that is resolved only on success; `workerResReject` runs solely for `action === 'load'`. So a
 * `loadLanguage` failure settles nothing, ever. Two things close that: `errorHandler`, which turns
 * the failure into a signal we can race against, and a deadline as the backstop for everything
 * `errorHandler` does not cover.
 *
 * **Its errors escaped.** Without `errorHandler`, tesseract.js rethrows the worker's rejection
 * inside the worker's own `message` listener — outside any promise the caller is awaiting, so the
 * surrounding `try`/`catch` never sees it and it surfaces as an uncaught exception. AION's own
 * comment about undecodable images describes the same escape. Supplying `errorHandler` is what
 * stops it.
 *
 * A worker that arrives after we have given up is still terminated. Cleanup is idempotent because
 * the abandonment path and the normal path can both reach it.
 */

import {
  inspectLocalOcrModel,
  resolveOcrModelDirectory,
  OCR_MODEL_LANGUAGE_V1,
  type ExpectedOcrModelV1,
  type LocalOcrModelStatusV1,
} from "./ocr-model.js";

export type LocalOcrEngineCodeV1 =
  | "OCR_SUCCESS"
  | "OCR_COMPLETED_NO_TEXT"
  | "OCR_MODEL_UNAVAILABLE"
  | "OCR_MODEL_INVALID"
  | "OCR_TIMEOUT"
  | "OCR_ENGINE_ERROR";

export interface LocalOcrEngineResultV1 {
  code: LocalOcrEngineCodeV1;
  /** Recognised text; empty for every code other than `OCR_SUCCESS`. */
  text: string;
  /** Owner-facing, and true to what happened. A missing model never reads as "no text found". */
  message: string;
  modelPath: string;
  modelSha256: string | null;
}

/** The surface this module uses. Narrower than the library's worker, so a test can stand in for it. */
export interface TesseractWorkerLikeV1 {
  recognize: (image: Buffer) => Promise<{ data?: { text?: string } }>;
  terminate: () => Promise<unknown>;
}

export interface TesseractWorkerOptionsV1 {
  langPath: string;
  cachePath: string;
  gzip: boolean;
  errorHandler: (error: unknown) => void;
}

export type CreateTesseractWorkerV1 = (
  language: string,
  options: TesseractWorkerOptionsV1,
) => Promise<TesseractWorkerLikeV1>;

/**
 * Long enough that a slow first initialisation on a cold machine is not cut off, short enough that
 * an Owner holding a phone at a car is not left waiting on a request that will never answer.
 */
export const LOCAL_OCR_TIMEOUT_MS_V1 = 60_000;

export interface RunLocalTesseractOcrOptionsV1 {
  modelDirectory?: string;
  expectedModel?: ExpectedOcrModelV1;
  timeoutMs?: number;
  /**
   * Test seam. Unlike an injectable transport, this default cannot reach the network: it loads the
   * local library and points it at a local directory. The lesson from Findings 2 + 3 was that a
   * default which reaches the public internet is indistinguishable from no boundary — this default
   * reaches a file.
   */
  createWorker?: CreateTesseractWorkerV1;
}

class LocalOcrEngineFailure extends Error {
  constructor(readonly code: LocalOcrEngineCodeV1, message: string) {
    super(message);
    this.name = "LocalOcrEngineFailure";
  }
}

const defaultCreateWorker: CreateTesseractWorkerV1 = async (language, options) => {
  const tessPath = "tesseract.js";
  const tess = (await import(tessPath)) as {
    createWorker?: (
      langs: string,
      oem: undefined,
      options: TesseractWorkerOptionsV1,
    ) => Promise<TesseractWorkerLikeV1>;
  };
  if (typeof tess.createWorker !== "function") {
    throw new LocalOcrEngineFailure("OCR_ENGINE_ERROR", "The local OCR engine is not installed.");
  }
  // `undefined` for the engine mode keeps the library's own default, which is what AION used
  // before this repair. Only the paths change.
  return tess.createWorker(language, undefined, options);
};

function failureFrom(model: LocalOcrModelStatusV1): LocalOcrEngineResultV1 {
  return {
    code: model.code === "OCR_MODEL_INVALID" ? "OCR_MODEL_INVALID" : "OCR_MODEL_UNAVAILABLE",
    text: "",
    message: model.message,
    modelPath: model.path,
    modelSha256: model.sha256,
  };
}

/**
 * Run one local OCR pass.
 *
 * Never throws: every outcome, including a hang, is a code the caller can act on. The model is
 * verified before a worker exists, so an absent or wrong model cannot become a network request.
 */
export async function runLocalTesseractOcr(
  image: Buffer,
  options: RunLocalTesseractOcrOptionsV1 = {},
): Promise<LocalOcrEngineResultV1> {
  const directory = options.modelDirectory ?? resolveOcrModelDirectory();
  const model = options.expectedModel
    ? inspectLocalOcrModel(directory, options.expectedModel)
    : inspectLocalOcrModel(directory);

  if (model.code !== "READY") return failureFrom(model);

  const timeoutMs = options.timeoutMs ?? LOCAL_OCR_TIMEOUT_MS_V1;
  const createWorker = options.createWorker ?? defaultCreateWorker;

  let abandoned = false;
  let worker: TesseractWorkerLikeV1 | null = null;
  let terminated = false;

  /** Idempotent: the deadline path and the normal path both arrive here. */
  const cleanup = async (target: TesseractWorkerLikeV1 | null) => {
    if (!target || terminated) return;
    terminated = true;
    try {
      await target.terminate();
    } catch {
      /* a worker that is already gone is the state we wanted */
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new LocalOcrEngineFailure("OCR_TIMEOUT", `The local OCR engine did not respond within ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });

  // `errorHandler` fires where the library would otherwise rethrow into its own message listener.
  // Turning it into a rejection is what makes an engine failure deterministic rather than eternal.
  let signalEngineFailure: (reason: unknown) => void = () => {};
  const engineFailure = new Promise<never>((_, reject) => {
    signalEngineFailure = (reason) => {
      const detail = reason instanceof Error ? reason.message : String(reason ?? "unknown error");
      reject(new LocalOcrEngineFailure("OCR_ENGINE_ERROR", `The local OCR engine failed: ${detail}`));
    };
  });
  engineFailure.catch(() => {}); // never an unhandled rejection when the pass succeeds

  try {
    const pending = createWorker(OCR_MODEL_LANGUAGE_V1, {
      langPath: directory,
      cachePath: directory,
      // The library appends `.gz` unless this is false; the provisioned model is a plain file.
      gzip: false,
      errorHandler: signalEngineFailure,
    });

    // A worker that arrives after the deadline still has to be terminated, or the thread outlives
    // the request that gave up on it.
    pending.then(
      (late) => {
        worker = late;
        if (abandoned) void cleanup(late);
      },
      () => {},
    );

    worker = await Promise.race([pending, engineFailure, deadline]);
    const recognised = await Promise.race([worker.recognize(image), engineFailure, deadline]);
    const text = String(recognised?.data?.text ?? "").trim();

    return {
      code: text ? "OCR_SUCCESS" : "OCR_COMPLETED_NO_TEXT",
      text,
      message: text
        ? `Local OCR read ${text.length} characters.`
        : "Local OCR ran against the verified local model and found no readable text in this image.",
      modelPath: model.path,
      modelSha256: model.sha256,
    };
  } catch (error) {
    abandoned = true;
    const failure =
      error instanceof LocalOcrEngineFailure
        ? error
        : new LocalOcrEngineFailure(
            "OCR_ENGINE_ERROR",
            `The local OCR engine failed: ${error instanceof Error ? error.message : String(error)}`,
          );
    return {
      code: failure.code,
      text: "",
      message: failure.message,
      modelPath: model.path,
      modelSha256: model.sha256,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await cleanup(worker);
  }
}
