/**
 * The only door out of the Personal Context store, and it is deliberately narrow.
 *
 * The alternative — hand the worker everything and let the prompt sort it out — fails in three ways
 * at once. It sends facts to providers that are not eligible for them. It sends stale claims with no
 * marker saying so. And it makes every job's disclosure equal to the whole store, so the blast radius
 * of one careless prompt is the Owner's entire life.
 *
 * So a retrieval states what it needs — an objective, a subject, some categories, a sensitivity
 * ceiling, a freshness floor, a size budget — and gets back only what satisfies all of it, plus an
 * itemised account of what was left out and why. The omissions are not diagnostics; they are part of
 * the answer. A recommender that knows six facts were withheld for staleness behaves differently
 * from one that thinks it saw everything.
 *
 * Conflicts travel with the facts rather than being resolved here. If two approved sources disagree
 * about the current employer, both are disclosed and both are flagged, because a retrieval layer
 * that silently picks one is the silent overwrite this system was built to avoid, moved one layer up.
 */

import type { ProviderIdV1, SensitivityClassV1 } from "@aion/director";

import {
  PERSONAL_CONTEXT_RETRIEVAL_SCHEMA_V1,
  sensitivityWithin,
  type ContextCategoryV1,
  type ContextSourceV1,
  type EligibleUseV1,
  type FreshnessStateV1,
  type PersonalContextFactV1,
} from "./contracts.js";
import { discloseForProvider } from "./disclosure.js";
import { freshnessAtLeast } from "./freshness.js";
import { digestOf } from "./hash.js";
import type { PersonalContextStoreV1 } from "./store.js";

export type OmissionReasonV1 =
  | "SOURCE_REVOKED"
  | "SOURCE_DISABLED"
  | "SOURCE_UNKNOWN"
  | "SUBJECT_MISMATCH"
  | "SUPERSEDED"
  | "CATEGORY_NOT_REQUESTED"
  | "USE_NOT_ALLOWED"
  | "SENSITIVITY_ABOVE_CEILING"
  | "PROVIDER_NOT_ELIGIBLE"
  | "FRESHNESS_BELOW_REQUIREMENT"
  | "MAX_ITEMS_REACHED"
  | "MAX_CHARACTERS_REACHED";

export interface OmissionV1 {
  readonly reason: OmissionReasonV1;
  readonly count: number;
  /** Ids only. An omitted fact's value never appears in the response. */
  readonly factIds: readonly string[];
}

export interface ContextRequestV1 {
  readonly jobId: string;
  readonly objective: string;
  readonly subject: string;
  readonly categories: readonly ContextCategoryV1[];
  readonly provider: ProviderIdV1;
  readonly sensitivityCeiling: SensitivityClassV1;
  readonly minimumFreshness: FreshnessStateV1;
  readonly maxItems: number;
  readonly maxCharacters: number;
  readonly allowedUses: readonly EligibleUseV1[];
}

export interface DisclosedFactV1 {
  readonly factId: string;
  readonly category: ContextCategoryV1;
  readonly predicate: string;
  readonly value: string;
  readonly sensitivity: SensitivityClassV1;
  readonly temporalState: string;
  readonly freshnessState: FreshnessStateV1;
  readonly freshnessEvidence: string;
  readonly observedAt: string | null;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly conflictState: string;
  readonly conflictsWith: readonly string[];
  readonly provenance: {
    readonly sourceId: string;
    readonly sourceDisplayName: string;
    readonly sourceReference: string;
    readonly evidenceReference: string;
    readonly extractedAt: string;
    readonly contentFingerprint: string;
  };
}

export interface ConflictWarningV1 {
  readonly claimKey: string;
  readonly state: string;
  readonly factIds: readonly string[];
  readonly message: string;
}

export interface ContextResponseV1 {
  readonly schema: typeof PERSONAL_CONTEXT_RETRIEVAL_SCHEMA_V1;
  readonly jobId: string;
  readonly objective: string;
  readonly subject: string;
  readonly provider: ProviderIdV1;
  readonly facts: readonly DisclosedFactV1[];
  readonly conflictWarnings: readonly ConflictWarningV1[];
  readonly omissions: readonly OmissionV1[];
  /** Identifies exactly this disclosure, so a later job can tell whether context changed underneath it. */
  readonly contextFingerprint: string;
  readonly truncated: boolean;
  readonly characterCount: number;
}

const FRESHNESS_RANK: Readonly<Record<FreshnessStateV1, number>> = {
  CURRENT: 4,
  RECENT: 3,
  STALE: 2,
  HISTORICAL: 1,
  UNKNOWN_FRESHNESS: 0,
};

function factCharacters(fact: PersonalContextFactV1): number {
  return fact.predicate.length + fact.value.length + fact.evidenceReference.length + fact.freshnessEvidence.length;
}

/**
 * Select the smallest set of facts that answers this request, and report everything it did not send.
 *
 * The filters run cheapest-and-most-decisive first so an omission is attributed to the reason a
 * reader would consider primary: a fact from a revoked source is reported as revoked, not as
 * "provider ineligible", even when both are true.
 */
export function getContextForJob(
  request: ContextRequestV1,
  deps: { readonly store: PersonalContextStoreV1 },
): ContextResponseV1 {
  const sources = new Map<string, ContextSourceV1>(deps.store.listSources().map((row) => [row.sourceId, row]));
  const omitted = new Map<OmissionReasonV1, string[]>();
  const omit = (reason: OmissionReasonV1, factId: string): void => {
    const bucket = omitted.get(reason);
    if (bucket === undefined) omitted.set(reason, [factId]);
    else bucket.push(factId);
  };

  const categories = new Set(request.categories);
  const allowedUses = new Set(request.allowedUses);

  const candidates: PersonalContextFactV1[] = [];
  for (const fact of deps.store.listFacts()) {
    const source = sources.get(fact.sourceId);
    if (source === undefined) {
      omit("SOURCE_UNKNOWN", fact.factId);
      continue;
    }
    // Revocation is enforced here rather than by deleting facts, so the provenance of anything a past
    // job already saw survives while nothing new is disclosed.
    if (source.activeState === "REVOKED") {
      omit("SOURCE_REVOKED", fact.factId);
      continue;
    }
    if (source.activeState === "DISABLED") {
      omit("SOURCE_DISABLED", fact.factId);
      continue;
    }
    if (fact.subject !== request.subject) {
      omit("SUBJECT_MISMATCH", fact.factId);
      continue;
    }
    if (fact.supersededBy !== null) {
      omit("SUPERSEDED", fact.factId);
      continue;
    }
    if (categories.size > 0 && !categories.has(fact.category)) {
      omit("CATEGORY_NOT_REQUESTED", fact.factId);
      continue;
    }
    if (allowedUses.size > 0 && !fact.eligibleUses.some((use) => allowedUses.has(use))) {
      omit("USE_NOT_ALLOWED", fact.factId);
      continue;
    }
    if (!sensitivityWithin(fact.sensitivity, request.sensitivityCeiling)) {
      omit("SENSITIVITY_ABOVE_CEILING", fact.factId);
      continue;
    }
    if (!freshnessAtLeast(fact.freshnessState, request.minimumFreshness)) {
      omit("FRESHNESS_BELOW_REQUIREMENT", fact.factId);
      continue;
    }
    candidates.push(fact);
  }

  // Provider eligibility is applied through the same function a failover would use, so there is one
  // rule rather than a retrieval copy that could drift from the disclosure copy.
  const disclosure = discloseForProvider(candidates, request.provider);
  for (const withheld of disclosure.withheld) omit("PROVIDER_NOT_ELIGIBLE", withheld.factId);

  const ordered = [...disclosure.disclosed].sort((a, b) => {
    const sourceA = sources.get(a.sourceId);
    const sourceB = sources.get(b.sourceId);
    const priority = (sourceB?.priority ?? 0) - (sourceA?.priority ?? 0);
    if (priority !== 0) return priority;
    const freshness = FRESHNESS_RANK[b.freshnessState] - FRESHNESS_RANK[a.freshnessState];
    if (freshness !== 0) return freshness;
    const observed = (b.observedAt ?? "").localeCompare(a.observedAt ?? "");
    if (observed !== 0) return observed;
    return a.factId.localeCompare(b.factId);
  });

  const selected: PersonalContextFactV1[] = [];
  let characters = 0;
  let truncated = false;
  for (const fact of ordered) {
    if (selected.length >= request.maxItems) {
      omit("MAX_ITEMS_REACHED", fact.factId);
      truncated = true;
      continue;
    }
    const cost = factCharacters(fact);
    if (characters + cost > request.maxCharacters) {
      omit("MAX_CHARACTERS_REACHED", fact.factId);
      truncated = true;
      continue;
    }
    characters += cost;
    selected.push(fact);
  }

  const facts: DisclosedFactV1[] = selected.map((fact) => ({
    factId: fact.factId,
    category: fact.category,
    predicate: fact.predicate,
    value: fact.value,
    sensitivity: fact.sensitivity,
    temporalState: fact.temporalState,
    freshnessState: fact.freshnessState,
    freshnessEvidence: fact.freshnessEvidence,
    observedAt: fact.observedAt,
    validFrom: fact.validFrom,
    validTo: fact.validTo,
    conflictState: fact.conflictState,
    conflictsWith: fact.conflictsWith,
    provenance: {
      sourceId: fact.sourceId,
      sourceDisplayName: sources.get(fact.sourceId)?.displayName ?? fact.sourceId,
      sourceReference: fact.sourceReference,
      evidenceReference: fact.evidenceReference,
      extractedAt: fact.extractedAt,
      contentFingerprint: fact.contentFingerprint,
    },
  }));

  const warnings = new Map<string, ConflictWarningV1>();
  for (const fact of selected) {
    if (fact.conflictState === "NONE") continue;
    const existing = warnings.get(fact.claimKey);
    const ids = new Set([...(existing?.factIds ?? []), fact.factId, ...fact.conflictsWith]);
    warnings.set(fact.claimKey, {
      claimKey: fact.claimKey,
      state: fact.conflictState,
      factIds: [...ids].sort(),
      message:
        `Approved sources disagree about ${fact.claimKey}. ` +
        "Both statements are disclosed with their provenance; this is not settled truth.",
    });
  }

  const omissions: OmissionV1[] = [...omitted.entries()]
    .map(([reason, factIds]) => ({ reason, count: factIds.length, factIds: [...factIds].sort() }))
    .sort((a, b) => a.reason.localeCompare(b.reason));

  return {
    schema: PERSONAL_CONTEXT_RETRIEVAL_SCHEMA_V1,
    jobId: request.jobId,
    objective: request.objective,
    subject: request.subject,
    provider: request.provider,
    facts,
    conflictWarnings: [...warnings.values()].sort((a, b) => a.claimKey.localeCompare(b.claimKey)),
    omissions,
    contextFingerprint: digestOf(selected.map((fact) => `${fact.factId}:${fact.contentFingerprint}`)),
    truncated,
    characterCount: characters,
  };
}
