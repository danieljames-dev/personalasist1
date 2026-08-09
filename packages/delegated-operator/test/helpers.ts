import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  OperatorHost,
  SyntheticOwnerPresence,
  UnprovisionedRealOwnerPresence,
  buildUnsignedEnvelope,
  type AgentRoleV1,
  type OperationClassV1,
  type CapabilityEnvelopeV1,
} from "../src/index.js";

export const ORIGIN = "https://github.com/danieljames-dev/personalasist1.git";
export const BASELINE = "13e305fe9e659beaf6a42e517ab646a40df220d7";
export const MACHINE = "DESKTOP-INLAQJQ";
export const ROLE = "DESKTOP TARGET CANDIDATE / NON-PRIMARY";

export function tempStore(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "aion-dop-"));
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

export function syntheticHost(dir: string, presence?: SyntheticOwnerPresence): {
  host: OperatorHost;
  presence: SyntheticOwnerPresence;
} {
  const p = presence ?? new SyntheticOwnerPresence();
  const host = new OperatorHost({
    storeDir: dir,
    activationMode: "synthetic_test",
    presence: p,
    machineName: MACHINE,
    machineRole: ROLE,
  });
  return { host, presence: p };
}

export function inactiveHost(dir: string): OperatorHost {
  return new OperatorHost({
    storeDir: dir,
    activationMode: "inactive",
    presence: new UnprovisionedRealOwnerPresence(),
    machineName: MACHINE,
    machineRole: ROLE,
  });
}

export function sampleEnvelope(
  role: AgentRoleV1,
  ops: readonly OperationClassV1[],
  extra?: Partial<{ repositoryRoot: string; baselineCommit: string; machineName: string; expiresAtUtc: string; allowReboot: boolean; spend: number }>,
): CapabilityEnvelopeV1 {
  const now = new Date();
  const exp = new Date(now.getTime() + 60 * 60 * 1000);
  const args: Parameters<typeof buildUnsignedEnvelope>[0] = {
    directiveId: "AION-V1.3-R6.5-DELEGATED-OPERATOR-CONTROL-PLANE",
    agentRole: role,
    repositoryRoot: extra?.repositoryRoot ?? "C:\\AION-HQ",
    canonicalOrigin: ORIGIN,
    baselineCommit: extra?.baselineCommit ?? BASELINE,
    machineRole: ROLE,
    machineName: extra?.machineName ?? MACHINE,
    authorizedOperations: ops,
    issuedAtUtc: now.toISOString(),
    expiresAtUtc: extra?.expiresAtUtc ?? exp.toISOString(),
  };
  if (extra?.allowReboot !== undefined) args.allowReboot = extra.allowReboot;
  if (extra?.spend !== undefined) args.spendCeilingCents = extra.spend;
  return buildUnsignedEnvelope(args);
}

export function approveAndRun(
  host: OperatorHost,
  envelope: CapabilityEnvelopeV1,
  head = BASELINE,
): { authorizationId: string; sessionId: string } {
  host.submitPending(envelope);
  const approved = host.ownerAuthorize(envelope.authorizationId);
  const opened = host.openSession(approved.authorizationId, approved.agentRole, head);
  host.bindSession(opened.sessionId, opened.sessionToken, approved.agentRole);
  return { authorizationId: approved.authorizationId, sessionId: opened.sessionId };
}
