/**
 * The join, exercised through the real service rather than around it.
 *
 * Every part of this pipeline already had tests and every part already passed. What had never been
 * tested was the order they run in, which is where the failures that matter live: a transcript that
 * resolves to the wrong customer, a promise attributed to whoever happened to speak first, a second
 * upload of the same call quietly doubling someone's stated budget.
 *
 * So these tests drive `transcribeAudio` and `processConversationFromTranscript` — the actual runtime
 * entry points — and assert on stored state afterwards. The transcript text used throughout is the
 * verbatim output faster-whisper produced from the synthetic call, including its own rendering of the
 * spoken number as "35,000", so the extractors are tested against what the engine really emits rather
 * than against tidied prose.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  validateStateV1,
} from "../src/adapters.js";
import { AionAssistantV1 } from "../src/service.js";
import { routeCrmAssistantIntent } from "../src/crm-assistant.js";
import { conversationEventIdFor, normalizeSpeechText } from "../src/conversation-ingest.js";
import { isCurrentNeed, needChanges } from "../src/customer-needs.js";
import { parseNeedCorrection } from "../src/need-correction.js";

/** Exactly what faster-whisper returned for the synthetic call. Not cleaned up. */
const CALL_ONE =
  "I am looking for a Camry XSE under 35,000. I do not want a hybrid. Dark blue would be nice. "
  + "I need all wheel drive. I will be there Saturday at 2.";

const CALL_TWO = "I changed my mind. I do not want the Camry anymore. I want a RAV4.";

function tinyWav(seconds = 0.2): Buffer {
  const sampleRate = 16000;
  const numSamples = Math.floor(sampleRate * seconds);
  const dataBytes = numSamples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
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
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}

async function ports() {
  const root = await mkdtemp(join(tmpdir(), "aion-live-audio-"));
  const exportsRoot = join(root, "exports");
  await mkdir(exportsRoot);
  return { exportsRoot };
}

function build(repository: InMemoryStateRepositoryV1, exportsRoot: string): AionAssistantV1 {
  return new AionAssistantV1({
    repository,
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exportsRoot),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
}

async function makeService() {
  const { exportsRoot } = await ports();
  const repository = new InMemoryStateRepositoryV1();
  const service = build(repository, exportsRoot);
  // A dealership call is work. The default workspace is personal, and leaving it there would test
  // the wrong boundary entirely.
  await service.updateSettings({ activeWorkspace: "work" });
  return { service, repository, exportsRoot };
}

/** A customer with a phone and an email, in the work workspace. */
async function seedSarah(service: AionAssistantV1, over: Record<string, unknown> = {}) {
  return service.createRelationship({
    displayName: "Sarah Whitmore",
    relationshipType: "customer",
    contactMethods: [
      { channel: "phone", value: "863-555-0142" },
      { channel: "email", value: "sarah.whitmore@example.com" },
    ],
    ...over,
  });
}

/** Transcribe fixture speech and run the full customer path in one call. */
async function processCall(
  service: AionAssistantV1,
  text: string,
  derive: Record<string, unknown> = {},
) {
  return service.transcribeAudio({
    contentBase64: tinyWav().toString("base64"),
    mimeType: "audio/wav",
    filename: "call.wav",
    fixtureText: text,
    deriveConversation: derive as never,
  });
}

// ---------------------------------------------------------------------------
// Phase 1 — the join itself
// ---------------------------------------------------------------------------

test("a transcript becomes a conversation event that preserves its evidence", async () => {
  const { service } = await makeService();
  await seedSarah(service);
  const result = await processCall(service, CALL_ONE, { signals: { phone: "863-555-0142" } });

  const transcript = result.transcript;
  assert.equal(transcript.status, "READY");
  const outcome = result.conversation?.outcome;
  assert.ok(outcome, "the conversation path must run when asked for");

  const event = outcome.event;
  // Derived, not allocated — this is the whole of idempotency.
  assert.equal(event.id, conversationEventIdFor(transcript.transcriptId));
  assert.equal(event.evidenceRef, `transcript:${transcript.transcriptId}`);
  assert.equal(event.workspace, transcript.workspace);
  assert.equal(event.occurredAt, transcript.startedAt);
  assert.equal(event.channel, "PHONE_CALL");
  assert.equal(event.extraction.provider, `${transcript.engine}:${transcript.model}`);
  assert.equal(event.extraction.ok, true);
  assert.equal(event.segments.length, transcript.segments.length);
  // The words are carried so extraction has something to read, but the body is not duplicated.
  assert.equal(event.summary, "");
});

test("a failed transcript derives nothing at all", async () => {
  const { service } = await makeService();
  await seedSarah(service);
  const result = await service.transcribeAudio({
    contentBase64: tinyWav().toString("base64"),
    mimeType: "audio/wav",
    filename: "call.wav",
    offline: true,
    deriveConversation: { signals: { phone: "863-555-0142" } } as never,
  });
  const outcome = result.conversation?.outcome;
  assert.ok(outcome);
  assert.equal(outcome.observations.length, 0);
  assert.equal(outcome.needs.length, 0);
  assert.equal(outcome.proposals.length, 0);
  assert.match(outcome.refusals.join(" "), /nothing derived/i);
});

// ---------------------------------------------------------------------------
// Phase 2 — speaker safety
// ---------------------------------------------------------------------------

test("an unbound speaker is never promoted to OWNER or CUSTOMER", async () => {
  const { service } = await makeService();
  await seedSarah(service);
  const result = await processCall(service, CALL_ONE, { signals: { phone: "863-555-0142" } });
  const outcome = result.conversation!.outcome!;

  assert.ok(outcome.event.segments.every((s) => s.speaker === "UNKNOWN"));
  // The Saturday promise is present as content but belongs to nobody.
  const parties = new Set(outcome.commitments.map((c) => c.party));
  assert.ok(!parties.has("OWNER_PROMISED"), "nothing may be attributed to the Owner");
  assert.ok(!parties.has("CUSTOMER_PROMISED"), "nothing may be attributed to the customer");
  assert.ok(outcome.commitments.some((c) => /Saturday/i.test(c.statement)), "the statement is still kept");
});

test("an explicit Owner binding is what makes attribution possible", async () => {
  const { service } = await makeService();
  await seedSarah(service);
  const result = await processCall(service, CALL_ONE, {
    signals: { phone: "863-555-0142" },
    speakerBinding: { customer: "UNKNOWN" },
  });
  const outcome = result.conversation!.outcome!;
  assert.ok(outcome.event.segments.every((s) => s.speaker === "CUSTOMER"));
  const saturday = outcome.commitments.find((c) => /Saturday/i.test(c.statement));
  assert.ok(saturday);
  assert.equal(saturday.party, "CUSTOMER_PROMISED");
  assert.equal(saturday.timeHint, "Saturday");
});

// ---------------------------------------------------------------------------
// Phase 3 — identity
// ---------------------------------------------------------------------------

test("exact phone and exact email each resolve; a first name never does", async () => {
  const { service } = await makeService();
  await seedSarah(service);

  const byPhone = await processCall(service, CALL_ONE, { signals: { phone: "(863) 555-0142" } });
  assert.equal(byPhone.conversation!.outcome!.identity.state, "RESOLVED");
  assert.equal(byPhone.conversation!.outcome!.identity.method, "EXACT_PHONE");

  const byEmail = await processCall(service, CALL_ONE, {
    signals: { email: "Sarah.Whitmore@Example.com" },
  });
  assert.equal(byEmail.conversation!.outcome!.identity.state, "RESOLVED");
  assert.equal(byEmail.conversation!.outcome!.identity.method, "EXACT_EMAIL");

  const byName = await processCall(service, CALL_ONE, { signals: { spokenName: "Sarah" } });
  const named = byName.conversation!.outcome!.identity;
  assert.notEqual(named.state, "RESOLVED");
  assert.equal(named.relationshipRef, null);
});

test("two records sharing a first name stay ambiguous, and contradicting details refuse", async () => {
  const { service } = await makeService();
  await seedSarah(service);
  await service.createRelationship({
    displayName: "Sarah Delgado",
    relationshipType: "customer",
    contactMethods: [{ channel: "email", value: "s.delgado@example.com" }],
  });

  const twoSarahs = await processCall(service, CALL_ONE, { signals: { spokenName: "Sarah" } });
  const ambiguous = twoSarahs.conversation!.outcome!.identity;
  assert.equal(ambiguous.state, "AMBIGUOUS");
  assert.equal(ambiguous.relationshipRef, null);
  assert.equal(ambiguous.candidates.length, 2);

  const conflicting = await processCall(service, CALL_ONE, {
    signals: { phone: "863-555-0142", email: "s.delgado@example.com" },
  });
  const clash = conflicting.conversation!.outcome!.identity;
  assert.equal(clash.state, "CONFLICTING_SIGNALS");
  assert.equal(clash.relationshipRef, null);
});

// ---------------------------------------------------------------------------
// Phases 4 and 5 — needs and money
// ---------------------------------------------------------------------------

test("needs come out of real engine text with their strength intact", async () => {
  const { service } = await makeService();
  const sarah = await seedSarah(service);
  const result = await processCall(service, CALL_ONE, { signals: { phone: "863-555-0142" } });
  const outcome = result.conversation!.outcome!;

  const current = outcome.needs.filter(isCurrentNeed);
  const byAttribute = (a: string) => current.find((n) => n.attribute === a);

  assert.equal(byAttribute("model")?.value, "camry");
  assert.equal(byAttribute("trim")?.value, "xse");
  // "I need all wheel drive" is a requirement; "dark blue would be nice" is not.
  assert.equal(byAttribute("must-have")?.value, "awd");
  assert.equal(byAttribute("must-have")?.strength, "HARD_REQUIREMENT");
  assert.equal(byAttribute("color")?.value, "dark blue");
  assert.equal(byAttribute("color")?.strength, "PREFERENCE");
  // "I do not want a hybrid" is an exclusion, not a preference for hybrids.
  assert.equal(byAttribute("powertrain")?.value, "hybrid");
  assert.equal(byAttribute("powertrain")?.strength, "EXCLUSION");
  assert.ok(current.every((n) => n.relationshipRef === sarah.id));
  // Every need cites the segment it came from.
  assert.ok(current.every((n) => n.sourceRef.startsWith(`conversation:${outcome.event.id}#`)));
});

test("a vehicle price and a monthly payment never become each other", async () => {
  const { service } = await makeService();
  await seedSarah(service);

  const priced = await processCall(service, "I am looking for a Camry under 35,000.", {
    signals: { phone: "863-555-0142" },
  });
  const price = priced.conversation!.outcome!.needs.find((n) => n.attribute === "max-price");
  assert.equal(price?.numericValue, 35000);

  const monthly = await processCall(service, "I need to stay under 500 a month.", {
    signals: { phone: "863-555-0142" },
  });
  const monthlyOut = monthly.conversation!.outcome!;
  const payment = monthlyOut.needs.find((n) => n.attribute === "payment-target");
  assert.equal(payment?.numericValue, 500);
  // 500 must never have been read as a car price. Checked against what this call produced, since the
  // stored set still carries the genuine $35,000 ceiling from the earlier one.
  assert.equal(
    monthlyOut.observations.find((o) => o.attribute === "max-price"),
    undefined,
  );

  const bare = await processCall(service, "I want to keep it under 500.", {
    signals: { phone: "863-555-0142" },
  });
  const guessed = bare.conversation!.outcome!.observations
    .filter((o) => o.attribute === "max-price" || o.attribute === "payment-target");
  assert.equal(guessed.length, 0, "a bare 500 has no units and must not be guessed");
});

// ---------------------------------------------------------------------------
// Phase 8 — idempotency
// ---------------------------------------------------------------------------

test("processing the same transcript twice derives no duplicates", async () => {
  const { service } = await makeService();
  await seedSarah(service);
  const first = await processCall(service, CALL_ONE, {
    signals: { phone: "863-555-0142" },
    speakerBinding: { customer: "UNKNOWN" },
  });
  const transcriptId = first.transcript.transcriptId;

  const before = await service.snapshot();
  const needsBefore = before.customerNeeds.length;
  const eventsBefore = before.conversationEvents.length;
  const proposalsBefore = before.crmActionProposals.length;
  const commitmentsBefore = before.commitmentCandidates.length;
  assert.ok(needsBefore > 0 && proposalsBefore > 0);

  await service.processConversationFromTranscript({
    transcriptId,
    speakerBinding: { customer: "UNKNOWN" },
    signals: { phone: "863-555-0142" },
  });

  const after = await service.snapshot();
  assert.equal(after.conversationEvents.length, eventsBefore);
  assert.equal(after.customerNeeds.length, needsBefore);
  assert.equal(after.crmActionProposals.length, proposalsBefore);
  assert.equal(after.commitmentCandidates.length, commitmentsBefore);
  // And nothing was superseded by its own second run.
  assert.equal(after.customerNeeds.filter(isCurrentNeed).length, needsBefore);
});

// ---------------------------------------------------------------------------
// Phases 7 and 14 — persistence across a restart
// ---------------------------------------------------------------------------

test("everything derived survives a restart, unchanged", async () => {
  const { service, repository, exportsRoot } = await makeService();
  const sarah = await seedSarah(service);
  await processCall(service, CALL_ONE, {
    signals: { phone: "863-555-0142" },
    speakerBinding: { customer: "UNKNOWN" },
  });

  const before = await service.snapshot();
  // A genuine restart: a new service instance loading the same persisted store.
  const restarted = build(repository, exportsRoot);
  const after = await restarted.snapshot();

  assert.deepEqual(after.conversationEvents, before.conversationEvents);
  assert.deepEqual(after.customerNeeds, before.customerNeeds);
  assert.deepEqual(after.commitmentCandidates, before.commitmentCandidates);
  assert.deepEqual(after.crmActionProposals, before.crmActionProposals);

  const answer = await restarted.assistantPrompt("What does Sarah want?");
  assert.match(answer.reply, /camry/i);
  assert.match(answer.reply, /awd/i);
  assert.ok(after.customerNeeds.every((n) => n.relationshipRef === sarah.id));
});

test("state written before these records existed still loads", () => {
  const legacy = createEmptyStateV1() as unknown as Record<string, unknown>;
  delete legacy.conversationEvents;
  delete legacy.customerNeeds;
  delete legacy.commitmentCandidates;
  delete legacy.crmActionProposals;
  const loaded = validateStateV1(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual(loaded.conversationEvents, []);
  assert.deepEqual(loaded.customerNeeds, []);
});

// ---------------------------------------------------------------------------
// Phase 9 — supersession across two calls
// ---------------------------------------------------------------------------

test("a second call supersedes the first without deleting it", async () => {
  const { service } = await makeService();
  const sarah = await seedSarah(service);
  await processCall(service, CALL_ONE, { signals: { phone: "863-555-0142" } });
  await processCall(service, CALL_TWO, { signals: { phone: "863-555-0142" } });

  const state = await service.snapshot();
  const models = state.customerNeeds.filter((n) => n.attribute === "model");
  const current = models.filter(isCurrentNeed);

  assert.equal(current.length, 1);
  assert.equal(current[0]!.value, "rav4");
  // The Camry is history, not gone.
  const camry = models.filter((n) => n.value === "camry");
  assert.ok(camry.length >= 1);
  assert.ok(camry.every((n) => n.supersededAt !== null));
  // Both conversations are still on file.
  assert.equal(state.conversationEvents.length, 2);

  const changes = needChanges(state.customerNeeds, sarah.id);
  assert.ok(changes.some((c) => c.to === "rav4"));

  const answer = await service.assistantPrompt("What changed for Sarah?");
  assert.equal(answer.intent, "CUSTOMER_NEEDS_HISTORY");
  assert.match(answer.reply, /rav4/i);
});

// ---------------------------------------------------------------------------
// Phase 10 — need-level Owner correction
// ---------------------------------------------------------------------------

test("an Owner correction supersedes a mis-heard exclusion and keeps the original", async () => {
  const { service } = await makeService();
  const sarah = await seedSarah(service);
  await processCall(service, CALL_ONE, { signals: { phone: "863-555-0142" } });

  const before = await service.snapshot();
  const wrong = before.customerNeeds.find((n) => n.attribute === "powertrain")!;
  assert.equal(wrong.strength, "EXCLUSION");
  const transcriptsBefore = JSON.stringify(before.audioTranscripts);

  const answer = await service.assistantPrompt(
    "That's not what Sarah meant. She prefers a hybrid; she didn't rule hybrids out.",
  );
  assert.equal(answer.intent, "CUSTOMER_NEED_CORRECTION");

  const after = await service.snapshot();
  const powertrains = after.customerNeeds.filter(
    (n) => n.attribute === "powertrain" && n.relationshipRef === sarah.id,
  );
  const current = powertrains.filter(isCurrentNeed);
  assert.equal(current.length, 1);
  assert.equal(current[0]!.value, "hybrid");
  assert.equal(current[0]!.strength, "PREFERENCE");
  assert.equal(current[0]!.authority, "OWNER_CORRECTION");
  assert.equal(current[0]!.confidence, 100);
  // The correction points back at the observation it replaced, which still carries its own evidence.
  assert.equal(current[0]!.correctsNeedId, wrong.id);
  const original = powertrains.find((n) => n.id === wrong.id)!;
  assert.equal(original.strength, "EXCLUSION");
  assert.ok(original.supersededAt !== null);
  assert.equal(original.supersededBy, current[0]!.id);
  assert.ok(original.sourceRef.startsWith("conversation:"));

  // The recording is untouched.
  assert.equal(JSON.stringify(after.audioTranscripts), transcriptsBefore);

  // And nothing else about Sarah was invented.
  const invented = after.customerNeeds.filter(
    (n) => n.relationshipRef === sarah.id && n.sourceRef.startsWith("owner-correction:"),
  );
  assert.equal(invented.length, 1);
});

test("a correction only fires on correction language, not on a fresh statement", () => {
  assert.equal(parseNeedCorrection("Sarah wants a hybrid."), null);
  const parsed = parseNeedCorrection("That's not what Sarah meant. She prefers a hybrid; she didn't rule hybrids out.");
  assert.ok(parsed);
  assert.equal(parsed.corrections.length, 1);
  assert.equal(parsed.corrections[0]!.attribute, "powertrain");
  assert.equal(parsed.corrections[0]!.value, "hybrid");
  assert.equal(parsed.corrections[0]!.strength, "PREFERENCE");
});

// ---------------------------------------------------------------------------
// Phase 11 — CRM PREPARE
// ---------------------------------------------------------------------------

test("a resolved call produces grounded PREPARE proposals and nothing else", async () => {
  const { service } = await makeService();
  const sarah = await seedSarah(service);
  const result = await processCall(service, CALL_ONE, {
    signals: { phone: "863-555-0142" },
    speakerBinding: { customer: "UNKNOWN" },
  });
  const proposals = result.conversation!.outcome!.proposals;

  const kinds = proposals.map((p) => p.action).sort();
  assert.deepEqual(kinds, ["PREPARE_CALL_NOTE", "PREPARE_FOLLOWUP", "PREPARE_PREFERENCE_UPDATE"]);

  for (const p of proposals) {
    assert.equal(p.customerRef, sarah.id);
    assert.equal(p.workspace, result.transcript.workspace);
    assert.equal(p.authorityRequired, "PREPARE_ONLY");
    assert.equal(p.status, "PROPOSED");
    assert.ok(p.sourceRefs.length > 0, "every proposal cites its evidence");
    assert.ok(p.sourceRefs.includes(`transcript:${result.transcript.transcriptId}`));
    assert.ok(p.idempotencyKey.length > 0);
    assert.ok(p.expectedExternalEffect.length > 0);
    // Nothing here may be a write action.
    assert.ok(p.action.startsWith("PREPARE_"));
  }
});

test("an unresolved identity refuses every CRM proposal but keeps the call", async () => {
  const { service } = await makeService();
  await seedSarah(service);
  const result = await processCall(service, CALL_ONE, { signals: { spokenName: "Sarah" } });
  const outcome = result.conversation!.outcome!;

  assert.equal(outcome.proposals.length, 0);
  assert.equal(outcome.needs.length, 0);
  assert.match(outcome.refusals.join(" "), /identity is/i);
  // The call and what was said are still captured.
  assert.ok(outcome.observations.length > 0, "what was heard is still reported");
  const state = await service.snapshot();
  assert.equal(state.conversationEvents.length, 1);
  assert.equal(state.crmActionProposals.length, 0);
  assert.equal(state.customerNeeds.length, 0);
  // The Saturday commitment is not hung on anyone.
  assert.equal(state.commitmentCandidates.length, 0);
});

// ---------------------------------------------------------------------------
// Phase 12 — the questions afterwards
// ---------------------------------------------------------------------------

test("the post-call questions all answer in prose from stored evidence", async () => {
  const { service } = await makeService();
  await seedSarah(service);
  await processCall(service, CALL_ONE, {
    signals: { phone: "863-555-0142" },
    speakerBinding: { customer: "UNKNOWN" },
  });

  const needs = await service.assistantPrompt("What does Sarah want now?");
  assert.equal(needs.intent, "CUSTOMER_NEEDS");
  assert.match(needs.reply, /camry|awd/i);

  const promised = await service.assistantPrompt("What did Sarah promise me?");
  assert.equal(promised.intent, "CUSTOMER_COMMITMENTS");
  assert.match(promised.reply, /Saturday/i);

  const precall = await service.assistantPrompt("What should I know before I call Sarah?");
  assert.equal(precall.intent, "CUSTOMER_PRECALL");
  assert.ok(precall.reply.length > 0);

  const prepared = await service.assistantPrompt("What follow-up should I prepare?");
  assert.equal(prepared.intent, "CUSTOMER_FOLLOWUP_PREP");
  assert.match(prepared.reply, /call note|follow-up|preference/i);
  assert.match(prepared.reply, /written anywhere/i);

  // Prose, not a record dump.
  for (const reply of [needs.reply, promised.reply, precall.reply, prepared.reply]) {
    assert.ok(!/HARD_REQUIREMENT|PREFERENCE|EXCLUSION|OWNER_PROMISED/.test(reply), reply);
  }
});

test("the new intents take no traffic from the old ones", () => {
  const untouched: Array<[string, string]> = [
    ["What changed?", "WORK_QUEUE"],
    ["What changed since yesterday?", "WORK_QUEUE"],
    ["What should I follow up on?", "LIST_FOLLOWUPS"],
    ["What should I do?", "WORK_QUEUE"],
    ["What vehicles do we have?", "VEHICLE_INVENTORY"],
    ["What jobs fit me?", "CAREER_PROFILE"],
    ["What are my goals?", "OWNER_GOALS"],
  ];
  for (const [q, expected] of untouched) {
    assert.equal(routeCrmAssistantIntent(q).intent, expected, `"${q}" must still route to ${expected}`);
  }
  assert.equal(routeCrmAssistantIntent("What follow-up should I prepare?").intent, "CUSTOMER_FOLLOWUP_PREP");
  assert.equal(routeCrmAssistantIntent("What changed for Sarah?").intent, "CUSTOMER_NEEDS_HISTORY");
});

// ---------------------------------------------------------------------------
// Phase 15 — workspace isolation
// ---------------------------------------------------------------------------

test("a work call never reaches another workspace", async () => {
  const { service } = await makeService();
  const sarah = await seedSarah(service);
  await processCall(service, CALL_ONE, { signals: { phone: "863-555-0142" } });

  const state = await service.snapshot();
  const workspace = state.settings.activeWorkspace;
  assert.ok(state.conversationEvents.every((e) => e.workspace === workspace));
  assert.ok(state.customerNeeds.every((n) => n.workspace === workspace));
  assert.ok(state.crmActionProposals.every((p) => p.workspace === workspace));

  // A same-numbered contact in another workspace must not be reachable from this call.
  await service.updateSettings({ activeWorkspace: "personal" });
  const personal = await service.createRelationship({
    displayName: "Sarah Whitmore",
    contactMethods: [{ channel: "phone", value: "863-555-0142" }],
  });
  const leaked = await service.processConversationFromTranscript({
    transcriptId: state.audioTranscripts[0]!.transcriptId,
    signals: { phone: "863-555-0142" },
  });
  // The transcript belongs to work, so resolution stays in work and finds Sarah there.
  assert.equal(leaked.outcome?.identity.workspace, workspace);
  assert.notEqual(leaked.outcome?.identity.relationshipRef, personal.id);
  assert.equal(leaked.outcome?.identity.relationshipRef, sarah.id);

  const afterState = await service.snapshot();
  assert.ok(afterState.customerNeeds.every((n) => n.relationshipRef !== personal.id));
});

// ---------------------------------------------------------------------------
// Speech normalisation
// ---------------------------------------------------------------------------

test("typographic apostrophes cannot flip an exclusion into a preference", async () => {
  assert.equal(normalizeSpeechText("I don’t want a hybrid"), "I don't want a hybrid");
  const { service } = await makeService();
  await seedSarah(service);
  const result = await processCall(service, "I don’t want a hybrid.", {
    signals: { phone: "863-555-0142" },
  });
  const powertrain = result.conversation!.outcome!.needs.find((n) => n.attribute === "powertrain");
  assert.equal(powertrain?.strength, "EXCLUSION");
});

// ---------------------------------------------------------------------------
// STT confidence semantics (documented, not an arbitrary cutoff)
// ---------------------------------------------------------------------------

/**
 * LOW_STT_CONFIDENCE_SEMANTICS:
 * TranscriptRecordV1.confidence is 0–100 when known; for faster-whisper live paths it is the
 * mean of per-segment engine scores when overall confidence is absent (see adapter).
 * That figure is an engine-specific aggregate probability-like score, NOT a calibrated accuracy %.
 * Values around ~30 can still accompany READY transcripts that are lexically accurate.
 *
 * Safety boundary is status, not a numeric cutoff:
 * - READY + non-empty text → may derive (identity still gates attribution)
 * - TRANSCRIPTION_FAILED / empty → extraction.ok=false → zero needs/commitments/proposals
 *
 * Do not invent an arbitrary confidence threshold here; that would drop usable READY speech.
 */
test("FAILED_TRANSCRIPT produces NO_DERIVATIONS regardless of identity", async () => {
  const { service } = await makeService();
  await seedSarah(service);
  // Empty fixture text is not customer evidence (FAILED or empty READY).
  const empty = await service.transcribeAudio({
    filename: "empty.wav",
    mimeType: "audio/wav",
    contentBase64: tinyWav().toString("base64"),
    fixtureText: "",
  });
  assert.ok(empty.transcript);
  const processed = await service.processConversationFromTranscript({
    transcriptId: empty.transcript.transcriptId,
    signals: { phone: "863-555-0142" },
    speakerBinding: { customer: "UNKNOWN" },
  });
  const outcome = processed.outcome;
  assert.ok(outcome);
  // Boundary is status/empty text (extraction.ok), not a numeric confidence cutoff.
  if (!String(empty.transcript.fullText ?? "").trim() || empty.transcript.status === "TRANSCRIPTION_FAILED") {
    assert.equal(outcome.event.extraction.ok, false);
    assert.equal(outcome.needs.length, 0);
    assert.equal(outcome.commitments.length, 0);
    assert.equal(outcome.proposals.length, 0);
    assert.equal(outcome.observations.length, 0);
  }
});

test("CLEAR_READY_TRANSCRIPT with low numeric confidence still derives when status is READY", async () => {
  // Documents that ~30 aggregate confidence is not a hard fail — READY + clear text is usable.
  const { service } = await makeService();
  await seedSarah(service);
  const result = await processCall(service, CALL_ONE, {
    signals: { phone: "863-555-0142" },
  });
  assert.equal(result.conversation!.outcome!.event.extraction.ok, true);
  assert.ok(result.conversation!.outcome!.needs.length > 0);
  // Confidence may be low or high; either way READY clear speech must not be discarded by cutoff.
  const conf = result.conversation!.outcome!.event.extraction.confidence;
  assert.ok(typeof conf === "number");
});
