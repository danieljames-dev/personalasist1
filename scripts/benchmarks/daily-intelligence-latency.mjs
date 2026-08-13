#!/usr/bin/env node
/**
 * Latency harness for multi-photo daily intelligence.
 *
 * Modes:
 *   --mode dry-run     Validate case schema only (default)
 *   --mode domain      Time pure domain fuse/resolve if Claude dist available
 *   --mode http        POST to AION_BASE (loopback) — optional, Owner-controlled
 *
 * Never optimizes runtime. Records stage timestamps only.
 *
 * Env:
 *   AION_CLAUDE_WORKTREE
 *   AION_BASE=http://127.0.0.1:31415
 *   AION_ACCEPTANCE_HEAD
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const modeIdx = process.argv.indexOf("--mode");
const MODE = modeIdx >= 0 ? process.argv[modeIdx + 1] : "dry-run";
const OUT = join(__dirname, "out");
const CLAUDE_WT = process.env.AION_CLAUDE_WORKTREE || "";

const STAGES = [
  "t_upload_start",
  "t_upload_end",
  "t_server_receive",
  "t_bundle_assembly",
  "t_orientation",
  "t_vin_fast_pass",
  "t_ocr",
  "t_fallback",
  "t_vin_validate",
  "t_inventory_join",
  "t_sticker_fusion",
  "t_customer_match",
  "t_reasoning",
  "t_first_useful",
  "t_full_result",
];

const CASES = [
  { id: "L1", name: "1 image", imageCount: 1, pattern: "single" },
  { id: "L2", name: "3 images same vehicle", imageCount: 3, pattern: "same-vehicle" },
  { id: "L3", name: "bad-first valid-second", imageCount: 3, pattern: "bad-first" },
  { id: "L4", name: "warm worker", imageCount: 1, pattern: "warm" },
  { id: "L5", name: "cold worker", imageCount: 1, pattern: "cold" },
];

function emptyStages() {
  return Object.fromEntries(STAGES.map((s) => [s, null]));
}

function mark(stages, key) {
  stages[key] = Date.now();
}

async function domainTimed(caseDef) {
  const stages = emptyStages();
  mark(stages, "t_upload_start");
  mark(stages, "t_upload_end");
  mark(stages, "t_server_receive");
  mark(stages, "t_bundle_assembly");

  const dist = join(CLAUDE_WT, "packages", "local-assistant", "dist", "vehicle-evidence-bundle.js");
  if (!CLAUDE_WT || !existsSync(dist)) {
    return {
      case: caseDef,
      stages,
      error: "Claude dist not available — domain timing skipped",
      durationsMs: {},
    };
  }
  const mod = await import(pathToFileURL(dist).href);
  const BAD = "STDAAABS1RS004150";
  const GOOD = "JTDACAAJ8T3051788";
  const images = [];
  if (caseDef.pattern === "bad-first" || caseDef.imageCount >= 3) {
    images.push({
      imageRef: "a", role: "VIN_CLOSEUP", ocrText: `VIN ${BAD}`, vinCandidates: [BAD], quality: 30,
    });
    images.push({
      imageRef: "b", role: "WINDOW_STICKER", ocrText: `VIN ${GOOD}`, vinCandidates: [GOOD], quality: 90,
    });
    images.push({
      imageRef: "c", role: "WINDOW_STICKER",
      ocrText: "BASE MSRP $49,090 TOTAL $50,955 CROWN SIGNIA LIMITED",
      vinCandidates: [], quality: 80,
    });
  } else {
    for (let i = 0; i < caseDef.imageCount; i++) {
      images.push({
        imageRef: `i${i}`,
        role: "WINDOW_STICKER",
        ocrText: `VIN ${GOOD}`,
        vinCandidates: [GOOD],
        quality: 85,
      });
    }
  }

  mark(stages, "t_orientation");
  mark(stages, "t_vin_fast_pass");
  // OCR not executed here — domain-only after OCR text already present
  mark(stages, "t_ocr");
  mark(stages, "t_fallback");
  mark(stages, "t_vin_validate");
  const t0 = Date.now();
  const consensus = mod.resolveVinAcrossImages(images);
  const t1 = Date.now();
  stages.t_vin_validate = t0;
  stages.t_inventory_join = t1;
  mark(stages, "t_sticker_fusion");
  if (typeof mod.fuseStickerFacts === "function") {
    try {
      mod.fuseStickerFacts(images);
    } catch { /* optional */ }
  }
  mark(stages, "t_customer_match");
  mark(stages, "t_reasoning");
  mark(stages, "t_first_useful");
  mark(stages, "t_full_result");

  const durationsMs = {
    resolveVinAcrossImages: t1 - t0,
    endToEndDomain: stages.t_full_result - stages.t_upload_start,
  };

  return {
    case: caseDef,
    stages,
    consensus: {
      resolution: consensus.resolution,
      validatedVin: consensus.validatedVin,
    },
    durationsMs,
    note: "OCR/upload stages are markers only in domain mode — real OCR timing needs private images + production path",
  };
}

function dryRun() {
  return CASES.map((c) => ({
    case: c,
    stages: emptyStages(),
    durationsMs: {},
    note: "dry-run: no timing executed",
  }));
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let runs;
  if (MODE === "dry-run") {
    runs = dryRun();
  } else if (MODE === "domain") {
    runs = [];
    for (const c of CASES.filter((x) => x.id !== "L5")) {
      runs.push(await domainTimed(c));
    }
  } else if (MODE === "http") {
    runs = [{
      error: "HTTP mode reserved — set AION_BASE and implement against Claude's multi-attachment API when checkpoint is coherent",
      aionBase: process.env.AION_BASE || "http://127.0.0.1:31415",
    }];
  } else {
    console.error(`Unknown mode ${MODE}`);
    process.exit(2);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: MODE,
    claudeWorktree: CLAUDE_WT || null,
    acceptanceHead: process.env.AION_ACCEPTANCE_HEAD || null,
    stageKeys: STAGES,
    cases: CASES,
    runs,
    bottlenecks: summarizeBottlenecks(runs),
  };

  const path = join(OUT, `latency-${MODE}-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`Wrote ${path}`);
}

function summarizeBottlenecks(runs) {
  const notes = [];
  for (const r of runs) {
    if (r.durationsMs?.resolveVinAcrossImages != null) {
      notes.push({
        case: r.case?.id,
        domainResolveMs: r.durationsMs.resolveVinAcrossImages,
      });
    }
  }
  notes.push({
    expectedProductionHotspots: [
      "EasyOCR full-page (~20s CPU on 4MP sticker — prior research)",
      "multi-image sequential OCR without warm worker",
      "cold model load",
    ],
  });
  return notes;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
