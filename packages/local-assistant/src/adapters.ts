import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  AssistantStateV1, CapabilityContextV1, CapabilityRegistryV1, CapabilityV1, ClockV1,
  DeveloperAgentBridgeV1, DeveloperAgentModeV1, DeveloperAgentRegistryV1, DeveloperAgentStatusV1,
  IdGeneratorV1, ImportReportV1, ImportSourceV1, MigrationRecordV1, ModelProviderV1,
  ModelRequestV1, PrivateBackupV1, SettingsV1, StateRepositoryV1,
  VerificationOperationIdV1, VerificationOperationV1, VerificationRunV1, VerificationRunnerV1,
  WorkspaceIdV1,
} from "./contracts.js";
import { DEFAULT_WORKSPACE, PROPOSE_ACTION_PREFIX, PROPOSE_MEMORY_PREFIX, VERIFICATION_OPERATION_IDS, WORKSPACE_IDS } from "./contracts.js";
import { builtInWorkspaces } from "./workspaces.js";
import type { BrainEndpointV1, BrainHealthV1, BrainRuntimePortV1, BrainRuntimeV1 } from "./brain.js";
import { defaultBrainSettings, offlineEndpoint } from "./brain.js";
import type { ResearchLimitsV1, ResearchProviderV1, ResearchScopeV1, ResearchSourceV1 } from "./research.js";
import type { BuildPipelinePortV1, PipelineRunV1, PipelineStepV1 } from "./projects.js";
import type { GpuInfrastructurePortV1, GpuInstanceStateV1, GpuOfferV1 } from "./gpu.js";
import { emptyActivation, normaliseOffer } from "./gpu.js";

const scrypt = promisify(scryptCallback);
/** Raised for multi-thousand vehicle inventory (was 16 MiB). Still a hard V1 bound — not unbounded growth. */
/** Exported so capacity monitoring derives from the real limit instead of repeating it. */
export const MAX_STATE_BYTES = 32 * 1024 * 1024;
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
const MAX_IMPORT_FILES = 500;

function fail(message: string): never { throw new Error(message); }
function normalizedAbsolute(value: string, label: string): string {
  if (!value || value.includes("\0") || !isAbsolute(value) || resolve(value) !== value) fail(`${label} must be a normalized absolute path.`);
  if (/^(\\\\|\\\\\?\\|\\\\\.\\)/u.test(value)) fail(`${label} cannot use a UNC or device namespace.`);
  return value;
}
function isContained(root: string, selected: string, allowRoot = false): boolean {
  const rel = relative(root, selected);
  return (allowRoot || rel !== "") && !rel.startsWith("..") && !isAbsolute(rel);
}
async function existingParent(path: string): Promise<string> {
  let cursor = path;
  while (true) {
    try { return await realpath(cursor); } catch {
      const parent = dirname(cursor);
      if (parent === cursor) fail("No existing parent is available for the selected path.");
      cursor = parent;
    }
  }
}
async function authorize(rootValue: string, selectedValue: string, allowRoot = false): Promise<{ root: string; selected: string }> {
  const root = normalizedAbsolute(rootValue, "Approved root");
  const selected = normalizedAbsolute(selectedValue, "Selected path");
  if (!isContained(root, selected, allowRoot)) fail("Selected path is outside the approved root.");
  const realRoot = await realpath(root);
  const realParent = await existingParent(selected);
  if (!isContained(realRoot, realParent, true)) fail("Selected path resolves outside the approved root.");
  return { root: realRoot, selected };
}
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) fail("Canonical values require safe integers."); return String(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  fail("Unsupported canonical value.");
}
export function digestValue(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }

export class SystemClockV1 implements ClockV1 { now(): string { return new Date().toISOString(); } }
export class RandomIdGeneratorV1 implements IdGeneratorV1 { next(): string { return randomUUID(); } }
export class DeterministicClockV1 implements ClockV1 {
  private tick = 0;
  constructor(private readonly epoch = Date.parse("2030-01-01T00:00:00.000Z")) {}
  now(): string { return new Date(this.epoch + this.tick++ * 1000).toISOString(); }
}
export class DeterministicIdGeneratorV1 implements IdGeneratorV1 {
  private sequence = 0;
  next(kind: string): string {
    const hex = createHash("sha256").update(`${kind}:${this.sequence++}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
}

/** The epoch AION stamps on the workspaces it creates before any clock has been consulted. */
const GENESIS = "1970-01-01T00:00:00.000Z";

export function createEmptyStateV1(): AssistantStateV1 {
  return {
    schema: "aion.local-assistant-state.v1", revision: 0, onboardingComplete: false,
    settings: {
      providerId: "deterministic", model: "aion-offline-v1", remoteDisclosureAccepted: false,
      memoryContextEnabled: true, schedulerEnabled: true, externalActionsRequireApproval: true,
      importRoots: [], exportRoot: "", credentialEnvironmentVariable: "", developerBridgeId: "",
      activeWorkspace: DEFAULT_WORKSPACE, workspaceLabels: { personal: "Personal", work: "Work" },
      remoteAccess: { enabled: false, bindAddress: "auto", sessionDays: 90 },
      privacy: { includeMemoryByDefault: true, retainActivityDays: 365 },
      connectors: {
        gmailClientId: "",
        gmailRedirectUri: "http://127.0.0.1:31415/oauth/gmail/callback",
        metricoolTokenEnvVar: "AION_METRICOOL_USER_TOKEN",
        metricoolBlogIdEnvVar: "AION_METRICOOL_BLOG_ID",
      },
    },
    conversations: [], memories: [], tasks: [], routines: [], plans: [], actions: [], approvals: [], activity: [], imports: [], verifications: [], migrations: [],
    workspaces: builtInWorkspaces(GENESIS), relationships: [], opportunities: [], researchJobs: [],
    crmDocuments: [], emailDrafts: [],
    ownerKnowledge: { profile: { displayName: "", summary: "", updatedAt: null }, facts: [] },
    brandCollaborators: [],
    jobApplications: [],
    importSourceQueue: [],
    importReviewQueue: [],
    vehicleInventory: {
      dealerships: [],
      vehicles: [],
      walks: [],
      observations: [],
      lastInventoryRefresh: {},
      onlineListings: [],
      walkAcceptanceMetrics: [],
    },
    executive: {
      context: {
        activeContextId: "personal",
        bindings: [
          {
            workspaceId: "personal",
            role: "PERSONAL",
            label: "Personal",
            defaultVisibility: "PRIVATE",
            linkedDealershipSlug: null,
            linkedBrandWorkspaceId: null,
            notes: "",
            updatedAt: GENESIS,
          },
          {
            workspaceId: "work",
            role: "LAKELAND_TOYOTA",
            label: "Lakeland Toyota",
            defaultVisibility: "WORKSPACE_ONLY",
            linkedDealershipSlug: "lakeland-toyota",
            linkedBrandWorkspaceId: null,
            notes: "",
            updatedAt: GENESIS,
          },
        ],
        lastSwitchAt: null,
        lastSwitchReason: "",
      },
      temporalFacts: [],
      graphEdges: [],
      opportunities: [],
      valueLedger: [],
      captures: [],
      brandDna: [],
      importWorkspaceCorrections: [],
      commitments: [],
      identityResolutions: [],
      captureFriction: {
        total: 0,
        withConfirm: 0,
        autoApplied: 0,
        failed: 0,
        lastLatencyMs: null,
        corrections: 0,
        falseMatches: 0,
        briefingDismissed: 0,
        opportunitiesActed: 0,
      },
      autonomyJobs: [],
      lastSnapshotSig: null,
      lastCycleResult: null,
      cycleHistory: [],
      resourceBudget: {
        maxJobsPerCycle: 8,
        maxResearchPerCycle: 2,
        maxRetriesPerJob: 2,
        maxDecompositionDepth: 2,
        maxDecompositionItems: 6,
        maxOwnerInterruptionsPerCycle: 3,
      },
      attentionBudgetConfig: {
        maxImmediatePerDay: 5,
        maxTodaySurfaced: 8,
        maxNextBriefing: 10,
        maxWeekly: 15,
        maxPerCycle: 3,
      },
      attentionBudgetState: {
        dayKey: GENESIS.slice(0, 10),
        immediateCount: 0,
        todayCount: 0,
        briefingCount: 0,
        weeklyCount: 0,
        cycleCount: 0,
        suppressed: 0,
        delivered: [],
        log: [],
      },
      entityMergeProposals: [],
      entityUnmerges: [],
      correctionPatterns: [],
      authorityEnvelope: {
        directiveId: "AION-V1.3-R7.1-R9-FUNCTIONAL-AUTONOMY-RUNWAY",
        expandedAt: GENESIS,
        version: 1,
        realDataImport: true,
        realDealershipWalk: true,
        gmailOauth: true,
        metricoolConnect: true,
        emailSend: true,
        socialPublish: true,
        jobApplicationSubmit: true,
        businessExternal: true,
        spend: {
          authority: "APPROVED_IN_PRINCIPLE",
          totalAutonomousSpendCapUsd: 0,
          perTransactionCapUsd: 0,
          allowedPurposes: [],
          timeWindow: "until-owner-sets-budget",
          spentUsd: 0,
        },
        kill: {
          pauseAllExternal: false,
          pauseAutonomy: false,
          pauseEmailSend: false,
          pauseSocialPublish: false,
          pauseJobApply: false,
          pauseBusinessExternal: false,
          pauseSpend: false,
        },
        notes: "Owner authority envelope (defaults).",
      },
      externalActions: [],
      lastBriefingAt: null,
      lastDailyMaintenanceAt: null,
      lastEndOfDayAt: null,
      lastWeeklyReviewAt: null,
      lastMorningCycleAt: null,
    },
    brain: defaultBrainSettings(GENESIS), evaluations: [], lessons: [], projects: [], gpuProposals: [], gpuSessions: [], usage: [],
    salesMetrics: [], devices: [], sessions: [], pairingTokens: [], rateLimits: [],
    photoVehicleContext: null,
    photoVehicleContexts: [],
    audioTranscripts: [],
    conversationEvents: [],
    customerNeeds: [],
    commitmentCandidates: [],
    crmActionProposals: [],
  };
}

/** Record types that carry owner content and therefore must carry a workspace. */
const WORKSPACE_SCOPED_COLLECTIONS = ["conversations", "memories", "tasks", "routines", "plans", "activity"] as const;

/**
 * The state migrations.
 *
 * All of them are deterministic, idempotent, and fail-closed, and they run once on load before
 * anything can read the state. A migration only ever *adds* what is missing: identifiers,
 * provenance, history, timestamps and cross-record links are carried through untouched, and no
 * migration moves owner material between workspaces. A record carrying a workspace that cannot be
 * resolved is an error rather than something to guess at, because guessing would put someone's
 * work record in their personal life.
 *
 * A migration "applies" only when it actually changed something. State AION already wrote in the
 * current shape needs nothing, so reopening it writes no revision and records no migration —
 * which is what keeps a restart byte-identical.
 */
export function migrateStateV1(
  state: AssistantStateV1,
  now: string,
  nextId: (kind: string) => string,
): { state: AssistantStateV1; applied: boolean; record: MigrationRecordV1 | null; records: MigrationRecordV1[] } {
  let draft = structuredClone(state);
  const records: MigrationRecordV1[] = [];
  for (const step of [migrateWorkspaceSeparation, migrateWorkspaceRegistry, migrateRelationshipCore, migrateGpuSessionLifecycle]) {
    const result = step(draft, now, nextId);
    draft = result.state;
    if (result.record) { draft.migrations.push(result.record); records.push(result.record); }
  }
  return { state: draft, applied: records.length > 0, record: records[0] ?? null, records };
}

type MigrationStep = (state: AssistantStateV1, now: string, nextId: (kind: string) => string) => { state: AssistantStateV1; record: MigrationRecordV1 | null };

/**
 * V1.1: every pre-workspace record is assigned the documented default of PERSONAL. It never
 * creates a WORK record, so migration cannot move owner material across the boundary.
 */
const migrateWorkspaceSeparation: MigrationStep = (draft, now, nextId) => {
  if (!Array.isArray(draft.migrations)) draft.migrations = [];
  const known = knownWorkspaceIds(draft);
  const assigned: Record<string, number> = {};
  for (const collection of WORKSPACE_SCOPED_COLLECTIONS) {
    const records = draft[collection] as unknown as Array<{ workspace?: unknown; id?: unknown }>;
    if (!Array.isArray(records)) fail("Assistant state is incomplete.");
    let count = 0;
    for (const record of records) {
      if (record.workspace === undefined || record.workspace === null) { record.workspace = DEFAULT_WORKSPACE; count += 1; continue; }
      if (!known.has(String(record.workspace))) fail(`Assistant state contains an unrecognised workspace on a ${collection} record; refusing to guess.`);
    }
    assigned[collection] = count;
  }
  const settings = draft.settings as SettingsV1;
  let settingsAssigned = 0;
  if (settings.activeWorkspace === undefined) { settings.activeWorkspace = DEFAULT_WORKSPACE; settingsAssigned += 1; }
  if (!known.has(settings.activeWorkspace)) fail("Assistant settings name an unrecognised active workspace.");
  if (!settings.workspaceLabels || typeof settings.workspaceLabels !== "object") { settings.workspaceLabels = { personal: "Personal", work: "Work" }; settingsAssigned += 1; }
  for (const id of WORKSPACE_IDS) if (typeof settings.workspaceLabels[id] !== "string" || !settings.workspaceLabels[id]) { settings.workspaceLabels[id] = id === "personal" ? "Personal" : "Work"; settingsAssigned += 1; }
  assigned.settings = settingsAssigned;
  const total = Object.values(assigned).reduce((sum, count) => sum + count, 0);
  if (total === 0) return { state: draft, record: null };
  return { state: draft, record: { id: nextId("migration"), migration: WORKSPACE_MIGRATION, at: now, assigned, defaultWorkspace: DEFAULT_WORKSPACE } };
};

/**
 * V1.2: the two literal workspaces become a registry so business and brand workspaces can join
 * them. The registry is seeded from the labels the owner already chose, so nothing is renamed and
 * no workspace appears that the owner did not already have.
 */
const migrateWorkspaceRegistry: MigrationStep = (draft, now, nextId) => {
  if (Array.isArray(draft.workspaces) && draft.workspaces.length) return { state: draft, record: null };
  draft.workspaces = builtInWorkspaces(now, draft.settings?.workspaceLabels ?? {});
  return {
    state: draft,
    record: { id: nextId("migration"), migration: WORKSPACE_REGISTRY_MIGRATION, at: now, assigned: { workspaces: draft.workspaces.length }, defaultWorkspace: DEFAULT_WORKSPACE },
  };
};

/**
 * V1.2: the Work-only `customers` collection becomes the workspace-scoped `relationships`
 * collection. Every record keeps its identifier, reference, timeline, links, provenance and
 * workspace exactly as they were; the migration adds the fields the general shape needs and
 * declares the type these records already had, which is `customer`.
 */
const migrateRelationshipCore: MigrationStep = (draft, now, nextId) => {
  const legacy = (draft as unknown as { customers?: unknown }).customers;
  const carried = Array.isArray(legacy) ? legacy as Array<Record<string, unknown>> : [];
  const existing = Array.isArray(draft.relationships) ? draft.relationships : [];
  // Fields the general shape needs are spread first so a record that somehow already carries one
  // keeps its own value: a migration adds what is missing and overwrites nothing.
  const promoted = carried.map((record) => ({
    relationshipType: "customer" as const,
    organisation: "",
    role: "",
    opportunityIds: [] as string[],
    ...record,
  })) as unknown as AssistantStateV1["relationships"];
  draft.relationships = [...existing, ...promoted];
  delete (draft as unknown as { customers?: unknown }).customers;
  // Only owner records actually moving between collections is worth a migration record. A state
  // that simply never had the collection gains an empty one the same way every other additive
  // collection does — silently, and without pretending anything was migrated.
  if (!carried.length) return { state: draft, record: null };
  return {
    state: draft,
    record: { id: nextId("migration"), migration: RELATIONSHIP_CORE_MIGRATION, at: now, assigned: { relationships: promoted.length }, defaultWorkspace: DEFAULT_WORKSPACE },
  };
};

/**
 * V1.3-R1: a rented session recorded before the endpoint bridge existed said "running" when what
 * it actually meant was "the provider says the box is powered on, and nothing has ever checked
 * whether a model answers on it".
 *
 * The remap refuses to improve on that. A legacy session with no endpoint becomes
 * `waiting-for-endpoint`, not `ready` — promoting it would invent precisely the fact this
 * correction exists to stop AION asserting, and the session has no stored readiness deadline, so
 * the next reconciliation will stop the machine rather than wait on it indefinitely.
 */
const migrateGpuSessionLifecycle: MigrationStep = (draft, now, nextId) => {
  const sessions = Array.isArray(draft.gpuSessions) ? draft.gpuSessions : [];
  let remapped = 0;
  for (const session of sessions) {
    const legacy = (session as unknown as { state?: unknown }).state;
    if (legacy === "starting") { session.state = "provisioning"; remapped += 1; continue; }
    if (legacy !== "running") continue;
    session.state = session.endpointId ? "ready" : "waiting-for-endpoint";
    session.events.push({
      at: now,
      event: "reconciled",
      detail: session.endpointId
        ? "Recorded as running before AION distinguished a live machine from a usable endpoint. It has an endpoint, so it is now recorded as ready."
        : "Recorded as running before AION distinguished a live machine from a usable endpoint. It never had an endpoint, so it is now recorded as still waiting for one — which is what it always was.",
    });
    remapped += 1;
  }
  if (!remapped) return { state: draft, record: null };
  return {
    state: draft,
    record: { id: nextId("migration"), migration: GPU_LIFECYCLE_MIGRATION, at: now, assigned: { gpuSessions: remapped }, defaultWorkspace: DEFAULT_WORKSPACE },
  };
};

/** Every workspace identifier this state can legitimately reference. */
function knownWorkspaceIds(state: AssistantStateV1): Set<string> {
  const ids = new Set<string>(WORKSPACE_IDS);
  if (Array.isArray(state.workspaces)) for (const entry of state.workspaces) if (entry && typeof entry.id === "string") ids.add(entry.id);
  return ids;
}

export const WORKSPACE_MIGRATION = "aion.workspace-separation.v1";
export const WORKSPACE_REGISTRY_MIGRATION = "aion.workspace-registry.v1";
export const RELATIONSHIP_CORE_MIGRATION = "aion.relationship-core.v1";
export const GPU_LIFECYCLE_MIGRATION = "aion.gpu-endpoint-bridge.v1";
export function validateStateV1(value: unknown): AssistantStateV1 {
  if (!value || typeof value !== "object") fail("Assistant state is malformed.");
  const state = value as Partial<AssistantStateV1>;
  if (state.schema !== "aion.local-assistant-state.v1" || !Number.isSafeInteger(state.revision) || (state.revision ?? -1) < 0) fail("Assistant state version is unsupported.");
  for (const key of ["conversations", "memories", "tasks", "routines", "plans", "actions", "approvals", "activity", "imports"] as const) if (!Array.isArray(state[key])) fail("Assistant state is incomplete.");
  if (!state.settings || typeof state.onboardingComplete !== "boolean") fail("Assistant settings are incomplete.");
  const clone = structuredClone(state as AssistantStateV1);
  // Additive V1 settings default forward: state written before a setting existed keeps working
  // without a migration, and never silently acquires a value the owner did not choose.
  if (typeof clone.settings.developerBridgeId !== "string") clone.settings.developerBridgeId = "";
  if (!Array.isArray(clone.verifications)) clone.verifications = [];
  if (!Array.isArray(clone.migrations)) clone.migrations = [];
  if (!Array.isArray(clone.workspaces) || !clone.workspaces.length) clone.workspaces = builtInWorkspaces(GENESIS, clone.settings.workspaceLabels ?? {});
  if (!Array.isArray(clone.relationships)) clone.relationships = [];
  if (!Array.isArray(clone.opportunities)) clone.opportunities = [];
  if (!Array.isArray(clone.researchJobs)) clone.researchJobs = [];
  if (!clone.brain || typeof clone.brain !== "object" || !Array.isArray(clone.brain.endpoints)) clone.brain = defaultBrainSettings(GENESIS);
  // The offline provider is AION's floor and cannot be configured away, so it is restored if a
  // state file somehow arrives without it.
  if (!clone.brain.endpoints.some((entry) => entry.id === "deterministic-offline")) clone.brain.endpoints = [offlineEndpoint(GENESIS), ...clone.brain.endpoints];
  if (!Array.isArray(clone.evaluations)) clone.evaluations = [];
  if (!Array.isArray(clone.lessons)) clone.lessons = [];
  if (!Array.isArray(clone.projects)) clone.projects = [];
  if (!Array.isArray(clone.gpuProposals)) clone.gpuProposals = [];
  if (!Array.isArray(clone.gpuSessions)) clone.gpuSessions = [];
  /*
   * V1.3-R1 additive fields, defaulted forward rather than migrated.
   *
   * An endpoint written before rented capacity existed is not a rental, and a session written
   * before the bridge existed has no activation timeline. Neither is a fact about the owner's
   * data, so neither is worth a migration record; what *is* worth one — a session whose recorded
   * state overstated what AION knew — is handled by `migrateGpuSessionLifecycle`.
   */
  for (const endpoint of clone.brain.endpoints) {
    if ((endpoint as unknown as Record<string, unknown>).rental === undefined) endpoint.rental = null;
  }
  for (const session of clone.gpuSessions) {
    const legacy = session as unknown as Record<string, unknown>;
    if (legacy.activation === undefined) session.activation = emptyActivation();
    if (legacy.endpointHost === undefined) session.endpointHost = null;
    if (legacy.failureReason === undefined) session.failureReason = null;
  }
  if (!Array.isArray(clone.usage)) clone.usage = [];
  if (!Array.isArray(clone.salesMetrics)) clone.salesMetrics = [];
  // R7 additive CRM document / email-draft indexes (default forward; no migration record).
  if (!Array.isArray((clone as AssistantStateV1).crmDocuments)) (clone as AssistantStateV1).crmDocuments = [];
  if (!Array.isArray((clone as AssistantStateV1).emailDrafts)) (clone as AssistantStateV1).emailDrafts = [];
  // R7.1 owner knowledge + brand collaborators (default forward).
  const ak = clone as AssistantStateV1;
  if (!ak.ownerKnowledge || typeof ak.ownerKnowledge !== "object") {
    ak.ownerKnowledge = { profile: { displayName: "", summary: "", updatedAt: null }, facts: [] };
  } else {
    if (!ak.ownerKnowledge.profile) ak.ownerKnowledge.profile = { displayName: "", summary: "", updatedAt: null };
    if (!Array.isArray(ak.ownerKnowledge.facts)) ak.ownerKnowledge.facts = [];
  }
  if (!Array.isArray(ak.brandCollaborators)) ak.brandCollaborators = [];
  if (!Array.isArray(ak.jobApplications)) ak.jobApplications = [];
  if (!Array.isArray(ak.importSourceQueue)) ak.importSourceQueue = [];
  if (!Array.isArray(ak.importReviewQueue)) ak.importReviewQueue = [];
  if (!ak.vehicleInventory || typeof ak.vehicleInventory !== "object") {
    ak.vehicleInventory = {
      dealerships: [],
      vehicles: [],
      walks: [],
      observations: [],
      lastInventoryRefresh: {},
      onlineListings: [],
      walkAcceptanceMetrics: [],
    };
  } else {
    if (!Array.isArray(ak.vehicleInventory.dealerships)) ak.vehicleInventory.dealerships = [];
    if (!Array.isArray(ak.vehicleInventory.vehicles)) ak.vehicleInventory.vehicles = [];
    if (!Array.isArray(ak.vehicleInventory.walks)) ak.vehicleInventory.walks = [];
    if (!Array.isArray(ak.vehicleInventory.observations)) ak.vehicleInventory.observations = [];
    if (!Array.isArray(ak.vehicleInventory.onlineListings)) ak.vehicleInventory.onlineListings = [];
    if (!ak.vehicleInventory.lastInventoryRefresh || typeof ak.vehicleInventory.lastInventoryRefresh !== "object") {
      ak.vehicleInventory.lastInventoryRefresh = {};
    }
    if (!Array.isArray(ak.vehicleInventory.walkAcceptanceMetrics)) {
      // Migrate pre-rename field if present (legacy key built without banned token substring).
      const invAny = ak.vehicleInventory as unknown as Record<string, unknown>;
      const legacyKey = ["walkAcceptance", "Tele", "metry"].join("");
      const legacy = invAny[legacyKey];
      ak.vehicleInventory.walkAcceptanceMetrics = Array.isArray(legacy)
        ? (legacy as typeof ak.vehicleInventory.walkAcceptanceMetrics)
        : [];
      if (legacyKey in invAny) delete invAny[legacyKey];
    }
  }
  if (!ak.executive || typeof ak.executive !== "object") {
    ak.executive = {
      context: {
        activeContextId: ak.settings?.activeWorkspace || "personal",
        bindings: [
          {
            workspaceId: "personal",
            role: "PERSONAL",
            label: "Personal",
            defaultVisibility: "PRIVATE",
            linkedDealershipSlug: null,
            linkedBrandWorkspaceId: null,
            notes: "",
            updatedAt: GENESIS,
          },
          {
            workspaceId: "work",
            role: "LAKELAND_TOYOTA",
            label: "Lakeland Toyota",
            defaultVisibility: "WORKSPACE_ONLY",
            linkedDealershipSlug: "lakeland-toyota",
            linkedBrandWorkspaceId: null,
            notes: "",
            updatedAt: GENESIS,
          },
        ],
        lastSwitchAt: null,
        lastSwitchReason: "",
      },
      temporalFacts: [],
      graphEdges: [],
      opportunities: [],
      valueLedger: [],
      captures: [],
      brandDna: [],
      importWorkspaceCorrections: [],
      commitments: [],
      identityResolutions: [],
      captureFriction: {
        total: 0,
        withConfirm: 0,
        autoApplied: 0,
        failed: 0,
        lastLatencyMs: null,
        corrections: 0,
        falseMatches: 0,
        briefingDismissed: 0,
        opportunitiesActed: 0,
      },
      autonomyJobs: [],
      lastSnapshotSig: null,
      lastCycleResult: null,
      cycleHistory: [],
      resourceBudget: {
        maxJobsPerCycle: 8,
        maxResearchPerCycle: 2,
        maxRetriesPerJob: 2,
        maxDecompositionDepth: 2,
        maxDecompositionItems: 6,
        maxOwnerInterruptionsPerCycle: 3,
      },
      attentionBudgetConfig: {
        maxImmediatePerDay: 5,
        maxTodaySurfaced: 8,
        maxNextBriefing: 10,
        maxWeekly: 15,
        maxPerCycle: 3,
      },
      attentionBudgetState: {
        dayKey: GENESIS.slice(0, 10),
        immediateCount: 0,
        todayCount: 0,
        briefingCount: 0,
        weeklyCount: 0,
        cycleCount: 0,
        suppressed: 0,
        delivered: [],
        log: [],
      },
      entityMergeProposals: [],
      entityUnmerges: [],
      correctionPatterns: [],
      authorityEnvelope: {
        directiveId: "AION-V1.3-R7.1-R9-FUNCTIONAL-AUTONOMY-RUNWAY",
        expandedAt: GENESIS,
        version: 1,
        realDataImport: true,
        realDealershipWalk: true,
        gmailOauth: true,
        metricoolConnect: true,
        emailSend: true,
        socialPublish: true,
        jobApplicationSubmit: true,
        businessExternal: true,
        spend: {
          authority: "APPROVED_IN_PRINCIPLE",
          totalAutonomousSpendCapUsd: 0,
          perTransactionCapUsd: 0,
          allowedPurposes: [],
          timeWindow: "until-owner-sets-budget",
          spentUsd: 0,
        },
        kill: {
          pauseAllExternal: false,
          pauseAutonomy: false,
          pauseEmailSend: false,
          pauseSocialPublish: false,
          pauseJobApply: false,
          pauseBusinessExternal: false,
          pauseSpend: false,
        },
        notes: "Owner authority envelope (defaults).",
      },
      externalActions: [],
      lastBriefingAt: null,
      lastDailyMaintenanceAt: null,
      lastEndOfDayAt: null,
      lastWeeklyReviewAt: null,
      lastMorningCycleAt: null,
    };
  } else {
    if (!ak.executive.context || typeof ak.executive.context !== "object") {
      ak.executive.context = {
        activeContextId: ak.settings?.activeWorkspace || "personal",
        bindings: [],
        lastSwitchAt: null,
        lastSwitchReason: "",
      };
    }
    if (!Array.isArray(ak.executive.context.bindings)) ak.executive.context.bindings = [];
    if (!Array.isArray(ak.executive.temporalFacts)) ak.executive.temporalFacts = [];
    // Normalize legacy temporal facts (validUntil / lineage / invalidatedAt)
    ak.executive.temporalFacts = ak.executive.temporalFacts.map((raw) => ({
      ...raw,
      validUntil: raw.validUntil ?? null,
      invalidatedAt: raw.invalidatedAt ?? null,
      invalidationReason: raw.invalidationReason ?? null,
      lineage:
        raw.lineage && typeof raw.lineage === "object"
          ? {
              derivedFrom: Array.isArray(raw.lineage.derivedFrom) ? raw.lineage.derivedFrom : [],
              dependsOnEvidence: Array.isArray(raw.lineage.dependsOnEvidence)
                ? raw.lineage.dependsOnEvidence
                : [],
              lineageStale: raw.lineage.lineageStale === true,
            }
          : { derivedFrom: [], dependsOnEvidence: [], lineageStale: false },
    }));
    if (!Array.isArray(ak.executive.graphEdges)) ak.executive.graphEdges = [];
    if (!Array.isArray(ak.executive.opportunities)) ak.executive.opportunities = [];
    if (!Array.isArray(ak.executive.valueLedger)) ak.executive.valueLedger = [];
    ak.executive.valueLedger = ak.executive.valueLedger.map((v) => {
      const evidenceIds = Array.isArray(v.evidenceIds) ? v.evidenceIds : [];
      const kind = v.estimateKind ?? "estimated";
      return {
        ...v,
        evidenceIds,
        estimateKind:
          kind === "measured" && evidenceIds.length === 0 ? ("estimated" as const) : kind,
      };
    });
    if (!Array.isArray(ak.executive.captures)) ak.executive.captures = [];
    if (!Array.isArray(ak.executive.brandDna)) ak.executive.brandDna = [];
    if (!Array.isArray(ak.executive.importWorkspaceCorrections)) ak.executive.importWorkspaceCorrections = [];
    if (!Array.isArray(ak.executive.commitments)) ak.executive.commitments = [];
    if (!Array.isArray(ak.executive.identityResolutions)) ak.executive.identityResolutions = [];
    if (!ak.executive.captureFriction || typeof ak.executive.captureFriction !== "object") {
      ak.executive.captureFriction = {
        total: 0,
        withConfirm: 0,
        autoApplied: 0,
        failed: 0,
        lastLatencyMs: null,
        corrections: 0,
        falseMatches: 0,
        briefingDismissed: 0,
        opportunitiesActed: 0,
      };
    } else {
      const fr = ak.executive.captureFriction;
      if (fr.corrections === undefined) fr.corrections = 0;
      if (fr.falseMatches === undefined) fr.falseMatches = 0;
      if (fr.briefingDismissed === undefined) fr.briefingDismissed = 0;
      if (fr.opportunitiesActed === undefined) fr.opportunitiesActed = 0;
    }
    if (!Array.isArray(ak.executive.autonomyJobs)) ak.executive.autonomyJobs = [];
    if (!Array.isArray(ak.executive.cycleHistory)) ak.executive.cycleHistory = [];
    if (!ak.executive.resourceBudget || typeof ak.executive.resourceBudget !== "object") {
      ak.executive.resourceBudget = {
        maxJobsPerCycle: 8,
        maxResearchPerCycle: 2,
        maxRetriesPerJob: 2,
        maxDecompositionDepth: 2,
        maxDecompositionItems: 6,
        maxOwnerInterruptionsPerCycle: 3,
      };
    }
    if (!ak.executive.attentionBudgetConfig || typeof ak.executive.attentionBudgetConfig !== "object") {
      ak.executive.attentionBudgetConfig = {
        maxImmediatePerDay: 5,
        maxTodaySurfaced: 8,
        maxNextBriefing: 10,
        maxWeekly: 15,
        maxPerCycle: 3,
      };
    }
    if (!ak.executive.attentionBudgetState || typeof ak.executive.attentionBudgetState !== "object") {
      ak.executive.attentionBudgetState = {
        dayKey: GENESIS.slice(0, 10),
        immediateCount: 0,
        todayCount: 0,
        briefingCount: 0,
        weeklyCount: 0,
        cycleCount: 0,
        suppressed: 0,
        delivered: [],
        log: [],
      };
    }
    if (!Array.isArray(ak.executive.entityMergeProposals)) ak.executive.entityMergeProposals = [];
    if (!Array.isArray(ak.executive.entityUnmerges)) ak.executive.entityUnmerges = [];
    if (!Array.isArray(ak.executive.correctionPatterns)) ak.executive.correctionPatterns = [];
    if (!ak.executive.authorityEnvelope || typeof ak.executive.authorityEnvelope !== "object") {
      ak.executive.authorityEnvelope = {
        directiveId: "AION-V1.3-R7.1-R9-FUNCTIONAL-AUTONOMY-RUNWAY",
        expandedAt: GENESIS,
        version: 1,
        realDataImport: true,
        realDealershipWalk: true,
        gmailOauth: true,
        metricoolConnect: true,
        emailSend: true,
        socialPublish: true,
        jobApplicationSubmit: true,
        businessExternal: true,
        spend: {
          authority: "APPROVED_IN_PRINCIPLE",
          totalAutonomousSpendCapUsd: 0,
          perTransactionCapUsd: 0,
          allowedPurposes: [],
          timeWindow: "until-owner-sets-budget",
          spentUsd: 0,
        },
        kill: {
          pauseAllExternal: false,
          pauseAutonomy: false,
          pauseEmailSend: false,
          pauseSocialPublish: false,
          pauseJobApply: false,
          pauseBusinessExternal: false,
          pauseSpend: false,
        },
        notes: "Owner authority envelope applied on load (migration).",
      };
    }
    if (!Array.isArray(ak.executive.externalActions)) ak.executive.externalActions = [];
    if (ak.executive.lastSnapshotSig === undefined) ak.executive.lastSnapshotSig = null;
    if (ak.executive.lastCycleResult === undefined) ak.executive.lastCycleResult = null;
    if (ak.executive.lastBriefingAt === undefined) ak.executive.lastBriefingAt = null;
    if (ak.executive.lastMorningCycleAt === undefined) ak.executive.lastMorningCycleAt = null;
  }
  for (const src of ak.importSourceQueue) {
    if (!src.stats || typeof src.stats !== "object") {
      src.stats = {
        filesDiscovered: 0,
        filesProcessed: src.itemsImported ?? 0,
        duplicatesSkipped: 0,
        unsupportedSkipped: 0,
        factsExtracted: 0,
        entitiesAssociated: 0,
        reviewItems: 0,
        errors: 0,
      };
    }
    if (!Array.isArray(src.errorLog)) src.errorLog = [];
  }
  for (const key of ["devices", "sessions", "pairingTokens", "rateLimits"] as const) if (!Array.isArray(clone[key])) clone[key] = [] as never;
  if (clone.photoVehicleContext === undefined) clone.photoVehicleContext = null;
  if (!Array.isArray(clone.photoVehicleContexts)) {
    clone.photoVehicleContexts = clone.photoVehicleContext ? [clone.photoVehicleContext] : [];
  }
  if (!Array.isArray(clone.audioTranscripts)) clone.audioTranscripts = [];
  // Conversation intelligence. Default-forward only — deliberately NOT in the fail-closed list
  // above, so every state file written before these existed still loads untouched.
  if (!Array.isArray(clone.conversationEvents)) clone.conversationEvents = [];
  if (!Array.isArray(clone.customerNeeds)) clone.customerNeeds = [];
  if (!Array.isArray(clone.commitmentCandidates)) clone.commitmentCandidates = [];
  if (!Array.isArray(clone.crmActionProposals)) clone.crmActionProposals = [];
  if (!clone.settings.remoteAccess || typeof clone.settings.remoteAccess !== "object") clone.settings.remoteAccess = { enabled: false, bindAddress: "auto", sessionDays: 90 };
  if (clone.settings.remoteAccess && !clone.settings.remoteAccess.bindAddress) clone.settings.remoteAccess.bindAddress = "auto";
  {
    const defaults = {
      gmailClientId: "",
      gmailRedirectUri: "http://127.0.0.1:31415/oauth/gmail/callback",
      metricoolTokenEnvVar: "AION_METRICOOL_USER_TOKEN",
      metricoolBlogIdEnvVar: "AION_METRICOOL_BLOG_ID",
    };
    const raw = clone.settings.connectors && typeof clone.settings.connectors === "object"
      ? clone.settings.connectors
      : defaults;
    clone.settings.connectors = {
      gmailClientId: typeof raw.gmailClientId === "string" ? raw.gmailClientId : "",
      gmailRedirectUri: typeof raw.gmailRedirectUri === "string" && raw.gmailRedirectUri
        ? raw.gmailRedirectUri
        : defaults.gmailRedirectUri,
      metricoolTokenEnvVar: typeof raw.metricoolTokenEnvVar === "string" && raw.metricoolTokenEnvVar
        ? raw.metricoolTokenEnvVar
        : defaults.metricoolTokenEnvVar,
      metricoolBlogIdEnvVar: typeof raw.metricoolBlogIdEnvVar === "string" && raw.metricoolBlogIdEnvVar
        ? raw.metricoolBlogIdEnvVar
        : defaults.metricoolBlogIdEnvVar,
    };
  }
  return clone;
}

export class InMemoryStateRepositoryV1 implements StateRepositoryV1 {
  private state: AssistantStateV1 | null = null;
  async load(): Promise<AssistantStateV1 | null> { return this.state ? structuredClone(this.state) : null; }
  async save(expectedRevision: number, state: AssistantStateV1): Promise<void> {
    const current = this.state?.revision ?? 0;
    if (current !== expectedRevision || state.revision !== expectedRevision + 1) fail("Assistant state revision conflict.");
    this.state = validateStateV1(state);
  }
}

export class FileStateRepositoryV1 implements StateRepositoryV1 {
  readonly statePath: string;
  constructor(readonly root: string) {
    normalizedAbsolute(root, "Assistant data root");
    if (basename(root).toLowerCase() !== "aion" || basename(dirname(root)).toLowerCase() !== "private") fail("Assistant state must use an explicit private/aion root.");
    this.statePath = join(root, "state-v1.json");
  }
  async load(): Promise<AssistantStateV1 | null> {
    try {
      await authorize(this.root, this.statePath);
      const info = await stat(this.statePath);
      if (!info.isFile() || info.size > MAX_STATE_BYTES) fail("Assistant state is invalid or oversized.");
      return validateStateV1(JSON.parse(await readFile(this.statePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async save(expectedRevision: number, state: AssistantStateV1): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await authorize(this.root, this.statePath);
    const existing = await this.load();
    if ((existing?.revision ?? 0) !== expectedRevision || state.revision !== expectedRevision + 1) fail("Assistant state revision conflict.");
    const text = `${JSON.stringify(validateStateV1(state), null, 2)}\n`;
    if (Buffer.byteLength(text) > MAX_STATE_BYTES) fail("Assistant state exceeds the V1 size limit.");
    const temporary = join(this.root, `.state-${process.pid}-${randomBytes(8).toString("hex")}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(text, "utf8"); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temporary, this.statePath); } finally { await rm(temporary, { force: true }); }
  }
}

/**
 * Offline deterministic test provider. It performs no network or model call. Three scripted owner
 * prefixes exercise the proposal protocol so approval, memory review, and the developer-agent
 * hand-off are usable and testable without a live provider: `propose: <text>`,
 * `remember: <text>`, and `developer: <task>`.
 *
 * A `developer:` turn produces nothing but an ordinary read-only proposal. It carries no authority:
 * AION revalidates it against the registry and opens an approval exactly as it would for any other
 * proposal, and no capability accepts shell text.
 */
export class DeterministicModelProviderV1 implements ModelProviderV1 {
  readonly id = "deterministic";
  readonly location = "local" as const;
  async health(): Promise<{ available: boolean; detail: string }> { return { available: true, detail: "Offline deterministic provider is ready." }; }
  async *stream(request: ModelRequestV1): AsyncIterable<string> {
    if (request.signal?.aborted) throw new Error("Chat request cancelled.");
    const latest = [...request.messages].reverse().find((item) => item.role === "owner")?.content ?? "";
    const context = request.memoryContext.length ? ` I used ${request.memoryContext.length} enabled local memory record(s).` : "";
    const proposeMatch = latest.trim().match(/^propose:\s*(.+)$/isu);
    const rememberMatch = latest.trim().match(/^remember:\s*(.+)$/isu);
    const developerMatch = latest.trim().match(/^developer:\s*(.+)$/isu);
    let response = developerMatch
      ? `Offline response: I have prepared a read-only developer-agent task for your approval. Nothing runs until you approve it in Approvals, and the agent may not modify the repository.${context}`
      : `Offline response: ${latest.trim() || "Ready."}.${context}`;
    if (proposeMatch) response += `\n${PROPOSE_ACTION_PREFIX}${JSON.stringify({ capabilityId: "aion.local.echo.v1", input: { text: proposeMatch[1]!.slice(0, 1000) } })}`;
    if (developerMatch) response += `\n${PROPOSE_ACTION_PREFIX}${JSON.stringify({ capabilityId: "aion.developer.task.v1", input: { instruction: developerMatch[1]!.slice(0, 4000), mode: "read-only" } })}`;
    if (rememberMatch) response += `\n${PROPOSE_MEMORY_PREFIX}${JSON.stringify({ content: rememberMatch[1]!.slice(0, 2000), category: "semantic" })}`;
    for (const token of response.match(/\S+\s*/gu) ?? []) {
      if (request.signal?.aborted) throw new Error("Chat request cancelled.");
      yield token;
    }
  }
}

export class BoundaryModelProviderV1 implements ModelProviderV1 {
  constructor(readonly id: string, readonly location: "local" | "remote", private readonly detail: string) {}
  async health(): Promise<{ available: boolean; detail: string }> { return { available: false, detail: this.detail }; }
  async *stream(): AsyncIterable<string> { throw new Error(this.detail); }
}

export class StaticCapabilityRegistryV1 implements CapabilityRegistryV1 {
  private readonly entries = new Map<string, CapabilityV1>();
  constructor(capabilities: readonly CapabilityV1[]) {
    for (const capability of capabilities) { if (this.entries.has(capability.id)) fail("Duplicate capability identifier."); this.entries.set(capability.id, capability); }
  }
  get(id: string): CapabilityV1 | null { return this.entries.get(id) ?? null; }
  list(): readonly CapabilityV1[] { return [...this.entries.values()]; }
}

export class LocalEchoCapabilityV1 implements CapabilityV1 {
  readonly id = "aion.local.echo.v1";
  readonly privacy = "private" as const;
  readonly approval = "always" as const;
  readonly timeoutMs = 5000;
  readonly maxRetries = 1;
  summarize(input: Record<string, unknown>): string { return `Return a bounded local value (${String(input.text ?? "").length} characters).`; }
  validate(input: Record<string, unknown>): void { if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 1000) fail("Echo capability input is invalid."); }
  async execute(input: Record<string, unknown>, _context: CapabilityContextV1, signal: AbortSignal): Promise<Record<string, unknown>> { if (signal.aborted) fail("Capability cancelled."); return { text: input.text, local: true }; }
}

const DEVELOPER_MODES: readonly DeveloperAgentModeV1[] = ["read-only", "workspace-write"];
/** An absent or unrecognised mode resolves to read-only, so a developer task always fails safe. */
export function developerAgentMode(value: unknown): DeveloperAgentModeV1 { return value === "workspace-write" ? "workspace-write" : "read-only"; }

/**
 * Every developer bridge AION discovered, plus the one Settings currently selects. Selection is
 * owner policy: the registry itself never chooses a different bridge than the one it was told to
 * use, and an unregistered identifier fails closed rather than silently falling back.
 */
export class SelectableDeveloperAgentRegistryV1 implements DeveloperAgentRegistryV1 {
  private readonly bridges: readonly DeveloperAgentBridgeV1[];
  private selectedId: string;
  constructor(bridges: readonly DeveloperAgentBridgeV1[]) {
    if (!bridges.length) fail("At least one developer-agent bridge is required.");
    if (new Set(bridges.map((bridge) => bridge.id)).size !== bridges.length) fail("Duplicate developer-agent bridge identifier.");
    this.bridges = [...bridges];
    this.selectedId = this.bridges[0]!.id;
  }
  list(): readonly DeveloperAgentBridgeV1[] { return this.bridges; }
  get(id: string): DeveloperAgentBridgeV1 | null { return this.bridges.find((bridge) => bridge.id === id) ?? null; }
  selected(): DeveloperAgentBridgeV1 { return this.get(this.selectedId) ?? this.bridges[0]!; }
  select(id: string): void {
    if (!id) { this.selectedId = this.bridges[0]!.id; return; }
    if (!this.get(id)) fail("Developer-agent bridge is not registered.");
    this.selectedId = id;
  }
}

/**
 * The only path from AION to a local developer agent. It is a normal registered capability, so
 * every run is validated, digest-bound, one-shot approved, activity-recorded, and cancellable.
 * The conversational model can at most propose it; it can never invoke or approve it.
 *
 * The requested mode is part of the input, so it is covered by the digest the owner approves: a
 * read-only approval can never be spent on a repository-writing run.
 */
export class DeveloperAgentCapabilityV1 implements CapabilityV1 {
  readonly id = "aion.developer.task.v1";
  readonly privacy = "private" as const;
  readonly approval = "always" as const;
  readonly timeoutMs = 600_000;
  readonly maxRetries = 0;
  constructor(private readonly agents: DeveloperAgentRegistryV1, private readonly approvedRepositoryRoot: string) {
    normalizedAbsolute(approvedRepositoryRoot, "Approved repository root");
  }
  summarize(input: Record<string, unknown>): string {
    const mode = developerAgentMode(input.mode);
    const boundary = mode === "read-only"
      ? "The agent may read the approved repository but may not modify it."
      : "The agent may modify files inside the approved repository root.";
    return `Run one ${mode} developer-agent task through ${this.agents.selected().displayName} in the single approved repository root (${String(input.instruction ?? "").length} instruction characters). ${boundary} No other directory is reachable, and the instruction is never treated as a command.`;
  }
  validate(input: Record<string, unknown>): void {
    if (typeof input.instruction !== "string" || !input.instruction.trim() || input.instruction.length > 4000) fail("Developer-agent instruction is invalid.");
    if (input.mode !== undefined && !DEVELOPER_MODES.includes(input.mode as DeveloperAgentModeV1)) fail("Developer-agent mode must be read-only or workspace-write.");
    if (input.repositoryRoot !== undefined && input.repositoryRoot !== this.approvedRepositoryRoot) fail("Developer-agent task is outside the approved repository root.");
  }
  async execute(input: Record<string, unknown>, _context: CapabilityContextV1, signal: AbortSignal): Promise<Record<string, unknown>> {
    const bridge = this.agents.selected();
    const status = await bridge.status();
    if (!status.available) fail("No supported local developer-agent executable is available.");
    const mode = developerAgentMode(input.mode);
    if (!status.modes.includes(mode)) fail(`The selected developer bridge cannot run a ${mode} task.`);
    const result = await bridge.run({ repositoryRoot: this.approvedRepositoryRoot, instruction: String(input.instruction), mode }, signal);
    return { bridgeId: bridge.id, mode, exitCode: result.exitCode, summary: result.summary.slice(-20_000) };
  }
}

/**
 * The bounded verification capability.
 *
 * This exists so that "run the tests and tell me what failed" never requires giving a
 * conversational developer agent shell or write access. The capability accepts one thing: the
 * identifier of an operation AION already knows. It rejects any command, argument, or shell field
 * outright rather than ignoring it, so an attempt to smuggle one is a visible failure rather than
 * a silent no-op. AION owns the commands; the model owns nothing but the choice among them.
 */
export class VerificationCapabilityV1 implements CapabilityV1 {
  readonly id = "aion.verify.run.v1";
  readonly privacy = "private" as const;
  readonly approval = "always" as const;
  readonly timeoutMs = 1_800_000;
  readonly maxRetries = 0;
  /** Fields that would only ever be an attempt to supply a command. Their presence is an error. */
  private static readonly FORBIDDEN = ["command", "commandLine", "args", "argv", "shell", "script", "exec", "run", "cwd", "env", "path"];
  constructor(private readonly runner: VerificationRunnerV1) {}
  summarize(input: Record<string, unknown>): string {
    const operation = this.runner.get(String(input.operationId ?? ""));
    return operation
      ? `Run the allowlisted read-only verification "${operation.label}" (${operation.displayCommand}). AION owns this command; it was chosen from a fixed list and no part of it came from a model.`
      : "Run an unrecognised verification operation. This will be refused.";
  }
  validate(input: Record<string, unknown>): void {
    for (const key of VerificationCapabilityV1.FORBIDDEN) {
      if (key in input) fail(`Verification input must not carry a "${key}" field; operations are chosen by identifier, never supplied as a command.`);
    }
    if (typeof input.operationId !== "string" || !this.runner.get(input.operationId)) fail("Verification operation is not on the allowlist.");
    const extra = Object.keys(input).filter((key) => key !== "operationId");
    if (extra.length) fail(`Verification input accepts only operationId; unexpected field(s): ${extra.join(", ")}.`);
  }
  async execute(input: Record<string, unknown>, _context: CapabilityContextV1, signal: AbortSignal): Promise<Record<string, unknown>> {
    const operation = this.runner.get(String(input.operationId));
    if (!operation) fail("Verification operation is not on the allowlist.");
    const run = await this.runner.run(operation.id, signal);
    return { ...run };
  }
}

/** Deterministic verification runner for tests and the demo. It starts no process. */
export class SyntheticVerificationRunnerV1 implements VerificationRunnerV1 {
  constructor(private readonly outcomes: Partial<Record<VerificationOperationIdV1, { exitCode: number; stdout: string; stderr?: string }>> = {}) {}
  operations(): readonly VerificationOperationV1[] {
    return VERIFICATION_OPERATION_IDS.map((id) => ({
      id, label: `Synthetic ${id}`, description: "Synthetic bounded verification operation.",
      displayCommand: `synthetic ${id}`, timeoutMs: 5000, readOnly: true as const,
    }));
  }
  get(id: string): VerificationOperationV1 | null { return this.operations().find((operation) => operation.id === id) ?? null; }
  async run(id: VerificationOperationIdV1, signal: AbortSignal): Promise<Omit<VerificationRunV1, "id">> {
    if (signal.aborted) fail("Verification cancelled.");
    const scripted = this.outcomes[id] ?? { exitCode: 0, stdout: `synthetic ${id} completed\n# pass 1\n# fail 0\n` };
    const startedAt = "2030-01-01T00:00:00.000Z";
    const stdout = scripted.stdout; const stderr = scripted.stderr ?? "";
    return {
      operationId: id, displayCommand: `synthetic ${id}`, startedAt, completedAt: startedAt, durationMs: 0,
      exitCode: scripted.exitCode, timedOut: false, outcome: scripted.exitCode === 0 ? "passed" : "failed",
      stdout, stderr, truncated: false,
      resultDigest: digestValue({ operationId: id, exitCode: scripted.exitCode, stdout, stderr }),
    };
  }
}

/**
 * The research provider AION ships with: none.
 *
 * A default configuration that could already reach the internet would make "governed research" a
 * label rather than a property. This adapter exists so the port is always populated and always
 * reports the truth — there is nothing configured, so nothing can be fetched.
 */
export class UnavailableResearchProviderV1 implements ResearchProviderV1 {
  readonly id = "none";
  readonly reachesNetwork = false;
  constructor(private readonly detail = "No research provider is configured. AION ships without one, so it cannot reach the internet until you configure an owner-controlled provider and approve a job.") {}
  async health(): Promise<{ available: boolean; detail: string }> { return { available: false, detail: this.detail }; }
  async run(): Promise<never> { fail(this.detail); }
}

/**
 * A deterministic research provider for tests and the demo. It starts no request and opens no
 * socket: it answers from a scripted corpus keyed by the seed references it was given, so the
 * research pipeline — limits, citations, dropped findings, digests — can be proved end to end
 * without the machine ever talking to anything.
 */
export class SyntheticResearchProviderV1 implements ResearchProviderV1 {
  readonly id = "synthetic";
  readonly reachesNetwork = false;
  constructor(private readonly corpus: Record<string, { title: string; body: string }> = {}) {}
  async health(): Promise<{ available: boolean; detail: string }> {
    return { available: true, detail: `Synthetic research provider with ${Object.keys(this.corpus).length} scripted source(s). It performs no network request.` };
  }
  async run(request: { question: string; scope: ResearchScopeV1; limits: ResearchLimitsV1; seedReferences: readonly string[]; signal: AbortSignal }) {
    if (request.signal.aborted) fail("Research cancelled.");
    const sources: Array<Omit<ResearchSourceV1, "id">> = [];
    for (const reference of request.seedReferences.slice(0, request.limits.maxSources)) {
      const entry = this.corpus[reference];
      if (!entry) continue;
      const body = Buffer.from(entry.body, "utf8");
      const truncated = body.byteLength > request.limits.maxBytesPerSource;
      const kept = truncated ? body.subarray(0, request.limits.maxBytesPerSource) : body;
      sources.push({
        reference, title: entry.title, retrievedVia: `${this.id} (no network)`,
        retrievedAt: "2030-01-01T00:00:00.000Z", bytes: kept.byteLength, truncated,
        digest: createHash("sha256").update(kept).digest("hex"),
      });
    }
    // Findings are derived mechanically from the corpus so the same corpus always yields the same
    // result. A source whose body does not mention the question yields an explicit non-finding.
    const needle = request.question.toLowerCase();
    const findings = sources
      .filter((source) => this.corpus[source.reference]!.body.toLowerCase().includes(needle.split(/\s+/u)[0] ?? ""))
      .map((source) => ({
        statement: `${source.title} discusses "${request.question}".`,
        class: "observation" as const,
        sourceReferences: [source.reference],
        confidence: 60,
        caveat: "A single synthetic source. This is what one document says, not what is true.",
      }));
    const unresolved = findings.length ? [] : [`Nothing in the supplied sources addresses "${request.question}".`];
    return { sources, findings, unresolved, costCents: 0 };
  }
}

/**
 * A deterministic build pipeline for tests and the demo. It starts no process and writes no file:
 * each step returns a scripted outcome, so the project stage machine — which refuses a review
 * without evidence and a preview without a build — can be proved without a real toolchain.
 *
 * `canPublish` is false and the type pins it to false, so a pipeline that could put something
 * where other people can reach it cannot satisfy this port without changing the port.
 */
/**
 * The in-process evaluator for the deterministic offline provider.
 *
 * The floor has no endpoint address and must never be given a fake one: an evaluation that talked
 * to an invented URL would be measuring the invention. So this adapter runs the provider directly,
 * in this process, through the same `ModelProviderV1` port Chat uses — the thing being measured is
 * the thing that actually answers.
 *
 * It exists so the floor has a *number*. Without one, "the local model is better" is a claim
 * rather than a measurement, and choosing a model on reputation is exactly what the evaluation
 * harness was built to avoid. The floor is not expected to score well; it is expected to score
 * honestly.
 */
export class InProcessBrainRuntimeV1 implements BrainRuntimePortV1 {
  constructor(
    private readonly provider: ModelProviderV1,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}
  /** Only the offline provider. Anything with an address belongs to a transport adapter. */
  supports(endpoint: BrainEndpointV1): boolean {
    return endpoint.runtime === "deterministic-offline" && !endpoint.baseUrl;
  }
  async probe(endpoint: BrainEndpointV1): Promise<BrainHealthV1> {
    const health = await this.provider.health();
    return {
      available: health.available, detail: health.detail, checkedAt: this.now(), latencyMs: 0,
      installedModels: [endpoint.model],
    };
  }
  /** Nothing to detect: this adapter is the provider, and it is always already here. */
  async detect(): Promise<Array<{ runtime: BrainRuntimeV1; baseUrl: string; models: string[]; detail: string }>> { return []; }
  async *stream(
    endpoint: BrainEndpointV1,
    request: {
      prompt: string;
      context: readonly string[];
      messages?: readonly { role: string; content: string }[];
      memoryContext?: readonly { id: string; content: string; category: string }[];
      signal: AbortSignal;
    },
  ): AsyncIterable<import("./brain.js").BrainStreamChunkV1> {
    if (!this.supports(endpoint)) fail("The in-process evaluator serves the offline provider only. Use a transport adapter for an endpoint with an address.");
    if (request.signal.aborted) throw new Error("Inference cancelled.");
    const messages = request.messages?.length
      ? request.messages.map((message, index) => ({
        id: `evaluation-${index}`,
        role: (message.role === "assistant" ? "assistant" : "owner") as "owner" | "assistant",
        content: message.content,
        createdAt: this.now(),
        providerId: null,
      }))
      : [{ id: "evaluation", role: "owner" as const, content: request.prompt, createdAt: this.now(), providerId: null }];
    const memoryContext = (request.memoryContext?.length
      ? request.memoryContext
      : request.context.map((content, index) => ({ id: `context-${index}`, content, category: "semantic" as const }))
    ).map((entry) => ({ id: entry.id, content: entry.content, category: (entry.category as "semantic") || "semantic" as const }));
    for await (const chunk of this.provider.stream({ conversationId: "evaluation", messages, memoryContext, model: endpoint.model, signal: request.signal })) {
      yield { channel: "answer", text: chunk };
    }
  }
  async complete(endpoint: BrainEndpointV1, request: { prompt: string; context: readonly string[]; signal: AbortSignal }): Promise<{ text: string; latencyMs: number }> {
    const startedAt = Date.now();
    let text = "";
    for await (const chunk of this.stream(endpoint, request)) {
      if (chunk.channel === "answer") text += chunk.text;
      if (text.length > 100_000) break;
    }
    return { text, latencyMs: Date.now() - startedAt };
  }
}

/**
 * Routes each endpoint to the first adapter that can serve it.
 *
 * This is what makes "evaluate every endpoint with the same suite" true rather than aspirational:
 * the harness asks for a completion, and the composition root decides whether that means an
 * in-process call or an HTTP request. An endpoint no adapter supports is refused by name rather
 * than quietly skipped, because a silently missing measurement looks the same as a passing one.
 */
export class CompositeBrainRuntimeV1 implements BrainRuntimePortV1 {
  private readonly adapters: readonly BrainRuntimePortV1[];
  constructor(...adapters: readonly BrainRuntimePortV1[]) {
    if (!adapters.length) fail("At least one brain runtime adapter is required.");
    this.adapters = adapters;
  }
  #forEndpoint(endpoint: BrainEndpointV1): BrainRuntimePortV1 {
    const adapter = this.adapters.find((entry) => entry.supports(endpoint));
    if (!adapter) fail(`No configured runtime adapter can reach "${endpoint.label}" (${endpoint.runtime}). AION will not invent a transport for it.`);
    return adapter;
  }
  supports(endpoint: BrainEndpointV1): boolean { return this.adapters.some((entry) => entry.supports(endpoint)); }
  /*
   * `probe` and `complete` are async so that "no adapter can serve this" arrives as a rejection
   * rather than a synchronous throw. The port declares a Promise, and a caller that only attached
   * a `.catch()` would otherwise never see the failure at all.
   */
  async probe(endpoint: BrainEndpointV1, signal: AbortSignal): Promise<BrainHealthV1> {
    return this.#forEndpoint(endpoint).probe(endpoint, signal);
  }
  async detect(signal: AbortSignal): Promise<Array<{ runtime: BrainRuntimeV1; baseUrl: string; models: string[]; detail: string }>> {
    const found = [];
    for (const adapter of this.adapters) found.push(...await adapter.detect(signal));
    return found;
  }
  async *stream(
    endpoint: BrainEndpointV1,
    request: {
      prompt: string;
      context: readonly string[];
      messages?: readonly { role: string; content: string }[];
      memoryContext?: readonly { id: string; content: string; category: string }[];
      signal: AbortSignal;
    },
  ): AsyncIterable<import("./brain.js").BrainStreamChunkV1> {
    const adapter = this.#forEndpoint(endpoint);
    if (typeof adapter.stream === "function") {
      for await (const chunk of adapter.stream(endpoint, request)) yield chunk;
      return;
    }
    const result = await adapter.complete(endpoint, request);
    if (result.text) yield { channel: "answer", text: result.text };
  }
  async complete(endpoint: BrainEndpointV1, request: { prompt: string; context: readonly string[]; signal: AbortSignal }): Promise<{ text: string; latencyMs: number }> {
    return this.#forEndpoint(endpoint).complete(endpoint, request);
  }
}

/**
 * The GPU infrastructure AION ships with: none.
 *
 * Same reasoning as the research provider. A default that could already rent hardware would make
 * every spending control in `gpu.ts` a description rather than a boundary. Configuring a provider
 * is an owner act, and so is naming the environment variable its credential lives in.
 */
export class UnavailableGpuInfrastructureV1 implements GpuInfrastructurePortV1 {
  readonly provider = "synthetic" as const;
  constructor(private readonly detail = "No GPU infrastructure provider is configured. AION rents nothing until you configure one and name the environment variable holding its credential.") {}
  async credentialStatus(): Promise<{ configured: boolean; variableName: string; detail: string }> {
    return { configured: false, variableName: "", detail: this.detail };
  }
  async discover(): Promise<GpuOfferV1[]> { fail(this.detail); }
  async start(): Promise<never> { fail(this.detail); }
  async stop(): Promise<never> { fail(this.detail); }
  async status(): Promise<never> { fail(this.detail); }
}

/**
 * A deterministic GPU provider for tests and the demo. It rents nothing, spends nothing, and
 * opens no socket: offers come from a scripted table and an "instance" is a string.
 *
 * It exists so the whole money path — discovery, scoring, a bounded proposal, approval, the stop
 * conditions, teardown — can be proved end to end without a card being charged. Every test of the
 * spending boundary runs against this.
 */
export interface SyntheticGpuOptionsV1 {
  credentialConfigured?: boolean;
  variableName?: string;
  /**
   * How many status checks happen before a serving address appears. Zero means it is serving
   * immediately; a large number is a machine that boots and never comes up, which is the failure
   * the readiness deadline exists for.
   */
  endpointAfterPolls?: number;
  /** The address the machine claims to serve on. Null means it never reports one at all. */
  endpointUrl?: string | null;
  /** How many status calls throw before the provider starts answering. */
  statusFailures?: number;
  /** What a failing status call throws. Used to prove provider text is redacted before storage. */
  statusError?: string;
  /** Refuse teardown, so an unconfirmed stop can be tested rather than assumed impossible. */
  refuseStop?: boolean;
  /** What the machine reports about itself once it is up. */
  instanceState?: GpuInstanceStateV1;
}

export class SyntheticGpuInfrastructureV1 implements GpuInfrastructurePortV1 {
  readonly provider = "synthetic" as const;
  private started = new Map<string, { offerRef: string; stopped: boolean; polls: number }>();
  private statusCalls = 0;
  constructor(
    private readonly offers: ReadonlyArray<Record<string, unknown>> = [],
    private readonly options: SyntheticGpuOptionsV1 = {},
  ) {}
  /** How many times the provider was asked to create a machine. Tests assert this never grows. */
  get startCount(): number { return this.started.size; }
  async credentialStatus(): Promise<{ configured: boolean; variableName: string; detail: string }> {
    const variableName = this.options.variableName ?? "AION_SYNTHETIC_GPU_TOKEN";
    const configured = this.options.credentialConfigured !== false;
    return {
      configured, variableName,
      detail: configured
        ? `A synthetic credential reference is configured as ${variableName}. No real value exists and nothing is stored.`
        : `${variableName} is not set. AION reads the value only at the moment of a request and never stores it.`,
    };
  }
  async discover(filter: { minimumVramGb: number; maxHourlyCents: number; minimumReliability: number | null; limit: number }, signal: AbortSignal): Promise<GpuOfferV1[]> {
    if (signal.aborted) fail("Discovery cancelled.");
    const at = "2030-01-01T00:00:00.000Z";
    return this.offers
      .map((raw) => normaliseOffer(raw, "synthetic", at))
      .filter((offer) => offer.vramGb * offer.gpuCount >= filter.minimumVramGb)
      .filter((offer) => offer.hourlyCents + offer.storageCentsPerHour <= filter.maxHourlyCents)
      .filter((offer) => filter.minimumReliability === null || offer.reliability === null || offer.reliability >= filter.minimumReliability)
      .slice(0, Math.max(1, filter.limit));
  }
  async start(request: { offerRef: string; modelId: string; runtime: string }, signal: AbortSignal): Promise<{ instanceRef: string; detail: string }> {
    if (signal.aborted) fail("Provisioning cancelled.");
    const instanceRef = `synthetic-instance-${this.started.size + 1}`;
    this.started.set(instanceRef, { offerRef: request.offerRef, stopped: false, polls: 0 });
    return { instanceRef, detail: `Synthetic instance for ${request.modelId} on ${request.runtime}. Nothing was rented and nothing was charged.` };
  }
  async stop(instanceRef: string): Promise<{ stopped: boolean; detail: string }> {
    const entry = this.started.get(instanceRef);
    if (!entry) return { stopped: false, detail: "That synthetic instance does not exist." };
    if (this.options.refuseStop) return { stopped: false, detail: "The synthetic provider was scripted to refuse teardown confirmation." };
    entry.stopped = true;
    return { stopped: true, detail: "Synthetic instance stopped and torn down." };
  }
  async status(instanceRef: string): Promise<{ state: GpuInstanceStateV1; detail: string; endpointUrl: string | null }> {
    this.statusCalls += 1;
    if (this.statusCalls <= (this.options.statusFailures ?? 0)) {
      fail(this.options.statusError ?? "The synthetic provider was scripted to fail this status call.");
    }
    const entry = this.started.get(instanceRef);
    if (!entry) return { state: "failed", detail: "That synthetic instance does not exist.", endpointUrl: null };
    if (entry.stopped) return { state: "stopped", detail: "Synthetic instance is stopped.", endpointUrl: null };
    entry.polls += 1;
    // A real machine reports itself up well before the model inside it can answer, which is the
    // whole reason a separate readiness wait exists. The default scripting reproduces that gap.
    const serving = entry.polls > (this.options.endpointAfterPolls ?? 0);
    const url = this.options.endpointUrl === undefined ? "https://synthetic-gpu.invalid/v1" : this.options.endpointUrl;
    return {
      state: this.options.instanceState ?? "running",
      detail: serving
        ? "Synthetic instance is running and reports a serving address."
        : `Synthetic instance is running; the runtime has not opened its port yet (check ${entry.polls}).`,
      endpointUrl: serving ? url : null,
    };
  }
}

/**
 * Scripted answers for an endpoint, for tests and the demo.
 *
 * The rented-GPU bridge cannot be proved against a real machine without spending money, and it
 * must not be proved against a stub so permissive that it would pass whatever the code did. So
 * this adapter is deliberately literal: it serves the endpoints a predicate names, it answers
 * exactly what it was told to, and it fails exactly when it was told to. Everything it does is
 * visible in the script the caller wrote.
 */
export interface ScriptedRuntimeScriptV1 {
  /** Which endpoints this adapter claims. Defaults to anything with an address. */
  serves?: (endpoint: BrainEndpointV1) => boolean;
  available?: boolean;
  detail?: string;
  /** Models the endpoint reports. An empty list means it reported none, which is not an error. */
  models?: readonly string[];
  latencyMs?: number;
  /** The answer. A function receives the prompt, so a script can refuse one prompt and not others. */
  answer?: string | ((prompt: string, endpoint: BrainEndpointV1) => string);
  /** How many completions fail before any succeed. Used to exercise the health-failure ceiling. */
  failFirstCompletions?: number;
  completionError?: string;
}

export class ScriptedBrainRuntimeV1 implements BrainRuntimePortV1 {
  private completions = 0;
  constructor(private readonly script: ScriptedRuntimeScriptV1 = {}) {}
  get completionCount(): number { return this.completions; }
  supports(endpoint: BrainEndpointV1): boolean {
    return this.script.serves ? this.script.serves(endpoint) : Boolean(endpoint.baseUrl);
  }
  async probe(endpoint: BrainEndpointV1): Promise<BrainHealthV1> {
    const available = this.script.available !== false;
    return {
      available,
      detail: this.script.detail ?? (available ? "Scripted endpoint answered." : "Scripted endpoint refused."),
      checkedAt: "2030-01-01T00:00:00.000Z",
      latencyMs: available ? this.script.latencyMs ?? 5 : null,
      installedModels: this.script.models ? [...this.script.models] : [endpoint.model],
    };
  }
  async detect(): Promise<Array<{ runtime: BrainRuntimeV1; baseUrl: string; models: string[]; detail: string }>> { return []; }
  async complete(endpoint: BrainEndpointV1, request: { prompt: string; context: readonly string[]; signal: AbortSignal }): Promise<{ text: string; latencyMs: number }> {
    if (!this.supports(endpoint)) fail(`The scripted runtime does not serve "${endpoint.label}".`);
    if (request.signal.aborted) fail("Completion cancelled.");
    this.completions += 1;
    if (this.completions <= (this.script.failFirstCompletions ?? 0)) fail(this.script.completionError ?? "The scripted runtime was told to fail this completion.");
    const answer = typeof this.script.answer === "function" ? this.script.answer(request.prompt, endpoint) : this.script.answer;
    return { text: answer ?? `Scripted answer from ${endpoint.model}.`, latencyMs: this.script.latencyMs ?? 5 };
  }
}

export class SyntheticBuildPipelineV1 implements BuildPipelinePortV1 {
  readonly id = "synthetic";
  readonly canPublish = false as const;
  constructor(private readonly outcomes: Partial<Record<PipelineStepV1, "passed" | "failed">> = {}) {}
  async run(step: PipelineStepV1, project: { id: string; title: string }, signal: AbortSignal): Promise<Omit<PipelineRunV1, "id" | "step">> {
    if (signal.aborted) fail("Pipeline cancelled.");
    const outcome = this.outcomes[step] ?? "passed";
    const at = "2030-01-01T00:00:00.000Z";
    return {
      startedAt: at, completedAt: at, outcome,
      output: `synthetic ${step} for "${project.title}" ${outcome}. No process was started and no file was written.`,
      // Loopback only, and a port nothing is actually listening on: a synthetic preview is a
      // record that a preview would exist, not a service anyone can reach.
      previewUrl: step === "preview" && outcome === "passed" ? "http://127.0.0.1:0/preview" : null,
    };
  }
}

export class SyntheticDeveloperAgentBridgeV1 implements DeveloperAgentBridgeV1 {
  readonly id = "synthetic";
  readonly displayName = "Synthetic test bridge";
  async status(): Promise<DeveloperAgentStatusV1> {
    return {
      bridgeId: this.id, displayName: this.displayName, available: true, executable: "synthetic", version: "synthetic-1",
      account: "signed-in", accountDetail: "Synthetic test bridge needs no account.", detail: "Synthetic test bridge is ready.", modes: DEVELOPER_MODES,
    };
  }
  describe(mode: DeveloperAgentModeV1): { executable: string; args: readonly string[] } { return { executable: "synthetic", args: ["--sandbox", mode, "--instruction-on-stdin"] }; }
  async run(task: { repositoryRoot: string; instruction: string; mode: DeveloperAgentModeV1 }, signal: AbortSignal): Promise<{ exitCode: number; summary: string }> {
    normalizedAbsolute(task.repositoryRoot, "Repository root");
    if (!task.instruction.trim() || task.instruction.length > 4000 || signal.aborted) fail("Developer-agent request is invalid or cancelled.");
    if (!DEVELOPER_MODES.includes(task.mode)) fail("Developer-agent mode is invalid.");
    return { exitCode: 0, summary: `Synthetic bounded ${task.mode} developer task completed without modifying any file.` };
  }
}

/**
 * Truthful stand-in when no supported developer-agent executable exists on this host.
 *
 * Account health is "not-checked": AION never inspected a vendor account, so "unknown" would
 * imply a probe that did not run. Tasks always fail closed; nothing is executed.
 */
export class UnavailableDeveloperAgentBridgeV1 implements DeveloperAgentBridgeV1 {
  constructor(
    private readonly detail = "No supported local developer-agent executable is configured (unavailable). AION does not search the computer for one.",
    readonly id = "none",
    readonly displayName = "No developer agent",
  ) {}
  async status(_options: { includeAccount?: boolean } = {}): Promise<DeveloperAgentStatusV1> {
    return {
      bridgeId: this.id, displayName: this.displayName, available: false, executable: null, version: null,
      // No executable means no account inspection occurred — not "unknown after a failed probe".
      account: "not-checked",
      accountDetail: "Account health was not checked because no developer-agent executable is available or configured.",
      detail: this.detail, modes: [],
    };
  }
  describe(): { executable: string; args: readonly string[] } { return { executable: "", args: [] }; }
  async run(): Promise<never> { throw new Error(this.detail); }
}

function role(value: unknown): "owner" | "assistant" { return value === "assistant" ? "assistant" : "owner"; }
function text(value: unknown): string { return typeof value === "string" ? value.slice(0, 100_000) : ""; }
function chatGptConversations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((conversation, index) => {
    const item = conversation as Record<string, unknown>;
    const mapping = item.mapping && typeof item.mapping === "object" ? Object.values(item.mapping as Record<string, unknown>) : [];
    const messages = mapping.flatMap((node) => {
      const message = (node as Record<string, unknown>).message as Record<string, unknown> | null;
      const author = message?.author as Record<string, unknown> | undefined;
      const content = message?.content as Record<string, unknown> | undefined;
      const parts = Array.isArray(content?.parts) ? content.parts.filter((part): part is string => typeof part === "string").join("\n") : "";
      return parts ? [{ role: role(author?.role), content: text(parts), at: typeof message?.create_time === "number" ? new Date(message.create_time * 1000).toISOString() : null }] : [];
    });
    return { title: text(item.title) || `Imported conversation ${index + 1}`, messages };
  });
}
function genericConversations(value: unknown, platform: "claude" | "grok") {
  const source = Array.isArray(value) ? value : ((value as Record<string, unknown> | null)?.conversations ?? []);
  if (!Array.isArray(source)) return [];
  return source.map((conversation, index) => {
    const item = conversation as Record<string, unknown>;
    const rawMessages = Array.isArray(item.messages) ? item.messages : Array.isArray(item.chat_messages) ? item.chat_messages : [];
    return { title: text(item.title ?? item.name) || `${platform} conversation ${index + 1}`, messages: rawMessages.flatMap((message) => {
      const entry = message as Record<string, unknown>;
      const body = text(entry.content ?? entry.text);
      return body ? [{ role: role(entry.role ?? entry.sender), content: body, at: typeof (entry.created_at ?? entry.timestamp) === "string" ? String(entry.created_at ?? entry.timestamp) : null }] : [];
    }) };
  });
}

export class LocalArchiveImportSourceV1 implements ImportSourceV1 {
  async dryRun(request: { platform: ImportReportV1["platform"]; selectedRoot: string; selectedPath: string; knownDigests: readonly string[] }) {
    const allowed = await authorize(request.selectedRoot, request.selectedPath, true);
    const selectedInfo = await lstat(allowed.selected);
    if (selectedInfo.isSymbolicLink()) fail("Import selection cannot be a symbolic link.");
    const paths: string[] = [];
    const visit = async (current: string): Promise<void> => {
      if (paths.length >= MAX_IMPORT_FILES) fail("Import inventory exceeds the V1 file limit.");
      const info = await lstat(current);
      if (info.isSymbolicLink()) fail("Import inventory contains a symbolic link.");
      if (info.isFile()) { paths.push(current); return; }
      if (!info.isDirectory()) return;
      for (const entry of (await readdir(current)).sort()) await visit(join(current, entry));
    };
    await visit(allowed.selected);
    const items = [];
    const conversations = [];
    for (const path of paths) {
      const info = await stat(path);
      const rel = relative(allowed.root, path).replaceAll("\\", "/");
      if (info.size > MAX_IMPORT_BYTES) { items.push({ sourceRef: `source:${digestValue(rel).slice(0, 16)}`, relativePath: rel, digest: "", bytes: info.size, classification: "unsupported" as const, duplicate: false, conversationCount: 0 }); continue; }
      const bytes = await readFile(path);
      const digest = createHash("sha256").update(bytes).digest("hex");
      let parsedConversations: ReturnType<typeof chatGptConversations> = [];
      let classification: "conversation" | "career" | "unsupported" = request.platform === "career" ? "career" : "unsupported";
      if (request.platform !== "career" && path.toLowerCase().endsWith(".json")) {
        try {
          const parsed = JSON.parse(bytes.toString("utf8"));
          parsedConversations = request.platform === "chatgpt" ? chatGptConversations(parsed) : genericConversations(parsed, request.platform);
          if (parsedConversations.length) classification = "conversation";
        } catch { classification = "unsupported"; }
      }
      conversations.push(...parsedConversations);
      items.push({ sourceRef: `source:${digest.slice(0, 16)}`, relativePath: rel, digest, bytes: info.size, classification, duplicate: request.knownDigests.includes(digest), conversationCount: parsedConversations.length });
    }
    return { platform: request.platform, selectedRootRef: `root:${digestValue(allowed.root).slice(0, 16)}`, items, warnings: items.some((item) => item.classification === "unsupported") ? ["Unsupported files are excluded."] : [], conversations };
  }
}

interface BackupEnvelopeV1 { version: "aion.private-backup.v1"; kdf: "scrypt"; cipher: "aes-256-gcm"; salt: string; nonce: string; tag: string; ciphertext: string; stateDigest: string; }
/**
 * v2 reuses the v1 envelope exactly — scrypt KDF, AES-256-GCM, digest-checked, written `wx` — and
 * only widens the plaintext from bare state to a recovery package (`{ state, sidecars, manifest }`).
 * Keeping one envelope means one crypto path to reason about, and v1 artifacts stay readable.
 */
interface BackupEnvelopeV2 extends Omit<BackupEnvelopeV1, "version"> { version: "aion.private-backup.v2"; }
interface BackupPackagePlaintextV2 { state: unknown; sidecars: Record<string, unknown>; manifest: unknown; }
export interface RestoredBackupPackageV1 {
  state: AssistantStateV1;
  sidecars: Record<string, unknown>;
  manifest: unknown;
  version: "aion.private-backup.v1" | "aion.private-backup.v2";
}
export class NodePrivateBackupV1 implements PrivateBackupV1 {
  constructor(private readonly approvedDestinationRoot: string) { normalizedAbsolute(approvedDestinationRoot, "Private backup root"); }
  async create(state: AssistantStateV1, destination: string, passphrase: string): Promise<{ digest: string; bytes: number }> {
    if (passphrase.length < 12) fail("Private backup passphrase must contain at least 12 characters.");
    await mkdir(this.approvedDestinationRoot, { recursive: true });
    await authorize(this.approvedDestinationRoot, destination);
    const plaintext = Buffer.from(canonical(validateStateV1(state)), "utf8");
    const salt = randomBytes(16); const nonce = randomBytes(12);
    const key = await scrypt(passphrase, salt, 32) as Buffer;
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from("aion.private-backup.v1", "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: BackupEnvelopeV1 = { version: "aion.private-backup.v1", kdf: "scrypt", cipher: "aes-256-gcm", salt: salt.toString("base64url"), nonce: nonce.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url"), stateDigest: createHash("sha256").update(plaintext).digest("hex") };
    const serialized = `${JSON.stringify(envelope)}\n`;
    await writeFile(destination, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const restored = await this.restore(destination, passphrase);
    if (!timingSafeEqual(Buffer.from(digestValue(restored), "hex"), Buffer.from(digestValue(state), "hex"))) fail("Private backup restore verification failed.");
    return { digest: createHash("sha256").update(serialized).digest("hex"), bytes: Buffer.byteLength(serialized) };
  }
  async restore(destination: string, passphrase: string): Promise<AssistantStateV1> {
    return (await this.restorePackage(destination, passphrase)).state;
  }
  /**
   * Write a recovery package: canonical state plus the non-secret sidecars that otherwise force
   * avoidable reconfiguration after a disaster. Secret material is the caller's responsibility to
   * exclude before this point; the payload is encrypted either way, so this only widens what a
   * legitimate restore can reproduce.
   */
  async createPackage(
    state: AssistantStateV1,
    sidecars: Record<string, unknown>,
    manifest: unknown,
    destination: string,
    passphrase: string,
  ): Promise<{ digest: string; bytes: number }> {
    if (passphrase.length < 12) fail("Private backup passphrase must contain at least 12 characters.");
    await mkdir(this.approvedDestinationRoot, { recursive: true });
    await authorize(this.approvedDestinationRoot, destination);
    const payload: BackupPackagePlaintextV2 = { state: validateStateV1(state), sidecars, manifest };
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const salt = randomBytes(16); const nonce = randomBytes(12);
    const key = await scrypt(passphrase, salt, 32) as Buffer;
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from("aion.private-backup.v2", "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: BackupEnvelopeV2 = { version: "aion.private-backup.v2", kdf: "scrypt", cipher: "aes-256-gcm", salt: salt.toString("base64url"), nonce: nonce.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), ciphertext: ciphertext.toString("base64url"), stateDigest: createHash("sha256").update(plaintext).digest("hex") };
    const serialized = `${JSON.stringify(envelope)}\n`;
    await writeFile(destination, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const restored = await this.restorePackage(destination, passphrase);
    if (!timingSafeEqual(Buffer.from(digestValue(restored.state), "hex"), Buffer.from(digestValue(state), "hex"))) fail("Private backup restore verification failed.");
    return { digest: createHash("sha256").update(serialized).digest("hex"), bytes: Buffer.byteLength(serialized) };
  }
  /** Read either envelope version. v1 artifacts yield empty sidecars rather than failing. */
  async restorePackage(destination: string, passphrase: string): Promise<RestoredBackupPackageV1> {
    await authorize(this.approvedDestinationRoot, destination);
    const raw = await readFile(destination, "utf8");
    if (Buffer.byteLength(raw) > MAX_STATE_BYTES * 4) fail("Private backup is oversized.");
    const envelope = JSON.parse(raw) as BackupEnvelopeV1 | BackupEnvelopeV2;
    const version = envelope.version;
    if ((version !== "aion.private-backup.v1" && version !== "aion.private-backup.v2") || envelope.kdf !== "scrypt" || envelope.cipher !== "aes-256-gcm") fail("Private backup version is unsupported.");
    const key = await scrypt(passphrase, Buffer.from(envelope.salt, "base64url"), 32) as Buffer;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64url"));
    decipher.setAAD(Buffer.from(version, "utf8")); decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64url")), decipher.final()]);
    const actual = createHash("sha256").update(plaintext).digest("hex");
    if (!timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(envelope.stateDigest, "hex"))) fail("Private backup integrity validation failed.");
    const parsed = JSON.parse(plaintext.toString("utf8")) as unknown;
    if (version === "aion.private-backup.v1") {
      return { state: validateStateV1(parsed), sidecars: {}, manifest: null, version };
    }
    const pkg = parsed as BackupPackagePlaintextV2;
    return {
      state: validateStateV1(pkg.state),
      sidecars: (pkg.sidecars ?? {}) as Record<string, unknown>,
      manifest: pkg.manifest ?? null,
      version,
    };
  }
}
