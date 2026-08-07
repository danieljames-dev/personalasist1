import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");

async function files(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else output.push(path);
  }
  return output;
}

test("Job Posting production dependencies remain inside the accepted Phase 8 boundary", async () => {
  const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), [
    "@aion/career-evidence", "@aion/career-input", "@aion/identity", "@aion/object", "@aion/privacy-boundary",
  ]);
  const source = (await Promise.all((await files(join(packageRoot, "src"))).map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(source, /node:(?:http|https|net|tls|dns)|fetch\s*\(|XMLHttpRequest|WebSocket|puppeteer|playwright/i);
  assert.doesNotMatch(source, /openai|anthropic|embedding|vector.?store|telemetry|analytics|database|postgres|sqlite/i);
});

test("public API exposes import only and contains no matching, scoring, ranking, or drafting behavior", async () => {
  const api = await readFile(join(packageRoot, "src", "index.ts"), "utf8");
  assert.match(api, /dryRunJobPostingImportV1/);
  assert.match(api, /importJobPostingV1/);
  assert.doesNotMatch(api, /match(?:ing)?|score|rank|draft|application/i);
});

test("production source performs no scanning, copy, Identity write, Relationship write, or automatic import", async () => {
  const sourceFiles = await files(join(packageRoot, "src"));
  const source = (await Promise.all(sourceFiles.map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(source, /readdir|glob|walkDirectory|copyFile|writeFile|mkdir|IdentityStateRepository|createRelationshipObject/i);
  assert.doesNotMatch(source, /Desktop|Documents|Downloads|assistant.?archive|Gmail|LinkedIn|job.?board/i);
  assert.equal((await stat(join(repositoryRoot, "private"))).isDirectory(), true);
});

test("module import has no private-state or Object persistence side effect", async () => {
  const knownRoots = [
    join(repositoryRoot, "private", "career"),
    join(repositoryRoot, "private", "identity"),
    join(repositoryRoot, "private", "object-store"),
  ];
  const signature = async (path) => {
    try {
      const state = await stat(path);
      return { exists: true, size: state.size, modified: state.mtimeMs };
    } catch (error) {
      if (error.code === "ENOENT") return { exists: false };
      throw error;
    }
  };
  const before = await Promise.all(knownRoots.map(signature));
  await import(`../dist/index.js?architecture=${Date.now()}`);
  const after = await Promise.all(knownRoots.map(signature));
  assert.deepEqual(after, before);
});
