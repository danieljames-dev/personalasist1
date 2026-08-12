/**
 * Audio transcription foundation (Grok).
 *
 * Produces evidence-grade transcripts only — never customer identity, needs, or CRM writes.
 * Claude (or other intelligence) consumes the structured transcript contract.
 *
 * Process execution (ffmpeg / faster-whisper) lives in connectors/local-whisper.ts.
 */
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { runLocalTranscription } from "./connectors/local-whisper.js";

export const TRANSCRIPT_SCHEMA_V1 = "aion.transcript.v1" as const;

export type TranscriptSpeakerV1 = "UNKNOWN" | "SPEAKER_1" | "SPEAKER_2" | "SPEAKER_3" | "SPEAKER_4";

export type TranscriptEngineCodeV1 =
  | "READY"
  | "TRANSCRIPTION_PROVIDER_REQUIRED"
  | "UNSUPPORTED_AUDIO_TYPE"
  | "TRANSCRIPTION_FAILED"
  | "EMPTY_AUDIO";

export interface TranscriptSegmentV1 {
  startMs: number;
  endMs: number;
  speaker: TranscriptSpeakerV1;
  text: string;
  confidence: number | null;
}

export interface TranscriptRecordV1 {
  schema: typeof TRANSCRIPT_SCHEMA_V1;
  transcriptId: string;
  sourceRef: string;
  workspace: string;
  conversationId: string | null;
  startedAt: string;
  durationMs: number | null;
  language: string;
  engine: string;
  model: string | null;
  /** Overall confidence 0–100 when engine provides it; null if unknown. */
  confidence: number | null;
  /** Fallible speech text — not Owner/customer factual truth. */
  fullText: string;
  segments: TranscriptSegmentV1[];
  /** Private intake path ref only — never bytes. */
  audioSourceRef: string;
  mimeType: string;
  byteLength: number;
  status: TranscriptEngineCodeV1;
  message: string;
  /** Explicit: transcripts do not auto-become CRM/customer facts. */
  factualAuthority: "NONE";
}

export interface AudioIntakeMetaV1 {
  sourceRef: string;
  filename: string;
  mimeType: string;
  byteLength: number;
  durationMs: number | null;
  createdAt: string;
  workspace: string;
  conversationId: string | null;
  contentHash: string;
}

/** Safe audio types for private intake + transcription (browser/runtime common). */
export const SUPPORTED_AUDIO_MIME_V1 = [
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
] as const;

export const SUPPORTED_AUDIO_EXT_V1 = [
  ".wav",
  ".mp3",
  ".m4a",
  ".webm",
  ".ogg",
  ".flac",
  ".mpeg",
] as const;

export function isSupportedAudioType(mimeType: string, filename = ""): boolean {
  const mime = String(mimeType || "").toLowerCase().split(";")[0]!.trim();
  const lower = String(filename || "").toLowerCase();
  // Reject non-audio containers even if extension is ambiguous (e.g. video/mp4).
  if (mime && !mime.startsWith("audio/") && mime !== "application/octet-stream") return false;
  if (SUPPORTED_AUDIO_MIME_V1.some((m) => mime === m || mime.startsWith(`${m}+`))) return true;
  if (mime.startsWith("audio/")) {
    if (!lower || SUPPORTED_AUDIO_EXT_V1.some((ext) => lower.endsWith(ext)) || lower.endsWith(".mp4")) {
      return true;
    }
  }
  return SUPPORTED_AUDIO_EXT_V1.some((ext) => lower.endsWith(ext));
}

export function hashAudioBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildAudioIntakeMeta(input: {
  sourceRef: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  workspace: string;
  conversationId?: string | null;
  createdAt: string;
  durationMs?: number | null;
}): AudioIntakeMetaV1 {
  return {
    sourceRef: input.sourceRef,
    filename: basename(input.filename).slice(0, 260),
    mimeType: String(input.mimeType).slice(0, 120),
    byteLength: input.bytes.byteLength,
    durationMs: input.durationMs ?? null,
    createdAt: input.createdAt,
    workspace: input.workspace,
    conversationId: input.conversationId ?? null,
    contentHash: hashAudioBytes(input.bytes),
  };
}

export function emptyTranscript(partial: {
  transcriptId: string;
  sourceRef: string;
  workspace: string;
  conversationId?: string | null;
  startedAt: string;
  audioSourceRef: string;
  mimeType: string;
  byteLength: number;
  status: TranscriptEngineCodeV1;
  message: string;
  engine?: string;
}): TranscriptRecordV1 {
  return {
    schema: TRANSCRIPT_SCHEMA_V1,
    transcriptId: partial.transcriptId,
    sourceRef: partial.sourceRef,
    workspace: partial.workspace,
    conversationId: partial.conversationId ?? null,
    startedAt: partial.startedAt,
    durationMs: null,
    language: "en",
    engine: partial.engine ?? "none",
    model: null,
    confidence: null,
    fullText: "",
    segments: [],
    audioSourceRef: partial.audioSourceRef,
    mimeType: partial.mimeType,
    byteLength: partial.byteLength,
    status: partial.status,
    message: partial.message,
    factualAuthority: "NONE",
  };
}

export function segmentsFromPlainText(
  text: string,
  opts: { durationMs?: number | null; confidence?: number | null } = {},
): TranscriptSegmentV1[] {
  const cleaned = String(text || "").trim();
  if (!cleaned) return [];
  const parts = cleaned
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const chunks = parts.length ? parts : [cleaned];
  const total = opts.durationMs && opts.durationMs > 0 ? opts.durationMs : chunks.length * 2000;
  const slice = Math.max(500, Math.floor(total / chunks.length));
  return chunks.map((t, i) => ({
    startMs: i * slice,
    endMs: Math.min(total, (i + 1) * slice),
    speaker: "UNKNOWN" as const,
    text: t.slice(0, 8000),
    confidence: opts.confidence ?? null,
  }));
}

export function buildTranscriptFromEngineText(input: {
  transcriptId: string;
  sourceRef: string;
  workspace: string;
  conversationId?: string | null;
  startedAt: string;
  audioSourceRef: string;
  mimeType: string;
  byteLength: number;
  engine: string;
  model: string | null;
  language?: string;
  fullText: string;
  segments?: TranscriptSegmentV1[];
  durationMs?: number | null;
  confidence?: number | null;
  status?: TranscriptEngineCodeV1;
  message?: string;
}): TranscriptRecordV1 {
  const fullText = String(input.fullText || "").trim().slice(0, 200_000);
  const segments =
    input.segments && input.segments.length
      ? input.segments
      : segmentsFromPlainText(fullText, {
          ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
          ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        });
  return {
    schema: TRANSCRIPT_SCHEMA_V1,
    transcriptId: input.transcriptId,
    sourceRef: input.sourceRef,
    workspace: input.workspace,
    conversationId: input.conversationId ?? null,
    startedAt: input.startedAt,
    durationMs: input.durationMs ?? (segments.length ? segments[segments.length - 1]!.endMs : null),
    language: input.language || "en",
    engine: input.engine,
    model: input.model,
    confidence: input.confidence ?? null,
    fullText,
    segments,
    audioSourceRef: input.audioSourceRef,
    mimeType: input.mimeType,
    byteLength: input.byteLength,
    status: input.status ?? (fullText ? "READY" : "TRANSCRIPTION_FAILED"),
    message:
      input.message
      ?? (fullText
        ? "Transcript is fallible speech text — not Owner or customer factual truth."
        : "No speech text extracted."),
    factualAuthority: "NONE",
  };
}

/**
 * Resolve local transcription engine preference.
 * Order: AION_WHISPER_CMD → faster-whisper Python → none.
 */
export function resolveTranscriptionEngineStatus(env: NodeJS.ProcessEnv = process.env): {
  code: TranscriptEngineCodeV1;
  engine: string;
  model: string | null;
  message: string;
} {
  if (env.AION_WHISPER_CMD?.trim()) {
    return {
      code: "READY",
      engine: "whisper-cli",
      model: env.AION_WHISPER_MODEL?.trim() || "configured",
      message: "External whisper CLI configured via AION_WHISPER_CMD.",
    };
  }
  return {
    code: "READY",
    engine: "faster-whisper|whisper-cli|fixture",
    model: env.AION_WHISPER_MODEL?.trim() || "tiny.en",
    message:
      "Local transcription preferred (faster-whisper or AION_WHISPER_CMD). Falls closed if no engine works.",
  };
}

/**
 * Full local transcription pipeline: validate type → host decode/STT → transcript record.
 * Never invents customer facts.
 */
export async function transcribeAudioBytes(input: {
  bytes: Buffer;
  mimeType: string;
  filename?: string;
  transcriptId: string;
  sourceRef: string;
  workspace: string;
  conversationId?: string | null;
  startedAt: string;
  audioSourceRef: string;
  /** Tests: inject text without engine. */
  fixtureText?: string;
  offline?: boolean;
}): Promise<TranscriptRecordV1> {
  const base = {
    transcriptId: input.transcriptId,
    sourceRef: input.sourceRef,
    workspace: input.workspace,
    conversationId: input.conversationId ?? null,
    startedAt: input.startedAt,
    audioSourceRef: input.audioSourceRef,
    mimeType: input.mimeType,
    byteLength: input.bytes.byteLength,
  };

  if (!input.bytes.length) {
    return emptyTranscript({
      ...base,
      status: "EMPTY_AUDIO",
      message: "Audio upload is empty.",
    });
  }

  if (!isSupportedAudioType(input.mimeType, input.filename || "")) {
    return emptyTranscript({
      ...base,
      status: "UNSUPPORTED_AUDIO_TYPE",
      message: `Unsupported audio type (${input.mimeType || "unknown"}). Use wav, mp3, m4a, webm, ogg, or flac.`,
    });
  }

  if (input.fixtureText !== undefined) {
    return buildTranscriptFromEngineText({
      ...base,
      engine: "fixture",
      model: "test",
      fullText: input.fixtureText,
      confidence: 90,
      message: "Fixture transcript (tests only) — not factual authority.",
    });
  }

  if (input.offline) {
    return emptyTranscript({
      ...base,
      status: "TRANSCRIPTION_PROVIDER_REQUIRED",
      message: "Offline mode: transcription engine not invoked.",
      engine: "offline",
    });
  }

  const host = await runLocalTranscription(input.bytes, input.mimeType);
  if (host) {
    return buildTranscriptFromEngineText({
      ...base,
      engine: host.engine,
      model: host.model,
      fullText: host.text || "",
      segments: host.segments,
      status: "READY",
      message: host.text
        ? "Transcript is fallible speech text — not Owner or customer factual truth."
        : "Engine ran; no speech detected in audio.",
    });
  }

  return emptyTranscript({
    ...base,
    status: "TRANSCRIPTION_PROVIDER_REQUIRED",
    message:
      "No local transcription engine succeeded. Install faster-whisper (Python) or set AION_WHISPER_CMD. Audio remains stored privately.",
    engine: "none",
  });
}
