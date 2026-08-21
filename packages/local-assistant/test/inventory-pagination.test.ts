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
  /*
   * The connector now takes the approved outward transport rather than a bare fetch. The stub
   * records the route id as well as the URL, so "which permission was this crawl made under" is
   * part of what the test observes.
   */
  const routes: string[] = [];
  const outward = {
    async request(routeId: string, url: string) {
      calls++;
      routes.push(routeId);
      const body = pages.get(String(url)) ?? page([], null);
      return { ok: true, url: String(url), arrayBuffer: async () => new TextEncoder().encode(body).buffer } as unknown as Response;
    },
  } as never;

  let n = 0;
  const res = await refreshDealershipPublicInventory({
    dealership: { slug: "paging-test-dealer", name: "Paging Test Dealer", inventoryNewUrl: BASE, inventoryUsedUrl: BASE, publicWebsite: "https://www.lakelandtoyota.com" } as never,
    now: "2026-08-12T00:00:00.000Z",
    nextId: (k: string) => `${k}-${++n}`,
    outward,
    maxPagesPerUrl: 2,
    pageDelayMs: 0,
  });
  assert.equal(calls, 2, "must not fetch beyond the page cap");
  assert.deepEqual([...new Set(routes)], ["dealership.inventoryCrawl"], "the crawl must ask for its own route");
  assert.equal(res.listings.length, 4, "listings accumulate across paged requests");
});

test("pagination stops when a page contributes no new vehicles", async () => {
  const repeated = page([vinAt(1), vinAt(2)], `${BASE}?pt=2`);
  let calls = 0;
  const outward = {
    async request(_routeId: string, url: string) {
      calls++;
      // Every page returns the same VINs — a real site at the end of results.
      return { ok: true, url: String(url), arrayBuffer: async () => new TextEncoder().encode(repeated).buffer } as unknown as Response;
    },
  } as never;

  let n = 0;
  const res = await refreshDealershipPublicInventory({
    dealership: { slug: "paging-test-dealer", name: "Paging Test Dealer", inventoryNewUrl: BASE, inventoryUsedUrl: BASE, publicWebsite: "https://www.lakelandtoyota.com" } as never,
    now: "2026-08-12T00:00:00.000Z",
    nextId: (k: string) => `${k}-${++n}`,
    outward,
    maxPagesPerUrl: 10,
    pageDelayMs: 0,
  });
  assert.ok(calls <= 2, `must stop once a page adds nothing new (fetched ${calls})`);
  assert.equal(res.listings.length, 2, "duplicate VINs are not double-counted");
});

test("latestPrice reports the most recent known price, not a null observation", async () => {
  const { latestPrice } = await import("../src/vehicle-intelligence.js");
  // A refresh that saw no published price prepends an all-null observation. The real price
  // recorded earlier must still be reported, or price filters silently return nothing.
  const vehicle = {
    priceHistory: [
      { at: "2026-08-12T01:00:00.000Z", advertisedPrice: null, msrp: null, dealerPrice: null },
      { at: "2026-08-11T23:00:00.000Z", advertisedPrice: 28995, msrp: null, dealerPrice: null },
    ],
  } as never;
  assert.equal(latestPrice(vehicle), 28995);

  const neverPriced = { priceHistory: [{ at: "x", advertisedPrice: null, msrp: null, dealerPrice: null }] } as never;
  assert.equal(latestPrice(neverPriced), null, "unknown stays unknown — never invented");

  const msrpOnly = { priceHistory: [{ at: "x", advertisedPrice: null, msrp: 31000, dealerPrice: null }] } as never;
  assert.equal(latestPrice(msrpOnly), 31000);
});

test("budget phrasing parses k-suffixed and bare thousands", async () => {
  const { parseMaxPriceFromText } = await import("../src/vehicle-intelligence.js");
  assert.equal(parseMaxPriceFromText("show me camrys under 30k"), 30000);
  assert.equal(parseMaxPriceFromText("under $30,000"), 30000);
  assert.equal(parseMaxPriceFromText("below 25K"), 25000);
  assert.equal(parseMaxPriceFromText("less than 40k"), 40000);
  assert.equal(parseMaxPriceFromText("under 30"), 30000, "a bare small number means thousands");
  assert.equal(parseMaxPriceFromText("what hybrids do we have"), null);
});

test("price history records observed prices, never the act of looking", async () => {
  const { applyOnlineListings, emptyVehicleInventoryState } = await import("../src/vehicle-inventory.js");
  const now = "2026-08-12T02:00:00.000Z";
  const dealership = { id: "d1", slug: "lakeland-toyota", name: "Lakeland Toyota" } as never;
  const listing = (advertisedPrice: number | null, at: string) => ([{
    id: "l1", retrievedAt: at, sourceUrl: "https://x/searchused.aspx", sourceType: "public-dealer-site",
    vin: "4T1G11AK2PU131060", stockNumber: null, year: 2023, make: "Toyota", model: "Camry", trim: "SE",
    condition: "used", exteriorColor: null, interiorColor: null, mileage: null,
    advertisedPrice, msrp: null, dealerPrice: null, listingUrl: "u", detailUrl: "u",
    availability: "available", raw: {},
  }] as never);

  let n = 0;
  const nextId = (k: string) => `${k}-${++n}`;
  let st = emptyVehicleInventoryState();

  st = applyOnlineListings(st, dealership, listing(29640, now), now, nextId).state;
  assert.equal(st.vehicles[0]!.priceHistory.length, 1);
  assert.equal(st.vehicles[0]!.priceHistory[0]!.advertisedPrice, 29640);

  // A later page with no published price must NOT append a null observation.
  st = applyOnlineListings(st, dealership, listing(null, "2026-08-12T03:00:00.000Z"), "2026-08-12T03:00:00.000Z", nextId).state;
  assert.equal(st.vehicles[0]!.priceHistory.length, 1, "price-absent refresh must not grow history");
  assert.equal(st.vehicles[0]!.priceHistory[0]!.advertisedPrice, 29640, "the known price survives");

  // The same price again must not bloat history.
  st = applyOnlineListings(st, dealership, listing(29640, "2026-08-12T04:00:00.000Z"), "2026-08-12T04:00:00.000Z", nextId).state;
  assert.equal(st.vehicles[0]!.priceHistory.length, 1, "identical price must not append");

  // A genuine price change is preserved as history.
  const changed = applyOnlineListings(st, dealership, listing(27995, "2026-08-12T05:00:00.000Z"), "2026-08-12T05:00:00.000Z", nextId);
  st = changed.state;
  assert.equal(st.vehicles[0]!.priceHistory.length, 2, "changed price appends");
  assert.equal(st.vehicles[0]!.priceHistory[0]!.advertisedPrice, 27995, "newest first");
  assert.equal(st.vehicles[0]!.priceHistory[1]!.advertisedPrice, 29640, "older price preserved");
  assert.equal(changed.temporal.priceChanged, 1);
});

test("scoped used refresh does not mark new inventory as missing", async () => {
  const { applyOnlineListings, emptyVehicleInventoryState, listingFromPartial, buildDealershipContext } =
    await import("../src/vehicle-inventory.js");
  const now = "2026-08-12T02:00:00.000Z";
  const dealer = buildDealershipContext(
    { name: "Lakeland Toyota", slug: "lakeland-toyota", isCurrent: true },
    { id: "d1", now },
  );
  let n = 0;
  const nextId = (k: string) => `${k}-${++n}`;
  let st = emptyVehicleInventoryState();
  const newListing = listingFromPartial(
    { vin: "4T1G11AK2PU131060", year: 2026, make: "Toyota", model: "Camry", condition: "new", advertisedPrice: 30000 },
    { id: nextId("listing"), now, sourceUrl: "https://www.lakelandtoyota.com/searchnew.aspx", sourceType: "public-dealer-site" },
  );
  st = applyOnlineListings(st, dealer, [newListing], now, nextId, { conditionScope: "new" }).state;
  assert.equal(st.vehicles[0]!.condition, "new");

  // Used-only batch with a different VIN must not wipe the new car.
  const usedListing = listingFromPartial(
    { vin: "5YFB4MDE5TP490001", year: 2022, make: "Toyota", model: "Corolla", condition: "used", advertisedPrice: 18000 },
    { id: nextId("listing"), now, sourceUrl: "https://www.lakelandtoyota.com/searchused.aspx", sourceType: "public-dealer-site" },
  );
  const usedPass = applyOnlineListings(st, dealer, [usedListing], now, nextId, {
    conditionScope: "used",
    reconcileMissing: true,
  });
  st = usedPass.state;
  assert.equal(st.vehicles.length, 2);
  assert.equal(
    st.vehicles.find((v) => v.condition === "new")?.presenceStatus,
    "ONLINE_LISTED",
    "new inventory must survive a used-only refresh",
  );
  assert.equal(usedPass.temporal.noLongerFoundOnline, 0);
});
