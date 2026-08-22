/**
 * What AION knows about a business, where it learned it, and how much that source is worth.
 *
 * Prose could not hold this. The May regulatory profile said the AHCA registration was pending; the
 * certificate says it is issued. Both are true statements about their own dates, and only one governs
 * today. A document that keeps the newest sentence loses the ability to explain itself; one that
 * keeps both without ordering them cannot answer a question. So supersession is a **state**, not a
 * deletion, and source class is **structure**, not a convention people remember to follow.
 *
 * Two sentences are the whole model:
 *
 *   **An artifact is not knowledge.** A file existing about a business says nothing about the
 *   business. `UNREAD_SOURCE` exists because AION has, right now, a certificate PDF it can locate and
 *   cannot read — and the honest record of that is a state, not a silence.
 *
 *   **A summary is never stronger than its source.** A derived summary of a machine transcript is
 *   weaker than the transcript, which is weaker than the certificate. `sourceRank` orders that, and
 *   nothing in this module lets a weaker source quietly overwrite a stronger one.
 *
 * Shapes are borrowed from `packages/career-evidence` — content digests, assertion and conflict
 * state, the dry-run/import split — deliberately, because they were already thought through. The
 * *taxonomy* is not borrowed: business facts are not career facts, and forcing them into
 * `start-date`/`end-date` to avoid writing a second module would corrupt both.
 */

import { createHash } from "node:crypto";

export const BUSINESS_EVIDENCE_SCHEMA_V1 = "aion.director.businessEvidence.v1" as const;
export const BUSINESS_SOURCE_SCHEMA_V1 = "aion.director.businessEvidenceSource.v1" as const;
export const OWNER_QUESTION_SCHEMA_V1 = "aion.director.ownerQuestion.v1" as const;

/* -------------------------------------------------------------------------- */
/* Epistemic state                                                             */
/* -------------------------------------------------------------------------- */

export const EPISTEMIC_STATES_V1 = [
  "KNOWN",
  "UNKNOWN",
  "HYPOTHESIS",
  "CONFLICTED",
  "SUPERSEDED",
  "UNREAD_SOURCE",
] as const;
export type EpistemicStateV1 = (typeof EPISTEMIC_STATES_V1)[number];

/** States a caller may act on. Everything else is a question wearing a record's clothes. */
export const ACTIONABLE_STATES_V1: readonly EpistemicStateV1[] = ["KNOWN"];

/* -------------------------------------------------------------------------- */
/* Source classes, ranked                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Ordered strongest to weakest. The order **is** the policy.
 *
 * A certificate outranks a machine transcript of somebody saying the certificate arrived. That is
 * not a stylistic preference; it is the difference between a fact and a report of a fact, and the
 * July "AHCA Reg number cleared" transcript is exactly why it has to be structural.
 */
export const SOURCE_CLASSES_V1 = [
  "OFFICIAL_REGULATORY_DOCUMENT",
  "OFFICIAL_LOCAL_GOVERNMENT_DOCUMENT",
  "OWNER_STATEMENT",
  "BUSINESS_DOCUMENT",
  "WEBSITE_CONTENT",
  "TRANSCRIPT",
  "ASR_TRANSCRIPT",
  "RESEARCH",
  "DERIVED_SUMMARY",
] as const;
export type SourceClassV1 = (typeof SOURCE_CLASSES_V1)[number];

/** Lower is stronger. */
export function sourceRank(sourceClass: SourceClassV1): number {
  return SOURCE_CLASSES_V1.indexOf(sourceClass);
}

/**
 * Classes that may carry a `KNOWN` claim on their own.
 *
 * An Owner statement counts: the Owner is authoritative about their own business, and refusing that
 * would make AION unusable. Research, a derived summary and a machine transcript do not — they can
 * support a `HYPOTHESIS` and can corroborate, but a hypothesis does not become a fact by being
 * repeated in a summary of itself.
 */
export const KNOWLEDGE_BEARING_CLASSES_V1: readonly SourceClassV1[] = [
  "OFFICIAL_REGULATORY_DOCUMENT",
  "OFFICIAL_LOCAL_GOVERNMENT_DOCUMENT",
  "OWNER_STATEMENT",
  "BUSINESS_DOCUMENT",
];

export const SENSITIVITY_V1 = ["PUBLIC", "INTERNAL", "SENSITIVE"] as const;
export type SensitivityV1 = (typeof SENSITIVITY_V1)[number];

/* -------------------------------------------------------------------------- */
/* Records                                                                     */
/* -------------------------------------------------------------------------- */

export interface BusinessSourceV1 {
  readonly schema: typeof BUSINESS_SOURCE_SCHEMA_V1;
  readonly sourceId: string;
  readonly workspaceId: string;
  readonly sourceClass: SourceClassV1;
  /** Human-checkable pointer. A path, a document title, or the Owner exchange it came from. */
  readonly reference: string;
  /** Whether AION could actually read it. `false` means every claim from it is `UNREAD_SOURCE`. */
  readonly readable: boolean;
  /** Content digest, so a changed source is a new version rather than a silent overwrite. */
  readonly contentDigest: string;
  readonly version: number;
  /** When the source itself is dated — not when AION read it. */
  readonly observedAtUtc: string;
  readonly ingestedAtUtc: string;
  readonly sensitivity: SensitivityV1;
  /** Why it could not be read, when it could not. */
  readonly unreadableReason: string;
}

export interface BusinessEvidenceV1 {
  readonly schema: typeof BUSINESS_EVIDENCE_SCHEMA_V1;
  readonly evidenceId: string;
  readonly workspaceId: string;
  /** What the claim is about — the business, a licence, a service area. */
  readonly subject: string;
  /** Stable category, so two sources making the same claim can be compared. */
  readonly claim: string;
  readonly value: string;
  readonly state: EpistemicStateV1;
  readonly sourceId: string;
  readonly sourceClass: SourceClassV1;
  readonly observedAtUtc: string;
  /** When the claim itself takes effect, if it says. Empty when it does not. */
  readonly effectiveFromUtc: string;
  readonly effectiveToUtc: string;
  readonly ingestedAtUtc: string;
  readonly sensitivity: SensitivityV1;
  /** Evidence ids this one disagrees with. Symmetric, recorded on both. */
  readonly contradicts: readonly string[];
  /** Evidence id that overtook this one, or empty. One-directional and never rewritten. */
  readonly supersededBy: string;
  /** Why it matters, in words a person can act on. */
  readonly note: string;
}

/* -------------------------------------------------------------------------- */
/* Identity and digests                                                        */
/* -------------------------------------------------------------------------- */

export function digestOf(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
}

/**
 * Logical identity of a claim.
 *
 * Workspace, subject, claim and source — **not** the value, and not the source version. That is what
 * makes re-import idempotent: the same source asserting the same claim again is the same evidence,
 * even if the wording moved. A *different* source asserting the same claim is a separate record, and
 * the two are then compared rather than merged.
 */
export function evidenceIdFor(input: {
  workspaceId: string;
  subject: string;
  claim: string;
  sourceId: string;
}): string {
  return digestOf(`${input.workspaceId}|${input.subject}|${input.claim}|${input.sourceId}`);
}

export function sourceIdFor(workspaceId: string, reference: string): string {
  return digestOf(`${workspaceId}|${reference}`);
}

/* -------------------------------------------------------------------------- */
/* Conflict and supersession                                                   */
/* -------------------------------------------------------------------------- */

export interface ConflictJudgementV1 {
  readonly conflicting: boolean;
  /** The record that governs now, when one does. */
  readonly governing: BusinessEvidenceV1 | null;
  readonly superseded: BusinessEvidenceV1 | null;
  readonly reason: string;
}

/**
 * Decide what to do about two records making the same claim with different values.
 *
 * Two questions, in order, and the order matters. **Is the newer one from a source strong enough to
 * overtake the older?** A certificate supersedes a May planning document; a machine transcript does
 * not supersede a certificate, however recent it is. And **is the newer one actually newer?** A
 * stronger source that predates a weaker one does not automatically win either — that is a genuine
 * conflict for a person to resolve, not something to settle by arithmetic.
 *
 * Anything this cannot resolve stays `CONFLICTED`, with both records intact. Guessing here is how a
 * memory ends up confidently wrong.
 */
export function judgeConflict(
  existing: BusinessEvidenceV1,
  incoming: BusinessEvidenceV1,
): ConflictJudgementV1 {
  if (existing.claim !== incoming.claim || existing.subject !== incoming.subject) {
    return { conflicting: false, governing: null, superseded: null, reason: "different claims" };
  }
  if (existing.value === incoming.value) {
    return { conflicting: false, governing: existing, superseded: null, reason: "same value" };
  }

  const strongerIncoming = sourceRank(incoming.sourceClass) < sourceRank(existing.sourceClass);
  const strongerExisting = sourceRank(existing.sourceClass) < sourceRank(incoming.sourceClass);
  const newerIncoming = incoming.observedAtUtc > existing.observedAtUtc;

  if (strongerIncoming && newerIncoming) {
    return {
      conflicting: false,
      governing: incoming,
      superseded: existing,
      reason: `${incoming.sourceClass} of ${incoming.observedAtUtc} supersedes ${existing.sourceClass} of ${existing.observedAtUtc}`,
    };
  }
  if (!strongerExisting && newerIncoming && incoming.sourceClass === existing.sourceClass) {
    return {
      conflicting: false,
      governing: incoming,
      superseded: existing,
      reason: `later ${incoming.sourceClass} supersedes the earlier one`,
    };
  }
  if (strongerExisting && !newerIncoming) {
    return {
      conflicting: false,
      governing: existing,
      superseded: incoming,
      reason: `${existing.sourceClass} outranks ${incoming.sourceClass}; the weaker earlier claim is history`,
    };
  }
  return {
    conflicting: true,
    governing: null,
    superseded: null,
    reason: strongerExisting
      ? `${existing.sourceClass} is stronger but ${incoming.sourceClass} is newer — a person must resolve this`
      : `neither source clearly governs — a person must resolve this`,
  };
}

/**
 * The state a claim is entitled to, before any conflict is considered.
 *
 * An unreadable source yields `UNREAD_SOURCE` no matter what anyone believes it says, and a source
 * class that cannot bear knowledge yields `HYPOTHESIS`. This is where "an artifact is not knowledge"
 * stops being a slogan.
 */
export function entitledState(input: {
  sourceClass: SourceClassV1;
  readable: boolean;
  asserted: EpistemicStateV1;
}): { state: EpistemicStateV1; reason: string } {
  if (!input.readable) {
    return { state: "UNREAD_SOURCE", reason: "the source is located but AION could not read it" };
  }
  if (input.asserted === "UNKNOWN" || input.asserted === "HYPOTHESIS") {
    return { state: input.asserted, reason: "asserted as such" };
  }
  if (!KNOWLEDGE_BEARING_CLASSES_V1.includes(input.sourceClass)) {
    return {
      state: "HYPOTHESIS",
      reason: `${input.sourceClass} cannot carry a fact on its own; it may corroborate one`,
    };
  }
  return { state: "KNOWN", reason: `${input.sourceClass} is knowledge-bearing` };
}

/* -------------------------------------------------------------------------- */
/* Sensitivity                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Values that must never reach a tracked artifact.
 *
 * Deliberately a small, blunt list rather than a classifier. A pattern that fires on a licence
 * number, an EIN, a phone number or an email covers what this milestone actually handles, and a
 * clever detector would be another thing to trust.
 */
const SENSITIVE_PATTERNS_V1: readonly { readonly label: string; readonly re: RegExp }[] = [
  { label: "EIN", re: /\b\d{2}-\d{7}\b/u },
  { label: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/u },
  { label: "phone", re: /\b\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/u },
  { label: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u },
  { label: "street address", re: /\b\d{1,6}\s+[A-Za-z][A-Za-z. ]{2,}\s(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Way)\b/u },
  // Requires a digit in the trailing token. Without it this fired on "the registration number must
  // appear in all advertising" — ordinary prose about an identifier, containing no identifier.
  { label: "licence or account number", re: /\b(?:licen[cs]e|certificate|registration|account|receipt)\s*(?:no\.?|number|#)\s*:?\s*(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{4,}/iu },
];

export function sensitiveFieldsIn(text: string): readonly string[] {
  return SENSITIVE_PATTERNS_V1.filter((pattern) => pattern.re.test(text)).map((pattern) => pattern.label);
}

/** `SENSITIVE` when the value carries an identifier, otherwise what the caller asked for. */
export function classifySensitivity(value: string, requested: SensitivityV1): SensitivityV1 {
  return sensitiveFieldsIn(value).length > 0 ? "SENSITIVE" : requested;
}
