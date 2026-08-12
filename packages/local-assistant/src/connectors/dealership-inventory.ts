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

/** Split marketingName like "Corolla LE" / "Camry Hybrid SE" into model + trim when possible. */
function splitMarketingName(marketingName: string | null, series: string | null): { model: string | null; trim: string | null } {
  const name = String(marketingName ?? "").trim();
  const ser = String(series ?? "").trim();
  if (!name && !ser) return { model: null, trim: null };
  if (ser && name.toLowerCase().startsWith(ser.toLowerCase())) {
    const rest = name.slice(ser.length).trim();
    return { model: ser, trim: rest || null };
  }
  // "GR Corolla MT" style — keep full name as model when no series
  if (ser) return { model: ser, trim: name && name !== ser ? name : null };
  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]!;
    if (/^(LE|SE|XLE|XSE|SR|SR5|TRD|Limited|Platinum|Nightshade|Hybrid|MT|AT)$/i.test(last)) {
      return { model: parts.slice(0, -1).join(" "), trim: last };
    }
  }
  return { model: name || ser || null, trim: null };
}

/**
 * Dealer.com / Toyota SRP embeds inventorySaveItemsObj with rich per-VIN fields.
 * Prefer this over bare VIN scraping so model/trim/price are grounded.
 */
export function parseInventorySaveItems(
  html: string,
  sourceUrl: string,
  now: string,
  nextId: (kind: string) => string,
  conditionHint: "new" | "used" | "unknown" = "unknown",
): InventoryListingObservationV1[] {
  const text = String(html ?? "");
  const listings: InventoryListingObservationV1[] = [];
  const seen = new Set<string>();
  // Each block: "dg-inline-save-inv-VIN": { ... "vin": "..." ... }
  const blockRe =
    /"dg-inline-save-inv-([A-HJ-NPR-Z0-9]{17})(?:-mobile)?"\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/gi;
  for (const m of text.matchAll(blockRe)) {
    const vin = m[1]!.toUpperCase();
    if (seen.has(vin)) continue;
    const body = m[2] ?? "";
    const pick = (key: string): string | null => {
      const r = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "i");
      const n = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i");
      const sm = body.match(r);
      if (sm) return sm[1] ?? null;
      const nm = body.match(n);
      return nm ? nm[1]! : null;
    };
    const year = pick("year");
    const brand = pick("brand");
    const series = pick("marketingSeries");
    const marketingName = pick("marketingName");
    const { model, trim } = splitMarketingName(marketingName, series);
    const advertised = pick("advertisedPrice");
    const price = pick("price");
    const ePrice = pick("ePrice");
    const vdp = pick("vdpHref");
    const salesClass = (pick("salesClass") || pick("vehicleType") || conditionHint || "").toLowerCase();
    const condition: "new" | "used" | "unknown" =
      /used|cpo|certified/i.test(salesClass) ? "used" : /new/i.test(salesClass) ? "new" : conditionHint;
    const advNum = advertised != null ? Number(advertised) : NaN;
    const priceNum = price != null ? Number(price) : NaN;
    const eNum = ePrice != null ? Number(ePrice) : NaN;
    // Prefer advertisedPrice when > 0; never invent zeros as real prices
    const advertisedPrice =
      Number.isFinite(advNum) && advNum > 0
        ? Math.round(advNum)
        : Number.isFinite(priceNum) && priceNum > 0
          ? Math.round(priceNum)
          : Number.isFinite(eNum) && eNum > 0
            ? Math.round(eNum)
            : null;
    seen.add(vin);
    listings.push(
      listingFromPartial(
        {
          vin,
          year,
          make: brand || "Toyota",
          model,
          trim,
          condition,
          advertisedPrice,
          listingUrl: vdp || sourceUrl,
          detailUrl: vdp || sourceUrl,
          availability: "available",
        },
        { id: nextId("listing"), now, sourceUrl, sourceType: "public-dealer-site" },
      ),
    );
    if (listings.length >= 500) break;
  }
  return listings;
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

  // Prefer dealer.com inventorySaveItemsObj (rich YMMT + price)
  for (const row of parseInventorySaveItems(text, sourceUrl, now, nextId, conditionHint)) {
    if (row.vin && seen.has(row.vin)) continue;
    if (row.vin) seen.add(row.vin);
    listings.push(row);
  }

  // JSON-LD Vehicle / ListItem blocks
  const ldBlocks = text.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of ldBlocks) {
    const body = block.replace(/^[\s\S]*?>/u, "").replace(/<\/script>/iu, "");
    try {
      const data = JSON.parse(body);
      let items: unknown[] = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      // Expand schema.org ItemList → itemListElement
      const expanded: unknown[] = [];
      for (const it of items) {
        if (it && typeof it === "object" && Array.isArray((it as { itemListElement?: unknown }).itemListElement)) {
          expanded.push(...((it as { itemListElement: unknown[] }).itemListElement));
        } else {
          expanded.push(it);
        }
      }
      items = expanded;
      for (const rawItem of items) {
        if (!rawItem || typeof rawItem !== "object") continue;
        const item = rawItem as Record<string, unknown>;
        const type = String(item["@type"] ?? "");
        // ListItem with identifier VIN (Toyota SRP breadcrumb/list)
        const listVin =
          type === "ListItem" && typeof item.identifier === "string" && /^[A-HJ-NPR-Z0-9]{17}$/i.test(item.identifier)
            ? String(item.identifier).toUpperCase()
            : null;
        if (!/Vehicle|Car|Product/i.test(type) && !item.vehicleIdentificationNumber && !listVin) continue;
        const vin = (item.vehicleIdentificationNumber || item.vin || listVin || null) as string | null;
        const key = String(vin || item.sku || item.name || Math.random());
        if (seen.has(key)) continue;
        seen.add(key);
        let model = (item.model as string | null) || null;
        let trim: string | null = (item.vehicleConfiguration as string | null) || (item.trim as string | null) || null;
        let year: string | number | null = (item.vehicleModelDate as string | null) || (item.modelDate as string | null) || null;
        const brand = item.brand as { name?: string } | string | undefined;
        let make: string | null =
          (typeof brand === "object" && brand?.name) ||
          (item.manufacturer as string | null) ||
          (item.make as string | null) ||
          null;
        // "2026 Toyota Corolla LE" in ListItem name
        if (typeof item.name === "string") {
          const nm = item.name.replace(/\\u002B/g, "+");
          const ymm = nm.match(/\b(20\d{2})\s+(Toyota|Lexus|Honda|Ford|Chevrolet|Nissan|Kia|Hyundai)\s+(.+)/i);
          if (ymm) {
            year = year || ymm[1]!;
            make = make || ymm[2]!;
            const rest = ymm[3]!.trim();
            const split = splitMarketingName(rest, null);
            model = model || split.model;
            trim = trim || split.trim;
          } else if (!model) {
            model = nm;
          }
        }
        const offers = item.offers as { price?: unknown; availability?: unknown } | undefined;
        const odo = item.mileageFromOdometer as { value?: unknown } | undefined;
        listings.push(
          listingFromPartial(
            {
              vin,
              stockNumber: item.sku || item.stockNumber || null,
              year,
              make,
              model,
              trim,
              condition: conditionHint,
              exteriorColor: item.color || item.vehicleInteriorColor || null,
              mileage: odo?.value || item.mileage || null,
              advertisedPrice: offers?.price || item.price || null,
              msrp: item.msrp || null,
              listingUrl: item.url || sourceUrl,
              detailUrl: item.url || sourceUrl,
              availability: offers?.availability || null,
            },
            { id: nextId("listing"), now, sourceUrl, sourceType: "public-dealer-site" },
          ),
        );
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  // Embedded inventory JSON blobs with "vin" (fallback when save-items missing)
  const vinJson = text.matchAll(/"vin"\s*:\s*"([A-HJ-NPR-Z0-9]{17})"/gi);
  for (const m of vinJson) {
    const vin = m[1]!.toUpperCase();
    if (seen.has(vin)) continue;
    seen.add(vin);
    // Wider window for dealer.com objects
    const start = Math.max(0, (m.index ?? 0) - 600);
    const window = text.slice(start, start + 1400);
    const stock = window.match(/"stock(?:Number|No)?"\s*:\s*"([^"]{1,40})"/i)?.[1] ?? null;
    const year = window.match(/"year"\s*:\s*(\d{4})/i)?.[1] ?? null;
    const make =
      window.match(/"brand"\s*:\s*"([^"]{1,40})"/i)?.[1] ??
      window.match(/"make"\s*:\s*"([^"]{1,40})"/i)?.[1] ??
      null;
    const series = window.match(/"marketingSeries"\s*:\s*"([^"]{1,60})"/i)?.[1] ?? null;
    const marketingName = window.match(/"marketingName"\s*:\s*"([^"]{1,80})"/i)?.[1] ?? null;
    const split = splitMarketingName(marketingName, series);
    const model =
      split.model ??
      window.match(/"model"\s*:\s*"([^"]{1,60})"/i)?.[1] ??
      null;
    const trim =
      split.trim ??
      window.match(/"trim"\s*:\s*"([^"]{1,80})"/i)?.[1] ??
      null;
    const price =
      window.match(/"advertisedPrice"\s*:\s*(\d+(?:\.\d+)?)/i)?.[1] ??
      window.match(/"(?:internetPrice|sellingPrice|finalPrice)"\s*:\s*(\d+(?:\.\d+)?)/i)?.[1] ??
      null;
    const msrp = window.match(/"msrp"\s*:\s*(\d+(?:\.\d+)?)/i)?.[1] ?? null;
    const miles = window.match(/"(?:miles|mileage|odometer)"\s*:\s*(\d+)/i)?.[1] ?? null;
    const vdp = window.match(/"vdpHref"\s*:\s*"([^"]+)"/i)?.[1] ?? null;
    const priceNum = price != null ? Number(price) : NaN;
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
          advertisedPrice: Number.isFinite(priceNum) && priceNum > 0 ? Math.round(priceNum) : null,
          msrp,
          mileage: miles,
          listingUrl: vdp || sourceUrl,
          detailUrl: vdp || sourceUrl,
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

/**
 * Resolve the next inventory page from the page's own `rel="next"` link.
 *
 * Deliberately not a constructed `?page=N` guess: following the link the site publishes keeps us
 * on the paging scheme it actually supports, and it stops naturally at the last page instead of
 * probing URLs that were never meant to exist.
 */
export function findNextPageUrl(html: string, baseUrl: string): string | null {
  const patterns = [
    /<link[^>]+rel=["']next["'][^>]*href=["']([^"']+)["']/i,
    /<a[^>]+rel=["']next["'][^>]*href=["']([^"']+)["']/i,
    /href=["']([^"']+)["'][^>]*rel=["']next["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const href = match?.[1];
    if (!href) continue;
    try {
      const resolved = new URL(href.replace(/&amp;/g, "&"), baseUrl);
      if (resolved.protocol !== "https:" && resolved.protocol !== "http:") continue;
      // Never leave the dealership host on a "next" link.
      if (new URL(baseUrl).host !== resolved.host) continue;
      const next = resolved.toString();
      return next === baseUrl ? null : next;
    } catch {
      continue;
    }
  }
  return null;
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
  /** Upper bound on paginated public pages per starting URL. */
  maxPagesPerUrl?: number;
  /** Courtesy delay between paginated public requests. */
  pageDelayMs?: number;
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

  const maxPagesPerUrl = Math.max(1, input.maxPagesPerUrl ?? 12);
  const pageDelayMs = input.pageDelayMs ?? 1_200;
  const visited = new Set<string>();

  for (const startUrl of uniqueUrls.slice(0, 4)) {
    let url: string | null = startUrl;
    for (let page = 0; page < maxPagesPerUrl && url; page++) {
      if (visited.has(url)) break;
      visited.add(url);
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
        if (!res.ok) break;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > maxBytes) truncated = true;
        const text = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, maxBytes));
        // The response may have redirected (index.htm -> searchnew.aspx); resolve relative
        // next links against where we actually landed.
        const landedUrl = typeof res.url === "string" && res.url ? res.url : url;
        if (visited.has(landedUrl) && landedUrl !== url) break;
        visited.add(landedUrl);
        fetched.push(landedUrl);
        const condition: "new" | "used" | "unknown" = /used/i.test(landedUrl)
          ? "used"
          : /new/i.test(landedUrl)
            ? "new"
            : "unknown";
        const parsed = parsePublicInventoryHtml(text, landedUrl, input.now, input.nextId, condition);
        const have = new Set(all.map((l) => l.vin).filter(Boolean));
        let added = 0;
        for (const l of parsed) {
          if (l.vin && have.has(l.vin)) continue;
          if (l.vin) have.add(l.vin);
          all.push(l);
          added++;
        }
        if (parsed.length) liveOk = true;
        // Stop paging when the site stops offering new vehicles; repeating pages that add
        // nothing is pure load on someone else's server.
        if (added === 0) break;
        // Follow the site's own advertised next link rather than constructing page params.
        const next = findNextPageUrl(text, landedUrl);
        if (!next || visited.has(next)) break;
        url = next;
        if (pageDelayMs > 0) await new Promise((r) => setTimeout(r, pageDelayMs));
      } catch {
        break;
      }
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
