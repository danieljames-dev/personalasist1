/**
 * Voice reaches the same brain as typing.
 *
 * Measured end to end against the real toolchain on 2026-08-13: synthesized speech encoded as
 * mp4/aac — the container Safari actually produces — went through ffmpeg and faster-whisper
 * (`tiny.en`) to the transcript "How many other used cars are on the lot?", reached the
 * conversational layer, and came back with the physical-versus-website answer in 3,984 ms.
 *
 * These tests deliberately do not invoke ffmpeg or whisper. Binding a permanent regression to two
 * external binaries and a model download makes it fail for reasons that have nothing to do with the
 * behaviour under test. What must never regress is the wiring — that an audio turn is accepted in
 * the formats an iPhone can produce, that its transcript is treated as fallible rather than as
 * fact, and that it lands in the orchestrator instead of a separate voice path.
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

const FLEET = [
  "JTDACAAJ8T3051788", "JTDACAAU4V3084476", "JTDBAMDE0T3000001",
  "5TFAX5GN1N3000002", "JTMWWRFV5N3000004",
];
/** A minimal mp4/aac payload stands in for the recording; the transcript is supplied by fixture. */
const TINY_M4A_B64 = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQ==";

async function makeService() {
  const root = await mkdtemp(join(tmpdir(), "aion-voice-"));
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
  });
  await service.updateSettings({ activeWorkspace: "work" });
  await service.refreshDealershipInventory({
    dealershipName: "Lakeland Toyota", useFixture: true, fixtureVins: FLEET,
  });
  return service;
}

test("a spoken question reaches the conversational layer, not a separate voice path", async () => {
  const service = await makeService();
  const result = await service.voicePromptFromAudio({
    contentBase64: TINY_M4A_B64,
    mimeType: "audio/mp4",
    filename: "recording.m4a",
    conversationId: "conv-voice",
    fixtureText: "How many other used cars are on the lot?",
    offline: true,
  });

  assert.equal(result.intent, "OWNER_CONVERSATION", "voice must land in the same brain as typing");
  assert.ok(
    /don't know|do not know/i.test(result.reply),
    `the spoken question must get the grounded answer, got: ${result.reply}`,
  );
});

test("a transcript is fallible speech, never a fact", async () => {
  const service = await makeService();
  const result = await service.voicePromptFromAudio({
    contentBase64: TINY_M4A_B64,
    mimeType: "audio/mp4",
    filename: "recording.m4a",
    conversationId: "conv-voice",
    fixtureText: "Sarah said her budget is forty thousand",
    offline: true,
  });
  assert.equal(
    result.transcript.factualAuthority, "NONE",
    "a misheard number must never become a customer's stated budget",
  );
});

test("the containers an iPhone can actually record are accepted", async () => {
  const service = await makeService();
  // Safari records mp4/aac and cannot produce webm; rejecting these is how a working recording
  // arrives as an unsupported file.
  const containers: ReadonlyArray<{ mimeType: string; filename: string }> = [
    { mimeType: "audio/mp4", filename: "recording.m4a" },
    { mimeType: "audio/aac", filename: "recording.m4a" },
  ];
  for (const { mimeType, filename } of containers) {
    const result = await service.voicePromptFromAudio({
      contentBase64: TINY_M4A_B64, mimeType, filename,
      conversationId: "conv-voice", fixtureText: "What should I focus on next?", offline: true,
    });
    assert.ok(result.reply.length > 0, `${mimeType} must be accepted`);
  }
});
