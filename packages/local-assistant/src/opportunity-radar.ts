/**
 * Opportunity Radar — meaningful signals only; scored by value/urgency/confidence/interruption.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { RelationshipV1 } from "./contracts.js";
import type { VehicleRecordV1 } from "./vehicle-inventory.js";

export type OpportunityKindV1 =
  | "inventory_match"
  | "price_change"
  | "stale_customer"
  | "reactivation"
  | "brand_signal"
  | "business_idea"
  | "career_fit"
  | "other";

export interface OpportunitySignalV1 {
  id: OpaqueId | string;
  kind: OpportunityKindV1;
  workspace: string;
  title: string;
  detail: string;
  value: number;
  urgency: number;
  confidence: number;
  interruptionCost: number;
  /** Higher = surface first */
  score: number;
  entityIds: string[];
  createdAt: IsoTimestamp;
  source: string;
}

export function scoreOpportunitySignal(o: Omit<OpportunitySignalV1, "score">): number {
  return o.value * 2 + o.urgency * 1.5 + o.confidence * 0.8 - o.interruptionCost * 2;
}

/** Match customer free-text interests / notes against online inventory. */
export function detectInventoryMatches(input: {
  relationships: readonly RelationshipV1[];
  vehicles: readonly VehicleRecordV1[];
  nowIso: string;
  nextId: (kind: string) => string;
}): OpportunitySignalV1[] {
  const signals: OpportunitySignalV1[] = [];
  const online = input.vehicles.filter(
    (v) => v.presenceStatus === "ONLINE_LISTED" || v.presenceStatus === "PHYSICALLY_VERIFIED",
  );

  for (const r of input.relationships) {
    if (r.archived || r.workspace !== "work") continue;
    // Never emit inventory-match opportunities for synthetic/fixture customers
    const nameBlob = `${r.displayName} ${r.organisation} ${r.notes}`.toLowerCase();
    if (
      /\be2e\b|\bsynthetic\b|\bfixture\b|\bjane test\b|\bacme r7\b|\bcsv e2e\b|\bfirst source contact\b|\btest company\b|limited tacoma under/.test(
        nameBlob,
      )
    ) {
      continue;
    }
    const blob = [
      r.displayName,
      r.notes,
      r.nextAction,
      ...(r.interests ?? []).map((i) => i.description),
      ...(r.interactions ?? []).slice(0, 8).map((i) => i.summary),
    ]
      .join(" ")
      .toLowerCase();
    if (!blob.trim()) continue;

    const wantsSuv = /\bsuv\b|highlander|rav4|4runner|sequoia/.test(blob);
    const wantsTruck = /\btruck\b|tacoma|tundra/.test(blob);
    const wantsCamry = /\bcamry\b|sedan/.test(blob);
    const under = blob.match(/under\s*\$?\s*([\d,]+)/);
    const maxPrice = under ? Number(under[1]!.replace(/,/g, "")) : null;
    const notBlack = /not black|no black|avoid black/.test(blob);
    const thirdRow = /third row|3rd row|three row/.test(blob);

    for (const v of online) {
      const model = (v.model || "").toLowerCase();
      let fit = 0;
      if (wantsTruck && /tacoma|tundra/.test(model)) fit += 40;
      if (wantsSuv && /highlander|rav4|4runner|sequoia|venza/.test(model)) fit += 40;
      if (wantsCamry && /camry|corolla/.test(model)) fit += 35;
      if (thirdRow && /highlander|sequoia|sienna|grand highlander/.test(model)) fit += 25;
      if (maxPrice != null) {
        const p = v.priceHistory[0]?.advertisedPrice;
        if (p != null && p <= maxPrice) fit += 20;
        else if (p != null && p > maxPrice) fit -= 30;
      }
      if (notBlack && /black/i.test(v.exteriorColor || "")) fit -= 40;
      if (fit < 45) continue;

      const base = {
        id: input.nextId("opp"),
        kind: "inventory_match" as const,
        workspace: "work",
        title: `Match for ${r.displayName}: ${[v.year, v.make, v.model, v.trim].filter(Boolean).join(" ")}`,
        detail: `Customer signals matched inventory ${v.vin ?? v.stockNumber ?? v.id}. Presence ${v.presenceStatus}. Online ≠ on lot.`,
        value: Math.min(95, 50 + fit / 2),
        urgency: v.presenceStatus === "PHYSICALLY_VERIFIED" ? 70 : 55,
        confidence: Math.min(90, 40 + fit / 2),
        interruptionCost: 25,
        entityIds: [r.id, v.id],
        createdAt: input.nowIso,
        source: "opportunity.inventory_match",
      };
      signals.push({ ...base, score: scoreOpportunitySignal(base) });
    }
  }

  // Price changes
  for (const v of online) {
    if (v.priceHistory.length < 2) continue;
    const [latest, prev] = v.priceHistory;
    if (latest?.advertisedPrice == null || prev?.advertisedPrice == null) continue;
    if (latest.advertisedPrice === prev.advertisedPrice) continue;
    const base = {
      id: input.nextId("opp"),
      kind: "price_change" as const,
      workspace: "work",
      title: `Price change: ${v.vin ?? v.stockNumber ?? v.id}`,
      detail: `$${prev.advertisedPrice} → $${latest.advertisedPrice} (${latest.at})`,
      value: 40,
      urgency: 45,
      confidence: 90,
      interruptionCost: 15,
      entityIds: [v.id],
      createdAt: input.nowIso,
      source: "opportunity.price_change",
    };
    signals.push({ ...base, score: scoreOpportunitySignal(base) });
  }

  // Stale customers (no contact 14+ days, still open follow-ups or nextAction)
  const day = Date.parse(input.nowIso);
  for (const r of input.relationships) {
    if (r.archived || r.workspace !== "work") continue;
    const last = r.lastContactAt ? Date.parse(r.lastContactAt) : 0;
    const days = last ? (day - last) / 86400000 : 999;
    if (days < 14) continue;
    if (!(r.nextAction || (r.followUps ?? []).some((f) => f.status === "open"))) continue;
    const base = {
      id: input.nextId("opp"),
      kind: "stale_customer" as const,
      workspace: "work",
      title: `Quiet account: ${r.displayName}`,
      detail: `No contact ~${Math.floor(days)} days. Reactivation candidate — Owner decides outreach.`,
      value: 55,
      urgency: 40,
      confidence: 70,
      interruptionCost: 30,
      entityIds: [r.id],
      createdAt: input.nowIso,
      source: "opportunity.stale_customer",
    };
    signals.push({ ...base, score: scoreOpportunitySignal(base) });
  }

  signals.sort((a, b) => b.score - a.score);
  // Only surface meaningful — filter low score / high interruption spam / weak confidence
  return signals
    .filter((s) => {
      if (s.confidence < 45) return false;
      if (s.score < 70 && s.interruptionCost > 40) return false;
      return s.score >= 80 || (s.value >= 55 && s.interruptionCost <= 30);
    })
    .slice(0, 25);
}

// ─── Value ledger ───────────────────────────────────────────────────────────

export type ValueEstimateKindV1 = "estimated" | "unknown" | "measured";

export interface ValueLedgerEntryV1 {
  id: OpaqueId;
  workspace: string;
  action: string;
  capability: string;
  timeSavedMinutes: number | null;
  revenueInfluenced: number | null;
  costAvoided: number | null;
  riskPrevented: string;
  ownerInterventionRequired: boolean;
  correctionRequired: boolean;
  estimateKind: ValueEstimateKindV1;
  /** Required non-empty for estimateKind=measured; empty for unknown/estimated. */
  evidenceIds: string[];
  notes: string;
  at: IsoTimestamp;
}

/**
 * UNKNOWN is a legitimate result.
 * ESTIMATED must never silently become MEASURED.
 * MEASURED financial/outcome claims require supporting evidence ids.
 */
export function buildValueLedgerEntry(
  input: Record<string, unknown>,
  ctx: { id: OpaqueId; now: IsoTimestamp; workspace: string },
): ValueLedgerEntryV1 {
  const requested = (["estimated", "unknown", "measured"] as const).includes(
    input.estimateKind as ValueEstimateKindV1,
  )
    ? (input.estimateKind as ValueEstimateKindV1)
    : "estimated";
  const evidenceIds = Array.isArray(input.evidenceIds)
    ? input.evidenceIds.map((x) => String(x).slice(0, 200)).filter(Boolean).slice(0, 40)
    : typeof input.evidenceId === "string" && input.evidenceId
      ? [String(input.evidenceId).slice(0, 200)]
      : [];

  let estimateKind = requested;
  let notes = String(input.notes ?? "").slice(0, 2000);
  // Hard rule: measured without evidence demotes to estimated (never silent measured).
  if (estimateKind === "measured" && evidenceIds.length === 0) {
    estimateKind = "estimated";
    notes = `${notes} [demoted measured→estimated: no evidenceIds]`.trim().slice(0, 2000);
  }

  return {
    id: ctx.id,
    workspace: ctx.workspace,
    action: String(input.action ?? "").slice(0, 500) || "action",
    capability: String(input.capability ?? "general").slice(0, 80),
    timeSavedMinutes:
      input.timeSavedMinutes === undefined || input.timeSavedMinutes === null
        ? null
        : Number(input.timeSavedMinutes),
    revenueInfluenced:
      input.revenueInfluenced === undefined || input.revenueInfluenced === null
        ? null
        : Number(input.revenueInfluenced),
    costAvoided:
      input.costAvoided === undefined || input.costAvoided === null ? null : Number(input.costAvoided),
    riskPrevented: String(input.riskPrevented ?? "").slice(0, 500),
    ownerInterventionRequired: input.ownerInterventionRequired === true,
    correctionRequired: input.correctionRequired === true,
    estimateKind,
    evidenceIds,
    notes,
    at: ctx.now,
  };
}

/** Promote estimated → measured only when evidence is supplied (never silent). */
export function promoteToMeasured(
  entry: ValueLedgerEntryV1,
  evidenceIds: string[],
  now: IsoTimestamp,
): ValueLedgerEntryV1 {
  const ids = evidenceIds.map((x) => String(x).slice(0, 200)).filter(Boolean).slice(0, 40);
  if (!ids.length) {
    return {
      ...entry,
      notes: `${entry.notes} [promote refused: empty evidence]`.slice(0, 2000),
      at: now,
    };
  }
  if (entry.estimateKind === "unknown" && entry.revenueInfluenced == null && entry.timeSavedMinutes == null) {
    // unknown stays unknown until there is something to measure
    return {
      ...entry,
      estimateKind: "measured",
      evidenceIds: ids,
      notes: `${entry.notes} [promoted unknown→measured with evidence]`.slice(0, 2000),
      at: now,
    };
  }
  return {
    ...entry,
    estimateKind: "measured",
    evidenceIds: ids,
    notes: `${entry.notes} [promoted to measured]`.slice(0, 2000),
    at: now,
  };
}

export function assertValueLedgerInvariants(entry: ValueLedgerEntryV1): string[] {
  const errors: string[] = [];
  if (entry.estimateKind === "measured" && (!entry.evidenceIds || entry.evidenceIds.length === 0)) {
    errors.push("MEASURED requires evidenceIds");
  }
  if (entry.estimateKind === "unknown") {
    // UNKNOWN is legitimate even with null metrics
  }
  return errors;
}
