import assert from "node:assert/strict";
import test from "node:test";
import { CRASH_POINTS, recover, mustNotRepeat } from "../lib/crash-recovery.mjs";
import { newRunRecord, runRecordAnswers, redactLine } from "../lib/run-record.mjs";

test("every modeled crash point has a recovery that does not blindly respawn", () => {
  for (const point of CRASH_POINTS) {
    const r = recover({
      point,
      runRecord: point === "BEFORE_RUN_RECORD" ? null : { runId: "r1" },
      processIdentity: point === "EXECUTOR_RUNNING" ? { pid: 1 } : null,
      processObservation: { alive: false },
      leaseHeld: point === "LEASE_HELD",
    });
    assert.ok(r.action, point);
    assert.equal(mustNotRepeat({ point }), true, point);
    assert.notEqual(r.action, "RESPAWN_SAME_RUN");
    assert.notEqual(r.action, "DEPLOY_AGAIN");
  }
});

test("alive matching process is reattached, not duplicated", () => {
  const r = recover({
    point: "EXECUTOR_RUNNING",
    processIdentity: { pid: 10 },
    processObservation: { alive: true },
  });
  assert.equal(r.action, "REATTACH");
});

test("validated handoff after crash is reapplied, not rerun", () => {
  const r = recover({
    point: "HANDOFF_VALIDATED_BEFORE_STATE",
    handoff: { status: "PASS" },
    handoffValid: true,
  });
  assert.equal(r.action, "REAPPLY_VALIDATED_RESULT");
});

test("Git change without a result trusts Git, not a missing completion record", () => {
  const r = recover({
    point: "GIT_CHANGED_BEFORE_RESULT",
    gitBefore: { head: "a" },
    gitAfter: { head: "b" },
  });
  assert.equal(r.action, "TRUST_GIT_NOT_MEMORY");
});

test("run record answers reboot questions without chat state", () => {
  const rec = newRunRecord({
    runId: "r1",
    workItemId: "w1",
    missionId: "m1",
    executor: "claude",
    role: "implementation",
    executablePath: "C:\\\\claude.exe",
    argv: ["-p", "--prompt-file", "prompt.md"],
    promptPath: "prompt.md",
    cwd: "C:\\\\wt",
    resourceKey: "worktree:wt",
    runNonce: "n1",
    startedAt: "2026-08-13T00:00:00.000Z",
  });
  rec.processIdentity = { pid: 1, creationDate: "x" };
  const q = runRecordAnswers(rec, { alive: false, identityMatch: false });
  assert.equal(q.supposedToRun, true);
  assert.equal(q.started, true);
  assert.equal(q.stillRunning, false);
  assert.equal(q.targetTree, "C:\\\\wt");
});

test("logs redact secrets", () => {
  const line = redactLine("Authorization: Bearer sk-abc123456789 token=tskey-abc");
  assert.ok(!line.includes("sk-abc"));
  assert.ok(!line.includes("tskey-abc"));
  assert.match(line, /REDACTED/);
});
