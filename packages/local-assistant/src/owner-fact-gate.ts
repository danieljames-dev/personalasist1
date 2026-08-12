/**
 * The gate between an imported document and an Owner fact.
 *
 * Ingestion classifies a document by keyword, so a file that merely *mentions* work — a README, an
 * architecture decision record, a set of agent instructions — arrives here looking exactly like
 * career evidence, at high confidence. Promoting it makes AION assert that a README is a personal
 * skill, and once promoted it flows into skills answers, work history, and job-application drafts.
 *
 * So the rule is: refuse the promotion, keep everything else. The document stays imported, the
 * review item stays queued, the provenance stays intact. Only the claim "this is a fact about the
 * Owner" is withheld — which is the one thing the evidence never supported.
 *
 * Every predicate here is aimed at a shape actually observed in production and refuses to guess
 * beyond it. A false refusal costs the Owner a fact they can re-add; a false promotion puts a
 * stranger's document into their résumé.
 */

/** Longest observed genuinely curated fact content in production was 236 characters. */
const CURATED_CONTENT_CEILING = 500;

/** Document markup that never appears in a sentence someone wrote about themselves. */
const DOCUMENT_MARKUP = /^#{1,6}\s|^\s*[-*]\s+\[[ x]\]|```|^\s*\|.*\|.*\|/m;

// Source refs arrive prefixed, as `import:<path>`, so `:` counts as a boundary alongside the path
// separators — without it a bare `import:requirements.txt` slipped through both patterns below.
const BOUNDARY = "(?:^|[\\\\/:])";

/** Paths inside a source tree, and the artefacts of test fixtures. */
const TECHNICAL_PATH = new RegExp(
  `${BOUNDARY}(?:docs?|sprints?|contracts?|implementation|security|decisions|architecture|adr|specs?|packages|apps|scripts|node_modules|dist|dist-test|tests?|coverage|\\.aion-local|\\.git|\\.github)(?:[\\\\/]|$)`,
  "i",
);

/** Filenames that are, by convention, instructions to a machine rather than facts about a person. */
const INSTRUCTION_FILE = new RegExp(
  `${BOUNDARY}(?:readme|claude|agents?|contributing|changelog|license|makefile|dockerfile|requirements|package(?:-lock)?|tsconfig|eslintrc|adr-\\d+)[^\\\\/]*$`,
  "i",
);

const SYNTHETIC = /\b(?:synthetic|fixture|sample data|lorem ipsum|test harness|dummy data)\b/i;

export interface PromotionCandidateV1 {
  title: string;
  content: string;
  sourceRef?: string;
}

/**
 * Reasons this candidate is a document rather than a fact.
 *
 * Returns every reason rather than the first: the reasons are the audit trail that lets the Owner
 * disagree with a refusal, and a single opaque "rejected" would be untraceable.
 */
export function rawDocumentPromotionReasons(candidate: PromotionCandidateV1): string[] {
  const title = String(candidate.title ?? "").trim();
  const content = String(candidate.content ?? "");
  const ref = String(candidate.sourceRef ?? "");
  const reasons: string[] = [];

  if (TECHNICAL_PATH.test(ref)) {
    reasons.push("source path is inside a source tree — it describes software, not the Owner");
  }
  if (INSTRUCTION_FILE.test(ref)) {
    reasons.push("source is an instruction or project-metadata file, not a personal document");
  }
  if (content.length > CURATED_CONTENT_CEILING) {
    reasons.push(`content is ${content.length} characters — a document body, not a statement`);
  }
  if (DOCUMENT_MARKUP.test(content)) {
    reasons.push("content contains document markup (headings, tables, or code fences)");
  }
  if (SYNTHETIC.test(content) || SYNTHETIC.test(title)) {
    reasons.push("content is marked synthetic or fixture material");
  }
  // Raw bytes from a failed extraction. Written as escapes so the literal characters never appear
  // in this source file.
  if (new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F]").test(content)) {
    reasons.push("content contains control bytes from a failed extraction");
  }
  return reasons;
}

export function shouldPromoteToOwnerFact(candidate: PromotionCandidateV1): boolean {
  return rawDocumentPromotionReasons(candidate).length === 0;
}
