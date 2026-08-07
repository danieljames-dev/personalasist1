import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../src/", import.meta.url);
const files = (await readdir(root)).filter((name) => name.endsWith(".ts"));
const sources = await Promise.all(files.map(async (name) => [name, await readFile(new URL(name, root), "utf8")]));
const source = sources.map(([, text]) => text).join("\n");

test("local-assistant production source has no network, browser, telemetry, database, or unrestricted shell implementation", () => {
  assert.doesNotMatch(source, /node:(?:http|https|net|tls|dgram)|\bfetch\s*\(|XMLHttpRequest|WebSocket|analytics|telemetry|sqlite|postgres|mongodb|vector\s*(?:db|store)/i);
  for (const [name, text] of sources) {
    if (name === "developer-bridge.ts") continue;
    assert.doesNotMatch(text, /\bchild_process\b/u, `${name} must not reach a process API`);
    assert.doesNotMatch(text, /(?<![.\w])(?:exec|execFile|execSync|spawn|spawnSync|fork)\s*\(/u, `${name} must not execute a process`);
  }
});

test("the developer bridge is the single process boundary and is repository-scoped", () => {
  const bridge = sources.find(([name]) => name === "developer-bridge.ts")?.[1] ?? "";
  assert.match(bridge, /shell:\s*false/u, "the bridge must never use a shell");
  assert.match(bridge, /approvedRepositoryRoot/u, "the bridge must be pinned to one approved repository root");
  assert.doesNotMatch(bridge, /process\.env|shell:\s*true/u);
});

test("model providers receive messages and context, never repositories or capability authority", () => {
  assert.match(source, /interface ModelProviderV1/u);
  assert.doesNotMatch(source, /interface ModelRequestV1[\s\S]{0,600}(?:repository|approve|execute)/i);
});

test("only the owner or the Agent Controller can approve; provider text cannot", () => {
  assert.match(source, /PROPOSE_ACTION_PREFIX/u, "the provider proposal protocol must be explicit");
  const service = sources.find(([name]) => name === "service.ts")?.[1] ?? "";
  assert.match(service, /splitProviderProposals/u, "provider proposals must be split out before storage");
  assert.doesNotMatch(service, /state:\s*"approved"[^\n]*provider/i, "no code path may approve a provider proposal");
});

test("all required replaceable ports remain explicit", () => {
  for (const name of ["StateRepositoryV1", "ClockV1", "IdGeneratorV1", "ModelProviderV1", "CapabilityRegistryV1", "ImportSourceV1", "PrivateBackupV1", "DeveloperAgentBridgeV1"]) {
    assert.match(source, new RegExp(`interface ${name}`, "u"));
  }
});

test("no owner-identifying value, credential, or machine path is embedded in the source", () => {
  assert.doesNotMatch(source, /[\w.+-]+@[\w-]+\.[a-z]{2,}/iu, "no email address may appear in source");
  assert.doesNotMatch(source, /[A-Za-z]:\\Users\\/u, "no machine-specific path may appear in source");
  assert.doesNotMatch(source, /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}/i, "no literal credential may appear in source");
});
