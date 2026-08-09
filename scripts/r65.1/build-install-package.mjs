/**
 * Build pinned R6.5.1 install package under dist-install/ (repo staging only).
 * Does not write to Program Files (installer does that elevated).
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const PKG = join(REPO, "packages", "delegated-operator");
const OUT = join(REPO, "dist-install", "ElevatedOperatorBroker");
const HEAD = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function sha256Text(t) {
  return createHash("sha256").update(t, "utf8").digest("hex");
}

function walkJs(dir, base, acc) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = `${base}/${name}`.replace(/\\/g, "/");
    if (statSync(full).isDirectory()) walkJs(full, rel, acc);
    else if (name.endsWith(".js")) acc.push(rel);
  }
}

function resolveDotnet() {
  const localDotnet = join(
    process.env.LOCALAPPDATA || "",
    "Microsoft",
    "dotnet",
    "dotnet.exe",
  );
  return process.env.AION_DOTNET || (existsSync(localDotnet) ? localDotnet : "dotnet");
}

function publishSdkProject(dotnet, projectPath, outDir, label) {
  // Self-contained: Windows service SID cannot rely on user-local shared frameworks.
  execFileSync(
    dotnet,
    [
      "publish",
      projectPath,
      "-c",
      "Release",
      "-r",
      "win-x64",
      "--self-contained",
      "true",
      "-p:PublishSingleFile=true",
      "-p:IncludeNativeLibrariesForSelfExtract=true",
      "-o",
      outDir,
    ],
    { stdio: "inherit", cwd: REPO },
  );
  console.log(`${label}: built with self-contained dotnet publish (net8.0-windows win-x64)`);
}

function compileServiceExe(destBin) {
  const csc =
    process.env.AION_CSC ||
    "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
  const src = join(PKG, "service", "AionElevatedBrokerService.cs");
  const serviceProj = join(PKG, "service", "AionElevatedBrokerService.csproj");
  const exe = join(destBin, "aion-elevated-broker.exe");
  mkdirSync(destBin, { recursive: true });
  const dotnet = resolveDotnet();

  // Service host: prefer SDK project
  let serviceBuilt = false;
  if (existsSync(serviceProj)) {
    try {
      const pub = join(destBin, "_service_publish");
      publishSdkProject(dotnet, serviceProj, pub, "Elevated Broker Service");
      const published = join(pub, "aion-elevated-broker.exe");
      if (!existsSync(published)) throw new Error("dotnet publish missing aion-elevated-broker.exe");
      copyFileSync(published, exe);
      // Framework-dependent net8 needs hostfxr beside app OR system runtime — copy deps
      for (const name of readdirSync(pub)) {
        if (name === "aion-elevated-broker.exe") continue;
        const from = join(pub, name);
        const to = join(destBin, name);
        if (statSync(from).isFile()) copyFileSync(from, to);
      }
      serviceBuilt = true;
    } catch (e) {
      console.warn("service dotnet publish failed; falling back to csc:", e instanceof Error ? e.message : e);
    }
  }
  if (!serviceBuilt) {
    if (!existsSync(csc)) throw new Error(`csc not found: ${csc}`);
    execFileSync(
      csc,
      ["/nologo", "/target:exe", `/out:${exe}`, "/reference:System.ServiceProcess.dll", src],
      { stdio: "inherit" },
    );
    console.log("Elevated Broker Service: built with Framework csc.exe");
  }

  // Owner Approval Helper: prefer SDK `dotnet publish` (net8.0-windows), else Framework csc
  const helperExe = join(destBin, "AionOwnerApprovalHelper.exe");
  const helperProj = join(PKG, "service", "AionOwnerApprovalHelper.csproj");
  const helperSrc = join(PKG, "service", "AionOwnerApprovalHelper.cs");
  const helperMan = join(PKG, "service", "AionOwnerApprovalHelper.manifest");
  let helperBuilt = false;
  if (existsSync(helperProj)) {
    try {
      const pub = join(destBin, "_helper_publish");
      publishSdkProject(dotnet, helperProj, pub, "Owner Approval Helper");
      const published = join(pub, "AionOwnerApprovalHelper.exe");
      if (!existsSync(published)) throw new Error("dotnet publish missing helper exe");
      copyFileSync(published, helperExe);
      for (const name of readdirSync(pub)) {
        if (name === "AionOwnerApprovalHelper.exe") continue;
        const from = join(pub, name);
        const to = join(destBin, name);
        // Avoid clobbering service-host deps with same names — helper deps can share runtimes
        if (statSync(from).isFile() && !existsSync(to)) copyFileSync(from, to);
      }
      helperBuilt = true;
    } catch (e) {
      console.warn("helper dotnet publish failed; falling back to csc:", e instanceof Error ? e.message : e);
    }
  }
  if (!helperBuilt) {
    if (!existsSync(csc)) throw new Error(`csc not found: ${csc}`);
    execFileSync(
      csc,
      [
        "/nologo",
        "/target:exe",
        `/out:${helperExe}`,
        `/win32manifest:${helperMan}`,
        helperSrc,
      ],
      { stdio: "inherit" },
    );
    console.log("Owner Approval Helper: built with Framework csc.exe");
  }
  return exe;
}

console.log("Building delegated-operator…");
execFileSync("npm.cmd", ["run", "build", "--workspace=@aion/delegated-operator"], {
  cwd: REPO,
  stdio: "inherit",
  shell: true,
});

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "bin"), { recursive: true });
mkdirSync(join(OUT, "config"), { recursive: true });
mkdirSync(join(OUT, "service"), { recursive: true });
mkdirSync(join(OUT, "lib", "package"), { recursive: true });
mkdirSync(join(OUT, "profiles"), { recursive: true });
mkdirSync(join(OUT, "templates"), { recursive: true });

cpSync(join(PKG, "dist"), join(OUT, "lib", "package", "dist"), { recursive: true });
copyFileSync(join(PKG, "package.json"), join(OUT, "lib", "package", "package.json"));

const entry = `import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const mod = join(here, "package", "dist", "service-main.js");
await import(pathToFileURL(mod).href);
`;
writeFileSync(join(OUT, "lib", "service-main.mjs"), entry, "utf8");

const policy = {
  schemaVersion: "aion.elevated-broker.policy.v1",
  version: "0.1.0-r652",
  pipeName: "\\\\.\\pipe\\AION-ElevatedOperatorBroker-v1",
  serviceName: "AionElevatedBroker",
  serviceAccount: "NT SERVICE\\AionElevatedBroker",
  trustBoundary: "r652-private-owner-helper",
  uacDisabled: false,
  ownerPasswordStored: false,
  arbitraryElevatedPowerShellExposed: false,
  publicListener: false,
  loadFromRepositoryAfterInstall: false,
  nestedOwnerGatesRemain: true,
  founderFallbackAvailable: true,
  sourceHead: HEAD,
};
const policyText = `${JSON.stringify(policy, null, 2)}\n`;
writeFileSync(join(OUT, "config", "policy.v1.json"), policyText, "utf8");

const serviceXml = `<?xml version="1.0" encoding="utf-8"?>
<service>
  <id>AionElevatedBroker</id>
  <name>AION Elevated Operator Broker</name>
  <description>AION constrained elevated operator broker (local named pipe; no public listener)</description>
  <executable>%BASE%\\bin\\aion-elevated-broker.exe</executable>
  <workingdirectory>%BASE%</workingdirectory>
  <log mode="none"/>
</service>
`;
writeFileSync(join(OUT, "service", "aion-elevated-broker.xml"), serviceXml, "utf8");

writeFileSync(
  join(OUT, "profiles", "GROK_BUILD.v1.json"),
  `${JSON.stringify(
    {
      role: "GROK_BUILD",
      authorizedOperations: [
        "repo.read",
        "repo.edit",
        "test.run",
        "npm.run",
        "node.run",
        "docker.test",
        "git.status",
        "git.diff",
        "git.stage",
        "git.commit_forward",
        "git.push_canonical",
        "powershell.read",
        "powershell.repo_operation",
        "temp.create",
        "temp.delete_owned",
        "handoff.write",
        "host.read",
        "host.reboot",
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);
writeFileSync(
  join(OUT, "profiles", "CLAUDE_AUDITOR.v1.json"),
  `${JSON.stringify(
    {
      role: "CLAUDE_AUDITOR",
      authorizedOperations: [
        "repo.read",
        "test.run",
        "npm.run",
        "node.run",
        "docker.test",
        "git.status",
        "git.diff",
        "powershell.read",
        "temp.create",
        "temp.delete_owned",
        "handoff.write",
        "host.read",
      ],
      structuralDenies: [
        "repo.edit",
        "git.stage",
        "git.commit_forward",
        "git.push_canonical",
        "powershell.repo_operation",
        "host.reboot",
      ],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

compileServiceExe(join(OUT, "bin"));

const subjects = [
  "bin/aion-elevated-broker.exe",
  "bin/AionOwnerApprovalHelper.exe",
  "config/policy.v1.json",
  "service/aion-elevated-broker.xml",
  "lib/service-main.mjs",
  "lib/package/package.json",
  "profiles/GROK_BUILD.v1.json",
  "profiles/CLAUDE_AUDITOR.v1.json",
];
// runtime/node.exe is pinned at install time (not in repo staging)
walkJs(join(OUT, "lib", "package", "dist"), "lib/package/dist", subjects);

const digests = {};
for (const rel of subjects) {
  const full = join(OUT, rel.replace(/\//g, "\\"));
  if (!existsSync(full)) throw new Error(`missing subject ${rel}`);
  digests[rel] = sha256File(full);
}

const stagingManifest = {
  schemaVersion: "aion.elevated-broker.install.v1",
  artifactVersion: "0.1.0-r652",
  sourceHead: HEAD,
  operationCatalogVersion: "elevated-broker-ops-v1",
  policyDigest: sha256Text(policyText),
  digests,
  machineName: process.env.COMPUTERNAME || "unknown",
  stagedAtUtc: new Date().toISOString(),
  pipeName: "\\\\.\\pipe\\AION-ElevatedOperatorBroker-v1",
  serviceName: "AionElevatedBroker",
  stagingRoot: OUT,
};
mkdirSync(join(REPO, "dist-install"), { recursive: true });
writeFileSync(join(OUT, "STAGING-MANIFEST.v1.json"), `${JSON.stringify(stagingManifest, null, 2)}\n`, "utf8");
writeFileSync(
  join(REPO, "dist-install", "STAGING-MANIFEST.v1.json"),
  `${JSON.stringify(stagingManifest, null, 2)}\n`,
  "utf8",
);
console.log("Staged install package:", OUT);
console.log("HEAD:", HEAD);
console.log("Subjects:", Object.keys(digests).length);
