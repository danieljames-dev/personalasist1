#!/usr/bin/env node
/**
 * Known-defect regression pack runner.
 * Separate from the frozen 95-gate catalog. Final Director acceptance runs both.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const files = [
  "deployment-truth-regression.mjs",
  "windows-resource-identity-regression.mjs",
];

const catalog = JSON.parse(
  readFileSync(join(here, "..", "fixtures", "gate-catalog.json"), "utf8"),
);

const results = [];
for (const file of files) {
  const r = spawnSync(process.execPath, ["--test", join(here, file)], {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
    shell: false,
  });
  results.push({
    file,
    status: r.status,
    pass: r.status === 0,
    tail: `${r.stdout || ""}\n${r.stderr || ""}`.slice(-2000),
  });
}

const report = {
  schema: "aion.director.known-defect-regression.v1",
  frozenCatalogUntouched: catalog.gates.length === 95,
  frozenGateCount: catalog.gates.length,
  packs: results,
  ok: results.every((x) => x.pass) && catalog.gates.length === 95,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.ok ? 0 : 1);
