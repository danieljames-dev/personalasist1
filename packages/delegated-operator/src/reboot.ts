import { createHmac, randomBytes } from "node:crypto";
import {
  type AgentRoleV1,
  type CapabilityEnvelopeV1,
  DelegatedOperatorError,
} from "./contracts.js";
import { envelopeDigest } from "./envelope.js";
import { safeEqualHex } from "./canonical.js";

export interface ResumeTokenV1 {
  readonly tokenId: string;
  readonly authorizationId: string;
  readonly envelopeDigest: string;
  readonly machineName: string;
  readonly repositoryRoot: string;
  readonly expectedHead: string;
  readonly agentRole: AgentRoleV1;
  readonly lifecycle: "REBOOT_PENDING";
  readonly rebootIndex: number;
  readonly signatureHex: string;
}

export class ResumeTokenService {
  private readonly secret: Buffer;
  private readonly consumed = new Set<string>();

  constructor(secret?: Buffer) {
    this.secret = secret ?? randomBytes(32);
  }

  issue(input: {
    envelope: CapabilityEnvelopeV1;
    machineName: string;
    expectedHead: string;
    rebootIndex: number;
  }): ResumeTokenV1 {
    if (!input.envelope.rebootPolicy.allowed) {
      throw new DelegatedOperatorError("reboot-denied", "Envelope rebootPolicy.allowed is false");
    }
    if (input.rebootIndex < 1 || input.rebootIndex > input.envelope.rebootPolicy.maxReboots) {
      throw new DelegatedOperatorError("reboot-limit", "Reboot index exceeds maxReboots");
    }
    const digest = envelopeDigest(input.envelope);
    const tokenId = randomBytes(12).toString("hex");
    const body = {
      tokenId,
      authorizationId: input.envelope.authorizationId,
      envelopeDigest: digest,
      machineName: input.machineName,
      repositoryRoot: input.envelope.repositoryRoot,
      expectedHead: input.expectedHead,
      agentRole: input.envelope.agentRole,
      lifecycle: "REBOOT_PENDING" as const,
      rebootIndex: input.rebootIndex,
    };
    const signatureHex = createHmac("sha256", this.secret)
      .update(JSON.stringify(body), "utf8")
      .digest("hex");
    return { ...body, signatureHex };
  }

  consume(
    token: ResumeTokenV1,
    envelope: CapabilityEnvelopeV1,
    machineName: string,
    head: string,
  ): void {
    if (this.consumed.has(token.tokenId) && envelope.rebootPolicy.oneTimeResumeTokens) {
      throw new DelegatedOperatorError("resume-replay", "Resume token already consumed");
    }
    const digest = envelopeDigest(envelope);
    if (token.envelopeDigest !== digest) {
      throw new DelegatedOperatorError("resume-digest", "Resume token envelope digest mismatch");
    }
    if (token.authorizationId !== envelope.authorizationId) {
      throw new DelegatedOperatorError("resume-auth", "Resume token authorization mismatch");
    }
    if (token.machineName !== machineName || envelope.machineName !== machineName) {
      throw new DelegatedOperatorError("resume-machine", "Wrong machine for resume");
    }
    if (token.repositoryRoot !== envelope.repositoryRoot) {
      throw new DelegatedOperatorError("resume-repo", "Repository mismatch on resume");
    }
    if (token.expectedHead !== head) {
      throw new DelegatedOperatorError("resume-head", "Git HEAD mismatch on resume");
    }
    if (token.agentRole !== envelope.agentRole) {
      throw new DelegatedOperatorError("resume-role", "Role mismatch on resume");
    }
    if (token.lifecycle !== "REBOOT_PENDING") {
      throw new DelegatedOperatorError("resume-lifecycle", "Invalid resume lifecycle");
    }
    const body = {
      tokenId: token.tokenId,
      authorizationId: token.authorizationId,
      envelopeDigest: token.envelopeDigest,
      machineName: token.machineName,
      repositoryRoot: token.repositoryRoot,
      expectedHead: token.expectedHead,
      agentRole: token.agentRole,
      lifecycle: token.lifecycle,
      rebootIndex: token.rebootIndex,
    };
    const expected = createHmac("sha256", this.secret).update(JSON.stringify(body), "utf8").digest("hex");
    if (!safeEqualHex(expected, token.signatureHex)) {
      throw new DelegatedOperatorError("resume-sig", "Resume token signature invalid");
    }
    if (envelope.rebootPolicy.oneTimeResumeTokens) {
      this.consumed.add(token.tokenId);
    }
  }
}
