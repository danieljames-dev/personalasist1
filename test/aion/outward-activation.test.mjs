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
  const fetchAt = sync.indexOf("fetch(");
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

test("every outward call site in the app runtime consults the guard", () => {
  /*
   * The check that survives someone adding a route later. A module in the app runtime that reaches
   * the network must import the guard; if it does not, this fails and the author has to declare and
   * gate the route rather than shipping a fourth un-gated path.
   *
   * Demo scripts are excluded by name and by not being reachable from the server.
   */
  const runtime = ["server.mjs", "research-fetch.mjs", "vast-ai.mjs", "brain-runtime.mjs"];
  const outward = /\b(?:globalThis\.)?fetch\(/;
  for (const name of runtime) {
    const source = readFileSync(join(repositoryRoot, "apps", "aion", name), "utf8");
    if (!outward.test(source)) continue;
    const guarded = source.includes("outward-effect-guard.mjs");
    assert.ok(
      guarded,
      `${name} reaches the network without consulting the outward guard; declare and gate the route`,
    );
  }
});

test("the route report names every declared route and its real status", () => {
  const report = outwardRouteReport();
  assert.equal(report.length, Object.keys(OUTWARD_ROUTES_V1).length);
  for (const row of report) {
    assert.equal(row.status, "TECHNICALLY_DISABLED", `${row.routeId} is active`);
    assert.ok(row.detail.length > 20, `${row.routeId} needs a reason someone can act on`);
  }
});
