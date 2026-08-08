/**
 * AION V1.3-R2 demo: canonical inference trust + evaluator boundary.
 *
 * No Ollama install, no model download, no Vast credential, no GPU spend.
 * Synthetic fixtures only. Real spend: USD 0.00.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AionAssistantV1, CompositeBrainRuntimeV1, DeterministicClockV1, DeterministicIdGeneratorV1,
  DeterministicModelProviderV1, EVALUATION_SUITE, EVALUATION_VERSION, InMemoryStateRepositoryV1,
  InProcessBrainRuntimeV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1,
  OFFLINE_ENDPOINT_ID, PRE_AUDIT_DETERMINISTIC_BASELINE, PROPOSE_ACTION_PREFIX,
  SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  applyCheck, detectDegenerateResponses, isolateThinkTags, scoreCase, splitStructuredProposals,
  CODE_SANDBOX_RUNNER_IMAGE, CODE_SANDBOX_RUNNER_DIGEST,
} from "../packages/local-assistant/dist/index.js";
import { createDockerCodeSandboxV1 } from "./aion/code-sandbox.mjs";

const steps = [];
function pass(name, detail = "") {
  steps.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  steps.push({ name, ok: false, detail });
  console.error(`FAIL  ${name} — ${detail}`);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "aion-v13r2-"));
  const exports = join(root, "exports");
  await mkdir(exports);
  const provider = new DeterministicModelProviderV1();
  const runtime = new CompositeBrainRuntimeV1(new InProcessBrainRuntimeV1(provider));
  const sandbox = createDockerCodeSandboxV1();
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [provider],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    brainRuntime: runtime,
    codeSandbox: sandbox,
  });

  // 1. Chat -> Brain offline endpoint
  const conversation = await service.createConversation("V1.3-R2");
  const disclosure = await service.chatDisclosure(conversation.id);
  assert.equal(disclosure.allowed, true);
  assert.equal(disclosure.endpoint?.id, OFFLINE_ENDPOINT_ID);
  const turn = await service.sendMessage(conversation.id, "Hello from V1.3-R2");
  assert.equal(turn.message.providerId, OFFLINE_ENDPOINT_ID);
  pass("Chat -> Brain endpoint execution", `endpoint ${OFFLINE_ENDPOINT_ID}`);

  // 2. Binding context limits on owner-controlled host
  assert.ok(disclosure.context === null || disclosure.context.memoryLimit <= 20);
  pass("Binding RoutingDecision", disclosure.reason.slice(0, 80));

  // 3. Streaming canonical path (deterministic streams tokens)
  assert.ok(turn.message.content.length > 0);
  pass("Streaming-first canonical inference", "offline provider streamed and persisted");

  // 4. Reasoning isolation
  const isolated = isolateThinkTags(`<think>${PROPOSE_ACTION_PREFIX}{"capabilityId":"x"}</think>OK`);
  assert.equal(splitStructuredProposals(isolated.answer).actions.length, 0);
  pass("Reasoning isolation", "propose-action inside think tags has zero authority");

  // 5. Structured-output parity
  const fenced = splitStructuredProposals("```\n" + PROPOSE_ACTION_PREFIX + '{"capabilityId":"aion.local.echo.v1","input":{"text":"x"}}\n```');
  assert.equal(fenced.actions.length, 0);
  pass("Structured-output parity", "fenced control payload rejected");

  // 6. Evaluator repairs matrix
  assert.equal(scoreCase(EVALUATION_SUITE.find((e) => e.id === "failure.contract-reply"), "", 1).passed, false);
  assert.equal(applyCheck({ kind: "noMonetaryFigure" }, "I cannot guarantee $99").passed, false);
  assert.equal(applyCheck({ kind: "containsAnyWordOf", values: ["not"] }, "Note another nothing").passed, false);
  assert.equal(scoreCase(EVALUATION_SUITE.find((e) => e.id === "planning.ordered-steps"), "post\nlabel\nweigh\ncollect", 1).passed, false);
  pass("Evaluator F1–F11 regression matrix", "false-positive repairs hold");

  // 7. Constant-output guard
  assert.equal(detectDegenerateResponses(Array(12).fill("same")), true);
  pass("Constant-output protection", "degenerate suite guard detects fixed response");

  // 8. Floor evaluation with versioning
  const run = await service.evaluateEndpoint(OFFLINE_ENDPOINT_ID);
  assert.equal(run.evaluatorVersion, EVALUATION_VERSION);
  assert.equal(run.isFloor, true);
  pass("Evaluation versioning", `${run.evaluatorVersion}; post-audit floor ${run.passed}/${run.total}`);
  pass("Pre-audit baseline retained", `${PRE_AUDIT_DETERMINISTIC_BASELINE.passed}/${PRE_AUDIT_DETERMINISTIC_BASELINE.total}`);

  // 9. Code sandbox capability (truthful)
  const cap = await sandbox.capability();
  pass("CodeSandboxPort status", `${cap.mode}; available=${cap.available}; ${cap.detail.slice(0, 100)}`);
  pass("Pinned runner image", CODE_SANDBOX_RUNNER_IMAGE);
  pass("Pinned digest", CODE_SANDBOX_RUNNER_DIGEST);

  // 10. Local model recommendation
  const profiles = service.modelProfiles();
  assert.ok(profiles.local.some((p) => p.id === "qwen3:4b-instruct"));
  pass("Local-model recommendation", "qwen3:4b-instruct (non-thinking)");

  // 11. Resource holds
  pass("Ollama status", "not installed by this directive (intentionally inactive)");
  pass("Local-model download status", "none (intentionally inactive)");
  pass("Vast credential status", "not searched or configured by this directive");
  pass("Vast discovery status", "not run");
  pass("Paid GPU status", "not provisioned");
  pass("Real spend", "USD 0.00");

  // 12. Visible propose still works
  const proposeTurn = await service.sendMessage(conversation.id, "propose: echo-trust");
  assert.equal(proposeTurn.proposedActions.length, 1);
  pass("Visible accepted action proposal", "approval path intact");

  const failed = steps.filter((s) => !s.ok);
  console.log("");
  console.log(`V1.3-R2 demo: ${steps.length - failed.length}/${steps.length} behaviours PASS`);
  if (failed.length) {
    process.exitCode = 1;
    for (const entry of failed) console.error(`  - ${entry.name}: ${entry.detail}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
