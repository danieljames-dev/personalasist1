/**
 * Infer target workspace for Owner import paths/content.
 * Never silently cross-share. Ambiguous → review.
 */
export type ImportWorkspaceRoleV1 =
  | "OWNER_PRIVATE"
  | "PERSONAL"
  | "DEALERSHIP"
  | "BUSINESS"
  | "BRAND"
  | "PROJECT"
  | "CAREER"
  | "AMBIGUOUS";

export interface ImportWorkspaceInferenceV1 {
  role: ImportWorkspaceRoleV1;
  /** Existing workspace id when confidently known. */
  workspaceId: string | null;
  confidence: number;
  visibility: "PRIVATE" | "WORKSPACE_ONLY" | "OWNER_SHARED";
  reason: string;
  needsReview: boolean;
  /** Remembered Owner corrections (path pattern → workspace). */
  matchedCorrection: string | null;
}

export interface WorkspaceCorrectionV1 {
  pattern: string;
  workspaceId: string;
  role: ImportWorkspaceRoleV1;
  at: string;
}

/** Path/filename → workspace inference (no invented brands). */
export function inferImportWorkspace(input: {
  path: string;
  filename?: string;
  extractedText?: string;
  associateWith?: string;
  /** Owner corrections: substring of path → workspace id */
  corrections?: readonly WorkspaceCorrectionV1[];
  brandWorkspaceIds?: readonly { id: string; label: string }[];
}): ImportWorkspaceInferenceV1 {
  const path = `${input.path} ${input.filename ?? ""}`.toLowerCase();
  const text = String(input.extractedText ?? "").slice(0, 5000).toLowerCase();
  const hay = `${path} ${text}`;

  // Owner corrections first (durable guidance)
  for (const c of input.corrections ?? []) {
    if (c.pattern && path.includes(c.pattern.toLowerCase())) {
      return {
        role: c.role,
        workspaceId: c.workspaceId,
        confidence: 95,
        visibility: c.workspaceId === "personal" ? "PRIVATE" : "WORKSPACE_ONLY",
        reason: `Owner correction: paths matching "${c.pattern}" → ${c.workspaceId}`,
        needsReview: false,
        matchedCorrection: c.pattern,
      };
    }
  }

  if (input.associateWith === "owner") {
    return {
      role: "CAREER",
      workspaceId: "personal",
      confidence: 88,
      visibility: "PRIVATE",
      reason: "Owner selected associateWith=owner.",
      needsReview: false,
      matchedCorrection: null,
    };
  }
  if (input.associateWith === "customer" || input.associateWith === "business") {
    return {
      role: "DEALERSHIP",
      workspaceId: "work",
      confidence: 80,
      visibility: "WORKSPACE_ONLY",
      reason: `Owner selected associateWith=${input.associateWith} → dealership/work context.`,
      needsReview: false,
      matchedCorrection: null,
    };
  }
  if (input.associateWith === "brand") {
    return {
      role: "BRAND",
      workspaceId: null,
      confidence: 70,
      visibility: "WORKSPACE_ONLY",
      reason: "Owner selected brand association — pick brand workspace if multiple.",
      needsReview: true,
      matchedCorrection: null,
    };
  }

  // Career / resume
  if (/\b(resume|cv|career|employment|job[-_ ]?search)\b/i.test(hay)) {
    return {
      role: "CAREER",
      workspaceId: "personal",
      confidence: 90,
      visibility: "PRIVATE",
      reason: "Resume/career path or content signals → PERSONAL/CAREER.",
      needsReview: false,
      matchedCorrection: null,
    };
  }

  // Dealership
  if (/\b(lakeland|toyota|dealership|inventory[-_ ]?walk|vin|lot[-_ ]?walk|sales[-_ ]?floor)\b/i.test(hay)) {
    return {
      role: "DEALERSHIP",
      workspaceId: "work",
      confidence: 92,
      visibility: "WORKSPACE_ONLY",
      reason: "Dealership/sales path or content → Lakeland/work workspace.",
      needsReview: false,
      matchedCorrection: null,
    };
  }

  // Brand match by known workspace label
  for (const b of input.brandWorkspaceIds ?? []) {
    const label = b.label.toLowerCase();
    if (label.length >= 3 && path.includes(label)) {
      return {
        role: "BRAND",
        workspaceId: b.id,
        confidence: 88,
        visibility: "WORKSPACE_ONLY",
        reason: `Path matches brand workspace label "${b.label}".`,
        needsReview: false,
        matchedCorrection: null,
      };
    }
  }
  if (/\b(brand|campaign|instagram|metricool|content[-_ ]?calendar)\b/i.test(hay)) {
    return {
      role: "BRAND",
      workspaceId: null,
      confidence: 72,
      visibility: "WORKSPACE_ONLY",
      reason: "Brand/content signals — which brand workspace needs Owner confirmation if multiple.",
      needsReview: true,
      matchedCorrection: null,
    };
  }

  if (/\b(project|milestone|deliverable)\b/i.test(hay)) {
    return {
      role: "PROJECT",
      workspaceId: null,
      confidence: 65,
      visibility: "WORKSPACE_ONLY",
      reason: "Project signals — confirm owning business/project workspace.",
      needsReview: true,
      matchedCorrection: null,
    };
  }

  if (/\b(personal|family|home|private)\b/i.test(hay)) {
    return {
      role: "PERSONAL",
      workspaceId: "personal",
      confidence: 80,
      visibility: "PRIVATE",
      reason: "Personal path/content signals.",
      needsReview: false,
      matchedCorrection: null,
    };
  }

  return {
    role: "AMBIGUOUS",
    workspaceId: null,
    confidence: 30,
    visibility: "WORKSPACE_ONLY",
    reason: "No strong workspace signal — review before cross-context use.",
    needsReview: true,
    matchedCorrection: null,
  };
}

/** Connector ingestion must declare a target context — never a global pool. */
export interface ConnectorContextPolicyV1 {
  connector: "gmail" | "metricool";
  defaultWorkspaceId: string | null;
  requiresClassification: boolean;
  neverGlobalPool: true;
  policy: string;
}

export function gmailContextPolicy(): ConnectorContextPolicyV1 {
  return {
    connector: "gmail",
    defaultWorkspaceId: null,
    requiresClassification: true,
    neverGlobalPool: true,
    policy:
      "Gmail threads must be classified to DEALERSHIP/BUSINESS/BRAND/PERSONAL before durable CRM association. Unclassified mail stays in a staging review queue — never dumped into a shared global pool.",
  };
}

export function metricoolContextPolicy(): ConnectorContextPolicyV1 {
  return {
    connector: "metricool",
    defaultWorkspaceId: null,
    requiresClassification: true,
    neverGlobalPool: true,
    policy:
      "Metricool brands map 1:1 to Brand workspaces by Owner-provided account mapping. Never invent which brand Caleb or anyone manages. Unmapped accounts stay unlinked.",
  };
}
