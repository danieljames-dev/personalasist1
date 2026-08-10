/**
 * R7 first useful CRM assistant helpers — account summary, intent routing, and draft scaffolding.
 * Deterministic structured lookup first; model prose is optional decoration only.
 */
import type {
  ContactChannelV1,
  CrmDocumentV1,
  CustomerV1,
  EmailDraftV1,
  IsoTimestamp,
  OpaqueId,
  ProvenanceV1,
  RelationshipV1,
} from "./contracts.js";
import { lastInteraction } from "./relationships.js";
import { callPreparation, followUpDraft } from "./sales-coach.js";

export type CrmAssistantIntentV1 =
  | "CRM_LOOKUP"
  | "CRM_CREATE"
  | "CRM_UPDATE"
  | "ADD_NOTE"
  | "ADD_INTERACTION"
  | "ADD_TASK"
  | "LIST_FOLLOWUPS"
  | "ACCOUNT_SUMMARY"
  | "RESEARCH_COMPANY"
  | "DRAFT_EMAIL"
  | "INGEST_DOCUMENT"
  | "INGEST_IMAGE"
  | "GENERAL_ASSISTANT_QUERY"
  | "WORK_QUEUE"
  | "CORRECT";

export interface CrmIntentRouteV1 {
  intent: CrmAssistantIntentV1;
  confidence: "high" | "medium" | "low";
  subject: string;
  note: string;
  why: string;
}

/** Alias patterns: any match (word-boundary-ish includes) routes to intent. Order = priority. */
const RULES: Array<{ intent: CrmAssistantIntentV1; patterns: RegExp[]; confidence: "high" | "medium" }> = [
  {
    intent: "DRAFT_EMAIL",
    confidence: "high",
    patterns: [
      /\bdraft\b.*\b(email|e-mail|message|follow[- ]?up)\b/i,
      /\bwrite\b.*\b(email|e-mail|message)\b/i,
      /\bemail\b.*\bdraft\b/i,
      /\bdraft\b.+\b(john|jane|him|her|them)\b/i,
    ],
  },
  {
    intent: "WORK_QUEUE",
    confidence: "high",
    patterns: [
      /\bwhat (should|do) i (do|work on|focus on)\b/i,
      /\bwhat needs (my )?attention\b/i,
      /\bwhat can you handle\b/i,
      /\btoday'?s (priorities|work|plan)\b/i,
      /\bwork queue\b/i,
      /\bprepare me for (today|my day|my calls)\b/i,
      /\bhelp me prepare for today\b/i,
    ],
  },
  {
    intent: "LIST_FOLLOWUPS",
    confidence: "high",
    patterns: [
      /\bwhat should i follow up on\b/i,
      /\bshow (my )?(follow[- ]?ups|open tasks)\b/i,
      /\bwhat are my open tasks\b/i,
      /\b(open|overdue|due) (follow[- ]?ups|tasks)\b/i,
      /\bwho (do i need to call|needs (follow|attention|a call))\b/i,
      /\bwho needs follow[- ]?up\b/i,
      /\bfollow[- ]?ups?\b/i,
      /\bwho needs attention\b/i,
    ],
  },
  {
    intent: "RESEARCH_COMPANY",
    confidence: "high",
    patterns: [/\bresearch\b/i, /\blook up (the )?company\b/i, /\bprepare me for a (sales )?call\b/i, /\bpublic research\b/i],
  },
  {
    intent: "ADD_NOTE",
    confidence: "high",
    patterns: [/\bsave (this )?note\b/i, /\bremember that\b/i, /\badd a note\b/i, /\bnote that\b/i, /\bremember this\b/i],
  },
  {
    intent: "ADD_INTERACTION",
    confidence: "medium",
    patterns: [/\blog a call\b/i, /\brecord (an )?interaction\b/i, /\bthey said\b/i, /\btold me\b/i],
  },
  {
    intent: "ADD_TASK",
    confidence: "high",
    patterns: [
      /\bfollow up tomorrow\b/i,
      /\badd a task\b/i,
      /\bremind me to\b/i,
      /\bcreate a task\b/i,
      /\bschedule a (task|follow[- ]?up)\b/i,
    ],
  },
  {
    intent: "CRM_CREATE",
    confidence: "high",
    patterns: [
      /\bcreate a (customer|company|contact|prospect)\b/i,
      /\badd a (customer|company|contact|prospect)\b/i,
      /\bnew (customer|company|contact|prospect)\b/i,
    ],
  },
  {
    intent: "CRM_UPDATE",
    confidence: "medium",
    patterns: [/\bupdate\b/i, /\bchange title\b/i, /\bcorrect\b/i, /\bthat'?s wrong\b/i, /\bmerge (these|contacts)\b/i],
  },
  {
    intent: "INGEST_DOCUMENT",
    confidence: "high",
    patterns: [/\badd this document\b/i, /\bingest document\b/i, /\battach document\b/i, /\bsave this quote\b/i, /\bupload\b/i],
  },
  {
    intent: "INGEST_IMAGE",
    confidence: "high",
    patterns: [/\badd this image\b/i, /\bscreenshot\b/i, /\bphoto of\b/i, /\bingest image\b/i, /\blook at this (picture|photo|image)\b/i],
  },
  {
    intent: "ACCOUNT_SUMMARY",
    confidence: "high",
    patterns: [
      /\bwhat do we know about\b/i,
      /\bwhat'?s going on with\b/i,
      /\bwhat'?s happening with\b/i,
      /\baccount summary\b/i,
      /\bshow me all interactions\b/i,
      /\bcontact history\b/i,
      /\btimeline\b/i,
      /\bconcerned about\b/i,
      /\bwhat (is|did) (jane|john|they|he|she)\b/i,
      /\bwhat did .+ (say|tell)\b/i,
    ],
  },
  {
    intent: "CRM_LOOKUP",
    confidence: "medium",
    patterns: [
      /\bfind customers?\b/i,
      /\bwho talked about\b/i,
      /\binterested in\b/i,
      /\bcustomers? in\b/i,
      /\bshow customers?\b/i,
      /\bfind that customer\b/i,
      /\bwhat do we know about them\b/i,
    ],
  },
  {
    intent: "WORK_QUEUE",
    confidence: "medium",
    patterns: [
      /\bwhat brands? (are )?active\b/i,
      /\bhow are the brands doing\b/i,
      /\bwhat('?s| is) caleb working on\b/i,
      /\bwhich brand\b/i,
    ],
  },
];

export function routeCrmAssistantIntent(text: string): CrmIntentRouteV1 {
  const raw = String(text ?? "").trim();
  const lower = raw.toLowerCase();
  if (!lower) {
    return { intent: "GENERAL_ASSISTANT_QUERY", confidence: "low", subject: "", note: "", why: "empty" };
  }
  for (const rule of RULES) {
    const hit = rule.patterns.find((re) => re.test(raw));
    if (!hit) continue;
    const subject = extractSubjectLoose(raw, hit);
    return {
      intent: rule.intent,
      confidence: rule.confidence,
      subject,
      note: raw,
      why: `matched /${hit.source}/`,
    };
  }
  // Soft queue if message is only about follow-ups/tasks without "draft"
  if (/\b(follow[- ]?up|task|todo|to-do)\b/i.test(raw) && !/\bdraft|write|email\b/i.test(raw)) {
    return { intent: "LIST_FOLLOWUPS", confidence: "medium", subject: "", note: raw, why: "soft follow-up/task language" };
  }
  return {
    intent: "GENERAL_ASSISTANT_QUERY",
    confidence: "low",
    subject: "",
    note: raw,
    why: "no CRM trigger",
  };
}

function extractSubjectLoose(text: string, pattern: RegExp): string {
  const m = pattern.exec(text);
  if (!m) return "";
  let rest = text.slice(m.index + m[0].length).trim();
  rest = rest.replace(/^[:\-\s]+/, "").replace(/[?.!].*$/, "").trim();
  rest = rest.replace(/^(about|for|to|with|on)\s+/i, "").trim();
  // If pattern consumed the entity (e.g. "what is jane"), pull name tokens from full text.
  if (!rest) {
    const named = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g);
    if (named?.length) return named[named.length - 1]!.slice(0, 200);
  }
  return rest.slice(0, 200);
}

export function findRelationshipsByName(relationships: readonly RelationshipV1[], query: string): RelationshipV1[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const stop = new Set(["what", "who", "the", "about", "for", "with", "from", "that", "this", "have", "do", "we", "know", "tell", "me", "show", "all", "and", "or", "to", "a", "an", "is", "are", "was", "did", "of", "on", "in", "my", "our", "their", "should", "next", "concerned", "concern", "interested"]);
  const tokens = q
    .replace(/[?.!,]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !stop.has(t));
  return relationships.filter((r) => {
    if (r.archived) return false;
    const hay = `${r.displayName} ${r.organisation} ${r.role} ${r.notes} ${r.objections.join(" ")} ${r.interests.map((i) => i.description).join(" ")}`.toLowerCase();
    if (hay.includes(q)) return true;
    if (!tokens.length) return false;
    // Any distinctive token match (first/last name, company word) is enough for CRM lookup.
    return tokens.some((tok) => hay.includes(tok));
  });
}

export function buildAccountSummary(customer: CustomerV1): {
  title: string;
  organisation: string;
  lifecycle: string;
  lastContact: string;
  concerns: string[];
  nextAction: string;
  openFollowUps: number;
  recentInteractions: Array<{ at: string; kind: string; summary: string }>;
  text: string;
} {
  const last = lastInteraction(customer);
  const openFollowUps = customer.followUps.filter((f) => f.status === "open").length;
  const recent = [...customer.interactions]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8)
    .map((i) => ({ at: i.at, kind: i.kind, summary: i.summary }));
  const concerns = [...customer.objections];
  if (!concerns.length) {
    for (const i of recent) {
      if (/concern|worried|pricing|delivery|budget|delay/i.test(i.summary)) concerns.push(i.summary);
    }
  }
  const nextAction =
    customer.nextAction ||
    customer.followUps.find((f) => f.status === "open")?.reason ||
    "No next action recorded.";
  const text = [
    `${customer.displayName}${customer.organisation ? ` (${customer.organisation})` : ""}`,
    `Type: ${customer.relationshipType} · Lifecycle: ${customer.lifecycle}`,
    `Last contact: ${last ? `${last.at.slice(0, 10)} — ${last.summary}` : "none recorded"}`,
    concerns.length ? `Known concerns: ${concerns.slice(0, 5).join("; ")}` : "Known concerns: none recorded",
    `Next recommended action: ${nextAction}`,
    openFollowUps ? `Open follow-ups: ${openFollowUps}` : "Open follow-ups: 0",
    recent.length ? `Recent interactions:\n${recent.map((r) => `  - ${r.at.slice(0, 10)} [${r.kind}] ${r.summary}`).join("\n")}` : "Recent interactions: none",
  ].join("\n");
  return {
    title: customer.displayName,
    organisation: customer.organisation,
    lifecycle: customer.lifecycle,
    lastContact: last ? `${last.at} — ${last.summary}` : "none",
    concerns,
    nextAction,
    openFollowUps,
    recentInteractions: recent,
    text,
  };
}

export function buildWorkQueue(relationships: readonly RelationshipV1[], nowIso: string): {
  overdue: Array<{ customer: string; reason: string; dueAt: string }>;
  dueSoon: Array<{ customer: string; reason: string; dueAt: string }>;
  staleAccounts: Array<{ customer: string; lastContact: string }>;
  text: string;
} {
  const now = Date.parse(nowIso);
  const overdue: Array<{ customer: string; reason: string; dueAt: string }> = [];
  const dueSoon: Array<{ customer: string; reason: string; dueAt: string }> = [];
  const staleAccounts: Array<{ customer: string; lastContact: string }> = [];
  for (const r of relationships) {
    if (r.archived) continue;
    for (const f of r.followUps) {
      if (f.status !== "open") continue;
      const due = Date.parse(f.dueAt);
      const row = { customer: r.displayName, reason: f.reason, dueAt: f.dueAt };
      if (due < now) overdue.push(row);
      else if (due - now < 3 * 86400000) dueSoon.push(row);
    }
    const last = r.lastContactAt ? Date.parse(r.lastContactAt) : 0;
    if (!last || now - last > 14 * 86400000) {
      staleAccounts.push({
        customer: r.displayName,
        lastContact: r.lastContactAt ?? "never",
      });
    }
  }
  const text = [
    "What needs your attention:",
    overdue.length ? `Overdue follow-ups (${overdue.length}):\n${overdue.slice(0, 10).map((o) => `  - ${o.customer}: ${o.reason} (due ${o.dueAt.slice(0, 10)})`).join("\n")}` : "Overdue follow-ups: none",
    dueSoon.length ? `Due soon:\n${dueSoon.slice(0, 8).map((o) => `  - ${o.customer}: ${o.reason}`).join("\n")}` : "Due soon: none",
    staleAccounts.length ? `Quiet accounts (14+ days):\n${staleAccounts.slice(0, 8).map((s) => `  - ${s.customer} (last ${s.lastContact.slice(0, 10)})`).join("\n")}` : "Quiet accounts: none flagged",
  ].join("\n\n");
  return { overdue, dueSoon, staleAccounts, text };
}

export function buildEmailDraftFromCustomer(
  customer: CustomerV1,
  channel: ContactChannelV1 = "email",
): { subject: string; body: string; basedOn: string } {
  const coach = followUpDraft(customer, channel);
  const prep = callPreparation(customer);
  const subject = `Following up — ${customer.organisation || customer.displayName}`;
  const body = [...coach.lines, "", "—", ...prep.lines].join("\n");
  return {
    subject,
    body,
    basedOn: `Stored CRM for ${customer.displayName}; coach follow-up-draft + call-preparation`,
  };
}

export function makeProvenance(now: IsoTimestamp, sourceRef: string): ProvenanceV1 {
  return { sourceType: "owner", sourceRef, recordedAt: now };
}

export function boundList<T>(items: T[], max: number): T[] {
  return items.length <= max ? items : items.slice(0, max);
}

export function newCrmDocument(input: {
  id: OpaqueId;
  workspace: string;
  relationshipId: OpaqueId | null;
  filename: string;
  storedPath: string;
  mimeType: string;
  byteLength: number;
  kind: CrmDocumentV1["kind"];
  summary: string;
  extractedText: string;
  now: IsoTimestamp;
}): CrmDocumentV1 {
  return {
    id: input.id,
    workspace: input.workspace,
    relationshipId: input.relationshipId,
    filename: input.filename,
    storedPath: input.storedPath,
    mimeType: input.mimeType,
    byteLength: input.byteLength,
    kind: input.kind,
    summary: input.summary.slice(0, 4000),
    extractedText: input.extractedText.slice(0, 100_000),
    tags: [],
    provenance: makeProvenance(input.now, "crm.document.intake"),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function newEmailDraft(input: {
  id: OpaqueId;
  workspace: string;
  relationshipId: OpaqueId | null;
  toName: string;
  toAddress: string;
  subject: string;
  body: string;
  basedOn: string;
  now: IsoTimestamp;
}): EmailDraftV1 {
  return {
    id: input.id,
    workspace: input.workspace,
    relationshipId: input.relationshipId,
    toName: input.toName.slice(0, 200),
    toAddress: input.toAddress.slice(0, 320),
    subject: input.subject.slice(0, 300),
    body: input.body.slice(0, 20_000),
    status: "draft",
    basedOn: input.basedOn.slice(0, 1000),
    provenance: makeProvenance(input.now, "crm.email.draft"),
    createdAt: input.now,
    updatedAt: input.now,
  };
}
