#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { discoverClaude, discoverGrok } from "./lib/discover-clis.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const files = [
  "test/discovery.test.mjs",
  "test/argv-no-shell.test.mjs",
  "test/process-identity.test.mjs",
  "test/timeout-cancel.test.mjs",
  "test/handoff.test.mjs",
  "test/git-truth.test.mjs",
  "test/capacity.test.mjs",
  "test/host-lock.test.mjs",
  "test/crash-recovery.test.mjs",
  "test/bounded-log.test.mjs",
  "test/cli-smoke.test.mjs",
];

const catalog = JSON.parse(
  readFileSync(join(here, "..", "fixtures", "gate-catalog.json"), "utf8"),
);

const packs = [];
for (const file of files) {
  const r = spawnSync(process.execPath, ["--test", join(here, file)], {
    encoding: "utf8",
    timeout: 180_000,
    windowsHide: true,
    shell: false,
  });
  packs.push({
    file,
    status: r.status,
    pass: r.status === 0,
    tail: `${r.stdout || ""}\n${r.stderr || ""}`.slice(-1800),
  });
}

const report = {
  schema: "aion.director.d2-d4-oracle.v1",
  frozenCatalogUntouched: catalog.gates.length === 95,
  frozenGateCount: catalog.gates.length,
  claude: discoverClaude(),
  grok: discoverGrok(),
  packs,
  ok: packs.every((p) => p.pass) && catalog.gates.length === 95,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.ok ? 0 : 1);
