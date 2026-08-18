#!/usr/bin/env node
/**
 * Tell AION about your current job, and read back everything it knows about you.
 *
 * This is the file-free half of enrollment. Personal Context could always model current employment
 * and could never accept it without a hand-authored JSON declaration, which is why the store stayed
 * empty: nobody writes a schema document to describe their own job. Here it is flags.
 *
 * Usage:
 *   node scripts/owner-context.mjs status
 *
 *   node scripts/owner-context.mjs set-current-job \
 *     [--employer "..."] [--title "..."] [--industry "..."] \
 *     [--responsibilities "a;b;c"] [--tools "a;b"] [--skills "a;b"] [--projects "a;b"] \
 *     [--startDate 2024-02-01] [--standing CURRENT|HISTORICAL|UNKNOWN] \
 *     [--lastConfirmedAt 2026-08-18] [--mode REPLACE|MERGE] [--dry-run]
 *
 *   node scripts/owner-context.mjs report [--redact] [--stdout]
 *
 * Every flag is optional. A value you do not give is not stored, not guessed, and not filled with a
 * placeholder — `set-current-job` prints exactly what it did not receive, so the gap stays visible.
 *
 * `--mode REPLACE` (the default) treats the submission as a full restatement: anything you stated
 * before and did not repeat is retired, keeping its provenance. `--mode MERGE` adds without retiring.
 *
 * Nothing here reads a file of yours, and nothing leaves the machine. The report is written under
 * `.aion-local`, which is untracked.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = join(here, "..");

const {
  buildOwnerContextReport,
  buildOwnerCurrentJobFacts,
  createFilePersonalContextStore,
  createMemoryPersonalContextStore,
  PERSONAL_CONTEXT_STORE_RELATIVE_PATH,
  recordOwnerCurrentJob,
  registerContextSource,
  renderOwnerContextReport,
  readOwnerAuthorityRecord,
} = await import(pathToFileURL(join(repositoryRoot, "packages", "personal-context", "dist", "index.js")).href);

const OWNER_JOB_SOURCE_ID = "owner-current-job";

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
  const parts = value.split(";").map((part) => part.trim()).filter((part) => part !== "");
  return parts.length === 0 ? undefined : parts;
}

function nowUtc() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Accept a plain date as well as a full instant, because nobody types `T00:00:00Z`. */
function asInstant(value) {
  if (value === undefined) return undefined;
  const trimmed = String(value).trim();
  if (trimmed === "") return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00Z`;
  return trimmed;
}

function storeRoot() {
  return join(repositoryRoot, ...PERSONAL_CONTEXT_STORE_RELATIVE_PATH.split("/"));
}

/**
 * The Owner authority the current directive names.
 *
 * Read from `CURRENT.md` rather than picked from the authority directory, so this CLI can only ever
 * act under the milestone the Owner actually authorized — not under whichever record happens to be
 * the most permissive one on disk.
 */
function activeAuthority() {
  let directive;
  try {
    directive = readFileSync(join(repositoryRoot, ".aion-local", "directives", "CURRENT.md"), "utf8");
  } catch {
    return null;
  }
  const match = /^Owner-Authorization-Id:\s*(.+?)\s*$/m.exec(directive);
  if (match === null) return null;
  return readOwnerAuthorityRecord(repositoryRoot, match[1]);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const options = parseArguments(rest);
const store = createFilePersonalContextStore(storeRoot());

if (command === "status") {
  const authority = activeAuthority();
  const sources = store.listSources();
  const facts = store.listFacts().filter((fact) => fact.supersededBy === null);
  console.log(`Authority   : ${authority === null ? "NONE (personal sources cannot be enrolled)" : `${authority.ownerAuthorizationId} [${authority.state}] sensitive=${authority.sensitiveDataPermission}`}`);
  console.log(`Store       : ${storeRoot()}`);
  console.log(`Sources     : ${sources.length} (${sources.filter((row) => row.activeState === "ACTIVE").length} active)`);
  console.log(`Live facts  : ${facts.length}`);
  console.log(`Owner-stated: ${facts.filter((fact) => fact.origin === "OWNER_ENTERED").length}`);
  console.log(`Extracted   : ${facts.filter((fact) => fact.origin === "EXTRACTED").length}`);
  if (facts.length === 0) {
    console.log("\nAION knows nothing about you yet. Start with:  node scripts/owner-context.mjs set-current-job --title \"...\"");
  }
  process.exit(0);
}

if (command === "set-current-job") {
  const authority = activeAuthority();
  const input = {
    employer: options.employer,
    title: options.title,
    industry: options.industry,
    responsibilities: splitList(options.responsibilities),
    tools: splitList(options.tools),
    skills: splitList(options.skills),
    projects: splitList(options.projects),
    startDate: asInstant(options.startDate) ?? null,
    standing: options.standing,
    lastConfirmedAt: asInstant(options.lastConfirmedAt) ?? null,
    mode: options.mode === "MERGE" ? "MERGE" : "REPLACE",
  };

  const dryRun = options["dry-run"] !== undefined;

  // The Owner-entry source is created on first use. It has no files and never reads any; the row
  // exists so this entry has the same registry-backed provenance as everything else.
  //
  // A dry run creates it in a MEMORY store instead. The first version registered it against the file
  // store before checking the flag, so `--dry-run` wrote a registry row and then printed "Nothing was
  // written" — a tool making a false claim about what it had done, which is precisely the failure
  // this system exists to prevent. Routing the preview through a throwaway store makes the promise
  // structural rather than a branch someone has to remember.
  let source = store.loadSource(OWNER_JOB_SOURCE_ID);
  if (source === null) {
    const target = dryRun ? createMemoryPersonalContextStore() : store;
    const registered = registerContextSource(
      {
        sourceId: OWNER_JOB_SOURCE_ID,
        sourceType: "OWNER_ENTERED_CURRENT_JOB",
        location: join(repositoryRoot, ".aion-local", "personal-context", "owner-entry"),
        displayName: "Current job, stated by the Owner",
        purpose: "What the Owner states directly about their current work. No file is read.",
      },
      { store: target, now: nowUtc(), authority },
    );
    if (!registered.registered) {
      fail(
        `Cannot create the Owner-entry source (${registered.reason}): ${registered.detail}\n` +
          "This usually means the current directive does not grant sensitive-data permission.",
      );
    }
    source = registered.source;
    if (!dryRun) {
      console.log(`Created source ${OWNER_JOB_SOURCE_ID} (${source.sensitivityClass}, providers: ${source.eligibleProviders.join(", ")}).`);
    }
  }

  if (dryRun) {
    const preview = buildOwnerCurrentJobFacts(input, source, nowUtc());
    console.log(`Would store ${preview.facts.length} fact(s):`);
    for (const fact of preview.facts) console.log(`  ${fact.category}/${fact.predicate} = ${fact.value}`);
    console.log(`\nNot supplied (left missing, not guessed): ${preview.notSupplied.join(", ") || "nothing"}`);
    console.log("\nNothing was written. Re-run without --dry-run to store it.");
    process.exit(0);
  }

  const result = recordOwnerCurrentJob(OWNER_JOB_SOURCE_ID, input, { store, now: nowUtc() });
  if ("error" in result) fail(`Entry refused: ${result.error}`);

  console.log(`Stored ${result.facts.length} Owner-stated fact(s).`);
  console.log(`  created ${result.created.length} · updated ${result.updated.length} · unchanged ${result.unchanged.length} · retired ${result.retired.length}`);
  console.log(`Not supplied (left missing, not guessed): ${result.notSupplied.join(", ") || "nothing"}`);
  console.log("\nRead it back with:  node scripts/owner-context.mjs report");
  process.exit(0);
}

if (command === "report") {
  const report = buildOwnerContextReport({ store }, { subject: options.subject ?? "owner", now: nowUtc() });
  const rendered = renderOwnerContextReport(report, { redactValues: options.redact !== undefined });

  if (options.stdout !== undefined) {
    console.log(rendered);
    process.exit(0);
  }

  const directory = join(storeRoot(), "reports");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `owner-context-review-${nowUtc().replace(/[:-]/g, "")}.md`);
  writeFileSync(path, rendered, "utf8");

  console.log(`Owner context review written to:\n  ${path}`);
  console.log(`\nCompleteness: ${report.ownerContextComplete}`);
  console.log(`Facts: ${report.totalFacts} · sources: ${report.sourcesEnrolled} · conflicts: ${report.conflicts.length} · stale/unknown: ${report.staleOrUnknown.length}`);
  console.log(`Missing categories: ${report.missingCategories.join(", ") || "none"}`);
  console.log("\nThis file is local and untracked. It is not committed and not uploaded.");
  process.exit(0);
}

fail("Usage: owner-context.mjs <status|set-current-job|report> [options]");
