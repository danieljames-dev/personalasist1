/**
 * Saying exactly which price this is.
 *
 * A vehicle has several numbers attached to it and they are not interchangeable. The dealer's site
 * advertises an asking price. The window sticker carries a base MSRP *and* a total suggested retail
 * that includes options and destination. Those two sticker figures differ by thousands of dollars on
 * an optioned car, and collapsing either of them into the word "MSRP" produces a sentence that is
 * wrong in a way a customer will notice — usually while standing next to the car.
 *
 * The Owner's requirement was specific: show
 *
 *     Website advertised price: $53,378
 *     Sticker base MSRP:        $49,090
 *     Sticker total:            $53,378
 *
 * when that is what the evidence establishes, and never rename one to another.
 *
 * ## A limitation this module refuses to paper over
 *
 * The sticker OCR layer already distinguishes the two — `vin-ocr.ts` emits `totalSuggestedRetail`
 * and `msrpCandidate` as separate signals. The inventory record does not: every sticker figure
 * lands in a single `msrp` field on `VehiclePriceHistoryEntryV1`, and by the time state is written
 * the distinction is gone.
 *
 * So a stored sticker figure is labelled `STICKER_UNSPECIFIED` — "a sticker number, and the record
 * does not say which one". Guessing "base" or "total" from the magnitude would be inventing the
 * precision the Owner asked for. The label reads as a known gap rather than as a fact, which is the
 * honest rendering until the sticker write path carries the component through.
 */
import type { IsoTimestamp } from "./contracts.js";
import type { VehicleRecordV1 } from "./vehicle-inventory.js";

/**
 * Which number this is. Each is a different claim with a different source.
 */
export type PriceLineKindV1 =
  /** What the dealer's public site is asking. The only figure quotable as "the price". */
  | "WEBSITE_ADVERTISED"
  /** A dealer-published figure that is not the advertised ask. */
  | "WEBSITE_DEALER"
  /** Monroney base MSRP, before options and destination. */
  | "STICKER_BASE_MSRP"
  /** Monroney total suggested retail — base plus options plus destination. */
  | "STICKER_TOTAL"
  /** A sticker figure whose component the record does not identify. */
  | "STICKER_UNSPECIFIED"
  | "UNKNOWN";

export interface PriceLineV1 {
  kind: PriceLineKindV1;
  amount: number;
  /** Exactly how this should be worded to the Owner. Never abbreviated to "Price". */
  label: string;
  observedAt: IsoTimestamp | null;
  /** Plain-language provenance, e.g. "dealer website, checked 3:15 PM". */
  sourceLabel: string;
  sourceRef: string | null;
}

export interface PriceDisplayV1 {
  /** Every distinct figure the evidence supports, most authoritative first. Never merged. */
  lines: PriceLineV1[];
  /** The advertised ask, when one exists. Null is a legitimate and common answer. */
  advertised: PriceLineV1 | null;
  /** True when nothing is published and nothing should be quoted. */
  unknown: boolean;
  /** One line for a phone screen. */
  headline: string;
  /** Set when the record cannot say which sticker component a figure is. */
  precisionNote: string | null;
}

const LABELS: Record<PriceLineKindV1, string> = {
  WEBSITE_ADVERTISED: "Website advertised price",
  WEBSITE_DEALER: "Dealer published price",
  STICKER_BASE_MSRP: "Sticker base MSRP",
  STICKER_TOTAL: "Sticker total (suggested retail)",
  STICKER_UNSPECIFIED: "Sticker MSRP",
  UNKNOWN: "Price not published",
};

export function priceLineKindLabel(kind: PriceLineKindV1): string {
  return LABELS[kind];
}

const money = (n: number): string => `$${n.toLocaleString("en-US")}`;

/** "3:15 PM" style, appended to a source so the Owner knows how fresh the number is. */
function clockLabel(iso: IsoTimestamp | null): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  const date = new Date(parsed);
  const hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const suffix = hours >= 12 ? "PM" : "AM";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${minutes} ${suffix} UTC`;
}

/**
 * Read every distinct price the record supports.
 *
 * Reads only the newest observation. Older entries are history and belong in a change view; showing
 * a superseded figure beside a current one on a phone screen is how the wrong number gets quoted.
 */
export function priceDisplayFromVehicle(vehicle: VehicleRecordV1 | null | undefined): PriceDisplayV1 {
  const history = [...(vehicle?.priceHistory ?? [])]
    .filter((entry) => entry && entry.at)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const latest = history[0] ?? null;

  const lines: PriceLineV1[] = [];
  let precisionNote: string | null = null;

  if (latest) {
    const when = clockLabel(latest.at);
    const site = latest.sourceUrl || null;

    if (isMoney(latest.advertisedPrice)) {
      lines.push({
        kind: "WEBSITE_ADVERTISED", amount: latest.advertisedPrice!,
        label: LABELS.WEBSITE_ADVERTISED, observedAt: latest.at,
        sourceLabel: `dealer website${when ? `, checked ${when}` : ""}`, sourceRef: site,
      });
    }
    // Only shown when it is not simply the advertised figure repeated.
    if (isMoney(latest.dealerPrice) && latest.dealerPrice !== latest.advertisedPrice) {
      lines.push({
        kind: "WEBSITE_DEALER", amount: latest.dealerPrice!,
        label: LABELS.WEBSITE_DEALER, observedAt: latest.at,
        sourceLabel: `dealer website${when ? `, checked ${when}` : ""}`, sourceRef: site,
      });
    }
    if (isMoney(latest.msrp)) {
      lines.push({
        kind: "STICKER_UNSPECIFIED", amount: latest.msrp!,
        label: LABELS.STICKER_UNSPECIFIED, observedAt: latest.at,
        sourceLabel: "window sticker", sourceRef: site,
      });
      precisionNote =
        "The record stores one sticker figure without saying whether it is the base MSRP or the "
        + "total suggested retail. Both are read off the sticker; only one is carried through.";
    }
  }

  const advertised = lines.find((l) => l.kind === "WEBSITE_ADVERTISED") ?? null;
  const unknown = lines.length === 0;

  return {
    lines,
    advertised,
    unknown,
    headline: unknown
      ? "Price not currently published"
      : `${(advertised ?? lines[0]!).label}: ${money((advertised ?? lines[0]!).amount)}`,
    precisionNote,
  };
}

function isMoney(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Build a display from separately-evidenced figures.
 *
 * The shape the Owner asked for, available now so the UI is already correct when the sticker write
 * path starts carrying the component through. Each figure is supplied by a caller that knows which
 * one it has; nothing here infers a component from a number's size.
 */
export function priceDisplayFromParts(input: {
  websiteAdvertised?: { amount: number; observedAt?: IsoTimestamp | null; sourceRef?: string | null } | null;
  stickerBaseMsrp?: { amount: number; observedAt?: IsoTimestamp | null; sourceRef?: string | null } | null;
  stickerTotal?: { amount: number; observedAt?: IsoTimestamp | null; sourceRef?: string | null } | null;
}): PriceDisplayV1 {
  const lines: PriceLineV1[] = [];
  const push = (kind: PriceLineKindV1, part: { amount: number; observedAt?: IsoTimestamp | null; sourceRef?: string | null } | null | undefined, source: string) => {
    if (!part || !isMoney(part.amount)) return;
    lines.push({
      kind, amount: part.amount, label: LABELS[kind],
      observedAt: part.observedAt ?? null,
      sourceLabel: `${source}${part.observedAt ? `, checked ${clockLabel(part.observedAt)}` : ""}`,
      sourceRef: part.sourceRef ?? null,
    });
  };
  push("WEBSITE_ADVERTISED", input.websiteAdvertised, "dealer website");
  push("STICKER_BASE_MSRP", input.stickerBaseMsrp, "window sticker");
  push("STICKER_TOTAL", input.stickerTotal, "window sticker");

  const advertised = lines.find((l) => l.kind === "WEBSITE_ADVERTISED") ?? null;
  const unknown = lines.length === 0;
  return {
    lines,
    advertised,
    unknown,
    headline: unknown
      ? "Price not currently published"
      : `${(advertised ?? lines[0]!).label}: ${money((advertised ?? lines[0]!).amount)}`,
    // Every figure here was supplied with its component named, so there is nothing to caveat.
    precisionNote: null,
  };
}

/**
 * The Owner-facing block.
 *
 * Every line names its own kind. There is deliberately no "Price:" row anywhere — the whole point is
 * that the reader always knows which number they are looking at.
 */
export function formatPriceDisplay(display: PriceDisplayV1): string {
  if (display.unknown) {
    return "Price not currently published — ask me and I'll check today's number.";
  }
  const lines = display.lines.map((line) => `${line.label}: ${money(line.amount)} (${line.sourceLabel})`);
  if (display.precisionNote) lines.push(display.precisionNote);
  return lines.join("\n");
}

/**
 * True when this display supports quoting a price publicly.
 *
 * A sticker figure never does. It is the manufacturer's number, not the store's offer, and putting
 * it in a post is an advertisement the dealership did not authorise.
 */
export function hasQuotableAdvertisedPrice(display: PriceDisplayV1): boolean {
  return display.advertised != null;
}
