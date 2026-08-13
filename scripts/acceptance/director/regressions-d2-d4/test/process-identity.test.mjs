import assert from "node:assert/strict";
import test from "node:test";
import { identitiesMatch, queryProcess, recordFromObservation } from "../lib/process-identity.mjs";

test("this process can be queried with creation time and executable path", () => {
  const obs = queryProcess(process.pid);
  assert.equal(obs.ok, true, JSON.stringify(obs));
  assert.equal(obs.pid, process.pid);
  assert.ok(obs.creationDate);
  assert.ok(obs.executablePath);
});

test("PID plus wrong creation time is treated as reuse, not ownership", () => {
  const obs = queryProcess(process.pid);
  const match = identitiesMatch({
    pid: process.pid,
    creationDate: "1999-01-01T00:00:00.000Z",
    executablePath: obs.executablePath,
  }, obs);
  assert.equal(match.ok, false);
  assert.equal(match.reason, "pid-reuse-creation-mismatch");
});

test("missing pid is not a match", () => {
  const obs = queryProcess(1);
  if (obs.ok) {
    const match = identitiesMatch({ pid: process.pid, creationDate: "x" }, obs);
    assert.equal(match.ok, false);
  } else {
    assert.equal(obs.ok, false);
  }
});

test("recordFromObservation keeps the discriminators", () => {
  const obs = queryProcess(process.pid);
  const rec = recordFromObservation(obs, "nonce-1");
  assert.equal(rec.pid, process.pid);
  assert.equal(rec.runNonce, "nonce-1");
  assert.ok(rec.creationDate);
});
