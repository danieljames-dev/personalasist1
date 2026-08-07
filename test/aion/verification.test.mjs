import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { VerificationCapabilityV1, digestValue } from "../../packages/local-assistant/dist/index.js";
import { AllowlistedVerificationRunnerV1 } from "../../apps/aion/verification.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const runner = new AllowlistedVerificationRunnerV1(repositoryRoot, digestValue);
const capability = new VerificationCapabilityV1(runner);

test("every allowlisted verification operation is read-only and fully specified in the repository", () => {
  const operations = runner.operations();
  assert.ok(operations.length >= 2, "the allowlist is populated");
  const seen = new Set();
  for (const operation of operations) {
    assert.equal(operation.readOnly, true, `${operation.id} must not be able to modify the repository`);
    assert.ok(operation.displayCommand.trim().length > 0);
    assert.ok(operation.timeoutMs > 0, "every operation is bounded in time");
    assert.equal(seen.has(operation.id), false, "operation identifiers are unique");
    seen.add(operation.id);
    assert.doesNotMatch(operation.displayCommand, /[;&|><`$]/u, "no allowlisted command contains shell metacharacters");
  }
});

test("the runner accepts an identifier and offers no way to supply a command", () => {
  assert.throws(() => runner.run("npm.publish", new AbortController().signal), /not on the allowlist/u);
  assert.throws(() => runner.run("git status --short", new AbortController().signal), /not on the allowlist/u);
  assert.equal(runner.get("definitely.not.real"), null);
  // The port surface is deliberately tiny: identifiers in, evidence out.
  assert.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(runner)).filter((n) => n !== "constructor").sort(), ["get", "operations", "run"]);
});

test("the capability refuses every shape of smuggled command rather than ignoring it", () => {
  for (const [label, input] of [
    ["a bare shell command", { command: "rm -rf /" }],
    ["a command line", { operationId: "git.status", commandLine: "rm -rf /" }],
    ["an argument vector", { operationId: "git.status", args: ["--upload-pack", "evil"] }],
    ["an argv alias", { operationId: "git.status", argv: ["evil"] }],
    ["a shell flag", { operationId: "git.status", shell: true }],
    ["a working directory", { operationId: "git.status", cwd: "C:\\" }],
    ["an environment", { operationId: "git.status", env: { PATH: "C:\\evil" } }],
    ["a script", { operationId: "git.status", script: "evil.ps1" }],
  ]) {
    assert.throws(() => capability.validate(input), /must not carry|not on the allowlist/u, label);
  }
  assert.throws(() => capability.validate({ operationId: "git status; whoami" }), /not on the allowlist/u, "an identifier is never parsed as a command");
  assert.throws(() => capability.validate({ operationId: "npm.publish" }), /not on the allowlist/u);
  assert.throws(() => capability.validate({}), /not on the allowlist/u);
  assert.throws(() => capability.validate({ operationId: "git.status", note: "harmless" }), /accepts only operationId/u, "even a harmless extra field is refused, so nothing can hide");
  capability.validate({ operationId: "git.status" });
});

test("the approval summary names the exact command AION owns", () => {
  const summary = capability.summarize({ operationId: "npm.verify" });
  assert.match(summary, /npm run verify/u);
  assert.match(summary, /no part of it came from a model/u);
  assert.match(capability.summarize({ operationId: "nope" }), /refused/u);
});

test("a real allowlisted read-only operation produces bounded, digested evidence", async () => {
  const run = await capability.execute({ operationId: "git.status" }, {}, new AbortController().signal);
  assert.equal(run.operationId, "git.status");
  assert.equal(run.displayCommand, "git status --short");
  assert.equal(typeof run.exitCode, "number");
  assert.equal(run.outcome, run.exitCode === 0 && !run.timedOut ? "passed" : "failed");
  assert.equal(run.resultDigest.length, 64, "evidence is digested so an analysis cites an exact run");
  assert.equal(run.resultDigest, digestValue({ operationId: "git.status", exitCode: run.exitCode, stdout: run.stdout, stderr: run.stderr }));
  assert.ok(Date.parse(run.startedAt) <= Date.parse(run.completedAt));
  assert.equal(typeof run.truncated, "boolean");
  assert.ok(run.stdout.length <= 64 * 1024 && run.stderr.length <= 64 * 1024, "output is bounded");
});

test("the verification runner never routes through a shell or a Windows shim", async () => {
  const raw = await readFile(join(repositoryRoot, "apps/aion/verification.mjs"), "utf8");
  // Comments legitimately discuss shims and shells; only executable code is in scope here.
  const source = raw.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/.*$/gmu, "$1");
  assert.match(source, /shell:\s*false/u, "processes are spawned without a shell");
  assert.doesNotMatch(source, /shell:\s*true/u);
  assert.doesNotMatch(source, /["'][^"']*\.(?:cmd|ps1|bat)["']/u, "npm is reached through its CLI entry point, never a shell shim");
  assert.doesNotMatch(source, /execSync|spawnSync/u);
  // No template interpolation may ever reach an argument array.
  assert.doesNotMatch(source, /args:\s*(?:Object\.freeze\()?\[[^\]]*\$\{/u, "no argument is built from an interpolated value");
});
