/**
 * Verify pre-import encrypted private backup path (no secrets printed).
 */
import { createAionServer } from "../../apps/aion/server.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolvePrivateBackupPassphrase } from "../../packages/local-assistant/dist/private-backup-key.js";

const app = await createAionServer({});
const service = app.service;
const backup = await service.preImportPrivateStateBackup();
console.log(
  JSON.stringify({
    ok: backup.ok,
    encrypted: backup.encrypted,
    encryptedPath: backup.encryptedPath ? "(set)" : null,
    snapshotPath: backup.snapshotPath ? "(set)" : null,
    bytes: backup.bytes,
    revision: backup.revision,
    sha256Prefix: String(backup.sha256 || "").slice(0, 16),
    message: backup.message,
  }),
);

if (!backup.encrypted || !backup.encryptedPath) {
  console.error("FAIL: encrypted backup not produced");
  process.exit(1);
}

// Integrity: restore via service.verifyPrivateBackup with same key resolution
const dataRoot = "C:\\AION-HQ\\private\\aion";
const key = resolvePrivateBackupPassphrase(dataRoot);
if (!key.passphrase) {
  console.error("FAIL: no passphrase resolved for verify");
  process.exit(1);
}
const verified = await service.verifyPrivateBackup(backup.encryptedPath, key.passphrase);
console.log(
  JSON.stringify({
    verifyOk: true,
    verifiedRevision: verified?.revision,
    artifactExists: existsSync(backup.encryptedPath),
    isAionbak: String(backup.encryptedPath).endsWith(".aionbak"),
  }),
);

// Never print passphrase or raw key file contents
console.log("PRIVATE_BACKUP_ENCRYPTION = PASS");
await app.close?.();
process.exit(0);
