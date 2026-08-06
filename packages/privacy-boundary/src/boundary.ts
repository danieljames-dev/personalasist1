import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, parse, relative, resolve, sep } from "node:path";

import type {
  PathAuthorizationRequestV1,
  PathAuthorizationResultV1,
  PathBoundaryReasonV1,
} from "./types.js";

const DEVICE_PREFIX = /^(?:\\\\[?.]\\|\\\?\?\\|\/\/[?.]\/)/;
const UNC_PREFIX = /^(?:\\\\|\/\/)/;
const ALLOWED_EXTENSIONS = new Set([".json", ".md", ".txt"]);

function reject(
  request: PathAuthorizationRequestV1,
  reason: PathBoundaryReasonV1,
  remediation: string,
): PathAuthorizationResultV1 {
  return {
    version: "1",
    authorized: false,
    error: {
      version: "1",
      reason,
      operation: request.operation,
      approvedRootReference: request.approvedRoot.reference || "unidentified-root",
      remediation,
    },
  };
}

function isMalformed(value: unknown): boolean {
  return typeof value !== "string" || value.length === 0 || value.trim() !== value || value.includes("\0");
}

function comparisonPath(value: string): string {
  const normalized = resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function isContained(root: string, candidate: string, allowRoot: boolean): boolean {
  const rootKey = comparisonPath(root);
  const candidateKey = comparisonPath(candidate);
  return (allowRoot && candidateKey === rootKey) || candidateKey.startsWith(`${rootKey}${sep}`);
}

function nearestExisting(path: string): string {
  let cursor = path;
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return cursor;
    cursor = parent;
  }
  return cursor;
}

export function authorizeLocalPath(request: PathAuthorizationRequestV1): PathAuthorizationResultV1 {
  const root = request.approvedRoot.absolutePath;
  const requested = request.requestedPath.absolutePath;

  if (isMalformed(root) || isMalformed(request.approvedRoot.reference)) {
    return reject(request, "approved-root-invalid", "Supply a named, absolute approved root.");
  }
  if (isMalformed(requested)) {
    return reject(request, "requested-path-invalid", "Supply one explicit local path.");
  }
  if (DEVICE_PREFIX.test(root) || DEVICE_PREFIX.test(requested)) {
    return reject(request, "device-path-rejected", "Use a normal local filesystem path.");
  }
  if (UNC_PREFIX.test(root) || UNC_PREFIX.test(requested)) {
    return reject(request, "unc-path-rejected", "Use an explicitly approved local volume path.");
  }
  if (!isAbsolute(root) || !isAbsolute(requested)) {
    return reject(request, "relative-path-rejected", "Resolve the path explicitly before requesting access.");
  }
  if (parse(root).root.toLocaleLowerCase("en-US") !== parse(requested).root.toLocaleLowerCase("en-US")) {
    return reject(request, "cross-volume-rejected", "Select a path on the approved root volume.");
  }
  if (!existsSync(root)) {
    return reject(request, "approved-root-missing", "Create and approve the local root explicitly.");
  }
  if (!statSync(root).isDirectory()) {
    return reject(request, "approved-root-not-directory", "Approve a directory root.");
  }

  const canonicalRoot = realpathSync.native(root);
  if (!isContained(canonicalRoot, requested, request.allowApprovedRoot === true)) {
    return reject(
      request,
      comparisonPath(requested) === comparisonPath(canonicalRoot)
        ? "approved-root-target-rejected"
        : "path-outside-approved-root",
      "Select a child path beneath the approved root.",
    );
  }

  const existingParent = nearestExisting(requested);
  const canonicalParent = realpathSync.native(existingParent);
  const unresolvedTail = relative(existingParent, requested);
  const canonicalCandidate = resolve(canonicalParent, unresolvedTail);
  if (!isContained(canonicalRoot, canonicalCandidate, request.allowApprovedRoot === true)) {
    return reject(request, "link-or-reparse-escape", "Remove the escaping link or select a contained path.");
  }

  return {
    version: "1",
    authorized: true,
    operation: request.operation,
    approvedRootReference: request.approvedRoot.reference,
    resolvedPath: canonicalCandidate,
  };
}

export function authorizeLocalTextInput(request: PathAuthorizationRequestV1): PathAuthorizationResultV1 {
  const authorization = authorizeLocalPath(request);
  if (!authorization.authorized) return authorization;
  if (!existsSync(authorization.resolvedPath) || !lstatSync(authorization.resolvedPath).isFile()) {
    return reject(request, "target-not-file", "Select an existing regular file.");
  }
  if (!ALLOWED_EXTENSIONS.has(extname(authorization.resolvedPath).toLocaleLowerCase("en-US"))) {
    return reject(request, "unsupported-extension", "Select a JSON, Markdown, or text file.");
  }
  return authorization;
}

export function recheckAuthorizedPath(request: PathAuthorizationRequestV1): PathAuthorizationResultV1 {
  return authorizeLocalPath(request);
}
