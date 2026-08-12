/**
 * Targeted image regions for VIN / stock-sticker extraction.
 *
 * Dense window stickers defeat a small vision model when the whole page is in frame.
 * Cropping to likely identity bands (VIN line, stock number) is a preprocessing step —
 * not a second model. When crop is impossible (e.g. JPEG without a decoder), callers
 * still get a focused second prompt on the full image.
 */
import { deflateSync, inflateSync } from "node:zlib";

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
    { name: "bottom-band", x: 0, y: 0.55, w: 1, h: 0.45 },
    { name: "top-band", x: 0, y: 0, w: 1, h: 0.4 },
    { name: "center-band", x: 0.05, y: 0.3, w: 0.9, h: 0.4 },
    { name: "lower-left", x: 0, y: 0.5, w: 0.55, h: 0.5 },
    { name: "lower-right", x: 0.45, y: 0.5, w: 0.55, h: 0.5 },
  ];
}

/** Short second-pass prompt: identity fields only, no full-sticker OCR. */
export const VIN_STICKER_FOCUS_PROMPT =
  "Read the VIN (17 characters) and any stock number. Quote only those values exactly.";

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
  const { width, height, rgba } = decoded;
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
