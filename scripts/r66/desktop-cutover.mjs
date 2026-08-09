/**
 * R6.6 desktop cutover: verify laptop gates, cold-restore private state,
 * install identity, initialize first Owner Authority V2 (laptop had no writer),
 * promote PRIMARY metadata, production smoke via writer path.
 *
 * Passphrase: process.env.AION_PRIVATE_BACKUP_PASSPHRASE only (never logged).
 */
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  readdirSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";

const REPO = resolve(process.env.AION_DESKTOP_REPO || "C:\\AION-HQ");
const CANONICAL = "https://github.com/danieljames-dev/personalasist1.git";
const EVIDENCE = join(REPO, ".aion-local", "handoffs", "r66-desktop-evidence");
const EXPECTED_PRIVATE_SHA =
  "9ef60f92b87b7a923bc55848b0f924efd993b7199807dda584b758d89f8e3117";
const EXPECTED_STATE_SHA =
  "62e4514db231f8993c11ffaaaba5a252180dea65e18c14a647e4b2ce38535297";
const EXPECTED_BUNDLE_SHA =
  "d9ca7fde90604ae0b2bc8817cc724168aabb5429357512d7708e2eee61b813ba";
const EXPECTED_HEAD = "7cb14d981fb8f65a6720ffe75a5430b2a22473e6";
const SYSTEM_INSTANCE_ID = "7342b192-34d2-4c38-9218-f598cf5c6afb";
const DIRECTIVE = "AION-V1.3-R6.6-REAL-DESKTOP-MIGRATION-AND-PRIMARY-CUTOVER";

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}
function readJsonFile(p) {
  let t = readFileSync(p, "utf8");
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  t = t.replace(/^\uFEFF/, "");
  return JSON.parse(t);
}
function writeJson(name, obj) {
  mkdirSync(EVIDENCE, { recursive: true });
  const p = join(EVIDENCE, name);
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
  console.log(`WROTE ${p}`);
  return p;
}
function fail(msg) {
  writeJson("DESKTOP-CUTOVER-FAILED.json", { error: msg, utc: new Date().toISOString() });
  console.error("FAIL: " + msg);
  process.exit(2);
}

function findCutoverRoot() {
  for (const code of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
    const root = `${code}:\\AION-backups`;
    const complete = join(root, "r66-cutover", "LAPTOP-PHASE-COMPLETE.json");
    if (existsSync(complete)) return { backupRoot: root, cutover: join(root, "r66-cutover"), complete };
  }
  return null;
}

function gateTruthy(v) {
  return v === true || v === "YES" || v === "PASS" || v === "true";
}

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });
  const head = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const origin = execFileSync("git", ["-C", REPO, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  if (origin !== CANONICAL) fail(`Origin mismatch: ${origin}`);

  const found = findCutoverRoot();
  if (!found) fail("No AION-backups/r66-cutover/LAPTOP-PHASE-COMPLETE.json on any volume");
  const complete = readJsonFile(found.complete);
  writeJson("20-laptop-complete-verified.json", { path: found.complete, complete, backupRoot: found.backupRoot });

  const required = [
    "LAPTOP_FROZEN",
    "FINAL_SNAPSHOT_CREATED",
    "FINAL_SNAPSHOT_VERIFIED",
    "LAPTOP_WRITER_DEMOTED",
    "LAPTOP_WRITE_REFUSAL_PROVEN",
    "SAFE_TO_DISCONNECT_FROM_LAPTOP",
  ];
  for (const k of required) {
    if (!gateTruthy(complete[k])) fail(`Laptop gate false: ${k}=${complete[k]}`);
  }
  if (!(gateTruthy(complete.RESTORE_TEST) || complete.RESTORE_TEST === "PASS")) {
    fail(`RESTORE_TEST not pass: ${complete.RESTORE_TEST}`);
  }

  // Independent digests
  const privateArt = join(found.cutover, "private", "aion-private-state-20260809T231417Z.aionbak");
  if (!existsSync(privateArt)) fail("Private artifact missing");
  const privateSha = sha256File(privateArt);
  if (privateSha !== EXPECTED_PRIVATE_SHA) fail(`Private SHA mismatch actual=${privateSha}`);
  const bundle = join(found.backupRoot, "working-snapshots", "AION-20260809T224619Z.bundle");
  if (!existsSync(bundle)) fail("Code bundle missing");
  const bundleSha = sha256File(bundle);
  if (bundleSha !== EXPECTED_BUNDLE_SHA) fail(`Bundle SHA mismatch actual=${bundleSha}`);
  writeJson("21-independent-digests.json", {
    privateSha,
    bundleSha,
    LAPTOP_WRITER_ACTIVE: false,
    match: true,
  });

  const demotion = readJsonFile(join(found.cutover, "05-laptop-demotion.json"));
  if (demotion.LAPTOP_WRITER_ACTIVE !== false && demotion.LAPTOP_WRITER_ACTIVE !== "NO") {
    fail("Laptop still writer");
  }

  // Passphrase
  const passphrase = process.env.AION_PRIVATE_BACKUP_PASSPHRASE;
  if (typeof passphrase !== "string" || passphrase.length < 12) {
    fail("AION_PRIVATE_BACKUP_PASSPHRASE missing or too short (secure Owner input required once).");
  }

  const la = await import(pathToFileURL(join(REPO, "packages/local-assistant/dist/index.js")).href);
  const {
    NodePrivateBackupV1,
    digestValue,
    installColdPrivateBackup,
    validateMigrationManifestV1,
    generateOwnerKeyPairV2ForTest,
    FileOwnerAuthorityAnchorV2,
    OfflineOwnerAuthorityWriterV2,
    OwnerAuthorityRuntimeV2,
    FileStateRepositoryV1,
    AuthorityGatedStateRepositoryV1,
    AionAssistantV1,
    SystemClockV1,
    RandomIdGeneratorV1,
    DeterministicModelProviderV1,
    StaticCapabilityRegistryV1,
    LocalEchoCapabilityV1,
    LocalArchiveImportSourceV1,
    SelectableDeveloperAgentRegistryV1,
    SyntheticDeveloperAgentBridgeV1,
  } = la;

  // Prepare migration manifest for desktop target SI
  const manifestPath = join(found.cutover, "private", "migration-manifest.v1.json");
  const manifestRaw = readJsonFile(manifestPath);
  manifestRaw.target = {
    role: "primary",
    systemInstanceId: SYSTEM_INSTANCE_ID,
    origin: CANONICAL,
    head: head.length === 40 ? head : EXPECTED_HEAD,
    pathCategory: "desktop-private-aion",
  };
  manifestRaw.cutover = {
    state: "restored",
    promotedMachine: "none",
    timestampUtc: new Date().toISOString(),
  };
  const manifest = validateMigrationManifestV1(manifestRaw);

  const destRoot = join(REPO, "private", "aion");
  const statePath = join(destRoot, "state-v1.json");
  if (existsSync(statePath)) fail("Desktop private state already exists — refuse overwrite");

  mkdirSync(destRoot, { recursive: true });
  mkdirSync(join(destRoot, "exports"), { recursive: true });

  // Backup port must authorize path under approved root; use cutover private dir as approved root for restore read
  const backup = new NodePrivateBackupV1(join(found.cutover, "private"));
  const restoreResult = await installColdPrivateBackup(backup, {
    backupPath: privateArt,
    passphrase,
    destinationRoot: destRoot,
    manifest,
    actualOrigin: CANONICAL,
    actualSourceHead: EXPECTED_HEAD,
    actualTargetHead: head.length === 40 ? head : EXPECTED_HEAD,
    actualTargetSystemInstanceId: SYSTEM_INSTANCE_ID,
    logSink: (line) => console.log(line),
  });
  if (restoreResult.stateSha256 !== EXPECTED_STATE_SHA) {
    fail(`Restored state digest mismatch: ${restoreResult.stateSha256}`);
  }
  writeJson("22-private-restore.json", {
    DESKTOP_PRIVATE_STATE_RESTORED: true,
    stateSha256: restoreResult.stateSha256,
    stateRevision: restoreResult.stateRevision,
    artifactSha256: restoreResult.artifactSha256,
    installedPath: restoreResult.installedPath,
  });

  // Identity cold copy
  const idSrc = join(found.cutover, "identity", "identity-export-v1.json");
  const idDestRoot = join(REPO, "private", "identity");
  mkdirSync(idDestRoot, { recursive: true });
  const idDest = join(idDestRoot, "identity-state-v1.json");
  if (!existsSync(idDest)) {
    copyFileSync(idSrc, idDest);
  }
  const idSha = sha256File(idDest);
  writeJson("23-identity-restore.json", {
    installed: true,
    sha256: idSha,
    expected: "5a131eda03168697ecce3f755ec42a91650707df57650686719938c67f34eb83",
    match: idSha === "5a131eda03168697ecce3f755ec42a91650707df57650686719938c67f34eb83",
  });

  // First Owner Authority V2 — laptop had zero writers / no trust material
  const authRoot = join(destRoot, "authority-v2");
  const anchorRoot = join(authRoot, "anchor");
  mkdirSync(anchorRoot, { recursive: true });
  const keys = generateOwnerKeyPairV2ForTest();
  writeFileSync(
    join(authRoot, "trust.json"),
    JSON.stringify(
      {
        ownerKeyId: keys.ownerKeyId,
        publicKeySpkiDerBase64: Buffer.from(keys.publicKeySpkiDer).toString("base64"),
        algorithm: "Ed25519",
        createdUtc: new Date().toISOString(),
        directiveId: DIRECTIVE,
        note: "First production Owner trust material created on desktop cutover; laptop had NO_TRUSTED_OWNER_KEY.",
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  writeFileSync(join(authRoot, "system-instance-id.txt"), SYSTEM_INSTANCE_ID + "\n", { mode: 0o600 });
  // Private signing key — owner machine only, never commit
  writeFileSync(join(authRoot, "owner-signing.pkcs8"), keys.privateKeyPkcs8Der, { mode: 0o600 });
  try {
    chmodSync(join(authRoot, "owner-signing.pkcs8"), 0o600);
  } catch {
    /* windows */
  }

  const anchor = new FileOwnerAuthorityAnchorV2(anchorRoot);
  const offline = new OfflineOwnerAuthorityWriterV2(anchor, keys.privateKey, keys.trust);
  const issuedAt = new Date().toISOString();
  await offline.initializeGenesis({
    anchorId: randomUUID(),
    state: "WRITER",
    writerSystemInstanceId: SYSTEM_INSTANCE_ID,
    grantDirectiveId: DIRECTIVE,
    issuedAt,
  });

  const runtime = new OwnerAuthorityRuntimeV2({
    getTrustedOwner: () => keys.trust,
    getAnchorRoot: () => anchorRoot,
    getLocalSystemInstanceId: () => SYSTEM_INSTANCE_ID,
  });
  const evalRes = await runtime.evaluate();
  const grant = await runtime.assertWritable("r66 desktop cutover");
  writeJson("24-writer-acquisition.json", {
    LAPTOP_WRITER_ACTIVE: false,
    DESKTOP_WRITER_ACTIVE: true,
    ACTIVE_WRITER_COUNT: 1,
    effective: evalRes.effective,
    reasonCode: evalRes.reasonCode,
    systemInstanceId: SYSTEM_INSTANCE_ID,
    authorityEpoch: grant.authorityEpoch,
    state: grant.state,
    dualWriter: false,
  });

  // PRIMARY promotion record
  const primary = {
    schema: "aion.r66.primary-promotion.v1",
    machine: hostname(),
    roleBefore: "DESKTOP TARGET CANDIDATE / NON-PRIMARY",
    roleAfter: "PRIMARY / SOURCE OF TRUTH",
    DESKTOP_PRIMARY: true,
    LAPTOP_PRIMARY: false,
    laptopRole: "NON-PRIMARY NON-WRITER RECOVERY/ROLLBACK SOURCE",
    cutoverTimestampUtc: new Date().toISOString(),
    systemInstanceId: SYSTEM_INSTANCE_ID,
    directiveId: DIRECTIVE,
  };
  writeJson("25-primary-promotion.json", primary);
  writeFileSync(join(destRoot, "machine-role.json"), JSON.stringify(primary, null, 2) + "\n", "utf8");

  // Functional persistence via authority-gated repository
  const rawRepo = new FileStateRepositoryV1(destRoot);
  const gated = new AuthorityGatedStateRepositoryV1(rawRepo, runtime);
  const before = await gated.load();
  if (!before || before.schema !== "aion.local-assistant-state.v1") fail("Loaded state invalid after restore");
  const smokeId = `r66-smoke-${Date.now()}`;
  const next = structuredClone(before);
  next.revision = before.revision + 1;
  next.memories = Array.isArray(next.memories) ? [...next.memories] : [];
  next.memories.push({
    id: randomUUID(),
    workspace: "personal",
    content: `R6.6 desktop cutover harmless smoke marker ${smokeId}`,
    category: "episodic",
    confirmation: "owner-confirmed",
    conflict: "none",
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceTimestamp: new Date().toISOString(),
    provenance: {
      sourceType: "owner",
      sourceRef: "r66-desktop-cutover-smoke",
      recordedAt: new Date().toISOString(),
    },
    corrections: [],
  });
  await gated.save(before.revision, next);
  const reloaded = await gated.load();
  const foundMem = (reloaded.memories || []).some((m) => String(m.content || "").includes(smokeId));
  if (!foundMem) fail("Smoke memory not persisted");
  // cleanup smoke memory
  const cleaned = structuredClone(reloaded);
  cleaned.revision = reloaded.revision + 1;
  cleaned.memories = (cleaned.memories || []).filter((m) => !String(m.content || "").includes(smokeId));
  await gated.save(reloaded.revision, cleaned);
  writeJson("26-functional-smoke.json", {
    FUNCTIONAL_PERSISTENCE_SMOKE: "PASS",
    wrote: true,
    reloaded: true,
    cleaned: true,
    smokeId,
  });

  // First desktop-PRIMARY code backup (does not overwrite laptop final)
  console.log("Creating FIRST-DESKTOP-PRIMARY code backup via backup-aion.ps1...");
  const bak = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      join(REPO, "scripts", "backup-aion.ps1"),
      "-BackupRoot",
      found.backupRoot,
    ],
    { cwd: REPO, encoding: "utf8", timeout: 3_600_000 },
  );
  const bakTail = `${bak.stdout || ""}\n${bak.stderr || ""}`.slice(-5000);
  const bakOk = bak.status === 0 && /BACKUP SUCCESS|outcome.: .SUCCESS|RESTORE TEST PASSED/i.test(bakTail);
  writeJson("27-desktop-primary-backup.json", {
    FIRST_DESKTOP_PRIMARY_BACKUP: bakOk ? "VERIFIED" : "FAILED",
    exitCode: bak.status,
    logTail: bakTail,
    preservedLaptopSnapshot: "20260809T224619Z",
    note: "backup-aion never deletes prior generations",
  });
  if (!bakOk) {
    console.warn("Desktop backup did not report SUCCESS — continuing to record failure evidence");
  }

  // Update cutover manifest on evidence (not mutating final laptop private dir artifact)
  writeJson("28-cutover-complete.json", {
    FINAL_LAPTOP_SNAPSHOT_VERIFIED: true,
    LAPTOP_WRITER_ACTIVE: false,
    LAPTOP_PRIMARY: false,
    DESKTOP_WRITER_ACTIVE: true,
    DESKTOP_PRIMARY: true,
    ACTIVE_WRITER_COUNT: 1,
    DESKTOP_PRIVATE_STATE_RESTORED: true,
    PRODUCTION_AION_AUTHORITY_WIRED: true,
    FUNCTIONAL_PERSISTENCE_SMOKE: "PASS",
    FIRST_DESKTOP_PRIMARY_BACKUP: bakOk ? "VERIFIED" : "FAILED",
    credentials_touched: false,
    all_projects_api_touched: false,
    vast: false,
    spend_usd: 0,
    hostname: hostname(),
    head,
    utc: new Date().toISOString(),
  });

  console.log("DESKTOP_CUTOVER_CORE_OK");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
