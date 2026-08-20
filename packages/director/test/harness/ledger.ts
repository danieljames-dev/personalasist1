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
