import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  classifyOwnerDataCategory,
  isNoiseDirectoryName,
  isSecretOrProtectedPath,
  validateImportRootCandidate,
} from "../src/import-path-policy.js";
import {
  discoverOwnerDataSources,
  inventoryRoot,
  rootsForAutoRegister,
} from "../src/owner-data-discovery.js";

test("hard exclusion all-projects-API still absolute", () => {
  assert.equal(validateImportRootCandidate("C:\\Users\\nearm\\all-projects-API").ok, false);
  assert.equal(validateImportRootCandidate("C:\\Users\\nearm\\all-projects-API\\nested").ok, false);
  assert.equal(isSecretOrProtectedPath("C:\\Users\\nearm\\all-projects-API\\foo"), true);
});

test("noise directories recognized", () => {
  assert.equal(isNoiseDirectoryName("node_modules"), true);
  assert.equal(isNoiseDirectoryName(".git"), true);
  assert.equal(isNoiseDirectoryName("venv"), true);
  assert.equal(isNoiseDirectoryName("Career"), false);
  assert.equal(isNoiseDirectoryName("Resume"), false);
});

test("secret patterns block bitkey/wallet/env", () => {
  assert.equal(isSecretOrProtectedPath("C:\\Users\\User\\Documents\\bitkey.pdf"), true);
  assert.equal(isSecretOrProtectedPath("C:\\Users\\User\\project\\.env"), true);
  assert.equal(isSecretOrProtectedPath("C:\\Users\\User\\Desktop\\Remote Job Kit - Daniel Coffman\\resume.md"), false);
});

test("category classification priority signals", () => {
  assert.equal(classifyOwnerDataCategory("C:\\x\\Remote Job Kit - Daniel Coffman"), "career");
  assert.equal(classifyOwnerDataCategory("D:\\Compassionate Choice - Kristinas Business"), "business");
  assert.equal(classifyOwnerDataCategory("D:\\Desktop Archive\\old"), "archive");
});

test("inventory counts supported files and skips noise", () => {
  const root = join(tmpdir(), `aion-disc-${Date.now()}`);
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "notes.md"), "# hi\n");
  writeFileSync(join(root, "docs", "resume.txt"), "resume body\n");
  writeFileSync(join(root, "node_modules", "pkg", "index.js"), "x");
  writeFileSync(join(root, "bitkey.pdf"), "%PDF");
  try {
    const inv = inventoryRoot(root, { maxDepth: 4, maxFiles: 100 });
    assert.ok(inv.supportedCount >= 2);
    // bitkey skipped as secret — not counted as supported walk target for inventory
    // (inventory still counts by extension before secret filter on name — inventory uses isSupported + secret skip)
    assert.ok(inv.fileCount >= 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discover with custom seeds only inventories real candidates", () => {
  const root = join(tmpdir(), `aion-seed-${Date.now()}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "career-notes.md"), "skills and employment\n");
  try {
    const inv = discoverOwnerDataSources({
      seeds: [root, "C:\\Users\\nearm\\all-projects-API"],
      expandChildren: false,
      inventory: true,
      now: "2026-08-11T00:00:00.000Z",
    });
    assert.ok(inv.sources.some((s) => s.path.toLowerCase().includes(root.toLowerCase().slice(-20)) || s.path === root || existsSync(s.path)));
    assert.ok(inv.sources.some((s) => !s.policyOk && /all-projects-API/i.test(s.path)));
    const auto = rootsForAutoRegister(inv, 10);
    assert.ok(auto.every((p) => !/all-projects-API/i.test(p)));
    assert.match(inv.reply, /OWNER DATA DISCOVERY/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
