/**
 * Audio transcription foundation — private intake contract, no CRM side effects.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTranscriptFromEngineText,
  isSupportedAudioType,
  segmentsFromPlainText,
  transcribeAudioBytes,
  TRANSCRIPT_SCHEMA_V1,
} from "../src/audio-transcription.js";
import {
  createEmptyStateV1,
  InMemoryStateRepositoryV1,
  DeterministicClockV1,
  DeterministicIdGeneratorV1,
  DeterministicModelProviderV1,
  StaticCapabilityRegistryV1,
  LocalEchoCapabilityV1,
  LocalArchiveImportSourceV1,
  NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../src/adapters.js";
import { AionAssistantV1 } from "../src/service.js";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function makeService() {
  const root = await mkdtemp(join(tmpdir(), "aion-audio-"));
  const exportsRoot = join(root, "exports");
  await mkdir(exportsRoot);
  return new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exportsRoot),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
}

function tinyWav(seconds = 0.2): Buffer {
  // Minimal 16-bit mono PCM WAV header + silence
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * seconds);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

test("SUPPORTED_AUDIO_TYPE accepts common safe types", () => {
  assert.equal(isSupportedAudioType("audio/webm", "a.webm"), true);
  assert.equal(isSupportedAudioType("audio/wav", "a.wav"), true);
  assert.equal(isSupportedAudioType("audio/mpeg", "a.mp3"), true);
  assert.equal(isSupportedAudioType("audio/mp4", "a.m4a"), true);
  assert.equal(isSupportedAudioType("audio/webm;codecs=opus", "rec.webm"), true);
});

test("UNSUPPORTED_AUDIO_TYPE fails closed", () => {
  assert.equal(isSupportedAudioType("video/mp4", "x.mp4"), false);
  assert.equal(isSupportedAudioType("application/pdf", "x.pdf"), false);
  assert.equal(isSupportedAudioType("text/plain", "x.txt"), false);
});

test("TRANSCRIPT_SEGMENTS from plain text", () => {
  const segs = segmentsFromPlainText("Hello there. Second sentence.");
  assert.ok(segs.length >= 1);
  assert.equal(segs[0]!.speaker, "UNKNOWN");
  assert.ok(segs[0]!.text.includes("Hello"));
});

test("fixture transcription builds contract shape", async () => {
  const wav = tinyWav();
  const tr = await transcribeAudioBytes({
    bytes: wav,
    mimeType: "audio/wav",
    filename: "t.wav",
    transcriptId: "tr-1",
    sourceRef: "test",
    workspace: "work",
    startedAt: "2030-01-01T00:00:00.000Z",
    audioSourceRef: "private/aion/intake/test/t.wav",
    fixtureText: "What vehicles do we have on the lot?",
  });
  assert.equal(tr.schema, TRANSCRIPT_SCHEMA_V1);
  assert.equal(tr.status, "READY");
  assert.equal(tr.factualAuthority, "NONE");
  assert.match(tr.fullText, /vehicles/i);
  assert.ok(tr.segments.length >= 1);
  assert.equal(tr.engine, "fixture");
});

test("unsupported type returns UNSUPPORTED_AUDIO_TYPE", async () => {
  const tr = await transcribeAudioBytes({
    bytes: Buffer.from("not audio"),
    mimeType: "application/pdf",
    filename: "x.pdf",
    transcriptId: "tr-2",
    sourceRef: "test",
    workspace: "work",
    startedAt: "2030-01-01T00:00:00.000Z",
    audioSourceRef: "x",
  });
  assert.equal(tr.status, "UNSUPPORTED_AUDIO_TYPE");
  assert.equal(tr.fullText, "");
});

test("AUDIO_UPLOAD_PRIVATE + NO_CUSTOMER_FACT_SIDE_EFFECT via service", async () => {
  const service = await makeService();
  const before = await service.snapshot();
  const relCount = before.relationships.length;
  const factCount = before.ownerKnowledge?.facts?.length ?? 0;

  const wav = tinyWav();
  const doc = await service.attachCrmDocument({
    filename: "clip.wav",
    mimeType: "audio/wav",
    byteLength: wav.length,
    storedPath: "private/aion/intake/test/clip.wav",
    kind: "other",
    tags: ["audio", "chat-attachment"],
    summary: "test audio",
  });
  assert.ok(doc.id);

  const { transcript } = await service.transcribeAudio({
    contentBase64: wav.toString("base64"),
    mimeType: "audio/wav",
    filename: "clip.wav",
    documentRef: doc.id,
    storedPath: doc.storedPath,
    fixtureText: "Follow up with the Camry interest tomorrow.",
  });
  assert.equal(transcript.status, "READY");
  assert.equal(transcript.factualAuthority, "NONE");
  assert.ok(transcript.segments.length);

  const after = await service.snapshot();
  assert.equal(after.relationships.length, relCount, "must not create customer relationships");
  assert.equal(after.ownerKnowledge?.facts?.length ?? 0, factCount, "must not create owner facts");
  assert.ok((after.audioTranscripts || []).some((t) => t.transcriptId === transcript.transcriptId));
});

test("VOICE_TO_ASSISTANT_PIPELINE uses assistant path without inventing customer needs", async () => {
  const service = await makeService();
  const out = await service.voicePromptFromAudio({
    contentBase64: tinyWav().toString("base64"),
    mimeType: "audio/wav",
    filename: "ask.wav",
    fixtureText: "What vehicles do we have?",
  });
  assert.ok(out.transcript.fullText.includes("vehicles"));
  assert.equal(out.transcript.factualAuthority, "NONE");
  assert.ok(typeof out.reply === "string");
  // No automatic customer want extraction from STT layer
  assert.equal((out.data as { factualAuthority?: string }).factualAuthority, "NONE");
});

test("buildTranscriptFromEngineText never grants factual authority", () => {
  const tr = buildTranscriptFromEngineText({
    transcriptId: "x",
    sourceRef: "s",
    workspace: "work",
    startedAt: "2030-01-01T00:00:00.000Z",
    audioSourceRef: "p",
    mimeType: "audio/wav",
    byteLength: 10,
    engine: "test",
    model: "t",
    fullText: "Customer wants a red truck",
  });
  assert.equal(tr.factualAuthority, "NONE");
});
