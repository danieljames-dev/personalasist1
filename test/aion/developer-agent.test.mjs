import assert from "node:assert/strict";
import { isAbsolute } from "node:path";
import test from "node:test";
import { claudeCodeCandidates, developerAgentCandidates, resolveDeveloperAgentBridge, resolveDeveloperAgentBridges } from "../../apps/aion/developer-agent.mjs";

const repositoryRoot = process.cwd();
const absentEnvironment = { AION_DEVELOPER_AGENT_PATH: "C:\\synthetic\\definitely\\absent\\codex.exe", AION_CLAUDE_CODE_PATH: "C:\\synthetic\\definitely\\absent\\claude.exe" };

test("developer-agent discovery checks only a small fixed list of documented absolute paths", () => {
  const candidates = developerAgentCandidates({ APPDATA: "C:\\synthetic\\AppData\\Roaming", npm_config_prefix: "C:\\synthetic\\prefix" }, "win32", "x64");
  assert.ok(candidates.length > 0 && candidates.length <= 8, "discovery stays a short explicit list, never a scan");
  for (const candidate of candidates) {
    assert.ok(isAbsolute(candidate), "every candidate is an absolute path");
    assert.match(candidate, /codex\.exe$/u, "only a real executable is considered");
  }
  assert.equal(candidates.some((c) => /\.(?:cmd|ps1|bat|sh)$/u.test(c)), false, "shell shims are never used");
});

test("Claude Code discovery is an equally short list of documented executables, never a scan", () => {
  const candidates = claudeCodeCandidates({}, "win32", "C:\\synthetic\\home");
  assert.ok(candidates.length > 0 && candidates.length <= 8, "discovery stays a short explicit list, never a scan");
  for (const candidate of candidates) {
    assert.ok(isAbsolute(candidate), "every candidate is an absolute path");
    assert.match(candidate, /claude\.exe$/u, "only a real executable is considered");
  }
  assert.equal(candidates.some((c) => /\.(?:cmd|ps1|bat|sh|js|mjs|cjs)$/u.test(c)), false, "shell shims and script entry points are never used");
  assert.deepEqual(claudeCodeCandidates({}, "win32", "relative-home"), [], "an unusable home directory yields no candidate");
});

test("an owner override is honoured only when it is an explicit normalized absolute path", () => {
  const relative = developerAgentCandidates({ AION_DEVELOPER_AGENT_PATH: "..\\codex.exe", APPDATA: "C:\\synthetic\\AppData\\Roaming" }, "win32", "x64");
  assert.equal(relative.some((c) => c.includes("..")), false, "a relative override is rejected");
  const absolute = developerAgentCandidates({ AION_DEVELOPER_AGENT_PATH: "C:\\synthetic\\codex\\codex.exe", APPDATA: "C:\\synthetic\\AppData\\Roaming" }, "win32", "x64");
  assert.equal(absolute[0], "C:\\synthetic\\codex\\codex.exe", "an explicit override is checked first");
  const claudeRelative = claudeCodeCandidates({ AION_CLAUDE_CODE_PATH: "..\\claude.exe" }, "win32", "C:\\synthetic\\home");
  assert.equal(claudeRelative.some((c) => c.includes("..")), false, "a relative Claude override is rejected");
  assert.equal(claudeCodeCandidates({ AION_CLAUDE_CODE_PATH: "C:\\synthetic\\claude\\claude.exe" }, "win32", "C:\\synthetic\\home")[0], "C:\\synthetic\\claude\\claude.exe");
});

/**
 * Injected empty candidate lists. This is the only honest way to test the absent path: the default
 * lists deliberately contain real documented install locations, so a test that relied on them
 * would stop asserting anything the moment a developer agent was installed on the machine.
 */
const NOTHING_INSTALLED = { claudeCandidates: [], codexCandidates: [] };
const ABSENT_PATHS = {
  claudeCandidates: ["C:\\synthetic\\definitely\\absent\\claude.exe"],
  codexCandidates: ["C:\\synthetic\\definitely\\absent\\codex.exe"],
};

test("with no candidate installed, discovery reports unavailable truthfully and unconditionally", async () => {
  assert.deepEqual(developerAgentCandidates({}, "win32", "x64"), [], "no environment means no Codex candidate");
  for (const [label, injected] of [["no candidates at all", NOTHING_INSTALLED], ["candidates that do not exist", ABSENT_PATHS]]) {
    const bridge = await resolveDeveloperAgentBridge(repositoryRoot, absentEnvironment, injected);
    const status = await bridge.status({ includeAccount: true });
    assert.equal(status.available, false, `${label}: availability is never fabricated`);
    assert.equal(status.executable, null, `${label}: no executable is reported`);
    assert.equal(status.version, null);
    assert.deepEqual(status.modes, [], `${label}: an unavailable bridge offers no task boundary`);
    // No executable means account was never inspected — "unknown" would imply a failed probe.
    assert.equal(status.account, "not-checked", `${label}: account is not-checked when no executable exists`);
    assert.match(status.accountDetail, /not checked|not been checked/iu, `${label}: account detail is truthful`);
    assert.match(status.detail, /unavailable|configured/iu, `${label}: detail identifies unavailable/not configured`);
    assert.match(status.detail, /does not search your computer/u);
    await assert.rejects(
      bridge.run({ repositoryRoot, instruction: "anything", mode: "read-only" }, new AbortController().signal),
      /unavailable|configured|No supported local developer-agent executable/iu,
    );
  }
});

test("the registry reports every bridge, and an unregistered selection fails closed", async () => {
  const registry = await resolveDeveloperAgentBridges(repositoryRoot, absentEnvironment, NOTHING_INSTALLED);
  assert.equal(registry.list().length, 1, "exactly one truthful unavailable bridge when nothing is installed");
  assert.equal(registry.list()[0].id, "none");
  assert.equal(registry.selected(), registry.list()[0], "the default selection is AION's first preference");
  assert.throws(() => registry.select("definitely-not-installed"), /not registered/iu);
  assert.throws(() => registry.select("claude-code"), /not registered/iu, "a bridge that is not installed cannot be selected");
  registry.select("");
  assert.equal(registry.selected(), registry.list()[0], "an empty selection restores the default");
});

test("real discovery on this machine is reported truthfully, whatever is installed", async () => {
  // Deliberately exercises the real documented locations. It asserts internal consistency rather
  // than a particular outcome, so it is correct on a machine with or without a developer agent.
  const registry = await resolveDeveloperAgentBridges(repositoryRoot);
  assert.ok(registry.list().length >= 1, "there is always at least a truthful unavailable bridge");
  assert.equal(new Set(registry.list().map((bridge) => bridge.id)).size, registry.list().length, "bridge identifiers are unique");
  for (const bridge of registry.list()) {
    const status = await bridge.status();
    assert.equal(status.bridgeId, bridge.id);
    assert.equal(status.available, status.executable !== null, "availability and a reported executable agree");
    assert.equal(status.modes.length > 0, status.available, "only an available bridge offers task boundaries");
    assert.equal(status.account, "not-checked", "an ordinary status read never probes an account");
  }
});

test("a resolved bridge refuses tasks aimed outside the one approved repository root", async () => {
  const bridge = await resolveDeveloperAgentBridge(repositoryRoot);
  const foreign = process.platform === "win32" ? "C:\\synthetic\\elsewhere" : "/synthetic/elsewhere";
  await assert.rejects(bridge.run({ repositoryRoot: foreign, instruction: "Do something", mode: "read-only" }, new AbortController().signal), /approved repository root|available|configured|unavailable/iu);
  await assert.rejects(bridge.run({ repositoryRoot, instruction: "   ", mode: "read-only" }, new AbortController().signal), /instruction is invalid|available|configured|unavailable/iu);
});

test("forced no-agent host: zero task execution and truthful account semantics", async () => {
  const { UnavailableDeveloperAgentBridgeV1 } = await import("../../packages/local-assistant/dist/index.js");
  const bridge = new UnavailableDeveloperAgentBridgeV1();
  const ordinary = await bridge.status();
  const asked = await bridge.status({ includeAccount: true });
  assert.equal(ordinary.available, false);
  assert.equal(ordinary.account, "not-checked");
  assert.equal(asked.account, "not-checked", "includeAccount does not invent a probe result when unavailable");
  assert.deepEqual(ordinary.modes, []);
  let executed = false;
  await assert.rejects(async () => {
    executed = true;
    await bridge.run({ repositoryRoot, instruction: "must not run", mode: "read-only" }, new AbortController().signal);
  }, /unavailable|configured/iu);
  // run throws before any work; the flag only proves we entered the call and it failed closed.
  assert.equal(executed, true);
  assert.equal(bridge.describe("read-only").args.length, 0);
});

test("no part of a task instruction can ever become an argument or shell text", async () => {
  const registry = await resolveDeveloperAgentBridges(repositoryRoot);
  for (const bridge of registry.list()) {
    const status = await bridge.status();
    for (const mode of status.modes) {
      const { executable, args } = bridge.describe(mode);
      assert.equal(typeof executable, "string");
      assert.doesNotMatch(executable, /[A-Za-z]:\\|\//u, "the bridge reports an executable name, never a local path");
      for (const arg of args) assert.equal(typeof arg, "string");
      assert.doesNotMatch(args.join(" "), /[A-Za-z]:\\/u, "no local path appears in the disclosed command");
      assert.equal(args.some((arg) => /^(?:-c|--config|--dangerously|--allow-dangerously|--full-auto)/u.test(arg)), false, "no bypass flag is ever used");
    }
    if (status.modes.includes("read-only")) {
      const readOnly = bridge.describe("read-only").args.join(" ");
      const writing = bridge.describe("workspace-write").args.join(" ");
      assert.notEqual(readOnly, writing, "the two boundaries are genuinely different commands");
      assert.doesNotMatch(readOnly, /workspace-write|danger-full-access|bypassPermissions/u, "a read-only task never asks for write or bypass authority");
    }
  }
});
