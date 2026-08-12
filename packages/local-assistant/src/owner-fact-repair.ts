/**
 * Classify Owner facts that are really imported document bodies, and repair them reversibly.
 *
 * The upstream classifier no longer manufactures these, but the ones it already made are still in
 * the store, and 13 of them are enabled. Repair here means `enabled: false` and a recorded reason —
 * never deletion. The fact, its content, and its provenance all survive, so a wrong call costs a
 * re-enable rather than lost evidence. That asymmetry is the whole design: this code decides in
 * bulk about data it cannot fully understand, so every decision it makes must be cheap to undo.
 *
 * The predicate is deliberately narrow. It is aimed at the shapes actually observed in production —
 * a title that is a category-prefixed filename, or content long enough to be a file rather than a
 * statement — and it refuses to guess beyond them.
 */
import type { OwnerKnowledgeFactV1 } from "./owner-knowledge.js";

/** Longest observed curated fact content in production was 236 characters. */
const CURATED_CONTENT_CEILING = 500;

export interface FactRepairDecisionV1 {
  id: string;
  title: string;
  category: string;
  confidence: number;
  wasEnabled: boolean;
  /** Why this looks like a document rather than a fact. Empty when it is being kept. */
  reasons: string[];
  verdict: "RAW_DOCUMENT" | "CURATED";
}

export interface FactRepairPlanV1 {
  total: number;
  misclassified: number;
  misclassifiedEnabled: number;
  legitimatePreserved: number;
  decisions: FactRepairDecisionV1[];
}

type FactLike = Pick<OwnerKnowledgeFactV1, "id" | "title" | "content" | "category" | "confidence" | "enabled">;

/**
 * Why a fact reads as a raw document.
 *
 * Returns every reason rather than the first, because the reasons are the audit trail the Owner
 * needs in order to disagree with a decision.
 */
export function rawDocumentReasons(fact: FactLike): string[] {
  const title = String(fact.title ?? "").trim();
  const content = String(fact.content ?? "");
  const reasons: string[] = [];

  // The category prefix alone proves nothing: "Skill: Dispatch coordination" is real biography and
  // "owner: CLAUDE.md" is a file. What separates them is what follows the colon — a filename or a
  // path, versus a human phrase. Matching on the prefix alone would disable genuine Owner facts,
  // which is the one outcome worse than leaving a document body in the store.
  const FILE_LIKE = /(?:\.(?:md|txt|json|csv|pdf|docx?|ya?ml|xlsx?|pptx?|png|jpe?g|webp|log|rtf|heic)\b|[\\/])/i;
  const prefixed = title.match(
    /^(?:owner|skill|employment|note|doc|brand|product-service|project|business|collaborator)\s*:\s*(.+)$/i,
  );
  if (prefixed?.[1] && FILE_LIKE.test(prefixed[1])) {
    reasons.push("title is a category prefix followed by a source filename, not a statement about the Owner");
  }
  if (FILE_LIKE.test(title) && /\.[a-z0-9]{2,5}$/i.test(title)) {
    reasons.push("title is a filename");
  }
  if (content.length > CURATED_CONTENT_CEILING) {
    reasons.push(`content is ${content.length} characters — a document body, not a fact`);
  }
  // Markdown headings and code fences do not occur in a sentence someone wrote about themselves.
  if (/^#{1,6}\s/m.test(content) || content.includes("```")) {
    reasons.push("content contains document markup");
  }
  // Raw bytes from a failed extraction. Written as escapes so the literal characters never
  // appear in this source file.
  if (new RegExp("[\u0000-\u0008\u000B\u000C\u000E-\u001F]").test(content)) {
    reasons.push("content contains control bytes from a failed extraction");
  }
  return reasons;
}

export function isRawDocumentFact(fact: FactLike): boolean {
  return rawDocumentReasons(fact).length > 0;
}

/**
 * Decide about every fact without changing anything.
 *
 * Separating the decision from the mutation is what makes a dry run possible, and a bulk edit to
 * the Owner's own knowledge should always be inspectable before it happens.
 */
export function planOwnerFactRepair(facts: readonly FactLike[]): FactRepairPlanV1 {
  const decisions = facts.map((f) => {
    const reasons = rawDocumentReasons(f);
    return {
      id: String(f.id),
      title: String(f.title ?? "").slice(0, 120),
      category: String(f.category ?? "other"),
      confidence: Number(f.confidence ?? 0),
      wasEnabled: f.enabled !== false,
      reasons,
      verdict: reasons.length ? ("RAW_DOCUMENT" as const) : ("CURATED" as const),
    };
  });
  const bad = decisions.filter((d) => d.verdict === "RAW_DOCUMENT");
  return {
    total: decisions.length,
    misclassified: bad.length,
    misclassifiedEnabled: bad.filter((d) => d.wasEnabled).length,
    legitimatePreserved: decisions.length - bad.length,
    decisions,
  };
}
