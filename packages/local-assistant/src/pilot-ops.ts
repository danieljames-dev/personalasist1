/**
 * 7-day Owner daily-use pilot — friction log + day metrics.
 * Stored under private data root (never Git). No new databases.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const PILOT_DIR = "pilot";
const FRICTION_FILE = "friction-log.local.json";
const DAYS_FILE = "pilot-days.local.json";

export type FrictionImpactV1 = "low" | "medium" | "high";

export interface FrictionEntryV1 {
  id: string;
  at: string;
  problem: string;
  frequency: number;
  impact: FrictionImpactV1;
  smallestFix: string;
  category?: string;
  resolved?: boolean;
}

export interface PilotDayV1 {
  day: string; // YYYY-MM-DD
  briefGenerated: boolean;
  ownerMustDo: number;
  aionCanDo: number;
  waitingOn: number;
  attentionItems: number;
  gmailNewScanned: number;
  draftsPrepared: number;
  emailsSent: number;
  corrections: number;
  ownerPrompts: number;
  notes?: string;
  at: string;
}

export interface PilotStateV1 {
  version: 1;
  startedAt: string | null;
  friction: FrictionEntryV1[];
  days: PilotDayV1[];
  featuresUsed: Record<string, number>;
  updatedAt?: string;
}

function pilotDir(dataRoot: string): string {
  return join(dataRoot, PILOT_DIR);
}

function frictionPath(dataRoot: string): string {
  return join(pilotDir(dataRoot), FRICTION_FILE);
}

function daysPath(dataRoot: string): string {
  return join(pilotDir(dataRoot), DAYS_FILE);
}

function ensureDir(dataRoot: string): void {
  mkdirSync(pilotDir(dataRoot), { recursive: true });
}

export function loadPilotState(dataRoot: string | null | undefined): PilotStateV1 {
  if (!dataRoot) {
    return { version: 1, startedAt: null, friction: [], days: [], featuresUsed: {} };
  }
  ensureDir(dataRoot);
  const empty: PilotStateV1 = { version: 1, startedAt: null, friction: [], days: [], featuresUsed: {} };
  try {
    const fp = existsSync(frictionPath(dataRoot))
      ? (JSON.parse(readFileSync(frictionPath(dataRoot), "utf8")) as { friction?: FrictionEntryV1[] })
      : {};
    const dp = existsSync(daysPath(dataRoot))
      ? (JSON.parse(readFileSync(daysPath(dataRoot), "utf8")) as Partial<PilotStateV1>)
      : {};
    const out: PilotStateV1 = {
      version: 1,
      startedAt: dp.startedAt ?? null,
      friction: Array.isArray(fp.friction) ? fp.friction : [],
      days: Array.isArray(dp.days) ? dp.days : [],
      featuresUsed: dp.featuresUsed && typeof dp.featuresUsed === "object" ? dp.featuresUsed : {},
    };
    if (dp.updatedAt) out.updatedAt = dp.updatedAt;
    return out;
  } catch {
    return empty;
  }
}

function writeJson(path: string, obj: unknown): void {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* windows */
  }
}

export function startPilot(dataRoot: string, nowIso: string): PilotStateV1 {
  ensureDir(dataRoot);
  const state = loadPilotState(dataRoot);
  if (!state.startedAt) state.startedAt = nowIso;
  state.updatedAt = nowIso;
  writeJson(daysPath(dataRoot), {
    version: 1,
    startedAt: state.startedAt,
    days: state.days,
    featuresUsed: state.featuresUsed,
    updatedAt: state.updatedAt,
  });
  writeJson(frictionPath(dataRoot), { version: 1, friction: state.friction });
  return state;
}

export function recordFriction(
  dataRoot: string,
  entry: {
    id: string;
    at: string;
    problem: string;
    impact?: FrictionImpactV1;
    smallestFix: string;
    category?: string;
  },
): FrictionEntryV1 {
  ensureDir(dataRoot);
  const state = loadPilotState(dataRoot);
  const problemKey = entry.problem.trim().toLowerCase().slice(0, 200);
  const existing = state.friction.find((f) => f.problem.trim().toLowerCase().slice(0, 200) === problemKey && !f.resolved);
  if (existing) {
    existing.frequency += 1;
    existing.at = entry.at;
    if (entry.smallestFix) existing.smallestFix = entry.smallestFix.slice(0, 500);
    writeJson(frictionPath(dataRoot), { version: 1, friction: state.friction });
    return existing;
  }
  const row: FrictionEntryV1 = {
    id: entry.id,
    at: entry.at,
    problem: entry.problem.slice(0, 500),
    frequency: 1,
    impact: entry.impact ?? "medium",
    smallestFix: entry.smallestFix.slice(0, 500),
  };
  if (entry.category) row.category = entry.category.slice(0, 80);
  state.friction.unshift(row);
  if (state.friction.length > 200) state.friction.length = 200;
  writeJson(frictionPath(dataRoot), { version: 1, friction: state.friction });
  return row;
}

export function recordPilotDay(dataRoot: string, day: PilotDayV1): PilotStateV1 {
  ensureDir(dataRoot);
  const state = loadPilotState(dataRoot);
  if (!state.startedAt) state.startedAt = day.at;
  const idx = state.days.findIndex((d) => d.day === day.day);
  if (idx >= 0) state.days[idx] = day;
  else state.days.push(day);
  state.days.sort((a, b) => a.day.localeCompare(b.day));
  state.updatedAt = day.at;
  writeJson(daysPath(dataRoot), {
    version: 1,
    startedAt: state.startedAt,
    days: state.days,
    featuresUsed: state.featuresUsed,
    updatedAt: state.updatedAt,
  });
  return state;
}

export function recordFeatureUse(dataRoot: string, feature: string, nowIso: string): void {
  ensureDir(dataRoot);
  const state = loadPilotState(dataRoot);
  const key = feature.slice(0, 80) || "unknown";
  state.featuresUsed[key] = (state.featuresUsed[key] || 0) + 1;
  state.updatedAt = nowIso;
  writeJson(daysPath(dataRoot), {
    version: 1,
    startedAt: state.startedAt,
    days: state.days,
    featuresUsed: state.featuresUsed,
    updatedAt: state.updatedAt,
  });
}

export function pilotCheckpointSummary(state: PilotStateV1): {
  daysUsed: number;
  ownerPrompts: number;
  dailyBriefs: number;
  ownerMustDoAvg: number;
  aionCanDoAvg: number;
  attentionAvg: number;
  gmailRefreshed: number;
  drafts: number;
  emailsSent: number;
  corrections: number;
  topFrictions: FrictionEntryV1[];
  topFeatures: Array<{ feature: string; count: number }>;
} {
  const days = state.days;
  const n = days.length || 1;
  const sum = (fn: (d: PilotDayV1) => number) => days.reduce((a, d) => a + fn(d), 0);
  const topFeatures = Object.entries(state.featuresUsed)
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const topFrictions = [...state.friction]
    .filter((f) => !f.resolved)
    .sort((a, b) => b.frequency - a.frequency || (b.impact === "high" ? 1 : 0))
    .slice(0, 10);
  return {
    daysUsed: days.length,
    ownerPrompts: sum((d) => d.ownerPrompts),
    dailyBriefs: sum((d) => (d.briefGenerated ? 1 : 0)),
    ownerMustDoAvg: sum((d) => d.ownerMustDo) / n,
    aionCanDoAvg: sum((d) => d.aionCanDo) / n,
    attentionAvg: sum((d) => d.attentionItems) / n,
    gmailRefreshed: sum((d) => d.gmailNewScanned),
    drafts: sum((d) => d.draftsPrepared),
    emailsSent: sum((d) => d.emailsSent),
    corrections: sum((d) => d.corrections),
    topFrictions,
    topFeatures,
  };
}
