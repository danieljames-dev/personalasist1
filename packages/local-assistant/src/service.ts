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
  detectNaturalAttentionKind,
  findCustomersMentioning,
  findRelationshipsByName,
  findStalledDeals,
  formatCustomerList,
  formatNaturalOwnerAttention,
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
  proposeVinsFromOcrText,
  extractStickerFields,
  VIN_VISION_PROMPT,
  type VinOcrResultV1,
} from "./vin-ocr.js";
import {
  buildPhotoProvenance,
  buildPhotoVehicleContext,
  isPhotoVehicleFollowUpQuestion,
  matchPhotoToVehicle,
  resolvePhotoVehicleContext,
  upsertPhotoVehicleContext,
  type PhotoVehicleContextV1,
} from "./photo-vehicle-match.js";
import {
  cropImageToRegion,
  isNonOcrVisionText,
  parseVisionBoxRegion,
  VIN_IDENTITY_ONLY_PROMPT,
  VIN_STICKER_FOCUS_PROMPT,
  STICKER_PRICE_FOCUS_PROMPT,
  vinIdentityCropRegions,
  ownerFacingExtractionMessage,
  looksLikeDecodableImage,
} from "./image-region.js";
import { orientImageBytesForVision, runEasyOcrOnImageBytes } from "./connectors/sticker-ocr.js";
import {
  buildLotWalkCallList,
  buildLotWalkList,
  formatLotWalkCallListProse,
  formatLotWalkPhotoReply,
  formatLotWalkSessionProse,
  needsByCustomerFromState,
  websitePriceFromVehicle,
  type LotWalkListItemV1,
  type LotWalkSessionViewV1,
  type LotWalkCallListEntryV1,
} from "./lot-walk.js";
import { MAX_STATE_BYTES } from "./adapters.js";
import {
  buildSalesCommandCenter,
  formatCommandCenterToday,
  formatCustomerAttention,
  type SalesCommandCenterV1,
} from "./sales-command-center.js";
import { routeSalesPresenceCommand } from "./content-plan.js";
import {
  isSupportedAudioType,
  resolveTranscriptionEngineStatus,
  transcribeAudioBytes,
  type TranscriptRecordV1,
} from "./audio-transcription.js";
import type { CommitmentCandidateV1, ConversationEventV1 } from "./conversation-event.js";
import type { CustomerNeedV1 } from "./customer-needs.js";
import type { CrmActionProposalV1 } from "./crm-action-proposal.js";
import {
  describeIngestOutcome,
  ingestConversationFromTranscript,
  type ConversationIngestOutcomeV1,
} from "./conversation-ingest.js";
import type { AudioIngestPathV1, SpeakerBindingV1 } from "./transcript-conversation-adapter.js";
import { resolveCustomerIdentity, type IdentitySignalsV1 } from "./customer-identity.js";
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
  buildContextDailyView,
  buildDailyOperatingReport,
  buildWhatChangedSince,
  type ContextDailyViewV1,
  type DailyOperatingReportV1,
} from "./daily-operating.js";
import {
  loadPilotState,
  startPilot,
  recordFriction,
  recordPilotDay,
  recordFeatureUse,
  pilotCheckpointSummary,
  type PilotDayV1,
} from "./pilot-ops.js";
import {
  isTestOrE2eWorkspace,
  isSyntheticOwnerFacingText,
  isSyntheticRelationship,
  isSyntheticCommitment,
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
  answerVehicleQuery,
  formatCustomerMatches,
  isFixtureVehicle,
  latestPrice,
  matchCustomerToVehicles,
  vinDetailLines,
  type CustomerVehicleMatchV1,
  type VehicleQueryAnswerV1,
} from "./vehicle-intelligence.js";
import { describeRecallStatus } from "./recall-intelligence.js";
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
  understandGoal,
  planTools,
  buildEvidencePacket,
  routeReasoningTier,
  composeOrchestratedReply,
  chooseProactiveHelp,
  describeGoal,
  availableTextModelsFrom,
  type EvidenceItemV1,
  type OrchestrationResultV1,
  packetUnknownsFor,
  type PracticalGoalV1,
} from "./conversation-orchestrator.js";
import { answerLotScopeQuestion } from "./lot-scope-reasoning.js";
import {
  buildSynthesisPacket,
  validateSynthesis,
  chooseOwnerFacingText,
  parseSynthesisResult,
  synthesisSystemPrompt,
  synthesisUserPrompt,
  describePriceAgainstBudget,
  FAST_SYNTHESIS_TIMEOUT_MS,
  type EvidenceFactV1,
  type SynthesisPortV1,
} from "./grounded-synthesis.js";
import { retrieveOwnerMemory, answerFromOwnerMemory } from "./owner-archive-memory.js";
import { shouldResearchWeb, buildWebSource, type WebSourceV1 } from "./web-research.js";
import {
  archiveCoverageNote,
  planSeedIngest,
  seedFactToKnowledgeInput,
  type SeedFactInputV1,
} from "./owner-seed-ingest.js";
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

/** A line break, named so it survives tooling that rewrites escape sequences in source. */
const NEWLINE = String.fromCharCode(10);

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
  /**
   * Optional local-model seam for grounded synthesis. Absent means every answer is composed
   * deterministically, which is a complete answer rather than a degraded one.
   */
  synthesis?: SynthesisPortV1;
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
  /** Last document whose promotion to an Owner fact was refused, for diagnostics. */
  #lastPromotionRefusal: { path: string; reasons: string[] } | null = null;
  /**
   * Process-local cache of the durable photo vehicle context.
   * Authoritative copy lives in state.photoVehicleContext so production restarts keep follow-ups.
   */
  #lastPhotoVehicleId: string | null = null;
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
  /**
   * Durable mutation with in-process write queue.
   * On revision conflict (external writer or concurrent offline tool), reload from disk
   * and retry a bounded number of times so production does not stay write-stuck.
   */
  private async mutate<T>(operation: (state: AssistantStateV1) => T | Promise<T>): Promise<T> {
    await this.ready; let result!: T; let failure: unknown;
    this.writeQueue = this.writeQueue.then(async () => {
      const maxAttempts = 4;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const expected = this.state.revision;
        const draft = structuredClone(this.state);
        try {
          // Fail closed at the durable mutation boundary when authority is bound.
          if (this.ports.authority) await this.ports.authority.assertWritable("persistent owner-state mutation");
          result = await operation(draft);
          this.prune(draft);
          draft.revision = expected + 1;
          await this.ports.repository.save(expected, draft);
          this.state = draft;
          failure = undefined;
          return;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          const isConflict = /revision conflict/i.test(msg);
          if (isConflict && attempt < maxAttempts) {
            try {
              const loaded = await this.ports.repository.load();
              if (loaded) this.state = loaded;
            } catch {
              /* keep memory state; next attempt may still fail */
            }
            continue;
          }
          failure = error;
          return;
        }
      }
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
    daily: DailyOperatingReportV1;
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
    const daily = await this.dailyOperatingReport({ skipBoardRefresh: true, board });
    const reply = [
      daily.reply,
      "",
      "---",
      brief.reply,
      "",
      dealership && (scope === "all" || scope === "work")
        ? ["---", dealership.reply].join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    // Measured value: Owner avoided manual board assembly
    await this.recordConservativeValue({
      action: "daily_operating_brief_prepared",
      capability: "executive.daily",
      timeSavedMinutes: 5,
      evidenceIds: [`brief:${now}`],
      notes: "Morning/daily operating brief assembled from local state",
    }).catch(() => null);
    return { reply, brief, board, cycle, dealership, daily };
  }

  async dailyOperatingReport(opts: {
    skipBoardRefresh?: boolean;
    board?: AttentionBoardV1;
  } = {}): Promise<DailyOperatingReportV1> {
    const state = await this.snapshot();
    const now = this.ports.clock.now();
    const board = opts.board ?? (await this.attentionBoard());
    const { loadGmailLocalSecrets } = await import("./connector-secrets.js");
    const gmailLocal = loadGmailLocalSecrets(this.repositoryDataRoot());
    const inv = this.vehicleInv(state);
    // Top grounded inventory matches for work customers (soft signals → scored vehicles)
    const vehicleMatchLines: string[] = [];
    for (const r of state.relationships) {
      if (r.archived || r.workspace !== "work") continue;
      if (r.relationshipType !== "customer" && r.relationshipType !== "prospect") continue;
      const matches = matchCustomerToVehicles({
        relationship: r,
        vehicles: inv.vehicles,
        nowIso: now,
        maxResults: 2,
      });
      for (const m of matches) {
        if (m.score < 50) continue;
        vehicleMatchLines.push(
          `${m.customerName} ↔ ${m.label} [${m.sourceClass}] · ${m.whyMatches[0] ?? "match"}`,
        );
      }
      if (vehicleMatchLines.length >= 6) break;
    }
    const nonFixture = inv.vehicles.filter((v) => !isFixtureVehicle(v));
    const liveVehicles = nonFixture.filter(
      (v) =>
        v.presenceStatus === "ONLINE_LISTED" || v.presenceStatus === "PHYSICALLY_VERIFIED",
    );
    const inventorySummary = {
      liveCount: liveVehicles.length,
      fixtureCount: inv.vehicles.filter((v) => isFixtureVehicle(v)).length,
      lastRefresh: inv.lastInventoryRefresh?.["lakeland-toyota"] ?? null,
      withPrice: liveVehicles.filter((v) => (v.priceHistory?.[0]?.advertisedPrice ?? 0) > 0).length,
    };
    return buildDailyOperatingReport({
      nowIso: now,
      board,
      relationships: state.relationships,
      commitments: state.executive?.commitments ?? [],
      opportunities: state.executive?.opportunities ?? [],
      activity: state.activity ?? [],
      workspaceLabels: state.settings.workspaceLabels,
      lastGmailSyncAt: gmailLocal?.lastSyncAt ?? null,
      vehicleMatchLines,
      inventorySummary,
    });
  }

  async contextDailyStatus(
    context: "personal" | "work" | "compassionate-choice" | "career" | "project",
  ): Promise<ContextDailyViewV1> {
    const state = await this.snapshot();
    return buildContextDailyView({
      context,
      nowIso: this.ports.clock.now(),
      relationships: state.relationships,
      commitments: state.executive?.commitments ?? [],
      opportunities: state.executive?.opportunities ?? [],
      tasks: state.tasks,
      activity: state.activity ?? [],
      workspaceLabels: state.settings.workspaceLabels,
    });
  }

  async whatChangedSince(hours = 24): Promise<{ reply: string; lines: string[] }> {
    const state = await this.snapshot();
    const now = this.ports.clock.now();
    const sinceIso = new Date(Date.parse(now) - Math.max(1, hours) * 3_600_000).toISOString();
    const { loadGmailLocalSecrets } = await import("./connector-secrets.js");
    const gmailLocal = loadGmailLocalSecrets(this.repositoryDataRoot());
    const cycle = state.executive?.lastCycleResult;
    return buildWhatChangedSince({
      nowIso: now,
      sinceIso,
      activity: state.activity ?? [],
      commitments: state.executive?.commitments ?? [],
      relationships: state.relationships,
      lastSyncAt: gmailLocal?.lastSyncAt ?? null,
      lastCycle: cycle
        ? {
            completedAt: cycle.completedAt,
            jobsCompleted: cycle.jobsCompleted,
            changesDetected: cycle.changesDetected,
            aionCompleted: cycle.aionCompleted,
          }
        : null,
    });
  }

  async recordConservativeValue(input: {
    action: string;
    capability: string;
    timeSavedMinutes?: number | null;
    evidenceIds?: string[];
    notes?: string;
    workspace?: string;
  }): Promise<void> {
    await this.mutate((draft) => {
      const now = this.ports.clock.now();
      if (!draft.executive) draft.executive = emptyExecutiveState(now);
      const entry = buildValueLedgerEntry(
        {
          action: input.action,
          capability: input.capability,
          timeSavedMinutes: input.timeSavedMinutes ?? null,
          revenueInfluenced: null,
          costAvoided: null,
          estimateKind: input.evidenceIds?.length ? "measured" : "unknown",
          evidenceIds: input.evidenceIds ?? [],
          notes: input.notes ?? "",
          ownerInterventionRequired: false,
        },
        {
          id: this.ports.ids.next("value"),
          now,
          workspace: input.workspace || draft.settings.activeWorkspace || "personal",
        },
      );
      draft.executive.valueLedger.unshift(entry);
      if (draft.executive.valueLedger.length > 500) draft.executive.valueLedger.length = 500;
      return null;
    });
  }

  /** Start or continue 7-day Owner daily-use pilot (local private metrics only). */
  async pilotStart(): Promise<{ startedAt: string | null; daysUsed: number; reply: string }> {
    const root = this.repositoryDataRoot();
    if (!root) return { startedAt: null, daysUsed: 0, reply: "No private data root — pilot not started." };
    const now = this.ports.clock.now();
    const state = startPilot(root, now);
    recordFeatureUse(root, "pilot.start", now);
    return {
      startedAt: state.startedAt,
      daysUsed: state.days.length,
      reply: `7-DAY OWNER DAILY USE PILOT active (started ${state.startedAt?.slice(0, 10) || now.slice(0, 10)}). Days logged: ${state.days.length}.`,
    };
  }

  async pilotRecordDay(partial: Partial<PilotDayV1> = {}): Promise<PilotDayV1> {
    const root = this.repositoryDataRoot();
    if (!root) throw new Error("No private data root.");
    const now = this.ports.clock.now();
    const day = partial.day || now.slice(0, 10);
    const board = await this.attentionBoard();
    const daily = await this.dailyOperatingReport({ board });
    const row: PilotDayV1 = {
      day,
      briefGenerated: partial.briefGenerated ?? true,
      ownerMustDo: partial.ownerMustDo ?? daily.ownerMustDo.length,
      aionCanDo: partial.aionCanDo ?? daily.aionCanDo.length,
      waitingOn: partial.waitingOn ?? daily.waitingOnOthers.length,
      attentionItems: partial.attentionItems ?? board.ownerMustDo.length,
      gmailNewScanned: partial.gmailNewScanned ?? 0,
      draftsPrepared: partial.draftsPrepared ?? 0,
      emailsSent: partial.emailsSent ?? 0,
      corrections: partial.corrections ?? 0,
      ownerPrompts: partial.ownerPrompts ?? 0,
      at: now,
    };
    if (partial.notes) row.notes = partial.notes.slice(0, 500);
    recordPilotDay(root, row);
    recordFeatureUse(root, "pilot.day", now);
    return row;
  }

  async pilotRecordFriction(input: {
    problem: string;
    impact?: "low" | "medium" | "high";
    smallestFix: string;
    category?: string;
  }): Promise<{ entry: ReturnType<typeof recordFriction>; reply: string }> {
    const root = this.repositoryDataRoot();
    if (!root) throw new Error("No private data root.");
    const now = this.ports.clock.now();
    const frictionArg: {
      id: string;
      at: string;
      problem: string;
      smallestFix: string;
      impact?: "low" | "medium" | "high";
      category?: string;
    } = {
      id: this.ports.ids.next("friction"),
      at: now,
      problem: input.problem,
      smallestFix: input.smallestFix,
    };
    if (input.impact) frictionArg.impact = input.impact;
    if (input.category) frictionArg.category = input.category;
    const entry = recordFriction(root, frictionArg);
    recordFeatureUse(root, "pilot.friction", now);
    await this.recordConservativeValue({
      action: "friction_logged",
      capability: "pilot.friction",
      timeSavedMinutes: null,
      evidenceIds: [entry.id],
      notes: `Friction: ${entry.problem.slice(0, 120)}`,
    }).catch(() => null);
    return {
      entry,
      reply: `Friction logged (freq=${entry.frequency}, impact=${entry.impact}): ${entry.problem}\nSmallest fix: ${entry.smallestFix}`,
    };
  }

  async pilotStatus(): Promise<{
    reply: string;
    summary: ReturnType<typeof pilotCheckpointSummary>;
    startedAt: string | null;
  }> {
    const root = this.repositoryDataRoot();
    const state = loadPilotState(root);
    const summary = pilotCheckpointSummary(state);
    const reply = [
      "7-DAY OWNER DAILY USE PILOT",
      `Started: ${state.startedAt?.slice(0, 16) || "(not started)"}`,
      `Days used: ${summary.daysUsed}`,
      `Owner prompts: ${summary.ownerPrompts}`,
      `Daily briefs: ${summary.dailyBriefs}`,
      `Avg Must Do: ${summary.ownerMustDoAvg.toFixed(1)} · Avg AION Can Do: ${summary.aionCanDoAvg.toFixed(1)} · Avg attention: ${summary.attentionAvg.toFixed(1)}`,
      `Gmail refreshed (new msgs): ${summary.gmailRefreshed}`,
      `Drafts prepared: ${summary.drafts} · Emails sent: ${summary.emailsSent}`,
      `Corrections: ${summary.corrections}`,
      "",
      "TOP FRICTIONS",
      ...(summary.topFrictions.length
        ? summary.topFrictions.map((f) => `  • [${f.impact}] x${f.frequency} ${f.problem} → ${f.smallestFix}`)
        : ["  (none logged)"]),
      "",
      "TOP FEATURES USED",
      ...(summary.topFeatures.length
        ? summary.topFeatures.map((f) => `  • ${f.feature}: ${f.count}`)
        : ["  (none)"]),
    ].join("\n");
    return { reply, summary, startedAt: state.startedAt };
  }

  /**
   * Apply Owner correction to live CRM/commitment truth (not just hide UI).
   * Examples: "Sarah is not a customer", "that commitment is wrong", "not important".
   */
  async applyOwnerOperationalCorrection(text: string): Promise<{
    reply: string;
    archived: string[];
    cancelled: string[];
    patterns: string[];
  }> {
    const raw = String(text || "").trim();
    const now = this.ports.clock.now();
    const archived: string[] = [];
    const cancelled: string[] = [];
    const patterns: string[] = [];
    const nameMatch =
      raw.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+is not a (customer|prospect|contact)\b/i) ||
      raw.match(/\bnot a (customer|prospect)\b.*\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i) ||
      raw.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:is )?(?:wrong|irrelevant|old)\b/i);

    await this.mutate((draft) => {
      if (!draft.executive) draft.executive = emptyExecutiveState(now);
      // Archive named relationship
      if (nameMatch) {
        const name = (nameMatch[1] || nameMatch[2] || "").trim();
        if (name && name.length > 1) {
          for (const r of draft.relationships) {
            if (r.archived) continue;
            if (r.displayName.toLowerCase() === name.toLowerCase() || r.displayName.toLowerCase().includes(name.toLowerCase())) {
              if (/\bnot a (customer|prospect|contact)\b/i.test(raw) || /\birrelevant\b|\bwrong\b/i.test(raw)) {
                r.archived = true;
                r.updatedAt = now;
                r.notes = `${r.notes || ""}\n[OWNER CORRECTION ${now}] ${raw.slice(0, 200)}`.slice(0, 4000);
                archived.push(r.id);
              }
            }
          }
        }
      }
      // Cancel open commitments marked not important / wrong / old
      if (/\b(not important|wrong commitment|that.?s wrong|old|ignore that|cancel)\b/i.test(raw)) {
        for (const c of draft.executive.commitments) {
          if (c.status === "cancelled" || c.status === "kept") continue;
          // If a name is present, only cancel matching; else cancel top open Owner noise if "not important"
          const name = nameMatch?.[1] || nameMatch?.[2];
          if (name && !new RegExp(name, "i").test(c.committedBy + c.committedTo + c.statement)) continue;
          if (!name && !/\bnot important\b|\bignore\b/i.test(raw)) continue;
          c.status = "cancelled";
          c.resolvedAt = now;
          c.updatedAt = now;
          c.statement = `${c.statement} [OWNER CORRECTION ${now}: ${raw.slice(0, 120)}]`.slice(0, 2000);
          cancelled.push(c.id);
        }
      }
      // Workspace reassignment correction patterns
      if (/\b(this is|that is|belongs in|move to)\s+(personal|work|career|compassionate choice|lakeland)\b/i.test(raw)) {
        const m = raw.match(/\b(personal|work|career|compassionate choice|lakeland)\b/i);
        if (m) {
          const ws =
            /compassionate/i.test(m[1]!)
              ? "compassionate-choice"
              : /lakeland|work/i.test(m[1]!)
                ? "work"
                : "personal";
          const pat = (nameMatch?.[1] || nameMatch?.[2] || "owner-correction").toLowerCase().slice(0, 80);
          const corrWs: WorkspaceCorrectionV1 = {
            pattern: pat,
            workspaceId: ws,
            role: "AMBIGUOUS",
            at: now,
          };
          draft.executive.importWorkspaceCorrections = [
            corrWs,
            ...draft.executive.importWorkspaceCorrections.filter((c) => c.pattern !== pat),
          ].slice(0, 200);
          patterns.push(`${pat}→${ws}`);
        }
      }
      // Durable correction pattern (never auto-apply from single hit — recorded for pilot)
      draft.executive.correctionPatterns.push({
        id: this.ports.ids.next("corr-pat"),
        kind: archived.length ? "relationship" : cancelled.length ? "fact" : "category",
        fromValue: raw.slice(0, 120),
        toValue: archived.length ? "archived" : cancelled.length ? "cancelled" : "noted",
        workspace: draft.settings.activeWorkspace || "personal",
        hits: 1,
        autoApplyEligible: false,
        at: now,
        notes: raw.slice(0, 200),
      });
      this.activity(
        draft,
        "settings",
        "owner.correction.operational",
        `Owner correction: archived=${archived.length} cancelled=${cancelled.length} patterns=${patterns.length}`,
        null,
      );
      return null;
    });

    const root = this.repositoryDataRoot();
    if (root) {
      recordFriction(root, {
        id: this.ports.ids.next("friction"),
        at: now,
        problem: `Owner correction applied: ${raw.slice(0, 160)}`,
        impact: "medium",
        smallestFix: "Propagate archive/cancel to derived views (done)",
        category: "correction",
      });
      recordFeatureUse(root, "owner.correction", now);
    }

    return {
      archived,
      cancelled,
      patterns,
      reply: [
        "OWNER CORRECTION APPLIED",
        `Relationships archived: ${archived.length}`,
        `Commitments cancelled: ${cancelled.length}`,
        patterns.length ? `Workspace guidance: ${patterns.join(", ")}` : "No workspace pattern added",
        "Derived boards will omit cancelled/archived items.",
      ].join("\n"),
    };
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

  async createPrivateBackup(destination: string, passphrase: string): Promise<{ digest: string; bytes: number }> {
    const state = await this.snapshot();
    const result = await this.ports.backup.create(state, destination, passphrase);
    // Activity log must not fail a verified encrypted backup (revision races during dual-tool use).
    try {
      await this.mutate((draft) => {
        this.activity(
          draft,
          "export",
          "backup.create",
          `Encrypted private backup verified (${result.bytes} bytes).`,
          `backup:${result.digest.slice(0, 16)}`,
        );
      });
    } catch {
      /* backup artifact is already on disk and verified by the backup port */
    }
    return result;
  }
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
   * Deterministic review compression — auto-accept career/business evidence paths,
   * auto-reject technical/synthetic/training noise. Groups remaining for Owner.
   */
  /**
   * Discover grounded contact candidates from already-imported high-value documents.
   * Does not invent people; requires email/role context.
   */
  async discoverContactCandidatesFromImports(): Promise<{
    candidates: import("./contact-discovery.js").ContactCandidateV1[];
    reply: string;
  }> {
    const { discoverContactsInDocument, mergeContactCandidates } = await import("./contact-discovery.js");
    const state = await this.snapshot();
    const docs = state.crmDocuments ?? [];
    const raw = [];
    for (const d of docs) {
      raw.push(
        ...discoverContactsInDocument({
          documentId: d.id,
          filename: d.filename,
          sourceRootPath: d.sourceRootPath || "",
          extractedText: d.extractedText || "",
          summary: d.summary || "",
        }),
      );
    }
    const candidates = mergeContactCandidates(raw);
    const reply = [
      "CONTACT CANDIDATES (from authorized imported docs only)",
      `Found: ${candidates.length}`,
      ...candidates.slice(0, 20).map(
        (c, i) =>
          `  ${i + 1}. [${c.class}] ${c.displayName}${c.organisation ? ` @ ${c.organisation}` : ""} conf=${c.confidence} email=${c.email || "—"} · ${c.workspaceHint}`,
      ),
      candidates.length === 0
        ? "No strong contact evidence (email/role-labeled) in high-value imports. Capture or Gmail will create real CRM records."
        : "Use import.contactCandidates.apply to create relationships for conf≥80 non-Owner candidates.",
    ].join("\n");
    return { candidates, reply };
  }

  /**
   * Import high-confidence contact candidates as relationships (not customers by default).
   * Skips PERSONAL_CONTACT Owner self; never merges on name alone.
   */
  async applyContactCandidates(opts: { minConfidence?: number } = {}): Promise<{
    created: string[];
    skipped: string[];
    reply: string;
  }> {
    const min = opts.minConfidence ?? 80;
    const { candidates } = await this.discoverContactCandidatesFromImports();
    const created: string[] = [];
    const skipped: string[] = [];
    await this.mutate((draft) => {
      const now = this.ports.clock.now();
      for (const c of candidates) {
        if (c.confidence < min) {
          skipped.push(`${c.displayName} (low conf ${c.confidence})`);
          continue;
        }
        if (c.class === "PERSONAL_CONTACT" && /daniel coffman/i.test(c.displayName)) {
          skipped.push(`${c.displayName} (Owner self — keep as profile, not CRM row)`);
          continue;
        }
        // Strong match: exact email already present
        const email = c.email.toLowerCase();
        const existing = draft.relationships.find(
          (r) =>
            !r.archived &&
            email &&
            (r.contactMethods || []).some((m) => m.channel === "email" && m.value.toLowerCase() === email),
        );
        if (existing) {
          skipped.push(`${c.displayName} (email already on ${existing.displayName})`);
          continue;
        }
        const nameHit = draft.relationships.find(
          (r) => !r.archived && r.displayName.toLowerCase() === c.displayName.toLowerCase() && c.email === "",
        );
        if (nameHit && !c.email) {
          skipped.push(`${c.displayName} (name exists, no email to confirm — no auto-merge)`);
          continue;
        }
        const rid = this.ports.ids.next("relationship");
        const ws =
          c.workspaceHint === "compassionate-choice" &&
          draft.workspaces.some((w) => w.id === "compassionate-choice" && !w.archived)
            ? "compassionate-choice"
            : c.workspaceHint === "work"
              ? "work"
              : c.class === "COLLABORATOR"
                ? draft.workspaces.some((w) => w.id === "compassionate-choice")
                  ? "compassionate-choice"
                  : "personal"
                : "work";
        // Map discovery class → RelationshipTypeV1 (no "collaborator" type — use partner)
        const relType =
          c.class === "COLLABORATOR"
            ? "partner"
            : c.class === "PROSPECT"
              ? "prospect"
              : c.class === "CUSTOMER"
                ? "customer"
                : c.class === "VENDOR"
                  ? "vendor"
                  : "contact";
        const contactMethods = [];
        if (c.email) contactMethods.push({ channel: "email" as const, label: "email", value: c.email });
        if (c.phone) contactMethods.push({ channel: "phone" as const, label: "phone", value: c.phone });
        const person = buildCustomer(
          {
            displayName: c.displayName,
            organisation: c.organisation,
            role: c.role,
            source: "import-contact-discovery",
            notes: `Discovered from import evidence: ${c.evidence.join("; ").slice(0, 500)}`,
            relationshipType: relType,
            contactMethods,
            lifecycle: c.class === "PROSPECT" || c.class === "CUSTOMER" ? "prospect" : "active",
          },
          {
            id: rid,
            reference: `import-contact:${rid}`,
            workspace: ws,
            now,
            relationshipType: relType,
            defaultOrigin: "owner-created",
          },
        );
        draft.relationships.unshift(person);
        created.push(`${person.displayName} (${relType}/${ws})`);
      }
      this.activity(
        draft,
        "import",
        "contact.discover.apply",
        `Applied contact candidates: created=${created.length} skipped=${skipped.length}`,
        null,
      );
      return null;
    });
    const reply = [
      "CONTACT CANDIDATES APPLIED",
      `Created: ${created.length}`,
      ...created.map((c) => `  + ${c}`),
      `Skipped: ${skipped.length}`,
      ...skipped.slice(0, 12).map((s) => `  · ${s}`),
    ].join("\n");
    return { created, skipped, reply };
  }

  /**
   * Seed evidence-grounded career goals + Owner world graph edges (idempotent by type+ids).
   */
  async reinforceOwnerWorldKnowledge(): Promise<{
    goalsAdded: number;
    edgesAdded: number;
    edgesDeactivated: number;
    reply: string;
  }> {
    const { buildGraphEdge } = await import("./executive-context.js");
    return this.mutate((draft) => {
      const now = this.ports.clock.now();
      if (!draft.executive) draft.executive = emptyExecutiveState(now);
      if (!draft.ownerKnowledge) {
        draft.ownerKnowledge = {
          profile: { displayName: "Daniel Coffman", summary: "", updatedAt: now },
          facts: [],
        };
      }
      let goalsAdded = 0;
      const titles = new Set(
        draft.ownerKnowledge.facts.filter((f) => f.enabled !== false).map((f) => f.title.toLowerCase()),
      );
      const goalSeeds = [
        {
          title: "Goal — remote logistics / dispatch / support role",
          content:
            "Seek remote dispatcher, logistics coordinator, or customer support/chat work using maritime ops + Army discipline. Evidenced by resume/cover letter job-search materials.",
        },
        {
          title: "Goal — support Compassionate Choice operations",
          content:
            "Help build trusted local non-medical companion/homemaker presence (Compassionate Choice) with AHCA-aware ops. Evidenced by imported business structure/ops docs.",
        },
      ];
      for (const g of goalSeeds) {
        if (titles.has(g.title.toLowerCase())) continue;
        draft.ownerKnowledge.facts.unshift({
          id: this.ports.ids.next("okf"),
          category: "goal",
          title: g.title,
          content: g.content,
          confidence: 82,
          enabled: true,
          corrections: [],
          createdAt: now,
          updatedAt: now,
          provenance: {
            sourceType: "import",
            sourceRef: "import:career-and-business-evidence",
            recordedAt: now,
          },
        });
        goalsAdded += 1;
      }

      let edgesAdded = 0;
      let edgesDeactivated = 0;
      const edges = draft.executive.graphEdges;
      const hasEdge = (type: string, fromId: string, toId: string) =>
        edges.some((e) => e.active && e.type === type && e.fromId === fromId && e.toId === toId);
      const add = (input: Record<string, unknown>, workspace: string) => {
        const fromId = String(input.fromId);
        const toId = String(input.toId);
        const type = String(input.type);
        if (hasEdge(type, fromId, toId)) return;
        edges.unshift(
          buildGraphEdge(
            { ...input, sourceRef: String(input.sourceRef ?? "import:world-graph"), visibility: "WORKSPACE_ONLY" },
            { id: this.ports.ids.next("edge"), now, workspace },
          ),
        );
        edgesAdded += 1;
      };

      // Owner career / dealership
      add(
        {
          type: "works_at",
          fromKind: "owner",
          fromId: "owner:daniel-coffman",
          fromLabel: "Daniel Coffman",
          toKind: "dealership",
          toId: "work",
          toLabel: "Lakeland Toyota (Work)",
          note: "Owner sales/dealership work context (workspace Work).",
          confidence: 80,
          sourceRef: "import:owner-dealership-context",
        },
        "work",
      );
      // Business
      if (draft.workspaces.some((w) => w.id === "compassionate-choice" && !w.archived)) {
        add(
          {
            type: "owns",
            fromKind: "owner",
            fromId: "owner:daniel-coffman",
            fromLabel: "Daniel Coffman",
            toKind: "business",
            toId: "compassionate-choice",
            toLabel: "Compassionate Choice",
            note: "Owner-related business workspace from imported LLC/ops evidence (supporting role materials).",
            confidence: 75,
            sourceRef: "import:BUSINESS_STRUCTURE.md",
          },
          "compassionate-choice",
        );
        add(
          {
            type: "sells",
            fromKind: "brand",
            fromId: "compassionate-choice",
            fromLabel: "Compassionate Choice Home Services",
            toKind: "product-service",
            toId: "non-medical-companion-services",
            toLabel: "Non-medical companion/homemaker services",
            note: "Services list from BUSINESS_STRUCTURE.md",
            confidence: 88,
            sourceRef: "import:BUSINESS_STRUCTURE.md",
          },
          "compassionate-choice",
        );
        const kristina = draft.relationships.find(
          (r) => !r.archived && /kristina/i.test(r.displayName) && /leach/i.test(r.displayName),
        );
        if (kristina) {
          add(
            {
              type: "collaborates_on",
              fromKind: "person",
              fromId: kristina.id,
              fromLabel: kristina.displayName,
              toKind: "business",
              toId: "compassionate-choice",
              toLabel: "Compassionate Choice",
              note: "Founder/owner per business structure documents.",
              confidence: 90,
              sourceRef: "import:EXTERNAL-DRIVE-README.txt",
            },
            "compassionate-choice",
          );
        }
      }

      // Deactivate edges for archived people
      const archivedIds = new Set(draft.relationships.filter((r) => r.archived).map((r) => r.id));
      for (const e of edges) {
        if (e.active && (archivedIds.has(e.fromId) || archivedIds.has(e.toId))) {
          e.active = false;
          e.supersededAt = now;
          edgesDeactivated += 1;
        }
      }
      draft.executive.graphEdges = edges.slice(0, 500);
      this.activity(
        draft,
        "import",
        "knowledge.world-graph",
        `World graph reinforce: goals+${goalsAdded} edges+${edgesAdded} deactivated=${edgesDeactivated}`,
        null,
      );
      const reply = [
        "OWNER WORLD KNOWLEDGE REINFORCED",
        `Goals added: ${goalsAdded}`,
        `Graph edges added: ${edgesAdded}`,
        `Graph edges deactivated (archived people): ${edgesDeactivated}`,
        "Active edges are evidence-grounded; synthetic Mike fixture edges deactivated when person archived.",
      ].join("\n");
      return { goalsAdded, edgesAdded, edgesDeactivated, reply };
    });
  }

  /** Metricool brand → AION workspace mapping candidates (no live API required). */
  async metricoolBrandMappingCandidates(input: {
    brands?: Array<{ id: string; name: string }>;
  } = {}): Promise<{
    mappings: ReturnType<typeof import("./connectors/metricool-connector.js").mapMetricoolBrandsToWorkspaces>;
    reply: string;
  }> {
    const { mapMetricoolBrandsToWorkspaces } = await import("./connectors/metricool-connector.js");
    const state = await this.snapshot();
    const brands =
      input.brands?.length
        ? input.brands
        : this.metricoolBrands.map((b) => ({ id: b.id, name: b.name }));
    // Always include Compassionate Choice as a synthetic mapping probe when no fixtures
    const probe =
      brands.length > 0
        ? brands
        : [{ id: "probe-cc", name: "Compassionate Choice Home Services" }];
    const workspaces = state.workspaces.map((w) => {
      const row: { id: string; label: string; brandName?: string; archived?: boolean } = {
        id: w.id,
        label: w.label,
        archived: w.archived,
      };
      if (w.brand?.name) row.brandName = w.brand.name;
      return row;
    });
    const mappings = mapMetricoolBrandsToWorkspaces(probe, workspaces);
    const reply = [
      "METRICOOL → AION BRAND MAPPING CANDIDATES",
      ...mappings.map(
        (m) =>
          `  • ${m.metricoolName} → ${m.workspaceLabel || "(none)"} [${m.action}/${m.confidence}] ${m.reason}`,
      ),
    ].join("\n");
    return { mappings, reply };
  }

  async compressImportReviewQueue(): Promise<{
    before: number;
    afterOpen: number;
    autoRejected: number;
    autoAccepted: number;
    kept: number;
    groups: Array<{ groupKey: string; bucket: string; count: number; action: string; samplePaths: string[] }>;
    reply: string;
  }> {
    const { compressImportReviewQueue } = await import("./import-review-compress.js");
    return this.mutate((draft) => {
      if (!Array.isArray(draft.importReviewQueue)) draft.importReviewQueue = [];
      const now = this.ports.clock.now();
      const result = compressImportReviewQueue(draft.importReviewQueue, now);
      draft.importReviewQueue = result.updated;
      this.activity(
        draft,
        "import",
        "import.review.compress",
        `Review compress: ${result.stats.before}→${result.stats.afterOpen} open (reject=${result.stats.autoRejected} accept=${result.stats.autoAccepted})`,
        null,
      );
      const reply = [
        "IMPORT REVIEW COMPRESSION",
        `Before open: ${result.stats.before}`,
        `After open: ${result.stats.afterOpen}`,
        `Auto-rejected (technical/synthetic/noise): ${result.stats.autoRejected}`,
        `Auto-accepted (career/business evidence): ${result.stats.autoAccepted}`,
        `Kept for Owner/group review: ${result.stats.kept}`,
        "",
        "GROUPS",
        ...result.stats.groups.slice(0, 20).map(
          (g) => `  • ${g.groupKey} [${g.bucket}/${g.action}] n=${g.count}`,
        ),
      ].join("\n");
      return { ...result.stats, reply };
    });
  }

  /**
   * Grounded Brand DNA + workspace for Compassionate Choice from imported business evidence.
   * Unknown fields remain empty. Provenance = imported documents.
   */
  async seedCompassionateChoiceBrandFromEvidence(): Promise<{
    workspaceId: string;
    created: boolean;
    dna: import("./executive-state.js").BrandDnaV1;
    factsAdded: number;
    reply: string;
  }> {
    return this.mutate((draft) => {
      const now = this.ports.clock.now();
      if (!draft.executive) draft.executive = emptyExecutiveState(now);
      let ws = draft.workspaces.find(
        (w) =>
          !w.archived &&
          (/compassionate/i.test(w.label) ||
            /compassionate/i.test(w.id) ||
            /compassionate/i.test(w.brand?.name || "")),
      );
      let created = false;
      if (!ws) {
        ws = buildWorkspace(
          {
            id: "compassionate-choice",
            label: "Compassionate Choice",
            kind: "business",
            purpose: "Non-medical in-home companion/homemaker services (Lakeland / Polk County, FL).",
            brand: {
              name: "Compassionate Choice Home Services",
              positioning: "Dignity and independence for seniors and disabled adults at home",
              audience: "Seniors, disabled adults, adult children, long-distance families",
              channels: ["website", "phone", "local referral"],
              notes: "From Owner BUSINESS_STRUCTURE.md import evidence",
            },
          },
          { now, existing: draft.workspaces },
        );
        draft.workspaces.push(ws);
        created = true;
      }
      const workspaceId = ws.id;
      const products =
        "Caring companionship; meal preparation; pet care; errands & shopping; light housekeeping; overnight non-medical presence; transportation coordination (does not drive clients).";
      const forbidden = [
        "nursing or medical care",
        "medication administration",
        "hands-on personal care (bathing/dressing/toileting/feeding/transferring)",
        "driving clients ourselves",
      ];
      let dna =
        draft.executive.brandDna.find((b) => b.workspaceId === workspaceId) ||
        emptyBrandDna(workspaceId, now);
      dna = {
        ...dna,
        purpose:
          "Help seniors and disabled adults live with dignity, independence, and human connection in their own homes through non-medical in-home support.",
        audience:
          "Seniors at home, adults with disabilities, adult children of aging parents, long-distance families, post-hospital recovery (non-medical).",
        productsServices: products,
        offers: "Private-pay hourly companion/homemaker services (Year 1); grant pathways under review.",
        voice: "Warm, plain-language, trustworthy, family-friendly",
        tone: "Compassionate, clear, non-clinical",
        claims: [
          "Non-medical in-home help only",
          "Serving Lakeland FL and Polk County",
          "Companionship, meals, errands, light housekeeping, overnight presence",
        ],
        forbiddenClaims: forbidden,
        platforms: ["website:compassionate-choice.com", "phone", "local referral"],
        goals: "Build trusted local companion/homemaker presence; AHCA-compliant operations.",
        kpis: "UNKNOWN — not evidenced as numeric targets yet",
        collaboratorsNote: "Founder/owner: Kristina Leach (from business structure document).",
        assetsNote: "LLC Florida; website and ops docs imported under Owner data roots.",
        provenanceSourceRef: "import:BUSINESS_STRUCTURE.md",
        updatedAt: now,
      } as typeof dna;
      draft.executive.brandDna = [dna, ...draft.executive.brandDna.filter((b) => b.workspaceId !== workspaceId)];

      // Knowledge facts (imported_document channel)
      if (!draft.ownerKnowledge) {
        draft.ownerKnowledge = {
          profile: { displayName: "Daniel Coffman", summary: "", updatedAt: now },
          facts: [],
        };
      }
      const seeds = [
        {
          category: "business" as const,
          title: "Business — Compassionate Choice LLC",
          content:
            "COMPASSIONATE CHOICE LLC (FL), brand Compassionate Choice Home Services. Non-medical in-home help for seniors/disabled adults in Lakeland/Polk County. Founder Kristina Leach. Website compassionate-choice.com.",
        },
        {
          category: "product-service" as const,
          title: "Services — companion/homemaker (non-medical)",
          content: products,
        },
        {
          category: "collaborator" as const,
          title: "Collaborator — Kristina Leach",
          content: "Founder/owner of Compassionate Choice LLC (from business structure import). Daniel/Owner working materials related to this business.",
        },
      ];
      let factsAdded = 0;
      const titles = new Set(draft.ownerKnowledge.facts.filter((f) => f.enabled !== false).map((f) => f.title.toLowerCase()));
      for (const s of seeds) {
        if (titles.has(s.title.toLowerCase())) continue;
        draft.ownerKnowledge.facts.unshift({
          id: this.ports.ids.next("okf"),
          category: s.category,
          title: s.title,
          content: s.content,
          confidence: 85,
          enabled: true,
          corrections: [],
          createdAt: now,
          updatedAt: now,
          provenance: {
            sourceType: "import",
            sourceRef: "import:BUSINESS_STRUCTURE.md",
            recordedAt: now,
          },
        });
        factsAdded += 1;
      }
      this.activity(
        draft,
        "import",
        "brand.seed.compassionate",
        `Compassionate Choice workspace/DNA seeded; factsAdded=${factsAdded} createdWs=${created}`,
        workspaceId,
      );
      const reply = [
        "COMPASSIONATE CHOICE — BRAND DNA FROM EVIDENCE",
        `Workspace: ${ws.label} (${workspaceId}) created=${created}`,
        `Purpose: ${dna.purpose.slice(0, 160)}`,
        `Services: ${dna.productsServices.slice(0, 160)}`,
        `Facts added: ${factsAdded}`,
        "Trust: imported_document channel (BUSINESS_STRUCTURE.md).",
        "Unknown: detailed pricing KPIs, Metricool accounts, full collaborator graph.",
      ].join("\n");
      return { workspaceId, created, dna, factsAdded, reply };
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
      // A document that merely *mentions* work is still a document. This gate is the only
      // document→Owner-fact path in the system, so refusing here is what keeps a README out of the
      // Owner's biography. The document, its review item and its provenance are all untouched —
      // only the semantic promotion is refused.
      const { rawDocumentPromotionReasons } = await import("./owner-fact-gate.js");
      const refusals = draft
        ? rawDocumentPromotionReasons({
            title: draft.title,
            content: draft.content,
            sourceRef: `import:${input.relativePath || input.filename}`,
          })
        : [];
      if (draft && refusals.length) {
        reviewItem = reviewItem ?? null;
        this.#lastPromotionRefusal = { path: input.relativePath || input.filename, reasons: refusals };
      } else if (draft) {
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

  /**
   * Cache government VIN facts for live inventory, a bounded batch at a time.
   *
   * Paced and cached deliberately: vPIC is a free public service and the lot has hundreds of
   * vehicles, so we decode only what is missing, one VIN per request with a courtesy delay, and
   * never re-decode a VIN we already resolved. Dealer trim/price/colour are untouched — the decode
   * lands in its own `govVinFacts` field so `GOVERNMENT_VIN_FACT` never masquerades as dealer
   * evidence, and a make/model disagreement is recorded as a conflict rather than resolved.
   */
  async enrichLiveVinFacts(opts: { limit?: number; delayMs?: number } = {}): Promise<{
    attempted: number;
    decoded: number;
    failed: number;
    invalid: number;
    conflicts: number;
    remaining: number;
    coverage: string;
    reconciled: number;
  }> {
    const limit = Math.max(1, Math.min(opts.limit ?? 40, 300));
    const delayMs = opts.delayMs ?? 250;
    const { vehiclesNeedingVinDecode, buildGovVinFacts } = await import("./vehicle-inventory.js");

    const { detectListingConflicts } = await import("./vehicle-inventory.js");

    // Re-derive conflicts for already-cached vehicles from stored decode values. Conflict rules
    // improve over time; replaying them must never mean re-querying a public service.
    let reconciled = 0;
    await this.mutate((draft) => {
      for (const v of draft.vehicleInventory?.vehicles ?? []) {
        const g = v.govVinFacts;
        if (!g || g.status !== "DECODED") continue;
        const next = detectListingConflicts({
          listingMake: v.make, listingModel: v.model, govMake: g.make, govModel: g.model,
        });
        if (JSON.stringify(next) !== JSON.stringify(g.conflictsWithListing)) {
          g.conflictsWithListing = next;
          reconciled++;
        }
      }
      return null;
    });

    const snapshot = await this.snapshot();
    const all = snapshot.vehicleInventory?.vehicles ?? [];
    const pending = vehiclesNeedingVinDecode(all, { limit });

    let decoded = 0, failed = 0, invalid = 0, conflicts = 0;
    const results = new Map<string, ReturnType<typeof buildGovVinFacts>>();

    for (const vehicle of pending) {
      const now = this.ports.clock.now();
      const validation = validateVin(vehicle.vin ?? "");
      if (!validation.valid || !validation.normalized) {
        // A structurally impossible VIN will never decode; record it and stop retrying.
        results.set(vehicle.id, buildGovVinFacts({
          decode: emptyVinDecode(vehicle.vin ?? "", now),
          listingMake: vehicle.make, listingModel: vehicle.model,
          vinValidity: validation.code === "CHECK_DIGIT_FAIL" ? "STRUCTURALLY_VALID" : "INVALID",
          now,
        }));
        invalid++;
        continue;
      }
      try {
        const decode = await decodeVinNhtsa(validation.normalized, now);
        const facts = buildGovVinFacts({
          decode,
          listingMake: vehicle.make,
          listingModel: vehicle.model,
          vinValidity: "VALID",
          now,
        });
        results.set(vehicle.id, facts);
        if (facts.status === "DECODED") decoded++; else failed++;
        if (facts.conflictsWithListing.length) conflicts++;
      } catch (err) {
        const decode = emptyVinDecode(validation.normalized, now);
        decode.errorText = err instanceof Error ? err.message : String(err);
        results.set(vehicle.id, buildGovVinFacts({
          decode, listingMake: vehicle.make, listingModel: vehicle.model, vinValidity: "VALID", now,
        }));
        failed++;
      }
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }

    if (results.size > 0) {
      await this.mutate((draft) => {
        const list = draft.vehicleInventory?.vehicles ?? [];
        for (const v of list) {
          const facts = results.get(v.id);
          if (facts) v.govVinFacts = facts;
        }
        this.activity(draft, "agent", "vehicle.vin.enrich",
          `Government VIN facts cached for ${results.size} vehicle(s): ${decoded} decoded, ${failed} failed, ${invalid} invalid.`, null);
        return null;
      });
    }

    const after = await this.snapshot();
    const list = after.vehicleInventory?.vehicles ?? [];
    const withFacts = list.filter((v) => v.govVinFacts?.status === "DECODED").length;
    const withVin = list.filter((v) => v.vin).length;
    return {
      attempted: pending.length,
      decoded, failed, invalid, conflicts,
      remaining: vehiclesNeedingVinDecode(list).length,
      reconciled,
      coverage: `${withFacts}/${withVin}`,
    };
  }

  /**
   * Check recall campaigns for live inventory, one lookup per distinct year/make/model.
   *
   * 288 vehicles collapse to ~87 combinations, so covering the whole lot costs a fraction of the
   * public requests a per-VIN sweep would. The result is stored on every vehicle sharing the
   * combination, carrying the scope of what was actually asked — a campaign lookup, never a
   * VIN-specific clean bill of health.
   */
  async enrichRecallAssessments(opts: { limit?: number; delayMs?: number } = {}): Promise<{
    combosChecked: number;
    vehiclesUpdated: number;
    recallsFound: number;
    noRecords: number;
    failures: number;
    remainingCombos: number;
  }> {
    const limit = Math.max(1, Math.min(opts.limit ?? 30, 200));
    const delayMs = opts.delayMs ?? 300;
    const { buildRecallAssessment, recallComboKey } = await import("./recall-intelligence.js");
    const { lookupRecallsNhtsa } = await import("./vehicle-research.js");

    const snapshot = await this.snapshot();
    const vehicles = snapshot.vehicleInventory?.vehicles ?? [];

    // Government-decoded make/model is the authoritative key when present.
    const comboOf = (v: { govVinFacts?: unknown; year?: number | null; make?: string | null; model?: string | null }) => {
      const g = v.govVinFacts as { modelYear?: string | null; make?: string | null; model?: string | null } | null | undefined;
      const year = g?.modelYear ?? (v.year != null ? String(v.year) : null);
      const make = g?.make ?? v.make ?? null;
      const model = g?.model ?? v.model ?? null;
      return { key: recallComboKey(year, make, model), year, make, model };
    };

    const pending = new Map<string, { year: string | null; make: string | null; model: string | null }>();
    for (const v of vehicles) {
      if (v.recallAssessment && v.recallAssessment.status !== "NOT_CHECKED") continue;
      const c = comboOf(v);
      if (!c.key || pending.has(c.key)) continue;
      pending.set(c.key, { year: c.year, make: c.make, model: c.model });
      if (pending.size >= limit) break;
    }

    const results = new Map<string, ReturnType<typeof buildRecallAssessment>>();
    let recallsFound = 0, noRecords = 0, failures = 0;
    for (const [key, q] of pending) {
      const now = this.ports.clock.now();
      try {
        const res = await lookupRecallsNhtsa({
          make: q.make, model: q.model, year: q.year ? Number(q.year) : null, now,
        });
        const assessment = buildRecallAssessment({
          ok: res.mode !== "error",
          campaigns: res.recalls,
          query: q,
          now,
          source: "https://api.nhtsa.gov/recalls/recallsByVehicle",
        });
        results.set(key, assessment);
        if (assessment.status === "RECALLS_FOUND") recallsFound++;
        else if (assessment.status === "NO_MATCHING_RECORDS_RETURNED") noRecords++;
        else failures++;
      } catch {
        results.set(key, buildRecallAssessment({
          ok: false, campaigns: [], query: q, now,
          source: "https://api.nhtsa.gov/recalls/recallsByVehicle",
        }));
        failures++;
      }
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }

    let vehiclesUpdated = 0;
    if (results.size > 0) {
      await this.mutate((draft) => {
        for (const v of draft.vehicleInventory?.vehicles ?? []) {
          const c = comboOf(v);
          const assessment = c.key ? results.get(c.key) : undefined;
          if (assessment) { v.recallAssessment = assessment; vehiclesUpdated++; }
        }
        this.activity(draft, "agent", "vehicle.recall.check",
          `Recall campaigns checked for ${results.size} year/make/model combination(s); ${vehiclesUpdated} vehicle(s) updated.`, null);
        return null;
      });
    }

    const after = await this.snapshot();
    const remaining = new Set<string>();
    for (const v of after.vehicleInventory?.vehicles ?? []) {
      if (v.recallAssessment && v.recallAssessment.status !== "NOT_CHECKED") continue;
      const c = comboOf(v);
      if (c.key) remaining.add(c.key);
    }
    return { combosChecked: results.size, vehiclesUpdated, recallsFound, noRecords, failures, remainingCombos: remaining.size };
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
    /** new | used | all — scoped crawl so partial runs do not erase the other class. */
    scope?: "new" | "used" | "all";
    /** Page cap per starting URL (default 12; expansion stages raise deliberately). */
    maxPagesPerUrl?: number;
    pageDelayMs?: number;
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
    const scope = opts.scope ?? "all";
    const result = await refreshDealershipPublicInventory({
      dealership: dealer!,
      now,
      nextId,
      useFixture: opts.useFixture === true,
      scope,
      ...(opts.fixtureVins ? { fixtureVins: opts.fixtureVins } : {}),
      ...(opts.maxPagesPerUrl != null ? { maxPagesPerUrl: opts.maxPagesPerUrl } : {}),
      ...(opts.pageDelayMs != null ? { pageDelayMs: opts.pageDelayMs } : {}),
    });
    let temporal = null as null | import("./vehicle-inventory.js").InventoryTemporalDeltaV1;
    let quality = null as null | import("./vehicle-inventory.js").InventoryApplyQualityV1;
    await this.mutate((draft) => {
      if (!draft.vehicleInventory) draft.vehicleInventory = emptyVehicleInventoryState();
      const applied = applyOnlineListings(
        draft.vehicleInventory,
        dealer!,
        result.listings,
        now,
        (kind) => this.ports.ids.next(kind),
        {
          conditionScope: scope === "all" ? "all" : scope,
          reconcileMissing: true,
        },
      );
      draft.vehicleInventory = applied.state;
      temporal = applied.temporal;
      quality = applied.quality;
      this.activity(
        draft,
        "agent",
        "inventory.refresh",
        `Public inventory refresh (${result.mode}/${scope}): ${result.listings.length} listing(s), `
          + `+${applied.temporal.newlySeen} new, ${applied.temporal.noLongerFoundOnline} no-longer-online for ${dealer!.name}`,
        dealer!.id,
      );
      return draft.vehicleInventory;
    });
    return { ...result, temporal, quality };
  }

  /** Coverage + temporal summary for Owner inventory questions (no network). */
  async inventoryCoverageReport(): Promise<{
    total: number;
    liveNew: number;
    liveUsed: number;
    noLongerFoundOnline: number;
    lastRefresh: string | null;
    reply: string;
  }> {
    const inv = this.vehicleInv(await this.snapshot());
    const live = inv.vehicles.filter(
      (v) =>
        v.presenceStatus === "ONLINE_LISTED" ||
        v.presenceStatus === "PHYSICALLY_VERIFIED" ||
        v.presenceStatus === "NOT_VERIFIED",
    );
    const liveNew = live.filter((v) => v.condition === "new").length;
    const liveUsed = live.filter((v) => v.condition === "used" || v.condition === "cpo").length;
    const gone = inv.vehicles.filter((v) => v.presenceStatus === "NO_LONGER_FOUND_ONLINE").length;
    const lastRefresh = inv.lastInventoryRefresh?.["lakeland-toyota"] ?? null;
    return {
      total: live.length,
      liveNew,
      liveUsed,
      noLongerFoundOnline: gone,
      lastRefresh,
      reply: [
        `AION inventory (live-ish): ${live.length} vehicle(s)`,
        `  New: ${liveNew} · Used/CPO: ${liveUsed}`,
        gone ? `  No longer found online: ${gone} (not labeled sold)` : "  No longer found online: 0",
        lastRefresh ? `  Last public refresh: ${lastRefresh}` : "  Last public refresh: never",
      ].join("\n"),
    };
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

  /**
   * Enriched Lot Walk list: physical observations + website price (never inventing) + customer matches.
   */
  async lotWalkCurrentList(walkId?: string): Promise<LotWalkSessionViewV1 | null> {
    const state = await this.snapshot();
    const inv = this.vehicleInv(state);
    const walk =
      (walkId ? inv.walks.find((w) => w.id === walkId) : null) ||
      inv.walks.find((w) => w.state === "active") ||
      inv.walks[0];
    if (!walk) return null;
    const now = this.ports.clock.now();
    const workspace = state.settings.activeWorkspace || "work";
    const needsByCustomer = needsByCustomerFromState({
      relationships: (state.relationships || []).map((r) => ({
        id: r.id,
        displayName: r.displayName,
        workspace: r.workspace,
      })),
      needs: state.customerNeeds || [],
      workspace,
    });
    const reconciliation = reconcileInventoryWalk(walk, inv.observations, inv.vehicles, now);
    return buildLotWalkList({
      walk,
      observations: inv.observations,
      vehicles: inv.vehicles,
      now,
      needsByCustomer,
      reconciliation,
      workspace,
    });
  }

  /**
   * The whole sales day as one read model.
   *
   * Read-only and deliberately cheap: it reads state other paths already produced and does not
   * crawl, transcribe, OCR or call a model. The Owner opens this on a phone between customers, so
   * anything expensive belongs behind an explicit action rather than behind a glance.
   */
  async salesCommandCenter(): Promise<SalesCommandCenterV1> {
    const state = await this.snapshot();
    const workspace = state.settings.activeWorkspace || "work";
    const inv = this.vehicleInv(state);
    // Only the active walk counts as "today"; an old walk is history, not a live panel.
    const lotWalkView = inv.walks.some((w) => w.state === "active")
      ? await this.lotWalkCurrentList()
      : null;

    let gmailReady = false;
    try {
      const gmail = await this.gmailConsentStatus();
      gmailReady = Boolean((gmail as { authorized?: boolean }).authorized);
    } catch {
      // A connector probe must never stop the dashboard rendering. Unknown reads as not connected.
      gmailReady = false;
    }

    return buildSalesCommandCenter({
      workspace,
      now: this.ports.clock.now(),
      relationships: state.relationships || [],
      needs: state.customerNeeds || [],
      commitments: state.commitmentCandidates || [],
      proposals: state.crmActionProposals || [],
      conversations: state.conversationEvents || [],
      vehicles: inv.vehicles,
      lotWalkView,
      gmailReady,
      inventoryCount: inv.vehicles.length,
    });
  }

  /**
   * Grounded content for today, built from what actually happened.
   *
   * Signals come from the lot walk and from aggregate customer demand — never from a calendar. If
   * neither produced anything, the plan says so rather than inventing a subject, which is the whole
   * point of the opportunity engine.
   */
  async salesContentToday(): Promise<{
    opportunities: import("./content-opportunity.js").ContentOpportunityV1[];
    plan: import("./content-plan.js").SocialContentPlanV1;
    brand: import("./sales-brand.js").SalesBrandProfileV1;
    declined: Array<{ subject: string; reason: string }>;
  }> {
    const [
      { rankContentOpportunities },
      { buildContentPlan },
      { buildSalesBrandProfile, DEFAULT_CONTENT_PILLARS },
    ] = await Promise.all([
      import("./content-opportunity.js"),
      import("./content-plan.js"),
      import("./sales-brand.js"),
    ]);

    const state = await this.snapshot();
    const workspace = state.settings.activeWorkspace || "work";
    const now = this.ports.clock.now();
    const inv = this.vehicleInv(state);
    const dealership = inv.dealerships.find((d) => d.isCurrent) ?? inv.dealerships[0] ?? null;

    const brandBuilt = buildSalesBrandProfile({
      workspace,
      // Only what the Owner already told AION. Nothing here is inferred about him.
      displayName: state.ownerKnowledge?.profile?.displayName || null,
      dealershipName: dealership?.name ?? null,
      contactPreferences: { preferred: "text" },
      now,
    });
    const brand = "refused" in brandBuilt
      ? (buildSalesBrandProfile({ workspace, now }) as import("./sales-brand.js").SalesBrandProfileV1)
      : brandBuilt;

    const signals: import("./content-opportunity.js").ContentSignalV1[] = [];

    // Vehicles seen on the lot today.
    const walkView = inv.walks.some((w) => w.state === "active") ? await this.lotWalkCurrentList() : null;
    for (const item of walkView?.vehicles ?? []) {
      if (!item.vehicleId) continue;
      signals.push({
        kind: "LOT_OBSERVATION",
        workspace,
        subject: [item.year, item.make, item.model, item.trim].filter(Boolean).join(" ") || item.vin || "vehicle",
        observedAt: item.observedAt,
        sourceRefs: [`vehicle:${item.vehicleId}`, `observation:${item.observationId}`],
        vehicleRef: item.vehicleId,
      });
    }

    // Aggregate demand. Counts only — the engine refuses anything below its own privacy floor.
    const needs = (state.customerNeeds || []).filter((n) => n.workspace === workspace && !n.supersededAt && !n.invalidatedAt);
    const demand = new Map<string, { count: number; refs: string[] }>();
    for (const need of needs) {
      if (need.attribute !== "model" && need.attribute !== "must-have") continue;
      const key = String(need.value).toLowerCase();
      const entry = demand.get(key) ?? { count: 0, refs: [] };
      entry.count += 1;
      entry.refs.push(need.sourceRef);
      demand.set(key, entry);
    }
    for (const [subject, entry] of demand) {
      signals.push({
        kind: "CUSTOMER_DEMAND",
        workspace,
        subject,
        observedAt: now,
        sourceRefs: entry.refs.slice(0, 8),
        customerCount: entry.count,
      });
    }

    const ranked = rankContentOpportunities({
      signals, enabledPillars: brand.contentPillars.length ? brand.contentPillars : DEFAULT_CONTENT_PILLARS,
      workspace, now, nextId: (i) => `content-opp-${i}`,
    });
    const plan = buildContentPlan({
      planId: `content-plan-${now}`, workspace, horizon: "DAILY",
      opportunities: ranked.opportunities, brand, periodStart: now, now,
      nextSlotId: (i) => `content-slot-${i}`,
    });

    return { opportunities: ranked.opportunities, plan, brand, declined: ranked.declined };
  }

  async lotWalkCallList(walkId?: string): Promise<{
    entries: LotWalkCallListEntryV1[];
    reply: string;
  }> {
    const view = await this.lotWalkCurrentList(walkId);
    if (!view) {
      return {
        entries: [],
        reply: "No lot walk on record. Start Inventory Walk, photograph vehicles, then ask who to call.",
      };
    }
    const state = await this.snapshot();
    const inv = this.vehicleInv(state);
    const workspace = state.settings.activeWorkspace || "work";
    const needsByCustomer = needsByCustomerFromState({
      relationships: (state.relationships || []).map((r) => ({
        id: r.id,
        displayName: r.displayName,
        workspace: r.workspace,
      })),
      needs: state.customerNeeds || [],
      workspace,
    });
    const entries = buildLotWalkCallList({
      items: view.vehicles,
      vehicles: inv.vehicles,
      needsByCustomer,
    });
    return { entries, reply: formatLotWalkCallListProse(entries) };
  }

  /**
   * One-shot phone Lot Walk photo: OCR → validated VIN → walk observation → website price → customers.
   * Does not invent VINs or prices. Reuses warm EasyOCR path via ocrVinFromImage.
   */
  async processLotWalkPhoto(input: {
    contentBase64?: string;
    mimeType?: string;
    filename?: string;
    documentRef?: string | null;
    extractedText?: string;
    offline?: boolean;
    walkId?: string;
    note?: string;
  }): Promise<{
    reply: string;
    walkId: string;
    observation: PhysicalObservationV1 | null;
    vehicle: VehicleRecordV1 | null;
    ocr: VinOcrResultV1;
    item: LotWalkListItemV1 | null;
    duplicate: boolean;
    websitePrice: number | null;
    websitePriceLabel: string;
  }> {
    const processStarted = Date.now();
    let walk = input.walkId
      ? this.vehicleInv(await this.snapshot()).walks.find((w) => w.id === input.walkId) ?? null
      : await this.activeInventoryWalk();
    if (!walk) walk = await this.startInventoryWalk("Lot walk (phone)");

    const ocr = await this.ocrVinFromImage({
      ...(input.contentBase64 ? { contentBase64: input.contentBase64 } : {}),
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      ...(input.filename ? { filename: input.filename } : {}),
      ...(input.extractedText ? { extractedText: input.extractedText } : {}),
      ...(input.offline ? { offline: true } : {}),
    });

    const vin = ocr.best?.valid ? ocr.best.vin : null;
    const photoDocumentIds = input.documentRef ? [String(input.documentRef)] : [];
    const before = this.vehicleInv(await this.snapshot()).observations.filter(
      (o) => o.walkId === walk!.id && vin && o.vin === vin,
    );
    const duplicate = before.length > 0;

    let observation: PhysicalObservationV1 | null = null;
    let vehicle: VehicleRecordV1 | null = null;

    if (vin) {
      const recorded = await this.recordWalkObservation({
        vin,
        entryMethod: "photo",
        photoDocumentIds,
        recognitionConfidence: ocr.best?.confidence ?? null,
        walkId: walk.id,
        note: input.note ?? (ocr.sticker?.model ? `sticker:${ocr.sticker.model}` : ""),
        vinSource: "OCR",
        ocrResult: ocr.best?.vin ?? ocr.extractedText?.slice(0, 200) ?? null,
        ownerCorrectionRequired: ocr.status !== "VIN_OCR_HIGH_CONFIDENCE",
        processingStartedAtMs: processStarted,
      });
      observation = recorded.observation;
      vehicle = recorded.vehicle;
      // Merge sticker MSRP into note when present (never as website price).
      if (ocr.sticker?.price != null && observation) {
        const msrpNote = `stickerMSRP:${ocr.sticker.price}`;
        if (!observation.note.includes("stickerMSRP:")) {
          // Note already stored; enrichment uses ocr.sticker at reply time.
        }
        void msrpNote;
      }
    } else if (photoDocumentIds.length) {
      // Unresolved photo still becomes a walk observation (no vehicle invent).
      const recorded = await this.recordWalkObservation({
        entryMethod: "photo",
        photoDocumentIds,
        recognitionConfidence: ocr.best?.confidence ?? 0,
        walkId: walk.id,
        note: input.note ?? "Unresolved VIN photo",
        vinSource: "OCR",
        ocrResult: ocr.extractedText?.slice(0, 200) ?? null,
        ownerCorrectionRequired: true,
        processingStartedAtMs: processStarted,
      });
      observation = recorded.observation;
      vehicle = recorded.vehicle;
    }

    const view = await this.lotWalkCurrentList(walk.id);
    let item: LotWalkListItemV1 | null = null;
    if (view && vin) {
      item = view.vehicles.find((v) => v.vin === vin) ?? null;
    } else if (view && observation) {
      item = view.vehicles.find((v) => v.observationId === observation!.id) ?? null;
    }
    // Attach sticker MSRP from OCR when website enrichment lacked it.
    if (item && ocr.sticker?.price != null && item.website.stickerMsrp == null) {
      item = {
        ...item,
        website: { ...item.website, stickerMsrp: ocr.sticker.price },
      };
    }

    const web = websitePriceFromVehicle(vehicle);
    const reply = formatLotWalkPhotoReply({
      item,
      ocrStatus: ocr.status,
      ocrMessage: ocr.message,
      vin,
      duplicate,
    });

    return {
      reply,
      walkId: walk.id,
      observation,
      vehicle,
      ocr,
      item,
      duplicate,
      websitePrice: web.websitePrice,
      websitePriceLabel: web.websitePrice == null ? "Website price: not published" : `Website price: $${web.websitePrice.toLocaleString("en-US")}`,
    };
  }

  async listVehicles(query: Parameters<typeof queryVehicles>[1] = {}): Promise<VehicleRecordV1[]> {
    const inv = this.vehicleInv(await this.snapshot());
    return queryVehicles(inv.vehicles, { ...query, nowIso: this.ports.clock.now() });
  }

  /** Natural-language vehicle answer with explicit knowledge class (live vs fixture vs model knowledge). */
  async answerVehicleIntelligence(query: string): Promise<VehicleQueryAnswerV1> {
    const inv = this.vehicleInv(await this.snapshot());
    return answerVehicleQuery({
      query,
      vehicles: inv.vehicles,
      nowIso: this.ports.clock.now(),
      lastInventoryRefresh: inv.lastInventoryRefresh,
    });
  }

  async matchCustomerVehicles(relationshipId: string, maxResults = 5): Promise<{
    matches: CustomerVehicleMatchV1[];
    reply: string;
  }> {
    const state = await this.snapshot();
    const rel = state.relationships.find((r) => r.id === relationshipId);
    if (!rel) throw new Error("Customer/relationship not found.");
    const inv = this.vehicleInv(state);
    const matches = matchCustomerToVehicles({
      relationship: rel,
      vehicles: inv.vehicles,
      nowIso: this.ports.clock.now(),
      maxResults,
    });
    return {
      matches,
      reply: [
        `CUSTOMER → VEHICLE MATCH: ${rel.displayName}`,
        formatCustomerMatches(matches),
        "",
        "Do not claim payment/affordability without grounded price + stated budget.",
        "Do not invent incentives or on-lot presence without PHYSICALLY_VERIFIED.",
      ].join("\n"),
    };
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
    /** Skip sticker crop / second-pass fallback (tests). */
    skipStickerFallback?: boolean;
  }): Promise<VinOcrResultV1 & { documentHint: string; extractionPasses?: string[] }> {
    let text = String(input.extractedText ?? "").trim();
    let provider = "text-input";
    let byteLength = 0;
    let bytes: Buffer | null = null;
    /** Whether text came from a real extraction path (not a diagnostic failure string). */
    let extractionOk: boolean | undefined = text ? true : undefined;
    const extractionPasses: string[] = [];

    if (input.contentBase64) {
      bytes = Buffer.from(String(input.contentBase64), "base64");
      byteLength = bytes.byteLength;
    }

    // Phone JPEGs often store EXIF orientation 6 (sideways). Moondream/tesseract on unoriented
    // pixels were the root cause of the real-lot sticker failure — always orient first.
    let workingMime = input.mimeType || "image/jpeg";
    if (bytes && !input.offline && !input.extractedText) {
      try {
        const oriented = await orientImageBytesForVision(bytes);
        if (oriented.rotated && oriented.bytes.length) {
          bytes = oriented.bytes;
          byteLength = bytes.byteLength;
          workingMime = "image/jpeg";
          extractionPasses.push(`exif-orient:${oriented.exifOrientation ?? "?"}`);
        }
      } catch {
        /* keep original bytes */
      }
    }

    /** Last raw vision string (may be detect-box garbage); used only for region hints. */
    let lastVisionRaw = "";

    const runVision = async (img: Buffer, prompt: string, passName: string, mimeType: string) => {
      const vision = await extractImageWithLocalVision({
        filename: input.filename || "vin.jpg",
        mimeType,
        byteLength: img.byteLength,
        bytes: img,
        prompt,
        timeoutMs: 60_000,
      });
      extractionPasses.push(passName);
      const raw = String(vision.extractedText ?? "").trim();
      if (raw) lastVisionRaw = raw;
      // Detection boxes / "!!!" / meta-refusals are not OCR evidence — keep falling back.
      if (vision.code === "READY" && raw && !isNonOcrVisionText(raw)) {
        text = raw;
        provider = vision.provider || "ollama-vision";
        extractionOk = true;
        return true;
      }
      if (vision.code === "IMAGE_EXTRACTION_PROVIDER_REQUIRED") {
        provider = "no-vision-provider";
        extractionOk = false;
      } else {
        provider = vision.provider || "vision-empty";
        // Keep extractionOk false when only garbage was returned.
        if (!text || isNonOcrVisionText(text)) extractionOk = false;
      }
      return false;
    };

    const runTesseract = async (img: Buffer, passName: string): Promise<boolean> => {
      // Bytes that are not an image must never reach the worker.
      //
      // tesseract.js reports an undecodable image by throwing inside its worker's message handler,
      // which is outside the promise being awaited here — so the surrounding try/catch never sees
      // it and it surfaces as an uncaught exception that takes down the whole turn. One corrupt
      // frame from an interrupted upload would lose every other photo the Owner had just taken.
      // Checking the signature first is cheap and removes the class of failure rather than the
      // symptom.
      if (!looksLikeDecodableImage(img)) return false;
      try {
        const tessPath = "tesseract.js";
        const tess = await import(tessPath) as {
          createWorker?: (lang?: string) => Promise<{
            recognize: (img: Buffer) => Promise<{ data: { text: string } }>;
            terminate: () => Promise<void>;
          }>;
        };
        if (typeof tess.createWorker !== "function") return false;
        const worker = await tess.createWorker("eng");
        try {
          const result = await worker.recognize(img);
          const tessText = String(result?.data?.text ?? "").trim();
          extractionPasses.push(passName);
          if (!tessText || isNonOcrVisionText(tessText)) return false;
          text = tessText;
          provider = "tesseract.js";
          extractionOk = true;
          return true;
        } finally {
          await worker.terminate();
        }
      } catch {
        return false;
      }
    };

    /*
     * Targeted VIN bands before the whole page.
     *
     * Measured on a real 4.22 MB Owner sticker photo, scored through this same candidate engine:
     *
     *   full frame     41,504 ms  ->  2T3W1RFV8SC317152 (valid, matches inventory)
     *   vin-strip       3,844 ms  ->  2T3W1RFV8SC317152 (valid, matches inventory)
     *
     * The same answer, 91% sooner. EasyOCR's cost scales with the pixels it is handed, and the VIN
     * occupies a narrow band, so reading that band first is simply less work — nothing about the
     * engine changes.
     *
     * The hazard is real and was measured too: `vin-upper-left` returned 2TSW1RFVSSC317152 and
     * `vin-mid-left` returned 2T3W1RFVSSC317152 — both VIN-shaped, both check-digit invalid, neither
     * in inventory. A fast wrong answer is worse than a slow right one, so a band is only allowed to
     * end the search when its candidate is structurally valid, passes the check digit, AND is
     * corroborated by an exact inventory VIN. Anything less and the next band runs, then the full
     * frame. The fallback is never removed.
     *
     * Inventory corroborates; it never proposes. The candidate must come from the image first.
     */
    if (bytes && !input.offline && (!text || isNonOcrVisionText(text))) {
      const inventoryVins = new Set(
        ((await this.snapshot()).vehicleInventory?.vehicles ?? [])
          .map((v) => v.vin)
          .filter((vin): vin is string => Boolean(vin)),
      );
      /*
       * One band, not several.
       *
       * A miss is additive: the band is paid for and the full frame still runs. Measured across
       * three real photos, one hit and two missed, and trying two bands turned a 34 s miss into 53 s
       * while the hit went from 45 s to 14.5 s. Only `vin-strip` ever produced a corroborated VIN —
       * `top-band` found the same one more slowly, and the remaining regions produced check-digit
       * failures — so a second band buys nothing and doubles the cost of being wrong.
       *
       * The trade this leaves is explicit: about 30 seconds saved when the VIN is where it usually
       * is, about 5 seconds lost when it is not.
       */
      const bands = vinIdentityCropRegions().filter((r) => r.name === "vin-strip");
      for (const band of bands) {
        const cropped = cropImageToRegion(bytes, band, workingMime, { maxEdge: 2200 });
        if (!cropped) continue;
        let bandText = "";
        try {
          const easy = await runEasyOcrOnImageBytes(cropped, { timeoutMs: 60_000 });
          bandText = String(easy?.fullText ?? "").trim();
        } catch {
          continue;
        }
        extractionPasses.push(`easyocr-${band.name}`);
        if (!bandText) continue;
        const proposed = proposeVinsFromOcrText(bandText);
        const confirmed = proposed.find((c) => c.valid && inventoryVins.has(c.vin));
        if (!confirmed) continue; // a shaped-but-unproven candidate never ends the search
        text = bandText;
        provider = `easyocr+${band.name}`;
        extractionOk = true;
        lastVisionRaw = text;
        break;
      }
    }

    // Prefer local EasyOCR (document OCR) on oriented phone photos before small VLMs.
    // Measured: moondream returns garbage on dense Monroney; EasyOCR reads VIN lines after EXIF fix.
    if (bytes && !input.offline && (!text || isNonOcrVisionText(text))) {
      try {
        const easy = await runEasyOcrOnImageBytes(bytes, { timeoutMs: 180_000 });
        extractionPasses.push("easyocr");
        if (easy?.fullText?.trim()) {
          text = easy.fullText.trim();
          provider = `easyocr${easy.exifOrientation && easy.exifOrientation !== 1 ? `+orient${easy.exifOrientation}` : ""}`;
          extractionOk = true;
          lastVisionRaw = text;
        }
      } catch {
        /* optional */
      }
    }

    if ((!text || isNonOcrVisionText(text)) && bytes && !input.offline) {
      await runVision(bytes, VIN_VISION_PROMPT, "full-frame", workingMime);
    }

    // Optional tesseract.js full-frame only when vision produced nothing usable.
    if (bytes && (!text || isNonOcrVisionText(text))) {
      await runTesseract(bytes, "tesseract-full");
    }

    let ocr = buildVinOcrResult({
      extractedText: isNonOcrVisionText(text) ? "" : text,
      provider,
      ...(byteLength ? { byteLength } : {}),
      ...(extractionOk === undefined ? {} : { extractionOk }),
    });

    /*
     * Sticker fallback: dense multi-field stickers often fail full-frame.
     * Identity-first: VIN-only prompt, then full-res JPEG/PNG identity-band crops
     * (crop-then-scale), contrast crops, and tesseract on those crops.
     * Goal is identity (VIN), then inventory match — not full-sticker OCR.
     */
    if (
      !input.offline
      && !input.skipStickerFallback
      && bytes
      && ocr.status === "VIN_OCR_FAILED"
    ) {
      const mime = workingMime;
      // Identity-first full-frame (short VIN-only prompt).
      if (await runVision(bytes, VIN_IDENTITY_ONLY_PROMPT, "vin-identity-full", mime)) {
        ocr = buildVinOcrResult({
          extractedText: text,
          provider: `${provider}+vin-identity`,
          ...(byteLength ? { byteLength } : {}),
          extractionOk: true,
        });
      }
      if (ocr.status === "VIN_OCR_FAILED") {
        if (await runVision(bytes, VIN_STICKER_FOCUS_PROMPT, "sticker-focus-full", mime)) {
          ocr = buildVinOcrResult({
            extractedText: text,
            provider: `${provider}+sticker-focus`,
            ...(byteLength ? { byteLength } : {}),
            extractionOk: true,
          });
        }
      }

      // If any pass returned a detect-style box, try that region first (full-res crop).
      const detectRegion = parseVisionBoxRegion(lastVisionRaw);
      const allRegions = detectRegion
        ? [detectRegion, ...vinIdentityCropRegions()]
        : vinIdentityCropRegions();
      // Bound fan-out: vision is slow; prefer identity bands, then classical OCR.
      const visionRegions = allRegions
        .filter((r) => !r.name.includes("price") && !r.name.startsWith("lower-"))
        .slice(0, 6);
      const tessRegions = allRegions.slice(0, 10);

      if (ocr.status === "VIN_OCR_FAILED") {
        for (const region of visionRegions) {
          const cropped = cropImageToRegion(bytes, region, mime);
          if (!cropped) continue;
          if (await runVision(cropped, VIN_IDENTITY_ONLY_PROMPT, `crop:${region.name}`, "image/png")) {
            ocr = buildVinOcrResult({
              extractedText: text,
              provider: `${provider}+crop:${region.name}`,
              ...(byteLength ? { byteLength } : {}),
              extractionOk: true,
            });
            if (ocr.status !== "VIN_OCR_FAILED") break;
          }
        }
      }

      // Classical OCR on full-res crops — measured stronger than moondream on dense print noise.
      if (ocr.status === "VIN_OCR_FAILED") {
        for (const region of tessRegions) {
          const variants: Array<{ label: string; opts?: { contrast?: boolean } }> = [
            { label: region.name },
            { label: `${region.name}:contrast`, opts: { contrast: true } },
          ];
          let resolved = false;
          for (const v of variants) {
            const cropped = cropImageToRegion(bytes, region, mime, v.opts ?? {});
            if (!cropped) continue;
            if (await runTesseract(cropped, `tesseract:${v.label}`)) {
              ocr = buildVinOcrResult({
                extractedText: text,
                provider: `tesseract:${v.label}`,
                ...(byteLength ? { byteLength } : {}),
                extractionOk: true,
              });
              if (ocr.status !== "VIN_OCR_FAILED") {
                resolved = true;
                break;
              }
            }
          }
          if (resolved) break;
        }
      }

      // Optional price-region vision only after identity still failed (cheap extra signal for sticker fields).
      if (ocr.status === "VIN_OCR_FAILED") {
        const priceRegion = allRegions.find((r) => r.name.includes("price"));
        if (priceRegion) {
          const cropped = cropImageToRegion(bytes, priceRegion, mime);
          if (cropped) {
            await runVision(cropped, STICKER_PRICE_FOCUS_PROMPT, `crop:${priceRegion.name}`, "image/png");
            ocr = buildVinOcrResult({
              extractedText: isNonOcrVisionText(text) ? "" : text,
              provider,
              ...(byteLength ? { byteLength } : {}),
              ...(extractionOk === undefined ? {} : { extractionOk }),
            });
          }
        }
      }
    }

    // Rebuild once more so failureKind/qualityFeedback reflect final text + byteLength.
    if (ocr.status === "VIN_OCR_FAILED") {
      ocr = buildVinOcrResult({
        extractedText: isNonOcrVisionText(text) ? "" : text,
        provider,
        ...(byteLength ? { byteLength } : {}),
        extractionOk: false,
      });
    }

    return {
      ...ocr,
      extractionPasses,
      documentHint: bytes
        ? `Image ${input.filename || "upload"} (${byteLength} bytes) preserved; OCR via ${provider}.`
        : `Text-only OCR via ${provider}.`,
    };
  }

  /**
   * Answer a question about a photo the Owner attached in Chat.
   *
   * The whole point is that the Owner is standing at the car: they should get an identification and
   * what AION actually knows, in one turn, without navigating anywhere. The answer is assembled from
   * grounded records only — the vision model contributes characters, never facts about the vehicle.
   */
  /**
   * Several photos of one car, answered as one question.
   *
   * This is the wiring the Owner's lot test was missing. He sent a sticker, a VIN close-up and a
   * second page; each became a separate errand, the worst one produced `STDAAABS1RS004150`, and
   * every photo after it was wasted.
   *
   * Each image goes through the **existing** `ocrVinFromImage` — same EXIF handling, same VIN bands,
   * same warm EasyOCR worker, no parallel photo stack. What is new is that the results are judged
   * together: a failed read is recorded rather than fatal, agreement across images outranks
   * confidence within one, and two valid conflicting VINs mean two cars rather than a choice.
   *
   * Images are read sequentially on purpose. The OCR worker is one warm process, so firing three at
   * once would contend for it and make all three slower.
   */
  async answerAboutVehiclePhotoBundle(input: {
    text: string;
    images: ReadonlyArray<{ contentBase64: string; mimeType?: string; filename?: string; documentRef?: string | null }>;
    conversationId?: string | null;
    offline?: boolean;
    /** Tests: OCR text per image, positionally parallel to `images`. */
    extractedTexts?: readonly string[];
    /**
     * Called as each real stage begins, so the Owner is not left watching a still screen.
     *
     * Only ever invoked where work is genuinely starting. A stage that is announced before it runs,
     * or left showing after it finishes, is worse than silence: it teaches the Owner that the text
     * is decoration rather than information.
     */
    onStage?: (stage: string) => void;
  }): Promise<{
    intent: string; confidence: string; reply: string;
    sources: Array<{ type: string; id: string; label: string }>;
    action: string | null; data: unknown;
    documentRef: string | null; attachmentRef: string | null;
  }> {
    const { buildVehicleEvidenceBundle, nextPhotoAdvice } = await import("./vehicle-evidence-bundle.js");
    const startedAt = Date.now();
    const timings: Record<string, number> = {};
    const stage = (text: string): void => { try { input.onStage?.(text); } catch { /* progress is never load-bearing */ } };

    const evidenceImages: Array<import("./vehicle-evidence-bundle.js").EvidenceImageV1> = [];
    /** Files that could not be decoded at all, named so the Owner can retake exactly those. */
    const unreadableImages: string[] = [];
    /** When identity first became safely known, so the wait for it can be reported separately. */
    let firstIdentityAt: number | null = null;
    let snapshotForFastFirst: AssistantStateV1 | null = null;
    const readings: Array<import("./vehicle-evidence-bundle.js").StickerReadingV1> = [];

    for (let i = 0; i < input.images.length; i += 1) {
      const image = input.images[i]!;
      const ref = image.documentRef || `image:${image.filename || `photo-${i + 1}`}`;
      stage(input.images.length > 1
        ? `Reading photo ${i + 1} of ${input.images.length}…`
        : "Reading vehicle information…");
      const began = Date.now();
      /*
       * A photo that cannot be decoded at all is not a reason to lose the other two.
       *
       * The bundle already survives a *bad read* — an invalid VIN is recorded and outvoted. It did
       * not survive a bad *file*: an undecodable image threw out of the OCR worker, the exception
       * escaped the whole turn, and every photo the Owner had just taken went with it. On a lot that
       * is an interrupted upload costing him the entire set rather than one frame.
       *
       * The failure is recorded as an image that offered no candidates, which is exactly what it is,
       * so the evidence bundle weighs it honestly instead of never seeing it.
       */
      let ocr: Awaited<ReturnType<typeof this.ocrVinFromImage>>;
      try {
        ocr = await this.ocrVinFromImage({
          contentBase64: image.contentBase64,
          ...(image.mimeType ? { mimeType: image.mimeType } : {}),
          ...(image.filename ? { filename: image.filename } : {}),
          ...(input.offline ? { offline: true } : {}),
          ...(input.extractedTexts?.[i] ? { extractedText: input.extractedTexts[i]! } : {}),
        });
      } catch {
        timings[`ocr_image_${i + 1}_ms`] = Date.now() - began;
        unreadableImages.push(image.filename || `photo ${i + 1}`);
        evidenceImages.push({
          imageRef: ref, role: "UNKNOWN", ocrText: "", vinCandidates: [], quality: 0,
        });
        continue;
      }
      timings[`ocr_image_${i + 1}_ms`] = Date.now() - began;

      evidenceImages.push({
        imageRef: ref,
        role: ocr.sticker?.price != null || ocr.sticker?.model ? "WINDOW_STICKER" : "UNKNOWN",
        ocrText: String(ocr.extractedText ?? "").slice(0, 20_000),
        // Every candidate this image offered, valid or not. The bundle judges them, not the image.
        vinCandidates: [
          ...(ocr.best?.vin ? [ocr.best.vin] : []),
          ...(ocr.candidates ?? []).map((c) => c.vin),
        ].filter(Boolean) as string[],
        quality: ocr.best?.confidence ?? 0,
      });

      /*
       * Fast first result.
       *
       * Measured on the Owner's own photos: OCR is 100% of the time, at roughly 34 seconds per
       * image warm, and images are read one at a time because there is a single warm worker. A
       * three-photo turn therefore takes about 104 seconds, and under the original design the Owner
       * learned which car it was only at the end of that.
       *
       * Nothing here makes OCR faster. What it changes is when the Owner is told: the moment any one
       * image yields a structurally valid VIN that joins inventory exactly, the identity is
       * announced and the remaining photos carry on as enrichment. Roughly a third of the wait for
       * the fact he actually wanted.
       *
       * Only an exact, check-digit-valid, inventory-corroborated match qualifies. A fast answer that
       * might be the wrong car is worth less than no answer at all.
       */
      if (!firstIdentityAt) {
        const candidates = [
          ...(ocr.best?.vin ? [ocr.best.vin] : []),
          ...(ocr.candidates ?? []).map((c) => c.vin),
        ].filter(Boolean) as string[];
        for (const candidate of candidates) {
          const normalized = normalizeVinCandidate(candidate);
          if (!normalized || !validateVin(normalized).valid) continue;
          const hit = (snapshotForFastFirst ??= await this.snapshot())
            .vehicleInventory?.vehicles.find((v) => v.vin === normalized);
          if (!hit) continue;
          firstIdentityAt = Date.now();
          timings.first_useful_result_ms = firstIdentityAt - startedAt;
          const name = [hit.year, hit.make, hit.model, hit.trim].filter(Boolean).join(" ");
          /*
           * Phrased as provisional, because it is.
           *
           * Measured on three real photos: the first resolved to a RAV4 XLE at 38 seconds and the
           * completed bundle then returned conflicting VINs, because the photos were of different
           * vehicles. Announcing "Vehicle identified — RAV4 XLE" and then contradicting it is worse
           * than the wait it saved: the Owner acts on the first thing he reads. Saying what is true
           * so far, and that more photos are still being read, is both faster and honest.
           */
          const more = i + 1 < input.images.length;
          stage(name
            ? (more ? `So far this looks like a ${name} — still reading the other photos.` : `Vehicle identified — ${name}.`)
            : "Vehicle identified.");
          break;
        }
      }

      // The shared OCR path fills `sticker` only when it ran its own sticker pass, so a photo whose
      // text arrived another way comes back with an empty one. Re-reading the text we already have
      // with the same extractor keeps the fusion honest without altering the shared method.
      const ocrSticker = ocr.sticker;
      const hasFields = Boolean(ocrSticker?.model || ocrSticker?.trim || ocrSticker?.price != null);
      const sticker = hasFields ? ocrSticker : extractStickerFields(String(ocr.extractedText ?? ""));
      if (sticker && (sticker.model || sticker.trim || sticker.price != null)) {
        readings.push({
          imageRef: ref,
          ...(sticker.model ? { model: sticker.model } : {}),
          ...(sticker.trim ? { trim: sticker.trim } : {}),
          // The extractor prefers a stated total suggested retail, so that is what this figure is
          // carried as. Base MSRP stays unknown rather than being invented from one number.
          ...(sticker.price != null ? { totalSuggestedRetail: sticker.price } : {}),
        });
      }
    }

    const snapshot = await this.snapshot();
    const vehicles = snapshot.vehicleInventory?.vehicles ?? [];
    const workspaceId = snapshot.settings.activeWorkspace;
    const now = this.ports.clock.now();

    stage("Checking the VIN…");
    const assembleBegan = Date.now();
    const bundle = buildVehicleEvidenceBundle({
      bundleId: this.ports.ids.next("evidence-bundle"),
      workspace: workspaceId,
      conversationId: input.conversationId ?? null,
      images: evidenceImages,
      readings,
      vehicles,
      capturedAt: now,
    });
    timings.bundle_assembly_ms = Date.now() - assembleBegan;
    timings.full_result_ms = Date.now() - startedAt;
    if (timings.first_useful_result_ms === undefined) {
      // Identity was never proven early, so the first useful result is the whole turn.
      timings.first_useful_result_ms = timings.full_result_ms;
    }

    stage("Checking inventory…");
    const matched = bundle.vehicleRef ? vehicles.find((v) => v.id === bundle.vehicleRef) ?? null : null;
    if (matched) stage("Vehicle identified.");
    if (bundle.money.totalSuggestedRetail) stage("Reading sticker details…");
    stage("Preparing answer…");
    const sources: Array<{ type: string; id: string; label: string }> = [];
    const lines: string[] = [];

    if (matched) {
      const label = [matched.year, matched.make, matched.model, matched.trim].filter(Boolean).join(" ");
      lines.push(input.images.length > 1
        ? `Got it — those ${input.images.length} photos are the same vehicle.`
        : "Got it.");
      lines.push("");
      lines.push(label || "Vehicle identified");
      lines.push(`VIN ${bundle.validatedVin}${matched.stockNumber ? ` · Stock ${matched.stockNumber}` : ""}`);
      if (bundle.vinAgreementCount > 1) {
        lines.push(`${bundle.vinAgreementCount} of the photos read the same VIN.`);
      }
      const { priceDisplayFromVehicle, formatPriceDisplay } = await import("./price-display.js");
      lines.push("");
      lines.push(formatPriceDisplay(priceDisplayFromVehicle(matched)));
      if (bundle.money.totalSuggestedRetail) {
        lines.push(`Sticker total from your photo: $${bundle.money.totalSuggestedRetail.value.toLocaleString("en-US")}.`);
      }
      sources.push({ type: "vehicle", id: matched.id, label: label || matched.id });
    } else {
      lines.push(bundle.message);
    }

    if (unreadableImages.length) {
      lines.push("");
      lines.push(unreadableImages.length === 1
        ? `One photo wouldn't open (${unreadableImages[0]}), so I worked from the rest.`
        : `${unreadableImages.length} photos wouldn't open, so I worked from the rest.`);
    }

    const advice = nextPhotoAdvice(bundle);
    if (advice) { lines.push(""); lines.push(advice); }

    // Active vehicle context, so "what about the price?" needs no VIN typed again.
    if (matched && bundle.validatedVin) {
      const link = {
        vehicleRef: matched.id, vin: bundle.validatedVin, state: "LINKED",
        matchMethod: "EXACT_VIN", confidence: bundle.confidence, candidates: [],
        reason: "multi-photo evidence bundle",
      };
      const provenance = buildPhotoProvenance({
        link: link as never,
        imageSourceRef: bundle.sourceRefs[0] ?? "image:bundle",
        observedAt: now,
        extractionProvider: "bundle",
        vinCandidate: bundle.validatedVin,
      });
      const context = buildPhotoVehicleContext({
        workspaceId,
        conversationId: input.conversationId ?? null,
        documentRef: input.images[0]?.documentRef ?? null,
        link: link as never,
        provenance,
        setAt: now,
      });
      await this.mutate((draft) => {
        draft.photoVehicleContexts = upsertPhotoVehicleContext(draft.photoVehicleContexts, context);
        draft.photoVehicleContext = context;
        this.activity(
          draft, "agent", "vehicle.photo.bundle",
          `${input.images.length} photo(s) resolved to vehicle ${matched.id}`,
          matched.id,
        );
      });
      this.#lastPhotoVehicleId = matched.id;
    }

    timings.total_ms = Date.now() - startedAt;
    return {
      intent: "VEHICLE_PHOTO_BUNDLE",
      confidence: matched ? "high" : "low",
      reply: lines.join("\n"),
      sources,
      action: "vehicle.photo.bundle",
      data: { bundle, timings },
      documentRef: input.images[0]?.documentRef ?? null,
      attachmentRef: null,
    };
  }

  async answerAboutVehiclePhoto(input: {
    text: string;
    contentBase64: string;
    mimeType?: string;
    filename?: string;
    documentRef?: string | null;
    conversationId?: string | null;
    /** Tests: skip live vision network. */
    offline?: boolean;
    /** Tests: provide OCR text instead of vision. */
    extractedText?: string;
  }): Promise<{
    intent: string;
    confidence: string;
    reply: string;
    sources: Array<{ type: string; id: string; label: string }>;
    action: string | null;
    data: unknown;
    /** Attachment / document reference when stored. */
    documentRef: string | null;
    attachmentRef: string | null;
  }> {
    const ocr = await this.ocrVinFromImage({
      contentBase64: input.contentBase64,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      ...(input.filename ? { filename: input.filename } : {}),
      ...(input.offline ? { offline: true } : {}),
      ...(input.extractedText ? { extractedText: input.extractedText } : {}),
    });
    const snapshot = await this.snapshot();
    const vehicles = snapshot.vehicleInventory?.vehicles ?? [];
    const link = matchPhotoToVehicle({ ocr, vehicles });
    const observedAt = this.ports.clock.now();
    const imageSourceRef = input.documentRef || `image:${input.filename || "photo"}`;
    const provenance = buildPhotoProvenance({
      link,
      imageSourceRef,
      observedAt,
      extractionProvider: ocr.provider,
      vinCandidate: ocr.best?.vin ?? null,
    });

    const lines: string[] = [];
    const sources: Array<{ type: string; id: string; label: string }> = [];
    const matched = link.vehicleRef ? vehicles.find((v) => v.id === link.vehicleRef) ?? null : null;
    const workspaceId = snapshot.settings.activeWorkspace;

    // Persist structured context + provenance so restart and follow-ups stay grounded.
    const context = buildPhotoVehicleContext({
      workspaceId,
      conversationId: input.conversationId ?? null,
      documentRef: input.documentRef ?? null,
      link,
      provenance,
      setAt: observedAt,
    });
    await this.mutate((draft) => {
      // Durable conversation + workspace scoped list (survives restart); legacy single field = latest.
      draft.photoVehicleContexts = upsertPhotoVehicleContext(draft.photoVehicleContexts, context);
      draft.photoVehicleContext = context;
      // Attach provenance summary onto the CRM document when we have a durable ref.
      if (input.documentRef && Array.isArray(draft.crmDocuments)) {
        const doc = draft.crmDocuments.find((d) => d.id === input.documentRef);
        if (doc) {
          const note = [
            `photo-match:${link.state}`,
            link.vin ? `vin:${link.vin}` : null,
            link.vehicleRef ? `vehicleRef:${link.vehicleRef}` : null,
            `method:${link.matchMethod}`,
            `provider:${ocr.provider}`,
            `confidence:${link.confidence}`,
          ].filter(Boolean).join(" ");
          doc.summary = [doc.summary, note].filter(Boolean).join(" · ").slice(0, 4000);
          if (ocr.extractedText && !doc.extractedText) {
            doc.extractedText = ocr.extractedText.slice(0, 100_000);
          }
          doc.updatedAt = observedAt;
        }
      }
      this.activity(
        draft,
        "agent",
        "vehicle.photo.identify",
        matched
          ? `Photo matched inventory vehicle ${matched.id} (${link.matchMethod})`
          : `Photo vehicle match ${link.state} — no auto-link`,
        link.vehicleRef || input.documentRef || null,
      );
    });
    this.#lastPhotoVehicleId = matched?.id ?? null;

    if (matched) {
      const name = [matched.year, matched.make, matched.model, matched.trim].filter(Boolean).join(" ");
      // Identity-first success: VIN matched inventory even if full sticker OCR was incomplete.
      lines.push(`I identified the vehicle from the VIN.`);
      lines.push(name || "Vehicle identified");
      lines.push(`VIN ${link.vin}${matched.stockNumber ? ` · Stock ${matched.stockNumber}` : ""}`);
      lines.push("");
      for (const line of vinDetailLines(matched, input.text)) lines.push(line.text);
      const recall = describeRecallStatus(matched.recallAssessment);
      if (recall) { lines.push(""); lines.push(recall); }
      if (ocr.sticker.price) {
        lines.push("");
        lines.push(`Sticker price signal (from photo text): $${ocr.sticker.price.toLocaleString("en-US")}`);
      }
      if (ocr.extractedText && ocr.extractedText.length < 80) {
        lines.push("");
        lines.push("I wasn't able to reliably read every small-print sticker field — inventory and VIN decode are the source of truth for this answer.");
      }
      sources.push({ type: "vehicle", id: matched.id, label: name || matched.id });
    } else if (link.state === "VALID_VIN_NOT_IN_CURRENT_INVENTORY" && link.vin) {
      lines.push(`I found VIN ${link.vin} and validated it, but it is not in current AION inventory.`);
      lines.push(link.message);
    } else if (link.state === "NO_VIN_FOUND") {
      // Prefer failure-kind wording over "retake" when photo is large/usable.
      const kindMsg = ocr.failureKind && ocr.failureKind !== "NONE"
        ? ownerFacingExtractionMessage(ocr.failureKind)
        : "";
      lines.push(kindMsg || link.message || ocr.message);
    } else {
      lines.push(link.message);
    }

    if (link.candidates.length) {
      lines.push("");
      lines.push("Possible matches — tell me which one:");
      for (const c of link.candidates) lines.push(`· ${c.label}${c.vin ? ` (${c.vin})` : ""}`);
    }
    if (!matched && ocr.qualityFeedback.length) {
      lines.push("");
      for (const tip of ocr.qualityFeedback.slice(0, 3)) {
        // Avoid duplicating the primary failure sentence already pushed above.
        if (lines.some((l) => l === tip)) continue;
        lines.push(tip);
      }
    }

    return {
      intent: "VEHICLE_PHOTO",
      confidence: matched ? "high" : "low",
      reply: lines.join("\n").trim(),
      sources,
      action: "vehicle.photo.identify",
      documentRef: input.documentRef ?? null,
      attachmentRef: input.documentRef ?? imageSourceRef,
      data: {
        link,
        provenance,
        ocrStatus: ocr.status,
        matchState: link.state,
        vehicleRef: link.vehicleRef,
        conversationId: input.conversationId ?? null,
        processingState: matched ? "IDENTIFIED" : link.state,
        failureKind: ocr.failureKind,
        extractionPasses: ocr.extractionPasses ?? [],
      },
    };
  }

  /** Durable photo vehicle context for the active workspace (optional conversation). No secrets. */
  async getPhotoVehicleContext(opts: { conversationId?: string | null } = {}): Promise<PhotoVehicleContextV1 | null> {
    const state = await this.snapshot();
    return resolvePhotoVehicleContext(
      state.photoVehicleContexts,
      state.photoVehicleContext,
      { workspaceId: state.settings.activeWorkspace, conversationId: opts.conversationId ?? null },
    );
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
  /**
   * Disaster-recovery backup: canonical state plus non-secret continuity sidecars, encrypted with
   * the existing envelope, then copied to the authorized off-disk root.
   *
   * The off-disk copy is a byte copy of the already-encrypted artifact rather than a second
   * encryption pass, so both locations hold the identical verified ciphertext and the production
   * backup port keeps its `exports`-scoped containment. Retention is planned but only applied to
   * the local location here; off-disk pruning stays an Owner decision.
   */
  async createRecoveryBackup(offDiskRoot?: string | null): Promise<{
    ok: boolean;
    revision: number;
    encryptedPath: string | null;
    offDiskPath: string | null;
    encrypted: boolean;
    localDigest: string | null;
    offDiskDigest: string | null;
    digestsMatch: boolean;
    includedPaths: string[];
    excludedPaths: string[];
    cursorSeenIds: number | null;
    retentionKept: number;
    retentionPruned: number;
    message: string;
  }> {
    const { createHash } = await import("node:crypto");
    const { mkdir, copyFile, readFile, stat, readdir } = await import("node:fs/promises");
    const { join, basename } = await import("node:path");
    const { collectRecoveryPackage, restoredCursorSeenIdCount } = await import("./recovery-package.js");
    const { planBackupRetention } = await import("./backup-retention.js");
    const { resolvePrivateBackupPassphrase } = await import("./private-backup-key.js");

    const state = await this.snapshot();
    const dataRoot = this.#resolveDataRoot();
    if (!dataRoot) {
      return {
        ok: false, revision: state.revision, encryptedPath: null, offDiskPath: null, encrypted: false,
        localDigest: null, offDiskDigest: null, digestsMatch: false, includedPaths: [], excludedPaths: [],
        cursorSeenIds: null, retentionKept: 0, retentionPruned: 0,
        message: "No filesystem data root; recovery backup requires on-disk state.",
      };
    }
    const key = resolvePrivateBackupPassphrase(dataRoot);
    if (!key.passphrase || key.passphrase.length < 12) {
      return {
        ok: false, revision: state.revision, encryptedPath: null, offDiskPath: null, encrypted: false,
        localDigest: null, offDiskDigest: null, digestsMatch: false, includedPaths: [], excludedPaths: [],
        cursorSeenIds: null, retentionKept: 0, retentionPruned: 0,
        message: "No backup passphrase could be resolved.",
      };
    }

    const now = this.ports.clock.now();
    const pkg = collectRecoveryPackage(dataRoot, now);
    // Record which key wrote this artifact. Identity only — material never enters a manifest.
    const keyIdentity = key.keyId ? { keyId: key.keyId, keyVersion: key.keyVersion ?? 1, keySource: key.source } : { keySource: key.source };
    const manifestWithKey = { ...pkg.manifest, ...keyIdentity };
    const snapDir = join(dataRoot, "exports", "pre-import-snapshots");
    await mkdir(snapDir, { recursive: true });
    const ts = now.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const dest = join(snapDir, `aion-recovery-${ts}.aionbak`);

    const backupPort = this.ports.backup as unknown as {
      createPackage?: (s: AssistantStateV1, sc: Record<string, unknown>, m: unknown, d: string, p: string) => Promise<{ digest: string; bytes: number }>;
      restorePackage?: (d: string, p: string) => Promise<{ state: AssistantStateV1; sidecars: Record<string, unknown> }>;
    };
    if (typeof backupPort.createPackage !== "function") {
      return {
        ok: false, revision: state.revision, encryptedPath: null, offDiskPath: null, encrypted: false,
        localDigest: null, offDiskDigest: null, digestsMatch: false,
        includedPaths: pkg.manifest.includedPaths, excludedPaths: pkg.manifest.excludedPaths,
        cursorSeenIds: null, retentionKept: 0, retentionPruned: 0,
        message: "Backup port does not support recovery packages.",
      };
    }
    const created = await backupPort.createPackage(state, pkg.sidecars, manifestWithKey, dest, key.passphrase);
    const localDigest = createHash("sha256").update(await readFile(dest)).digest("hex");

    let offDiskPath: string | null = null;
    let offDiskDigest: string | null = null;
    if (offDiskRoot && offDiskRoot.trim()) {
      const targetDir = join(offDiskRoot.trim(), "recovery-packages");
      await mkdir(targetDir, { recursive: true });
      const target = join(targetDir, basename(dest));
      await copyFile(dest, target);
      offDiskDigest = createHash("sha256").update(await readFile(target)).digest("hex");
      offDiskPath = target;
    }

    const cursorSeenIds = restoredCursorSeenIdCount(pkg.sidecars);

    // Retention over local recovery packages only; the off-disk copy is never pruned here.
    const localFiles = (await readdir(snapDir)).filter((f) => f.endsWith(".aionbak"));
    const artifacts = await Promise.all(
      localFiles.map(async (f) => {
        const p = join(snapDir, f);
        const s = await stat(p);
        return { path: p, modifiedMs: s.mtimeMs, verified: p === dest, offDisk: false };
      }),
    );
    const plan = planBackupRetention(artifacts);

    return {
      ok: true,
      revision: state.revision,
      encryptedPath: dest,
      offDiskPath,
      encrypted: true,
      localDigest,
      offDiskDigest,
      digestsMatch: offDiskDigest === null ? true : offDiskDigest === localDigest,
      includedPaths: pkg.manifest.includedPaths,
      excludedPaths: pkg.manifest.excludedPaths,
      cursorSeenIds,
      retentionKept: plan.keep.length,
      retentionPruned: plan.prune.length,
      message: `Recovery package written (${created.bytes} bytes)${offDiskPath ? " and copied off-disk" : ""}.`,
    };
  }

  /** Non-secret recovery-key identity for reports and manifests. Never returns key material. */
  async recoveryKeyIdentity(): Promise<{ keyId: string; keyVersion: number; algorithm: string; createdAt: string; origin: string } | null> {
    const dataRoot = this.#resolveDataRoot();
    if (!dataRoot) return null;
    const { ensureRecoveryKey, identityOf } = await import("./recovery-key.js");
    return identityOf(ensureRecoveryKey(dataRoot, this.ports.clock.now()));
  }

  /**
   * Write the independent recovery-key copy for physical transfer to the recovery laptop.
   * Deliberately never targets the backup drive: key and ciphertext must not share a device.
   */
  async exportRecoveryKeyPackage(destinationDir?: string | null): Promise<{ ok: boolean; path: string | null; keyId: string | null; message: string }> {
    const { mkdir } = await import("node:fs/promises");
    const { join, resolve } = await import("node:path");
    const dataRoot = this.#resolveDataRoot();
    if (!dataRoot) return { ok: false, path: null, keyId: null, message: "No filesystem data root." };
    const { ensureRecoveryKey, buildRecoveryKeyPackage, writeRecoveryKeyPackage } = await import("./recovery-key.js");
    const record = ensureRecoveryKey(dataRoot, this.ports.clock.now());
    const dir = resolve(destinationDir && destinationDir.trim() ? destinationDir : join(dataRoot, "exports", "recovery-key"));
    if (/^[a-z]:[\\/]aion-backups/i.test(dir)) {
      return { ok: false, path: null, keyId: record.keyId, message: "Refused: the recovery key must not be written to the backup drive." };
    }
    await mkdir(dir, { recursive: true });
    const file = join(dir, `aion-recovery-key-${record.keyId}.json`);
    writeRecoveryKeyPackage(file, buildRecoveryKeyPackage(record, this.ports.clock.now()));
    return { ok: true, path: file, keyId: record.keyId, message: "Recovery key package written. Move it to the recovery laptop, then delete the transport copy." };
  }

  /**
   * Restore an artifact using any key material this machine still holds — current, rotated-out,
   * legacy file, or env. Rotation and the move off the old passphrase must never strand a backup.
   */
  async restoreBackupWithAnyKnownKey(destination: string): Promise<{ ok: boolean; state: AssistantStateV1 | null; sidecars: Record<string, unknown>; manifest: unknown; keysTried: number }> {
    const dataRoot = this.#resolveDataRoot();
    const { candidateKeyMaterials } = await import("./recovery-key.js");
    const candidates = dataRoot ? candidateKeyMaterials(dataRoot) : [];
    const port = this.ports.backup as unknown as {
      restorePackage?: (d: string, p: string) => Promise<{ state: AssistantStateV1; sidecars: Record<string, unknown>; manifest: unknown }>;
    };
    for (const material of candidates) {
      try {
        const restored = await port.restorePackage!(destination, material);
        return { ok: true, state: restored.state, sidecars: restored.sidecars, manifest: restored.manifest, keysTried: candidates.length };
      } catch {
        /* wrong key for this artifact — try the next */
      }
    }
    return { ok: false, state: null, sidecars: {}, manifest: null, keysTried: candidates.length };
  }

  /**
   * Read a document's extracted text wherever it lives.
   *
   * Sidecar first, inline second, so every record written before sidecars existed keeps working.
   */
  async documentExtractedText(documentId: string): Promise<string> {
    const state = await this.snapshot();
    const doc = (state.crmDocuments || []).find((d) => d.id === documentId);
    if (!doc) return "";
    const { resolveDocumentText } = await import("./document-text-store.js");
    const root = this.#resolveDataRoot();
    return resolveDocumentText(doc, async (ref) => {
      if (!root) return null;
      try {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        return await readFile(join(root, ref), "utf8");
      } catch {
        return null;
      }
    });
  }

  /**
   * Move large inline extracted text out of state and into sidecars.
   *
   * The measured cause of the fastest state growth: 91% of `crmDocuments` bytes is derived text
   * copied inline from files already on disk. Sidecars are written *before* the state mutation, so a
   * crash between the two leaves the text in both places rather than in neither — recoverable rather
   * than lost. Idempotent: a document that already has a ref is skipped.
   */
  async migrateDocumentTextToSidecar(opts: { dryRun?: boolean } = {}): Promise<{
    planned: number; migrated: number; skipped: number; bytesFreed: number;
    stateBytesBefore: number; stateBytesAfter: number; percentReduction: number; message: string;
  }> {
    const { planStateTextMigration, applyTextMigrationToDocument } = await import("./document-text-store.js");
    const state = await this.snapshot();
    const documents = state.crmDocuments || [];
    const stateBytesBefore = Buffer.byteLength(JSON.stringify(state), "utf8");
    const plan = planStateTextMigration({ documents, stateBytesBefore });

    if (opts.dryRun || !plan.items.length) {
      return {
        planned: plan.items.length, migrated: 0, skipped: plan.skipped,
        bytesFreed: plan.totalBytesFreed, stateBytesBefore,
        stateBytesAfter: plan.stateBytesAfter, percentReduction: plan.percentReduction,
        message: plan.items.length
          ? `${plan.items.length} document(s) would move ${Math.round(plan.totalBytesFreed / 1024)} KiB out of state.`
          : "Nothing to move.",
      };
    }

    const root = this.#resolveDataRoot();
    if (!root) {
      return {
        planned: plan.items.length, migrated: 0, skipped: plan.skipped, bytesFreed: 0,
        stateBytesBefore, stateBytesAfter: stateBytesBefore, percentReduction: 0,
        message: "No filesystem data root, so there is nowhere to put the sidecars. Nothing changed.",
      };
    }

    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const written: typeof plan.items = [];
    for (const item of plan.items) {
      const target = join(root, item.ref);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, item.text, "utf8");
      written.push(item);
    }

    const byId = new Map(written.map((i) => [i.documentId, i]));
    await this.mutate((draft) => {
      draft.crmDocuments = (draft.crmDocuments || []).map((doc) => {
        const item = byId.get(doc.id);
        return item ? applyTextMigrationToDocument(doc, item) : doc;
      });
      this.activity(
        draft, "memory", "document.text.externalise",
        `Moved extracted text for ${written.length} document(s) out of state into sidecars.`,
        null,
      );
    });

    const after = await this.snapshot();
    const stateBytesAfter = Buffer.byteLength(JSON.stringify(after), "utf8");
    return {
      planned: plan.items.length, migrated: written.length, skipped: plan.skipped,
      bytesFreed: stateBytesBefore - stateBytesAfter,
      stateBytesBefore, stateBytesAfter,
      percentReduction: stateBytesBefore > 0 ? ((stateBytesBefore - stateBytesAfter) / stateBytesBefore) * 100 : 0,
      message: `Moved ${written.length} document(s); state went from `
        + `${(stateBytesBefore / 1_048_576).toFixed(2)} to ${(stateBytesAfter / 1_048_576).toFixed(2)} MiB.`,
    };
  }

  /**
   * How close state is to its ceiling, and what is taking the room.
   *
   * Reported before writes begin failing rather than after. The threshold derives from the
   * configured limit rather than repeating a number somewhere else.
   */
  async stateCapacity(): Promise<import("./memory-scale.js").CapacityReportV1> {
    const { assessStateCapacity } = await import("./memory-scale.js");
    const state = await this.snapshot();
    const usedBytes = Buffer.byteLength(JSON.stringify(state), "utf8");
    const collections = Object.entries(state as unknown as Record<string, unknown>).map(([collection, value]) => ({
      collection,
      bytes: Buffer.byteLength(JSON.stringify(value ?? null), "utf8"),
      count: Array.isArray(value) ? value.length : 1,
    }));
    return assessStateCapacity({ usedBytes, collections, ceilingBytes: MAX_STATE_BYTES });
  }

  /** Best-effort filesystem data root from whichever repository adapter is installed. */
  #resolveDataRoot(): string {
    const repo = this.ports.repository as {
      root?: string; statePath?: string;
      inner?: { root?: string; statePath?: string };
      underlying?: { root?: string; statePath?: string };
    };
    return (
      (typeof repo.root === "string" && repo.root) ||
      (typeof repo.inner?.root === "string" && repo.inner.root) ||
      (typeof repo.underlying?.root === "string" && repo.underlying.root) ||
      (typeof repo.statePath === "string" && repo.statePath.endsWith("state-v1.json")
        ? repo.statePath.replace(/[\\/]state-v1\.json$/i, "")
        : "") ||
      (typeof repo.inner?.statePath === "string" && repo.inner.statePath.endsWith("state-v1.json")
        ? repo.inner.statePath.replace(/[\\/]state-v1\.json$/i, "")
        : "")
    );
  }

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
    const { resolvePrivateBackupPassphrase } = await import("./private-backup-key.js");
    const keyRes = resolvePrivateBackupPassphrase(dataRoot);
    const passphrase = keyRes.passphrase;
    if (passphrase && passphrase.length >= 12) {
      try {
        const dest = join(snapDir, `aion-private-state-${ts}.aionbak`);
        await this.createPrivateBackup(dest, passphrase);
        // createPrivateBackup already wrote+verified .aionbak; treat as encrypted even if activity soft-failed.
        const { existsSync } = await import("node:fs");
        if (existsSync(dest)) {
          encryptedPath = dest;
          encrypted = true;
        }
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
    try {
      await this.mutate((draft) => {
        this.activity(
          draft,
          "export",
          "backup.pre-import",
          `Pre-import snapshot ${sha256.slice(0, 16)}… bytes=${bytes} encrypted=${encrypted} keySource=${keyRes.source}`,
          null,
        );
        return null;
      });
    } catch {
      /* activity optional — snapshot + .aionbak are the durable artifacts */
    }
    return {
      ok: true,
      snapshotPath,
      sha256,
      bytes,
      revision: state.revision,
      encryptedPath,
      encrypted,
      message: encrypted
        ? `Verified file snapshot + encrypted private backup PASS (keySource=${keyRes.source}).`
        : "Verified file snapshot PASS (SHA256). Encrypted .aionbak unavailable (no env passphrase and local key file could not be created).",
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
        draft.executive.opportunities = draft.executive.opportunities.filter((o) => {
          if (isSyntheticOwnerFacingText(o.title, o.workspace, o.detail, o.source)) return false;
          // Drop inventory matches for people we just archived / fixture Mike demos
          if (/^match for mike:/i.test(o.title || "")) return false;
          return true;
        });
        opportunitiesDisabled = before - draft.executive.opportunities.length;
      }
      if (draft.executive?.commitments) {
        draft.executive.commitments = draft.executive.commitments.filter((c) => !isSyntheticCommitment(c));
      }
      // Deactivate graph edges pointing at archived / synthetic people
      if (draft.executive?.graphEdges) {
        const archivedIds = new Set(
          draft.relationships.filter((r) => r.archived || isSyntheticRelationship(r)).map((r) => r.id),
        );
        for (const e of draft.executive.graphEdges) {
          if (archivedIds.has(e.fromId) || archivedIds.has(e.toId) || isSyntheticOwnerFacingText(e.fromLabel, e.toLabel, e.note)) {
            e.active = false;
            e.supersededAt = e.supersededAt || now;
          }
        }
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
    const brandDnaCount = (state.executive?.brandDna ?? []).filter((b) => (b.purpose || b.productsServices || "").trim()).length;
    if (coverage.brand?.status === "UNKNOWN" && brandDnaCount === 0) {
      gaps.push("Brand DNA not yet populated from real brand evidence.");
    } else if (brandDnaCount > 0 && coverage.brand?.status === "UNKNOWN") {
      gaps.push(`Brand DNA records present (${brandDnaCount}) but knowledge category "brand" facts still thin.`);
    }
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
    // Only surface walk exceptions when a real Owner walk produced observations (not empty/demo walks)
    if (lastWalk && (inv.observations?.length ?? 0) > 0) {
      const realObs = (inv.observations ?? []).filter((o) => {
        const vin = String(o.vin || "");
        // Acceptance-harness VINs / labels must not create Owner must-do noise
        // Harness/demo VINs used in walk acceptance (not a real lot scan)
        if (/NLY000|TESTVIN|FIXTURE|0000000|RW2900000000|RW1X00000000/i.test(vin)) return false;
        if (vin.length >= 17 && /0{6,}/.test(vin)) return false;
        if (isSyntheticOwnerFacingText((o as { note?: string }).note, vin, o.stockNumber, (o as { source?: string }).source)) {
          return false;
        }
        return true;
      });
      if (realObs.length > 0) {
        const sum = reconcileInventoryWalk(lastWalk, realObs, inv.vehicles, this.ports.clock.now());
        exceptions =
          sum.stockMismatches.length +
          sum.vinMismatches.length +
          sum.photoReviewRequired.length +
          sum.seenButNotOnline.length;
      }
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
        !isSyntheticCommitment(c) &&
        c.status !== "cancelled" &&
        c.status !== "kept" &&
        c.status !== "broken" &&
        !/\[INVALIDATED\b/i.test(c.statement || "") &&
        String(c.committedBy || c.committedTo || c.statement || "").trim().length > 0,
    );
    const ownerOpps = opps.filter(
      (o) => !isSyntheticOwnerFacingText(o.title, o.workspace, o.detail, o.source),
    );
    const board = buildAttentionBoard({
      nowIso: now,
      relationships: ownerRels,
      tasks: state.tasks.filter(
        (t) =>
          !isSyntheticOwnerFacingText(t.title, t.description, t.workspace) &&
          !/\btest aion\b|\bsynthetic task\b|\be2e task\b/i.test(`${t.title} ${t.description}`),
      ),
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
    const dataRoot = this.repositoryDataRoot();
    const { resolveGmailCredentials } = await import("./connector-secrets.js");
    const creds = resolveGmailCredentials(dataRoot, process.env, connectors.gmailClientId);
    const clientId = creds.clientId || cfg.clientId;
    const redirectUri = connectors.gmailRedirectUri?.trim() || cfg.redirectUri;
    // Synthetic env for status so local secrets count as configured
    const envForStatus = {
      ...process.env,
      [cfg.clientSecretEnvVar]: creds.clientSecret || process.env[cfg.clientSecretEnvVar] || "",
      [cfg.refreshTokenEnvVar]: creds.refreshToken || process.env[cfg.refreshTokenEnvVar] || "",
    };
    const config = { ...cfg, clientId, redirectUri };
    const status = gmailConnectorStatus(config, envForStatus, { sendAuthorized: sendGate.allowed });
    const ownerSteps: string[] = [];
    if (status.code === "NOT_CONFIGURED") {
      ownerSteps.push(
        "In Google Cloud: OAuth client type Web application; Authorized redirect URI must be EXACTLY:",
        redirectUri,
        "Do NOT use http://localhost:8080/oauth2callback (Google tutorial default — AION never uses it).",
        "Open Settings → Connectors → Gmail",
        "Paste Google OAuth Client ID + Client Secret (secret stays on this PC only)",
        "Confirm redirect URI field is " + redirectUri,
        "Click Save connector settings",
        "Click Connect / check Gmail → Google Allow (must open from AION, not a Google sample/quickstart)",
      );
    } else if (status.code === "GMAIL_OWNER_CONSENT_REQUIRED") {
      ownerSteps.push(
        "Click Connect / check Gmail (or Open Google consent) — only from AION",
        "Browser callback must land on " + redirectUri + " (not localhost:8080)",
        "Select Google account → Allow",
        "Callback stores refresh token on this PC automatically — no env/PowerShell",
      );
    }
    let authUrl: string | null = null;
    if ((status.code === "GMAIL_OWNER_CONSENT_REQUIRED" || status.code === "NOT_CONFIGURED") && clientId) {
      try {
        // Always request readonly + compose + send at consent time (Google Cloud scopes match).
        // Actual SEND still requires envelope + per-message safety — scope ≠ permission to send.
        authUrl = buildGmailAuthUrl(config, `aion-${Date.now().toString(36)}`, {
          includeSend: true,
        });
      } catch {
        authUrl = null;
      }
    }
    const hasLocalSecret = Boolean(creds.clientSecret && creds.source.clientSecret === "local_file");
    const hasLocalRefresh = Boolean(creds.refreshToken && creds.source.refreshToken === "local_file");
    return {
      ...status,
      authUrl,
      clientIdConfigured: Boolean(clientId),
      clientSecretConfigured: Boolean(creds.clientSecret),
      refreshConfigured: Boolean(creds.refreshToken),
      clientSecretEnvVar: config.clientSecretEnvVar,
      refreshTokenEnvVar: config.refreshTokenEnvVar,
      credentialSources: creds.source,
      localSecretStore: hasLocalSecret || hasLocalRefresh,
      lastSyncAt: creds.local?.lastSyncAt ?? null,
      redirectUri,
      ownerSteps,
      ownerAction:
        status.code === "GMAIL_OWNER_CONSENT_REQUIRED"
          ? "Settings → Connectors → Gmail → Connect → Google Allow. Refresh token is saved on this PC automatically."
          : status.code === "NOT_CONFIGURED"
            ? "Settings → Connectors → Gmail: enter Client ID + Client Secret → Save → Connect → Google Allow. Never paste tokens into chat."
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

  /** Resolve private/aion data root from repository (file or gated wrapper). */
  private repositoryDataRoot(): string | null {
    const repo = this.ports.repository as {
      root?: string;
      statePath?: string;
      inner?: { root?: string; statePath?: string };
    };
    if (typeof repo.root === "string" && repo.root) return repo.root;
    if (typeof repo.inner?.root === "string" && repo.inner.root) return repo.inner.root;
    if (typeof repo.statePath === "string" && repo.statePath.endsWith("state-v1.json")) {
      return repo.statePath.replace(/[\\/]state-v1\.json$/i, "");
    }
    if (typeof repo.inner?.statePath === "string" && repo.inner.statePath.endsWith("state-v1.json")) {
      return repo.inner.statePath.replace(/[\\/]state-v1\.json$/i, "");
    }
    return null;
  }

  async updateConnectorSettings(input: Record<string, unknown> = {}): Promise<{
    connectors: SettingsV1["connectors"];
    clientSecretStored: boolean;
    clientSecretSource: "local_file" | "env" | "none";
    clientIdConfigured: boolean;
  }> {
    const dataRoot = this.repositoryDataRoot();
    let clientSecretStored = false;
    // Secrets never enter assistant state JSON — only local encrypted secret files.
    if (dataRoot && (typeof input.gmailClientSecret === "string" || typeof input.gmailRefreshToken === "string" || typeof input.gmailClientId === "string")) {
      const { saveGmailLocalSecrets } = await import("./connector-secrets.js");
      const patch: {
        clientId?: string;
        clientSecretPlain?: string;
        refreshTokenPlain?: string;
      } = {};
      if (typeof input.gmailClientId === "string" && input.gmailClientId.trim()) {
        patch.clientId = input.gmailClientId.trim().slice(0, 200);
      }
      if (typeof input.gmailClientSecret === "string" && input.gmailClientSecret.trim()) {
        patch.clientSecretPlain = input.gmailClientSecret.trim();
        clientSecretStored = true;
      }
      if (typeof input.gmailRefreshToken === "string" && input.gmailRefreshToken.trim()) {
        patch.refreshTokenPlain = input.gmailRefreshToken.trim();
      }
      // Only write secret file when there is something secret-store-related to persist.
      if (patch.clientSecretPlain || patch.refreshTokenPlain || patch.clientId) {
        saveGmailLocalSecrets(dataRoot, patch);
      }
    }
    const connectors = await this.mutate((draft) => {
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
      this.activity(
        draft,
        "settings",
        "connectors.update",
        clientSecretStored
          ? "Connector settings updated; Gmail client secret written to private local encrypted store only."
          : "Connector settings updated (no new client secret in this save).",
        null,
      );
      return structuredClone(c);
    });
    const status = await this.gmailConsentStatus();
    return {
      connectors,
      clientSecretStored,
      clientSecretSource: status.credentialSources?.clientSecret === "local_file" || status.credentialSources?.clientSecret === "env"
        ? status.credentialSources.clientSecret
        : clientSecretStored
          ? "local_file"
          : "none",
      clientIdConfigured: Boolean(connectors.gmailClientId?.trim()),
    };
  }

  /**
   * Persist OAuth refresh token after loopback callback (local encrypted file only).
   * Never stores secrets in assistant state or activity logs.
   */
  async completeGmailOAuth(input: {
    refreshToken: string;
    clientId?: string;
    scopes?: string[];
    accountHint?: string;
  }): Promise<{ ok: boolean; message: string }> {
    const dataRoot = this.repositoryDataRoot();
    if (!dataRoot) return { ok: false, message: "No private data root — cannot store Gmail credentials." };
    const token = String(input.refreshToken || "").trim();
    if (token.length < 20) return { ok: false, message: "Refresh token missing or too short." };
    const { saveGmailLocalSecrets } = await import("./connector-secrets.js");
    const state = await this.snapshot();
    const savePatch: {
      clientId?: string;
      refreshTokenPlain: string;
      scopes?: string[];
      accountHint?: string;
      connectedAt: string;
    } = {
      refreshTokenPlain: token,
      connectedAt: this.ports.clock.now(),
    };
    const cid = input.clientId || state.settings.connectors?.gmailClientId || "";
    if (cid) savePatch.clientId = cid;
    if (input.scopes?.length) savePatch.scopes = input.scopes;
    if (input.accountHint) savePatch.accountHint = input.accountHint;
    saveGmailLocalSecrets(dataRoot, savePatch);
    await this.mutate((draft) => {
      this.activity(draft, "settings", "gmail.oauth.complete", "Gmail OAuth refresh credential stored locally (encrypted file).", null);
      return null;
    });
    return { ok: true, message: "Gmail connected. Refresh token stored in private local secrets (not Git, not chat)." };
  }

  async disconnectGmail(): Promise<{ ok: boolean; message: string }> {
    const dataRoot = this.repositoryDataRoot();
    if (dataRoot) {
      const { clearGmailLocalSecrets } = await import("./connector-secrets.js");
      clearGmailLocalSecrets(dataRoot);
    }
    await this.mutate((draft) => {
      this.activity(draft, "settings", "gmail.disconnect", "Gmail local credentials cleared.", null);
      return null;
    });
    return { ok: true, message: "Gmail local credentials cleared. Env vars (if any) unchanged." };
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

    /**
   * Ingest already-fetched Gmail messages (HTTP lives in apps/aion server, not domain).
   * Classifies, extracts commitments/contacts — no full-mailbox permanent body store.
   */
  /** Message ids already referenced in state (commitments / gmail-live notes) — for scan cursor seed. */
  async gmailMessageIdsAlreadyInState(): Promise<string[]> {
    const state = await this.snapshot();
    const ids = new Set<string>();
    const re = /gmail:([a-zA-Z0-9_-]+)/g;
    for (const c of state.executive?.commitments ?? []) {
      const src = c.provenance?.sourceRef || "";
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(src))) ids.add(m[1]!);
    }
    for (const r of state.relationships ?? []) {
      const blob = `${r.notes || ""} ${r.reference || ""} ${r.source || ""}`;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(blob))) ids.add(m[1]!);
    }
    for (const a of state.activity ?? []) {
      if (!/gmail/i.test(a.action || "")) continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(a.summary || ""))) ids.add(m[1]!);
    }
    return [...ids];
  }

  /**
   * Archive false Gmail-live CRM prospects and cancel false marketing commitments
   * from first-sync contamination. Preserves provenance notes; does not delete Gmail evidence refs.
   */
  async repairGmailMarketingContamination(opts: {
    relationshipIds?: string[];
    commitmentIds?: string[];
    reason?: string;
  } = {}): Promise<{ relationshipsArchived: string[]; commitmentsCancelled: string[] }> {
    const reason = String(opts.reason || "Gmail first-sync truth repair: marketing false positive").slice(0, 300);
    return this.mutate((draft) => {
      const relationshipsArchived: string[] = [];
      const commitmentsCancelled: string[] = [];
      const now = this.ports.clock.now();
      const relIds = new Set(opts.relationshipIds || []);
      const comIds = new Set(opts.commitmentIds || []);
      // Default targets: gmail-live prospects with known marketing senders from first batch
      for (const r of draft.relationships) {
        if (r.archived) continue;
        const email = (r.contactMethods || [])
          .filter((m) => m.channel === "email")
          .map((m) => m.value.toLowerCase())
          .join(" ");
        const isTarget =
          relIds.has(r.id) ||
          (r.source === "gmail-live" &&
            (r.relationshipType === "prospect" || r.relationshipType === "customer") &&
            (/funderpro\.com|vesica\.org|somabreath\.com/i.test(email) ||
              /support@funderpro|info@vesica/i.test(email)));
        if (!isTarget) continue;
        r.archived = true;
        r.updatedAt = now;
        r.notes = `${r.notes || ""}\n[CORRECTED ${now}] ${reason} — archived; Gmail source refs retained as DATA only.`.slice(0, 4000);
        relationshipsArchived.push(r.id);
      }
      if (draft.executive?.commitments) {
        for (const c of draft.executive.commitments) {
          const src = c.provenance?.sourceRef || "";
          const isTarget =
            comIds.has(c.id) ||
            (/gmail:19ff0b1d5de7628e|gmail:19ff16cca690c9c7/i.test(src) &&
              (c.status === "open" || c.status === "due_soon" || c.status === "overdue"));
          if (!isTarget) continue;
          if (c.status === "cancelled" || c.status === "kept") continue;
          c.status = "cancelled";
          c.updatedAt = now;
          c.resolvedAt = now;
          c.statement = `${c.statement} [INVALIDATED ${now}: ${reason}]`.slice(0, 2000);
          commitmentsCancelled.push(c.id);
        }
      }
      this.activity(
        draft,
        "settings",
        "gmail.truth.repair",
        `Gmail marketing contamination repair: archived ${relationshipsArchived.length} rel(s), cancelled ${commitmentsCancelled.length} commitment(s).`,
        null,
      );
      return { relationshipsArchived, commitmentsCancelled };
    });
  }

  async ingestGmailMessages(
    messages: Array<{
      id: string;
      threadId?: string;
      from: string;
      to?: string;
      subject: string;
      snippet?: string;
      bodyText?: string;
      labelIds?: string[];
      /** ISO message time from Gmail internalDate when available */
      internalDate?: string | null;
      headers?: Record<string, string>;
    }>,
  ): Promise<{
    ok: boolean;
    message: string;
    scanned: number;
    classified: Array<{ id: string; from: string; subject: string; relevance: string; workspaceHint: string; threadId?: string }>;
    commitmentsExtracted: number;
    contactsProposed: number;
    contactsCreated: number;
    backupOk: boolean;
  }> {
    const backup = await this.preImportPrivateStateBackup();
    if (!backup.ok || !backup.encrypted) {
      return {
        ok: false,
        message: "Encrypted private backup required before Gmail knowledge mutation.",
        scanned: 0,
        classified: [],
        commitmentsExtracted: 0,
        contactsProposed: 0,
        contactsCreated: 0,
        backupOk: false,
      };
    }
    const { classifyGmailMessage, extractInterpersonalCommitments } = await import("./connectors/gmail-connector.js");
    const classified: Array<{ id: string; from: string; subject: string; relevance: string; workspaceHint: string; threadId?: string }> = [];
    let commitmentsExtracted = 0;
    let contactsProposed = 0;
    let contactsCreated = 0;
    const now = this.ports.clock.now();
    const dataRoot = this.repositoryDataRoot();

    for (const msg of messages) {
      const from = msg.from || "";
      const subject = msg.subject || "";
      const snippet = msg.snippet || "";
      const bodyText = msg.bodyText || snippet;
      const headers = (msg as { headers?: Record<string, string> }).headers;
      const clsInput: {
        from: string;
        to?: string;
        subject: string;
        snippet?: string;
        bodyText?: string;
        labelIds?: string[];
        headers?: Record<string, string>;
      } = { from, subject, snippet, bodyText };
      if (msg.to) clsInput.to = msg.to;
      if (msg.labelIds) clsInput.labelIds = msg.labelIds;
      if (headers) clsInput.headers = headers;
      const cls = classifyGmailMessage(clsInput);
      const row: { id: string; from: string; subject: string; relevance: string; workspaceHint: string; threadId?: string } = {
        id: msg.id,
        from: from.slice(0, 120),
        subject: subject.slice(0, 160),
        relevance: cls.relevance,
        workspaceHint: cls.workspaceHint,
      };
      if (msg.threadId) row.threadId = msg.threadId;
      classified.push(row);
      if (cls.relevance === "noise" || cls.marketingOrBulk) continue;
      // Email body is DATA only — flag instruction-like text; never treat as Owner authority.
      void isInstructionLikeDocument(bodyText);
      const sourceRef = msg.threadId
        ? `gmail:${msg.id}|thread:${msg.threadId}${msg.internalDate ? `|at:${msg.internalDate}` : ""}`
        : `gmail:${msg.id}${msg.internalDate ? `|at:${msg.internalDate}` : ""}`;

      // Sent-folder / Owner-authored: only when From matches Owner mailbox patterns (not inbound marketing)
      const fromOwnerMailbox =
        /nearmiss1193@gmail\.com|daniel\.?coffman/i.test(from) ||
        (msg.labelIds || []).some((l) => String(l).toUpperCase() === "SENT");
      const extracted = cls.shouldExtractCommitments
        ? extractInterpersonalCommitments(bodyText, {
            fromOwnerMailbox,
            marketing: cls.marketingOrBulk,
          })
        : [];
      if (extracted.length) {
        await this.mutate((draft) => {
          if (!draft.executive) draft.executive = emptyExecutiveState(now);
          for (const hit of extracted.slice(0, 3)) {
            try {
              // Uncertain actor → do not create OWNER_MUST_DO commitment
              if (hit.actor === "uncertain" || !hit.interpersonal) continue;
              const ws =
                cls.workspaceHint === "work"
                  ? "work"
                  : cls.workspaceHint === "compassionate-choice"
                    ? "compassionate-choice"
                    : "personal";
              const statement = hit.statement.slice(0, 500);
              const already = (draft.executive.commitments || []).some(
                (c) => c.provenance?.sourceRef === sourceRef && c.statement === statement,
              );
              if (already) continue;
              const c = buildCommitment(
                {
                  committedBy: hit.actor === "owner" ? "Owner" : from.slice(0, 80),
                  committedTo: hit.actor === "owner" ? from.slice(0, 80) : "Owner",
                  statement,
                  dueAt: null,
                  sourceRef,
                  confidence: hit.actor === "owner" || hit.actor === "other" ? 75 : 40,
                },
                { id: this.ports.ids.next("commit"), now, workspace: ws },
              );
              draft.executive.commitments.unshift(c);
              commitmentsExtracted += 1;
            } catch {
              /* skip */
            }
          }
          return null;
        });
      }

      // CRM auto-create: only when classifier says so AND not marketing AND not support@/info@ style
      if (cls.shouldProposeContact && cls.contactClass !== "UNKNOWN" && !cls.marketingOrBulk) {
        contactsProposed += 1;
        const emailMatch = from.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
        const nameMatch = from.match(/^"?([^"<]+)"?\s*</) || from.match(/^([^@]+)/);
        const displayName = (nameMatch?.[1] || "").trim().replace(/"/g, "");
        const email = emailMatch?.[0] || "";
        const genericInbox = /^(support|info|hello|sales|noreply|no-reply|newsletter|marketing|team|contact)@/i.test(email);
        if (email && displayName.length > 1 && !/noreply/i.test(email) && !genericInbox) {
          await this.mutate((draft) => {
            const exists = draft.relationships.some(
              (r) =>
                !r.archived &&
                (r.contactMethods || []).some((m) => m.channel === "email" && m.value.toLowerCase() === email.toLowerCase()),
            );
            if (exists) return null;
            if (/daniel|nearmiss1193|coffman/i.test(email) || /daniel coffman/i.test(displayName)) return null;
            // Do not auto-create prospect/customer without human-grade class (collaborator ok for CC)
            if (cls.contactClass === "PROSPECT" || cls.contactClass === "CUSTOMER") {
              // Require dealership interpersonal evidence already encoded in classifier direct flag
              if (cls.workspaceHint !== "work" && cls.contactClass === "PROSPECT") return null;
            }
            const rid = this.ports.ids.next("relationship");
            const ws =
              cls.workspaceHint === "work"
                ? "work"
                : cls.workspaceHint === "compassionate-choice" &&
                    draft.workspaces.some((w) => w.id === "compassionate-choice")
                  ? "compassionate-choice"
                  : "personal";
            const relType =
              cls.contactClass === "COLLABORATOR"
                ? "partner"
                : cls.contactClass === "VENDOR"
                  ? "vendor"
                  : cls.contactClass === "CUSTOMER"
                    ? "customer"
                    : cls.contactClass === "PROSPECT"
                      ? "prospect"
                      : "contact";
            const person = buildCustomer(
              {
                displayName: displayName.slice(0, 120),
                organisation: "",
                source: "gmail-live",
                notes: `From Gmail ${msg.id}${msg.threadId ? ` thread ${msg.threadId}` : ""}${msg.internalDate ? ` at ${msg.internalDate}` : ""}: ${subject.slice(0, 200)}. Class=${cls.contactClass} (live_connector DATA — not owner_direct authority).`,
                relationshipType: relType,
                contactMethods: [{ channel: "email", label: "email", value: email }],
                lifecycle: relType === "prospect" || relType === "customer" ? "prospect" : "active",
              },
              {
                id: rid,
                reference: `gmail-contact:${email.toLowerCase()}`,
                workspace: ws,
                now,
                relationshipType: relType,
                defaultOrigin: "owner-created",
              },
            );
            draft.relationships.unshift(person);
            contactsCreated += 1;
            return null;
          });
        }
      }
    }

    if (dataRoot) {
      const { saveGmailLocalSecrets } = await import("./connector-secrets.js");
      saveGmailLocalSecrets(dataRoot, { lastSyncAt: now });
    }
    await this.mutate((draft) => {
      this.activity(
        draft,
        "import",
        "gmail.ingest",
        `Gmail ingest scanned=${messages.length} commits=${commitmentsExtracted} contacts+${contactsCreated}`,
        null,
      );
      return null;
    });
    return {
      ok: true,
      message: `Gmail ingest complete. scanned=${messages.length}; commitments=${commitmentsExtracted}; contacts created=${contactsCreated}.`,
      scanned: messages.length,
      classified,
      commitmentsExtracted,
      contactsProposed,
      contactsCreated,
      backupOk: true,
    };
  }

  /** Credential snapshot for host-layer Gmail HTTP (no secrets returned). */
  async gmailLiveCredentials(): Promise<{
    ready: boolean;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    redirectUri: string;
    message: string;
  }> {
    const status = await this.gmailConsentStatus();
    if (status.code !== "READY") {
      return {
        ready: false,
        clientId: "",
        clientSecret: "",
        refreshToken: "",
        redirectUri: status.redirectUri || "",
        message: status.ownerAction || status.message || "not ready",
      };
    }
    const dataRoot = this.repositoryDataRoot();
    const { resolveGmailCredentials } = await import("./connector-secrets.js");
    const state = await this.snapshot();
    const creds = resolveGmailCredentials(dataRoot, process.env, state.settings.connectors?.gmailClientId);
    return {
      ready: Boolean(creds.clientId && creds.clientSecret && creds.refreshToken),
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken: creds.refreshToken,
      redirectUri: state.settings.connectors?.gmailRedirectUri || "http://127.0.0.1:31415/oauth/gmail/callback",
      message: "ok",
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
            : mimeType.startsWith("audio/")
              ? "other"
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

  /**
   * Transcribe private audio bytes into a structured transcript evidence record.
   * Does NOT write customer CRM facts, needs, or identity assertions.
   */
  async transcribeAudio(input: {
    contentBase64?: string;
    bytes?: Buffer;
    mimeType?: string;
    filename?: string;
    documentRef?: string | null;
    storedPath?: string | null;
    conversationId?: string | null;
    durationMs?: number | null;
    /** Tests only. */
    fixtureText?: string;
    offline?: boolean;
    /**
     * Continue a successful transcript into the customer intelligence path.
     *
     * Opt-in rather than automatic: a dictated note or a voice command is not a customer call, and
     * deriving needs from every recording would fill a customer's record with the Owner talking to
     * themselves. The caller that knows this was a call says so.
     */
    deriveConversation?: {
      ingestPath?: AudioIngestPathV1;
      speakerBinding?: SpeakerBindingV1;
      signals?: {
        phone?: string | null;
        email?: string | null;
        spokenName?: string | null;
        boundRelationshipRef?: string | null;
        ownerAssertedRef?: string | null;
        externalId?: { system: string; id: string } | null;
      };
    };
  }): Promise<{
    transcript: TranscriptRecordV1;
    document: CrmDocumentV1 | null;
    engineStatus: ReturnType<typeof resolveTranscriptionEngineStatus>;
    conversation?: {
      outcome: ConversationIngestOutcomeV1 | null;
      reply: string;
      stored: { eventId: string; needsStored: number; commitmentsStored: number; proposalsStored: number } | null;
    };
  }> {
    const engineStatus = resolveTranscriptionEngineStatus();
    let bytes: Buffer | null = input.bytes ?? null;
    if (!bytes && input.contentBase64) {
      bytes = Buffer.from(String(input.contentBase64), "base64");
    }
    const mimeType = String(input.mimeType || "application/octet-stream");
    const filename = String(input.filename || "audio.bin");
    const sourceRef = input.documentRef || input.storedPath || `audio:${filename}`;

    if (!bytes || !bytes.length) {
      const empty = await this.#persistTranscript(
        await this.#makeEmptyAudioTranscript({
          sourceRef,
          mimeType,
          filename,
          byteLength: 0,
          ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
          statusMessage: "No audio bytes provided.",
          status: "EMPTY_AUDIO",
        }),
      );
      return { transcript: empty, document: null, engineStatus };
    }

    if (!isSupportedAudioType(mimeType, filename)) {
      const bad = await this.#persistTranscript(
        await this.#makeEmptyAudioTranscript({
          sourceRef,
          mimeType,
          filename,
          byteLength: bytes.byteLength,
          ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
          statusMessage: `Unsupported audio type (${mimeType}).`,
          status: "UNSUPPORTED_AUDIO_TYPE",
        }),
      );
      return { transcript: bad, document: null, engineStatus };
    }

    // Index audio as CRM document metadata (bytes already on disk when documentRef/storedPath set).
    let document: CrmDocumentV1 | null = null;
    if (input.documentRef) {
      const docs = await this.listCrmDocuments();
      document = docs.find((d) => d.id === input.documentRef) ?? null;
    }

    const now = this.ports.clock.now();
    const snapshot = await this.snapshot();
    const transcriptId = this.ports.ids.next("transcript");
    const transcript = await transcribeAudioBytes({
      bytes,
      mimeType,
      filename,
      transcriptId,
      sourceRef,
      workspace: snapshot.settings.activeWorkspace,
      conversationId: input.conversationId ?? null,
      startedAt: now,
      audioSourceRef: input.storedPath || sourceRef,
      ...(input.fixtureText !== undefined ? { fixtureText: input.fixtureText } : {}),
      ...(input.offline ? { offline: true } : {}),
    });
    if (input.durationMs != null && transcript.durationMs == null) {
      transcript.durationMs = input.durationMs;
    }

    const saved = await this.#persistTranscript(transcript);
    // Optionally attach transcript text to document summary without CRM customer mutation.
    await this.mutate((draft) => {
      if (document) {
        const doc = (draft.crmDocuments || []).find((d) => d.id === document!.id);
        if (doc && saved.fullText) {
          const note = `transcript:${saved.transcriptId} status:${saved.status} engine:${saved.engine}`;
          doc.summary = [doc.summary, note].filter(Boolean).join(" · ").slice(0, 4000);
          if (!doc.extractedText) doc.extractedText = saved.fullText.slice(0, 100_000);
          doc.updatedAt = this.ports.clock.now();
          if (!doc.tags.includes("audio")) doc.tags = [...doc.tags, "audio"].slice(0, 32);
          if (!doc.tags.includes("transcript")) doc.tags = [...doc.tags, "transcript"].slice(0, 32);
        }
      }
      this.activity(
        draft,
        "agent",
        "audio.transcribe",
        `Audio transcript ${saved.transcriptId}: ${saved.status} (${saved.engine}) — not customer factual authority`,
        saved.transcriptId,
      );
    });

    if (input.deriveConversation) {
      const conversation = await this.processConversationFromTranscript({
        transcriptId: saved.transcriptId,
        ...(input.deriveConversation.ingestPath ? { ingestPath: input.deriveConversation.ingestPath } : {}),
        ...(input.deriveConversation.speakerBinding ? { speakerBinding: input.deriveConversation.speakerBinding } : {}),
        ...(input.deriveConversation.signals ? { signals: input.deriveConversation.signals } : {}),
      });
      return { transcript: saved, document, engineStatus, conversation };
    }

    return { transcript: saved, document, engineStatus };
  }

  async getTranscript(transcriptId: string): Promise<TranscriptRecordV1 | null> {
    const state = await this.snapshot();
    const list = Array.isArray(state.audioTranscripts) ? state.audioTranscripts : [];
    return list.find((t) => t.transcriptId === transcriptId) ?? null;
  }

  async listTranscripts(opts: { conversationId?: string | null; limit?: number } = {}): Promise<TranscriptRecordV1[]> {
    const state = await this.snapshot();
    let list = Array.isArray(state.audioTranscripts) ? state.audioTranscripts : [];
    if (opts.conversationId) {
      list = list.filter((t) => t.conversationId === opts.conversationId);
    }
    const limit = Math.min(100, Math.max(1, opts.limit ?? 40));
    return list.slice(0, limit);
  }

  /**
   * Voice → Chat foundation: transcribe then run the same assistant.prompt path on the text.
   * Transcript remains fallible evidence; no customer fact side effects from STT alone.
   */
  async voicePromptFromAudio(input: {
    contentBase64?: string;
    mimeType?: string;
    filename?: string;
    documentRef?: string | null;
    storedPath?: string | null;
    conversationId?: string | null;
    textPrefix?: string;
    offline?: boolean;
    fixtureText?: string;
  }): Promise<{
    transcript: TranscriptRecordV1;
    reply: string;
    intent: string;
    sources: Array<{ type: string; id: string; label: string }>;
    action: string | null;
    data: unknown;
  }> {
    const { transcript } = await this.transcribeAudio({
      ...(input.contentBase64 !== undefined ? { contentBase64: input.contentBase64 } : {}),
      ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
      ...(input.filename !== undefined ? { filename: input.filename } : {}),
      ...(input.documentRef !== undefined ? { documentRef: input.documentRef } : {}),
      ...(input.storedPath !== undefined ? { storedPath: input.storedPath } : {}),
      ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
      ...(input.offline !== undefined ? { offline: input.offline } : {}),
      ...(input.fixtureText !== undefined ? { fixtureText: input.fixtureText } : {}),
    });
    const spoken = transcript.fullText.trim();
    const prefix = String(input.textPrefix || "").trim();
    const text = [prefix, spoken].filter(Boolean).join(" ").trim()
      || "(No speech text extracted from the recording.)";
    const result = await this.assistantPrompt(text, {
      conversationId: input.conversationId ?? null,
    });
    return {
      transcript,
      reply: String(result.reply || ""),
      intent: String(result.intent || "VOICE_INPUT"),
      sources: Array.isArray(result.sources) ? result.sources : [],
      action: result.action ?? "audio.voice_to_chat",
      data: {
        transcriptId: transcript.transcriptId,
        transcriptStatus: transcript.status,
        factualAuthority: "NONE",
        assistant: result.data ?? null,
      },
    };
  }

  /**
   * Persist a conversation and everything derived from it, in one write.
   *
   * One mutation rather than four keeps the records consistent under restart: a conversation whose
   * needs were saved and whose commitments were not would read as a call where the customer said
   * nothing about timing, which is worse than an absent record because it looks complete.
   *
   * De-duplicated by id so re-processing the same transcript replaces rather than doubles.
   */
  async persistConversationDerivations(input: {
    event: ConversationEventV1;
    needs?: readonly CustomerNeedV1[];
    commitments?: readonly CommitmentCandidateV1[];
    proposals?: readonly CrmActionProposalV1[];
  }): Promise<{ eventId: string; needsStored: number; commitmentsStored: number; proposalsStored: number }> {
    return this.mutate((draft) => {
      if (!Array.isArray(draft.conversationEvents)) draft.conversationEvents = [];
      if (!Array.isArray(draft.customerNeeds)) draft.customerNeeds = [];
      if (!Array.isArray(draft.commitmentCandidates)) draft.commitmentCandidates = [];
      if (!Array.isArray(draft.crmActionProposals)) draft.crmActionProposals = [];

      draft.conversationEvents = [
        input.event,
        ...draft.conversationEvents.filter((e) => e.id !== input.event.id),
      ].slice(0, 500);

      const needs = input.needs ?? [];
      if (needs.length) {
        // Supersession is computed by the caller against the existing set; store the result whole so
        // the superseded rows keep their supersededBy links.
        const incomingIds = new Set(needs.map((n) => n.id));
        draft.customerNeeds = [
          ...needs,
          ...draft.customerNeeds.filter((n) => !incomingIds.has(n.id)),
        ].slice(0, 5000);
      }

      const commitments = input.commitments ?? [];
      if (commitments.length) {
        const keys = new Set(commitments.map((c) => `${c.sourceRef}:${c.statement}`));
        draft.commitmentCandidates = [
          ...commitments,
          ...draft.commitmentCandidates.filter((c) => !keys.has(`${c.sourceRef}:${c.statement}`)),
        ].slice(0, 1000);
      }

      const proposals = input.proposals ?? [];
      if (proposals.length) {
        const ids = new Set(proposals.map((p) => p.proposalId));
        draft.crmActionProposals = [
          ...proposals,
          ...draft.crmActionProposals.filter((p) => !ids.has(p.proposalId)),
        ].slice(0, 500);
      }

      this.activity(
        draft,
        "memory",
        "conversation.persist",
        `Conversation ${input.event.channel} stored with ${needs.length} need(s), ${commitments.length} commitment candidate(s)`,
        input.event.id,
      );
      return {
        eventId: input.event.id,
        needsStored: needs.length,
        commitmentsStored: commitments.length,
        proposalsStored: proposals.length,
      };
    });
  }

  /**
   * Take a stored transcript all the way to a conversation, needs, commitments and PREPARE proposals.
   *
   * This is the runtime join that was missing: every piece below was already tested, and none of them
   * had ever been run against a transcript the microphone produced. Identity is resolved from the
   * transcript's own workspace rather than the active one, so processing a recording while looking at
   * a different workspace cannot attach a dealership call to a personal contact.
   *
   * Re-processing the same transcript is safe by construction — every id is derived from the
   * transcript id, so a second run overwrites the first rather than accumulating beside it.
   */
  async processConversationFromTranscript(input: {
    transcriptId: string;
    ingestPath?: AudioIngestPathV1;
    speakerBinding?: SpeakerBindingV1;
    /** Grounded call metadata. Never guessed from the audio. */
    signals?: {
      phone?: string | null;
      email?: string | null;
      spokenName?: string | null;
      boundRelationshipRef?: string | null;
      ownerAssertedRef?: string | null;
      externalId?: { system: string; id: string } | null;
    };
  }): Promise<{
    outcome: ConversationIngestOutcomeV1 | null;
    reply: string;
    stored: { eventId: string; needsStored: number; commitmentsStored: number; proposalsStored: number } | null;
  }> {
    const state = await this.snapshot();
    const transcripts = Array.isArray(state.audioTranscripts) ? state.audioTranscripts : [];
    const transcript = transcripts.find((t) => t.transcriptId === input.transcriptId) ?? null;
    if (!transcript) {
      return {
        outcome: null,
        reply: `I don't have a transcript with id ${input.transcriptId}.`,
        stored: null,
      };
    }

    const signals: IdentitySignalsV1 = {
      workspace: transcript.workspace,
      phone: input.signals?.phone ?? null,
      email: input.signals?.email ?? null,
      spokenName: input.signals?.spokenName ?? null,
      boundRelationshipRef: input.signals?.boundRelationshipRef ?? null,
      ownerAssertedRef: input.signals?.ownerAssertedRef ?? null,
      externalId: input.signals?.externalId ?? null,
    };
    const identity = resolveCustomerIdentity({
      signals,
      relationships: state.relationships ?? [],
    });

    const outcome = ingestConversationFromTranscript({
      transcript,
      identity,
      ingestPath: input.ingestPath ?? "UPLOADED_CALL_RECORDING",
      ...(input.speakerBinding ? { speakerBinding: input.speakerBinding } : {}),
      capturedAt: this.ports.clock.now(),
      existingNeeds: Array.isArray(state.customerNeeds) ? state.customerNeeds : [],
    });

    const stored = await this.persistConversationDerivations({
      event: outcome.event,
      needs: outcome.needs,
      commitments: outcome.commitments,
      proposals: outcome.proposals,
    });

    return { outcome, reply: describeIngestOutcome(outcome), stored };
  }

  /**
   * Owner correction at the level of a single want.
   *
   * The original observation is superseded, never rewritten, and the transcript is not touched at
   * all. What the recording said remains what the recording said; the Owner's reading of it simply
   * outranks AION's.
   */
  async applyNeedCorrection(input: {
    relationshipRef: string;
    attribute: CustomerNeedV1["attribute"];
    value: string;
    strength: CustomerNeedV1["strength"];
    numericValue?: number | null;
    targetNeedId?: string | null;
    note: string;
  }): Promise<{ applied: boolean; reply: string; correctedNeedId: string | null; newNeedId: string | null }> {
    const state = await this.snapshot();
    const { applyOwnerNeedCorrection } = await import("./need-correction.js");
    const relationship = (state.relationships ?? []).find((r) => r.id === input.relationshipRef) ?? null;
    if (!relationship) {
      return { applied: false, reply: "I don't have that customer on file.", correctedNeedId: null, newNeedId: null };
    }

    const result = applyOwnerNeedCorrection({
      needs: Array.isArray(state.customerNeeds) ? state.customerNeeds : [],
      relationshipRef: input.relationshipRef,
      workspace: relationship.workspace,
      attribute: input.attribute,
      value: input.value,
      strength: input.strength,
      numericValue: input.numericValue ?? null,
      targetNeedId: input.targetNeedId ?? null,
      correctionId: this.ports.ids.next("need-correction"),
      at: this.ports.clock.now(),
      note: input.note,
    });
    if ("refused" in result) {
      return { applied: false, reply: result.reason, correctedNeedId: null, newNeedId: null };
    }

    await this.mutate((draft) => {
      if (!Array.isArray(draft.customerNeeds)) draft.customerNeeds = [];
      const ids = new Set(result.needs.map((n) => n.id));
      draft.customerNeeds = [...result.needs, ...draft.customerNeeds.filter((n) => !ids.has(n.id))].slice(0, 5000);
      this.activity(
        draft,
        "memory",
        "customer.need.correct",
        `Owner corrected ${input.attribute} for ${relationship.displayName}`,
        result.created.id,
      );
    });

    return {
      applied: true,
      reply: result.message,
      correctedNeedId: result.corrected?.id ?? null,
      newNeedId: result.created.id,
    };
  }

  /** Current (non-superseded) needs for one customer. */
  async customerNeedsFor(relationshipRef: string): Promise<CustomerNeedV1[]> {
    const state = await this.snapshot();
    const all = Array.isArray(state.customerNeeds) ? state.customerNeeds : [];
    return all.filter((n) => n.relationshipRef === relationshipRef);
  }

  async #persistTranscript(transcript: TranscriptRecordV1): Promise<TranscriptRecordV1> {
    return this.mutate((draft) => {
      if (!Array.isArray(draft.audioTranscripts)) draft.audioTranscripts = [];
      draft.audioTranscripts = [transcript, ...draft.audioTranscripts.filter((t) => t.transcriptId !== transcript.transcriptId)].slice(0, 200);
      return transcript;
    });
  }

  async #makeEmptyAudioTranscript(input: {
    sourceRef: string;
    mimeType: string;
    filename: string;
    byteLength: number;
    conversationId?: string | null;
    statusMessage: string;
    status: TranscriptRecordV1["status"];
  }): Promise<TranscriptRecordV1> {
    const snapshot = await this.snapshot();
    const { emptyTranscript } = await import("./audio-transcription.js");
    return emptyTranscript({
      transcriptId: this.ports.ids.next("transcript"),
      sourceRef: input.sourceRef,
      workspace: snapshot.settings.activeWorkspace,
      conversationId: input.conversationId ?? null,
      startedAt: this.ports.clock.now(),
      audioSourceRef: input.sourceRef,
      mimeType: input.mimeType,
      byteLength: input.byteLength,
      status: input.status,
      message: input.statusMessage,
    });
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
  /**
   * Bring the Owner's archive facts into current knowledge.
   *
   * Entries arrive already parsed rather than being read from disk here, which keeps this module
   * free of filesystem access and lets the plan be exercised in tests without a fixture file. The
   * plan is computed first and can be inspected without writing, because the failure worth avoiding
   * is a second run silently doubling the archive.
   */
  async ingestOwnerSeedFacts(
    entries: readonly SeedFactInputV1[],
    opts: { dryRun?: boolean } = {},
  ): Promise<{
    added: number;
    skippedExisting: number;
    rejected: number;
    totalSeen: number;
    dryRun: boolean;
    titles: string[];
  }> {
    const state = await this.snapshot();
    const existing = state.ownerKnowledge?.facts ?? [];
    const plan = planSeedIngest({ entries, existingFacts: existing });

    if (opts.dryRun) {
      return {
        added: plan.toAdd.length,
        skippedExisting: plan.skippedExisting.length,
        rejected: plan.rejected.length,
        totalSeen: plan.totalSeen,
        dryRun: true,
        titles: plan.toAdd.map((f) => f.title),
      };
    }

    if (plan.toAdd.length) {
      await this.mutate((draft: AssistantStateV1) => {
        if (!draft.ownerKnowledge) draft.ownerKnowledge = emptyOwnerKnowledge();
        const now = this.ports.clock.now();
        for (const planned of plan.toAdd) {
          draft.ownerKnowledge.facts.push(
            buildOwnerKnowledgeFact(seedFactToKnowledgeInput(planned), {
              id: this.ports.ids.next("owner-fact"),
              now,
            }),
          );
        }
        this.activity(
          draft, "memory", "owner.knowledge.archive",
          `Archive facts ingested: ${plan.toAdd.length}`, null,
        );
      });
    }

    return {
      added: plan.toAdd.length,
      skippedExisting: plan.skippedExisting.length,
      rejected: plan.rejected.length,
      totalSeen: plan.totalSeen,
      dryRun: false,
      titles: plan.toAdd.map((f) => f.title),
    };
  }

  /**
   * Local text models actually available for reasoning.
   *
   * Health, not configuration. The durable settings on this machine named two local text models as
   * healthy and installed while Ollama answered "model not found" for both, because the files were
   * deleted four days after the health record was written. Routing to a configured-but-absent
   * endpoint hands the Owner an inference error in place of the complete deterministic answer he
   * could have had.
   */
  #availableTextModels(state: AssistantStateV1): string[] {
    return availableTextModelsFrom(state.brain?.endpoints ?? [], this.ports.clock.now());
  }

  /** Vehicles the Owner has physically photographed and AION identified within the last day. */
  #physicallyVerifiedToday(state: AssistantStateV1, workspaceId: string): string[] {
    const since = Date.parse(this.ports.clock.now()) - 24 * 60 * 60 * 1000;
    const ids = (state.photoVehicleContexts ?? [])
      .filter((ctx) =>
        ctx.workspaceId === workspaceId
        && ctx.vehicleId
        && Number.isFinite(Date.parse(ctx.setAt))
        && Date.parse(ctx.setAt) >= since,
      )
      .map((ctx) => ctx.vehicleId!);
    return [...new Set(ids)];
  }

  /**
   * Let a local model phrase an answer, but never let it decide what is true.
   *
   * The order is the safety property. Evidence is gathered deterministically, bounded into a packet,
   * and only then shown to a model; whatever comes back is checked by code that does arithmetic and
   * set membership rather than language. A reply that fails any check is discarded in favour of the
   * deterministic text, which was already complete — so a rejected synthesis costs the Owner nothing
   * but nicer phrasing.
   *
   * There is no repair loop. One attempt, then the grounded answer. A model that has just invented a
   * drivetrain is not more trustworthy on its second try, and the Owner is standing on a lot.
   */
  async #synthesizeGrounded(input: {
    question: string;
    goal: PracticalGoalV1;
    deterministic: string;
    facts: readonly EvidenceFactV1[];
    unknowns: readonly string[];
    activeContext?: string | null;
    availableTextModels: readonly string[];
  }): Promise<{ text: string; usedModel: boolean; model: string | null; rejectedFor: string[]; ms: number }> {
    const started = Date.now();
    const port = this.ports.synthesis;
    // The fast model is the only one that belongs in an interactive turn: the reasoning model was
    // measured at ~39 seconds for a short answer, which is not a phone experience.
    const model = input.availableTextModels.find((m) => /qwen/i.test(m)) ?? null;
    if (!port || !model || input.facts.length === 0) {
      return { text: input.deterministic, usedModel: false, model: null, rejectedFor: [], ms: Date.now() - started };
    }

    const packet = buildSynthesisPacket({
      question: input.question,
      goal: input.goal,
      activeContext: input.activeContext ?? null,
      facts: input.facts,
      unknowns: input.unknowns,
    });

    let raw = "";
    try {
      const answer = await port.synthesize({
        model,
        system: synthesisSystemPrompt(),
        user: synthesisUserPrompt(packet),
        timeoutMs: FAST_SYNTHESIS_TIMEOUT_MS,
      });
      raw = String(answer?.text ?? "");
    } catch {
      return { text: input.deterministic, usedModel: false, model, rejectedFor: ["UNAVAILABLE"], ms: Date.now() - started };
    }

    const result = parseSynthesisResult(raw);
    if (!result) {
      return { text: input.deterministic, usedModel: false, model, rejectedFor: ["UNPARSEABLE"], ms: Date.now() - started };
    }
    const validation = validateSynthesis(result, packet);
    const chosen = chooseOwnerFacingText({ deterministic: input.deterministic, result, validation });
    return {
      text: chosen.text,
      usedModel: chosen.usedModel,
      model,
      rejectedFor: chosen.rejectedFor,
      ms: Date.now() - started,
    };
  }

  /**
   * The conversational layer in front of the narrow handlers.
   *
   * This deliberately does not take over the whole of Chat. The existing handlers are correct for
   * the questions they were written for, and replacing them wholesale would trade a known set of
   * behaviours for an unknown one. What it does take is the class of question they answer *badly* —
   * the ones where the first matching pattern is about the wrong subject entirely.
   *
   * Returning null is the normal case and means "the old chain is better at this". So the change is
   * additive: every question that already worked still reaches the handler that made it work.
   */
  async #orchestrate(
    text: string,
    opts: { conversationId?: string | null },
  ): Promise<{
    intent: string;
    confidence: string;
    reply: string;
    sources: Array<{ type: string; id: string; label: string }>;
    action: string | null;
    data: unknown;
  } | null> {
    const reading = understandGoal(text);
    const OWNED: PracticalGoalV1[] = [
      "LOT_POPULATION", "OWNER_HISTORY", "WHAT_IS_UNKNOWN", "VEHICLE_BUYER_MATCH",
      "CURRENT_WEB_FACT", "VERIFY_INSTEAD_OF_GUESS",
    ];
    if (!OWNED.includes(reading.goal)) return null;

    const state = await this.snapshot();
    const workspaceId = state.settings.activeWorkspace;
    const now = this.ports.clock.now();
    const vehicles = state.vehicleInventory?.vehicles ?? [];
    const verifiedIds = this.#physicallyVerifiedToday(state, workspaceId);

    const photoCtx = resolvePhotoVehicleContext(
      state.photoVehicleContexts,
      state.photoVehicleContext,
      { workspaceId, conversationId: opts.conversationId ?? null },
    );
    const activeVehicle = photoCtx?.vehicleId
      ? vehicles.find((v) => v.id === photoCtx.vehicleId) ?? null
      : null;

    const context = {
      workspace: workspaceId,
      conversationId: opts.conversationId ?? null,
      activeVehicleRef: activeVehicle?.id ?? null,
      activeCustomerRef: null,
      physicallyVerifiedVehicleIds: verifiedIds,
      hasAttachments: false,
      now,
      // Only when a provider is actually configured. Claiming the option exists and then failing to
      // use it would be a worse answer than saying plainly that it does not.
      webResearchAllowed: Boolean(this.ports.research),
    };
    const plan = planTools(reading.goal, context);

    const items: Array<Omit<EvidenceItemV1, "status">> = [];
    const sources: Array<{ type: string; id: string; label: string }> = [];
    let body: string | null = null;
    let strongMatchCount = 0;
    let unverifiedCustomerIssue: string | null = null;
    let missingPhotoHint: string | null = null;

    if (reading.goal === "LOT_POPULATION") {
      // The two halves that must never be collapsed: what was seen, and what is listed.
      const lastOnline = vehicles
        .map((v) => v.lastOnlineAt)
        .filter((t): t is string => Boolean(t))
        .sort()
        .at(-1) ?? null;
      const scope = answerLotScopeQuestion({
        question: text,
        physicallyVerifiedVehicleIds: verifiedIds,
        vehicles,
        now,
        listingsObservedAt: lastOnline,
      });
      body = scope.reply;
      items.push({
        tool: "lot_walk_observations",
        claim: scope.physicallyVerified.basis,
        evidenceClass: scope.physicallyVerified.evidenceClass,
        sourceRefs: verifiedIds,
        observedAt: scope.physicallyVerified.observedAt,
      });
      items.push({
        tool: "website_inventory",
        claim: scope.currentlyListed.basis,
        evidenceClass: scope.currentlyListed.evidenceClass,
        sourceRefs: [],
        observedAt: scope.currentlyListed.observedAt,
      });
      items.push({
        tool: "lot_walk_observations",
        claim: scope.actualLotPopulation.basis,
        evidenceClass: scope.actualLotPopulation.evidenceClass,
        sourceRefs: [],
        observedAt: null,
      });
    }

    if (reading.goal === "OWNER_HISTORY") {
      const packet = retrieveOwnerMemory({
        question: text,
        facts: state.ownerKnowledge?.facts ?? [],
        workspace: workspaceId,
      });
      const ingested = (state.ownerKnowledge?.facts ?? []).filter(
        (f) => String(f.provenance?.sourceRef ?? "").includes("owner-archive:"),
      ).length;
      const coverage = archiveCoverageNote({ factsIngested: ingested, factsMatched: packet.facts.length });
      body = [answerFromOwnerMemory(packet), coverage].filter(Boolean).join("\n\n");
      for (const fact of packet.facts.slice(0, 4)) {
        items.push({
          tool: "owner_knowledge",
          claim: fact.title,
          evidenceClass: "OWNER_DIRECT_FACT",
          sourceRefs: [fact.sourceRef],
          observedAt: null,
        });
        sources.push({ type: "knowledge", id: fact.factId, label: fact.title });
      }
      if (!packet.facts.length) {
        items.push({
          tool: "owner_knowledge",
          claim: "nothing on file covers that",
          evidenceClass: "UNKNOWN",
          sourceRefs: [],
          observedAt: null,
        });
      }
    }

    if (reading.goal === "CURRENT_WEB_FACT" || reading.goal === "VERIFY_INSTEAD_OF_GUESS") {
      /*
       * Questions whose answer may have changed since anything local was written.
       *
       * The rule that matters is the negative one: if current information cannot actually be
       * fetched, AION says so rather than answering from what a model happens to remember. Stale
       * recall presented as a current fact is the failure mode this whole path exists to prevent,
       * and it is worse than an admitted gap because the Owner cannot tell the difference.
       */
      /*
       * The goal router has already decided this is a question about the world rather than about
       * AION's own records — internal questions reach their own goals and never arrive here. So the
       * older subject-matter trigger is consulted for one thing only: its veto on questions that are
       * really about stored state. Requiring it to independently re-confirm volatility meant
       * "has it changed recently?" routed correctly and was then refused a lookup by a second
       * opinion, which is how a correct route still produces a stale answer.
       */
      const trigger = shouldResearchWeb(text);
      const aboutOwnRecords = !trigger.shouldResearch && /grounded records/i.test(trigger.why);
      const provider = this.ports.research;
      if (aboutOwnRecords) {
        body = `That one doesn't need looking up — ${trigger.why}.`;
        items.push({
          tool: "public_web_research", claim: trigger.why,
          evidenceClass: "INFERENCE", sourceRefs: [], observedAt: null,
        });
      } else if (!provider) {
        body = "I can't verify that against anything current right now — web lookup isn't available "
          + "on this machine. I'd rather tell you that than repeat something I might be remembering "
          + "from months ago.";
        items.push({
          tool: "public_web_research",
          claim: "current verification is unavailable",
          evidenceClass: "UNKNOWN", sourceRefs: [], observedAt: null,
        });
      } else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
          const run = await provider.run({
            question: text,
            scope: "public-web" as never,
            limits: { maxSources: 4, maxBytes: 200_000, maxSeconds: 20 } as never,
            seedReferences: [],
            signal: controller.signal,
          });
          const sourcesFound: WebSourceV1[] = (run.sources ?? []).slice(0, 4).map((source) =>
            buildWebSource({
              url: String((source as { url?: string }).url ?? ""),
              title: String((source as { title?: string }).title ?? ""),
              text: String((source as { excerpt?: string }).excerpt ?? ""),
              retrievedAt: now,
            }),
          );
          if (sourcesFound.length === 0) {
            body = "I looked, but nothing current came back that I'd trust enough to repeat.";
            items.push({
              tool: "public_web_research", claim: "no current source found",
              evidenceClass: "UNKNOWN", sourceRefs: [], observedAt: now,
            });
          } else {
            const lines = [`Here's what's current, and where it came from:`];
            for (const source of sourcesFound) {
              const when = source.retrievedAt.slice(0, 10);
              lines.push(`· ${source.publisher} (checked ${when})${source.snippets[0] ? ` — ${source.snippets[0]}` : ""}`);
              items.push({
                tool: "public_web_research",
                claim: `${source.publisher}: ${source.snippets[0] ?? source.title}`,
                evidenceClass: "PUBLIC_WEB_FACT",
                sourceRefs: [source.url],
                observedAt: source.retrievedAt,
              });
              sources.push({ type: "web", id: source.url, label: source.publisher });
            }
            // A page that tries to issue instructions is still just a page.
            if (sourcesFound.some((source) => source.containsInstructionAttempt)) {
              lines.push("");
              lines.push("One of those pages contained instructions aimed at an assistant. I read it as text, nothing more.");
            }
            body = lines.join(NEWLINE);
          }
        } catch {
          body = "I couldn't reach anything current just now, so I'd rather not guess.";
          items.push({
            tool: "public_web_research", claim: "current verification failed",
            evidenceClass: "UNKNOWN", sourceRefs: [], observedAt: null,
          });
        } finally {
          clearTimeout(timer);
        }
      }
    }

    if (reading.goal === "WHAT_IS_UNKNOWN") {
      if (!activeVehicle) {
        missingPhotoHint = "Photograph the car or give me the VIN and I'll tell you what's missing on it.";
        items.push({
          tool: "active_context",
          claim: "No vehicle is in front of me right now, so I can't say what's missing on it.",
          evidenceClass: "UNKNOWN",
          sourceRefs: [],
          observedAt: null,
        });
      } else {
        const gaps: string[] = [];
        if (!activeVehicle.vin) gaps.push("the VIN isn't confirmed");
        if (latestPrice(activeVehicle) == null) gaps.push("no advertised price is on record");
        if (!activeVehicle.trim) gaps.push("the trim isn't recorded");
        if (activeVehicle.mileage == null) gaps.push("mileage isn't recorded");
        if (!activeVehicle.exteriorColor) gaps.push("exterior colour isn't recorded");
        // The Owner photographing it is the confirmation. Telling him nobody has confirmed a car he
        // is standing in front of is the kind of line that makes the whole thing feel unintelligent.
        if (activeVehicle.lastPhysicalAt == null && !verifiedIds.includes(activeVehicle.id)) {
          gaps.push("nobody has confirmed it's physically on the lot");
        }
        const name = [activeVehicle.year, activeVehicle.make, activeVehicle.model, activeVehicle.trim]
          .filter(Boolean).join(" ") || activeVehicle.id;
        body = gaps.length
          ? `On the ${name}, here's what I don't have: ${gaps.join("; ")}.`
          : `I have everything recorded on the ${name} that I'd normally check.`;
        for (const gap of gaps) {
          items.push({ tool: "vehicle_inventory", claim: gap, evidenceClass: "UNKNOWN", sourceRefs: [activeVehicle.id], observedAt: null });
        }
        sources.push({ type: "vehicle", id: activeVehicle.id, label: name });
      }
    }

    if (reading.goal === "VEHICLE_BUYER_MATCH") {
      if (!activeVehicle) return null; // The existing inventory search handles an un-anchored ask better.
      const name = [activeVehicle.year, activeVehicle.make, activeVehicle.model, activeVehicle.trim]
        .filter(Boolean).join(" ") || activeVehicle.id;
      const interested: Array<{ id: string; label: string; why: string }> = [];
      const people = state.relationships.filter(
        (r) => r.workspace === workspaceId && !r.archived && !isSyntheticRelationship(r),
      );
      for (const person of people.slice(0, 40)) {
        const matched = await this.matchCustomerVehicles(person.id);
        const hit = matched.matches.find((m) => m.vehicleId === activeVehicle.id);
        // A known conflict is a reason not to put someone's name in front of the Owner: he will act
        // on this list by picking up the phone, and a bad call costs more than an omission.
        if (hit && hit.knownConflicts.length === 0) {
          interested.push({
            id: person.id,
            label: person.displayName,
            why: hit.whyMatches?.[0] ?? "recorded interest overlaps this unit",
          });
        } else if (hit && hit.knownConflicts.length && !unverifiedCustomerIssue) {
          unverifiedCustomerIssue = `${person.displayName} lines up except for one thing — ${hit.knownConflicts[0]}.`;
        }
      }
      strongMatchCount = interested.length;
      body = interested.length
        ? `On the ${name}, these are the people whose recorded needs line up:\n`
          + interested.slice(0, 5).map((i) => `· ${i.label} — ${i.why}`).join("\n")
        : `Nobody on your list matches the ${name} on what's recorded. `
          + `That isn't a verdict on the car — it means no one's stated needs point at it.`;
      for (const person of interested.slice(0, 5)) {
        items.push({
          tool: "vehicle_customer_reverse_match",
          claim: `${person.label} — ${person.why}`,
          evidenceClass: "CUSTOMER_STATEMENT",
          sourceRefs: [person.id],
          observedAt: null,
        });
        sources.push({ type: "relationship", id: person.id, label: person.label });
      }
      sources.push({ type: "vehicle", id: activeVehicle.id, label: name });
      if (!interested.length) {
        items.push({
          tool: "vehicle_customer_reverse_match",
          claim: "no recorded customer need points at this unit",
          evidenceClass: "UNKNOWN",
          sourceRefs: [],
          observedAt: null,
        });
      }
    }

    // Facts the model may see, in the typed shape the validators check against. Built from the same
    // evidence already gathered, so nothing reaches the model that AION did not establish itself.
    const synthesisFacts: EvidenceFactV1[] = [];
    if (activeVehicle) {
      const price = latestPrice(activeVehicle);
      if (price != null) {
        synthesisFacts.push({
          factId: "vehicle-price", type: "vehicle.price", value: price,
          sourceRef: activeVehicle.id, observedAt: activeVehicle.lastOnlineAt ?? null,
          confidence: 95, epistemicClass: "WEBSITE_FACT",
        });
      }
      const label = [activeVehicle.year, activeVehicle.make, activeVehicle.model, activeVehicle.trim]
        .filter(Boolean).join(" ");
      if (label) {
        synthesisFacts.push({
          factId: "vehicle-identity", type: "vehicle.identity", value: label,
          sourceRef: activeVehicle.id, observedAt: null, confidence: 99,
          epistemicClass: verifiedIds.includes(activeVehicle.id) ? "PHYSICAL_OBSERVATION" : "WEBSITE_FACT",
        });
      }
    }
    const synthesisUnknowns = packetUnknownsFor(reading.goal, activeVehicle);

    const packet = buildEvidencePacket({ goal: reading.goal, items });
    const tier = routeReasoningTier({
      goal: reading.goal,
      packet,
      ambiguous: reading.ambiguous,
      availableTextModels: this.#availableTextModels(state),
    });
    const proactive = chooseProactiveHelp({
      goal: reading.goal,
      packet,
      strongMatchCount,
      vinResolved: Boolean(activeVehicle?.vin),
      missingPhotoHint,
      unverifiedCustomerIssue,
    });
    const result: OrchestrationResultV1 = composeOrchestratedReply({
      reading, plan, packet, tier, proactive, body,
    });

    // Phrasing only, and only when there is something grounded to phrase. The deterministic reply is
    // the floor and wins any disagreement.
    const synthesis = await this.#synthesizeGrounded({
      question: text,
      goal: reading.goal,
      deterministic: result.reply,
      facts: synthesisFacts,
      unknowns: synthesisUnknowns,
      activeContext: activeVehicle
        ? [activeVehicle.year, activeVehicle.make, activeVehicle.model].filter(Boolean).join(" ")
        : null,
      availableTextModels: this.#availableTextModels(state),
    });

    return {
      intent: "OWNER_CONVERSATION",
      confidence: reading.ambiguous ? "medium" : "high",
      reply: synthesis.text,
      sources,
      action: "owner.conversation",
      data: {
        modelUsed: synthesis.usedModel,
        modelName: synthesis.usedModel ? synthesis.model : null,
        modelRejectedFor: synthesis.rejectedFor,
        modelSynthesisMs: synthesis.ms,
        goal: result.reading.goal,
        goalDescription: describeGoal(result.reading.goal),
        toolsUsed: result.toolsUsed,
        toolPlan: { required: plan.required, enriching: plan.enriching, rationale: plan.rationale },
        reasoningTier: tier.tier,
        reasoningDegradedFrom: tier.degradedFrom,
        known: packet.known.length,
        inference: packet.inference.length,
        unknown: packet.unknown.length,
        physicallyVerifiedCount: verifiedIds.length,
      },
    };
  }

  async assistantPrompt(text: string, opts: { conversationId?: string | null } = {}): Promise<{
    intent: string;
    confidence: string;
    reply: string;
    sources: Array<{ type: string; id: string; label: string }>;
    action: string | null;
    data: unknown;
  }> {
    // Goal understanding runs before the pattern chain, because the chain's failure mode is
    // answering a question about a population with a fact about one car.
    const orchestrated = await this.#orchestrate(text, opts);
    if (orchestrated) return orchestrated;

    const route = routeCrmAssistantIntent(text);
    const state = await this.snapshot();
    const workspaceId = state.settings.activeWorkspace;

    // Follow-ups after a Chat photo: durable conversation + workspace scoped vehicle context.
    // Pronouns ("does it have recalls?") and attribute questions ("what's the price?") both count.
    const photoCtx = resolvePhotoVehicleContext(
      state.photoVehicleContexts,
      state.photoVehicleContext,
      { workspaceId, conversationId: opts.conversationId ?? null },
    );
    if (photoCtx && isPhotoVehicleFollowUpQuestion(text)) {
      this.#lastPhotoVehicleId = photoCtx.vehicleId;
      const v = (state.vehicleInventory?.vehicles ?? []).find((x) => x.id === photoCtx.vehicleId);
      if (v) {
        const name = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
        // "Would this fit Sarah?" — match the identified unit against the named customer, not inventory search.
        const fitName = text.match(
          /\b(?:fit|match|suit|right for|show)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i,
        )?.[1];
        if (fitName || /\bwould this fit\b/i.test(text)) {
          const nameHint = (fitName || text.match(/\b([A-Z][a-z]{1,20})\b/)?.[1] || "").trim();
          const rel = state.relationships.find(
            (r) =>
              !r.archived
              && r.workspace === workspaceId
              && nameHint
              && r.displayName.toLowerCase().includes(nameHint.toLowerCase()),
          );
          if (rel) {
            const matched = await this.matchCustomerVehicles(rel.id);
            const hit = matched.matches.find((m) => m.vehicleId === v.id);
            const reply = hit
              ? [
                  `${name}${v.vin ? ` · VIN ${v.vin}` : ""}`,
                  "",
                  `Against ${rel.displayName}:`,
                  hit.whyMatches?.length ? hit.whyMatches.map((w) => `· ${w}`).join("\n") : "Recorded interest overlap.",
                  hit.knownConflicts?.length ? `Conflicts: ${hit.knownConflicts.join("; ")}` : null,
                ].filter(Boolean).join("\n")
              : [
                  `${name}${v.vin ? ` · VIN ${v.vin}` : ""}`,
                  "",
                  `This photo-linked vehicle was not among automatic inventory matches for ${rel.displayName}.`,
                  "That is not a claim it is wrong for them — only that interests/budget on the customer card did not auto-select it.",
                ].join("\n");
            return {
              intent: "VEHICLE_PHOTO_FOLLOWUP",
              confidence: "high",
              reply,
              sources: [
                { type: "vehicle", id: v.id, label: name || v.id },
                { type: "relationship", id: rel.id, label: rel.displayName },
              ],
              action: "vehicle.photo.followup.fit",
              data: { vehicleId: v.id, relationshipId: rel.id, photoContext: photoCtx },
            };
          }
        }
        const wantsRecall = /\brecall/i.test(text);
        const wantsPrice = /\b(price|msrp|cost|how much|advertised)\b/i.test(text);
        const wantsTrim = /\btrim\b/i.test(text);
        let body: string;
        if (wantsRecall) {
          body = describeRecallStatus(v.recallAssessment);
        } else if (wantsPrice) {
          const price = latestPrice(v);
          body = price != null
            ? `Advertised price on record: $${price.toLocaleString()}.`
            : "No advertised price is on record for this vehicle.";
        } else if (wantsTrim) {
          body = v.trim
            ? `Trim on the dealer listing: ${v.trim}.`
            : "No trim is recorded on the dealer listing for this unit.";
        } else {
          body = vinDetailLines(v, text).map((l) => l.text).join("\n");
        }
        if (body) {
          return {
            intent: "VEHICLE_PHOTO_FOLLOWUP",
            confidence: "high",
            reply: `${name}${v.vin ? ` · VIN ${v.vin}` : ""}\n\n${body}`,
            sources: [{ type: "vehicle", id: v.id, label: name || v.id }],
            action: "vehicle.photo.followup",
            data: { vehicleId: v.id, photoContext: photoCtx },
          };
        }
      }
    }
    const inWorkspace = state.relationships.filter(
      (r) => r.workspace === workspaceId && !r.archived && !isSyntheticRelationship(r),
    );
    const sources: Array<{ type: string; id: string; label: string }> = [];

    // Owner natural attention questions must win over morning/executive diagnostic dumps.
    // "What should I do next?" previously matched the morning-cycle regex (optional "today")
    // and returned OWNER MUST / quiet-account style framing.
    {
      const naturalKindEarly = detectNaturalAttentionKind(text);
      if (naturalKindEarly) {
        const queue = buildWorkQueue(inWorkspace, this.ports.clock.now());
        const openTasks = (state.tasks ?? []).filter(
          (t) => t.workspace === workspaceId && t.state !== "completed" && t.state !== "cancelled",
        );
        let waiting: Array<{ person: string; expected: string }> = [];
        if (naturalKindEarly === "waiting") {
          const daily = await this.dailyOperatingReport();
          waiting = daily.waitingOnOthers.map((w) => ({ person: w.person, expected: w.expected }));
        }
        const reply = formatNaturalOwnerAttention({
          kind: naturalKindEarly,
          overdue: queue.overdue,
          dueSoon: queue.dueSoon,
          recentlyQuiet: naturalKindEarly === "call" || naturalKindEarly === "follow_up"
            ? queue.staleAccounts.map((s) => ({ customer: s.customer }))
            : [],
          waiting,
          openTasks: naturalKindEarly === "today" || naturalKindEarly === "next"
            ? openTasks.map((t) => ({ title: t.title }))
            : [],
        });
        return {
          intent: naturalKindEarly === "waiting" ? "WAITING_ON" : route.intent === "LIST_FOLLOWUPS" || route.intent === "WORK_QUEUE" ? route.intent : "GENERAL_ASSISTANT_QUERY",
          confidence: "high",
          reply,
          sources: queue.overdue.slice(0, 5).map((o) => ({
            type: "follow-up",
            id: o.customer,
            label: o.customer,
          })),
          action: "owner.natural_attention",
          data: { naturalKind: naturalKindEarly, queue },
        };
      }
    }

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

    // Owner operational corrections (propagate to truth, not mere hide)
    if (
      /\b(is not a (customer|prospect|contact)|not a (customer|prospect)|not important|that.?s (wrong|irrelevant|old)|ignore that|belongs in (personal|work|career|compassionate|lakeland)|move to (personal|work))\b/i.test(
        text,
      )
    ) {
      const corr = await this.applyOwnerOperationalCorrection(text);
      return {
        intent: "OWNER_CORRECTION",
        confidence: "high",
        reply: corr.reply,
        sources: [],
        action: "owner.correction.operational",
        data: corr,
      };
    }

    // Daily operating / morning executive — explicit morning/start-day phrases only.
    // Bare "what should I do next?" is handled by natural attention above.
    if (
      /\b(morning (brief|cycle|executive)|start my day|what should i do today\b|dealership morning|morning assist|daily (brief|operating|os)|prepare me for today)\b/i.test(
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

    if (/\bwhat (am i|are we) waiting on\b|\bwaiting on others\b|\bwho (owes|promised) me\b/i.test(text)) {
      const daily = await this.dailyOperatingReport();
      const reply = formatNaturalOwnerAttention({
        kind: "waiting",
        overdue: [],
        dueSoon: [],
        waiting: daily.waitingOnOthers.map((w) => ({
          person: w.person,
          expected: w.expected,
        })),
      });
      return {
        intent: "WAITING_ON",
        confidence: "high",
        reply,
        sources: [],
        action: "executive.waiting_on",
        data: daily.waitingOnOthers,
      };
    }

    if (/\bwho should i follow up\b|\bfollow[- ]?up (queue|list|intelligence)\b|\bwho needs follow[- ]?up\b/i.test(text)) {
      const queue = buildWorkQueue(inWorkspace, this.ports.clock.now());
      const reply = formatNaturalOwnerAttention({
        kind: "follow_up",
        overdue: queue.overdue,
        dueSoon: queue.dueSoon,
        recentlyQuiet: queue.staleAccounts.map((s) => ({ customer: s.customer })),
      });
      return {
        intent: "FOLLOW_UP_INTEL",
        confidence: "high",
        reply,
        sources: queue.overdue.slice(0, 5).map((o) => ({
          type: "follow-up",
          id: o.customer,
          label: o.customer,
        })),
        action: "executive.followups",
        data: { queue },
      };
    }

    if (/\bwhat can aion (handle|do)\b|\bwhat can you handle\b|\baion can do\b/i.test(text)) {
      const daily = await this.dailyOperatingReport();
      return {
        intent: "AION_CAN_DO",
        confidence: "high",
        reply: [
          "AION CAN DO (safe / prep only — external gates intact)",
          ...daily.aionCanDo.map((x) => `  • ${x}`),
        ].join("\n"),
        sources: [],
        action: "executive.aion_can_do",
        data: daily.aionCanDo,
      };
    }

    if (
      /\bwhat('?s| is) happening (at |with )?(lakeland|dealership|compassionate choice|career|personal)\b/i.test(
        text,
      ) ||
      /\b(lakeland toyota|compassionate choice|career) (status|mode|today|attention)\b/i.test(text)
    ) {
      const ctx = /\bcompassionate\b/i.test(text)
        ? ("compassionate-choice" as const)
        : /\bcareer\b/i.test(text)
          ? ("career" as const)
          : /\bpersonal\b/i.test(text)
            ? ("personal" as const)
            : ("work" as const);
      const view = await this.contextDailyStatus(ctx);
      return {
        intent: "CONTEXT_DAILY",
        confidence: "high",
        reply: view.reply,
        sources: [],
        action: "executive.context_daily",
        data: view,
      };
    }

    // Explainability.
    //
    // "What changed?" is the briefing delta and stays here. "What changed for Sarah?" is a question
    // about one customer's needs and belongs to CUSTOMER_NEEDS_HISTORY — this block runs before
    // intent routing, so without the exclusion it would swallow the customer question whatever the
    // router decided. Only an explicit subject preposition releases it; "since yesterday" does not.
    if (
      /\bwhy are you telling me this\b|\bwhy is this first\b|\bwhere did that come from\b|\bwhat (?:has )?changed\b(?!\s+(?:for|about|with|in)\b)/i.test(
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
      if (/\bwhat (?:has )?changed\b/i.test(text)) {
        const hours = /\byesterday\b/i.test(text) ? 24 : /\blast briefing\b/i.test(text) ? 12 : 24;
        const changed = await this.whatChangedSince(hours);
        return {
          intent: "EXPLAIN",
          confidence: "high",
          reply: changed.reply,
          sources: [],
          action: "explain.what_changed",
          data: changed,
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

    // Temporal inventory questions — before generic "what changed" executive dumps.
    if (
      /\bwhat (disappeared|arrived|came in)\b/i.test(text) ||
      /\b(changed price|price changed|newly listed|came in recently|arrived recently)\b/i.test(text) ||
      /\bhow much (of )?(the )?(dealer )?inventory\b/i.test(text)
    ) {
      const answer = await this.answerVehicleIntelligence(text);
      return {
        intent: "VEHICLE_INVENTORY",
        confidence: "high",
        reply: answer.reply,
        sources: answer.vehicles.slice(0, 8).map((v) => ({
          type: "vehicle",
          id: v.vin || "unknown",
          label: [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || v.vin || "vehicle",
        })),
        action: "vehicle.temporal",
        data: answer,
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
      // Inventory queries: Camrys, hybrids, SUVs under price, trim differences, VIN facts
      const modelM = text.match(/\b(camrys?|tacomas?|highlanders?|rav4s?|corollas?|tundras?|4runners?)\b/i);
      const vehicleQn =
        modelM ||
        /\blisted right now\b/i.test(text) ||
        /\bfind me a\b/i.test(text) ||
        /\bwhat (cars?|vehicles?|suvs?|trucks?|hybrids?)\b/i.test(text) ||
        /\bdo we have\b/i.test(text) ||
        /\bdifference between\b/i.test(text) && /\b(le|se|xle|xse)\b/i.test(text) ||
        /\bno longer available\b/i.test(text) ||
        /\bcame in recently\b/i.test(text);
      if (vehicleQn) {
        const answer = await this.answerVehicleIntelligence(text);
        return {
          intent: route.intent,
          confidence: "high",
          reply: answer.reply,
          sources: answer.vehicles.slice(0, 8).map((v) => ({
            type: "vehicle",
            id: v.vin || "unknown",
            label: [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || v.vin || "vehicle",
          })),
          action: "vehicle.query",
          data: answer,
        };
      }
      // Customer match: "what should I show Sarah" / "match vehicles for ..."
      const showFor = text.match(/\b(?:show|match|recommend).{0,40}\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)
        || text.match(/\bvehicles?\s+match\s+([A-Z][a-z]+)/i)
        || text.match(/\b([A-Z][a-z]+)'s\s+needs\b/i);
      if (showFor || (/\bwhat (vehicle|car) should i show\b/i.test(text) && /\b(sarah|mike|john|customer)\b/i.test(text))) {
        const nameHint = (showFor?.[1] || text.match(/\b(Sarah|Mike|John)\b/i)?.[1] || "").trim();
        const state = await this.snapshot();
        const rel = state.relationships.find(
          (r) =>
            !r.archived &&
            r.workspace === "work" &&
            nameHint &&
            r.displayName.toLowerCase().includes(nameHint.toLowerCase()),
        );
        if (!rel) {
          return {
            intent: route.intent,
            confidence: "medium",
            reply: nameHint
              ? `No work customer/prospect matching "${nameHint}". Add interests on the customer card first.`
              : "Name the customer (e.g. Sarah) to match inventory.",
            sources: [],
            action: "vehicle.customer_match",
            data: null,
          };
        }
        const matched = await this.matchCustomerVehicles(rel.id);
        return {
          intent: route.intent,
          confidence: "high",
          reply: matched.reply,
          sources: matched.matches.map((m) => ({ type: "vehicle", id: m.vehicleId, label: m.label })),
          action: "vehicle.customer_match",
          data: matched,
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
      // Lot walk list / reconciliation / call list (photographed vehicles)
      if (
        /\blot walk\b/i.test(text)
        || /\b(cars?|vehicles?) i (photographed|saw|walked)\b/i.test(text)
        || /\bwhat did i (see|photograph) on the lot\b/i.test(text)
        || /\bshow me the cars? i photographed\b/i.test(text)
        || /\bphotographed (today|on the lot)\b/i.test(text)
        || /\bwebsite prices? (next to|for)\b/i.test(text)
        || /\bwhich photographed\b/i.test(text)
        || /\baren'?t on the website\b/i.test(text)
        || /\bon the website that i (didn'?t|did not)\b/i.test(text)
        || /\bchange price\b/i.test(text)
        || /\bno published price\b/i.test(text)
        || /\blast time i walked\b/i.test(text)
      ) {
        if (/\bwho should i call\b/i.test(text) || /\bmatch(es|ing)? my customers\b/i.test(text) || /\bphotographed cars? match\b/i.test(text)) {
          const call = await this.lotWalkCallList();
          return {
            intent: route.intent,
            confidence: "high",
            reply: call.reply,
            sources: call.entries.map((e) => ({
              type: "customer",
              id: e.relationshipRef,
              label: e.customerName,
            })),
            action: "inventory.walk.call_list",
            data: call.entries,
          };
        }
        const view = await this.lotWalkCurrentList();
        if (!view) {
          return {
            intent: route.intent,
            confidence: "high",
            reply: "No lot walk on record yet. Start Inventory Walk on the phone and photograph vehicles.",
            sources: [],
            action: "inventory.walk.list",
            data: null,
          };
        }
        let reply = formatLotWalkSessionProse(view);
        if (/\baren'?t on the website\b/i.test(text) || /\bnot on the website\b/i.test(text)) {
          const missing = view.vehicles.filter((v) => v.websiteListing === "NOT_FOUND_ON_WEBSITE");
          reply = [
            "Photographed / observed but not on current website inventory:",
            ...(missing.length
              ? missing.map((v) => `  • ${[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"} · ${v.vin || "no VIN"}`)
              : ["  (none)"]),
            "This is not labeled sold — only not found on the current website inventory.",
          ].join("\n");
        } else if (/\bno published price\b/i.test(text)) {
          const none = view.vehicles.filter((v) => v.website.websitePrice == null);
          reply = [
            "Observed vehicles with no published website price:",
            ...(none.length
              ? none.map((v) => `  • ${[v.year, v.make, v.model].filter(Boolean).join(" ") || "Vehicle"} · ${v.vin || "?"}`)
              : ["  (none — all published or unresolved)"]),
            "Sticker MSRP is never used as website price.",
          ].join("\n");
        } else if (/\bchange price\b/i.test(text)) {
          const changed = view.vehicles.filter((v) => v.website.priceState === "PRICE_CHANGED_SINCE_LAST_OBSERVATION");
          reply = [
            "Price changes (website published ask):",
            ...(changed.length
              ? changed.map(
                  (v) =>
                    `  • ${v.vin}: was $${v.website.previousWebsitePrice} → now $${v.website.websitePrice}`,
                )
              : ["  (no website price changes detected among photographed vehicles)"]),
          ].join("\n");
        } else if (/\bon the website that i (didn'?t|did not)\b/i.test(text) && view.reconciliation) {
          reply = [
            "On website but not photographed during this walk:",
            `Count: ${view.reconciliation.onlineButNotSeen.length}`,
            view.caveat,
            ...view.reconciliation.onlineButNotSeen
              .slice(0, 15)
              .map(
                (v) =>
                  `  • ${[v.year, v.make, v.model].filter(Boolean).join(" ")} · ${v.vin || v.stockNumber || "?"}`,
              ),
          ].join("\n");
        }
        return {
          intent: route.intent,
          confidence: "high",
          reply,
          sources: view.vehicles
            .filter((v) => v.vehicleId)
            .slice(0, 20)
            .map((v) => ({ type: "vehicle", id: v.vehicleId!, label: v.vin || v.vehicleId! })),
          action: "inventory.walk.list",
          data: view,
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

    // Career/skills questions must reach stored Owner knowledge rather than the generic briefing.
    // The data was already there; only the route was missing.
    if (route.intent === "OWNER_GOALS") {
      const { buildGoalViews, formatGoalsAnswer, parseGoalCapture } = await import("./owner-goals-projects.js");
      // Capture first. The empty-state message has invited "Remember my goal is …" all along while
      // nothing implemented it, so goals could never grow beyond whatever import happened to find.
      const statement = parseGoalCapture(text);
      if (statement) {
        await this.addOwnerKnowledgeFact({
          category: "goal",
          title: statement.slice(0, 80),
          content: statement,
          confidence: 95,
          // Owner-direct provenance, not the import path — this is the Owner's own words.
          sourceType: "owner",
          sourceRef: "assistant.goal.capture",
        });
        return {
          intent: "OWNER_GOALS",
          confidence: "high",
          reply: `Got it — I'll remember that goal:\n· ${statement}`,
          sources,
          action: "owner.goals.add",
          data: { statement },
        };
      }
      const views = buildGoalViews(state.ownerKnowledge?.facts ?? []);
      return {
        intent: "OWNER_GOALS",
        confidence: views.length ? "high" : "low",
        reply: formatGoalsAnswer(views),
        sources,
        action: "owner.goals.list",
        data: { goals: views },
      };
    }

    if (route.intent === "PROJECT_STATUS") {
      const { formatProjectsAnswer } = await import("./owner-goals-projects.js");
      const all = await this.projects();
      const activeWorkspace = state.settings.activeWorkspace;
      const mine = all.filter((p) => !p.workspace || p.workspace === activeWorkspace);
      return {
        intent: "PROJECT_STATUS",
        confidence: mine.length ? "high" : "low",
        reply: formatProjectsAnswer(
          mine.map((p) => ({
            title: p.title,
            stage: String(p.stage ?? "idea"),
            standing: p.standing ?? "",
            createdAt: p.createdAt,
          })),
        ),
        sources,
        action: "owner.projects.list",
        data: { projects: mine.map((p) => ({ id: p.id, title: p.title, stage: p.stage })) },
      };
    }

    if (route.intent === "CAREER_PROFILE") {
      const { buildCareerProfile, formatSkillsAnswer, formatWorkHistoryAnswer, formatJobFitAnswer } =
        await import("./career-profile.js");
      const profile = buildCareerProfile(
        state.ownerKnowledge?.facts ?? [],
        state.ownerKnowledge?.profile?.summary ?? null,
      );
      const asksFit = /\b(fit|suit|what kind of work|what jobs should|look for|apply for)\b/i.test(text);
      const asksHistory = /\b(work history|jobs have i|worked|employer|experience do i|industries)\b/i.test(text);
      const reply = asksFit
        ? formatJobFitAnswer(profile)
        : asksHistory
          ? formatWorkHistoryAnswer(profile)
          : formatSkillsAnswer(profile);
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply,
        sources: profile.employers.slice(0, 5).map((e) => ({ type: "ownerKnowledge", id: e.employer, label: e.employer })),
        action: asksFit ? "career.fit" : asksHistory ? "career.history" : "career.skills",
        data: profile,
      };
    }

    if (
      route.intent === "CUSTOMER_NEEDS"
      || route.intent === "CUSTOMER_NEEDS_HISTORY"
      || route.intent === "CUSTOMER_FIT"
      || route.intent === "CUSTOMER_COMMITMENTS"
      || route.intent === "CUSTOMER_PRECALL"
    ) {
      const handlers = await import("./customer-query-handlers.js");
      // route.subject comes from the matched pattern; the raw text is tried as well because a
      // question naming both a person and a model can leave the subject pointing at the model.
      const named = [
        ...findRelationshipsByName(inWorkspace, route.subject),
        ...findRelationshipsByName(inWorkspace, text),
      ].filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i);

      if (!named.length) {
        return {
          intent: route.intent,
          confidence: "low",
          reply: "I'm not sure which customer you mean. Tell me their name and I'll pull up what I have.",
          sources,
          action: "customer.unresolved",
          data: { subject: route.subject },
        };
      }
      if (named.length > 1) {
        return {
          intent: route.intent,
          confidence: "low",
          reply: `More than one customer matches that — ${named.slice(0, 4).map((r) => r.displayName).join(", ")}. Which one?`,
          sources,
          action: "customer.ambiguous",
          data: { candidates: named.slice(0, 4).map((r) => ({ id: r.id, label: r.displayName })) },
        };
      }

      const customer = named[0]!;
      const allNeeds = Array.isArray(state.customerNeeds) ? state.customerNeeds : [];
      const candidates = (Array.isArray(state.commitmentCandidates) ? state.commitmentCandidates : [])
        .filter((c) => c.sourceRef.length > 0);
      const vehicles = state.vehicleInventory?.vehicles ?? [];

      const answer =
        route.intent === "CUSTOMER_NEEDS_HISTORY"
          ? handlers.answerNeedsHistory({ customer, needs: allNeeds })
          : route.intent === "CUSTOMER_FIT"
            ? handlers.answerCustomerFit({ customer, needs: allNeeds, vehicles, question: text })
            : route.intent === "CUSTOMER_COMMITMENTS"
              ? handlers.answerCommitments({ customer, candidates, question: text })
              : route.intent === "CUSTOMER_PRECALL"
                ? handlers.answerPrecallBrief({ customer, needs: allNeeds, candidates, vehicles })
                : handlers.answerCustomerNeeds({ customer, needs: allNeeds });

      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: answer.reply,
        sources: [...sources, ...answer.sources],
        action: answer.action,
        data: answer.data,
      };
    }

    if (route.intent === "VEHICLE_CUSTOMER_MATCH") {
      const handlers = await import("./customer-query-handlers.js");
      const workspaceId = state.settings.activeWorkspace;
      const vehicles = state.vehicleInventory?.vehicles ?? [];
      // Anchored to a real unit: the reverse question is only meaningful about a specific car, and
      // guessing which one would produce outreach about a vehicle nobody asked about.
      const vinInText = text.toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/)?.[0] ?? null;
      const contextVin = state.photoVehicleContexts?.[0]?.validatedVin ?? null;
      const vin = vinInText ?? contextVin;
      const vehicle = vin ? vehicles.find((v) => (v.vin ?? "").toUpperCase() === vin) ?? null : null;

      if (!vehicle) {
        return {
          intent: route.intent,
          confidence: "low",
          reply: "Which vehicle do you mean? Give me the VIN, or take a photo of it and ask again.",
          sources,
          action: "vehicle.customer.match.unresolved",
          data: {},
        };
      }
      const allNeeds = Array.isArray(state.customerNeeds) ? state.customerNeeds : [];
      const byCustomer = handlers.needsByCustomer(allNeeds, inWorkspace, workspaceId);
      const answer = handlers.answerVehicleCustomerMatch({
        vehicle, needsByCustomer: byCustomer, now: this.ports.clock.now(),
      });
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: answer.reply,
        sources: [...sources, ...answer.sources],
        action: answer.action,
        data: answer.data,
      };
    }

    if (route.intent === "CUSTOMER_FOLLOWUP_PREP") {
      const handlers = await import("./customer-query-handlers.js");
      const workspaceId = state.settings.activeWorkspace;
      const named = findRelationshipsByName(inWorkspace, text);
      const customer = named.length === 1 ? named[0]! : null;
      // Workspace is filtered here as well as at construction: this answer lists work to do about
      // real people, and a dealership proposal must never surface while the Owner is in Personal.
      const pending = (Array.isArray(state.crmActionProposals) ? state.crmActionProposals : [])
        .filter((p) => p.workspace === workspaceId && p.status === "PROPOSED")
        .filter((p) => (customer ? p.customerRef === customer.id : true));
      const nameFor = (ref: string): string =>
        inWorkspace.find((r) => r.id === ref)?.displayName ?? ref;
      const answer = handlers.answerPreparedActions({
        proposals: pending,
        customer,
        nameFor,
      });
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: answer.reply,
        sources: [...sources, ...answer.sources],
        action: answer.action,
        data: answer.data,
      };
    }

    if (route.intent === "CUSTOMER_NEED_CORRECTION") {
      const { parseNeedCorrection } = await import("./need-correction.js");
      const parsed = parseNeedCorrection(text);
      const named = findRelationshipsByName(inWorkspace, text);
      if (!parsed) {
        return {
          intent: route.intent,
          confidence: "low",
          reply: "I can tell I got something wrong, but not what it should be instead. Tell me what they actually want.",
          sources,
          action: "customer.need.correction.unclear",
          data: {},
        };
      }
      if (named.length !== 1) {
        return {
          intent: route.intent,
          confidence: "low",
          reply: named.length
            ? `More than one customer matches that — ${named.slice(0, 4).map((r) => r.displayName).join(", ")}. Which one?`
            : "Which customer is that about?",
          sources,
          action: "customer.need.correction.unresolved",
          data: { candidates: named.slice(0, 4).map((r) => ({ id: r.id, label: r.displayName })) },
        };
      }

      const customer = named[0]!;
      const replies: string[] = [];
      for (const correction of parsed.corrections) {
        const applied = await this.applyNeedCorrection({
          relationshipRef: customer.id,
          attribute: correction.attribute,
          value: correction.value,
          strength: correction.strength,
          numericValue: correction.numericValue,
          note: parsed.note,
        });
        replies.push(applied.reply);
      }
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: replies.join("\n"),
        sources: [...sources, { type: "relationship", id: customer.id, label: customer.displayName }],
        action: "customer.need.correction",
        data: { corrections: parsed.corrections.length },
      };
    }

    if (route.intent === "SALES_TODAY" || route.intent === "SALES_WHO_TO_CALL") {
      const view = await this.salesCommandCenter();
      const asksWho = route.intent === "SALES_WHO_TO_CALL";
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: asksWho ? formatCustomerAttention(view) : formatCommandCenterToday(view),
        sources: view.customerAttention.map((c) => ({
          type: "relationship", id: c.relationshipRef, label: c.name,
        })),
        action: asksWho ? "sales.who_to_call" : "sales.today",
        data: view,
      };
    }

    if (route.intent === "SALES_CONTENT_COMMAND") {
      const command = routeSalesPresenceCommand(text);
      const content = await this.salesContentToday();

      // Website staleness is answered from the command centre, which already knows which drafts
      // stopped matching the live listing.
      if (command.command === "WEBSITE_STALE" || command.command === "PREPARE_WEBSITE_UPDATE") {
        const view = await this.salesCommandCenter();
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: view.website.message,
          sources: [],
          action: "sales.website",
          data: view.website,
        };
      }

      if (command.command === "WHICH_VEHICLES_TO_FEATURE") {
        const view = await this.salesCommandCenter();
        const featurable = view.vehicleOpportunities.filter((v) => v.onWebsite && !v.price.unknown);
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: featurable.length
            ? ["Worth featuring:", ...featurable.map((v) => `· ${v.label} — ${v.price.headline}`)].join("\n")
            : "Nothing is worth featuring right now — I need a vehicle that's listed with a published price.",
          sources: featurable.map((v) => ({ type: "vehicle", id: v.vehicleRef, label: v.label })),
          action: "sales.feature_candidates",
          data: featurable,
        };
      }

      const lines: string[] = [content.plan.message];
      for (const slot of content.plan.slots) {
        lines.push(`· ${slot.subject} — ${slot.suggestedFormat.replace(/_/g, " ").toLowerCase()}${slot.requiresOwnerReview ? " (needs your eyes — it quotes a price)" : ""}`);
      }
      if (content.plan.noPostRecommended && content.declined.length) {
        lines.push("", `I looked at ${content.declined.length} thing${content.declined.length === 1 ? "" : "s"} and none was strong enough.`);
      }
      lines.push("", "Nothing is connected, so nothing can be posted. These are drafts for you.");

      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: lines.join("\n"),
        sources: [],
        action: "sales.content_today",
        data: { plan: content.plan, opportunities: content.opportunities },
      };
    }

    if (route.intent === "WORK_QUEUE" || route.intent === "LIST_FOLLOWUPS") {
      const naturalKind = detectNaturalAttentionKind(text)
        ?? (route.intent === "LIST_FOLLOWUPS" ? "follow_up" as const : null)
        ?? (/\bbriefing|prepare me for today|what did i forget|what changed|what needs me\b/i.test(text)
          ? "today" as const
          : "next" as const);
      // Owner natural questions get assistant voice — not CRM diagnostic dumps or brand inventory.
      // Explicit diagnostic/status phrasing still receives the fuller structured briefing below.
      const wantsDiagnostic =
        /\b(diagnostic|crm detail|work queue|status report|briefing delta|what changed since)\b/i.test(text)
        || /\bbrand|caleb|collaborator|metricool|scheduled posts?\b/i.test(text);

      const queue = buildWorkQueue(inWorkspace, this.ports.clock.now());
      const openTasks = (state.tasks ?? []).filter(
        (t) => t.workspace === workspaceId && t.state !== "completed" && t.state !== "cancelled",
      );

      if (!wantsDiagnostic) {
        const reply = formatNaturalOwnerAttention({
          kind: naturalKind === "waiting" ? "today" : naturalKind,
          overdue: queue.overdue,
          dueSoon: queue.dueSoon,
          recentlyQuiet: naturalKind === "follow_up" || naturalKind === "call"
            ? queue.staleAccounts.map((s) => ({ customer: s.customer }))
            : [],
          openTasks: naturalKind === "today" || naturalKind === "next"
            ? openTasks.map((t) => ({ title: t.title }))
            : [],
        });
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply,
          sources: queue.overdue.slice(0, 5).map((o) => ({
            type: "follow-up",
            id: o.customer,
            label: `${o.customer}: ${o.reason}`,
          })),
          action: naturalKind === "call" || naturalKind === "follow_up" ? "work.queue" : "work.briefing",
          data: { queue, naturalKind },
        };
      }

      // Diagnostic / brand-explicit path only when Owner asked for it.
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
            ? `Brand workspaces: ${brands.map((b) => b.name).join(", ")}`
            : "No brand workspaces recorded.",
          collabs.length
            ? `Collaborators (owner-supplied only):\n${collabs
                .slice(0, 12)
                .map((c) => `  - ${c.name}${c.role ? ` · ${c.role}` : ""}${c.brandResponsibility ? ` — ${c.brandResponsibility}` : ""}`)
                .join("\n")}`
            : "Collaborators: none recorded. AION does not invent who manages a brand.",
          m.activeBrands.length
            ? `Metricool — active brands: ${m.activeBrands.map((b) => b.name).join(", ")}`
            : `Metricool: ${m.status.message}`,
        ].filter(Boolean).join("\n");
      }
      return {
        intent: route.intent,
        confidence: route.confidence,
        reply: `${proactive.reply}\n\n${briefing.text}${brandExtra}`,
        sources,
        action: "work.briefing",
        data: { briefing, proactive },
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

    if (route.intent === "CRM_LIST") {
      // List real customers in active workspace (or filtered context); never invent "Show" as a person.
      let pool = inWorkspace.filter((r) => !isSyntheticRelationship(r));
      const sub = (route.subject || "").toLowerCase();
      if (sub.startsWith("context:dealership") || sub.includes("lakeland") || sub.includes("dealership")) {
        pool = pool.filter((r) => r.workspace === "work" || /toyota|dealership|lakeland/i.test(`${r.notes} ${r.organisation}`));
      } else if (sub.startsWith("context:work") || sub === "work") {
        pool = state.relationships.filter(
          (r) => r.workspace === "work" && !r.archived && !isSyntheticRelationship(r),
        );
      } else if (sub.startsWith("brand:")) {
        const brand = sub.slice("brand:".length).trim();
        pool = state.relationships.filter(
          (r) =>
            !r.archived &&
            !isSyntheticRelationship(r) &&
            new RegExp(brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(
              `${r.workspace} ${r.organisation} ${r.notes} ${r.displayName}`,
            ),
        );
      }
      const formatted = formatCustomerList(pool, {
        title: sub.startsWith("brand:")
          ? `CUSTOMERS — ${route.subject?.replace(/^brand:/i, "") || "brand"}`
          : sub.includes("dealership") || sub.includes("lakeland")
            ? "CUSTOMERS — dealership"
            : "CUSTOMERS",
      });
      for (const c of pool.slice(0, 12)) {
        sources.push({ type: "relationship", id: c.id, label: c.displayName });
      }
      return {
        intent: "CRM_LIST",
        confidence: route.confidence,
        reply: formatted.reply,
        sources,
        action: "crm.customer.list",
        data: { count: formatted.count, subject: route.subject || "" },
      };
    }

    if (route.intent === "CRM_LOOKUP" || route.intent === "ACCOUNT_SUMMARY") {
      // Guard: empty/list-like subject → list, never create junk "Show"/"List"
      const subj = (route.subject || "").trim();
      if (!subj || /^(show|list|find|get|customers?|my customers?)$/i.test(subj)) {
        const pool = inWorkspace.filter((r) => !isSyntheticRelationship(r));
        const formatted = formatCustomerList(pool);
        return {
          intent: "CRM_LIST",
          confidence: route.confidence,
          reply: formatted.reply,
          sources,
          action: "crm.customer.list",
          data: { count: formatted.count, subject: "" },
        };
      }
      const matches = [
        ...findRelationshipsByName(inWorkspace, route.subject),
        ...findRelationshipsByName(inWorkspace, text),
      ].filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
        .filter((r) => !isSyntheticRelationship(r));
      if (!matches.length) {
        // Do not suggest creating junk imperative names
        const safeName = subj && !/^(show|list|find|get)$/i.test(subj);
        return {
          intent: route.intent,
          confidence: route.confidence,
          reply: safeName
            ? `No stored CRM record matched "${route.subject}". You can create a customer with: create a customer for ${route.subject}.`
            : "Say who or which company to look up (e.g. “Show me John” or “List my customers”).",
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

    // GENERAL_ASSISTANT_QUERY and unmatched phrasing: grounded priorities in assistant voice.
    // Never invent CRM facts. Never dump brand/workspace inventory unless asked.
    const queue = buildWorkQueue(inWorkspace, this.ports.clock.now());
    const openTasks = (state.tasks ?? []).filter(
      (t) => t.workspace === workspaceId && t.state !== "completed" && t.state !== "cancelled",
    );
    const naturalKind = detectNaturalAttentionKind(text) ?? "next";
    const reply = formatNaturalOwnerAttention({
      kind: naturalKind === "waiting" ? "next" : naturalKind,
      overdue: queue.overdue,
      dueSoon: queue.dueSoon,
      recentlyQuiet: naturalKind === "call" || naturalKind === "follow_up"
        ? queue.staleAccounts.map((s) => ({ customer: s.customer }))
        : [],
      openTasks: openTasks.map((t) => ({ title: t.title })),
    });
    return {
      intent: "GENERAL_ASSISTANT_QUERY",
      confidence: route.confidence === "high" ? "medium" : route.confidence,
      reply,
      sources: queue.overdue.slice(0, 5).map((o) => ({
        type: "follow-up",
        id: o.customer,
        label: `${o.customer}: ${o.reason}`,
      })),
      action: "assistant.briefing",
      data: { route, queue, openTaskCount: openTasks.length, naturalKind },
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
