import { acquireHostLock, readLock } from "../lib/host-lock.mjs";
import { queryProcess } from "../lib/process-identity.mjs";

const root = process.argv[2];
const key = process.argv[3];
const mode = process.argv[4] || "acquire";
const nonce = process.argv[5] || `nonce-${process.pid}`;

const obs = queryProcess(process.pid);
const owner = {
  pid: process.pid,
  creationDate: obs.ok ? obs.creationDate : null,
  executablePath: process.execPath,
  runNonce: nonce,
};

if (mode === "acquire-hold") {
  const r = acquireHostLock({ root, resourceKey: key, owner });
  process.stdout.write(`${JSON.stringify({ ...r, pid: process.pid })}\n`);
  if (!r.ok) process.exit(2);
  setTimeout(() => {}, 25_000);
} else if (mode === "acquire-crash") {
  const r = acquireHostLock({ root, resourceKey: key, owner });
  process.stdout.write(`${JSON.stringify({ ...r, pid: process.pid })}\n`);
  process.exit(99);
} else if (mode === "acquire-exit") {
  const r = acquireHostLock({ root, resourceKey: key, owner });
  process.stdout.write(`${JSON.stringify({ ...r, pid: process.pid })}\n`);
  process.exit(r.ok ? 0 : 2);
} else {
  process.stdout.write(`${JSON.stringify({ lock: readLock(process.argv[2]) })}\n`);
}
