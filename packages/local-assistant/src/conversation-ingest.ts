/**
 * The join: a real transcript becomes a conversation, and everything that follows from it.
 *
 * Every piece this composes already existed and was tested in isolation — the adapter, the identity
 * resolver, the need extractor, the commitment reader, the proposal builder. What did not exist was
 * anything that ran them in order against a transcript the microphone actually produced. That gap is
 * not cosmetic: a pipeline whose parts all pass individually can still be wrong at the seams, and the
 * seams here are where a stranger's budget gets written into a real customer's record.
 *
 * Three rules hold the seams together.
 *
 * **Identity gates attribution, not capture.** An unidentified call is still recorded in full. What
 * it does not get is a customer to hang needs, promises and CRM proposals on. Evidence is cheap to
 * keep and impossible to recover once discarded; attribution is the opposite.
 *
 * **Ids are derived, not generated.** Re-processing the same audio must not double a customer's
 * needs. Every id here is a function of the transcript id, so the second run writes the same records
 * over the first rather than beside them. A counter would have made reprocessing silently additive,
 * which is the failure that looks like data.
 *
 * **Extraction reads a normalised copy; storage keeps the original.** Speech-to-text emits
 * typographic apostrophes, and `don’t want` does not match a rule written for `don't want` — an
 * exclusion would quietly become a preference. The words the Owner can read back are the engine's;
 * only the copy the regexes see is normalised.
 */
import type { CommitmentCandidateV1, ConversationEventV1 } from "./conversation-event.js";
import { extractFromEvent, isConfirmableCommitment } from "./conversation-event.js";
import type { CrmActionProposalV1 } from "./crm-action-proposal.js";
import { buildCrmActionProposal } from "./crm-action-proposal.js";
import type { CustomerIdentityResolutionV1 } from "./customer-identity.js";
import { isSafeToAttribute } from "./customer-identity.js";
import type { CustomerNeedV1 } from "./customer-needs.js";
import { recordNeed } from "./customer-needs.js";
import type { ExtractedNeedV1 } from "./need-extraction.js";
import { extractNeedsFromSegments, toDurableNeeds } from "./need-extraction.js";
import type { TranscriptRecordV1 } from "./audio-transcription.js";
import type { AudioIngestPathV1, SpeakerBindingV1 } from "./transcript-conversation-adapter.js";
import { conversationEventFromTranscript, describeSpeakerGrounding } from "./transcript-conversation-adapter.js";

// ---------------------------------------------------------------------------
// Derived identifiers — the whole of idempotency
// ---------------------------------------------------------------------------

/**
 * One transcript yields one conversation, forever.
 *
 * Deriving rather than allocating is what makes re-processing safe: the second run produces the same
 * id and replaces the first record. Nothing downstream has to detect the duplicate, because there
 * never is one.
 */
export function conversationEventIdFor(transcriptId: string): string {
  return `conv-${String(transcriptId).trim()}`;
}

export function needIdFor(transcriptId: string, index: number): string {
  return `need-${String(transcriptId).trim()}-${index}`;
}

export function proposalIdFor(transcriptId: string, action: string): string {
  return `prop-${String(transcriptId).trim()}-${action}`;
}

/**
 * Normalise speech punctuation for pattern matching only.
 *
 * The apostrophe is the one that matters. Every negation, hedge and promise rule in this codebase is
 * written with an ASCII apostrophe, and an engine that emits U+2019 would slip "I don't want a
 * hybrid" past the exclusion rule and record it as a preference — the exact inversion that walks a
 * customer to a car they refused.
 */
export function normalizeSpeechText(text: string): string {
  return String(text ?? "")
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface ConversationIngestOutcomeV1 {
  event: ConversationEventV1;
  /**
   * Needs for this customer after supersession, ready to store whole.
   *
   * Empty when identity is not resolved — a need has to belong to someone.
   */
  needs: CustomerNeedV1[];
  /**
   * What was heard, whether or not it could be attributed.
   *
   * Kept separate from `needs` on purpose: an unidentified call still tells the Owner what the person
   * on the phone was after, and refusing to show that because the phone number was withheld would be
   * throwing away the useful half of the call.
   */
  observations: ExtractedNeedV1[];
  commitments: CommitmentCandidateV1[];
  proposals: CrmActionProposalV1[];
  /** Why something was not produced. Owner-readable, never silent. */
  refusals: string[];
  notes: string[];
  identity: CustomerIdentityResolutionV1;
}

export interface ConversationIngestInputV1 {
  transcript: TranscriptRecordV1;
  identity: CustomerIdentityResolutionV1;
  ingestPath: AudioIngestPathV1;
  speakerBinding?: SpeakerBindingV1;
  capturedAt: string;
  /** All stored needs. Only this customer's are folded; the rest are left untouched. */
  existingNeeds: readonly CustomerNeedV1[];
}

// ---------------------------------------------------------------------------
// Proposal text
// ---------------------------------------------------------------------------

function describeObservation(o: ExtractedNeedV1): string {
  const value = o.numericValue != null ? `$${o.numericValue.toLocaleString("en-US")}` : o.value;
  const shape =
    o.strength === "HARD_REQUIREMENT" ? "requires"
    : o.strength === "EXCLUSION" ? "rules out"
    : "prefers";
  return `${shape} ${o.attribute} ${value}`;
}

/**
 * The call note, built only from what was said.
 *
 * No inferred interest, no next-best-action, no sentiment. A note the Owner has to fact-check against
 * the recording is worse than no note, because they will not check it twice.
 */
function callNoteText(input: {
  observations: readonly ExtractedNeedV1[];
  commitments: readonly CommitmentCandidateV1[];
  transcript: TranscriptRecordV1;
}): string {
  const lines: string[] = [];
  if (input.observations.length) {
    lines.push(`Stated: ${input.observations.map(describeObservation).join("; ")}.`);
  }
  const owner = input.commitments.filter((c) => c.party === "OWNER_PROMISED");
  const customer = input.commitments.filter((c) => c.party === "CUSTOMER_PROMISED");
  if (owner.length) lines.push(`You said you would: ${owner.map((c) => c.statement).join("; ")}.`);
  if (customer.length) lines.push(`They said they would: ${customer.map((c) => c.statement).join("; ")}.`);
  if (!lines.length) lines.push("Call recorded; nothing specific enough to note.");
  lines.push(`Source: transcript ${input.transcript.transcriptId} (${input.transcript.engine}); speech evidence, not verified fact.`);
  return lines.join(" ");
}

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

/**
 * Run a transcript all the way through to proposals.
 *
 * Pure — no clock, no state access, no network. Everything time-dependent arrives as `capturedAt`,
 * which keeps the whole pipeline reproducible: the same transcript and the same stored needs always
 * produce the same records, which is what makes the idempotency claim testable rather than hopeful.
 */
export function ingestConversationFromTranscript(
  input: ConversationIngestInputV1,
): ConversationIngestOutcomeV1 {
  const transcript = input.transcript;
  const eventId = conversationEventIdFor(transcript.transcriptId);
  const refusals: string[] = [];
  const notes: string[] = [];

  const event = conversationEventFromTranscript({
    transcript,
    identity: input.identity,
    ingestPath: input.ingestPath,
    ...(input.speakerBinding ? { speakerBinding: input.speakerBinding } : {}),
    eventId,
    capturedAt: input.capturedAt,
  });

  // The copy the rules read. Segment indices are untouched, so every sourceRef still points at the
  // stored original.
  const readable: ConversationEventV1 = {
    ...event,
    segments: event.segments.map((s) => ({ ...s, text: normalizeSpeechText(s.text) })),
  };

  if (!event.extraction.ok) {
    refusals.push(
      `transcript ${transcript.status} — nothing derived. Unreliable output is not weak evidence about a customer, it is none.`,
    );
    return {
      event, needs: [], observations: [], commitments: [], proposals: [],
      refusals, notes, identity: input.identity,
    };
  }

  // Needs are read from every conversation, identified or not.
  const observations = extractNeedsFromSegments(readable.segments, eventId);

  const grounding = describeSpeakerGrounding(event);
  if (grounding) notes.push(grounding);

  const resolved = isSafeToAttribute(input.identity) && Boolean(input.identity.relationshipRef);
  if (!resolved) {
    refusals.push(
      `identity is ${input.identity.state} — the call is stored and ${observations.length} thing(s) heard, `
      + `but nothing is attached to a customer and no CRM action is proposed.`,
    );
    return {
      event, needs: [], observations, commitments: [], proposals: [],
      refusals, notes, identity: input.identity,
    };
  }

  const relationshipRef = input.identity.relationshipRef!;
  const workspace = transcript.workspace;

  // Durable needs, folded over what this customer already told us.
  const durable = toDurableNeeds({
    extracted: observations,
    workspace,
    relationshipRef,
    observedAt: transcript.startedAt,
    nextId: (n) => needIdFor(transcript.transcriptId, n),
  });

  // Anything this same transcript produced before is dropped before folding, so a second run
  // supersedes the same history the first run did rather than superseding its own output.
  const sourcePrefix = `conversation:${eventId}#`;
  let needs = input.existingNeeds.filter(
    (n) => n.relationshipRef === relationshipRef && !n.sourceRef.startsWith(sourcePrefix),
  );
  for (const incoming of durable) needs = recordNeed(needs, incoming);

  const extracted = extractFromEvent(readable);
  const commitments = extracted.commitments;
  if (extracted.blocked) notes.push(extracted.blocked);

  const unattributed = commitments.filter((c) => c.party === "UNCERTAIN");
  if (unattributed.length) {
    notes.push(
      `${unattributed.length} statement(s) sounded like a promise but I could not tell who said it, so nobody is on the hook for them yet.`,
    );
  }

  const proposals = buildProposals({
    transcript, event, identity: input.identity, workspace,
    observations, commitments, durable, capturedAt: input.capturedAt, refusals,
  });

  return { event, needs, observations, commitments, proposals, refusals, notes, identity: input.identity };
}

/**
 * PREPARE proposals only.
 *
 * Nothing here can write anywhere. Each is a reviewable object carrying its own evidence, which is
 * what the future browser worker consumes — and what the Owner approves before it ever runs.
 */
function buildProposals(input: {
  transcript: TranscriptRecordV1;
  event: ConversationEventV1;
  identity: CustomerIdentityResolutionV1;
  workspace: string;
  observations: readonly ExtractedNeedV1[];
  commitments: readonly CommitmentCandidateV1[];
  durable: readonly CustomerNeedV1[];
  capturedAt: string;
  refusals: string[];
}): CrmActionProposalV1[] {
  const out: CrmActionProposalV1[] = [];
  const transcriptRef = `transcript:${input.transcript.transcriptId}`;
  const segmentRefs = [...new Set(input.observations.map((o) => o.sourceRef))];
  const evidence = [transcriptRef, ...segmentRefs];

  const add = (
    action: "PREPARE_CALL_NOTE" | "PREPARE_FOLLOWUP" | "PREPARE_PREFERENCE_UPDATE",
    note: string,
    fields: Record<string, string>,
    sourceRefs: readonly string[],
    confidence: number,
    effect: string,
  ) => {
    const built = buildCrmActionProposal({
      proposalId: proposalIdFor(input.transcript.transcriptId, action),
      workspace: input.workspace,
      identity: input.identity,
      action,
      fields,
      note,
      sourceRefs,
      confidence,
      expectedExternalEffect: effect,
      now: input.capturedAt,
    });
    if ("refused" in built) input.refusals.push(`${action} refused — ${built.reason}`);
    else out.push(built);
  };

  add(
    "PREPARE_CALL_NOTE",
    callNoteText({ observations: input.observations, commitments: input.commitments, transcript: input.transcript }),
    { channel: input.event.channel, occurredAt: input.event.occurredAt },
    evidence,
    Math.max(50, Math.min(95, input.event.extraction.confidence || 70)),
    "Drafts a call note against this customer for your review. Nothing is sent or written anywhere until you approve it.",
  );

  if (input.durable.length) {
    const fields: Record<string, string> = {};
    for (const n of input.durable) {
      fields[n.attribute] = n.numericValue != null ? String(n.numericValue) : n.value;
    }
    add(
      "PREPARE_PREFERENCE_UPDATE",
      `Heard on this call: ${input.observations.map(describeObservation).join("; ")}.`,
      fields,
      evidence,
      Math.round(input.durable.reduce((sum, n) => sum + n.confidence, 0) / input.durable.length),
      `Prepares an update to this customer's recorded preferences (${Object.keys(fields).join(", ")}) for your review.`,
    );
  }

  // A follow-up is proposed only for a promise definite enough to have been made by a known party.
  // A queue containing things nobody actually committed to is a queue the Owner learns to ignore.
  const actionable = input.commitments.filter(isConfirmableCommitment);
  if (actionable.length) {
    const owner = actionable.filter((c) => c.party === "OWNER_PROMISED");
    const subject = owner.length ? owner : actionable;
    add(
      "PREPARE_FOLLOWUP",
      subject.map((c) => `${c.statement}${c.timeHint ? ` (${c.timeHint})` : ""}`).join("; "),
      {
        due: subject.find((c) => c.timeHint)?.timeHint ?? "",
        owed: owner.length ? "owner" : "customer",
      },
      [transcriptRef, ...subject.map((c) => c.sourceRef)],
      Math.round(subject.reduce((sum, c) => sum + c.confidence, 0) / subject.length),
      "Prepares a follow-up task for what was promised on this call, for your review.",
    );
  }

  return out;
}

/**
 * What to tell the Owner after a call is processed.
 *
 * Written as something a person would say. The refusals are included rather than hidden: an Owner who
 * is not told that the CRM proposal was withheld will assume it exists.
 */
export function describeIngestOutcome(outcome: ConversationIngestOutcomeV1): string {
  const lines: string[] = [];
  const heard = outcome.observations.length;

  if (!outcome.event.extraction.ok) {
    return "I couldn't get usable speech out of that recording, so I haven't derived anything from it. The audio is stored.";
  }

  lines.push(
    outcome.identity.state === "RESOLVED"
      ? `Processed the call. ${outcome.identity.message}`
      : `Processed the call, but I couldn't confirm who it was with. ${outcome.identity.message}`,
  );

  if (heard) {
    lines.push(
      `I heard ${heard} thing${heard === 1 ? "" : "s"} about what they're looking for`
      + (outcome.needs.length ? ` and recorded ${outcome.needs.filter((n) => !n.supersededAt && !n.invalidatedAt).length} as current.` : ", but haven't attached them to anyone."),
    );
  }

  const owner = outcome.commitments.filter((c) => c.party === "OWNER_PROMISED");
  if (owner.length) lines.push(`You owe them: ${owner.map((c) => c.statement).join("; ")}.`);

  if (outcome.proposals.length) {
    lines.push(
      `I've prepared ${outcome.proposals.length} thing${outcome.proposals.length === 1 ? "" : "s"} for your review: `
      + outcome.proposals.map((p) => p.action.replace(/^PREPARE_/, "").replace(/_/g, " ").toLowerCase()).join(", ")
      + ". Nothing has been written anywhere.",
    );
  }

  for (const note of outcome.notes) lines.push(note);
  for (const refusal of outcome.refusals) lines.push(refusal);

  return lines.join("\n");
}
