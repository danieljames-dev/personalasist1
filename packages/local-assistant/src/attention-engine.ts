/**
 * Attention Engine — ranks OWNER_MUST_DO vs AION_CAN_DO.
 * Not a simple due-date sort: value, risk, interruption cost, autonomy.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { RelationshipV1, TaskV1 } from "./contracts.js";
import type { CommitmentV1 } from "./commitments.js";
import { attentionHorizon, type AttentionHorizonV1 } from "./source-trust.js";

export type AttentionBucketV1 = "OWNER_MUST_DO" | "AION_CAN_DO";

export interface AttentionItemV1 {
  id: OpaqueId | string;
  bucket: AttentionBucketV1;
  workspace: string;
  contextLabel: string;
  title: string;
  why: string;
  urgency: number;
  value: number;
  risk: number;
  timeMinutes: number;
  /** Cost of interrupting Owner (0–100). High = prefer BACKGROUND/IGNORE. */
  interruptionCost: number;
  horizon: AttentionHorizonV1;
  score: number;
  sourceType: string;
  dueAt: string | null;
  aionCanComplete: boolean;
  requiresHuman: boolean;
}

export interface AttentionBoardV1 {
  generatedAt: IsoTimestamp;
  ownerMustDo: AttentionItemV1[];
  aionCanDo: AttentionItemV1[];
  briefingLines: string[];
  /** Why top items scored highly (for "Why?" drill-down). */
  explanations: string[];
}

export function filterAttentionBoard(
  board: AttentionBoardV1,
  filter: { workspace?: string; onlyOwner?: boolean; onlyAion?: boolean },
): AttentionBoardV1 {
  let owner = board.ownerMustDo;
  let aion = board.aionCanDo;
  if (filter.workspace) {
    const w = filter.workspace.toLowerCase();
    owner = owner.filter(
      (i) => i.workspace.toLowerCase() === w || i.contextLabel.toLowerCase().includes(w),
    );
    aion = aion.filter(
      (i) => i.workspace.toLowerCase() === w || i.contextLabel.toLowerCase().includes(w),
    );
  }
  if (filter.onlyOwner) aion = [];
  if (filter.onlyAion) owner = [];
  return {
    ...board,
    ownerMustDo: owner,
    aionCanDo: aion,
    briefingLines: [
      filter.workspace ? `Filtered context: ${filter.workspace}` : "All contexts",
      "OWNER MUST DO:",
      ...owner.slice(0, 5).map((i, n) => `  ${n + 1}. [${i.contextLabel}] ${i.title} — ${i.why} (score ${i.score.toFixed(0)})`),
      owner.length ? "" : "  (none in filter)",
      "AION CAN HANDLE:",
      ...aion.slice(0, 5).map((i) => `  • ${i.title}`),
    ],
  };
}

function scoreItem(i: Omit<AttentionItemV1, "score" | "horizon"> & { horizon?: AttentionHorizonV1 }): number {
  // Higher urgency/value, lower interruption/time; Owner-required slightly prioritized
  return (
    i.urgency * 3 +
    i.value * 2.5 -
    i.risk * 0.5 -
    (i.interruptionCost ?? 30) * 0.4 -
    i.timeMinutes * 0.05 +
    (i.requiresHuman ? 5 : 0)
  );
}

function withHorizon(
  partial: Omit<AttentionItemV1, "score" | "horizon">,
  nowIso: string,
  confidence = 80,
): Omit<AttentionItemV1, "score"> {
  const horizon = attentionHorizon({
    urgency: partial.urgency,
    value: partial.value,
    confidence,
    interruptionCost: partial.interruptionCost,
    dueAt: partial.dueAt,
    nowIso,
  });
  return { ...partial, horizon };
}

export function buildAttentionBoard(input: {
  nowIso: string;
  relationships: readonly RelationshipV1[];
  tasks: readonly TaskV1[];
  commitments?: readonly CommitmentV1[];
  workspaceLabels?: Record<string, string>;
  inventoryExceptions?: number;
  brandWorkspaceCount?: number;
  openImportReview?: number;
  openApprovals?: number;
  opportunityCount?: number;
}): AttentionBoardV1 {
  const day = input.nowIso.slice(0, 10);
  const items: Omit<AttentionItemV1, "score">[] = [];

  for (const c of input.commitments ?? []) {
    if (c.status === "kept" || c.status === "cancelled" || c.status === "broken") continue;
    // Noise: newsletter / marketing commitments never interrupt Owner
    if (/\bunsubscribe|newsletter|promo|marketing blast\b/i.test(c.statement || "")) continue;
    const overdue = c.status === "overdue";
    const dueSoon = c.status === "due_soon";
    const hasDue = Boolean(c.dueAt);
    // Undated open commitments are real but must not monopolize the top-5
    const urgency = overdue ? 98 : dueSoon ? 88 : hasDue ? 70 : 42;
    items.push(
      withHorizon(
        {
          id: c.id,
          bucket: "OWNER_MUST_DO",
          workspace: c.workspace,
          contextLabel: input.workspaceLabels?.[c.workspace] ?? c.workspace,
          title: `Commitment: ${c.committedBy} → ${c.committedTo}`,
          why: c.statement,
          urgency,
          value: hasDue || overdue ? 80 : 55,
          risk: overdue ? 50 : hasDue ? 25 : 10,
          timeMinutes: 15,
          interruptionCost: 20,
          sourceType: "commitment",
          dueAt: c.dueAt,
          aionCanComplete: false,
          requiresHuman: true,
        },
        input.nowIso,
        c.confidence,
      ),
    );
  }

  for (const r of input.relationships) {
    if (r.archived) continue;
    // Coworkers / internal staff are not default sales interruptions
    if (
      /\bcoworker|colleague|manager|co-worker\b/i.test(`${r.role ?? ""} ${r.organisation ?? ""} ${r.notes ?? ""}`) &&
      r.relationshipType !== "customer" &&
      r.relationshipType !== "prospect" &&
      r.relationshipType !== "lead"
    ) {
      continue;
    }
    for (const f of r.followUps ?? []) {
      if (f.status !== "open") continue;
      if (/\bunsubscribe|newsletter|promo|marketing\b/i.test(f.reason || "")) continue;
      const due = f.dueAt?.slice(0, 10) ?? null;
      const overdue = due != null && due < day;
      const dueSoon = due != null && due === day;
      // Undated "check in someday" follow-ups stay BACKGROUND-ish
      const urgency = overdue ? 95 : dueSoon ? 80 : due ? 55 : 35;
      items.push(
        withHorizon(
          {
            id: f.id,
            bucket: "OWNER_MUST_DO",
            workspace: r.workspace,
            contextLabel: input.workspaceLabels?.[r.workspace] ?? r.workspace,
            title: `Follow up: ${r.displayName}`,
            why: f.reason || `${f.channel} follow-up`,
            urgency,
            value: r.relationshipType === "customer" || r.relationshipType === "prospect" ? 70 : 40,
            risk: overdue ? 40 : 15,
            timeMinutes: 10,
            interruptionCost: 25,
            sourceType: "follow-up",
            dueAt: f.dueAt,
            aionCanComplete: false,
            requiresHuman: true,
          },
          input.nowIso,
        ),
      );
    }
    for (const a of r.appointments ?? []) {
      if (!a.at?.startsWith(day)) continue;
      if (["cancelled", "no-show", "shown"].includes(a.status)) continue;
      items.push(
        withHorizon(
          {
            id: a.id,
            bucket: "OWNER_MUST_DO",
            workspace: r.workspace,
            contextLabel: input.workspaceLabels?.[r.workspace] ?? r.workspace,
            title: `Appointment: ${r.displayName}`,
            why: `${a.kind} ${a.at.slice(11, 16)}`,
            urgency: 90,
            value: 85,
            risk: 20,
            timeMinutes: 30,
            interruptionCost: 15,
            sourceType: "appointment",
            dueAt: a.at,
            aionCanComplete: false,
            requiresHuman: true,
          },
          input.nowIso,
        ),
      );
    }
  }

  for (const t of input.tasks) {
    if (t.state === "completed" || t.state === "cancelled") continue;
    const human =
      /\b(call|meet|drive|show|present|decide|approve|send|submit|apply)\b/i.test(
        `${t.title} ${t.description}`,
      );
    items.push(
      withHorizon(
        {
          id: t.id,
          bucket: human ? "OWNER_MUST_DO" : "AION_CAN_DO",
          workspace: t.workspace,
          contextLabel: input.workspaceLabels?.[t.workspace] ?? t.workspace,
          title: t.title,
          why: t.description?.slice(0, 120) || "Open task",
          urgency: t.priority === "high" || t.priority === "urgent" ? 75 : t.priority === "low" ? 30 : 50,
          value: t.priority === "high" || t.priority === "urgent" ? 70 : 45,
          risk: 10,
          timeMinutes: 20,
          interruptionCost: human ? 30 : 10,
          sourceType: "task",
          dueAt: t.dueAt,
          aionCanComplete: !human,
          requiresHuman: human,
        },
        input.nowIso,
      ),
    );
  }

  if ((input.inventoryExceptions ?? 0) > 0) {
    items.push(
      withHorizon(
        {
          id: "inventory-exceptions",
          bucket: "OWNER_MUST_DO",
          workspace: "work",
          contextLabel: "Lakeland Toyota",
          title: "Review inventory walk exceptions",
          why: `${input.inventoryExceptions} exception signal(s) from latest walk/refresh`,
          urgency: 60,
          value: 55,
          risk: 25,
          timeMinutes: 15,
          interruptionCost: 35,
          sourceType: "inventory",
          dueAt: null,
          aionCanComplete: false,
          requiresHuman: true,
        },
        input.nowIso,
      ),
    );
  }

  if ((input.openImportReview ?? 0) > 0) {
    items.push(
      withHorizon(
        {
          id: "import-review",
          bucket: "OWNER_MUST_DO",
          workspace: "personal",
          contextLabel: "Owner knowledge",
          title: "Resolve import review items",
          why: `${input.openImportReview} ambiguous import classification(s)`,
          urgency: 40,
          value: 50,
          risk: 15,
          timeMinutes: 10,
          interruptionCost: 40,
          sourceType: "import",
          dueAt: null,
          aionCanComplete: false,
          requiresHuman: true,
        },
        input.nowIso,
      ),
    );
  }

  if ((input.openApprovals ?? 0) > 0) {
    items.push(
      withHorizon(
        {
          id: "approvals",
          bucket: "OWNER_MUST_DO",
          workspace: "personal",
          contextLabel: "AION",
          title: "Decide pending approvals",
          why: `${input.openApprovals} action(s) await Owner decision`,
          urgency: 70,
          value: 60,
          risk: 30,
          timeMinutes: 5,
          interruptionCost: 20,
          sourceType: "approval",
          dueAt: null,
          aionCanComplete: false,
          requiresHuman: true,
        },
        input.nowIso,
      ),
    );
  }

  // Only inject AION Can Do rows when there is grounded work (no always-on filler)
  const hasOpenFollowUps = input.relationships.some(
    (r) => !r.archived && (r.followUps ?? []).some((f) => f.status === "open"),
  );
  if (hasOpenFollowUps) {
    items.push(
      withHorizon(
        {
          id: "aion-draft-followups",
          bucket: "AION_CAN_DO",
          workspace: "work",
          contextLabel: input.workspaceLabels?.work ?? "Lakeland Toyota",
          title: "Draft follow-up messages for named contacts",
          why: "Open follow-ups exist — draft only, never send without authority",
          urgency: 35,
          value: 50,
          risk: 5,
          timeMinutes: 5,
          interruptionCost: 10,
          sourceType: "autonomy",
          dueAt: null,
          aionCanComplete: true,
          requiresHuman: false,
        },
        input.nowIso,
        85,
      ),
    );
  }
  if ((input.opportunityCount ?? 0) > 0) {
    items.push(
      withHorizon(
        {
          id: "aion-opportunity-radar",
          bucket: "AION_CAN_DO",
          workspace: "work",
          contextLabel: "Opportunity Radar",
          title: `Score ${input.opportunityCount} opportunity signal(s)`,
          why: "Match inventory/customers without interrupting Owner",
          urgency: 40,
          value: 65,
          risk: 10,
          timeMinutes: 3,
          interruptionCost: 15,
          sourceType: "opportunity",
          dueAt: null,
          aionCanComplete: true,
          requiresHuman: false,
        },
        input.nowIso,
        70,
      ),
    );
  }

  const scored: AttentionItemV1[] = items
    .filter((i) => i.horizon !== "IGNORE")
    .map((i) => ({ ...i, score: scoreItem(i) }));
  scored.sort((a, b) => b.score - a.score);

  // Owner attention is scarce: default high-priority interruption set max 5.
  const ownerMustDo = scored
    .filter((i) => i.bucket === "OWNER_MUST_DO" && i.horizon !== "BACKGROUND")
    .slice(0, 5);
  const aionCanDo = scored.filter((i) => i.bucket === "AION_CAN_DO").slice(0, 10);

  const nowItems = ownerMustDo.filter((i) => i.horizon === "NOW");
  const todayItems = ownerMustDo.filter((i) => i.horizon === "TODAY" || i.horizon === "NOW");

  const briefingLines = [
    "WHAT DO I NEED TO DO?",
    ...todayItems.slice(0, 3).map((i, n) => `  ${n + 1}. [${i.horizon}] [${i.contextLabel}] ${i.title} — ${i.why}`),
    todayItems.length ? "" : "  (nothing urgent only-you right now)",
    "WHY (top)?",
    ...ownerMustDo.slice(0, 2).map((i) => `  • ${i.title}: score ${i.score.toFixed(0)} (urgency ${i.urgency}, value ${i.value}, interrupt ${i.interruptionCost})`),
    "WHAT IS AION HANDLING?",
    ...aionCanDo.slice(0, 4).map((i) => `  • ${i.title}`),
    nowItems.length ? `NOW focus: ${nowItems.length} item(s)` : "",
  ].filter(Boolean);

  const explanations = ownerMustDo.slice(0, 5).map((i) => {
    return `${i.title}: horizon=${i.horizon} urgency=${i.urgency} value=${i.value} interrupt=${i.interruptionCost} risk=${i.risk} → score ${i.score.toFixed(1)}. ${i.why}`;
  });

  return {
    generatedAt: input.nowIso,
    ownerMustDo,
    aionCanDo,
    briefingLines,
    explanations,
  };
}
