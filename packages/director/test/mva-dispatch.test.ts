import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquireLease,
  type LeaseV1,
} from "../src/leases.js";
import {
  D2_CERTIFIED_SHA_V1,
  MVA_OWNER_AUTHORIZATION_ID,
  artifactContents,
  buildJobEnvelope,
  createDispatchBootstrap,
  createFileJobStore,
  createMemoryJobStore,
  createQuotaExhaustedAdapter,
  createRateLimitedAdapter,
  MVA_MILESTONE_ID,
  createRealBoundedExecutorAdapter,
  memoryEffectJournal,
  defaultMvaAuthority,
  jobRecordPath,
  legalJobTransition,
  parseJobRecord,
  persistHealthAndLedger,
  recoverJob,
  serializeJobRecord,
  submitJob,
  validateJobArtifact,
  validateJobRequest,
  type JobRequestV1,
  type JobStateV1,
} from "../src/mva-dispatch.js";
import {
  DIRECTOR_CAPABILITY_REGISTRY_V1,
  type EffectGateDepsV1,
} from "../src/pre-action-effect-contract.js";
import {
  ROADMAP_ENVELOPE_SCHEMA_V1,
  type OwnerRoadmapAuthorityEnvelopeV1,
} from "../src/roadmap-authority-envelope.js";
import {
  defaultProviderCapabilities,
  defaultProviderHealth,
  envelopesEqual,
  executeWithFailover,
  routeJob,
  type ProviderAdapterV1,
  type ProviderHealthV1,
  type ProviderIdV1,
} from "../src/provider-bridge.js";

const NOW = "2026-08-18T00:00:00Z";
const SHA = "2a764a89bde15d1ecceb45640da88af5f7ac3b12";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "aion-mva-"));
}

function request(root: string, overrides: Partial<JobRequestV1> = {}): JobRequestV1 {
  return {
    jobId: "job-mva-1",
    objective: "write a disposable dispatch acceptance artifact",
    jobClass: "REPOSITORY_REVERSIBLE",
    repository: root,
    worktree: root,
    allowedPaths: ["packages/director/src"],
    expectedArtifact: "mva-real-dispatch-v1.txt",
    startingSha: SHA,
    preferredProvider: "local",
    maxProviderAttempts: 4,
    ...overrides,
  };
}

function files() {
  const written = new Map<string, string>();
  return {
    written,
    writeFile: (path: string, contents: string) => {
      written.set(path, contents);
    },
    readFile: (path: string) => {
      const value = written.get(path);
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
  };
}

function unavailable(id: ProviderIdV1): ProviderAdapterV1 {
  return {
    providerId: id,
    family: id,
    capabilities: defaultProviderCapabilities(id),
    execute: () => ({ class: "PROVIDER_UNAVAILABLE", leaseOutcome: "RELEASED", writerLiveness: "STOPPED" }),
  };
}

/*
 * Authority for the artifact writes the bounded executor performs.
 *
 * The adapter now routes those writes through the pre-action effect gate, so a dispatch test has to
 * say what authorises them. This envelope is the shape the Owner's authority produces, scoped to
 * exactly the capability and target the write uses — a fixture granting more than that would be
 * proving the gate works against a lock nobody closed.
 */
const EFFECT_AUTHORITY_ID = MVA_OWNER_AUTHORIZATION_ID;
const EFFECT_ENVELOPE_ID = `ENVELOPE-${EFFECT_AUTHORITY_ID}`;

function artifactEnvelope(overrides: Partial<OwnerRoadmapAuthorityEnvelopeV1> = {}): OwnerRoadmapAuthorityEnvelopeV1 {
  return {
    schema: ROADMAP_ENVELOPE_SCHEMA_V1,
    envelopeId: EFFECT_ENVELOPE_ID,
    ownerAuthorizationId: EFFECT_AUTHORITY_ID,
    approvedParentMilestoneIds: [MVA_MILESTONE_ID],
    approvedObjectives: [],
    allowedWriteDomains: ["artifacts"],
    allowedProviders: ["local", "codex", "grok", "claude"],
    sensitivityCeiling: "INTERNAL",
    spendCeilingUsd: 0,
    allowedExternalEffectClasses: ["REPOSITORY_REVERSIBLE"],
    requiresReversible: true,
    productionWriterPermission: "NO",
    destructiveActionPermission: "NO",
    securityChangePermission: "NO",
    oauthConsentPermission: "NO",
    sensitiveDataPermission: "NO",
    state: "ACTIVE",
    expiresAtUtc: "",
    supersededBy: "",
    alwaysGatedBoundaries: [],
    provenance: "fixture",
    version: 1,
    createdAtUtc: NOW,
    ...overrides,
  };
}

function artifactGate(overrides: Partial<EffectGateDepsV1> = {}): EffectGateDepsV1 {
  return {
    registry: DIRECTOR_CAPABILITY_REGISTRY_V1,
    resolveTarget: (targetType: string, targetId: string) =>
      targetType === "JobArtifact"
        ? { targetType, targetId, sensitivity: "INTERNAL" as const, writeDomain: "artifacts" }
        : null,
    envelopeFor: (id: string) => (id === EFFECT_ENVELOPE_ID ? artifactEnvelope() : null),
    ownerId: "daniel",
    now: NOW,
    ...overrides,
  };
}

/** The four things the bounded executor needs before it may write anything. */
function effectDeps(gate: EffectGateDepsV1 = artifactGate()) {
  return {
    effectGate: gate,
    actorId: "aion.director.mva-dispatch",
    authorityEnvelopeId: EFFECT_ENVELOPE_ID,
    parentMilestoneId: MVA_MILESTONE_ID,
    pinnedOwnerAuthorizationId: MVA_OWNER_AUTHORIZATION_ID,
    journal: memoryEffectJournal(),
    recordDecision: () => undefined,
  };
}

function realAdapters(root: string, io: ReturnType<typeof files>, realId: ProviderIdV1 = "local") {
  const real = createRealBoundedExecutorAdapter(realId, {
    artifactRoot: root,
    writeFile: io.writeFile,
    readFile: io.readFile,
    startingSha: SHA,
        ...effectDeps(),
  });
  return {
    codex: realId === "codex" ? real : unavailable("codex"),
    grok: realId === "grok" ? real : unavailable("grok"),
    claude: realId === "claude" ? real : unavailable("claude"),
    local: realId === "local" ? real : unavailable("local"),
  };
}

function healthAll(): Record<ProviderIdV1, ProviderHealthV1> {
  return {
    codex: defaultProviderHealth("codex"),
    grok: defaultProviderHealth("grok"),
    claude: defaultProviderHealth("claude"),
    local: defaultProviderHealth("local"),
  };
}

test("1 valid repository-reversible request accepted", () => {
  const root = tempRoot();
  try {
    assert.equal(validateJobRequest(request(root)), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("2 invalid request fails closed", () => {
  const root = tempRoot();
  try {
    const bad = request(root, { objective: "   " });
    const result = submitJob(bad, { now: NOW });
    assert.equal(result.result.finalState, "FAILED");
    assert.equal(result.result.workerLaunches, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("3 authority checked before execution", () => {
  const root = tempRoot();
  const io = files();
  let decided = 0;
  try {
    submitJob(request(root), {
      now: NOW,
      adapters: realAdapters(root, io),
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
      decideAuthority: (req) => {
        decided += 1;
        return defaultMvaAuthority(req);
      },
    });
    assert.ok(decided >= 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("4-5 job envelope generated correctly and is immutable", () => {
  const root = tempRoot();
  try {
    const envelope = buildJobEnvelope(request(root), NOW);
    assert.equal(envelope.milestoneId, "MVA-REAL-DISPATCH-V1");
    assert.equal(envelope.authoritySource, "OWNER_STANDING_AUTHORITY_V1");
    assert.deepEqual(envelope.allowedPaths, ["packages/director/src"]);
    assert.throws(() => {
      (envelope as { spendCapUsd: number }).spendCapUsd = 99;
    });
    const snapshot = JSON.stringify(envelope);
    assert.ok(envelopesEqual(envelope, JSON.parse(snapshot)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("6-11 legal happy-path transitions", () => {
  const steps: Array<[JobStateV1, JobStateV1]> = [
    ["CREATED", "AUTHORIZED"],
    ["AUTHORIZED", "ROUTING"],
    ["ROUTING", "LEASE_ACQUIRED"],
    ["LEASE_ACQUIRED", "EXECUTING"],
    ["EXECUTING", "VALIDATING"],
    ["VALIDATING", "SUCCEEDED"],
  ];
  for (const [from, to] of steps) {
    assert.equal(legalJobTransition(from, to), true, `${from} -> ${to}`);
  }
});

test("12 invalid transition denied", () => {
  assert.equal(legalJobTransition("SUCCEEDED", "EXECUTING"), false);
  assert.equal(legalJobTransition("DENIED", "AUTHORIZED"), false);
});

test("13-14 job record persists and reloads", () => {
  const root = tempRoot();
  const io = files();
  try {
    const store = createMemoryJobStore();
    const submitted = submitJob(request(root), {
      now: NOW,
      store,
      adapters: realAdapters(root, io),
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
    });
    const raw = serializeJobRecord(submitted.record);
    const loaded = parseJobRecord(raw);
    assert.equal(loaded.jobId, "job-mva-1");
    assert.equal(loaded.status, "SUCCEEDED");
    assert.equal(store.load("job-mva-1")?.status, "SUCCEEDED");
    const fileStore = createFileJobStore(root);
    fileStore.save(loaded);
    assert.equal(fileStore.load("job-mva-1")?.jobId, "job-mva-1");
    assert.ok(jobRecordPath(root, "job-mva-1").includes("job-mva-1.json"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("15-16 real adapter receives durable bootstrap and output is validated", () => {
  const root = tempRoot();
  const io = files();
  try {
    const submitted = submitJob(request(root), {
      now: NOW,
      adapters: realAdapters(root, io),
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
    });
    const bootstrap = [...io.written.keys()].find((path) => path.endsWith(".bootstrap.json"));
    assert.ok(bootstrap);
    const payload = JSON.parse(io.written.get(bootstrap!)!) as ReturnType<typeof createDispatchBootstrap>;
    assert.equal(payload.jobId, "job-mva-1");
    assert.equal(payload.agentsPath, "AGENTS.md");
    assert.equal(payload.currentDirectivePath, ".aion-local/directives/CURRENT.md");
    assert.ok(payload.stopConditions.length > 0);
    assert.equal(submitted.result.finalState, "SUCCEEDED");
    assert.ok(submitted.result.validationEvidence.includes("artifact-validated"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("17 missing artifact fails", () => {
  const root = tempRoot();
  try {
    const adapters = {
      ...realAdapters(root, files()),
      local: {
        providerId: "local" as const,
        family: "local",
        capabilities: defaultProviderCapabilities("local"),
        execute: () => ({ class: "SUCCESS" as const, leaseOutcome: "RELEASED" as const, writerLiveness: "STOPPED" as const }),
      },
    };
    const submitted = submitJob(request(root), { now: NOW, adapters });
    assert.equal(submitted.result.finalState, "FAILED");
    assert.match(submitted.result.failureReason ?? "", /missing artifact/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("18 malformed result fails", () => {
  const root = tempRoot();
  try {
    assert.equal(validateJobArtifact("not-an-artifact", buildJobEnvelope(request(root), NOW), "local") !== null, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("19-20 provider attempt and health persist", () => {
  const root = tempRoot();
  const io = files();
  try {
    const submitted = submitJob(request(root), {
      now: NOW,
      adapters: realAdapters(root, io),
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
    });
    assert.ok(submitted.record.attempts.length >= 1);
    const persisted = persistHealthAndLedger(submitted.record.health, submitted.record.attempts);
    assert.match(persisted.healthText, /local/);
    assert.match(persisted.ledgerText, /SUCCESS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("21 quota exhaustion triggers safe failover", () => {
  const root = tempRoot();
  const io = files();
  try {
    const adapters = {
      codex: createQuotaExhaustedAdapter("codex"),
      grok: createRealBoundedExecutorAdapter("grok", {
        artifactRoot: root, writeFile: io.writeFile, readFile: io.readFile, startingSha: SHA,
        ...effectDeps(),
      }),
      claude: unavailable("claude"),
      local: unavailable("local"),
    };
    const submitted = submitJob(request(root, { preferredProvider: null }), {
      now: NOW,
      adapters,
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
    });
    assert.equal(submitted.result.finalState, "SUCCEEDED");
    assert.equal(submitted.record.attempts[0]?.providerId, "codex");
    assert.equal(submitted.record.attempts[0]?.result, "QUOTA_EXHAUSTED");
    assert.equal(submitted.record.attempts[1]?.providerId, "grok");
    assert.equal(io.written.has(join(root, "mva-real-dispatch-v1.txt")), true);
    assert.equal([...io.written.keys()].some((path) => path.includes("codex") && path.endsWith(".txt")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("22 rate limit triggers safe failover", () => {
  const root = tempRoot();
  const io = files();
  const health = healthAll();
  health.codex = { ...health.codex, state: "QUOTA_EXHAUSTED" };
  try {
    const adapters = {
      codex: unavailable("codex"),
      grok: createRateLimitedAdapter("grok"),
      claude: createRealBoundedExecutorAdapter("claude", {
        artifactRoot: root, writeFile: io.writeFile, readFile: io.readFile, startingSha: SHA,
        ...effectDeps(),
      }),
      local: unavailable("local"),
    };
    const submitted = submitJob(request(root, { preferredProvider: "grok" }), {
      now: NOW,
      adapters,
      health,
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
    });
    assert.equal(submitted.result.finalState, "SUCCEEDED");
    assert.equal(submitted.record.attempts.some((row) => row.providerId === "grok" && row.result === "RATE_LIMITED"), true);
    assert.equal(submitted.record.attempts.some((row) => row.providerId === "claude" && row.result === "SUCCESS"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("23-26 envelope, paths, sensitive data, and spend preserved", () => {
  const root = tempRoot();
  const io = files();
  try {
    const req = request(root, {
      preferredProvider: null,
      sensitiveDataClass: "INTERNAL",
      sensitiveDataAllowedProviders: ["codex", "grok", "claude", "local"],
      spendCapUsd: 0,
    });
    const adapters = {
      codex: createQuotaExhaustedAdapter("codex"),
      grok: createRealBoundedExecutorAdapter("grok", {
        artifactRoot: root, writeFile: io.writeFile, readFile: io.readFile, startingSha: SHA,
        ...effectDeps(),
      }),
      claude: unavailable("claude"),
      local: unavailable("local"),
    };
    const submitted = submitJob(req, {
      now: NOW, adapters, artifactRoot: root, writeFile: io.writeFile, readFile: io.readFile,
    });
    assert.equal(submitted.result.envelopeChanged, false);
    assert.deepEqual(submitted.record.envelope?.allowedPaths, req.allowedPaths);
    assert.equal(submitted.record.envelope?.sensitiveDataClass, "INTERNAL");
    assert.equal(submitted.record.envelope?.spendCapUsd, 0);
    assert.equal(submitted.record.objective, req.objective);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("27 previous worker UNKNOWN blocks replacement", () => {
  const root = tempRoot();
  const io = files();
  try {
    const submitted = submitJob(request(root), {
      now: NOW,
      adapters: realAdapters(root, io),
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
      writer: { holder: "codex", liveness: "UNKNOWN", leaseReleased: false },
    });
    assert.equal(submitted.result.finalState, "RECOVERY_REQUIRED");
    assert.equal(submitted.result.workerLaunches, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("28 stopped/released worker permits replacement", () => {
  const root = tempRoot();
  const io = files();
  try {
    const submitted = submitJob(request(root), {
      now: NOW,
      adapters: realAdapters(root, io),
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
      writer: { holder: "codex", liveness: "STOPPED", leaseReleased: true },
    });
    assert.equal(submitted.result.finalState, "SUCCEEDED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("29 simultaneous writer prevented", () => {
  const root = tempRoot();
  const io = files();
  try {
    const submitted = submitJob(request(root), {
      now: NOW,
      adapters: realAdapters(root, io),
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
      writer: { holder: "claude", liveness: "LIVE", leaseReleased: false },
    });
    assert.equal(submitted.result.finalState, "FAILED");
    assert.match(submitted.result.failureReason ?? "", /simultaneous/);
    assert.equal(submitted.result.workerLaunches, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("30 attempt limit stops loops", () => {
  const root = tempRoot();
  try {
    const adapters = {
      codex: createQuotaExhaustedAdapter("codex"),
      grok: createQuotaExhaustedAdapter("grok"),
      claude: createQuotaExhaustedAdapter("claude"),
      local: createQuotaExhaustedAdapter("local"),
    };
    const submitted = submitJob(request(root, { preferredProvider: null, maxProviderAttempts: 1 }), {
      now: NOW,
      adapters,
    });
    assert.notEqual(submitted.result.finalState, "SUCCEEDED");
    assert.ok(submitted.record.attempts.length <= 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("31 circuit breaker respected", () => {
  const root = tempRoot();
  const health = healthAll();
  health.codex = { ...health.codex, state: "CIRCUIT_OPEN", circuitState: "OPEN", backoffUntil: "2099-01-01T00:00:00Z" };
  const decision = routeJob(buildJobEnvelope(request(root, { preferredProvider: null }), NOW), health);
  assert.notEqual(decision.selected, "codex");
});

test("32 no eligible provider fails closed", () => {
  const root = tempRoot();
  const health = healthAll();
  for (const id of ["codex", "grok", "claude", "local"] as const) {
    health[id] = { ...health[id], state: "DISABLED" };
  }
  try {
    const submitted = submitJob(request(root, { preferredProvider: null }), { now: NOW, health });
    assert.equal(submitted.result.finalState, "NO_ELIGIBLE_PROVIDER");
    assert.equal(submitted.result.workerLaunches, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("33 restart from pre-execution state is safe", () => {
  const root = tempRoot();
  const io = files();
  try {
    const store = createMemoryJobStore();
    const created = submitJob(request(root, { jobId: "pre-exec" }), {
      now: NOW,
      store,
      adapters: realAdapters(root, io),
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
    });
    assert.equal(created.result.finalState, "SUCCEEDED");
    const paused = { ...created.record, status: "AUTHORIZED" as const, attempts: [], artifacts: [], workerLaunches: 0 };
    store.save(paused);
    const io2 = files();
    const resumed = recoverJob("pre-exec", request(root, { jobId: "pre-exec" }), {
      now: NOW,
      store,
      adapters: realAdapters(root, io2),
      artifactRoot: root,
      writeFile: io2.writeFile,
      readFile: io2.readFile,
    });
    assert.equal(resumed.result.finalState, "SUCCEEDED");
    assert.equal(resumed.result.workerLaunches, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("34 restart with UNKNOWN worker blocks duplicate", () => {
  const root = tempRoot();
  const store = createMemoryJobStore();
  const io = files();
  try {
    const first = submitJob(request(root, { jobId: "unknown-worker" }), {
      now: NOW,
      store,
      adapters: realAdapters(root, io),
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
    });
    store.save({
      ...first.record,
      status: "EXECUTING",
      writer: { holder: "local", liveness: "UNKNOWN", leaseReleased: false },
    });
    const io2 = files();
    const recovered = recoverJob("unknown-worker", request(root, { jobId: "unknown-worker" }), {
      now: NOW,
      store,
      adapters: realAdapters(root, io2),
      artifactRoot: root,
      writeFile: io2.writeFile,
      readFile: io2.readFile,
      writer: { holder: "local", liveness: "UNKNOWN", leaseReleased: false },
    });
    assert.equal(recovered.result.finalState, "RECOVERY_REQUIRED");
    assert.equal(io2.written.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("35 restart after clean release resumes safely", () => {
  const root = tempRoot();
  const io = files();
  const store = createMemoryJobStore();
  try {
    const first = submitJob(request(root, { jobId: "resume-clean", preferredProvider: null }), {
      now: NOW,
      store,
      adapters: {
        codex: createQuotaExhaustedAdapter("codex"),
        grok: unavailable("grok"),
        claude: unavailable("claude"),
        local: unavailable("local"),
      },
    });
    store.save({
      ...first.record,
      status: "FAILOVER_PENDING",
      writer: { holder: "codex", liveness: "STOPPED", leaseReleased: true },
      jobId: "resume-clean",
    });
    const io2 = files();
    const resumeHealth = healthAll();
    resumeHealth.codex = { ...resumeHealth.codex, state: "QUOTA_EXHAUSTED" };
    const resumed = recoverJob("resume-clean", request(root, { jobId: "resume-clean", preferredProvider: null }), {
      now: NOW,
      store,
      adapters: {
        codex: createQuotaExhaustedAdapter("codex"),
        grok: createRealBoundedExecutorAdapter("grok", {
          artifactRoot: root, writeFile: io2.writeFile, readFile: io2.readFile, startingSha: SHA,
        ...effectDeps(),
        }),
        claude: unavailable("claude"),
        local: unavailable("local"),
      },
      health: resumeHealth,
      artifactRoot: root,
      writeFile: io2.writeFile,
      readFile: io2.readFile,
      writer: { holder: "codex", liveness: "STOPPED", leaseReleased: true },
    });
    assert.equal(resumed.result.finalState, "SUCCEEDED");
    assert.equal(resumed.result.workerLaunches, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
    void io;
  }
});

test("36-37 high-consequence request requires fresh Owner approval and launches no worker", () => {
  const root = tempRoot();
  const io = files();
  try {
    const submitted = submitJob(request(root, {
      jobClass: "PRODUCTION_EXTERNAL_WRITE",
      externalEffects: ["PRODUCTION"],
    }), {
      now: NOW,
      adapters: realAdapters(root, io),
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
    });
    assert.equal(submitted.result.finalState, "DENIED");
    assert.equal(submitted.result.authorityDecision, "REQUIRE_FRESH_OWNER_APPROVAL");
    assert.equal(submitted.result.workerLaunches, 0);
    assert.equal(submitted.result.ownerPrompts, 1);
    assert.equal(io.written.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("38 ambiguous external effect cannot auto-retry", () => {
  const root = tempRoot();
  try {
    const adapters = {
      codex: {
        providerId: "codex" as const,
        family: "codex",
        capabilities: defaultProviderCapabilities("codex"),
        execute: () => ({
          class: "TIMEOUT" as const,
          externalEffectState: "UNCERTAIN" as const,
          writerLiveness: "STOPPED" as const,
        }),
      },
      grok: createRealBoundedExecutorAdapter("grok", {
        artifactRoot: root,
        writeFile: () => undefined,
        readFile: () => "",
        startingSha: SHA,
        ...effectDeps(),
      }),
      claude: unavailable("claude"),
      local: unavailable("local"),
    };
    const submitted = submitJob(request(root, {
      preferredProvider: null,
      effectSafetyClass: "AMBIGUOUS_EXTERNAL",
    }), { now: NOW, adapters });
    assert.equal(submitted.result.finalState, "AMBIGUOUS_EFFECT_BLOCKED");
    assert.equal(submitted.record.attempts.some((row) => row.providerId === "grok"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("39 Owner prompts after milestone authorization = 0 for routine job", () => {
  const root = tempRoot();
  const io = files();
  try {
    const submitted = submitJob(request(root), {
      now: NOW,
      adapters: realAdapters(root, io),
      artifactRoot: root,
      writeFile: io.writeFile,
      readFile: io.readFile,
    });
    assert.equal(submitted.result.ownerPrompts, 0);
    assert.equal(submitted.result.finalState, "SUCCEEDED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("40 D2 remains certified", () => {
  assert.equal(D2_CERTIFIED_SHA_V1, "17b012b28d911fe563aab19f6e4a697a05b9b718");
});

test("41 OSA remains active", () => {
  const auth = defaultMvaAuthority({ actionKind: "SOURCE_EDIT", spendUsd: 0, productionWriter: "NO" });
  assert.equal(auth.outcome, "ALLOW_STANDING");
});

test("42 Provider Bridge remains functional", () => {
  const root = tempRoot();
  try {
    const decision = routeJob(buildJobEnvelope(request(root, { preferredProvider: null }), NOW), healthAll());
    assert.equal(decision.selected, "codex");
    const failover = executeWithFailover(buildJobEnvelope(request(root, { preferredProvider: null }), NOW), {
      adapters: {
        codex: createQuotaExhaustedAdapter("codex"),
        grok: {
          providerId: "grok",
          family: "grok",
          capabilities: defaultProviderCapabilities("grok"),
          execute: () => ({ class: "SUCCESS", leaseOutcome: "RELEASED", writerLiveness: "STOPPED", artifact: "x" }),
        },
        claude: unavailable("claude"),
        local: unavailable("local"),
      },
      health: healthAll(),
      writer: { holder: null, liveness: "STOPPED", leaseReleased: true },
      decideAuthority: () => ({ outcome: "ALLOW_STANDING", reason: "standing" }),
    });
    assert.deepEqual(failover.selectedTrail, ["codex", "grok"]);
    assert.equal(failover.ownerPrompts, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("e2e REAL_SINGLE_PROVIDER_JOB writes a real artifact", () => {
  const root = tempRoot();
  const artifactDir = join(root, "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  try {
    const submitted = submitJob(request(root), {
      now: NOW,
      artifactRoot: artifactDir,
      writeFile: (path, contents) => {
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, contents, "utf8");
      },
      readFile: (path) => readFileSync(path, "utf8"),
      adapters: {
        codex: unavailable("codex"),
        grok: unavailable("grok"),
        claude: unavailable("claude"),
        local: createRealBoundedExecutorAdapter("local", {
          artifactRoot: artifactDir,
          writeFile: (path, contents) => {
            writeFileSync(path, contents, "utf8");
          },
          readFile: (path) => readFileSync(path, "utf8"),
          startingSha: SHA,
        ...effectDeps(),
        }),
      },
    });
    assert.equal(submitted.result.finalState, "SUCCEEDED");
    assert.equal(submitted.result.selectedProvider, "local");
    assert.equal(submitted.result.workerLaunches, 1);
    const artifactPath = join(artifactDir, "mva-real-dispatch-v1.txt");
    const body = readFileSync(artifactPath, "utf8");
    assert.match(body, /AION_MVA_REAL_DISPATCH_V1/);
    assert.match(body, /JOB_ID = job-mva-1/);
    assert.match(body, /EXECUTOR = local/);
    assert.match(body, new RegExp(`MILESTONE = ${MVA_OWNER_AUTHORIZATION_ID}`));
    assert.equal(submitted.record.attempts.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("e2e REAL_FAILOVER_JOB second provider executes for real", () => {
  const root = tempRoot();
  const artifactDir = join(root, "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  try {
    const submitted = submitJob(request(root, { preferredProvider: null }), {
      now: NOW,
      artifactRoot: artifactDir,
      writeFile: (path, contents) => writeFileSync(path, contents, "utf8"),
      readFile: (path) => readFileSync(path, "utf8"),
      adapters: {
        codex: createQuotaExhaustedAdapter("codex"),
        grok: createRealBoundedExecutorAdapter("grok", {
          artifactRoot: artifactDir,
          writeFile: (path, contents) => writeFileSync(path, contents, "utf8"),
          readFile: (path) => readFileSync(path, "utf8"),
          startingSha: SHA,
        ...effectDeps(),
        }),
        claude: unavailable("claude"),
        local: unavailable("local"),
      },
    });
    assert.equal(submitted.result.finalState, "SUCCEEDED");
    assert.equal(submitted.result.ownerPrompts, 0);
    assert.equal(submitted.result.envelopeChanged, false);
    assert.equal(submitted.record.attempts[0]?.providerId, "codex");
    assert.equal(submitted.record.attempts[0]?.result, "QUOTA_EXHAUSTED");
    assert.equal(submitted.record.attempts[1]?.providerId, "grok");
    assert.equal(submitted.record.attempts[1]?.result, "SUCCESS");
    const body = readFileSync(join(artifactDir, "mva-real-dispatch-v1.txt"), "utf8");
    assert.match(body, /EXECUTOR = grok/);
    assert.match(body, /AION_MVA_REAL_DISPATCH_V1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("e2e RESTART_RECOVERY_JOB continues once", () => {
  const root = tempRoot();
  const store = createMemoryJobStore();
  try {
    const req = request(root, { jobId: "restart-1" });
    const createdOnly = buildJobEnvelope(req, NOW);
    store.save({
      schema: "aion.director.mvaDispatch.v1",
      jobId: "restart-1",
      milestoneId: "MVA-REAL-DISPATCH-V1",
      objective: req.objective,
      jobClass: "REPOSITORY_REVERSIBLE",
      authoritySource: "OWNER_STANDING_AUTHORITY_V1",
      ownerAuthorizationId: MVA_OWNER_AUTHORIZATION_ID,
      status: "AUTHORIZED",
      repository: root,
      worktree: root,
      allowedPaths: req.allowedPaths,
      startingSha: SHA,
      endingSha: null,
      envelope: createdOnly,
      attempts: [],
      activeAttemptId: null,
      activeProvider: null,
      leaseId: null,
      leaseReleased: true,
      writer: { holder: null, liveness: "STOPPED", leaseReleased: true },
      artifacts: [],
      verificationEvidence: [],
      externalEffectState: "NONE",
      retryBudgetRemaining: 4,
      failureReason: null,
      authorityDecision: "ALLOW_STANDING",
      ownerPrompts: 0,
      workerLaunches: 0,
      createdAt: NOW,
      updatedAt: NOW,
      health: healthAll(),
      takeover: null,
      bootstrapPath: null,
    });
    const artifactDir = join(root, "artifacts");
    mkdirSync(artifactDir, { recursive: true });
    const recovered = recoverJob("restart-1", req, {
      now: NOW,
      store,
      artifactRoot: artifactDir,
      writeFile: (path, contents) => writeFileSync(path, contents, "utf8"),
      readFile: (path) => readFileSync(path, "utf8"),
      adapters: {
        codex: unavailable("codex"),
        grok: unavailable("grok"),
        claude: unavailable("claude"),
        local: createRealBoundedExecutorAdapter("local", {
          artifactRoot: artifactDir,
          writeFile: (path, contents) => writeFileSync(path, contents, "utf8"),
          readFile: (path) => readFileSync(path, "utf8"),
          startingSha: SHA,
        ...effectDeps(),
        }),
      },
    });
    assert.equal(recovered.result.finalState, "SUCCEEDED");
    assert.equal(recovered.result.workerLaunches, 1);
    assert.equal(readFileSync(join(artifactDir, "mva-real-dispatch-v1.txt"), "utf8").includes("JOB_ID = restart-1"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("e2e HIGH_CONSEQUENCE_DENIAL launches no worker", () => {
  const root = tempRoot();
  const io = files();
  try {
    const submitted = submitJob(request(root, {
      jobId: "deny-prod",
      jobClass: "PRODUCTION_EXTERNAL_WRITE",
      externalEffects: ["PRODUCTION"],
    }), {
      now: NOW,
      adapters: realAdapters(root, io),
      writeFile: io.writeFile,
      readFile: io.readFile,
    });
    assert.equal(submitted.result.finalState, "DENIED");
    assert.equal(submitted.result.workerLaunches, 0);
    assert.equal(submitted.result.externalEffectState, "NONE");
    assert.equal(io.written.size, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("WORKTREE lease is acquired for the real job", () => {
  const root = tempRoot();
  try {
    const attempt = acquireLease({
      existing: [] as LeaseV1[],
      leaseId: "lease-job-mva-1",
      kind: "WORKTREE",
      resource: root,
      missionId: "MVA-REAL-DISPATCH-V1",
      runId: "job-mva-1:dispatch",
      now: NOW,
    });
    assert.equal(attempt.ok, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
