#!/usr/bin/env node
/**
 * Enroll one Owner-approved source into Personal Context, or change an enrolled source's state.
 *
 * This exists so that adding a source is a decision the Owner makes once, in the open, without
 * anybody editing code. A new approved folder is a registry row; nothing in `@aion/personal-context`
 * changes when one is added. That is what keeps "AION may read this" reviewable — the answer is a
 * list of rows with a purpose, a scope, a class and a provider set, not a diff.
 *
 * Routine re-synchronization of a source that is already enrolled needs no further approval. Adding
 * a source, widening its root, or raising its sensitivity class does, and this script refuses the
 * last of those outright: the authorizing directive carries `Sensitive-Data-Permission: NO`, so a
 * `CONFIDENTIAL` or `RESTRICTED` source is not enrollable under it.
 *
 * Usage:
 *   node scripts/register-context-source.mjs list
 *   node scripts/register-context-source.mjs register --sourceId <id> --sourceType <type> \
 *        --location <absolute path> --displayName "<name>" --purpose "<why>" \
 *        [--allowedScope a;b] [--deniedScope c;d] [--sensitivityClass PUBLIC|INTERNAL] \
 *        [--eligibleProviders codex;grok;claude;local] [--syncMode MANUAL|ON_DEMAND|CONTINUOUS] \
 *        [--recursive true|false] [--maxDepth n] [--maxFiles n] [--maxBytes n] [--priority n]
 *   node scripts/register-context-source.mjs state --sourceId <id> --state ACTIVE|DISABLED|REVOKED
 *   node scripts/register-context-source.mjs sync [--sourceId <id>]
 *
 * Nothing here reads a source. `register` writes a registry row; `sync` runs the bounded engine.
 */

import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = join(here, "..");

const {
  createFilePersonalContextStore,
  createNodePersonalContextFs,
  PERSONAL_CONTEXT_STORE_RELATIVE_PATH,
  registerContextSource,
  setSourceState,
  SOURCE_STATES_V1,
  syncAllSources,
  syncSource,
} = await import(pathToFileURL(join(repositoryRoot, "packages", "personal-context", "dist", "index.js")).href);

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[name] = "true";
      continue;
    }
    options[name] = next;
    index += 1;
  }
  return options;
}

function splitList(value) {
  if (value === undefined) return undefined;
  return value.split(";").map((part) => part.trim()).filter((part) => part !== "");
}

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function storeRoot() {
  return join(repositoryRoot, ...PERSONAL_CONTEXT_STORE_RELATIVE_PATH.split("/"));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const options = parseArguments(rest);
const store = createFilePersonalContextStore(storeRoot());

if (command === "list") {
  const sources = store.listSources();
  if (sources.length === 0) {
    console.log("No sources are enrolled. AION knows nothing about the Owner from this system yet.");
  }
  for (const source of sources) {
    console.log(
      [
        `${source.sourceId}  [${source.activeState}]  ${source.sourceType}`,
        `  location   : ${source.location}`,
        `  purpose    : ${source.purpose}`,
        `  scope      : allowed=${source.allowedScope.join(";") || "<root>"} denied=${source.deniedScope.join(";") || "<none>"}`,
        `  class      : ${source.sensitivityClass}  providers=${source.eligibleProviders.join(";")}`,
        `  syncMode   : ${source.syncMode}  recursive=${source.recursiveAllowed} maxDepth=${source.maxDepth} maxFiles=${source.maxFiles}`,
        `  lastSync   : attempted=${source.lastAttemptedSync ?? "never"} successful=${source.lastSuccessfulSync ?? "never"} version=${source.version}`,
      ].join("\n"),
    );
  }
  process.exit(0);
}

if (command === "register") {
  for (const required of ["sourceId", "sourceType", "location", "displayName", "purpose"]) {
    if (options[required] === undefined) fail(`Missing required option: --${required}`);
  }
  const result = registerContextSource(
    {
      sourceId: options.sourceId,
      sourceType: options.sourceType,
      location: options.location,
      displayName: options.displayName,
      purpose: options.purpose,
      allowedScope: splitList(options.allowedScope),
      deniedScope: splitList(options.deniedScope),
      sensitivityClass: options.sensitivityClass,
      eligibleProviders: splitList(options.eligibleProviders),
      syncMode: options.syncMode,
      recursiveAllowed: options.recursive === undefined ? undefined : options.recursive !== "false",
      maxDepth: options.maxDepth === undefined ? undefined : Number(options.maxDepth),
      maxFiles: options.maxFiles === undefined ? undefined : Number(options.maxFiles),
      maxBytes: options.maxBytes === undefined ? undefined : Number(options.maxBytes),
      priority: options.priority === undefined ? undefined : Number(options.priority),
      expiresAt: options.expiresAt,
    },
    { store, now: nowUtc() },
  );
  if (!result.registered) fail(`Enrollment refused (${result.reason}): ${result.detail}`);
  console.log(`Registered ${result.source.sourceId} as ${result.source.sourceType} (${result.source.sensitivityClass}).`);
  console.log("No file has been read. Run `sync` when the Owner wants this source synchronized.");
  process.exit(0);
}

if (command === "state") {
  if (options.sourceId === undefined || options.state === undefined) fail("Usage: state --sourceId <id> --state <state>");
  if (!SOURCE_STATES_V1.includes(options.state)) fail(`Unsupported state: ${options.state}`);
  const result = setSourceState(options.sourceId, options.state, { store, now: nowUtc() });
  if (!result.changed) fail(result.detail);
  console.log(`${result.source.sourceId} is now ${result.source.activeState}.`);
  process.exit(0);
}

if (command === "sync") {
  const deps = { store, fs: createNodePersonalContextFs(), now: nowUtc() };
  const receipts = options.sourceId === undefined ? syncAllSources(deps) : [syncSource(options.sourceId, deps)];
  for (const receipt of receipts) {
    console.log(
      `${receipt.sourceId}: ${receipt.outcome}` +
        (receipt.denialReason === null ? "" : ` (${receipt.denialReason})`) +
        ` files=${receipt.filesRead}/${receipt.filesConsidered}` +
        ` facts=+${receipt.factsCreated}/~${receipt.factsUpdated}/=${receipt.factsUnchanged}` +
        ` conflicts=${receipt.conflictsDetected}` +
        ` denials=${receipt.denials.length}` +
        ` escapes=${receipt.boundaryEscapeAttempts}`,
    );
  }
  process.exit(0);
}

fail("Usage: register-context-source.mjs <list|register|state|sync> [options]");
