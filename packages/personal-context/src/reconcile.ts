/**
 * What happens when two approved sources describe the same slot differently.
 *
 * The tempting design is a winner: pick the newer file, or the higher-priority source, overwrite the
 * loser, move on. It is tempting because it produces a clean store. It is wrong because the cleanest
 * possible store is one that has quietly deleted the evidence that the answer is uncertain — and the
 * downstream consumer, seeing exactly one employer, has no way to know it was ever a coin flip.
 *
 * So nothing is ever overwritten here. A newer statement from the *same* source supersedes the older
 * one and both rows survive, linked. A different statement from a *different* source is a conflict
 * that gets recorded on both rows, unless the two claims are about different periods — in which case
 * they were never in conflict at all, and saying so is the difference between a career history and a
 * contradiction.
 *
 * Source priority appears nowhere in this file. Priority may order what a retrieval shows first; it
 * may not decide what exists.
 */

import type { PersonalContextFactV1 } from "./contracts.js";

export interface ConflictRecordV1 {
  readonly claimKey: string;
  readonly state: "POTENTIAL" | "CONFIRMED";
  readonly factIds: readonly string[];
  readonly reason: string;
}

export interface ReconcileResultV1 {
  /** Every fact that now exists, superseded ones included. Nothing is dropped. */
  readonly facts: readonly PersonalContextFactV1[];
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly superseded: readonly string[];
  readonly unchanged: readonly string[];
  readonly conflicts: readonly ConflictRecordV1[];
}

function instant(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Whether two claims cover periods that cannot both be true at once.
 *
 * Open-ended on either side means "still running as far as this document knows", which overlaps
 * everything after its start. Only a closed interval that ends at or before the other's start is
 * genuinely disjoint.
 */
export function periodsAreDisjoint(a: PersonalContextFactV1, b: PersonalContextFactV1): boolean {
  const aFrom = instant(a.validFrom);
  const aTo = instant(a.validTo);
  const bFrom = instant(b.validFrom);
  const bTo = instant(b.validTo);
  if (aTo !== null && bFrom !== null && aTo <= bFrom) return true;
  if (bTo !== null && aFrom !== null && bTo <= aFrom) return true;
  return false;
}

function withConflict(
  fact: PersonalContextFactV1,
  state: "NONE" | "POTENTIAL" | "CONFIRMED",
  partners: readonly string[],
): PersonalContextFactV1 {
  return { ...fact, conflictState: state, conflictsWith: [...partners].sort() };
}

/**
 * Merge one sync's output into what is already known.
 *
 * `existing` is the whole store for the claim keys involved; `incoming` is what this sync extracted.
 * Every returned fact is a new object, so a caller cannot accidentally mutate the store in place.
 */
export function reconcileFacts(
  existing: readonly PersonalContextFactV1[],
  incoming: readonly PersonalContextFactV1[],
): ReconcileResultV1 {
  const merged = new Map<string, PersonalContextFactV1>();
  for (const fact of existing) merged.set(fact.factId, { ...fact });

  const created: string[] = [];
  const updated: string[] = [];
  const superseded: string[] = [];
  const unchanged: string[] = [];

  for (const fresh of incoming) {
    const prior = merged.get(fresh.factId);
    if (prior !== undefined) {
      if (prior.contentFingerprint === fresh.contentFingerprint) {
        // Same claim, same supporting detail. Re-reading it does not make it a new fact, and bumping
        // a version here would make every re-sync look like a change.
        unchanged.push(fresh.factId);
        continue;
      }
      merged.set(fresh.factId, {
        ...fresh,
        version: prior.version + 1,
        supersedes: prior.supersedes,
        supersededBy: prior.supersededBy,
      });
      updated.push(fresh.factId);
      continue;
    }

    // A new value for a slot this same source already spoke about: the source changed its mind, so
    // the earlier row becomes history rather than disappearing.
    const displaced = [...merged.values()].filter(
      (candidate) =>
        candidate.sourceId === fresh.sourceId &&
        candidate.claimKey === fresh.claimKey &&
        candidate.factId !== fresh.factId &&
        candidate.supersededBy === null,
    );
    for (const row of displaced) {
      merged.set(row.factId, { ...row, supersededBy: fresh.factId });
      superseded.push(row.factId);
    }
    merged.set(fresh.factId, {
      ...fresh,
      supersedes: displaced.map((row) => row.factId).sort(),
    });
    created.push(fresh.factId);
  }

  // Conflict is a property of the live set, so it is recomputed from scratch every time rather than
  // patched incrementally — an incremental conflict flag that nobody clears is a permanent warning.
  const live = [...merged.values()].filter((fact) => fact.supersededBy === null);
  const byClaim = new Map<string, PersonalContextFactV1[]>();
  for (const fact of live) {
    const bucket = byClaim.get(fact.claimKey);
    if (bucket === undefined) byClaim.set(fact.claimKey, [fact]);
    else bucket.push(fact);
  }

  const conflicts: ConflictRecordV1[] = [];
  const assigned = new Map<string, { state: "POTENTIAL" | "CONFIRMED"; partners: Set<string> }>();

  for (const [claimKey, bucket] of byClaim) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const left = bucket[i];
        const right = bucket[j];
        if (left === undefined || right === undefined) continue;
        if (left.sourceId === right.sourceId) continue;
        if (left.normalizedValue === right.normalizedValue) continue;
        if (periodsAreDisjoint(left, right)) continue;

        const bothCurrent = left.temporalState === "CURRENT" && right.temporalState === "CURRENT";
        const state: "POTENTIAL" | "CONFIRMED" = bothCurrent ? "CONFIRMED" : "POTENTIAL";
        const reason = bothCurrent
          ? "Two approved sources both state this claim is current, with different values and overlapping validity."
          : "Two approved sources state different values for this claim and their periods cannot be separated.";
        conflicts.push({ claimKey, state, factIds: [left.factId, right.factId].sort(), reason });

        for (const [self, other] of [[left, right], [right, left]] as const) {
          const entry = assigned.get(self.factId) ?? { state, partners: new Set<string>() };
          // CONFIRMED outranks POTENTIAL: a fact in one settled conflict is not softened by also
          // being in an unsettled one.
          entry.state = entry.state === "CONFIRMED" || state === "CONFIRMED" ? "CONFIRMED" : "POTENTIAL";
          entry.partners.add(other.factId);
          assigned.set(self.factId, entry);
        }
      }
    }
  }

  for (const fact of live) {
    const entry = assigned.get(fact.factId);
    merged.set(fact.factId, entry === undefined ? withConflict(fact, "NONE", []) : withConflict(fact, entry.state, [...entry.partners]));
  }

  const facts = [...merged.values()].sort((a, b) =>
    a.claimKey === b.claimKey ? a.factId.localeCompare(b.factId) : a.claimKey.localeCompare(b.claimKey),
  );

  return {
    facts,
    created: created.sort(),
    updated: updated.sort(),
    superseded: [...new Set(superseded)].sort(),
    unchanged: unchanged.sort(),
    conflicts,
  };
}
