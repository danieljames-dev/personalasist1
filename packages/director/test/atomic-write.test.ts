/**
 * writeAtomic must not delete the previous record to make room for the next.
 */
import assert from "node:assert/strict";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeAtomic, type AtomicWriteIoV1 } from "../src/atomic-write.js";

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

test("EPERM then ENOENT on rename leaves the previous target intact and fails the write", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-atomic-write-"));
  try {
    const target = join(dir, "intent.json");
    writeFileSync(target, "PREVIOUS_RECORD\n");
    let renames = 0;
    const io: AtomicWriteIoV1 = {
      mkdirSync,
      openSync,
      writeSync(fd, contents) {
        writeSync(fd, contents);
      },
      fsyncSync,
      closeSync,
      renameSync() {
        renames += 1;
        if (renames === 1) throw errno("EPERM");
        throw errno("ENOENT");
      },
      unlinkSync,
    };
    assert.throws(() => writeAtomic(target, "REPLACEMENT\n", io));
    assert.equal(readFileSync(target, "utf8"), "PREVIOUS_RECORD\n");
    assert.ok(renames >= 2, "the second rename must be attempted so ENOENT is the failure");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
