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
import { buildVinOcrResult, proposeVinsFromOcrText } from "../packages/local-assistant/dist/vin-ocr.js";

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

/**
 * Score OCR text exactly as production does.
 *
 * The first version of this benchmark used a contiguous 17-character regex and reported that neither
 * the crops nor the full frame found a VIN — while the service had resolved one from the same photo.
 * The regex was the thing that was wrong: production runs candidate proposal with bounded
 * OCR-confusion recovery, scoring and check-digit validation, and a second simplified parser can
 * only produce a second, wrong answer about whether the pipeline works.
 */
function scoreLikeProduction(text, byteLength) {
  const result = buildVinOcrResult({
    extractedText: String(text ?? ""),
    provider: "easyocr",
    byteLength: byteLength ?? 0,
    extractionOk: Boolean(String(text ?? "").trim()),
  });
  const raw = proposeVinsFromOcrText(String(text ?? ""));
  return {
    rawCandidateCount: raw.length,
    repairedCount: raw.filter((c) => c.source === "corrected").length,
    structurallyValid: raw.filter((c) => c.valid).map((c) => c.vin),
    best: result.best?.vin ?? null,
    bestValid: Boolean(result.best?.valid),
    bestSource: result.best?.source ?? null,
    confidence: result.best?.confidence ?? 0,
    status: result.status,
    sticker: result.sticker ?? null,
  };
}

/** Inventory corroboration, only ever after an image-derived candidate. */
function corroborate(vin) {
  if (!vin) return null;
  const hit = (state.vehicleInventory?.vehicles ?? []).find((v) => v.vin === vin);
  return hit ? [hit.year, hit.make, hit.model, hit.trim].filter(Boolean).join(" ") : null;
}

function validVinsIn(text) {
  const scored = scoreLikeProduction(text);
  return scored.bestValid && scored.best ? [scored.best] : [];
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
  const scored = scoreLikeProduction(text, bytes.length);
  return {
    label, ms: Date.now() - began, chars: text.length, error: null,
    vins: scored.bestValid && scored.best ? [scored.best] : [],
    scored,
  };
}

console.log("\n=== FULL FRAME (what runs first today) ===");
const full = await timeEasyOcr(working, "full-frame");
{
  const sc = full.scored ?? {};
  console.log(
    `  ${full.ms} ms · ${full.chars} chars · raw=${sc.rawCandidateCount ?? 0} valid=${(sc.structurallyValid ?? []).length} `
    + `BEST=${sc.best ?? "none"}${sc.bestValid ? "(valid)" : ""} ${sc.status ?? ""} inv=${corroborate(sc.best) ?? "no-match"}`,
  );
}

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
  const sc = row.scored ?? {};
  console.log(
    `  ${region.name.padEnd(16)} crop=${String(cropMs).padStart(4)}ms  ocr=${String(row.ms).padStart(6)}ms  `
    + `${String(row.chars).padStart(5)} chars  raw=${sc.rawCandidateCount ?? 0} valid=${(sc.structurallyValid ?? []).length}  `
    + `BEST=${sc.best ?? "none"}${sc.bestValid ? "(valid)" : ""} ${sc.status ?? ""} `
    + `inv=${corroborate(sc.best) ?? "no-match"}`,
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
