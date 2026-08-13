/**
 * Bring the Owner's archive facts into current knowledge.
 *
 * The archive file is authorized but private, so this reads it and never echoes its contents:
 * progress is reported as counts and titles the Owner already wrote, not as a dump of the material.
 *
 * Ingestion is idempotent — identity is derived from normalised content — so running this twice is a
 * no-op rather than a doubled archive. That is what makes it safe to run at deploy time without
 * anyone having to remember whether it was run before.
 *
 * Usage:
 *   node scripts/aion-ingest-owner-archive.mjs --source <file> [--data-root <dir>] [--dry-run]
 *
 * Refuses to write to a data root whose state file is currently being written by a running server
 * unless --force is given, because the state file is a single JSON document and a concurrent write
 * is how 17 MB of the Owner's history gets truncated.
 */
import { readFile, stat, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  AionAssistantV1, FileStateRepositoryV1, SystemClockV1, RandomIdGeneratorV1,
  DeterministicModelProviderV1, StaticCapabilityRegistryV1, LocalEchoCapabilityV1,
  LocalArchiveImportSourceV1, NodePrivateBackupV1, SelectableDeveloperAgentRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "@aion/local-assistant";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const source = arg("source");
const dataRoot = resolve(arg("data-root", join(process.cwd(), "private", "aion")));
const dryRun = has("dry-run");

if (!source) {
  console.log("SOURCE_REQUIRED = pass --source <archive.json>");
  process.exit(1);
}

let entries;
try {
  const parsed = JSON.parse(await readFile(resolve(source), "utf8"));
  entries = Array.isArray(parsed) ? parsed : (parsed.facts ?? parsed.entries ?? []);
} catch (error) {
  console.log(`SOURCE_UNREADABLE = ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(entries) || entries.length === 0) {
  console.log("SOURCE_EMPTY = no entries found");
  process.exit(1);
}

// A state file written seconds ago means a live server owns it. Two writers, one JSON document.
if (!dryRun && !has("force")) {
  try {
    const info = await stat(join(dataRoot, "state-v1.json"));
    const ageSeconds = (Date.now() - info.mtimeMs) / 1000;
    if (ageSeconds < 300) {
      console.log(`STATE_IN_USE = written ${Math.round(ageSeconds)}s ago`);
      console.log("REFUSING = a running server owns this state file; stop it or pass --force");
      process.exit(2);
    }
  } catch {
    // No state file yet is fine; the repository will create one.
  }
}

await mkdir(dataRoot, { recursive: true });
const exportRoot = join(dataRoot, "exports");
await mkdir(exportRoot, { recursive: true });

const service = new AionAssistantV1({
  repository: new FileStateRepositoryV1(dataRoot),
  clock: new SystemClockV1(),
  ids: new RandomIdGeneratorV1(),
  providers: [new DeterministicModelProviderV1()],
  capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
  importer: new LocalArchiveImportSourceV1(),
  backup: new NodePrivateBackupV1(exportRoot),
  developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
});

const result = await service.ingestOwnerSeedFacts(entries, { dryRun });

console.log(`ARCHIVE_ENTRIES = ${result.totalSeen}`);
console.log(`INGESTED = ${result.added}`);
console.log(`ALREADY_PRESENT = ${result.skippedExisting}`);
console.log(`REJECTED = ${result.rejected}`);
console.log(`DRY_RUN = ${result.dryRun ? "YES" : "NO"}`);

const after = await service.snapshot();
const archiveFacts = (after.ownerKnowledge?.facts ?? []).filter((fact) =>
  String(fact.provenance?.sourceRef ?? "").includes("owner-archive:"),
).length;
console.log(`ARCHIVE_FACTS_ON_FILE = ${archiveFacts}`);
console.log(`OWNER_KNOWLEDGE_TOTAL = ${after.ownerKnowledge?.facts.length ?? 0}`);
