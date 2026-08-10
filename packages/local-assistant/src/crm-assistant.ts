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

const RULES: Array<{ intent: CrmAssistantIntentV1; triggers: string[]; confidence: "high" | "medium" }> = [
  // More specific email/draft phrases must win over generic "follow-up" queue phrases.
  { intent: "DRAFT_EMAIL", triggers: ["draft a follow-up email", "draft an email", "write an email", "email draft", "draft jane", "draft john", "follow-up email", "follow up email"], confidence: "high" },
  { intent: "WORK_QUEUE", triggers: ["what needs my attention", "what should i work on today", "what should i do next", "today's priorities", "work queue"], confidence: "high" },
  { intent: "LIST_FOLLOWUPS", triggers: ["needs follow-up", "overdue follow", "open follow-ups", "follow-ups due", "who needs follow"], confidence: "high" },
  { intent: "RESEARCH_COMPANY", triggers: ["research ", "look up company", "prepare me for a sales call", "public research"], confidence: "high" },
  { intent: "ADD_NOTE", triggers: ["save this note", "remember that", "add a note", "note that"], confidence: "high" },
  { intent: "ADD_INTERACTION", triggers: ["log a call", "record interaction", "they said", "told me"], confidence: "medium" },
  { intent: "ADD_TASK", triggers: ["follow up tomorrow", "add a task", "remind me to", "create a task"], confidence: "high" },
  { intent: "CRM_CREATE", triggers: ["create a customer", "add a customer", "new customer", "create a company", "add a contact", "new contact"], confidence: "high" },
  { intent: "CRM_UPDATE", triggers: ["update ", "change title", "correct ", "that's wrong", "merge these"], confidence: "medium" },
  { intent: "INGEST_DOCUMENT", triggers: ["add this document", "ingest document", "attach document", "save this quote"], confidence: "high" },
  { intent: "INGEST_IMAGE", triggers: ["add this image", "screenshot", "photo of", "ingest image"], confidence: "high" },
  { intent: "ACCOUNT_SUMMARY", triggers: ["what do we know about", "account summary", "show me all interactions", "contact history", "timeline", "concerned about", "what is jane", "what did john", "what did jane"], confidence: "high" },
  { intent: "CRM_LOOKUP", triggers: ["find customers", "who talked about", "interested in", "customers in", "show customers"], confidence: "medium" },
];

export function routeCrmAssistantIntent(text: string): CrmIntentRouteV1 {
  const lower = String(text ?? "").trim().toLowerCase();
  if (!lower) {
    return { intent: "GENERAL_ASSISTANT_QUERY", confidence: "low", subject: "", note: "", why: "empty" };
  }
  for (const rule of RULES) {
    const hit = rule.triggers.find((t) => lower.includes(t));
    if (!hit) continue;
    const subject = extractSubject(text, hit);
    return {
      intent: rule.intent,
      confidence: rule.confidence,
      subject,
      note: text.trim(),
      why: `matched "${hit}"`,
    };
  }
  return {
    intent: "GENERAL_ASSISTANT_QUERY",
    confidence: "low",
    subject: "",
    note: text.trim(),
    why: "no CRM trigger",
  };
}

function extractSubject(text: string, trigger: string): string {
  const idx = text.toLowerCase().indexOf(trigger.toLowerCase());
  if (idx < 0) return "";
  let rest = text.slice(idx + trigger.length).trim();
  rest = rest.replace(/^[:\-\s]+/, "").replace(/[?.!].*$/, "").trim();
  // Strip leading "about " / "for "
  rest = rest.replace(/^(about|for|to)\s+/i, "").trim();
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
