/**
 * Lot Walk enrichment: physical photo observations joined to website inventory,
 * website price (never inventing MSRP as website price), and reverse customer match.
 *
 * Pure domain — no process I/O. Walk session/observation persistence lives in vehicle-inventory.
 */
import type {
  InventoryWalkV1,
  PhysicalObservationV1,
  VehiclePriceHistoryEntryV1,
  VehicleRecordV1,
  WalkReconciliationV1,
} from "./vehicle-inventory.js";
import type { CustomerNeedV1 } from "./customer-needs.js";
import { isCurrentNeed } from "./customer-needs.js";
import {
  fitVehicleToNeeds,
  matchVehicleToCustomers,
  type ReverseMatchV1,
} from "./customer-inventory-match.js";

export type LotWalkWebsiteListingStateV1 =
  | "ON_WEBSITE"
  | "NOT_FOUND_ON_WEBSITE"
  | "UNKNOWN";

export type LotWalkPriceStateV1 =
  | "PRICE_PUBLISHED"
  | "PRICE_NOT_PUBLISHED"
  | "PRICE_CHANGED_SINCE_LAST_OBSERVATION";

export type LotWalkTemporalStateV1 =
  | "SEEN_ON_LOT_TODAY"
  | "SEEN_ON_LOT_PREVIOUSLY"
  | "PHYSICALLY_OBSERVED";

export interface LotWalkWebsitePriceV1 {
  /** Dealer website advertised/dealer price only — never MSRP unless that is the published ask. */
  websitePrice: number | null;
  websitePriceObservedAt: string | null;
  /** Sticker/MSRP if known; labeled separately so it is never confused with website price. */
  stickerMsrp: number | null;
  priceState: LotWalkPriceStateV1;
  /** Prior published website price when a change was detected. */
  previousWebsitePrice: number | null;
  sourceLabel: "website_advertised" | "website_dealer" | "not_published";
}

export interface LotWalkCustomerMatchSummaryV1 {
  relationshipRef: string;
  customerName: string;
  matchScore: number;
  freshness: string;
  why: string;
  matchedOn: Array<{ attribute: string; value: string; observedAt: string }>;
}

export interface LotWalkListItemV1 {
  vin: string | null;
  observationId: string;
  walkId: string;
  vehicleId: string | null;
  observedAt: string;
  lastSeenAt: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  condition: string | null;
  exteriorColor: string | null;
  matchStatus: string;
  temporal: LotWalkTemporalStateV1;
  websiteListing: LotWalkWebsiteListingStateV1;
  website: LotWalkWebsitePriceV1;
  photoDocumentIds: string[];
  photoCount: number;
  customerMatches: LotWalkCustomerMatchSummaryV1[];
  notes: string;
  /** Owner-facing one-liner for phone UI. */
  summaryLine: string;
}

export interface LotWalkSessionViewV1 {
  sessionId: string;
  workspace: string;
  dealershipName: string;
  state: string;
  startedAt: string;
  endedAt: string | null;
  photoEvidenceCount: number;
  identifiedVehicleCount: number;
  unresolvedPhotoCount: number;
  duplicateVinCount: number;
  vehicles: LotWalkListItemV1[];
  reconciliation: WalkReconciliationV1 | null;
  caveat: string;
}

export interface LotWalkCallListEntryV1 {
  customerName: string;
  relationshipRef: string;
  vehicleLabel: string;
  vin: string | null;
  websitePrice: number | null;
  websitePriceLabel: string;
  matchScore: number;
  why: string[];
  unknowns: string[];
  conflicts: string[];
}

/** Newest website-published ask (advertised/dealer). Never promotes MSRP to website price. */
export function websitePriceFromVehicle(v: VehicleRecordV1 | null | undefined): LotWalkWebsitePriceV1 {
  if (!v) {
    return {
      websitePrice: null,
      websitePriceObservedAt: null,
      stickerMsrp: null,
      priceState: "PRICE_NOT_PUBLISHED",
      previousWebsitePrice: null,
      sourceLabel: "not_published",
    };
  }

  let stickerMsrp: number | null = null;
  const published: Array<{ price: number; at: string; source: "website_advertised" | "website_dealer" }> = [];

  for (const entry of v.priceHistory ?? []) {
    const e = entry as VehiclePriceHistoryEntryV1;
    if (e.msrp != null && e.msrp > 0 && stickerMsrp == null) stickerMsrp = e.msrp;
    if (e.advertisedPrice != null && e.advertisedPrice > 0) {
      published.push({ price: e.advertisedPrice, at: e.at, source: "website_advertised" });
    } else if (e.dealerPrice != null && e.dealerPrice > 0) {
      published.push({ price: e.dealerPrice, at: e.at, source: "website_dealer" });
    }
  }
  for (const listing of v.listingObservations ?? []) {
    if (listing.msrp != null && listing.msrp > 0 && stickerMsrp == null) stickerMsrp = listing.msrp;
    if (listing.advertisedPrice != null && listing.advertisedPrice > 0) {
      published.push({
        price: listing.advertisedPrice,
        at: listing.retrievedAt,
        source: "website_advertised",
      });
    } else if (listing.dealerPrice != null && listing.dealerPrice > 0) {
      published.push({
        price: listing.dealerPrice,
        at: listing.retrievedAt,
        source: "website_dealer",
      });
    }
  }

  if (!published.length) {
    return {
      websitePrice: null,
      websitePriceObservedAt: null,
      stickerMsrp,
      priceState: "PRICE_NOT_PUBLISHED",
      previousWebsitePrice: null,
      sourceLabel: "not_published",
    };
  }

  const latest = published[0]!;
  const previous = published.find((p) => p.price !== latest.price) ?? null;
  return {
    websitePrice: latest.price,
    websitePriceObservedAt: latest.at,
    stickerMsrp,
    priceState: previous ? "PRICE_CHANGED_SINCE_LAST_OBSERVATION" : "PRICE_PUBLISHED",
    previousWebsitePrice: previous?.price ?? null,
    sourceLabel: latest.source,
  };
}

export function formatWebsitePriceLabel(web: LotWalkWebsitePriceV1): string {
  if (web.websitePrice == null) return "Website price: not published";
  const money = `$${web.websitePrice.toLocaleString("en-US")}`;
  if (web.priceState === "PRICE_CHANGED_SINCE_LAST_OBSERVATION" && web.previousWebsitePrice != null) {
    return `Website price: ${money} (was $${web.previousWebsitePrice.toLocaleString("en-US")})`;
  }
  return `Website price: ${money}`;
}

function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

function vehicleLabel(v: VehicleRecordV1 | null): string {
  if (!v) return "Unknown vehicle";
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || v.vin || v.id;
}

export function enrichObservation(input: {
  observation: PhysicalObservationV1;
  vehicle: VehicleRecordV1 | null;
  allObservationsForVin: readonly PhysicalObservationV1[];
  now: string;
  customerMatches?: LotWalkCustomerMatchSummaryV1[];
}): LotWalkListItemV1 {
  const o = input.observation;
  const v = input.vehicle;
  const web = websitePriceFromVehicle(v);
  const today = dayKey(input.now);
  const lastSeen =
    input.allObservationsForVin
      .map((x) => x.observedAt)
      .sort()
      .reverse()[0] || o.observedAt;
  const seenToday = dayKey(lastSeen) === today;
  const temporal: LotWalkTemporalStateV1 = seenToday
    ? "SEEN_ON_LOT_TODAY"
    : "SEEN_ON_LOT_PREVIOUSLY";

  let websiteListing: LotWalkWebsiteListingStateV1 = "UNKNOWN";
  if (o.matchStatus === "SEEN_ON_LOT_NOT_ONLINE") websiteListing = "NOT_FOUND_ON_WEBSITE";
  else if (v && (v.lastOnlineAt || (v.listingObservations?.length ?? 0) > 0 || web.websitePrice != null)) {
    websiteListing = "ON_WEBSITE";
  } else if (o.matchStatus === "VERIFIED_ON_LOT" || o.matchStatus === "DUPLICATE_OBSERVATION") {
    websiteListing = v?.lastOnlineAt || v?.listingUrl ? "ON_WEBSITE" : "NOT_FOUND_ON_WEBSITE";
  } else if (o.matchStatus === "PHOTO_REVIEW_REQUIRED" || !o.vin) {
    websiteListing = "UNKNOWN";
  }

  const photoIds = [...new Set(o.photoDocumentIds ?? [])];
  const matches = input.customerMatches ?? [];
  const label = vehicleLabel(v);
  const priceBit = formatWebsitePriceLabel(web);
  const matchBit =
    matches.length === 0
      ? "No customer matches."
      : `${matches.length} customer match${matches.length === 1 ? "" : "es"}.`;
  const listingBit =
    websiteListing === "NOT_FOUND_ON_WEBSITE"
      ? "Not found on current website inventory (not labeled sold)."
      : websiteListing === "ON_WEBSITE"
        ? "On current website inventory."
        : "Website listing unknown.";

  return {
    vin: o.vin,
    observationId: o.id,
    walkId: o.walkId,
    vehicleId: v?.id ?? o.vehicleId,
    observedAt: o.observedAt,
    lastSeenAt: lastSeen,
    year: v?.year ?? null,
    make: v?.make ?? null,
    model: v?.model ?? null,
    trim: v?.trim ?? null,
    condition: v?.condition ?? null,
    exteriorColor: v?.exteriorColor ?? null,
    matchStatus: o.matchStatus,
    temporal,
    websiteListing,
    website: web,
    photoDocumentIds: photoIds,
    photoCount: photoIds.length || (o.entryMethod === "photo" ? 1 : 0),
    customerMatches: matches,
    notes: o.note || "",
    summaryLine: [
      label,
      o.vin ? `VIN ${o.vin}` : "VIN unresolved",
      priceBit,
      listingBit,
      matchBit,
    ].join(" · "),
  };
}

/** Collapse same-VIN observations in one walk into one list item (multi-photo evidence). */
export function buildLotWalkList(input: {
  walk: InventoryWalkV1;
  observations: readonly PhysicalObservationV1[];
  vehicles: readonly VehicleRecordV1[];
  now: string;
  needsByCustomer?: ReadonlyMap<string, { name: string; needs: readonly CustomerNeedV1[] }>;
  reconciliation?: WalkReconciliationV1 | null;
  workspace?: string;
}): LotWalkSessionViewV1 {
  const walkObs = input.observations.filter((o) => o.walkId === input.walk.id);
  const byVin = new Map<string, PhysicalObservationV1[]>();
  const unresolved: PhysicalObservationV1[] = [];

  for (const o of walkObs) {
    if (o.vin && o.matchStatus !== "PHOTO_REVIEW_REQUIRED") {
      const list = byVin.get(o.vin) ?? [];
      list.push(o);
      byVin.set(o.vin, list);
    } else {
      unresolved.push(o);
    }
  }

  const vehicles: LotWalkListItemV1[] = [];
  for (const [vin, obsList] of byVin) {
    const sorted = [...obsList].sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1));
    const primary = sorted[0]!;
    const vehicle =
      input.vehicles.find((v) => v.id === primary.vehicleId) ||
      input.vehicles.find((v) => v.vin === vin) ||
      null;
    const photoIds = [...new Set(sorted.flatMap((o) => o.photoDocumentIds ?? []))];
    const merged: PhysicalObservationV1 = {
      ...primary,
      photoDocumentIds: photoIds,
      note: sorted.map((o) => o.note).filter(Boolean).join(" · ").slice(0, 2000),
    };

    let customerMatches: LotWalkCustomerMatchSummaryV1[] = [];
    if (vehicle && input.needsByCustomer && input.needsByCustomer.size) {
      const reverse = matchVehicleToCustomers({
        vehicle,
        needsByCustomer: input.needsByCustomer,
        now: input.now,
        limit: 5,
        minConfidence: 50,
      });
      customerMatches = reverse.map((r: ReverseMatchV1) => ({
        relationshipRef: r.relationshipRef,
        customerName: r.customerName,
        matchScore: r.matchScore,
        freshness: r.freshness,
        why: r.why,
        matchedOn: r.matchedOn,
      }));
    }

    const allForVin = input.observations.filter((o) => o.vin === vin);
    const item = enrichObservation({
      observation: merged,
      vehicle,
      allObservationsForVin: allForVin,
      now: input.now,
      customerMatches,
    });
    item.photoCount = Math.max(item.photoCount, photoIds.length, sorted.length);
    vehicles.push(item);
  }

  for (const o of unresolved) {
    vehicles.push(
      enrichObservation({
        observation: o,
        vehicle: null,
        allObservationsForVin: [o],
        now: input.now,
        customerMatches: [],
      }),
    );
  }

  vehicles.sort((a, b) => (a.observedAt < b.observedAt ? 1 : -1));

  const photoEvidenceCount = walkObs.reduce(
    (n, o) => n + Math.max(o.photoDocumentIds?.length ?? 0, o.entryMethod === "photo" ? 1 : 0),
    0,
  );
  const identifiedVehicleCount = vehicles.filter((v) => v.vin && v.matchStatus !== "PHOTO_REVIEW_REQUIRED").length;
  const unresolvedPhotoCount = vehicles.filter(
    (v) => !v.vin || v.matchStatus === "PHOTO_REVIEW_REQUIRED",
  ).length;
  const duplicateVinCount = [...byVin.values()].filter((list) => list.length > 1).length;

  return {
    sessionId: input.walk.id,
    workspace: input.workspace ?? "work",
    dealershipName: input.walk.dealershipName,
    state: input.walk.state,
    startedAt: input.walk.startedAt,
    endedAt: input.walk.endedAt,
    photoEvidenceCount,
    identifiedVehicleCount,
    unresolvedPhotoCount,
    duplicateVinCount,
    vehicles,
    reconciliation: input.reconciliation ?? null,
    caveat:
      "Website inventory not photographed during this walk means only that — not that the vehicle is missing from the lot. NOT_FOUND_ON_WEBSITE is never labeled sold without authoritative proof.",
  };
}

/** Rank customers to call from today's photographed vehicles. */
export function buildLotWalkCallList(input: {
  items: readonly LotWalkListItemV1[];
  vehicles: readonly VehicleRecordV1[];
  needsByCustomer: ReadonlyMap<string, { name: string; needs: readonly CustomerNeedV1[] }>;
  limit?: number;
}): LotWalkCallListEntryV1[] {
  const out: LotWalkCallListEntryV1[] = [];
  for (const item of input.items) {
    if (!item.vin || item.matchStatus === "PHOTO_REVIEW_REQUIRED") continue;
    const vehicle =
      input.vehicles.find((v) => v.id === item.vehicleId) ||
      input.vehicles.find((v) => v.vin === item.vin) ||
      null;
    if (!vehicle) continue;
    for (const [relationshipRef, entry] of input.needsByCustomer) {
      const needs = entry.needs.filter((n) => isCurrentNeed(n));
      if (!needs.length) continue;
      const fit = fitVehicleToNeeds({ vehicle, needs });
      if (fit.disqualified) continue;
      if (!fit.hardRequirementsMet.length && !fit.preferencesMet.length) continue;
      out.push({
        customerName: entry.name,
        relationshipRef,
        vehicleLabel: vehicleLabel(vehicle),
        vin: vehicle.vin,
        websitePrice: item.website.websitePrice,
        websitePriceLabel: formatWebsitePriceLabel(item.website),
        matchScore: fit.matchScore,
        why: fit.why,
        unknowns: fit.unknowns.map((u) => `${u.attribute}: not stated on listing`),
        conflicts: fit.conflicts.map((c) => `${c.attribute}: wanted ${c.wanted}, found ${c.found}`),
      });
    }
  }
  out.sort((a, b) => b.matchScore - a.matchScore);
  return out.slice(0, input.limit ?? 20);
}

/** Owner-facing phone reply after a successful (or unresolved) lot photo. */
export function formatLotWalkPhotoReply(input: {
  item: LotWalkListItemV1 | null;
  ocrStatus: string;
  ocrMessage?: string;
  vin: string | null;
  duplicate: boolean;
}): string {
  if (!input.item || !input.vin) {
    return [
      "I saved the photo, but I could not extract a reliable VIN from this image.",
      input.ocrMessage || "Try a closer shot of the VIN line, or type the VIN.",
      "This observation stays unresolved — I will not guess the vehicle from appearance.",
    ].join("\n");
  }
  const i = input.item;
  const label = [i.year, i.make, i.model, i.trim].filter(Boolean).join(" ") || "Vehicle";
  const lines = [
    input.duplicate
      ? `Already on this walk — added another photo for ${label}.`
      : `Got it — ${label}.`,
    i.vin ? `VIN ${i.vin}.` : "",
    formatWebsitePriceLabel(i.website) + ".",
    i.websiteListing === "NOT_FOUND_ON_WEBSITE"
      ? "Physically observed; not found on current website inventory (not labeled sold)."
      : i.websiteListing === "ON_WEBSITE"
        ? "Matched current website inventory."
        : "",
    `Seen on lot at ${formatTime(i.observedAt)}.`,
    i.customerMatches.length
      ? `${i.customerMatches.length} customer match${i.customerMatches.length === 1 ? "" : "es"}: ${i.customerMatches
          .slice(0, 3)
          .map((m) => m.customerName)
          .join(", ")}.`
      : "No grounded customer matches yet.",
    i.website.stickerMsrp != null
      ? `Sticker MSRP (separate from website price): $${i.website.stickerMsrp.toLocaleString("en-US")}.`
      : "",
  ].filter(Boolean);
  return lines.join("\n");
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return iso;
  }
}

export function formatLotWalkSessionProse(view: LotWalkSessionViewV1): string {
  const lines = [
    `Lot walk at ${view.dealershipName} (${view.state}).`,
    `Started ${view.startedAt.slice(0, 16).replace("T", " ")} UTC.`,
    `Identified vehicles: ${view.identifiedVehicleCount}. Unresolved photos: ${view.unresolvedPhotoCount}. Duplicate VIN photo groups: ${view.duplicateVinCount}.`,
    "",
  ];
  if (!view.vehicles.length) {
    lines.push("No observations yet. Photograph a window sticker or VIN plate to begin.");
    return lines.join("\n");
  }
  for (const v of view.vehicles.slice(0, 40)) {
    const label = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || "Unresolved";
    lines.push(
      `• ${label}${v.vin ? ` · ${v.vin}` : ""} · ${formatWebsitePriceLabel(v.website)} · photos ${v.photoCount} · ${v.websiteListing === "NOT_FOUND_ON_WEBSITE" ? "not on website" : v.websiteListing === "ON_WEBSITE" ? "on website" : "listing unknown"} · matches ${v.customerMatches.length}`,
    );
  }
  if (view.reconciliation) {
    lines.push("");
    lines.push(
      `Reconciliation: ${view.reconciliation.physicallyObservedCount} observed · ${view.reconciliation.matchedCount} matched online · ${view.reconciliation.seenButNotOnline.length} photographed but not on website · ${view.reconciliation.onlineButNotSeen.length} on website not photographed this walk.`,
    );
    lines.push(view.caveat);
  }
  return lines.join("\n");
}

export function formatLotWalkCallListProse(entries: readonly LotWalkCallListEntryV1[]): string {
  if (!entries.length) {
    return "No grounded customer matches for photographed vehicles on this walk. Matching uses current needs only — no invented advice.";
  }
  const lines = ["Who to call from this lot walk (grounded matches only):", ""];
  for (const e of entries.slice(0, 15)) {
    lines.push(`${e.customerName}`);
    lines.push(`  ${e.vehicleLabel}${e.vin ? ` · ${e.vin}` : ""}`);
    lines.push(`  ${e.websitePriceLabel}`);
    lines.push(`  Fit score ${e.matchScore}`);
    if (e.why.length) lines.push(`  Why: ${e.why.slice(0, 4).join("; ")}`);
    if (e.unknowns.length) lines.push(`  Unknown on listing: ${e.unknowns.slice(0, 4).join("; ")}`);
    if (e.conflicts.length) lines.push(`  Conflicts: ${e.conflicts.slice(0, 3).join("; ")}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

/** Build needsByCustomer map from workspace-scoped relationship needs. */
export function needsByCustomerFromState(input: {
  relationships: readonly { id: string; displayName: string; workspace?: string }[];
  needs: readonly CustomerNeedV1[];
  workspace: string;
}): Map<string, { name: string; needs: CustomerNeedV1[] }> {
  const map = new Map<string, { name: string; needs: CustomerNeedV1[] }>();
  for (const r of input.relationships) {
    if (r.workspace && r.workspace !== input.workspace) continue;
    const needs = input.needs.filter(
      (n) => n.relationshipRef === r.id && n.workspace === input.workspace && isCurrentNeed(n),
    );
    if (needs.length) map.set(r.id, { name: r.displayName, needs: [...needs] });
  }
  return map;
}
