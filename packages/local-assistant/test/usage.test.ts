import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  InMemoryStateRepositoryV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  V13_BUDGET_CEILING_CENTS, buildUsage, costIntelligence, usageSummary,
} from "../src/index.js";
import type { GpuSessionV1, InferenceUsageV1 } from "../src/index.js";

const NOW = "2030-01-01T00:00:00.000Z";

function usage(overrides: Partial<InferenceUsageV1> = {}): InferenceUsageV1 {
  return {
    id: "u1", at: NOW, tier: "local-model", endpointId: "e1", model: "m", category: "chat",
    durationMs: 100, promptTokens: null, completionTokens: null, estimatedCents: null, succeeded: true,
    ...overrides,
  };
}
function session(minutes: number, cents: number, index: number): GpuSessionV1 {
  return {
    id: `s${index}`, provider: "synthetic", proposalId: `p${index}`, instanceRef: `i${index}`, state: "stopped",
    gpuName: "RTX 4090", vramGb: 24, modelId: "m", runtime: "vllm", endpointId: null,
    hourlyCents: 40, maxRuntimeMinutes: 600, maxSpendCents: 1000, idleTimeoutMinutes: 10,
    hardStopAt: NOW, startedAt: NOW, stoppedAt: NOW, lastActivityAt: NOW,
    measuredMinutes: minutes, estimatedCents: cents, teardownConfirmed: true, events: [],
  };
}

async function assistant() {
  const root = await mkdtemp(join(tmpdir(), "aion-usage-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  return new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
}

test("a token count is recorded only when the runtime reported one", () => {
  const reported = buildUsage({ tier: "owner-gpu", durationMs: 900, promptTokens: 120, completionTokens: 340 }, { id: "u1", now: NOW });
  assert.equal(reported.promptTokens, 120);
  assert.equal(reported.completionTokens, 340);

  const silent = buildUsage({ tier: "local-model", durationMs: 900 }, { id: "u2", now: NOW });
  assert.equal(silent.promptTokens, null, "no count is invented from character lengths");
  assert.equal(silent.completionTokens, null);
  assert.equal(silent.estimatedCents, null, "and no cost is invented where no rate was known");

  assert.throws(() => buildUsage({ tier: "local-model" }, { id: "u3", now: NOW }), /duration in whole milliseconds/u);
  assert.equal(buildUsage({ durationMs: 1, category: "nonsense" }, { id: "u4", now: NOW }).category, "other");
});

test("tier totals report only what was measured", () => {
  const records = [
    usage({ id: "a", tier: "deterministic-floor", durationMs: 1 }),
    usage({ id: "b", tier: "local-model", durationMs: 200 }),
    usage({ id: "c", tier: "local-model", durationMs: 400, succeeded: false }),
    usage({ id: "d", tier: "owner-gpu", durationMs: 800, promptTokens: 100, completionTokens: 50, estimatedCents: 3 }),
  ];
  const result = costIntelligence(records, [], V13_BUDGET_CEILING_CENTS);
  const local = result.byTier.find((entry) => entry.tier === "local-model")!;
  assert.equal(local.requests, 2);
  assert.equal(local.failures, 1);
  assert.equal(local.medianDurationMs, 300);
  assert.equal(local.totalTokens, null, "no runtime in this tier reported tokens, so the total is null rather than zero");

  const gpu = result.byTier.find((entry) => entry.tier === "owner-gpu")!;
  assert.equal(gpu.totalTokens, 150);
  assert.equal(gpu.totalCents, 3);
  assert.equal(result.byTier.some((entry) => entry.tier === "third-party"), false, "a tier with no usage is not listed as zero");
});

test("AION refuses to recommend buying hardware on thin evidence, and says why", () => {
  const thin = costIntelligence([], [session(20, 15, 1), session(25, 18, 2)], V13_BUDGET_CEILING_CENTS);
  assert.equal(thin.verdict.decidable, false);
  assert.equal(thin.verdict.recommendation, "not-enough-evidence");
  assert.match(thin.verdict.detail, /worth hundreds of pounds, and AION will not recommend it on this/u);
  assert.match(thin.verdict.detail, /at least 5 sessions and 3 hours/u);
  assert.match(thin.verdict.detail, /say the same thing until it has them/u);

  const none = costIntelligence([], [], V13_BUDGET_CEILING_CENTS);
  assert.equal(none.verdict.recommendation, "not-enough-evidence");
  assert.equal(none.gpuSessions, 0);
});

test("with enough measured use it gives a reading, and names what it did not measure", () => {
  const modest = costIntelligence([], Array.from({ length: 6 }, (_, index) => session(35, 24, index)), V13_BUDGET_CEILING_CENTS);
  assert.equal(modest.verdict.decidable, true);
  assert.equal(modest.verdict.recommendation, "keep-renting");
  assert.equal(modest.gpuMinutes, 210);
  assert.match(modest.verdict.detail, /well below the point where owning hardware is cheaper/u);

  const heavy = costIntelligence([], Array.from({ length: 8 }, (_, index) => session(200, 130, index)), V13_BUDGET_CEILING_CENTS);
  assert.equal(heavy.verdict.recommendation, "consider-buying");
  assert.match(heavy.verdict.detail, /work out your own break-even/u);
  assert.match(heavy.verdict.detail, /AION measured usage, not resale value or electricity/u, "it names its own blind spots");
});

test("the summary says where work actually happens rather than where anyone guessed", () => {
  const empty = costIntelligence([], [], V13_BUDGET_CEILING_CENTS);
  assert.match(usageSummary(empty), /nothing to conclude about where your work happens/u);

  const mixed = costIntelligence(
    [usage({ id: "a", tier: "deterministic-floor" }), usage({ id: "b", tier: "deterministic-floor" }), usage({ id: "c", tier: "owner-gpu", estimatedCents: 5 })],
    [session(10, 5, 1)],
    V13_BUDGET_CEILING_CENTS,
  );
  const summary = usageSummary(mixed);
  assert.match(summary, /3 recorded request\(s\)/u);
  assert.match(summary, /deterministic-floor 2 \(67%\)/u);
  assert.match(summary, /5 cent\(s\) of rented GPU time/u);
});

test("usage records persist and drive the service reading", async () => {
  const service = await assistant();
  const empty = await service.costIntelligence();
  assert.equal(empty.verdict.recommendation, "not-enough-evidence");

  await service.recordUsage({ tier: "deterministic-floor", endpointId: "deterministic-offline", model: "aion-offline-v1", category: "routing", durationMs: 2 });
  await service.recordUsage({ tier: "local-model", endpointId: "e1", model: "qwen3-8b", category: "chat", durationMs: 1200, promptTokens: 50, completionTokens: 80 });

  const intelligence = await service.costIntelligence();
  assert.equal(intelligence.byTier.length, 2);
  assert.equal((await service.snapshot()).usage.length, 2, "records persist");
  assert.match(intelligence.summary, /2 recorded request\(s\)/u);
  assert.equal(intelligence.budgetUsedCents, 0, "nothing has been spent");
});
