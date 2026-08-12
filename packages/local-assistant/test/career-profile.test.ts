/**
 * Career profile regressions.
 *
 * Two failure modes matter here. The first is the one that prompted this work: the knowledge
 * existed but the question never reached it, so a real Owner question fell through to a generic
 * briefing. The second is subtler — ingestion files raw document bodies under career categories at
 * high confidence, and listing those as "skills" would read as though AION believes a README is a
 * competency.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCareerProfile,
  formatSkillsAnswer,
  formatWorkHistoryAnswer,
  formatJobFitAnswer,
  isDocumentDumpFact,
} from "../src/career-profile.js";
import { routeCrmAssistantIntent } from "../src/crm-assistant.js";

const FACTS = [
  { category: "skill", title: "Core strengths — ops and support", confidence: 88, enabled: true,
    content: "Remote customer support; dispatch/scheduling/coordination; maritime logistics; safety/security",
    provenance: { sourceRef: "owner.knowledge" } },
  { category: "skill", title: "skill: ADR-001-memory-first.md", confidence: 80, enabled: true,
    content: "# ADR-001: Memory is the Single Source of Truth\n\n**Status:** Accepted",
    provenance: { sourceRef: "import:ADR-001-memory-first.md" } },
  { category: "employer", title: "Employer — U.S. Army", confidence: 88, enabled: true,
    content: "U.S. Army 12B Combat Engineer / Airborne, E-4, 1992–1997. Army Commendation Medal.",
    provenance: { sourceRef: "owner.knowledge" } },
  { category: "employer", title: "Employer — U.S. Merchant Fleet / SIU", confidence: 88, enabled: true,
    content: "Seafarers International Union assignments; representative lines include Maersk, Liberty.",
    provenance: { sourceRef: "owner.knowledge" } },
  { category: "employer", title: "Lakeland Toyota", confidence: 100, enabled: true,
    content: "Owner works at Lakeland Toyota (Owner-supplied).", provenance: { sourceRef: "owner.dealership" } },
  { category: "role", title: "Roles held — deck / bosun / watch", confidence: 88, enabled: true,
    content: "Able Seaman; Bosun; Dayman; Watchstander", provenance: { sourceRef: "owner.knowledge" } },
  { category: "accomplishment", title: "Credential set — mariner", confidence: 88, enabled: true,
    content: "Merchant Mariner Credential (active), STCW (active), Able Seaman endorsement, TWIC",
    provenance: { sourceRef: "owner.knowledge" } },
  { category: "goal", title: "Goal — remote logistics / dispatch / support role", confidence: 82, enabled: true,
    content: "Seek remote dispatcher, logistics coordinator, or customer support work using maritime ops experience.",
    provenance: { sourceRef: "owner.knowledge" } },
  { category: "employment", title: "owner: CLAUDE.md", confidence: 90, enabled: true,
    content: "# CLAUDE.md — Compassionate Choice Project", provenance: { sourceRef: "import:CLAUDE.md" } },
  { category: "employment", title: "owner: EXTERNAL-DRIVE-README.txt", confidence: 90, enabled: true,
    content: "WESTERN DIGITAL EXTERNAL", provenance: { sourceRef: "import:EXTERNAL-DRIVE-README.txt" } },
  { category: "skill", title: "disabled noise", confidence: 90, enabled: false,
    content: "should never appear", provenance: { sourceRef: "import:noise" } },
];

test("real Owner career questions route to career knowledge, not a generic briefing", () => {
  const questions = [
    "What are my strongest skills?",
    "What skills do I have?",
    "What am I good at?",
    "What jobs fit me?",
    "What kind of work should I look for?",
    "What experience do I have?",
    "What jobs have I done?",
    "What is my work history?",
    "What industries have I worked in?",
    "Where have I worked?",
    "Am I qualified?",
  ];
  for (const q of questions) {
    assert.equal(routeCrmAssistantIntent(q).intent, "CAREER_PROFILE", `"${q}" must reach career knowledge`);
  }
});

test("career routing does not swallow unrelated questions", () => {
  for (const q of ["What vehicles do we have?", "Show me Camrys under 30k", "What needs my attention"]) {
    assert.notEqual(routeCrmAssistantIntent(q).intent, "CAREER_PROFILE", `"${q}" must not route to career`);
  }
});

test("ingested document bodies are recognised and excluded from career facts", () => {
  assert.equal(isDocumentDumpFact({ title: "owner: CLAUDE.md" }), true);
  assert.equal(isDocumentDumpFact({ title: "skill: ADR-001-memory-first.md" }), true);
  assert.equal(isDocumentDumpFact({ title: "WEEK_LAUNCH_CHECKLIST.md" }), true);
  assert.equal(isDocumentDumpFact({ title: "Employer — U.S. Army" }), false);
  assert.equal(isDocumentDumpFact({ title: "Core strengths — ops and support" }), false);
});

test("skills answer uses curated evidence and never lists a README as a skill", () => {
  const profile = buildCareerProfile(FACTS);
  const text = formatSkillsAnswer(profile);
  assert.match(text, /Remote customer support/i);
  assert.match(text, /dispatch\/scheduling\/coordination/i);
  assert.ok(!/ADR-001/i.test(text), "a document body must never be presented as a skill");
  assert.ok(!/CLAUDE\.md/i.test(text));
  assert.ok(!/should never appear/i.test(text), "disabled facts must stay out");
  assert.match(text, /directly evidenced|repeatedly evidenced/i, "evidence strength must be stated");
  assert.match(text, /Not yet established/i, "gaps must be stated rather than implied complete");
});

test("work history keeps real date ranges and refuses to invent missing ones", () => {
  const profile = buildCareerProfile(FACTS);
  const text = formatWorkHistoryAnswer(profile);
  assert.match(text, /U\.S\. Army/);
  assert.match(text, /1992\s*[–—-]\s*1997/, "a stated date range must survive");
  assert.match(text, /Lakeland Toyota.*dates not established/is, "absent dates stay absent, never guessed");
  assert.match(text, /Able Seaman/);
});

test("job fit separates role fit from an actual opening", () => {
  const profile = buildCareerProfile(FACTS);
  const text = formatJobFitAnswer(profile);
  assert.match(text, /ROLE FIT/);
  assert.match(text, /not current openings/i);
  assert.match(text, /is not a CURRENT OPENING/i, "AION must never imply a vacancy exists");
  assert.match(text, /Known gaps/i);
  assert.match(text, /remote dispatcher/i, "the stated goal should inform fit");
});

test("profile reports how much was excluded so coverage is not overstated", () => {
  const profile = buildCareerProfile(FACTS);
  assert.ok(profile.documentDumpsExcluded >= 3, "document dumps are counted, not silently dropped");
  assert.ok(profile.factsConsidered > 0);
  assert.ok(profile.gaps.length > 0);
});

test("an empty knowledge store says so instead of inventing a career", () => {
  const profile = buildCareerProfile([]);
  assert.match(formatSkillsAnswer(profile), /No skill facts are grounded yet/i);
  assert.match(formatWorkHistoryAnswer(profile), /No employer facts are grounded yet/i);
  assert.match(formatJobFitAnswer(profile), /Not enough grounded career evidence/i);
});
