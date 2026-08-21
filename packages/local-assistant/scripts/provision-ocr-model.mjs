/**
 * Provision the local Tesseract OCR model.
 *
 * Copies a local `eng.traineddata` into the directory AION reads from, and verifies it against the
 * size and digest pinned in `src/ocr-model.ts`. It reads from disk and writes to disk. There is no
 * network path in this file, deliberately: the whole point of V0.4 Finding 4's repair is that a
 * missing model is never a reason to contact anybody.
 *
 *   node packages/local-assistant/scripts/provision-ocr-model.mjs [source-path]
 *
 * With no argument it looks in the places a previous tesseract.js run would have left one.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const repositoryRoot = join(packageRoot, "..", "..");
const destinationDirectory = join(packageRoot, "models", "tesseract");
const destination = join(destinationDirectory, "eng.traineddata");

/** Kept in step with EXPECTED_OCR_MODEL_* in src/ocr-model.ts; asserted below rather than trusted. */
const EXPECTED_BYTES = 5_199_098;
const EXPECTED_SHA256 = "5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747";

function pinnedValuesAgree() {
  const source = readFileSync(join(packageRoot, "src", "ocr-model.ts"), "utf8");
  return source.includes(EXPECTED_SHA256) && source.includes("5_199_098");
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fail(message) {
  console.error(`provision-ocr-model: ${message}`);
  process.exit(1);
}

if (!pinnedValuesAgree()) {
  fail("this script's pinned size/digest no longer match src/ocr-model.ts; reconcile them before provisioning");
}

const explicit = process.argv[2];
const candidates = explicit
  ? [resolve(explicit)]
  : [
    join(repositoryRoot, "eng.traineddata"),
    join(process.cwd(), "eng.traineddata"),
    destination,
  ];

const source = candidates.find((path) => existsSync(path) && statSync(path).isFile());
if (!source) {
  fail(
    `no local eng.traineddata found. Looked in:\n  ${candidates.join("\n  ")}\n` +
    "Obtain one deliberately and pass its path. AION will not download it.",
  );
}

const sourceBytes = statSync(source).size;
if (sourceBytes !== EXPECTED_BYTES) {
  fail(`${source} is ${sourceBytes} bytes; ${EXPECTED_BYTES} expected. Refusing to provision a model AION would reject.`);
}
const sourceSha = digest(source);
if (sourceSha !== EXPECTED_SHA256) {
  fail(`${source} has digest ${sourceSha}; ${EXPECTED_SHA256} expected. Refusing to provision an unrecognised model.`);
}

mkdirSync(destinationDirectory, { recursive: true });
if (resolve(source) !== resolve(destination)) copyFileSync(source, destination);

const finalSha = digest(destination);
if (finalSha !== EXPECTED_SHA256) fail(`copy verification failed: ${destination} has digest ${finalSha}`);

console.log(`provision-ocr-model: ${destination}`);
console.log(`provision-ocr-model: ${statSync(destination).size} bytes, sha256 ${finalSha} — verified`);
