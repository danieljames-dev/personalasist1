import type { IsoTimestamp, OpaqueId } from "./contracts.js";

/**
 * AION's brain.
 *
 * The foundational rule of this milestone: AION owns durable intelligence and a language model is
 * a replaceable reasoning provider. Memory, Tasks, Routines, Plans, relationships, workspaces,
 * brands, opportunities, research evidence, learned strategies, permissions, approvals and
 * Activity all belong to AION. Removing every model must leave every one of them intact and must
 * leave AION usable.
 *
 * So this module models *endpoints*, not vendors. An endpoint is somewhere inference happens: a
 * runtime on this computer, a runtime on a machine or rented GPU the owner controls, or a
 * third-party service. Which open-weight family runs behind an owner-controlled endpoint is
 * configuration; it is deliberately not architecture, because the model that is best today is not
 * the model that will be best next year.
 *
 * Three rules are enforced here rather than left to the caller:
 *
 *   1. **No silent switch.** AION never moves from an owner-controlled endpoint to a third-party
 *      one on its own initiative. Remote proprietary fallback is off by default, and even with it
 *      on the switch surfaces as a proposal the owner approves.
 *   2. **Capability preference is not consent.** Maximum Capability may prefer the strongest
 *      endpoint, but it still discloses what would leave the machine before anything does.
 *   3. **Offline means offline.** In offline mode only this computer runs inference. Not the
 *      owner's other machine, not their rented GPU, nothing with a network path.
 *
 * There is no network code in this file. Reaching an endpoint is an adapter's job; deciding
 * whether AION is allowed to is this file's job, and keeping those separate is what makes the
 * decision testable without a socket.
 */

/** The kind of inference server, not the model. Adding a runtime never changes the policy above. */
export type BrainRuntimeV1 =
  | "deterministic-offline"
  | "ollama"
  | "llama-cpp"
  | "vllm"
  | "openai-compatible";
export const BRAIN_RUNTIMES: readonly BrainRuntimeV1[] = ["deterministic-offline", "ollama", "llama-cpp", "vllm", "openai-compatible"];

/**
 * Where inference physically happens, which is the only distinction privacy actually cares about.
 *
 * `owner-controlled-host` covers a second machine at home and a rented GPU equally: renting
 * capacity the owner controls is still owner control. What matters is that no single vendor can
 * end AION's reasoning capability, not whether the hardware has the owner's name on the invoice.
 */
export type BrainLocationV1 = "local-machine" | "owner-controlled-host" | "third-party-service";
export const BRAIN_LOCATIONS: readonly BrainLocationV1[] = ["local-machine", "owner-controlled-host", "third-party-service"];

export type CostClassV1 = "free-local" | "owner-metered" | "paid-per-token";
export const COST_CLASSES: readonly CostClassV1[] = ["free-local", "owner-metered", "paid-per-token"];

/**
 * What one configured endpoint can actually do, tracked per endpoint rather than assumed uniform.
 * These are claims about a configuration until the evaluation harness measures them; nothing here
 * is taken from a vendor's marketing.
 */
export interface ModelCapabilityProfileV1 {
  conversation: boolean;
  reasoning: boolean;
  code: boolean;
  structuredJson: boolean;
  toolProposal: boolean;
  vision: boolean;
  embeddings: boolean;
  contextTokens: number;
  costClass: CostClassV1;
}

export const CAPABILITY_FLAGS = ["conversation", "reasoning", "code", "structuredJson", "toolProposal", "vision", "embeddings"] as const;
export type CapabilityFlagV1 = (typeof CAPABILITY_FLAGS)[number];

export interface BrainHealthV1 {
  available: boolean;
  detail: string;
  checkedAt: IsoTimestamp;
  latencyMs: number | null;
  /** Models the endpoint reported. Empty when it reported none or was never asked. */
  installedModels: string[];
}

/**
 * What makes an endpoint temporary.
 *
 * A rented GPU is not a configured endpoint that happens to cost money; it is a machine with a
 * deadline that AION borrowed an address from. Recording that here — rather than inferring it from
 * a label or a URL — is what lets the router, the disclosure, and the UI all say "this one is
 * rented and stops at a stated time" from the same fact.
 *
 * There is no credential in this record. The rented runtime's credential, if it has one, lives in
 * the endpoint's `credentialEnvironmentVariable` by *name*, exactly like every other endpoint.
 */
export interface RentedGpuRentalV1 {
  /** The GPU session this endpoint belongs to. Removing the session removes the endpoint. */
  gpuSessionId: string;
  /** Which infrastructure supplied the machine. Replaceable; nothing depends on which. */
  infrastructureProvider: string;
  /** The provider's own handle for the machine, for the owner to check against their console. */
  instanceRef: string;
  gpuName: string;
  hourlyCents: number;
  /** The stored moment this endpoint must be gone by. The same deadline the session enforces. */
  hardStopAt: IsoTimestamp;
}

export interface BrainEndpointV1 {
  id: OpaqueId;
  label: string;
  runtime: BrainRuntimeV1;
  location: BrainLocationV1;
  /** Empty for the built-in offline provider, which has no address at all. */
  baseUrl: string;
  model: string;
  /** Owner's own note about where this runs. Never inferred and never sent anywhere. */
  hostLabel: string;
  /**
   * The *name* of an environment variable holding a credential, never the value. AION stores no
   * secret for an endpoint, so a copy of the state file grants access to nothing.
   */
  credentialEnvironmentVariable: string;
  capabilities: ModelCapabilityProfileV1;
  enabled: boolean;
  addedAt: IsoTimestamp;
  lastHealth: BrainHealthV1 | null;
  /** Set only for a temporary endpoint backed by a rented GPU session. Null for everything else. */
  rental: RentedGpuRentalV1 | null;
}

/** True when this endpoint exists only for as long as a rented machine does. */
export function isRentedGpuEndpoint(endpoint: BrainEndpointV1): boolean { return endpoint.rental !== null; }

export type RouterModeV1 ="local-only" | "local-preferred" | "manual" | "maximum-capability";
export const ROUTER_MODES: readonly RouterModeV1[] = ["local-only", "local-preferred", "manual", "maximum-capability"];

export interface BrainSettingsV1 {
  mode: RouterModeV1;
  /** The endpoint AION uses by default. Empty means the built-in offline provider. */
  primaryEndpointId: string;
  /** In MANUAL mode, the endpoint the owner named for this piece of work. */
  manualEndpointId: string;
  /**
   * True offline. No inference leaves this computer — not to the owner's other machine, not to
   * their rented GPU. Overrides every other setting here, including Maximum Capability.
   */
  offlineMode: boolean;
  /**
   * Whether AION may propose a third-party endpoint on its own initiative. Off by default: the
   * whole point of the milestone is that AION does not need one.
   */
  remoteFallbackEnabled: boolean;
  endpoints: BrainEndpointV1[];
}

/** The built-in offline provider, present whether or not the owner has configured anything. */
export const OFFLINE_ENDPOINT_ID = "deterministic-offline";

export function defaultBrainSettings(now: IsoTimestamp): BrainSettingsV1 {
  return {
    mode: "local-preferred",
    primaryEndpointId: OFFLINE_ENDPOINT_ID,
    manualEndpointId: "",
    offlineMode: false,
    remoteFallbackEnabled: false,
    endpoints: [offlineEndpoint(now)],
  };
}

/**
 * AION's floor.
 *
 * This endpoint has no address, needs no credential, and cannot be removed. It is what makes the
 * acceptance criterion true: with every third-party credential deleted and no model downloaded,
 * AION still starts, still holds everything it knows, and still answers — modestly, deterministically,
 * and without pretending to be more than it is.
 */
export function offlineEndpoint(now: IsoTimestamp): BrainEndpointV1 {
  return {
    id: OFFLINE_ENDPOINT_ID,
    label: "AION offline provider",
    runtime: "deterministic-offline",
    location: "local-machine",
    baseUrl: "",
    model: "aion-offline-v1",
    hostLabel: "this computer",
    credentialEnvironmentVariable: "",
    capabilities: {
      conversation: true, reasoning: false, code: false, structuredJson: false,
      toolProposal: true, vision: false, embeddings: false,
      contextTokens: 8_192, costClass: "free-local",
    },
    enabled: true,
    addedAt: now,
    lastHealth: { available: true, detail: "Always available. It performs no network request and needs no model file.", checkedAt: now, latencyMs: 0, installedModels: [] },
    rental: null,
  };
}

function fail(message: string): never { throw new Error(message); }

function text(value: unknown, label: string, max: number, required = true): string {
  if (value === undefined || value === null || value === "") { if (required) fail(`${label} is required.`); return ""; }
  if (typeof value !== "string" || value.length > max) fail(`${label} is invalid.`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(`${label} is required.`);
  return trimmed;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string, fallback?: T): T {
  if (value === undefined || value === null || value === "") { if (fallback !== undefined) return fallback; fail(`${label} is required.`); }
  if (typeof value !== "string" || !allowed.includes(value as T)) fail(`${label} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

/**
 * The endpoint address AION will accept.
 *
 * A local runtime is on loopback; an owner-controlled host is somewhere the owner named. Both are
 * checked as *shapes* rather than trusted: a "local" endpoint pointed at someone else's server
 * would make the whole location label a lie, so the mismatch is refused rather than corrected.
 */
export function validateEndpointUrl(candidate: string, location: BrainLocationV1): string {
  const raw = text(candidate, "Endpoint address", 2048);
  let url: URL;
  try { url = new URL(raw); } catch { fail("An endpoint address must be an absolute URL, for example http://127.0.0.1:11434."); }
  if (url.protocol !== "http:" && url.protocol !== "https:") fail("An endpoint address must be http or https.");
  if (url.username || url.password) fail("Put a credential in an environment variable, never in the endpoint address. AION stores the variable name only.");
  const host = url.hostname.toLowerCase();
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  if (location === "local-machine" && !loopback) {
    fail(`A local endpoint must be on this computer, but ${host} is not loopback. Record it as an owner-controlled host instead, so AION describes honestly where your context goes.`);
  }
  if (location === "third-party-service" && loopback) {
    fail("A third-party endpoint cannot be loopback. Record a loopback runtime as a local endpoint.");
  }
  if (location !== "local-machine" && url.protocol === "http:" && !loopback) {
    // Not refused: an owner's tailnet is a perfectly reasonable place for plain HTTP. It is worth
    // saying out loud, though, and the disclosure below repeats it every time the endpoint is used.
    return `${url.toString()}`;
  }
  return url.toString();
}

export function buildCapabilityProfile(input: Record<string, unknown> = {}): ModelCapabilityProfileV1 {
  const flag = (key: CapabilityFlagV1, fallback: boolean): boolean => (input[key] === undefined ? fallback : input[key] === true);
  const contextTokens = input.contextTokens === undefined ? 8_192 : input.contextTokens;
  if (!Number.isSafeInteger(contextTokens) || (contextTokens as number) < 512 || (contextTokens as number) > 10_000_000) {
    fail("Context length must be a whole number of tokens between 512 and 10000000.");
  }
  return {
    conversation: flag("conversation", true),
    reasoning: flag("reasoning", false),
    code: flag("code", false),
    structuredJson: flag("structuredJson", false),
    toolProposal: flag("toolProposal", false),
    vision: flag("vision", false),
    embeddings: flag("embeddings", false),
    contextTokens: contextTokens as number,
    costClass: oneOf(input.costClass, COST_CLASSES, "Cost class", "free-local"),
  };
}

export function buildEndpoint(input: Record<string, unknown>, context: { id: OpaqueId; now: IsoTimestamp; existing: readonly BrainEndpointV1[] }): BrainEndpointV1 {
  const location = oneOf(input.location, BRAIN_LOCATIONS, "Endpoint location");
  const runtime = oneOf(input.runtime, BRAIN_RUNTIMES, "Endpoint runtime");
  if (runtime === "deterministic-offline") fail("The offline provider is built in and cannot be added again.");
  const label = text(input.label, "Endpoint name", 80);
  if (context.existing.some((entry) => entry.label.toLocaleLowerCase() === label.toLocaleLowerCase())) fail(`An endpoint named "${label}" already exists.`);
  if (context.existing.length >= 20) fail("AION holds at most 20 configured endpoints.");
  const credential = text(input.credentialEnvironmentVariable, "Credential environment-variable name", 128, false);
  if (credential && !/^[A-Z][A-Z0-9_]{0,127}$/u.test(credential)) fail("A credential environment-variable name must be upper-case letters, digits, and underscores.");
  return {
    id: context.id,
    label,
    runtime,
    location,
    baseUrl: validateEndpointUrl(String(input.baseUrl ?? ""), location),
    model: text(input.model, "Model identifier", 200),
    hostLabel: text(input.hostLabel, "Host label", 120, false),
    credentialEnvironmentVariable: credential,
    capabilities: buildCapabilityProfile((input.capabilities ?? {}) as Record<string, unknown>),
    enabled: input.enabled !== false,
    addedAt: context.now,
    lastHealth: null,
    // Only the rented-GPU bridge creates a temporary endpoint, and it uses its own builder. An
    // owner-configured endpoint is never a rental, so this cannot be set from input.
    rental: null,
  };
}

/**
 * The temporary endpoint a ready rented session becomes.
 *
 * Built here rather than in the GPU module on purpose: this is a Brain endpoint that happens to be
 * backed by rented hardware, not a GPU concept that happens to be routable. Nothing Vast-specific
 * reaches this function — it takes a validated address, a model, a runtime, and the rental facts,
 * and would build the same endpoint for any infrastructure.
 *
 * The location is `owner-controlled-host`, which is the honest classification: the owner is paying
 * for the machine and chose it, and it is still not this computer. The disclosure says both.
 */
export function rentedGpuEndpoint(
  input: {
    baseUrl: string;
    model: string;
    runtime: BrainRuntimeV1;
    rental: RentedGpuRentalV1;
    contextTokens?: number;
    credentialEnvironmentVariable?: string;
    health?: BrainHealthV1;
  },
  context: { id: OpaqueId; now: IsoTimestamp },
): BrainEndpointV1 {
  if (input.runtime === "deterministic-offline") fail("The offline provider is built in and is not something you can rent.");
  const credential = text(input.credentialEnvironmentVariable, "Credential environment-variable name", 128, false);
  if (credential && !/^[A-Z][A-Z0-9_]{0,127}$/u.test(credential)) fail("A credential environment-variable name must be upper-case letters, digits, and underscores.");
  const model = text(input.model, "Model identifier", 200);
  return {
    id: context.id,
    // Named for what it is and when it dies, so a stale one in a list is obvious at a glance.
    label: `Rented ${input.rental.gpuName} (${model})`,
    runtime: input.runtime,
    location: "owner-controlled-host",
    baseUrl: validateEndpointUrl(input.baseUrl, "owner-controlled-host"),
    model,
    hostLabel: `a ${input.rental.gpuName} you are renting from ${input.rental.infrastructureProvider}, until ${input.rental.hardStopAt}`,
    credentialEnvironmentVariable: credential,
    capabilities: buildCapabilityProfile({
      conversation: true, reasoning: true, code: true, structuredJson: true, toolProposal: true,
      vision: false, embeddings: false,
      contextTokens: input.contextTokens ?? 32_768,
      // The owner pays by the hour for the machine, not per token to a vendor. That is a different
      // kind of cost and the router's cost intelligence treats it as one.
      costClass: "owner-metered",
    }),
    enabled: true,
    addedAt: context.now,
    lastHealth: input.health ? structuredClone(input.health) : null,
    rental: structuredClone(input.rental),
  };
}

/** True when inference at this endpoint stays inside infrastructure the owner controls. */
export function isOwnerControlled(endpoint: BrainEndpointV1): boolean {
  return endpoint.location === "local-machine" || endpoint.location === "owner-controlled-host";
}

/**
 * How capable an endpoint is, as a number, so "strongest" means something specific.
 *
 * Context length is worth a lot because it is the capability most likely to make the difference
 * between a usable answer and a truncated one, and it is the one that is objectively measurable
 * without trusting anybody. Cost is not part of the score: preferring the cheapest is a different
 * policy, and conflating the two would hide which one the owner actually chose.
 */
export function capabilityScore(endpoint: BrainEndpointV1): number {
  const { capabilities: c } = endpoint;
  const flags = [c.reasoning, c.code, c.structuredJson, c.toolProposal, c.vision, c.embeddings].filter(Boolean).length;
  const contextPoints = Math.min(10, Math.floor(Math.log2(Math.max(1, c.contextTokens / 4096)) + 1));
  return flags * 2 + Math.max(0, contextPoints);
}

export interface ContextDisclosureV1 {
  endpointId: string;
  endpointLabel: string;
  runtime: BrainRuntimeV1;
  location: BrainLocationV1;
  ownerControlled: boolean;
  /** Redacted host, so the disclosure names where context goes without quoting a full URL. */
  destination: string;
  workspace: string;
  workspaceLabel: string;
  contextClasses: string[];
  includesMemory: boolean;
  includesWorkOrCustomerInformation: boolean;
  encrypted: boolean;
  /** The sentence shown to the owner. Written to be read, not skimmed past. */
  statement: string;
}

export interface RoutingRequestV1 {
  workspace: string;
  workspaceLabel: string;
  /** Capabilities the work genuinely needs. An endpoint lacking one of these is not a candidate. */
  needs: readonly CapabilityFlagV1[];
  minimumContextTokens?: number;
  includesMemory: boolean;
  includesWorkOrCustomerInformation: boolean;
  /** What kinds of thing are in the prompt, in the owner's words. Shown verbatim in the disclosure. */
  contextClasses: readonly string[];
}

/**
 * Which tier an endpoint belongs to, in the owner's terms rather than the implementation's.
 *
 * Local Preferred means "the floor and the local model first, a machine you rent when the work
 * genuinely needs it, and a vendor only if you say so" — and that sentence needs a word for each
 * of the four things it distinguishes.
 */
export type BrainTierV1 = "deterministic-floor" | "local-model" | "owner-gpu" | "third-party";

export function endpointTier(endpoint: BrainEndpointV1): BrainTierV1 {
  if (endpoint.runtime === "deterministic-offline") return "deterministic-floor";
  if (endpoint.location === "local-machine") return "local-model";
  if (endpoint.location === "owner-controlled-host") return "owner-gpu";
  return "third-party";
}

/** Cheapest and most private first. Routing walks this order unless a mode says otherwise. */
export const TIER_ORDER: readonly BrainTierV1[] = ["deterministic-floor", "local-model", "owner-gpu", "third-party"];

export interface RoutingDecisionV1 {
  allowed: boolean;
  endpoint: BrainEndpointV1 | null;
  /** Which tier the chosen endpoint sits in. Null when nothing was chosen. */
  tier: BrainTierV1 | null;
  /** What AION will actually transmit, once a destination is known. */
  context: ContextSelectionV1 | null;
  /** True whenever the chosen endpoint is not owner-controlled. Never suppressed by any mode. */
  requiresDisclosure: boolean;
  /** True when the owner must approve before this runs, in addition to seeing the disclosure. */
  requiresApproval: boolean;
  disclosure: ContextDisclosureV1 | null;
  reason: string;
  /** Every endpoint AION looked at and why it was not used. Nothing is rejected silently. */
  considered: Array<{ id: string; label: string; usable: boolean; why: string }>;
}

function destinationOf(endpoint: BrainEndpointV1): string {
  if (!endpoint.baseUrl) return "this computer (no address at all)";
  try {
    const url = new URL(endpoint.baseUrl);
    return `${url.protocol}//${url.host}`;
  } catch { return "an address AION could not parse"; }
}

/**
 * Describes what would leave the machine, before it does.
 *
 * Every field the Founder asked for is here, and the statement is assembled from them rather than
 * written once and hoped to stay true. Note that a disclosure is produced for owner-controlled
 * hosts too: the owner's rented GPU is still somewhere the prompt travels to, and pretending
 * otherwise is the kind of small lie that makes the big statements untrustworthy.
 */
export function describeDisclosure(endpoint: BrainEndpointV1, request: RoutingRequestV1): ContextDisclosureV1 {
  const ownerControlled = isOwnerControlled(endpoint);
  const destination = destinationOf(endpoint);
  const encrypted = endpoint.baseUrl.startsWith("https:");
  const local = endpoint.location === "local-machine";
  const parts = [
    local
      ? `This runs entirely on this computer through ${endpoint.label} (${endpoint.runtime}, model ${endpoint.model}). Nothing leaves the machine.`
      : `This sends your prompt to ${endpoint.label} at ${destination} (${endpoint.runtime}, model ${endpoint.model}), which is ${ownerControlled ? "infrastructure you control" : "a third-party service"}.`,
    `Workspace: ${request.workspaceLabel}.`,
    request.contextClasses.length ? `Context included: ${request.contextClasses.join(", ")}.` : "Context included: the conversation only.",
    request.includesMemory ? "Your Memory records are included." : "No Memory record is included.",
    request.includesWorkOrCustomerInformation ? "Work or customer information is included." : "No work or customer information is included.",
    local ? "" : encrypted ? "The connection is encrypted." : "The connection is plain HTTP, so anything between here and there can read it.",
    ownerControlled ? "" : "A third-party service may retain, log, or train on what it receives; AION cannot control that and does not claim to.",
    // A rented machine is somebody else's hardware that the owner is paying for by the minute.
    // Both halves of that matter and both are said, every time, rather than once at approval.
    endpoint.rental
      ? `This machine is rented from ${endpoint.rental.infrastructureProvider} at ${endpoint.rental.hourlyCents} cents/hour and stops at ${endpoint.rental.hardStopAt}. You control it and you are paying for it; it is still not this computer, and the host could in principle see what is in its memory.`
      : "",
  ].filter(Boolean);
  return {
    endpointId: endpoint.id, endpointLabel: endpoint.label, runtime: endpoint.runtime, location: endpoint.location,
    ownerControlled, destination, workspace: request.workspace, workspaceLabel: request.workspaceLabel,
    contextClasses: [...request.contextClasses], includesMemory: request.includesMemory,
    includesWorkOrCustomerInformation: request.includesWorkOrCustomerInformation, encrypted,
    statement: parts.join(" "),
  };
}

function meetsNeeds(endpoint: BrainEndpointV1, request: RoutingRequestV1): string | null {
  if (!endpoint.enabled) return "it is turned off";
  if (endpoint.lastHealth && !endpoint.lastHealth.available) return `its last health check failed: ${endpoint.lastHealth.detail}`;
  for (const need of request.needs) {
    if (!endpoint.capabilities[need]) return `it does not do ${need}`;
  }
  if (request.minimumContextTokens && endpoint.capabilities.contextTokens < request.minimumContextTokens) {
    return `its context is ${endpoint.capabilities.contextTokens} tokens and this needs ${request.minimumContextTokens}`;
  }
  return null;
}

/**
 * Chooses where a piece of reasoning runs, or refuses and says why.
 *
 * The order is always the same: eliminate endpoints that cannot do the work, then apply the mode,
 * then apply the two rules that no mode can override — offline means offline, and a third-party
 * endpoint is never reached without disclosure and approval.
 */
export function routeRequest(settings: BrainSettingsV1, request: RoutingRequestV1): RoutingDecisionV1 {
  const considered: RoutingDecisionV1["considered"] = [];
  const candidates: BrainEndpointV1[] = [];
  for (const endpoint of settings.endpoints) {
    const problem = meetsNeeds(endpoint, request);
    if (problem) { considered.push({ id: endpoint.id, label: endpoint.label, usable: false, why: problem }); continue; }
    if (settings.offlineMode && endpoint.location !== "local-machine") {
      considered.push({ id: endpoint.id, label: endpoint.label, usable: false, why: "offline mode is on, and this endpoint is not on this computer" });
      continue;
    }
    if (settings.mode === "local-only" && !isOwnerControlled(endpoint)) {
      considered.push({ id: endpoint.id, label: endpoint.label, usable: false, why: "Local Only is set, and this endpoint is a third-party service" });
      continue;
    }
    considered.push({ id: endpoint.id, label: endpoint.label, usable: true, why: "meets the requirements" });
    candidates.push(endpoint);
  }

  const refuse = (reason: string): RoutingDecisionV1 => ({ allowed: false, endpoint: null, tier: null, context: null, requiresDisclosure: false, requiresApproval: false, disclosure: null, reason, considered });
  if (!candidates.length) {
    return refuse(settings.offlineMode
      ? "Offline mode is on and no endpoint on this computer can do this. AION will not reach out to complete it."
      : "No configured endpoint can do this. AION will not silently substitute one that cannot.");
  }

  const owned = candidates.filter(isOwnerControlled);
  const strongest = (pool: BrainEndpointV1[]) => [...pool].sort((a, b) => capabilityScore(b) - capabilityScore(a) || a.label.localeCompare(b.label))[0]!;

  const choose = (endpoint: BrainEndpointV1, reason: string): RoutingDecisionV1 => {
    const ownerControlled = isOwnerControlled(endpoint);
    return {
      allowed: true, endpoint,
      tier: endpointTier(endpoint),
      // What will actually be transmitted, decided per destination rather than per mode.
      context: selectContext(endpoint, { workspace: request.workspace, requested: request.contextClasses, includesWorkOrCustomerInformation: request.includesWorkOrCustomerInformation }),
      // A disclosure is produced whenever the prompt travels anywhere at all, including to the
      // owner's own host. Approval is required only for a third party.
      requiresDisclosure: endpoint.location !== "local-machine",
      requiresApproval: !ownerControlled,
      disclosure: describeDisclosure(endpoint, request),
      reason, considered,
    };
  };

  switch (settings.mode) {
    case "local-only": {
      /*
       * Local Only excludes third parties, and among what is left it takes the cheapest and most
       * private tier that can do the work rather than the most capable thing present. A rented
       * machine billing by the minute must not be reached implicitly just because it happens to
       * outscore the floor — and when it *is* the only thing that can do the work, the reason says
       * so and names the cost.
       */
      const pick = settings.endpoints.find((entry) => entry.id === settings.primaryEndpointId && candidates.includes(entry))
        ?? strongest(TIER_ORDER.map((tier) => candidates.filter((entry) => endpointTier(entry) === tier)).find((group) => group.length) ?? candidates);
      const where = pick.rental
        ? `${pick.label}, a machine you are renting at ${pick.rental.hourlyCents} cents/hour. Nothing cheaper on this computer could do this, and it costs money while it runs`
        : `${pick.label}, which is ${pick.location === "local-machine" ? "this computer" : "a host you control"}`;
      return choose(pick, `Local Only: running on ${where}. No third-party endpoint was considered.`);
    }
    case "manual": {
      const named = settings.endpoints.find((entry) => entry.id === settings.manualEndpointId);
      if (!named) return refuse("Manual mode is set but no endpoint has been chosen. Pick one in Settings; AION will not choose for you.");
      if (!candidates.includes(named)) {
        const why = considered.find((entry) => entry.id === named.id)?.why ?? "it is not usable for this";
        return refuse(`You chose ${named.label} and AION will not quietly use a different one, but ${why}.`);
      }
      return choose(named, `Manual: you chose ${named.label}.`);
    }
    case "maximum-capability": {
      const best = strongest(candidates);
      const bestOwned = owned.length ? strongest(owned) : null;
      // Preferring the strongest endpoint is a capability preference. It is never consent to send
      // private context to a third party, so when fallback is off AION stays inside owner-controlled
      // infrastructure and says that is what it did rather than quietly widening.
      if (!isOwnerControlled(best) && !settings.remoteFallbackEnabled) {
        if (bestOwned) return choose(bestOwned, `Maximum Capability: ${best.label} scores higher, but remote proprietary fallback is off, so AION used ${bestOwned.label}, which you control. Turn fallback on in Settings if you want the stronger one offered.`);
        return refuse(`Maximum Capability: the only endpoint that can do this is ${best.label}, a third-party service, and remote proprietary fallback is off. AION will not turn a capability preference into permission to send your context out.`);
      }
      return choose(best, isOwnerControlled(best)
        ? `Maximum Capability: ${best.label} is the strongest configured endpoint and you control it.`
        : `Maximum Capability: ${best.label} is the strongest configured endpoint. It is a third-party service, so this still needs your approval and the disclosure below.`);
    }
    default: {
      const primary = settings.endpoints.find((entry) => entry.id === settings.primaryEndpointId);
      if (primary && candidates.includes(primary) && isOwnerControlled(primary)) {
        return choose(primary, `Local Preferred: running on your primary endpoint ${primary.label}.`);
      }
      if (owned.length) {
        /*
         * The cheapest and most private tier that can do the work, not the strongest thing
         * available. Local Preferred means exactly that: the floor and a local model come before a
         * machine being rented by the minute, and reaching for the rented one is a decision the
         * reason string has to justify out loud.
         */
        const byTier = TIER_ORDER.map((tier) => owned.filter((entry) => endpointTier(entry) === tier)).find((group) => group.length);
        const pick = strongest(byTier ?? owned);
        const why = primary && !candidates.includes(primary) ? `Your primary endpoint ${primary.label} could not be used, so ` : "";
        const because = endpointTier(pick) === "owner-gpu"
          ? `nothing cheaper could do this, so AION reached for ${pick.label}, a machine you rent. It costs money while it runs.`
          : `running on ${pick.label}, which you control.`;
        return choose(pick, `${why}Local Preferred: ${because}`.trim());
      }
      const remote = strongest(candidates);
      if (!settings.remoteFallbackEnabled) {
        return refuse(`Local Preferred: no endpoint you control can do this, and remote proprietary fallback is off. AION does not switch to ${remote.label} on its own. Turn fallback on, or choose it yourself in Manual mode.`);
      }
      return choose(remote, `Local Preferred: no endpoint you control can do this. ${remote.label} is a third-party service, so AION is proposing it rather than using it — approve the disclosure below to continue.`);
    }
  }
}

/**
 * Applies brain policy to an endpoint the owner already chose elsewhere.
 *
 * Chat selects its provider in Settings, and that choice is respected — but the two rules no mode
 * may override still apply, and the disclosure is still produced. Routing the explicit choice
 * through the same function as everything else is what keeps policy in one place: there is no
 * second implementation of "may this run" that could drift from this one.
 */
export function routeSelectedProvider(settings: BrainSettingsV1, endpoint: BrainEndpointV1, request: RoutingRequestV1): RoutingDecisionV1 {
  const endpoints = settings.endpoints.some((entry) => entry.id === endpoint.id)
    ? settings.endpoints
    : [...settings.endpoints, endpoint];
  /*
   * Local Only is the one mode that can veto the owner's explicit choice, and it does so only
   * when the chosen endpoint is the thing Local Only exists to exclude. An owner-controlled
   * endpoint is routed as the deliberate selection it is -- routing it through the Local Only
   * branch instead would let the router pick a *different* owner-controlled endpoint and then
   * report the mismatch as a refusal, which would break an ordinary local chat with a message
   * about third parties that had nothing to do with what happened.
   */
  const vetoed = settings.mode === "local-only" && !isOwnerControlled(endpoint);
  const scoped: BrainSettingsV1 = { ...settings, mode: vetoed ? "local-only" : "manual", manualEndpointId: endpoint.id, endpoints };
  const decision = routeRequest(scoped, request);
  if (vetoed) {
    return { ...decision, allowed: false, endpoint: null, tier: null, context: null, disclosure: null, requiresDisclosure: false, requiresApproval: false,
      reason: `Local Only is set and ${endpoint.label} is a third-party service, so AION will not use it. Choose a local or owner-controlled endpoint, or change the mode.` };
  }
  return decision;
}

/**
 * Represents a model provider that was configured before the endpoint registry existed, so brain
 * policy can be applied to it without the owner having to re-enter anything. The location is taken
 * from the provider's own declaration, which is the only thing AION actually knows about it.
 */
export function endpointForProvider(provider: { id: string; location: "local" | "remote" }, model: string, now: IsoTimestamp): BrainEndpointV1 {
  const local = provider.location === "local";
  return {
    id: provider.id,
    label: provider.id,
    runtime: provider.id === OFFLINE_ENDPOINT_ID || provider.id === "deterministic" ? "deterministic-offline" : "openai-compatible",
    location: local ? "local-machine" : "third-party-service",
    baseUrl: "",
    model,
    hostLabel: local ? "this computer" : "a third-party service",
    credentialEnvironmentVariable: "",
    capabilities: {
      conversation: true, reasoning: !local, code: !local, structuredJson: !local,
      toolProposal: true, vision: false, embeddings: false,
      contextTokens: local ? 8_192 : 128_000, costClass: local ? "free-local" : "paid-per-token",
    },
    enabled: true,
    addedAt: now,
    lastHealth: null,
    rental: null,
  };
}

/**
 * Context minimisation.
 *
 * An owner-controlled rented GPU is better than a vendor's API and is not the same as nothing
 * leaving the machine. The prompt still travels, it still sits in somebody else's RAM, and the
 * host still could be watching. So AION sends the minimum the work needs rather than everything
 * it happens to have — which is also the honest reason the disclosure exists.
 *
 * The rule is a whitelist, not a redaction pass: classes are opted *in* per destination, so a new
 * kind of context added later is excluded until somebody deliberately includes it.
 */
export interface ContextSelectionV1 {
  /** What the caller asked to include. */
  requested: readonly string[];
  /** What AION will actually send. */
  included: string[];
  /** What was dropped, and why, so the owner can see the difference. */
  withheld: Array<{ class: string; reason: string }>;
  /** How many Memory records may travel, after the cap for this destination. */
  memoryLimit: number;
  statement: string;
}

/** Context classes that never leave this computer, whatever the destination or the mode. */
export const NEVER_TRANSMITTED = [
  "credential values",
  "pairing codes and session tokens",
  "other workspaces",
  "complete Memory database",
  "complete relationship records",
] as const;

export function selectContext(
  endpoint: BrainEndpointV1,
  request: { workspace: string; requested: readonly string[]; includesWorkOrCustomerInformation: boolean },
): ContextSelectionV1 {
  const local = endpoint.location === "local-machine";
  // A local endpoint is this computer, so nothing is leaving and there is nothing to minimise.
  // Everywhere else gets a cap, and a third party gets the tightest one.
  const memoryLimit = local ? 20 : endpoint.location === "owner-controlled-host" ? 8 : 3;
  const withheld: ContextSelectionV1["withheld"] = [];
  const included: string[] = [];
  for (const entry of request.requested) {
    const lower = entry.toLocaleLowerCase();
    const banned = NEVER_TRANSMITTED.find((never) => lower.includes(never.toLocaleLowerCase()));
    if (banned) { withheld.push({ class: entry, reason: `"${banned}" never leaves this computer, under any mode or destination.` }); continue; }
    if (!local && lower.includes("workspace") && !lower.includes(request.workspace.toLocaleLowerCase())) {
      withheld.push({ class: entry, reason: "It belongs to a workspace other than the one this work is in." });
      continue;
    }
    included.push(entry);
  }
  const statement = local
    ? `Everything stays on this computer, so nothing was withheld. ${included.length} context class(es) included.`
    : `${included.length} context class(es) will be sent to ${endpoint.label}; at most ${memoryLimit} Memory record(s) travel with them.${withheld.length ? ` ${withheld.length} class(es) withheld.` : ""}${request.includesWorkOrCustomerInformation ? " Work or customer information is included, which is governed by your workspace policy rather than by this endpoint being one you control." : ""} An endpoint you control is better than a vendor's API; it is not the same as nothing leaving the machine.`;
  return { requested: [...request.requested], included, withheld, memoryLimit, statement };
}

/**
 * The acceptance criterion, as a function.
 *
 * AION fails the model-independence requirement if removing every third-party credential would
 * leave the owner unable to use it. This answers that question against the actual configuration
 * rather than against an intention.
 */
export function independenceReport(settings: BrainSettingsV1): {
  independent: boolean;
  ownerControlledEndpoints: number;
  thirdPartyEndpoints: number;
  offlineFloorPresent: boolean;
  summary: string;
} {
  const owned = settings.endpoints.filter((entry) => entry.enabled && isOwnerControlled(entry));
  const thirdParty = settings.endpoints.filter((entry) => entry.enabled && !isOwnerControlled(entry));
  const offlineFloorPresent = settings.endpoints.some((entry) => entry.id === OFFLINE_ENDPOINT_ID && entry.enabled);
  const independent = owned.length > 0;
  const better = owned.filter((entry) => entry.id !== OFFLINE_ENDPOINT_ID).length;
  return {
    independent, ownerControlledEndpoints: owned.length, thirdPartyEndpoints: thirdParty.length, offlineFloorPresent,
    summary: !independent
      ? "AION currently has no endpoint you control. Delete every third-party credential and it would stop being able to reason. This is the state the model-independence requirement exists to prevent."
      : better
        ? `AION has ${better} endpoint(s) you control besides the built-in offline provider${thirdParty.length ? `, and ${thirdParty.length} third-party endpoint(s) it does not need` : ""}. Delete every third-party credential and AION keeps working.`
        : "AION has only the built-in offline provider. It will keep working with every credential deleted, but modestly — configure a local or owner-controlled model for real reasoning.",
  };
}

/**
 * The brain boundary.
 *
 * A model's hidden conversational context is not AION's Memory, and this states that as data so
 * the UI and the docs cannot drift from it. Durable information belongs to AION's explicit Memory
 * and provenance system; the model receives selected context for one turn and owns no history.
 */
/**
 * The port an adapter implements to actually reach a runtime.
 *
 * Deliberately three narrow operations rather than a client: ask an endpoint whether it is there,
 * look for runtimes on this computer at their documented addresses, and run one bounded
 * completion. No streaming, no sessions, no model management — anything more would put decisions
 * in the adapter that belong in the policy above.
 */
export interface BrainRuntimePortV1 {
  /**
   * Whether this adapter can run a completion for an endpoint at all.
   *
   * The offline provider has no address, deliberately, and an address-based adapter cannot serve
   * it. Rather than inventing a fake endpoint so the evaluator has something to talk to — which
   * would make the whole measurement a lie — an adapter declares what it can handle and the
   * evaluator picks one that can. This is the seam that lets the same fixture suite measure the
   * deterministic floor, a local runtime, and an owner-controlled remote endpoint fairly.
   */
  supports(endpoint: BrainEndpointV1): boolean;
  /** Asks one configured endpoint whether it is reachable and what models it reports. */
  probe(endpoint: BrainEndpointV1, signal: AbortSignal): Promise<BrainHealthV1>;
  /**
   * Looks for runtimes at their documented loopback addresses. This is a short fixed list of
   * addresses, never a search of the computer, and it starts nothing and installs nothing.
   */
  detect(signal: AbortSignal): Promise<Array<{ runtime: BrainRuntimeV1; baseUrl: string; models: string[]; detail: string }>>;
  /** One bounded completion, used by the evaluation harness. */
  complete(endpoint: BrainEndpointV1, request: { prompt: string; context: readonly string[]; signal: AbortSignal }): Promise<{ text: string; latencyMs: number }>;
}

export const BRAIN_BOUNDARY = {
  aionOwns: [
    "Memory", "Tasks", "Routines", "Plans", "Relationships", "Workspaces", "Brands",
    "Product Studio", "research evidence", "learned strategies", "owner corrections",
    "capability permissions", "approvals", "Activity", "agent state",
  ],
  modelOwns: [] as string[],
  statement: "A model receives the context AION selected for one turn and keeps nothing. Whatever it appears to remember between turns is context AION sent again. Replacing the model changes nothing AION knows.",
} as const;
