/**
 * Commitments — stronger than generic tasks: who promised what to whom.
 */
import type { IsoTimestamp, OpaqueId, ProvenanceV1 } from "./contracts.js";

export type CommitmentStatusV1 =
  | "open"
  | "due_soon"
  | "overdue"
  | "kept"
  | "broken"
  | "cancelled";

export interface CommitmentV1 {
  id: OpaqueId;
  workspace: string;
  /** Who made the promise (Owner, named person, AION). */
  committedBy: string;
  /** Who receives the promise. */
  committedTo: string;
  relationshipId: string | null;
  statement: string;
  dueAt: IsoTimestamp | null;
  status: CommitmentStatusV1;
  confidence: number;
  provenance: ProvenanceV1;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  resolvedAt: IsoTimestamp | null;
}

export function buildCommitment(
  input: Record<string, unknown>,
  ctx: { id: OpaqueId; now: IsoTimestamp; workspace: string },
): CommitmentV1 {
  const statement = String(input.statement ?? "").trim().slice(0, 2000);
  if (!statement) throw new Error("Commitment needs a statement.");
  const dueAt = input.dueAt ? String(input.dueAt) : null;
  let status: CommitmentStatusV1 = "open";
  if (dueAt) {
    const day = ctx.now.slice(0, 10);
    const dueDay = dueAt.slice(0, 10);
    if (dueDay < day) status = "overdue";
    else if (dueDay === day) status = "due_soon";
  }
  return {
    id: ctx.id,
    workspace: ctx.workspace,
    committedBy: String(input.committedBy ?? "Owner").slice(0, 200),
    committedTo: String(input.committedTo ?? "").slice(0, 200),
    relationshipId: input.relationshipId ? String(input.relationshipId) : null,
    statement,
    dueAt,
    status: (input.status as CommitmentStatusV1) || status,
    confidence: Math.min(100, Math.max(0, Number(input.confidence ?? 90) || 90)),
    provenance: {
      sourceType: "owner",
      sourceRef: String(input.sourceRef ?? "commitment.owner").slice(0, 500),
      recordedAt: ctx.now,
    },
    createdAt: ctx.now,
    updatedAt: ctx.now,
    resolvedAt: null,
  };
}

/** Extract commitment candidates from free text (capture). */
export function extractCommitmentCandidates(text: string, nowIso: string): Array<{
  committedBy: string;
  committedTo: string;
  statement: string;
  dueAt: string | null;
  confidence: number;
}> {
  const raw = String(text ?? "").trim();
  const out: Array<{
    committedBy: string;
    committedTo: string;
    statement: string;
    dueAt: string | null;
    confidence: number;
  }> = [];
  const tomorrow = new Date(Date.parse(nowIso) + 86400000).toISOString();
  const fridayish = (() => {
    const d = new Date(nowIso);
    const day = d.getUTCDay();
    const add = (5 - day + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + add);
    return d.toISOString();
  })();

  // "I told John I would call tomorrow"
  let m = raw.match(/\bi told\s+([A-Z][a-z]+)\s+i would\s+(.+?)(?:\.|$)/i);
  if (m) {
    out.push({
      committedBy: "Owner",
      committedTo: m[1]!,
      statement: m[2]!.trim().slice(0, 500),
      dueAt: /\btomorrow\b/i.test(raw) ? tomorrow : /\bfriday\b/i.test(raw) ? fridayish : null,
      confidence: 88,
    });
  }
  // "I promised the customer I would check"
  m = raw.match(/\bi promised\s+(?:the\s+)?([A-Za-z][A-Za-z\s]{0,40}?)\s+i would\s+(.+?)(?:\.|$)/i);
  if (m) {
    out.push({
      committedBy: "Owner",
      committedTo: m[1]!.trim(),
      statement: m[2]!.trim().slice(0, 500),
      dueAt: /\btomorrow\b/i.test(raw) ? tomorrow : null,
      confidence: 90,
    });
  }
  // "Caleb said he would send the assets Friday"
  m = raw.match(/\b([A-Z][a-z]+)\s+said (?:he|she|they) would\s+(.+?)(?:\.|$)/i);
  if (m) {
    out.push({
      committedBy: m[1]!,
      committedTo: "Owner",
      statement: m[2]!.trim().slice(0, 500),
      dueAt: /\bfriday\b/i.test(raw) ? fridayish : /\btomorrow\b/i.test(raw) ? tomorrow : null,
      confidence: 82,
    });
  }
  // "Follow up with Mike tomorrow" as Owner commitment to act
  if (/\bfollow[- ]?up\b/i.test(raw) && /\btomorrow\b/i.test(raw)) {
    const who = raw.match(/\b(?:with|to)\s+([A-Z][a-z]+)/i)?.[1];
    if (who) {
      out.push({
        committedBy: "Owner",
        committedTo: who,
        statement: `Follow up with ${who}`,
        dueAt: tomorrow,
        confidence: 75,
      });
    }
  }
  return out;
}

export function refreshCommitmentStatus(c: CommitmentV1, nowIso: string): CommitmentV1 {
  if (c.status === "kept" || c.status === "broken" || c.status === "cancelled") return c;
  if (!c.dueAt) return c;
  const day = nowIso.slice(0, 10);
  const dueDay = c.dueAt.slice(0, 10);
  let status: CommitmentStatusV1 = "open";
  if (dueDay < day) status = "overdue";
  else if (dueDay === day) status = "due_soon";
  if (status === c.status) return c;
  return { ...c, status, updatedAt: nowIso };
}
