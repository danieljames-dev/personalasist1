/**
 * Structured CRM action proposals — the contract the future browser worker consumes.
 *
 * The worker must never receive "go update Tekion". It receives an object where every judgement has
 * already been made and can be reviewed by the Owner before anything happens. That division is the
 * point: intelligence proposes, authority gates, the worker executes deterministically.
 *
 * Grok's browser-worker design (`docs/design/browser-automation-worker.md`) places one requirement
 * on this layer, and it is the strictest rule here: a write proposal must carry a `customerRef` that
 * AION has already grounded, never a name. So a proposal cannot be constructed at all from an
 * ambiguous or unresolved identity — the guard lives at construction, where it cannot be forgotten
 * downstream or bypassed by a caller in a hurry.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { CustomerIdentityResolutionV1 } from "./customer-identity.js";
import { isSafeToAttribute } from "./customer-identity.js";

export type CrmActionKindV1 =
  | "PREPARE_CALL_NOTE"
  | "ADD_CALL_NOTE"
  | "PREPARE_FOLLOWUP"
  | "CREATE_FOLLOWUP"
  | "PREPARE_PREFERENCE_UPDATE"
  | "UPDATE_ALLOWED_PREFERENCE";

/** Maps onto the browser worker's `authorityMode`. */
export type AuthorityRequiredV1 = "PREPARE_ONLY" | "APPROVED_WRITE" | "HIGH_CONSEQUENCE_OWNER_CONFIRM";

export type ProposalStatusV1 =
  | "PROPOSED" | "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED" | "UNCERTAIN" | "SUPERSEDED";

export interface CrmActionProposalV1 {
  proposalId: OpaqueId;
  workspace: string;
  customerRef: OpaqueId;
  action: CrmActionKindV1;
  fields: Record<string, string>;
  note: string;
  sourceRefs: string[];
  confidence: number;
  authorityRequired: AuthorityRequiredV1;
  /** Plain language, for the Owner to approve. Not a description of a payload. */
  expectedExternalEffect: string;
  idempotencyKey: string;
  status: ProposalStatusV1;
  createdAt: IsoTimestamp;
  resolvedAt: IsoTimestamp | null;
  resolutionNote: string | null;
}

export interface ProposalRefusalV1 {
  refused: true;
  reason: string;
}

/** Actions that only prepare something. These never touch an external system. */
const PREPARE_ONLY = new Set<CrmActionKindV1>([
  "PREPARE_CALL_NOTE", "PREPARE_FOLLOWUP", "PREPARE_PREFERENCE_UPDATE",
]);

export function authorityFor(action: CrmActionKindV1): AuthorityRequiredV1 {
  return PREPARE_ONLY.has(action) ? "PREPARE_ONLY" : "APPROVED_WRITE";
}

export function isWriteAction(action: CrmActionKindV1): boolean {
  return !PREPARE_ONLY.has(action);
}

/**
 * A key that makes a retry safe.
 *
 * Browser automation retries. Without a stable key a retried "log call" silently becomes two calls
 * in a customer's history — worse than a failure, because it looks like data. Derived from the
 * things that define the action rather than from a clock, so the same proposal retried is the same
 * key.
 */
export function proposalIdempotencyKey(input: {
  workspace: string;
  customerRef: string;
  action: CrmActionKindV1;
  sourceRefs: readonly string[];
}): string {
  const refs = [...input.sourceRefs].sort().join("|");
  return `${input.workspace}:${input.customerRef}:${input.action}:${refs}`.slice(0, 400);
}

/**
 * Build a proposal, or refuse and say why.
 *
 * Refusing rather than returning something half-formed is deliberate: a proposal that exists is a
 * proposal that can be approved, and the approval screen is the wrong place to discover that AION
 * was never sure who it was talking about.
 */
export function buildCrmActionProposal(input: {
  proposalId: OpaqueId;
  workspace: string;
  identity: CustomerIdentityResolutionV1;
  action: CrmActionKindV1;
  fields?: Record<string, string>;
  note: string;
  sourceRefs: readonly string[];
  confidence: number;
  expectedExternalEffect: string;
  now: IsoTimestamp;
}): CrmActionProposalV1 | ProposalRefusalV1 {
  if (!isSafeToAttribute(input.identity) || !input.identity.relationshipRef) {
    return {
      refused: true,
      reason: `identity is ${input.identity.state} — a CRM action needs a grounded customer, never a name`,
    };
  }
  // A dealership proposal built from a conversation in another workspace is refused, not warned
  // about. This is the boundary that keeps a care-business contact out of a car-sales queue.
  if (input.identity.workspace && input.identity.workspace !== input.workspace) {
    return {
      refused: true,
      reason: `workspace mismatch — conversation is in ${input.identity.workspace}, proposal targets ${input.workspace}`,
    };
  }
  if (!input.sourceRefs.length) {
    return { refused: true, reason: "no source references — every proposal must cite the evidence behind it" };
  }
  if (!String(input.expectedExternalEffect ?? "").trim()) {
    return { refused: true, reason: "no plain-language effect — the Owner approves an outcome, not a payload" };
  }

  const customerRef = input.identity.relationshipRef;
  return {
    proposalId: input.proposalId,
    workspace: input.workspace,
    customerRef,
    action: input.action,
    fields: { ...(input.fields ?? {}) },
    note: input.note.slice(0, 2000),
    sourceRefs: [...input.sourceRefs],
    confidence: Math.max(0, Math.min(100, Math.round(input.confidence))),
    authorityRequired: authorityFor(input.action),
    expectedExternalEffect: input.expectedExternalEffect.slice(0, 500),
    idempotencyKey: proposalIdempotencyKey({
      workspace: input.workspace, customerRef, action: input.action, sourceRefs: input.sourceRefs,
    }),
    status: "PROPOSED",
    createdAt: input.now,
    resolvedAt: null,
    resolutionNote: null,
  };
}

/**
 * Record what the browser worker reported back.
 *
 * `UNCERTAIN_WRITE` is handled here rather than by the worker, and it never becomes `EXECUTED`. The
 * write may or may not have landed, so the only safe move is to stop and ask the Owner to look. A
 * blind retry is exactly how one call note becomes two.
 */
export function applyExecutionResult(
  proposal: CrmActionProposalV1,
  result: { outcome: "SUCCESS" | "BLOCKED" | "FAILED" | "UNCERTAIN_WRITE" | "OWNER_REQUIRED"; detail: string; at: IsoTimestamp },
): CrmActionProposalV1 {
  const status: ProposalStatusV1 =
    result.outcome === "SUCCESS" ? "EXECUTED"
    : result.outcome === "UNCERTAIN_WRITE" ? "UNCERTAIN"
    : result.outcome === "OWNER_REQUIRED" ? "PROPOSED"
    : "FAILED";
  const note =
    result.outcome === "UNCERTAIN_WRITE"
      ? `The write may or may not have gone through — check this customer in the CRM before retrying. ${result.detail}`
      : result.detail;
  return {
    ...proposal,
    status,
    resolvedAt: result.outcome === "OWNER_REQUIRED" ? null : result.at,
    resolutionNote: note.slice(0, 500),
  };
}

/** A proposal in this state must never be handed to an executor again automatically. */
export function isRetryable(proposal: CrmActionProposalV1): boolean {
  return proposal.status === "FAILED";
}

/** Owner-facing review line: what will change, and on what evidence. */
export function describeCrmProposal(proposal: CrmActionProposalV1): string {
  const lines = [
    `${proposal.action.replace(/_/g, " ").toLowerCase()} — ${proposal.expectedExternalEffect}`,
    `  evidence: ${proposal.sourceRefs.join(", ")}`,
  ];
  if (proposal.authorityRequired !== "PREPARE_ONLY") {
    lines.push(`  needs your approval before anything is written`);
  }
  return lines.join("\n");
}
