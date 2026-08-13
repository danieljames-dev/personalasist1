/**
 * Does OCR-ing a VIN band first beat OCR-ing the whole photo?
 *
 * The measured pipeline spends 100% of its time in OCR — about 34 seconds per warm image on a 4 MB
 * phone photo — and it currently runs EasyOCR across the entire frame before it ever considers a
 * crop. EasyOCR's cost scales with the pixels it is given, so the obvious question is whether a
 * narrow band containing the VIN can be read in a fraction of that, often enough to make it the
 * first thing tried rather than a fallback.
 *
 * This measures that question rather than assuming the answer. Full frame and each candidate crop
 * are timed on the same real image, and each is scored on whether it produced a structurally valid,
 * check-digit-correct VIN — because a crop that is fast and wrong is worse than the slow path.
 *
 * Explicit benchmark. Never part of verify. No image byte reaches Git.
 *
 * Usage: node scripts/aion-crop-first-benchmark.mjs [--data-root <dir>] [--image <n>]
 */
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { orientImageBytesForVision, runEasyOcrOnImageBytes } from "../packages/local-assistant/dist/connectors/sticker-ocr.js";
import { vinIdentityCropRegions, cropImageToRegion } from "../packages/local-assistant/dist/image-region.js";
import { validateVin, normalizeVinCandidate } from "../packages/local-assistant/dist/vehicle-inventory.js";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const dataRoot = resolve(arg("data-root", join(process.cwd(), "private", "aion")));
const pick = Number(arg("image", "0")) || 0;

const state = JSON.parse(await readFile(join(dataRoot, "state-v1.json"), "utf8"));
const photos = (state.crmDocuments ?? []).filter(
  (d) => d.storedPath && (d.tags ?? []).some((t) => /photo/i.test(String(t))),
);
if (!photos[pick]) {
  console.log("NO_AUTHORIZED_IMAGE");
  process.exit(1);
}
const doc = photos[pick];
const original = await readFile(doc.storedPath);
console.log(`IMAGE = ${doc.filename} (${(original.length / 1_048_576).toFixed(2)} MB)`);

/** Any 17-character run that survives structural and check-digit validation. */
function validVinsIn(text) {
  const found = new Set();
  for (const match of String(text ?? "").matchAll(/[A-HJ-NPR-Z0-9]{17}/gi)) {
    const normalized = normalizeVinCandidate(match[0]);
    if (normalized && validateVin(normalized).valid) found.add(normalized);
  }
  return [...found];
}

const orientBegan = Date.now();
const oriented = await orientImageBytesForVision(original).catch(() => null);
const orientMs = Date.now() - orientBegan;
const working = oriented?.bytes ?? original;
console.log(`EXIF_ORIENTATION_MS = ${orientMs}`);

async function timeEasyOcr(bytes, label) {
  const began = Date.now();
  let text = "";
  try {
    const result = await runEasyOcrOnImageBytes(bytes, { timeoutMs: 180_000 });
    text = String(result?.fullText ?? "");
  } catch (error) {
    return { label, ms: Date.now() - began, vins: [], chars: 0, error: String(error?.message ?? error).slice(0, 60) };
  }
  return { label, ms: Date.now() - began, vins: validVinsIn(text), chars: text.length, error: null };
}

console.log("\n=== FULL FRAME (what runs first today) ===");
const full = await timeEasyOcr(working, "full-frame");
console.log(`  ${full.ms} ms · ${full.chars} chars · valid VINs: ${full.vins.join(", ") || "none"}`);

console.log("\n=== VIN-REGION CROPS (candidate for running first) ===");
const rows = [full];
// Only the regions plausibly containing a VIN; the price/lower bands are not identity regions.
const identityRegions = vinIdentityCropRegions().filter((r) => /vin|document-core|top-band/.test(r.name));
for (const region of identityRegions) {
  const cropBegan = Date.now();
  const cropped = cropImageToRegion(working, region);
  const cropMs = Date.now() - cropBegan;
  if (!cropped) {
    console.log(`  ${region.name.padEnd(16)} crop unsupported for this format`);
    continue;
  }
  const row = await timeEasyOcr(cropped, region.name);
  row.cropMs = cropMs;
  row.bytes = cropped.length;
  rows.push(row);
  console.log(
    `  ${region.name.padEnd(16)} crop=${String(cropMs).padStart(4)}ms  ocr=${String(row.ms).padStart(6)}ms  `
    + `${String(row.chars).padStart(5)} chars  VIN: ${row.vins.join(", ") || "none"}`,
  );
}

console.log("\n=== VERDICT ===");
const winners = rows.filter((r) => r.label !== "full-frame" && r.vins.length > 0);
if (winners.length === 0) {
  console.log("  CROP_FIRST_VIABLE = NO — no crop produced a check-digit-valid VIN");
  console.log(`  full frame found: ${full.vins.join(", ") || "none"}`);
} else {
  const best = winners.sort((a, b) => a.ms - b.ms)[0];
  const saving = full.ms > 0 ? Math.round((1 - best.ms / full.ms) * 100) : 0;
  const agrees = full.vins.length === 0 || best.vins.some((v) => full.vins.includes(v));
  console.log(`  fastest crop with a valid VIN: ${best.label} at ${best.ms} ms`);
  console.log(`  full frame: ${full.ms} ms`);
  console.log(`  CROP_FIRST_SAVING = ${saving}%`);
  console.log(`  AGREES_WITH_FULL_FRAME = ${agrees}`);
  console.log(`  CROP_FIRST_VIABLE = ${saving > 25 && agrees ? "YES" : "NOT_CLEARLY"}`);
}
