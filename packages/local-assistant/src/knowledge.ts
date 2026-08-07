import type { IsoTimestamp, OpaqueId, ProvenanceV1 } from "./contracts.js";

/**
 * How AION distinguishes things it knows from things it merely thinks.
 *
 * The single most damaging thing a system like this can do is let a guess harden into a fact.
 * It happens quietly: a model infers something plausible, the inference gets summarised, the
 * summary gets quoted, and three steps later nobody can tell whether anyone ever checked. So the
 * class of a claim is a stored, required field rather than a matter of tone, and the rules about
 * what may become what are enforced here rather than left to whoever writes the next feature.
 *
 * Two rules do most of the work:
 *
 *   1. **A model may propose, never assert.** Only the owner can create or confirm a FACT. A
 *      provider proposing one produces a HYPOTHESIS with the proposal recorded as its source.
 *   2. **Promotion is explicit and one-directional.** An INFERENCE can become a FACT only by the
 *      owner confirming it, and the original class stays in the record's history. Nothing is
 *      rewritten in place, so "when did we start believing this?" always has an answer.
 */

export type ClaimClassV1 =
  /** Checked and true, as far as the owner is concerned. Only the owner creates one. */
  | "fact"
  /** Something that was seen or recorded happening. Descriptive, not interpreted. */
  | "observation"
  /** A citable artefact — a source, a document, a run — that other claims can rest on. */
  | "evidence"
  /** Something being taken as true on purpose, without having been checked. */
  | "assumption"
  /** A proposed explanation or prediction that could be tested. */
  | "hypothesis"
  /** A conclusion drawn from other claims. Only as good as what it rests on. */
  | "inference"
  /** A fact the owner explicitly confirmed, carrying the moment of confirmation. */
  | "owner-confirmed"
  /** A way of doing something that worked, kept because it worked. */
  | "learned-strategy";

export const CLAIM_CLASSES: readonly ClaimClassV1[] = [
  "fact", "observation", "evidence", "assumption", "hypothesis", "inference", "owner-confirmed", "learned-strategy",
];

export interface ClaimClassPolicyV1 {
  class: ClaimClassV1;
  label: string;
  description: string;
  /** Whether a non-owner actor may create a claim of this class at all. */
  proposableByModel: boolean;
  /** Whether the claim is meaningless without something to cite. */
  requiresSource: boolean;
  /** Classes this claim may be promoted to, and only by the owner. */
  promotesTo: readonly ClaimClassV1[];
}

export const CLAIM_CLASS_POLICIES: readonly ClaimClassPolicyV1[] = [
  {
    class: "fact", label: "Fact", description: "Checked and true as far as the owner is concerned.",
    proposableByModel: false, requiresSource: false, promotesTo: ["owner-confirmed"],
  },
  {
    class: "observation", label: "Observation", description: "Something that was seen or recorded happening, described rather than interpreted.",
    proposableByModel: true, requiresSource: true, promotesTo: ["fact", "owner-confirmed"],
  },
  {
    class: "evidence", label: "Evidence", description: "A citable artefact other claims can rest on.",
    proposableByModel: true, requiresSource: true, promotesTo: [],
  },
  {
    class: "assumption", label: "Assumption", description: "Taken as true on purpose, without having been checked.",
    proposableByModel: true, requiresSource: false, promotesTo: ["hypothesis", "fact", "owner-confirmed"],
  },
  {
    class: "hypothesis", label: "Hypothesis", description: "A proposed explanation or prediction that could be tested.",
    proposableByModel: true, requiresSource: false, promotesTo: ["inference", "fact", "owner-confirmed", "learned-strategy"],
  },
  {
    class: "inference", label: "Inference", description: "A conclusion drawn from other claims, and only as good as what it rests on.",
    proposableByModel: true, requiresSource: true, promotesTo: ["fact", "owner-confirmed", "learned-strategy"],
  },
  {
    class: "owner-confirmed", label: "Owner-confirmed", description: "A fact the owner explicitly confirmed, carrying the moment they did.",
    proposableByModel: false, requiresSource: false, promotesTo: [],
  },
  {
    class: "learned-strategy", label: "Learned strategy", description: "A way of doing something that worked, kept because it worked.",
    proposableByModel: true, requiresSource: true, promotesTo: ["owner-confirmed"],
  },
];

function fail(message: string): never { throw new Error(message); }

export function claimClassPolicy(value: unknown): ClaimClassPolicyV1 {
  const policy = CLAIM_CLASS_POLICIES.find((entry) => entry.class === value);
  if (!policy) fail(`A claim must be one of: ${CLAIM_CLASSES.join(", ")}. AION does not store an unclassified belief.`);
  return policy;
}

/** One change of class, kept so the history of a belief is never lost. */
export interface ClaimPromotionV1 {
  at: IsoTimestamp;
  from: ClaimClassV1;
  to: ClaimClassV1;
  reason: string;
}

export interface KnowledgeClaimV1 {
  id: OpaqueId;
  workspace: string;
  class: ClaimClassV1;
  statement: string;
  /** What this claim rests on: other claim ids, research job ids, verification ids, sources. */
  supportedBy: string[];
  /** How sure the owner is, 0 to 100. Never inferred, never adjusted by a model. */
  confidence: number;
  /** Set when the claim is no longer believed. Superseding never deletes. */
  supersededBy: OpaqueId | null;
  enabled: boolean;
  provenance: ProvenanceV1;
  /** Every class this claim has held, in order. Nothing is rewritten in place. */
  promotions: ClaimPromotionV1[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

function statement(value: unknown): string {
  if (typeof value !== "string") fail("A claim needs a statement.");
  const text = value.trim();
  if (!text || text.length > 4000) fail("A claim statement must be between 1 and 4000 characters.");
  return text;
}

function confidence(value: unknown): number {
  if (value === undefined || value === null) return 50;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100) fail("Confidence must be a whole number between 0 and 100.");
  return value as number;
}

function supportList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) fail("A claim may cite at most 50 supports.");
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim() || entry.length > 300) fail("A claim support reference is invalid.");
    return entry.trim();
  });
}

/**
 * Builds a claim, refusing the two shapes that would let a belief launder itself.
 *
 * A model cannot create a FACT or an OWNER-CONFIRMED claim at all, and a class that only means
 * something with a citation cannot be created without one. Both refusals are explicit errors, not
 * silent downgrades, so an attempt to smuggle a fact through is visible rather than absorbed.
 */
export function buildClaim(
  input: Record<string, unknown>,
  context: { id: OpaqueId; workspace: string; now: IsoTimestamp; actor: "owner" | "provider-proposal" | "routine" | "research" | "system"; sourceRef: string },
): KnowledgeClaimV1 {
  const policy = claimClassPolicy(input.class);
  if (context.actor !== "owner" && !policy.proposableByModel) {
    fail(`Only the owner can record a ${policy.label.toLowerCase()}. ${context.actor} may propose a hypothesis or an inference instead, and the owner can promote it.`);
  }
  const supportedBy = supportList(input.supportedBy);
  if (policy.requiresSource && !supportedBy.length) {
    fail(`A ${policy.label.toLowerCase()} must cite what it rests on. AION does not store one with nothing behind it.`);
  }
  return {
    id: context.id,
    workspace: context.workspace,
    class: policy.class,
    statement: statement(input.statement),
    supportedBy,
    confidence: confidence(input.confidence),
    supersededBy: null,
    enabled: true,
    provenance: {
      sourceType: context.actor === "owner" ? "owner" : context.actor === "routine" ? "routine" : context.actor === "system" ? "system" : "provider-proposal",
      sourceRef: context.sourceRef,
      recordedAt: context.now,
    },
    promotions: [],
    createdAt: context.now,
    updatedAt: context.now,
  };
}

/**
 * Promotes a claim to a stronger class. Owner-only, one step at a time, along a declared path,
 * and always additive: the previous class stays in `promotions` so the record still answers the
 * question of when the belief changed and why.
 */
export function promoteClaim(claim: KnowledgeClaimV1, to: unknown, reason: string, now: IsoTimestamp): KnowledgeClaimV1 {
  const target = claimClassPolicy(to);
  const current = claimClassPolicy(claim.class);
  if (!current.promotesTo.includes(target.class)) {
    fail(`A ${current.label.toLowerCase()} cannot become a ${target.label.toLowerCase()}. Allowed: ${current.promotesTo.join(", ") || "nothing — this class is already final"}.`);
  }
  const why = String(reason ?? "").trim();
  if (!why || why.length > 1000) fail("Promoting a claim requires a reason between 1 and 1000 characters.");
  const next = structuredClone(claim);
  next.promotions.push({ at: now, from: claim.class, to: target.class, reason: why });
  next.class = target.class;
  next.updatedAt = now;
  return next;
}

/** Marks a claim as no longer believed, pointing at whatever replaced it. Never deletes. */
export function supersedeClaim(claim: KnowledgeClaimV1, replacementId: OpaqueId | null, now: IsoTimestamp): KnowledgeClaimV1 {
  const next = structuredClone(claim);
  next.supersededBy = replacementId;
  next.enabled = false;
  next.updatedAt = now;
  return next;
}

/**
 * The claims a summary may safely state as true.
 *
 * Everything else is still there and still readable; it just does not get to be quoted as
 * settled. This is the function that stops "AION thinks" turning into "AION says".
 */
export function settledClaims(claims: readonly KnowledgeClaimV1[]): KnowledgeClaimV1[] {
  return claims.filter((claim) => claim.enabled && !claim.supersededBy && (claim.class === "fact" || claim.class === "owner-confirmed"));
}

/** A one-line honest summary of what a body of claims actually amounts to. */
export function claimBalance(claims: readonly KnowledgeClaimV1[]): { settled: number; unverified: number; summary: string } {
  const live = claims.filter((claim) => claim.enabled && !claim.supersededBy);
  const settled = settledClaims(live).length;
  const unverified = live.length - settled;
  const summary = live.length === 0
    ? "Nothing is recorded here yet, so there is nothing to conclude from."
    : settled === 0
      ? `${unverified} unverified claim(s) and nothing confirmed. Everything here is still a guess.`
      : `${settled} confirmed and ${unverified} unverified. Treat the unverified ones as open questions, not findings.`;
  return { settled, unverified, summary };
}
