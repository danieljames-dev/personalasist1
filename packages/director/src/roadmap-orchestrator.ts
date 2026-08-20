/**
 * The control loop that makes AION the thing that continues, rather than the chat session.
 *
 * One pass: load the roadmap, refuse to proceed if the graph is malformed, compute what is ready,
 * pick one deterministically, resolve its authority, dispatch it through the existing Provider
 * Bridge, verify it against a plan declared before it ran, review it if its risk demands review, and
 * only then mark it complete and let its dependants become ready. Repeat until nothing is eligible.
 *
 * ## Every stop is explicit
 *
 * The loop ends for a named reason — no eligible work, a malformed graph, an Owner gate, an
 * exhausted retry budget, a step ceiling. It never ends because a model decided it was finished, and
 * it never continues because a model decided it was not. A bounded `maxSteps` exists so that a bug in
 * readiness cannot turn into an infinite dispatch loop; hitting it is reported, not hidden.
 *
 * ## An Owner gate blocks one branch, not the roadmap
 *
 * A milestone needing a fresh Owner decision gets a persisted gate and moves to
 * `WAITING_OWNER_AUTHORIZATION`; the loop then continues with whatever else is ready. That is the
 * difference between a system that waits for a person and a system that stops for one.
 *
 * ## Restart assumes the worst about in-flight work
 *
 * `recoverRoadmap` treats anything caught mid-flight as unfinished, and anything whose external
 * effect is ambiguous as `RECOVERY_REQUIRED` rather than retryable. Completed milestones are never
 * reopened. That combination is what makes a restart safe: work may be repeated only where repeating
 * it cannot duplicate an effect.
 */

import type { ProviderIdV1 } from "./provider-bridge.js";
import { submitJob, type JobRequestV1, type MvaDispatchDepsV1 } from "./mva-dispatch.js";
import {
  ROADMAP_PACKET_SCHEMA_V1,
  legalMilestoneTransition,
  roadmapFingerprint,
  type MilestoneStateV1,
  type RoadmapEventTypeV1,
  type RoadmapMilestoneV1,
  type RoadmapV1,
  type TakeoverPacketV1,
} from "./roadmap-contracts.js";
import { readyMilestones, selectNextMilestone, validateRoadmapGraph } from "./roadmap-dag.js";
import {
  assessRunaway,
  evaluateVerification,
  ownerGateFor,
  requiredReviewLevel,
  resolveMilestoneAuthority,
  reviewSatisfied,
  type AttemptHistoryV1,
  type OwnerAuthorityRecordV1,
  type ReviewVerdictV1,
  type VerificationEvidenceV1,
} from "./roadmap-policy.js";
import type { RoadmapStoreV1 } from "./roadmap-store.js";

export interface DispatchAttemptV1 {
  readonly provider: ProviderIdV1 | null;
  readonly succeeded: boolean;
  readonly failureClass: string;
  readonly detail: string;
  readonly leaseId: string | null;
  /** True when the attempt may have produced an external effect that cannot be confirmed. */
  readonly ambiguousExternalEffect: boolean;
}

export interface OrchestratorDepsV1 {
  readonly store: RoadmapStoreV1;
  readonly authorities: readonly OwnerAuthorityRecordV1[];
  readonly now: () => string;
  readonly dispatch: (milestone: RoadmapMilestoneV1, packet: TakeoverPacketV1) => DispatchAttemptV1;
  readonly verify: (milestone: RoadmapMilestoneV1) => readonly VerificationEvidenceV1[];
  readonly review?: (milestone: RoadmapMilestoneV1, level: string) => ReviewVerdictV1 | null;
  readonly historyFor?: (milestone: RoadmapMilestoneV1) => AttemptHistoryV1;
  readonly baselineSha: string;
  readonly currentHead: string;
  readonly currentDirectiveId: string;
  readonly knownDefects?: readonly string[];
  readonly maxSteps?: number;
}

export type AdvanceStopReasonV1 =
  | "NO_ROADMAP"
  | "ROADMAP_NOT_ACTIVE"
  | "MALFORMED_GRAPH"
  | "NO_ELIGIBLE_WORK"
  | "STEP_LIMIT_REACHED";

export interface AdvanceResultV1 {
  readonly steps: number;
  readonly completed: readonly string[];
  readonly gated: readonly string[];
  readonly blocked: readonly string[];
  readonly failed: readonly string[];
  readonly stopReason: AdvanceStopReasonV1;
  readonly detail: string;
  /** Owner prompts this pass required. Always zero: gates are persisted, not asked interactively. */
  readonly ownerPrompts: number;
}

function record(
  deps: OrchestratorDepsV1,
  roadmapId: string,
  type: RoadmapEventTypeV1,
  milestoneId: string | null,
  detail: string,
): void {
  deps.store.appendEvent({ type, roadmapId, milestoneId, detail, at: deps.now() });
}

/**
 * Move a milestone to a new state, or refuse.
 *
 * An illegal transition is a programming error rather than a runtime condition, so it throws instead
 * of being logged and continued — a milestone that reaches an impossible state would make every
 * later readiness answer meaningless.
 */
function transition(
  deps: OrchestratorDepsV1,
  roadmapId: string,
  milestone: RoadmapMilestoneV1,
  to: MilestoneStateV1,
  patch: Partial<RoadmapMilestoneV1> = {},
): RoadmapMilestoneV1 {
  const permitted = legalMilestoneTransition(milestone.status, to);
  if (milestone.status !== to && !permitted) {
    throw new Error(`illegal milestone transition ${milestone.status} -> ${to} for ${milestone.milestoneId}`);
  }
  const next: RoadmapMilestoneV1 = { ...milestone, ...patch, status: to, updatedAt: deps.now() };
  deps.store.saveMilestone(next);
  void roadmapId;
  return next;
}

/**
 * Everything a fresh worker of any provider needs to continue this milestone.
 *
 * Written to disk before dispatch rather than after, because the case it exists for is the worker
 * dying mid-milestone. A packet produced only on success would be missing exactly when it is needed.
 */
export function buildTakeoverPacket(
  milestone: RoadmapMilestoneV1,
  roadmap: RoadmapV1,
  deps: OrchestratorDepsV1,
): TakeoverPacketV1 {
  return {
    schema: ROADMAP_PACKET_SCHEMA_V1,
    roadmapId: roadmap.roadmapId,
    roadmapVersion: roadmap.version,
    milestoneId: milestone.milestoneId,
    objective: milestone.objective,
    baselineSha: deps.baselineSha,
    currentHead: deps.currentHead,
    currentDirectiveId: deps.currentDirectiveId,
    ownerAuthorizationId: milestone.ownerAuthorizationId,
    dependenciesSatisfied: milestone.dependencies,
    allowedScope: milestone.requiredCapabilities,
    expectedArtifacts: milestone.expectedArtifacts,
    knownDefects: deps.knownDefects ?? [],
    verificationRequirements: milestone.verificationPlan.steps.filter((s) => s.required).map((s) => s.name),
    reviewRequirement: requiredReviewLevel(milestone),
    providerRestrictions: milestone.allowedProviders,
    sensitivityCeiling: milestone.sensitivityClass,
    nextExactAction: `Execute milestone ${milestone.milestoneId}: ${milestone.objective}`,
    createdAt: deps.now(),
  };
}

/** In-flight states that a restart must treat as unfinished. */
const IN_FLIGHT: readonly MilestoneStateV1[] = ["DISPATCHING", "RUNNING", "VALIDATING", "WAITING_REVIEW"];

/**
 * Reconcile durable state after a restart, before anything is dispatched.
 *
 * Completed milestones are left alone — that is the entire defence against duplicate execution.
 * In-flight milestones become `FAILED` (retryable) or `RECOVERY_REQUIRED` (not), depending on
 * whether an external effect might already have landed.
 */
export function recoverRoadmap(deps: OrchestratorDepsV1): readonly string[] {
  const roadmap = deps.store.loadRoadmap();
  if (roadmap === null) return [];
  const recovered: string[] = [];
  for (const milestone of deps.store.listMilestones()) {
    if (!IN_FLIGHT.includes(milestone.status)) continue;
    record(deps, roadmap.roadmapId, "RECOVERY_STARTED", milestone.milestoneId, `found in ${milestone.status} after restart`);
    const history = deps.historyFor?.(milestone);
    const ambiguous =
      history?.ambiguousExternalEffect === true ||
      milestone.externalEffectClass === "IRREVERSIBLE_EXTERNAL" ||
      milestone.externalEffectClass === "IDEMPOTENT_EXTERNAL";
    const to: MilestoneStateV1 = ambiguous ? "RECOVERY_REQUIRED" : "FAILED";
    transition(deps, roadmap.roadmapId, milestone, to, {
      blockedReason: ambiguous ? "external effect may have landed; a person must confirm" : "worker did not finish",
    });
    record(deps, roadmap.roadmapId, "RECOVERY_COMPLETED", milestone.milestoneId, `moved to ${to}`);
    recovered.push(milestone.milestoneId);
  }
  return recovered;
}

/**
 * Run the roadmap forward until nothing is eligible.
 *
 * Returns what happened rather than throwing on ordinary outcomes: a gate, a block and a failure are
 * all normal results of a healthy loop, and the caller needs to see which milestones landed where.
 */
export function advanceRoadmap(deps: OrchestratorDepsV1): AdvanceResultV1 {
  const completed: string[] = [];
  const gated: string[] = [];
  const blocked: string[] = [];
  const failed: string[] = [];
  const limit = deps.maxSteps ?? 25;
  let steps = 0;

  const roadmap = deps.store.loadRoadmap();
  if (roadmap === null) {
    return { steps, completed, gated, blocked, failed, stopReason: "NO_ROADMAP", detail: "no roadmap is stored", ownerPrompts: 0 };
  }
  // Reconcile before dispatching anything. A milestone left mid-flight by a dead worker must be
  // resolved to FAILED or RECOVERY_REQUIRED first, or the loop could select alongside a worker that
  // may still be alive.
  recoverRoadmap(deps);
  if (roadmap.state !== "ACTIVE") {
    return {
      steps, completed, gated, blocked, failed,
      stopReason: "ROADMAP_NOT_ACTIVE",
      detail: `roadmap is ${roadmap.state}`,
      ownerPrompts: 0,
    };
  }

  // Milestones skipped this pass: gated, blocked or exhausted. Tracked so the loop cannot spin on
  // the same unselectable milestone forever.
  const parked = new Set<string>();

  while (steps < limit) {
    const milestones = deps.store.listMilestones();
    const graph = validateRoadmapGraph(milestones);
    if (!graph.ok) {
      const detail = graph.problems.map((p) => `${p.kind}:${p.milestoneId}`).join("; ");
      record(deps, roadmap.roadmapId, "MILESTONE_BLOCKED", null, `roadmap graph is malformed: ${detail}`);
      return { steps, completed, gated, blocked, failed, stopReason: "MALFORMED_GRAPH", detail, ownerPrompts: 0 };
    }

    const openGates = new Set(deps.store.listGates().filter((g) => g.status === "OPEN").map((g) => g.milestoneId));
    const candidates = readyMilestones(milestones).filter(
      (m) => !parked.has(m.milestoneId) && !openGates.has(m.milestoneId),
    );
    const selected = selectNextMilestone(candidates, milestones);
    if (selected === null) {
      return {
        steps, completed, gated, blocked, failed,
        stopReason: "NO_ELIGIBLE_WORK",
        detail: "nothing is ready, authorised and unblocked",
        ownerPrompts: 0,
      };
    }

    steps += 1;
    let milestone = selected;

    const authority = resolveMilestoneAuthority(milestone, deps.authorities, deps.now());
    if (authority.outcome === "REQUIRE_FRESH_OWNER_APPROVAL") {
      const gate = ownerGateFor(milestone, authority, deps.currentDirectiveId, deps.now());
      deps.store.saveGate(gate);
      transition(deps, roadmap.roadmapId, milestone, "WAITING_OWNER_AUTHORIZATION", { blockedReason: authority.reason });
      record(deps, roadmap.roadmapId, "OWNER_GATE_REQUIRED", milestone.milestoneId, authority.reason);
      gated.push(milestone.milestoneId);
      parked.add(milestone.milestoneId);
      continue;
    }
    if (authority.outcome === "DENY") {
      transition(deps, roadmap.roadmapId, milestone, "BLOCKED", { blockedReason: authority.reason });
      record(deps, roadmap.roadmapId, "AUTHORITY_DENIED", milestone.milestoneId, authority.reason);
      blocked.push(milestone.milestoneId);
      parked.add(milestone.milestoneId);
      continue;
    }
    record(deps, roadmap.roadmapId, "AUTHORITY_ALLOWED", milestone.milestoneId, authority.reason);

    const history = deps.historyFor?.(milestone) ?? {
      attempts: milestone.attempts,
      failureSignatures: [],
      patchSignatures: [],
      providerTrail: [],
      progressSignatures: [],
      ambiguousExternalEffect: false,
    };
    const runaway = assessRunaway(milestone, history);
    if (runaway.stop && runaway.nextState !== null) {
      transition(deps, roadmap.roadmapId, milestone, runaway.nextState, { blockedReason: runaway.reason });
      record(deps, roadmap.roadmapId, "MILESTONE_BLOCKED", milestone.milestoneId, runaway.reason);
      blocked.push(milestone.milestoneId);
      parked.add(milestone.milestoneId);
      continue;
    }

    if (milestone.status !== "READY") {
      milestone = transition(deps, roadmap.roadmapId, milestone, "READY");
      record(deps, roadmap.roadmapId, "MILESTONE_READY", milestone.milestoneId, "dependencies satisfied");
    }

    milestone = transition(deps, roadmap.roadmapId, milestone, "DISPATCHING", { attempts: milestone.attempts + 1 });
    const packet = buildTakeoverPacket(milestone, roadmap, deps);
    deps.store.savePacket(packet);
    record(deps, roadmap.roadmapId, "DISPATCH_REQUESTED", milestone.milestoneId, milestone.objective);

    const attempt = deps.dispatch(milestone, packet);
    if (attempt.provider !== null) {
      record(deps, roadmap.roadmapId, "PROVIDER_SELECTED", milestone.milestoneId, attempt.provider);
    }
    if (!attempt.succeeded) {
      record(deps, roadmap.roadmapId, "PROVIDER_FAILED", milestone.milestoneId, `${attempt.failureClass}: ${attempt.detail}`);
      const next: MilestoneStateV1 = attempt.ambiguousExternalEffect ? "RECOVERY_REQUIRED" : "FAILED";
      transition(deps, roadmap.roadmapId, milestone, next, { blockedReason: attempt.detail });
      record(deps, roadmap.roadmapId, "MILESTONE_FAILED", milestone.milestoneId, attempt.detail);
      failed.push(milestone.milestoneId);
      parked.add(milestone.milestoneId);
      continue;
    }

    milestone = transition(deps, roadmap.roadmapId, milestone, "RUNNING");
    record(deps, roadmap.roadmapId, "WORKER_STARTED", milestone.milestoneId, attempt.provider ?? "unknown provider");

    milestone = transition(deps, roadmap.roadmapId, milestone, "VALIDATING");
    record(deps, roadmap.roadmapId, "VALIDATION_STARTED", milestone.milestoneId, "running the declared verification plan");
    const outcome = evaluateVerification(milestone.verificationPlan, deps.verify(milestone));
    if (!outcome.passed) {
      record(deps, roadmap.roadmapId, "VALIDATION_FAILED", milestone.milestoneId, outcome.reason);
      transition(deps, roadmap.roadmapId, milestone, "FAILED", { blockedReason: outcome.reason });
      record(deps, roadmap.roadmapId, "MILESTONE_FAILED", milestone.milestoneId, outcome.reason);
      failed.push(milestone.milestoneId);
      parked.add(milestone.milestoneId);
      continue;
    }
    record(deps, roadmap.roadmapId, "VALIDATION_PASSED", milestone.milestoneId, outcome.reason);

    const level = requiredReviewLevel(milestone);
    if (level !== "NONE") {
      milestone = transition(deps, roadmap.roadmapId, milestone, "WAITING_REVIEW");
      record(deps, roadmap.roadmapId, "REVIEW_REQUIRED", milestone.milestoneId, `review level ${level}`);
      const verdict = deps.review?.(milestone, level) ?? null;
      const judged = reviewSatisfied(level, verdict);
      if (!judged.satisfied) {
        record(deps, roadmap.roadmapId, "REVIEW_FAILED", milestone.milestoneId, judged.reason);
        transition(deps, roadmap.roadmapId, milestone, "BLOCKED", { blockedReason: judged.reason });
        blocked.push(milestone.milestoneId);
        parked.add(milestone.milestoneId);
        continue;
      }
      record(deps, roadmap.roadmapId, "REVIEW_PASSED", milestone.milestoneId, judged.reason);
    }

    milestone = transition(deps, roadmap.roadmapId, milestone, "COMPLETED", { blockedReason: null });
    record(deps, roadmap.roadmapId, "MILESTONE_COMPLETED", milestone.milestoneId, "completion criteria met");
    completed.push(milestone.milestoneId);

    // A completed milestone can unlock others; say so in the ledger so the chain is legible later.
    const after = deps.store.listMilestones();
    for (const candidate of readyMilestones(after)) {
      if (candidate.dependencies.includes(milestone.milestoneId)) {
        record(deps, roadmap.roadmapId, "DEPENDENCY_SATISFIED", candidate.milestoneId, `unlocked by ${milestone.milestoneId}`);
      }
    }
    deps.store.saveRoadmap({
      ...roadmap,
      version: roadmap.version + 1,
      currentMilestoneId: milestone.milestoneId,
      roadmapFingerprint: roadmapFingerprint(after),
      pendingOwnerGateIds: deps.store.listGates().filter((g) => g.status === "OPEN").map((g) => g.gateId),
      updatedAt: deps.now(),
    });
  }

  return {
    steps, completed, gated, blocked, failed,
    stopReason: "STEP_LIMIT_REACHED",
    detail: `stopped after ${limit} steps to avoid an unbounded loop`,
    ownerPrompts: 0,
  };
}

/**
 * Dispatch a milestone through MVA Real Dispatch, which routes it through Provider Bridge V1.
 *
 * This is the seam where the roadmap meets the existing execution stack. It deliberately builds a
 * `JobRequestV1` and hands off rather than choosing a provider itself — a second router is exactly
 * what this milestone was told not to build, and would be a second place for eligibility rules to
 * drift.
 */
export function createMvaDispatcher(
  input: { readonly repository: string; readonly worktree: string; readonly startingSha: string },
  dispatchDeps: MvaDispatchDepsV1 = {},
): (milestone: RoadmapMilestoneV1, packet: TakeoverPacketV1) => DispatchAttemptV1 {
  return (milestone, packet) => {
    const request: JobRequestV1 = {
      jobId: `roadmap-${milestone.milestoneId}`,
      /*
       * The milestone's own identity and authorization travel with the job.
       *
       * These were dropped here, and Campaign 01 measured the cost: every roadmap milestone dispatched
       * under one module-level authorization, so a milestone whose Owner record allowed nothing still
       * wrote, and one whose record allowed `docs` was refused a `docs` write. Read from the roadmap
       * milestone -- durable control-plane state -- not from anything a model or provider supplied.
       */
      originMilestoneId: milestone.milestoneId,
      ...(milestone.ownerAuthorizationId !== null ? { originOwnerAuthorizationId: milestone.ownerAuthorizationId } : {}),
      objective: milestone.objective,
      jobClass: "REPOSITORY_REVERSIBLE",
      repository: input.repository,
      worktree: input.worktree,
      allowedPaths: milestone.expectedArtifacts.length > 0 ? milestone.expectedArtifacts : ["."],
      expectedArtifact: packet.expectedArtifacts[0] ?? "artifact.txt",
      startingSha: input.startingSha,
      // The milestone's provider list is a requirement, not a preference: routing must start from a
      // provider the milestone can actually use, or failover burns attempts discovering that.
      preferredProvider: milestone.allowedProviders[0] ?? null,
      sensitiveDataClass: milestone.sensitivityClass,
      sensitiveDataAllowedProviders: milestone.allowedProviders,
      externalEffects: milestone.externalEffectClass === "NONE" ? [] : [milestone.externalEffectClass],
      maxProviderAttempts: milestone.retryPolicy.maxAttempts,
    };
    const outcome = submitJob(request, dispatchDeps);
    const succeeded = outcome.result.finalState === "SUCCEEDED";
    return {
      provider: outcome.result.selectedProvider,
      succeeded,
      failureClass: outcome.result.finalState,
      detail: outcome.result.failureReason ?? outcome.result.nextRecommendedAction,
      leaseId: outcome.record.leaseId,
      // The dispatch layer already distinguishes "did not happen" from "may have happened"; a
      // roadmap that collapsed the two would retry an effect that possibly already landed.
      ambiguousExternalEffect:
        outcome.result.externalEffectState === "UNCERTAIN" || outcome.result.finalState === "AMBIGUOUS_EFFECT_BLOCKED",
    };
  };
}
