/**
 * Near-misses that a PID-only check would swallow.
 *
 * A test that a correct identity matches stays green while every dangerous case — reused PID,
 * swapped executable, unanswered probe treated as death — is implemented as a boolean. Each case
 * below is the defect it would miss.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import type { ProcessLivenessV1 } from "../src/leases.js";
import {
  captureProcessIdentity,
  compareProcessIdentity,
  createWindowsOrphanScanner,
  createWindowsProcessProbe,
  detectOrphan,
  holderLiveness,
  identityFromObservation,
  interpretWindowsOrphanScanOutput,
  interpretWindowsProbeOutput,
  livenessGrants,
  normaliseRunNonce,
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
  // CIM typically has no nonce on the occupant. A later start with no nonce is reuse.
  // The previous version defaulted the recorded nonce onto the occupant, so the
  // nonce-over-date rule would have flipped this to UNKNOWN and pinned the opposite.
  const reused = found({ creationDate: T1, omitNonce: true });
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

test("detectOrphan compares the normalised nonce, not the raw spelling", () => {
  const padded = found({ runNonce: `  ${NONCE_A}  ` });
  const orphan = detectOrphan({ recorded: RECORDED, observed: padded });
  assert.equal(orphan.orphan, false);
  assert.notEqual(orphan.kind, "NONCE_MISMATCH");
});

test("normaliseRunNonce is the single spelling used for persist, env, and scan", () => {
  assert.equal(normaliseRunNonce(`  ${NONCE_A}  `), NONCE_A);
  assert.equal(normaliseRunNonce(""), null);
  assert.equal(normaliseRunNonce("\u0000x"), null);
});

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

test("DMTF and ISO spellings of the same creation instant are the same process, not PID reuse", () => {
  // Defect: sameCreationDate fell back to string equality. WMI emits
  // 20260813120001.000000+000; a later ISO observation of the same instant
  // was treated as DEAD_CONFIRMED and reclaim: true.
  const recorded: ExecutorProcessIdentityV1 = {
    ...RECORDED,
    creationDate: "20260813120001.000000+000",
  };
  const observed = found({ creationDate: "2026-08-13T12:00:01.0000000+00:00" });
  assert.equal(compareProcessIdentity(recorded, observed), "MATCH");
  assert.equal(holderLiveness(recorded, observed), "ALIVE");
  assert.equal(livenessGrants(holderLiveness(recorded, observed)).reclaim, false);
});

test("two encodings of one live process are not a death certificate", () => {
  // A zone-less string is not a comparable instant. Constructors must refuse
  // it rather than stamp Z — a literal record hid the guess from this test.
  const unspecified = "2026-08-13T12:00:01.0000000";
  const constructed = processIdentityFrom({
    pid: RECORDED.pid,
    creationDate: unspecified,
    executablePath: RECORDED.executablePath,
    runNonce: RECORDED.runNonce,
  });
  assert.equal(constructed.ok, false, "a constructor must refuse a zone-less creationDate");
  assert.equal(constructed.identity, null);
  assert.equal(identityFromObservation(found({ creationDate: unspecified })), null);

  const probed = interpretWindowsProbeOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      pid: RECORDED.pid,
      executablePath: RECORDED.executablePath,
      creationDate: unspecified,
    }),
    stderr: "",
  });
  assert.equal(probed.outcome, "FOUND");
  if (probed.outcome === "FOUND") {
    assert.equal(probed.creationDate, undefined, "a zone-less CIM token is not stamped Z");
  }
});

test("a zone-less re-encoding of a zoned instant is UNKNOWN, not a death certificate", () => {
  const recorded: ExecutorProcessIdentityV1 = {
    ...RECORDED,
    creationDate: "2026-08-13T12:00:01.000+02:00",
  };
  const observed = found({
    creationDate: "2026-08-13T12:00:01.0000000",
    executablePath: recorded.executablePath,
    omitNonce: true,
  });
  assert.equal(holderLiveness(recorded, observed), "UNKNOWN");
  assert.notEqual(holderLiveness(recorded, observed), "DEAD_CONFIRMED");
  assert.equal(livenessGrants(holderLiveness(recorded, observed)).reclaim, false);
});

test("a date difference that still carries the recorded nonce is UNKNOWN, not death", () => {
  // Defect: holderLiveness minted DEAD_CONFIRMED from the date before reading
  // the nonce, discarding the field this module calls "survives PID reuse outright".
  const later = found({ creationDate: T1, runNonce: NONCE_A });
  assert.equal(compareProcessIdentity(RECORDED, later), "MISMATCH");
  assert.equal(holderLiveness(RECORDED, later), "UNKNOWN");
  assert.equal(detectOrphan({ recorded: RECORDED, observed: later }).orphan, false);
});

test("build-7 is not a process creation instant", () => {
  // Defect: Date.parse("build-7") is 2001-07-01. A corrupt record was repaired
  // into a plausible instant and then minted DEAD_CONFIRMED against a real 2026 date.
  const corrupt = found({ creationDate: "build-7" });
  assert.equal(compareProcessIdentity(RECORDED, corrupt), "UNVERIFIABLE");
  assert.equal(holderLiveness(RECORDED, corrupt), "UNKNOWN");
  assert.notEqual(holderLiveness(RECORDED, corrupt), "DEAD_CONFIRMED");
  const read = processIdentityFrom({
    pid: 4812,
    creationDate: "build-7",
    executablePath: GROK,
    runNonce: NONCE_A,
  });
  assert.equal(read.ok, false, "an unparseable timestamp must deny rather than normalise");
  assert.equal(read.identity, null);
  assert.equal(identityFromObservation(corrupt), null);
});

test("unparseable unequal creation dates are UNKNOWN, not confirmed death", () => {
  // Defect: unparseable-and-unequal returned false from sameCreationDate,
  // which holderLiveness read as PID reuse → DEAD_CONFIRMED.
  const recorded: ExecutorProcessIdentityV1 = {
    ...RECORDED,
    creationDate: "cim-unparsed-A",
  };
  const observed = found({ creationDate: "cim-unparsed-B" });
  assert.equal(compareProcessIdentity(recorded, observed), "UNVERIFIABLE");
  assert.equal(holderLiveness(recorded, observed), "UNKNOWN");
  assert.equal(livenessGrants(holderLiveness(recorded, observed)).reclaim, false);
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

test("a shadowed powershell that exits non-zero with empty stdout is UNAVAILABLE, not death", () => {
  // Defect: JSON.parse(stdout || '{"ok":false}') plus a default reason of
  // "not-found" turned a live process into DEAD_CONFIRMED / reclaim: true
  // whenever powershell.exe was missing, shadowed, or WMI failed.
  const probe = createWindowsProcessProbe({
    spawnSync: () => ({ status: 1, stdout: "", stderr: "" }),
  });
  const observation = probe.observe(process.pid);
  assert.equal(observation.outcome, "UNAVAILABLE", JSON.stringify(observation));
  assert.notEqual(observation.outcome, "NOT_FOUND");
  const recorded: ExecutorProcessIdentityV1 = {
    pid: process.pid,
    creationDate: T0,
    executablePath: NODE,
    runNonce: NONCE_A,
  };
  assert.equal(holderLiveness(recorded, observation), "UNKNOWN");
  assert.equal(livenessGrants(holderLiveness(recorded, observation)).reclaim, false);
});

test("probe failure envelopes are UNAVAILABLE even when they look like not-found", () => {
  assert.equal(
    interpretWindowsProbeOutput({ status: 0, stdout: "", stderr: "" }).outcome,
    "UNAVAILABLE",
  );
  assert.equal(
    interpretWindowsProbeOutput({ status: 1, stdout: "", stderr: "" }).outcome,
    "UNAVAILABLE",
  );
  assert.equal(
    interpretWindowsProbeOutput({
      status: 1,
      stdout: "{\"ok\":false,\"reason\":\"not-found\"}",
      stderr: "",
    }).outcome,
    "UNAVAILABLE",
  );
  assert.equal(
    interpretWindowsProbeOutput({ status: 0, stdout: "{\"ok\":false}", stderr: "" }).outcome,
    "UNAVAILABLE",
  );
  assert.equal(
    interpretWindowsProbeOutput({
      status: 0,
      stdout: "{\"ok\":false,\"reason\":\"cim-error\"}",
      stderr: "",
    }).outcome,
    "UNAVAILABLE",
  );
  const gone = interpretWindowsProbeOutput({
    status: 0,
    stdout: "{\"ok\":false,\"reason\":\"not-found\"}",
    stderr: "",
  });
  assert.equal(gone.outcome, "NOT_FOUND");
});

test("orphan-scan failure envelopes are UNAVAILABLE, never an empty match list", () => {
  assert.equal(
    interpretWindowsOrphanScanOutput({ status: 0, stdout: "", stderr: "" }).outcome,
    "UNAVAILABLE",
  );
  assert.equal(
    interpretWindowsOrphanScanOutput({ status: 1, stdout: "", stderr: "" }).outcome,
    "UNAVAILABLE",
  );
  assert.equal(
    interpretWindowsOrphanScanOutput({
      status: 0,
      stdout: "{\"ok\":false,\"reason\":\"cim-error\"}",
      stderr: "",
    }).outcome,
    "UNAVAILABLE",
  );
  assert.equal(
    interpretWindowsOrphanScanOutput({ status: 0, stdout: "{\"ok\":false}", stderr: "" }).outcome,
    "UNAVAILABLE",
  );
  const empty = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: "{\"ok\":true,\"processes\":[]}",
    stderr: "",
  });
  assert.equal(empty.outcome, "SCANNED");
  if (empty.outcome === "SCANNED") assert.deepEqual(empty.sightings, []);

  const one = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: "{\"ok\":true,\"processes\":{\"pid\":4812,\"runNonce\":\"nonce-a\",\"creationDate\":\"2026-08-13T12:00:01.000Z\"}}",
    stderr: "",
  });
  assert.equal(one.outcome, "SCANNED");
  if (one.outcome === "SCANNED") {
    assert.equal(one.sightings.length, 1);
    assert.equal(one.sightings[0]?.pid, 4812);
    assert.equal(one.sightings[0]?.runNonce, "nonce-a");
  }
});

test("a shadowed orphan scan that fails does not report an empty match list", () => {
  const scanner = createWindowsOrphanScanner({
    spawnSync: () => ({ status: 1, stdout: "", stderr: "" }),
  });
  assert.throws(
    () => scanner({ runNonce: NONCE_A, createdNotBefore: "" }),
    /unavailable/,
  );
});

test("an earlier observed creation instant is UNKNOWN, not DEAD_CONFIRMED", () => {
  const earlier = found({ creationDate: "2026-08-13T09:00:00.000Z", omitNonce: true });
  assert.equal(holderLiveness(RECORDED, earlier), "UNKNOWN");
  assert.notEqual(holderLiveness(RECORDED, earlier), "DEAD_CONFIRMED");
});

test("a strictly later observed instant with a different image is still DEAD_CONFIRMED", () => {
  const later = found({
    creationDate: T1,
    executablePath: NODE,
    omitNonce: true,
  });
  assert.equal(holderLiveness(RECORDED, later), "DEAD_CONFIRMED");
});

test("equal instants in two encodings stay MATCH / ALIVE", () => {
  const dmtf = found({
    creationDate: "20260813100000.000000+000",
  });
  assert.equal(compareProcessIdentity(RECORDED, dmtf), "MATCH");
  assert.equal(holderLiveness(RECORDED, dmtf), "ALIVE");
});

test("unreadable > 0 is UNAVAILABLE and distinguishable from unreadable 0", () => {
  const unread = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: "{\"ok\":true,\"processes\":[],\"unreadable\":1}",
    stderr: "",
  });
  assert.equal(unread.outcome, "UNAVAILABLE");
  const empty = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: "{\"ok\":true,\"processes\":[],\"unreadable\":0}",
    stderr: "",
  });
  assert.equal(empty.outcome, "SCANNED");
  if (empty.outcome === "SCANNED") assert.deepEqual(empty.sightings, []);
});

test("the orphan-scan script restricts unreadable to the holder descendant chain", () => {
  let script = "";
  const scanner = createWindowsOrphanScanner({
    spawnSync: (_cmd, args) => {
      script = String(args[3] ?? "");
      return { status: 0, stdout: "{\"ok\":true,\"processes\":[],\"unreadable\":0}", stderr: "" };
    },
  });
  scanner({ runNonce: NONCE_A, createdNotBefore: "", holderPid: 4812 });
  assert.match(script, /unreadable/);
  assert.match(script, /ParentProcessId/);
  assert.match(script, /holderPid/);
  assert.match(script, /\$desc/);
});

test("the orphan scanner keeps only this nonce and drops processes created too early", () => {
  const scanner = createWindowsOrphanScanner({
    spawnSync: () => ({
      status: 0,
      stdout: JSON.stringify({
        ok: true,
        processes: [
          { pid: 10, creationDate: "2026-08-13T10:00:00.000Z", runNonce: NONCE_A },
          { pid: 11, creationDate: "2026-08-13T12:00:00.000Z", runNonce: NONCE_A },
          { pid: 12, creationDate: "2026-08-13T12:00:00.000Z", runNonce: NONCE_B },
        ],
      }),
      stderr: "",
    }),
  });
  const hits = scanner({ runNonce: NONCE_A, createdNotBefore: "2026-08-13T11:00:00.000Z" });
  assert.deepEqual(hits.map((item) => item.pid), [11]);
});

test("the Windows orphan scanner finds a live child by AION_RUN_NONCE in its environment", async () => {
  const nonce = `nonce-scan-live-${process.pid}-${Date.now()}`;
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    env: { ...process.env, AION_RUN_NONCE: nonce },
    windowsHide: true,
    stdio: "ignore",
  });
  try {
    assert.ok(child.pid && child.pid > 0, "the child must have a pid");
    const sightings = createWindowsOrphanScanner()({
      runNonce: nonce,
      createdNotBefore: "",
    });
    assert.ok(
      sightings.some((item) => item.pid === child.pid && item.runNonce === nonce),
      `expected pid ${child.pid} in ${JSON.stringify(sightings)}`,
    );
  } finally {
    child.kill();
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
  }
});

test("a real-shaped zoned CIM instant still produces a recorded identity", () => {
  const zoned = "2026-08-14T10:41:20.8867590-04:00";
  const read = processIdentityFrom({
    pid: 4812,
    creationDate: zoned,
    executablePath: GROK,
    runNonce: NONCE_A,
  });
  assert.equal(read.ok, true, read.ok ? "" : read.reason);
  assert.equal(read.identity?.creationDate, "2026-08-14T14:41:20.886Z");

  const observed = interpretWindowsProbeOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      pid: 4812,
      executablePath: GROK,
      creationDate: zoned,
    }),
    stderr: "",
  });
  assert.equal(observed.outcome, "FOUND");
  if (observed.outcome === "FOUND") {
    assert.equal(observed.creationDate, "2026-08-14T14:41:20.886Z");
  }
});

test("holderLiveness of a different pid is UNKNOWN, not a death certificate", () => {
  const stranger: ProcessObservationV1 = {
    outcome: "FOUND",
    reason: "injected",
    pid: 9999,
    creationDate: "2026-08-13T13:00:00.000Z",
    executablePath: "C:\\Windows\\System32\\svchost.exe",
  };
  assert.equal(compareProcessIdentity(RECORDED, stranger), "MISMATCH");
  assert.equal(holderLiveness(RECORDED, stranger), "UNKNOWN");
  assert.equal(livenessGrants(holderLiveness(RECORDED, stranger)).reclaim, false);
});

test("the orphan scanner sees a child whose argv names a different nonce than its environment", async () => {
  const nonce = `nonce-scan-decoy-${process.pid}-${Date.now()}`;
  const child = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 30000)", `AION_RUN_NONCE=someothervalue`],
    {
      env: { ...process.env, AION_RUN_NONCE: nonce },
      windowsHide: true,
      stdio: "ignore",
    },
  );
  try {
    assert.ok(child.pid && child.pid > 0, "the child must have a pid");
    const sightings = createWindowsOrphanScanner()({
      runNonce: nonce,
      createdNotBefore: "",
    });
    assert.ok(
      sightings.some((item) => item.pid === child.pid && item.runNonce === nonce),
      `decoy argv must not hide pid ${child.pid}: ${JSON.stringify(sightings)}`,
    );
  } finally {
    child.kill();
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
    });
  }
});

test("a successful PEB read with no nonce is not overridden by argv text", () => {
  let script = "";
  const scanner = createWindowsOrphanScanner({
    spawnSync: (_cmd, args) => {
      script = String(args[3] ?? "");
      return {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          unreadable: 0,
          processes: [{
            pid: 4120,
            creationDate: "2026-08-14T14:00:00.000Z",
            runNonce: null,
            parentPid: 1,
            nonceReadable: true,
            parentPresent: true,
          }],
        }),
        stderr: "",
      };
    },
  });
  const hits = scanner({ runNonce: NONCE_A, createdNotBefore: "2026-08-14T14:00:00.000Z" });
  assert.deepEqual(hits, []);
  const pebAt = script.indexOf("[AionPebEnv]::GetNonce");
  const cmdAt = script.indexOf("CommandLine -match");
  assert.ok(pebAt >= 0 && cmdAt >= 0 && pebAt < cmdAt, "PEB must be read before CommandLine");
  assert.match(script, /return ""/);
});

test("a nonce-unreadable orphan after the floor makes the scan UNAVAILABLE", () => {
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [{
        pid: 21780,
        parentPid: 7504,
        creationDate: "2026-08-14T14:00:00.000Z",
        nonceReadable: false,
        parentPresent: false,
      }],
    }),
    stderr: "",
    createdNotBefore: "2026-08-14T14:00:00.000Z",
  });
  assert.equal(interpreted.outcome, "UNAVAILABLE");
});

test("unreadable rows with live parents or older creation still yield a performed scan", () => {
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [
        {
          pid: 4,
          parentPid: 0,
          creationDate: "2026-01-01T00:00:00.000Z",
          nonceReadable: false,
          parentPresent: false,
        },
        {
          pid: 100,
          parentPid: 99,
          creationDate: "2026-08-14T15:00:00.000Z",
          nonceReadable: false,
          parentPresent: true,
        },
      ],
    }),
    stderr: "",
    createdNotBefore: "2026-08-14T14:00:00.000Z",
  });
  assert.equal(interpreted.outcome, "SCANNED");
});
