import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSafeSync } from "../lib/spawn-safe.mjs";
import { collectGitTruth, compareClaim, commitExists } from "../lib/git-truth-collect.mjs";

function git(repo, args) {
  const r = spawnSafeSync("git", ["-C", repo, ...args], { timeout: 15_000 });
  assert.equal(r.status, 0, r.stderr);
  return (r.stdout || "").trim();
}

function scratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), "aion-git-oracle-"));
  git(dir, ["init"]);
  writeFileSync(join(dir, "README.md"), "one\n");
  git(dir, ["add", "README.md"]);
  git(dir, ["-c", "user.email=oracle@aion.local", "-c", "user.name=Oracle", "commit", "-m", "init"]);
  git(dir, ["checkout", "-b", "executor/oracle"]);
  return dir;
}

test("no change: independent snapshot matches HEAD and is clean", () => {
  const repo = scratchRepo();
  const before = collectGitTruth(repo);
  const after = collectGitTruth(repo);
  assert.equal(after.head, before.head);
  assert.equal(after.dirty, false);
  assert.equal(after.attachedBranch, "executor/oracle");
});

test("intended change vs wrong file vs dirty vs fake commit claim", () => {
  const repo = scratchRepo();
  const before = collectGitTruth(repo);
  writeFileSync(join(repo, "README.md"), "two\n");
  const dirty = collectGitTruth(repo);
  assert.equal(dirty.dirty, true);
  const cleanClaim = compareClaim(dirty, { clean: true, headAfter: before.head, branch: "executor/oracle" });
  assert.equal(cleanClaim.ok, false);
  assert.ok(cleanClaim.findings.includes("DIRTY_WHILE_CLAIMED_CLEAN"));

  git(repo, ["add", "README.md"]);
  git(repo, ["-c", "user.email=oracle@aion.local", "-c", "user.name=Oracle", "commit", "-m", "edit"]);
  const after = collectGitTruth(repo);
  assert.notEqual(after.head, before.head);
  const good = compareClaim(after, { headAfter: after.head, branch: "executor/oracle", clean: true });
  assert.equal(good.ok, true);
  const fake = compareClaim(after, { headAfter: "c".repeat(40), branch: "executor/oracle" });
  assert.ok(fake.findings.includes("HEAD_MISMATCH"));
  assert.equal(commitExists(repo, "c".repeat(40)), false);
});

test("branch change and detached HEAD are visible without the executor report", () => {
  const repo = scratchRepo();
  git(repo, ["checkout", "-b", "unexpected"]);
  const branched = collectGitTruth(repo);
  assert.equal(branched.attachedBranch, "unexpected");
  git(repo, ["checkout", "--detach"]);
  const det = collectGitTruth(repo);
  assert.equal(det.detached, true);
  const claim = compareClaim(det, { branch: "executor/oracle", headAttached: true });
  assert.ok(claim.findings.includes("DETACHED_HEAD"));
  assert.ok(claim.findings.includes("BRANCH_MISMATCH"));
});

test("untracked artifact is observed", () => {
  const repo = scratchRepo();
  writeFileSync(join(repo, "eng.traineddata"), "x");
  const snap = collectGitTruth(repo);
  assert.ok(snap.untracked.some((p) => p.includes("traineddata")));
});
