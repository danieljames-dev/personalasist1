/**
 * Owner-knowledge routing and the classifier defects behind bad Owner facts.
 *
 * The cases below are drawn from live production misbehaviour, not from imagination. Asking
 * "What projects am I working on?" returned a car buyer's account summary, because the CRM name
 * matcher looked for the token "am" anywhere inside any customer record and found it in "Camry".
 * That single unanchored substring match meant almost any question about the Owner's own work could
 * be answered with a stranger's contact details.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { findRelationshipsByName, routeCrmAssistantIntent } from "../src/crm-assistant.js";
import { buildGoalViews, formatGoalsAnswer, formatProjectsAnswer, goalOrigin } from "../src/owner-goals-projects.js";
import type { RelationshipV1 } from "../src/contracts.js";
import type { OwnerKnowledgeFactV1 } from "../src/owner-knowledge.js";

function rel(over: Partial<RelationshipV1> & { id: string; displayName: string }): RelationshipV1 {
  return {
    organisation: "", role: "", notes: "", objections: [], interests: [],
    archived: false, workspace: "work", kind: "customer", lifecycle: "prospect",
    ...over,
  } as unknown as RelationshipV1;
}

// The exact record that hijacked Owner questions in production.
const SARAH = rel({
  id: "r1",
  displayName: "Sarah",
  notes: "Add Sarah as a prospect. She is interested in a Camry under 30000.",
});

test("a question about the Owner's own work never matches a customer by accident", () => {
  for (const q of [
    "What am I working toward?",
    "What projects am I working on?",
    "What are my goals?",
    "What am I building?",
  ]) {
    assert.deepEqual(
      findRelationshipsByName([SARAH], q.toLowerCase()),
      [],
      `"${q}" must not match a customer record`,
    );
  }
});

test("the specific am-inside-Camry collision is dead", () => {
  assert.deepEqual(findRelationshipsByName([SARAH], "am"), [], "a two-letter fragment is not a name");
  assert.deepEqual(findRelationshipsByName([SARAH], "car"), [], "a mid-word prefix of Camry is not a name");
});

test("genuine name lookup still works, including partial names", () => {
  assert.equal(findRelationshipsByName([SARAH], "sarah").length, 1);
  assert.equal(findRelationshipsByName([SARAH], "sar").length, 1, "partial first-name lookup must survive");
  assert.equal(findRelationshipsByName([SARAH], "camry").length, 1, "a real word in the notes still matches");
  const acme = rel({ id: "r2", displayName: "Jane Doe", organisation: "ACME Corp" });
  assert.equal(findRelationshipsByName([acme], "acme").length, 1);
  assert.equal(findRelationshipsByName([acme], "jane").length, 1);
});

test("goals route to goals, not to import status", () => {
  for (const q of [
    "What are my goals?",
    "What are my current goals?",
    "Show me my goals",
    "What am I working toward?",
    "What am I trying to accomplish?",
    "What do I want to get done?",
    "What are my top priorities?",
    "What is most important to me?",
  ]) {
    assert.equal(routeCrmAssistantIntent(q).intent, "OWNER_GOALS", `"${q}" must route to OWNER_GOALS`);
  }
});

test("projects route to projects", () => {
  for (const q of [
    "What projects am I working on?",
    "Show me my projects",
    "What am I building?",
    "What is unfinished?",
    "Project status",
    "List projects",
  ]) {
    assert.equal(routeCrmAssistantIntent(q).intent, "PROJECT_STATUS", `"${q}" must route to PROJECT_STATUS`);
  }
});

test("import-status questions still reach import status", () => {
  assert.equal(routeCrmAssistantIntent("What did you import?").intent, "IMPORT_STATUS");
  assert.equal(routeCrmAssistantIntent("data completeness").intent, "IMPORT_STATUS");
});

function fact(over: Partial<OwnerKnowledgeFactV1>): OwnerKnowledgeFactV1 {
  return {
    id: "f1", category: "goal", title: "Goal — a thing", content: "Do the thing.",
    confidence: 80, enabled: true, corrections: [],
    provenance: { sourceType: "import", sourceRef: "import:doc.md", recordedAt: "2026-08-12T00:00:00.000Z" },
    createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z",
    ...over,
  } as OwnerKnowledgeFactV1;
}

test("a goal AION inferred is never presented as something the Owner said", () => {
  const derived = fact({ title: "Goal — remote dispatch role", content: "Seek remote dispatcher work." });
  assert.equal(goalOrigin(derived), "DERIVED_FROM_DOCUMENTS");
  const answer = formatGoalsAnswer(buildGoalViews([derived]));
  assert.match(answer, /from your documents/i, "must disclose that AION worked this out");
  assert.ok(!/^your goals:/im.test(answer), "must not claim the Owner stated it");
  assert.match(answer, /Remember my goal is/i, "must offer the correction path");
});

test("a goal the Owner stated is presented as theirs", () => {
  const stated = fact({
    title: "Land a remote dispatcher role",
    content: "Land a remote dispatcher role.",
    provenance: { sourceType: "owner", sourceRef: "assistant.goal.capture", recordedAt: "2026-08-12T00:00:00.000Z" },
  });
  assert.equal(goalOrigin(stated), "OWNER_STATED");
  const answer = formatGoalsAnswer(buildGoalViews([stated]));
  assert.match(answer, /^Your goal:/im);
  assert.ok(!/from your documents/i.test(answer));
  // A stated goal uses one sentence for both title and detail; it must not be echoed back twice.
  assert.equal(
    (answer.match(/Land a remote dispatcher role/gi) ?? []).length,
    1,
    `the goal text must appear once, got: ${answer}`,
  );
});

test("no goals reads as an invitation, not an error", () => {
  const answer = formatGoalsAnswer([]);
  assert.match(answer, /don't have any goals recorded/i);
  assert.match(answer, /Remember my goal is/i);
  assert.ok(!/\b(null|undefined|GOAL_|category)\b/.test(answer), "no internal vocabulary");
});

test("idea-stage projects are not dressed up as progress", () => {
  const answer = formatProjectsAnswer([
    { title: "local services", stage: "idea", standing: "\"local services\" is at idea. No specification has been written.", createdAt: "2026-08-01T00:00:00.000Z" },
    { title: "second thing", stage: "idea", standing: "\"second thing\" is at idea. No plan yet.", createdAt: "2026-08-02T00:00:00.000Z" },
  ]);
  assert.match(answer, /still at the idea stage/i, "must say plainly that nothing has moved");
  assert.match(answer, /No specification has been written/, "standing text is rendered verbatim");
});

test("no projects says so rather than falling back to a briefing", () => {
  const answer = formatProjectsAnswer([]);
  assert.match(answer, /don't have any projects recorded/i);
});
