/**
 * Independent post-run Git snapshot. Executor handoff is DATA.
 */
import { spawnSafeSync } from "./spawn-safe.mjs";

function git(repo, args) {
  const r = spawnSafeSync("git", ["-C", repo, ...args], { timeout: 15_000 });
  return {
    status: r.status,
    out: (r.stdout || "").trim(),
    err: (r.stderr || "").trim(),
  };
}

export function collectGitTruth(repo) {
  const head = git(repo, ["rev-parse", "HEAD"]);
  const attached = git(repo, ["symbolic-ref", "-q", "--short", "HEAD"]);
  const dirty = git(repo, ["status", "--porcelain"]);
  const local = attached.status === 0
    ? git(repo, ["rev-parse", attached.out])
    : { status: 1, out: "" };
  const remote = attached.status === 0
    ? git(repo, ["rev-parse", `refs/remotes/origin/${attached.out}`])
    : { status: 1, out: "" };
  const untracked = dirty.out
    .split(/\r?\n/)
    .filter((l) => l.startsWith("??"))
    .map((l) => l.slice(3));
  return {
    repo,
    head: head.status === 0 ? head.out : null,
    attachedBranch: attached.status === 0 ? attached.out : null,
    detached: attached.status !== 0,
    localBranchHead: local.status === 0 ? local.out : null,
    remoteBranchHead: remote.status === 0 ? remote.out : null,
    dirty: Boolean(dirty.out),
    dirtyPaths: dirty.out ? dirty.out.split(/\r?\n/).filter(Boolean) : [],
    untracked,
  };
}

export function commitExists(repo, sha) {
  if (!sha) return false;
  return git(repo, ["cat-file", "-t", sha]).out === "commit";
}

export function compareClaim(snapshot, claim = {}) {
  const findings = [];
  if (claim.headAfter && snapshot.head !== claim.headAfter) findings.push("HEAD_MISMATCH");
  if (claim.headAfter && !commitExists(snapshot.repo, claim.headAfter)) findings.push("CLAIMED_COMMIT_MISSING");
  if (claim.branch && snapshot.attachedBranch !== claim.branch) findings.push("BRANCH_MISMATCH");
  if (claim.headAttached === true && snapshot.detached) findings.push("DETACHED_HEAD");
  if (claim.clean === true && snapshot.dirty) findings.push("DIRTY_WHILE_CLAIMED_CLEAN");
  if (claim.untrackedForbidden && snapshot.untracked.length) findings.push("UNTRACKED_PRESENT");
  return { ok: findings.length === 0, findings, snapshot };
}
