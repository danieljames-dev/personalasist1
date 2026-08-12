/**
 * One screen the Owner opens instead of deciding which part of AION to open.
 *
 * Every capability this composes already exists and is already tested — calls become customer needs,
 * photos become identified vehicles, inventory joins to demand, content derives from grounded
 * signals. What did not exist was a single place that answers "what should I do today?" without the
 * Owner first knowing which subsystem holds the answer. Asking a salesperson to know AION's
 * architecture in order to use AION is the thing this milestone removes.
 *
 * Three rules shape the projection.
 *
 * **Organised by outcome, not by contract.** There is no section named after `CrmActionProposalV1`.
 * The Owner thinks in customers, cars, calls, follow-ups and content, so those are the sections.
 *
 * **Bounded, and empty when empty.** Every section has a hard cap and every section is allowed to
 * return nothing. A dashboard that always shows five items teaches the Owner that the number five is
 * decoration; when three customers genuinely need attention, that number has to mean something.
 *
 * **Read-only and cheap.** Opening this must not crawl a website, run OCR, transcribe audio, or
 * call a model. It reads state that other paths already produced. Expensive work happens when the
 * Owner asks for it, not when they glance at their phone.
 *
 * Nothing here mutates state and nothing here reaches a network.
 */
import type { IsoTimestamp, OpaqueId, RelationshipV1 } from "./contracts.js";
import type { VehicleRecordV1 } from "./vehicle-inventory.js";
import type { CustomerNeedV1 } from "./customer-needs.js";
import { currentNeeds, isCurrentNeed, needChanges } from "./customer-needs.js";
import type { CommitmentCandidateV1, ConversationEventV1 } from "./conversation-event.js";
import type { CrmActionProposalV1 } from "./crm-action-proposal.js";
import type { LotWalkListItemV1, LotWalkSessionViewV1 } from "./lot-walk.js";
import type { PriceDisplayV1 } from "./price-display.js";
import { priceDisplayFromVehicle } from "./price-display.js";
import { matchNeedsToInventory, type CustomerVehicleFitV1 } from "./customer-inventory-match.js";
import type { ContentDraftV1 } from "./content-draft.js";
import type { ContentOpportunityV1 } from "./content-opportunity.js";
import type { SocialContentPlanV1 } from "./content-plan.js";

export const SALES_COMMAND_CENTER_SCHEMA_V1 = "aion.sales-command-center.v1" as const;

/** Caps. A phone screen holds a handful of things; beyond that the Owner scrolls past all of it. */
const MAX_CUSTOMERS = 5;
const MAX_VEHICLES = 5;
const MAX_FOLLOWUPS = 6;
const MAX_CONTENT = 4;
const MAX_CALLS = 5;

// ---------------------------------------------------------------------------
// Section shapes
// ---------------------------------------------------------------------------

export interface TodaySummaryV1 {
  customerFollowupsThatMatter: number;
  strongVehicleMatches: number;
  vehiclesPhotographedToday: number;
  priceChangesToday: number;
  preparedCrmActions: number;
  contentOpportunities: number;
  staleWebsiteDrafts: number;
  /** Owner-readable lines. Empty when genuinely nothing is happening. */
  headlines: string[];
}

export type CustomerAttentionReasonV1 =
  | "OWED_COMMITMENT"
  | "CUSTOMER_COMMITMENT_DUE"
  | "PREPARED_ACTION_WAITING"
  | "STRONG_INVENTORY_MATCH"
  | "NEEDS_CHANGED"
  | "IDENTITY_UNRESOLVED";

export interface CustomerAttentionItemV1 {
  relationshipRef: OpaqueId;
  name: string;
  /** Why this person is on the list right now, in the Owner's words. */
  why: string;
  reasons: CustomerAttentionReasonV1[];
  priority: number;
  currentNeedSummary: string;
  ownerOwes: string[];
  customerPromised: string[];
  preparedActionCount: number;
  topMatches: Array<{ vehicleRef: string; label: string; price: string; fit: string }>;
  lastInteractionAt: IsoTimestamp | null;
  /** What AION could not establish and the Owner can. */
  unknowns: string[];
}

export interface VehicleOpportunityItemV1 {
  vehicleRef: OpaqueId;
  vin: string | null;
  label: string;
  price: PriceDisplayV1;
  seenOnLot: boolean;
  onWebsite: boolean;
  /** Never "sold" — absence from a website is not a sale. */
  websiteNote: string;
  interestedCustomers: Array<{ relationshipRef: string; name: string; fit: string }>;
  why: string;
}

export interface LotWalkPanelV1 {
  active: boolean;
  walkId: OpaqueId | null;
  observedToday: number;
  identified: number;
  unresolvedPhotos: number;
  duplicates: number;
  notOnWebsite: number;
  noPublishedPrice: number;
  customerMatchCount: number;
  /** Empty string when there is no walk — the UI shows the start action instead. */
  message: string;
}

export interface CallPanelItemV1 {
  conversationRef: OpaqueId;
  occurredAt: IsoTimestamp;
  /** RESOLVED customers are named; unresolved calls are never attached to a person. */
  customerName: string | null;
  identityState: string;
  needsExtracted: number;
  commitments: number;
  preparedActions: number;
  /** States plainly how speaker roles were decided, so nothing implies real diarisation. */
  attributionNote: string;
}

export interface PreparedFollowupItemV1 {
  proposalId: OpaqueId;
  customerRef: OpaqueId;
  customerName: string;
  kind: string;
  what: string;
  why: string;
  sourceSummary: string;
  /** Always PREPARED at this milestone. Never SENT, WRITTEN or LOGGED. */
  status: "PREPARED";
  wouldDo: string;
}

export interface ContentPanelV1 {
  opportunityCount: number;
  draftsReady: number;
  videoIdeas: number;
  needsReverify: number;
  suggestions: Array<{ subject: string; format: string; requiresReview: boolean }>;
  message: string;
}

export interface WebsitePanelV1 {
  featuredCandidates: number;
  staleItems: number;
  proposedPriceUpdates: number;
  preparedChanges: number;
  /** Always PREPARED. No site is deployed. */
  status: "PREPARED";
  message: string;
}

export interface CapabilityStatusV1 {
  area: string;
  state: "READY" | "NOT_CONNECTED" | "NOT_DEPLOYED" | "UNKNOWN";
  detail: string;
}

export interface ActionItemV1 {
  /** Short imperative the UI can put on a button. */
  label: string;
  detail: string;
  /** Where this lands, in Owner terms. */
  target: string;
}

export interface SalesCommandCenterV1 {
  schema: typeof SALES_COMMAND_CENTER_SCHEMA_V1;
  generatedAt: IsoTimestamp;
  workspace: string;
  today: TodaySummaryV1;
  customerAttention: CustomerAttentionItemV1[];
  vehicleOpportunities: VehicleOpportunityItemV1[];
  lotWalk: LotWalkPanelV1;
  calls: CallPanelItemV1[];
  preparedFollowups: PreparedFollowupItemV1[];
  content: ContentPanelV1;
  website: WebsitePanelV1;
  aionCanDo: ActionItemV1[];
  ownerMustDo: ActionItemV1[];
  capabilityStatus: CapabilityStatusV1[];
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface SalesCommandCenterInputV1 {
  workspace: string;
  now: IsoTimestamp;
  relationships: readonly RelationshipV1[];
  needs: readonly CustomerNeedV1[];
  commitments: readonly CommitmentCandidateV1[];
  proposals: readonly CrmActionProposalV1[];
  conversations: readonly ConversationEventV1[];
  vehicles: readonly VehicleRecordV1[];
  lotWalkView?: LotWalkSessionViewV1 | null;
  opportunities?: readonly ContentOpportunityV1[];
  drafts?: readonly ContentDraftV1[];
  plan?: SocialContentPlanV1 | null;
  /** Reported as-is; this projection never probes a connector. */
  gmailReady?: boolean;
  inventoryCount?: number;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

export function buildSalesCommandCenter(input: SalesCommandCenterInputV1): SalesCommandCenterV1 {
  // Workspace is a boundary applied once, at the top. Every section below reads the filtered set,
  // so no individual section can forget it and surface a personal contact in a dealership view.
  const relationships = input.relationships.filter((r) => !r.archived && r.workspace === input.workspace);
  const relationshipIds = new Set(relationships.map((r) => r.id));
  const needs = input.needs.filter((n) => n.workspace === input.workspace && relationshipIds.has(n.relationshipRef));
  const proposals = input.proposals.filter((p) => p.workspace === input.workspace && relationshipIds.has(p.customerRef));
  const conversations = input.conversations.filter((c) => c.workspace === input.workspace);
  const vehicles = input.vehicles;

  const nameOf = (ref: string): string =>
    relationships.find((r) => r.id === ref)?.displayName ?? "this customer";

  const commitments = scopedCommitments(input.commitments, conversations);
  const lotWalk = buildLotWalkPanel(input.lotWalkView ?? null);
  const customerAttention = buildCustomerAttention({
    relationships, needs, commitments, proposals, conversations, vehicles, now: input.now,
  });
  const vehicleOpportunities = buildVehicleOpportunities({
    lotWalkView: input.lotWalkView ?? null, vehicles, relationships, needs,
  });
  const calls = buildCallPanel({ conversations, needs, proposals, nameOf });
  const preparedFollowups = buildPreparedFollowups({ proposals, nameOf });
  const content = buildContentPanel({
    opportunities: input.opportunities ?? [], drafts: input.drafts ?? [], plan: input.plan ?? null,
  });
  const website = buildWebsitePanel({ drafts: input.drafts ?? [], vehicleOpportunities });

  const today = buildToday({
    customerAttention, vehicleOpportunities, lotWalk, proposals, content, website, vehicles, now: input.now,
  });

  return {
    schema: SALES_COMMAND_CENTER_SCHEMA_V1,
    generatedAt: input.now,
    workspace: input.workspace,
    today,
    customerAttention,
    vehicleOpportunities,
    lotWalk,
    calls,
    preparedFollowups,
    content,
    website,
    aionCanDo: buildAionCanDo({ customerAttention, lotWalk, content, preparedFollowups }),
    ownerMustDo: buildOwnerMustDo({ customerAttention, lotWalk, calls }),
    capabilityStatus: buildCapabilityStatus({
      gmailReady: input.gmailReady ?? false,
      inventoryCount: input.inventoryCount ?? vehicles.length,
    }),
  };
}

/** Commitments belong to conversations; a commitment from another workspace's call is not ours. */
function scopedCommitments(
  all: readonly CommitmentCandidateV1[],
  conversations: readonly ConversationEventV1[],
): CommitmentCandidateV1[] {
  const ids = new Set(conversations.map((c) => c.id));
  return all.filter((c) => {
    const match = /^conversation:([^#]+)#/.exec(c.sourceRef);
    return match ? ids.has(match[1]!) : false;
  });
}

/** Which conversation a commitment came from, so it can be attributed to that call's customer. */
function commitmentCustomer(
  commitment: CommitmentCandidateV1,
  conversations: readonly ConversationEventV1[],
): string | null {
  const match = /^conversation:([^#]+)#/.exec(commitment.sourceRef);
  if (!match) return null;
  const conversation = conversations.find((c) => c.id === match[1]);
  return conversation?.identity.relationshipRef ?? null;
}

// ---------------------------------------------------------------------------
// Customer attention
// ---------------------------------------------------------------------------

function buildCustomerAttention(input: {
  relationships: readonly RelationshipV1[];
  needs: readonly CustomerNeedV1[];
  commitments: readonly CommitmentCandidateV1[];
  proposals: readonly CrmActionProposalV1[];
  conversations: readonly ConversationEventV1[];
  vehicles: readonly VehicleRecordV1[];
  now: IsoTimestamp;
}): CustomerAttentionItemV1[] {
  const items: CustomerAttentionItemV1[] = [];

  for (const relationship of input.relationships) {
    const mine = currentNeeds(input.needs, relationship.id);
    const myCommitments = input.commitments.filter(
      (c) => commitmentCustomer(c, input.conversations) === relationship.id,
    );
    const owed = myCommitments.filter((c) => c.party === "OWNER_PROMISED");
    const theirs = myCommitments.filter((c) => c.party === "CUSTOMER_PROMISED");
    const prepared = input.proposals.filter((p) => p.customerRef === relationship.id && p.status === "PROPOSED");
    const changes = needChanges(input.needs, relationship.id);

    const fits: CustomerVehicleFitV1[] = mine.length
      ? matchNeedsToInventory({ needs: mine, vehicles: input.vehicles, limit: 3 })
      : [];
    const strong = fits.filter((f) => !f.disqualified && f.matchScore >= 60);

    const reasons: CustomerAttentionReasonV1[] = [];
    if (owed.length) reasons.push("OWED_COMMITMENT");
    if (theirs.length) reasons.push("CUSTOMER_COMMITMENT_DUE");
    if (prepared.length) reasons.push("PREPARED_ACTION_WAITING");
    if (strong.length) reasons.push("STRONG_INVENTORY_MATCH");
    if (changes.length) reasons.push("NEEDS_CHANGED");

    // A customer appears only because something is true about them right now. Existing is not a
    // reason — a list that includes everyone is a list nobody reads.
    if (!reasons.length) continue;

    const priority =
      (owed.length ? 40 : 0)
      + (prepared.length ? 22 : 0)
      + (strong.length ? 18 : 0)
      + (theirs.length ? 12 : 0)
      + (changes.length ? 8 : 0);

    items.push({
      relationshipRef: relationship.id,
      name: relationship.displayName,
      why: whyLine({ owed, theirs, prepared: prepared.length, strong: strong.length, changed: changes.length, name: relationship.displayName }),
      reasons,
      priority,
      currentNeedSummary: summariseNeeds(mine),
      ownerOwes: owed.map((c) => `${c.statement}${c.timeHint ? ` (${c.timeHint})` : ""}`),
      customerPromised: theirs.map((c) => `${c.statement}${c.timeHint ? ` (${c.timeHint})` : ""}`),
      preparedActionCount: prepared.length,
      topMatches: fits.slice(0, 2).map((fit) => ({
        vehicleRef: fit.vehicleId,
        label: fit.label,
        price: priceDisplayFromVehicle(input.vehicles.find((v) => v.id === fit.vehicleId) ?? null).headline,
        fit: fit.why[0] ?? (fit.disqualified ? "ruled out" : "possible fit"),
      })),
      lastInteractionAt: lastInteraction(relationship, input.conversations),
      // Unknowns are surfaced because they are what the Owner can resolve and AION cannot.
      unknowns: [...new Set(fits.flatMap((f) => f.unknowns.map((u) => `${attributeLabel(u.attribute)} not verified`)))].slice(0, 3),
    });
  }

  items.sort((a, b) => b.priority - a.priority || (a.name < b.name ? -1 : 1));
  return items.slice(0, MAX_CUSTOMERS);
}

function whyLine(input: {
  owed: readonly CommitmentCandidateV1[];
  theirs: readonly CommitmentCandidateV1[];
  prepared: number;
  strong: number;
  changed: number;
  name: string;
}): string {
  if (input.owed.length) {
    const first = input.owed[0]!;
    return `You said you would ${lowerFirst(first.statement)}${first.timeHint ? ` ${first.timeHint}` : ""}.`;
  }
  if (input.prepared) return `${input.prepared} thing${input.prepared === 1 ? "" : "s"} prepared and waiting for you.`;
  if (input.strong) return `${input.strong} vehicle${input.strong === 1 ? "" : "s"} on the lot now fit what they asked for.`;
  if (input.theirs.length) return `They said they would ${lowerFirst(input.theirs[0]!.statement)}.`;
  return `What they want has changed since you last spoke.`;
}

function lowerFirst(text: string): string {
  const trimmed = String(text ?? "").trim().replace(/^I(?:'| wi)ll\s+/i, "");
  return trimmed ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1) : trimmed;
}

/**
 * Owner-readable name for a need attribute.
 *
 * `must-have` is how the extraction layer stores equipment, and it is not a phrase anybody says out
 * loud. Internal vocabulary reaching a phone screen is how an interface starts sounding like a
 * database.
 */
function attributeLabel(attribute: string): string {
  const labels: Record<string, string> = {
    "must-have": "equipment",
    "must-not-have": "excluded equipment",
    "nice-to-have": "preferred equipment",
    "max-price": "price",
    "payment-target": "monthly payment",
    powertrain: "powertrain",
    color: "colour",
    condition: "new or used",
    model: "model",
    make: "make",
    trim: "trim",
  };
  return labels[attribute] ?? attribute;
}

function summariseNeeds(needs: readonly CustomerNeedV1[]): string {
  if (!needs.length) return "Nothing recorded yet.";
  const requirements = needs.filter((n) => n.strength === "HARD_REQUIREMENT");
  const exclusions = needs.filter((n) => n.strength === "EXCLUSION");
  const parts: string[] = [];
  if (requirements.length) parts.push(`needs ${requirements.map(describeShort).join(", ")}`);
  if (exclusions.length) parts.push(`ruled out ${exclusions.map(describeShort).join(", ")}`);
  if (!parts.length) parts.push(`prefers ${needs.slice(0, 2).map(describeShort).join(", ")}`);
  return parts.join("; ");
}

function describeShort(need: CustomerNeedV1): string {
  if (need.numericValue != null && need.attribute === "max-price") {
    return `under $${need.numericValue.toLocaleString("en-US")}`;
  }
  if (need.numericValue != null && need.attribute === "payment-target") {
    return `about $${need.numericValue.toLocaleString("en-US")}/mo`;
  }
  return need.value;
}

function lastInteraction(
  relationship: RelationshipV1,
  conversations: readonly ConversationEventV1[],
): IsoTimestamp | null {
  const mine = conversations
    .filter((c) => c.identity.relationshipRef === relationship.id)
    .map((c) => c.occurredAt)
    .sort();
  return mine.length ? mine[mine.length - 1]! : null;
}

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

function buildVehicleOpportunities(input: {
  lotWalkView: LotWalkSessionViewV1 | null;
  vehicles: readonly VehicleRecordV1[];
  relationships: readonly RelationshipV1[];
  needs: readonly CustomerNeedV1[];
}): VehicleOpportunityItemV1[] {
  const items: VehicleOpportunityItemV1[] = [];
  const seen = new Set<string>();

  for (const item of input.lotWalkView?.vehicles ?? []) {
    if (!item.vehicleId || seen.has(item.vehicleId)) continue;
    seen.add(item.vehicleId);
    const vehicle = input.vehicles.find((v) => v.id === item.vehicleId) ?? null;
    items.push(vehicleOpportunity({ item, vehicle, relationships: input.relationships }));
    if (items.length >= MAX_VEHICLES) break;
  }

  items.sort((a, b) => b.interestedCustomers.length - a.interestedCustomers.length);
  return items;
}

function vehicleOpportunity(input: {
  item: LotWalkListItemV1;
  vehicle: VehicleRecordV1 | null;
  relationships: readonly RelationshipV1[];
}): VehicleOpportunityItemV1 {
  const onWebsite = input.item.websiteListing === "ON_WEBSITE";
  const price = priceDisplayFromVehicle(input.vehicle);
  const interested = input.item.customerMatches
    .filter((m) => input.relationships.some((r) => r.id === m.relationshipRef))
    .slice(0, 3)
    .map((m) => ({ relationshipRef: m.relationshipRef, name: m.customerName, fit: m.why }));

  return {
    vehicleRef: input.item.vehicleId ?? input.item.observationId,
    vin: input.item.vin,
    label: [input.item.year, input.item.make, input.item.model, input.item.trim].filter(Boolean).join(" ") || "Unidentified vehicle",
    price,
    seenOnLot: true,
    onWebsite,
    // Absence from a website is absence of a listing, not a sale. Saying "sold" would be a guess
    // the Owner would repeat to a customer.
    websiteNote: onWebsite
      ? "Listed on the dealer site."
      : input.item.websiteListing === "NOT_FOUND_ON_WEBSITE"
        ? "Not currently found on the dealer site — that is not the same as sold."
        : "Website state unknown.",
    interestedCustomers: interested,
    why: interested.length
      ? `${interested.length} customer${interested.length === 1 ? "" : "s"} may want this.`
      : price.unknown
        ? "No published price — worth checking before you quote anything."
        : "Seen on the lot today.",
  };
}

// ---------------------------------------------------------------------------
// Lot walk
// ---------------------------------------------------------------------------

function buildLotWalkPanel(view: LotWalkSessionViewV1 | null): LotWalkPanelV1 {
  if (!view) {
    return {
      active: false, walkId: null, observedToday: 0, identified: 0, unresolvedPhotos: 0,
      duplicates: 0, notOnWebsite: 0, noPublishedPrice: 0, customerMatchCount: 0,
      message: "You haven't started a lot walk today.",
    };
  }
  const notOnWebsite = view.vehicles.filter((v) => v.websiteListing === "NOT_FOUND_ON_WEBSITE").length;
  const noPrice = view.vehicles.filter((v) => v.website.websitePrice == null).length;
  const matches = view.vehicles.reduce((sum, v) => sum + v.customerMatches.length, 0);
  return {
    active: view.state !== "ended",
    walkId: view.sessionId,
    observedToday: view.photoEvidenceCount,
    identified: view.identifiedVehicleCount,
    unresolvedPhotos: view.unresolvedPhotoCount,
    duplicates: view.duplicateVinCount,
    notOnWebsite,
    noPublishedPrice: noPrice,
    customerMatchCount: matches,
    message: `${view.identifiedVehicleCount} identified from ${view.photoEvidenceCount} photo${view.photoEvidenceCount === 1 ? "" : "s"}.`,
  };
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

function buildCallPanel(input: {
  conversations: readonly ConversationEventV1[];
  needs: readonly CustomerNeedV1[];
  proposals: readonly CrmActionProposalV1[];
  nameOf: (ref: string) => string;
}): CallPanelItemV1[] {
  return [...input.conversations]
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
    .slice(0, MAX_CALLS)
    .map((conversation) => {
      const resolved = conversation.identity.state === "RESOLVED" && conversation.identity.relationshipRef;
      const extracted = input.needs.filter((n) => n.sourceRef.startsWith(`conversation:${conversation.id}#`)).length;
      const bound = conversation.segments.some((s) => s.speaker === "OWNER" || s.speaker === "CUSTOMER");
      return {
        conversationRef: conversation.id,
        occurredAt: conversation.occurredAt,
        // An unresolved call is never given a name. That is the whole point of the state.
        customerName: resolved ? input.nameOf(conversation.identity.relationshipRef!) : null,
        identityState: conversation.identity.state,
        needsExtracted: extracted,
        commitments: conversation.derived.commitmentIds.length,
        preparedActions: resolved
          ? input.proposals.filter((p) => p.customerRef === conversation.identity.relationshipRef).length
          : 0,
        // AION has no speaker diarisation. Saying so plainly stops the Owner assuming it does.
        attributionNote: bound
          ? "Speaker roles came from the session binding you supplied, not from automatic voice separation."
          : "Speakers were not identified, so nothing in this call is attributed to either party.",
      };
    });
}

// ---------------------------------------------------------------------------
// Prepared follow-ups
// ---------------------------------------------------------------------------

const PROPOSAL_LABEL: Record<string, string> = {
  PREPARE_CALL_NOTE: "Call note",
  PREPARE_FOLLOWUP: "Follow-up",
  PREPARE_PREFERENCE_UPDATE: "Preference update",
};

function buildPreparedFollowups(input: {
  proposals: readonly CrmActionProposalV1[];
  nameOf: (ref: string) => string;
}): PreparedFollowupItemV1[] {
  return input.proposals
    .filter((p) => p.status === "PROPOSED")
    .slice(0, MAX_FOLLOWUPS)
    .map((proposal) => ({
      proposalId: proposal.proposalId,
      customerRef: proposal.customerRef,
      customerName: input.nameOf(proposal.customerRef),
      kind: PROPOSAL_LABEL[proposal.action] ?? proposal.action.replace(/_/g, " ").toLowerCase(),
      what: proposal.note,
      why: `From ${proposal.sourceRefs.length} piece${proposal.sourceRefs.length === 1 ? "" : "s"} of evidence on file.`,
      sourceSummary: describeSources(proposal.sourceRefs),
      // Nothing is connected, so nothing can have been sent. The word matters.
      status: "PREPARED",
      wouldDo: proposal.expectedExternalEffect,
    }));
}

/** Plain-language provenance. The Owner should not have to read a ref to know where this came from. */
function describeSources(refs: readonly string[]): string {
  const kinds = new Set<string>();
  for (const ref of refs) {
    if (ref.startsWith("transcript:")) kinds.add("a recorded call");
    else if (ref.startsWith("conversation:")) kinds.add("what was said on the call");
    else if (ref.startsWith("vehicle:")) kinds.add("the vehicle record");
    else if (ref.startsWith("owner-correction:")) kinds.add("your own correction");
  }
  return kinds.size ? [...kinds].join(" and ") : "recorded evidence";
}

// ---------------------------------------------------------------------------
// Content and website
// ---------------------------------------------------------------------------

function buildContentPanel(input: {
  opportunities: readonly ContentOpportunityV1[];
  drafts: readonly ContentDraftV1[];
  plan: SocialContentPlanV1 | null;
}): ContentPanelV1 {
  const scripts = new Set(["SHORT_VIDEO_SCRIPT", "REEL_SCRIPT", "TIKTOK_SCRIPT", "YOUTUBE_SHORT_SCRIPT"]);
  const ready = input.drafts.filter((d) => d.freshness === "CURRENT" && !scripts.has(d.format)).length;
  const videos = input.drafts.filter((d) => d.freshness === "CURRENT" && scripts.has(d.format)).length;
  const reverify = input.drafts.filter((d) => d.freshness !== "CURRENT").length;

  const suggestions = (input.plan?.slots ?? []).slice(0, MAX_CONTENT).map((slot) => ({
    subject: slot.subject,
    format: slot.suggestedFormat,
    requiresReview: slot.requiresOwnerReview,
  }));

  return {
    opportunityCount: input.opportunities.length,
    draftsReady: ready,
    videoIdeas: videos,
    needsReverify: reverify,
    suggestions,
    message: input.plan?.noPostRecommended || (!input.opportunities.length && !input.drafts.length)
      ? "No strong grounded content opportunity right now."
      : `${input.opportunities.length} opportunit${input.opportunities.length === 1 ? "y" : "ies"}, ${ready + videos} draft${ready + videos === 1 ? "" : "s"} ready.`,
  };
}

function buildWebsitePanel(input: {
  drafts: readonly ContentDraftV1[];
  vehicleOpportunities: readonly VehicleOpportunityItemV1[];
}): WebsitePanelV1 {
  const websiteDrafts = input.drafts.filter((d) => d.format === "WEBSITE_FEATURED_VEHICLE" || d.format === "WEBSITE_ARTICLE");
  const stale = websiteDrafts.filter((d) => d.freshness !== "CURRENT").length;
  const candidates = input.vehicleOpportunities.filter((v) => v.onWebsite && !v.price.unknown).length;
  return {
    featuredCandidates: candidates,
    staleItems: stale,
    proposedPriceUpdates: 0,
    preparedChanges: websiteDrafts.length,
    status: "PREPARED",
    message: stale
      ? `${stale} website item${stale === 1 ? "" : "s"} need re-checking before they are shown again.`
      : websiteDrafts.length
        ? `${websiteDrafts.length} website draft${websiteDrafts.length === 1 ? "" : "s"} prepared. Nothing is published.`
        : "Nothing prepared for the website yet.",
  };
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

function buildToday(input: {
  customerAttention: readonly CustomerAttentionItemV1[];
  vehicleOpportunities: readonly VehicleOpportunityItemV1[];
  lotWalk: LotWalkPanelV1;
  proposals: readonly CrmActionProposalV1[];
  content: ContentPanelV1;
  website: WebsitePanelV1;
  vehicles: readonly VehicleRecordV1[];
  now: IsoTimestamp;
}): TodaySummaryV1 {
  const day = input.now.slice(0, 10);
  const priceChanges = input.vehicles.filter((v) =>
    (v.priceHistory ?? []).some((entry) => entry.at.slice(0, 10) === day)
    && (v.priceHistory ?? []).length > 1).length;

  const strong = input.vehicleOpportunities.filter((v) => v.interestedCustomers.length > 0).length;
  const prepared = input.proposals.filter((p) => p.status === "PROPOSED").length;

  const headlines: string[] = [];
  if (input.customerAttention.length) {
    const customerCount = input.customerAttention.length;
    // The verb has to agree as well as the noun: "1 customer need attention" is the first thing
    // the Owner reads every morning.
    headlines.push(`${customerCount} customer${customerCount === 1 ? " needs" : "s need"} attention`);
  }
  if (strong) headlines.push(`${strong} strong vehicle match${strong === 1 ? "" : "es"}`);
  if (input.lotWalk.identified) headlines.push(`${input.lotWalk.identified} vehicle${input.lotWalk.identified === 1 ? "" : "s"} photographed today`);
  if (priceChanges) headlines.push(`${priceChanges} price change${priceChanges === 1 ? "" : "s"}`);
  if (prepared) headlines.push(`${prepared} thing${prepared === 1 ? "" : "s"} prepared for review`);
  if (input.content.opportunityCount) headlines.push(`${input.content.opportunityCount} content opportunit${input.content.opportunityCount === 1 ? "y" : "ies"}`);
  if (input.website.staleItems) headlines.push(`${input.website.staleItems} website item${input.website.staleItems === 1 ? "" : "s"} stale`);

  return {
    customerFollowupsThatMatter: input.customerAttention.length,
    strongVehicleMatches: strong,
    vehiclesPhotographedToday: input.lotWalk.identified,
    priceChangesToday: priceChanges,
    preparedCrmActions: prepared,
    contentOpportunities: input.content.opportunityCount,
    staleWebsiteDrafts: input.website.staleItems,
    headlines,
  };
}

// ---------------------------------------------------------------------------
// Can do / must do
// ---------------------------------------------------------------------------

/**
 * The split that makes the interface honest.
 *
 * Something belongs in `ownerMustDo` only when AION genuinely cannot do it — a physical check, an
 * identity only the Owner knows, a consent only the Owner can give. Putting work here that AION
 * could do itself is how an assistant turns into a to-do list.
 */
function buildAionCanDo(input: {
  customerAttention: readonly CustomerAttentionItemV1[];
  lotWalk: LotWalkPanelV1;
  content: ContentPanelV1;
  preparedFollowups: readonly PreparedFollowupItemV1[];
}): ActionItemV1[] {
  const out: ActionItemV1[] = [];
  if (input.customerAttention.some((c) => c.preparedActionCount === 0)) {
    out.push({ label: "Prepare follow-ups", detail: "Draft the call notes and follow-ups from what was said.", target: "followups" });
  }
  if (input.content.opportunityCount) {
    out.push({ label: "Make today's content", detail: `${input.content.opportunityCount} grounded opportunit${input.content.opportunityCount === 1 ? "y" : "ies"} to draft from.`, target: "content" });
  }
  if (input.lotWalk.identified) {
    out.push({ label: "Match today's cars to customers", detail: "Check what you photographed against what customers asked for.", target: "vehicles" });
  }
  if (input.preparedFollowups.length) {
    out.push({ label: "Review what's prepared", detail: `${input.preparedFollowups.length} waiting on you.`, target: "followups" });
  }
  return out;
}

function buildOwnerMustDo(input: {
  customerAttention: readonly CustomerAttentionItemV1[];
  lotWalk: LotWalkPanelV1;
  calls: readonly CallPanelItemV1[];
}): ActionItemV1[] {
  const out: ActionItemV1[] = [];

  for (const customer of input.customerAttention) {
    if (customer.ownerOwes.length) {
      out.push({ label: `Call ${customer.name}`, detail: customer.why, target: `customer:${customer.relationshipRef}` });
    }
  }
  // An unverified feature is a physical check. AION reads listings; it cannot walk out and look.
  const unverified = input.customerAttention.flatMap((c) => c.unknowns);
  if (unverified.length) {
    out.push({
      label: "Verify on the lot",
      detail: `Listings don't state ${[...new Set(unverified.map((u) => u.replace(/ not verified$/, "")))].slice(0, 2).join(" or ")} — worth checking before you promise anything.`,
      target: "vehicles",
    });
  }
  const unresolved = input.calls.filter((c) => c.identityState !== "RESOLVED").length;
  if (unresolved) {
    out.push({
      label: "Identify a call",
      detail: `${unresolved} recorded call${unresolved === 1 ? "" : "s"} I couldn't attach to anyone. Tell me who it was.`,
      target: "calls",
    });
  }
  if (input.lotWalk.unresolvedPhotos) {
    out.push({
      label: "Re-photograph",
      detail: `${input.lotWalk.unresolvedPhotos} photo${input.lotWalk.unresolvedPhotos === 1 ? "" : "s"} I couldn't read a VIN from.`,
      target: "lotwalk",
    });
  }
  return out;
}

/**
 * What is actually connected.
 *
 * A foundation is not an activation. The Owner must be able to see at a glance that drafts exist and
 * publishing does not, because the gap between those two is exactly where a wrong assumption costs
 * something.
 */
function buildCapabilityStatus(input: { gmailReady: boolean; inventoryCount: number }): CapabilityStatusV1[] {
  return [
    { area: "Gmail", state: input.gmailReady ? "READY" : "NOT_CONNECTED", detail: input.gmailReady ? "Connected through the production credential path." : "Not configured." },
    { area: "Inventory", state: "READY", detail: `${input.inventoryCount.toLocaleString("en-US")} vehicles on file.` },
    { area: "Lot Walk", state: "READY", detail: "Photo to VIN to vehicle, on the phone." },
    { area: "Call transcription", state: "READY", detail: "Recorded calls become customer needs and commitments." },
    { area: "Customer matching", state: "READY", detail: "Needs matched against current inventory." },
    { area: "CRM preparation", state: "READY", detail: "Notes and follow-ups are drafted for your review." },
    { area: "Tekion connection", state: "NOT_CONNECTED", detail: "Safety harness ready. No real Tekion connection is configured." },
    { area: "Social drafts", state: "READY", detail: "Posts and scripts are drafted from grounded inventory." },
    { area: "Social publishing", state: "NOT_CONNECTED", detail: "No account is connected. Nothing can be posted." },
    { area: "Website drafts", state: "READY", detail: "Vehicle pages and updates are prepared." },
    { area: "Public website", state: "NOT_DEPLOYED", detail: "No site is deployed and no domain is registered." },
  ];
}

// ---------------------------------------------------------------------------
// Owner-facing rendering
// ---------------------------------------------------------------------------

/** The spoken answer to "what should I do today?" */
export function formatCommandCenterToday(view: SalesCommandCenterV1): string {
  const lines: string[] = ["TODAY", ""];

  if (!view.today.headlines.length) {
    lines.push("Nothing needs you right now. No follow-ups are due, nothing moved on the lot, and there's no content worth making.");
  } else {
    for (const headline of view.today.headlines) lines.push(`· ${headline}`);
  }

  if (view.ownerMustDo.length) {
    lines.push("", "Only you can do:");
    for (const item of view.ownerMustDo.slice(0, 4)) lines.push(`· ${item.label} — ${item.detail}`);
  }
  if (view.aionCanDo.length) {
    lines.push("", "I can do:");
    for (const item of view.aionCanDo.slice(0, 4)) lines.push(`· ${item.label} — ${item.detail}`);
  }
  return lines.join("\n");
}

/** The spoken answer to "who should I call?" */
export function formatCustomerAttention(view: SalesCommandCenterV1): string {
  if (!view.customerAttention.length) {
    return "No customer follow-ups need attention right now.";
  }
  const lines: string[] = [];
  for (const customer of view.customerAttention) {
    lines.push(`${customer.name} — ${customer.why}`);
    if (customer.currentNeedSummary !== "Nothing recorded yet.") lines.push(`  Wants: ${customer.currentNeedSummary}`);
    if (customer.topMatches.length) {
      lines.push(`  On the lot: ${customer.topMatches.map((m) => `${m.label} (${m.price})`).join("; ")}`);
    }
    if (customer.unknowns.length) lines.push(`  Worth checking: ${customer.unknowns.join(", ")}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
