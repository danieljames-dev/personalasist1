/**
 * Classifier anchoring — the defect that filled Owner knowledge with AION's own source tree.
 *
 * Written as `/\bA|B|C\b/`, a pattern parses as `(\bA)|(B)|(C\b)`: the anchors bind only to the
 * outer alternatives, so every middle term matches mid-word, anywhere. In production this promoted
 * 21 facts to "employment" purely because the word "career" appeared inside AION's own directory
 * names, and read engineering prose such as "resume wrong phase" as a résumé at confidence 90 —
 * every single confidence-90 Owner fact was that false positive.
 *
 * The structural test below is the important one: it fails for any future hint written the same way,
 * which is the only way to stop this class of bug from returning one regex at a time.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyImportMaterial } from "../src/import-classify.js";

/**
 * Locate the TypeScript source by walking up.
 *
 * This test reads the source text itself, and it runs both from `test/` and from the compiled
 * `dist-test/test/`, which sit at different depths. Searching upward keeps one path correct for both.
 */
function findSource(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, "src", name);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`could not locate src/${name} from the test directory`);
}

const SRC = readFileSync(findSource("import-classify.ts"), "utf8");

/**
 * A top-level `|` between anchors, e.g. `/\bfoo|bar\b/`, with no enclosing group.
 * Grouped forms — `/\b(?:foo|bar)\b/` — are what we want and must not trip this.
 */
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
  assert.equal(ungroupedAlternation("\\bresume|cv\\b"), true, "must flag the broken form");
  assert.equal(ungroupedAlternation("\\b(?:resume|cv)\\b"), false, "must accept the grouped form");
  assert.equal(ungroupedAlternation("\\bbrand\\b"), false, "no alternation is fine");
  assert.equal(ungroupedAlternation("[a|b]x"), false, "a pipe inside a character class is literal");
});

test("no classifier hint leaves an alternation unanchored", () => {
  const patterns = [...SRC.matchAll(/\{ re: \/(.+?)\/[gimsuy]*,/g)].map((m) => m[1] ?? "");
  assert.ok(patterns.length >= 20, `expected the hint tables, found ${patterns.length} patterns`);
  const broken = patterns.filter((p) => ungroupedAlternation(p));
  assert.deepEqual(broken, [], `these patterns anchor only their outer alternatives: ${broken.join(" · ")}`);
});

test("engineering prose about resuming a task is not a resume", () => {
  const candidates = classifyImportMaterial({
    filename: "R6.5-THREAT-MODEL.md",
    relativePath: "docs/sprints/R6.5-THREAT-MODEL.md",
    extractedText: "If the operator has to resume wrong phase, the token issue must be verified first.",
  });
  const owner90 = candidates.filter((c) => c.kind === "owner" && c.confidence >= 90);
  assert.deepEqual(owner90, [], "an ordinary use of the verb must not become a resume signal");
});

test("a real resume is still recognised", () => {
  const candidates = classifyImportMaterial({
    filename: "resume.md",
    relativePath: "personal/resume.md",
    extractedText: "Daniel Coffman — Resume\n\nWork experience\n2008-2025 merchant fleet, deck operations.\n\nEducation\nU.S. Army.",
  });
  assert.ok(
    candidates.some((c) => c.kind === "owner" && c.confidence >= 88),
    "a document with resume structure must still classify as owner/employment",
  );
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
    const fromPath = candidates.filter((c) => /path\/name/.test(c.label ?? ""));
    assert.deepEqual(
      fromPath.map((c) => c.kind),
      [],
      `${path} must not yield path-based Owner signals`,
    );
  }
});

test("a genuine personal document outside the source tree still classifies from its path", () => {
  const candidates = classifyImportMaterial({
    filename: "work-history.md",
    relativePath: "personal/employment/work-history.md",
    extractedText: "Roles held.",
  });
  assert.ok(
    candidates.some((c) => c.kind === "employment"),
    "real personal paths must keep working",
  );
});
