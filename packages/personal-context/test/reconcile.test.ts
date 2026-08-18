/**
 * Two approved sources, one slot, and the refusal to pick a winner.
 *
 * Everything here is about the difference between *disagreeing* and *describing different times*. A
 * resume that says "Former Dealer Group, 2018–2022" and a current-job record that says "Example
 * Motors, since 2024" are not in conflict, and a system that flags them as one teaches its reader to
 * ignore conflict flags. Two records that both claim to describe today, with different values, are in
 * conflict, and a system that silently keeps the newer file's answer has destroyed the only evidence
 * that the question was open.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { assessFreshness } from "../src/freshness.js";
import { extractFactsFromFile } from "../src/extraction.js";
import { periodsAreDisjoint, reconcileFacts } from "../src/reconcile.js";
import { declaration, makeSource, NOW } from "./fixtures.js";
import type { PersonalContextFactV1 } from "../src/contracts.js";

function factsFrom(sourceId: string, rows: Parameters<typeof declaration>[0], priority = 100): readonly PersonalContextFactV1[] {
  const source = makeSource({ sourceId, priority });
  return extractFactsFromFile({
    source,
    sourceReference: `${sourceId}.json`,
    contents: declaration(rows, "owner", `${sourceId}-doc`),
    sourceModifiedAt: "2026-08-18T00:00:00Z",
    now: NOW,
  }).facts;
}

test("current and historical employment are distinguished, not merged", () => {
  const current = factsFrom("current-job", [
    {
      category: "CURRENT_EMPLOYMENT", predicate: "employer", value: "Example Motors",
      temporalState: "CURRENT", validFrom: "2024-02-01T00:00:00Z", lastConfirmedAt: "2026-08-01T00:00:00Z",
    },
  ]);
  const past = factsFrom("resume", [
    {
      category: "WORK_HISTORY", predicate: "employer", value: "Former Dealer Group",
      temporalState: "HISTORICAL", validFrom: "2018-01-01T00:00:00Z", validTo: "2022-06-30T00:00:00Z",
      observedAt: "2022-06-30T00:00:00Z",
    },
  ]);

  const result = reconcileFacts([], [...current, ...past]);
  assert.equal(result.facts.length, 2);
  assert.equal(result.facts.filter((fact) => fact.temporalState === "CURRENT").length, 1);
  assert.equal(result.facts.filter((fact) => fact.temporalState === "HISTORICAL").length, 1);
  // Different categories are different slots, so these were never candidates for conflict.
  assert.equal(result.conflicts.length, 0);
});

test("freshness follows the claim's own dates through every band", () => {
  const base = { sourceModifiedAt: null, temporalState: "CURRENT" as const, validTo: null, now: NOW };
  assert.equal(assessFreshness({ ...base, observedAt: "2026-08-01T00:00:00Z", lastConfirmedAt: null }).state, "CURRENT");
  assert.equal(assessFreshness({ ...base, observedAt: "2026-02-01T00:00:00Z", lastConfirmedAt: null }).state, "RECENT");
  assert.equal(assessFreshness({ ...base, observedAt: "2023-01-01T00:00:00Z", lastConfirmedAt: null }).state, "STALE");
  assert.equal(
    assessFreshness({ ...base, temporalState: "HISTORICAL", observedAt: "2026-08-01T00:00:00Z", lastConfirmedAt: null }).state,
    "HISTORICAL",
  );
  // A confirmation outranks the original observation.
  const confirmed = assessFreshness({ ...base, observedAt: "2019-01-01T00:00:00Z", lastConfirmedAt: "2026-08-10T00:00:00Z" });
  assert.equal(confirmed.state, "CURRENT");
  assert.equal(confirmed.basis, "LAST_CONFIRMED");
});

test("a recently touched file with no claim date stays UNKNOWN_FRESHNESS, and says why", () => {
  const assessment = assessFreshness({
    observedAt: null,
    lastConfirmedAt: null,
    sourceModifiedAt: "2026-08-18T11:59:00Z",
    temporalState: "UNKNOWN",
    validTo: null,
    now: NOW,
  });

  assert.equal(assessment.state, "UNKNOWN_FRESHNESS");
  assert.equal(assessment.ageDays, null);
  assert.match(assessment.evidence, /evidence about the file/);
  assert.match(assessment.evidence, /so it was not used/);
  assert.match(assessment.evidence, /rather than assumed/);
});

test("a claim dated in the future is unknown rather than maximally fresh", () => {
  const assessment = assessFreshness({
    observedAt: "2027-01-01T00:00:00Z",
    lastConfirmedAt: null,
    sourceModifiedAt: null,
    temporalState: "CURRENT",
    validTo: null,
    now: NOW,
  });
  assert.equal(assessment.state, "UNKNOWN_FRESHNESS");
  assert.match(assessment.evidence, /future/);
});

test("claims about different periods do not conflict", () => {
  const resume = factsFrom("resume", [
    {
      category: "CAREER", predicate: "employer", value: "Former Dealer Group",
      temporalState: "HISTORICAL", validFrom: "2018-01-01T00:00:00Z", validTo: "2022-06-30T00:00:00Z",
      observedAt: "2022-06-30T00:00:00Z",
    },
  ]);
  const currentJob = factsFrom("current-job", [
    {
      category: "CAREER", predicate: "employer", value: "Example Motors",
      temporalState: "CURRENT", validFrom: "2024-02-01T00:00:00Z", lastConfirmedAt: "2026-08-01T00:00:00Z",
    },
  ]);

  assert.equal(periodsAreDisjoint(resume[0] as PersonalContextFactV1, currentJob[0] as PersonalContextFactV1), true);
  const result = reconcileFacts([], [...resume, ...currentJob]);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.facts.every((fact) => fact.conflictState === "NONE"), true);
  assert.equal(result.facts.length, 2);
});

test("two sources that both claim today, differently, produce a confirmed conflict on both rows", () => {
  const resume = factsFrom("resume", [
    {
      category: "CURRENT_EMPLOYMENT", predicate: "title", value: "Operations Manager",
      temporalState: "CURRENT", lastConfirmedAt: "2026-07-01T00:00:00Z",
    },
  ]);
  const currentJob = factsFrom("current-job", [
    {
      category: "CURRENT_EMPLOYMENT", predicate: "title", value: "Operations Lead",
      temporalState: "CURRENT", lastConfirmedAt: "2026-08-01T00:00:00Z",
    },
  ]);

  const result = reconcileFacts([], [...resume, ...currentJob]);

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0]?.state, "CONFIRMED");
  assert.equal(result.facts.length, 2);
  for (const fact of result.facts) {
    assert.equal(fact.conflictState, "CONFIRMED");
    assert.equal(fact.conflictsWith.length, 1);
    assert.equal(fact.supersededBy, null);
  }
  // Both provenance chains survive intact.
  assert.deepEqual(result.facts.map((fact) => fact.sourceId).sort(), ["current-job", "resume"]);
});

test("an uncertain disagreement is POTENTIAL rather than promoted to CONFIRMED", () => {
  const known = factsFrom("current-job", [
    { category: "SKILL", predicate: "primaryStack", value: "TypeScript", temporalState: "CURRENT", lastConfirmedAt: "2026-08-01T00:00:00Z" },
  ]);
  const vague = factsFrom("resume", [
    { category: "SKILL", predicate: "primaryStack", value: "Java", temporalState: "UNKNOWN", observedAt: "2021-01-01T00:00:00Z" },
  ]);

  const result = reconcileFacts([], [...known, ...vague]);
  assert.equal(result.conflicts[0]?.state, "POTENTIAL");
  assert.equal(result.facts.every((fact) => fact.conflictState === "POTENTIAL"), true);
});

test("a source changing its own answer supersedes without overwriting", () => {
  const before = factsFrom("current-job", [
    { category: "CURRENT_EMPLOYMENT", predicate: "title", value: "Operations Manager", temporalState: "CURRENT", lastConfirmedAt: "2026-06-01T00:00:00Z" },
  ]);
  const after = factsFrom("current-job", [
    { category: "CURRENT_EMPLOYMENT", predicate: "title", value: "Operations Lead", temporalState: "CURRENT", lastConfirmedAt: "2026-08-01T00:00:00Z" },
  ]);

  const first = reconcileFacts([], before);
  const second = reconcileFacts(first.facts, after);

  assert.equal(second.facts.length, 2, "the earlier statement is still there");
  const old = second.facts.find((fact) => fact.value === "Operations Manager");
  const fresh = second.facts.find((fact) => fact.value === "Operations Lead");
  assert.ok(old && fresh);
  assert.equal(old.supersededBy, fresh.factId);
  assert.deepEqual(fresh.supersedes, [old.factId]);
  assert.equal(second.superseded.length, 1);
  // A superseded row is out of the live set, so it cannot conflict with its own replacement.
  assert.equal(second.conflicts.length, 0);
});

test("a high-priority source cannot erase a low-priority source's evidence", () => {
  const lowPriority = factsFrom("resume", [
    { category: "CURRENT_EMPLOYMENT", predicate: "title", value: "Operations Manager", temporalState: "CURRENT", lastConfirmedAt: "2026-07-01T00:00:00Z" },
  ], 1);
  const highPriority = factsFrom("current-job", [
    { category: "CURRENT_EMPLOYMENT", predicate: "title", value: "Operations Lead", temporalState: "CURRENT", lastConfirmedAt: "2026-08-01T00:00:00Z" },
  ], 1000);

  const result = reconcileFacts(lowPriority, highPriority);

  assert.equal(result.facts.length, 2);
  const survivor = result.facts.find((fact) => fact.sourceId === "resume");
  assert.ok(survivor);
  assert.equal(survivor.supersededBy, null, "priority is not supersession");
  assert.equal(survivor.conflictState, "CONFIRMED");
  assert.equal(survivor.sourceReference, "resume.json");
});

test("re-reading an unchanged claim is not a change", () => {
  const rows = [
    { category: "SKILL" as const, predicate: "skill", value: "TypeScript", temporalState: "CURRENT", lastConfirmedAt: "2026-08-01T00:00:00Z" },
  ];
  const first = reconcileFacts([], factsFrom("current-job", rows));
  const second = reconcileFacts(first.facts, factsFrom("current-job", rows));

  assert.equal(second.created.length, 0);
  assert.equal(second.updated.length, 0);
  assert.equal(second.superseded.length, 0);
  assert.equal(second.unchanged.length, 1);
  assert.equal(second.facts[0]?.version, 1);
});
