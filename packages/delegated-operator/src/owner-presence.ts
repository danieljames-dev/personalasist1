import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { type ApprovalProofV1, DelegatedOperatorError } from "./contracts.js";
import { safeEqualHex } from "./canonical.js";

/**
 * OwnerPresencePort: binds approval to Owner presence and exact envelope digest.
 *
 * - SyntheticOwnerPresence (tests only)
 * - UnprovisionedRealOwnerPresence (fail-closed until activation)
 * - ProvisionedOwnerPresence (R6.5.1+): local HMAC material under protected
 *   approval root; Founder remains available as recovery/breakglass.
 *
 * Challenge form: `aion-owner-approve-v1|<envelopeDigest>|<utc>|<presenceId>`
 */

export interface OwnerPresencePort {
  readonly mode: "synthetic_test" | "unprovisioned_real" | "provisioned_owner";
  approveEnvelopeDigest(envelopeDigest: string, nowUtc: string): ApprovalProofV1;
  verify(envelopeDigest: string, proof: ApprovalProofV1): boolean;
}

export class SyntheticOwnerPresence implements OwnerPresencePort {
  readonly mode = "synthetic_test" as const;
  private readonly secret: Buffer;

  constructor(secret?: Buffer) {
    this.secret = secret ?? randomBytes(32);
  }

  /** Test helper only — never log this value. */
  exportSecretForTests(): Buffer {
    return Buffer.from(this.secret);
  }

  approveEnvelopeDigest(envelopeDigest: string, nowUtc: string): ApprovalProofV1 {
    if (!/^[0-9a-f]{64}$/.test(envelopeDigest)) {
      throw new DelegatedOperatorError("presence-invalid", "Envelope digest must be sha256 hex");
    }
    // Bind to exact digest; refuse arbitrary free-form bytes outside hex digest shape.
    const presenceId = randomBytes(16).toString("hex");
    const payload = `aion-owner-approve-v1|${envelopeDigest}|${nowUtc}|${presenceId}`;
    const signatureHex = createHmac("sha256", this.secret).update(payload, "utf8").digest("hex");
    return {
      kind: "synthetic_hmac_v1",
      algorithm: "hmac-sha256",
      signatureHex,
      approvedAtUtc: nowUtc,
      presenceId,
    };
  }

  verify(envelopeDigest: string, proof: ApprovalProofV1): boolean {
    if (proof.kind !== "synthetic_hmac_v1" || proof.algorithm !== "hmac-sha256") return false;
    if (!/^[0-9a-f]{64}$/.test(envelopeDigest)) return false;
    const payload = `aion-owner-approve-v1|${envelopeDigest}|${proof.approvedAtUtc}|${proof.presenceId}`;
    const expected = createHmac("sha256", this.secret).update(payload, "utf8").digest("hex");
    return safeEqualHex(expected, proof.signatureHex);
  }
}

/** Real adapter code path — always refuses until activation provisions trust. */
export class UnprovisionedRealOwnerPresence implements OwnerPresencePort {
  readonly mode = "unprovisioned_real" as const;

  approveEnvelopeDigest(_envelopeDigest: string, _nowUtc: string): ApprovalProofV1 {
    throw new DelegatedOperatorError(
      "approval-root-unprovisioned",
      "Real Owner-presence approval root is not provisioned or activated. Founder remains authoritative.",
    );
  }

  verify(_envelopeDigest: string, proof: ApprovalProofV1): boolean {
    if (proof.kind === "unprovisioned_real_v1") return false;
    return false;
  }
}

/**
 * Provisioned Owner presence (R6.5.1).
 * HMAC key is loaded from a protected path (ACL-restricted); never logged.
 * Agent processes without ACL access cannot mint approvals.
 */
export class ProvisionedOwnerPresence implements OwnerPresencePort {
  readonly mode = "provisioned_owner" as const;
  private readonly secret: Buffer;

  constructor(secret: Buffer) {
    if (!Buffer.isBuffer(secret) || secret.length < 32) {
      throw new DelegatedOperatorError(
        "approval-root-invalid",
        "Provisioned Owner presence requires a >=32-byte secret buffer",
      );
    }
    this.secret = Buffer.from(secret);
  }

  /** Load hex-encoded secret from ACL-protected file (not from caller string in production). */
  static fromKeyFile(keyPath: string): ProvisionedOwnerPresence {
    const raw = readFileSync(keyPath, "utf8").trim();
    if (!/^[0-9a-f]{64,}$/i.test(raw)) {
      throw new DelegatedOperatorError("approval-root-invalid", "Owner key file shape invalid");
    }
    return new ProvisionedOwnerPresence(Buffer.from(raw.slice(0, 64), "hex"));
  }

  approveEnvelopeDigest(envelopeDigest: string, nowUtc: string): ApprovalProofV1 {
    if (!/^[0-9a-f]{64}$/.test(envelopeDigest)) {
      throw new DelegatedOperatorError("presence-invalid", "Envelope digest must be sha256 hex");
    }
    const presenceId = randomBytes(16).toString("hex");
    const payload = `aion-owner-approve-v1|${envelopeDigest}|${nowUtc}|${presenceId}`;
    const signatureHex = createHmac("sha256", this.secret).update(payload, "utf8").digest("hex");
    return {
      kind: "provisioned_owner_hmac_v1",
      algorithm: "hmac-sha256",
      signatureHex,
      approvedAtUtc: nowUtc,
      presenceId,
    };
  }

  verify(envelopeDigest: string, proof: ApprovalProofV1): boolean {
    if (proof.kind !== "provisioned_owner_hmac_v1" || proof.algorithm !== "hmac-sha256") return false;
    if (!/^[0-9a-f]{64}$/.test(envelopeDigest)) return false;
    const payload = `aion-owner-approve-v1|${envelopeDigest}|${proof.approvedAtUtc}|${proof.presenceId}`;
    const expected = createHmac("sha256", this.secret).update(payload, "utf8").digest("hex");
    return safeEqualHex(expected, proof.signatureHex);
  }
}

export function createDefaultProductionPresence(): OwnerPresencePort {
  return new UnprovisionedRealOwnerPresence();
}
