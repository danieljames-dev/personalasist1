import { createHmac, randomBytes } from "node:crypto";
import { type AgentRoleV1, DelegatedOperatorError } from "./contracts.js";
import { safeEqualHex } from "./canonical.js";

/**
 * One-shot session binding: Host holds a process-local session table.
 * Tokens are HMAC'd and not reusable after consume/bind.
 * A copied stale token cannot open a new session with a different role.
 */

export interface AgentSessionV1 {
  readonly sessionId: string;
  readonly authorizationId: string;
  readonly agentRole: AgentRoleV1;
  readonly envelopeDigest: string;
  readonly expiresAtUtc: string;
}

export class SessionRegistry {
  private readonly secret: Buffer;
  private readonly sessions = new Map<string, AgentSessionV1 & { used: boolean }>();

  constructor(secret?: Buffer) {
    this.secret = secret ?? randomBytes(32);
  }

  issue(input: {
    authorizationId: string;
    agentRole: AgentRoleV1;
    envelopeDigest: string;
    expiresAtUtc: string;
  }): { sessionId: string; sessionToken: string } {
    const sessionId = randomBytes(16).toString("hex");
    const session: AgentSessionV1 & { used: boolean } = {
      sessionId,
      authorizationId: input.authorizationId,
      agentRole: input.agentRole,
      envelopeDigest: input.envelopeDigest,
      expiresAtUtc: input.expiresAtUtc,
      used: false,
    };
    this.sessions.set(sessionId, session);
    const sessionToken = this.mac(sessionId, input.authorizationId, input.agentRole, input.envelopeDigest);
    return { sessionId, sessionToken };
  }

  bind(sessionId: string, sessionToken: string, expectedRole: AgentRoleV1, nowUtc: string): AgentSessionV1 {
    const session = this.sessions.get(sessionId);
    if (!session) throw new DelegatedOperatorError("session-unknown", "Unknown session");
    if (session.used) throw new DelegatedOperatorError("session-replay", "Session token already bound/consumed pattern");
    if (Date.parse(nowUtc) >= Date.parse(session.expiresAtUtc)) {
      throw new DelegatedOperatorError("session-expired", "Session expired");
    }
    if (session.agentRole !== expectedRole) {
      throw new DelegatedOperatorError("session-role", "Session role mismatch (cannot swap CLAUDE to GROK)");
    }
    const expected = this.mac(sessionId, session.authorizationId, session.agentRole, session.envelopeDigest);
    if (!safeEqualHex(expected, sessionToken)) {
      throw new DelegatedOperatorError("session-token", "Invalid session token");
    }
    session.used = true;
    // After bind, allow continued use via sessionId only inside Host process map —
    // re-bind with same token fails.
    return {
      sessionId: session.sessionId,
      authorizationId: session.authorizationId,
      agentRole: session.agentRole,
      envelopeDigest: session.envelopeDigest,
      expiresAtUtc: session.expiresAtUtc,
    };
  }

  /** In-process lookup after bind (token not required again; Host-memory only). */
  getBound(sessionId: string): AgentSessionV1 | undefined {
    const s = this.sessions.get(sessionId);
    if (!s || !s.used) return undefined;
    return s;
  }

  private mac(sessionId: string, authorizationId: string, role: AgentRoleV1, digest: string): string {
    return createHmac("sha256", this.secret)
      .update(`aion-session-v1|${sessionId}|${authorizationId}|${role}|${digest}`, "utf8")
      .digest("hex");
  }
}
