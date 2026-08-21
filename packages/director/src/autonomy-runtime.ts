/**
 * The thing that actually starts AION.
 *
 * Autonomy Kernel V3 could choose, dispatch, verify, record and continue — and nothing called it.
 * This is the entry point: it registers the Owner's portfolio, gives each business a discovery
 * objective, and runs bounded passes of the kernel that already exists. It is composition, not a
 * second framework; every decision still belongs to `scheduleNext` and `runAutonomyKernel`.
 *
 * Three properties shape it.
 *
 * **Idempotent by construction.** Ids derive from the Owner's own names, and registration reads
 * before it writes. Starting twice produces one portfolio, not two — which matters because "start
 * it again" is the first thing anyone does after a crash.
 *
 * **Pausable.** The pause flag is on disk, checked before each pass, so a pause survives the process
 * that set it. An autonomous system that can only be stopped by killing it is not stoppable, it is
 * abandonable.
 *
 * **Local by construction.** The dispatcher reads durable state and writes a file. It has no
 * transport, no provider, and no way to acquire one: outward steps are refused by the scheduler
 * before they are ever selected, and this runtime never sets `outwardAuthorized`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "./atomic-write.js";
import {
  buildStandingObjective,
  type AutonomyStepV1,
  type StandingObjectiveV1,
} from "./autonomy-contracts.js";
import {
  autonomyStatus,
  runAutonomyKernel,
  type AutonomyStatusV1,
  type KernelRunV1,
  type StepAttemptV1,
  type StepEvidenceV1,
} from "./autonomy-kernel.js";
import { createFileAutonomyStore, type AutonomyStoreV1 } from "./autonomy-store.js";
import {
  buildDiscoveryArtifact,
  understandsBusiness,
  type BusinessDiscoveryArtifactV1,
} from "./business-discovery.js";
import {
  assessBusinessKnowledge,
  buildBusinessWorkspace,
  businessIdFor,
  type BusinessWorkspaceV1,
} from "./business-workspace.js";
import { createDurableExperienceLedger, type DurableExperienceLedgerV1 } from "./experience-ledger.js";
import { buildOwnerGoalIntent } from "./owner-goal-intake.js";

export const AUTONOMY_RUNTIME_STATE_SCHEMA_V1 = "aion.director.autonomyRuntimeState.v1" as const;

/**
 * The Owner's active portfolio, exactly as he named it.
 *
 * Names and nothing else. There is no `description` field here because the Owner has not described
 * them, and a constant is the easiest place in a codebase for an invented fact to acquire the
 * appearance of authority.
 */
export const OWNER_PORTFOLIO_V1: readonly string[] = Object.freeze([
  "Compassionate Choice",
  "LocalFinds",
  "Talk to Caleb",
  "AIService Co",
]);

/**
 * Portfolio directions, which are not businesses.
 *
 * Product development, resale and income discovery are things the Owner wants pursued; they have no
 * canonical name, no identity and no owner-controlled status of their own. Forcing them into
 * `BusinessWorkspaceV1` would make the registry tidy and the data false, so they are objectives on
 * AION's own workspace instead — which is what they actually are: work AION does across the
 * portfolio rather than work belonging to one business.
 */
export const AION_WORKSPACE_NAME_V1 = "AION";

export const PORTFOLIO_DIRECTIONS_V1: readonly { key: string; objective: string }[] = Object.freeze([
  {
    key: "product-development",
    objective: "Identify and evaluate product or service opportunities worth testing, without assuming a product type.",
  },
  {
    key: "resale-opportunity",
    objective: "Find and evaluate resale opportunities end to end, from prerequisites through economics to a BUY, MAYBE or PASS, without purchasing anything.",
  },
  {
    key: "income-discovery",
    objective: "Compare potential income streams on evidence rather than on estimates alone.",
  },
  {
    key: "self-improvement",
    objective: "Improve AION itself only when a demonstrated defect or a real capability blocker exists.",
  },
]);

/** Discovery wording, from the Owner's framing, with the constraint kept in the objective itself. */
function discoveryObjectiveText(name: string): string {
  return `Understand ${name} from authoritative Owner-provided or verified sources and identify the`
    + ` highest-value safe next actions without inventing unknown business facts.`;
}

export interface AutonomyRuntimeStateV1 {
  readonly schema: typeof AUTONOMY_RUNTIME_STATE_SCHEMA_V1;
  readonly paused: boolean;
  readonly pausedReason: string;
  readonly registeredAtUtc: string;
  readonly lastRunAtUtc: string;
  readonly runs: number;
}

export interface RuntimeDepsV1 {
  readonly storeRoot: string;
  readonly now: () => string;
  readonly currentSha: string;
  readonly provenance: string;
  /** Where discovery artifacts are written. Read back by verification, never trusted from a claim. */
  readonly artifactRoot: string;
  readonly maxSteps?: number;
}

export interface RegistrationV1 {
  readonly businesses: readonly BusinessWorkspaceV1[];
  readonly objectives: readonly StandingObjectiveV1[];
  readonly created: readonly string[];
  readonly recovered: readonly string[];
  /** Why each business does or does not need discovery, in words a person can read back. */
  readonly discoveryReasons: readonly { businessId: string; reason: string }[];
}

function statePath(root: string): string {
  return join(root, "runtime-state.json");
}

export function readRuntimeState(storeRoot: string): AutonomyRuntimeStateV1 {
  try {
    const parsed = JSON.parse(readFileSync(statePath(storeRoot), "utf8")) as AutonomyRuntimeStateV1;
    if (parsed.schema === AUTONOMY_RUNTIME_STATE_SCHEMA_V1) return parsed;
  } catch {
    /* first run */
  }
  return {
    schema: AUTONOMY_RUNTIME_STATE_SCHEMA_V1,
    paused: false,
    pausedReason: "",
    registeredAtUtc: "",
    lastRunAtUtc: "",
    runs: 0,
  };
}

function writeRuntimeState(storeRoot: string, state: AutonomyRuntimeStateV1): void {
  writeAtomic(statePath(storeRoot), `${JSON.stringify(state, null, 2)}\n`);
}

/** The step every discovery objective starts with. Its fingerprint is the business, so it happens once. */
function discoveryStep(objective: StandingObjectiveV1, now: string): AutonomyStepV1 {
  return {
    schema: "aion.director.autonomyStep.v1",
    stepId: `discover-${objective.businessId}`,
    objectiveId: objective.objectiveId,
    businessId: objective.businessId,
    title: `Discover what ${objective.businessId} is, from recorded facts only`,
    valueClass: "REAL_USER_OR_BUSINESS_VALUE",
    evidenceRefs: [],
    effectScope: "LOCAL_SHADOW",
    status: "READY",
    dependsOn: [],
    // Deliberately equal across businesses: AION has no basis for ranking one unknown business above
    // another, and a number invented to break the tie would be an invented business fact.
    expectedValue: 100,
    confidence: 0.6,
    ownerTimeMinutes: 0,
    requiredCapabilities: [],
    attempts: 0,
    maxAttempts: 2,
    blockedReason: null,
    effectFingerprint: `discovery:${objective.businessId}`,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Register the portfolio and its objectives, or recover what is already there.
 *
 * Reads before it writes, throughout. Ids come from `businessIdFor`, which is a pure function of the
 * Owner's own name, so a second call finds the first call's records rather than making new ones.
 */
export function registerPortfolio(deps: RuntimeDepsV1): RegistrationV1 {
  const store = createFileAutonomyStore(deps.storeRoot);
  const now = deps.now();
  const created: string[] = [];
  const recovered: string[] = [];
  const discoveryReasons: { businessId: string; reason: string }[] = [];

  const existingBusinesses = new Map(store.businesses().map((b) => [b.businessId, b]));
  const existingObjectives = new Map(store.objectives().map((o) => [o.objectiveId, o]));
  const existingSteps = new Map(store.steps().map((s) => [s.stepId, s]));

  const businesses: BusinessWorkspaceV1[] = [];
  const objectives: StandingObjectiveV1[] = [];

  const ensureBusiness = (name: string): BusinessWorkspaceV1 => {
    const id = businessIdFor(name);
    const existing = existingBusinesses.get(id);
    if (existing !== undefined) {
      recovered.push(`business:${id}`);
      return existing;
    }
    // No category argument: the Owner has not said what any of these are, and the registry has
    // nowhere to put a guess.
    const workspace = buildBusinessWorkspace({ canonicalName: name, provenance: deps.provenance, now });
    store.saveBusiness(workspace);
    created.push(`business:${id}`);
    return workspace;
  };

  const ensureObjective = (business: BusinessWorkspaceV1, text: string): StandingObjectiveV1 => {
    const intent = buildOwnerGoalIntent({ text, provenance: deps.provenance, now, milestones: [] });
    const candidate = buildStandingObjective({ intent, businessId: business.businessId, now });
    const existing = existingObjectives.get(candidate.objectiveId);
    if (existing !== undefined) {
      recovered.push(`objective:${existing.objectiveId}`);
      return existing;
    }
    store.saveObjective(candidate);
    created.push(`objective:${candidate.objectiveId}`);
    return candidate;
  };

  for (const name of OWNER_PORTFOLIO_V1) {
    const business = ensureBusiness(name);
    businesses.push(business);
    // Only businesses AION cannot describe get a discovery objective. Once the Owner has answered,
    // re-registering must not manufacture a fresh round of the same questions.
    //
    // The assessment's reason is kept rather than discarded: it is the sentence that explains why
    // this business has a discovery objective at all, and it belongs in the record beside it.
    const knowledge = assessBusinessKnowledge(business);
    discoveryReasons.push({ businessId: business.businessId, reason: knowledge.reason });
    if (!knowledge.knowsWhatItDoes) {
      const objective = ensureObjective(business, discoveryObjectiveText(business.canonicalName));
      objectives.push(objective);
      const step = discoveryStep(objective, now);
      if (existingSteps.has(step.stepId)) recovered.push(`step:${step.stepId}`);
      else {
        store.saveStep(step);
        created.push(`step:${step.stepId}`);
      }
    }
  }

  const aion = ensureBusiness(AION_WORKSPACE_NAME_V1);
  businesses.push(aion);
  for (const direction of PORTFOLIO_DIRECTIONS_V1) {
    const objective = ensureObjective(aion, direction.objective);
    objectives.push(objective);

    /*
     * One step for AION's own self-improvement, and it is honest about what it is.
     *
     * No measured defect exists right now — the harness is green and the findings are closed — so
     * the step claims `SPECULATIVE_INFRASTRUCTURE` rather than dressing itself up as a proven
     * blocker. That is what puts it last behind every business step, which is the Owner's rule
     * working on AION itself rather than only on things AION was asked to do.
     *
     * It is created rather than omitted because a scheduler with nothing to rank proves nothing.
     * When it is finally selected, the dispatcher says there is no step model for it, and the
     * branch blocks — which is the truthful answer, and better than inventing an activity so the
     * loop looks busy.
     */
    if (direction.key === "self-improvement") {
      const stepId = `self-improve-${direction.key}`;
      if (existingSteps.has(stepId)) recovered.push(`step:${stepId}`);
      else {
        store.saveStep({
          schema: "aion.director.autonomyStep.v1",
          stepId,
          objectiveId: objective.objectiveId,
          businessId: aion.businessId,
          title: "Improve AION itself — only if a demonstrated defect or real blocker exists",
          valueClass: "SPECULATIVE_INFRASTRUCTURE",
          evidenceRefs: [],
          effectScope: "LOCAL_SHADOW",
          status: "READY",
          dependsOn: [],
          expectedValue: 5_000,
          confidence: 1,
          ownerTimeMinutes: 0,
          requiredCapabilities: [],
          attempts: 0,
          maxAttempts: 1,
          blockedReason: null,
          effectFingerprint: `self-improve:${direction.key}`,
          createdAt: now,
          updatedAt: now,
        });
        created.push(`step:${stepId}`);
      }
    }
  }

  const state = readRuntimeState(deps.storeRoot);
  writeRuntimeState(deps.storeRoot, {
    ...state,
    registeredAtUtc: state.registeredAtUtc === "" ? now : state.registeredAtUtc,
  });

  return { businesses, objectives, created, recovered, discoveryReasons };
}

/* -------------------------------------------------------------------------- */
/* The discovery dispatcher and its verifier                                   */
/* -------------------------------------------------------------------------- */

function artifactPath(root: string, businessId: string): string {
  return join(root, `${businessId}-discovery.json`);
}

/**
 * Do one discovery step: read what is recorded, write what is known and what is not.
 *
 * It reaches nothing. Its whole input is the durable business record, and its whole output is a file
 * — which is why the verifier can be a file check rather than a matter of trust.
 *
 * When the artifact comes back needing the Owner, that is reported as a gate rather than a failure.
 * The kernel then blocks this business's branch and moves to another one, which is the difference
 * between a portfolio that waits on Daniel and one that keeps going.
 */
export function createDiscoveryDispatcher(deps: RuntimeDepsV1) {
  return (step: AutonomyStepV1, objective: StandingObjectiveV1): StepAttemptV1 => {
    const store = createFileAutonomyStore(deps.storeRoot);
    const business = store.businesses().find((b) => b.businessId === step.businessId);
    if (business === undefined) {
      return {
        provider: "local", claim: "", ownerGate: null,
        blocked: `no business record for ${step.businessId}`,
        failure: null, latencyMs: null, tokens: null, costUsd: 0,
      };
    }

    if (!step.stepId.startsWith("discover-")) {
      // Objectives exist that this runtime has no step model for yet — the portfolio directions.
      // Saying so is better than inventing an activity to look busy.
      return {
        provider: "local", claim: "", ownerGate: null,
        blocked: `no discovery step model for ${objective.objectiveId}`,
        failure: null, latencyMs: null, tokens: null, costUsd: 0,
      };
    }

    const artifact = buildDiscoveryArtifact({ business, now: deps.now() });
    writeAtomic(
      artifactPath(deps.artifactRoot, business.businessId),
      `${JSON.stringify(artifact, null, 2)}\n`,
    );

    /*
     * Writing the discovery state is the work, and it succeeded.
     *
     * An earlier version reported this as an Owner gate, which was wrong twice: the kernel skips
     * verification on a gated step, so it threw away the evidence of a real deliverable, and it
     * described a finished piece of work as if nothing had happened. Needing the Owner is a fact
     * about what comes *next*, so it parks the objective after the pass instead — see
     * `parkBranchesNeedingOwner`.
     */
    const verdict = understandsBusiness(artifact);
    return {
      provider: "local",
      claim: `wrote discovery state for ${business.canonicalName}: ${verdict.reason}`,
      ownerGate: null, blocked: null, failure: null, latencyMs: null, tokens: null, costUsd: 0,
    };
  };
}

/** Verification reads the file back and checks it is the artifact it claims to be. */
export function createDiscoveryVerifier(deps: RuntimeDepsV1) {
  return (step: AutonomyStepV1): readonly StepEvidenceV1[] => {
    const path = artifactPath(deps.artifactRoot, step.businessId);
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as BusinessDiscoveryArtifactV1;
      const sound = parsed.schema === "aion.director.businessDiscovery.v1"
        && parsed.businessId === step.businessId
        && parsed.known.every((fact) => fact.provenance.trim() !== "");
      return [{
        kind: "DISCOVERY_ARTIFACT",
        detail: sound
          ? `${path} (${parsed.known.length} recorded facts, ${parsed.unknown.length} open questions)`
          : `${path} exists but is not a sound discovery artifact`,
        observed: sound,
      }];
    } catch {
      return [{ kind: "DISCOVERY_ARTIFACT", detail: `${path} not found`, observed: false }];
    }
  };
}

/**
 * Park every branch whose next move belongs to the Owner.
 *
 * Run after a pass rather than during one. A business whose discovery artifact still has blocking
 * questions cannot be worked further by AION, so its objective is blocked with the exact questions
 * and the reason they matter — which is what the status surface reads back. The rest of the
 * portfolio is untouched, which is the whole point: one business waiting on Daniel must not idle
 * the others.
 */
export function parkBranchesNeedingOwner(deps: RuntimeDepsV1): readonly string[] {
  const store = createFileAutonomyStore(deps.storeRoot);
  const parked: string[] = [];
  for (const objective of store.objectives()) {
    if (objective.status !== "ACTIVE") continue;
    let artifact: BusinessDiscoveryArtifactV1;
    try {
      artifact = JSON.parse(
        readFileSync(artifactPath(deps.artifactRoot, objective.businessId), "utf8"),
      ) as BusinessDiscoveryArtifactV1;
    } catch {
      continue;
    }
    if (artifact.ownerInformationRequest.length === 0) continue;
    const why = artifact.unknown.find((question) => question.blocking)?.whyItMatters
      ?? "these are the facts nothing can be ranked without";
    store.saveObjective({
      ...objective,
      status: "BLOCKED",
      blockedReason: `${artifact.canonicalName} needs Owner information: `
        + `${artifact.ownerInformationRequest.join(" | ")} — because ${why}`,
      updatedAt: deps.now(),
    });
    parked.push(objective.objectiveId);
  }
  return parked;
}

/* -------------------------------------------------------------------------- */
/* Start, pause, resume, status                                                */
/* -------------------------------------------------------------------------- */

export interface RuntimeRunV1 {
  readonly started: boolean;
  readonly reason: string;
  readonly registration: RegistrationV1 | null;
  readonly run: KernelRunV1 | null;
  /** Objectives parked after the pass because only the Owner can advance them. */
  readonly parked: readonly string[];
}

/**
 * Start a bounded pass.
 *
 * Registration happens first and every time, because it is idempotent and because a run that
 * assumed the portfolio was already there would fail confusingly on a fresh machine.
 */
export function startAutonomy(deps: RuntimeDepsV1): RuntimeRunV1 {
  const state = readRuntimeState(deps.storeRoot);
  if (state.paused) {
    return { started: false, reason: `paused: ${state.pausedReason}`, registration: null, run: null, parked: [] };
  }

  const registration = registerPortfolio(deps);
  const store: AutonomyStoreV1 = createFileAutonomyStore(deps.storeRoot);
  const ledger: DurableExperienceLedgerV1 = createDurableExperienceLedger(deps.storeRoot);

  const run = runAutonomyKernel({
    store,
    ledger,
    now: deps.now,
    currentSha: deps.currentSha,
    dispatch: createDiscoveryDispatcher(deps),
    verify: createDiscoveryVerifier(deps),
    availableCapabilities: [],
    // Never set. This runtime does local shadow work, and an outward step is refused by the
    // scheduler before it is selected rather than being trusted not to be chosen.
    outwardAuthorized: false,
    ...(deps.maxSteps !== undefined ? { maxSteps: deps.maxSteps } : {}),
  });

  const parked = parkBranchesNeedingOwner(deps);

  writeRuntimeState(deps.storeRoot, {
    ...readRuntimeState(deps.storeRoot),
    lastRunAtUtc: deps.now(),
    runs: state.runs + 1,
  });

  return { started: true, reason: run.detail || run.stopReason, registration, run, parked };
}

export function pauseAutonomy(deps: RuntimeDepsV1, reason: string): AutonomyRuntimeStateV1 {
  const next: AutonomyRuntimeStateV1 = {
    ...readRuntimeState(deps.storeRoot),
    paused: true,
    pausedReason: reason.trim() === "" ? "paused by Owner" : reason.trim(),
  };
  writeRuntimeState(deps.storeRoot, next);
  return next;
}

export function resumeAutonomy(deps: RuntimeDepsV1): AutonomyRuntimeStateV1 {
  const next: AutonomyRuntimeStateV1 = {
    ...readRuntimeState(deps.storeRoot),
    paused: false,
    pausedReason: "",
  };
  writeRuntimeState(deps.storeRoot, next);
  return next;
}

export interface RuntimeStatusV1 extends AutonomyStatusV1 {
  readonly paused: boolean;
  readonly pausedReason: string;
  readonly runs: number;
  readonly lastRunAtUtc: string;
  /** Which businesses are waiting on the Owner, and for what. */
  readonly needsOwnerInformation: readonly { businessId: string; questions: readonly string[] }[];
}

export function runtimeStatus(deps: RuntimeDepsV1): RuntimeStatusV1 {
  const store = createFileAutonomyStore(deps.storeRoot);
  const state = readRuntimeState(deps.storeRoot);
  const base = autonomyStatus(store, [], false);

  const needsOwnerInformation = store.businesses().flatMap((business) => {
    try {
      const parsed = JSON.parse(
        readFileSync(artifactPath(deps.artifactRoot, business.businessId), "utf8"),
      ) as BusinessDiscoveryArtifactV1;
      if (parsed.ownerInformationRequest.length === 0) return [];
      return [{ businessId: business.businessId, questions: parsed.ownerInformationRequest }];
    } catch {
      return [];
    }
  });

  return {
    ...base,
    paused: state.paused,
    pausedReason: state.pausedReason,
    runs: state.runs,
    lastRunAtUtc: state.lastRunAtUtc,
    needsOwnerInformation,
  };
}
