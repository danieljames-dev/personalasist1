import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const source = await readFile(path.resolve(import.meta.dirname, "..", "..", "apps", "career-cli.mjs"), "utf8");
test("Career CLI has no network, process-spawn, scanning, model, or external-action implementation", () => {
  assert.doesNotMatch(source, /node:(?:http|https|net|tls|dns)|fetch\s*\(|XMLHttpRequest|WebSocket|child_process|spawn\s*\(|exec\s*\(/);
  assert.doesNotMatch(source, /openai|anthropic|embedding|vector(?:database|store)|telemetry|browseJobs|submitApplication|sendEmail|signForm|attestAnswer/i);
  assert.doesNotMatch(source, /readdir\s*\([^)]*(?:Desktop|Documents|Downloads|Users)/i);
});
test("Career CLI imports only approved local package layers", () => {
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(imports.every((value) => value.startsWith("node:") || value.startsWith("../packages/")));
});
