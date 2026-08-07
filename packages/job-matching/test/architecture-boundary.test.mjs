import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(packageRoot, "src");
async function source() {
  const files = (await readdir(sourceRoot)).filter((name) => name.endsWith(".ts"));
  return (await Promise.all(files.map((name) => readFile(join(sourceRoot, name), "utf8")))).join("\n");
}

test("job-matching production dependencies remain inside the accepted local reference boundary", async () => {
  const text = await source();
  assert.doesNotMatch(text, /from\s+["'](?:https?:|node:(?:http|https|net|tls|dns)|@(?:openai|anthropic)|.*(?:planner|memory|telemetry|vector|database|browser))/i);
  assert.doesNotMatch(text, /fetch\s*\(|XMLHttpRequest|WebSocket|child_process|spawn\s*\(|exec\s*\(/);
});

test("public API contains matching only and no drafting, application, discovery, or protected-attribute behavior", async () => {
  const entry = await readFile(join(sourceRoot, "index.ts"), "utf8");
  assert.doesNotMatch(entry, /draft|submit|apply|search|discover|embedding|model/i);
  const text = await source();
  assert.doesNotMatch(text, /race|religion|gender|disability|health|ethnicity|marital|ageScore/i);
});

test("module import has no private-state or repository side effect", async () => {
  const repositoryRoot = resolve(packageRoot, "..", "..");
  const privateRoot = join(repositoryRoot, "private");
  let before = null;
  try { before = await stat(privateRoot); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  await import("../dist/index.js");
  let after = null;
  try { after = await stat(privateRoot); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  assert.equal(after?.mtimeMs ?? null, before?.mtimeMs ?? null);
});
