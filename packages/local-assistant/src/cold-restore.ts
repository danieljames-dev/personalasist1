/**
 * Formal cold private restore/install.
 *
 * Not a hot merge. Requires empty destination, verified encrypted artifact,
 * owner passphrase supplied transiently, and migration-manifest provenance.
 * Passphrase is never persisted or logged.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { AssistantStateV1, PrivateBackupV1 } from "./contracts.js";
import { digestValue } from "./adapters.js";
import {
  type MigrationManifestV1,
  assertManifestMatchesInstallContext,
  isSha256Hex,
  validateMigrationManifestV1,
} from "./migration-manifest.js";

export interface ColdPrivateRestoreRequestV1 {
  /** Encrypted backup file path (must already be authorized by the backup port root). */
  backupPath: string;
  /** Owner passphrase — transient only; never logged. */
  passphrase: string;
  /** Absolute empty private/aion destination root. */
  destinationRoot: string;
  /** Validated or raw manifest object. */
  manifest: unknown;
  /** Actual repository identity at install time. */
  actualOrigin: string;
  actualSourceHead: string;
  actualTargetHead: string;
  /**
   * Explicit intended target SystemInstanceId for this install.
   * Must match manifest.target.systemInstanceId. Identity proof only — never grants WRITER.
   * Manifest/private state/Markdown remain non-authoritative for authority decisions.
   */
  actualTargetSystemInstanceId: string;
  /** Optional capture of diagnostic strings for tests (must never include passphrase). */
  logSink?: (line: string) => void;
}

export interface ColdPrivateRestoreResultV1 {
  stateSha256: string;
  stateRevision: number;
  artifactSha256: string;
  installedPath: string;
  manifest: MigrationManifestV1;
}

function fail(message: string): never {
  throw new Error(message);
}

function logSafe(sink: ((line: string) => void) | undefined, line: string, passphrase: string): void {
  if (passphrase && line.includes(passphrase)) fail("Refusing to emit log line that would include the passphrase.");
  sink?.(line);
}

export async function sha256File(path: string): Promise<string> {
  const raw = await readFile(path);
  return createHash("sha256").update(raw).digest("hex");
}

export async function assertDestinationEmptyForColdRestore(destinationRoot: string): Promise<string> {
  if (!destinationRoot || !isAbsolute(destinationRoot) || resolve(destinationRoot) !== destinationRoot) {
    fail("Cold restore destination must be a normalized absolute path.");
  }
  if (basename(destinationRoot).toLowerCase() !== "aion" || basename(dirname(destinationRoot)).toLowerCase() !== "private") {
    fail("Cold restore destination must be an explicit private/aion root.");
  }
  const statePath = join(destinationRoot, "state-v1.json");
  try {
    await stat(statePath);
    fail("Cold restore refused: destination state already exists (no overwrite, no merge, no repair).");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Also refuse if a non-empty state file might exist under alternate names commonly used.
  for (const name of ["state.json", "assistant-state.json"]) {
    try {
      await stat(join(destinationRoot, name));
      fail(`Cold restore refused: unexpected state artifact present (${name}).`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return statePath;
}

async function atomicWriteStateFile(statePath: string, state: AssistantStateV1): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  const text = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) fail("Restored state exceeds the V1 size limit.");
  const temporary = join(dirname(statePath), `.cold-restore-${process.pid}-${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 12)}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    // Re-check empty immediately before install (TOCTOU reduce).
    try {
      await stat(statePath);
      await rm(temporary, { force: true });
      fail("Cold restore refused: destination state appeared before atomic install.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        await rm(temporary, { force: true });
        throw error;
      }
    }
    await rename(temporary, statePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Decrypt/verify via PrivateBackupV1, bind manifest provenance, install only into empty target.
 */
export async function installColdPrivateBackup(
  backup: PrivateBackupV1,
  request: ColdPrivateRestoreRequestV1,
): Promise<ColdPrivateRestoreResultV1> {
  const passphrase = request.passphrase;
  if (typeof passphrase !== "string" || passphrase.length < 12) fail("Cold restore passphrase must contain at least 12 characters.");
  const manifest = validateMigrationManifestV1(request.manifest);
  const statePath = await assertDestinationEmptyForColdRestore(request.destinationRoot);
  logSafe(request.logSink, "cold-restore: destination empty check passed", passphrase);

  const artifactSha256 = await sha256File(request.backupPath);
  if (!isSha256Hex(artifactSha256)) fail("Artifact hash computation failed.");
  assertManifestMatchesInstallContext({
    manifest,
    artifactSha256,
    actualOrigin: request.actualOrigin,
    actualSourceHead: request.actualSourceHead,
    actualTargetHead: request.actualTargetHead,
    actualTargetSystemInstanceId: request.actualTargetSystemInstanceId,
  });
  logSafe(request.logSink, "cold-restore: manifest, repository identity, and target SystemInstanceId verified", passphrase);

  let state: AssistantStateV1;
  try {
    state = await backup.restore(request.backupPath, passphrase);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cold restore decrypt failed.";
    // Never echo passphrase material.
    if (passphrase && message.includes(passphrase)) fail("Cold restore failed closed.");
    fail(`Cold restore failed closed: ${message}`);
  }

  if (state.schema !== "aion.local-assistant-state.v1") fail("Cold restore refused: state schema mismatch.");
  if (state.schema !== manifest.privateBackup.stateSchema) fail("Cold restore refused: manifest state schema mismatch.");
  if (state.revision !== manifest.privateBackup.stateRevision) {
    fail("Cold restore refused: state revision does not match the migration manifest.");
  }

  // Manifest records the canonical digest used by the private-backup create path (digestValue).
  const canonicalDigest = digestValue(state);
  if (canonicalDigest !== manifest.privateBackup.stateSha256) {
    fail("Cold restore refused: state digest does not match the migration manifest.");
  }
  logSafe(request.logSink, "cold-restore: state schema and digest verified", passphrase);

  // Partial failure must not leave accepted live state: write temp then rename; on any post-write
  // validation failure remove installed file.
  try {
    await atomicWriteStateFile(statePath, state);
    const installedRaw = await readFile(statePath, "utf8");
    const installed = JSON.parse(installedRaw) as AssistantStateV1;
    const installedDigest = digestValue(installed);
    if (!timingSafeEqual(Buffer.from(installedDigest, "hex"), Buffer.from(canonicalDigest, "hex"))) {
      await rm(statePath, { force: true });
      fail("Cold restore post-install digest validation failed; removed incomplete install.");
    }
  } catch (error) {
    await rm(statePath, { force: true }).catch(() => {});
    throw error;
  }

  logSafe(request.logSink, "cold-restore: atomic install complete", passphrase);
  return {
    stateSha256: canonicalDigest,
    stateRevision: state.revision,
    artifactSha256,
    installedPath: statePath,
    manifest,
  };
}

/**
 * Helper for tests: write a marker proving passphrase was not written beside the install.
 */
export async function assertNoPassphraseResidue(directory: string, passphrase: string): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const text = await readFile(full, "utf8").catch(() => "");
        if (text.includes(passphrase)) fail(`Passphrase residue found in ${entry.name}`);
      }
    }
  }
  await walk(directory);
}

/** Convenience used by demos/tests to build a synthetic install without secrets in the manifest. */
export async function writeSyntheticManifestFile(path: string, manifest: MigrationManifestV1): Promise<void> {
  const valid = validateMigrationManifestV1(manifest);
  await writeFile(path, `${JSON.stringify(valid, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}
