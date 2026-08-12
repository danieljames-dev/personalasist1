/**
 * Resolve passphrase for encrypted private backups (NodePrivateBackupV1 / AES-GCM).
 *
 * Order:
 * 1. AION_PRIVATE_BACKUP_PASSPHRASE env (≥12) — Owner-configured, never logged
 * 2. Local machine file under private data root secrets/ — auto-created once if missing
 *
 * Does not invent crypto: passphrase is only input to existing scrypt+AES-256-GCM backup port.
 * File is mode 0o600 where supported; path stays outside Git (private/aion).
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { ensureRecoveryKey } from "./recovery-key.js";

const ENV_NAME = "AION_PRIVATE_BACKUP_PASSPHRASE";
const LOCAL_FILE = "private-backup-passphrase.local";

export type BackupPassphraseSourceV1 = "env" | "recovery_key" | "local_file" | "none";

export function resolvePrivateBackupPassphrase(dataRoot: string | null | undefined): {
  passphrase: string | null;
  source: BackupPassphraseSourceV1;
  localPath: string | null;
  keyId?: string;
  keyVersion?: number;
} {
  const env = process.env[ENV_NAME]?.trim() ?? "";
  if (env.length >= 12) {
    return { passphrase: env, source: "env", localPath: null };
  }

  const root = String(dataRoot ?? "").trim();
  if (!root) {
    return { passphrase: null, source: "none", localPath: null };
  }

  // Preferred path: the automatic AION Recovery Key. It adopts any pre-existing legacy passphrase
  // file rather than replacing it, so artifacts written before this existed stay restorable.
  try {
    const record = ensureRecoveryKey(root, new Date().toISOString());
    if (record?.key && record.key.length >= 12) {
      return {
        passphrase: record.key,
        source: "recovery_key",
        localPath: join(root, "secrets", "recovery-key.local.json"),
        keyId: record.keyId,
        keyVersion: record.keyVersion,
      };
    }
  } catch {
    /* fall through to the legacy local file */
  }

  const secretsDir = join(root, "secrets");
  const localPath = join(secretsDir, LOCAL_FILE);
  try {
    if (existsSync(localPath)) {
      const raw = readFileSync(localPath, "utf8").trim();
      if (raw.length >= 12) {
        return { passphrase: raw, source: "local_file", localPath };
      }
    }
    mkdirSync(secretsDir, { recursive: true });
    // 32 random bytes → base64url ≈ 43 chars, high entropy, never printed
    const generated = randomBytes(32).toString("base64url");
    writeFileSync(localPath, `${generated}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      chmodSync(localPath, 0o600);
    } catch {
      /* Windows may ignore mode */
    }
    return { passphrase: generated, source: "local_file", localPath };
  } catch {
    // Race: file created between exists and wx
    try {
      if (existsSync(localPath)) {
        const raw = readFileSync(localPath, "utf8").trim();
        if (raw.length >= 12) return { passphrase: raw, source: "local_file", localPath };
      }
    } catch {
      /* fall through */
    }
    return { passphrase: null, source: "none", localPath };
  }
}
