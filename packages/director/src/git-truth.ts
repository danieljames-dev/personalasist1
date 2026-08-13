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
  snapshot: GitSnapshotV1,
  expectation: GitExpectationV1 = {},
): GitVerdictV1 {
  const findings: GitFindingV1[] = [];

  // Asked first because every check below reads the same snapshot: if the observation is stale, so
  // is each conclusion drawn from it, and an executor can do a great deal in the gap.
  if (expectation.maxSnapshotAgeMs !== undefined) {
    const readAt = Date.parse(snapshot.readAt);
    const now = expectation.now ? Date.parse(expectation.now) : Number.NaN;
    const ageMs = now - readAt;
    if (!Number.isFinite(ageMs)) {
      findings.push({
        kind: "SNAPSHOT_AGE_UNKNOWN",
        detail: `freshness was required within ${expectation.maxSnapshotAgeMs}ms but the snapshot's age cannot be established from readAt=${snapshot.readAt} and now=${expectation.now ?? "(absent)"}`,
        blocking: true,
      });
    } else if (ageMs < 0) {
      findings.push({
        kind: "SNAPSHOT_AGE_UNKNOWN",
        detail: `the snapshot was read ${-ageMs}ms after the instant it is being judged at; the clocks disagree and an age cannot be trusted`,
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

  // Attachment is required either because a branch was named or because the caller said so outright.
  // Tying it to `expectedBranch` alone let a caller who did not yet know the branch name pass with a
  // detached HEAD.
  const branchNamed = expectation.expectedBranch !== undefined && expectation.expectedBranch !== null;
  if ((branchNamed || expectation.requireAttachedBranch === true) && snapshot.attachedBranch === null) {
    // The detached-HEAD case is called out separately because it has a specific failure story:
    // a commit made there is reachable by nothing, and a push reports success while updating a
    // branch that never moved.
    findings.push({
      kind: "DETACHED_HEAD",
      detail: "HEAD is detached; a commit here belongs to no branch and a push would not carry it",
      blocking: true,
    });
  } else if (branchNamed && snapshot.attachedBranch !== expectation.expectedBranch) {
    findings.push({
      kind: "BRANCH_MISMATCH",
      detail: `on ${snapshot.attachedBranch}, expected ${expectation.expectedBranch}`,
      blocking: true,
    });
  }

  // Unconditional, because nobody would think to ask for it. HEAD and the branch ref disagreeing is
  // not a preference that went unmet, it is a repository in a state a normal command does not
  // produce — an interrupted checkout, a hand-edited ref, a worktree pointed at another's HEAD — and
  // every SHA comparison after it is being made against a ref the next command may not use.
  if (snapshot.localBranchHead !== null && snapshot.head !== snapshot.localBranchHead) {
    const ref = snapshot.attachedBranch === null ? "the recorded local branch ref" : snapshot.attachedBranch;
    findings.push({
      kind: "HEAD_REF_INCONSISTENT",
      detail: `HEAD is ${snapshot.head} but ${ref} points at ${snapshot.localBranchHead}; the working state and the branch are not the same commit`,
      blocking: true,
    });
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

  if (expectation.requireLocalEqualsRemote) {
    if (snapshot.localBranchHead === null || snapshot.remoteBranchHead === null) {
      // The false pass this replaces: the old check required both SHAs to be present before it could
      // fail, so a `ls-remote` that errored, a branch never pushed, or a snapshot assembled without
      // remote data all read as "local equals remote" and a mission integrated on that basis.
      const missing = snapshot.remoteBranchHead === null && snapshot.localBranchHead === null
        ? "neither the local nor the remote branch head is known"
        : snapshot.remoteBranchHead === null
          ? "the remote branch head is not known"
          : "the local branch head is not known";
      findings.push({
        kind: "REMOTE_STATE_UNKNOWN",
        detail: `local was required to equal remote but ${missing}; a missing reading is an unanswered question, not agreement`,
        blocking: true,
      });
    } else if (snapshot.localBranchHead !== snapshot.remoteBranchHead) {
      findings.push({
        kind: "LOCAL_REMOTE_DIVERGED",
        detail: `local ${snapshot.localBranchHead} vs remote ${snapshot.remoteBranchHead}; a push reporting success is not proof`,
        blocking: true,
      });
    }
  }

  const policy = expectation.largeArtifactPolicy ?? {};
  const reportAtBytes = policy.reportAtBytes ?? DEFAULT_LARGE_ARTIFACT_POLICY.reportAtBytes;
  const blockAtBytes = policy.blockAtBytes ?? DEFAULT_LARGE_ARTIFACT_POLICY.blockAtBytes;
  const blockingClasses = policy.blockingClasses ?? DEFAULT_LARGE_ARTIFACT_POLICY.blockingClasses;
  const acceptedPaths = (policy.acceptedPaths ?? DEFAULT_LARGE_ARTIFACT_POLICY.acceptedPaths).map(normalizePath);

  for (const file of snapshot.largeTrackedFiles) {
    if (file.bytes < reportAtBytes) continue;
    const artifactClass = classifyLargeArtifact(file.path);
    const accepted = acceptedPaths.includes(normalizePath(file.path));
    // The finding is made on size, which is observable. Blocking is policy, which is the caller's.
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
