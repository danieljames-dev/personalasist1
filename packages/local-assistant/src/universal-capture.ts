/**
 * Universal Capture — classify free text/voice into structured Owner actions.
 * Prefer confirmation only when ambiguity materially matters.
 */
import type { IsoTimestamp } from "./contracts.js";

export type CaptureKindV1 =
  | "note"
  | "follow_up"
  | "task"
  | "customer_update"
  | "vehicle_interest"
  | "brand_note"
  | "idea"
  | "preference"
  | "memory"
  | "unknown";

export interface CaptureClassificationV1 {
  kind: CaptureKindV1;
  confidence: "high" | "medium" | "low";
  workspaceHint: "work" | "personal" | "business" | null;
  personName: string | null;
  vehicleHint: string | null;
  budgetHint: string | null;
  followUpWhen: string | null;
  summary: string;
  proposedActions: string[];
  needsConfirm: boolean;
  why: string;
}

export function classifyCaptureText(text: string, nowIso: IsoTimestamp): CaptureClassificationV1 {
  const raw = String(text ?? "").trim();
  const lower = raw.toLowerCase();
  const person =
    raw.match(/\b(?:talked to|spoke with|met with|call(?:ed)?|follow up with|customer)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)?.[1] ||
    raw.match(/\b([A-Z][a-z]+)\s+(?:wants|likes|needs|said|is interested)/i)?.[1] ||
    null;
  const vehicle =
    raw.match(
      /\b(white|black|red|blue|silver|gray|grey)?\s*(camry|tacoma|highlander|rav4|corolla|tundra|4runner|sienna|limited|xle|sr5|trd)\b/i,
    )?.[0] || null;
  const budget =
    raw.match(/(?:under|below|max(?:imum)?)\s*\$?\s*([\d,]+(?:k)?)/i)?.[0] ||
    raw.match(/\$\s*([\d,]+)/)?.[0] ||
    null;
  const follow =
    /\btomorrow\b/i.test(raw)
      ? "tomorrow"
      : /\btoday\b/i.test(raw)
        ? "today"
        : /\bnext week\b/i.test(raw)
          ? "next week"
          : /\bfollow[- ]?up\b/i.test(raw)
            ? "unspecified"
            : null;

  if (/\bidea\b|\boffer inventory-walk|\bproduct concept\b/i.test(raw)) {
    return {
      kind: "idea",
      confidence: "high",
      workspaceHint: "personal",
      personName: person,
      vehicleHint: vehicle,
      budgetHint: budget,
      followUpWhen: follow,
      summary: raw.slice(0, 500),
      proposedActions: ["Store as Owner idea / product note", "Optional: open project later"],
      needsConfirm: false,
      why: "Idea language detected.",
    };
  }

  if (/\bcaleb\b|\bbrand\b|\bpost\b|\bcontent\b|\binstagram\b|\bmetricool\b/i.test(raw)) {
    return {
      kind: "brand_note",
      confidence: "medium",
      workspaceHint: "business",
      personName: person || (/\bcaleb\b/i.test(raw) ? "Caleb" : null),
      vehicleHint: null,
      budgetHint: null,
      followUpWhen: follow,
      summary: raw.slice(0, 500),
      proposedActions: ["Brand note in active brand workspace", "Do not invent collaborator roles"],
      needsConfirm: true,
      why: "Brand/content language — confirm which brand workspace.",
    };
  }

  if (person && (vehicle || /\binterested\b|\bwants the\b|\blikes the\b/i.test(raw))) {
    return {
      kind: "vehicle_interest",
      confidence: "high",
      workspaceHint: "work",
      personName: person,
      vehicleHint: vehicle,
      budgetHint: budget,
      followUpWhen: follow,
      summary: raw.slice(0, 500),
      proposedActions: [
        `Customer note for ${person}`,
        vehicle ? `Vehicle interest: ${vehicle}` : "Record vehicle interest",
        budget ? `Budget preference: ${budget}` : "Budget if stated",
        follow ? `Follow-up: ${follow}` : "Optional follow-up",
      ],
      needsConfirm: !person || person.length < 2,
      why: "Customer + vehicle interest pattern (dealership context).",
    };
  }

  if (follow || /\bfollow[- ]?up\b/i.test(raw)) {
    return {
      kind: "follow_up",
      confidence: person ? "high" : "medium",
      workspaceHint: /\b(brand|caleb|content)\b/i.test(raw) ? "business" : person ? "work" : "personal",
      personName: person,
      vehicleHint: vehicle,
      budgetHint: budget,
      followUpWhen: follow || "unspecified",
      summary: raw.slice(0, 500),
      proposedActions: [
        person ? `Follow-up task for ${person}` : "Create follow-up task",
        follow ? `When: ${follow}` : "Confirm due date",
      ],
      needsConfirm: !person,
      why: "Follow-up language detected.",
    };
  }

  if (/\bprefer\b|\balways\b|\bnever\b|\bI like\b|\bI hate\b/i.test(raw)) {
    return {
      kind: "preference",
      confidence: "high",
      workspaceHint: "personal",
      personName: null,
      vehicleHint: null,
      budgetHint: null,
      followUpWhen: null,
      summary: raw.slice(0, 500),
      proposedActions: ["Owner preference / memory fact"],
      needsConfirm: false,
      why: "Preference language.",
    };
  }

  if (/\btask\b|\bremind me\b|\bto[- ]?do\b/i.test(raw)) {
    return {
      kind: "task",
      confidence: "high",
      workspaceHint: null,
      personName: person,
      vehicleHint: vehicle,
      budgetHint: budget,
      followUpWhen: follow,
      summary: raw.slice(0, 500),
      proposedActions: ["Create task in active workspace"],
      needsConfirm: false,
      why: "Explicit task language.",
    };
  }

  if (person || /\bjust talked\b|\bsaid that\b|\bnote\b/i.test(raw)) {
    return {
      kind: "customer_update",
      confidence: person ? "high" : "medium",
      workspaceHint: "work",
      personName: person,
      vehicleHint: vehicle,
      budgetHint: budget,
      followUpWhen: follow,
      summary: raw.slice(0, 500),
      proposedActions: person ? [`Add note to ${person}`] : ["Add CRM note — name the person if known"],
      needsConfirm: !person,
      why: "Interaction / note pattern.",
    };
  }

  return {
    kind: "note",
    confidence: "medium",
    workspaceHint: null,
    personName: person,
    vehicleHint: vehicle,
    budgetHint: budget,
    followUpWhen: follow,
    summary: raw.slice(0, 500) || "(empty)",
    proposedActions: ["Store note in active context", "Promote to fact if Owner confirms"],
    needsConfirm: raw.length < 8,
    why: "Generic capture.",
  };
}

export interface CaptureResultV1 {
  classification: CaptureClassificationV1;
  applied: string[];
  skipped: string[];
  captureId: string;
  at: IsoTimestamp;
}
