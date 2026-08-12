/**
 * Host-side sticker / VIN OCR (EasyOCR via Python).
 * Process boundary only — domain modules must not spawn processes.
 *
 * Applies EXIF orientation before OCR (critical for phone JPEGs — orientation 6
 * was the root cause of the real-lot sticker failure).
 */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface StickerOcrLineV1 {
  text: string;
  confidence: number;
  /** Bounding box as [[x,y]×4] in oriented-image pixel space, if available. */
  box: number[][] | null;
}

export interface StickerOcrResultV1 {
  engine: "easyocr";
  orientedWidth: number;
  orientedHeight: number;
  exifOrientation: number | null;
  lines: StickerOcrLineV1[];
  fullText: string;
  latencyMs: number;
}

function runProcess(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* */
      }
    }, opts.timeoutMs ?? 300_000);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
      if (stdout.length > 4_000_000) stdout = stdout.slice(0, 4_000_000);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 500_000) stderr = stderr.slice(0, 500_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err.message || err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * Run EasyOCR on image bytes after EXIF-aware orientation.
 * Returns null when Python/easyocr unavailable.
 */
export async function runEasyOcrOnImageBytes(
  bytes: Buffer,
  opts: { timeoutMs?: number; languages?: string } = {},
): Promise<StickerOcrResultV1 | null> {
  const dir = join(tmpdir(), `aion-sticker-ocr-${randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const imgPath = join(dir, "input.jpg");
  const outPath = join(dir, "out.json");
  const pyPath = join(dir, "run_easyocr.py");
  const script = [
    "import json, sys, time",
    "from PIL import Image, ImageOps",
    "import numpy as np",
    "try:",
    "    import easyocr",
    "except Exception as e:",
    "    print('IMPORT_FAIL:'+str(e), file=sys.stderr)",
    "    sys.exit(2)",
    "img_path, out_path = sys.argv[1:3]",
    "raw = Image.open(img_path)",
    "exif = raw.getexif()",
    "ori = exif.get(274) if exif else None",
    "img = ImageOps.exif_transpose(raw).convert('RGB')",
    "t0 = time.time()",
    "reader = easyocr.Reader(['en'], gpu=False, verbose=False)",
    "res = reader.readtext(np.array(img), detail=1, paragraph=False)",
    "ms = int((time.time()-t0)*1000)",
    "lines = []",
    "for item in res:",
    "    box, text, conf = item[0], item[1], float(item[2])",
    "    lines.append({",
    "        'text': str(text),",
    "        'confidence': conf,",
    "        'box': [[float(p[0]), float(p[1])] for p in box] if box is not None else None,",
    "    })",
    "full = ' '.join(l['text'] for l in lines)",
    "open(out_path, 'w', encoding='utf-8').write(json.dumps({",
    "    'engine': 'easyocr',",
    "    'orientedWidth': img.size[0],",
    "    'orientedHeight': img.size[1],",
    "    'exifOrientation': ori,",
    "    'lines': lines,",
    "    'fullText': full,",
    "    'latencyMs': ms,",
    "}))",
  ].join("\n");
  try {
    writeFileSync(imgPath, bytes);
    writeFileSync(pyPath, script, "utf8");
    const py = process.env.AION_PYTHON?.trim() || "python";
    const r = await runProcess(py, [pyPath, imgPath, outPath], {
      timeoutMs: opts.timeoutMs ?? 300_000,
    });
    if (r.code !== 0 || !existsSync(outPath)) return null;
    const parsed = JSON.parse(readFileSync(outPath, "utf8")) as StickerOcrResultV1;
    if (!parsed || !Array.isArray(parsed.lines)) return null;
    return parsed;
  } catch {
    return null;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
}

/**
 * Apply EXIF orientation to JPEG/PNG bytes and re-encode as JPEG for vision models.
 * Returns original bytes when orientation is 1 / missing or processing fails.
 */
export async function orientImageBytesForVision(bytes: Buffer): Promise<{
  bytes: Buffer;
  exifOrientation: number | null;
  width: number | null;
  height: number | null;
  rotated: boolean;
}> {
  const dir = join(tmpdir(), `aion-orient-${randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const inPath = join(dir, "in.bin");
  const outPath = join(dir, "out.jpg");
  const pyPath = join(dir, "orient.py");
  const script = [
    "import json, sys",
    "from PIL import Image, ImageOps",
    "inp, outp = sys.argv[1:3]",
    "raw = Image.open(inp)",
    "exif = raw.getexif()",
    "ori = exif.get(274) if exif else None",
    "img = ImageOps.exif_transpose(raw).convert('RGB')",
    "img.save(outp, format='JPEG', quality=92)",
    "print(json.dumps({'ori': ori, 'w': img.size[0], 'h': img.size[1], 'rotated': bool(ori and ori != 1)}))",
  ].join("\n");
  try {
    writeFileSync(inPath, bytes);
    writeFileSync(pyPath, script, "utf8");
    const py = process.env.AION_PYTHON?.trim() || "python";
    const r = await runProcess(py, [pyPath, inPath, outPath], { timeoutMs: 60_000 });
    if (r.code !== 0 || !existsSync(outPath)) {
      return { bytes, exifOrientation: null, width: null, height: null, rotated: false };
    }
    const meta = JSON.parse(r.stdout.trim() || "{}") as {
      ori?: number | null;
      w?: number;
      h?: number;
      rotated?: boolean;
    };
    const out = readFileSync(outPath);
    return {
      bytes: out,
      exifOrientation: meta.ori ?? null,
      width: meta.w ?? null,
      height: meta.h ?? null,
      rotated: Boolean(meta.rotated),
    };
  } catch {
    return { bytes, exifOrientation: null, width: null, height: null, rotated: false };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
}
