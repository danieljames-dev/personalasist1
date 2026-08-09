/**
 * Trusted observation ports (R6.5-R1 M-1, M-3, M-7).
 *
 * REQUEST-SUPPLIED FACTS ARE NEVER TRUSTED OBSERVATIONS.
 * Envelope values are EXPECTATIONS. Ports produce OBSERVATIONS.
 * Production composition constructs ports internally; tests may inject fakes.
 */

import { execFileSync } from "node:child_process";
import { createHash as cryptoHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, win32 } from "node:path";
import { hostname } from "node:os";
import { DelegatedOperatorError } from "./contracts.js";

export interface HostFactsV1 {
  readonly machineName: string;
  readonly machineRole: string;
}

export interface RepositoryFactsV1 {
  readonly repositoryRoot: string;
  readonly canonicalOrigin: string;
  readonly branch: string;
  readonly headCommit: string;
}

export interface GitFactsV1 {
  readonly repositoryRoot: string;
  readonly headCommit: string;
  readonly branch: string;
  readonly canonicalOrigin: string;
  readonly originMainCommit: string | null;
  readonly isOrdinaryForwardFromBaseline: boolean;
  readonly workingTreeClean: boolean;
}

export interface HostFactsPort {
  observe(): HostFactsV1;
}

export interface RepositoryFactsPort {
  /** Observe the repository the Host is bound to (not caller path alone). */
  observeBoundRepository(): RepositoryFactsV1;
}

export interface GitFactsPort {
  /**
   * Independently establish Git state for the bound repository.
   * baselineCommit is an EXPECTATION from the envelope; ancestry is OBSERVED.
   */
  observe(baselineCommit: string, allowOrdinaryForward: boolean): GitFactsV1;
}

export interface BrokerIntegrityPort {
  /** Expected digests from protected installation state (not from caller). */
  expectedDigests(): Readonly<Record<string, string>>;
  /** Measure actual artifacts independently. */
  measureActualDigests(): Readonly<Record<string, string>>;
}

export interface ProtectedInstallLayoutV1 {
  readonly installRoot: string;
  readonly stateRoot: string;
  readonly binaryRelative: string;
  readonly policyRelative: string;
  readonly templatesRelative: string;
  readonly serviceDefinitionRelative: string;
}

/** Future protected layout (not deployed in R6.5-R1). */
export const DEFAULT_PROTECTED_INSTALL_LAYOUT: ProtectedInstallLayoutV1 = {
  installRoot: "C:\\Program Files\\AION\\ElevatedOperatorBroker",
  stateRoot: "C:\\ProgramData\\AION\\ElevatedOperatorBroker",
  binaryRelative: "bin\\aion-elevated-broker.exe",
  policyRelative: "config\\policy.v1.json",
  templatesRelative: "templates",
  serviceDefinitionRelative: "service\\aion-elevated-broker.xml",
};

/**
 * Canonicalize a Windows path for protected-root comparison (R6.5-R2 M-4).
 * Resolves relative segments, device/UNC aliases, reparse points on existing
 * prefixes, and expands standard 8.3 short-name aliases. Does not require the
 * final path to exist (future install roots).
 */
export function canonicalizeProtectionPath(input: string): string {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) {
    return "";
  }
  let p = input.trim();
  if (!p) return "";

  // Device / extended-length prefixes
  if (p.startsWith("\\\\?\\UNC\\")) p = "\\\\" + p.slice("\\\\?\\UNC\\".length);
  else if (p.startsWith("\\\\?\\")) p = p.slice(4);
  else if (p.startsWith("\\\\.\\")) p = p.slice(4);

  // Localhost admin share -> drive path
  const uncLocal = /^\\\\(localhost|127\.0\.0\.1)\\([A-Za-z])\$\\?/i.exec(p);
  if (uncLocal) {
    p = `${uncLocal[2]!.toUpperCase()}:\\${p.slice(uncLocal[0].length)}`;
  }

  p = p.replace(/\//g, "\\");
  // Collapse . / .. without requiring existence
  try {
    p = isAbsolute(p) || /^[A-Za-z]:/.test(p) ? win32.normalize(p) : win32.resolve(p);
  } catch {
    p = win32.normalize(p);
  }

  // Expand 8.3 / reparse for every existing prefix
  p = expandExistingPrefixes(p);
  // Standard short-name rewrites for well-known Windows directories (English)
  p = applyStandardShortNameAliases(p);
  // Second pass after alias rewrite
  p = expandExistingPrefixes(p);

  return normalizePath(p);
}

/**
 * True when target addresses a protected install/state root under any Windows
 * path alias that resolves to the same final identity. Does not depend on the
 * substring "broker" appearing in the caller path.
 */
export function isPathUnderProtectedRoot(
  targetPath: string,
  layout: ProtectedInstallLayoutV1 = DEFAULT_PROTECTED_INSTALL_LAYOUT,
): boolean {
  const candidates = protectionPathCandidates(targetPath);
  if (candidates.size === 0) return false;
  const roots = new Set<string>();
  for (const root of [layout.installRoot, layout.stateRoot]) {
    for (const c of protectionPathCandidates(root)) roots.add(c);
  }
  for (const candidate of candidates) {
    for (const root of roots) {
      if (!root) continue;
      if (candidate === root || candidate.startsWith(root + "\\")) return true;
    }
  }
  return false;
}

/** Ordinary repo write must never treat protected roots as in-repo paths. */
export function refuseIfWriteTargetsProtectedRoot(
  args: Readonly<Record<string, string>>,
  layout: ProtectedInstallLayoutV1 = DEFAULT_PROTECTED_INSTALL_LAYOUT,
): void {
  for (const v of Object.values(args)) {
    if (typeof v !== "string" || !v) continue;
    // Any arg value that resolves into a protected root is refused.
    if (isPathUnderProtectedRoot(v, layout)) {
      throw new DelegatedOperatorError(
        "protected-install-root",
        "Write to OS-protected broker install/state root requires separate high-consequence maintenance envelope",
      );
    }
  }
}

function protectionPathCandidates(input: string): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    const n = normalizePath(s);
    if (n) out.add(n);
  };
  add(input);
  add(canonicalizeProtectionPath(input));
  add(applyStandardShortNameAliases(input));
  // Case / separator only
  add(input.replace(/\//g, "\\"));
  return out;
}

function applyStandardShortNameAliases(p: string): string {
  let s = p.replace(/\//g, "\\");
  // Common English Windows 8.3 aliases (defense in depth when path does not exist yet)
  s = s.replace(/(^|[\\/])PROGRA~1([\\/]|$)/gi, "$1Program Files$2");
  s = s.replace(/(^|[\\/])PROGRA~2([\\/]|$)/gi, "$1Program Files (x86)$2");
  s = s.replace(/(^|[\\/])PROGRA~3([\\/]|$)/gi, "$1ProgramData$2");
  // ElevatedOperatorBroker short forms vary; expand known pattern used in attacks
  s = s.replace(/(^|[\\/])ELEVAT~1([\\/]|$)/gi, "$1ElevatedOperatorBroker$2");
  return s;
}

function expandExistingPrefixes(absolutePath: string): string {
  const p = absolutePath.replace(/\//g, "\\");
  if (!p) return p;

  const tryReal = (target: string): string => {
    try {
      return realpathSync.native(target);
    } catch {
      try {
        return realpathSync(target);
      } catch {
        return target;
      }
    }
  };

  const match = /^([A-Za-z]:)(.*)$/.exec(p);
  if (!match) {
    return existsSync(p) ? tryReal(p) : p;
  }
  const drive = match[1]!.toUpperCase();
  const segments = (match[2] ?? "").split("\\").filter((s) => s.length > 0);
  let acc = drive + "\\";
  for (let i = 0; i < segments.length; i++) {
    const next = join(acc, segments[i]!);
    if (existsSync(next)) {
      // Resolve reparse points / junctions / short names of existing nodes
      void lstatSync(next);
      acc = tryReal(next);
    } else {
      for (let j = i; j < segments.length; j++) {
        acc = join(acc, segments[j]!);
      }
      break;
    }
  }
  return acc;
}

export class StaticHostFactsPort implements HostFactsPort {
  constructor(private readonly facts: HostFactsV1) {}
  observe(): HostFactsV1 {
    return this.facts;
  }
}

export class StaticRepositoryFactsPort implements RepositoryFactsPort {
  constructor(private readonly facts: RepositoryFactsV1) {}
  observeBoundRepository(): RepositoryFactsV1 {
    return this.facts;
  }
}

export class StaticGitFactsPort implements GitFactsPort {
  constructor(private readonly facts: Omit<GitFactsV1, "isOrdinaryForwardFromBaseline"> & {
    readonly forwardFrom?: ReadonlyMap<string, boolean>;
  }) {}
  observe(baselineCommit: string, allowOrdinaryForward: boolean): GitFactsV1 {
    const forward =
      this.facts.headCommit === baselineCommit
        ? true
        : allowOrdinaryForward
          ? (this.facts.forwardFrom?.get(`${baselineCommit}->${this.facts.headCommit}`) === true)
          : false;
    return {
      repositoryRoot: this.facts.repositoryRoot,
      headCommit: this.facts.headCommit,
      branch: this.facts.branch,
      canonicalOrigin: this.facts.canonicalOrigin,
      originMainCommit: this.facts.originMainCommit,
      isOrdinaryForwardFromBaseline: forward,
      workingTreeClean: this.facts.workingTreeClean,
    };
  }
}

/**
 * Production-oriented Git adapter using fixed git argv (no shell).
 * Fail closed on any error.
 */
export class ExecGitFactsPort implements GitFactsPort {
  constructor(private readonly repositoryRoot: string) {}

  observe(baselineCommit: string, allowOrdinaryForward: boolean): GitFactsV1 {
    const root = resolve(this.repositoryRoot);
    const run = (args: string[]): string => {
      try {
        return execFileSync("git", args, {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        }).trim();
      } catch {
        throw new DelegatedOperatorError("git-facts-unavailable", `Unable to obtain Git facts: git ${args.join(" ")}`);
      }
    };
    const headCommit = run(["rev-parse", "HEAD"]);
    const branch = run(["branch", "--show-current"]);
    const canonicalOrigin = run(["remote", "get-url", "origin"]);
    let originMainCommit: string | null = null;
    try {
      originMainCommit = run(["rev-parse", "origin/main"]);
    } catch {
      originMainCommit = null;
    }
    const dirty = run(["status", "--porcelain=v1", "-uall"]);
    let isOrdinaryForwardFromBaseline = headCommit === baselineCommit;
    if (!isOrdinaryForwardFromBaseline && allowOrdinaryForward) {
      try {
        const mergeBase = run(["merge-base", baselineCommit, headCommit]);
        // Ordinary forward: baseline is ancestor of HEAD and not equal (or equal already handled)
        isOrdinaryForwardFromBaseline = mergeBase === baselineCommit;
        // Refuse if history rewritten such that HEAD is not descendant
        if (mergeBase !== baselineCommit) isOrdinaryForwardFromBaseline = false;
      } catch {
        isOrdinaryForwardFromBaseline = false;
      }
    }
    return {
      repositoryRoot: root,
      headCommit,
      branch,
      canonicalOrigin,
      originMainCommit,
      isOrdinaryForwardFromBaseline,
      workingTreeClean: dirty.length === 0,
    };
  }
}

export class ProcessHostFactsPort implements HostFactsPort {
  constructor(private readonly machineRole: string) {}
  observe(): HostFactsV1 {
    return { machineName: hostname(), machineRole: this.machineRole };
  }
}

export class FixedRepositoryFactsPort implements RepositoryFactsPort {
  constructor(
    private readonly repositoryRoot: string,
    private readonly originFallback?: string,
  ) {}
  observeBoundRepository(): RepositoryFactsV1 {
    const root = resolve(this.repositoryRoot);
    try {
      const git = new ExecGitFactsPort(root);
      const g = git.observe("0".repeat(40), false);
      return {
        repositoryRoot: root,
        canonicalOrigin: g.canonicalOrigin,
        branch: g.branch,
        headCommit: g.headCommit,
      };
    } catch {
      if (this.originFallback) {
        throw new DelegatedOperatorError("repo-facts-unavailable", "Repository facts unavailable");
      }
      throw new DelegatedOperatorError("repo-facts-unavailable", "Repository facts unavailable");
    }
  }
}

export class ManifestBrokerIntegrityPort implements BrokerIntegrityPort {
  constructor(
    private readonly expected: Readonly<Record<string, string>>,
    private readonly measure: () => Readonly<Record<string, string>>,
  ) {}
  expectedDigests(): Readonly<Record<string, string>> {
    return this.expected;
  }
  measureActualDigests(): Readonly<Record<string, string>> {
    return this.measure();
  }
}

export function digestsMatch(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): boolean {
  const ek = Object.keys(expected).sort();
  const ak = Object.keys(actual).sort();
  if (ek.length === 0 || ek.length !== ak.length) return false;
  for (let i = 0; i < ek.length; i++) {
    if (ek[i] !== ak[i]) return false;
    const e = expected[ek[i]!];
    const a = actual[ak[i]!];
    if (!e || !a || e !== a) return false;
  }
  return true;
}

export function hashFile(path: string): string {
  return cryptoHash("sha256").update(readFileSync(path)).digest("hex");
}

export function hashTreeFiles(root: string, relativeFiles: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of relativeFiles) {
    const p = join(root, rel);
    if (!existsSync(p) || !statSync(p).isFile()) {
      throw new DelegatedOperatorError("integrity-missing", `Missing integrity subject: ${rel}`);
    }
    out[rel] = hashFile(p);
  }
  return out;
}

function normalizePath(p: string): string {
  return p.replace(/\//g, "\\").replace(/\\+$/u, "").toLowerCase();
}
