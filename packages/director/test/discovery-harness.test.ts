/**
 * Unknown-Unknown Discovery Harness V1.
 *
 * The uncomfortable fact this exists to answer: across the last two milestones every suite was green
 * while a real authority-substitution defect and a real ungated OAuth call were live. Both were found
 * by someone going and looking. The suites were green because they asked the system what it had done
 * and believed the answer.
 *
 * So the first tests here are not about the system at all — they are about the checker. A harness that
 * cannot fail reports nothing, and this milestone has already produced one probe harness that came
 * back clean because its `grep` matched nothing. Every claim the harness makes is only worth what its
 * ability to say "no" is worth, so that ability is tested first and explicitly.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  HARNESS_ARTIFACT_ROOT_V1,
  HARNESS_NOW_V1,
  HARNESS_SHA_V1,
  harnessFixture,
  harnessObserver,
  ownerRecord,
  type HarnessObservationV1,
} from "./harness/fixture.js";
import {
  AUTHORITY_FAULTS_V1,
  PERTURBATIONS_V1,
  AUTHORITY_RELEVANT_PERTURBATIONS_V1,
  NON_AUTHORITY_PERTURBATIONS_V1,
  checkObservation,
  evaluateScenario,
  runScenario,
} from "./harness/scenario.js";
import { createExperienceLedger } from "./harness/ledger.js";
import { runCampaign, regressionFor } from "./harness/campaign.js";
import { captureBenchmark, describeBenchmark, isLocalBenchmarkProvider } from "./harness/benchmark.js";

/* -------------------------------------------------------------------------- */
/* 1. The evaluator can fail                                                  */
/* -------------------------------------------------------------------------- */

function observation(overrides: Partial<HarnessObservationV1> = {}): HarnessObservationV1 {
  return {
    writes: [], decisions: [], reasonCodes: [], outcomeClass: "POLICY_DENIED", threw: null,
    ...overrides,
  };
}

test("the checker fails a refusal that actually wrote something", () => {
  /*
   * The V0.3 shape, reduced to its essence: a `POLICY_DENIED` that performed two writes. A checker
   * reading the returned status calls this a pass. This one reads the writes.
   */
  const lying = observation({
    outcomeClass: "POLICY_DENIED",
    writes: [{ path: "a.md", bytes: 10 }, { path: "b.md", bytes: 20 }],
  });
  const check = checkObservation("lying-refusal", lying, [{ kind: "NO_EFFECT" }]);
  assert.equal(check.passed, false);
  assert.match(check.violations[0]!.detail, /2 write\(s\) occurred/);
});

test("the checker fails a success that did nothing", () => {
  // The mirror failure, and the reason `EFFECT_PERFORMED` names a count rather than a boolean: a
  // milestone that reports SUCCESS while writing nothing has also lied, just in the safe direction.
  const empty = observation({ outcomeClass: "SUCCESS", writes: [] });
  const check = checkObservation("empty-success", empty, [{ kind: "EFFECT_PERFORMED", writes: 2 }]);
  assert.equal(check.passed, false);
  assert.match(check.violations[0]!.detail, /expected 2 write\(s\), observed 0/);
});

test("the checker fails a silent refusal", () => {
  // A refusal nobody can audit afterwards. This exact gap existed in the first V0.4 attempt.
  const silent = observation({ outcomeClass: "POLICY_DENIED", decisions: [] });
  const check = checkObservation("silent", silent, [{ kind: "DECISION_RECORDED" }]);
  assert.equal(check.passed, false);
  assert.match(check.violations[0]!.detail, /left no trace/);
});

test("the checker fails a wrong or missing reason code", () => {
  const wrong = observation({ decisions: ['{"reasonCode":"DENY_MALFORMED_REQUEST"}'], reasonCodes: ["DENY_MALFORMED_REQUEST"] });
  const check = checkObservation("wrong-code", wrong, [{ kind: "REASON_CODE", code: "DENY_AUTHORIZATION_NOT_PINNED" }]);
  assert.equal(check.passed, false);
  assert.match(check.violations[0]!.detail, /observed \[DENY_MALFORMED_REQUEST\]/);
});

test("the checker fails a crash disguised as a refusal", () => {
  // A throw is not a decision. Without this, an exception on the dispatch path reads as "did nothing",
  // which is indistinguishable from a correct refusal and is not the same thing at all.
  const crashed = observation({ outcomeClass: null, threw: "TypeError: cannot read property of undefined" });
  const check = checkObservation("crashed", crashed, [{ kind: "NO_THROW" }]);
  assert.equal(check.passed, false);
  assert.match(check.violations[0]!.detail, /threw: TypeError/);
});

test("the checker fails an audit record that copied the payload", () => {
  const leaky = observation({ decisions: ['{"reasonCode":"X","body":"4111 1111 1111 1111"}'] });
  const check = checkObservation("leaky", leaky, [{ kind: "AUDIT_EXCLUDES", text: "4111" }]);
  assert.equal(check.passed, false);
  assert.match(check.violations[0]!.detail, /contains "4111"/);
});

test("the checker passes only when every invariant holds", () => {
  const good = observation({
    outcomeClass: "POLICY_DENIED",
    decisions: ['{"reasonCode":"DENY_AUTHORIZATION_NOT_PINNED"}'],
    reasonCodes: ["DENY_AUTHORIZATION_NOT_PINNED"],
  });
  const check = checkObservation("good", good, [
    { kind: "NO_EFFECT" }, { kind: "DECISION_RECORDED" },
    { kind: "REASON_CODE", code: "DENY_AUTHORIZATION_NOT_PINNED" }, { kind: "NO_THROW" },
  ]);
  assert.equal(check.passed, true);
  assert.deepEqual(check.violations, []);

  // And one broken invariant is enough to fail it, so passing is a conjunction rather than a vote.
  const partial = checkObservation("good", good, [{ kind: "EFFECT_PERFORMED", writes: 2 }]);
  assert.equal(partial.passed, false);
});

/* -------------------------------------------------------------------------- */
/* 2. The observer records what happened                                      */
/* -------------------------------------------------------------------------- */

test("the observer records writes and decisions rather than intentions", () => {
  const observer = harnessObserver();
  observer.writeFile("x.md", "hello");
  observer.recordDecision('{"reasonCode":"ALLOW_ROUTINE_IN_SCOPE"}');
  observer.recordDecision("not json at all");
  observer.setOutcome("SUCCESS", null);
  const seen = observer.observation();

  assert.deepEqual(seen.writes, [{ path: "x.md", bytes: 5 }]);
  assert.equal(seen.decisions.length, 2);
  // A malformed decision line contributes no reason code rather than crashing the checker.
  assert.deepEqual(seen.reasonCodes, ["ALLOW_ROUTINE_IN_SCOPE"]);
  assert.equal(seen.outcomeClass, "SUCCESS");
});

/* -------------------------------------------------------------------------- */
/* 3. The fixture is a real, working dispatch                                 */
/* -------------------------------------------------------------------------- */

test("the shared fixture produces a dispatch that actually performs its effect", () => {
  /*
   * If the fixture did not work, every refusal below would be meaningless — everything refuses when
   * nothing was ever valid. This is the control the whole harness rests on.
   */
  const check = evaluateScenario({
    id: "fixture-control",
    asks: "does a valid lineage still write its artifacts?",
    expect: [{ kind: "EFFECT_PERFORMED", writes: 2 }, { kind: "NO_THROW" }, { kind: "REASON_CODE", code: "ALLOW_ROUTINE_IN_SCOPE" }],
  });
  assert.equal(check.passed, true, check.violations.map((v) => v.detail).join("; "));
});

test("the fixture builds authority through the real projection, not a fake", () => {
  // A fixture that hand-built an envelope would pass against a lock nobody closed.
  const fixture = harnessFixture();
  const projected = fixture.authorities.get(fixture.authorityEnvelopeId);
  assert.notEqual(projected, undefined);
  assert.equal(projected!.ownerAuthorizationId, "HARNESS-AUTHORITY-V1");
  // Narrowed by the projection, not by the fixture: permissions are NO whatever the record said.
  assert.equal(projected!.destructiveActionPermission, "NO");
  assert.equal(projected!.spendCeilingUsd, 0);
  assert.equal(projected!.sensitivityCeiling, "INTERNAL");
});

/* -------------------------------------------------------------------------- */
/* 4. Perturbations are refused, and refused observably                       */
/* -------------------------------------------------------------------------- */

test("every authority perturbation refuses without writing", () => {
  const perturbations = ["citeOtherAuthority", "citeUnknownAuthority", "citeEmptyAuthority", "reserializeThroughDisk"] as const;
  for (const name of perturbations) {
    const scenario = {
      id: `perturb-${name}`,
      asks: `does ${name} still write?`,
      perturbEnvelope: name === "reserializeThroughDisk"
        // Round-tripping alone is not a perturbation; round-tripping a *substituted* id is.
        ? (envelope: ReturnType<typeof harnessFixture>["jobEnvelope"]) =>
            PERTURBATIONS_V1.reserializeThroughDisk(PERTURBATIONS_V1.citeOtherAuthority(envelope))
        : PERTURBATIONS_V1[name],
      expect: [{ kind: "NO_EFFECT" as const }, { kind: "NO_THROW" as const }, { kind: "DECISION_RECORDED" as const }],
    };
    const check = evaluateScenario(scenario);
    assert.equal(check.passed, true, `${name}: ${check.violations.map((v) => v.detail).join("; ")}`);
  }
});

test("every authority-state fault refuses without writing", () => {
  for (const name of ["revokedAtDispatch", "expiredAtDispatch", "authorityVanishes", "targetUnknown", "narrowedWriteDomain"] as const) {
    const check = evaluateScenario({
      id: `fault-${name}`,
      asks: `does ${name} still write?`,
      perturbGate: AUTHORITY_FAULTS_V1[name],
      expect: [{ kind: "NO_EFFECT" }, { kind: "NO_THROW" }],
    });
    assert.equal(check.passed, true, `${name}: ${check.violations.map((v) => v.detail).join("; ")}`);
  }
});

test("a refusal names why, and does not copy the artifact into the audit line", () => {
  const run = runScenario({
    id: "refusal-observability",
    asks: "is the refusal auditable without leaking what was being written?",
    perturbEnvelope: PERTURBATIONS_V1.citeOtherAuthority,
    expect: [],
  });
  const check = checkObservation("refusal-observability", run.observation, [
    { kind: "NO_EFFECT" },
    { kind: "DECISION_RECORDED" },
    { kind: "REASON_CODE", code: "DENY_AUTHORIZATION_NOT_PINNED" },
    { kind: "AUDIT_EXCLUDES", text: "JOB_ID" },
  ]);
  assert.equal(check.passed, true, check.violations.map((v) => v.detail).join("; "));
});

/* -------------------------------------------------------------------------- */
/* 5. Campaigns discover, and report their own limits                         */
/* -------------------------------------------------------------------------- */

test("a bounded campaign sweeps the space and holds the universal invariant", () => {
  const result = runCampaign({
    campaignId: "authority-sweep",
    perturbations: [...AUTHORITY_RELEVANT_PERTURBATIONS_V1],
    authorityFaults: ["none", "revokedAtDispatch", "authorityVanishes", "targetUnknown"],
    universalInvariants: [{ kind: "NO_EFFECT" }, { kind: "NO_THROW" }],
    controlInvariants: [{ kind: "EFFECT_PERFORMED", writes: 2 }, { kind: "NO_THROW" }],
    bounds: { maxScenarios: 64 },
    observedAtSha: HARNESS_SHA_V1,
    observedAtUtc: HARNESS_NOW_V1,
  });

  assert.equal(result.controlHeld, true, "the valid dispatch stopped working; a clean sweep would be meaningless");
  assert.equal(result.truncated, false, "the ceiling truncated the sweep; raise it or narrow the space");
  assert.deepEqual(result.discoveries.map((d) => d.scenarioId), [], "a perturbed dispatch performed an effect");
  // 5 authority-relevant perturbations x 4 authority faults, plus the control.
  assert.equal(result.spaceSize, AUTHORITY_RELEVANT_PERTURBATIONS_V1.length * 4 + 1);
  assert.equal(result.executed, result.spaceSize, `only ${result.executed} of ${result.spaceSize} combinations ran`);
});

test("a campaign that truncates says so instead of reporting a whole sweep", () => {
  // Silent truncation is how a partial sweep becomes false confidence.
  const result = runCampaign({
    campaignId: "truncated",
    perturbations: ["citeOtherAuthority", "citeUnknownAuthority", "claimOtherMilestone"],
    authorityFaults: ["none", "revokedAtDispatch", "authorityVanishes"],
    universalInvariants: [{ kind: "NO_EFFECT" }],
    controlInvariants: [{ kind: "EFFECT_PERFORMED", writes: 2 }],
    bounds: { maxScenarios: 3 },
    observedAtSha: HARNESS_SHA_V1,
    observedAtUtc: HARNESS_NOW_V1,
  });
  assert.equal(result.truncated, true);
  assert.ok(result.executed < result.spaceSize);
});

test("a campaign detects a planted violation rather than only agreeing", () => {
  /*
   * The campaign equivalent of the evaluator self-tests. Asserting a universal invariant the valid
   * path cannot satisfy — "nothing may ever write" — must produce discoveries, otherwise the sweep is
   * incapable of finding anything and its clean result above means nothing.
   */
  const result = runCampaign({
    campaignId: "planted",
    perturbations: ["none"],
    authorityFaults: ["none"],
    universalInvariants: [{ kind: "NO_EFFECT" }],
    // The control is deliberately impossible too, so the campaign cannot pass by refusing.
    controlInvariants: [{ kind: "NO_EFFECT" }],
    bounds: { maxScenarios: 8 },
    observedAtSha: HARNESS_SHA_V1,
    observedAtUtc: HARNESS_NOW_V1,
  });
  // `none + none` is skipped as the control, and the control itself must now fail: it writes.
  assert.equal(result.controlHeld, false, "the campaign could not detect a violation it was told to expect");
});

test("a discovery becomes a runnable regression rather than a description", () => {
  const regression = regressionFor({
    scenarioId: "sweep:citeOtherAuthority+none",
    perturbation: "citeOtherAuthority",
    authorityFault: "none",
    violations: ["NO_EFFECT: 2 write(s) occurred"],
  });
  assert.match(regression, /PERTURBATIONS_V1\.citeOtherAuthority/);
  assert.match(regression, /AUTHORITY_FAULTS_V1\.none/);
  assert.match(regression, /NO_EFFECT/);
  assert.match(regression, /^test\(/m);
});


test("the harness records what is NOT an authority input, and notices if that changes", () => {
  /*
   * The harness's first finding, pinned.
   *
   * The opening campaign asserted that every perturbation must produce no effect, and
   * `claimOtherMilestone` wrote anyway. It was not a defect: after V0.4 the parent milestone comes
   * from the control-plane pin and the artifact's MILESTONE line from a module constant, so a job
   * rewriting `envelope.milestoneId` reaches no authorisation decision.
   *
   * That is worth an assertion rather than a note. If one of these fields is ever wired back into the
   * authority path, this test fails and the reason it may be ignored has to be revisited — which is
   * the opposite of quietly widening the campaign until it passed.
   */
  for (const { name, because } of NON_AUTHORITY_PERTURBATIONS_V1) {
    assert.ok(because.length > 40, `${name} needs a reason a reader can evaluate`);
    const check = evaluateScenario({
      id: `non-authority-${name}`,
      asks: `is ${name} still ignored by the authorisation path?`,
      perturbEnvelope: PERTURBATIONS_V1[name],
      expect: [{ kind: "EFFECT_PERFORMED", writes: 2 }, { kind: "NO_THROW" }],
    });
    assert.equal(
      check.passed,
      true,
      `${name} changed the authorisation outcome; it is no longer merely informational, so revisit: ${because}`,
    );
  }

  // The two sets together must cover every perturbation, so a new one cannot be added without a
  // decision about which it is.
  const classified = new Set<string>([
    ...AUTHORITY_RELEVANT_PERTURBATIONS_V1,
    ...NON_AUTHORITY_PERTURBATIONS_V1.map((row) => row.name),
    "none",
    // Composed with another perturbation rather than meaningful alone.
    "reserializeThroughDisk",
    // Exercised directly by the effect-contract suite, which owns idempotency.
    "emptyIdempotencyKey",
  ]);
  for (const name of Object.keys(PERTURBATIONS_V1)) {
    assert.ok(classified.has(name), `perturbation "${name}" is unclassified: say whether authority should notice it`);
  }
});

/* -------------------------------------------------------------------------- */
/* 6. The ledger remembers, ages, and is overturnable                         */
/* -------------------------------------------------------------------------- */

test("a lesson carries where it came from and when it was true", () => {
  const ledger = createExperienceLedger();
  const entry = ledger.record({
    entryId: "e1", attempted: "cite another authority", observed: "writes=0",
    learned: "authority substitution is refused", outcome: "HELD",
    provenance: "HARNESS_CAMPAIGN", observedAtSha: HARNESS_SHA_V1, observedAtUtc: HARNESS_NOW_V1,
    scenarioId: "s1", violations: [],
  });
  assert.equal(entry.provenance, "HARNESS_CAMPAIGN");
  assert.equal(entry.supersededBy, "");

  // A claim is about a commit. Once the code moves, it is history rather than a current fact.
  assert.equal(ledger.freshnessAgainst(HARNESS_SHA_V1).get("e1"), "CURRENT");
  assert.equal(ledger.freshnessAgainst("0".repeat(40)).get("e1"), "STALE_CODE_MOVED");
  assert.deepEqual(ledger.current("0".repeat(40)), []);
});

test("a superseded lesson stops being current and cannot be re-superseded", () => {
  const ledger = createExperienceLedger();
  const base = {
    attempted: "a", observed: "b", learned: "c", outcome: "HELD" as const,
    provenance: "HARNESS_CAMPAIGN" as const, observedAtSha: HARNESS_SHA_V1,
    observedAtUtc: HARNESS_NOW_V1, scenarioId: "s", violations: [],
  };
  ledger.record({ ...base, entryId: "old" });
  ledger.record({ ...base, entryId: "new" });
  ledger.record({ ...base, entryId: "newer" });

  assert.equal(ledger.supersede("old", "new"), true);
  assert.equal(ledger.freshnessAgainst(HARNESS_SHA_V1).get("old"), "SUPERSEDED");
  assert.deepEqual(ledger.current(HARNESS_SHA_V1).map((e) => e.entryId), ["new", "newer"]);

  // Rewriting who overturned a finding would let a later entry claim an older correction.
  assert.equal(ledger.supersede("old", "newer"), false);
  // And the obvious nonsense cases are refused rather than silently accepted.
  assert.equal(ledger.supersede("old", "old"), false);
  assert.equal(ledger.supersede("missing", "new"), false);
  assert.equal(ledger.supersede("new", "does-not-exist"), false);
});

test("the ledger serialises to something a later session can read", () => {
  const ledger = createExperienceLedger();
  ledger.record({
    entryId: "e1", attempted: "a", observed: "b", learned: "c", outcome: "VIOLATED",
    provenance: "BUILDER_VERIFICATION", observedAtSha: HARNESS_SHA_V1, observedAtUtc: HARNESS_NOW_V1,
    scenarioId: "s1", violations: ["NO_EFFECT: 2 write(s) occurred"],
  });
  const parsed = JSON.parse(ledger.serialize()) as { schema: string; entries: { entryId: string; violations: string[] }[] };
  assert.equal(parsed.schema, "aion.harness.experienceLedger.v1");
  assert.equal(parsed.entries[0]!.entryId, "e1");
  assert.deepEqual(parsed.entries[0]!.violations, ["NO_EFFECT: 2 write(s) occurred"]);
});

test("a campaign leaves a ledger behind, including the runs that held", () => {
  // A record of only the failures is a record that cannot tell "we checked and it was fine" from
  // "we never checked", which is the distinction a later session most needs.
  const result = runCampaign({
    campaignId: "ledger-shape",
    perturbations: ["citeOtherAuthority", "citeUnknownAuthority"],
    authorityFaults: ["none", "revokedAtDispatch"],
    universalInvariants: [{ kind: "NO_EFFECT" }],
    controlInvariants: [{ kind: "EFFECT_PERFORMED", writes: 2 }],
    bounds: { maxScenarios: 16 },
    observedAtSha: HARNESS_SHA_V1,
    observedAtUtc: HARNESS_NOW_V1,
  });
  const entries = result.ledger.entries();
  assert.equal(entries.length, result.executed);
  assert.ok(entries.every((e) => e.provenance === "HARNESS_CAMPAIGN"));
  assert.ok(entries.some((e) => e.outcome === "HELD"));
  assert.ok(entries.every((e) => e.observedAtSha === HARNESS_SHA_V1));
});

/* -------------------------------------------------------------------------- */
/* 7. The harness stays inside its authorised bounds                          */
/* -------------------------------------------------------------------------- */

test("the harness performs no outward effect and mints no authority", () => {
  /*
   * The milestone is local and non-production. This asserts the harness itself obeys that: its writes
   * are recorded in memory, its authority comes from the projection, and it never reaches a network.
   */
  const fixture = harnessFixture({ records: [ownerRecord()] });
  assert.equal(fixture.gate.registry.capabilities.every((c) => c.externalEffectClass === "REPOSITORY_REVERSIBLE" || c.externalEffectClass === "NONE"), true);

  const run = runScenario({ id: "bounds", asks: "does a valid run stay local?", expect: [] });
  for (const write of run.observation.writes) {
    assert.ok(write.path.startsWith(HARNESS_ARTIFACT_ROOT_V1), `wrote outside the harness root: ${write.path}`);
  }
});

/* -------------------------------------------------------------------------- */
/* 8. Benchmark capture stays local and stays honest                          */
/* -------------------------------------------------------------------------- */

test("a benchmark refuses to measure anything that would leave this machine", () => {
  // A benchmark that reached a paid endpoint would turn a measurement into an expense.
  for (const provider of ["openai", "anthropic", "vast", "gpt-5.5", ""]) {
    assert.throws(
      () => captureBenchmark({ label: "x", provider, runs: 1, observedAtSha: HARNESS_SHA_V1, once: () => ({ effects: 0, failed: false }) }),
      /non-local provider/,
      provider,
    );
  }
  for (const provider of ["local", "mock", "deterministic"]) {
    assert.equal(isLocalBenchmarkProvider(provider), true);
  }
});

test("a benchmark records effects, so a fast run that did nothing is visible", () => {
  /*
   * The failure this guards against is a sample that looks like evidence: fast, clean, and produced
   * by a path that refused everything. Effects and failures travel with the timing.
   */
  let now = 1000;
  const sample = captureBenchmark({
    label: "bounded local dispatch",
    provider: "mock",
    runs: 4,
    observedAtSha: HARNESS_SHA_V1,
    clockMs: () => (now += 5),
    once: (index) => ({ effects: index === 3 ? 0 : 2, failed: index === 3 }),
  });

  assert.equal(sample.runs, 4);
  assert.equal(sample.effects, 6, "three runs of two effects");
  assert.equal(sample.failures, 1);
  assert.match(describeBenchmark(sample), /effects=6 failures=1/);
});

test("a throwing run counts as a failure rather than vanishing", () => {
  const sample = captureBenchmark({
    label: "throws", provider: "mock", runs: 2, observedAtSha: HARNESS_SHA_V1,
    clockMs: () => 0,
    once: () => { throw new Error("boom"); },
  });
  assert.equal(sample.failures, 2);
  assert.equal(sample.effects, 0);
});

test("a benchmark refuses a nonsensical run count", () => {
  for (const runs of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => captureBenchmark({ label: "x", provider: "local", runs, observedAtSha: HARNESS_SHA_V1, once: () => ({ effects: 0, failed: false }) }),
      /positive run count/,
      String(runs),
    );
  }
});

test("a benchmark can measure the real harness dispatch and see its effects", () => {
  // End to end: the thing being measured is the actual scenario runner, and the two artifact writes
  // show up in the sample rather than being asserted separately.
  const sample = captureBenchmark({
    label: "valid dispatch", provider: "local", runs: 3, observedAtSha: HARNESS_SHA_V1,
    once: () => {
      const run = runScenario({ id: "benchmarked", asks: "how long does a valid dispatch take?", expect: [] });
      return { effects: run.observation.writes.length, failed: run.observation.threw !== null };
    },
  });
  assert.equal(sample.effects, 6, "three runs x two artifact writes");
  assert.equal(sample.failures, 0);
});
