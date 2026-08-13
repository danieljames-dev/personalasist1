/**
 * Independent deployment-truth model.
 *
 * Not Claude's runtime. Not the frozen 95-gate catalog.
 * Encodes the safety property: deployment uncertainty cannot be laundered
 * by any legal mission-state walk.
 */
export const DEPLOYMENT_TRUTH = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  MAY_HAVE_WRITTEN: "MAY_HAVE_WRITTEN",
  VERIFIED_OLD_PRODUCTION: "VERIFIED_OLD_PRODUCTION",
  VERIFIED_TARGET_PRODUCTION: "VERIFIED_TARGET_PRODUCTION",
  VERIFIED_UNEXPECTED: "VERIFIED_UNEXPECTED",
});

export const VERIFICATION_OUTCOMES = Object.freeze({
  OLD_SHA: "OLD_SHA",
  TARGET_SHA: "TARGET_SHA",
  UNEXPECTED_SHA: "UNEXPECTED_SHA",
  PROCESS_UNAVAILABLE: "PROCESS_UNAVAILABLE",
  CHECKOUT_UNREADABLE: "CHECKOUT_UNREADABLE",
  AMBIGUOUS: "AMBIGUOUS",
});

/** Events that may resolve MAY_HAVE_WRITTEN. Nothing else. */
export const PRODUCTION_TRUTH_EVENTS = Object.freeze([
  "PRODUCTION_VERIFIED_OLD",
  "PRODUCTION_VERIFIED_TARGET",
  "PRODUCTION_VERIFIED_UNEXPECTED",
  "PRODUCTION_VERIFY_INCONCLUSIVE",
]);

export const INCONCLUSIVE_OUTCOMES = Object.freeze([
  VERIFICATION_OUTCOMES.PROCESS_UNAVAILABLE,
  VERIFICATION_OUTCOMES.CHECKOUT_UNREADABLE,
  VERIFICATION_OUTCOMES.AMBIGUOUS,
]);

export function initialContext(over = {}) {
  return {
    state: "READY_FOR_DEPLOYMENT",
    deploymentTruth: DEPLOYMENT_TRUTH.NOT_STARTED,
    pausedFrom: null,
    physicalGate: "APPROVED",
    deployGate: "APPROVED",
    postDeployVerified: false,
    deployStarts: 0,
    processLaunched: false,
    deployRequired: true,
    ...over,
  };
}

export function applyVerificationOutcome(truth, outcome) {
  if (truth !== DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN) {
    return { truth, missionHint: null, mayLaterDeploy: truth === DEPLOYMENT_TRUTH.NOT_STARTED || truth === DEPLOYMENT_TRUTH.VERIFIED_OLD_PRODUCTION };
  }
  if (outcome === VERIFICATION_OUTCOMES.OLD_SHA) {
    return {
      truth: DEPLOYMENT_TRUTH.VERIFIED_OLD_PRODUCTION,
      missionHint: null,
      mayLaterDeploy: true,
      proceedPostDeploy: false,
      blocked: false,
    };
  }
  if (outcome === VERIFICATION_OUTCOMES.TARGET_SHA) {
    return {
      truth: DEPLOYMENT_TRUTH.VERIFIED_TARGET_PRODUCTION,
      missionHint: "POST_DEPLOY_VERIFY",
      mayLaterDeploy: false,
      proceedPostDeploy: true,
      blocked: false,
    };
  }
  if (outcome === VERIFICATION_OUTCOMES.UNEXPECTED_SHA) {
    return {
      truth: DEPLOYMENT_TRUTH.VERIFIED_UNEXPECTED,
      missionHint: "BLOCKED",
      mayLaterDeploy: false,
      proceedPostDeploy: false,
      blocked: true,
    };
  }
  return {
    truth: DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN,
    missionHint: "BLOCKED",
    mayLaterDeploy: false,
    proceedPostDeploy: false,
    blocked: true,
    stillUncertain: true,
  };
}

export function deployEligible(ctx) {
  if (ctx.state === "COMPLETED" || ctx.state === "FAILED") return false;
  if (ctx.state === "PAUSED") return false;
  if (ctx.state !== "READY_FOR_DEPLOYMENT") return false;
  if (ctx.physicalGate === "OPEN" || ctx.deployGate === "OPEN") return false;
  if (ctx.deploymentTruth === DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN) return false;
  if (ctx.deploymentTruth === DEPLOYMENT_TRUTH.VERIFIED_UNEXPECTED) return false;
  if (ctx.deploymentTruth === DEPLOYMENT_TRUTH.VERIFIED_TARGET_PRODUCTION) return false;
  return ctx.deploymentTruth === DEPLOYMENT_TRUTH.NOT_STARTED
    || ctx.deploymentTruth === DEPLOYMENT_TRUTH.VERIFIED_OLD_PRODUCTION;
}

export function completionLegal(ctx) {
  if (ctx.deploymentTruth === DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN) return false;
  if (ctx.deploymentTruth === DEPLOYMENT_TRUTH.VERIFIED_UNEXPECTED) return false;
  if (ctx.deployRequired && ctx.deploymentTruth !== DEPLOYMENT_TRUTH.VERIFIED_TARGET_PRODUCTION) return false;
  if (ctx.deployRequired && !ctx.postDeployVerified) return false;
  return ctx.state === "POST_DEPLOY_VERIFY";
}

/**
 * Wide recovery graph on purpose. Safety must not depend on forbidding
 * INTERRUPTED→BLOCKED→PLANNING. That walk is legal recovery for ordinary work.
 */
const WIDE = {
  CREATED: ["MISSION_AUTHORIZED"],
  AUTHORIZED: ["PLAN_SELECTED"],
  PLANNING: ["EXECUTOR_STARTED", "MISSION_PAUSED", "MISSION_BLOCKED"],
  EXECUTOR_RUNNING: [
    "EXECUTOR_COMPLETED", "EXECUTOR_FAILED", "MISSION_INTERRUPTED",
    "EXECUTOR_CAPACITY_EXHAUSTED", "MISSION_PAUSED",
  ],
  EXECUTOR_RESULT_RECEIVED: ["GIT_VERIFIED", "GIT_MISMATCH"],
  VERIFYING: [
    "REVIEW_REQUESTED", "POST_INTEGRATION_VERIFIED", "MISSION_BLOCKED",
    "OWNER_GATE_OPENED", "MISSION_PAUSED", "MISSION_INTERRUPTED",
  ],
  INDEPENDENT_REVIEW: ["REVIEW_COMPLETED", "REVIEW_REJECTED", "MISSION_BLOCKED"],
  READY_FOR_INTEGRATION: ["INTEGRATION_STARTED", "MISSION_PAUSED", "MISSION_BLOCKED"],
  INTEGRATING: ["INTEGRATION_COMPLETED", "GIT_MISMATCH", "MISSION_INTERRUPTED"],
  OWNER_GATE_REQUIRED: ["MISSION_PAUSED", "OWNER_GATE_RESOLVED"],
  WAITING_FOR_OWNER: ["OWNER_GATE_RESOLVED", "MISSION_PAUSED", "MISSION_BLOCKED", "PLAN_SELECTED"],
  WAITING_FOR_CAPACITY: ["EXECUTOR_STARTED", "MISSION_PAUSED", "MISSION_BLOCKED", "PLAN_SELECTED"],
  READY_FOR_DEPLOYMENT: ["DEPLOY_STARTED", "OWNER_GATE_OPENED", "MISSION_PAUSED", "MISSION_INTERRUPTED"],
  DEPLOYING: ["DEPLOY_COMPLETED", "MISSION_INTERRUPTED", "MISSION_BLOCKED", "MISSION_FAILED"],
  POST_DEPLOY_VERIFY: ["MISSION_COMPLETED", "MISSION_FAILED", "MISSION_INTERRUPTED"],
  BLOCKED: ["PLAN_SELECTED", "MISSION_FAILED", "MISSION_PAUSED", "MISSION_INTERRUPTED"],
  INTERRUPTED: [
    "GIT_VERIFIED", "GIT_MISMATCH", "MISSION_PAUSED",
    "OWNER_GATE_OPENED", "EXECUTOR_CAPACITY_EXHAUSTED",
  ],
  PAUSED: ["MISSION_RESUMED", "MISSION_INTERRUPTED"],
  COMPLETED: [],
  FAILED: [],
};

function clone(ctx) {
  return { ...ctx };
}

function go(ctx, state) {
  const next = clone(ctx);
  next.state = state;
  return next;
}

function applyMissionEventCorrect(ctx, event) {
  if (ctx.state === "COMPLETED" || ctx.state === "FAILED") {
    return { ok: false, ctx, reason: "terminal" };
  }

  if (PRODUCTION_TRUTH_EVENTS.includes(event)) {
    const map = {
      PRODUCTION_VERIFIED_OLD: VERIFICATION_OUTCOMES.OLD_SHA,
      PRODUCTION_VERIFIED_TARGET: VERIFICATION_OUTCOMES.TARGET_SHA,
      PRODUCTION_VERIFIED_UNEXPECTED: VERIFICATION_OUTCOMES.UNEXPECTED_SHA,
      PRODUCTION_VERIFY_INCONCLUSIVE: VERIFICATION_OUTCOMES.AMBIGUOUS,
    };
    const applied = applyVerificationOutcome(ctx.deploymentTruth, map[event]);
    const next = clone(ctx);
    next.deploymentTruth = applied.truth;
    if (applied.truth === DEPLOYMENT_TRUTH.VERIFIED_TARGET_PRODUCTION) {
      next.state = "POST_DEPLOY_VERIFY";
      next.postDeployVerified = true;
    } else if (applied.blocked) {
      next.state = "BLOCKED";
    }
    return { ok: true, ctx: next, reason: event };
  }

  if (event === "DIRECTOR_RESTART") {
    if (ctx.state === "COMPLETED" || ctx.state === "FAILED") return { ok: false, ctx, reason: "terminal" };
    const next = clone(ctx);
    next.state = "INTERRUPTED";
    next.processLaunched = false;
    return { ok: true, ctx: next, reason: "restart-does-not-resolve-deploy-truth" };
  }

  if (event === "DEPLOY_STARTED") {
    if (!deployEligible(ctx)) {
      return { ok: false, ctx, reason: "deploy-not-eligible" };
    }
    const next = clone(ctx);
    next.deploymentTruth = DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN;
    next.deployStarts += 1;
    next.state = "DEPLOYING";
    next.processLaunched = true;
    return { ok: true, ctx: next, reason: "truth-latched-before-process" };
  }

  if (event === "POST_DEPLOY_MARK_COMPLETE") {
    const next = clone(ctx);
    next.postDeployVerified = true;
    return { ok: true, ctx: next };
  }

  const allowed = WIDE[ctx.state] || [];
  if (!allowed.includes(event)) return { ok: false, ctx, reason: "illegal-event" };

  if (event === "MISSION_PAUSED") {
    const next = clone(ctx);
    next.pausedFrom = ctx.state;
    next.state = "PAUSED";
    return { ok: true, ctx: next };
  }
  if (event === "MISSION_RESUMED") {
    return { ok: true, ctx: go(ctx, ctx.pausedFrom || "VERIFYING") };
  }
  if (event === "MISSION_INTERRUPTED") return { ok: true, ctx: go(ctx, "INTERRUPTED") };
  if (event === "MISSION_BLOCKED" || event === "GIT_MISMATCH") return { ok: true, ctx: go(ctx, "BLOCKED") };
  if (event === "PLAN_SELECTED") return { ok: true, ctx: go(ctx, "PLANNING") };
  if (event === "EXECUTOR_STARTED") return { ok: true, ctx: go(ctx, "EXECUTOR_RUNNING") };
  if (event === "EXECUTOR_COMPLETED") return { ok: true, ctx: go(ctx, "EXECUTOR_RESULT_RECEIVED") };
  if (event === "EXECUTOR_FAILED") return { ok: true, ctx: go(ctx, "VERIFYING") };
  if (event === "EXECUTOR_CAPACITY_EXHAUSTED") return { ok: true, ctx: go(ctx, "WAITING_FOR_CAPACITY") };
  if (event === "GIT_VERIFIED") return { ok: true, ctx: go(ctx, "VERIFYING") };
  if (event === "REVIEW_REQUESTED") return { ok: true, ctx: go(ctx, "INDEPENDENT_REVIEW") };
  if (event === "REVIEW_COMPLETED") return { ok: true, ctx: go(ctx, "READY_FOR_INTEGRATION") };
  if (event === "REVIEW_REJECTED") return { ok: true, ctx: go(ctx, "PLANNING") };
  if (event === "POST_INTEGRATION_VERIFIED") return { ok: true, ctx: go(ctx, "READY_FOR_DEPLOYMENT") };
  if (event === "INTEGRATION_STARTED") return { ok: true, ctx: go(ctx, "INTEGRATING") };
  if (event === "INTEGRATION_COMPLETED") return { ok: true, ctx: go(ctx, "VERIFYING") };
  if (event === "OWNER_GATE_OPENED") {
    const next = go(ctx, "OWNER_GATE_REQUIRED");
    next.deployGate = "OPEN";
    return { ok: true, ctx: next };
  }
  if (event === "OWNER_GATE_RESOLVED") {
    const next = go(ctx, "READY_FOR_DEPLOYMENT");
    next.physicalGate = "APPROVED";
    next.deployGate = "APPROVED";
    return { ok: true, ctx: next };
  }
  if (event === "MISSION_AUTHORIZED") return { ok: true, ctx: go(ctx, "AUTHORIZED") };
  if (event === "DEPLOY_COMPLETED") return { ok: true, ctx: go(ctx, "POST_DEPLOY_VERIFY") };
  if (event === "MISSION_FAILED") return { ok: true, ctx: go(ctx, "FAILED") };
  if (event === "MISSION_COMPLETED") {
    if (!completionLegal(ctx)) return { ok: false, ctx, reason: "completion-blocked-by-deploy-truth" };
    return { ok: true, ctx: go(ctx, "COMPLETED") };
  }
  return { ok: false, ctx, reason: "unhandled" };
}

/**
 * Defective class: uncertainty is a breadcrumb (`interruptedFrom`) that other
 * legal transitions drop. Matches the demonstrated laundering family.
 */
export function applyMissionEventDefective(ctx, event) {
  if (ctx.state === "COMPLETED" || ctx.state === "FAILED") {
    return { ok: false, ctx, reason: "terminal" };
  }
  const next = clone(ctx);
  next.interruptedFrom = ctx.interruptedFrom ?? null;

  if (event === "DEPLOY_STARTED") {
    if (next.state !== "READY_FOR_DEPLOYMENT") return { ok: false, ctx, reason: "not-ready" };
    if (next.physicalGate === "OPEN" || next.deployGate === "OPEN") return { ok: false, ctx, reason: "gate" };
    next.state = "DEPLOYING";
    next.deployStarts += 1;
    next.processLaunched = true;
    next.interruptedFrom = null;
    return { ok: true, ctx: next, reason: "defective-no-prelaunch-latch" };
  }
  if (event === "MISSION_INTERRUPTED" || event === "DIRECTOR_RESTART") {
    next.interruptedFrom = next.state;
    next.state = "INTERRUPTED";
    return { ok: true, ctx: next };
  }
  if (event === "GIT_MISMATCH" || event === "MISSION_BLOCKED") {
    next.state = "BLOCKED";
    return { ok: true, ctx: next };
  }
  if (event === "PLAN_SELECTED") {
    next.state = "PLANNING";
    next.interruptedFrom = null;
    return { ok: true, ctx: next };
  }
  if (event === "EXECUTOR_STARTED") {
    next.state = "EXECUTOR_RUNNING";
    next.interruptedFrom = null;
    return { ok: true, ctx: next };
  }
  if (event === "EXECUTOR_FAILED") {
    next.state = "VERIFYING";
    next.interruptedFrom = null;
    return { ok: true, ctx: next };
  }
  if (event === "POST_INTEGRATION_VERIFIED") {
    next.state = "READY_FOR_DEPLOYMENT";
    next.interruptedFrom = null;
    return { ok: true, ctx: next };
  }
  if (event === "OWNER_GATE_RESOLVED") {
    next.state = "READY_FOR_DEPLOYMENT";
    next.deployGate = "APPROVED";
    next.physicalGate = "APPROVED";
    next.interruptedFrom = null;
    return { ok: true, ctx: next };
  }
  if (event === "MISSION_PAUSED") {
    next.pausedFrom = next.state;
    next.state = "PAUSED";
    return { ok: true, ctx: next };
  }
  if (event === "MISSION_RESUMED") {
    next.state = next.pausedFrom || "VERIFYING";
    return { ok: true, ctx: next };
  }
  if (event === "GIT_VERIFIED") {
    next.state = "VERIFYING";
    next.interruptedFrom = null;
    return { ok: true, ctx: next };
  }
  if (event === "EXECUTOR_CAPACITY_EXHAUSTED") {
    next.state = "WAITING_FOR_CAPACITY";
    return { ok: true, ctx: next };
  }
  if (event === "OWNER_GATE_OPENED") {
    next.state = "OWNER_GATE_REQUIRED";
    next.deployGate = "OPEN";
    return { ok: true, ctx: next };
  }
  if (event === "MISSION_COMPLETED") {
    next.state = "COMPLETED";
    return { ok: true, ctx: next };
  }
  if (PRODUCTION_TRUTH_EVENTS.includes(event)) {
    return { ok: true, ctx: next, reason: "defective-verify-does-not-stick" };
  }
  const allowed = WIDE[ctx.state] || [];
  if (!allowed.includes(event)) return { ok: false, ctx, reason: "illegal-event" };
  const mapped = applyMissionEventCorrect({ ...ctx, deploymentTruth: DEPLOYMENT_TRUTH.NOT_STARTED }, event);
  if (!mapped.ok) return mapped;
  mapped.ctx.interruptedFrom = next.interruptedFrom;
  mapped.ctx.deployStarts = ctx.deployStarts;
  return mapped;
}

export function applyCorrect(ctx, event) {
  return applyMissionEventCorrect(ctx, event);
}

export function eventsFrom(state) {
  const extra = [
    ...PRODUCTION_TRUTH_EVENTS,
    "DIRECTOR_RESTART",
    "POST_DEPLOY_MARK_COMPLETE",
  ];
  return [...new Set([...(WIDE[state] || []), ...extra])];
}
