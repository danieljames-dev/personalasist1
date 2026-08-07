import type { IsoTimestamp, OpaqueId } from "./contracts.js";

/**
 * Workspaces.
 *
 * V1.1 had exactly two: Personal and Work. That was never the shape of the problem — a person can
 * hold a job, run a side business, and build a product, and those are three separate bodies of
 * information that must not bleed into one another. So a workspace is now a record rather than a
 * literal, and Personal and Work are simply the two AION creates for you.
 *
 * Isolation is the whole point and it is structural, not advisory: every record that can hold
 * owner content carries the id of the workspace it was created in, reads are filtered by that id,
 * and nothing in this module copies a record from one workspace to another. Moving something
 * between workspaces is an explicit owner act with its own audit entry — there is no implicit path.
 */

export type WorkspaceKindV1 = "personal" | "work" | "business";
export const WORKSPACE_KINDS: readonly WorkspaceKindV1[] = ["personal", "work", "business"];

/** The two AION always provides. They cannot be deleted, because state always has somewhere to live. */
export const BUILT_IN_WORKSPACE_IDS = ["personal", "work"] as const;
export type BuiltInWorkspaceIdV1 = (typeof BUILT_IN_WORKSPACE_IDS)[number];

/**
 * A product, service, or offer a business workspace is built around. Descriptive only: AION holds
 * no price list of record, no inventory, and no order — those live in whatever system actually
 * runs the business.
 */
export interface BrandProductV1 {
  id: OpaqueId;
  name: string;
  summary: string;
  status: "idea" | "in-development" | "available" | "retired";
  /** Free text so the owner can describe a model AION has never heard of. Never parsed as money. */
  pricingNote: string;
  createdAt: IsoTimestamp;
}

/**
 * The identity of a business or brand workspace. Everything here is owner-supplied. AION never
 * infers a brand's positioning, invents an audience, or fills a field in because it sounded likely.
 */
export interface BrandProfileV1 {
  name: string;
  positioning: string;
  audience: string;
  valueProposition: string;
  channels: string[];
  products: BrandProductV1[];
  notes: string;
}

export interface WorkspaceV1 {
  id: string;
  kind: WorkspaceKindV1;
  label: string;
  purpose: string;
  /** True for Personal and Work. A built-in workspace can be relabelled but never removed. */
  builtIn: boolean;
  archived: boolean;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  /** Present only on a business workspace. Personal and Work have no brand identity. */
  brand: BrandProfileV1 | null;
}

function fail(message: string): never { throw new Error(message); }

const ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/u;

/**
 * Turns an owner-supplied label into a stable workspace id.
 *
 * Deterministic, so the same label always produces the same id and a re-run of the same setup is
 * idempotent rather than accumulating near-duplicates. The id is not a secret and is safe to show.
 */
export function workspaceIdFromLabel(label: string): string {
  const slug = String(label ?? "").normalize("NFKD").toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 40);
  if (!slug || !/^[a-z]/u.test(slug)) fail("A workspace name must contain at least one letter that AION can use as its identifier.");
  return slug.replace(/-+$/u, "");
}

export function isWorkspaceId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function label(value: unknown, field: string, max = 80): string {
  if (typeof value !== "string") fail(`${field} must be text.`);
  const text = value.trim();
  if (!text || text.length > max) fail(`${field} must be between 1 and ${max} characters.`);
  if (text !== text.normalize("NFC")) fail(`${field} must be in normalized form.`);
  return text;
}
function optional(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null || value === "") return "";
  return label(value, field, max);
}

export function builtInWorkspaces(now: IsoTimestamp, labels: Record<string, string> = {}): WorkspaceV1[] {
  return [
    {
      id: "personal", kind: "personal", label: labels.personal?.trim() || "Personal",
      purpose: "Your own life. Nothing an employer or a customer owns belongs here.",
      builtIn: true, archived: false, createdAt: now, updatedAt: now, brand: null,
    },
    {
      id: "work", kind: "work", label: labels.work?.trim() || "Work",
      purpose: "Work done for an employer. Records created here are work records, not personal property.",
      builtIn: true, archived: false, createdAt: now, updatedAt: now, brand: null,
    },
  ];
}

export function buildBrandProfile(input: Record<string, unknown> = {}): BrandProfileV1 {
  const channels = Array.isArray(input.channels)
    ? [...new Set(input.channels.map((entry) => label(entry, "Brand channel", 80)))].sort()
    : [];
  if (channels.length > 40) fail("A brand may list at most 40 channels.");
  return {
    name: optional(input.name, "Brand name", 120),
    positioning: optional(input.positioning, "Brand positioning", 2000),
    audience: optional(input.audience, "Brand audience", 2000),
    valueProposition: optional(input.valueProposition, "Brand value proposition", 2000),
    channels,
    products: [],
    notes: optional(input.notes, "Brand notes", 20_000),
  };
}

export function buildWorkspace(input: Record<string, unknown>, context: { now: IsoTimestamp; existing: readonly WorkspaceV1[] }): WorkspaceV1 {
  const displayLabel = label(input.label, "Workspace name", 80);
  const kind = WORKSPACE_KINDS.includes(input.kind as WorkspaceKindV1) ? input.kind as WorkspaceKindV1 : "business";
  if (kind !== "business") fail("Personal and Work already exist. A new workspace is a business or brand workspace.");
  const id = isWorkspaceId(input.id) ? String(input.id) : workspaceIdFromLabel(displayLabel);
  if (!isWorkspaceId(id)) fail("Workspace identifier is invalid.");
  if ((BUILT_IN_WORKSPACE_IDS as readonly string[]).includes(id)) fail(`"${id}" is a built-in workspace and cannot be recreated.`);
  if (context.existing.some((entry) => entry.id === id)) fail(`A workspace named "${displayLabel}" already exists.`);
  if (context.existing.length >= 50) fail("AION supports at most 50 workspaces.");
  return {
    id, kind, label: displayLabel,
    purpose: optional(input.purpose, "Workspace purpose", 2000),
    builtIn: false, archived: false, createdAt: context.now, updatedAt: context.now,
    brand: buildBrandProfile((input.brand ?? {}) as Record<string, unknown>),
  };
}

export function applyWorkspaceEdit(existing: WorkspaceV1, change: Record<string, unknown>, now: IsoTimestamp): WorkspaceV1 {
  const next: WorkspaceV1 = structuredClone(existing);
  if (change.label !== undefined) next.label = label(change.label, "Workspace name", 80);
  if (change.purpose !== undefined) next.purpose = optional(change.purpose, "Workspace purpose", 2000);
  if (change.brand !== undefined) {
    if (next.kind !== "business") fail("Only a business or brand workspace carries a brand identity.");
    const brand = buildBrandProfile((change.brand ?? {}) as Record<string, unknown>);
    // Products are managed through their own operation so an edit cannot silently drop them.
    brand.products = next.brand?.products ?? [];
    next.brand = brand;
  }
  next.updatedAt = now;
  return next;
}

export function buildBrandProduct(input: Record<string, unknown>, context: { id: OpaqueId; now: IsoTimestamp }): BrandProductV1 {
  const statuses: readonly BrandProductV1["status"][] = ["idea", "in-development", "available", "retired"];
  const status = statuses.includes(input.status as BrandProductV1["status"]) ? input.status as BrandProductV1["status"] : "idea";
  return {
    id: context.id,
    name: label(input.name, "Product name", 200),
    summary: optional(input.summary, "Product summary", 4000),
    status,
    pricingNote: optional(input.pricingNote, "Pricing note", 500),
    createdAt: context.now,
  };
}

/**
 * Resolves a workspace the caller named, or refuses.
 *
 * Refusing is the important half. A record whose workspace cannot be resolved must never fall back
 * to a default, because the default would be someone else's workspace and the record would appear
 * where it does not belong.
 */
export function requireWorkspace(workspaces: readonly WorkspaceV1[], id: unknown): WorkspaceV1 {
  const found = workspaces.find((entry) => entry.id === id);
  if (!found) fail("That workspace does not exist. AION never guesses which workspace a record belongs to.");
  return found;
}

/** Every record type that carries owner content and is therefore filtered by workspace. */
export function belongsToWorkspace<T extends { workspace?: unknown }>(records: readonly T[], workspaceId: string): T[] {
  return records.filter((record) => record.workspace === workspaceId);
}

/**
 * The isolation assertion, stated once so every caller means the same thing by it.
 *
 * A cross-workspace read is a bug, not a preference, so this throws rather than filtering. Code
 * that legitimately spans workspaces — a total count, the workspace switcher — does not call this.
 */
export function assertSameWorkspace(record: { workspace?: unknown }, workspaceId: string, label_ = "record"): void {
  if (record.workspace !== workspaceId) {
    fail(`That ${label_} belongs to a different workspace. AION does not read across workspaces; switch workspace to work with it.`);
  }
}
