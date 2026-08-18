/**
 * The real filesystem, exposed through the read-only surface this package is allowed to use.
 *
 * `realpathSync.native` rather than the JavaScript implementation, because the native one is what
 * resolves junctions and reparse points on Windows — and those are exactly the aliases the path
 * boundary exists to catch. It also emits the long form of an 8.3 short name, which is what makes
 * `isResolvedHostPath` usable on the result.
 *
 * Files are read as UTF-8 text. There is no binary path here on purpose: a source adapter that
 * cannot express a byte read cannot be talked into ingesting an archive or an image.
 */

import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { validateOwnerAuthorityRecord, type OwnerAuthorityRecordV1 } from "./authority.js";
import type { FileStatV1, PersonalContextFsV1 } from "./path-boundary.js";

export function createNodePersonalContextFs(): PersonalContextFsV1 {
  return {
    realpathSync(path) {
      return realpathSync.native(path);
    },
    lstatSync(path): FileStatV1 {
      const stat = lstatSync(path);
      return {
        isDirectory: () => stat.isDirectory(),
        isFile: () => stat.isFile(),
        isSymbolicLink: () => stat.isSymbolicLink(),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    },
    readdirSync(path) {
      return readdirSync(path);
    },
    readFileSync(path) {
      return readFileSync(path, "utf8");
    },
  };
}

/**
 * Read one durable Owner authority record, or `null` when there is not a usable one.
 *
 * `null` rather than a throw, and rather than a partially-trusted object: a record that cannot be
 * read or does not validate must not become authority. The caller then falls back to the default
 * ceiling, which is the fail-closed direction.
 *
 * The id is checked against a strict pattern before it becomes a path segment, so a caller cannot
 * traverse out of the authority directory by naming an authorization.
 */
export function readOwnerAuthorityRecord(
  repositoryRoot: string,
  ownerAuthorizationId: string,
): OwnerAuthorityRecordV1 | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ownerAuthorizationId)) return null;
  const path = join(repositoryRoot, ".aion-local", "owner-authority", `${ownerAuthorizationId}.json`);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (validateOwnerAuthorityRecord(parsed) !== null) return null;
  return parsed as OwnerAuthorityRecordV1;
}
