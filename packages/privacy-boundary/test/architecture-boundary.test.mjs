import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  }));
  return files.flat().filter((path) => extname(path) === ".ts");
}

test("privacy production code has no network, telemetry, model, browser, or cross-subsystem imports", async () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const files = await sourceFiles(root);
  const violations = [];
  const prohibited = /^(?:node:)?(?:http|https|http2|net|tls|dns|dgram)$|fetch|socket|telemetry|analytics|openai|browser|child_process|identity|object/i;

  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*|require\()\s*["']([^"']+)["']/g)) {
      const specifier = match[1] ?? "";
      if (prohibited.test(specifier)) violations.push(`${relative(root, file)} -> ${specifier}`);
    }
  }

  assert.deepEqual(violations, []);
});

test("privacy tests contain no external network calls", async () => {
  const root = fileURLToPath(new URL("../test/", import.meta.url));
  const files = await sourceFiles(root);
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/\bfetch\s*\(|https?:\/\//i.test(source)) violations.push(relative(root, file));
  }
  assert.deepEqual(violations, []);
});
