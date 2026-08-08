import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, CompositeBrainRuntimeV1, DeterministicClockV1, DeterministicIdGeneratorV1,
  DeterministicModelProviderV1, EVALUATION_SUITE, InMemoryStateRepositoryV1, InProcessBrainRuntimeV1,
  LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1, OFFLINE_ENDPOINT_ID,
  SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  buildEndpoint, compareEvaluations, floorBaseline, offlineEndpoint, scoreCase, summariseEvaluation,
} from "../src/index.js";
import type { BrainEndpointV1, BrainRuntimePortV1, EvaluationCaseResultV1 } from "../src/index.js";

/**
 * The floor benchmark. Everything here runs in this process against the deterministic provider:
 * no socket is opened, no endpoint address exists, and none is invented.
 */

const NOW = "2030-01-01T00:00:00.000Z";
const floor = offlineEndpoint(NOW);
const signal = () => new AbortController().signal;

function addressed(overrides: Record<string, unknown> = {}): BrainEndpointV1 {
  return buildEndpoint(
    { label: "Home GPU", runtime: "vllm", location: "owner-controlled-host", baseUrl: "https://gpu.invalid", model: "open-weights-large", ...overrides },
    { id: "endpoint-1", now: NOW, existing: [] },
  );
}

async function assistant(runtime?: BrainRuntimePortV1) {
  const root = await mkdtemp(join(tmpdir(), "aion-floor-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  return { service, runtime: runtime ?? new InProcessBrainRuntimeV1(new DeterministicModelProviderV1()) };
}

test("the floor is evaluated in this process, with no address invented for it", async () => {
  const adapter = new InProcessBrainRuntimeV1(new DeterministicModelProviderV1());
  assert.equal(floor.baseUrl, "", "the offline provider still has no address");
  assert.equal(adapter.supports(floor), true);

  const result = await adapter.complete(floor, { prompt: "Answer only with the word ACKNOWLEDGED.", context: [], signal: signal() });
  assert.ok(result.text.length > 0, "the provider actually answered");
  assert.ok(result.latencyMs >= 0);
  assert.match(result.text, /ACKNOWLEDGED/u, "it echoed the instruction through the deterministic path");
});

test("the in-process adapter refuses anything with an address, rather than pretending", async () => {
  const adapter = new InProcessBrainRuntimeV1(new DeterministicModelProviderV1());
  const gpu = addressed();
  assert.equal(adapter.supports(gpu), false);
  await assert.rejects(
    () => adapter.complete(gpu, { prompt: "x", context: [], signal: signal() }),
    /serves the offline provider only/iu,
  );
  assert.deepEqual(await adapter.detect(), [], "there is nothing to detect: the adapter is the provider");
});

test("the composite routes each endpoint to an adapter that can actually serve it", async () => {
  const inProcess = new InProcessBrainRuntimeV1(new DeterministicModelProviderV1());
  const http: BrainRuntimePortV1 = {
    supports: (endpoint) => endpoint.runtime !== "deterministic-offline" && Boolean(endpoint.baseUrl),
    probe: async () => ({ available: true, detail: "scripted", checkedAt: NOW, latencyMs: 5, installedModels: [] }),
    detect: async () => [{ runtime: "ollama" as const, baseUrl: "http://127.0.0.1:11434", models: [], detail: "scripted" }],
    complete: async () => ({ text: "from the transport adapter", latencyMs: 5 }),
  };
  const composite = new CompositeBrainRuntimeV1(inProcess, http);

  assert.equal(composite.supports(floor), true);
  assert.equal(composite.supports(addressed()), true);
  assert.match((await composite.complete(floor, { prompt: "hello", context: [], signal: signal() })).text, /Offline response/u);
  assert.equal((await composite.complete(addressed(), { prompt: "hello", context: [], signal: signal() })).text, "from the transport adapter");
  assert.equal((await composite.detect(signal())).length, 1, "detection spans every adapter");

  // An endpoint nothing can serve is refused by name. A silently skipped measurement looks
  // exactly like a passing one, which is the failure this prevents.
  const unreachable = { ...floor, runtime: "vllm" as const, baseUrl: "" };
  assert.equal(composite.supports(unreachable), false);
  await assert.rejects(() => composite.complete(unreachable, { prompt: "x", context: [], signal: signal() }), /No configured runtime adapter can reach/u);
  assert.throws(() => new CompositeBrainRuntimeV1(), /At least one brain runtime adapter/u);
});

test("the floor produces a real baseline across every declared dimension", async () => {
  const adapter = new InProcessBrainRuntimeV1(new DeterministicModelProviderV1());
  const results: EvaluationCaseResultV1[] = [];
  for (const evaluationCase of EVALUATION_SUITE) {
    const { text, latencyMs } = await adapter.complete(floor, { prompt: evaluationCase.prompt, context: evaluationCase.context, signal: signal() });
    results.push(scoreCase(evaluationCase, text, latencyMs));
  }
  const run = summariseEvaluation(results, {
    id: "floor-run", endpointId: OFFLINE_ENDPOINT_ID, endpointLabel: floor.label, model: floor.model,
    runtime: floor.runtime, location: floor.location, isFloor: true, startedAt: NOW, completedAt: NOW,
  });

  assert.equal(run.total, EVALUATION_SUITE.length, "every case ran");
  assert.equal(results.every((entry) => entry.error === null), true, "no case errored: the adapter reached the provider every time");
  assert.ok(run.byDimension.length >= 7, "the baseline spans the declared dimensions");
  for (const dimension of ["instruction-following", "structured-output", "planning", "memory-context", "tool-proposal", "hallucination-resistance", "code", "failure-behaviour"] as const) {
    assert.ok(run.byDimension.some((entry) => entry.dimension === dimension), `${dimension} has a baseline number`);
  }
  // The floor is not expected to score well. It is expected to produce an honest number, and to
  // say what it is, so a later comparison has something real to be measured against.
  assert.ok(run.passed >= 0 && run.passed <= run.total);
  assert.match(run.summary, /deterministic floor: the reference every other model is read against, not a competitor/u);
  assert.match(run.summary, /not the model in general/u);
});

test("the floor baseline is recorded, marked as the floor, and reloads", async () => {
  const { service, runtime } = await assistant();
  const results: EvaluationCaseResultV1[] = [];
  for (const evaluationCase of EVALUATION_SUITE) {
    const { text, latencyMs } = await runtime.complete(floor, { prompt: evaluationCase.prompt, context: evaluationCase.context, signal: signal() });
    results.push(scoreCase(evaluationCase, text, latencyMs));
  }
  const run = await service.recordEvaluation(OFFLINE_ENDPOINT_ID, results, NOW);

  assert.equal(run.isFloor, true);
  assert.equal(run.runtime, "deterministic-offline");
  assert.equal(run.location, "local-machine");
  const stored = await service.evaluations();
  assert.equal(floorBaseline(stored)?.id, run.id, "the floor is findable as the baseline");

  const snapshot = await service.snapshot();
  assert.equal(snapshot.evaluations[0]?.isFloor, true, "and it persists");
});

test("a comparison without a floor says so rather than presenting a bare number", () => {
  const make = (id: string, passed: number, isFloor: boolean) => summariseEvaluation(
    Array.from({ length: 10 }, (_, index) => ({ caseId: `c${index}`, dimension: "instruction-following" as const, passed: index < passed, latencyMs: 10, checks: [], excerpt: "", error: null })),
    { id: `run-${id}`, endpointId: id, endpointLabel: id, model: "m", runtime: "ollama", location: "local-machine", isFloor, startedAt: NOW, completedAt: NOW },
  );

  const orphan = compareEvaluations([make("local", 7, false)]);
  assert.match(orphan[0]!.versusFloor, /no floor baseline recorded/u);

  const withFloor = compareEvaluations([make("local", 7, false), make("floor", 3, true)]);
  const local = withFloor.find((entry) => entry.endpointId === "local")!;
  const baseline = withFloor.find((entry) => entry.endpointId === "floor")!;
  assert.equal(local.versusFloor, "+4 case(s) against the floor");
  assert.equal(baseline.versusFloor, "this is the floor");
  assert.equal(baseline.isFloor, true);
  assert.equal(local.location, "local-machine");
});

test("evaluating the floor sends it the fixture context, not AION's Memory", async () => {
  const { service, runtime } = await assistant();
  await service.createMemory({ content: "A private thing the owner recorded", category: "semantic" });

  const memoryCase = EVALUATION_SUITE.find((entry) => entry.id === "memory.uses-supplied-context")!;
  const { text } = await runtime.complete(floor, { prompt: memoryCase.prompt, context: memoryCase.context, signal: signal() });
  assert.doesNotMatch(text, /A private thing the owner recorded/u, "the harness supplies its own context and nothing else");
  assert.match(text, /I used 2 enabled local memory record\(s\)/u, "and exactly the two fixture context entries reached the provider");
});
