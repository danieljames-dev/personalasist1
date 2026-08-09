/**
 * Installed-instance composition (R6.5.2).
 * Private trust state is NOT readable by ordinary interactive user.
 * Owner approval proofs are minted only by the broker after elevated helper inbox.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ElevatedOperatorBroker } from "./elevated-broker.js";
import { OperatorHost } from "./host.js";
import { OwnerAuthorizationUi } from "./owner-ui.js";
import { ProvisionedOwnerPresence } from "./owner-presence.js";
import {
  DEFAULT_PROTECTED_INSTALL_LAYOUT,
  ExecGitFactsPort,
  FixedRepositoryFactsPort,
  ManifestBrokerIntegrityPort,
  ProcessHostFactsPort,
  type ProtectedInstallLayoutV1,
} from "./facts-ports.js";
import { BrokerPipeServer, DEFAULT_PIPE_PATH } from "./pipe-server.js";
import { DelegatedOperatorError } from "./contracts.js";
import { drainOwnerApprovalInbox } from "./owner-approval-inbox.js";

export const BROKER_SERVICE_NAME = "AionElevatedBroker";
export const BROKER_SERVICE_ACCOUNT = "NT SERVICE\\AionElevatedBroker";
export const BROKER_VERSION = "0.1.0-r652";
export const OPERATION_CATALOG_VERSION = "elevated-broker-ops-v1";
export const INSTALL_SCHEMA_VERSION = "aion.elevated-broker.install.v1";
export const OWNER_APPROVAL_HELPER_REL = "bin\\AionOwnerApprovalHelper.exe";

export interface InstallManifestV1 {
  readonly schemaVersion: typeof INSTALL_SCHEMA_VERSION;
  readonly artifactVersion: string;
  readonly sourceHead: string;
  readonly operationCatalogVersion: string;
  readonly policyDigest: string;
  readonly digests: Readonly<Record<string, string>>;
  readonly machineName: string;
  readonly installedAtUtc: string;
  readonly pipeName: string;
  readonly serviceName: string;
  readonly serviceAccount?: string;
  readonly trustBoundary?: string;
}

export interface ActivatedRuntimePaths {
  readonly installRoot: string;
  readonly stateRoot: string;
  readonly privateRoot: string;
  readonly publicRoot: string;
  readonly layout: ProtectedInstallLayoutV1;
  readonly keyPath: string;
  readonly sessionKeyPath: string;
  readonly storeDir: string;
  readonly replayDir: string;
  readonly approvalInboxDir: string;
  readonly manifestPath: string;
  readonly policyPath: string;
  readonly profilesDir: string;
  readonly ownerApprovalHelperPath: string;
}

export function installedPaths(
  layout: ProtectedInstallLayoutV1 = DEFAULT_PROTECTED_INSTALL_LAYOUT,
): ActivatedRuntimePaths {
  const privateRoot = join(layout.stateRoot, "private");
  const publicRoot = join(layout.stateRoot, "public");
  return {
    installRoot: layout.installRoot,
    stateRoot: layout.stateRoot,
    privateRoot,
    publicRoot,
    layout,
    keyPath: join(privateRoot, "approval", "owner-hmac.key"),
    sessionKeyPath: join(privateRoot, "ipc", "session.key"),
    storeDir: join(privateRoot, "host-store"),
    replayDir: join(privateRoot, "replay"),
    approvalInboxDir: join(privateRoot, "owner-approval-inbox"),
    manifestPath: join(publicRoot, "manifest.v1.json"),
    policyPath: join(layout.installRoot, layout.policyRelative),
    profilesDir: join(layout.installRoot, "profiles"),
    ownerApprovalHelperPath: join(layout.installRoot, OWNER_APPROVAL_HELPER_REL),
  };
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function loadInstallManifest(manifestPath: string): InstallManifestV1 {
  if (!existsSync(manifestPath)) {
    throw new DelegatedOperatorError("manifest-missing", "Install manifest missing");
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")) as InstallManifestV1;
}

export function measureInstallArtifacts(installRoot: string, subjects: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of subjects) {
    const key = rel.replace(/\\/g, "/");
    const full = join(installRoot, key.replace(/\//g, "\\"));
    if (!existsSync(full)) {
      throw new DelegatedOperatorError("artifact-missing", `Missing install artifact: ${key}`);
    }
    out[key] = sha256File(full);
  }
  return out;
}

export function defaultInstallSubjects(
  layout: ProtectedInstallLayoutV1 = DEFAULT_PROTECTED_INSTALL_LAYOUT,
): string[] {
  return [
    layout.binaryRelative,
    layout.policyRelative,
    layout.serviceDefinitionRelative,
    OWNER_APPROVAL_HELPER_REL.replace(/\\/g, "/"),
    "lib/service-main.mjs",
    "lib/package/package.json",
    "profiles/GROK_BUILD.v1.json",
    "profiles/CLAUDE_AUDITOR.v1.json",
  ];
}

export interface ActivatedRuntime {
  readonly host: OperatorHost;
  readonly broker: ElevatedOperatorBroker;
  readonly ui: OwnerAuthorizationUi;
  readonly pipe: BrokerPipeServer;
  readonly paths: ActivatedRuntimePaths;
  readonly sessionKey: Buffer;
  readonly manifest: InstallManifestV1;
  processApprovalInbox(): number;
}

export function createActivatedRuntime(options: {
  readonly repositoryRoot: string;
  readonly machineRole: string;
  readonly uiPort?: number;
  readonly layout?: ProtectedInstallLayoutV1;
}): ActivatedRuntime {
  const paths = installedPaths(options.layout);
  if (!existsSync(paths.manifestPath) || !existsSync(paths.keyPath)) {
    throw new DelegatedOperatorError(
      "not-installed",
      "Broker install/private approval state missing under protected roots",
    );
  }
  const manifest = loadInstallManifest(paths.manifestPath);
  // Private presence — only reachable if process can open private key (service SID)
  const presence = ProvisionedOwnerPresence.fromKeyFile(paths.keyPath);
  const sessionKey = Buffer.from(readFileSync(paths.sessionKeyPath, "utf8").trim().slice(0, 64), "hex");

  const expected = { ...manifest.digests };
  const measure = () =>
    measureInstallArtifacts(
      paths.installRoot,
      Object.keys(manifest.digests).map((k) => k.replace(/\//g, "\\")),
    );
  const integrity = new ManifestBrokerIntegrityPort(expected, measure);

  const host = new OperatorHost({
    storeDir: paths.storeDir,
    activationMode: "activated",
    presence,
    hostFacts: new ProcessHostFactsPort(options.machineRole),
    repositoryFacts: new FixedRepositoryFactsPort(options.repositoryRoot),
    gitFacts: new ExecGitFactsPort(options.repositoryRoot),
  });

  const broker = new ElevatedOperatorBroker({
    brokerVersion: BROKER_VERSION,
    activated: true,
    installed: true,
    presence,
    loadEnvelope: (id) => {
      const rec = host.getStore().get(id);
      if (!rec) return null;
      if (
        rec.lifecycle !== "AUTHORIZED" &&
        rec.lifecycle !== "RUNNING" &&
        rec.lifecycle !== "REBOOT_PENDING"
      ) {
        return null;
      }
      return rec.envelope;
    },
    isSuperseded: (id) => host.getStore().get(id)?.superseded === true,
    hostFacts: new ProcessHostFactsPort(options.machineRole),
    repositoryFacts: new FixedRepositoryFactsPort(options.repositoryRoot),
    gitFacts: new ExecGitFactsPort(options.repositoryRoot),
    integrity,
    replayStateDir: paths.replayDir,
    brokerInstanceId: "installed-broker-v1",
  });

  const ui = new OwnerAuthorizationUi({
    host,
    getPendingEnvelope: (id) => {
      const rec = host.getStore().get(id);
      if (!rec || rec.lifecycle !== "PENDING_OWNER_AUTHORIZATION") return null;
      return rec.envelope;
    },
    port: options.uiPort ?? 0,
    // R6.5.2: activated UI must not mint proofs in-process; require elevated helper
    requireElevatedOwnerHelper: true,
    ownerApprovalHelperPath: paths.ownerApprovalHelperPath,
  });

  const pipe = new BrokerPipeServer({ broker, sessionKey, pipePath: DEFAULT_PIPE_PATH });

  const processApprovalInbox = (): number => {
    const requests = drainOwnerApprovalInbox(paths.approvalInboxDir);
    let n = 0;
    for (const req of requests) {
      try {
        const rec = host.getStore().get(req.authorizationId);
        if (!rec) continue;
        if (rec.envelope.directiveId !== req.directiveId) continue;
        if (rec.envelope.repositoryRoot.replace(/\//g, "\\").toLowerCase() !==
          req.repositoryRoot.replace(/\//g, "\\").toLowerCase()) {
          continue;
        }
        host.ownerAuthorize(req.authorizationId, req.envelopeDigest, req.approvalNonce);
        n += 1;
      } catch {
        /* refuse closed; leave no secret in logs */
      }
    }
    return n;
  };

  return { host, broker, ui, pipe, paths, sessionKey, manifest, processApprovalInbox };
}

export function ensurePrivatePublicDirs(paths: ActivatedRuntimePaths): void {
  for (const d of [
    paths.privateRoot,
    join(paths.privateRoot, "approval"),
    join(paths.privateRoot, "ipc"),
    paths.storeDir,
    paths.replayDir,
    paths.approvalInboxDir,
    paths.publicRoot,
    join(paths.publicRoot, "audit"),
  ]) {
    mkdirSync(d, { recursive: true });
  }
}

export function listRelativeFiles(root: string, base = ""): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const rel = base ? join(base, name) : name;
    if (statSync(full).isDirectory()) out.push(...listRelativeFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

void writeFileSync;
