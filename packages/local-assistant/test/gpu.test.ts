import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  InMemoryStateRepositoryV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1,
  OPEN_MODEL_PROFILES, SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1, SyntheticGpuInfrastructureV1, UnavailableGpuInfrastructureV1,
  V13_BUDGET_CEILING_CENTS, assessOffer, buildProvisioningProposal, digestValue, emptyActivation,
  normaliseOffer, recommendExperiments, redactCredentials, revalidateProposal, shutdownDecision,
} from "../src/index.js";
import type { GpuInfrastructurePortV1, GpuOfferV1, GpuRequirementV1, GpuSessionV1 } from "../src/index.js";

/**
 * The money path. Nothing here rents anything, opens a socket, or reads a credential: offers come
 * from a scripted table and an "instance" is a string. That is deliberate — every spending control
 * below has to be provable without a card being charged.
 */

const NOW = "2030-01-01T00:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(NOW) + minutes * 60_000).toISOString();

const OFFERS = [
  { offerRef: "cheap", gpuName: "RTX 3090", vramGb: 24, hourlyCents: 22, storageCentsPerHour: 2, reliability: 92, diskGb: 60, verified: true },
  { offerRef: "balanced", gpuName: "RTX 4090", vramGb: 24, hourlyCents: 38, storageCentsPerHour: 2, reliability: 98, diskGb: 100, verified: true },
  { offerRef: "big", gpuName: "A100", vramGb: 80, hourlyCents: 140, storageCentsPerHour: 5, reliability: 99, diskGb: 200, verified: true },
  { offerRef: "tiny", gpuName: "RTX 3060", vramGb: 12, hourlyCents: 9, storageCentsPerHour: 1, reliability: 80, diskGb: 40, verified: false },
];

const requirement: GpuRequirementV1 = { modelId: "mistral-small-24b", minimumVramGb: 24, maxHourlyCents: 200, minimumReliability: null, runtime: "vllm" };

function offer(ref: string): GpuOfferV1 {
  return normaliseOffer(OFFERS.find((entry) => entry.offerRef === ref)!, "synthetic", NOW);
}

async function assistant(gpu: GpuInfrastructurePortV1 = new SyntheticGpuInfrastructureV1(OFFERS)) {
  const root = await mkdtemp(join(tmpdir(), "aion-gpu-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  return new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    gpu,
  });
}

test("AION rents nothing by default and says why", async () => {
  const service = await assistant(new UnavailableGpuInfrastructureV1());
  const credential = await service.gpuCredentialStatus();
  assert.equal(credential.configured, false);
  assert.match(credential.detail, /AION rents nothing until you configure one/u);
  await assert.rejects(() => service.discoverGpuOffers({}), /rents nothing until you configure one/u);
  assert.deepEqual(await service.gpuSessions(), []);
});

test("discovery is refused until the owner names a configured credential variable", async () => {
  const service = await assistant(new SyntheticGpuInfrastructureV1(OFFERS, { credentialConfigured: false, variableName: "AION_VAST_API_KEY" }));
  await assert.rejects(() => service.discoverGpuOffers({ modelId: "mistral-small-24b" }), /AION_VAST_API_KEY is not set/u);
  const status = await service.gpuCredentialStatus();
  assert.equal(status.variableName, "AION_VAST_API_KEY", "AION reports the variable NAME");
  assert.doesNotMatch(JSON.stringify(status), /[A-Fa-f0-9]{32,}/u, "and never a value");
});

test("capability comes before price: a machine that cannot hold the model is ineligible at any price", () => {
  const tiny = assessOffer(offer("tiny"), requirement);
  assert.equal(tiny.eligible, false);
  assert.ok(tiny.reasons.some((reason) => /cannot hold mistral-small-24b/u.test(reason)));
  assert.equal(tiny.score, 0);

  const cheap = assessOffer(offer("cheap"), requirement);
  assert.equal(cheap.eligible, true);
  assert.ok(cheap.score > 0);

  const priced = assessOffer(offer("big"), { ...requirement, maxHourlyCents: 100 });
  assert.equal(priced.eligible, false);
  assert.ok(priced.reasons.some((reason) => /above the 100 cents\/hour limit/u.test(reason)));

  // An unreported reliability is called unproven rather than assumed good.
  const unknown = assessOffer(normaliseOffer({ ...OFFERS[0], reliability: undefined }, "synthetic", NOW), requirement);
  assert.ok(unknown.reasons.some((reason) => /unproven rather than good/u.test(reason)));
});

test("recommendations are three framings of an experiment, all well inside the ceiling", async () => {
  const service = await assistant();
  const found = await service.discoverGpuOffers({ modelId: "mistral-small-24b", maxHourlyCents: 200 });
  assert.equal(found.ceilingCents, V13_BUDGET_CEILING_CENTS);
  assert.ok(found.recommendations.length >= 2);
  // Tiers that land on the same machine are deduplicated: three identical rows would be one
  // choice presented as three. Here the cheapest offer is also the best value, so "balanced"
  // collapses into "economical" and the owner sees two genuinely different experiments.
  assert.deepEqual(found.recommendations.map((entry) => entry.tier), ["economical", "maximum-useful"]);
  assert.equal(new Set(found.recommendations.map((entry) => entry.offer.offerRef)).size, found.recommendations.length);

  for (const recommendation of found.recommendations) {
    assert.ok(recommendation.estimatedCents <= V13_BUDGET_CEILING_CENTS / 2, `${recommendation.tier} stays well inside the ceiling`);
    assert.match(recommendation.why, /cents\/hour including storage/u);
    assert.match(recommendation.why, /% of the 1600-cent ceiling/u);
  }
  // The cheapest eligible machine leads, not the biggest.
  assert.equal(found.recommendations[0]?.offer.offerRef, "cheap");
  assert.match(found.note, /Discovery only/u);
});

test("a proposal whose own arithmetic exceeds its limit is refused before the owner ever sees it", () => {
  const context = { id: "p1", now: NOW, digest: digestValue };
  assert.throws(
    () => buildProvisioningProposal({ offer: offer("big"), modelId: "qwen3-32b", runtime: "vllm", maxRuntimeMinutes: 600, maxSpendCents: 200, idleTimeoutMinutes: 10 }, context),
    /could cost 1450 cents, above the 200-cent limit/u,
  );
  assert.throws(
    () => buildProvisioningProposal({ offer: offer("cheap"), modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 30, maxSpendCents: 5000, idleTimeoutMinutes: 10 }, context),
    /ceiling is 1600 cents and this proposal asks for 5000/u,
  );
  assert.throws(
    () => buildProvisioningProposal({ offer: offer("cheap"), modelId: "m", runtime: "vllm", maxRuntimeMinutes: 30, maxSpendCents: 100, idleTimeoutMinutes: 60 }, context),
    /idle timeout is required, and cannot be longer than the maximum runtime/iu,
  );
});

test("the disclosure names every number the owner is agreeing to", () => {
  const proposal = buildProvisioningProposal(
    { offer: offer("balanced"), modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 60, maxSpendCents: 60, idleTimeoutMinutes: 10 },
    { id: "p1", now: NOW, digest: digestValue },
  );
  assert.equal(proposal.state, "pending");
  assert.equal(proposal.quotedHourlyCents, 38);
  assert.equal(proposal.quotedStorageCentsPerHour, 2);
  assert.equal(proposal.digest.length, 64, "the money-bearing fields are digest-bound");
  assert.match(proposal.shutdownPolicy, /stored, so it survives AION being closed or crashing/u);
  assert.match(proposal.shutdownPolicy, /10 minutes with no inference/u);
  assert.match(proposal.shutdownPolicy, /60 minutes total runtime/u);
});

test("a price rise past the approved limit invalidates the approval rather than costing more", () => {
  const proposal = buildProvisioningProposal(
    { offer: offer("cheap"), modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 60, maxSpendCents: 30, idleTimeoutMinutes: 10 },
    { id: "p1", now: NOW, digest: digestValue },
  );
  const approved = { ...proposal, state: "approved" as const, decidedAt: NOW };

  const unchanged = revalidateProposal(approved, offer("cheap"), at(5));
  assert.equal(unchanged.state, "approved");

  const dearer = normaliseOffer({ ...OFFERS[0], hourlyCents: 60 }, "synthetic", NOW);
  const invalid = revalidateProposal(approved, dearer, at(5));
  assert.equal(invalid.state, "invalidated");
  assert.match(invalid.invalidationReason!, /price rose from 24 to 62 cents\/hour/u);

  const gone = revalidateProposal(approved, null, at(5));
  assert.equal(gone.state, "invalidated");
  assert.match(gone.invalidationReason!, /no longer available/u);
});

test("provisioning needs an approved proposal, and consumes it", async () => {
  const service = await assistant();
  const found = await service.discoverGpuOffers({ modelId: "mistral-small-24b" });
  const pick = found.recommendations[0]!;
  const proposal = await service.proposeGpuProvisioning({ offer: pick.offer, modelId: pick.modelId, runtime: "vllm", maxRuntimeMinutes: 30, maxSpendCents: 30, idleTimeoutMinutes: 10 });

  await assert.rejects(() => service.startGpuSession(proposal.id), /needs an approved proposal; this one is pending/u);
  await service.decideGpuProposal(proposal.id, true);
  const session = await service.startGpuSession(proposal.id);

  // Provisioning, not running: the provider has created a machine and nothing has yet checked
  // whether a model answers on it. Calling that "running" was the defect this milestone corrects.
  assert.equal(session.state, "provisioning");
  assert.equal(session.endpointId, null);
  assert.ok(session.instanceRef);
  assert.equal(session.maxSpendCents, 30);
  assert.equal((await service.gpuProposals()).find((entry) => entry.id === proposal.id)?.state, "consumed", "an approval is one-shot");
  await assert.rejects(() => service.startGpuSession(proposal.id), /is consumed/u);
});

test("the hard-stop deadline is stored, not held in a timer", async () => {
  const service = await assistant();
  const found = await service.discoverGpuOffers({ modelId: "mistral-small-24b" });
  const proposal = await service.proposeGpuProvisioning({ offer: found.recommendations[0]!.offer, modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 30, maxSpendCents: 30, idleTimeoutMinutes: 10 });
  await service.decideGpuProposal(proposal.id, true);
  const session = await service.startGpuSession(proposal.id);

  const persisted = (await service.snapshot()).gpuSessions[0]!;
  assert.equal(persisted.hardStopAt, session.hardStopAt);
  assert.ok(Date.parse(persisted.hardStopAt) > Date.parse(persisted.startedAt!), "the deadline is in the state file");
  assert.equal(Math.round((Date.parse(persisted.hardStopAt) - Date.parse(persisted.startedAt!)) / 60_000), 30);
});

test("every stop condition fires from stored state alone", () => {
  const base: GpuSessionV1 = {
    id: "s1", provider: "synthetic", proposalId: "p1", instanceRef: "i1", state: "ready",
    gpuName: "RTX 4090", vramGb: 24, modelId: "m", runtime: "vllm",
    endpointId: "e1", endpointHost: "gpu.invalid", activation: emptyActivation(), failureReason: null,
    hourlyCents: 60, maxRuntimeMinutes: 60, maxSpendCents: 40, idleTimeoutMinutes: 10,
    hardStopAt: at(60), startedAt: NOW, stoppedAt: null, lastActivityAt: NOW,
    measuredMinutes: 0, estimatedCents: 0, teardownConfirmed: false, events: [],
  };
  assert.equal(shutdownDecision(base, at(5)).stop, false);

  assert.deepEqual(
    { ...shutdownDecision({ ...base, lastActivityAt: NOW }, at(11)) },
    { stop: true, trigger: "idle", reason: "Nothing has used it for 11 minutes against an idle timeout of 10." },
  );
  assert.equal(shutdownDecision({ ...base, lastActivityAt: at(39) }, at(41)).trigger, "max-spend", "40 cents at 60/hour is 40 minutes");
  assert.equal(shutdownDecision({ ...base, maxSpendCents: 1000, lastActivityAt: at(59) }, at(61)).trigger, "hard-stop");
  assert.equal(shutdownDecision({ ...base, maxSpendCents: 1000, hardStopAt: at(600), maxRuntimeMinutes: 30, lastActivityAt: at(29) }, at(31)).trigger, "max-runtime");
  assert.equal(shutdownDecision({ ...base, lastActivityAt: at(4) }, at(5), false).trigger, "health");
  assert.equal(shutdownDecision({ ...base, state: "stopped" }, at(999)).stop, false, "a finished session is not stopped twice");
});

test("enforcement stops a session that outran its limits, and records the trigger", async () => {
  const service = await assistant();
  const found = await service.discoverGpuOffers({ modelId: "mistral-small-24b" });
  const proposal = await service.proposeGpuProvisioning({ offer: found.recommendations[0]!.offer, modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 1, maxSpendCents: 5, idleTimeoutMinutes: 1 });
  await service.decideGpuProposal(proposal.id, true);
  const session = await service.startGpuSession(proposal.id);

  // The deterministic clock advances a second per read, so drive the decision directly and then
  // let enforcement act on it: what matters is that a live session gets stopped and audited.
  const enforced = await service.enforceGpuLimits(false);
  assert.deepEqual(enforced, [{ sessionId: session.id, trigger: "health", stopped: true }]);

  const after = (await service.gpuSessions()).find((entry) => entry.id === session.id)!;
  // It was stopped while still booting, so it is recorded as an activation failure rather than a
  // normal stop: the owner paid for boot time and got nothing usable, and those are different
  // outcomes even though both end with the machine gone.
  assert.equal(after.state, "activation-failed");
  assert.equal(after.teardownConfirmed, true);
  assert.ok(after.events.some((event) => event.event === "teardown-confirmed"));
  assert.match(after.standing, /Teardown confirmed/u);
  assert.match(after.standing, /never became usable/u);
});

test("a teardown the provider did not confirm is reported as unconfirmed, not assumed", async () => {
  const stubborn: GpuInfrastructurePortV1 = {
    provider: "synthetic",
    credentialStatus: async () => ({ configured: true, variableName: "AION_TEST", detail: "scripted" }),
    discover: async () => [offer("cheap")],
    start: async () => ({ instanceRef: "i1", detail: "started" }),
    stop: async () => ({ stopped: false, detail: "the provider returned an error" }),
    status: async () => ({ state: "running", detail: "still up", endpointUrl: null }),
  };
  const service = await assistant(stubborn);
  const proposal = await service.proposeGpuProvisioning({ offer: offer("cheap"), modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 30, maxSpendCents: 30, idleTimeoutMinutes: 10 });
  await service.decideGpuProposal(proposal.id, true);
  const session = await service.startGpuSession(proposal.id);

  const stopped = await service.stopGpuSession(session.id, "owner stop");
  assert.equal(stopped.teardownConfirmed, false);
  assert.equal(stopped.state, "failed");
  const recorded = (await service.snapshot()).activity.find((entry) => entry.action === "gpu.stop");
  assert.equal(recorded?.outcome, "failed");
  assert.match(recorded!.summary, /did NOT get confirmation/u);
  assert.match(recorded!.summary, /Check the provider console yourself — it may still be billing/u);
});

test("credential-shaped text is redacted before it can be stored or shown", () => {
  for (const [raw, shape] of [
    ["failed with key sk-abcdef0123456789abcdef", /\[redacted\]/u],
    ["token=deadbeefdeadbeefdeadbeefdeadbeef", /\[redacted\]/u],
    ['{"api_key": "hunter2hunter2"}', /\[redacted\]/u],
    ["bearer_9f8e7d6c5b4a3210", /\[redacted\]/u],
  ] as const) {
    const cleaned = redactCredentials(raw);
    assert.match(cleaned, shape, `${raw} is redacted`);
    assert.doesNotMatch(cleaned, /abcdef0123456789|deadbeefdeadbeef|hunter2hunter2|9f8e7d6c5b4a3210/u);
  }
  assert.equal(redactCredentials("the instance started normally"), "the instance started normally");
});

test("no session, proposal, or activity entry ever contains a credential value", async () => {
  const service = await assistant();
  const found = await service.discoverGpuOffers({ modelId: "mistral-small-24b" });
  const proposal = await service.proposeGpuProvisioning({ offer: found.recommendations[0]!.offer, modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 30, maxSpendCents: 30, idleTimeoutMinutes: 10 });
  await service.decideGpuProposal(proposal.id, true);
  const session = await service.startGpuSession(proposal.id);
  await service.stopGpuSession(session.id);

  const serialized = JSON.stringify(await service.snapshot());
  assert.doesNotMatch(serialized, /\bsk-[A-Za-z0-9]{8,}/u);
  // The one long hex string in state is the proposal digest, which is required and is not a
  // secret. Everything else key-shaped must be absent.
  const withoutDigests = serialized.replace(/"digest":"[a-f0-9]{64}"/gu, '"digest":"[digest]"');
  assert.doesNotMatch(withoutDigests, /\b[A-Fa-f0-9]{32,}\b/u, "nothing key-shaped is persisted anywhere in state");
});

test("model profiles are labelled as estimates rather than presented as measurements", async () => {
  const service = await assistant();
  const profiles = service.modelProfiles();
  assert.ok(profiles.local.length >= 3 && profiles.rented.length >= 4);
  assert.equal(profiles.ceilingCents, V13_BUDGET_CEILING_CENTS);
  assert.match(profiles.note, /planning estimates for a common quantisation, not guarantees/u);
  assert.match(profiles.note, /does not download anything/u);

  // No family is privileged, and the smallest local option really is small.
  const families = new Set(OPEN_MODEL_PROFILES.map((entry) => entry.family));
  assert.ok(families.size >= 4, "several open-weight families are represented");
  assert.ok(Math.min(...profiles.local.map((entry) => entry.minimumVramGb)) <= 4);
});

test("recommendations disappear entirely when nothing eligible exists", () => {
  const impossible: GpuRequirementV1 = { ...requirement, minimumVramGb: 640 };
  const assessments = OFFERS.map((raw) => assessOffer(normaliseOffer(raw, "synthetic", NOW), impossible));
  assert.equal(assessments.every((entry) => !entry.eligible), true);
  assert.deepEqual(recommendExperiments(assessments, impossible), [], "AION recommends nothing rather than the least-bad thing");
});

test("an offer that does not state its VRAM is refused rather than guessed at", () => {
  assert.throws(() => normaliseOffer({ offerRef: "x", gpuName: "Mystery", hourlyCents: 10 }, "synthetic", NOW), /must state its VRAM; AION will not guess/u);
  assert.throws(() => normaliseOffer({ offerRef: "x", gpuName: "G", vramGb: 24, hourlyCents: -1 }, "synthetic", NOW), /whole number of cents/u);
  assert.throws(() => normaliseOffer({ offerRef: "x", gpuName: "G", vramGb: 24, hourlyCents: 10 }, "aws" as never, NOW), /provider must be one of/u);
});
