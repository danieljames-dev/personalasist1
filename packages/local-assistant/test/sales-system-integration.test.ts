/**
 * Three-way sales system integration E2E.
 *
 * Lot Walk (grounded physical observation + website price)
 *   → Sales Presence (opportunity → drafts)
 * Audio/CRM proposal
 *   → Mock Tekion (BrowserTask → BrowserTaskResult PREVIEW)
 *
 * No real Tekion, browser, social publish, or external write.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  websitePriceFromVehicle,
  type LotWalkListItemV1,
} from "../src/lot-walk.js";
import type { VehicleRecordV1 } from "../src/vehicle-inventory.js";
import {
  contentOpportunityFromSignal,
  rankContentOpportunities,
  type ContentSignalV1,
} from "../src/content-opportunity.js";
import {
  vehicleContentFacts,
  priceFactFromVehicle,
  priceSentence,
  generateContentDraft,
  reviewDraftFreshness,
  scanDraftForPrivateData,
  type ContentDraftV1,
} from "../src/content-draft.js";
import {
  buildSalesBrandProfile,
  DEFAULT_CONTENT_PILLARS,
  type SalesBrandProfileV1,
} from "../src/sales-brand.js";
import { vehiclePageFromFacts } from "../src/sales-website.js";
import {
  buildTranscriptFromEngineText,
} from "../src/audio-transcription.js";
import { ingestConversationFromTranscript } from "../src/conversation-ingest.js";
import { resolveCustomerIdentity } from "../src/customer-identity.js";
import type { RelationshipV1 } from "../src/contracts.js";
import {
  browserTaskFromCrmProposal,
  resolveExternalCustomerRef,
  describeTaskLineage,
  type ExternalCustomerLinkV1,
} from "../src/browser-proposal-adapter.js";
import {
  submitBrowserTask,
  InMemoryBrowserPreviewLedgerV1,
  type BrowserWorkerDepsV1,
} from "../src/browser-worker.js";
import { createMockTekionStore } from "../src/browser-mock-tekion.js";
import { isBrowserTaskRefusal, isCanonicalCustomerRef, buildBrowserTask } from "../src/browser-task.js";

/** Oracle for Crown Signia real-lot walk tests only — not production logic. */
const CROWN_VIN_ORACLE = "JTDACAAJ8T3051788";
const NOW = "2026-08-12T15:00:00.000Z";
const LISTING = "https://www.lakelandtoyota.com/vehicle/JTDACAAJ8T3051788";

const CROWN_PHOTO_CANDIDATES = [
  "private/aion/intake/fe94885578538c2f/IMG_0326.jpeg",
  join(process.cwd(), "private/aion/intake/fe94885578538c2f/IMG_0326.jpeg"),
  "C:/AION-HQ/private/aion/intake/fe94885578538c2f/IMG_0326.jpeg",
  "C:/AION-HQ-integration-sales-system/private/aion/intake/fe94885578538c2f/IMG_0326.jpeg",
];

function crownVehicle(over: Partial<VehicleRecordV1> = {}): VehicleRecordV1 {
  return {
    id: "veh-crown-integration",
    vin: CROWN_VIN_ORACLE,
    dealershipId: "d1",
    dealershipName: "Lakeland Toyota",
    stockNumber: "CRN1788",
    year: 2026,
    make: "Toyota",
    model: "Toyota Crown Signia",
    trim: "Limited",
    condition: "new",
    exteriorColor: "Black",
    interiorColor: null,
    mileage: null,
    presenceStatus: "ONLINE_LISTED",
    listingUrl: LISTING,
    detailUrl: LISTING,
    lastOnlineAt: "2026-08-11T12:00:00.000Z",
    lastPhysicalAt: NOW,
    priceHistory: [
      {
        at: "2026-08-11T12:00:00.000Z",
        advertisedPrice: 53378,
        msrp: 50955,
        dealerPrice: null,
        sourceUrl: LISTING,
      },
    ],
    statusHistory: [],
    listingObservations: [],
    relationshipIds: [],
    opportunityIds: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as VehicleRecordV1;
}

function brand(): SalesBrandProfileV1 {
  const built = buildSalesBrandProfile({
    workspace: "work",
    displayName: "D. Coffman",
    professionalRole: "Sales Consultant",
    dealershipName: "Lakeland Toyota",
    serviceArea: "Polk County",
    brandPromise: "Straight answers and the actual price.",
    contactPreferences: { preferred: "text" },
    now: NOW,
  });
  assert.ok(!("refused" in built));
  return built;
}

/** Grounded Lot Walk list item as processLotWalkPhoto would emit after website join. */
function lotWalkItemFromVehicle(vehicle: VehicleRecordV1): LotWalkListItemV1 {
  const web = websitePriceFromVehicle(vehicle);
  return {
    vin: vehicle.vin,
    observationId: "obs-crown-1",
    walkId: "walk-integration-1",
    vehicleId: vehicle.id,
    observedAt: NOW,
    lastSeenAt: NOW,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    condition: vehicle.condition,
    exteriorColor: vehicle.exteriorColor,
    matchStatus: "MATCHED",
    temporal: "PHYSICALLY_OBSERVED",
    websiteListing: vehicle.listingUrl ? "ON_WEBSITE" : "NOT_FOUND_ON_WEBSITE",
    website: web,
    photoDocumentIds: ["doc-crown-photo"],
    photoCount: 1,
    customerMatches: [],
    notes: "lot walk photo",
    summaryLine: `${vehicle.year} ${vehicle.model} ${vehicle.trim ?? ""}`.trim(),
  };
}

test("REAL CROWN photo path exists (oracle image preserved for production E2E)", () => {
  const found = CROWN_PHOTO_CANDIDATES.find((p) => existsSync(p));
  assert.ok(found, `Crown photo missing; checked: ${CROWN_PHOTO_CANDIDATES.join(" | ")}`);
  const bytes = readFileSync(found!);
  assert.ok(bytes.length > 10_000, "Crown image should be a real JPEG, not a stub");
  // JPEG SOI
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);
});

test("LOT WALK price truth: website price ≠ MSRP; no invention; source separation", () => {
  const vehicle = crownVehicle();
  const web = websitePriceFromVehicle(vehicle);
  assert.equal(web.websitePrice, 53378);
  assert.equal(web.stickerMsrp, 50955);
  assert.equal(web.priceState, "PRICE_PUBLISHED");
  assert.equal(web.sourceLabel, "website_advertised");
  assert.notEqual(web.websitePrice, web.stickerMsrp);

  const msrpOnly = websitePriceFromVehicle(
    crownVehicle({
      priceHistory: [
        {
          at: NOW,
          advertisedPrice: null,
          msrp: 50955,
          dealerPrice: null,
          sourceUrl: LISTING,
        },
      ],
      listingUrl: null,
      lastOnlineAt: null,
    }),
  );
  assert.equal(msrpOnly.websitePrice, null);
  assert.equal(msrpOnly.stickerMsrp, 50955);
  assert.equal(msrpOnly.priceState, "PRICE_NOT_PUBLISHED");

  const none = websitePriceFromVehicle(null);
  assert.equal(none.websitePrice, null);
  assert.equal(none.priceState, "PRICE_NOT_PUBLISHED");
});

test("LOT WALK → CONTENT OPPORTUNITY → FACEBOOK / INSTAGRAM / SHORT VIDEO / WEBSITE FEATURE", () => {
  const vehicle = crownVehicle();
  const item = lotWalkItemFromVehicle(vehicle);
  assert.equal(item.temporal, "PHYSICALLY_OBSERVED");
  assert.equal(item.websiteListing, "ON_WEBSITE");
  assert.equal(item.website.websitePrice, 53378);

  // Feed only grounded fields into Sales Presence — no competing inventory copy.
  const signal: ContentSignalV1 = {
    kind: "NEW_VEHICLE_ON_LOT",
    workspace: "work",
    subject: `${item.year} ${item.model} ${item.trim ?? ""}`.trim(),
    observedAt: item.observedAt,
    sourceRefs: [
      `lot-walk:${item.walkId}`,
      `observation:${item.observationId}`,
      `vehicle:${item.vehicleId}`,
      `vin:${item.vin}`,
      `listing:${vehicle.listingUrl}`,
    ],
    vehicleRef: item.vehicleId,
    detail: `physically observed; website price ${item.website.websitePrice ?? "NOT_PUBLISHED"}`,
  };

  const opp = contentOpportunityFromSignal({
    signal,
    opportunityId: "opp-lot-crown",
    enabledPillars: DEFAULT_CONTENT_PILLARS,
    now: NOW,
  });
  assert.ok(!("refused" in opp), `opportunity refused: ${JSON.stringify(opp)}`);
  assert.equal(opp.type, "NEW_VEHICLE_ON_LOT");
  assert.ok(opp.sourceRefs.some((r) => r.startsWith("lot-walk:")));
  assert.ok(opp.sourceRefs.some((r) => r.startsWith("vin:")));

  const facts = vehicleContentFacts({
    vehicle,
    features: ["All-wheel drive"],
  });
  const price = priceFactFromVehicle(vehicle);
  assert.equal(price.kind, "WEBSITE_ADVERTISED");
  assert.equal(price.amount, 53378);
  // MSRP remains a separate fact on the vehicle; quotable price is website only.
  assert.match(priceSentence(price), /Listed at \$53,378/i);
  assert.doesNotMatch(priceSentence(price), /sale price|now only|only \$/i);

  const formats = [
    "FACEBOOK_POST",
    "INSTAGRAM_CAPTION",
    "SHORT_VIDEO_SCRIPT",
    "WEBSITE_FEATURED_VEHICLE",
  ] as const;

  const drafts: ContentDraftV1[] = [];
  for (const format of formats) {
    const built = generateContentDraft({
      draftId: `draft-${format}`,
      workspace: "work",
      format,
      facts,
      opportunity: opp,
      brand: brand(),
      now: NOW,
    });
    assert.ok(!("refused" in built), `${format} refused: ${JSON.stringify(built)}`);
    const draft = built as ContentDraftV1;
    drafts.push(draft);
    assert.ok(
      draft.sourceRefs.some((r) =>
        r.includes("vehicle") || r.includes("lot-walk") || r.includes("vin") || r.includes("listing") || r.includes("price"),
      ),
    );
    // Price invention / incentive bans
    const body = `${draft.title}\n${draft.body}`;
    assert.doesNotMatch(body, /\bAPR\b/i);
    assert.doesNotMatch(body, /\brebate\b/i);
    assert.doesNotMatch(body, /\$\d+\/mo|per month/i);
    assert.doesNotMatch(body, /sale price|now only/i);
    // Private customer data must never appear
    const privateHits = scanDraftForPrivateData(draft);
    assert.equal(privateHits.length, 0, `private data in ${format}: ${privateHits.join(", ")}`);
    assert.doesNotMatch(body, /Sarah|863-555|@example\.com/i);
  }

  assert.equal(drafts.length, 4);

  // Website feature page from same facts
  const page = vehiclePageFromFacts({
    facts,
    now: NOW,
  });
  assert.ok(page);
  assert.match(JSON.stringify(page), /Crown Signia|Signia/i);
});

test("PRICE TRUTH: equal numeric MSRP and web price still keep separate provenance", () => {
  const vehicle = crownVehicle({
    priceHistory: [
      {
        at: NOW,
        advertisedPrice: 50955,
        msrp: 50955,
        dealerPrice: null,
        sourceUrl: LISTING,
      },
    ],
  });
  const web = websitePriceFromVehicle(vehicle);
  assert.equal(web.websitePrice, 50955);
  assert.equal(web.stickerMsrp, 50955);
  assert.equal(web.sourceLabel, "website_advertised");

  const fact = priceFactFromVehicle(vehicle);
  assert.equal(fact.kind, "WEBSITE_ADVERTISED");
  assert.equal(fact.amount, 50955);
  assert.equal(fact.sourceRef, LISTING);
  assert.match(priceSentence(fact), /Listed at/i);
  assert.doesNotMatch(priceSentence(fact), /Window sticker MSRP is \$50,955 — that is the manufacturer's sticker.*Listed/i);
});

test("STALE inventory content invalidates; never silently CURRENT", () => {
  const vehicle = crownVehicle();
  const signal: ContentSignalV1 = {
    kind: "NEW_ONLINE_LISTING",
    workspace: "work",
    subject: "Crown Signia Limited",
    observedAt: NOW,
    sourceRefs: [`vehicle:${vehicle.id}`, `listing:${LISTING}`],
    vehicleRef: vehicle.id,
  };
  const opp = contentOpportunityFromSignal({
    signal,
    opportunityId: "opp-stale",
    enabledPillars: DEFAULT_CONTENT_PILLARS,
    now: NOW,
  });
  assert.ok(!("refused" in opp));
  const draft = generateContentDraft({
    draftId: "draft-stale",
    workspace: "work",
    format: "FACEBOOK_POST",
    facts: vehicleContentFacts({ vehicle }),
    opportunity: opp as never,
    brand: brand(),
    now: NOW,
  });
  assert.ok(!("refused" in draft));
  assert.equal((draft as ContentDraftV1).freshness, "CURRENT");

  const sold = reviewDraftFreshness({
    draft: draft as ContentDraftV1,
    vehicle: crownVehicle({ presenceStatus: "NO_LONGER_FOUND_ONLINE" as never }),
    now: NOW,
  });
  assert.equal(sold.freshness, "STALE");
  assert.notEqual(sold.freshness, "CURRENT");

  const repriced = reviewDraftFreshness({
    draft: draft as ContentDraftV1,
    vehicle: crownVehicle({
      priceHistory: [
        {
          at: "2026-08-12T14:00:00.000Z",
          advertisedPrice: 51999,
          msrp: 50955,
          dealerPrice: null,
          sourceUrl: LISTING,
        },
      ],
    }),
    now: NOW,
  });
  assert.equal(repriced.freshness, "NEEDS_REVERIFY");
  assert.notEqual(repriced.freshness, "CURRENT");
});

test("CUSTOMER DEMAND privacy: aggregate ok; private fields never in public draft", () => {
  const ranked = rankContentOpportunities({
    signals: [
      {
        kind: "CUSTOMER_DEMAND",
        workspace: "work",
        subject: "Crown Signia AWD",
        observedAt: NOW,
        sourceRefs: ["need-agg:model:crown"],
        customerCount: 3,
      },
      {
        kind: "CUSTOMER_DEMAND",
        workspace: "work",
        subject: "one person only",
        observedAt: NOW,
        sourceRefs: ["need:secret-customer"],
        customerCount: 1,
      },
    ],
    enabledPillars: DEFAULT_CONTENT_PILLARS,
    workspace: "work",
    now: NOW,
    nextId: (i) => `opp-priv-${i}`,
  });
  assert.ok(ranked.opportunities.some((o) => o.subject.includes("Crown")));
  assert.ok(ranked.declined.some((r) => /below|aggregate|customer|private/i.test(r.reason)));

  const vehicle = crownVehicle();
  const opp = ranked.opportunities[0]!;
  const draft = generateContentDraft({
    draftId: "draft-privacy",
    workspace: "work",
    format: "FACEBOOK_POST",
    facts: vehicleContentFacts({ vehicle }),
    opportunity: opp,
    brand: brand(),
    now: NOW,
  });
  if (!("refused" in draft)) {
    const body = `${draft.title}\n${draft.body}`;
    assert.doesNotMatch(body, /Sarah Whitmore|863-555|@example\.com|transcript/i);
    assert.equal(scanDraftForPrivateData(draft).length, 0);
  }
});

test("AUDIO → CRM proposal → BrowserTask → TEKION_MOCK result (lineage, no external effect)", () => {
  const SARAH_AION = "6103a23c-ff4a-4a2d-aefc-775fb2a99fd5";
  const SARAH_TEKION = "tekion:customer:C-100418";
  const CALL_TEXT =
    "I am looking for a Camry XSE under 35,000. I do not want a hybrid. Dark blue would be nice. "
    + "I need all wheel drive. I will be there Saturday at 2.";

  const sarah = {
    id: SARAH_AION,
    displayName: "Sarah Whitmore",
    workspace: "work",
    organisation: "",
    role: "",
    notes: "",
    objections: [],
    interests: [],
    archived: false,
    kind: "customer",
    lifecycle: "prospect",
    contactMethods: [
      { channel: "phone", value: "863-555-0142" },
      { channel: "email", value: "sarah.whitmore@example.com" },
    ],
    followUps: [],
    interactions: [],
  } as unknown as RelationshipV1;

  const identity = resolveCustomerIdentity({
    signals: { workspace: "work", phone: "863-555-0142" },
    relationships: [sarah],
  });

  const transcript = buildTranscriptFromEngineText({
    transcriptId: "t-sales-sys-001",
    sourceRef: "audio:synthetic-call.wav",
    workspace: "work",
    startedAt: NOW,
    audioSourceRef: "private:intake/synthetic-call.wav",
    mimeType: "audio/wav",
    byteLength: 245854,
    engine: "faster-whisper",
    model: "tiny.en",
    fullText: CALL_TEXT,
    confidence: 82,
  });

  const outcome = ingestConversationFromTranscript({
    transcript,
    identity,
    ingestPath: "UPLOADED_CALL_RECORDING",
    speakerBinding: { customer: "UNKNOWN" },
    capturedAt: NOW,
    existingNeeds: [],
  });
  assert.ok(outcome.proposals.length >= 3, "PREPARE_CALL_NOTE / FOLLOWUP / PREFERENCE expected");

  const links: ExternalCustomerLinkV1[] = [
    {
      workspace: "work",
      relationshipRef: SARAH_AION,
      externalRef: SARAH_TEKION,
      linkedAt: NOW,
      method: "OWNER_CONFIRMED",
    },
  ];

  const d: BrowserWorkerDepsV1 = {
    store: createMockTekionStore(),
    ledger: new InMemoryBrowserPreviewLedgerV1(),
    now: () => NOW,
  };

  const wanted = [
    "PREPARE_CALL_NOTE",
    "PREPARE_FOLLOWUP",
    "PREPARE_PREFERENCE_UPDATE",
  ] as const;

  for (const action of wanted) {
    const proposal = outcome.proposals.find((p) => p.action === action);
    assert.ok(proposal, `missing ${action}`);

    const taskOrRefusal = browserTaskFromCrmProposal({
      proposal,
      links,
      taskId: `task-${action}`,
      requestedBy: "owner",
      createdAt: NOW,
    });
    assert.ok(!isBrowserTaskRefusal(taskOrRefusal), `${action} task refused: ${JSON.stringify(taskOrRefusal)}`);
    if (isBrowserTaskRefusal(taskOrRefusal)) return;
    assert.equal(taskOrRefusal.provider, "TEKION_MOCK");
    assert.equal(taskOrRefusal.customerRef, SARAH_TEKION);
    assert.notEqual(taskOrRefusal.customerRef, SARAH_AION);

    const lineage = describeTaskLineage(taskOrRefusal);
    assert.match(lineage, /proposal:|task:|evidence:/i);
    assert.ok(taskOrRefusal.sourceRefs.length > 0, "SOURCE_LINEAGE: task carries transcript/proposal refs");

    const result = submitBrowserTask(taskOrRefusal, d);
    assert.equal(result.provider, "TEKION_MOCK");
    assert.equal(result.externalEffect, false);
    assert.deepEqual(result.actualWrites, []);
  }

  // Name-only targeting refused at task build
  assert.equal(isCanonicalCustomerRef("Sarah Whitmore"), false);
  const nameRefused = buildBrowserTask({
    taskId: "task-name",
    workspaceId: "work",
    taskType: "READ_CUSTOMER",
    customerRef: "Sarah Whitmore",
    idempotencyKey: "k-name",
    requestedBy: "owner",
    createdAt: NOW,
  } as never);
  assert.ok(isBrowserTaskRefusal(nameRefused));
  assert.equal(nameRefused.code, "NAME_ONLY_TARGET");

  // Missing external link → null, not a display-name search
  assert.equal(resolveExternalCustomerRef([], "work", SARAH_AION), null);
});

test("IDENTITY: missing external link refused (AION id ≠ Tekion id)", () => {
  const SARAH_AION = "6103a23c-ff4a-4a2d-aefc-775fb2a99fd5";
  const transcript = buildTranscriptFromEngineText({
    transcriptId: "t-id-1",
    sourceRef: "audio:x.wav",
    workspace: "work",
    startedAt: NOW,
    audioSourceRef: "private:x.wav",
    mimeType: "audio/wav",
    byteLength: 100,
    engine: "faster-whisper",
    model: "tiny.en",
    fullText: "I want a Camry under 30000. Call me Saturday.",
    confidence: 80,
  });
  const identity = resolveCustomerIdentity({
    signals: { workspace: "work", phone: "863-555-0142" },
    relationships: [
      {
        id: SARAH_AION,
        displayName: "Sarah Whitmore",
        workspace: "work",
        organisation: "",
        role: "",
        notes: "",
        objections: [],
        interests: [],
        archived: false,
        kind: "customer",
        lifecycle: "prospect",
        contactMethods: [{ channel: "phone", value: "863-555-0142" }],
        followUps: [],
        interactions: [],
      } as unknown as RelationshipV1,
    ],
  });
  const outcome = ingestConversationFromTranscript({
    transcript,
    identity,
    ingestPath: "UPLOADED_CALL_RECORDING",
    speakerBinding: { customer: "UNKNOWN" },
    capturedAt: NOW,
    existingNeeds: [],
  });
  const proposal = outcome.proposals[0];
  assert.ok(proposal, "expected at least one proposal");
  const refused = browserTaskFromCrmProposal({
    proposal,
    links: [],
    taskId: "task-no-link",
    requestedBy: "owner",
    createdAt: NOW,
  });
  assert.ok(isBrowserTaskRefusal(refused), "must refuse without ExternalCustomerLink");
  assert.equal(refused.code, "NO_EXTERNAL_LINK");
});
