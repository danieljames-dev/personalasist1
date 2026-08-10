/**
 * Public dealership inventory connector.
 *
 * Fetches only public HTTP pages (no login, no internal DMS).
 * Designed generically; Lakeland Toyota is the first configured dealer.
 *
 * Online listings are observations — never proof of physical on-lot presence.
 */
import {
  listingFromPartial,
  type DealershipContextV1,
  type InventoryListingObservationV1,
  LAKELAND_TOYOTA_DEFAULT,
} from "../vehicle-inventory.js";

export interface DealershipInventoryRefreshResultV1 {
  dealershipSlug: string;
  dealershipName: string;
  retrievedAt: string;
  sourceUrls: string[];
  listings: InventoryListingObservationV1[];
  mode: "live" | "fixture" | "partial";
  message: string;
  truncated: boolean;
}

export interface DealershipConnectorProfileV1 {
  slug: string;
  name: string;
  publicWebsite: string;
  inventoryUrls: string[];
  /** Optional JSON/API hints when the public site exposes them. */
  parseHints: string[];
}

export const DEALERSHIP_PROFILES: readonly DealershipConnectorProfileV1[] = [
  {
    slug: LAKELAND_TOYOTA_DEFAULT.slug,
    name: LAKELAND_TOYOTA_DEFAULT.name,
    publicWebsite: LAKELAND_TOYOTA_DEFAULT.publicWebsite,
    inventoryUrls: [
      LAKELAND_TOYOTA_DEFAULT.inventoryNewUrl,
      LAKELAND_TOYOTA_DEFAULT.inventoryUsedUrl,
      "https://www.lakelandtoyota.com/inventorylineup.aspx",
    ],
    parseHints: ["dealer.com", "vehicle", "vin", "stock"],
  },
];

export function dealershipProfileFor(slugOrName: string): DealershipConnectorProfileV1 | null {
  const key = String(slugOrName ?? "").toLowerCase().trim();
  return (
    DEALERSHIP_PROFILES.find(
      (p) => p.slug === key || p.name.toLowerCase() === key || key.includes(p.slug),
    ) ?? null
  );
}

/** Extract VIN-like and stock fields from HTML/JSON-ish public markup. */
export function parsePublicInventoryHtml(
  html: string,
  sourceUrl: string,
  now: string,
  nextId: (kind: string) => string,
  conditionHint: "new" | "used" | "unknown" = "unknown",
): InventoryListingObservationV1[] {
  const text = String(html ?? "");
  const listings: InventoryListingObservationV1[] = [];
  const seen = new Set<string>();

  // JSON-LD Vehicle blocks
  const ldBlocks = text.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of ldBlocks) {
    const body = block.replace(/^[\s\S]*?>/u, "").replace(/<\/script>/iu, "");
    try {
      const data = JSON.parse(body);
      const items = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const type = String(item["@type"] ?? "");
        if (!/Vehicle|Car|Product/i.test(type) && !item.vehicleIdentificationNumber) continue;
        const vin = item.vehicleIdentificationNumber || item.vin || null;
        const key = String(vin || item.sku || item.name || Math.random());
        if (seen.has(key)) continue;
        seen.add(key);
        listings.push(
          listingFromPartial(
            {
              vin,
              stockNumber: item.sku || item.stockNumber || null,
              year: item.vehicleModelDate || item.modelDate || null,
              make: item.brand?.name || item.manufacturer || item.make || null,
              model: item.model || item.name || null,
              trim: item.vehicleConfiguration || item.trim || null,
              condition: conditionHint,
              exteriorColor: item.color || item.vehicleInteriorColor || null,
              mileage: item.mileageFromOdometer?.value || item.mileage || null,
              advertisedPrice: item.offers?.price || item.price || null,
              msrp: item.msrp || null,
              listingUrl: item.url || sourceUrl,
              detailUrl: item.url || sourceUrl,
              availability: item.offers?.availability || null,
            },
            { id: nextId("listing"), now, sourceUrl, sourceType: "public-dealer-site" },
          ),
        );
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  // Embedded window.__INITIAL_STATE__ / inventory JSON blobs with "vin"
  const vinJson = text.matchAll(/"vin"\s*:\s*"([A-HJ-NPR-Z0-9]{17})"/gi);
  for (const m of vinJson) {
    const vin = m[1]!.toUpperCase();
    if (seen.has(vin)) continue;
    seen.add(vin);
    // Try to grab nearby stock/price within a window
    const start = Math.max(0, (m.index ?? 0) - 400);
    const window = text.slice(start, start + 900);
    const stock = window.match(/"stock(?:Number|No)?"\s*:\s*"([^"]{1,40})"/i)?.[1] ?? null;
    const year = window.match(/"year"\s*:\s*(\d{4})/i)?.[1] ?? null;
    const make = window.match(/"make"\s*:\s*"([^"]{1,40})"/i)?.[1] ?? null;
    const model = window.match(/"model"\s*:\s*"([^"]{1,60})"/i)?.[1] ?? null;
    const trim = window.match(/"trim"\s*:\s*"([^"]{1,80})"/i)?.[1] ?? null;
    const price = window.match(/"(?:internetPrice|sellingPrice|price|finalPrice)"\s*:\s*(\d+)/i)?.[1] ?? null;
    const msrp = window.match(/"msrp"\s*:\s*(\d+)/i)?.[1] ?? null;
    const miles = window.match(/"(?:miles|mileage|odometer)"\s*:\s*(\d+)/i)?.[1] ?? null;
    listings.push(
      listingFromPartial(
        {
          vin,
          stockNumber: stock,
          year,
          make,
          model,
          trim,
          condition: conditionHint,
          advertisedPrice: price,
          msrp,
          mileage: miles,
          listingUrl: sourceUrl,
          detailUrl: sourceUrl,
        },
        { id: nextId("listing"), now, sourceUrl, sourceType: "public-dealer-site" },
      ),
    );
    if (listings.length >= 500) break;
  }

  // HTML data attributes / visible VIN labels
  if (listings.length < 20) {
    const plainVins = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? [];
    for (const vin of plainVins) {
      const u = vin.toUpperCase();
      if (seen.has(u)) continue;
      if (/[IOQ]/i.test(u)) continue;
      seen.add(u);
      listings.push(
        listingFromPartial(
          { vin: u, condition: conditionHint, listingUrl: sourceUrl, detailUrl: sourceUrl },
          { id: nextId("listing"), now, sourceUrl, sourceType: "public-dealer-site" },
        ),
      );
      if (listings.length >= 200) break;
    }
  }

  return listings;
}

export function buildFixtureLakelandInventory(
  now: string,
  nextId: (kind: string) => string,
  vins: string[],
): InventoryListingObservationV1[] {
  const models = ["Camry", "Tacoma", "Highlander", "RAV4", "Corolla"];
  return vins.map((vin, i) =>
    listingFromPartial(
      {
        vin,
        stockNumber: `L${1000 + i}`,
        year: 2024 + (i % 2),
        make: "Toyota",
        model: models[i % models.length],
        trim: i % 2 === 0 ? "XLE" : "SR5",
        condition: i % 3 === 0 ? "used" : "new",
        exteriorColor: i % 2 === 0 ? "White" : "Black",
        interiorColor: "Black",
        mileage: i % 3 === 0 ? 12000 + i * 100 : 5,
        advertisedPrice: 28000 + i * 1500,
        msrp: 32000 + i * 1500,
        listingUrl: `https://www.lakelandtoyota.com/vehicle/${vin}`,
        detailUrl: `https://www.lakelandtoyota.com/vehicle/${vin}`,
        availability: "available",
      },
      {
        id: nextId("listing"),
        now,
        sourceUrl: "https://www.lakelandtoyota.com/searchnew.aspx",
        sourceType: "fixture",
      },
    ),
  );
}

export async function refreshDealershipPublicInventory(input: {
  dealership: DealershipContextV1;
  now: string;
  nextId: (kind: string) => string;
  fetchImpl?: typeof fetch;
  /** Force fixture path (tests). */
  useFixture?: boolean;
  fixtureVins?: string[];
  maxBytesPerPage?: number;
}): Promise<DealershipInventoryRefreshResultV1> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const maxBytes = input.maxBytesPerPage ?? 1_500_000;
  const profile = dealershipProfileFor(input.dealership.slug) ?? dealershipProfileFor(input.dealership.name);
  const urls = [
    input.dealership.inventoryNewUrl,
    input.dealership.inventoryUsedUrl,
    ...(profile?.inventoryUrls ?? []),
  ].filter(Boolean);
  const uniqueUrls = [...new Set(urls)];

  if (input.useFixture) {
    const vins = input.fixtureVins ?? [];
    const listings = buildFixtureLakelandInventory(input.now, input.nextId, vins);
    return {
      dealershipSlug: input.dealership.slug,
      dealershipName: input.dealership.name,
      retrievedAt: input.now,
      sourceUrls: uniqueUrls,
      listings,
      mode: "fixture",
      message: `Fixture inventory: ${listings.length} listing(s). Not live dealership data.`,
      truncated: false,
    };
  }

  const all: InventoryListingObservationV1[] = [];
  const fetched: string[] = [];
  let truncated = false;
  let liveOk = false;

  for (const url of uniqueUrls.slice(0, 4)) {
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml,application/json",
          "user-agent": "AION-InventoryResearch/1.0 (owner-authorized public inventory; no login)",
        },
        signal: AbortSignal.timeout(25_000),
        redirect: "follow",
      });
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) truncated = true;
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, maxBytes));
      fetched.push(url);
      const condition: "new" | "used" | "unknown" = /used/i.test(url)
        ? "used"
        : /new/i.test(url)
          ? "new"
          : "unknown";
      const parsed = parsePublicInventoryHtml(text, url, input.now, input.nextId, condition);
      // Dedupe by VIN
      const have = new Set(all.map((l) => l.vin).filter(Boolean));
      for (const l of parsed) {
        if (l.vin && have.has(l.vin)) continue;
        if (l.vin) have.add(l.vin);
        all.push(l);
      }
      if (parsed.length) liveOk = true;
    } catch {
      /* continue other URLs */
    }
  }

  if (!liveOk && all.length === 0) {
    return {
      dealershipSlug: input.dealership.slug,
      dealershipName: input.dealership.name,
      retrievedAt: input.now,
      sourceUrls: uniqueUrls,
      listings: [],
      mode: "partial",
      message:
        "Could not parse live public inventory from dealer pages (blocked, empty, or JS-only). Use fixture seed for demos or retry; never invent vehicles.",
      truncated,
    };
  }

  return {
    dealershipSlug: input.dealership.slug,
    dealershipName: input.dealership.name,
    retrievedAt: input.now,
    sourceUrls: fetched.length ? fetched : uniqueUrls,
    listings: all.slice(0, 2000),
    mode: liveOk ? "live" : "partial",
    message: `Public inventory refresh: ${all.length} listing(s) from ${fetched.length || uniqueUrls.length} URL(s). Online listing ≠ physically on lot.`,
    truncated,
  };
}
