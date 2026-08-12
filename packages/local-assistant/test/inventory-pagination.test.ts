/**
 * Public inventory pagination regressions.
 *
 * Coverage was capped at one page per URL (24 vehicles) because the refresher never followed the
 * site's paging. These pin the two things that matter: we follow the link the site actually
 * publishes rather than guessing `?page=N`, and we stop politely — at the last page, on a repeat,
 * when a page adds nothing new, or at the page cap.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { findNextPageUrl, refreshDealershipPublicInventory } from "../src/connectors/dealership-inventory.js";

const BASE = "https://www.lakelandtoyota.com/searchnew.aspx";

test("next page comes from the site's own rel=next link", () => {
  assert.equal(
    findNextPageUrl('<link rel="next" href="/searchnew.aspx?pt=2">', BASE),
    "https://www.lakelandtoyota.com/searchnew.aspx?pt=2",
  );
  assert.equal(
    findNextPageUrl('<a class="x" rel="next" href="?pt=3">Next</a>', BASE),
    "https://www.lakelandtoyota.com/searchnew.aspx?pt=3",
  );
  assert.equal(findNextPageUrl('<a href="?pt=4" rel="next">Next</a>', BASE), "https://www.lakelandtoyota.com/searchnew.aspx?pt=4");
  assert.equal(findNextPageUrl("&amp;-escaped", BASE), null, "no rel=next means no next page");
});

test("next link never leaves the dealership host and never self-loops", () => {
  assert.equal(findNextPageUrl('<link rel="next" href="https://evil.example.com/x">', BASE), null);
  assert.equal(findNextPageUrl('<link rel="next" href="javascript:alert(1)">', BASE), null);
  assert.equal(findNextPageUrl(`<link rel="next" href="${BASE}">`, BASE), null, "self-referential next must stop paging");
});

function page(vins: string[], next: string | null): string {
  const cards = vins
    .map(
      (vin) =>
        `{"vin":"${vin}","year":2026,"make":"Toyota","model":"Corolla","trim":"LE","msrp":25000,"stockNumber":"S${vin.slice(-4)}"}`,
    )
    .join(",");
  return `<html>${next ? `<link rel="next" href="${next}">` : ""}<script>var inventory=[${cards}];</script></html>`;
}

function vinAt(n: number): string {
  return `5YFB4MDEXTP4900${String(n).padStart(2, "0")}`;
}

test("pagination accumulates across pages and stops at the page cap", async () => {
  const pages = new Map<string, string>([
    [BASE, page([vinAt(1), vinAt(2)], `${BASE}?pt=2`)],
    [`${BASE}?pt=2`, page([vinAt(3), vinAt(4)], `${BASE}?pt=3`)],
    [`${BASE}?pt=3`, page([vinAt(5), vinAt(6)], `${BASE}?pt=4`)],
  ]);
  let calls = 0;
  const fetchImpl = (async (url: string) => {
    calls++;
    const body = pages.get(String(url)) ?? page([], null);
    return { ok: true, url: String(url), arrayBuffer: async () => new TextEncoder().encode(body).buffer } as unknown as Response;
  }) as unknown as typeof fetch;

  let n = 0;
  const res = await refreshDealershipPublicInventory({
    dealership: { slug: "paging-test-dealer", name: "Paging Test Dealer", inventoryNewUrl: BASE, inventoryUsedUrl: BASE, publicWebsite: "https://www.lakelandtoyota.com" } as never,
    now: "2026-08-12T00:00:00.000Z",
    nextId: (k: string) => `${k}-${++n}`,
    fetchImpl,
    maxPagesPerUrl: 2,
    pageDelayMs: 0,
  });
  assert.equal(calls, 2, "must not fetch beyond the page cap");
  assert.equal(res.listings.length, 4, "listings accumulate across paged requests");
});

test("pagination stops when a page contributes no new vehicles", async () => {
  const repeated = page([vinAt(1), vinAt(2)], `${BASE}?pt=2`);
  let calls = 0;
  const fetchImpl = (async (url: string) => {
    calls++;
    // Every page returns the same VINs — a real site at the end of results.
    return { ok: true, url: String(url), arrayBuffer: async () => new TextEncoder().encode(repeated).buffer } as unknown as Response;
  }) as unknown as typeof fetch;

  let n = 0;
  const res = await refreshDealershipPublicInventory({
    dealership: { slug: "paging-test-dealer", name: "Paging Test Dealer", inventoryNewUrl: BASE, inventoryUsedUrl: BASE, publicWebsite: "https://www.lakelandtoyota.com" } as never,
    now: "2026-08-12T00:00:00.000Z",
    nextId: (k: string) => `${k}-${++n}`,
    fetchImpl,
    maxPagesPerUrl: 10,
    pageDelayMs: 0,
  });
  assert.ok(calls <= 2, `must stop once a page adds nothing new (fetched ${calls})`);
  assert.equal(res.listings.length, 2, "duplicate VINs are not double-counted");
});
