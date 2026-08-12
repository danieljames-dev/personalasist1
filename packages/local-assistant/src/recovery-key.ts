/**
 * AION Recovery Key — automatic, Owner-passphrase-free backup encryption.
 *
 * Disaster recovery previously leaned on a human-managed passphrase. Removing that leaves one hard
 * requirement: the key must survive loss of C: without ever sitting beside the ciphertext on D:.
 * So the key lives in exactly two places — a protected working copy on the primary desktop (so
 * scheduled backups need no interaction) and an independent copy the Owner moves once to the
 * recovery laptop. `D:\AION-backups` holds ciphertext and nothing else, by construction.
 *
 * Key material is 256 bits from the platform CSPRNG. It is never derived from hostname, username,
 * machine id, timestamps, or any other guessable value, and it is never printed.
 *
 * `keyId` is deliberately *independent* random data rather than a hash of the key, so it can travel
 * in manifests and logs without offering an oracle against the key itself.
 *
 * Rotation keeps history: a rotated-out key is retained locally so previously written artifacts stay
 * restorable. Rotation that silently strands old backups would defeat the point of having them.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RECOVERY_KEY_ALGORITHM = "aion.recovery-key.v1";
export const RECOVERY_KEY_BITS = 256;

const SECRETS_DIR = "secrets";
const CURRENT_FILE = "recovery-key.local.json";
const HISTORY_FILE = "recovery-key-history.local.json";
const LEGACY_PASSPHRASE_FILE = "private-backup-passphrase.local";

/** Non-secret descriptor safe for manifests, logs, and reports. */
export interface RecoveryKeyIdentityV1 {
  keyId: string;
  keyVersion: number;
  algorithm: typeof RECOVERY_KEY_ALGORITHM;
  createdAt: string;
  /** Where this key came from, for operator clarity. Never the value. */
  origin: "generated" | "adopted-legacy";
}

/** Identity plus material. Never serialize this into a backup payload or a report. */
export interface RecoveryKeyRecordV1 extends RecoveryKeyIdentityV1 {
  key: string;
}

function secretsDir(dataRoot: string): string {
  return join(dataRoot, SECRETS_DIR);
}

function restrict(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows ignores POSIX mode; NTFS ACLs are applied by the operator tooling. */
  }
}

/** 256 bits from the platform CSPRNG, base64url so it drops straight into the existing KDF. */
export function generateRecoveryKeyMaterial(): string {
  return randomBytes(RECOVERY_KEY_BITS / 8).toString("base64url");
}

/** Random and independent of the key, so publishing it reveals nothing about the material. */
export function generateKeyId(): string {
  return randomBytes(16).toString("hex");
}

export function identityOf(record: RecoveryKeyRecordV1): RecoveryKeyIdentityV1 {
  return {
    keyId: record.keyId,
    keyVersion: record.keyVersion,
    algorithm: record.algorithm,
    createdAt: record.createdAt,
    origin: record.origin,
  };
}

function readRecord(file: string): RecoveryKeyRecordV1 | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as RecoveryKeyRecordV1;
    if (typeof parsed?.key === "string" && parsed.key.length >= 32 && typeof parsed.keyId === "string") {
      return parsed;
    }
  } catch {
    /* unreadable or absent */
  }
  return null;
}

export function loadRecoveryKey(dataRoot: string): RecoveryKeyRecordV1 | null {
  return readRecord(join(secretsDir(dataRoot), CURRENT_FILE));
}

export function loadRecoveryKeyHistory(dataRoot: string): RecoveryKeyRecordV1[] {
  try {
    const parsed = JSON.parse(readFileSync(join(secretsDir(dataRoot), HISTORY_FILE), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as RecoveryKeyRecordV1[]) : [];
  } catch {
    return [];
  }
}

function persistCurrent(dataRoot: string, record: RecoveryKeyRecordV1): void {
  const dir = secretsDir(dataRoot);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, CURRENT_FILE);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  restrict(file);
}

/**
 * Return the active recovery key, creating one if needed.
 *
 * When a legacy `private-backup-passphrase.local` exists it is *adopted* rather than replaced. That
 * file already holds CSPRNG material, and adopting it keeps every previously written artifact
 * restorable — minting a fresh key here would silently strand them.
 */
export function ensureRecoveryKey(dataRoot: string, nowIso: string): RecoveryKeyRecordV1 {
  const existing = loadRecoveryKey(dataRoot);
  if (existing) return existing;

  const legacyPath = join(secretsDir(dataRoot), LEGACY_PASSPHRASE_FILE);
  let material: string | null = null;
  let origin: RecoveryKeyIdentityV1["origin"] = "generated";
  if (existsSync(legacyPath)) {
    try {
      const raw = readFileSync(legacyPath, "utf8").trim();
      if (raw.length >= 12) {
        material = raw;
        origin = "adopted-legacy";
      }
    } catch {
      /* fall through to generation */
    }
  }
  const record: RecoveryKeyRecordV1 = {
    keyId: generateKeyId(),
    keyVersion: 1,
    algorithm: RECOVERY_KEY_ALGORITHM,
    createdAt: nowIso,
    origin,
    key: material ?? generateRecoveryKeyMaterial(),
  };
  persistCurrent(dataRoot, record);
  return record;
}

/**
 * Rotate to fresh material, retaining the previous key locally so artifacts written under it stay
 * restorable. Historical backups are never invalidated by rotation.
 */
export function rotateRecoveryKey(dataRoot: string, nowIso: string): RecoveryKeyIdentityV1 {
  const current = ensureRecoveryKey(dataRoot, nowIso);
  const history = loadRecoveryKeyHistory(dataRoot);
  history.unshift(current);
  const dir = secretsDir(dataRoot);
  mkdirSync(dir, { recursive: true });
  const historyFile = join(dir, HISTORY_FILE);
  writeFileSync(historyFile, `${JSON.stringify(history.slice(0, 32), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  restrict(historyFile);

  const next: RecoveryKeyRecordV1 = {
    keyId: generateKeyId(),
    keyVersion: current.keyVersion + 1,
    algorithm: RECOVERY_KEY_ALGORITHM,
    createdAt: nowIso,
    origin: "generated",
    key: generateRecoveryKeyMaterial(),
  };
  persistCurrent(dataRoot, next);
  return identityOf(next);
}

/** Every key material this machine can still decrypt with — current, rotated-out, then legacy. */
export function candidateKeyMaterials(dataRoot: string): string[] {
  const out: string[] = [];
  const current = loadRecoveryKey(dataRoot);
  if (current) out.push(current.key);
  for (const historical of loadRecoveryKeyHistory(dataRoot)) {
    if (typeof historical?.key === "string") out.push(historical.key);
  }
  const legacyPath = join(secretsDir(dataRoot), LEGACY_PASSPHRASE_FILE);
  if (existsSync(legacyPath)) {
    try {
      const raw = readFileSync(legacyPath, "utf8").trim();
      if (raw.length >= 12) out.push(raw);
    } catch {
      /* ignore */
    }
  }
  const env = process.env.AION_PRIVATE_BACKUP_PASSPHRASE?.trim() ?? "";
  if (env.length >= 12) out.push(env);
  return [...new Set(out)];
}

/** Transport package for the independent copy. Written under the private root, never to D:. */
export interface RecoveryKeyPackageV1 {
  format: "aion.recovery-key-package.v1";
  exportedAt: string;
  identity: RecoveryKeyIdentityV1;
  key: string;
  instructions: string[];
}

export function buildRecoveryKeyPackage(record: RecoveryKeyRecordV1, nowIso: string): RecoveryKeyPackageV1 {
  return {
    format: "aion.recovery-key-package.v1",
    exportedAt: nowIso,
    identity: identityOf(record),
    key: record.key,
    instructions: [
      "This file is the independent copy of the AION Recovery Key.",
      "Move it to the recovery laptop (DINGY) and store it under that machine's private AION secrets directory.",
      "Do NOT store it on D:\\AION-backups — that drive holds the encrypted backups, and keeping both together would defeat the encryption.",
      "Do NOT commit it to Git, paste it into chat, or email it.",
      "After copying, delete the transport copy from any USB or intermediate medium.",
      "Without this key, encrypted backups cannot be restored if the desktop C: drive is lost.",
    ],
  };
}

export function writeRecoveryKeyPackage(destinationFile: string, pkg: RecoveryKeyPackageV1): void {
  writeFileSync(destinationFile, `${JSON.stringify(pkg, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  restrict(destinationFile);
}

/** Constant-time comparison so verification cannot be used as a timing oracle. */
export function keyMaterialMatches(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
