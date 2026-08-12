/**
 * Conversation records must survive a restart, and old state files must survive these records.
 *
 * Both directions matter. A need that vanishes on restart is worse than one never captured, because
 * the Owner saw AION acknowledge it. And a state file written before these arrays existed must keep
 * loading untouched — the four new collections are default-forwarded, deliberately kept out of the
 * fail-closed list that would make an older file unloadable.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyStateV1, validateStateV1 } from "../src/adapters.js";
import { recordNeed, currentNeeds, needChanges, type CustomerNeedV1 } from "../src/customer-needs.js";
import type { ConversationEventV1, CommitmentCandidateV1 } from "../src/conversation-event.js";
import type { CrmActionProposalV1 } from "../src/crm-action-proposal.js";

const NOW = "2026-08-12T12:00:00.000Z";

function need(over: Partial<CustomerNeedV1> & { id: string; attribute: CustomerNeedV1["attribute"]; value: string }): CustomerNeedV1 {
  return {
    workspace: "work", relationshipRef: "sarah", numericValue: null, strength: "PREFERENCE",
    confidence: 85, sourceRef: "conversation:c1#0", observedAt: "2026-08-10T10:00:00.000Z",
    supersededAt: null, supersededBy: null, invalidatedAt: null, invalidationReason: null,
    ...over,
  } as CustomerNeedV1;
}

const EVENT = {
  id: "c1", workspace: "work", channel: "PHONE_CALL", direction: "INBOUND",
  occurredAt: NOW, capturedAt: NOW,
  identity: { state: "RESOLVED", relationshipRef: "sarah", method: "EXACT_PHONE", confidence: 95, workspace: "work", candidates: [], evidence: [], message: "" },
  evidenceRef: "transcript:t1",
  segments: [{ index: 0, speaker: "CUSTOMER", text: "I want a Camry.", startMs: 0 }],
  summary: "", extraction: { provider: "faster-whisper:tiny.en", ok: true, confidence: 88 },
  derived: { needIds: ["n1"], commitmentIds: [], proposalIds: [] },
  correctedAt: null, correctionNote: null,
} as unknown as ConversationEventV1;

const COMMITMENT = {
  party: "OWNER_PROMISED", statement: "I'll send you pictures", timeHint: "this afternoon",
  confidence: 85, sourceRef: "conversation:c1#2", reason: "definite language with a stated time",
} as CommitmentCandidateV1;

const PROPOSAL = {
  proposalId: "p1", workspace: "work", customerRef: "sarah", action: "PREPARE_CALL_NOTE",
  fields: {}, note: "Discussed budget", sourceRefs: ["conversation:c1#0"], confidence: 85,
  authorityRequired: "PREPARE_ONLY", expectedExternalEffect: "Drafts a call note for review",
  idempotencyKey: "work:sarah:PREPARE_CALL_NOTE:conversation:c1#0", status: "PROPOSED",
  createdAt: NOW, resolvedAt: null, resolutionNote: null,
} as CrmActionProposalV1;

/** Round-trip exactly as the repository does: serialise, reload, validate forward. */
function reload<T>(state: T): T {
  return validateStateV1(JSON.parse(JSON.stringify(state))) as unknown as T;
}

test("a fresh state carries the four conversation collections", () => {
  const s = createEmptyStateV1();
  assert.deepEqual(s.conversationEvents, []);
  assert.deepEqual(s.customerNeeds, []);
  assert.deepEqual(s.commitmentCandidates, []);
  assert.deepEqual(s.crmActionProposals, []);
});

test("conversation, needs, commitment and proposal all survive a reload", () => {
  const state = createEmptyStateV1();
  const monday = need({ id: "n1", attribute: "model", value: "camry" });
  const friday = need({ id: "n2", attribute: "model", value: "rav4", observedAt: "2026-08-14T10:00:00.000Z", sourceRef: "conversation:c2#1" });

  state.conversationEvents = [EVENT];
  state.customerNeeds = recordNeed([monday], friday);
  state.commitmentCandidates = [COMMITMENT];
  state.crmActionProposals = [PROPOSAL];

  const after = reload(state);

  assert.equal(after.conversationEvents.length, 1);
  assert.equal(after.conversationEvents[0]!.evidenceRef, "transcript:t1", "the transcript reference survives");
  assert.equal(after.conversationEvents[0]!.identity.relationshipRef, "sarah");
  assert.equal(after.commitmentCandidates.length, 1);
  assert.equal(after.commitmentCandidates[0]!.party, "OWNER_PROMISED");
  assert.equal(after.crmActionProposals.length, 1);
  assert.equal(after.crmActionProposals[0]!.status, "PROPOSED");

  // Both observations survive, and only the newer one is current.
  assert.equal(after.customerNeeds.length, 2, "history is not discarded on reload");
  const current = currentNeeds(after.customerNeeds, "sarah");
  assert.equal(current.length, 1);
  assert.equal(current[0]!.value, "rav4");
});

test("supersession links survive, so what-changed still answers after a restart", () => {
  const state = createEmptyStateV1();
  state.customerNeeds = recordNeed(
    [need({ id: "n1", attribute: "model", value: "camry" })],
    need({ id: "n2", attribute: "model", value: "rav4", observedAt: "2026-08-14T10:00:00.000Z" }),
  );
  const changes = needChanges(reload(state).customerNeeds, "sarah");
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.from, "camry");
  assert.equal(changes[0]!.to, "rav4");
});

test("a reload creates no duplicates", () => {
  const state = createEmptyStateV1();
  state.conversationEvents = [EVENT];
  state.customerNeeds = [need({ id: "n1", attribute: "model", value: "camry" })];
  const once = reload(state);
  const twice = reload(once);
  assert.equal(twice.conversationEvents.length, 1);
  assert.equal(twice.customerNeeds.length, 1);
});

test("a state file written before these collections existed still loads", () => {
  const legacy = createEmptyStateV1() as unknown as Record<string, unknown>;
  delete legacy.conversationEvents;
  delete legacy.customerNeeds;
  delete legacy.commitmentCandidates;
  delete legacy.crmActionProposals;

  const after = validateStateV1(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual(after.conversationEvents, [], "missing collections default forward, never fail");
  assert.deepEqual(after.customerNeeds, []);
  assert.deepEqual(after.commitmentCandidates, []);
  assert.deepEqual(after.crmActionProposals, []);
});

test("workspace survives the round trip, so isolation is not lost on restart", () => {
  const state = createEmptyStateV1();
  state.customerNeeds = [
    need({ id: "w1", attribute: "model", value: "camry", workspace: "work" }),
    need({ id: "c1", attribute: "model", value: "sienna", workspace: "compassionate-choice", relationshipRef: "kristina" }),
  ];
  const after = reload(state);
  assert.equal(after.customerNeeds.find((n) => n.id === "w1")!.workspace, "work");
  assert.equal(after.customerNeeds.find((n) => n.id === "c1")!.workspace, "compassionate-choice");
});
