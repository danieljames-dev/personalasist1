/**
 * Daily operating mode — high-confidence, low-noise Owner executive OS.
 * Pure builders over existing state; no network; no sends.
 */
import type { AttentionBoardV1 } from "./attention-engine.js";
import type { CommitmentV1 } from "./commitments.js";
import type { RelationshipV1 } from "./contracts.js";
import type { OpportunitySignalV1 } from "./opportunity-radar.js";
import { isSyntheticRelationship, isSyntheticCommitment } from "./import-path-policy.js";
import { isTestOrE2eWorkspace } from "./import-path-policy.js";

export interface WaitingOnOtherV1 {
  person: string;
  workspace: string;
  expected: string;
  since: string | null;
  source: string;
  nextFollowUp: string | null;
}

export interface ContextDailyViewV1 {
  context: string;
  workspaceIds: string[];
  whatHappened: string[];
  needsAttention: string[];
  whoMatters: string[];
  waiting: string[];
  next: string[];
  reply: string;
}

export interface DailyOperatingReportV1 {
  generatedAt: string;
  ownerMustDo: string[];
  aionCanDo: string[];
  waitingOnOthers: WaitingOnOtherV1[];
  importantFollowUps: string[];
  career: string[];
  lakelandToyota: string[];
  compassionateChoice: string[];
  personal: string[];
  opportunities: string[];
  risksDeadlines: string[];
  highPriorityCount: number;
  reply: string;
}

function liveRels(relationships: readonly RelationshipV1[]): RelationshipV1[] {
  return relationships.filter((r) => !r.archived && !isSyntheticRelationship(r));
}

function openCommits(commitments: readonly CommitmentV1[]): CommitmentV1[] {
  return commitments.filter(
    (c) =>
      !isSyntheticCommitment(c) &&
      c.status !== "cancelled" &&
      c.status !== "kept" &&
      c.status !== "broken" &&
      !/\[INVALIDATED\b/i.test(c.statement || ""),
  );
}

export function buildWaitingOnOthers(
  commitments: readonly CommitmentV1[],
  relationships: readonly RelationshipV1[],
): WaitingOnOtherV1[] {
  const out: WaitingOnOtherV1[] = [];
  for (const c of openCommits(commitments)) {
    if (/^owner$/i.test(c.committedBy)) continue; // Owner owes, not waiting on other
    out.push({
      person: c.committedBy.slice(0, 120),
      workspace: c.workspace,
      expected: c.statement.slice(0, 300),
      since: c.createdAt ?? null,
      source: c.provenance?.sourceRef || "commitment",
      nextFollowUp: c.dueAt,
    });
  }
  for (const r of liveRels(relationships)) {
    for (const f of r.followUps ?? []) {
      if (f.status !== "open") continue;
      // If follow-up is "call them" it's Owner action; if "waiting for reply" it's waiting
      if (!/\bwait|reply|hear back|get back|callback|promised\b/i.test(f.reason || "")) continue;
      out.push({
        person: r.displayName,
        workspace: r.workspace,
        expected: f.reason || "Open follow-up",
        since: f.createdAt ?? null,
        source: `relationship:${r.id}`,
        nextFollowUp: f.dueAt,
      });
    }
  }
  return out.slice(0, 12);
}

export function buildImportantFollowUps(
  relationships: readonly RelationshipV1[],
  nowIso: string,
): string[] {
  const day = nowIso.slice(0, 10);
  const rows: Array<{ score: number; line: string }> = [];
  for (const r of liveRels(relationships)) {
    for (const f of r.followUps ?? []) {
      if (f.status !== "open") continue;
      if (/\bunsubscribe|promo|newsletter|marketing\b/i.test(f.reason || "")) continue;
      const due = f.dueAt?.slice(0, 10) ?? day;
      const overdue = due < day ? 40 : due === day ? 25 : 10;
      rows.push({
        score: overdue + (r.relationshipType === "customer" ? 20 : r.relationshipType === "prospect" ? 15 : 5),
        line: `[${r.workspace}] ${r.displayName}: ${f.reason || f.channel} (due ${due})`,
      });
    }
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, 8).map((r) => r.line);
}

export function buildContextDailyView(input: {
  context: "personal" | "work" | "compassionate-choice" | "career" | "project";
  nowIso: string;
  relationships: readonly RelationshipV1[];
  commitments: readonly CommitmentV1[];
  opportunities: readonly OpportunitySignalV1[];
  tasks?: readonly { title: string; workspace: string; state: string; description?: string }[];
  activity?: readonly { at: string; action: string; summary: string }[];
  workspaceLabels?: Record<string, string>;
}): ContextDailyViewV1 {
  const label =
    input.context === "work"
      ? "Lakeland Toyota"
      : input.context === "compassionate-choice"
        ? "Compassionate Choice"
        : input.context === "career"
          ? "Career"
          : input.context === "project"
            ? "Project / AION"
            : "Personal";

  const workspaceIds =
    input.context === "career"
      ? ["personal", "work"]
      : input.context === "project"
        ? ["personal"]
        : [input.context === "work" ? "work" : input.context];

  const rels = liveRels(input.relationships).filter((r) => {
    if (input.context === "career") return /recruit|job|interview|hiring|career/i.test(`${r.notes} ${r.role} ${r.organisation}`);
    if (input.context === "project") return false;
    return workspaceIds.includes(r.workspace);
  });

  const commits = openCommits(input.commitments).filter((c) => {
    if (input.context === "career") return /job|interview|recruit|application/i.test(c.statement + c.provenance?.sourceRef);
    if (input.context === "project") return /aion|project/i.test(c.statement);
    return workspaceIds.includes(c.workspace);
  });

  const dayAgo = new Date(Date.parse(input.nowIso) - 86_400_000).toISOString();
  const whatHappened = (input.activity ?? [])
    .filter((a) => a.at >= dayAgo)
    .filter((a) => {
      if (input.context === "work") return /work|gmail|customer|inventory|dealership|walk/i.test(a.action + a.summary);
      if (input.context === "compassionate-choice") return /compassionate|kristina|brand/i.test(a.action + a.summary);
      if (input.context === "career") return /job|career|interview|gmail\.ingest/i.test(a.action + a.summary);
      if (input.context === "personal") return !/inventory|walk|dealership/i.test(a.action + a.summary);
      return /aion|executive|settings/i.test(a.action + a.summary);
    })
    .slice(0, 6)
    .map((a) => `${a.at.slice(0, 16)} · ${a.summary.slice(0, 100)}`);

  const needsAttention = [
    ...commits.filter((c) => c.status === "overdue" || c.status === "due_soon").map((c) => c.statement.slice(0, 100)),
    ...rels.flatMap((r) =>
      (r.followUps ?? [])
        .filter((f) => f.status === "open")
        .map((f) => `Follow up ${r.displayName}: ${f.reason || f.channel}`),
    ),
  ].slice(0, 6);

  const whoMatters = rels
    .slice(0, 8)
    .map((r) => `${r.displayName} (${r.relationshipType}/${r.lifecycle || "open"})`);

  const waiting = buildWaitingOnOthers(commits, rels).map(
    (w) => `${w.person}: ${w.expected.slice(0, 80)}`,
  );

  const next = [
    ...needsAttention.slice(0, 3).map((x) => `Handle: ${x}`),
    ...(input.context === "work"
      ? ["Keep coworker vs customer boundaries; no auto-prospect from @lakelandtoyota.com"]
      : []),
    ...(input.context === "career" ? ["Confirm only grounded application/interview status"] : []),
  ].slice(0, 5);

  if (!whatHappened.length) whatHappened.push("(no high-signal activity in last 24h for this context)");
  if (!needsAttention.length) needsAttention.push("(clear)");
  if (!whoMatters.length) whoMatters.push("(no live people in this context)");
  if (!waiting.length) waiting.push("(nothing pending from others)");
  if (!next.length) next.push("(maintain awareness; no forced action)");

  const reply = [
    `${label.toUpperCase()} — DAILY VIEW`,
    `As of ${input.nowIso.slice(0, 16)}`,
    "",
    "WHAT HAPPENED",
    ...whatHappened.map((x) => `  • ${x}`),
    "",
    "NEEDS ATTENTION",
    ...needsAttention.map((x) => `  • ${x}`),
    "",
    "WHO MATTERS",
    ...whoMatters.map((x) => `  • ${x}`),
    "",
    "WAITING",
    ...waiting.map((x) => `  • ${x}`),
    "",
    "NEXT",
    ...next.map((x) => `  • ${x}`),
  ].join("\n");

  return {
    context: input.context,
    workspaceIds,
    whatHappened,
    needsAttention,
    whoMatters,
    waiting,
    next,
    reply,
  };
}

export function buildWhatChangedSince(input: {
  nowIso: string;
  sinceIso: string;
  activity: readonly { at: string; action: string; summary: string }[];
  commitments: readonly CommitmentV1[];
  relationships: readonly RelationshipV1[];
  lastSyncAt?: string | null;
  lastCycle?: { completedAt: string; jobsCompleted: number; changesDetected: number; aionCompleted?: string[] } | null;
}): { lines: string[]; reply: string } {
  const lines: string[] = [];
  const since = input.sinceIso;
  const acts = input.activity.filter((a) => a.at >= since).slice(0, 40);

  if (input.lastSyncAt && input.lastSyncAt >= since) {
    lines.push(`Gmail sync completed (${input.lastSyncAt.slice(0, 16)})`);
  }
  if (input.lastCycle && input.lastCycle.completedAt >= since) {
    lines.push(
      `Executive cycle: ${input.lastCycle.jobsCompleted} job(s), ${input.lastCycle.changesDetected} change signal(s)`,
    );
    for (const x of (input.lastCycle.aionCompleted ?? []).slice(0, 4)) {
      lines.push(`AION completed: ${x}`);
    }
  }

  const newCommits = openCommits(input.commitments).filter((c) => (c.createdAt || "") >= since);
  for (const c of newCommits.slice(0, 5)) {
    lines.push(`Commitment: ${c.committedBy} → ${c.committedTo}: ${c.statement.slice(0, 80)}`);
  }
  const resolved = input.commitments.filter(
    (c) =>
      (c.status === "cancelled" || c.status === "kept" || c.status === "broken") &&
      (c.resolvedAt || c.updatedAt || "") >= since,
  );
  for (const c of resolved.slice(0, 4)) {
    lines.push(`Commitment ${c.status}: ${c.statement.slice(0, 70)}`);
  }

  const newRels = liveRels(input.relationships).filter((r) => (r.createdAt || r.updatedAt || "") >= since && r.source === "gmail-live");
  for (const r of newRels.slice(0, 4)) {
    lines.push(`Relationship touch (${r.workspace}): ${r.displayName} · ${r.relationshipType}`);
  }

  // High-signal activity only
  for (const a of acts) {
    if (/brand\.gap_scan|scheduler|tick|soft/i.test(a.action + a.summary)) continue;
    if (/gmail\.ingest|gmail\.truth|customer\.|commitment|capture|import|oauth/i.test(a.action)) {
      lines.push(`${a.at.slice(0, 16)} · ${a.summary.slice(0, 100)}`);
    }
  }

  const deduped = [...new Set(lines)].slice(0, 15);
  if (!deduped.length) deduped.push("No high-value changes since the baseline (routine noise suppressed).");

  const reply = [
    "WHAT CHANGED",
    `Since ${since.slice(0, 16)} → ${input.nowIso.slice(0, 16)}`,
    "",
    ...deduped.map((x) => `  • ${x}`),
    "",
    "Marketing/bulk and brand gap-scan noise suppressed.",
  ].join("\n");

  return { lines: deduped, reply };
}

export function buildDailyOperatingReport(input: {
  nowIso: string;
  board: AttentionBoardV1;
  relationships: readonly RelationshipV1[];
  commitments: readonly CommitmentV1[];
  opportunities: readonly OpportunitySignalV1[];
  activity?: readonly { at: string; action: string; summary: string }[];
  workspaceLabels?: Record<string, string>;
  lastGmailSyncAt?: string | null;
}): DailyOperatingReportV1 {
  const labels = input.workspaceLabels ?? {};
  const ownerMustDo = input.board.ownerMustDo.slice(0, 5).map(
    (i) => `[${i.horizon}] [${i.contextLabel}] ${i.title} — ${i.why}`,
  );
  const aionCanDo = input.board.aionCanDo.slice(0, 8).map((i) => `[${i.contextLabel}] ${i.title}`);
  const waitingOnOthers = buildWaitingOnOthers(input.commitments, input.relationships);
  const importantFollowUps = buildImportantFollowUps(input.relationships, input.nowIso);

  const workRels = liveRels(input.relationships).filter((r) => r.workspace === "work");
  const ccRels = liveRels(input.relationships).filter((r) => r.workspace === "compassionate-choice");
  const personalRels = liveRels(input.relationships).filter((r) => r.workspace === "personal");

  const career = [
    ...openCommits(input.commitments)
      .filter((c) => /job|interview|recruit|application|career/i.test(c.statement + (c.provenance?.sourceRef || "")))
      .map((c) => c.statement.slice(0, 100)),
    ...(input.lastGmailSyncAt ? [`Last Gmail sync: ${input.lastGmailSyncAt.slice(0, 16)} (career signals only when interpersonal)`] : []),
  ].slice(0, 6);
  if (!career.length) career.push("No grounded career action items (unknown status preserved).");

  const lakeland = [
    ...workRels
      .filter((r) => r.relationshipType === "customer" || r.relationshipType === "prospect")
      .map((r) => `${r.displayName} · ${r.relationshipType}/${r.lifecycle || "?"}`),
    ...workRels.flatMap((r) =>
      (r.followUps ?? []).filter((f) => f.status === "open").map((f) => `Follow-up ${r.displayName}: ${f.reason || f.channel}`),
    ),
  ].slice(0, 8);
  if (!lakeland.length) lakeland.push("No live external customers/prospects requiring action (coworkers excluded).");

  const compassionate = [
    ...ccRels.map((r) => `${r.displayName} · ${r.relationshipType}`),
    ...openCommits(input.commitments)
      .filter((c) => c.workspace === "compassionate-choice")
      .map((c) => c.statement.slice(0, 100)),
  ].slice(0, 6);
  if (!compassionate.length) compassionate.push("Compassionate Choice: grounded partner data present if imported; no new forced opportunities.");

  const personal = [
    ...personalRels.slice(0, 4).map((r) => r.displayName),
    ...openCommits(input.commitments)
      .filter((c) => c.workspace === "personal" && /^owner$/i.test(c.committedBy))
      .map((c) => `Owner owes: ${c.statement.slice(0, 80)}`),
  ].slice(0, 6);
  if (!personal.length) personal.push("No high-priority personal Owner obligations surfaced.");

  const opportunities = (input.opportunities ?? [])
    .filter((o) => (o.score ?? 0) >= 70 || (o.value ?? 0) >= 60)
    .filter((o) => !isTestOrE2eWorkspace({ id: o.workspace, label: o.workspace }))
    .slice(0, 5)
    .map((o) => `[${labels[o.workspace] || o.workspace}] ${o.title}`);
  if (!opportunities.length) opportunities.push("None above confidence threshold.");

  const risksDeadlines = openCommits(input.commitments)
    .filter((c) => c.status === "overdue" || c.status === "due_soon" || c.dueAt)
    .slice(0, 6)
    .map((c) => `[${c.status}] ${c.dueAt || "no date"} · ${c.statement.slice(0, 80)}`);
  if (!risksDeadlines.length) risksDeadlines.push("No grounded deadline risk.");

  const reply = [
    "DAILY OPERATING BRIEF",
    `Generated ${input.nowIso.slice(0, 16)} · high-confidence only · max ${ownerMustDo.length || 0}/5 Owner interruptions`,
    "",
    "OWNER MUST DO",
    ...(ownerMustDo.length ? ownerMustDo.map((x, i) => `  ${i + 1}. ${x}`) : ["  (none)"]),
    "",
    "AION CAN DO",
    ...(aionCanDo.length ? aionCanDo.map((x) => `  • ${x}`) : ["  (quiet)"]),
    "",
    "WAITING ON OTHERS",
    ...(waitingOnOthers.length
      ? waitingOnOthers.map((w) => `  • [${w.workspace}] ${w.person}: ${w.expected.slice(0, 90)}`)
      : ["  (none)"]),
    "",
    "IMPORTANT FOLLOW-UPS",
    ...(importantFollowUps.length ? importantFollowUps.map((x) => `  • ${x}`) : ["  (none)"]),
    "",
    "CAREER",
    ...career.map((x) => `  • ${x}`),
    "",
    "LAKELAND TOYOTA",
    ...lakeland.map((x) => `  • ${x}`),
    "",
    "COMPASSIONATE CHOICE",
    ...compassionate.map((x) => `  • ${x}`),
    "",
    "PERSONAL",
    ...personal.map((x) => `  • ${x}`),
    "",
    "OPPORTUNITIES",
    ...opportunities.map((x) => `  • ${x}`),
    "",
    "RISKS / DEADLINES",
    ...risksDeadlines.map((x) => `  • ${x}`),
    "",
    "No email send · no social post · no job apply · no spend.",
  ].join("\n");

  return {
    generatedAt: input.nowIso,
    ownerMustDo,
    aionCanDo,
    waitingOnOthers,
    importantFollowUps,
    career,
    lakelandToyota: lakeland,
    compassionateChoice: compassionate,
    personal,
    opportunities,
    risksDeadlines,
    highPriorityCount: ownerMustDo.length,
    reply,
  };
}
