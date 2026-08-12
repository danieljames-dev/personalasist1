/**
 * Disaster-recovery package contents.
 *
 * The encrypted private backup historically carried canonical state only, so a restore left the
 * Owner re-doing setup that lives beside `state-v1.json`: the bounded Gmail scan cursor, pilot
 * operating history, and the machine role record. This module decides exactly which of those
 * sidecar files travel inside the existing encrypted envelope, and — more importantly — which
 * never do.
 *
 * The rule is one-directional: secret *material* stays out, non-secret *continuity* goes in.
 * Gmail OAuth is the interesting case. Its file holds `clientSecretEnc` / `refreshTokenEnc`,
 * already encrypted at rest under `machine-key.local`. Carrying those forward would only be
 * useful if the machine key travelled too, and a backup that contains both the ciphertext and its
 * key is not a backup — it is a copy of the credential. So the OAuth entry is reduced to the
 * non-secret half (client id, scopes, timestamps) which removes the reconfiguration burden, and
 * re-consent remains a deliberate recovery step.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const RECOVERY_PACKAGE_VERSION = "aion.recovery-package.v1";

/** Key names whose values must never enter a backup payload, matched case-insensitively. */
const SECRET_KEY_PATTERN = /(^|[^a-z])(secret|token|passphrase|password|privatekey)|enc$|^machinekey$/i;

export interface RecoverySidecarManifestEntryV1 {
  path: string;
  included: boolean;
  reason: string;
  bytes: number | null;
}

export interface RecoveryManifestV1 {
  version: typeof RECOVERY_PACKAGE_VERSION;
  collectedAt: string;
  entries: RecoverySidecarManifestEntryV1[];
  includedPaths: string[];
  excludedPaths: string[];
}

export interface RecoveryPackageV1 {
  sidecars: Record<string, unknown>;
  manifest: RecoveryManifestV1;
}

/** Sidecars carried inside the encrypted backup, relative to the private data root. */
const INCLUDED_SIDECARS: ReadonlyArray<{ rel: string; reason: string }> = [
  { rel: "secrets/gmail-scan-state.local.json", reason: "Bounded Gmail scan cursor — non-secret; prevents a full rescan after recovery." },
  { rel: "pilot/friction-log.local.json", reason: "Pilot friction history — Owner operating evidence." },
  { rel: "pilot/pilot-days.local.json", reason: "Pilot day metrics — Owner operating evidence." },
  { rel: "machine-role.json", reason: "Machine role record — identifies PRIMARY/source-of-truth on restore." },
];

/** Never carried, with the reason recorded in the manifest so recovery expectations stay explicit. */
const EXCLUDED_SIDECARS: ReadonlyArray<{ rel: string; reason: string }> = [
  { rel: "secrets/machine-key.local", reason: "At-rest key for OAuth material. Shipping it with the ciphertext would make the backup equivalent to the credential itself." },
  { rel: "secrets/private-backup-passphrase.local", reason: "Decryption key for this very backup. Never travels inside it." },
  { rel: "authority-v2", reason: "Owner Authority V2 trust material has its own separate escrow; writer authority must not ride along with state." },
];

/** Reduce the Gmail OAuth record to continuity metadata, dropping every encrypted secret field. */
export function redactOAuthMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Depth-limited scan for secret-shaped keys. Used as a create-time guard and by tests, so a future
 * sidecar addition cannot quietly introduce credential material into a recovery package.
 */
export function findSecretKeyPaths(value: unknown, path = "", depth = 0): string[] {
  if (depth > 6 || !value || typeof value !== "object") return [];
  const hits: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${k}` : k;
    if (SECRET_KEY_PATTERN.test(k)) hits.push(here);
    if (v && typeof v === "object") hits.push(...findSecretKeyPaths(v, here, depth + 1));
  }
  return hits;
}

function readJson(file: string): unknown | null {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Collect the recovery sidecars from a private data root.
 *
 * Missing files are recorded as excluded-with-reason rather than failing: a machine that never
 * connected Gmail still produces a valid, honest package.
 */
export function collectRecoveryPackage(dataRoot: string, nowIso: string): RecoveryPackageV1 {
  const sidecars: Record<string, unknown> = {};
  const entries: RecoverySidecarManifestEntryV1[] = [];

  for (const { rel, reason } of INCLUDED_SIDECARS) {
    const file = join(dataRoot, rel);
    if (!existsSync(file)) {
      entries.push({ path: rel, included: false, reason: "Not present on this machine.", bytes: null });
      continue;
    }
    const parsed = readJson(file);
    if (parsed === null) {
      entries.push({ path: rel, included: false, reason: "Unreadable or not valid JSON.", bytes: null });
      continue;
    }
    sidecars[rel] = parsed;
    entries.push({ path: rel, included: true, reason, bytes: JSON.stringify(parsed).length });
  }

  // Gmail OAuth: continuity metadata only, never the encrypted secret fields.
  const oauthFile = join(dataRoot, "secrets/gmail-oauth.local.json");
  if (existsSync(oauthFile)) {
    const parsed = readJson(oauthFile);
    if (parsed && typeof parsed === "object") {
      const meta = redactOAuthMetadata(parsed);
      sidecars["secrets/gmail-oauth.meta.json"] = meta;
      entries.push({
        path: "secrets/gmail-oauth.meta.json",
        included: true,
        reason: "Gmail connector continuity metadata (client id, scopes, timestamps). Encrypted secret fields removed.",
        bytes: JSON.stringify(meta).length,
      });
      entries.push({
        path: "secrets/gmail-oauth.local.json#clientSecretEnc,refreshTokenEnc",
        included: false,
        reason: "OAuth secret material. Re-consent is the intended recovery path.",
        bytes: null,
      });
    }
  }

  for (const { rel, reason } of EXCLUDED_SIDECARS) {
    entries.push({ path: rel, included: false, reason, bytes: null });
  }

  // Scan sidecar *contents*, not the map's path keys: a file living under `secrets/` is not itself
  // a secret, and matching on the path would reject the Gmail cursor we specifically want carried.
  const leaked: string[] = [];
  for (const [rel, value] of Object.entries(sidecars)) {
    for (const hit of findSecretKeyPaths(value)) leaked.push(`${rel}:${hit}`);
  }
  if (leaked.length > 0) {
    throw new Error(`Recovery package refused: secret-shaped keys present (${leaked.slice(0, 5).join(", ")}).`);
  }

  return {
    sidecars,
    manifest: {
      version: RECOVERY_PACKAGE_VERSION,
      collectedAt: nowIso,
      entries,
      includedPaths: entries.filter((e) => e.included).map((e) => e.path),
      excludedPaths: entries.filter((e) => !e.included).map((e) => e.path),
    },
  };
}

/** Seen-id count from a restored cursor, or null when the cursor was not carried. */
export function restoredCursorSeenIdCount(sidecars: Record<string, unknown> | null | undefined): number | null {
  const cursor = sidecars?.["secrets/gmail-scan-state.local.json"] as { seenMessageIds?: unknown } | undefined;
  if (!cursor || !Array.isArray(cursor.seenMessageIds)) return null;
  return cursor.seenMessageIds.length;
}
