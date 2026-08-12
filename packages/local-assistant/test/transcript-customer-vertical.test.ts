/**
 * Transcript → conversation → needs → commitments.
 *
 * The tests that matter here are the ones about strength and attribution. A preference promoted to a
 * requirement silently deletes most of the inventory; a requirement demoted to a preference walks a
 * customer to a car they already said they can't use; and a promise attributed to the wrong speaker
 * is a follow-up that never happens.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { TranscriptRecordV1 } from "../src/audio-transcription.js";
import {
  conversationEventFromTranscript, describeSpeakerGrounding, hasGroundedSpeakers,
} from "../src/transcript-conversation-adapter.js";
import {
  extractNeedsFromSegments, extractNeedsFromSentence, isExplicitChangeOfMind,
  parseSpokenAmount, toDurableNeeds,
} from "../src/need-extraction.js";
import { extractFromEvent, isConfirmableCommitment, proposeCommitments } from "../src/conversation-event.js";
import { recordNeed, currentNeeds, needChanges } from "../src/customer-needs.js";
import { resolveCustomerIdentity } from "../src/customer-identity.js";
import type { RelationshipV1 } from "../src/contracts.js";

const NOW = "2026-08-12T12:00:00.000Z";

function transcript(over: Partial<TranscriptRecordV1> = {}): TranscriptRecordV1 {
  return {
    schema: "aion.transcript.v1",
    transcriptId: "t1", sourceRef: "audio:a1", workspace: "work", conversationId: null,
    startedAt: NOW, durationMs: 12000, language: "en", engine: "faster-whisper", model: "tiny.en",
    confidence: 88,
    fullText: "I'm looking for a Camry XSE under thirty-five thousand.",
    segments: [
      { startMs: 0, endMs: 4000, speaker: "SPEAKER_1", text: "I'm looking for a Camry XSE under thirty-five thousand.", confidence: 90 },
      { startMs: 4000, endMs: 8000, speaker: "SPEAKER_2", text: "I'll send you pictures this afternoon.", confidence: 88 },
    ],
    audioSourceRef: "private-intake:a1", mimeType: "audio/wav", byteLength: 1024,
    status: "READY", message: "", factualAuthority: "NONE",
    ...over,
  } as TranscriptRecordV1;
}

const UNRESOLVED = resolveCustomerIdentity({ signals: { workspace: "work", spokenName: "Sarah" }, relationships: [] });

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

test("adapter preserves grounding references and timing", () => {
  const e = conversationEventFromTranscript({
    transcript: transcript(), identity: UNRESOLVED, ingestPath: "UPLOADED_CALL_RECORDING",
    eventId: "c1", capturedAt: NOW,
  });
  assert.equal(e.workspace, "work");
  assert.equal(e.evidenceRef, "transcript:t1", "the transcript is referenced, not copied");
  assert.equal(e.occurredAt, NOW);
  assert.equal(e.segments[0]!.startMs, 0);
  assert.equal(e.extraction.provider, "faster-whisper:tiny.en");
  assert.equal(e.extraction.confidence, 88);
  assert.equal(e.extraction.ok, true);
});

test("diarisation labels never become OWNER or CUSTOMER without binding", () => {
  const e = conversationEventFromTranscript({
    transcript: transcript(), identity: UNRESOLVED, ingestPath: "UPLOADED_CALL_RECORDING",
    eventId: "c1", capturedAt: NOW,
  });
  assert.deepEqual(e.segments.map((s) => s.speaker), ["UNKNOWN", "UNKNOWN"]);
  assert.equal(hasGroundedSpeakers(e), false);
  assert.match(String(describeSpeakerGrounding(e)), /couldn't tell who was speaking/i);
});

test("grounded binding maps only the labels the caller actually bound", () => {
  const e = conversationEventFromTranscript({
    transcript: transcript(), identity: UNRESOLVED, ingestPath: "UPLOADED_CALL_RECORDING",
    speakerBinding: { owner: "SPEAKER_2" },
    eventId: "c1", capturedAt: NOW,
  });
  assert.equal(e.segments[1]!.speaker, "OWNER");
  // SPEAKER_1 is not automatically the customer — a third person may be on the call.
  assert.equal(e.segments[0]!.speaker, "UNKNOWN");
});

test("an uploaded audio file is not silently called a phone call", () => {
  const generic = conversationEventFromTranscript({
    transcript: transcript(), identity: UNRESOLVED, ingestPath: "UPLOADED_AUDIO", eventId: "c1", capturedAt: NOW,
  });
  assert.notEqual(generic.channel, "PHONE_CALL");
  const mic = conversationEventFromTranscript({
    transcript: transcript(), identity: UNRESOLVED, ingestPath: "CHAT_MICROPHONE", eventId: "c1", capturedAt: NOW,
  });
  assert.equal(mic.channel, "AION_CHAT");
  const call = conversationEventFromTranscript({
    transcript: transcript(), identity: UNRESOLVED, ingestPath: "UPLOADED_CALL_RECORDING", eventId: "c1", capturedAt: NOW,
  });
  assert.equal(call.channel, "PHONE_CALL");
});

test("a failed transcription yields an event that derives nothing", () => {
  const e = conversationEventFromTranscript({
    transcript: transcript({ status: "TRANSCRIPTION_FAILED", fullText: "", segments: [] }),
    identity: UNRESOLVED, ingestPath: "UPLOADED_CALL_RECORDING", eventId: "c1", capturedAt: NOW,
  });
  assert.equal(e.extraction.ok, false);
  assert.deepEqual(extractFromEvent(e).commitments, []);
});

// ---------------------------------------------------------------------------
// Need extraction — strength
// ---------------------------------------------------------------------------

function one(text: string) {
  return extractNeedsFromSentence({ text, sourceRef: "conversation:c1#0" });
}

test("requirement language produces a hard requirement", () => {
  for (const text of ["I need AWD.", "It has to have AWD.", "AWD is required."]) {
    const awd = one(text).find((n) => n.value === "awd");
    assert.ok(awd, `no AWD extracted from "${text}"`);
    assert.equal(awd!.strength, "HARD_REQUIREMENT", `"${text}"`);
  }
});

test("preference language stays a preference", () => {
  for (const text of ["I'd prefer AWD.", "AWD would be nice.", "Ideally AWD."]) {
    const awd = one(text).find((n) => n.value === "awd");
    assert.ok(awd, `no AWD extracted from "${text}"`);
    assert.equal(awd!.strength, "PREFERENCE", `"${text}" must not become a requirement`);
  }
});

test("hedged language never becomes a requirement", () => {
  for (const text of ["Maybe AWD.", "I'm thinking about AWD.", "I might need AWD."]) {
    const awd = one(text).find((n) => n.value === "awd");
    assert.ok(awd);
    assert.equal(awd!.strength, "UNKNOWN", `"${text}" is not a decision`);
  }
});

test("negation before the feature produces an exclusion", () => {
  const hybrid = one("I don't want a hybrid.").find((n) => n.attribute === "powertrain");
  assert.ok(hybrid);
  assert.equal(hybrid!.strength, "EXCLUSION");

  const emphatic = one("Absolutely no hybrid.").find((n) => n.attribute === "powertrain");
  assert.ok(emphatic);
  assert.equal(emphatic!.strength, "EXCLUSION");
  assert.ok(emphatic!.confidence >= 90, "emphasis raises confidence in an exclusion");
});

test("negation does not leak onto a feature mentioned before it", () => {
  // "I want AWD, I don't want a hybrid" — AWD must not become an exclusion.
  const needs = one("I want AWD, I don't want a hybrid.");
  const awd = needs.find((n) => n.value === "awd");
  const hybrid = needs.find((n) => n.attribute === "powertrain");
  assert.ok(awd && hybrid);
  assert.notEqual(awd!.strength, "EXCLUSION", "the feature before the negation is not negated");
  assert.equal(hybrid!.strength, "EXCLUSION");
});

test("hedged extractions are dropped rather than stored as wants", () => {
  const durable = toDurableNeeds({
    extracted: one("Maybe AWD."),
    workspace: "work", relationshipRef: "sarah", observedAt: NOW, nextId: (n) => `n${n}`,
  });
  assert.deepEqual(durable, [], "a hedge is a question for the Owner, not a recorded want");
});

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

test("spoken thousands are read correctly", () => {
  assert.deepEqual(parseSpokenAmount("under thirty-five thousand"), { amount: 35000, kind: "VEHICLE_PRICE" });
  assert.deepEqual(parseSpokenAmount("around thirty grand"), { amount: 30000, kind: "VEHICLE_PRICE" });
  assert.deepEqual(parseSpokenAmount("no more than $40,000"), { amount: 40000, kind: "VEHICLE_PRICE" });
});

test("price and monthly payment are never conflated", () => {
  const monthly = parseSpokenAmount("about five hundred a month");
  assert.equal(monthly?.kind, "MONTHLY_PAYMENT");
  const priced = parseSpokenAmount("under thirty-five thousand");
  assert.equal(priced?.kind, "VEHICLE_PRICE");
});

test("an ambiguous bare number is refused rather than guessed", () => {
  assert.equal(parseSpokenAmount("under 500")?.kind, "AMBIGUOUS");
  assert.equal(parseSpokenAmount("under 5000")?.kind, "AMBIGUOUS");
  // And nothing ambiguous reaches the extracted needs.
  assert.equal(one("Keep it under 500.").filter((n) => n.attribute === "max-price").length, 0);
});

test("a ceiling becomes a hard max price; a vague target does not", () => {
  const ceiling = one("I want to stay under thirty-five thousand.").find((n) => n.attribute === "max-price");
  assert.ok(ceiling);
  assert.equal(ceiling!.numericValue, 35000);
  assert.equal(ceiling!.strength, "HARD_REQUIREMENT");

  // "around thirty grand" is a target, not a ceiling — recording it as a max would hide cars the
  // customer would happily buy.
  assert.equal(one("I'm looking at around thirty grand.").filter((n) => n.attribute === "max-price").length, 0);
});

// ---------------------------------------------------------------------------
// Vocabulary safety
// ---------------------------------------------------------------------------

test("trims are only read alongside a model", () => {
  assert.equal(one("I'd like a Camry XSE.").some((n) => n.attribute === "trim"), true);
  // "limited" and "se" appear constantly in ordinary speech.
  assert.equal(one("My budget is limited.").some((n) => n.attribute === "trim"), false);
});

test("feature words are matched at word boundaries", () => {
  assert.equal(one("I need a sedan.").some((n) => n.value === "se"), false, "'se' must not match inside 'sedan'");
  assert.equal(one("Every car I looked at was too small.").some((n) => n.value === "electric"), false, "'ev' must not match inside 'Every'");
});

// ---------------------------------------------------------------------------
// Supersession
// ---------------------------------------------------------------------------

test("an explicit change of mind supersedes; a hedge does not", () => {
  assert.equal(isExplicitChangeOfMind("I changed my mind. I don't want the Camry anymore. I want a RAV4."), true);
  assert.equal(isExplicitChangeOfMind("I might consider a RAV4."), false, "a hedge must not overturn a stated requirement");
});

test("second call supersedes the first and the change is explainable", () => {
  const first = toDurableNeeds({
    extracted: one("I'm looking for a Camry."),
    workspace: "work", relationshipRef: "sarah", observedAt: "2026-08-10T10:00:00.000Z", nextId: () => "n1",
  });
  const second = toDurableNeeds({
    extracted: one("I want a RAV4."),
    workspace: "work", relationshipRef: "sarah", observedAt: "2026-08-14T10:00:00.000Z", nextId: () => "n2",
  });
  assert.ok(first.length && second.length);
  const all = recordNeed(first, second[0]!);
  const current = currentNeeds(all, "sarah");
  assert.equal(current.length, 1);
  assert.equal(current[0]!.value, "rav4");
  const changes = needChanges(all, "sarah");
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.from, "camry");
  assert.equal(changes[0]!.to, "rav4");
});

// ---------------------------------------------------------------------------
// Commitments through the adapter
// ---------------------------------------------------------------------------

function rel(over: Partial<RelationshipV1> & { id: string; displayName: string }): RelationshipV1 {
  return {
    workspace: "work", organisation: "", role: "", notes: "", objections: [], interests: [],
    archived: false, kind: "customer", lifecycle: "prospect", contactMethods: [],
    followUps: [], interactions: [],
    ...over,
  } as unknown as RelationshipV1;
}
const SARAH = rel({
  id: "sarah", displayName: "Sarah Whitmore",
  contactMethods: [{ channel: "phone", label: "m", value: "863-555-0142" }] as RelationshipV1["contactMethods"],
});
const RESOLVED = resolveCustomerIdentity({ signals: { workspace: "work", phone: "8635550142" }, relationships: [SARAH] });

test("a promise from an unbound speaker is not attributed to anyone", () => {
  const e = conversationEventFromTranscript({
    transcript: transcript(), identity: RESOLVED, ingestPath: "UPLOADED_CALL_RECORDING",
    eventId: "c1", capturedAt: NOW,
  });
  const { commitments } = extractFromEvent(e);
  assert.equal(hasGroundedSpeakers(e), false);

  // The words are still found — but nothing may be attributed to a party, and nothing may become a
  // confirmable promise. Diarisation labels are not roles.
  assert.ok(commitments.length > 0, "the promise language should still be surfaced");
  assert.deepEqual(
    commitments.filter((c) => c.party !== "UNCERTAIN"),
    [],
    "an unbound speaker must never be recorded as the Owner or the customer",
  );
  assert.deepEqual(
    commitments.filter(isConfirmableCommitment),
    [],
    "nothing unattributed may be confirmable",
  );
  assert.ok(describeSpeakerGrounding(e), "the Owner must be told attribution was not possible");
});

test("with the Owner speaker bound, their promise is attributed", () => {
  const e = conversationEventFromTranscript({
    transcript: transcript(), identity: RESOLVED, ingestPath: "UPLOADED_CALL_RECORDING",
    speakerBinding: { owner: "SPEAKER_2", customer: "SPEAKER_1" },
    eventId: "c1", capturedAt: NOW,
  });
  const { commitments } = extractFromEvent(e);
  const owner = commitments.find((c) => c.party === "OWNER_PROMISED");
  assert.ok(owner, "the Owner's promise should be found");
  assert.equal(owner!.timeHint, "this afternoon");
  assert.ok(isConfirmableCommitment(owner!));
  assert.equal(owner!.sourceRef, "conversation:c1#1", "must cite the segment");
});

test("a hedged customer statement is never a commitment", () => {
  const found = proposeCommitments({
    segment: { index: 3, speaker: "CUSTOMER", text: "Maybe I'll stop by Saturday.", startMs: null },
    eventId: "c1",
  });
  assert.ok(!found.some(isConfirmableCommitment));
});

// ---------------------------------------------------------------------------
// End-to-end semantics of the directive's fixture sentence
// ---------------------------------------------------------------------------

test("the reference call extracts exactly the intended semantics", () => {
  const segments = [{
    index: 0,
    speaker: "CUSTOMER",
    text: "I'm looking for a Camry XSE under thirty-five thousand. I don't want a hybrid. "
      + "Dark blue would be nice. I need AWD.",
  }];
  const needs = extractNeedsFromSegments(segments, "c1");
  const by = (a: string) => needs.filter((n) => n.attribute === a);

  assert.equal(by("model")[0]?.value, "camry");
  assert.equal(by("trim")[0]?.value, "xse");
  assert.equal(by("trim")[0]?.strength, "PREFERENCE");
  assert.equal(by("max-price")[0]?.numericValue, 35000);
  assert.equal(by("max-price")[0]?.strength, "HARD_REQUIREMENT");
  assert.equal(by("powertrain")[0]?.value, "hybrid");
  assert.equal(by("powertrain")[0]?.strength, "EXCLUSION");
  assert.equal(by("color")[0]?.value, "dark blue");
  assert.equal(by("color")[0]?.strength, "PREFERENCE");
  const awd = needs.find((n) => n.value === "awd");
  assert.equal(awd?.strength, "HARD_REQUIREMENT");
});
