/**
 * Installed-instance composition for R6.5.1 activated broker/host.
 * Loads only from protected install/state roots after activation — not from C:\AION-HQ live tree.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import {
  ElevatedOperatorBroker,
  BROKER_SCHEMA_VERSION,
} from "./elevated-broker.js";
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

export const BROKER_SERVICE_NAME = "AionElevatedBroker";
export const BROKER_VERSION = "0.1.0-r651";
export const OPERATION_CATALOG_VERSION = "elevated-broker-ops-v1";
export const INSTALL_SCHEMA_VERSION = "aion.elevated-broker.install.v1";

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
}

export interface ActivatedRuntimePaths {
  readonly installRoot: string;
  readonly stateRoot: string;
  readonly layout: ProtectedInstallLayoutV1;
  readonly keyPath: string;
  readonly sessionKeyPath: string;
  readonly storeDir: string;
  readonly replayDir: string;
  readonly manifestPath: string;
  readonly policyPath: string;
  readonly profilesDir: string;
}

export function installedPaths(
  layout: ProtectedInstallLayoutV1 = DEFAULT_PROTECTED_INSTALL_LAYOUT,
): ActivatedRuntimePaths {
  return {
    installRoot: layout.installRoot,
    stateRoot: layout.stateRoot,
    layout,
    keyPath: join(layout.stateRoot, "approval", "owner-hmac.key"),
    sessionKeyPath: join(layout.stateRoot, "ipc", "session.key"),
    storeDir: join(layout.stateRoot, "host-store"),
    replayDir: join(layout.stateRoot, "replay"),
    manifestPath: join(layout.stateRoot, "manifest.v1.json"),
    policyPath: join(layout.installRoot, layout.policyRelative),
    profilesDir: join(layout.installRoot, "profiles"),
  };
}

export function sha256File(path: string): string {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
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

export function defaultInstallSubjects(layout: ProtectedInstallLayoutV1 = DEFAULT_PROTECTED_INSTALL_LAYOUT): string[] {
  return [
    layout.binaryRelative,
    layout.policyRelative,
    layout.serviceDefinitionRelative,
    "lib\\service-main.mjs",
    "lib\\package\\package.json",
    "profiles\\GROK_BUILD.v1.json",
    "profiles\\CLAUDE_AUDITOR.v1.json",
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
      "Broker install/approval state missing under protected roots",
    );
  }
  const manifest = loadInstallManifest(paths.manifestPath);
  const presence = ProvisionedOwnerPresence.fromKeyFile(paths.keyPath);
  const sessionKey = Buffer.from(readFileSync(paths.sessionKeyPath, "utf8").trim().slice(0, 64), "hex");

  const expected = { ...manifest.digests };
  const measure = () => measureInstallArtifacts(paths.installRoot, Object.keys(manifest.digests).map((k) => k.replace(/\//g, "\\")));
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
      if (rec.lifecycle !== "AUTHORIZED" && rec.lifecycle !== "RUNNING" && rec.lifecycle !== "REBOOT_PENDING") {
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
  });

  const pipe = new BrokerPipeServer({ broker, sessionKey, pipePath: DEFAULT_PIPE_PATH });

  return { host, broker, ui, pipe, paths, sessionKey, manifest };
}

export function ensureStateDirs(paths: ActivatedRuntimePaths): void {
  for (const d of [
    paths.stateRoot,
    join(paths.stateRoot, "approval"),
    join(paths.stateRoot, "ipc"),
    paths.storeDir,
    paths.replayDir,
    join(paths.stateRoot, "audit"),
  ]) {
    mkdirSync(d, { recursive: true });
  }
}

export function writeDefaultPolicy(policyPath: string): string {
  const policy = {
    schemaVersion: "aion.elevated-broker.policy.v1",
    version: BROKER_VERSION,
    pipeName: DEFAULT_PIPE_PATH,
    serviceName: BROKER_SERVICE_NAME,
    uacDisabled: false,
    ownerPasswordStored: false,
    arbitraryElevatedPowerShellExposed: false,
    publicListener: false,
    loadFromRepositoryAfterInstall: false,
    nestedOwnerGatesRemain: true,
    founderFallbackAvailable: true,
  };
  const text = `${JSON.stringify(policy, null, 2)}\n`;
  mkdirSync(join(policyPath, ".."), { recursive: true });
  writeFileSync(policyPath, text, "utf8");
  return text;
}

export function writeRoleProfiles(profilesDir: string): void {
  mkdirSync(profilesDir, { recursive: true });
  const grok = {
    role: "GROK_BUILD",
    authorizedOperations: [
      "repo.read",
      "repo.edit",
      "test.run",
      "npm.run",
      "node.run",
      "docker.test",
      "git.status",
      "git.diff",
      "git.stage",
      "git.commit_forward",
      "git.push_canonical",
      "powershell.read",
      "powershell.repo_operation",
      "temp.create",
      "temp.delete_owned",
      "handoff.write",
      "host.read",
      "host.reboot",
    ],
    notes: "Routine builder envelope after Owner milestone approval",
  };
  const claude = {
    role: "CLAUDE_AUDITOR",
    authorizedOperations: [
      "repo.read",
      "test.run",
      "npm.run",
      "node.run",
      "docker.test",
      "git.status",
      "git.diff",
      "powershell.read",
      "temp.create",
      "temp.delete_owned",
      "handoff.write",
      "host.read",
    ],
    structuralDenies: ["repo.edit", "git.stage", "git.commit_forward", "git.push_canonical", "powershell.repo_operation", "host.reboot"],
    notes: "Audit envelope: no tracked production edits/commit/push",
  };
  writeFileSync(join(profilesDir, "GROK_BUILD.v1.json"), `${JSON.stringify(grok, null, 2)}\n`, "utf8");
  writeFileSync(join(profilesDir, "CLAUDE_AUDITOR.v1.json"), `${JSON.stringify(claude, null, 2)}\n`, "utf8");
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

void BROKER_SCHEMA_VERSION;
void hostname;
void randomBytes;
void writeFileSync;
