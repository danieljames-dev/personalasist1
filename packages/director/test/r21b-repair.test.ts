/**
 * Round 21b follow-up. Each case below must fail on
 * a2bf7dd066eb655be612942fdcef13652daf84a5 and pass after the matching
 * property fix. Helpers are local.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  argvGrantsWritePermission,
  executorArgvFor,
} from "../src/executor-adapters.js";
import {
  acquireDeveloperAgentWorktreeLease,
  createNodeLeaseStore,
} from "../src/lease-store.js";
import { createWindowsOrphanScanner } from "../src/process-identity.js";

const NOW = "2026-08-13T12:00:00.000Z";
const CWD = "C:\\wt";
const here = dirname(fileURLToPath(import.meta.url));

type ClaudeBridgeV1 = {
  describe(mode: "read-only" | "workspace-write"): { executable: string; args: readonly string[] };
  argvForMode?(mode: "read-only" | "workspace-write"): readonly string[];
  run(
    task: {
      repositoryRoot: string;
      instruction: string;
      mode: "read-only" | "workspace-write";
      directorMintedPermit?: { readonly leaseId: string };
    },
    signal: AbortSignal,
  ): Promise<{ exitCode: number; summary: string }>;
};

type ClaudeBridgeCtor = new (root: string, executable?: string) => ClaudeBridgeV1;

async function loadClaudeBridge(): Promise<ClaudeBridgeCtor> {
  const url = pathToFileURL(join(here, "..", "..", "..", "local-assistant", "dist", "developer-bridge.js")).href;
  const mod = await import(url) as { ClaudeCodeCliDeveloperAgentBridgeV1: ClaudeBridgeCtor };
  return mod.ClaudeCodeCliDeveloperAgentBridgeV1;
}

function permissionModeOf(argv: readonly string[]): string | undefined {
  const index = argv.indexOf("--permission-mode");
  return index >= 0 ? argv[index + 1] : undefined;
}

function adapterWriteToken(): string {
  const argv = executorArgvFor("claude", {
    promptPath: "C:\\wt\\PROMPT.md",
    cwd: CWD,
    role: "IMPLEMENT",
  });
  assert.ok(argv !== null, "claude IMPLEMENT adapter must emit argv");
  const token = permissionModeOf(argv);
  assert.equal(typeof token, "string", "adapter write argv must carry --permission-mode");
  return token as string;
}

function adapterReadToken(): string {
  const argv = executorArgvFor("grok", {
    promptPath: "C:\\wt\\PROMPT.md",
    cwd: CWD,
    role: "ADVERSARIAL_REVIEW",
  });
  assert.ok(argv !== null, "grok review adapter must emit argv");
  const token = permissionModeOf(argv);
  assert.equal(typeof token, "string", "adapter read-only argv must carry --permission-mode");
  return token as string;
}

function capturedOrphanScanScript(): string {
  let script = "";
  const scanner = createWindowsOrphanScanner({
    spawnSync: (_cmd, args) => {
      script = String(args[3] ?? "");
      return { status: 0, stdout: "{\"ok\":true,\"processes\":[],\"unreadable\":0}", stderr: "" };
    },
    waitSync: () => undefined,
  });
  scanner({
    runNonce: "nonce-r21b-script",
    createdNotBefore: "2026-08-13T12:00:00.000Z",
    holderPid: 4812,
    holderExitedAt: "2026-08-13T12:00:10.000Z",
  });
  return script;
}

// ---------------------------------------------------------------------------
// ITEM 1 — one predicate decides write authority
// ---------------------------------------------------------------------------

test("ITEM1 the Director predicate applied to the bridge's own read-only argv is false", async () => {
  const Bridge = await loadClaudeBridge();
  const root = mkdtempSync(join(tmpdir(), "aion-r21b-p4c-ro-"));
  try {
    const bridge = new Bridge(root, join(root, "claude.exe"));
    const argv = typeof bridge.argvForMode === "function"
      ? bridge.argvForMode("read-only")
      : bridge.describe("read-only").args;
    assert.ok(argv.length > 0, "read-only argv must be the bridge's own taskArgs, not an empty describe");
    assert.equal(
      argvGrantsWritePermission(argv),
      false,
      "the Director predicate must refuse write on the bridge's own read-only argv",
    );
    assert.equal(permissionModeOf(argv), adapterReadToken());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ITEM1 the bridge write token is the adapter token, not a literal written in the bridge", async () => {
  const Bridge = await loadClaudeBridge();
  const root = mkdtempSync(join(tmpdir(), "aion-r21b-p4c-w-"));
  try {
    const bridge = new Bridge(root, join(root, "claude.exe"));
    const argv = typeof bridge.argvForMode === "function"
      ? bridge.argvForMode("workspace-write")
      : bridge.describe("workspace-write").args;
    const adapterToken = adapterWriteToken();
    assert.equal(
      permissionModeOf(argv),
      adapterToken,
      "write token must be obtained from executorArgvFor, not typed into the bridge",
    );
    const srcUrl = join(here, "..", "..", "..", "local-assistant", "src", "developer-bridge.ts");
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(srcUrl, "utf8");
    assert.match(
      source,
      /adapterPermissionModeForRole|executorArgvFor/,
      "taskArgs must call the Director adapter; a coincidental matching literal is not sourcing",
    );
    assert.doesNotMatch(
      source,
      /["']acceptEdits["']/,
      "the unguarded path must not hold acceptEdits as a second vocabulary",
    );
    assert.doesNotMatch(
      source,
      /["']bypassPermissions["']/,
      "the write token must not be written in the bridge file",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ITEM1 read-only argv that grants write is refused before spawn", async () => {
  const Bridge = await loadClaudeBridge();
  const root = mkdtempSync(join(tmpdir(), "aion-r21b-p4c-evil-"));
  try {
    class GrantsWriteOnReadOnly extends (Bridge as unknown as new (root: string, exe?: string) => ClaudeBridgeV1) {
      protected taskArgs(): readonly string[] {
        return ["-p", "--permission-mode", adapterWriteToken()];
      }
      override describe(): { executable: string; args: readonly string[] } {
        return { executable: "claude.exe", args: this.taskArgs() };
      }
    }
    const bridge = new GrantsWriteOnReadOnly(root, join(root, "claude.exe"));
    const argv = (bridge as unknown as { taskArgs: () => readonly string[] }).taskArgs();
    assert.equal(argvGrantsWritePermission(argv), true);
    await assert.rejects(
      () => bridge.run(
        { repositoryRoot: root, instruction: "list the repository", mode: "read-only" },
        new AbortController().signal,
      ),
      /read-only argv grants write/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ITEM1 a write argv on a path holding no Director-minted permit is refused", async () => {
  const Bridge = await loadClaudeBridge();
  const root = mkdtempSync(join(tmpdir(), "aion-r21b-p4c-permit-"));
  try {
    const bridge = new Bridge(root, join(root, "claude.exe"));
    const argv = typeof bridge.argvForMode === "function"
      ? bridge.argvForMode("workspace-write")
      : bridge.describe("workspace-write").args;
    assert.equal(argvGrantsWritePermission(argv), true, "workspace-write argv must be a write argv");
    await assert.rejects(
      () => bridge.run(
        { repositoryRoot: root, instruction: "edit one file", mode: "workspace-write" },
        new AbortController().signal,
      ),
      /no Director-minted permit/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ITEM 2 — image basename is not a negative fact
// ---------------------------------------------------------------------------

test("ITEM2 a nonce-tied WmiPrvSE.exe born inside the five-second shadow is not dropped", () => {
  const script = capturedOrphanScanScript();
  const start = script.indexOf("foreach ($c in $candidates)");
  const end = script.indexOf("$directorSessionId");
  assert.ok(start >= 0 && end > start, "scan script must contain the candidate membership loop");
  const loop = script.slice(start, end);
  assert.doesNotMatch(
    loop,
    /\$c\.name\s+-and\s+\$c\.name\s+-ieq\s+'WmiPrvSE\.exe'/,
    "an image basename must not exclude a row before the membership test",
  );

  const nonce = "nonce-r21b-wmiprvse-tied";
  const harness = [
    "$candidates = New-Object System.Collections.Generic.List[object];",
    "[void]$candidates.Add([ordered]@{ pid = 71928; name = 'WmiPrvSE.exe'; creationDate = ([datetime]::UtcNow).ToString('o'); parentPid = 4; parentPresent = $true; parentName = 'svchost.exe'; parentCreationDate = $null; executablePath = $null; isDesc = $true; commandLine = 'AION_RUN_NONCE=" + nonce + "'; sessionId = 0 });",
    "$scannerPid = -1;",
    "$scanStartedUtc = [datetime]::UtcNow;",
    "$pebCap = 64;",
    "$pebUsed = 0;",
    "$pebCapped = $false;",
    "$hits = New-Object System.Collections.Generic.List[object];",
    "$unreadable = 0;",
    loop,
    "$hits | ConvertTo-Json -Compress -Depth 5;",
  ].join("\n");

  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", harness], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  assert.equal(result.status, 0, `filter replay failed: ${result.stderr}\n${result.stdout}`);
  const parsed = JSON.parse(String(result.stdout ?? "").trim()) as { pid?: number } | ReadonlyArray<{ pid?: number }>;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  assert.equal(
    rows.some((row) => row.pid === 71928),
    true,
    `positively-tied WmiPrvSE.exe must remain a candidate; hits=${String(result.stdout)}`,
  );
});

// ---------------------------------------------------------------------------
// ITEM 3 — caller-supplied runId is not acquireLease identity
// ---------------------------------------------------------------------------

test("ITEM3 two concurrent developer-agent acquires with the same explicit runId refuse the second", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-r21b-lease-"));
  try {
    const store = createNodeLeaseStore(root, { hostArbitrationRoot: join(root, "arb") });
    const first = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: CWD,
      now: NOW,
      store,
      runId: "caller-constant",
    });
    const second = acquireDeveloperAgentWorktreeLease({
      repositoryRoot: CWD,
      now: NOW,
      store,
      runId: "caller-constant",
    });
    assert.equal(first.ok, true, !first.ok ? first.reason : "");
    assert.equal(second.ok, false, "a caller-supplied runId must not adopt the first invocation's row");
    if (!second.ok) assert.match(second.reason, /another run holds this|already/i);
    if (first.ok) {
      assert.notEqual(first.lease.runId, "caller-constant");
      assert.match(first.lease.runId, /^dev-agent-\d+-\d+$/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
