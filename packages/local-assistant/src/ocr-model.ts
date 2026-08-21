/**
 * The local OCR language model: where it lives, and whether it is the one we expect.
 *
 * Discovery Campaign 03 measured what happens without this file. `createWorker("eng")` was called
 * with no path configuration at all, so tesseract.js resolved its cache as `./eng.traineddata`
 * relative to the *process working directory*, and when that file was not there it requested
 * `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz` — with no
 * capability, no effect-gate decision, and no approved outward adapter. A missing local file is
 * state. It was being treated as authorization to reach the public internet.
 *
 * Two properties follow, and they are the whole of this module:
 *
 *   1. **The model has one address.** It is resolved from this module's own location, never from
 *      the working directory, so AION is not warm in one directory and cold in another.
 *
 *   2. **Existence is not integrity.** The campaign showed a zero-byte and a 128-byte
 *      `eng.traineddata` both load without complaint, and a three-byte HTTP body is accepted as
 *      language data. So the check is on content: exact size and a pinned SHA-256.
 *
 * What the digest pins is *continuity*, not upstream authenticity. It is the digest of the model
 * that has actually been producing AION's OCR results, recorded so it cannot be swapped silently.
 * Verifying it against the publisher would mean contacting a third party, which is exactly what
 * this milestone exists to stop.
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const OCR_MODEL_LANGUAGE_V1 = "eng";
export const OCR_MODEL_FILENAME_V1 = `${OCR_MODEL_LANGUAGE_V1}.traineddata`;

/**
 * The model AION is provisioned with.
 *
 * Recorded from the artifact in service at the Finding 4 baseline, measured by Campaign 03. A
 * different model is not automatically wrong — it is unexpected, and unexpected is exactly what
 * this check exists to notice.
 */
export const EXPECTED_OCR_MODEL_BYTES_V1 = 5_199_098;
export const EXPECTED_OCR_MODEL_SHA256_V1 =
  "5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747";

export type LocalOcrModelCodeV1 = "READY" | "OCR_MODEL_UNAVAILABLE" | "OCR_MODEL_INVALID";

export interface LocalOcrModelStatusV1 {
  /**
   * `OCR_MODEL_UNAVAILABLE` when nothing readable is there at all; `OCR_MODEL_INVALID` when
   * something is there and is not the model. The distinction is what the Owner needs: one means
   * "provision it", the other means "the file you have is wrong".
   */
  code: LocalOcrModelCodeV1;
  directory: string;
  path: string;
  bytes: number | null;
  sha256: string | null;
  message: string;
}

export interface ExpectedOcrModelV1 {
  bytes: number;
  sha256: string;
}

export const EXPECTED_OCR_MODEL_V1: ExpectedOcrModelV1 = {
  bytes: EXPECTED_OCR_MODEL_BYTES_V1,
  sha256: EXPECTED_OCR_MODEL_SHA256_V1,
};

/**
 * The one address, resolved from this module rather than from the working directory.
 *
 * Same shape as `resolveWorkerScriptPath` in `connectors/sticker-ocr.ts`, which is how this package
 * already finds its bundled EasyOCR helper — and a candidate list for the same reason. `src/` and
 * `dist/` sit directly under the package root, so `../models/tesseract` reaches it; the test build
 * compiles to `dist-test/src/`, one level deeper, and a single candidate silently resolved to a
 * `dist-test/models/tesseract` that never exists. The model is provisioned once at the package root
 * and survives every rebuild; only the distance to it changes.
 */
export function resolveOcrModelDirectory(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "models", "tesseract"),
    join(here, "..", "..", "models", "tesseract"),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(join(candidate, OCR_MODEL_FILENAME_V1)).isFile()) return candidate;
    } catch {
      /* try the next one */
    }
  }
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isDirectory()) return candidate;
    } catch {
      /* try the next one */
    }
  }
  // Nothing provisioned anywhere: name the canonical place, so the message tells the Owner where
  // to put it rather than wherever this file happens to sit.
  return candidates[0]!;
}

/** Cache keyed on identity, so a 5.2 MB digest is not recomputed on every OCR pass. */
let cached: { path: string; size: number; mtimeMs: number; sha256: string } | null = null;

function digestOf(path: string, size: number, mtimeMs: number): string {
  if (cached && cached.path === path && cached.size === size && cached.mtimeMs === mtimeMs) {
    return cached.sha256;
  }
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  cached = { path, size, mtimeMs, sha256 };
  return sha256;
}

/**
 * Whether the local OCR model is present, readable, and the one we expect.
 *
 * Called before the worker is created, never after, so a bad model can never become a network
 * request. Same reasoning as `looksLikeDecodableImage`: this library reports failure by throwing
 * somewhere the caller's `try`/`catch` cannot see it, so the cheap check has to happen first.
 *
 * `directory` and `expected` are parameters rather than environment variables on purpose. A
 * configurable *destination* is what made the vision endpoint reachable in Findings 2 + 3; nothing
 * outside this process needs to move where AION looks for its own model. The tests pass their own
 * directory; the runtime never does.
 */
export function inspectLocalOcrModel(
  directory: string = resolveOcrModelDirectory(),
  expected: ExpectedOcrModelV1 = EXPECTED_OCR_MODEL_V1,
): LocalOcrModelStatusV1 {
  const path = join(directory, OCR_MODEL_FILENAME_V1);
  const base = { directory, path, bytes: null, sha256: null };

  let stats;
  try {
    stats = statSync(path);
  } catch {
    return {
      ...base,
      code: "OCR_MODEL_UNAVAILABLE",
      message: `The local OCR language model is not installed. Expected ${OCR_MODEL_FILENAME_V1} in ${directory}. AION will not download it.`,
    };
  }

  if (!stats.isFile()) {
    return {
      ...base,
      code: "OCR_MODEL_UNAVAILABLE",
      message: `The local OCR model path is not a file: ${path}.`,
    };
  }

  if (stats.size === 0) {
    return {
      ...base,
      bytes: 0,
      code: "OCR_MODEL_INVALID",
      message: `The local OCR language model at ${path} is empty. It needs to be provisioned again.`,
    };
  }

  if (stats.size !== expected.bytes) {
    return {
      ...base,
      bytes: stats.size,
      code: "OCR_MODEL_INVALID",
      message: `The local OCR language model at ${path} is ${stats.size} bytes; ${expected.bytes} were expected. It is truncated or is a different model.`,
    };
  }

  let sha256: string;
  try {
    sha256 = digestOf(path, stats.size, stats.mtimeMs);
  } catch {
    return {
      ...base,
      bytes: stats.size,
      code: "OCR_MODEL_UNAVAILABLE",
      message: `The local OCR language model at ${path} could not be read.`,
    };
  }

  if (sha256 !== expected.sha256) {
    return {
      ...base,
      bytes: stats.size,
      sha256,
      code: "OCR_MODEL_INVALID",
      message: `The local OCR language model at ${path} does not match the expected checksum. AION will not use a model it cannot recognise.`,
    };
  }

  return {
    ...base,
    bytes: stats.size,
    sha256,
    code: "READY",
    message: `Local OCR model verified at ${path}.`,
  };
}
