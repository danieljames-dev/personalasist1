/**
 * The ways a Git check can pass without having checked anything.
 *
 * Every case here was a false pass or a false refusal in an earlier version of `git-truth`: a
 * required comparison that succeeded because its input was missing, an inconsistency nobody thought
 * to ask about, an observation old enough to be fiction, and a forbidden-operation list matched by
 * substring — which refused `git stash list` for printing and waved through a force-push spelled
 * `+main`. These tests exist so those specific mistakes cannot come back.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  verifyGitTruth, isForbiddenGitOperation, classifyLargeArtifact,
  FORBIDDEN_GIT_OPERATIONS, LARGE_TRACKED_FILE_BYTES, DEFAULT_LARGE_ARTIFACT_POLICY,
  type GitSnapshotV1, type GitFindingKindV1,
} from "../src/git-truth.js";

const NOW = "2026-08-13T12:00:00.000Z";
const FIVE_SECONDS_LATER = "2026-08-13T12:00:05.000Z";
const TEN_MINUTES_LATER = "2026-08-13T12:10:00.000Z";

const snapshot = (over: Partial<GitSnapshotV1> = {}): GitSnapshotV1 => ({
  worktreePath: "C:/AION-HQ-claude-director-v01",
  attachedBranch: "executor/claude-director-v01",
  head: "a".repeat(40),
  localBranchHead: "a".repeat(40),
  remoteBranchHead: "a".repeat(40),
  originMainHead: "b".repeat(40),
  dirtyPaths: [],
  largeTrackedFiles: [],
  readAt: NOW,
  ...over,
});

const kinds = (findings: ReadonlyArray<{ kind: GitFindingKindV1 }>): GitFindingKindV1[] =>
  findings.map((finding) => finding.kind);

// ---------------------------------------------------------------------------
// Absence is not agreement
// ---------------------------------------------------------------------------

test("a required local-equals-remote check is not satisfied by having no remote", () => {
  // The old form needed both SHAs present before it could fail, so an ls-remote that errored, or a
  // branch that was never pushed, read as agreement and the mission integrated on that basis.
  const verdict = verifyGitTruth(snapshot({ remoteBranchHead: null }), { requireLocalEqualsRemote: true });
  assert.equal(verdict.ok, false, "an unknown remote must never pass a required comparison");
  assert.deepEqual(kinds(verdict.findings), ["REMOTE_STATE_UNKNOWN"]);
  assert.match(verdict.findings[0]!.detail, /not agreement/);
});

test("an unknown local branch head fails the same required comparison", () => {
  const verdict = verifyGitTruth(snapshot({ localBranchHead: null }), { requireLocalEqualsRemote: true });
  assert.equal(verdict.ok, false);
  assert.deepEqual(kinds(verdict.findings), ["REMOTE_STATE_UNKNOWN"]);
});

test("a remote that is genuinely known and equal still passes", () => {
  // The repair must not turn into "any local==remote requirement fails".
  const verdict = verifyGitTruth(snapshot(), { requireLocalEqualsRemote: true });
  assert.deepEqual(verdict.findings, []);
  assert.equal(verdict.ok, true);
});

// ---------------------------------------------------------------------------
// Refs that disagree with themselves
// ---------------------------------------------------------------------------

test("HEAD and the branch it claims to be on pointing at different commits is a finding", () => {
  // Nobody asks for this check, which is why it is unconditional: an interrupted checkout leaves a
  // tree at one commit and the branch ref at another, and every SHA compared afterwards is compared
  // against a ref the next command will not use.
  // Exercise the live observation path, not the snapshot adapter.
  const verdict = verifyGitTruth({
    schema: "aion.director.git-observation.v1",
    worktreePath: "C:/AION-HQ-claude-director-v01",
    collectedAt: NOW,
    head: { outcome: "FOUND", sha: "a".repeat(40) },
    branch: { outcome: "ATTACHED", name: "executor/claude-director-v01" },
    branchHead: { outcome: "FOUND", sha: "c".repeat(40) },
    upstream: { outcome: "NO_UPSTREAM" },
    status: { outcome: "CLEAN", porcelain: "" },
    largeTrackedFiles: { outcome: "FOUND", files: [] },
  });
  assert.equal(verdict.ok, false);
  assert.deepEqual(kinds(verdict.findings), ["HEAD_REF_INCONSISTENT"]);
  assert.match(verdict.findings[0]!.detail, /executor\/claude-director-v01 points at c{40}/);
});

test("a detached HEAD is caught when attachment is required and no branch was named", () => {
  // Attachment and identity are different questions. A caller that does not yet know which branch
  // the work belongs on previously had to invent a name to get the detached case looked at.
  const verdict = verifyGitTruth(
    snapshot({ attachedBranch: null, localBranchHead: null }),
    { requireAttachedBranch: true },
  );
  assert.equal(verdict.ok, false);
  assert.deepEqual(kinds(verdict.findings), ["DETACHED_HEAD"]);
  assert.match(verdict.findings[0]!.detail, /push would not carry it/);
});

test("attachment is only demanded when the caller asks for it", () => {
  const verdict = verifyGitTruth(snapshot({ attachedBranch: null, localBranchHead: null }));
  assert.deepEqual(verdict.findings, [], "a bare snapshot is described, not judged against nothing");
});

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

test("an observation from ten minutes ago is not current truth", () => {
  const verdict = verifyGitTruth(snapshot(), { maxSnapshotAgeMs: 30_000, now: TEN_MINUTES_LATER });
  assert.equal(verdict.ok, false);
  assert.deepEqual(kinds(verdict.findings), ["STALE_SNAPSHOT"]);
  assert.match(verdict.findings[0]!.detail, /600000ms old/);
});

test("a reading inside the bound is accepted, and no bound means no freshness question", () => {
  assert.deepEqual(
    verifyGitTruth(snapshot(), { maxSnapshotAgeMs: 30_000, now: FIVE_SECONDS_LATER }).findings,
    [],
  );
  assert.deepEqual(verifyGitTruth(snapshot(), { now: TEN_MINUTES_LATER }).findings, []);
});

test("a freshness bound with nothing to measure against is reported rather than assumed fresh", () => {
  // Same false-pass shape as the missing remote: the check could not run, so it must not succeed.
  const verdict = verifyGitTruth(snapshot(), { maxSnapshotAgeMs: 30_000 });
  assert.equal(verdict.ok, false);
  assert.deepEqual(kinds(verdict.findings), ["SNAPSHOT_AGE_UNKNOWN"]);
});

// ---------------------------------------------------------------------------
// Forbidden operations, classified by argv
// ---------------------------------------------------------------------------

test("inspecting the stash is allowed; taking the worktree away is not", () => {
  assert.equal(isForbiddenGitOperation(["git", "stash", "list"]).forbidden, false, "list only prints");
  assert.equal(isForbiddenGitOperation(["git", "stash", "show", "-p"]).forbidden, false);

  // A bare `git stash` is an implicit push: the executor is left building an empty tree.
  assert.equal(isForbiddenGitOperation(["git", "stash"]).forbidden, true);
  assert.equal(isForbiddenGitOperation(["git", "stash", "-u"]).forbidden, true);
  assert.equal(isForbiddenGitOperation(["git", "stash", "pop"]).forbidden, true);
  assert.equal(isForbiddenGitOperation(["git", "stash", "drop"]).matched, "stash");
});

test("a force-push written as a refspec is still a force-push", () => {
  // The form a model reaches for once a plain push has been rejected, and the one a substring
  // search for "--force" cannot see.
  const plus = isForbiddenGitOperation(["git", "push", "origin", "+main"]);
  assert.equal(plus.forbidden, true);
  assert.equal(plus.matched, "push +refspec");
  assert.equal(isForbiddenGitOperation(["git", "push", "origin", "+refs/heads/main:refs/heads/main"]).forbidden, true);
  assert.equal(isForbiddenGitOperation(["git", "push", "origin", "main"]).forbidden, false);
});

test("every spelling of a forced push is refused", () => {
  for (const args of [
    ["push", "--force"],
    ["push", "-f"],
    ["push", "-fu", "origin", "main"],
    ["push", "--force-with-lease"],
    ["push", "--force-if-includes", "origin", "main"],
    ["push", "--mirror", "origin"],
  ]) {
    assert.equal(isForbiddenGitOperation(["git", ...args]).forbidden, true, args.join(" "));
  }
});

test("reading the repository is never refused", () => {
  for (const args of [
    ["status", "--porcelain"],
    ["rev-parse", "HEAD"],
    ["log", "--oneline", "-n", "5"],
    ["diff", "--stat"],
    ["fetch", "origin"],
    ["clean", "--dry-run", "-d"],
    ["clean", "-nd"],
    ["reset", "--soft", "HEAD~1"],
    ["commit", "-m", "a message mentioning --amend"],
  ]) {
    assert.equal(isForbiddenGitOperation(["git", ...args]).forbidden, false, args.join(" "));
  }
});

test("the destructive subcommands are refused whatever precedes them on the line", () => {
  // Global options sit before the subcommand, and a classifier that gave up at the first `-` would
  // let `git -C <path> reset --hard` straight through.
  assert.equal(isForbiddenGitOperation(["git", "-C", "C:/wt", "reset", "--hard"]).forbidden, true);
  assert.equal(isForbiddenGitOperation(["git", "--no-pager", "clean", "-fdx"]).matched, "clean -fdx");
  assert.equal(isForbiddenGitOperation(["git", "-c", "user.name=x", "commit", "--amend"]).forbidden, true);
  assert.equal(isForbiddenGitOperation(["C:\\Program Files\\Git\\cmd\\git.exe", "rebase", "main"]).forbidden, true);
  assert.equal(isForbiddenGitOperation(["git", "filter-branch", "--tree-filter", "rm -f x"]).forbidden, true);
  assert.equal(isForbiddenGitOperation([]).forbidden, false);
});

test("the published list of refusals is the behaviour, not a comment beside it", () => {
  // A label that the classifier does not actually refuse would be a lie in an audit.
  for (const op of FORBIDDEN_GIT_OPERATIONS) {
    const check = isForbiddenGitOperation(["git", ...op.split(" ")]);
    assert.equal(check.forbidden, true, `${op} is listed as forbidden but was allowed`);
  }
});

// ---------------------------------------------------------------------------
// Large artifacts: generic detection, caller-owned policy
// ---------------------------------------------------------------------------

test("size makes the finding and no filename is written into the code", () => {
  const verdict = verifyGitTruth(snapshot({
    largeTrackedFiles: [
      { path: "tools/tessdata/deu.traineddata", bytes: 5_199_098 },
      { path: "assets/notes.txt", bytes: 12 },
    ],
  }));
  assert.equal(verdict.findings.length, 1, "only the large one is worth saying");
  assert.equal(verdict.findings[0]!.kind, "UNEXPECTED_LARGE_ARTIFACT");
  assert.equal(verdict.findings[0]!.path, "tools/tessdata/deu.traineddata");
  assert.equal(verdict.findings[0]!.artifactClass, "TRAINED_DATA");
  assert.equal(verdict.ok, true, "reporting is the default; stopping the mission is a policy choice");

  // The classification is by shape, so a language file nobody has seen before lands the same way.
  assert.equal(classifyLargeArtifact("x/y/chi_sim.traineddata"), classifyLargeArtifact("eng.traineddata"));
  assert.equal(classifyLargeArtifact("checkpoints/model-00001.safetensors"), "MODEL_WEIGHTS");
  assert.equal(classifyLargeArtifact("var/state.sqlite3"), "DATA_OR_STATE_DUMP");
  assert.equal(classifyLargeArtifact("bin/tool.exe"), "BINARY");
  assert.equal(classifyLargeArtifact("data/opaque-blob"), "UNCLASSIFIED");
  assert.equal(classifyLargeArtifact(".env"), "UNCLASSIFIED", "a dotfile has no extension");
});

test("an unrecognised large file is still reported, because size is the signal", () => {
  const verdict = verifyGitTruth(snapshot({
    largeTrackedFiles: [{ path: "vendor/blob", bytes: LARGE_TRACKED_FILE_BYTES }],
  }));
  assert.equal(verdict.findings.length, 1);
  assert.equal(verdict.findings[0]!.artifactClass, "UNCLASSIFIED");
  assert.ok(!verdict.findings[0]!.detail.includes("looks like"), "no guess is offered when there is none");
});

test("what blocks is the caller's policy, not this module's opinion", () => {
  const dump = snapshot({ largeTrackedFiles: [{ path: "data/prod.sqlite", bytes: 40_000_000 }] });

  assert.equal(verifyGitTruth(dump).ok, true, "the default reports and lets a person look");

  const bySize = verifyGitTruth(dump, { largeArtifactPolicy: { blockAtBytes: 20_000_000 } });
  assert.equal(bySize.ok, false);
  assert.equal(bySize.findings[0]!.blocking, true);

  const byClass = verifyGitTruth(dump, {
    largeArtifactPolicy: { blockingClasses: ["DATA_OR_STATE_DUMP"] },
  });
  assert.equal(byClass.ok, false, "a repository may decide state dumps in history are never acceptable");

  // The same policy leaves a different class alone: the class is a distinction, not a synonym for big.
  const weights = verifyGitTruth(
    snapshot({ largeTrackedFiles: [{ path: "models/w.safetensors", bytes: 40_000_000 }] }),
    { largeArtifactPolicy: { blockingClasses: ["DATA_OR_STATE_DUMP"] } },
  );
  assert.equal(weights.ok, true);
  assert.equal(weights.findings.length, 1, "still reported, just not blocking");
});

test("a large file a person has already accepted stays visible without stopping anything", () => {
  // An extension is never proof of illegitimacy, so there has to be an answer other than "delete it
  // or raise the threshold for everything".
  const verdict = verifyGitTruth(
    snapshot({ largeTrackedFiles: [{ path: "models/ships-with-the-app.onnx", bytes: 40_000_000 }] }),
    {
      largeArtifactPolicy: {
        blockAtBytes: 20_000_000,
        acceptedPaths: ["models\\Ships-With-The-App.onnx"],
      },
    },
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.findings.length, 1, "acceptance silences the block, never the report");
  assert.equal(verdict.findings[0]!.blocking, false);
});

test("the reporting threshold is the caller's too, and defaults to the size that caught the original", () => {
  const near = snapshot({ largeTrackedFiles: [{ path: "docs/manual.pdf", bytes: 2_000_000 }] });
  assert.equal(verifyGitTruth(near).findings.length, 1);
  assert.equal(
    verifyGitTruth(near, { largeArtifactPolicy: { reportAtBytes: 10_000_000 } }).findings.length,
    0,
  );
  assert.equal(DEFAULT_LARGE_ARTIFACT_POLICY.reportAtBytes, LARGE_TRACKED_FILE_BYTES);
  assert.equal(DEFAULT_LARGE_ARTIFACT_POLICY.blockAtBytes, null);
});

// ---------------------------------------------------------------------------
// Everything at once
// ---------------------------------------------------------------------------

test("independent problems are all named, not just the first one found", () => {
  // A caller fixing one finding at a time against a repository that has three of them is how a
  // "verified" mission takes four rounds to fail.
  const verdict = verifyGitTruth(
    snapshot({
      attachedBranch: null,
      localBranchHead: "c".repeat(40),
      remoteBranchHead: null,
      dirtyPaths: ["src/x.ts"],
      readAt: NOW,
    }),
    {
      requireAttachedBranch: true,
      requireClean: true,
      requireLocalEqualsRemote: true,
      maxSnapshotAgeMs: 30_000,
      now: TEN_MINUTES_LATER,
    },
  );
  assert.equal(verdict.ok, false);
  assert.deepEqual(kinds(verdict.findings), [
    "STALE_SNAPSHOT",
    "DETACHED_HEAD",
    "HEAD_REF_INCONSISTENT",
    "DIRTY_WORKTREE",
    "REMOTE_STATE_UNKNOWN",
  ]);
});
