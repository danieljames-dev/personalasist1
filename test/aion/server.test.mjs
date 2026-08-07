import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  DeveloperAgentCapabilityV1, LocalEchoCapabilityV1, StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../../packages/local-assistant/dist/index.js";
import { createAionServer } from "../../apps/aion/server.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");

/** Starts one isolated Command Center over synthetic temporary state only. */
async function withServer(run) {
  const root = await mkdtemp(join(tmpdir(), "aion-server-test-"));
  const bridge = new SyntheticDeveloperAgentBridgeV1();
  const app = await createAionServer({
    repositoryRoot, dataRoot: join(root, "private", "aion"), exportRoot: join(root, "private", "aion", "exports"),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(), providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1(), new DeveloperAgentCapabilityV1(bridge, repositoryRoot)]),
    developerBridge: bridge,
  });
  const address = await app.listen(0);
  try { return await run({ app, address, base: `http://127.0.0.1:${address.port}`, root }); }
  finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}
const post = (base, body) => fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("Command Center binds loopback, serves same-origin assets, bounds requests, and shuts down", async () => {
  await withServer(async ({ base, address }) => {
    assert.equal(address.address, "127.0.0.1");
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/u);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(`${base}/api/state`)).status, 200);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json", origin: "https://example.invalid" }, body: "{}" })).status, 403);
    const oversized = await fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "conversation.create", title: "x".repeat(1024 * 1024 + 64) }) });
    assert.equal(oversized.status, 400);
    assert.match((await oversized.json()).error, /1 MiB limit/u);
  });
});

test("the state endpoint exposes providers, the capability registry, and no absolute local path", async () => {
  await withServer(async ({ base }) => {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.dataRoot, "private/aion");
    assert.deepEqual(state.capabilities.map((c) => c.id).sort(), ["aion.developer.task.v1", "aion.local.echo.v1"]);
    assert.equal(state.providers[0].id, "deterministic");
    assert.equal(state.developerBridge.available, true);
    assert.doesNotMatch(JSON.stringify(state), /[A-Za-z]:\\/u, "no absolute local path reaches the browser");
  });
});

test("chat streams provider tokens over the loopback stream endpoint", async () => {
  await withServer(async ({ base }) => {
    await post(base, { type: "onboarding.complete" });
    const conversation = await (await post(base, { type: "conversation.create", title: "Streaming" })).json();
    const response = await fetch(`${base}/api/chat/stream`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: conversation.result.id, content: "Hello" }) });
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/u);
    const text = await response.text();
    assert.ok(text.split("event: chunk").length > 2, "several chunk frames arrived");
    assert.match(text, /event: done/u);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.state.conversations[0].messages.length, 2);
  });
});

test("the Career bridge accepts only allow-listed commands and explicit normalized roots", async () => {
  await withServer(async ({ base }) => {
    const unsupported = await post(base, { type: "career.run", command: "rm -rf", root: repositoryRoot });
    assert.equal(unsupported.status, 400);
    assert.match((await unsupported.json()).error, /Unsupported Career command/u);
    const relative = await post(base, { type: "career.run", command: "profile", root: "private/career" });
    assert.equal(relative.status, 400);
    assert.match((await relative.json()).error, /normalized absolute path/u);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.state.activity.filter((entry) => entry.category === "career").length, 0, "a rejected command records no Career activity");
  });
});

test("unsupported actions and unnormalized import paths fail closed with privacy-safe errors", async () => {
  await withServer(async ({ base }) => {
    assert.equal((await post(base, { type: "definitely.not.supported" })).status, 400);
    const traversal = await post(base, { type: "import.dry-run", platform: "chatgpt", root: "..\\elsewhere", path: "..\\elsewhere\\a.json" });
    assert.equal(traversal.status, 400);
    const error = (await traversal.json()).error;
    assert.match(error, /explicit|normalized/u);
    assert.doesNotMatch(error, /[A-Za-z]:\\/u, "errors never disclose an absolute local path");
  });
});

test("an approval is required before the Command Center will execute a capability", async () => {
  await withServer(async ({ base }) => {
    await post(base, { type: "onboarding.complete" });
    const proposed = await (await post(base, { type: "action.propose", capabilityId: "aion.local.echo.v1", input: { text: "bounded" } })).json();
    assert.equal(proposed.result.action.state, "awaiting-approval");
    assert.equal((await post(base, { type: "action.execute", id: proposed.result.action.id })).status, 400);
    await post(base, { type: "approval.decide", id: proposed.result.approval.id, approve: true });
    const executed = await (await post(base, { type: "action.execute", id: proposed.result.action.id })).json();
    assert.deepEqual(executed.result, { text: "bounded", local: true });
  });
});

test("UI exposes every required owner-facing area and needs no hosted dependency", async () => {
  const html = await readFile(join(repositoryRoot, "apps/aion/public/index.html"), "utf8");
  const js = await readFile(join(repositoryRoot, "apps/aion/public/app.js"), "utf8");
  const css = await readFile(join(repositoryRoot, "apps/aion/public/styles.css"), "utf8");
  for (const area of ["Chat", "Tasks", "Routines", "Memory", "Planner", "Approvals", "Activity", "Career", "Imports", "Settings"]) {
    assert.match(js, new RegExp(`"${area}"`, "u"), `the ${area} area must exist`);
  }
  for (const [name, text] of [["index.html", html], ["app.js", js], ["styles.css", css]]) {
    assert.doesNotMatch(text, /https?:\/\//u, `${name} must not reference a remote origin`);
    assert.doesNotMatch(text, /@import\s+url\(|\b(?:cdn|googleapis|gstatic|unpkg|jsdelivr|googletagmanager)\b|gtag\s*\(|\banalytics\.(?:js|track)\b/i, `${name} must not load a hosted dependency`);
  }
  assert.match(js, /esc\(/u, "rendered values must be escaped");
});
