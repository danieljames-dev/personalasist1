/**
 * Matching customers to cars, and cars to customers.
 *
 * Two rules do most of the work here.
 *
 * A hard requirement disqualifies rather than scoring low. "It can't be a hybrid" is not eighty
 * percent satisfied by a hybrid; a ranked list that quietly floats one to the top is how a
 * salesperson walks a customer to the wrong car.
 *
 * And anything the record cannot confirm is reported as unknown, never as a match. If the listing
 * does not state the interior colour, AION does not know the interior colour — inventing it is how a
 * sales tool becomes a liability the moment the customer opens the door.
 */
import type { VehicleRecordV1 } from "./vehicle-inventory.js";
import type { CustomerNeedV1, NeedFreshnessV1 } from "./customer-needs.js";
import { isCurrentNeed, needFreshness } from "./customer-needs.js";

export interface MatchComponentV1 {
  attribute: string;
  /** What the customer asked for. */
  wanted: string;
  /** What the vehicle record actually says, or null when it says nothing. */
  found: string | null;
  sourceRef: string;
}

export interface CustomerVehicleFitV1 {
  vehicleId: string;
  vin: string | null;
  label: string;
  disqualified: boolean;
  hardRequirementsMet: MatchComponentV1[];
  preferencesMet: MatchComponentV1[];
  conflicts: MatchComponentV1[];
  unknowns: MatchComponentV1[];
  matchScore: number;
  why: string[];
}

function vehicleLabel(v: VehicleRecordV1): string {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || v.vin || v.id;
}

/** Newest known price; refresh prepends observations that may carry no price at all. */
function latestPrice(v: VehicleRecordV1): number | null {
  for (const entry of v.priceHistory ?? []) {
    const p = (entry as { advertisedPrice?: number | null }).advertisedPrice;
    if (typeof p === "number" && p > 0) return p;
  }
  return null;
}

/**
 * What the vehicle record says about one need attribute.
 *
 * Returns `null` when the record is silent. That distinction — silent versus contradicting — is the
 * whole point: silence becomes an unknown the Owner can ask about, a contradiction becomes a
 * conflict.
 */
function observedValue(v: VehicleRecordV1, need: CustomerNeedV1): { value: string | null; sourceRef: string } {
  const gov = (v.govVinFacts ?? null) as { fuelType?: string | null; driveType?: string | null } | null;
  switch (need.attribute) {
    case "make": return { value: v.make?.toLowerCase() ?? null, sourceRef: "dealer-listing" };
    case "model": return { value: v.model?.toLowerCase() ?? null, sourceRef: "dealer-listing" };
    case "trim": return { value: v.trim?.toLowerCase() ?? null, sourceRef: "dealer-listing" };
    case "condition": return { value: v.condition && v.condition !== "unknown" ? v.condition : null, sourceRef: "dealer-listing" };
    case "color": return { value: v.exteriorColor?.toLowerCase() ?? null, sourceRef: "dealer-listing" };
    case "max-price": {
      const p = latestPrice(v);
      return { value: p == null ? null : String(p), sourceRef: "dealer-listing" };
    }
    case "powertrain": {
      // Government decode is the trustworthy source for fuel type; a trim name is not.
      const fuel = gov?.fuelType?.toLowerCase() ?? null;
      return { value: fuel, sourceRef: "government-vin-decode" };
    }
    default:
      // Features, payment targets, timelines and objections are not represented on a listing.
      // Reporting them as unknown is correct; guessing from the trim name would be inventing
      // equipment, which is the one thing this module must never do.
      return { value: null, sourceRef: "not-in-listing" };
  }
}

function satisfies(need: CustomerNeedV1, observed: string): boolean {
  if (need.attribute === "max-price") {
    const price = Number(observed);
    return Number.isFinite(price) && need.numericValue != null && price <= need.numericValue;
  }
  if (need.attribute === "powertrain") {
    const wantsHybrid = /hybrid|electric|phev|bev/.test(need.value);
    const isHybrid = /hybrid|electric|plug-?in|bev/.test(observed);
    return wantsHybrid === isHybrid;
  }
  return observed.includes(need.value) || need.value.includes(observed);
}

/** Score a single vehicle against one customer's current needs. */
export function fitVehicleToNeeds(input: {
  vehicle: VehicleRecordV1;
  needs: readonly CustomerNeedV1[];
}): CustomerVehicleFitV1 {
  const { vehicle } = input;
  const needs = input.needs.filter(isCurrentNeed);
  const hardMet: MatchComponentV1[] = [];
  const prefMet: MatchComponentV1[] = [];
  const conflicts: MatchComponentV1[] = [];
  const unknowns: MatchComponentV1[] = [];

  for (const need of needs) {
    if (need.strength === "UNKNOWN") continue;
    const { value, sourceRef } = observedValue(vehicle, need);
    const component: MatchComponentV1 = {
      attribute: need.attribute,
      wanted: need.value,
      found: value,
      sourceRef,
    };
    if (value == null) { unknowns.push(component); continue; }

    const ok = need.strength === "EXCLUSION" ? !satisfies(need, value) : satisfies(need, value);
    if (ok) {
      if (need.strength === "HARD_REQUIREMENT" || need.strength === "EXCLUSION") hardMet.push(component);
      else prefMet.push(component);
    } else {
      conflicts.push(component);
    }
  }

  // A failed hard requirement or exclusion disqualifies outright. It never becomes a lower score.
  const disqualified = conflicts.some((c) => {
    const need = needs.find((n) => n.attribute === c.attribute && n.value === c.wanted);
    return need?.strength === "HARD_REQUIREMENT" || need?.strength === "EXCLUSION";
  });

  const matchScore = disqualified
    ? 0
    : Math.min(100, hardMet.length * 25 + prefMet.length * 10 - conflicts.length * 5);

  const why: string[] = [];
  for (const c of hardMet) why.push(`${c.attribute} ${c.found} meets a requirement`);
  for (const c of prefMet) why.push(`${c.attribute} ${c.found} matches a preference`);
  for (const c of conflicts) why.push(`${c.attribute} is ${c.found}, wanted ${c.wanted}`);

  return {
    vehicleId: vehicle.id,
    vin: vehicle.vin,
    label: vehicleLabel(vehicle),
    disqualified,
    hardRequirementsMet: hardMet,
    preferencesMet: prefMet,
    conflicts,
    unknowns,
    matchScore: Math.max(0, matchScore),
    why,
  };
}

/** Rank current inventory for one customer. Disqualified vehicles are excluded, not buried. */
export function matchNeedsToInventory(input: {
  needs: readonly CustomerNeedV1[];
  vehicles: readonly VehicleRecordV1[];
  limit?: number;
}): CustomerVehicleFitV1[] {
  return input.vehicles
    .map((vehicle) => fitVehicleToNeeds({ vehicle, needs: input.needs }))
    .filter((fit) => !fit.disqualified && (fit.hardRequirementsMet.length > 0 || fit.preferencesMet.length > 0))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, input.limit ?? 10);
}

export interface ReverseMatchV1 {
  relationshipRef: string;
  customerName: string;
  matchScore: number;
  freshness: NeedFreshnessV1;
  /** Which needs matched, and when the customer said them. */
  matchedOn: Array<{ attribute: string; value: string; observedAt: string }>;
  why: string;
}

/**
 * Who might want this car.
 *
 * The inverse of the above and more dangerous, because the output is a prompt to telephone a real
 * person. Stale wants are therefore surfaced with their age rather than silently ranked, and a
 * customer is never suggested on a single vague historic mention.
 */
export function matchVehicleToCustomers(input: {
  vehicle: VehicleRecordV1;
  needsByCustomer: ReadonlyMap<string, { name: string; needs: readonly CustomerNeedV1[] }>;
  now: string;
  /** Include customers whose needs are older than 90 days. Off by default. */
  includeStale?: boolean;
  minConfidence?: number;
  limit?: number;
}): ReverseMatchV1[] {
  const minConfidence = input.minConfidence ?? 60;
  const results: ReverseMatchV1[] = [];

  for (const [relationshipRef, entry] of input.needsByCustomer) {
    const usable = entry.needs.filter((n) => isCurrentNeed(n) && n.confidence >= minConfidence);
    if (!usable.length) continue;

    const fit = fitVehicleToNeeds({ vehicle: input.vehicle, needs: usable });
    if (fit.disqualified) continue;
    if (!fit.hardRequirementsMet.length && !fit.preferencesMet.length) continue;

    const matchedAttributes = [...fit.hardRequirementsMet, ...fit.preferencesMet].map((c) => c.attribute);
    const matchedNeeds = usable.filter((n) => matchedAttributes.includes(n.attribute));
    // Freshness is judged on the needs that actually matched, not on the customer's newest activity:
    // a recent unrelated note does not make a six-month-old model preference current.
    const freshest = matchedNeeds.reduce<NeedFreshnessV1>((best, n) => {
      const f = needFreshness(n, input.now);
      if (best === "FRESH" || f === "FRESH") return "FRESH";
      if (best === "AGING" || f === "AGING") return "AGING";
      return "STALE";
    }, "STALE");

    if (freshest === "STALE" && !input.includeStale) continue;

    results.push({
      relationshipRef,
      customerName: entry.name,
      matchScore: fit.matchScore,
      freshness: freshest,
      matchedOn: matchedNeeds.map((n) => ({ attribute: n.attribute, value: n.value, observedAt: n.observedAt })),
      why: fit.why.join("; "),
    });
  }

  return results.sort((a, b) => b.matchScore - a.matchScore).slice(0, input.limit ?? 10);
}

/** Owner-facing fit answer. Unknowns are stated, never quietly dropped. */
export function formatFitAnswer(fits: readonly CustomerVehicleFitV1[], customerName: string): string {
  if (!fits.length) {
    return `Nothing in current inventory matches what I have recorded for ${customerName}.`;
  }
  const lines = [`Current inventory that fits ${customerName}:`];
  for (const fit of fits) {
    lines.push("");
    lines.push(`${fit.label}${fit.vin ? ` · VIN ${fit.vin}` : ""} — score ${fit.matchScore}`);
    if (fit.why.length) lines.push(`  why: ${fit.why.join("; ")}`);
    if (fit.unknowns.length) {
      lines.push(`  unknown: ${fit.unknowns.map((u) => u.attribute).join(", ")} — not stated in the listing`);
    }
  }
  return lines.join("\n");
}

export function formatReverseMatchAnswer(matches: readonly ReverseMatchV1[], vehicleLabelText: string): string {
  if (!matches.length) {
    return `No current customer needs match ${vehicleLabelText}. I won't suggest anyone on old or vague interest.`;
  }
  const lines = [`Customers whose recorded needs match ${vehicleLabelText}:`];
  for (const m of matches) {
    const when = m.matchedOn[0]?.observedAt?.slice(0, 10) ?? "unknown date";
    const age = m.freshness === "FRESH" ? "" : ` — ${m.freshness.toLowerCase()}, worth confirming`;
    lines.push(`· ${m.customerName} (score ${m.matchScore}) — matched ${m.matchedOn.map((x) => x.attribute).join(", ")}, said ${when}${age}`);
  }
  return lines.join("\n");
}
