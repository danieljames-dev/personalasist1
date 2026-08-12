/**
 * Classifier anchoring and the document→Owner-fact gate.
 *
 * Written `/\bA|B|C\b/`, a pattern parses as `(\bA)|(B)|(C\b)`: the anchors bind only to the outer
 * alternatives, so every middle term matches mid-word, anywhere. In production this promoted facts
 * to "employment" purely because the word "career" appears in AION's own directory names, and read
 * engineering prose such as "resume wrong phase" as a résumé at confidence 90 — every single
 * confidence-90 Owner fact was that false positive.
 *
 * The structural test is the important one: it fails for any future hint written the same way, which
 * is the only way to stop this class of bug from returning one regex at a time.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyImportMaterial, shouldAutoAssociate } from "../src/import-classify.js";
import { rawDocumentPromotionReasons, shouldPromoteToOwnerFact } from "../src/owner-fact-gate.js";

/** This test reads its own source, and runs from both `test/` and the compiled `dist-test/test/`. */
function findSource(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, "src", name);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`could not locate src/${name}`);
}

const SRC = readFileSync(findSource("import-classify.ts"), "utf8");

/** A top-level `|` outside any group — the broken shape. Grouped forms must not trip this. */
function ungroupedAlternation(source: string): boolean {
  let depth = 0;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === "\\") { i += 1; continue; }
    if (c === "[") { while (i < source.length && source[i] !== "]") { if (source[i] === "\\") i += 1; i += 1; } continue; }
    if (c === "(") depth += 1;
    else if (c === ")") depth -= 1;
    else if (c === "|" && depth === 0) return true;
  }
  return false;
}

test("the anchoring detector recognises the shape it is meant to catch", () => {
  assert.equal(ungroupedAlternation("\\bresume|cv\\b"), true);
  assert.equal(ungroupedAlternation("\\b(?:resume|cv)\\b"), false);
  assert.equal(ungroupedAlternation("\\bbrand\\b"), false);
  assert.equal(ungroupedAlternation("[a|b]x"), false, "a pipe in a character class is literal");
});

test("no classifier hint leaves an alternation unanchored", () => {
  const patterns = [...SRC.matchAll(/\{ re: \/(.+?)\/[gimsuy]*,/g)].map((m) => m[1] ?? "");
  assert.ok(patterns.length >= 20, `expected the hint tables, found ${patterns.length}`);
  const broken = patterns.filter((p) => ungroupedAlternation(p));
  assert.deepEqual(broken, [], `these anchor only their outer alternatives: ${broken.join(" · ")}`);
});

test("engineering prose about resuming a task is not a resume", () => {
  const candidates = classifyImportMaterial({
    filename: "R6.5-THREAT-MODEL.md",
    relativePath: "docs/sprints/R6.5-THREAT-MODEL.md",
    extractedText: "If the operator has to resume wrong phase, the token issue must be verified first.",
  });
  assert.deepEqual(
    candidates.filter((c) => c.kind === "owner" && c.confidence >= 90),
    [],
    "the English verb must not become a resume signal",
  );
});

test("a real resume is still recognised", () => {
  const candidates = classifyImportMaterial({
    filename: "resume.md",
    relativePath: "personal/resume.md",
    extractedText: "Daniel Coffman — Resume\n\nWork experience\n2008-2025 merchant fleet.\n\nEducation\nU.S. Army.",
  });
  assert.ok(candidates.some((c) => c.kind === "owner" && c.confidence >= 88), "real resumes must still classify");
});

test("AION's own source tree is not the Owner's employment history", () => {
  for (const path of [
    "docs/sprints/sprint-3.0-career-vertical-slice/specification.md",
    "packages/local-assistant/src/career-profile.ts",
    "docs/decisions/ADR-001-memory-first.md",
  ]) {
    const candidates = classifyImportMaterial({
      filename: path.split("/").pop() ?? path,
      relativePath: path,
      extractedText: "Design notes for the feature.",
    });
    assert.deepEqual(
      candidates.filter((c) => /path\/name/.test(c.label ?? "")).map((c) => c.kind),
      [],
      `${path} must yield no path-based Owner signal`,
    );
  }
});

test("a genuine personal document still classifies from its path", () => {
  const candidates = classifyImportMaterial({
    filename: "work-history.md",
    relativePath: "personal/employment/work-history.md",
    extractedText: "Roles held.",
  });
  assert.ok(candidates.some((c) => c.kind === "employment"));
});

function cand(kind: string, confidence: number, label: string) {
  return { kind, label, confidence, knowledgeCategory: null, excerpt: "", evidence: [] };
}

test("a conflicting subject hidden behind same-kind duplicates still blocks", () => {
  // Candidates dedupe on kind+label, so two same-subject hits can occupy slots 0 and 1 and hide a
  // conflicting subject behind them. Checking only candidates[1] let that auto-associate.
  const candidates = [
    cand("owner", 90, "a"), cand("owner", 88, "b"), cand("customer", 86, "c"),
  ] as unknown as Parameters<typeof shouldAutoAssociate>[0];
  assert.equal(shouldAutoAssociate(candidates), null, "owner vs customer is real ambiguity");
});

test("facets of one subject are not treated as disagreement", () => {
  // A real resume fires owner + employment + skill at once. That is one document about one person,
  // not a conflict — blocking it would stop genuine resumes from ever classifying.
  const candidates = [
    cand("owner", 90, "resume"), cand("employment", 86, "history"), cand("skill", 80, "skills"),
  ] as unknown as Parameters<typeof shouldAutoAssociate>[0];
  assert.ok(shouldAutoAssociate(candidates), "a resume must still auto-associate");
});

// ---------------------------------------------------------------------------
// The promotion gate
// ---------------------------------------------------------------------------

test("technical documents are refused promotion to Owner facts", () => {
  for (const c of [
    { title: "Owner profile", content: "# CLAUDE.md\nRead this first.", sourceRef: "import:CLAUDE.md" },
    { title: "Skill", content: "Design notes.", sourceRef: "import:docs/decisions/ADR-001.md" },
    { title: "Employment", content: "node>=20", sourceRef: "import:requirements.txt" },
    { title: "Owner", content: "# Readme\n\n| a | b |\n| - | - |", sourceRef: "import:README.md" },
  ]) {
    assert.equal(shouldPromoteToOwnerFact(c), false, `must refuse: ${c.sourceRef}`);
    assert.ok(rawDocumentPromotionReasons(c).length > 0, "a refusal must carry its reason");
  }
});

test("a long document body is refused even with a plausible title", () => {
  assert.equal(
    shouldPromoteToOwnerFact({ title: "Career summary", content: "x".repeat(4000), sourceRef: "import:notes.md" }),
    false,
  );
});

test("control bytes from a failed extraction are refused", () => {
  const raw = `PDF ${String.fromCharCode(0)}${String.fromCharCode(8)} garbage`;
  assert.equal(shouldPromoteToOwnerFact({ title: "Owner", content: raw, sourceRef: "import:x.pdf" }), false);
});

test("genuine curated statements are still promoted", () => {
  for (const c of [
    { title: "Employer — U.S. Army", content: "Airborne combat engineer, 1992-1996.", sourceRef: "import:personal/resume.md" },
    { title: "Core strengths", content: "Dispatch coordination; remote customer support.", sourceRef: "import:personal/skills.md" },
    { title: "Goal", content: "Seek remote dispatcher work.", sourceRef: "import:personal/plan.md" },
  ]) {
    assert.equal(shouldPromoteToOwnerFact(c), true, `must promote: ${c.title}`);
  }
});
