import type {
  ActivityV1, AgentActionV1, ApprovalV1, AssistantStateV1, CapabilityRegistryV1, ChatMessageV1,
  ChatTurnV1, ClockV1, ConversationV1, DeveloperAgentModeV1, DeveloperAgentRegistryV1,
  DeveloperAgentStatusV1, IdGeneratorV1, ImportReportV1,
  ImportSourceV1, MemoryV1, ModelProviderV1, PlanV1, PrivateBackupV1, RoutineV1, SettingsV1,
  ContactChannelV1, CustomerAppointmentV1, CustomerInteractionV1, CustomerQueryV1, CustomerV1,
  IsoTimestamp, RelationshipQueryV1, RelationshipV1, SalesCountsV1, SalesMetricsEntryV1,
  MigrationRecordV1, StateRepositoryV1, TaskStateV1, TaskV1, VerificationRunV1, WorkspaceIdV1,
} from "./contracts.js";
import { DEFAULT_WORKSPACE, SALES_COUNT_KEYS } from "./contracts.js";
import { createEmptyStateV1, digestValue, migrateStateV1 } from "./adapters.js";
import type { AuthorityGrantV1, WriterAuthorityPortV1 } from "./writer-authority.js";
import { applyCustomerEdit, buildAppointment, buildCustomer, buildFollowUp, buildInteraction, lastInteraction, queryCustomers } from "./sales.js";
import { buildRelationship, queryRelationships } from "./relationships.js";
import type { WorkspaceV1 } from "./workspaces.js";
import { applyWorkspaceEdit, assertSameWorkspace, buildBrandProduct, buildWorkspace, requireWorkspace } from "./workspaces.js";
import { buildClaim, promoteClaim, supersedeClaim } from "./knowledge.js";
import type { BrainEndpointV1, BrainHealthV1, BrainRuntimePortV1, BrainRuntimeV1, BrainSettingsV1, RouterModeV1, RoutingDecisionV1, RoutingRequestV1 } from "./brain.js";
import {
  BRAIN_BOUNDARY, BRAIN_RUNTIMES, OFFLINE_ENDPOINT_ID, ROUTER_MODES, buildEndpoint,
  endpointForProvider, independenceReport, isOwnerControlled, rentedGpuEndpoint, routeRequest,
  routeSelectedProvider,
} from "./brain.js";
import type { EvaluationCaseResultV1, EvaluationCaseV1, EvaluationRunV1 } from "./evaluation.js";
import { EVALUATION_SUITE, EVALUATION_VERSION, compareEvaluations, detectDegenerateResponses, runEvaluationSuite, summariseEvaluation } from "./evaluation.js";
import { CompositeCanonicalInferenceV1, bindInferenceEnvelope, redactInferenceDetail } from "./canonical-inference.js";
import type { CodeSandboxPortV1 } from "./code-sandbox.js";
import { splitStructuredProposals } from "./structured-output.js";
import type { OpportunityLinkKindV1, OpportunityV1 } from "./product-studio.js";
import {
  applyOpportunityEdit, buildCompetitorNote, buildExperiment, buildOpportunity, buildSpecification,
  completeExperiment, linkOpportunityRecord, linkedWorkSummary, opportunityAssessment,
  unlinkOpportunityRecord,
} from "./product-studio.js";
import type { ResearchJobV1, ResearchProviderV1, UrlVerdictV1 } from "./research.js";
import { applyResearchResult, buildResearchJob, evaluateResearchUrl, researchSummary } from "./research.js";
import type { ResearchPlanV1, ResearchSynthesisV1 } from "./research-agent.js";
import { describeRun, planResearch, proposeLearning, synthesise } from "./research-agent.js";
import type { LessonScopeV1, LessonStandingV1, LessonV1 } from "./learning.js";
import {
  ADAPTATION_BOUNDARY, applicableLessons, assertLessonClaimClass, buildLesson, learningSummary,
  lessonStanding, recordLessonOutcome,
} from "./learning.js";
import type { BuildPipelinePortV1, DevelopmentProjectV1, PipelineRunV1, PipelineStepV1 } from "./projects.js";
import {
  PIPELINE_STEPS, advanceProject, approveProjectStage, buildAgentProposal, buildDeploymentProposal,
  buildProject, buildProjectSpecification, projectStanding,
} from "./projects.js";
import type { CostIntelligenceV1, InferenceUsageV1 } from "./usage.js";
import { buildUsage, costIntelligence, usageSummary } from "./usage.js";
import type { RoutingResultV1 } from "./command-router.js";
import { assertNoExecutableText, routeCommand } from "./command-router.js";
import type {
  ExperimentRecommendationV1, GpuCostBreakdownV1, GpuInfrastructurePortV1, GpuOfferV1,
  GpuProvisioningProposalV1, GpuRequirementV1, GpuSessionStateV1, GpuSessionV1, ModelProfileV1,
  OfferAssessmentV1, ReadinessVerdictV1,
} from "./gpu.js";
import {
  DEFAULT_READINESS_INTERVAL_MS, LOCAL_MODEL_PROFILES, MAX_HEALTH_FAILURES, OPEN_MODEL_PROFILES,
  V13_BUDGET_CEILING_CENTS, assessOffer, buildProvisioningProposal, describeProposal,
  emptyActivation, estimatedCents, isActivatingSession, isFinishedSession, isLiveSession,
  normaliseServingEndpoint, readinessDeadline, readinessVerdict, recommendExperiments,
  redactCredentials, revalidateProposal, runtimeMinutes, sessionCostBreakdown, sessionStanding,
  sessionStatusLabel, shutdownDecision,
} from "./gpu.js";
import { PAIRING_TTL_MINUTES, authenticate, checkRateLimit, clearRateLimit, issuePairingToken, pruneAccess, recordFailure, redeemPairingCode, revokeAllDevices, revokeDevice, validateBindAddress } from "./access.js";
import { SALES_ROUTINE_TEMPLATES, appointmentPreparation, callPreparation, discoveryQuestions, endOfDayRecap, followUpDraft, followUpQueue, morningPlan, nextActionSuggestion, objectionPrompts, rolePlay } from "./sales-coach.js";
import type { CoachOutputV1, SalesRoutineTemplateV1 } from "./sales-coach.js";
import {
  buildAccountSummary,
  buildDailyBriefing,
  buildEmailDraftFromCustomer,
  buildWorkQueue,
  findCustomersMentioning,
  findRelationshipsByName,
  findStalledDeals,
  newCrmDocument,
  newEmailDraft,
  routeCrmAssistantIntent,
} from "./crm-assistant.js";
import {
  buildJobApplication,
  draftCoverLetterSkeleton,
  interviewPrepFromKnowledge,
  scoreJobFit,
  type JobApplicationV1,
} from "./job-agent.js";
import {
  buildQueuedImportSource,
  csvRowToRelationship,
  emptyImportStats,
  parseSimpleCsv,
  type ImportSourceStatsV1,
  type ImportSourceStatusV1,
  type QueuedImportSourceV1,
} from "./import-queue.js";
import {
  buildImportReviewItem,
  classifyImportMaterial,
  factDraftFromCandidate,
  needsReview,
  shouldAutoAssociate,
  type ImportReviewItemV1,
  type ImportReviewStatusV1,
} from "./import-classify.js";
import { discoverPrivateLanAddresses, buildPhoneUrl, type LanDiscoveryResultV1 } from "./lan-discovery.js";
import { buildImportReadinessReport, type ImportReadinessReportV1 } from "./import-readiness.js";
import { extractImageWithLocalVision, imageUnderstandingStatus } from "./connectors/image-understanding.js";
import { refreshDealershipPublicInventory } from "./connectors/dealership-inventory.js";
import {
  buildVinOcrResult,
  VIN_VISION_PROMPT,
  type VinOcrResultV1,
} from "./vin-ocr.js";
import {
  buildVehicleTalkingPoints,
  compareTwoVehicles,
  formatResearchReply,
  lookupRecallsNhtsa,
  type RecallLookupResultV1,
} from "./vehicle-research.js";
import {
  buildGraphEdge,
  buildTemporalFact,
  ensureBindingForWorkspace,
  invalidateTemporalFact,
  markDerivedLineageStale,
  mayUseAcrossContexts,
  resolveContextSwitch,
  supersedeTemporalFact,
  type VisibilityClassV1,
} from "./executive-context.js";
import { emptyBrandDna, emptyExecutiveState, type ExecutiveStateV1 } from "./executive-state.js";
import { buildAttentionBoard, type AttentionBoardV1 } from "./attention-engine.js";
// filterAttentionBoard imported with opportunity helpers below
import { classifyCaptureText, type CaptureResultV1 } from "./universal-capture.js";
import {
  buildValueLedgerEntry,
  detectInventoryMatches,
  type OpportunitySignalV1,
} from "./opportunity-radar.js";
import {
  gmailContextPolicy,
  inferImportWorkspace,
  metricoolContextPolicy,
  type ImportWorkspaceInferenceV1,
  type WorkspaceCorrectionV1,
} from "./import-workspace-map.js";
import { filterAttentionBoard } from "./attention-engine.js";
import {
  buildCommitment,
  extractCommitmentCandidates,
  refreshCommitmentStatus,
  type CommitmentV1,
} from "./commitments.js";
import {
  detectFactConflicts,
  explainBelief,
  isStaleFact,
  opportunityShouldSurface,
} from "./source-trust.js";
import { isInstructionLikeDocument } from "./entity-resolution.js";
import {
  defaultAuthorityEnvelope,
  emailSendSafetyCheck,
  evaluateExternalGate,
  formatAuthorityEnvelopeReport,
  formatExternalActionsReport,
  jobApplySafetyCheck,
  type AuthorityEnvelopeV1,
  type ExternalActionRecordV1,
} from "./authority-envelope.js";
import {
  isTestOrE2eWorkspace,
  isSyntheticOwnerFacingText,
  isSyntheticRelationship,
  isTechnicalNoiseKnowledgeFact,
  ownerOperationalWorkspaces,
  validateImportRootCandidate,
} from "./import-path-policy.js";
import {
  discoverOwnerDataSources,
  rootsForAutoRegister,
  type OwnerDataInventoryV1,
} from "./owner-data-discovery.js";
import {
  buildSnapshotSig,
  canRetry,
  classifyFailure,
  DEFAULT_RESOURCE_BUDGET,
  decomposeInternalGoal,
  detectChanges,
  emptyCycleResult,
  isExternalGatedCapability,
  proposeJobsFromChanges,
  verifyJobResult,
  type AutonomyJobV1,
  type ExecutiveCycleResultV1,
} from "./executive-cycle.js";
import {
  budgetInterruptions,
  DEFAULT_ATTENTION_BUDGET,
} from "./attention-budget.js";
import {
  aggregateUsageMetrics,
  applyCorrectionPattern,
  buildCustomerPrepCard,
  buildDealershipMorningAssist,
  buildEndOfDayClosure,
  buildMorningExecutiveBrief,
  detectDealStallSignals,
  explainWhyFirst,
  explainWhySurfacing,
  formatUsageMetrics,
  recordCorrectionPattern,
  type CustomerPrepCardV1,
  type DealershipMorningAssistV1,
  type MorningExecutiveBriefV1,
  type RealUsageMetricsV1,
} from "./proactive-usefulness.js";
import {
  applyOnlineListings,
  buildDealershipContext,
  decodeVinNhtsa,
  emptyVehicleInventoryState,
  emptyVinDecode,
  extractVinCandidatesFromText,
  LAKELAND_TOYOTA_DEFAULT,
  matchObservationToInventory,
  normalizeVinCandidate,
  queryVehicles,
  reconcileInventoryWalk,
  validateVin,
  type DealershipContextV1,
  type InventoryWalkV1,
  type PhysicalObservationV1,
  type VehicleInventoryStateV1,
  type VehicleRecordV1,
  type WalkReconciliationV1,
} from "./vehicle-inventory.js";
import {
  buildWalkAcceptanceReport,
  buildWalkObservationMetrics,
  deriveOnlineMatch,
  deriveStockMatch,
  type VinEntrySourceV1,
  type WalkAcceptanceReportV1,
  type WalkObservationMetricsV1,
} from "./walk-acceptance.js";
import {
  applyOwnerProfileSummary,
  buildBrandCollaborator,
  buildOwnerKnowledgeFact,
  correctOwnerKnowledgeFact,
  emptyOwnerKnowledge,
  type BrandCollaboratorV1,
  type OwnerKnowledgeFactV1,
  type OwnerKnowledgeStateV1,
} from "./owner-knowledge.js";
import {
  extractCommitmentsFromBody,
  gmailConnectorStatus,
  defaultGmailConfig,
  buildGmailAuthUrl,
  searchGmailFixtures as searchGmailFixtureMessages,
  type GmailMessageFixtureV1,
} from "./connectors/gmail-connector.js";
import {
  bestPerformingPosts,
  brandsNeedingAttention,
  listMetricoolBrandFixtures,
  metricoolConnectorStatus,
  defaultMetricoolConfig,
  type MetricoolBrandFixtureV1,
  type MetricoolPostFixtureV1,
} from "./connectors/metricool-connector.js";
import type { CrmDocumentV1, EmailDraftV1 } from "./contracts.js";

type AssistantPorts = {
  repository: StateRepositoryV1;
  clock: ClockV1;
  ids: IdGeneratorV1;
  providers: readonly ModelProviderV1[];
  capabilities: CapabilityRegistryV1;
  importer: ImportSourceV1;
  backup: PrivateBackupV1;
  developerAgents: DeveloperAgentRegistryV1;
  /**
   * Machine writer authority. When provided, every durable mutation through `mutate` and every
   * startup migration save requires effective WRITER (re-evaluated at each durable save).
   * Production injects Owner Authority V2 (verify-only, external trust root). Unit tests that
   * omit the port remain unbound only for synthetic fixtures; they must not be used for
   * multi-host safety.
   */
  authority?: WriterAuthorityPortV1;
  /** Optional. Absent means AION has no way to research anything, which is the default. */
  research?: ResearchProviderV1;
  /** Optional. Absent means AION cannot build or preview anything, which is also the default. */
  pipeline?: BuildPipelinePortV1;
  /** Optional. Absent means AION can rent nothing and spend nothing, which is also the default. */
  gpu?: GpuInfrastructurePortV1;
  /**
   * Optional. Absent means AION cannot verify that an endpoint answers, so it will not register a
   * rented one — a machine it cannot health-check is a machine it cannot honestly call ready.
   */
  brainRuntime?: BrainRuntimePortV1;
  /**
   * Optional. Evaluator-only code sandbox. Ordinary Chat never resolves this port.
   * Absent means code cases grade structurally only.
   */
  codeSandbox?: CodeSandboxPortV1;
};

/**
 * The prompt AION sends a rented runtime to decide whether it is actually serving.
 *
 * Deliberately a real completion rather than a socket check. A container can accept connections
 * for several minutes before the weights are loaded, and "the port is open" registered as "the
 * brain is ready" is exactly how an owner ends up paying for a machine that answers nothing.
 * Trivial, synthetic, and free of anything personal, because it is sent to rented hardware.
 */
const RENTED_HEALTH_PROMPT = "Reply with the single word READY.";

/**
 * Where a rented session is in becoming usable.
 *
 * `ready` and `finished` are separate booleans on purpose. "Not ready" and "finished" are very
 * different situations for someone watching a meter run, and a single tri-state would invite a
 * caller to treat one as the other.
 */
export interface GpuActivationStatusV1 {
  sessionId: string;
  state: GpuSessionStateV1;
  /** The owner-facing word for that state. Never "Ready" unless the endpoint answered. */
  label: string;
  endpointId: string | null;
  endpointHost: string | null;
  ready: boolean;
  finished: boolean;
  detail: string;
  readiness: ReadinessVerdictV1;
  cost: GpuCostBreakdownV1;
  standing: string;
}
const TASK_TRANSITIONS: Record<TaskStateV1, readonly TaskStateV1[]> = {
  proposed: ["ready", "cancelled"], ready: ["in-progress", "blocked", "completed", "cancelled"],
  "in-progress": ["blocked", "completed", "cancelled"], blocked: ["ready", "in-progress", "cancelled"],
  completed: ["ready"], cancelled: ["ready"],
};
function required(value: unknown, label: string, max = 10_000): string {
  if (typeof value !== "string" || !value.trim() || value !== value.normalize("NFC") || value.length > max) throw new Error(`${label} is invalid.`);
  return value.trim();
}
function iso(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const text = required(value, label, 64); if (new Date(text).toISOString() !== text) throw new Error(`${label} must be a canonical timestamp.`); return text;
}
function unique(values: unknown, label: string): string[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array.`);
  const result = values.map((value) => required(value, label, 100));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates.`);
  return result.sort();
}
function find<T extends { id: string }>(items: readonly T[], id: string, label: string): T {
  const item = items.find((entry) => entry.id === id); if (!item) throw new Error(`${label} was not found.`); return item;
}
const MEMORY_CATEGORIES: readonly MemoryV1["category"][] = ["semantic", "procedural", "episodic", "strategic"];

/**
 * Deterministic conflict grouping key: the text before the first colon, or the first four words
 * when there is no colon. Memories that share a category and subject but state different things
 * are both preserved and both flagged, rather than one silently replacing the other.
 */
function subjectKey(content: string): string {
  const normalized = content.trim().toLocaleLowerCase().replace(/\s+/gu, " ");
  const colon = normalized.indexOf(":");
  return (colon > 0 ? normalized.slice(0, colon) : normalized.split(" ").slice(0, 4).join(" ")).trim();
}
const CAREER_COMMANDS: readonly string[] = ["init", "ingest", "profile", "job:import", "match", "draft", "export", "demo"];
const VERIFICATION_CAPABILITY_ID = "aion.verify.run.v1";

/**
 * Picks the part of a verification transcript worth analysing. A full suite run is far larger than
 * a bounded instruction, and the useful signal is the failures plus the trailing summary, so both
 * are kept in order and the bulk of the passing output is dropped.
 */
function salientEvidence(run: VerificationRunV1, budget = 2600): string {
  const lines = `${run.stdout}\n${run.stderr}`.split(/\r?\n/u);
  const interesting = /^(?:not ok|#\s*(?:tests|pass|fail|skipped)|.*(?:error|Error|AssertionError|FAIL|failed|✗)\b)/u;
  const failures = lines.filter((line) => interesting.test(line));
  const tail = lines.slice(-40);
  const selected = [...new Set([...failures, ...tail])].filter((line) => line.trim());
  const text = selected.join("\n");
  return text.length > budget ? text.slice(-budget) : text || "(the operation produced no output)";
}

/**
 * Production structured-output split — same canonical parser as evaluation.
 * Proposal lines are never stored in the message body and never carry execution authority.
 * Reasoning/thinking text must not be passed here.
 */
function splitProviderProposals(response: string): { body: string; actions: Array<{ capabilityId: unknown; input: unknown }>; memories: Array<{ content: unknown; category: unknown }>; malformed: number } {
  const split = splitStructuredProposals(response);
  return { body: split.body, actions: split.actions, memories: split.memories, malformed: split.malformed };
}

export class AionAssistantV1 {
  private state = createEmptyStateV1();
  private ready: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();
  private controllers = new Map<string, AbortController>();
  /** Sessions with a readiness check in flight. One at a time, so no session registers twice. */
  #activating = new Set<string>();
  private reconciliation: Promise<void> = Promise.resolve();
  /**
   * Resolves when the startup reconciliation of rented GPUs has finished.
   *
   * Exposed because "a session that outlived a crash is stopped by whatever starts next" is a
   * claim that has to be testable. Ordinary callers never need it: reconciliation deliberately
   * does not block startup, since AION must open even when a provider is unreachable.
   */
  get startupReconciliation(): Promise<void> { return this.ready.then(() => this.reconciliation); }
  constructor(private readonly ports: AssistantPorts) {
    if (!ports.providers.length) throw new Error("At least one model provider is required.");
    this.ready = this.initialize();
  }
  private async initialize(): Promise<void> {
    const loaded = await this.ports.repository.load();
    this.state = loaded ?? createEmptyStateV1();
    if (loaded) {
      // Migrations run once, on load, before anything can read the state. A migration that
      // changes nothing is not written, so opening AION repeatedly does not churn revisions.
      const migrated = migrateStateV1(this.state, this.ports.clock.now(), (kind) => this.ports.ids.next(kind));
      if (migrated.applied) {
        // M2 fix: startup migration is a durable save and requires effective WRITER.
        // Prefer initialization failure over silent persistence while READ_ONLY / foreign / revoked.
        // Service-level gate is mandatory; repository wrapper is defense-in-depth only.
        if (this.ports.authority) {
          await this.ports.authority.assertWritable("startup migration");
        }
        const expected = this.state.revision;
        const next = { ...migrated.state, revision: expected + 1 };
        for (const record of migrated.records) this.#recordMigration(next, record);
        await this.ports.repository.save(expected, next);
        this.state = next;
      }
    }
    // Restore the owner's bridge choice. A bridge that is no longer installed must not block
    // startup: AION keeps its default and reports the real availability in Settings.
    try { this.ports.developerAgents.select(this.state.settings.developerBridgeId); } catch { this.ports.developerAgents.select(""); }
    /*
     * Reconcile rented GPUs on startup, before anything else runs.
     *
     * If AION was closed or crashed while a session was live, its deadlines are still in the state
     * file and this is where they get honoured. That is the whole reason they are stored rather
     * than held in timers: whatever starts next reaches the same conclusion. Reconciliation
     * enforces the limits first and only then asks the provider what still exists, so a session
     * that outlived its deadline is torn down rather than reconnected to.
     */
    if (this.ports.gpu) this.reconciliation = this.reconcileGpuSessions().then(() => {}, () => {});
  }
  #recordMigration(state: AssistantStateV1, record: MigrationRecordV1 | null): void {
    if (!record) return;
    const moved = Object.entries(record.assigned).filter(([, count]) => count > 0).map(([name, count]) => `${count} ${name}`).join(", ");
    this.activity(state, "settings", "state.migrate", `Applied ${record.migration}: ${moved || "no records needed assignment"}. Everything without a workspace became ${record.defaultWorkspace}; nothing moved between workspaces.`, null);
  }
  /** The workspace new records join and the one the UI is showing. */
  private get workspace(): WorkspaceIdV1 { return this.state.settings.activeWorkspace ?? DEFAULT_WORKSPACE; }
  async snapshot(): Promise<AssistantStateV1> { await this.ready; return structuredClone(this.state); }
  /** Inspect host writer authority without granting or mutating owner state. */
  async inspectWriterAuthority(): Promise<AuthorityGrantV1 | null> {
    await this.ready;
    if (!this.ports.authority) return null;
    return this.ports.authority.load();
  }
  /**
   * Runtime self-promotion is forbidden. Grant/revoke only via WriterAuthorityPort.applyOwnerCommand
   * from an external Owner/control-plane path — never exposed as an assistant capability.
   */
  async promoteWriterAuthority(): Promise<never> {
    throw new Error("Runtime cannot self-promote writer authority; use an external Owner/control-plane grant.");
  }
  private activity(state: AssistantStateV1, category: ActivityV1["category"], action: string, summary: string, subjectRef: string | null, outcome: ActivityV1["outcome"] = "success"): void {
    state.activity.unshift({ id: this.ports.ids.next("activity"), workspace: state.settings.activeWorkspace ?? DEFAULT_WORKSPACE, at: this.ports.clock.now(), category, action, summary, subjectRef, outcome });
    if (state.activity.length > 10_000) state.activity.length = 10_000;
  }
  /**
   * Applies the owner's retention and expiry policy on every write, so no separate sweeper can
   * drift from the persisted state. An approval that has passed its expiry can never be decided.
   */
  private prune(state: AssistantStateV1): void {
    const now = Date.parse(this.ports.clock.now());
    for (const approval of state.approvals) {
      if (approval.state !== "pending" || Date.parse(approval.expiresAt) > now) continue;
      approval.state = "expired"; approval.decidedAt = new Date(now).toISOString();
      const action = state.actions.find((item) => item.id === approval.actionId);
      if (action && (action.state === "awaiting-approval" || action.state === "approved")) { action.state = "cancelled"; action.updatedAt = approval.decidedAt; }
    }
    const groups = new Map<string, MemoryV1[]>();
    for (const memory of state.memories) {
      if (!memory.enabled) { memory.conflict = "none"; continue; }
      // Grouped inside a workspace: the same subject in Personal and Work is two separate
      // facts, not a conflict, and flagging them together would reveal a work record exists.
      const key = `${memory.workspace}\u0000${memory.category}\u0000${subjectKey(memory.content)}`;
      groups.set(key, [...(groups.get(key) ?? []), memory]);
    }
    for (const group of groups.values()) {
      const distinct = new Set(group.map((memory) => memory.content.trim().toLocaleLowerCase().replace(/\s+/gu, " ")));
      for (const memory of group) memory.conflict = distinct.size > 1 ? "conflicting" : "none";
    }
    pruneAccess(state, new Date(now).toISOString());
    const horizon = now - state.settings.privacy.retainActivityDays * 86_400_000;
    state.activity = state.activity.filter((entry) => Date.parse(entry.at) >= horizon);
    if (state.activity.length > 10_000) state.activity.length = 10_000;
  }
  private async mutate<T>(operation: (state: AssistantStateV1) => T | Promise<T>): Promise<T> {
    await this.ready; let result!: T; let failure: unknown;
    this.writeQueue = this.writeQueue.then(async () => {
      const expected = this.state.revision; const draft = structuredClone(this.state);
      try {
        // Fail closed at the durable mutation boundary when authority is bound.
        if (this.ports.authority) await this.ports.authority.assertWritable("persistent owner-state mutation");
        result = await operation(draft); this.prune(draft); draft.revision = expected + 1; await this.ports.repository.save(expected, draft); this.state = draft;
      }
      catch (error) { failure = error; }
    });
    await this.writeQueue; if (failure) throw failure; return result;
  }
  async completeOnboarding(): Promise<void> { await this.mutate((state) => { state.onboardingComplete = true; this.activity(state, "settings", "onboarding.complete", "Local-first onboarding completed.", null); }); }
  async updateSettings(input: Partial<SettingsV1>): Promise<SettingsV1> {
    const saved = await this.mutate((state) => {
      const next = { ...state.settings, ...input, privacy: { ...state.settings.privacy, ...(input.privacy ?? {}) } };
      if (!this.ports.providers.some((provider) => provider.id === next.providerId)) throw new Error("Selected provider is not registered.");
      required(next.model, "Model identifier", 200);
      if (next.providerId !== "deterministic" && next.providerId.startsWith("remote") && !next.remoteDisclosureAccepted) throw new Error("Remote-provider disclosure must be accepted before selection.");
      if (next.credentialEnvironmentVariable && !/^[A-Z][A-Z0-9_]{0,127}$/u.test(next.credentialEnvironmentVariable)) throw new Error("Credential environment-variable name is invalid.");
      if (typeof next.developerBridgeId !== "string") throw new Error("Developer-agent bridge selection is invalid.");
      const target = requireWorkspace(state.workspaces, next.activeWorkspace);
      if (target.archived) throw new Error("That workspace is archived. Reactivate it before switching to it.");
      next.remoteAccess = { ...state.settings.remoteAccess, ...(input.remoteAccess ?? {}) };
      next.remoteAccess.bindAddress = validateBindAddress(next.remoteAccess.bindAddress);
      {
        const base = {
          gmailClientId: "",
          gmailRedirectUri: "http://127.0.0.1:31415/oauth/gmail/callback",
          metricoolTokenEnvVar: "AION_METRICOOL_USER_TOKEN",
          metricoolBlogIdEnvVar: "AION_METRICOOL_BLOG_ID",
        };
        next.connectors = {
          ...base,
          ...state.settings.connectors,
          ...(input.connectors ?? {}),
        };
        if (typeof next.connectors.gmailClientId !== "string") next.connectors.gmailClientId = "";
        if (typeof next.connectors.gmailRedirectUri !== "string" || !next.connectors.gmailRedirectUri.trim()) {
          next.connectors.gmailRedirectUri = base.gmailRedirectUri;
        }
      }
      if (typeof next.remoteAccess.enabled !== "boolean") throw new Error("Private phone access must be on or off.");
      if (!Number.isSafeInteger(next.remoteAccess.sessionDays) || next.remoteAccess.sessionDays < 1 || next.remoteAccess.sessionDays > 365) throw new Error("Session length must be between 1 and 365 days.");
      // Turning private access off ends every phone session immediately rather than merely
      // refusing new ones: a materially weakened access decision must fail closed at once.
      if (state.settings.remoteAccess.enabled && !next.remoteAccess.enabled) {
        const ended = revokeAllDevices(state, this.ports.clock.now());
        this.activity(state, "settings", "device.revoked.all", `Private phone access was turned off, ending ${ended.sessions} session(s). Owner data is untouched.`, null);
      }
      // Labels follow the registry: every workspace that exists has one, and a label for a
      // workspace that does not exist is refused rather than stored as an orphan.
      next.workspaceLabels = { ...state.settings.workspaceLabels, ...(input.workspaceLabels ?? {}) };
      for (const key of Object.keys(next.workspaceLabels)) requireWorkspace(state.workspaces, key);
      for (const workspace of state.workspaces) next.workspaceLabels[workspace.id] = required(next.workspaceLabels[workspace.id] ?? workspace.label, "Workspace label", 80);
      // A relabelled workspace keeps the registry and the label map saying the same thing.
      state.workspaces = state.workspaces.map((entry) => next.workspaceLabels[entry.id] === entry.label ? entry : { ...entry, label: next.workspaceLabels[entry.id]!, updatedAt: this.ports.clock.now() });
      if (next.developerBridgeId && !this.ports.developerAgents.get(next.developerBridgeId)) throw new Error("Selected developer-agent bridge is not registered.");
      next.importRoots = unique(next.importRoots, "Import roots").map((root) => {
        const cleaned = required(root, "Import root", 500);
        // Never accept whole-drive roots as approved import containers.
        if (/^[A-Za-z]:[\\/]?$/u.test(cleaned) || cleaned === "/" || /^\\\\[^\\]+\\?$/u.test(cleaned)) {
          throw new Error("Import roots must be a specific folder, not a whole drive.");
        }
        return cleaned;
      });
      if (next.exportRoot) required(next.exportRoot, "Export root", 500);
      if (!Number.isSafeInteger(next.privacy.retainActivityDays) || next.privacy.retainActivityDays < 1 || next.privacy.retainActivityDays > 3650) throw new Error("Activity retention is invalid.");
      state.settings = next; this.activity(state, "settings", "settings.update", "Local settings updated; no credential value stored.", null); return structuredClone(next);
    });
    this.ports.developerAgents.select(saved.developerBridgeId);
    return saved;
  }
  async providerHealth(): Promise<Array<{ id: string; location: "local" | "remote"; available: boolean; detail: string }>> {
    const results = []; for (const provider of this.ports.providers) results.push({ id: provider.id, location: provider.location, ...await provider.health() }); return results;
  }
  /** The selected bridge only, without probing any account: this runs on every ordinary state read. */
  async developerBridgeStatus(): Promise<DeveloperAgentStatusV1> { return this.ports.developerAgents.selected().status(); }
  /**
   * Every discovered bridge. `includeAccount` is an explicit owner request: it asks each installed
   * CLI whether an account is signed in, which is a local check and never a paid model call.
   */
  async developerBridgeInventory(includeAccount = false): Promise<Array<DeveloperAgentStatusV1 & { selected: boolean; commands: Array<{ mode: DeveloperAgentModeV1; executable: string; args: readonly string[] }> }>> {
    const results: Array<DeveloperAgentStatusV1 & { selected: boolean; commands: Array<{ mode: DeveloperAgentModeV1; executable: string; args: readonly string[] }> }> = [];
    const selectedId = this.ports.developerAgents.selected().id;
    for (const bridge of this.ports.developerAgents.list()) {
      const status = await bridge.status({ includeAccount });
      results.push({ ...status, selected: bridge.id === selectedId, commands: status.modes.map((mode) => ({ mode, ...bridge.describe(mode) })) });
    }
    if (includeAccount) {
      const signedIn = results.filter((entry) => entry.available && entry.account === "signed-in").length;
      await this.mutate((state) => { this.activity(state, "agent", "developer.health", `Developer-agent health checked locally: ${results.filter((entry) => entry.available).length} installed, ${signedIn} signed in. No account value was stored and no paid call was made.`, null); });
    }
    return results;
  }
  /** The complete registry the Agent Controller will honour. Nothing outside this list is callable. */
  capabilities(): Array<{ id: string; privacy: string; approval: string; timeoutMs: number; maxRetries: number }> {
    return this.ports.capabilities.list().map(({ id, privacy, approval, timeoutMs, maxRetries }) => ({ id, privacy, approval, timeoutMs, maxRetries }));
  }

  async createConversation(title = "New conversation"): Promise<ConversationV1> {
    return this.mutate((state) => {
      const at = this.ports.clock.now(); const conversation: ConversationV1 = { id: this.ports.ids.next("conversation"), workspace: state.settings.activeWorkspace, title: required(title, "Conversation title", 200), state: "active", memoryContextEnabled: state.settings.memoryContextEnabled, createdAt: at, updatedAt: at, messages: [] };
      state.conversations.unshift(conversation); this.activity(state, "chat", "conversation.create", "Conversation created.", conversation.id); return structuredClone(conversation);
    });
  }
  async updateConversation(id: string, change: { title?: string; state?: "active" | "archived"; memoryContextEnabled?: boolean }): Promise<void> {
    await this.mutate((state) => { const item = find(state.conversations, id, "Conversation"); if (change.title !== undefined) item.title = required(change.title, "Conversation title", 200); if (change.state !== undefined) item.state = change.state; if (change.memoryContextEnabled !== undefined) item.memoryContextEnabled = change.memoryContextEnabled; item.updatedAt = this.ports.clock.now(); this.activity(state, "chat", "conversation.update", "Conversation settings updated.", id); });
  }
  async deleteConversation(id: string): Promise<void> { await this.mutate((state) => { find(state.conversations, id, "Conversation"); state.conversations = state.conversations.filter((item) => item.id !== id); this.activity(state, "chat", "conversation.delete", "Conversation deleted.", id); }); }
  /**
   * Streams one Chat turn through the canonical inference path.
   *
   * Routing produces a binding execution contract. The selected endpoint, context limits, and
   * disclosure originate from that decision — Chat does not recompute them, and does not call a
   * ModelProviderV1 port directly after routing has completed.
   */
  async *streamMessage(conversationId: string, content: string): AsyncGenerator<string, ChatTurnV1, void> {
    const body = required(content, "Message", 100_000);
    await this.mutate((state) => { const conversation = find(state.conversations, conversationId, "Conversation"); const message: ChatMessageV1 = { id: this.ports.ids.next("message"), role: "owner", content: body, createdAt: this.ports.clock.now(), providerId: null }; conversation.messages.push(message); conversation.updatedAt = message.createdAt; this.activity(state, "chat", "message.owner", "Owner message stored locally.", conversationId); });
    const snap = await this.snapshot();
    const conversation = find(snap.conversations, conversationId, "Conversation");
    const decision = this.#routeChat(snap, conversation);
    if (!decision.allowed || !decision.endpoint || !decision.context) throw new Error(decision.reason);
    if (decision.requiresApproval && decision.disclosure && !isOwnerControlled(decision.endpoint) && !snap.settings.remoteDisclosureAccepted) {
      throw new Error(`${decision.disclosure.statement} Accept the remote-provider disclosure in Settings before this can run.`);
    }
    if (this.controllers.has(`chat:${conversationId}`)) throw new Error("This conversation already has a request in flight.");
    const controller = new AbortController();
    this.controllers.set(`chat:${conversationId}`, controller);
    const endpointId = decision.endpoint.id;
    try {
      if (controller.signal.aborted) throw new Error("Chat request cancelled.");
      const envelope = bindInferenceEnvelope(decision, {
        conversationId,
        messages: conversation.messages,
        memories: snap.memories,
        workspace: conversation.workspace,
        memoryContextEnabled: conversation.memoryContextEnabled,
        purpose: "chat",
      });
      const inference = new CompositeCanonicalInferenceV1(this.ports.brainRuntime ?? null, this.ports.providers);
      let answerRaw = "";
      for await (const chunk of inference.stream(envelope, controller.signal)) {
        if (controller.signal.aborted) throw new Error("Chat request cancelled.");
        // Reasoning is isolated with zero authority: never yielded to the UI as authoritative text
        // and never passed to the structured-action parser.
        if (chunk.channel !== "answer") continue;
        answerRaw += chunk.text;
        if (answerRaw.length > 100_000) throw new Error("Provider response exceeds the V1 size limit.");
        yield chunk.text;
      }
      const split = splitProviderProposals(answerRaw);
      const message = await this.mutate((state) => {
        const current = find(state.conversations, conversationId, "Conversation");
        const stored: ChatMessageV1 = {
          id: this.ports.ids.next("message"),
          role: "assistant",
          content: required(split.body, "Provider response", 100_000),
          createdAt: this.ports.clock.now(),
          providerId: endpointId,
        };
        current.messages.push(stored);
        current.updatedAt = stored.createdAt;
        this.activity(state, "chat", "message.assistant", `Brain endpoint response stored (${endpointId}).`, conversationId);
        if (split.malformed) this.activity(state, "failure", "proposal.discard", `${split.malformed} malformed provider proposal(s) discarded.`, conversationId, "failed");
        return structuredClone(stored);
      });
      const proposedActions: AgentActionV1[] = [];
      const proposedMemories: MemoryV1[] = [];
      for (const proposal of split.actions) {
        try {
          proposedActions.push((await this.proposeAction(
            required(proposal.capabilityId, "Proposed capability", 200),
            proposal.input && typeof proposal.input === "object" && !Array.isArray(proposal.input) ? proposal.input as Record<string, unknown> : {},
            { origin: "provider-proposal", conversationId },
          )).action);
        } catch {
          await this.mutate((state) => { this.activity(state, "failure", "proposal.reject", "A provider action proposal failed validation and was rejected.", conversationId, "denied"); });
        }
      }
      for (const proposal of split.memories) {
        try {
          proposedMemories.push(await this.createMemory({
            content: required(proposal.content, "Proposed memory", 20_000),
            category: MEMORY_CATEGORIES.includes(proposal.category as MemoryV1["category"]) ? proposal.category as MemoryV1["category"] : "semantic",
            confirmation: "unconfirmed",
            sourceRef: `conversation:${conversationId}`,
          }));
        } catch {
          await this.mutate((state) => { this.activity(state, "failure", "proposal.reject", "A provider memory proposal failed validation and was rejected.", conversationId, "denied"); });
        }
      }
      return { message, proposedActions, proposedMemories };
    } catch (error) {
      const detail = redactInferenceDetail(error instanceof Error ? error.message : error);
      await this.mutate((state) => { this.activity(state, "failure", "chat.failed", `Chat request failed or was cancelled; private content omitted. ${detail}`, conversationId, "failed"); });
      throw error instanceof Error ? error : new Error(detail);
    } finally {
      this.controllers.delete(`chat:${conversationId}`);
    }
  }
  /**
   * The binding routing decision for one chat turn.
   *
   * Uses the Brain router as selector plus policy authority. decision.endpoint is the endpoint
   * that will actually execute — it is not discarded.
   *
   * Compatibility: legacy settings.providerId remains a non-destructive selection signal. When it
   * names a fixed non-floor provider port, that selection is the binding subject and still passes
   * through brain vetoes (Local Only, offline). When it names the deterministic floor, routeRequest
   * chooses among registered Brain endpoints so a configured local/owner endpoint can become the
   * real Chat path.
   */
  #routeChat(state: AssistantStateV1, conversation: ConversationV1): RoutingDecisionV1 {
    const workspace = requireWorkspace(state.workspaces, conversation.workspace);
    const memoryIncluded = conversation.memoryContextEnabled && state.memories.some((item) => item.enabled && item.workspace === conversation.workspace);
    const request = {
      workspace: workspace.id,
      workspaceLabel: workspace.label,
      needs: ["conversation"] as const,
      includesMemory: memoryIncluded,
      includesWorkOrCustomerInformation: workspace.kind === "work",
      contextClasses: ["this conversation", ...(memoryIncluded ? ["enabled Memory records for this workspace"] : [])],
    };
    const provider = this.ports.providers.find((item) => item.id === state.settings.providerId);
    const legacyNonFloor = provider
      && provider.id !== "deterministic"
      && provider.id !== OFFLINE_ENDPOINT_ID;
    if (legacyNonFloor) {
      const endpoint = state.brain.endpoints.find((entry) => entry.id === provider.id)
        ?? endpointForProvider(provider, state.settings.model, this.ports.clock.now());
      return routeSelectedProvider(state.brain, endpoint, request);
    }
    return routeRequest(state.brain, request);
  }
  /**
   * What would leave the machine if this conversation were continued right now. The Command Center
   * shows this before the owner types, so a disclosure is never something they meet mid-sentence.
   */
  async chatDisclosure(conversationId: string): Promise<RoutingDecisionV1> {
    const state = await this.snapshot();
    const conversation = find(state.conversations, conversationId, "Conversation");
    return this.#routeChat(state, conversation);
  }
  async sendMessage(conversationId: string, content: string): Promise<ChatTurnV1> {
    const turn = this.streamMessage(conversationId, content);
    for (;;) { const step = await turn.next(); if (step.done) return step.value; }
  }
  cancelChat(conversationId: string): boolean { const controller = this.controllers.get(`chat:${conversationId}`); if (!controller) return false; controller.abort(); return true; }

  async createMemory(input: { content: string; category: MemoryV1["category"]; confirmation?: MemoryV1["confirmation"]; sourceRef?: string }): Promise<MemoryV1> {
    return this.mutate((state) => { const at = this.ports.clock.now(); const memory: MemoryV1 = { id: this.ports.ids.next("memory"), workspace: state.settings.activeWorkspace, content: required(input.content, "Memory", 20_000), category: input.category, confirmation: input.confirmation ?? "owner-confirmed", conflict: "none", enabled: true, createdAt: at, updatedAt: at, sourceTimestamp: at, provenance: { sourceType: input.confirmation === "unconfirmed" ? "provider-proposal" : "owner", sourceRef: required(input.sourceRef ?? "owner-entry", "Memory source", 500), recordedAt: at }, corrections: [] }; state.memories.unshift(memory); this.activity(state, "memory", "memory.create", `Memory ${memory.confirmation} created.`, memory.id); return structuredClone(memory); });
  }
  /** Search never crosses the workspace boundary; pass an explicit workspace to look elsewhere. */
  async searchMemories(query: string, workspace?: WorkspaceIdV1): Promise<MemoryV1[]> { const needle = required(query, "Memory query", 500).toLocaleLowerCase(); const state = await this.snapshot(); const scope = requireWorkspace(state.workspaces, workspace ?? state.settings.activeWorkspace).id; return state.memories.filter((item) => item.enabled && item.workspace === scope && `${item.category} ${item.content}`.toLocaleLowerCase().includes(needle)); }
  async correctMemory(id: string, content: string, reason: string): Promise<void> { await this.mutate((state) => { const item = find(state.memories, id, "Memory"); const next = required(content, "Memory correction", 20_000); const at = this.ports.clock.now(); item.corrections.push({ at, previousContent: item.content, correctedContent: next, reason: required(reason, "Correction reason", 500) }); item.content = next; item.confirmation = "owner-confirmed"; item.updatedAt = at; this.activity(state, "memory", "memory.correct", "Memory corrected with prior content preserved in history.", id); }); }
  async setMemoryEnabled(id: string, enabled: boolean): Promise<void> { await this.mutate((state) => { const item = find(state.memories, id, "Memory"); item.enabled = enabled; item.updatedAt = this.ports.clock.now(); this.activity(state, "memory", enabled ? "memory.enable" : "memory.disable", `Memory ${enabled ? "enabled" : "disabled"}.`, id); }); }
  async forgetMemory(id: string): Promise<void> { await this.mutate((state) => { find(state.memories, id, "Memory"); state.memories = state.memories.filter((item) => item.id !== id); this.activity(state, "memory", "memory.forget", "Memory content and correction history deleted.", id); }); }
  async acceptMemory(id: string): Promise<void> { await this.mutate((state) => { const item = find(state.memories, id, "Memory"); if (item.confirmation === "owner-confirmed") throw new Error("Memory is already owner-confirmed."); item.confirmation = "owner-confirmed"; item.updatedAt = this.ports.clock.now(); this.activity(state, "memory", "memory.accept", "Owner confirmed a previously unconfirmed memory.", id); }); }
  async exportMemories(): Promise<string> { const state = await this.snapshot(); return JSON.stringify({ version: "aion.memory-export.v1", exportedAt: this.ports.clock.now(), memories: state.memories }, null, 2); }
  /** Complete local export of everything AION holds, for owner portability and inspection. */
  async exportState(): Promise<string> { const state = await this.snapshot(); await this.mutate((draft) => { this.activity(draft, "export", "state.export", "Complete local state exported in plaintext at owner request.", null); }); return JSON.stringify({ version: "aion.local-export.v1", exportedAt: this.ports.clock.now(), state }, null, 2); }
  /**
   * Records that the owner ran one allow-listed Career command. Only the command name and outcome
   * are stored; no Career content, path, or document body enters ordinary activity history.
   */
  async recordCareerActivity(command: string, outcome: ActivityV1["outcome"], detail: string): Promise<void> {
    if (!CAREER_COMMANDS.includes(command)) throw new Error("Career command is not allow-listed.");
    await this.mutate((state) => { this.activity(state, "career", `career.${command}`, `Career ${command} ${outcome} via the accepted Career engine. ${required(detail, "Career detail", 300)}`, null, outcome); });
  }

  async createTask(input: { title: string; description?: string; priority?: TaskV1["priority"]; dueAt?: string | null; tags?: string[]; planId?: string | null; routineId?: string | null; provenance?: TaskV1["provenance"] }): Promise<TaskV1> {
    return this.mutate((state) => { const at = this.ports.clock.now(); const task: TaskV1 = { id: this.ports.ids.next("task"), workspace: state.settings.activeWorkspace, title: required(input.title, "Task title", 500), description: input.description ? required(input.description, "Task description", 10_000) : "", priority: input.priority ?? "normal", state: "ready", dueAt: iso(input.dueAt, "Task due date"), tags: unique(input.tags ?? [], "Task tags"), planId: input.planId ?? null, routineId: input.routineId ?? null, createdAt: at, completedAt: null, provenance: input.provenance ?? { sourceType: "owner", sourceRef: "owner-entry", recordedAt: at }, history: [{ at, actor: "owner", change: "created:ready" }] }; state.tasks.unshift(task); this.activity(state, "task", "task.create", "Task created.", task.id); return structuredClone(task); });
  }
  async updateTask(id: string, change: { title?: string; description?: string; priority?: TaskV1["priority"]; dueAt?: string | null; tags?: string[] }): Promise<void> { await this.mutate((state) => { const task = find(state.tasks, id, "Task"); if (change.title !== undefined) task.title = required(change.title, "Task title", 500); if (change.description !== undefined) task.description = change.description ? required(change.description, "Task description", 10_000) : ""; if (change.priority !== undefined) task.priority = change.priority; if (change.dueAt !== undefined) task.dueAt = iso(change.dueAt, "Task due date"); if (change.tags !== undefined) task.tags = unique(change.tags, "Task tags"); task.history.push({ at: this.ports.clock.now(), actor: "owner", change: "edited" }); this.activity(state, "task", "task.update", "Task updated.", id); }); }
  async transitionTask(id: string, next: TaskStateV1, reason = "owner transition"): Promise<void> { await this.mutate((state) => { const task = find(state.tasks, id, "Task"); if (!TASK_TRANSITIONS[task.state].includes(next)) throw new Error(`Task transition ${task.state} -> ${next} is invalid.`); const at = this.ports.clock.now(); task.state = next; task.completedAt = next === "completed" ? at : null; task.history.push({ at, actor: "owner", change: `${next}:${required(reason, "Task transition reason", 500)}` }); this.activity(state, "task", `task.${next}`, `Task moved to ${next}.`, id); }); }

  async createRoutine(input: { name: string; instructions: string; intervalMinutes: number; capabilityIds?: string[]; approvalPolicy?: RoutineV1["approvalPolicy"] }): Promise<RoutineV1> {
    return this.mutate((state) => { if (!Number.isSafeInteger(input.intervalMinutes) || input.intervalMinutes < 1 || input.intervalMinutes > 525_600) throw new Error("Routine interval is invalid."); const at = this.ports.clock.now(); const capabilityIds = unique(input.capabilityIds ?? [], "Routine capabilities"); for (const id of capabilityIds) if (!this.ports.capabilities.get(id)) throw new Error("Routine requires an unknown capability."); const routine: RoutineV1 = { id: this.ports.ids.next("routine"), workspace: state.settings.activeWorkspace, name: required(input.name, "Routine name", 500), instructions: required(input.instructions, "Routine instructions", 10_000), enabled: true, intervalMinutes: input.intervalMinutes, nextRunAt: new Date(Date.parse(at) + input.intervalMinutes * 60_000).toISOString(), lastRunAt: null, capabilityIds, approvalPolicy: input.approvalPolicy ?? "capability-default", createdAt: at, history: [{ at, actor: "owner", change: "created:enabled" }] }; state.routines.unshift(routine); this.activity(state, "routine", "routine.create", "Routine created and scheduled while AION is running.", routine.id); return structuredClone(routine); });
  }
  async updateRoutine(id: string, change: { enabled?: boolean; intervalMinutes?: number }): Promise<void> { await this.mutate((state) => { const routine = find(state.routines, id, "Routine"); if (change.intervalMinutes !== undefined) { if (!Number.isSafeInteger(change.intervalMinutes) || change.intervalMinutes < 1 || change.intervalMinutes > 525_600) throw new Error("Routine interval is invalid."); routine.intervalMinutes = change.intervalMinutes; } if (change.enabled !== undefined) routine.enabled = change.enabled; const at = this.ports.clock.now(); routine.nextRunAt = routine.enabled ? new Date(Date.parse(at) + routine.intervalMinutes * 60_000).toISOString() : null; routine.history.push({ at, actor: "owner", change: `updated:${routine.enabled ? "enabled" : "disabled"}` }); this.activity(state, "routine", "routine.update", "Routine schedule updated.", id); }); }
  async runRoutine(id: string, reason: "manual" | "scheduled" = "manual"): Promise<void> { await this.mutate((state) => { const routine = find(state.routines, id, "Routine"); if (reason === "scheduled" && !routine.enabled) return; const at = this.ports.clock.now(); routine.lastRunAt = at; routine.nextRunAt = routine.enabled ? new Date(Date.parse(at) + routine.intervalMinutes * 60_000).toISOString() : null; routine.history.push({ at, actor: "aion", change: `run:${reason}` }); this.activity(state, "routine", "routine.run", `Routine ran locally (${reason}); ${routine.capabilityIds.length} capability proposal(s).`, id); }); }
  /**
   * The ordinary tick. Routine scheduling is gated on the owner's setting; GPU stop conditions are
   * not, because a rented instance costs money whether or not the scheduler is switched on.
   *
   * Readiness is advanced here too, and for the same reason. A session left in `booting-runtime`
   * with nobody watching would otherwise sit paying until its allowance ran out, then be stopped
   * having achieved nothing — bounded, but expensively so. Each check re-reads the stop conditions
   * first, so this can only ever end a session earlier than the deadline, never later.
   */
  async tick(): Promise<number> {
    await this.enforceGpuLimits();
    if (this.ports.gpu) {
      for (const session of (await this.snapshot()).gpuSessions.filter((entry) => isActivatingSession(entry.state))) {
        await this.pollGpuReadiness(session.id).catch(() => {});
      }
    }
    // Bounded proactive executive cycle — at most once per hour; never blocks routines.
    await this.maybeRunScheduledExecutiveCycle().catch(() => {});
    const state = await this.snapshot();
    if (!state.settings.schedulerEnabled) return 0;
    const now = Date.parse(this.ports.clock.now());
    const due = state.routines.filter((item) => item.enabled && item.nextRunAt && Date.parse(item.nextRunAt) <= now);
    for (const routine of due) await this.runRoutine(routine.id, "scheduled");
    return due.length;
  }

  /**
   * Rate-limited executive cycle for the existing tick/startup path.
   * Min interval 60 minutes. Safe capabilities only (already enforced inside the cycle).
   */
  async maybeRunScheduledExecutiveCycle(minIntervalMs = 60 * 60_000): Promise<ExecutiveCycleResultV1 | null> {
    const state = await this.snapshot();
    const last = state.executive?.lastCycleResult?.completedAt;
    const now = Date.parse(this.ports.clock.now());
    if (last && now - Date.parse(last) < minIntervalMs) return null;
    return this.runExecutiveCycle({});
  }

  /** Morning / “What needs me?” with delta since last briefing (no spam of unchanged items). */
  async prepareProactiveBrief(): Promise<{
    reply: string;
    board: AttentionBoardV1;
    cycle: ExecutiveCycleResultV1 | null;
  }> {
    // Prefer full morning cycle when no morning brief today
    const state0 = await this.snapshot();
    const day = this.ports.clock.now().slice(0, 10);
    if (!state0.executive?.lastMorningCycleAt?.startsWith(day)) {
      const morning = await this.runMorningExecutiveCycle({});
      return { reply: morning.reply, board: morning.board, cycle: morning.cycle };
    }
    const state = await this.snapshot();
    const board = await this.attentionBoard();
    const cycle = state.executive?.lastCycleResult ?? null;
    const lastBrief = state.executive?.lastBriefingAt;
    const now = this.ports.clock.now();
    const commits = (state.executive?.commitments ?? []).filter(
      (c) => c.status === "overdue" || c.status === "due_soon",
    );
    const newJobs =
      cycle && (!lastBrief || cycle.completedAt > lastBrief)
        ? (state.executive?.autonomyJobs ?? []).filter(
            (j) => j.state === "COMPLETED" && (!lastBrief || (j.completedAt || "") > lastBrief),
          )
        : [];
    const deltaLines: string[] = [];
    if (lastBrief) {
      deltaLines.push(`Since last briefing (${lastBrief.slice(0, 16)}):`);
      if (cycle && cycle.completedAt > lastBrief) {
        deltaLines.push(
          `  • Executive cycle: +${cycle.jobsCompleted} done, ${cycle.jobsOwnerRequired} need Owner, ${cycle.changesDetected} change(s)`,
        );
      }
      if (newJobs.length) {
        deltaLines.push(...newJobs.slice(0, 5).map((j) => `  • AION completed: ${j.capability} — ${(j.result || "").slice(0, 80)}`));
      } else if (!cycle || cycle.completedAt <= lastBrief) {
        deltaLines.push("  • No new AION completions since last briefing.");
      }
      if (commits.length) {
        deltaLines.push(`  • Commitments due/overdue: ${commits.length}`);
      }
    } else {
      deltaLines.push("First briefing this session — full queue below.");
    }
    await this.mutate((d) => {
      if (!d.executive) d.executive = emptyExecutiveState(now);
      d.executive.lastBriefingAt = now;
      return null;
    });
    const reply = [
      "PROACTIVE EXECUTIVE BRIEF",
      "",
      ...deltaLines,
      "",
      ...board.briefingLines,
      "",
      commits.length
        ? `COMMITMENTS:\n${commits.slice(0, 5).map((c) => `  • [${c.status}] ${c.committedBy}→${c.committedTo}: ${c.statement}`).join("\n")}`
        : "COMMITMENTS: none due/overdue.",
      "",
      cycle
        ? `AION last cycle: ${cycle.aionCompleted.slice(0, 3).join("; ") || "quiet"} · unauth external: ${cycle.unauthorizedExternalAttempts}`
        : "AION: no cycle yet — will run on next tick or “run executive cycle”.",
    ].join("\n");
    return { reply, board, cycle };
  }

  /**
   * First genuinely useful proactive daily cycle.
   * Runs bounded executive work, then surfaces only changed/high-value sections.
   * scope=work keeps dealership-only; scope=all aggregates without mixing records into each other.
   */
  async runMorningExecutiveCycle(opts: {
    scope?: "all" | "work" | "personal" | "business";
    skipCycle?: boolean;
  } = {}): Promise<{
    reply: string;
    brief: MorningExecutiveBriefV1;
    board: AttentionBoardV1;
    cycle: ExecutiveCycleResultV1 | null;
    dealership: DealershipMorningAssistV1 | null;
  }> {
    const scope = opts.scope ?? "all";
    let cycle: ExecutiveCycleResultV1 | null = null;
    if (!opts.skipCycle) {
      cycle = await this.runExecutiveCycle({}).catch(() => null);
    }
    await this.refreshOpportunityRadar().catch(() => []);
    const state = await this.snapshot();
    const now = this.ports.clock.now();
    const boardFilter =
      scope === "work"
        ? { workspace: "work" as const }
        : scope === "personal"
          ? { workspace: "personal" as const }
          : undefined;
    const board = await this.attentionBoard(boardFilter);
    const commits = state.executive?.commitments ?? [];
    const opps = state.executive?.opportunities ?? [];
    const stalls = detectDealStallSignals({
      relationships: state.relationships,
      nowIso: now,
      commitments: commits,
      opportunities: opps,
      ...(scope === "work" ? { workspace: "work" } : {}),
    });
    const brands = state.workspaces
      .filter((w) => w.kind === "business" && !w.archived && !isTestOrE2eWorkspace(w))
      .map((w) => w.brand?.name || w.label);
    const brief = buildMorningExecutiveBrief({
      nowIso: now,
      board,
      commitments: commits,
      opportunities: opps,
      stalls,
      cycle: cycle ?? state.executive?.lastCycleResult ?? null,
      lastBriefingAt: state.executive?.lastBriefingAt ?? null,
      brandLabels: brands,
      scope,
    });
    let dealership: DealershipMorningAssistV1 | null = null;
    if (scope === "all" || scope === "work") {
      dealership = await this.dealershipMorningAssist();
    }
    await this.mutate((d) => {
      if (!d.executive) d.executive = emptyExecutiveState(now);
      d.executive.lastBriefingAt = now;
      d.executive.lastMorningCycleAt = now;
      return null;
    });
    const reply = [
      brief.reply,
      "",
      dealership && (scope === "all" || scope === "work")
        ? ["---", dealership.reply].join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    return { reply, brief, board, cycle, dealership };
  }

  async dealershipMorningAssist(): Promise<DealershipMorningAssistV1> {
    const state = await this.snapshot();
    const now = this.ports.clock.now();
    const inv = this.vehicleInv(state);
    const opps = state.executive?.opportunities?.length
      ? state.executive.opportunities
      : await this.refreshOpportunityRadar().catch(() => []);
    const changeSummaries: string[] = [];
    const sig = state.executive?.lastCycleResult;
    if (sig) {
      changeSummaries.push(
        ...sig.audit.filter((a) => /inventory|price|vin|change/i.test(a)).slice(0, 6),
      );
      if (sig.changesDetected) changeSummaries.push(`${sig.changesDetected} change event(s) in last cycle`);
    }
    const researchNotes = (state.executive?.temporalFacts ?? [])
      .filter((f) => f.workspace === "work" && /research|draft|recall/i.test(f.category + f.title))
      .slice(0, 5)
      .map((f) => `${f.title}: ${f.content.slice(0, 80)}`);
    return buildDealershipMorningAssist({
      nowIso: now,
      relationships: state.relationships.filter((r) => r.workspace === "work"),
      commitments: (state.executive?.commitments ?? []).filter((c) => c.workspace === "work"),
      opportunities: opps,
      vehicles: inv.vehicles,
      changeSummaries,
      researchNotes,
    });
  }

  async prepareCustomerCard(name: string): Promise<CustomerPrepCardV1> {
    const state = await this.snapshot();
    const now = this.ports.clock.now();
    // Respect active workspace isolation for candidates; also allow work when name is dealership-flavored
    const active = state.settings.activeWorkspace;
    let candidates = state.relationships.filter((r) => !r.archived && r.workspace === active);
    if (active !== "work") {
      // "Prepare me for John" from personal should not pull work CRM unless Owner is in work context
      // — isolation preserved.
    } else {
      candidates = state.relationships.filter((r) => !r.archived && r.workspace === "work");
    }
    const opps = state.executive?.opportunities?.length
      ? state.executive.opportunities
      : await this.refreshOpportunityRadar().catch(() => []);
    const stalls = detectDealStallSignals({
      relationships: candidates,
      nowIso: now,
      commitments: state.executive?.commitments ?? [],
      opportunities: opps,
      workspace: active === "work" ? "work" : active,
    });
    return buildCustomerPrepCard({
      queryName: name.trim(),
      candidates,
      nowIso: now,
      commitments: state.executive?.commitments ?? [],
      opportunities: opps,
      vehicles: this.vehicleInv(state).vehicles,
      stalls,
      recentFacts: (state.executive?.temporalFacts ?? []).filter((f) => f.temporalStatus === "CURRENT").slice(0, 50),
    });
  }

  async realUsageMetrics(): Promise<RealUsageMetricsV1> {
    const state = await this.snapshot();
    return aggregateUsageMetrics({
      captureFriction: state.executive?.captureFriction,
      correctionCount: state.executive?.captureFriction?.corrections ?? 0,
      falseMatchCount: state.executive?.captureFriction?.falseMatches ?? 0,
      briefingDismissed: state.executive?.captureFriction?.briefingDismissed ?? 0,
      opportunitiesActed: state.executive?.captureFriction?.opportunitiesActed ?? 0,
      jobs: state.executive?.autonomyJobs ?? [],
      ledger: state.executive?.valueLedger ?? [],
      cycle: state.executive?.lastCycleResult,
    });
  }

  async recordOwnerCorrection(input: {
    kind: "person" | "workspace" | "fact" | "relationship" | "category";
    fromValue: string;
    toValue: string;
    workspace?: string;
    notes?: string;
  }) {
    return this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      const now = this.ports.clock.now();
      const ws = input.workspace || draft.settings.activeWorkspace;
      draft.executive.correctionPatterns = recordCorrectionPattern(draft.executive.correctionPatterns, {
        kind: input.kind,
        fromValue: input.fromValue,
        toValue: input.toValue,
        workspace: ws,
        now,
        id: this.ports.ids.next("corr"),
        ...(input.notes ? { notes: input.notes } : {}),
      });
      draft.executive.captureFriction.corrections += 1;
      this.activity(
        draft,
        "settings",
        "correction.learn",
        `Correction ${input.kind}: "${input.fromValue}" → "${input.toValue}" (${ws})`,
        null,
      );
      return draft.executive.correctionPatterns[0];
    });
  }

  async createPlan(goal: string, steps: Array<{ title: string; description?: string; dependencies?: number[]; requiredCapabilities?: string[]; approvalRequired?: boolean; expectedOutput?: string }>): Promise<PlanV1> {
    return this.mutate((state) => { if (!steps.length || steps.length > 100) throw new Error("Plan requires 1-100 steps."); const planId = this.ports.ids.next("plan"); const stepIds = steps.map(() => this.ports.ids.next("plan-step")); const plan: PlanV1 = { id: planId, workspace: state.settings.activeWorkspace, goal: required(goal, "Plan goal", 2000), status: "proposed", createdAt: this.ports.clock.now(), provenance: { sourceType: "owner", sourceRef: "owner-plan", recordedAt: this.ports.clock.now() }, steps: steps.map((step, index) => { const dependencies = (step.dependencies ?? []).map((dependency) => { if (!Number.isSafeInteger(dependency) || dependency < 0 || dependency >= index) throw new Error("Plan dependencies must point to earlier steps."); return stepIds[dependency]!; }); const capabilities = unique(step.requiredCapabilities ?? [], "Plan capabilities"); for (const capability of capabilities) if (!this.ports.capabilities.get(capability)) throw new Error("Plan requires an unknown capability."); return { id: stepIds[index]!, order: index + 1, title: required(step.title, "Plan step title", 500), description: step.description ? required(step.description, "Plan step description", 5000) : "", dependencies, requiredCapabilities: capabilities, approvalRequired: step.approvalRequired ?? capabilities.some((id) => this.ports.capabilities.get(id)?.approval !== "never"), expectedOutput: required(step.expectedOutput ?? "Completed step", "Expected output", 1000), status: "proposed", blockedReason: null, taskId: null }; }) }; state.plans.unshift(plan); this.activity(state, "plan", "plan.create", "Reviewable plan proposal created; no execution authority granted.", plan.id, "pending"); return structuredClone(plan); });
  }
  async acceptPlan(id: string): Promise<void> { await this.mutate((state) => { const plan = find(state.plans, id, "Plan"); if (plan.status !== "proposed") throw new Error("Only proposed plans can be accepted."); plan.status = "accepted"; for (const step of plan.steps) step.status = "accepted"; this.activity(state, "plan", "plan.accept", "Plan accepted for reviewable task conversion.", id); }); }
  async convertPlanToTasks(id: string): Promise<TaskV1[]> { const snap = await this.snapshot(); const plan = find(snap.plans, id, "Plan"); if (plan.status !== "accepted") throw new Error("Plan must be accepted before task conversion."); const created: TaskV1[] = []; for (const step of plan.steps.filter((item) => !item.taskId)) created.push(await this.createTask({ title: step.title, description: step.description, planId: id, provenance: { sourceType: "plan", sourceRef: id, recordedAt: this.ports.clock.now() } })); await this.mutate((state) => { const current = find(state.plans, id, "Plan"); for (const [index, step] of current.steps.filter((item) => !item.taskId).entries()) { step.taskId = created[index]?.id ?? null; step.status = "converted"; } this.activity(state, "plan", "plan.convert", `${created.length} plan step(s) converted to Tasks.`, id); }); return created; }

  /**
   * Validates a proposal and, when policy requires it, opens exactly one approval bound to the
   * exact capability and input digest. Proposing never executes anything, and a provider-origin
   * proposal is treated identically to an owner one: it earns no extra authority.
   */
  async proposeAction(capabilityId: string, input: Record<string, unknown>, origin: { origin?: AgentActionV1["origin"]; conversationId?: string | null } = {}): Promise<{ action: AgentActionV1; approval: ApprovalV1 | null }> {
    return this.mutate((state) => { const capability = this.ports.capabilities.get(capabilityId); if (!capability) throw new Error("Capability is not registered."); capability.validate(input); const at = this.ports.clock.now(); const digest = digestValue({ capabilityId, input }); const needsApproval = capability.approval !== "never" || state.settings.externalActionsRequireApproval; const action: AgentActionV1 = { id: this.ports.ids.next("action"), capabilityId, conversationId: origin.conversationId ?? null, origin: origin.origin ?? "owner", input: structuredClone(input), inputDigest: digest, privacy: capability.privacy, state: needsApproval ? "awaiting-approval" : "validated", createdAt: at, updatedAt: at, retryCount: 0, maxRetries: capability.maxRetries, result: null, error: null }; state.actions.unshift(action); let approval: ApprovalV1 | null = null; if (needsApproval) { approval = { id: this.ports.ids.next("approval"), actionId: action.id, capabilityId, summary: capability.summarize(input), inputDigest: digest, state: "pending", requestedAt: at, expiresAt: new Date(Date.parse(at) + 60 * 60_000).toISOString(), decidedAt: null, result: null }; state.approvals.unshift(approval); } this.activity(state, "agent", "action.propose", `${action.origin} proposal validated for ${capabilityId}.`, action.id, needsApproval ? "pending" : "success"); return { action: structuredClone(action), approval: approval ? structuredClone(approval) : null }; });
  }
  async decideApproval(id: string, approve: boolean): Promise<void> { await this.mutate((state) => { const approval = find(state.approvals, id, "Approval"); if (approval.state !== "pending") throw new Error("Approval is no longer pending."); const action = find(state.actions, approval.actionId, "Agent action"); const at = this.ports.clock.now(); if (Date.parse(approval.expiresAt) <= Date.parse(at)) { approval.state = "expired"; action.state = "cancelled"; } else { approval.state = approve ? "approved" : "denied"; action.state = approve ? "approved" : "cancelled"; } approval.decidedAt = at; this.activity(state, "approval", approve ? "approval.approve" : "approval.deny", approve ? "Exact action approved once." : "Action denied.", approval.id, approve ? "success" : "denied"); }); }
  async executeAction(id: string): Promise<Record<string, unknown>> {
    const state = await this.snapshot(); const action = find(state.actions, id, "Agent action"); const capability = this.ports.capabilities.get(action.capabilityId); if (!capability) throw new Error("Capability is no longer registered."); const approval = state.approvals.find((item) => item.actionId === id);
    if (approval) { if (approval.state !== "approved" || approval.inputDigest !== action.inputDigest || digestValue({ capabilityId: action.capabilityId, input: action.input }) !== action.inputDigest) throw new Error("Exact one-shot approval is unavailable."); }
    else if (action.state !== "validated") throw new Error("Action is not executable.");
    const controller = new AbortController(); this.controllers.set(`action:${id}`, controller);
    await this.mutate((draft) => { const current = find(draft.actions, id, "Agent action"); current.state = "running"; current.updatedAt = this.ports.clock.now(); if (approval) find(draft.approvals, approval.id, "Approval").state = "consumed"; this.activity(draft, "agent", "action.run", "Bounded capability execution started.", id, "pending"); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Capability timeout.")); }, capability.timeoutMs); });
      const result = await Promise.race([capability.execute(action.input, { clock: this.ports.clock, ids: this.ports.ids }, controller.signal), timeout]);
      await this.mutate((draft) => { const current = find(draft.actions, id, "Agent action"); current.state = "succeeded"; current.updatedAt = this.ports.clock.now(); current.result = structuredClone(result); this.activity(draft, "agent", "action.succeed", "Bounded capability succeeded.", id); });
      // Evidence can only originate from a capability that actually ran. There is deliberately no
      // path for a caller to submit a verification record directly, so a result cannot be forged.
      if (action.capabilityId === VERIFICATION_CAPABILITY_ID) await this.#recordVerification(result as unknown as Omit<VerificationRunV1, "id">);
      return result;
    } catch (error) { await this.mutate((draft) => { const current = find(draft.actions, id, "Agent action"); current.state = controller.signal.aborted ? "cancelled" : "failed"; current.updatedAt = this.ports.clock.now(); current.error = "Capability execution failed; private details omitted."; this.activity(draft, "failure", "action.fail", current.error, id, "failed"); }); throw error; }
    finally { if (timer) clearTimeout(timer); this.controllers.delete(`action:${id}`); }
  }
  cancelAction(id: string): boolean { const controller = this.controllers.get(`action:${id}`); if (!controller) return false; controller.abort(); return true; }

  async dryRunImport(platform: ImportReportV1["platform"], selectedRoot: string, selectedPath: string): Promise<ImportReportV1> {
    const state = await this.snapshot(); const known = state.imports.flatMap((report) => report.items.map((item) => item.digest).filter(Boolean)); const result = await this.ports.importer.dryRun({ platform, selectedRoot, selectedPath, knownDigests: known });
    return this.mutate((draft) => { const report: ImportReportV1 = { id: this.ports.ids.next("import"), platform, state: "dry-run", selectedRootRef: result.selectedRootRef, createdAt: this.ports.clock.now(), items: result.items, importedConversationIds: [], warnings: result.warnings }; draft.imports.unshift(report); this.activity(draft, "import", "import.dry-run", `Dry run inventoried ${report.items.length} file(s); no source changed.`, report.id); return structuredClone(report); });
  }
  async importConversations(reportId: string, selectedRoot: string, selectedPath: string): Promise<ImportReportV1> {
    const snap = await this.snapshot(); const prior = find(snap.imports, reportId, "Import report"); if (prior.state !== "dry-run" || prior.platform === "career") throw new Error("A conversation dry run is required."); const result = await this.ports.importer.dryRun({ platform: prior.platform, selectedRoot, selectedPath, knownDigests: snap.imports.filter((item) => item.id !== reportId).flatMap((item) => item.items.map((entry) => entry.digest).filter(Boolean)) }); if (digestValue(result.items) !== digestValue(prior.items)) throw new Error("Import source changed after dry run; run a new dry run.");
    return this.mutate((state) => { const report = find(state.imports, reportId, "Import report"); for (const imported of result.conversations) { const at = this.ports.clock.now(); const conversation: ConversationV1 = { id: this.ports.ids.next("conversation"), workspace: state.settings.activeWorkspace, title: required(imported.title, "Imported conversation title", 500), state: "archived", memoryContextEnabled: false, createdAt: at, updatedAt: at, messages: imported.messages.map((message) => ({ id: this.ports.ids.next("message"), role: message.role, content: required(message.content, "Imported message", 100_000), createdAt: message.at && !Number.isNaN(Date.parse(message.at)) ? new Date(message.at).toISOString() : at, providerId: `import:${prior.platform}` })) }; state.conversations.push(conversation); report.importedConversationIds.push(conversation.id); } report.state = "imported"; this.activity(state, "import", "import.complete", `${report.importedConversationIds.length} conversation(s) imported with provenance.`, report.id); return structuredClone(report); });
  }
  async cancelImport(reportId: string): Promise<void> { await this.mutate((state) => { const report = find(state.imports, reportId, "Import report"); if (report.state !== "dry-run") throw new Error("Only a dry run can be cancelled."); report.state = "cancelled"; this.activity(state, "import", "import.cancel", "Import cancelled before source mutation.", report.id); }); }
  /**
   * Persists the evidence from one allowlisted verification run. Called only by `executeAction`
   * after the capability itself produced the result, so recorded evidence always corresponds to a
   * command AION actually ran under an approval.
   */
  async #recordVerification(run: Omit<VerificationRunV1, "id">): Promise<VerificationRunV1> {
    return this.mutate((state) => {
      const record: VerificationRunV1 = { id: this.ports.ids.next("verification"), ...structuredClone(run) };
      state.verifications.unshift(record);
      if (state.verifications.length > 50) state.verifications.length = 50;
      this.activity(state, "agent", "verify.run", `Allowlisted verification ${record.operationId} ${record.outcome} (exit ${record.exitCode}) in ${record.durationMs} ms.`, record.id, record.outcome === "passed" ? "success" : "failed");
      return structuredClone(record);
    });
  }
  /**
   * Turns verification evidence into a read-only developer-agent proposal.
   *
   * The agent is given the evidence AION already captured, not permission to gather it. This is
   * the whole reason the verification capability exists: analysing a failing suite needs the
   * output, not a shell. The instruction is data on standard input and is still bounded, still
   * digest-bound, and still requires its own approval.
   */
  async proposeVerificationAnalysis(verificationId: string, question = "Explain what is failing and why."): Promise<{ action: AgentActionV1; approval: ApprovalV1 | null }> {
    const state = await this.snapshot();
    const run = find(state.verifications, verificationId, "Verification run");
    const instruction = [
      `Analyse the following verification evidence that AION captured by running an allowlisted, read-only command itself. You have no shell and no write access, and you do not need them.`,
      `Operation: ${run.operationId} (${run.displayCommand})`,
      `Outcome: ${run.outcome}; exit code ${run.exitCode}${run.timedOut ? "; timed out" : ""}; duration ${run.durationMs} ms.`,
      `Question: ${required(question, "Analysis question", 500)}`,
      run.truncated ? "The evidence below is truncated to its most recent output." : "",
      "--- evidence ---",
      salientEvidence(run),
    ].filter(Boolean).join("\n").slice(0, 4000);
    return this.proposeAction("aion.developer.task.v1", { instruction, mode: "read-only" }, { origin: "owner" });
  }
  // --- Workspaces -------------------------------------------------------------------------------
  /**
   * Creates a business or brand workspace.
   *
   * A new workspace starts genuinely empty. Nothing is copied into it from Personal, from Work, or
   * from another business, because a workspace that inherited someone else's records would defeat
   * the only property that makes workspaces worth having.
   */
  async createWorkspace(input: Record<string, unknown> = {}): Promise<WorkspaceV1> {
    return this.mutate((state) => {
      const at = this.ports.clock.now();
      const workspace = buildWorkspace(input, { now: at, existing: state.workspaces });
      state.workspaces = [...state.workspaces, workspace];
      state.settings.workspaceLabels = { ...state.settings.workspaceLabels, [workspace.id]: workspace.label };
      this.activity(state, "settings", "workspace.create", `Created the ${workspace.kind} workspace "${workspace.label}". It starts empty; no record was copied into it from any other workspace.`, workspace.id);
      return structuredClone(workspace);
    });
  }
  async updateWorkspace(id: string, change: Record<string, unknown> = {}): Promise<WorkspaceV1> {
    return this.mutate((state) => {
      const existing = requireWorkspace(state.workspaces, id);
      const updated = applyWorkspaceEdit(existing, change, this.ports.clock.now());
      state.workspaces = state.workspaces.map((entry) => entry.id === id ? updated : entry);
      state.settings.workspaceLabels = { ...state.settings.workspaceLabels, [updated.id]: updated.label };
      this.activity(state, "settings", "workspace.update", `Workspace "${updated.label}" updated.`, updated.id);
      return structuredClone(updated);
    });
  }
  /**
   * Archives a workspace. Its records stay exactly where they are: archiving hides a workspace
   * from the switcher, it does not move, merge, or delete anything inside it.
   */
  async setWorkspaceArchived(id: string, archived: boolean): Promise<WorkspaceV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, id);
      if (workspace.builtIn) throw new Error("Personal and Work are always available and cannot be archived.");
      if (archived && state.settings.activeWorkspace === id) throw new Error("Switch to another workspace before archiving this one.");
      const updated = { ...workspace, archived, updatedAt: this.ports.clock.now() };
      state.workspaces = state.workspaces.map((entry) => entry.id === id ? updated : entry);
      this.activity(state, "settings", archived ? "workspace.archive" : "workspace.reactivate", `Workspace "${updated.label}" ${archived ? "archived" : "reactivated"}. Every record inside it is untouched.`, id);
      return structuredClone(updated);
    });
  }
  async addBrandProduct(workspaceId: string, input: Record<string, unknown> = {}): Promise<WorkspaceV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, workspaceId);
      if (workspace.kind !== "business" || !workspace.brand) throw new Error("Only a business or brand workspace holds products.");
      const product = buildBrandProduct(input, { id: this.ports.ids.next("product"), now: this.ports.clock.now() });
      if (workspace.brand.products.length >= 200) throw new Error("A brand may hold at most 200 products.");
      const updated: WorkspaceV1 = { ...workspace, updatedAt: this.ports.clock.now(), brand: { ...workspace.brand, products: [...workspace.brand.products, product] } };
      state.workspaces = state.workspaces.map((entry) => entry.id === workspaceId ? updated : entry);
      this.activity(state, "settings", "workspace.product", `Product "${product.name}" recorded for "${updated.label}".`, workspaceId);
      return structuredClone(updated);
    });
  }
  /** Every workspace, so the switcher can show them. Contains no record from inside any of them. */
  async workspaces(): Promise<WorkspaceV1[]> { return (await this.snapshot()).workspaces.map((entry) => structuredClone(entry)); }

  // --- Relationship Core --------------------------------------------------------------------
  /**
   * Relationship records belong to the workspace they were created in.
   *
   * Sales proved the shape in WORK, and the Sales-facing operations below still require WORK for
   * exactly the reason they always did: storing employer and customer material should be a
   * deliberate act rather than something that happens while thinking about personal life. The
   * general operations accept any workspace the owner is actually in, and neither path can read or
   * write a record belonging to a different one.
   */
  #requireWorkWorkspace(state: AssistantStateV1): void {
    if (state.settings.activeWorkspace !== "work") throw new Error("Customer records belong to the Work workspace. Switch to Work before creating or changing one.");
  }
  /** Scopes every relationship read to the active workspace. There is no cross-workspace read. */
  #scopedRelationships(state: AssistantStateV1): RelationshipV1[] {
    return state.relationships.filter((entry) => entry.workspace === state.settings.activeWorkspace);
  }
  #findRelationship(state: AssistantStateV1, id: string): RelationshipV1 {
    const found = find(state.relationships, id, "Relationship");
    assertSameWorkspace(found, state.settings.activeWorkspace, "relationship");
    return found;
  }
  /**
   * Creates a relationship in the active workspace, of the type the owner declared.
   *
   * This is the general entry point: a supplier for a side business, a professional contact, or a
   * support case are all this call with a different `relationshipType`. Nothing about it is
   * specific to selling, and it never copies a record from another workspace.
   */
  async createRelationship(input: Record<string, unknown> = {}): Promise<RelationshipV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, state.settings.activeWorkspace);
      const at = this.ports.clock.now();
      const id = this.ports.ids.next("relationship");
      // A relationship recorded while doing a job belongs to the employer unless the owner says
      // otherwise. Everywhere else the owner created it, so it is theirs.
      const relationship = buildRelationship(input, {
        id, reference: `relationship:${digestValue({ id }).slice(0, 16)}`, now: at, workspace: workspace.id,
        defaultOrigin: workspace.kind === "work" ? "employer-work" : "owner-created",
      });
      relationship.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "lifecycle", summary: `Relationship opened as ${relationship.lifecycle}.`, detail: "", lifecycleAfter: relationship.lifecycle, actor: "owner" });
      state.relationships.unshift(relationship);
      this.activity(state, "task", "relationship.create", `${relationship.relationshipType} relationship recorded in "${workspace.label}" (${relationship.origin}). No identity, credit, or banking material is stored.`, relationship.id);
      return structuredClone(relationship);
    });
  }
  /** Relationship search inside the active workspace only. */
  async findRelationships(query: RelationshipQueryV1): Promise<RelationshipV1[]> {
    const state = await this.snapshot();
    return queryRelationships(this.#scopedRelationships(state), query, this.ports.clock.now());
  }
  async createCustomer(input: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const at = this.ports.clock.now();
      const id = this.ports.ids.next("customer");
      const customer = buildCustomer(input, { id, reference: `customer:${digestValue({ id }).slice(0, 16)}`, now: at, workspace: "work", relationshipType: "customer", defaultOrigin: "employer-work" });
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "lifecycle", summary: `Relationship opened as ${customer.lifecycle}.`, detail: "", lifecycleAfter: customer.lifecycle, actor: "owner" });
      state.relationships.unshift(customer);
      this.activity(state, "task", "customer.create", `Work relationship record created (${customer.origin}). No identity, credit, or banking material is stored.`, customer.id);
      return structuredClone(customer);
    });
  }
  async updateCustomer(id: string, change: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const existing = this.#findRelationship(state, id);
      const at = this.ports.clock.now();
      const updated = applyCustomerEdit(existing, change, at);
      // History is never rewritten by an edit: the timeline and links are carried across intact.
      updated.interactions = existing.interactions;
      updated.appointments = existing.appointments;
      updated.followUps = existing.followUps;
      updated.taskIds = existing.taskIds; updated.routineIds = existing.routineIds; updated.planIds = existing.planIds;
      updated.outcome = existing.outcome; updated.lifecycle = existing.lifecycle; updated.archived = existing.archived;
      updated.lastContactAt = existing.lastContactAt; updated.createdAt = existing.createdAt; updated.provenance = existing.provenance;
      state.relationships = state.relationships.map((entry) => entry.id === id ? updated : entry);
      this.activity(state, "task", "customer.update", "Work relationship record edited; the timeline was preserved.", id);
      return structuredClone(updated);
    });
  }
  /** Appends to the timeline. An interaction is never edited or removed once recorded. */
  async recordCustomerInteraction(id: string, input: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const at = this.ports.clock.now();
      const interaction = buildInteraction(input, { id: this.ports.ids.next("interaction"), now: at });
      customer.interactions.push(interaction);
      if (["call", "text", "email", "visit", "appointment"].includes(interaction.kind)) customer.lastContactAt = interaction.at;
      if (interaction.lifecycleAfter) customer.lifecycle = interaction.lifecycleAfter;
      customer.updatedAt = at;
      this.activity(state, "task", "customer.interaction", `Relationship timeline appended (${interaction.kind}).`, id);
      return structuredClone(customer);
    });
  }
  /** Moves the relationship on and records why, keeping every earlier state in the timeline. */
  async setCustomerLifecycle(id: string, lifecycle: string, summary = "Owner updated the relationship state."): Promise<CustomerV1> {
    return this.recordCustomerInteraction(id, { kind: "lifecycle", summary, lifecycleAfter: lifecycle });
  }
  async addCustomerAppointment(id: string, input: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const at = this.ports.clock.now();
      const appointment = buildAppointment(input, { id: this.ports.ids.next("appointment"), now: at });
      customer.appointments.push(appointment);
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "appointment", summary: `${appointment.kind} scheduled for ${appointment.at}.`, detail: appointment.notes, lifecycleAfter: null, actor: "owner" });
      customer.updatedAt = at;
      this.activity(state, "task", "customer.appointment", `${appointment.kind} recorded for a work relationship.`, id);
      return structuredClone(customer);
    });
  }
  async setCustomerAppointmentStatus(id: string, appointmentId: string, status: string): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const appointment = find(customer.appointments, appointmentId, "Appointment");
      const allowed = ["scheduled", "confirmed", "shown", "no-show", "rescheduled", "cancelled"];
      if (!allowed.includes(status)) throw new Error(`Appointment status must be one of: ${allowed.join(", ")}.`);
      const at = this.ports.clock.now();
      appointment.status = status as CustomerAppointmentV1["status"];
      if (status === "shown") customer.lastContactAt = at;
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "appointment", summary: `Appointment marked ${status}.`, detail: "", lifecycleAfter: null, actor: "owner" });
      customer.updatedAt = at;
      this.activity(state, "task", "customer.appointment.status", `Appointment marked ${status}.`, id);
      return structuredClone(customer);
    });
  }
  async addCustomerFollowUp(id: string, input: Record<string, unknown> = {}): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const at = this.ports.clock.now();
      const followUp = buildFollowUp(input, { id: this.ports.ids.next("follow-up"), now: at });
      customer.followUps.push(followUp);
      customer.nextAction = customer.nextAction || followUp.reason;
      customer.nextActionAt = customer.nextActionAt ?? followUp.dueAt;
      customer.updatedAt = at;
      this.activity(state, "task", "customer.follow-up", "Follow-up scheduled for a work relationship.", id);
      return structuredClone(customer);
    });
  }
  async completeCustomerFollowUp(id: string, followUpId: string, outcome = "", status: "done" | "skipped" = "done"): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const followUp = find(customer.followUps, followUpId, "Follow-up");
      if (followUp.status !== "open") throw new Error("Follow-up is no longer open.");
      const at = this.ports.clock.now();
      followUp.status = status; followUp.completedAt = at; followUp.outcome = outcome.slice(0, 2000);
      if (status === "done") customer.lastContactAt = at;
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "follow-up", summary: `Follow-up ${status}.`, detail: followUp.outcome, lifecycleAfter: null, actor: "owner" });
      customer.updatedAt = at;
      this.activity(state, "task", "customer.follow-up.close", `Follow-up ${status}.`, id);
      return structuredClone(customer);
    });
  }
  async setCustomerOutcome(id: string, outcome: "open" | "sold" | "lost", detail = ""): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      if (!["open", "sold", "lost"].includes(outcome)) throw new Error("Outcome must be open, sold, or lost.");
      const at = this.ports.clock.now();
      customer.outcome = { state: outcome, at: outcome === "open" ? null : at, detail: detail.slice(0, 2000) };
      if (outcome !== "open") customer.lifecycle = outcome === "sold" ? "sold" : "lost";
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "outcome", summary: `Outcome recorded: ${outcome}.`, detail: customer.outcome.detail, lifecycleAfter: customer.lifecycle, actor: "owner" });
      customer.updatedAt = at;
      this.activity(state, "task", "customer.outcome", `Relationship outcome recorded: ${outcome}.`, id);
      return structuredClone(customer);
    });
  }
  /** Archiving hides a relationship from day-to-day views. It never deletes the timeline. */
  async setCustomerArchived(id: string, archived: boolean): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const at = this.ports.clock.now();
      customer.archived = archived; customer.updatedAt = at;
      if (archived && customer.lifecycle !== "sold" && customer.lifecycle !== "lost") customer.lifecycle = "inactive";
      customer.interactions.push({ id: this.ports.ids.next("interaction"), at, kind: "lifecycle", summary: archived ? "Relationship archived; history retained." : "Relationship reactivated.", detail: "", lifecycleAfter: customer.lifecycle, actor: "owner" });
      this.activity(state, "task", archived ? "customer.archive" : "customer.reactivate", archived ? "Work relationship archived; nothing was deleted." : "Work relationship reactivated.", id);
      return structuredClone(customer);
    });
  }
  async linkCustomerTask(id: string, taskId: string): Promise<CustomerV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      const customer = this.#findRelationship(state, id);
      const task = find(state.tasks, taskId, "Task");
      if (task.workspace !== "work") throw new Error("Only a Work task can be linked to a work relationship.");
      if (!customer.taskIds.includes(taskId)) customer.taskIds.push(taskId);
      customer.updatedAt = this.ports.clock.now();
      this.activity(state, "task", "customer.link.task", "Task linked to a work relationship.", id);
      return structuredClone(customer);
    });
  }
  /** Sales relationship search. Work-scoped by construction, as it has always been. */
  async findCustomers(query: CustomerQueryV1): Promise<CustomerV1[]> {
    const state = await this.snapshot();
    if (state.settings.activeWorkspace !== "work") throw new Error("Relationship search is only available in the Work workspace.");
    return queryCustomers(this.#scopedRelationships(state), query, this.ports.clock.now());
  }
  async customerTimeline(id: string): Promise<{ customer: CustomerV1; last: CustomerInteractionV1 | null; nextAction: { action: string; at: IsoTimestamp | null } }> {
    const state = await this.snapshot();
    const customer = this.#findRelationship(state, id);
    return { customer, last: lastInteraction(customer), nextAction: { action: customer.nextAction, at: customer.nextActionAt } };
  }

  // --- Product Studio ---------------------------------------------------------------------------
  /**
   * Product Studio operations are workspace-scoped like everything else, and every one of them
   * refuses to invent market evidence. AION can hold a hypothesis and score how well supported an
   * opportunity is; it cannot tell the owner what customers want, and does not pretend to.
   */
  #findOpportunity(state: AssistantStateV1, id: string): OpportunityV1 {
    const found = find(state.opportunities, id, "Opportunity");
    assertSameWorkspace(found, state.settings.activeWorkspace, "opportunity");
    return found;
  }
  #replaceOpportunity(state: AssistantStateV1, updated: OpportunityV1): OpportunityV1 {
    state.opportunities = state.opportunities.map((entry) => entry.id === updated.id ? updated : entry);
    return structuredClone(updated);
  }
  async createOpportunity(input: Record<string, unknown> = {}): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, state.settings.activeWorkspace);
      if (state.opportunities.length >= 500) throw new Error("AION holds at most 500 opportunities.");
      const opportunity = buildOpportunity(input, { id: this.ports.ids.next("opportunity"), workspace: workspace.id, now: this.ports.clock.now() });
      state.opportunities.unshift(opportunity);
      this.activity(state, "plan", "opportunity.create", `Opportunity "${opportunity.title}" opened in "${workspace.label}". It scores zero until something is actually established about it.`, opportunity.id);
      return structuredClone(opportunity);
    });
  }
  async updateOpportunity(id: string, change: Record<string, unknown> = {}): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const updated = applyOpportunityEdit(this.#findOpportunity(state, id), change, this.ports.clock.now());
      this.activity(state, "plan", "opportunity.update", `Opportunity "${updated.title}" updated.`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  /**
   * Records something known, assumed, or guessed about an opportunity.
   *
   * The class is required and is enforced by `knowledge.ts`: a model cannot record a fact, and a
   * class that only means something with a citation cannot be recorded without one.
   */
  async addOpportunityClaim(id: string, input: Record<string, unknown> = {}, actor: "owner" | "provider-proposal" | "research" = "owner"): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      if (opportunity.claims.length >= 500) throw new Error("An opportunity holds at most 500 claims.");
      const claim = buildClaim(input, {
        id: this.ports.ids.next("claim"), workspace: opportunity.workspace, now: this.ports.clock.now(),
        actor, sourceRef: actor === "owner" ? "owner-entry" : `${actor}:${id}`,
      });
      const updated = { ...structuredClone(opportunity), claims: [...opportunity.claims, claim], updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.claim", `Recorded a ${claim.class} on "${opportunity.title}". Its class is stored, so a guess cannot later be quoted as a finding.`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  /** Owner-only. Promotion is the moment a belief changes, and it is recorded as such. */
  async promoteOpportunityClaim(id: string, claimId: string, to: string, reason: string): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      const claim = find(opportunity.claims, claimId, "Claim");
      const promoted = promoteClaim(claim, to, reason, this.ports.clock.now());
      const updated = { ...structuredClone(opportunity), claims: opportunity.claims.map((entry) => entry.id === claimId ? promoted : entry), updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.claim.promote", `You promoted a ${claim.class} to a ${promoted.class} on "${opportunity.title}". The previous class stays in its history.`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  async supersedeOpportunityClaim(id: string, claimId: string, replacementId: string | null = null): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      const claim = find(opportunity.claims, claimId, "Claim");
      const superseded = supersedeClaim(claim, replacementId, this.ports.clock.now());
      const updated = { ...structuredClone(opportunity), claims: opportunity.claims.map((entry) => entry.id === claimId ? superseded : entry), updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.claim.supersede", "A claim is no longer believed. It is kept, disabled, and pointed at whatever replaced it.", id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  async addCompetitorNote(id: string, input: Record<string, unknown> = {}): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      const note = buildCompetitorNote(input, { id: this.ports.ids.next("competitor"), now: this.ports.clock.now() });
      const updated = { ...structuredClone(opportunity), competitors: [...opportunity.competitors, note], updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.competitor", `Competitor note recorded (${note.sourceRef}). AION did not look this up.`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  async addExperiment(id: string, input: Record<string, unknown> = {}): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      const experiment = buildExperiment(input, { id: this.ports.ids.next("experiment"), now: this.ports.clock.now() });
      if (experiment.hypothesisId) find(opportunity.claims, experiment.hypothesisId, "Hypothesis");
      const updated = { ...structuredClone(opportunity), experiments: [...opportunity.experiments, experiment], updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.experiment", `Experiment "${experiment.title}" proposed with its success criteria written down first.`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  async completeExperiment(id: string, experimentId: string, status: string, result = ""): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      const experiment = find(opportunity.experiments, experimentId, "Experiment");
      const completed = completeExperiment(experiment, status, result, this.ports.clock.now());
      const updated = { ...structuredClone(opportunity), experiments: opportunity.experiments.map((entry) => entry.id === experimentId ? completed : entry), updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.experiment.result", `Experiment "${experiment.title}" recorded as ${completed.status}. A refuted result counts the same as a supported one.`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  async setOpportunitySpecification(id: string, input: Record<string, unknown> = {}): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      const updated = { ...structuredClone(opportunity), specification: buildSpecification(input, this.ports.clock.now()), updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "opportunity.specify", `Specification written for "${opportunity.title}".`, id);
      return this.#replaceOpportunity(state, updated);
    });
  }
  /**
   * Links a Task or Plan to an opportunity, or unlinks one.
   *
   * The two checks that make this a link rather than an arbitrary write happen here, because only
   * the service can see the other collections: the referenced record must exist, and it must be in
   * the same workspace as the opportunity. Both refuse before anything is written, so a failed
   * link leaves the opportunity exactly as it was.
   *
   * Deliberately *not* reachable through `updateOpportunity`: the generic editor still refuses
   * `taskIds` and `planIds` by name, so there is no path that sets a link without these checks.
   */
  async #changeOpportunityLink(
    id: string,
    kind: OpportunityLinkKindV1,
    recordId: string,
    direction: "link" | "unlink",
  ): Promise<OpportunityV1> {
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, id);
      // Shape before existence, so a malformed reference reads as malformed rather than as a
      // record that could not be found. They are different problems with different fixes.
      if (typeof recordId !== "string" || !recordId.trim() || recordId.length > 200) {
        throw new Error(`A ${kind} reference is required, and must be an identifier of at most 200 characters.`);
      }
      if (direction === "link") {
        // Resolve against the right collection, and refuse a reference that does not resolve.
        // An unlink deliberately skips this: a reference to something already gone must still be
        // removable, or a deleted record would strand a link nobody could clear.
        const record = kind === "task"
          ? find(state.tasks, recordId, "Task")
          : find(state.plans, recordId, "Plan");
        assertSameWorkspace(record, opportunity.workspace, kind);
      }
      const result = direction === "link"
        ? linkOpportunityRecord(opportunity, kind, recordId, this.ports.clock.now())
        : unlinkOpportunityRecord(opportunity, kind, recordId, this.ports.clock.now());
      if (result.changed) {
        this.activity(state, "plan", `opportunity.${kind}.${direction}`, `${result.summary} Product Studio holds a reference; the ${kind} itself is unchanged and keeps its own history.`, id);
      }
      return this.#replaceOpportunity(state, result.opportunity);
    });
  }
  async linkOpportunityTask(id: string, taskId: string): Promise<OpportunityV1> { return this.#changeOpportunityLink(id, "task", taskId, "link"); }
  async unlinkOpportunityTask(id: string, taskId: string): Promise<OpportunityV1> { return this.#changeOpportunityLink(id, "task", taskId, "unlink"); }
  async linkOpportunityPlan(id: string, planId: string): Promise<OpportunityV1> { return this.#changeOpportunityLink(id, "plan", planId, "link"); }
  async unlinkOpportunityPlan(id: string, planId: string): Promise<OpportunityV1> { return this.#changeOpportunityLink(id, "plan", planId, "unlink"); }

  /** The honest read: the score, the arithmetic behind it, and what is still only assumed. */
  async assessOpportunity(id: string): Promise<ReturnType<typeof opportunityAssessment> & { opportunity: OpportunityV1; linkedWork: ReturnType<typeof linkedWorkSummary> }> {
    const state = await this.snapshot();
    const opportunity = this.#findOpportunity(state, id);
    return {
      ...opportunityAssessment(opportunity),
      opportunity,
      // Reported from the live records rather than from the link count, so "three tasks" cannot
      // hide "all three cancelled".
      linkedWork: linkedWorkSummary(opportunity, state.tasks, state.plans),
    };
  }
  async opportunities(): Promise<OpportunityV1[]> {
    const state = await this.snapshot();
    return state.opportunities.filter((entry) => entry.workspace === state.settings.activeWorkspace).map((entry) => structuredClone(entry));
  }

  // --- The brain: endpoints, routing policy, and evidence ---------------------------------------
  /**
   * Adds an inference endpoint the owner controls, or a third-party one they have decided to use.
   *
   * AION never discovers an endpoint and adds it silently. Detection reports what is listening at
   * a documented loopback address; turning that into a configured endpoint is an owner act.
   */
  async addBrainEndpoint(input: Record<string, unknown> = {}): Promise<BrainEndpointV1> {
    return this.mutate((state) => {
      const endpoint = buildEndpoint(input, { id: this.ports.ids.next("endpoint"), now: this.ports.clock.now(), existing: state.brain.endpoints });
      state.brain.endpoints = [...state.brain.endpoints, endpoint];
      this.activity(state, "provider", "brain.endpoint.add", `Endpoint "${endpoint.label}" added: ${endpoint.runtime} at ${endpoint.location === "local-machine" ? "this computer" : endpoint.location === "owner-controlled-host" ? `a host you control (${endpoint.hostLabel || "unlabelled"})` : "a third-party service"}, model ${endpoint.model}.${endpoint.credentialEnvironmentVariable ? ` A credential is read from ${endpoint.credentialEnvironmentVariable}; its value is never stored.` : ""}`, endpoint.id);
      return structuredClone(endpoint);
    });
  }
  async removeBrainEndpoint(id: string): Promise<void> {
    await this.mutate((state) => {
      if (id === OFFLINE_ENDPOINT_ID) throw new Error("The offline provider is AION's floor and cannot be removed. It is what keeps AION usable with every credential deleted.");
      const endpoint = find(state.brain.endpoints, id, "Endpoint");
      state.brain.endpoints = state.brain.endpoints.filter((entry) => entry.id !== id);
      if (state.brain.primaryEndpointId === id) state.brain.primaryEndpointId = OFFLINE_ENDPOINT_ID;
      if (state.brain.manualEndpointId === id) state.brain.manualEndpointId = "";
      this.activity(state, "provider", "brain.endpoint.remove", `Endpoint "${endpoint.label}" removed. Nothing AION knows was affected: a model is a reasoning provider, not where your information lives.`, id);
    });
  }
  /**
   * Changes routing policy. The two rules that make the policy worth having are enforced on the
   * way in: an endpoint that does not exist cannot be made primary, and turning on remote
   * proprietary fallback is recorded as the deliberate decision it is.
   */
  async updateBrainSettings(change: Record<string, unknown> = {}): Promise<BrainSettingsV1> {
    return this.mutate((state) => {
      const next: BrainSettingsV1 = structuredClone(state.brain);
      if (change.mode !== undefined) {
        if (!ROUTER_MODES.includes(change.mode as RouterModeV1)) throw new Error(`Routing mode must be one of: ${ROUTER_MODES.join(", ")}.`);
        next.mode = change.mode as RouterModeV1;
      }
      for (const key of ["primaryEndpointId", "manualEndpointId"] as const) {
        if (change[key] === undefined) continue;
        const id = String(change[key] ?? "");
        if (id) find(next.endpoints, id, "Endpoint");
        next[key] = id;
      }
      if (change.offlineMode !== undefined) next.offlineMode = change.offlineMode === true;
      if (change.remoteFallbackEnabled !== undefined) next.remoteFallbackEnabled = change.remoteFallbackEnabled === true;
      if (next.mode === "manual" && !next.manualEndpointId) throw new Error("Manual mode needs an endpoint. AION will not choose one for you.");
      state.brain = next;
      this.activity(state, "provider", "brain.settings", `Brain policy: ${next.mode}${next.offlineMode ? ", offline mode on — no inference leaves this computer" : ""}. Remote proprietary fallback is ${next.remoteFallbackEnabled ? "ON, so AION may propose a third-party endpoint when nothing you control can do the work" : "off, so AION will not propose a third-party endpoint on its own"}.`, null);
      return structuredClone(next);
    });
  }
  /** Records what a probe found. Health is evidence, so it is stored rather than recomputed. */
  async recordEndpointHealth(id: string, health: BrainHealthV1): Promise<BrainEndpointV1> {
    return this.mutate((state) => {
      const endpoint = find(state.brain.endpoints, id, "Endpoint");
      endpoint.lastHealth = structuredClone(health);
      this.activity(state, "provider", "brain.health", `Endpoint "${endpoint.label}" is ${health.available ? "reachable" : "not reachable"}: ${health.detail}${health.installedModels.length ? ` Models reported: ${health.installedModels.slice(0, 10).join(", ")}.` : ""}`, id, health.available ? "success" : "failed");
      return structuredClone(endpoint);
    });
  }
  async brainSettings(): Promise<BrainSettingsV1> { return structuredClone((await this.snapshot()).brain); }
  /** Where a piece of work would run, and what would leave the machine if it did. */
  async routeBrain(request: Omit<RoutingRequestV1, "workspaceLabel">): Promise<RoutingDecisionV1> {
    const state = await this.snapshot();
    const workspace = requireWorkspace(state.workspaces, request.workspace || state.settings.activeWorkspace);
    return routeRequest(state.brain, { ...request, workspace: workspace.id, workspaceLabel: workspace.label });
  }
  /** The acceptance criterion answered against the real configuration, not against an intention. */
  async independence(): Promise<ReturnType<typeof independenceReport>> { return independenceReport((await this.snapshot()).brain); }

  /**
   * Records one evaluation run.
   *
   * The harness is deterministic and its fixtures are synthetic, so a run is reproducible and safe
   * to send to a third-party endpoint. Results are evidence about a configuration on a day, and the
   * summary says exactly that rather than implying something about the model in general.
   */
  async recordEvaluation(endpointId: string, results: readonly EvaluationCaseResultV1[], startedAt: string, extras: { degenerateResponse?: boolean; status?: EvaluationRunV1["status"]; codeGradingMode?: EvaluationRunV1["codeGradingMode"] } = {}): Promise<EvaluationRunV1> {
    return this.mutate((state) => {
      const endpoint = find(state.brain.endpoints, endpointId, "Endpoint");
      const codeMode = extras.codeGradingMode
        ?? results.find((entry) => entry.codeGradingMode)?.codeGradingMode
        ?? "structural";
      const summaryContext: Parameters<typeof summariseEvaluation>[1] = {
        id: this.ports.ids.next("evaluation"), endpointId, endpointLabel: endpoint.label, model: endpoint.model,
        runtime: endpoint.runtime, location: endpoint.location, isFloor: endpoint.id === OFFLINE_ENDPOINT_ID,
        startedAt, completedAt: this.ports.clock.now(),
        evaluatorVersion: EVALUATION_VERSION,
        codeGradingMode: codeMode,
        degenerateResponse: extras.degenerateResponse === true,
      };
      if (extras.status) summaryContext.status = extras.status;
      const run = summariseEvaluation(results, summaryContext);
      state.evaluations.unshift(run);
      if (state.evaluations.length > 50) state.evaluations.length = 50;
      this.activity(state, "provider", "brain.evaluate", run.summary, run.id, run.passed === run.total ? "success" : "failed");
      return structuredClone(run);
    });
  }
  /**
   * Runs the suite against one configured endpoint and records the result.
   *
   * Evaluation drains the same streaming-first brain runtime path Chat uses. Code cases use the
   * evaluator-only CodeSandboxPort when configured; otherwise structural-only grading is persisted
   * and disclosed. A rented endpoint is an ordinary registered endpoint by the time it gets here.
   */
  async evaluateEndpoint(endpointId: string, signal?: AbortSignal): Promise<EvaluationRunV1> {
    const runtime = this.ports.brainRuntime;
    if (!runtime) throw new Error("No runtime adapter is configured, so AION cannot reach any endpoint to measure it.");
    const state = await this.snapshot();
    const endpoint = find(state.brain.endpoints, endpointId, "Endpoint");
    if (!runtime.supports(endpoint)) throw new Error(`No configured runtime adapter can reach "${endpoint.label}" (${endpoint.runtime}). AION will not invent a transport for it, and a silently skipped measurement looks exactly like a passing one.`);
    const startedAt = this.ports.clock.now();
    const session = endpoint.rental ? state.gpuSessions.find((entry) => entry.id === endpoint.rental?.gpuSessionId) : undefined;
    if (session) await this.touchGpuSession(session.id);
    const controller = signal ?? new AbortController().signal;
    if (controller.aborted) throw new Error("Evaluation cancelled.");
    const results = await runEvaluationSuite(endpoint, EVALUATION_SUITE, runtime, {
      signal: controller,
      redact: (value) => redactInferenceDetail(redactCredentials(value)),
      sandbox: this.ports.codeSandbox ?? null,
    });
    const degenerate = detectDegenerateResponses(results.map((entry) => entry.excerpt));
    const codeMode = results.find((entry) => entry.codeGradingMode)?.codeGradingMode ?? "structural";
    const run = await this.recordEvaluation(endpointId, results, startedAt, { degenerateResponse: degenerate, codeGradingMode: codeMode });
    if (session) {
      await this.touchGpuSession(session.id);
      await this.mutate((draft) => {
        const stored = draft.gpuSessions.find((entry) => entry.id === session.id);
        if (!stored) return;
        stored.events.push({ at: this.ports.clock.now(), event: "evaluated", detail: `${run.passed}/${run.total} synthetic cases passed, median ${run.medianLatencyMs} ms. Evaluator ${run.evaluatorVersion}, code grading ${run.codeGradingMode}. Measured on the same suite as the deterministic floor.` });
      });
    }
    return run;
  }
  async evaluations(): Promise<EvaluationRunV1[]> { return (await this.snapshot()).evaluations.map((entry) => structuredClone(entry)); }
  /** The most recent run per endpoint, ranked on the evidence rather than on vendor claims. */
  async modelComparison(): Promise<ReturnType<typeof compareEvaluations>> {
    const state = await this.snapshot();
    const latest = new Map<string, EvaluationRunV1>();
    for (const run of state.evaluations) if (!latest.has(run.endpointId)) latest.set(run.endpointId, run);
    return compareEvaluations([...latest.values()]);
  }
  evaluationSuite(): readonly EvaluationCaseV1[] { return EVALUATION_SUITE; }
  /** What AION owns and what a model does not. Stated as data so the UI cannot drift from it. */
  brainBoundary(): typeof BRAIN_BOUNDARY { return BRAIN_BOUNDARY; }

  // --- Learning ---------------------------------------------------------------------------------
  /**
   * Records a lesson.
   *
   * The claim rules apply unchanged: a model proposing a lesson produces a hypothesis or an
   * inference, never a learned strategy, and only the owner promotes it. That is the difference
   * between AION learning and AION being talked into believing something.
   */
  async recordLesson(input: Record<string, unknown> = {}, actor: "owner" | "provider-proposal" | "routine" = "owner"): Promise<LessonV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, state.settings.activeWorkspace);
      const claim = buildClaim(
        { class: input.class ?? (actor === "owner" ? "learned-strategy" : "hypothesis"), statement: input.statement, confidence: input.confidence, supportedBy: input.supportedBy },
        { id: this.ports.ids.next("claim"), workspace: workspace.id, now: this.ports.clock.now(), actor, sourceRef: actor === "owner" ? "owner-entry" : `${actor}:lesson` },
      );
      assertLessonClaimClass(claim);
      const lesson = buildLesson(input, { id: this.ports.ids.next("lesson"), claim, now: this.ports.clock.now() });
      state.lessons.unshift(lesson);
      if (state.lessons.length > 2000) state.lessons.length = 2000;
      this.activity(state, "memory", "lesson.record", `Recorded a ${claim.class} lesson in "${workspace.label}". Its class travels with it, so a suggestion is never quoted as settled practice.`, lesson.id);
      return structuredClone(lesson);
    });
  }
  /** Owner-only promotion, using the same path and the same history as any other claim. */
  async promoteLesson(id: string, to: string, reason: string): Promise<LessonV1> {
    return this.mutate((state) => {
      const lesson = find(state.lessons, id, "Lesson");
      assertSameWorkspace(lesson, state.settings.activeWorkspace, "lesson");
      const promoted = { ...structuredClone(lesson), claim: promoteClaim(lesson.claim, to, reason, this.ports.clock.now()), updatedAt: this.ports.clock.now() };
      state.lessons = state.lessons.map((entry) => entry.id === id ? promoted : entry);
      this.activity(state, "memory", "lesson.promote", `You promoted a lesson from ${lesson.claim.class} to ${promoted.claim.class}.`, id);
      return structuredClone(promoted);
    });
  }
  /** Records what happened when a lesson was followed. "Did not work" counts the same as "worked". */
  async recordLessonOutcome(id: string, input: Record<string, unknown> = {}): Promise<LessonV1> {
    return this.mutate((state) => {
      const lesson = find(state.lessons, id, "Lesson");
      assertSameWorkspace(lesson, state.settings.activeWorkspace, "lesson");
      const updated = recordLessonOutcome(lesson, input, this.ports.clock.now());
      state.lessons = state.lessons.map((entry) => entry.id === id ? updated : entry);
      const standing = lessonStanding(updated);
      this.activity(state, "memory", "lesson.outcome", `Outcome recorded. ${standing.summary}`, id, standing.stillRecommended ? "success" : "denied");
      return structuredClone(updated);
    });
  }
  async setLessonEnabled(id: string, enabled: boolean): Promise<LessonV1> {
    return this.mutate((state) => {
      const lesson = find(state.lessons, id, "Lesson");
      assertSameWorkspace(lesson, state.settings.activeWorkspace, "lesson");
      const updated = { ...structuredClone(lesson), enabled, updatedAt: this.ports.clock.now() };
      state.lessons = state.lessons.map((entry) => entry.id === id ? updated : entry);
      this.activity(state, "memory", enabled ? "lesson.enable" : "lesson.disable", enabled ? "Lesson re-enabled." : "Lesson turned off. It is kept so the history is intact.", id);
      return structuredClone(updated);
    });
  }
  /** The lessons AION would actually offer here, ordered by track record rather than by age. */
  async lessons(scope: { kind?: LessonScopeV1; subjectRef?: string } = {}): Promise<Array<LessonV1 & { standing: LessonStandingV1 }>> {
    const state = await this.snapshot();
    return applicableLessons(state.lessons, { workspace: state.settings.activeWorkspace, ...scope });
  }
  async learningSummary(): Promise<ReturnType<typeof learningSummary>> {
    const state = await this.snapshot();
    return learningSummary(state.lessons.filter((entry) => entry.workspace === state.settings.activeWorkspace));
  }
  /** The declared, unimplemented adaptation boundary. Stated as data so a change has to argue with it. */
  adaptationBoundary(): typeof ADAPTATION_BOUNDARY { return ADAPTATION_BOUNDARY; }

  // --- Development projects ----------------------------------------------------------------------
  #findProject(state: AssistantStateV1, id: string): DevelopmentProjectV1 {
    const found = find(state.projects, id, "Project");
    assertSameWorkspace(found, state.settings.activeWorkspace, "project");
    return found;
  }
  #replaceProject(state: AssistantStateV1, updated: DevelopmentProjectV1): DevelopmentProjectV1 {
    state.projects = state.projects.map((entry) => entry.id === updated.id ? updated : entry);
    return structuredClone(updated);
  }
  async createProject(input: Record<string, unknown> = {}): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, state.settings.activeWorkspace);
      if (state.projects.length >= 200) throw new Error("AION holds at most 200 projects.");
      if (input.opportunityId) assertSameWorkspace(find(state.opportunities, String(input.opportunityId), "Opportunity"), workspace.id, "opportunity");
      const project = buildProject(input, { id: this.ports.ids.next("project"), workspace: workspace.id, now: this.ports.clock.now() });
      state.projects.unshift(project);
      this.activity(state, "plan", "project.create", `Project "${project.title}" opened in "${workspace.label}" at the idea stage.`, project.id);
      return structuredClone(project);
    });
  }
  async setProjectSpecification(id: string, input: Record<string, unknown> = {}): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      const updated = { ...structuredClone(project), specification: buildProjectSpecification(input, this.ports.clock.now()), updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "project.specify", `Specification written for "${project.title}".`, id);
      return this.#replaceProject(state, updated);
    });
  }
  async setProjectPlan(id: string, steps: readonly string[]): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      const cleaned = (steps ?? []).map((step) => required(step, "Plan step", 2000));
      if (!cleaned.length || cleaned.length > 100) throw new Error("A project plan needs between 1 and 100 steps.");
      const updated = { ...structuredClone(project), planSteps: cleaned, updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "project.plan", `${cleaned.length} plan step(s) recorded for "${project.title}".`, id);
      return this.#replaceProject(state, updated);
    });
  }
  /**
   * Records a developer-agent proposal against a project. It grants nothing: running it still goes
   * through the ordinary capability, digest, and one-shot approval machinery.
   */
  async recordAgentProposal(id: string, input: Record<string, unknown> = {}): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      const proposal = buildAgentProposal({ bridgeId: this.ports.developerAgents.selected().id, ...input }, { id: this.ports.ids.next("proposal"), now: this.ports.clock.now() });
      const updated = { ...structuredClone(project), proposals: [...project.proposals, proposal], updatedAt: this.ports.clock.now() };
      this.activity(state, "agent", "project.proposal", `${proposal.bridgeId} proposed a ${proposal.mode} change to "${project.title}". It grants nothing; running it still needs its own approval.`, id, "pending");
      return this.#replaceProject(state, updated);
    });
  }
  /** Attaches evidence from an allowlisted verification run that actually happened. */
  async attachProjectVerification(id: string, verificationId: string): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      find(state.verifications, verificationId, "Verification run");
      const updated = { ...structuredClone(project), verificationIds: project.verificationIds.includes(verificationId) ? project.verificationIds : [...project.verificationIds, verificationId], updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "project.verification", `Verification evidence attached to "${project.title}".`, id);
      return this.#replaceProject(state, updated);
    });
  }
  /** Runs one pipeline step, chosen from a closed set. Nothing here accepts a command. */
  async runProjectStep(id: string, step: string): Promise<DevelopmentProjectV1> {
    const pipeline = this.ports.pipeline;
    if (!pipeline) throw new Error("No build pipeline is configured, so AION cannot build or preview anything.");
    if (!PIPELINE_STEPS.includes(step as PipelineStepV1)) throw new Error(`A pipeline step must be one of: ${PIPELINE_STEPS.join(", ")}.`);
    const snapshot = await this.snapshot();
    const project = this.#findProject(snapshot, id);
    const controller = new AbortController();
    this.controllers.set(`pipeline:${id}`, controller);
    try {
      const run = await pipeline.run(step as PipelineStepV1, { id: project.id, title: project.title }, controller.signal);
      return await this.mutate((state) => {
        const current = this.#findProject(state, id);
        const record: PipelineRunV1 = { id: this.ports.ids.next("pipeline-run"), step: step as PipelineStepV1, ...run };
        const updated = { ...structuredClone(current), runs: [...current.runs, record].slice(-100), updatedAt: this.ports.clock.now() };
        this.activity(state, "plan", "project.pipeline", `Pipeline step "${step}" ${record.outcome} for "${current.title}".${record.previewUrl ? ` Preview at ${record.previewUrl}, reachable from this computer only.` : ""}`, id, record.outcome === "passed" ? "success" : "failed");
        return this.#replaceProject(state, updated);
      });
    } finally { this.controllers.delete(`pipeline:${id}`); }
  }
  /** Owner-only, and for one exact stage. There is no actor parameter because there is no choice. */
  async approveProjectStage(id: string, stage: string, note = ""): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      const updated = approveProjectStage(project, stage, note, this.ports.clock.now());
      this.activity(state, "approval", "project.approve", `You approved the "${stage}" stage of "${project.title}".`, id);
      return this.#replaceProject(state, updated);
    });
  }
  async advanceProject(id: string, stage: string, reason: string): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      const updated = advanceProject(project, stage, reason, this.ports.clock.now());
      this.activity(state, "plan", "project.stage", `"${project.title}" moved from ${project.stage} to ${updated.stage}.`, id);
      return this.#replaceProject(state, updated);
    });
  }
  /**
   * Prepares a deployment. This writes down what would happen; it does not create the ability to
   * do it, and `advanceProject` still refuses the deployed stage.
   */
  async prepareDeployment(id: string, input: Record<string, unknown> = {}): Promise<DevelopmentProjectV1> {
    return this.mutate((state) => {
      const project = this.#findProject(state, id);
      const deployment = buildDeploymentProposal(input, { id: this.ports.ids.next("deployment"), now: this.ports.clock.now() });
      const updated = { ...structuredClone(project), deployment, updatedAt: this.ports.clock.now() };
      this.activity(state, "plan", "project.deployment", `A deployment to ${deployment.target} was written down for "${project.title}". AION cannot carry it out: no capability in this milestone performs a deployment.`, id, "pending");
      return this.#replaceProject(state, updated);
    });
  }
  async projects(): Promise<Array<DevelopmentProjectV1 & { standing: string }>> {
    const state = await this.snapshot();
    return state.projects
      .filter((entry) => entry.workspace === state.settings.activeWorkspace)
      .map((entry) => ({ ...structuredClone(entry), standing: projectStanding(entry) }));
  }

  // --- The command router ------------------------------------------------------------------------
  /**
   * Turns one ordinary sentence into typed proposals.
   *
   * Nothing is executed and nothing is created. The result is what AION believes was meant, in a
   * form the owner can check before any of it happens — and the safety assertion runs on the way
   * out, so a payload that somehow carried shell-shaped text never reaches a caller.
   */
  async route(sentence: string): Promise<RoutingResultV1> {
    const state = await this.snapshot();
    const workspace = requireWorkspace(state.workspaces, state.settings.activeWorkspace);
    const result = routeCommand(required(sentence, "Message", 4000), {
      workspaceLabel: workspace.label,
      workspaces: state.workspaces.filter((entry) => !entry.archived).map(({ id, label }) => ({ id, label })),
    });
    assertNoExecutableText(result);
    return result;
  }

  // --- Rented GPU capacity ------------------------------------------------------------------------
  /**
   * Whether a GPU provider credential is configured, by name only.
   *
   * AION never searches for a credential. This asks the configured adapter whether the environment
   * variable it was told to read is present, and reports the variable's *name*. The value is never
   * read into anything AION stores, displayed, or logged.
   */
  async gpuCredentialStatus(): Promise<{ provider: string; configured: boolean; variableName: string; detail: string }> {
    const port = this.ports.gpu;
    if (!port) return { provider: "none", configured: false, variableName: "", detail: "No GPU infrastructure provider is configured. AION rents nothing until you configure one." };
    const status = await port.credentialStatus();
    return { provider: port.provider, ...status, detail: redactCredentials(status.detail) };
  }
  /**
   * Discovers capacity and scores it against what the work needs.
   *
   * Capability first, then price: an offer that cannot hold the model is ineligible at any price.
   * Discovery reads; it never starts anything, and the recommendations are explicitly three
   * framings of an experiment rather than one "best" machine.
   */
  async discoverGpuOffers(input: Record<string, unknown> = {}): Promise<{
    requirement: GpuRequirementV1;
    assessments: OfferAssessmentV1[];
    recommendations: ExperimentRecommendationV1[];
    ceilingCents: number;
    note: string;
  }> {
    const port = this.ports.gpu;
    if (!port) throw new Error("No GPU infrastructure provider is configured, so there is nothing to discover.");
    const credential = await port.credentialStatus();
    if (!credential.configured) {
      throw new Error(`${redactCredentials(credential.detail)} Set ${credential.variableName || "the provider's credential environment variable"} in the shell that starts AION, then try again. AION stores only the variable name.`);
    }
    const modelId = required(input.modelId ?? "qwen3-14b", "Model", 200);
    const profile = OPEN_MODEL_PROFILES.find((entry) => entry.id === modelId);
    const requirement: GpuRequirementV1 = {
      modelId,
      minimumVramGb: Number.isSafeInteger(input.minimumVramGb) ? input.minimumVramGb as number : profile?.minimumVramGb ?? 16,
      maxHourlyCents: Number.isSafeInteger(input.maxHourlyCents) ? input.maxHourlyCents as number : 120,
      minimumReliability: Number.isSafeInteger(input.minimumReliability) ? input.minimumReliability as number : null,
      runtime: required(input.runtime ?? "vllm", "Runtime", 100),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const offers = await port.discover({ ...requirement, limit: Number.isSafeInteger(input.limit) ? input.limit as number : 20 }, controller.signal);
      const assessments = offers.map((offer) => assessOffer(offer, requirement));
      const recommendations = recommendExperiments(assessments, requirement);
      await this.mutate((state) => {
        this.activity(state, "provider", "gpu.discover", `Looked at ${offers.length} ${port.provider} offer(s) for ${modelId}: ${assessments.filter((entry) => entry.eligible).length} could hold it. Nothing was started and nothing was charged.`, null);
      });
      return {
        requirement, assessments, recommendations, ceilingCents: V13_BUDGET_CEILING_CENTS,
        note: `Discovery only. The ceiling for this milestone is ${V13_BUDGET_CEILING_CENTS} cents in total, and every recommendation is sized well inside it. VRAM figures for open models are owner-editable planning estimates, not guarantees.`,
      };
    } finally { clearTimeout(timer); }
  }
  /**
   * Prepares a bounded provisioning proposal.
   *
   * Preparing is not approving and approving is not starting. The proposal carries a digest over
   * the money-bearing fields, so an approval cannot later be spent on a different offer, a
   * different price, or a longer run.
   */
  async proposeGpuProvisioning(input: Record<string, unknown> = {}): Promise<GpuProvisioningProposalV1 & { disclosure: string }> {
    const port = this.ports.gpu;
    if (!port) throw new Error("No GPU infrastructure provider is configured.");
    const offer = input.offer as GpuOfferV1 | undefined;
    if (!offer || typeof offer !== "object") throw new Error("A provisioning proposal needs the exact offer it is for.");
    return this.mutate((state) => {
      const proposal = buildProvisioningProposal(
        {
          offer, modelId: String(input.modelId ?? ""), runtime: String(input.runtime ?? "vllm"),
          maxRuntimeMinutes: Number(input.maxRuntimeMinutes ?? 30),
          maxSpendCents: Number(input.maxSpendCents ?? 0),
          idleTimeoutMinutes: Number(input.idleTimeoutMinutes ?? 10),
          ...(input.readinessMinutes === undefined ? {} : { readinessMinutes: Number(input.readinessMinutes) }),
        },
        { id: this.ports.ids.next("gpu-proposal"), now: this.ports.clock.now(), digest: digestValue },
      );
      state.gpuProposals.unshift(proposal);
      if (state.gpuProposals.length > 100) state.gpuProposals.length = 100;
      this.activity(state, "approval", "gpu.propose", `${describeProposal(proposal)} Nothing has been rented; this is waiting for your decision.`, proposal.id, "pending");
      return { ...structuredClone(proposal), disclosure: describeProposal(proposal) };
    });
  }
  /** Owner-only. Approving binds the exact quoted numbers and nothing else. */
  async decideGpuProposal(id: string, approve: boolean): Promise<GpuProvisioningProposalV1> {
    return this.mutate((state) => {
      const proposal = find(state.gpuProposals, id, "GPU proposal");
      if (proposal.state !== "pending") throw new Error(`That proposal is ${proposal.state} and can no longer be decided.`);
      proposal.state = approve ? "approved" : "denied";
      proposal.decidedAt = this.ports.clock.now();
      this.activity(state, "approval", approve ? "gpu.approve" : "gpu.deny", approve
        ? `You approved at most ${proposal.maxRuntimeMinutes} minutes and at most ${proposal.maxSpendCents} cents on ${proposal.gpuName}. AION cannot raise either.`
        : "GPU provisioning denied. Nothing was rented.", id, approve ? "success" : "denied");
      return structuredClone(proposal);
    });
  }
  /**
   * Starts an approved session.
   *
   * Three things must hold and each is checked here: the proposal is approved, the price has not
   * moved beyond what was approved, and the digest still matches the offer being started. The
   * hard-stop deadline is computed now and *stored*, so it survives AION being closed or crashing —
   * the failure being designed against is not a bug, it is an instance nobody remembered.
   */
  async startGpuSession(proposalId: string): Promise<GpuSessionV1> {
    const port = this.ports.gpu;
    if (!port) throw new Error("No GPU infrastructure provider is configured.");
    const snapshot = await this.snapshot();
    const proposal = find(snapshot.gpuProposals, proposalId, "GPU proposal");
    if (proposal.state !== "approved") throw new Error(`Provisioning needs an approved proposal; this one is ${proposal.state}.`);

    // Re-check the market before spending. A price that moved invalidates the approval rather
    // than quietly costing more than the owner agreed to.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const offers = await port.discover({ minimumVramGb: 1, maxHourlyCents: 1_000_000, minimumReliability: null, limit: 200 }, controller.signal);
      const current = offers.find((entry) => entry.offerRef === proposal.offerRef) ?? null;
      const revalidated = revalidateProposal(proposal, current, this.ports.clock.now());
      if (revalidated.state === "invalidated") {
        await this.mutate((state) => {
          const stored = find(state.gpuProposals, proposalId, "GPU proposal");
          stored.state = "invalidated"; stored.invalidationReason = revalidated.invalidationReason; stored.decidedAt = this.ports.clock.now();
          this.activity(state, "failure", "gpu.invalidated", `Provisioning refused: ${revalidated.invalidationReason} Nothing was rented.`, proposalId, "denied");
        });
        throw new Error(revalidated.invalidationReason ?? "The approved proposal is no longer valid.");
      }

      const started = await port.start({ offerRef: proposal.offerRef, modelId: proposal.modelId, runtime: proposal.runtime }, controller.signal);
      return await this.mutate((state) => {
        const stored = find(state.gpuProposals, proposalId, "GPU proposal");
        stored.state = "consumed";
        const at = this.ports.clock.now();
        const hardStopAt = new Date(Date.parse(at) + proposal.maxRuntimeMinutes * 60_000).toISOString();
        const activation = emptyActivation();
        /*
         * Cost accounting begins here, not when the endpoint becomes usable.
         *
         * The machine starts billing the moment the provider creates it, so `startedAt` is set now
         * and the readiness deadline is derived from it. Starting the clock at READY would make
         * every failed activation look free, which is the one case where the owner most needs to
         * see what it cost.
         */
        activation.provisioningStartedAt = at;
        activation.deadlineAt = readinessDeadline(at, hardStopAt, proposal.readinessMinutes);
        activation.lastDetail = redactCredentials(started.detail);
        const session: GpuSessionV1 = {
          id: this.ports.ids.next("gpu-session"), provider: port.provider, proposalId,
          instanceRef: started.instanceRef, state: "provisioning",
          gpuName: proposal.gpuName, vramGb: proposal.vramGb, modelId: proposal.modelId, runtime: proposal.runtime,
          endpointId: null, endpointHost: null, activation, failureReason: null,
          hourlyCents: proposal.quotedHourlyCents + proposal.quotedStorageCentsPerHour,
          maxRuntimeMinutes: proposal.maxRuntimeMinutes, maxSpendCents: proposal.maxSpendCents,
          idleTimeoutMinutes: proposal.idleTimeoutMinutes,
          hardStopAt,
          startedAt: at, stoppedAt: null, lastActivityAt: at,
          measuredMinutes: 0, estimatedCents: 0, teardownConfirmed: false,
          events: [
            { at: proposal.proposedAt, event: "proposed", detail: describeProposal(proposal) },
            { at: proposal.decidedAt ?? at, event: "approved", detail: `Owner approved at most ${proposal.maxRuntimeMinutes} minutes and ${proposal.maxSpendCents} cents, including up to ${proposal.readinessMinutes} minutes of paid waiting.` },
            { at, event: "started", detail: redactCredentials(started.detail) },
            { at, event: "provisioning", detail: `The provider is creating the machine. It is billing from now, including while the model loads. AION will give up on it at ${activation.deadlineAt}.` },
          ],
        };
        state.gpuSessions.unshift(session);
        this.activity(state, "provider", "gpu.start", `Rented GPU session started on ${session.gpuName}. It is not usable yet — the model still has to load, and AION will stop the machine at ${activation.deadlineAt} if it has not. It must be gone by ${session.hardStopAt}; both deadlines are stored, not held in timers.`, session.id);
        return structuredClone(session);
      });
    } finally { clearTimeout(timer); }
  }

  // --- The bridge: a rented machine becomes a routable endpoint, or it stops -----------------------
  /**
   * One readiness check.
   *
   * The order of the steps is the design. Stop conditions are evaluated before anything else, from
   * stored state, so a session past its spend limit stops even if it is one poll from ready — the
   * owner authorised an amount, not an outcome. Then the readiness allowance. Only then does AION
   * ask the provider anything, and only after a real completion comes back does an endpoint exist.
   *
   * Every exit from this function leaves the session in a state that describes what is true. There
   * is no path that reports READY without a completion having been answered.
   */
  async pollGpuReadiness(id: string): Promise<GpuActivationStatusV1> {
    const port = this.ports.gpu;
    if (!port) throw new Error("No GPU infrastructure provider is configured.");
    /*
     * One check at a time per session. Two concurrent polls that both saw "no endpoint yet" would
     * both go on to register one, and the owner would be billed for one machine while the router
     * held two endpoints pointing at it.
     */
    if (this.#activating.has(id)) return this.#activationStatus(await this.snapshot(), id, "Another readiness check for this session is already running.");
    this.#activating.add(id);
    try { return await this.#pollOnce(port, id); }
    finally { this.#activating.delete(id); }
  }
  async #pollOnce(port: GpuInfrastructurePortV1, id: string): Promise<GpuActivationStatusV1> {
    const before = await this.snapshot();
    const session = find(before.gpuSessions, id, "GPU session");
    const now = this.ports.clock.now();
    // A session that is not activating is reported as it is. Both ready and finished are stable
    // answers, so a duplicate or late poll changes nothing.
    if (!isActivatingSession(session.state)) return this.#activationStatus(before, id, sessionStanding(session, now));

    // 1. The stop conditions, from stored state, before anything else and before any network call.
    const decision = shutdownDecision(session, now);
    if (decision.stop) {
      await this.#abandonActivation(id, `${decision.trigger}: ${decision.reason}`, "stop-requested");
      return this.#activationStatus(await this.snapshot(), id, decision.reason);
    }
    // 2. The readiness allowance, also from stored state. No silent extension of either.
    const readiness = readinessVerdict(session, now);
    if (readiness.expired) {
      await this.#abandonActivation(id, readiness.reason, "readiness-expired");
      return this.#activationStatus(await this.snapshot(), id, readiness.reason);
    }

    // 3. Ask the provider what it sees. A provider error is ordinary, so it is recorded, redacted,
    //    and retried inside the allowance rather than treated as fatal on its own.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let observed: { state: string; detail: string; endpointUrl: string | null };
    try { observed = await port.status(session.instanceRef ?? "", controller.signal); }
    catch (error) {
      const detail = redactCredentials(error instanceof Error ? error.message : "the provider did not answer");
      await this.#notePoll(id, "booting-runtime", detail, `The provider did not answer this check: ${detail}`);
      return this.#activationStatus(await this.snapshot(), id, `The provider did not answer: ${detail}`);
    }
    finally { clearTimeout(timer); }

    const detail = redactCredentials(observed.detail);
    if (observed.state === "stopped" || observed.state === "failed") {
      const reason = `The provider reports the machine is ${observed.state}: ${detail} AION will not wait for something that is not there.`;
      await this.#abandonActivation(id, reason, "readiness-expired");
      return this.#activationStatus(await this.snapshot(), id, reason);
    }
    if (!observed.endpointUrl) {
      await this.#notePoll(id, "waiting-for-endpoint", detail, detail || "The machine is up; the runtime has not opened a serving port yet.");
      return this.#activationStatus(await this.snapshot(), id, "The machine is up; the model is still loading.");
    }

    // 4. Validate and normalise the address before anything is stored or connected to. A malformed
    //    or secret-bearing address is refused outright rather than corrected into something usable.
    let serving: { baseUrl: string; host: string; encrypted: boolean };
    try { serving = normaliseServingEndpoint(observed.endpointUrl); }
    catch (error) {
      const reason = redactCredentials(error instanceof Error ? error.message : "the provider reported an unusable serving address");
      await this.#abandonActivation(id, reason, "endpoint-refused");
      return this.#activationStatus(await this.snapshot(), id, reason);
    }

    // 5. Health verification, through the same runtime adapter ordinary work would use. AION will
    //    not register an endpoint it has no way to check: an unverifiable endpoint reported as
    //    ready is the exact claim this correction exists to make impossible.
    const runtime = this.ports.brainRuntime;
    if (!runtime) {
      const reason = "No runtime adapter is configured, so AION cannot verify that this machine answers. It will not register an endpoint it cannot check, and is stopping the machine rather than billing for one it cannot use.";
      await this.#abandonActivation(id, reason, "endpoint-refused");
      return this.#activationStatus(await this.snapshot(), id, reason);
    }
    await this.#recordDiscovery(id, serving.host, detail);
    const health = await this.#verifyRentedEndpoint(runtime, session, serving.baseUrl);
    if (!health.available) {
      await this.#noteHealthFailure(id, health.detail);
      const after = await this.snapshot();
      const stillActivating = find(after.gpuSessions, id, "GPU session");
      const verdict = readinessVerdict(stillActivating, this.ports.clock.now());
      if (verdict.expired) {
        await this.#abandonActivation(id, verdict.reason, "readiness-expired");
        return this.#activationStatus(await this.snapshot(), id, verdict.reason);
      }
      return this.#activationStatus(after, id, `The endpoint answered but did not pass its health check: ${health.detail}`);
    }

    // 6. Register. Everything below happens in one write, and re-reads the session inside it, so a
    //    poll that raced another one finds the endpoint already there and adopts it.
    return this.#registerRentedEndpoint(id, serving, health);
  }
  /**
   * Whether the runtime on the far end can actually do the job.
   *
   * Two checks, deliberately. The probe says something is listening and reports what it holds; the
   * completion says the model is loaded and answering. Only the second is evidence, which is why a
   * probe that succeeds and a completion that returns nothing is recorded as a failure.
   *
   * The model identity check matters more than it looks: registering an endpoint labelled with a
   * model the host is not running would make every evaluation, comparison, and cost figure derived
   * from it quietly wrong.
   */
  async #verifyRentedEndpoint(runtime: BrainRuntimePortV1, session: GpuSessionV1, baseUrl: string): Promise<BrainHealthV1> {
    const checkedAt = this.ports.clock.now();
    const candidate = this.#rentedEndpointDraft(session, baseUrl, "health-check");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      if (!runtime.supports(candidate)) {
        return { available: false, detail: `No configured runtime adapter can reach a ${session.runtime} endpoint, so AION cannot verify this machine.`, checkedAt, latencyMs: null, installedModels: [] };
      }
      const probe = await runtime.probe(candidate, controller.signal);
      if (!probe.available) return { ...probe, checkedAt, detail: redactCredentials(probe.detail) };
      if (probe.installedModels.length && !probe.installedModels.some((name) => name === session.modelId || name.startsWith(`${session.modelId}:`))) {
        return {
          available: false, checkedAt, latencyMs: probe.latencyMs, installedModels: probe.installedModels,
          detail: `The machine is serving ${probe.installedModels.slice(0, 5).join(", ")}, not ${session.modelId}. AION will not register an endpoint under a model name it is not running.`,
        };
      }
      const answer = await runtime.complete(candidate, { prompt: RENTED_HEALTH_PROMPT, context: [], signal: controller.signal });
      if (!answer.text.trim()) {
        return { available: false, checkedAt, latencyMs: answer.latencyMs, installedModels: probe.installedModels, detail: "The endpoint accepted the request and returned nothing. An open port is not a loaded model." };
      }
      return {
        available: true, checkedAt, latencyMs: answer.latencyMs, installedModels: probe.installedModels,
        detail: `Answered a real completion in ${answer.latencyMs} ms${probe.installedModels.length ? `, serving ${probe.installedModels.slice(0, 3).join(", ")}` : ""}. Verified by a completion, not by a socket.`,
      };
    } catch (error) {
      return { available: false, checkedAt, latencyMs: null, installedModels: [], detail: redactCredentials(error instanceof Error ? error.message : "the endpoint did not answer") };
    } finally { clearTimeout(timer); }
  }
  /** The endpoint a session *would* become, used for health checks before one is registered. */
  #rentedEndpointDraft(session: GpuSessionV1, baseUrl: string, id: string): BrainEndpointV1 {
    return rentedGpuEndpoint({
      baseUrl,
      model: session.modelId,
      runtime: BRAIN_RUNTIMES.includes(session.runtime as BrainRuntimeV1) ? session.runtime as BrainRuntimeV1 : "openai-compatible",
      rental: {
        gpuSessionId: session.id, infrastructureProvider: session.provider, instanceRef: session.instanceRef ?? "",
        gpuName: session.gpuName, hourlyCents: session.hourlyCents, hardStopAt: session.hardStopAt,
      },
    }, { id, now: session.startedAt ?? this.ports.clock.now() });
  }
  async #registerRentedEndpoint(id: string, serving: { baseUrl: string; host: string }, health: BrainHealthV1): Promise<GpuActivationStatusV1> {
    const registered = await this.mutate((state) => {
      const session = find(state.gpuSessions, id, "GPU session");
      const at = this.ports.clock.now();
      // A concurrent poll may already have registered one. Adopting it is the only safe answer:
      // creating a second would leave the router holding two names for one rented machine.
      if (session.endpointId && state.brain.endpoints.some((entry) => entry.id === session.endpointId)) {
        return structuredClone(session);
      }
      if (!isActivatingSession(session.state)) return structuredClone(session);
      let endpoint: BrainEndpointV1;
      try {
        endpoint = this.#rentedEndpointDraft(session, serving.baseUrl, this.ports.ids.next("endpoint"));
      } catch (error) {
        // Registration is the last thing that can fail, and failing here means the owner is paying
        // for a machine nothing will ever use. Recording it and letting the caller tear down is the
        // only honest outcome; silently keeping the session would be billing for nothing.
        session.failureReason = redactCredentials(error instanceof Error ? error.message : "the endpoint could not be registered");
        session.events.push({ at, event: "endpoint-refused", detail: session.failureReason });
        return structuredClone(session);
      }
      endpoint.lastHealth = { ...structuredClone(health), checkedAt: at };
      state.brain.endpoints = [...state.brain.endpoints, endpoint];
      session.endpointId = endpoint.id;
      session.endpointHost = serving.host;
      session.state = "ready";
      session.lastActivityAt = at;
      session.activation.healthyAt = at;
      session.activation.readyAt = at;
      session.activation.healthFailures = 0;
      session.activation.lastDetail = health.detail;
      session.events.push({ at, event: "health", detail: health.detail });
      session.events.push({ at, event: "endpoint-registered", detail: `Registered as "${endpoint.label}" at ${serving.host}, an owner-controlled endpoint backed by a rented machine. It is removed when the session stops.` });
      this.activity(state, "provider", "gpu.endpoint.register", `The rented ${session.gpuName} is now usable: "${endpoint.label}" at ${serving.host} answered a real completion and joined the Brain as an endpoint you control. It disappears when the session stops at ${session.hardStopAt}. No credential value was stored.`, session.id);
      return structuredClone(session);
    });
    if (!registered.endpointId && registered.failureReason) {
      await this.#abandonActivation(id, registered.failureReason, "endpoint-refused");
    }
    return this.#activationStatus(await this.snapshot(), id, registered.endpointId ? "The rented endpoint is ready." : registered.failureReason ?? "Registration did not complete.");
  }
  /** Records that a check happened without changing what AION claims to know. */
  async #notePoll(id: string, state: GpuSessionStateV1, detail: string, event: string): Promise<void> {
    await this.mutate((draft) => {
      const session = draft.gpuSessions.find((entry) => entry.id === id);
      if (!session || !isActivatingSession(session.state)) return;
      session.activation.polls += 1;
      session.activation.lastDetail = detail;
      // Never move backwards through the lifecycle: a session that reached health-checking and hit
      // a provider hiccup is still further along than one that has only just been created.
      if (session.state === "provisioning") session.state = state;
      else if (session.state === "booting-runtime" && state === "waiting-for-endpoint") session.state = state;
      if (state === "waiting-for-endpoint" && session.activation.instanceUpAt === null) session.activation.instanceUpAt = this.ports.clock.now();
      session.events.push({ at: this.ports.clock.now(), event: "runtime-boot", detail: event });
    });
  }
  async #recordDiscovery(id: string, host: string, detail: string): Promise<void> {
    await this.mutate((draft) => {
      const session = draft.gpuSessions.find((entry) => entry.id === id);
      if (!session || !isActivatingSession(session.state)) return;
      const at = this.ports.clock.now();
      session.activation.polls += 1;
      session.activation.lastDetail = detail;
      session.state = "health-checking";
      if (session.activation.instanceUpAt === null) session.activation.instanceUpAt = at;
      if (session.activation.endpointDiscoveredAt === null) {
        session.activation.endpointDiscoveredAt = at;
        session.endpointHost = host;
        session.events.push({ at, event: "endpoint-discovered", detail: `The runtime is serving on ${host}. Checking whether it can actually answer before AION routes anything to it.` });
      }
    });
  }
  async #noteHealthFailure(id: string, detail: string): Promise<void> {
    await this.mutate((draft) => {
      const session = draft.gpuSessions.find((entry) => entry.id === id);
      if (!session || !isActivatingSession(session.state)) return;
      const at = this.ports.clock.now();
      session.activation.polls += 1;
      session.activation.healthFailures += 1;
      session.activation.lastDetail = detail;
      session.events.push({ at, event: "health", detail: `Health check ${session.activation.healthFailures} of ${MAX_HEALTH_FAILURES} failed: ${detail}` });
    });
  }
  /**
   * Activation has failed. Say so, tear the machine down, and report what it cost.
   *
   * The state is set to `activation-failed` *before* the provider is asked to stop, so a teardown
   * that never confirms still leaves a session nothing will route to.
   */
  async #abandonActivation(id: string, reason: string, event: "readiness-expired" | "endpoint-refused" | "stop-requested"): Promise<void> {
    await this.mutate((draft) => {
      const session = draft.gpuSessions.find((entry) => entry.id === id);
      if (!session || isFinishedSession(session.state)) return;
      session.failureReason = reason;
      session.events.push({ at: this.ports.clock.now(), event, detail: reason });
    });
    try { await this.stopGpuSession(id, reason, { activationFailed: true }); }
    catch { /* stopGpuSession records its own failure; there is nothing further to try here */ }
  }
  /** Records that a session did some work, which is what the idle timeout measures against. */
  async touchGpuSession(id: string): Promise<void> {
    await this.mutate((state) => {
      const session = state.gpuSessions.find((entry) => entry.id === id);
      if (!session || (session.state !== "ready" && session.state !== "in-use")) return;
      const at = this.ports.clock.now();
      session.lastActivityAt = at;
      if (session.activation.firstInferenceAt === null) session.activation.firstInferenceAt = at;
      session.state = "in-use";
    });
  }
  /**
   * Stops a session, removes its endpoint, and confirms teardown.
   *
   * The endpoint is removed *first*, in its own write, before the provider is asked anything. A
   * stop that cannot be confirmed must still leave the router unable to reach a machine that may
   * already be gone — the alternative is chat requests failing against a dead address while AION
   * insists the endpoint is fine.
   *
   * `teardownConfirmed` is only ever set from the provider actually saying it stopped. If it says
   * otherwise, the session records that plainly and tells the owner to look themselves, because a
   * machine AION believes is off while it is still billing is the worst possible outcome.
   */
  async stopGpuSession(id: string, reason = "owner stop", options: { activationFailed?: boolean } = {}): Promise<GpuSessionV1> {
    const port = this.ports.gpu;
    if (!port) throw new Error("No GPU infrastructure provider is configured.");
    const snapshot = await this.snapshot();
    const existing = find(snapshot.gpuSessions, id, "GPU session");
    // Stopping something already stopped is not an error and must not produce a second teardown
    // call, a second Activity entry, or a second cost figure.
    if (isFinishedSession(existing.state)) return structuredClone(existing);
    if (!existing.instanceRef) throw new Error("That session never started, so there is nothing to stop.");

    const activationFailed = options.activationFailed ?? isActivatingSession(existing.state);
    await this.mutate((state) => {
      const session = find(state.gpuSessions, id, "GPU session");
      if (isFinishedSession(session.state)) return;
      session.state = "stopping";
      session.events.push({ at: this.ports.clock.now(), event: "stop-requested", detail: reason });
      this.#detachRentedEndpoint(state, session, "the rented session is stopping");
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    let outcome: { stopped: boolean; detail: string };
    try { outcome = await port.stop(existing.instanceRef, controller.signal); }
    catch (error) { outcome = { stopped: false, detail: redactCredentials(error instanceof Error ? error.message : "the provider did not answer") }; }
    finally { clearTimeout(timer); }

    return this.mutate((state) => {
      const stored = find(state.gpuSessions, id, "GPU session");
      const at = this.ports.clock.now();
      stored.stoppedAt = at;
      stored.measuredMinutes = runtimeMinutes({ ...stored, stoppedAt: at }, at);
      stored.estimatedCents = estimatedCents({ ...stored, stoppedAt: at }, at);
      stored.state = outcome.stopped ? (activationFailed ? "activation-failed" : "stopped") : "failed";
      stored.teardownConfirmed = outcome.stopped;
      if (!outcome.stopped) stored.failureReason = `AION could not confirm teardown: ${redactCredentials(outcome.detail)}`;
      stored.events.push({ at, event: outcome.stopped ? "teardown-confirmed" : "failed", detail: redactCredentials(outcome.detail) });
      const cost = sessionCostBreakdown(stored, at);
      this.activity(state, outcome.stopped ? "provider" : "failure", "gpu.stop",
        outcome.stopped
          ? `Rented session stopped after ${stored.measuredMinutes} minute(s), about ${stored.estimatedCents} cents (${cost.provisioningMinutes} provisioning, ${cost.readinessMinutes} loading, ${cost.servingMinutes} serving). ${activationFailed ? "It never became usable, so that was paid for boot time that produced nothing. " : ""}Teardown confirmed by the provider.`
          : `AION asked the provider to stop the session and did NOT get confirmation: ${redactCredentials(outcome.detail)} Check the provider console yourself — it may still be billing. The endpoint has been removed from routing either way.`,
        id, outcome.stopped ? "success" : "failed");
      return structuredClone(stored);
    });
  }
  /**
   * Takes a rented endpoint out of the Brain registry.
   *
   * Idempotent by construction: it works from whatever is actually in the registry rather than
   * from what the session believes, so calling it twice, or on a session whose endpoint was
   * already removed by hand, changes nothing the second time.
   */
  #detachRentedEndpoint(state: AssistantStateV1, session: GpuSessionV1, why: string): string | null {
    const endpointId = session.endpointId;
    if (!endpointId) return null;
    const endpoint = state.brain.endpoints.find((entry) => entry.id === endpointId);
    state.brain.endpoints = state.brain.endpoints.filter((entry) => entry.id !== endpointId);
    if (state.brain.primaryEndpointId === endpointId) state.brain.primaryEndpointId = OFFLINE_ENDPOINT_ID;
    if (state.brain.manualEndpointId === endpointId) {
      state.brain.manualEndpointId = "";
      // Manual mode with nothing chosen is not a valid configuration, and picking a replacement
      // would be AION deciding where the owner's context goes. It falls back to the policy that
      // never makes that decision on its own.
      if (state.brain.mode === "manual") state.brain.mode = "local-preferred";
    }
    session.endpointId = null;
    if (!endpoint) return null;
    const at = this.ports.clock.now();
    session.events.push({ at, event: "endpoint-removed", detail: `"${endpoint.label}" was removed from the Brain because ${why}. Nothing AION knows was affected.` });
    this.activity(state, "provider", "gpu.endpoint.remove", `Rented endpoint "${endpoint.label}" removed from the Brain because ${why}. Every workspace, Memory record, and piece of evidence is untouched: a model is a reasoning provider, not where your information lives.`, session.id);
    return endpointId;
  }
  /**
   * Enforces every stop condition from stored state.
   *
   * Called on the ordinary scheduler tick and on startup, so a session outlives neither its
   * deadline nor the process that created it. Reading the deadline from state rather than from a
   * timer is the whole design: whatever runs next reaches the same conclusion.
   *
   * The readiness allowance is enforced here too. A session that was still booting when AION was
   * closed would otherwise wait forever, which is the most expensive way to fail.
   */
  async enforceGpuLimits(healthy = true): Promise<Array<{ sessionId: string; trigger: string; stopped: boolean }>> {
    const state = await this.snapshot();
    const now = this.ports.clock.now();
    const results: Array<{ sessionId: string; trigger: string; stopped: boolean }> = [];
    for (const session of state.gpuSessions.filter((entry) => isLiveSession(entry.state))) {
      const decision = shutdownDecision(session, now, healthy);
      const readiness = readinessVerdict(session, now);
      const trigger = decision.stop ? decision.trigger : readiness.expired ? "readiness" : "none";
      if (trigger === "none") continue;
      const reason = decision.stop ? decision.reason : readiness.reason;
      try {
        await this.stopGpuSession(session.id, `${trigger}: ${reason}`, { activationFailed: isActivatingSession(session.state) });
        results.push({ sessionId: session.id, trigger, stopped: true });
      } catch {
        results.push({ sessionId: session.id, trigger, stopped: false });
      }
    }
    return results;
  }
  /**
   * Reconciles rented sessions against the provider after a restart.
   *
   * Three rules, in order. Stop conditions are enforced *first*, before anything is reconnected,
   * so a session that outlived its deadline is torn down rather than resumed. Then the provider is
   * asked what actually exists, and local belief yields to it — a session AION thinks is ready but
   * the provider says is gone is recorded as gone. And nothing here ever calls `start`: uncertainty
   * about local state is never a reason to create a second machine somebody has to pay for.
   */
  async reconcileGpuSessions(): Promise<Array<{ sessionId: string; state: GpuSessionStateV1; action: string }>> {
    const port = this.ports.gpu;
    if (!port) return [];
    await this.enforceGpuLimits();
    const state = await this.snapshot();
    const results: Array<{ sessionId: string; state: GpuSessionStateV1; action: string }> = [];
    for (const session of state.gpuSessions.filter((entry) => isLiveSession(entry.state))) {
      if (!session.instanceRef) continue;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      let observed: { state: string; detail: string; endpointUrl: string | null } | null = null;
      let failure = "";
      try { observed = await port.status(session.instanceRef, controller.signal); }
      catch (error) { failure = redactCredentials(error instanceof Error ? error.message : "the provider did not answer"); }
      finally { clearTimeout(timer); }

      if (!observed) {
        // The provider is unreachable. AION does not guess in either direction: it does not resume
        // routing to a machine it cannot confirm, and it does not create anything.
        await this.mutate((draft) => {
          const stored = draft.gpuSessions.find((entry) => entry.id === session.id);
          if (!stored) return;
          this.#detachRentedEndpoint(draft, stored, `AION could not reach ${port.provider} to confirm the machine still exists`);
          stored.activation.lastDetail = failure;
          stored.events.push({ at: this.ports.clock.now(), event: "reconciled", detail: `The provider did not answer on startup: ${failure} The endpoint is withdrawn from routing until it does. AION has not created anything to replace it.` });
        });
        results.push({ sessionId: session.id, state: session.state, action: "provider-unreachable" });
        continue;
      }
      if (observed.state === "stopped" || observed.state === "failed") {
        await this.#markSessionGone(session.id, `The provider reports the machine is ${observed.state}: ${redactCredentials(observed.detail)}`);
        results.push({ sessionId: session.id, state: "stopped", action: "already-gone" });
        continue;
      }
      // The machine is genuinely still there. An activating session resumes where it was; a ready
      // one keeps its endpoint if the endpoint is still in the registry, and is re-verified from
      // scratch if it is not. Neither path provisions anything.
      if (isActivatingSession(session.state)) {
        const status = await this.pollGpuReadiness(session.id);
        results.push({ sessionId: session.id, state: status.state, action: "resumed-activation" });
        continue;
      }
      const endpointPresent = session.endpointId !== null && state.brain.endpoints.some((entry) => entry.id === session.endpointId);
      if (endpointPresent) {
        results.push({ sessionId: session.id, state: session.state, action: "endpoint-intact" });
        continue;
      }
      await this.mutate((draft) => {
        const stored = draft.gpuSessions.find((entry) => entry.id === session.id);
        if (!stored) return;
        stored.endpointId = null;
        stored.state = "waiting-for-endpoint";
        stored.events.push({ at: this.ports.clock.now(), event: "reconciled", detail: "The machine is still running but its endpoint is no longer registered, so AION is re-verifying it from scratch rather than assuming it still answers." });
      });
      const status = await this.pollGpuReadiness(session.id);
      results.push({ sessionId: session.id, state: status.state, action: "re-verified" });
    }
    return results;
  }
  /** The provider says the machine is gone. Record that; never resurrect it. */
  async #markSessionGone(id: string, reason: string): Promise<void> {
    await this.mutate((state) => {
      const session = state.gpuSessions.find((entry) => entry.id === id);
      if (!session || isFinishedSession(session.state)) return;
      const at = this.ports.clock.now();
      const activating = isActivatingSession(session.state);
      this.#detachRentedEndpoint(state, session, "the provider says the machine no longer exists");
      session.stoppedAt = at;
      session.measuredMinutes = runtimeMinutes({ ...session, stoppedAt: at }, at);
      session.estimatedCents = estimatedCents({ ...session, stoppedAt: at }, at);
      session.state = activating ? "activation-failed" : "stopped";
      session.teardownConfirmed = true;
      session.failureReason = reason;
      session.events.push({ at, event: "reconciled", detail: reason });
      this.activity(state, "provider", "gpu.reconcile", `${reason} AION recorded it as finished after about ${session.estimatedCents} cents and created nothing to replace it.`, id);
    });
  }
  /** The activation picture for one session, for the UI and for whoever is polling. */
  #activationStatus(state: AssistantStateV1, id: string, detail: string): GpuActivationStatusV1 {
    const session = find(state.gpuSessions, id, "GPU session");
    const now = this.ports.clock.now();
    return {
      sessionId: session.id,
      state: session.state,
      label: sessionStatusLabel(session.state),
      endpointId: session.endpointId,
      endpointHost: session.endpointHost,
      ready: session.state === "ready" || session.state === "in-use",
      finished: isFinishedSession(session.state),
      detail: redactCredentials(detail),
      readiness: readinessVerdict(session, now),
      cost: sessionCostBreakdown(session, now),
      standing: sessionStanding(session, now),
    };
  }
  async gpuActivation(id: string): Promise<GpuActivationStatusV1> {
    return this.#activationStatus(await this.snapshot(), id, "Current activation state, read from stored state.");
  }
  /**
   * Waits for a session to become usable, or stops it.
   *
   * A bounded loop over `pollGpuReadiness`, which is where all the judgement lives. This adds only
   * the waiting, and every iteration re-reads stored state rather than trusting anything it
   * computed before it slept — the process may have been asleep for minutes, and the deadline it
   * checked at the start may have passed while it was.
   */
  async activateGpuSession(id: string, options: { intervalMs?: number; maxPolls?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<GpuActivationStatusV1> {
    const intervalMs = Number.isSafeInteger(options.intervalMs) && options.intervalMs! > 0 ? options.intervalMs! : DEFAULT_READINESS_INTERVAL_MS;
    const maxPolls = Number.isSafeInteger(options.maxPolls) && options.maxPolls! > 0 ? options.maxPolls! : 240;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
    let status = await this.pollGpuReadiness(id);
    for (let poll = 1; poll < maxPolls && !status.ready && !status.finished; poll += 1) {
      await sleep(intervalMs);
      status = await this.pollGpuReadiness(id);
    }
    if (!status.ready && !status.finished) {
      // The loop ran out before the stored deadline did. That is a bug in whoever called it, not a
      // reason to keep a machine running: AION stops it and says which limit it actually hit.
      await this.#abandonActivation(id, `AION stopped checking after ${maxPolls} attempts without the endpoint becoming usable. The machine is being stopped rather than left running unattended.`, "readiness-expired");
      return this.#activationStatus(await this.snapshot(), id, "Activation gave up after the maximum number of checks.");
    }
    return status;
  }
  async gpuSessions(): Promise<Array<GpuSessionV1 & { standing: string; label: string; decision: ReturnType<typeof shutdownDecision>; readiness: ReadinessVerdictV1; cost: GpuCostBreakdownV1 }>> {
    const state = await this.snapshot();
    const now = this.ports.clock.now();
    return state.gpuSessions.map((entry) => ({
      ...structuredClone(entry),
      standing: sessionStanding(entry, now),
      label: sessionStatusLabel(entry.state),
      decision: shutdownDecision(entry, now),
      readiness: readinessVerdict(entry, now),
      cost: sessionCostBreakdown(entry, now),
    }));
  }
  async gpuProposals(): Promise<Array<GpuProvisioningProposalV1 & { disclosure: string }>> {
    const state = await this.snapshot();
    return state.gpuProposals.map((entry) => ({ ...structuredClone(entry), disclosure: describeProposal(entry) }));
  }
  /**
   * Records one measured inference. Nothing is estimated into existence: a token count is stored
   * only when the runtime reported one, and a cost only where a rate was actually known.
   */
  async recordUsage(input: Record<string, unknown> = {}): Promise<InferenceUsageV1> {
    return this.mutate((state) => {
      const record = buildUsage(input, { id: this.ports.ids.next("usage"), now: this.ports.clock.now() });
      state.usage.unshift(record);
      if (state.usage.length > 5000) state.usage.length = 5000;
      return structuredClone(record);
    });
  }
  /**
   * The rent-versus-buy evidence, and an honest refusal to have an opinion without enough of it.
   * Buying hardware is a decision worth hundreds of pounds; AION does not make it on three
   * requests, and says so plainly rather than producing a number that looks like analysis.
   */
  async costIntelligence(): Promise<CostIntelligenceV1 & { summary: string }> {
    const state = await this.snapshot();
    const intelligence = costIntelligence(state.usage, state.gpuSessions, V13_BUDGET_CEILING_CENTS);
    return { ...intelligence, summary: usageSummary(intelligence) };
  }
  /** Model profiles as owner-editable planning estimates, labelled as such wherever shown. */
  modelProfiles(): { local: readonly ModelProfileV1[]; rented: readonly ModelProfileV1[]; ceilingCents: number; note: string } {
    return {
      local: LOCAL_MODEL_PROFILES, rented: OPEN_MODEL_PROFILES, ceilingCents: V13_BUDGET_CEILING_CENTS,
      note: "VRAM figures are planning estimates for a common quantisation, not guarantees. AION did not measure them and does not download anything.",
    };
  }

  // --- Governed research ------------------------------------------------------------------------
  /**
   * Proposes a research job. Proposing runs nothing: the job records the question, the scope, the
   * limits and the sources the owner supplied, and then waits for an approval like any other
   * consequential action.
   */
  async proposeResearchJob(input: Record<string, unknown> = {}): Promise<ResearchJobV1> {
    return this.mutate((state) => {
      const workspace = requireWorkspace(state.workspaces, state.settings.activeWorkspace);
      const job = buildResearchJob(input, { id: this.ports.ids.next("research"), workspace: workspace.id, now: this.ports.clock.now() });
      state.researchJobs.unshift(job);
      if (state.researchJobs.length > 200) state.researchJobs.length = 200;
      const provider = this.ports.research;
      this.activity(state, "agent", "research.propose", `Research job proposed in "${workspace.label}": ${job.scope} scope, at most ${job.limits.maxSources} source(s), at most ${job.limits.maxCostCents} cent(s). ${provider ? `Provider ${provider.id}${provider.reachesNetwork ? " reaches the network" : " performs no network request"}.` : "No research provider is configured, so this cannot run."}`, job.id, "pending");
      return structuredClone(job);
    });
  }
  /**
   * Runs an approved job.
   *
   * The state machine is the governance: a job can only run from `approved`, an approval is the
   * owner's act, and a job that has already produced a result cannot be re-run into a different
   * one. Every finding is checked against the sources the provider actually returned before it is
   * stored, so a citation always points at something.
   */
  async approveResearchJob(id: string): Promise<ResearchJobV1> {
    return this.mutate((state) => {
      const job = find(state.researchJobs, id, "Research job");
      assertSameWorkspace(job, state.settings.activeWorkspace, "research job");
      if (job.state !== "proposed") throw new Error("Only a proposed research job can be approved.");
      job.state = "approved";
      this.activity(state, "approval", "research.approve", `Research job approved: "${job.question}".`, id);
      return structuredClone(job);
    });
  }
  async runResearchJob(id: string): Promise<ResearchJobV1> {
    const snapshot = await this.snapshot();
    const pending = find(snapshot.researchJobs, id, "Research job");
    if (pending.state !== "approved") throw new Error("A research job must be approved before it runs.");
    // A job that cannot run because nothing is configured is refused, recorded, and left approved
    // rather than marked failed. Nothing about it was wrong, and it should run unchanged once the
    // owner configures a provider — forcing them to propose it again would be pure ceremony.
    const provider = this.ports.research;
    const health = provider ? await provider.health() : { available: false, detail: "No research provider is configured. AION ships without one and will not reach the internet until you configure an owner-controlled provider." };
    if (!health.available) {
      await this.mutate((state) => { this.activity(state, "agent", "research.unavailable", `Research job "${pending.question}" could not run: ${health.detail} The job stays approved and will run unchanged once a provider is configured.`, id, "denied"); });
      throw new Error(health.detail);
    }

    const controller = new AbortController();
    this.controllers.set(`research:${id}`, controller);
    const timer = setTimeout(() => controller.abort(), pending.limits.maxDurationMs);
    try {
      await this.mutate((state) => { find(state.researchJobs, id, "Research job").state = "running"; });
      const raw = await provider!.run({ question: pending.question, scope: pending.scope, limits: pending.limits, seedReferences: pending.seedReferences, signal: controller.signal });
      return await this.mutate((state) => {
        const job = find(state.researchJobs, id, "Research job");
        const { job: completed, dropped } = applyResearchResult(job, raw, { now: this.ports.clock.now(), nextId: (kind) => this.ports.ids.next(kind), digest: digestValue });
        state.researchJobs = state.researchJobs.map((entry) => entry.id === id ? completed : entry);
        this.activity(state, "agent", "research.complete", `${researchSummary(completed)}${dropped ? ` ${dropped} uncited finding(s) were discarded.` : ""} Provider ${provider!.id}; ${completed.costCents} cent(s) spent.`, id);
        return structuredClone(completed);
      });
    } catch (error) {
      await this.mutate((state) => {
        const job = find(state.researchJobs, id, "Research job");
        job.state = "failed";
        job.failureReason = "The research job failed or was cancelled; private details are omitted.";
        job.completedAt = this.ports.clock.now();
        this.activity(state, "failure", "research.fail", job.failureReason, id, "failed");
      });
      throw error;
    } finally { clearTimeout(timer); this.controllers.delete(`research:${id}`); }
  }
  cancelResearchJob(id: string): boolean { const controller = this.controllers.get(`research:${id}`); if (!controller) return false; controller.abort(); return true; }
  /**
   * Carries a research finding into an opportunity as a typed claim.
   *
   * This is the only path from research into Product Studio, and it deliberately cannot produce a
   * fact: a finding arrives as the class the provider gave it, cites the job it came from, and
   * waits for the owner to promote it if they check it.
   */
  async adoptResearchFinding(jobId: string, findingId: string, opportunityId: string): Promise<OpportunityV1> {
    const snapshot = await this.snapshot();
    const job = find(snapshot.researchJobs, jobId, "Research job");
    if (job.state !== "complete") throw new Error("Only a completed research job has findings to adopt.");
    const finding = find(job.findings, findingId, "Finding");
    const sources = finding.sourceIds.map((sourceId) => find(job.sources, sourceId, "Source").reference);
    return this.mutate((state) => {
      const opportunity = this.#findOpportunity(state, opportunityId);
      assertSameWorkspace(job, opportunity.workspace, "research job");
      const claim = buildClaim(
        { class: finding.class, statement: finding.statement, confidence: finding.confidence, supportedBy: [`research:${jobId}`, ...sources] },
        { id: this.ports.ids.next("claim"), workspace: opportunity.workspace, now: this.ports.clock.now(), actor: "research", sourceRef: `research:${jobId}` },
      );
      const updated = {
        ...structuredClone(opportunity),
        claims: [...opportunity.claims, claim],
        researchJobIds: opportunity.researchJobIds.includes(jobId) ? opportunity.researchJobIds : [...opportunity.researchJobIds, jobId],
        updatedAt: this.ports.clock.now(),
      };
      this.activity(state, "plan", "opportunity.research", `A research ${claim.class} was carried into "${opportunity.title}" with its sources. It is not a fact until you say so.`, opportunityId);
      return this.#replaceOpportunity(state, updated);
    });
  }
  /**
   * The research agent's reading of a completed job.
   *
   * Nothing here is stored as knowledge: it plans, compares, and reports, and the learning it
   * proposes is limited to the three classes a non-owner actor may produce. Agreement between
   * pages is not verification, so even a well-supported statement arrives as an observation.
   */
  async analyseResearchJob(id: string): Promise<{
    plan: ResearchPlanV1;
    synthesis: ResearchSynthesisV1;
    proposedLearning: ReturnType<typeof proposeLearning>;
    trace: ReturnType<typeof describeRun>;
  }> {
    const state = await this.snapshot();
    const job = find(state.researchJobs, id, "Research job");
    assertSameWorkspace(job, state.settings.activeWorkspace, "research job");
    const plan = planResearch(job.question, job.scope);
    const synthesis = synthesise(job);
    return { plan, synthesis, proposedLearning: proposeLearning(synthesis), trace: describeRun(plan, job, synthesis, this.ports.clock.now()) };
  }
  /**
   * Carries an agent proposal into the learning loop as a lesson.
   *
   * It arrives at whatever class the agent produced, with its sources cited, and the owner
   * promotes it if they check it. There is deliberately no path from research straight to a fact.
   */
  async adoptResearchLearning(jobId: string, index: number): Promise<LessonV1> {
    const analysis = await this.analyseResearchJob(jobId);
    const proposal = analysis.proposedLearning[index];
    if (!proposal) throw new Error("That proposed lesson does not exist.");
    return this.recordLesson(
      { class: proposal.class, statement: proposal.statement, supportedBy: [`research:${jobId}`, ...proposal.supportedBy], confidence: proposal.confidence, guidance: "" },
      "provider-proposal",
    );
  }
  async researchJobs(): Promise<ResearchJobV1[]> {
    const state = await this.snapshot();
    return state.researchJobs.filter((entry) => entry.workspace === state.settings.activeWorkspace).map((entry) => structuredClone(entry));
  }
  /** What a research provider would be allowed to fetch, decided before anything is requested. */
  checkResearchUrl(candidate: string): UrlVerdictV1 { return evaluateResearchUrl(candidate); }

  // --- Sales coaching, routine templates, and owner-entered metrics ---------------------------
  /**
   * Deterministic coaching over what the owner recorded. No model is called, so this works
   * offline and identically every time. A draft is only ever a draft: AION sends nothing.
   */
  async coach(kind: string, input: { customerId?: string; channel?: string; objection?: string; scenario?: string; onDate?: string } = {}): Promise<CoachOutputV1> {
    const state = await this.snapshot();
    if (state.settings.activeWorkspace !== "work") throw new Error("Sales coaching is only available in the Work workspace.");
    const now = this.ports.clock.now();
    const onDate = input.onDate ?? now.slice(0, 10);
    const scoped = this.#scopedRelationships(state);
    const customer = () => this.#findRelationship(state, required(input.customerId, "Customer", 200));
    switch (kind) {
      case "call-preparation": return callPreparation(customer());
      case "appointment-preparation": return appointmentPreparation(customer());
      case "follow-up-draft": return followUpDraft(customer(), (input.channel ?? "text") as ContactChannelV1);
      case "objection-prompts": return objectionPrompts(required(input.objection, "Objection", 500));
      case "discovery-questions": return discoveryQuestions(customer());
      case "next-action": return nextActionSuggestion(customer());
      case "follow-up-queue": return followUpQueue(scoped, onDate, now);
      case "morning-plan": return morningPlan(scoped, onDate, now);
      case "end-of-day-recap": return endOfDayRecap(scoped, onDate);
      case "role-play": return rolePlay(customer(), required(input.scenario, "Scenario", 500));
      default: throw new Error("Coaching kind is not recognised.");
    }
  }
  /** Templates the owner may choose to create. Nothing here schedules or enables itself. */
  salesRoutineTemplates(): readonly SalesRoutineTemplateV1[] { return SALES_ROUTINE_TEMPLATES; }
  async createRoutineFromTemplate(templateId: string): Promise<RoutineV1> {
    const template = SALES_ROUTINE_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) throw new Error("Sales routine template is not recognised.");
    const state = await this.snapshot();
    if (state.settings.activeWorkspace !== "work") throw new Error("Sales routines belong to the Work workspace.");
    return this.createRoutine({ name: template.name, instructions: template.instructions, intervalMinutes: template.intervalMinutes });
  }
  /** Records the owner's own count for one day. Re-entering a day replaces that day's numbers. */
  async recordSalesMetrics(date: string, counts: Record<string, unknown> = {}, note = ""): Promise<SalesMetricsEntryV1> {
    return this.mutate((state) => {
      this.#requireWorkWorkspace(state);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) throw new Error("Metrics date must be an explicit YYYY-MM-DD day.");
      const unexpected = Object.keys(counts).filter((key) => !(SALES_COUNT_KEYS as readonly string[]).includes(key));
      if (unexpected.length) throw new Error(`Metrics accept only ${SALES_COUNT_KEYS.join(", ")}; unexpected field(s): ${unexpected.join(", ")}.`);
      const tallied = {} as SalesCountsV1;
      for (const key of SALES_COUNT_KEYS) {
        const value = counts[key] ?? 0;
        if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10_000) throw new Error(`Metric ${key} must be a whole number between 0 and 10000.`);
        tallied[key] = value as number;
      }
      const at = this.ports.clock.now();
      const existing = state.salesMetrics.find((entry) => entry.date === date);
      const record: SalesMetricsEntryV1 = existing
        ? { ...existing, counts: tallied, note: note.slice(0, 2000), updatedAt: at }
        : { id: this.ports.ids.next("metrics"), workspace: "work", date, counts: tallied, note: note.slice(0, 2000), origin: "owner-created", createdAt: at, updatedAt: at };
      state.salesMetrics = [record, ...state.salesMetrics.filter((entry) => entry.date !== date)].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 1000);
      this.activity(state, "task", "sales.metrics", `Owner-entered activity recorded for ${date}. These are your own counts, not a dealership system's.`, record.id);
      return structuredClone(record);
    });
  }
  /** Daily and range summaries over owner-entered counts only. Nothing is inferred or imported. */
  async salesSummary(fromDate: string, toDate: string): Promise<{ from: string; to: string; days: number; entered: number; totals: SalesCountsV1; daily: SalesMetricsEntryV1[]; source: string }> {
    const state = await this.snapshot();
    if (state.settings.activeWorkspace !== "work") throw new Error("Sales metrics are only available in the Work workspace.");
    for (const [label, value] of [["from", fromDate], ["to", toDate]] as const) if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error(`Summary ${label} date must be YYYY-MM-DD.`);
    if (toDate < fromDate) throw new Error("Summary range is inverted.");
    const daily = state.salesMetrics.filter((entry) => entry.date >= fromDate && entry.date <= toDate).sort((a, b) => a.date.localeCompare(b.date));
    const totals = {} as SalesCountsV1;
    for (const key of SALES_COUNT_KEYS) totals[key] = daily.reduce((sum, entry) => sum + entry.counts[key], 0);
    const days = Math.round((Date.parse(`${toDate}T00:00:00.000Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) / 86_400_000) + 1;
    return { from: fromDate, to: toDate, days, entered: daily.length, totals, daily, source: "Owner-entered counts recorded in AION. Not a dealership CRM figure." };
  }

  // --- Phone access: pairing, sessions, revocation ---------------------------------------------
  /**
   * Issues a one-time pairing code. This is the only moment the code exists outside the owner's
   * screen: AION stores its digest, and no later call can reveal it.
   */
  async createPairingCode(label: string): Promise<{ code: string; expiresAt: string; label: string }> {
    return this.mutate((state) => {
      if (!state.settings.remoteAccess.enabled) throw new Error("Turn on private phone access in Settings before pairing a device.");
      const { token, code } = issuePairingToken(state, label, this.ports.ids.next("pairing"), this.ports.clock.now());
      this.activity(state, "settings", "device.pair.code", `A one-time pairing code was issued for "${token.label}". It expires in ${PAIRING_TTL_MINUTES} minutes and can be used once. The code itself is not stored.`, token.id);
      return { code, expiresAt: token.expiresAt, label: token.label };
    });
  }
  /** Redeems a code for a session token. Rate-limited, single-use, and returned exactly once. */
  async pairDevice(code: string, rateKey = "pair"): Promise<{ token: string; deviceId: string; expiresAt: string; label: string }> {
    /*
     * The failed-attempt counter has to survive a rejected attempt, so this deliberately does not
     * throw from inside the write. A throw would abandon the draft and discard the very increment
     * that makes rate limiting work, leaving pairing open to unlimited guessing.
     */
    const outcome = await this.mutate((state) => {
      const now = this.ports.clock.now();
      if (!state.settings.remoteAccess.enabled) return { ok: false as const, message: "Private phone access is turned off." };
      const limit = checkRateLimit(state, rateKey, now);
      if (!limit.allowed) {
        this.activity(state, "failure", "device.pair.throttled", "Pairing attempts are temporarily blocked after repeated failures.", null, "denied");
        return { ok: false as const, message: `Too many attempts. Try again in ${limit.retryAfterSeconds} seconds.` };
      }
      try {
        const result = redeemPairingCode(state, code, { deviceId: this.ports.ids.next("device"), sessionId: this.ports.ids.next("session") }, now, state.settings.remoteAccess.sessionDays);
        clearRateLimit(state, rateKey);
        this.activity(state, "settings", "device.paired", `Device "${result.device.label}" paired. Its session expires ${result.session.expiresAt} and can be revoked at any time.`, result.device.id);
        return { ok: true as const, value: { token: result.token, deviceId: result.device.id, expiresAt: result.session.expiresAt, label: result.device.label } };
      } catch (error) {
        recordFailure(state, rateKey, now);
        this.activity(state, "failure", "device.pair.rejected", "A pairing attempt was rejected. No code or token is recorded.", null, "denied");
        return { ok: false as const, message: error instanceof Error ? error.message : "Pairing failed." };
      }
    });
    if (!outcome.ok) throw new Error(outcome.message);
    return outcome.value;
  }
  /** Resolves a bearer token. Never records the token, and fails closed on anything unusual. */
  async authenticateDevice(token: string): Promise<{ deviceId: string; label: string; expiresAt: string } | null> {
    const state = await this.snapshot();
    const found = authenticate(state, token, this.ports.clock.now());
    if (!found) return null;
    return { deviceId: found.device.id, label: found.device.label, expiresAt: found.session.expiresAt };
  }
  async touchDevice(deviceId: string): Promise<void> {
    await this.mutate((state) => {
      const device = state.devices.find((entry) => entry.id === deviceId);
      if (device) device.lastSeenAt = this.ports.clock.now();
      for (const session of state.sessions) if (session.deviceId === deviceId && !session.revokedAt) session.lastSeenAt = this.ports.clock.now();
    });
  }
  /** Revoking a phone ends its access and touches no owner record whatsoever. */
  async revokeDevice(deviceId: string): Promise<{ sessionsEnded: number }> {
    return this.mutate((state) => {
      const ended = revokeDevice(state, deviceId, this.ports.clock.now());
      this.activity(state, "settings", "device.revoked", `A paired device was revoked and ${ended} session(s) ended. No conversation, memory, task, relationship, or Career record was changed.`, deviceId);
      return { sessionsEnded: ended };
    });
  }
  async revokeAllDevices(): Promise<{ devices: number; sessions: number }> {
    return this.mutate((state) => {
      const result = revokeAllDevices(state, this.ports.clock.now());
      this.activity(state, "settings", "device.revoked.all", `Signed out every device: ${result.devices} device(s), ${result.sessions} session(s), and any outstanding pairing code. Owner data is untouched.`, null);
      return result;
    });
  }
  /** What Settings shows. Digests and tokens are never included. */
  async deviceInventory(): Promise<Array<{ id: string; label: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null; activeSessions: number; expiresAt: string | null }>> {
    const state = await this.snapshot();
    const now = Date.parse(this.ports.clock.now());
    return state.devices.map((device) => {
      const live = state.sessions.filter((entry) => entry.deviceId === device.id && !entry.revokedAt && Date.parse(entry.expiresAt) > now);
      return { id: device.id, label: device.label, createdAt: device.createdAt, lastSeenAt: device.lastSeenAt, revokedAt: device.revokedAt, activeSessions: live.length, expiresAt: live[0]?.expiresAt ?? null };
    });
  }

  /** Latest phone-intake document timestamp (for Mobile status). No secrets. */
  async lastPhoneIntakeAt(): Promise<string | null> {
    const state = await this.snapshot();
    const docs = Array.isArray(state.crmDocuments) ? state.crmDocuments : [];
    let best: string | null = null;
    for (const d of docs) {
      const tags = Array.isArray(d.tags) ? d.tags : [];
      if (!tags.some((t) => /phone-intake/i.test(String(t)))) continue;
      const at = d.createdAt || d.updatedAt || null;
      if (at && (!best || at > best)) best = at;
    }
    return best;
  }

  async createPrivateBackup(destination: string, passphrase: string): Promise<{ digest: string; bytes: number }> { const state = await this.snapshot(); const result = await this.ports.backup.create(state, destination, passphrase); await this.mutate((draft) => { this.activity(draft, "export", "backup.create", `Encrypted private backup verified (${result.bytes} bytes).`, `backup:${result.digest.slice(0, 16)}`); }); return result; }
  async verifyPrivateBackup(destination: string, passphrase: string): Promise<AssistantStateV1> { const state = await this.ports.backup.restore(destination, passphrase); await this.mutate((draft) => { this.activity(draft, "export", "backup.verify", "Encrypted private backup integrity and restore validated.", null); }); return state; }

  // --- R7.1 Owner knowledge + brand collaborators -----------------------------------------------

  async getOwnerKnowledge(): Promise<OwnerKnowledgeStateV1> {
    const state = await this.snapshot();
    return state.ownerKnowledge ?? emptyOwnerKnowledge();
  }

  async updateOwnerProfile(change: Record<string, unknown> = {}): Promise<OwnerKnowledgeStateV1> {
    return this.mutate((draft) => {
      if (!draft.ownerKnowledge) draft.ownerKnowledge = emptyOwnerKnowledge();
      const now = this.ports.clock.now();
      draft.ownerKnowledge.profile = applyOwnerProfileSummary(draft.ownerKnowledge.profile, change, now);
      this.activity(draft, "settings", "owner.profile", "Owner profile summary updated.", "owner-profile");
      return draft.ownerKnowledge;
    });
  }

  async addOwnerKnowledgeFact(input: Record<string, unknown> = {}): Promise<OwnerKnowledgeFactV1> {
    return this.mutate((draft) => {
      if (!draft.ownerKnowledge) draft.ownerKnowledge = emptyOwnerKnowledge();
      const now = this.ports.clock.now();
      const fact = buildOwnerKnowledgeFact(input, { id: this.ports.ids.next("owner-fact"), now });
      draft.ownerKnowledge.facts.unshift(fact);
      if (draft.ownerKnowledge.facts.length > 1000) draft.ownerKnowledge.facts.length = 1000;
      this.activity(draft, "memory", "owner.knowledge", `Owner knowledge: ${fact.category} — ${fact.title}`, fact.id);
      return fact;
    });
  }

  async correctOwnerKnowledgeFact(id: string, content: string, reason: string): Promise<OwnerKnowledgeFactV1> {
    return this.mutate((draft) => {
      if (!draft.ownerKnowledge) draft.ownerKnowledge = emptyOwnerKnowledge();
      const idx = draft.ownerKnowledge.facts.findIndex((f) => f.id === id);
      if (idx < 0) throw new Error("Owner knowledge fact not found.");
      const now = this.ports.clock.now();
      const next = correctOwnerKnowledgeFact(draft.ownerKnowledge.facts[idx]!, content, reason, now);
      draft.ownerKnowledge.facts[idx] = next;
      this.activity(draft, "memory", "owner.knowledge.correct", `Corrected: ${next.title}`, next.id);
      return next;
    });
  }

  async setOwnerKnowledgeEnabled(id: string, enabled: boolean): Promise<OwnerKnowledgeFactV1> {
    return this.mutate((draft) => {
      if (!draft.ownerKnowledge) draft.ownerKnowledge = emptyOwnerKnowledge();
      const fact = draft.ownerKnowledge.facts.find((f) => f.id === id);
      if (!fact) throw new Error("Owner knowledge fact not found.");
      fact.enabled = enabled === true;
      fact.updatedAt = this.ports.clock.now();
      return fact;
    });
  }

  /**
   * Deterministic knowledge quality: disable exact duplicate facts (same category+title+content).
   * Keeps the newest enabled fact; does not erase history (disabled, not deleted).
   */
  async dedupeOwnerKnowledgeFacts(): Promise<{
    examined: number;
    duplicatesDisabled: number;
    enabledRemaining: number;
    keys: string[];
  }> {
    return this.mutate((draft) => {
      if (!draft.ownerKnowledge) draft.ownerKnowledge = emptyOwnerKnowledge();
      const now = this.ports.clock.now();
      const facts = draft.ownerKnowledge.facts;
      const byKey = new Map<string, typeof facts>();
      for (const f of facts) {
        const key = `${f.category}::${f.title.trim().toLowerCase()}::${f.content.trim().toLowerCase()}`;
        const list = byKey.get(key) ?? [];
        list.push(f);
        byKey.set(key, list);
      }
      let duplicatesDisabled = 0;
      const keys: string[] = [];
      for (const [key, group] of byKey) {
        if (group.length < 2) continue;
        keys.push(key.slice(0, 120));
        // Keep newest by updatedAt; disable others that are enabled
        const sorted = [...group].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        for (const f of sorted.slice(1)) {
          if (f.enabled) {
            f.enabled = false;
            f.updatedAt = now;
            duplicatesDisabled += 1;
          }
        }
      }
      this.activity(
        draft,
        "memory",
        "owner.knowledge.dedupe",
        `Knowledge dedupe: disabled ${duplicatesDisabled} exact duplicate fact(s)`,
        null,
      );
      return {
        examined: facts.length,
        duplicatesDisabled,
        enabledRemaining: facts.filter((f) => f.enabled).length,
        keys: keys.slice(0, 40),
      };
    });
  }

  /** Coverage / gap report for Owner knowledge (counts only — no invented content). */
  async ownerKnowledgeCoverageReport(): Promise<{
    totals: {
      factsEnabled: number;
      factsDisabled: number;
      documents: number;
      relationships: number;
      temporalFacts: number;
      commitments: number;
      opportunities: number;
      reviewOpen: number;
      brandWorkspaces: number;
      e2eSyntheticWorkspaces: number;
    };
    byCategory: Record<string, number>;
    workspacesPopulated: string[];
    approvedImportRoots: string[];
    topGaps: string[];
    syntheticMarkers: string[];
    realVsSynthetic: { realOwnerDocuments: number; syntheticOrTestDocuments: number };
  }> {
    const state = await this.snapshot();
    const facts = state.ownerKnowledge?.facts ?? [];
    const byCategory: Record<string, number> = {};
    for (const f of facts.filter((x) => x.enabled)) {
      byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    }
    const docs = state.crmDocuments ?? [];
    const syntheticMarkers: string[] = [];
    let syntheticOrTestDocuments = 0;
    let realOwnerDocuments = 0;
    for (const d of docs) {
      const blob = `${d.filename} ${d.summary} ${d.extractedText} ${d.sourceRootPath || ""} ${d.tags?.join(" ") || ""}`.toLowerCase();
      const synthetic =
        /synthetic|e2e|fixture|smoke|example\.test|runway first-source|aion-smoke|temp\\aion|acme-r7/.test(blob);
      if (synthetic) {
        syntheticOrTestDocuments += 1;
        if (syntheticMarkers.length < 12) syntheticMarkers.push(d.filename);
      } else {
        realOwnerDocuments += 1;
      }
    }
    const brands = state.workspaces.filter((w) => w.kind === "business" && !w.archived);
    const e2e = brands.filter((w) => /e2e/i.test(w.label || w.id));
    const gaps: string[] = [];
    if (!byCategory.profile) gaps.push("No Owner profile fact (display name / identity summary).");
    if (!byCategory.role && !byCategory.employment) gaps.push("No current role/employment assertion beyond synthetic pack.");
    if (!byCategory.customer && !byCategory.prospect)
      gaps.push("No Owner-asserted customer/prospect knowledge facts (CRM may have records separately).");
    if (!byCategory.brand && !byCategory.business)
      gaps.push("No non-synthetic brand/business DNA knowledge beyond import stubs.");
    if (!byCategory.goal) gaps.push("No Owner goals recorded.");
    if (!byCategory.collaborator) gaps.push("No collaborators recorded.");
    if (!byCategory["product-service"]) gaps.push("No product/service catalog facts.");
    if ((state.importReviewQueue ?? []).filter((r) => r.status === "needs-review").length)
      gaps.push("Import review queue has unresolved items.");
    if ((state.settings.importRoots ?? []).length <= 1)
      gaps.push("Only one approved import root — no external real Owner folders configured.");
    if (realOwnerDocuments === 0)
      gaps.push("No documents classified as non-synthetic real Owner data under current markers.");

    const workspacesPopulated = [
      ...new Set([
        ...facts.filter((f) => f.enabled).map(() => "ownerKnowledge"),
        ...(state.relationships ?? []).map((r) => r.workspace),
        ...(state.crmDocuments ?? []).map((d) => d.workspace),
      ]),
    ];

    return {
      totals: {
        factsEnabled: facts.filter((f) => f.enabled).length,
        factsDisabled: facts.filter((f) => !f.enabled).length,
        documents: docs.length,
        relationships: (state.relationships ?? []).length,
        temporalFacts: (state.executive?.temporalFacts ?? []).length,
        commitments: (state.executive?.commitments ?? []).length,
        opportunities: (state.executive?.opportunities ?? []).length,
        reviewOpen: (state.importReviewQueue ?? []).filter((r) => r.status === "needs-review").length,
        brandWorkspaces: brands.length,
        e2eSyntheticWorkspaces: e2e.length,
      },
      byCategory,
      workspacesPopulated,
      approvedImportRoots: Array.isArray(state.settings.importRoots) ? [...state.settings.importRoots] : [],
      topGaps: gaps.slice(0, 12),
      syntheticMarkers,
      realVsSynthetic: { realOwnerDocuments, syntheticOrTestDocuments },
    };
  }

  async listBrandCollaborators(): Promise<BrandCollaboratorV1[]> {
    const state = await this.snapshot();
    return Array.isArray(state.brandCollaborators) ? state.brandCollaborators : [];
  }

  async listJobApplications(): Promise<JobApplicationV1[]> {
    const state = await this.snapshot();
    return Array.isArray(state.jobApplications) ? state.jobApplications : [];
  }

  async addJobApplication(input: Record<string, unknown> = {}): Promise<JobApplicationV1> {
    return this.mutate((draft) => {
      if (!Array.isArray(draft.jobApplications)) draft.jobApplications = [];
      const now = this.ports.clock.now();
      const app = buildJobApplication(input, { id: this.ports.ids.next("job-app"), now });
      // Auto fit score from owner knowledge when job text available
      if (app.fitScore === null) {
        const fit = scoreJobFit(draft.ownerKnowledge, `${app.title} ${app.employer} ${app.fitNotes}`);
        app.fitScore = fit.score;
        if (!app.fitNotes) app.fitNotes = fit.notes;
      }
      draft.jobApplications.unshift(app);
      if (draft.jobApplications.length > 300) draft.jobApplications.length = 300;
      this.activity(draft, "career", "job.application", `Tracked application: ${app.title} @ ${app.employer}`, app.id);
      return app;
    });
  }

  async prepareJobApplication(id: string): Promise<JobApplicationV1> {
    return this.mutate((draft) => {
      if (!Array.isArray(draft.jobApplications)) draft.jobApplications = [];
      const app = draft.jobApplications.find((a) => a.id === id);
      if (!app) throw new Error("Job application not found.");
      const now = this.ports.clock.now();
      const knowledge = draft.ownerKnowledge ?? emptyOwnerKnowledge();
      const facts = knowledge.facts ?? [];
      const fit = scoreJobFit(knowledge, `${app.title} ${app.employer} ${app.url}`);
      app.fitScore = fit.score;
      app.fitNotes = fit.notes;
      app.coverDraft = draftCoverLetterSkeleton(app, knowledge.profile?.displayName || "", facts);
      app.interviewPrep = interviewPrepFromKnowledge(app, facts);
      app.resumeNotes =
        app.resumeNotes ||
        `Tailor resume using owner knowledge categories: skill, employment, experience. Emphasize: ${fit.matched.slice(0, 8).join(", ") || "add more facts"}.`;
      if (app.status === "researching") app.status = "tailoring";
      app.updatedAt = now;
      this.activity(draft, "career", "job.prepare", `Prepared drafts for ${app.title} @ ${app.employer} (not submitted).`, app.id);
      return app;
    });
  }

  async listImportSourceQueue(): Promise<QueuedImportSourceV1[]> {
    const state = await this.snapshot();
    return Array.isArray(state.importSourceQueue) ? state.importSourceQueue : [];
  }

  async queueImportSource(input: Record<string, unknown> = {}): Promise<QueuedImportSourceV1> {
    return this.mutate((draft) => {
      if (!Array.isArray(draft.importSourceQueue)) draft.importSourceQueue = [];
      const now = this.ports.clock.now();
      const src = buildQueuedImportSource(input, { id: this.ports.ids.next("import-src"), now });
      draft.importSourceQueue.unshift(src);
      if (draft.importSourceQueue.length > 100) draft.importSourceQueue.length = 100;
      this.activity(draft, "import", "import.queue", `Import source queued: ${src.label}`, src.id);
      return src;
    });
  }

  /** Mark a queued import source completed/failed after server-side processing. */
  async finalizeImportSource(
    id: string,
    result: {
      status: ImportSourceStatusV1;
      itemsImported?: number;
      itemsSkipped?: number;
      lastError?: string;
      stats?: Partial<ImportSourceStatsV1>;
      errorLog?: string[];
    },
  ): Promise<QueuedImportSourceV1> {
    return this.mutate((draft) => {
      if (!Array.isArray(draft.importSourceQueue)) draft.importSourceQueue = [];
      const src = draft.importSourceQueue.find((s) => s.id === id);
      if (!src) throw new Error("Import source not found.");
      const now = this.ports.clock.now();
      src.status = result.status;
      src.itemsImported = Number(result.itemsImported ?? src.itemsImported) || 0;
      src.itemsSkipped = Number(result.itemsSkipped ?? src.itemsSkipped) || 0;
      src.lastError = String(result.lastError ?? "").slice(0, 2000);
      if (!src.stats) src.stats = emptyImportStats();
      if (result.stats) {
        for (const key of Object.keys(emptyImportStats()) as (keyof ImportSourceStatsV1)[]) {
          if (result.stats[key] !== undefined) src.stats[key] = Number(result.stats[key]) || 0;
        }
      }
      if (Array.isArray(result.errorLog)) {
        src.errorLog = result.errorLog.map((e) => String(e).slice(0, 500)).slice(0, 50);
      }
      if (!Array.isArray(src.errorLog)) src.errorLog = [];
      src.updatedAt = now;
      src.completedAt =
        result.status === "completed" || result.status === "failed" || result.status === "needs-review"
          ? now
          : src.completedAt;
      this.activity(
        draft,
        "import",
        "import.queue.finalize",
        `Import source ${src.label}: ${src.status} (+${src.itemsImported}/skip ${src.itemsSkipped})`,
        src.id,
      );
      return src;
    });
  }

  async markImportSourceProcessing(id: string): Promise<QueuedImportSourceV1> {
    return this.mutate((draft) => {
      const src = (draft.importSourceQueue ?? []).find((s) => s.id === id);
      if (!src) throw new Error("Import source not found.");
      src.status = "processing";
      src.updatedAt = this.ports.clock.now();
      return src;
    });
  }

  async listImportReviewQueue(): Promise<ImportReviewItemV1[]> {
    const state = await this.snapshot();
    return Array.isArray(state.importReviewQueue) ? state.importReviewQueue : [];
  }

  async addImportReviewItem(input: Record<string, unknown> = {}): Promise<ImportReviewItemV1> {
    return this.mutate((draft) => {
      if (!Array.isArray(draft.importReviewQueue)) draft.importReviewQueue = [];
      const now = this.ports.clock.now();
      const item = buildImportReviewItem(
        {
          documentId: typeof input.documentId === "string" ? input.documentId : null,
          sourcePath: String(input.sourcePath ?? ""),
          relativePath: String(input.relativePath ?? ""),
          candidates: Array.isArray(input.candidates) ? (input.candidates as ImportReviewItemV1["candidates"]) : [],
          reason: String(input.reason ?? "Needs review"),
          errors: Array.isArray(input.errors) ? input.errors.map(String) : [],
          status: (input.status as ImportReviewStatusV1) || "needs-review",
        },
        { id: this.ports.ids.next("import-review"), now },
      );
      draft.importReviewQueue.unshift(item);
      if (draft.importReviewQueue.length > 500) draft.importReviewQueue.length = 500;
      this.activity(draft, "import", "import.review", `Review item: ${item.reason}`, item.id);
      return item;
    });
  }

  async resolveImportReviewItem(
    id: string,
    decision: "accepted" | "rejected",
  ): Promise<ImportReviewItemV1> {
    return this.mutate((draft) => {
      if (!Array.isArray(draft.importReviewQueue)) draft.importReviewQueue = [];
      const item = draft.importReviewQueue.find((r) => r.id === id);
      if (!item) throw new Error("Import review item not found.");
      const now = this.ports.clock.now();
      item.status = decision;
      item.updatedAt = now;
      item.resolvedAt = now;
      this.activity(draft, "import", "import.review.resolve", `Review ${decision}: ${item.relativePath}`, item.id);
      return item;
    });
  }

  /**
   * Aggregate import dashboard for Owner UI: queue statuses, document counts, review backlog.
   */
  async importDashboard(): Promise<{
    sources: QueuedImportSourceV1[];
    reviewOpen: number;
    reviewItems: ImportReviewItemV1[];
    documents: number;
    documentsWithHash: number;
    totals: ImportSourceStatsV1;
    byStatus: Record<string, number>;
  }> {
    const state = await this.snapshot();
    const sources = Array.isArray(state.importSourceQueue) ? state.importSourceQueue : [];
    const reviewItems = Array.isArray(state.importReviewQueue) ? state.importReviewQueue : [];
    const docs = Array.isArray(state.crmDocuments) ? state.crmDocuments : [];
    const totals = emptyImportStats();
    const byStatus: Record<string, number> = {
      queued: 0,
      processing: 0,
      completed: 0,
      "needs-review": 0,
      failed: 0,
      cancelled: 0,
    };
    for (const src of sources) {
      byStatus[src.status] = (byStatus[src.status] ?? 0) + 1;
      const st = src.stats ?? emptyImportStats();
      totals.filesDiscovered += st.filesDiscovered || 0;
      totals.filesProcessed += st.filesProcessed || src.itemsImported || 0;
      totals.duplicatesSkipped += st.duplicatesSkipped || 0;
      totals.unsupportedSkipped += st.unsupportedSkipped || 0;
      totals.factsExtracted += st.factsExtracted || 0;
      totals.entitiesAssociated += st.entitiesAssociated || 0;
      totals.reviewItems += st.reviewItems || 0;
      totals.errors += st.errors || 0;
    }
    const reviewOpen = reviewItems.filter((r) => r.status === "needs-review").length;
    return {
      sources,
      reviewOpen,
      reviewItems: reviewItems.filter((r) => r.status === "needs-review").slice(0, 50),
      documents: docs.length,
      documentsWithHash: docs.filter((d) => d.contentHash).length,
      totals,
      byStatus,
    };
  }

  /** Known content hashes from CRM documents (for skip/dedupe). */
  async knownDocumentHashes(): Promise<Set<string>> {
    const state = await this.snapshot();
    const set = new Set<string>();
    for (const d of state.crmDocuments ?? []) {
      if (d.contentHash) set.add(d.contentHash);
    }
    return set;
  }

  /** Provenance index for resume: relativePath -> prior ingest metadata. */
  async knownDocumentProvenance(sourceRootPath?: string): Promise<
    Map<string, { contentHash: string; byteLength: number; modifiedAtMs: number }>
  > {
    const state = await this.snapshot();
    const map = new Map<string, { contentHash: string; byteLength: number; modifiedAtMs: number }>();
    for (const d of state.crmDocuments ?? []) {
      if (!d.contentHash || !d.sourceRelativePath) continue;
      if (sourceRootPath && d.sourceRootPath && d.sourceRootPath !== sourceRootPath) continue;
      const ms = d.sourceModifiedAt ? Date.parse(d.sourceModifiedAt) : 0;
      map.set(d.sourceRelativePath, {
        contentHash: d.contentHash,
        byteLength: d.byteLength,
        modifiedAtMs: Number.isFinite(ms) ? ms : 0,
      });
    }
    return map;
  }

  /**
   * Classify extracted material: high confidence auto-associates owner knowledge;
   * uncertain cases become review items. Does not invent facts beyond extracted text.
   */
  async classifyAndAssociateImport(input: {
    documentId?: string;
    filename: string;
    relativePath?: string;
    extractedText?: string;
    tags?: string[];
    sourcePath?: string;
    extractionError?: string;
  }): Promise<{
    candidates: ReturnType<typeof classifyImportMaterial>;
    auto: ReturnType<typeof shouldAutoAssociate>;
    reviewItem: ImportReviewItemV1 | null;
    factId: string | null;
  }> {
    const candidates = classifyImportMaterial({
      filename: input.filename,
      ...(input.relativePath !== undefined ? { relativePath: input.relativePath } : {}),
      ...(input.extractedText !== undefined ? { extractedText: input.extractedText } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
    });
    const workspaceInference = await this.inferImportWorkspaceForPath(
      input.sourcePath || input.relativePath || input.filename,
      {
        filename: input.filename,
        ...(input.extractedText !== undefined ? { extractedText: input.extractedText } : {}),
      },
    );
    const auto = shouldAutoAssociate(candidates);
    const review = needsReview(candidates, input.extractionError);
    const needsWorkspaceReview = workspaceInference.needsReview;
    // Instruction-like body is DATA only — never auto-authority, never owner_direct channel
    const instructionLike = isInstructionLikeDocument(
      `${input.filename}\n${input.relativePath || ""}\n${input.extractedText || ""}`,
    );
    let factId: string | null = null;
    let reviewItem: ImportReviewItemV1 | null = null;

    if (auto && !review.needs && !needsWorkspaceReview && !instructionLike) {
      const draft = factDraftFromCandidate(auto, input.extractedText || "", input.relativePath || input.filename);
      if (draft) {
        const fact = await this.addOwnerKnowledgeFact({
          category: draft.category,
          title: draft.title,
          content: draft.content,
          confidence: draft.confidence,
          // Channel is import — filename must not upgrade trust (source-trust channel-first)
          sourceType: "import",
          sourceRef: `import:${input.relativePath || input.filename}`.slice(0, 500),
        });
        factId = fact.id;
      }
      // Still record auto association on the document when id provided
      if (input.documentId) {
        await this.mutate((draft) => {
          const doc = (draft.crmDocuments ?? []).find((d) => d.id === input.documentId);
          if (doc) {
            doc.entityKind = auto.kind;
            doc.entityConfidence = auto.confidence;
            doc.updatedAt = this.ports.clock.now();
          }
        });
      }
    }

    if (review.needs || needsWorkspaceReview || instructionLike) {
      const wsReason = needsWorkspaceReview
        ? `Workspace: ${workspaceInference.role} (${workspaceInference.reason})`
        : "";
      const poisonReason = instructionLike
        ? "Instruction-like text treated as DATA only — not authority, not owner_direct, no external action."
        : "";
      reviewItem = await this.addImportReviewItem({
        documentId: input.documentId ?? null,
        sourcePath: input.sourcePath || input.relativePath || input.filename,
        relativePath: input.relativePath || input.filename,
        candidates,
        reason:
          [review.reason, wsReason, poisonReason].filter(Boolean).join(" · ") ||
          workspaceInference.reason,
        errors: input.extractionError ? [input.extractionError] : [],
        status: "needs-review",
      });
    }

    return { candidates, auto, reviewItem, factId };
  }

  /** Live LAN discovery for phone access (no bind yet). */
  discoverLan(): LanDiscoveryResultV1 {
    return discoverPrivateLanAddresses();
  }

  phoneUrlFor(address: string, port: number): string {
    return buildPhoneUrl(address, port, "/phone");
  }

  /**
   * Gate for real Owner-data bulk import. Capabilities are code-backed; stats are live state.
   */
  async importReadiness(): Promise<ImportReadinessReportV1> {
    const state = await this.snapshot();
    const docs = Array.isArray(state.crmDocuments) ? state.crmDocuments : [];
    const review = Array.isArray(state.importReviewQueue) ? state.importReviewQueue : [];
    const queue = Array.isArray(state.importSourceQueue) ? state.importSourceQueue : [];
    const roots = Array.isArray(state.settings.importRoots) ? state.settings.importRoots : [];
    return buildImportReadinessReport({
      hasRecursiveWalk: true,
      hasRootContainment: true,
      hasSymlinkProtection: true,
      hasContentHashDedupe: true,
      hasResume: true,
      hasProvenance: true,
      hasErrorContinuation: true,
      hasEntityClassification: true,
      hasReviewQueue: true,
      hasImportDashboard: true,
      approvedImportRoots: roots.length,
      documentsWithHash: docs.filter((d) => d.contentHash).length,
      reviewOpen: review.filter((r) => r.status === "needs-review").length,
      queueSources: queue.length,
    });
  }

  /**
   * Import contacts from CSV text (Owner-supplied). Creates CRM prospects; does not invent fields.
   */
  async importContactsFromCsv(csvText: string, opts: { sourceLabel?: string } = {}): Promise<{
    created: number;
    skipped: number;
    errors: string[];
    ids: string[];
  }> {
    const { rows } = parseSimpleCsv(csvText);
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];
    const ids: string[] = [];
    for (const row of rows) {
      const payload = csvRowToRelationship(row);
      if (!payload) {
        skipped++;
        continue;
      }
      try {
        const rel = await this.createCustomer({
          ...payload,
          notes: `${payload.notes || ""}\n[csv-import: ${opts.sourceLabel || "upload"}]`.trim(),
        });
        ids.push(rel.id);
        created++;
      } catch (e) {
        skipped++;
        errors.push(String((e as Error).message || e).slice(0, 200));
      }
    }
    await this.mutate((draft) => {
      this.activity(
        draft,
        "import",
        "import.csv.contacts",
        `CSV contact import: ${created} created, ${skipped} skipped.`,
        null,
      );
    });
    return { created, skipped, errors: errors.slice(0, 20), ids };
  }

  async addBrandCollaborator(input: Record<string, unknown> = {}): Promise<BrandCollaboratorV1> {
    return this.mutate((draft) => {
      if (!Array.isArray(draft.brandCollaborators)) draft.brandCollaborators = [];
      const now = this.ports.clock.now();
      const brandWorkspaceId =
        typeof input.brandWorkspaceId === "string" && input.brandWorkspaceId
          ? input.brandWorkspaceId
          : null;
      if (brandWorkspaceId) {
        const ws = draft.workspaces.find((w) => w.id === brandWorkspaceId);
        if (!ws) throw new Error("Brand workspace not found for collaborator.");
        if (ws.kind !== "business") throw new Error("Collaborators attach only to business/brand workspaces.");
      }
      const collab = buildBrandCollaborator(input, { id: this.ports.ids.next("collaborator"), now });
      draft.brandCollaborators.unshift(collab);
      if (draft.brandCollaborators.length > 200) draft.brandCollaborators.length = 200;
      this.activity(draft, "settings", "brand.collaborator", `Collaborator: ${collab.name}`, collab.id);
      return collab;
    });
  }

  // --- R7 CRM assistant surface -----------------------------------------------------------------

  async accountSummary(customerId: string) {
    const state = await this.snapshot();
    const customer = find(state.relationships, customerId, "Customer");
    return buildAccountSummary(customer);
  }

  // ─── Dealership / vehicle inventory ───────────────────────────────────────

  private vehicleInv(state: AssistantStateV1): VehicleInventoryStateV1 {
    return state.vehicleInventory ?? emptyVehicleInventoryState();
  }

  async ensureLakelandToyotaContext(opts: { setCurrent?: boolean; ownerWorksHere?: boolean } = {}): Promise<DealershipContextV1> {
    return this.mutate((draft) => {
      if (!draft.vehicleInventory) draft.vehicleInventory = emptyVehicleInventoryState();
      const inv = draft.vehicleInventory;
      const now = this.ports.clock.now();
      let d = inv.dealerships.find((x) => x.slug === LAKELAND_TOYOTA_DEFAULT.slug);
      if (!d) {
        d = buildDealershipContext(
          {
            ...LAKELAND_TOYOTA_DEFAULT,
            ownerWorksHere: opts.ownerWorksHere === true,
            isCurrent: opts.setCurrent !== false,
            sourceRef: "owner.dealership.lakeland-toyota",
          },
          { id: this.ports.ids.next("dealership"), now },
        );
        inv.dealerships.unshift(d);
      } else {
        d = {
          ...d,
          ownerWorksHere: opts.ownerWorksHere === true ? true : d.ownerWorksHere,
          isCurrent: opts.setCurrent === false ? d.isCurrent : true,
          updatedAt: now,
        };
        inv.dealerships = inv.dealerships.map((x) => (x.id === d!.id ? d! : { ...x, isCurrent: opts.setCurrent === false ? x.isCurrent : false }));
      }
      if (opts.setCurrent !== false) {
        inv.dealerships = inv.dealerships.map((x) => ({ ...x, isCurrent: x.id === d!.id }));
      }
      // Mirror into owner knowledge (employment) with provenance — never GPS-inferred.
      if (opts.ownerWorksHere) {
        if (!draft.ownerKnowledge) draft.ownerKnowledge = emptyOwnerKnowledge();
        const exists = draft.ownerKnowledge.facts.some(
          (f) => f.category === "employer" && /lakeland toyota/i.test(f.title + f.content) && f.enabled,
        );
        if (!exists) {
          const fact = buildOwnerKnowledgeFact(
            {
              category: "employer",
              title: "Lakeland Toyota",
              content: "Owner works at Lakeland Toyota (Owner-supplied).",
              confidence: 100,
              sourceType: "owner",
              sourceRef: "owner.dealership.context",
            },
            { id: this.ports.ids.next("owner-fact"), now },
          );
          draft.ownerKnowledge.facts.unshift(fact);
        }
      }
      this.activity(draft, "settings", "dealership.context", `Dealership context: ${d!.name}`, d!.id);
      return d!;
    });
  }

  async setCurrentDealership(nameOrSlug: string): Promise<DealershipContextV1> {
    const key = String(nameOrSlug ?? "").trim();
    if (!key) throw new Error("Dealership name is required.");
    if (/lakeland/i.test(key)) {
      return this.ensureLakelandToyotaContext({ setCurrent: true });
    }
    return this.mutate((draft) => {
      if (!draft.vehicleInventory) draft.vehicleInventory = emptyVehicleInventoryState();
      const inv = draft.vehicleInventory;
      const now = this.ports.clock.now();
      let d = inv.dealerships.find(
        (x) => x.slug === key.toLowerCase() || x.name.toLowerCase() === key.toLowerCase(),
      );
      if (!d) {
        d = buildDealershipContext(
          { name: key, isCurrent: true, sourceRef: "owner.dealership" },
          { id: this.ports.ids.next("dealership"), now },
        );
        inv.dealerships.unshift(d);
      }
      inv.dealerships = inv.dealerships.map((x) => ({
        ...x,
        isCurrent: x.id === d!.id,
        updatedAt: x.id === d!.id ? now : x.updatedAt,
      }));
      const current = inv.dealerships.find((x) => x.isCurrent)!;
      this.activity(draft, "settings", "dealership.current", `Current dealership: ${current.name}`, current.id);
      return current;
    });
  }

  async currentDealership(): Promise<DealershipContextV1 | null> {
    const inv = this.vehicleInv(await this.snapshot());
    return inv.dealerships.find((d) => d.isCurrent) ?? inv.dealerships[0] ?? null;
  }

  async validateVinAction(raw: string) {
    return validateVin(raw);
  }

  async decodeVinAction(raw: string, opts: { offline?: boolean } = {}) {
    const v = validateVin(raw);
    const now = this.ports.clock.now();
    if (!v.valid || !v.normalized) return { validation: v, decode: emptyVinDecode(raw, now) };
    if (opts.offline) {
      return { validation: v, decode: emptyVinDecode(v.normalized, now) };
    }
    try {
      const decode = await decodeVinNhtsa(v.normalized, now);
      return { validation: v, decode };
    } catch (err) {
      const decode = emptyVinDecode(v.normalized, now);
      decode.errorText = err instanceof Error ? err.message : String(err);
      return { validation: v, decode };
    }
  }

  async refreshDealershipInventory(opts: {
    dealershipName?: string;
    useFixture?: boolean;
    fixtureVins?: string[];
  } = {}) {
    let dealer = await this.currentDealership();
    if (!dealer || (opts.dealershipName && /lakeland/i.test(opts.dealershipName))) {
      dealer = await this.ensureLakelandToyotaContext({ setCurrent: true });
    }
    if (opts.dealershipName && !/lakeland/i.test(opts.dealershipName)) {
      dealer = await this.setCurrentDealership(opts.dealershipName);
    }
    const now = this.ports.clock.now();
    const ids: string[] = [];
    const nextId = (kind: string) => {
      const id = this.ports.ids.next(kind);
      ids.push(id);
      return id;
    };
    const result = await refreshDealershipPublicInventory({
      dealership: dealer!,
      now,
      nextId,
      useFixture: opts.useFixture === true,
      ...(opts.fixtureVins ? { fixtureVins: opts.fixtureVins } : {}),
    });
    await this.mutate((draft) => {
      if (!draft.vehicleInventory) draft.vehicleInventory = emptyVehicleInventoryState();
      draft.vehicleInventory = applyOnlineListings(
        draft.vehicleInventory,
        dealer!,
        result.listings,
        now,
        (kind) => this.ports.ids.next(kind),
      );
      this.activity(
        draft,
        "agent",
        "inventory.refresh",
        `Public inventory refresh (${result.mode}): ${result.listings.length} listing(s) for ${dealer!.name}`,
        dealer!.id,
      );
      return draft.vehicleInventory;
    });
    return result;
  }

  async startInventoryWalk(note = ""): Promise<InventoryWalkV1> {
    let dealer = await this.currentDealership();
    if (!dealer) dealer = await this.ensureLakelandToyotaContext({ setCurrent: true });
    return this.mutate((draft) => {
      if (!draft.vehicleInventory) draft.vehicleInventory = emptyVehicleInventoryState();
      const now = this.ports.clock.now();
      // Complete any prior active walk without coverage claim.
      draft.vehicleInventory.walks = draft.vehicleInventory.walks.map((w) =>
        w.state === "active"
          ? { ...w, state: "complete" as const, endedAt: now, coverageDeclaredComplete: false }
          : w,
      );
      const walk: InventoryWalkV1 = {
        id: this.ports.ids.next("walk"),
        dealershipId: dealer!.id,
        dealershipName: dealer!.name,
        state: "active",
        coverageDeclaredComplete: false,
        startedAt: now,
        endedAt: null,
        observationIds: [],
        notes: String(note ?? "").slice(0, 2000),
        provenance: { sourceType: "owner", sourceRef: "inventory.walk", recordedAt: now },
      };
      draft.vehicleInventory.walks.unshift(walk);
      if (draft.vehicleInventory.walks.length > 100) draft.vehicleInventory.walks.length = 100;
      this.activity(draft, "agent", "inventory.walk.start", `Inventory walk started at ${dealer!.name}`, walk.id);
      return walk;
    });
  }

  async activeInventoryWalk(): Promise<InventoryWalkV1 | null> {
    const inv = this.vehicleInv(await this.snapshot());
    return inv.walks.find((w) => w.state === "active") ?? null;
  }

  async recordWalkObservation(input: {
    vin?: string;
    stockNumber?: string;
    note?: string;
    photoDocumentIds?: string[];
    recognitionConfidence?: number | null;
    entryMethod?: "manual" | "photo" | "mixed";
    walkId?: string;
    /** Acceptance metrics — VIN capture path for lot test. */
    vinSource?: VinEntrySourceV1 | string;
    ocrResult?: string | null;
    ownerCorrectionRequired?: boolean;
    photoRetryCount?: number;
    /** Wall-clock ms for this observation (client-measured or server). */
    processingDurationMs?: number | null;
    /** Epoch ms when processing started (server computes duration if set). */
    processingStartedAtMs?: number;
  }): Promise<{
    observation: PhysicalObservationV1;
    vehicle: VehicleRecordV1 | null;
    validation: ReturnType<typeof validateVin>;
    metrics: WalkObservationMetricsV1;
  }> {
    const processStarted = input.processingStartedAtMs ?? Date.now();
    let walk = input.walkId
      ? this.vehicleInv(await this.snapshot()).walks.find((w) => w.id === input.walkId) ?? null
      : await this.activeInventoryWalk();
    if (!walk) walk = await this.startInventoryWalk();
    const rawVin = String(input.vin ?? "").trim();
    const validation = rawVin ? validateVin(rawVin) : validateVin("");
    const vin = validation.valid ? validation.normalized : rawVin ? normalizeVinCandidate(rawVin) : null;
    const stockNumber = String(input.stockNumber ?? "").trim().slice(0, 64) || null;
    const confidence =
      input.recognitionConfidence === undefined || input.recognitionConfidence === null
        ? rawVin && validation.valid
          ? 100
          : null
        : Number(input.recognitionConfidence);

    // Uncertain photo VIN must not silently verify
    let matchStatusForced: PhysicalObservationV1["matchStatus"] | null = null;
    if (input.entryMethod === "photo" && confidence !== null && confidence < 70) {
      matchStatusForced = "PHOTO_REVIEW_REQUIRED";
    }
    if (rawVin && !validation.valid) {
      matchStatusForced = "PHOTO_REVIEW_REQUIRED";
    }

    try {
      return this.mutate((draft) => {
        if (!draft.vehicleInventory) draft.vehicleInventory = emptyVehicleInventoryState();
        const inv = draft.vehicleInventory;
        if (!Array.isArray(inv.walkAcceptanceMetrics)) inv.walkAcceptanceMetrics = [];
        const now = this.ports.clock.now();
        const w = inv.walks.find((x) => x.id === walk!.id)!;
        const match = matchStatusForced
          ? { vehicle: null as VehicleRecordV1 | null, matchStatus: matchStatusForced }
          : matchObservationToInventory({ vin, stockNumber }, inv.vehicles, w.dealershipName);

        // Duplicate observation in same walk
        const prior = inv.observations.filter((o) => o.walkId === w.id && vin && o.vin === vin);
        const matchStatus =
          prior.length > 0 && match.matchStatus === "VERIFIED_ON_LOT"
            ? ("DUPLICATE_OBSERVATION" as const)
            : match.matchStatus === "VERIFIED_ON_LOT" && !rawVin
              ? match.matchStatus
              : match.matchStatus;

        let vehicle = match.vehicle;
        if (!vehicle && vin && validation.valid) {
          // Create physical-only vehicle record
          vehicle = {
            id: this.ports.ids.next("vehicle"),
            vin,
            dealershipId: w.dealershipId,
            dealershipName: w.dealershipName,
            stockNumber,
            year: null,
            make: null,
            model: null,
            trim: null,
            condition: null,
            exteriorColor: null,
            interiorColor: null,
            mileage: null,
            presenceStatus: "PHYSICALLY_VERIFIED",
            listingUrl: null,
            detailUrl: null,
            lastOnlineAt: null,
            lastPhysicalAt: now,
            priceHistory: [],
            statusHistory: [{ at: now, status: "PHYSICALLY_VERIFIED", note: "Physical Owner walk." }],
            listingObservations: [],
            relationshipIds: [],
            opportunityIds: [],
            createdAt: now,
            updatedAt: now,
          };
          inv.vehicles.unshift(vehicle);
        } else if (vehicle) {
          inv.vehicles = inv.vehicles.map((v) => {
            if (v.id !== vehicle!.id) return v;
            return {
              ...v,
              stockNumber: stockNumber || v.stockNumber,
              presenceStatus: "PHYSICALLY_VERIFIED" as const,
              lastPhysicalAt: now,
              statusHistory: [
                { at: now, status: "PHYSICALLY_VERIFIED" as const, note: "Physical Owner walk." },
                ...v.statusHistory,
              ].slice(0, 50),
              updatedAt: now,
            };
          });
          vehicle = inv.vehicles.find((v) => v.id === vehicle!.id) ?? vehicle;
        }

        const observation: PhysicalObservationV1 = {
          id: this.ports.ids.next("obs"),
          walkId: w.id,
          dealershipId: w.dealershipId,
          dealershipName: w.dealershipName,
          vin: validation.valid ? vin : vin,
          stockNumber,
          note: String(input.note ?? "").slice(0, 2000),
          photoDocumentIds: Array.isArray(input.photoDocumentIds) ? input.photoDocumentIds.slice(0, 20) : [],
          recognitionConfidence: confidence,
          matchStatus:
            matchStatusForced ||
            (input.entryMethod === "manual" && matchStatus === "VERIFIED_ON_LOT"
              ? "VERIFIED_ON_LOT"
              : input.entryMethod === "manual" && matchStatus === "SEEN_ON_LOT_NOT_ONLINE"
                ? "SEEN_ON_LOT_NOT_ONLINE"
                : matchStatus === "DUPLICATE_OBSERVATION"
                  ? "DUPLICATE_OBSERVATION"
                  : matchStatus),
          vehicleId: vehicle?.id ?? null,
          source: "PHYSICAL_OWNER_WALK",
          entryMethod: input.entryMethod ?? "manual",
          observedAt: now,
          provenance: {
            sourceType: "owner",
            sourceRef: "inventory.walk.observation",
            recordedAt: now,
          },
        };
        // Prefer MANUAL_ENTRY label when manual and matched
        if (observation.entryMethod === "manual" && observation.matchStatus === "VERIFIED_ON_LOT") {
          /* keep VERIFIED_ON_LOT — stronger */
        } else if (observation.entryMethod === "manual" && !observation.matchStatus) {
          observation.matchStatus = "MANUAL_ENTRY";
        }

        inv.observations.unshift(observation);
        if (inv.observations.length > 5000) inv.observations.length = 5000;
        w.observationIds = [observation.id, ...w.observationIds];
        inv.walks = inv.walks.map((x) => (x.id === w.id ? w : x));

        const durationMs =
          input.processingDurationMs != null
            ? Number(input.processingDurationMs)
            : Math.max(0, Date.now() - processStarted);
        const metrics = buildWalkObservationMetrics(
          {
            walkId: w.id,
            workspace: "work",
            timestamp: now,
            ...(input.vinSource != null ? { vinSource: input.vinSource } : {}),
            entryMethod: observation.entryMethod,
            ocrResult: input.ocrResult != null ? String(input.ocrResult) : rawVin || null,
            ocrConfidence: confidence,
            ...(input.ownerCorrectionRequired !== undefined
              ? { ownerCorrectionRequired: input.ownerCorrectionRequired }
              : {}),
            finalConfirmedVin: observation.vin,
            vinValidationCode: validation.code,
            vinValidationValid: validation.valid,
            onlineInventoryMatch: deriveOnlineMatch(observation.matchStatus),
            stockMatch: deriveStockMatch(stockNumber, vehicle?.stockNumber, observation.matchStatus),
            photoRetryCount: input.photoRetryCount ?? 0,
            processingDurationMs: durationMs,
            saveSuccess: true,
            observationId: observation.id,
            matchStatus: observation.matchStatus,
          },
          { id: this.ports.ids.next("walktel") },
        );
        inv.walkAcceptanceMetrics.unshift(metrics);
        if (inv.walkAcceptanceMetrics.length > 5000) inv.walkAcceptanceMetrics.length = 5000;

        this.activity(
          draft,
          "agent",
          "inventory.observation",
          `Walk observation: VIN ${observation.vin ?? "?"} · ${observation.matchStatus}`,
          observation.id,
        );
        return { observation, vehicle, validation, metrics };
      });
    } catch (err) {
      // Record failed save metrics without throwing away the error
      const msg = err instanceof Error ? err.message : String(err);
      await this.mutate((draft) => {
        if (!draft.vehicleInventory) draft.vehicleInventory = emptyVehicleInventoryState();
        if (!Array.isArray(draft.vehicleInventory.walkAcceptanceMetrics)) {
          draft.vehicleInventory.walkAcceptanceMetrics = [];
        }
        const now = this.ports.clock.now();
        const tel = buildWalkObservationMetrics(
          {
            walkId: walk!.id,
            workspace: "work",
            timestamp: now,
            ...(input.vinSource != null ? { vinSource: input.vinSource } : {}),
            ...(input.entryMethod != null ? { entryMethod: input.entryMethod } : {}),
            ocrResult: input.ocrResult != null ? String(input.ocrResult) : rawVin || null,
            ocrConfidence: confidence,
            finalConfirmedVin: vin,
            vinValidationCode: validation.code,
            vinValidationValid: validation.valid,
            onlineInventoryMatch: false,
            stockMatch: null,
            photoRetryCount: input.photoRetryCount ?? 0,
            processingDurationMs:
              input.processingDurationMs != null
                ? Number(input.processingDurationMs)
                : Math.max(0, Date.now() - processStarted),
            saveSuccess: false,
            saveError: msg,
            observationId: null,
            matchStatus: null,
          },
          { id: this.ports.ids.next("walktel") },
        );
        draft.vehicleInventory.walkAcceptanceMetrics.unshift(tel);
        return null;
      }).catch(() => null);
      throw err;
    }
  }

  /**
   * Acceptance metrics summary for current/most recent physical walk.
   * REAL_DEALERSHIP_WALK stays OWNER_TEST_PENDING — never auto-PASS.
   * Does not write Value Ledger.
   */
  async inventoryWalkTestResults(walkId?: string): Promise<WalkAcceptanceReportV1 | null> {
    const inv = this.vehicleInv(await this.snapshot());
    const walk =
      (walkId ? inv.walks.find((w) => w.id === walkId) : null) ||
      inv.walks.find((w) => w.state === "active") ||
      inv.walks[0];
    if (!walk) return null;
    const reconciliation = reconcileInventoryWalk(
      walk,
      inv.observations,
      inv.vehicles,
      this.ports.clock.now(),
    );
    const entries = (inv.walkAcceptanceMetrics ?? []).filter((e) => e.walkId === walk.id);
    return buildWalkAcceptanceReport({
      walk,
      entries,
      reconciliation,
      workspace: "work",
    });
  }

  async endInventoryWalk(opts: { coverageDeclaredComplete?: boolean; walkId?: string } = {}): Promise<{
    walk: InventoryWalkV1;
    summary: WalkReconciliationV1;
  }> {
    return this.mutate((draft) => {
      if (!draft.vehicleInventory) draft.vehicleInventory = emptyVehicleInventoryState();
      const inv = draft.vehicleInventory;
      const now = this.ports.clock.now();
      const w =
        inv.walks.find((x) => x.id === opts.walkId) ||
        inv.walks.find((x) => x.state === "active");
      if (!w) throw new Error("No active inventory walk.");
      const walk: InventoryWalkV1 = {
        ...w,
        state: "complete",
        endedAt: now,
        coverageDeclaredComplete: opts.coverageDeclaredComplete === true,
      };
      inv.walks = inv.walks.map((x) => (x.id === walk.id ? walk : x));
      const summary = reconcileInventoryWalk(walk, inv.observations, inv.vehicles, now);
      this.activity(draft, "agent", "inventory.walk.end", `Inventory walk ended · ${summary.physicallyObservedCount} observed`, walk.id);
      return { walk, summary };
    });
  }

  async inventoryWalkSummary(walkId?: string): Promise<WalkReconciliationV1 | null> {
    const inv = this.vehicleInv(await this.snapshot());
    const walk =
      (walkId ? inv.walks.find((w) => w.id === walkId) : null) ||
      inv.walks.find((w) => w.state === "active") ||
      inv.walks[0];
    if (!walk) return null;
    return reconcileInventoryWalk(walk, inv.observations, inv.vehicles, this.ports.clock.now());
  }

  async listVehicles(query: Parameters<typeof queryVehicles>[1] = {}): Promise<VehicleRecordV1[]> {
    const inv = this.vehicleInv(await this.snapshot());
    return queryVehicles(inv.vehicles, { ...query, nowIso: this.ports.clock.now() });
  }

  async associateVehicleWithCustomer(input: {
    vehicleId?: string;
    vin?: string;
    relationshipId: string;
    opportunityId?: string;
  }): Promise<VehicleRecordV1> {
    return this.mutate((draft) => {
      if (!draft.vehicleInventory) draft.vehicleInventory = emptyVehicleInventoryState();
      const rel = draft.relationships.find((r) => r.id === input.relationshipId);
      if (!rel) throw new Error("Customer/relationship not found.");
      let vehicle = input.vehicleId
        ? draft.vehicleInventory.vehicles.find((v) => v.id === input.vehicleId)
        : draft.vehicleInventory.vehicles.find((v) => v.vin === normalizeVinCandidate(String(input.vin ?? "")));
      if (!vehicle) throw new Error("Vehicle not found. Provide vehicleId or known VIN.");
      vehicle = {
        ...vehicle,
        relationshipIds: [...new Set([...vehicle.relationshipIds, rel.id])],
        opportunityIds: input.opportunityId
          ? [...new Set([...vehicle.opportunityIds, input.opportunityId])]
          : vehicle.opportunityIds,
        updatedAt: this.ports.clock.now(),
      };
      draft.vehicleInventory.vehicles = draft.vehicleInventory.vehicles.map((v) =>
        v.id === vehicle!.id ? vehicle! : v,
      );
      this.activity(
        draft,
        "agent",
        "vehicle.associate",
        `Vehicle ${vehicle.vin ?? vehicle.id} linked to ${rel.displayName}`,
        vehicle.id,
      );
      return vehicle;
    });
  }

  async extractVinFromText(text: string) {
    const candidates = extractVinCandidatesFromText(text);
    return candidates.map((c) => validateVin(c));
  }

  /**
   * VIN/sticker OCR from image bytes or pre-extracted text.
   * Tries: (1) supplied text, (2) Ollama vision if configured, (3) optional tesseract.js.
   * Never invents a VIN when OCR yields nothing.
   */
  async ocrVinFromImage(input: {
    contentBase64?: string;
    mimeType?: string;
    filename?: string;
    /** When client or prior step already has OCR text */
    extractedText?: string;
    /** Skip network vision (tests). */
    offline?: boolean;
  }): Promise<VinOcrResultV1 & { documentHint: string }> {
    let text = String(input.extractedText ?? "").trim();
    let provider = "text-input";
    let byteLength = 0;
    let bytes: Buffer | null = null;

    if (input.contentBase64) {
      bytes = Buffer.from(String(input.contentBase64), "base64");
      byteLength = bytes.byteLength;
    }

    if (!text && bytes && !input.offline) {
      const vision = await extractImageWithLocalVision({
        filename: input.filename || "vin.jpg",
        mimeType: input.mimeType || "image/jpeg",
        byteLength,
        bytes,
        prompt: VIN_VISION_PROMPT,
        timeoutMs: 60_000,
      });
      if (vision.extractedText?.trim()) {
        text = vision.extractedText;
        provider = vision.provider || "ollama-vision";
      } else if (vision.code === "IMAGE_EXTRACTION_PROVIDER_REQUIRED") {
        provider = "no-vision-provider";
      } else {
        provider = vision.provider || "vision-empty";
      }
    }

    // Optional tesseract.js (installed at monorepo root when available)
    if (!text && bytes) {
      try {
        const tessPath = "tesseract.js";
        const tess = await import(tessPath) as {
          createWorker?: (lang?: string) => Promise<{
            recognize: (img: Buffer) => Promise<{ data: { text: string } }>;
            terminate: () => Promise<void>;
          }>;
        };
        if (typeof tess.createWorker === "function") {
          const worker = await tess.createWorker("eng");
          try {
            const result = await worker.recognize(bytes);
            text = String(result?.data?.text ?? "").trim();
            if (text) provider = "tesseract.js";
          } finally {
            await worker.terminate();
          }
        }
      } catch {
        /* tesseract optional */
      }
    }

    const ocr = buildVinOcrResult({
      extractedText: text,
      provider,
      ...(byteLength ? { byteLength } : {}),
    });
    return {
      ...ocr,
      documentHint: bytes
        ? `Image ${input.filename || "upload"} (${byteLength} bytes) preserved; OCR via ${provider}.`
        : `Text-only OCR via ${provider}.`,
    };
  }

  async vehicleRecallLookup(input: {
    vin?: string;
    make?: string;
    model?: string;
    year?: number;
  } = {}): Promise<RecallLookupResultV1> {
    let make: string | null = input.make ?? null;
    let model: string | null = input.model ?? null;
    let year: number | null = input.year ?? null;
    if (input.vin) {
      const { decode } = await this.decodeVinAction(input.vin);
      make = make || decode.make;
      model = model || decode.model;
      year = year || (decode.year ? Number(decode.year) : null);
    }
    if ((!make || !model || !year) && input.vin) {
      const hits = await this.listVehicles({ vin: input.vin });
      const v = hits[0];
      if (v) {
        make = make || v.make;
        model = model || v.model;
        year = year || v.year;
      }
    }
    return lookupRecallsNhtsa({
      make,
      model,
      year,
      now: this.ports.clock.now(),
    });
  }

  async vehicleCompare(vinA: string, vinB: string) {
    const a = (await this.listVehicles({ vin: vinA }))[0];
    const b = (await this.listVehicles({ vin: vinB }))[0];
    if (!a || !b) throw new Error("Both VINs must exist in stored inventory to compare.");
    const findings = compareTwoVehicles(a, b);
    return {
      findings,
      reply: formatResearchReply(findings, "Vehicle comparison (stored data only)"),
      vehicles: [a, b],
    };
  }

  async vehicleTalkingPoints(input: { vin?: string; vehicleId?: string; customerName?: string }) {
    const vehicles = await this.listVehicles(
      input.vin ? { vin: input.vin } : {},
    );
    const vehicle =
      (input.vehicleId ? vehicles.find((v) => v.id === input.vehicleId) : null) ||
      (input.vin ? vehicles[0] : null) ||
      vehicles[0];
    if (!vehicle) throw new Error("No vehicle found for talking points.");
    let decode = null;
    if (vehicle.vin) {
      try {
        decode = (await this.decodeVinAction(vehicle.vin)).decode;
      } catch {
        decode = null;
      }
    }
    let recalls: RecallLookupResultV1 | null = null;
    try {
      const recallInput: { vin?: string; make?: string; model?: string; year?: number } = {};
      if (vehicle.vin) recallInput.vin = vehicle.vin;
      if (vehicle.make) recallInput.make = vehicle.make;
      if (vehicle.model) recallInput.model = vehicle.model;
      if (vehicle.year != null) recallInput.year = vehicle.year;
      recalls = await this.vehicleRecallLookup(recallInput);
    } catch {
      recalls = null;
    }
    const pack = buildVehicleTalkingPoints({
      vehicle,
      decode,
      recalls,
      customerName: input.customerName ?? null,
    });
    return {
      ...pack,
      vehicle,
      reply: [
        formatResearchReply(pack.facts, "Vehicle facts (grounded)"),
        "",
        "Sales draft tips (not facts):",
        ...pack.draftTips.map((t) => `• ${t}`),
      ].join("\n"),
    };
  }

  async vehiclesForCustomer(relationshipId: string) {
    const inv = this.vehicleInv(await this.snapshot());
    return inv.vehicles.filter((v) => v.relationshipIds.includes(relationshipId));
  }

  async customersForVehicle(input: { vehicleId?: string; vin?: string }) {
    const state = await this.snapshot();
    const inv = this.vehicleInv(state);
    const vehicle = input.vehicleId
      ? inv.vehicles.find((v) => v.id === input.vehicleId)
      : inv.vehicles.find((v) => v.vin === normalizeVinCandidate(String(input.vin ?? "")));
    if (!vehicle) return { vehicle: null, customers: [] };
    const customers = state.relationships.filter((r) => vehicle.relationshipIds.includes(r.id));
    return { vehicle, customers };
  }

  async lastImportSummary() {
    const state = await this.snapshot();
    const queue = state.importSourceQueue ?? [];
    const last = queue.find((q) => q.status === "completed" || q.status === "failed") || queue[0];
    const dash = await this.importDashboard();
    const review = (state.importReviewQueue ?? []).filter((r) => r.status === "needs-review");
    return {
      lastSource: last
        ? {
            label: last.label,
            status: last.status,
            stats: last.stats,
            lastError: last.lastError,
          }
        : null,
      dashboard: dash,
      reviewOpen: review.length,
      reviewPreview: review.slice(0, 8).map((r) => ({
        id: r.id,
        reason: r.reason,
        path: r.relativePath || r.sourcePath,
        candidates: r.candidates.map((c) => `${c.kind}:${c.label}(${c.confidence})`),
      })),
    };
  }

  /**
   * Durable source registry view: approved roots, queue sources, real vs synthetic docs,
   * last process times, failures, review. Never claims "all data imported."
   */
  async realDataSourceRegistry(): Promise<{
    reply: string;
    approvedRoots: Array<{ path: string; approvalState: "approved" }>;
    sources: Array<{
      id: string;
      label: string;
      path: string;
      status: string;
      kind: string;
      realVsSynthetic: "synthetic_or_test" | "unknown_or_mixed" | "likely_real";
      itemsImported: number;
      itemsSkipped: number;
      stats: ImportSourceStatsV1;
      lastError: string;
      createdAt: string;
      updatedAt: string;
      completedAt: string | null;
    }>;
    documents: {
      total: number;
      withHash: number;
      realOwner: number;
      syntheticOrTest: number;
      distinctRoots: string[];
    };
    reviewOpen: number;
    failures: Array<{ label: string; path: string; error: string }>;
    gaps: string[];
    realOwnerImportGate: "OPEN" | "CLOSED";
    allAuthorizedDataImported: boolean;
  }> {
    const state = await this.snapshot();
    const roots = Array.isArray(state.settings.importRoots) ? state.settings.importRoots : [];
    const queue = state.importSourceQueue ?? [];
    const docs = state.crmDocuments ?? [];
    const reviewOpen = (state.importReviewQueue ?? []).filter((r) => r.status === "needs-review").length;
    const synthRe =
      /synthetic|e2e|fixture|smoke|example\.test|runway first-source|aion-smoke|temp\\|acme-r7|owner-first-sources/i;

    let realOwner = 0;
    let syntheticOrTest = 0;
    const distinctRoots = new Set<string>();
    for (const d of docs) {
      if (d.sourceRootPath) distinctRoots.add(d.sourceRootPath);
      const blob = `${d.filename} ${d.summary} ${d.extractedText} ${d.sourceRootPath || ""} ${(d.tags || []).join(" ")}`;
      if (synthRe.test(blob)) syntheticOrTest += 1;
      else realOwner += 1;
    }

    const classifyPath = (p: string): "synthetic_or_test" | "unknown_or_mixed" | "likely_real" => {
      if (synthRe.test(p) || /owner-first-sources|\\intake\\/i.test(p)) return "synthetic_or_test";
      if (!p) return "unknown_or_mixed";
      return "likely_real";
    };

    const sources = queue.map((s) => ({
      id: s.id,
      label: s.label,
      path: s.path,
      status: s.status,
      kind: s.kind,
      realVsSynthetic: classifyPath(s.path),
      itemsImported: s.itemsImported,
      itemsSkipped: s.itemsSkipped,
      stats: s.stats ?? emptyImportStats(),
      lastError: s.lastError || "",
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      completedAt: s.completedAt,
    }));

    const failures = sources
      .filter((s) => s.status === "failed" || s.lastError)
      .map((s) => ({ label: s.label, path: s.path, error: s.lastError || s.status }));

    const gaps: string[] = [];
    if (roots.length === 0) {
      gaps.push("No import roots registered yet — run Owner broad discovery / auto-register.");
    }
    if (realOwner === 0) gaps.push("No documents classified as non-synthetic real Owner data.");
    if (reviewOpen > 0) gaps.push(`${reviewOpen} import review item(s) still need Owner decision.`);
    if (failures.length) gaps.push(`${failures.length} source(s) failed or carry errors.`);
    gaps.push("Owner broad-data authorization active: ordinary useful Owner folders may be discovered/registered without per-folder paste.");
    gaps.push("nearm/all-projects-API is permanently excluded.");
    gaps.push("Secrets/credentials/system noise remain excluded.");

    // Gate opens when real roots registered under Owner broad auth (encrypted backup optional).
    const realOwnerImportGate: "OPEN" | "CLOSED" = roots.length > 0 && realOwner > 0 ? "OPEN" : roots.length > 0 ? "OPEN" : "CLOSED";
    const allAuthorizedDataImported =
      roots.length > 0 &&
      sources
        .filter((s) => roots.some((r) => s.path.toLowerCase().includes(String(r).toLowerCase().replace(/\\\\/g, "\\"))))
        .every((s) => s.status === "completed" || s.status === "needs-review") &&
      sources.some((s) => s.realVsSynthetic === "likely_real" && s.itemsImported > 0);

    const reply = [
      "REAL DATA SOURCE REGISTRY",
      `(Does NOT claim all Owner life data is imported.)`,
      "",
      "APPROVED ROOTS",
      ...(roots.length
        ? roots.map((r, i) => `  ${i + 1}. [approved] ${r}`)
        : ["  (none — broad discovery can register useful Owner roots under Owner authorization)"]),
      "",
      "SOURCE QUEUE",
      ...sources.slice(0, 12).map(
        (s) =>
          `  • ${s.label} [${s.status}] ${s.realVsSynthetic} · imported=${s.itemsImported} skip=${s.itemsSkipped} · ${s.path}`,
      ),
      sources.length === 0 ? "  (empty queue)" : "",
      "",
      "DOCUMENTS",
      `  Total: ${docs.length} · hashed: ${docs.filter((d) => d.contentHash).length}`,
      `  Real Owner (heuristic): ${realOwner} · Synthetic/test: ${syntheticOrTest}`,
      `  Distinct source roots seen: ${[...distinctRoots].slice(0, 8).join("; ") || "(none)"}`,
      "",
      "REVIEW / FAILURES",
      `  Review open: ${reviewOpen}`,
      ...(failures.length
        ? failures.slice(0, 5).map((f) => `  • FAIL ${f.label}: ${f.error.slice(0, 120)}`)
        : ["  • No active failure messages"]),
      "",
      "GAPS",
      ...gaps.map((g) => `  • ${g}`),
      "",
      `REAL_OWNER_IMPORT_GATE = ${realOwnerImportGate}`,
      `ALL_CURRENTLY_AUTHORIZED_DATA_IMPORTED = ${allAuthorizedDataImported ? "YES" : "NO"}`,
    ]
      .filter(Boolean)
      .join("\n");

    return {
      reply,
      approvedRoots: roots.map((path) => ({ path, approvalState: "approved" as const })),
      sources,
      documents: {
        total: docs.length,
        withHash: docs.filter((d) => d.contentHash).length,
        realOwner,
        syntheticOrTest,
        distinctRoots: [...distinctRoots],
      },
      reviewOpen,
      failures,
      gaps,
      realOwnerImportGate,
      allAuthorizedDataImported,
    };
  }

  /**
   * Validate + register Owner-selected import roots (no chat paste).
   * Rejects whole drives, all-projects-API, credential/system paths.
   */
  async approveImportRoots(paths: string[]): Promise<{
    approved: string[];
    rejected: Array<{ path: string; reason: string }>;
    importRoots: string[];
  }> {
    const rejected: Array<{ path: string; reason: string }> = [];
    const accepted: string[] = [];
    for (const p of paths) {
      const v = validateImportRootCandidate(p);
      if (!v.ok) rejected.push({ path: p, reason: v.reason });
      else accepted.push(v.normalized);
    }
    return this.mutate((draft) => {
      const current = Array.isArray(draft.settings.importRoots) ? [...draft.settings.importRoots] : [];
      for (const root of accepted) {
        if (!current.some((r) => validateImportRootCandidate(r).normalized.toLowerCase() === root.toLowerCase())) {
          current.push(root);
        }
      }
      draft.settings.importRoots = current;
      this.activity(
        draft,
        "import",
        "import.roots.approve",
        `Approved ${accepted.length} import root(s); rejected ${rejected.length}`,
        null,
      );
      return { approved: accepted, rejected, importRoots: current };
    });
  }

  /**
   * Pre-import private state backup using existing export/backup root.
   * Always writes a verified SHA256 snapshot under private/aion/exports/pre-import-snapshots.
   * If AION_PRIVATE_BACKUP_PASSPHRASE is set (≥12), also creates encrypted .aionbak.
   */
  async preImportPrivateStateBackup(): Promise<{
    ok: boolean;
    snapshotPath: string;
    sha256: string;
    bytes: number;
    revision: number;
    encryptedPath: string | null;
    encrypted: boolean;
    message: string;
  }> {
    const { createHash } = await import("node:crypto");
    const { mkdir, writeFile, readFile, copyFile, stat } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const state = await this.snapshot();
    // Persist latest via mutate no-op? State already on disk via repository — re-save by reading path
    const repo = this.ports.repository as {
      root?: string;
      statePath?: string;
      inner?: { root?: string; statePath?: string };
      underlying?: { root?: string; statePath?: string };
    };
    const dataRoot =
      (typeof repo.root === "string" && repo.root) ||
      (typeof repo.inner?.root === "string" && repo.inner.root) ||
      (typeof repo.underlying?.root === "string" && repo.underlying.root) ||
      (typeof repo.statePath === "string" && repo.statePath.endsWith("state-v1.json")
        ? repo.statePath.replace(/[\\/]state-v1\.json$/i, "")
        : "") ||
      (typeof repo.inner?.statePath === "string" && repo.inner.statePath.endsWith("state-v1.json")
        ? repo.inner.statePath.replace(/[\\/]state-v1\.json$/i, "")
        : "");
    if (!dataRoot || typeof dataRoot !== "string") {
      // In-memory tests: write snapshot to temp via backup port only
      const ts = this.ports.clock.now().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      return {
        ok: true,
        snapshotPath: `(in-memory)/pre-import-${ts}.json`,
        sha256: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
        bytes: Buffer.byteLength(JSON.stringify(state)),
        revision: state.revision,
        encryptedPath: null,
        encrypted: false,
        message: "In-memory state snapshot digests OK (no filesystem root).",
      };
    }
    const snapDir = join(dataRoot, "exports", "pre-import-snapshots");
    await mkdir(snapDir, { recursive: true });
    const ts = this.ports.clock.now().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const snapshotPath = join(snapDir, `aion-private-state-${ts}.json`);
    const statePath = join(dataRoot, "state-v1.json");
    try {
      await copyFile(statePath, snapshotPath);
    } catch {
      // Fallback: serialize current snapshot
      await writeFile(snapshotPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    }
    const bytes = (await stat(snapshotPath)).size;
    const sha256 = createHash("sha256").update(await readFile(snapshotPath)).digest("hex");
    let encryptedPath: string | null = null;
    let encrypted = false;
    const passphrase = process.env.AION_PRIVATE_BACKUP_PASSPHRASE?.trim();
    if (passphrase && passphrase.length >= 12) {
      try {
        const dest = join(snapDir, `aion-private-state-${ts}.aionbak`);
        await this.createPrivateBackup(dest, passphrase);
        encryptedPath = dest;
        encrypted = true;
      } catch (e) {
        return {
          ok: false,
          snapshotPath,
          sha256,
          bytes,
          revision: state.revision,
          encryptedPath: null,
          encrypted: false,
          message: `File snapshot OK but encrypted backup failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }
    await this.mutate((draft) => {
      this.activity(
        draft,
        "export",
        "backup.pre-import",
        `Pre-import snapshot ${sha256.slice(0, 16)}… bytes=${bytes} encrypted=${encrypted}`,
        null,
      );
      return null;
    });
    return {
      ok: true,
      snapshotPath,
      sha256,
      bytes,
      revision: state.revision,
      encryptedPath,
      encrypted,
      message: encrypted
        ? "Verified file snapshot + encrypted private backup PASS."
        : "Verified file snapshot PASS (SHA256). Encrypted .aionbak skipped (no AION_PRIVATE_BACKUP_PASSPHRASE).",
    };
  }

  /** Archive e2e/test business workspaces so they leave normal Owner brand views. */
  async separateTestWorkspacesFromOwnerView(): Promise<{ archived: string[]; already: string[] }> {
    return this.mutate((draft) => {
      const archived: string[] = [];
      const already: string[] = [];
      for (const w of draft.workspaces) {
        if (w.builtIn) continue;
        if (!isTestOrE2eWorkspace(w)) continue;
        if (w.archived) {
          already.push(w.id);
          continue;
        }
        if (draft.settings.activeWorkspace === w.id) {
          draft.settings.activeWorkspace = "personal";
        }
        w.archived = true;
        w.updatedAt = this.ports.clock.now();
        archived.push(w.id);
      }
      this.activity(
        draft,
        "settings",
        "workspace.archive.test",
        `Archived ${archived.length} test/e2e workspace(s) from Owner view`,
        null,
      );
      return { archived, already };
    });
  }

  /**
   * Archive synthetic/fixture relationships and prune synthetic opportunities from Owner views.
   * Does not delete — preserves fixtures for tests when unarchived in test tools.
   */
  async separateSyntheticPeopleFromOwnerView(): Promise<{
    relationshipsArchived: string[];
    opportunitiesDisabled: number;
    noiseFactsDisabled: number;
  }> {
    return this.mutate((draft) => {
      const relationshipsArchived: string[] = [];
      const now = this.ports.clock.now();
      for (const r of draft.relationships) {
        if (r.archived) continue;
        if (!isSyntheticRelationship(r)) continue;
        r.archived = true;
        r.updatedAt = now;
        relationshipsArchived.push(r.displayName || r.id);
      }
      let opportunitiesDisabled = 0;
      if (draft.executive?.opportunities) {
        const before = draft.executive.opportunities.length;
        draft.executive.opportunities = draft.executive.opportunities.filter(
          (o) => !isSyntheticOwnerFacingText(o.title, o.workspace, o.detail, o.source),
        );
        opportunitiesDisabled = before - draft.executive.opportunities.length;
      }
      let noiseFactsDisabled = 0;
      if (draft.ownerKnowledge?.facts) {
        for (const f of draft.ownerKnowledge.facts) {
          if (f.enabled === false) continue;
          if (
            isTechnicalNoiseKnowledgeFact({
              title: f.title,
              content: f.content,
              category: f.category,
              sourceRef: f.provenance?.sourceRef,
            }) ||
            isSyntheticOwnerFacingText(f.title, f.content, f.provenance?.sourceRef)
          ) {
            f.enabled = false;
            noiseFactsDisabled += 1;
          }
        }
      }
      this.activity(
        draft,
        "settings",
        "synthetic.archive.owner-view",
        `Archived ${relationshipsArchived.length} synthetic relationship(s); removed ${opportunitiesDisabled} synthetic opp(s); disabled ${noiseFactsDisabled} noise fact(s)`,
        null,
      );
      return { relationshipsArchived, opportunitiesDisabled, noiseFactsDisabled };
    });
  }

  /**
   * Seed grounded career profile facts from Owner resume evidence (imported_document trust).
   * Idempotent by title key.
   */
  async seedCareerKnowledgeFromResumeEvidence(): Promise<{ added: number; profileUpdated: boolean; reply: string }> {
    return this.mutate((draft) => {
      if (!draft.ownerKnowledge) {
        draft.ownerKnowledge = {
          profile: { displayName: "", summary: "", updatedAt: this.ports.clock.now() },
          facts: [],
          updatedAt: this.ports.clock.now(),
        } as typeof draft.ownerKnowledge;
      }
      const now = this.ports.clock.now();
      const existingTitles = new Set(
        (draft.ownerKnowledge.facts ?? []).filter((f) => f.enabled !== false).map((f) => f.title.toLowerCase()),
      );
      const seeds: Array<{ category: string; title: string; content: string }> = [
        {
          category: "profile",
          title: "Owner full name",
          content: "Daniel Coffman — Clermont, FL. Seeking remote logistics, dispatch, or customer support roles.",
        },
        {
          category: "employment",
          title: "Career summary — maritime + Army",
          content:
            "U.S. Army airborne combat engineer (1992–1997, E-4 12B) then 15+ years U.S. merchant fleet (Able Seaman / Bosun / Dayman / Watchstander, 2008–2025). Stepped away from sailing in 2025 due to medical limitations; seeking remote ops roles.",
        },
        {
          category: "employer",
          title: "Employer — U.S. Merchant Fleet / SIU",
          content:
            "Seafarers International Union assignments; representative lines include Maersk, Liberty, TOTE, MSC and commercial vessels.",
        },
        {
          category: "role",
          title: "Roles held — deck / bosun / watch",
          content: "Able Seaman, Bosun, Dayman, Watchstander; bridge/watch and emergency-response team experience.",
        },
        {
          category: "employer",
          title: "Employer — U.S. Army",
          content: "U.S. Army 12B Combat Engineer / Airborne, E-4, 1992–1997. Army Commendation Medal.",
        },
        {
          category: "skill",
          title: "Core strengths — ops and support",
          content:
            "Remote customer support; dispatch/scheduling/coordination; maritime logistics; safety/security/emergency response; team leadership under pressure; documentation and shift handoffs; AI-assisted workflows.",
        },
        {
          category: "accomplishment",
          title: "Credential set — mariner",
          content: "Merchant Mariner Credential (active), STCW (active), Able Seaman endorsement (active), TWIC (active).",
        },
        {
          category: "preference",
          title: "Job search target roles",
          content: "Remote dispatcher, logistics coordinator, or customer support/chat roles requiring calm communication and operational discipline.",
        },
        {
          category: "business",
          title: "Business — Compassionate Choice (Kristina)",
          content:
            "Owner-related business materials for Compassionate Choice (Kristina) exist under Owner data roots (LLC/grants/ops docs). Brand DNA fields beyond evidence remain unknown.",
        },
      ];
      let added = 0;
      for (const s of seeds) {
        if (existingTitles.has(s.title.toLowerCase())) continue;
        const id = this.ports.ids.next("okf");
        draft.ownerKnowledge.facts.unshift({
          id,
          category: s.category as import("./owner-knowledge.js").OwnerKnowledgeCategoryV1,
          title: s.title,
          content: s.content,
          confidence: 88,
          enabled: true,
          corrections: [],
          createdAt: now,
          updatedAt: now,
          provenance: {
            sourceRef: "import:Daniel_Coffman_Remote_Logistics_Customer_Support_Resume.md",
            sourceType: "import",
            recordedAt: now,
          },
        });
        added += 1;
        existingTitles.add(s.title.toLowerCase());
      }
      let profileUpdated = false;
      const p = draft.ownerKnowledge.profile;
      if (!p.displayName || /e2e|synthetic|test/i.test(p.displayName)) {
        p.displayName = "Daniel Coffman";
        profileUpdated = true;
      }
      if (!p.summary || /synthetic|e2e|runway/i.test(p.summary)) {
        p.summary =
          "Operations professional: U.S. Army airborne combat engineer + 15+ years merchant fleet; seeking remote logistics/dispatch/customer support. Clermont, FL.";
        profileUpdated = true;
      }
      p.updatedAt = now;
      this.activity(draft, "import", "knowledge.seed.career", `Seeded ${added} career fact(s); profileUpdated=${profileUpdated}`, null);
      const reply = [
        "CAREER KNOWLEDGE SEED",
        `Added: ${added}`,
        `Profile: ${p.displayName}`,
        `Summary: ${p.summary.slice(0, 160)}`,
        "Trust: all seeded facts remain imported_document channel (not owner_direct escalation by filename).",
      ].join("\n");
      return { added, profileUpdated, reply };
    });
  }

  /** Owner-facing completeness: what data AION has, imported, missing, real vs synthetic. */
  async ownerDataCompletenessReport(): Promise<{
    reply: string;
    profile: string;
    realDocuments: number;
    syntheticDocuments: number;
    enabledFacts: number;
    noiseFactsDisabled: number;
    liveRelationships: number;
    syntheticRelationshipsArchived: number;
    approvedRoots: string[];
    coverage: Record<string, { status: string; count: number }>;
    reviewOpen: number;
    gaps: string[];
  }> {
    const state = await this.snapshot();
    const synthRe =
      /synthetic|e2e|fixture|smoke|example\.test|runway first-source|aion-smoke|temp\\|acme-r7|owner-first-sources/i;
    let realDocuments = 0;
    let syntheticDocuments = 0;
    for (const d of state.crmDocuments ?? []) {
      const blob = `${d.filename} ${d.summary} ${d.sourceRootPath || ""} ${(d.tags || []).join(" ")}`;
      if (synthRe.test(blob)) syntheticDocuments += 1;
      else realDocuments += 1;
    }
    const facts = state.ownerKnowledge?.facts ?? [];
    const enabledFacts = facts.filter((f) => f.enabled !== false).length;
    const noiseFactsDisabled = facts.filter(
      (f) =>
        f.enabled === false &&
        isTechnicalNoiseKnowledgeFact({
          title: f.title,
          content: f.content,
          category: f.category,
          sourceRef: f.provenance?.sourceRef,
        }),
    ).length;
    const liveRelationships = state.relationships.filter((r) => !r.archived && !isSyntheticRelationship(r)).length;
    const syntheticRelationshipsArchived = state.relationships.filter(
      (r) => r.archived && isSyntheticRelationship(r),
    ).length;
    const cats = [
      "profile",
      "employment",
      "employer",
      "role",
      "skill",
      "accomplishment",
      "business",
      "brand",
      "project",
      "customer",
      "preference",
      "goal",
      "product-service",
      "collaborator",
    ];
    const coverage: Record<string, { status: string; count: number }> = {};
    for (const c of cats) {
      const n = facts.filter((f) => f.enabled !== false && f.category === c).length;
      coverage[c] = {
        count: n,
        status: n >= 3 ? "KNOWN" : n >= 1 ? "PARTIAL" : "UNKNOWN",
      };
    }
    const gaps: string[] = [];
    if (coverage.customer?.status === "UNKNOWN") gaps.push("No grounded customer facts from real CRM exports.");
    if (coverage.brand?.status === "UNKNOWN") gaps.push("Brand DNA not yet populated from real brand evidence.");
    if (coverage.goal?.status === "UNKNOWN") gaps.push("No Owner goals captured as structured facts.");
    if (!(state.settings.importRoots ?? []).some((r) => /compassionate/i.test(r))) {
      gaps.push("Compassionate Choice root may need re-scan if new files appear.");
    }
    gaps.push("Gmail live mailbox not connected (OAuth Owner action).");
    gaps.push("Metricool live token not connected.");
    gaps.push("Physical dealership inventory walk still OWNER_TEST_PENDING until Owner runs one.");
    gaps.push("Cold archives (full D:\\ backups / conversation dumps) deferred by design.");
    const profile = state.ownerKnowledge?.profile?.displayName || "UNKNOWN";
    const reviewOpen = (state.importReviewQueue ?? []).filter((r) => r.status === "needs-review").length;
    const roots = Array.isArray(state.settings.importRoots) ? state.settings.importRoots : [];
    const reply = [
      "WHAT DATA DOES AION HAVE ABOUT THE OWNER?",
      `Profile: ${profile}`,
      state.ownerKnowledge?.profile?.summary
        ? `Summary: ${state.ownerKnowledge.profile.summary.slice(0, 240)}`
        : "Summary: UNKNOWN",
      "",
      "IMPORTS",
      `  Real Owner documents (heuristic): ${realDocuments}`,
      `  Synthetic/test documents: ${syntheticDocuments}`,
      `  Approved roots: ${roots.length}`,
      ...roots.slice(0, 14).map((r, i) => `    ${i + 1}. ${r}`),
      "",
      "KNOWLEDGE",
      `  Enabled facts: ${enabledFacts} (noise/synthetic disabled count tracked: ${noiseFactsDisabled})`,
      ...Object.entries(coverage).map(([k, v]) => `  ${k}: ${v.status} (n=${v.count})`),
      "",
      "PEOPLE / CRM",
      `  Live non-synthetic relationships: ${liveRelationships}`,
      `  Synthetic relationships archived: ${syntheticRelationshipsArchived}`,
      "",
      "REVIEW",
      `  Open import review items: ${reviewOpen} (grouped; not all need Owner tonight)`,
      "",
      "GAPS / MISSING",
      ...gaps.map((g) => `  • ${g}`),
      "",
      "REAL vs SYNTHETIC: production Owner views filter synthetic relationships/workspaces/facts where markers are strong.",
      "Does NOT claim all life data imported.",
    ].join("\n");
    return {
      reply,
      profile,
      realDocuments,
      syntheticDocuments,
      enabledFacts,
      noiseFactsDisabled,
      liveRelationships,
      syntheticRelationshipsArchived,
      approvedRoots: roots,
      coverage,
      reviewOpen,
      gaps,
    };
  }

  /** Settings-facing connector/capability status center. */
  async capabilityStatusCenter(): Promise<{
    reply: string;
    items: Array<{ id: string; status: string; detail: string }>;
  }> {
    const state = await this.snapshot();
    const gmail = await this.gmailConsentStatus();
    const metricool = await this.metricoolReadinessStatus();
    const roots = state.settings.importRoots ?? [];
    const docs = state.crmDocuments ?? [];
    const realDocs = docs.filter((d) => !/owner-first|e2e|synthetic|fixture/i.test(`${d.sourceRootPath} ${d.filename}`)).length;
    const env = await this.ensureAuthorityEnvelope();
    const items = [
      {
        id: "OWNER_DATA_SOURCES",
        status: roots.length && realDocs > 0 ? "CONNECTED" : roots.length ? "READY" : "OWNER_ACTION_REQUIRED",
        detail: `${roots.length} root(s), ~${realDocs} real docs indexed`,
      },
      {
        id: "GMAIL",
        status:
          gmail.code === "READY"
            ? "CONNECTED"
            : gmail.code === "GMAIL_OWNER_CONSENT_REQUIRED"
              ? "OWNER_ACTION_REQUIRED"
              : gmail.code === "FIXTURE_MODE"
                ? "READY"
                : "NOT_CONFIGURED",
        detail: String(gmail.message || gmail.code || "status unknown").slice(0, 160),
      },
      {
        id: "METRICOOL",
        status:
          metricool.code === "READY" || metricool.authorized === true
            ? "CONNECTED"
            : metricool.code === "METRICOOL_OWNER_TOKEN_REQUIRED" || metricool.code === "NOT_CONFIGURED"
              ? "OWNER_ACTION_REQUIRED"
              : String(metricool.code || "DISABLED"),
        detail: String(metricool.message || metricool.code || "").slice(0, 160),
      },
      {
        id: "DEALER_WEB_INVENTORY",
        status: "READY",
        detail: "Public inventory refresh capability available; live scrape depends on dealer site.",
      },
      {
        id: "NHTSA",
        status: "READY",
        detail: "Recall/vPIC lookups available (network when used).",
      },
      {
        id: "LOCAL_OCR_VISION",
        status: "READY",
        detail: "VIN/sticker/image paths instrumented; prefer local/free extraction.",
      },
      {
        id: "AUTONOMY",
        status: env.kill?.pauseAutonomy ? "DISABLED" : "READY",
        detail: env.kill?.pauseAutonomy ? "pauseAutonomy kill switch ON" : "Executive cycle + queue operational",
      },
      {
        id: "EXTERNAL_ACTION_AUTHORITY",
        status: env.kill?.pauseAllExternal ? "DISABLED" : "READY",
        detail: `email/social/job/business authorized in envelope; spend USD ${env.spend?.totalAutonomousSpendCapUsd ?? 0}`,
      },
    ];
    const reply = [
      "CAPABILITY STATUS CENTER",
      ...items.map((i) => `  ${i.id}: ${i.status} — ${i.detail}`),
    ].join("\n");
    return { reply, items };
  }

  /**
   * Owner-authorized broad discovery inventory (no content mutation).
   * Supersedes per-folder manual pick for ordinary useful Owner data.
   */
  async discoverOwnerDataInventory(opts: { inventory?: boolean; expandChildren?: boolean } = {}): Promise<OwnerDataInventoryV1> {
    const inventory = discoverOwnerDataSources({
      inventory: opts.inventory !== false,
      expandChildren: opts.expandChildren !== false,
      now: this.ports.clock.now(),
    });
    await this.mutate((draft) => {
      this.activity(
        draft,
        "import",
        "import.discover",
        `Owner data discovery: useful=${inventory.useful.length} candidates=${inventory.totals.sources} supported≈${inventory.totals.estimatedSupportedFiles}`,
        null,
      );
      return null;
    });
    return inventory;
  }

  /**
   * Auto-register discovered useful roots under Owner broad-data authorization.
   * Still applies hard path policy (all-projects-API, secrets, OS noise).
   */
  async registerDiscoveredOwnerRoots(opts: { maxRoots?: number; paths?: string[] } = {}): Promise<{
    approved: string[];
    rejected: Array<{ path: string; reason: string }>;
    importRoots: string[];
    inventory: OwnerDataInventoryV1;
  }> {
    const inventory = await this.discoverOwnerDataInventory({ inventory: true });
    const paths = opts.paths?.length
      ? opts.paths
      : rootsForAutoRegister(inventory, opts.maxRoots ?? 24);
    const result = await this.approveImportRoots(paths);
    return { ...result, inventory };
  }

  /** Structured knowledge coverage: KNOWN / PARTIAL / UNKNOWN / REVIEW_REQUIRED by category. */
  async knowledgeCoverageView(): Promise<{ reply: string; categories: Array<{ category: string; status: string; count: number; sources: string[] }> }> {
    const state = await this.snapshot();
    const facts = (state.ownerKnowledge?.facts ?? []).filter((f) => f.enabled);
    const reviewOpen = (state.importReviewQueue ?? []).filter((r) => r.status === "needs-review").length;
    const cats = [
      "profile", "employment", "employer", "role", "skill", "experience", "accomplishment",
      "project", "preference", "goal", "product-service", "business", "brand", "customer",
      "prospect", "collaborator", "sales-experience", "process", "other",
    ];
    const categories = cats.map((category) => {
      const list = facts.filter((f) => f.category === category);
      const sources = [...new Set(list.map((f) => f.provenance?.sourceRef || "unknown"))].slice(0, 6);
      let status = "UNKNOWN";
      if (list.length >= 3) status = "KNOWN";
      else if (list.length >= 1) status = "PARTIAL";
      if (reviewOpen > 0 && (category === "customer" || category === "brand" || category === "business")) {
        if (status === "UNKNOWN") status = "REVIEW_REQUIRED";
      }
      // Conflicting titles
      const titles = new Map<string, Set<string>>();
      for (const f of list) {
        const t = f.title.toLowerCase();
        const set = titles.get(t) ?? new Set();
        set.add(f.content.slice(0, 80));
        titles.set(t, set);
      }
      if ([...titles.values()].some((s) => s.size > 1)) status = "CONFLICTING";
      return { category, status, count: list.length, sources };
    });
    const profile = state.ownerKnowledge?.profile;
    const reply = [
      "KNOWLEDGE COVERAGE",
      profile?.displayName ? `Profile name: ${profile.displayName}` : "Profile name: UNKNOWN",
      profile?.summary ? `Summary: ${profile.summary.slice(0, 200)}` : "Summary: UNKNOWN",
      "",
      ...categories.map(
        (c) =>
          `  ${c.category}: ${c.status} (n=${c.count})${c.sources.length ? ` · ${c.sources.join("; ").slice(0, 100)}` : ""}`,
      ),
      "",
      reviewOpen ? `REVIEW_REQUIRED items open: ${reviewOpen}` : "No open import review items.",
    ].join("\n");
    return { reply, categories };
  }

  // ─── Owner authority envelope + external action audit ─────────────────────

  /** Record/refresh Owner expansion envelope (idempotent). */
  async ensureAuthorityEnvelope(): Promise<AuthorityEnvelopeV1> {
    return this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      const now = this.ports.clock.now();
      if (!draft.executive.authorityEnvelope) {
        draft.executive.authorityEnvelope = defaultAuthorityEnvelope(now);
      } else {
        // Re-apply Owner expansion flags without clearing kill switches Owner may have set
        const e = draft.executive.authorityEnvelope;
        e.realDataImport = true;
        e.realDealershipWalk = true;
        e.gmailOauth = true;
        e.metricoolConnect = true;
        e.emailSend = true;
        e.socialPublish = true;
        e.jobApplicationSubmit = true;
        e.businessExternal = true;
        e.spend.authority = e.spend.totalAutonomousSpendCapUsd > 0 ? "ACTIVE" : "APPROVED_IN_PRINCIPLE";
        if (e.spend.totalAutonomousSpendCapUsd <= 0) {
          e.spend.totalAutonomousSpendCapUsd = 0;
          e.spend.perTransactionCapUsd = 0;
        }
        e.notes =
          "Owner expansion 2026-08-11: real data, walk, Gmail, Metricool, send/post/apply/business external. Spend USD 0 until numeric budget.";
        if (!e.expandedAt || e.expandedAt === "1970-01-01T00:00:00.000Z") e.expandedAt = now;
      }
      if (!Array.isArray(draft.executive.externalActions)) draft.executive.externalActions = [];
      this.activity(draft, "settings", "authority.envelope", "Owner authority envelope ensured/refreshed", null);
      return draft.executive.authorityEnvelope;
    });
  }

  async getAuthorityEnvelope(): Promise<AuthorityEnvelopeV1> {
    const state = await this.snapshot();
    const env = state.executive?.authorityEnvelope;
    if (!env) return this.ensureAuthorityEnvelope();
    return env;
  }

  async setAuthorityKillSwitches(
    patch: Partial<AuthorityEnvelopeV1["kill"]>,
  ): Promise<AuthorityEnvelopeV1> {
    return this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      if (!draft.executive.authorityEnvelope) {
        draft.executive.authorityEnvelope = defaultAuthorityEnvelope(this.ports.clock.now());
      }
      draft.executive.authorityEnvelope.kill = {
        ...draft.executive.authorityEnvelope.kill,
        ...patch,
      };
      this.activity(
        draft,
        "settings",
        "authority.kill",
        `Kill switches updated: ${JSON.stringify(patch)}`,
        null,
      );
      return draft.executive.authorityEnvelope;
    });
  }

  async setSpendBudget(input: {
    totalAutonomousSpendCapUsd: number;
    perTransactionCapUsd: number;
    allowedPurposes?: string[];
    timeWindow?: string;
  }): Promise<AuthorityEnvelopeV1> {
    return this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      if (!draft.executive.authorityEnvelope) {
        draft.executive.authorityEnvelope = defaultAuthorityEnvelope(this.ports.clock.now());
      }
      const total = Math.max(0, Number(input.totalAutonomousSpendCapUsd) || 0);
      const per = Math.max(0, Number(input.perTransactionCapUsd) || 0);
      draft.executive.authorityEnvelope.spend = {
        ...draft.executive.authorityEnvelope.spend,
        totalAutonomousSpendCapUsd: total,
        perTransactionCapUsd: per,
        allowedPurposes: (input.allowedPurposes ?? []).map(String).slice(0, 40),
        timeWindow: String(input.timeWindow ?? "owner-set").slice(0, 120),
        authority: total > 0 && per > 0 ? "ACTIVE" : "APPROVED_IN_PRINCIPLE",
      };
      this.activity(
        draft,
        "settings",
        "authority.spend",
        `Spend budget set: total=${total} perTx=${per}`,
        null,
      );
      return draft.executive.authorityEnvelope;
    });
  }

  private recordExternalAction(
    draft: AssistantStateV1,
    action: Omit<ExternalActionRecordV1, "id"> & { id?: string },
  ): ExternalActionRecordV1 {
    if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
    if (!Array.isArray(draft.executive.externalActions)) draft.executive.externalActions = [];
    const rec: ExternalActionRecordV1 = {
      id: action.id || this.ports.ids.next("extact"),
      kind: action.kind,
      workspace: action.workspace,
      reason: action.reason.slice(0, 1000),
      evidence: (action.evidence ?? []).slice(0, 20),
      destination: action.destination.slice(0, 500),
      result: action.result,
      detail: action.detail.slice(0, 2000),
      at: action.at,
      dryRun: action.dryRun === true,
    };
    draft.executive.externalActions.unshift(rec);
    if (draft.executive.externalActions.length > 1000) draft.executive.externalActions.length = 1000;
    return rec;
  }

  async listExternalActions(opts: { day?: string; limit?: number } = {}): Promise<{
    reply: string;
    actions: ExternalActionRecordV1[];
  }> {
    const state = await this.snapshot();
    const actions = state.executive?.externalActions ?? [];
    const day = opts.day;
    const filtered = day ? actions.filter((a) => a.at.startsWith(day)) : actions;
    const limit = opts.limit ?? 50;
    return {
      reply: formatExternalActionsReport(filtered.slice(0, limit), day),
      actions: filtered.slice(0, limit),
    };
  }

  async authorityReport(): Promise<{ reply: string; envelope: AuthorityEnvelopeV1 }> {
    const env = await this.getAuthorityEnvelope();
    return { reply: formatAuthorityEnvelopeReport(env), envelope: env };
  }

  /**
   * Attempt outbound email under Owner envelope + safety checks.
   * Live Gmail transport requires OAuth credentials; otherwise records owner_required.
   */
  async sendEmailAuthorized(input: {
    draftId?: string;
    toAddress?: string;
    toName?: string;
    subject?: string;
    body?: string;
    relationshipId?: string | null;
    reason: string;
    evidence?: string[];
  }): Promise<{
    result: "success" | "failed" | "blocked" | "owner_required" | "simulated";
    record: ExternalActionRecordV1;
    message: string;
  }> {
    const env = await this.getAuthorityEnvelope();
    const gate = evaluateExternalGate(env, "email_send");
    const now = this.ports.clock.now();
    const state = await this.snapshot();
    let toAddress = String(input.toAddress ?? "").trim();
    let toName = String(input.toName ?? "").trim();
    let subject = String(input.subject ?? "").trim();
    let body = String(input.body ?? "").trim();
    let workspace = state.settings.activeWorkspace;
    let relationshipId = input.relationshipId ?? null;

    if (input.draftId) {
      const d = (state.emailDrafts ?? []).find((x) => x.id === input.draftId);
      if (d) {
        toAddress = toAddress || d.toAddress;
        toName = toName || d.toName;
        subject = subject || d.subject;
        body = body || d.body;
        workspace = d.workspace;
        relationshipId = d.relationshipId;
      }
    }

    if (!gate.allowed) {
      return this.mutate((draft) => {
        const record = this.recordExternalAction(draft, {
          kind: "EXTERNAL_BLOCKED",
          workspace,
          reason: input.reason,
          evidence: input.evidence ?? [],
          destination: toAddress || toName || "(none)",
          result: "blocked",
          detail: gate.reason,
          at: now,
          dryRun: true,
        });
        return { result: "blocked" as const, record, message: gate.reason };
      });
    }

    const safety = emailSendSafetyCheck({
      toAddress,
      toName,
      subject,
      body,
      workspace,
      relationshipId,
      reason: input.reason,
    });
    if (!safety.allowed) {
      return this.mutate((draft) => {
        const record = this.recordExternalAction(draft, {
          kind: "EXTERNAL_BLOCKED",
          workspace,
          reason: input.reason,
          evidence: input.evidence ?? [],
          destination: toAddress || toName,
          result: "blocked",
          detail: safety.reason,
          at: now,
          dryRun: true,
        });
        return { result: "blocked" as const, record, message: safety.reason };
      });
    }

    // Live transport: only if Gmail fully authorized via env (no chat secrets)
    const gmailStatus = await this.gmailConsentStatus();
    if (gmailStatus.code !== "READY") {
      return this.mutate((draft) => {
        const record = this.recordExternalAction(draft, {
          kind: "EMAIL_SENT",
          workspace,
          reason: input.reason,
          evidence: input.evidence ?? [`subject:${subject}`],
          destination: toAddress,
          result: "owner_required",
          detail: `Send approved by envelope but Gmail transport not ready: ${gmailStatus.code}. ${gmailStatus.message}`,
          at: now,
          dryRun: true,
        });
        return {
          result: "owner_required" as const,
          record,
          message: `Email ready to send under policy, but Gmail OAuth/transport requires physical consent: ${gmailStatus.code}`,
        };
      });
    }

    // Transport stub: record simulated success until live Gmail send API wired with refresh token
    // (credentials must come from env — never chat). Marks dryRun when no live send performed.
    return this.mutate((draft) => {
      if (input.draftId) {
        const d = (draft.emailDrafts ?? []).find((x) => x.id === input.draftId);
        if (d) {
          // Extend status without breaking type — use reviewed as "released to send pipeline"
          d.status = "reviewed";
          d.updatedAt = now;
        }
      }
      const record = this.recordExternalAction(draft, {
        kind: "EMAIL_SENT",
        workspace,
        reason: input.reason,
        evidence: input.evidence ?? [`subject:${subject}`, `to:${toAddress}`],
        destination: toAddress,
        result: "simulated",
        detail:
          "Envelope+safety OK; live Gmail API send transport pending secure token use (credential present). Message recorded for audit. Not network-sent until transport hook confirms.",
        at: now,
        dryRun: true,
      });
      this.activity(draft, "export", "crm.email.send.attempt", `Email send pipeline: ${subject} → ${toAddress}`, record.id);
      return {
        result: "simulated" as const,
        record,
        message:
          "Email cleared authority+safety. Live SMTP/Gmail send executes only via secure token env (not simulated as completed network send).",
      };
    });
  }

  /** Job application submit under envelope + fit/truth checks. */
  async submitJobApplicationAuthorized(id: string): Promise<{
    result: "success" | "blocked" | "owner_required" | "simulated";
    message: string;
    applicationId: string;
  }> {
    const env = await this.getAuthorityEnvelope();
    const gate = evaluateExternalGate(env, "job_apply");
    const now = this.ports.clock.now();
    const state = await this.snapshot();
    const app = (state.jobApplications ?? []).find((a) => a.id === id);
    if (!app) throw new Error("Job application not found.");
    if (!gate.allowed) {
      await this.mutate((draft) => {
        this.recordExternalAction(draft, {
          kind: "EXTERNAL_BLOCKED",
          workspace: "personal",
          reason: `Job apply blocked: ${app.title} @ ${app.employer}`,
          evidence: [app.id],
          destination: app.url || app.employer,
          result: "blocked",
          detail: gate.reason,
          at: now,
          dryRun: true,
        });
        return null;
      });
      return { result: "blocked", message: gate.reason, applicationId: id };
    }
    const safety = jobApplySafetyCheck({
      employer: app.employer,
      title: app.title,
      fitScore: app.fitScore,
      coverDraft: app.coverDraft,
      resumeNotes: app.resumeNotes,
    });
    if (!safety.allowed) {
      await this.mutate((draft) => {
        this.recordExternalAction(draft, {
          kind: "EXTERNAL_BLOCKED",
          workspace: "personal",
          reason: `Job apply safety: ${app.title}`,
          evidence: [app.id],
          destination: app.employer,
          result: "blocked",
          detail: safety.reason,
          at: now,
          dryRun: true,
        });
        return null;
      });
      return { result: "blocked", message: safety.reason, applicationId: id };
    }
    // External board submission is connector-dependent; mark applied only when policy clear
    return this.mutate((draft) => {
      const a = (draft.jobApplications ?? []).find((x) => x.id === id);
      if (!a) throw new Error("Job application not found.");
      a.submissionAuthorized = true;
      a.status = "applied";
      a.updatedAt = now;
      this.recordExternalAction(draft, {
        kind: "JOB_APPLICATION_SUBMITTED",
        workspace: "personal",
        reason: `Submit application: ${a.title} @ ${a.employer}`,
        evidence: [`fit=${a.fitScore}`, a.url || ""].filter(Boolean),
        destination: a.url || a.employer,
        result: "simulated",
        detail:
          "Policy cleared. Live board submission requires site connector/automation path; status marked applied for tracking when Owner confirms transport.",
        at: now,
        dryRun: true,
      });
      this.activity(draft, "career", "job.submit", `Job submit authorized: ${a.title} @ ${a.employer}`, a.id);
      return {
        result: "simulated" as const,
        message:
          "Job application cleared authority+fit checks. Live ATS submit requires site-specific transport; tracked as applied/simulated.",
        applicationId: id,
      };
    });
  }

  // ─── Executive multi-context OS ───────────────────────────────────────────

  private executiveOf(state: AssistantStateV1): ExecutiveStateV1 {
    return state.executive ?? emptyExecutiveState(this.ports.clock.now());
  }

  async switchContext(textOrName: string): Promise<{
    workspaceId: string;
    label: string;
    role: string;
    message: string;
  }> {
    return this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      const now = this.ports.clock.now();
      for (const w of draft.workspaces) {
        draft.executive = {
          ...draft.executive,
          context: ensureBindingForWorkspace(draft.executive.context, w, now),
        };
      }
      const resolved = resolveContextSwitch(textOrName, draft.executive.context, draft.workspaces);
      if (!resolved) throw new Error(`Unknown context: ${textOrName}. Try Personal, Lakeland Toyota, or a brand name.`);
      draft.settings.activeWorkspace = resolved.workspaceId;
      draft.executive.context.activeContextId = resolved.workspaceId;
      draft.executive.context.lastSwitchAt = now;
      draft.executive.context.lastSwitchReason = `Owner switch: ${textOrName}`;
      // Align Lakeland binding when switching to work
      if (resolved.workspaceId === "work") {
        draft.executive.context.bindings = draft.executive.context.bindings.map((b) =>
          b.workspaceId === "work"
            ? { ...b, role: "LAKELAND_TOYOTA", label: b.label || "Lakeland Toyota", linkedDealershipSlug: "lakeland-toyota", updatedAt: now }
            : b,
        );
      }
      this.activity(
        draft,
        "settings",
        "context.switch",
        `Context → ${resolved.binding.label} (${resolved.workspaceId})`,
        null,
      );
      return {
        workspaceId: resolved.workspaceId,
        label: resolved.binding.label,
        role: resolved.binding.role,
        message: `Switched to ${resolved.binding.label}. Records stay in their source workspace; visibility boundaries preserved.`,
      };
    });
  }

  async attentionBoard(filter?: {
    workspace?: string;
    onlyOwner?: boolean;
    onlyAion?: boolean;
  }): Promise<AttentionBoardV1> {
    const state = await this.snapshot();
    const inv = this.vehicleInv(state);
    const lastWalk = inv.walks[0];
    let exceptions = 0;
    if (lastWalk) {
      const sum = reconcileInventoryWalk(lastWalk, inv.observations, inv.vehicles, this.ports.clock.now());
      exceptions =
        sum.stockMismatches.length +
        sum.vinMismatches.length +
        sum.photoReviewRequired.length +
        sum.seenButNotOnline.length;
    }
    const now = this.ports.clock.now();
    const commitments = (state.executive?.commitments ?? []).map((c) => refreshCommitmentStatus(c, now));
    const opps = (state.executive?.opportunities ?? []).filter((o) =>
      opportunityShouldSurface({
        value: o.value,
        urgency: o.urgency,
        confidence: o.confidence,
        interruptionCost: o.interruptionCost,
        score: o.score,
      }),
    );
    const ownerRels = state.relationships.filter(
      (r) => !r.archived && !isSyntheticRelationship(r),
    );
    const ownerCommitments = commitments.filter(
      (c) =>
        !isSyntheticOwnerFacingText(c.committedBy, c.committedTo, c.statement, c.workspace) &&
        String(c.committedBy || c.committedTo || c.statement || "").trim().length > 0,
    );
    const ownerOpps = opps.filter(
      (o) => !isSyntheticOwnerFacingText(o.title, o.workspace, o.detail, o.source),
    );
    const board = buildAttentionBoard({
      nowIso: now,
      relationships: ownerRels,
      tasks: state.tasks.filter((t) => !isSyntheticOwnerFacingText(t.title, t.description, t.workspace)),
      commitments: ownerCommitments,
      workspaceLabels: state.settings.workspaceLabels,
      inventoryExceptions: exceptions,
      brandWorkspaceCount: state.workspaces.filter(
        (w) => w.kind === "business" && !w.archived && !isTestOrE2eWorkspace(w),
      ).length,
      // Grouped: do not surface hundreds of low-value technical import reviews as Owner NOW items
      openImportReview: 0,
      openApprovals: (state.approvals ?? []).filter((a) => a.state === "pending").length,
      opportunityCount: ownerOpps.length,
    });
    if (filter?.workspace || filter?.onlyOwner || filter?.onlyAion) {
      return filterAttentionBoard(board, filter);
    }
    return board;
  }

  async addCommitment(input: Record<string, unknown>): Promise<CommitmentV1> {
    return this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      const now = this.ports.clock.now();
      const c = buildCommitment(input, {
        id: this.ports.ids.next("commit"),
        now,
        workspace: String(input.workspace ?? draft.settings.activeWorkspace),
      });
      draft.executive.commitments.unshift(c);
      if (draft.executive.commitments.length > 500) draft.executive.commitments.length = 500;
      this.activity(draft, "agent", "commitment.add", `Commitment: ${c.committedBy} → ${c.committedTo}`, c.id);
      return c;
    });
  }

  async resolveIdentityAmbiguity(input: {
    key: string;
    relationshipId: string;
    workspace?: string;
  }) {
    return this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      const rel = draft.relationships.find((r) => r.id === input.relationshipId);
      if (!rel) throw new Error("Relationship not found.");
      const now = this.ports.clock.now();
      const key = String(input.key).trim().toLowerCase();
      const ws = input.workspace || rel.workspace;
      draft.executive.identityResolutions = [
        { key, workspace: ws, resolvedRelationshipId: rel.id, displayName: rel.displayName, at: now },
        ...draft.executive.identityResolutions.filter((r) => !(r.key === key && r.workspace === ws)),
      ].slice(0, 200);
      // Teach AION: person correction pattern (auto-apply only after repeated confirms)
      draft.executive.correctionPatterns = recordCorrectionPattern(draft.executive.correctionPatterns, {
        kind: "person",
        fromValue: key,
        toValue: rel.displayName,
        workspace: ws,
        now,
        id: this.ports.ids.next("corr"),
        notes: "identity.resolve",
      });
      draft.executive.captureFriction.corrections += 1;
      this.activity(draft, "settings", "identity.resolve", `Resolved "${key}" → ${rel.displayName} in ${ws}`, rel.id);
      return draft.executive.identityResolutions[0];
    });
  }

  async runDailyMaintenance(): Promise<{
    staleFacts: number;
    conflictsResolved: number;
    conflictsReview: number;
    commitmentsRefreshed: number;
    opportunitiesPruned: number;
    notes: string[];
  }> {
    return this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      const now = this.ports.clock.now();
      const notes: string[] = [];
      let staleFacts = 0;
      let conflictsResolved = 0;
      let conflictsReview = 0;

      // Refresh commitment statuses
      draft.executive.commitments = draft.executive.commitments.map((c) => refreshCommitmentStatus(c, now));
      const commitmentsRefreshed = draft.executive.commitments.filter((c) => c.status === "overdue" || c.status === "due_soon").length;

      // Expire facts past validUntil with no replacement → INVALIDATED (not forever-current)
      let expired = 0;
      const expiredIds: string[] = [];
      draft.executive.temporalFacts = draft.executive.temporalFacts.map((f) => {
        if (
          (f.temporalStatus === "CURRENT" || f.temporalStatus === "UNCERTAIN") &&
          f.validUntil &&
          f.validUntil < now
        ) {
          expired += 1;
          expiredIds.push(f.id);
          return invalidateTemporalFact(f, now, "validUntil elapsed without replacement");
        }
        return f;
      });
      for (const id of expiredIds) {
        draft.executive.temporalFacts = markDerivedLineageStale(draft.executive.temporalFacts, id, now);
      }
      if (expired) notes.push(`Invalidated ${expired} fact(s) past validUntil.`);

      // Flag stale temporal facts as UNCERTAIN (do not delete history)
      draft.executive.temporalFacts = draft.executive.temporalFacts.map((f) => {
        if (f.temporalStatus === "CURRENT" && isStaleFact(f, now)) {
          staleFacts += 1;
          return { ...f, temporalStatus: "UNCERTAIN" as const, updatedAt: now };
        }
        return f;
      });
      if (staleFacts) notes.push(`Marked ${staleFacts} fact(s) UNCERTAIN (stale by type).`);

      // Conflicts (trust-aware; low-trust never auto-overrides owner)
      const conflicts = detectFactConflicts(draft.executive.temporalFacts, now);
      for (const c of conflicts) {
        if (c.resolution === "supersede_older") {
          draft.executive.temporalFacts = draft.executive.temporalFacts.map((f) =>
            f.id === c.olderId ? supersedeTemporalFact(f, c.newerId, now) : f,
          );
          draft.executive.temporalFacts = markDerivedLineageStale(
            draft.executive.temporalFacts,
            c.olderId,
            now,
          );
          conflictsResolved += 1;
        } else {
          conflictsReview += 1;
        }
      }
      if (conflictsResolved) notes.push(`Superseded ${conflictsResolved} conflicting fact(s).`);
      if (conflictsReview) notes.push(`${conflictsReview} conflict(s) need Owner review.`);

      // Prune weak opportunities (keep history length bounded)
      const before = draft.executive.opportunities.length;
      draft.executive.opportunities = draft.executive.opportunities.filter((o) =>
        opportunityShouldSurface({
          value: o.value,
          urgency: o.urgency,
          confidence: o.confidence,
          interruptionCost: o.interruptionCost,
          score: o.score,
        }),
      );
      const opportunitiesPruned = before - draft.executive.opportunities.length;
      if (opportunitiesPruned) notes.push(`Pruned ${opportunitiesPruned} low-value opportunity signal(s).`);

      draft.executive.lastDailyMaintenanceAt = now;
      this.activity(draft, "agent", "maintenance.daily", `Daily maintenance: stale=${staleFacts} conflicts=${conflictsResolved}`, null);
      return {
        staleFacts,
        conflictsResolved,
        conflictsReview,
        commitmentsRefreshed,
        opportunitiesPruned,
        notes,
      };
    });
  }

  async explainBelief(statement: string, sourceRef: string, sourceType?: string) {
    return {
      explanation: explainBelief({
        statement,
        sourceRef,
        ...(sourceType !== undefined ? { sourceType } : {}),
      }),
    };
  }

  /**
   * One bounded executive work cycle: observe → prioritize → act (safe only) → verify → measure.
   * Never SEND/POST/APPLY/SPEND. Never infinite loop.
   */
  async runExecutiveCycle(opts: { dryRun?: boolean } = {}): Promise<ExecutiveCycleResultV1> {
    const now = this.ports.clock.now();
    const state = await this.snapshot();
    if (!state.executive) {
      await this.mutate((d) => {
        d.executive = emptyExecutiveState(now);
        return null;
      });
    }
    const exec = (await this.snapshot()).executive!;
    const budget = exec.resourceBudget ?? { ...DEFAULT_RESOURCE_BUDGET };
    const result = emptyCycleResult(now, budget);
    result.cycleId = this.ports.ids.next("cycle");
    result.audit.push(`Cycle ${result.cycleId} started (dryRun=${opts.dryRun === true}).`);

    const inv = this.vehicleInv(state);
    const sig = buildSnapshotSig({
      now,
      vehicles: inv.vehicles.map((v) => ({
        vin: v.vin,
        presenceStatus: v.presenceStatus,
        price: v.priceHistory[0]?.advertisedPrice ?? null,
      })),
      commitments: exec.commitments ?? [],
      opportunities: exec.opportunities ?? [],
      importReviewOpen: (state.importReviewQueue ?? []).filter((r) => r.status === "needs-review").length,
      jobAppCount: (state.jobApplications ?? []).length,
      brandCount: state.workspaces.filter(
        (w) => w.kind === "business" && !w.archived && !isTestOrE2eWorkspace(w),
      ).length,
      captureCount: (exec.captures ?? []).length,
      relationshipWorkCount: state.relationships.filter(
        (r) => r.workspace === "work" && !r.archived && !isSyntheticRelationship(r),
      ).length,
    });
    const changes = detectChanges(exec.lastSnapshotSig, sig);
    result.changesDetected = changes.length;
    result.audit.push(`Detected ${changes.length} change event(s).`);

    let jobs = proposeJobsFromChanges(changes, (k) => this.ports.ids.next(k), now, budget.maxJobsPerCycle);
    // Retry FAILED transient jobs from queue
    const retries = (exec.autonomyJobs ?? [])
      .filter((j) => j.state === "FAILED" && j.failureClass === "TRANSIENT" && canRetry(j, "TRANSIENT"))
      .slice(0, 2)
      .map((j) => ({
        ...j,
        state: "READY" as const,
        retries: j.retries + 1,
        failure: null,
        failureClass: null,
      }));
    jobs = [...retries, ...jobs].slice(0, budget.maxJobsPerCycle);
    result.jobsProposed = jobs.length;

    const completedNotes: string[] = [];
    const handling: string[] = [];
    let researchUsed = 0;
    // Collect interruption proposals from all emitters; apply ONE global budget at end.
    const interruptionProposals: Array<{
      level: "IMMEDIATE" | "NEXT_BRIEFING" | "TODAY" | "WEEKLY" | "SILENT_LOG";
      message: string;
      source: string;
      workspace: string;
    }> = [];

    for (const job of jobs) {
      // Progress around WAITING / OWNER_REQUIRED — never freeze the cycle on one blocked job.
      if (job.state === "WAITING") {
        result.audit.push(`Skip WAITING job ${job.capability}: ${job.reason.slice(0, 80)}`);
        continue;
      }
      if (isExternalGatedCapability(job.capability)) {
        result.unauthorizedExternalAttempts += 1;
        result.audit.push(`Blocked gated capability: ${job.capability}`);
        continue;
      }
      if (job.state === "OWNER_REQUIRED") {
        result.jobsOwnerRequired += 1;
        result.ownerMustDo.push(`[${job.workspace}] ${job.reason}`);
        interruptionProposals.push({
          level: job.interruption,
          message: job.reason,
          source: `job.${job.capability}`,
          workspace: job.workspace,
        });
        continue;
      }
      if (opts.dryRun) {
        handling.push(`${job.capability}: ${job.reason}`);
        continue;
      }

      result.jobsExecuted += 1;
      let running: AutonomyJobV1 = { ...job, state: "RUNNING", startedAt: now };
      try {
        const outcome = await this.executeAutonomyCapability(running);
        const verified = verifyJobResult(running, outcome);
        running = {
          ...running,
          state: verified.state,
          completedAt: this.ports.clock.now(),
          result: outcome.detail,
          failure: verified.failure,
          failureClass: verified.failureClass,
          verified: verified.verified,
        };
        if (verified.state === "COMPLETED") {
          result.jobsCompleted += 1;
          completedNotes.push(`${running.capability}: ${outcome.detail.slice(0, 120)}`);
          if (running.interruption === "SILENT_LOG") result.silentLogs.push(running.reason);
          else {
            interruptionProposals.push({
              level: running.interruption,
              message: running.reason,
              source: `job.${running.capability}`,
              workspace: running.workspace,
            });
          }
        } else if (verified.state === "OWNER_REQUIRED") {
          result.jobsOwnerRequired += 1;
          result.ownerMustDo.push(running.reason);
          interruptionProposals.push({
            level: running.interruption,
            message: running.reason,
            source: `job.${running.capability}`,
            workspace: running.workspace,
          });
        } else {
          result.jobsFailed += 1;
          if (canRetry(running, verified.failureClass || "UNSUPPORTED")) {
            running = { ...running, state: "FAILED", retries: running.retries };
            result.audit.push(`Will retry ${running.capability}: ${verified.failure}`);
          }
        }
        if (running.capability === "research.local") researchUsed += 1;
        if (researchUsed > budget.maxResearchPerCycle) {
          result.audit.push("Research budget exhausted for cycle.");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const fc = classifyFailure(msg);
        running = {
          ...running,
          state: fc === "OWNER_REQUIRED" ? "OWNER_REQUIRED" : "FAILED",
          completedAt: this.ports.clock.now(),
          failure: msg,
          failureClass: fc,
          verified: false,
        };
        result.jobsFailed += 1;
        result.audit.push(`Job ${running.capability} threw: ${msg.slice(0, 200)}`);
      }
      // Persist job
      await this.mutate((draft) => {
        if (!draft.executive) draft.executive = emptyExecutiveState(now);
        draft.executive.autonomyJobs = [running, ...draft.executive.autonomyJobs.filter((j) => j.id !== running.id)].slice(0, 300);
        return null;
      });
    }

    // Refresh attention for owner board — also budgeted through global delivery
    const board = await this.attentionBoard();
    for (const item of board.ownerMustDo.slice(0, 8)) {
      const level =
        item.horizon === "NOW" ? "IMMEDIATE" : item.horizon === "TODAY" ? "TODAY" : "NEXT_BRIEFING";
      interruptionProposals.push({
        level,
        message: `[${item.contextLabel}] ${item.title}`,
        source: "attention.engine",
        workspace: item.workspace,
      });
    }
    for (const opp of (exec.opportunities ?? []).slice(0, 5)) {
      interruptionProposals.push({
        level: opp.urgency >= 80 ? "TODAY" : "NEXT_BRIEFING",
        message: `Opportunity: ${opp.title}`,
        source: "opportunity.radar",
        workspace: opp.workspace || "work",
      });
    }

    const attnCfg = exec.attentionBudgetConfig ?? { ...DEFAULT_ATTENTION_BUDGET };
    // Align cycle cap with resource budget
    attnCfg.maxPerCycle = Math.min(attnCfg.maxPerCycle, budget.maxOwnerInterruptionsPerCycle);
    const budgeted = budgetInterruptions(
      interruptionProposals,
      attnCfg,
      now,
      exec.attentionBudgetState ?? null,
    );
    result.interruptions = budgeted.interruptions;
    result.silentLogs = [...result.silentLogs, ...budgeted.silentLogs].slice(0, 50);
    if (budgeted.suppressed > 0) {
      result.audit.push(`Attention budget suppressed/downgraded ${budgeted.suppressed} delivery(ies).`);
    }
    await this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(now);
      draft.executive.attentionBudgetState = budgeted.state;
      draft.executive.attentionBudgetConfig = attnCfg;
      return null;
    });

    result.ownerMustDo = [
      ...new Set([
        ...result.ownerMustDo,
        ...budgeted.interruptions
          .filter((i) => i.level === "IMMEDIATE" || i.level === "TODAY")
          .map((i) => i.message),
      ]),
    ].slice(0, 12);
    result.aionCompleted = completedNotes;
    result.aionHandling = handling.length
      ? handling
      : board.aionCanDo.slice(0, 5).map((i) => i.title);

    result.completedAt = this.ports.clock.now();
    result.audit.push(
      `Done: proposed=${result.jobsProposed} executed=${result.jobsExecuted} completed=${result.jobsCompleted} failed=${result.jobsFailed} ownerReq=${result.jobsOwnerRequired} unauthExt=${result.unauthorizedExternalAttempts}`,
    );

    // Value ledger estimate for cycle housekeeping
    if (!opts.dryRun && result.jobsCompleted > 0) {
      await this.mutate((draft) => {
        if (!draft.executive) draft.executive = emptyExecutiveState(now);
        const entry = buildValueLedgerEntry(
          {
            action: `Executive cycle ${result.cycleId}`,
            capability: "executive.cycle",
            timeSavedMinutes: Math.min(30, result.jobsCompleted * 2),
            estimateKind: "estimated",
            notes: `Completed ${result.jobsCompleted} safe jobs; no external send/spend.`,
            ownerInterventionRequired: result.jobsOwnerRequired > 0,
          },
          { id: this.ports.ids.next("value"), now: result.completedAt, workspace: "personal" },
        );
        draft.executive.valueLedger.unshift(entry);
        draft.executive.lastSnapshotSig = sig;
        draft.executive.lastCycleResult = result;
        draft.executive.cycleHistory = [result, ...draft.executive.cycleHistory].slice(0, 50);
        this.activity(draft, "agent", "executive.cycle", result.audit[result.audit.length - 1] || "cycle", result.cycleId);
        return null;
      });
    } else {
      await this.mutate((draft) => {
        if (!draft.executive) draft.executive = emptyExecutiveState(now);
        draft.executive.lastSnapshotSig = sig;
        draft.executive.lastCycleResult = result;
        draft.executive.cycleHistory = [result, ...draft.executive.cycleHistory].slice(0, 50);
        return null;
      });
    }

    return result;
  }

  /** Execute one safe autonomy capability; returns measurable outcome. */
  private async executeAutonomyCapability(
    job: AutonomyJobV1,
  ): Promise<{ ok: boolean; detail: string; artifacts?: string[] }> {
    if (isExternalGatedCapability(job.capability)) {
      return { ok: false, detail: "Capability is externally gated (send/post/apply/spend)." };
    }
    switch (job.capability) {
      case "maintenance.daily": {
        const m = await this.runDailyMaintenance();
        return {
          ok: true,
          detail: `Maintenance: stale=${m.staleFacts} conflicts=${m.conflictsResolved} pruned=${m.opportunitiesPruned}`,
          artifacts: m.notes,
        };
      }
      case "opportunity.radar": {
        const opps = await this.refreshOpportunityRadar();
        return { ok: true, detail: `Radar: ${opps.length} signal(s)`, artifacts: opps.slice(0, 3).map((o) => o.title) };
      }
      case "attention.board": {
        const b = await this.attentionBoard();
        return {
          ok: true,
          detail: `Board: owner=${b.ownerMustDo.length} aion=${b.aionCanDo.length}`,
          artifacts: b.briefingLines.slice(0, 4),
        };
      }
      case "commitment.refresh": {
        await this.mutate((draft) => {
          if (!draft.executive) return null;
          const now = this.ports.clock.now();
          draft.executive.commitments = draft.executive.commitments.map((c) => refreshCommitmentStatus(c, now));
          return null;
        });
        const n = (await this.snapshot()).executive?.commitments?.filter((c) => c.status === "overdue" || c.status === "due_soon").length ?? 0;
        return { ok: true, detail: `Commitments due/overdue: ${n}`, artifacts: [`count=${n}`] };
      }
      case "draft.followup_notes": {
        const state = await this.snapshot();
        const due = state.relationships
          .filter((r) => r.workspace === "work" && !r.archived)
          .flatMap((r) => r.followUps.filter((f) => f.status === "open").map((f) => `${r.displayName}: ${f.reason}`))
          .slice(0, 5);
        if (!due.length) return { ok: true, detail: "No open follow-ups to draft against.", artifacts: ["none"] };
        await this.mutate((draft) => {
          if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
          const fact = buildTemporalFact(
            {
              title: "AION follow-up prep (draft)",
              content: due.join("\n"),
              category: "draft",
              visibility: "WORKSPACE_ONLY",
              sourceRef: "autonomy.draft.followup_notes",
              confidence: 70,
            },
            { id: this.ports.ids.next("tfact"), now: this.ports.clock.now(), workspace: "work" },
          );
          draft.executive.temporalFacts.unshift(fact);
          return null;
        });
        return { ok: true, detail: `Stored prep notes for ${due.length} follow-up(s) (not sent).`, artifacts: due };
      }
      case "research.local": {
        // Local-only: reuse stored research jobs / vehicle facts — no paid network
        const state = await this.snapshot();
        const jobs = state.researchJobs ?? [];
        return {
          ok: true,
          detail: `Local research inventory: ${jobs.length} job(s) on file (no new paid fetch).`,
          artifacts: jobs.slice(0, 3).map((j) => j.question),
        };
      }
      case "vehicle.recall_check": {
        const inv = this.vehicleInv(await this.snapshot());
        const sample = inv.vehicles.find((v) => v.vin && v.make && v.model && v.year);
        if (!sample) return { ok: true, detail: "No vehicle with YMM for recall check.", artifacts: ["none"] };
        try {
          const recallArgs: { vin?: string; make?: string; model?: string; year?: number } = {};
          if (sample.vin) recallArgs.vin = sample.vin;
          if (sample.make) recallArgs.make = sample.make;
          if (sample.model) recallArgs.model = sample.model;
          if (sample.year != null) recallArgs.year = sample.year;
          const recalls = await this.vehicleRecallLookup(recallArgs);
          return {
            ok: true,
            detail: recalls.message.slice(0, 300),
            artifacts: recalls.recalls.slice(0, 2).map((r) => r.campaignNumber),
          };
        } catch (e) {
          return { ok: false, detail: e instanceof Error ? e.message : String(e) };
        }
      }
      case "job.scan_fit": {
        const apps = (await this.snapshot()).jobApplications ?? [];
        return {
          ok: true,
          detail: `Job tracker: ${apps.length} application(s). Fit scoring available; submission gated.`,
          artifacts: apps.slice(0, 3).map((a) => `${a.title}@${a.employer}`),
        };
      }
      case "product.scan_ideas": {
        const state = await this.snapshot();
        const opps = state.opportunities ?? [];
        return {
          ok: true,
          detail: `Product studio opportunities: ${opps.length} (no external listing).`,
          artifacts: opps.slice(0, 3).map((o) => ("title" in o ? String((o as { title?: string }).title || "") : String((o as { id: string }).id))),
        };
      }
      case "brand.gap_scan": {
        const state = await this.snapshot();
        const brands = state.workspaces.filter(
          (w) => w.kind === "business" && !w.archived && !isTestOrE2eWorkspace(w),
        );
        const dna = state.executive?.brandDna ?? [];
        const gaps = brands.filter((b) => !dna.some((d) => d.workspaceId === b.id && d.purpose));
        if (gaps.length) {
          await this.mutate((draft) => {
            if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
            const fact = buildTemporalFact(
              {
                title: "Brand DNA gaps",
                content: gaps.map((g) => g.label).join(", "),
                category: "brand",
                sourceRef: "autonomy.brand.gap_scan",
              },
              { id: this.ports.ids.next("tfact"), now: this.ports.clock.now(), workspace: "personal" },
            );
            draft.executive.temporalFacts.unshift(fact);
            return null;
          });
        }
        return {
          ok: true,
          detail: gaps.length ? `Brand DNA missing purpose for: ${gaps.map((g) => g.label).join(", ")}` : "No brand DNA gaps detected.",
          artifacts: gaps.map((g) => g.id),
        };
      }
      case "plan.decompose": {
        const steps = decomposeInternalGoal(job.reason, DEFAULT_RESOURCE_BUDGET.maxDecompositionItems);
        return { ok: true, detail: `Decomposed into ${steps.length} step(s)`, artifacts: steps };
      }
      case "briefing.prepare": {
        const b = await this.attentionBoard();
        await this.mutate((d) => {
          if (!d.executive) d.executive = emptyExecutiveState(this.ports.clock.now());
          d.executive.lastBriefingAt = this.ports.clock.now();
          return null;
        });
        return { ok: true, detail: b.briefingLines.slice(0, 6).join(" | "), artifacts: b.briefingLines };
      }
      case "inventory.refresh":
        return {
          ok: false,
          detail: "Public inventory refresh is level-3 (network); not auto-run without Owner/path approval in this cycle.",
        };
      default:
        return { ok: false, detail: `Unsupported capability: ${job.capability}` };
    }
  }

  async autonomyDayAudit(): Promise<{ reply: string; cycle: ExecutiveCycleResultV1 | null; jobs: AutonomyJobV1[] }> {
    const state = await this.snapshot();
    const cycle = state.executive?.lastCycleResult ?? null;
    const jobs = state.executive?.autonomyJobs ?? [];
    const day = this.ports.clock.now().slice(0, 10);
    const todayJobs = jobs.filter((j) => (j.createdAt || "").startsWith(day));
    const reply = [
      "WHAT AION DID (audit)",
      cycle ? `Last cycle ${cycle.cycleId}: completed ${cycle.jobsCompleted}, failed ${cycle.jobsFailed}, owner-req ${cycle.jobsOwnerRequired}` : "No cycle yet.",
      "",
      "Completed today:",
      ...todayJobs.filter((j) => j.state === "COMPLETED").slice(0, 10).map((j) => `  • ${j.capability}: ${j.result?.slice(0, 100)}`),
      "",
      "Why:",
      ...todayJobs.slice(0, 5).map((j) => `  • ${j.reason}`),
      "",
      "Failed:",
      ...todayJobs.filter((j) => j.state === "FAILED").slice(0, 5).map((j) => `  • ${j.capability}: ${j.failure}`),
      "",
      "Did not interrupt Owner (silent):",
      ...(cycle?.silentLogs ?? []).slice(0, 5).map((s) => `  • ${s}`),
      "",
      "Needs approval / Owner:",
      ...todayJobs.filter((j) => j.state === "OWNER_REQUIRED").slice(0, 5).map((j) => `  • ${j.reason}`),
      "",
      `Unauthorized external attempts in last cycle: ${cycle?.unauthorizedExternalAttempts ?? 0}`,
      `Cross-workspace leaks recorded: ${cycle?.crossWorkspaceLeaks ?? 0}`,
    ].join("\n");
    return { reply, cycle, jobs: todayJobs };
  }

  async decomposeGoal(goal: string) {
    const steps = decomposeInternalGoal(goal, DEFAULT_RESOURCE_BUDGET.maxDecompositionItems);
    return { goal, steps, depthLimit: DEFAULT_RESOURCE_BUDGET.maxDecompositionDepth };
  }

  async inferImportWorkspaceForPath(path: string, extra: {
    filename?: string;
    extractedText?: string;
    associateWith?: string;
  } = {}): Promise<ImportWorkspaceInferenceV1> {
    const state = await this.snapshot();
    const brands = state.workspaces
      .filter((w) => w.kind === "business" && !w.archived)
      .map((w) => ({ id: w.id, label: w.brand?.name || w.label }));
    return inferImportWorkspace({
      path,
      ...(extra.filename !== undefined ? { filename: extra.filename } : {}),
      ...(extra.extractedText !== undefined ? { extractedText: extra.extractedText } : {}),
      ...(extra.associateWith !== undefined ? { associateWith: extra.associateWith } : {}),
      corrections: state.executive?.importWorkspaceCorrections ?? [],
      brandWorkspaceIds: brands,
    });
  }

  async rememberImportWorkspaceCorrection(input: {
    pattern: string;
    workspaceId: string;
    role?: string;
  }): Promise<WorkspaceCorrectionV1> {
    return this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      const now = this.ports.clock.now();
      const corr: WorkspaceCorrectionV1 = {
        pattern: String(input.pattern).trim().toLowerCase().slice(0, 200),
        workspaceId: String(input.workspaceId).trim(),
        role: (input.role as WorkspaceCorrectionV1["role"]) || "AMBIGUOUS",
        at: now,
      };
      if (!corr.pattern || !corr.workspaceId) throw new Error("pattern and workspaceId required.");
      draft.executive.importWorkspaceCorrections = [
        corr,
        ...draft.executive.importWorkspaceCorrections.filter((c) => c.pattern !== corr.pattern),
      ].slice(0, 200);
      this.activity(draft, "settings", "import.workspace.correction", `Import paths ~${corr.pattern} → ${corr.workspaceId}`, null);
      return corr;
    });
  }

  async connectorContextCompatibility() {
    return {
      gmail: gmailContextPolicy(),
      metricool: metricoolContextPolicy(),
      message:
        "Both connectors require explicit workspace/brand classification before durable association. No global shared pool.",
    };
  }

  async universalCapture(text: string, opts: { apply?: boolean; latencyMs?: number } = {}): Promise<CaptureResultV1> {
    const started = Date.now();
    const now = this.ports.clock.now();
    const snap = await this.snapshot();
    // Apply identity resolutions + multi-hit correction patterns within workspace
    const people = snap.relationships.filter((r) => !r.archived);
    const classification = classifyCaptureText(text, now, {
      existingPeople: people.map((r) => ({ id: r.id, displayName: r.displayName, workspace: r.workspace })),
    });
    if (classification.personName && classification.ambiguousPersonIds.length > 1) {
      const key = classification.personName.split(/\s+/)[0]!.toLowerCase();
      const ws = classification.workspaceHint === "work" ? "work" : snap.settings.activeWorkspace;
      const resolved = (snap.executive?.identityResolutions ?? []).find((r) => r.key === key && r.workspace === ws);
      if (resolved) {
        classification.ambiguousPersonIds = [];
        classification.needsConfirm = false;
        classification.personName = resolved.displayName;
        classification.why = `Used remembered identity resolution: ${resolved.displayName}`;
        classification.confidence = "high";
      } else {
        const taught = applyCorrectionPattern(
          snap.executive?.correctionPatterns ?? [],
          "person",
          key,
          ws,
        );
        if (taught) {
          classification.ambiguousPersonIds = [];
          classification.needsConfirm = false;
          classification.personName = taught;
          classification.why = `Used learned person correction (multi-hit): ${taught}`;
          classification.confidence = "high";
        }
      }
    }
    const applied: string[] = [];
    const skipped: string[] = [];
    const captureId = this.ports.ids.next("capture");

    if (opts.apply === false || classification.needsConfirm) {
      const result: CaptureResultV1 = {
        classification,
        applied: classification.needsConfirm ? [] : applied,
        skipped: classification.needsConfirm
          ? ["Awaiting Owner confirm — ambiguity material"]
          : skipped,
        captureId,
        at: now,
      };
      await this.mutate((draft) => {
        if (!draft.executive) draft.executive = emptyExecutiveState(now);
        draft.executive.captures.unshift(result);
        if (draft.executive.captures.length > 200) draft.executive.captures.length = 200;
        const fr = draft.executive.captureFriction;
        fr.total += 1;
        fr.withConfirm += classification.needsConfirm ? 1 : 0;
        fr.lastLatencyMs = opts.latencyMs ?? Date.now() - started;
        return result;
      });
      if (classification.needsConfirm) return result;
    }

    return this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(now);
      const ws =
        classification.workspaceHint === "work"
          ? "work"
          : classification.workspaceHint === "personal"
            ? "personal"
            : draft.settings.activeWorkspace;

      if (classification.kind === "preference" || classification.kind === "memory" || classification.kind === "idea") {
        const fact = buildTemporalFact(
          {
            title: classification.kind === "idea" ? "Idea" : "Preference",
            content: classification.summary,
            category: classification.kind,
            visibility: ws === "personal" ? "PRIVATE" : "WORKSPACE_ONLY",
            confidence: 85,
            sourceRef: "capture.universal",
          },
          { id: this.ports.ids.next("tfact"), now, workspace: ws },
        );
        draft.executive.temporalFacts.unshift(fact);
        applied.push(`Temporal fact ${fact.id}`);
      }

      if (classification.personName && (classification.kind === "customer_update" || classification.kind === "vehicle_interest" || classification.kind === "follow_up" || classification.kind === "note")) {
        const people = draft.relationships.filter(
          (r) => r.workspace === (classification.workspaceHint === "work" ? "work" : r.workspace) && !r.archived,
        );
        let person = findRelationshipsByName(people, classification.personName)[0] ?? null;
        if (!person && classification.workspaceHint === "work" && !classification.needsConfirm) {
          const rid = this.ports.ids.next("relationship");
          person = buildCustomer(
            {
              displayName: classification.personName,
              source: "universal-capture",
              notes: classification.summary,
              relationshipType: "customer",
            },
            {
              id: rid,
              reference: `capture:${rid}`,
              workspace: "work",
              now,
              relationshipType: "customer",
              defaultOrigin: "owner-created",
            },
          );
          draft.relationships.unshift(person);
          applied.push(`Created prospect ${person.displayName}`);
        }
        if (person) {
          const personId = person.id;
          const interaction = buildInteraction(
            { kind: "note", summary: classification.summary },
            { id: this.ports.ids.next("interaction"), now },
          );
          let nextPerson = {
            ...person,
            interactions: [interaction, ...person.interactions].slice(0, 200),
            lastContactAt: now,
            updatedAt: now,
            notes: person.notes
              ? `${person.notes}\n${classification.summary}`.slice(0, 20_000)
              : classification.summary,
          };
          if (classification.vehicleHint) {
            nextPerson = {
              ...nextPerson,
              interests: [
                { kind: "vehicle" as const, description: classification.vehicleHint.slice(0, 500), notedAt: now },
                ...nextPerson.interests,
              ].slice(0, 40),
            };
            applied.push(`Vehicle interest: ${classification.vehicleHint}`);
          }
          if (classification.budgetHint) {
            nextPerson = {
              ...nextPerson,
              interests: [
                { kind: "other" as const, description: `Budget: ${classification.budgetHint}`.slice(0, 500), notedAt: now },
                ...nextPerson.interests,
              ].slice(0, 40),
            };
          }
          if (classification.followUpWhen) {
            const due =
              classification.followUpWhen === "tomorrow"
                ? new Date(Date.parse(now) + 86400000).toISOString()
                : classification.followUpWhen === "today"
                  ? now
                  : new Date(Date.parse(now) + 86400000).toISOString();
            const fu = buildFollowUp(
              { dueAt: due, channel: "phone", reason: classification.summary.slice(0, 500) },
              { id: this.ports.ids.next("followup"), now },
            );
            nextPerson = { ...nextPerson, followUps: [fu, ...nextPerson.followUps] };
            applied.push(`Follow-up scheduled (${classification.followUpWhen})`);
          }
          draft.relationships = draft.relationships.map((r) => (r.id === personId ? nextPerson : r));
          applied.push(`Note on ${nextPerson.displayName}`);

          if (classification.vehicleHint) {
            try {
              const edge = buildGraphEdge(
                {
                  type: "interested_in",
                  fromKind: "customer",
                  fromId: nextPerson.id,
                  fromLabel: nextPerson.displayName,
                  toKind: "vehicle_interest",
                  toId: classification.vehicleHint.slice(0, 80),
                  toLabel: classification.vehicleHint,
                  note: classification.summary,
                  visibility: "WORKSPACE_ONLY",
                  sourceRef: "capture.universal",
                },
                { id: this.ports.ids.next("edge"), now, workspace: nextPerson.workspace },
              );
              draft.executive.graphEdges.unshift(edge);
              applied.push("Graph: interested_in");
            } catch {
              skipped.push("graph edge skipped");
            }
          }
        } else {
          skipped.push("No matching customer — confirm name");
        }
      }

      if (classification.kind === "task" || (classification.kind === "follow_up" && !classification.personName)) {
        const task: TaskV1 = {
          id: this.ports.ids.next("task"),
          workspace: ws,
          title: classification.summary.slice(0, 200),
          description: classification.summary,
          state: "ready",
          priority: "normal",
          tags: ["capture"],
          dueAt: null,
          planId: null,
          routineId: null,
          createdAt: now,
          completedAt: null,
          provenance: { sourceType: "owner", sourceRef: "capture.universal", recordedAt: now },
          history: [],
        };
        draft.tasks.unshift(task);
        applied.push(`Task created in ${ws}`);
      }

      if (classification.kind === "brand_note") {
        const fact = buildTemporalFact(
          {
            title: "Brand capture",
            content: classification.summary,
            category: "brand",
            visibility: "WORKSPACE_ONLY",
            sourceRef: "capture.brand",
          },
          { id: this.ports.ids.next("tfact"), now, workspace: draft.settings.activeWorkspace },
        );
        draft.executive.temporalFacts.unshift(fact);
        applied.push("Brand note stored (confirm brand workspace if needed)");
      }

      // Commitments from language
      for (const cand of extractCommitmentCandidates(text, now)) {
        try {
          const c = buildCommitment(
            {
              committedBy: cand.committedBy,
              committedTo: cand.committedTo,
              statement: cand.statement,
              dueAt: cand.dueAt,
              confidence: cand.confidence,
              sourceRef: "capture.commitment",
            },
            { id: this.ports.ids.next("commit"), now, workspace: ws },
          );
          draft.executive.commitments.unshift(c);
          applied.push(`Commitment: ${c.committedBy} → ${c.committedTo}`);
        } catch {
          skipped.push("commitment parse skipped");
        }
      }

      // Value ledger: capture saves Owner form-filling time (estimated)
      const ledger = buildValueLedgerEntry(
        {
          action: `Universal capture (${classification.kind})`,
          capability: "capture",
          timeSavedMinutes: 3,
          estimateKind: "estimated",
          ownerInterventionRequired: classification.needsConfirm,
          notes: "Estimated form-fill avoidance; not measured revenue.",
        },
        { id: this.ports.ids.next("value"), now, workspace: ws },
      );
      draft.executive.valueLedger.unshift(ledger);
      if (draft.executive.valueLedger.length > 500) draft.executive.valueLedger.length = 500;
      if (draft.executive.temporalFacts.length > 2000) draft.executive.temporalFacts.length = 2000;
      if (draft.executive.graphEdges.length > 5000) draft.executive.graphEdges.length = 5000;
      if (draft.executive.commitments.length > 500) draft.executive.commitments.length = 500;

      const result: CaptureResultV1 = { classification, applied, skipped, captureId, at: now };
      draft.executive.captures.unshift(result);
      if (draft.executive.captures.length > 200) draft.executive.captures.length = 200;
      const fr = draft.executive.captureFriction;
      fr.total += 1;
      fr.autoApplied += 1;
      fr.lastLatencyMs = opts.latencyMs ?? Date.now() - started;
      this.activity(draft, "agent", "capture.universal", `Capture ${classification.kind}: ${applied.length} applied`, captureId);
      return result;
    });
  }

  async refreshOpportunityRadar(): Promise<OpportunitySignalV1[]> {
    return this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      const now = this.ports.clock.now();
      const inv = this.vehicleInv(draft);
      const signals = detectInventoryMatches({
        relationships: draft.relationships,
        vehicles: inv.vehicles,
        nowIso: now,
        nextId: (k) => this.ports.ids.next(k),
      });
      draft.executive.opportunities = signals;
      this.activity(draft, "agent", "opportunity.radar", `Opportunity radar: ${signals.length} signal(s)`, null);
      return signals;
    });
  }

  async salesCopilotForCustomer(relationshipId: string): Promise<{
    reply: string;
    matches: OpportunitySignalV1[];
    customer: string;
  }> {
    const state = await this.snapshot();
    const customer = state.relationships.find((r) => r.id === relationshipId);
    if (!customer) throw new Error("Customer not found.");
    const signals = await this.refreshOpportunityRadar();
    const matches = signals.filter(
      (s) => s.kind === "inventory_match" && s.entityIds.includes(relationshipId),
    );
    const inv = this.vehicleInv(state);
    const linked = inv.vehicles.filter((v) => v.relationshipIds.includes(relationshipId));
    const lines = [
      `Sales copilot for ${customer.displayName} (stored facts only):`,
      `Stage: ${customer.lifecycle} · Next: ${customer.nextAction || "none"}`,
      `Interests: ${(customer.interests ?? []).map((i) => i.description).join("; ") || "none recorded"}`,
      `Linked vehicles: ${linked.map((v) => [v.year, v.make, v.model].filter(Boolean).join(" ") || v.vin).join("; ") || "none"}`,
      "",
      matches.length
        ? `Best inventory matches (${matches.length}):\n${matches.slice(0, 3).map((m, i) => `  ${i + 1}. ${m.title} — ${m.detail}`).join("\n")}`
        : "No strong inventory matches yet — refresh inventory or capture requirements.",
      "",
      "AION does not invent customer requirements or vehicle features.",
    ];
    return { reply: lines.join("\n"), matches, customer: customer.displayName };
  }

  async endOfDayWrap(): Promise<{ reply: string; questions: string[] }> {
    // One quiet cycle first so wrap reflects latest autonomous work
    await this.runExecutiveCycle({}).catch(() => null);
    const board = await this.attentionBoard();
    const state = await this.snapshot();
    const day = this.ports.clock.now().slice(0, 10);
    const cycle = state.executive?.lastCycleResult ?? null;
    const jobs = state.executive?.autonomyJobs ?? [];
    const commits = state.executive?.commitments ?? [];
    const capturesToday = (state.executive?.captures ?? [])
      .filter((c) => (c.at || "").startsWith(day))
      .map((c) => ({
        summary: c.classification.summary,
        kind: c.classification.kind,
      }));
    const closure = buildEndOfDayClosure({
      nowIso: this.ports.clock.now(),
      commitments: commits,
      board,
      capturesToday,
      jobs,
      opportunities: state.executive?.opportunities ?? [],
      cycle,
    });
    const metrics = aggregateUsageMetrics({
      captureFriction: state.executive?.captureFriction,
      correctionCount: state.executive?.captureFriction?.corrections ?? 0,
      falseMatchCount: state.executive?.captureFriction?.falseMatches ?? 0,
      briefingDismissed: state.executive?.captureFriction?.briefingDismissed ?? 0,
      opportunitiesActed: state.executive?.captureFriction?.opportunitiesActed ?? 0,
      jobs,
      ledger: state.executive?.valueLedger ?? [],
      cycle,
    });
    await this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      draft.executive.lastEndOfDayAt = this.ports.clock.now();
      return null;
    });
    const reply = [closure.reply, "", formatUsageMetrics(metrics)].join("\n");
    return { reply, questions: closure.questions };
  }

  async weeklyCeoReview(): Promise<{ reply: string }> {
    const state = await this.snapshot();
    const inv = this.vehicleInv(state);
    const brands = state.workspaces.filter(
      (w) => w.kind === "business" && !w.archived && !isTestOrE2eWorkspace(w),
    );
    const board = await this.attentionBoard();
    const radar = state.executive?.opportunities ?? [];
    const commits = state.executive?.commitments ?? [];
    const overdueC = commits.filter((c) => c.status === "overdue" || c.status === "due_soon");
    const ledger = state.executive?.valueLedger ?? [];
    const estMinutes = ledger
      .filter((v) => v.estimateKind === "estimated" && v.timeSavedMinutes != null)
      .reduce((s, v) => s + (v.timeSavedMinutes || 0), 0);
    const measuredMinutes = ledger
      .filter(
        (v) =>
          v.estimateKind === "measured" &&
          v.timeSavedMinutes != null &&
          Array.isArray(v.evidenceIds) &&
          v.evidenceIds.length > 0,
      )
      .reduce((s, v) => s + (v.timeSavedMinutes || 0), 0);
    const fr = state.executive?.captureFriction;
    await this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      draft.executive.lastWeeklyReviewAt = this.ports.clock.now();
      return null;
    });
    const workRels = state.relationships.filter(
      (r) => r.workspace === "work" && !r.archived && !isSyntheticRelationship(r),
    );
    const stalled = findStalledDeals(workRels, this.ports.clock.now(), 14);
    const reply = [
      "WEEKLY CEO REVIEW (stored evidence only — no invented revenue)",
      "",
      "WHERE DID ATTENTION GO?",
      `  Open Owner-must-do: ${board.ownerMustDo.length} · AION-can-do: ${board.aionCanDo.length}`,
      `  Captures: ${fr?.total ?? 0} (confirm ${fr?.withConfirm ?? 0}, auto ${fr?.autoApplied ?? 0})`,
      "",
      "VALUE (MEASURED / ESTIMATED kept separate — never summed as one fact)",
      `  MEASURED minutes saved: ${measuredMinutes > 0 ? measuredMinutes : "UNKNOWN"}`,
      `  ESTIMATED minutes saved: ${estMinutes > 0 ? estMinutes : "UNKNOWN"} · ledger entries: ${ledger.length}`,
      "  Dollar revenue is UNKNOWN unless separately measured with evidence.",
      "",
      "COMMITMENTS",
      overdueC.length
        ? overdueC.slice(0, 8).map((c) => `  • [${c.status}] ${c.committedBy}→${c.committedTo}: ${c.statement}`).join("\n")
        : "  (none overdue/due soon)",
      "",
      "DEALERSHIP",
      `  Vehicles: ${inv.vehicles.length} · Walks: ${inv.walks.length} · Obs: ${inv.observations.length}`,
      `  Open follow-ups: ${workRels.flatMap((r) => r.followUps.filter((f) => f.status === "open")).length}`,
      `  Stalled signals: ${stalled.length} · Opportunities: ${radar.length}`,
      "",
      "BRANDS / BUSINESS",
      brands.length ? brands.map((b) => `  • ${b.brand?.name || b.label}`).join("\n") : "  (none)",
      brands.length === 0 ? "  Neglected: no brand workspaces active." : "",
      "",
      "RECOMMENDATIONS (evidence-grounded)",
      "  1. Clear overdue commitments first (highest human interruption ROI).",
      "  2. Let AION keep drafting follow-ups / radar scoring (no send).",
      "  3. Import one approved Owner folder if knowledge still thin.",
      "  4. Do not invent metrics or cross-context customer data into brands.",
      stalled.length ? `  5. ${stalled.length} quiet dealership account(s) — Owner decides outreach.` : "",
    ].filter(Boolean).join("\n");
    return { reply };
  }

  async upsertBrandDna(workspaceId: string, patch: Record<string, unknown>) {
    return this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(this.ports.clock.now());
      const ws = draft.workspaces.find((w) => w.id === workspaceId);
      if (!ws || ws.kind !== "business") throw new Error("Brand DNA applies to business/brand workspaces.");
      const now = this.ports.clock.now();
      let dna = draft.executive.brandDna.find((b) => b.workspaceId === workspaceId) || emptyBrandDna(workspaceId, now);
      dna = {
        ...dna,
        purpose: patch.purpose !== undefined ? String(patch.purpose).slice(0, 2000) : dna.purpose,
        audience: patch.audience !== undefined ? String(patch.audience).slice(0, 2000) : dna.audience,
        voice: patch.voice !== undefined ? String(patch.voice).slice(0, 500) : dna.voice,
        tone: patch.tone !== undefined ? String(patch.tone).slice(0, 500) : dna.tone,
        goals: patch.goals !== undefined ? String(patch.goals).slice(0, 2000) : dna.goals,
        claims: Array.isArray(patch.claims) ? patch.claims.map(String).slice(0, 40) : dna.claims,
        forbiddenClaims: Array.isArray(patch.forbiddenClaims)
          ? patch.forbiddenClaims.map(String).slice(0, 40)
          : dna.forbiddenClaims,
        platforms: Array.isArray(patch.platforms) ? patch.platforms.map(String).slice(0, 40) : dna.platforms,
        provenanceSourceRef: "owner.brand-dna",
        updatedAt: now,
      };
      draft.executive.brandDna = [
        dna,
        ...draft.executive.brandDna.filter((b) => b.workspaceId !== workspaceId),
      ];
      this.activity(draft, "settings", "brand.dna", `Brand DNA updated: ${ws.label}`, ws.id);
      return dna;
    });
  }

  async checkVisibility(sourceWorkspace: string, visibility: VisibilityClassV1) {
    const state = await this.snapshot();
    return mayUseAcrossContexts({
      sourceWorkspace,
      activeWorkspace: state.settings.activeWorkspace,
      visibility,
    });
  }

  async workQueue() {
    const state = await this.snapshot();
    return buildWorkQueue(state.relationships, this.ports.clock.now());
  }

  async dailyBriefing() {
    const state = await this.snapshot();
    const workspaceId = state.settings.activeWorkspace;
    const inWorkspace = state.relationships.filter((r) => r.workspace === workspaceId && !r.archived);
    return buildDailyBriefing({
      relationships: inWorkspace,
      tasks: state.tasks ?? [],
      drafts: (state.emailDrafts ?? []).filter((d) => d.workspace === workspaceId),
      documents: (state.crmDocuments ?? []).filter((d) => d.workspace === workspaceId),
      brands: (state.workspaces ?? [])
        .filter((w) => w.kind === "business" && !w.archived)
        .map((w) => ({ name: w.brand?.name || w.label })),
      workspaceId,
      nowIso: this.ports.clock.now(),
    });
  }

  /**
   * Gmail fixture mailbox (pre-OAuth). Synthetic messages only — never scrapes browser credentials.
   * Live Gmail waits for Owner OAuth; until then assistant/search use fixtures when seeded.
   */
  private gmailFixtures: GmailMessageFixtureV1[] = [];
  private metricoolBrands: MetricoolBrandFixtureV1[] = [];
  private metricoolPosts: MetricoolPostFixtureV1[] = [];

  seedGmailFixtures(messages: GmailMessageFixtureV1[]): number {
    this.gmailFixtures = messages.slice(0, 200);
    return this.gmailFixtures.length;
  }

  seedMetricoolFixtures(input: {
    brands?: MetricoolBrandFixtureV1[];
    posts?: MetricoolPostFixtureV1[];
  } = {}): { brands: number; posts: number } {
    if (Array.isArray(input.brands)) this.metricoolBrands = input.brands.slice(0, 100);
    if (Array.isArray(input.posts)) this.metricoolPosts = input.posts.slice(0, 500);
    return { brands: this.metricoolBrands.length, posts: this.metricoolPosts.length };
  }

  metricoolInsight(nowIso?: string) {
    const now = nowIso || this.ports.clock.now();
    const active = listMetricoolBrandFixtures(this.metricoolBrands);
    const best = bestPerformingPosts(this.metricoolPosts, 5);
    const needs = brandsNeedingAttention(this.metricoolBrands, this.metricoolPosts, now, 14);
    const scheduled = this.metricoolPosts.filter((p) => p.scheduledAt && !p.publishedAt);
    const status = metricoolConnectorStatus(defaultMetricoolConfig());
    return {
      status,
      mode: status.authorized ? "live-ready" : "fixture",
      activeBrands: active,
      bestPosts: best,
      needsAttention: needs,
      scheduled,
    };
  }

  async gmailConsentStatus() {
    const state = await this.snapshot();
    const envEnvelope = state.executive?.authorityEnvelope;
    const sendGate = evaluateExternalGate(envEnvelope, "email_send");
    const cfg = defaultGmailConfig();
    const connectors = state.settings.connectors ?? {
      gmailClientId: "",
      gmailRedirectUri: cfg.redirectUri,
      metricoolTokenEnvVar: "AION_METRICOOL_USER_TOKEN",
      metricoolBlogIdEnvVar: "AION_METRICOOL_BLOG_ID",
    };
    // Prefer Owner-stored client id, then env (never secrets in state)
    const clientId =
      connectors.gmailClientId?.trim() ||
      process.env.AION_GMAIL_CLIENT_ID?.trim() ||
      cfg.clientId;
    const redirectUri = connectors.gmailRedirectUri?.trim() || cfg.redirectUri;
    const config = { ...cfg, clientId, redirectUri };
    const status = gmailConnectorStatus(config, process.env, { sendAuthorized: sendGate.allowed });
    let authUrl: string | null = null;
    if ((status.code === "GMAIL_OWNER_CONSENT_REQUIRED" || status.code === "NOT_CONFIGURED") && clientId) {
      try {
        authUrl = buildGmailAuthUrl(config, `aion-${Date.now().toString(36)}`, {
          includeSend: sendGate.allowed,
        });
      } catch {
        authUrl = null;
      }
    }
    return {
      ...status,
      authUrl,
      clientIdConfigured: Boolean(clientId),
      clientSecretEnvVar: config.clientSecretEnvVar,
      refreshTokenEnvVar: config.refreshTokenEnvVar,
      redirectUri,
      ownerAction:
        status.code === "GMAIL_OWNER_CONSENT_REQUIRED"
          ? `Open the auth URL, complete Google consent, then store the refresh token in ${config.refreshTokenEnvVar} and the client secret in ${config.clientSecretEnvVar} (never paste into chat). SEND scopes requested when envelope allows.`
          : status.code === "NOT_CONFIGURED"
            ? "Save a Google OAuth client id in Settings → Connectors (or set AION_GMAIL_CLIENT_ID). Do not paste passwords into chat."
            : status.code === "READY"
              ? "Gmail is OAuth-ready. Live read/search/draft available under policy; SEND still Owner-gated separately."
              : null,
    };
  }

  async metricoolReadinessStatus() {
    const state = await this.snapshot();
    const connectors = state.settings.connectors ?? {
      gmailClientId: "",
      gmailRedirectUri: "http://127.0.0.1:31415/oauth/gmail/callback",
      metricoolTokenEnvVar: "AION_METRICOOL_USER_TOKEN",
      metricoolBlogIdEnvVar: "AION_METRICOOL_BLOG_ID",
    };
    const config = {
      ...defaultMetricoolConfig(),
      userTokenEnvVar: connectors.metricoolTokenEnvVar || defaultMetricoolConfig().userTokenEnvVar,
      blogIdEnvVar: connectors.metricoolBlogIdEnvVar || defaultMetricoolConfig().blogIdEnvVar,
    };
    const status = metricoolConnectorStatus(config);
    return {
      ...status,
      userTokenEnvVar: config.userTokenEnvVar,
      blogIdEnvVar: config.blogIdEnvVar,
      baseUrl: config.baseUrl,
      fixtureBrands: this.metricoolBrands.length,
      fixturePosts: this.metricoolPosts.length,
      ownerAction:
        status.code === "METRICOOL_OWNER_TOKEN_REQUIRED"
          ? `Create an official Metricool API user token and set environment variable ${config.userTokenEnvVar} (optional blog id: ${config.blogIdEnvVar}). Never paste the password into chat.`
          : status.code === "READY"
            ? "Metricool token present — live brand/post sync can run under connector policy."
            : null,
    };
  }

  async updateConnectorSettings(input: Record<string, unknown> = {}): Promise<SettingsV1["connectors"]> {
    return this.mutate((draft) => {
      if (!draft.settings.connectors) {
        draft.settings.connectors = {
          gmailClientId: "",
          gmailRedirectUri: "http://127.0.0.1:31415/oauth/gmail/callback",
          metricoolTokenEnvVar: "AION_METRICOOL_USER_TOKEN",
          metricoolBlogIdEnvVar: "AION_METRICOOL_BLOG_ID",
        };
      }
      const c = draft.settings.connectors;
      if (typeof input.gmailClientId === "string") c.gmailClientId = input.gmailClientId.trim().slice(0, 200);
      if (typeof input.gmailRedirectUri === "string" && input.gmailRedirectUri.trim()) {
        const uri = input.gmailRedirectUri.trim().slice(0, 500);
        if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(uri)) {
          throw new Error("Gmail redirect URI must be a loopback http(s) URL.");
        }
        c.gmailRedirectUri = uri;
      }
      if (typeof input.metricoolTokenEnvVar === "string" && input.metricoolTokenEnvVar.trim()) {
        const name = input.metricoolTokenEnvVar.trim();
        if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name)) throw new Error("Metricool token env var name is invalid.");
        c.metricoolTokenEnvVar = name;
      }
      if (typeof input.metricoolBlogIdEnvVar === "string" && input.metricoolBlogIdEnvVar.trim()) {
        const name = input.metricoolBlogIdEnvVar.trim();
        if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name)) throw new Error("Metricool blog id env var name is invalid.");
        c.metricoolBlogIdEnvVar = name;
      }
      this.activity(draft, "settings", "connectors.update", "Connector settings updated (no secrets stored).", null);
      return structuredClone(c);
    });
  }

  searchGmailFixtures(query: string) {
    const hits = searchGmailFixtureMessages(this.gmailFixtures, query);
    return {
      mode: "fixture" as const,
      messages: hits,
      commitments: hits.flatMap((m) =>
        extractCommitmentsFromBody(m.bodyText).map((c) => ({ messageId: m.id, text: c })),
      ),
    };
  }

  async associateGmailFixtureWithCrm(messageId: string): Promise<{
    message: GmailMessageFixtureV1 | null;
    customer: CustomerV1 | null;
    reply: string;
  }> {
    const msg = this.gmailFixtures.find((m) => m.id === messageId) ?? null;
    if (!msg) return { message: null, customer: null, reply: "Fixture message not found." };
    const state = await this.snapshot();
    const hay = `${msg.from} ${msg.subject} ${msg.snippet}`;
    const matches = findRelationshipsByName(
      state.relationships.filter((r) => r.workspace === state.settings.activeWorkspace && !r.archived),
      hay,
    );
    const customer = matches[0] ?? null;
    if (customer) {
      await this.recordCustomerInteraction(customer.id, {
        kind: "email",
        summary: `Email (fixture): ${msg.subject}`,
        detail: msg.bodyText.slice(0, 4000),
      });
    }
    return {
      message: msg,
      customer,
      reply: customer
        ? `Associated fixture email “${msg.subject}” with ${customer.displayName} (stored interaction).`
        : `Fixture email “${msg.subject}” from ${msg.from} — no CRM match yet. Create a contact or name the company.`,
    };
  }

  async attachCrmDocument(input: Record<string, unknown> = {}): Promise<CrmDocumentV1> {
    return this.mutate((draft) => {
      const now = this.ports.clock.now();
      const workspace = requireWorkspace(draft.workspaces, draft.settings.activeWorkspace);
      const relationshipId = typeof input.relationshipId === "string" && input.relationshipId ? input.relationshipId : null;
      if (relationshipId) find(draft.relationships, relationshipId, "Customer");
      const filename = String(input.filename ?? "document.bin").slice(0, 260);
      const mimeType = String(input.mimeType ?? "application/octet-stream").slice(0, 120);
      const kind =
        input.kind === "image" || input.kind === "spreadsheet" || input.kind === "document" || input.kind === "other"
          ? input.kind
          : mimeType.startsWith("image/")
            ? "image"
            : "document";
      const tags = Array.isArray(input.tags)
        ? input.tags.map((t) => String(t).slice(0, 80)).filter(Boolean).slice(0, 32)
        : typeof input.tags === "string"
          ? input.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 32)
          : [];
      const doc = newCrmDocument({
        id: this.ports.ids.next("crm-doc"),
        workspace: workspace.id,
        relationshipId,
        filename,
        storedPath: String(input.storedPath ?? "").slice(0, 1000),
        mimeType,
        byteLength: Number(input.byteLength ?? 0) || 0,
        kind,
        summary: String(input.summary ?? "").slice(0, 4000),
        extractedText: String(input.extractedText ?? "").slice(0, 100_000),
        now,
        contentHash: typeof input.contentHash === "string" ? input.contentHash : "",
        sourceRelativePath: typeof input.sourceRelativePath === "string" ? input.sourceRelativePath : "",
        sourceModifiedAt: typeof input.sourceModifiedAt === "string" ? input.sourceModifiedAt : null,
        sourceRootPath: typeof input.sourceRootPath === "string" ? input.sourceRootPath : "",
        entityKind: typeof input.entityKind === "string" ? input.entityKind : "",
        ...(typeof input.entityConfidence === "number" ? { entityConfidence: input.entityConfidence as number } : {}),
      });
      doc.tags = tags;
      // Dedupe by content hash: if identical content already stored, return existing (idempotent).
      if (doc.contentHash) {
        const existing = (draft.crmDocuments ?? []).find((d) => d.contentHash === doc.contentHash);
        if (existing) {
          this.activity(draft, "import", "crm.document.dedupe", `Skipped duplicate content: ${filename}`, existing.id);
          return existing;
        }
      }
      if (!Array.isArray(draft.crmDocuments)) draft.crmDocuments = [];
      draft.crmDocuments.unshift(doc);
      if (draft.crmDocuments.length > 500) draft.crmDocuments.length = 500;
      if (relationshipId) {
        const customer = find(draft.relationships, relationshipId, "Customer");
        customer.interactions.push({
          id: this.ports.ids.next("interaction"),
          at: now,
          kind: "note",
          summary: `Document attached: ${filename}`,
          detail: doc.summary || doc.extractedText.slice(0, 2000),
          lifecycleAfter: null,
          actor: "owner",
        });
        customer.updatedAt = now;
      }
      this.activity(draft, "import", "crm.document", `Document intake: ${filename}`, doc.id);
      return doc;
    });
  }

  async listCrmDocuments(relationshipId?: string): Promise<CrmDocumentV1[]> {
    const state = await this.snapshot();
    const docs = Array.isArray(state.crmDocuments) ? state.crmDocuments : [];
    if (!relationshipId) return docs;
    return docs.filter((d) => d.relationshipId === relationshipId);
  }

  async createEmailDraft(input: Record<string, unknown> = {}): Promise<EmailDraftV1> {
    return this.mutate((draft) => {
      const now = this.ports.clock.now();
      const workspace = requireWorkspace(draft.workspaces, draft.settings.activeWorkspace);
      const relationshipId = typeof input.relationshipId === "string" ? input.relationshipId : null;
      let toName = String(input.toName ?? "").slice(0, 200);
      let subject = String(input.subject ?? "").slice(0, 300);
      let body = String(input.body ?? "").slice(0, 20_000);
      let basedOn = String(input.basedOn ?? "owner-supplied").slice(0, 1000);
      if (relationshipId) {
        const customer = find(draft.relationships, relationshipId, "Customer");
        const built = buildEmailDraftFromCustomer(customer, "email");
        toName = toName || customer.displayName;
        subject = subject || built.subject;
        body = body || built.body;
        basedOn = basedOn === "owner-supplied" ? built.basedOn : basedOn;
        customer.interactions.push({
          id: this.ports.ids.next("interaction"),
          at: now,
          kind: "email",
          summary: `Email draft created: ${subject}`,
          detail: body.slice(0, 2000),
          lifecycleAfter: null,
          actor: "aion",
        });
        customer.updatedAt = now;
      }
      const email = contactEmail(findOptional(draft.relationships, relationshipId));
      const draftRec = newEmailDraft({
        id: this.ports.ids.next("email-draft"),
        workspace: workspace.id,
        relationshipId,
        toName,
        toAddress: String(input.toAddress ?? email).slice(0, 320),
        subject,
        body,
        basedOn,
        now,
      });
      if (!Array.isArray(draft.emailDrafts)) draft.emailDrafts = [];
      draft.emailDrafts.unshift(draftRec);
      if (draft.emailDrafts.length > 200) draft.emailDrafts.length = 200;
      this.activity(draft, "export", "crm.email.draft", `Email draft: ${subject}`, draftRec.id);
      return draftRec;
    });
  }

  async listEmailDrafts(relationshipId?: string): Promise<EmailDraftV1[]> {
    const state = await this.snapshot();
    const drafts = Array.isArray(state.emailDrafts) ? state.emailDrafts : [];
    if (!relationshipId) return drafts;
    return drafts.filter((d) => d.relationshipId === relationshipId);
  }

  /**
   * R7 natural-language assistant entry for CRM/sales. Deterministic structured CRM first;
   * falls back to chat when no CRM intent matches or subject cannot be resolved.
   */
  async assistantPrompt(text: string): Promise<{
    intent: string;
    confidence: string;
    reply: string;
    sources: Array<{ type: string; id: string; label: string }>;
    action: string | null;
    data: unknown;
  }> {
    const route = routeCrmAssistantIntent(text);
    const state = await this.snapshot();
    const workspaceId = state.settings.activeWorkspace;
    const inWorkspace = state.relationships.filter(
      (r) => r.workspace === workspaceId && !r.archived && !isSyntheticRelationship(r),
    );
    const sources: Array<{ type: string; id: string; label: string }> = [];

    if (route.intent === "IMPORT_STATUS") {
      // Usage metrics is routed here for phrase discovery but served by metrics path
      if (/\busage metrics\b|\bfriction metrics\b|\bhow am i using aion\b/i.test(text)) {
        const m = await this.realUsageMetrics();
        return {
          intent: "USAGE_METRICS",
          confidence: "high",
          reply: formatUsageMetrics(m),
          sources: [],
          action: "metrics.usage",
          data: m,
        };
      }
      if (
        /\bwhat do you know about me\b|\bwhat data do you have\b|\bdata completeness\b|\bwhat did you import\b|\bwhat needs review\b/i.test(
          text,
        )
      ) {
        const completeness = await this.ownerDataCompletenessReport();
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: completeness.reply,
          sources,
          action: "owner.dataCompleteness",
          data: completeness,
        };
      }
      const registry = await this.realDataSourceRegistry();
      const readiness = await this.importReadiness();
      const dash = await this.importDashboard();
      const completeness = await this.ownerDataCompletenessReport();
      const lines = [
        completeness.reply,
        "",
        "---",
        registry.reply,
        "",
        "---",
        readiness.summary,
        `Capability gate: ${readiness.code} · ready=${readiness.ready}`,
        `Dashboard: docs=${dash.documents} reviewOpen=${dash.reviewOpen}`,
        readiness.ownerActions.length
          ? `Owner actions:\n${readiness.ownerActions.map((a) => `  - ${a}`).join("\n")}`
          : "",
      ].filter(Boolean);
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: lines.join("\n"),
        sources,
        action: "import.registry",
        data: { registry, readiness, dashboard: dash, completeness },
      };
    }

    if (route.intent === "CONNECTOR_STATUS") {
      const center = await this.capabilityStatusCenter();
      const gmail = await this.gmailConsentStatus();
      const metricool = await this.metricoolReadinessStatus();
      const image = imageUnderstandingStatus();
      const lan = this.discoverLan();
      const phoneUrl = lan.preferred ? this.phoneUrlFor(lan.preferred.address, 31415) : null;
      const lines = [
        center.reply,
        "",
        "Connector / access status (no secrets shown):",
        `Gmail: ${gmail.code} — ${gmail.message}`,
        gmail.ownerAction ? `  Action: ${gmail.ownerAction}` : "",
        gmail.authUrl ? `  Consent URL available (open from Settings → Connectors).` : "",
        `Metricool: ${metricool.code} — ${metricool.message}`,
        metricool.ownerAction ? `  Action: ${metricool.ownerAction}` : "",
        `Image vision: ${image.code} — ${image.message}`,
        image.localMultimodalRecommended?.length
          ? `  Setup: ${image.localMultimodalRecommended.join("; ")}`
          : "",
        `Phone LAN: ${lan.preferred ? `${lan.preferred.address} (${lan.preferred.interfaceName})` : "no private IPv4"}`,
        phoneUrl ? `  Phone URL: ${phoneUrl}` : "  Enable private phone access in Settings after LAN is up.",
      ].filter(Boolean);
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: lines.join("\n"),
        sources,
        action: "connector.status",
        data: { center, gmail, metricool, image, lan, phoneUrl },
      };
    }

    if (route.intent === "CONTEXT_SWITCH") {
      const name =
        text.match(/\bswitch to\s+(.+?)(?:\.|$)/i)?.[1] ||
        text.match(/\buse\s+(.+?)(?:\.|$)/i)?.[1] ||
        text;
      const result = await this.switchContext(name.trim());
      return {
        intent: route.intent,
        confidence: "high",
        reply: result.message,
        sources: [{ type: "context", id: result.workspaceId, label: result.label }],
        action: "context.switch",
        data: result,
      };
    }
    if (
      route.intent === "ATTENTION_BOARD" ||
      (route.intent === "WORK_QUEUE" && /\bonly i need\b|aion can do|owner must do|dealership only|show me dealership|what can you handle|what should i do first|\bwhy\b/i.test(text))
    ) {
      let filter: { workspace?: string; onlyOwner?: boolean; onlyAion?: boolean } | undefined;
      if (/\bdealership only\b|\bshow me dealership\b|\blakeland only\b/i.test(text)) {
        filter = { workspace: "work" };
      } else if (/\bwhat can you handle\b|\baion can (do|handle)\b/i.test(text)) {
        filter = { onlyAion: true };
      } else if (/\bonly i need\b|\bowner must\b|\bwhat should i do first\b/i.test(text)) {
        filter = { onlyOwner: true };
      }
      const board = await this.attentionBoard(filter);
      const whyExtra =
        /\bwhy\b/i.test(text) && board.explanations?.length
          ? ["", "Why (top items):", ...board.explanations.slice(0, 5).map((e) => `  • ${e}`)]
          : [];
      return {
        intent: "ATTENTION_BOARD",
        confidence: "high",
        reply: [...board.briefingLines, ...whyExtra].join("\n"),
        sources: [],
        action: "attention.board",
        data: board,
      };
    }
    if (route.intent === "UNIVERSAL_CAPTURE" || /\bcapture:\s*/i.test(text)) {
      const payload = text.replace(/^\s*capture:\s*/i, "");
      const result = await this.universalCapture(payload, { apply: true });
      return {
        intent: "UNIVERSAL_CAPTURE",
        confidence: result.classification.confidence,
        reply: [
          `Capture · ${result.classification.kind} (${result.classification.confidence})`,
          result.classification.why,
          result.classification.needsConfirm ? "CONFIRM needed before full apply." : `Applied: ${result.applied.join("; ") || "none"}`,
          result.skipped.length ? `Skipped: ${result.skipped.join("; ")}` : "",
          `Proposed: ${result.classification.proposedActions.join(" · ")}`,
        ]
          .filter(Boolean)
          .join("\n"),
        sources: [],
        action: "capture.universal",
        data: result,
      };
    }
    // Customer prep card: "Prepare me for John."
    {
      const prepMatch =
        text.match(/^\s*prepare me for\s+(.+?)\s*[.!]?\s*$/i) ||
        text.match(/\bprep(?:are)?(?:\s+me)?\s+for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
      if (prepMatch?.[1] && !/\btoday\b|\bmy day\b|\bmy calls\b|\bmy next appointment\b/i.test(prepMatch[1])) {
        const card = await this.prepareCustomerCard(prepMatch[1].replace(/[.!]+$/, "").trim());
        return {
          intent: "CUSTOMER_PREP",
          confidence: card.ambiguous ? "medium" : card.relationshipId ? "high" : "low",
          reply: card.reply,
          sources: card.relationshipId
            ? [{ type: "customer", id: card.relationshipId, label: card.who }]
            : [],
          action: "customer.prep_card",
          data: card,
        };
      }
    }

    // Morning executive cycle / dealership assist
    if (
      /\b(morning (brief|cycle|executive)|start my day|what should i do today|dealership morning|morning assist)\b/i.test(
        text,
      )
    ) {
      const scope = /\bdealership\b|\blakeland\b/i.test(text)
        ? ("work" as const)
        : /\bpersonal only\b/i.test(text)
          ? ("personal" as const)
          : ("all" as const);
      const morning = await this.runMorningExecutiveCycle({ scope });
      return {
        intent: "MORNING_CYCLE",
        confidence: "high",
        reply: morning.reply,
        sources: [],
        action: "executive.morning",
        data: morning,
      };
    }

    // Explainability
    if (
      /\bwhy are you telling me this\b|\bwhy is this first\b|\bwhere did that come from\b|\bwhat changed\b/i.test(
        text,
      )
    ) {
      const board = await this.attentionBoard();
      if (/\bwhy is this first\b/i.test(text)) {
        return {
          intent: "EXPLAIN",
          confidence: "high",
          reply: explainWhyFirst(
            board.ownerMustDo.slice(0, 3).map((i) => ({
              title: i.title,
              score: i.score,
              why: i.why,
            })),
          ),
          sources: [],
          action: "explain.why_first",
          data: board.ownerMustDo.slice(0, 3),
        };
      }
      if (/\bwhat changed\b/i.test(text)) {
        const cycle = state.executive?.lastCycleResult;
        const last = state.executive?.lastBriefingAt;
        return {
          intent: "EXPLAIN",
          confidence: "high",
          reply: [
            "WHAT CHANGED",
            last ? `Since last briefing ${last.slice(0, 16)}:` : "No prior briefing baseline.",
            cycle
              ? `  Cycle ${cycle.cycleId}: changes=${cycle.changesDetected} completed=${cycle.jobsCompleted} owner-req=${cycle.jobsOwnerRequired}`
              : "  No executive cycle yet.",
            ...(cycle?.audit.slice(-5).map((a) => `  • ${a}`) ?? []),
          ].join("\n"),
          sources: [],
          action: "explain.what_changed",
          data: cycle,
        };
      }
      const top = board.ownerMustDo[0];
      return {
        intent: "EXPLAIN",
        confidence: "high",
        reply: top
          ? explainWhySurfacing({
              title: top.title,
              reason: top.why,
              sourceRef: top.sourceType,
              score: top.score,
              horizon: top.horizon,
            })
          : "Nothing is currently surfaced on the Owner-must-do board.",
        sources: [],
        action: "explain.why",
        data: top ?? null,
      };
    }

    if (/\busage metrics\b|\bfriction metrics\b|\bhow am i using aion\b/i.test(text)) {
      const m = await this.realUsageMetrics();
      return {
        intent: "USAGE_METRICS",
        confidence: "high",
        reply: formatUsageMetrics(m),
        sources: [],
        action: "metrics.usage",
        data: m,
      };
    }

    if (route.intent === "END_OF_DAY") {
      const wrap = await this.endOfDayWrap();
      return {
        intent: route.intent,
        confidence: "high",
        reply: wrap.reply,
        sources: [],
        action: "executive.eod",
        data: wrap,
      };
    }
    if (route.intent === "WEEKLY_REVIEW") {
      const weekly = await this.weeklyCeoReview();
      return {
        intent: route.intent,
        confidence: "high",
        reply: weekly.reply,
        sources: [],
        action: "executive.weekly",
        data: weekly,
      };
    }
    if (route.intent === "EXECUTIVE_CYCLE") {
      const cycle = await this.runExecutiveCycle({});
      return {
        intent: route.intent,
        confidence: "high",
        reply: [
          `Executive cycle ${cycle.cycleId}`,
          `Changes: ${cycle.changesDetected} · Jobs proposed/executed/completed: ${cycle.jobsProposed}/${cycle.jobsExecuted}/${cycle.jobsCompleted}`,
          `Failed: ${cycle.jobsFailed} · Owner required: ${cycle.jobsOwnerRequired}`,
          `Unauthorized external attempts: ${cycle.unauthorizedExternalAttempts}`,
          "",
          "AION completed:",
          ...cycle.aionCompleted.slice(0, 6).map((x) => `  • ${x}`),
          "",
          "Owner must do:",
          ...cycle.ownerMustDo.slice(0, 5).map((x) => `  • ${x}`),
          "",
          ...cycle.audit.slice(-3),
        ].join("\n"),
        sources: [],
        action: "executive.cycle",
        data: cycle,
      };
    }
    if (route.intent === "AUTONOMY_AUDIT") {
      const audit = await this.autonomyDayAudit();
      return {
        intent: route.intent,
        confidence: "high",
        reply: audit.reply,
        sources: [],
        action: "executive.audit",
        data: audit,
      };
    }
    // Cross-context isolation: broad "everything you know" stays in active workspace
    if (/\b(everything you know|search all my data|use anything you know|all customers)\b/i.test(text)) {
      const active = state.settings.activeWorkspace;
      const label = state.settings.workspaceLabels?.[active] ?? active;
      const people = state.relationships.filter((r) => r.workspace === active && !r.archived);
      return {
        intent: "CONTEXT_SWITCH",
        confidence: "high",
        reply: [
          `Scope limited to active context: ${label} (${active}).`,
          "AION will not pull WORKSPACE_ONLY records from other contexts on a broad prompt.",
          `People visible here: ${people.slice(0, 12).map((p) => p.displayName).join(", ") || "none"}`,
          "Switch context explicitly, or mark facts OWNER_SHARED, to cross boundaries.",
        ].join("\n"),
        sources: people.slice(0, 5).map((p) => ({ type: "customer", id: p.id, label: p.displayName })),
        action: "context.scope",
        data: { workspace: active, count: people.length },
      };
    }

    // Dealership sales copilot NL
    if (
      state.settings.activeWorkspace === "work" &&
      /\b(who should i follow up|which customers have a matching|who did i promise|deals? (are )?going stale|what should i show|prepare me for my next appointment)\b/i.test(
        text,
      )
    ) {
      if (/\bpromise\b|\bcommitment\b/i.test(text)) {
        const commits = (state.executive?.commitments ?? []).filter(
          (c) => c.workspace === "work" && c.status !== "kept" && c.status !== "cancelled",
        );
        return {
          intent: "VEHICLE_INVENTORY",
          confidence: "high",
          reply: commits.length
            ? `Open dealership commitments:\n${commits.map((c) => `  • [${c.status}] ${c.committedBy}→${c.committedTo}: ${c.statement} due ${c.dueAt ?? "?"}`).join("\n")}`
            : "No open dealership commitments stored.",
          sources: [],
          action: "commitment.list",
          data: commits,
        };
      }
      if (/\bstale\b/i.test(text)) {
        const stalled = findStalledDeals(
          state.relationships.filter((r) => r.workspace === "work" && !r.archived && !isSyntheticRelationship(r)),
          this.ports.clock.now(),
          14,
        );
        return {
          intent: "VEHICLE_INVENTORY",
          confidence: "high",
          reply: stalled.length
            ? `Stalled work accounts:\n${stalled.slice(0, 10).map((s) => `  • ${s.customer}: ${s.reason}`).join("\n")}`
            : "No stalled signals from stored CRM.",
          sources: [],
          action: "sales.stalled",
          data: stalled,
        };
      }
      if (/\bmatching vehicle\b|\bhave a matching\b/i.test(text)) {
        const opps = await this.refreshOpportunityRadar();
        const matches = opps.filter((o) => o.kind === "inventory_match");
        return {
          intent: "VEHICLE_INVENTORY",
          confidence: "high",
          reply: matches.length
            ? matches.slice(0, 8).map((m) => `• ${m.title}`).join("\n")
            : "No inventory×customer matches right now.",
          sources: [],
          action: "opportunity.radar",
          data: matches,
        };
      }
      if (/\bwhat should i show\b|\bprepare me for\b/i.test(text)) {
        const name = text.match(/\bshow\s+([A-Z][a-z]+)\b/i)?.[1] || text.match(/\bfor\s+([A-Z][a-z]+)\b/i)?.[1];
        if (name && !/\btoday|calls|appointment\b/i.test(name)) {
          const card = await this.prepareCustomerCard(name);
          return {
            intent: "CUSTOMER_PREP",
            confidence: card.relationshipId ? "high" : "medium",
            reply: card.reply,
            sources: card.relationshipId
              ? [{ type: "customer", id: card.relationshipId, label: card.who }]
              : [],
            action: "customer.prep_card",
            data: card,
          };
        }
      }
      const board = await this.attentionBoard({ workspace: "work", onlyOwner: true });
      return {
        intent: "ATTENTION_BOARD",
        confidence: "high",
        reply: ["Dealership focus:", ...board.briefingLines].join("\n"),
        sources: [],
        action: "attention.board",
        data: board,
      };
    }

    if (route.intent === "VEHICLE_INVENTORY") {
      const inv = this.vehicleInv(state);
      // Owner work context
      if (/\bi work at\s+(.+?)(?:\.|$)/i.test(text) || /\bi work at lakeland toyota\b/i.test(text)) {
        const m = text.match(/\bi work at\s+(.+?)(?:\.|$)/i);
        const name = (m?.[1] || "Lakeland Toyota").trim();
        const d = /lakeland/i.test(name)
          ? await this.ensureLakelandToyotaContext({ ownerWorksHere: true, setCurrent: true })
          : await this.setCurrentDealership(name);
        if (!/lakeland/i.test(name)) {
          await this.mutate((draft) => {
            if (!draft.vehicleInventory) return null;
            draft.vehicleInventory.dealerships = draft.vehicleInventory.dealerships.map((x) =>
              x.id === d.id ? { ...x, ownerWorksHere: true } : x,
            );
            return null;
          });
        }
        return {
          intent: route.intent,
          confidence: "high",
          reply: `Stored Owner-supplied work context: you work at ${d.name}. Provenance: owner.dealership (not GPS). Use “Use ${d.name} as my current dealership” anytime.`,
          sources: [{ type: "dealership", id: d.id, label: d.name }],
          action: "dealership.work-context",
          data: d,
        };
      }
      if (/\buse\s+(.+?)\s+as my current dealership\b/i.test(text) || /\bcurrent dealership\b/i.test(text)) {
        const m = text.match(/\buse\s+(.+?)\s+as my current dealership\b/i);
        const name = (m?.[1] || "Lakeland Toyota").trim();
        const d = await this.setCurrentDealership(name);
        return {
          intent: route.intent,
          confidence: "high",
          reply: `Current dealership set to ${d.name}. Inventory Walk and public inventory refresh will use this context.`,
          sources: [{ type: "dealership", id: d.id, label: d.name }],
          action: "dealership.current",
          data: d,
        };
      }
      if (/\brefresh\b.*\binventory\b/i.test(text)) {
        const result = await this.refreshDealershipInventory(
          /lakeland/i.test(text) ? { dealershipName: "Lakeland Toyota" } : {},
        );
        return {
          intent: route.intent,
          confidence: "high",
          reply: [
            result.message,
            `Mode: ${result.mode} · listings: ${result.listings.length}`,
            "Source type: public dealer website. Online listing ≠ physically on lot.",
            result.sourceUrls.slice(0, 3).map((u) => `  ${u}`).join("\n"),
          ].join("\n"),
          sources: result.sourceUrls.slice(0, 3).map((u, i) => ({ type: "url", id: String(i), label: u })),
          action: "inventory.refresh",
          data: { count: result.listings.length, mode: result.mode },
        };
      }
      if (/\bdecode (this )?vin\b/i.test(text) || /\b[A-HJ-NPR-Z0-9]{17}\b/.test(text) && /\bdecode\b/i.test(text)) {
        const cand = extractVinCandidatesFromText(text)[0] || text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/)?.[0];
        if (!cand) {
          return {
            intent: route.intent,
            confidence: "high",
            reply: "Provide a 17-character VIN to decode.",
            sources: [],
            action: "vin.decode",
            data: null,
          };
        }
        const { validation, decode } = await this.decodeVinAction(cand);
        return {
          intent: route.intent,
          confidence: "high",
          reply: validation.valid
            ? [
                `VIN ${validation.normalized} — ${validation.message}`,
                decode.year || decode.make
                  ? `Decode (${decode.source}): ${[decode.year, decode.make, decode.model, decode.trim].filter(Boolean).join(" ")}`
                  : `Decode: ${decode.errorText || "no attributes"}`,
                `Source: ${decode.provenance.sourceRef}`,
              ].join("\n")
            : `VIN invalid: ${validation.message}`,
          sources: validation.normalized
            ? [{ type: "vin", id: validation.normalized, label: validation.normalized }]
            : [],
          action: "vin.decode",
          data: { validation, decode },
        };
      }
      if (/\bdo we have this vin\b/i.test(text) || (/\bdo we have\b/i.test(text) && /\b[A-HJ-NPR-Z0-9]{17}\b/.test(text))) {
        const cand = extractVinCandidatesFromText(text)[0];
        if (!cand) {
          return { intent: route.intent, confidence: "high", reply: "Paste a 17-character VIN.", sources: [], action: "vehicle.lookup", data: null };
        }
        const hits = await this.listVehicles({ vin: cand });
        const v = hits[0];
        return {
          intent: route.intent,
          confidence: "high",
          reply: v
            ? `Yes — ${[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ")} · stock ${v.stockNumber ?? "?"} · status ${v.presenceStatus} · last online ${v.lastOnlineAt ?? "n/a"} · last physical ${v.lastPhysicalAt ?? "n/a"}`
            : `No stored record for VIN ${normalizeVinCandidate(cand)}. Refresh public inventory or walk-scan it.`,
          sources: v ? [{ type: "vehicle", id: v.id, label: v.vin || v.id }] : [],
          action: "vehicle.lookup",
          data: v ?? null,
        };
      }
      // Inventory queries: Camrys, Tacomas, used under price
      const yearM = text.match(/\b(20\d{2})\b/);
      const modelM = text.match(/\b(camrys?|tacomas?|highlanders?|rav4s?|corollas?|tundras?|4runners?)\b/i);
      const used = /\bused\b/i.test(text);
      const priceM = text.match(/(?:under|below)\s*\$?\s*([\d,]+)/i);
      if (modelM || /\blisted right now\b/i.test(text) || /\bfind me a\b/i.test(text)) {
        const model = modelM ? modelM[1]!.replace(/s$/i, "") : undefined;
        const q: Parameters<typeof queryVehicles>[1] = { make: "Toyota" };
        if (yearM) q.year = Number(yearM[1]);
        if (model) q.model = model;
        if (used) q.condition = "used";
        if (priceM) q.maxPrice = Number(priceM[1]!.replace(/,/g, ""));
        const hits = await this.listVehicles(q);
        const lines = hits.slice(0, 12).map(
          (v) =>
            `  - ${[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ")} · VIN ${v.vin ?? "?"} · stock ${v.stockNumber ?? "?"} · $${v.priceHistory[0]?.advertisedPrice ?? "?"} · ${v.presenceStatus}`,
        );
        return {
          intent: route.intent,
          confidence: "high",
          reply: [
            `Vehicle query (stored inventory + public refresh history): ${hits.length} match(es).`,
            lines.join("\n") || "  (none stored — try Refresh inventory first)",
            "Sources: dealer public listing observations and/or physical walks. Online ≠ on lot.",
          ].join("\n"),
          sources: hits.slice(0, 8).map((v) => ({ type: "vehicle", id: v.id, label: v.vin || v.id })),
          action: "vehicle.query",
          data: { count: hits.length, vehicles: hits.slice(0, 25) },
        };
      }
      if (
        /\binventory walk test results\b/i.test(text) ||
        /\bwalk (acceptance|test) (results|report|metrics)\b/i.test(text) ||
        /\bphysical walk (results|metrics|acceptance)\b/i.test(text)
      ) {
        const report = await this.inventoryWalkTestResults();
        if (!report) {
          return {
            intent: route.intent,
            confidence: "high",
            reply:
              "No inventory walk on record yet.\nREAL_DEALERSHIP_WALK = OWNER_TEST_PENDING\nStart Inventory Walk on phone, then ask again.",
            sources: [],
            action: "inventory.walk.test_results",
            data: null,
          };
        }
        return {
          intent: route.intent,
          confidence: "high",
          reply: report.reply,
          sources: [{ type: "walk", id: report.walkId, label: report.dealershipName }],
          action: "inventory.walk.test_results",
          data: report,
        };
      }
      if (/\bwhich cars did i verify today\b/i.test(text) || /\bverified (today|this morning)\b/i.test(text)) {
        const hits = await this.listVehicles({ verifiedToday: true });
        return {
          intent: route.intent,
          confidence: "high",
          reply: hits.length
            ? `Physically verified today (${hits.length}):\n${hits.map((v) => `  - ${v.vin} ${[v.year, v.make, v.model].filter(Boolean).join(" ")}`).join("\n")}`
            : "No physical verifications recorded today. Start Inventory Walk on phone.",
          sources: hits.map((v) => ({ type: "vehicle", id: v.id, label: v.vin || v.id })),
          action: "vehicle.verified-today",
          data: hits,
        };
      }
      if (/\bonline.*not (see|verify)|didn'?t (see|verify)\b/i.test(text)) {
        const summary = await this.inventoryWalkSummary();
        if (!summary) {
          return {
            intent: route.intent,
            confidence: "high",
            reply: "No inventory walk on record yet.",
            sources: [],
            action: "inventory.walk.summary",
            data: null,
          };
        }
        return {
          intent: route.intent,
          confidence: "high",
          reply: [
            "Online but not seen (this walk):",
            ...summary.exceptionsFirst,
            `Count: ${summary.onlineButNotSeen.length}`,
            summary.caveat,
          ].join("\n"),
          sources: [],
          action: "inventory.walk.summary",
          data: summary,
        };
      }
      if (/\bprice change\b/i.test(text)) {
        const cand = extractVinCandidatesFromText(text)[0];
        const hits = cand ? await this.listVehicles({ vin: cand }) : inv.vehicles.slice(0, 5);
        const v = hits[0];
        if (!v) {
          return { intent: route.intent, confidence: "medium", reply: "No vehicle found for price history.", sources: [], action: "vehicle.price", data: null };
        }
        const hist = v.priceHistory.slice(0, 5);
        return {
          intent: route.intent,
          confidence: "high",
          reply: hist.length
            ? `Price history for ${v.vin ?? v.id}:\n${hist.map((h) => `  ${h.at}: advertised=${h.advertisedPrice ?? "?"} msrp=${h.msrp ?? "?"} (${h.sourceUrl})`).join("\n")}`
            : "No price history stored yet.",
          sources: [{ type: "vehicle", id: v.id, label: v.vin || v.id }],
          action: "vehicle.price",
          data: hist,
        };
      }
      if (/\brecall\b/i.test(text)) {
        const cand = extractVinCandidatesFromText(text)[0];
        const recalls = await this.vehicleRecallLookup(cand ? { vin: cand } : {});
        return {
          intent: route.intent,
          confidence: "high",
          reply: [
            recalls.message,
            ...recalls.recalls.slice(0, 5).map((r) => `  - ${r.campaignNumber}: ${r.component} — ${r.summary.slice(0, 160)}`),
            `Source: [nhtsa-recall] ${recalls.provenance.sourceRef}`,
          ].join("\n"),
          sources: [],
          action: "vehicle.recalls",
          data: recalls,
        };
      }
      if (/\btalking points\b|\bprepare me to show\b|\bwhat should i mention\b/i.test(text)) {
        const cand = extractVinCandidatesFromText(text)[0];
        try {
          const pack = await this.vehicleTalkingPoints(cand ? { vin: cand } : {});
          return {
            intent: route.intent,
            confidence: "high",
            reply: pack.reply,
            sources: [{ type: "vehicle", id: pack.vehicle.id, label: pack.vehicle.vin || pack.vehicle.id }],
            action: "vehicle.talking-points",
            data: pack,
          };
        } catch (e) {
          return {
            intent: route.intent,
            confidence: "medium",
            reply: e instanceof Error ? e.message : String(e),
            sources: [],
            action: "vehicle.talking-points",
            data: null,
          };
        }
      }
      if (/\bcompare\b/i.test(text)) {
        const vins = extractVinCandidatesFromText(text);
        if (vins.length >= 2) {
          try {
            const cmp = await this.vehicleCompare(vins[0]!, vins[1]!);
            return {
              intent: route.intent,
              confidence: "high",
              reply: cmp.reply,
              sources: cmp.vehicles.map((v) => ({ type: "vehicle", id: v.id, label: v.vin || v.id })),
              action: "vehicle.compare",
              data: cmp,
            };
          } catch (e) {
            return {
              intent: route.intent,
              confidence: "medium",
              reply: e instanceof Error ? e.message : String(e),
              sources: [],
              action: "vehicle.compare",
              data: null,
            };
          }
        }
      }
      if (/\binterested in\b/i.test(text) || /\badd this .{0,40} to .{0,40} options\b/i.test(text)) {
        const nameMatch = text.match(/\b([A-Z][a-z]+)\s+is interested in\b/i) || text.match(/\bto\s+([A-Z][a-z]+)'?s options\b/i);
        const modelM = text.match(/\b(camry|tacoma|highlander|rav4|corolla|tundra|4runner)\b/i);
        const vinCand = extractVinCandidatesFromText(text)[0];
        if (nameMatch) {
          const people = findRelationshipsByName(inWorkspace, nameMatch[1]!);
          const person = people[0];
          if (!person) {
            return {
              intent: route.intent,
              confidence: "high",
              reply: `No customer named ${nameMatch[1]} in this workspace. Create the prospect first.`,
              sources: [],
              action: "vehicle.associate",
              data: null,
            };
          }
          let vehicle = vinCand ? (await this.listVehicles({ vin: vinCand }))[0] : null;
          if (!vehicle && modelM) {
            vehicle = (await this.listVehicles({ model: modelM[1]!, make: "Toyota" }))[0] ?? null;
          }
          if (!vehicle) {
            return {
              intent: route.intent,
              confidence: "high",
              reply: `Found ${person.displayName}, but no matching vehicle in inventory. Scan/import the VIN first or name it precisely.`,
              sources: [{ type: "customer", id: person.id, label: person.displayName }],
              action: "vehicle.associate",
              data: null,
            };
          }
          const linked = await this.associateVehicleWithCustomer({
            vehicleId: vehicle.id,
            relationshipId: person.id,
          });
          return {
            intent: route.intent,
            confidence: "high",
            reply: `Owner-asserted interest: ${person.displayName} ↔ ${linked.vin || linked.id} (${[linked.year, linked.make, linked.model].filter(Boolean).join(" ")}). Not inferred.`,
            sources: [
              { type: "customer", id: person.id, label: person.displayName },
              { type: "vehicle", id: linked.id, label: linked.vin || linked.id },
            ],
            action: "vehicle.associate",
            data: linked,
          };
        }
      }
      if (/\bwhen did i last verify\b|\bwas this vin here\b|\bseen multiple times\b|\bdisappeared from online\b/i.test(text)) {
        const cand = extractVinCandidatesFromText(text)[0];
        if (cand) {
          const v = (await this.listVehicles({ vin: cand }))[0];
          const obs = inv.observations.filter((o) => o.vin === normalizeVinCandidate(cand));
          return {
            intent: route.intent,
            confidence: "high",
            reply: v
              ? [
                  `VIN ${v.vin}: presence ${v.presenceStatus}`,
                  `Last physical: ${v.lastPhysicalAt ?? "never in AION"}`,
                  `Last online: ${v.lastOnlineAt ?? "n/a"}`,
                  `Walk observations: ${obs.length}`,
                  ...obs.slice(0, 5).map((o) => `  - ${o.observedAt} · ${o.matchStatus} · walk ${o.walkId}`),
                  `Price points stored: ${v.priceHistory.length}`,
                ].join("\n")
              : `No stored vehicle for ${cand}.`,
            sources: v ? [{ type: "vehicle", id: v.id, label: v.vin || v.id }] : [],
            action: "vehicle.history",
            data: { vehicle: v, observations: obs },
          };
        }
        const gone = inv.vehicles.filter((v) => v.presenceStatus === "NO_LONGER_FOUND_ONLINE").slice(0, 15);
        return {
          intent: route.intent,
          confidence: "high",
          reply: gone.length
            ? `No longer found online (${gone.length}):\n${gone.map((v) => `  - ${v.vin} ${[v.year, v.make, v.model].filter(Boolean).join(" ")}`).join("\n")}`
            : "No vehicles marked NO_LONGER_FOUND_ONLINE yet. Refresh public inventory after a walk.",
          sources: [],
          action: "vehicle.disappeared",
          data: gone,
        };
      }
      const dealer = inv.dealerships.find((d) => d.isCurrent) || inv.dealerships[0];
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: [
          "Dealership / inventory assistant:",
          dealer ? `Current: ${dealer.name}${dealer.ownerWorksHere ? " (Owner works here)" : ""}` : "No dealership context yet — say “I work at Lakeland Toyota”.",
          `Vehicles stored: ${inv.vehicles.length} · walks: ${inv.walks.length} · observations: ${inv.observations.length}`,
          "",
          "Phone: Work → Inventory Walk (manual VIN OK).",
          "Try: Refresh Lakeland Toyota inventory · Decode VIN · Do we have any 2025 Camrys?",
        ].join("\n"),
        sources: dealer ? [{ type: "dealership", id: dealer.id, label: dealer.name }] : [],
        action: "inventory.status",
        data: { dealer, vehicleCount: inv.vehicles.length },
      };
    }

    if (route.intent === "WORK_QUEUE" || route.intent === "LIST_FOLLOWUPS") {
      const useBriefing =
        route.intent === "WORK_QUEUE" ||
        /\bbriefing|what needs me|what can you handle|what changed|prepare me for today|what did i forget\b/i.test(text);
      if (useBriefing) {
        // Prefer proactive brief with delta; keep CRM briefing as detail
        const proactive = await this.prepareProactiveBrief();
        const brands = (state.workspaces ?? [])
          .filter((w) => w.kind === "business" && !w.archived && !isTestOrE2eWorkspace(w))
          .map((w) => ({ name: w.brand?.name || w.label }));
        const briefing = buildDailyBriefing({
          relationships: inWorkspace,
          tasks: state.tasks ?? [],
          drafts: (state.emailDrafts ?? []).filter((d) => d.workspace === workspaceId),
          documents: (state.crmDocuments ?? []).filter((d) => d.workspace === workspaceId),
          brands,
          workspaceId,
          nowIso: this.ports.clock.now(),
        });
        let brandExtra = "";
        if (/\bbrand|caleb|collaborator|scheduled|posted|metricool|performed\b/i.test(text)) {
          const collabs = Array.isArray(state.brandCollaborators) ? state.brandCollaborators : [];
          const m = this.metricoolInsight();
          brandExtra = [
            "",
            brands.length
              ? `Active brand workspaces (${brands.length}): ${brands.map((b) => b.name).join(", ")}`
              : "Active brand workspaces: none recorded.",
            collabs.length
              ? `Collaborators (owner-supplied only):\n${collabs
                  .slice(0, 12)
                  .map((c) => `  - ${c.name}${c.role ? ` · ${c.role}` : ""}${c.brandResponsibility ? ` — ${c.brandResponsibility}` : ""}`)
                  .join("\n")}`
              : "Collaborators: none recorded. AION does not invent who manages a brand.",
            "",
            m.activeBrands.length
              ? `Metricool fixtures — active brands: ${m.activeBrands.map((b) => b.name).join(", ")}`
              : `Metricool: ${m.status.message}`,
            m.scheduled.length
              ? `Scheduled posts (fixture): ${m.scheduled.slice(0, 5).map((p) => `${p.network}@${p.scheduledAt?.slice(0, 10)}`).join("; ")}`
              : "",
            m.bestPosts.length
              ? `Best performing (fixture): ${m.bestPosts.slice(0, 3).map((p) => `"${p.text.slice(0, 40)}" likes=${p.metrics.likes ?? 0}`).join("; ")}`
              : "",
            m.needsAttention.length
              ? `Brand attention (fixture): ${m.needsAttention.map((n) => `${n.brand}: ${n.reason}`).join("; ")}`
              : "",
          ].filter(Boolean).join("\n");
        }
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: `${proactive.reply}\n\n— Active context CRM detail (${state.settings.workspaceLabels?.[workspaceId] ?? workspaceId}) —\n${briefing.text}${brandExtra}`,
          sources,
          action: "work.briefing",
          data: { briefing, proactive },
        };
      }
      const queue = buildWorkQueue(inWorkspace, this.ports.clock.now());
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: queue.text,
        sources,
        action: "work.queue",
        data: { queue },
      };
    }

    if (route.intent === "SALES_INSIGHT") {
      const now = this.ports.clock.now();
      // Brand-centric questions: registry + Metricool fixtures/live status (no fabrication).
      if (/\bbrand|caleb|collaborator|scheduled|performed|posted recently\b/i.test(text)) {
        const brands = (state.workspaces ?? []).filter((w) => w.kind === "business" && !w.archived);
        const collabs = Array.isArray(state.brandCollaborators) ? state.brandCollaborators : [];
        const m = this.metricoolInsight(now);
        const lines = [
          "Brand / business status (stored registry + connector data only):",
          "",
          brands.length
            ? `Brand registry (${brands.length}):\n${brands
                .map((b) => {
                  const bname = b.brand?.name || b.label;
                  const ch = b.brand?.channels?.length ? ` · channels: ${b.brand.channels.join(", ")}` : "";
                  const pos = b.brand?.positioning ? ` · positioning: ${b.brand.positioning.slice(0, 120)}` : "";
                  return `  - ${bname}${ch}${pos}`;
                })
                .join("\n")}`
            : "Brand registry: none yet. Create one under Knowledge / Import.",
          "",
          collabs.length
            ? `Collaborators (owner-supplied only):\n${collabs
                .slice(0, 12)
                .map((c) => `  - ${c.name}${c.role ? ` · ${c.role}` : ""}${c.brandResponsibility ? ` — ${c.brandResponsibility}` : ""}`)
                .join("\n")}`
            : "Collaborators: none recorded. AION does not invent who manages a brand.",
          "",
          m.activeBrands.length
            ? `Metricool active brands (${m.mode}):\n${m.activeBrands.map((b) => `  - ${b.name} · ${b.networks.join(", ") || "no networks"}`).join("\n")}`
            : `Metricool (${m.mode}): ${m.status.message}`,
          m.scheduled.length
            ? `Scheduled content:\n${m.scheduled
                .slice(0, 8)
                .map((p) => {
                  const bname = m.activeBrands.find((b) => b.id === p.brandId)?.name || p.brandId;
                  return `  - ${bname} · ${p.network} · ${p.scheduledAt?.slice(0, 16)} · ${p.text.slice(0, 80)}`;
                })
                .join("\n")}`
            : "Scheduled content: none in connector data.",
          m.bestPosts.length
            ? `Best performing:\n${m.bestPosts
                .slice(0, 5)
                .map((p) => {
                  const bname = m.activeBrands.find((b) => b.id === p.brandId)?.name || p.brandId;
                  return `  - ${bname} · ${p.network} · likes ${p.metrics.likes ?? 0}, comments ${p.metrics.comments ?? 0}, reach ${p.metrics.reach ?? 0} · ${p.text.slice(0, 60)}`;
                })
                .join("\n")}`
            : "Best performing: none in connector data.",
          m.needsAttention.length
            ? `Needs attention:\n${m.needsAttention.map((n) => `  - ${n.brand}: ${n.reason}`).join("\n")}`
            : "Needs attention: none flagged from connector data.",
        ].join("\n");
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: lines,
          sources: [
            ...brands.slice(0, 5).map((b) => ({ type: "brand", id: b.brand?.name || b.label, label: b.brand?.name || b.label })),
            ...m.activeBrands.slice(0, 5).map((b) => ({ type: "metricool-brand", id: b.id, label: b.name })),
          ],
          action: "brand.status",
          data: { brands, collaborators: collabs, metricool: m },
        };
      }
      if (/\bpricing\b/i.test(text) || /\bmentioned\b/i.test(text)) {
        const topic = /\bpricing\b/i.test(text) ? "pricing" : (route.subject || "pricing");
        const hits = findCustomersMentioning(inWorkspace, topic);
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: hits.length
            ? `Customers mentioning “${topic}” (stored notes/interactions only):\n${hits
                .slice(0, 15)
                .map((h) => `  - ${h.customer}: ${h.excerpt}`)
                .join("\n")}`
            : `No stored CRM text mentions “${topic}”. Log interactions or objections first.`,
          sources: hits.slice(0, 10).map((h) => ({ type: "relationship", id: h.customer, label: h.customer })),
          action: "sales.insight.mentions",
          data: { topic, hits },
        };
      }
      if (/\bstalled\b/i.test(text) || /\bdeals?\b/i.test(text)) {
        const stalled = findStalledDeals(inWorkspace, now);
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: stalled.length
            ? `Stalled / quiet deals (stored CRM):\n${stalled
                .slice(0, 15)
                .map((s) => `  - ${s.customer}: ${s.reason} (last ${s.lastContact.slice(0, 10)})`)
                .join("\n")}`
            : "No stalled deals flagged from stored CRM (open lifecycle + quiet/overdue rules).",
          sources: stalled.slice(0, 10).map((s) => ({ type: "relationship", id: s.customer, label: s.customer })),
          action: "sales.insight.stalled",
          data: { stalled },
        };
      }
      if (/\bask\b.*\bprospect\b/i.test(text) || /\bprepare me for my calls\b/i.test(text)) {
        const due = inWorkspace
          .flatMap((r) =>
            r.followUps
              .filter((f) => f.status === "open")
              .map((f) => ({ r, f })),
          )
          .sort((a, b) => a.f.dueAt.localeCompare(b.f.dueAt))
          .slice(0, 5);
        const lines = due.length
          ? due.map(({ r, f }) => {
              const prep = buildAccountSummary(r);
              return `— ${r.displayName} (due ${f.dueAt.slice(0, 10)}): ${f.reason}\n  Ask about: ${prep.concerns.slice(0, 3).join("; ") || "open goals and next step"}\n  Next: ${prep.nextAction}`;
            })
          : ["No open follow-ups to prepare. Pick a prospect in Sales or create a follow-up."];
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: ["Call prep from stored CRM:", ...lines].join("\n"),
          sources: due.map(({ r }) => ({ type: "relationship", id: r.id, label: r.displayName })),
          action: "sales.insight.prep",
          data: { due: due.map(({ r, f }) => ({ id: r.id, name: r.displayName, due: f.dueAt })) },
        };
      }
      // draft follow-ups → list queue
      const queue = buildWorkQueue(inWorkspace, now);
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: `${queue.text}\n\nTip: name a contact to draft an email (“Draft Jane an email”). AION never sends.`,
        sources,
        action: "sales.insight.queue",
        data: queue,
      };
    }

    if (route.intent === "JOB_WORK") {
      const apps = Array.isArray(state.jobApplications) ? state.jobApplications : [];
      // Create/track a specific application when title + employer are present (before list branch).
      const atMatch =
        text.match(/\btrack(?:ing)?(?:\s+this)?(?:\s+application)?(?:\s+for)?\s+(.+?)\s+at\s+(.+?)(?:\.|$)/i) ||
        text.match(/\bapply for\s+(.+?)\s+at\s+(.+?)(?:\.|$)/i) ||
        text.match(/\bfor\s+(.+?)\s+at\s+(.+?)(?:\.|$)/i);
      if (atMatch) {
        const title = atMatch[1]!.trim().slice(0, 200);
        const employer = atMatch[2]!.trim().replace(/\.$/, "").slice(0, 200);
        if (title && employer && !/^application$/i.test(title)) {
          const app = await this.addJobApplication({ title, employer, source: "assistant" });
          const prepared = await this.prepareJobApplication(app.id);
          sources.push({ type: "job", id: prepared.id, label: `${prepared.title}@${prepared.employer}` });
          return {
            intent: route.intent,
            confidence: route.confidence,
            reply: [
              `Tracked application: ${prepared.title} @ ${prepared.employer} (status: ${prepared.status}).`,
              `Fit score (heuristic from owner knowledge): ${prepared.fitScore ?? "n/a"}`,
              prepared.fitNotes,
              "",
              "Cover letter draft prepared (not sent/submitted):",
              prepared.coverDraft.slice(0, 1200),
              "",
              "External application SUBMISSION is owner-gated. AION will not apply for you.",
            ].join("\n"),
            sources,
            action: "job.track",
            data: prepared,
          };
        }
      }
      if (/\bapplication tracker\b|\blist (my )?applications\b|\bjob applications\b/i.test(text)) {
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: apps.length
            ? `Application tracker (${apps.length}) — none auto-submitted:\n${apps
                .slice(0, 15)
                .map((a) => `  - ${a.title} @ ${a.employer} [${a.status}] fit=${a.fitScore ?? "?"}`)
                .join("\n")}`
            : "No applications tracked yet. Say: track application for <title> at <employer>.",
          sources: apps.slice(0, 10).map((a) => ({ type: "job", id: a.id, label: `${a.title}@${a.employer}` })),
          action: "job.list",
          data: { apps },
        };
      }
      const knowledge = state.ownerKnowledge ?? emptyOwnerKnowledge();
      const skills = (knowledge.facts ?? []).filter((f) => f.category === "skill" && f.enabled).slice(0, 8);
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: [
          "Job / work agent (submission gated):",
          skills.length
            ? `Stored skills for fit scoring: ${skills.map((s) => s.title).join("; ")}`
            : "No skill facts yet — add them under Knowledge for better fit scoring.",
          apps.length ? `Tracked applications: ${apps.length}. Ask “application tracker” to list.` : "No applications tracked.",
          "",
          "Try: track application for Sales Manager at Acme Corp",
          "Or use Career screen for full Career engine commands.",
          "AION prepares drafts and research; you submit applications yourself.",
        ].join("\n"),
        sources,
        action: "job.help",
        data: { appCount: apps.length },
      };
    }

    if (route.intent === "PRODUCT_BUILD") {
      const goal =
        route.subject ||
        text.replace(/\b(make a plan and start|find a product opportunity|build a prototype|create a plan)\b/i, "").trim() ||
        "New product/service opportunity";
      const project = await this.createProject({
        title: goal.slice(0, 120),
        summary: `Owner-requested product/business project via assistant: ${text.slice(0, 500)}`,
      });
      let opportunity = null as Awaited<ReturnType<typeof this.createOpportunity>> | null;
      try {
        opportunity = await this.createOpportunity({
          title: goal.slice(0, 120),
          problem: `Explore: ${goal}`.slice(0, 2000),
          targetCustomer: "To be owner-supplied",
        });
      } catch {
        opportunity = null;
      }
      sources.push({ type: "project", id: project.id, label: project.title });
      if (opportunity) sources.push({ type: "opportunity", id: opportunity.id, label: opportunity.title });
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: [
          `Created project “${project.title}” at stage ${project.stage}.`,
          opportunity ? `Also created Product Studio opportunity “${opportunity.title}” (claims must be owner-supplied; nothing invented as fact).` : "Product opportunity record could not be created (see Studio).",
          "",
          "Next: open Projects to specify/plan; approve implementation stages yourself.",
          "AION will not spend money or publish paid listings without separate authority.",
        ].join("\n"),
        sources,
        action: "product.project",
        data: { project, opportunity },
      };
    }

    if (route.intent === "RESEARCH_COMPANY") {
      const subject = route.subject || text.replace(/^\s*research\b/i, "").trim() || "company research";
      const prior = (state.researchJobs ?? [])
        .filter((j) => j.workspace === workspaceId && j.question.toLowerCase().includes(subject.toLowerCase().slice(0, 40)))
        .slice(0, 3);
      if (prior.length && prior[0]!.state === "complete") {
        const job = prior[0]!;
        sources.push({ type: "research", id: job.id, label: job.question });
        const findings = (job.findings ?? []).slice(0, 8).map((f) => `  - [${f.class}] ${f.statement}`).join("\n");
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: [
            `Stored research for “${job.question}” (state: ${job.state}):`,
            findings || "  (no findings recorded)",
            "",
            "Claims are research findings — not confirmed facts unless owner-promoted.",
            "To re-run: approve/run a new research job from Research screen.",
          ].join("\n"),
          sources,
          action: "research.reuse",
          data: { job },
        };
      }
      const job = await this.proposeResearchJob({
        question: `Research: ${subject}`.slice(0, 2000),
        scope: "public-web",
        limits: { maxSources: 8, maxCostCents: 0 },
      });
      sources.push({ type: "research", id: job.id, label: job.question });
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: [
          `Proposed research job (not run yet): “${job.question}”.`,
          `State: ${job.state}. Approve and run from Research when ready.`,
          this.ports.research
            ? `Provider available: ${this.ports.research.id}.`
            : "No research provider is configured — job is recorded for when one is available.",
          "AION will not invent company facts. Results will cite sources.",
        ].join("\n"),
        sources,
        action: "research.propose",
        data: { job },
      };
    }

    if (route.intent === "CRM_LOOKUP" || route.intent === "ACCOUNT_SUMMARY") {
      const matches = [
        ...findRelationshipsByName(inWorkspace, route.subject),
        ...findRelationshipsByName(inWorkspace, text),
      ].filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i);
      if (!matches.length) {
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: route.subject
            ? `No stored CRM record matched "${route.subject}". You can create a customer with: create a customer for ${route.subject}.`
            : "Say who or which company to look up.",
          sources,
          action: "crm.lookup.empty",
          data: { matches: [] },
        };
      }
      const primary = matches[0]!;
      sources.push({ type: "relationship", id: primary.id, label: primary.displayName });
      const summary = buildAccountSummary(primary);
      const extra =
        matches.length > 1
          ? `\n\nAlso matched: ${matches.slice(1, 5).map((m) => m.displayName).join(", ")}`
          : "";
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: summary.text + extra,
        sources,
        action: "crm.account.summary",
        data: { summary, matches: matches.map((m) => ({ id: m.id, name: m.displayName })) },
      };
    }

    if (route.intent === "DRAFT_EMAIL") {
      const matches = [
        ...findRelationshipsByName(inWorkspace, route.subject),
        ...findRelationshipsByName(inWorkspace, text),
      ].filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i);
      if (!matches.length) {
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: "I need a stored contact/company to draft from. Create or name the customer first.",
          sources,
          action: null,
          data: null,
        };
      }
      const customer = matches[0]!;
      sources.push({ type: "relationship", id: customer.id, label: customer.displayName });
      const draft = await this.createEmailDraft({ relationshipId: customer.id });
      sources.push({ type: "emailDraft", id: draft.id, label: draft.subject });
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: `Email draft (not sent):\nSubject: ${draft.subject}\n\n${draft.body}\n\n— Based on: ${draft.basedOn}`,
        sources,
        action: "crm.email.draft",
        data: draft,
      };
    }

    if (route.intent === "CRM_CREATE") {
      const name = route.subject || "New contact";
      const created = await this.createCustomer({
        displayName: name,
        organisation: name,
        relationshipType: "prospect",
        notes: `Created via assistant: ${text.slice(0, 500)}`,
      });
      sources.push({ type: "relationship", id: created.id, label: created.displayName });
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: `Created CRM record "${created.displayName}" (${created.relationshipType}, ${created.lifecycle}). Reference ${created.reference}.`,
        sources,
        action: "customer.create",
        data: created,
      };
    }

    if (route.intent === "ADD_NOTE" || route.intent === "ADD_INTERACTION") {
      const matches = findRelationshipsByName(inWorkspace, route.subject);
      const customer = matches[0] ?? findRelationshipsByName(inWorkspace, text)[0];
      // "Remember this" / "Save this under X" without a CRM hit → durable owner knowledge.
      if (!customer && (/\bremember this\b/i.test(text) || /\bsave this under\b/i.test(text) || /\bremember that\b/i.test(text))) {
        const under = text.match(/\bsave this under\s+(.+?)(?:\.|$)/i);
        const title = (under?.[1] || route.subject || "Owner note").trim().slice(0, 200);
        const content = text.replace(/^\s*(remember this|remember that|save this under\s+[^.]+\.?)\s*/i, "").trim() || text;
        const fact = await this.addOwnerKnowledgeFact({
          category: under ? "other" : "preference",
          title,
          content: content.slice(0, 20_000) || text.slice(0, 20_000),
          confidence: 85,
          sourceRef: "assistant.remember",
        });
        sources.push({ type: "owner-knowledge", id: fact.id, label: fact.title });
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: `Saved as owner knowledge “${fact.title}” (category: ${fact.category}). Not a CRM note — open Knowledge to correct.`,
          sources,
          action: "owner.knowledge.add",
          data: fact,
        };
      }
      if (!customer) {
        return {
          intent: route.intent,
          confidence: "low",
          reply: "Name the customer/company to attach this note to, or say “remember this: …” to save as owner knowledge.",
          sources,
          action: null,
          data: null,
        };
      }
      const noteText = text.trim();
      const updated = await this.recordCustomerInteraction(customer.id, {
        kind: route.intent === "ADD_INTERACTION" ? "call" : "note",
        summary: noteText.slice(0, 500),
        detail: noteText,
      });
      // Capture objections when language suggests concern
      if (/concern|worried|pricing|delivery|budget/i.test(noteText)) {
        await this.updateCustomer(customer.id, {
          objections: [...new Set([...(customer.objections || []), noteText.slice(0, 300)])],
        });
      }
      sources.push({ type: "relationship", id: updated.id, label: updated.displayName });
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: `Saved to ${updated.displayName}. Timeline now has ${updated.interactions.length} interaction(s).`,
        sources,
        action: "customer.interaction",
        data: { customerId: updated.id },
      };
    }

    if (route.intent === "ADD_TASK") {
      const matches = findRelationshipsByName(inWorkspace, route.subject || text);
      const customer = matches[0];
      const due = new Date(Date.parse(this.ports.clock.now()) + 86400000).toISOString();
      if (customer) {
        const updated = await this.addCustomerFollowUp(customer.id, {
          dueAt: due,
          channel: "email",
          reason: text.slice(0, 500),
        });
        sources.push({ type: "relationship", id: updated.id, label: updated.displayName });
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: `Follow-up task added for ${updated.displayName}, due ${due.slice(0, 10)}.`,
          sources,
          action: "customer.followup",
          data: updated,
        };
      }
      const task = await this.createTask({ title: text.slice(0, 200), description: text });
      sources.push({ type: "task", id: task.id, label: task.title });
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: `Task created: ${task.title}`,
        sources,
        action: "task.create",
        data: task,
      };
    }

    // If the prompt names a known CRM record, answer from stored data before chat fallback.
    const named = findRelationshipsByName(inWorkspace, text);
    if (named.length) {
      const primary = named[0]!;
      sources.push({ type: "relationship", id: primary.id, label: primary.displayName });
      const summary = buildAccountSummary(primary);
      return {
        intent: "ACCOUNT_SUMMARY",
        confidence: "medium",
        reply: summary.text,
        sources,
        action: "crm.account.summary",
        data: { summary },
      };
    }

    // GENERAL_ASSISTANT_QUERY and unmatched phrasing: useful daily briefing + capability guide.
    // Prefer a grounded work queue over a dead-end. Never invent CRM facts.
    const queue = buildWorkQueue(inWorkspace, this.ports.clock.now());
    const openTasks = (state.tasks ?? []).filter(
      (t) => t.workspace === workspaceId && t.state !== "completed" && t.state !== "cancelled",
    );
    const brands = (state.workspaces ?? []).filter((w) => w.kind === "business" && !w.archived && w.brand?.name);
    const docs = (state.crmDocuments ?? []).filter((d) => d.workspace === workspaceId).slice(0, 5);
    const lines = [
      "Here is what I can ground in stored AION data right now:",
      "",
      queue.text,
      "",
      openTasks.length
        ? `Open tasks (${openTasks.length}): ${openTasks.slice(0, 8).map((t) => t.title).join("; ")}`
        : "Open tasks: none recorded.",
      brands.length
        ? `Active brand workspaces: ${brands.map((b) => b.brand?.name || b.label).join(", ")}`
        : "Brand registry: no business brand workspaces yet (create one under Knowledge / Import or workspaces).",
      docs.length
        ? `Recent documents: ${docs.map((d) => d.filename).join(", ")}`
        : "Documents: none in this workspace yet — use Knowledge / Import or attach under Sales.",
      "",
      "You can also ask naturally, for example:",
      "· What should I follow up on? / Who do I need to call?",
      "· What do we know about <name>? / What's going on with <company>?",
      "· Draft <name> an email · Research <company>",
      "· Save this note to <name> · Create a customer for <name>",
      "",
      route.intent === "GENERAL_ASSISTANT_QUERY" || route.confidence === "low"
        ? `I did not match a precise CRM command for: “${text.slice(0, 200)}”. The briefing above is from stored facts only (not model invention).`
        : "",
    ].filter(Boolean);
    return {
      intent: "GENERAL_ASSISTANT_QUERY",
      confidence: route.confidence === "high" ? "medium" : route.confidence,
      reply: lines.join("\n"),
      sources: queue.overdue.slice(0, 5).map((o) => ({
        type: "follow-up",
        id: o.customer,
        label: `${o.customer}: ${o.reason}`,
      })),
      action: "assistant.briefing",
      data: { route, queue, openTaskCount: openTasks.length },
    };
  }
}

function contactEmail(customer: CustomerV1 | null | undefined): string {
  if (!customer) return "";
  const hit = customer.contactMethods.find((c) => c.channel === "email" && c.value);
  return hit?.value ?? "";
}

function findOptional(list: CustomerV1[], id: string | null): CustomerV1 | null {
  if (!id) return null;
  return list.find((c) => c.id === id) ?? null;
}
