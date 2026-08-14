/**
 * What a mission is allowed to conclude after the Director dies, and what naming a state is worth.
 *
 * Both halves are the same defect twice: a decision written as a handful of named exceptions with a
 * fall-through underneath, so every case nobody had thought about was granted the fall-through by
 * default. It survived a green suite because the enumerated cases were the ones the tests named.
 *
 * The expensive one is deployment. `DEPLOYING` and `POST_DEPLOY_VERIFY` fell through to `VERIFYING`,
 * which is a *pre*-deployment state — so a Director that died mid-deploy came back, verified, reached
 * `READY_FOR_DEPLOYMENT` and deployed again, having forgotten that production may already have been
 * written. These tests are written against the classification rather than against those two state
 * names, so a third production-touching state added later is held to the same rule.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  advance, legalEventsFrom, needsEngineer, resumeDispositionOf, interruptionRecoveryOf,
  unclassifiedMissionStates,
  MISSION_STATES, MISSION_EVENT_KINDS, RESUMABLE_STATES,
  type MissionStateV1, type MissionContextV1,
} from "../src/mission.js";

/** Everything a mission could possibly have established. Nothing here is allowed to buy a redeploy. */
const PROVEN: Partial<MissionContextV1> = {
  unresolvedRequiredGates: 0,
  // Stated rather than defaulted: omitting this field now refuses, because a caller that has lost
  // the record must not be read as a caller asserting no deployment ever happened.
  deploymentTruth: "NOT_STARTED",
  unsatisfiedMandatoryWorkItems: 0,
  independentWorkRemains: false,
  postIntegrationVerificationPassed: true,
  postDeployVerificationPassed: true,
  deploymentDependenciesSatisfied: true,
  deploymentAuthorityPresent: true,
  productionWriterLeaseAvailable: true,
};

const RESUME_DISPOSITIONS = ["RESTORE", "REVERIFY", "REFUSE"];
const INTERRUPTION_RECOVERIES = ["PRESERVE", "RECHECK_GATE", "PRODUCTION_TRUTH", "REVERIFY", "REFUSE"];

// ---------------------------------------------------------------------------
// An interrupted deployment is never re-verified as if nothing had happened
// ---------------------------------------------------------------------------

test("an interruption during DEPLOYING does not become ordinary pre-deployment verification", () => {
  // The incident this prevents: the Director dies with a deploy in flight, comes back, sees a clean
  // repository, verifies, and writes production a second time.
  const interrupted = advance("DEPLOYING", "MISSION_INTERRUPTED");
  assert.equal(interrupted.to, "INTERRUPTED");
  assert.equal(interrupted.interruptedFrom, "DEPLOYING", "what production was in the middle of is written down");

  const back = advance("INTERRUPTED", "GIT_VERIFIED", null, {
    interruptedFrom: interrupted.interruptedFrom,
    context: PROVEN,
  });
  assert.equal(back.ok, true, "a dead process is not evidence that the deployment failed");
  assert.notEqual(back.to, "VERIFYING", "VERIFYING is upstream of deployment; arriving there loses that production may have changed");
  assert.notEqual(back.to, "FAILED", "nor is it evidence that it failed");
  assert.notEqual(back.to, "READY_FOR_DEPLOYMENT", "and it is certainly not permission to go again");
  assert.equal(back.to, "POST_DEPLOY_VERIFY", "the question is what production contains now");
  assert.deepEqual(back.missing, []);

  // Even with every prerequisite in the world established, the recovered state has no way to deploy.
  assert.equal(advance(back.to!, "DEPLOY_STARTED", null, { context: PROVEN }).ok, false);
  assert.ok(
    !legalEventsFrom(back.to!, null, { context: PROVEN }).includes("DEPLOY_STARTED"),
    "and it is not advertised as available either",
  );
});

test("an interruption during POST_DEPLOY_VERIFY keeps post-deploy semantics", () => {
  const interrupted = advance("POST_DEPLOY_VERIFY", "MISSION_INTERRUPTED");
  assert.equal(interrupted.interruptedFrom, "POST_DEPLOY_VERIFY");

  const back = advance("INTERRUPTED", "GIT_VERIFIED", null, {
    interruptedFrom: interrupted.interruptedFrom,
    context: PROVEN,
  });
  assert.equal(back.to, "POST_DEPLOY_VERIFY", "the deployment landed; checking it is still outstanding");
  assert.equal(back.ok, true);
  assert.ok(!legalEventsFrom("POST_DEPLOY_VERIFY", null, { context: PROVEN }).includes("DEPLOY_STARTED"));
});

test("production truth has to be re-established before an interrupted deployment completes", () => {
  const back = advance("INTERRUPTED", "GIT_VERIFIED", null, {
    interruptedFrom: "DEPLOYING",
    context: { ...PROVEN, postDeployVerificationPassed: false },
  });
  assert.equal(back.to, "POST_DEPLOY_VERIFY");

  // Neither door out of the recovered state is open on the strength of the interruption: completion
  // still wants the deployment checked, and there is no retry to take instead.
  const unchecked = advance("POST_DEPLOY_VERIFY", "MISSION_COMPLETED", null, {
    context: { ...PROVEN, postDeployVerificationPassed: false },
  });
  assert.equal(unchecked.ok, false, "a mission does not finish by having survived a crash");
  assert.match(unchecked.missing.join("; "), /healthy/);
  assert.equal(advance("POST_DEPLOY_VERIFY", "DEPLOY_STARTED", null, { context: PROVEN }).ok, false);

  // Once somebody has actually looked at production, the mission moves again.
  assert.equal(advance("POST_DEPLOY_VERIFY", "MISSION_COMPLETED", null, { context: PROVEN }).to, "COMPLETED");
});

test("every condition where production may have changed recovers the same way", () => {
  // Written against the class, not the two names: a state classified PRODUCTION_TRUTH later is held
  // to this without anybody remembering to extend the test.
  assert.equal(interruptionRecoveryOf("DEPLOYING"), "PRODUCTION_TRUTH", "reclassifying this is the defect returning");
  assert.equal(interruptionRecoveryOf("POST_DEPLOY_VERIFY"), "PRODUCTION_TRUTH");

  for (const state of MISSION_STATES) {
    if (interruptionRecoveryOf(state) !== "PRODUCTION_TRUTH") continue;
    const back = advance("INTERRUPTED", "GIT_VERIFIED", null, { interruptedFrom: state, context: PROVEN });
    assert.equal(back.ok, true, `${state} must recover, not fail the mission outright`);
    assert.notEqual(back.to, "VERIFYING", `${state} must not launder into pre-deployment verification`);
    assert.ok(
      !legalEventsFrom(back.to!, null, { context: PROVEN }).includes("DEPLOY_STARTED"),
      `${state} recovered into ${back.to}, from which production could be written again`,
    );
    const unchecked = advance(back.to!, "MISSION_COMPLETED", null, {
      context: { ...PROVEN, postDeployVerificationPassed: false },
    });
    assert.equal(unchecked.ok, false, `${state} recovered into ${back.to}, which finishes without checking production`);
  }
});

test("no interruption recovery lands anywhere a deployment is immediately legal", () => {
  // Deployment readiness is re-earned through POST_INTEGRATION_VERIFIED, never handed back by a
  // crash. This holds for every origin, so it catches a future classification that restores
  // READY_FOR_DEPLOYMENT as well as one that mishandles a deployment.
  for (const state of MISSION_STATES) {
    const back = advance("INTERRUPTED", "GIT_VERIFIED", null, { interruptedFrom: state, context: PROVEN });
    if (!back.ok || back.to === null) continue;
    assert.ok(
      !legalEventsFrom(back.to, null, { context: PROVEN }).includes("DEPLOY_STARTED"),
      `interrupting ${state} recovered into ${back.to}, one event from writing production`,
    );
  }
});

test("an interrupted mission cannot be suspended, because suspending it overwrites what it holds", () => {
  // MISSION_PAUSED records the current state over the remembered origin. INTERRUPTED is not a
  // condition — it stands in for one nobody has established — so pausing it wrote INTERRUPTED where
  // POST_DEPLOY_VERIFY had been, and the record stopped saying production may have changed.
  const suspended = advance("INTERRUPTED", "MISSION_PAUSED", "POST_DEPLOY_VERIFY", { interruptedFrom: "PAUSED" });
  assert.equal(suspended.ok, false, "a condition nobody has established yet is not a thing that can be suspended");
  assert.equal(suspended.to, null);
  assert.equal(suspended.resumeState, "POST_DEPLOY_VERIFY", "and the origin it would have overwritten is untouched");

  // So INTERRUPTED is never a target this machine writes, and a record naming it is refused rather
  // than restored — restoring it was the step that unwound the origin away.
  assert.equal(resumeDispositionOf("INTERRUPTED"), "REFUSE");
  assert.ok(!RESUMABLE_STATES.includes("INTERRUPTED"));
  assert.equal(advance("PAUSED", "MISSION_RESUMED", "INTERRUPTED").ok, false);

  // Nothing is stranded by the refusal: what an interruption is actually waiting for is a look at the
  // repository, and both answers to that are available from where it stands.
  assert.equal(
    advance("INTERRUPTED", "GIT_VERIFIED", null, { interruptedFrom: "DEPLOYING", context: PROVEN }).to,
    "POST_DEPLOY_VERIFY",
  );
  assert.equal(advance("INTERRUPTED", "GIT_MISMATCH").to, "BLOCKED");
});

test("a paused deployment keeps its origin across an interruption", () => {
  // The pause is the only thing holding POST_DEPLOY_VERIFY here, so an interruption has to leave that
  // slot alone rather than record the holder and lose what it held.
  const paused = advance("POST_DEPLOY_VERIFY", "MISSION_PAUSED");
  assert.equal(paused.resumeState, "POST_DEPLOY_VERIFY");

  const interrupted = advance("PAUSED", "MISSION_INTERRUPTED", paused.resumeState);
  assert.equal(interrupted.to, "INTERRUPTED");
  assert.equal(interrupted.resumeState, "POST_DEPLOY_VERIFY", "the pause still says what it suspended");

  const back = advance("INTERRUPTED", "GIT_VERIFIED", interrupted.resumeState, {
    interruptedFrom: interrupted.interruptedFrom,
    context: PROVEN,
  });
  assert.equal(back.to, "PAUSED", "a dead process does not unpause a mission the Owner paused");
  assert.equal(back.resumeState, "POST_DEPLOY_VERIFY");
  assert.equal(
    advance("PAUSED", "MISSION_RESUMED", back.resumeState, { context: PROVEN }).ok,
    false,
    "and coming back still has to satisfy the check in front of a deployment rather than name past it",
  );
});

// ---------------------------------------------------------------------------
// No sequence of legal moves gets there either
// ---------------------------------------------------------------------------

/** A mission record as a later process reads it back: the three fields that decide the next move. */
interface RecordV1 {
  state: MissionStateV1;
  resumeState: MissionStateV1 | null;
  interruptedFrom: MissionStateV1 | null;
}

/**
 * Every record reachable from `start` by legal moves alone.
 *
 * These defects were never one wrong transition. They were sequences of individually defensible ones
 * that ended somewhere none of them intended, which is why asserting on the recovered state and
 * stopping there kept passing. This walks `advance` to exhaustion instead, so the invariant is
 * checked over the whole closure rather than over the first move out of it. `BLOCKED` and `FAILED`
 * are recorded but not expanded: they are where the machine stops and an engineer starts, and what a
 * person decides afterwards is not something a state machine can be held to.
 */
function reachableWithoutAnEngineer(start: RecordV1, context: Partial<MissionContextV1>): RecordV1[] {
  const identify = (record: RecordV1): string =>
    `${record.state} (origin ${record.resumeState}, interrupted from ${record.interruptedFrom})`;
  const seen = new Map<string, RecordV1>([[identify(start), start]]);
  const pending: RecordV1[] = [start];
  for (let here = pending.pop(); here !== undefined; here = pending.pop()) {
    if (needsEngineer(here.state)) continue;
    for (const event of MISSION_EVENT_KINDS) {
      const moved = advance(here.state, event, here.resumeState, { context, interruptedFrom: here.interruptedFrom });
      if (!moved.ok || moved.to === null) continue;
      const next: RecordV1 = {
        state: moved.to,
        resumeState: moved.resumeState,
        interruptedFrom: moved.interruptedFrom,
      };
      const id = identify(next);
      if (seen.has(id)) continue;
      seen.set(id, next);
      pending.push(next);
    }
  }
  return [...seen.values()];
}

test("no sequence of legal moves takes an interrupted deployment back to writing production", () => {
  // The hole this closes was six moves long and forged nothing: pause a post-deploy mission,
  // interrupt it, pause the interruption — which overwrote the remembered origin with INTERRUPTED —
  // resume, recover into the pause, resume again with no origin left, and arrive in VERIFYING one
  // verification short of deploying a second time. Every step was enumerated and the suite was green,
  // because nothing looked further than one move past the recovery.
  const contexts: Array<Partial<MissionContextV1>> = [PROVEN, { ...PROVEN, independentWorkRemains: true }];
  for (const context of contexts) {
    for (const condition of MISSION_STATES) {
      if (interruptionRecoveryOf(condition) !== "PRODUCTION_TRUTH") continue;
      const closure = reachableWithoutAnEngineer(
        { state: "INTERRUPTED", resumeState: null, interruptedFrom: condition },
        context,
      );
      assert.ok(closure.length > 1, `interrupting ${condition} must recover somewhere, or this proves nothing`);
      for (const record of closure) {
        const redeploy = advance(record.state, "DEPLOY_STARTED", record.resumeState, {
          context,
          interruptedFrom: record.interruptedFrom,
        });
        assert.equal(
          redeploy.ok,
          false,
          `interrupting ${condition} reaches ${record.state} (origin ${record.resumeState}, `
            + `interrupted from ${record.interruptedFrom}), from which production is written again`,
        );
      }
    }
  }
});

test("a condition nothing repaired comes back as itself", () => {
  for (const state of MISSION_STATES) {
    if (interruptionRecoveryOf(state) !== "PRESERVE") continue;
    const back = advance("INTERRUPTED", "GIT_VERIFIED", null, { interruptedFrom: state, context: PROVEN });
    assert.equal(back.to, state, `a process dying did not repair ${state}`);
  }
  // And an origin the record cannot honestly hold does not get a guess made on its behalf.
  for (const forged of ["COMPLETED", "FAILED", "INTERRUPTED"] as MissionStateV1[]) {
    const back = advance("INTERRUPTED", "GIT_VERIFIED", null, { interruptedFrom: forged, context: PROVEN });
    assert.equal(back.ok, false, `an interruption cannot have come from ${forged}`);
    assert.equal(back.to, null);
  }
  // Nothing recorded at all is the *least* safe case, not the neutral one: a null origin has lost
  // exactly what a self-referential INTERRUPTED record loses, and it may have been a deployment.
  const blind = advance("INTERRUPTED", "GIT_VERIFIED");
  assert.equal(blind.ok, false, "a lost origin is not resolved by looking at the repository");
  assert.equal(blind.to, null);
});

// ---------------------------------------------------------------------------
// A resume target is allowed by classification, never by omission
// ---------------------------------------------------------------------------

test("every state the classification allows back in comes back, and every other state does not", () => {
  for (const state of MISSION_STATES) {
    const disposition = resumeDispositionOf(state);
    const resumed = advance("PAUSED", "MISSION_RESUMED", state);
    if (disposition === "RESTORE") {
      assert.equal(resumed.ok, true, `${state} is classified RESTORE and must resume`);
      assert.equal(resumed.to, state, `${state} must come back as itself`);
      assert.equal(resumed.resumeState, null, "and the remembered target is consumed");
    } else if (disposition === "REVERIFY") {
      assert.equal(resumed.to, "VERIFYING", `${state} did not survive the suspension, so the repository decides`);
      assert.equal(resumed.ok, true);
    } else {
      assert.equal(resumed.ok, false, `${state} is refused and must fail loudly rather than soften`);
      assert.equal(resumed.to, null);
    }
  }
});

test("the exported resumable list is the classification, not a second opinion", () => {
  const restorable = MISSION_STATES.filter((state) => resumeDispositionOf(state) === "RESTORE");
  assert.deepEqual([...RESUMABLE_STATES].sort(), [...restorable].sort(), "a list that can drift will drift");
});

test("resumeState cannot select COMPLETED", () => {
  assert.equal(resumeDispositionOf("COMPLETED"), "REFUSE");
  const attempt = advance("PAUSED", "MISSION_RESUMED", "COMPLETED");
  assert.equal(attempt.ok, false, "an outcome is reached by satisfying it, never by naming it");
  assert.equal(attempt.to, null);
  // The gate file is the other door the same string arrives through.
  const viaGate = advance("OWNER_GATE_REQUIRED", "OWNER_GATE_RESOLVED", "COMPLETED", {
    context: { unresolvedRequiredGates: 0, deploymentTruth: "NOT_STARTED" },
  });
  assert.equal(viaGate.ok, false);
});

test("resumeState cannot select FAILED", () => {
  assert.equal(resumeDispositionOf("FAILED"), "REFUSE");
  const attempt = advance("PAUSED", "MISSION_RESUMED", "FAILED");
  assert.equal(attempt.ok, false);
  assert.equal(attempt.to, null);
});

test("resumeState cannot select DEPLOYING, because no policy here says it may", () => {
  // If a rollback or resume-deployment policy is ever wanted, it is written into the classification
  // deliberately and arrives with its own prerequisites. Until then this is a refusal, not a gap.
  assert.equal(resumeDispositionOf("DEPLOYING"), "REFUSE");
  assert.equal(resumeDispositionOf("POST_DEPLOY_VERIFY"), "REFUSE");
  for (const bypass of ["DEPLOYING", "POST_DEPLOY_VERIFY"] as MissionStateV1[]) {
    const attempt = advance("PAUSED", "MISSION_RESUMED", bypass);
    assert.equal(attempt.ok, false, `${bypass} would skip the check in front of it`);
    assert.equal(attempt.missing.length, 1, "and says what would have been skipped");
  }
});

test("a value that is not a state at all is refused rather than looked up", () => {
  // These reach the classification as strings from a paused record or a gate file. The last three are
  // the reason membership is checked before the map is indexed: a bare object lookup answers them
  // with an inherited property, and a truthy answer is an allowed one.
  const fabricated: string[] = [
    "PRODUCTION_IS_FINE",
    "deploying",
    "",
    "toString",
    "constructor",
    "__proto__",
  ];
  for (const raw of fabricated) {
    // The cast is the point, and it goes through `unknown` because that is the shape a parsed record
    // arrives in: nothing about reading a file makes its strings into states, so this is how a value
    // no branch was ever written for reaches a parameter typed as though one had been.
    const value = raw as unknown as MissionStateV1;
    assert.equal(resumeDispositionOf(value), "REFUSE", `${raw} is not a state and must not be treated as one`);
    assert.equal(advance("PAUSED", "MISSION_RESUMED", value).ok, false, `${raw} must not resume a mission`);
    assert.equal(
      advance("OWNER_GATE_REQUIRED", "OWNER_GATE_RESOLVED", value, { context: { unresolvedRequiredGates: 0, deploymentTruth: "NOT_STARTED" } }).ok,
      false,
      `${raw} must not steer a gate resolution`,
    );
    assert.equal(interruptionRecoveryOf(value), "REFUSE", `${raw} is not a condition to recover from`);
    assert.equal(advance("INTERRUPTED", "GIT_VERIFIED", null, { interruptedFrom: value }).ok, false);
  }
});

test("a state added to the union is unusable until somebody classifies it", () => {
  // The compile-time half is that both maps are Record<MissionStateV1, ...>, so adding to
  // MISSION_STATES breaks the build. This is the runtime half: a state present in the list but absent
  // from a map answers undefined, which is not one of the dispositions, and the fail-closed lookup
  // turns it into a refusal rather than into permission.
  for (const state of MISSION_STATES) {
    assert.ok(RESUME_DISPOSITIONS.includes(resumeDispositionOf(state)), `${state} has no resume disposition`);
    assert.ok(INTERRUPTION_RECOVERIES.includes(interruptionRecoveryOf(state)), `${state} has no interruption recovery`);
  }

  // Totality asserted against the maps themselves, not inferred from the lookups above. Those two
  // loops cannot see the defect they were written for: `resumeDispositionOf` checks membership in
  // MISSION_STATES *before* indexing, so for a state added to the union but classified nowhere it
  // returns "REFUSE" from the fallback and the assertions pass. Adding "ROLLING_BACK" to
  // MISSION_STATES and to neither map kept all 16 tests in this file green. The compiler did catch it
  // (TS2741, twice), so the property held — but the test claiming to cover it did not.
  assert.deepEqual(
    unclassifiedMissionStates(), [],
    "a state in the union with no row in a classification map has permission nobody decided",
  );

  // A plausible next state, cast in from outside the union — the other direction, still refused.
  const named: string = "ROLLING_BACK";
  const unclassified = named as MissionStateV1;
  assert.equal(resumeDispositionOf(unclassified), "REFUSE", "unclassified is not allowed");
  assert.equal(interruptionRecoveryOf(unclassified), "REFUSE");
  assert.equal(advance("PAUSED", "MISSION_RESUMED", unclassified).ok, false);
  assert.equal(advance("INTERRUPTED", "GIT_VERIFIED", null, { interruptedFrom: unclassified }).ok, false);
});
