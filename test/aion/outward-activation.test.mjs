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
/* Call-site enforcement over a derived runtime file set                       */
/* -------------------------------------------------------------------------- */

/*
 * Two rounds of this rule have now been defeated, each time by the axis it was not looking at.
 *
 * V0.3 asserted that a runtime file *imports* the guard. `server.mjs` did — for `gmail.sync` — while
 * carrying four other `fetch` calls that consulted nothing, one of them an OAuth token exchange. A
 * file-level fact cannot prove a call-site property.
 *
 * V0.4 fixed that and asserted the call site, over a literal list of five files in `apps/aion/`.
 * Discovery Campaign 02 then found four live HTTP actions reaching the public internet from
 * `packages/local-assistant`, using the one mechanism the rule *did* model. Coverage has two axes,
 * mechanism and file set, and only the first had been examined.
 *
 * So the file set is now derived from the repository and the mechanism list covers the primitives
 * Campaign 02 enumerated. Every exemption below is named, reasoned, and closed: a file that is not
 * classified and contains a primitive fails, which is the case that would have caught Campaign 02
 * the day it was written.
 */

import {
  CLASSIFIED_V1, NETWORK_PRIMITIVES_V1, OUTWARD_POLICY_V1, blankNonCode, isRuntimeCandidate,
  posixJoin, primitivesIn, repositoryFiles,
} from "./outward-rule.mjs";


const RUNTIME_FILES_V1 = repositoryFiles(repositoryRoot).filter(isRuntimeCandidate);

function sourceOf(file) {
  return readFileSync(join(repositoryRoot, file), "utf8");
}

test("the runtime file set is derived from the repository, not from a hand-kept list", () => {
  /*
   * The number is not the point; the shape is. The old rule read five files. Anything that made
   * this set small again — a stale list, a wildcard exclusion, a scope that quietly means
   * `apps/aion/` — would put the repository back where Campaign 02 found it.
   */
  assert.ok(RUNTIME_FILES_V1.length > 100, `only ${RUNTIME_FILES_V1.length} runtime files derived`);
  for (const mustCover of [
    "packages/local-assistant/src/vehicle-inventory.ts",      // Campaign 02's smallest counterexample
    "packages/local-assistant/src/vehicle-research.ts",
    "packages/local-assistant/src/connectors/dealership-inventory.ts",
    "packages/local-assistant/src/connectors/image-understanding.ts",
    "apps/aion/roadmap-control.mjs",                          // an apps/aion file the old list omitted
    "apps/aion/server.mjs",
  ]) {
    assert.ok(RUNTIME_FILES_V1.includes(mustCover), `${mustCover} is runtime code and must be covered`);
  }
  for (const mustNotCover of [
    "test/aion/outward-activation.test.mjs",
    "packages/local-assistant/test/inventory-pagination.test.ts",
  ]) {
    assert.ok(!RUNTIME_FILES_V1.includes(mustNotCover), `${mustNotCover} is a test and must not be scanned`);
  }
});

test("no runtime file names a network primitive outside an approved adapter", () => {
  const violations = [];
  for (const file of RUNTIME_FILES_V1) {
    const hits = primitivesIn(sourceOf(file));
    if (hits.length === 0) continue;
    const classified = CLASSIFIED_V1.get(file);
    if (classified === undefined) {
      violations.push(`${file}: ${hits.map((h) => `${h.id}@${h.line}`).join(", ")} — unclassified`);
      continue;
    }
    if (classified.klass === "APPROVED_ADAPTER") {
      const counted = new Map();
      for (const hit of hits) counted.set(hit.id, (counted.get(hit.id) ?? 0) + 1);
      for (const [id, count] of counted) {
        const allowed = classified.allow[id] ?? 0;
        if (count !== allowed) violations.push(`${file}: ${count} × ${id}, policy allows exactly ${allowed}`);
      }
    }
  }
  assert.deepEqual(violations, [], `network primitives outside the boundary:\n${violations.join("\n")}`);
});

test("every classification carries a reason, and none is stale", () => {
  for (const [file, detail] of CLASSIFIED_V1) {
    assert.ok(RUNTIME_FILES_V1.includes(file), `${file} is classified but is not a runtime file any more`);
    assert.ok(typeof detail.reason === "string" && detail.reason.length > 25,
      `${file} needs a reason somebody can act on`);
    assert.ok(primitivesIn(sourceOf(file)).length > 0,
      `${file} names no network primitive; remove the exemption rather than leaving it to rot`);
  }
});

test("an inbound-server exemption may not import a client binding", () => {
  /*
   * `node:http` is on the forbidden list because of `http.request`. Three files import it for
   * `createServer`, which is the opposite direction. The exemption is for that clause, so it is
   * checked rather than trusted — otherwise "we only listen" is a comment, and comments were the
   * whole problem.
   */
  const CLIENT_BINDINGS = /\b(request|get|connect|createConnection|Agent|globalAgent)\b/u;
  for (const [file, detail] of Object.entries(OUTWARD_POLICY_V1.INBOUND_SERVER)) {
    const code = blankNonCode(sourceOf(file), { keepStrings: true });
    const pattern = new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*["']${detail.module}["']`, "u");
    const clause = code.match(pattern);
    assert.ok(clause, `${file} must import ${detail.module} with a named clause so it can be checked`);
    assert.ok(!CLIENT_BINDINGS.test(clause[1]),
      `${file} imports a client binding from ${detail.module}: ${clause[1].trim()}`);
  }
});

test("loopback-classified files never name an absolute non-loopback URL at a fetch call site", () => {
  const LOOPBACK_LITERAL = /^(\/|https?:\/\/(127\.0\.0\.1|localhost|\[::1\]))/u;
  const offenders = [];
  for (const klass of ["BROWSER_SAME_ORIGIN", "DEMO_ONLY", "OPERATOR_LOOPBACK"]) {
    for (const file of Object.keys(OUTWARD_POLICY_V1[klass])) {
      const source = sourceOf(file);
      const code = blankNonCode(source, { keepStrings: true });
      const call = /(?<![.\w$])fetch\s*\(\s*(["'`])/gu;
      let match;
      while ((match = call.exec(code)) !== null) {
        const quote = match[1];
        const start = match.index + match[0].length;
        const end = code.indexOf(quote, start);
        const literal = end === -1 ? "" : code.slice(start, end);
        // A template that opens with an interpolation is an expression, not a destination literal.
        if (literal.startsWith("${")) continue;
        if (!LOOPBACK_LITERAL.test(literal)) {
          offenders.push(`${file}: fetch("${literal.slice(0, 60)}")`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `a loopback-classified file names a remote destination:\n${offenders.join("\n")}`);
});

test("no runtime module imports an exempted file", () => {
  /*
   * The exemptions rest on those files not being part of the application. This is what makes that
   * a fact rather than an intention: importing one would make its unguarded `fetch` reachable from
   * the server, which is precisely the shape Campaign 02 measured.
   */
  const exempt = new Set([
    ...Object.keys(OUTWARD_POLICY_V1.BROWSER_SAME_ORIGIN),
    ...Object.keys(OUTWARD_POLICY_V1.DEMO_ONLY),
    ...Object.keys(OUTWARD_POLICY_V1.OPERATOR_LOOPBACK),
    ...Object.keys(OUTWARD_POLICY_V1.OPERATOR_PUBLIC_WEB),
  ]);
  const runtimeOnly = RUNTIME_FILES_V1.filter((file) => !exempt.has(file));
  const reached = [];
  for (const file of runtimeOnly) {
    const code = blankNonCode(sourceOf(file), { keepStrings: true });
    const specifiers = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/gu;
    let match;
    while ((match = specifiers.exec(code)) !== null) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const resolved = posixJoin(dirname(file), specifier);
      for (const candidate of exempt) {
        if (candidate === resolved || candidate.replace(/\.(mjs|js|ts)$/u, "") === resolved.replace(/\.(mjs|js|ts)$/u, "")) {
          reached.push(`${file} -> ${candidate}`);
        }
      }
    }
  }
  assert.deepEqual(reached, [], `an exempted file is reachable from runtime code:\n${reached.join("\n")}`);
});

/* -------------------------------------------------------------------------- */
/* Synthetic fixtures: what the rule catches, and what it must not             */
/* -------------------------------------------------------------------------- */

/** Judge a synthetic source exactly as the rule judges a real unclassified runtime file. */
function judgeFixture(source) {
  return primitivesIn(source).length > 0 ? "REJECTED" : "ACCEPTED";
}

test("every network primitive Campaign 02 enumerated is rejected in an unclassified runtime file", () => {
  const negatives = {
    "direct fetch": 'const r = await fetch("https://api.example.invalid/v1");',
    "globalThis.fetch": 'const r = await globalThis.fetch("https://api.example.invalid/v1");',
    "aliased fetch": 'const send = globalThis.fetch;\nconst r = await send("https://api.example.invalid/v1");',
    "aliased bare fetch": 'const send = fetch;\nconst r = await send("https://api.example.invalid/v1");',
    "destructured fetch": 'const { fetch: go } = globalThis;\nconst r = await go("https://api.example.invalid/v1");',
    "fetch passed as a callback": 'run(fetch);',
    "http.request": 'import http from "node:http";\nhttp.request("http://example.invalid/");',
    "https.request": 'import https from "node:https";\nhttps.request("https://example.invalid/");',
    "http.get": 'import http from "node:http";\nhttp.get("http://example.invalid/", (r) => r.resume());',
    "https.get": 'import https from "node:https";\nhttps.get("https://example.invalid/", (r) => r.resume());',
    "WebSocket": 'const ws = new WebSocket("wss://example.invalid/socket");',
    "EventSource": 'const es = new EventSource("https://example.invalid/stream");',
    "XMLHttpRequest": 'const x = new XMLHttpRequest();',
    "sendBeacon": 'navigator.sendBeacon("https://example.invalid/telemetry", "x");',
    "same-file wrapper": 'async function send(u) { return fetch(u); }\nawait send("https://example.invalid/");',
    "dynamic import of a network module": 'const m = await import("node:https");\nm.request("https://example.invalid/");',
    "net.connect": 'import net from "node:net";\nnet.connect(443, "example.invalid");',
    "tls.connect": 'import tls from "node:tls";\ntls.connect(443, "example.invalid");',
  };
  for (const [name, source] of Object.entries(negatives)) {
    assert.equal(judgeFixture(source), "REJECTED", `${name} slipped through: ${source}`);
  }
});

test("a re-exported network helper is rejected in the file that holds the primitive", () => {
  /*
   * Campaign 02 listed this as an unmodelled pattern, and under the old rule it was: the importer
   * names nothing, the helper was never opened, so neither file failed.
   *
   * The rejection belongs in the helper, not the importer. Following a value across module
   * boundaries is taint analysis, which §9 of this milestone rules out — and it is not needed,
   * because the derived file set now opens the helper too. Both halves are asserted so that
   * "the importer is clean" can never quietly become "the pattern is allowed".
   */
  const importer = 'import { send } from "./net-helper.mjs";\nconst r = await send(url);';
  const helper = "export async function send(u) { return fetch(u); }";
  assert.equal(judgeFixture(importer), "ACCEPTED", "the importer names no primitive, and should not be blamed for one");
  assert.equal(judgeFixture(helper), "REJECTED", "the helper holds the primitive and must be rejected there");
});

test("approved paths and non-network code are accepted", () => {
  const positives = {
    "approved outwardFetch": 'import { outwardFetch } from "./outward-effect-guard.mjs";\nconst r = await outwardFetch("research.fetch", url);',
    "approved loopbackFetch": 'import { loopbackFetch } from "./outward-effect-guard.mjs";\nconst r = await loopbackFetch("http://127.0.0.1:11434/api/chat");',
    "the outward transport port": 'const r = await outward.request("vehicle.vinDecode", url, init);',
    "an injected transport type": "interface Port { fetchImpl?: typeof fetch }",
    "prose about fetch": '// A comment explaining why fetch is forbidden here, mentioning http.request and WebSocket.\nconst x = 1;',
    "a string containing the word": 'const label = "fetch the inventory";',
    "ordinary code": "export function add(a, b) { return a + b; }",
  };
  for (const [name, source] of Object.entries(positives)) {
    assert.equal(judgeFixture(source), "ACCEPTED", `${name} was wrongly rejected: ${source}`);
  }
});

test("a runtime file outside the old five-file list is judged the same as one inside it", () => {
  /*
   * Campaign 02, reduced to one assertion. The defect was never that the mechanism was exotic — it
   * was `fetch` — but that the file was not read. Both of these must now be rejected identically.
   */
  const outwardCall = 'const res = await fetch("https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/X");';
  assert.equal(judgeFixture(outwardCall), "REJECTED", "inside the old list");

  const wasInvisible = "packages/local-assistant/src/vehicle-inventory.ts";
  assert.ok(RUNTIME_FILES_V1.includes(wasInvisible), "the file the old rule never opened must now be scanned");
  assert.equal(CLASSIFIED_V1.has(wasInvisible), false, "and it must hold no exemption");
  assert.deepEqual(primitivesIn(sourceOf(wasInvisible)), [],
    "the repaired connector must name no network primitive at all");
});

test("the rule the file declares is the rule the file runs", () => {
  /*
   * Campaign 02 found a declared-but-never-applied rule here — a constant that looked
   * protective and did nothing. It is gone, and this asserts it stays gone rather than returning as
   * a comfortable-looking constant nobody calls.
   */
  const self = readFileSync(join(repositoryRoot, "test", "aion", "outward-activation.test.mjs"), "utf8");
  // Spelled in pieces: writing the name here would make this file its own counter-example.
  const deadRule = ["BARE", "FETCH"].join("_");
  assert.equal(self.includes(deadRule), false, `${deadRule} must not come back`);
  // Each declared primitive must actually reject something, or it is decoration.
  const proofs = {
    "globalThis.fetch": "globalThis.fetch(u)",
    fetch: "fetch(u)",
    "node network module": 'import x from "node:https";',
    WebSocket: "new WebSocket(u)",
    EventSource: "new EventSource(u)",
    XMLHttpRequest: "new XMLHttpRequest()",
    sendBeacon: "navigator.sendBeacon(u, d)",
  };
  for (const rule of NETWORK_PRIMITIVES_V1) {
    const proof = proofs[rule.id];
    assert.ok(proof !== undefined, `${rule.id} has no proof that it rejects anything`);
    assert.equal(judgeFixture(proof), "REJECTED", `${rule.id} is declared but rejects nothing`);
  }
});

function runtimeSource(name) {
  return readFileSync(join(repositoryRoot, "apps", "aion", name), "utf8");
}


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
