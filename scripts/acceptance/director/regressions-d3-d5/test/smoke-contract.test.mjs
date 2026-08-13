import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyExecutorAvailability,
  evaluateSmoke,
  grokArgv,
  grokArgvDefective,
  grokArgvLegal,
} from "../lib/smoke-contract.mjs";

const good = {
  executableStarted: true,
  cwdValidated: true,
  shell: false,
  promptIsData: true,
  durableRunIntent: true,
  boundedLogs: true,
  processTreeTerminated: true,
  handoffStructural: true,
  handoffSemanticIds: true,
  artifactsInsideRunRoot: true,
  gitAgrees: true,
  unauthorizedFiles: false,
  spendUsd: 0,
  exitCode: 0,
};

test("exit 0 without the conjunction is not a smoke PASS", () => {
  const r = evaluateSmoke({ ...good, handoffStructural: false, exitCode: 0 });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes("exit-zero-insufficient"));
});

test("full conjunction passes", () => {
  assert.equal(evaluateSmoke(good).ok, true);
});

test("Claude not-logged-in is UNAVAILABLE, not mission corruption", () => {
  const avail = classifyExecutorAvailability({
    executablePath: "C:\\\\claude.exe",
    started: true,
    exitCode: 1,
    stdout: "Not logged in · Please run /login",
  });
  assert.equal(avail, "UNAVAILABLE");
  const smoke = evaluateSmoke({
    ...good,
    exitCode: 1,
    loginRequired: true,
    probe: { executablePath: "x", started: true, exitCode: 1, stdout: "Not logged in" },
  });
  assert.equal(smoke.ok, false);
  assert.ok(smoke.reasons.includes("executor-unavailable-not-corruption"));
  assert.equal(smoke.availability, "UNAVAILABLE");
});

test("Grok argv must use --prompt-file and must not starve -p", () => {
  const cwd = "C:\\\\scratch\\\\oracle";
  const prompt = `${cwd}\\\\prompt.md`;
  assert.equal(grokArgvLegal(grokArgv({ promptFile: prompt, cwd })), true);
  assert.equal(grokArgvLegal(grokArgvDefective({ promptFile: prompt, cwd })), false);
});
