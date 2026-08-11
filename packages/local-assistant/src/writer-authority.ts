/**
 * Machine writer authority — host-local, machine-verifiable contract.
 *
 * Persistent owner-state mutations require a valid WRITER grant. Authority is not
 * inferred from Markdown CURRENT.md, hostname, MAC, IP, or drive letter. Grant and
 * revoke are external Owner/control-plane operations; the runtime may inspect but
 * never promote itself.
 *
 * System instance identity reuses the accepted Identity SystemInstanceIdV1 shape
 * (RFC 9562 UUID string): a logical instance id, not a hardware fingerprint.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export const WRITER_AUTHORITY_SCHEMA = "aion.writer-authority.v1" as const;
export const OWNER_AUTHORITY_COMMAND_SCHEMA = "aion.owner-authority-command.v1" as const;
export const LEGACY_BOOTSTRAP_DIRECTIVE_ID = "aion.bootstrap.legacy-writer.v1" as const;

export type WriterAuthorityStateV1 = "WRITER" | "READ_ONLY" | "REVOKED";

export interface AuthorityGrantV1 {
  schema: typeof WRITER_AUTHORITY_SCHEMA;
  systemInstanceId: string;
  authorityEpoch: number;
  state: WriterAuthorityStateV1;
  grantDirectiveId: string;
  grantedAt: string;
  revokedAt: string | null;
  previousGrantDigest: string | null;
  /** SHA-256 hex of the canonical grant body excluding this field. */
  digest: string;
}

export interface OwnerAuthorityCommandV1 {
  schema: typeof OWNER_AUTHORITY_COMMAND_SCHEMA;
  command: "grant-writer" | "set-read-only" | "revoke";
  systemInstanceId: string;
  /** Next epoch after apply; must be exactly currentEpoch + 1 (or 1 when bootstrapping grant). */
  authorityEpoch: number;
  grantDirectiveId: string;
  at: string;
}

export interface WriterAuthorityPortV1 {
  /** Snapshot of the durable grant, or null if no grant file/store exists. */
  load(): Promise<AuthorityGrantV1 | null>;
  /** Fail closed unless state is WRITER and digest/epoch are valid. */
  assertWritable(context?: string): Promise<AuthorityGrantV1>;
  /** Apply an external Owner/control-plane command. Runtime self-calls must not use this. */
  applyOwnerCommand(command: OwnerAuthorityCommandV1): Promise<AuthorityGrantV1>;
  /**
   * One-time bootstrap when no authority exists yet (existing laptop upgrade path).
   * Never revives REVOKED or upgrades READ_ONLY. Never runs when a grant already exists.
   */
  bootstrapLegacyWriterIfAbsent(input: {
    systemInstanceId: string;
    grantedAt: string;
  }): Promise<{ created: boolean; grant: AuthorityGrantV1 | null }>;
}

function fail(message: string): never {
  throw new Error(message);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function isIso(value: string): boolean {
  return typeof value === "string" && new Date(value).toISOString() === value;
}

/** Canonical JSON subset used for digests (sorted object keys). */
export function canonicalAuthorityValue(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("Authority digests require safe integers.");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalAuthorityValue).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalAuthorityValue(record[key])}`).join(",")}}`;
  }
  fail("Unsupported authority value.");
}

export function digestAuthorityGrantBody(body: Omit<AuthorityGrantV1, "digest">): string {
  return createHash("sha256").update(canonicalAuthorityValue(body), "utf8").digest("hex");
}

export function validateAuthorityGrantV1(value: unknown): AuthorityGrantV1 {
  if (!value || typeof value !== "object") fail("Writer authority grant is missing.");
  const g = value as Record<string, unknown>;
  if (g.schema !== WRITER_AUTHORITY_SCHEMA) fail("Writer authority schema is unsupported.");
  if (typeof g.systemInstanceId !== "string" || !isUuid(g.systemInstanceId)) fail("Writer authority systemInstanceId is invalid.");
  if (!Number.isSafeInteger(g.authorityEpoch) || (g.authorityEpoch as number) < 1) fail("Writer authority epoch is invalid.");
  if (g.state !== "WRITER" && g.state !== "READ_ONLY" && g.state !== "REVOKED") fail("Writer authority state is invalid.");
  if (typeof g.grantDirectiveId !== "string" || !g.grantDirectiveId.trim() || g.grantDirectiveId.length > 200) {
    fail("Writer authority grantDirectiveId is invalid.");
  }
  if (typeof g.grantedAt !== "string" || !isIso(g.grantedAt)) fail("Writer authority grantedAt is invalid.");
  if (g.revokedAt !== null && (typeof g.revokedAt !== "string" || !isIso(g.revokedAt))) fail("Writer authority revokedAt is invalid.");
  if (g.previousGrantDigest !== null && (typeof g.previousGrantDigest !== "string" || !/^[0-9a-f]{64}$/u.test(g.previousGrantDigest))) {
    fail("Writer authority previousGrantDigest is invalid.");
  }
  if (typeof g.digest !== "string" || !/^[0-9a-f]{64}$/u.test(g.digest)) fail("Writer authority digest is invalid.");
  const body: Omit<AuthorityGrantV1, "digest"> = {
    schema: WRITER_AUTHORITY_SCHEMA,
    systemInstanceId: g.systemInstanceId,
    authorityEpoch: g.authorityEpoch as number,
    state: g.state,
    grantDirectiveId: g.grantDirectiveId.trim(),
    grantedAt: g.grantedAt,
    revokedAt: g.revokedAt as string | null,
    previousGrantDigest: g.previousGrantDigest as string | null,
  };
  const expected = digestAuthorityGrantBody(body);
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(g.digest, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) fail("Writer authority digest validation failed.");
  return { ...body, digest: expected };
}

export function validateOwnerAuthorityCommandV1(value: unknown): OwnerAuthorityCommandV1 {
  if (!value || typeof value !== "object") fail("Owner authority command is missing.");
  const c = value as Record<string, unknown>;
  if (c.schema !== OWNER_AUTHORITY_COMMAND_SCHEMA) fail("Owner authority command schema is unsupported.");
  if (c.command !== "grant-writer" && c.command !== "set-read-only" && c.command !== "revoke") {
    fail("Owner authority command is unsupported.");
  }
  if (typeof c.systemInstanceId !== "string" || !isUuid(c.systemInstanceId)) fail("Owner authority command systemInstanceId is invalid.");
  if (!Number.isSafeInteger(c.authorityEpoch) || (c.authorityEpoch as number) < 1) fail("Owner authority command epoch is invalid.");
  if (typeof c.grantDirectiveId !== "string" || !c.grantDirectiveId.trim() || c.grantDirectiveId.length > 200) {
    fail("Owner authority command grantDirectiveId is invalid.");
  }
  if (typeof c.at !== "string" || !isIso(c.at)) fail("Owner authority command at is invalid.");
  return {
    schema: OWNER_AUTHORITY_COMMAND_SCHEMA,
    command: c.command,
    systemInstanceId: c.systemInstanceId,
    authorityEpoch: c.authorityEpoch as number,
    grantDirectiveId: c.grantDirectiveId.trim(),
    at: c.at,
  };
}

function buildGrant(input: Omit<AuthorityGrantV1, "schema" | "digest">): AuthorityGrantV1 {
  const body: Omit<AuthorityGrantV1, "digest"> = {
    schema: WRITER_AUTHORITY_SCHEMA,
    systemInstanceId: input.systemInstanceId,
    authorityEpoch: input.authorityEpoch,
    state: input.state,
    grantDirectiveId: input.grantDirectiveId,
    grantedAt: input.grantedAt,
    revokedAt: input.revokedAt,
    previousGrantDigest: input.previousGrantDigest,
  };
  return { ...body, digest: digestAuthorityGrantBody(body) };
}

export function assertWritableGrant(grant: AuthorityGrantV1 | null, context = "persistent owner-state mutation"): AuthorityGrantV1 {
  if (!grant) fail(`Writer authority is missing; refusing ${context}.`);
  const valid = validateAuthorityGrantV1(grant);
  if (valid.state === "READ_ONLY") fail(`Writer authority is READ_ONLY; refusing ${context}.`);
  if (valid.state === "REVOKED") fail(`Writer authority is REVOKED; refusing ${context}.`);
  if (valid.state !== "WRITER") fail(`Writer authority is not WRITER; refusing ${context}.`);
  return valid;
}

/** In-memory authority store for tests and deterministic fixtures. */
export class InMemoryWriterAuthorityV1 implements WriterAuthorityPortV1 {
  private grant: AuthorityGrantV1 | null = null;
  constructor(initial?: AuthorityGrantV1 | null) {
    this.grant = initial ? validateAuthorityGrantV1(initial) : null;
  }
  async load(): Promise<AuthorityGrantV1 | null> {
    return this.grant ? structuredClone(this.grant) : null;
  }
  async assertWritable(context?: string): Promise<AuthorityGrantV1> {
    return assertWritableGrant(this.grant, context);
  }
  async applyOwnerCommand(command: OwnerAuthorityCommandV1): Promise<AuthorityGrantV1> {
    const cmd = validateOwnerAuthorityCommandV1(command);
    const current = this.grant;
    if (current) {
      validateAuthorityGrantV1(current);
      if (cmd.systemInstanceId !== current.systemInstanceId) fail("Owner authority command systemInstanceId does not match the grant.");
      if (cmd.authorityEpoch !== current.authorityEpoch + 1) fail("Owner authority command epoch is stale or non-monotonic.");
    } else if (cmd.command !== "grant-writer" || cmd.authorityEpoch !== 1) {
      fail("First owner authority command must grant-writer at epoch 1.");
    }
    const previousGrantDigest = current ? current.digest : null;
    const state: WriterAuthorityStateV1 =
      cmd.command === "grant-writer" ? "WRITER" : cmd.command === "set-read-only" ? "READ_ONLY" : "REVOKED";
    const next = buildGrant({
      systemInstanceId: cmd.systemInstanceId,
      authorityEpoch: cmd.authorityEpoch,
      state,
      grantDirectiveId: cmd.grantDirectiveId,
      grantedAt: current?.grantedAt && cmd.command !== "grant-writer" ? current.grantedAt : cmd.at,
      revokedAt: state === "REVOKED" ? cmd.at : null,
      previousGrantDigest,
    });
    this.grant = next;
    return structuredClone(next);
  }
  async bootstrapLegacyWriterIfAbsent(input: { systemInstanceId: string; grantedAt: string }): Promise<{ created: boolean; grant: AuthorityGrantV1 | null }> {
    if (this.grant) return { created: false, grant: structuredClone(this.grant) };
    if (!isUuid(input.systemInstanceId)) fail("Bootstrap systemInstanceId is invalid.");
    if (!isIso(input.grantedAt)) fail("Bootstrap grantedAt is invalid.");
    this.grant = buildGrant({
      systemInstanceId: input.systemInstanceId,
      authorityEpoch: 1,
      state: "WRITER",
      grantDirectiveId: LEGACY_BOOTSTRAP_DIRECTIVE_ID,
      grantedAt: input.grantedAt,
      revokedAt: null,
      previousGrantDigest: null,
    });
    return { created: true, grant: structuredClone(this.grant) };
  }
  /** Test helper: replace grant without going through owner command (must not exist on production port). */
  replaceForTest(grant: AuthorityGrantV1 | null): void {
    this.grant = grant ? validateAuthorityGrantV1(grant) : null;
  }
}

export function createWriterGrantForTest(input: {
  systemInstanceId?: string;
  authorityEpoch?: number;
  state?: WriterAuthorityStateV1;
  grantDirectiveId?: string;
  grantedAt?: string;
  revokedAt?: string | null;
  previousGrantDigest?: string | null;
}): AuthorityGrantV1 {
  return buildGrant({
    systemInstanceId: input.systemInstanceId ?? "11111111-1111-4111-8111-111111111111",
    authorityEpoch: input.authorityEpoch ?? 1,
    state: input.state ?? "WRITER",
    grantDirectiveId: input.grantDirectiveId ?? "AION-TEST-GRANT",
    grantedAt: input.grantedAt ?? "2030-01-01T00:00:00.000Z",
    revokedAt: input.revokedAt ?? (input.state === "REVOKED" ? "2030-01-01T00:01:00.000Z" : null),
    previousGrantDigest: input.previousGrantDigest ?? null,
  });
}

/**
 * Legacy V1 host-local authority file (`private/aion/writer-authority-v1.json`).
 *
 * V1 is NON-AUTHORITATIVE for production writes under R6.1-R1.
 * Presence of a V1 WRITER file never grants durable mutation rights.
 * Absence never auto-creates authority. Prefer Owner Authority V2.
 */
export class FileWriterAuthorityV1 implements WriterAuthorityPortV1 {
  readonly path: string;
  constructor(readonly root: string) {
    if (!root || !isAbsolute(root) || resolve(root) !== root) fail("Writer authority root must be a normalized absolute path.");
    this.path = join(root, "writer-authority-v1.json");
  }
  async load(): Promise<AuthorityGrantV1 | null> {
    try {
      const info = await stat(this.path);
      if (!info.isFile() || info.size > 64 * 1024) fail("Writer authority file is invalid or oversized.");
      return validateAuthorityGrantV1(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  /** V1 records cannot authorize production WRITER. */
  async assertWritable(context = "persistent owner-state mutation"): Promise<AuthorityGrantV1> {
    fail(`Writer authority is READ_ONLY (V1_NOT_AUTHORITATIVE); refusing ${context}. V1 writer-authority files are not Owner-authenticated.`);
  }
  async applyOwnerCommand(_command: OwnerAuthorityCommandV1): Promise<AuthorityGrantV1> {
    fail("V1 owner authority commands are non-authoritative; use offline Owner Authority V2 signing.");
  }
  /**
   * Production absence bootstrap removed. Never creates WRITER from missing proof.
   */
  async bootstrapLegacyWriterIfAbsent(_input: {
    systemInstanceId: string;
    grantedAt: string;
  }): Promise<{ created: boolean; grant: AuthorityGrantV1 | null }> {
    return { created: false, grant: await this.load() };
  }
}

/**
 * State repository wrapper: every durable save requires WRITER authority.
 * Load remains unrestricted for safe inspection.
 */
export class AuthorityGatedStateRepositoryV1 {
  constructor(
    readonly inner: {
      load(): Promise<import("./contracts.js").AssistantStateV1 | null>;
      save(expectedRevision: number, state: import("./contracts.js").AssistantStateV1): Promise<void>;
      root?: string;
      statePath?: string;
    },
    private readonly authority: WriterAuthorityPortV1,
  ) {}
  /** Surface file-repo root through the gate wrapper for backups/exports. */
  get root(): string | undefined {
    return typeof this.inner.root === "string" ? this.inner.root : undefined;
  }
  get statePath(): string | undefined {
    return typeof this.inner.statePath === "string" ? this.inner.statePath : undefined;
  }
  load(): Promise<import("./contracts.js").AssistantStateV1 | null> {
    return this.inner.load();
  }
  async save(expectedRevision: number, state: import("./contracts.js").AssistantStateV1): Promise<void> {
    await this.authority.assertWritable("durable state save");
    return this.inner.save(expectedRevision, state);
  }
}
