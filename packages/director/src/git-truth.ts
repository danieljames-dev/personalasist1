/**
 * Checking what Git says, not what an executor said.
 *
 * An executor reports the SHA it produced. That report is evidence and nothing more: a model can
 * state a SHA it never created, a branch it never attached, a clean tree that is dirty. Every
 * guarantee the Director offers rests on the difference between "the executor said" and "the
 * repository shows", so this module never accepts the former.
 *
 * ## Pure decisions, injected facts
 *
 * Reading Git needs a process; deciding whether the reading is acceptable does not. Everything here
 * takes a plain snapshot of facts and returns a verdict, which is why the awkward cases — a
 * detached HEAD, a remote that moved mid-run, an unexpected large artifact — are testable without a
 * repository at all. The caller owns the spawning; this owns the judgement.
 *
 * ## What is forbidden outright
 *
 * Some Git operations cannot be made safe by automation, only by a person who understands what they
 * are about to lose. Reset, force-push, rebasing accepted history, blind clean and blind stash are
 * refused by name rather than by policy lookup, so no configuration mistake can enable them.
 */
import type { IsoTimestamp } from "./contracts.js";

export const GIT_TRUTH_SCHEMA_V1 = "aion.director.git-truth.v1" as const;

/** A reading of a repository at one moment. Supplied by the caller; never fetched here. */
export interface GitSnapshotV1 {
  worktreePath: string;
  /** Null when HEAD is detached — which is itself a finding, not a detail. */
  attachedBranch: string | null;
  head: string;
  localBranchHead: string | null;
  remoteBranchHead: string | null;
  originMainHead: string | null;
  /** Paths reported by `status --porcelain`. Empty means clean. */
  dirtyPaths: readonly string[];
  /** Tracked files over the size the Director considers worth questioning. */
  largeTrackedFiles: ReadonlyArray<{ path: string; bytes: number }>;
  readAt: IsoTimestamp;
}

export interface GitExpectationV1 {
  expectedBranch?: string | null;
  expectedHead?: string | null;
  /** The SHA the executor claims it produced. Compared, never trusted. */
  claimedHead?: string | null;
  /** HEAD must be a descendant of this, when integration is in view. */
  mustDescendFrom?: string | null;
  /** Ancestry is supplied by the caller because only Git can answer it. */
  descendsFromExpected?: boolean | null;
  requireClean?: boolean;
  requireLocalEqualsRemote?: boolean;
}

export type GitFindingKindV1 =
  | "DETACHED_HEAD"
  | "BRANCH_MISMATCH"
  | "HEAD_MISMATCH"
  | "CLAIMED_HEAD_MISMATCH"
  | "NOT_A_DESCENDANT"
  | "DIRTY_WORKTREE"
  | "LOCAL_REMOTE_DIVERGED"
  | "UNEXPECTED_LARGE_ARTIFACT";

export interface GitFindingV1 {
  kind: GitFindingKindV1;
  detail: string;
  /** True when this alone should stop a mission rather than merely be reported. */
  blocking: boolean;
}

export interface GitVerdictV1 {
  schema: typeof GIT_TRUTH_SCHEMA_V1;
  ok: boolean;
  findings: GitFindingV1[];
  snapshot: GitSnapshotV1;
}

/**
 * Anything tracked and larger than this is worth a human glance.
 *
 * Set from experience rather than taste: a 5.2 MB tesseract language file reached a commit through
 * a broad `git add`, passed every cleanliness check that looked for images, keys and secrets, and
 * was only caught when a fast-forward refused to overwrite an untracked copy of it. Size is the
 * signal those checks were missing.
 */
export const LARGE_TRACKED_FILE_BYTES = 1_048_576;

export function verifyGitTruth(
  snapshot: GitSnapshotV1,
  expectation: GitExpectationV1 = {},
): GitVerdictV1 {
  const findings: GitFindingV1[] = [];

  if (expectation.expectedBranch !== undefined && expectation.expectedBranch !== null) {
    if (snapshot.attachedBranch === null) {
      // The detached-HEAD case is called out separately because it has a specific failure story:
      // a commit made there is reachable by nothing, and a push reports success while updating a
      // branch that never moved.
      findings.push({
        kind: "DETACHED_HEAD",
        detail: "HEAD is detached; a commit here belongs to no branch and a push would not carry it",
        blocking: true,
      });
    } else if (snapshot.attachedBranch !== expectation.expectedBranch) {
      findings.push({
        kind: "BRANCH_MISMATCH",
        detail: `on ${snapshot.attachedBranch}, expected ${expectation.expectedBranch}`,
        blocking: true,
      });
    }
  }

  if (expectation.expectedHead && snapshot.head !== expectation.expectedHead) {
    findings.push({
      kind: "HEAD_MISMATCH",
      detail: `HEAD is ${snapshot.head}, expected ${expectation.expectedHead}`,
      blocking: true,
    });
  }

  if (expectation.claimedHead && snapshot.head !== expectation.claimedHead) {
    findings.push({
      kind: "CLAIMED_HEAD_MISMATCH",
      detail: `executor claimed ${expectation.claimedHead}, repository shows ${snapshot.head}`,
      blocking: true,
    });
  }

  if (expectation.mustDescendFrom && expectation.descendsFromExpected === false) {
    findings.push({
      kind: "NOT_A_DESCENDANT",
      detail: `${snapshot.head} does not descend from ${expectation.mustDescendFrom}; this is not a fast-forward`,
      blocking: true,
    });
  }

  if (expectation.requireClean && snapshot.dirtyPaths.length > 0) {
    findings.push({
      kind: "DIRTY_WORKTREE",
      detail: `${snapshot.dirtyPaths.length} uncommitted path(s): ${snapshot.dirtyPaths.slice(0, 4).join(", ")}`,
      blocking: true,
    });
  }

  if (
    expectation.requireLocalEqualsRemote
    && snapshot.localBranchHead
    && snapshot.remoteBranchHead
    && snapshot.localBranchHead !== snapshot.remoteBranchHead
  ) {
    findings.push({
      kind: "LOCAL_REMOTE_DIVERGED",
      detail: `local ${snapshot.localBranchHead} vs remote ${snapshot.remoteBranchHead}; a push reporting success is not proof`,
      blocking: true,
    });
  }

  for (const file of snapshot.largeTrackedFiles) {
    if (file.bytes < LARGE_TRACKED_FILE_BYTES) continue;
    findings.push({
      kind: "UNEXPECTED_LARGE_ARTIFACT",
      detail: `${file.path} is ${(file.bytes / 1_048_576).toFixed(1)} MB and tracked; generated files do not belong in history`,
      // Reported rather than blocking: some large files are legitimate, and a person should look.
      blocking: false,
    });
  }

  return {
    schema: GIT_TRUTH_SCHEMA_V1,
    ok: findings.every((finding) => !finding.blocking),
    findings,
    snapshot,
  };
}

/**
 * Git operations the Director will not perform, whatever a mission or a model asks.
 *
 * Named individually rather than pattern-matched, so the list is auditable and no configuration can
 * quietly extend it. Each destroys work that no later step can reconstruct.
 */
export const FORBIDDEN_GIT_OPERATIONS: readonly string[] = [
  "reset --hard",
  "push --force",
  "push -f",
  "rebase",
  "filter-repo",
  "filter-branch",
  "clean -fd",
  "clean -fdx",
  "stash",
  "commit --amend",
];

export function isForbiddenGitOperation(argv: readonly string[]): { forbidden: boolean; matched: string | null } {
  const line = argv.join(" ").toLowerCase();
  for (const op of FORBIDDEN_GIT_OPERATIONS) {
    if (line.includes(op)) return { forbidden: true, matched: op };
  }
  return { forbidden: false, matched: null };
}

/** One-line summary for an event or a dashboard. */
export function describeVerdict(verdict: GitVerdictV1): string {
  if (verdict.ok && verdict.findings.length === 0) return "repository matches expectations";
  if (verdict.ok) return `acceptable, with ${verdict.findings.length} thing(s) worth a look`;
  const blocking = verdict.findings.filter((f) => f.blocking);
  return blocking.map((f) => f.detail).join("; ");
}
