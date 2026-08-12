/**
 * Conversation evidence, and the careful extraction of claims from it.
 *
 * A transcript is evidence, not truth. Speech-to-text mishears numbers, people talk over each other,
 * and a model asked to summarise will happily produce a confident sentence about a customer who
 * never said it. AION has already been bitten by the equivalent in vision: when the provider failed,
 * its own diagnostic string was mined for VINs and produced a candidate assembled from an error
 * message. The same failure here writes a budget into a customer's record.
 *
 * So: a failed extraction yields nothing at all, every derived claim cites the segment it came from,
 * and hedged language produces a question for the Owner rather than a fact.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { CustomerIdentityResolutionV1 } from "./customer-identity.js";

export type ConversationChannelV1 =
  | "PHONE_CALL" | "EMAIL" | "SMS" | "IN_PERSON" | "OWNER_NOTE" | "AION_CHAT" | "CRM_EVENT";

export type ConversationDirectionV1 = "INBOUND" | "OUTBOUND" | "INTERNAL";

export interface ConversationSegmentV1 {
  index: number;
  speaker: "OWNER" | "CUSTOMER" | "THIRD_PARTY" | "UNKNOWN";
  text: string;
  startMs: number | null;
}

export interface ConversationEventV1 {
  id: OpaqueId;
  workspace: string;
  channel: ConversationChannelV1;
  direction: ConversationDirectionV1;
  occurredAt: IsoTimestamp;
  capturedAt: IsoTimestamp;
  identity: CustomerIdentityResolutionV1;
  /** Reference to the stored original. Bodies live in private document storage, not inline. */
  evidenceRef: string | null;
  segments: ConversationSegmentV1[];
  summary: string;
  extraction: { provider: string; ok: boolean; confidence: number };
  derived: { needIds: OpaqueId[]; commitmentIds: OpaqueId[]; proposalIds: OpaqueId[] };
  correctedAt: IsoTimestamp | null;
  correctionNote: string | null;
}

/** A citation an Owner can follow back to the words that produced a claim. */
export function segmentRef(eventId: string, index: number): string {
  return `conversation:${eventId}#${index}`;
}

// ---------------------------------------------------------------------------
// Commitments
// ---------------------------------------------------------------------------

export type CommitmentPartyV1 = "OWNER_PROMISED" | "CUSTOMER_PROMISED" | "UNCERTAIN";

export interface CommitmentCandidateV1 {
  party: CommitmentPartyV1;
  statement: string;
  /** Relative timing the speaker used, e.g. "this afternoon". Never converted to a date here. */
  timeHint: string | null;
  confidence: number;
  sourceRef: string;
  /** Why this was or was not treated as a promise. */
  reason: string;
}

/** First person, future, definite. "I'll send", "I will call", "let me get you". */
const OWNER_PROMISE = /\b(?:i(?:'| wi)ll|i am going to|i'm going to|let me)\s+(\w[\w\s'-]{2,60})/i;
/** Second/third person definite. "You'll bring", "he will send". */
const CUSTOMER_PROMISE = /\b(?:you(?:'| wi)ll|you are going to|you're going to|(?:he|she|they)(?:'| wi)ll)\s+(\w[\w\s'-]{2,60})/i;

/**
 * Hedges. Their presence is decisive, not merely a confidence penalty.
 *
 * "Maybe I'll stop by this weekend" must never become an appointment. A follow-up queue full of
 * things nobody actually promised trains the Owner to ignore the queue, which costs more than the
 * missed reminder ever would.
 */
const HEDGE = /\b(?:maybe|might|probably|possibly|i think|we'll see|if i can|hopefully|at some point|one of these|sometime|perhaps|no promises|try to|hope to)\b/i;

const TIME_HINT = /\b(?:this (?:morning|afternoon|evening|week|weekend)|tomorrow|tonight|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|by (?:the end of )?(?:the )?(?:day|week)|in an hour|later today)\b/i;

/**
 * Propose commitments from one segment.
 *
 * Deliberately returns *candidates*. Nothing here becomes a durable commitment without the Owner
 * confirming, because the cost of a false promise in the queue is higher than the cost of one extra
 * confirmation tap.
 */
export function proposeCommitments(input: {
  segment: ConversationSegmentV1;
  eventId: string;
}): CommitmentCandidateV1[] {
  const text = String(input.segment.text ?? "").trim();
  if (!text) return [];
  const sourceRef = segmentRef(input.eventId, input.segment.index);
  const out: CommitmentCandidateV1[] = [];

  const hedged = HEDGE.test(text);
  const timeHint = text.match(TIME_HINT)?.[0] ?? null;

  const owner = text.match(OWNER_PROMISE);
  const customer = text.match(CUSTOMER_PROMISE);

  const consider = (party: CommitmentPartyV1, match: RegExpMatchArray | null) => {
    if (!match) return;
    const statement = match[0].trim().replace(/\s+/g, " ").slice(0, 200);
    if (hedged) {
      out.push({
        party: "UNCERTAIN",
        statement,
        timeHint,
        confidence: 20,
        sourceRef,
        reason: "hedged language — recorded as something said, not as a promise",
      });
      return;
    }
    out.push({
      party,
      statement,
      timeHint,
      // A definite statement with a stated time is a much stronger promise than one without.
      confidence: timeHint ? 85 : 65,
      sourceRef,
      reason: timeHint ? "definite language with a stated time" : "definite language, no time given",
    });
  };

  // Speaker attribution beats grammar when we know who was talking.
  if (input.segment.speaker === "OWNER") consider("OWNER_PROMISED", owner);
  else if (input.segment.speaker === "CUSTOMER") consider("CUSTOMER_PROMISED", owner);
  else consider("OWNER_PROMISED", owner);
  consider(input.segment.speaker === "OWNER" ? "CUSTOMER_PROMISED" : "OWNER_PROMISED", customer);

  return out;
}

/** Only definite, attributed candidates are strong enough to offer as real commitments. */
export function isConfirmableCommitment(candidate: CommitmentCandidateV1): boolean {
  return candidate.party !== "UNCERTAIN" && candidate.confidence >= 65;
}

/**
 * Extract across a whole event.
 *
 * A failed extraction produces nothing. This is the vision lesson applied: unreliable output is not
 * weak evidence about a customer, it is no evidence about a customer.
 */
export function extractFromEvent(event: ConversationEventV1): {
  commitments: CommitmentCandidateV1[];
  blocked: string | null;
} {
  if (!event.extraction.ok) {
    return { commitments: [], blocked: "extraction failed — no facts or commitments derived" };
  }
  if (event.identity.state !== "RESOLVED") {
    // Evidence is kept; attribution is not invented. An unattached conversation is recoverable.
    return { commitments: [], blocked: "customer not identified — evidence stored, nothing attributed" };
  }
  const commitments = event.segments.flatMap((segment) => proposeCommitments({ segment, eventId: event.id }));
  return { commitments, blocked: null };
}
