/**
 * The handoff contract, frozen before anything writes it to disk.
 *
 * These tests exist because durable records are about to be written against `aion.director.handoff.v1`,
 * and every loose reading here becomes a file that means two things. They pin the three properties
 * that make an executor's self-report safe to store: a safety assertion nobody made never becomes a
 * "no", a report is bound to the run it claims to be for, and a path in a report cannot name a file
 * outside the run's own artifact directory.
 *
 * The older guarantees — testimony is evidence rather than authority, contradictions are found by
 * comparison with observation — are exercised alongside them, because the repair had to preserve
 * them rather than trade them away.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseHandoff, findHandoffContradictions, artifactPathWithinRoot,
  HANDOFF_SCHEMA_V1, HANDOFF_MAX_BYTES, HANDOFF_MAX_ARTIFACTS,
  type ExecutorHandoffV1,
} from "../src/handoff.js";

const NOW = "2026-08-13T12:00:00.000Z";
const LATER = "2026-08-13T12:30:00.000Z";
const ARTIFACT_ROOT = "C:\\AION\\director\\runs\\r1";

/** A complete, honest report. Every test below is this minus or plus exactly one thing. */
function goodHandoff(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: HANDOFF_SCHEMA_V1,
    executor: "claude",
    missionId: "m1",
    runId: "r1",
    branch: "executor/claude-director-v01",
    headBefore: "a".repeat(40),
    headAfter: "b".repeat(40),
    status: "PASS",
    tests: [{ suite: "director", total: 42, passed: 42, failed: 0, skipped: 0 }],
    productionMutated: false,
    spendUsd: 0,
    requiresOwner: false,
    nextRecommendedGate: null,
    artifacts: ["logs/build.txt"],
    startedAt: NOW,
    finishedAt: LATER,
    capacityStatus: "AVAILABLE",
    summary: "repaired the handoff contract",
    ...over,
  };
}

/** JSON.stringify drops keys whose value is undefined, which is how a field is omitted below. */
const handoffJson = (over: Record<string, unknown> = {}) => JSON.stringify(goodHandoff(over));

const parsed = (over: Record<string, unknown> = {}) => parseHandoff(handoffJson(over));

function problemsOf(over: Record<string, unknown>): string {
  const result = parsed(over);
  assert.equal(result.ok, false, `expected a rejection, got a parsed handoff for ${JSON.stringify(over)}`);
  assert.equal(result.handoff, null, "a rejected handoff must not also be returned");
  return result.problems.join("; ");
}

// ---------------------------------------------------------------------------
// The contract still accepts honest work
// ---------------------------------------------------------------------------

test("a complete handoff still parses, fences and prose included", () => {
  const wrapped = `Here is my report:\n\`\`\`json\n${handoffJson()}\n\`\`\`\nThanks.`;
  const result = parseHandoff(wrapped, { artifactRoot: ARTIFACT_ROOT });
  assert.equal(result.ok, true, result.problems.join("; "));
  const handoff = result.handoff!;
  assert.equal(handoff.executor, "claude");
  assert.equal(handoff.productionMutated, false);
  assert.equal(handoff.spendUsd, 0);
  assert.deepEqual(handoff.artifacts, ["logs/build.txt"]);
  assert.deepEqual(handoff.tests, [{ suite: "director", total: 42, passed: 42, failed: 0, skipped: 0 }]);
});

test("one schema id, reachable under either spelling", () => {
  // Every other v1 record in this package discriminates on `schema`; this one shipped as
  // `schemaVersion`, and records already written with the old name must keep parsing.
  const legacy = parseHandoff(handoffJson({ schema: undefined, schemaVersion: HANDOFF_SCHEMA_V1 }));
  assert.equal(legacy.ok, true, legacy.problems.join("; "));
  assert.equal(legacy.handoff!.schema, HANDOFF_SCHEMA_V1);
  assert.equal(legacy.handoff!.schemaVersion, HANDOFF_SCHEMA_V1);

  const both = parsed({ schemaVersion: HANDOFF_SCHEMA_V1 });
  assert.equal(both.ok, true, both.problems.join("; "));

  assert.match(problemsOf({ schemaVersion: "aion.director.handoff.v2" }), /disagree/);
  assert.match(problemsOf({ schema: undefined }), /schema is missing/);
  assert.match(problemsOf({ schema: "aion.director.handoff.v9" }), /schema must be/);
});

// ---------------------------------------------------------------------------
// A safety assertion nobody made is not a "no"
// ---------------------------------------------------------------------------

test("an omitted productionMutated is a validation failure, not a false", () => {
  const result = parsed({ productionMutated: undefined });
  assert.equal(result.ok, false, "silence about production must never be recorded as leaving it alone");
  assert.equal(result.handoff, null);
  assert.match(result.problems.join("; "), /productionMutated is missing/);
});

test("the other required assertions behave the same way", () => {
  assert.match(problemsOf({ requiresOwner: undefined }), /requiresOwner is missing/);
  assert.match(problemsOf({ spendUsd: undefined }), /spendUsd is missing/);
  assert.match(problemsOf({ capacityStatus: undefined }), /capacityStatus is missing/);
  // A string "false" is not an assertion either; it is a field whose type was never checked.
  assert.match(problemsOf({ productionMutated: "false" }), /productionMutated must be a boolean/);
});

// ---------------------------------------------------------------------------
// Numbers and enumerations
// ---------------------------------------------------------------------------

test("a negative spend is refused", () => {
  assert.match(problemsOf({ spendUsd: -1 }), /spendUsd must not be negative/);
  assert.match(problemsOf({ spendUsd: -0.01 }), /spendUsd must not be negative/);
});

test("a non-finite spend is refused before it can pass a comparison", () => {
  // JSON has no NaN literal, so the wire form of this is an overflowing exponent, spliced in rather
  // than stringified because JSON.stringify would quietly turn Infinity back into null.
  const overflowed = handoffJson().replace('"spendUsd":0', '"spendUsd":1e999');
  assert.notEqual(overflowed, handoffJson(), "the fixture must actually carry the overflowing literal");
  const decoded = parseHandoff(overflowed);
  assert.equal(decoded.ok, false);
  assert.match(decoded.problems.join("; "), /spendUsd must be a finite number/);

  // NaN is the dangerous one: `NaN > 0` is false, so an unmeasured spend would read as inside the
  // zero-spend envelope rather than as a spend nobody measured.
  const withNaN = parseHandoff(goodHandoff({ spendUsd: Number.NaN }));
  assert.equal(withNaN.ok, false);
  assert.match(withNaN.problems.join("; "), /spendUsd must be a finite number/);
  const withInfinity = parseHandoff(goodHandoff({ spendUsd: Number.POSITIVE_INFINITY }));
  assert.equal(withInfinity.ok, false);
  assert.match(withInfinity.problems.join("; "), /spendUsd must be a finite number/);
  assert.match(problemsOf({ spendUsd: "0" }), /spendUsd must be a finite number/);
});

test("an unknown status is refused rather than treated as a result", () => {
  assert.match(problemsOf({ status: "MAYBE" }), /status must be PASS, FAIL or BLOCKED/);
  assert.match(problemsOf({ status: "pass" }), /status must be PASS, FAIL or BLOCKED/);
  assert.match(problemsOf({ status: undefined }), /status is missing/);
  assert.match(problemsOf({ capacityStatus: "PROBABLY_FINE" }), /capacityStatus is not a known value/);
});

test("unreadable test counts are refused, not coerced to zero failures", () => {
  assert.match(problemsOf({ tests: [{ suite: "director", total: "lots", passed: 1, failed: 0, skipped: 0 }] }),
    /tests\[0\]\.total must be a non-negative integer/);
  assert.match(problemsOf({ tests: [{ suite: "director", total: 1, passed: 1, failed: -3, skipped: 0 }] }),
    /tests\[0\]\.failed must be a non-negative integer/);
  assert.match(problemsOf({ tests: "all green" }), /tests must be an array/);
});

// ---------------------------------------------------------------------------
// A handoff is bound to the run it claims to be for
// ---------------------------------------------------------------------------

test("a mismatched missionId fails validation", () => {
  const result = parseHandoff(handoffJson(), { expectedMissionId: "m2" });
  assert.equal(result.ok, false, "a report about another mission is not this mission's report");
  assert.match(result.problems.join("; "), /missionId m1 is not the expected m2/);
});

test("a mismatched runId fails validation", () => {
  const result = parseHandoff(handoffJson(), { expectedRunId: "r-stale" });
  assert.equal(result.ok, false);
  assert.match(result.problems.join("; "), /runId r1 is not the expected r-stale/);
});

test("the matching run still parses, and the expectations are optional", () => {
  const bound = parseHandoff(handoffJson(), { expectedMissionId: "m1", expectedRunId: "r1" });
  assert.equal(bound.ok, true, bound.problems.join("; "));
  const unbound = parseHandoff(handoffJson());
  assert.equal(unbound.ok, true, unbound.problems.join("; "));
});

// ---------------------------------------------------------------------------
// Artifact paths
// ---------------------------------------------------------------------------

test("an artifact escaping the run's root fails validation", () => {
  for (const escape of [
    "..\\..\\..\\Windows\\System32\\config\\SAM",
    "../../../etc/passwd",
    "logs/../../../secrets.txt",
    "C:\\AION\\director\\runs\\r2\\stolen.txt",
    "D:\\elsewhere.txt",
    "C:logs\\drive-relative.txt",
    "\\\\server\\share\\remote.txt",
  ]) {
    const result = parseHandoff(handoffJson({ artifacts: [escape] }), { artifactRoot: ARTIFACT_ROOT });
    assert.equal(result.ok, false, `${escape} must not be accepted as a run artifact`);
    assert.match(result.problems.join("; "), /outside the permitted artifact root/);
  }
});

test("an artifact inside the run's root is accepted, separators and case included", () => {
  for (const inside of [
    "logs/build.txt",
    "logs\\build.txt",
    "./logs/./build.txt",
    "logs/nested/../build.txt",
    "C:\\AION\\director\\runs\\r1\\logs\\build.txt",
    "c:/aion/DIRECTOR/runs/R1/out.txt",
  ]) {
    const result = parseHandoff(handoffJson({ artifacts: [inside] }), { artifactRoot: ARTIFACT_ROOT });
    assert.equal(result.ok, true, `${inside} should be inside the root: ${result.problems.join("; ")}`);
  }
});

test("traversal is refused even when no root was supplied", () => {
  // A caller that forgot to pass a root is not thereby opting into "../../.ssh/id_rsa".
  assert.match(problemsOf({ artifacts: ["../../.ssh/id_rsa"] }), /contains a \.\. segment/);
  assert.match(problemsOf({ artifacts: ["logs\\..\\..\\x"] }), /contains a \.\. segment/);
});

test("artifactPathWithinRoot answers containment directly", () => {
  assert.equal(artifactPathWithinRoot(ARTIFACT_ROOT, "logs/build.txt"), true);
  assert.equal(artifactPathWithinRoot(ARTIFACT_ROOT, "../r2/build.txt"), false);
  // The root itself names a directory, not an artifact in it.
  assert.equal(artifactPathWithinRoot(ARTIFACT_ROOT, ARTIFACT_ROOT), false);
  // A sibling directory sharing a prefix is a different directory, not a nested one.
  assert.equal(artifactPathWithinRoot(ARTIFACT_ROOT, "C:\\AION\\director\\runs\\r10\\x.txt"), false);
  // A relative root cannot decide containment for anything.
  assert.equal(artifactPathWithinRoot("runs/r1", "logs/build.txt"), false);
  // A NUL truncates the path the operating system actually opens.
  assert.equal(artifactPathWithinRoot(ARTIFACT_ROOT, "logs/build.txt\u0000.png"), false);
});

test("the artifact list is bounded and its entries must be paths", () => {
  const many = Array.from({ length: HANDOFF_MAX_ARTIFACTS + 1 }, (_, index) => `logs/${index}.txt`);
  assert.match(problemsOf({ artifacts: many }), /over the 256 limit/);
  assert.match(problemsOf({ artifacts: [42] }), /artifacts\[0\] is not a path/);
  assert.match(problemsOf({ artifacts: "logs/build.txt" }), /artifacts must be an array/);
});

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

test("oversized text fails instead of being parsed", () => {
  const huge = handoffJson({ summary: "x".repeat(HANDOFF_MAX_BYTES) });
  const result = parseHandoff(huge);
  assert.equal(result.ok, false, "a runaway reply must be refused on size, before the regex and the parser");
  assert.equal(result.handoff, null);
  assert.equal(result.problems.length, 1, "size is reported alone; nothing else was inspected");
  assert.match(result.problems[0]!, /over the \d+-byte limit/);
});

test("the size bound is caller-adjustable and still enforced", () => {
  const tight = parseHandoff(handoffJson(), { maxBytes: 64 });
  assert.equal(tight.ok, false);
  assert.match(tight.problems[0]!, /over the 64-byte limit/);
  // A nonsensical override falls back to the frozen default rather than disabling the bound.
  const zero = parseHandoff(handoffJson(), { maxBytes: 0 });
  assert.equal(zero.ok, true, zero.problems.join("; "));
});

test("input that is not a JSON object is refused", () => {
  assert.equal(parseHandoff("the tests all passed, everything is fine").ok, false);
  assert.equal(parseHandoff(["not", "a", "handoff"]).ok, false);
  assert.equal(parseHandoff(null).ok, false);
  assert.equal(parseHandoff("{ not json }").ok, false);
});

// ---------------------------------------------------------------------------
// Self-report is evidence, never authority
// ---------------------------------------------------------------------------

test("contradictions against observation are still found", () => {
  const result = parseHandoff(handoffJson());
  const contradictions = findHandoffContradictions({
    handoff: result.handoff!,
    observedHeadAfter: "c".repeat(40),
    observedBranch: "main",
    authorisedProductionMutation: true,
  });
  const fields = contradictions.map((c) => c.field);
  assert.ok(fields.includes("headAfter"), "a SHA nobody can find is not a SHA");
  assert.ok(fields.includes("branch"), "a run on another branch is not this run");
  assert.ok(fields.includes("productionMutated"), "production moving during a run that denied it");
  assert.notEqual(contradictions.length, 0);
});

test("any spend at all contradicts the envelope the run was launched under", () => {
  const result = parseHandoff(handoffJson({ spendUsd: 0.01 }));
  assert.equal(result.ok, true, result.problems.join("; "));
  const contradictions = findHandoffContradictions({ handoff: result.handoff! });
  assert.equal(contradictions.length, 1);
  assert.equal(contradictions[0]!.field, "spendUsd");
});

test("a report that disagrees with itself is caught without any observation", () => {
  const passWithFailures = parseHandoff(handoffJson({
    tests: [{ suite: "director", total: 42, passed: 40, failed: 2, skipped: 0 }],
  }));
  assert.equal(passWithFailures.ok, true, passWithFailures.problems.join("; "));
  const claimed = findHandoffContradictions({ handoff: passWithFailures.handoff! });
  assert.deepEqual(claimed.map((c) => c.field), ["status"]);

  const timeTravel = parseHandoff(handoffJson({ startedAt: LATER, finishedAt: NOW }));
  assert.equal(timeTravel.ok, true, timeTravel.problems.join("; "));
  const timings = findHandoffContradictions({ handoff: timeTravel.handoff! });
  assert.deepEqual(timings.map((c) => c.field), ["finishedAt"]);
});

test("a handoff agreeing with observation is trustworthy", () => {
  const result = parseHandoff(handoffJson(), {
    expectedMissionId: "m1",
    expectedRunId: "r1",
    artifactRoot: ARTIFACT_ROOT,
  });
  assert.equal(result.ok, true, result.problems.join("; "));
  const handoff: ExecutorHandoffV1 = result.handoff!;
  const contradictions = findHandoffContradictions({
    handoff,
    observedHeadAfter: "b".repeat(40),
    observedBranch: "executor/claude-director-v01",
    authorisedProductionMutation: false,
  });
  assert.deepEqual(contradictions, []);
});

test("a malformed handoff names every problem, not just the first", () => {
  // The retry policy depends on this: one bad field is worth a corrected instruction, six is a run
  // that should be blocked rather than nudged.
  const problems = problemsOf({
    headAfter: "not-a-sha",
    status: "MAYBE",
    productionMutated: undefined,
    spendUsd: -5,
  });
  for (const expected of [/not a full 40-character SHA/, /status must be/, /productionMutated is missing/, /negative/]) {
    assert.match(problems, expected);
  }
});
