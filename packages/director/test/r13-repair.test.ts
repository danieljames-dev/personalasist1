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

const hostNoiseNonBrokerRow = {
  pid: 22540,
  parentPid: 36320,
  parentPresent: true,
  parentName: "services.exe",
  parentCreationDate: "2026-01-01T00:00:00.000Z",
  nonceReadable: true,
  runNonce: null,
  creationDate: AFTER_FLOOR,
};

const afterCeilingBrokerRow = {
  ...hostNoiseNonBrokerRow,
  parentName: "WmiPrvSE.exe",
  creationDate: AFTER_FLOOR,
};

const hostNoiseCtx = {
  runNonce: NONCE,
  createdNotBefore: FLOOR,
  holderPid: 4812,
  observedPids: new Set([4812]),
  rows: [] as { pid: number; parentPid?: number }[],
};

test("R13 a live older non-broker parent is host noise and the scan is SCANNED", () => {
  // A live older non-broker parent is still a complete explanation.
  // Broker parents are not provenance (R20 P1c); this case uses services.exe.
  assert.equal(processRowMakesScanUndecidable(hostNoiseNonBrokerRow, hostNoiseCtx), false);
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [hostNoiseNonBrokerRow],
    }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
  });
  assert.equal(interpreted.outcome, "SCANNED");
});

test("R13 a broker-parented row created after observed holder exit is not proven absent", () => {
  assert.equal(
    processRowMakesScanUndecidable(afterCeilingBrokerRow, {
      ...hostNoiseCtx,
      holderExitedAt: HOLDER_EXIT,
    }),
    true,
  );
  const interpreted = interpretWindowsOrphanScanOutput({
    status: 0,
    stdout: JSON.stringify({
      ok: true,
      unreadable: 0,
      processes: [afterCeilingBrokerRow],
    }),
    stderr: "",
    createdNotBefore: FLOOR,
    runNonce: NONCE,
    holderPid: 4812,
    holderExitedAt: HOLDER_EXIT,
  });
  assert.equal(interpreted.outcome, "UNAVAILABLE");
});
