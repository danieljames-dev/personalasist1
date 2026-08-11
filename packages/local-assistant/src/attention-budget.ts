/**
 * Global Owner attention delivery budget.
 *
 * All proactive emitters (Attention Engine, Opportunity Radar, Commitments,
 * autonomy/executive cycle) must pass through one delivery budget so features
 * cannot independently spam the Owner.
 *
 * Delivery classes map to InterruptionLevelV1-compatible names.
 */
import type { IsoTimestamp } from "./contracts.js";
import type { InterruptionLevelV1 } from "./executive-cycle.js";

export type DeliveryClassV1 =
  | "IMMEDIATE"
  | "NEXT_BRIEFING"
  | "TODAY"
  | "WEEKLY"
  | "SILENT_LOG";

export interface AttentionBudgetConfigV1 {
  /** Hard cap on IMMEDIATE Owner pings per day (default conservative). */
  maxImmediatePerDay: number;
  /** Cap on TODAY-class items surfaced outside a briefing. */
  maxTodaySurfaced: number;
  /** Cap on items injected into the next briefing. */
  maxNextBriefing: number;
  /** Cap on WEEKLY rollup lines. */
  maxWeekly: number;
  /** Per executive cycle Owner interruption cap (also in ResourceBudget). */
  maxPerCycle: number;
}

export const DEFAULT_ATTENTION_BUDGET: AttentionBudgetConfigV1 = {
  maxImmediatePerDay: 5,
  maxTodaySurfaced: 8,
  maxNextBriefing: 10,
  maxWeekly: 15,
  maxPerCycle: 3,
};

export interface AttentionDeliveryItemV1 {
  id: string;
  source: string;
  workspace: string;
  message: string;
  delivery: DeliveryClassV1;
  at: IsoTimestamp;
}

export interface AttentionBudgetStateV1 {
  dayKey: string;
  immediateCount: number;
  todayCount: number;
  briefingCount: number;
  weeklyCount: number;
  cycleCount: number;
  suppressed: number;
  delivered: AttentionDeliveryItemV1[];
  log: string[];
}

export function emptyAttentionBudgetState(nowIso: IsoTimestamp): AttentionBudgetStateV1 {
  return {
    dayKey: nowIso.slice(0, 10),
    immediateCount: 0,
    todayCount: 0,
    briefingCount: 0,
    weeklyCount: 0,
    cycleCount: 0,
    suppressed: 0,
    delivered: [],
    log: [],
  };
}

export function resetBudgetIfNewDay(
  state: AttentionBudgetStateV1,
  nowIso: IsoTimestamp,
): AttentionBudgetStateV1 {
  const day = nowIso.slice(0, 10);
  if (state.dayKey === day) return state;
  return emptyAttentionBudgetState(nowIso);
}

export function interruptionToDelivery(level: InterruptionLevelV1): DeliveryClassV1 {
  return level;
}

/**
 * Attempt to deliver one item through the global budget.
 * Returns accepted=false when suppressed (downgraded to SILENT_LOG in audit).
 */
export function tryDeliver(
  state: AttentionBudgetStateV1,
  config: AttentionBudgetConfigV1,
  item: Omit<AttentionDeliveryItemV1, "delivery"> & { delivery: DeliveryClassV1 },
  nowIso: IsoTimestamp,
): { state: AttentionBudgetStateV1; accepted: boolean; effective: DeliveryClassV1 } {
  let s = resetBudgetIfNewDay(state, nowIso);
  let delivery = item.delivery;

  if (delivery === "SILENT_LOG") {
    s = {
      ...s,
      delivered: [...s.delivered, { ...item, delivery }].slice(-200),
      log: [...s.log, `silent:${item.source}:${item.message.slice(0, 80)}`].slice(-100),
    };
    return { state: s, accepted: true, effective: "SILENT_LOG" };
  }

  if (delivery === "IMMEDIATE") {
    if (s.immediateCount >= config.maxImmediatePerDay || s.cycleCount >= config.maxPerCycle) {
      // Downgrade rather than drop entirely
      delivery = s.briefingCount < config.maxNextBriefing ? "NEXT_BRIEFING" : "SILENT_LOG";
      s = { ...s, suppressed: s.suppressed + 1 };
    } else {
      s = {
        ...s,
        immediateCount: s.immediateCount + 1,
        cycleCount: s.cycleCount + 1,
      };
    }
  }

  if (delivery === "TODAY") {
    if (s.todayCount >= config.maxTodaySurfaced) {
      delivery = s.briefingCount < config.maxNextBriefing ? "NEXT_BRIEFING" : "SILENT_LOG";
      s = { ...s, suppressed: s.suppressed + 1 };
    } else {
      s = { ...s, todayCount: s.todayCount + 1 };
    }
  }

  if (delivery === "NEXT_BRIEFING") {
    if (s.briefingCount >= config.maxNextBriefing) {
      delivery = "SILENT_LOG";
      s = { ...s, suppressed: s.suppressed + 1 };
    } else {
      s = { ...s, briefingCount: s.briefingCount + 1 };
    }
  }

  if (delivery === "WEEKLY") {
    if (s.weeklyCount >= config.maxWeekly) {
      delivery = "SILENT_LOG";
      s = { ...s, suppressed: s.suppressed + 1 };
    } else {
      s = { ...s, weeklyCount: s.weeklyCount + 1 };
    }
  }

  s = {
    ...s,
    delivered: [...s.delivered, { ...item, delivery, at: nowIso }].slice(-200),
    log: [
      ...s.log,
      `${delivery === item.delivery ? "ok" : "downgrade"}:${item.source}→${delivery}`,
    ].slice(-100),
  };

  return {
    state: s,
    accepted: delivery !== "SILENT_LOG" || item.delivery === "SILENT_LOG",
    effective: delivery,
  };
}

/** Apply budget to a batch of proposed interruptions from multiple emitters. */
export function budgetInterruptions(
  proposals: Array<{ level: InterruptionLevelV1; message: string; source: string; workspace: string; id?: string }>,
  config: AttentionBudgetConfigV1 = DEFAULT_ATTENTION_BUDGET,
  nowIso: IsoTimestamp,
  prior: AttentionBudgetStateV1 | null = null,
): {
  state: AttentionBudgetStateV1;
  interruptions: Array<{ level: InterruptionLevelV1; message: string }>;
  silentLogs: string[];
  suppressed: number;
} {
  let state = prior ? resetBudgetIfNewDay(prior, nowIso) : emptyAttentionBudgetState(nowIso);
  // Reset per-cycle counter at start of each batch (cycle boundary)
  state = { ...state, cycleCount: 0 };
  const interruptions: Array<{ level: InterruptionLevelV1; message: string }> = [];
  const silentLogs: string[] = [];

  // Priority order: IMMEDIATE first, then TODAY, NEXT_BRIEFING, WEEKLY
  const order: DeliveryClassV1[] = ["IMMEDIATE", "TODAY", "NEXT_BRIEFING", "WEEKLY", "SILENT_LOG"];
  const sorted = [...proposals].sort(
    (a, b) => order.indexOf(a.level) - order.indexOf(b.level),
  );

  for (const p of sorted) {
    const r = tryDeliver(
      state,
      config,
      {
        id: p.id ?? `${p.source}-${p.message.slice(0, 40)}`,
        source: p.source,
        workspace: p.workspace,
        message: p.message,
        delivery: p.level,
        at: nowIso,
      },
      nowIso,
    );
    state = r.state;
    if (r.effective === "SILENT_LOG") silentLogs.push(p.message);
    else interruptions.push({ level: r.effective, message: p.message });
  }

  return { state, interruptions, silentLogs, suppressed: state.suppressed };
}
