import { authorizeLocalPath, recheckAuthorizedPath } from "@aion/privacy-boundary";
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, readdir, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  ObjectErrorV1,
  type ObjectCommitRequestV1,
  type ObjectConstructionPortsV1,
  type ObjectEnvelopeV1,
  type ObjectIdV1,
  type ObjectRepository,
} from "./contracts.js";
import { parseCanonicalJsonV1 } from "./canonical.js";
import { asObjectIdV1, validateObjectEnvelopeV1 } from "./object.js";
import { validateObjectCommitV1 } from "./repository.js";

type ValidationPorts = Pick<ObjectConstructionPortsV1, "canonicalizer" | "digest" | "schemaRegistry">;

export interface FileObjectRepositoryHooksV1 {
  readonly beforeInstall?: (revision: number) => void | Promise<void>;
  readonly installTemporary?: (temporaryPath: string, finalPath: string) => Promise<void>;
}

export interface FileObjectRepositoryOptionsV1 {
  readonly approvedRootAbsolutePath: string;
  readonly approvedRootReference?: string;
  readonly validationPorts: ValidationPorts;
  readonly temporaryName?: () => string;
  readonly hooks?: FileObjectRepositoryHooksV1;
}

const DEVICE_OR_UNC_PREFIX = /^(?:\\\\[?.]\\|\\\?\?\\|\/\/[?.]\/|\\\\|\/\/)/;
const TEMPORARY_FILE = /^\.revision-[A-Za-z0-9_-]{1,80}\.tmp$/;
const REVISION_FILE = /^([1-9][0-9]*)\.aion$/;

function fail(code: "object-path-rejected" | "object-storage-invalid" | "commit-failed", location: string, message: string): never {
  throw new ObjectErrorV1(code, location, message);
}

function mapPersistenceError(error: unknown): ObjectErrorV1 {
  if (error instanceof ObjectErrorV1) return error;
  if ((error as NodeJS.ErrnoException | undefined)?.code === "EEXIST") {
    return new ObjectErrorV1("revision-conflict", "$.revision", "Object revision already exists.");
  }
  return new ObjectErrorV1("commit-failed", "$", "Object revision persistence failed.");
}

function mapStorageError(error: unknown): ObjectErrorV1 {
  if (error instanceof ObjectErrorV1) return error;
  return new ObjectErrorV1("object-storage-invalid", "$", "Object storage could not be read safely.");
}

async function bestEffortUnlink(path: string): Promise<void> {
  try { await unlink(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
  }
}

function exactBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((value, index) => value === right[index]);
}

export function deriveObjectStorageKeyV1(objectId: ObjectIdV1): string {
  const validated = asObjectIdV1(objectId);
  return createHash("sha256").update("aion.object.storage-key.v1\0", "utf8").update(validated, "utf8").digest("hex");
}

export class FileObjectRepositoryV1 implements ObjectRepository {
  readonly #root: string;
  readonly #reference: string;
  readonly #ports: ValidationPorts;
  readonly #temporaryName: () => string;
  readonly #hooks: FileObjectRepositoryHooksV1;

  constructor(options: FileObjectRepositoryOptionsV1) {
    const root = options.approvedRootAbsolutePath;
    if (typeof root !== "string" || root.length === 0 || root.trim() !== root
      || !isAbsolute(root) || resolve(root) !== root || DEVICE_OR_UNC_PREFIX.test(root)
      || basename(root).toLocaleLowerCase("en-US") !== "object-store"
      || basename(dirname(root)).toLocaleLowerCase("en-US") !== "private") {
      fail("object-path-rejected", "$.approvedRootAbsolutePath", "An explicit absolute private/object-store root is required.");
    }
    this.#root = root;
    this.#reference = options.approvedRootReference ?? "private-object-store";
    this.#ports = options.validationPorts;
    this.#temporaryName = options.temporaryName ?? (() => randomUUID());
    this.#hooks = options.hooks ?? {};
  }

  #authorized(path: string, operation: "read-file" | "write-file" | "list-directory"): string {
    const request = {
      version: "1" as const,
      operation,
      approvedRoot: { version: "1" as const, reference: this.#reference, absolutePath: this.#root },
      requestedPath: { version: "1" as const, absolutePath: path },
    };
    const first = authorizeLocalPath(request);
    if (!first.authorized) fail("object-path-rejected", "$", "Object store path failed privacy-boundary authorization.");
    const secondRequest = { ...request, requestedPath: { version: "1" as const, absolutePath: first.resolvedPath } };
    const second = recheckAuthorizedPath(secondRequest);
    if (!second.authorized) fail("object-path-rejected", "$", "Object store path failed privacy-boundary recheck.");
    return second.resolvedPath;
  }

  #paths(objectId: ObjectIdV1) {
    const key = deriveObjectStorageKeyV1(objectId);
    const versionRoot = join(this.#root, "v1");
    const objectsRoot = join(versionRoot, "objects");
    const objectRoot = join(objectsRoot, key);
    const revisionsRoot = join(objectRoot, "revisions");
    return { versionRoot, objectsRoot, objectRoot, revisionsRoot };
  }

  async #ensureDirectory(path: string): Promise<void> {
    const resolved = this.#authorized(path, "write-file");
    try {
      await mkdir(resolved, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw mapPersistenceError(error);
    }
    let state;
    try {
      state = await lstat(this.#authorized(resolved, "list-directory"));
    } catch (error) {
      throw mapStorageError(error);
    }
    if (!state.isDirectory()) fail("object-storage-invalid", "$", "Object store component is not a directory.");
  }

  async #ensureRevisionRoot(objectId: ObjectIdV1): Promise<string> {
    const paths = this.#paths(objectId);
    await this.#ensureDirectory(paths.versionRoot);
    await this.#ensureDirectory(paths.objectsRoot);
    await this.#ensureDirectory(paths.objectRoot);
    await this.#ensureDirectory(paths.revisionsRoot);
    return paths.revisionsRoot;
  }

  async #readChain(objectId: ObjectIdV1): Promise<readonly ObjectEnvelopeV1[]> {
    const { objectRoot, revisionsRoot } = this.#paths(objectId);
    let objectState;
    try {
      objectState = await lstat(this.#authorized(objectRoot, "list-directory"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw mapStorageError(error);
    }
    if (!objectState.isDirectory()) fail("object-storage-invalid", "$", "Object storage key is not a directory.");

    let objectEntries;
    try {
      objectEntries = await readdir(this.#authorized(objectRoot, "list-directory"), { withFileTypes: true });
    } catch (error) {
      throw mapStorageError(error);
    }
    if (objectEntries.length !== 1
      || objectEntries[0]?.name !== "revisions"
      || !objectEntries[0].isDirectory()) {
      fail("object-storage-invalid", "$", "Object storage key has an unexpected shape.");
    }

    let entries;
    try {
      entries = await readdir(this.#authorized(revisionsRoot, "list-directory"), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        fail("object-storage-invalid", "$", "Object revision directory is missing.");
      }
      throw mapStorageError(error);
    }
    const revisionEntries: { revision: number; name: string }[] = [];
    for (const entry of entries) {
      if (entry.isFile() && TEMPORARY_FILE.test(entry.name)) continue;
      const match = REVISION_FILE.exec(entry.name);
      if (!entry.isFile() || match === null) {
        fail("object-storage-invalid", "$", "Object revision directory contains an unexpected entry.");
      }
      const revision = Number(match[1]);
      if (!Number.isSafeInteger(revision)) fail("object-storage-invalid", "$", "Stored revision number is invalid.");
      revisionEntries.push({ revision, name: entry.name });
    }
    revisionEntries.sort((left, right) => left.revision - right.revision);
    if (revisionEntries.length === 0) return [];

    const history: ObjectEnvelopeV1[] = [];
    for (const [index, entry] of revisionEntries.entries()) {
      const expectedRevision = index + 1;
      if (entry.revision !== expectedRevision) fail("object-storage-invalid", "$.revision", "Object history contains a revision gap.");
      const path = this.#authorized(join(revisionsRoot, entry.name), "read-file");
      let bytes;
      try {
        bytes = await readFile(path);
      } catch (error) {
        throw mapStorageError(error);
      }
      const parsed = parseCanonicalJsonV1(bytes);
      const snapshot = validateObjectEnvelopeV1(parsed, this.#ports);
      const canonical = this.#ports.canonicalizer.canonicalize(snapshot);
      if (!exactBytes(bytes, canonical)) fail("object-storage-invalid", "$", "Stored Object bytes are not exact ACJ-1.");
      if (snapshot.objectId !== objectId || snapshot.revision !== expectedRevision) {
        fail("object-storage-invalid", "$.objectId", "Stored Object identity or revision does not match its path.");
      }
      validateObjectCommitV1(history.at(-1) ?? null, {
        expectedRevision: expectedRevision === 1 ? null : expectedRevision - 1,
        snapshot,
      }, this.#ports);
      history.push(snapshot);
    }
    return history;
  }

  async loadCurrent(objectId: ObjectIdV1): Promise<ObjectEnvelopeV1 | null> {
    asObjectIdV1(objectId);
    const history = await this.#readChain(objectId);
    return history.at(-1) ?? null;
  }

  async loadRevision(objectId: ObjectIdV1, revision: number): Promise<ObjectEnvelopeV1 | null> {
    asObjectIdV1(objectId);
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new ObjectErrorV1("invalid-object", "$.revision", "Requested revision is invalid.");
    }
    const history = await this.#readChain(objectId);
    return history[revision - 1] ?? null;
  }

  async commit(request: ObjectCommitRequestV1): Promise<void> {
    const candidate = validateObjectEnvelopeV1(request.snapshot, this.#ports);
    const history = await this.#readChain(candidate.objectId);
    const snapshot = validateObjectCommitV1(history.at(-1) ?? null, request, this.#ports);
    const revisionsRoot = await this.#ensureRevisionRoot(snapshot.objectId);
    const finalPath = this.#authorized(join(revisionsRoot, `${snapshot.revision}.aion`), "write-file");
    const temporaryName = this.#temporaryName();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(temporaryName)) {
      fail("commit-failed", "$", "Object revision temporary name is invalid.");
    }
    const temporaryPath = this.#authorized(join(revisionsRoot, `.revision-${temporaryName}.tmp`), "write-file");
    const bytes = this.#ports.canonicalizer.canonicalize(snapshot);
    let handle;
    let temporaryOwned = false;
    try {
      handle = await open(temporaryPath, "wx", 0o600);
      temporaryOwned = true;
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.#hooks.beforeInstall?.(snapshot.revision);
      await (this.#hooks.installTemporary ?? link)(temporaryPath, finalPath);
    } catch (error) {
      throw mapPersistenceError(error);
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      if (temporaryOwned) await bestEffortUnlink(temporaryPath);
    }
  }
}
