import assert from "node:assert/strict";
import test from "node:test";
import { PublicUrlResearchProviderV1, assertPublicHost, extractText, extractTitle, fetchPublicDocument } from "../../apps/aion/research-fetch.mjs";

/**
 * The live-fetch boundary, tested without touching the network.
 *
 * DNS is injected, and `globalThis.fetch` is replaced for the duration of each case. Nothing here
 * resolves a real name or opens a real socket — which matters, because the thing being tested is
 * precisely what AION refuses to reach.
 */

const NOW = "2030-01-01T00:00:00.000Z";
const resolverFor = (map) => async (hostname) => {
  const addresses = map[hostname];
  if (!addresses) throw new Error("NXDOMAIN");
  return addresses;
};
const PUBLIC = resolverFor({ "example.invalid": [{ address: "203.0.113.10", family: 4 }], "elsewhere.invalid": [{ address: "203.0.113.11", family: 4 }] });

/** Replaces fetch for one case and always puts it back. */
async function withFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  try { return await run(); } finally { globalThis.fetch = original; }
}
const html = (body, title = "A page") => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const ok = (body, headers = {}) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

test("a public name that resolves to a private address is refused", async () => {
  const sneaky = resolverFor({ "public-looking.invalid": [{ address: "192.168.1.50", family: 4 }] });
  await assert.rejects(
    () => assertPublicHost("public-looking.invalid", sneaky),
    /resolves to 192\.168\.1\.50, which is on a private, loopback, or link-local network/u,
  );

  const mixed = resolverFor({ "mixed.invalid": [{ address: "203.0.113.10", family: 4 }, { address: "10.0.0.5", family: 4 }] });
  await assert.rejects(() => assertPublicHost("mixed.invalid", mixed), /10\.0\.0\.5/u, "one bad answer is enough to refuse");

  const v6 = resolverFor({ "six.invalid": [{ address: "fd00::1", family: 6 }] });
  await assert.rejects(() => assertPublicHost("six.invalid", v6), /private, loopback, or link-local/u);
});

test("a name that resolves only to public addresses is allowed", async () => {
  assert.deepEqual(await assertPublicHost("example.invalid", PUBLIC), ["203.0.113.10"]);
  await assert.rejects(() => assertPublicHost("nowhere.invalid", PUBLIC), /could not resolve/u);
  await assert.rejects(() => assertPublicHost("127.0.0.1", PUBLIC), /private or loopback address/u);
});

test("a document is fetched with no credentials, no cookies, and no referrer", async () => {
  let seen = null;
  await withFetch(async (url, init) => { seen = { url, init }; return ok(html("<p>Handover practices lose detail.</p>")); }, async () => {
    const document = await fetchPublicDocument("https://example.invalid/study", { resolver: PUBLIC, now: () => NOW });
    assert.equal(document.url, "https://example.invalid/study");
    assert.equal(document.title, "A page");
    assert.match(document.text, /Handover practices lose detail/u);
    assert.equal(document.retrievedAt, NOW);
    assert.equal(document.digest.length, 64);
    assert.deepEqual(document.redirects, []);
  });
  assert.equal(seen.init.credentials, "omit");
  assert.equal(seen.init.referrerPolicy, "no-referrer");
  assert.equal(seen.init.redirect, "manual", "redirects are judged by AION, not followed by the runtime");
  assert.equal("cookie" in seen.init.headers, false);
  assert.equal("authorization" in seen.init.headers, false);
});

test("a redirect into private space is refused at the hop", async () => {
  await withFetch(
    async (url) => url.includes("/start")
      ? new Response(null, { status: 302, headers: { location: "http://192.168.1.1/setup" } })
      : ok(html("should never be reached")),
    async () => {
      await assert.rejects(
        () => fetchPublicDocument("https://example.invalid/start", { resolver: PUBLIC, now: () => NOW }),
        /tried to redirect to somewhere AION will not follow.*private, loopback, or link-local/su,
      );
    },
  );
});

test("a redirect to another public page is followed and recorded", async () => {
  await withFetch(
    async (url) => url.includes("/start")
      ? new Response(null, { status: 301, headers: { location: "https://elsewhere.invalid/final" } })
      : ok(html("<p>The real content.</p>", "Final page")),
    async () => {
      const document = await fetchPublicDocument("https://example.invalid/start", { resolver: PUBLIC, now: () => NOW });
      assert.equal(document.url, "https://elsewhere.invalid/final");
      assert.equal(document.title, "Final page");
      assert.deepEqual(document.redirects, ["https://example.invalid/start"], "the chain is kept as provenance");
    },
  );
});

test("an endless redirect chain stops rather than being followed", async () => {
  let hop = 0;
  await withFetch(
    async () => { hop += 1; return new Response(null, { status: 302, headers: { location: `https://example.invalid/hop-${hop}` } }); },
    async () => {
      await assert.rejects(() => fetchPublicDocument("https://example.invalid/start", { resolver: PUBLIC, now: () => NOW }), /redirected more than 4 times/u);
    },
  );
  assert.ok(hop <= 6, "AION gave up rather than chasing it");
});

test("an oversized response is truncated at the byte ceiling rather than read whole", async () => {
  const huge = html(`<p>${"x".repeat(200_000)}</p>`);
  await withFetch(async () => ok(huge), async () => {
    const document = await fetchPublicDocument("https://example.invalid/big", { resolver: PUBLIC, now: () => NOW, maxBytes: 4096 });
    assert.equal(document.truncated, true);
    assert.ok(document.bytes <= 4096);
  });
});

test("a non-text response is refused", async () => {
  await withFetch(async () => new Response("binary", { status: 200, headers: { "content-type": "application/octet-stream" } }), async () => {
    await assert.rejects(() => fetchPublicDocument("https://example.invalid/file", { resolver: PUBLIC, now: () => NOW }), /AION reads text documents only/u);
  });
  await withFetch(async () => new Response("nope", { status: 404, headers: { "content-type": "text/html" } }), async () => {
    await assert.rejects(() => fetchPublicDocument("https://example.invalid/gone", { resolver: PUBLIC, now: () => NOW }), /answered 404/u);
  });
});

test("the name guard still runs before DNS is ever consulted", async () => {
  let resolved = false;
  const spy = async (...args) => { resolved = true; return PUBLIC(...args); };
  for (const url of ["http://localhost/x", "file:///C:/secrets.txt", "http://169.254.169.254/latest/meta-data/", "http://user:token@example.invalid/"]) {
    await assert.rejects(() => fetchPublicDocument(url, { resolver: spy, now: () => NOW }));
  }
  assert.equal(resolved, false, "nothing was resolved, because the URL never got that far");
});

test("markup is stripped, and script content never reaches the extracted text", () => {
  const page = html('<script>var secret = "do not read me";</script><style>p{color:red}</style><p>Visible &amp; readable.</p><!-- hidden -->', "Title & more");
  assert.equal(extractTitle(page), "Title & more");
  const text = extractText(page);
  assert.match(text, /Visible & readable\./u);
  assert.doesNotMatch(text, /do not read me/u, "script bodies are removed, not merely un-rendered");
  assert.doesNotMatch(text, /color:red/u);
  assert.doesNotMatch(text, /hidden/u);
  assert.doesNotMatch(text, /</u, "no markup survives");
});

test("the public-URL provider quotes what a page said and never calls it a fact", async () => {
  await withFetch(async () => ok(html("<p>A survey of handover practices found that detail is lost between shifts.</p>", "Handover study")), async () => {
    const provider = new PublicUrlResearchProviderV1({ resolver: PUBLIC, now: () => NOW });
    const result = await provider.run({
      question: "handover practices", scope: "owner-supplied-sources",
      limits: { maxSources: 4, maxBytesPerSource: 512 * 1024, maxDurationMs: 10_000, maxCostCents: 0 },
      seedReferences: ["https://example.invalid/study"], signal: new AbortController().signal,
    });
    assert.equal(result.sources.length, 1);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].class, "observation", "never a fact");
    assert.match(result.findings[0].statement, /Handover study states:/u);
    assert.match(result.findings[0].caveat, /It is not a fact and AION has not checked it/u);
    assert.equal(result.costCents, 0);
  });
});

test("a local-only job makes no request at all", async () => {
  await withFetch(async () => { throw new Error("the network must not be touched"); }, async () => {
    const result = await new PublicUrlResearchProviderV1({ resolver: PUBLIC }).run({
      question: "anything", scope: "local-only",
      limits: { maxSources: 4, maxBytesPerSource: 1024, maxDurationMs: 1000, maxCostCents: 0 },
      seedReferences: ["https://example.invalid/study"], signal: new AbortController().signal,
    });
    assert.deepEqual(result.sources, []);
    assert.match(result.unresolved[0], /scoped local-only, so AION made no network request/u);
  });
});

test("a source that cannot be read is reported rather than silently dropped", async () => {
  await withFetch(async () => new Response("nope", { status: 500, headers: { "content-type": "text/html" } }), async () => {
    const result = await new PublicUrlResearchProviderV1({ resolver: PUBLIC, now: () => NOW }).run({
      question: "handover", scope: "public-web",
      limits: { maxSources: 4, maxBytesPerSource: 1024, maxDurationMs: 5000, maxCostCents: 0 },
      seedReferences: ["https://example.invalid/broken"], signal: new AbortController().signal,
    });
    assert.deepEqual(result.sources, []);
    assert.deepEqual(result.findings, []);
    assert.match(result.unresolved[0], /could not be read/u);
  });
});
