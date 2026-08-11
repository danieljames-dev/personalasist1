/**
 * Attention Engine — ranks OWNER_MUST_DO vs AION_CAN_DO.
 * Not a simple due-date sort: value, risk, interruption cost, autonomy.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { RelationshipV1, TaskV1 } from "./contracts.js";

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

function scoreItem(i: Omit<AttentionItemV1, "score">): number {
  // Higher urgency/value, lower time, human-required slightly prioritized for OWNER board
  return i.urgency * 3 + i.value * 2.5 - i.risk * 0.5 - i.timeMinutes * 0.05 + (i.requiresHuman ? 5 : 0);
}

export function buildAttentionBoard(input: {
  nowIso: string;
  relationships: readonly RelationshipV1[];
  tasks: readonly TaskV1[];
  workspaceLabels?: Record<string, string>;
  inventoryExceptions?: number;
  brandWorkspaceCount?: number;
  openImportReview?: number;
  openApprovals?: number;
  opportunityCount?: number;
}): AttentionBoardV1 {
  const now = Date.parse(input.nowIso);
  const day = input.nowIso.slice(0, 10);
  const items: Omit<AttentionItemV1, "score">[] = [];

  for (const r of input.relationships) {
    if (r.archived) continue;
    for (const f of r.followUps ?? []) {
      if (f.status !== "open") continue;
      const due = f.dueAt?.slice(0, 10) ?? day;
      const overdue = due < day;
      const dueSoon = due === day;
      items.push({
        id: f.id,
        bucket: "OWNER_MUST_DO",
        workspace: r.workspace,
        contextLabel: input.workspaceLabels?.[r.workspace] ?? r.workspace,
        title: `Follow up: ${r.displayName}`,
        why: f.reason || `${f.channel} follow-up`,
        urgency: overdue ? 95 : dueSoon ? 80 : 50,
        value: 70,
        risk: overdue ? 40 : 15,
        timeMinutes: 10,
        sourceType: "follow-up",
        dueAt: f.dueAt,
        aionCanComplete: false,
        requiresHuman: true,
      });
    }
    for (const a of r.appointments ?? []) {
      if (!a.at?.startsWith(day)) continue;
      if (["cancelled", "no-show", "shown"].includes(a.status)) continue;
      items.push({
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
        sourceType: "appointment",
        dueAt: a.at,
        aionCanComplete: false,
        requiresHuman: true,
      });
    }
  }

  for (const t of input.tasks) {
    if (t.state === "completed" || t.state === "cancelled") continue;
    const human =
      /\b(call|meet|drive|show|present|decide|approve|send|submit|apply)\b/i.test(
        `${t.title} ${t.description}`,
      );
    items.push({
      id: t.id,
      bucket: human ? "OWNER_MUST_DO" : "AION_CAN_DO",
      workspace: t.workspace,
      contextLabel: input.workspaceLabels?.[t.workspace] ?? t.workspace,
      title: t.title,
      why: t.description?.slice(0, 120) || "Open task",
      urgency: t.priority === "high" ? 75 : t.priority === "low" ? 30 : 50,
      value: t.priority === "high" ? 70 : 45,
      risk: 10,
      timeMinutes: 20,
      sourceType: "task",
      dueAt: null,
      aionCanComplete: !human,
      requiresHuman: human,
    });
  }

  if ((input.inventoryExceptions ?? 0) > 0) {
    items.push({
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
      sourceType: "inventory",
      dueAt: null,
      aionCanComplete: false,
      requiresHuman: true,
    });
  }

  if ((input.openImportReview ?? 0) > 0) {
    items.push({
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
      sourceType: "import",
      dueAt: null,
      aionCanComplete: false,
      requiresHuman: true,
    });
  }

  if ((input.openApprovals ?? 0) > 0) {
    items.push({
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
      sourceType: "approval",
      dueAt: null,
      aionCanComplete: false,
      requiresHuman: true,
    });
  }

  // AION autonomous work it can handle without send/spend
  items.push({
    id: "aion-refresh-briefing",
    bucket: "AION_CAN_DO",
    workspace: "personal",
    contextLabel: "AION",
    title: "Refresh work queue & account summaries",
    why: "Stored CRM only; no external send",
    urgency: 20,
    value: 30,
    risk: 0,
    timeMinutes: 1,
    sourceType: "autonomy",
    dueAt: null,
    aionCanComplete: true,
    requiresHuman: false,
  });
  items.push({
    id: "aion-draft-followups",
    bucket: "AION_CAN_DO",
    workspace: "work",
    contextLabel: "Lakeland Toyota",
    title: "Draft follow-up messages for named contacts",
    why: "Draft only — never send without authority",
    urgency: 35,
    value: 50,
    risk: 5,
    timeMinutes: 5,
    sourceType: "autonomy",
    dueAt: null,
    aionCanComplete: true,
    requiresHuman: false,
  });
  if ((input.opportunityCount ?? 0) > 0) {
    items.push({
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
      sourceType: "opportunity",
      dueAt: null,
      aionCanComplete: true,
      requiresHuman: false,
    });
  }

  const scored: AttentionItemV1[] = items.map((i) => ({ ...i, score: scoreItem(i) }));
  scored.sort((a, b) => b.score - a.score);

  const ownerMustDo = scored.filter((i) => i.bucket === "OWNER_MUST_DO").slice(0, 12);
  const aionCanDo = scored.filter((i) => i.bucket === "AION_CAN_DO").slice(0, 12);

  const briefingLines = [
    "OWNER MUST DO (highest value / only you):",
    ...ownerMustDo.slice(0, 3).map((i, n) => `  ${n + 1}. [${i.contextLabel}] ${i.title} — ${i.why}`),
    ownerMustDo.length ? "" : "  (nothing urgent only-you right now)",
    "AION IS HANDLING / CAN HANDLE (no send/spend):",
    ...aionCanDo.slice(0, 4).map((i) => `  • ${i.title}`),
  ];

  const explanations = ownerMustDo.slice(0, 5).map((i) => {
    return `${i.title}: urgency=${i.urgency} value=${i.value} risk=${i.risk} time=${i.timeMinutes}m human=${i.requiresHuman} → score ${i.score.toFixed(1)}. ${i.why}`;
  });

  return {
    generatedAt: input.nowIso,
    ownerMustDo,
    aionCanDo,
    briefingLines,
    explanations,
  };
}
