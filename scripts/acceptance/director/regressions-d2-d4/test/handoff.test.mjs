import assert from "node:assert/strict";
import test from "node:test";
import { evaluateHandoffSuccess, parseMaybeHandoff } from "../lib/handoff-conjunction.mjs";

const base = {
  exitCode: 0,
  stillRunning: false,
  parseOk: true,
  expectedWorkItemId: "wi-1",
  expectedRunId: "run-1",
  expectedMissionId: "m-1",
  runRoot: "C:\\\\AION\\\\director\\\\missions\\\\m-1\\\\RUNS\\\\run-1",
  handoff: {
    workItemId: "wi-1",
    runId: "run-1",
    missionId: "m-1",
    headAfter: "a".repeat(40),
    branch: "executor/x",
    spendUsd: 0,
    artifacts: ["notes.md"],
  },
  git: { head: "a".repeat(40), branch: "executor/x", dirty: false, headExists: true, detached: false },
};

test("exit 0 without handoff is not success", () => {
  const r = evaluateHandoffSuccess({ ...base, handoff: null });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes("handoff-missing"));
});

test("exit 0 + malformed / truncated JSON fails", () => {
  const p = parseMaybeHandoff("{\"workItemId\":\"wi-1\"");
  assert.equal(p.ok, false);
  const r = evaluateHandoffSuccess({ ...base, parseOk: false, truncatedJson: true });
  assert.equal(r.ok, false);
});

test("two JSON objects fail closed", () => {
  const p = parseMaybeHandoff("{\"a\":1}{\"b\":2}");
  assert.equal(p.ok, false);
  assert.equal(p.multipleJsonObjects, true);
});

test("stdout noise before JSON still parses but success still needs Git", () => {
  const p = parseMaybeHandoff("here you go\n{\"workItemId\":\"wi-1\"}");
  assert.equal(p.ok, true);
  assert.equal(p.hadPrefixNoise, true);
});

test("wrong work item / run id fails", () => {
  const r = evaluateHandoffSuccess({
    ...base,
    handoff: { ...base.handoff, workItemId: "other" },
  });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes("handoff-wrong-work-item"));
});

test("exit nonzero with pretty handoff fails", () => {
  const r = evaluateHandoffSuccess({ ...base, exitCode: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes("exit-nonzero"));
});

test("artifact outside run root fails", () => {
  const r = evaluateHandoffSuccess({
    ...base,
    handoff: { ...base.handoff, artifacts: ["C:\\\\Windows\\\\system32\\\\cmd.exe"] },
  });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes("artifact-outside-run-root"));
});

test("claimed commit missing / dirty-while-clean fail", () => {
  const missing = evaluateHandoffSuccess({
    ...base,
    git: { ...base.git, headExists: false },
  });
  assert.ok(missing.reasons.includes("claimed-commit-missing"));
  const dirty = evaluateHandoffSuccess({
    ...base,
    handoff: { ...base.handoff, clean: true },
    git: { ...base.git, dirty: true },
  });
  assert.ok(dirty.reasons.includes("clean-claim-while-dirty"));
});

test("conjunction success only when independent facts agree", () => {
  const r = evaluateHandoffSuccess(base);
  assert.equal(r.ok, true, r.reasons.join(","));
});
