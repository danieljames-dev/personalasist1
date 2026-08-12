/**
 * EasyOCR connector unit tests (no live model required).
 * Semantics of VIN validation remain in vin-ocr tests — this only covers
 * region helpers and charset-run detection used for early-stop.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  easyOcrVinPriorityRegions,
  textHasVinCharsetRun,
} from "../src/connectors/sticker-ocr.js";

test("VIN priority regions are bounded and ordered", () => {
  const regions = easyOcrVinPriorityRegions();
  assert.ok(regions.length >= 2 && regions.length <= 6);
  for (const r of regions) {
    assert.ok(r.name.length > 0);
    assert.ok(r.x >= 0 && r.x < 1);
    assert.ok(r.y >= 0 && r.y < 1);
    assert.ok(r.w > 0 && r.x + r.w <= 1.01);
    assert.ok(r.h > 0 && r.y + r.h <= 1.01);
  }
  // Must not include price-only lower half as first priority.
  assert.ok(!regions[0]!.name.includes("price"));
  assert.ok(regions[0]!.y < 0.35);
});

test("textHasVinCharsetRun detects contiguous 17-char VIN-shaped runs only", () => {
  assert.equal(textHasVinCharsetRun("VIN: JTDACAAJ8T3051788 END"), true);
  assert.equal(textHasVinCharsetRun("JTDACAAU4V3084476"), true);
  assert.equal(textHasVinCharsetRun("short"), false);
  assert.equal(textHasVinCharsetRun("JTDACAAJ8T305178"), false); // 16
  assert.equal(textHasVinCharsetRun("phone 555-337-8000 stock 553378"), false);
  // Alphabet sequences include prohibited I/O/Q — must not early-stop as a VIN run.
  assert.equal(textHasVinCharsetRun("ABCDEFGHIJKLMNOPQ"), false);
  // Valid VIN charset (no I/O/Q) still only early-stops; check-digit is separate.
  assert.equal(textHasVinCharsetRun("ABCDEFGHJKLMNPRST"), true);
});
