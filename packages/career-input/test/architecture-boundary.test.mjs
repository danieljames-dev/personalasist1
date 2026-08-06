import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packageRoot = join(repositoryRoot, "packages", "career-input");
const sourceRoot = join(packageRoot, "src");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  }))).flat().filter((path) => extname(path) === ".ts");
}

test("career-input production imports only approved contract, privacy, and local read primitives", async () => {
  const allowed = new Set(["@aion/object", "@aion/privacy-boundary", "node:fs/promises", "node:path"]);
  const violations = [];
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
      const specifier = match[1] ?? "";
      if (!specifier.startsWith(".") && !allowed.has(specifier)) violations.push(`${relative(sourceRoot, file)} -> ${specifier}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("career-input does not import Object repositories or Identity persistence", async () => {
  const violations = [];
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, "utf8");
    if (/FileObjectRepository|ObjectRepository|createInitialObject|appendObjectRevision|private\/identity|FileIdentityStateRepository/i.test(source)) {
      violations.push(relative(sourceRoot, file));
    }
  }
  assert.deepEqual(violations, []);
});

test("production source has no ingestion, Phase 7, matching, drafting, scanning, or archive behavior", async () => {
  const violations = [];
  const prohibited = /CareerSourceObject|CareerFactObject|CareerProfileObject|JobPostingObject|evidence.?catalog|\bmatching\b|\bdrafting\b|\breaddir\b|\bglob\b|walkDirectory|assistant.?archive|github.?d|\bcopyFile\b|\bwriteFile\b|\bmkdir\b/i;
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, "utf8");
    if (prohibited.test(source)) violations.push(relative(sourceRoot, file));
  }
  assert.deepEqual(violations, []);
});

test("production source has no network, telemetry, model, database, vector, auth, or operational tooling", async () => {
  const violations = [];
  const prohibited = /\bfetch\s*\(|https?:\/\/|node:(?:http|https|http2|net|tls|dns|dgram|child_process)|telemetry|analytics|openai|model.?provider|database|vector.?store|oauth|authentication|authorization|backup|benchmark|control-plane/i;
  for (const file of await sourceFiles(sourceRoot)) {
    const source = await readFile(file, "utf8");
    if (prohibited.test(source)) violations.push(relative(sourceRoot, file));
  }
  assert.deepEqual(violations, []);
});

test("module import has no filesystem side effect", async () => {
  const before = (await readdir(packageRoot)).sort();
  await import(pathToFileURL(join(packageRoot, "dist", "index.js")).href);
  assert.deepEqual((await readdir(packageRoot)).sort(), before);
});
