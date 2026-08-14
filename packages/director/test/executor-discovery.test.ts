/**
 * Fail-closed discovery of Claude and Grok.
 *
 * The cases that matter are the ones that must not pick a winner: two incomparable native
 * binaries, two different executables on PATH, a `.cmd` that is not an executable, an override
 * that names something unusable. Each rung is also shown to beat the ones below it, because a
 * ladder that falls through after a hit is just a search that happens to mention order.
 */
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { win32 } from "node:path";
import test from "node:test";
import {
  createNodeFileSystemProbe,
  discoverClaudeExecutor,
  discoverGrokExecutor,
  type DiscoveryEnvironment,
  type FileSystemProbe,
} from "../src/executor-discovery.js";

const HOME = "C:\\Users\\fixture";
const OWNER_CLAUDE = "C:\\owner\\claude.exe";
const OWNER_GROK = "C:\\owner\\grok.exe";
const LOCAL_CLAUDE = win32.join(HOME, ".local", "bin", "claude.exe");
const LOCAL_GROK = win32.join(HOME, ".grok", "bin", "grok.exe");
const PATH_A = "C:\\tools\\a";
const PATH_B = "C:\\tools\\b";
const PATH_CLAUDE_A = win32.join(PATH_A, "claude.exe");
const PATH_CLAUDE_B = win32.join(PATH_B, "claude.exe");
const PATH_CLAUDE_CMD = win32.join(PATH_A, "claude.cmd");
const PATH_GROK_A = win32.join(PATH_A, "grok.exe");
const PATH_GROK_B = win32.join(PATH_B, "grok.exe");
const PATH_GROK_CMD = win32.join(PATH_A, "grok.cmd");

function nativePath(folder: string): string {
  return win32.join(HOME, ".vscode", "extensions", folder, "resources", "native-binary", "claude.exe");
}

function envOf(over: DiscoveryEnvironment = {}): DiscoveryEnvironment {
  return { USERPROFILE: HOME, PATH: "", ...over };
}

function probeOf(files: readonly string[]): FileSystemProbe {
  const fileKeys = new Set(files.map(normKey));
  const dirChildren = new Map<string, Set<string>>();

  const addChild = (dir: string, name: string): void => {
    const key = normKey(dir);
    const existing = dirChildren.get(key);
    if (existing) existing.add(name);
    else dirChildren.set(key, new Set([name]));
  };

  for (const file of files) {
    let rest = file.replace(/\//g, "\\");
    while (true) {
      const cut = rest.lastIndexOf("\\");
      if (cut <= 2) break;
      const name = rest.slice(cut + 1);
      const parent = rest.slice(0, cut);
      if (name !== "") addChild(parent, name);
      rest = parent;
    }
  }

  return {
    isFile(absolutePath: string): boolean {
      return fileKeys.has(normKey(absolutePath));
    },
    readDir(absolutePath: string): readonly string[] {
      return [...(dirChildren.get(normKey(absolutePath)) ?? [])].sort();
    },
  };
}

function normKey(value: string): string {
  return value.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

const V231 = "anthropic.claude-code-2.1.231-win32-x64";
const V224 = "anthropic.claude-code-2.2.4-win32-x64";
const NIGHTLY = "anthropic.claude-code-nightly-win32-x64";
const V231_ARM = "anthropic.claude-code-2.1.231-win32-arm64";

// ---------------------------------------------------------------------------
// Claude — named override
// ---------------------------------------------------------------------------

test("Claude: AION_CLAUDE_CODE_PATH is used when it names an existing .exe", () => {
  const found = discoverClaudeExecutor(
    envOf({ AION_CLAUDE_CODE_PATH: OWNER_CLAUDE }),
    probeOf([OWNER_CLAUDE]),
  );
  assert.equal(found.status, "FOUND");
  if (found.status !== "FOUND") return;
  assert.equal(found.executablePath, OWNER_CLAUDE);
  assert.equal(found.rung, "AION_CLAUDE_CODE_PATH");
});

test("Claude: AION_CLAUDE_CODE_PATH beats every lower rung", () => {
  const found = discoverClaudeExecutor(
    envOf({
      AION_CLAUDE_CODE_PATH: OWNER_CLAUDE,
      PATH: PATH_A,
    }),
    probeOf([OWNER_CLAUDE, nativePath(V224), PATH_CLAUDE_A, LOCAL_CLAUDE]),
  );
  assert.equal(found.status, "FOUND");
  if (found.status !== "FOUND") return;
  assert.equal(found.rung, "AION_CLAUDE_CODE_PATH");
  assert.equal(found.executablePath, OWNER_CLAUDE);
});

test("Claude: a named override that is missing is UNAVAILABLE, not a fall-through", () => {
  const missing = discoverClaudeExecutor(
    envOf({ AION_CLAUDE_CODE_PATH: OWNER_CLAUDE, PATH: PATH_A }),
    probeOf([nativePath(V224), PATH_CLAUDE_A, LOCAL_CLAUDE]),
  );
  assert.equal(missing.status, "UNAVAILABLE");
  if (missing.status !== "UNAVAILABLE") return;
  assert.match(missing.reason, /not an existing file|refusing to fall through/i);
});

test("Claude: a named override that is a .cmd is UNAVAILABLE", () => {
  const shim = discoverClaudeExecutor(
    envOf({ AION_CLAUDE_CODE_PATH: "C:\\owner\\claude.cmd" }),
    probeOf(["C:\\owner\\claude.cmd", LOCAL_CLAUDE]),
  );
  assert.equal(shim.status, "UNAVAILABLE");
});

test("Claude: a relative named override is UNAVAILABLE", () => {
  const relative = discoverClaudeExecutor(
    envOf({ AION_CLAUDE_CODE_PATH: "claude.exe" }),
    probeOf([LOCAL_CLAUDE]),
  );
  assert.equal(relative.status, "UNAVAILABLE");
});

// ---------------------------------------------------------------------------
// Claude — VS Code native binaries
// ---------------------------------------------------------------------------

test("Claude: the highest comparable native binary wins", () => {
  const found = discoverClaudeExecutor(
    envOf(),
    probeOf([nativePath(V231), nativePath(V224)]),
  );
  assert.equal(found.status, "FOUND");
  if (found.status !== "FOUND") return;
  assert.equal(found.rung, "VSCODE_EXTENSION");
  assert.equal(found.executablePath, nativePath(V224));
});

test("Claude: two incomparable native binaries are AMBIGUOUS", () => {
  const result = discoverClaudeExecutor(
    envOf({ PATH: PATH_A }),
    probeOf([nativePath(V231), nativePath(NIGHTLY), PATH_CLAUDE_A, LOCAL_CLAUDE]),
  );
  assert.equal(result.status, "AMBIGUOUS", "incomparable natives must not fall through to PATH");
  if (result.status !== "AMBIGUOUS") return;
  assert.equal(result.rung, "VSCODE_EXTENSION");
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.includes(nativePath(V231)));
  assert.ok(result.candidates.includes(nativePath(NIGHTLY)));
});

test("Claude: two natives at the same version are AMBIGUOUS", () => {
  const result = discoverClaudeExecutor(
    envOf(),
    probeOf([nativePath(V231), nativePath(V231_ARM)]),
  );
  assert.equal(result.status, "AMBIGUOUS");
  if (result.status !== "AMBIGUOUS") return;
  assert.equal(result.rung, "VSCODE_EXTENSION");
  assert.equal(result.candidates.length, 2);
});

test("Claude: a unique native binary beats PATH and USER_LOCAL", () => {
  const found = discoverClaudeExecutor(
    envOf({ PATH: PATH_A }),
    probeOf([nativePath(V231), PATH_CLAUDE_A, LOCAL_CLAUDE]),
  );
  assert.equal(found.status, "FOUND");
  if (found.status !== "FOUND") return;
  assert.equal(found.rung, "VSCODE_EXTENSION");
  assert.equal(found.executablePath, nativePath(V231));
});

// ---------------------------------------------------------------------------
// Claude — PATH
// ---------------------------------------------------------------------------

test("Claude: a unique claude.exe on PATH is used", () => {
  const found = discoverClaudeExecutor(
    envOf({ PATH: PATH_A }),
    probeOf([PATH_CLAUDE_A]),
  );
  assert.equal(found.status, "FOUND");
  if (found.status !== "FOUND") return;
  assert.equal(found.rung, "PATH");
  assert.equal(found.executablePath, PATH_CLAUDE_A);
});

test("Claude: two different claude.exe on PATH are AMBIGUOUS", () => {
  const result = discoverClaudeExecutor(
    envOf({ PATH: `${PATH_A};${PATH_B}` }),
    probeOf([PATH_CLAUDE_A, PATH_CLAUDE_B, LOCAL_CLAUDE]),
  );
  assert.equal(result.status, "AMBIGUOUS", "two PATH hits must not fall through to USER_LOCAL");
  if (result.status !== "AMBIGUOUS") return;
  assert.equal(result.rung, "PATH");
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.includes(PATH_CLAUDE_A));
  assert.ok(result.candidates.includes(PATH_CLAUDE_B));
});

test("Claude: a .cmd on PATH is not accepted", () => {
  const skipped = discoverClaudeExecutor(
    envOf({ PATH: PATH_A }),
    probeOf([PATH_CLAUDE_CMD, LOCAL_CLAUDE]),
  );
  assert.equal(skipped.status, "FOUND");
  if (skipped.status !== "FOUND") return;
  assert.equal(skipped.rung, "USER_LOCAL");
  assert.equal(skipped.executablePath, LOCAL_CLAUDE);
});

test("Claude: a .cmd as the only PATH hit, with nothing else, is UNAVAILABLE", () => {
  const none = discoverClaudeExecutor(
    envOf({ PATH: PATH_A }),
    probeOf([PATH_CLAUDE_CMD]),
  );
  assert.equal(none.status, "UNAVAILABLE");
});

test("Claude: PATH beats USER_LOCAL", () => {
  const found = discoverClaudeExecutor(
    envOf({ PATH: PATH_A }),
    probeOf([PATH_CLAUDE_A, LOCAL_CLAUDE]),
  );
  assert.equal(found.status, "FOUND");
  if (found.status !== "FOUND") return;
  assert.equal(found.rung, "PATH");
});

test("Claude: the same PATH directory listed twice is still unique", () => {
  const found = discoverClaudeExecutor(
    envOf({ PATH: `${PATH_A};${PATH_A}` }),
    probeOf([PATH_CLAUDE_A]),
  );
  assert.equal(found.status, "FOUND");
  if (found.status !== "FOUND") return;
  assert.equal(found.rung, "PATH");
  assert.equal(found.executablePath, PATH_CLAUDE_A);
});

// ---------------------------------------------------------------------------
// Claude — USER_LOCAL and empty
// ---------------------------------------------------------------------------

test("Claude: %USERPROFILE%\\.local\\bin\\claude.exe is used when nothing above it hits", () => {
  const found = discoverClaudeExecutor(envOf(), probeOf([LOCAL_CLAUDE]));
  assert.equal(found.status, "FOUND");
  if (found.status !== "FOUND") return;
  assert.equal(found.rung, "USER_LOCAL");
  assert.equal(found.executablePath, LOCAL_CLAUDE);
});

test("Claude: nothing anywhere is UNAVAILABLE", () => {
  const none = discoverClaudeExecutor(envOf({ PATH: PATH_A }), probeOf([]));
  assert.equal(none.status, "UNAVAILABLE");
  if (none.status !== "UNAVAILABLE") return;
  assert.match(none.reason, /no Claude executable/i);
});

// ---------------------------------------------------------------------------
// Grok — named override
// ---------------------------------------------------------------------------

test("Grok: AION_GROK_PATH is used when it names an existing .exe", () => {
  const found = discoverGrokExecutor(
    envOf({ AION_GROK_PATH: OWNER_GROK }),
    probeOf([OWNER_GROK]),
  );
  assert.equal(found.status, "FOUND");
  if (found.status !== "FOUND") return;
  assert.equal(found.executablePath, OWNER_GROK);
  assert.equal(found.rung, "AION_GROK_PATH");
});

test("Grok: AION_GROK_PATH beats USER_LOCAL and PATH", () => {
  const found = discoverGrokExecutor(
    envOf({ AION_GROK_PATH: OWNER_GROK, PATH: PATH_A }),
    probeOf([OWNER_GROK, LOCAL_GROK, PATH_GROK_A]),
  );
  assert.equal(found.status, "FOUND");
  if (found.status !== "FOUND") return;
  assert.equal(found.rung, "AION_GROK_PATH");
  assert.equal(found.executablePath, OWNER_GROK);
});

test("Grok: a named override that is missing is UNAVAILABLE, not a fall-through", () => {
  const missing = discoverGrokExecutor(
    envOf({ AION_GROK_PATH: OWNER_GROK, PATH: PATH_A }),
    probeOf([LOCAL_GROK, PATH_GROK_A]),
  );
  assert.equal(missing.status, "UNAVAILABLE");
});

test("Grok: a named override that is a .cmd is UNAVAILABLE", () => {
  const shim = discoverGrokExecutor(
    envOf({ AION_GROK_PATH: "C:\\owner\\grok.cmd" }),
    probeOf(["C:\\owner\\grok.cmd", LOCAL_GROK]),
  );
  assert.equal(shim.status, "UNAVAILABLE");
});

// ---------------------------------------------------------------------------
// Grok — USER_LOCAL then PATH
// ---------------------------------------------------------------------------

test("Grok: %USERPROFILE%\\.grok\\bin\\grok.exe beats PATH", () => {
  const found = discoverGrokExecutor(
    envOf({ PATH: PATH_A }),
    probeOf([LOCAL_GROK, PATH_GROK_A]),
  );
  assert.equal(found.status, "FOUND");
  if (found.status !== "FOUND") return;
  assert.equal(found.rung, "USER_LOCAL");
  assert.equal(found.executablePath, LOCAL_GROK);
});

test("Grok: a unique grok.exe on PATH is used when USER_LOCAL is empty", () => {
  const found = discoverGrokExecutor(
    envOf({ PATH: PATH_A }),
    probeOf([PATH_GROK_A]),
  );
  assert.equal(found.status, "FOUND");
  if (found.status !== "FOUND") return;
  assert.equal(found.rung, "PATH");
  assert.equal(found.executablePath, PATH_GROK_A);
});

test("Grok: two different grok.exe on PATH are AMBIGUOUS", () => {
  const result = discoverGrokExecutor(
    envOf({ PATH: `${PATH_A};${PATH_B}` }),
    probeOf([PATH_GROK_A, PATH_GROK_B]),
  );
  assert.equal(result.status, "AMBIGUOUS");
  if (result.status !== "AMBIGUOUS") return;
  assert.equal(result.rung, "PATH");
  assert.equal(result.candidates.length, 2);
});

test("Grok: a .cmd on PATH is not accepted", () => {
  const none = discoverGrokExecutor(
    envOf({ PATH: PATH_A }),
    probeOf([PATH_GROK_CMD]),
  );
  assert.equal(none.status, "UNAVAILABLE");
});

test("Grok: nothing anywhere is UNAVAILABLE", () => {
  const none = discoverGrokExecutor(envOf(), probeOf([]));
  assert.equal(none.status, "UNAVAILABLE");
  if (none.status !== "UNAVAILABLE") return;
  assert.match(none.reason, /no Grok executable/i);
});

test("Grok: a VS Code Claude native is not a Grok candidate", () => {
  const none = discoverGrokExecutor(envOf(), probeOf([nativePath(V224)]));
  assert.equal(none.status, "UNAVAILABLE");
});

// ---------------------------------------------------------------------------
// Real host — exercise the live ladder once
// ---------------------------------------------------------------------------

test("the real host ladder returns a typed Claude and Grok result", () => {
  const probe = createNodeFileSystemProbe();
  const claude = discoverClaudeExecutor(process.env, probe);
  const grok = discoverGrokExecutor(process.env, probe);
  assertHostResult(claude, "Claude");
  assertHostResult(grok, "Grok");
});

function assertHostResult(
  result: ReturnType<typeof discoverClaudeExecutor> | ReturnType<typeof discoverGrokExecutor>,
  label: string,
): void {
  if (result.status === "FOUND") {
    assert.ok(win32.isAbsolute(result.executablePath), `${label} path must be absolute`);
    assert.match(result.executablePath, /\.exe$/i, `${label} must be an .exe`);
    assert.equal(statSync(result.executablePath).isFile(), true, `${label} must exist as a file`);
    assert.ok(result.rung, `${label} must name the rung that supplied it`);
    return;
  }
  if (result.status === "AMBIGUOUS") {
    assert.ok(result.candidates.length >= 2, `${label} AMBIGUOUS must list the candidates`);
    assert.ok(result.rung, `${label} AMBIGUOUS must name the rung`);
    return;
  }
  assert.equal(result.status, "UNAVAILABLE", `${label} must be a typed discovery result`);
  assert.ok(result.reason.length > 0, `${label} UNAVAILABLE must say why`);
}
