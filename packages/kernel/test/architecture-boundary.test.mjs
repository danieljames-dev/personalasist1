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

test("Kernel source has no external or cross-subsystem imports", async () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const files = await sourceFiles(root);
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const imports = source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g);
    for (const match of imports) {
      const specifier = match[1];
      if (specifier && !specifier.startsWith(".")) {
        violations.push(`${relative(root, file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("Production packages do not import benchmark tooling", async () => {
  // tools/benchmarks/** is NON-PRODUCTION measurement code. Importing it from a shipped
  // package would put unreviewed, non-conformant probe code on a production path.
  // See docs/benchmarks/resource-limits-methodology.md.
  const packagesRoot = fileURLToPath(new URL("../../", import.meta.url));
  const files = await sourceFiles(packagesRoot);
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const imports = source.matchAll(/(?:from\s+|import\s*|require\()\s*["']([^"']+)["']/g);
    for (const match of imports) {
      const specifier = match[1] ?? "";
      if (/(^|\/)tools\//.test(specifier) || specifier.includes("benchmarks")) {
        violations.push(`${relative(packagesRoot, file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});
