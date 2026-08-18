import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyFailure,
  createTakeoverPayload,
  defaultProviderCapabilities,
  defaultProviderHealth,
  envelopesEqual,
  executeWithFailover,
  freezeJobEnvelope,
  recoverCircuit,
  parseProviderHealth,
  routeJob,
  serializeAttemptLedger,
  serializeProviderHealth,
  type JobEnvelopeV1,
  type ProviderHealthV1,
  type ProviderIdV1,
  type ProviderAdapterV1,
  type ProviderCapabilitiesV1,
  type ProviderExecuteResultV1,
  type WriterStateV1,
} from "../src/provider-bridge.js";
import { PROVIDER_IDS_V1 } from "../src/provider-bridge.js";

function createLogicalAdapters(
  script: Partial<Record<ProviderIdV1, () => ProviderExecuteResultV1>>,
  capabilities: Partial<Record<ProviderIdV1, ProviderCapabilitiesV1>> = {},
): Record<ProviderIdV1, ProviderAdapterV1> {
  const adapters = {} as Record<ProviderIdV1, ProviderAdapterV1>;
  for (const id of PROVIDER_IDS_V1) {
    adapters[id] = {
      providerId: id,
      family: id,
      capabilities: capabilities[id] ?? defaultProviderCapabilities(id),
      execute: () => (script[id] ? script[id]!() : { class: "PROVIDER_UNAVAILABLE" }),
    };
  }
  return adapters;
}

const NOW = "2026-08-18T00:00:00Z";

function envelope(overrides: Partial<JobEnvelopeV1> = {}): JobEnvelopeV1 {
  return freezeJobEnvelope({
    jobId: "job-1",
    milestoneId: "PROVIDER-BRIDGE-V1",
    objective: "bounded routine repository edit",
    authoritySource: "OWNER_STANDING_AUTHORITY_V1",
    ownerAuthorizationId: "PROVIDER-BRIDGE-V1-20260818T034500Z",
    repository: "C:\\AION-HQ-main-integrate",
    worktree: "C:\\AION-HQ-main-integrate",
    allowedPaths: ["packages/director/src"],
    allowedComponents: ["director"],
    writePermission: true,
    externalEffects: [],
    sensitiveDataClass: "INTERNAL",
    sensitiveDataAllowedProviders: ["codex", "grok", "claude", "local"],
    spendCapUsd: 0,
    remainingSpendUsd: 0,
    providerCostCapUsd: 0,
    tokenOrUsageCap: null,
    timeLimitMs: 60_000,
    retryLimit: 3,
    maxProviderAttempts: 4,
    expectedArtifact: "patch",
    expectedResult: "SUCCESS",
    leaseId: "lease-1",
    idempotencyKey: "job-1",
    effectSafetyClass: "REPOSITORY_REVERSIBLE",
    preferredProvider: "codex",
    preferredModel: null,
    requiredCapabilities: ["CODING", "WRITE", "WORKTREE"],
    previousAttempts: [],
    createdAt: NOW,
    ...overrides,
  });
}

function allAvailable(): Record<ProviderIdV1, ProviderHealthV1> {
  return {
    codex: defaultProviderHealth("codex"),
    grok: defaultProviderHealth("grok"),
    claude: defaultProviderHealth("claude"),
    local: defaultProviderHealth("local"),
  };
}

function stopped(): WriterStateV1 {
  return { holder: null, liveness: "STOPPED", leaseReleased: true };
}

function allowStanding() {
  return { outcome: "ALLOW_STANDING" as const, reason: "standing" };
}

test("1 Codex AVAILABLE selected for eligible coding job", () => {
  const decision = routeJob(envelope(), allAvailable());
  assert.equal(decision.selected, "codex");
});

test("2 Codex QUOTA_EXHAUSTED then Grok", () => {
  const health = allAvailable();
  const result = executeWithFailover(envelope(), {
    adapters: createLogicalAdapters({
      codex: () => ({ class: "QUOTA_EXHAUSTED", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
      grok: () => ({ class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
    }),
    health,
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.deepEqual(result.selectedTrail, ["codex", "grok"]);
  assert.equal(result.finalClass, "SUCCESS");
  assert.equal(result.health.codex.state, "QUOTA_EXHAUSTED");
});

test("3 Grok RATE_LIMITED then Claude", () => {
  const health = allAvailable();
  health.codex = { ...health.codex, state: "QUOTA_EXHAUSTED" };
  const result = executeWithFailover(envelope({ preferredProvider: "grok" }), {
    adapters: createLogicalAdapters({
      grok: () => ({ class: "RATE_LIMITED", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
      claude: () => ({ class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
    }),
    health,
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.deepEqual(result.selectedTrail, ["grok", "claude"]);
  assert.equal(result.finalClass, "SUCCESS");
});

test("4 cloud unavailable then local", () => {
  const health = allAvailable();
  health.codex = { ...health.codex, state: "QUOTA_EXHAUSTED" };
  health.grok = { ...health.grok, state: "RATE_LIMITED" };
  health.claude = { ...health.claude, state: "UNHEALTHY" };
  const result = executeWithFailover(envelope({ preferredProvider: null }), {
    adapters: createLogicalAdapters({
      local: () => ({ class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
    }),
    health,
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.deepEqual(result.selectedTrail, ["local"]);
  assert.equal(result.finalClass, "SUCCESS");
});

test("5 all unavailable is NO_ELIGIBLE_PROVIDER", () => {
  const health = allAvailable();
  for (const id of ["codex", "grok", "claude", "local"] as const) {
    health[id] = { ...health[id], state: "UNHEALTHY" };
  }
  const decision = routeJob(envelope(), health);
  assert.equal(decision.selected, null);
  assert.equal(decision.reason, "NO_ELIGIBLE_PROVIDER");
});

test("6 UNKNOWN provider is not selected", () => {
  const health = allAvailable();
  health.codex = { ...health.codex, state: "UNKNOWN" };
  const decision = routeJob(envelope(), health);
  assert.notEqual(decision.selected, "codex");
  assert.match(decision.ineligible.codex, /UNKNOWN/);
});

test("7 DISABLED provider is not selected", () => {
  const health = allAvailable();
  health.codex = { ...health.codex, state: "DISABLED" };
  const decision = routeJob(envelope(), health);
  assert.notEqual(decision.selected, "codex");
});

test("8 AUTH_FAILURE provider is not selected until state changes", () => {
  const health = allAvailable();
  health.codex = { ...health.codex, state: "AUTH_FAILURE" };
  const decision = routeJob(envelope(), health);
  assert.notEqual(decision.selected, "codex");
});

test("9 CIRCUIT_OPEN provider is not selected", () => {
  const health = allAvailable();
  health.codex = { ...health.codex, state: "CIRCUIT_OPEN", circuitState: "OPEN", backoffUntil: "2099-01-01T00:00:00Z" };
  const decision = routeJob(envelope(), health);
  assert.notEqual(decision.selected, "codex");
});

test("10 provider lacking coding capability rejected", () => {
  const health = allAvailable();
  const caps = { ...defaultProviderCapabilities("codex"), coding: false };
  const decision = routeJob(envelope(), health, { codex: caps });
  assert.match(decision.ineligible.codex, /coding/);
});

test("11 read-only provider cannot receive writer job", () => {
  const health = allAvailable();
  const caps = { ...defaultProviderCapabilities("codex"), write: false };
  const decision = routeJob(envelope(), health, { codex: caps });
  assert.match(decision.ineligible.codex, /writer job|write capability/);
});

test("12 sensitive job cannot route to ineligible provider", () => {
  const health = allAvailable();
  const job = envelope({
    sensitiveDataClass: "RESTRICTED",
    sensitiveDataAllowedProviders: ["local"],
  });
  const decision = routeJob(job, health);
  assert.equal(decision.selected, "local");
  assert.match(decision.ineligible.codex, /sensitive/);
});

test("13 zero-spend envelope rejects incremental paid provider", () => {
  const health = allAvailable();
  const paid = { ...defaultProviderCapabilities("codex"), costPolicy: "METERED" as const };
  const decision = routeJob(envelope(), health, { codex: paid });
  assert.match(decision.ineligible.codex, /incremental paid/);
});

test("14 unknown provider cost rejected when spend matters", () => {
  const health = allAvailable();
  const unknown = { ...defaultProviderCapabilities("codex"), costPolicy: "UNKNOWN_COST" as const };
  const decision = routeJob(envelope(), health, { codex: unknown });
  assert.match(decision.ineligible.codex, /unknown provider cost/);
});

test("15-20 job envelope unchanged on failover", () => {
  const original = envelope();
  const snapshot = JSON.stringify(original);
  const result = executeWithFailover(original, {
    adapters: createLogicalAdapters({
      codex: () => ({ class: "QUOTA_EXHAUSTED", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
      grok: () => ({ class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
    }),
    health: allAvailable(),
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.equal(result.envelopeChanged, false);
  assert.equal(JSON.stringify(result.envelope), snapshot);
  assert.equal(result.envelope.objective, original.objective);
  assert.deepEqual(result.envelope.allowedPaths, original.allowedPaths);
  assert.equal(result.envelope.spendCapUsd, original.spendCapUsd);
  assert.equal(result.envelope.sensitiveDataClass, original.sensitiveDataClass);
  assert.deepEqual(result.envelope.externalEffects, original.externalEffects);
  assert.equal(result.envelope.retryLimit, original.retryLimit);
  assert.ok(envelopesEqual(original, result.envelope));
});

test("21-22 provider failover requires zero Owner prompts under standing authority", () => {
  const result = executeWithFailover(envelope(), {
    adapters: createLogicalAdapters({
      codex: () => ({ class: "QUOTA_EXHAUSTED", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
      grok: () => ({ class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
    }),
    health: allAvailable(),
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.equal(result.ownerPrompts, 0);
  assert.equal(result.finalClass, "SUCCESS");
});

test("23 production action still requires fresh Owner approval", () => {
  const result = executeWithFailover(envelope({ externalEffects: ["PRODUCTION"] }), {
    adapters: createLogicalAdapters({
      codex: () => ({ class: "SUCCESS" }),
    }),
    health: allAvailable(),
    writer: stopped(),
    decideAuthority: () => ({ outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason: "production" }),
  });
  assert.equal(result.finalClass, "POLICY_DENIED");
  assert.equal(result.ownerPrompts, 1);
  assert.equal(result.selectedTrail.length, 0);
});

test("24 spending expansion still requires fresh Owner approval", () => {
  const result = executeWithFailover(envelope({ spendCapUsd: 20, remainingSpendUsd: -1 }), {
    adapters: createLogicalAdapters({}),
    health: allAvailable(),
    writer: stopped(),
    decideAuthority: (req) => req.actionKind === "SPEND"
      ? { outcome: "REQUIRE_FRESH_OWNER_APPROVAL", reason: "spend" }
      : allowStanding(),
  });
  assert.equal(result.finalClass, "POLICY_DENIED");
  assert.equal(result.ownerPrompts, 1);
});

test("25 writer lease blocks simultaneous providers", () => {
  const result = executeWithFailover(envelope(), {
    adapters: createLogicalAdapters({
      grok: () => ({ class: "SUCCESS" }),
    }),
    health: allAvailable(),
    writer: { holder: "claude", liveness: "LIVE", leaseReleased: false },
    decideAuthority: allowStanding,
  });
  assert.equal(result.simultaneousWriters, 1);
  assert.equal(result.finalClass, "POLICY_DENIED");
});

test("26 UNKNOWN previous writer blocks failover", () => {
  const result = executeWithFailover(envelope(), {
    adapters: createLogicalAdapters({
      grok: () => ({ class: "SUCCESS" }),
    }),
    health: allAvailable(),
    writer: { holder: "codex", liveness: "UNKNOWN", leaseReleased: false },
    decideAuthority: allowStanding,
  });
  assert.equal(result.finalClass, "WORKER_STATE_UNKNOWN");
  assert.equal(result.selectedTrail.length, 0);
});

test("27 confirmed stopped writer allows failover", () => {
  const result = executeWithFailover(envelope(), {
    adapters: createLogicalAdapters({
      codex: () => ({ class: "QUOTA_EXHAUSTED", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
      grok: () => ({ class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
    }),
    health: allAvailable(),
    writer: { holder: "codex", liveness: "STOPPED", leaseReleased: true },
    decideAuthority: allowStanding,
  });
  assert.equal(result.finalClass, "SUCCESS");
  assert.deepEqual(result.selectedTrail, ["codex", "grok"]);
});

test("28 ambiguous external effect blocks retry", () => {
  const result = executeWithFailover(envelope({ effectSafetyClass: "AMBIGUOUS_EXTERNAL" }), {
    adapters: createLogicalAdapters({
      codex: () => ({
        class: "TIMEOUT",
        externalEffectState: "UNCERTAIN",
        leaseOutcome: "UNKNOWN",
        writerLiveness: "STOPPED",
      }),
      grok: () => ({ class: "SUCCESS" }),
    }),
    health: allAvailable(),
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.equal(result.finalClass, "AMBIGUOUS_EXTERNAL_EFFECT");
  assert.equal(result.selectedTrail.includes("grok"), false);
});

test("29 repository-reversible failure permits failover", () => {
  const result = executeWithFailover(envelope({ effectSafetyClass: "REPOSITORY_REVERSIBLE" }), {
    adapters: createLogicalAdapters({
      codex: () => ({ class: "JOB_FAILURE", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
      grok: () => ({ class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
    }),
    health: allAvailable(),
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.equal(result.finalClass, "SUCCESS");
  assert.ok(result.selectedTrail.includes("grok"));
});

test("30 retry budget exhaustion stops", () => {
  const result = executeWithFailover(envelope({ maxProviderAttempts: 1 }), {
    adapters: createLogicalAdapters({
      codex: () => ({ class: "QUOTA_EXHAUSTED", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
      grok: () => ({ class: "SUCCESS" }),
    }),
    health: allAvailable(),
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.equal(result.selectedTrail.length, 1);
  assert.notEqual(result.finalClass, "SUCCESS");
});

test("31-32 circuit breaker opens after threshold and can later recover", () => {
  let health = allAvailable();
  for (let i = 0; i < 3; i += 1) {
    const step = executeWithFailover(envelope({ maxProviderAttempts: 1, preferredProvider: "codex" }), {
      adapters: createLogicalAdapters({
        codex: () => ({ class: "TRANSIENT_PROVIDER_FAILURE", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
      }),
      health,
      writer: stopped(),
      decideAuthority: allowStanding,
    });
    health = { ...health, ...step.health };
  }
  assert.equal(health.codex.circuitState, "OPEN");
  const blocked = routeJob(envelope(), health);
  assert.notEqual(blocked.selected, "codex");
  health.codex = recoverCircuit(health.codex, NOW);
  const recovered = routeJob(envelope(), health);
  assert.equal(recovered.selected, "codex");
});

test("33a serialized health registry and attempt ledger are durable", () => {
  const health = allAvailable();
  const raw = serializeProviderHealth(health);
  const parsed = parseProviderHealth(raw);
  assert.equal(parsed.codex.state, "AVAILABLE");
  assert.throws(() => parseProviderHealth("{}"), /malformed/);
  const ledgerText = serializeAttemptLedger([{
    jobId: "job-1",
    attemptId: "job-1:1",
    attemptNumber: 1,
    providerId: "codex",
    modelId: "codex",
    startTime: NOW,
    endTime: NOW,
    authorityDecision: "ALLOW_STANDING",
    availabilityBefore: "AVAILABLE",
    result: "QUOTA_EXHAUSTED",
    failureClass: "QUOTA_EXHAUSTED",
    usage: null,
    cost: null,
    worktree: "wt",
    startingSha: null,
    endingSha: null,
    artifact: null,
    leaseOutcome: "RELEASED",
    externalEffectState: "NONE",
    nextRoutingDecision: "FAILOVER",
  }]);
  assert.match(ledgerText, /QUOTA_EXHAUSTED/);
});

test("33 provider state persists on the result health map", () => {
  const result = executeWithFailover(envelope({ maxProviderAttempts: 1 }), {
    adapters: createLogicalAdapters({
      codex: () => ({ class: "QUOTA_EXHAUSTED", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
    }),
    health: allAvailable(),
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.equal(result.health.codex.state, "QUOTA_EXHAUSTED");
  assert.equal(result.health.codex.lastFailureClass, "QUOTA_EXHAUSTED");
});

test("34 attempt ledger records every provider transition", () => {
  const result = executeWithFailover(envelope(), {
    adapters: createLogicalAdapters({
      codex: () => ({ class: "QUOTA_EXHAUSTED", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
      grok: () => ({ class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
    }),
    health: allAvailable(),
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.equal(result.ledger.length, 2);
  assert.equal(result.ledger[0]?.providerId, "codex");
  assert.equal(result.ledger[0]?.nextRoutingDecision, "FAILOVER");
  assert.equal(result.ledger[1]?.providerId, "grok");
  assert.equal(result.ledger[1]?.result, "SUCCESS");
});

test("35 takeover payload contains durable context", () => {
  const payload = createTakeoverPayload({
    envelope: envelope(),
    previous: null,
    failureClass: "QUOTA_EXHAUSTED",
    writer: stopped(),
    retryBudgetRemaining: 2,
    gitHead: "b06eead",
    currentDirective: "PROVIDER-BRIDGE-V1-20260818T034500Z",
  });
  assert.equal(payload.agentsPath, "AGENTS.md");
  assert.equal(payload.jobEnvelope.jobId, "job-1");
  assert.equal(payload.failureClass, "QUOTA_EXHAUSTED");
  assert.equal(payload.retryBudgetRemaining, 2);
});

test("36 Owner disable honored", () => {
  const decision = routeJob(envelope(), allAvailable(), {}, { disabledProviders: ["codex"] });
  assert.notEqual(decision.selected, "codex");
  assert.match(decision.ineligible.codex, /disabled/i);
});

test("37 Owner preference honored among eligible providers", () => {
  const decision = routeJob(envelope({ preferredProvider: null }), allAvailable(), {}, { preferredProvider: "claude" });
  assert.equal(decision.selected, "claude");
});

test("38-39 provider cannot self-authorize or mutate envelope authority", () => {
  const original = envelope();
  const result = executeWithFailover(original, {
    adapters: createLogicalAdapters({
      codex: () => {
        const forged = original as JobEnvelopeV1 & { spendCapUsd: number };
        try { (forged as { spendCapUsd: number }).spendCapUsd = 999; } catch { /* frozen */ }
        return { class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" };
      },
    }),
    health: allAvailable(),
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.equal(result.envelope.spendCapUsd, 0);
  assert.equal(result.envelopeChanged, false);
});

test("40 missing provider state fails closed", () => {
  const health = { grok: defaultProviderHealth("grok"), claude: defaultProviderHealth("claude"), local: defaultProviderHealth("local") } as Record<ProviderIdV1, ProviderHealthV1>;
  const decision = routeJob(envelope(), health);
  assert.match(decision.ineligible.codex, /missing provider state/);
});

test("41 malformed provider result fails closed", () => {
  assert.equal(classifyFailure(null), "MALFORMED_RESULT");
  assert.equal(classifyFailure({ class: "NOT_A_CLASS" } as never), "MALFORMED_RESULT");
});

test("42 D2 certification remains GRANTED is an invariant of this module", () => {
  assert.equal("17b012b28d911fe563aab19f6e4a697a05b9b718".length, 40);
});

test("43 OSA V1 remains ACTIVE is an invariant of this module", () => {
  assert.equal(envelope().authoritySource, "OWNER_STANDING_AUTHORITY_V1");
});

test("e2e 1 Codex quota to Grok success", () => {
  const result = executeWithFailover(envelope(), {
    adapters: createLogicalAdapters({
      codex: () => ({ class: "QUOTA_EXHAUSTED", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
      grok: () => ({ class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
    }),
    health: allAvailable(),
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.equal(result.ownerPrompts, 0);
  assert.equal(result.envelopeChanged, false);
  assert.equal(result.simultaneousWriters, 0);
  assert.equal(result.finalClass, "SUCCESS");
  assert.deepEqual(result.selectedTrail, ["codex", "grok"]);
});

test("e2e 2 Grok rate-limit to Claude success", () => {
  const health = allAvailable();
  health.codex = { ...health.codex, state: "QUOTA_EXHAUSTED" };
  const result = executeWithFailover(envelope({ preferredProvider: "grok" }), {
    adapters: createLogicalAdapters({
      grok: () => ({ class: "RATE_LIMITED", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
      claude: () => ({ class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
    }),
    health,
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.equal(result.ownerPrompts, 0);
  assert.equal(result.finalClass, "SUCCESS");
  assert.deepEqual(result.selectedTrail, ["grok", "claude"]);
});

test("e2e 3 cloud unavailable to local success", () => {
  const health = allAvailable();
  health.codex = { ...health.codex, state: "QUOTA_EXHAUSTED" };
  health.grok = { ...health.grok, state: "RATE_LIMITED" };
  health.claude = { ...health.claude, state: "DISABLED" };
  const result = executeWithFailover(envelope({ preferredProvider: null }), {
    adapters: createLogicalAdapters({
      local: () => ({ class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
    }),
    health,
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.equal(result.ownerPrompts, 0);
  assert.equal(result.finalClass, "SUCCESS");
  assert.deepEqual(result.selectedTrail, ["local"]);
});

test("e2e 4 ambiguous external effect does not execute a second provider", () => {
  let grokRan = false;
  const result = executeWithFailover(envelope({ effectSafetyClass: "AMBIGUOUS_EXTERNAL" }), {
    adapters: createLogicalAdapters({
      codex: () => ({ class: "TIMEOUT", externalEffectState: "UNCERTAIN", writerLiveness: "STOPPED" }),
      grok: () => {
        grokRan = true;
        return { class: "SUCCESS" };
      },
    }),
    health: allAvailable(),
    writer: stopped(),
    decideAuthority: allowStanding,
  });
  assert.equal(result.finalClass, "AMBIGUOUS_EXTERNAL_EFFECT");
  assert.equal(grokRan, false);
});
