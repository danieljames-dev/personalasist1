#!/usr/bin/env node
import { resolve } from "node:path";
import { createAionServer } from "./aion/server.mjs";

const args = process.argv.slice(2); const portIndex = args.indexOf("--port"); const rootIndex = args.indexOf("--data-root");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 31415; const dataRoot = rootIndex >= 0 ? resolve(args[rootIndex + 1]) : undefined;
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("--port must be an integer from 0 through 65535.");
const app = await createAionServer({ dataRoot }); const address = await app.listen(port);
console.log(`AION Command Center is local-only: http://127.0.0.1:${address.port}`);
console.log("Press Ctrl+C to stop AION cleanly.");
let stopping = false; const stop = async () => { if (stopping) return; stopping = true; await app.close(); process.exitCode = 0; };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
