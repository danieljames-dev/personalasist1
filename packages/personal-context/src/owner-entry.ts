/**
 * The Owner states things about themselves directly. No file, no schema, no JSON.
 *
 * Personal Context V1 could model current employment perfectly and could not accept it: every fact
 * had to arrive inside a declaration document, so "tell AION where you work" meant "hand-author a
 * JSON file with the right schema string". That is a real product gap, and it is the one that keeps
 * the whole store empty — a person will enroll a folder they already have long before they will
 * write a document to describe their own job.
 *
 * So this module takes plain values and produces the same provenance-backed facts the extractor
 * produces, with one deliberate difference: `origin` is `OWNER_ENTERED` rather than `EXTRACTED`, and
 * the review report never blurs the two. What the Owner said and what a document implied are
 * different kinds of evidence, and a reader deciding whether to trust a recommendation needs to see
 * which one they are looking at.
 *
 * ## Nothing is invented and nothing is mandatory
 *
 * Every field is optional. A value the Owner did not supply produces no fact — not a blank one, not
 * a placeholder, not a `"unknown"` string that later reads as data. That is why
 * {@link OwnerCurrentJobInputV1} has no required members: forcing an answer is how a system ends up
 * storing a guess the Owner made under mild pressure to fill in a form.
 *
 * ## Restatement, not accumulation
 *
 * A second submission is a full restatement of the current job by default. Facts from the previous
 * submission that the Owner did not repeat are retired rather than left live, because a skill list
 * that only ever grows stops describing anybody. Retired facts keep their provenance and are marked
 * superseded by the submission that replaced them — nothing is deleted, and the report can still
 * show what was previously stated.
 */

import type { ProviderIdV1 } from "@aion/director";

import {
  claimKeyOf,
  PERSONAL_CONTEXT_RECEIPT_SCHEMA_V1,
  PERSONAL_CONTEXT_SCHEMA_V1,
  validatePersonalContextFact,
  type ContextCategoryV1,
  type ContextSourceV1,
  type EligibleUseV1,
  type PersonalContextFactV1,
  type TemporalStateV1,
} from "./contracts.js";
import { providersEligibleForSensitivity } from "./disclosure.js";
import { normalizeValue } from "./extraction.js";
import { assessFreshness } from "./freshness.js";
import { digestOf, sha256Hex } from "./hash.js";
import type { PersonalContextStoreV1 } from "./store.js";
import { reconcileFacts } from "./reconcile.js";
import type { SyncReceiptV1 } from "./receipts.js";

/**
 * What the Owner can say about their current job. Every field optional, on purpose.
 *
 * The list fields take arrays because a person has more than one skill, and each item becomes its
 * own fact with its own provenance — so one obsolete tool can be retired without restating the rest.
 */
export interface OwnerCurrentJobInputV1 {
  readonly subject?: string;
  readonly employer?: string;
  readonly title?: string;
  readonly industry?: string;
  readonly responsibilities?: readonly string[];
  readonly tools?: readonly string[];
  readonly skills?: readonly string[];
  readonly projects?: readonly string[];
  readonly startDate?: string | null;
  /** Whether this job is current. Defaults to `CURRENT`, which is what "current job" means. */
  readonly standing?: TemporalStateV1;
  /** When the Owner last confirmed this is accurate. Defaults to the submission time. */
  readonly lastConfirmedAt?: string | null;
  /** `REPLACE` retires anything not restated. `MERGE` adds without retiring. */
  readonly mode?: "REPLACE" | "MERGE";
}

export interface OwnerEntryResultV1 {
  readonly entryId: string;
  readonly facts: readonly PersonalContextFactV1[];
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly retired: readonly string[];
  readonly unchanged: readonly string[];
  /** Fields the Owner did not supply. Reported so the gap is visible rather than assumed filled. */
  readonly notSupplied: readonly string[];
  readonly receipt: SyncReceiptV1;
}

export interface OwnerEntryDepsV1 {
  readonly store: PersonalContextStoreV1;
  readonly now: string;
}

/** Single-valued claims: one predicate, one fact, restated wholesale. */
const SINGLE_FIELDS = [
  ["employer", "employer", "CURRENT_EMPLOYMENT"],
  ["title", "title", "CURRENT_EMPLOYMENT"],
  ["industry", "industry", "CURRENT_EMPLOYMENT"],
  ["startDate", "startDate", "CURRENT_EMPLOYMENT"],
] as const;

/**
 * Multi-valued claims: one fact per item, with the item folded into the predicate.
 *
 * The predicate carries the item (`skill:typescript`) rather than the value alone, because
 * `claimKey` is `subject|category|predicate` and two skills sharing one predicate would look to the
 * reconciler like one slot with two competing answers — a permanent self-conflict between the
 * Owner's own skills. Folding the item in gives each its own slot, so they coexist, supersede
 * individually, and retire individually.
 */
const LIST_FIELDS = [
  ["responsibilities", "responsibility", "CURRENT_EMPLOYMENT"],
  ["tools", "tool", "TECHNOLOGY"],
  ["skills", "skill", "SKILL"],
  ["projects", "project", "PROJECT"],
] as const;

/** A short, stable, readable predicate suffix for one list item. */
function predicateFor(kind: string, item: string): string {
  const normalized = normalizeValue(item);
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  // A long responsibility truncates to the same slug as another long one often enough to matter, so
  // the digest keeps them distinct without making the predicate unreadable.
  return `${kind}:${slug === "" ? "item" : slug}-${digestOf([kind, normalized]).slice(0, 8)}`;
}

function cleaned(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Build the facts one submission implies. Pure: it reads nothing and writes nothing.
 *
 * Exported so a caller can preview exactly what would be stored before storing it — which is what
 * makes an Owner-facing confirmation step possible without a dry-run mode inside the store.
 */
/**
 * Build one Owner-stated fact. Shared by every entry path so they cannot drift apart.
 *
 * `validFrom` is threaded rather than assumed: a current job has a start date, a stated preference
 * does not, and inventing one for the second would put a fabricated date into provenance.
 */
function buildOwnerFact(
  source: ContextSourceV1,
  subject: string,
  category: ContextCategoryV1,
  predicate: string,
  value: string,
  options: { standing: TemporalStateV1; lastConfirmedAt: string; validFrom: string | null; now: string },
): PersonalContextFactV1 | null {
  const eligibleUses: readonly EligibleUseV1[] = ["JOB_MATCHING", "CAREER_SUMMARY", "SKILL_INVENTORY"];
  const eligibleProviders: readonly ProviderIdV1[] = providersEligibleForSensitivity(source.sensitivityClass)
    .filter((id) => source.eligibleProviders.includes(id));
  const claimKey = claimKeyOf(subject, category, predicate);
  const normalizedValue = normalizeValue(value);
  const freshness = assessFreshness({
    observedAt: null,
    lastConfirmedAt: options.lastConfirmedAt,
    sourceModifiedAt: null,
    temporalState: options.standing,
    validTo: null,
    now: options.now,
  });
  const fact: PersonalContextFactV1 = {
    schema: PERSONAL_CONTEXT_SCHEMA_V1,
    factId: digestOf([source.sourceId, "owner-entry", claimKey, normalizedValue]),
    claimKey,
    subject,
    category,
    predicate,
    value,
    normalizedValue,
    sourceId: source.sourceId,
    origin: "OWNER_ENTERED",
    sourceReference: "owner-entry",
    sourceCommit: null,
    evidenceReference: `Stated directly by the Owner on ${options.lastConfirmedAt}`,
    observedAt: options.lastConfirmedAt,
    sourceModifiedAt: null,
    extractedAt: options.now,
    // The Owner is the best available authority on their own life.
    confidence: "HIGH",
    sensitivity: source.sensitivityClass,
    freshnessState: freshness.state,
    freshnessEvidence: freshness.evidence,
    temporalState: options.standing,
    validFrom: options.validFrom,
    validTo: null,
    conflictState: "NONE",
    conflictsWith: [],
    supersedes: [],
    supersededBy: null,
    eligibleUses,
    eligibleProviders,
    contentFingerprint: sha256Hex(
      JSON.stringify([claimKey, value, normalizedValue, options.lastConfirmedAt, options.standing, options.validFrom]),
    ),
    version: 1,
    lastConfirmedAt: options.lastConfirmedAt,
  };
  return validatePersonalContextFact(fact) === null ? fact : null;
}

/** One group of Owner-stated values that share a category and a predicate kind. */
export interface OwnerFactGroupV1 {
  readonly category: ContextCategoryV1;
  /** Predicate prefix, e.g. `business`, `targetRole`, `avoid`. */
  readonly kind: string;
  readonly values: readonly string[];
  readonly standing?: TemporalStateV1;
}

export function buildOwnerCurrentJobFacts(
  input: OwnerCurrentJobInputV1,
  source: ContextSourceV1,
  now: string,
): { facts: readonly PersonalContextFactV1[]; notSupplied: readonly string[] } {
  const subject = cleaned(input.subject) ?? "owner";
  const standing: TemporalStateV1 = input.standing ?? "CURRENT";
  // The Owner is telling us this now, so "now" is the confirmation unless they date it themselves.
  const lastConfirmedAt = cleaned(input.lastConfirmedAt) ?? now;
  const startDate = cleaned(input.startDate);

  const facts: PersonalContextFactV1[] = [];
  const notSupplied: string[] = [];

  const emit = (category: ContextCategoryV1, predicate: string, value: string): void => {
    const fact = buildOwnerFact(source, subject, category, predicate, value, {
      standing,
      lastConfirmedAt,
      validFrom: startDate,
      now,
    });
    if (fact !== null) facts.push(fact);
  };

  for (const [field, predicate, category] of SINGLE_FIELDS) {
    const raw = field === "startDate" ? startDate : cleaned(input[field] as string | undefined);
    if (raw === null) {
      notSupplied.push(field);
      continue;
    }
    emit(category, predicate, raw);
  }

  for (const [field, kind, category] of LIST_FIELDS) {
    const items = (input[field] ?? []).map(cleaned).filter((item): item is string => item !== null);
    if (items.length === 0) {
      notSupplied.push(field);
      continue;
    }
    for (const item of items) emit(category, predicateFor(kind, item), item);
  }

  return { facts, notSupplied };
}

/**
 * Record what the Owner said, reconcile it against what is already known, and leave a receipt.
 *
 * The source row must already exist and be readable — enrollment stays the one place a source is
 * approved, even for a source that has no files.
 */
export function recordOwnerCurrentJob(
  sourceId: string,
  input: OwnerCurrentJobInputV1,
  deps: OwnerEntryDepsV1,
): OwnerEntryResultV1 | { readonly error: string } {
  const source = deps.store.loadSource(sourceId);
  if (source === null) return { error: `source is not registered: ${sourceId}` };
  if (source.activeState !== "ACTIVE") return { error: `source is ${source.activeState}, so it cannot accept entries` };
  if (source.sourceType !== "OWNER_ENTERED_CURRENT_JOB") {
    return { error: `source ${sourceId} is a ${source.sourceType}, not an Owner-entry source` };
  }

  const entryId = digestOf([sourceId, deps.now, "owner-entry"]);
  const { facts, notSupplied } = buildOwnerCurrentJobFacts(input, source, deps.now);
  const existing = deps.store.listFacts();
  const reconciled = reconcileFacts(existing, facts);

  // A restatement retires what it did not repeat. Marking rather than deleting keeps the earlier
  // statement answerable: the Owner can still see what they used to say and when they stopped.
  const submitted = new Set(facts.map((fact) => fact.factId));
  const retired: string[] = [];
  const merged = reconciled.facts.map((fact) => {
    const stale =
      (input.mode ?? "REPLACE") === "REPLACE" &&
      fact.sourceId === sourceId &&
      fact.origin === "OWNER_ENTERED" &&
      fact.supersededBy === null &&
      !submitted.has(fact.factId);
    if (!stale) return fact;
    retired.push(fact.factId);
    return { ...fact, supersededBy: entryId };
  });

  deps.store.saveFacts(merged);

  const receipt: SyncReceiptV1 = {
    schema: PERSONAL_CONTEXT_RECEIPT_SCHEMA_V1,
    receiptId: entryId,
    sourceId,
    milestoneId: source.milestoneId,
    ownerAuthorizationId: source.ownerAuthorizationId,
    outcome: "COMPLETED",
    denialReason: null,
    startedAt: deps.now,
    completedAt: deps.now,
    fingerprintBefore: source.fingerprint,
    fingerprintAfter: entryId,
    sourceVersionBefore: source.version,
    sourceVersionAfter: source.version + 1,
    // An Owner entry reads no file, and saying so plainly is more useful than inventing a count.
    filesConsidered: 0,
    filesRead: 0,
    filesUnsupported: 0,
    denials: [],
    boundaryEscapeAttempts: 0,
    truncatedBy: null,
    factsExtracted: facts.length,
    factsCreated: reconciled.created.length,
    factsUpdated: reconciled.updated.length,
    factsSuperseded: reconciled.superseded.length + retired.length,
    factsUnchanged: reconciled.unchanged.length,
    conflictsDetected: reconciled.conflicts.length,
    conflictsConfirmed: reconciled.conflicts.filter((row) => row.state === "CONFIRMED").length,
    skips: [],
    errors: [],
  };
  deps.store.saveReceipt(receipt);

  deps.store.saveSource({
    ...source,
    lastAttemptedSync: deps.now,
    lastSuccessfulSync: deps.now,
    fingerprint: entryId,
    version: source.version + 1,
    updatedAt: deps.now,
  });

  return {
    entryId,
    facts,
    created: reconciled.created,
    updated: reconciled.updated,
    retired: retired.sort(),
    unchanged: reconciled.unchanged,
    notSupplied,
    receipt,
  };
}


export interface OwnerFactsResultV1 {
  readonly entryId: string;
  readonly facts: readonly PersonalContextFactV1[];
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly retired: readonly string[];
  readonly unchanged: readonly string[];
  readonly receipt: SyncReceiptV1;
}

/**
 * Record Owner-stated facts that are not the current job — businesses, preferences, constraints, goals.
 *
 * Kept as a separate call against a separate source rather than folded into
 * {@link recordOwnerCurrentJob}, because restatement retires within a source: enrolling a preference
 * must not retire an employment fact stated an hour earlier. One source per kind of statement also
 * means the Owner can revoke their preferences without revoking their job history.
 */
export function recordOwnerFacts(
  sourceId: string,
  groups: readonly OwnerFactGroupV1[],
  deps: OwnerEntryDepsV1 & { readonly subject?: string; readonly mode?: "REPLACE" | "MERGE" },
): OwnerFactsResultV1 | { readonly error: string } {
  const source = deps.store.loadSource(sourceId);
  if (source === null) return { error: `source is not registered: ${sourceId}` };
  if (source.activeState !== "ACTIVE") return { error: `source is ${source.activeState}, so it cannot accept entries` };

  const subject = cleaned(deps.subject) ?? "owner";
  const entryId = digestOf([sourceId, deps.now, "owner-facts"]);
  const built: PersonalContextFactV1[] = [];

  for (const group of groups) {
    for (const raw of group.values) {
      const value = cleaned(raw);
      if (value === null) continue;
      const fact = buildOwnerFact(source, subject, group.category, predicateFor(group.kind, value), value, {
        standing: group.standing ?? "CURRENT",
        lastConfirmedAt: deps.now,
        validFrom: null,
        now: deps.now,
      });
      if (fact !== null) built.push(fact);
    }
  }

  const reconciled = reconcileFacts(deps.store.listFacts(), built);
  const submitted = new Set(built.map((fact) => fact.factId));
  const retired: string[] = [];
  const merged = reconciled.facts.map((fact) => {
    const stale =
      (deps.mode ?? "REPLACE") === "REPLACE" &&
      fact.sourceId === sourceId &&
      fact.origin === "OWNER_ENTERED" &&
      fact.supersededBy === null &&
      !submitted.has(fact.factId);
    if (!stale) return fact;
    retired.push(fact.factId);
    return { ...fact, supersededBy: entryId };
  });
  deps.store.saveFacts(merged);

  const receipt: SyncReceiptV1 = {
    schema: PERSONAL_CONTEXT_RECEIPT_SCHEMA_V1,
    receiptId: entryId,
    sourceId,
    milestoneId: source.milestoneId,
    ownerAuthorizationId: source.ownerAuthorizationId,
    outcome: "COMPLETED",
    denialReason: null,
    startedAt: deps.now,
    completedAt: deps.now,
    fingerprintBefore: source.fingerprint,
    fingerprintAfter: entryId,
    sourceVersionBefore: source.version,
    sourceVersionAfter: source.version + 1,
    filesConsidered: 0,
    filesRead: 0,
    filesUnsupported: 0,
    denials: [],
    boundaryEscapeAttempts: 0,
    truncatedBy: null,
    factsExtracted: built.length,
    factsCreated: reconciled.created.length,
    factsUpdated: reconciled.updated.length,
    factsSuperseded: reconciled.superseded.length + retired.length,
    factsUnchanged: reconciled.unchanged.length,
    conflictsDetected: reconciled.conflicts.length,
    conflictsConfirmed: reconciled.conflicts.filter((row) => row.state === "CONFIRMED").length,
    skips: [],
    errors: [],
  };
  deps.store.saveReceipt(receipt);
  deps.store.saveSource({
    ...source,
    lastAttemptedSync: deps.now,
    lastSuccessfulSync: deps.now,
    fingerprint: entryId,
    version: source.version + 1,
    updatedAt: deps.now,
  });

  return {
    entryId,
    facts: built,
    created: reconciled.created,
    updated: reconciled.updated,
    retired: retired.sort(),
    unchanged: reconciled.unchanged,
    receipt,
  };
}
