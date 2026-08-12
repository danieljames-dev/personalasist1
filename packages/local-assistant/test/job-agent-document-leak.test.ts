/**
 * No imported document may reach a job application.
 *
 * `draftCoverLetterSkeleton` picks the first enabled `employment` fact as the Owner's background.
 * When ingestion had filed README and CLAUDE.md bodies under `employment`, that text would have been
 * sent to an employer under the Owner's name. This is the highest-consequence surface in the
 * knowledge system: a wrong skills answer is embarrassing, a wrong cover letter is public.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { draftCoverLetterSkeleton, interviewPrepFromKnowledge, scoreJobFit } from "../src/job-agent.js";
import type { JobApplicationV1 } from "../src/job-agent.js";
import type { OwnerKnowledgeFactV1 } from "../src/owner-knowledge.js";

function fact(over: Record<string, unknown>): OwnerKnowledgeFactV1 {
  return {
    id: "f", category: "employment", title: "Employer — U.S. Army",
    content: "Airborne combat engineer, 1992-1996.", confidence: 88, enabled: true, corrections: [],
    provenance: { sourceType: "import", sourceRef: "import:personal/resume.md", recordedAt: "2026-08-12T00:00:00.000Z" },
    createdAt: "2026-08-12T00:00:00.000Z", updatedAt: "2026-08-12T00:00:00.000Z",
    ...over,
  } as OwnerKnowledgeFactV1;
}

const APP = {
  id: "a1", employer: "Acme Logistics", title: "Remote Dispatcher",
  fitNotes: "", status: "draft",
} as unknown as JobApplicationV1;

// A contaminated fact of exactly the shape production had: a document body filed as employment.
const README_FACT = fact({
  id: "bad",
  title: "owner: CLAUDE.md",
  content: "# CLAUDE.md — Compassionate Choice Project\n\nRead this file first at the start of every session.\n"
    + "Contact: someone@example.com, 555-0100.\n".repeat(20),
});

const REAL_FACT = fact({ id: "good" });

test("a document body is never used as cover-letter background", () => {
  const letter = draftCoverLetterSkeleton(APP, "Daniel Coffman", [README_FACT, REAL_FACT]);
  assert.ok(!letter.includes("CLAUDE.md"), "a filename must never appear in a job application");
  assert.ok(!letter.includes("someone@example.com"), "a third party's contact details must never leak");
  assert.ok(!/Read this file first/.test(letter), "document instructions must never appear");
  assert.match(letter, /Airborne combat engineer/, "the real background must be used instead");
});

test("the draft stays a draft", () => {
  const letter = draftCoverLetterSkeleton(APP, "Daniel Coffman", [REAL_FACT]);
  assert.match(letter, /DRAFT ONLY/, "AION never submits an application");
});

test("with only contaminated facts, the letter omits background rather than inventing it", () => {
  const letter = draftCoverLetterSkeleton(APP, "Daniel Coffman", [README_FACT]);
  assert.ok(!letter.includes("CLAUDE.md"));
  assert.ok(!/Background:/.test(letter), "no background is better than a document as background");
});

test("fit scoring does not count document bodies as evidence", () => {
  const posting = "Remote dispatcher. Session, project, contact, compassionate, choice.";
  const doc = scoreJobFit({ profile: {}, facts: [README_FACT] } as never, posting);
  assert.equal(doc.score, 0, "a README must contribute nothing to a fit score");
  // A genuine fact still scores, so the filter narrows evidence rather than disabling scoring.
  const real = scoreJobFit(
    { profile: {}, facts: [fact({ category: "skill", title: "Dispatch", content: "dispatcher coordination" })] } as never,
    posting,
  );
  assert.ok(real.score > 0, "real skills must still score");
});

test("interview prep never quotes a document body", () => {
  const doc = fact({ id: "bad2", category: "project", title: "project: ADR-001.md", content: "# Decision\nUse memory-first." });
  const prep = interviewPrepFromKnowledge(APP, [doc]);
  assert.ok(!prep.includes("ADR-001.md"));
  assert.ok(!prep.includes("Use memory-first"));
});
