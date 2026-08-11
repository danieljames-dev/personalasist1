/**
 * Source trust hierarchy, conflict detection, and lightweight temporal staleness.
 * Keep simple — explainable, not overfitted.
 *
 * Trust is active policy for current-fact selection, not display-only metadata.
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

/** Minimum trust rank that may override owner_direct without Owner review. */
export const OWNER_DIRECT_RANK = TIER_RANK.owner_direct;

export function rankSourceTrust(tier: SourceTrustTierV1): number {
  return TIER_RANK[tier] ?? 20;
}

export function factTrustTier(fact: TemporalFactV1): SourceTrustTierV1 {
  return classifySourceRef(fact.provenance?.sourceRef ?? "", fact.provenance?.sourceType);
}

export function factTrustRank(fact: TemporalFactV1): number {
  return rankSourceTrust(factTrustTier(fact));
}

/**
 * Channel-first trust classification.
 *
 * Attacker-controlled filename/path text must NEVER upgrade trust.
 * Example: import:owner.notes.txt and import:nhtsa-recall.pdf are still
 * imported_document — not owner_direct / government_official.
 *
 * Order: import channel → explicit sourceType → structured sourceRef prefixes → weak fallbacks.
 */
export function classifySourceRef(sourceRef: string, sourceType?: string): SourceTrustTierV1 {
  const type = String(sourceType ?? "").toLowerCase().trim();
  const ref = String(sourceRef ?? "").toLowerCase().trim();

  // ── 1. Import channel dominates (filename may contain owner/nhtsa/physical words) ──
  if (
    type === "import" ||
    type === "imported" ||
    type === "imported_document" ||
    type === "bulk-import" ||
    type === "folder-import" ||
    ref.startsWith("import:") ||
    ref.startsWith("import.") ||
    ref.startsWith("import/") ||
    ref.startsWith("queue-import") ||
    ref.includes("folder-import") ||
    ref.includes("bulk-import") ||
    ref.includes("recursive-bulk")
  ) {
    return "imported_document";
  }

  // ── 2. Explicit typed channel (set at creation by code, not free text) ──
  if (type === "inference" || type === "model" || type === "provider-proposal" || type === "system") {
    return "inference";
  }
  if (type === "physical" || type === "physical_observation" || type === "physical_owner_walk") {
    return "physical_observation";
  }
  if (type === "government" || type === "government_official" || type === "nhtsa") {
    return "government_official";
  }
  if (type === "manufacturer" || type === "oem") return "manufacturer";
  if (type === "live_connector" || type === "connector" || type === "gmail" || type === "metricool") {
    return "live_connector";
  }
  if (type === "dealer" || type === "dealer_listing" || type === "listing") return "dealer_listing";
  if (type === "third_party" || type === "research" || type === "public") return "third_party";
  if (type === "owner" || type === "owner_direct" || type === "owner-entry") {
    // Typed owner channel — refuse import and other non-owner structured channels.
    // buildTemporalFact historically defaults sourceType to "owner"; sourceRef is the real channel.
    if (ref.startsWith("import:") || ref.startsWith("import.")) return "imported_document";
    if (
      ref.includes("inventory.walk") ||
      ref.startsWith("physical.") ||
      ref.startsWith("physical_owner") ||
      ref.includes("vin-photo")
    ) {
      return "physical_observation";
    }
    if (/^(third_party|inference\.|provider-proposal|hypothesis|autonomy\.|dealer\.|listing\.|nhtsa\.|manufacturer\.|metricool|gmail\.)/.test(ref)) {
      // Fall through to structured prefix / weak fallbacks below (do not trust default type=owner)
    } else if (
      !ref ||
      /^(owner\.|owner-entry|capture\.universal|owner\.knowledge|owner\.dealership|assistant\.remember)/.test(ref) ||
      ref === "owner" ||
      ref === "owner-entry"
    ) {
      return "owner_direct";
    }
    // Unknown ref with default type=owner: continue to structured/weak classification
  }

  // ── 3. Structured sourceRef channel prefixes only (not free-text path basenames) ──
  if (
    /^(owner\.|owner-entry|capture\.universal|owner\.knowledge|owner\.dealership|assistant\.remember)/.test(
      ref,
    )
  ) {
    return "owner_direct";
  }
  if (
    /^(inventory\.walk|physical\.|vin-photo|physical_owner)/.test(ref) ||
    ref.includes("inventory.walk") ||
    ref === "physical_owner_walk"
  ) {
    return "physical_observation";
  }
  if (/^(nhtsa\.|connector\.nhtsa|api\.nhtsa|government\.|vpic\.)/.test(ref)) {
    return "government_official";
  }
  if (/^(manufacturer\.|oem\.|connector\.manufacturer)/.test(ref)) return "manufacturer";
  if (/^(metricool|gmail\.|connector\.gmail|connector\.metricool|oauth\.gmail)/.test(ref)) {
    return "live_connector";
  }
  if (/^(dealer\.|listing\.|public-dealer|lakelandtoyota\.listing)/.test(ref)) {
    return "dealer_listing";
  }
  if (/^(inference\.|provider-proposal|hypothesis|autonomy\.)/.test(ref)) return "inference";

  // ── 4. Weak fallbacks (still never upgrade import filenames — already handled) ──
  if (/provider-proposal|hypothesis|autonomy\./.test(ref)) return "inference";
  if (/public-dealer|dealer_listing|\.listing/.test(ref)) return "dealer_listing";
  if (/metricool|gmail\.|oauth/.test(ref)) return "live_connector";

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
  if (
    fact.temporalStatus === "SUPERSEDED" ||
    fact.temporalStatus === "HISTORICAL" ||
    fact.temporalStatus === "INVALIDATED"
  ) {
    return true;
  }
  // Explicit validity end (even without a replacement fact)
  if (fact.validUntil && fact.validUntil < nowIso) return true;
  if (fact.lineage?.lineageStale === true) return true;
  const maxDays = maxAgeDaysForCategory(fact.category);
  const anchor = fact.lastConfirmedAt || fact.observedAt || fact.createdAt;
  const ageMs = Date.parse(nowIso) - Date.parse(anchor);
  if (!Number.isFinite(ageMs)) return false;
  return ageMs > maxDays * 86400000;
}

/**
 * Interval-aware "is this fact assertable as current truth right now?"
 * Does NOT use category freshness alone — use isStaleFact for reconfirm policy.
 */
export function isFactCurrentlyValid(fact: TemporalFactV1, nowIso: string): boolean {
  if (fact.temporalStatus === "SUPERSEDED" || fact.temporalStatus === "INVALIDATED") return false;
  if (fact.temporalStatus === "HISTORICAL") return false;
  if (fact.invalidatedAt) return false;
  if (fact.validFrom && fact.validFrom > nowIso) return false;
  if (fact.validUntil && fact.validUntil < nowIso) return false;
  if (fact.lineage?.lineageStale === true) return false;
  return fact.temporalStatus === "CURRENT" || fact.temporalStatus === "UNCERTAIN";
}

/**
 * Active trust policy: low-trust imported/researched content must not silently
 * become owner-direct-equivalent truth when a higher-trust statement exists.
 *
 * Selects at most one "current" fact per (workspace, title) key using:
 * 1) validity window / status
 * 2) trust rank (owner wins over import/third_party/inference)
 * 3) freshness (lastConfirmed/observed)
 * 4) confidence as weak tie-breaker
 */
export function selectCurrentFacts(
  facts: readonly TemporalFactV1[],
  nowIso: string,
  opts?: { workspace?: string; minTrustRank?: number; includeUncertain?: boolean },
): TemporalFactV1[] {
  const minTrust = opts?.minTrustRank ?? 0;
  const includeUncertain = opts?.includeUncertain !== false;
  const candidates = facts.filter((f) => {
    if (opts?.workspace && f.workspace !== opts.workspace) return false;
    if (!isFactCurrentlyValid(f, nowIso)) return false;
    if (f.temporalStatus === "UNCERTAIN" && !includeUncertain) return false;
    if (isStaleFact(f, nowIso) && f.temporalStatus !== "UNCERTAIN") return false;
    if (factTrustRank(f) < minTrust) return false;
    return true;
  });

  const byKey = new Map<string, TemporalFactV1>();
  for (const f of candidates) {
    const key = `${f.workspace}::${f.title.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, f);
      continue;
    }
    byKey.set(key, preferFact(prev, f, nowIso));
  }
  return [...byKey.values()];
}

/** Prefer higher trust, then fresher, then higher confidence. Owner never loses to low-trust import. */
export function preferFact(a: TemporalFactV1, b: TemporalFactV1, nowIso: string): TemporalFactV1 {
  const ta = factTrustRank(a);
  const tb = factTrustRank(b);
  // Strong veto: inference/third_party cannot override owner_direct / physical
  if (ta >= 90 && tb < 60) return a;
  if (tb >= 90 && ta < 60) return b;
  if (tb !== ta) return tb > ta ? b : a;
  const fa = a.lastConfirmedAt || a.observedAt || a.createdAt;
  const fb = b.lastConfirmedAt || b.observedAt || b.createdAt;
  if (fb !== fa) return fb > fa ? b : a;
  if (b.confidence !== a.confidence) return b.confidence > a.confidence ? b : a;
  // Prefer non-stale
  const sa = isStaleFact(a, nowIso);
  const sb = isStaleFact(b, nowIso);
  if (sa !== sb) return sa ? b : a;
  return b.updatedAt >= a.updatedAt ? b : a;
}

/**
 * Can candidate fact replace existing current fact without Owner review?
 * Low-trust import never auto-overrides owner_direct.
 */
export function mayAutoOverride(existing: TemporalFactV1, candidate: TemporalFactV1): boolean {
  const te = factTrustRank(existing);
  const tc = factTrustRank(candidate);
  if (te >= OWNER_DIRECT_RANK - 5 && tc < 60) return false;
  if (tc + 10 < te) return false;
  return tc > te || (tc >= te && (candidate.updatedAt || "") >= (existing.updatedAt || ""));
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
 * Low-trust imports never auto-supersede owner_direct / physical_observation.
 */
export function detectFactConflicts(
  facts: readonly TemporalFactV1[],
  nowIso: string,
): FactConflictV1[] {
  const current = facts.filter(
    (f) =>
      (f.temporalStatus === "CURRENT" || f.temporalStatus === "UNCERTAIN") &&
      isFactCurrentlyValid(f, nowIso),
  );
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
    const sorted = [...group].sort((a, b) => {
      const winner = preferFact(a, b, nowIso);
      return winner.id === b.id ? 1 : -1;
    });
    // Prefer highest trust+fresh as "newer" authority
    const preferred = sorted.reduce((acc, f) => preferFact(acc, f, nowIso));
    for (const other of group) {
      if (other.id === preferred.id) continue;
      if (other.content.trim() === preferred.content.trim()) continue;
      const preferredTrust = factTrustRank(preferred);
      const otherTrust = factTrustRank(other);
      let resolution: "supersede_older" | "review" = "review";
      let reason = "Similar authority — Owner review.";
      if (mayAutoOverride(other, preferred)) {
        resolution = "supersede_older";
        reason = `Higher/equal trust (${preferredTrust} vs ${otherTrust}) preferred at ${preferred.updatedAt}.`;
      } else if (otherTrust >= 90 && preferredTrust < 60) {
        reason = `Low-trust candidate cannot override owner/physical (${preferredTrust} vs ${otherTrust}).`;
      }
      conflicts.push({
        olderId: other.id,
        newerId: preferred.id,
        title: preferred.title,
        olderContent: other.content.slice(0, 200),
        newerContent: preferred.content.slice(0, 200),
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
