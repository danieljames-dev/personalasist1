/**
 * Owner Authority V2 — fail-closed writer authority.
 *
 * Effective WRITER requires ALL of:
 *   external trusted Owner Ed25519 verification material
 *   + portable authority anchor (current + ledger)
 *   + local SystemInstanceIdV1
 *   + valid chain, digests, signatures
 *   + current state WRITER bound to this System Instance
 *
 * Trust root is EXTERNAL to the mutable anchor. An anchor may carry public-key
 * metadata for inspection, but that material alone cannot authenticate itself.
 *
 * Production runtime may VERIFY and INSPECT only. It may not sign, grant,
 * initialize anchors, generate Owner keys, or self-promote.
 *
 * Signing / ledger append APIs are test-only / offline-tool boundary helpers.
 *
 * Live re-evaluation: every assertWritable re-reads trust + anchor from source.
 * No long-lived cached WRITER capability.
 *
 * Threat honesty:
 * - System Instance UUID is software identity, not hardware attestation.
 * - No claim of protection against complete legitimate-anchor rollback without
 *   an external monotonic witness.
 * - TOCTOU between verify and write remains residual for a malicious local admin.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { AuthorityGrantV1, WriterAuthorityPortV1 } from "./writer-authority.js";

export const AUTHORITY_RECORD_SCHEMA_V2 = "aion.authority-record.v2" as const;
export const AUTHORITY_CURRENT_SCHEMA_V2 = "aion.authority-current.v2" as const;
export const AUTHORITY_ALGORITHM_V2 = "Ed25519" as const;

export type AuthorityStateV2 = "WRITER" | "QUIESCENT" | "REVOKED";
export type EffectiveAuthorityV2 = "WRITER" | "READ_ONLY";

export type AuthorityReasonCodeV2 =
  | "WRITER_BOUND"
  | "NO_TRUSTED_OWNER_KEY"
  | "NO_ANCHOR"
  | "MISSING_IDENTITY"
  | "INVALID_OWNER_KEY"
  | "INVALID_SIGNATURE"
  | "FOREIGN_SYSTEM_INSTANCE"
  | "STALE_OR_BROKEN_CHAIN"
  | "QUIESCENT"
  | "REVOKED"
  | "V1_NOT_AUTHORITATIVE"
  | "MALFORMED_RECORD"
  | "ANCHOR_UNAVAILABLE";

export interface TrustedOwnerVerificationMaterialV2 {
  /** SHA-256 fingerprint of canonical DER SPKI Ed25519 public key bytes. */
  ownerKeyId: string;
  /** SPKI DER-encoded Ed25519 public key. */
  publicKeySpkiDer: Uint8Array;
}

export interface AuthorityRecordV2 {
  schema: typeof AUTHORITY_RECORD_SCHEMA_V2;
  anchorId: string;
  epoch: number;
  state: AuthorityStateV2;
  writerSystemInstanceId: string | null;
  grantDirectiveId: string;
  issuedAt: string;
  previousRecordDigest: string | null;
  recordDigest: string;
  ownerKeyId: string;
  /** Hex-encoded Ed25519 signature over canonical body bytes (not over digest hex). */
  signature: string;
}

export interface AuthorityCurrentV2 {
  schema: typeof AUTHORITY_CURRENT_SCHEMA_V2;
  anchorId: string;
  epoch: number;
  recordDigest: string;
}

export interface EffectiveWriterDecisionV2 {
  effective: EffectiveAuthorityV2;
  reasonCode: AuthorityReasonCodeV2;
  epoch: number | null;
  writerSystemInstanceId: string | null;
  anchorId: string | null;
  detail: string;
}

export interface OwnerAuthorityEvaluateInputV2 {
  /** Externally provisioned trust material. Null => READ_ONLY. */
  trustedOwner: TrustedOwnerVerificationMaterialV2 | null;
  /** Absolute portable authority root, or null. */
  anchorRoot: string | null;
  /** Resolved local SystemInstanceIdV1, or null. Never invent via randomUUID. */
  localSystemInstanceId: string | null;
}

function fail(message: string): never {
  throw new Error(message);
}

/** RFC 9562 UUID v4 (Identity SystemInstanceIdV1 wire shape). */
export function isSystemInstanceIdV1(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

function isIso(value: string): boolean {
  return typeof value === "string" && new Date(value).toISOString() === value;
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function isSignatureHex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{128}$/u.test(value);
}

/** Deterministic canonical JSON (sorted object keys). */
export function canonicalAuthorityValueV2(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("Authority digests require safe integers.");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalAuthorityValueV2).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalAuthorityValueV2(record[key])}`).join(",")}}`;
  }
  fail("Unsupported authority value.");
}

export type AuthorityRecordBodyV2 = Omit<AuthorityRecordV2, "recordDigest" | "signature">;

export function authorityRecordBodyV2(record: AuthorityRecordBodyV2 | AuthorityRecordV2): AuthorityRecordBodyV2 {
  return {
    schema: AUTHORITY_RECORD_SCHEMA_V2,
    anchorId: record.anchorId,
    epoch: record.epoch,
    state: record.state,
    writerSystemInstanceId: record.writerSystemInstanceId,
    grantDirectiveId: record.grantDirectiveId,
    issuedAt: record.issuedAt,
    previousRecordDigest: record.previousRecordDigest,
    ownerKeyId: record.ownerKeyId,
  };
}

/** UTF-8 bytes of deterministic canonical serialization of the record body. */
export function canonicalBodyBytesV2(body: AuthorityRecordBodyV2): Buffer {
  return Buffer.from(canonicalAuthorityValueV2(body), "utf8");
}

export function recordDigestV2(body: AuthorityRecordBodyV2): string {
  return createHash("sha256").update(canonicalBodyBytesV2(body)).digest("hex");
}

export function ownerKeyIdFromSpkiDer(spkiDer: Uint8Array): string {
  return createHash("sha256").update(spkiDer).digest("hex");
}

export function exportPublicKeySpkiDer(publicKey: KeyObject): Buffer {
  return publicKey.export({ type: "spki", format: "der" }) as Buffer;
}

export function exportPrivateKeyPkcs8Der(privateKey: KeyObject): Buffer {
  return privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
}

export function importPublicKeySpkiDer(spkiDer: Uint8Array): KeyObject {
  return createPublicKey({ key: Buffer.from(spkiDer), format: "der", type: "spki" });
}

export function importPrivateKeyPkcs8Der(pkcs8Der: Uint8Array): KeyObject {
  return createPrivateKey({ key: Buffer.from(pkcs8Der), format: "der", type: "pkcs8" });
}

/** Synthetic / offline-tool only. Production runtime must not call this. */
export function generateOwnerKeyPairV2ForTest(): {
  publicKey: KeyObject;
  privateKey: KeyObject;
  publicKeySpkiDer: Buffer;
  privateKeyPkcs8Der: Buffer;
  ownerKeyId: string;
  trust: TrustedOwnerVerificationMaterialV2;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeySpkiDer = exportPublicKeySpkiDer(publicKey);
  const privateKeyPkcs8Der = exportPrivateKeyPkcs8Der(privateKey);
  const ownerKeyId = ownerKeyIdFromSpkiDer(publicKeySpkiDer);
  return {
    publicKey,
    privateKey,
    publicKeySpkiDer,
    privateKeyPkcs8Der,
    ownerKeyId,
    trust: { ownerKeyId, publicKeySpkiDer: new Uint8Array(publicKeySpkiDer) },
  };
}

export function signAuthorityBodyV2(body: AuthorityRecordBodyV2, privateKey: KeyObject): {
  recordDigest: string;
  signature: string;
} {
  const bytes = canonicalBodyBytesV2(body);
  const recordDigest = createHash("sha256").update(bytes).digest("hex");
  const signature = cryptoSign(null, bytes, privateKey).toString("hex");
  return { recordDigest, signature };
}

export function verifyAuthoritySignatureV2(
  body: AuthorityRecordBodyV2,
  signatureHex: string,
  trustedOwner: TrustedOwnerVerificationMaterialV2,
): boolean {
  if (!isSignatureHex(signatureHex)) return false;
  if (body.ownerKeyId !== trustedOwner.ownerKeyId) return false;
  const expectedId = ownerKeyIdFromSpkiDer(trustedOwner.publicKeySpkiDer);
  if (expectedId !== trustedOwner.ownerKeyId) return false;
  try {
    const publicKey = importPublicKeySpkiDer(trustedOwner.publicKeySpkiDer);
    const bytes = canonicalBodyBytesV2(body);
    return cryptoVerify(null, bytes, publicKey, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

export function validateAuthorityRecordV2(
  value: unknown,
  trustedOwner: TrustedOwnerVerificationMaterialV2,
): AuthorityRecordV2 {
  if (!value || typeof value !== "object") fail("Authority record is missing.");
  const r = value as Record<string, unknown>;
  if (r.schema !== AUTHORITY_RECORD_SCHEMA_V2) fail("Authority record schema is unsupported.");
  // anchorId is a UUID v4 logical id (same wire shape as SystemInstanceIdV1).
  if (typeof r.anchorId !== "string" || !isSystemInstanceIdV1(r.anchorId)) fail("Authority record anchorId is invalid.");
  if (!Number.isSafeInteger(r.epoch) || (r.epoch as number) < 1) fail("Authority record epoch is invalid.");
  if (r.state !== "WRITER" && r.state !== "QUIESCENT" && r.state !== "REVOKED") fail("Authority record state is invalid.");
  if (r.state === "WRITER") {
    if (typeof r.writerSystemInstanceId !== "string" || !isSystemInstanceIdV1(r.writerSystemInstanceId)) {
      fail("WRITER record requires writerSystemInstanceId.");
    }
  } else if (r.writerSystemInstanceId !== null) {
    fail("Non-WRITER record must have writerSystemInstanceId null.");
  }
  if (typeof r.grantDirectiveId !== "string" || !r.grantDirectiveId.trim() || r.grantDirectiveId.length > 200) {
    fail("Authority record grantDirectiveId is invalid.");
  }
  if (typeof r.issuedAt !== "string" || !isIso(r.issuedAt)) fail("Authority record issuedAt is invalid.");
  if (r.previousRecordDigest !== null && !isSha256Hex(r.previousRecordDigest)) fail("Authority record previousRecordDigest is invalid.");
  if ((r.epoch as number) === 1 && r.previousRecordDigest !== null) fail("Genesis record previousRecordDigest must be null.");
  if ((r.epoch as number) > 1 && r.previousRecordDigest === null) fail("Non-genesis record requires previousRecordDigest.");
  if (typeof r.ownerKeyId !== "string" || !isSha256Hex(r.ownerKeyId)) fail("Authority record ownerKeyId is invalid.");
  if (r.ownerKeyId !== trustedOwner.ownerKeyId) fail("Authority record ownerKeyId does not match trusted Owner key.");
  if (!isSha256Hex(r.recordDigest)) fail("Authority record recordDigest is invalid.");
  if (!isSignatureHex(r.signature)) fail("Authority record signature is invalid.");

  const body = authorityRecordBodyV2({
    schema: AUTHORITY_RECORD_SCHEMA_V2,
    anchorId: r.anchorId as string,
    epoch: r.epoch as number,
    state: r.state as AuthorityStateV2,
    writerSystemInstanceId: r.writerSystemInstanceId as string | null,
    grantDirectiveId: (r.grantDirectiveId as string).trim(),
    issuedAt: r.issuedAt as string,
    previousRecordDigest: r.previousRecordDigest as string | null,
    ownerKeyId: r.ownerKeyId as string,
  });
  const expectedDigest = recordDigestV2(body);
  const left = Buffer.from(expectedDigest, "hex");
  const right = Buffer.from(r.recordDigest as string, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) fail("Authority recordDigest validation failed.");
  if (!verifyAuthoritySignatureV2(body, r.signature as string, trustedOwner)) {
    fail("Authority record Ed25519 signature validation failed.");
  }
  return { ...body, recordDigest: expectedDigest, signature: r.signature as string };
}

export function validateAuthorityCurrentV2(value: unknown): AuthorityCurrentV2 {
  if (!value || typeof value !== "object") fail("Authority current pointer is missing.");
  const c = value as Record<string, unknown>;
  if (c.schema !== AUTHORITY_CURRENT_SCHEMA_V2) fail("Authority current schema is unsupported.");
  if (typeof c.anchorId !== "string" || !isSystemInstanceIdV1(c.anchorId)) fail("Authority current anchorId is invalid.");
  if (!Number.isSafeInteger(c.epoch) || (c.epoch as number) < 1) fail("Authority current epoch is invalid.");
  if (!isSha256Hex(c.recordDigest)) fail("Authority current recordDigest is invalid.");
  return {
    schema: AUTHORITY_CURRENT_SCHEMA_V2,
    anchorId: c.anchorId,
    epoch: c.epoch as number,
    recordDigest: c.recordDigest,
  };
}

export function epochLedgerFileName(epoch: number): string {
  if (!Number.isSafeInteger(epoch) || epoch < 1) fail("Invalid epoch for ledger filename.");
  return `${String(epoch).padStart(10, "0")}.json`;
}

/** Canonical ledger filename pattern: zero-padded 10-digit epoch + ".json". */
export const EPOCH_LEDGER_FILE_PATTERN = /^(\d{10})\.json$/u;

/**
 * Parse a ledger directory entry name into an epoch.
 * Fail closed on non-canonical names (no alternate spellings, no case variants).
 */
export function parseEpochLedgerFileName(name: string): number {
  const match = EPOCH_LEDGER_FILE_PATTERN.exec(name);
  if (!match) fail(`Authority ledger contains unexpected entry: ${name}`);
  const epoch = Number(match[1]);
  if (!Number.isSafeInteger(epoch) || epoch < 1) fail(`Authority ledger filename encodes an invalid epoch: ${name}`);
  if (epochLedgerFileName(epoch) !== name) fail(`Authority ledger filename is non-canonical: ${name}`);
  return epoch;
}

function readOnlyDecision(
  reasonCode: AuthorityReasonCodeV2,
  detail: string,
  extra: Partial<EffectiveWriterDecisionV2> = {},
): EffectiveWriterDecisionV2 {
  return {
    effective: "READ_ONLY",
    reasonCode,
    epoch: null,
    writerSystemInstanceId: null,
    anchorId: null,
    detail,
    ...extra,
  };
}

/**
 * Evaluate effective writer authority from already-loaded, signature-validated tip + chain.
 * Does not cache. Callers must re-load before each durable write.
 */
export function evaluateLoadedAuthorityV2(input: {
  trustedOwner: TrustedOwnerVerificationMaterialV2 | null;
  localSystemInstanceId: string | null;
  current: AuthorityCurrentV2 | null;
  tip: AuthorityRecordV2 | null;
  chainValid: boolean;
  chainError?: string;
}): EffectiveWriterDecisionV2 {
  if (!input.trustedOwner) {
    return readOnlyDecision("NO_TRUSTED_OWNER_KEY", "No externally trusted Owner verification material is configured.");
  }
  if (!input.localSystemInstanceId || !isSystemInstanceIdV1(input.localSystemInstanceId)) {
    return readOnlyDecision("MISSING_IDENTITY", "Local SystemInstanceIdV1 is missing or invalid.");
  }
  if (!input.current || !input.tip) {
    return readOnlyDecision("NO_ANCHOR", "Authority anchor current tip is unavailable.");
  }
  if (!input.chainValid) {
    return readOnlyDecision("STALE_OR_BROKEN_CHAIN", input.chainError ?? "Authority ledger chain is invalid.");
  }
  if (input.tip.state === "QUIESCENT") {
    return readOnlyDecision("QUIESCENT", "Authority is QUIESCENT (zero active writer).", {
      epoch: input.tip.epoch,
      anchorId: input.tip.anchorId,
    });
  }
  if (input.tip.state === "REVOKED") {
    return readOnlyDecision("REVOKED", "Authority is REVOKED.", {
      epoch: input.tip.epoch,
      anchorId: input.tip.anchorId,
    });
  }
  if (input.tip.state !== "WRITER" || !input.tip.writerSystemInstanceId) {
    return readOnlyDecision("MALFORMED_RECORD", "Authority tip is not a valid WRITER record.", {
      epoch: input.tip.epoch,
      anchorId: input.tip.anchorId,
    });
  }
  if (input.tip.writerSystemInstanceId !== input.localSystemInstanceId) {
    return readOnlyDecision("FOREIGN_SYSTEM_INSTANCE", "Current WRITER is bound to a different System Instance.", {
      epoch: input.tip.epoch,
      writerSystemInstanceId: input.tip.writerSystemInstanceId,
      anchorId: input.tip.anchorId,
    });
  }
  return {
    effective: "WRITER",
    reasonCode: "WRITER_BOUND",
    epoch: input.tip.epoch,
    writerSystemInstanceId: input.tip.writerSystemInstanceId,
    anchorId: input.tip.anchorId,
    detail: "Effective WRITER: trusted key, chain, signature, and local System Instance all match.",
  };
}

/** File-backed portable anchor. Production may read only; never auto-create. */
export class FileOwnerAuthorityAnchorV2 {
  readonly root: string;
  readonly currentPath: string;
  readonly ledgerDir: string;

  constructor(root: string) {
    if (!root || !isAbsolute(root) || resolve(root) !== root) fail("Authority anchor root must be a normalized absolute path.");
    this.root = root;
    this.currentPath = join(root, "current.json");
    this.ledgerDir = join(root, "ledger");
  }

  ledgerPath(epoch: number): string {
    return join(this.ledgerDir, epochLedgerFileName(epoch));
  }

  async readCurrent(): Promise<AuthorityCurrentV2 | null> {
    try {
      const info = await stat(this.currentPath);
      if (!info.isFile() || info.size > 64 * 1024) fail("Authority current pointer is invalid or oversized.");
      return validateAuthorityCurrentV2(JSON.parse(await readFile(this.currentPath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async readRecord(epoch: number, trustedOwner: TrustedOwnerVerificationMaterialV2): Promise<AuthorityRecordV2 | null> {
    const path = this.ledgerPath(epoch);
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > 256 * 1024) fail(`Authority ledger record epoch ${epoch} is invalid or oversized.`);
      return validateAuthorityRecordV2(JSON.parse(await readFile(path, "utf8")), trustedOwner);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /**
   * Enumerate surviving ledger evidence by directory listing (not tip+1 probing).
   * Fail closed on unexpected entries, non-canonical names, or ambiguous duplicates.
   */
  async listPresentLedgerEpochs(): Promise<number[]> {
    let entries;
    try {
      entries = await readdir(this.ledgerDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const epochs: number[] = [];
    const seen = new Set<number>();
    for (const entry of entries) {
      if (!entry.isFile()) fail(`Authority ledger contains unexpected non-file entry: ${entry.name}`);
      const epoch = parseEpochLedgerFileName(entry.name);
      if (seen.has(epoch)) fail(`Authority ledger contains duplicate epoch entry: ${entry.name}`);
      seen.add(epoch);
      epochs.push(epoch);
    }
    epochs.sort((a, b) => a - b);
    return epochs;
  }

  /**
   * Load tip and walk full chain to genesis.
   *
   * Fail closed when ANY surviving ledger evidence is inconsistent with current:
   * gaps, unexpected higher epochs, stale/future current, filename/epoch mismatch,
   * digest/signature/anchor/ownerKey failures, or malformed relevant records.
   *
   * Re-reads files every call (no cache).
   *
   * Residual limitation (NOT solved here): a COMPLETE rollback that removes all later
   * ledger records together with current rollback cannot be detected without an external
   * monotonic witness. Local verification only inspects surviving on-disk evidence.
   */
  async loadValidatedTip(trustedOwner: TrustedOwnerVerificationMaterialV2): Promise<{
    current: AuthorityCurrentV2;
    tip: AuthorityRecordV2;
  }> {
    const current = await this.readCurrent();
    if (!current) {
      // If ledger has any entry without current, fail closed (do not invent tip)
      const orphanEpochs = await this.listPresentLedgerEpochs();
      if (orphanEpochs.length > 0) {
        fail("Authority current pointer is missing while ledger records survive.");
      }
      fail("Authority current pointer is missing.");
    }

    // Enumerate actual surviving ledger evidence — do not probe only current+1.
    const presentEpochs = await this.listPresentLedgerEpochs();
    if (presentEpochs.length === 0) {
      fail("Authority ledger is empty while current pointer exists.");
    }
    const highestPresent = presentEpochs[presentEpochs.length - 1]!;

    // Require contiguous epochs 1..highestPresent (no gaps, no missing middle).
    for (let epoch = 1; epoch <= highestPresent; epoch++) {
      if (!presentEpochs.includes(epoch)) {
        fail(`Authority ledger gap: missing epoch ${epoch} while higher epoch ${highestPresent} survives.`);
      }
    }
    if (presentEpochs.length !== highestPresent) {
      fail("Authority ledger epoch set is inconsistent with contiguous chain requirements.");
    }

    // current must identify the actual highest surviving ledger epoch.
    if (current.epoch !== highestPresent) {
      if (current.epoch < highestPresent) {
        fail(
          `Authority current is stale: current.epoch=${current.epoch} but higher surviving ledger epoch ${highestPresent} exists.`,
        );
      }
      fail(
        `Authority current points to future/missing epoch ${current.epoch}; highest surviving ledger epoch is ${highestPresent}.`,
      );
    }

    const tip = await this.readRecord(current.epoch, trustedOwner);
    if (!tip) fail(`Authority ledger record for current epoch ${current.epoch} is missing.`);
    if (tip.anchorId !== current.anchorId) fail("Authority current anchorId does not match tip record.");
    if (tip.recordDigest !== current.recordDigest) fail("Authority current recordDigest does not match tip record.");
    if (tip.epoch !== current.epoch) fail("Authority current epoch does not match tip record.");
    if (tip.epoch !== highestPresent) fail("Authority tip epoch is not the highest surviving ledger epoch.");

    // Walk chain exactly: every epoch 1..tip must exist, continuous, previousDigest links
    let previous: AuthorityRecordV2 | null = null;
    for (let epoch = 1; epoch <= tip.epoch; epoch++) {
      const record = await this.readRecord(epoch, trustedOwner);
      if (!record) fail(`Authority ledger gap: missing epoch ${epoch}.`);
      if (record.epoch !== epoch) fail(`Authority ledger filename/epoch mismatch at ${epoch}.`);
      if (record.anchorId !== tip.anchorId) fail(`Authority ledger anchorId mismatch at epoch ${epoch}.`);
      if (record.ownerKeyId !== trustedOwner.ownerKeyId) fail(`Authority ledger ownerKeyId mismatch at epoch ${epoch}.`);
      if (epoch === 1) {
        if (record.previousRecordDigest !== null) fail("Genesis previousRecordDigest must be null.");
      } else {
        if (!previous || record.previousRecordDigest !== previous.recordDigest) {
          fail(`Authority previousRecordDigest chain break at epoch ${epoch}.`);
        }
      }
      previous = record;
    }

    // Defense in depth: re-confirm no higher surviving evidence after chain validation.
    const rechecked = await this.listPresentLedgerEpochs();
    const recheckedHighest = rechecked.length === 0 ? 0 : rechecked[rechecked.length - 1]!;
    if (recheckedHighest !== tip.epoch || rechecked.length !== tip.epoch) {
      fail("Authority ledger population changed or remains inconsistent after chain validation.");
    }

    return { current, tip };
  }
}

/**
 * Test-only / offline-tool boundary: create genesis and append signed transitions.
 * Production runtime must never call these methods.
 */
export class OfflineOwnerAuthorityWriterV2 {
  constructor(
    readonly anchor: FileOwnerAuthorityAnchorV2,
    readonly privateKey: KeyObject,
    readonly trust: TrustedOwnerVerificationMaterialV2,
  ) {}

  async initializeGenesis(input: {
    anchorId: string;
    state: AuthorityStateV2;
    writerSystemInstanceId: string | null;
    grantDirectiveId: string;
    issuedAt: string;
  }): Promise<AuthorityRecordV2> {
    if (!isSystemInstanceIdV1(input.anchorId)) fail("Genesis anchorId must be UUID v4.");
    try {
      await stat(this.anchor.currentPath);
      fail("Authority anchor already initialized.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return this.#commit({
      epoch: 1,
      previousRecordDigest: null,
      anchorId: input.anchorId,
      state: input.state,
      writerSystemInstanceId: input.writerSystemInstanceId,
      grantDirectiveId: input.grantDirectiveId,
      issuedAt: input.issuedAt,
    });
  }

  async appendTransition(input: {
    state: AuthorityStateV2;
    writerSystemInstanceId: string | null;
    grantDirectiveId: string;
    issuedAt: string;
  }): Promise<AuthorityRecordV2> {
    const { tip } = await this.anchor.loadValidatedTip(this.trust);
    // Direct WRITER A → WRITER B refused; must pass through QUIESCENT
    if (tip.state === "WRITER" && input.state === "WRITER") {
      if (input.writerSystemInstanceId !== tip.writerSystemInstanceId) {
        fail("Direct WRITER transfer refused; transition through QUIESCENT is required.");
      }
    }
    if (tip.state === "REVOKED" && input.state === "WRITER") {
      // Allowed only via explicit signed transition (this is that explicit path) — policy allows
      // re-grant after REVOKED only as a new signed epoch (explicit Owner action). Keep allowed.
    }
    return this.#commit({
      epoch: tip.epoch + 1,
      previousRecordDigest: tip.recordDigest,
      anchorId: tip.anchorId,
      state: input.state,
      writerSystemInstanceId: input.writerSystemInstanceId,
      grantDirectiveId: input.grantDirectiveId,
      issuedAt: input.issuedAt,
    });
  }

  async #commit(input: {
    epoch: number;
    previousRecordDigest: string | null;
    anchorId: string;
    state: AuthorityStateV2;
    writerSystemInstanceId: string | null;
    grantDirectiveId: string;
    issuedAt: string;
  }): Promise<AuthorityRecordV2> {
    if (input.state === "WRITER") {
      if (!input.writerSystemInstanceId || !isSystemInstanceIdV1(input.writerSystemInstanceId)) {
        fail("WRITER transition requires writerSystemInstanceId.");
      }
    } else if (input.writerSystemInstanceId !== null) {
      fail("Non-WRITER transition must null writerSystemInstanceId.");
    }
    const body: AuthorityRecordBodyV2 = {
      schema: AUTHORITY_RECORD_SCHEMA_V2,
      anchorId: input.anchorId,
      epoch: input.epoch,
      state: input.state,
      writerSystemInstanceId: input.writerSystemInstanceId,
      grantDirectiveId: input.grantDirectiveId.trim(),
      issuedAt: input.issuedAt,
      previousRecordDigest: input.previousRecordDigest,
      ownerKeyId: this.trust.ownerKeyId,
    };
    const { recordDigest, signature } = signAuthorityBodyV2(body, this.privateKey);
    const record: AuthorityRecordV2 = { ...body, recordDigest, signature };
    validateAuthorityRecordV2(record, this.trust);

    await mkdir(this.anchor.ledgerDir, { recursive: true });
    const ledgerPath = this.anchor.ledgerPath(input.epoch);
    // create-new only — no overwrite
    const ledgerHandle = await open(ledgerPath, "wx", 0o600);
    try {
      await ledgerHandle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      await ledgerHandle.sync();
    } finally {
      await ledgerHandle.close();
    }

    const current: AuthorityCurrentV2 = {
      schema: AUTHORITY_CURRENT_SCHEMA_V2,
      anchorId: input.anchorId,
      epoch: input.epoch,
      recordDigest,
    };
    await mkdir(this.anchor.root, { recursive: true });
    const temporary = join(this.anchor.root, `.current-${process.pid}-${Date.now()}.tmp`);
    const tmpHandle = await open(temporary, "wx", 0o600);
    try {
      await tmpHandle.writeFile(`${JSON.stringify(current, null, 2)}\n`, "utf8");
      await tmpHandle.sync();
    } finally {
      await tmpHandle.close();
    }
    try {
      await rename(temporary, this.anchor.currentPath);
    } finally {
      await rm(temporary, { force: true });
    }
    return record;
  }
}

/**
 * Production runtime authority port: verify-only, live re-evaluation every assertWritable.
 * Implements WriterAuthorityPortV1 for service/repository composition.
 */
export class OwnerAuthorityRuntimeV2 implements WriterAuthorityPortV1 {
  constructor(
    private readonly config: {
      /** Supplier re-read each evaluation so tests can rotate trust; production passes constant. */
      getTrustedOwner: () => TrustedOwnerVerificationMaterialV2 | null;
      /** Absolute anchor root or null. Re-read from disk every evaluation. */
      getAnchorRoot: () => string | null;
      /** Local System Instance supplier — re-read each evaluation. */
      getLocalSystemInstanceId: () => string | null;
    },
  ) {}

  /** Live evaluation: no process-lifetime WRITER cache. */
  async evaluate(): Promise<EffectiveWriterDecisionV2> {
    const trustedOwner = this.config.getTrustedOwner();
    if (!trustedOwner) {
      return readOnlyDecision("NO_TRUSTED_OWNER_KEY", "No externally trusted Owner verification material is configured.");
    }
    // Validate trust material integrity
    try {
      const recomputed = ownerKeyIdFromSpkiDer(trustedOwner.publicKeySpkiDer);
      if (recomputed !== trustedOwner.ownerKeyId) {
        return readOnlyDecision("INVALID_OWNER_KEY", "Trusted Owner key fingerprint does not match public key bytes.");
      }
      importPublicKeySpkiDer(trustedOwner.publicKeySpkiDer);
    } catch {
      return readOnlyDecision("INVALID_OWNER_KEY", "Trusted Owner public key material is invalid.");
    }

    const localSystemInstanceId = this.config.getLocalSystemInstanceId();
    if (!localSystemInstanceId || !isSystemInstanceIdV1(localSystemInstanceId)) {
      return readOnlyDecision("MISSING_IDENTITY", "Local SystemInstanceIdV1 is missing or invalid.");
    }

    const anchorRoot = this.config.getAnchorRoot();
    if (!anchorRoot) {
      return readOnlyDecision("NO_ANCHOR", "No authority anchor root is configured.");
    }

    try {
      const anchor = new FileOwnerAuthorityAnchorV2(anchorRoot);
      const { current, tip } = await anchor.loadValidatedTip(trustedOwner);
      return evaluateLoadedAuthorityV2({
        trustedOwner,
        localSystemInstanceId,
        current,
        tip,
        chainValid: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authority anchor unavailable.";
      if (/signature|ownerKeyId does not match|Ed25519/i.test(message)) {
        return readOnlyDecision("INVALID_SIGNATURE", message);
      }
      if (/ownerKeyId|trusted Owner key/i.test(message)) {
        return readOnlyDecision("INVALID_OWNER_KEY", message);
      }
      if (/chain|gap|stale|previousRecordDigest|current|missing|mismatch|Genesis|higher surviving|unexpected entry|non-canonical|duplicate epoch|empty while current|future/i.test(message)) {
        return readOnlyDecision("STALE_OR_BROKEN_CHAIN", message);
      }
      return readOnlyDecision("ANCHOR_UNAVAILABLE", message);
    }
  }

  async load(): Promise<AuthorityGrantV1 | null> {
    const decision = await this.evaluate();
    if (decision.effective !== "WRITER" || !decision.writerSystemInstanceId || decision.epoch === null) {
      return null;
    }
    // Inspection-only projection; V1 shape is not authoritative proof.
    return {
      schema: "aion.writer-authority.v1",
      systemInstanceId: decision.writerSystemInstanceId,
      authorityEpoch: decision.epoch,
      state: "WRITER",
      grantDirectiveId: "aion.authority-v2.projection",
      grantedAt: "1970-01-01T00:00:00.000Z",
      revokedAt: null,
      previousGrantDigest: null,
      digest: "0".repeat(64),
    };
  }

  async assertWritable(context = "persistent owner-state mutation"): Promise<AuthorityGrantV1> {
    const decision = await this.evaluate();
    if (decision.effective !== "WRITER") {
      fail(`Writer authority is READ_ONLY (${decision.reasonCode}); refusing ${context}. ${decision.detail}`);
    }
    const projection = await this.load();
    if (!projection) fail(`Writer authority projection missing after WRITER decision; refusing ${context}.`);
    return projection;
  }

  async applyOwnerCommand(): Promise<AuthorityGrantV1> {
    fail("Production runtime cannot apply owner authority commands; offline Owner signing is required.");
  }

  async bootstrapLegacyWriterIfAbsent(): Promise<{ created: boolean; grant: AuthorityGrantV1 | null }> {
    // Absence never creates WRITER under V2.
    return { created: false, grant: await this.load() };
  }
}

/**
 * Synthetic fixture helper (tests / demos only). Creates temp key + genesis WRITER anchor.
 * Never used for real Owner material.
 */
export async function createSyntheticOwnerAuthorityFixtureV2(input: {
  anchorRoot: string;
  systemInstanceId: string;
  state?: AuthorityStateV2;
  grantDirectiveId?: string;
  issuedAt?: string;
  anchorId?: string;
}): Promise<{
  trust: TrustedOwnerVerificationMaterialV2;
  privateKey: KeyObject;
  ownerKeyId: string;
  anchorId: string;
  systemInstanceId: string;
  anchor: FileOwnerAuthorityAnchorV2;
  offline: OfflineOwnerAuthorityWriterV2;
  runtime: OwnerAuthorityRuntimeV2;
  keys: ReturnType<typeof generateOwnerKeyPairV2ForTest>;
}> {
  if (!isSystemInstanceIdV1(input.systemInstanceId)) fail("Synthetic fixture systemInstanceId must be UUID v4.");
  const keys = generateOwnerKeyPairV2ForTest();
  const anchorId = input.anchorId ?? input.systemInstanceId;
  // Use a dedicated UUID for anchor if same as SI is ok for tests
  const anchor = new FileOwnerAuthorityAnchorV2(input.anchorRoot);
  const offline = new OfflineOwnerAuthorityWriterV2(anchor, keys.privateKey, keys.trust);
  const state = input.state ?? "WRITER";
  await offline.initializeGenesis({
    anchorId,
    state,
    writerSystemInstanceId: state === "WRITER" ? input.systemInstanceId : null,
    grantDirectiveId: input.grantDirectiveId ?? "AION-SYNTHETIC-TEST-GRANT",
    issuedAt: input.issuedAt ?? "2030-01-01T00:00:00.000Z",
  });
  const runtime = new OwnerAuthorityRuntimeV2({
    getTrustedOwner: () => keys.trust,
    getAnchorRoot: () => input.anchorRoot,
    getLocalSystemInstanceId: () => input.systemInstanceId,
  });
  return {
    trust: keys.trust,
    privateKey: keys.privateKey,
    ownerKeyId: keys.ownerKeyId,
    anchorId,
    systemInstanceId: input.systemInstanceId,
    anchor,
    offline,
    runtime,
    keys,
  };
}
