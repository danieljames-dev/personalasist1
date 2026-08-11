#!/usr/bin/env node
/**
 * AION production entry — durable lifecycle logging + single-instance guard.
 * Never logs secrets, tokens, or mail bodies.
 */
import { resolve, join } from "node:path";
import { appendFileSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { createAionServer } from "./aion/server.mjs";

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const rootIndex = args.indexOf("--data-root");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 31415;
const dataRoot = rootIndex >= 0 ? resolve(args[rootIndex + 1]) : undefined;
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
  throw new Error("--port must be an integer from 0 through 65535.");
}

const repositoryRoot = resolve(join(import.meta.dirname, ".."));
const logDir = join(repositoryRoot, ".aion-local", "production");
mkdirSync(logDir, { recursive: true });
const processLog = join(logDir, "process.log");
const instanceLockPath = join(logDir, "instance.lock");

function life(msg, extra = {}) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    pid: process.pid,
    ppid: process.ppid,
    msg,
    ...extra,
  });
  try {
    appendFileSync(processLog, line + "\n", "utf8");
  } catch {
    /* best-effort */
  }
  try {
    console.error(`[aion-life] ${msg}`);
  } catch {
    /* */
  }
}

/** Exclusive instance lock — second production process refuses to start. */
function acquireInstanceLock() {
  try {
    if (existsSync(instanceLockPath)) {
      try {
        const raw = readFileSync(instanceLockPath, "utf8").trim();
        const oldPid = Number(raw.split(/\s+/)[0]);
        if (Number.isFinite(oldPid) && oldPid > 0) {
          try {
            process.kill(oldPid, 0);
            // Process still alive — refuse
            life("INSTANCE_LOCK_HELD", { holderPid: oldPid });
            return false;
          } catch {
            // stale lock
            life("INSTANCE_LOCK_STALE", { holderPid: oldPid });
          }
        }
      } catch {
        /* */
      }
    }
    // wx = fail if exists; remove stale first
    try {
      unlinkSync(instanceLockPath);
    } catch {
      /* */
    }
    const fd = openSync(instanceLockPath, "wx");
    writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`, "utf8");
    closeSync(fd);
    return true;
  } catch (e) {
    life("INSTANCE_LOCK_FAIL", { err: String(e?.message || e).slice(0, 200) });
    return false;
  }
}

function releaseInstanceLock() {
  try {
    if (existsSync(instanceLockPath)) {
      const raw = readFileSync(instanceLockPath, "utf8").trim();
      if (raw.startsWith(String(process.pid))) unlinkSync(instanceLockPath);
    }
  } catch {
    /* */
  }
}

process.on("uncaughtException", (err) => {
  life("UNCAUGHT_EXCEPTION", { err: String(err?.stack || err?.message || err).slice(0, 1500) });
  // Stay up if possible — mark exit code for observability on eventual exit
  process.exitCode = 1;
});
process.on("unhandledRejection", (reason) => {
  life("UNHANDLED_REJECTION", { err: String(reason?.stack || reason).slice(0, 1500) });
});
process.on("beforeExit", (code) => {
  life("BEFORE_EXIT", { code });
});
process.on("exit", (code) => {
  try {
    appendFileSync(
      processLog,
      JSON.stringify({ t: new Date().toISOString(), pid: process.pid, msg: "EXIT", code }) + "\n",
      "utf8",
    );
  } catch {
    /* */
  }
  releaseInstanceLock();
});

if (!acquireInstanceLock()) {
  console.error("AION production instance already running — refusing duplicate.");
  process.exit(2);
}

life("STARTING", { port, node: process.version });

let app;
try {
  app = await createAionServer({ dataRoot });
  await app.listen(port);
} catch (err) {
  life("START_FAILED", { err: String(err?.stack || err?.message || err).slice(0, 1500) });
  releaseInstanceLock();
  process.exit(1);
}

const listening = app.listeners.filter((entry) => entry.state === "listening");
const isPrivate = (entry) => entry.scope === "private";
console.log(
  listening.some(isPrivate)
    ? "AION Command Center is running on this computer and on your private network:"
    : "AION Command Center is local-only:",
);
for (const entry of listening) {
  const host = entry.address.includes(":") ? `[${entry.address}]` : entry.address;
  console.log(`  http://${host}:${entry.port}${isPrivate(entry) ? "   (paired devices only)" : ""}`);
}
for (const entry of app.listeners.filter((e) => e.state !== "listening")) {
  console.log(`\n  Private phone access is NOT active: ${entry.detail}`);
  console.log("  Check the address in Settings, then restart AION. AION will not widen the bind on your behalf.");
}
console.log("\nPress Ctrl+C to stop AION cleanly.");

life("LISTENING", {
  port,
  addresses: listening.map((e) => e.address),
});

let stopping = false;
const stop = async (signal) => {
  if (stopping) return;
  stopping = true;
  life("STOP_SIGNAL", { signal });
  try {
    await app.close();
    life("CLOSED_CLEAN");
  } catch (err) {
    life("CLOSE_ERR", { err: String(err?.message || err).slice(0, 500) });
  }
  releaseInstanceLock();
  process.exitCode = 0;
  // Force exit if event loop still held by intervals
  setTimeout(() => process.exit(0), 500).unref();
};
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
process.once("SIGHUP", () => void stop("SIGHUP"));
