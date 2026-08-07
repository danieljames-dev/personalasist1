import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
const root = path.resolve(import.meta.dirname, "..");
async function source() { return (await Promise.all((await readdir(path.join(root, "src"))).filter((name) => name.endsWith(".ts")).map((name) => readFile(path.join(root, "src", name), "utf8")))).join("\n"); }
test("application preparation production dependencies stay inside the approved boundary", async () => {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ["@aion/career-evidence", "@aion/identity", "@aion/job-matching", "@aion/object"]);
  const text = await source(); assert.doesNotMatch(text, /from\s+["'](?:https?:|node:(?:http|https|net|tls|dns)|@(?:openai|anthropic)|.*(?:planner|memory|telemetry|vector|database|browser))/i);
  assert.doesNotMatch(text, /fetch\s*\(|XMLHttpRequest|WebSocket|child_process|spawn\s*\(|exec\s*\(/);
});
test("package contains no submission, attestation, or external-action implementation", async () => {
  const text = await source(); assert.doesNotMatch(text, /submitApplication|sendEmail|signForm|attestAnswer|browseJobs|fetchPosting/);
  const before = await readdir(root); await import("../dist/index.js"); assert.deepEqual(await readdir(root), before);
});
