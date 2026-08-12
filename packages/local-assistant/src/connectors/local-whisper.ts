/**
 * Host-side local speech transcription (faster-whisper / CLI).
 * Lives under connectors/ — process boundary is not in pure domain modules.
 */
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TranscriptSegmentV1 } from "../audio-transcription.js";

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
    }, opts.timeoutMs ?? 180_000);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
      if (stdout.length > 2_000_000) stdout = stdout.slice(0, 2_000_000);
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

function findFfmpeg(): string {
  const envPath = process.env.AION_FFMPEG_PATH?.trim();
  if (envPath && existsSync(envPath)) return envPath;
  return "ffmpeg";
}

/** Convert arbitrary audio bytes to 16 kHz mono wav for whisper. */
export async function decodeAudioToWav16k(bytes: Buffer, mimeHint = ""): Promise<Buffer | null> {
  const ffmpeg = findFfmpeg();
  const dir = join(tmpdir(), `aion-audio-${randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const ext =
    mimeHint.includes("webm") ? ".webm"
    : mimeHint.includes("mpeg") || mimeHint.includes("mp3") ? ".mp3"
    : mimeHint.includes("m4a") || mimeHint.includes("mp4") ? ".m4a"
    : mimeHint.includes("ogg") ? ".ogg"
    : mimeHint.includes("wav") ? ".wav"
    : ".bin";
  const inPath = join(dir, `in${ext}`);
  const outPath = join(dir, "out.wav");
  try {
    writeFileSync(inPath, bytes);
    const r = await runProcess(ffmpeg, ["-y", "-i", inPath, "-ac", "1", "-ar", "16000", "-f", "wav", outPath], {
      timeoutMs: 120_000,
    });
    if (r.code !== 0 || !existsSync(outPath)) return null;
    return readFileSync(outPath);
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

export async function transcribeWithFasterWhisper(
  wavBytes: Buffer,
  opts: { model?: string; language?: string; timeoutMs?: number } = {},
): Promise<{ text: string; segments: TranscriptSegmentV1[]; model: string } | null> {
  const model = opts.model || process.env.AION_WHISPER_MODEL?.trim() || "tiny.en";
  const language = opts.language || "en";
  const dir = join(tmpdir(), `aion-fw-${randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const wavPath = join(dir, "audio.wav");
  const outJson = join(dir, "out.json");
  const pyPath = join(dir, "run_fw.py");
  const script = [
    "import json, sys",
    "try:",
    "    from faster_whisper import WhisperModel",
    "except Exception as e:",
    "    print('IMPORT_FAIL:'+str(e), file=sys.stderr)",
    "    sys.exit(2)",
    "wav, out, model_name, lang = sys.argv[1:5]",
    "model = WhisperModel(model_name, device='cpu', compute_type='int8')",
    "segments, info = model.transcribe(wav, language=lang if lang else None, beam_size=1)",
    "rows = []",
    "full = []",
    "for s in segments:",
    "    t = (s.text or '').strip()",
    "    if not t: continue",
    "    full.append(t)",
    "    rows.append({",
    "        'startMs': int(max(0, (s.start or 0) * 1000)),",
    "        'endMs': int(max(0, (s.end or 0) * 1000)),",
    "        'speaker': 'UNKNOWN',",
    "        'text': t,",
    "        'confidence': float(s.avg_logprob) if s.avg_logprob is not None else None,",
    "    })",
    "open(out, 'w', encoding='utf-8').write(json.dumps({",
    "    'text': ' '.join(full).strip(),",
    "    'segments': rows,",
    "    'language': getattr(info, 'language', lang),",
    "}))",
  ].join("\n");
  try {
    writeFileSync(wavPath, wavBytes);
    writeFileSync(pyPath, script, "utf8");
    const py = process.env.AION_PYTHON?.trim() || "python";
    const r = await runProcess(py, [pyPath, wavPath, outJson, model, language], {
      timeoutMs: opts.timeoutMs ?? 300_000,
    });
    if (r.code !== 0 || !existsSync(outJson)) return null;
    const parsed = JSON.parse(readFileSync(outJson, "utf8")) as {
      text?: string;
      segments?: Array<{
        startMs: number;
        endMs: number;
        text: string;
        confidence?: number | null;
      }>;
    };
    const segments: TranscriptSegmentV1[] = (parsed.segments || []).map((s) => ({
      startMs: Number(s.startMs) || 0,
      endMs: Number(s.endMs) || 0,
      speaker: "UNKNOWN",
      text: String(s.text || "").slice(0, 8000),
      confidence:
        typeof s.confidence === "number"
          ? Math.max(0, Math.min(100, Math.round((s.confidence + 1) * 50)))
          : null,
    }));
    return { text: String(parsed.text || "").trim(), segments, model };
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

export async function transcribeWithWhisperCli(
  wavBytes: Buffer,
  opts: { timeoutMs?: number } = {},
): Promise<{ text: string; model: string } | null> {
  const cmd = process.env.AION_WHISPER_CMD?.trim();
  if (!cmd) return null;
  const dir = join(tmpdir(), `aion-wcli-${randomBytes(6).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  const wavPath = join(dir, "audio.wav");
  try {
    writeFileSync(wavPath, wavBytes);
    const r = await runProcess(cmd, [wavPath], { timeoutMs: opts.timeoutMs ?? 300_000 });
    if (r.code !== 0) return null;
    const text = r.stdout.trim();
    return { text, model: process.env.AION_WHISPER_MODEL?.trim() || "cli" };
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

/** Full host pipeline: decode → whisper. Returns null if no engine works. */
export async function runLocalTranscription(
  bytes: Buffer,
  mimeType: string,
): Promise<{
  engine: string;
  model: string | null;
  text: string;
  segments: TranscriptSegmentV1[];
} | null> {
  const wav = await decodeAudioToWav16k(bytes, mimeType);
  if (!wav) return null;
  const cli = await transcribeWithWhisperCli(wav);
  if (cli) {
    return { engine: "whisper-cli", model: cli.model, text: cli.text || "", segments: [] };
  }
  const fw = await transcribeWithFasterWhisper(wav);
  if (fw) {
    return { engine: "faster-whisper", model: fw.model, text: fw.text || "", segments: fw.segments };
  }
  return null;
}
