/**
 * Live Win32 / Node path probes.
 * Written as a source file (not a shell heredoc). Creates scratch only
 * under os.tmpdir(), never under a Claude worktree.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { classifyHostPath, defectiveSlashCaseKey, identityForExistingResource, pathIsInside } from "./windows-resource-identity.mjs";

function record(name, fn) {
  try {
    return { name, ok: true, ...fn() };
  } catch (error) {
    return { name, ok: false, error: error.message };
  }
}

function childStat(target) {
  const script = "const fs=require('fs'); const t=process.argv[1]; try { const s=fs.statSync(t); process.stdout.write(JSON.stringify({ok:true,isFile:s.isFile(),isDir:s.isDirectory(),dev:s.dev,ino:String(s.ino)})); } catch(e) { process.stdout.write(JSON.stringify({ok:false,code:e.code,message:e.message})); }";
  const r = spawnSync(process.execPath, ["-e", script, target], {
    encoding: "utf8",
    timeout: 1500,
    windowsHide: true,
    shell: false,
  });
  if (r.error) return { ok: false, spawnError: r.error.message, signal: r.signal };
  try {
    return JSON.parse(r.stdout || "{}");
  } catch {
    return { ok: false, raw: (r.stdout || r.stderr || "").slice(0, 200), status: r.status };
  }
}

export function runWindowsPathProbes() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "aion-host-path-oracle-"));
  const wt = path.join(scratch, "wt-a");
  fs.mkdirSync(wt);
  const marker = path.join(wt, "marker.txt");
  fs.writeFileSync(marker, "oracle");

  const sep = path.win32.sep;
  const driveRel = `${scratch.slice(0, 2)}rel-wt`;
  const rootedDriveless = `${sep}${wt.slice(3)}`;
  const fwd = wt.replace(/\\/g, "/");
  const mixed = `${wt.slice(0, 2)}/${wt.slice(3).replace(/\\/g, "/")}`;
  const deviceNs = `\\\\?\\${wt}`;
  const trailingDot = `${wt}${sep}marker.txt.`;
  const trailingSpace = `${wt}${sep}marker.txt `;
  const ads = `${marker}:stream`;
  const sibling = path.join(scratch, "wt-ab");
  fs.mkdirSync(sibling);

  const probes = [];

  probes.push(record("forward-backslash-aliases", () => {
    const a = identityForExistingResource(wt);
    const b = identityForExistingResource(fwd);
    const naiveSame = defectiveSlashCaseKey(wt) === defectiveSlashCaseKey(fwd);
    return {
      backslash: wt,
      forward: fwd,
      identitySame: a.ok && b.ok && a.key === b.key,
      naiveSame,
      a: a.ok ? { key: a.key, real: a.real, ino: a.ino } : a,
      b: b.ok ? { key: b.key, real: b.real, ino: b.ino } : b,
      realpathNative: {
        backslash: fs.realpathSync.native(wt),
        forward: fs.realpathSync.native(fwd),
      },
    };
  }));

  probes.push(record("device-namespace-peel", () => {
    const a = identityForExistingResource(wt);
    const b = identityForExistingResource(deviceNs);
    return {
      deviceNs,
      identitySame: a.ok && b.ok && a.key === b.key,
      naiveSame: defectiveSlashCaseKey(wt) === defectiveSlashCaseKey(deviceNs),
      aOk: a.ok,
      bOk: b.ok,
      classifyNs: classifyHostPath(deviceNs),
      realpathNs: fs.realpathSync.native(deviceNs),
    };
  }));

  probes.push(record("case-alias", () => {
    const flipped = wt.replace(/[A-Za-z]/g, (ch, i) => (i % 2 ? ch.toUpperCase() : ch.toLowerCase()));
    let realFlipped = null;
    let ident = null;
    try {
      realFlipped = fs.realpathSync.native(flipped);
      ident = identityForExistingResource(flipped);
    } catch (error) {
      return { flipped, error: error.message };
    }
    const base = identityForExistingResource(wt);
    return {
      flipped,
      realFlipped,
      identitySame: base.ok && ident.ok && base.key === ident.key,
      classify: classifyHostPath(flipped),
    };
  }));

  probes.push(record("drive-relative", () => {
    const input = driveRel;
    return {
      input,
      classify: classifyHostPath(input),
      win32Resolve: path.win32.resolve(input),
      cwd: process.cwd(),
      accepted: classifyHostPath(input).acceptedForIdentity,
    };
  }));

  probes.push(record("rooted-driveless", () => {
    return {
      input: rootedDriveless,
      classify: classifyHostPath(rootedDriveless),
      win32Resolve: path.win32.resolve(rootedDriveless),
      accepted: classifyHostPath(rootedDriveless).acceptedForIdentity,
    };
  }));

  probes.push(record("dot-dot", () => {
    const tricky = path.join(wt, "..", "wt-a");
    const ident = identityForExistingResource(tricky);
    const base = identityForExistingResource(wt);
    return {
      input: tricky,
      classify: classifyHostPath(tricky),
      identitySame: ident.ok && base.ok && ident.key === base.key,
      real: ident.real,
    };
  }));

  probes.push(record("trailing-dot-space", () => {
    const dotStat = childStat(trailingDot);
    const spaceStat = childStat(trailingSpace);
    return {
      trailingDot,
      trailingSpace,
      classifyDot: classifyHostPath(trailingDot),
      classifySpace: classifyHostPath(trailingSpace),
      dotStat,
      spaceStat,
      win32NormalizeDot: path.win32.normalize(trailingDot),
    };
  }));

  probes.push(record("nul-byte", () => {
    const input = `${wt}\0wt-b`;
    return {
      classify: classifyHostPath(input),
      naiveKey: defectiveSlashCaseKey(input),
    };
  }));

  probes.push(record("ads-colon", () => {
    return {
      ads,
      classify: classifyHostPath(ads),
      stat: childStat(ads),
    };
  }));

  probes.push(record("unc-and-malformed", () => {
    const malformed = "\\\\";
    const serverOnly = "\\\\no-such-oracle-host";
    const full = "\\\\no-such-oracle-host\\share\\wt-a";
    return {
      malformed: { input: malformed, classify: classifyHostPath(malformed) },
      serverOnly: { input: serverOnly, classify: classifyHostPath(serverOnly), stat: childStat(serverOnly) },
      full: { input: full, classify: classifyHostPath(full) },
    };
  }));

  const devices = ["CON", "PRN", "AUX", "NUL", "COM1", "LPT1", "con", "nul.txt", "CON.", "\\\\.\\NUL", "\\\\?\\NUL"];
  const deviceResults = [];
  for (const d of devices) {
    deviceResults.push({
      input: d,
      classify: classifyHostPath(d),
      stat: childStat(d),
      win32Resolve: path.win32.resolve(d),
    });
  }
  probes.push({ name: "reserved-devices", ok: true, devices: deviceResults });

  probes.push(record("sibling-prefix", () => {
    const inside = pathIsInside(wt, marker);
    const prefix = pathIsInside(wt, sibling);
    return {
      wt,
      marker,
      sibling,
      markerInside: inside,
      siblingInside: prefix,
      naiveWouldCollide: defectiveSlashCaseKey(sibling).startsWith(defectiveSlashCaseKey(wt)),
    };
  }));

  probes.push(record("containment-no-root", () => {
    return pathIsInside("", marker);
  }));

  probes.push(record("mixed-separators", () => {
    const ident = identityForExistingResource(mixed);
    const base = identityForExistingResource(wt);
    return {
      mixed,
      classify: classifyHostPath(mixed),
      identitySame: ident.ok && base.ok && ident.key === base.key,
    };
  }));

  probes.push(record("stat-ino-stable", () => {
    const s1 = fs.statSync(wt);
    const s2 = fs.statSync(fwd);
    return {
      devEqual: s1.dev === s2.dev,
      inoEqual: s1.ino === s2.ino,
      ino: String(s1.ino),
      dev: s1.dev,
    };
  }));

  return { scratch, wt, marker, sibling, probes };
}

const invoked = process.argv[1] && /windows-path-probe\.mjs$/i.test(process.argv[1]);
if (invoked) {
  const report = runWindowsPathProbes();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
