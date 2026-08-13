/**
 * Deterministic Claude / Grok discovery. No pinned extension version.
 * Fail closed if two comparable candidates cannot be ranked.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
import { spawnSync } from "node:child_process";

function isRealExe(p) {
  if (!p || !existsSync(p)) return false;
  if (/\.(cmd|bat|ps1)$/i.test(p)) return false;
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function probeVersion(exe) {
  if (!isRealExe(exe)) return { ok: false, reason: "missing" };
  const r = spawnSync(exe, ["--version"], {
    encoding: "utf8",
    timeout: 12_000,
    windowsHide: true,
    shell: false,
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`.trim();
  return {
    ok: r.status === 0 || Boolean(out),
    status: r.status,
    versionText: out.slice(0, 400),
  };
}

function pathCandidates(basename) {
  const found = [];
  const pathEnv = process.env.PATH || "";
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const exe = join(dir, basename);
    if (isRealExe(exe)) found.push(exe);
  }
  return found;
}

function vscodeClaudeNatives() {
  const extRoot = join(homedir(), ".vscode", "extensions");
  if (!existsSync(extRoot)) return [];
  const dirs = readdirSync(extRoot).filter((d) => /^anthropic\.claude-code-.*-win32-/i.test(d));
  const scored = [];
  for (const d of dirs) {
    const exe = join(extRoot, d, "resources", "native-binary", "claude.exe");
    const m = d.match(/anthropic\.claude-code-([0-9.]+)-/i);
    scored.push({
      exe,
      folder: d,
      version: m ? m[1] : null,
      exists: isRealExe(exe),
    });
  }
  return scored.filter((x) => x.exists);
}

function comparableVersions(a, b) {
  if (!a || !b) return false;
  return /^\d+(\.\d+)*$/.test(a) && /^\d+(\.\d+)*$/.test(b);
}

function cmpVer(a, b) {
  const as = a.split(".").map(Number);
  const bs = b.split(".").map(Number);
  const n = Math.max(as.length, bs.length);
  for (let i = 0; i < n; i += 1) {
    const d = (as[i] || 0) - (bs[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function discoverClaude() {
  const notes = [];
  const configured = process.env.AION_CLAUDE_CODE_PATH;
  if (configured) {
    if (isRealExe(configured)) {
      return { path: configured, via: "AION_CLAUDE_CODE_PATH", probe: probeVersion(configured), notes };
    }
    notes.push(`AION_CLAUDE_CODE_PATH set but not a real exe: ${configured}`);
  }

  const natives = vscodeClaudeNatives();
  if (natives.length === 1) {
    return { path: natives[0].exe, via: "vscode-native", versionFolder: natives[0].version, probe: probeVersion(natives[0].exe), notes, candidates: natives };
  }
  if (natives.length > 1) {
    const vers = natives.map((n) => n.version);
    if (vers.every((v) => comparableVersions(v, vers[0]))) {
      natives.sort((a, b) => cmpVer(a.version, b.version));
      const best = natives.at(-1);
      return {
        path: best.exe,
        via: "vscode-native-highest",
        versionFolder: best.version,
        probe: probeVersion(best.exe),
        notes: [...notes, `selected highest of ${natives.length} vscode natives`],
        candidates: natives,
      };
    }
    return {
      path: null,
      via: "UNAVAILABLE",
      reason: "MULTIPLE_INCOMPARABLE_CLAUDE_NATIVES",
      notes,
      candidates: natives,
    };
  }

  const pathHits = pathCandidates("claude.exe");
  if (pathHits.length === 1) {
    return { path: pathHits[0], via: "PATH", probe: probeVersion(pathHits[0]), notes };
  }
  if (pathHits.length > 1) {
    return { path: null, via: "UNAVAILABLE", reason: "MULTIPLE_PATH_CLAUDE", candidates: pathHits, notes };
  }

  const local = join(homedir(), ".local", "bin", "claude.exe");
  if (isRealExe(local)) {
    return { path: local, via: "local-bin", probe: probeVersion(local), notes };
  }
  return { path: null, via: "UNAVAILABLE", reason: "NOT_FOUND", notes };
}

export function discoverGrok() {
  const notes = [];
  const configured = process.env.AION_GROK_PATH;
  if (configured) {
    if (isRealExe(configured)) {
      return { path: configured, via: "AION_GROK_PATH", probe: probeVersion(configured), notes };
    }
    notes.push(`AION_GROK_PATH set but not a real exe: ${configured}`);
  }
  const home = join(homedir(), ".grok", "bin", "grok.exe");
  if (isRealExe(home)) {
    return { path: home, via: "GROK_HOME", probe: probeVersion(home), notes };
  }
  const pathHits = pathCandidates("grok.exe");
  if (pathHits.length === 1) {
    return { path: pathHits[0], via: "PATH", probe: probeVersion(pathHits[0]), notes };
  }
  if (pathHits.length > 1) {
    return { path: null, via: "UNAVAILABLE", reason: "MULTIPLE_PATH_GROK", candidates: pathHits, notes };
  }
  return { path: null, via: "UNAVAILABLE", reason: "NOT_FOUND", notes };
}

export function discoverLocal() {
  const node = process.execPath;
  return {
    node: { path: node, probe: probeVersion(node) },
    git: pathCandidates("git.exe")[0] || null,
  };
}
