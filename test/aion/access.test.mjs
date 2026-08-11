import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  InMemoryWriterAuthorityV1, LocalEchoCapabilityV1, SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1, createWriterGrantForTest,
  validateBindAddress,
} from "../../packages/local-assistant/dist/index.js";
import { createAionServer } from "../../apps/aion/server.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");

/** One isolated Command Center over synthetic temporary state. Devices below are all invented. */
async function withServer(run) {
  const root = await mkdtemp(join(tmpdir(), "aion-access-test-"));
  const authority = new InMemoryWriterAuthorityV1(createWriterGrantForTest({ state: "WRITER" }));
  const app = await createAionServer({
    repositoryRoot, dataRoot: join(root, "private", "aion"), exportRoot: join(root, "private", "aion", "exports"),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(), providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    authority,
  });
  const address = await app.listen(0);
  try { return await run({ app, address, base: `http://127.0.0.1:${address.port}` }); }
  finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}
const post = (base, body, headers = {}) => fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const enable = (base) => post(base, { type: "settings.update", settings: { remoteAccess: { enabled: true, bindAddress: "127.0.0.1", sessionDays: 30 } } });

test("private phone access is off by default and AION binds loopback only", async () => {
  await withServer(async ({ base, address }) => {
    assert.equal(address.address, "127.0.0.1", "the default bind is loopback");
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.state.settings.remoteAccess.enabled, false, "phone access is opt-in");
    assert.equal(state.state.settings.remoteAccess.bindAddress === "127.0.0.1" || state.state.settings.remoteAccess.bindAddress === "auto", true, "default bind is loopback or auto");
    const refused = await post(base, { type: "device.pair.code", label: "Phone" });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /Turn on private phone access/u);
  });
});

test("a bind address is never a wildcard and never a public address", () => {
  for (const bad of ["0.0.0.0", "::", "*", "8.8.8.8", "203.0.113.7", ""]) assert.throws(() => validateBindAddress(bad), /wildcard|private-network|required/u, bad);
  assert.equal(validateBindAddress("auto"), "auto");
  for (const good of ["127.0.0.1", "::1", "10.2.3.4", "192.168.1.20", "172.16.0.9", "100.101.102.103", "fd7a::1"]) {
    assert.equal(validateBindAddress(good), good, good);
  }
});

test("pairing issues a single-use, short-lived code and returns the token exactly once", async () => {
  await withServer(async ({ base }) => {
    await enable(base);
    const issued = await (await post(base, { type: "device.pair.code", label: "Work phone" })).json();
    assert.match(issued.result.code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/u, "a code a person can read off a screen and type");
    assert.equal(issued.result.label, "Work phone");

    // The code is never recoverable afterwards: state holds a digest only.
    const state = await (await fetch(`${base}/api/state`)).json();
    const serialized = JSON.stringify(state);
    assert.equal(serialized.includes(issued.result.code), false, "the pairing code is not stored anywhere");
    assert.equal(state.state.pairingTokens[0].codeHash.length, 64);

    const paired = await (await fetch(`${base}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: issued.result.code }) })).json();
    assert.ok(paired.result.token.length >= 40, "a high-entropy session token is returned once");
    assert.ok(paired.result.expiresAt > paired.result.deviceId.slice(0, 0), "the session has an expiry");

    const after = await (await fetch(`${base}/api/state`)).json();
    assert.equal(JSON.stringify(after).includes(paired.result.token), false, "the session token is never stored");
    assert.equal(after.state.sessions[0].tokenHash.length, 64);
    assert.equal(after.state.devices[0].label, "Work phone");

    // Single use.
    const reused = await fetch(`${base}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: issued.result.code }) });
    assert.equal(reused.status, 429);
  });
});

test("no secret or bearer material ever reaches Activity", async () => {
  await withServer(async ({ base }) => {
    await enable(base);
    const issued = await (await post(base, { type: "device.pair.code", label: "Phone" })).json();
    await fetch(`${base}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: issued.result.code }) });
    const state = await (await fetch(`${base}/api/state`)).json();
    const activity = JSON.stringify(state.state.activity);
    assert.equal(activity.includes(issued.result.code), false, "no pairing code in activity");
    assert.doesNotMatch(activity, /tokenHash|Bearer|[A-Za-z0-9_-]{40,}/u, "no bearer material or digest in activity");
    assert.match(activity, /pairing code was issued/u, "the event itself is still audited");
  });
});

test("repeated bad pairing attempts are rate-limited and then blocked", async () => {
  await withServer(async ({ base }) => {
    await enable(base);
    let blocked = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await fetch(`${base}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "AAAAA-BBBBB" }) });
      assert.equal(response.status, 429);
      if (/Too many attempts/u.test((await response.json()).error)) { blocked = true; break; }
    }
    assert.equal(blocked, true, "guessing is blocked after a handful of failures");
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.ok(state.state.rateLimits.length >= 1);
    assert.ok(state.state.activity.some((entry) => entry.action === "device.pair.throttled" || entry.action === "device.pair.rejected"));
  });
});

test("revoking a device ends its access and leaves every owner record intact", async () => {
  await withServer(async ({ base }) => {
    await enable(base);
    await post(base, { type: "memory.create", memory: { content: "A neutral fact", category: "semantic" } });
    await post(base, { type: "task.create", task: { title: "A neutral task" } });
    const issued = await (await post(base, { type: "device.pair.code", label: "Old phone" })).json();
    const paired = await (await fetch(`${base}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: issued.result.code }) })).json();

    const before = (await (await fetch(`${base}/api/state`)).json()).state;
    const revoked = await (await post(base, { type: "device.revoke", id: paired.result.deviceId })).json();
    assert.equal(revoked.result.sessionsEnded, 1);

    const after = (await (await fetch(`${base}/api/state`)).json()).state;
    assert.deepEqual(after.memories, before.memories, "memories are untouched");
    assert.deepEqual(after.tasks, before.tasks, "tasks are untouched");
    assert.deepEqual(after.conversations, before.conversations);
    assert.equal(after.devices[0].revokedAt !== null, true);
    assert.equal(after.sessions[0].revokedAt !== null, true);
    assert.match(JSON.stringify(after.activity), /No conversation, memory, task, relationship, or Career record was changed/u);

    const inventory = await (await post(base, { type: "device.list" })).json();
    assert.equal(inventory.result.devices[0].activeSessions, 0);
  });
});

test("logout-all ends every session and invalidates any outstanding code", async () => {
  await withServer(async ({ base }) => {
    await enable(base);
    for (const label of ["Phone A", "Phone B"]) {
      const issued = await (await post(base, { type: "device.pair.code", label })).json();
      await fetch(`${base}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: issued.result.code }) });
    }
    await post(base, { type: "device.pair.code", label: "Unused" });
    const result = await (await post(base, { type: "device.revoke.all" })).json();
    assert.equal(result.result.devices, 2);
    assert.equal(result.result.sessions, 2);
    const state = (await (await fetch(`${base}/api/state`)).json()).state;
    assert.equal(state.devices.every((device) => device.revokedAt !== null), true);
    assert.equal(state.sessions.every((session) => session.revokedAt !== null), true);
    assert.equal(state.pairingTokens.length, 0, "the unused code is invalidated too");
  });
});

test("turning private access off immediately ends every session rather than only refusing new ones", async () => {
  await withServer(async ({ base }) => {
    await enable(base);
    const issued = await (await post(base, { type: "device.pair.code", label: "Phone" })).json();
    await fetch(`${base}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: issued.result.code }) });
    await post(base, { type: "settings.update", settings: { remoteAccess: { enabled: false, bindAddress: "127.0.0.1", sessionDays: 30 } } });
    const state = (await (await fetch(`${base}/api/state`)).json()).state;
    assert.equal(state.sessions.every((session) => session.revokedAt !== null), true, "a weakened access decision fails closed at once");
    assert.match(JSON.stringify(state.activity), /Private phone access was turned off/u);
  });
});

test("a foreign origin is refused and bearer material is never accepted from a URL", async () => {
  await withServer(async ({ base }) => {
    const foreign = await fetch(`${base}/api/state`, { headers: { origin: "https://example.invalid" } });
    assert.equal(foreign.status, 403, "CSRF/origin protection still applies");
    const server = await readFile(join(repositoryRoot, "apps/aion/server.mjs"), "utf8");
    assert.match(server, /function bearerToken/u);
    assert.match(server, /headers\.authorization/u, "the token is read from a header");
    // Session/API bearer material must never be taken from query strings (logs/history leak).
    // OAuth2 authorization `code` on /oauth/gmail/callback is not bearer auth — it is exchanged once.
    assert.doesNotMatch(server, /searchParams\.get\(\s*["'](?:token|session|auth)/u, "no bearer material is read from a URL");
    assert.match(
      server,
      /pathname === ["']\/oauth\/gmail\/callback["'][\s\S]{0,200}searchParams\.get\(["']code["']\)/u,
      "OAuth authorization code may only be read on the Gmail callback path",
    );
  });
});

test("Gmail OAuth callback uses runLiveGmailSync host path — never a missing service.syncGmailRecent", async () => {
  const server = await readFile(join(repositoryRoot, "apps/aion/server.mjs"), "utf8");
  assert.doesNotMatch(
    server,
    /service\.syncGmailRecent\s*\(/u,
    "callback must not call service.syncGmailRecent (that method does not exist)",
  );
  assert.match(server, /async function runLiveGmailSync\s*\(/u, "host-layer live sync helper must exist");
  assert.match(
    server,
    /runLiveGmailSync\s*\(\s*service\s*,\s*\{\s*maxMessages:\s*20\s*\}\s*,\s*dataRoot\s*\)/u,
    "OAuth success path must call runLiveGmailSync for bounded initial sync",
  );
  assert.match(
    server,
    /case\s+["']connector\.gmail\.sync["'][\s\S]{0,250}runLiveGmailSync\s*\(\s*service\s*,/u,
    "connector.gmail.sync must use the same runLiveGmailSync path",
  );
  assert.match(server, /recordGmailScanIds|loadGmailScanState/u, "scan cursor advances unique message ids");
  assert.match(server, /ingestGmailMessages/u, "domain ingest remains the knowledge write path");
});

test("remote-access status is truthful about what is actually installed", async () => {
  const { detectPrivateNetwork, remoteAccessStatus, tailscaleCandidates } = await import("../../apps/aion/private-network.mjs");
  const candidates = tailscaleCandidates({ ProgramFiles: "C:\\Program Files" }, "win32");
  assert.ok(candidates.length > 0 && candidates.length <= 6, "a short documented list, never a search");
  for (const candidate of candidates) assert.match(candidate, /tailscale\.exe$/u);
  assert.equal(candidates.some((c) => /\.(?:cmd|ps1|bat|sh)$/u.test(c)), false);

  // With nothing installed it must say so rather than implying support.
  const absent = await detectPrivateNetwork({ AION_TAILSCALE_PATH: "C:\\synthetic\\absent\\tailscale.exe", ProgramFiles: "C:\\synthetic\\absent" }, "win32");
  assert.equal(absent.available, false);
  assert.equal(absent.tool, "none");
  assert.equal(absent.executable, null);
  assert.match(absent.detail, /does not search your computer/u);
  assert.match(absent.detail, /never create a tunnel or change your router/u);

  const loopbackOnly = [{ address: "127.0.0.1", port: 31415, state: "listening", scope: "loopback", detail: "" }];
  const status = await remoteAccessStatus({ remoteAccess: { enabled: false, bindAddress: "127.0.0.1", sessionDays: 30 } }, loopbackOnly,
    { AION_TAILSCALE_PATH: "C:\\synthetic\\absent\\tailscale.exe" }, "win32");
  assert.equal(status.enabled, false);
  assert.equal(status.loopbackOnly, true);
  assert.equal(status.publiclyExposed, false);
  assert.equal(status.configurationApplied, true, "loopback-only is the applied configuration when access is off");
  assert.match(status.summary, /reachable only from this computer/u);
  assert.doesNotMatch(JSON.stringify(status), /[A-Za-z]:\\/u, "no local path reaches the browser");

  // Detection never configures anything.
  const source = await readFile(join(repositoryRoot, "apps/aion/private-network.mjs"), "utf8");
  for (const forbidden of ["\"up\"", "\"login\"", "\"set\"", "funnel", "serve", "cert"]) {
    assert.equal(source.includes(`, [${forbidden}]`), false, `detection never runs tailscale ${forbidden}`);
  }
  assert.match(source, /shell: false/u);
});

test("the state endpoint reports remote access and marks who is asking", async () => {
  await withServer(async ({ base }) => {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.viewer, "console", "a loopback request is the owner at the console");
    assert.equal(state.remoteAccess.enabled, false);
    assert.equal(state.remoteAccess.publiclyExposed, false);
    assert.equal(state.remoteAccess.loopbackOnly, true);
    assert.deepEqual(state.devices, []);
    assert.doesNotMatch(JSON.stringify(state.remoteAccess), /[A-Za-z]:\\/u);
  });
});

test("the UI hides console-only controls from a paired phone and keeps tokens out of URLs", async () => {
  const js = await readFile(join(repositoryRoot, "apps/aion/public/app.js"), "utf8");
  assert.match(js, /model\.viewer === "console" \? privateAccessCard\(\)/u, "access settings render only at the console");
  assert.match(js, /authorization: `Bearer \$\{token\}`/u, "the phone sends its token in a header");
  assert.doesNotMatch(js, /[?&](?:token|session|code)=/u, "no secret is ever placed in a URL");
  assert.match(js, /renderPairing/u, "an unpaired phone gets a pairing screen and nothing else");
  // The pairing screen must not be able to leak owner data: it is rendered before any state load.
  const pairingScreen = js.slice(js.indexOf("function renderPairing"), js.indexOf("function chatArea"));
  assert.doesNotMatch(pairingScreen, /model\./u, "the pairing screen reads no owner state");
});

test("the service worker caches the shell and never an API response", async () => {
  const sw = await readFile(join(repositoryRoot, "apps/aion/public/sw.js"), "utf8");
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/u, "API requests are excluded by path");
  assert.match(sw, /return;/u);
  // Only the named shell files may ever be written to a cache.
  assert.match(sw, /SHELL_FILES\.includes\(url\.pathname\)/u, "only shell files are cacheable");
  for (const forbidden of ["/api/state", "/api/action", "/api/chat/stream"]) assert.equal(sw.includes(`"${forbidden}"`), false, `${forbidden} is never in the cache list`);
  assert.match(sw, /aion-clear-cache/u, "the app can drop the cache when a device is signed out");

  const manifest = JSON.parse(await readFile(join(repositoryRoot, "apps/aion/public/manifest.webmanifest"), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.ok(manifest.icons.length >= 1 && manifest.icons.every((icon) => icon.src.startsWith("/")), "icons are repository-owned and same-origin");
  const html = await readFile(join(repositoryRoot, "apps/aion/public/index.html"), "utf8");
  assert.match(html, /rel="manifest"/u);
  assert.match(html, /viewport-fit=cover/u);
  assert.doesNotMatch(html, /https?:\/\//u, "the shell still loads nothing remote");
});
