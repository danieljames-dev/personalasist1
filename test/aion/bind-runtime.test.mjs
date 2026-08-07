import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  LocalEchoCapabilityV1, SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../../packages/local-assistant/dist/index.js";
import { createAionServer } from "../../apps/aion/server.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");

/*
 * The defect these tests exist for: AION persisted an owner-selected private bind address,
 * displayed it in Settings, and then listened on 127.0.0.1 only, because the listener call had
 * the loopback address written into it. The saved configuration never reached the runtime.
 *
 * So these assert observable listener behaviour, not stored settings. Every one uses a synthetic
 * temporary data root; none reads or writes the owner's real private state, and none depends on
 * this machine having a particular Wi-Fi adapter.
 */

/** An address in a private range that no machine holds, so binding it reliably fails. */
const UNAVAILABLE_PRIVATE = "10.255.255.254";
/** IPv6 loopback: a genuinely different address from 127.0.0.1, bindable anywhere, never public. */
const SECOND_LOCAL = "::1";

async function withAion(remoteAccess, run) {
  const root = await mkdtemp(join(tmpdir(), "aion-bind-test-"));
  const app = await createAionServer({
    repositoryRoot, dataRoot: join(root, "private", "aion"), exportRoot: join(root, "private", "aion", "exports"),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(), providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  try {
    // Persist the access setting BEFORE listening, exactly as a restart would find it.
    if (remoteAccess) await app.service.updateSettings({ remoteAccess });
    await app.listen(0);
    return await run(app);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}

const listeningOn = (app) => app.listeners.filter((e) => e.state === "listening").map((e) => e.address).sort();

test("access disabled: AION listens on loopback and nothing else", async () => {
  await withAion(null, async (app) => {
    assert.deepEqual(listeningOn(app), ["127.0.0.1"]);
    assert.equal(app.listeners.length, 1, "no private listener is created when access is off");
    assert.equal(app.servers.length, 1);
    const port = app.listeners[0].port;
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/state`)).status, 200, "loopback works");
  });
});

test("access enabled with a valid available private address: loopback is preserved AND the exact address is reachable", async () => {
  await withAion({ enabled: true, bindAddress: SECOND_LOCAL, sessionDays: 30 }, async (app) => {
    const addresses = listeningOn(app);
    assert.equal(addresses.includes("127.0.0.1"), true, "loopback is never given up");
    assert.equal(addresses.includes(SECOND_LOCAL), true, "the configured address is actually bound");
    assert.equal(app.servers.length, 2, "a second listener exists, rather than one widened listener");

    const port = app.listeners[0].port;
    for (const entry of app.listeners) assert.equal(entry.port, port, "every listener shares one port");

    // Both are genuinely serving, which is the thing that failed for the owner.
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/state`)).status, 200);
    assert.equal((await fetch(`http://[${SECOND_LOCAL}]:${port}/api/state`)).status, 200, "the configured private address really answers");
  });
});

test("the persisted setting is what drives the listener: same code, different saved config, different result", async () => {
  const off = await withAion(null, async (app) => listeningOn(app));
  const on = await withAion({ enabled: true, bindAddress: SECOND_LOCAL, sessionDays: 30 }, async (app) => listeningOn(app));
  assert.deepEqual(off, ["127.0.0.1"]);
  assert.deepEqual(on, ["127.0.0.1", SECOND_LOCAL].sort());
  assert.notDeepEqual(off, on, "configuration observably controls the runtime, which is the whole defect");
});

test("disabling access again returns to loopback-only on the next start", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-bind-cycle-"));
  const dataRoot = join(root, "private", "aion");
  const make = async () => createAionServer({
    repositoryRoot, dataRoot, exportRoot: join(dataRoot, "exports"),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(), providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  try {
    const first = await make();
    await first.service.updateSettings({ remoteAccess: { enabled: true, bindAddress: SECOND_LOCAL, sessionDays: 30 } });
    await first.listen(0);
    assert.equal(listeningOn(first).includes(SECOND_LOCAL), true, "enabled on the first start");
    await first.service.updateSettings({ remoteAccess: { enabled: false, bindAddress: SECOND_LOCAL, sessionDays: 30 } });
    await first.close();

    const second = await make();
    await second.listen(0);
    assert.deepEqual(listeningOn(second), ["127.0.0.1"], "disabled setting is honoured after a restart");
    await second.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an unavailable private interface fails safely: loopback survives and the bind is never widened", async () => {
  await withAion({ enabled: true, bindAddress: UNAVAILABLE_PRIVATE, sessionDays: 30 }, async (app) => {
    assert.deepEqual(listeningOn(app), ["127.0.0.1"], "loopback is preserved");
    assert.equal(app.servers.length, 1, "the failed listener is not left behind");
    const failure = app.listeners.find((e) => e.state === "failed");
    assert.ok(failure, "the failure is recorded rather than swallowed");
    assert.equal(failure.address, UNAVAILABLE_PRIVATE);
    assert.match(failure.detail, /did not widen the bind/u);
    assert.match(failure.detail, /does not belong to this computer|reported/u);

    // Nothing anywhere is bound to a wildcard.
    for (const entry of app.listeners) assert.equal(["0.0.0.0", "::", "*"].includes(entry.address), false);
    const status = (await (await fetch(`http://127.0.0.1:${app.listeners[0].port}/api/state`)).json()).remoteAccess;
    assert.equal(status.enabled, true, "the owner's setting is still reported as requested");
    assert.equal(status.configurationApplied, false, "but AION admits it is not in effect");
    assert.equal(status.loopbackOnly, true);
    assert.match(status.summary, /NOT working/u, "the summary does not claim remote access works");
  });
});

test("a wildcard or public address is refused and never bound", async () => {
  for (const bad of ["0.0.0.0", "::", "*", "8.8.8.8", "203.0.113.7"]) {
    const root = await mkdtemp(join(tmpdir(), "aion-bind-bad-"));
    const app = await createAionServer({
      repositoryRoot, dataRoot: join(root, "private", "aion"), exportRoot: join(root, "private", "aion", "exports"),
      clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(), providers: [new DeterministicModelProviderV1()],
      capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
      developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    });
    try {
      // Settings refuses it outright, so it can never even be persisted.
      await assert.rejects(app.service.updateSettings({ remoteAccess: { enabled: true, bindAddress: bad, sessionDays: 30 } }),
        /wildcard|private-network|required/u, bad);
      await app.listen(0);
      assert.deepEqual(listeningOn(app), ["127.0.0.1"], `${bad} never becomes a listener`);
    } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
  }
});

test("a persisted address that is loopback is reported as not giving phone access", async () => {
  await withAion({ enabled: true, bindAddress: "127.0.0.1", sessionDays: 30 }, async (app) => {
    assert.deepEqual(listeningOn(app), ["127.0.0.1"]);
    assert.equal(app.servers.length, 1, "no duplicate listener on the same address and port");
    const note = app.listeners.find((e) => e.state === "loopback-only");
    assert.ok(note, "AION says plainly that no other device can reach it");
    assert.match(note.detail, /no other device can reach AION/u);
    const status = (await (await fetch(`http://127.0.0.1:${app.listeners[0].port}/api/state`)).json()).remoteAccess;
    assert.equal(status.configurationApplied, false);
  });
});

test("reported status describes real listeners, not saved configuration", async () => {
  await withAion({ enabled: true, bindAddress: SECOND_LOCAL, sessionDays: 30 }, async (app) => {
    const status = (await (await fetch(`http://127.0.0.1:${app.listeners[0].port}/api/state`)).json()).remoteAccess;
    assert.equal(status.configurationApplied, true);
    assert.equal(status.publiclyExposed, false);
    assert.deepEqual(status.listeners.filter((e) => e.state === "listening").map((e) => e.address).sort(), ["127.0.0.1", SECOND_LOCAL].sort());
    assert.match(status.summary, /listening on/u);
    assert.equal(status.bindAddress, SECOND_LOCAL, "what was asked for is still reported separately");
  });
});

test("no machine-specific private address is committed, and the startup path reads real listeners", async () => {
  const { readFile } = await import("node:fs/promises");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const { stdout } = await run("git", ["ls-files"], { cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024 });
  /*
   * Production source only. The bind address is owner-supplied configuration, so shipped code has
   * no legitimate reason to contain any private address at all -- which is a sharper rule than
   * hunting for one particular address, and it cannot be satisfied by hard-coding a different one.
   * Test files may use documented example addresses; those are fixtures, not configuration.
   */
  const production = stdout.split(/\r?\n/u).filter((f) =>
    /\.(ts|mjs|cjs|js)$/u.test(f) && (f.startsWith("apps/") || f.startsWith("scripts/") || /^packages\/[^/]+\/src\//u.test(f)) && !/[./]test\./u.test(f));
  assert.ok(production.length >= 5, "the production file list resolved");

  const privateAddress = /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/u;
  const offenders = [];
  for (const file of production) {
    const text = await readFile(join(repositoryRoot, file), "utf8");
    const line = text.split(/\r?\n/u).findIndex((entry) => privateAddress.test(entry));
    if (line >= 0) offenders.push(`${file}:${line + 1}`);
  }
  assert.deepEqual(offenders, [], "the private address must stay owner-supplied configuration, never source");

  const startup = await readFile(join(repositoryRoot, "apps/aion-command-center.mjs"), "utf8");
  assert.match(startup, /app\.listeners/u, "startup reports the listeners it actually has");
  assert.doesNotMatch(startup, /is local-only: \$\{/u, "it no longer claims local-only unconditionally");
  assert.doesNotMatch(startup, /0\.0\.0\.0/u);

  const server = await readFile(join(repositoryRoot, "apps/aion/server.mjs"), "utf8");
  assert.doesNotMatch(server, /listen\([^)]*"0\.0\.0\.0"/u, "the wildcard is never bound");
  assert.match(server, /validateBindAddress/u, "the configured address is validated before it is bound");
});
