/**
 * Experience and Learning Ledger V1 — what was tried, what happened, and what that taught.
 *
 * A discovery harness that forgets is a harness that re-discovers. The expensive part of the last
 * five milestones was not finding each defect; it was that each finding lived in a handoff nobody
 * queried, so the same class of mistake was made again in a new place. This is the durable record,
 * and it is deliberately small: an entry, where it came from, when it was true, and what replaced it.
 *
 * Three fields carry the weight:
 *
 *   **provenance** — a lesson learned from a synthetic scenario is not a lesson learned from a real
 *   incident, and treating them alike is how a harness talks itself into confidence. Where a claim
 *   came from travels with it.
 *
 *   **observedAtUtc** — a lesson is a statement about a commit. Once the code moves, the lesson is a
 *   historical fact rather than a current one, and `freshnessAgainst` says which.
 *
 *   **supersededBy** — findings get overturned. A ledger that only appends is a ledger where the
 *   wrong answer stays as loud as the right one, so supersession is explicit and one-directional.
 */

export const EXPERIENCE_LEDGER_SCHEMA_V1 = "aion.harness.experienceLedger.v1" as const;

/** Where a claim came from. Ordered weakest to strongest evidence, deliberately. */
export const EXPERIENCE_PROVENANCE_V1 = [
  "SYNTHETIC_SCENARIO",
  "HARNESS_CAMPAIGN",
  "BUILDER_VERIFICATION",
  "INDEPENDENT_REVIEW",
  "REAL_INCIDENT",
] as const;
export type ExperienceProvenanceV1 = (typeof EXPERIENCE_PROVENANCE_V1)[number];

export type ExperienceOutcomeV1 = "HELD" | "VIOLATED" | "INCONCLUSIVE";

export interface ExperienceEntryV1 {
  readonly schema: typeof EXPERIENCE_LEDGER_SCHEMA_V1;
  readonly entryId: string;
  /** What was tried, in terms a person can re-run. */
  readonly attempted: string;
  /** What actually happened, from the observation rather than from a return value. */
  readonly observed: string;
  /** What it means. Empty when nothing was learned, which is a legitimate result. */
  readonly learned: string;
  readonly outcome: ExperienceOutcomeV1;
  readonly provenance: ExperienceProvenanceV1;
  /** The commit the claim was true of. */
  readonly observedAtSha: string;
  readonly observedAtUtc: string;
  /** Entry id that overturned this one, or empty. */
  readonly supersededBy: string;
  readonly scenarioId: string;
  readonly violations: readonly string[];
}

export type ExperienceFreshnessV1 = "CURRENT" | "STALE_CODE_MOVED" | "SUPERSEDED";

export interface ExperienceLedgerV1 {
  readonly record: (entry: Omit<ExperienceEntryV1, "schema" | "supersededBy">) => ExperienceEntryV1;
  readonly supersede: (entryId: string, bySupersedingEntryId: string) => boolean;
  readonly entries: () => readonly ExperienceEntryV1[];
  readonly freshnessAgainst: (sha: string) => ReadonlyMap<string, ExperienceFreshnessV1>;
  readonly current: (sha: string) => readonly ExperienceEntryV1[];
  readonly serialize: () => string;
}

/**
 * An in-memory ledger with a durable serialisation.
 *
 * V1 does not choose a storage location — that is a decision about where AION's memory lives, and it
 * belongs to a milestone that is about memory rather than one that is about discovery. Serialising is
 * enough for a campaign to leave a durable artifact behind.
 */
export function createExperienceLedger(seed: readonly ExperienceEntryV1[] = []): ExperienceLedgerV1 {
  const entries: ExperienceEntryV1[] = [...seed];

  const record: ExperienceLedgerV1["record"] = (input) => {
    const entry: ExperienceEntryV1 = {
      schema: EXPERIENCE_LEDGER_SCHEMA_V1,
      supersededBy: "",
      ...input,
    };
    entries.push(entry);
    return entry;
  };

  const supersede: ExperienceLedgerV1["supersede"] = (entryId, bySupersedingEntryId) => {
    if (entryId === bySupersedingEntryId) return false;
    const index = entries.findIndex((row) => row.entryId === entryId);
    if (index < 0) return false;
    // Already superseded stays superseded by whatever overturned it first: rewriting that would let a
    // later entry quietly claim authorship of an older correction.
    if (entries[index]!.supersededBy !== "") return false;
    if (!entries.some((row) => row.entryId === bySupersedingEntryId)) return false;
    entries[index] = { ...entries[index]!, supersededBy: bySupersedingEntryId };
    return true;
  };

  const freshnessAgainst: ExperienceLedgerV1["freshnessAgainst"] = (sha) => {
    const out = new Map<string, ExperienceFreshnessV1>();
    for (const entry of entries) {
      if (entry.supersededBy !== "") out.set(entry.entryId, "SUPERSEDED");
      else if (entry.observedAtSha !== sha) out.set(entry.entryId, "STALE_CODE_MOVED");
      else out.set(entry.entryId, "CURRENT");
    }
    return out;
  };

  return {
    record,
    supersede,
    entries: () => [...entries],
    freshnessAgainst,
    current: (sha) => entries.filter((entry) => entry.supersededBy === "" && entry.observedAtSha === sha),
    serialize: () => JSON.stringify({ schema: EXPERIENCE_LEDGER_SCHEMA_V1, entries }, null, 2),
  };
}

/* ========================================================================== */
/* Durable home, business context, contradiction and expiry                   */
/* ========================================================================== */

/*
 * The V1 comment above said storage "belongs to a milestone that is about memory rather than one
 * that is about discovery". This is that milestone, so the ledger gets a home — and the three things
 * a memory needs beyond an append log.
 *
 * **Business context**, because an outcome is evidence *about something*. "This strategy worked"
 * is not a portfolio-level claim; "this worked for LocalFinds" is.
 *
 * **Contradiction**, because two entries can disagree without either being superseded yet. Marking
 * the disagreement is honest; silently preferring the newer one is not, and silently preferring the
 * louder one is worse.
 *
 * **Expiry**, because some facts are true until a date and then are not. An expired entry is not
 * wrong, it is no longer evidence.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "./atomic-write.js";

export const EXPERIENCE_STORE_RELATIVE_PATH = ".aion-local/autonomy/experience.json";

/** Context that makes an entry evidence about something rather than in general. */
export interface ExperienceContextV1 {
  readonly businessId: string;
  readonly objectiveId: string;
  readonly taskType: string;
}

export interface DurableExperienceEntryV1 extends ExperienceEntryV1 {
  readonly context: ExperienceContextV1 | null;
  /** Entry ids this one disagrees with. Symmetric by convention, recorded on both. */
  readonly contradicts: readonly string[];
  /** ISO instant after which this is no longer evidence, or empty for no expiry. */
  readonly expiresAtUtc: string;
}

export type DurableFreshnessV1 = ExperienceFreshnessV1 | "EXPIRED" | "CONTRADICTED";

export interface DurableExperienceLedgerV1 {
  readonly record: (
    entry: Omit<ExperienceEntryV1, "schema" | "supersededBy">
      & { context?: ExperienceContextV1; contradicts?: readonly string[]; expiresAtUtc?: string },
  ) => DurableExperienceEntryV1;
  readonly supersede: (entryId: string, bySupersedingEntryId: string) => boolean;
  /** Marks a two-way disagreement. Neither entry wins; the conflict is the record. */
  readonly markContradiction: (left: string, right: string) => boolean;
  readonly entries: () => readonly DurableExperienceEntryV1[];
  readonly freshnessAgainst: (sha: string, now: string) => ReadonlyMap<string, DurableFreshnessV1>;
  /** Entries that are still evidence: current sha, not superseded, not expired, not contradicted. */
  readonly usable: (sha: string, now: string) => readonly DurableExperienceEntryV1[];
  readonly forBusiness: (businessId: string) => readonly DurableExperienceEntryV1[];
  readonly flush: () => void;
}

/**
 * A ledger backed by one file.
 *
 * Loaded at construction and written on every change, because the reason it exists is to survive a
 * restart. `flush` is exposed for a caller that wants to be explicit; nothing depends on it being
 * called.
 */
export function createDurableExperienceLedger(root: string): DurableExperienceLedgerV1 {
  const path = join(root, "experience.json");

  let entries: DurableExperienceEntryV1[] = [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { entries?: DurableExperienceEntryV1[] };
    entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    entries = [];
  }

  const flush = () => {
    writeAtomic(path, `${JSON.stringify({ schema: EXPERIENCE_LEDGER_SCHEMA_V1, entries }, null, 2)}\n`);
  };

  return {
    record(input) {
      const { context, contradicts, expiresAtUtc, ...base } = input;
      const entry: DurableExperienceEntryV1 = {
        schema: EXPERIENCE_LEDGER_SCHEMA_V1,
        supersededBy: "",
        ...base,
        context: context ?? null,
        contradicts: contradicts ?? [],
        expiresAtUtc: expiresAtUtc ?? "",
      };
      entries.push(entry);
      flush();
      return entry;
    },
    supersede(entryId, bySupersedingEntryId) {
      if (entryId === bySupersedingEntryId) return false;
      const index = entries.findIndex((row) => row.entryId === entryId);
      if (index < 0) return false;
      if (entries[index]!.supersededBy !== "") return false;
      if (!entries.some((row) => row.entryId === bySupersedingEntryId)) return false;
      entries[index] = { ...entries[index]!, supersededBy: bySupersedingEntryId };
      flush();
      return true;
    },
    markContradiction(left, right) {
      if (left === right) return false;
      const a = entries.findIndex((row) => row.entryId === left);
      const b = entries.findIndex((row) => row.entryId === right);
      if (a < 0 || b < 0) return false;
      const add = (index: number, other: string) => {
        const row = entries[index]!;
        if (row.contradicts.includes(other)) return;
        entries[index] = { ...row, contradicts: [...row.contradicts, other] };
      };
      add(a, right);
      add(b, left);
      flush();
      return true;
    },
    entries: () => [...entries],
    freshnessAgainst(sha, now) {
      const out = new Map<string, DurableFreshnessV1>();
      for (const entry of entries) {
        if (entry.supersededBy !== "") out.set(entry.entryId, "SUPERSEDED");
        else if (entry.expiresAtUtc !== "" && entry.expiresAtUtc <= now) out.set(entry.entryId, "EXPIRED");
        else if (entry.contradicts.length > 0) out.set(entry.entryId, "CONTRADICTED");
        else if (entry.observedAtSha !== sha) out.set(entry.entryId, "STALE_CODE_MOVED");
        else out.set(entry.entryId, "CURRENT");
      }
      return out;
    },
    usable(sha, now) {
      const freshness = this.freshnessAgainst(sha, now);
      return entries.filter((entry) => freshness.get(entry.entryId) === "CURRENT");
    },
    forBusiness(businessId) {
      return entries.filter((entry) => entry.context?.businessId === businessId);
    },
    flush,
  };
}

/**
 * Whether repeated outcomes are strong enough to move a preference.
 *
 * One outcome informs. Repeated *verified* outcomes may shift preference. A self-report with no
 * observable outcome never becomes strong evidence, however many times it is repeated — which is the
 * rule that stops a system convincing itself by talking.
 */
export const WEAK_PROVENANCE_V1: readonly ExperienceProvenanceV1[] = ["SYNTHETIC_SCENARIO"];
export const PREFERENCE_EVIDENCE_THRESHOLD_V1 = 2;

export function preferenceStrength(
  entries: readonly DurableExperienceEntryV1[],
): { readonly strong: boolean; readonly observed: number; readonly reason: string } {
  const observed = entries.filter(
    (entry) => entry.outcome !== "INCONCLUSIVE" && !WEAK_PROVENANCE_V1.includes(entry.provenance),
  ).length;
  if (observed >= PREFERENCE_EVIDENCE_THRESHOLD_V1) {
    return { strong: true, observed, reason: `${observed} observable outcomes` };
  }
  return {
    strong: false,
    observed,
    reason: observed === 0
      ? "no observable outcome; self-report is never strong evidence"
      : `${observed} observable outcome(s); ${PREFERENCE_EVIDENCE_THRESHOLD_V1} needed to move a preference`,
  };
}
