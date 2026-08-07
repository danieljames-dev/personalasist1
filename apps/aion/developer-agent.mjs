import { stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { CodexCliDeveloperAgentBridgeV1, UnavailableDeveloperAgentBridgeV1 } from "../../packages/local-assistant/dist/index.js";

/**
 * Narrow, explicit developer-agent discovery.
 *
 * This checks a small fixed list of documented installation locations with one `stat` each. It
 * never scans the computer, never reads a directory tree, and never inspects anything outside the
 * candidates below. On Windows the npm global shims are `.cmd`/`.ps1` files; AION deliberately
 * refuses to route instruction text through a shell, so it looks for the real vendored `.exe`
 * instead. If nothing suitable is found, the bridge truthfully reports itself unavailable.
 */
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

export async function resolveDeveloperAgentBridge(repositoryRoot, env = process.env) {
  for (const candidate of developerAgentCandidates(env)) {
    try { if ((await stat(candidate)).isFile()) return new CodexCliDeveloperAgentBridgeV1(repositoryRoot, candidate); }
    catch { /* this candidate is simply not installed */ }
  }
  const bare = process.platform === "win32" ? "codex.exe" : "codex";
  const probe = new CodexCliDeveloperAgentBridgeV1(repositoryRoot, bare);
  if ((await probe.status()).available) return probe;
  return new UnavailableDeveloperAgentBridgeV1(
    "No supported local developer-agent executable was found. AION checked only the documented Codex CLI install locations and the command path; it does not search your computer. Windows npm shell shims are deliberately ignored because AION never routes instructions through a shell.",
  );
}
