import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  OperatorHost,
  SyntheticOwnerPresence,
  UnprovisionedRealOwnerPresence,
  buildUnsignedEnvelope,
  StaticHostFactsPort,
  StaticRepositoryFactsPort,
  StaticGitFactsPort,
  type AgentRoleV1,
  type OperationClassV1,
  type CapabilityEnvelopeV1,
  type GitFactsPort,
  type HostFactsPort,
  type RepositoryFactsPort,
} from "../src/index.js";

export const ORIGIN = "https://github.com/danieljames-dev/personalasist1.git";
export const BASELINE = "13e305fe9e659beaf6a42e517ab646a40df220d7";
export const MACHINE = "DESKTOP-INLAQJQ";
export const ROLE = "DESKTOP TARGET CANDIDATE / NON-PRIMARY";
export const REPO = "C:\\AION-HQ";

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

export function defaultFacts(overrides?: {
  machineName?: string;
  machineRole?: string;
  repositoryRoot?: string;
  canonicalOrigin?: string;
  headCommit?: string;
  branch?: string;
  forwardFrom?: ReadonlyMap<string, boolean>;
}): {
  hostFacts: HostFactsPort;
  repositoryFacts: RepositoryFactsPort;
  gitFacts: GitFactsPort;
} {
  const machineName = overrides?.machineName ?? MACHINE;
  const machineRole = overrides?.machineRole ?? ROLE;
  const repositoryRoot = overrides?.repositoryRoot ?? REPO;
  const canonicalOrigin = overrides?.canonicalOrigin ?? ORIGIN;
  const headCommit = overrides?.headCommit ?? BASELINE;
  const branch = overrides?.branch ?? "main";
  const gitBase = {
    repositoryRoot,
    headCommit,
    branch,
    canonicalOrigin,
    originMainCommit: headCommit,
    workingTreeClean: true as const,
  };
  return {
    hostFacts: new StaticHostFactsPort({ machineName, machineRole }),
    repositoryFacts: new StaticRepositoryFactsPort({
      repositoryRoot,
      canonicalOrigin,
      branch,
      headCommit,
    }),
    gitFacts: new StaticGitFactsPort(
      overrides?.forwardFrom
        ? { ...gitBase, forwardFrom: overrides.forwardFrom }
        : gitBase,
    ),
  };
}

export function syntheticHost(
  dir: string,
  presence?: SyntheticOwnerPresence,
  factOverrides?: Parameters<typeof defaultFacts>[0],
): {
  host: OperatorHost;
  presence: SyntheticOwnerPresence;
} {
  const p = presence ?? new SyntheticOwnerPresence();
  const facts = defaultFacts(factOverrides);
  const host = new OperatorHost({
    storeDir: dir,
    activationMode: "synthetic_test",
    presence: p,
    ...facts,
  });
  return { host, presence: p };
}

export function inactiveHost(dir: string): OperatorHost {
  return new OperatorHost({
    storeDir: dir,
    activationMode: "inactive",
    presence: new UnprovisionedRealOwnerPresence(),
    ...defaultFacts(),
  });
}

export function sampleEnvelope(
  role: AgentRoleV1,
  ops: readonly OperationClassV1[],
  extra?: Partial<{
    repositoryRoot: string;
    baselineCommit: string;
    machineName: string;
    expiresAtUtc: string;
    issuedAtUtc: string;
    allowReboot: boolean;
    spend: number;
    allowOrdinaryForwardCommits: boolean;
    canonicalOrigin: string;
  }>,
): CapabilityEnvelopeV1 {
  const now = new Date();
  const exp = new Date(now.getTime() + 60 * 60 * 1000);
  const args: Parameters<typeof buildUnsignedEnvelope>[0] = {
    directiveId: "AION-V1.3-R6.5-DELEGATED-OPERATOR-CONTROL-PLANE",
    agentRole: role,
    repositoryRoot: extra?.repositoryRoot ?? REPO,
    canonicalOrigin: extra?.canonicalOrigin ?? ORIGIN,
    baselineCommit: extra?.baselineCommit ?? BASELINE,
    machineRole: ROLE,
    machineName: extra?.machineName ?? MACHINE,
    authorizedOperations: ops,
    issuedAtUtc: extra?.issuedAtUtc ?? now.toISOString(),
    expiresAtUtc: extra?.expiresAtUtc ?? exp.toISOString(),
  };
  if (extra?.allowReboot !== undefined) args.allowReboot = extra.allowReboot;
  if (extra?.spend !== undefined) args.spendCeilingCents = extra.spend;
  const env = buildUnsignedEnvelope(args);
  if (extra?.allowOrdinaryForwardCommits === false) {
    return { ...env, allowOrdinaryForwardCommits: false };
  }
  return env;
}

/** Issued and expired both in the past (issued < expires < now) for expiry tests. */
export function expiredEnvelope(
  role: AgentRoleV1,
  ops: readonly OperationClassV1[],
): CapabilityEnvelopeV1 {
  const issued = new Date(Date.now() - 120_000);
  const expires = new Date(Date.now() - 60_000);
  return sampleEnvelope(role, ops, {
    issuedAtUtc: issued.toISOString(),
    expiresAtUtc: expires.toISOString(),
  });
}

export function approveAndRun(
  host: OperatorHost,
  envelope: CapabilityEnvelopeV1,
): { authorizationId: string; sessionId: string } {
  host.submitPending(envelope);
  const approved = host.ownerAuthorize(envelope.authorizationId);
  const opened = host.openSession(approved.authorizationId, approved.agentRole);
  host.bindSession(opened.sessionId, opened.sessionToken, approved.agentRole);
  return { authorizationId: approved.authorizationId, sessionId: opened.sessionId };
}
