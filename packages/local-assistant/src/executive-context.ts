/**
 * Multi-context executive layer — first-class context roles on top of existing workspaces.
 *
 * Workspaces remain the isolation boundary (personal / work / business ids).
 * Context roles label *how* the Owner is operating without collapsing memory into one pool.
 */
import type { IsoTimestamp, OpaqueId, ProvenanceV1 } from "./contracts.js";
import type { WorkspaceV1 } from "./workspaces.js";

export type ContextRoleV1 =
  | "OWNER_PRIVATE"
  | "PERSONAL"
  | "LAKELAND_TOYOTA"
  | "WORK_EMPLOYER"
  | "BUSINESS"
  | "BRAND"
  | "PROJECT"
  | "CAREER";

export type VisibilityClassV1 =
  | "PRIVATE"
  | "WORKSPACE_ONLY"
  | "OWNER_SHARED"
  | "PUBLIC";

export const VISIBILITY_CLASSES: readonly VisibilityClassV1[] = [
  "PRIVATE",
  "WORKSPACE_ONLY",
  "OWNER_SHARED",
  "PUBLIC",
];

export interface ContextBindingV1 {
  /** Existing workspace id (personal, work, or business slug). */
  workspaceId: string;
  role: ContextRoleV1;
  /** Human label, e.g. Lakeland Toyota */
  label: string;
  /** Default visibility for new records created while this context is active. */
  defaultVisibility: VisibilityClassV1;
  /** Dealership / brand slug when applicable. */
  linkedDealershipSlug: string | null;
  linkedBrandWorkspaceId: string | null;
  notes: string;
  updatedAt: IsoTimestamp;
}

export interface ExecutiveContextStateV1 {
  /** Active operating context (must map to a workspace). */
  activeContextId: string;
  bindings: ContextBindingV1[];
  /** Explicit Owner switches only — GPS never sets this alone. */
  lastSwitchAt: IsoTimestamp | null;
  lastSwitchReason: string;
}

export function emptyExecutiveContext(now: IsoTimestamp): ExecutiveContextStateV1 {
  return {
    activeContextId: "personal",
    bindings: defaultBindings(now),
    lastSwitchAt: null,
    lastSwitchReason: "",
  };
}

export function defaultBindings(now: IsoTimestamp): ContextBindingV1[] {
  return [
    {
      workspaceId: "personal",
      role: "PERSONAL",
      label: "Personal",
      defaultVisibility: "PRIVATE",
      linkedDealershipSlug: null,
      linkedBrandWorkspaceId: null,
      notes: "Owner private life. Not employer or brand property.",
      updatedAt: now,
    },
    {
      workspaceId: "work",
      role: "LAKELAND_TOYOTA",
      label: "Lakeland Toyota",
      defaultVisibility: "WORKSPACE_ONLY",
      linkedDealershipSlug: "lakeland-toyota",
      linkedBrandWorkspaceId: null,
      notes: "Dealership sales context. Do not auto-share into Owner brands.",
      updatedAt: now,
    },
  ];
}

/** Map free text / workspace label to a binding. */
export function resolveContextSwitch(
  text: string,
  state: ExecutiveContextStateV1,
  workspaces: readonly WorkspaceV1[],
): { binding: ContextBindingV1; workspaceId: string } | null {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return null;

  if (/\b(personal|private)\b/.test(t) && !/brand|toyota|work|business/.test(t)) {
    const b = state.bindings.find((x) => x.workspaceId === "personal") || defaultBindings("1970-01-01T00:00:00.000Z")[0]!;
    return { binding: b, workspaceId: "personal" };
  }
  if (/\blakeland\b|\btoyota\b|\bdealership\b|\bwork\b/.test(t)) {
    const b =
      state.bindings.find((x) => x.role === "LAKELAND_TOYOTA" || x.workspaceId === "work") ||
      defaultBindings("1970-01-01T00:00:00.000Z")[1]!;
    return { binding: b, workspaceId: "work" };
  }

  // Brand / business by workspace label
  for (const w of workspaces) {
    if (w.archived) continue;
    const label = (w.brand?.name || w.label || "").toLowerCase();
    if (label && t.includes(label)) {
      const existing = state.bindings.find((x) => x.workspaceId === w.id);
      const binding: ContextBindingV1 = existing || {
        workspaceId: w.id,
        role: w.kind === "business" ? "BRAND" : "BUSINESS",
        label: w.brand?.name || w.label,
        defaultVisibility: "WORKSPACE_ONLY",
        linkedDealershipSlug: null,
        linkedBrandWorkspaceId: w.kind === "business" ? w.id : null,
        notes: "",
        updatedAt: "1970-01-01T00:00:00.000Z",
      };
      return { binding, workspaceId: w.id };
    }
  }

  for (const b of state.bindings) {
    if (t.includes(b.label.toLowerCase()) || t.includes(b.workspaceId)) {
      return { binding: b, workspaceId: b.workspaceId };
    }
  }
  return null;
}

/**
 * Visibility gate: can a fact from sourceWorkspace be used while activeWorkspace is current?
 * OWNER_SHARED may cross; WORKSPACE_ONLY may not; PRIVATE only in personal/owner private.
 */
export function mayUseAcrossContexts(input: {
  sourceWorkspace: string;
  activeWorkspace: string;
  visibility: VisibilityClassV1;
  role?: ContextRoleV1;
}): { allowed: boolean; reason: string } {
  if (input.sourceWorkspace === input.activeWorkspace) {
    return { allowed: true, reason: "Same workspace." };
  }
  if (input.visibility === "PUBLIC") {
    return { allowed: true, reason: "Public visibility." };
  }
  if (input.visibility === "OWNER_SHARED") {
    return { allowed: true, reason: "Owner-shared across contexts (attributed)." };
  }
  if (input.visibility === "PRIVATE") {
    return {
      allowed: input.activeWorkspace === "personal" && input.sourceWorkspace === "personal",
      reason: "Private facts stay in personal/owner-private.",
    };
  }
  // WORKSPACE_ONLY
  return {
    allowed: false,
    reason: "Workspace-only: not shared into unrelated contexts.",
  };
}

export function ensureBindingForWorkspace(
  state: ExecutiveContextStateV1,
  workspace: WorkspaceV1,
  now: IsoTimestamp,
): ExecutiveContextStateV1 {
  if (state.bindings.some((b) => b.workspaceId === workspace.id)) return state;
  const role: ContextRoleV1 =
    workspace.id === "personal"
      ? "PERSONAL"
      : workspace.id === "work"
        ? "LAKELAND_TOYOTA"
        : workspace.kind === "business"
          ? "BRAND"
          : "BUSINESS";
  const binding: ContextBindingV1 = {
    workspaceId: workspace.id,
    role,
    label: workspace.brand?.name || workspace.label,
    defaultVisibility: workspace.id === "personal" ? "PRIVATE" : "WORKSPACE_ONLY",
    linkedDealershipSlug: workspace.id === "work" ? "lakeland-toyota" : null,
    linkedBrandWorkspaceId: workspace.kind === "business" ? workspace.id : null,
    notes: "",
    updatedAt: now,
  };
  return { ...state, bindings: [...state.bindings, binding] };
}

// ─── Temporal facts ─────────────────────────────────────────────────────────

export type TemporalStatusV1 = "CURRENT" | "HISTORICAL" | "SUPERSEDED" | "UNCERTAIN" | "INVALIDATED";

/** Explicit lineage edge: this fact was derived from other fact/evidence ids. */
export interface FactLineageV1 {
  /** Ids of TemporalFact / evidence records this claim depends on. */
  derivedFrom: OpaqueId[];
  /** Free-form evidence refs (paths, job ids, source URLs) when not fact ids. */
  dependsOnEvidence: string[];
  /** True when any upstream was superseded/invalidated and this has not been revalidated. */
  lineageStale: boolean;
}

export interface TemporalFactV1 {
  id: OpaqueId;
  workspace: string;
  visibility: VisibilityClassV1;
  category: string;
  title: string;
  content: string;
  confidence: number;
  temporalStatus: TemporalStatusV1;
  observedAt: IsoTimestamp;
  /** Inclusive start of asserted validity window (null = unknown start). */
  validFrom: IsoTimestamp | null;
  /**
   * Inclusive end of asserted validity window.
   * null = open-ended until superseded, invalidated, or freshness policy marks stale.
   * Use for facts that expire without a replacement (offers, inventory, temporary preferences).
   */
  validUntil: IsoTimestamp | null;
  lastConfirmedAt: IsoTimestamp | null;
  supersededAt: IsoTimestamp | null;
  supersededBy: OpaqueId | null;
  /** Set when fact is explicitly voided without a replacement id. */
  invalidatedAt: IsoTimestamp | null;
  /** Why invalidated (owner correction, poison reject, expiry without replacement). */
  invalidationReason: string | null;
  lineage: FactLineageV1;
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

function parseLineage(input: Record<string, unknown>): FactLineageV1 {
  const derivedFrom = Array.isArray(input.derivedFrom)
    ? input.derivedFrom.map((x) => String(x).slice(0, 120)).filter(Boolean).slice(0, 40)
    : typeof input.derivedFrom === "string" && input.derivedFrom
      ? [String(input.derivedFrom).slice(0, 120)]
      : [];
  const dependsOnEvidence = Array.isArray(input.dependsOnEvidence)
    ? input.dependsOnEvidence.map((x) => String(x).slice(0, 500)).filter(Boolean).slice(0, 40)
    : [];
  return {
    derivedFrom,
    dependsOnEvidence,
    lineageStale: input.lineageStale === true,
  };
}

export function buildTemporalFact(
  input: Record<string, unknown>,
  ctx: { id: OpaqueId; now: IsoTimestamp; workspace: string },
): TemporalFactV1 {
  const content = String(input.content ?? "").trim().slice(0, 20_000);
  const title = String(input.title ?? "").trim().slice(0, 200) || "Fact";
  if (!content) throw new Error("Temporal fact needs content.");
  const visibility = VISIBILITY_CLASSES.includes(input.visibility as VisibilityClassV1)
    ? (input.visibility as VisibilityClassV1)
    : "WORKSPACE_ONLY";
  const statuses = ["CURRENT", "HISTORICAL", "SUPERSEDED", "UNCERTAIN", "INVALIDATED"] as const;
  return {
    id: ctx.id,
    workspace: ctx.workspace,
    visibility,
    category: String(input.category ?? "other").slice(0, 80),
    title,
    content,
    confidence: Math.min(100, Math.max(0, Number(input.confidence ?? 80) || 80)),
    temporalStatus: statuses.includes(input.temporalStatus as (typeof statuses)[number])
      ? (input.temporalStatus as TemporalStatusV1)
      : "CURRENT",
    observedAt: String(input.observedAt ?? ctx.now),
    validFrom: input.validFrom ? String(input.validFrom) : ctx.now,
    validUntil: input.validUntil ? String(input.validUntil) : null,
    lastConfirmedAt: input.lastConfirmedAt ? String(input.lastConfirmedAt) : ctx.now,
    supersededAt: null,
    supersededBy: null,
    invalidatedAt: null,
    invalidationReason: null,
    lineage: parseLineage(input),
    provenance: {
      sourceType: "owner",
      sourceRef: String(input.sourceRef ?? "temporal.fact").slice(0, 500),
      recordedAt: ctx.now,
    },
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

export function supersedeTemporalFact(
  fact: TemporalFactV1,
  replacementId: OpaqueId,
  now: IsoTimestamp,
): TemporalFactV1 {
  return {
    ...fact,
    temporalStatus: "SUPERSEDED",
    supersededAt: now,
    supersededBy: replacementId,
    // Close the validity window when replaced so open-ended CURRENT cannot linger.
    validUntil: fact.validUntil && fact.validUntil < now ? fact.validUntil : now,
    updatedAt: now,
  };
}

/** Explicitly end a fact with no replacement (expires / void / poison reject). */
export function invalidateTemporalFact(
  fact: TemporalFactV1,
  now: IsoTimestamp,
  reason: string,
): TemporalFactV1 {
  return {
    ...fact,
    temporalStatus: "INVALIDATED",
    invalidatedAt: now,
    invalidationReason: reason.slice(0, 500),
    validUntil: fact.validUntil && fact.validUntil < now ? fact.validUntil : now,
    updatedAt: now,
  };
}

/** Mark derived facts stale when an upstream id is superseded or invalidated. */
export function markDerivedLineageStale(
  facts: readonly TemporalFactV1[],
  upstreamId: OpaqueId,
  now: IsoTimestamp,
): TemporalFactV1[] {
  return facts.map((f) => {
    if (!f.lineage?.derivedFrom?.includes(upstreamId)) return f;
    if (f.temporalStatus === "SUPERSEDED" || f.temporalStatus === "INVALIDATED") return f;
    return {
      ...f,
      temporalStatus: f.temporalStatus === "CURRENT" ? "UNCERTAIN" : f.temporalStatus,
      lineage: { ...f.lineage, lineageStale: true },
      updatedAt: now,
    };
  });
}

/** Normalize legacy facts loaded from disk (pre-validUntil / pre-lineage). */
export function normalizeTemporalFact(raw: TemporalFactV1 | Record<string, unknown>): TemporalFactV1 {
  const f = raw as TemporalFactV1;
  const lineage: FactLineageV1 =
    f.lineage && typeof f.lineage === "object"
      ? {
          derivedFrom: Array.isArray(f.lineage.derivedFrom)
            ? f.lineage.derivedFrom.map(String).slice(0, 40)
            : [],
          dependsOnEvidence: Array.isArray(f.lineage.dependsOnEvidence)
            ? f.lineage.dependsOnEvidence.map(String).slice(0, 40)
            : [],
          lineageStale: f.lineage.lineageStale === true,
        }
      : { derivedFrom: [], dependsOnEvidence: [], lineageStale: false };
  return {
    ...f,
    validUntil: f.validUntil ?? null,
    invalidatedAt: f.invalidatedAt ?? null,
    invalidationReason: f.invalidationReason ?? null,
    lineage,
    temporalStatus: f.temporalStatus === ("INVALIDATED" as TemporalStatusV1) ? "INVALIDATED" : f.temporalStatus,
  };
}

// ─── Relationship graph edges ───────────────────────────────────────────────

export type GraphRelationTypeV1 =
  | "works_at"
  | "interested_in"
  | "has_preference"
  | "sells"
  | "collaborates_on"
  | "belongs_to"
  | "observed_at"
  | "owns"
  | "related_to";

export interface GraphEdgeV1 {
  id: OpaqueId;
  workspace: string;
  visibility: VisibilityClassV1;
  type: GraphRelationTypeV1;
  fromKind: string;
  fromId: string;
  fromLabel: string;
  toKind: string;
  toId: string;
  toLabel: string;
  note: string;
  confidence: number;
  active: boolean;
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  supersededAt: IsoTimestamp | null;
}

export function buildGraphEdge(
  input: Record<string, unknown>,
  ctx: { id: OpaqueId; now: IsoTimestamp; workspace: string },
): GraphEdgeV1 {
  const type = String(input.type ?? "related_to") as GraphRelationTypeV1;
  const fromId = String(input.fromId ?? "").trim();
  const toId = String(input.toId ?? "").trim();
  if (!fromId || !toId) throw new Error("Graph edge needs fromId and toId.");
  return {
    id: ctx.id,
    workspace: ctx.workspace,
    visibility: VISIBILITY_CLASSES.includes(input.visibility as VisibilityClassV1)
      ? (input.visibility as VisibilityClassV1)
      : "WORKSPACE_ONLY",
    type,
    fromKind: String(input.fromKind ?? "entity").slice(0, 40),
    fromId: fromId.slice(0, 200),
    fromLabel: String(input.fromLabel ?? fromId).slice(0, 200),
    toKind: String(input.toKind ?? "entity").slice(0, 40),
    toId: toId.slice(0, 200),
    toLabel: String(input.toLabel ?? toId).slice(0, 200),
    note: String(input.note ?? "").slice(0, 2000),
    confidence: Math.min(100, Math.max(0, Number(input.confidence ?? 90) || 90)),
    active: input.active === false ? false : true,
    provenance: {
      sourceType: "owner",
      sourceRef: String(input.sourceRef ?? "graph.edge").slice(0, 500),
      recordedAt: ctx.now,
    },
    createdAt: ctx.now,
    supersededAt: null,
  };
}
