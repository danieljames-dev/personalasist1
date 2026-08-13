/**
 * Deciding what can be worked on now.
 *
 * The correction this exists for: a mission waiting on the Owner is not a mission that has stopped.
 * A pending phone test blocks *deployment*; it does not block preparing the deployment, rehearsing
 * the rollback, or the entire separate stream of Director work. Treating one open gate as a global
 * freeze means the Owner going to sleep costs a night of progress, which is precisely the failure
 * the Director was built to remove.
 *
 * So a gate names what it blocks, and readiness is computed per item. `WAITING_FOR_OWNER` becomes a
 * statement about the *whole board* — there is an unresolved gate and nothing else left to do —
 * rather than a description of any single item.
 *
 * ## Why this is not a workflow engine
 *
 * Dependencies here are a list of ids and a set of gate ids. There is no expression language, no
 * dynamic graph rewriting, no scheduler plugin. Everything is a pure function over the current board
 * so that "why is this blocked?" has an answer a person can read, and so that no part of the
 * decision can be delegated to a model. A dependency being satisfied is a fact, not a judgement.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { OwnerGateV1 } from "./gates.js";
import type { ExecutorRoleV1 } from "./executors.js";

export const WORK_ITEM_SCHEMA_V1 = "aion.director.work-item.v1" as const;

export type WorkItemStatusV1 =
  | "PENDING"
  | "READY"
  | "RUNNING"
  | "VERIFYING"
  | "PASSED"
  | "FAILED"
  | "BLOCKED"
  | "WAITING_FOR_OWNER"
  | "CANCELLED";

/** Statuses that satisfy a dependency. Only a genuinely finished item unblocks another. */
const SATISFYING: readonly WorkItemStatusV1[] = ["PASSED"];

export interface WorkItemV1 {
  schema: typeof WORK_ITEM_SCHEMA_V1;
  workItemId: OpaqueId;
  missionId: OpaqueId;
  kind: string;
  status: WorkItemStatusV1;
  dependsOn: string[];
  /** Gates that must be resolved before this may run. Empty for most work. */
  blockedByGateIds: string[];
  executorRole: ExecutorRoleV1;
  /** The authority class this work needs, checked before it is ever scheduled. */
  authorityClass: string;
  /** Resource this item must hold exclusively, when it needs one. */
  requiresLease: { kind: string; resource: string } | null;
  attemptCount: number;
  currentRunId: OpaqueId | null;
  resultRef: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface BoardV1 {
  items: readonly WorkItemV1[];
  gates: readonly OwnerGateV1[];
  /** Resources currently held, so two items never take the same one. */
  heldResources: readonly string[];
  /** Executors with capacity right now. */
  availableExecutors: readonly string[];
  /** Set when the whole mission is stopped, which overrides every per-item decision. */
  missionHalted: boolean;
}

export type BlockReasonV1 =
  | "DEPENDENCY_NOT_SATISFIED"
  | "OWNER_GATE_UNRESOLVED"
  | "RESOURCE_HELD"
  | "EXECUTOR_UNAVAILABLE"
  | "MISSION_HALTED"
  | "ALREADY_SETTLED";

export interface ReadinessV1 {
  workItemId: OpaqueId;
  ready: boolean;
  reason: BlockReasonV1 | null;
  /** In the Owner's words, for the dashboard. Never an enum. */
  detail: string;
}

function resourceKey(lease: { kind: string; resource: string }): string {
  return `${lease.kind}:${lease.resource}`.toLowerCase();
}

/**
 * Whether one item can start right now.
 *
 * Order matters only for the quality of the explanation: the mission being halted is a better
 * answer than a missing dependency, and an unresolved gate is a better answer than a held resource,
 * because it is the one the Owner can do something about.
 */
export function assessReadiness(item: WorkItemV1, board: BoardV1): ReadinessV1 {
  const settled: WorkItemStatusV1[] = ["PASSED", "FAILED", "CANCELLED", "RUNNING", "VERIFYING"];
  if (settled.includes(item.status)) {
    return {
      workItemId: item.workItemId, ready: false, reason: "ALREADY_SETTLED",
      detail: `already ${item.status.toLowerCase().replace(/_/g, " ")}`,
    };
  }

  if (board.missionHalted) {
    return {
      workItemId: item.workItemId, ready: false, reason: "MISSION_HALTED",
      detail: "the mission itself is paused or blocked, so nothing runs",
    };
  }

  const unresolvedGates = item.blockedByGateIds.filter((gateId) => {
    const gate = board.gates.find((g) => g.gateId === gateId);
    return gate ? gate.status === "OPEN" : false;
  });
  if (unresolvedGates.length > 0) {
    const gate = board.gates.find((g) => g.gateId === unresolvedGates[0]);
    return {
      workItemId: item.workItemId, ready: false, reason: "OWNER_GATE_UNRESOLVED",
      detail: gate ? `waiting on you: ${gate.requiredInput}` : "waiting on an answer from you",
    };
  }

  const unmet = item.dependsOn.filter((id) => {
    const dependency = board.items.find((candidate) => candidate.workItemId === id);
    return !dependency || !SATISFYING.includes(dependency.status);
  });
  if (unmet.length > 0) {
    const first = board.items.find((candidate) => candidate.workItemId === unmet[0]);
    return {
      workItemId: item.workItemId, ready: false, reason: "DEPENDENCY_NOT_SATISFIED",
      detail: first ? `needs "${first.kind}" to finish first` : "needs earlier work to finish first",
    };
  }

  if (item.requiresLease && board.heldResources.map((r) => r.toLowerCase()).includes(resourceKey(item.requiresLease))) {
    return {
      workItemId: item.workItemId, ready: false, reason: "RESOURCE_HELD",
      detail: "something else is using the same working copy",
    };
  }

  // Local work needs no external executor, so its availability is never a reason to wait.
  const needsExternal = item.executorRole !== "GIT_VERIFY"
    && item.executorRole !== "BUILD"
    && item.executorRole !== "TEST"
    && item.executorRole !== "HEALTH"
    && item.executorRole !== "SAFE_PROJECT_SCRIPT";
  if (needsExternal && board.availableExecutors.length === 0) {
    return {
      workItemId: item.workItemId, ready: false, reason: "EXECUTOR_UNAVAILABLE",
      detail: "no executor has capacity right now",
    };
  }

  return { workItemId: item.workItemId, ready: true, reason: null, detail: "ready" };
}

export interface SchedulingV1 {
  ready: WorkItemV1[];
  blocked: ReadinessV1[];
  /** True when an unresolved gate is the only thing left standing between here and progress. */
  waitingOnOwnerOnly: boolean;
  /** True when there is genuinely nothing to do, gate or no gate. */
  idle: boolean;
  /** For the dashboard: what continues while the Owner is away. */
  continuingWithoutOwner: string[];
  /** For the dashboard: what his answer would unlock. */
  blockedOnOwner: string[];
}

/**
 * Look at the whole board and decide what happens next.
 *
 * The distinction the Owner asked for lives in `waitingOnOwnerOnly`. A mission can hold an open gate
 * and still be busy; only when nothing else is runnable does the mission itself become a thing that
 * is waiting for a person.
 */
export function schedule(board: BoardV1): SchedulingV1 {
  const assessments = board.items.map((item) => ({ item, readiness: assessReadiness(item, board) }));

  const ready = assessments.filter((a) => a.readiness.ready).map((a) => a.item);
  const blocked = assessments
    .filter((a) => !a.readiness.ready && a.readiness.reason !== "ALREADY_SETTLED")
    .map((a) => a.readiness);

  const blockedOnOwner = assessments
    .filter((a) => a.readiness.reason === "OWNER_GATE_UNRESOLVED")
    .map((a) => a.item.kind);

  const outstanding = board.items.filter(
    (item) => !["PASSED", "FAILED", "CANCELLED"].includes(item.status),
  );

  return {
    ready,
    blocked,
    // An open gate matters to the mission only when it is the last thing in the way.
    waitingOnOwnerOnly: ready.length === 0 && blockedOnOwner.length > 0,
    idle: ready.length === 0 && outstanding.length === 0,
    continuingWithoutOwner: ready.map((item) => item.kind),
    blockedOnOwner,
  };
}

/**
 * Pick what to start, respecting the concurrency limits that exist for safety.
 *
 * One writer per executor and one holder per resource. These are not throughput tuning: two writers
 * in one worktree produce a tree neither of them built, and two integrators race over the same
 * branch. Local verification is unbounded because it only reads.
 */
export function selectRunnable(input: {
  scheduling: SchedulingV1;
  runningByExecutor: Readonly<Record<string, number>>;
  heldResources: readonly string[];
  routeOf: (role: ExecutorRoleV1) => string;
  maxWritersPerExecutor?: number;
}): WorkItemV1[] {
  const maxWriters = input.maxWritersPerExecutor ?? 1;
  const running: Record<string, number> = { ...input.runningByExecutor };
  const taken = new Set(input.heldResources.map((r) => r.toLowerCase()));
  const chosen: WorkItemV1[] = [];

  for (const item of input.scheduling.ready) {
    const executor = input.routeOf(item.executorRole);
    const isLocal = executor === "local";

    if (!isLocal && (running[executor] ?? 0) >= maxWriters) continue;
    if (item.requiresLease) {
      const key = resourceKey(item.requiresLease);
      if (taken.has(key)) continue;
      taken.add(key);
    }
    if (!isLocal) running[executor] = (running[executor] ?? 0) + 1;
    chosen.push(item);
  }
  return chosen;
}

/**
 * The sentence a person should read on the dashboard.
 *
 * Written so that an open gate never makes a busy system look stopped — that impression is what
 * would make the Owner think he is the bottleneck when he is not.
 */
export function describeBoard(scheduling: SchedulingV1): string {
  if (scheduling.idle) return "Everything I can do is done.";

  const lines: string[] = [];
  if (scheduling.ready.length > 0) lines.push("AION is still working.");
  if (scheduling.blockedOnOwner.length > 0) {
    lines.push(scheduling.ready.length > 0 ? "Waiting on you as well:" : "Waiting on you:");
    for (const kind of scheduling.blockedOnOwner) lines.push(`· ${kind}`);
  }
  if (scheduling.continuingWithoutOwner.length > 0) {
    lines.push("Continuing meanwhile:");
    for (const kind of scheduling.continuingWithoutOwner) lines.push(`· ${kind}`);
  }
  return lines.join("\n");
}

/** Items that become runnable once a gate is answered, for the resolution path to re-evaluate. */
export function unblockedByGate(items: readonly WorkItemV1[], gateId: string): WorkItemV1[] {
  return items.filter((item) => item.blockedByGateIds.includes(gateId));
}
