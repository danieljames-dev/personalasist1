/**
 * Recall intelligence with honest source semantics.
 *
 * The endpoint AION can reach — NHTSA `recallsByVehicle` — answers "which recall campaigns exist
 * for this year/make/model?". It does *not* answer "does this particular VIN have an open recall?".
 * Those are different questions, and blurring them is how a salesperson ends up telling a customer
 * a car is clear when nobody checked that car.
 *
 * So every stored result carries its scope, and the phrasing helpers refuse to produce a
 * VIN-specific clean bill of health. "No matching recall records were returned for this
 * year/make/model as of <time>" is true; "this VIN has no recalls" is not something this source
 * can support.
 */
import type { IsoTimestamp } from "./contracts.js";

export type RecallCheckStatusV1 =
  | "NOT_CHECKED"
  | "LOOKUP_COMPLETE"
  | "RECALLS_FOUND"
  | "NO_MATCHING_RECORDS_RETURNED"
  | "LOOKUP_FAILED"
  | "UNKNOWN";

/** What the checked source actually resolves. Recorded so claims stay inside it. */
export type RecallScopeV1 = "YEAR_MAKE_MODEL_CAMPAIGN" | "VIN_SPECIFIC" | "UNKNOWN";

export const RECALL_SOURCE_LIMITATION =
  "Source returns recall campaigns for a year/make/model. It does not confirm whether this "
  + "specific VIN is affected or whether any remedy was already performed. Confirm VIN-specific "
  + "open-recall status with Toyota/NHTSA by VIN before telling a customer a vehicle is clear.";

export interface RecallCampaignV1 {
  campaignNumber: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  reportReceivedDate: string;
}

export interface VehicleRecallAssessmentV1 {
  status: RecallCheckStatusV1;
  scope: RecallScopeV1;
  checkedAt: IsoTimestamp | null;
  source: string;
  /** The exact question asked, so a stale answer can be recognised later. */
  query: { year: string | null; make: string | null; model: string | null };
  campaignCount: number;
  campaigns: RecallCampaignV1[];
  sourceLimitation: string;
  /** Owner-facing sentence, always within what the source supports. */
  statement: string;
}

export function notCheckedRecallAssessment(): VehicleRecallAssessmentV1 {
  return {
    status: "NOT_CHECKED",
    scope: "UNKNOWN",
    checkedAt: null,
    source: "",
    query: { year: null, make: null, model: null },
    campaignCount: 0,
    campaigns: [],
    sourceLimitation: RECALL_SOURCE_LIMITATION,
    statement: "Recalls have not been checked for this vehicle.",
  };
}

/**
 * Turn a campaign lookup into a stored assessment.
 *
 * `ok === false` means the lookup itself failed — which is emphatically not the same as finding
 * nothing, and must never render as reassurance.
 */
export function buildRecallAssessment(input: {
  ok: boolean;
  campaigns: readonly RecallCampaignV1[];
  query: { year: string | null; make: string | null; model: string | null };
  now: IsoTimestamp;
  source: string;
}): VehicleRecallAssessmentV1 {
  const label = [input.query.year, input.query.make, input.query.model].filter(Boolean).join(" ") || "this vehicle";
  const when = input.now.slice(0, 16).replace("T", " ");

  if (!input.ok) {
    return {
      status: "LOOKUP_FAILED",
      scope: "YEAR_MAKE_MODEL_CAMPAIGN",
      checkedAt: input.now,
      source: input.source,
      query: input.query,
      campaignCount: 0,
      campaigns: [],
      sourceLimitation: RECALL_SOURCE_LIMITATION,
      statement: `Recall lookup failed for ${label} at ${when}. Recall status is unknown — this is not evidence that the vehicle is clear.`,
    };
  }

  if (input.campaigns.length === 0) {
    return {
      status: "NO_MATCHING_RECORDS_RETURNED",
      scope: "YEAR_MAKE_MODEL_CAMPAIGN",
      checkedAt: input.now,
      source: input.source,
      query: input.query,
      campaignCount: 0,
      campaigns: [],
      sourceLimitation: RECALL_SOURCE_LIMITATION,
      statement: `No matching recall records were returned for ${label} by the checked source as of ${when}. This does not confirm the specific VIN is free of open recalls.`,
    };
  }

  const campaigns = input.campaigns.slice(0, 25).map((c) => ({ ...c }));
  const components = [...new Set(campaigns.map((c) => c.component).filter(Boolean))].slice(0, 5);
  return {
    status: "RECALLS_FOUND",
    scope: "YEAR_MAKE_MODEL_CAMPAIGN",
    checkedAt: input.now,
    source: input.source,
    query: input.query,
    campaignCount: campaigns.length,
    campaigns,
    sourceLimitation: RECALL_SOURCE_LIMITATION,
    statement:
      `${campaigns.length} recall campaign(s) exist for ${label} as of ${when}`
      + (components.length ? ` (components: ${components.join(", ")})` : "")
      + `. Whether this specific VIN is affected — or already remedied — must be confirmed by VIN.`,
  };
}

/** Cache key: identical year/make/model resolves to one lookup, not one per vehicle. */
export function recallComboKey(year: string | null, make: string | null, model: string | null): string | null {
  const y = String(year ?? "").trim();
  const mk = String(make ?? "").trim().toUpperCase();
  const md = String(model ?? "").trim().toUpperCase();
  if (!y || !mk || !md) return null;
  return `${y}|${mk}|${md}`;
}

/**
 * Owner-facing answer for "does this vehicle have recalls?".
 *
 * Deliberately never emits a bare "no recalls" — the strongest negative this source supports is
 * "no matching records were returned", and the caveat travels with it.
 */
export function describeRecallStatus(assessment: VehicleRecallAssessmentV1 | null | undefined): string {
  if (!assessment || assessment.status === "NOT_CHECKED") {
    return "Recalls have not been checked for this vehicle yet.";
  }
  const lines = [assessment.statement];
  if (assessment.status === "RECALLS_FOUND") {
    for (const c of assessment.campaigns.slice(0, 5)) {
      lines.push(`  • ${c.campaignNumber || "(no campaign number)"} — ${c.component || "component unstated"}`);
    }
  }
  lines.push(`  Source scope: ${assessment.scope}. ${assessment.sourceLimitation}`);
  return lines.join("\n");
}
