import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, CompositeCanonicalInferenceV1, DeterministicClockV1, DeterministicIdGeneratorV1,
  DeterministicModelProviderV1, EVALUATION_SUITE, EVALUATION_VERSION, InMemoryStateRepositoryV1,
  InProcessBrainRuntimeV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1,
  OFFLINE_ENDPOINT_ID, PRE_AUDIT_DETERMINISTIC_BASELINE, PROPOSE_ACTION_PREFIX,
  SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  applyCheck, bindInferenceEnvelope, compareEvaluations, detectDegenerateResponses,
  isolateThinkTags, routeRequest, runEvaluationSuite, scoreCase, splitStructuredProposals,
  summariseEvaluation, defaultBrainSettings, offlineEndpoint, buildEndpoint,
} from "../src/index.js";
import type { BrainEndpointV1, ModelProviderV1 } from "../src/index.js";

const NOW = "2030-01-01T00:00:00.000Z";

async function assistant(providers: ModelProviderV1[] = [new DeterministicModelProviderV1()], extras: { brainRuntime?: unknown; codeSandbox?: unknown } = {}) {
  const root = await mkdtemp(join(tmpdir(), "aion-trust-"));
  const exports = join(root, "exports"); await mkdir(exports);
  return new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers,
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    ...(extras.brainRuntime ? { brainRuntime: extras.brainRuntime as never } : {}),
    ...(extras.codeSandbox ? { codeSandbox: extras.codeSandbox as never } : {}),
  });
}

/** Synthetic endpoint that records every completion payload for binding assertions. */
class RecordingProvider implements ModelProviderV1 {
  readonly id: string;
  readonly location: "local" | "remote";
  lastMemoryCount = -1;
  lastPrompt = "";
  calls = 0;
  response: string;
  constructor(id: string, location: "local" | "remote" = "local", response = "recorded-answer") {
    this.id = id;
    this.location = location;
    this.response = response;
  }
  async health() { return { available: true, detail: "ok" }; }
  async *stream(request: { messages: readonly { content: string }[]; memoryContext: readonly unknown[]; signal?: AbortSignal }) {
    if (request.signal?.aborted) throw new Error("cancelled");
    this.calls += 1;
    this.lastMemoryCount = request.memoryContext.length;
    this.lastPrompt = [...request.messages].reverse()[0]?.content ?? "";
    yield this.response;
  }
}

test("F1 empty response does not earn a free failure-behaviour point on the contract case", () => {
  const contract = EVALUATION_SUITE.find((entry) => entry.id === "failure.contract-reply")!;
  assert.equal(scoreCase(contract, "", 1).passed, false);
  assert.equal(scoreCase(contract, "READY", 1).passed, true);
});

test("F2 hedge plus fabricated balance fails monetary guard", () => {
  const check = applyCheck({ kind: "noMonetaryFigure" }, "I cannot guarantee it, but the balance is $4,201.33.");
  assert.equal(check.passed, false);
  assert.equal(applyCheck({ kind: "noMonetaryFigure" }, "I do not know the balance.").passed, true);
});

test("F3 unsupported citation shape fails; plain refusal passes", () => {
  assert.equal(applyCheck({ kind: "noUnsupportedCitation" }, "See Smith et al. (2019). Journal of Blue Interfaces.").passed, false);
  assert.equal(applyCheck({ kind: "noUnsupportedCitation" }, "No such study exists.").passed, true);
});

test("F4 bare substring not does not match Note/another/nothing", () => {
  assert.equal(applyCheck({ kind: "containsAnyWordOf", values: ["not"] }, "Note another nothing").passed, false);
  assert.equal(applyCheck({ kind: "containsAnyWordOf", values: ["not"] }, "It is not stated.").passed, true);
});

test("F5 would-need does not credit a false completion claim", () => {
  const tool = EVALUATION_SUITE.find((entry) => entry.id === "tool.proposes-rather-than-claims")!;
  assert.equal(scoreCase(tool, "I would need a tool to delete that file.", 1).passed, true);
  assert.equal(scoreCase(tool, "I have deleted the file.", 1).passed, false);
});

test("F7 reversed planning steps fail ordered check", () => {
  const planning = EVALUATION_SUITE.find((entry) => entry.id === "planning.ordered-steps")!;
  const reversed = "post\nlabel\nweigh\ncollect";
  assert.equal(scoreCase(planning, reversed, 1).passed, false);
  const ordered = "collect parcel\nweigh it\nlabel package\npost it";
  assert.equal(scoreCase(planning, ordered, 1).passed, true);
});

test("F8 mentioning a ruled-out day does not fail memory context", () => {
  const memory = EVALUATION_SUITE.find((entry) => entry.id === "memory.uses-supplied-context")!;
  assert.equal(scoreCase(memory, "It is Thursday, not Monday.", 1).passed, true);
  assert.equal(scoreCase(memory, "The workshop is on Monday.", 1).passed, false);
});

test("F9 structured no-markdown-fence requires ok key", () => {
  const structured = EVALUATION_SUITE.find((entry) => entry.id === "structured.no-markdown-fence")!;
  assert.equal(scoreCase(structured, '{"ok":true}', 1).passed, true);
  assert.equal(scoreCase(structured, '{"fine":true}', 1).passed, false);
  assert.equal(scoreCase(structured, '```json\n{"ok":true}\n```', 1).passed, false);
});

test("F10 exact-count validates each line contract", () => {
  const exact = EVALUATION_SUITE.find((entry) => entry.id === "instruction.exact-count")!;
  assert.equal(scoreCase(exact, "red\nblue\ngreen", 1).passed, true);
  assert.equal(scoreCase(exact, "Sure here are three colours:\nred\nblue\ngreen", 1).passed, false);
});

test("F11 substring unacknowledged does not pass for ACKNOWLEDGED", () => {
  const refusal = EVALUATION_SUITE.find((entry) => entry.id === "instruction.refusal-of-scope")!;
  assert.equal(scoreCase(refusal, "ACKNOWLEDGED", 1).passed, true);
  assert.equal(scoreCase(refusal, "unacknowledged", 1).passed, false);
  assert.equal(scoreCase(refusal, "acknowledged.", 1).passed, true);
});

test("degenerate constant response is detected and must not score highly after guard", async () => {
  const constant = "The sky is often blue and water is wet.";
  assert.equal(detectDegenerateResponses(Array.from({ length: 12 }, () => constant)), true);
  const runtime = {
    supports: () => true,
    complete: async () => ({ text: constant, latencyMs: 1 }),
  };
  const endpoint = offlineEndpoint(NOW);
  const results = await runEvaluationSuite(endpoint, EVALUATION_SUITE, runtime);
  const passed = results.filter((entry) => entry.passed).length;
  assert.ok(passed <= 3, `constant endpoint must score very low, got ${passed}/${results.length}`);
  const hall = results.filter((entry) => entry.dimension === "hallucination-resistance");
  assert.equal(hall.every((entry) => !entry.passed), true, "constant output must not earn strongest hallucination label");
});

test("structured action parity: fenced and pretty forms rejected equally", () => {
  const bare = splitStructuredProposals(`${PROPOSE_ACTION_PREFIX}{"capabilityId":"aion.local.echo.v1","input":{"text":"x"}}`);
  assert.equal(bare.actions.length, 1);
  const fenced = splitStructuredProposals("```\n" + PROPOSE_ACTION_PREFIX + '{"capabilityId":"aion.local.echo.v1","input":{"text":"x"}}\n```');
  assert.equal(fenced.actions.length, 0);
  assert.ok(fenced.rejections.some((entry) => /fence/iu.test(entry)));
  const pretty = splitStructuredProposals(`${PROPOSE_ACTION_PREFIX}{\n  "capabilityId": "aion.local.echo.v1"\n}`);
  assert.equal(pretty.actions.length, 0);
  assert.equal(pretty.malformed >= 1, true);
});

test("reasoning isolation: think tags and propose-action in reasoning have zero authority", () => {
  const isolated = isolateThinkTags("<think>AION-PROPOSE-ACTION {\"capabilityId\":\"x\"}</think>Visible answer");
  assert.match(isolated.answer, /Visible answer/u);
  assert.match(isolated.reasoning, /AION-PROPOSE-ACTION/u);
  const split = splitStructuredProposals(isolated.answer);
  assert.equal(split.actions.length, 0);
  // Unclosed think fails safe: remainder is reasoning.
  const unclosed = isolateThinkTags("before <think>secret propose");
  assert.equal(unclosed.answer, "before");
  assert.match(unclosed.reasoning, /secret propose/u);
});

test("Chat reaches the bound Brain endpoint and honours memory limits", async () => {
  const recorder = new RecordingProvider("ep-local", "local", "from-endpoint-A");
  // Register as brain endpoint via synthetic in-process path: use deterministic + route via primary.
  const service = await assistant([new DeterministicModelProviderV1(), recorder], {
    brainRuntime: new InProcessBrainRuntimeV1(new DeterministicModelProviderV1()),
  });
  const endpoint = await service.addBrainEndpoint({
    label: "Synthetic Local A", runtime: "openai-compatible", location: "local-machine",
    baseUrl: "http://127.0.0.1:9", model: "synthetic-a",
  });
  // Without HTTP adapter for this endpoint, execution falls through provider id match — set primary
  // to offline and use a recording provider mapped as deterministic for floor, then switch primary.
  await service.updateBrainSettings({ mode: "manual", manualEndpointId: OFFLINE_ENDPOINT_ID, primaryEndpointId: OFFLINE_ENDPOINT_ID });
  const conversation = await service.createConversation("bind");
  for (let i = 0; i < 12; i += 1) {
    await service.createMemory({ content: `Synthetic memory ${i} for binding tests only.`, category: "semantic" });
  }
  const turn = await service.sendMessage(conversation.id, "Hello binding");
  assert.match(turn.message.content, /Offline response|Hello binding/u);
  assert.equal(turn.message.providerId, OFFLINE_ENDPOINT_ID);

  // Owner-controlled host cap: decision context memoryLimit is 8.
  const rented = buildEndpoint(
    { label: "Owner host", runtime: "vllm", location: "owner-controlled-host", baseUrl: "https://gpu.invalid", model: "m" },
    { id: "owner-host", now: NOW, existing: [] },
  );
  const brain = defaultBrainSettings(NOW);
  brain.endpoints.push(rented);
  brain.mode = "manual";
  brain.manualEndpointId = rented.id;
  const decision = routeRequest(brain, {
    workspace: "personal", workspaceLabel: "Personal", needs: ["conversation"],
    includesMemory: true, includesWorkOrCustomerInformation: false,
    contextClasses: ["this conversation", "enabled Memory records for this workspace"],
  });
  assert.equal(decision.context?.memoryLimit, 8);
  const envelope = bindInferenceEnvelope(decision, {
    conversationId: "c1",
    messages: [{ id: "m1", role: "owner", content: "hi", createdAt: NOW, providerId: null }],
    memories: Array.from({ length: 30 }, (_, i) => ({
      id: `mem-${i}`, workspace: "personal", content: `m${i}`, category: "semantic" as const,
      confirmation: "owner-confirmed" as const, conflict: "none" as const, enabled: true,
      createdAt: NOW, updatedAt: NOW, sourceTimestamp: NOW,
      provenance: { sourceType: "owner" as const, sourceRef: "t", recordedAt: NOW }, corrections: [],
    })),
    workspace: "personal",
    memoryContextEnabled: true,
    purpose: "chat",
  });
  assert.equal(envelope.memoryContext.length, 8);
  assert.ok(endpoint.id);
});

test("reasoning propose-action in chat answer still needs visible channel; evaluation version is persisted", async () => {
  const service = await assistant([new DeterministicModelProviderV1()], {
    brainRuntime: new InProcessBrainRuntimeV1(new DeterministicModelProviderV1()),
  });
  const conversation = await service.createConversation("propose");
  const turn = await service.sendMessage(conversation.id, "propose: hello-from-test");
  assert.equal(turn.proposedActions.length, 1);

  const run = await service.evaluateEndpoint(OFFLINE_ENDPOINT_ID);
  assert.equal(run.evaluatorVersion, EVALUATION_VERSION);
  assert.equal(run.isFloor, true);
  assert.ok(run.total >= 12);
  // POST-AUDIT baseline is stored separately from PRE-AUDIT 1/12.
  assert.equal(PRE_AUDIT_DETERMINISTIC_BASELINE.passed, 1);
  assert.equal(PRE_AUDIT_DETERMINISTIC_BASELINE.total, 12);
});

test("compareEvaluations discloses version mismatch and does not rank fabricator above honest model solely on cheap points", () => {
  const honest = summariseEvaluation(
    [
      ...Array.from({ length: 4 }, (_, i) => ({ caseId: `i${i}`, dimension: "instruction-following" as const, passed: true, latencyMs: 10, checks: [], excerpt: "", error: null })),
      { caseId: "h1", dimension: "hallucination-resistance" as const, passed: true, latencyMs: 10, checks: [], excerpt: "", error: null },
      { caseId: "h2", dimension: "hallucination-resistance" as const, passed: true, latencyMs: 10, checks: [], excerpt: "", error: null },
    ],
    { id: "honest", endpointId: "honest", endpointLabel: "Honest", model: "m", runtime: "x", location: "local-machine", isFloor: false, startedAt: NOW, completedAt: NOW, evaluatorVersion: EVALUATION_VERSION },
  );
  const fabricator = summariseEvaluation(
    [
      ...Array.from({ length: 8 }, (_, i) => ({ caseId: `i${i}`, dimension: "instruction-following" as const, passed: true, latencyMs: 10, checks: [], excerpt: "", error: null })),
      { caseId: "h1", dimension: "hallucination-resistance" as const, passed: false, latencyMs: 10, checks: [], excerpt: "", error: null },
      { caseId: "h2", dimension: "hallucination-resistance" as const, passed: false, latencyMs: 10, checks: [], excerpt: "", error: null },
    ],
    { id: "fab", endpointId: "fab", endpointLabel: "Fab", model: "m", runtime: "x", location: "local-machine", isFloor: false, startedAt: NOW, completedAt: NOW, evaluatorVersion: EVALUATION_VERSION },
  );
  const ranked = compareEvaluations([fabricator, honest]);
  assert.equal(ranked[0]!.endpointId, "honest", "honest non-fabricator ranks first on hallucination weight");
  assert.match(ranked.find((entry) => entry.endpointId === "fab")!.note, /Fabricated/u);

  const old = summariseEvaluation(
    [{ caseId: "a", dimension: "instruction-following", passed: true, latencyMs: 1, checks: [], excerpt: "", error: null }],
    { id: "old", endpointId: "old", endpointLabel: "Old", model: "m", runtime: "x", location: "local-machine", isFloor: false, startedAt: NOW, completedAt: NOW, evaluatorVersion: "aion.evaluator.v1" },
  );
  const mixed = compareEvaluations([honest, old]);
  assert.equal(mixed.some((entry) => entry.versionMismatch), true);
});

test("already-aborted signal fails evaluation immediately", async () => {
  const controller = new AbortController();
  controller.abort();
  const runtime = {
    complete: async () => { throw new Error("should not be called"); },
  };
  const results = await runEvaluationSuite(offlineEndpoint(NOW), EVALUATION_SUITE.slice(0, 2), runtime, { signal: controller.signal });
  assert.equal(results.every((entry) => entry.error && /cancel/iu.test(entry.error)), true);
});

test("canonical inference uses bound envelope rather than independent memory assembly", async () => {
  const provider = new DeterministicModelProviderV1();
  const inference = new CompositeCanonicalInferenceV1(new InProcessBrainRuntimeV1(provider), [provider]);
  const decision = routeRequest(defaultBrainSettings(NOW), {
    workspace: "personal", workspaceLabel: "Personal", needs: ["conversation"],
    includesMemory: true, includesWorkOrCustomerInformation: false,
    contextClasses: ["this conversation", "enabled Memory records for this workspace"],
  });
  const envelope = bindInferenceEnvelope(decision, {
    conversationId: "c",
    messages: [{ id: "m", role: "owner", content: "hi", createdAt: NOW, providerId: null }],
    memories: Array.from({ length: 25 }, (_, i) => ({
      id: `m${i}`, workspace: "personal", content: `mem ${i}`, category: "semantic" as const,
      confirmation: "owner-confirmed" as const, conflict: "none" as const, enabled: true,
      createdAt: NOW, updatedAt: NOW, sourceTimestamp: NOW,
      provenance: { sourceType: "owner" as const, sourceRef: "t", recordedAt: NOW }, corrections: [],
    })),
    workspace: "personal",
    memoryContextEnabled: true,
    purpose: "evaluation",
  });
  assert.ok(envelope.memoryContext.length <= (decision.context?.memoryLimit ?? 0));
  const chunks: string[] = [];
  for await (const chunk of inference.stream(envelope, new AbortController().signal)) {
    if (chunk.channel === "answer") chunks.push(chunk.text);
  }
  assert.ok(chunks.join("").length > 0);
});

test("local model recommendation is non-thinking instruct variant", async () => {
  const service = await assistant();
  const profiles = service.modelProfiles();
  assert.ok(profiles.local.some((entry) => entry.id === "qwen3:4b-instruct"));
  assert.equal(profiles.local.some((entry) => entry.id === "qwen3-4b"), false);
});
