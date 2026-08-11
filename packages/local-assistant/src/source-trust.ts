/**
 * Source trust hierarchy, conflict detection, and lightweight temporal staleness.
 * Keep simple — explainable, not overfitted.
 */
import type { TemporalFactV1 } from "./executive-context.js";

export type SourceTrustTierV1 =
  | "owner_direct"
  | "physical_observation"
  | "government_official"
  | "manufacturer"
  | "live_connector"
  | "dealer_listing"
  | "imported_document"
  | "third_party"
  | "inference";

const TIER_RANK: Record<SourceTrustTierV1, number> = {
  owner_direct: 100,
  physical_observation: 90,
  government_official: 85,
  manufacturer: 80,
  live_connector: 70,
  dealer_listing: 55,
  imported_document: 50,
  third_party: 35,
  inference: 20,
};

export function rankSourceTrust(tier: SourceTrustTierV1): number {
  return TIER_RANK[tier] ?? 20;
}

export function classifySourceRef(sourceRef: string, sourceType?: string): SourceTrustTierV1 {
  const r = `${sourceRef} ${sourceType ?? ""}`.toLowerCase();
  if (/owner\.|owner-entry|capture\.universal|owner\.knowledge/.test(r)) return "owner_direct";
  if (/physical|inventory\.walk|vin-photo|PHYSICAL/.test(r)) return "physical_observation";
  if (/nhtsa|vpic|api\.nhtsa|epa\.gov/.test(r)) return "government_official";
  if (/toyota\.com|manufacturer|oem/.test(r)) return "manufacturer";
  if (/metricool|gmail|oauth/.test(r)) return "live_connector";
  if (/dealer|lakelandtoyota|listing|public-dealer/.test(r)) return "dealer_listing";
  if (/import:|import\./.test(r)) return "imported_document";
  if (/inference|provider-proposal|hypothesis/.test(r)) return "inference";
  return "third_party";
}

export function explainBelief(input: {
  statement: string;
  sourceRef: string;
  sourceType?: string;
  confidence?: number;
}): string {
  const tier = classifySourceRef(input.sourceRef, input.sourceType);
  const rank = rankSourceTrust(tier);
  return `Believe "${input.statement.slice(0, 120)}" because source=${tier} (trust ${rank}/100) ref=${input.sourceRef}${input.confidence != null ? ` confidence=${input.confidence}` : ""}.`;
}

export type FreshnessClassV1 = "stable" | "moderate" | "volatile";

/** Expected max age in days before reconfirm is recommended. */
export function freshnessClassForCategory(category: string): FreshnessClassV1 {
  const c = category.toLowerCase();
  if (/inventory|price|listing|stock|availability|campaign|metric|post/.test(c)) return "volatile";
  if (/preference|budget|interest|lifecycle|role|offer|status|project/.test(c)) return "moderate";
  return "stable"; // profile, name, birthday, skills long-term
}

export function maxAgeDaysForCategory(category: string): number {
  const f = freshnessClassForCategory(category);
  if (f === "volatile") return 3;
  if (f === "moderate") return 30;
  return 3650;
}

export function isStaleFact(fact: TemporalFactV1, nowIso: string): boolean {
  if (fact.temporalStatus === "SUPERSEDED" || fact.temporalStatus === "HISTORICAL") return true;
  const maxDays = maxAgeDaysForCategory(fact.category);
  const anchor = fact.lastConfirmedAt || fact.observedAt || fact.createdAt;
  const ageMs = Date.parse(nowIso) - Date.parse(anchor);
  if (!Number.isFinite(ageMs)) return false;
  return ageMs > maxDays * 86400000;
}

export interface FactConflictV1 {
  olderId: string;
  newerId: string;
  title: string;
  olderContent: string;
  newerContent: string;
  resolution: "supersede_older" | "review";
  reason: string;
}

/**
 * Detect same-title conflicts in same workspace; prefer higher trust / newer Owner statements.
 */
export function detectFactConflicts(
  facts: readonly TemporalFactV1[],
  nowIso: string,
): FactConflictV1[] {
  const current = facts.filter((f) => f.temporalStatus === "CURRENT" || f.temporalStatus === "UNCERTAIN");
  const byKey = new Map<string, TemporalFactV1[]>();
  for (const f of current) {
    const key = `${f.workspace}::${f.title.toLowerCase()}`;
    const list = byKey.get(key) ?? [];
    list.push(f);
    byKey.set(key, list);
  }
  const conflicts: FactConflictV1[] = [];
  for (const [, group] of byKey) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const newer = sorted[0]!;
    for (const older of sorted.slice(1)) {
      if (older.content.trim() === newer.content.trim()) continue;
      const newerTrust = rankSourceTrust(classifySourceRef(newer.provenance.sourceRef, newer.provenance.sourceType));
      const olderTrust = rankSourceTrust(classifySourceRef(older.provenance.sourceRef, older.provenance.sourceType));
      let resolution: "supersede_older" | "review" = "review";
      let reason = "Similar authority — Owner review.";
      if (newerTrust > olderTrust + 10 || (newerTrust >= olderTrust && newer.updatedAt > older.updatedAt)) {
        resolution = "supersede_older";
        reason = `Newer higher/equal trust (${newerTrust} vs ${olderTrust}) at ${newer.updatedAt}.`;
      }
      conflicts.push({
        olderId: older.id,
        newerId: newer.id,
        title: newer.title,
        olderContent: older.content.slice(0, 200),
        newerContent: newer.content.slice(0, 200),
        resolution,
        reason,
      });
    }
  }
  return conflicts;
}

export type AttentionHorizonV1 = "NOW" | "TODAY" | "THIS_WEEK" | "BACKGROUND" | "IGNORE";

export function attentionHorizon(input: {
  urgency: number;
  value: number;
  confidence: number;
  interruptionCost: number;
  dueAt: string | null;
  nowIso: string;
}): AttentionHorizonV1 {
  const day = input.nowIso.slice(0, 10);
  if (input.dueAt) {
    const d = input.dueAt.slice(0, 10);
    if (d < day && input.urgency >= 50) return "NOW";
    if (d === day) return "TODAY";
    const weekEnd = new Date(Date.parse(input.nowIso) + 7 * 86400000).toISOString().slice(0, 10);
    if (d <= weekEnd) return "THIS_WEEK";
  }
  // Low confidence or high interruption + low value → noise control
  if (input.confidence < 40 || (input.interruptionCost >= 70 && input.value < 50)) return "IGNORE";
  if (input.urgency >= 85 && input.value >= 60) return "NOW";
  if (input.urgency >= 60) return "TODAY";
  if (input.urgency >= 35 || input.value >= 55) return "THIS_WEEK";
  if (input.interruptionCost >= 50) return "BACKGROUND";
  return "BACKGROUND";
}

export function opportunityShouldSurface(input: {
  value: number;
  urgency: number;
  confidence: number;
  interruptionCost: number;
  score: number;
}): boolean {
  if (input.confidence < 45) return false;
  if (input.score < 70 && input.interruptionCost > 40) return false;
  if (input.value < 35 && input.urgency < 50) return false;
  return true;
}
