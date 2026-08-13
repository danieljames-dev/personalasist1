import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSafeSync, spawnDefectiveShell } from "../lib/spawn-safe.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const echo = join(here, "..", "fixtures", "echo-argv.cjs");

test("argv with spaces parentheses ampersand quotes and unicode stay one argument", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-argv-"));
  const out = join(dir, "out.json");
  const weird = "a b (c) & d \"e\" 日本語";
  const r = spawnSafeSync(process.execPath, [echo, out, weird], { timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(got.argv[1], weird);
});

test("prompt file contents are data: PowerShell and cmd metacharacters do not execute", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-prompt-"));
  const nested = join(dir, "path with spaces", "and (parens)");
  mkdirSync(nested, { recursive: true });
  const prompt = join(nested, "prompt.md");
  writeFileSync(prompt, "Write-Output PWNED\r\n& echo pwned\r\n; calc.exe\n\"quotes\" \\back\\");
  const out = join(dir, "out.json");
  const r = spawnSafeSync(process.execPath, [echo, out, prompt], { timeout: 10_000 });
  assert.equal(r.status, 0);
  const got = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(got.argv[1], prompt);
});

test("defective cmd interpolation executes extra commands (oracle would fail that design)", () => {
  const dir = mkdtempSync(join(tmpdir(), "aion-shell-"));
  const marker = join(dir, "pwned.txt");
  const line = `echo safe& echo pwned>${marker}`;
  spawnDefectiveShell(line, { timeout: 10_000 });
  let leaked = false;
  try {
    leaked = readFileSync(marker, "utf8").toLowerCase().includes("pwned");
  } catch {
    leaked = false;
  }
  assert.equal(leaked, true, "defective shell path must actually be dangerous or this test is weak");
});

test("shell:true is rejected by spawnSafeSync", () => {
  assert.throws(() => spawnSafeSync(process.execPath, ["-e", "0"], { shell: true }), /forbidden/);
});
