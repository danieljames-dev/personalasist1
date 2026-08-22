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
import { createFileBusinessEvidenceStore } from "./business-evidence-store.js";
import { CLAIM_V1, LOCALFINDS_WORKSPACE_V1, corpusFor } from "./business-corpus.js";
import { portfolioSummary, assessRevenueReadiness, type PortfolioSummaryEntryV1 } from "./business-readiness.js";
import { hasCandidateModels, runRevenueDiscovery } from "./revenue-discovery.js";
import { money, quantity } from "./revenue-opportunity.js";
import {
  closeOwnerQuestion,
  ensureOwnerQuestion,
  recordOwnerAnswer,
  type OwnerAnswerInputV1,
  type OwnerAnswerResultV1,
} from "./business-intake.js";
import { BLOCKING_DISCOVERY_QUESTIONS_V1 } from "./business-discovery.js";
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
  /** How many evidence sources were loaded per business. */
  readonly evidenceLoaded: readonly { businessId: string; sources: number }[];
  /** Blocking questions opened this pass. Empty on every start after the first. */
  readonly questionsOpened: readonly string[];
  /** Questions closed this pass because evidence now answers them. */
  readonly questionsClosed: readonly string[];
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
  const evidenceLoaded: { businessId: string; sources: number }[] = [];
  const questionsOpened: string[] = [];
  const questionsClosed: string[] = [];

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

  /*
   * Load whatever evidence AION has for each business.
   *
   * Idempotent by the store's own identity rule, so this runs on every registration without
   * duplicating anything — which matters because registration runs on every start.
   */
  const evidenceStore = createFileBusinessEvidenceStore(join(deps.storeRoot, "business-evidence"));
  for (const business of businesses) {
    const sources = corpusFor(business.businessId, now);
    for (const source of sources) evidenceStore.commitImport(business.businessId, source, now);
    evidenceLoaded.push({ businessId: business.businessId, sources: sources.length });

    /*
     * Open the blocking questions for a business AION still cannot describe.
     *
     * `ensureOwnerQuestion` is the reason a restart does not re-ask: an existing question, open or
     * resolved, is returned untouched. The LocalFinds identity question is already answered, and a
     * runtime that recreated it every boot would ask the Owner the same thing forever.
     */
    /*
     * A revenue-discovery step for a business the evidence says is ready.
     *
     * Created here rather than in the discovery module so the Director owns the decision: readiness
     * is a fact about evidence, and turning a fact into work is scheduling. The step's fingerprint
     * is the business, so it runs once per business and a restart does not repeat it.
     */
    const readiness = assessRevenueReadiness(
      business.businessId,
      evidenceStore.evidence(business.businessId),
      evidenceStore.questions(business.businessId),
    );
    /*
     * Readiness is not enough on its own: AION also has to have models for this business.
     *
     * `assessRevenueReadiness` is workspace-agnostic, so any business with a legal status and a
     * service area reads as ready. The candidate models are a §400.509 companion service and belong
     * to one workspace, so scheduling revenue discovery for a second ready business would have
     * failed the step rather than reporting that there is nothing to discover with yet.
     */
    if (readiness.readiness === "READY_FOR_REVENUE_DISCOVERY" && hasCandidateModels(business.businessId)) {
      const revenueObjective = ensureObjective(
        business,
        `Find the highest-value, evidence-grounded way to generate sustainable revenue for ${business.canonicalName} within its currently approved service area, without inventing facts, contacting anyone, or spending money.`,
      );
      objectives.push(revenueObjective);
      const stepId = `revenue-discovery-${business.businessId}`;
      if (existingSteps.has(stepId)) recovered.push(`step:${stepId}`);
      else {
        store.saveStep({
          schema: "aion.director.autonomyStep.v1",
          stepId,
          objectiveId: revenueObjective.objectiveId,
          businessId: business.businessId,
          title: `Revenue discovery for ${business.canonicalName}`,
          valueClass: "REAL_USER_OR_BUSINESS_VALUE",
          evidenceRefs: [],
          effectScope: "LOCAL_SHADOW",
          status: "READY",
          dependsOn: [],
          // Higher than a discovery step: this business is the one that can actually be worked.
          expectedValue: 500,
          confidence: 0.7,
          ownerTimeMinutes: 0,
          requiredCapabilities: [],
          attempts: 0,
          maxAttempts: 2,
          blockedReason: null,
          effectFingerprint: `revenue-discovery:${business.businessId}`,
          createdAt: now,
          updatedAt: now,
        });
        created.push(`step:${stepId}`);
      }
    }

    /*
     * The LocalFinds identity question, recorded as asked and answered.
     *
     * It was a real blocking question — two workspaces for one business would have corrupted every
     * comparison downstream — and the Owner closed it. Writing it down resolved, rather than not
     * writing it down at all, is what proves the "a resolved question stays resolved" property in
     * the running system instead of only in a test. The alias evidence is its resolution.
     */
    if (business.businessId === LOCALFINDS_WORKSPACE_V1) {
      const identityQuestion = "Is LakelandFinds the same business as LocalFinds?";
      ensureOwnerQuestion(evidenceStore, {
        workspaceId: business.businessId,
        missingFact: identityQuestion,
        whyItMatters: "two workspaces for one business would corrupt every cross-business comparison",
        blocking: true,
        evidenceNeeded: "an Owner statement of brand identity",
      }, now);
      const alias = evidenceStore.evidence(business.businessId)
        .find((row) => row.claim === CLAIM_V1.brandAlias && row.state === "KNOWN");
      if (alias !== undefined) {
        const closed = closeOwnerQuestion(evidenceStore, business.businessId, identityQuestion, alias.evidenceId, now);
        // False on every start after the first, which is the property worth reporting.
        if (closed) questionsClosed.push(`${business.businessId}:identity`);
      }
    }

    if (assessBusinessKnowledge(business).knowsWhatItDoes) continue;
    for (const question of BLOCKING_DISCOVERY_QUESTIONS_V1.filter((q) => q.blocking)) {
      const opened = ensureOwnerQuestion(evidenceStore, {
        workspaceId: business.businessId,
        missingFact: question.question,
        whyItMatters: question.whyItMatters,
        blocking: true,
        evidenceNeeded: "an Owner statement, or an authoritative business document",
      }, now);
      if (opened.created) questionsOpened.push(`${business.businessId}:${opened.question.questionId}`);
    }
  }

  const state = readRuntimeState(deps.storeRoot);
  writeRuntimeState(deps.storeRoot, {
    ...state,
    registeredAtUtc: state.registeredAtUtc === "" ? now : state.registeredAtUtc,
  });

  return { businesses, objectives, created, recovered, discoveryReasons, evidenceLoaded, questionsOpened, questionsClosed };
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

    if (step.stepId.startsWith("revenue-discovery-")) {
      /*
       * Revenue discovery is a pure read over evidence, so it needs no capability and can always
       * run. What it *cannot* do is gather market evidence — that needs a research route AION does
       * not have — so the report comes back with named blockers rather than invented figures, and
       * the step completes on the report having been written.
       */
      const evidenceStore = createFileBusinessEvidenceStore(join(deps.storeRoot, "business-evidence"));
      const report = runRevenueDiscovery({
        workspaceId: step.businessId,
        objectiveId: objective.objectiveId,
        store: evidenceStore,
        now: deps.now(),
        researchPort: null,
      });
      writeAtomic(
        join(deps.artifactRoot, `${step.businessId}-revenue-discovery.json`),
        `${JSON.stringify(report, null, 2)}\n`,
      );

      /*
       * The Owner's questions have to exist somewhere he can answer them.
       *
       * The report said "the next decision is the Owner's" and listed two questions, and they lived
       * only inside a JSON artifact — `autonomy.answer` had no question id to accept, so the decision
       * the operator asked for could not actually be made. Registering them through
       * `ensureOwnerQuestion` puts them on the same plane as every other Owner question, and it is
       * idempotent, so a re-run does not duplicate them.
       */
      let registered = 0;
      for (const question of report.ownerQuestions) {
        const { created } = ensureOwnerQuestion(evidenceStore, {
          workspaceId: step.businessId,
          missingFact: question,
          whyItMatters: "revenue discovery cannot proceed on this point without it",
          blocking: false,
          evidenceNeeded: "an Owner statement",
        }, deps.now());
        if (created) registered += 1;
      }
      return {
        provider: "local",
        claim: `revenue discovery: ${report.candidates.length} candidates, `
          + `${report.ranking.rankable ? "ranked" : "not rankable"}, `
          + `${report.capabilityBlockers.length} capability blocker(s), `
          + `${registered} new Owner question(s) registered`,
        ownerGate: null, blocked: null, failure: null, latencyMs: null, tokens: null, costUsd: 0,
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
    if (step.stepId.startsWith("revenue-discovery-")) {
      const path = join(deps.artifactRoot, `${step.businessId}-revenue-discovery.json`);
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as {
          schema?: string; workspaceId?: string; candidates?: unknown[];
        };
        /*
         * An empty candidate list is not a report.
         *
         * `Array.isArray` alone let `{schema, workspaceId, candidates: []}` verify as a successful
         * revenue-discovery step, so a run that produced nothing would have been recorded as one
         * that produced something. Refusing to rank is a valid outcome; having nothing to refuse to
         * rank is not.
         */
        /*
         * Every candidate must look like a candidate. `length > 0` was satisfied by `[{}]`, so a
         * dispatcher that wrote structurally empty rows still verified as having produced work.
         */
        const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
        const sound = parsed.schema === "aion.director.revenueDiscoveryReport.v1"
          && parsed.workspaceId === step.businessId
          && candidates.length > 0
          && candidates.every((row) => {
            /*
             * A candidate has to carry the things that make it arguable: an identity, a title, the
             * price figure everything is gated on, and the falsifiable experiment. Checking only id
             * and title closed `[{}]` and nothing beyond it.
             */
            const candidate = row as {
              opportunityId?: unknown; title?: unknown;
              estimatedPrice?: unknown;
              nextValidationStep?: { falsifiedBy?: unknown };
            };
            const text = (value: unknown) => typeof value === "string" && value.trim() !== "";
            if (!text(candidate.opportunityId) || !text(candidate.title)
              || !text(candidate.nextValidationStep?.falsifiedBy)) return false;
            /*
             * The price is re-validated through `money()`, not inspected as strings.
             *
             * Serialising to JSON and reading it back is a construction path that skips every rule
             * `money()` enforces — an empty basis, an UNKNOWN carrying a value, a half-open range, a
             * state that is not a state. Checking that two fields are non-empty strings would have
             * verified `{ state: "KNOWN", basis: "because I said so" }` with no bounds at all. There
             * is one validator, so the verifier calls it rather than re-implementing a weaker one.
             */
            /*
             * Every figure, not only the price.
             *
             * The price was re-validated and the other six were taken on trust, which left the same
             * JSON construction path open for capital, owner time and the rest. `money` and
             * `quantity` differ only in carrying a unit, so the row picks the right validator.
             */
            try {
              const figures = candidate as Record<string, unknown>;
              const names = [
                "estimatedPrice", "estimatedDirectCost", "estimatedGrossMarginPct",
                "estimatedOwnerTime", "estimatedWorkerHours", "estimatedCapitalRequired",
                "estimatedTimeToFirstRevenue",
              ];
              const checked = names.map((name) => {
                const figure = figures[name] as { unit?: unknown } | undefined;
                if (figure === undefined) throw new Error(`${name} is missing`);
                return typeof figure.unit === "string"
                  ? quantity(figure as Parameters<typeof quantity>[0]).unit !== ""
                  : money(figure as Parameters<typeof money>[0]).currency === "USD";
              });
              return checked.every((ok) => ok);
            } catch {
              return false;
            }
          });
        return [{
          kind: "REVENUE_DISCOVERY_REPORT",
          detail: sound ? `${path} (${parsed.candidates!.length} candidates)` : `${path} is not a sound report`,
          observed: sound,
        }];
      } catch (error) {
        /*
         * "Not found" and "unreadable" are different failures and were reported as the same one.
         * A corrupt or truncated report is a defect in the step that wrote it; a missing one means
         * the step did not run. Collapsing them hides the first behind the second.
         */
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        return [{
          kind: "REVENUE_DISCOVERY_REPORT",
          detail: missing ? `${path} not found` : `${path} could not be read: ${(error as Error).message}`,
          observed: false,
        }];
      }
    }
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
  const steps = store.steps();
  for (const objective of store.objectives()) {
    if (objective.status !== "ACTIVE") continue;

    /*
     * A missing fact blocks the work that needs it, not everything the business owns.
     *
     * Parking was keyed on the business, so Compassionate Choice's *revenue* objective was being
     * parked by the discovery artifact's open questions — even though revenue discovery has the
     * evidence it needs and is explicitly ready. A question about what a business does does not
     * block work that already knows.
     */
    const objectiveSteps = steps.filter((step) => step.objectiveId === objective.objectiveId);
    if (objectiveSteps.some((step) => step.stepId.startsWith("revenue-discovery-"))) continue;
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
  /**
   * Evidence readiness per business, minimized.
   *
   * Counts and enum states only — the summary is what crosses the wall between businesses, and it
   * carries nothing that could be read back as a fact about one of them.
   */
  readonly evidenceReadiness: readonly PortfolioSummaryEntryV1[];

  /**
   * Businesses whose evidence says go, and for which AION has no revenue models to go with.
   *
   * Gating step creation on `hasCandidateModels` was a silent skip: a ready business simply did not
   * get scheduled, and nothing anywhere said why. A skip nobody can see is indistinguishable from
   * the scheduler being broken, and this is the honest version — "ready, and nothing to discover
   * with yet" is a result, and results get reported.
   */
  readonly readyWithoutRevenueModels: readonly string[];
}

export function runtimeStatus(deps: RuntimeDepsV1): RuntimeStatusV1 {
  const store = createFileAutonomyStore(deps.storeRoot);
  const state = readRuntimeState(deps.storeRoot);
  const base = autonomyStatus(store, [], false);

  const evidenceStore = createFileBusinessEvidenceStore(join(deps.storeRoot, "business-evidence"));

  /*
   * Status reads the Owner-question plane, not only the discovery artifact.
   *
   * Revenue discovery registers its questions through `ensureOwnerQuestion`, and status went on
   * reporting the discovery artifact alone — so the two questions this milestone calls the Owner's
   * next decision never appeared in the thing the Owner actually looks at. Open questions in the
   * store are the source of truth; the artifact is one contributor to it.
   */
  const needsOwnerInformation = store.businesses().flatMap((business) => {
    const open = evidenceStore.questions(business.businessId)
      .filter((question) => question.resolvedAtUtc === "")
      .map((question) => question.missingFact);

    let fromArtifact: readonly string[] = [];
    try {
      const parsed = JSON.parse(
        readFileSync(artifactPath(deps.artifactRoot, business.businessId), "utf8"),
      ) as BusinessDiscoveryArtifactV1;
      fromArtifact = parsed.ownerInformationRequest;
    } catch {
      fromArtifact = [];
    }

    const questions = [...new Set([...open, ...fromArtifact])];
    if (questions.length === 0) return [];
    return [{ businessId: business.businessId, questions }];
  });
  const evidenceReadiness = portfolioSummary(
    evidenceStore,
    store.businesses().map((business) => business.businessId),
  );

  const readyWithoutRevenueModels = evidenceReadiness
    .filter((entry) => entry.readiness === "READY_FOR_REVENUE_DISCOVERY" && !hasCandidateModels(entry.workspaceId))
    .map((entry) => entry.workspaceId);

  return {
    ...base,
    paused: state.paused,
    pausedReason: state.pausedReason,
    runs: state.runs,
    lastRunAtUtc: state.lastRunAtUtc,
    needsOwnerInformation,
    evidenceReadiness,
    readyWithoutRevenueModels,
  };
}

/**
 * Record an Owner answer against the evidence store this runtime owns.
 *
 * The runtime supplies the store; the caller supplies words. Everything consequential — source
 * class, epistemic state, conflict, supersession, which question this closes — is decided inside
 * `recordOwnerAnswer`, where the client cannot reach it.
 */
export function answerOwnerQuestion(deps: RuntimeDepsV1, input: OwnerAnswerInputV1): OwnerAnswerResultV1 {
  const evidenceStore = createFileBusinessEvidenceStore(join(deps.storeRoot, "business-evidence"));
  return recordOwnerAnswer(evidenceStore, input, deps.now());
}
