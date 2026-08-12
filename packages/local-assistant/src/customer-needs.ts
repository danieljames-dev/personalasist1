/**
 * What a customer wants, and what they used to want.
 *
 * A preference is not a field to overwrite. On Monday Sarah wants a Camry XSE; on Friday she says an
 * SUV instead. Both are true things she said, and a salesperson who can only see the second one has
 * lost the ability to answer "what changed?" — which is often the most useful question before a call.
 *
 * So a need is recorded once and never mutated. Newer grounded evidence *supersedes* older evidence,
 * and both remain readable. The history is the feature.
 *
 * Requirement strength is captured at observation time rather than guessed at match time, because
 * "it can't be a hybrid" and "I'd prefer dark blue" fail a vehicle in completely different ways: one
 * disqualifies, the other costs a few points.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";

export type NeedAttributeV1 =
  | "make" | "model" | "trim" | "condition" | "max-price" | "payment-target"
  | "color" | "powertrain" | "must-have" | "nice-to-have" | "must-not-have"
  | "trade-in" | "timeline" | "purchase-intent" | "objection";

export type NeedStrengthV1 = "HARD_REQUIREMENT" | "PREFERENCE" | "EXCLUSION" | "UNKNOWN";

/**
 * Where a need's authority comes from.
 *
 * An Owner correction outranks what a microphone heard, and the distinction has to survive storage:
 * once "she prefers a hybrid" and "she said no hybrids" are both on file, the only thing that decides
 * which one is current is which of them the Owner said out loud.
 */
export type NeedAuthorityV1 = "OBSERVED" | "OWNER_CORRECTION";

export interface CustomerNeedV1 {
  id: OpaqueId;
  workspace: string;
  relationshipRef: OpaqueId;
  attribute: NeedAttributeV1;
  /** Normalised comparable value. Numeric for prices, lowercase text otherwise. */
  value: string;
  /** Numeric form when the attribute is a price or payment. */
  numericValue: number | null;
  strength: NeedStrengthV1;
  confidence: number;
  /** Exactly where this came from, e.g. conversation:<id>#12. */
  sourceRef: string;
  observedAt: IsoTimestamp;
  supersededAt: IsoTimestamp | null;
  supersededBy: OpaqueId | null;
  /** Set when the Owner voids a need without replacing it. */
  invalidatedAt: IsoTimestamp | null;
  invalidationReason: string | null;
  /** Optional and additive: absent on every need written before corrections existed, read as OBSERVED. */
  authority?: NeedAuthorityV1;
  /** The observation this need was created to correct, so the original stays reachable. */
  correctsNeedId?: OpaqueId | null;
}

/** Needs stored before corrections existed carry no authority field; they are plain observations. */
export function needAuthority(need: CustomerNeedV1): NeedAuthorityV1 {
  return need.authority === "OWNER_CORRECTION" ? "OWNER_CORRECTION" : "OBSERVED";
}

export function isCurrentNeed(need: CustomerNeedV1): boolean {
  return !need.supersededAt && !need.invalidatedAt;
}

export function currentNeeds(needs: readonly CustomerNeedV1[], relationshipRef: string): CustomerNeedV1[] {
  return needs.filter((n) => n.relationshipRef === relationshipRef && isCurrentNeed(n));
}

/**
 * Record a new observation, superseding whatever it replaces.
 *
 * Returns the updated set rather than mutating in place, so callers cannot accidentally lose the
 * prior value. Supersession is per attribute: a new budget does not disturb a stated colour.
 */
export function recordNeed(
  existing: readonly CustomerNeedV1[],
  incoming: CustomerNeedV1,
): CustomerNeedV1[] {
  const superseded = existing.map((n) => {
    if (n.relationshipRef !== incoming.relationshipRef) return n;
    if (n.attribute !== incoming.attribute) return n;
    if (!isCurrentNeed(n)) return n;
    // Same attribute, same customer, still current: the older observation is now history.
    // For list-like attributes the same *value* repeating is a reconfirmation, not a change.
    if (LIST_LIKE.has(n.attribute) && n.value !== incoming.value) return n;
    return { ...n, supersededAt: incoming.observedAt, supersededBy: incoming.id };
  });
  return [...superseded, incoming];
}

/** Attributes where a customer can hold several values at once. */
const LIST_LIKE = new Set<NeedAttributeV1>(["must-have", "nice-to-have", "must-not-have", "objection"]);

/**
 * What changed for this customer, newest first.
 *
 * Answers "has Sarah changed what she wants?" from the supersession chain, citing both sides.
 */
export interface NeedChangeV1 {
  attribute: NeedAttributeV1;
  from: string;
  to: string;
  changedAt: IsoTimestamp;
  fromSourceRef: string;
  toSourceRef: string;
  /** Carried because a change can be in strength alone: the same car, now ruled out. */
  fromStrength: NeedStrengthV1;
  toStrength: NeedStrengthV1;
  /** True when the replacement came from the Owner rather than from a transcript. */
  byOwnerCorrection: boolean;
}

export function needChanges(needs: readonly CustomerNeedV1[], relationshipRef: string): NeedChangeV1[] {
  const mine = needs.filter((n) => n.relationshipRef === relationshipRef);
  const byId = new Map(mine.map((n) => [n.id, n]));
  const changes: NeedChangeV1[] = [];
  for (const old of mine) {
    if (!old.supersededBy || !old.supersededAt) continue;
    const next = byId.get(old.supersededBy);
    if (!next) continue;
    changes.push({
      attribute: old.attribute,
      from: old.value,
      to: next.value,
      changedAt: old.supersededAt,
      fromSourceRef: old.sourceRef,
      toSourceRef: next.sourceRef,
      fromStrength: old.strength,
      toStrength: next.strength,
      byOwnerCorrection: needAuthority(next) === "OWNER_CORRECTION",
    });
  }
  return changes.sort((a, b) => (a.changedAt < b.changedAt ? 1 : -1));
}

/**
 * Freshness, for deciding whether a need is still worth acting on.
 *
 * Used by reverse matching, where the output is a prompt to telephone a real person and a six-month
 * old want is not current intent.
 */
export type NeedFreshnessV1 = "FRESH" | "AGING" | "STALE";

export function needFreshness(need: CustomerNeedV1, nowIso: string): NeedFreshnessV1 {
  const days = Math.floor((Date.parse(nowIso) - Date.parse(need.observedAt)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "FRESH";
  if (days <= 30) return "FRESH";
  if (days <= 90) return "AGING";
  return "STALE";
}

/**
 * Owner-facing summary of what a customer wants now.
 *
 * Hard requirements lead, because they are what disqualifies a car, and a salesperson scanning this
 * before a call needs the disqualifiers first.
 */
export function formatNeedsAnswer(needs: readonly CustomerNeedV1[], customerName: string): string {
  const current = needs.filter(isCurrentNeed);
  if (!current.length) return `I don't have anything recorded about what ${customerName} wants.`;

  const order: NeedStrengthV1[] = ["HARD_REQUIREMENT", "EXCLUSION", "PREFERENCE", "UNKNOWN"];
  const lines: string[] = [`What ${customerName} wants:`];
  for (const strength of order) {
    const group = current.filter((n) => n.strength === strength);
    if (!group.length) continue;
    const heading =
      strength === "HARD_REQUIREMENT" ? "Must have" :
      strength === "EXCLUSION" ? "Won't accept" :
      strength === "PREFERENCE" ? "Prefers" : "Unclear";
    lines.push("");
    lines.push(heading + ":");
    for (const n of group) lines.push(`· ${describeNeed(n)}`);
  }
  return lines.join("\n");
}

export function describeNeed(need: CustomerNeedV1): string {
  const label: Record<NeedAttributeV1, string> = {
    make: "make", model: "model", trim: "trim", condition: "new/used",
    "max-price": "budget", "payment-target": "monthly payment", color: "colour",
    powertrain: "powertrain", "must-have": "must have", "nice-to-have": "nice to have",
    "must-not-have": "must not have", "trade-in": "trade-in", timeline: "timeline",
    "purchase-intent": "intent", objection: "concern",
  };
  const value = need.numericValue != null && (need.attribute === "max-price" || need.attribute === "payment-target")
    ? `$${need.numericValue.toLocaleString("en-US")}`
    : need.value;
  return `${label[need.attribute]}: ${value}`;
}

/**
 * Format the change history.
 *
 * Deliberately states both sides. "She wants an SUV" is less useful to a salesperson than "she
 * wanted a Camry XSE on Monday and said SUV on Friday" — the second tells them what to open with.
 */
/** How a strength reads in a sentence, so a change can be described without naming the enum. */
function strengthWord(strength: NeedStrengthV1): string {
  return strength === "HARD_REQUIREMENT" ? "a requirement"
    : strength === "EXCLUSION" ? "ruled out"
    : strength === "PREFERENCE" ? "a preference"
    : "unclear";
}

/**
 * One change, in a sentence.
 *
 * Shared by the history answer and the pre-call brief so the two cannot drift. Both were previously
 * capable of reporting a strength-only change as "they used to want hybrid and now say hybrid",
 * which is true and tells the Owner nothing.
 */
export function describeNeedChange(change: NeedChangeV1): string {
  const because = change.byOwnerCorrection ? " after you corrected me" : "";
  return change.from === change.to
    ? `${change.from} went from ${strengthWord(change.fromStrength)} to ${strengthWord(change.toStrength)}${because}`
    : `they used to want ${change.from} and now say ${change.to}${because}`;
}

export function formatNeedChanges(changes: readonly NeedChangeV1[], customerName: string): string {
  if (!changes.length) return `Nothing has changed in what I have recorded for ${customerName}.`;
  const lines = [`What changed for ${customerName}:`];
  for (const c of changes) {
    // The same value can be superseded by itself at a different strength — a Camry that went from
    // something she wanted to something she ruled out. Reporting that as was "camry", now "camry"
    // is technically true and useless, so a strength-only change is described as one.
    lines.push(`· ${c.attribute}: ${describeNeedChange(c)} (${c.changedAt.slice(0, 10)})`);
  }
  return lines.join("\n");
}
