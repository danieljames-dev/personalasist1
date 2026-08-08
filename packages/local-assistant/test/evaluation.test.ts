import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  EVALUATION_DIMENSIONS, EVALUATION_SUITE, InMemoryStateRepositoryV1, LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1, NodePrivateBackupV1, SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  applyCheck, compareEvaluations, scoreCase, summariseEvaluation,
} from "../src/index.js";
import type { EvaluationCaseResultV1 } from "../src/index.js";

/** The harness is pure scoring. No endpoint is contacted anywhere in this suite. */

const NOW = "2030-01-01T00:00:00.000Z";

async function assistant() {
  const root = await mkdtemp(join(tmpdir(), "aion-eval-test-"));
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

test("every check is mechanical: it either holds or it does not", () => {
  assert.equal(applyCheck({ kind: "contains", value: "Thursday" }, "It is on thursday.").passed, true);
  assert.equal(applyCheck({ kind: "contains", value: "Thursday" }, "It is on Friday.").passed, false);
  assert.equal(applyCheck({ kind: "excludes", value: "```" }, '{"ok":true}').passed, true);
  assert.equal(applyCheck({ kind: "excludes", value: "```" }, '```json\n{"ok":true}\n```').passed, false);
  assert.equal(applyCheck({ kind: "containsAnyOf", values: ["cannot", "unable"] }, "I am unable to know that.").passed, true);
  assert.equal(applyCheck({ kind: "containsAnyOf", values: ["cannot", "unable"] }, "It is $4,201.33.").passed, false);
  assert.equal(applyCheck({ kind: "isJsonObject" }, '{"a":1}').passed, true);
  assert.equal(applyCheck({ kind: "isJsonObject" }, "[1,2]").passed, false, "an array is not an object");
  assert.equal(applyCheck({ kind: "isJsonObject" }, "Here you go: {}").passed, false, "prose around JSON is a parse failure");
  assert.equal(applyCheck({ kind: "jsonHasKeys", keys: ["title", "steps"] }, '{"title":"x","steps":[]}').passed, true);
  const missing = applyCheck({ kind: "jsonHasKeys", keys: ["title", "steps"] }, '{"title":"x"}');
  assert.equal(missing.passed, false);
  assert.match(missing.detail, /missing key\(s\): steps/u);
  assert.equal(applyCheck({ kind: "lineCountAtMost", value: 3 }, "red\nblue\ngreen").passed, true);
  assert.equal(applyCheck({ kind: "lineCountAtMost", value: 3 }, "Sure!\nred\nblue\ngreen").passed, false);
  assert.equal(applyCheck({ kind: "lineCountAtLeast", value: 3 }, "red\n\nblue").passed, false, "blank lines do not count");
  assert.equal(applyCheck({ kind: "maxCharacters", value: 10 }, "ACKNOWLEDGED").passed, false);
});

test("a case passes only when every one of its checks holds", () => {
  const structured = EVALUATION_SUITE.find((entry) => entry.id === "structured.json-object")!;
  assert.equal(scoreCase(structured, '{"title":"Plan","steps":["one"]}', 12).passed, true);
  const partial = scoreCase(structured, '{"title":"Plan"}', 12);
  assert.equal(partial.passed, false);
  assert.equal(partial.checks.filter((check) => check.passed).length, 1, "the JSON parsed but a key was missing");
  assert.equal(partial.excerpt, '{"title":"Plan"}', "the response is kept so a failure can be understood later");
});

test("an endpoint that errors is recorded as a failure with the reason, not skipped", () => {
  const first = EVALUATION_SUITE[0]!;
  const failed = scoreCase(first, "", 4001, "it did not answer within 4000 ms");
  assert.equal(failed.passed, false);
  assert.equal(failed.error, "it did not answer within 4000 ms");
  assert.deepEqual(failed.checks, [], "no check was reached, and none is claimed to have passed");
  assert.equal(failed.latencyMs, 4001, "how slowly it failed is part of the evidence");
});

test("the fixture suite is synthetic and safe to send to a third-party endpoint", () => {
  const serialized = JSON.stringify(EVALUATION_SUITE);
  assert.doesNotMatch(serialized, /[\w.+-]+@[\w-]+\.[a-z]{2,}/iu, "no email address");
  assert.doesNotMatch(serialized, /[A-Za-z]:\\Users\\/u, "no machine path");
  assert.doesNotMatch(serialized, /\b\d{3}-\d{2}-\d{4}\b/u, "nothing identity-shaped");
  assert.equal(EVALUATION_SUITE.every((entry) => entry.checks.length > 0 && entry.rationale.length > 20), true, "every case declares checks and explains itself");
  assert.equal(new Set(EVALUATION_SUITE.map((entry) => entry.id)).size, EVALUATION_SUITE.length, "case identifiers are unique");
  for (const dimension of ["hallucination-resistance", "structured-output", "memory-context", "instruction-following"] as const) {
    assert.ok(EVALUATION_SUITE.some((entry) => entry.dimension === dimension), `${dimension} is covered`);
  }
  assert.equal(EVALUATION_SUITE.every((entry) => EVALUATION_DIMENSIONS.includes(entry.dimension)), true);
});

test("the summary reports what the run establishes and names the weakest dimension", () => {
  const results: EvaluationCaseResultV1[] = [
    { caseId: "a", dimension: "instruction-following", passed: true, latencyMs: 10, checks: [], excerpt: "", error: null },
    { caseId: "b", dimension: "instruction-following", passed: true, latencyMs: 20, checks: [], excerpt: "", error: null },
    { caseId: "c", dimension: "hallucination-resistance", passed: false, latencyMs: 30, checks: [], excerpt: "", error: null },
    { caseId: "d", dimension: "hallucination-resistance", passed: false, latencyMs: 40, checks: [], excerpt: "", error: null },
  ];
  const run = summariseEvaluation(results, { id: "run-1", endpointId: "e1", endpointLabel: "Local model", model: "open-weights-small", startedAt: NOW, completedAt: NOW });
  assert.equal(run.passed, 2);
  assert.equal(run.total, 4);
  assert.equal(run.medianLatencyMs, 25);
  assert.match(run.summary, /Weakest dimension: hallucination-resistance at 0\/2/u);
  assert.match(run.summary, /not the model in general/u, "the claim is scoped to the fixtures and the day");
  assert.deepEqual(run.byDimension.map((entry) => entry.dimension), ["instruction-following", "hallucination-resistance"]);
});

test("a high score with a fabrication failure is called out rather than averaged away", () => {
  const make = (endpointId: string, label: string, passed: number, hallucinationPassed: number) => summariseEvaluation(
    [
      ...Array.from({ length: passed }, (_, index) => ({ caseId: `p${index}`, dimension: "instruction-following" as const, passed: true, latencyMs: 10, checks: [], excerpt: "", error: null })),
      { caseId: "h1", dimension: "hallucination-resistance" as const, passed: hallucinationPassed > 0, latencyMs: 10, checks: [], excerpt: "", error: null },
    ],
    { id: `run-${endpointId}`, endpointId, endpointLabel: label, model: "m", startedAt: NOW, completedAt: NOW },
  );
  const comparison = compareEvaluations([make("weak", "Careful model", 3, 1), make("flashy", "Confident model", 8, 0)]);
  const flashy = comparison.find((entry) => entry.endpointId === "flashy")!;
  const careful = comparison.find((entry) => entry.endpointId === "weak")!;
  assert.match(flashy.note, /Fabricated an answer it had no way to know/u);
  assert.equal(flashy.hallucinationResistance, "0/1");
  assert.match(careful.note, /No fabrication observed/u);
  assert.equal(careful.hallucinationResistance, "1/1");
});

test("a recorded run is evidence attached to an endpoint and survives in state", async () => {
  const service = await assistant();
  const endpoint = await service.addBrainEndpoint({
    label: "Home GPU", runtime: "vllm", location: "owner-controlled-host",
    baseUrl: "https://gpu.invalid", model: "open-weights-large",
    capabilities: { reasoning: true, structuredJson: true, contextTokens: 32_768 },
  });
  const results = EVALUATION_SUITE.map((entry, index) => scoreCase(entry, index % 2 === 0 ? "ACKNOWLEDGED" : "", 15));
  const run = await service.recordEvaluation(endpoint.id, results, NOW);

  assert.equal(run.endpointLabel, "Home GPU");
  assert.equal(run.model, "open-weights-large");
  assert.equal(run.total, EVALUATION_SUITE.length);
  const stored = await service.evaluations();
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.id, run.id);

  const comparison = await service.modelComparison();
  assert.equal(comparison.length, 1);
  assert.equal(comparison[0]?.endpointId, endpoint.id);

  await assert.rejects(() => service.recordEvaluation("no-such-endpoint", results, NOW), /was not found/iu);
});

test("only the most recent run per endpoint is compared", async () => {
  const service = await assistant();
  const endpoint = await service.addBrainEndpoint({ label: "Home GPU", runtime: "vllm", location: "owner-controlled-host", baseUrl: "https://gpu.invalid", model: "m1" });
  const failing = EVALUATION_SUITE.map((entry) => scoreCase(entry, "", 10));
  const passing = EVALUATION_SUITE.map((entry) => scoreCase(entry, "ACKNOWLEDGED", 10));
  await service.recordEvaluation(endpoint.id, failing, NOW);
  const latest = await service.recordEvaluation(endpoint.id, passing, NOW);

  const comparison = await service.modelComparison();
  assert.equal(comparison.length, 1, "one endpoint, one entry");
  assert.equal(comparison[0]?.passed, latest.passed, "the newer run is the one that counts");
  assert.equal((await service.evaluations()).length, 2, "both runs are kept as history");
});
