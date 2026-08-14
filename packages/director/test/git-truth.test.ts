/**
 * Independent Git observation: what the repository shows, not what the executor claimed.
 *
 * The dangerous pass is a failed `git status` that looks like a clean tree, because empty
 * porcelain and a crashed command are the same string. Detached HEAD, a missing upstream, and
 * a dirty path each have to be their own state — collapsing any of them into "error" or
 * "empty" is how a handoff gets believed.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  collectGitTruth,
  createNodeGitRunner,
  type GitCommandResultV1,
  type GitRunner,
} from "../src/git-truth.js";

const NOW = "2026-08-13T12:00:00.000Z";
const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function result(
  argv: readonly string[],
  over: Partial<GitCommandResultV1> = {},
): GitCommandResultV1 {
  return {
    argv: [...argv],
    status: over.status ?? 0,
    stdout: over.stdout ?? "",
    stderr: over.stderr ?? "",
    error: over.error ?? null,
  };
}

function scripted(replies: ReadonlyArray<{ argv: readonly string[]; reply: Partial<GitCommandResultV1> }>): GitRunner & {
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    calls,
    run(argv) {
      calls.push([...argv]);
      const hit = replies.find((entry) => entry.argv.length === argv.length && entry.argv.every((token, i) => token === argv[i]));
      if (hit === undefined) {
        throw new Error(`unexpected git argv: ${JSON.stringify(argv)}`);
      }
      return result(argv, hit.reply);
    },
  };
}

function attachedClean(over: {
  statusPorcelain?: string;
  status?: Partial<GitCommandResultV1>;
  upstream?: Partial<GitCommandResultV1>;
  aheadBehind?: Partial<GitCommandResultV1>;
  skipAheadBehind?: boolean;
} = {}): GitRunner & { calls: string[][] } {
  const replies: Array<{ argv: readonly string[]; reply: Partial<GitCommandResultV1> }> = [
    { argv: ["rev-parse", "HEAD"], reply: { stdout: `${SHA}\n` } },
    { argv: ["symbolic-ref", "-q", "--short", "HEAD"], reply: { stdout: "executor/oracle\n" } },
    {
      argv: ["status", "--porcelain"],
      reply: over.status ?? { stdout: over.statusPorcelain ?? "" },
    },
    {
      argv: ["rev-parse", "--abbrev-ref", "@{upstream}"],
      reply: over.upstream ?? { stdout: "origin/executor/oracle\n" },
    },
  ];
  if (!over.skipAheadBehind) {
    replies.push({
      argv: ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      reply: over.aheadBehind ?? { stdout: "0\t0\n" },
    });
  }
  return scripted(replies);
}

// ---------------------------------------------------------------------------
// Dirty / clean
// ---------------------------------------------------------------------------

test("a dirty tree is reported dirty, with the porcelain path kept", () => {
  const runner = attachedClean({ statusPorcelain: " M README.md\n?? untracked.txt\n" });
  const collected = collectGitTruth({ runner, worktreePath: "C:/wt", now: NOW });
  assert.equal(collected.ok, true, collected.reason);
  assert.equal(collected.observation.status.outcome, "DIRTY");
  if (collected.observation.status.outcome !== "DIRTY") return;
  assert.deepEqual(collected.observation.status.dirtyPaths, ["README.md", "untracked.txt"]);
  assert.match(collected.observation.status.porcelain, /README\.md/);
});

test("empty porcelain from a successful status is clean, not a missing reading", () => {
  const runner = attachedClean({ statusPorcelain: "" });
  const collected = collectGitTruth({ runner, worktreePath: "C:/wt", now: NOW });
  assert.equal(collected.ok, true);
  assert.equal(collected.observation.status.outcome, "CLEAN");
  if (collected.observation.status.outcome !== "CLEAN") return;
  assert.equal(collected.observation.status.porcelain, "");
});

// ---------------------------------------------------------------------------
// Detached HEAD is not a branch
// ---------------------------------------------------------------------------

test("a detached HEAD is distinguishable from an attached branch", () => {
  const runner = scripted([
    { argv: ["rev-parse", "HEAD"], reply: { stdout: `${SHA}\n` } },
    { argv: ["symbolic-ref", "-q", "--short", "HEAD"], reply: { status: 1, stdout: "" } },
    { argv: ["status", "--porcelain"], reply: { stdout: "" } },
  ]);
  const collected = collectGitTruth({ runner, worktreePath: "C:/wt", now: NOW });
  assert.equal(collected.ok, true, collected.reason);
  assert.equal(collected.observation.branch.outcome, "DETACHED");
  assert.notEqual(collected.observation.branch.outcome, "ATTACHED");
  assert.equal(collected.observation.upstream.outcome, "NOT_APPLICABLE");
  if (collected.observation.head.outcome !== "FOUND") {
    assert.fail("HEAD should still be readable when detached");
    return;
  }
  assert.equal(collected.observation.head.sha, SHA);
});

test("an attached branch is not reported as detached", () => {
  const collected = collectGitTruth({
    runner: attachedClean(),
    worktreePath: "C:/wt",
    now: NOW,
  });
  assert.equal(collected.observation.branch.outcome, "ATTACHED");
  if (collected.observation.branch.outcome !== "ATTACHED") return;
  assert.equal(collected.observation.branch.name, "executor/oracle");
});

// ---------------------------------------------------------------------------
// Missing upstream is a state, not an error
// ---------------------------------------------------------------------------

test("a missing upstream is NO_UPSTREAM rather than a collection failure", () => {
  const runner = attachedClean({
    upstream: {
      status: 128,
      stderr: "fatal: no upstream configured for branch 'executor/oracle'\n",
    },
    skipAheadBehind: true,
  });
  const collected = collectGitTruth({ runner, worktreePath: "C:/wt", now: NOW });
  assert.equal(collected.ok, true, collected.reason);
  assert.equal(collected.observation.upstream.outcome, "NO_UPSTREAM");
  assert.notEqual(collected.observation.upstream.outcome, "UNAVAILABLE");
});

test("a tracking branch reports the upstream name and ahead/behind", () => {
  const runner = attachedClean({
    aheadBehind: { stdout: "2\t3\n" },
  });
  const collected = collectGitTruth({ runner, worktreePath: "C:/wt", now: NOW });
  assert.equal(collected.ok, true, collected.reason);
  assert.equal(collected.observation.upstream.outcome, "TRACKING");
  if (collected.observation.upstream.outcome !== "TRACKING") return;
  assert.equal(collected.observation.upstream.name, "origin/executor/oracle");
  assert.equal(collected.observation.upstream.ahead, 2);
  assert.equal(collected.observation.upstream.behind, 3);
});

// ---------------------------------------------------------------------------
// A failed command is not an empty success
// ---------------------------------------------------------------------------

test("a failed git status is UNAVAILABLE, not a clean tree", () => {
  const runner = attachedClean({
    status: { status: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git\n" },
  });
  const collected = collectGitTruth({ runner, worktreePath: "C:/wt", now: NOW });
  assert.equal(collected.ok, false);
  assert.equal(collected.observation.status.outcome, "UNAVAILABLE");
  assert.notEqual(collected.observation.status.outcome, "CLEAN");
  if (collected.observation.status.outcome !== "UNAVAILABLE") return;
  assert.match(collected.observation.status.reason, /status --porcelain/);
  assert.match(collected.reason, /status is unavailable/);
});

test("an empty HEAD string from a successful-looking rev-parse is not a SHA", () => {
  const runner = scripted([
    { argv: ["rev-parse", "HEAD"], reply: { status: 0, stdout: "" } },
    { argv: ["symbolic-ref", "-q", "--short", "HEAD"], reply: { stdout: "main\n" } },
    { argv: ["status", "--porcelain"], reply: { stdout: "" } },
    {
      argv: ["rev-parse", "--abbrev-ref", "@{upstream}"],
      reply: { status: 128, stderr: "fatal: no upstream configured for branch 'main'\n" },
    },
  ]);
  const collected = collectGitTruth({ runner, worktreePath: "C:/wt", now: NOW });
  assert.equal(collected.ok, false);
  assert.equal(collected.observation.head.outcome, "UNAVAILABLE");
  if (collected.observation.head.outcome !== "UNAVAILABLE") return;
  assert.match(collected.observation.head.reason, /empty string/);
});

test("a spawn failure on status is not porcelain emptiness", () => {
  const runner = attachedClean({
    status: { status: null, stdout: "", stderr: "", error: "spawn git ENOENT" },
  });
  const collected = collectGitTruth({ runner, worktreePath: "C:/wt", now: NOW });
  assert.equal(collected.ok, false);
  assert.equal(collected.observation.status.outcome, "UNAVAILABLE");
  assert.notEqual(collected.observation.status.outcome, "CLEAN");
  if (collected.observation.status.outcome !== "UNAVAILABLE") return;
  assert.match(collected.observation.status.reason, /ENOENT/);
});

test("upstream argv keeps @{upstream} as one element and is never a shell string", () => {
  const runner = attachedClean();
  collectGitTruth({ runner, worktreePath: "C:/wt", now: NOW });
  const upstreamCall = runner.calls.find((argv) => argv.includes("@{upstream}"));
  assert.ok(upstreamCall, "the collector must ask for @{upstream}");
  assert.deepEqual(upstreamCall, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  assert.equal(upstreamCall?.some((token) => token.includes(" ")), false);
});

// ---------------------------------------------------------------------------
// Real runner against this repository
// ---------------------------------------------------------------------------

test("the real Git runner observes this worktree by argv, not by a shell string", () => {
  const worktreePath = process.cwd();
  const runner = createNodeGitRunner({ worktreePath });
  const collected = collectGitTruth({ runner, worktreePath, now: NOW });

  assert.equal(collected.observation.head.outcome, "FOUND", collected.reason);
  if (collected.observation.head.outcome !== "FOUND") return;
  assert.match(collected.observation.head.sha, /^[0-9a-f]{40}$/);

  const direct = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: worktreePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  assert.equal(direct.status, 0, String(direct.stderr));
  assert.equal(collected.observation.head.sha, String(direct.stdout ?? "").trim());

  // This increment's branch is attached. Detached would be a different outcome, not a crash.
  assert.notEqual(collected.observation.branch.outcome, "UNAVAILABLE");
  if (collected.observation.branch.outcome === "ATTACHED") {
    assert.ok(collected.observation.branch.name.length > 0);
  }

  // A failed command would be UNAVAILABLE. CLEAN and DIRTY are both successful readings.
  assert.notEqual(collected.observation.status.outcome, "UNAVAILABLE", collected.reason);

  // No upstream on this worktree branch is a state. Confirm Git agrees, via argv not a string.
  const upstream = spawnSync("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], {
    cwd: worktreePath,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (upstream.status !== 0 && /no upstream configured/i.test(String(upstream.stderr ?? ""))) {
    assert.equal(collected.observation.upstream.outcome, "NO_UPSTREAM");
  }
});
