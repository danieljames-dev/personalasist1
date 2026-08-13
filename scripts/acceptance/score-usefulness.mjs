#!/usr/bin/env node
/**
 * Score Owner-facing replies for usefulness (not mere technical correctness).
 *
 * Usage:
 *   node scripts/acceptance/score-usefulness.mjs
 *   node scripts/acceptance/score-usefulness.mjs --reply-file path.json
 *
 * reply-file JSON: { "id", "question", "reply" }[]
 *
 * Does not call models. Applies deterministic fail-flags + human-score template.
 * For automated lot-count anti-pattern detection, uses heuristics.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rubric = JSON.parse(readFileSync(join(__dirname, "personality-rubric.json"), "utf8"));

const DIMENSIONS = rubric.dimensions;

function detectFailFlags(question, reply) {
  const q = String(question || "");
  const r = String(reply || "");
  const flags = [];
  if (/intent:|action:\s*[a-z]+\.[a-z]+|schema\s*v1|AssistantState/i.test(r)) {
    flags.push("INTENT_ROUTER_LABEL");
  }
  if (/^\s*\{[\s\S]*"id"\s*:/.test(r) || /```json/i.test(r)) {
    flags.push("SCHEMA_DUMP");
  }
  if (/as an ai language model|i'm just an ai|certainly! i('d| would) be happy/i.test(r)) {
    flags.push("GENERIC_AI_BOILERPLATE");
  }
  // Lot-count anti-pattern: population question answered only by re-describing one car
  if (/\bhow many\b/i.test(q) && /\b(lot|used|inventory|cars|vehicles)\b/i.test(q)) {
    const mentionsUnknown =
      /unknown|not know|don'?t know|haven't (seen|verified|counted)|sample of|only (physically )?(verified|photographed)|physical(ly)? total|actual (lot )?population/i.test(r);
    // Must separate website *count/listings* from physical lot — not merely "website price" of one car
    const separatesWebCount =
      /\b(list(ed|ing)s? online|online list|website (lists|count|inventory)|currently list|feed count|advertised inventory)\b/i.test(r)
      || (/\bwebsite\b/i.test(r) && /\b(list|count|units?|inventory)\b/i.test(r) && !/\bwebsite price\b/i.test(r));
    const describesOneVehicle =
      /\b(crown|vin\b|you photographed|this (car|vehicle)|the (car|vehicle) you)\b/i.test(r);
    const answersPopulation =
      mentionsUnknown || separatesWebCount || /\b\d+\s+(used\s+)?(cars?|vehicles?|units?)\b/i.test(r);
    // FAIL: describes the one car (or its price) without addressing population/unknown/web count
    if (describesOneVehicle && !mentionsUnknown && !separatesWebCount) {
      flags.push("REPEATED_RECORD_WITHOUT_ANSWERING");
    }
    if (!answersPopulation && describesOneVehicle) {
      if (!flags.includes("REPEATED_RECORD_WITHOUT_ANSWERING")) {
        flags.push("REPEATED_RECORD_WITHOUT_ANSWERING");
      }
    }
    if (!mentionsUnknown && /\bthere are \d+ (used )?cars on the lot\b/i.test(r)) {
      flags.push("FALSE_PHYSICAL_CENSUS");
    }
  }
  return flags;
}

function scoreTemplate(entry) {
  const flags = detectFailFlags(entry.question, entry.reply);
  const scores = {};
  for (const d of DIMENSIONS) {
    // Placeholder for human scoring; automated path only sets hard fails
    scores[d] = entry.scores?.[d] ?? null;
  }
  // Auto-fail usefulness dimensions when lot-count anti-pattern hits
  if (flags.includes("REPEATED_RECORD_WITHOUT_ANSWERING")) {
    scores.USEFULNESS = 1;
    scores.HONESTY_ABOUT_UNKNOWN = Math.min(scores.HONESTY_ABOUT_UNKNOWN ?? 2, 2);
  }
  if (flags.includes("FALSE_PHYSICAL_CENSUS")) {
    scores.GROUNDING = 1;
    scores.HONESTY_ABOUT_UNKNOWN = 1;
  }
  const numeric = DIMENSIONS.map((d) => scores[d]).filter((n) => typeof n === "number");
  const mean = numeric.length
    ? numeric.reduce((a, b) => a + b, 0) / numeric.length
    : null;
  const autoFail = flags.some((f) =>
    ["REPEATED_RECORD_WITHOUT_ANSWERING", "FALSE_PHYSICAL_CENSUS", "SCHEMA_DUMP", "INTENT_ROUTER_LABEL"].includes(f),
  );
  return {
    id: entry.id,
    question: entry.question,
    scores,
    mean,
    failFlags: flags,
    autoFail,
    pass:
      !autoFail
      && mean != null
      && mean >= (rubric.iphoneUsefulMeanThreshold || 3.5)
      && flags.length === 0,
    note: mean == null
      ? "Fill human scores 1–5 for dimensions still null; auto flags applied"
      : undefined,
  };
}

// Built-in examples for standby validation of the scorer itself
const EXAMPLES = [
  {
    id: "LOT_FAIL",
    question: "How many other used cars are on the lot?",
    reply: "You photographed a 2026 Toyota Crown Signia Limited. VIN JTDACAAJ8T3051788. Website price $53,378.",
  },
  {
    id: "LOT_PASS",
    question: "How many other used cars are on the lot?",
    reply:
      "I've only physically verified 1 used vehicle from today's photos — the Crown Signia. "
      + "How many used cars are actually standing on the lot is unknown from that sample. "
      + "The website currently lists many used units, but listed online is not the same as on the lot. "
      + "Next step: keep photographing on Inventory Walk and I can grow the physical count.",
    scores: {
      USEFULNESS: 5,
      NATURALNESS: 4,
      GROUNDING: 5,
      CONTEXT_RETENTION: 4,
      PROACTIVITY: 5,
      HONESTY_ABOUT_UNKNOWN: 5,
      ACTIONABILITY: 5,
    },
  },
];

function main() {
  const idx = process.argv.indexOf("--reply-file");
  let entries = EXAMPLES;
  if (idx >= 0) {
    const path = process.argv[idx + 1];
    entries = JSON.parse(readFileSync(path, "utf8"));
  }
  const results = entries.map(scoreTemplate);
  const outDir = join(__dirname, "out");
  mkdirSync(outDir, { recursive: true });
  const out = {
    generatedAt: new Date().toISOString(),
    rule: "Technical correctness alone is insufficient; usefulness required",
    dimensions: DIMENSIONS,
    results,
  };
  const outPath = join(outDir, `usefulness-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  // Standby self-check: LOT_FAIL must autoFail
  const lotFail = results.find((r) => r.id === "LOT_FAIL");
  if (lotFail && !lotFail.autoFail) {
    console.error("SCORER_SELF_CHECK_FAILED: LOT_FAIL should autoFail");
    process.exit(1);
  }
  if (lotFail && !lotFail.failFlags.includes("REPEATED_RECORD_WITHOUT_ANSWERING")) {
    console.error("SCORER_SELF_CHECK_FAILED: expected REPEATED_RECORD_WITHOUT_ANSWERING");
    process.exit(1);
  }
  console.error(`Wrote ${outPath}`);
  console.error("SCORER_SELF_CHECK=PASS");
}

main();
