/**
 * Bounded BFS over (mission state × deploymentTruth × gates).
 * Hard property: MAY_HAVE_WRITTEN must not reach DEPLOY_STARTED.
 */
import {
  DEPLOYMENT_TRUTH,
  applyCorrect,
  applyMissionEventDefective,
  eventsFrom,
  initialContext,
  completionLegal,
} from "./deployment-truth-model.mjs";

function key(ctx) {
  return [
    ctx.state,
    ctx.deploymentTruth || "NONE",
    ctx.pausedFrom || "-",
    ctx.physicalGate,
    ctx.deployGate,
    ctx.postDeployVerified ? "1" : "0",
    String(ctx.deployStarts),
    ctx.interruptedFrom || "-",
  ].join("|");
}

export function explore(opts) {
  const {
    apply,
    start = initialContext(),
    maxDepth = 14,
    maxVisits = 80_000,
    stopOnSecondDeploy = true,
  } = opts;

  const queue = [{ ctx: start, path: [], depth: 0 }];
  const seen = new Set([key(start)]);
  const secondDeploys = [];
  const illegalCompletions = [];
  let visits = 0;

  while (queue.length && visits < maxVisits) {
    const cur = queue.shift();
    visits += 1;
    if (cur.depth >= maxDepth) continue;

    for (const event of eventsFrom(cur.ctx.state)) {
      const r = apply(cur.ctx, event);
      if (!r.ok) continue;
      const nextPath = [...cur.path, event];

      if (event === "DEPLOY_STARTED" && r.ok) {
        const prior = cur.ctx.deploymentTruth;
        const verifiedOld = prior === DEPLOYMENT_TRUTH.VERIFIED_OLD_PRODUCTION;
        if (cur.ctx.deployStarts >= 1 && !verifiedOld) {
          secondDeploys.push({
            path: nextPath,
            from: cur.ctx,
            to: r.ctx,
            priorTruth: prior,
          });
          if (stopOnSecondDeploy && secondDeploys.length >= 8) {
            return summarize(secondDeploys, illegalCompletions, visits, seen.size);
          }
        }
      }

      if (event === "MISSION_COMPLETED") {
        const probe = { ...r.ctx, state: "POST_DEPLOY_VERIFY" };
        if (r.ctx.deploymentTruth && !completionLegal({ ...cur.ctx, state: "POST_DEPLOY_VERIFY" })) {
          illegalCompletions.push({ path: nextPath, ctx: r.ctx });
        }
        if (cur.ctx.deploymentTruth === DEPLOYMENT_TRUTH.MAY_HAVE_WRITTEN
          || cur.ctx.deploymentTruth === DEPLOYMENT_TRUTH.VERIFIED_UNEXPECTED
          || (cur.ctx.deployRequired && !cur.ctx.postDeployVerified && apply === applyCorrect)) {
          if (r.ok && r.ctx.state === "COMPLETED" && apply === applyCorrect) {
            illegalCompletions.push({ path: nextPath, ctx: r.ctx, note: "correct-model-accepted-bad-complete" });
          }
        }
        if (apply === applyMissionEventDefective && r.ctx.state === "COMPLETED"
          && (cur.ctx.deployStarts > 0 && !cur.ctx.postDeployVerified)) {
          illegalCompletions.push({ path: nextPath, ctx: r.ctx, note: "defective-completed-without-post-deploy" });
        }
      }

      const k = key(r.ctx);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ ctx: r.ctx, path: nextPath, depth: cur.depth + 1 });
    }
  }

  return summarize(secondDeploys, illegalCompletions, visits, seen.size);
}

function summarize(secondDeploys, illegalCompletions, visits, unique) {
  const shortest = secondDeploys.slice().sort((a, b) => a.path.length - b.path.length)[0] || null;
  return {
    visits,
    unique,
    secondDeployCount: secondDeploys.length,
    shortestSecondDeploy: shortest,
    alternateSecondDeploys: secondDeploys
      .slice()
      .sort((a, b) => a.path.length - b.path.length)
      .slice(0, 6)
      .map((x) => x.path),
    illegalCompletions: illegalCompletions.slice(0, 6),
  };
}

export function exploreCorrect(start) {
  return explore({ apply: applyCorrect, start, stopOnSecondDeploy: false });
}

export function exploreDefective(start) {
  return explore({ apply: applyMissionEventDefective, start, stopOnSecondDeploy: false });
}

export const KNOWN_LAUNDER_CHAIN = Object.freeze([
  "DEPLOY_STARTED",
  "MISSION_INTERRUPTED",
  "GIT_MISMATCH",
  "PLAN_SELECTED",
  "EXECUTOR_STARTED",
  "EXECUTOR_FAILED",
  "POST_INTEGRATION_VERIFIED",
  "DEPLOY_STARTED",
]);

export function replay(apply, events, start = initialContext()) {
  let ctx = start;
  const steps = [];
  for (const event of events) {
    const r = apply(ctx, event);
    steps.push({ event, ok: r.ok, reason: r.reason, state: r.ctx.state, truth: r.ctx.deploymentTruth, deploys: r.ctx.deployStarts });
    if (!r.ok) return { ok: false, ctx, steps };
    ctx = r.ctx;
  }
  return { ok: true, ctx, steps };
}
