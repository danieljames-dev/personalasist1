import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../src/", import.meta.url);

/*
 * Recursive since the Findings 2+3 repair.
 *
 * `readdir` without `recursive` read only the top level, so every rule in this file stopped at
 * `src/`. `src/connectors/image-understanding.ts` sat one directory down holding a live
 * `globalThis.fetch`, and Discovery Campaign 02 found it reaching a host named by an environment
 * variable. This is the same defect as V0.4 Finding 3 in a second place: a rule whose file set is
 * narrower than the code it claims to govern.
 */
const files = (await readdir(root, { recursive: true }))
  .map((name) => String(name).split("\\").join("/"))
  .filter((name) => name.endsWith(".ts"));
const sources = await Promise.all(files.map(async (name) => [name, await readFile(new URL(name, root), "utf8")]));
const source = sources.map(([, text]) => text).join("\n");

/*
 * The process boundaries, named with the reason each one is allowed to exist.
 *
 * Two of these were invisible until this file started reading `src/` recursively: they sit one
 * directory down, so the old scan never opened them. Both spawn a *local* helper and neither
 * touches the network — they are disclosed here rather than repaired, because this milestone is
 * about outward networking and consolidating process boundaries is a separate decision.
 */
const PROCESS_BOUNDARIES = {
  "developer-bridge.ts": "the single repository-scoped developer agent boundary, asserted below",
  "connectors/local-whisper.ts": "spawns a local Whisper transcription helper; audio never leaves the machine",
  "connectors/sticker-ocr.ts": "spawns the bundled local EasyOCR worker; image bytes never leave the machine",
};


test("local-assistant production source has no network, browser, telemetry, database, or unrestricted shell implementation", () => {
  assert.doesNotMatch(source, /node:(?:http|https|net|tls|dgram)|\bfetch\s*\(|XMLHttpRequest|WebSocket|analytics|telemetry|sqlite|postgres|mongodb|vector\s*(?:db|store)/i);
  for (const [name, text] of sources) {
    if (Object.prototype.hasOwnProperty.call(PROCESS_BOUNDARIES, name)) {
      assert.ok(PROCESS_BOUNDARIES[name].length > 25, `${name} needs a reason somebody can act on`);
      continue;
    }
    assert.doesNotMatch(text, /\bchild_process\b/u, `${name} must not reach a process API`);
    assert.doesNotMatch(text, /(?<![.\w])(?:exec|execFile|execSync|spawn|spawnSync|fork)\s*\(/u, `${name} must not execute a process`);
  }
  // An exemption for a file that no longer spawns anything is an exemption nobody is checking.
  for (const [name, reason] of Object.entries(PROCESS_BOUNDARIES)) {
    const text = sources.find(([file]) => file === name)?.[1];
    assert.ok(text !== undefined, `${name} is exempted but no longer exists (${reason})`);
    assert.match(text, /\bchild_process\b/u, `${name} is exempted but spawns nothing; remove the exemption`);
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
  for (const name of ["StateRepositoryV1", "ClockV1", "IdGeneratorV1", "ModelProviderV1", "CapabilityRegistryV1", "ImportSourceV1", "PrivateBackupV1", "DeveloperAgentBridgeV1", "WriterAuthorityPortV1"]) {
    assert.match(source, new RegExp(`interface ${name}`, "u"));
  }
});

test("source files are plain text: no NUL or stray control bytes that would defeat review", async () => {
  // A single NUL byte makes Git treat a source file as binary, so it silently stops producing a
  // textual diff — the change becomes unreviewable. Control characters belong in escapes.
  const allowed = new Set([0x09, 0x0a, 0x0d]);
  for (const name of files) {
    const bytes = await readFile(new URL(name, root));
    for (const [index, byte] of bytes.entries()) {
      if (byte < 0x20 && !allowed.has(byte)) assert.fail(`${name} contains a raw control byte 0x${byte.toString(16).padStart(2, "0")} at offset ${index}; write it as an escape sequence instead`);
      if (byte === 0x7f) assert.fail(`${name} contains a raw delete byte at offset ${index}`);
    }
  }
});

test("no owner-identifying value, credential, or machine path is embedded in the source", () => {
  assert.doesNotMatch(source, /[\w.+-]+@[\w-]+\.[a-z]{2,}/iu, "no email address may appear in source");
  assert.doesNotMatch(source, /[A-Za-z]:\\Users\\/u, "no machine-specific path may appear in source");
  assert.doesNotMatch(source, /(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}/i, "no literal credential may appear in source");
});

test("domain package has no node:vm, eval, or new Function execution for model code", () => {
  for (const [name, text] of sources) {
    assert.doesNotMatch(text, /from\s+["']node:vm["']|require\s*\(\s*["']node:vm["']\s*\)/u, `${name} must not import node:vm`);
    assert.doesNotMatch(text, /(?<![.\w])eval\s*\(/u, `${name} must not call eval(`);
    assert.doesNotMatch(text, /\bnew\s+Function\s*\(/u, `${name} must not use new Function(`);
  }
});

test("CodeSandboxPortV1 is a domain port only; no Docker client in domain sources", () => {
  assert.match(source, /interface CodeSandboxPortV1/u);
  for (const [name, text] of sources) {
    // Same named boundaries as above: one list, so the two rules cannot drift apart.
    if (Object.prototype.hasOwnProperty.call(PROCESS_BOUNDARIES, name)) continue;
    assert.doesNotMatch(text, /\bchild_process\b/u, `${name} must not use child_process`);
    assert.doesNotMatch(text, /(?:^|[^.\w])docker\s+run\b/imu, `${name} must not invoke docker run`);
  }
  const sandbox = sources.find(([name]) => name === "code-sandbox.ts")?.[1] ?? "";
  assert.doesNotMatch(sandbox, /\bchild_process\b/u);
  assert.doesNotMatch(sandbox, /(?<![.\w])eval\s*\(/u);
  assert.doesNotMatch(sandbox, /\bnew\s+Function\s*\(/u);
  assert.doesNotMatch(sandbox, /from\s+["']node:vm["']|require\s*\(\s*["']node:vm["']\s*\)/u);
});

test("canonical inference is the post-routing execution path", () => {
  const service = sources.find(([name]) => name === "service.ts")?.[1] ?? "";
  assert.match(service, /CompositeCanonicalInferenceV1|bindInferenceEnvelope/u);
  assert.match(service, /#routeChat/u);
  // After routing, Chat must not independently re-select an unlimited memory slice.
  assert.doesNotMatch(service, /\.slice\(0,\s*20\)\.map\(\(\{\s*id,\s*content/u);
});
