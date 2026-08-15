/**
 * Exact argv for each executor, and the class of mistake that a per-adapter assertion misses.
 *
 * The prompt is a file path. Combining Grok's `-p` (`--single <PROMPT>`) with `--prompt-file`
 * starves `--single` of its argument and the run is garbage. That is not a Grok-only fact: any
 * adapter added later can make the same shape of mistake. The negative cases therefore walk
 * {@link allExecutorAdapters}, so coverage is the registry, not a list of test names.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  GROK_MAX_TURNS,
  RUN_NONCE_ENV,
  allExecutorAdapters,
  adapterNamed,
  classifyExecutorExit,
  type AdapterInputV1,
  type ExecutorAdapterV1,
} from "../src/executor-adapters.js";

const PROMPT_TEXT = "do the assigned work; this sentence must never appear as an argv element";
const RUN_NONCE = "nonce-9f3c2a1b7e44";

function withFixture(fn: (input: AdapterInputV1) => void): void {
  const cwd = mkdtempSync(join(tmpdir(), "aion-exec-adapter-"));
  const promptPath = join(cwd, "PROMPT.md");
  writeFileSync(promptPath, PROMPT_TEXT, "utf8");
  try {
    fn({ promptPath, cwd, runNonce: RUN_NONCE });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Exact argv, element by element
// ---------------------------------------------------------------------------

test("Grok 1.0.3 argv is the measured flag list, including --no-plan", () => {
  withFixture((input) => {
    const result = adapterNamed("grok").build({ ...input, role: "INDEPENDENT_ACCEPTANCE" });
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    assert.ok(result.launch);
    assert.deepEqual(result.launch.argv, [
      "--prompt-file", input.promptPath,
      "--cwd", input.cwd,
      "--permission-mode", "dontAsk",
      "--no-plan",
      "--max-turns", String(GROK_MAX_TURNS),
    ]);
    assert.equal(result.launch.cwd, input.cwd);
    assert.equal(result.launch.shell, false);
  });
});

test("a reviewer Grok launch uses the permission mode that cannot write", () => {
  withFixture((input) => {
    const result = adapterNamed("grok").build({ ...input, role: "ADVERSARIAL_REVIEW" });
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    assert.ok(result.launch);
    const modeIndex = result.launch.argv.indexOf("--permission-mode");
    assert.ok(modeIndex >= 0);
    assert.equal(result.launch.argv[modeIndex + 1], "dontAsk", "a review that can write is not a review");
    assert.equal(result.launch.argv.includes("--always-approve"), false);
  });
});

test("Claude 2.1.232 argv is -p and an explicit permission-mode, not a prompt path", () => {
  withFixture((input) => {
    const result = adapterNamed("claude").build(input);
    assert.equal(result.ok, true, result.ok ? "" : result.reason);
    assert.ok(result.launch);
    assert.deepEqual(result.launch.argv, ["-p", "--permission-mode", "bypassPermissions"]);
    assert.equal(result.launch.argv.includes(input.promptPath), false);
    assert.equal(result.launch.cwd, input.cwd);
    assert.equal(result.launch.shell, false);
  });
});

test("the local adapter refuses to pretend it can run", () => {
  withFixture((input) => {
    const result = adapterNamed("local").build(input);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_IMPLEMENTED");
    assert.match(result.reason, /not implemented|will not pretend/i);
    assert.ok(result.launch, "the launch shape stays uniform even when the adapter refuses");
    assert.deepEqual(result.launch.argv, []);
  });
});

// ---------------------------------------------------------------------------
// Every adapter — not a per-adapter list
// ---------------------------------------------------------------------------

test("no adapter emits -p with --prompt-file, prompt text, or the nonce on the command line", () => {
  withFixture((input) => {
    const adapters = allExecutorAdapters();
    assert.ok(adapters.length >= 3, "the registry must name every known executor");

    for (const adapter of adapters) {
      const role = adapter.name === "grok"
        ? "INDEPENDENT_ACCEPTANCE"
        : adapter.name === "claude"
          ? "IMPLEMENT"
          : undefined;
      const result = adapter.build(role === undefined ? input : { ...input, role });
      assert.ok(result.launch, `${adapter.name} must still describe a launch shape`);
      const argv = result.launch.argv;

      assert.equal(
        argv.includes("-p") && argv.includes("--prompt-file"),
        false,
        `${adapter.name} emitted both -p and --prompt-file`,
      );

      for (const token of argv) {
        assert.equal(
          token.includes(PROMPT_TEXT),
          false,
          `${adapter.name} leaked prompt text in argv token ${JSON.stringify(token)}`,
        );
      }

      assert.equal(existsSync(result.launch.promptPath), true, `${adapter.name} prompt path must exist`);
      assert.equal(statSync(result.launch.promptPath).isFile(), true, `${adapter.name} prompt path must be a file`);
      assert.equal(result.launch.promptPath, input.promptPath);

      assert.equal(result.launch.env[RUN_NONCE_ENV], RUN_NONCE, `${adapter.name} must put the nonce in the child env`);
      assert.equal(argv.includes(RUN_NONCE), false, `${adapter.name} put the run nonce on the command line`);
    }
  });
});

test("allExecutorAdapters is the live registry, not a handwritten list", () => {
  const names = allExecutorAdapters().map((adapter) => adapter.name).sort();
  assert.deepEqual(names, ["claude", "grok", "local"]);
  for (const adapter of allExecutorAdapters()) {
    assert.equal(adapterNamed(adapter.name), adapter);
  }
});

// ---------------------------------------------------------------------------
// Cwd and availability
// ---------------------------------------------------------------------------

test("a missing cwd is refused before spawn, not reported as an executable problem", () => {
  withFixture((input) => {
    const missing = join(input.cwd, "does-not-exist");
    for (const adapter of allExecutorAdapters()) {
      const result = adapter.build({ ...input, cwd: missing });
      assert.equal(result.ok, false, `${adapter.name} must refuse a missing cwd`);
      if (result.ok) return;
      assert.equal(result.code, "MISSING_CWD", `${adapter.name} must name MISSING_CWD`);
      assert.equal(result.launch, null);
    }
  });
});

test("a missing prompt file is refused rather than passed as a ghost path", () => {
  withFixture((input) => {
    const missing = join(input.cwd, "no-such-prompt.md");
    for (const adapter of allExecutorAdapters()) {
      const result = adapter.build({ ...input, promptPath: missing });
      assert.equal(result.ok, false, `${adapter.name} must refuse a missing prompt file`);
      if (result.ok) return;
      assert.equal(result.code, "MISSING_PROMPT");
    }
  });
});

test("Claude not logged in is an executor-availability problem, not a failed work item", () => {
  const unavailable = classifyExecutorExit("claude", 1, `${CLAUDE_LOGIN_MESSAGE}\n`);
  assert.equal(unavailable.kind, "EXECUTOR_UNAVAILABLE");
  if (unavailable.kind !== "EXECUTOR_UNAVAILABLE") return;
  assert.equal(unavailable.code, "NOT_LOGGED_IN");

  const completed = classifyExecutorExit("claude", 0, "ok");
  assert.equal(completed.kind, "COMPLETED");

  const failed = classifyExecutorExit("claude", 1, "some other error");
  assert.equal(failed.kind, "FAILED");
});

const CLAUDE_LOGIN_MESSAGE = "Not logged in · Please run /login";

test("every adapter is classified through the same exit function", () => {
  const adapters: readonly ExecutorAdapterV1[] = allExecutorAdapters();
  for (const adapter of adapters) {
    const viaAdapter = adapter.classifyExit(1, CLAUDE_LOGIN_MESSAGE);
    const viaName = classifyExecutorExit(adapter.name, 1, CLAUDE_LOGIN_MESSAGE);
    assert.deepEqual(viaAdapter, viaName, `${adapter.name} classifyExit must match classifyExecutorExit`);
  }
});
