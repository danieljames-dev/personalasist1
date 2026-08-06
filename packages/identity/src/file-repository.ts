import { randomUUID } from "node:crypto";
import { link, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  IdentityErrorV1,
  validateLocalIdentityStateV1,
  type IdentityStateRepository,
  type LocalIdentityStateV1,
} from "./contracts.js";

export interface IdentityPathAuthorizationRequestV1 {
  readonly operation: "read-file" | "write-file";
  readonly approvedRootReference: string;
  readonly approvedRootAbsolutePath: string;
  readonly requestedAbsolutePath: string;
}

export type IdentityPathAuthorizationResultV1 =
  | { readonly authorized: true; readonly resolvedPath: string }
  | { readonly authorized: false; readonly reason: string };

export interface IdentityPathBoundary {
  authorize(request: IdentityPathAuthorizationRequestV1): IdentityPathAuthorizationResultV1;
  recheck(request: IdentityPathAuthorizationRequestV1): IdentityPathAuthorizationResultV1;
}

export interface FileIdentityStateRepositoryHooksV1 {
  readonly beforeInstall?: () => void | Promise<void>;
  readonly installTemporary?: (temporaryPath: string, finalPath: string) => Promise<void>;
}

export interface FileIdentityStateRepositoryOptionsV1 {
  readonly approvedRootAbsolutePath: string;
  readonly approvedRootReference?: string;
  readonly pathBoundary: IdentityPathBoundary;
  readonly temporaryName?: () => string;
  readonly hooks?: FileIdentityStateRepositoryHooksV1;
}

const STATE_NAME = "identity-state-v1.json";
const LOCK_NAME = ".identity-state-v1.lock";

function mapPersistenceError(error: unknown, fallback: string): IdentityErrorV1 {
  if (error instanceof IdentityErrorV1) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EEXIST") return new IdentityErrorV1("identity-state-conflict", "Identity state already exists.");
  return new IdentityErrorV1("identity-persistence-failed", fallback);
}

async function bestEffortUnlink(path: string): Promise<void> {
  try { await unlink(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
  }
}

export class FileIdentityStateRepository implements IdentityStateRepository {
  readonly statePath: string;
  readonly lockPath: string;
  private readonly root: string;
  private readonly reference: string;
  private readonly boundary: IdentityPathBoundary;
  private readonly temporaryName: () => string;
  private readonly hooks: FileIdentityStateRepositoryHooksV1;

  constructor(options: FileIdentityStateRepositoryOptionsV1) {
    this.root = options.approvedRootAbsolutePath;
    this.reference = options.approvedRootReference ?? "private-identity";
    this.boundary = options.pathBoundary;
    this.temporaryName = options.temporaryName ?? (() => randomUUID());
    this.hooks = options.hooks ?? {};
    this.statePath = join(this.root, STATE_NAME);
    this.lockPath = join(this.root, LOCK_NAME);
  }

  private request(path: string, operation: "read-file" | "write-file"): IdentityPathAuthorizationRequestV1 {
    return {
      operation,
      approvedRootReference: this.reference,
      approvedRootAbsolutePath: this.root,
      requestedAbsolutePath: path,
    };
  }

  private authorizedPath(path: string, operation: "read-file" | "write-file", recheck = false): string {
    const request = this.request(path, operation);
    const result = recheck ? this.boundary.recheck(request) : this.boundary.authorize(request);
    if (!result.authorized) throw new IdentityErrorV1("identity-path-rejected", "Identity path failed approved-root validation.");
    return result.resolvedPath;
  }

  async withExclusiveInitialization<T>(operation: () => Promise<T>): Promise<T> {
    const initialLockPath = this.authorizedPath(this.lockPath, "write-file");
    const lockPath = this.authorizedPath(initialLockPath, "write-file", true);
    let handle;
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new IdentityErrorV1("identity-lock-conflict", "Another Identity initialization holds the exclusive lock.");
      }
      throw mapPersistenceError(error, "Unable to acquire the Identity initialization lock.");
    }
    try {
      return await operation();
    } finally {
      try { await handle.close(); } finally { await bestEffortUnlink(lockPath); }
    }
  }

  async load(): Promise<unknown | null> {
    const initialStatePath = this.authorizedPath(this.statePath, "read-file");
    const statePath = this.authorizedPath(initialStatePath, "read-file", true);
    let serialized: string;
    try {
      serialized = await readFile(statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw mapPersistenceError(error, "Unable to read Identity state.");
    }
    try {
      return JSON.parse(serialized) as unknown;
    } catch {
      throw new IdentityErrorV1("identity-state-invalid", "Identity state is malformed.");
    }
  }

  async installNew(state: LocalIdentityStateV1): Promise<void> {
    validateLocalIdentityStateV1(state);
    const finalPath = this.authorizedPath(this.authorizedPath(this.statePath, "write-file"), "write-file", true);
    const temporaryPath = join(this.root, `.identity-state-v1.${this.temporaryName()}.tmp`);
    const resolvedTemporaryPath = this.authorizedPath(this.authorizedPath(temporaryPath, "write-file"), "write-file", true);
    let handle;
    let installed = false;
    try {
      handle = await open(resolvedTemporaryPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.hooks.beforeInstall?.();
      await (this.hooks.installTemporary ?? link)(resolvedTemporaryPath, finalPath);
      installed = true;
    } catch (error) {
      throw mapPersistenceError(error, "Unable to install Identity state atomically.");
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await bestEffortUnlink(resolvedTemporaryPath);
      if (!installed) {
        // The complete temporary file is never treated as canonical state.
      }
    }
  }
}

export interface IdentityExportRequestV1 {
  readonly state: LocalIdentityStateV1;
  readonly approvedRootAbsolutePath: string;
  readonly approvedRootReference?: string;
  readonly destinationAbsolutePath: string;
  readonly pathBoundary: IdentityPathBoundary;
  readonly temporaryName?: () => string;
}

export async function exportLocalIdentityStateV1(request: IdentityExportRequestV1): Promise<void> {
  const state = validateLocalIdentityStateV1(request.state);
  const boundaryRequest: IdentityPathAuthorizationRequestV1 = {
    operation: "write-file",
    approvedRootReference: request.approvedRootReference ?? "private-identity-export",
    approvedRootAbsolutePath: request.approvedRootAbsolutePath,
    requestedAbsolutePath: request.destinationAbsolutePath,
  };
  const first = request.pathBoundary.authorize(boundaryRequest);
  if (!first.authorized) throw new IdentityErrorV1("identity-path-rejected", "Identity export path was rejected.");
  const second = request.pathBoundary.recheck({ ...boundaryRequest, requestedAbsolutePath: first.resolvedPath });
  if (!second.authorized) throw new IdentityErrorV1("identity-path-rejected", "Identity export path was rejected on recheck.");
  const temporaryPath = join(request.approvedRootAbsolutePath, `.identity-export-v1.${(request.temporaryName ?? (() => randomUUID()))()}.tmp`);
  const tempRequest = { ...boundaryRequest, requestedAbsolutePath: temporaryPath };
  const tempFirst = request.pathBoundary.authorize(tempRequest);
  if (!tempFirst.authorized) throw new IdentityErrorV1("identity-path-rejected", "Identity export temporary path was rejected.");
  const tempSecond = request.pathBoundary.recheck({ ...tempRequest, requestedAbsolutePath: tempFirst.resolvedPath });
  if (!tempSecond.authorized) throw new IdentityErrorV1("identity-path-rejected", "Identity export temporary path was rejected on recheck.");
  let handle;
  try {
    handle = await open(tempSecond.resolvedPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(tempSecond.resolvedPath, second.resolvedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new IdentityErrorV1("identity-export-conflict", "Identity export destination already exists.");
    }
    throw mapPersistenceError(error, "Unable to export Identity state atomically.");
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await bestEffortUnlink(tempSecond.resolvedPath);
  }
}
