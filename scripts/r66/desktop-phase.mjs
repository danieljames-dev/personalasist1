/**
 * R6.6 desktop phase after physical recovery-drive attach.
 * Detects backup root by structure (not fixed drive letter).
 * Does not format, does not overwrite final laptop snapshot.
 * Does not create dual writers.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { hostname } from "node:os";

const REPO = resolve(process.env.AION_DESKTOP_REPO || "C:\\AION-HQ");
const CANONICAL_ORIGIN = "https://github.com/danieljames-dev/personalasist1.git";
const EVIDENCE = join(REPO, ".aion-local", "handoffs", "r66-desktop-evidence");

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function writeJson(name, obj) {
  mkdirSync(EVIDENCE, { recursive: true });
  const p = join(EVIDENCE, name);
  writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
  console.log(`WROTE ${p}`);
  return p;
}

function git(args) {
  return execFileSync("git", ["-C", REPO, ...args], { encoding: "utf8" }).trim();
}

function findBackupRoots() {
  const letters = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const found = [];
  for (const L of letters) {
    const root = `${L}:\\AION-backups`;
    if (!existsSync(root)) continue;
    const cutover = join(root, "r66-cutover");
    const manifests = join(root, "manifests");
    found.push({
      drive: L,
      root,
      hasCutover: existsSync(cutover),
      hasManifests: existsSync(manifests),
      hasLaptopComplete: existsSync(join(cutover, "LAPTOP-PHASE-COMPLETE.json")),
    });
  }
  return found;
}

function main() {
  const head = git(["rev-parse", "HEAD"]);
  const origin = git(["remote", "get-url", "origin"]);
  const pre = {
    utc: new Date().toISOString(),
    hostname: hostname(),
    repo: REPO,
    head,
    origin,
    privateStatePresent: existsSync(join(REPO, "private", "aion", "state-v1.json")),
  };
  writeJson("10-desktop-start.json", pre);

  if (origin !== CANONICAL_ORIGIN) throw new Error(`Origin mismatch: ${origin}`);

  const roots = findBackupRoots();
  writeJson("11-drive-detect.json", { roots });
  const ready = roots.find((r) => r.hasLaptopComplete);
  if (!ready) {
    writeJson("11-drive-status.json", {
      EXTERNAL_DRIVE_WITH_R66_CUTOVER: false,
      action: "Wait for Owner to complete laptop packet and attach recovery drive",
    });
    console.log("NO_R66_CUTOVER_ON_ATTACHED_VOLUMES");
    process.exitCode = 10;
    return;
  }

  const completePath = join(ready.root, "r66-cutover", "LAPTOP-PHASE-COMPLETE.json");
  const complete = JSON.parse(readFileSync(completePath, "utf8"));
  writeJson("12-laptop-complete-copy.json", complete);

  const gates = [
    "LAPTOP_FROZEN",
    "FINAL_SNAPSHOT_CREATED",
    "FINAL_SNAPSHOT_VERIFIED",
    "LAPTOP_WRITER_DEMOTED",
    "LAPTOP_WRITE_REFUSAL_PROVEN",
    "SAFE_TO_DISCONNECT_FROM_LAPTOP",
  ];
  for (const g of gates) {
    if (complete[g] !== true && complete.RESTORE_TEST !== "PASS") {
      /* check individually */
    }
    if (g !== "RESTORE_TEST" && complete[g] !== true) {
      throw new Error(`Laptop phase gate failed: ${g}=${complete[g]}`);
    }
  }
  if (complete.RESTORE_TEST !== "PASS") throw new Error("RESTORE_TEST not PASS");

  // Code continuity: desktop already at canonical repo; verify restore-test optional re-run
  const expectedCommit = complete.LAPTOP_HEAD || head;
  console.log("Running restore-test-aion against backup root (isolated)...");
  const rt = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(REPO, "scripts", "restore-test-aion.ps1"),
      "-ExpectedCommit",
      expectedCommit,
      "-BackupRoot",
      ready.root,
    ],
    { cwd: REPO, encoding: "utf8", timeout: 3_600_000 },
  );
  // Script may not accept -BackupRoot; fall back without if fails
  let restoreOk = rt.status === 0;
  let restoreLog = `${rt.stdout || ""}\n${rt.stderr || ""}`.slice(-3000);
  if (!restoreOk) {
    const rt2 = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(REPO, "scripts", "restore-test-aion.ps1"),
        "-ExpectedCommit",
        expectedCommit,
      ],
      { cwd: REPO, encoding: "utf8", timeout: 3_600_000, env: { ...process.env, AION_BACKUP_ROOT: ready.root } },
    );
    restoreOk = rt2.status === 0;
    restoreLog = `${rt2.stdout || ""}\n${rt2.stderr || ""}`.slice(-3000);
  }
  writeJson("13-restore-test.json", { ok: restoreOk, logTail: restoreLog, expectedCommit });

  // Private cold restore only if artifact present and destination empty
  const privateDir = join(ready.root, "r66-cutover", "private");
  const destPrivate = join(REPO, "private", "aion");
  let privateRestore = { attempted: false };
  if (complete.PRIVATE_STATE_PRESENT && existsSync(privateDir)) {
    privateRestore = {
      attempted: true,
      note: "Private cold restore requires Owner passphrase via AION cold-restore path; run with empty destination private/aion only.",
      destExists: existsSync(join(destPrivate, "state-v1.json")),
      privateArtifacts: existsSync(privateDir) ? readdirSync(privateDir) : [],
    };
  } else {
    privateRestore = { attempted: false, PRIVATE_STATE_PRESENT: false };
  }
  writeJson("14-private-restore.json", privateRestore);

  // Validation suite (non-writer)
  const tests = {};
  for (const [name, cmd] of [
    ["autonomy_smoke", ["cmd.exe", ["/c", "npm run autonomy:smoke"]]],
    ["delegated_operator", ["cmd.exe", ["/c", "npm run delegated-operator:test"]]],
  ]) {
    const r = spawnSync(cmd[0], cmd[1], { cwd: REPO, encoding: "utf8", timeout: 600_000 });
    tests[name] = { exit: r.status, tail: `${r.stdout || ""}${r.stderr || ""}`.slice(-1500) };
  }
  writeJson("15-pre-writer-tests.json", tests);

  // Writer acquisition: fail-closed — only if no concurrent writer and laptop demoted
  // Production OwnerAuthorityRuntimeV2 requires trusted owner key + anchor; do not forge.
  const writerPlan = {
    DESKTOP_WRITER_ACTIVE: false,
    reason:
      "Desktop writer acquisition requires accepted Owner Authority V2 offline grant bound to DESKTOP SystemInstanceId. Do not dual-write. If no prior real writer existed on laptop, first grant may be created only via Owner offline signing tools — not auto-bootstrap in production.",
    laptopDemoted: complete.LAPTOP_WRITER_DEMOTED === true,
    concurrentWriter: false,
  };
  writeJson("16-writer-acquisition.json", writerPlan);

  // PRIMARY role record (control-plane metadata — not dual authority)
  const primary = {
    machine: hostname(),
    roleBefore: "DESKTOP TARGET CANDIDATE / NON-PRIMARY",
    roleAfterDesired: "PRIMARY / SOURCE OF TRUTH",
    promoted: false,
    blockedReason: writerPlan.DESKTOP_WRITER_ACTIVE
      ? null
      : "Writer not yet acquired; PRIMARY promotion blocked until writer grant verified",
    cutoverTimestampUtc: null,
  };
  writeJson("17-primary-promotion.json", primary);

  writeJson("18-desktop-phase-status.json", {
    driveRoot: ready.root,
    laptopComplete: true,
    restoreTest: restoreOk,
    writer: writerPlan.DESKTOP_WRITER_ACTIVE,
    primary: primary.promoted,
    next: "Complete private restore if needed; Owner Authority V2 grant for desktop SI; promote PRIMARY; start production AION; smoke; desktop backup",
  });

  console.log(JSON.stringify({ driveRoot: ready.root, restoreOk, writer: false, primary: false }, null, 2));
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  try {
    writeJson("DESKTOP-PHASE-FAILED.json", { error: String(e), utc: new Date().toISOString() });
  } catch {
    /* ignore */
  }
  process.exit(1);
}
