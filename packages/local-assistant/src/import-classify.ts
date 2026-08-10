/**
 * Best-effort entity classification for imported documents.
 * Never invents facts — only proposes structured candidates from filename, path, and extracted text.
 * High confidence → auto-associate; uncertain → review queue item.
 */

import type { IsoTimestamp, OpaqueId, ProvenanceV1 } from "./contracts.js";
import type { OwnerKnowledgeCategoryV1 } from "./owner-knowledge.js";

export type ImportEntityKindV1 =
  | "owner"
  | "employment"
  | "skill"
  | "business"
  | "brand"
  | "product-service"
  | "collaborator"
  | "customer"
  | "prospect"
  | "contact"
  | "opportunity"
  | "project"
  | "research-document"
  | "unknown";

export type ImportReviewStatusV1 = "needs-review" | "accepted" | "rejected" | "auto-associated";

export interface ImportEntityCandidateV1 {
  kind: ImportEntityKindV1;
  /** Owner knowledge category when applicable. */
  knowledgeCategory: OwnerKnowledgeCategoryV1 | null;
  label: string;
  excerpt: string;
  confidence: number;
  evidence: string[];
}

export interface ImportReviewItemV1 {
  id: OpaqueId;
  documentId: OpaqueId | null;
  sourcePath: string;
  relativePath: string;
  status: ImportReviewStatusV1;
  candidates: ImportEntityCandidateV1[];
  /** Human-readable reason for review (ambiguity, low confidence, extraction error). */
  reason: string;
  errors: string[];
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  resolvedAt: IsoTimestamp | null;
}

/** Auto-associate when confidence is at or above this. */
export const AUTO_ASSOCIATE_CONFIDENCE = 80;
/** Below this, always queue for review if any signal exists. */
export const REVIEW_CONFIDENCE_FLOOR = 45;

const PATH_HINTS: Array<{ re: RegExp; kind: ImportEntityKindV1; category: OwnerKnowledgeCategoryV1 | null; conf: number }> = [
  { re: /\bresume|cv\b/i, kind: "owner", category: "employment", conf: 88 },
  { re: /\bemployment|work[-_]?history|career\b/i, kind: "employment", category: "employment", conf: 85 },
  { re: /\bskill|competenc/i, kind: "skill", category: "skill", conf: 82 },
  { re: /\bbrand\b/i, kind: "brand", category: "business-role", conf: 80 },
  { re: /\bproduct|service\b/i, kind: "product-service", category: "product-service", conf: 78 },
  { re: /\bcollaborat|partner\b/i, kind: "collaborator", category: "business-role", conf: 75 },
  { re: /\bcustomer|client\b/i, kind: "customer", category: null, conf: 78 },
  { re: /\bprospect|lead\b/i, kind: "prospect", category: null, conf: 76 },
  { re: /\bcontact\b/i, kind: "contact", category: null, conf: 70 },
  { re: /\bopportunit|deal\b/i, kind: "opportunity", category: null, conf: 74 },
  { re: /\bproject\b/i, kind: "project", category: "project", conf: 76 },
  { re: /\bresearch|whitepaper|brief\b/i, kind: "research-document", category: "other", conf: 72 },
  { re: /\bsales\b/i, kind: "opportunity", category: "sales-experience", conf: 68 },
  { re: /\bbusiness\b/i, kind: "business", category: "business-role", conf: 70 },
];

const TEXT_HINTS: Array<{ re: RegExp; kind: ImportEntityKindV1; category: OwnerKnowledgeCategoryV1 | null; conf: number; label: string }> = [
  { re: /\b(work experience|employment history|professional experience)\b/i, kind: "employment", category: "employment", conf: 86, label: "Employment history signals" },
  { re: /\b(skills?|competencies|proficient in)\b/i, kind: "skill", category: "skill", conf: 80, label: "Skill signals" },
  { re: /\b(curriculum vitae|résumé|resume)\b/i, kind: "owner", category: "employment", conf: 90, label: "Resume signals" },
  { re: /\b(invoice|quote|proposal for)\b/i, kind: "opportunity", category: null, conf: 72, label: "Sales document signals" },
  { re: /\b(brand guidelines|brand voice|brand identity)\b/i, kind: "brand", category: "business-role", conf: 84, label: "Brand document signals" },
  { re: /\b(product description|service offering)\b/i, kind: "product-service", category: "product-service", conf: 80, label: "Product/service signals" },
  { re: /\b(research|findings|methodology)\b/i, kind: "research-document", category: "other", conf: 70, label: "Research signals" },
  { re: /\b(project plan|milestone|deliverable)\b/i, kind: "project", category: "project", conf: 74, label: "Project signals" },
];

export function classifyImportMaterial(input: {
  filename: string;
  relativePath?: string;
  extractedText?: string;
  tags?: string[];
}): ImportEntityCandidateV1[] {
  const filename = String(input.filename ?? "");
  const rel = String(input.relativePath ?? filename);
  const text = String(input.extractedText ?? "").slice(0, 20_000);
  const tags = (input.tags ?? []).map((t) => String(t).toLowerCase());
  const haystackPath = `${rel} ${filename} ${tags.join(" ")}`;
  const byKey = new Map<string, ImportEntityCandidateV1>();

  const push = (c: ImportEntityCandidateV1) => {
    const key = `${c.kind}:${c.label}`;
    const prev = byKey.get(key);
    if (!prev || prev.confidence < c.confidence) byKey.set(key, c);
  };

  for (const hint of PATH_HINTS) {
    if (hint.re.test(haystackPath)) {
      push({
        kind: hint.kind,
        knowledgeCategory: hint.category,
        label: `${hint.kind} (path/name)`,
        excerpt: rel.slice(0, 200),
        confidence: hint.conf,
        evidence: [`path-match:${hint.re.source}`],
      });
    }
  }

  if (text.trim()) {
    for (const hint of TEXT_HINTS) {
      if (hint.re.test(text)) {
        const m = text.match(hint.re);
        push({
          kind: hint.kind,
          knowledgeCategory: hint.category,
          label: hint.label,
          excerpt: (m?.[0] ?? "").slice(0, 200),
          confidence: hint.conf,
          evidence: [`text-match:${hint.re.source}`],
        });
      }
    }
  }

  // JSON brand/product shaped objects (structure only — no invented values beyond keys present)
  if (/\.json$/i.test(filename) && text.trim().startsWith("{")) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      const keys = Object.keys(obj).map((k) => k.toLowerCase());
      if (keys.some((k) => /brand|name|positioning|audience/.test(k))) {
        push({
          kind: "brand",
          knowledgeCategory: "business-role",
          label: "JSON brand-shaped object",
          excerpt: keys.slice(0, 8).join(", "),
          confidence: 82,
          evidence: ["json-keys:brand-shaped"],
        });
      }
      if (keys.some((k) => /product|service|sku|price/.test(k))) {
        push({
          kind: "product-service",
          knowledgeCategory: "product-service",
          label: "JSON product/service-shaped object",
          excerpt: keys.slice(0, 8).join(", "),
          confidence: 80,
          evidence: ["json-keys:product-shaped"],
        });
      }
      if (keys.some((k) => /customer|client|email|phone|company/.test(k))) {
        push({
          kind: "contact",
          knowledgeCategory: null,
          label: "JSON contact-shaped object",
          excerpt: keys.slice(0, 8).join(", "),
          confidence: 78,
          evidence: ["json-keys:contact-shaped"],
        });
      }
    } catch {
      // invalid JSON — ignore; extraction may still hold raw text
    }
  }

  if (byKey.size === 0) {
    push({
      kind: "research-document",
      knowledgeCategory: "other",
      label: "Unclassified document",
      excerpt: (text || filename).slice(0, 200),
      confidence: 30,
      evidence: ["default:unclassified"],
    });
  }

  return [...byKey.values()].sort((a, b) => b.confidence - a.confidence);
}

export function shouldAutoAssociate(candidates: ImportEntityCandidateV1[]): ImportEntityCandidateV1 | null {
  const top = candidates[0];
  if (!top) return null;
  if (top.confidence < AUTO_ASSOCIATE_CONFIDENCE) return null;
  if (top.kind === "unknown") return null;
  // Ambiguous when two high-confidence different kinds
  const second = candidates[1];
  if (second && second.confidence >= AUTO_ASSOCIATE_CONFIDENCE && second.kind !== top.kind) {
    return null;
  }
  return top;
}

export function needsReview(candidates: ImportEntityCandidateV1[], extractionError?: string): { needs: boolean; reason: string } {
  if (extractionError) return { needs: true, reason: `Extraction issue: ${extractionError.slice(0, 200)}` };
  const top = candidates[0];
  if (!top) return { needs: true, reason: "No classification candidates." };
  if (top.confidence < AUTO_ASSOCIATE_CONFIDENCE) {
    if (top.confidence >= REVIEW_CONFIDENCE_FLOOR || top.kind !== "research-document") {
      return { needs: true, reason: `Uncertain classification (${top.kind} @ ${top.confidence}%).` };
    }
  }
  const auto = shouldAutoAssociate(candidates);
  if (!auto && top.confidence >= AUTO_ASSOCIATE_CONFIDENCE) {
    return { needs: true, reason: "Ambiguous high-confidence entity kinds." };
  }
  if (!auto && top.confidence < AUTO_ASSOCIATE_CONFIDENCE && top.confidence >= 30) {
    return { needs: true, reason: `Low confidence (${top.confidence}%) — Owner review recommended.` };
  }
  return { needs: false, reason: "" };
}

export function buildImportReviewItem(
  input: {
    documentId?: string | null;
    sourcePath: string;
    relativePath: string;
    candidates: ImportEntityCandidateV1[];
    reason: string;
    errors?: string[];
    status?: ImportReviewStatusV1;
  },
  context: { id: OpaqueId; now: IsoTimestamp },
): ImportReviewItemV1 {
  return {
    id: context.id,
    documentId: (input.documentId as OpaqueId) ?? null,
    sourcePath: String(input.sourcePath ?? "").slice(0, 4096),
    relativePath: String(input.relativePath ?? "").slice(0, 2000),
    status: input.status ?? "needs-review",
    candidates: input.candidates.slice(0, 12),
    reason: String(input.reason ?? "").slice(0, 1000),
    errors: (input.errors ?? []).map((e) => String(e).slice(0, 500)).slice(0, 20),
    provenance: {
      sourceType: "import",
      sourceRef: "import.classify",
      recordedAt: context.now,
    },
    createdAt: context.now,
    updatedAt: context.now,
    resolvedAt: null,
  };
}

/** Map auto-associated candidate into an owner-knowledge fact draft (Owner-confirmable content only from text). */
export function factDraftFromCandidate(
  candidate: ImportEntityCandidateV1,
  extractedText: string,
  relativePath: string,
): { category: OwnerKnowledgeCategoryV1; title: string; content: string; confidence: number } | null {
  if (!candidate.knowledgeCategory) return null;
  const content = (extractedText || candidate.excerpt || relativePath).trim().slice(0, 4000);
  if (!content) return null;
  return {
    category: candidate.knowledgeCategory,
    title: `${candidate.kind}: ${relativePath.split(/[/\\]/).pop() || candidate.label}`.slice(0, 200),
    content,
    confidence: candidate.confidence,
  };
}
