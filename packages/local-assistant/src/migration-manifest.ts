/**
 * Non-secret continuity migration manifest + repository identity gate.
 *
 * Binds exact origin URL (normalized) and full 40-character commit SHAs.
 * Never accepts a repository merely because a directory or package name says "AION".
 */
import { createHash } from "node:crypto";

export const MIGRATION_MANIFEST_SCHEMA = "aion.continuity-migration-manifest.v1" as const;
export const CANONICAL_ORIGIN = "https://github.com/danieljames-dev/personalasist1.git";

const SECRET_KEY_PATTERN = /(passphrase|password|secret|token|api[_-]?key|authorization|cookie|credentialValue|privateKey)/i;

export interface MigrationManifestV1 {
  schema: typeof MIGRATION_MANIFEST_SCHEMA;
  source: {
    role: "primary" | "secondary" | "demoted";
    systemInstanceId: string;
    origin: string;
    branch: string;
    head: string;
  };
  target: {
    role: "secondary" | "primary" | "uninitialized";
    systemInstanceId: string;
    origin: string;
    head: string;
    pathCategory?: string;
  };
  controlPlane: {
    designDirective: string;
    cutoverDirective: string;
    historyPolicy: "archival-import-only" | "none";
  };
  codeBackup: {
    backupId: string;
    bundleSha256: string;
  };
  privateBackup: {
    artifactSha256: string;
    format: "aion.private-backup.v1";
    stateSchema: "aion.local-assistant-state.v1";
    stateRevision: number;
    stateSha256: string;
  };
  identity: {
    schema: string;
    fileSha256: string;
    transferPolicy: "cold-copy-empty-target-only" | "not-included";
  };
  models: {
    runtime: string;
    runtimeVersion: string;
    entries: Array<{ tag: string; digestOrBlobSha256: string; endpointLogicalId: string }>;
  };
  brain: {
    mode: string;
    primaryEndpointId: string;
    endpointIdentityPolicy: "preserve-logical-ids-reprobe-health" | "re-register";
  };
  verification: {
    expectedVerifyPassCount: number;
    evaluatorDigest: string;
  };
  authority: {
    epoch: number;
    sourceState: "WRITER" | "READ_ONLY" | "REVOKED";
    targetState: "WRITER" | "READ_ONLY" | "REVOKED" | "absent";
  };
  cutover: {
    state: "designed" | "frozen" | "restored" | "verified" | "promoted" | "aborted";
    promotedMachine: "laptop" | "desktop" | "none";
    timestampUtc: string | null;
  };
}

function fail(message: string): never {
  throw new Error(message);
}

export function isFullSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

/**
 * Normalize a git remote URL for identity comparison.
 * Accepts only https GitHub forms that equal the canonical remote after strip of trailing .git? no —
 * we require exact match to CANONICAL_ORIGIN after lowercasing host and stripping trailing slash.
 */
export function normalizeOriginUrl(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) fail("Repository origin is required.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    fail("Repository origin is not a valid absolute URL.");
  }
  if (url.protocol !== "https:") fail("Repository origin must use https.");
  if (url.username || url.password) fail("Repository origin must not embed credentials.");
  if (url.search || url.hash) fail("Repository origin must not include query or fragment.");
  const host = url.hostname.toLowerCase();
  let path = url.pathname.replace(/\/+$/u, "");
  // Keep .git suffix canonical form
  if (!path.endsWith(".git")) path = `${path}.git`;
  return `https://${host}${path}`;
}

export function assertCanonicalRepositoryIdentity(input: {
  origin: string;
  head: string;
  expectedOrigin?: string;
  expectedHead?: string;
  label?: string;
}): { origin: string; head: string } {
  const label = input.label ?? "repository";
  const origin = normalizeOriginUrl(input.origin);
  const expectedOrigin = normalizeOriginUrl(input.expectedOrigin ?? CANONICAL_ORIGIN);
  if (origin !== expectedOrigin) {
    fail(`${label} origin identity mismatch: refused (expected canonical remote, not a directory-name lookalike).`);
  }
  if (!isFullSha(input.head)) fail(`${label} HEAD must be a full 40-character lowercase hex SHA.`);
  if (input.expectedHead !== undefined) {
    if (!isFullSha(input.expectedHead)) fail(`${label} expected HEAD must be a full 40-character SHA.`);
    if (input.head !== input.expectedHead) fail(`${label} HEAD mismatch.`);
  }
  return { origin, head: input.head };
}

export function canonicalManifestValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("Manifest canonicalization requires safe integers.");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalManifestValue).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalManifestValue(record[key])}`).join(",")}}`;
  }
  fail("Unsupported manifest value.");
}

export function digestMigrationManifest(manifest: MigrationManifestV1): string {
  return createHash("sha256").update(canonicalManifestValue(manifest), "utf8").digest("hex");
}

function rejectSecretKeys(value: unknown, path = "$"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSecretKeys(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) fail(`Migration manifest must not contain secret field ${path}.${key}.`);
    if (typeof child === "string" && /passphrase|BEGIN (RSA |OPENSSH )?PRIVATE KEY/i.test(child)) {
      fail(`Migration manifest field ${path}.${key} looks like secret material.`);
    }
    rejectSecretKeys(child, `${path}.${key}`);
  }
}

export function validateMigrationManifestV1(value: unknown): MigrationManifestV1 {
  if (!value || typeof value !== "object") fail("Migration manifest is missing.");
  rejectSecretKeys(value);
  const m = value as Record<string, unknown>;
  if (m.schema !== MIGRATION_MANIFEST_SCHEMA) fail("Migration manifest schema is unsupported.");

  const source = m.source as Record<string, unknown> | undefined;
  const target = m.target as Record<string, unknown> | undefined;
  if (!source || !target) fail("Migration manifest source/target are required.");
  if (!["primary", "secondary", "demoted"].includes(String(source.role))) fail("Migration manifest source.role is invalid.");
  if (!["secondary", "primary", "uninitialized"].includes(String(target.role))) fail("Migration manifest target.role is invalid.");
  if (!isUuid(source.systemInstanceId)) fail("Migration manifest source.systemInstanceId is invalid.");
  if (!isUuid(target.systemInstanceId)) fail("Migration manifest target.systemInstanceId is invalid.");
  if (typeof source.branch !== "string" || !source.branch.trim()) fail("Migration manifest source.branch is required.");

  const sourceId = assertCanonicalRepositoryIdentity({
    origin: String(source.origin ?? ""),
    head: String(source.head ?? ""),
    label: "source",
  });
  const targetId = assertCanonicalRepositoryIdentity({
    origin: String(target.origin ?? ""),
    head: String(target.head ?? ""),
    label: "target",
  });

  const controlPlane = m.controlPlane as Record<string, unknown> | undefined;
  if (!controlPlane) fail("Migration manifest controlPlane is required.");
  if (typeof controlPlane.designDirective !== "string" || !controlPlane.designDirective.trim()) fail("designDirective is required.");
  if (typeof controlPlane.cutoverDirective !== "string" || !controlPlane.cutoverDirective.trim()) fail("cutoverDirective is required.");
  if (controlPlane.historyPolicy !== "archival-import-only" && controlPlane.historyPolicy !== "none") {
    fail("historyPolicy is invalid.");
  }

  const codeBackup = m.codeBackup as Record<string, unknown> | undefined;
  if (!codeBackup || typeof codeBackup.backupId !== "string" || !codeBackup.backupId.trim()) fail("codeBackup.backupId is required.");
  if (!isSha256Hex(codeBackup.bundleSha256)) fail("codeBackup.bundleSha256 must be SHA-256 hex.");

  const privateBackup = m.privateBackup as Record<string, unknown> | undefined;
  if (!privateBackup) fail("privateBackup is required.");
  if (!isSha256Hex(privateBackup.artifactSha256)) fail("privateBackup.artifactSha256 must be SHA-256 hex.");
  if (privateBackup.format !== "aion.private-backup.v1") fail("privateBackup.format is unsupported.");
  if (privateBackup.stateSchema !== "aion.local-assistant-state.v1") fail("privateBackup.stateSchema is unsupported.");
  if (!Number.isSafeInteger(privateBackup.stateRevision) || (privateBackup.stateRevision as number) < 0) {
    fail("privateBackup.stateRevision is invalid.");
  }
  if (!isSha256Hex(privateBackup.stateSha256)) fail("privateBackup.stateSha256 must be SHA-256 hex.");

  const identity = m.identity as Record<string, unknown> | undefined;
  if (!identity || typeof identity.schema !== "string") fail("identity.schema is required.");
  if (!isSha256Hex(identity.fileSha256) && identity.transferPolicy !== "not-included") {
    fail("identity.fileSha256 must be SHA-256 hex unless transfer is not-included.");
  }
  if (identity.transferPolicy !== "cold-copy-empty-target-only" && identity.transferPolicy !== "not-included") {
    fail("identity.transferPolicy is invalid.");
  }

  const models = m.models as Record<string, unknown> | undefined;
  if (!models || typeof models.runtime !== "string" || typeof models.runtimeVersion !== "string") fail("models is invalid.");
  if (!Array.isArray(models.entries)) fail("models.entries must be an array.");
  const entries = models.entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`models.entries[${index}] is invalid.`);
    const e = entry as Record<string, unknown>;
    if (typeof e.tag !== "string" || !e.tag.trim()) fail(`models.entries[${index}].tag is required.`);
    if (typeof e.digestOrBlobSha256 !== "string" || !e.digestOrBlobSha256.trim()) fail(`models.entries[${index}].digest is required.`);
    if (typeof e.endpointLogicalId !== "string" || !e.endpointLogicalId.trim()) fail(`models.entries[${index}].endpointLogicalId is required.`);
    return {
      tag: e.tag.trim(),
      digestOrBlobSha256: e.digestOrBlobSha256.trim(),
      endpointLogicalId: e.endpointLogicalId.trim(),
    };
  });

  const brain = m.brain as Record<string, unknown> | undefined;
  if (!brain || typeof brain.mode !== "string" || typeof brain.primaryEndpointId !== "string") fail("brain is invalid.");
  if (brain.endpointIdentityPolicy !== "preserve-logical-ids-reprobe-health" && brain.endpointIdentityPolicy !== "re-register") {
    fail("brain.endpointIdentityPolicy is invalid.");
  }

  const verification = m.verification as Record<string, unknown> | undefined;
  if (!verification) fail("verification is required.");
  if (!Number.isSafeInteger(verification.expectedVerifyPassCount) || (verification.expectedVerifyPassCount as number) < 0) {
    fail("verification.expectedVerifyPassCount is invalid.");
  }
  if (typeof verification.evaluatorDigest !== "string" || !verification.evaluatorDigest.includes("sha256:")) {
    fail("verification.evaluatorDigest must include a sha256 digest pin.");
  }

  const authority = m.authority as Record<string, unknown> | undefined;
  if (!authority || !Number.isSafeInteger(authority.epoch) || (authority.epoch as number) < 1) fail("authority.epoch is invalid.");
  for (const key of ["sourceState", "targetState"] as const) {
    const allowed = key === "targetState"
      ? ["WRITER", "READ_ONLY", "REVOKED", "absent"]
      : ["WRITER", "READ_ONLY", "REVOKED"];
    if (!allowed.includes(String(authority[key]))) fail(`authority.${key} is invalid.`);
  }

  const cutover = m.cutover as Record<string, unknown> | undefined;
  if (!cutover) fail("cutover is required.");
  if (!["designed", "frozen", "restored", "verified", "promoted", "aborted"].includes(String(cutover.state))) {
    fail("cutover.state is invalid.");
  }
  if (!["laptop", "desktop", "none"].includes(String(cutover.promotedMachine))) fail("cutover.promotedMachine is invalid.");
  if (cutover.timestampUtc !== null && (typeof cutover.timestampUtc !== "string" || new Date(String(cutover.timestampUtc)).toISOString() !== cutover.timestampUtc)) {
    fail("cutover.timestampUtc is invalid.");
  }

  return {
    schema: MIGRATION_MANIFEST_SCHEMA,
    source: {
      role: source.role as MigrationManifestV1["source"]["role"],
      systemInstanceId: source.systemInstanceId as string,
      origin: sourceId.origin,
      branch: String(source.branch).trim(),
      head: sourceId.head,
    },
    target: {
      role: target.role as MigrationManifestV1["target"]["role"],
      systemInstanceId: target.systemInstanceId as string,
      origin: targetId.origin,
      head: targetId.head,
      ...(typeof target.pathCategory === "string" ? { pathCategory: target.pathCategory } : {}),
    },
    controlPlane: {
      designDirective: String(controlPlane.designDirective).trim(),
      cutoverDirective: String(controlPlane.cutoverDirective).trim(),
      historyPolicy: controlPlane.historyPolicy as MigrationManifestV1["controlPlane"]["historyPolicy"],
    },
    codeBackup: {
      backupId: String(codeBackup.backupId).trim(),
      bundleSha256: String(codeBackup.bundleSha256),
    },
    privateBackup: {
      artifactSha256: String(privateBackup.artifactSha256),
      format: "aion.private-backup.v1",
      stateSchema: "aion.local-assistant-state.v1",
      stateRevision: privateBackup.stateRevision as number,
      stateSha256: String(privateBackup.stateSha256),
    },
    identity: {
      schema: String(identity.schema),
      fileSha256: String(identity.fileSha256 ?? "0".repeat(64)),
      transferPolicy: identity.transferPolicy as MigrationManifestV1["identity"]["transferPolicy"],
    },
    models: {
      runtime: String(models.runtime),
      runtimeVersion: String(models.runtimeVersion),
      entries,
    },
    brain: {
      mode: String(brain.mode),
      primaryEndpointId: String(brain.primaryEndpointId),
      endpointIdentityPolicy: brain.endpointIdentityPolicy as MigrationManifestV1["brain"]["endpointIdentityPolicy"],
    },
    verification: {
      expectedVerifyPassCount: verification.expectedVerifyPassCount as number,
      evaluatorDigest: String(verification.evaluatorDigest),
    },
    authority: {
      epoch: authority.epoch as number,
      sourceState: authority.sourceState as MigrationManifestV1["authority"]["sourceState"],
      targetState: authority.targetState as MigrationManifestV1["authority"]["targetState"],
    },
    cutover: {
      state: cutover.state as MigrationManifestV1["cutover"]["state"],
      promotedMachine: cutover.promotedMachine as MigrationManifestV1["cutover"]["promotedMachine"],
      timestampUtc: cutover.timestampUtc as string | null,
    },
  };
}

/** Bind a verified artifact + code identity to a validated manifest. Fail closed on mismatch. */
export function assertManifestMatchesInstallContext(input: {
  manifest: MigrationManifestV1;
  artifactSha256: string;
  actualSourceHead: string;
  actualTargetHead: string;
  actualOrigin: string;
}): void {
  const manifest = validateMigrationManifestV1(input.manifest);
  assertCanonicalRepositoryIdentity({
    origin: input.actualOrigin,
    head: input.actualSourceHead,
    expectedOrigin: manifest.source.origin,
    expectedHead: manifest.source.head,
    label: "install source",
  });
  assertCanonicalRepositoryIdentity({
    origin: input.actualOrigin,
    head: input.actualTargetHead,
    expectedOrigin: manifest.target.origin,
    expectedHead: manifest.target.head,
    label: "install target",
  });
  if (!isSha256Hex(input.artifactSha256)) fail("Artifact SHA-256 is invalid.");
  if (input.artifactSha256 !== manifest.privateBackup.artifactSha256) {
    fail("Private backup artifact hash does not match the migration manifest.");
  }
}
