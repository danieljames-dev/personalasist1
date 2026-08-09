import {
  type CapabilityEnvelopeV1,
  type OperationClassV1,
  type AgentRoleV1,
  type OperatorDecisionV1,
  type NestedOwnerGateV1,
  DelegatedOperatorError,
} from "./contracts.js";
import { envelopeDigest, isExpired, parseCapabilityEnvelope } from "./envelope.js";
import { roleAllowsOperation, BUILDER_WRITE_OPERATIONS } from "./roles.js";
import type { OwnerPresencePort } from "./owner-presence.js";
import { agentMayTransition } from "./lifecycle.js";
import type { AuthorizationLifecycleV1 } from "./contracts.js";

export interface AuthorizationRecordV1 {
  readonly envelope: CapabilityEnvelopeV1;
  readonly lifecycle: AuthorizationLifecycleV1;
  readonly envelopeDigest: string;
  readonly generation: number;
  readonly superseded: boolean;
}

export interface ValidationContextV1 {
  readonly nowUtc: string;
  readonly machineName: string;
  readonly machineRole: string;
  readonly repositoryRoot: string;
  readonly canonicalOrigin: string;
  readonly headCommit: string;
  readonly presence: OwnerPresencePort;
  /** When set, this authorization id is known superseded in the store. */
  readonly isSupersededId?: (authorizationId: string) => boolean;
}

export function attachApproval(
  unsigned: CapabilityEnvelopeV1,
  presence: OwnerPresencePort,
  nowUtc: string,
): CapabilityEnvelopeV1 {
  if (unsigned.approvalProof !== null) {
    throw new DelegatedOperatorError("already-approved", "Envelope already has approval proof");
  }
  const digest = envelopeDigest(unsigned);
  const proof = presence.approveEnvelopeDigest(digest, nowUtc);
  return { ...unsigned, approvalProof: proof };
}

export function validateAuthorizedEnvelope(
  envelope: CapabilityEnvelopeV1,
  ctx: ValidationContextV1,
): { readonly digest: string } {
  // Re-parse to reject unknown fields if rehydrated loosely
  const reparsed = parseCapabilityEnvelope(envelope);
  const digest = envelopeDigest(reparsed);

  if (reparsed.approvalProof === null) {
    throw new DelegatedOperatorError("missing-approval", "Envelope has no Owner approval proof");
  }
  if (!ctx.presence.verify(digest, reparsed.approvalProof)) {
    throw new DelegatedOperatorError("invalid-approval", "Owner approval proof does not verify for envelope digest");
  }
  if (isExpired(reparsed, ctx.nowUtc)) {
    throw new DelegatedOperatorError("expired", "Authorization expired");
  }
  if (ctx.isSupersededId?.(reparsed.authorizationId)) {
    throw new DelegatedOperatorError("superseded", "Authorization superseded");
  }
  if (reparsed.machineName !== ctx.machineName) {
    throw new DelegatedOperatorError("wrong-machine", "Machine name binding mismatch");
  }
  if (reparsed.machineRole !== ctx.machineRole) {
    throw new DelegatedOperatorError("wrong-machine-role", "Machine role binding mismatch");
  }
  if (normalizePath(reparsed.repositoryRoot) !== normalizePath(ctx.repositoryRoot)) {
    throw new DelegatedOperatorError("wrong-repo", "Repository root binding mismatch");
  }
  if (reparsed.canonicalOrigin !== ctx.canonicalOrigin) {
    throw new DelegatedOperatorError("wrong-origin", "Canonical origin binding mismatch");
  }
  if (!commitAllowed(reparsed, ctx.headCommit)) {
    throw new DelegatedOperatorError("wrong-baseline", "Git HEAD not permitted by envelope baseline/range rules");
  }
  return { digest };
}

function normalizePath(p: string): string {
  return p.replace(/\//g, "\\").replace(/\\+$/u, "").toLowerCase();
}

function commitAllowed(envelope: CapabilityEnvelopeV1, head: string): boolean {
  if (head === envelope.baselineCommit) return true;
  // R6.5 library does not shell to git for ancestry; Host layer may refine.
  // For pure validation: only exact baseline unless allowOrdinaryForwardCommits and
  // caller supplies explicit allow list via head===baseline OR Host sets forwardOk.
  // Default fail closed for non-equal when we cannot prove ancestry here.
  if (envelope.allowOrdinaryForwardCommits) {
    // Accept only if Host marked forward via special context is not available —
    // keep strict equality for pure unit path; Host wraps with forward check.
    return head === envelope.baselineCommit;
  }
  return false;
}

/** Host may call after verifying git merge-base ancestry. */
export function validateAuthorizedEnvelopeAllowingForwardHead(
  envelope: CapabilityEnvelopeV1,
  ctx: ValidationContextV1,
  headIsOrdinaryForwardFromBaseline: boolean,
): { readonly digest: string } {
  if (ctx.headCommit === envelope.baselineCommit) {
    return validateAuthorizedEnvelope(envelope, ctx);
  }
  if (!envelope.allowOrdinaryForwardCommits || !headIsOrdinaryForwardFromBaseline) {
    throw new DelegatedOperatorError("wrong-baseline", "HEAD not an allowed ordinary forward commit");
  }
  const loosened: ValidationContextV1 = { ...ctx, headCommit: envelope.baselineCommit };
  // Verify binding against baseline equality path, while recording actual head separately by Host.
  return validateAuthorizedEnvelope(envelope, loosened);
}

export function decideOperation(
  envelope: CapabilityEnvelopeV1,
  agentRole: AgentRoleV1,
  operation: OperationClassV1,
  ctx: ValidationContextV1,
): OperatorDecisionV1 {
  try {
    const { digest } = validateAuthorizedEnvelope(envelope, ctx);
    if (agentRole !== envelope.agentRole) {
      return refuse(operation, agentRole, digest, "role-mismatch", "Session role does not match envelope agentRole");
    }
    if (!roleAllowsOperation(agentRole, operation)) {
      return refuse(operation, agentRole, digest, "role-structural-deny", "Role structurally prohibits operation");
    }
    if (envelope.prohibitedOperations.includes(operation)) {
      return refuse(operation, agentRole, digest, "prohibited", "Operation listed in prohibitedOperations (deny wins)");
    }
    if (!envelope.authorizedOperations.includes(operation)) {
      return refuse(operation, agentRole, digest, "not-authorized", "Operation not in authorizedOperations");
    }
    if (!gitAllows(envelope, operation)) {
      return refuse(operation, agentRole, digest, "git-permission", "Git permission missing for operation");
    }
    if (!hostAllows(envelope, operation)) {
      return refuse(operation, agentRole, digest, "host-permission", "Host permission missing for operation");
    }
    return {
      outcome: "ALLOW",
      reasonCode: "allow",
      reason: "Envelope, role, and policy allow operation",
      envelopeDigest: digest,
      operation,
      agentRole,
    };
  } catch (error) {
    const code = error instanceof DelegatedOperatorError ? error.code : "refuse";
    const message = error instanceof Error ? error.message : "refused";
    return refuse(operation, agentRole, null, code, message);
  }
}

function gitAllows(envelope: CapabilityEnvelopeV1, operation: OperationClassV1): boolean {
  const g = new Set(envelope.gitPermissions);
  if (operation === "git.status" || operation === "git.diff" || operation === "repo.read") return g.has("read") || g.has("stage") || g.has("commit_forward") || g.has("push_canonical");
  if (operation === "git.stage") return g.has("stage") || g.has("commit_forward") || g.has("push_canonical");
  if (operation === "git.commit_forward") return g.has("commit_forward") || g.has("push_canonical");
  if (operation === "git.push_canonical") return g.has("push_canonical");
  if (operation === "repo.edit") return g.has("stage") || g.has("commit_forward") || g.has("push_canonical");
  return true;
}

function hostAllows(envelope: CapabilityEnvelopeV1, operation: OperationClassV1): boolean {
  const h = new Set(envelope.hostPermissions);
  if (operation === "host.read") return h.has("elevated_readonly_security") || h.has("none") || h.has("planned_reboot");
  if (operation === "host.reboot") return h.has("planned_reboot") && envelope.rebootPolicy.allowed;
  return true;
}

function refuse(
  operation: OperationClassV1,
  agentRole: AgentRoleV1,
  digest: string | null,
  reasonCode: string,
  reason: string,
): OperatorDecisionV1 {
  return { outcome: "REFUSE", reasonCode, reason, envelopeDigest: digest, operation, agentRole };
}

export function refuseNestedHighConsequence(gate: NestedOwnerGateV1): OperatorDecisionV1 {
  return {
    outcome: "REFUSE",
    reasonCode: "nested-owner-gate",
    reason: `High-consequence operation '${gate}' requires a separate Owner gate; R6.5 ordinary builder authorization cannot grant it.`,
    envelopeDigest: null,
    operation: "repo.read",
    agentRole: "GROK_BUILD",
  };
}

export function assertAgentLifecycle(
  from: AuthorizationLifecycleV1,
  to: AuthorizationLifecycleV1,
): void {
  if (!agentMayTransition(from, to)) {
    throw new DelegatedOperatorError("lifecycle-forbidden", `Agent cannot transition ${from} -> ${to}`);
  }
}

export function isBuilderWriteOp(operation: OperationClassV1): boolean {
  return BUILDER_WRITE_OPERATIONS.has(operation);
}

/** Detect tampering: any body change changes digest and invalidates prior proof. */
export function proofBindsOnlyToDigest(envelope: CapabilityEnvelopeV1, presence: OwnerPresencePort): boolean {
  if (!envelope.approvalProof) return false;
  const digest = envelopeDigest(envelope);
  return presence.verify(digest, envelope.approvalProof);
}
