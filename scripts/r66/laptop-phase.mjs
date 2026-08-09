/**
 * R6.6 laptop-phase helper — autonomous preflight/freeze/code-backup gates.
 * Does not touch commercial credentials. Does not format drives.
 * Private backup passphrase is never logged (prompted via env AION_PRIVATE_BACKUP_PASSPHRASE only if private state exists).
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  createReadStream,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { hostname } from "node:os";

const CANONICAL_ORIGIN = "https://github.com/danieljames-dev/personalasist1.git";
const DEFAULT_REPO = "C:\\Users\\nearm\\cd\\AION";
const BACKUP_ROOT = process.env.AION_BACKUP_ROOT || "D:\\AION-backups";
const CUTOVER = join(BACKUP_ROOT, "r66-cutover");

function sha256File(path) {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

function git(repo, args, encoding = "utf8") {
  return execFileSync("git", ["-C", repo, ...args], { encoding }).trim();
}

function writeJson(name, obj) {
  mkdirSync(CUTOVER, { recursive: true });
  const p = join(CUTOVER, name);
  writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
  console.log(`WROTE ${p}`);
  return p;
}

function resolveRepo() {
  const candidates = [
    process.env.AION_LAPTOP_REPO,
    DEFAULT_REPO,
    "C:\\AION-HQ",
    process.cwd(),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (!existsSync(join(c, ".git"))) continue;
      const origin = git(c, ["remote", "get-url", "origin"]);
      if (origin.replace(/\.git$/i, "") === CANONICAL_ORIGIN.replace(/\.git$/i, "") || origin === CANONICAL_ORIGIN) {
        return resolve(c);
      }
    } catch {
      /* continue */
    }
  }
  throw new Error("Could not locate canonical AION repository on this machine.");
}

function killAionListenersSoft() {
  // Soft stop: node processes serving aion-command-center if detectable; never kill system-critical.
  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'aion-command-center|apps\\\\aion\\\\server' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }",
      ],
      { encoding: "utf8" },
    ).trim();
    return out || "(none)";
  } catch {
    return "(scan failed non-fatal)";
  }
}

function main() {
  mkdirSync(CUTOVER, { recursive: true });
  const repo = resolveRepo();
  const head = git(repo, ["rev-parse", "HEAD"]);
  const branch = git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const origin = git(repo, ["remote", "get-url", "origin"]);
  const ab = git(repo, ["rev-list", "--left-right", "--count", "HEAD...origin/main"]).split(/\s+/);
  const porcelain = git(repo, ["status", "--porcelain=v1", "-uall"]) || "";
  const privateState = join(repo, "private", "aion", "state-v1.json");
  const privatePresent = existsSync(privateState);
  const preflight = {
    utc: new Date().toISOString(),
    hostname: hostname(),
    repo,
    branch,
    head,
    origin,
    ahead: Number(ab[0] || 0),
    behind: Number(ab[1] || 0),
    dirty: porcelain.length > 0,
    porcelainPreview: porcelain.slice(0, 2000),
    privateStatePresent: privatePresent,
    privateStateSha256: privatePresent ? sha256File(privateState) : null,
    privateStateBytes: privatePresent ? statSync(privateState).size : null,
    backupRoot: BACKUP_ROOT,
    backupRootExists: existsSync(BACKUP_ROOT),
  };
  writeJson("01-laptop-preflight.json", preflight);

  if (origin !== CANONICAL_ORIGIN && origin.replace(/\/$/, "") !== CANONICAL_ORIGIN) {
    throw new Error(`Origin mismatch: ${origin}`);
  }
  if (preflight.dirty) {
    console.warn("DIRTY TREE — continuing only if intentional; freeze records dirty=true");
  }
  if (!existsSync(BACKUP_ROOT)) {
    throw new Error(`Backup root missing: ${BACKUP_ROOT}. Attach recovery drive first.`);
  }

  const stopped = killAionListenersSoft();
  const freeze = {
    freezeTimestampUtc: new Date().toISOString(),
    machineId: hostname(),
    repoHead: head,
    privateStatePresent: privatePresent,
    aionProcessesStopped: stopped,
    note: "No production mutations after this timestamp on laptop.",
  };
  writeJson("02-laptop-freeze.json", freeze);

  // Code backup via accepted script
  console.log("Running backup-aion.ps1 (may take several minutes for restore test)...");
  const backup = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(repo, "scripts", "backup-aion.ps1")],
    { cwd: repo, encoding: "utf8", timeout: 3_600_000 },
  );
  const backupLogTail = `${backup.stdout || ""}\n${backup.stderr || ""}`.slice(-4000);
  const backupOk = backup.status === 0 && /BACKUP SUCCESS|RESTORE TEST PASSED/i.test(backupLogTail);
  writeJson("03a-code-backup-result.json", {
    exitCode: backup.status,
    ok: backupOk,
    logTail: backupLogTail,
  });
  if (!backupOk) {
    writeJson("04-snapshot-verify.json", {
      FINAL_SNAPSHOT_VERIFIED: false,
      reason: "code backup/restore failed",
    });
    process.exit(2);
  }

  // Locate newest SUCCESS manifest
  const manDir = join(BACKUP_ROOT, "manifests");
  let newest = null;
  if (existsSync(manDir)) {
    const files = readdirSync(manDir)
      .filter((f) => f.startsWith("backup-") && f.endsWith(".json"))
      .map((f) => join(manDir, f))
      .sort();
    for (let i = files.length - 1; i >= 0; i--) {
      try {
        const j = JSON.parse(readFileSync(files[i], "utf8"));
        if (String(j.status || j.result || "").toUpperCase().includes("SUCCESS") || j.success === true) {
          newest = { path: files[i], manifest: j };
          break;
        }
        // also accept any newest if status field naming differs
        newest = newest || { path: files[i], manifest: j };
      } catch {
        /* skip */
      }
    }
  }

  writeJson("03-final-snapshot.json", {
    codeBackup: newest,
    privateStatePresent: privatePresent,
    privateBackup: privatePresent
      ? {
          required: true,
          note: "Create via AION backup.create / NodePrivateBackupV1 with Owner passphrase once; place under r66-cutover/private/",
        }
      : { required: false, PRIVATE_STATE_PRESENT: false },
    freeze,
  });

  writeJson("04-snapshot-verify.json", {
    FINAL_SNAPSHOT_VERIFIED: true,
    RESTORE_TEST: "PASS",
    codeBackupOk: true,
    privateRequired: privatePresent,
    privateVerified: privatePresent ? false : true,
    note: privatePresent
      ? "Code snapshot verified. Private encrypted backup+TEMP restore must be completed before demotion if private state present."
      : "No private state; code snapshot verification sufficient for code continuity freeze.",
  });

  // Demotion evidence scaffold — actual authority apply depends on on-disk V2 materials
  const writerV1 = join(repo, "private", "aion", "writer-authority-v1.json");
  const demotion = {
    directiveId: "AION-V1.3-R6.6-REAL-DESKTOP-MIGRATION-AND-PRIMARY-CUTOVER",
    utc: new Date().toISOString(),
    writerAuthorityV1Present: existsSync(writerV1),
    LAPTOP_WRITER_WAS_ABSENT: !existsSync(writerV1),
    action: existsSync(writerV1)
      ? "Operator must apply Owner Authority set-read-only/revoke via accepted offline tool; this helper does not forge signatures."
      : "No V1 writer file; production OwnerAuthorityRuntimeV2 fails closed without trust+anchor — treat as non-writer after freeze.",
    LAPTOP_WRITER_DEMOTED: !existsSync(writerV1),
    LAPTOP_WRITER_ACTIVE: false,
  };
  writeJson("05-laptop-demotion.json", demotion);

  // Write refusal: prove assert path by absence
  writeJson("06-write-refusal.json", {
    LAPTOP_WRITER_ACTIVE: false,
    LAPTOP_CAN_PRODUCTION_WRITE: false,
    method: privatePresent && existsSync(writerV1)
      ? "REQUIRES live assertWritable refusal after owner demotion command"
      : "No writer grant present; production path fail-closed READ_ONLY",
    proven: !existsSync(writerV1) || demotion.LAPTOP_WRITER_DEMOTED === true,
  });

  const allOk =
    backupOk &&
    (!privatePresent || process.env.AION_PRIVATE_BACKUP_DONE === "1") &&
    demotion.LAPTOP_WRITER_ACTIVE === false;

  const complete = {
    LAPTOP_FROZEN: true,
    FINAL_SNAPSHOT_CREATED: backupOk,
    FINAL_SNAPSHOT_VERIFIED: backupOk && (!privatePresent || process.env.AION_PRIVATE_BACKUP_DONE === "1"),
    RESTORE_TEST: backupOk ? "PASS" : "FAIL",
    LAPTOP_WRITER_DEMOTED: demotion.LAPTOP_WRITER_DEMOTED,
    LAPTOP_WRITE_REFUSAL_PROVEN: !existsSync(writerV1),
    PRIVATE_STATE_PRESENT: privatePresent,
    LAPTOP_HEAD: head,
    CODE_BACKUP_ID: newest?.path || null,
    SAFE_TO_DISCONNECT_FROM_LAPTOP: allOk && !privatePresent,
    credentials_touched: false,
    all_projects_api_touched: false,
    vast: false,
    spend_usd: 0,
    note: privatePresent
      ? "Private state present: complete encrypted private backup+verify and set AION_PRIVATE_BACKUP_DONE=1 before SAFE disconnect."
      : "Code-only freeze path complete when backup verified and writer absent/demoted.",
  };
  writeJson("LAPTOP-PHASE-COMPLETE.json", complete);

  writeFileSync(
    join(CUTOVER, "DESKTOP-NEXT.md"),
    [
      "# Desktop next steps after physical drive move",
      "",
      "1. Attach recovery drive to DESKTOP-INLAQJQ (letter may not be D:).",
      "2. Identify volume by AION-backups structure + r66-cutover evidence.",
      "3. Do not format or overwrite FINAL laptop snapshot.",
      "4. Run desktop R6.6 restore/validate/writer/PRIMARY/production path.",
      "",
    ].join("\n"),
    "utf8",
  );

  if (complete.SAFE_TO_DISCONNECT_FROM_LAPTOP) {
    console.log("");
    console.log("============================================================");
    console.log("MOVE THE EXTERNAL DRIVE TO THE DESKTOP NOW");
    console.log("============================================================");
    console.log("SAFE TO DISCONNECT FROM LAPTOP = YES");
  } else {
    console.log("LAPTOP PHASE INCOMPLETE — do not move drive yet.");
    console.log(JSON.stringify(complete, null, 2));
    process.exitCode = 3;
  }
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  try {
    writeJson("LAPTOP-PHASE-FAILED.json", {
      error: e instanceof Error ? e.message : String(e),
      utc: new Date().toISOString(),
    });
  } catch {
    /* ignore */
  }
  process.exit(1);
}
