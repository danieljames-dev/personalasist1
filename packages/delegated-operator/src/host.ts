import { randomBytes } from "node:crypto";
import {
  type ActivationModeV1,
  type AgentRoleV1,
  type CapabilityEnvelopeV1,
  type OperationClassV1,
  type OperatorDecisionV1,
  type OperatorRequestV1,
  DelegatedOperatorError,
  isOperationClassV1,
} from "./contracts.js";
import { AuthorizationStore } from "./store.js";
import { AuditLog } from "./audit-log.js";
import { SessionRegistry } from "./session.js";
import { ResumeTokenService, type ResumeTokenV1 } from "./reboot.js";
import {
  attachApproval,
  decideOperation,
  isBuilderWriteOp,
  type ValidationContextV1,
  validateAuthorizedEnvelope,
  assertAgentLifecycle,
} from "./authorization.js";
import { envelopeDigest, parseCapabilityEnvelope } from "./envelope.js";
import type { OwnerPresencePort } from "./owner-presence.js";
import { UnprovisionedRealOwnerPresence } from "./owner-presence.js";
import { refuseIfHighConsequence } from "./nested-gates.js";
import { ROLE_PROFILES_V1 } from "./roles.js";
import {
  type GitFactsPort,
  type HostFactsPort,
  type RepositoryFactsPort,
  isPathUnderProtectedRoot,
  refuseIfWriteTargetsProtectedRoot,
  DEFAULT_PROTECTED_INSTALL_LAYOUT,
} from "./facts-ports.js";

export interface OperatorHostOptions {
  readonly storeDir: string;
  readonly activationMode: ActivationModeV1;
  readonly presence: OwnerPresencePort;
  /** Trusted observation ports — constructed by Host composition, not by request. */
  readonly hostFacts: HostFactsPort;
  readonly repositoryFacts: RepositoryFactsPort;
  readonly gitFacts: GitFactsPort;
  readonly now?: () => string;
}

/**
 * Administrative Operator Host — separate from normal AION chat/provider path.
 * REQUEST-SUPPLIED FACTS ARE NEVER TRUSTED OBSERVATIONS.
 */
export class OperatorHost {
  readonly activationMode: ActivationModeV1;
  private readonly store: AuthorizationStore;
  private readonly audit: AuditLog;
  private readonly sessions: SessionRegistry;
  private readonly resume: ResumeTokenService;
  private readonly presence: OwnerPresencePort;
  private readonly hostFacts: HostFactsPort;
  private readonly repositoryFacts: RepositoryFactsPort;
  private readonly gitFacts: GitFactsPort;
  private readonly now: () => string;
  private rebootCount = new Map<string, number>();
  /** Pending approval challenges: authorizationId -> { digest, nonce } */
  private readonly approvalChallenges = new Map<string, { digest: string; nonce: string }>();

  constructor(options: OperatorHostOptions) {
    this.activationMode = options.activationMode;
    this.store = new AuthorizationStore(options.storeDir);
    this.audit = new AuditLog(options.storeDir);
    this.sessions = new SessionRegistry();
    this.resume = new ResumeTokenService();
    this.presence = options.presence;
    this.hostFacts = options.hostFacts;
    this.repositoryFacts = options.repositoryFacts;
    this.gitFacts = options.gitFacts;
    this.now = options.now ?? (() => new Date().toISOString());

    if (this.activationMode === "inactive" && this.presence.mode === "synthetic_test") {
      throw new DelegatedOperatorError(
        "activation-mode",
        "Synthetic Owner presence cannot be used when activationMode is inactive",
      );
    }
    if (this.activationMode === "synthetic_test" && this.presence.mode !== "synthetic_test") {
      throw new DelegatedOperatorError(
        "activation-mode",
        "synthetic_test host requires SyntheticOwnerPresence",
      );
    }
    if (this.activationMode === "inactive" && !(this.presence instanceof UnprovisionedRealOwnerPresence)) {
      if (this.presence.mode !== "unprovisioned_real") {
        throw new DelegatedOperatorError(
          "activation-mode",
          "inactive host requires UnprovisionedRealOwnerPresence",
        );
      }
    }
    if (this.activationMode === "activated" && this.presence.mode !== "provisioned_owner") {
      throw new DelegatedOperatorError(
        "activation-mode",
        "activated host requires ProvisionedOwnerPresence",
      );
    }
    if (this.activationMode === "activated" && this.presence.mode === "synthetic_test") {
      throw new DelegatedOperatorError(
        "activation-mode",
        "Synthetic Owner presence cannot be used when activationMode is activated",
      );
    }
  }

  getStore(): AuthorizationStore {
    return this.store;
  }

  getAudit(): AuditLog {
    return this.audit;
  }

  /** Observe trusted host facts (for UI/tests). */
  observeHost() {
    return this.hostFacts.observe();
  }

  observeRepo() {
    return this.repositoryFacts.observeBoundRepository();
  }

  submitPending(envelope: CapabilityEnvelopeV1): void {
    const record = this.store.putPending(envelope);
    this.audit.append({
      kind: "authorization.requested",
      authorizationId: record.envelope.authorizationId,
      envelopeDigest: record.envelopeDigest,
      agentRole: record.envelope.agentRole,
      operation: null,
      outcome: "PENDING",
      detail: `directive=${record.envelope.directiveId}`,
      utc: this.now(),
    });
  }

  /**
   * Create approval challenge for UI render: binds exact digest + one-time nonce.
   */
  beginOwnerApprovalChallenge(authorizationId: string): { digest: string; nonce: string } {
    const rec = this.store.get(authorizationId);
    if (!rec) throw new DelegatedOperatorError("not-found", "Authorization not found");
    if (rec.lifecycle !== "PENDING_OWNER_AUTHORIZATION") {
      throw new DelegatedOperatorError("lifecycle", "Not pending Owner authorization");
    }
    const digest = envelopeDigest(rec.envelope);
    const nonce = randomBytes(16).toString("hex");
    this.approvalChallenges.set(authorizationId, { digest, nonce });
    return { digest, nonce };
  }

  /**
   * Owner approval bound to exact displayed digest + one-time nonce (M-6 / R6.5-R2).
   * authorizationId alone is never sufficient. No compatibility overload.
   */
  ownerAuthorize(
    authorizationId: string,
    expectedDigest: string,
    approvalNonce: string,
  ): CapabilityEnvelopeV1 {
    if (typeof expectedDigest !== "string" || expectedDigest.length === 0) {
      throw new DelegatedOperatorError("approval-digest-required", "Owner approval requires exact envelope digest");
    }
    if (typeof approvalNonce !== "string" || approvalNonce.length === 0) {
      throw new DelegatedOperatorError("approval-nonce-required", "Owner approval requires one-time approval nonce");
    }
    const rec = this.store.get(authorizationId);
    if (!rec) throw new DelegatedOperatorError("not-found", "Authorization not found");
    if (rec.lifecycle !== "PENDING_OWNER_AUTHORIZATION") {
      throw new DelegatedOperatorError("lifecycle", "Not pending Owner authorization");
    }
    const recomputed = envelopeDigest(rec.envelope);
    const challenge = this.approvalChallenges.get(authorizationId);
    if (!challenge) {
      throw new DelegatedOperatorError("approval-nonce", "No approval challenge; render/bind digest first");
    }
    if (approvalNonce !== challenge.nonce) {
      throw new DelegatedOperatorError("approval-nonce", "Stale or invalid approval nonce");
    }
    // Consume nonce before activation (single-use even if later steps fail)
    this.approvalChallenges.delete(authorizationId);
    if (expectedDigest !== challenge.digest || expectedDigest !== recomputed) {
      throw new DelegatedOperatorError(
        "approval-digest-mismatch",
        "Envelope digest changed since display or submitted digest mismatch",
      );
    }

    const approved = attachApproval(rec.envelope, this.presence, this.now());
    if (this.store.get(authorizationId)?.lifecycle === "AUTHORIZED") {
      throw new DelegatedOperatorError("duplicate-approval", "Already authorized");
    }
    const activated = this.store.activateWithProof(approved);
    this.audit.append({
      kind: "authorization.owner_result",
      authorizationId,
      envelopeDigest: activated.envelopeDigest,
      agentRole: activated.envelope.agentRole,
      operation: null,
      outcome: "AUTHORIZED",
      detail: `mode=${this.activationMode};presence=${this.presence.mode};digestBound=true;nonceConsumed=true`,
      utc: this.now(),
    });
    return activated.envelope;
  }

  ownerDeny(authorizationId: string): void {
    this.approvalChallenges.delete(authorizationId);
    this.store.setLifecycle(authorizationId, "DENIED");
    this.audit.append({
      kind: "authorization.owner_result",
      authorizationId,
      envelopeDigest: null,
      agentRole: null,
      operation: null,
      outcome: "DENIED",
      detail: "Owner denied",
      utc: this.now(),
    });
  }

  openSession(authorizationId: string, agentRole: AgentRoleV1): {
    sessionId: string;
    sessionToken: string;
  } {
    const rec = this.requireActive(authorizationId);
    if (rec.envelope.agentRole !== agentRole) {
      throw new DelegatedOperatorError("role-mismatch", "Cannot open session as different role than envelope");
    }
    const ctx = this.buildValidationContext(rec.envelope);
    const { digest } = validateAuthorizedEnvelope(rec.envelope, ctx);
    if (rec.lifecycle === "AUTHORIZED") {
      assertAgentLifecycle("AUTHORIZED", "RUNNING");
      this.store.setLifecycle(authorizationId, "RUNNING");
      this.audit.append({
        kind: "lifecycle",
        authorizationId,
        envelopeDigest: digest,
        agentRole,
        operation: null,
        outcome: "RUNNING",
        detail: "session open",
        utc: this.now(),
      });
    }
    return this.sessions.issue({
      authorizationId,
      agentRole,
      envelopeDigest: digest,
      expiresAtUtc: rec.envelope.expiresAtUtc,
    });
  }

  bindSession(sessionId: string, sessionToken: string, agentRole: AgentRoleV1) {
    return this.sessions.bind(sessionId, sessionToken, agentRole, this.now());
  }

  /**
   * request.repositoryRoot is INTENT only; observations come from ports.
   * headCommit parameter is IGNORED (removed from trust surface) — kept optional for compile
   * migration of tests calling with 3 args; never used as observation.
   */
  request(
    sessionId: string,
    request: Omit<OperatorRequestV1, "requestId" | "requestedAtUtc"> & {
      highConsequenceIntent?: string;
    },
    _ignoredCallerHeadCommit?: string,
  ): OperatorDecisionV1 {
    void _ignoredCallerHeadCommit;
    if (!isOperationClassV1(request.operation)) {
      return {
        outcome: "REFUSE",
        reasonCode: "unknown-operation",
        reason: "Unknown operation class",
        envelopeDigest: null,
        operation: "repo.read",
        agentRole: request.agentRole,
      };
    }
    if (request.highConsequenceIntent) {
      const nested = refuseIfHighConsequence(request.highConsequenceIntent);
      if (nested) {
        this.audit.append({
          kind: "operation",
          authorizationId: request.authorizationId,
          envelopeDigest: null,
          agentRole: request.agentRole,
          operation: request.operation,
          outcome: "REFUSE",
          detail: `nested-gate intent=${request.highConsequenceIntent}`,
          utc: this.now(),
        });
        return nested;
      }
    }

    // M-4: refuse write paths targeting protected install roots
    try {
      refuseIfWriteTargetsProtectedRoot(request.args ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "protected";
      const decision: OperatorDecisionV1 = {
        outcome: "REFUSE",
        reasonCode: "protected-install-root",
        reason: message,
        envelopeDigest: null,
        operation: request.operation,
        agentRole: request.agentRole,
      };
      this.auditDecision(request, decision);
      return decision;
    }
    if (isBuilderWriteOp(request.operation) || request.operation === "powershell.repo_operation") {
      const joined = JSON.stringify(request.args ?? {});
      if (
        isPathUnderProtectedRoot(joined) ||
        /Program Files\\AION\\ElevatedOperatorBroker|ProgramData\\AION\\ElevatedOperatorBroker/i.test(joined)
      ) {
        const decision: OperatorDecisionV1 = {
          outcome: "REFUSE",
          reasonCode: "protected-install-root",
          reason: "Write-capable op targets protected broker install/state root",
          envelopeDigest: null,
          operation: request.operation,
          agentRole: request.agentRole,
        };
        this.auditDecision(request, decision);
        return decision;
      }
    }

    const bound = this.sessions.getBound(sessionId);
    if (!bound) {
      return {
        outcome: "REFUSE",
        reasonCode: "session",
        reason: "Session not bound in Host",
        envelopeDigest: null,
        operation: request.operation,
        agentRole: request.agentRole,
      };
    }
    if (bound.authorizationId !== request.authorizationId || bound.agentRole !== request.agentRole) {
      return {
        outcome: "REFUSE",
        reasonCode: "session-mismatch",
        reason: "Session does not match request identity",
        envelopeDigest: null,
        operation: request.operation,
        agentRole: request.agentRole,
      };
    }

    const rec = this.requireActive(request.authorizationId);
    if (rec.lifecycle !== "RUNNING" && rec.lifecycle !== "REBOOT_PENDING") {
      return {
        outcome: "REFUSE",
        reasonCode: "lifecycle",
        reason: `Lifecycle ${rec.lifecycle} does not allow operations`,
        envelopeDigest: rec.envelopeDigest,
        operation: request.operation,
        agentRole: request.agentRole,
      };
    }

    // Intent vs observation: request.repositoryRoot must match observed root if provided
    const repoObs = this.repositoryFacts.observeBoundRepository();
    if (normalize(request.repositoryRoot) !== normalize(repoObs.repositoryRoot)) {
      const decision: OperatorDecisionV1 = {
        outcome: "REFUSE",
        reasonCode: "wrong-repo",
        reason: "Request repository intent does not match host-observed repository root",
        envelopeDigest: rec.envelopeDigest,
        operation: request.operation,
        agentRole: request.agentRole,
      };
      this.auditDecision(request, decision);
      return decision;
    }

    if (isBuilderWriteOp(request.operation) && request.agentRole === "GROK_BUILD") {
      const lock = this.store.getWriterLock();
      const root = normalize(repoObs.repositoryRoot);
      if (lock && normalize(lock.repositoryRoot) === root && lock.authorizationId !== request.authorizationId) {
        const decision: OperatorDecisionV1 = {
          outcome: "REFUSE",
          reasonCode: "writer-conflict",
          reason: "Another builder holds write ownership for this repository",
          envelopeDigest: rec.envelopeDigest,
          operation: request.operation,
          agentRole: request.agentRole,
        };
        this.auditDecision(request, decision);
        return decision;
      }
      if (!lock || normalize(lock.repositoryRoot) !== root) {
        this.store.setWriterLock({
          repositoryRoot: repoObs.repositoryRoot,
          authorizationId: request.authorizationId,
          agentRole: "GROK_BUILD",
        });
      }
    }

    if (request.agentRole === "CLAUDE_AUDITOR" && ROLE_PROFILES_V1.CLAUDE_AUDITOR.structuralDenies.has(request.operation)) {
      const decision: OperatorDecisionV1 = {
        outcome: "REFUSE",
        reasonCode: "role-structural-deny",
        reason: "CLAUDE_AUDITOR cannot perform write/commit/push operations",
        envelopeDigest: rec.envelopeDigest,
        operation: request.operation,
        agentRole: request.agentRole,
      };
      this.auditDecision(request, decision);
      return decision;
    }

    let ctx: ValidationContextV1;
    try {
      ctx = this.buildValidationContext(rec.envelope);
    } catch (error) {
      const message = error instanceof Error ? error.message : "facts unavailable";
      const code = error instanceof DelegatedOperatorError ? error.code : "facts-unavailable";
      const decision: OperatorDecisionV1 = {
        outcome: "REFUSE",
        reasonCode: code,
        reason: message,
        envelopeDigest: rec.envelopeDigest,
        operation: request.operation,
        agentRole: request.agentRole,
      };
      this.auditDecision(request, decision);
      return decision;
    }

    const decision = decideOperation(rec.envelope, request.agentRole, request.operation, ctx);
    this.auditDecision(request, decision);
    return decision;
  }

  executeMediatedForTests(
    sessionId: string,
    operation: OperationClassV1,
    agentRole: AgentRoleV1,
    authorizationId: string,
    repositoryRoot: string,
  ): { decision: OperatorDecisionV1; effect: string } {
    const decision = this.request(sessionId, {
      authorizationId,
      agentRole,
      operation,
      repositoryRoot,
      args: {},
    });
    if (decision.outcome !== "ALLOW") return { decision, effect: "none" };
    switch (operation) {
      case "repo.read":
      case "git.status":
      case "git.diff":
        return { decision, effect: "read-ok" };
      case "repo.edit":
        return { decision, effect: "edit-ok" };
      case "test.run":
      case "npm.run":
      case "node.run":
      case "docker.test":
        return { decision, effect: "test-ok" };
      case "git.stage":
        return { decision, effect: "stage-ok" };
      case "git.commit_forward":
        return { decision, effect: "commit-ok" };
      case "git.push_canonical":
        return { decision, effect: "push-ok" };
      case "temp.create":
        return { decision, effect: "temp-ok" };
      case "handoff.write":
        return { decision, effect: "handoff-ok" };
      case "host.read":
        return { decision, effect: "host-read-ok" };
      default:
        return { decision, effect: "mediated-ok" };
    }
  }

  beginReboot(authorizationId: string): ResumeTokenV1 {
    const rec = this.requireActive(authorizationId);
    if (!rec.envelope.rebootPolicy.allowed) {
      throw new DelegatedOperatorError("reboot-denied", "Reboot not permitted by envelope");
    }
    const ctx = this.buildValidationContext(rec.envelope);
    validateAuthorizedEnvelope(rec.envelope, ctx);
    if (rec.lifecycle !== "RUNNING") {
      throw new DelegatedOperatorError("lifecycle", "Must be RUNNING to reboot");
    }
    assertAgentLifecycle("RUNNING", "REBOOT_PENDING");
    const next = (this.rebootCount.get(authorizationId) ?? 0) + 1;
    this.rebootCount.set(authorizationId, next);
    this.store.setLifecycle(authorizationId, "REBOOT_PENDING");
    const token = this.resume.issue({
      envelope: rec.envelope,
      machineName: this.hostFacts.observe().machineName,
      expectedHead: ctx.gitFacts.headCommit,
      rebootIndex: next,
    });
    this.audit.append({
      kind: "reboot",
      authorizationId,
      envelopeDigest: rec.envelopeDigest,
      agentRole: rec.envelope.agentRole,
      operation: "host.reboot",
      outcome: "REBOOT_PENDING",
      detail: `tokenId=${token.tokenId};index=${next}`,
      utc: this.now(),
    });
    return token;
  }

  resumeAfterReboot(token: ResumeTokenV1, authorizationId: string): void {
    const rec = this.store.get(authorizationId);
    if (!rec) throw new DelegatedOperatorError("not-found", "Authorization missing after reboot");
    if (rec.superseded) throw new DelegatedOperatorError("superseded", "Cannot resume superseded authorization");
    const host = this.hostFacts.observe();
    const git = this.gitFacts.observe(rec.envelope.baselineCommit, rec.envelope.allowOrdinaryForwardCommits);
    this.resume.consume(token, rec.envelope, host.machineName, git.headCommit);
    this.store.setLifecycle(authorizationId, "RUNNING");
    this.audit.append({
      kind: "reboot",
      authorizationId,
      envelopeDigest: rec.envelopeDigest,
      agentRole: rec.envelope.agentRole,
      operation: "host.reboot",
      outcome: "RUNNING",
      detail: `resumed tokenId=${token.tokenId}`,
      utc: this.now(),
    });
  }

  complete(authorizationId: string): void {
    const rec = this.requireActive(authorizationId);
    assertAgentLifecycle("RUNNING", "AWAITING_REVIEW");
    if (rec.lifecycle !== "RUNNING") {
      throw new DelegatedOperatorError("lifecycle", "Must be RUNNING to complete");
    }
    this.store.setLifecycle(authorizationId, "AWAITING_REVIEW");
    const lock = this.store.getWriterLock();
    if (lock?.authorizationId === authorizationId) this.store.setWriterLock(null);
    this.audit.append({
      kind: "lifecycle",
      authorizationId,
      envelopeDigest: rec.envelopeDigest,
      agentRole: rec.envelope.agentRole,
      operation: null,
      outcome: "AWAITING_REVIEW",
      detail: "complete",
      utc: this.now(),
    });
  }

  tryAuthorizeFromMarkdownStatus(_markdown: string): never {
    throw new DelegatedOperatorError(
      "markdown-not-authority",
      "CURRENT.md / handoff Markdown cannot raise delegated-operator authority",
    );
  }

  private buildValidationContext(envelope: CapabilityEnvelopeV1): ValidationContextV1 {
    let host;
    let repo;
    let git;
    try {
      host = this.hostFacts.observe();
      repo = this.repositoryFacts.observeBoundRepository();
      git = this.gitFacts.observe(envelope.baselineCommit, envelope.allowOrdinaryForwardCommits);
    } catch (error) {
      if (error instanceof DelegatedOperatorError) throw error;
      throw new DelegatedOperatorError("facts-unavailable", "Trusted host/repo/git facts unavailable");
    }
    return {
      nowUtc: this.now(),
      hostFacts: host,
      repoFacts: repo,
      gitFacts: git,
      presence: this.presence,
      isSupersededId: (id) => this.store.isSuperseded(id),
    };
  }

  private requireActive(authorizationId: string) {
    const rec = this.store.get(authorizationId);
    if (!rec) throw new DelegatedOperatorError("not-found", "Authorization not found");
    if (rec.superseded) throw new DelegatedOperatorError("superseded", "Authorization superseded");
    if (rec.lifecycle === "PENDING_OWNER_AUTHORIZATION" || rec.lifecycle === "DENIED") {
      throw new DelegatedOperatorError("not-active", "Authorization not active");
    }
    parseCapabilityEnvelope(rec.envelope);
    return rec;
  }

  private auditDecision(
    request: { authorizationId: string; agentRole: AgentRoleV1; operation: OperationClassV1 },
    decision: OperatorDecisionV1,
  ): void {
    this.audit.append({
      kind: "operation",
      authorizationId: request.authorizationId,
      envelopeDigest: decision.envelopeDigest,
      agentRole: request.agentRole,
      operation: request.operation,
      outcome: decision.outcome,
      detail: `${decision.reasonCode}:${decision.reason}`.slice(0, 500),
      utc: this.now(),
    });
  }
}

function normalize(p: string): string {
  return p.replace(/\//g, "\\").replace(/\\+$/u, "").toLowerCase();
}

export function newAuthorizationId(): string {
  return randomBytes(16).toString("hex");
}

void DEFAULT_PROTECTED_INSTALL_LAYOUT;
