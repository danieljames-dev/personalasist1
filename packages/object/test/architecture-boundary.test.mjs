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

test("Object production dependencies remain inside the approved boundary", async () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const files = await sourceFiles(root);
  const allowed = new Set(["@aion/identity", "node:crypto"]);
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
      const specifier = match[1] ?? "";
      if (!specifier.startsWith(".") && !allowed.has(specifier)) {
        violations.push(`${relative(root, file)} -> ${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("Object production source contains no forbidden subsystem or runtime adapter", async () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const files = await sourceFiles(root);
  const forbidden = /(?:\bcareer\b|\bresume\b|job.?posting|authentication|authorization|oauth|telemetry|analytics|event.?bus|\bplanner\b|\bmemory\b|capability.?registry|vector.?store|\bdatabase\b|private\/identity|benchmarks?|\bbackup\b|control-plane|fetch\(|https?:\/\/)/i;
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (forbidden.test(source)) violations.push(relative(root, file));
  }
  assert.deepEqual(violations, []);
});

test("no fixture corpus or real Object state is present in the package", async () => {
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  const entries = await readdir(packageRoot, { withFileTypes: true });
  assert.equal(entries.some((entry) => /fixtures?|private|state/i.test(entry.name)), false);
});

test("module import has no Object-state side effect", async () => {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const privateObjectRoot = join(repositoryRoot, "private", "object");
  const listPrivate = async () => {
    try { return await readdir(join(repositoryRoot, "private"), { withFileTypes: true }); }
    catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  };
  const before = await listPrivate();
  await import("../dist/index.js");
  const after = await listPrivate();
  assert.deepEqual(after.map((entry) => entry.name).sort(), before.map((entry) => entry.name).sort());
  assert.equal(after.some((entry) => entry.isDirectory() && join(repositoryRoot, "private", entry.name) === privateObjectRoot), false);
});
