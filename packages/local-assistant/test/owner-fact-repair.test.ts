/**
 * Owner-fact repair.
 *
 * This code decides in bulk about the Owner's own knowledge, so the tests care most about what it
 * must NOT do: never touch a curated fact, never delete anything, never act without a dry run being
 * possible first. The false-positive cases below are the ones that would quietly erase real
 * biography, which is a worse outcome than leaving a document body in place.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { isRawDocumentFact, planOwnerFactRepair, rawDocumentReasons } from "../src/owner-fact-repair.js";

function fact(over: Record<string, unknown>) {
  return {
    id: "f1", title: "Skill: Dispatch coordination", content: "Coordinated dispatch for a merchant fleet.",
    category: "skill", confidence: 85, enabled: true,
    ...over,
  } as never;
}

test("a category-prefixed filename is a document, not a fact", () => {
  const f = fact({ title: "owner: CLAUDE.md", content: "# CLAUDE.md — project instructions", category: "employment", confidence: 90 });
  assert.equal(isRawDocumentFact(f), true);
  assert.ok(rawDocumentReasons(f).length >= 2, "should give more than one reason");
});

test("a long body is a document even when the title looks fine", () => {
  const f = fact({ title: "Career summary", content: "x".repeat(4000) });
  assert.equal(isRawDocumentFact(f), true);
  assert.match(rawDocumentReasons(f).join(" "), /document body/);
});

test("markdown structure gives it away", () => {
  assert.equal(isRawDocumentFact(fact({ content: "## Overview\nSome notes." })), true);
  assert.equal(isRawDocumentFact(fact({ content: "Here is code:\n```ts\nconst a = 1;\n```" })), true);
});

test("control bytes from a failed extraction are caught", () => {
  // Built from escapes; the literal characters must never appear in source.
  const raw = `PDF ${String.fromCharCode(0)}${String.fromCharCode(8)} garbage`;
  assert.equal(isRawDocumentFact(fact({ content: raw })), true);
});

test("genuine curated facts are never touched", () => {
  for (const f of [
    fact({ title: "Skill: Dispatch coordination", content: "Coordinated dispatch for a merchant fleet." }),
    fact({ title: "Employer — U.S. Army", content: "Airborne combat engineer.", category: "employment" }),
    fact({ title: "Land a remote dispatcher role", content: "Land a remote dispatcher role.", category: "goal" }),
    fact({ title: "Collaborator — Kristina Leach", content: "Partner on Compassionate Choice.", category: "collaborator" }),
  ]) {
    assert.equal(isRawDocumentFact(f), false, `must keep: ${(f as { title: string }).title}`);
  }
});

test("a title containing a dot is not automatically a filename", () => {
  assert.equal(
    isRawDocumentFact(fact({ title: "Served in the U.S. Army", content: "Airborne combat engineer." })),
    false,
    "an abbreviation must not read as a file extension",
  );
});

test("the plan counts honestly and changes nothing by itself", () => {
  const facts = [
    fact({ id: "a", title: "owner: README.md", content: "# Readme", category: "employment", confidence: 90 }),
    fact({ id: "b", title: "owner: ADR-001.md", content: "# Decision", category: "skill", confidence: 90, enabled: false }),
    fact({ id: "c", title: "Skill: Dispatch coordination", content: "Coordinated dispatch." }),
  ];
  const plan = planOwnerFactRepair(facts);
  assert.equal(plan.total, 3);
  assert.equal(plan.misclassified, 2);
  assert.equal(plan.misclassifiedEnabled, 1, "an already-disabled fact is not repaired again");
  assert.equal(plan.legitimatePreserved, 1);
  // The inputs must be untouched — planning is pure.
  assert.equal((facts[0] as unknown as { enabled: boolean }).enabled, true);
  assert.equal((facts[2] as unknown as { enabled: boolean }).enabled, true);
});

test("every repair decision carries its reasons", () => {
  const plan = planOwnerFactRepair([fact({ title: "owner: CLAUDE.md", content: "# x", category: "employment" })]);
  const d = plan.decisions[0]!;
  assert.equal(d.verdict, "RAW_DOCUMENT");
  assert.ok(d.reasons.length > 0, "the Owner must be able to see why, in order to disagree");
});
