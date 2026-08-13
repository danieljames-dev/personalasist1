/**
 * Real-image benchmark for the vehicle photo pipeline.
 *
 * Deliberately NOT part of `npm test`. Loading a warm OCR worker and pushing four-megabyte phone
 * photos through it takes minutes; putting that on the critical path of every run is how a suite
 * stops being run at all. The fast suites use injected OCR text and prove wiring. This proves speed.
 *
 * Images are taken from AION's own document records — the paths it already stored when the Owner
 * sent those photos — so nothing here scans private storage looking for material, and no image byte
 * ever reaches Git.
 *
 * Usage:
 *   node scripts/aion-vision-benchmark.mjs [--data-root <dir>] [--limit 3] [--json]
 */
import { readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  AionAssistantV1, FileStateRepositoryV1, SystemClockV1, RandomIdGeneratorV1,
  DeterministicModelProviderV1, StaticCapabilityRegistryV1, LocalEchoCapabilityV1,
  LocalArchiveImportSourceV1, NodePrivateBackupV1, SelectableDeveloperAgentRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "@aion/local-assistant";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const asJson = process.argv.includes("--json");
const dataRoot = resolve(arg("data-root", join(process.cwd(), "private", "aion")));
const limit = Number(arg("limit", "3")) || 3;

const statePath = join(dataRoot, "state-v1.json");
const state = JSON.parse(await readFile(statePath, "utf8"));

/** Only documents AION itself recorded as photos, and only ones still on disk. */
const candidates = [];
for (const doc of state.crmDocuments ?? []) {
  if (!doc.storedPath) continue;
  if (!(doc.tags ?? []).some((t) => /photo/i.test(String(t)))) continue;
  try {
    const info = await stat(doc.storedPath);
    candidates.push({ id: doc.id, filename: doc.filename, path: doc.storedPath, bytes: info.size });
  } catch {
    /* recorded but no longer present */
  }
}

if (candidates.length === 0) {
  console.log("NO_AUTHORIZED_IMAGES = none of AION's recorded photos are still on disk");
  process.exit(1);
}

const images = candidates.slice(0, Math.max(1, limit));
console.log(`AUTHORIZED_IMAGES = ${candidates.length} (using ${images.length})`);
for (const image of images) {
  console.log(`  ${image.filename} — ${(image.bytes / 1_048_576).toFixed(2)} MB`);
}

const service = new AionAssistantV1({
  repository: new FileStateRepositoryV1(dataRoot),
  clock: new SystemClockV1(),
  ids: new RandomIdGeneratorV1(),
  providers: [new DeterministicModelProviderV1()],
  capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
  importer: new LocalArchiveImportSourceV1(),
  backup: new NodePrivateBackupV1(join(dataRoot, "exports")),
  developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
});

const results = [];

async function loadImage(image) {
  const began = Date.now();
  const bytes = await readFile(image.path);
  return { fileReadMs: Date.now() - began, base64: bytes.toString("base64"), bytes: bytes.length };
}

async function runOne(image, label) {
  const loaded = await loadImage(image);
  const began = Date.now();
  const answer = await service.answerAboutVehiclePhotoBundle({
    text: "What vehicle is this?",
    images: [{
      contentBase64: loaded.base64, mimeType: "image/jpeg", filename: image.filename, documentRef: null,
    }],
    conversationId: "benchmark",
  });
  const totalMs = Date.now() - began;
  const data = answer.data ?? {};
  const row = {
    scenario: label,
    file: image.filename,
    megabytes: Number((loaded.bytes / 1_048_576).toFixed(2)),
    FILE_READ_MS: loaded.fileReadMs,
    OCR_PRIMARY_MS: data.timings?.ocr_image_1_ms ?? null,
    BUNDLE_ASSEMBLY_MS: data.timings?.bundle_assembly_ms ?? null,
    TOTAL_IMAGE_PIPELINE_MS: totalMs,
    resolution: data.bundle?.resolution ?? null,
    validatedVin: data.bundle?.validatedVin ?? null,
    vehicleMatched: Boolean(data.bundle?.vehicleRef),
  };
  results.push(row);
  return row;
}

console.log("\n=== A/B: single real images (cold worker first, then warm) ===");
for (let i = 0; i < images.length; i += 1) {
  const row = await runOne(images[i], i === 0 ? "single-cold" : `single-warm-${i}`);
  console.log(
    `  ${row.scenario.padEnd(16)} read=${String(row.FILE_READ_MS).padStart(5)}ms  `
    + `ocr=${String(row.OCR_PRIMARY_MS).padStart(7)}ms  total=${String(row.TOTAL_IMAGE_PIPELINE_MS).padStart(7)}ms  `
    + `→ ${row.resolution}${row.validatedVin ? ` ${row.validatedVin}` : ""}`,
  );
}

if (images.length >= 3) {
  console.log("\n=== C: real 3-photo bundle, warm worker ===");
  const loaded = await Promise.all(images.slice(0, 3).map(loadImage));
  const began = Date.now();
  const answer = await service.answerAboutVehiclePhotoBundle({
    text: "These photos are the same vehicle. What is it?",
    images: loaded.map((l, i) => ({
      contentBase64: l.base64, mimeType: "image/jpeg", filename: images[i].filename, documentRef: null,
    })),
    conversationId: "benchmark-bundle",
  });
  const totalMs = Date.now() - began;
  const t = answer.data?.timings ?? {};
  const perImage = [1, 2, 3].map((n) => t[`ocr_image_${n}_ms`] ?? 0);
  console.log(`  per-image OCR: ${perImage.join(" / ")} ms`);
  console.log(`  bundle assembly: ${t.bundle_assembly_ms ?? "?"} ms`);
  console.log(`  FULL_RESULT_MS: ${totalMs} ms  → ${answer.data?.bundle?.resolution}`);
  results.push({
    scenario: "bundle-3", TOTAL_IMAGE_PIPELINE_MS: totalMs,
    OCR_PRIMARY_MS: perImage.reduce((a, b) => a + b, 0),
    BUNDLE_ASSEMBLY_MS: t.bundle_assembly_ms ?? 0,
    resolution: answer.data?.bundle?.resolution ?? null,
  });
}

console.log("\n=== E: corrupt image alongside valid ones ===");
{
  const loaded = await loadImage(images[0]);
  const began = Date.now();
  const answer = await service.answerAboutVehiclePhotoBundle({
    text: "What vehicle is this?",
    images: [
      { contentBase64: Buffer.from("not-an-image").toString("base64"), mimeType: "image/jpeg", filename: "broken.jpg", documentRef: null },
      { contentBase64: loaded.base64, mimeType: "image/jpeg", filename: images[0].filename, documentRef: null },
    ],
    conversationId: "benchmark-corrupt",
  });
  console.log(`  survived = ${Boolean(answer.reply)}  total = ${Date.now() - began} ms`);
  console.log(`  mentions the bad file = ${/wouldn't open/i.test(answer.reply)}`);
  console.log(`  resolution = ${answer.data?.bundle?.resolution}`);
}

// Where the time actually goes, so optimisation is aimed rather than guessed.
const singles = results.filter((r) => r.scenario.startsWith("single"));
if (singles.length) {
  const total = singles.reduce((sum, r) => sum + r.TOTAL_IMAGE_PIPELINE_MS, 0);
  const ocr = singles.reduce((sum, r) => sum + (r.OCR_PRIMARY_MS ?? 0), 0);
  const read = singles.reduce((sum, r) => sum + r.FILE_READ_MS, 0);
  const pct = (part) => `${Math.round((part / Math.max(1, total)) * 100)}%`;
  console.log("\n=== PERCENT_OF_TOTAL_TIME_BY_MAJOR_STAGE ===");
  console.log(`  OCR (orientation + bands + engine): ${pct(ocr)}`);
  console.log(`  file read:                          ${pct(read)}`);
  console.log(`  everything else:                    ${pct(total - ocr - read)}`);
  console.log(`  REAL_PHOTO_BOTTLENECK = ${ocr / Math.max(1, total) > 0.5 ? "OCR" : "NOT_OCR"}`);
}

if (asJson) console.log(`\nJSON ${JSON.stringify(results)}`);
