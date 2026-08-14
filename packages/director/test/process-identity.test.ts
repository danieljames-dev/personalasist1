/**
 * Near-misses that a PID-only check would swallow.
 *
 * A test that a correct identity matches stays green while every dangerous case — reused PID,
 * swapped executable, unanswered probe treated as death — is implemented as a boolean. Each case
 * below is the defect it would miss.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ProcessLivenessV1 } from "../src/leases.js";
import {
  captureProcessIdentity,
  compareProcessIdentity,
  createWindowsProcessProbe,
  detectOrphan,
  holderLiveness,
  identityFromObservation,
  livenessGrants,
  processIdentityFrom,
  type ExecutorProcessIdentityV1,
  type HostProcessProbe,
  type ProcessObservationV1,
} from "../src/process-identity.js";

const GROK = "C:\\Tools\\grok.exe";
const NODE = "C:\\Program Files\\nodejs\\node.exe";
const T0 = "2026-08-13T10:00:00.000Z";
const T1 = "2026-08-13T11:00:00.000Z";
const NONCE_A = "nonce-run-a";
const NONCE_B = "nonce-run-b";

const RECORDED: ExecutorProcessIdentityV1 = {
  pid: 4812,
  creationDate: T0,
  executablePath: GROK,
  runNonce: NONCE_A,
};

function found(over: {
  pid?: number;
  creationDate?: string;
  executablePath?: string;
  runNonce?: string | null;
  parentPid?: number;
  omitCreationDate?: boolean;
  omitExecutable?: boolean;
  omitNonce?: boolean;
} = {}): ProcessObservationV1 {
  const observation: ProcessObservationV1 = {
    outcome: "FOUND",
    reason: "injected",
    pid: over.pid ?? RECORDED.pid,
    ...(over.omitCreationDate ? {} : { creationDate: over.creationDate ?? RECORDED.creationDate }),
    ...(over.omitExecutable ? {} : { executablePath: over.executablePath ?? RECORDED.executablePath }),
    ...(over.omitNonce ? {} : { runNonce: over.runNonce === undefined ? RECORDED.runNonce : over.runNonce }),
    ...(over.parentPid !== undefined ? { parentPid: over.parentPid } : {}),
  };
  return observation;
}

function probeReturning(observation: ProcessObservationV1): HostProcessProbe {
  return { observe: () => observation };
}

function asLeaseLiveness(value: ProcessLivenessV1): ProcessLivenessV1 {
  return value;
}

// ---------------------------------------------------------------------------
// Same PID, different process
// ---------------------------------------------------------------------------

test("the same pid with a later creation date is a different process, not the holder", () => {
  // Defect: `pid === recorded.pid && process exists` treated as MATCH / ALIVE.
  const reused = found({ creationDate: T1 });
  assert.equal(compareProcessIdentity(RECORDED, reused), "MISMATCH");
  assert.notEqual(compareProcessIdentity(RECORDED, reused), "MATCH");
  assert.equal(holderLiveness(RECORDED, reused), "DEAD_CONFIRMED");
});

test("a matching pid whose executable is now node.exe is not the recorded grok holder", () => {
  // Defect: pid match plus "a process is alive" read as evidence about grok.exe.
  const occupant = found({ executablePath: NODE });
  assert.equal(compareProcessIdentity(RECORDED, occupant), "MISMATCH");
  assert.notEqual(compareProcessIdentity(RECORDED, occupant), "MATCH");
  assert.equal(
    holderLiveness(RECORDED, occupant),
    "UNKNOWN",
    "same start time, different image is not a death certificate and is not the holder",
  );
});

test("an 8.3-looking alias is not required here: C:\\\\Tools\\\\grok.exe and c:/tools/grok.exe are one image", () => {
  const sameSpelling = found({ executablePath: "c:/tools/grok.exe" });
  assert.equal(compareProcessIdentity(RECORDED, sameSpelling), "MATCH");
});

// ---------------------------------------------------------------------------
// UNKNOWN grants nothing
// ---------------------------------------------------------------------------

test("UNKNOWN liveness permits neither a reclaim nor a writer-finished conclusion", () => {
  // Defect: `liveness !== "ALIVE"` (or a failed probe coerced to false) treated as permission.
  const granted = livenessGrants("UNKNOWN");
  assert.equal(granted.reclaim, false, "UNKNOWN is not a death certificate");
  assert.equal(granted.writerFinished, false, "UNKNOWN is not evidence the writer finished");
});

test("an access-denied probe is UNKNOWN and therefore grants nothing", () => {
  // Defect: probe failure mapped to DEAD_CONFIRMED because "we could not see it".
  const denied: ProcessObservationV1 = { outcome: "UNAVAILABLE", reason: "access-denied" };
  const liveness = asLeaseLiveness(holderLiveness(RECORDED, denied));
  assert.equal(liveness, "UNKNOWN");
  const granted = livenessGrants(liveness);
  assert.equal(granted.reclaim, false);
  assert.equal(granted.writerFinished, false);
});

test("a thrown probe is not captured as a pid-only identity, and is not death", () => {
  const exploding: HostProcessProbe = {
    observe() {
      throw new Error("access denied");
    },
  };
  const captured = captureProcessIdentity(exploding, { pid: 4812, runNonce: NONCE_A });
  assert.equal(captured.ok, false);
  assert.equal(captured.identity, null);
  assert.equal(captured.observation?.outcome, "UNAVAILABLE");
});

test("DEAD_CONFIRMED may reclaim and still must not conclude the writer finished", () => {
  const granted = livenessGrants("DEAD_CONFIRMED");
  assert.equal(granted.reclaim, true);
  assert.equal(granted.writerFinished, false, "a gone process is not a finished writer");
});

test("the observed identity is taken from the probe, never filled in from the recorded record", () => {
  const stranger = found({ pid: 9999, creationDate: T1, runNonce: NONCE_B, executablePath: NODE });
  const observed = identityFromObservation(stranger);
  assert.ok(observed);
  assert.equal(observed.pid, 9999);
  assert.equal(observed.creationDate, T1);
  assert.equal(observed.runNonce, NONCE_B);
  assert.notEqual(observed.pid, RECORDED.pid);
  assert.equal(identityFromObservation({ outcome: "NOT_FOUND", reason: "gone" }), null);
  assert.equal(identityFromObservation({ outcome: "UNAVAILABLE", reason: "access-denied" }), null);
  assert.equal(identityFromObservation(found({ omitNonce: true })), null);
});

test("ALIVE grants neither reclaim nor writer-finished", () => {
  const granted = livenessGrants("ALIVE");
  assert.equal(granted.reclaim, false);
  assert.equal(granted.writerFinished, false);
});

test("a pid-only observation cannot confirm the holder", () => {
  // Defect: agreeing on the slot number treated as MATCH.
  const slotOnly = found({ omitCreationDate: true, omitExecutable: true, omitNonce: true });
  assert.equal(compareProcessIdentity(RECORDED, slotOnly), "UNVERIFIABLE");
  assert.equal(holderLiveness(RECORDED, slotOnly), "UNKNOWN");
  assert.equal(livenessGrants("UNKNOWN").reclaim, false);
});

// ---------------------------------------------------------------------------
// Orphans
// ---------------------------------------------------------------------------

test("a live occupant whose nonce is not the recorded nonce is an orphan, not the holder", () => {
  // Defect: pid + creationDate + exe match, nonce ignored, reclaim or attach proceeds.
  const stranger = found({ runNonce: NONCE_B });
  assert.equal(compareProcessIdentity(RECORDED, stranger), "MISMATCH");
  const orphan = detectOrphan({ recorded: RECORDED, observed: stranger });
  assert.equal(orphan.orphan, true);
  assert.equal(orphan.kind, "NONCE_MISMATCH");
});

test("an executable mismatch is an orphan finding, not ownership of the slot", () => {
  const stranger = found({ executablePath: NODE });
  const orphan = detectOrphan({ recorded: RECORDED, observed: stranger });
  assert.equal(orphan.orphan, true);
  assert.equal(orphan.kind, "EXECUTABLE_MISMATCH");
});

test("a dead parent with a live child is an orphan", () => {
  const child = found({ pid: 5001 });
  const orphan = detectOrphan({
    recorded: RECORDED,
    observed: child,
    parentLiveness: "DEAD_CONFIRMED",
  });
  assert.equal(orphan.orphan, true);
  assert.equal(orphan.kind, "DEAD_PARENT_LIVE_CHILD");
});

test("UNKNOWN parent liveness does not invent a dead-parent orphan", () => {
  // Defect: failed parent probe treated as "parent is gone, kill the child".
  const child = found({ pid: 5001 });
  const orphan = detectOrphan({
    recorded: RECORDED,
    observed: child,
    parentLiveness: "UNKNOWN",
  });
  assert.equal(orphan.orphan, false);
  assert.equal(orphan.kind, null);
});

test("an UNAVAILABLE observation is not an orphan to be reaped", () => {
  const orphan = detectOrphan({
    recorded: RECORDED,
    observed: { outcome: "UNAVAILABLE", reason: "access-denied" },
  });
  assert.equal(orphan.orphan, false);
  assert.equal(orphan.kind, null);
});

// ---------------------------------------------------------------------------
// Capture at spawn
// ---------------------------------------------------------------------------

test("capture refuses to record a pid when the probe cannot produce a creation date", () => {
  const captured = captureProcessIdentity(probeReturning(found({ omitCreationDate: true })), {
    pid: 4812,
    runNonce: NONCE_A,
  });
  assert.equal(captured.ok, false);
  assert.equal(captured.identity, null);
});

test("capture records the caller nonce, not a nonce the observation happened to lack", () => {
  const captured = captureProcessIdentity(probeReturning(found({ omitNonce: true })), {
    pid: 4812,
    runNonce: NONCE_A,
  });
  assert.equal(captured.ok, true);
  if (!captured.ok) return;
  assert.equal(captured.identity.runNonce, NONCE_A);
  assert.equal(captured.identity.pid, 4812);
  assert.equal(captured.identity.creationDate, T0);
  assert.equal(captured.identity.executablePath, GROK);
});

test("an untrusted identity object missing a creation date is refused, not filled in", () => {
  const read = processIdentityFrom({ pid: 4812, executablePath: GROK, runNonce: NONCE_A });
  assert.equal(read.ok, false);
  assert.equal(read.identity, null);
});

// ---------------------------------------------------------------------------
// Real host: the probe works at all
// ---------------------------------------------------------------------------

test("the Windows host probe can observe this process by more than its pid", () => {
  const observation = createWindowsProcessProbe().observe(process.pid);
  assert.equal(observation.outcome, "FOUND", JSON.stringify(observation));
  if (observation.outcome !== "FOUND") return;
  assert.equal(observation.pid, process.pid);
  assert.ok(observation.creationDate, "creationDate is why a reused pid is not this process");
  assert.ok(observation.executablePath, "executablePath is why a later node.exe is not the holder");

  const captured = captureProcessIdentity(createWindowsProcessProbe(), {
    pid: process.pid,
    runNonce: "nonce-self-probe",
  });
  assert.equal(captured.ok, true, captured.ok ? "" : captured.reason);
  if (!captured.ok) return;
  // The caller nonce is what was recorded. The live process may already carry a different
  // AION_RUN_NONCE in this environment; that must not make the probe look broken.
  const hostFields: ProcessObservationV1 = {
    outcome: "FOUND",
    reason: observation.reason,
    pid: observation.pid,
    ...(observation.creationDate !== undefined ? { creationDate: observation.creationDate } : {}),
    ...(observation.executablePath !== undefined ? { executablePath: observation.executablePath } : {}),
    runNonce: captured.identity.runNonce,
  };
  assert.equal(compareProcessIdentity(captured.identity, hostFields), "MATCH");
});
