/**
 * VIN OCR provider-failure regressions.
 *
 * Found by powering the pipeline with a real local model rather than text fixtures. When the
 * provider returned nothing, callers passed its diagnostic string in as if it were OCR output, and
 * the VIN extractor happily mined the error message: "Image stored; vision model returned empty
 * text." produced the candidate RETURNEDEMPTYTEXT at CONFIRM_REQUIRED — AION asking the Owner to
 * confirm a VIN made of its own failure text.
 *
 * A failed extraction is not weak evidence about a car. It is no evidence about a car.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildVinOcrResult, VIN_VISION_PROMPT } from "../src/vin-ocr.js";

const FAILURE_TEXTS = [
  "Image stored; vision model returned empty text.",
  "Image stored; local vision HTTP 500. Metadata only.",
  "Image stored; vision call failed. Metadata only.",
];

test("a failed extraction never yields VIN candidates", () => {
  for (const text of FAILURE_TEXTS) {
    const r = buildVinOcrResult({ extractedText: text, provider: "ollama:moondream", extractionOk: false });
    assert.equal(r.candidates.length, 0, `"${text}" must not produce candidates`);
    assert.equal(r.status, "VIN_OCR_FAILED", "a provider failure is a failure, not a confirm prompt");
  }
});

test("the specific error string that produced RETURNEDEMPTYTEXT is now inert", () => {
  const r = buildVinOcrResult({
    extractedText: "Image stored; vision model returned empty text.",
    provider: "ollama:moondream",
    extractionOk: false,
  });
  const vins = r.candidates.map((c) => c.vin).join(",");
  assert.ok(!/RETURNED?EMPTYTEXT/i.test(vins), "error words must never surface as a VIN");
  assert.equal(r.sticker.stockNumber, null);
  assert.equal(r.sticker.year, null);
  assert.deepEqual(r.sticker.rawSignals, []);
});

test("a successful extraction still reads VINs normally", () => {
  const r = buildVinOcrResult({
    extractedText: "VIN 4T1G11AK2PU131060 STOCK L1002",
    provider: "ollama:moondream",
    extractionOk: true,
  });
  assert.ok(r.candidates.some((c) => c.vin === "4T1G11AK2PU131060"), "a real VIN must still be found");
  assert.notEqual(r.status, "VIN_OCR_FAILED");
});

test("omitting extractionOk preserves existing behaviour", () => {
  const r = buildVinOcrResult({ extractedText: "VIN 4T1G11AK2PU131060", provider: "fixture" });
  assert.ok(r.candidates.some((c) => c.vin === "4T1G11AK2PU131060"));
});

test("the VIN prompt stays short enough for small local vision models", () => {
  // The 317-character multi-rule prompt made moondream return empty for every VIN image while it
  // read the same image fine when asked plainly. Length itself is the regression risk.
  assert.ok(VIN_VISION_PROMPT.length <= 140, `prompt is ${VIN_VISION_PROMPT.length} chars; small models go silent on long rule lists`);
  assert.ok(/text/i.test(VIN_VISION_PROMPT), "prompt must still ask for text");
  assert.equal(VIN_VISION_PROMPT.split("\n").length, 1, "single instruction, not a rule list");
});
