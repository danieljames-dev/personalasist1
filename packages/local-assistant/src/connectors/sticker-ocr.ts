/**
 * Host-side sticker / VIN OCR (EasyOCR via Python).
 * Process boundary only — domain modules must not spawn processes.
 *
 * Latency strategy (correctness-preserving):
 *  1. Warm long-lived EasyOCR Reader worker (model load once)
 *  2. VIN-band native crops first; stop when a 17-char VIN run appears
 *  3. Full-page fallback only if bands miss
 *
 * Applies EXIF orientation inside the worker (critical for phone JPEGs).
 */
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export interface StickerOcrLineV1 {
  text: string;
  confidence: number;
  /** Bounding box as [[x,y]×4] in oriented-image pixel space, if available. */
  box: number[][] | null;
}

export interface StickerOcrRegionFracV1 {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StickerOcrAttemptV1 {
  region: string;
  latencyMs: number;
  lineCount: number;
  hasVinRun?: boolean;
  cropSize?: number[];
  error?: string;
}

export interface StickerOcrResultV1 {
  engine: "easyocr";
  orientedWidth: number;
  orientedHeight: number;
  exifOrientation: number | null;
  lines: StickerOcrLineV1[];
  fullText: string;
  /** End-to-end worker handling time for this request (includes region tries). */
  latencyMs: number;
  /** Last OCR call milliseconds (region or full page). */
  ocrMs?: number;
  /** Model load cost on worker (0 after warm). */
  readerLoadMs?: number;
  sourceRegion?: string;
  strategy?: "vin-band" | "full-page" | "full-page-only" | "oneshot";
  attempts?: StickerOcrAttemptV1[];
  warm?: boolean;
}

/**
 * Bounded general identity / VIN bands for Monroney-style stickers and plates.
 * Not manufacturer-coordinate hardcoding — layout priors only.
 * Ordered most-likely first; full-page is a separate fallback.
 */
export function easyOcrVinPriorityRegions(): StickerOcrRegionFracV1[] {
  return [
    // VIN line commonly sits under the manufacturer header / barcode block.
    { name: "vin-mid-band", x: 0.04, y: 0.16, w: 0.92, h: 0.22 },
    { name: "vin-upper-band", x: 0.04, y: 0.06, w: 0.92, h: 0.22 },
    // Wider identity third if the mid band missed (angled phone shots).
    { name: "identity-top-third", x: 0.02, y: 0.02, w: 0.96, h: 0.4 },
  ];
}

/** True when text already contains a contiguous 17-char VIN charset run. */
export function textHasVinCharsetRun(text: string): boolean {
  return /[A-HJ-NPR-Z0-9]{17}/.test(String(text ?? "").toUpperCase());
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

// ---------------------------------------------------------------------------
// Warm EasyOCR worker (singleton)
// ---------------------------------------------------------------------------

type WorkerPending = {
  id: string;
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let workerProc: ChildProcessWithoutNullStreams | null = null;
let workerBuf = "";
let workerReady: Promise<void> | null = null;
let workerQueue: Promise<void> = Promise.resolve();
const workerPending = new Map<string, WorkerPending>();

function resolveWorkerScriptPath(): string {
  // Prefer package-adjacent script (src or dist/connectors).
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "easyocr-worker.py"),
    join(here, "..", "..", "src", "connectors", "easyocr-worker.py"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  // Last resort: copy from candidates into temp (build may omit .py).
  const home = join(tmpdir(), "aion-easyocr-worker");
  mkdirSync(home, { recursive: true });
  const dest = join(home, "easyocr-worker.py");
  for (const p of candidates) {
    if (existsSync(p)) {
      copyFileSync(p, dest);
      return dest;
    }
  }
  // Embedded minimal fallback is not used when the file ships with the package.
  throw new Error("easyocr-worker.py not found next to sticker-ocr module");
}

function settlePending(id: string | null | undefined, payload: Record<string, unknown>) {
  if (!id) return;
  const p = workerPending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  workerPending.delete(id);
  p.resolve(payload);
}

function failAllPending(err: Error) {
  for (const [, p] of workerPending) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  workerPending.clear();
}

function attachWorkerHandlers(child: ChildProcessWithoutNullStreams) {
  workerBuf = "";
  child.stdout.on("data", (chunk) => {
    workerBuf += String(chunk);
    if (workerBuf.length > 8_000_000) workerBuf = workerBuf.slice(-4_000_000);
    let nl: number;
    while ((nl = workerBuf.indexOf("\n")) >= 0) {
      const line = workerBuf.slice(0, nl).trim();
      workerBuf = workerBuf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as Record<string, unknown>;
        settlePending(String(msg.id ?? ""), msg);
      } catch {
        /* ignore partial/noise */
      }
    }
  });
  child.stderr.on("data", () => {
    /* model load noise — discard */
  });
  child.on("exit", () => {
    workerProc = null;
    workerReady = null;
    failAllPending(new Error("easyocr worker exited"));
  });
  child.on("error", () => {
    workerProc = null;
    workerReady = null;
  });
}

async function ensureWorker(timeoutMs = 180_000): Promise<void> {
  if (workerProc && !workerProc.killed) {
    try {
      const pong = await workerRequest({ cmd: "ping" }, 15_000);
      if (pong?.ok) return;
    } catch {
      try {
        workerProc.kill();
      } catch {
        /* */
      }
      workerProc = null;
      workerReady = null;
    }
  }
  if (workerReady) return workerReady;

  workerReady = (async () => {
    const script = resolveWorkerScriptPath();
    const py = process.env.AION_PYTHON?.trim() || "python";
    const child = spawn(py, ["-u", script], {
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    workerProc = child;
    attachWorkerHandlers(child);

    // Worker preloads Reader before reading stdin — one long ping waits for readiness.
    const pong = await workerRequest({ cmd: "ping" }, timeoutMs);
    if (!pong?.ok) throw new Error("easyocr worker ping failed");
    const result = pong.result as { readerReady?: boolean } | undefined;
    if (!result?.readerReady) throw new Error("easyocr reader not ready");
  })();

  try {
    await workerReady;
  } catch (e) {
    workerReady = null;
    try {
      workerProc?.kill();
    } catch {
      /* */
    }
    workerProc = null;
    throw e;
  }
}

function workerRequest(
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!workerProc || !workerProc.stdin.writable) {
      reject(new Error("easyocr worker not running"));
      return;
    }
    const id = randomBytes(6).toString("hex");
    const timer = setTimeout(() => {
      workerPending.delete(id);
      reject(new Error("easyocr worker request timeout"));
    }, timeoutMs);
    workerPending.set(id, { id, resolve, reject, timer });
    const line = JSON.stringify({ ...body, id }) + "\n";
    try {
      workerProc.stdin.write(line, "utf8");
    } catch (e) {
      clearTimeout(timer);
      workerPending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** Serialize OCR jobs on the single worker (EasyOCR is not multi-thread safe here). */
function enqueueWorker<T>(fn: () => Promise<T>): Promise<T> {
  const run = workerQueue.then(fn, fn);
  workerQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Stop the warm worker (tests / shutdown). Safe if not running. */
export async function stopEasyOcrWorker(): Promise<void> {
  const proc = workerProc;
  if (!proc) return;
  try {
    await workerRequest({ cmd: "shutdown" }, 5_000).catch(() => null);
  } catch {
    /* */
  }
  try {
    proc.kill();
  } catch {
    /* */
  }
  workerProc = null;
  workerReady = null;
  failAllPending(new Error("easyocr worker stopped"));
}

/**
 * Run EasyOCR on image bytes after EXIF-aware orientation.
 * Uses a warm worker + VIN-band-first strategy when available.
 * Returns null when Python/easyocr unavailable.
 */
export async function runEasyOcrOnImageBytes(
  bytes: Buffer,
  opts: {
    timeoutMs?: number;
    languages?: string;
    /** Skip region tries (full page only). Default false. */
    fullPageOnly?: boolean;
    /** Disable warm worker (oneshot process). Default false. */
    oneshot?: boolean;
  } = {},
): Promise<StickerOcrResultV1 | null> {
  if (opts.oneshot || process.env.AION_EASYOCR_ONESHOT === "1") {
    return runEasyOcrOneshot(bytes, opts);
  }

  const dir = join(tmpdir(), `aion-sticker-ocr-${randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const imgPath = join(dir, "input.jpg");
  try {
    writeFileSync(imgPath, bytes);
    try {
      await ensureWorker(Math.min(opts.timeoutMs ?? 180_000, 180_000));
    } catch {
      // Fall back to oneshot if warm worker cannot start.
      return runEasyOcrOneshot(bytes, opts);
    }

    const regions = opts.fullPageOnly ? [] : easyOcrVinPriorityRegions();
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const resp = await enqueueWorker(() =>
      workerRequest(
        {
          cmd: "ocr",
          imagePath: imgPath,
          regions,
          stopOnVin: true,
        },
        timeoutMs,
      ),
    );

    if (!resp.ok || !resp.result) return null;
    const parsed = resp.result as StickerOcrResultV1;
    if (!parsed || !Array.isArray(parsed.lines)) return null;
    const out: StickerOcrResultV1 = {
      engine: "easyocr",
      orientedWidth: Number(parsed.orientedWidth) || 0,
      orientedHeight: Number(parsed.orientedHeight) || 0,
      exifOrientation: (parsed.exifOrientation as number | null) ?? null,
      lines: parsed.lines,
      fullText: String(parsed.fullText ?? ""),
      latencyMs: Number(parsed.latencyMs) || 0,
    };
    if (parsed.ocrMs !== undefined) out.ocrMs = Number(parsed.ocrMs);
    if (parsed.readerLoadMs !== undefined) out.readerLoadMs = Number(parsed.readerLoadMs);
    if (parsed.sourceRegion) out.sourceRegion = String(parsed.sourceRegion);
    if (parsed.strategy) out.strategy = parsed.strategy;
    if (parsed.attempts) out.attempts = parsed.attempts;
    if (parsed.warm !== undefined) out.warm = Boolean(parsed.warm);
    return out;
  } catch {
    return runEasyOcrOneshot(bytes, opts);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
}

/** Legacy oneshot process path (cold Reader every call) — fallback / measurement. */
async function runEasyOcrOneshot(
  bytes: Buffer,
  opts: { timeoutMs?: number } = {},
): Promise<StickerOcrResultV1 | null> {
  const dir = join(tmpdir(), `aion-sticker-ocr-oneshot-${randomBytes(6).toString("hex")}`);
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
    "    'strategy': 'oneshot',",
    "    'sourceRegion': 'full-page',",
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
    return { ...parsed, strategy: "oneshot", sourceRegion: "full-page" };
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
