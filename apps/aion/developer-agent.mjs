import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  ClaudeCodeCliDeveloperAgentBridgeV1, CodexCliDeveloperAgentBridgeV1,
  SelectableDeveloperAgentRegistryV1, UnavailableDeveloperAgentBridgeV1,
} from "../../packages/local-assistant/dist/index.js";

/**
 * Narrow, explicit developer-agent discovery for every supported bridge.
 *
 * This checks a small fixed list of documented installation locations with one `stat` each. It
 * never scans the computer, never reads a directory tree, and never inspects anything outside the
 * candidates below. On Windows the npm global shims are `.cmd`/`.ps1` files; AION deliberately
 * refuses to route instruction text through a shell, so it looks for the real vendored `.exe`
 * instead. If nothing suitable is found, the bridge truthfully reports itself unavailable.
 */

/** Documented Codex CLI install locations. */
export function developerAgentCandidates(env = process.env, platform = process.platform, arch = process.arch) {
  const candidates = [];
  const override = env.AION_DEVELOPER_AGENT_PATH?.trim();
  if (override && isAbsolute(override) && resolve(override) === override) candidates.push(override);
  const prefixes = [env.npm_config_prefix, platform === "win32" ? (env.APPDATA ? join(env.APPDATA, "npm") : null) : "/usr/local"].filter(Boolean);
  const triple = platform === "win32"
    ? { x64: "x86_64-pc-windows-msvc", arm64: "aarch64-pc-windows-msvc" }[arch]
    : platform === "darwin"
      ? { x64: "x86_64-apple-darwin", arm64: "aarch64-apple-darwin" }[arch]
      : { x64: "x86_64-unknown-linux-musl", arm64: "aarch64-unknown-linux-musl" }[arch];
  if (triple) {
    const binary = platform === "win32" ? "codex.exe" : "codex";
    for (const prefix of prefixes) {
      candidates.push(join(prefix, "node_modules", "@openai", "codex", "vendor", triple, "codex", binary));
      candidates.push(join(prefix, "lib", "node_modules", "@openai", "codex", "vendor", triple, "codex", binary));
    }
  }
  return candidates;
}

/**
 * Documented Claude Code CLI install locations. The native installer places a real executable in
 * the user's local bin directory. Only genuine executables are considered: a shell shim and a
 * bare `cli.js` are both excluded, because AION spawns the program directly with no shell and no
 * interpreter of its own choosing.
 */
export function claudeCodeCandidates(env = process.env, platform = process.platform, home = homedir()) {
  const candidates = [];
  const override = env.AION_CLAUDE_CODE_PATH?.trim();
  if (override && isAbsolute(override) && resolve(override) === override) candidates.push(override);
  const binary = platform === "win32" ? "claude.exe" : "claude";
  if (home && isAbsolute(home)) candidates.push(join(home, ".local", "bin", binary));
  if (platform !== "win32") candidates.push(join("/usr", "local", "bin", binary));
  return candidates.filter((candidate) => !/\.(?:cmd|ps1|bat|sh|js|mjs|cjs)$/u.test(candidate));
}

async function firstInstalled(candidates) {
  for (const candidate of candidates) {
    try { if ((await stat(candidate)).isFile()) return candidate; }
    catch { /* this candidate is simply not installed */ }
  }
  return null;
}

/**
 * Builds one bridge per supported developer agent that is actually installed and answers its own
 * local version probe. The preference order below is only AION's default; Settings lets the owner
 * choose any registered bridge, and the registry never substitutes a different one.
 *
 * `options.claudeCandidates` and `options.codexCandidates` inject the candidate lists. A test that
 * is about *absence* must supply them, because the default lists intentionally include real
 * documented install locations — otherwise an assertion about the unavailable path would silently
 * stop running on any machine where a developer agent happens to be installed.
 */
export async function resolveDeveloperAgentBridges(repositoryRoot, env = process.env, options = {}) {
  const bridges = [];
  const claude = await firstInstalled(options.claudeCandidates ?? claudeCodeCandidates(env));
  if (claude) bridges.push(new ClaudeCodeCliDeveloperAgentBridgeV1(repositoryRoot, claude));
  const codex = await firstInstalled(options.codexCandidates ?? developerAgentCandidates(env));
  if (codex) bridges.push(new CodexCliDeveloperAgentBridgeV1(repositoryRoot, codex));

  const confirmed = [];
  for (const bridge of bridges) if ((await bridge.status()).available) confirmed.push(bridge);
  if (confirmed.length) return new SelectableDeveloperAgentRegistryV1(confirmed);

  return new SelectableDeveloperAgentRegistryV1([
    new UnavailableDeveloperAgentBridgeV1(
      "No supported local developer-agent executable is configured (unavailable). AION checked only the documented Codex CLI and Claude Code install locations; it does not search your computer. Windows npm shell shims are deliberately ignored because AION never routes instructions through a shell.",
    ),
  ]);
}

/** Backwards-compatible single-bridge resolution: the bridge AION would select by default. */
export async function resolveDeveloperAgentBridge(repositoryRoot, env = process.env, options = {}) {
  return (await resolveDeveloperAgentBridges(repositoryRoot, env, options)).selected();
}
