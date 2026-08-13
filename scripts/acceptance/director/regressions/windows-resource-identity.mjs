/**
 * Host path classification, resolution, and resource identity.
 *
 * Three separate functions. None of them is "not empty and not escaping."
 */
import fs from "node:fs";
import path from "node:path";

const DEVICE_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

export const PATH_CLASS = Object.freeze({
  ABSOLUTE_DRIVE: "ABSOLUTE_DRIVE",
  UNC_ABSOLUTE: "UNC_ABSOLUTE",
  DEVICE_NAMESPACE: "DEVICE_NAMESPACE",
  DRIVE_RELATIVE: "DRIVE_RELATIVE",
  ROOTED_DRIVELESS: "ROOTED_DRIVELESS",
  RELATIVE: "RELATIVE",
  INVALID: "INVALID",
});

export const ACCEPTED_IDENTITY_CLASSES = Object.freeze([
  PATH_CLASS.ABSOLUTE_DRIVE,
  PATH_CLASS.UNC_ABSOLUTE,
]);

export const REJECTED_IDENTITY_CLASSES = Object.freeze([
  PATH_CLASS.DRIVE_RELATIVE,
  PATH_CLASS.ROOTED_DRIVELESS,
  PATH_CLASS.RELATIVE,
  PATH_CLASS.INVALID,
  PATH_CLASS.DEVICE_NAMESPACE,
]);

function isSep(ch) {
  return ch === "\\" || ch === "/";
}

function stripTrailingDotsSpaces(name) {
  return name.replace(/[ .]+$/g, "");
}

export function segmentIsReservedDevice(segment) {
  if (!segment) return false;
  const trimmed = stripTrailingDotsSpaces(segment);
  const base = trimmed.split(":").shift() || "";
  return DEVICE_RE.test(base) || DEVICE_RE.test(trimmed);
}

export function classifyHostPath(input) {
  if (typeof input !== "string" || input.length === 0) {
    return { class: PATH_CLASS.INVALID, reason: "empty", acceptedForIdentity: false };
  }
  if (input.includes("\0")) {
    return { class: PATH_CLASS.INVALID, reason: "nul", acceptedForIdentity: false };
  }

  const parts = input.split(/[\\/]+/).filter(Boolean);
  for (const part of parts) {
    if (segmentIsReservedDevice(part)) {
      return { class: PATH_CLASS.INVALID, reason: "reserved-device", acceptedForIdentity: false, device: part };
    }
  }

  const ns = input.match(/^[/\\]{2}([.?])[/\\](.*)$/);
  if (ns) {
    const rest = ns[2] || "";
    if (/^UNC[/\\]/i.test(rest)) {
      const unc = rest.slice(4);
      const bits = unc.split(/[/\\]+/).filter(Boolean);
      if (bits.length < 2) {
        return { class: PATH_CLASS.INVALID, reason: "malformed-unc-namespace", acceptedForIdentity: false };
      }
      return {
        class: PATH_CLASS.DEVICE_NAMESPACE,
        reason: "unc-via-device-namespace",
        acceptedForIdentity: false,
        peelTo: PATH_CLASS.UNC_ABSOLUTE,
      };
    }
    if (/^[A-Za-z]:/.test(rest)) {
      return {
        class: PATH_CLASS.DEVICE_NAMESPACE,
        reason: "drive-via-device-namespace",
        acceptedForIdentity: false,
        peelTo: PATH_CLASS.ABSOLUTE_DRIVE,
      };
    }
    return { class: PATH_CLASS.DEVICE_NAMESPACE, reason: "device-or-unknown-namespace", acceptedForIdentity: false };
  }

  if (/^[/\\]{2}/.test(input)) {
    const bits = input.replace(/^[/\\]{2}/, "").split(/[/\\]+/).filter(Boolean);
    if (bits.length < 2) {
      return { class: PATH_CLASS.INVALID, reason: "malformed-unc", acceptedForIdentity: false };
    }
    if (segmentIsReservedDevice(bits[0]) || segmentIsReservedDevice(bits[1])) {
      return { class: PATH_CLASS.INVALID, reason: "reserved-device-unc", acceptedForIdentity: false };
    }
    return { class: PATH_CLASS.UNC_ABSOLUTE, reason: "unc-absolute", acceptedForIdentity: true };
  }

  if (/^[A-Za-z]:$/.test(input) || (/^[A-Za-z]:/.test(input) && !isSep(input[2]))) {
    return { class: PATH_CLASS.DRIVE_RELATIVE, reason: "drive-relative", acceptedForIdentity: false };
  }

  if (/^[A-Za-z]:[\\/]/.test(input)) {
    const afterDrive = input.slice(2);
    if (afterDrive.includes(":")) {
      return { class: PATH_CLASS.INVALID, reason: "ads-or-extra-colon", acceptedForIdentity: false };
    }
    return { class: PATH_CLASS.ABSOLUTE_DRIVE, reason: "absolute-drive", acceptedForIdentity: true };
  }

  if (input[0] === "\\" || input[0] === "/") {
    return { class: PATH_CLASS.ROOTED_DRIVELESS, reason: "rooted-driveless", acceptedForIdentity: false };
  }

  return { class: PATH_CLASS.RELATIVE, reason: "relative", acceptedForIdentity: false };
}

export function syntaxNormalizeDriveOrUnc(input) {
  const cls = classifyHostPath(input);
  if (!cls.acceptedForIdentity) return { ok: false, class: cls };
  const unified = input.replace(/\//g, "\\");
  const collapsed = unified.replace(/\\{2,}/g, (m, offset) => (offset === 0 ? m : "\\"));
  return { ok: true, class: cls.class, normalized: collapsed };
}

export function peelDeviceNamespace(input) {
  const m = input.match(/^[/\\]{2}[.?][/\\](.*)$/);
  if (!m) return input;
  const rest = m[1];
  if (/^UNC[/\\]/i.test(rest)) return `\\\\${rest.replace(/^UNC[/\\]/i, "")}`;
  return rest;
}

export function resolveExistingHostPath(input) {
  const rawClass = classifyHostPath(input);
  if (!rawClass.acceptedForIdentity) {
    if (rawClass.class === PATH_CLASS.DEVICE_NAMESPACE && rawClass.peelTo) {
      return resolveExistingHostPath(peelDeviceNamespace(input));
    }
    return { ok: false, reason: "class-not-accepted", classification: rawClass };
  }
  let real;
  try {
    real = fs.realpathSync.native(input);
  } catch (error) {
    return { ok: false, reason: "realpath-failed", message: error.message, classification: rawClass };
  }
  const after = classifyHostPath(real);
  if (!after.acceptedForIdentity) {
    return { ok: false, reason: "realpath-not-accepted-class", classification: after, real };
  }
  let st;
  try {
    st = fs.statSync(real);
  } catch (error) {
    return { ok: false, reason: "stat-failed", message: error.message, real };
  }
  return {
    ok: true,
    real,
    dev: st.dev,
    ino: st.ino,
    classification: after,
  };
}

export function hostResourceIdentity(resolved) {
  if (!resolved?.ok) return { ok: false, reason: resolved?.reason || "unresolved" };
  const id = `fs:${resolved.dev}:${resolved.ino}:${String(resolved.real).toLowerCase()}`;
  return {
    ok: true,
    kind: "EXISTING_FS",
    key: id,
    real: resolved.real,
    dev: resolved.dev,
    ino: resolved.ino,
  };
}

export function identityForExistingResource(input) {
  return hostResourceIdentity(resolveExistingHostPath(input));
}

/**
 * Future lock path: resolve the existing parent, then append the leaf
 * as syntax only. The leaf never grants filesystem authority.
 */
export function identityForFutureLock(existingResourceInput, lockFileName) {
  if (!lockFileName || /[\\/]/.test(lockFileName) || segmentIsReservedDevice(lockFileName) || lockFileName.includes("\0")) {
    return { ok: false, reason: "illegal-lock-leaf" };
  }
  const parent = identityForExistingResource(existingResourceInput);
  if (!parent.ok) return parent;
  return {
    ok: true,
    kind: "FUTURE_LOCK_UNDER_EXISTING",
    key: `${parent.key}|lock:${lockFileName.toLowerCase()}`,
    parent: parent.real,
    leaf: lockFileName,
  };
}

export function resourceIdentity(kind, spec) {
  switch (kind) {
    case "WORKTREE":
      return { ...identityForExistingResource(spec.path), type: "WORKTREE" };
    case "PREVIEW":
      return { ...identityForExistingResource(spec.path), type: "PREVIEW", role: "PREVIEW_ROOT" };
    case "PRODUCTION_WRITER":
      return { ok: true, type: "PRODUCTION_WRITER", key: `singleton:production-writer:${spec.instanceId || "default"}` };
    case "INTEGRATION":
      return { ok: true, type: "INTEGRATION", key: `singleton:integration:${spec.repositoryId || "default"}` };
    case "BRANCH": {
      const repo = spec.repositoryId || spec.repoPath;
      const ref = spec.refName || spec.branch;
      if (!repo || !ref) return { ok: false, reason: "branch-needs-repo-and-ref" };
      return { ok: true, type: "BRANCH", key: `branch:${String(repo).toLowerCase()}#${String(ref).toLowerCase()}` };
    }
    default:
      return { ok: false, reason: "unknown-resource-kind" };
  }
}

function foldWin(p) {
  return p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

export function pathIsInside(rootInput, candidateInput) {
  if (rootInput == null || rootInput === "") {
    return { ok: false, inside: false, reason: "NO_ROOT_MEANS_DENY" };
  }
  const rootClass = classifyHostPath(rootInput);
  const candClass = classifyHostPath(candidateInput);
  if (!rootClass.acceptedForIdentity && !(rootClass.class === PATH_CLASS.DEVICE_NAMESPACE && rootClass.peelTo)) {
    return { ok: false, inside: false, reason: "ROOT_CLASS_REJECTED", classification: rootClass };
  }
  if (!candClass.acceptedForIdentity && !(candClass.class === PATH_CLASS.DEVICE_NAMESPACE && candClass.peelTo)) {
    return { ok: false, inside: false, reason: "CANDIDATE_CLASS_REJECTED", classification: candClass };
  }

  const rootRes = resolveExistingHostPath(rootInput);
  const candRes = resolveExistingHostPath(candidateInput);
  if (!rootRes.ok) return { ok: false, inside: false, reason: "ROOT_UNRESOLVED", detail: rootRes };
  if (!candRes.ok) {
    const peeled = peelDeviceNamespace(candidateInput);
    const cls = classifyHostPath(peeled);
    if (!cls.acceptedForIdentity) return { ok: false, inside: false, reason: "CANDIDATE_UNRESOLVED", detail: candRes };
    const rootFold = foldWin(rootRes.real);
    const candFold = foldWin(path.win32.normalize(peeled));
    if (candFold === rootFold) return { ok: true, inside: true, how: "syntax-under-resolved-root" };
    if (candFold.startsWith(`${rootFold}\\`)) return { ok: true, inside: true, how: "syntax-under-resolved-root" };
    return { ok: true, inside: false, how: "syntax-outside" };
  }
  const rootFold = foldWin(rootRes.real);
  const candFold = foldWin(candRes.real);
  if (candFold === rootFold) return { ok: true, inside: true, how: "same-identity" };
  if (candFold.startsWith(`${rootFold}\\`)) return { ok: true, inside: true, how: "child-identity" };
  return { ok: true, inside: false, how: "outside" };
}

/** Defective class used only to prove regressions would catch the known bug. */
export function defectiveSlashCaseKey(input) {
  return String(input || "").replace(/\\/g, "/").toLowerCase();
}
