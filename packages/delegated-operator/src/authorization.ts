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
import type { GitFactsV1, HostFactsV1, RepositoryFactsV1 } from "./facts-ports.js";

export interface AuthorizationRecordV1 {
  readonly envelope: CapabilityEnvelopeV1;
  readonly lifecycle: AuthorizationLifecycleV1;
  readonly envelopeDigest: string;
  readonly generation: number;
  readonly superseded: boolean;
}

/**
 * Validation context carries TRUSTED OBSERVATIONS only.
 * Callers of Host must not populate these from request body.
 */
export interface ValidationContextV1 {
  readonly nowUtc: string;
  readonly hostFacts: HostFactsV1;
  readonly repoFacts: RepositoryFactsV1;
  readonly gitFacts: GitFactsV1;
  readonly presence: OwnerPresencePort;
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

  // EXPECTATION (envelope) vs OBSERVATION (trusted ports)
  if (reparsed.machineName !== ctx.hostFacts.machineName) {
    throw new DelegatedOperatorError("wrong-machine", "Machine name binding mismatch");
  }
  if (reparsed.machineRole !== ctx.hostFacts.machineRole) {
    throw new DelegatedOperatorError("wrong-machine-role", "Machine role binding mismatch");
  }
  if (normalizePath(reparsed.repositoryRoot) !== normalizePath(ctx.repoFacts.repositoryRoot)) {
    throw new DelegatedOperatorError("wrong-repo", "Repository root binding mismatch");
  }
  if (normalizePath(reparsed.repositoryRoot) !== normalizePath(ctx.gitFacts.repositoryRoot)) {
    throw new DelegatedOperatorError("wrong-repo", "Git repository root observation mismatch");
  }
  if (reparsed.canonicalOrigin !== ctx.repoFacts.canonicalOrigin || reparsed.canonicalOrigin !== ctx.gitFacts.canonicalOrigin) {
    throw new DelegatedOperatorError("wrong-origin", "Canonical origin binding mismatch");
  }
  if (ctx.gitFacts.branch !== "main" && (reparsed.authorizedOperations.includes("git.push_canonical") || reparsed.authorizedOperations.includes("git.commit_forward"))) {
    // Builder write/push on non-main refuses when policy assumes main
    throw new DelegatedOperatorError("wrong-branch", `Observed branch '${ctx.gitFacts.branch}' is not main`);
  }

  const head = ctx.gitFacts.headCommit;
  if (head === reparsed.baselineCommit) {
    return { digest };
  }
  if (reparsed.allowOrdinaryForwardCommits && ctx.gitFacts.isOrdinaryForwardFromBaseline) {
    return { digest };
  }
  throw new DelegatedOperatorError("wrong-baseline", "Git HEAD not permitted by envelope baseline/range rules");
}

function normalizePath(p: string): string {
  return p.replace(/\//g, "\\").replace(/\\+$/u, "").toLowerCase();
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
    // For commit/push require observed ancestry when head != baseline
    if (
      (operation === "git.commit_forward" || operation === "git.push_canonical") &&
      ctx.gitFacts.headCommit !== envelope.baselineCommit &&
      !ctx.gitFacts.isOrdinaryForwardFromBaseline
    ) {
      return refuse(operation, agentRole, digest, "wrong-baseline", "Git ancestry observation is not ordinary-forward");
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
  if (operation === "git.status" || operation === "git.diff" || operation === "repo.read") {
    return g.has("read") || g.has("stage") || g.has("commit_forward") || g.has("push_canonical");
  }
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

export function proofBindsOnlyToDigest(envelope: CapabilityEnvelopeV1, presence: OwnerPresencePort): boolean {
  if (!envelope.approvalProof) return false;
  const digest = envelopeDigest(envelope);
  return presence.verify(digest, envelope.approvalProof);
}
