import assert from "node:assert/strict";
import test from "node:test";
import {
  extractSubjectLoose,
  findRelationshipsByName,
  formatCustomerList,
  routeCrmAssistantIntent,
} from "../src/crm-assistant.js";
import type { RelationshipV1 } from "../src/contracts.js";

test("CRM_LIST: list phrases never route to person Show", () => {
  for (const q of [
    "Show me my customers.",
    "List my customers.",
    "My customers.",
    "Who are my customers?",
    "Show me all customers",
  ]) {
    const r = routeCrmAssistantIntent(q);
    assert.equal(r.intent, "CRM_LIST", q);
    assert.equal(r.subject, "", `subject empty for: ${q} got ${r.subject}`);
  }
});

test("CRM_LOOKUP: person names still extract", () => {
  assert.equal(routeCrmAssistantIntent("Show me John.").intent, "CRM_LOOKUP");
  assert.equal(routeCrmAssistantIntent("Show me John.").subject, "John");
  assert.equal(routeCrmAssistantIntent("Find Mike.").subject, "Mike");
  assert.equal(routeCrmAssistantIntent("Get customer John.").subject, "John");
  const prep = routeCrmAssistantIntent("Prepare me for John.");
  // Prepare may be ACCOUNT_SUMMARY or other — subject must be John if extracted for lookup paths
  assert.match(extractSubjectLoose("Prepare me for John.", /prepare me for/i), /John/i);
});

test("extractSubjectLoose: imperatives are not entities", () => {
  assert.equal(extractSubjectLoose("Show me my customers.", /\bshow/i), "");
  assert.equal(extractSubjectLoose("List my customers.", /\blist/i), "");
  assert.equal(extractSubjectLoose("Show me John.", /\bshow me/i), "John");
  assert.equal(extractSubjectLoose("Find Mike.", /\bfind/i), "Mike");
});

test("findRelationshipsByName: refuses Show/List as query", () => {
  const rels = [
    {
      id: "1",
      displayName: "Real Person",
      organisation: "Acme",
      role: "",
      notes: "",
      objections: [],
      interests: [],
      archived: false,
    },
  ] as unknown as RelationshipV1[];
  assert.deepEqual(findRelationshipsByName(rels, "Show"), []);
  assert.deepEqual(findRelationshipsByName(rels, "List"), []);
  assert.equal(findRelationshipsByName(rels, "Real").length, 1);
});

test("formatCustomerList: excludes archived and stays concise", () => {
  const now = "2030-01-01T00:00:00.000Z";
  const customers = [
    {
      id: "a",
      displayName: "Alice",
      organisation: "Co",
      lifecycle: "active",
      notes: "",
      followUps: [{ status: "open", reason: "call", channel: "phone", dueAt: now }],
      interests: [{ description: "Tacoma" }],
      interactions: [{ at: now, kind: "call", summary: "hi" }],
      nextAction: "",
      archived: false,
    },
    {
      id: "b",
      displayName: "Bob",
      organisation: "",
      lifecycle: "lead",
      notes: "",
      followUps: [],
      interests: [],
      interactions: [],
      nextAction: "email",
      archived: true,
    },
  ] as unknown as RelationshipV1[];
  const { reply, count } = formatCustomerList(customers);
  assert.equal(count, 1);
  assert.match(reply, /Alice/);
  assert.doesNotMatch(reply, /Bob/);
});
