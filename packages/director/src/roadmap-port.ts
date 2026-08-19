/**
 * The stable surface the AION app talks to, so a UI never reaches into roadmap files directly.
 *
 * Everything here is a read except three verbs — continue, pause, resume — and even `continue` only
 * runs work the roadmap already considers ready and authorised. There is deliberately no
 * `approveGate`, no `forceComplete` and no `setAuthority`: a port that could satisfy its own Owner
 * gate would make every gate decorative, and the app is a viewer of authority rather than a source
 * of it.
 *
 * `pause` exists because the honest way to stop an autonomous system is a durable flag it checks,
 * not a person closing a terminal.
 */

import {
  ROADMAP_SCHEMA_V1,
  ROADMAP_MILESTONE_SCHEMA_V1,
  roadmapFingerprint,
  type MilestoneStateV1,
  type RoadmapOwnerGateV1,
  type RoadmapMilestoneV1,
  type RoadmapV1,
  type TakeoverPacketV1,
} from "./roadmap-contracts.js";
import { readyMilestones } from "./roadmap-dag.js";
import {
  advanceRoadmap,
  createMvaDispatcher,
  type AdvanceResultV1,
  type DispatchAttemptV1,
  type OrchestratorDepsV1,
} from "./roadmap-orchestrator.js";
import { createFileRoadmapStore, type RoadmapStoreV1 } from "./roadmap-store.js";

export interface RoadmapStatusV1 {
  readonly exists: boolean;
  readonly state: string;
  readonly version: number;
  readonly fingerprint: string;
  readonly total: number;
  readonly byStatus: Readonly<Record<string, number>>;
  readonly openGates: number;
  readonly readyCount: number;
}

export interface ActiveWorkerV1 {
  readonly milestoneId: string;
  readonly status: MilestoneStateV1;
  readonly packet: TakeoverPacketV1 | null;
}

export interface RoadmapPortV1 {
  getRoadmap(): RoadmapV1 | null;
  getRoadmapStatus(): RoadmapStatusV1;
  getCurrentMilestone(): RoadmapMilestoneV1 | null;
  getReadyMilestones(): readonly RoadmapMilestoneV1[];
  /** Every milestone, for a caller that needs to show blocked, failed or finished work. */
  getMilestones(): readonly RoadmapMilestoneV1[];
  getPendingOwnerGates(): readonly RoadmapOwnerGateV1[];
  getActiveWorkers(): readonly ActiveWorkerV1[];
  continueRoadmap(): AdvanceResultV1;
  pauseRoadmap(): RoadmapV1 | null;
  resumeRoadmap(): RoadmapV1 | null;
  ensureRoadmap(input: SeedInputV1): RoadmapV1;
}

export interface SeedMilestoneInputV1 {
  readonly milestoneId: string;
  readonly title: string;
  readonly objective: string;
  readonly priority: number;
  readonly dependencies: readonly string[];
  readonly ownerAuthorizationId: string | null;
  readonly authorityClass: RoadmapMilestoneV1["authorityClass"];
  readonly externalEffectClass: RoadmapMilestoneV1["externalEffectClass"];
  readonly riskClasses: RoadmapMilestoneV1["riskClasses"];
  /** Narrow this when the work genuinely needs a capability only some providers have. */
  readonly allowedProviders?: RoadmapMilestoneV1["allowedProviders"];
  readonly reviewPolicy: RoadmapMilestoneV1["independentReviewPolicy"];
  readonly provenance: string;
}

export interface SeedInputV1 {
  readonly roadmapId: string;
  readonly ownerGoalSet: readonly string[];
  readonly provenance: string;
  readonly milestones: readonly SeedMilestoneInputV1[];
}

/**
 * Create the roadmap from durable state, once.
 *
 * Idempotent by construction: an existing roadmap is returned unchanged rather than rebuilt, because
 * re-seeding would reset milestone statuses and re-run completed work. The defaults here are
 * conservative — every seeded milestone declares a real verification plan and a bounded retry
 * policy, so nothing enters the graph without acceptance criteria.
 */
function seedRoadmap(store: RoadmapStoreV1, input: SeedInputV1, now: string): RoadmapV1 {
  const existing = store.loadRoadmap();
  if (existing !== null) return existing;

  const milestones: RoadmapMilestoneV1[] = input.milestones.map((seed) => ({
    schema: ROADMAP_MILESTONE_SCHEMA_V1,
    milestoneId: seed.milestoneId,
    title: seed.title,
    objective: seed.objective,
    status: "PLANNED" as MilestoneStateV1,
    priority: seed.priority,
    dependencies: [...seed.dependencies],
    requiredCapabilities: ["CODING"],
    requiredContextCategories: [],
    authorityClass: seed.authorityClass,
    ownerAuthorizationId: seed.ownerAuthorizationId,
    sensitivityClass: "INTERNAL",
    allowedProviders: [...(seed.allowedProviders ?? ["codex", "grok", "claude", "local"])],
    spendCapUsd: 0,
    externalEffectClass: seed.externalEffectClass,
    reversibilityClass: seed.externalEffectClass === "IRREVERSIBLE_EXTERNAL" ? "IRREVERSIBLE" : "REVERSIBLE",
    riskClasses: [...seed.riskClasses],
    verificationPlan: {
      steps: [
        { kind: "DETERMINISTIC_CHECK", name: "durable state reconciled", required: true },
        { kind: "FOCUSED_TESTS", name: "focused tests", required: true },
      ],
      declaredAt: now,
    },
    independentReviewPolicy: seed.reviewPolicy,
    retryPolicy: { maxAttempts: 3, maxIdenticalFailures: 2, maxIdenticalPatches: 2, maxProviderSwitches: 4 },
    leaseTtlMs: 30 * 60 * 1000,
    expectedArtifacts: [],
    completionCriteria: [`${seed.title} is durably complete and verified`],
    attempts: 0,
    blockedReason: null,
    provenance: seed.provenance,
    createdAt: now,
    updatedAt: now,
  }));

  for (const milestone of milestones) store.saveMilestone(milestone);

  const roadmap: RoadmapV1 = {
    schema: ROADMAP_SCHEMA_V1,
    roadmapId: input.roadmapId,
    ownerGoalSet: [...input.ownerGoalSet],
    version: 1,
    state: "ACTIVE",
    currentMilestoneId: null,
    milestoneIds: milestones.map((m) => m.milestoneId),
    pendingOwnerGateIds: [],
    roadmapFingerprint: roadmapFingerprint(milestones),
    provenance: input.provenance,
    createdAt: now,
    updatedAt: now,
  };
  store.saveRoadmap(roadmap);
  store.appendEvent({ type: "ROADMAP_CREATED", roadmapId: roadmap.roadmapId, milestoneId: null, detail: input.provenance, at: now });
  for (const milestone of milestones) {
    store.appendEvent({
      type: "MILESTONE_CREATED",
      roadmapId: roadmap.roadmapId,
      milestoneId: milestone.milestoneId,
      detail: milestone.title,
      at: now,
    });
  }
  return roadmap;
}

export interface RoadmapPortDepsV1 extends Omit<OrchestratorDepsV1, "dispatch" | "store"> {
  /** An already-built store, or `storeRoot` to have the port open the durable one. */
  readonly store?: RoadmapStoreV1;
  readonly storeRoot?: string;
  readonly dispatch?: (milestone: RoadmapMilestoneV1, packet: TakeoverPacketV1) => DispatchAttemptV1;
  /** Supplied when the port should build the real MVA dispatcher rather than receive one. */
  readonly dispatchTarget?: { readonly repository: string; readonly worktree: string; readonly startingSha: string };
}

/** The Director-facing port. Reads are free; the three verbs are the only state changes. */
export function createRoadmapPort(deps: RoadmapPortDepsV1): RoadmapPortV1 {
  const dispatch =
    deps.dispatch ??
    (deps.dispatchTarget !== undefined
      ? createMvaDispatcher(deps.dispatchTarget)
      : () => ({
          provider: null,
          succeeded: false,
          failureClass: "NO_DISPATCHER",
          detail: "no dispatcher was configured for this port",
          leaseId: null,
          ambiguousExternalEffect: false,
        }));
  // An app hands the port a directory, not a store object; tests hand it a store. Refusing when
  // neither is present is better than defaulting to a path nobody chose.
  if (deps.store === undefined && deps.storeRoot === undefined) {
    throw new Error("roadmap port needs either a store or a storeRoot");
  }
  const store = deps.store ?? createFileRoadmapStore(deps.storeRoot ?? "");
  const orchestrator: OrchestratorDepsV1 = { ...deps, store, dispatch };

  return {
    getRoadmap() {
      return store.loadRoadmap();
    },
    getRoadmapStatus() {
      const roadmap = store.loadRoadmap();
      const milestones = store.listMilestones();
      const byStatus: Record<string, number> = {};
      for (const milestone of milestones) byStatus[milestone.status] = (byStatus[milestone.status] ?? 0) + 1;
      return {
        exists: roadmap !== null,
        state: roadmap?.state ?? "NONE",
        version: roadmap?.version ?? 0,
        fingerprint: roadmap?.roadmapFingerprint ?? "",
        total: milestones.length,
        byStatus,
        openGates: store.listGates().filter((gate) => gate.status === "OPEN").length,
        readyCount: readyMilestones(milestones).length,
      };
    },
    getCurrentMilestone() {
      const roadmap = store.loadRoadmap();
      if (roadmap === null || roadmap.currentMilestoneId === null) return null;
      return store.loadMilestone(roadmap.currentMilestoneId);
    },
    getReadyMilestones() {
      return readyMilestones(store.listMilestones());
    },
    getMilestones() {
      return store.listMilestones();
    },
    getPendingOwnerGates() {
      return store.listGates().filter((gate) => gate.status === "OPEN");
    },
    getActiveWorkers() {
      return store
        .listMilestones()
        .filter((m) => m.status === "DISPATCHING" || m.status === "RUNNING" || m.status === "VALIDATING")
        .map((m) => ({ milestoneId: m.milestoneId, status: m.status, packet: store.loadPacket(m.milestoneId) }));
    },
    continueRoadmap() {
      return advanceRoadmap(orchestrator);
    },
    pauseRoadmap() {
      const roadmap = store.loadRoadmap();
      if (roadmap === null) return null;
      const next: RoadmapV1 = { ...roadmap, state: "PAUSED", updatedAt: deps.now() };
      store.saveRoadmap(next);
      return next;
    },
    resumeRoadmap() {
      const roadmap = store.loadRoadmap();
      if (roadmap === null) return null;
      const next: RoadmapV1 = { ...roadmap, state: "ACTIVE", updatedAt: deps.now() };
      store.saveRoadmap(next);
      return next;
    },
    ensureRoadmap(input) {
      return seedRoadmap(store, input, deps.now());
    },
  };
}
