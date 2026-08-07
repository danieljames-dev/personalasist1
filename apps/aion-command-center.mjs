#!/usr/bin/env node
import { resolve } from "node:path";
import { createAionServer } from "./aion/server.mjs";

const args = process.argv.slice(2); const portIndex = args.indexOf("--port"); const rootIndex = args.indexOf("--data-root");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 31415; const dataRoot = rootIndex >= 0 ? resolve(args[rootIndex + 1]) : undefined;
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("--port must be an integer from 0 through 65535.");

const app = await createAionServer({ dataRoot });
await app.listen(port);

/*
 * Report the listeners AION actually has, not the configuration it was asked for.
 *
 * Printing "local-only" unconditionally is what let a saved private address look like working
 * phone access while nothing was bound to it. Every line below is read back from the real
 * listener state, so a failed private bind is visible the moment AION starts.
 */
const listening = app.listeners.filter((entry) => entry.state === "listening");
const isPrivate = (entry) => entry.scope === "private";
console.log(listening.some(isPrivate)
  ? "AION Command Center is running on this computer and on your private network:"
  : "AION Command Center is local-only:");
for (const entry of listening) {
  const host = entry.address.includes(":") ? `[${entry.address}]` : entry.address;
  console.log(`  http://${host}:${entry.port}${isPrivate(entry) ? "   (paired devices only)" : ""}`);
}
for (const entry of app.listeners.filter((e) => e.state !== "listening")) {
  console.log(`\n  Private phone access is NOT active: ${entry.detail}`);
  console.log("  Check the address in Settings, then restart AION. AION will not widen the bind on your behalf.");
}
console.log("\nPress Ctrl+C to stop AION cleanly.");

let stopping = false; const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exitCode = 0; };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
