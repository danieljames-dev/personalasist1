/**
 * Transcript → conversation event.
 *
 * A deliberately small, explicit adapter. The two contracts are close, and the temptation is to map
 * them loosely; the one place that must not be loose is the speaker.
 *
 * Speech-to-text diarisation produces `SPEAKER_1`, `SPEAKER_2`, `UNKNOWN`. It does not know which of
 * those is the Owner. Guessing — from who spoke first, from who spoke most, or from what was said —
 * would attribute promises to the wrong party, and "I'll send you pictures this afternoon" landing
 * on the customer instead of the Owner is a follow-up that never happens. So a speaker becomes
 * OWNER or CUSTOMER only when the caller supplies grounded binding, and stays UNKNOWN otherwise.
 *
 * Channel is treated the same way: an uploaded audio file is not a phone call merely because it
 * contains speech.
 */
import type { ConversationChannelV1, ConversationEventV1, ConversationSegmentV1 } from "./conversation-event.js";
import type { CustomerIdentityResolutionV1 } from "./customer-identity.js";
import type { TranscriptRecordV1, TranscriptSpeakerV1 } from "./audio-transcription.js";

/** How the audio reached AION. The ingestion path is grounded; the audio's content is not. */
export type AudioIngestPathV1 =
  | "UPLOADED_CALL_RECORDING"
  | "CHAT_MICROPHONE"
  | "UPLOADED_AUDIO";

/**
 * Grounded binding of diarisation labels to real roles.
 *
 * Supplied by the caller from something it actually knows — the Owner tapped "this is me", a VoIP
 * leg identifies the direction, or the Owner selected the mapping after listening. Never inferred
 * from the transcript.
 */
export interface SpeakerBindingV1 {
  owner?: TranscriptSpeakerV1 | null;
  customer?: TranscriptSpeakerV1 | null;
}

export interface TranscriptAdapterInputV1 {
  transcript: TranscriptRecordV1;
  identity: CustomerIdentityResolutionV1;
  ingestPath: AudioIngestPathV1;
  /** Absent or partial binding leaves speakers UNKNOWN. */
  speakerBinding?: SpeakerBindingV1;
  eventId: string;
  capturedAt: string;
}

function channelFor(path: AudioIngestPathV1): ConversationChannelV1 {
  switch (path) {
    case "UPLOADED_CALL_RECORDING": return "PHONE_CALL";
    case "CHAT_MICROPHONE": return "AION_CHAT";
    // A file of speech is not a call. Without an explicit signal, the honest channel is the generic
    // one — calling everything PHONE_CALL would put dictated notes into a call history.
    default: return "OWNER_NOTE";
  }
}

function mapSpeaker(
  raw: TranscriptSpeakerV1,
  binding: SpeakerBindingV1 | undefined,
): ConversationSegmentV1["speaker"] {
  if (!binding) return "UNKNOWN";
  if (binding.owner && raw === binding.owner) return "OWNER";
  if (binding.customer && raw === binding.customer) return "CUSTOMER";
  // A label the caller did not bind stays unknown, even when the other label is bound. Two speakers
  // is a common assumption and a wrong one — a manager, a spouse, or a colleague may be on the call.
  return "UNKNOWN";
}

/**
 * Build a conversation event from a transcript.
 *
 * The transcript is referenced, not copied: `evidenceRef` points at the stored transcript and
 * `audioSourceRef` at the private intake path. Segment text is carried because the extraction layer
 * needs the words, but the full text is not duplicated a third time into `summary`.
 */
export function conversationEventFromTranscript(input: TranscriptAdapterInputV1): ConversationEventV1 {
  const t = input.transcript;
  const segments: ConversationSegmentV1[] = t.segments.map((seg, index) => ({
    index,
    speaker: mapSpeaker(seg.speaker, input.speakerBinding),
    text: String(seg.text ?? ""),
    startMs: Number.isFinite(seg.startMs) ? seg.startMs : null,
  }));

  // A transcript that failed is not weak evidence about a customer; it is no evidence about one.
  const ok = t.status === "READY" && Boolean(String(t.fullText ?? "").trim());

  // faster-whisper reports per-segment confidence but no overall figure, so a live transcript would
  // otherwise arrive here as confidence 0 — indistinguishable from an engine that was sure it had
  // heard nothing. The mean of what the engine did report is the honest summary of it.
  const perSegment = t.segments
    .map((s) => s.confidence)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  const meanConfidence = perSegment.length
    ? Math.round(perSegment.reduce((sum, c) => sum + c, 0) / perSegment.length)
    : 0;

  return {
    id: input.eventId,
    workspace: t.workspace,
    channel: channelFor(input.ingestPath),
    // Direction is not knowable from audio alone. Callers that know it can override afterwards.
    direction: input.ingestPath === "CHAT_MICROPHONE" ? "INTERNAL" : "INBOUND",
    occurredAt: t.startedAt,
    capturedAt: input.capturedAt,
    identity: input.identity,
    evidenceRef: `transcript:${t.transcriptId}`,
    segments,
    summary: "",
    extraction: {
      provider: t.model ? `${t.engine}:${t.model}` : t.engine,
      ok,
      confidence: typeof t.confidence === "number" ? t.confidence : meanConfidence,
    },
    derived: { needIds: [], commitmentIds: [], proposalIds: [] },
    correctedAt: null,
    correctionNote: null,
  };
}

/** True when at least one speaker is grounded, so attribution is meaningful. */
export function hasGroundedSpeakers(event: ConversationEventV1): boolean {
  return event.segments.some((s) => s.speaker === "OWNER" || s.speaker === "CUSTOMER");
}

/**
 * What the Owner should be told about an ungrounded transcript.
 *
 * Silence here would be worse than the limitation: the Owner would assume the promises were
 * attributed and never check.
 */
export function describeSpeakerGrounding(event: ConversationEventV1): string | null {
  if (hasGroundedSpeakers(event)) return null;
  return "I couldn't tell who was speaking, so I haven't attributed anything either of you said. "
    + "Tell me which voice is yours and I'll sort the promises out.";
}
