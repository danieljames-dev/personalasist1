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
 * ## Absence is never agreement
 *
 * The failure this module keeps having to relearn is the false pass: a required check that quietly
 * succeeds because the fact it needed was missing. A required local-equals-remote comparison with no
 * remote reading is not a match, it is an unanswered question; a snapshot taken ten minutes ago is
 * not current truth. Every requirement the caller sets is therefore answered with a finding when the
 * evidence to answer it is absent, rather than skipped.
 *
 * ## What is forbidden outright
 *
 * Some Git operations cannot be made safe by automation, only by a person who understands what they
 * are about to lose. Reset, force-push, rebasing accepted history, blind clean and blind stash are
 * refused by classifying the argv — subcommand first, then its own flags — because the substring
 * matching this used to do is wrong in both directions: it refused `git stash list`, which only
 * prints, and it allowed `git push origin +main`, which is a force-push written in refspec syntax.
 *
 * ## Large artifacts: the finding and the policy are separate
 *
 * Size is the signal, classification is a hint, and blocking is the caller's policy. A 5 MB file
 * appearing in history is always worth saying out loud; whether it stops a mission depends on the
 * repository, which is why nothing here hardcodes a filename and the default policy reports without
 * blocking.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { IsoTimestamp } from "./contracts.js";
import { rememberMeasurementApparatusPid } from "./process-identity.js";

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
  /**
   * Demand that HEAD be on a branch without naming which one.
   *
   * Attachment and identity are different questions. A caller that only knows work must land
   * somewhere pushable — a run about to commit, before its branch has been chosen — still needs the
   * detached case caught, and previously could only get that by inventing an expected branch name.
   */
  requireAttachedBranch?: boolean;
  /**
   * How old the snapshot may be before it stops counting as current truth.
   *
   * Supplying this is what makes freshness a requirement; `now` is the instant it is measured
   * against. Both are needed, and a missing `now` is reported rather than treated as fresh.
   */
  maxSnapshotAgeMs?: number;
  now?: IsoTimestamp | null;
  /** Overrides the default report-but-never-block stance on large tracked files. */
  largeArtifactPolicy?: LargeArtifactPolicyV1;
}

export type GitFindingKindV1 =
  | "DETACHED_HEAD"
  | "BRANCH_MISMATCH"
  | "HEAD_MISMATCH"
  | "HEAD_REF_INCONSISTENT"
  | "CLAIMED_HEAD_MISMATCH"
  | "NOT_A_DESCENDANT"
  | "DIRTY_WORKTREE"
  | "LOCAL_REMOTE_DIVERGED"
  | "REMOTE_STATE_UNKNOWN"
  | "STALE_SNAPSHOT"
  | "SNAPSHOT_AGE_UNKNOWN"
  | "UNEXPECTED_LARGE_ARTIFACT";

export interface GitFindingV1 {
  kind: GitFindingKindV1;
  detail: string;
  /** True when this alone should stop a mission rather than merely be reported. */
  blocking: boolean;
  /** The file a finding is about, when it is about one. */
  path?: string;
  /** What a large tracked file looks like. A hint for a person, never a proof of anything. */
  artifactClass?: LargeArtifactClassV1;
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

/**
 * What a large tracked file resembles.
 *
 * Derived from the name alone, so it is a prompt for a person and not a verdict: a repository that
 * legitimately ships a model checkpoint produces `MODEL_WEIGHTS` for a file that belongs there.
 * The class exists so a caller can write policy ("state dumps stop a mission here") without this
 * module deciding on its behalf, and so no single filename ever has to be written into the code.
 */
export type LargeArtifactClassV1 =
  | "TRAINED_DATA"
  | "MODEL_WEIGHTS"
  | "DATA_OR_STATE_DUMP"
  | "ARCHIVE"
  | "BINARY"
  | "UNCLASSIFIED";

const ARTIFACT_CLASS_BY_EXTENSION: ReadonlyMap<string, LargeArtifactClassV1> = new Map<string, LargeArtifactClassV1>([
  ["traineddata", "TRAINED_DATA"],
  ["model", "TRAINED_DATA"],
  ["safetensors", "MODEL_WEIGHTS"],
  ["ckpt", "MODEL_WEIGHTS"],
  ["pt", "MODEL_WEIGHTS"],
  ["pth", "MODEL_WEIGHTS"],
  ["onnx", "MODEL_WEIGHTS"],
  ["gguf", "MODEL_WEIGHTS"],
  ["ggml", "MODEL_WEIGHTS"],
  ["tflite", "MODEL_WEIGHTS"],
  ["h5", "MODEL_WEIGHTS"],
  ["npz", "MODEL_WEIGHTS"],
  ["npy", "MODEL_WEIGHTS"],
  ["db", "DATA_OR_STATE_DUMP"],
  ["sqlite", "DATA_OR_STATE_DUMP"],
  ["sqlite3", "DATA_OR_STATE_DUMP"],
  ["mdb", "DATA_OR_STATE_DUMP"],
  ["rdb", "DATA_OR_STATE_DUMP"],
  ["dump", "DATA_OR_STATE_DUMP"],
  ["sql", "DATA_OR_STATE_DUMP"],
  ["bak", "DATA_OR_STATE_DUMP"],
  ["zip", "ARCHIVE"],
  ["tar", "ARCHIVE"],
  ["gz", "ARCHIVE"],
  ["tgz", "ARCHIVE"],
  ["bz2", "ARCHIVE"],
  ["xz", "ARCHIVE"],
  ["7z", "ARCHIVE"],
  ["rar", "ARCHIVE"],
  ["iso", "ARCHIVE"],
  ["exe", "BINARY"],
  ["msi", "BINARY"],
  ["dll", "BINARY"],
  ["so", "BINARY"],
  ["dylib", "BINARY"],
  ["node", "BINARY"],
  ["wasm", "BINARY"],
  ["bin", "BINARY"],
  ["obj", "BINARY"],
  ["lib", "BINARY"],
  ["pdb", "BINARY"],
]);

const ARTIFACT_CLASS_PROSE: Readonly<Record<LargeArtifactClassV1, string>> = {
  TRAINED_DATA: "trained model data",
  MODEL_WEIGHTS: "model weights",
  DATA_OR_STATE_DUMP: "a database or state dump",
  ARCHIVE: "an archive",
  BINARY: "a compiled binary",
  UNCLASSIFIED: "",
};

/** Policy the caller sets over the finding this module always makes. */
export interface LargeArtifactPolicyV1 {
  /** At or above this many bytes a tracked file is reported. */
  reportAtBytes?: number;
  /** At or above this many bytes the report also stops the mission. Null means size never blocks. */
  blockAtBytes?: number | null;
  /** Classes that stop a mission once reported, whatever their size. */
  blockingClasses?: readonly LargeArtifactClassV1[];
  /** Paths a person has already looked at and accepted. Still reported, never blocking. */
  acceptedPaths?: readonly string[];
}

/**
 * Report, never block.
 *
 * The default has to be this way round because the alternative is worse than the problem: a
 * repository that legitimately tracks a large asset would fail every mission until someone
 * discovered where the threshold lived, and the usual fix for that is to stop reporting at all.
 */
export const DEFAULT_LARGE_ARTIFACT_POLICY: {
  readonly reportAtBytes: number;
  readonly blockAtBytes: number | null;
  readonly blockingClasses: readonly LargeArtifactClassV1[];
  readonly acceptedPaths: readonly string[];
} = {
  reportAtBytes: LARGE_TRACKED_FILE_BYTES,
  blockAtBytes: null,
  blockingClasses: [],
  acceptedPaths: [],
};

/** Name-based guess at what a large file is. Extension only, which is why nothing acts on it alone. */
export function classifyLargeArtifact(path: string): LargeArtifactClassV1 {
  const base = (path.split(/[\\/]/).pop() ?? path).toLowerCase();
  const dot = base.lastIndexOf(".");
  // A leading dot is a dotfile, not an extension, so `.env` is not treated as an `env` type.
  if (dot <= 0) return "UNCLASSIFIED";
  return ARTIFACT_CLASS_BY_EXTENSION.get(base.slice(dot + 1)) ?? "UNCLASSIFIED";
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

export function verifyGitTruth(
  source: GitSnapshotV1 | GitObservationV1,
  expectation: GitExpectationV1 = {},
): GitVerdictV1 {
  if (isGitObservation(source)) {
    return verifyGitObservation(source, expectation);
  }
  return verifyGitObservation(observationFromSnapshot(source), expectation);
}

function isGitObservation(value: GitSnapshotV1 | GitObservationV1): value is GitObservationV1 {
  return "schema" in value && value.schema === GIT_OBSERVATION_SCHEMA_V1;
}

function observationFromSnapshot(snapshot: GitSnapshotV1): GitObservationV1 {
  const emptyCommand = { argv: [] as string[], status: null, stdout: "", stderr: "", error: "snapshot-adapter" };
  const head = snapshot.head !== ""
    ? { outcome: "FOUND" as const, sha: snapshot.head }
    : { outcome: "UNAVAILABLE" as const, reason: "snapshot head is empty", command: emptyCommand };
  const branch = snapshot.attachedBranch !== null
    ? { outcome: "ATTACHED" as const, name: snapshot.attachedBranch }
    : { outcome: "DETACHED" as const };
  const branchHead = snapshot.localBranchHead !== null
    ? { outcome: "FOUND" as const, sha: snapshot.localBranchHead }
    : undefined;
  const status = snapshot.dirtyPaths.length === 0
    ? { outcome: "CLEAN" as const, porcelain: "" as const }
    : { outcome: "DIRTY" as const, porcelain: snapshot.dirtyPaths.join("\n"), dirtyPaths: snapshot.dirtyPaths };
  const localSha = snapshot.localBranchHead;
  const remoteSha = snapshot.remoteBranchHead;
  const upstream = localSha === null || remoteSha === null
    ? { outcome: "UNAVAILABLE" as const, reason: "snapshot remote/local branch head is missing", command: emptyCommand }
    : {
      outcome: "TRACKING" as const,
      name: "origin",
      ahead: localSha === remoteSha ? 0 : 1,
      behind: 0,
    };
  return {
    schema: GIT_OBSERVATION_SCHEMA_V1,
    worktreePath: snapshot.worktreePath,
    collectedAt: snapshot.readAt,
    head,
    branch,
    upstream,
    status,
    ...(branchHead !== undefined ? { branchHead } : {}),
    largeTrackedFiles: { outcome: "FOUND", files: snapshot.largeTrackedFiles },
  };
}


/**
 * Judge a collector observation. Absence is never agreement: UNAVAILABLE status is not a
 * clean tree, UNAVAILABLE HEAD is not the claimed SHA, and a missing upstream is not
 * "local equals remote".
 */
function verifyGitObservation(
  observation: GitObservationV1,
  expectation: GitExpectationV1,
): GitVerdictV1 {
  const snapshot = snapshotFromObservation(observation);
  const findings: GitFindingV1[] = [];

  if (expectation.maxSnapshotAgeMs !== undefined) {
    const readAt = Date.parse(observation.collectedAt);
    const now = expectation.now ? Date.parse(expectation.now) : Number.NaN;
    const ageMs = now - readAt;
    if (!Number.isFinite(ageMs)) {
      findings.push({
        kind: "SNAPSHOT_AGE_UNKNOWN",
        detail: `freshness was required within ${expectation.maxSnapshotAgeMs}ms but the observation's age cannot be established from collectedAt=${observation.collectedAt} and now=${expectation.now ?? "(absent)"}`,
        blocking: true,
      });
    } else if (ageMs < 0) {
      findings.push({
        kind: "SNAPSHOT_AGE_UNKNOWN",
        detail: `the observation was collected ${-ageMs}ms after the instant it is being judged at; the clocks disagree and an age cannot be trusted`,
        blocking: true,
      });
    } else if (ageMs > expectation.maxSnapshotAgeMs) {
      findings.push({
        kind: "STALE_SNAPSHOT",
        detail: `the reading is ${ageMs}ms old and freshness within ${expectation.maxSnapshotAgeMs}ms was required; this describes the repository as it was, not as it is`,
        blocking: true,
      });
    }
  }

  const branchNamed = expectation.expectedBranch !== undefined && expectation.expectedBranch !== null;
  const requireAttached = branchNamed || expectation.requireAttachedBranch === true;

  if (observation.branch.outcome === "UNAVAILABLE" && requireAttached) {
    findings.push({
      kind: "BRANCH_MISMATCH",
      detail: `branch is unavailable; a missing reading is not attachment to ${expectation.expectedBranch ?? "a branch"}: ${observation.branch.reason}`,
      blocking: true,
    });
  } else if (observation.branch.outcome === "DETACHED" && requireAttached) {
    findings.push({
      kind: "DETACHED_HEAD",
      detail: "HEAD is detached; a commit here belongs to no branch and a push would not carry it",
      blocking: true,
    });
  } else if (
    observation.branch.outcome === "ATTACHED"
    && branchNamed
    && observation.branch.name !== expectation.expectedBranch
  ) {
    findings.push({
      kind: "BRANCH_MISMATCH",
      detail: `on ${observation.branch.name}, expected ${expectation.expectedBranch}`,
      blocking: true,
    });
  }

  const branchHead = observation.branchHead;
  if (observation.head.outcome === "FOUND" && branchHead?.outcome === "FOUND") {
    if (observation.head.sha !== branchHead.sha) {
      const ref = observation.branch.outcome === "ATTACHED" ? observation.branch.name : "the recorded local branch ref";
      findings.push({
        kind: "HEAD_REF_INCONSISTENT",
        detail: `HEAD is ${observation.head.sha} but ${ref} points at ${branchHead.sha}; the working state and the branch are not the same commit`,
        blocking: true,
      });
    }
  } else if (observation.branch.outcome === "ATTACHED" && branchHead?.outcome === "UNAVAILABLE") {
    findings.push({
      kind: "HEAD_REF_INCONSISTENT",
      detail: `UNKNOWN: branch ref could not be read (${branchHead.reason}); HEAD and the branch ref were not both observed`,
      blocking: false,
    });
  } else if (observation.branch.outcome === "DETACHED" && branchHead?.outcome === "NOT_APPLICABLE") {
    findings.push({
      kind: "HEAD_REF_INCONSISTENT",
      detail: "UNKNOWN: HEAD is detached; no branch ref to compare",
      blocking: false,
    });
  }

  if (observation.head.outcome === "UNAVAILABLE") {
    if (expectation.expectedHead) {
      findings.push({
        kind: "HEAD_MISMATCH",
        detail: `HEAD is unavailable; a missing reading is not ${expectation.expectedHead}: ${observation.head.reason}`,
        blocking: true,
      });
    }
    if (expectation.claimedHead) {
      findings.push({
        kind: "CLAIMED_HEAD_MISMATCH",
        detail: `executor claimed ${expectation.claimedHead}, repository HEAD is unavailable: ${observation.head.reason}`,
        blocking: true,
      });
    }
  } else {
    if (expectation.expectedHead && observation.head.sha !== expectation.expectedHead) {
      findings.push({
        kind: "HEAD_MISMATCH",
        detail: `HEAD is ${observation.head.sha}, expected ${expectation.expectedHead}`,
        blocking: true,
      });
    }
    if (expectation.claimedHead && observation.head.sha !== expectation.claimedHead) {
      findings.push({
        kind: "CLAIMED_HEAD_MISMATCH",
        detail: `executor claimed ${expectation.claimedHead}, repository shows ${observation.head.sha}`,
        blocking: true,
      });
    }
  }

  if (expectation.mustDescendFrom && expectation.descendsFromExpected === false) {
    const headText = observation.head.outcome === "FOUND" ? observation.head.sha : "unavailable HEAD";
    findings.push({
      kind: "NOT_A_DESCENDANT",
      detail: `${headText} does not descend from ${expectation.mustDescendFrom}; this is not a fast-forward`,
      blocking: true,
    });
  }

  if (expectation.requireClean) {
    if (observation.status.outcome === "UNAVAILABLE") {
      findings.push({
        kind: "DIRTY_WORKTREE",
        detail: `a clean worktree was required but status is unavailable; a missing reading is not a clean tree: ${observation.status.reason}`,
        blocking: true,
      });
    } else if (observation.status.outcome === "DIRTY") {
      findings.push({
        kind: "DIRTY_WORKTREE",
        detail: `${observation.status.dirtyPaths.length} uncommitted path(s): ${observation.status.dirtyPaths.slice(0, 4).join(", ")}`,
        blocking: true,
      });
    }
  }

  if (expectation.requireLocalEqualsRemote) {
    if (observation.upstream.outcome === "TRACKING") {
      if (observation.upstream.ahead !== 0 || observation.upstream.behind !== 0) {
        findings.push({
          kind: "LOCAL_REMOTE_DIVERGED",
          detail: `local is ahead ${observation.upstream.ahead} and behind ${observation.upstream.behind} ${observation.upstream.name}; a push reporting success is not proof`,
          blocking: true,
        });
      }
    } else {
      const missing = observation.upstream.outcome === "NO_UPSTREAM"
        ? "no upstream is configured"
        : observation.upstream.outcome === "NOT_APPLICABLE"
          ? "upstream does not apply (HEAD is detached)"
          : "the upstream reading is unavailable";
      findings.push({
        kind: "REMOTE_STATE_UNKNOWN",
        detail: `local was required to equal remote but ${missing}; a missing reading is an unanswered question, not agreement`,
        blocking: true,
      });
    }
  }

  if (observation.largeTrackedFiles?.outcome === "FOUND") {
    const policy = expectation.largeArtifactPolicy ?? {};
    const reportAtBytes = policy.reportAtBytes ?? DEFAULT_LARGE_ARTIFACT_POLICY.reportAtBytes;
    const blockAtBytes = policy.blockAtBytes ?? DEFAULT_LARGE_ARTIFACT_POLICY.blockAtBytes;
    const blockingClasses = policy.blockingClasses ?? DEFAULT_LARGE_ARTIFACT_POLICY.blockingClasses;
    const acceptedPaths = (policy.acceptedPaths ?? DEFAULT_LARGE_ARTIFACT_POLICY.acceptedPaths).map(normalizePath);
    for (const file of observation.largeTrackedFiles.files) {
      if (file.bytes < reportAtBytes) continue;
      const artifactClass = classifyLargeArtifact(file.path);
      const accepted = acceptedPaths.includes(normalizePath(file.path));
      const blocking = !accepted
        && ((blockAtBytes !== null && file.bytes >= blockAtBytes) || blockingClasses.includes(artifactClass));
      const looksLike = ARTIFACT_CLASS_PROSE[artifactClass];
      findings.push({
        kind: "UNEXPECTED_LARGE_ARTIFACT",
        detail: `${file.path} is ${(file.bytes / 1_048_576).toFixed(1)} MB and tracked${looksLike ? `, and looks like ${looksLike} by name alone` : ""}; generated files do not belong in history`,
        blocking,
        path: file.path,
        artifactClass,
      });
    }
  }

  return {
    schema: GIT_TRUTH_SCHEMA_V1,
    ok: findings.every((finding) => !finding.blocking),
    findings,
    snapshot,
  };
}

function snapshotFromObservation(observation: GitObservationV1): GitSnapshotV1 {
  const attachedBranch = observation.branch.outcome === "ATTACHED" ? observation.branch.name : null;
  const head = observation.head.outcome === "FOUND" ? observation.head.sha : "";
  const dirtyPaths = observation.status.outcome === "DIRTY" ? observation.status.dirtyPaths : [];
  const localBranchHead = observation.branchHead?.outcome === "FOUND" ? observation.branchHead.sha : null;
  const largeTrackedFiles = observation.largeTrackedFiles?.outcome === "FOUND"
    ? observation.largeTrackedFiles.files
    : [];
  return {
    worktreePath: observation.worktreePath,
    attachedBranch,
    head,
    localBranchHead,
    remoteBranchHead: null,
    originMainHead: null,
    dirtyPaths,
    largeTrackedFiles,
    readAt: observation.collectedAt,
  };
}

/**
 * Git operations the Director will not perform, whatever a mission or a model asks.
 *
 * A readable inventory of what `isForbiddenGitOperation` refuses, and the label each refusal
 * reports. It is not the matcher: matching on these strings is what produced both a refused
 * `git stash list` and an allowed `git push origin +main`. Every entry here, run as `git <entry>`,
 * is refused by the classifier — that correspondence is asserted in the tests, so the list cannot
 * drift into decoration.
 */
export const FORBIDDEN_GIT_OPERATIONS: readonly string[] = [
  "reset --hard",
  "push --force",
  "push -f",
  "push +refspec",
  "push --mirror",
  "push --delete",
  "rebase",
  "filter-repo",
  "filter-branch",
  "clean -fd",
  "clean -fdx",
  "stash",
  "commit --amend",
];

/** Options that sit before the subcommand and consume the token after them. */
const GIT_GLOBAL_OPTIONS_WITH_VALUE: ReadonlySet<string> = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix",
]);

function isGitExecutable(token: string): boolean {
  const base = (token.split(/[\\/]/).pop() ?? token).toLowerCase();
  return base === "git" || base === "git.exe";
}

/**
 * Split an argv into the subcommand and its own arguments.
 *
 * Only as much parsing as the decision needs: strip a leading `git`, step over the global options
 * that precede a subcommand (`-C <path>`, `-c k=v`, `--no-pager`), and take the first bare word.
 * No shell is involved, so no shell grammar is required.
 */
function parseGitInvocation(argv: readonly string[]): { subcommand: string; args: readonly string[] } | null {
  let index = 0;
  const first = argv[0];
  if (first !== undefined && isGitExecutable(first)) index = 1;

  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined || !token.startsWith("-")) break;
    index += GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token) ? 2 : 1;
  }

  const subcommand = argv[index];
  if (subcommand === undefined) return null;
  return { subcommand: subcommand.toLowerCase(), args: argv.slice(index + 1) };
}

/** `--flag` or `--flag=value`. */
function hasLongFlag(args: readonly string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

/** A short flag, including bundled forms: `-f`, and the `-f` inside `-fd` and `-qf`. */
function hasShortFlag(args: readonly string[], letter: string): boolean {
  return args.some((arg) => /^-[A-Za-z]+$/.test(arg) && arg.slice(1).includes(letter));
}

/** The first argument that is not an option — a subcommand's own verb, where it has one. */
function firstPositional(args: readonly string[]): string | null {
  for (const arg of args) {
    if (!arg.startsWith("-")) return arg;
  }
  return null;
}

/**
 * Whether an argv is an operation the Director refuses to run.
 *
 * Classified per subcommand, because the dangerous part of a Git command line is never the word
 * `git`. Three cases drive the shape of this: `git stash list` prints and must be allowed while a
 * bare `git stash` moves the worktree and must not; `git push origin +main` is a force-push with no
 * `--force` anywhere in it; and `git clean` is judged by the absence of `--dry-run` rather than the
 * presence of `-fd`, since `-fdx`, `-xdf` and a configured `clean.requireForce=false` all delete.
 */
export function isForbiddenGitOperation(
  argv: readonly string[],
): { forbidden: boolean; matched: string | null; reason: string } {
  const invocation = parseGitInvocation(argv);
  if (invocation === null) return { forbidden: false, matched: null, reason: "no git subcommand" };

  const { subcommand, args } = invocation;
  const matched = ((): string | null => {
    switch (subcommand) {
      case "reset":
        // `--soft` and `--mixed` keep the working tree; only `--hard` discards it.
        return hasLongFlag(args, "--hard") ? "reset --hard" : null;

      case "push": {
        // A leading `+` on a refspec is the force marker, and the form a model reaches for when a
        // plain push has just been rejected.
        if (args.some((arg) => arg.startsWith("+"))) return "push +refspec";
        // Covers `--force-with-lease` and `--force-if-includes` too: safer than `--force`, still a
        // remote history the Director overwrote on its own judgement.
        if (args.some((arg) => arg.startsWith("--force"))) return "push --force";
        if (hasShortFlag(args, "f")) return "push -f";
        if (hasLongFlag(args, "--mirror")) return "push --mirror";
        if (hasLongFlag(args, "--delete") || hasShortFlag(args, "d")) return "push --delete";
        return null;
      }

      // No carve-out for `--abort` or `--continue`: a rebase in progress means the Director is
      // already somewhere it should not have got to, and the recovery belongs to a person.
      case "rebase":
        return "rebase";
      case "filter-repo":
        return "filter-repo";
      case "filter-branch":
        return "filter-branch";

      case "clean": {
        if (hasLongFlag(args, "--dry-run") || hasShortFlag(args, "n")) return null;
        return hasShortFlag(args, "x") || hasShortFlag(args, "X") ? "clean -fdx" : "clean -fd";
      }

      case "stash": {
        // `list` and `show` only read. Everything else — including a bare `git stash`, which is an
        // implicit `push` — takes the worktree away and leaves the executor building nothing.
        const verb = firstPositional(args);
        return verb === "list" || verb === "show" ? null : "stash";
      }

      case "commit":
        // Amending replaces a commit another run may already have recorded the SHA of.
        return hasLongFlag(args, "--amend") ? "commit --amend" : null;

      default:
        return null;
    }
  })();

  if (matched === null) {
    return { forbidden: false, matched: null, reason: `git ${subcommand} is not a refused operation` };
  }
  return {
    forbidden: true,
    matched,
    reason: `refused: ${matched} destroys work no later step can reconstruct`,
  };
}

/** One-line summary for an event or a dashboard. */
export function describeVerdict(verdict: GitVerdictV1): string {
  if (verdict.ok && verdict.findings.length === 0) return "repository matches expectations";
  if (verdict.ok) return `acceptable, with ${verdict.findings.length} thing(s) worth a look`;
  const blocking = verdict.findings.filter((f) => f.blocking);
  return blocking.map((f) => f.detail).join("; ");
}

/**
 * What Git actually says, collected by the Director itself.
 *
 * {@link verifyGitTruth} judges a snapshot it is handed. That snapshot has to come from
 * somewhere, and it must not come from the executor: `headAfter` on a handoff is testimony.
 * This collector is the corroboration — the Director runs Git and records the answers.
 *
 * ## Argv arrays, never a shell string
 *
 * PowerShell treats `@{upstream}` as a hashtable literal. That has already bitten this project
 * four times. Git is invoked as `spawnSync(exe, argv, { shell: false })` with an argv array.
 * Never `git rev-parse --abbrev-ref @{upstream}` as a string, never `git ${args.join(" ")}`,
 * never `shell: true`. The token `@{upstream}` is one argv element. Do not "simplify" this
 * into a command line later.
 *
 * ## Absence, detachment, and failure are different states
 *
 * A missing upstream is not an error and not "ahead 0 / behind 0". A detached HEAD is not a
 * branch named `HEAD` and not a missing repository. A `git status` that failed is not a clean
 * tree: empty porcelain and a failed status command must never look the same, because one
 * means clean.
 *
 * The runner is injected so those cases are testable without a repository. One test against
 * this real worktree confirms the runner actually talks to Git.
 */
export const GIT_OBSERVATION_SCHEMA_V1 = "aion.director.git-observation.v1" as const;

const GIT_SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/i;
const AHEAD_BEHIND = /^(\d+)\s+(\d+)$/;
const NO_UPSTREAM = /no upstream configured/i;

export interface GitCommandResultV1 {
  readonly argv: readonly string[];
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Spawn failure (ENOENT, timeout). Null when Git itself ran and produced a status. */
  readonly error: string | null;
  /** Directory the runner executed this command in. Absent means the runner did not say. */
  readonly cwd?: string | null;
}

/**
 * Runs one Git command as an argv array with no shell.
 *
 * Implementations must pass `argv` through to the process unchanged. Joining it into a string
 * reintroduces the `@{upstream}` hashtable hazard.
 */
export interface GitRunner {
  run(argv: readonly string[]): GitCommandResultV1;
  /**
   * Directory Git commands actually execute in.
   *
   * The collector records this, never a caller-supplied label. A runner that does not
   * know where it ran must omit this rather than invent the caller's string.
   */
  readonly inspectedWorktree?: string;
}

export type GitHeadObservationV1 =
  | { readonly outcome: "FOUND"; readonly sha: string }
  | { readonly outcome: "UNAVAILABLE"; readonly reason: string; readonly command: GitCommandResultV1 };

export type GitBranchObservationV1 =
  | { readonly outcome: "ATTACHED"; readonly name: string }
  | { readonly outcome: "DETACHED" }
  | { readonly outcome: "UNAVAILABLE"; readonly reason: string; readonly command: GitCommandResultV1 };

export type GitUpstreamObservationV1 =
  | { readonly outcome: "TRACKING"; readonly name: string; readonly ahead: number; readonly behind: number }
  | { readonly outcome: "NO_UPSTREAM" }
  | { readonly outcome: "NOT_APPLICABLE"; readonly reason: "DETACHED_HEAD" }
  | { readonly outcome: "UNAVAILABLE"; readonly reason: string; readonly command: GitCommandResultV1 };

/**
 * Content digest of the paths `git status` listed. Status lines are a
 * correlate; bytes are the fact. mtime and size are writable by the
 * thing being audited and are not used as a content proxy — size is
 * consulted only to enforce {@link REVIEW_TREE_DIGEST_MAX_BYTES}.
 */
export type ListedTreeContentV1 =
  | {
      readonly outcome: "DIGESTED";
      readonly digest: string;
      readonly fileCount: number;
      readonly totalBytes: number;
    }
  | {
      readonly outcome: "BUDGET_EXCEEDED";
      readonly reason: string;
      readonly fileCount: number;
      readonly totalBytes: number;
    }
  | { readonly outcome: "UNAVAILABLE"; readonly reason: string };

export type GitStatusObservationV1 =
  | {
      readonly outcome: "CLEAN";
      readonly porcelain: "";
      readonly listedContent?: ListedTreeContentV1;
    }
  | {
      readonly outcome: "DIRTY";
      readonly porcelain: string;
      readonly dirtyPaths: readonly string[];
      readonly listedContent?: ListedTreeContentV1;
    }
  | { readonly outcome: "UNAVAILABLE"; readonly reason: string; readonly command: GitCommandResultV1 };

/**
 * `--ignored=traditional --untracked-files=all` lists each ignored file
 * instead of collapsing an ignored directory to one line. Measured on
 * this repo as affordable (thousands of lines in well under a second).
 */
export const GIT_STATUS_INCLUDING_IGNORED_ARGV = [
  "status",
  "--porcelain",
  "--ignored=traditional",
  "--untracked-files=all",
] as const;

/**
 * Budget for the review-tree content digest. Overflow is UNKNOWN and
 * never passes. Do not widen these to whatever happens to fit a host.
 */
export const REVIEW_TREE_DIGEST_MAX_FILES = 10_000;
export const REVIEW_TREE_DIGEST_MAX_BYTES = 256 * 1024 * 1024;

/** Digest of an empty listed-path set. Tests and CLEAN observations share it. */
export function emptyListedTreeContent(): ListedTreeContentV1 {
  return { outcome: "DIGESTED", digest: createHash("sha256").digest("hex"), fileCount: 0, totalBytes: 0 };
}

export type GitBranchHeadObservationV1 =
  | { readonly outcome: "FOUND"; readonly sha: string }
  | { readonly outcome: "NOT_APPLICABLE"; readonly reason: "DETACHED_HEAD" }
  | { readonly outcome: "UNAVAILABLE"; readonly reason: string; readonly command?: GitCommandResultV1 };

export type GitLargeTrackedFilesObservationV1 =
  | { readonly outcome: "FOUND"; readonly files: ReadonlyArray<{ readonly path: string; readonly bytes: number }> }
  | { readonly outcome: "UNAVAILABLE"; readonly reason: string; readonly command?: GitCommandResultV1 };

export interface GitObservationV1 {
  readonly schema: typeof GIT_OBSERVATION_SCHEMA_V1;
  readonly worktreePath: string;
  readonly collectedAt: IsoTimestamp;
  readonly head: GitHeadObservationV1;
  readonly branch: GitBranchObservationV1;
  readonly upstream: GitUpstreamObservationV1;
  readonly status: GitStatusObservationV1;
  readonly branchHead?: GitBranchHeadObservationV1;
  readonly largeTrackedFiles?: GitLargeTrackedFilesObservationV1;
}

export type GitCollectResultV1 =
  | { readonly ok: true; readonly observation: GitObservationV1; readonly reason: string }
  | { readonly ok: false; readonly observation: GitObservationV1; readonly reason: string };

export interface CollectGitTruthInputV1 {
  readonly runner: GitRunner;
  readonly worktreePath: string;
  readonly now: IsoTimestamp;
}

/**
 * Collect an independent reading of a worktree.
 *
 * Every Git invocation is an argv array. The only expected non-zero exits are `symbolic-ref`
 * on a detached HEAD (quiet `-q`) and `rev-parse @{upstream}` when nothing is configured.
 * Any other failure is recorded as `UNAVAILABLE` on that field, never rewritten into a
 * plausible empty success.
 */
/**
 * `git status --porcelain --ignored=traditional --untracked-files=all`.
 * `--ignored` reports *state*, not delta: `!! path` means the path is
 * ignored and present, not that this run created it. A claim about
 * what this run changed requires two readings compared as content
 * digests of the listed paths, not as sets of status lines. Status
 * lines cannot see a content rewrite of an already-listed ignored file.
 */
export function collectGitStatusIncludingIgnored(runner: GitRunner): GitStatusObservationV1 {
  const status = observeStatus(invokeGit(runner, [...GIT_STATUS_INCLUDING_IGNORED_ARGV]));
  return attachListedTreeContent(status, runner.inspectedWorktree);
}

export function attachListedTreeContent(
  status: GitStatusObservationV1,
  worktreePath: string | undefined,
): GitStatusObservationV1 {
  if (status.outcome === "UNAVAILABLE") return status;
  const paths = status.outcome === "CLEAN" ? [] : status.dirtyPaths;
  const listedContent = digestListedGitStatusPaths(worktreePath ?? "", paths);
  if (status.outcome === "CLEAN") {
    return { outcome: "CLEAN", porcelain: "", listedContent };
  }
  return {
    outcome: "DIRTY",
    porcelain: status.porcelain,
    dirtyPaths: status.dirtyPaths,
    listedContent,
  };
}

/**
 * Stream-hash each listed path. Directories contribute only their
 * relative path (the flags above should have expanded them to files).
 * A missing worktree or an unreadable file is UNAVAILABLE, never a
 * silent empty digest.
 */
export function digestListedGitStatusPaths(
  worktreePath: string,
  relativePaths: readonly string[],
): ListedTreeContentV1 {
  const hash = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;
  const sorted = [...relativePaths].map((path) => path.replace(/\\/g, "/")).sort();
  if (sorted.length === 0) {
    return emptyListedTreeContent();
  }
  const root = typeof worktreePath === "string" ? worktreePath.trim() : "";
  if (root === "") {
    return { outcome: "UNAVAILABLE", reason: "listed-tree digest has no worktree path" };
  }
  for (const rel of sorted) {
    if (rel === "") continue;
    if (fileCount + 1 > REVIEW_TREE_DIGEST_MAX_FILES) {
      return {
        outcome: "BUDGET_EXCEEDED",
        reason: `listed-tree digest exceeded REVIEW_TREE_DIGEST_MAX_FILES=${REVIEW_TREE_DIGEST_MAX_FILES} (fileCount=${fileCount + 1})`,
        fileCount: fileCount + 1,
        totalBytes,
      };
    }
    const abs = join(root, rel);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { outcome: "UNAVAILABLE", reason: `listed-tree path unreadable: ${rel}: ${message}` };
    }
    hash.update(rel);
    hash.update("\0");
    if (st.isDirectory()) {
      hash.update("DIR\n");
      fileCount += 1;
      continue;
    }
    if (!st.isFile()) {
      hash.update("OTHER\n");
      fileCount += 1;
      continue;
    }
    if (totalBytes + st.size > REVIEW_TREE_DIGEST_MAX_BYTES) {
      return {
        outcome: "BUDGET_EXCEEDED",
        reason: `listed-tree digest exceeded REVIEW_TREE_DIGEST_MAX_BYTES=${REVIEW_TREE_DIGEST_MAX_BYTES} (totalBytes=${totalBytes + st.size})`,
        fileCount: fileCount + 1,
        totalBytes: totalBytes + st.size,
      };
    }
    let buf: Buffer;
    try {
      buf = readFileSync(abs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { outcome: "UNAVAILABLE", reason: `listed-tree file unreadable: ${rel}: ${message}` };
    }
    hash.update(buf);
    hash.update("\n");
    fileCount += 1;
    totalBytes += buf.length;
  }
  return { outcome: "DIGESTED", digest: hash.digest("hex"), fileCount, totalBytes };
}

export function collectGitTruth(input: CollectGitTruthInputV1): GitCollectResultV1 {
  const collectedAt = input.now;
  const runner = input.runner;

  const headCmd = invokeGit(runner, ["rev-parse", "HEAD"]);
  const head = observeHead(headCmd);

  const branchCmd = invokeGit(runner, ["symbolic-ref", "-q", "--short", "HEAD"]);
  const branch = observeBranch(branchCmd);

  const statusCmd = invokeGit(runner, ["status", "--porcelain"]);
  const status = observeStatus(statusCmd);

  const upstream = observeUpstream(runner, branch);

  const branchHead = observeBranchHead(runner, branch);
  const largeTrackedCmd = invokeGit(runner, ["ls-tree", "-r", "-l", "HEAD"]);
  const largeTrackedFiles = observeLargeTrackedFiles(largeTrackedCmd);

  // The record names the directory Git was actually run against. The caller-supplied
  // worktreePath is a label and is not copied: a runner that inspected somewhere else
  // (or nowhere) must not produce a record claiming C:/claimed.
  const worktreePath = inspectedWorktreeOf(runner, [headCmd, branchCmd, statusCmd]);

  const observation: GitObservationV1 = {
    schema: GIT_OBSERVATION_SCHEMA_V1,
    worktreePath,
    collectedAt,
    head,
    branch,
    upstream,
    status,
    branchHead,
    largeTrackedFiles,
  };

  if (head.outcome === "UNAVAILABLE") {
    return { ok: false, observation, reason: `HEAD is unavailable: ${head.reason}` };
  }
  if (branch.outcome === "UNAVAILABLE") {
    return { ok: false, observation, reason: `branch is unavailable: ${branch.reason}` };
  }
  if (status.outcome === "UNAVAILABLE") {
    return { ok: false, observation, reason: `status is unavailable: ${status.reason}` };
  }
  if (upstream.outcome === "UNAVAILABLE") {
    return { ok: false, observation, reason: `upstream is unavailable: ${upstream.reason}` };
  }

  return { ok: true, observation, reason: "independent Git observation collected" };
}

/**
 * Spawn Git with an argv array and no shell.
 *
 * `@{upstream}` is a single argv element. PowerShell must never see it as source text.
 */
export function createNodeGitRunner(input: {
  readonly worktreePath: string;
  readonly gitExecutable?: string;
}): GitRunner {
  const exe = input.gitExecutable ?? "git";
  const cwd = input.worktreePath;
  return {
    inspectedWorktree: cwd,
    run(argv: readonly string[]): GitCommandResultV1 {
      const classified = isForbiddenGitOperation(argv);
      if (classified.forbidden) {
        return {
          argv: argv.slice(),
          status: null,
          stdout: "",
          stderr: "",
          error: classified.reason,
          cwd,
        };
      }
      let result: ReturnType<typeof spawnSync>;
      try {
        const creationNotBefore = new Date().toISOString();
        result = spawnSync(exe, argv.slice(), {
          cwd,
          encoding: "utf8",
          timeout: 15_000,
          windowsHide: true,
          shell: false,
        });
        rememberMeasurementApparatusPid(result.pid, {
          creationNotBefore,
          creationNotAfter: new Date().toISOString(),
        });
      } catch (error) {
        return {
          argv: argv.slice(),
          status: null,
          stdout: "",
          stderr: "",
          error: error instanceof Error ? error.message : String(error),
          cwd,
        };
      }
      return {
        argv: argv.slice(),
        status: result.status,
        stdout: String(result.stdout ?? ""),
        stderr: String(result.stderr ?? ""),
        error: result.error ? result.error.message : null,
        cwd,
      };
    },
  };
}

function inspectedWorktreeOf(
  runner: GitRunner,
  commands: readonly GitCommandResultV1[],
): string {
  const fromRunner = typeof runner.inspectedWorktree === "string" ? runner.inspectedWorktree.trim() : "";
  if (fromRunner !== "") return fromRunner;

  const fromCommands = commands
    .map((command) => (typeof command.cwd === "string" ? command.cwd.trim() : ""))
    .filter((cwd) => cwd !== "");
  if (fromCommands.length === 0) return "";
  const first = fromCommands[0]!;
  return fromCommands.every((cwd) => cwd === first) ? first : "";
}

function invokeGit(runner: GitRunner, argv: readonly string[]): GitCommandResultV1 {
  try {
    const result = runner.run(argv);
    return {
      argv: [...result.argv],
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      error: result.error,
    };
  } catch (error) {
    return {
      argv: [...argv],
      status: null,
      stdout: "",
      stderr: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function commandFailed(result: GitCommandResultV1): boolean {
  return result.error !== null || result.status === null || result.status !== 0;
}

function describeCommandFailure(result: GitCommandResultV1): string {
  if (result.error !== null) return `git ${result.argv.join(" ")} failed to start: ${result.error}`;
  const err = result.stderr.trim();
  return `git ${result.argv.join(" ")} exited ${result.status}${err ? `: ${err}` : ""}`;
}

function observeHead(result: GitCommandResultV1): GitHeadObservationV1 {
  if (commandFailed(result)) {
    return { outcome: "UNAVAILABLE", reason: describeCommandFailure(result), command: result };
  }
  const sha = result.stdout.trim();
  if (!GIT_SHA.test(sha)) {
    return {
      outcome: "UNAVAILABLE",
      reason: `git rev-parse HEAD returned ${sha === "" ? "an empty string" : JSON.stringify(sha)}, which is not a SHA`,
      command: result,
    };
  }
  return { outcome: "FOUND", sha };
}

function observeBranch(result: GitCommandResultV1): GitBranchObservationV1 {
  if (result.error !== null || result.status === null) {
    return { outcome: "UNAVAILABLE", reason: describeCommandFailure(result), command: result };
  }
  if (result.status === 0) {
    const name = result.stdout.trim();
    if (name === "") {
      return {
        outcome: "UNAVAILABLE",
        reason: "git symbolic-ref succeeded with an empty branch name",
        command: result,
      };
    }
    return { outcome: "ATTACHED", name };
  }
  // `symbolic-ref -q` exits 1 with no output when HEAD is detached. Any other non-zero is a
  // real failure — including "not a git repository" (128) — and must not look detached.
  if (result.status === 1 && result.stdout.trim() === "") {
    return { outcome: "DETACHED" };
  }
  return { outcome: "UNAVAILABLE", reason: describeCommandFailure(result), command: result };
}

function observeStatus(result: GitCommandResultV1): GitStatusObservationV1 {
  if (commandFailed(result)) {
    return { outcome: "UNAVAILABLE", reason: describeCommandFailure(result), command: result };
  }
  const porcelain = result.stdout.replace(/(?:\r?\n)+$/, "");
  const lines = porcelain.length === 0 ? [] : porcelain.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { outcome: "CLEAN", porcelain: "" };
  }
  return {
    outcome: "DIRTY",
    porcelain,
    dirtyPaths: lines.map(porcelainPath),
  };
}

function porcelainPath(line: string): string {
  if (line.length >= 3 && line.charAt(2) === " ") return line.slice(3);
  return line;
}

function observeUpstream(runner: GitRunner, branch: GitBranchObservationV1): GitUpstreamObservationV1 {
  if (branch.outcome === "DETACHED") {
    return { outcome: "NOT_APPLICABLE", reason: "DETACHED_HEAD" };
  }
  if (branch.outcome === "UNAVAILABLE") {
    return {
      outcome: "UNAVAILABLE",
      reason: "upstream was not asked because the branch observation failed",
      command: {
        argv: ["rev-parse", "--abbrev-ref", "@{upstream}"],
        status: null,
        stdout: "",
        stderr: "",
        error: "not invoked",
      },
    };
  }

  // `@{upstream}` is one argv element. Never interpolate it into a shell string.
  const nameCmd = invokeGit(runner, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  if (commandFailed(nameCmd)) {
    if (NO_UPSTREAM.test(nameCmd.stderr) || NO_UPSTREAM.test(nameCmd.stdout)) {
      return { outcome: "NO_UPSTREAM" };
    }
    return { outcome: "UNAVAILABLE", reason: describeCommandFailure(nameCmd), command: nameCmd };
  }
  const name = nameCmd.stdout.trim();
  if (name === "") {
    return {
      outcome: "UNAVAILABLE",
      reason: "git rev-parse --abbrev-ref @{upstream} succeeded with an empty name",
      command: nameCmd,
    };
  }

  const countCmd = invokeGit(runner, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
  if (commandFailed(countCmd)) {
    return { outcome: "UNAVAILABLE", reason: describeCommandFailure(countCmd), command: countCmd };
  }
  const match = AHEAD_BEHIND.exec(countCmd.stdout.trim());
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return {
      outcome: "UNAVAILABLE",
      reason: `git rev-list --left-right --count HEAD...@{upstream} returned ${JSON.stringify(countCmd.stdout.trim())}`,
      command: countCmd,
    };
  }
  return {
    outcome: "TRACKING",
    name,
    ahead: Number(match[1]),
    behind: Number(match[2]),
  };
}

function observeBranchHead(
  runner: GitRunner,
  branch: GitBranchObservationV1,
): GitBranchHeadObservationV1 {
  if (branch.outcome === "DETACHED") {
    return { outcome: "NOT_APPLICABLE", reason: "DETACHED_HEAD" };
  }
  if (branch.outcome === "UNAVAILABLE") {
    return {
      outcome: "UNAVAILABLE",
      reason: "branch ref was not asked because the branch observation failed",
    };
  }
  const result = invokeGit(runner, ["rev-parse", `refs/heads/${branch.name}`]);
  if (commandFailed(result)) {
    return { outcome: "UNAVAILABLE", reason: describeCommandFailure(result), command: result };
  }
  const sha = result.stdout.trim();
  if (!GIT_SHA.test(sha)) {
    return {
      outcome: "UNAVAILABLE",
      reason: `git rev-parse refs/heads/${branch.name} returned ${sha === "" ? "an empty string" : JSON.stringify(sha)}, which is not a SHA`,
      command: result,
    };
  }
  return { outcome: "FOUND", sha };
}

function observeLargeTrackedFiles(result: GitCommandResultV1): GitLargeTrackedFilesObservationV1 {
  if (commandFailed(result)) {
    return { outcome: "UNAVAILABLE", reason: describeCommandFailure(result), command: result };
  }
  const files: Array<{ path: string; bytes: number }> = [];
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
  for (const line of lines) {
    const match = /^(\S+)\s+blob\s+\S+\s+(\d+)\t(.+)$/.exec(line);
    if (match === null || match[2] === undefined || match[3] === undefined) continue;
    const bytes = Number(match[2]);
    if (!Number.isFinite(bytes) || bytes < LARGE_TRACKED_FILE_BYTES) continue;
    files.push({ path: match[3], bytes });
  }
  return { outcome: "FOUND", files };
}
