/**
 * MVA Real Dispatch V1.
 *
 * Director accepts a bounded repository-reversible job, freezes a JobEnvelopeV1,
 * routes through Provider Bridge V1, holds one WORKTREE lease, and runs a real
 * bounded adapter. Failover never broadens the envelope. UNKNOWN writers fail closed.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic-write.js";
import {
  acquireLease,
  releaseLease,
  type LeaseV1,
} from "./leases.js";
import {
  createTakeoverPayload,
  defaultProviderCapabilities,
  defaultProviderHealth,
  envelopesEqual,
  executeWithFailover,
  freezeJobEnvelope,
  parseProviderHealth,
  recoverCircuit,
  routeJob,
  serializeAttemptLedger,
  serializeProviderHealth,
  type AttemptRecordV1,
  type AuthorityOutcomeV1,
  type AuthorityRequestV1,
  type EffectSafetyClassV1,
  type FailureClassV1,
  type JobEnvelopeV1,
  type OwnerProviderOverridesV1,
  type ProviderAdapterV1,
  type ProviderHealthV1,
  type ProviderIdV1,
  type SensitivityClassV1,
  type TakeoverPayloadV1,
  type WriterStateV1,
  PROVIDER_IDS_V1,
} from "./provider-bridge.js";
import { isResolvedHostPath } from "./host-path.js";
import { validatePathSegment } from "./store-contract.js";

export const MVA_DISPATCH_SCHEMA_V1 = "aion.director.mvaDispatch.v1" as const;
export const MVA_JOB_STORE_RELATIVE_PATH = ".aion-local/mva-dispatch";
export const MVA_MILESTONE_ID = "MVA-REAL-DISPATCH-V1";
export const MVA_OWNER_AUTHORIZATION_ID = "MVA-REAL-DISPATCH-V1-20260818T072919Z";
export const D2_CERTIFIED_SHA_V1 = "17b012b28d911fe563aab19f6e4a697a05b9b718";

export const JOB_STATES_V1 = [
  "CREATED",
  "AUTHORIZED",
  "ROUTING",
  "LEASE_ACQUIRED",
  "EXECUTING",
  "FAILOVER_PENDING",
  "VALIDATING",
  "SUCCEEDED",
  "FAILED",
  "DENIED",
  "NO_ELIGIBLE_PROVIDER",
  "AMBIGUOUS_EFFECT_BLOCKED",
  "RECOVERY_REQUIRED",
] as const;
export type JobStateV1 = (typeof JOB_STATES_V1)[number];

export type JobClassV1 = "REPOSITORY_REVERSIBLE" | "PRODUCTION_EXTERNAL_WRITE";

const TERMINAL: ReadonlySet<JobStateV1> = new Set([
  "SUCCEEDED",
  "FAILED",
  "DENIED",
  "NO_ELIGIBLE_PROVIDER",
  "AMBIGUOUS_EFFECT_BLOCKED",
  "RECOVERY_REQUIRED",
]);

const LEGAL: Readonly<Record<JobStateV1, readonly JobStateV1[]>> = {
  CREATED: ["AUTHORIZED", "DENIED", "FAILED"],
  AUTHORIZED: ["ROUTING", "DENIED", "FAILED"],
  ROUTING: ["LEASE_ACQUIRED", "NO_ELIGIBLE_PROVIDER", "DENIED", "FAILED", "AMBIGUOUS_EFFECT_BLOCKED"],
  LEASE_ACQUIRED: ["EXECUTING", "FAILED", "RECOVERY_REQUIRED", "DENIED"],
  EXECUTING: [
    "VALIDATING",
    "FAILOVER_PENDING",
    "FAILED",
    "RECOVERY_REQUIRED",
    "AMBIGUOUS_EFFECT_BLOCKED",
    "NO_ELIGIBLE_PROVIDER",
  ],
  FAILOVER_PENDING: ["ROUTING", "LEASE_ACQUIRED", "RECOVERY_REQUIRED", "FAILED", "NO_ELIGIBLE_PROVIDER"],
  VALIDATING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: [],
  FAILED: [],
  DENIED: [],
  NO_ELIGIBLE_PROVIDER: [],
  AMBIGUOUS_EFFECT_BLOCKED: [],
  RECOVERY_REQUIRED: [],
};

export interface JobRequestV1 {
  readonly jobId: string;
  readonly objective: string;
  readonly jobClass: JobClassV1;
  readonly repository: string;
  readonly worktree: string;
  readonly allowedPaths: readonly string[];
  readonly expectedArtifact: string;
  readonly startingSha: string;
  readonly preferredProvider?: ProviderIdV1 | null;
  readonly externalEffects?: readonly string[];
  readonly sensitiveDataClass?: SensitivityClassV1;
  readonly sensitiveDataAllowedProviders?: readonly ProviderIdV1[];
  readonly spendCapUsd?: number;
  readonly remainingSpendUsd?: number;
  readonly effectSafetyClass?: EffectSafetyClassV1;
  readonly maxProviderAttempts?: number;
  readonly retryLimit?: number;
  readonly writePermission?: boolean;
}

export interface DispatchBootstrapV1 {
  readonly schema: typeof MVA_DISPATCH_SCHEMA_V1;
  readonly jobId: string;
  readonly objective: string;
  readonly allowedPaths: readonly string[];
  readonly prohibitedEffects: readonly string[];
  readonly repository: string;
  readonly worktree: string;
  readonly branch: string;
  readonly gitHead: string;
  readonly milestoneId: string;
  readonly authoritySource: string;
  readonly ownerAuthorizationId: string;
  readonly agentsPath: string;
  readonly currentDirectivePath: string;
  readonly latestHandoffPath: string;
  readonly priorAttempts: readonly string[];
  readonly previousFailureClass: FailureClassV1 | null;
  readonly expectedArtifact: string;
  readonly expectedResult: string;
  readonly verificationRequirements: readonly string[];
  readonly leaseId: string;
  readonly retryBudget: number;
  readonly stopConditions: readonly string[];
}

export interface JobRecordV1 {
  readonly schema: typeof MVA_DISPATCH_SCHEMA_V1;
  readonly jobId: string;
  readonly milestoneId: string;
  readonly objective: string;
  readonly jobClass: JobClassV1;
  readonly authoritySource: string;
  readonly ownerAuthorizationId: string;
  readonly status: JobStateV1;
  readonly repository: string;
  readonly worktree: string;
  readonly allowedPaths: readonly string[];
  readonly startingSha: string;
  readonly endingSha: string | null;
  readonly envelope: JobEnvelopeV1 | null;
  readonly attempts: readonly AttemptRecordV1[];
  readonly activeAttemptId: string | null;
  readonly activeProvider: ProviderIdV1 | null;
  readonly leaseId: string | null;
  readonly leaseReleased: boolean;
  readonly writer: WriterStateV1;
  readonly artifacts: readonly string[];
  readonly verificationEvidence: readonly string[];
  readonly externalEffectState: string;
  readonly retryBudgetRemaining: number;
  readonly failureReason: string | null;
  readonly authorityDecision: AuthorityOutcomeV1 | null;
  readonly ownerPrompts: number;
  readonly workerLaunches: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly health: Readonly<Record<ProviderIdV1, ProviderHealthV1>>;
  readonly takeover: TakeoverPayloadV1 | null;
  readonly bootstrapPath: string | null;
}

export interface JobResultContractV1 {
  readonly jobId: string;
  readonly finalState: JobStateV1;
  readonly selectedProvider: ProviderIdV1 | null;
  readonly attempts: readonly AttemptRecordV1[];
  readonly startingSha: string;
  readonly endingSha: string | null;
  readonly artifacts: readonly string[];
  readonly validationEvidence: readonly string[];
  readonly authorityDecision: AuthorityOutcomeV1 | null;
  readonly spendUsd: number;
  readonly externalEffectState: string;
  readonly failureReason: string | null;
  readonly nextRecommendedAction: string;
  readonly ownerPrompts: number;
  readonly workerLaunches: number;
  readonly envelopeChanged: boolean;
  readonly envelope: JobEnvelopeV1 | null;
}

export interface JobStoreV1 {
  save(record: JobRecordV1): void;
  load(jobId: string): JobRecordV1 | null;
}

export interface MvaDispatchDepsV1 {
  readonly now?: string;
  readonly store?: JobStoreV1;
  readonly adapters?: Readonly<Partial<Record<ProviderIdV1, ProviderAdapterV1>>>;
  readonly health?: Readonly<Record<ProviderIdV1, ProviderHealthV1>>;
  readonly overrides?: OwnerProviderOverridesV1;
  readonly writer?: WriterStateV1;
  readonly decideAuthority?: (request: AuthorityRequestV1) => { outcome: AuthorityOutcomeV1; reason: string };
  readonly existingLeases?: readonly LeaseV1[];
  readonly artifactRoot?: string;
  readonly writeFile?: (path: string, contents: string) => void;
  readonly readFile?: (path: string) => string;
  readonly branch?: string;
  readonly currentDirectivePath?: string;
  readonly latestHandoffPath?: string;
}

export interface DispatchOutcomeV1 {
  readonly record: JobRecordV1;
  readonly result: JobResultContractV1;
  readonly leases: readonly LeaseV1[];
}

export function legalJobTransition(from: JobStateV1, to: JobStateV1): boolean {
  return LEGAL[from].includes(to);
}

export function defaultMvaAuthority(
  request: AuthorityRequestV1,
): { outcome: AuthorityOutcomeV1; reason: string } {
  if (request.actionKind === "PRODUCTION_WRITER" || request.productionWriter === "YES") {
    return { outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason: "production/external write requires fresh Owner approval" };
  }
  if (request.actionKind === "SPEND" && request.spendUsd > 0) {
    return { outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason: "spend requires fresh Owner approval" };
  }
  return { outcome: "ALLOW_STANDING", reason: "routine repository-reversible dispatch is covered" };
}

export function validateJobRequest(request: JobRequestV1): string | null {
  if (request === null || typeof request !== "object") return "request is missing";
  const id = validatePathSegment(request.jobId);
  if (!id.ok) return `jobId is not a safe path segment: ${id.reason}`;
  if (typeof request.objective !== "string" || request.objective.trim() === "") return "objective is empty";
  if (request.jobClass !== "REPOSITORY_REVERSIBLE" && request.jobClass !== "PRODUCTION_EXTERNAL_WRITE") {
    return "job class is not recognized";
  }
  if (!isResolvedHostPath(request.worktree)) return "worktree is not an identifiable host path";
  if (!Array.isArray(request.allowedPaths) || request.allowedPaths.length === 0) return "allowed paths are required";
  if (typeof request.expectedArtifact !== "string" || request.expectedArtifact.trim() === "") {
    return "expected artifact is empty";
  }
  if (typeof request.startingSha !== "string" || request.startingSha.trim() === "") return "starting SHA is empty";
  if ((request.spendCapUsd ?? 0) > 0 || (request.remainingSpendUsd ?? 0) > 0) {
    return "incremental spend is not permitted on this milestone";
  }
  return null;
}

export function buildJobEnvelope(request: JobRequestV1, now: string): JobEnvelopeV1 {
  return freezeJobEnvelope({
    jobId: request.jobId,
    milestoneId: MVA_MILESTONE_ID,
    objective: request.objective,
    authoritySource: "OWNER_STANDING_AUTHORITY_V1",
    ownerAuthorizationId: MVA_OWNER_AUTHORIZATION_ID,
    repository: request.repository,
    worktree: request.worktree,
    allowedPaths: request.allowedPaths,
    allowedComponents: ["director"],
    writePermission: request.writePermission ?? true,
    externalEffects: request.externalEffects ?? [],
    sensitiveDataClass: request.sensitiveDataClass ?? "INTERNAL",
    sensitiveDataAllowedProviders: request.sensitiveDataAllowedProviders ?? ["codex", "grok", "claude", "local"],
    spendCapUsd: request.spendCapUsd ?? 0,
    remainingSpendUsd: request.remainingSpendUsd ?? 0,
    providerCostCapUsd: 0,
    tokenOrUsageCap: null,
    timeLimitMs: 60_000,
    retryLimit: request.retryLimit ?? 3,
    maxProviderAttempts: request.maxProviderAttempts ?? 4,
    expectedArtifact: request.expectedArtifact,
    expectedResult: "SUCCESS",
    leaseId: `lease-${request.jobId}`,
    idempotencyKey: request.jobId,
    effectSafetyClass: request.effectSafetyClass ?? "REPOSITORY_REVERSIBLE",
    preferredProvider: request.preferredProvider ?? null,
    preferredModel: null,
    requiredCapabilities: ["CODING", "WRITE", "WORKTREE"],
    previousAttempts: [],
    createdAt: now,
  });
}

export function createDispatchBootstrap(input: {
  readonly envelope: JobEnvelopeV1;
  readonly gitHead: string;
  readonly branch?: string;
  readonly priorAttempts?: readonly string[];
  readonly previousFailureClass?: FailureClassV1 | null;
  readonly retryBudget: number;
}): DispatchBootstrapV1 {
  return {
    schema: MVA_DISPATCH_SCHEMA_V1,
    jobId: input.envelope.jobId,
    objective: input.envelope.objective,
    allowedPaths: input.envelope.allowedPaths,
    prohibitedEffects: [
      "PRODUCTION",
      "CUSTOMER_COMMUNICATION",
      "EMAIL",
      "PUBLISH",
      "PURCHASE",
      "CRM",
      "TEKION",
      "INFORMATIV",
      "OAUTH",
    ],
    repository: input.envelope.repository,
    worktree: input.envelope.worktree,
    branch: input.branch ?? "main",
    gitHead: input.gitHead,
    milestoneId: input.envelope.milestoneId,
    authoritySource: input.envelope.authoritySource,
    ownerAuthorizationId: input.envelope.ownerAuthorizationId,
    agentsPath: "AGENTS.md",
    currentDirectivePath: ".aion-local/directives/CURRENT.md",
    latestHandoffPath: ".aion-local/handoffs/LATEST.md",
    priorAttempts: input.priorAttempts ?? [],
    previousFailureClass: input.previousFailureClass ?? null,
    expectedArtifact: input.envelope.expectedArtifact,
    expectedResult: input.envelope.expectedResult,
    verificationRequirements: [
      "AION_MVA_REAL_DISPATCH_V1",
      "JOB_ID",
      "EXECUTOR",
      "MILESTONE",
    ],
    leaseId: input.envelope.leaseId,
    retryBudget: input.retryBudget,
    stopConditions: [
      "do not broaden the envelope",
      "do not launch a second writer while the previous is UNKNOWN",
      "do not spend",
      "do not perform production or external customer effects",
    ],
  };
}

export function artifactContents(envelope: JobEnvelopeV1, executor: ProviderIdV1): string {
  return [
    "AION_MVA_REAL_DISPATCH_V1",
    `JOB_ID = ${envelope.jobId}`,
    `EXECUTOR = ${executor}`,
    `MILESTONE = ${MVA_OWNER_AUTHORIZATION_ID}`,
    `OBJECTIVE = ${envelope.objective}`,
    `ALLOWED_PATHS = ${envelope.allowedPaths.join(",")}`,
    `SPEND_CAP_USD = ${envelope.spendCapUsd}`,
    `SENSITIVE_DATA_CLASS = ${envelope.sensitiveDataClass}`,
  ].join("\n") + "\n";
}

export function validateJobArtifact(contents: string, envelope: JobEnvelopeV1, executor: ProviderIdV1): string | null {
  if (typeof contents !== "string" || contents.trim() === "") return "artifact is empty";
  if (!contents.includes("AION_MVA_REAL_DISPATCH_V1")) return "artifact missing dispatch marker";
  if (!contents.includes(`JOB_ID = ${envelope.jobId}`)) return "artifact job id mismatch";
  if (!contents.includes(`EXECUTOR = ${executor}`)) return "artifact executor mismatch";
  if (!contents.includes(`MILESTONE = ${MVA_OWNER_AUTHORIZATION_ID}`)) return "artifact milestone mismatch";
  return null;
}

export function createRealBoundedExecutorAdapter(
  providerId: ProviderIdV1,
  deps: {
    readonly artifactRoot: string;
    readonly writeFile: (path: string, contents: string) => void;
    readonly readFile: (path: string) => string;
    readonly startingSha: string;
    readonly branch?: string;
  },
): ProviderAdapterV1 {
  return {
    providerId,
    family: "local-deterministic",
    capabilities: defaultProviderCapabilities(providerId),
    execute(envelope: JobEnvelopeV1) {
      const bootstrap = createDispatchBootstrap({
        envelope,
        gitHead: deps.startingSha,
        ...(deps.branch !== undefined ? { branch: deps.branch } : {}),
        retryBudget: Math.max(0, envelope.maxProviderAttempts - envelope.previousAttempts.length),
      });
      const bootstrapPath = join(deps.artifactRoot, `${envelope.jobId}.bootstrap.json`);
      const artifactPath = join(deps.artifactRoot, envelope.expectedArtifact);
      deps.writeFile(bootstrapPath, JSON.stringify(bootstrap, null, 2) + "\n");
      deps.writeFile(artifactPath, artifactContents(envelope, providerId));
      const written = deps.readFile(artifactPath);
      const invalid = validateJobArtifact(written, envelope, providerId);
      if (invalid !== null) {
        return { class: "MALFORMED_RESULT", leaseOutcome: "RELEASED", writerLiveness: "STOPPED", artifact: artifactPath };
      }
      const rawBootstrap = JSON.parse(deps.readFile(bootstrapPath)) as DispatchBootstrapV1;
      if (rawBootstrap.jobId !== envelope.jobId || rawBootstrap.objective !== envelope.objective) {
        return { class: "MALFORMED_RESULT", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" };
      }
      return {
        class: "SUCCESS",
        modelId: `${providerId}-bounded-local`,
        artifact: artifactPath,
        endingSha: deps.startingSha,
        leaseOutcome: "RELEASED",
        writerLiveness: "STOPPED",
        externalEffectState: "NONE",
        costUsd: 0,
      };
    },
  };
}

export function createQuotaExhaustedAdapter(providerId: ProviderIdV1): ProviderAdapterV1 {
  return {
    providerId,
    family: providerId,
    capabilities: defaultProviderCapabilities(providerId),
    execute() {
      return { class: "QUOTA_EXHAUSTED", leaseOutcome: "RELEASED", writerLiveness: "STOPPED", externalEffectState: "NONE" };
    },
  };
}

export function createRateLimitedAdapter(providerId: ProviderIdV1): ProviderAdapterV1 {
  return {
    providerId,
    family: providerId,
    capabilities: defaultProviderCapabilities(providerId),
    execute() {
      return { class: "RATE_LIMITED", leaseOutcome: "RELEASED", writerLiveness: "STOPPED", externalEffectState: "NONE" };
    },
  };
}

export function serializeJobRecord(record: JobRecordV1): string {
  return JSON.stringify({ schema: MVA_DISPATCH_SCHEMA_V1, record }, null, 2);
}

export function parseJobRecord(raw: string): JobRecordV1 {
  const parsed = JSON.parse(raw) as { record?: JobRecordV1 };
  if (parsed === null || typeof parsed !== "object" || parsed.record === undefined) {
    throw new Error("job record is malformed");
  }
  return parsed.record;
}

export function jobRecordPath(root: string, jobId: string): string {
  return join(root, "jobs", `${jobId}.json`);
}

export function createMemoryJobStore(seed: readonly JobRecordV1[] = []): JobStoreV1 {
  const map = new Map<string, JobRecordV1>(seed.map((row) => [row.jobId, row]));
  return {
    save(record) {
      map.set(record.jobId, record);
    },
    load(jobId) {
      return map.get(jobId) ?? null;
    },
  };
}

export function createFileJobStore(root: string): JobStoreV1 {
  return {
    save(record) {
      writeAtomic(jobRecordPath(root, record.jobId), serializeJobRecord(record));
    },
    load(jobId) {
      try {
        return parseJobRecord(readFileSync(jobRecordPath(root, jobId), "utf8"));
      } catch {
        return null;
      }
    },
  };
}

function emptyHealth(now: string): Record<ProviderIdV1, ProviderHealthV1> {
  return {
    codex: defaultProviderHealth("codex", now),
    grok: defaultProviderHealth("grok", now),
    claude: defaultProviderHealth("claude", now),
    local: defaultProviderHealth("local", now),
  };
}

function stoppedWriter(): WriterStateV1 {
  return { holder: null, liveness: "STOPPED", leaseReleased: true };
}

function newRecord(request: JobRequestV1, now: string): JobRecordV1 {
  return {
    schema: MVA_DISPATCH_SCHEMA_V1,
    jobId: request.jobId,
    milestoneId: MVA_MILESTONE_ID,
    objective: request.objective,
    jobClass: request.jobClass,
    authoritySource: "OWNER_STANDING_AUTHORITY_V1",
    ownerAuthorizationId: MVA_OWNER_AUTHORIZATION_ID,
    status: "CREATED",
    repository: request.repository,
    worktree: request.worktree,
    allowedPaths: request.allowedPaths,
    startingSha: request.startingSha,
    endingSha: null,
    envelope: null,
    attempts: [],
    activeAttemptId: null,
    activeProvider: null,
    leaseId: null,
    leaseReleased: true,
    writer: stoppedWriter(),
    artifacts: [],
    verificationEvidence: [],
    externalEffectState: "NONE",
    retryBudgetRemaining: request.maxProviderAttempts ?? 4,
    failureReason: null,
    authorityDecision: null,
    ownerPrompts: 0,
    workerLaunches: 0,
    createdAt: now,
    updatedAt: now,
    health: emptyHealth(now),
    takeover: null,
    bootstrapPath: null,
  };
}

function resultOf(record: JobRecordV1, extras: Partial<JobResultContractV1> = {}): JobResultContractV1 {
  const next =
    record.status === "SUCCEEDED"
      ? "close job; no further Owner action required"
      : record.status === "DENIED"
        ? "Owner must authorize the high-consequence action before retry"
        : record.status === "RECOVERY_REQUIRED"
          ? "inspect the previous worker; do not launch a second writer"
          : "inspect the job record and remaining retry budget";
  return {
    jobId: record.jobId,
    finalState: record.status,
    selectedProvider: record.activeProvider,
    attempts: record.attempts,
    startingSha: record.startingSha,
    endingSha: record.endingSha,
    artifacts: record.artifacts,
    validationEvidence: record.verificationEvidence,
    authorityDecision: record.authorityDecision,
    spendUsd: 0,
    externalEffectState: record.externalEffectState,
    failureReason: record.failureReason,
    nextRecommendedAction: next,
    ownerPrompts: record.ownerPrompts,
    workerLaunches: record.workerLaunches,
    envelopeChanged: false,
    envelope: record.envelope,
    ...extras,
  };
}

export function persistJobTransition(
  store: JobStoreV1,
  record: JobRecordV1,
  next: JobStateV1,
  now: string,
  patch: Partial<JobRecordV1> = {},
): JobRecordV1 {
  if (record.status === next) {
    const same: JobRecordV1 = { ...record, ...patch, updatedAt: now };
    store.save(same);
    return same;
  }
  if (!legalJobTransition(record.status, next)) {
    const denied: JobRecordV1 = {
      ...record,
      failureReason: `illegal transition ${record.status} -> ${next}`,
      updatedAt: now,
    };
    store.save(denied);
    return denied;
  }
  const updated: JobRecordV1 = {
    ...record,
    ...patch,
    status: next,
    updatedAt: now,
  };
  store.save(updated);
  return updated;
}

function outcome(record: JobRecordV1, leases: readonly LeaseV1[], extras: Partial<JobResultContractV1> = {}): DispatchOutcomeV1 {
  return { record, result: resultOf(record, extras), leases };
}

function defaultWrite(path: string, contents: string): void {
  writeAtomic(path, contents);
}

function defaultRead(path: string): string {
  return readFileSync(path, "utf8");
}

function adaptersFor(
  request: JobRequestV1,
  deps: MvaDispatchDepsV1,
): Record<ProviderIdV1, ProviderAdapterV1> {
  const supplied = deps.adapters ?? {};
  const missing = PROVIDER_IDS_V1.filter((id) => supplied[id] === undefined);
  if (missing.length === 0) {
    return {
      codex: supplied.codex!,
      grok: supplied.grok!,
      claude: supplied.claude!,
      local: supplied.local!,
    };
  }
  const root = deps.artifactRoot ?? join(request.worktree, MVA_JOB_STORE_RELATIVE_PATH, "artifacts");
  const writeFile = deps.writeFile ?? defaultWrite;
  const readFile = deps.readFile ?? defaultRead;
  mkdirSync(root, { recursive: true });
  const real = (id: ProviderIdV1) =>
    createRealBoundedExecutorAdapter(id, {
      artifactRoot: root,
      writeFile,
      readFile,
      startingSha: request.startingSha,
      ...(deps.branch !== undefined ? { branch: deps.branch } : {}),
    });
  return {
    codex: supplied.codex ?? real("codex"),
    grok: supplied.grok ?? real("grok"),
    claude: supplied.claude ?? real("claude"),
    local: supplied.local ?? real("local"),
  };
}

export function submitJob(request: JobRequestV1, deps: MvaDispatchDepsV1 = {}): DispatchOutcomeV1 {
  const now = deps.now ?? "2026-08-18T00:00:00Z";
  const store = deps.store ?? createMemoryJobStore();
  const invalid = validateJobRequest(request);
  if (invalid !== null) {
    if (validatePathSegment(request.jobId).ok) {
      const created = newRecord(request, now);
      store.save(created);
      return outcome(persistJobTransition(store, created, "FAILED", now, { failureReason: invalid }), deps.existingLeases ?? []);
    }
    return {
      record: {
        ...newRecord({
          jobId: "invalid-request",
          objective: request.objective || "invalid",
          jobClass: "REPOSITORY_REVERSIBLE",
          repository: "C:\\AION-HQ-main-integrate",
          worktree: "C:\\AION-HQ-main-integrate",
          allowedPaths: ["packages/director"],
          expectedArtifact: "missing",
          startingSha: "unknown",
        }, now),
        jobId: request.jobId || "invalid-request",
        status: "FAILED",
        failureReason: invalid,
      },
      result: {
        jobId: request.jobId || "invalid-request",
        finalState: "FAILED",
        selectedProvider: null,
        attempts: [],
        startingSha: request.startingSha || "",
        endingSha: null,
        artifacts: [],
        validationEvidence: [],
        authorityDecision: null,
        spendUsd: 0,
        externalEffectState: "NONE",
        failureReason: invalid,
        nextRecommendedAction: "fix the request; no worker launched",
        ownerPrompts: 0,
        workerLaunches: 0,
        envelopeChanged: false,
        envelope: null,
      },
      leases: deps.existingLeases ?? [],
    };
  }
  const created = newRecord(request, now);
  store.save(created);
  return continueJob(request, created, deps, store, now);
}

export function recoverJob(jobId: string, request: JobRequestV1, deps: MvaDispatchDepsV1 = {}): DispatchOutcomeV1 {
  const now = deps.now ?? "2026-08-18T00:00:00Z";
  const store = deps.store ?? createMemoryJobStore();
  const loaded = store.load(jobId);
  if (loaded === null) return submitJob(request, { ...deps, store, now });
  if (TERMINAL.has(loaded.status)) return outcome(loaded, deps.existingLeases ?? []);
  const writer = deps.writer ?? loaded.writer;
  if ((loaded.status === "EXECUTING" || loaded.status === "LEASE_ACQUIRED") && writer.liveness === "UNKNOWN") {
    return outcome(persistJobTransition(store, loaded, "RECOVERY_REQUIRED", now, {
      failureReason: "previous worker state is UNKNOWN; replacement writer blocked",
      writer,
    }), deps.existingLeases ?? []);
  }
  return continueJob(request, { ...loaded, writer }, deps, store, now);
}

function capabilitiesOf(adapters: Record<ProviderIdV1, ProviderAdapterV1>) {
  return Object.fromEntries(
    PROVIDER_IDS_V1.map((id) => [id, adapters[id]?.capabilities ?? defaultProviderCapabilities(id)]),
  ) as Record<ProviderIdV1, ReturnType<typeof defaultProviderCapabilities>>;
}

function readArtifact(path: string, deps: MvaDispatchDepsV1): string {
  if (deps.readFile !== undefined) return deps.readFile(path);
  return defaultRead(path);
}

function finishSuccess(
  store: JobStoreV1,
  record: JobRecordV1,
  envelope: JobEnvelopeV1,
  executor: ProviderIdV1,
  artifactPath: string,
  deps: MvaDispatchDepsV1,
  leases: readonly LeaseV1[],
  now: string,
): DispatchOutcomeV1 {
  let next = persistJobTransition(store, record, "VALIDATING", now);
  try {
    const invalid = validateJobArtifact(readArtifact(artifactPath, deps), envelope, executor);
    if (invalid !== null) {
      return outcome(persistJobTransition(store, next, "FAILED", now, { failureReason: invalid }), leases);
    }
  } catch (error) {
    return outcome(persistJobTransition(store, next, "FAILED", now, {
      failureReason: error instanceof Error ? error.message : "artifact missing",
    }), leases);
  }
  const evidence = [...next.verificationEvidence, "artifact-validated", artifactPath];
  next = persistJobTransition(store, next, "SUCCEEDED", now, {
    verificationEvidence: evidence,
    artifacts: next.artifacts.includes(artifactPath) ? next.artifacts : [...next.artifacts, artifactPath],
    failureReason: null,
  });
  return outcome(next, leases);
}

function continueJob(
  request: JobRequestV1,
  start: JobRecordV1,
  deps: MvaDispatchDepsV1,
  store: JobStoreV1,
  now: string,
): DispatchOutcomeV1 {
  let record = start;
  let leases = [...(deps.existingLeases ?? [])];
  const decide = deps.decideAuthority ?? defaultMvaAuthority;
  const highConsequence =
    request.jobClass === "PRODUCTION_EXTERNAL_WRITE"
    || (request.externalEffects ?? []).some((effect) => effect === "PRODUCTION" || effect === "WRITER" || effect === "CUSTOMER_COMMUNICATION");

  if (record.status === "CREATED") {
    const auth = decide({
      actionKind: highConsequence ? "PRODUCTION_WRITER" : "SOURCE_EDIT",
      spendUsd: request.spendCapUsd ?? 0,
      productionWriter: highConsequence ? "YES" : "NO",
    });
    if (auth.outcome !== "ALLOW_STANDING") {
      return outcome(persistJobTransition(store, record, "DENIED", now, {
        authorityDecision: auth.outcome,
        ownerPrompts: record.ownerPrompts + 1,
        failureReason: auth.reason,
        workerLaunches: 0,
      }), leases);
    }
    record = persistJobTransition(store, record, "AUTHORIZED", now, {
      authorityDecision: auth.outcome,
      envelope: buildJobEnvelope(request, now),
    });
  }

  if (record.envelope === null) {
    record = { ...record, envelope: buildJobEnvelope(request, now), updatedAt: now };
    store.save(record);
  }
  if (record.envelope === null) {
    return outcome({ ...record, status: "FAILED", failureReason: "job envelope missing" }, leases);
  }
  const envelope = freezeJobEnvelope(record.envelope);
  const lastAttempt = record.attempts[record.attempts.length - 1];
  if (record.status === "EXECUTING" && lastAttempt?.result === "SUCCESS" && lastAttempt.artifact) {
    return finishSuccess(store, record, envelope, lastAttempt.providerId, lastAttempt.artifact, deps, leases, now);
  }
  if (record.status === "VALIDATING" && lastAttempt?.result === "SUCCESS" && lastAttempt.artifact) {
    return finishSuccess(store, record, envelope, lastAttempt.providerId, lastAttempt.artifact, deps, leases, now);
  }

  const writer = deps.writer ?? record.writer;
  if (writer.liveness === "UNKNOWN") {
    const from = record.status === "AUTHORIZED" || record.status === "ROUTING" || record.status === "FAILOVER_PENDING"
      ? persistJobTransition(store, record.status === "AUTHORIZED" ? persistJobTransition(store, record, "ROUTING", now) : record, "LEASE_ACQUIRED", now)
      : record;
    const blockedFrom = from.status === "LEASE_ACQUIRED" || from.status === "EXECUTING" ? from : record;
    if (legalJobTransition(blockedFrom.status, "RECOVERY_REQUIRED")) {
      return outcome(persistJobTransition(store, blockedFrom, "RECOVERY_REQUIRED", now, {
        failureReason: "previous writer state is UNKNOWN",
        writer,
      }), leases);
    }
    const forced: JobRecordV1 = {
      ...blockedFrom,
      status: "RECOVERY_REQUIRED",
      failureReason: "previous writer state is UNKNOWN",
      writer,
      updatedAt: now,
    };
    store.save(forced);
    return outcome(forced, leases);
  }

  if (writer.liveness === "LIVE" && writer.holder !== null) {
    const from = record.status === "ROUTING" || record.status === "AUTHORIZED"
      ? persistJobTransition(store, record.status === "AUTHORIZED" ? persistJobTransition(store, record, "ROUTING", now) : record, "LEASE_ACQUIRED", now)
      : record;
    return outcome(persistJobTransition(store, from.status === "LEASE_ACQUIRED" ? from : persistJobTransition(store, {
      ...record,
      status: record.status === "CREATED" ? "AUTHORIZED" : record.status,
    }, "FAILED", now), "FAILED", now, {
      failureReason: "simultaneous writers prevented",
      writer,
    }), leases);
  }

  if (record.status === "AUTHORIZED") {
    record = persistJobTransition(store, record, "ROUTING", now, { envelope });
  }
  if (record.status === "FAILOVER_PENDING") {
    record = persistJobTransition(store, record, "ROUTING", now);
  }

  const adapters = adaptersFor(request, deps);
  const health = { ...(deps.health ?? record.health) } as Record<ProviderIdV1, ProviderHealthV1>;
  const routed = routeJob(envelope, health, capabilitiesOf(adapters), deps.overrides ?? {}, now);
  if (routed.selected === null) {
    const from = record.status === "ROUTING" ? record : persistJobTransition(store, record, "ROUTING", now);
    return outcome(persistJobTransition(store, from, "NO_ELIGIBLE_PROVIDER", now, {
      failureReason: "NO_ELIGIBLE_PROVIDER",
      health,
    }), leases);
  }

  const acquired = acquireLease({
    existing: leases,
    leaseId: envelope.leaseId,
    kind: "WORKTREE",
    resource: envelope.worktree,
    missionId: envelope.milestoneId,
    runId: `${envelope.jobId}:dispatch`,
    now,
  });
  if (!acquired.ok || acquired.lease === null) {
    const from = record.status === "ROUTING" ? record : persistJobTransition(store, record, "ROUTING", now);
    return outcome(persistJobTransition(store, from, "FAILED", now, { failureReason: acquired.reason }), leases);
  }
  leases = [...leases.filter((row) => row.leaseId !== acquired.lease!.leaseId), acquired.lease];
  if (record.status === "ROUTING") {
    record = persistJobTransition(store, record, "LEASE_ACQUIRED", now, {
      leaseId: acquired.lease.leaseId,
      leaseReleased: false,
      activeProvider: routed.selected,
    });
  } else if (record.status === "LEASE_ACQUIRED") {
    record = { ...record, leaseId: acquired.lease.leaseId, leaseReleased: false, activeProvider: routed.selected, updatedAt: now };
    store.save(record);
  }
  record = persistJobTransition(store, record, "EXECUTING", now, {
    writer: { holder: routed.selected, liveness: "LIVE", leaseReleased: false },
  });

  const before = freezeJobEnvelope(envelope);
  const executed = executeWithFailover(envelope, {
    adapters,
    health,
    ...(deps.overrides !== undefined ? { overrides: deps.overrides } : {}),
    writer: stoppedWriter(),
    decideAuthority: decide,
    now,
    startingSha: request.startingSha,
  });
  leases = releaseLease(leases, { kind: "WORKTREE", resource: envelope.worktree, runId: `${envelope.jobId}:dispatch` });
  const last = executed.ledger[executed.ledger.length - 1] ?? null;
  const effectWorkers = executed.ledger.filter((row) => row.result === "SUCCESS" && row.artifact !== null).length;
  record = {
    ...record,
    attempts: executed.ledger,
    activeAttemptId: last?.attemptId ?? null,
    activeProvider: last?.providerId ?? routed.selected,
    health: executed.health,
    takeover: executed.takeover,
    ownerPrompts: record.ownerPrompts + executed.ownerPrompts,
    workerLaunches: record.workerLaunches + effectWorkers,
    endingSha: last?.endingSha ?? record.endingSha,
    artifacts: executed.ledger.flatMap((row) => (row.artifact !== null ? [row.artifact] : [])),
    externalEffectState: last?.externalEffectState ?? "NONE",
    retryBudgetRemaining: Math.max(0, envelope.maxProviderAttempts - executed.ledger.length),
    leaseReleased: true,
    writer: {
      holder: last?.providerId ?? routed.selected,
      liveness: executed.finalClass === "WORKER_STATE_UNKNOWN" ? "UNKNOWN" : "STOPPED",
      leaseReleased: executed.finalClass !== "WORKER_STATE_UNKNOWN",
    },
    updatedAt: now,
  };
  store.save(record);

  if (envelopesEqual(before, executed.envelope) === false) {
    return outcome(persistJobTransition(store, record, "FAILED", now, {
      failureReason: "job envelope changed during execution",
    }), leases, { envelopeChanged: true, envelope: executed.envelope });
  }
  if (executed.selectedTrail.length > 1 && executed.finalClass === "SUCCESS") {
    record = persistJobTransition(store, record, "FAILOVER_PENDING", now, { failureReason: null });
    record = persistJobTransition(store, record, "ROUTING", now);
    record = persistJobTransition(store, record, "LEASE_ACQUIRED", now);
    record = persistJobTransition(store, record, "EXECUTING", now);
  }
  if (executed.finalClass === "WORKER_STATE_UNKNOWN") {
    return outcome(persistJobTransition(store, record, "RECOVERY_REQUIRED", now, {
      failureReason: "worker state UNKNOWN after attempt",
    }), leases);
  }
  if (executed.finalClass === "AMBIGUOUS_EXTERNAL_EFFECT") {
    return outcome(persistJobTransition(store, record, "AMBIGUOUS_EFFECT_BLOCKED", now, {
      failureReason: "ambiguous external effect blocks automatic retry",
    }), leases);
  }
  if (executed.finalClass === "POLICY_DENIED") {
    return outcome(persistJobTransition(store, record, "DENIED", now, { failureReason: "policy denied" }), leases);
  }
  if (executed.finalClass === "NO_ELIGIBLE_PROVIDER") {
    return outcome(persistJobTransition(store, record, "NO_ELIGIBLE_PROVIDER", now, {
      failureReason: "NO_ELIGIBLE_PROVIDER",
    }), leases);
  }
  if (executed.finalClass === "SUCCESS" && last?.artifact) {
    return finishSuccess(store, record, envelope, last.providerId, last.artifact, deps, leases, now);
  }
  if (executed.finalClass === "SUCCESS") {
    record = persistJobTransition(store, record, "VALIDATING", now);
    return outcome(persistJobTransition(store, record, "FAILED", now, { failureReason: "missing artifact" }), leases);
  }
  return outcome(persistJobTransition(store, record, "FAILED", now, { failureReason: executed.finalClass }), leases);
}

export function loadJobRecord(raw: string): JobRecordV1 {
  return parseJobRecord(raw);
}

export function persistHealthAndLedger(health: Readonly<Record<ProviderIdV1, ProviderHealthV1>>, attempts: readonly AttemptRecordV1[]): {
  readonly healthText: string;
  readonly ledgerText: string;
} {
  return {
    healthText: serializeProviderHealth(health),
    ledgerText: serializeAttemptLedger(attempts),
  };
}

export function reloadPersistedHealth(raw: string, now: string): Record<ProviderIdV1, ProviderHealthV1> {
  const parsed = parseProviderHealth(raw);
  const recovered = { ...parsed };
  for (const id of PROVIDER_IDS_V1) {
    const row = recovered[id];
    if (row !== undefined && row.circuitState === "OPEN" && row.backoffUntil !== null && Date.parse(now) >= Date.parse(row.backoffUntil)) {
      recovered[id] = recoverCircuit(row, now);
    }
  }
  return recovered;
}
