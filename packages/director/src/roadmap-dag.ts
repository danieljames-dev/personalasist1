/**
 * The dependency graph, and the refusal to run anything it cannot prove is ready.
 *
 * A roadmap is only useful if "what may run now" is a computation rather than a judgement call. This
 * module answers that question and, more importantly, refuses to answer it at all when the graph is
 * malformed — a cycle, a dangling dependency id, a duplicate milestone, a milestone marked `READY`
 * whose dependency has not completed. Each of those makes every downstream readiness answer
 * meaningless, so they fail the whole graph closed rather than producing a plausible subset.
 *
 * ## One blocked gate must not stall the roadmap
 *
 * The failure mode this exists to prevent is an Owner gate on one branch of the graph freezing
 * unrelated safe work on another. Readiness is computed per milestone from its own dependency
 * closure, so a milestone waiting on an Owner decision holds up only its own descendants.
 *
 * ## Selection is deterministic
 *
 * Two workers reading the same roadmap must pick the same next milestone, or a restart becomes a
 * lottery and duplicate execution becomes possible. Ordering is total: priority, then how much the
 * milestone unblocks, then id.
 */

import {
  TERMINAL_MILESTONE_STATES_V1,
  type MilestoneStateV1,
  type RoadmapMilestoneV1,
} from "./roadmap-contracts.js";

export interface GraphProblemV1 {
  readonly kind:
    | "DUPLICATE_MILESTONE_ID"
    | "SELF_DEPENDENCY"
    | "MISSING_DEPENDENCY"
    | "DEPENDENCY_CYCLE"
    | "CONTRADICTORY_READINESS";
  readonly milestoneId: string;
  readonly detail: string;
}

export interface GraphValidationV1 {
  readonly ok: boolean;
  readonly problems: readonly GraphProblemV1[];
}

export interface DependencySatisfactionV1 {
  readonly satisfied: readonly string[];
  readonly unsatisfied: readonly string[];
  /** Dependencies that can never complete, so the dependant can never become ready. */
  readonly deadEnd: readonly string[];
}

/**
 * Whether a milestone's dependencies are met, and whether they ever can be.
 *
 * `deadEnd` is the distinction that matters: a dependency in `FAILED` might be retried, but one in
 * `CANCELLED` or `SUPERSEDED` never completes, so its dependant is blocked rather than waiting.
 */
export function dependencySatisfaction(
  milestone: RoadmapMilestoneV1,
  byId: ReadonlyMap<string, RoadmapMilestoneV1>,
): DependencySatisfactionV1 {
  const satisfied: string[] = [];
  const unsatisfied: string[] = [];
  const deadEnd: string[] = [];
  for (const id of milestone.dependencies) {
    const dependency = byId.get(id);
    if (dependency === undefined) {
      deadEnd.push(id);
      continue;
    }
    if (dependency.status === "COMPLETED") {
      satisfied.push(id);
      continue;
    }
    if (dependency.status === "CANCELLED" || dependency.status === "SUPERSEDED") {
      deadEnd.push(id);
      continue;
    }
    unsatisfied.push(id);
  }
  return { satisfied, unsatisfied, deadEnd };
}

/**
 * Validate the whole graph, or explain every way it is unusable.
 *
 * Returns all problems rather than the first, because a roadmap with three dangling ids should be
 * fixed once rather than three times.
 */
export function validateRoadmapGraph(milestones: readonly RoadmapMilestoneV1[]): GraphValidationV1 {
  const problems: GraphProblemV1[] = [];
  const byId = new Map<string, RoadmapMilestoneV1>();

  for (const milestone of milestones) {
    if (byId.has(milestone.milestoneId)) {
      problems.push({
        kind: "DUPLICATE_MILESTONE_ID",
        milestoneId: milestone.milestoneId,
        detail: "the same milestone id appears more than once",
      });
      continue;
    }
    byId.set(milestone.milestoneId, milestone);
  }

  for (const milestone of byId.values()) {
    for (const id of milestone.dependencies) {
      if (id === milestone.milestoneId) {
        problems.push({ kind: "SELF_DEPENDENCY", milestoneId: milestone.milestoneId, detail: "milestone depends on itself" });
        continue;
      }
      if (!byId.has(id)) {
        problems.push({
          kind: "MISSING_DEPENDENCY",
          milestoneId: milestone.milestoneId,
          detail: `dependency does not exist: ${id}`,
        });
      }
    }
  }

  // Iterative depth-first walk with an explicit stack: a recursive one blows up on a long chain, and
  // a long chain is exactly what a roadmap accumulates.
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const id of byId.keys()) colour.set(id, WHITE);

  for (const root of byId.keys()) {
    if (colour.get(root) !== WHITE) continue;
    const stack: { id: string; index: number }[] = [{ id: root, index: 0 }];
    colour.set(root, GREY);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const node = byId.get(frame.id);
      const dependencies = node?.dependencies ?? [];
      if (frame.index >= dependencies.length) {
        colour.set(frame.id, BLACK);
        stack.pop();
        continue;
      }
      const next = dependencies[frame.index] ?? "";
      frame.index += 1;
      if (!byId.has(next)) continue; // already reported as a missing dependency
      const state = colour.get(next);
      if (state === GREY) {
        problems.push({
          kind: "DEPENDENCY_CYCLE",
          milestoneId: frame.id,
          detail: `dependency cycle through ${next}`,
        });
        continue;
      }
      if (state === WHITE) {
        colour.set(next, GREY);
        stack.push({ id: next, index: 0 });
      }
    }
  }

  for (const milestone of byId.values()) {
    if (milestone.status !== "READY") continue;
    const satisfaction = dependencySatisfaction(milestone, byId);
    if (satisfaction.unsatisfied.length > 0 || satisfaction.deadEnd.length > 0) {
      problems.push({
        kind: "CONTRADICTORY_READINESS",
        milestoneId: milestone.milestoneId,
        detail: "marked READY while a dependency is unsatisfied",
      });
    }
  }

  return { ok: problems.length === 0, problems };
}

/** States from which a milestone can still be picked up and run. */
const RUNNABLE_FROM: readonly MilestoneStateV1[] = ["PLANNED", "READY", "WAITING_DEPENDENCY", "FAILED"];

/**
 * Every milestone whose dependencies are met and which is not terminal, blocked or already moving.
 *
 * `DISPATCHING`, `RUNNING`, `VALIDATING` and `WAITING_REVIEW` are excluded deliberately: a milestone
 * already in flight must not be selected a second time, which is the cheapest possible defence
 * against duplicate execution after a restart.
 */
export function readyMilestones(milestones: readonly RoadmapMilestoneV1[]): readonly RoadmapMilestoneV1[] {
  const byId = new Map(milestones.map((m) => [m.milestoneId, m]));
  return milestones.filter((milestone) => {
    if (TERMINAL_MILESTONE_STATES_V1.includes(milestone.status)) return false;
    if (!RUNNABLE_FROM.includes(milestone.status)) return false;
    const satisfaction = dependencySatisfaction(milestone, byId);
    return satisfaction.unsatisfied.length === 0 && satisfaction.deadEnd.length === 0;
  });
}

/** How many other milestones are waiting, directly or transitively, on this one. */
function unblockingWeight(milestone: RoadmapMilestoneV1, milestones: readonly RoadmapMilestoneV1[]): number {
  const dependants = new Map<string, string[]>();
  for (const candidate of milestones) {
    for (const dependency of candidate.dependencies) {
      const list = dependants.get(dependency);
      if (list === undefined) dependants.set(dependency, [candidate.milestoneId]);
      else list.push(candidate.milestoneId);
    }
  }
  const seen = new Set<string>();
  const stack = [...(dependants.get(milestone.milestoneId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    stack.push(...(dependants.get(id) ?? []));
  }
  return seen.size;
}

/**
 * Pick the next milestone to run, deterministically.
 *
 * Priority first because that is the Owner's ordering; then how much the milestone unblocks, so the
 * roadmap widens rather than deepens; then id, so two readers never disagree. Nothing here counts
 * completed milestones or optimises for activity — a scheduler that rewards throughput will find
 * cheap work to do forever.
 */
export function selectNextMilestone(
  candidates: readonly RoadmapMilestoneV1[],
  all: readonly RoadmapMilestoneV1[],
): RoadmapMilestoneV1 | null {
  if (candidates.length === 0) return null;
  const ordered = [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const weight = unblockingWeight(b, all) - unblockingWeight(a, all);
    if (weight !== 0) return weight;
    return a.milestoneId.localeCompare(b.milestoneId);
  });
  return ordered[0] ?? null;
}
