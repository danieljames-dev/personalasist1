import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");

async function sourceText() {
  const names = (await readdir(join(packageRoot, "src"))).filter((name) => name.endsWith(".ts"));
  return (await Promise.all(names.map((name) => readFile(join(packageRoot, "src", name), "utf8")))).join("\n");
}

async function fileCount(path) {
  try {
    const state = await stat(path);
    if (!state.isDirectory()) return 1;
    const entries = await readdir(path, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => fileCount(join(path, entry.name))))).reduce((sum, count) => sum + count, 0);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

test("career-evidence has no matching, drafting, orchestration, model, network, database, or telemetry dependency", async () => {
  const source = await sourceText();
  for (const forbidden of [
    /from\s+["'][^"']*(?:job-match|application-draft|memory|planner)/i,
    /(?:openai|anthropic|gemini|grok|axios|fetch\s*\(|https?:\/\/)/i,
    /(?:telemetry|analytics|postgres|sqlite|vector.?store)/i,
  ]) assert.equal(forbidden.test(source), false);
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
    "@aion/career-input", "@aion/identity", "@aion/object", "@aion/privacy-boundary",
  ]);
});

test("module import has no private-state, Object, Identity, or input side effect", async () => {
  const paths = [
    join(repositoryRoot, "private", "object-store"),
    join(repositoryRoot, "private", "career"),
    join(repositoryRoot, "private", "identity"),
  ];
  const before = await Promise.all(paths.map(fileCount));
  await import("../dist/index.js");
  const after = await Promise.all(paths.map(fileCount));
  assert.deepEqual(after, before);
});

test("public API provides bounded explicit operations and no generic mutation or future-phase behavior", async () => {
  const api = await import("../dist/index.js");
  for (const operation of [
    "dryRunCareerEvidenceImportV1", "importCareerEvidenceV1", "buildCareerProfileV1",
    "markCareerFactsConflictingV1", "supersedeCareerFactV1",
  ]) assert.equal(typeof api[operation], "function");
  for (const forbidden of [
    "mutateCareerFact", "patchCareerFact", "deleteCareerFact", "queryCareerFacts", "searchJobs",
    "matchJob", "draftApplication", "authenticate", "authorize", "collectOwnerData", "preparePhase8",
  ]) assert.equal(Object.hasOwn(api, forbidden), false);
});

test("repository private and local control-plane roots remain ignored", async () => {
  const gitignore = await readFile(join(repositoryRoot, ".gitignore"), "utf8");
  assert.match(gitignore, /(?:^|\n)private\//);
  assert.match(gitignore, /(?:^|\n)\.aion-local\//);
  assert.equal(relative(repositoryRoot, packageRoot).replaceAll("\\", "/"), "packages/career-evidence");
});
