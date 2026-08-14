/**
 * Production is written at most once, and the proof is a search rather than a list of chains.
 *
 * ## What failed, and why a list was never going to catch it
 *
 * The first attempt made `interruptedFrom` the safety primitive: the state the mission held when its
 * process died, consulted on the way back out of `INTERRUPTED`. It was correct at that transition and
 * useless as an invariant, because a state machine with enough legal edges always has another edge.
 * `INTERRUPTED --GIT_MISMATCH--> BLOCKED` is a fixed table row that never consults it, and from
 * `BLOCKED` an ordinary seven-move sequence reaches `DEPLOYING` again with nothing forged and no
 * argument omitted. An independent explorer found 26 such routes; the shortest is four moves.
 *
 * A test that replays the known chains would have passed against the defective implementation the
 * moment somebody added a twenty-seventh route. So the central test here does not replay anything: it
 * enumerates the reachable state/truth space by brute force and asserts that no sequence of legal
 * events reaches a second deployment. That is the property. The named chains are kept underneath it
 * as documentation of what was actually observed, not as the coverage.
 *
 * ## The model
 *
 * `deploymentTruth` is durable mission truth, written *before* the deployment process is launched and
 * *settled* only by an observation of production itself. Every other event in the machine — pause,
 * interruption, a gate answer, an executor failure, a fresh plan, `GIT_VERIFIED`, `GIT_MISMATCH` —
 * leaves it untouched, which is asserted below rather than assumed.
 *
 * Exactly two events other than the three settling observations touch the field, and the distinction
 * that matters is direction. `DEPLOY_STARTED` mints MAY_HAVE_WRITTEN: it only ever tightens, so it
 * cannot manufacture permission. `DEPLOY_COMPLETED` loosens — MAY_HAVE_WRITTEN to
 * WRITER_FINISHED_UNVERIFIED — and is therefore the one that has to be corroborated: it fires only
 * when the production writer lease shows the process actually released it. An earlier version took
 * the event's word for it, which let a Director that merely believed its deploy child had exited
 * settle production truth off a rollout that was still running.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  advance, MISSION_STATES, MISSION_EVENT_KINDS, TERMINAL_STATES, MISSION_SCHEMA_V1,
  deploymentPermittedByTruth, completionPermittedByTruth, DEPLOYABLE_TRUTHS, COMPLETABLE_TRUTHS,
  NOTHING_PROVEN,
  type MissionStateV1, type MissionContextV1, type DeploymentTruthV1, type MissionStateRecordV1,
} from "../src/mission.js";

/**
 * Every prerequisite satisfied — the most permissive context the machine allows.
 *
 * Deliberately maximal: the question is whether deployment truth alone stops a second write, so
 * everything else that could stop it is switched off. A test that left a gate closed would pass for
 * the wrong reason and keep passing after the truth model was removed.
 */
const ALL_TRUE: MissionContextV1 = {
  unresolvedRequiredGates: 0,
  unsatisfiedMandatoryWorkItems: 0,
  independentWorkRemains: false,
  postIntegrationVerificationPassed: true,
  postDeployVerificationPassed: true,
  deploymentDependenciesSatisfied: true,
  deploymentAuthorityPresent: true,
  productionWriterLeaseAvailable: true,
  // The writer's release is its own fact; the maximal context proves it so that deployment truth is
  // the only thing left that can refuse a move.
  productionWriterLeaseReleasedByThisRun: true,
  deploymentTruth: "NOT_STARTED",
};

const withTruth = (deploymentTruth: DeploymentTruthV1): MissionContextV1 => ({ ...ALL_TRUE, deploymentTruth });

// ---------------------------------------------------------------------------
// The property, by exhaustive search
// ---------------------------------------------------------------------------

/**
 * A machine the search can drive: same shape as `advance`, so a defective one is substitutable.
 *
 * The previous version of this harness took a `permits` *predicate* and used it only to compute a
 * label, while every transition still came from the real `advance`. It therefore counted refusals as
 * routes: with an always-permit rule it reported 70 "routes" of which 69 were refusals relabelled,
 * and the shortest had length 1 — emitted at the start node before any move was made. All three of
 * its assertions passed against that garbage. A harness whose entire job is proving the other tests
 * have teeth is the last place a label may stand in for an execution.
 */
type MissionMachineV1 = (
  state: MissionStateV1,
  event: (typeof MISSION_EVENT_KINDS)[number],
  resumeState: MissionStateV1 | null,
  options: { context: MissionContextV1 },
) => ReturnType<typeof advance>;

/** The accepted machine. */
const acceptedMachine: MissionMachineV1 = (state, event, resumeState, options) =>
  advance(state, event, resumeState, options);

/**
 * The machine as it behaved before durable deployment truth existed.
 *
 * Deployment was permitted by the five prerequisites alone — reaching `READY_FOR_DEPLOYMENT` with a
 * satisfied board was the whole of the authority to write production. It really moves: the search
 * below sees `ok: true` and a transition to `DEPLOYING`, so a counterexample it reports is a sequence
 * of moves the defective machine actually made, not a refusal wearing a label.
 */
const breadcrumbMachine: MissionMachineV1 = (state, event, resumeState, options) => {
  const real = advance(state, event, resumeState, options);
  if (event !== "DEPLOY_STARTED" || real.ok) return real;
  const board = options.context;
  const prerequisitesMet = board.unresolvedRequiredGates === 0
    && board.postIntegrationVerificationPassed
    && board.deploymentDependenciesSatisfied
    && board.deploymentAuthorityPresent
    && board.productionWriterLeaseAvailable;
  if (state !== "READY_FOR_DEPLOYMENT" || !prerequisitesMet) return real;
  return {
    ...real,
    ok: true,
    to: "DEPLOYING",
    reason: "the pre-repair machine deployed on prerequisites alone",
    deploymentTruth: "MAY_HAVE_WRITTEN",
    missing: [],
  };
};

/**
 * Drive `machine` breadth-first over (state x truth) and return the sequences on which it really
 * wrote production a second time.
 *
 * A counterexample requires all three: the event was `DEPLOY_STARTED`, the machine returned
 * `ok: true` with `to === "DEPLOYING"`, and the truth it started from was one the accepted model
 * calls unsafe. A refusal is never a counterexample.
 */
function findSecondDeploys(machine: MissionMachineV1): { routes: string[][]; visited: number; reached: number } {
  type Node = { state: MissionStateV1; truth: DeploymentTruthV1 };
  const key = (n: Node) => `${n.state}|${n.truth}`;
  const start: Node = { state: "DEPLOYING", truth: "MAY_HAVE_WRITTEN" };
  const seen = new Set<string>([key(start)]);
  const queue: { node: Node; path: string[] }[] = [{ node: start, path: [] }];
  const routes: string[][] = [];
  let visited = 0;

  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    visited += 1;
    if (TERMINAL_STATES.includes(node.state)) continue;
    for (const event of MISSION_EVENT_KINDS) {
      const moved = machine(node.state, event, null, { context: withTruth(node.truth) });
      if (!moved.ok || !moved.to) continue; // a refusal is not a route
      const trail = [...path, `${event} -> ${moved.to}`];
      if (event === "DEPLOY_STARTED" && moved.to === "DEPLOYING" && !deploymentPermittedByTruth(node.truth)) {
        routes.push(trail);
      }
      const next: Node = { state: moved.to, truth: moved.deploymentTruth ?? node.truth };
      if (seen.has(key(next))) continue;
      seen.add(key(next));
      queue.push({ node: next, path: trail });
    }
  }
  return { routes, visited, reached: seen.size };
}

test("the search finds a real counterexample when the defective machine is substituted", () => {
  // Executed against a machine that genuinely moves, so every reported route is a sequence of moves
  // that machine actually made. If this ever returns zero the search has stopped working, and the
  // passing result in the next test means nothing.
  const { routes, visited } = findSecondDeploys(breadcrumbMachine);
  assert.ok(routes.length > 0, "the defective machine must be caught writing production twice");
  const shortest = routes.reduce((a, b) => (b.length < a.length ? b : a));

  // Printed, not merely asserted. A count above zero is what the broken version of this harness also
  // reported; an actual executable move sequence is the thing that distinguishes a real search from a
  // relabelled refusal, so it belongs in the run output where a reader can check it without re-deriving it.
  console.log(`DEFECTIVE_SECOND_DEPLOY_ROUTES = ${routes.length}`);
  console.log("SHORTEST_DEFECTIVE_ROUTE =");
  for (const step of shortest) console.log(`  ${step}`);
  console.log(`ACCEPTED_SECOND_DEPLOY_ROUTES = ${findSecondDeploys(acceptedMachine).routes.length}`);
  assert.ok(shortest.length >= 2, `a counterexample is a sequence of moves, not a start node: ${shortest.join(" | ")}`);
  assert.ok(
    shortest[shortest.length - 1]?.startsWith("DEPLOY_STARTED -> DEPLOYING"),
    "every counterexample must end on the move that writes production",
  );
  assert.ok(visited > 50, `the search only visited ${visited} nodes, which is not a search`);
});

test("the accepted machine yields no counterexample the same search finds in the defective one", () => {
  // Same function, same seeds, same traversal — only the machine differs. That is what makes the
  // zero below evidence rather than an absence of effort.
  const defective = findSecondDeploys(breadcrumbMachine);
  const accepted = findSecondDeploys(acceptedMachine);
  assert.ok(defective.routes.length > 0, "control: the search must be capable of finding routes");
  assert.deepEqual(
    accepted.routes, [],
    `accepted machine wrote production twice:\n${accepted.routes.map((r) => r.join("\n  ")).join("\n---\n")}`,
  );
  assert.ok(accepted.reached > 20, `only ${accepted.reached} distinct (state, truth) pairs were reachable`);
});

test("no sequence of legal events reaches a second deployment while production is uncertain", () => {
  // The property itself, through the same harness the control test proved has teeth.
  const { routes, visited, reached } = findSecondDeploys(acceptedMachine);
  assert.deepEqual(
    routes, [],
    `reached DEPLOYING while production was uncertain:\n${routes.map((r) => r.join("\n  ")).join("\n---\n")}`,
  );
  assert.ok(visited > 50, `the search only visited ${visited} nodes, which is not a search`);
  assert.ok(reached > 20, `only ${reached} distinct (state, truth) pairs were reachable`);

});

test("the shortest route the independent explorer found is refused", () => {
  // DEPLOYING -> INTERRUPTED -> VERIFYING -> READY_FOR_DEPLOYMENT -> DEPLOY_STARTED, four moves.
  const interrupted = advance("DEPLOYING", "MISSION_INTERRUPTED", null, { context: withTruth("MAY_HAVE_WRITTEN") });
  assert.equal(interrupted.to, "INTERRUPTED");
  const verified = advance("INTERRUPTED", "GIT_VERIFIED", null, {
    context: withTruth("MAY_HAVE_WRITTEN"), interruptedFrom: "DEPLOYING",
  });
  // Recovery lands on production truth, not generic verification — but even if it did not, the
  // deployment guard below would still hold, which is the point of not relying on this one edge.
  assert.equal(verified.to, "POST_DEPLOY_VERIFY");
  // Every state refuses, but for two different reasons, and the distinction is worth pinning:
  // READY_FOR_DEPLOYMENT is the only state with a DEPLOY_STARTED row, so it is the only one where the
  // production guard is what does the refusing. The others have no such move at all — equally safe,
  // and reported as what it is rather than as a production problem.
  for (const from of ["VERIFYING", "POST_DEPLOY_VERIFY", "PLANNING", "BLOCKED", "INTERRUPTED"] as MissionStateV1[]) {
    const attempt = advance(from, "DEPLOY_STARTED", null, { context: withTruth("MAY_HAVE_WRITTEN") });
    assert.equal(attempt.ok, false, `DEPLOY_STARTED must be refused from ${from}`);
    assert.equal(attempt.to, null);
  }
  const gated = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: withTruth("MAY_HAVE_WRITTEN") });
  assert.equal(gated.ok, false);
  assert.match(gated.reason, /nothing has established what it did to production/);
});

test("the seven-move route through BLOCKED is refused at the last step", () => {
  // The route that survived the previous repair: GIT_MISMATCH is a fixed row that never consulted
  // interruptedFrom, so the breadcrumb was simply walked around.
  const chain: [MissionStateV1, (typeof MISSION_EVENT_KINDS)[number], MissionStateV1][] = [
    ["DEPLOYING", "MISSION_INTERRUPTED", "INTERRUPTED"],
    ["INTERRUPTED", "GIT_MISMATCH", "BLOCKED"],
    ["BLOCKED", "PLAN_SELECTED", "PLANNING"],
    ["PLANNING", "EXECUTOR_STARTED", "EXECUTOR_RUNNING"],
    ["EXECUTOR_RUNNING", "EXECUTOR_FAILED", "VERIFYING"],
    ["VERIFYING", "POST_INTEGRATION_VERIFIED", "READY_FOR_DEPLOYMENT"],
  ];
  for (const [from, event, to] of chain) {
    const moved = advance(from, event, null, { context: withTruth("MAY_HAVE_WRITTEN") });
    assert.equal(moved.ok, true, `${from} --${event}--> should still be legal: ${moved.reason}`);
    assert.equal(moved.to, to, `${from} --${event}-->`);
    assert.equal(moved.deploymentTruth, null, `${event} must not touch deployment truth`);
  }
  // Every ordinary move above is still allowed — the mission can recover, replan and rerun. Only the
  // production write is refused, and it is refused on the fact rather than on the route taken to it.
  const second = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: withTruth("MAY_HAVE_WRITTEN") });
  assert.equal(second.ok, false);
  assert.equal(second.to, null);
  assert.deepEqual(second.missing, ["a production observation that says what production actually contains"]);
});

// ---------------------------------------------------------------------------
// Uncertainty is sticky
// ---------------------------------------------------------------------------

test("no ordinary event anywhere in the machine clears deployment uncertainty", () => {
  // Stated as an exhaustive sweep rather than a list of the states anyone thought of. Only the four
  // production observations may write truth; everything else must return null, meaning "unchanged".
  const OBSERVATIONS = new Set([
    "PRODUCTION_VERIFIED_OLD", "PRODUCTION_VERIFIED_TARGET",
    "PRODUCTION_VERIFIED_UNEXPECTED", "PRODUCTION_VERIFY_INCONCLUSIVE",
  ]);
  let checked = 0;
  for (const state of MISSION_STATES) {
    for (const event of MISSION_EVENT_KINDS) {
      if (OBSERVATIONS.has(event)) continue;
      for (const truth of ["MAY_HAVE_WRITTEN", "VERIFIED_TARGET_PRODUCTION", "VERIFIED_UNEXPECTED"] as const) {
        const moved = advance(state, event, "VERIFYING", { context: withTruth(truth), interruptedFrom: "DEPLOYING" });
        checked += 1;
        if (moved.deploymentTruth === null) continue;
        // DEPLOY_COMPLETED may downgrade MAY_HAVE_WRITTEN to WRITER_FINISHED_UNVERIFIED. Allowed
        // here rather than whitelisted: the value must still refuse deployment and completion, and it
        // must only appear when the writer lease corroborates the release. The context used by this
        // sweep has the lease free, so the corroborated case is what is being observed — the
        // uncorroborated case is asserted separately below, and must not write anything at all.
        if (event === "DEPLOY_COMPLETED" && moved.deploymentTruth === "WRITER_FINISHED_UNVERIFIED") {
          assert.equal(truth, "MAY_HAVE_WRITTEN", "only an uncertain mission can reach the writer-finished value");
          assert.equal(deploymentPermittedByTruth("WRITER_FINISHED_UNVERIFIED"), false);
          assert.equal(completionPermittedByTruth("WRITER_FINISHED_UNVERIFIED"), false);
          const uncorroborated = advance(state, event, "VERIFYING", {
            // The fact that actually gates the edge. Flipping productionWriterLeaseAvailable here
            // would test nothing, because startDeployment already requires that true to launch —
            // which is precisely why reading it back as completion evidence was vacuous.
            context: { ...withTruth(truth), productionWriterLeaseReleasedByThisRun: false },
            interruptedFrom: "DEPLOYING",
          });
          assert.equal(
            uncorroborated.deploymentTruth, null,
            `${state}: DEPLOY_COMPLETED must not settle anything until this run's writer is known to have let go`,
          );
          continue;
        }
        // The one legitimate writer: starting a deployment makes production uncertain. It can only
        // happen from a deployable truth, which none of the three above are.
        assert.fail(`${state} --${event}--> wrote deploymentTruth=${moved.deploymentTruth} from ${truth}`);
      }
    }
  }
  assert.ok(checked > 500, `only ${checked} combinations were checked`);
});

test("a deployment marks production uncertain before anything is launched", () => {
  // The ordering is the safety property: the caller persists what this returns, *then* spawns. A
  // crash in between leaves false uncertainty, costing one production observation; the opposite
  // ordering costs a second production write.
  const started = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: withTruth("NOT_STARTED") });
  assert.equal(started.ok, true, started.reason);
  assert.equal(started.to, "DEPLOYING");
  assert.equal(started.deploymentTruth, "MAY_HAVE_WRITTEN", "uncertainty is recorded on the move that grants the deploy");
});

test("only a production observation changes truth, and inconclusive changes nothing", () => {
  const cases: [(typeof MISSION_EVENT_KINDS)[number], DeploymentTruthV1 | null, MissionStateV1][] = [
    // Requires the writer to have reported back; see the mid-flight test below.
    ["PRODUCTION_VERIFIED_OLD", null, "VERIFYING"],
    ["PRODUCTION_VERIFIED_TARGET", "VERIFIED_TARGET_PRODUCTION", "VERIFYING"],
    ["PRODUCTION_VERIFIED_UNEXPECTED", "VERIFIED_UNEXPECTED", "BLOCKED"],
    ["PRODUCTION_VERIFY_INCONCLUSIVE", null, "VERIFYING"],
  ];
  for (const [event, truth, to] of cases) {
    const moved = advance("VERIFYING", event, null, { context: withTruth("MAY_HAVE_WRITTEN") });
    assert.equal(moved.ok, true, `${event}: ${moved.reason}`);
    assert.equal(moved.deploymentTruth, truth, `${event} establishes`);
    assert.equal(moved.to, to, `${event} lands`);
  }
  // A probe that failed is not evidence the deployment did not land. This is the assertion that stops
  // a network timeout from authorising the second write.
  const inconclusive = advance("VERIFYING", "PRODUCTION_VERIFY_INCONCLUSIVE", null, {
    context: withTruth("MAY_HAVE_WRITTEN"),
  });
  assert.equal(inconclusive.deploymentTruth, null);
  assert.equal(
    advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: withTruth("MAY_HAVE_WRITTEN") }).ok,
    false,
    "an inconclusive check does not unlock another deployment",
  );
});

// ---------------------------------------------------------------------------
// What each settled truth permits
// ---------------------------------------------------------------------------

test("deployment eligibility is a closed allowlist over truth", () => {
  assert.deepEqual([...DEPLOYABLE_TRUTHS].sort(), ["NOT_STARTED", "VERIFIED_OLD_PRODUCTION"]);
  const expected: [DeploymentTruthV1, boolean, boolean][] = [
    // truth, may deploy, may complete
    ["NOT_STARTED", true, true],
    ["VERIFIED_OLD_PRODUCTION", true, true],
    ["MAY_HAVE_WRITTEN", false, false],
    ["WRITER_FINISHED_UNVERIFIED", false, false],
    ["VERIFIED_TARGET_PRODUCTION", false, true],
    ["VERIFIED_UNEXPECTED", false, false],
  ];
  for (const [truth, mayDeploy, mayComplete] of expected) {
    assert.equal(deploymentPermittedByTruth(truth), mayDeploy, `${truth} deploy`);
    assert.equal(completionPermittedByTruth(truth), mayComplete, `${truth} complete`);
    assert.equal(
      advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: withTruth(truth) }).ok,
      mayDeploy,
      `${truth} through advance`,
    );
  }
});

test("a landed deployment is never repeated, and a failed one may be retried", () => {
  // Verified at target: the write landed. Another deployment of the same target would write twice.
  assert.equal(
    advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: withTruth("VERIFIED_TARGET_PRODUCTION") }).ok,
    false,
  );
  // Verified still old: the write provably did not land, so the mission is where it began and a
  // deliberate retry is legitimate — every other prerequisite still stands in front of it.
  const retry = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, {
    context: withTruth("VERIFIED_OLD_PRODUCTION"),
  });
  assert.equal(retry.ok, true, retry.reason);
  assert.equal(retry.deploymentTruth, "MAY_HAVE_WRITTEN", "and it makes production uncertain again");
  // But only because the prerequisites hold; truth is a gate in front of them, not instead of them.
  const unauthorised = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, {
    context: { ...withTruth("VERIFIED_OLD_PRODUCTION"), deploymentAuthorityPresent: false },
  });
  assert.equal(unauthorised.ok, false);
  assert.match(unauthorised.reason, /only by these being true/);
});

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

test("a mission cannot be declared finished while nobody knows what it did to production", () => {
  // Reachable through VERIFYING, where the post-deploy check does not apply — so the old completion
  // rule let a mission finish on a lie after an interrupted deployment.
  for (const from of ["VERIFYING", "POST_DEPLOY_VERIFY"] as MissionStateV1[]) {
    for (const truth of ["MAY_HAVE_WRITTEN", "VERIFIED_UNEXPECTED"] as const) {
      const done = advance(from, "MISSION_COMPLETED", null, { context: withTruth(truth) });
      assert.equal(done.ok, false, `${from} must not complete while ${truth}`);
      assert.equal(done.to, null);
    }
    // And with production established, completion is available again on the ordinary terms.
    const settled = advance(from, "MISSION_COMPLETED", null, { context: withTruth("VERIFIED_TARGET_PRODUCTION") });
    assert.equal(settled.ok, true, `${from}: ${settled.reason}`);
    assert.equal(settled.to, "COMPLETED");
  }
});

test("no state can complete while production is uncertain, whatever else is true", () => {
  // Swept rather than sampled: a completion route added later must not inherit permission.
  for (const state of MISSION_STATES) {
    if (TERMINAL_STATES.includes(state)) continue;
    const done = advance(state, "MISSION_COMPLETED", null, { context: withTruth("MAY_HAVE_WRITTEN") });
    assert.equal(done.ok, false, `${state} completed while production was uncertain`);
  }
});

// ---------------------------------------------------------------------------
// Boundary defects found by adversarial review, each a known-defect regression
// ---------------------------------------------------------------------------

test("an event outside the union cannot answer for a production observation", () => {
  // PRODUCTION_OBSERVATIONS was indexed bare, so every inherited Object.prototype key answered:
  // advance(state, "toString") returned ok:true with deploymentTruth set to a *function*. A faithful
  // caller persists that field before acting, JSON.stringify drops a function silently, the record
  // reloads without the key, and establish() defaults it to NOT_STARTED — uncertainty erased by an
  // event that is not one of the four, and a second deployment permitted. The sticky sweep above
  // could not see it, because that sweep iterates MISSION_EVENT_KINDS.
  const inherited = [
    "toString", "constructor", "__proto__", "valueOf", "hasOwnProperty",
    "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__defineGetter__",
  ];
  for (const state of MISSION_STATES) {
    if (TERMINAL_STATES.includes(state)) continue;
    for (const bogus of inherited) {
      const moved = advance(state, bogus as never, null, { context: withTruth("MAY_HAVE_WRITTEN") });
      assert.equal(moved.ok, false, `${state} accepted ${bogus}`);
      assert.equal(moved.to, null);
      assert.equal(moved.deploymentTruth, null, `${bogus} must not write deployment truth`);
      assert.equal(typeof moved.reason, "string", "a refusal must still explain itself");
    }
  }
  // And the four real observations still work, so the guard did not close the door on them.
  assert.equal(
    advance("VERIFYING", "PRODUCTION_VERIFIED_TARGET", null, { context: withTruth("MAY_HAVE_WRITTEN") }).deploymentTruth,
    "VERIFIED_TARGET_PRODUCTION",
  );
});

test("a probe taken while the writer is still running never settles truth", () => {
  // The bypass moved to the truth-clearing edge: PRODUCTION_VERIFIED_OLD was accepted from DEPLOYING
  // itself — the one state meaning a production writer is in flight and has not reported completion —
  // converting MAY_HAVE_WRITTEN into a deployable truth. Eight ordinary moves later the mission
  // deployed a second time. A rollout that has not flipped yet reads as the old revision.
  // The guard is on durable truth, not on the state name — that was the bypass. MISSION_INTERRUPTED
  // and MISSION_PAUSED both change the name without the writer reporting anything, so keying on
  // `current === "DEPLOYING"` let the same probe settle one move later and a second write followed.
  for (const [state, extra] of [
    ["DEPLOYING", {}],
    ["INTERRUPTED", { interruptedFrom: "DEPLOYING" as MissionStateV1 }],
    ["PAUSED", {}],
    ["VERIFYING", {}],
    ["BLOCKED", {}],
  ] as const) {
    const probe = advance(state as MissionStateV1, "PRODUCTION_VERIFIED_OLD", "DEPLOYING", {
      context: withTruth("MAY_HAVE_WRITTEN"), ...extra,
    });
    assert.equal(probe.deploymentTruth, null, `${state}: an unaccounted writer means the probe settles nothing`);
    assert.match(probe.reason, /has not reported back/);
  }
  assert.equal(deploymentPermittedByTruth("MAY_HAVE_WRITTEN"), false);

  // Once the writer has reported, the same reading settles normally — the precondition is the fact,
  // not the location.
  const reported = advance("POST_DEPLOY_VERIFY", "PRODUCTION_VERIFIED_OLD", null, {
    context: withTruth("WRITER_FINISHED_UNVERIFIED"),
  });
  assert.equal(reported.deploymentTruth, "VERIFIED_OLD_PRODUCTION");

  // The full eight-move route, replayed with the caller carrying state and truth exactly as returned.
  let state: MissionStateV1 = "READY_FOR_DEPLOYMENT";
  let truth: DeploymentTruthV1 = "NOT_STARTED";
  const step = (event: Parameters<typeof advance>[1]) => {
    const moved = advance(state, event, null, { context: withTruth(truth) });
    if (moved.ok && moved.to) { state = moved.to; truth = moved.deploymentTruth ?? truth; }
    return moved;
  };
  assert.equal(step("DEPLOY_STARTED").to, "DEPLOYING");
  assert.equal(truth, "MAY_HAVE_WRITTEN");
  step("PRODUCTION_VERIFIED_OLD");
  assert.equal(truth, "MAY_HAVE_WRITTEN", "the mid-flight probe must not have settled anything");
  step("MISSION_INTERRUPTED");
  // The reviewer's bypass: the probe one move after the state name changed. It must still settle
  // nothing, because the writer is still unaccounted for.
  step("PRODUCTION_VERIFIED_OLD");
  assert.equal(truth, "MAY_HAVE_WRITTEN", "changing the state name does not account for the writer");
  step("GIT_MISMATCH"); step("PLAN_SELECTED");
  step("EXECUTOR_STARTED"); step("EXECUTOR_FAILED"); step("POST_INTEGRATION_VERIFIED");
  assert.equal(state, "READY_FOR_DEPLOYMENT");
  const second = step("DEPLOY_STARTED");
  assert.equal(second.ok, false, "the second production write must be refused");

  // And the honest route: the writer reports back, and only then does the reading settle.
  const completed = advance("DEPLOYING", "DEPLOY_COMPLETED", null, { context: withTruth("MAY_HAVE_WRITTEN") });
  assert.equal(completed.deploymentTruth, "WRITER_FINISHED_UNVERIFIED");
  const landed = advance("POST_DEPLOY_VERIFY", "PRODUCTION_VERIFIED_OLD", null, {
    context: withTruth("WRITER_FINISHED_UNVERIFIED"),
  });
  assert.equal(landed.deploymentTruth, "VERIFIED_OLD_PRODUCTION");
});

test("the writer-release fact is not the launch precondition read back", () => {
  // The vacuous-guard regression. startDeployment REQUIRES productionWriterLeaseAvailable === true
  // before it will launch, so a completion check reading that same field was reading back a value the
  // launch had already forced true — a rollout still in flight read as "the writer finished", the old
  // revision settled off it, and the mission redeployed. The two facts are now distinct and this test
  // pins them apart: with the launch precondition true and the release fact false, nothing settles.
  const launchedButNotReleased = {
    ...ALL_TRUE,
    deploymentTruth: "MAY_HAVE_WRITTEN" as DeploymentTruthV1,
    productionWriterLeaseAvailable: true,
    productionWriterLeaseReleasedByThisRun: false,
  };
  const claimed = advance("DEPLOYING", "DEPLOY_COMPLETED", null, { context: launchedButNotReleased });
  assert.equal(claimed.deploymentTruth, null, "the event does not get to assert its own precondition");

  // And the old reading still cannot settle off it, so the full laundering route stays closed.
  const probe = advance("POST_DEPLOY_VERIFY", "PRODUCTION_VERIFIED_OLD", null, { context: launchedButNotReleased });
  assert.equal(probe.deploymentTruth, null);
  assert.equal(
    advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: launchedButNotReleased }).ok,
    false,
    "no second production write while the writer is unaccounted for",
  );

  // With the release actually established, the honest sequence works.
  const released = { ...launchedButNotReleased, productionWriterLeaseReleasedByThisRun: true };
  assert.equal(advance("DEPLOYING", "DEPLOY_COMPLETED", null, { context: released }).deploymentTruth,
    "WRITER_FINISHED_UNVERIFIED");
});

// ---------------------------------------------------------------------------
// The field has to survive the thing it exists to survive
// ---------------------------------------------------------------------------

test("deployment truth has a durable home, and its absence is uncertainty", () => {
  // The sharpest finding of the review: the mechanism whose entire stated purpose is surviving a
  // Director restart did not survive one. `MissionStateRecordV1` had no slot for deploymentTruth, so
  // the whole model lived in a single process's memory; a restart re-assembled the context from gates
  // and the work-item board, NOTHING_PROVEN supplied the deploy-permitting default, and six ordinary
  // moves later the mission wrote production a second time. Nothing forged, no argument omitted.
  const record: MissionStateRecordV1 = {
    schema: MISSION_SCHEMA_V1,
    missionId: "m1",
    state: "DEPLOYING",
    resumeState: null,
    interruptedFrom: null,
    deploymentTruth: "MAY_HAVE_WRITTEN",
    currentRunId: "r1",
    currentExecutor: "grok",
    updatedAt: "2026-08-13T12:00:00.000Z",
    revision: 7,
  };
  // The field a reader must find after a reboot. Asserted structurally, because the defect was an
  // absent property rather than a wrong value — a test comparing values would have passed throughout.
  assert.ok(
    Object.prototype.hasOwnProperty.call(record, "deploymentTruth"),
    "the record must be able to carry what production is known to contain",
  );
  assert.equal(record.deploymentTruth, "MAY_HAVE_WRITTEN");

  // Reload with the field, and the second write stays refused.
  const reloaded = { ...ALL_TRUE, deploymentTruth: record.deploymentTruth };
  assert.equal(advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: reloaded }).ok, false);
});

test("omitting deployment truth refuses, exactly as omitting any other deployment fact does", () => {
  // It was the one deployment fact that failed OPEN when omitted. Every other one refuses, and this
  // asserts the symmetry rather than the single case, so a fact added later is held to it too.
  const board = {
    unresolvedRequiredGates: 0,
    unsatisfiedMandatoryWorkItems: 0,
    independentWorkRemains: false,
    postIntegrationVerificationPassed: true,
    postDeployVerificationPassed: true,
    deploymentDependenciesSatisfied: true,
    deploymentAuthorityPresent: true,
    productionWriterLeaseAvailable: true,
    productionWriterLeaseReleasedByThisRun: true,
    deploymentTruth: "NOT_STARTED" as DeploymentTruthV1,
  };
  assert.equal(advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: board }).ok, true);
  for (const omitted of Object.keys(board) as (keyof typeof board)[]) {
    const partial = { ...board };
    delete partial[omitted];
    const attempt = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: partial });
    if (omitted === "independentWorkRemains" || omitted === "postDeployVerificationPassed"
      || omitted === "unsatisfiedMandatoryWorkItems" || omitted === "productionWriterLeaseReleasedByThisRun") continue;
    assert.equal(attempt.ok, false, `omitting ${omitted} must refuse, not grant`);
  }
});

test("a truth value outside the union is uncertainty, not permission", () => {
  // completionPermittedByTruth was a three-value denylist while its sibling twenty lines above was a
  // closed allowlist documented as denying anything undecided. Everything the denylist had not
  // enumerated completed: null, "UNKNOWN", "may_have_written", "MAY_HAVE_WRITTEN ", 0, {}.
  assert.deepEqual(
    [...COMPLETABLE_TRUTHS].sort(),
    ["NOT_STARTED", "VERIFIED_OLD_PRODUCTION", "VERIFIED_TARGET_PRODUCTION"],
  );
  const forged = [
    null, undefined, "UNKNOWN", "ROLLED_BACK", "PARTIALLY_WRITTEN", "may_have_written",
    "MAY_HAVE_WRITTEN ", "", 0, 1, {}, [], true, Symbol("MAY_HAVE_WRITTEN"),
  ];
  for (const value of forged) {
    const context = { ...ALL_TRUE, deploymentTruth: value as DeploymentTruthV1 };
    const completed = advance("POST_DEPLOY_VERIFY", "MISSION_COMPLETED", null, { context });
    assert.equal(completed.ok, false, `${String(value)} must not complete a mission`);
    const deployed = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context });
    assert.equal(deployed.ok, false, `${String(value)} must not authorise a production write`);
  }
  // And the three real completable values still complete.
  for (const truth of COMPLETABLE_TRUTHS) {
    assert.equal(
      advance("POST_DEPLOY_VERIFY", "MISSION_COMPLETED", null, { context: withTruth(truth) }).ok,
      true,
      `${truth} must still complete`,
    );
  }
});

// ---------------------------------------------------------------------------
// Absence is its own value, and it arms nothing
// ---------------------------------------------------------------------------

test("a lost field cannot drive a settled truth backwards into a deployable one", () => {
  // The subtlest defect of the review. Absence used to map to MAY_HAVE_WRITTEN, which *looks*
  // conservative — it refuses deployment and completion. But MAY_HAVE_WRITTEN is also the exact value
  // DEPLOY_COMPLETED requires in order to downgrade to WRITER_FINISHED_UNVERIFIED, from which a stale
  // old-revision read settles to a deployable truth. So a mission that had already established
  // VERIFIED_TARGET_PRODUCTION — production confirmed written — could have that erased by a single
  // call whose context merely lost the field, and then deploy a second time. A fail-closed default
  // indistinguishable from a real recorded value is not fail-closed.
  const settled = { ...ALL_TRUE, deploymentTruth: "VERIFIED_TARGET_PRODUCTION" as DeploymentTruthV1 };
  assert.equal(advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: settled }).ok, false);

  // The caller loses the field — a Director restart re-assembling context from gates and the board.
  const lost: Partial<MissionContextV1> = { ...settled };
  delete (lost as Record<string, unknown>)["deploymentTruth"];
  const afterLoss = advance("DEPLOYING", "DEPLOY_COMPLETED", null, { context: lost });
  assert.equal(
    afterLoss.deploymentTruth, null,
    "a context with no deployment truth must not be able to write one",
  );

  // And the whole route stays shut: the old-revision read still settles nothing.
  const probe = advance("POST_DEPLOY_VERIFY", "PRODUCTION_VERIFIED_OLD", null, { context: lost });
  assert.equal(probe.deploymentTruth, null);
  assert.equal(advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: lost }).ok, false);
});

test("UNRECORDED is inert: in no allowlist, settling nothing, arming nothing", () => {
  assert.equal(NOTHING_PROVEN.deploymentTruth, "UNRECORDED");
  assert.equal(DEPLOYABLE_TRUTHS.includes("UNRECORDED"), false);
  assert.equal(COMPLETABLE_TRUTHS.includes("UNRECORDED"), false);
  assert.equal(deploymentPermittedByTruth("UNRECORDED"), false);
  assert.equal(completionPermittedByTruth("UNRECORDED"), false);

  const unrecorded = withTruth("UNRECORDED");
  // It cannot arm the one loosening edge in the machine.
  assert.equal(advance("DEPLOYING", "DEPLOY_COMPLETED", null, { context: unrecorded }).deploymentTruth, null);
  // It cannot settle the reading that unlocks a redeploy.
  assert.equal(advance("POST_DEPLOY_VERIFY", "PRODUCTION_VERIFIED_OLD", null, { context: unrecorded }).deploymentTruth, null);
  // It refuses in its own words rather than borrowing another situation's.
  const refused = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: unrecorded });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /nothing on record says/);
  assert.ok(!/nobody intended/.test(refused.reason), "an empty record is not an unexpected production state");
});

test("LIVENESS: a mission that has positively established its facts can still deploy and complete", () => {
  // The other half of every safety property, and the half tonight's reviews are structurally blind to
  // — they all hunt for permission granted wrongly, so a system that permits nothing at all passes
  // every one of them. This test fails if the fail-closed work has quietly made forward progress
  // impossible, which is the failure mode the conservative defaults could otherwise hide.
  const fresh = withTruth("NOT_STARTED");
  const started = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, { context: fresh });
  assert.equal(started.ok, true, started.reason);
  assert.equal(started.to, "DEPLOYING");
  assert.equal(started.deploymentTruth, "MAY_HAVE_WRITTEN");

  // Writer reports back with the release actually established, production is observed at target, and
  // the mission completes. Every step must be reachable; a machine that can only refuse is not safe,
  // it is broken.
  const running = { ...ALL_TRUE, deploymentTruth: "MAY_HAVE_WRITTEN" as DeploymentTruthV1 };
  const finished = advance("DEPLOYING", "DEPLOY_COMPLETED", null, { context: running });
  assert.equal(finished.ok, true);
  assert.equal(finished.deploymentTruth, "WRITER_FINISHED_UNVERIFIED");

  const observed = advance("POST_DEPLOY_VERIFY", "PRODUCTION_VERIFIED_TARGET", null, {
    context: { ...ALL_TRUE, deploymentTruth: "WRITER_FINISHED_UNVERIFIED" },
  });
  assert.equal(observed.deploymentTruth, "VERIFIED_TARGET_PRODUCTION");

  const done = advance("POST_DEPLOY_VERIFY", "MISSION_COMPLETED", null, {
    context: { ...ALL_TRUE, deploymentTruth: "VERIFIED_TARGET_PRODUCTION" },
  });
  assert.equal(done.ok, true, done.reason);
  assert.equal(done.to, "COMPLETED");

  // And a deployment that provably did not land may be retried, so a failed deploy is not terminal.
  const retry = advance("READY_FOR_DEPLOYMENT", "DEPLOY_STARTED", null, {
    context: { ...ALL_TRUE, deploymentTruth: "VERIFIED_OLD_PRODUCTION" },
  });
  assert.equal(retry.ok, true, retry.reason);
});
