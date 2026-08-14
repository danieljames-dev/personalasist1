/**
 * Finding the Claude and Grok executables, and refusing to guess.
 *
 * A Director that picks the wrong binary will look like a model behaving strangely. The failure
 * belongs here: if a rung of the ladder produces more than one candidate and those candidates
 * cannot be ordered, the answer is AMBIGUOUS — never the first one the filesystem listed, never
 * the one that happens to be first on PATH.
 *
 * The environment and the filesystem are injected so the ambiguity cases can be tested without
 * the real host. A function that reads `process.env` and calls `fs` directly cannot be shown to
 * refuse those cases.
 *
 * ## The ladders
 *
 * Claude, in order: `AION_CLAUDE_CODE_PATH`; the highest comparable VS Code native binary under
 * `anthropic.claude-code-<version>-win32-<arch>/resources/native-binary/claude.exe`; a unique
 * `claude.exe` on PATH; `%USERPROFILE%\\.local\\bin\\claude.exe`. Grok, in order: `AION_GROK_PATH`;
 * `%USERPROFILE%\\.grok\\bin\\grok.exe`; a unique `grok.exe` on PATH. A rung with no candidate is
 * skipped. A named override that cannot be used is UNAVAILABLE — the Owner named a path, which is
 * an instruction, not a hint. `.cmd` is never a candidate: spawn runs without a shell.
 */
import { readdirSync, statSync } from "node:fs";
import { win32 } from "node:path";
import { compareVersions } from "./executors.js";
import { canonicalizeHostPath, isResolvedHostPath } from "./host-path.js";

/** Injected environment. Only the keys the ladders name are consulted. */
export type DiscoveryEnvironment = {
  readonly [key: string]: string | undefined;
};

/**
 * Injected filesystem. Missing paths are ordinary negatives; the ladder does not throw.
 *
 * `readDir` returns entry names, not full paths. A missing directory is an empty list.
 */
export interface FileSystemProbe {
  isFile(absolutePath: string): boolean;
  readDir(absolutePath: string): readonly string[];
}

export type ClaudeDiscoveryRungV1 =
  | "AION_CLAUDE_CODE_PATH"
  | "VSCODE_EXTENSION"
  | "PATH"
  | "USER_LOCAL";

export type GrokDiscoveryRungV1 =
  | "AION_GROK_PATH"
  | "USER_LOCAL"
  | "PATH";

export type ExecutorDiscoveryResultV1<Rung extends string = string> =
  | {
      status: "FOUND";
      executablePath: string;
      rung: Rung;
      reason: string;
    }
  | {
      status: "UNAVAILABLE";
      reason: string;
    }
  | {
      status: "AMBIGUOUS";
      rung: Rung;
      candidates: readonly string[];
      reason: string;
    };

const CLAUDE_OVERRIDE = "AION_CLAUDE_CODE_PATH";
const GROK_OVERRIDE = "AION_GROK_PATH";
const CLAUDE_EXE = "claude.exe";
const GROK_EXE = "grok.exe";

/** VS Code's platform-specific native package folder. The `*` is the version. */
const CLAUDE_NATIVE_FOLDER = /^anthropic\.claude-code-(.*)-win32-[^\\/]+$/i;

export function createNodeFileSystemProbe(): FileSystemProbe {
  return {
    isFile(absolutePath: string): boolean {
      try {
        return statSync(absolutePath).isFile();
      } catch {
        return false;
      }
    },
    readDir(absolutePath: string): readonly string[] {
      try {
        return readdirSync(absolutePath);
      } catch {
        return [];
      }
    },
  };
}

export function discoverClaudeExecutor(
  env: DiscoveryEnvironment,
  probe: FileSystemProbe,
): ExecutorDiscoveryResultV1<ClaudeDiscoveryRungV1> {
  const named = lookNamedOverride(env, probe, CLAUDE_OVERRIDE, "AION_CLAUDE_CODE_PATH");
  if (named !== null) return named;

  const natives = listClaudeNativeBinaries(env, probe);
  const nativePick = pickHighestComparable(natives);
  if (nativePick.kind === "one") {
    return found(nativePick.path, "VSCODE_EXTENSION", "highest comparable VS Code native binary");
  }
  if (nativePick.kind === "ambiguous") {
    return ambiguous(
      "VSCODE_EXTENSION",
      nativePick.paths,
      "two or more VS Code native binaries could not be ordered; refusing to pick one",
    );
  }

  const onPath = uniqueExeOnPath(env, probe, CLAUDE_EXE);
  if (onPath.kind === "one") {
    return found(onPath.path, "PATH", "unique claude.exe on PATH");
  }
  if (onPath.kind === "ambiguous") {
    return ambiguous(
      "PATH",
      onPath.paths,
      "more than one claude.exe is on PATH; refusing to pick one",
    );
  }

  const local = userLocalFile(env, probe, [".local", "bin", CLAUDE_EXE]);
  if (local !== null) {
    return found(local, "USER_LOCAL", "%USERPROFILE%\\.local\\bin\\claude.exe");
  }

  return unavailable("no Claude executable was found on any rung of the discovery ladder");
}

export function discoverGrokExecutor(
  env: DiscoveryEnvironment,
  probe: FileSystemProbe,
): ExecutorDiscoveryResultV1<GrokDiscoveryRungV1> {
  const named = lookNamedOverride(env, probe, GROK_OVERRIDE, "AION_GROK_PATH");
  if (named !== null) return named;

  const local = userLocalFile(env, probe, [".grok", "bin", GROK_EXE]);
  if (local !== null) {
    return found(local, "USER_LOCAL", "%USERPROFILE%\\.grok\\bin\\grok.exe");
  }

  const onPath = uniqueExeOnPath(env, probe, GROK_EXE);
  if (onPath.kind === "one") {
    return found(onPath.path, "PATH", "unique grok.exe on PATH");
  }
  if (onPath.kind === "ambiguous") {
    return ambiguous(
      "PATH",
      onPath.paths,
      "more than one grok.exe is on PATH; refusing to pick one",
    );
  }

  return unavailable("no Grok executable was found on any rung of the discovery ladder");
}

function lookNamedOverride<Rung extends string>(
  env: DiscoveryEnvironment,
  probe: FileSystemProbe,
  key: string,
  rung: Rung,
): ExecutorDiscoveryResultV1<Rung> | null {
  const raw = readEnv(env, key);
  if (raw === undefined) return null;

  if (!win32.isAbsolute(raw) || !isResolvedHostPath(raw)) {
    return unavailable(
      `${key} is set but is not an identifiable absolute path; refusing to fall through`,
    );
  }
  const normalized = win32.normalize(raw);
  if (!isWindowsExe(normalized)) {
    return unavailable(
      `${key} names a non-.exe path; a shell shim is not an executable the Director can spawn`,
    );
  }
  if (!probe.isFile(normalized)) {
    return unavailable(
      `${key} names a path that is not an existing file; refusing to fall through`,
    );
  }
  return found(normalized, rung, `${key} names this executable`);
}

function listClaudeNativeBinaries(
  env: DiscoveryEnvironment,
  probe: FileSystemProbe,
): readonly { path: string; version: string }[] {
  const home = userProfile(env);
  if (home === null) return [];

  const extensionsRoot = win32.join(home, ".vscode", "extensions");
  const found: { path: string; version: string }[] = [];
  for (const name of probe.readDir(extensionsRoot)) {
    const match = CLAUDE_NATIVE_FOLDER.exec(name);
    if (!match) continue;
    const candidate = win32.join(extensionsRoot, name, "resources", "native-binary", CLAUDE_EXE);
    if (!probe.isFile(candidate)) continue;
    found.push({ path: candidate, version: match[1] ?? "" });
  }
  return found;
}

function uniqueExeOnPath(
  env: DiscoveryEnvironment,
  probe: FileSystemProbe,
  exeName: string,
): { kind: "none" } | { kind: "one"; path: string } | { kind: "ambiguous"; paths: string[] } {
  const pathValue = readEnv(env, "PATH") ?? readEnv(env, "Path") ?? "";
  const seen = new Map<string, string>();

  for (const rawDir of pathValue.split(win32.delimiter)) {
    const dir = stripSurroundingQuotes(rawDir.trim());
    if (dir === "") continue;
    if (!win32.isAbsolute(dir) || !isResolvedHostPath(dir)) continue;
    const candidate = win32.join(win32.normalize(dir), exeName);
    if (!isWindowsExe(candidate)) continue;
    if (!probe.isFile(candidate)) continue;
    const key = canonicalizeHostPath(candidate);
    if (key === "") continue;
    if (!seen.has(key)) seen.set(key, candidate);
  }

  const paths = [...seen.values()].sort(compareAbsolutePaths);
  if (paths.length === 0) return { kind: "none" };
  if (paths.length === 1) return { kind: "one", path: paths[0]! };
  return { kind: "ambiguous", paths };
}

function userLocalFile(
  env: DiscoveryEnvironment,
  probe: FileSystemProbe,
  relativeSegments: readonly string[],
): string | null {
  const home = userProfile(env);
  if (home === null) return null;
  const candidate = win32.join(home, ...relativeSegments);
  if (!isWindowsExe(candidate)) return null;
  if (!probe.isFile(candidate)) return null;
  return candidate;
}

function userProfile(env: DiscoveryEnvironment): string | null {
  const raw = readEnv(env, "USERPROFILE") ?? readEnv(env, "UserProfile");
  if (raw === undefined) return null;
  if (!win32.isAbsolute(raw) || !isResolvedHostPath(raw)) return null;
  return win32.normalize(raw);
}

function pickHighestComparable(
  items: readonly { path: string; version: string }[],
): { kind: "none" } | { kind: "one"; path: string } | { kind: "ambiguous"; paths: string[] } {
  if (items.length === 0) return { kind: "none" };
  if (items.length === 1) return { kind: "one", path: items[0]!.path };

  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (compareVersions(items[i]!.version, items[j]!.version) === null) {
        return { kind: "ambiguous", paths: sortedPaths(items.map((item) => item.path)) };
      }
    }
  }

  let best = items[0]!;
  for (const item of items.slice(1)) {
    const order = compareVersions(item.version, best.version);
    if (order !== null && order > 0) best = item;
  }

  const winners = items.filter((item) => compareVersions(item.version, best.version) === 0);
  if (winners.length !== 1) {
    return { kind: "ambiguous", paths: sortedPaths(winners.map((item) => item.path)) };
  }
  return { kind: "one", path: best.path };
}

function readEnv(env: DiscoveryEnvironment, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function isWindowsExe(filePath: string): boolean {
  return win32.extname(filePath).toLowerCase() === ".exe";
}

function stripSurroundingQuotes(value: string): string {
  return value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")
    ? value.slice(1, -1)
    : value;
}

function found<Rung extends string>(
  executablePath: string,
  rung: Rung,
  reason: string,
): ExecutorDiscoveryResultV1<Rung> {
  return { status: "FOUND", executablePath, rung, reason };
}

function unavailable(reason: string): ExecutorDiscoveryResultV1<never> {
  return { status: "UNAVAILABLE", reason };
}

function ambiguous<Rung extends string>(
  rung: Rung,
  candidates: readonly string[],
  reason: string,
): ExecutorDiscoveryResultV1<Rung> {
  return { status: "AMBIGUOUS", rung, candidates: sortedPaths(candidates), reason };
}

function sortedPaths(paths: readonly string[]): string[] {
  return [...paths].sort(compareAbsolutePaths);
}

function compareAbsolutePaths(a: string, b: string): number {
  const left = canonicalizeHostPath(a) || a.toLowerCase();
  const right = canonicalizeHostPath(b) || b.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}
