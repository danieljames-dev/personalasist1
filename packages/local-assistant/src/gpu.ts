import type { IsoTimestamp, OpaqueId } from "./contracts.js";

/**
 * Rented GPU capacity.
 *
 * The distinction this whole module exists to hold: **Vast.ai supplies compute; it is not AION's
 * brain.** The chain is deliberately four separate things —
 *
 *   infrastructure provider  ->  GPU session  ->  inference runtime  ->  open-weight model
 *
 * — and AION's model router only ever talks to the last link, through an ordinary endpoint. Swap
 * the provider and the model domain does not change; swap the model and the provider does not
 * care. Nothing Vast-specific belongs in the endpoint contracts in `brain.ts`, and nothing about
 * inference belongs here.
 *
 * The second thing this module holds is that a rented GPU is **an experiment with a deadline**,
 * not an endpoint. Money is spent per second whether or not anyone is looking, so every session
 * carries its own stop conditions and every one of them is checked from stored state rather than
 * from a timer that dies with the process. The failure mode being designed against is not a bug;
 * it is an instance nobody remembered.
 */

/** The hard ceiling for the whole V1.3 milestone, in whole US cents. */
export const V13_BUDGET_CEILING_CENTS = 1600;

export type GpuProviderIdV1 = "vast-ai" | "synthetic";
export const GPU_PROVIDER_IDS: readonly GpuProviderIdV1[] = ["vast-ai", "synthetic"];

/**
 * One rentable machine, normalised away from any provider's own vocabulary.
 *
 * Every field is optional-by-absence rather than invented: a provider that does not report
 * reliability leaves it null instead of receiving a plausible default, because a made-up
 * reliability score is worse than an admitted gap when money depends on it.
 */
export interface GpuOfferV1 {
  /** Stable within a provider. Not globally unique, so it is always paired with the provider. */
  offerRef: string;
  provider: GpuProviderIdV1;
  gpuName: string;
  gpuCount: number;
  vramGb: number;
  /** Whole US cents per hour. Integers, so no floating-point money. */
  hourlyCents: number;
  /** Storage and other known standing charges, in cents per hour. */
  storageCentsPerHour: number;
  diskGb: number | null;
  /** 0-100 where the provider reports one. Null means it did not. */
  reliability: number | null;
  region: string | null;
  netDownMbps: number | null;
  verified: boolean | null;
  retrievedAt: IsoTimestamp;
}

/** What a candidate has to be able to do, before price is considered at all. */
export interface GpuRequirementV1 {
  /** The model AION intends to serve, and what it needs. */
  modelId: string;
  minimumVramGb: number;
  /** Cents per hour the owner is willing to consider. Never exceeds the milestone ceiling. */
  maxHourlyCents: number;
  minimumReliability: number | null;
  runtime: string;
}

/**
 * Open-weight candidates with the VRAM they actually need.
 *
 * Deliberately a small, editable table rather than a lookup against anybody's API: these numbers
 * change, and a stale number that AION presents as fact is exactly the failure the knowledge rules
 * exist to prevent. They are stated as owner-editable planning estimates and labelled as such
 * wherever they are shown. No family is privileged; the list is alphabetical.
 */
export interface ModelProfileV1 {
  id: string;
  family: string;
  /** Approximate VRAM for a commonly used quantisation. A planning estimate, not a guarantee. */
  minimumVramGb: number;
  contextTokens: number;
  note: string;
}

export const OPEN_MODEL_PROFILES: readonly ModelProfileV1[] = [
  { id: "deepseek-r1-distill-8b", family: "DeepSeek", minimumVramGb: 8, contextTokens: 32_768, note: "Distilled reasoning model. Fits a mid-range card; a reasonable first rented experiment." },
  { id: "gpt-oss-20b", family: "gpt-oss", minimumVramGb: 16, contextTokens: 32_768, note: "Mid-size open-weight model. Needs a 16 GB card or better." },
  { id: "mistral-small-24b", family: "Mistral", minimumVramGb: 24, contextTokens: 32_768, note: "Strong general model at 24 GB. A balanced rented experiment." },
  { id: "qwen3-14b", family: "Qwen", minimumVramGb: 12, contextTokens: 32_768, note: "Good instruction following for its size. Often the best value per GB." },
  { id: "qwen3-32b", family: "Qwen", minimumVramGb: 40, contextTokens: 32_768, note: "The largest worth trying inside a small experimental budget, and only briefly." },
];

/** A model small enough to be worth trying on an ordinary laptop, for the local tier. */
export const LOCAL_MODEL_PROFILES: readonly ModelProfileV1[] = [
  { id: "qwen3-4b", family: "Qwen", minimumVramGb: 4, contextTokens: 32_768, note: "Runs on modest hardware, including CPU-only with patience. A sensible first local model." },
  { id: "llama-3.2-3b", family: "Llama", minimumVramGb: 3, contextTokens: 8_192, note: "Very small. Useful for routing and classification rather than reasoning." },
  { id: "mistral-7b", family: "Mistral", minimumVramGb: 6, contextTokens: 32_768, note: "A common baseline local model. Needs about 6 GB quantised." },
  { id: "qwen3-8b", family: "Qwen", minimumVramGb: 8, contextTokens: 32_768, note: "Noticeably better than the 4B at structured output, if the machine can hold it." },
];

function fail(message: string): never { throw new Error(message); }

function cents(value: unknown, label: string, max = 1_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) {
    fail(`${label} must be a whole number of cents between 0 and ${max}.`);
  }
  return value as number;
}
function text(value: unknown, label: string, max: number, required = true): string {
  if (value === undefined || value === null || value === "") { if (required) fail(`${label} is required.`); return ""; }
  if (typeof value !== "string" || value.length > max) fail(`${label} is invalid.`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(`${label} is required.`);
  return trimmed;
}
function optionalNumber(value: unknown, label: string, min: number, max: number): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(`${label} is invalid.`);
  return value;
}

/**
 * Normalises one provider's offer into AION's shape.
 *
 * Anything the provider did not report stays null. This is the seam that keeps Vast.ai out of the
 * rest of the system: a second provider means a second normaliser, and nothing downstream changes.
 */
export function normaliseOffer(raw: Record<string, unknown>, provider: GpuProviderIdV1, retrievedAt: IsoTimestamp): GpuOfferV1 {
  if (!GPU_PROVIDER_IDS.includes(provider)) fail(`GPU provider must be one of: ${GPU_PROVIDER_IDS.join(", ")}.`);
  const gpuCount = Number.isSafeInteger(raw.gpuCount) && (raw.gpuCount as number) > 0 ? raw.gpuCount as number : 1;
  return {
    offerRef: text(raw.offerRef, "Offer reference", 200),
    provider,
    gpuName: text(raw.gpuName, "GPU name", 120),
    gpuCount,
    vramGb: optionalNumber(raw.vramGb, "VRAM", 1, 4096) ?? fail("An offer must state its VRAM; AION will not guess it."),
    hourlyCents: cents(raw.hourlyCents, "Hourly rate"),
    storageCentsPerHour: raw.storageCentsPerHour === undefined ? 0 : cents(raw.storageCentsPerHour, "Storage rate"),
    diskGb: optionalNumber(raw.diskGb, "Disk", 0, 1_000_000),
    reliability: optionalNumber(raw.reliability, "Reliability", 0, 100),
    region: raw.region === undefined || raw.region === null ? null : text(raw.region, "Region", 120, false) || null,
    netDownMbps: optionalNumber(raw.netDownMbps, "Download speed", 0, 1_000_000),
    verified: typeof raw.verified === "boolean" ? raw.verified : null,
    retrievedAt,
  };
}

/** The total standing cost of an offer per hour: compute plus storage. */
export function offerHourlyTotalCents(offer: GpuOfferV1): number {
  return offer.hourlyCents + offer.storageCentsPerHour;
}

export interface OfferAssessmentV1 {
  offer: GpuOfferV1;
  eligible: boolean;
  /** Higher is better. Only meaningful among eligible offers. */
  score: number;
  reasons: string[];
}

/**
 * Judges an offer against what the work actually needs.
 *
 * Capability first, then price. An offer that cannot hold the model is ineligible at any price,
 * because the cheapest machine that cannot run the job costs more than the expensive one that can.
 * Among those that can, cheaper and more reliable wins — deliberately not "biggest GPU", which is
 * how a measurement experiment turns into an expensive afternoon.
 */
export function assessOffer(offer: GpuOfferV1, requirement: GpuRequirementV1): OfferAssessmentV1 {
  const reasons: string[] = [];
  let eligible = true;
  const usableVram = offer.vramGb * offer.gpuCount;
  if (usableVram < requirement.minimumVramGb) {
    eligible = false;
    reasons.push(`${usableVram} GB of VRAM cannot hold ${requirement.modelId}, which needs about ${requirement.minimumVramGb} GB`);
  }
  const hourly = offerHourlyTotalCents(offer);
  if (hourly > requirement.maxHourlyCents) {
    eligible = false;
    reasons.push(`${hourly} cents/hour is above the ${requirement.maxHourlyCents} cents/hour limit`);
  }
  if (requirement.minimumReliability !== null && offer.reliability !== null && offer.reliability < requirement.minimumReliability) {
    eligible = false;
    reasons.push(`reliability ${offer.reliability} is below the required ${requirement.minimumReliability}`);
  }
  if (offer.reliability === null) reasons.push("the provider reported no reliability score, so this is unproven rather than good");

  // Value per hour, with headroom worth a little and unverified hosts worth less.
  const headroom = Math.min(2, usableVram / Math.max(1, requirement.minimumVramGb));
  const reliabilityFactor = (offer.reliability ?? 50) / 100;
  const verifiedFactor = offer.verified === false ? 0.8 : 1;
  const score = eligible ? Math.round((headroom * reliabilityFactor * verifiedFactor * 10_000) / Math.max(1, hourly)) : 0;
  if (eligible) reasons.push(`fits ${requirement.modelId} with ${usableVram} GB at ${hourly} cents/hour`);
  return { offer, eligible, score, reasons };
}

export interface ExperimentRecommendationV1 {
  tier: "economical" | "balanced" | "maximum-useful";
  offer: GpuOfferV1;
  modelId: string;
  runtime: string;
  /** How long the experiment should run, chosen so the spend stays well inside the ceiling. */
  suggestedMinutes: number;
  estimatedCents: number;
  why: string;
}

/**
 * Three candidate experiments rather than one "best" answer.
 *
 * The point of the first rented session is measurement, so the recommendations are framed by what
 * the owner learns per dollar, not by what the biggest card would feel like. The maximum tier is
 * still bounded by the milestone ceiling, and every tier states its arithmetic.
 */
export function recommendExperiments(
  assessments: readonly OfferAssessmentV1[],
  requirement: GpuRequirementV1,
  ceilingCents: number = V13_BUDGET_CEILING_CENTS,
): ExperimentRecommendationV1[] {
  const eligible = assessments.filter((entry) => entry.eligible).map((entry) => entry.offer);
  if (!eligible.length) return [];
  const byPrice = [...eligible].sort((a, b) => offerHourlyTotalCents(a) - offerHourlyTotalCents(b) || a.offerRef.localeCompare(b.offerRef));
  const byValue = [...assessments].filter((entry) => entry.eligible).sort((a, b) => b.score - a.score || a.offer.offerRef.localeCompare(b.offer.offerRef)).map((entry) => entry.offer);
  const byCapability = [...eligible].sort((a, b) => (b.vramGb * b.gpuCount) - (a.vramGb * a.gpuCount) || offerHourlyTotalCents(a) - offerHourlyTotalCents(b));

  const build = (tier: ExperimentRecommendationV1["tier"], offer: GpuOfferV1, minutes: number, why: string): ExperimentRecommendationV1 => {
    const hourly = offerHourlyTotalCents(offer);
    // Never propose a run that could touch the ceiling: cap the duration so the arithmetic fits
    // with room to spare, and round down so a rounding error cannot push it over.
    const affordableMinutes = Math.floor((ceilingCents * 0.5) / Math.max(1, hourly) * 60);
    const suggestedMinutes = Math.max(15, Math.min(minutes, affordableMinutes));
    const estimatedCents = Math.ceil((hourly * suggestedMinutes) / 60);
    return {
      tier, offer, modelId: requirement.modelId, runtime: requirement.runtime, suggestedMinutes, estimatedCents,
      why: `${why} ${offer.gpuName} x${offer.gpuCount}, ${offer.vramGb * offer.gpuCount} GB, ${hourly} cents/hour including storage. ${suggestedMinutes} minutes costs about ${estimatedCents} cents, which is ${Math.round((estimatedCents / ceilingCents) * 100)}% of the ${ceilingCents}-cent ceiling.`,
    };
  };

  const tiers: ExperimentRecommendationV1[] = [
    build("economical", byPrice[0]!, 30, "Cheapest machine that can hold the model. Enough to measure quality and latency, and little else."),
    build("balanced", byValue[0]!, 45, "Best capability per cent among eligible offers."),
    build("maximum-useful", byCapability[0]!, 60, "Most capable machine still inside the ceiling. Worth it only if the smaller tiers leave a question unanswered."),
  ];
  // Deduplicate by offer, keeping the cheapest framing, so three identical rows are not presented
  // as three choices.
  const seen = new Set<string>();
  return tiers.filter((entry) => { const key = `${entry.offer.provider}:${entry.offer.offerRef}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export type GpuSessionStateV1 =
  | "proposed" | "approved" | "starting" | "running" | "stopping" | "stopped" | "failed" | "withdrawn";

/** One recorded fact about a session's life. Append-only; this is the audit trail for money. */
export interface GpuSessionEventV1 {
  at: IsoTimestamp;
  event: "proposed" | "approved" | "started" | "health" | "activity" | "stop-requested" | "stopped" | "teardown-confirmed" | "failed" | "withdrawn";
  detail: string;
}

/**
 * A bounded provisioning proposal.
 *
 * Every field the owner needs in order to say yes to *this* and not to something else. The digest
 * covers the money-bearing fields, so an approval cannot be carried over to a different offer, a
 * different price, or a longer run — the same one-shot-approval discipline the capability registry
 * already uses, applied to spending.
 */
export interface GpuProvisioningProposalV1 {
  id: OpaqueId;
  provider: GpuProviderIdV1;
  offerRef: string;
  gpuName: string;
  vramGb: number;
  quotedHourlyCents: number;
  quotedStorageCentsPerHour: number;
  modelId: string;
  runtime: string;
  maxRuntimeMinutes: number;
  maxSpendCents: number;
  idleTimeoutMinutes: number;
  /** What AION will do when any limit is reached. Stated, not assumed. */
  shutdownPolicy: string;
  /** SHA-256 over the money-bearing fields, supplied by the caller's digest function. */
  digest: string;
  proposedAt: IsoTimestamp;
  state: "pending" | "approved" | "denied" | "invalidated" | "consumed";
  decidedAt: IsoTimestamp | null;
  invalidationReason: string | null;
}

export interface GpuSessionV1 {
  id: OpaqueId;
  provider: GpuProviderIdV1;
  proposalId: OpaqueId;
  /** The provider's own handle for the running machine. Null until it starts. */
  instanceRef: string | null;
  state: GpuSessionStateV1;
  gpuName: string;
  vramGb: number;
  modelId: string;
  runtime: string;
  /** The endpoint AION will route to once the runtime is serving. Null until it exists. */
  endpointId: string | null;
  hourlyCents: number;
  maxRuntimeMinutes: number;
  maxSpendCents: number;
  idleTimeoutMinutes: number;
  /** The absolute moment this session must be gone by, computed at approval, stored, not a timer. */
  hardStopAt: IsoTimestamp;
  startedAt: IsoTimestamp | null;
  stoppedAt: IsoTimestamp | null;
  lastActivityAt: IsoTimestamp | null;
  measuredMinutes: number;
  estimatedCents: number;
  teardownConfirmed: boolean;
  events: GpuSessionEventV1[];
}

/**
 * Builds a proposal, refusing anything the milestone ceiling forbids.
 *
 * The ceiling is checked here rather than at approval time because a proposal the owner cannot
 * legally approve should never be shown to them in the first place.
 */
export function buildProvisioningProposal(
  input: {
    offer: GpuOfferV1; modelId: string; runtime: string;
    maxRuntimeMinutes: number; maxSpendCents: number; idleTimeoutMinutes: number;
  },
  context: { id: OpaqueId; now: IsoTimestamp; digest: (value: unknown) => string; ceilingCents?: number },
): GpuProvisioningProposalV1 {
  const ceiling = context.ceilingCents ?? V13_BUDGET_CEILING_CENTS;
  const { offer } = input;
  const maxRuntimeMinutes = Number.isSafeInteger(input.maxRuntimeMinutes) && input.maxRuntimeMinutes > 0 && input.maxRuntimeMinutes <= 24 * 60
    ? input.maxRuntimeMinutes
    : fail("A rented session needs a maximum runtime between 1 minute and 24 hours.");
  const idleTimeoutMinutes = Number.isSafeInteger(input.idleTimeoutMinutes) && input.idleTimeoutMinutes > 0 && input.idleTimeoutMinutes <= maxRuntimeMinutes
    ? input.idleTimeoutMinutes
    : fail("An idle timeout is required, and cannot be longer than the maximum runtime.");
  // Shape first, then the ceiling, so asking for too much reads as "above the ceiling" rather
  // than as a malformed number. They are different mistakes with different answers.
  const maxSpendCents = cents(input.maxSpendCents, "Maximum spend");
  if (maxSpendCents > ceiling) fail(`This milestone's ceiling is ${ceiling} cents and this proposal asks for ${maxSpendCents}. AION will not present it.`);

  const hourly = offerHourlyTotalCents(offer);
  const worstCaseCents = Math.ceil((hourly * maxRuntimeMinutes) / 60);
  if (worstCaseCents > maxSpendCents) {
    fail(`Running ${maxRuntimeMinutes} minutes at ${hourly} cents/hour could cost ${worstCaseCents} cents, above the ${maxSpendCents}-cent limit. Shorten the run or raise the limit — AION will not present a proposal whose own arithmetic exceeds it.`);
  }

  const money = {
    provider: offer.provider, offerRef: offer.offerRef, hourlyCents: offer.hourlyCents,
    storageCentsPerHour: offer.storageCentsPerHour, modelId: input.modelId, runtime: input.runtime,
    maxRuntimeMinutes, maxSpendCents, idleTimeoutMinutes,
  };
  return {
    id: context.id,
    provider: offer.provider,
    offerRef: offer.offerRef,
    gpuName: offer.gpuName,
    vramGb: offer.vramGb * offer.gpuCount,
    quotedHourlyCents: offer.hourlyCents,
    quotedStorageCentsPerHour: offer.storageCentsPerHour,
    modelId: text(input.modelId, "Model", 200),
    runtime: text(input.runtime, "Runtime", 100),
    maxRuntimeMinutes,
    maxSpendCents,
    idleTimeoutMinutes,
    shutdownPolicy: `AION stops this instance when any of these is first true: ${idleTimeoutMinutes} minutes with no inference, ${maxRuntimeMinutes} minutes total runtime, an estimated ${maxSpendCents} cents spent, a failed health check, or you press stop. The deadline is stored, so it survives AION being closed or crashing.`,
    digest: context.digest(money),
    proposedAt: context.now,
    state: "pending",
    decidedAt: null,
    invalidationReason: null,
  };
}

/** The owner-readable disclosure. Assembled from the stored fields so it cannot drift from them. */
export function describeProposal(proposal: GpuProvisioningProposalV1): string {
  const hourly = proposal.quotedHourlyCents + proposal.quotedStorageCentsPerHour;
  return [
    `Rent ${proposal.gpuName} (${proposal.vramGb} GB) from ${proposal.provider} to serve ${proposal.modelId} on ${proposal.runtime}.`,
    `Quoted ${proposal.quotedHourlyCents} cents/hour compute${proposal.quotedStorageCentsPerHour ? ` plus ${proposal.quotedStorageCentsPerHour} cents/hour storage` : ""}, so ${hourly} cents/hour in total.`,
    `You are authorising at most ${proposal.maxRuntimeMinutes} minutes and at most ${proposal.maxSpendCents} cents. AION cannot raise either.`,
    proposal.shutdownPolicy,
    "This is an experiment to measure whether a rented model is worth it, not a permanent endpoint.",
  ].join(" ");
}

/**
 * Re-checks a pending proposal against the current market.
 *
 * A price that has moved invalidates the approval rather than silently costing more. This is the
 * one place where "it was true when we asked" is not good enough, because the owner approved a
 * number and the number is what they consented to.
 */
export function revalidateProposal(
  proposal: GpuProvisioningProposalV1,
  currentOffer: GpuOfferV1 | null,
  now: IsoTimestamp,
): GpuProvisioningProposalV1 {
  const invalidate = (reason: string): GpuProvisioningProposalV1 => ({ ...structuredClone(proposal), state: "invalidated", decidedAt: now, invalidationReason: reason });
  if (proposal.state !== "pending" && proposal.state !== "approved") return structuredClone(proposal);
  if (!currentOffer) return invalidate("That offer is no longer available from the provider.");
  if (currentOffer.offerRef !== proposal.offerRef) return invalidate("The offer reference changed.");
  const quoted = proposal.quotedHourlyCents + proposal.quotedStorageCentsPerHour;
  const current = offerHourlyTotalCents(currentOffer);
  if (current > quoted) {
    const worstCase = Math.ceil((current * proposal.maxRuntimeMinutes) / 60);
    if (worstCase > proposal.maxSpendCents) {
      return invalidate(`The price rose from ${quoted} to ${current} cents/hour, which would cost up to ${worstCase} cents against your ${proposal.maxSpendCents}-cent limit. Approve a new proposal if you still want it.`);
    }
  }
  return structuredClone(proposal);
}

export interface ShutdownDecisionV1 {
  stop: boolean;
  reason: string;
  /** Which limit fired, so the evidence names a rule rather than a feeling. */
  trigger: "idle" | "max-runtime" | "max-spend" | "hard-stop" | "health" | "owner" | "none";
}

/** Minutes a session has been running, from stored timestamps rather than a live counter. */
export function runtimeMinutes(session: GpuSessionV1, now: IsoTimestamp): number {
  if (!session.startedAt) return 0;
  const end = session.stoppedAt ? Date.parse(session.stoppedAt) : Date.parse(now);
  return Math.max(0, Math.floor((end - Date.parse(session.startedAt)) / 60_000));
}

export function estimatedCents(session: GpuSessionV1, now: IsoTimestamp): number {
  return Math.ceil((session.hourlyCents * runtimeMinutes(session, now)) / 60);
}

/**
 * Whether this session must stop, decided entirely from persisted state.
 *
 * Nothing here consults a timer, an interval, or anything else that dies with the process. That is
 * the point: AION crashing must not be the reason a GPU ran all night. Whatever restarts next
 * reads the same stored deadline and reaches the same conclusion.
 */
export function shutdownDecision(session: GpuSessionV1, now: IsoTimestamp, healthy = true): ShutdownDecisionV1 {
  if (session.state === "stopped" || session.state === "failed" || session.state === "withdrawn") {
    return { stop: false, reason: "This session is already finished.", trigger: "none" };
  }
  if (!session.startedAt) return { stop: false, reason: "This session has not started.", trigger: "none" };

  const at = Date.parse(now);
  if (at >= Date.parse(session.hardStopAt)) {
    return { stop: true, reason: `The stored hard-stop deadline of ${session.hardStopAt} has passed. AION stops the instance regardless of anything else.`, trigger: "hard-stop" };
  }
  const minutes = runtimeMinutes(session, now);
  if (minutes >= session.maxRuntimeMinutes) {
    return { stop: true, reason: `It has run ${minutes} minutes against an authorised maximum of ${session.maxRuntimeMinutes}.`, trigger: "max-runtime" };
  }
  const spent = estimatedCents(session, now);
  if (spent >= session.maxSpendCents) {
    return { stop: true, reason: `Estimated spend is ${spent} cents against an authorised maximum of ${session.maxSpendCents}.`, trigger: "max-spend" };
  }
  if (!healthy) {
    return { stop: true, reason: "The endpoint failed its health check. A machine that is not serving is only costing money.", trigger: "health" };
  }
  const idleSince = session.lastActivityAt ?? session.startedAt;
  const idleMinutes = Math.floor((at - Date.parse(idleSince)) / 60_000);
  if (idleMinutes >= session.idleTimeoutMinutes) {
    return { stop: true, reason: `Nothing has used it for ${idleMinutes} minutes against an idle timeout of ${session.idleTimeoutMinutes}.`, trigger: "idle" };
  }
  return { stop: false, reason: `Running ${minutes} minutes, about ${spent} cents so far, idle ${idleMinutes} minutes.`, trigger: "none" };
}

/** An honest line about a session, including the uncomfortable case. */
export function sessionStanding(session: GpuSessionV1, now: IsoTimestamp): string {
  if (session.state === "stopped") {
    return `Stopped after ${session.measuredMinutes} minute(s), about ${session.estimatedCents} cents. Teardown ${session.teardownConfirmed ? "confirmed" : "NOT CONFIRMED — check the provider console yourself"}.`;
  }
  if (session.state === "running") {
    const decision = shutdownDecision(session, now);
    return `Running on ${session.gpuName}: ${decision.reason} Hard stop at ${session.hardStopAt}.`;
  }
  return `Session is ${session.state}.`;
}

/**
 * The infrastructure port.
 *
 * Four operations, none of which knows anything about inference. `start` exists but is never
 * reached without an approved, revalidated proposal — the guard is in the service, because only it
 * can see the approval.
 */
export interface GpuInfrastructurePortV1 {
  readonly provider: GpuProviderIdV1;
  /**
   * Whether a credential is configured, by *name only*.
   *
   * AION never searches for a credential and never reads one into anything it stores. This reports
   * that a named environment variable is present and non-empty, and nothing else about it.
   */
  credentialStatus(): Promise<{ configured: boolean; variableName: string; detail: string }>;
  discover(filter: { minimumVramGb: number; maxHourlyCents: number; minimumReliability: number | null; limit: number }, signal: AbortSignal): Promise<GpuOfferV1[]>;
  start(request: { offerRef: string; modelId: string; runtime: string }, signal: AbortSignal): Promise<{ instanceRef: string; detail: string }>;
  stop(instanceRef: string, signal: AbortSignal): Promise<{ stopped: boolean; detail: string }>;
  status(instanceRef: string, signal: AbortSignal): Promise<{ state: GpuSessionStateV1; detail: string; endpointUrl: string | null }>;
}

/**
 * Redacts anything credential-shaped from provider text before it can be stored or displayed.
 *
 * Belt and braces: nothing is supposed to put a key in a message, but provider errors do
 * surprising things and a leaked key in Activity would be permanent.
 */
export function redactCredentials(value: unknown): string {
  return String(value ?? "")
    .replace(/\b(?:sk|pk|key|token|bearer|apikey|api_key)[-_a-z0-9]{8,}/giu, "[redacted]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/gu, "[redacted]")
    .replace(/(["']?(?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*)["']?[^\s"',}]{6,}/giu, "$1[redacted]")
    .slice(0, 2000);
}
