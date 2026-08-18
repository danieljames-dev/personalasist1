/**
 * What AION is allowed to know about the Owner, where each piece came from, and how stale it is.
 *
 * The failure this package exists to prevent is not "AION lacks context". It is "AION acted on a
 * three-year-old resume as though it described this morning". Every type here therefore carries the
 * two things a downstream recommender needs in order to be honest: **where the claim came from**
 * (`sourceId` + `sourceReference` + `evidenceReference`) and **how current it is** (`observedAt`,
 * `freshnessState`, `temporalState`). A value with neither is not a fact here; it is an omission.
 *
 * ## Knowledge is not permission
 *
 * There is no field on {@link ContextSourceV1} or {@link PersonalContextFactV1} that grants access to
 * anything. Knowing an employer does not authorize logging into that employer's systems; knowing an
 * address does not authorize sending mail there. That separation is not a convention to be
 * remembered — {@link authorityFromPersonalContext} is the only answer this package gives when asked
 * whether a fact permits an action, and it always answers no. Credential-shaped material is refused
 * at validation rather than stored and then guarded.
 *
 * ## Unknown stays unknown
 *
 * Every optional-in-reality field is `T | null`, never absent, so "we do not know" is a value that
 * survives serialization and cannot be confused with "nobody set it yet". Extraction that cannot
 * support a claim emits nothing rather than a low-confidence guess.
 */

import type { ProviderIdV1, SensitivityClassV1 } from "@aion/director";

export const PERSONAL_CONTEXT_SCHEMA_V1 = "aion.personalContext.v1" as const;
export const PERSONAL_CONTEXT_DECLARATION_SCHEMA_V1 = "aion.personalContext.declaration.v1" as const;
export const PERSONAL_CONTEXT_RECEIPT_SCHEMA_V1 = "aion.personalContext.syncReceipt.v1" as const;
export const PERSONAL_CONTEXT_RETRIEVAL_SCHEMA_V1 = "aion.personalContext.retrieval.v1" as const;

export const PERSONAL_CONTEXT_MILESTONE_ID = "PERSONAL-CONTEXT-SYNC-V1" as const;
export const PERSONAL_CONTEXT_OWNER_AUTHORIZATION_ID = "PERSONAL-CONTEXT-SYNC-V1-20260818T140242Z" as const;
export const PERSONAL_CONTEXT_AUTHORITY_SOURCE = "OWNER_STANDING_AUTHORITY_V1" as const;

/** Where the durable store lives, relative to the repository root. Local only, by design. */
export const PERSONAL_CONTEXT_STORE_RELATIVE_PATH = ".aion-local/personal-context" as const;

/* -------------------------------------------------------------------------- */
/* Source authorization                                                        */
/* -------------------------------------------------------------------------- */

export const SOURCE_TYPES_V1 = [
  "AION_REPOSITORY",
  "APPROVED_GIT_REPOSITORY",
  "APPROVED_LOCAL_FILE",
  "APPROVED_LOCAL_FOLDER",
  "RESUME_CV",
  "WORK_HISTORY",
  "OWNER_ENTERED_CURRENT_JOB",
  "APPROVED_PROJECT_ARTIFACT",
] as const;
export type SourceTypeV1 = (typeof SOURCE_TYPES_V1)[number];

/**
 * A source that is not `ACTIVE` is not read again, and its derived facts stop being disclosable.
 *
 * `REVOKED` is deliberately not "deleted". Erasing the registry row would also erase the only record
 * of where existing facts came from, which turns an auditable history into an unattributed one.
 */
export const SOURCE_STATES_V1 = ["ACTIVE", "DISABLED", "REVOKED"] as const;
export type SourceStateV1 = (typeof SOURCE_STATES_V1)[number];

/**
 * Whether re-reading an already-approved source needs a fresh decision.
 *
 * `CONTINUOUS` and `ON_DEMAND` both mean the Owner already said yes to this source, so routine
 * re-sync is routine. `MANUAL` means each sync is an explicit act.
 */
export const SYNC_MODES_V1 = ["MANUAL", "ON_DEMAND", "CONTINUOUS"] as const;
export type SyncModeV1 = (typeof SYNC_MODES_V1)[number];

/* -------------------------------------------------------------------------- */
/* Facts                                                                       */
/* -------------------------------------------------------------------------- */

export const CONTEXT_CATEGORIES_V1 = [
  "IDENTITY_REFERENCE",
  "CAREER",
  "CURRENT_EMPLOYMENT",
  "WORK_HISTORY",
  "SKILL",
  "EDUCATION",
  "CERTIFICATION",
  "PROJECT",
  "TECHNOLOGY",
  "PREFERENCE",
  "GOAL",
  "CONSTRAINT",
  "LOCATION_PREFERENCE",
  "WORK_MODE_PREFERENCE",
  "COMPENSATION_PREFERENCE",
  "BUSINESS_CONTEXT",
  "OTHER_APPROVED",
] as const;
export type ContextCategoryV1 = (typeof CONTEXT_CATEGORIES_V1)[number];

/**
 * How current the *claim* is, which is not the same question as how recently the file was touched.
 *
 * `UNKNOWN_FRESHNESS` is the answer whenever the only timestamp available is a filesystem
 * modification time. Copying a 2019 resume into a new folder this morning updates `mtime` and
 * changes nothing about the world; treating that as evidence of currency is the single most likely
 * way this system would mislead a downstream recommender.
 */
export const FRESHNESS_STATES_V1 = [
  "CURRENT",
  "RECENT",
  "STALE",
  "HISTORICAL",
  "UNKNOWN_FRESHNESS",
] as const;
export type FreshnessStateV1 = (typeof FRESHNESS_STATES_V1)[number];

/** Whether the claim describes now or the past. Separate from freshness on purpose. */
export const TEMPORAL_STATES_V1 = ["CURRENT", "HISTORICAL", "UNKNOWN"] as const;
export type TemporalStateV1 = (typeof TEMPORAL_STATES_V1)[number];

export const CONFLICT_STATES_V1 = ["NONE", "POTENTIAL", "CONFIRMED"] as const;
export type ConflictStateV1 = (typeof CONFLICT_STATES_V1)[number];

export const CONFIDENCE_LEVELS_V1 = ["LOW", "MEDIUM", "HIGH"] as const;
export type ConfidenceLevelV1 = (typeof CONFIDENCE_LEVELS_V1)[number];

/**
 * What a fact may be *used for*, which is always reading and reasoning, never acting.
 *
 * Every member is an analysis. There is deliberately no `APPLY`, `SEND`, `LOGIN` or `SUBMIT`, and
 * {@link ACTION_SHAPED_USE} refuses one if a caller invents it.
 */
export const ELIGIBLE_USES_V1 = [
  "JOB_MATCHING",
  "CAREER_SUMMARY",
  "RESUME_DRAFT",
  "SKILL_INVENTORY",
  "BUSINESS_CONTEXT",
  "INTERNAL_DIAGNOSTIC",
] as const;
export type EligibleUseV1 = (typeof ELIGIBLE_USES_V1)[number];

/**
 * How a fact came to exist, which the Owner review report must never blur.
 *
 * `OWNER_ENTERED` is a value the Owner typed. `OWNER_CONFIRMED` is one they later re-affirmed.
 * `EXTRACTED` came from an approved document. `INFERRED` exists in the type so a report can name the
 * category and assert it is empty — nothing in this package produces one, and nothing should start
 * without saying so out loud. An inferred fact presented as Owner-confirmed is the specific lie this
 * system is built to prevent.
 */
export const FACT_ORIGINS_V1 = ["OWNER_ENTERED", "OWNER_CONFIRMED", "EXTRACTED", "INFERRED"] as const;
export type FactOriginV1 = (typeof FACT_ORIGINS_V1)[number];

/** A use name that reads like doing something rather than knowing something. */
export const ACTION_SHAPED_USE =
  /(login|log_?in|sign_?in|authenticate|send|email|mail|apply|submit|post|purchase|pay|order|delete|write|publish|contact|call|dial)/i;

/* -------------------------------------------------------------------------- */
/* Sensitivity                                                                 */
/* -------------------------------------------------------------------------- */

export const SENSITIVITY_ORDER_V1: readonly SensitivityClassV1[] = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
];

/**
 * The ceiling used when no Owner authority record is available.
 *
 * This used to be `MILESTONE_SENSITIVITY_CEILING_V1`, a constant pinned to one directive — which
 * meant raising the ceiling was a one-line source edit an agent could make to get past a refusal.
 * The real ceiling now comes from the durable Owner authority record (see `authority.ts`), and this
 * value is only the fail-closed answer for a caller that supplied none.
 */
export const DEFAULT_SENSITIVITY_CEILING_V1: SensitivityClassV1 = "INTERNAL";

export function sensitivityRank(value: SensitivityClassV1): number {
  const index = SENSITIVITY_ORDER_V1.indexOf(value);
  return index < 0 ? Number.POSITIVE_INFINITY : index;
}

/** Whether `value` sits at or below `ceiling`. An unknown class is above every ceiling. */
export function sensitivityWithin(value: SensitivityClassV1, ceiling: SensitivityClassV1): boolean {
  return sensitivityRank(value) <= sensitivityRank(ceiling) && sensitivityRank(value) !== Number.POSITIVE_INFINITY;
}

/* -------------------------------------------------------------------------- */
/* Records                                                                     */
/* -------------------------------------------------------------------------- */

export interface ContextSourceV1 {
  readonly schema: typeof PERSONAL_CONTEXT_SCHEMA_V1;
  readonly sourceId: string;
  readonly sourceType: SourceTypeV1;
  /** The approved root or file. Absolute, and validated as naming one place on this host. */
  readonly location: string;
  readonly displayName: string;
  /** Why this source exists in the registry, in the Owner's terms. */
  readonly purpose: string;
  readonly authorizationSource: string;
  readonly milestoneId: string;
  readonly ownerAuthorizationId: string;
  /** Repo-relative-style prefixes under `location` that may be read. Empty means the whole root. */
  readonly allowedScope: readonly string[];
  /** Prefixes that must never be read, even when inside `allowedScope`. */
  readonly deniedScope: readonly string[];
  readonly sensitivityClass: SensitivityClassV1;
  readonly eligibleProviders: readonly ProviderIdV1[];
  readonly syncMode: SyncModeV1;
  readonly recursiveAllowed: boolean;
  readonly maxDepth: number;
  readonly maxFiles: number;
  readonly maxBytes: number;
  /** Following a link out of the approved root is never allowed; this only permits links that stay in. */
  readonly followSymlinksAllowed: boolean;
  readonly activeState: SourceStateV1;
  readonly revokedAt: string | null;
  readonly expiresAt: string | null;
  /** Ordering hint for presentation. It can never remove another source's evidence. */
  readonly priority: number;
  readonly lastAttemptedSync: string | null;
  readonly lastSuccessfulSync: string | null;
  readonly fingerprint: string | null;
  readonly version: number;
  readonly sourceModifiedAt: string | null;
  /** For a Git source: the commit the last sync observed. `null` when unknown or not a repository. */
  readonly repositoryHead: string | null;
  /** For a Git source: the remote it identifies as, when one is recorded inside the approved root. */
  readonly repositoryRemote: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PersonalContextFactV1 {
  readonly schema: typeof PERSONAL_CONTEXT_SCHEMA_V1;
  readonly factId: string;
  /** `subject|category|predicate` — the slot two sources can disagree about. */
  readonly claimKey: string;
  readonly subject: string;
  readonly category: ContextCategoryV1;
  readonly predicate: string;
  readonly value: string;
  readonly normalizedValue: string;
  readonly sourceId: string;
  /** Whether the Owner said this, or a document did. Never blurred in a report. */
  readonly origin: FactOriginV1;
  /** Which file inside the source, relative to its approved root. */
  readonly sourceReference: string;
  /** The commit this was observed at, for a Git source. `null` otherwise. */
  readonly sourceCommit: string | null;
  /** Where inside that file, in whatever terms the document supports. */
  readonly evidenceReference: string;
  /** When the claim was true or last confirmed by the document itself. Not a filesystem time. */
  readonly observedAt: string | null;
  /** Filesystem modification time. Evidence about the file, not about the world. */
  readonly sourceModifiedAt: string | null;
  readonly extractedAt: string;
  readonly confidence: ConfidenceLevelV1;
  readonly sensitivity: SensitivityClassV1;
  readonly freshnessState: FreshnessStateV1;
  /** Why {@link freshnessState} is what it is, so a reader can disagree with the rule. */
  readonly freshnessEvidence: string;
  readonly temporalState: TemporalStateV1;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly conflictState: ConflictStateV1;
  readonly conflictsWith: readonly string[];
  readonly supersedes: readonly string[];
  readonly supersededBy: string | null;
  readonly eligibleUses: readonly EligibleUseV1[];
  readonly eligibleProviders: readonly ProviderIdV1[];
  readonly contentFingerprint: string;
  readonly version: number;
  readonly lastConfirmedAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Validation — fail closed                                                    */
/* -------------------------------------------------------------------------- */

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Text that would mean AION had stored a key rather than a fact.
 *
 * Refused at validation rather than stored-and-guarded, because a secret that never enters the store
 * cannot leak out of it through a retrieval path nobody thought about.
 */
export const CREDENTIAL_SHAPED =
  /(password|passphrase|secret|credential|api[\s_-]?key|access[\s_-]?token|bearer|private[\s_-]?key|ssh[\s_-]?key|otp|mfa[\s_-]?code|social[\s_-]?security|\bssn\b|passport[\s_-]?number|routing[\s_-]?number|account[\s_-]?number|card[\s_-]?number|\bcvv\b|pin[\s_-]?code)/i;

function badInstant(value: string | null): boolean {
  return value !== null && !ISO_INSTANT.test(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** `null` when the record is usable, otherwise the first reason it is not. */
export function validateContextSource(candidate: unknown): string | null {
  if (candidate === null || typeof candidate !== "object") return "source record is not an object";
  const source = candidate as Partial<ContextSourceV1>;
  if (source.schema !== PERSONAL_CONTEXT_SCHEMA_V1) return "source schema mismatch";
  if (typeof source.sourceId !== "string" || !IDENTIFIER.test(source.sourceId)) return "sourceId is not a safe identifier";
  if (typeof source.sourceType !== "string" || !SOURCE_TYPES_V1.includes(source.sourceType as SourceTypeV1)) {
    return "sourceType is not a supported source type";
  }
  if (typeof source.location !== "string" || source.location.trim() === "") return "location is empty";
  if (typeof source.displayName !== "string" || source.displayName.trim() === "") return "displayName is empty";
  if (typeof source.purpose !== "string" || source.purpose.trim() === "") return "purpose is empty";
  if (typeof source.authorizationSource !== "string" || source.authorizationSource.trim() === "") {
    return "authorizationSource is empty";
  }
  if (typeof source.milestoneId !== "string" || source.milestoneId.trim() === "") return "milestoneId is empty";
  if (typeof source.ownerAuthorizationId !== "string" || source.ownerAuthorizationId.trim() === "") {
    return "ownerAuthorizationId is empty";
  }
  if (!isStringArray(source.allowedScope)) return "allowedScope is not a string list";
  if (!isStringArray(source.deniedScope)) return "deniedScope is not a string list";
  if (typeof source.sensitivityClass !== "string" || sensitivityRank(source.sensitivityClass) === Number.POSITIVE_INFINITY) {
    return "sensitivityClass is not a supported class";
  }
  if (!Array.isArray(source.eligibleProviders) || source.eligibleProviders.length === 0) {
    return "eligibleProviders is empty";
  }
  if (typeof source.syncMode !== "string" || !SYNC_MODES_V1.includes(source.syncMode as SyncModeV1)) {
    return "syncMode is not supported";
  }
  if (typeof source.recursiveAllowed !== "boolean") return "recursiveAllowed is not boolean";
  if (typeof source.followSymlinksAllowed !== "boolean") return "followSymlinksAllowed is not boolean";
  for (const field of ["maxDepth", "maxFiles", "maxBytes", "priority", "version"] as const) {
    const value = source[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return `${field} is not a non-negative number`;
  }
  if (typeof source.activeState !== "string" || !SOURCE_STATES_V1.includes(source.activeState as SourceStateV1)) {
    return "activeState is not supported";
  }
  if (source.revokedAt !== null && typeof source.revokedAt !== "string") return "revokedAt must be a string or null";
  if (source.expiresAt !== null && typeof source.expiresAt !== "string") return "expiresAt must be a string or null";
  if (typeof source.createdAt !== "string" || !ISO_INSTANT.test(source.createdAt)) return "createdAt is not an ISO instant";
  if (typeof source.updatedAt !== "string" || !ISO_INSTANT.test(source.updatedAt)) return "updatedAt is not an ISO instant";
  if (badInstant(source.revokedAt ?? null)) return "revokedAt is not an ISO instant";
  if (badInstant(source.expiresAt ?? null)) return "expiresAt is not an ISO instant";
  if (badInstant(source.lastAttemptedSync ?? null)) return "lastAttemptedSync is not an ISO instant";
  if (badInstant(source.lastSuccessfulSync ?? null)) return "lastSuccessfulSync is not an ISO instant";
  if (source.fingerprint !== null && typeof source.fingerprint !== "string") return "fingerprint must be a string or null";
  if (source.repositoryHead !== null && typeof source.repositoryHead !== "string") return "repositoryHead must be a string or null";
  if (source.repositoryRemote !== null && typeof source.repositoryRemote !== "string") return "repositoryRemote must be a string or null";
  if (CREDENTIAL_SHAPED.test(source.displayName) || CREDENTIAL_SHAPED.test(source.purpose)) {
    return "source metadata names credential material";
  }
  return null;
}

/** `null` when the fact is usable, otherwise the first reason it is not. */
export function validatePersonalContextFact(candidate: unknown): string | null {
  if (candidate === null || typeof candidate !== "object") return "fact record is not an object";
  const fact = candidate as Partial<PersonalContextFactV1>;
  if (fact.schema !== PERSONAL_CONTEXT_SCHEMA_V1) return "fact schema mismatch";
  if (typeof fact.factId !== "string" || fact.factId.trim() === "") return "factId is empty";
  if (typeof fact.subject !== "string" || fact.subject.trim() === "") return "subject is empty";
  if (typeof fact.category !== "string" || !CONTEXT_CATEGORIES_V1.includes(fact.category as ContextCategoryV1)) {
    return "category is not supported";
  }
  if (typeof fact.predicate !== "string" || fact.predicate.trim() === "") return "predicate is empty";
  if (typeof fact.value !== "string" || fact.value.trim() === "") return "value is empty";
  if (typeof fact.normalizedValue !== "string") return "normalizedValue is not a string";
  if (typeof fact.claimKey !== "string" || fact.claimKey !== `${fact.subject}|${fact.category}|${fact.predicate}`) {
    return "claimKey does not match subject/category/predicate";
  }
  if (typeof fact.sourceId !== "string" || !IDENTIFIER.test(fact.sourceId)) return "sourceId is not a safe identifier";
  if (typeof fact.origin !== "string" || !FACT_ORIGINS_V1.includes(fact.origin as FactOriginV1)) {
    return "origin is not a supported fact origin";
  }
  // Nothing in this package produces an inferred fact. Refusing to store one is what keeps the
  // report's OWNER_CONFIRMED column trustworthy: there is no path by which a guess becomes a row.
  if (fact.origin === "INFERRED") return "inferred facts are not storable";
  if (fact.sourceCommit !== null && typeof fact.sourceCommit !== "string") return "sourceCommit must be a string or null";
  if (typeof fact.sourceReference !== "string" || fact.sourceReference.trim() === "") return "sourceReference is empty";
  if (typeof fact.evidenceReference !== "string" || fact.evidenceReference.trim() === "") return "evidenceReference is empty";
  if (typeof fact.extractedAt !== "string" || !ISO_INSTANT.test(fact.extractedAt)) return "extractedAt is not an ISO instant";
  if (badInstant(fact.observedAt ?? null)) return "observedAt is not an ISO instant";
  if (badInstant(fact.sourceModifiedAt ?? null)) return "sourceModifiedAt is not an ISO instant";
  if (badInstant(fact.validFrom ?? null)) return "validFrom is not an ISO instant";
  if (badInstant(fact.validTo ?? null)) return "validTo is not an ISO instant";
  if (badInstant(fact.lastConfirmedAt ?? null)) return "lastConfirmedAt is not an ISO instant";
  if (typeof fact.confidence !== "string" || !CONFIDENCE_LEVELS_V1.includes(fact.confidence as ConfidenceLevelV1)) {
    return "confidence is not supported";
  }
  if (typeof fact.sensitivity !== "string" || sensitivityRank(fact.sensitivity) === Number.POSITIVE_INFINITY) {
    return "sensitivity is not a supported class";
  }
  if (typeof fact.freshnessState !== "string" || !FRESHNESS_STATES_V1.includes(fact.freshnessState as FreshnessStateV1)) {
    return "freshnessState is not supported";
  }
  if (typeof fact.freshnessEvidence !== "string" || fact.freshnessEvidence.trim() === "") {
    return "freshnessEvidence is empty";
  }
  if (typeof fact.temporalState !== "string" || !TEMPORAL_STATES_V1.includes(fact.temporalState as TemporalStateV1)) {
    return "temporalState is not supported";
  }
  if (typeof fact.conflictState !== "string" || !CONFLICT_STATES_V1.includes(fact.conflictState as ConflictStateV1)) {
    return "conflictState is not supported";
  }
  if (!isStringArray(fact.conflictsWith)) return "conflictsWith is not a string list";
  if (!isStringArray(fact.supersedes)) return "supersedes is not a string list";
  if (fact.supersededBy !== null && typeof fact.supersededBy !== "string") return "supersededBy must be a string or null";
  if (!Array.isArray(fact.eligibleUses) || fact.eligibleUses.length === 0) return "eligibleUses is empty";
  for (const use of fact.eligibleUses) {
    if (typeof use !== "string" || !ELIGIBLE_USES_V1.includes(use as EligibleUseV1)) return `eligibleUse is not supported: ${String(use)}`;
    if (ACTION_SHAPED_USE.test(use)) return `eligibleUse names an action rather than an analysis: ${use}`;
  }
  if (!Array.isArray(fact.eligibleProviders)) return "eligibleProviders is not a list";
  if (typeof fact.contentFingerprint !== "string" || fact.contentFingerprint.trim() === "") {
    return "contentFingerprint is empty";
  }
  if (typeof fact.version !== "number" || !Number.isFinite(fact.version) || fact.version < 1) return "version is not a positive number";
  if (CREDENTIAL_SHAPED.test(fact.predicate) || CREDENTIAL_SHAPED.test(fact.value)) {
    return "fact carries credential-shaped material";
  }
  if (fact.temporalState === "CURRENT" && fact.validTo !== null) {
    return "a current claim cannot already have ended";
  }
  return null;
}

export function claimKeyOf(subject: string, category: ContextCategoryV1, predicate: string): string {
  return `${subject}|${category}|${predicate}`;
}

/* -------------------------------------------------------------------------- */
/* Knowledge is not permission                                                 */
/* -------------------------------------------------------------------------- */

export interface ContextAuthorityAnswerV1 {
  /** Always false. There is no branch that returns true, and there is not meant to be one. */
  readonly granted: false;
  readonly reason: string;
  readonly requiredInstead: string;
}

/**
 * The only answer this package gives when asked whether a fact permits an action.
 *
 * Deliberately total and deliberately constant. A caller that wants to act on the Owner's behalf has
 * to go and get authority from the control plane; nothing it learns here moves that needle. Written
 * as a function rather than a comment so it can be called from the places that would otherwise be
 * tempted to reason "well, we know the employer, so...".
 */
export function authorityFromPersonalContext(fact: PersonalContextFactV1): ContextAuthorityAnswerV1 {
  return {
    granted: false,
    reason:
      `Personal context fact ${fact.factId} is evidence about the Owner, not permission to act on it. ` +
      "Knowing a system, an employer, or an address grants no access to any of them.",
    requiredInstead: "A fresh Owner-authorized directive naming the specific external action.",
  };
}
