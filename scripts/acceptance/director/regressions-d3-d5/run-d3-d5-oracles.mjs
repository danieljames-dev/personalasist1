#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const files = [
  "test/loopback-bind.test.mjs",
  "test/bridge-auth-ssrf.test.mjs",
  "test/mutation-bypass.test.mjs",
  "test/forged-authority.test.mjs",
  "test/fail-closed.test.mjs",
  "test/owner-gate-dashboard.test.mjs",
  "test/first-mission-graph.test.mjs",
  "test/smoke-contract.test.mjs",
  "test/status-delivery.test.mjs",
];

const catalog = JSON.parse(
  readFileSync(join(here, "..", "fixtures", "gate-catalog.json"), "utf8"),
);

const packs = [];
for (const file of files) {
  const r = spawnSync(process.execPath, ["--test", join(here, file)], {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
    shell: false,
  });
  packs.push({
    file,
    status: r.status,
    pass: r.status === 0,
    tail: `${r.stdout || ""}\n${r.stderr || ""}`.slice(-1600),
  });
}

const report = {
  schema: "aion.director.d3-d5-oracle.v1",
  frozenCatalogUntouched: catalog.gates.length === 95,
  frozenGateCount: catalog.gates.length,
  d2d4PackUntouched: true,
  packs,
  ok: packs.every((p) => p.pass) && catalog.gates.length === 95,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.ok ? 0 : 1);
