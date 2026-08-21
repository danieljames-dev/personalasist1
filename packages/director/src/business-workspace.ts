/**
 * The portfolio: the businesses AION works for.
 *
 * AION is not built around one business. The Owner controls several, and the autonomy kernel has to
 * be able to compare work across all of them — so a business is a first-class thing rather than a
 * string on an objective.
 *
 * **What this deliberately does not hold.** The Owner has told us these businesses exist and that he
 * controls them. He has not told us what they do. So there is no field here for business model,
 * customers, revenue, products, pricing, legal structure, workflows, software, employees or
 * partners. Adding those fields would create a form, and a form gets filled in — by a model, from
 * plausibility, and then read later as fact. `category` is the one optional descriptor, and it is
 * `null` unless the Owner said it.
 *
 * The correct first objective for a business AION knows nothing about is discovery. That objective
 * can be held and worked without a single operational fact, which is the point.
 */

export const BUSINESS_WORKSPACE_SCHEMA_V1 = "aion.director.businessWorkspace.v1" as const;

export const BUSINESS_STATUSES_V1 = ["ACTIVE", "PAUSED", "DEFERRED", "ARCHIVED"] as const;
export type BusinessStatusV1 = (typeof BUSINESS_STATUSES_V1)[number];

/** Statuses whose work the scheduler may select. */
export const SCHEDULABLE_BUSINESS_STATUSES_V1: readonly BusinessStatusV1[] = ["ACTIVE"];

export interface BusinessWorkspaceV1 {
  readonly schema: typeof BUSINESS_WORKSPACE_SCHEMA_V1;
  readonly businessId: string;
  /** Exactly as the Owner names it. Never abbreviated, never re-worded. */
  readonly canonicalName: string;
  readonly status: BusinessStatusV1;
  /** Every business in this registry is one the Owner controls. Recorded, not inferred. */
  readonly ownerControlled: boolean;
  /**
   * What kind of business it is — **only when the Owner has explicitly said**.
   *
   * `null` is the normal state and is not a gap to be filled. A category invented from a name is a
   * guess that will be read as a fact by everything downstream.
   */
  readonly category: string | null;
  /** Where this record came from, in terms a person can check. */
  readonly provenance: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Stable id from the Owner's own name for the business. Lowercase, hyphenated, nothing clever. */
export function businessIdFor(canonicalName: string): string {
  const slug = String(canonicalName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (slug === "") throw new Error("a business needs a name");
  return slug;
}

export function buildBusinessWorkspace(input: {
  canonicalName: string;
  provenance: string;
  now: string;
  status?: BusinessStatusV1;
  category?: string | null;
}): BusinessWorkspaceV1 {
  const canonicalName = String(input.canonicalName).trim();
  if (canonicalName === "") throw new Error("a business needs a name");
  if (String(input.provenance).trim() === "") {
    throw new Error("a business needs provenance: who said this business exists");
  }
  return {
    schema: BUSINESS_WORKSPACE_SCHEMA_V1,
    businessId: businessIdFor(canonicalName),
    canonicalName,
    status: input.status ?? "ACTIVE",
    ownerControlled: true,
    // Absent stays absent. `?? null` rather than a default string, on purpose.
    category: input.category ?? null,
    provenance: String(input.provenance).trim(),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * What AION knows about a business, which at the start is nothing.
 *
 * Exposed so callers can ask the question honestly rather than inferring emptiness from a missing
 * field. A business with `knowsWhatItDoes: false` is a business whose only sound next step is
 * discovery.
 */
export interface BusinessKnowledgeV1 {
  readonly businessId: string;
  readonly knowsWhatItDoes: boolean;
  readonly reason: string;
}

export function assessBusinessKnowledge(business: BusinessWorkspaceV1): BusinessKnowledgeV1 {
  const known = business.category !== null && business.category.trim() !== "";
  return {
    businessId: business.businessId,
    knowsWhatItDoes: known,
    reason: known
      ? `category recorded from ${business.provenance}`
      : "nothing recorded about what this business does; discovery is the only sound first step",
  };
}
