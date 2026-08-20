/**
 * Outward routes are inactive because the code refuses, not because a label says so.
 *
 * An independent review found the previous boundary was a declaration: `apps/` carried an inventory
 * marking Gmail sync and the research fetch `NOT_ACTIVATED_FOR_REAL_EFFECTS`, and both ran the moment
 * credentials were READY. Credential readiness is not authority — a token says what AION *could*
 * reach, never what it is permitted to.
 *
 * Every test here drives the real modules. None makes a network call: the routes refuse before any
 * transport is touched, which is the property under test.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  OUTWARD_ROUTES_V1,
  clearOutwardRoute,
  outwardEffectDecision,
  outwardRouteReport,
  outwardRouteStatus,
  registerOutwardRoute,
} from "../../apps/aion/outward-effect-guard.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/* -------------------------------------------------------------------------- */
/* Every declared route is off until something wires it                        */
/* -------------------------------------------------------------------------- */

test("declared outward routes are technically disabled, not merely labelled", () => {
  for (const routeId of Object.keys(OUTWARD_ROUTES_V1)) {
    assert.equal(outwardRouteStatus(routeId), "TECHNICALLY_DISABLED", routeId);
    const decision = outwardEffectDecision(routeId);
    assert.equal(decision.allowed, false, `${routeId} was allowed with nothing wired`);
    assert.match(decision.reason, /not wired to the pre-action effect gate/);
  }
});

test("an undeclared route is refused rather than assumed harmless", () => {
  const decision = outwardEffectDecision("something.nobody.declared");
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /not declared/);
  assert.equal(outwardRouteStatus("something.nobody.declared"), "UNDECLARED");
  assert.throws(() => registerOutwardRoute("something.nobody.declared", () => ({ allowed: true })));
});

test("a route cannot be activated by asserting it is fine", () => {
  // Activation takes an authorizer that decides per call. There is deliberately no flag to set.
  assert.throws(() => registerOutwardRoute("gmail.sync", true), /needs an authorizer, not a flag/);
  assert.throws(() => registerOutwardRoute("gmail.sync", "GATED"), /needs an authorizer, not a flag/);
  assert.equal(outwardRouteStatus("gmail.sync"), "TECHNICALLY_DISABLED");
});

test("a wired route still refuses when its authorizer refuses", () => {
  // Wiring is not permission: the authorizer is consulted per call, so authority can say no.
  try {
    registerOutwardRoute("gmail.sync", () => ({ allowed: false, reason: "no Owner authority for account access" }));
    assert.equal(outwardRouteStatus("gmail.sync"), "GATED");
    const decision = outwardEffectDecision("gmail.sync");
    assert.equal(decision.allowed, false);
    assert.match(decision.reason, /no Owner authority/);
    // A malformed authorizer answer is a refusal, not an allow.
    registerOutwardRoute("gmail.sync", () => null);
    assert.equal(outwardEffectDecision("gmail.sync").allowed, false);
    registerOutwardRoute("gmail.sync", () => ({}));
    assert.equal(outwardEffectDecision("gmail.sync").allowed, false);
  } finally {
    clearOutwardRoute("gmail.sync");
  }
  assert.equal(outwardRouteStatus("gmail.sync"), "TECHNICALLY_DISABLED");
});

/* -------------------------------------------------------------------------- */
/* The real routes                                                             */
/* -------------------------------------------------------------------------- */

test("READY Gmail credentials alone produce no outward effect", async () => {
  /*
   * The exact shape the review found: a service reporting fully READY credentials. Under the old
   * boundary this reached `fetch("https://oauth2.googleapis.com/token")`. It must now stop before the
   * credentials are even read.
   */
  const { runLiveGmailSyncForTest } = await import("../../apps/aion/server.mjs").catch(() => ({}));
  // `runLiveGmailSync` is module-private; drive the guard the route consults, and prove the route
  // consults it by reading the source.
  const source = readFileSync(join(repositoryRoot, "apps", "aion", "server.mjs"), "utf8");
  const sync = source.slice(source.indexOf("async function runLiveGmailSync"));
  const guardAt = sync.indexOf("outwardEffectDecision(\"gmail.sync\"");
  const credentialsAt = sync.indexOf("gmailLiveCredentials()");
  const fetchAt = sync.indexOf("outwardFetch(");
  assert.ok(guardAt > 0, "the Gmail sync route must consult the outward guard");
  assert.ok(guardAt < credentialsAt, "authorisation must be checked before credentials are read");
  assert.ok(guardAt < fetchAt, "authorisation must be checked before any request is made");
  assert.equal(outwardEffectDecision("gmail.sync", { operation: "sync" }).allowed, false);
  assert.equal(runLiveGmailSyncForTest, undefined, "the sync helper stays module-private");
});

test("the research fetch refuses before it resolves or connects", async () => {
  const { fetchPublicDocument } = await import("../../apps/aion/research-fetch.mjs");
  let resolverCalled = false;
  await assert.rejects(
    () => fetchPublicDocument("https://example.com/", {
      resolver: () => { resolverCalled = true; return [{ address: "93.184.216.34", family: 4 }]; },
      fetchImpl: () => { throw new Error("network must not be reached"); },
    }),
    /outward effect refused/,
  );
  assert.equal(resolverCalled, false, "the route resolved a hostname before checking authority");
});

test("the Vast API refuses even with a credential present", async () => {
  const { VastAiInfrastructureV1 } = await import("../../apps/aion/vast-ai.mjs");
  const variable = "AION_VAST_API_KEY_TEST_ONLY";
  process.env[variable] = "not-a-real-key";
  try {
    const vast = new VastAiInfrastructureV1({ variableName: variable });
    await assert.rejects(() => vast.discover({}), /outward effect refused/);
  } finally {
    delete process.env[variable];
  }
});

/* -------------------------------------------------------------------------- */
/* Composition: wiring and authority are both required                        */
/* -------------------------------------------------------------------------- */

test("neither wiring nor authority alone produces an effect", () => {
  // Ungated route, authority available: still nothing, because the route never asks.
  assert.equal(outwardEffectDecision("research.fetch").allowed, false);
  try {
    // Gated route, authority refuses: still nothing.
    registerOutwardRoute("research.fetch", () => ({ allowed: false, reason: "authority absent" }));
    assert.equal(outwardEffectDecision("research.fetch").allowed, false);
    // Both present: allowed. This is the only combination that acts.
    registerOutwardRoute("research.fetch", () => ({ allowed: true, reason: "authorized" }));
    assert.equal(outwardEffectDecision("research.fetch").allowed, true);
  } finally {
    clearOutwardRoute("research.fetch");
  }
});

/* -------------------------------------------------------------------------- */
/* No outward call site may skip the guard                                    */
/* -------------------------------------------------------------------------- */


test("the route report names every declared route and its real status", () => {
  const report = outwardRouteReport();
  assert.equal(report.length, Object.keys(OUTWARD_ROUTES_V1).length);
  for (const row of report) {
    assert.equal(row.status, "TECHNICALLY_DISABLED", `${row.routeId} is active`);
    assert.ok(row.detail.length > 20, `${row.routeId} needs a reason someone can act on`);
  }
});

/* -------------------------------------------------------------------------- */
/* Call-site enforcement: importing a guard proves nothing                    */
/* -------------------------------------------------------------------------- */

/*
 * The V0.3 invariant asserted that a runtime file *imports* the guard. `server.mjs` did — for
 * `gmail.sync` — while carrying four other `fetch` calls that consulted nothing, one of them a second
 * OAuth token exchange. Every suite was green. A file-level fact cannot prove a call-site property.
 *
 * The rule is now about the call itself: runtime code reaches the network through `outwardFetch` (a
 * declared, gated route) or `loopbackFetch` (checked to stay on this machine), and a bare `fetch` in
 * runtime code fails here.
 */

const RUNTIME_MODULES = ["server.mjs", "research-fetch.mjs", "vast-ai.mjs", "brain-runtime.mjs", "outward-effect-guard.mjs"];
const BARE_FETCH = /(?<!\bglobalThis\.)\bfetch\s*\(/g;

function runtimeSource(name) {
  return readFileSync(join(repositoryRoot, "apps", "aion", name), "utf8");
}

test("no runtime module reaches the network with a bare fetch", () => {
  for (const name of RUNTIME_MODULES) {
    const source = runtimeSource(name);
    // `outward-effect-guard.mjs` is the one place the real transport is allowed to be named.
    const allowed = name === "outward-effect-guard.mjs" ? 2 : 0;
    const bare = (source.match(/globalThis\.fetch\s*\(/g) ?? []).length;
    assert.equal(bare, allowed, `${name} calls globalThis.fetch directly; use outwardFetch or loopbackFetch`);
    const unqualified = (source.match(/(^|[^.\w])fetch\s*\(/gm) ?? [])
      .filter((hit) => !/outwardFetch|loopbackFetch/.test(hit));
    assert.equal(unqualified.length, 0, `${name} calls fetch directly: ${unqualified.join(", ")}`);
  }
});

test("importing the guard is not enough on its own", () => {
  /*
   * The exact V0.3 shape, reconstructed: a file that imports the guard, consults it once, and then
   * makes an unrelated direct call. The old rule passed this. The new one must not.
   */
  const shapeThatUsedToPass = [
    'import { outwardEffectDecision } from "./outward-effect-guard.mjs";',
    'const ok = outwardEffectDecision("gmail.sync");',
    'const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST" });',
  ].join("\n");

  const importsGuard = shapeThatUsedToPass.includes("outward-effect-guard.mjs");
  assert.equal(importsGuard, true, "the sample must import the guard, as server.mjs did");

  const unqualified = (shapeThatUsedToPass.match(/(^|[^.\w])fetch\s*\(/gm) ?? [])
    .filter((hit) => !/outwardFetch|loopbackFetch/.test(hit));
  assert.equal(unqualified.length, 1, "the call-site rule must still see the direct fetch");
});

test("the OAuth token exchange is a declared route and is disabled", () => {
  // The defect: this call ran whenever the OAuth redirect completed, with no authority anywhere.
  assert.ok(Object.prototype.hasOwnProperty.call(OUTWARD_ROUTES_V1, "gmail.oauthExchange"));
  assert.equal(outwardRouteStatus("gmail.oauthExchange"), "TECHNICALLY_DISABLED");
  assert.equal(outwardEffectDecision("gmail.oauthExchange").allowed, false);

  // And both token-exchange call sites in the server now go through the declared route.
  const source = runtimeSource("server.mjs");
  const exchanges = (source.match(/oauth2\.googleapis\.com\/token/g) ?? []).length;
  const routed = (source.match(/outwardFetch\("gmail\.oauthExchange"/g) ?? []).length;
  assert.equal(exchanges, routed, `${exchanges} token exchanges but ${routed} routed through the gate`);
  assert.ok(exchanges >= 2, "both the sync refresh and the callback exchange should be present");
});

test("outwardFetch refuses without touching the network", async () => {
  const { outwardFetch } = await import("../../apps/aion/outward-effect-guard.mjs");
  const before = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => { called = true; throw new Error("network must not be reached"); };
  try {
    await assert.rejects(() => outwardFetch("gmail.oauthExchange", "https://oauth2.googleapis.com/token"), /outward effect refused/);
    assert.equal(called, false, "a refused route still reached the transport");
  } finally {
    globalThis.fetch = before;
  }
});

test("loopbackFetch stays local and refuses to leave", async () => {
  const { loopbackFetch, isLoopbackUrl } = await import("../../apps/aion/outward-effect-guard.mjs");
  assert.equal(isLoopbackUrl("http://127.0.0.1:11434/api/chat"), true);
  assert.equal(isLoopbackUrl("http://localhost:1234/v1/models"), true);
  assert.equal(isLoopbackUrl("https://api.example.com/v1/chat"), false);

  const before = globalThis.fetch;
  let reached = null;
  globalThis.fetch = (url) => { reached = String(url); return Promise.resolve({ ok: true }); };
  try {
    await loopbackFetch("http://127.0.0.1:11434/api/chat");
    assert.equal(reached, "http://127.0.0.1:11434/api/chat", "a local call must still work");
    reached = null;
    await assert.rejects(() => loopbackFetch("https://api.example.com/v1/chat"), /non-loopback/);
    assert.equal(reached, null, "loopbackFetch let a remote address through");
  } finally {
    globalThis.fetch = before;
  }
});
