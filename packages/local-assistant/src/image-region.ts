/**
 * Targeted image regions for VIN / stock-sticker extraction.
 *
 * Dense window stickers defeat a small vision model when the whole page is in frame.
 * Cropping to likely identity bands (VIN line, stock number) is a preprocessing step —
 * not a second model. When crop is impossible (e.g. JPEG without a decoder), callers
 * still get a focused second prompt on the full image.
 */
import { createRequire } from "node:module";
import { deflateSync, inflateSync } from "node:zlib";

const require = createRequire(import.meta.url);

export interface ImageCropRegionV1 {
  name: string;
  /** Fraction of width from left [0,1). */
  x: number;
  /** Fraction of height from top [0,1). */
  y: number;
  /** Fraction of width. */
  w: number;
  /** Fraction of height. */
  h: number;
}

/**
 * Practical identity bands for a dealer sticker / door-jamb plate.
 * Ordered most-likely first. Full-frame is intentionally omitted — caller already tried it.
 */
export function vinIdentityCropRegions(): ImageCropRegionV1[] {
  return [
    // Window stickers (Monroney) typically fill the center of a phone photo of the glass.
    { name: "center-document", x: 0.08, y: 0.08, w: 0.84, h: 0.84 },
    { name: "top-band", x: 0, y: 0, w: 1, h: 0.4 },
    { name: "vin-upper-left", x: 0.04, y: 0.06, w: 0.55, h: 0.32 },
    { name: "vin-top-center", x: 0.15, y: 0.05, w: 0.7, h: 0.28 },
    { name: "center-band", x: 0.05, y: 0.3, w: 0.9, h: 0.4 },
    { name: "bottom-band", x: 0, y: 0.55, w: 1, h: 0.45 },
    { name: "price-lower", x: 0.05, y: 0.55, w: 0.9, h: 0.4 },
    { name: "lower-left", x: 0, y: 0.5, w: 0.55, h: 0.5 },
    { name: "lower-right", x: 0.45, y: 0.5, w: 0.55, h: 0.5 },
  ];
}

/** Identity-first: VIN only — do not OCR every sticker field. */
export const VIN_IDENTITY_ONLY_PROMPT =
  "Read only the VIN (17 characters) from this vehicle window sticker. Quote the VIN exactly as printed. If you cannot read all 17 characters, say so.";

/** Short second-pass prompt: identity fields only, no full-sticker OCR. */
export const VIN_STICKER_FOCUS_PROMPT =
  "Read the VIN (17 characters) and any stock number. Quote only those values exactly.";

/** Price/total fields after identity is known. */
export const STICKER_PRICE_FOCUS_PROMPT =
  "Read the Total Suggested Retail Price and MSRP numbers from this window sticker. Quote dollar amounts exactly.";

export interface PngInfoV1 {
  width: number;
  height: number;
  /** Decoded RGBA (4 bytes per pixel, row-major). */
  rgba: Buffer;
}

/**
 * Decode a simple 8-bit RGBA or RGB PNG (no interlacing, no palette).
 * Returns null when the buffer is not a crop-safe PNG — callers then skip crop fallback.
 */
export function decodeSimplePng(bytes: Buffer): PngInfoV1 | null {
  if (bytes.length < 33) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (offset + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) return null;
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (len < 13) return null;
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      const interlace = data[12]!;
      if (bitDepth !== 8 || interlace !== 0) return null;
      if (colorType !== 2 && colorType !== 6) return null;
      if (width < 8 || height < 8 || width > 4096 || height > 4096) return null;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!width || !height || !idat.length) return null;
  const channels = colorType === 6 ? 4 : 3;
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  const expected = height * (1 + stride);
  if (inflated.length < expected) return null;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (1 + stride)]!;
    const rowStart = y * (1 + stride) + 1;
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * channels;
      let r = inflated[i]!;
      let g = inflated[i + 1]!;
      let b = inflated[i + 2]!;
      let a = channels === 4 ? inflated[i + 3]! : 255;
      if (filter === 1 && x > 0) {
        // Sub
        const p = ((y * width) + (x - 1)) * 4;
        r = (r + rgba[p]!) & 255;
        g = (g + rgba[p + 1]!) & 255;
        b = (b + rgba[p + 2]!) & 255;
        if (channels === 4) a = (a + rgba[p + 3]!) & 255;
      } else if (filter === 2 && y > 0) {
        // Up
        const p = ((y - 1) * width + x) * 4;
        r = (r + rgba[p]!) & 255;
        g = (g + rgba[p + 1]!) & 255;
        b = (b + rgba[p + 2]!) & 255;
        if (channels === 4) a = (a + rgba[p + 3]!) & 255;
      } else if (filter !== 0) {
        // Paeth/Average not required for our synthetic fixtures; refuse complex filters.
        return null;
      }
      const o = (y * width + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
    }
  }
  return { width, height, rgba };
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Encode filter-0 RGBA PNG (no compression tricks). */
export function encodeRgbaPng(width: number, height: number, rgba: Buffer): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0;
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Crop a simple PNG to a fractional region. Returns null when decode/crop is not safe.
 * Used only as a vision preprocessing aid — never as authority about vehicle identity.
 */
export function cropPngToRegion(pngBytes: Buffer, region: ImageCropRegionV1): Buffer | null {
  const decoded = decodeSimplePng(pngBytes);
  if (!decoded) return null;
  return cropRgbaToPng(decoded.width, decoded.height, decoded.rgba, region);
}

function cropRgbaToPng(
  width: number,
  height: number,
  rgba: Buffer,
  region: ImageCropRegionV1,
): Buffer | null {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(region.x * width)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(region.y * height)));
  const cw = Math.max(8, Math.min(width - x0, Math.floor(region.w * width)));
  const ch = Math.max(8, Math.min(height - y0, Math.floor(region.h * height)));
  if (cw < 8 || ch < 8) return null;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const src = ((y0 + y) * width + x0) * 4;
    rgba.copy(out, y * cw * 4, src, src + cw * 4);
  }
  return encodeRgbaPng(cw, ch, out);
}

/**
 * Decode JPEG via jpeg-js (phone photos). Returns null when decode fails or image is huge.
 * Caps decode to 4096 on the long edge by sampling for crop safety / RAM.
 */
export function decodeJpegRgba(bytes: Buffer): PngInfoV1 | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  try {
    // Dynamic import path works after build; sync require-style via createRequire for crop hot path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const jpeg = require("jpeg-js") as {
      decode: (b: Buffer, opts?: { maxMemoryUsageInMB?: number; useTArray?: boolean }) => {
        width: number;
        height: number;
        data: Buffer | Uint8Array;
      };
    };
    const decoded = jpeg.decode(bytes, { maxMemoryUsageInMB: 256, useTArray: true });
    if (!decoded?.width || !decoded?.height || !decoded.data) return null;
    if (decoded.width < 8 || decoded.height < 8) return null;
    if (decoded.width > 8192 || decoded.height > 8192) return null;
    const rgba = Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
    // jpeg-js outputs RGBA already when useTArray
    if (rgba.length < decoded.width * decoded.height * 4) return null;
    return { width: decoded.width, height: decoded.height, rgba };
  } catch {
    return null;
  }
}

/**
 * Crop JPEG/PNG bytes to a region and return PNG for vision models.
 * Phone Chat uploads are almost always JPEG — PNG-only crops previously skipped the entire fallback.
 */
export function cropImageToRegion(
  bytes: Buffer,
  region: ImageCropRegionV1,
  mimeHint = "",
): Buffer | null {
  const mime = mimeHint.toLowerCase();
  const isPng = mime.includes("png") || (bytes[0] === 0x89 && bytes[1] === 0x50);
  const isJpeg = mime.includes("jpeg") || mime.includes("jpg") || (bytes[0] === 0xff && bytes[1] === 0xd8);
  if (isPng) return cropPngToRegion(bytes, region);
  if (isJpeg) {
    const decoded = decodeJpegRgba(bytes);
    if (!decoded) return null;
    // Downsample very large phone images before crop fan-out (keeps Ollama payloads reasonable).
    const maxEdge = 1600;
    if (decoded.width > maxEdge || decoded.height > maxEdge) {
      const scale = maxEdge / Math.max(decoded.width, decoded.height);
      const nw = Math.max(8, Math.floor(decoded.width * scale));
      const nh = Math.max(8, Math.floor(decoded.height * scale));
      const scaled = scaleRgbaNearest(decoded.rgba, decoded.width, decoded.height, nw, nh);
      return cropRgbaToPng(nw, nh, scaled, region);
    }
    return cropRgbaToPng(decoded.width, decoded.height, decoded.rgba, region);
  }
  // Try PNG then JPEG signatures as last resort.
  return cropPngToRegion(bytes, region) ?? (() => {
    const d = decodeJpegRgba(bytes);
    return d ? cropRgbaToPng(d.width, d.height, d.rgba, region) : null;
  })();
}

function scaleRgbaNearest(
  rgba: Buffer,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Buffer {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const si = (sy * sw + sx) * 4;
      const di = (y * dw + x) * 4;
      out[di] = rgba[si]!;
      out[di + 1] = rgba[si + 1]!;
      out[di + 2] = rgba[si + 2]!;
      out[di + 3] = rgba[si + 3]!;
    }
  }
  return out;
}

/**
 * Classify extraction failure for Owner-facing wording.
 * A large, high-byte phone photo that yields garbage text is a model limit — not "unclear photo".
 */
export type ExtractionFailureKindV1 =
  | "IMAGE_QUALITY_FAILURE"
  | "MODEL_EXTRACTION_FAILURE"
  | "DENSE_TEXT_LIMITATION"
  | "NO_DOCUMENT_FOUND"
  | "VIN_NOT_FOUND"
  | "NONE";

export function classifyExtractionFailure(input: {
  byteLength: number;
  extractedText: string;
  extractionOk: boolean;
  hasValidVin: boolean;
}): ExtractionFailureKindV1 {
  if (input.hasValidVin) return "NONE";
  const text = String(input.extractedText || "").trim();
  const large = input.byteLength >= 200_000;
  if (!input.extractionOk && !text) {
    return large ? "MODEL_EXTRACTION_FAILURE" : "IMAGE_QUALITY_FAILURE";
  }
  if (!text) return large ? "MODEL_EXTRACTION_FAILURE" : "IMAGE_QUALITY_FAILURE";
  // Garbage short model output on a large image = dense-text / model limit, not Owner error.
  if (large && text.length < 40) return "DENSE_TEXT_LIMITATION";
  if (large && !/[A-HJ-NPR-Z0-9]{11,}/i.test(text)) return "DENSE_TEXT_LIMITATION";
  if (!/[A-HJ-NPR-Z0-9]{11,}/i.test(text)) return "VIN_NOT_FOUND";
  return "VIN_NOT_FOUND";
}

export function ownerFacingExtractionMessage(kind: ExtractionFailureKindV1): string {
  switch (kind) {
    case "DENSE_TEXT_LIMITATION":
      return "I can see the window sticker, but the local vision model could not reliably read the small dense text. This is a model limitation, not a problem with your photo quality.";
    case "MODEL_EXTRACTION_FAILURE":
      return "I received the photo, but the local vision reader failed to extract usable text. Your image may still be fine — the on-device model is limited on dense stickers.";
    case "IMAGE_QUALITY_FAILURE":
      return "I could not find readable VIN characters. If the plate or sticker is small in the frame, move closer and shoot straight-on without glare.";
    case "NO_DOCUMENT_FOUND":
      return "I did not detect a VIN plate or window sticker in this photo.";
    case "VIN_NOT_FOUND":
      return "I could not extract a valid 17-character VIN from this image. If this is a window sticker, I can still try again after you type the VIN, or attach a closer crop of the VIN line.";
    default:
      return "";
  }
}
