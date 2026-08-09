import { createHmac, randomBytes } from "node:crypto";
import { type ApprovalProofV1, DelegatedOperatorError } from "./contracts.js";
import { safeEqualHex } from "./canonical.js";

/**
 * OwnerPresencePort: future real activation binds approval to Owner presence
 * and exact envelope digest. R6.5 ships:
 * - SyntheticOwnerPresence (tests only)
 * - UnprovisionedRealOwnerPresence (real path code; always fails until activation milestone)
 *
 * Selected real-path direction (documented, NOT activated):
 * A fixed elevated consent helper that can only HMAC a Host-supplied
 * challenge of form `aion-owner-approve-v1|<envelopeDigest>|<nonce>|<exp>`
 * under secure-desktop UAC, with the HMAC key held in DPAPI for the Owner
 * interactive user and never readable by agent processes.
 *
 * Why not faked as active: R6.5 forbids provisioning a real approval root.
 * Founder remains authoritative.
 */

export interface OwnerPresencePort {
  readonly mode: "synthetic_test" | "unprovisioned_real";
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

/** Real adapter code path — always refuses until a later activation milestone provisions trust. */
export class UnprovisionedRealOwnerPresence implements OwnerPresencePort {
  readonly mode = "unprovisioned_real" as const;

  approveEnvelopeDigest(_envelopeDigest: string, _nowUtc: string): ApprovalProofV1 {
    throw new DelegatedOperatorError(
      "approval-root-unprovisioned",
      "Real Owner-presence approval root is not provisioned or activated in R6.5. Founder remains authoritative.",
    );
  }

  verify(_envelopeDigest: string, proof: ApprovalProofV1): boolean {
    if (proof.kind === "unprovisioned_real_v1") return false;
    return false;
  }
}

export function createDefaultProductionPresence(): OwnerPresencePort {
  return new UnprovisionedRealOwnerPresence();
}
