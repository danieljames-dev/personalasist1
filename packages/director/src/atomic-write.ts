/**
 * One durable replace. Temp file, fsync, rename.
 *
 * The previous record is the only anti-repeat evidence at some call sites
 * (`intent.json`). Deleting the target before the replacement rename lands
 * is how a crash, or a second rename failure, erases that evidence.
 * EPERM/EEXIST on Windows is the AV/indexer window: retry the rename.
 * Persistent failure leaves the previous bytes intact.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

export interface AtomicWriteIoV1 {
  mkdirSync(path: string, opts: { recursive: true }): void;
  openSync(path: string, flags: string): number;
  writeSync(fd: number, contents: string): void;
  fsyncSync(fd: number): void;
  closeSync(fd: number): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
}

const NODE_ATOMIC_WRITE_IO: AtomicWriteIoV1 = {
  mkdirSync,
  openSync,
  writeSync(fd, contents) {
    writeSync(fd, contents);
  },
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
};

const RENAME_ATTEMPTS = 8;

export function writeAtomic(
  target: string,
  contents: string,
  io: AtomicWriteIoV1 = NODE_ATOMIC_WRITE_IO,
): void {
  io.mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  // KNOWN LIMIT. `w` is create-or-truncate, not O_EXCL. Two Director processes
  // on one runRoot can both read "none" and both mint a permit. Single-process
  // correct only. Closing this needs a lock or exclusive-create at the permit
  // mint, which this mission does not enlarge.
  const fd = io.openSync(tmp, "w");
  try {
    io.writeSync(fd, contents);
    io.fsyncSync(fd);
  } finally {
    io.closeSync(fd);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt += 1) {
    try {
      io.renameSync(tmp, target);
      return;
    } catch (error) {
      lastError = error;
      const code = error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      if (code === "EEXIST" || code === "EPERM") {
        continue;
      }
      break;
    }
  }

  try {
    io.unlinkSync(tmp);
  } catch {
    // Leave the temp file. Deleting evidence of a failed persist is worse.
  }
  throw lastError;
}
