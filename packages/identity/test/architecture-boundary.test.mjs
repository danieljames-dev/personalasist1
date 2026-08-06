import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }))).flat();
}

test("Identity production imports no network, telemetry, authentication, Object, career, Kernel, backup, or test tooling", async () => {
  const root = join(repositoryRoot, "packages", "identity", "src");
  const sourceFiles = (await files(root)).filter((path) => extname(path) === ".ts");
  const prohibitedImport = /^(?:node:)?(?:http|https|http2|net|tls|dns|dgram|child_process)$|fetch|socket|telemetry|analytics|openai|browser|auth|policy|object|career|kernel|backup|benchmark|test/i;
  const violations = [];
  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*|require\()\s*["']([^"']+)["']/g)) {
      if (prohibitedImport.test(match[1] ?? "")) violations.push(`${relative(root, file)} -> ${match[1]}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("Identity production contains no profile fields, credentials, network URLs, environment access, or downstream invocation", async () => {
  const root = join(repositoryRoot, "packages", "identity", "src");
  const sourceFiles = (await files(root)).filter((path) => extname(path) === ".ts");
  const violations = [];
  const prohibited = /\b(?:email|username|displayName|phone|address|employer|biography|resume|credential|password|accessToken|oauth|process\.env|https?:\/\/|EventPublisher|ObjectIdV1)\b/i;
  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    if (prohibited.test(source)) violations.push(relative(root, file));
  }
  assert.deepEqual(violations, []);
});

test("the CLI composes the existing privacy boundary and exposes no network behavior", async () => {
  const source = await readFile(join(repositoryRoot, "apps", "identity-cli.mjs"), "utf8");
  assert.match(source, /privacy-boundary\/dist\/index\.js/);
  assert.match(source, /authorizeLocalPath/);
  assert.doesNotMatch(source, /\bfetch\s*\(|https?:\/\//i);
});

test("Kernel source has no Identity persistence responsibility", async () => {
  const root = join(repositoryRoot, "packages", "kernel", "src");
  const sourceFiles = (await files(root)).filter((path) => extname(path) === ".ts");
  const violations = [];
  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    if (/identity|identity-state-v1|FileIdentityStateRepository/i.test(source)) violations.push(relative(root, file));
  }
  assert.deepEqual(violations, []);
});

test("private Identity state is Git-ignored and forbidden from source backup", async () => {
  const ignored = spawnSync("git", ["-C", repositoryRoot, "check-ignore", "-q", "private/identity/identity-state-v1.json"]);
  assert.equal(ignored.status, 0);
  const backup = await readFile(join(repositoryRoot, "scripts", "backup-aion.ps1"), "utf8");
  assert.match(backup, /'private\/'/);
  assert.match(backup, /'\.aion-local\/'/);
});
