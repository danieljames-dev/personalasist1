/**
 * Broader vehicle research helpers (recalls, talking points, comparisons).
 * Prefer government/manufacturer-shaped public APIs. Never invent specs.
 */
import type { IsoTimestamp, ProvenanceV1 } from "./contracts.js";
import {
  REFUSING_OUTWARD_TRANSPORT_V1,
  isOutwardRefusalV1,
  type OutwardTransportPortV1,
} from "./outward-transport.js";
import type { VehicleRecordV1, VinDecodeResultV1 } from "./vehicle-inventory.js";

export type VehicleResearchSourceTypeV1 =
  | "nhtsa-recall"
  | "nhtsa-vpic"
  | "dealer-listing"
  | "physical-observation"
  | "manufacturer"
  | "epa"
  | "third-party"
  | "aion-inference"
  | "owner";

export interface VehicleResearchFindingV1 {
  statement: string;
  sourceType: VehicleResearchSourceTypeV1;
  sourceRef: string;
  confidence: number;
  caveat: string;
}

export interface RecallLookupResultV1 {
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  recalls: Array<{
    campaignNumber: string;
    component: string;
    summary: string;
    consequence: string;
    remedy: string;
    reportReceivedDate: string;
  }>;
  provenance: ProvenanceV1;
  message: string;
  mode: "live" | "empty" | "error";
}

export function parseNhtsaRecallPayload(payload: unknown): RecallLookupResultV1["recalls"] {
  const results = (payload as { results?: Array<Record<string, unknown>> })?.results
    ?? (payload as { Results?: Array<Record<string, unknown>> })?.Results
    ?? [];
  if (!Array.isArray(results)) return [];
  return results.slice(0, 40).map((r) => ({
    campaignNumber: String(r.NHTSACampaignNumber ?? r.CampaignNumber ?? "").slice(0, 40),
    component: String(r.Component ?? "").slice(0, 200),
    summary: String(r.Summary ?? "").slice(0, 2000),
    consequence: String(r.Conequence ?? r.Consequence ?? "").slice(0, 2000),
    remedy: String(r.Remedy ?? "").slice(0, 2000),
    reportReceivedDate: String(r.ReportReceivedDate ?? r.ReportReceivedDate ?? "").slice(0, 40),
  })).filter((r) => r.campaignNumber || r.summary);
}

export async function lookupRecallsNhtsa(input: {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  now: IsoTimestamp;
  /** Approved outward transport. Absent means the lookup refuses rather than reaching NHTSA. */
  outward?: OutwardTransportPortV1;
}): Promise<RecallLookupResultV1> {
  const make = (input.make || "").trim();
  const model = (input.model || "").trim();
  const year = input.year ?? null;
  const empty: RecallLookupResultV1 = {
    vin: null,
    make: make || null,
    model: model || null,
    year,
    recalls: [],
    provenance: {
      sourceType: "system",
      sourceRef: "https://api.nhtsa.gov/recalls/recallsByVehicle",
      recordedAt: input.now,
    },
    message: "Make, model, and model year are required for NHTSA recall lookup.",
    mode: "empty",
  };
  if (!make || !model || !year) return empty;

  const url =
    `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}` +
    `&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(String(year))}`;
  const outward = input.outward ?? REFUSING_OUTWARD_TRANSPORT_V1;
  try {
    const res = await outward.request("vehicle.recalls", url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return {
        ...empty,
        message: `NHTSA recall HTTP ${res.status}`,
        mode: "error",
      };
    }
    const json = await res.json();
    const recalls = parseNhtsaRecallPayload(json);
    return {
      vin: null,
      make,
      model,
      year,
      recalls,
      provenance: empty.provenance,
      message: recalls.length
        ? `NHTSA public recall data: ${recalls.length} campaign(s) for ${year} ${make} ${model}. Not a substitute for VIN-specific dealer check.`
        : `No NHTSA recall campaigns returned for ${year} ${make} ${model} (or API empty). Still verify with manufacturer/dealer for this VIN.`,
      mode: recalls.length ? "live" : "empty",
    };
  } catch (err) {
    /*
     * A refusal and a network failure both land here, and they mean opposite things: one is the
     * boundary working, the other is NHTSA being unreachable. Say which, so an Owner reading the
     * message is not told the government API is down when nothing was ever sent.
     */
    return {
      ...empty,
      message: isOutwardRefusalV1(err)
        ? `NHTSA recall lookup is not authorized to leave this machine: ${err instanceof Error ? err.message : String(err)}`
        : err instanceof Error ? err.message : String(err),
      mode: "error",
    };
  }
}

export function compareTwoVehicles(
  a: VehicleRecordV1,
  b: VehicleRecordV1,
): VehicleResearchFindingV1[] {
  const findings: VehicleResearchFindingV1[] = [];
  const label = (v: VehicleRecordV1) =>
    [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ") || v.vin || v.id;

  findings.push({
    statement: `A: ${label(a)} · VIN ${a.vin ?? "?"} · stock ${a.stockNumber ?? "?"} · ${a.presenceStatus}`,
    sourceType: a.lastPhysicalAt ? "physical-observation" : "dealer-listing",
    sourceRef: a.listingUrl || "aion.vehicle",
    confidence: 90,
    caveat: "From stored inventory/walk records only.",
  });
  findings.push({
    statement: `B: ${label(b)} · VIN ${b.vin ?? "?"} · stock ${b.stockNumber ?? "?"} · ${b.presenceStatus}`,
    sourceType: b.lastPhysicalAt ? "physical-observation" : "dealer-listing",
    sourceRef: b.listingUrl || "aion.vehicle",
    confidence: 90,
    caveat: "From stored inventory/walk records only.",
  });

  if (a.trim && b.trim && a.trim !== b.trim) {
    findings.push({
      statement: `Trim differs: ${a.trim} vs ${b.trim}. Confirm feature packages from manufacturer data before promising equipment.`,
      sourceType: "dealer-listing",
      sourceRef: "listing.trim",
      confidence: 70,
      caveat: "Trim string from listing/decode — not a full option list.",
    });
  }
  const pa = a.priceHistory[0]?.advertisedPrice;
  const pb = b.priceHistory[0]?.advertisedPrice;
  if (pa != null && pb != null) {
    findings.push({
      statement: `Advertised price: A $${pa} vs B $${pb} (delta $${pa - pb}).`,
      sourceType: "dealer-listing",
      sourceRef: "priceHistory",
      confidence: 85,
      caveat: "Advertised price may change; verify live listing.",
    });
  }
  if (a.mileage != null && b.mileage != null) {
    findings.push({
      statement: `Mileage: A ${a.mileage} vs B ${b.mileage}.`,
      sourceType: "dealer-listing",
      sourceRef: "mileage",
      confidence: 80,
      caveat: "From listing observation when provided.",
    });
  }
  if (a.condition && b.condition && a.condition !== b.condition) {
    findings.push({
      statement: `Condition: A ${a.condition} vs B ${b.condition}.`,
      sourceType: "dealer-listing",
      sourceRef: "condition",
      confidence: 80,
      caveat: "",
    });
  }
  return findings;
}

export function buildVehicleTalkingPoints(input: {
  vehicle: VehicleRecordV1;
  decode?: VinDecodeResultV1 | null;
  recalls?: RecallLookupResultV1 | null;
  customerName?: string | null;
}): { facts: VehicleResearchFindingV1[]; draftTips: string[] } {
  const v = input.vehicle;
  const facts: VehicleResearchFindingV1[] = [];
  const ymm = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
  facts.push({
    statement: `Unit: ${ymm || "vehicle"} · VIN ${v.vin ?? "unknown"} · stock ${v.stockNumber ?? "n/a"}`,
    sourceType: v.lastPhysicalAt ? "physical-observation" : "dealer-listing",
    sourceRef: v.detailUrl || v.listingUrl || "aion.vehicle",
    confidence: 90,
    caveat: "",
  });
  facts.push({
    statement: `Inventory status: ${v.presenceStatus}` +
      (v.lastPhysicalAt ? ` · last physical verify ${v.lastPhysicalAt}` : " · not physically verified in AION") +
      (v.lastOnlineAt ? ` · last online ${v.lastOnlineAt}` : ""),
    sourceType: v.presenceStatus === "PHYSICALLY_VERIFIED" ? "physical-observation" : "dealer-listing",
    sourceRef: "aion.presence",
    confidence: 88,
    caveat: "Online listing is not proof the car is on the lot.",
  });
  if (v.priceHistory[0]) {
    const p = v.priceHistory[0];
    facts.push({
      statement: `Advertised price history latest: $${p.advertisedPrice ?? "?"} (MSRP $${p.msrp ?? "?"}) at ${p.at}`,
      sourceType: "dealer-listing",
      sourceRef: p.sourceUrl,
      confidence: 85,
      caveat: "Confirm current price on dealer site or desk.",
    });
  }
  if (input.decode?.make) {
    facts.push({
      statement: `VIN decode (${input.decode.source}): ${[input.decode.year, input.decode.make, input.decode.model, input.decode.trim].filter(Boolean).join(" ")}`,
      sourceType: "nhtsa-vpic",
      sourceRef: input.decode.provenance.sourceRef,
      confidence: 90,
      caveat: "Government decode attributes; options packages may not appear.",
    });
  }
  if (input.recalls) {
    facts.push({
      statement: input.recalls.recalls.length
        ? `NHTSA campaigns listed for YMM: ${input.recalls.recalls.length}. Review before delivery.`
        : input.recalls.message,
      sourceType: "nhtsa-recall",
      sourceRef: input.recalls.provenance.sourceRef,
      confidence: input.recalls.mode === "live" ? 80 : 40,
      caveat: "YMM-level recall search is not a full VIN-level campaign check.",
    });
  }

  const draftTips = [
    `Lead with verified facts only: ${ymm || "this unit"}, stock ${v.stockNumber ?? "n/a"}.`,
    v.presenceStatus === "PHYSICALLY_VERIFIED"
      ? "You have a physical walk observation for this VIN — stronger on-lot evidence than web alone."
      : "This unit is online-listed in AION but not physically verified — walk the car before promising availability.",
    "Do not invent features (panoramic roof, hybrid, packages) unless listing/decode/owner note states them.",
    input.customerName
      ? `Sales draft only: ask ${input.customerName} what matters most (payment, features, timeline) before pitching.`
      : "Sales draft only: ask what matters most before pitching.",
    "Any follow-up email is a draft until the Owner reviews — AION does not send.",
  ];
  return { facts, draftTips };
}

export function formatResearchReply(findings: VehicleResearchFindingV1[], title: string): string {
  const lines = [title, ""];
  for (const f of findings) {
    lines.push(`• ${f.statement}`);
    lines.push(`  [${f.sourceType}] ${f.sourceRef}${f.caveat ? ` — ${f.caveat}` : ""}`);
  }
  lines.push("", "AION does not invent missing manufacturer options or safety claims.");
  return lines.join("\n");
}
