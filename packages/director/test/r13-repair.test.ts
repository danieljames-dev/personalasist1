/**
 * Round 13. The R12 B2 broker branch treated every no-nonce, post-floor
 * broker-parented row as UNAVAILABLE. That is host noise wearing the face
 * of a real observation. These cases fail on
 * d9b303028ad48181da59c6cb6a555ee42fc1eb64 and must stay failed until the
 * broker branch is scoped to a row that could belong to this run.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  interpretWindowsOrphanScanOutput,
  processRowMakesScanUndecidable,
} from "../src/process-identity.js";

const NONCE = "nonce-run-1";
const FLOOR = "2026-08-14T14:00:00.000Z";
const AFTER_FLOOR = "2026-08-14T14:00:05.000Z";
const HOLDER_EXIT = "2026-08-14T14:00:03.000Z";

const hostNoiseBrokerRow = {
  pid: 22540,
  parentPid: 36320,
  parentPresent: true,
  parentName: "WmiPrvSE.exe",
  nonceReadable: true,
  runNonce: null,
  creationDate: AFTER_FLOOR,
};

const hostNoiseCtx = {
  runNonce: NONCE,
  createdNotBefore: FLOOR,
  holderPid: 4812,
  observedPids: new Set([4812]),
  rows: [] as { pid: number; parentPid?: number }[],
};

test("R13 a broker-parented no-nonce post-floor row with no tie to this run is SCANNED", () => {
  // The R12 B2 fixture minus a lifetime ceiling: holder pid present, no
  // nonce, after the floor, broker parent, nothing else that could make
  // this row this run's. Against d9b3030 both calls fail-closed.
  assert.equal(processRowMakesScanUndecidable(hostNoiseBrokerRow, hostNoiseCtx), false);
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [hostNoiseBrokerRow],
    }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
  });
  assert.equal(interpreted.outcome, "SCANNED");
});

test("R13 a broker-parented row created after observed holder exit is host noise", () => {
  assert.equal(
    processRowMakesScanUndecidable(hostNoiseBrokerRow, {
      ...hostNoiseCtx,
      holderExitedAt: HOLDER_EXIT,
    }),
    false,
  );
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [hostNoiseBrokerRow],
    }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
  });
  assert.equal(interpreted.outcome, "SCANNED");
});
