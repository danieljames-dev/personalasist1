import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccountSummary,
  buildWorkQueue,
  findRelationshipsByName,
  routeCrmAssistantIntent,
} from "../src/crm-assistant.js";
import type { RelationshipV1 } from "../src/contracts.js";

function sampleCustomer(over: Partial<RelationshipV1> = {}): RelationshipV1 {
  const now = "2030-01-01T00:00:00.000Z";
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reference: "rel-1",
    workspace: "work",
    relationshipType: "prospect",
    displayName: "Jane Test",
    organisation: "ACME R7 TEST COMPANY",
    role: "Buyer",
    lifecycle: "contacted",
    origin: "owner-created",
    contactMethods: [],
    communicationPreference: "email",
    source: "test",
    notes: "",
    interests: [{ kind: "product", description: "Product Alpha", notedAt: now }],
    objections: ["delivery time"],
    preferences: [],
    appointments: [],
    followUps: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        dueAt: "2020-01-01T00:00:00.000Z",
        channel: "email",
        reason: "Follow up",
        status: "open",
        outcome: "",
        createdAt: now,
        completedAt: null,
      },
    ],
    nextAction: "Send estimate",
    nextActionAt: now,
    lastContactAt: now,
    interactions: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        at: now,
        kind: "call",
        summary: "Interested in Product Alpha",
        detail: "",
        lifecycleAfter: null,
        actor: "owner",
      },
    ],
    taskIds: [],
    routineIds: [],
    planIds: [],
    opportunityIds: [],
    outcome: { state: "open", at: null, detail: "" },
    archived: false,
    provenance: { sourceType: "owner", sourceRef: "test", recordedAt: now },
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

test("routes account summary intent", () => {
  const r = routeCrmAssistantIntent("What do we know about ACME R7 TEST COMPANY?");
  assert.equal(r.intent, "ACCOUNT_SUMMARY");
  assert.match(r.subject, /ACME/i);
});

test("routes email draft intent", () => {
  const r = routeCrmAssistantIntent("Draft Jane a follow-up email.");
  assert.equal(r.intent, "DRAFT_EMAIL");
});

test("account summary uses stored objections", () => {
  const s = buildAccountSummary(sampleCustomer());
  assert.match(s.text, /delivery time/);
  assert.match(s.text, /Product Alpha/);
  assert.match(s.text, /Send estimate/);
});

test("find by organisation name", () => {
  const hits = findRelationshipsByName([sampleCustomer()], "ACME R7");
  assert.equal(hits.length, 1);
});

test("work queue lists overdue follow-ups", () => {
  const q = buildWorkQueue([sampleCustomer()], "2030-06-01T00:00:00.000Z");
  assert.ok(q.overdue.length >= 1);
  assert.match(q.text, /Overdue/);
});
