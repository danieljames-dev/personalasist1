/**
 * Known-defect regressions for deployment uncertainty.
 * These must fail against the breadcrumb/interruptedFrom machine
 * and pass against the sticky deploymentTruth machine.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOYMENT_TRUTH,
  VERIFICATION_OUTCOMES,
  applyCorrect,
  applyMissionEventDefective,
  applyVerificationOutcome,
  completionLegal,
  deployEligible,
  initialContext,
} from "./deployment-truth-model.mjs";
import {
  KNOWN_LAUNDER_CHAIN,
  exploreCorrect,
  exploreDefective,
  replay,
} from "./deployment-truth-explorer.mjs";

const start = () => initialContext();

test("known defective chain allows a second DEPLOY_STARTED (oracle would fail that implementation)", () => {
  const r = replay(applyMissionEventDefective, KNOWN_LAUNDER_CHAIN, start());
  assert.equal(r.ok, true, JSON.stringify(r.steps.slice(-2)));
  assert.equal(r.ctx.deployStarts, 2);
  assert.equal(r.ctx.state, "DEPLOYING");
});

test("correct machine rejects the same chain at the second DEPLOY_STARTED", () => {
  const r = replay(applyCorrect, KNOWN_LAUNDER_CHAIN, start());
  assert.equal(r.ok, false);
  assert.equal(r.steps.at(-1).event, "DEPLOY_STARTED");
  assert.equal(r.steps.at(-1).ok, false);
  assert.equal(r.ctx.deployStarts, 1);
  assert.equal(r.ctx.deploymentTruth, DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN);
});

test("DEPLOY_STARTED latches MAY_HAVE_WRITTEN before a process is modeled as launched", () => {
  const r = applyCorrect(start(), "DEPLOY_STARTED");
  assert.equal(r.ok, true);
  assert.equal(r.ctx.deploymentTruth, DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN);
  assert.equal(r.ctx.processLaunched, true);
  assert.equal(r.reason, "truth-latched-before-process");
  assert.equal(deployEligible(r.ctx), false);
});

test("INTERRUPTED, BLOCKED, PLANNING, VERIFYING, pause, gate, capacity, restart do not clear MAY_HAVE_WRITTEN", () => {
  let ctx = applyCorrect(start(), "DEPLOY_STARTED").ctx;
  const walk = [
    "MISSION_INTERRUPTED",
    "GIT_MISMATCH",
    "PLAN_SELECTED",
    "EXECUTOR_STARTED",
    "EXECUTOR_FAILED",
    "MISSION_PAUSED",
    "MISSION_RESUMED",
    "OWNER_GATE_OPENED",
    "OWNER_GATE_RESOLVED",
    "EXECUTOR_CAPACITY_EXHAUSTED",
    "DIRECTOR_RESTART",
    "POST_INTEGRATION_VERIFIED",
  ];
  for (const event of walk) {
    const r = applyCorrect(ctx, event);
    if (!r.ok) continue;
    ctx = r.ctx;
    assert.equal(ctx.deploymentTruth, DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN, event);
    assert.equal(deployEligible(ctx), false, event);
  }
});

test("only production verification may resolve MAY_HAVE_WRITTEN", () => {
  const from = applyCorrect(start(), "DEPLOY_STARTED").ctx;
  const old = applyCorrect(from, "PRODUCTION_VERIFIED_OLD");
  assert.equal(old.ctx.deploymentTruth, DEPLOYMENT_TRUTH.VERIFIED_OLD_PRODUCTION);
  assert.equal(deployEligible({ ...old.ctx, state: "READY_FOR_DEPLOYMENT" }), true);

  const target = applyCorrect(from, "PRODUCTION_VERIFIED_TARGET");
  assert.equal(target.ctx.deploymentTruth, DEPLOYMENT_TRUTH.VERIFIED_TARGET_PRODUCTION);
  assert.equal(target.ctx.state, "POST_DEPLOY_VERIFY");
  assert.equal(deployEligible(target.ctx), false);

  const unexpected = applyCorrect(from, "PRODUCTION_VERIFIED_UNEXPECTED");
  assert.equal(unexpected.ctx.deploymentTruth, DEPLOYMENT_TRUTH.VERIFIED_UNEXPECTED);
  assert.equal(unexpected.ctx.state, "BLOCKED");
  assert.equal(deployEligible({ ...unexpected.ctx, state: "READY_FOR_DEPLOYMENT" }), false);

  const inconclusive = applyCorrect(from, "PRODUCTION_VERIFY_INCONCLUSIVE");
  assert.equal(inconclusive.ctx.deploymentTruth, DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN);
  assert.equal(inconclusive.ctx.state, "BLOCKED");
  assert.equal(deployEligible({ ...inconclusive.ctx, state: "READY_FOR_DEPLOYMENT" }), false);
});

test("verification outcome table matches the policy", () => {
  const old = applyVerificationOutcome(DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN, VERIFICATION_OUTCOMES.OLD_SHA);
  const tgt = applyVerificationOutcome(DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN, VERIFICATION_OUTCOMES.TARGET_SHA);
  const bad = applyVerificationOutcome(DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN, VERIFICATION_OUTCOMES.UNEXPECTED_SHA);
  const down = applyVerificationOutcome(DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN, VERIFICATION_OUTCOMES.PROCESS_UNAVAILABLE);
  const unread = applyVerificationOutcome(DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN, VERIFICATION_OUTCOMES.CHECKOUT_UNREADABLE);
  const amb = applyVerificationOutcome(DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN, VERIFICATION_OUTCOMES.AMBIGUOUS);
  assert.equal(old.mayLaterDeploy, true);
  assert.equal(tgt.proceedPostDeploy, true);
  assert.equal(bad.blocked, true);
  assert.equal(down.stillUncertain, true);
  assert.equal(unread.truth, DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN);
  assert.equal(amb.truth, DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN);
});

test("mission cannot COMPLETE while uncertain, unexpected, or post-deploy incomplete", () => {
  const uncertain = initialContext({
    state: "POST_DEPLOY_VERIFY",
    deploymentTruth: DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN,
    postDeployVerified: false,
  });
  assert.equal(completionLegal(uncertain), false);
  assert.equal(applyCorrect(uncertain, "MISSION_COMPLETED").ok, false);

  const unexpected = initialContext({
    state: "POST_DEPLOY_VERIFY",
    deploymentTruth: DEPLOYMENT_TRUTH.VERIFIED_UNEXPECTED,
    postDeployVerified: true,
  });
  assert.equal(completionLegal(unexpected), false);

  const incomplete = initialContext({
    state: "POST_DEPLOY_VERIFY",
    deploymentTruth: DEPLOYMENT_TRUTH.VERIFIED_TARGET_PRODUCTION,
    postDeployVerified: false,
  });
  assert.equal(completionLegal(incomplete), false);

  const done = initialContext({
    state: "POST_DEPLOY_VERIFY",
    deploymentTruth: DEPLOYMENT_TRUTH.VERIFIED_TARGET_PRODUCTION,
    postDeployVerified: true,
  });
  assert.equal(completionLegal(done), true);
  assert.equal(applyCorrect(done, "MISSION_COMPLETED").ctx.state, "COMPLETED");
});

test("correct explorer: no second DEPLOY_STARTED while MAY_HAVE_WRITTEN", () => {
  const afterFirst = applyCorrect(start(), "DEPLOY_STARTED").ctx;
  const report = exploreCorrect(afterFirst);
  assert.equal(report.secondDeployCount, 0, JSON.stringify(report.shortestSecondDeploy));
});

test("defective explorer: finds the known family and shorter/alternate chains", () => {
  const afterFirst = applyMissionEventDefective(start(), "DEPLOY_STARTED").ctx;
  const report = exploreDefective(afterFirst);
  assert.ok(report.secondDeployCount > 0, "defective model must be reachable; otherwise this test is weak");
  assert.ok(report.shortestSecondDeploy.path.length >= 2);
  const joined = report.alternateSecondDeploys.map((p) => p.join(">"));
  assert.ok(joined.some((p) => p.includes("PLAN_SELECTED") || p.includes("MISSION_PAUSED") || p.includes("GIT_VERIFIED")));
});

test("Director death is not deployment failure: restart leaves MAY_HAVE_WRITTEN", () => {
  const deployed = applyCorrect(start(), "DEPLOY_STARTED").ctx;
  const restart = applyCorrect(deployed, "DIRECTOR_RESTART");
  assert.equal(restart.ok, true);
  assert.equal(restart.ctx.state, "INTERRUPTED");
  assert.equal(restart.ctx.deploymentTruth, DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN);
  assert.equal(deployEligible({ ...restart.ctx, state: "READY_FOR_DEPLOYMENT" }), false);
});
