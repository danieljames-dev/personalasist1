import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, CompositeBrainRuntimeV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  GPU_STATUS_LABELS, InProcessBrainRuntimeV1, InMemoryStateRepositoryV1, LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1, MAX_HEALTH_FAILURES, NodePrivateBackupV1, OFFLINE_ENDPOINT_ID,
  ScriptedBrainRuntimeV1, SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1, SyntheticGpuInfrastructureV1, V13_BUDGET_CEILING_CENTS,
  emptyActivation, normaliseServingEndpoint, shutdownDecision,
} from "../src/index.js";
import type {
  ClockV1, GpuInfrastructurePortV1, GpuSessionV1, IdGeneratorV1, ScriptedRuntimeScriptV1,
  StateRepositoryV1, SyntheticGpuOptionsV1,
} from "../src/index.js";

/**
 * The bridge between a rented machine and a usable brain.
 *
 * Everything below runs against scripted infrastructure and a scripted runtime. Nothing here rents
 * a GPU, opens a socket, reads a credential, or spends a cent — which is the point. The failure
 * this whole milestone is built around is a machine that bills while being useless, and proving
 * AION handles that must not require reproducing it with real money.
 *
 * The cases are the ones the correcting directive asked for, in its order, plus the router and
 * privacy consequences of a rented endpoint existing at all.
 */

const EPOCH = Date.parse("2030-01-01T00:00:00.000Z");

/** A clock a test can move. Real deadlines are minutes long; waiting them out is not a test. */
class SteppableClockV1 implements ClockV1 {
  private offsetMs = 0;
  now(): string { return new Date(EPOCH + this.offsetMs).toISOString(); }
  advanceMinutes(minutes: number): void { this.offsetMs += minutes * 60_000; }
  advanceSeconds(seconds: number): void { this.offsetMs += seconds * 1000; }
}

const OFFERS = [
  { offerRef: "cheap", gpuName: "RTX 3090", vramGb: 24, hourlyCents: 22, storageCentsPerHour: 2, reliability: 92, diskGb: 60, verified: true },
];

interface Harness {
  service: AionAssistantV1;
  clock: SteppableClockV1;
  repository: StateRepositoryV1;
  gpu: SyntheticGpuInfrastructureV1;
  runtime: ScriptedBrainRuntimeV1;
}

async function harness(options: {
  gpu?: SyntheticGpuOptionsV1;
  script?: ScriptedRuntimeScriptV1;
  infrastructure?: GpuInfrastructurePortV1;
  ids?: IdGeneratorV1;
} = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), "aion-bridge-test-"));
  const exportRoot = join(root, "exports"); await mkdir(exportRoot);
  const clock = new SteppableClockV1();
  const repository = new InMemoryStateRepositoryV1();
  const gpu = new SyntheticGpuInfrastructureV1(OFFERS, options.gpu ?? {});
  const runtime = new ScriptedBrainRuntimeV1(options.script ?? { answer: "READY" });
  const provider = new DeterministicModelProviderV1();
  const service = new AionAssistantV1({
    repository, clock, ids: options.ids ?? new DeterministicIdGeneratorV1(),
    providers: [provider],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exportRoot),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    gpu: options.infrastructure ?? gpu,
    // The production composition, with the scripted adapter standing in for HTTP: the floor runs
    // in-process because it has no address, and anything with one goes to a transport adapter.
    brainRuntime: new CompositeBrainRuntimeV1(new InProcessBrainRuntimeV1(provider, () => clock.now()), runtime),
  });
  await service.startupReconciliation;
  return { service, clock, repository, gpu, runtime };
}

/** Discover, propose, approve, start. Stops short of readiness so each test drives that itself. */
async function startSession(
  service: AionAssistantV1,
  limits: { maxRuntimeMinutes?: number; maxSpendCents?: number; idleTimeoutMinutes?: number; readinessMinutes?: number } = {},
): Promise<string> {
  const found = await service.discoverGpuOffers({ modelId: "mistral-small-24b", maxHourlyCents: 200 });
  const proposal = await service.proposeGpuProvisioning({
    offer: found.recommendations[0]!.offer, modelId: "mistral-small-24b", runtime: "vllm",
    maxRuntimeMinutes: limits.maxRuntimeMinutes ?? 60,
    maxSpendCents: limits.maxSpendCents ?? 30,
    idleTimeoutMinutes: limits.idleTimeoutMinutes ?? 15,
    readinessMinutes: limits.readinessMinutes ?? 10,
  });
  await service.decideGpuProposal(proposal.id, true);
  return (await service.startGpuSession(proposal.id)).id;
}

/** Drives readiness the way the real loop does, without any real waiting. */
async function activate(service: AionAssistantV1, id: string, clock: SteppableClockV1, secondsPerPoll = 10) {
  return service.activateGpuSession(id, { maxPolls: 12, sleep: async () => { clock.advanceSeconds(secondsPerPoll); } });
}

test("1. infrastructure provisions but the endpoint never appears: paid, refused, torn down", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 10_000 }, script: { answer: "READY" } });
  const id = await startSession(service, { readinessMinutes: 4 });
  const status = await activate(service, id, clock, 40);

  assert.equal(status.ready, false);
  assert.equal(status.state, "activation-failed");
  assert.equal(status.label, "Failed");
  assert.equal(status.endpointId, null, "nothing was registered, because nothing ever answered");
  assert.match(status.detail, /did not become usable within the allowance/u);

  const session = (await service.gpuSessions()).find((entry) => entry.id === id)!;
  assert.equal(session.teardownConfirmed, true, "the machine was stopped, not left running");
  assert.ok(session.measuredMinutes >= 4, "the boot time was billable and is recorded");
  assert.match(session.cost.note, /paid for boot time that produced nothing/u);
  assert.equal((await service.brainSettings()).endpoints.length, 1, "only the offline floor remains");
});

test("2. the endpoint appears but fails its health check: refused after a bounded number of tries", async () => {
  const { service, clock } = await harness({
    gpu: { endpointAfterPolls: 0 },
    script: { available: true, answer: () => { throw new Error("the model is still loading"); } },
  });
  const id = await startSession(service, { readinessMinutes: 30, maxRuntimeMinutes: 60 });
  const status = await activate(service, id, clock, 5);

  assert.equal(status.ready, false);
  assert.equal(status.state, "activation-failed");
  const session = (await service.gpuSessions()).find((entry) => entry.id === id)!;
  assert.equal(session.activation.healthFailures >= MAX_HEALTH_FAILURES, true, "it gave up after a stated number of failures rather than retrying forever");
  assert.ok(session.events.some((event) => event.event === "endpoint-discovered"), "the address was found");
  assert.ok(session.events.some((event) => event.event === "health" && /failed/u.test(event.detail)));
  assert.equal(session.endpointId, null, "an endpoint that cannot answer is never registered");
  assert.equal(session.teardownConfirmed, true);
});

test("3. the endpoint becomes ready: registered as owner-controlled, rented, and health-verified", async () => {
  const { service, clock, runtime } = await harness({ gpu: { endpointAfterPolls: 2 }, script: { answer: "READY", models: ["mistral-small-24b"], latencyMs: 42 } });
  const id = await startSession(service);
  const status = await activate(service, id, clock);

  assert.equal(status.ready, true);
  assert.equal(status.state, "ready");
  assert.equal(status.label, "Ready");
  assert.ok(status.endpointId);
  assert.equal(status.endpointHost, "synthetic-gpu.invalid");

  const settings = await service.brainSettings();
  const endpoint = settings.endpoints.find((entry) => entry.id === status.endpointId)!;
  assert.equal(endpoint.location, "owner-controlled-host", "renting capacity you control is still control, and it is still not this computer");
  assert.equal(endpoint.rental?.gpuSessionId, id);
  assert.equal(endpoint.rental?.infrastructureProvider, "synthetic");
  assert.equal(endpoint.rental?.hourlyCents, 24);
  assert.equal(endpoint.model, "mistral-small-24b");
  assert.equal(endpoint.credentialEnvironmentVariable, "", "no credential value and no credential name AION was not given");
  assert.equal(endpoint.lastHealth?.available, true);
  assert.match(endpoint.lastHealth!.detail, /Verified by a completion, not by a socket/u);
  assert.ok(runtime.completionCount >= 1, "health was proved by an actual completion");

  const session = (await service.gpuSessions()).find((entry) => entry.id === id)!;
  assert.ok(session.activation.endpointDiscoveredAt, "discovery is timestamped");
  assert.ok(session.activation.readyAt, "so is readiness");
  assert.ok(session.events.some((event) => event.event === "endpoint-registered"));
});

test("4. the spend ceiling keeps counting during boot and stops the machine when it is reached", async () => {
  /*
   * The spend limit binds during boot exactly as it does during inference, and the poll evaluates
   * it before it looks at anything else. Proved twice, because the two halves are separable.
   *
   * First the rule itself, on a session that is still activating. A migrated session can carry any
   * combination of limits, so a spend ceiling that bites well before the runtime one is a state
   * AION genuinely has to handle rather than a hypothetical.
   */
  const activating: GpuSessionV1 = {
    id: "s1", provider: "synthetic", proposalId: "p1", instanceRef: "i1", state: "booting-runtime",
    gpuName: "RTX 3090", vramGb: 24, modelId: "m", runtime: "vllm",
    endpointId: null, endpointHost: null, activation: emptyActivation(), failureReason: null,
    hourlyCents: 120, maxRuntimeMinutes: 60, maxSpendCents: 10, idleTimeoutMinutes: 1,
    hardStopAt: new Date(EPOCH + 60 * 60_000).toISOString(),
    startedAt: new Date(EPOCH).toISOString(), stoppedAt: null, lastActivityAt: new Date(EPOCH).toISOString(),
    measuredMinutes: 0, estimatedCents: 0, teardownConfirmed: false, events: [],
  };
  // 120 cents/hour is 2 cents a minute: eight cents spent, two still authorised.
  const atFourMinutes = new Date(EPOCH + 4 * 60_000).toISOString();
  assert.equal(shutdownDecision(activating, atFourMinutes).trigger, "none", "four minutes of boot is inside the allowance");
  const atTenMinutes = new Date(EPOCH + 10 * 60_000).toISOString();
  const decision = shutdownDecision(activating, atTenMinutes);
  assert.equal(decision.trigger, "max-spend", "boot time is billable, so the money runs out while it boots");
  assert.match(decision.reason, /Estimated spend is 20 cents against an authorised maximum of 10/u);

  // Then the poll acting on it: whatever the limit, a session that must stop is stopped before the
  // provider is asked anything, and it is recorded as never having become usable.
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 10_000 } });
  const id = await startSession(service, { maxRuntimeMinutes: 60, maxSpendCents: 24, idleTimeoutMinutes: 50, readinessMinutes: 40 });
  clock.advanceMinutes(61);
  const status = await service.pollGpuReadiness(id);

  assert.equal(status.finished, true);
  assert.match(status.detail, /authorised maximum|hard-stop deadline/u);
  const session = (await service.gpuSessions()).find((entry) => entry.id === id)!;
  assert.equal(session.state, "activation-failed");
  assert.equal(session.teardownConfirmed, true);
  assert.ok(session.estimatedCents > 0, "the boot time it did use was billed");
});

test("5. the maximum runtime expiring during boot stops the machine", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 10_000 } });
  const id = await startSession(service, { maxRuntimeMinutes: 20, maxSpendCents: 30, idleTimeoutMinutes: 19, readinessMinutes: 19 });
  clock.advanceMinutes(21);
  const status = await service.pollGpuReadiness(id);

  assert.equal(status.finished, true);
  // The hard stop and the runtime limit are the same instant here; either is a truthful answer and
  // both name a stored deadline rather than a timer.
  assert.match(status.detail, /hard-stop deadline|authorised maximum of 20/u);
  assert.equal((await service.gpuSessions()).find((entry) => entry.id === id)!.teardownConfirmed, true);
});

test("6. an owner stop during readiness is honoured immediately", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 10_000 } });
  const id = await startSession(service, { readinessMinutes: 30 });
  await service.pollGpuReadiness(id);
  clock.advanceMinutes(1);

  const stopped = await service.stopGpuSession(id, "owner stop");
  assert.equal(stopped.state, "activation-failed", "it never became usable, and stopping it does not change that");
  assert.equal(stopped.teardownConfirmed, true);
  assert.ok(stopped.events.some((event) => event.event === "stop-requested" && event.detail === "owner stop"));

  // Polling a stopped session is inert rather than an error, so a loop that was already in flight
  // cannot restart anything.
  const after = await service.pollGpuReadiness(id);
  assert.equal(after.finished, true);
  assert.equal(after.endpointId, null);
});

test("7. a provider that throws is recorded and retried, not treated as fatal", async () => {
  const { service, clock } = await harness({ gpu: { statusFailures: 2, endpointAfterPolls: 0 }, script: { answer: "READY" } });
  const id = await startSession(service, { readinessMinutes: 20 });
  const status = await activate(service, id, clock, 5);

  assert.equal(status.ready, true, "two provider hiccups inside the allowance are survivable");
  const session = (await service.gpuSessions()).find((entry) => entry.id === id)!;
  assert.ok(session.events.some((event) => event.event === "runtime-boot" && /did not answer this check/u.test(event.detail)));
});

test("8. a malformed or unsafe serving address is refused rather than corrected", async () => {
  for (const [address, shape] of [
    ["not a url", /could not parse as an absolute URL/u],
    ["ftp://gpu.invalid/v1", /must be http or https/u],
    ["https://user:secret@gpu.invalid/v1", /credential embedded in it/u],
    ["https://gpu.invalid/v1?api_key=abc123def456", /query string or fragment/u],
    ["http://127.0.0.1:8000/v1", /this computer or this network/u],
    ["http://192.168.1.40:8000/v1", /this computer or this network/u],
    ["http://gpu:8000/v1", /no resolvable host name/u],
  ] as const) {
    assert.throws(() => normaliseServingEndpoint(address), shape, `${address} is refused`);
  }
  assert.deepEqual(normaliseServingEndpoint("https://Host.Example.Net:8443/v1/"), { baseUrl: "https://host.example.net:8443/v1", host: "host.example.net", encrypted: true });

  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 0, endpointUrl: "http://127.0.0.1:8000/v1" } });
  const id = await startSession(service);
  const status = await activate(service, id, clock);
  assert.equal(status.state, "activation-failed");
  assert.match(status.detail, /this computer or this network/u);
  assert.equal((await service.brainSettings()).endpoints.length, 1, "nothing mislabelled as rented capacity entered the Brain");
});

test("9. credential-shaped provider errors are redacted before they reach state", async () => {
  const { service, clock } = await harness({
    gpu: { statusFailures: 99, statusError: "401 from the host, sent key sk-notarealkey-synthetic-fixture" },
  });
  const id = await startSession(service, { readinessMinutes: 3 });
  await activate(service, id, clock, 40);

  const serialized = JSON.stringify(await service.snapshot());
  assert.doesNotMatch(serialized, /sk-notarealkey-synthetic-fixture/u, "no credential value is stored anywhere");
  assert.match(serialized, /\[redacted\]/u, "and the redaction is visible rather than the text silently dropped");
});

test("10. a registration failure tears the machine down instead of billing for nothing", async () => {
  // Identifier generation is a port like any other, and a port can fail. What matters is that the
  // failure ends with the machine stopped rather than running with no endpoint attached to it.
  class RefusingIds implements IdGeneratorV1 {
    private inner = new DeterministicIdGeneratorV1();
    next(kind: string): string {
      if (kind === "endpoint") throw new Error("the identifier service refused");
      return this.inner.next(kind);
    }
  }
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 0 }, ids: new RefusingIds() });
  const id = await startSession(service);
  const status = await activate(service, id, clock);

  assert.equal(status.ready, false);
  assert.equal(status.state, "activation-failed");
  const session = (await service.gpuSessions()).find((entry) => entry.id === id)!;
  assert.equal(session.teardownConfirmed, true, "the machine is stopped even though the failure was AION's own");
  assert.match(session.failureReason ?? "", /identifier service refused/u);
});

test("11. duplicate readiness polling registers exactly one endpoint", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 0 }, script: { answer: "READY" } });
  const id = await startSession(service);

  const concurrent = await Promise.all([service.pollGpuReadiness(id), service.pollGpuReadiness(id), service.pollGpuReadiness(id)]);
  clock.advanceSeconds(5);
  await service.pollGpuReadiness(id);
  await service.pollGpuReadiness(id);

  const settings = await service.brainSettings();
  const rented = settings.endpoints.filter((entry) => entry.rental !== null);
  assert.equal(rented.length, 1, "one rented machine is one endpoint, however many checks ran");
  assert.equal(rented[0]!.rental?.gpuSessionId, id);
  assert.equal(new Set(concurrent.map((entry) => entry.sessionId)).size, 1);
});

test("12. a restart during boot resumes the same session and provisions nothing new", async () => {
  const { service, clock, repository, gpu, runtime } = await harness({ gpu: { endpointAfterPolls: 1 }, script: { answer: "READY" } });
  const id = await startSession(service, { readinessMinutes: 30, maxRuntimeMinutes: 60, idleTimeoutMinutes: 30 });
  await service.pollGpuReadiness(id);
  assert.equal((await service.gpuSessions()).find((entry) => entry.id === id)!.state, "waiting-for-endpoint");
  assert.equal(gpu.startCount, 1);

  clock.advanceMinutes(1);
  const restarted = new AionAssistantV1({
    repository, clock, ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(await mkdtemp(join(tmpdir(), "aion-bridge-restart-"))),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    gpu, brainRuntime: runtime,
  });
  await restarted.startupReconciliation;

  const resumed = (await restarted.gpuSessions()).find((entry) => entry.id === id)!;
  assert.equal(resumed.state, "ready", "it picked up where it left off");
  assert.ok(resumed.endpointId);
  assert.equal(gpu.startCount, 1, "uncertainty about local state is never a reason to rent a second machine");
});

test("13. a restart after the hard stop tears the machine down before anything can route to it", async () => {
  const { service, clock, repository, gpu, runtime } = await harness({ gpu: { endpointAfterPolls: 0 }, script: { answer: "READY" } });
  const id = await startSession(service, { maxRuntimeMinutes: 20, maxSpendCents: 30, idleTimeoutMinutes: 19, readinessMinutes: 10 });
  const ready = await activate(service, id, clock);
  assert.equal(ready.ready, true);

  clock.advanceMinutes(45);
  const restarted = new AionAssistantV1({
    repository, clock, ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(await mkdtemp(join(tmpdir(), "aion-bridge-expired-"))),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    gpu, brainRuntime: runtime,
  });
  await restarted.startupReconciliation;

  const session = (await restarted.gpuSessions()).find((entry) => entry.id === id)!;
  assert.equal(session.state, "stopped");
  assert.equal(session.teardownConfirmed, true);
  assert.equal(session.endpointId, null);
  const settings = await restarted.brainSettings();
  assert.equal(settings.endpoints.some((entry) => entry.rental !== null), false, "the endpoint is gone before anything could route to it");
  assert.equal(settings.primaryEndpointId, OFFLINE_ENDPOINT_ID);
});

test("14. a ready session inside its limits survives a restart with its endpoint intact", async () => {
  const { service, clock, repository, gpu, runtime } = await harness({ gpu: { endpointAfterPolls: 0 }, script: { answer: "READY" } });
  const id = await startSession(service, { maxRuntimeMinutes: 120, maxSpendCents: 60, idleTimeoutMinutes: 90, readinessMinutes: 10 });
  const ready = await activate(service, id, clock);
  const endpointId = ready.endpointId!;

  clock.advanceMinutes(2);
  const restarted = new AionAssistantV1({
    repository, clock, ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(await mkdtemp(join(tmpdir(), "aion-bridge-survive-"))),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    gpu, brainRuntime: runtime,
  });
  await restarted.startupReconciliation;

  const session = (await restarted.gpuSessions()).find((entry) => entry.id === id)!;
  assert.equal(session.state, "ready");
  assert.equal(session.endpointId, endpointId, "the same endpoint, not a replacement");
  assert.equal((await restarted.brainSettings()).endpoints.filter((entry) => entry.rental !== null).length, 1);
  assert.equal(gpu.startCount, 1);
});

test("15. a stopped session's endpoint is gone from the router", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 0 }, script: { answer: "READY" } });
  const id = await startSession(service);
  const ready = await activate(service, id, clock);

  await service.updateBrainSettings({ mode: "manual", manualEndpointId: ready.endpointId! });
  const routed = await service.routeBrain({ workspace: "", needs: ["reasoning"], includesMemory: false, includesWorkOrCustomerInformation: false, contextClasses: ["the conversation"] });
  assert.equal(routed.endpoint?.id, ready.endpointId);
  assert.equal(routed.tier, "owner-gpu");
  assert.match(routed.disclosure!.statement, /rented from synthetic at 24 cents\/hour/u);

  await service.stopGpuSession(id, "owner stop");
  const after = await service.brainSettings();
  assert.equal(after.endpoints.some((entry) => entry.id === ready.endpointId), false);
  assert.equal(after.manualEndpointId, "");
  assert.equal(after.mode, "local-preferred", "manual with nothing chosen is not a configuration AION will invent a replacement for");
  const rerouted = await service.routeBrain({ workspace: "", needs: ["conversation"], includesMemory: false, includesWorkOrCustomerInformation: false, contextClasses: [] });
  assert.equal(rerouted.endpoint?.id, OFFLINE_ENDPOINT_ID, "AION falls back to its own floor, not to a vendor");
});

test("16. an unconfirmed teardown is reported as unconfirmed, and the endpoint still goes", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 0, refuseStop: true }, script: { answer: "READY" } });
  const id = await startSession(service);
  const ready = await activate(service, id, clock);

  const stopped = await service.stopGpuSession(id, "owner stop");
  assert.equal(stopped.state, "failed");
  assert.equal(stopped.teardownConfirmed, false);
  assert.match(stopped.failureReason ?? "", /could not confirm teardown/u);
  assert.equal((await service.brainSettings()).endpoints.some((entry) => entry.id === ready.endpointId), false,
    "a machine AION cannot confirm is gone is a machine nothing should be routed to");
  const recorded = (await service.snapshot()).activity.find((entry) => entry.action === "gpu.stop")!;
  assert.equal(recorded.outcome, "failed");
  assert.match(recorded.summary, /Check the provider console yourself/u);
});

test("17. stopping and endpoint removal are both idempotent", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 0 }, script: { answer: "READY" } });
  const id = await startSession(service);
  const ready = await activate(service, id, clock);

  const first = await service.stopGpuSession(id, "owner stop");
  const second = await service.stopGpuSession(id, "owner stop again");
  assert.equal(second.state, first.state);
  assert.equal(second.stoppedAt, first.stoppedAt, "a second stop does not restate the cost or re-tear-down");
  assert.equal((await service.snapshot()).activity.filter((entry) => entry.action === "gpu.stop").length, 1);
  assert.equal((await service.snapshot()).activity.filter((entry) => entry.action === "gpu.endpoint.remove").length, 1);
  await assert.rejects(() => service.removeBrainEndpoint(ready.endpointId!), /was not found/u);
});

test("18. a rented endpoint is measured by the same harness as the deterministic floor", async () => {
  const { service, clock } = await harness({
    gpu: { endpointAfterPolls: 0 },
    script: { answer: (prompt) => (prompt.includes("READY") ? "READY" : `A scripted answer to: ${prompt.slice(0, 40)}`) },
  });
  const id = await startSession(service, { maxRuntimeMinutes: 120, maxSpendCents: 60, idleTimeoutMinutes: 90 });
  const ready = await activate(service, id, clock);

  const floor = await service.evaluateEndpoint(OFFLINE_ENDPOINT_ID);
  const rented = await service.evaluateEndpoint(ready.endpointId!);
  assert.equal(rented.total, floor.total, "the same fixtures, so the numbers can be compared at all");
  assert.equal(rented.location, "owner-controlled-host");
  assert.equal(floor.isFloor, true);
  assert.equal(rented.isFloor, false);

  const comparison = await service.modelComparison();
  assert.equal(comparison.length, 2);
  assert.ok(comparison.some((entry) => entry.endpointId === ready.endpointId && /case\(s\) against the floor/u.test(entry.versusFloor)));
  const session = (await service.gpuSessions()).find((entry) => entry.id === id)!;
  assert.ok(session.events.some((event) => event.event === "evaluated"), "evaluating counts as using it, so the idle timeout does not stop it mid-benchmark");
  assert.equal(session.state, "in-use");
});

test("19. cost accumulates during boot, and the report says where it went", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 3 }, script: { answer: "READY" } });
  const id = await startSession(service, { maxRuntimeMinutes: 120, maxSpendCents: 60, idleTimeoutMinutes: 90, readinessMinutes: 30 });
  const ready = await activate(service, id, clock, 120);
  assert.equal(ready.ready, true);
  assert.ok(ready.cost.provisioningMinutes >= 4, "the minutes spent waiting for a serving address are counted");

  clock.advanceMinutes(10);
  await service.stopGpuSession(id, "owner stop");
  const session = (await service.gpuSessions()).find((entry) => entry.id === id)!;
  assert.ok(session.cost.servingMinutes >= 10);
  assert.ok(session.cost.totalMinutes >= session.cost.provisioningMinutes + session.cost.servingMinutes - 1);
  assert.ok(session.estimatedCents > 0, "boot time was billed, not written off");
  assert.match(session.cost.note, /Provisioning and model-load time are billable and are included/u);

  const intelligence = await service.costIntelligence();
  assert.equal(intelligence.gpuCents, session.estimatedCents);
});

test("20. the ceiling and the one-shot approval survive the bridge unchanged", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 0 }, script: { answer: "READY" } });
  const found = await service.discoverGpuOffers({ modelId: "mistral-small-24b", maxHourlyCents: 200 });
  const offer = found.recommendations[0]!.offer;
  assert.equal(found.ceilingCents, V13_BUDGET_CEILING_CENTS);

  await assert.rejects(
    () => service.proposeGpuProvisioning({ offer, modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 60, maxSpendCents: 5000, idleTimeoutMinutes: 10 }),
    /ceiling is 1600 cents and this proposal asks for 5000/u,
  );
  await assert.rejects(
    () => service.proposeGpuProvisioning({ offer, modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 60, maxSpendCents: 30, idleTimeoutMinutes: 10, readinessMinutes: 90 }),
    /readiness allowance must be at least a minute and cannot be longer than the maximum runtime/u,
  );

  const proposal = await service.proposeGpuProvisioning({ offer, modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 60, maxSpendCents: 30, idleTimeoutMinutes: 15, readinessMinutes: 10 });
  assert.match(proposal.disclosure, /including up to 10 minutes of paid waiting while the model loads/u);
  await service.decideGpuProposal(proposal.id, true);
  const id = (await service.startGpuSession(proposal.id)).id;
  await assert.rejects(() => service.startGpuSession(proposal.id), /is consumed/u);
  await activate(service, id, clock);

  // A ready endpoint changes nothing about what may be spent next: the ceiling is a milestone
  // limit, not a per-session one, and an existing rented machine does not authorise another.
  await assert.rejects(
    () => service.proposeGpuProvisioning({ offer, modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 600, maxSpendCents: 1700, idleTimeoutMinutes: 10 }),
    /ceiling is 1600 cents/u,
  );
});

test("Local Only will not silently reach for a rented machine when the floor can do the work", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 0 }, script: { answer: "READY" } });
  const id = await startSession(service);
  const ready = await activate(service, id, clock);

  await service.updateBrainSettings({ mode: "local-only" });
  const simple = await service.routeBrain({ workspace: "", needs: ["conversation"], includesMemory: false, includesWorkOrCustomerInformation: false, contextClasses: [] });
  assert.equal(simple.endpoint?.id, OFFLINE_ENDPOINT_ID, "the cheapest tier that can do the work, not the strongest thing present");

  // When the work genuinely needs it, the rented machine is used and the cost is said out loud.
  await service.updateBrainSettings({ primaryEndpointId: OFFLINE_ENDPOINT_ID });
  const demanding = await service.routeBrain({ workspace: "", needs: ["reasoning", "code"], includesMemory: false, includesWorkOrCustomerInformation: false, contextClasses: ["the conversation"] });
  assert.equal(demanding.endpoint?.id, ready.endpointId);
  assert.match(demanding.reason, /a machine you are renting at 24 cents\/hour/u);
  assert.equal(demanding.requiresDisclosure, true, "it is not this computer, and the disclosure says so");
  assert.equal(demanding.requiresApproval, false, "it is infrastructure the owner controls, so it is not a third-party decision");
});

test("offline mode excludes a rented machine even though the owner controls it", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 0 }, script: { answer: "READY" } });
  const id = await startSession(service);
  const ready = await activate(service, id, clock);

  await service.updateBrainSettings({ offlineMode: true });
  const decision = await service.routeBrain({ workspace: "", needs: ["reasoning"], includesMemory: false, includesWorkOrCustomerInformation: false, contextClasses: [] });
  assert.equal(decision.allowed, false);
  assert.ok(decision.considered.some((entry) => entry.id === ready.endpointId && /offline mode is on/u.test(entry.why)));
});

test("context sent to a rented machine is minimised, and five classes never leave at all", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 0 }, script: { answer: "READY" } });
  const id = await startSession(service);
  const ready = await activate(service, id, clock);

  await service.updateBrainSettings({ mode: "manual", manualEndpointId: ready.endpointId! });
  const decision = await service.routeBrain({
    workspace: "", needs: ["reasoning"], includesMemory: true, includesWorkOrCustomerInformation: true,
    contextClasses: ["the conversation", "credential values", "complete relationship records", "recent Memory records"],
  });
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.context?.included, ["the conversation", "recent Memory records"]);
  assert.equal(decision.context?.withheld.length, 2);
  assert.equal(decision.context?.memoryLimit, 8, "an owner-controlled host is capped tighter than this computer");
  assert.match(decision.disclosure!.statement, /it is still not this computer/u);
});

test("removing a rented endpoint removes nothing AION knows", async () => {
  const { service, clock } = await harness({ gpu: { endpointAfterPolls: 0 }, script: { answer: "READY" } });
  const conversation = await service.createConversation("Before renting anything");
  await service.createMemory({ content: "The Founder prefers plain answers.", category: "semantic" });
  const id = await startSession(service);
  await activate(service, id, clock);

  const before = await service.snapshot();
  await service.stopGpuSession(id, "owner stop");
  const after = await service.snapshot();

  assert.equal(after.memories.length, before.memories.length);
  assert.equal(after.conversations.length, before.conversations.length);
  assert.ok(after.conversations.some((entry) => entry.id === conversation.id));
  assert.equal(after.gpuSessions.length, before.gpuSessions.length, "the session record survives; the endpoint does not");
  const removal = after.activity.find((entry) => entry.action === "gpu.endpoint.remove")!;
  assert.match(removal.summary, /Every workspace, Memory record, and piece of evidence is untouched/u);
});

test("every lifecycle state has a word for the owner, and none of them is a guess", () => {
  for (const [state, label] of Object.entries(GPU_STATUS_LABELS)) {
    assert.ok(label.length > 0, `${state} has a label`);
    assert.doesNotMatch(label, /unknown/iu, `${state} is not described as unknown`);
  }
  assert.equal(GPU_STATUS_LABELS.provisioning, "Provisioning");
  assert.equal(GPU_STATUS_LABELS["booting-runtime"], "Starting model");
  assert.equal(GPU_STATUS_LABELS["waiting-for-endpoint"], "Waiting for model");
  assert.equal(GPU_STATUS_LABELS["health-checking"], "Health checking");
  assert.equal(GPU_STATUS_LABELS.ready, "Ready");
  assert.equal(GPU_STATUS_LABELS.stopping, "Stopping");
  assert.equal(GPU_STATUS_LABELS.stopped, "Stopped");
  assert.equal(GPU_STATUS_LABELS["activation-failed"], "Failed");
});

test("without a runtime adapter AION refuses to register anything it cannot verify", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-bridge-noruntime-"));
  const exportRoot = join(root, "exports"); await mkdir(exportRoot);
  const clock = new SteppableClockV1();
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(), clock, ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exportRoot),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    gpu: new SyntheticGpuInfrastructureV1(OFFERS, { endpointAfterPolls: 0 }),
  });
  const id = await startSession(service);
  const status = await service.activateGpuSession(id, { maxPolls: 4, sleep: async () => { clock.advanceSeconds(5); } });

  assert.equal(status.state, "activation-failed");
  assert.match(status.detail, /cannot verify that this machine answers/u);
  assert.equal((await service.brainSettings()).endpoints.length, 1);
  await assert.rejects(() => service.evaluateEndpoint(OFFLINE_ENDPOINT_ID), /No runtime adapter is configured/u);
});
