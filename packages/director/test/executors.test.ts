/**
 * Role routing, version ordering, and argv that must not become a shell.
 *
 * Discovery lives in executor-discovery.test.ts. Argv construction lives in
 * executor-adapters.test.ts. This file covers the tables those paths share.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { inspectHostPath } from "../src/host-path.js";
import {
  compareVersions,
  argvIsSafe,
  routeRole,
} from "../src/executors.js";

test("two versions that cannot be ordered are reported, never silently resolved", () => {
  assert.equal(compareVersions("2.1.231", "nightly"), null);
  assert.equal(compareVersions("2.2.4", "2.1.231"), 1);
  assert.equal(compareVersions("2.1.231", "2.1.231"), 0);
});

test("routing is a table, so no model is asked who should do ordinary work", () => {
  assert.equal(routeRole("IMPLEMENT"), "claude");
  assert.equal(routeRole("INDEPENDENT_ACCEPTANCE"), "grok");
  assert.equal(routeRole("GIT_VERIFY"), "local");
  assert.equal(routeRole("TEST"), "local");
});

test("argv carrying shell syntax is refused even though no shell is used", () => {
  const attacks = [
    ["--flag", "x; rm -rf /"],
    ["--flag", "x && curl evil.example"],
    ["--output-format", "json`whoami`"],
    ["--prompt-file", "$(cat /etc/passwd)"],
  ];
  for (const argv of attacks) {
    assert.equal(argvIsSafe(argv).safe, false, `${argv.join(" ")} must be refused`);
  }
  assert.equal(argvIsSafe(["--print", "--output-format", "json"]).safe, true);
});

test("a lone redirect is refused; the JS arrow is not treated as one", () => {
  assert.equal(argvIsSafe(["-e", "setTimeout(() => process.exit(0), 8000)"]).safe, true);
  assert.equal(argvIsSafe(["-e", "process.exit(0)"]).safe, true);
  assert.equal(argvIsSafe(["--prompt-file", "C:/out>log"]).safe, false, "a lone > is a redirect");
  assert.equal(argvIsSafe(["-e", "2>=1"]).safe, false, ">= is not the arrow; leftover > stays a metacharacter");
});

test("an R&D worktree path is a place, not a shell metacharacter", () => {
  const rd = "C:\\Work\\R&D\\repo";
  assert.equal(inspectHostPath(rd).identifiable, true);
  assert.equal(argvIsSafe(["--cwd", rd, "--prompt-file", `${rd}\\PROMPT.md`]).safe, true);
});

test("&&, $(, |, > and a newline in a non-path token are still refused", () => {
  assert.equal(argvIsSafe(["--flag", "a&&b"]).safe, false);
  assert.equal(argvIsSafe(["--flag", "$(oops)"]).safe, false);
  assert.equal(argvIsSafe(["--flag", "a|b"]).safe, false);
  assert.equal(argvIsSafe(["--flag", "a>b"]).safe, false);
  assert.equal(argvIsSafe(["--flag", "a\nb"]).safe, false);
});

test("multi-character operators are refused even when the token parses as a path", () => {
  assert.equal(argvIsSafe(["C:/wt-a && calc.exe"]).safe, false);
  assert.equal(argvIsSafe(["C:/x$(calc).txt"]).safe, false);
  assert.equal(argvIsSafe(["C:/x`calc`.txt"]).safe, false);
  assert.equal(argvIsSafe(["C:/wt-a"]).safe, true);
  assert.equal(argvIsSafe(["\\\\host\\C$\\x"]).safe, true);
  assert.equal(argvIsSafe([
    "--prompt-file", "C:\\wt\\PROMPT.md",
    "--cwd", "C:\\wt",
    "--permission-mode", "bypassPermissions",
    "--always-approve",
    "--no-plan",
    "--max-turns", "50",
  ]).safe, true);
});
