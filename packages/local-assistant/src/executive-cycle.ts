/**
 * Proactive executive work loop — bounded OBSERVE → PRIORITIZE → ACT → VERIFY → MEASURE.
 *
 * No infinite loops. No external SEND/POST/APPLY/SPEND. Uses existing autonomy levels:
 * system actor may run level 0–1 (read + create local) without approval; level 2+ stays gated.
 */
import type { IsoTimestamp, OpaqueId, ProvenanceV1 } from "./contracts.js";
import type { AutonomyLevelV1 } from "./autonomy.js";
import { evaluateAutonomy } from "./autonomy.js";

// ─── Autonomy work queue ────────────────────────────────────────────────────

export type AutonomyJobStateV1 =
  | "PROPOSED"
  | "READY"
  | "RUNNING"
  | "WAITING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "OWNER_REQUIRED";

export type AutonomyFailureClassV1 =
  | "TRANSIENT"
  | "BAD_INPUT"
  | "DEPENDENCY"
  | "AUTH_REQUIRED"
  | "OWNER_REQUIRED"
  | "UNSUPPORTED";

export type InterruptionLevelV1 =
  | "IMMEDIATE"
  | "NEXT_BRIEFING"
  | "TODAY"
  | "WEEKLY"
  | "SILENT_LOG";

export type AutonomyCapabilityIdV1 =
  | "maintenance.daily"
  | "opportunity.radar"
  | "inventory.refresh"
  | "attention.board"
  | "research.local"
  | "draft.followup_notes"
  | "commitment.refresh"
  | "vehicle.recall_check"
  | "job.scan_fit"
  | "product.scan_ideas"
  | "brand.gap_scan"
  | "plan.decompose"
  | "briefing.prepare";

export interface AutonomyJobV1 {
  id: OpaqueId;
  workspace: string;
  state: AutonomyJobStateV1;
  capability: AutonomyCapabilityIdV1;
  /** Why this job exists (Owner-readable). */
  reason: string;
  evidence: string[];
  autonomyLevel: AutonomyLevelV1;
  interruption: InterruptionLevelV1;
  createdAt: IsoTimestamp;
  startedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
  result: string | null;
  failure: string | null;
  failureClass: AutonomyFailureClassV1 | null;
  retries: number;
  maxRetries: number;
  verified: boolean;
  /** Success condition description for audit. */
  successCondition: string;
  provenance: ProvenanceV1;
}

export interface ResourceBudgetV1 {
  maxJobsPerCycle: number;
  maxResearchPerCycle: number;
  maxRetriesPerJob: number;
  maxDecompositionDepth: number;
  maxDecompositionItems: number;
  maxOwnerInterruptionsPerCycle: number;
}

export const DEFAULT_RESOURCE_BUDGET: ResourceBudgetV1 = {
  maxJobsPerCycle: 8,
  maxResearchPerCycle: 2,
  maxRetriesPerJob: 2,
  maxDecompositionDepth: 2,
  maxDecompositionItems: 6,
  maxOwnerInterruptionsPerCycle: 3,
};

export interface ChangeEventV1 {
  id: string;
  kind: string;
  workspace: string;
  summary: string;
  evidence: string[];
  at: IsoTimestamp;
  interruption: InterruptionLevelV1;
}

export interface ExecutiveCycleResultV1 {
  cycleId: string;
  startedAt: IsoTimestamp;
  completedAt: IsoTimestamp;
  changesDetected: number;
  jobsProposed: number;
  jobsExecuted: number;
  jobsCompleted: number;
  jobsFailed: number;
  jobsOwnerRequired: number;
  ownerMustDo: string[];
  aionCompleted: string[];
  aionHandling: string[];
  silentLogs: string[];
  interruptions: Array<{ level: InterruptionLevelV1; message: string }>;
  audit: string[];
  budget: ResourceBudgetV1;
  unauthorizedExternalAttempts: number;
  crossWorkspaceLeaks: number;
}

/** Capabilities safe for system autonomous execution (level 0–1 only). */
export const SAFE_AUTO_CAPABILITIES: ReadonlySet<AutonomyCapabilityIdV1> = new Set([
  "maintenance.daily",
  "opportunity.radar",
  "attention.board",
  "research.local",
  "draft.followup_notes",
  "commitment.refresh",
  "vehicle.recall_check",
  "job.scan_fit",
  "product.scan_ideas",
  "brand.gap_scan",
  "plan.decompose",
  "briefing.prepare",
  // inventory.refresh may hit network → level 3, not auto without approval path
]);

export function capabilityAutonomyLevel(cap: AutonomyCapabilityIdV1): AutonomyLevelV1 {
  if (cap === "inventory.refresh") return 3; // public web
  if (cap === "research.local") return 0;
  if (cap === "draft.followup_notes" || cap === "plan.decompose") return 1;
  return 0;
}

export function isExternalGatedCapability(cap: string): boolean {
  return /send|post|apply|submit|purchase|spend|deploy|writer|credential|password/i.test(cap);
}

export function buildAutonomyJob(
  input: {
    workspace: string;
    capability: AutonomyCapabilityIdV1;
    reason: string;
    evidence?: string[];
    interruption?: InterruptionLevelV1;
    successCondition?: string;
  },
  ctx: { id: OpaqueId; now: IsoTimestamp },
): AutonomyJobV1 {
  const level = capabilityAutonomyLevel(input.capability);
  const autoOk = SAFE_AUTO_CAPABILITIES.has(input.capability) && level <= 1;
  const decision = evaluateAutonomy("system", level);
  const ownerRequired = !decision.allowed || !autoOk || level >= 2;
  return {
    id: ctx.id,
    workspace: input.workspace,
    state: ownerRequired ? "OWNER_REQUIRED" : "READY",
    capability: input.capability,
    reason: input.reason.slice(0, 1000),
    evidence: (input.evidence ?? []).slice(0, 20),
    autonomyLevel: level,
    interruption: input.interruption ?? "NEXT_BRIEFING",
    createdAt: ctx.now,
    startedAt: null,
    completedAt: null,
    result: null,
    failure: ownerRequired ? decision.reason : null,
    failureClass: ownerRequired ? "OWNER_REQUIRED" : null,
    retries: 0,
    maxRetries: DEFAULT_RESOURCE_BUDGET.maxRetriesPerJob,
    verified: false,
    successCondition: input.successCondition ?? `Capability ${input.capability} produced measurable output`,
    provenance: {
      sourceType: "system",
      sourceRef: "executive.cycle",
      recordedAt: ctx.now,
    },
  };
}

export function classifyFailure(message: string): AutonomyFailureClassV1 {
  const m = message.toLowerCase();
  if (/timeout|econnreset|temporarily|network|503|429/.test(m)) return "TRANSIENT";
  if (/auth|oauth|token|secret|credential/.test(m)) return "AUTH_REQUIRED";
  if (/owner|approval|consent/.test(m)) return "OWNER_REQUIRED";
  if (/invalid|required|malformed|bad request/.test(m)) return "BAD_INPUT";
  if (/not configured|unavailable|missing provider/.test(m)) return "DEPENDENCY";
  return "UNSUPPORTED";
}

export function canRetry(job: AutonomyJobV1, failureClass: AutonomyFailureClassV1): boolean {
  if (job.retries >= job.maxRetries) return false;
  return failureClass === "TRANSIENT";
}

export function verifyJobResult(
  job: AutonomyJobV1,
  outcome: { ok: boolean; detail: string; artifacts?: string[] },
): { verified: boolean; state: AutonomyJobStateV1; failure: string | null; failureClass: AutonomyFailureClassV1 | null } {
  if (!outcome.ok) {
    const failureClass = classifyFailure(outcome.detail);
    return {
      verified: false,
      state: failureClass === "OWNER_REQUIRED" || failureClass === "AUTH_REQUIRED" ? "OWNER_REQUIRED" : "FAILED",
      failure: outcome.detail.slice(0, 2000),
      failureClass,
    };
  }
  // Measurable success: has detail and/or artifacts
  if (!outcome.detail?.trim() && !(outcome.artifacts?.length)) {
    return {
      verified: false,
      state: "FAILED",
      failure: "No measurable output — not marked COMPLETED (agent theater prevented).",
      failureClass: "BAD_INPUT",
    };
  }
  return { verified: true, state: "COMPLETED", failure: null, failureClass: null };
}

/** Snapshot for change detection between cycles. */
export interface ExecutiveSnapshotSigV1 {
  at: IsoTimestamp;
  vehicleCount: number;
  vehiclePriceSig: string;
  onlineVinSet: string;
  commitmentOpen: number;
  commitmentOverdue: number;
  opportunityCount: number;
  importReviewOpen: number;
  jobAppCount: number;
  brandCount: number;
  captureCount: number;
  relationshipWorkCount: number;
}

export function buildSnapshotSig(input: {
  now: IsoTimestamp;
  vehicles: Array<{ vin: string | null; presenceStatus: string; price?: number | null }>;
  commitments: Array<{ status: string }>;
  opportunities: unknown[];
  importReviewOpen: number;
  jobAppCount: number;
  brandCount: number;
  captureCount: number;
  relationshipWorkCount: number;
}): ExecutiveSnapshotSigV1 {
  const online = input.vehicles
    .filter((v) => v.presenceStatus === "ONLINE_LISTED" || v.presenceStatus === "PHYSICALLY_VERIFIED")
    .map((v) => v.vin || "?")
    .sort();
  const prices = input.vehicles
    .map((v) => `${v.vin || "?"}:${v.price ?? ""}`)
    .sort()
    .join("|")
    .slice(0, 2000);
  return {
    at: input.now,
    vehicleCount: input.vehicles.length,
    vehiclePriceSig: prices,
    onlineVinSet: online.join(",").slice(0, 4000),
    commitmentOpen: input.commitments.filter((c) => c.status === "open" || c.status === "due_soon").length,
    commitmentOverdue: input.commitments.filter((c) => c.status === "overdue").length,
    opportunityCount: input.opportunities.length,
    importReviewOpen: input.importReviewOpen,
    jobAppCount: input.jobAppCount,
    brandCount: input.brandCount,
    captureCount: input.captureCount,
    relationshipWorkCount: input.relationshipWorkCount,
  };
}

export function detectChanges(prev: ExecutiveSnapshotSigV1 | null, next: ExecutiveSnapshotSigV1): ChangeEventV1[] {
  if (!prev) {
    return [
      {
        id: "baseline",
        kind: "baseline",
        workspace: "personal",
        summary: "First executive snapshot established.",
        evidence: [`vehicles=${next.vehicleCount}`, `commits=${next.commitmentOpen}`],
        at: next.at,
        interruption: "SILENT_LOG",
      },
    ];
  }
  const events: ChangeEventV1[] = [];
  if (next.vehicleCount > prev.vehicleCount) {
    events.push({
      id: "veh-added",
      kind: "inventory_added",
      workspace: "work",
      summary: `Inventory grew by ${next.vehicleCount - prev.vehicleCount} vehicle record(s).`,
      evidence: [`before=${prev.vehicleCount}`, `after=${next.vehicleCount}`],
      at: next.at,
      interruption: "NEXT_BRIEFING",
    });
  }
  if (next.onlineVinSet !== prev.onlineVinSet) {
    const before = new Set(prev.onlineVinSet.split(",").filter(Boolean));
    const after = new Set(next.onlineVinSet.split(",").filter(Boolean));
    const gone = [...before].filter((v) => !after.has(v));
    const added = [...after].filter((v) => !before.has(v));
    if (gone.length) {
      events.push({
        id: "veh-gone",
        kind: "inventory_removed_online",
        workspace: "work",
        summary: `${gone.length} VIN(s) no longer in current online set.`,
        evidence: gone.slice(0, 5),
        at: next.at,
        interruption: "TODAY",
      });
    }
    if (added.length) {
      events.push({
        id: "veh-new-online",
        kind: "inventory_new_online",
        workspace: "work",
        summary: `${added.length} new online VIN(s) observed.`,
        evidence: added.slice(0, 5),
        at: next.at,
        interruption: "NEXT_BRIEFING",
      });
    }
  }
  if (next.vehiclePriceSig !== prev.vehiclePriceSig) {
    events.push({
      id: "price-chg",
      kind: "price_change",
      workspace: "work",
      summary: "One or more vehicle advertised prices changed.",
      evidence: ["price signature changed"],
      at: next.at,
      interruption: "NEXT_BRIEFING",
    });
  }
  if (next.commitmentOverdue > prev.commitmentOverdue) {
    events.push({
      id: "commit-overdue",
      kind: "commitment_overdue",
      workspace: "work",
      summary: `${next.commitmentOverdue} overdue commitment(s).`,
      evidence: [`prev=${prev.commitmentOverdue}`, `now=${next.commitmentOverdue}`],
      at: next.at,
      interruption: "IMMEDIATE",
    });
  }
  if (next.opportunityCount > prev.opportunityCount) {
    events.push({
      id: "opp-new",
      kind: "opportunity_new",
      workspace: "work",
      summary: `Opportunity radar grew to ${next.opportunityCount} signal(s).`,
      evidence: [`delta=+${next.opportunityCount - prev.opportunityCount}`],
      at: next.at,
      interruption: "NEXT_BRIEFING",
    });
  }
  if (next.importReviewOpen > 0 && next.importReviewOpen !== prev.importReviewOpen) {
    events.push({
      id: "import-review",
      kind: "import_review",
      workspace: "personal",
      summary: `${next.importReviewOpen} import review item(s) open.`,
      evidence: [],
      at: next.at,
      interruption: "TODAY",
    });
  }
  if (next.jobAppCount > prev.jobAppCount) {
    events.push({
      id: "job-new",
      kind: "job_opportunity",
      workspace: "personal",
      summary: "New job application tracker entries.",
      evidence: [`count=${next.jobAppCount}`],
      at: next.at,
      interruption: "WEEKLY",
    });
  }
  return events;
}

/** Map change events → proposed jobs (bounded). */
export function proposeJobsFromChanges(
  changes: readonly ChangeEventV1[],
  nextId: (kind: string) => string,
  now: IsoTimestamp,
  maxJobs: number,
): AutonomyJobV1[] {
  const jobs: AutonomyJobV1[] = [];
  for (const ch of changes) {
    if (jobs.length >= maxJobs) break;
    if (ch.kind === "baseline" || ch.kind === "import_review") {
      jobs.push(
        buildAutonomyJob(
          {
            workspace: ch.workspace,
            capability: "maintenance.daily",
            reason: ch.summary,
            evidence: ch.evidence,
            interruption: "SILENT_LOG",
            successCondition: "Maintenance counters returned",
          },
          { id: nextId("ajob"), now },
        ),
      );
    }
    if (ch.kind === "inventory_new_online" || ch.kind === "inventory_added" || ch.kind === "price_change") {
      jobs.push(
        buildAutonomyJob(
          {
            workspace: "work",
            capability: "opportunity.radar",
            reason: `Dealership change: ${ch.summary}`,
            evidence: ch.evidence,
            interruption: ch.interruption,
            successCondition: "Opportunity list refreshed with count",
          },
          { id: nextId("ajob"), now },
        ),
      );
    }
    if (ch.kind === "inventory_removed_online") {
      jobs.push(
        buildAutonomyJob(
          {
            workspace: "work",
            capability: "attention.board",
            reason: `Online inventory loss: ${ch.summary}`,
            evidence: ch.evidence,
            interruption: "TODAY",
            successCondition: "Attention board regenerated",
          },
          { id: nextId("ajob"), now },
        ),
      );
    }
    if (ch.kind === "commitment_overdue") {
      jobs.push(
        buildAutonomyJob(
          {
            workspace: ch.workspace,
            capability: "commitment.refresh",
            reason: ch.summary,
            evidence: ch.evidence,
            interruption: "IMMEDIATE",
            successCondition: "Commitment statuses refreshed",
          },
          { id: nextId("ajob"), now },
        ),
      );
    }
    if (ch.kind === "opportunity_new") {
      jobs.push(
        buildAutonomyJob(
          {
            workspace: "work",
            capability: "draft.followup_notes",
            reason: "Prepare internal prep notes for new opportunities (no send)",
            evidence: ch.evidence,
            interruption: "NEXT_BRIEFING",
            successCondition: "Prep notes stored as temporal facts or activity",
          },
          { id: nextId("ajob"), now },
        ),
      );
    }
    if (ch.kind === "job_opportunity") {
      jobs.push(
        buildAutonomyJob(
          {
            workspace: "personal",
            capability: "job.scan_fit",
            reason: "Score job applications against owner knowledge",
            evidence: ch.evidence,
            interruption: "WEEKLY",
            successCondition: "Fit notes updated or listed",
          },
          { id: nextId("ajob"), now },
        ),
      );
    }
  }
  // Always allow one background brand gap scan if capacity
  if (jobs.length < maxJobs) {
    jobs.push(
      buildAutonomyJob(
        {
          workspace: "personal",
          capability: "brand.gap_scan",
          reason: "Scan brand DNA for content/task gaps (fixtures; no post)",
          evidence: ["periodic"],
          interruption: "WEEKLY",
          successCondition: "Gap notes recorded or none found",
        },
        { id: nextId("ajob"), now },
      ),
    );
  }
  return jobs.slice(0, maxJobs);
}

export function emptyCycleResult(now: IsoTimestamp, budget: ResourceBudgetV1): ExecutiveCycleResultV1 {
  return {
    cycleId: `cycle-${now}`,
    startedAt: now,
    completedAt: now,
    changesDetected: 0,
    jobsProposed: 0,
    jobsExecuted: 0,
    jobsCompleted: 0,
    jobsFailed: 0,
    jobsOwnerRequired: 0,
    ownerMustDo: [],
    aionCompleted: [],
    aionHandling: [],
    silentLogs: [],
    interruptions: [],
    audit: [],
    budget,
    unauthorizedExternalAttempts: 0,
    crossWorkspaceLeaks: 0,
  };
}

/** Bounded plan decomposition for internal goals. */
export function decomposeInternalGoal(goal: string, maxItems: number): string[] {
  const g = goal.toLowerCase();
  const steps: string[] = [];
  if (/research|market|dealership|sell/.test(g)) {
    steps.push("Research public market context");
    steps.push("Identify competitors from public sources");
    steps.push("Estimate buyer profile (hypothesis)");
    steps.push("Draft offer skeleton");
    steps.push("List assumptions needing Owner");
    steps.push("Prepare recommendation");
  } else if (/customer|follow|sales/.test(g)) {
    steps.push("Summarize customer history from stored CRM");
    steps.push("Match inventory to stated interests");
    steps.push("Draft call prep notes");
    steps.push("List open commitments");
  } else {
    steps.push("Clarify goal from stored context");
    steps.push("Gather related stored facts");
    steps.push("Draft recommendation");
  }
  return steps.slice(0, maxItems);
}
