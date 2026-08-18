/**
 * Quota-aware provider/model bridge V1.
 *
 * Director hands a frozen job envelope to a deterministic router. Adapters
 * hide transport. Failover never broadens the envelope, never treats UNKNOWN
 * as available, and never launches a second writer while the previous one is
 * live or unproven-stopped.
 */
export const PROVIDER_BRIDGE_SCHEMA_V1 = "aion.director.providerBridge.v1" as const;

export const PROVIDER_IDS_V1 = ["codex", "grok", "claude", "local"] as const;
export type ProviderIdV1 = (typeof PROVIDER_IDS_V1)[number];

export type ProviderAvailabilityV1 =
  | "AVAILABLE"
  | "RATE_LIMITED"
  | "QUOTA_EXHAUSTED"
  | "AUTH_FAILURE"
  | "TRANSIENT_FAILURE"
  | "CIRCUIT_OPEN"
  | "DISABLED"
  | "UNKNOWN"
  | "UNHEALTHY";

export type FailureClassV1 =
  | "SUCCESS"
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMITED"
  | "AUTH_FAILURE"
  | "TRANSIENT_PROVIDER_FAILURE"
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "CANCELLED"
  | "WORKER_STATE_UNKNOWN"
  | "LEASE_RELEASE_FAILURE"
  | "AMBIGUOUS_EXTERNAL_EFFECT"
  | "JOB_FAILURE"
  | "POLICY_DENIED"
  | "NO_ELIGIBLE_PROVIDER"
  | "MALFORMED_RESULT";

export type EffectSafetyClassV1 =
  | "READ_ONLY"
  | "REPOSITORY_REVERSIBLE"
  | "IDEMPOTENT_EXTERNAL"
  | "IRREVERSIBLE_EXTERNAL"
  | "AMBIGUOUS_EXTERNAL";

export type CostPolicyV1 = "NO_INCREMENTAL_COST" | "METERED" | "UNKNOWN_COST";
export type SensitivityClassV1 = "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
export type WriterLivenessV1 = "STOPPED" | "LIVE" | "UNKNOWN";
export type AuthorityOutcomeV1 = "ALLOW_STANDING" | "REQUIRE_FRESH_OWNER_APPROVAL" | "DENY";
export type RequiredCapabilityV1 =
  | "CODING"
  | "REASONING_REVIEW"
  | "LOCAL_OFFLINE"
  | "WORKTREE"
  | "WRITE"
  | "READ_ONLY_REVIEW";

export interface JobEnvelopeV1 {
  readonly jobId: string;
  readonly milestoneId: string;
  readonly objective: string;
  readonly authoritySource: string;
  readonly ownerAuthorizationId: string;
  readonly repository: string;
  readonly worktree: string;
  readonly allowedPaths: readonly string[];
  readonly allowedComponents: readonly string[];
  readonly writePermission: boolean;
  readonly externalEffects: readonly string[];
  readonly sensitiveDataClass: SensitivityClassV1;
  readonly sensitiveDataAllowedProviders: readonly ProviderIdV1[];
  readonly spendCapUsd: number;
  readonly remainingSpendUsd: number;
  readonly providerCostCapUsd: number;
  readonly tokenOrUsageCap: number | null;
  readonly timeLimitMs: number;
  readonly retryLimit: number;
  readonly maxProviderAttempts: number;
  readonly expectedArtifact: string;
  readonly expectedResult: string;
  readonly leaseId: string;
  readonly idempotencyKey: string;
  readonly effectSafetyClass: EffectSafetyClassV1;
  readonly preferredProvider: ProviderIdV1 | null;
  readonly preferredModel: string | null;
  readonly requiredCapabilities: readonly RequiredCapabilityV1[];
  readonly previousAttempts: readonly string[];
  readonly createdAt: string;
}

export interface ProviderCapabilitiesV1 {
  readonly coding: boolean;
  readonly reasoningReview: boolean;
  readonly localOffline: boolean;
  readonly worktree: boolean;
  readonly write: boolean;
  readonly readOnlyReview: boolean;
  readonly durableResume: boolean;
  readonly costPolicy: CostPolicyV1;
  readonly sensitivityEligibility: readonly SensitivityClassV1[];
  readonly costClass: number;
}

export interface ProviderHealthV1 {
  readonly providerId: ProviderIdV1;
  readonly state: ProviderAvailabilityV1;
  readonly observedAt: string;
  readonly retryAfter: string | null;
  readonly resetAt: string | null;
  readonly backoffUntil: string | null;
  readonly consecutiveFailures: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastFailureClass: FailureClassV1 | null;
  readonly circuitState: "CLOSED" | "OPEN";
  readonly manuallyDisabled: boolean;
}

export interface OwnerProviderOverridesV1 {
  readonly disabledProviders?: readonly ProviderIdV1[];
  readonly preferredProvider?: ProviderIdV1;
  readonly localOnly?: boolean;
  readonly cloudDisabled?: boolean;
  readonly readOnlyProvidersOnly?: boolean;
}

export interface ProviderExecuteResultV1 {
  readonly class: FailureClassV1;
  readonly modelId?: string;
  readonly usage?: number;
  readonly costUsd?: number;
  readonly artifact?: string;
  readonly endingSha?: string;
  readonly leaseOutcome?: "RELEASED" | "RETAINED" | "UNKNOWN";
  readonly externalEffectState?: "NONE" | "COMMITTED" | "UNCERTAIN";
  readonly writerLiveness?: WriterLivenessV1;
}

export interface ProviderAdapterV1 {
  readonly providerId: ProviderIdV1;
  readonly family: string;
  readonly capabilities: ProviderCapabilitiesV1;
  execute(envelope: JobEnvelopeV1): ProviderExecuteResultV1;
  cancel?(attemptId: string): void;
  probeHealth?(): ProviderAvailabilityV1;
  classifyFailure?(result: ProviderExecuteResultV1): FailureClassV1;
}

export interface WriterStateV1 {
  readonly holder: ProviderIdV1 | null;
  readonly liveness: WriterLivenessV1;
  readonly leaseReleased: boolean;
}

export interface AttemptRecordV1 {
  readonly jobId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly providerId: ProviderIdV1;
  readonly modelId: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly authorityDecision: AuthorityOutcomeV1;
  readonly availabilityBefore: ProviderAvailabilityV1;
  readonly result: FailureClassV1;
  readonly failureClass: FailureClassV1;
  readonly usage: number | null;
  readonly cost: number | null;
  readonly worktree: string;
  readonly startingSha: string | null;
  readonly endingSha: string | null;
  readonly artifact: string | null;
  readonly leaseOutcome: string;
  readonly externalEffectState: string;
  readonly nextRoutingDecision: string;
}

export interface TakeoverPayloadV1 {
  readonly schema: typeof PROVIDER_BRIDGE_SCHEMA_V1;
  readonly jobEnvelope: JobEnvelopeV1;
  readonly authoritySource: string;
  readonly milestoneId: string;
  readonly repository: string;
  readonly worktree: string;
  readonly gitHead: string | null;
  readonly branch: string | null;
  readonly currentDirective: string | null;
  readonly agentsPath: string;
  readonly latestHandoffPath: string | null;
  readonly previousAttempt: AttemptRecordV1 | null;
  readonly failureClass: FailureClassV1;
  readonly filesChanged: readonly string[];
  readonly testsAlreadyRun: readonly string[];
  readonly pendingTests: readonly string[];
  readonly expectedArtifact: string;
  readonly leaseState: WriterStateV1;
  readonly retryBudgetRemaining: number;
}

export interface RouteDecisionV1 {
  readonly selected: ProviderIdV1 | null;
  readonly reason: string;
  readonly ineligible: Readonly<Record<ProviderIdV1, string>>;
}

export interface FailoverResultV1 {
  readonly finalClass: FailureClassV1;
  readonly selectedTrail: readonly ProviderIdV1[];
  readonly ledger: readonly AttemptRecordV1[];
  readonly health: Readonly<Record<ProviderIdV1, ProviderHealthV1>>;
  readonly envelope: JobEnvelopeV1;
  readonly envelopeChanged: boolean;
  readonly simultaneousWriters: number;
  readonly ownerPrompts: number;
  readonly takeover: TakeoverPayloadV1 | null;
}

export interface AuthorityRequestV1 {
  readonly actionKind: string;
  readonly spendUsd: number;
  readonly productionWriter: "YES" | "NO";
}

const DEFAULT_CODING_ORDER: readonly ProviderIdV1[] = ["codex", "grok", "claude", "local"];
const CLOUD_PROVIDERS: readonly ProviderIdV1[] = ["codex", "grok", "claude"];
const CIRCUIT_THRESHOLD = 3;

const DEFAULT_CAPABILITIES: Record<ProviderIdV1, ProviderCapabilitiesV1> = {
  codex: {
    coding: true, reasoningReview: true, localOffline: false, worktree: true,
    write: true, readOnlyReview: false, durableResume: true,
    costPolicy: "NO_INCREMENTAL_COST", sensitivityEligibility: ["PUBLIC", "INTERNAL"],
    costClass: 2,
  },
  grok: {
    coding: true, reasoningReview: true, localOffline: false, worktree: true,
    write: true, readOnlyReview: false, durableResume: true,
    costPolicy: "NO_INCREMENTAL_COST", sensitivityEligibility: ["PUBLIC", "INTERNAL"],
    costClass: 2,
  },
  claude: {
    coding: true, reasoningReview: true, localOffline: false, worktree: true,
    write: true, readOnlyReview: true, durableResume: true,
    costPolicy: "NO_INCREMENTAL_COST", sensitivityEligibility: ["PUBLIC", "INTERNAL", "CONFIDENTIAL"],
    costClass: 3,
  },
  local: {
    coding: true, reasoningReview: false, localOffline: true, worktree: true,
    write: true, readOnlyReview: false, durableResume: true,
    costPolicy: "NO_INCREMENTAL_COST", sensitivityEligibility: ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"],
    costClass: 0,
  },
};

export function defaultProviderCapabilities(id: ProviderIdV1): ProviderCapabilitiesV1 {
  return DEFAULT_CAPABILITIES[id];
}

export function defaultProviderHealth(id: ProviderIdV1, now = "2026-08-18T00:00:00Z"): ProviderHealthV1 {
  return {
    providerId: id,
    state: "AVAILABLE",
    observedAt: now,
    retryAfter: null,
    resetAt: null,
    backoffUntil: null,
    consecutiveFailures: 0,
    successCount: 0,
    failureCount: 0,
    lastFailureClass: null,
    circuitState: "CLOSED",
    manuallyDisabled: false,
  };
}

export function freezeJobEnvelope(envelope: JobEnvelopeV1): JobEnvelopeV1 {
  return Object.freeze({
    ...envelope,
    allowedPaths: Object.freeze([...envelope.allowedPaths]),
    allowedComponents: Object.freeze([...envelope.allowedComponents]),
    externalEffects: Object.freeze([...envelope.externalEffects]),
    sensitiveDataAllowedProviders: Object.freeze([...envelope.sensitiveDataAllowedProviders]),
    requiredCapabilities: Object.freeze([...envelope.requiredCapabilities]),
    previousAttempts: Object.freeze([...envelope.previousAttempts]),
  });
}

export function envelopesEqual(left: JobEnvelopeV1, right: JobEnvelopeV1): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function classifyFailure(result: ProviderExecuteResultV1 | null | undefined): FailureClassV1 {
  if (result === null || result === undefined || typeof result !== "object") return "MALFORMED_RESULT";
  const known: readonly FailureClassV1[] = [
    "SUCCESS", "QUOTA_EXHAUSTED", "RATE_LIMITED", "AUTH_FAILURE", "TRANSIENT_PROVIDER_FAILURE",
    "PROVIDER_UNAVAILABLE", "TIMEOUT", "CANCELLED", "WORKER_STATE_UNKNOWN", "LEASE_RELEASE_FAILURE",
    "AMBIGUOUS_EXTERNAL_EFFECT", "JOB_FAILURE", "POLICY_DENIED", "NO_ELIGIBLE_PROVIDER", "MALFORMED_RESULT",
  ];
  if (!known.includes(result.class)) return "MALFORMED_RESULT";
  return result.class;
}

function availabilityBlocksSelection(state: ProviderAvailabilityV1): string | null {
  if (state === "AVAILABLE" || state === "TRANSIENT_FAILURE") return null;
  if (state === "UNKNOWN") return "UNKNOWN is not treated as AVAILABLE";
  return `provider state is ${state}`;
}

function meetsCapabilities(caps: ProviderCapabilitiesV1, required: readonly RequiredCapabilityV1[], write: boolean): string | null {
  for (const need of required) {
    if (need === "CODING" && !caps.coding) return "lacks coding capability";
    if (need === "REASONING_REVIEW" && !caps.reasoningReview) return "lacks reasoning/review capability";
    if (need === "LOCAL_OFFLINE" && !caps.localOffline) return "lacks local/offline capability";
    if (need === "WORKTREE" && !caps.worktree) return "lacks worktree support";
    if (need === "WRITE" && !caps.write) return "lacks write capability";
    if (need === "READ_ONLY_REVIEW" && !caps.readOnlyReview) return "lacks read-only review capability";
  }
  if (write && !caps.write) return "read-only provider cannot receive writer job";
  return null;
}

function sensitivityRank(value: SensitivityClassV1): number {
  return { PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 }[value];
}

export function routeJob(
  envelope: JobEnvelopeV1,
  health: Readonly<Record<ProviderIdV1, ProviderHealthV1>>,
  capabilities: Readonly<Partial<Record<ProviderIdV1, ProviderCapabilitiesV1>>> = {},
  overrides: OwnerProviderOverridesV1 = {},
  nowIso = "2026-08-18T00:00:00Z",
): RouteDecisionV1 {
  const ineligible = {} as Record<ProviderIdV1, string>;
  const eligible: ProviderIdV1[] = [];
  const now = Date.parse(nowIso);

  for (const id of PROVIDER_IDS_V1) {
    const row = health[id];
    if (row === undefined) {
      ineligible[id] = "missing provider state fails closed";
      continue;
    }
    const caps = capabilities[id] ?? defaultProviderCapabilities(id);
    if (overrides.disabledProviders?.includes(id) || row.manuallyDisabled) {
      ineligible[id] = "Owner disabled provider";
      continue;
    }
    if (overrides.localOnly && id !== "local") {
      ineligible[id] = "Owner local-only override";
      continue;
    }
    if (overrides.cloudDisabled && CLOUD_PROVIDERS.includes(id)) {
      ineligible[id] = "Owner cloud-disabled override";
      continue;
    }
    if (overrides.readOnlyProvidersOnly && envelope.writePermission) {
      ineligible[id] = "Owner read-only-provider-only override";
      continue;
    }
    let state = row.state;
    if (row.circuitState === "OPEN") {
      const until = row.backoffUntil ? Date.parse(row.backoffUntil) : NaN;
      if (!Number.isFinite(until) || now < until) {
        ineligible[id] = "circuit is open";
        continue;
      }
      state = recoverCircuit(row, nowIso).state;
    }
    const blocked = availabilityBlocksSelection(state);
    if (blocked !== null) {
      ineligible[id] = blocked;
      continue;
    }
    const capFail = meetsCapabilities(caps, envelope.requiredCapabilities, envelope.writePermission);
    if (capFail !== null) {
      ineligible[id] = capFail;
      continue;
    }
    if (sensitivityRank(envelope.sensitiveDataClass) > 0) {
      if (!envelope.sensitiveDataAllowedProviders.includes(id)) {
        ineligible[id] = "not eligible for job sensitive-data class";
        continue;
      }
      if (!caps.sensitivityEligibility.includes(envelope.sensitiveDataClass)) {
        ineligible[id] = "provider sensitivity eligibility too low";
        continue;
      }
    }
    if (envelope.remainingSpendUsd <= 0 || envelope.spendCapUsd <= 0) {
      if (caps.costPolicy === "METERED") {
        ineligible[id] = "zero-spend envelope rejects incremental paid provider";
        continue;
      }
      if (caps.costPolicy === "UNKNOWN_COST") {
        ineligible[id] = "unknown provider cost rejected when spend matters";
        continue;
      }
    }
    eligible.push(id);
  }

  if (eligible.length === 0) {
    return { selected: null, reason: "NO_ELIGIBLE_PROVIDER", ineligible };
  }

  const localSufficient = envelope.requiredCapabilities.includes("LOCAL_OFFLINE")
    && !envelope.requiredCapabilities.includes("REASONING_REVIEW");
  let order: ProviderIdV1[] = localSufficient
    ? ["local", ...DEFAULT_CODING_ORDER.filter((id) => id !== "local")]
    : [...DEFAULT_CODING_ORDER];
  const preferred = overrides.preferredProvider ?? envelope.preferredProvider;
  if (preferred !== null && preferred !== undefined && eligible.includes(preferred)) {
    order = [preferred, ...order.filter((id) => id !== preferred)];
  }
  const chosen = order.find((id) => eligible.includes(id)) ?? eligible[0]!;
  return { selected: chosen, reason: `selected ${chosen}`, ineligible };
}

function healthAfterResult(row: ProviderHealthV1, result: FailureClassV1, now: string): ProviderHealthV1 {
  if (result === "SUCCESS") {
    return {
      ...row,
      state: "AVAILABLE",
      observedAt: now,
      consecutiveFailures: 0,
      successCount: row.successCount + 1,
      lastFailureClass: null,
      circuitState: "CLOSED",
      backoffUntil: null,
    };
  }
  const mapped: Partial<Record<FailureClassV1, ProviderAvailabilityV1>> = {
    QUOTA_EXHAUSTED: "QUOTA_EXHAUSTED",
    RATE_LIMITED: "RATE_LIMITED",
    AUTH_FAILURE: "AUTH_FAILURE",
    TRANSIENT_PROVIDER_FAILURE: "TRANSIENT_FAILURE",
    PROVIDER_UNAVAILABLE: "UNHEALTHY",
    TIMEOUT: "TRANSIENT_FAILURE",
  };
  const consecutive = row.consecutiveFailures + 1;
  const open = consecutive >= CIRCUIT_THRESHOLD;
  return {
    ...row,
    state: open ? "CIRCUIT_OPEN" : (mapped[result] ?? "UNHEALTHY"),
    observedAt: now,
    consecutiveFailures: consecutive,
    failureCount: row.failureCount + 1,
    lastFailureClass: result,
    circuitState: open ? "OPEN" : "CLOSED",
    backoffUntil: open ? "2099-01-01T00:00:00Z" : row.backoffUntil,
  };
}

export function recoverCircuit(row: ProviderHealthV1, now: string): ProviderHealthV1 {
  return {
    ...row,
    state: "AVAILABLE",
    observedAt: now,
    consecutiveFailures: 0,
    circuitState: "CLOSED",
    backoffUntil: null,
  };
}

export function createTakeoverPayload(input: {
  readonly envelope: JobEnvelopeV1;
  readonly previous: AttemptRecordV1 | null;
  readonly failureClass: FailureClassV1;
  readonly writer: WriterStateV1;
  readonly retryBudgetRemaining: number;
  readonly gitHead?: string | null;
  readonly branch?: string | null;
  readonly currentDirective?: string | null;
  readonly latestHandoffPath?: string | null;
  readonly filesChanged?: readonly string[];
  readonly testsAlreadyRun?: readonly string[];
  readonly pendingTests?: readonly string[];
}): TakeoverPayloadV1 {
  return {
    schema: PROVIDER_BRIDGE_SCHEMA_V1,
    jobEnvelope: input.envelope,
    authoritySource: input.envelope.authoritySource,
    milestoneId: input.envelope.milestoneId,
    repository: input.envelope.repository,
    worktree: input.envelope.worktree,
    gitHead: input.gitHead ?? null,
    branch: input.branch ?? null,
    currentDirective: input.currentDirective ?? null,
    agentsPath: "AGENTS.md",
    latestHandoffPath: input.latestHandoffPath ?? null,
    previousAttempt: input.previous,
    failureClass: input.failureClass,
    filesChanged: input.filesChanged ?? [],
    testsAlreadyRun: input.testsAlreadyRun ?? [],
    pendingTests: input.pendingTests ?? [],
    expectedArtifact: input.envelope.expectedArtifact,
    leaseState: input.writer,
    retryBudgetRemaining: input.retryBudgetRemaining,
  };
}

export interface ExecuteWithFailoverDepsV1 {
  readonly adapters: Readonly<Record<ProviderIdV1, ProviderAdapterV1>>;
  readonly health: Readonly<Record<ProviderIdV1, ProviderHealthV1>>;
  readonly overrides?: OwnerProviderOverridesV1;
  readonly writer: WriterStateV1;
  readonly decideAuthority: (request: AuthorityRequestV1) => { outcome: AuthorityOutcomeV1; reason: string };
  readonly now?: string;
  readonly startingSha?: string | null;
}

const FAILOVER_CLASSES: readonly FailureClassV1[] = [
  "QUOTA_EXHAUSTED", "RATE_LIMITED", "TRANSIENT_PROVIDER_FAILURE", "PROVIDER_UNAVAILABLE", "TIMEOUT",
];

export function executeWithFailover(
  rawEnvelope: JobEnvelopeV1,
  deps: ExecuteWithFailoverDepsV1,
): FailoverResultV1 {
  const envelope = freezeJobEnvelope(rawEnvelope);
  const health = { ...deps.health } as Record<ProviderIdV1, ProviderHealthV1>;
  const ledger: AttemptRecordV1[] = [];
  const trail: ProviderIdV1[] = [];
  let writer = deps.writer;
  let simultaneous = 0;
  let ownerPrompts = 0;
  let takeover: TakeoverPayloadV1 | null = null;
  const now = deps.now ?? "2026-08-18T00:00:00Z";
  const budget = Math.max(0, envelope.maxProviderAttempts);

  const production = envelope.externalEffects.includes("PRODUCTION") || envelope.externalEffects.includes("WRITER");
  if (production) {
    const auth = deps.decideAuthority({ actionKind: "PRODUCTION_WRITER", spendUsd: 0, productionWriter: "YES" });
    if (auth.outcome !== "ALLOW_STANDING") {
      ownerPrompts += 1;
      return {
        finalClass: "POLICY_DENIED",
        selectedTrail: trail,
        ledger,
        health,
        envelope,
        envelopeChanged: false,
        simultaneousWriters: 0,
        ownerPrompts,
        takeover: null,
      };
    }
  }
  if (envelope.spendCapUsd > 0 && envelope.remainingSpendUsd < 0) {
    const auth = deps.decideAuthority({ actionKind: "SPEND", spendUsd: envelope.spendCapUsd, productionWriter: "NO" });
    if (auth.outcome !== "ALLOW_STANDING") {
      ownerPrompts += 1;
      return {
        finalClass: "POLICY_DENIED", selectedTrail: trail, ledger, health, envelope,
        envelopeChanged: false, simultaneousWriters: 0, ownerPrompts, takeover: null,
      };
    }
  }

  for (let attempt = 1; attempt <= budget; attempt += 1) {
    if (envelope.writePermission && writer.liveness === "UNKNOWN") {
      return {
        finalClass: "WORKER_STATE_UNKNOWN", selectedTrail: trail, ledger, health, envelope,
        envelopeChanged: false, simultaneousWriters: simultaneous, ownerPrompts, takeover,
      };
    }
    const routed = routeJob(envelope, health, Object.fromEntries(
      PROVIDER_IDS_V1.map((id) => [id, deps.adapters[id]?.capabilities ?? defaultProviderCapabilities(id)]),
    ) as Record<ProviderIdV1, ProviderCapabilitiesV1>, deps.overrides ?? {}, now);
    if (routed.selected === null) {
      return {
        finalClass: "NO_ELIGIBLE_PROVIDER", selectedTrail: trail, ledger, health, envelope,
        envelopeChanged: false, simultaneousWriters: simultaneous, ownerPrompts, takeover,
      };
    }
    const provider = routed.selected;
    if (envelope.writePermission && writer.liveness === "LIVE" && writer.holder !== null && writer.holder !== provider) {
      simultaneous += 1;
      return {
        finalClass: "POLICY_DENIED", selectedTrail: trail, ledger, health, envelope,
        envelopeChanged: false, simultaneousWriters: simultaneous, ownerPrompts, takeover,
      };
    }
    const last = ledger[ledger.length - 1];
    if (
      envelope.effectSafetyClass === "AMBIGUOUS_EXTERNAL"
      && last !== undefined
      && (last.externalEffectState === "UNCERTAIN" || last.externalEffectState === "COMMITTED")
    ) {
      return {
        finalClass: "AMBIGUOUS_EXTERNAL_EFFECT", selectedTrail: trail, ledger, health, envelope,
        envelopeChanged: false, simultaneousWriters: simultaneous, ownerPrompts, takeover,
      };
    }

    const auth = deps.decideAuthority({
      actionKind: attempt === 1 ? "SOURCE_EDIT" : "PROVIDER_FAILOVER",
      spendUsd: 0,
      productionWriter: "NO",
    });
    if (auth.outcome === "REQUIRE_FRESH_OWNER_APPROVAL") ownerPrompts += 1;
    if (auth.outcome !== "ALLOW_STANDING") {
      return {
        finalClass: "POLICY_DENIED", selectedTrail: trail, ledger, health, envelope,
        envelopeChanged: false, simultaneousWriters: simultaneous, ownerPrompts, takeover,
      };
    }

    const adapter = deps.adapters[provider];
    if (adapter === undefined) {
      return {
        finalClass: "NO_ELIGIBLE_PROVIDER", selectedTrail: trail, ledger, health, envelope,
        envelopeChanged: false, simultaneousWriters: simultaneous, ownerPrompts, takeover,
      };
    }
    const availabilityBefore = health[provider]!.state;
    const envelopeBefore = freezeJobEnvelope(envelope);
    const raw = adapter.execute(envelope);
    if (!envelopesEqual(envelopeBefore, envelope)) {
      return {
        finalClass: "POLICY_DENIED", selectedTrail: trail, ledger, health, envelope,
        envelopeChanged: true, simultaneousWriters: simultaneous, ownerPrompts, takeover,
      };
    }
    const klass = adapter.classifyFailure ? adapter.classifyFailure(raw) : classifyFailure(raw);
    if (envelope.writePermission) {
      writer = {
        holder: provider,
        liveness: raw.writerLiveness ?? (klass === "SUCCESS" ? "STOPPED" : "STOPPED"),
        leaseReleased: raw.leaseOutcome === "RELEASED" || klass === "SUCCESS",
      };
    }
    const nextDecision = klass === "SUCCESS" ? "STOP" : (FAILOVER_CLASSES.includes(klass) ? "FAILOVER" : "STOP");
    const record: AttemptRecordV1 = {
      jobId: envelope.jobId,
      attemptId: `${envelope.jobId}:${attempt}`,
      attemptNumber: attempt,
      providerId: provider,
      modelId: raw.modelId ?? provider,
      startTime: now,
      endTime: now,
      authorityDecision: auth.outcome,
      availabilityBefore,
      result: klass,
      failureClass: klass,
      usage: raw.usage ?? null,
      cost: raw.costUsd ?? null,
      worktree: envelope.worktree,
      startingSha: deps.startingSha ?? null,
      endingSha: raw.endingSha ?? null,
      artifact: raw.artifact ?? null,
      leaseOutcome: raw.leaseOutcome ?? "UNKNOWN",
      externalEffectState: raw.externalEffectState ?? "NONE",
      nextRoutingDecision: nextDecision,
    };
    ledger.push(record);
    trail.push(provider);
    health[provider] = healthAfterResult(health[provider] ?? defaultProviderHealth(provider, now), klass, now);
    takeover = createTakeoverPayload({
      envelope,
      previous: record,
      failureClass: klass,
      writer,
      retryBudgetRemaining: budget - attempt,
    });
    if (klass === "SUCCESS") {
      return {
        finalClass: "SUCCESS", selectedTrail: trail, ledger, health, envelope,
        envelopeChanged: false, simultaneousWriters: simultaneous, ownerPrompts, takeover,
      };
    }
    if (klass === "AMBIGUOUS_EXTERNAL_EFFECT" || envelope.effectSafetyClass === "AMBIGUOUS_EXTERNAL" && raw.externalEffectState === "UNCERTAIN") {
      return {
        finalClass: "AMBIGUOUS_EXTERNAL_EFFECT", selectedTrail: trail, ledger, health, envelope,
        envelopeChanged: false, simultaneousWriters: simultaneous, ownerPrompts, takeover,
      };
    }
    if (klass === "WORKER_STATE_UNKNOWN" || raw.writerLiveness === "UNKNOWN") {
      writer = { holder: provider, liveness: "UNKNOWN", leaseReleased: false };
      return {
        finalClass: "WORKER_STATE_UNKNOWN", selectedTrail: trail, ledger, health, envelope,
        envelopeChanged: false, simultaneousWriters: simultaneous, ownerPrompts, takeover,
      };
    }
    if (!FAILOVER_CLASSES.includes(klass) && klass !== "JOB_FAILURE") {
      return {
        finalClass: klass, selectedTrail: trail, ledger, health, envelope,
        envelopeChanged: false, simultaneousWriters: simultaneous, ownerPrompts, takeover,
      };
    }
    if (envelope.effectSafetyClass === "REPOSITORY_REVERSIBLE" || envelope.effectSafetyClass === "READ_ONLY" || envelope.effectSafetyClass === "IDEMPOTENT_EXTERNAL") {
      writer = { holder: provider, liveness: "STOPPED", leaseReleased: true };
      continue;
    }
    if (FAILOVER_CLASSES.includes(klass)) {
      writer = { holder: provider, liveness: "STOPPED", leaseReleased: true };
      continue;
    }
  }

  return {
    finalClass: ledger.length === 0 ? "NO_ELIGIBLE_PROVIDER" : "JOB_FAILURE",
    selectedTrail: trail,
    ledger,
    health,
    envelope,
    envelopeChanged: false,
    simultaneousWriters: simultaneous,
    ownerPrompts,
    takeover,
  };
}

export const PROVIDER_HEALTH_RELATIVE_PATH = ".aion-local/provider-bridge/health.json";
export const PROVIDER_LEDGER_RELATIVE_PATH = ".aion-local/provider-bridge/attempts.jsonl";

export function serializeProviderHealth(
  health: Readonly<Record<ProviderIdV1, ProviderHealthV1>>,
): string {
  return JSON.stringify({ schema: PROVIDER_BRIDGE_SCHEMA_V1, health }, null, 2);
}

export function parseProviderHealth(raw: string): Record<ProviderIdV1, ProviderHealthV1> {
  const parsed = JSON.parse(raw) as { health?: Record<ProviderIdV1, ProviderHealthV1> };
  if (parsed === null || typeof parsed !== "object" || parsed.health === undefined) {
    throw new Error("provider health registry is malformed");
  }
  return parsed.health;
}

export function serializeAttemptLedger(records: readonly AttemptRecordV1[]): string {
  return records.map((row) => JSON.stringify(row)).join("\n") + (records.length > 0 ? "\n" : "");
}
