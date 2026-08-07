import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runCareerCli } from "../../apps/career-cli.mjs";

function capture() {
  const logs = []; const errors = [];
  return { logs, errors, io: { log: (value) => logs.push(String(value)), error: (value) => errors.push(String(value)) } };
}

test("global and per-command help are useful, local-only, and side-effect free", async () => {
  for (const args of [["--help"], ["init", "--help"], ["ingest", "--help"], ["profile", "--help"], ["job:import", "--help"],
    ["match", "--help"], ["draft", "--help"], ["export", "--help"], ["demo", "--help"]]) {
    const output = capture(); assert.equal(await runCareerCli(args, output.io), 0);
    assert.match(output.logs.join("\n"), /explicit|local-only/i); assert.equal(output.errors.length, 0);
  }
});

test("argument failures use deterministic exit 2 and privacy-safe messages", async () => {
  const output = capture(); assert.equal(await runCareerCli(["ingest", "--input", "relative.json"], output.io), 2);
  assert.match(output.errors[0], /required explicit/i); assert.doesNotMatch(output.errors[0], /Users\\|home\//i);
});

test("career:init dry run writes nothing and explicit temporary initialization is idempotent", async () => {
  const root = join(tmpdir(), `aion-career-dry-${process.pid}-${Date.now()}`); const dry = capture();
  assert.equal(await runCareerCli(["init", "--root", root, "--dry-run"], dry.io), 0);
  await assert.rejects(stat(root), { code: "ENOENT" });
  const initialized = await mkdtemp(join(tmpdir(), "aion-career-cli-test-"));
  try {
    for (let attempt = 0; attempt < 2; attempt++) assert.equal(await runCareerCli(["init", "--root", initialized], capture().io), 0);
    const inputs = (await readdir(join(initialized, "private", "input"))).sort(); assert.equal(inputs.length, 5);
    const facts = JSON.parse(await readFile(join(initialized, "private", "input", "career-facts.template.json"), "utf8"));
    assert.deepEqual(facts.entries, []); assert.ok(await stat(join(initialized, "private", "career-config.json")));
  } finally { await rm(initialized, { recursive: true, force: true }); }
});

test("complete demo uses temporary state, reloads export, proves reruns, and reports owner review", async () => {
  const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("aion-career-demo-")));
  const output = capture(); assert.equal(await runCareerCli(["demo"], output.io), 0); const text = output.logs.join("\n");
  assert.match(text, /CareerSource|Career evidence/i); assert.match(text, /CareerProfile/); assert.match(text, /JobMatchReport/);
  assert.match(text, /ApplicationDraft/); assert.match(text, /owner review required/i); assert.match(text, /already-completed/);
  assert.match(text, /export and reload verified/i); assert.doesNotMatch(text, /https?:\/\//i);
  const after = (await readdir(tmpdir())).filter((name) => name.startsWith("aion-career-demo-") && !before.has(name)); assert.deepEqual(after, []);
});
