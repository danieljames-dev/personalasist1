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
} from "./authorization.js";
import { envelopeDigest, parseCapabilityEnvelope } from "./envelope.js";
import type { OwnerPresencePort } from "./owner-presence.js";
import { UnprovisionedRealOwnerPresence } from "./owner-presence.js";
import { assertAgentLifecycle } from "./authorization.js";
import { refuseIfHighConsequence } from "./nested-gates.js";
import { ROLE_PROFILES_V1 } from "./roles.js";

export interface OperatorHostOptions {
  readonly storeDir: string;
  readonly activationMode: ActivationModeV1;
  readonly presence: OwnerPresencePort;
  readonly machineName: string;
  readonly machineRole: string;
  readonly now?: () => string;
}

/**
 * Administrative Operator Host — separate from normal AION chat/provider path.
 * Does not expose eval, public bind, or unrestricted shell.
 * ActivationMode "inactive" is the production default: real Owner UI cannot mint
 * Founder-replacing authority (presence is unprovisioned real unless synthetic tests).
 */
export class OperatorHost {
  readonly activationMode: ActivationModeV1;
  private readonly store: AuthorizationStore;
  private readonly audit: AuditLog;
  private readonly sessions: SessionRegistry;
  private readonly resume: ResumeTokenService;
  private readonly presence: OwnerPresencePort;
  private readonly machineName: string;
  private readonly machineRole: string;
  private readonly now: () => string;
  private rebootCount = new Map<string, number>();

  constructor(options: OperatorHostOptions) {
    this.activationMode = options.activationMode;
    this.store = new AuthorizationStore(options.storeDir);
    this.audit = new AuditLog(options.storeDir);
    this.sessions = new SessionRegistry();
    this.resume = new ResumeTokenService();
    this.presence = options.presence;
    this.machineName = options.machineName;
    this.machineRole = options.machineRole;
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
    // Production path must not auto-provision real approval material on construction.
    if (this.activationMode === "inactive" && !(this.presence instanceof UnprovisionedRealOwnerPresence)) {
      // allow only unprovisioned real adapter in inactive mode
      if (this.presence.mode !== "unprovisioned_real") {
        throw new DelegatedOperatorError(
          "activation-mode",
          "inactive host requires UnprovisionedRealOwnerPresence",
        );
      }
    }
  }

  getStore(): AuthorizationStore {
    return this.store;
  }

  getAudit(): AuditLog {
    return this.audit;
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
   * Owner approval entry. In inactive production mode with unprovisioned real presence, this throws.
   * Synthetic tests use activationMode synthetic_test + SyntheticOwnerPresence.
   */
  ownerAuthorize(authorizationId: string): CapabilityEnvelopeV1 {
    const rec = this.store.get(authorizationId);
    if (!rec) throw new DelegatedOperatorError("not-found", "Authorization not found");
    if (rec.lifecycle !== "PENDING_OWNER_AUTHORIZATION") {
      throw new DelegatedOperatorError("lifecycle", "Not pending Owner authorization");
    }
    const approved = attachApproval(rec.envelope, this.presence, this.now());
    const activated = this.store.activateWithProof(approved);
    this.audit.append({
      kind: "authorization.owner_result",
      authorizationId,
      envelopeDigest: activated.envelopeDigest,
      agentRole: activated.envelope.agentRole,
      operation: null,
      outcome: "AUTHORIZED",
      detail: `mode=${this.activationMode};presence=${this.presence.mode}`,
      utc: this.now(),
    });
    return activated.envelope;
  }

  ownerDeny(authorizationId: string): void {
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

  openSession(authorizationId: string, agentRole: AgentRoleV1, headCommit: string): {
    sessionId: string;
    sessionToken: string;
  } {
    const rec = this.requireActive(authorizationId);
    if (rec.envelope.agentRole !== agentRole) {
      throw new DelegatedOperatorError("role-mismatch", "Cannot open session as different role than envelope");
    }
    const ctx = this.ctx(rec.envelope, headCommit);
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

  request(sessionId: string, request: Omit<OperatorRequestV1, "requestId" | "requestedAtUtc"> & {
    highConsequenceIntent?: string;
  }, headCommit: string): OperatorDecisionV1 {
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

    // Concurrency: exclusive builder write
    if (isBuilderWriteOp(request.operation) && request.agentRole === "GROK_BUILD") {
      const lock = this.store.getWriterLock();
      const root = normalize(request.repositoryRoot);
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
          repositoryRoot: request.repositoryRoot,
          authorizationId: request.authorizationId,
          agentRole: "GROK_BUILD",
        });
      }
    }

    // CLAUDE structural write refuse even if envelope forged — re-check role profile
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

    const ctx = this.ctx(rec.envelope, headCommit);
    const decision = decideOperation(rec.envelope, request.agentRole, request.operation, ctx);
    this.auditDecision(request, decision);
    return decision;
  }

  /** Simulated admin op result for positive tests (does not run real shell). */
  executeMediatedForTests(
    sessionId: string,
    operation: OperationClassV1,
    agentRole: AgentRoleV1,
    authorizationId: string,
    repositoryRoot: string,
    headCommit: string,
  ): { decision: OperatorDecisionV1; effect: string } {
    const decision = this.request(sessionId, {
      authorizationId,
      agentRole,
      operation,
      repositoryRoot,
      args: {},
    }, headCommit);
    if (decision.outcome !== "ALLOW") return { decision, effect: "none" };
    // Mediated effects only — no model text shell.
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

  beginReboot(authorizationId: string, headCommit: string): ResumeTokenV1 {
    const rec = this.requireActive(authorizationId);
    if (!rec.envelope.rebootPolicy.allowed) {
      throw new DelegatedOperatorError("reboot-denied", "Reboot not permitted by envelope");
    }
    const ctx = this.ctx(rec.envelope, headCommit);
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
      machineName: this.machineName,
      expectedHead: headCommit,
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

  resumeAfterReboot(token: ResumeTokenV1, authorizationId: string, headCommit: string): void {
    const rec = this.store.get(authorizationId);
    if (!rec) throw new DelegatedOperatorError("not-found", "Authorization missing after reboot");
    if (rec.superseded) throw new DelegatedOperatorError("superseded", "Cannot resume superseded authorization");
    this.resume.consume(token, rec.envelope, this.machineName, headCommit);
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
    // release writer lock if held
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

  /** Markdown/CURRENT spoof must not raise authority — only store+proof does. */
  tryAuthorizeFromMarkdownStatus(_markdown: string): never {
    throw new DelegatedOperatorError(
      "markdown-not-authority",
      "CURRENT.md / handoff Markdown cannot raise delegated-operator authority",
    );
  }

  private requireActive(authorizationId: string) {
    const rec = this.store.get(authorizationId);
    if (!rec) throw new DelegatedOperatorError("not-found", "Authorization not found");
    if (rec.superseded) throw new DelegatedOperatorError("superseded", "Authorization superseded");
    if (rec.lifecycle === "PENDING_OWNER_AUTHORIZATION" || rec.lifecycle === "DENIED") {
      throw new DelegatedOperatorError("not-active", "Authorization not active");
    }
    // Ensure envelope still parses closed
    parseCapabilityEnvelope(rec.envelope);
    return rec;
  }

  private ctx(envelope: CapabilityEnvelopeV1, headCommit: string): ValidationContextV1 {
    return {
      nowUtc: this.now(),
      machineName: this.machineName,
      machineRole: this.machineRole,
      repositoryRoot: envelope.repositoryRoot,
      canonicalOrigin: envelope.canonicalOrigin,
      headCommit,
      presence: this.presence,
      isSupersededId: (id) => this.store.isSuperseded(id),
    };
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
