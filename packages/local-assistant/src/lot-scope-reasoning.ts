/**
 * Knowing the difference between what was seen, what is listed, and what is unknown.
 *
 * The Owner photographed one car, AION identified it correctly, and then he asked: *"How many other
 * used cars were on the lot?"* AION answered by describing the one car again. That is the failure
 * that made the whole system feel unhelpful — not a wrong fact, but an inability to notice that the
 * question was about a population it had barely sampled.
 *
 * Three quantities are involved and only one of them was ever known:
 *
 * | | |
 * |---|---|
 * | Physically verified today | 1 — the Crown, photographed and matched |
 * | Currently listed online | a real number from the dealer feed |
 * | Actually standing on the lot | **unknown, and not derivable from either** |
 *
 * The online count is not the lot count. Cars sell and stay listed for a day; cars arrive before
 * they are listed; cars sit at a satellite lot or in service. Reporting the feed count as the lot
 * count would be a confident false claim about the physical world the Owner is standing in — the
 * kind he would repeat to a customer.
 *
 * So the honest answer names the sample, gives the listing count as a listing count, says plainly
 * that the physical population is unknown, and offers the one thing that would change that: keep
 * photographing. An unknown delivered with the path out of it is useful; an unknown delivered as a
 * shrug is not.
 */
import type { IsoTimestamp } from "./contracts.js";
import type { VehicleRecordV1 } from "./vehicle-inventory.js";

/** Where a claim comes from. The ranking is epistemic, not a confidence score. */
export type EvidenceClassV1 =
  | "PHYSICAL_OBSERVATION"
  | "CURRENT_WEBSITE_FACT"
  | "OWNER_DIRECT_FACT"
  | "CUSTOMER_STATEMENT"
  | "PUBLIC_WEB_FACT"
  | "INFERENCE"
  | "UNKNOWN";

export interface ScopedCountV1 {
  evidenceClass: EvidenceClassV1;
  count: number | null;
  /** How this number was arrived at, in the Owner's language. */
  basis: string;
  observedAt: IsoTimestamp | null;
}

export interface LotScopeAnswerV1 {
  question: string;
  physicallyVerified: ScopedCountV1;
  currentlyListed: ScopedCountV1;
  /** Deliberately null. The physical population is not derivable from the other two. */
  actualLotPopulation: ScopedCountV1;
  reply: string;
  /** The action that would actually reduce the unknown. */
  nextStep: string | null;
}

export interface LotScopeInputV1 {
  question: string;
  /** Vehicles physically observed and identified in the current walk. */
  physicallyVerifiedVehicleIds: readonly string[];
  vehicles: readonly VehicleRecordV1[];
  now: IsoTimestamp;
  /** Restrict to a condition when the question does, e.g. "used". */
  condition?: "new" | "used" | "cpo" | null;
  /** When the dealer feed was last refreshed. Age matters more than the number. */
  listingsObservedAt?: IsoTimestamp | null;
}

/** Detects a question about how many vehicles there are, as opposed to about one vehicle. */
export function asksAboutLotPopulation(text: string): boolean {
  const t = String(text ?? "");
  if (!/\bhow many\b|\bhow much (?:inventory|stock)\b|\bcount\b/i.test(t)) return false;
  return /\b(?:cars?|vehicles?|units?|used|new|inventory|lot)\b/i.test(t);
}

export function conditionFromQuestion(text: string): "new" | "used" | "cpo" | null {
  const t = String(text ?? "").toLowerCase();
  if (/\bcertified\b|\bcpo\b/.test(t)) return "cpo";
  if (/\bused\b|\bpre[- ]?owned\b|\bsecond[- ]hand\b/.test(t)) return "used";
  if (/\bnew\b/.test(t)) return "new";
  return null;
}

/**
 * Answer a population question without pretending to know the population.
 *
 * The reply is assembled in a fixed order — sample, then listings, then the unknown, then the way
 * out — because that order is what stops the listing number being read as the answer. Leading with
 * a large number and qualifying it afterwards is how a caveat gets skipped.
 */
export function answerLotScopeQuestion(input: LotScopeInputV1): LotScopeAnswerV1 {
  const condition = input.condition ?? conditionFromQuestion(input.question);
  const matchesCondition = (v: VehicleRecordV1): boolean =>
    !condition || String(v.condition ?? "").toLowerCase() === condition;

  const verifiedSet = new Set(input.physicallyVerifiedVehicleIds);
  const verified = input.vehicles.filter((v) => verifiedSet.has(v.id) && matchesCondition(v));

  const listed = input.vehicles.filter(
    (v) => matchesCondition(v) && v.presenceStatus !== "NO_LONGER_FOUND_ONLINE",
  );
  const listingAge = input.listingsObservedAt
    ? Math.floor((Date.parse(input.now) - Date.parse(input.listingsObservedAt)) / 3_600_000)
    : null;

  const label = condition ? `${condition} ` : "";

  const physicallyVerified: ScopedCountV1 = {
    evidenceClass: "PHYSICAL_OBSERVATION",
    count: verified.length,
    basis: `${verified.length} ${label}vehicle${verified.length === 1 ? "" : "s"} you photographed and I identified`,
    observedAt: input.now,
  };

  const currentlyListed: ScopedCountV1 = {
    evidenceClass: "CURRENT_WEBSITE_FACT",
    count: listed.length,
    basis: `${listed.length} ${label}vehicle${listed.length === 1 ? "" : "s"} in the dealer feed`,
    observedAt: input.listingsObservedAt ?? null,
  };

  // The load-bearing null. Nothing in this function may fill it.
  const actualLotPopulation: ScopedCountV1 = {
    evidenceClass: "UNKNOWN",
    count: null,
    basis: "no one has counted the physical lot — the listing count is not a substitute",
    observedAt: null,
  };

  const lines: string[] = [];

  lines.push(
    verified.length === 0
      ? `I haven't physically verified any ${label}vehicles yet today, so I can't tell you what's actually on the lot.`
      : `I've physically verified ${verified.length} ${label}vehicle${verified.length === 1 ? "" : "s"} from your photos today — `
        + `${verified.map((v) => vehicleLabel(v)).slice(0, 3).join(", ")}${verified.length > 3 ? ", and others" : ""}. `
        + `That's my whole physical sample.`,
  );

  lines.push(
    listed.length
      ? `The dealer website currently lists ${listed.length} ${label}vehicle${listed.length === 1 ? "" : "s"}`
        + `${listingAge != null ? ` (feed checked about ${listingAge === 0 ? "this hour" : `${listingAge}h ago`})` : ""}. `
        + `That's the online inventory, not proof they're all standing out there.`
      : `The dealer feed has no ${label}vehicles listed right now, which is worth a second look on its own.`,
  );

  lines.push(
    `How many are actually on the lot, I don't know. Cars sell and stay listed for a day, arrive before they're listed, `
    + `or sit in service — so the two numbers above genuinely aren't the same thing.`,
  );

  const nextStep = `Keep photographing as you walk and I'll build today's real count as you go.`;
  lines.push(nextStep);

  return {
    question: input.question,
    physicallyVerified,
    currentlyListed,
    actualLotPopulation,
    reply: lines.join(" "),
    nextStep,
  };
}

function vehicleLabel(v: VehicleRecordV1): string {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || v.vin || v.id;
}

/**
 * Guard against a physical claim that no observation supports.
 *
 * Used where a reply is composed from mixed evidence. Returning the offending phrases rather than a
 * boolean lets a test say which sentence overclaimed.
 */
const PHYSICAL_CLAIM_SHAPES: RegExp[] = [
  // An adjective may sit between the count and the noun — "41 used vehicles on the lot" is exactly
  // how the Owner phrases it, and a pattern without that allowance catches nothing real.
  /\b(?:there are|we have|the lot has)\s+\d+\s+(?:\w+\s+){0,2}(?:cars?|vehicles?|units?)\b.{0,24}\bon the lot\b/i,
  /\b\d+\s+(?:\w+\s+){0,2}(?:cars?|vehicles?)\s+(?:are|were) (?:on|sitting on) the lot\b/i,
  /\ball\s+\d+\s+(?:are|were) (?:on the lot|verified)\b/i,
];

export function findUnsupportedPhysicalClaims(input: {
  text: string;
  physicallyVerifiedCount: number;
}): string[] {
  const found: string[] = [];
  for (const shape of PHYSICAL_CLAIM_SHAPES) {
    const match = input.text.match(shape);
    if (!match) continue;
    const claimed = Number(match[0].match(/\d+/)?.[0] ?? 0);
    // A physical claim is only supported up to the number actually observed.
    if (claimed > input.physicallyVerifiedCount) found.push(match[0]);
  }
  return found;
}
