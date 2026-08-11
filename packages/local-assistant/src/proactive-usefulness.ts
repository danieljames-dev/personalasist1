/**
 * Proactive usefulness — morning cycle, prep cards, next-best-action, stalls, EOD, metrics.
 *
 * Pure functions over stored evidence. No external send/post/apply.
 * Prefer changed/high-value signals over noise.
 */
import type { IsoTimestamp, RelationshipV1 } from "./contracts.js";
import type { AttentionBoardV1 } from "./attention-engine.js";
import type { CommitmentV1 } from "./commitments.js";
import type { OpportunitySignalV1, ValueLedgerEntryV1 } from "./opportunity-radar.js";
import type { AutonomyJobV1, ExecutiveCycleResultV1, ChangeEventV1 } from "./executive-cycle.js";
import type {
  CaptureFrictionStatsV1,
  CorrectionKindV1,
  CorrectionPatternV1,
} from "./executive-state.js";
import type { VehicleRecordV1 } from "./vehicle-inventory.js";
import type { TemporalFactV1 } from "./executive-context.js";
import { factTrustRank, classifySourceRef } from "./source-trust.js";

export type { CorrectionKindV1, CorrectionPatternV1 };

// ─── Next best action ───────────────────────────────────────────────────────

export type NextBestActionKindV1 =
  | "call"
  | "text_draft"
  | "vehicle_comparison"
  | "research"
  | "wait"
  | "appointment_prep"
  | "inventory_check"
  | "record_outcome"
  | "none";

export interface NextBestActionV1 {
  kind: NextBestActionKindV1;
  title: string;
  why: string;
  confidence: number;
  ownerMustDo: boolean;
  aionCanPrepare: boolean;
  evidence: string[];
  /** Never implies auto-send. */
  externalSend: false;
}

/**
 * Grounded next action — do not recommend contact merely because time passed.
 * Requires: open commitment, due follow-up, appointment, new inventory match,
 * stalled negotiation with open work, or explicit Owner nextAction.
 */
export function computeNextBestAction(input: {
  relationship: RelationshipV1;
  nowIso: string;
  commitments?: readonly CommitmentV1[];
  inventoryMatches?: readonly OpportunitySignalV1[];
  stalled?: boolean;
  stallReason?: string;
}): NextBestActionV1 {
  const r = input.relationship;
  const now = Date.parse(input.nowIso);
  const day = input.nowIso.slice(0, 10);

  // Closed / archived → wait
  if (r.archived || r.lifecycle === "lost" || r.lifecycle === "inactive") {
    return {
      kind: "none",
      title: "No action — inactive/archived",
      why: "Lifecycle is closed or archived.",
      confidence: 90,
      ownerMustDo: false,
      aionCanPrepare: false,
      evidence: [`lifecycle=${r.lifecycle}`],
      externalSend: false,
    };
  }

  const openCommits = (input.commitments ?? []).filter(
    (c) =>
      c.status !== "kept" &&
      c.status !== "cancelled" &&
      (c.committedTo.toLowerCase().includes(r.displayName.split(" ")[0]!.toLowerCase()) ||
        c.committedBy.toLowerCase().includes("owner")),
  );
  const overdueCommit = openCommits.find((c) => c.status === "overdue");
  if (overdueCommit) {
    return {
      kind: "call",
      title: `Keep promise: ${overdueCommit.statement.slice(0, 80)}`,
      why: `Overdue commitment (${overdueCommit.status}) — Owner owes this action.`,
      confidence: 95,
      ownerMustDo: true,
      aionCanPrepare: true,
      evidence: [`commitment:${overdueCommit.id}`, overdueCommit.statement.slice(0, 120)],
      externalSend: false,
    };
  }

  const dueCommit = openCommits.find((c) => c.status === "due_soon" || (c.dueAt && c.dueAt.slice(0, 10) === day));
  if (dueCommit) {
    return {
      kind: "call",
      title: `Due commitment: ${dueCommit.statement.slice(0, 80)}`,
      why: "Commitment due today/soon — grounded in stored promise.",
      confidence: 92,
      ownerMustDo: true,
      aionCanPrepare: true,
      evidence: [`commitment:${dueCommit.id}`],
      externalSend: false,
    };
  }

  const appt = (r.appointments ?? []).find(
    (a) =>
      ["scheduled", "confirmed"].includes(a.status) &&
      (a.at.startsWith(day) || Date.parse(a.at) >= now),
  );
  if (appt) {
    return {
      kind: "appointment_prep",
      title: `Prep for ${appt.kind} at ${appt.at.slice(0, 16)}`,
      why: "Upcoming appointment on record.",
      confidence: 90,
      ownerMustDo: true,
      aionCanPrepare: true,
      evidence: [`appointment:${appt.id}`, appt.kind],
      externalSend: false,
    };
  }

  // Passed appointment without outcome
  const passedNoOutcome = (r.appointments ?? []).find(
    (a) =>
      ["scheduled", "confirmed"].includes(a.status) &&
      Date.parse(a.at) < now - 2 * 3600000,
  );
  if (passedNoOutcome) {
    return {
      kind: "record_outcome",
      title: `Record outcome of ${passedNoOutcome.kind} (${passedNoOutcome.at.slice(0, 16)})`,
      why: "Appointment time passed with status still open — not mere quiet time.",
      confidence: 88,
      ownerMustDo: true,
      aionCanPrepare: false,
      evidence: [`appointment:${passedNoOutcome.id}`, "status still open after time"],
      externalSend: false,
    };
  }

  const openFu = (r.followUps ?? [])
    .filter((f) => f.status === "open")
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  if (openFu && Date.parse(openFu.dueAt) <= now) {
    return {
      kind: openFu.channel === "email" || openFu.channel === "text" ? "text_draft" : "call",
      title: `Follow-up: ${openFu.reason.slice(0, 80)}`,
      why: `Open follow-up due ${openFu.dueAt.slice(0, 10)} (not auto-send).`,
      confidence: 90,
      ownerMustDo: true,
      aionCanPrepare: true,
      evidence: [`followUp:${openFu.id}`, openFu.reason.slice(0, 100)],
      externalSend: false,
    };
  }

  const matches = input.inventoryMatches ?? [];
  if (matches.length > 0) {
    return {
      kind: "inventory_check",
      title: `Show match: ${matches[0]!.title.slice(0, 80)}`,
      why: "New/active inventory match against stored customer requirements.",
      confidence: Math.min(90, matches[0]!.confidence || 70),
      ownerMustDo: true,
      aionCanPrepare: true,
      evidence: matches.slice(0, 3).map((m) => m.title),
      externalSend: false,
    };
  }

  if (input.stalled && input.stallReason) {
    // Only stall-driven contact when there is open work (not bare age)
    if (/overdue|commitment|appointment|match|negotiation|engaged/i.test(input.stallReason)) {
      return {
        kind: "call",
        title: `Re-engage: ${input.stallReason.slice(0, 80)}`,
        why: input.stallReason,
        confidence: 75,
        ownerMustDo: true,
        aionCanPrepare: true,
        evidence: [input.stallReason],
        externalSend: false,
      };
    }
  }

  if (r.nextAction?.trim()) {
    return {
      kind: "call",
      title: r.nextAction.slice(0, 100),
      why: "Owner-recorded next action on relationship.",
      confidence: 85,
      ownerMustDo: true,
      aionCanPrepare: true,
      evidence: ["relationship.nextAction"],
      externalSend: false,
    };
  }

  if ((r.interests ?? []).length && !(r.interactions ?? []).length) {
    return {
      kind: "research",
      title: "Research / confirm interest details before outreach",
      why: "Interest on file but no interactions — prepare, don't spam.",
      confidence: 60,
      ownerMustDo: false,
      aionCanPrepare: true,
      evidence: (r.interests ?? []).slice(0, 2).map((i) => i.description),
      externalSend: false,
    };
  }

  return {
    kind: "wait",
    title: "No grounded next action",
    why: "No due commitment, appointment, overdue follow-up, or inventory match — will not invent contact.",
    confidence: 70,
    ownerMustDo: false,
    aionCanPrepare: false,
    evidence: ["no actionable signal"],
    externalSend: false,
  };
}

// ─── Stall detection (signal-based, not arbitrary quiet age alone) ───────────

export interface DealStallSignalV1 {
  relationshipId: string;
  customer: string;
  workspace: string;
  reason: string;
  kind:
    | "overdue_followup"
    | "overdue_commitment"
    | "appointment_no_outcome"
    | "engaged_no_followup"
    | "inventory_match_waiting"
    | "negotiation_quiet";
  evidence: string[];
  lastContact: string;
  confidence: number;
}

export interface StallDetectionConfigV1 {
  /** Only used for negotiation_quiet when lifecycle is engaged/negotiating. Configurable. */
  negotiationQuietDays: number;
  /** Engaged customer with open interest but zero open follow-ups after this many days. */
  engagedNoFollowUpDays: number;
}

export const DEFAULT_STALL_CONFIG: StallDetectionConfigV1 = {
  negotiationQuietDays: 10,
  engagedNoFollowUpDays: 5,
};

export function detectDealStallSignals(input: {
  relationships: readonly RelationshipV1[];
  nowIso: string;
  commitments?: readonly CommitmentV1[];
  opportunities?: readonly OpportunitySignalV1[];
  config?: Partial<StallDetectionConfigV1>;
  /** Limit to workspace */
  workspace?: string;
}): DealStallSignalV1[] {
  const cfg = { ...DEFAULT_STALL_CONFIG, ...input.config };
  const now = Date.parse(input.nowIso);
  const closed = new Set(["sold", "lost", "inactive"]);
  const out: DealStallSignalV1[] = [];

  for (const r of input.relationships) {
    if (r.archived || closed.has(r.lifecycle)) continue;
    if (input.workspace && r.workspace !== input.workspace) continue;

    const last = r.lastContactAt ?? "never";

    // Overdue follow-up
    for (const f of r.followUps ?? []) {
      if (f.status === "open" && Date.parse(f.dueAt) < now) {
        out.push({
          relationshipId: r.id,
          customer: r.displayName,
          workspace: r.workspace,
          reason: `Overdue follow-up: ${f.reason}`,
          kind: "overdue_followup",
          evidence: [`dueAt=${f.dueAt}`, f.reason.slice(0, 100)],
          lastContact: last,
          confidence: 95,
        });
      }
    }

    // Overdue commitment naming this person
    for (const c of input.commitments ?? []) {
      if (c.workspace !== r.workspace) continue;
      if (c.status !== "overdue") continue;
      const nameHit =
        c.committedTo.toLowerCase().includes(r.displayName.split(/\s+/)[0]!.toLowerCase()) ||
        c.statement.toLowerCase().includes(r.displayName.split(/\s+/)[0]!.toLowerCase());
      if (nameHit) {
        out.push({
          relationshipId: r.id,
          customer: r.displayName,
          workspace: r.workspace,
          reason: `Overdue commitment: ${c.statement.slice(0, 80)}`,
          kind: "overdue_commitment",
          evidence: [`commitment:${c.id}`],
          lastContact: last,
          confidence: 95,
        });
      }
    }

    // Appointment passed, still scheduled/confirmed
    for (const a of r.appointments ?? []) {
      if (["scheduled", "confirmed"].includes(a.status) && Date.parse(a.at) < now - 2 * 3600000) {
        out.push({
          relationshipId: r.id,
          customer: r.displayName,
          workspace: r.workspace,
          reason: `Appointment ${a.kind} passed without recorded outcome`,
          kind: "appointment_no_outcome",
          evidence: [`at=${a.at}`, a.status],
          lastContact: last,
          confidence: 90,
        });
      }
    }

    // Inventory match waiting
    const match = (input.opportunities ?? []).find(
      (o) => o.kind === "inventory_match" && o.entityIds.includes(r.id) && o.workspace === r.workspace,
    );
    if (match) {
      out.push({
        relationshipId: r.id,
        customer: r.displayName,
        workspace: r.workspace,
        reason: `Matching vehicle available: ${match.title}`,
        kind: "inventory_match_waiting",
        evidence: [match.title, match.detail.slice(0, 100)],
        lastContact: last,
        confidence: match.confidence || 70,
      });
    }

    // Engaged + interests + no open follow-up after threshold (not pure quiet age)
    const engaged = ["engaged", "negotiating", "appointment-set", "appointment-shown", "active", "follow-up"].includes(
      r.lifecycle,
    );
    const hasInterest = (r.interests ?? []).length > 0 || (r.interactions ?? []).length > 0;
    const openFu = (r.followUps ?? []).some((f) => f.status === "open");
    const lastMs = r.lastContactAt ? Date.parse(r.lastContactAt) : 0;
    if (
      engaged &&
      hasInterest &&
      !openFu &&
      lastMs &&
      now - lastMs > cfg.engagedNoFollowUpDays * 86400000
    ) {
      out.push({
        relationshipId: r.id,
        customer: r.displayName,
        workspace: r.workspace,
        reason: `Engaged with interest, no open follow-up for ${cfg.engagedNoFollowUpDays}+ days`,
        kind: "engaged_no_followup",
        evidence: [`lifecycle=${r.lifecycle}`, `lastContact=${last}`],
        lastContact: last,
        confidence: 72,
      });
    }

    // Negotiation quiet (configurable threshold — only negotiating stage)
    if (
      r.lifecycle === "negotiating" &&
      lastMs &&
      now - lastMs > cfg.negotiationQuietDays * 86400000
    ) {
      out.push({
        relationshipId: r.id,
        customer: r.displayName,
        workspace: r.workspace,
        reason: `Negotiation quiet ${cfg.negotiationQuietDays}+ days (configurable)`,
        kind: "negotiation_quiet",
        evidence: [`lifecycle=${r.lifecycle}`, `quietDays=${cfg.negotiationQuietDays}`],
        lastContact: last,
        confidence: 65,
      });
    }
  }

  // Dedupe by relationship+kind
  const seen = new Set<string>();
  return out
    .filter((s) => {
      const k = `${s.relationshipId}:${s.kind}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence);
}

// ─── Customer prep card ─────────────────────────────────────────────────────

export interface CustomerPrepCardV1 {
  who: string;
  relationshipId: string | null;
  workspace: string;
  ambiguous: boolean;
  ambiguousNames: string[];
  lastInteraction: string;
  currentNeeds: string[];
  vehiclesOfInterest: string[];
  openCommitments: string[];
  matchingInventory: string[];
  importantChanges: string[];
  nextBestAction: NextBestActionV1;
  sources: Array<{ label: string; confidence: number }>;
  reply: string;
}

export function buildCustomerPrepCard(input: {
  queryName: string;
  candidates: readonly RelationshipV1[];
  nowIso: string;
  commitments?: readonly CommitmentV1[];
  opportunities?: readonly OpportunitySignalV1[];
  vehicles?: readonly VehicleRecordV1[];
  stalls?: readonly DealStallSignalV1[];
  recentFacts?: readonly TemporalFactV1[];
}): CustomerPrepCardV1 {
  const q = input.queryName.trim().toLowerCase();
  const hits = input.candidates.filter((r) => {
    const n = r.displayName.toLowerCase();
    return n === q || n.startsWith(q + " ") || n.includes(" " + q) || n.split(/\s+/)[0] === q;
  });

  if (hits.length === 0) {
    const nba: NextBestActionV1 = {
      kind: "none",
      title: "Identify person first",
      why: `No CRM match for "${input.queryName}" in active scope.`,
      confidence: 40,
      ownerMustDo: true,
      aionCanPrepare: false,
      evidence: [],
      externalSend: false,
    };
    return {
      who: input.queryName,
      relationshipId: null,
      workspace: "",
      ambiguous: false,
      ambiguousNames: [],
      lastInteraction: "none",
      currentNeeds: [],
      vehiclesOfInterest: [],
      openCommitments: [],
      matchingInventory: [],
      importantChanges: [],
      nextBestAction: nba,
      sources: [],
      reply: [
        `CUSTOMER PREP CARD — ${input.queryName}`,
        "",
        "WHO: not found in active-scope CRM",
        "AION will not invent a person. Capture a note or switch workspace.",
      ].join("\n"),
    };
  }

  if (hits.length > 1) {
    return {
      who: input.queryName,
      relationshipId: null,
      workspace: hits[0]!.workspace,
      ambiguous: true,
      ambiguousNames: hits.map((h) => h.displayName),
      lastInteraction: "",
      currentNeeds: [],
      vehiclesOfInterest: [],
      openCommitments: [],
      matchingInventory: [],
      importantChanges: [],
      nextBestAction: {
        kind: "none",
        title: "Confirm which person",
        why: `Multiple matches for "${input.queryName}".`,
        confidence: 50,
        ownerMustDo: true,
        aionCanPrepare: false,
        evidence: hits.map((h) => h.id),
        externalSend: false,
      },
      sources: [],
      reply: [
        `CUSTOMER PREP CARD — ${input.queryName}`,
        "",
        "WHO: AMBIGUOUS — confirm which person:",
        ...hits.map((h, i) => `  ${i + 1}. ${h.displayName} [${h.workspace}] · ${h.lifecycle}`),
        "",
        "AION will not guess. Reply with full name or “it's #N”.",
      ].join("\n"),
    };
  }

  const r = hits[0]!;
  const lastIx = [...(r.interactions ?? [])].sort((a, b) => b.at.localeCompare(a.at))[0];
  const lastInteraction = lastIx
    ? `${lastIx.at.slice(0, 16)} · ${lastIx.kind}: ${lastIx.summary.slice(0, 120)}`
    : r.lastContactAt
      ? `Last contact ${r.lastContactAt.slice(0, 16)} (no interaction detail)`
      : "none recorded";

  const currentNeeds = [
    ...(r.interests ?? []).map((i) => i.description),
    ...r.objections.map((o) => `Objection: ${o}`),
    ...r.preferences.map((p) => `Pref: ${p}`),
  ].slice(0, 8);

  const vehiclesOfInterest = (r.interests ?? [])
    .filter((i) => /vehicle|car|truck|suv|camry|tacoma|highlander|rav/i.test(i.kind + i.description))
    .map((i) => i.description);

  const openCommitments = (input.commitments ?? [])
    .filter(
      (c) =>
        c.workspace === r.workspace &&
        c.status !== "kept" &&
        c.status !== "cancelled" &&
        (c.committedTo.toLowerCase().includes(r.displayName.split(/\s+/)[0]!.toLowerCase()) ||
          c.statement.toLowerCase().includes(r.displayName.split(/\s+/)[0]!.toLowerCase())),
    )
    .map((c) => `[${c.status}] ${c.committedBy}→${c.committedTo}: ${c.statement}`);

  const matches = (input.opportunities ?? []).filter(
    (o) => o.kind === "inventory_match" && o.entityIds.includes(r.id),
  );
  const matchingInventory = matches.map((m) => m.title);

  const linked = (input.vehicles ?? []).filter((v) => v.relationshipIds.includes(r.id));
  for (const v of linked.slice(0, 3)) {
    matchingInventory.push(
      `Linked: ${[v.year, v.make, v.model].filter(Boolean).join(" ") || v.vin} (${v.presenceStatus})`,
    );
  }

  const stall = (input.stalls ?? []).find((s) => s.relationshipId === r.id);
  const importantChanges: string[] = [];
  if (stall) importantChanges.push(`Stall: ${stall.reason}`);
  for (const f of input.recentFacts ?? []) {
    if (f.workspace !== r.workspace) continue;
    if (f.content.toLowerCase().includes(r.displayName.split(/\s+/)[0]!.toLowerCase())) {
      importantChanges.push(`Fact: ${f.title} — ${f.content.slice(0, 80)}`);
    }
  }

  const nba = computeNextBestAction({
    relationship: r,
    nowIso: input.nowIso,
    ...(input.commitments ? { commitments: input.commitments } : {}),
    inventoryMatches: matches,
    stalled: !!stall,
    ...(stall?.reason ? { stallReason: stall.reason } : {}),
  });

  const sources = [
    { label: `CRM ${r.displayName}`, confidence: 90 },
    ...matches.slice(0, 2).map((m) => ({ label: m.source || "radar", confidence: m.confidence })),
    ...openCommitments.slice(0, 1).map(() => ({ label: "commitment store", confidence: 95 })),
  ];

  const reply = [
    `CUSTOMER PREP CARD — ${r.displayName}`,
    "",
    `WHO: ${r.displayName} · ${r.lifecycle} · workspace=${r.workspace}`,
    `LAST INTERACTION: ${lastInteraction}`,
    "",
    "CURRENT NEEDS:",
    ...(currentNeeds.length ? currentNeeds.map((n) => `  • ${n}`) : ["  • (none stored)"]),
    "",
    "VEHICLES OF INTEREST:",
    ...(vehiclesOfInterest.length ? vehiclesOfInterest.map((v) => `  • ${v}`) : ["  • (none stored)"]),
    "",
    "OPEN COMMITMENTS:",
    ...(openCommitments.length ? openCommitments.map((c) => `  • ${c}`) : ["  • none"]),
    "",
    "MATCHING CURRENT INVENTORY:",
    ...(matchingInventory.length ? matchingInventory.map((m) => `  • ${m}`) : ["  • no strong matches"]),
    "",
    "IMPORTANT CHANGES:",
    ...(importantChanges.length ? importantChanges.map((c) => `  • ${c}`) : ["  • none flagged"]),
    "",
    "NEXT BEST ACTION:",
    `  ${nba.kind.toUpperCase()}: ${nba.title}`,
    `  Why: ${nba.why}`,
    `  Confidence: ${nba.confidence}% · Owner must do: ${nba.ownerMustDo ? "yes" : "no"} · AION can prep: ${nba.aionCanPrepare ? "yes" : "no"}`,
    `  External send: NEVER`,
    "",
    "SOURCES:",
    ...sources.map((s) => `  • ${s.label} (confidence ${s.confidence})`),
  ].join("\n");

  return {
    who: r.displayName,
    relationshipId: r.id,
    workspace: r.workspace,
    ambiguous: false,
    ambiguousNames: [],
    lastInteraction,
    currentNeeds,
    vehiclesOfInterest,
    openCommitments,
    matchingInventory,
    importantChanges,
    nextBestAction: nba,
    sources,
    reply,
  };
}

// ─── Morning executive brief ────────────────────────────────────────────────

export interface MorningExecutiveBriefV1 {
  generatedAt: IsoTimestamp;
  scope: "all" | "work" | "personal" | "business";
  ownerMustDoToday: string[];
  aionCanDoToday: string[];
  dueCommitments: string[];
  highValueOpportunities: string[];
  customersNeedingAttention: string[];
  dealershipOpportunities: string[];
  brandBusinessOpportunities: string[];
  importantChanges: string[];
  interruptionCount: number;
  reply: string;
}

export function buildMorningExecutiveBrief(input: {
  nowIso: string;
  board: AttentionBoardV1;
  commitments: readonly CommitmentV1[];
  opportunities: readonly OpportunitySignalV1[];
  stalls: readonly DealStallSignalV1[];
  cycle: ExecutiveCycleResultV1 | null;
  lastBriefingAt: string | null;
  changes?: readonly ChangeEventV1[];
  brandLabels?: string[];
  scope?: "all" | "work" | "personal" | "business";
}): MorningExecutiveBriefV1 {
  const scope = input.scope ?? "all";
  const day = input.nowIso.slice(0, 10);

  const ownerMustDoToday = input.board.ownerMustDo
    .filter((i) => i.horizon === "NOW" || i.horizon === "TODAY")
    .slice(0, 8)
    .map((i) => `[${i.contextLabel}] ${i.title} — ${i.why}`);

  const aionCanDoToday = input.board.aionCanDo.slice(0, 8).map((i) => `[${i.contextLabel}] ${i.title}`);

  const dueCommitments = input.commitments
    .filter((c) => c.status === "overdue" || c.status === "due_soon" || (c.dueAt && c.dueAt.slice(0, 10) === day))
    .slice(0, 8)
    .map((c) => `[${c.status}] ${c.committedBy}→${c.committedTo}: ${c.statement}`);

  const highValueOpportunities = [...input.opportunities]
    .filter((o) => o.score >= 70 || o.value >= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((o) => `[${o.workspace}] ${o.title} (score ${o.score.toFixed(0)})`);

  const customersNeedingAttention = input.stalls
    .filter((s) => scope === "all" || s.workspace === "work")
    .slice(0, 6)
    .map((s) => `${s.customer}: ${s.reason}`);

  const dealershipOpportunities = input.opportunities
    .filter(
      (o) =>
        o.workspace === "work" &&
        (o.kind === "inventory_match" || o.kind === "price_change" || o.kind === "stale_customer"),
    )
    .slice(0, 6)
    .map((o) => o.title);

  const brandBusinessOpportunities = input.opportunities
    .filter((o) => o.workspace !== "work" && o.workspace !== "personal")
    .slice(0, 4)
    .map((o) => o.title);
  if (!brandBusinessOpportunities.length && (input.brandLabels?.length ?? 0) === 0) {
    brandBusinessOpportunities.push("(no brand workspace opportunities yet)");
  }

  const importantChanges: string[] = [];
  if (input.lastBriefingAt && input.cycle && input.cycle.completedAt > input.lastBriefingAt) {
    importantChanges.push(
      `Executive cycle: ${input.cycle.jobsCompleted} done, ${input.cycle.jobsOwnerRequired} Owner-req, ${input.cycle.changesDetected} change(s)`,
    );
  }
  for (const ch of input.changes ?? []) {
    if (ch.kind === "baseline" || ch.interruption === "SILENT_LOG") continue;
    importantChanges.push(`${ch.kind}: ${ch.summary}`);
  }
  if (!importantChanges.length) {
    importantChanges.push(input.lastBriefingAt ? "No high-value changes since last briefing." : "First morning brief — establishing baseline.");
  }

  const interruptionCount = ownerMustDoToday.length + dueCommitments.filter((c) => c.includes("[overdue]")).length;

  const reply = [
    "MORNING EXECUTIVE CYCLE",
    "PROACTIVE EXECUTIVE BRIEF",
    `Scope: ${scope} · ${input.nowIso.slice(0, 16)}`,
    "",
    "OWNER MUST DO TODAY",
    ...(ownerMustDoToday.length ? ownerMustDoToday.map((x, i) => `  ${i + 1}. ${x}`) : ["  (none — clear)"]),
    "",
    "AION CAN DO TODAY",
    ...(aionCanDoToday.length ? aionCanDoToday.map((x) => `  • ${x}`) : ["  (quiet)"]),
    "",
    "DUE COMMITMENTS",
    ...(dueCommitments.length ? dueCommitments.map((x) => `  • ${x}`) : ["  (none)"]),
    "",
    "HIGH-VALUE OPPORTUNITIES",
    ...(highValueOpportunities.length ? highValueOpportunities.map((x) => `  • ${x}`) : ["  (none above threshold)"]),
    "",
    "CUSTOMERS NEEDING ATTENTION",
    ...(customersNeedingAttention.length ? customersNeedingAttention.map((x) => `  • ${x}`) : ["  (none)"]),
    "",
    "DEALERSHIP OPPORTUNITIES",
    ...(dealershipOpportunities.length ? dealershipOpportunities.map((x) => `  • ${x}`) : ["  (none)"]),
    "",
    "BRAND / BUSINESS OPPORTUNITIES",
    ...brandBusinessOpportunities.map((x) => `  • ${x}`),
    "",
    "IMPORTANT CHANGES SINCE LAST BRIEFING",
    ...importantChanges.slice(0, 8).map((x) => `  • ${x}`),
    "",
    "No email send · no social post · no job apply · no spend.",
  ].join("\n");

  return {
    generatedAt: input.nowIso,
    scope,
    ownerMustDoToday,
    aionCanDoToday,
    dueCommitments,
    highValueOpportunities,
    customersNeedingAttention,
    dealershipOpportunities,
    brandBusinessOpportunities,
    importantChanges,
    interruptionCount,
    reply,
  };
}

// ─── Dealership morning assist ──────────────────────────────────────────────

export interface DealershipMorningAssistV1 {
  followUps: string[];
  promisesDue: string[];
  appointments: string[];
  matchingVehicles: string[];
  inventoryChanges: string[];
  priceChanges: string[];
  physicalStatusChanges: string[];
  preparedResearch: string[];
  reply: string;
}

export function buildDealershipMorningAssist(input: {
  nowIso: string;
  relationships: readonly RelationshipV1[];
  commitments: readonly CommitmentV1[];
  opportunities: readonly OpportunitySignalV1[];
  vehicles: readonly VehicleRecordV1[];
  changeSummaries?: string[];
  researchNotes?: string[];
}): DealershipMorningAssistV1 {
  const day = input.nowIso.slice(0, 10);
  const now = Date.parse(input.nowIso);
  const work = input.relationships.filter((r) => r.workspace === "work" && !r.archived);

  const followUps = work
    .flatMap((r) =>
      (r.followUps ?? [])
        .filter((f) => f.status === "open" && f.dueAt.slice(0, 10) <= day)
        .map((f) => `${r.displayName}: ${f.reason} (due ${f.dueAt.slice(0, 10)})`),
    )
    .slice(0, 10);

  const promisesDue = input.commitments
    .filter((c) => c.workspace === "work" && (c.status === "overdue" || c.status === "due_soon" || (c.dueAt && c.dueAt.slice(0, 10) === day)))
    .slice(0, 8)
    .map((c) => `[${c.status}] ${c.committedBy}→${c.committedTo}: ${c.statement}`);

  const appointments = work
    .flatMap((r) =>
      (r.appointments ?? [])
        .filter((a) => ["scheduled", "confirmed"].includes(a.status) && (a.at.startsWith(day) || Date.parse(a.at) >= now))
        .map((a) => `${r.displayName}: ${a.kind} @ ${a.at.slice(0, 16)}`),
    )
    .slice(0, 8);

  const matchingVehicles = input.opportunities
    .filter((o) => o.workspace === "work" && o.kind === "inventory_match")
    .slice(0, 8)
    .map((o) => o.title);

  const inventoryChanges = (input.changeSummaries ?? [])
    .filter((s) => /inventory|vin|online|vehicle/i.test(s))
    .slice(0, 6);

  const priceChanges = (input.changeSummaries ?? [])
    .filter((s) => /price/i.test(s))
    .slice(0, 4);

  const physicalStatusChanges = input.vehicles
    .filter((v) => v.presenceStatus === "PHYSICALLY_VERIFIED" || v.presenceStatus === "NO_LONGER_FOUND_ONLINE")
    .slice(0, 8)
    .map((v) => `${v.vin || "?"} ${[v.year, v.make, v.model].filter(Boolean).join(" ")} → ${v.presenceStatus}`);

  const preparedResearch = (input.researchNotes ?? []).slice(0, 5);

  const reply = [
    "DEALERSHIP MORNING ASSIST",
    "(Internal prep only — no customer messages sent)",
    "",
    "CUSTOMERS NEEDING FOLLOW-UP",
    ...(followUps.length ? followUps.map((x) => `  • ${x}`) : ["  • none due"]),
    "",
    "PROMISES DUE",
    ...(promisesDue.length ? promisesDue.map((x) => `  • ${x}`) : ["  • none"]),
    "",
    "APPOINTMENTS",
    ...(appointments.length ? appointments.map((x) => `  • ${x}`) : ["  • none today/upcoming"]),
    "",
    "VEHICLES MATCHING ACTIVE REQUIREMENTS",
    ...(matchingVehicles.length ? matchingVehicles.map((x) => `  • ${x}`) : ["  • none"]),
    "",
    "IMPORTANT INVENTORY CHANGES",
    ...(inventoryChanges.length ? inventoryChanges.map((x) => `  • ${x}`) : ["  • none flagged"]),
    "",
    "PRICE CHANGES",
    ...(priceChanges.length ? priceChanges.map((x) => `  • ${x}`) : ["  • none"]),
    "",
    "PHYSICAL / STATUS CHANGES",
    ...(physicalStatusChanges.length ? physicalStatusChanges.map((x) => `  • ${x}`) : ["  • none recent"]),
    "",
    "PREPARED RESEARCH",
    ...(preparedResearch.length ? preparedResearch.map((x) => `  • ${x}`) : ["  • none stored"]),
  ].join("\n");

  return {
    followUps,
    promisesDue,
    appointments,
    matchingVehicles,
    inventoryChanges,
    priceChanges,
    physicalStatusChanges,
    preparedResearch,
    reply,
  };
}

// ─── End of day ─────────────────────────────────────────────────────────────

export interface EndOfDayClosureV1 {
  unfinishedCommitments: string[];
  tomorrowAttention: string[];
  importantCaptures: string[];
  aionCompleted: string[];
  failedWaitingJobs: string[];
  newOpportunities: string[];
  tomorrowTopActions: string[];
  questions: string[];
  reply: string;
}

export function buildEndOfDayClosure(input: {
  nowIso: string;
  commitments: readonly CommitmentV1[];
  board: AttentionBoardV1;
  capturesToday: Array<{ summary: string; kind: string }>;
  jobs: readonly AutonomyJobV1[];
  opportunities: readonly OpportunitySignalV1[];
  cycle: ExecutiveCycleResultV1 | null;
}): EndOfDayClosureV1 {
  const day = input.nowIso.slice(0, 10);
  const unfinishedCommitments = input.commitments
    .filter((c) => c.status === "open" || c.status === "due_soon" || c.status === "overdue")
    .slice(0, 8)
    .map((c) => `[${c.status}] ${c.committedBy}→${c.committedTo}: ${c.statement}`);

  const tomorrowAttention = input.board.ownerMustDo.slice(0, 6).map((i) => `[${i.contextLabel}] ${i.title}`);

  const importantCaptures = input.capturesToday.slice(0, 6).map((c) => `${c.kind}: ${c.summary.slice(0, 100)}`);

  const aionCompleted = input.jobs
    .filter((j) => j.state === "COMPLETED" && (j.completedAt || j.createdAt || "").startsWith(day))
    .slice(0, 8)
    .map((j) => `${j.capability}: ${(j.result || "").slice(0, 90)}`);

  const failedWaitingJobs = input.jobs
    .filter((j) => j.state === "FAILED" || j.state === "WAITING" || j.state === "OWNER_REQUIRED")
    .slice(0, 6)
    .map((j) => `[${j.state}] ${j.capability}: ${j.failure || j.reason}`.slice(0, 120));

  const newOpportunities = input.opportunities.slice(0, 5).map((o) => o.title);

  const tomorrowTopActions = [
    ...unfinishedCommitments.filter((c) => c.includes("[overdue]")).slice(0, 2),
    ...tomorrowAttention.slice(0, 3),
  ].slice(0, 5);

  const questions: string[] = [];
  if (!importantCaptures.length) questions.push("Any conversations today worth one-sentence capture?");
  if (unfinishedCommitments.some((c) => c.includes("[overdue]"))) {
    questions.push("Which overdue commitments did you complete (so AION can mark them kept)?");
  }
  if (questions.length < 2 && failedWaitingJobs.some((j) => j.includes("OWNER_REQUIRED"))) {
    questions.push("Any Owner decision that unblocks a waiting job?");
  }
  // Only ask when material for tomorrow
  if (questions.length === 0) {
    questions.push("Anything only you can do tomorrow that is not yet in AION?");
  }

  const reply = [
    "END OF DAY WRAP",
    "",
    "UNFINISHED COMMITMENTS",
    ...(unfinishedCommitments.length ? unfinishedCommitments.map((x) => `  • ${x}`) : ["  • none"]),
    "",
    "CUSTOMERS / ITEMS NEEDING TOMORROW ATTENTION",
    ...(tomorrowAttention.length ? tomorrowAttention.map((x) => `  • ${x}`) : ["  • none"]),
    "",
    "IMPORTANT CAPTURED FACTS TODAY",
    ...(importantCaptures.length ? importantCaptures.map((x) => `  • ${x}`) : ["  • none"]),
    "",
    "WHAT AION COMPLETED",
    ...(aionCompleted.length ? aionCompleted.map((x) => `  • ${x}`) : ["  • none recorded"]),
    input.cycle
      ? `  Cycle: done=${input.cycle.jobsCompleted} failed=${input.cycle.jobsFailed} owner-req=${input.cycle.jobsOwnerRequired} unauth-ext=${input.cycle.unauthorizedExternalAttempts}`
      : "",
    "",
    "FAILED / WAITING / OWNER_REQUIRED JOBS",
    ...(failedWaitingJobs.length ? failedWaitingJobs.map((x) => `  • ${x}`) : ["  • none"]),
    "",
    "NEW OPPORTUNITIES",
    ...(newOpportunities.length ? newOpportunities.map((x) => `  • ${x}`) : ["  • none"]),
    "",
    "TOMORROW'S LIKELY TOP ACTIONS",
    ...(tomorrowTopActions.length
      ? tomorrowTopActions.map((x, i) => `  ${i + 1}. ${x}`)
      : ["  1. Review morning executive brief"]),
    "",
    "QUESTIONS (only if material for tomorrow)",
    ...questions.slice(0, 2).map((q, i) => `  ${i + 1}. ${q}`),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    unfinishedCommitments,
    tomorrowAttention,
    importantCaptures,
    aionCompleted,
    failedWaitingJobs,
    newOpportunities,
    tomorrowTopActions,
    questions: questions.slice(0, 2),
    reply,
  };
}

// ─── Explainability ─────────────────────────────────────────────────────────

export function explainWhySurfacing(input: {
  title: string;
  reason: string;
  sourceRef?: string;
  sourceType?: string;
  score?: number;
  horizon?: string;
  changedFrom?: string | null;
  derivedFrom?: string[];
}): string {
  const tier = input.sourceRef
    ? classifySourceRef(input.sourceRef, input.sourceType)
    : "inference";
  const lines = [
    `WHY AM I TELLING YOU THIS?`,
    `  Item: ${input.title}`,
    `  Reason: ${input.reason}`,
    input.horizon ? `  Horizon: ${input.horizon}` : "",
    input.score != null ? `  Score: ${input.score}` : "",
    `  Source trust: ${tier}${input.sourceRef ? ` (${input.sourceRef})` : ""}`,
    input.derivedFrom?.length ? `  Derived from: ${input.derivedFrom.join(", ")}` : "",
    input.changedFrom ? `  What changed: ${input.changedFrom}` : "  What changed: (see important changes section if first surface)",
  ].filter(Boolean);
  return lines.join("\n");
}

export function explainWhyFirst(items: Array<{ title: string; score: number; why: string }>): string {
  if (!items.length) return "WHY IS THIS FIRST?\n  (empty queue)";
  const top = items[0]!;
  return [
    "WHY IS THIS FIRST?",
    `  #1: ${top.title}`,
    `  Score: ${top.score.toFixed(0)}`,
    `  Why: ${top.why}`,
    items.length > 1
      ? `  Runner-up: ${items[1]!.title} (score ${items[1]!.score.toFixed(0)})`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Usage metrics (practical friction/value — not gamified) ────────────────

export interface RealUsageMetricsV1 {
  captureCount: number;
  captureCorrections: number;
  ownerConfirmations: number;
  falseMatches: number;
  briefingItemsDismissed: number;
  opportunitiesActedUpon: number;
  autonomousJobsCompleted: number;
  autonomousJobsFailed: number;
  ownerInterventions: number;
  /** ESTIMATED time saved only — never mixed with measured. */
  estimatedTimeSavedMinutes: number | null;
  /** MEASURED time saved only (requires evidenceIds on ledger entries). */
  measuredTimeSavedMinutes: number | null;
  /** True when no estimated and no measured values are present. */
  timeSavedUnknown: boolean;
  notes: string[];
}

export function aggregateUsageMetrics(input: {
  captureFriction?: CaptureFrictionStatsV1 | null;
  correctionCount?: number;
  falseMatchCount?: number;
  briefingDismissed?: number;
  opportunitiesActed?: number;
  jobs: readonly AutonomyJobV1[];
  ledger: readonly ValueLedgerEntryV1[];
  cycle?: ExecutiveCycleResultV1 | null;
}): RealUsageMetricsV1 {
  const fr = input.captureFriction;
  const completed = input.jobs.filter((j) => j.state === "COMPLETED").length;
  const failed = input.jobs.filter((j) => j.state === "FAILED").length;
  const ownerReq = input.jobs.filter((j) => j.state === "OWNER_REQUIRED").length;
  const est = input.ledger
    .filter((v) => v.estimateKind === "estimated" && v.timeSavedMinutes != null)
    .reduce((s, v) => s + (v.timeSavedMinutes || 0), 0);
  const measured = input.ledger
    .filter(
      (v) =>
        v.estimateKind === "measured" &&
        v.timeSavedMinutes != null &&
        Array.isArray(v.evidenceIds) &&
        v.evidenceIds.length > 0,
    )
    .reduce((s, v) => s + (v.timeSavedMinutes || 0), 0);

  return {
    captureCount: fr?.total ?? 0,
    captureCorrections: input.correctionCount ?? 0,
    ownerConfirmations: fr?.withConfirm ?? 0,
    falseMatches: input.falseMatchCount ?? 0,
    briefingItemsDismissed: input.briefingDismissed ?? 0,
    opportunitiesActedUpon: input.opportunitiesActed ?? 0,
    autonomousJobsCompleted: completed,
    autonomousJobsFailed: failed,
    ownerInterventions: ownerReq + (input.cycle?.jobsOwnerRequired ?? 0),
    // Never sum MEASURED + ESTIMATED into one undifferentiated total
    estimatedTimeSavedMinutes: est > 0 ? est : null,
    measuredTimeSavedMinutes: measured > 0 ? measured : null,
    timeSavedUnknown: est <= 0 && measured <= 0,
    notes: [
      "MEASURED and ESTIMATED are reported separately — never summed as one fact.",
      "UNKNOWN is valid when neither measured nor estimated time exists.",
      "Metrics track friction/value — not vanity activity scores.",
    ],
  };
}

export function formatUsageMetrics(m: RealUsageMetricsV1): string {
  const measuredLine =
    m.measuredTimeSavedMinutes != null
      ? `  MEASURED time saved (min): ${m.measuredTimeSavedMinutes}`
      : "  MEASURED time saved (min): UNKNOWN";
  const estimatedLine =
    m.estimatedTimeSavedMinutes != null
      ? `  ESTIMATED time saved (min): ${m.estimatedTimeSavedMinutes}`
      : "  ESTIMATED time saved (min): UNKNOWN";
  return [
    "REAL USAGE METRICS (friction / value)",
    `  Captures: ${m.captureCount} · confirmations: ${m.ownerConfirmations} · corrections: ${m.captureCorrections}`,
    `  False matches: ${m.falseMatches} · briefing dismissed: ${m.briefingItemsDismissed}`,
    `  Opportunities acted on: ${m.opportunitiesActedUpon}`,
    `  Autonomy jobs: completed=${m.autonomousJobsCompleted} failed=${m.autonomousJobsFailed}`,
    `  Owner interventions: ${m.ownerInterventions}`,
    measuredLine,
    estimatedLine,
    m.timeSavedUnknown ? "  Combined total: UNKNOWN (no measured or estimated entries)." : "  Combined total: not shown (kinds stay separate).",
    ...m.notes.map((n) => `  · ${n}`),
  ].join("\n");
}

// ─── Correction learning (local patterns — no unsafe global generalization) ─

export const CORRECTION_AUTO_APPLY_HITS = 2;

export function recordCorrectionPattern(
  existing: readonly CorrectionPatternV1[],
  input: {
    kind: CorrectionKindV1;
    fromValue: string;
    toValue: string;
    workspace: string;
    now: IsoTimestamp;
    id: string;
    notes?: string;
  },
): CorrectionPatternV1[] {
  const from = input.fromValue.trim().toLowerCase().slice(0, 200);
  const to = input.toValue.trim().slice(0, 200);
  if (!from || !to || from === to.toLowerCase()) return [...existing];

  const idx = existing.findIndex(
    (p) =>
      p.kind === input.kind &&
      p.workspace === input.workspace &&
      p.fromValue === from &&
      p.toValue.toLowerCase() === to.toLowerCase(),
  );
  if (idx >= 0) {
    const prev = existing[idx]!;
    const hits = prev.hits + 1;
    const updated: CorrectionPatternV1 = {
      ...prev,
      hits,
      autoApplyEligible: hits >= CORRECTION_AUTO_APPLY_HITS,
      at: input.now,
    };
    return [updated, ...existing.filter((_, i) => i !== idx)].slice(0, 200);
  }
  const created: CorrectionPatternV1 = {
    id: input.id,
    kind: input.kind,
    fromValue: from,
    toValue: to,
    workspace: input.workspace,
    hits: 1,
    autoApplyEligible: false, // never generalize from single correction
    at: input.now,
    notes: (input.notes ?? "").slice(0, 300),
  };
  return [created, ...existing].slice(0, 200);
}

/** Apply only workspace-local, multi-hit patterns. Single corrections never auto-apply. */
export function applyCorrectionPattern(
  patterns: readonly CorrectionPatternV1[],
  kind: CorrectionKindV1,
  value: string,
  workspace: string,
): string | null {
  const v = value.trim().toLowerCase();
  const hit = patterns.find(
    (p) =>
      p.kind === kind &&
      p.workspace === workspace &&
      p.autoApplyEligible &&
      p.fromValue === v,
  );
  return hit ? hit.toValue : null;
}

// re-export helper used by cards
export { factTrustRank };
