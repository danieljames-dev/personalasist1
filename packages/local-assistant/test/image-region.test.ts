/**
 * Sticker / VIN region preprocessing unit tests.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  cropPngToRegion,
  decodeSimplePng,
  encodeRgbaPng,
  VIN_STICKER_FOCUS_PROMPT,
  vinIdentityCropRegions,
} from "../src/image-region.js";

test("sticker focus prompt stays short for small vision models", () => {
  assert.ok(VIN_STICKER_FOCUS_PROMPT.length < 200);
  assert.match(VIN_STICKER_FOCUS_PROMPT, /VIN/i);
  assert.match(VIN_STICKER_FOCUS_PROMPT, /stock/i);
});

test("identity crop regions cover top and bottom bands", () => {
  const regions = vinIdentityCropRegions();
  const names = regions.map((r) => r.name);
  assert.ok(names.includes("bottom-band"));
  assert.ok(names.includes("top-band"));
  for (const r of regions) {
    assert.ok(r.w > 0 && r.h > 0);
    assert.ok(r.x >= 0 && r.y >= 0);
    assert.ok(r.x + r.w <= 1.01);
    assert.ok(r.y + r.h <= 1.01);
  }
});

test("PNG encode/decode/crop preserves dimensions", () => {
  const w = 32;
  const h = 24;
  const rgba = Buffer.alloc(w * h * 4, 90);
  // paint top-left red for sanity
  rgba[0] = 255; rgba[1] = 0; rgba[2] = 0; rgba[3] = 255;
  const png = encodeRgbaPng(w, h, rgba);
  const full = decodeSimplePng(png);
  assert.ok(full);
  assert.equal(full!.width, w);
  assert.equal(full!.height, h);
  assert.equal(full!.rgba[0], 255);

  const cropped = cropPngToRegion(png, { name: "tl", x: 0, y: 0, w: 0.5, h: 0.5 });
  assert.ok(cropped);
  const half = decodeSimplePng(cropped!);
  assert.ok(half);
  assert.equal(half!.width, 16);
  assert.equal(half!.height, 12);
  assert.equal(half!.rgba[0], 255);
});

test("non-PNG bytes refuse crop rather than inventing pixels", () => {
  const jpegish = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.equal(cropPngToRegion(jpegish, vinIdentityCropRegions()[0]!), null);
  assert.equal(decodeSimplePng(jpegish), null);
});
