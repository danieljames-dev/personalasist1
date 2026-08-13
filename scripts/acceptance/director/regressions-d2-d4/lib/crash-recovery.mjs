/**
 * Recovery reconstructs truth. Missing completion ≠ repeat the action.
 */
export const CRASH_POINTS = Object.freeze([
  "BEFORE_RUN_RECORD",
  "RECORD_BEFORE_SPAWN",
  "SPAWNED_BEFORE_IDENTITY",
  "EXECUTOR_RUNNING",
  "FINISHED_BEFORE_HANDOFF_VALIDATE",
  "HANDOFF_VALIDATED_BEFORE_STATE",
  "GIT_CHANGED_BEFORE_RESULT",
  "LEASE_HELD",
]);

export function recover(crash) {
  const {
    point,
    runRecord,
    processIdentity,
    processObservation,
    handoff,
    handoffValid,
    gitBefore,
    gitAfter,
    leaseHeld,
    wasDeploy,
    deploymentTruth,
  } = crash;

  if (point === "BEFORE_RUN_RECORD") {
    return { action: "NOOP", reason: "nothing-durable; do-not-invent-a-run" };
  }
  if (point === "RECORD_BEFORE_SPAWN") {
    return { action: "MARK_INTERRUPTED_NEVER_STARTED", reason: "record exists, no process identity; do-not-spawn-duplicate" };
  }
  if (point === "SPAWNED_BEFORE_IDENTITY") {
    return {
      action: "SCAN_THEN_INTERRUPT",
      reason: "may-have-started; inspect host by nonce; never assume failed; never assume success",
    };
  }
  if (point === "EXECUTOR_RUNNING") {
    if (processObservation?.alive && processIdentity) {
      return { action: "REATTACH", reason: "same pid+creation+exe+nonce still alive" };
    }
    return { action: "INTERRUPTED_THEN_VERIFY", reason: "not-alive-or-identity-mismatch; look at Git and artifacts" };
  }
  if (point === "FINISHED_BEFORE_HANDOFF_VALIDATE") {
    if (handoff && handoffValid) return { action: "VALIDATE_THEN_ADVANCE", reason: "handoff present after crash" };
    return { action: "INTERRUPTED_THEN_VERIFY", reason: "exit-or-crash without trustworthy handoff" };
  }
  if (point === "HANDOFF_VALIDATED_BEFORE_STATE") {
    return { action: "REAPPLY_VALIDATED_RESULT", reason: "do-not-rerun-executor; persist already-validated outcome" };
  }
  if (point === "GIT_CHANGED_BEFORE_RESULT") {
    return {
      action: "TRUST_GIT_NOT_MEMORY",
      reason: "collect Git truth; do-not-repeat-commit-or-deploy",
      gitBefore,
      gitAfter,
    };
  }
  if (point === "LEASE_HELD") {
    return {
      action: leaseHeld ? "STALE_CHECK_THEN_MAYBE_RECLAIM" : "NOOP",
      reason: "pid-missing-is-not-ownership",
    };
  }
  if (wasDeploy && deploymentTruth === "MAY_HAVE_WRITTEN") {
    return { action: "VERIFY_PRODUCTION", reason: "never-second-deploy" };
  }
  return { action: "BLOCKED", reason: "unrecognized-crash-point" };
}

export function mustNotRepeat(crash) {
  const r = recover(crash);
  return r.action !== "RESPAWN_SAME_RUN" && r.action !== "DEPLOY_AGAIN";
}
