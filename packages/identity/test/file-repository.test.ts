import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";

import {
  FileIdentityStateRepository,
  initializeLocalIdentityV1,
  type IdentityPathBoundary,
} from "../src/index.js";
import { DeterministicClock, DeterministicGenerator } from "./helpers.js";

const fixtures: string[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function fixture(): string {
  const value = mkdtempSync(join(tmpdir(), "aion-identity-persistence-"));
  fixtures.push(value);
  return value;
}

const allowAllBoundary: IdentityPathBoundary = {
  authorize: ({ requestedAbsolutePath }) => ({ authorized: true, resolvedPath: resolve(requestedAbsolutePath) }),
  recheck: ({ requestedAbsolutePath }) => ({ authorized: true, resolvedPath: resolve(requestedAbsolutePath) }),
};

function repository(root: string, options = {}) {
  return new FileIdentityStateRepository({
    approvedRootAbsolutePath: root,
    pathBoundary: allowAllBoundary,
    temporaryName: () => "deterministic",
    ...options,
  });
}

test("filesystem repository atomically installs a complete state and reload preserves it exactly", async () => {
  const root = fixture();
  const repo = repository(root);
  const initialized = await initializeLocalIdentityV1(repo, new DeterministicGenerator(), new DeterministicClock());
  assert.equal(initialized.outcome, "initialized");
  assert.deepEqual(await repo.load(), initialized.state);
  assert.equal(existsSync(repo.statePath), true);
  assert.deepEqual(readdirSync(root).filter((name) => name.endsWith(".tmp")), []);
  assert.equal(readFileSync(repo.statePath, "utf8").endsWith("\n"), true);
});

test("exclusive lock conflict fails closed before initialization", async () => {
  const root = fixture();
  const repo = repository(root);
  writeFileSync(repo.lockPath, "synthetic competing initializer", "utf8");
  await assert.rejects(repo.withExclusiveInitialization(async () => undefined), { code: "identity-lock-conflict" });
  assert.equal(existsSync(repo.statePath), false);
});

test("injected pre-install failure leaves no final or temporary state", async () => {
  const root = fixture();
  const repo = repository(root, { hooks: { beforeInstall: () => { throw new Error("synthetic pre-install failure"); } } });
  await assert.rejects(initializeLocalIdentityV1(repo, new DeterministicGenerator(), new DeterministicClock()), {
    code: "identity-persistence-failed",
  });
  assert.equal(existsSync(repo.statePath), false);
  assert.deepEqual(readdirSync(root), []);
});

test("injected atomic-install failure leaves no partial final state", async () => {
  const root = fixture();
  const repo = repository(root, { hooks: { installTemporary: async () => { throw new Error("synthetic install failure"); } } });
  await assert.rejects(initializeLocalIdentityV1(repo, new DeterministicGenerator(), new DeterministicClock()), {
    code: "identity-persistence-failed",
  });
  assert.equal(existsSync(repo.statePath), false);
  assert.deepEqual(readdirSync(root), []);
});

test("existing final state is never overwritten by atomic installation", async () => {
  const root = fixture();
  const first = repository(root);
  const state = (await initializeLocalIdentityV1(first, new DeterministicGenerator(), new DeterministicClock())).state;
  const original = readFileSync(first.statePath, "utf8");
  const second = repository(root, { temporaryName: () => "second" });
  await assert.rejects(second.installNew(state), { code: "identity-state-conflict" });
  assert.equal(readFileSync(first.statePath, "utf8"), original);
});

test("unrelated stale temporary file does not become state or block initialization", async () => {
  const root = fixture();
  const stale = join(root, ".identity-state-v1.stale.tmp");
  writeFileSync(stale, "incomplete synthetic state", "utf8");
  const repo = repository(root);
  await initializeLocalIdentityV1(repo, new DeterministicGenerator(), new DeterministicClock());
  assert.equal(existsSync(repo.statePath), true);
  assert.equal(readFileSync(stale, "utf8"), "incomplete synthetic state");
});

test("malformed JSON fails closed and is not replaced", async () => {
  const root = fixture();
  const repo = repository(root);
  writeFileSync(repo.statePath, "{partial", "utf8");
  const generator = new DeterministicGenerator();
  await assert.rejects(initializeLocalIdentityV1(repo, generator, new DeterministicClock()), { code: "identity-state-invalid" });
  assert.equal(generator.calls.length, 0);
  assert.equal(readFileSync(repo.statePath, "utf8"), "{partial");
});

test("path authorization rejection prevents reads, locks, and writes", async () => {
  const root = fixture();
  let calls = 0;
  const rejecting: IdentityPathBoundary = {
    authorize: () => { calls += 1; return { authorized: false, reason: "synthetic-rejection" }; },
    recheck: () => { calls += 1; return { authorized: false, reason: "synthetic-rejection" }; },
  };
  const repo = new FileIdentityStateRepository({ approvedRootAbsolutePath: root, pathBoundary: rejecting });
  await assert.rejects(initializeLocalIdentityV1(repo, new DeterministicGenerator(), new DeterministicClock()), {
    code: "identity-path-rejected",
  });
  assert.equal(calls, 1);
  assert.deepEqual(readdirSync(root), []);
});
