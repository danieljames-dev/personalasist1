/**
 * Salesperson-useful Toyota model and trim knowledge.
 *
 * This is deliberately *general* knowledge: trim positioning, powertrain choices, what separates
 * one badge from the next. It is never a claim about a specific car on the lot. A customer asking
 * "what's the difference between an SR5 and a TRD Off-Road?" wants orientation, not a VIN audit —
 * but the moment the question becomes "does *this* one have it?", the answer has to come from the
 * window sticker, not from here. Every line says so.
 *
 * Scope is driven by what Lakeland Toyota actually stocks: Corolla ~76, Camry ~40, Tacoma ~31,
 * RAV4 ~19, Corolla Cross ~15, Tundra ~15, Highlander ~7. Adding models nobody has on the lot
 * would be encyclopedia-building, not sales support.
 *
 * Feature content varies by model year, package and region. Rather than pin a year-by-year matrix
 * that would rot silently and mislead, each entry carries its variability caveat.
 */
import type { VehicleAnswerLineV1 } from "./vehicle-intelligence.js";

export interface ToyotaTrimNoteV1 {
  trim: string;
  /** What the trim is *for* — the thing a customer is actually choosing between. */
  focus: "value" | "sport" | "comfort" | "off-road" | "luxury" | "utility";
  note: string;
}

export interface ToyotaModelKnowledgeV1 {
  model: string;
  aliases: string[];
  positioning: string;
  bodyStyles: string;
  powertrains: string;
  hybrid: string;
  trims: ToyotaTrimNoteV1[];
  caveat: string;
}

const SOURCE = "general-model:toyota";

export const TOYOTA_MODEL_KNOWLEDGE: readonly ToyotaModelKnowledgeV1[] = [
  {
    model: "Corolla",
    aliases: ["corolla", "corolla hybrid"],
    positioning: "Compact sedan/hatch. The value and fuel-economy entry point; the highest-volume car on most Toyota lots.",
    bodyStyles: "Sedan; hatchback on some years/trims.",
    powertrains: "Gas four-cylinder across the range; hybrid available as its own variant.",
    hybrid: "Corolla Hybrid is a distinct variant, not a package on every trim. Check the badge and the VIN decode's fuel type.",
    trims: [
      { trim: "LE", focus: "value", note: "Core trim — comfort-biased, cloth, smaller wheels, Toyota Safety Sense included in recent years." },
      { trim: "SE", focus: "sport", note: "Sport appearance and firmer tuning vs LE; sportier seats and wheels. Usually the step customers feel most immediately." },
      { trim: "XLE", focus: "comfort", note: "Comfort/convenience step above LE rather than a sport step." },
      { trim: "XSE", focus: "sport", note: "SE's sport character with higher equipment content." },
      { trim: "Nightshade", focus: "sport", note: "Appearance package treatment on selected years — blacked-out exterior trim, not a mechanical change." },
    ],
    caveat: "Corolla trim content shifts noticeably between generations and model years. Confirm equipment on the specific unit.",
  },
  {
    model: "Camry",
    aliases: ["camry", "camry hybrid"],
    positioning: "Midsize sedan. Steps up from Corolla in space, refinement and available power.",
    bodyStyles: "Sedan.",
    powertrains: "Four-cylinder gas historically, V6 on older upper trims, and hybrid. Recent generations moved to hybrid-only in some markets — verify by year.",
    hybrid: "Hybrid availability varies sharply by generation; the 2025+ generation is hybrid across the board in many configurations. Do not assume — check the VIN decode.",
    trims: [
      { trim: "LE", focus: "value", note: "Base comfort trim; cloth, smaller wheels." },
      { trim: "SE", focus: "sport", note: "Sport styling and suspension tuning vs LE." },
      { trim: "XLE", focus: "comfort", note: "Comfort/feature step-up — often softer trim materials and more convenience content." },
      { trim: "XSE", focus: "sport", note: "Blends SE's sport look with XLE-level features." },
      { trim: "TRD", focus: "sport", note: "Limited-production sport treatment on some years." },
    ],
    caveat: "LE/XLE are the comfort line; SE/XSE are the sport line. Feature content varies by year and package.",
  },
  {
    model: "Tacoma",
    aliases: ["tacoma", "tacoma 2wd", "tacoma 4wd"],
    positioning: "Midsize pickup. Trim choice is mostly about how far off pavement the customer intends to go.",
    bodyStyles: "Extended cab and crew cab; multiple bed lengths. Cab/bed combination is often the real constraint on availability.",
    powertrains: "Four-cylinder and V6 historically; the current generation moved to turbocharged four-cylinder including a hybrid setup. Verify by year.",
    hybrid: "i-FORCE MAX hybrid appears on the current generation's upper trims. Not present on older Tacomas.",
    trims: [
      { trim: "SR", focus: "value", note: "Work-oriented base truck." },
      { trim: "SR5", focus: "value", note: "The volume trim — adds comfort and convenience over SR without off-road hardware." },
      { trim: "TRD Sport", focus: "sport", note: "On-road sport bias: street tuning and appearance rather than off-road hardware." },
      { trim: "TRD Off-Road", focus: "off-road", note: "The genuine off-road step — traction aids and off-road-tuned suspension. This is the one buyers usually mean by 'TRD'." },
      { trim: "Limited", focus: "luxury", note: "Comfort/luxury direction rather than off-road capability." },
      { trim: "Trailhunter", focus: "off-road", note: "Overland-oriented build on the current generation." },
      { trim: "TRD Pro", focus: "off-road", note: "Top off-road build; most capable and most expensive of the off-road line." },
    ],
    caveat: "TRD Sport is street-focused and TRD Off-Road is not — customers frequently conflate the two. Confirm drivetrain (2WD/4WD) separately; the dealer listing often states it in the model name.",
  },
  {
    model: "RAV4",
    aliases: ["rav4", "rav4 hybrid", "rav4 prime", "rav4 plug-in hybrid"],
    positioning: "Compact SUV and the volume crossover. Widest powertrain spread in the lineup.",
    bodyStyles: "Five-seat crossover.",
    powertrains: "Gas, conventional hybrid, and plug-in hybrid (marketed as RAV4 Prime / RAV4 Plug-in Hybrid depending on year).",
    hybrid: "Three distinct things: gas, hybrid, and plug-in hybrid. The plug-in is the quickest and the only one that charges externally. Government decode may name it 'RAV4 Prime (PHEV)' where the dealer says 'RAV4 Plug-in Hybrid' — same vehicle.",
    trims: [
      { trim: "LE", focus: "value", note: "Entry trim." },
      { trim: "XLE", focus: "comfort", note: "Common volume step — more convenience content." },
      { trim: "XLE Premium", focus: "comfort", note: "XLE with upgraded trim materials and features." },
      { trim: "Adventure", focus: "off-road", note: "Rugged styling with some capability-oriented content; not a TRD Off-Road equivalent." },
      { trim: "TRD Off-Road", focus: "off-road", note: "The genuine off-road-tuned RAV4 where offered." },
      { trim: "Limited", focus: "luxury", note: "Top comfort/feature trim." },
      { trim: "Woodland", focus: "off-road", note: "Hybrid-based outdoorsy variant on selected years." },
    ],
    caveat: "Powertrain matters more than trim for most RAV4 shoppers. Establish gas vs hybrid vs plug-in first, then trim.",
  },
  {
    model: "Tundra",
    aliases: ["tundra", "tundra i-force max"],
    positioning: "Full-size pickup. Chosen over Tacoma for towing, payload and cab space.",
    bodyStyles: "Crew cab configurations with varying bed lengths.",
    powertrains: "Current generation uses a twin-turbo V6 (i-FORCE) with a hybrid version (i-FORCE MAX). Older generations used a V8.",
    hybrid: "i-FORCE MAX is the hybrid and appears mainly on upper trims. A Tundra without that badge is not a hybrid.",
    trims: [
      { trim: "SR", focus: "value", note: "Work-oriented base." },
      { trim: "SR5", focus: "value", note: "Volume trim with meaningful comfort content." },
      { trim: "Limited", focus: "comfort", note: "Comfort step-up." },
      { trim: "Platinum", focus: "luxury", note: "Luxury-oriented equipment." },
      { trim: "1794 Edition", focus: "luxury", note: "Western-themed luxury trim; equipment comparable to Platinum with distinct interior treatment." },
      { trim: "TRD Pro", focus: "off-road", note: "Off-road flagship." },
      { trim: "Capstone", focus: "luxury", note: "Top luxury trim on the current generation." },
    ],
    caveat: "Platinum, 1794 and Capstone are parallel luxury choices rather than a simple ladder. Towing capacity depends on configuration — confirm per unit, never quote from trim alone.",
  },
  {
    model: "Corolla Cross",
    aliases: ["corolla cross", "corolla cross hybrid"],
    positioning: "Subcompact SUV slotting below RAV4 — Corolla economy in a crossover body.",
    bodyStyles: "Five-seat crossover.",
    powertrains: "Gas four-cylinder, with a hybrid variant.",
    hybrid: "Corolla Cross Hybrid is a separate variant; check the badge and fuel type.",
    trims: [
      { trim: "L", focus: "value", note: "Entry trim." },
      { trim: "LE", focus: "value", note: "Volume trim." },
      { trim: "XLE", focus: "comfort", note: "Higher content and comfort." },
      { trim: "SE", focus: "sport", note: "Sport-appearance trim on hybrid-equipped years." },
      { trim: "Nightshade", focus: "sport", note: "Appearance treatment, not a mechanical change." },
    ],
    caveat: "Commonly cross-shopped against RAV4 — the honest differentiator is size and price, not capability.",
  },
  {
    model: "Highlander",
    aliases: ["highlander", "highlander hybrid", "grand highlander"],
    positioning: "Three-row midsize SUV for buyers who need seating beyond RAV4.",
    bodyStyles: "Three-row SUV; Grand Highlander is a larger, separate model.",
    powertrains: "V6 historically, turbo four more recently, plus hybrid.",
    hybrid: "Highlander Hybrid is a distinct variant and a common choice for mileage-focused three-row buyers.",
    trims: [
      { trim: "L", focus: "value", note: "Entry trim." },
      { trim: "LE", focus: "value", note: "Volume trim." },
      { trim: "XLE", focus: "comfort", note: "Popular middle step; often adds second-row captain's chairs on some years." },
      { trim: "Limited", focus: "luxury", note: "Higher comfort content." },
      { trim: "Platinum", focus: "luxury", note: "Top trim." },
    ],
    caveat: "Third-row usability and seating count vary by configuration — confirm on the unit before promising seating for a family.",
  },
];

function normalise(text: string): string {
  return String(text ?? "").trim().toLowerCase();
}

/** Resolve free text ("what's the difference on a tacoma") to a known model entry. */
export function findModelKnowledge(text: string): ToyotaModelKnowledgeV1 | null {
  const q = normalise(text);
  if (!q) return null;
  // Longest alias first so "corolla cross" is not swallowed by "corolla".
  const candidates = TOYOTA_MODEL_KNOWLEDGE.flatMap((m) =>
    m.aliases.map((a) => ({ alias: a, model: m })),
  ).sort((a, b) => b.alias.length - a.alias.length);
  for (const { alias, model } of candidates) {
    if (q.includes(alias)) return model;
  }
  return null;
}

/** Trim entries named in the question, if any. */
export function findTrimsInText(model: ToyotaModelKnowledgeV1, text: string): ToyotaTrimNoteV1[] {
  const q = normalise(text);
  const hits = model.trims.filter((t) => {
    const name = normalise(t.trim);
    return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(q);
  });
  // Longer names win when one contains another ("TRD Off-Road" over "TRD Pro" is not an issue,
  // but "XLE" inside "XLE Premium" is).
  return hits.filter((t) => !hits.some((o) => o !== t && normalise(o.trim).includes(normalise(t.trim))));
}

/**
 * Compose an answer about a model, optionally narrowed to named trims.
 *
 * Everything is GENERAL_MODEL_KNOWLEDGE — orientation for a conversation, never a claim about a
 * particular car. The closing line says so explicitly, because that is the sentence that stops a
 * salesperson promising equipment a VIN may not have.
 */
export function modelKnowledgeLines(model: ToyotaModelKnowledgeV1, askedTrims: readonly ToyotaTrimNoteV1[] = []): VehicleAnswerLineV1[] {
  const lines: VehicleAnswerLineV1[] = [];
  const src = `${SOURCE}:${normalise(model.model).replace(/\s+/g, "-")}`;

  if (askedTrims.length >= 2) {
    lines.push({ class: "GENERAL_MODEL_KNOWLEDGE", text: `${model.model} — ${askedTrims.map((t) => t.trim).join(" vs ")}:`, source: src });
    for (const t of askedTrims) {
      lines.push({ class: "GENERAL_MODEL_KNOWLEDGE", text: `${t.trim} (${t.focus}): ${t.note}`, source: src });
    }
  } else if (askedTrims.length === 1) {
    const t = askedTrims[0]!;
    lines.push({ class: "GENERAL_MODEL_KNOWLEDGE", text: `${model.model} ${t.trim} (${t.focus}): ${t.note}`, source: src });
  } else {
    lines.push({ class: "GENERAL_MODEL_KNOWLEDGE", text: `${model.model}: ${model.positioning}`, source: src });
    lines.push({ class: "GENERAL_MODEL_KNOWLEDGE", text: `Body: ${model.bodyStyles}`, source: src });
    lines.push({ class: "GENERAL_MODEL_KNOWLEDGE", text: `Powertrains: ${model.powertrains}`, source: src });
    lines.push({ class: "GENERAL_MODEL_KNOWLEDGE", text: `Hybrid: ${model.hybrid}`, source: src });
    lines.push({ class: "GENERAL_MODEL_KNOWLEDGE", text: `Trim ladder: ${model.trims.map((t) => t.trim).join(" · ")}`, source: src });
  }

  lines.push({ class: "GENERAL_MODEL_KNOWLEDGE", text: `Caveat: ${model.caveat}`, source: src });
  lines.push({
    class: "GENERAL_MODEL_KNOWLEDGE",
    text: "This is general model knowledge, not the equipment on any specific VIN. Confirm actual installed options on the window sticker or the unit itself.",
    source: src,
  });
  return lines;
}

/** Models whose trims lean a given way — answers "which are sport/off-road/comfort focused?". */
export function trimsByFocus(model: ToyotaModelKnowledgeV1, focus: ToyotaTrimNoteV1["focus"]): ToyotaTrimNoteV1[] {
  return model.trims.filter((t) => t.focus === focus);
}

/**
 * What Toyota's shared trim badges mean when no model was named.
 *
 * "What's the difference between LE, SE, XLE and XSE?" is a fair question with no model attached —
 * those badges run across Camry, Corolla, RAV4 and Highlander. Silently answering with Camry
 * content would be an assumption presented as fact; refusing outright is unhelpful. The badges do
 * carry a consistent meaning across the lineup, so explain that and say the specifics vary.
 */
export const TOYOTA_GENERIC_TRIM_LADDER: readonly VehicleAnswerLineV1[] = [
  {
    class: "GENERAL_MODEL_KNOWLEDGE",
    text: "Toyota reuses these badges across models, so the pattern holds even though the equipment differs by model and year.",
    source: `${SOURCE}:trim-ladder`,
  },
  { class: "GENERAL_MODEL_KNOWLEDGE", text: "LE — the value/comfort baseline. Cloth, smaller wheels, core safety tech.", source: `${SOURCE}:trim-ladder` },
  { class: "GENERAL_MODEL_KNOWLEDGE", text: "SE — the sport step off LE: firmer tuning, sportier wheels and seats. Same family, different character.", source: `${SOURCE}:trim-ladder` },
  { class: "GENERAL_MODEL_KNOWLEDGE", text: "XLE — the comfort step up: more convenience and nicer materials, not a sport change.", source: `${SOURCE}:trim-ladder` },
  { class: "GENERAL_MODEL_KNOWLEDGE", text: "XSE — SE's sport character combined with XLE-level features. The 'both' option.", source: `${SOURCE}:trim-ladder` },
  {
    class: "GENERAL_MODEL_KNOWLEDGE",
    text: "LE/XLE is the comfort line and SE/XSE is the sport line. Name the model (Corolla, Camry, RAV4, Highlander) for specifics — and this is general model knowledge, not this car's installed equipment.",
    source: `${SOURCE}:trim-ladder`,
  },
];

/** True when a question names shared Toyota trim badges but no model. */
export function asksGenericTrimLadder(text: string): boolean {
  const q = normalise(text);
  if (findModelKnowledge(q)) return false;
  // Static pattern: a template literal would turn "\b" into a backspace escape rather than a
  // word boundary, which silently matches nothing.
  const badges = new Set((q.match(/\b(?:le|se|xle|xse)\b/gi) ?? []).map((m) => m.toLowerCase()));
  return badges.size >= 2;
}
