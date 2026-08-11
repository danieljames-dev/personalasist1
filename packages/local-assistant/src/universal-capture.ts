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
  /** When multiple people match the same first name in CRM. */
  ambiguousPersonIds: string[];
  vehicleHint: string | null;
  budgetHint: string | null;
  followUpWhen: string | null;
  summary: string;
  proposedActions: string[];
  needsConfirm: boolean;
  why: string;
}

export function classifyCaptureText(
  text: string,
  nowIso: IsoTimestamp,
  opts: { existingPeople?: Array<{ id: string; displayName: string; workspace: string }> } = {},
): CaptureClassificationV1 {
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
          : /\bthursday\b/i.test(raw)
            ? "thursday"
            : /\bfriday\b/i.test(raw)
              ? "friday"
              : /\bmonday\b|\btuesday\b|\bwednesday\b|\bsaturday\b|\bsunday\b/i.test(raw)
                ? (raw.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)?.[1]?.toLowerCase() ??
                  "weekday")
                : /\bcall\b/i.test(raw) && /\b(mon|tue|wed|thu|fri|sat|sun)/i.test(raw)
                  ? "scheduled call"
                  : /\bfollow[- ]?up\b|\bcall (him|her|them|back)\b/i.test(raw)
                    ? "unspecified"
                    : null;

  // Multiple CRM people share the same first name → do not fabricate which one
  let ambiguousPersonIds: string[] = [];
  if (person && opts.existingPeople?.length) {
    const first = person.split(/\s+/)[0]!.toLowerCase();
    const hits = opts.existingPeople.filter((p) => {
      const n = p.displayName.toLowerCase();
      return n === person.toLowerCase() || n.startsWith(first + " ") || n === first;
    });
    if (hits.length > 1) {
      ambiguousPersonIds = hits.map((h) => h.id);
    }
  }
  const multiMike = ambiguousPersonIds.length > 1;

  const base = {
    personName: person,
    ambiguousPersonIds,
    vehicleHint: vehicle,
    budgetHint: budget,
    followUpWhen: follow,
    summary: raw.slice(0, 500),
  };

  // "Brand A idea: comparison video" — high confidence brand idea when brand named + idea
  if (
    /\bidea\b/i.test(raw) &&
    /\bbrand\b|\binstagram\b|\bcontent\b|\bvideo\b|\bmetricool\b/i.test(raw)
  ) {
    return {
      ...base,
      kind: "brand_note",
      confidence: "high",
      workspaceHint: "business",
      vehicleHint: null,
      budgetHint: null,
      proposedActions: ["Brand/content idea stored", "No social post"],
      needsConfirm: false,
      why: "Brand idea language with content cue — auto-store as brand note.",
    };
  }

  if (/\bidea\b|\boffer inventory-walk|\bproduct concept\b/i.test(raw)) {
    return {
      ...base,
      kind: "idea",
      confidence: "high",
      workspaceHint: "personal",
      proposedActions: ["Store as Owner idea / product note", "Optional: open project later"],
      needsConfirm: false,
      why: "Idea language detected.",
    };
  }

  if (/\bcaleb\b|\bbrand\b|\bpost\b|\bcontent\b|\binstagram\b|\bmetricool\b/i.test(raw)) {
    const brandNamed = /\bbrand\s+[a-z0-9]/i.test(raw) || /\b(instagram|metricool)\b/i.test(raw);
    return {
      ...base,
      kind: "brand_note",
      confidence: brandNamed ? "high" : "medium",
      workspaceHint: "business",
      personName: person || (/\bcaleb\b/i.test(raw) ? "Caleb" : null),
      vehicleHint: null,
      budgetHint: null,
      proposedActions: ["Brand note in active brand workspace", "Do not invent collaborator roles"],
      needsConfirm: !brandNamed,
      why: brandNamed
        ? "Brand/content language with identifiable brand cue."
        : "Brand/content language — confirm which brand workspace.",
    };
  }

  // "Remember to renew my license Friday" — personal task, no confirm
  if (/\bremember (to|i need)\b|\brenew my\b|\bdon't forget\b/i.test(raw)) {
    return {
      ...base,
      kind: "task",
      confidence: "high",
      workspaceHint: "personal",
      personName: null,
      vehicleHint: null,
      budgetHint: null,
      followUpWhen: follow,
      proposedActions: [
        "Create personal task",
        follow ? `Due hint: ${follow}` : "Confirm due if needed",
      ],
      needsConfirm: false,
      why: "Personal remember/renew task language.",
    };
  }

  // "John loved the white Tacoma but wants to talk to his wife. Call Thursday."
  if (
    person &&
    (vehicle ||
      /\binterested\b|\bwants the\b|\blikes the\b|\bloved the\b|\bloves the\b|\btalk to (his|her) wife\b/i.test(
        raw,
      ))
  ) {
    return {
      ...base,
      kind: "vehicle_interest",
      confidence: multiMike ? "medium" : "high",
      workspaceHint: "work",
      followUpWhen: follow || (/\bcall\b/i.test(raw) ? "unspecified" : null),
      proposedActions: multiMike
        ? [`Multiple people named ${person} — which one?`, ...ambiguousPersonIds.map((id) => `id:${id}`)]
        : [
            `Customer note for ${person}`,
            vehicle ? `Vehicle interest: ${vehicle}` : "Record vehicle interest",
            budget ? `Budget preference: ${budget}` : "Budget if stated",
            follow || /\bcall\b/i.test(raw)
              ? `Follow-up: ${follow || "call"}`
              : "Optional follow-up",
            /\bwife\b|\bspouse\b|\bpartner\b/i.test(raw) ? "Note: decision involves spouse/partner" : "",
          ].filter(Boolean),
      needsConfirm: multiMike || !person || person.length < 2,
      why: multiMike
        ? `Multiple CRM matches for "${person}" — Owner must choose; AION will not guess.`
        : "Customer + vehicle interest pattern (dealership context).",
    };
  }

  if (follow || /\bfollow[- ]?up\b/i.test(raw)) {
    return {
      ...base,
      kind: "follow_up",
      confidence: person && !multiMike ? "high" : "medium",
      workspaceHint: /\b(brand|caleb|content)\b/i.test(raw) ? "business" : person ? "work" : "personal",
      followUpWhen: follow || "unspecified",
      proposedActions: multiMike
        ? [`Which ${person}?`, "Then schedule follow-up"]
        : [
            person ? `Follow-up task for ${person}` : "Create follow-up task",
            follow ? `When: ${follow}` : "Confirm due date",
          ],
      needsConfirm: !person || multiMike,
      why: multiMike ? "Follow-up: ambiguous person name." : "Follow-up language detected.",
    };
  }

  if (/\bprefer\b|\balways\b|\bnever\b|\bI like\b|\bI hate\b/i.test(raw)) {
    return {
      ...base,
      kind: "preference",
      confidence: "high",
      workspaceHint: "personal",
      personName: null,
      vehicleHint: null,
      budgetHint: null,
      followUpWhen: null,
      proposedActions: ["Owner preference / memory fact"],
      needsConfirm: false,
      why: "Preference language.",
    };
  }

  if (/\btask\b|\bremind me\b|\bto[- ]?do\b/i.test(raw)) {
    return {
      ...base,
      kind: "task",
      confidence: "high",
      workspaceHint: null,
      proposedActions: ["Create task in active workspace"],
      needsConfirm: false,
      why: "Explicit task language.",
    };
  }

  if (person || /\bjust talked\b|\bsaid that\b|\bnote\b/i.test(raw)) {
    return {
      ...base,
      kind: "customer_update",
      confidence: person && !multiMike ? "high" : "medium",
      workspaceHint: "work",
      proposedActions: multiMike
        ? [`Which ${person}?`]
        : person
          ? [`Add note to ${person}`]
          : ["Add CRM note — name the person if known"],
      needsConfirm: !person || multiMike,
      why: multiMike ? "Interaction note: ambiguous person." : "Interaction / note pattern.",
    };
  }

  return {
    ...base,
    kind: "note",
    confidence: "medium",
    workspaceHint: null,
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
