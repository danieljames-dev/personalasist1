/**
 * Entity resolution — DESIGN / TEST GATE only.
 *
 * DO NOT auto-merge. Duplicate records are safer than incorrect merges.
 * This module provides candidate matching, hard vetoes, confidence scores,
 * and reversible merge *proposals* — never silent coalescence.
 *
 * Merge execution requires explicit Owner approval (future capability).
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";

export type EntityKindV1 = "person" | "vehicle" | "organization" | "other";

export interface EntityCandidateV1 {
  id: OpaqueId | string;
  kind: EntityKindV1;
  workspace: string;
  displayName: string;
  /** Normalized aliases / first names */
  aliases?: string[];
  /** VIN when vehicle */
  vin?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Extra stable keys (employer, org id) */
  hardKeys?: string[];
}

export type EntityMatchVetoV1 =
  | "WORKSPACE_ISOLATION"
  | "VIN_MISMATCH"
  | "EMAIL_MISMATCH"
  | "PHONE_MISMATCH"
  | "HARD_KEY_CONFLICT"
  | "KIND_MISMATCH"
  | "TRANSITIVE_UNSAFE";

export interface EntityMatchCandidateV1 {
  leftId: string;
  rightId: string;
  workspace: string;
  kind: EntityKindV1;
  confidence: number;
  reasons: string[];
  vetoes: EntityMatchVetoV1[];
  /** true only when confidence high and no vetoes — still NOT auto-merged */
  eligibleForOwnerMerge: boolean;
}

export interface EntityMergeProposalV1 {
  id: OpaqueId;
  leftId: string;
  rightId: string;
  workspace: string;
  kind: EntityKindV1;
  confidence: number;
  reasons: string[];
  /** Surviving id if Owner approves (default: left). */
  proposedSurvivorId: string;
  /** Loser becomes alias / superseded — reversible via unmerge log. */
  proposedAliasId: string;
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "UNMERGED";
  createdAt: IsoTimestamp;
  decidedAt: IsoTimestamp | null;
  provenanceSourceRef: string;
}

export interface EntityUnmergeRecordV1 {
  mergeProposalId: OpaqueId;
  restoredLeftId: string;
  restoredRightId: string;
  at: IsoTimestamp;
  reason: string;
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstToken(s: string): string {
  return normName(s).split(" ")[0] || "";
}

/**
 * Hard vetoes that forbid merge even at high name similarity.
 * Workspace isolation is absolute: never match across workspaces.
 */
export function hardVetoes(a: EntityCandidateV1, b: EntityCandidateV1): EntityMatchVetoV1[] {
  const v: EntityMatchVetoV1[] = [];
  if (a.workspace !== b.workspace) v.push("WORKSPACE_ISOLATION");
  if (a.kind !== b.kind) v.push("KIND_MISMATCH");
  if (a.kind === "vehicle" || b.kind === "vehicle") {
    const va = (a.vin || "").trim().toUpperCase();
    const vb = (b.vin || "").trim().toUpperCase();
    if (va && vb && va !== vb) v.push("VIN_MISMATCH");
  }
  if (a.email && b.email && a.email.toLowerCase() !== b.email.toLowerCase()) v.push("EMAIL_MISMATCH");
  if (a.phone && b.phone) {
    const pa = a.phone.replace(/\D/g, "");
    const pb = b.phone.replace(/\D/g, "");
    if (pa && pb && pa !== pb) v.push("PHONE_MISMATCH");
  }
  const ha = new Set((a.hardKeys ?? []).map((k) => k.toLowerCase()));
  const hb = new Set((b.hardKeys ?? []).map((k) => k.toLowerCase()));
  for (const k of ha) {
    if (!k.includes("=")) continue;
    const [key, val] = k.split("=");
    for (const k2 of hb) {
      if (!k2.startsWith(`${key}=`)) continue;
      if (k2 !== `${key}=${val}`) v.push("HARD_KEY_CONFLICT");
    }
  }
  return [...new Set(v)];
}

/**
 * Score a pair without transitive closure. Confidence is explicit 0–100.
 * Shared first name alone stays low (two Mikes / two Johns).
 */
export function scoreEntityPair(a: EntityCandidateV1, b: EntityCandidateV1): EntityMatchCandidateV1 {
  const vetoes = hardVetoes(a, b);
  const reasons: string[] = [];
  let confidence = 0;

  if (vetoes.length) {
    return {
      leftId: String(a.id),
      rightId: String(b.id),
      workspace: a.workspace,
      kind: a.kind,
      confidence: 0,
      reasons: [`Veto: ${vetoes.join(",")}`],
      vetoes,
      eligibleForOwnerMerge: false,
    };
  }

  const na = normName(a.displayName);
  const nb = normName(b.displayName);
  if (na && na === nb) {
    confidence += 55;
    reasons.push("Exact display name");
  } else if (firstToken(a.displayName) && firstToken(a.displayName) === firstToken(b.displayName)) {
    confidence += 25;
    reasons.push("Shared first name only (ambiguous)");
  }

  const aliasesA = new Set([na, ...(a.aliases ?? []).map(normName)]);
  const aliasesB = new Set([nb, ...(b.aliases ?? []).map(normName)]);
  for (const x of aliasesA) {
    if (x && aliasesB.has(x) && x !== na) {
      confidence += 15;
      reasons.push("Shared alias");
      break;
    }
  }

  if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) {
    confidence += 35;
    reasons.push("Same email");
  }
  if (a.phone && b.phone) {
    const pa = a.phone.replace(/\D/g, "");
    const pb = b.phone.replace(/\D/g, "");
    if (pa && pa === pb) {
      confidence += 30;
      reasons.push("Same phone");
    }
  }
  if (a.vin && b.vin && a.vin.toUpperCase() === b.vin.toUpperCase()) {
    confidence += 50;
    reasons.push("Same VIN");
  }

  confidence = Math.min(100, confidence);
  // Owner merge eligibility: high confidence + no veto. STILL not auto-merge.
  const eligibleForOwnerMerge = confidence >= 80 && vetoes.length === 0;

  return {
    leftId: String(a.id),
    rightId: String(b.id),
    workspace: a.workspace,
    kind: a.kind,
    confidence,
    reasons,
    vetoes,
    eligibleForOwnerMerge,
  };
}

/**
 * Find candidate pairs in one workspace. No transitive closure:
 * A~B and B~C does NOT imply A~C proposal.
 */
export function findEntityMatchCandidates(
  entities: readonly EntityCandidateV1[],
  opts?: { minConfidence?: number },
): EntityMatchCandidateV1[] {
  const min = opts?.minConfidence ?? 25;
  const out: EntityMatchCandidateV1[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const left = entities[i]!;
      const right = entities[j]!;
      if (left.workspace !== right.workspace) continue; // isolation: never even score cross-ws
      const m = scoreEntityPair(left, right);
      if (m.confidence >= min || m.vetoes.length > 0) out.push(m);
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

export function buildMergeProposal(
  match: EntityMatchCandidateV1,
  ctx: { id: OpaqueId; now: IsoTimestamp },
): EntityMergeProposalV1 | null {
  if (!match.eligibleForOwnerMerge) return null;
  return {
    id: ctx.id,
    leftId: match.leftId,
    rightId: match.rightId,
    workspace: match.workspace,
    kind: match.kind,
    confidence: match.confidence,
    reasons: match.reasons,
    proposedSurvivorId: match.leftId,
    proposedAliasId: match.rightId,
    status: "PROPOSED",
    createdAt: ctx.now,
    decidedAt: null,
    provenanceSourceRef: "entity.resolution.gate",
  };
}

/** Reversible unmerge record — merge must leave both ids recoverable. */
export function buildUnmergeRecord(
  proposal: EntityMergeProposalV1,
  now: IsoTimestamp,
  reason: string,
): EntityUnmergeRecordV1 {
  return {
    mergeProposalId: proposal.id,
    restoredLeftId: proposal.leftId,
    restoredRightId: proposal.rightId,
    at: now,
    reason: reason.slice(0, 500),
  };
}

/** Instruction-like / poisoned document content is DATA, never an executable entity directive. */
export function isInstructionLikeDocument(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /ignore (all )?(previous|prior) (instructions|rules)/.test(t) ||
    /you are now|system prompt|jailbreak|exfiltrat/.test(t) ||
    /delete all (data|facts|customers)/.test(t) ||
    /send (this|email) to everyone/.test(t)
  );
}
