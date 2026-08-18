/**
 * How current a claim is, decided from evidence about the claim rather than evidence about the file.
 *
 * The distinction is the whole point. `mtime` says when bytes last changed on disk; it says nothing
 * about whether the sentence inside those bytes is still true. Copying a 2019 resume into a new
 * folder this morning produces a file modified today containing facts six years stale, and any rule
 * that reads `mtime` as currency will confidently hand that to a job recommender.
 *
 * So a filesystem timestamp is never promoted to a freshness basis. When the document itself carries
 * no "as of" or "last confirmed" date, the honest answer is {@link FreshnessStateV1} of
 * `UNKNOWN_FRESHNESS`, and the recorded evidence says explicitly that a modification time was
 * available and was not used. Downstream retrieval can then require better than unknown, instead of
 * being told a comforting lie.
 */

import type { FreshnessStateV1, TemporalStateV1 } from "./contracts.js";

/** At or under this age, a confirmed claim is treated as describing now. */
export const CURRENT_WITHIN_DAYS = 90;
/** Beyond `CURRENT_WITHIN_DAYS` and at or under this, a claim is recent but not necessarily now. */
export const RECENT_WITHIN_DAYS = 365;

const MS_PER_DAY = 86_400_000;

export type FreshnessBasisV1 = "LAST_CONFIRMED" | "OBSERVED" | "TEMPORAL_STATE" | "NONE";

export interface FreshnessInputV1 {
  /** When the document says the claim was true. */
  readonly observedAt: string | null;
  /** When the Owner or a source last re-confirmed it. Stronger than `observedAt` when present. */
  readonly lastConfirmedAt: string | null;
  /** Filesystem modification time. Recorded for provenance; never a freshness basis. */
  readonly sourceModifiedAt: string | null;
  readonly temporalState: TemporalStateV1;
  readonly validTo: string | null;
  readonly now: string;
}

export interface FreshnessAssessmentV1 {
  readonly state: FreshnessStateV1;
  readonly basis: FreshnessBasisV1;
  readonly ageDays: number | null;
  /** Human-readable reasoning, persisted with the fact so a reader can disagree with the rule. */
  readonly evidence: string;
}

function instant(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function assessFreshness(input: FreshnessInputV1): FreshnessAssessmentV1 {
  const now = instant(input.now);
  if (now === null) {
    return {
      state: "UNKNOWN_FRESHNESS",
      basis: "NONE",
      ageDays: null,
      evidence: "The evaluation time was unreadable, so no age could be computed.",
    };
  }

  const validTo = instant(input.validTo);
  if (input.temporalState === "HISTORICAL" || (validTo !== null && validTo <= now)) {
    return {
      state: "HISTORICAL",
      basis: "TEMPORAL_STATE",
      ageDays: null,
      evidence:
        input.temporalState === "HISTORICAL"
          ? "The source states this claim describes the past."
          : `The claim's validity ended at ${String(input.validTo)}.`,
    };
  }

  const confirmed = instant(input.lastConfirmedAt);
  const observed = instant(input.observedAt);
  const basisValue = confirmed ?? observed;
  const basis: FreshnessBasisV1 = confirmed !== null ? "LAST_CONFIRMED" : observed !== null ? "OBSERVED" : "NONE";

  if (basisValue === null) {
    const modifiedNote =
      input.sourceModifiedAt === null
        ? "No document date and no file modification time were available."
        : `A file modification time (${input.sourceModifiedAt}) was available but is evidence about the file, ` +
          "not about when the claim was true, so it was not used.";
    return {
      state: "UNKNOWN_FRESHNESS",
      basis: "NONE",
      ageDays: null,
      evidence: `${modifiedNote} Freshness is unknown rather than assumed.`,
    };
  }

  const ageMs = now - basisValue;
  if (ageMs < 0) {
    return {
      state: "UNKNOWN_FRESHNESS",
      basis,
      ageDays: null,
      evidence: "The claim's own timestamp is in the future, so it cannot be aged against the present.",
    };
  }

  const ageDays = Math.floor(ageMs / MS_PER_DAY);
  const label = basis === "LAST_CONFIRMED" ? "last confirmed" : "observed";
  if (ageDays <= CURRENT_WITHIN_DAYS) {
    return {
      state: "CURRENT",
      basis,
      ageDays,
      evidence: `The claim was ${label} ${ageDays} day(s) ago, within the ${CURRENT_WITHIN_DAYS}-day current window.`,
    };
  }
  if (ageDays <= RECENT_WITHIN_DAYS) {
    return {
      state: "RECENT",
      basis,
      ageDays,
      evidence: `The claim was ${label} ${ageDays} day(s) ago, beyond the ${CURRENT_WITHIN_DAYS}-day current window but within ${RECENT_WITHIN_DAYS} days.`,
    };
  }
  return {
    state: "STALE",
    basis,
    ageDays,
    evidence: `The claim was ${label} ${ageDays} day(s) ago, beyond the ${RECENT_WITHIN_DAYS}-day recency window.`,
  };
}

const FRESHNESS_STRENGTH: Readonly<Record<FreshnessStateV1, number>> = {
  CURRENT: 4,
  RECENT: 3,
  STALE: 2,
  HISTORICAL: 1,
  UNKNOWN_FRESHNESS: 0,
};

/** Whether `state` is at least as fresh as `minimum`. Unknown never satisfies a real requirement. */
export function freshnessAtLeast(state: FreshnessStateV1, minimum: FreshnessStateV1): boolean {
  return FRESHNESS_STRENGTH[state] >= FRESHNESS_STRENGTH[minimum];
}
