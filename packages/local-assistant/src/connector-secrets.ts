/**
 * Local connector secrets (Gmail refresh/client secret, etc.).
 * Stored under private data root — never Git, never assistant state JSON, never logs.
 */
import { randomBytes, createCipheriv, createDecipheriv, createHash, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const SECRETS_DIR = "secrets";
const GMAIL_FILE = "gmail-oauth.local.json";
const MACHINE_KEY = "machine-key.local";

export interface GmailLocalSecretsV1 {
  version: 1;
  clientId?: string;
  /** AES-GCM envelope or empty */
  clientSecretEnc?: string;
  refreshTokenEnc?: string;
  scopes?: string[];
  connectedAt?: string;
  accountHint?: string;
  lastSyncAt?: string | null;
  updatedAt?: string;
}

function secretsDir(dataRoot: string): string {
  return join(dataRoot, SECRETS_DIR);
}

function machineKeyPath(dataRoot: string): string {
  return join(secretsDir(dataRoot), MACHINE_KEY);
}

function gmailPath(dataRoot: string): string {
  return join(secretsDir(dataRoot), GMAIL_FILE);
}

function ensureMachineKey(dataRoot: string): Buffer {
  const dir = secretsDir(dataRoot);
  mkdirSync(dir, { recursive: true });
  const p = machineKeyPath(dataRoot);
  if (existsSync(p)) {
    const raw = readFileSync(p, "utf8").trim();
    if (raw.length >= 32) return Buffer.from(raw, "base64url");
  }
  const key = randomBytes(32);
  writeFileSync(p, key.toString("base64url") + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* windows */
  }
  return key;
}

function deriveAesKey(machineKey: Buffer): Buffer {
  return scryptSync(machineKey, "aion-connector-secrets-v1", 32);
}

function encryptSecret(machineKey: Buffer, plaintext: string): string {
  const key = deriveAesKey(machineKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [nonce.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

function decryptSecret(machineKey: Buffer, envelope: string): string | null {
  try {
    const [n, t, c] = envelope.split(".");
    if (!n || !t || !c) return null;
    const key = deriveAesKey(machineKey);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(n, "base64url"));
    decipher.setAuthTag(Buffer.from(t, "base64url"));
    const pt = Buffer.concat([decipher.update(Buffer.from(c, "base64url")), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    return null;
  }
}

export function loadGmailLocalSecrets(dataRoot: string | null | undefined): GmailLocalSecretsV1 | null {
  if (!dataRoot) return null;
  const p = gmailPath(dataRoot);
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as GmailLocalSecretsV1;
    if (raw?.version !== 1) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveGmailLocalSecrets(
  dataRoot: string,
  patch: Partial<GmailLocalSecretsV1> & {
    clientSecretPlain?: string;
    refreshTokenPlain?: string;
  },
): GmailLocalSecretsV1 {
  const mk = ensureMachineKey(dataRoot);
  const prev = loadGmailLocalSecrets(dataRoot) || { version: 1 as const };
  const next: GmailLocalSecretsV1 = { version: 1, updatedAt: new Date().toISOString() };
  const clientId = patch.clientId !== undefined ? patch.clientId : prev.clientId;
  if (clientId) next.clientId = clientId;
  if (prev.clientSecretEnc) next.clientSecretEnc = prev.clientSecretEnc;
  if (prev.refreshTokenEnc) next.refreshTokenEnc = prev.refreshTokenEnc;
  const scopes = patch.scopes !== undefined ? patch.scopes : prev.scopes;
  if (scopes) next.scopes = scopes;
  const connectedAt = patch.connectedAt !== undefined ? patch.connectedAt : prev.connectedAt;
  if (connectedAt) next.connectedAt = connectedAt;
  const accountHint = patch.accountHint !== undefined ? patch.accountHint : prev.accountHint;
  if (accountHint) next.accountHint = accountHint;
  if (patch.lastSyncAt !== undefined) next.lastSyncAt = patch.lastSyncAt;
  else if (prev.lastSyncAt !== undefined) next.lastSyncAt = prev.lastSyncAt;
  if (patch.clientSecretPlain !== undefined && patch.clientSecretPlain.trim()) {
    next.clientSecretEnc = encryptSecret(mk, patch.clientSecretPlain.trim());
  }
  if (patch.refreshTokenPlain !== undefined && patch.refreshTokenPlain.trim()) {
    next.refreshTokenEnc = encryptSecret(mk, patch.refreshTokenPlain.trim());
    if (!next.connectedAt && next.updatedAt) next.connectedAt = next.updatedAt;
  }
  const p = gmailPath(dataRoot);
  writeFileSync(p, JSON.stringify(next, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* */
  }
  return next;
}

export function resolveGmailCredentials(
  dataRoot: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  settingsClientId?: string,
): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  source: { clientId: string; clientSecret: string; refreshToken: string };
  local: GmailLocalSecretsV1 | null;
} {
  const local = loadGmailLocalSecrets(dataRoot);
  const mk = dataRoot && existsSync(machineKeyPath(dataRoot)) ? ensureMachineKey(dataRoot) : null;

  const clientId =
    (settingsClientId || "").trim() ||
    (local?.clientId || "").trim() ||
    (env.AION_GMAIL_CLIENT_ID || "").trim();

  let clientSecret = (env.AION_GMAIL_CLIENT_SECRET || "").trim();
  let secretSrc = clientSecret ? "env" : "none";
  if (!clientSecret && mk && local?.clientSecretEnc) {
    clientSecret = decryptSecret(mk, local.clientSecretEnc) || "";
    if (clientSecret) secretSrc = "local_file";
  }

  let refreshToken = (env.AION_GMAIL_REFRESH_TOKEN || "").trim();
  let refreshSrc = refreshToken ? "env" : "none";
  if (!refreshToken && mk && local?.refreshTokenEnc) {
    refreshToken = decryptSecret(mk, local.refreshTokenEnc) || "";
    if (refreshToken) refreshSrc = "local_file";
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
    source: { clientId: clientId ? (settingsClientId ? "settings" : local?.clientId ? "local_file" : "env") : "none", clientSecret: secretSrc, refreshToken: refreshSrc },
    local,
  };
}

export function clearGmailLocalSecrets(dataRoot: string): void {
  const p = gmailPath(dataRoot);
  if (!existsSync(p)) return;
  writeFileSync(
    p,
    JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), lastSyncAt: null }, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 },
  );
}

export function fingerprintSecret(value: string): string {
  if (!value) return "";
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
