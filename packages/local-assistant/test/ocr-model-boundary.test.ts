/**
 * V0.4 Finding 4 — the local OCR model boundary.
 *
 * Discovery Campaign 03 demonstrated that a missing local OCR model caused AION to request
 * `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz` with no
 * capability and no effect gate, then hang the Owner's request and raise an uncaught exception.
 *
 * These tests judge by transport as well as by outcome: every model-failure path runs with socket
 * and DNS guards installed, and asserts that nothing was attempted off the machine. A test that
 * only checked the returned code would pass just as well against the defect.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import dns from "node:dns";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_OCR_MODEL_BYTES_V1,
  EXPECTED_OCR_MODEL_SHA256_V1,
  inspectLocalOcrModel,
  resolveOcrModelDirectory,
} from "../src/ocr-model.js";
import {
  runLocalTesseractOcr,
  type CreateTesseractWorkerV1,
  type TesseractWorkerLikeV1,
} from "../src/ocr-engine.js";

/* -------------------------------------------------------------------------- */
/* Transport guards                                                            */
/* -------------------------------------------------------------------------- */

interface Attempt { layer: string; host: string }

function isLoopbackHost(host: unknown): boolean {
  const h = String(host ?? "").toLowerCase().replace(/^\[|\]$/u, "");
  return h === "" || h === "localhost" || h === "::1" || h === "127.0.0.1" || h.startsWith("127.");
}

/**
 * Runs `body` with the network shut, and reports what was attempted.
 *
 * The socket predicate unwraps an array first, because Node hands `Socket.prototype.connect` its
 * own `normalizeArgs` output — `[options, callback]` — not the options object. Reading `.host` off
 * that array yields `undefined`, and a loopback default then lets the attempt through. Campaign 03
 * found that defect in its own guard; the correction is repeated here rather than trusted.
 */
async function withNetworkShut<T>(body: () => Promise<T>): Promise<{ value: T; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  const realConnect = net.Socket.prototype.connect;
  const realLookup = dns.lookup;
  const realHttp = http.request;
  const realHttps = https.request;

  net.Socket.prototype.connect = function guarded(this: net.Socket, ...args: unknown[]) {
    const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
    const options = (typeof first === "object" && first !== null ? first : {}) as Record<string, unknown>;
    const host = (options.host ?? options.path ?? "127.0.0.1") as string;
    if (options.path === undefined && !isLoopbackHost(host)) {
      attempts.push({ layer: "net.Socket.connect", host: String(host) });
      throw new Error(`TEST_REFUSED_SOCKET ${String(host)}`);
    }
    return (realConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;

  (dns as { lookup: unknown }).lookup = function guarded(hostname: string, ...rest: unknown[]) {
    if (!isLoopbackHost(hostname)) {
      attempts.push({ layer: "dns.lookup", host: String(hostname) });
      const callback = rest.find((r) => typeof r === "function") as ((e: Error) => void) | undefined;
      const error = new Error(`TEST_REFUSED_DNS ${hostname}`);
      if (callback) return void callback(error);
      throw error;
    }
    return (realLookup as (...a: unknown[]) => unknown).call(dns, hostname, ...rest);
  };

  for (const [mod, name] of [[http, "http"], [https, "https"]] as const) {
    (mod as { request: unknown }).request = function guarded(...args: unknown[]) {
      const first = args[0];
      const host = typeof first === "string"
        ? (() => { try { return new URL(first).hostname; } catch { return first; } })()
        : String((first as { host?: string; hostname?: string })?.host
          ?? (first as { hostname?: string })?.hostname ?? "");
      attempts.push({ layer: `${name}.request`, host: String(host) });
      throw new Error(`TEST_REFUSED_${name.toUpperCase()} ${String(host)}`);
    };
  }

  try {
    const value = await body();
    return { value, attempts };
  } finally {
    net.Socket.prototype.connect = realConnect;
    (dns as { lookup: unknown }).lookup = realLookup;
    (http as { request: unknown }).request = realHttp;
    (https as { request: unknown }).request = realHttps;
  }
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const temporaries: string[] = [];
function temporaryDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), "aion-ocr-model-"));
  temporaries.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of temporaries) rmSync(dir, { recursive: true, force: true });
});

/** A synthetic model plus the expectation that matches it, so no 5.2 MB asset is needed. */
function provisionedModel(bytes = 4096): { directory: string; expected: { bytes: number; sha256: string } } {
  const directory = temporaryDirectory();
  const content = Buffer.alloc(bytes, 0x41);
  writeFileSync(join(directory, "eng.traineddata"), content);
  return { directory, expected: { bytes, sha256: createHash("sha256").update(content).digest("hex") } };
}

const IMAGE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function workerReturning(text: string): CreateTesseractWorkerV1 {
  return async () => ({
    recognize: async () => ({ data: { text } }),
    terminate: async () => undefined,
  });
}

/* -------------------------------------------------------------------------- */
/* Model integrity                                                             */
/* -------------------------------------------------------------------------- */

test("a verified local model reports READY and the engine runs against it with nothing off-machine", async () => {
  const { directory, expected } = provisionedModel();
  assert.equal(inspectLocalOcrModel(directory, expected).code, "READY");

  const { value, attempts } = await withNetworkShut(() => runLocalTesseractOcr(IMAGE, {
    modelDirectory: directory, expectedModel: expected, createWorker: workerReturning("2T3W1RFV8SC317152"),
  }));

  assert.equal(value.code, "OCR_SUCCESS");
  assert.equal(value.text, "2T3W1RFV8SC317152");
  assert.equal(value.modelPath, join(directory, "eng.traineddata"));
  assert.deepEqual(attempts, [], "a working OCR pass must reach nothing off the machine");
});

test("a missing model reports OCR_MODEL_UNAVAILABLE without one DNS query or socket", async () => {
  const directory = temporaryDirectory();
  const { value, attempts } = await withNetworkShut(() => runLocalTesseractOcr(IMAGE, {
    modelDirectory: directory,
    createWorker: () => assert.fail("a worker must never be created without a verified model"),
  }));

  assert.equal(value.code, "OCR_MODEL_UNAVAILABLE");
  assert.match(value.message, /not installed/u);
  assert.match(value.message, /will not download it/u);
  assert.deepEqual(attempts, [], "a missing model is state, never authorization to reach the network");
});

test("an empty model is invalid, not merely absent, and reaches nothing", async () => {
  const directory = temporaryDirectory();
  writeFileSync(join(directory, "eng.traineddata"), Buffer.alloc(0));
  const { value, attempts } = await withNetworkShut(() => runLocalTesseractOcr(IMAGE, {
    modelDirectory: directory,
    createWorker: () => assert.fail("a worker must never be created for an empty model"),
  }));

  assert.equal(value.code, "OCR_MODEL_INVALID");
  assert.match(value.message, /empty/u);
  assert.deepEqual(attempts, []);
});

test("a truncated model is rejected on size before anything reads it", async () => {
  const { expected } = provisionedModel();
  const directory = temporaryDirectory();
  writeFileSync(join(directory, "eng.traineddata"), Buffer.alloc(128, 0x41));

  const { value, attempts } = await withNetworkShut(() => runLocalTesseractOcr(IMAGE, {
    modelDirectory: directory, expectedModel: expected,
    createWorker: () => assert.fail("a worker must never be created for a truncated model"),
  }));

  assert.equal(value.code, "OCR_MODEL_INVALID");
  assert.match(value.message, /truncated|different model/u);
  assert.deepEqual(attempts, []);
});

test("a model of the right size but the wrong digest is refused", async () => {
  const { expected } = provisionedModel();
  const directory = temporaryDirectory();
  writeFileSync(join(directory, "eng.traineddata"), Buffer.alloc(expected.bytes, 0x42));

  const { value, attempts } = await withNetworkShut(() => runLocalTesseractOcr(IMAGE, {
    modelDirectory: directory, expectedModel: expected,
    createWorker: () => assert.fail("a worker must never be created for an unrecognised model"),
  }));

  assert.equal(value.code, "OCR_MODEL_INVALID");
  assert.match(value.message, /checksum/u);
  assert.deepEqual(attempts, []);
  assert.notEqual(value.modelSha256, expected.sha256);
});

test("a directory where the model path is not a file is unavailable rather than invalid", () => {
  const directory = temporaryDirectory();
  mkdirSync(join(directory, "eng.traineddata"));
  const status = inspectLocalOcrModel(directory, { bytes: 1, sha256: "unused" });
  assert.equal(status.code, "OCR_MODEL_UNAVAILABLE");
  assert.match(status.message, /not a file/u);
});

/* -------------------------------------------------------------------------- */
/* The canonical path                                                          */
/* -------------------------------------------------------------------------- */

test("the model directory is resolved from the module, so the working directory cannot move it", () => {
  const before = resolveOcrModelDirectory();
  const original = process.cwd();
  const elsewhere = temporaryDirectory();
  try {
    process.chdir(elsewhere);
    assert.equal(resolveOcrModelDirectory(), before, "the canonical model path must not follow process.cwd()");
    assert.equal(
      inspectLocalOcrModel(before, { bytes: 1, sha256: "unused" }).path,
      join(before, "eng.traineddata"),
    );
  } finally {
    process.chdir(original);
  }
  assert.match(before.split("\\").join("/"), /packages\/local-assistant\/models\/tesseract$/u);
});

test("a missing model behaves identically from a different working directory", async () => {
  const directory = temporaryDirectory();
  const original = process.cwd();
  const elsewhere = temporaryDirectory();
  let value;
  try {
    process.chdir(elsewhere);
    ({ value } = await withNetworkShut(() => runLocalTesseractOcr(IMAGE, { modelDirectory: directory })));
  } finally {
    process.chdir(original);
  }
  assert.equal(value?.code, "OCR_MODEL_UNAVAILABLE");
});

test("the provisioning script pins exactly what the runtime expects", () => {
  // Same candidate-list reason as resolveOcrModelDirectory: this test runs from `dist-test/test`,
  // one level deeper than the source tree it is asserting about.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "scripts", "provision-ocr-model.mjs"),
    join(here, "..", "..", "scripts", "provision-ocr-model.mjs"),
  ];
  const found = candidates.find((path) => existsSync(path));
  assert.ok(found, `provision-ocr-model.mjs not found in:\n  ${candidates.join("\n  ")}`);
  const script = readFileSync(found, "utf8");
  assert.ok(script.includes(EXPECTED_OCR_MODEL_SHA256_V1), "the script must pin the runtime digest");
  assert.ok(
    script.includes(String(EXPECTED_OCR_MODEL_BYTES_V1).replace(/\B(?=(\d{3})+(?!\d))/gu, "_")),
    "the script must pin the runtime size",
  );
  assert.doesNotMatch(script, /https?:\/\/[^\s"']*\/[^\s"']*\.traineddata/u, "provisioning must not name a download");
});

/* -------------------------------------------------------------------------- */
/* Bounded worker                                                              */
/* -------------------------------------------------------------------------- */

test("a worker that rejects produces OCR_ENGINE_ERROR rather than an uncaught exception", async () => {
  const { directory, expected } = provisionedModel();
  const uncaught: unknown[] = [];
  const record = (error: unknown) => uncaught.push(error);
  process.on("uncaughtException", record);
  process.on("unhandledRejection", record);
  try {
    const { value, attempts } = await withNetworkShut(() => runLocalTesseractOcr(IMAGE, {
      modelDirectory: directory, expectedModel: expected,
      createWorker: async () => { throw new Error("worker exploded"); },
    }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(value.code, "OCR_ENGINE_ERROR");
    assert.match(value.message, /worker exploded/u);
    assert.deepEqual(attempts, []);
  } finally {
    process.off("uncaughtException", record);
    process.off("unhandledRejection", record);
  }
  assert.deepEqual(uncaught, [], "a worker failure must not escape the request lifecycle");
});

test("errorHandler turns the library's rethrow into a deterministic result", async () => {
  const { directory, expected } = provisionedModel();
  // Reproduces the real shape: createWorker never settles, and the failure arrives via errorHandler.
  const createWorker: CreateTesseractWorkerV1 = async (_language, options) => {
    setTimeout(() => options.errorHandler(new Error("Network error while fetching eng.traineddata")), 10);
    return new Promise<TesseractWorkerLikeV1>(() => {});
  };
  const value = await runLocalTesseractOcr(IMAGE, {
    modelDirectory: directory, expectedModel: expected, createWorker, timeoutMs: 30_000,
  });
  assert.equal(value.code, "OCR_ENGINE_ERROR");
  assert.match(value.message, /Network error while fetching/u);
});

test("a worker that never settles is bounded by the timeout and is still terminated", async () => {
  const { directory, expected } = provisionedModel();
  let terminated = 0;
  const lateResolvers: Array<(worker: TesseractWorkerLikeV1) => void> = [];
  const createWorker: CreateTesseractWorkerV1 = async () => new Promise<TesseractWorkerLikeV1>((resolve) => {
    lateResolvers.push(resolve);
  });

  const { value, attempts } = await withNetworkShut(() => runLocalTesseractOcr(IMAGE, {
    modelDirectory: directory, expectedModel: expected, createWorker, timeoutMs: 150,
  }));

  assert.equal(value.code, "OCR_TIMEOUT");
  assert.match(value.message, /did not respond within 150ms/u);
  assert.deepEqual(attempts, []);

  // A worker that arrives after we gave up must not outlive the request that abandoned it.
  lateResolvers[0]?.({ recognize: async () => ({ data: { text: "" } }), terminate: async () => { terminated += 1; } });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(terminated, 1, "a late worker must be cleaned up exactly once");
});

test("a recognition that never settles is bounded too", async () => {
  const { directory, expected } = provisionedModel();
  let terminated = 0;
  const createWorker: CreateTesseractWorkerV1 = async () => ({
    recognize: () => new Promise<{ data: { text: string } }>(() => {}),
    terminate: async () => { terminated += 1; },
  });
  const value = await runLocalTesseractOcr(IMAGE, {
    modelDirectory: directory, expectedModel: expected, createWorker, timeoutMs: 150,
  });
  assert.equal(value.code, "OCR_TIMEOUT");
  assert.equal(terminated, 1, "cleanup runs once on the timeout path");
});

test("cleanup is idempotent when terminate itself fails", async () => {
  const { directory, expected } = provisionedModel();
  const createWorker: CreateTesseractWorkerV1 = async () => ({
    recognize: async () => ({ data: { text: "" } }),
    terminate: async () => { throw new Error("already gone"); },
  });
  const value = await runLocalTesseractOcr(IMAGE, {
    modelDirectory: directory, expectedModel: expected, createWorker,
  });
  assert.equal(value.code, "OCR_COMPLETED_NO_TEXT", "a failing terminate must not change the result");
});

/* -------------------------------------------------------------------------- */
/* Truthful outcomes                                                           */
/* -------------------------------------------------------------------------- */

test("an empty read from a verified model is no-text, and says so without blaming the photo", async () => {
  const { directory, expected } = provisionedModel();
  const value = await runLocalTesseractOcr(IMAGE, {
    modelDirectory: directory, expectedModel: expected, createWorker: workerReturning("   "),
  });
  assert.equal(value.code, "OCR_COMPLETED_NO_TEXT");
  assert.match(value.message, /verified local model/u);
  assert.doesNotMatch(value.message, /download|install|provision/iu);
});

test("no-text and model-unavailable are never the same answer", async () => {
  const { directory, expected } = provisionedModel();
  const noText = await runLocalTesseractOcr(IMAGE, {
    modelDirectory: directory, expectedModel: expected, createWorker: workerReturning(""),
  });
  const unavailable = await runLocalTesseractOcr(IMAGE, { modelDirectory: temporaryDirectory() });

  assert.notEqual(noText.code, unavailable.code);
  assert.notEqual(noText.message, unavailable.message);
  assert.doesNotMatch(unavailable.message, /no (?:readable )?text/iu, "a missing model must never read as 'no text found'");
  assert.doesNotMatch(unavailable.message, /service|outage|unavailable service|try again later/iu);
});

test("the checker refuses to call it a local success when the model evidence is missing", async () => {
  // The false-success control: a caller claiming local OCR completed, with no verified model behind
  // it. Campaign 03's evaluator had to detect exactly this before its results could be trusted.
  const claimedSuccess = (result: { code: string; modelSha256: string | null }) =>
    result.code === "OCR_SUCCESS" && typeof result.modelSha256 === "string";

  const unavailable = await runLocalTesseractOcr(IMAGE, { modelDirectory: temporaryDirectory() });
  assert.equal(claimedSuccess(unavailable), false);
  assert.equal(unavailable.modelSha256, null, "a failed model check must carry no digest to claim");

  const { directory, expected } = provisionedModel();
  const real = await runLocalTesseractOcr(IMAGE, {
    modelDirectory: directory, expectedModel: expected, createWorker: workerReturning("TEXT"),
  });
  assert.equal(claimedSuccess(real), true);
  assert.equal(real.modelSha256, expected.sha256);
});
