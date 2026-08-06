import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const app = join(repositoryRoot, "apps", "identity-cli.mjs");
let fixture;
let identityRoot;

before(() => {
  fixture = mkdtempSync(join(tmpdir(), "aion-identity-cli-"));
  identityRoot = join(fixture, "identity");
  mkdirSync(identityRoot);
});
after(() => rmSync(fixture, { recursive: true, force: true }));

function run(args) {
  return spawnSync(process.execPath, [app, ...args], { cwd: repositoryRoot, encoding: "utf8" });
}

test("CLI help exposes only initialize, status, and export", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /initialize/);
  assert.match(result.stdout, /status/);
  assert.match(result.stdout, /export/);
  assert.doesNotMatch(result.stdout, /\bimport\b/);
});

test("status before initialization is explicit and contains no identifiers", () => {
  const result = run(["status", "--root", identityRoot]);
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.initialized, false);
  assert.equal(status.recordCount, 0);
  assert.deepEqual(status.fingerprints, []);
});

test("first and second CLI initialization prove idempotence without complete-ID output", () => {
  const first = run(["initialize", "--root", identityRoot]);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Identity initialized/);
  const statePath = join(identityRoot, "identity-state-v1.json");
  const firstBytes = readFileSync(statePath);
  const firstDigest = createHash("sha256").update(firstBytes).digest("hex");
  const state = JSON.parse(firstBytes.toString("utf8"));
  for (const record of state.records) assert.equal(first.stdout.includes(record.id), false);

  const second = run(["initialize", "--root", identityRoot]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already initialized/);
  const secondBytes = readFileSync(statePath);
  assert.equal(createHash("sha256").update(secondBytes).digest("hex"), firstDigest);
  assert.deepEqual(secondBytes, firstBytes);
  for (const record of state.records) assert.equal(second.stdout.includes(record.id), false);
});

test("status after initialization reports only safe fingerprints", () => {
  const state = JSON.parse(readFileSync(join(identityRoot, "identity-state-v1.json"), "utf8"));
  const result = run(["status", "--root", identityRoot]);
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.initialized, true);
  assert.equal(status.recordCount, 4);
  assert.equal(status.relationshipCount, 3);
  assert.equal(status.fingerprints.length, 4);
  for (const record of state.records) assert.equal(result.stdout.includes(record.id), false);
});

test("explicit export preserves state exactly and refuses overwrite", () => {
  const exportRoot = join(fixture, "exports");
  mkdirSync(exportRoot);
  const output = join(exportRoot, "identity-export-v1.json");
  const first = run(["export", "--root", identityRoot, "--output-root", exportRoot, "--output", output]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readFileSync(output, "utf8"), readFileSync(join(identityRoot, "identity-state-v1.json"), "utf8"));
  const state = JSON.parse(readFileSync(output, "utf8"));
  for (const record of state.records) assert.equal(first.stdout.includes(record.id), false);
  const second = run(["export", "--root", identityRoot, "--output-root", exportRoot, "--output", output]);
  assert.equal(second.status, 1);
  assert.match(second.stderr, /identity-export-conflict/);
});

test("export rejects traversal, cross-volume, and device namespace paths", () => {
  const exportRoot = join(fixture, "bounded-exports");
  mkdirSync(exportRoot);
  const traversal = run(["export", "--root", identityRoot, "--output-root", exportRoot, "--output", join(exportRoot, "..", "escape.json")]);
  assert.equal(traversal.status, 1);
  assert.match(traversal.stderr, /identity-path-rejected/);

  const device = run(["export", "--root", identityRoot, "--output-root", exportRoot, "--output", "\\\\?\\C:\\synthetic\\identity.json"]);
  assert.equal(device.status, 1);
  assert.match(device.stderr, /identity-path-rejected/);

  if (process.platform === "win32") {
    const drive = parse(exportRoot).root.slice(0, 1).toUpperCase() === "Z" ? "Y" : "Z";
    const crossDrive = run(["export", "--root", identityRoot, "--output-root", exportRoot, "--output", `${drive}:\\synthetic\\identity.json`]);
    assert.equal(crossDrive.status, 1);
    assert.match(crossDrive.stderr, /identity-path-rejected/);
  }
});

test("export rejects an external directory link or junction", (t) => {
  const exportRoot = join(fixture, "linked-exports");
  const outside = join(fixture, "outside");
  mkdirSync(exportRoot);
  mkdirSync(outside);
  const link = join(exportRoot, "escape");
  try { symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { t.skip(`local link capability unavailable: ${error.code ?? "unknown"}`); return; }
  const result = run(["export", "--root", identityRoot, "--output-root", exportRoot, "--output", join(link, "identity.json")]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /identity-path-rejected/);
  assert.equal(existsSync(join(outside, "identity.json")), false);
});

test("module import has no initialization side effect", () => {
  const untouched = join(fixture, "import-side-effect-check");
  mkdirSync(untouched);
  const script = `process.chdir(${JSON.stringify(untouched)}); await import(${JSON.stringify(pathToFileURL(app).href)});`;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(untouched), []);
});

test("malformed arguments fail without revealing supplied paths", () => {
  const result = run(["initialize", "--root", identityRoot, "--unknown", "synthetic-secret-path"]);
  assert.equal(result.status, 2);
  assert.equal(result.stderr.includes("synthetic-secret-path"), false);
});
