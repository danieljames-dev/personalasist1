/**
 * The website AION will eventually build, described as data rather than built as pages.
 *
 * The design decision that matters most here is what the site *is*: a presentation layer over
 * AION's grounded inventory facts, never a second database. A site that stores its own copy of a
 * vehicle is a site that keeps advertising it after it sells, because nothing forces the copy to
 * agree with the source. So `VehiclePageV1` is a projection — built on demand from a
 * `VehicleContentFactsV1`, carrying the verification timestamp that produced it, and stale by
 * construction once that verification ages out.
 *
 * Nothing here deploys, serves, or renders. There is no HTML in this file and no hosting decision
 * embedded in it.
 *
 * Two policies are worth stating plainly because both protect a real person.
 *
 * **VIN display is a policy, not a default.** A full VIN on a public page is routinely scraped and
 * used to pull history reports and to spam the selling store. The default shows the last eight
 * characters, which is enough for a customer to confirm they are looking at the same car and not
 * enough to be a free lead list for anyone crawling the page.
 *
 * **Lead capture asks for the minimum.** Every extra field is data the Owner becomes responsible
 * for. Anything resembling a credit application is refused at the contract level — not discouraged
 * in a comment, refused — because a personal sales site collecting a date of birth or a licence
 * number is a data-breach story with the Owner's name on it.
 */
import type { IsoTimestamp, OpaqueId } from "./contracts.js";
import type { VehicleContentFactsV1 } from "./content-draft.js";
import { priceIsQuotable, priceSentence, vehicleLabel } from "./content-draft.js";

export const SALES_SITE_SCHEMA_V1 = "aion.sales-website.v1" as const;

// ---------------------------------------------------------------------------
// Information architecture
// ---------------------------------------------------------------------------

export type SitePageKindV1 =
  | "HOME"
  | "FEATURED_VEHICLES"
  | "FIND_A_VEHICLE"
  | "VEHICLE_DETAIL"
  | "MODEL_GUIDES"
  | "BUYING_GUIDES"
  | "FAQ"
  | "ABOUT"
  | "CONTACT"
  | "BLOG";

export interface SitePageV1 {
  kind: SitePageKindV1;
  path: string;
  title: string;
  purpose: string;
  /** Which grounded sources fill this page. Empty means it is Owner-authored prose. */
  dataSources: string[];
  /** True when the page's content decays with inventory and needs re-verification. */
  inventoryLinked: boolean;
  /** Present in the first build, or later. Honest about what does not exist yet. */
  phase: "FIRST_BUILD" | "LATER";
}

export interface SalesWebsiteArchitectureV1 {
  schema: typeof SALES_SITE_SCHEMA_V1;
  workspace: string;
  /** Mobile-first is a constraint on the design, recorded so it is not quietly dropped. */
  layout: "MOBILE_FIRST";
  pages: SitePageV1[];
  /** What the site must never do, carried with the architecture rather than in a wiki. */
  constraints: string[];
  createdAt: IsoTimestamp;
}

/**
 * The first-build information architecture.
 *
 * Deliberately small. Every page here has a job a customer actually needs done: see what is
 * available, find something specific, understand a model, ask a question, get in touch. A blog is
 * marked LATER because a site with an empty blog looks abandoned, which is worse than a site
 * without one.
 */
export function salesWebsiteArchitecture(input: {
  workspace: string;
  now: IsoTimestamp;
}): SalesWebsiteArchitectureV1 {
  const pages: SitePageV1[] = [
    {
      kind: "HOME", path: "/", title: "Home", phase: "FIRST_BUILD", inventoryLinked: true,
      purpose: "Who the Owner is, and a few current vehicles worth seeing.",
      dataSources: ["sales-brand", "vehicle-inventory"],
    },
    {
      kind: "FEATURED_VEHICLES", path: "/vehicles", title: "Available vehicles", phase: "FIRST_BUILD", inventoryLinked: true,
      purpose: "Current inventory the Owner has chosen to feature, each with its verification date.",
      dataSources: ["vehicle-inventory"],
    },
    {
      kind: "FIND_A_VEHICLE", path: "/find", title: "Find a vehicle", phase: "FIRST_BUILD", inventoryLinked: true,
      purpose: "Tell the Owner what you are looking for; matching happens in AION, not on the page.",
      dataSources: ["vehicle-inventory", "lead-capture"],
    },
    {
      kind: "VEHICLE_DETAIL", path: "/vehicles/:stock", title: "Vehicle detail", phase: "FIRST_BUILD", inventoryLinked: true,
      purpose: "One vehicle, with its price source and last-verified date. Shareable with a customer.",
      dataSources: ["vehicle-inventory"],
    },
    {
      kind: "MODEL_GUIDES", path: "/models", title: "Toyota model guides", phase: "FIRST_BUILD", inventoryLinked: false,
      purpose: "What each model is actually for. Evergreen, so it does not rot with inventory.",
      dataSources: ["toyota-model-knowledge"],
    },
    {
      kind: "BUYING_GUIDES", path: "/guides", title: "Buying guides", phase: "FIRST_BUILD", inventoryLinked: false,
      purpose: "The questions customers ask before they are ready to walk in.",
      dataSources: ["content-opportunity"],
    },
    {
      kind: "FAQ", path: "/faq", title: "Questions I get asked", phase: "FIRST_BUILD", inventoryLinked: false,
      purpose: "Aggregate customer questions, answered once.",
      dataSources: ["content-opportunity"],
    },
    {
      kind: "ABOUT", path: "/about", title: "About", phase: "FIRST_BUILD", inventoryLinked: false,
      purpose: "The Owner, in his own words. Only claims with evidence behind them.",
      dataSources: ["sales-brand"],
    },
    {
      kind: "CONTACT", path: "/contact", title: "Contact", phase: "FIRST_BUILD", inventoryLinked: false,
      purpose: "How to reach the Owner, and a short form for people who prefer typing.",
      dataSources: ["sales-brand", "lead-capture"],
    },
    {
      kind: "BLOG", path: "/updates", title: "Updates", phase: "LATER", inventoryLinked: false,
      purpose: "Only once there is a steady supply of articles — an empty blog reads as abandoned.",
      dataSources: ["content-draft"],
    },
  ];

  return {
    schema: SALES_SITE_SCHEMA_V1,
    workspace: input.workspace,
    layout: "MOBILE_FIRST",
    pages,
    constraints: [
      "The site is a view over AION's inventory facts. It never stores its own copy of a vehicle.",
      "Every vehicle shown carries the date its listing was last verified.",
      "A price is shown only when the dealer site currently advertises one.",
      "No customer information ever appears on a public page.",
      "No financing, payment, incentive or trade-value figure appears anywhere.",
    ],
    createdAt: input.now,
  };
}

// ---------------------------------------------------------------------------
// Vehicle page projection
// ---------------------------------------------------------------------------

export type VinDisplayPolicyV1 = "HIDDEN" | "LAST_EIGHT" | "FULL";

export const DEFAULT_VIN_DISPLAY: VinDisplayPolicyV1 = "LAST_EIGHT";

export function displayVin(vin: string | null, policy: VinDisplayPolicyV1 = DEFAULT_VIN_DISPLAY): string | null {
  const value = String(vin ?? "").trim().toUpperCase();
  if (!value) return null;
  if (policy === "HIDDEN") return null;
  if (policy === "FULL") return value;
  return value.length > 8 ? value.slice(-8) : value;
}

export type VehiclePageStatusV1 = "AVAILABLE_AS_OF" | "NEEDS_REVERIFY" | "NO_LONGER_LISTED";

export interface VehiclePageV1 {
  vehicleRef: OpaqueId;
  path: string;
  headline: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  condition: string | null;
  exteriorColor: string | null;
  mileage: number | null;
  vinDisplay: string | null;
  vinPolicy: VinDisplayPolicyV1;
  features: string[];
  /** Only ever set when the dealer site currently advertises a price. */
  websitePrice: number | null;
  priceSource: string | null;
  priceObservedAt: IsoTimestamp | null;
  /** Kept separate from `websitePrice` — it is a manufacturer figure, not an offer. */
  stickerMsrp: number | null;
  priceStatement: string;
  status: VehiclePageStatusV1;
  lastVerifiedAt: IsoTimestamp | null;
  imageRefs: string[];
  callToAction: string;
  sourceRefs: string[];
}

/** How long a verified listing may be presented before the page must say "re-check". */
export const VEHICLE_PAGE_VERIFY_TTL_DAYS = 3;

/**
 * Project one vehicle onto a page.
 *
 * The status is derived from the verification age rather than stored, for the same reason freshness
 * is recomputed elsewhere: a field that says AVAILABLE is only as true as the last time someone
 * refreshed it, and nobody refreshes fields.
 */
export function vehiclePageFromFacts(input: {
  facts: VehicleContentFactsV1;
  now: IsoTimestamp;
  vinPolicy?: VinDisplayPolicyV1;
  imageRefs?: readonly string[];
}): VehiclePageV1 {
  const f = input.facts;
  const policy = input.vinPolicy ?? DEFAULT_VIN_DISPLAY;
  const quotable = priceIsQuotable(f.price);

  const verifiedAgeDays = f.observedAt
    ? Math.floor((Date.parse(input.now) - Date.parse(f.observedAt)) / 86_400_000)
    : null;
  const status: VehiclePageStatusV1 =
    f.inventoryStatus === "NO_LONGER_FOUND_ONLINE" ? "NO_LONGER_LISTED"
    : verifiedAgeDays == null || verifiedAgeDays > VEHICLE_PAGE_VERIFY_TTL_DAYS ? "NEEDS_REVERIFY"
    : "AVAILABLE_AS_OF";

  return {
    vehicleRef: f.vehicleRef,
    path: `/vehicles/${encodeURIComponent(f.stockNumber ?? f.vehicleRef)}`,
    headline: vehicleLabel(f),
    year: f.year, make: f.make, model: f.model, trim: f.trim,
    condition: f.condition, exteriorColor: f.exteriorColor, mileage: f.mileage,
    vinDisplay: displayVin(f.vin, policy),
    vinPolicy: policy,
    features: [...f.features],
    websitePrice: quotable ? f.price.amount : null,
    priceSource: quotable ? f.price.sourceRef : null,
    priceObservedAt: quotable ? f.price.observedAt : null,
    stickerMsrp: f.price.kind === "STICKER_MSRP" ? f.price.amount : null,
    priceStatement: priceSentence(f.price),
    status,
    lastVerifiedAt: f.observedAt,
    imageRefs: [...(input.imageRefs ?? [])],
    callToAction: status === "AVAILABLE_AS_OF"
      ? "Message me to see it."
      : "Message me and I will confirm whether this one is still here.",
    sourceRefs: [...f.sourceRefs],
  };
}

// ---------------------------------------------------------------------------
// Lead capture
// ---------------------------------------------------------------------------

export type LeadFieldV1 =
  | "name" | "preferredContactMethod" | "email" | "phone"
  | "vehicleInterest" | "tradeInterest" | "appointmentPreference" | "message";

export const ALLOWED_LEAD_FIELDS: readonly LeadFieldV1[] = [
  "name", "preferredContactMethod", "email", "phone",
  "vehicleInterest", "tradeInterest", "appointmentPreference", "message",
];

/**
 * Fields a personal sales site must never collect.
 *
 * Named individually so a refusal can say which one and why. Each of these turns an ordinary contact
 * form into a regulated data collection with obligations the Owner has not signed up for, and the
 * dealership — not a salesperson's own website — is where a credit application belongs.
 */
export const FORBIDDEN_LEAD_FIELDS: readonly string[] = [
  "ssn", "socialSecurityNumber", "dob", "dateOfBirth", "creditScore", "creditApplication",
  "bankAccount", "routingNumber", "accountNumber", "driverLicense", "driversLicense",
  "licenseNumber", "income", "employer", "insurancePolicy", "passport",
];

export interface LeadCaptureFormV1 {
  formId: OpaqueId;
  workspace: string;
  fields: Array<{ field: LeadFieldV1; required: boolean; label: string }>;
  /** Explicit, recorded, and never pre-ticked. */
  consent: { text: string; required: true; defaultChecked: false };
  /** Where a submission goes. Internal only at this milestone. */
  destination: "AION_INTERNAL_ONLY";
  createdAt: IsoTimestamp;
}

export interface LeadFormRefusalV1 {
  refused: true;
  reason: string;
}

export function buildLeadCaptureForm(input: {
  formId: OpaqueId;
  workspace: string;
  fields?: readonly string[];
  requiredFields?: readonly string[];
  now: IsoTimestamp;
}): LeadCaptureFormV1 | LeadFormRefusalV1 {
  const requested = input.fields ?? ["name", "preferredContactMethod", "phone", "vehicleInterest", "message"];
  for (const field of requested) {
    const normalised = String(field).trim();
    if (FORBIDDEN_LEAD_FIELDS.some((f) => f.toLowerCase() === normalised.toLowerCase())) {
      return {
        refused: true,
        reason: `"${normalised}" must not be collected on a personal sales site — that belongs to the dealership's own regulated process, not a contact form`,
      };
    }
    if (!ALLOWED_LEAD_FIELDS.includes(normalised as LeadFieldV1)) {
      return { refused: true, reason: `"${normalised}" is not an allowed lead field` };
    }
  }

  const required = new Set((input.requiredFields ?? ["name"]).map(String));
  return {
    formId: input.formId,
    workspace: input.workspace,
    fields: requested.map((field) => ({
      field: field as LeadFieldV1,
      required: required.has(String(field)),
      label: leadFieldLabel(field as LeadFieldV1),
    })),
    consent: {
      text: "It is fine to contact me about this enquiry.",
      required: true,
      defaultChecked: false,
    },
    destination: "AION_INTERNAL_ONLY",
    createdAt: input.now,
  };
}

function leadFieldLabel(field: LeadFieldV1): string {
  const labels: Record<LeadFieldV1, string> = {
    name: "Your name",
    preferredContactMethod: "How should I reach you?",
    email: "Email",
    phone: "Phone",
    vehicleInterest: "What are you looking for?",
    tradeInterest: "Do you have something to trade? (optional)",
    appointmentPreference: "When suits you? (optional)",
    message: "Anything else",
  };
  return labels[field];
}

/** Featured vehicles whose pages can no longer be shown as current. */
export function staleWebsiteVehicles(pages: readonly VehiclePageV1[]): VehiclePageV1[] {
  return pages.filter((page) => page.status !== "AVAILABLE_AS_OF");
}
