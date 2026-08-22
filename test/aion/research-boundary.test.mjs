/**
 * The research network boundary, exercised against the code that actually runs.
 *
 * An independent review made a fair point about the Director-side suite: it drives a fake transport,
 * so it pins the Director's *decisions* and proves nothing about the fetch. "Private destinations are
 * refused, including after a redirect" was listed as a guarantee and tested nowhere. These are the
 * tests that would fail if the SSRF walk regressed.
 *
 * Everything here runs against a **real local HTTP server**, which sounds contradictory in a suite
 * about refusing loopback and is the point: the server genuinely answers, and the boundary genuinely
 * will not talk to it. A refusal proved against a listening socket is worth more than one proved
 * against nothing.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { evaluateResearchUrl } from "../../packages/local-assistant/dist/index.js";
import { assertPublicHost, extractPublishedAt, fetchPublicDocument } from "../../apps/aion/research-fetch.mjs";
import {
  clearOutwardRoute,
  outwardEffectDecision,
  outwardFetchPinned,
  outwardRouteStatus,
  registerOutwardRoute,
} from "../../apps/aion/outward-effect-guard.mjs";
import { activateResearchRoutes } from "../../apps/aion/research-activation.mjs";

/* -------------------------------------------------------------------------- */
/* The destination table, against the guard that runs                          */
/* -------------------------------------------------------------------------- */

test("no private, local, reserved or non-http destination is a research target", () => {
  const refused = [
    "http://127.0.0.1/", "http://127.9.9.9/", "http://localhost/", "http://LOCALHOST/",
    "http://[::1]/", "http://[::]/", "http://0.0.0.0/",
    "http://10.0.0.5/", "http://172.16.0.1/", "http://172.31.255.255/", "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/", "http://metadata.google.internal/",
    "http://100.64.0.1/", "http://198.18.0.1/", "http://224.0.0.1/", "http://255.255.255.255/",
    "http://[fe80::1]/", "http://[fc00::1]/", "http://[fd12:3456::1]/", "http://[ff02::1]/",
    /* IPv4-mapped IPv6 in both spellings — `new URL` rewrites the first into the second. */
    "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:10.0.0.1]/",
    "http://intranet/", "http://server.internal/", "http://printer.local/",
    "file:///C:/Windows/win.ini", "ftp://example.com/x", "data:text/html,<b>hi</b>",
    "javascript:alert(1)", "gopher://example.com/",
    "https://user:password@example.com/",
  ];
  for (const url of refused) {
    assert.equal(evaluateResearchUrl(url).allowed, false, `${url} was accepted as a research target`);
  }
});

test("ordinary public sites are still allowed", () => {
  for (const url of [
    "https://www.leg.state.fl.us/statutes/index.cfm?x=1",
    "https://www.care.com/c/what-companion-caregiving-pays/",
    "https://www.bls.gov/oes/current/oes311120.htm",
  ]) {
    assert.equal(evaluateResearchUrl(url).allowed, true, `${url} was refused`);
  }
});

test("a public name that resolves to a private address is refused", async () => {
  /* The rebinding shape: the name looks fine and the answer is not. */
  const resolver = async () => [{ address: "127.0.0.1", family: 4 }];
  await assert.rejects(() => assertPublicHost("looks-public.example", resolver), /private|loopback/iu);

  /* One bad answer among good ones is still bad. */
  const mixed = async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.7", family: 4 }];
  await assert.rejects(() => assertPublicHost("looks-public.example", mixed), /10\.0\.0\.7/u);

  /* And a wholly public answer is returned, so the caller can pin the connection to it. */
  const good = async () => [{ address: "93.184.216.34", family: 4 }];
  assert.deepEqual(await assertPublicHost("example.com", good), ["93.184.216.34"]);
});

/* -------------------------------------------------------------------------- */
/* The route refuses until it is wired, against a server that would answer     */
/* -------------------------------------------------------------------------- */

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("an unwired research route refuses even though a server is listening", async () => {
  clearOutwardRoute("research.fetch");
  assert.equal(outwardRouteStatus("research.fetch"), "TECHNICALLY_DISABLED");
  let reached = false;
  await withServer((_request, response) => { reached = true; response.end("secret"); }, async (port) => {
    await assert.rejects(() => fetchPublicDocument(`http://127.0.0.1:${port}/`));
  });
  assert.equal(reached, false, "a request reached the server while the route was unwired");
});

test("a wired route still refuses a loopback destination", async () => {
  /*
   * Activation is not permission to go anywhere. With the route gated and the gate allowing, the
   * destination rule is what stops this — which is the layering the whole design depends on.
   */
  registerOutwardRoute("research.fetch", () => ({ allowed: true, reason: "test" }));
  try {
    assert.equal(outwardRouteStatus("research.fetch"), "GATED");
    let reached = false;
    await withServer((_request, response) => { reached = true; response.end("secret"); }, async (port) => {
      await assert.rejects(() => fetchPublicDocument(`http://127.0.0.1:${port}/`), /private|loopback|refus/iu);
    });
    assert.equal(reached, false, "an authorized route reached loopback");
  } finally {
    clearOutwardRoute("research.fetch");
  }
});

test("activation without Owner authority leaves the routes refused", () => {
  clearOutwardRoute("research.fetch");
  clearOutwardRoute("research.publicSearch");
  const result = activateResearchRoutes({});
  assert.deepEqual(result.activated, []);
  assert.equal(outwardRouteStatus("research.fetch"), "TECHNICALLY_DISABLED");
  assert.equal(outwardRouteStatus("research.publicSearch"), "TECHNICALLY_DISABLED");
});

test("activation wires both routes to a decision function, not a flag", async () => {
  clearOutwardRoute("research.fetch");
  clearOutwardRoute("research.publicSearch");
  const asked = [];
  const result = activateResearchRoutes({
    authority: {
      actorId: "a", ownerId: "o", parentMilestoneId: "m",
      authorityEnvelopeId: "e", ownerAuthorizationId: "auth", proposedByProvider: "local",
    },
    envelopeFor: (id) => { asked.push(id); return null; },
    now: () => "2026-08-22T00:00:00Z",
  });
  assert.deepEqual(result.activated.sort(), ["research.fetch", "research.publicSearch"]);
  assert.equal(outwardRouteStatus("research.fetch"), "GATED");

  /*
   * Gated is not allowed. The envelope resolver returns nothing, so the gate refuses — which proves
   * the authorizer is consulted per call rather than having flipped a switch at activation time.
   */
  await assert.rejects(() => fetchPublicDocument("https://example.com/"), /refus/iu);
  assert.ok(asked.length > 0, "the envelope was never consulted, so the decision was not real");
  clearOutwardRoute("research.fetch");
  clearOutwardRoute("research.publicSearch");
});

/* -------------------------------------------------------------------------- */
/* Provenance the fetch itself is responsible for                              */
/* -------------------------------------------------------------------------- */

test("a publication date is read from the markup, in every form the page might state it", () => {
  assert.equal(
    extractPublishedAt('<meta property="article:published_time" content="2024-03-01T00:00:00Z">'),
    "2024-03-01T00:00:00.000Z",
  );
  /* JSON-LD, which a lost backslash silently stopped matching until a review caught it. */
  assert.equal(
    extractPublishedAt('<script type="application/ld+json">{"datePublished" : "2023-05-23T19:52:57Z"}</script>'),
    "2023-05-23T19:52:57.000Z",
  );
  assert.equal(extractPublishedAt('<time datetime="2025-12-30T10:02:33Z">then</time>'), "2025-12-30T10:02:33.000Z");
  /* A page that states nothing gets nothing, rather than the time it was fetched. */
  assert.equal(extractPublishedAt("<html><body>no date anywhere</body></html>"), "");
  assert.equal(extractPublishedAt(undefined), "");
  /* Unparseable is not a date either. */
  assert.equal(extractPublishedAt('<time datetime="last Tuesday">then</time>'), "");
});

/* -------------------------------------------------------------------------- */
/* The pin itself, driven directly                                             */
/* -------------------------------------------------------------------------- */

test("the pinned transport refuses before it opens a socket when the route is unwired", async () => {
  clearOutwardRoute("research.fetch");
  await assert.rejects(
    () => outwardFetchPinned("research.fetch", "http://93.184.216.34/", ["93.184.216.34"]),
    /not wired to the pre-action effect gate/u,
  );
});


test("the registered authorizer sees the query, not an unnamed target", () => {
  /*
   * The reviewer's point, and it survived one fix: the fetch call site sends `{ url, query: "" }` and
   * the search call site sends `{ url: "", query }`, so `request?.url ?? request?.query` read the
   * empty url — `""` is not nullish — and every search authorized "(unnamed)". The earlier test only
   * recorded what the Director passed to `assertRouteActivated`; it never ran this authorizer, so the
   * bug sat behind a green test. This drives the real registered function.
   */
  clearOutwardRoute("research.fetch");
  clearOutwardRoute("research.publicSearch");
  activateResearchRoutes({
    authority: {
      actorId: "a", ownerId: "o", parentMilestoneId: "m",
      authorityEnvelopeId: "e", ownerAuthorizationId: "auth", proposedByProvider: "local",
    },
    envelopeFor: () => null,
    now: () => "2026-08-22T00:00:00Z",
  });
  try {
    const search = outwardEffectDecision("research.publicSearch", { url: "", query: "what do agencies charge" });
    assert.match(search.reason, /what do agencies charge/u,
      "the search authorizer never saw the query");
    assert.doesNotMatch(search.reason, /\(unnamed\)/u);

    const fetchOne = outwardEffectDecision("research.fetch", { url: "https://example.com/a", query: "" });
    const fetchTwo = outwardEffectDecision("research.fetch", { url: "https://example.com/b", query: "" });
    assert.match(fetchOne.reason, /example\.com\/a/u);
    assert.notEqual(fetchOne.reason, fetchTwo.reason, "two different pages produced one decision");

    /* Both are refused, because the envelope resolver returns nothing — the target is what varies. */
    assert.equal(search.allowed, false);
    assert.equal(fetchOne.allowed, false);
  } finally {
    clearOutwardRoute("research.fetch");
    clearOutwardRoute("research.publicSearch");
  }
});

test("the pin hands back the validated addresses and never consults the hostname", async () => {
  /*
   * The earlier version of this test started a server and then only asserted that private pins throw,
   * so deleting the `lookup` hook would not have failed it. The success path is what proves the pin,
   * and it cannot be proved against a loopback server because loopback is refused by design. So the
   * hook is driven directly: a resolver that would answer differently is present, and never asked.
   */
  registerOutwardRoute("research.fetch", () => ({ allowed: true, reason: "test" }));
  try {
    const pinned = ["93.184.216.34", "93.184.216.35"];
    /*
     * `example.invalid` cannot resolve. If the pin were ignored and the name resolved instead, this
     * would fail with a DNS error rather than a connection error — the two are distinguishable, and
     * the distinction is the whole assertion.
     */
    const failure = await outwardFetchPinned(
      "research.fetch", "http://example.invalid:9/", pinned,
    ).then(() => null, (error) => error);
    assert.ok(failure instanceof Error, "the request should have failed against a dead port");
    assert.doesNotMatch(String(failure.code ?? failure.message), /ENOTFOUND|EAI_AGAIN/u,
      `the hostname was resolved instead of using the pinned address: ${failure.message}`);
  } finally {
    clearOutwardRoute("research.fetch");
  }
});

test("a response the walk does not read is ended rather than left open", async () => {
  /*
   * The earlier version pinned a private address, so nothing connected, and then asserted
   * `closed >= 0` — true of every number. Removing every `destroy` would have kept it green. This
   * drives the real `fetchPublicDocument` through the transport seam and counts the calls.
   */
  const destroyed = [];
  const responseFor = (status, headers, body) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    destroy: () => { destroyed.push(status); },
    body: { getReader: () => ({ async read() { return { done: true, value: undefined }; }, async cancel() {} }) },
  });

  const PUBLIC = async () => [{ address: "93.184.216.34", family: 4 }];

  /* The route has to be gated, or the walk refuses before any response exists to end. */
  registerOutwardRoute("research.fetch", () => ({ allowed: true, reason: "test" }));

  /* A redirect is read for its destination and abandoned: it must be ended. */
  destroyed.length = 0;
  await assert.rejects(() => fetchPublicDocument("https://example.invalid/start", {
    resolver: PUBLIC,
    now: () => "2026-08-22T00:00:00Z",
    transport: async () => responseFor(302, { location: "http://192.168.1.1/setup" }, ""),
  }));
  assert.deepEqual(destroyed, [302], "a redirect hop left its connection open");

  /* A non-OK status is refused and ended. */
  destroyed.length = 0;
  await assert.rejects(() => fetchPublicDocument("https://example.invalid/gone", {
    resolver: PUBLIC,
    now: () => "2026-08-22T00:00:00Z",
    transport: async () => responseFor(404, {}, ""),
  }));
  assert.deepEqual(destroyed, [404], "a 404 left its connection open");

  /* A content type this capability will not read is refused before the body, and ended. */
  destroyed.length = 0;
  await assert.rejects(() => fetchPublicDocument("https://example.invalid/file", {
    resolver: PUBLIC,
    now: () => "2026-08-22T00:00:00Z",
    transport: async () => responseFor(200, { "content-type": "application/octet-stream" }, ""),
  }), /reads text documents only/u);
  assert.deepEqual(destroyed, [200], "a refused content type left its connection open");
  clearOutwardRoute("research.fetch");
});
