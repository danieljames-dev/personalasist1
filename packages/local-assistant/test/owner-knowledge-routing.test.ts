/**
 * Owner-knowledge routing, and the CRM matcher that was answering over the top of it.
 *
 * The matcher tested here compared each query token as a bare substring against every field of every
 * customer record. The token "am" appears inside "Camry" in a note on the prospect Sarah, so a whole
 * family of first-person questions — "What am I working toward?", "How am I doing?", "What am I
 * forgetting?" — came back as that prospect's account summary. The Owner asking about their own life
 * got a stranger's CRM record.
 *
 * The regression matrix below is the point of this file: the MUST-NOT list is what makes the fix
 * safe, and the MUST list is what stops the fix from being over-tightened into uselessness.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { findRelationshipsByName, routeCrmAssistantIntent } from "../src/crm-assistant.js";
import type { RelationshipV1 } from "../src/contracts.js";

function rel(over: Partial<RelationshipV1> & { id: string; displayName: string }): RelationshipV1 {
  return {
    organisation: "", role: "", notes: "", objections: [], interests: [],
    archived: false, workspace: "work", kind: "customer", lifecycle: "prospect",
    ...over,
  } as unknown as RelationshipV1;
}

/** The real production record, verbatim — this is the one that hijacked Owner questions. */
const SARAH = rel({
  id: "r1",
  displayName: "Sarah",
  notes: "Add Sarah as a prospect. She is interested in a Camry under 30000.",
  interests: [{ description: "Camry under 30000" }] as unknown as RelationshipV1["interests"],
});

const MUST_NOT_MATCH = [
  "What am I working toward?",
  "What am I trying to accomplish?",
  "What are my top priorities?",
  "What is most important to me right now?",
  "How am I doing?",
  "Am I on track?",
  "What am I missing?",
  "Where am I behind?",
  "Am I ready for tomorrow?",
  "What am I forgetting?",
  "What projects am I working on?",
  "What are my goals?",
];

const MUST_MATCH = [
  "Sarah",
  "sarah",
  "Who is Sarah?",
  "Tell me about Sarah",
  "What did Sarah want?",
  "Sarah's next step",
  "prep me for Sarah",
  "Camry",
  "the Camry buyer",
  "Sarah Camry",
  "Sarah prospect",
  "Camry under 30000",
];

test("no first-person question about the Owner resolves a customer", () => {
  const hits = MUST_NOT_MATCH.filter((q) => findRelationshipsByName([SARAH], q.toLowerCase()).length > 0);
  assert.deepEqual(hits, [], `these must not resolve Sarah: ${hits.join(" · ")}`);
});

test("the am-inside-Camry collision is dead, including the bare token", () => {
  assert.deepEqual(findRelationshipsByName([SARAH], "am"), [], "a two-letter fragment is not a name");
  assert.deepEqual(findRelationshipsByName([SARAH], "car"), [], "a mid-word fragment is not a name");
  assert.deepEqual(findRelationshipsByName([SARAH], "ara"), [], "a fragment inside Sarah is not a name");
});

test("real customer lookup still works, including partial names and possessives", () => {
  const misses = MUST_MATCH.filter((q) => findRelationshipsByName([SARAH], q.toLowerCase()).length === 0);
  assert.deepEqual(misses, [], `these must resolve Sarah: ${misses.join(" · ")}`);
});

test("partial first-name prefix lookup is preserved", () => {
  assert.equal(findRelationshipsByName([SARAH], "sar").length, 1, "prefix lookup is intentional behaviour");
  const acme = rel({ id: "r2", displayName: "Jane Doe", organisation: "ACME Corp" });
  assert.equal(findRelationshipsByName([acme], "acme").length, 1);
  assert.equal(findRelationshipsByName([acme], "jane").length, 1);
  assert.equal(findRelationshipsByName([acme], "doe").length, 1);
});

test("one customer's question never resolves a different customer", () => {
  const bob = rel({ id: "r3", displayName: "Bob", notes: "Wants a Tundra." });
  assert.deepEqual(findRelationshipsByName([SARAH, bob], "who is bob?").map((r) => r.id), ["r3"]);
  assert.deepEqual(findRelationshipsByName([SARAH, bob], "who is sarah?").map((r) => r.id), ["r1"]);
});

// ---------------------------------------------------------------------------
// Goals routing
// ---------------------------------------------------------------------------

test("every natural goals phrasing routes to OWNER_GOALS", () => {
  for (const q of [
    "What are my goals?",
    "What are my current goals?",
    "Show me my goals",
    "What am I working toward?",
    "What am I trying to accomplish?",
    "What are my top priorities?",
    "What are my objectives?",
    "What is most important to me right now?",
  ]) {
    assert.equal(routeCrmAssistantIntent(q).intent, "OWNER_GOALS", `"${q}"`);
  }
});

test("\"most important today\" stays with the daily path, not goals", () => {
  // "to me" is about the Owner's goals; "today" is about the day's queue. Stealing the second would
  // break the morning cycle, which also writes state.
  for (const q of ["What is most important today?", "What should I do today?", "What matters today?"]) {
    assert.notEqual(routeCrmAssistantIntent(q).intent, "OWNER_GOALS", `"${q}" must not route to goals`);
  }
});

test("goal capture phrasings route to OWNER_GOALS so they can be stored", () => {
  for (const q of [
    "Remember my goal is to land a remote dispatcher role",
    "My goal is to launch by December",
    "Add a goal: finish the AHCA paperwork",
    "Set a goal to get 3 clients",
  ]) {
    assert.equal(routeCrmAssistantIntent(q).intent, "OWNER_GOALS", `"${q}"`);
  }
});

test("import-status questions are unchanged", () => {
  assert.equal(routeCrmAssistantIntent("What did you import?").intent, "IMPORT_STATUS");
  assert.equal(routeCrmAssistantIntent("data completeness").intent, "IMPORT_STATUS");
  assert.equal(routeCrmAssistantIntent("What needs review?").intent, "IMPORT_STATUS");
});

test("projects phrasings route to PROJECT_STATUS", () => {
  for (const q of [
    "What projects am I working on?",
    "Show me my projects",
    "What am I building?",
    "What is unfinished?",
    "What projects are active?",
    "What projects are paused?",
  ]) {
    assert.equal(routeCrmAssistantIntent(q).intent, "PROJECT_STATUS", `"${q}"`);
  }
});
