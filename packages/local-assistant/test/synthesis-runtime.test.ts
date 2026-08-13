/**
 * Model synthesis through the real Chat runtime.
 *
 * The validators are already tested in isolation. What these prove is the seam: that a model is
 * genuinely invoked, that its words reach the Owner when they are grounded, and that the measured
 * failure is stopped by the runtime rather than only by a unit test.
 *
 * The port is faked rather than calling Ollama, so this stays in the fast suite and fails only for
 * reasons that belong to AION. The real models are exercised by the explicit benchmark instead —
 * putting a multi-gigabyte model on the critical path of every `npm test` is how a suite stops
 * being run.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryStateRepositoryV1, DeterministicClockV1, DeterministicIdGeneratorV1,
  DeterministicModelProviderV1, StaticCapabilityRegistryV1, LocalEchoCapabilityV1,
  LocalArchiveImportSourceV1, NodePrivateBackupV1, SelectableDeveloperAgentRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../src/adapters.js";
import { AionAssistantV1 } from "../src/service.js";
import { reviewComposedReply } from "../src/conversation-orchestrator.js";

const FLEET = [
  "JTDACAAJ8T3051788", "JTDACAAU4V3084476", "JTDBAMDE0T3000001",
  "5TFAX5GN1N3000002", "JTMWWRFV5N3000004",
];
const WALKED_VIN = "JTDACAAJ8T3051788";
const TINY_JPEG_B64 = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
  + "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/E"
  + "ABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

interface FakeModel {
  calls: string[];
  port: { synthesize(input: { model: string; system: string; user: string; timeoutMs: number }): Promise<{ text: string }> };
}

/** A model that answers with whatever the test injects, and records what it was shown. */
function fakeModel(reply: string): FakeModel {
  const calls: string[] = [];
  return {
    calls,
    port: {
      async synthesize(input) {
        calls.push(`${input.model}::${input.user}`);
        return { text: reply };
      },
    },
  };
}

async function makeService(synthesis?: FakeModel["port"]) {
  const root = await mkdtemp(join(tmpdir(), "aion-syn-"));
  const exportsRoot = join(root, "exports");
  await mkdir(exportsRoot);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exportsRoot),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    ...(synthesis ? { synthesis } : {}),
  });
  await service.updateSettings({ activeWorkspace: "work" });
  await service.refreshDealershipInventory({
    dealershipName: "Lakeland Toyota", useFixture: true, fixtureVins: FLEET,
  });
  return service;
}

/**
 * Register a fast model and record it as currently healthy.
 *
 * Through the public endpoint and health methods, because availability is deliberately derived from
 * a recent probe rather than from configuration — a test that wrote the field directly would prove
 * nothing about the path the runtime actually takes.
 */
const CLOCK_NOW = "2030-01-01T00:00:00.000Z";

async function withHealthyQwen(service: AionAssistantV1) {
  const endpoint = await service.addBrainEndpoint({
    label: "Local Qwen", runtime: "ollama", location: "local-machine",
    baseUrl: "http://127.0.0.1:11434/", model: "qwen3:4b-instruct",
  });
  await service.recordEndpointHealth(endpoint.id, {
    available: true,
    detail: "probed",
    // Stamped against the service clock, not wall time. The deterministic clock runs in 2030, so a
    // real-time stamp would read as four years stale and the model would correctly never be called.
    checkedAt: CLOCK_NOW,
    latencyMs: 5,
    installedModels: ["qwen3:4b-instruct", "deepseek-r1:8b"],
  });
  return endpoint;
}

async function walkTo(service: AionAssistantV1, conversationId: string) {
  await service.answerAboutVehiclePhotoBundle({
    text: "What car is this?",
    images: [{ contentBase64: TINY_JPEG_B64, mimeType: "image/jpeg", filename: "a.jpg", documentRef: "doc-a" }],
    conversationId,
    offline: true,
    extractedTexts: [`VEHICLE IDENTIFICATION NUMBER ${WALKED_VIN}`],
  });
}

const ask = (service: AionAssistantV1, text: string, conversationId: string) =>
  service.assistantPrompt(text, { conversationId });

test("the measured failure is stopped by the runtime, not just by the validator", async () => {
  // The shape of the reply qwen actually produced: a false budget comparison and an invented
  // drivetrain, in fluent prose the Owner would have repeated to a customer.
  const hallucination = JSON.stringify({
    summary: "Focus on this one — it is within her budget of $33,000 and has AWD available.",
    recommendations: ["Call Sarah about it today."],
    supportingFactIds: ["vehicle-price"],
    unknowns: [],
    nextAction: null,
  });
  const service = await makeService(fakeModel(hallucination).port);
  await withHealthyQwen(service);
  await walkTo(service, "conv-syn");

  const answer = await ask(service, "Who might want this one?", "conv-syn");
  const data = answer.data as Record<string, unknown>;

  assert.equal(data.modelUsed, false, "an unsupported claim must never reach the Owner");
  assert.ok(
    !/within (?:her|his|their) budget|AWD/i.test(answer.reply),
    `neither invention may survive, got: ${answer.reply}`,
  );
  assert.ok(
    Array.isArray(data.modelRejectedFor) && (data.modelRejectedFor as string[]).length > 0,
    "the rejection must be recorded rather than silent",
  );
  // What arrives instead is a real answer, not an apology.
  assert.ok(answer.reply.length > 0);
  assert.ok(!/sorry|unable to|I cannot/i.test(answer.reply), "the deterministic floor is a complete answer");
});

test("a grounded model reply is allowed through and reaches the Owner", async () => {
  const grounded = JSON.stringify({
    summary: "Nobody on your list matches this one on what is recorded.",
    recommendations: ["A post might do more than a call here."],
    supportingFactIds: ["vehicle-identity"],
    unknowns: ["drivetrain is not recorded"],
    nextAction: null,
  });
  const service = await makeService(fakeModel(grounded).port);
  await withHealthyQwen(service);
  await walkTo(service, "conv-syn2");

  const answer = await ask(service, "Who might want this one?", "conv-syn2");
  const data = answer.data as Record<string, unknown>;
  assert.equal(
    data.modelUsed, true,
    `grounded phrasing should survive; rejected for ${JSON.stringify(data.modelRejectedFor)}`,
  );
  assert.equal(data.modelName, "qwen3:4b-instruct");
  const style = reviewComposedReply(answer.reply);
  assert.ok(style.ok, style.problems.join("; "));
});

test("the reasoning model is never the interactive default", async () => {
  const fake = fakeModel(JSON.stringify({ summary: "ok", recommendations: [] }));
  const service = await makeService(fake.port);
  await withHealthyQwen(service);
  await walkTo(service, "conv-syn3");
  await ask(service, "Who might want this one?", "conv-syn3");

  // Measured at roughly 39 seconds for a short answer, which is not a phone experience.
  assert.ok(
    fake.calls.every((call) => !/deepseek/i.test(call)),
    `no interactive turn may route to the reasoning model, saw: ${fake.calls.join(" | ")}`,
  );
  assert.ok(fake.calls.some((call) => /qwen/i.test(call)), "the fast model should have been asked");
});

test("an unparseable, empty or failing model costs the Owner nothing", async () => {
  for (const reply of ["not json at all", ""]) {
    const service = await makeService(fakeModel(reply).port);
    await withHealthyQwen(service);
    await walkTo(service, "conv-syn4");
    const answer = await ask(service, "Who might want this one?", "conv-syn4");
    assert.equal((answer.data as Record<string, unknown>).modelUsed, false);
    assert.ok(answer.reply.length > 0, "the deterministic answer still arrives");
  }

  const throwing = { async synthesize(): Promise<{ text: string }> { throw new Error("model down"); } };
  const service = await makeService(throwing as FakeModel["port"]);
  await withHealthyQwen(service);
  await walkTo(service, "conv-syn5");
  const answer = await ask(service, "Who might want this one?", "conv-syn5");
  assert.equal((answer.data as Record<string, unknown>).modelUsed, false);
  assert.ok(answer.reply.length > 0, "a dead model must not cost the Owner his answer");
});

test("with no model configured at all the answer is still complete", async () => {
  const service = await makeService();
  await walkTo(service, "conv-syn6");
  const answer = await ask(service, "Who might want this one?", "conv-syn6");
  assert.equal((answer.data as Record<string, unknown>).modelUsed, false);
  assert.ok(answer.reply.length > 0);
});

test("the model is shown the packet and nothing else", async () => {
  const fake = fakeModel(JSON.stringify({ summary: "ok", recommendations: [] }));
  const service = await makeService(fake.port);
  await withHealthyQwen(service);
  await walkTo(service, "conv-syn7");
  await ask(service, "Who might want this one?", "conv-syn7");

  const prompt = fake.calls.join("\n");
  assert.ok(prompt.length > 0, "the model must actually have been called");
  assert.match(prompt, /Established facts:/, "the packet shape is what goes over the seam");
  // Whole-state leakage would show up as unrelated record names in the prompt.
  assert.ok(
    !/relationships|conversations|ownerKnowledge|photoVehicleContexts/i.test(prompt),
    "only the packet may be sent, never the state",
  );
});

test("a stale health record means the model is not reached at all", async () => {
  const fake = fakeModel(JSON.stringify({ summary: "ok", recommendations: [] }));
  const service = await makeService(fake.port);
  const endpoint = await service.addBrainEndpoint({
    label: "Local Qwen", runtime: "ollama", location: "local-machine",
    baseUrl: "http://127.0.0.1:11434/", model: "qwen3:4b-instruct",
  });
  // Four days before the service clock — the shape of the real production record, which named two
  // models the store no longer had.
  await service.recordEndpointHealth(endpoint.id, {
    available: true,
    detail: "probed",
    checkedAt: "2029-12-28T21:38:15.183Z",
    latencyMs: 5,
    installedModels: ["qwen3:4b-instruct"],
  });
  await walkTo(service, "conv-syn8");
  const answer = await ask(service, "Who might want this one?", "conv-syn8");

  assert.equal((answer.data as Record<string, unknown>).modelUsed, false);
  assert.deepEqual(fake.calls, [], "a remembered yes is not a current yes");
});
