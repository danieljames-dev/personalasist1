import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccountSummary,
  buildDailyBriefing,
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

const naturalPhrases: Array<{ text: string; intent: string }> = [
  { text: "What should I follow up on?", intent: "LIST_FOLLOWUPS" },
  { text: "Show my follow-ups.", intent: "LIST_FOLLOWUPS" },
  { text: "What are my open tasks?", intent: "LIST_FOLLOWUPS" },
  { text: "What should I do today?", intent: "WORK_QUEUE" },
  { text: "Who do I need to call?", intent: "LIST_FOLLOWUPS" },
  { text: "Who needs attention?", intent: "LIST_FOLLOWUPS" },
  { text: "What's going on with ABC?", intent: "ACCOUNT_SUMMARY" },
  { text: "What do we know about John?", intent: "ACCOUNT_SUMMARY" },
  { text: "What should I work on?", intent: "WORK_QUEUE" },
  { text: "Research ABC.", intent: "RESEARCH_COMPANY" },
  { text: "Draft John an email.", intent: "DRAFT_EMAIL" },
  { text: "Help me prepare for today.", intent: "WORK_QUEUE" },
  { text: "Look at this picture.", intent: "INGEST_IMAGE" },
  { text: "Remember this.", intent: "ADD_NOTE" },
];

for (const { text, intent } of naturalPhrases) {
  test(`natural phrase → ${intent}: ${text}`, () => {
    const r = routeCrmAssistantIntent(text);
    assert.equal(r.intent, intent, `got ${r.intent} (${r.why}) for: ${text}`);
  });
}

test("unknown phrasing falls to general assistant (not crash)", () => {
  const r = routeCrmAssistantIntent("How is the weather on Mars?");
  assert.equal(r.intent, "GENERAL_ASSISTANT_QUERY");
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
  // Owner-facing text is natural (not "Overdue follow-ups:" diagnostic headings).
  assert.match(q.text, /follow up|Priority/i);
  assert.match(q.text, new RegExp(q.overdue[0]!.customer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.doesNotMatch(q.text, /Quiet accounts \(14\+/i);
});

test("daily briefing distinguishes needs-owner vs autonomous prep", () => {
  const b = buildDailyBriefing({
    relationships: [sampleCustomer()],
    tasks: [{ title: "Call Jane", state: "ready", workspace: "work" }],
    drafts: [{ subject: "Follow up", status: "draft", toName: "Jane" }],
    documents: [],
    brands: [{ name: "Northline" }],
    workspaceId: "work",
    nowIso: "2030-06-01T00:00:00.000Z",
  });
  assert.match(b.text, /Daily briefing/);
  assert.match(b.text, /What needs you/);
  assert.match(b.text, /can handle without you/i);
  assert.ok(b.needsOwner.length >= 1);
  assert.ok(b.canHandleWithoutOwner.length >= 1);
});

test("routes proactive briefing phrases", () => {
  assert.equal(routeCrmAssistantIntent("What needs me?").intent, "WORK_QUEUE");
  assert.equal(routeCrmAssistantIntent("What changed since yesterday?").intent, "WORK_QUEUE");
  assert.equal(routeCrmAssistantIntent("Daily briefing").intent, "WORK_QUEUE");
});
