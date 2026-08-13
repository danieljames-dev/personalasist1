/**
 * Holding a conversation: remembering what "this" means, and sounding like something worth talking to.
 *
 * The Owner's verdict after a day of real use was that AION did not feel personally useful. Two
 * concrete things sit under that.
 *
 * It forgot the subject. After photos identified a car, "what about the price?" had no idea which
 * car, so the Owner had to re-enter a VIN he had just photographed. A person you have to re-introduce
 * yourself to every sentence is not a person you keep talking to.
 *
 * And it answered like a console. Correct output, no read on what the Owner was actually trying to
 * do next.
 *
 * ## Focus decays; it does not persist
 *
 * The subject of a conversation is not a session variable. It goes stale — the Owner walks to the
 * next car, and "this one" now means something different. So focus carries a timestamp and a turn
 * count, and expires. A wrong referent is worse than an absent one: an absent referent asks a
 * question, a wrong one confidently answers about the previous car.
 *
 * Workspace is part of the key. A vehicle in focus does not survive a switch to Personal.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";

export const CONVERSATION_FOCUS_SCHEMA_V1 = "aion.conversation-focus.v1" as const;

export interface ConversationFocusV1 {
  schema: typeof CONVERSATION_FOCUS_SCHEMA_V1;
  workspace: string;
  conversationId: string | null;
  vehicleRef: OpaqueId | null;
  vehicleLabel: string | null;
  vin: string | null;
  customerRef: OpaqueId | null;
  customerName: string | null;
  setAt: IsoTimestamp;
  /** Turns since this was set. Focus is a recency claim, not a fact about the world. */
  turnsSinceSet: number;
}

/** After this many turns, "this one" is more likely to mean something new than the old subject. */
export const FOCUS_MAX_TURNS = 8;
/** And after this long, the Owner has almost certainly walked to another car. */
export const FOCUS_MAX_MINUTES = 45;

export function setVehicleFocus(input: {
  workspace: string;
  conversationId?: string | null;
  vehicleRef: string;
  vehicleLabel: string;
  vin?: string | null;
  at: IsoTimestamp;
  previous?: ConversationFocusV1 | null;
}): ConversationFocusV1 {
  return {
    schema: CONVERSATION_FOCUS_SCHEMA_V1,
    workspace: input.workspace,
    conversationId: input.conversationId ?? null,
    vehicleRef: input.vehicleRef,
    vehicleLabel: input.vehicleLabel,
    vin: input.vin ?? null,
    // A new vehicle does not clear the customer being discussed — "would she like this one?" is
    // one of the most useful things the Owner can ask, and it needs both.
    customerRef: input.previous?.customerRef ?? null,
    customerName: input.previous?.customerName ?? null,
    setAt: input.at,
    turnsSinceSet: 0,
  };
}

export function setCustomerFocus(input: {
  workspace: string;
  conversationId?: string | null;
  customerRef: string;
  customerName: string;
  at: IsoTimestamp;
  previous?: ConversationFocusV1 | null;
}): ConversationFocusV1 {
  return {
    schema: CONVERSATION_FOCUS_SCHEMA_V1,
    workspace: input.workspace,
    conversationId: input.conversationId ?? null,
    vehicleRef: input.previous?.vehicleRef ?? null,
    vehicleLabel: input.previous?.vehicleLabel ?? null,
    vin: input.previous?.vin ?? null,
    customerRef: input.customerRef,
    customerName: input.customerName,
    setAt: input.at,
    turnsSinceSet: 0,
  };
}

export function advanceFocus(focus: ConversationFocusV1 | null): ConversationFocusV1 | null {
  return focus ? { ...focus, turnsSinceSet: focus.turnsSinceSet + 1 } : null;
}

export function focusIsFresh(focus: ConversationFocusV1 | null, now: IsoTimestamp, workspace: string): boolean {
  if (!focus) return false;
  if (focus.workspace !== workspace) return false;
  if (focus.turnsSinceSet > FOCUS_MAX_TURNS) return false;
  const minutes = (Date.parse(now) - Date.parse(focus.setAt)) / 60_000;
  return Number.isFinite(minutes) && minutes <= FOCUS_MAX_MINUTES;
}

// ---------------------------------------------------------------------------
// Resolving a referent
// ---------------------------------------------------------------------------

/** Phrases that point at whatever is already being discussed rather than naming it. */
const VEHICLE_REFERENT = /\b(?:this|that|it|this one|that one|the car|the vehicle|this car|this vehicle)\b/i;
const CUSTOMER_REFERENT = /\b(?:her|him|them|they|she|he|this customer|that customer)\b/i;

export interface ReferentResolutionV1 {
  vehicleRef: OpaqueId | null;
  customerRef: OpaqueId | null;
  /** What AION should say when a referent was used but nothing is in focus. */
  clarification: string | null;
  usedFocus: boolean;
}

/**
 * Work out what "this" means.
 *
 * When a referent is used and focus is stale, the answer is a question rather than a guess. That
 * asymmetry is the whole design: the cost of asking is one line, and the cost of guessing is a
 * confident answer about the wrong car.
 */
export function resolveReferents(input: {
  text: string;
  focus: ConversationFocusV1 | null;
  now: IsoTimestamp;
  workspace: string;
}): ReferentResolutionV1 {
  const fresh = focusIsFresh(input.focus, input.now, input.workspace);
  const focus = fresh ? input.focus! : null;

  const wantsVehicle = VEHICLE_REFERENT.test(input.text);
  const wantsCustomer = CUSTOMER_REFERENT.test(input.text);

  if (wantsVehicle && !focus?.vehicleRef) {
    return {
      vehicleRef: null, customerRef: focus?.customerRef ?? null, usedFocus: false,
      clarification: input.focus
        ? "We were talking about a car a while back — which one do you mean now?"
        : "Which vehicle do you mean? Photograph it or give me the VIN and I'll pick it up.",
    };
  }
  if (wantsCustomer && !focus?.customerRef) {
    return {
      vehicleRef: focus?.vehicleRef ?? null, customerRef: null, usedFocus: false,
      clarification: "Which customer do you mean?",
    };
  }

  return {
    vehicleRef: wantsVehicle ? focus?.vehicleRef ?? null : focus?.vehicleRef ?? null,
    customerRef: wantsCustomer ? focus?.customerRef ?? null : focus?.customerRef ?? null,
    clarification: null,
    usedFocus: Boolean(focus) && (wantsVehicle || wantsCustomer),
  };
}

// ---------------------------------------------------------------------------
// Personality
// ---------------------------------------------------------------------------

export const AION_PERSONALITY_SCHEMA_V1 = "aion.personality.v1" as const;

/**
 * How AION talks.
 *
 * Written as a contract rather than a prompt string so it can be tested. The prohibitions matter
 * more than the aspirations: "be helpful" is unfalsifiable, whereas "never open by restating the
 * question" is something a test can check.
 */
export interface AionPersonalityV1 {
  schema: typeof AION_PERSONALITY_SCHEMA_V1;
  traits: string[];
  /** Things AION should never sound like. Each is a real failure seen in the Owner's transcripts. */
  avoid: string[];
  /** Default reply length, in sentences, before the Owner asks for more. */
  defaultBrevitySentences: number;
  /** Say it plainly when the answer is not known. */
  admitsUncertainty: true;
  /** Offer the next useful step when one genuinely exists — and only then. */
  offersNextStep: true;
}

export function aionPersonality(): AionPersonalityV1 {
  return {
    schema: AION_PERSONALITY_SCHEMA_V1,
    traits: [
      "capable", "calm", "practical", "context-aware", "concise by default",
      "proactive without being pushy", "comfortable saying it does not know",
    ],
    avoid: [
      "debug console output",
      "database or record dumps",
      "generic customer-service phrasing",
      "legal disclaimer padding",
      "restating the question before answering it",
      "repeating what was said one turn ago",
      "inventing a next step to look useful",
    ],
    defaultBrevitySentences: 4,
    admitsUncertainty: true,
    offersNextStep: true,
  };
}

/** Openers that waste the first line of a reply on a phone screen. */
const FILLER_OPENERS: RegExp[] = [
  /^\s*(?:great|good|excellent)\s+question\b/i,
  /^\s*(?:sure|certainly|of course|absolutely)[,!.]/i,
  /^\s*i (?:can|will|would be happy to) help\b/i,
  /^\s*(?:as an ai|i'm an ai)\b/i,
  /^\s*(?:let me|i'll) (?:check|look into) that for you\b/i,
  /^\s*based on (?:the )?(?:available )?(?:data|information)\b/i,
];

/** Internal vocabulary that should never reach the Owner. */
const INTERNAL_LEAKS: RegExp[] = [
  /\b[A-Za-z]+V1\b/,
  /\b(?:sourceRef|relationshipRef|vehicleRef|customerRef|idempotencyKey|workspaceId)\b/,
  /\b(?:HARD_REQUIREMENT|PREFERENCE|EXCLUSION|OWNER_PROMISED|CUSTOMER_PROMISED|UNRESOLVED|PROPOSED)\b/,
  /\bconversation:[\w-]+#\d+/,
];

export interface StyleReviewV1 {
  ok: boolean;
  problems: string[];
}

/**
 * Check a reply against the personality contract.
 *
 * Exists so style is enforced by a test rather than by whoever last edited a prompt.
 */
export function reviewReplyStyle(reply: string): StyleReviewV1 {
  const text = String(reply ?? "");
  const problems: string[] = [];
  if (FILLER_OPENERS.some((p) => p.test(text))) problems.push("opens with filler instead of the answer");
  for (const leak of INTERNAL_LEAKS) {
    if (leak.test(text)) { problems.push("leaks internal vocabulary"); break; }
  }
  if (/\b(?:I am an AI|I cannot browse|as a language model)\b/i.test(text)) {
    problems.push("talks about itself instead of the work");
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Whether a next step is worth offering.
 *
 * Returns null rather than a filler suggestion. "Let me know if you need anything else" is the
 * phrase that teaches an Owner to stop reading the last line.
 */
export function nextStepOrNothing(candidates: readonly string[]): string | null {
  const real = candidates.map((c) => c.trim()).filter(Boolean);
  return real.length ? real[0]! : null;
}
