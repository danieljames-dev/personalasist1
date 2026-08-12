/**
 * Vehicle intelligence — grounded answers with explicit knowledge class.
 * Never presents general model knowledge as a specific unit's installed equipment.
 */
import type { RelationshipV1 } from "./contracts.js";
import type { VehicleRecordV1, VehiclePresenceStatusV1 } from "./vehicle-inventory.js";
import { normalizeVinCandidate, validateVin, queryVehicles } from "./vehicle-inventory.js";
import { findModelKnowledge, findTrimsInText, modelKnowledgeLines, asksGenericTrimLadder, TOYOTA_GENERIC_TRIM_LADDER } from "./toyota-model-knowledge.js";
import { describeRecallStatus } from "./recall-intelligence.js";

export type VehicleKnowledgeClassV1 =
  | "LIVE_DEALER_INVENTORY"
  | "FIXTURE_DEMO"
  | "GENERAL_MODEL_KNOWLEDGE"
  | "MANUFACTURER_FACT"
  | "GOVERNMENT_VIN_FACT"
  | "INFERENCE";

export interface VehicleAnswerLineV1 {
  text: string;
  class: VehicleKnowledgeClassV1;
  source?: string;
}

export interface VehicleQueryAnswerV1 {
  query: string;
  lines: VehicleAnswerLineV1[];
  vehicles: Array<{
    vin: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    price: number | null;
    presence: VehiclePresenceStatusV1;
    stock: string | null;
    condition: string | null;
    sourceClass: VehicleKnowledgeClassV1;
    lastSeen: string | null;
  }>;
  reply: string;
  staleWarning: string | null;
}

export interface CustomerVehicleMatchV1 {
  relationshipId: string;
  customerName: string;
  vehicleId: string;
  vin: string | null;
  label: string;
  whyMatches: string[];
  knownConflicts: string[];
  unknown: string[];
  sourceClass: VehicleKnowledgeClassV1;
  score: number;
}

/** Toyota Camry trim ladder — GENERAL MODEL KNOWLEDGE only, not a unit's options. */
export const TOYOTA_CAMRY_TRIM_KNOWLEDGE: readonly VehicleAnswerLineV1[] = [
  {
    class: "GENERAL_MODEL_KNOWLEDGE",
    text: "Camry LE: base trim; typically cloth seats, smaller wheels, core safety tech (TSS). Not a statement about any specific car on the lot.",
    source: "general-model:toyota-camry-trim",
  },
  {
    class: "GENERAL_MODEL_KNOWLEDGE",
    text: "Camry SE: sport-oriented styling (wheels, suspension, seats) vs LE. Equipment still varies by year/packages.",
    source: "general-model:toyota-camry-trim",
  },
  {
    class: "GENERAL_MODEL_KNOWLEDGE",
    text: "Camry XLE: comfort/feature step-up (often leatherette, more convenience). Confirm package on the unit.",
    source: "general-model:toyota-camry-trim",
  },
  {
    class: "GENERAL_MODEL_KNOWLEDGE",
    text: "Camry XSE: sport + comfort blend (styling of SE with higher features). Confirm exact options on the VIN/sticker.",
    source: "general-model:toyota-camry-trim",
  },
];

export function isFixtureVehicle(v: VehicleRecordV1): boolean {
  const src = v.listingObservations?.[0]?.sourceType;
  if (src === "fixture") return true;
  // Demo VINs used in fixtures / synthetic walks
  if (v.vin && /^1HGCM(RW|PHY)/i.test(v.vin)) return true;
  return false;
}

export function vehicleSourceClass(v: VehicleRecordV1): VehicleKnowledgeClassV1 {
  if (isFixtureVehicle(v)) return "FIXTURE_DEMO";
  if (v.presenceStatus === "ONLINE_LISTED" || v.presenceStatus === "PHYSICALLY_VERIFIED") {
    return "LIVE_DEALER_INVENTORY";
  }
  return "INFERENCE";
}

/**
 * Budget cap from natural phrasing.
 *
 * Salespeople say "under 30k", not "under 30000". Capturing digits alone turned that into a $30
 * ceiling, so every price filter matched nothing — the query looked like empty inventory rather
 * than a parsing bug. Handle the k/K suffix, and treat bare small numbers as thousands too.
 */
export function parseMaxPriceFromText(text: string): number | null {
  const m = String(text ?? "")
    .toLowerCase()
    .match(/(?:under|below|less than|cheaper than|<)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k\b)?/);
  if (!m) return null;
  const raw = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(raw) || raw <= 0) return null;
  // "30k" -> 30000. A bare "30" in a car-price question means the same thing.
  const value = m[2] ? raw * 1000 : raw < 1000 ? raw * 1000 : raw;
  return value;
}

/**
 * Most recent *known* price.
 *
 * A refresh records an observation for every vehicle it sees, including listing pages that publish
 * no price — so the newest history entry is frequently all-null. Reading position 0 blindly
 * reported "price unknown" for vehicles whose price had just been recorded, and silently broke
 * price-filtered queries such as "Camrys under 30k". Scan newest-first for an actual value, and
 * still return null when no observation ever carried one.
 */
export function latestPrice(v: VehicleRecordV1): number | null {
  for (const entry of v.priceHistory ?? []) {
    const p = entry?.advertisedPrice ?? entry?.dealerPrice ?? entry?.msrp ?? null;
    if (p != null && p > 0) return p;
  }
  return null;
}

export function inventoryFreshness(
  lastRefresh: Record<string, string> | undefined,
  slug = "lakeland-toyota",
  nowIso: string,
  maxAgeHours = 36,
): { lastRefresh: string | null; stale: boolean; ageHours: number | null } {
  const raw = lastRefresh?.[slug] ?? null;
  if (!raw) return { lastRefresh: null, stale: true, ageHours: null };
  const ageMs = Date.parse(nowIso) - Date.parse(raw);
  const ageHours = Number.isFinite(ageMs) ? ageMs / 3_600_000 : null;
  return {
    lastRefresh: raw,
    stale: ageHours == null || ageHours > maxAgeHours,
    ageHours,
  };
}

function summarizeVehicle(v: VehicleRecordV1): string {
  const ymm = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Unknown YMMT";
  const price = latestPrice(v);
  const bits = [
    ymm,
    v.vin ? `VIN ${v.vin}` : null,
    v.stockNumber ? `stock ${v.stockNumber}` : null,
    price != null ? `$${price.toLocaleString()}` : "price unknown",
    v.condition || null,
    v.presenceStatus,
    vehicleSourceClass(v) === "FIXTURE_DEMO" ? "FIXTURE/DEMO — not live lot" : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

export function answerVehicleQuery(input: {
  query: string;
  vehicles: readonly VehicleRecordV1[];
  nowIso: string;
  lastInventoryRefresh?: Record<string, string>;
}): VehicleQueryAnswerV1 {
  const q = String(input.query ?? "").trim();
  const ql = q.toLowerCase();
  const lines: VehicleAnswerLineV1[] = [];
  const fresh = inventoryFreshness(input.lastInventoryRefresh, "lakeland-toyota", input.nowIso);
  const staleWarning = fresh.stale
    ? `Inventory refresh is ${fresh.lastRefresh ? `last at ${fresh.lastRefresh.slice(0, 16)} (age ~${fresh.ageHours?.toFixed(1)}h)` : "missing"} — treat ONLINE_LISTED as possibly stale until refreshed.`
    : null;

  // Trim / model knowledge — general orientation, never a claim about a specific car.
  const asksAboutTrims =
    /\bdifference between\b/i.test(q) ||
    /\btrims?\b/i.test(q) ||
    /\bcompare\b.*\b(trim|le|se|xle|xse|sr5|trd|limited|platinum)\b/i.test(q) ||
    /\bwhich (trims?|ones?)\b.*\b(hybrid|sport|off[- ]?road|comfort|luxury)\b/i.test(q) ||
    /\b(le|se|xle|xse)\b.*\b(le|se|xle|xse)\b/i.test(q);
  if (asksAboutTrims) {
    const known = findModelKnowledge(q);
    if (known) {
      lines.push(...modelKnowledgeLines(known, findTrimsInText(known, q)));
    } else {
      // Camry remains the fallback only because it is the historical default, not because the
      // question was about a Camry — say so rather than implying we understood the model.
      // Shared badges with no model named: explain the pattern rather than assuming a model.
      lines.push(...(asksGenericTrimLadder(q)
        ? TOYOTA_GENERIC_TRIM_LADDER
        : [{
            class: "INFERENCE" as const,
            text: "No specific Toyota model was recognised in that question. Name the model (Corolla, Camry, Tacoma, RAV4, Tundra, Corolla Cross, Highlander) for trim guidance.",
          }]));
    }
    lines.push({
      class: "INFERENCE",
      text: "Installed options on a specific car require VIN, stock sticker, or dealer listing fields — not trim-name alone.",
    });
  }

  // Filter live-ish inventory (include fixture so Owner sees honesty)
  let pool = [...input.vehicles];
  const preferLive = pool.some((v) => !isFixtureVehicle(v));
  if (preferLive) pool = pool.filter((v) => !isFixtureVehicle(v));

  // Coverage / counts — answer from stored live-ish inventory only.
  if (
    /\bhow many\b/i.test(ql) ||
    /\bhow much (of )?(the )?(dealer )?inventory\b/i.test(ql) ||
    /\bwhat (vehicles|cars|inventory) do we have\b/i.test(ql) ||
    /\bcoverage\b/i.test(ql)
  ) {
    const live = pool.filter((v) =>
      v.presenceStatus === "ONLINE_LISTED" ||
      v.presenceStatus === "PHYSICALLY_VERIFIED" ||
      v.presenceStatus === "NOT_VERIFIED",
    );
    const nNew = live.filter((v) => v.condition === "new").length;
    const nUsed = live.filter((v) => v.condition === "used" || v.condition === "cpo").length;
    const wantsNewOnly = /\bnew\b/i.test(ql) && !/\bused\b/i.test(ql);
    const wantsUsedOnly = /\bused\b/i.test(ql) && !/\bnew\b/i.test(ql);
    if (wantsNewOnly) {
      lines.push({
        class: "LIVE_DEALER_INVENTORY",
        text: `AION has ${nNew} new vehicle(s) in current live-ish inventory (public listing or walk evidence).`,
      });
      pool = live.filter((v) => v.condition === "new").slice(0, 25);
    } else if (wantsUsedOnly) {
      lines.push({
        class: "LIVE_DEALER_INVENTORY",
        text: `AION has ${nUsed} used/CPO vehicle(s) in current live-ish inventory.`,
      });
      pool = live.filter((v) => v.condition === "used" || v.condition === "cpo").slice(0, 25);
    } else {
      lines.push({
        class: "LIVE_DEALER_INVENTORY",
        text: `AION live-ish inventory: ${live.length} vehicle(s) (${nNew} new, ${nUsed} used/CPO). This is AION coverage, not a claim of complete dealer lot coverage.`,
      });
      pool = live.slice(0, 25);
    }
  }

  // Presence / temporal
  if (/\bno longer available|disappeared|gone from online|what disappeared\b/i.test(ql)) {
    // Not labeled sold — NO_LONGER_FOUND_ONLINE only.
    pool = pool.filter((v) => v.presenceStatus === "NO_LONGER_FOUND_ONLINE");
    lines.push({
      class: "INFERENCE",
      text: "These units are no longer found on the public dealer feed. That is not a sale confirmation.",
    });
  } else if (/\bsold\b/i.test(ql) && !/unsold/i.test(ql)) {
    pool = pool.filter((v) =>
      (v.statusHistory ?? []).some((s) => /sold/i.test(s.note || "")),
    );
    if (!pool.length) {
      lines.push({
        class: "INFERENCE",
        text: "AION does not mark units SOLD from a missing online listing alone. No stronger sale evidence is stored for that filter.",
      });
    }
  } else if (/\b(changed price|price change|what changed price)\b/i.test(ql)) {
    pool = pool
      .filter((v) => (v.priceHistory?.length ?? 0) >= 2)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .slice(0, 20);
  } else if (/\b(arrived recently|came in|new arrivals?|what came in)\b/i.test(ql)) {
    pool = pool
      .filter((v) =>
        v.presenceStatus === "ONLINE_LISTED" ||
        v.presenceStatus === "PHYSICALLY_VERIFIED" ||
        v.presenceStatus === "NOT_VERIFIED",
      )
      .sort((a, b) => String(b.createdAt || b.lastOnlineAt || "").localeCompare(String(a.createdAt || a.lastOnlineAt || "")))
      .slice(0, 15);
  } else if (/\brecently\b/i.test(ql)) {
    pool = pool
      .filter((v) => v.lastOnlineAt || v.createdAt)
      .sort((a, b) => String(b.lastOnlineAt || b.createdAt).localeCompare(String(a.lastOnlineAt || a.createdAt)))
      .slice(0, 12);
  } else {
    // Default: available-ish (not gone from public feed)
    pool = pool.filter((v) =>
      v.presenceStatus === "ONLINE_LISTED" ||
      v.presenceStatus === "PHYSICALLY_VERIFIED" ||
      v.presenceStatus === "NOT_VERIFIED",
    );
  }

  if (/\bhybrids?\b/i.test(ql)) {
    pool = pool.filter(
      (v) =>
        /hybrid|prius/i.test(`${v.model ?? ""} ${v.trim ?? ""}`) ||
        /hybrid|prius/i.test(JSON.stringify(v.listingObservations ?? []).slice(0, 400)),
    );
  }
  if (/\bsuvs?\b/i.test(ql)) {
    pool = pool.filter((v) =>
      /highlander|rav4|4runner|sequoia|venza|corolla cross|grand highlander|sienna|cx-5|bronco|venue|soul/i.test(
        `${v.model ?? ""}`,
      ),
    );
  }
  if (/\btrucks?\b/i.test(ql)) {
    pool = pool.filter((v) => /tacoma|tundra|frontier/i.test(v.model || ""));
  }
  if (/\bcamrys?\b/i.test(ql)) pool = queryVehicles(pool, { model: "Camry", nowIso: input.nowIso });
  if (/\bcorollas?\b/i.test(ql) && !/grand/i.test(ql)) pool = queryVehicles(pool, { model: "Corolla", nowIso: input.nowIso });
  if (/\btacomas?\b/i.test(ql)) pool = queryVehicles(pool, { model: "Tacoma", nowIso: input.nowIso });
  if (/\bhighlanders?\b/i.test(ql)) pool = queryVehicles(pool, { model: "Highlander", nowIso: input.nowIso });
  if (/\brav4s?\b/i.test(ql)) pool = queryVehicles(pool, { model: "RAV4", nowIso: input.nowIso });
  if (/\bprius\b/i.test(ql)) pool = queryVehicles(pool, { model: "Prius", nowIso: input.nowIso });

  const under = parseMaxPriceFromText(ql);
  if (under) {
    const max = under;
    if (Number.isFinite(max)) {
      pool = pool.filter((v) => {
        const p = latestPrice(v);
        return p != null && p <= max;
      });
    }
  }

  // VIN lookup
  const vinCand = q.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0];
  if (vinCand) {
    const norm = normalizeVinCandidate(vinCand);
    const v = input.vehicles.find((x) => x.vin === norm);
    const validation = validateVin(norm);
    lines.push({
      class: "GOVERNMENT_VIN_FACT",
      text: `VIN ${norm}: structure ${validation.code}${validation.valid ? " (check digit OK)" : ` — ${validation.message}`}. Decode/recalls are separate government sources when fetched.`,
      source: "vin.validate",
    });
    if (v) {
      lines.push({
        class: vehicleSourceClass(v),
        text: `In inventory: ${summarizeVehicle(v)}`,
        source: v.listingUrl || v.detailUrl || "vehicleInventory",
      });
      pool = [v];
    } else {
      lines.push({
        class: "INFERENCE",
        text: "No matching vehicle record in local inventory for this VIN. Run inventory.refresh, walk observe, or NHTSA decode.",
      });
      pool = [];
    }

    // A VIN question deserves the full grounded picture, grouped by where each fact came from.
    if (pool.length === 1) {
      lines.push(...vinDetailLines(pool[0]!, q));
    }
  }

  if (!pool.length && !lines.length) {
    lines.push({
      class: "INFERENCE",
      text: preferLive
        ? "No matching vehicles in current inventory for that filter. Unknown is preserved — try refresh inventory or broaden the query."
        : "Only fixture/demo vehicles are stored, or inventory is empty. Run a live public inventory refresh before treating counts as real.",
    });
  }

  const vehicles = pool.slice(0, 25).map((v) => ({
    vin: v.vin,
    year: v.year,
    make: v.make,
    model: v.model,
    trim: v.trim,
    price: latestPrice(v),
    presence: v.presenceStatus,
    stock: v.stockNumber,
    condition: v.condition,
    sourceClass: vehicleSourceClass(v),
    lastSeen: v.lastPhysicalAt || v.lastOnlineAt || v.updatedAt,
  }));

  for (const v of pool.slice(0, 12)) {
    const src = v.detailUrl || v.listingUrl;
    const line: VehicleAnswerLineV1 = {
      class: vehicleSourceClass(v),
      text: summarizeVehicle(v),
    };
    if (src) line.source = src;
    lines.push(line);
  }

  if (staleWarning) {
    lines.unshift({ class: "INFERENCE", text: staleWarning, source: "inventory.freshness" });
  }

  const reply = [
    "VEHICLE ANSWER",
    `Query: ${q.slice(0, 200)}`,
    "",
    ...lines.map((l) => `[${l.class}] ${l.text}`),
    "",
    "LIVE_DEALER_INVENTORY = public listing or physical walk. FIXTURE_DEMO is not real lot stock.",
    "GENERAL_MODEL_KNOWLEDGE is not this car's installed equipment.",
    "Online listing ≠ physically on lot unless PHYSICALLY_VERIFIED.",
  ].join("\n");

  return { query: q, lines, vehicles, reply, staleWarning };
}

/** Structured customer → vehicle match with evidence, conflicts, unknowns. */
export function matchCustomerToVehicles(input: {
  relationship: RelationshipV1;
  vehicles: readonly VehicleRecordV1[];
  nowIso: string;
  maxResults?: number;
}): CustomerVehicleMatchV1[] {
  const r = input.relationship;
  if (r.archived) return [];
  const blob = [
    r.displayName,
    r.notes,
    r.nextAction,
    ...(r.interests ?? []).map((i) => `${i.kind} ${i.description}`),
    ...(r.preferences ?? []).map((p) => (typeof p === "string" ? p : JSON.stringify(p))),
    ...(r.objections ?? []).map((o) => (typeof o === "string" ? o : JSON.stringify(o))),
  ]
    .join(" ")
    .toLowerCase();

  const max = input.maxResults ?? 5;
  const maxPrice = parseMaxPriceFromText(blob);
  const wants = {
    camry: /\bcamry\b/.test(blob),
    corolla: /\bcorolla\b/.test(blob) && !/cross/.test(blob),
    tacoma: /\btacoma\b|\btruck\b/.test(blob),
    suv: /\bsuv\b|highlander|rav4|4runner|sequoia|venza/.test(blob),
    hybrid: /\bhybrid\b|mpg|fuel\b/.test(blob),
    newOnly: /\bnew only\b|\bnew car\b|\bbrand new\b/.test(blob),
    usedOnly: /\bused only\b|\bpre-?owned\b/.test(blob),
  };

  const out: CustomerVehicleMatchV1[] = [];
  const pool = input.vehicles.filter(
    (v) =>
      !isFixtureVehicle(v) &&
      (v.presenceStatus === "ONLINE_LISTED" ||
        v.presenceStatus === "PHYSICALLY_VERIFIED" ||
        v.presenceStatus === "NOT_VERIFIED"),
  );
  // If only fixtures exist, still match but label FIXTURE_DEMO
  const usePool = pool.length ? pool : input.vehicles.filter((v) =>
    v.presenceStatus === "ONLINE_LISTED" || v.presenceStatus === "PHYSICALLY_VERIFIED",
  );

  for (const v of usePool) {
    const why: string[] = [];
    const conflicts: string[] = [];
    const unknown: string[] = [];
    let score = 0;
    const model = (v.model || "").toLowerCase();
    const price = latestPrice(v);

    if (wants.camry && /camry/.test(model)) {
      score += 40;
      why.push("Customer interest mentions Camry; unit model is Camry");
    }
    if (wants.corolla && /corolla/.test(model)) {
      score += 40;
      why.push("Customer interest mentions Corolla; unit model is Corolla");
    }
    if (wants.tacoma && /tacoma|tundra/.test(model)) {
      score += 40;
      why.push("Customer interest mentions truck/Tacoma; unit is a truck model");
    }
    if (wants.suv && /highlander|rav4|4runner|sequoia|venza|corolla cross/.test(model)) {
      score += 40;
      why.push("Customer interest mentions SUV; unit model is an SUV line");
    }
    if (wants.hybrid) {
      if (/hybrid/i.test(`${v.model} ${v.trim}`)) {
        score += 20;
        why.push("Hybrid preference aligns with model/trim text");
      } else {
        unknown.push("Hybrid preference stated but unit fuel/powertrain not confirmed on record");
      }
    }
    if (maxPrice != null) {
      if (price != null && price <= maxPrice) {
        score += 25;
        why.push(`Advertised price $${price} ≤ stated budget under $${maxPrice}`);
      } else if (price != null && price > maxPrice) {
        score -= 35;
        conflicts.push(`Advertised price $${price} exceeds stated budget under $${maxPrice}`);
      } else {
        unknown.push("Budget stated but vehicle price unknown on record — do not claim affordability");
      }
    }
    if (wants.newOnly && v.condition === "used") {
      conflicts.push("Customer signaled new-only; unit condition is used");
      score -= 40;
    }
    if (wants.usedOnly && v.condition === "new") {
      conflicts.push("Customer signaled used-only; unit condition is new");
      score -= 40;
    }
    if (!v.year) unknown.push("Year unknown");
    if (!v.trim) unknown.push("Trim unknown");
    if (price == null) unknown.push("Price unknown");
    if (v.presenceStatus !== "PHYSICALLY_VERIFIED") {
      unknown.push("Not PHYSICALLY_VERIFIED on lot — online listing only unless walked");
    }
    // Linked association is strongest
    if ((v.relationshipIds ?? []).includes(r.id)) {
      score += 50;
      why.push("Owner previously linked this vehicle to the customer");
    }

    if (score < 35 || why.length === 0) continue;
    out.push({
      relationshipId: r.id,
      customerName: r.displayName,
      vehicleId: v.id,
      vin: v.vin,
      label: [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || v.vin || v.id,
      whyMatches: why,
      knownConflicts: conflicts,
      unknown,
      sourceClass: vehicleSourceClass(v),
      score,
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}

export function formatCustomerMatches(matches: readonly CustomerVehicleMatchV1[]): string {
  if (!matches.length) {
    return "No grounded vehicle matches above threshold. Missing budget, model, or live inventory may be the cause — unknown preserved.";
  }
  return matches
    .map((m, i) => {
      return [
        `${i + 1}. ${m.label} (${m.sourceClass}) score=${m.score}`,
        `   WHY: ${m.whyMatches.join("; ")}`,
        m.knownConflicts.length ? `   CONFLICTS: ${m.knownConflicts.join("; ")}` : null,
        m.unknown.length ? `   UNKNOWN: ${m.unknown.join("; ")}` : null,
        m.vin ? `   VIN: ${m.vin}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

/**
 * Everything grounded about one specific vehicle, grouped by source.
 *
 * A salesperson standing in front of a customer needs to know which claims they can make and which
 * they cannot. Dealer listing, government decode and recall campaigns are shown as separate
 * groups; general trim knowledge is deliberately excluded here because this question is about *this
 * car*, and mixing the two is exactly how a generic feature becomes a promise.
 *
 * The unknowns list is derived from what this vehicle is actually missing, not a fixed checklist —
 * printing "installed packages: unknown" against every car trains people to ignore it.
 */
export function vinDetailLines(v: VehicleRecordV1, question = ""): VehicleAnswerLineV1[] {
  const q = String(question).toLowerCase();
  const wantsKnown = /\bknow for sure\b|\bwhat do we know\b|\bconfirmed\b/.test(q);
  const wantsUnknown = /\bunknown\b|\bwhat.s not\b|\bwhat is not\b|\bmissing\b/.test(q);
  const wantsRecall = /\brecall/.test(q);
  const wantsAll = !wantsKnown && !wantsUnknown && !wantsRecall;

  const lines: VehicleAnswerLineV1[] = [];
  const g = v.govVinFacts;
  const src = v.detailUrl || v.listingUrl || "vehicleInventory";

  if (wantsAll || wantsKnown) {
    const dealer: string[] = [];
    const price = latestPrice(v);
    if (v.year || v.make || v.model) dealer.push([v.year, v.make, v.model, v.trim].filter(Boolean).join(" "));
    if (v.condition) dealer.push(`condition listed as ${v.condition}`);
    if (price != null) dealer.push(`advertised $${price.toLocaleString()}`);
    if (v.stockNumber) dealer.push(`stock ${v.stockNumber}`);
    if (v.exteriorColor) dealer.push(`exterior ${v.exteriorColor}`);
    if (v.interiorColor) dealer.push(`interior ${v.interiorColor}`);
    if (v.mileage != null) dealer.push(`${v.mileage.toLocaleString()} miles`);
    dealer.push(`listing status ${v.presenceStatus}`);
    if (dealer.length) {
      lines.push({ class: vehicleSourceClass(v), text: `Dealer listing — ${dealer.join(" · ")}`, source: src });
    }

    if (g && g.status === "DECODED") {
      const gov = [
        g.bodyClass ? `body ${g.bodyClass}` : null,
        g.driveType ? `drive ${g.driveType}` : null,
        g.fuelType ? `fuel ${g.fuelType}` : null,
        g.electrification ? `electrification ${g.electrification}` : null,
        g.engineCylinders ? `${g.engineCylinders}-cyl` : null,
        g.displacementL ? `${g.displacementL}L` : null,
        g.engineConfiguration || null,
        g.transmission ? `transmission ${g.transmission}` : null,
        g.plantCountry ? `built ${[g.plantCity, g.plantCountry].filter(Boolean).join(", ")}` : null,
      ].filter(Boolean);
      if (gov.length) {
        lines.push({ class: "GOVERNMENT_VIN_FACT", text: `Government VIN decode — ${gov.join(" · ")}`, source: g.source });
      }
      for (const conflict of g.conflictsWithListing) {
        lines.push({ class: "GOVERNMENT_VIN_FACT", text: `Conflict to resolve — ${conflict}`, source: g.source });
      }
    } else if (g && g.status !== "NOT_CHECKED") {
      lines.push({ class: "INFERENCE", text: `Government VIN decode unavailable (${g.status}).`, source: g.source });
    }
  }

  if (wantsAll || wantsRecall) {
    lines.push({ class: "GOVERNMENT_VIN_FACT", text: describeRecallStatus(v.recallAssessment), source: v.recallAssessment?.source || "recall" });
  }

  if (wantsAll || wantsUnknown) {
    const unknown: string[] = [];
    if (latestPrice(v) == null) unknown.push("advertised price (never published on an observed listing)");
    if (!v.stockNumber) unknown.push("stock number");
    if (!v.exteriorColor) unknown.push("exterior colour");
    if (v.mileage == null) unknown.push("mileage");
    if (!g || g.status !== "DECODED") unknown.push("government VIN decode");
    unknown.push("installed packages and optional equipment — no source here establishes them");
    if (v.presenceStatus !== "PHYSICALLY_VERIFIED") unknown.push("physical presence on the lot (listing observed online only)");
    unknown.push("VIN-specific open-recall status");
    lines.push({ class: "INFERENCE", text: `Not established — ${unknown.join("; ")}.` });
  }

  return lines;
}
