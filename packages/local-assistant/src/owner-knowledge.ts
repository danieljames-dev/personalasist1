import type { IsoTimestamp, OpaqueId, ProvenanceV1 } from "./contracts.js";

/**
 * Structured permanent Owner knowledge (Checkpoint C).
 *
 * Not one biography blob: each fact is a typed record with provenance, timestamp,
 * optional confidence, and correction history. Models may propose candidates; only
 * the owner (or explicit import under owner selection) asserts owner-confirmed facts.
 */

export type OwnerKnowledgeCategoryV1 =
  | "profile"
  | "employment"
  | "employer"
  | "role"
  | "skill"
  | "experience"
  | "accomplishment"
  | "project"
  | "preference"
  | "goal"
  | "product-service"
  | "sales-experience"
  | "business"
  | "brand"
  | "customer"
  | "prospect"
  | "collaborator"
  | "writing"
  | "business-role"
  | "process"
  | "other";

export const OWNER_KNOWLEDGE_CATEGORIES: readonly OwnerKnowledgeCategoryV1[] = [
  "profile",
  "employment",
  "employer",
  "role",
  "skill",
  "experience",
  "accomplishment",
  "project",
  "preference",
  "goal",
  "product-service",
  "sales-experience",
  "business",
  "brand",
  "customer",
  "prospect",
  "collaborator",
  "writing",
  "business-role",
  "process",
  "other",
];

export interface OwnerKnowledgeCorrectionV1 {
  at: IsoTimestamp;
  previousContent: string;
  correctedContent: string;
  reason: string;
}

export interface OwnerKnowledgeFactV1 {
  id: OpaqueId;
  category: OwnerKnowledgeCategoryV1;
  /** Short label, e.g. "Current role" or skill name. */
  title: string;
  content: string;
  /** 0–100; set when extraction is uncertain. Never invented silently. */
  confidence: number;
  enabled: boolean;
  provenance: ProvenanceV1;
  corrections: OwnerKnowledgeCorrectionV1[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface OwnerProfileSummaryV1 {
  displayName: string;
  summary: string;
  updatedAt: IsoTimestamp | null;
}

export interface OwnerKnowledgeStateV1 {
  profile: OwnerProfileSummaryV1;
  facts: OwnerKnowledgeFactV1[];
}

function fail(message: string): never {
  throw new Error(message);
}

export function emptyOwnerKnowledge(): OwnerKnowledgeStateV1 {
  return {
    profile: { displayName: "", summary: "", updatedAt: null },
    facts: [],
  };
}

export function isOwnerKnowledgeCategory(value: unknown): value is OwnerKnowledgeCategoryV1 {
  return typeof value === "string" && (OWNER_KNOWLEDGE_CATEGORIES as readonly string[]).includes(value);
}

export function buildOwnerKnowledgeFact(
  input: Record<string, unknown>,
  context: { id: OpaqueId; now: IsoTimestamp },
): OwnerKnowledgeFactV1 {
  const category = isOwnerKnowledgeCategory(input.category) ? input.category : "other";
  const title = String(input.title ?? "").trim().slice(0, 200);
  const content = String(input.content ?? "").trim().slice(0, 20_000);
  if (!title) fail("Owner knowledge fact needs a title.");
  if (!content) fail("Owner knowledge fact needs content.");
  let confidence = 80;
  if (input.confidence !== undefined && input.confidence !== null) {
    if (!Number.isSafeInteger(input.confidence) || (input.confidence as number) < 0 || (input.confidence as number) > 100) {
      fail("Confidence must be a whole number 0–100.");
    }
    confidence = input.confidence as number;
  }
  const sourceRef = String(input.sourceRef ?? "owner.knowledge").slice(0, 500);
  const sourceType = (["owner", "import", "system", "provider-proposal"] as const).includes(input.sourceType as never)
    ? (input.sourceType as ProvenanceV1["sourceType"])
    : "owner";
  return {
    id: context.id,
    category,
    title,
    content,
    confidence,
    enabled: input.enabled === false ? false : true,
    provenance: { sourceType, sourceRef, recordedAt: context.now },
    corrections: [],
    createdAt: context.now,
    updatedAt: context.now,
  };
}

export function correctOwnerKnowledgeFact(
  fact: OwnerKnowledgeFactV1,
  content: string,
  reason: string,
  now: IsoTimestamp,
): OwnerKnowledgeFactV1 {
  const next = content.trim().slice(0, 20_000);
  const why = reason.trim().slice(0, 500);
  if (!next) fail("Corrected content is required.");
  if (!why) fail("A correction reason is required.");
  return {
    ...fact,
    content: next,
    corrections: [
      ...fact.corrections,
      { at: now, previousContent: fact.content, correctedContent: next, reason: why },
    ].slice(-50),
    updatedAt: now,
  };
}

export function applyOwnerProfileSummary(
  existing: OwnerProfileSummaryV1,
  change: Record<string, unknown>,
  now: IsoTimestamp,
): OwnerProfileSummaryV1 {
  return {
    displayName:
      change.displayName !== undefined
        ? String(change.displayName).trim().slice(0, 200)
        : existing.displayName,
    summary:
      change.summary !== undefined ? String(change.summary).trim().slice(0, 8000) : existing.summary,
    updatedAt: now,
  };
}

/** Brand collaborator (Checkpoint D) — never invent roles or responsibilities. */
export interface BrandCollaboratorV1 {
  id: OpaqueId;
  name: string;
  role: string;
  /** Free-text brand responsibility as supplied by Owner — empty if unknown. */
  brandResponsibility: string;
  brandWorkspaceId: string | null;
  notes: string;
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export function buildBrandCollaborator(
  input: Record<string, unknown>,
  context: { id: OpaqueId; now: IsoTimestamp },
): BrandCollaboratorV1 {
  const name = String(input.name ?? "").trim().slice(0, 200);
  if (!name) fail("Collaborator needs a name.");
  const role = String(input.role ?? "").trim().slice(0, 200);
  const brandResponsibility = String(input.brandResponsibility ?? "").trim().slice(0, 2000);
  const brandWorkspaceId =
    typeof input.brandWorkspaceId === "string" && input.brandWorkspaceId.trim()
      ? input.brandWorkspaceId.trim().slice(0, 80)
      : null;
  const notes = String(input.notes ?? "").trim().slice(0, 10_000);
  const sourceRef = String(input.sourceRef ?? "owner.collaborator").slice(0, 500);
  return {
    id: context.id,
    name,
    role,
    brandResponsibility,
    brandWorkspaceId,
    notes,
    provenance: { sourceType: "owner", sourceRef, recordedAt: context.now },
    createdAt: context.now,
    updatedAt: context.now,
  };
}
