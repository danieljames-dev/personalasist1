/**
 * Sticker / VIN region preprocessing unit tests.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyExtractionFailure,
  cropImageToRegion,
  cropPngToRegion,
  decodeSimplePng,
  encodeRgbaPng,
  ownerFacingExtractionMessage,
  VIN_IDENTITY_ONLY_PROMPT,
  VIN_STICKER_FOCUS_PROMPT,
  vinIdentityCropRegions,
} from "../src/image-region.js";

test("sticker focus prompt stays short for small vision models", () => {
  assert.ok(VIN_STICKER_FOCUS_PROMPT.length < 200);
  assert.match(VIN_STICKER_FOCUS_PROMPT, /VIN/i);
  assert.match(VIN_STICKER_FOCUS_PROMPT, /stock/i);
});

test("identity-first VIN prompt is short and VIN-only", () => {
  assert.ok(VIN_IDENTITY_ONLY_PROMPT.length < 220);
  assert.match(VIN_IDENTITY_ONLY_PROMPT, /VIN/i);
  assert.match(VIN_IDENTITY_ONLY_PROMPT, /17/i);
});

test("identity crop regions cover document, VIN, and price bands", () => {
  const regions = vinIdentityCropRegions();
  const names = regions.map((r) => r.name);
  assert.ok(names.includes("bottom-band"));
  assert.ok(names.includes("top-band"));
  assert.ok(names.includes("center-document"));
  assert.ok(names.includes("vin-upper-left"));
  assert.ok(names.includes("price-lower"));
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

test("non-PNG bytes refuse PNG-only crop rather than inventing pixels", () => {
  const jpegish = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.equal(cropPngToRegion(jpegish, vinIdentityCropRegions()[0]!), null);
  assert.equal(decodeSimplePng(jpegish), null);
});

test("JPEG crop via cropImageToRegion returns PNG when jpeg-js can decode", async () => {
  // Minimal valid-ish path: jpeg-js may reject tiny garbage; ensure API is safe.
  const garbageJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const refuse = cropImageToRegion(garbageJpeg, vinIdentityCropRegions()[0]!, "image/jpeg");
  assert.equal(refuse, null);

  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const jpeg = req("jpeg-js") as {
    encode: (img: { data: Buffer; width: number; height: number }, quality?: number) => { data: Buffer };
  };
  const w = 40;
  const h = 30;
  const data = Buffer.alloc(w * h * 4, 180);
  data[0] = 10; data[1] = 20; data[2] = 30; data[3] = 255;
  const encoded = jpeg.encode({ data, width: w, height: h }, 80);
  const jpegBytes = Buffer.from(encoded.data);
  const cropped = cropImageToRegion(jpegBytes, { name: "tl", x: 0, y: 0, w: 0.5, h: 0.5 }, "image/jpeg");
  assert.ok(cropped);
  const half = decodeSimplePng(cropped!);
  assert.ok(half);
  assert.ok(half!.width >= 8);
  assert.ok(half!.height >= 8);
});

test("REAL_STICKER_FAILURE_WORDING: large image + garbage text is dense-text, not retake", () => {
  const kind = classifyExtractionFailure({
    byteLength: 2_500_000,
    extractedText: "yes",
    extractionOk: true,
    hasValidVin: false,
  });
  assert.equal(kind, "DENSE_TEXT_LIMITATION");
  const msg = ownerFacingExtractionMessage(kind);
  assert.match(msg, /local vision model|model limitation|dense/i);
  assert.doesNotMatch(msg, /take a clearer|retake/i);
});

test("small empty image is quality failure (Owner may need better photo)", () => {
  const kind = classifyExtractionFailure({
    byteLength: 8_000,
    extractedText: "",
    extractionOk: false,
    hasValidVin: false,
  });
  assert.equal(kind, "IMAGE_QUALITY_FAILURE");
});

test("valid VIN is NONE failure kind", () => {
  assert.equal(
    classifyExtractionFailure({
      byteLength: 100,
      extractedText: "anything",
      extractionOk: true,
      hasValidVin: true,
    }),
    "NONE",
  );
});
