#!/usr/bin/env node
/**
 * Deterministic scanners for model-assisted Owner replies against grounded facts.
 *
 * Permanent regression: qwen3:4b-instruct claimed "within $33,000" and "AWD availability"
 * when facts were MAX=33000, PRICE=34120, AWD=UNKNOWN.
 *
 * Usage:
 *   node scripts/acceptance/score-model-grounding.mjs
 *   node scripts/acceptance/score-model-grounding.mjs --reply-file replies.json
 *
 * replies.json: [{ "id", "reply", "facts"? }]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "model-grounding.json"), "utf8"),
);

const DEFAULT_FACTS = FIX.groundedFacts;

/**
 * @param {string} reply
 * @param {typeof DEFAULT_FACTS} facts
 */
export function scanModelGrounding(reply, facts = DEFAULT_FACTS) {
  const text = String(reply ?? "");
  const flags = [];
  const max = Number(facts.customerVehiclePriceMaxUsd);
  const price = Number(facts.candidateVehiclePriceUsd);
  const over = price - max;

  // --- Numeric comparison ---
  // Negated phrases ("not within budget") must not count as within-budget claims.
  const strippedNegations = text
    .replace(/\bnot\s+within\b[^.]{0,40}/gi, " ")
    .replace(/\bnot\s+under\b[^.]{0,40}/gi, " ")
    .replace(/\bno longer\s+within\b[^.]{0,40}/gi, " ")
    .replace(/\bisn't\s+within\b[^.]{0,40}/gi, " ")
    .replace(/\bis not\s+within\b[^.]{0,40}/gi, " ");

  const claimsWithinBudget =
    /\bwithin\b[^.]{0,40}\$?\s*33[,.]?000\b/i.test(strippedNegations)
    || /\bwithin (?:her |the |your )?(?:budget|max|price)\b/i.test(strippedNegations)
    || /\bunder (?:her |the )?\$?\s*33[,.]?000\b/i.test(strippedNegations)
    || /\bfits (?:her |the )?budget\b/i.test(strippedNegations)
    || /\bwithin budget\b/i.test(strippedNegations)
    || /\bunder (?:her |the )?max\b/i.test(strippedNegations)
    || (/\b\$?33[,.]?000\b/.test(strippedNegations)
      && /\b(within|under|inside|meets)\b/i.test(strippedNegations)
      && !/\bover\b/i.test(strippedNegations)
      && !/\babove\b/i.test(strippedNegations)
      && !/\bexceed/i.test(strippedNegations));

  // Explicit wrong direction: says under/at max when price > max
  if (price > max && claimsWithinBudget) {
    flags.push("INCORRECT_NUMERIC_COMPARISON");
  }

  // Missing over-budget truth when making a fit/budget judgment
  const discussesBudget =
    /\b(budget|max|price|\$|afford|over|under|within)\b/i.test(text);
  const statesOver =
    /\bover\b/i.test(text)
    || /\babove\b/i.test(text)
    || /\bexceed/i.test(text)
    || new RegExp(`\\$?\\s*${over.toLocaleString("en-US").replace(",", "[,]?")}`).test(text)
    || new RegExp(`\\$?\\s*${over}\\b`).test(text)
    || (/\b34[,.]?120\b/.test(text) && /\b33[,.]?000\b/.test(text) && /\b(over|above|more than|higher)\b/i.test(text));

  if (discussesBudget && price > max && !statesOver && !flags.includes("INCORRECT_NUMERIC_COMPARISON")) {
    // Soft: only if it made a positive budget fit claim without over
    if (/\b(good fit|strong fit|matches? her|works for her|within|under)\b/i.test(text)) {
      flags.push("INCORRECT_NUMERIC_COMPARISON");
    }
  }

  // --- Attribute grounding (AWD) ---
  if (facts.awd === "UNKNOWN" || facts.awd == null) {
    const claimsAwdPresent =
      /\bAWD availability\b/i.test(text)
      || /\bhas AWD\b/i.test(text)
      || /\bwith AWD\b/i.test(text)
      || /\ball[- ]wheel drive\b/i.test(text)
        && !/\b(unknown|unverified|not (stated|confirmed|verified|listed)|no evidence|unclear|not sure)\b/i.test(text)
      || (/\bAWD\b/i.test(text)
        && /\b(available|included|equipped|offers?|comes with|features?)\b/i.test(text)
        && !/\b(unknown|unverified|not (stated|confirmed|verified)|no |without)\b/i.test(text));

    // "AWD availability makes it strong" is the measured fail
    if (/\bAWD availability\b/i.test(text) && !/\b(unknown|unverified|not )\b/i.test(text)) {
      flags.push("UNSUPPORTED_ATTRIBUTE_ASSERTION");
    } else if (claimsAwdPresent) {
      flags.push("UNSUPPORTED_ATTRIBUTE_ASSERTION");
    }
  }

  return {
    flags: [...new Set(flags)],
    autoFail: flags.length > 0,
    facts: { max, price, over, awd: facts.awd },
  };
}

function main() {
  const idx = process.argv.indexOf("--reply-file");
  let entries = [
    {
      id: FIX.canonicalFailExample.id,
      reply: FIX.canonicalFailExample.reply,
      expect: FIX.canonicalFailExample.expectedFlags,
    },
    {
      id: FIX.canonicalPassExample.id,
      reply: FIX.canonicalPassExample.reply,
      expect: FIX.canonicalPassExample.expectedFlags,
    },
  ];
  if (idx >= 0) {
    entries = JSON.parse(readFileSync(process.argv[idx + 1], "utf8"));
  }

  const results = entries.map((e) => {
    const scan = scanModelGrounding(e.reply, e.facts || DEFAULT_FACTS);
    const expect = e.expect || e.expectedFlags || [];
    const hasAll = expect.every((f) => scan.flags.includes(f));
    const noExtrasWhenExpectEmpty = expect.length === 0 ? scan.flags.length === 0 : true;
    // Fail example must autoFail; pass must not
    let selfOk = true;
    if (e.id === "QWEN_MEASURED_FAIL") {
      selfOk = scan.autoFail
        && scan.flags.includes("INCORRECT_NUMERIC_COMPARISON")
        && scan.flags.includes("UNSUPPORTED_ATTRIBUTE_ASSERTION");
    }
    if (e.id === "GROUNDED_PASS") {
      selfOk = !scan.autoFail && scan.flags.length === 0;
    }
    return {
      id: e.id,
      replyPreview: String(e.reply).slice(0, 160),
      ...scan,
      expect,
      expectMet: expect.length ? hasAll : noExtrasWhenExpectEmpty,
      selfOk,
    };
  });

  const out = {
    generatedAt: new Date().toISOString(),
    gates: FIX.gates,
    groundedFacts: DEFAULT_FACTS,
    results,
  };

  const outDir = join(__dirname, "out");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `model-grounding-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  const fail = results.find((r) => r.id === "QWEN_MEASURED_FAIL");
  const pass = results.find((r) => r.id === "GROUNDED_PASS");
  if (!fail?.selfOk) {
    console.error("MODEL_GROUNDING_SELF_CHECK_FAILED: fail example");
    process.exit(1);
  }
  if (!pass?.selfOk) {
    console.error("MODEL_GROUNDING_SELF_CHECK_FAILED: pass example");
    process.exit(1);
  }
  console.error("MODEL_GROUNDING_SELF_CHECK=PASS");
  console.error("Wrote", outPath);
}

main();
