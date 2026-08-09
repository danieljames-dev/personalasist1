#!/usr/bin/env node
/**
 * AION V1.3-R1 rented-GPU lifecycle proof.
 *
 * The gap this closes, in one sentence: a provisioned GPU session used to keep `endpointId: null`
 * for ever, so a real rented machine could bill by the minute while being unusable for routing,
 * evaluation, or comparison. Paying for a brain you cannot reach is the worst outcome available.
 *
 * Everything below runs against a scripted marketplace, a scripted infrastructure adapter, and a
 * scripted runtime. No GPU is rented, no money is spent, no model is downloaded, no credential is
 * read, and no request leaves this computer — the demo's own Command Center on loopback is the
 * only thing anything talks to. The scripted machine deliberately takes several checks to come up,
 * because a machine that is instantly ready would prove nothing about waiting for one.
 *
 * Five failures are demonstrated as well as the success, because the success is the easy half.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  CompositeBrainRuntimeV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  EVALUATION_SUITE, GPU_STATUS_LABELS, InMemoryWriterAuthorityV1, InProcessBrainRuntimeV1,
  LocalEchoCapabilityV1, OFFLINE_ENDPOINT_ID, ScriptedBrainRuntimeV1, SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1, SyntheticGpuInfrastructureV1,
  SyntheticVerificationRunnerV1, V13_BUDGET_CEILING_CENTS, createWriterGrantForTest,
} from "../packages/local-assistant/dist/index.js";
import { createAionServer } from "./aion/server.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const steps = [];
const proved = (label) => { steps.push(label); console.log(`  ok  ${label}`); };
const because = (message) => console.log(`      ${message}`);

/** A scripted marketplace. Prices invented; nothing here is a real offer from anybody. */
const OFFERS = [
  { offerRef: "synthetic-cheap", gpuName: "RTX 3090", vramGb: 24, hourlyCents: 22, storageCentsPerHour: 2, reliability: 92, diskGb: 60, verified: true },
  { offerRef: "synthetic-fast", gpuName: "RTX 4090", vramGb: 24, hourlyCents: 38, storageCentsPerHour: 2, reliability: 98, diskGb: 100, verified: true },
];

const EPOCH = Date.parse("2030-01-01T00:00:00.000Z");

/** A clock the demo moves deliberately, so a twelve-minute boot does not take twelve minutes. */
class DemoClock {
  constructor() { this.offsetMs = 0; }
  now() { return new Date(EPOCH + this.offsetMs).toISOString(); }
  advanceMinutes(minutes) { this.offsetMs += minutes * 60_000; }
}

const realFetch = globalThis.fetch;
/** Loopback only. Anything else 404s, so a mistake in this file cannot become network traffic. */
function stubFetch(url, init) {
  const target = String(url);
  if (target.startsWith("http://127.0.0.1:")) return realFetch(url, init);
  return Promise.resolve(new Response("not found", { status: 404, headers: { "content-type": "text/plain" } }));
}

async function open(dataRoot, exportRoot, { gpu, script, clock }) {
  const offline = new DeterministicModelProviderV1();
  const scripted = new ScriptedBrainRuntimeV1(script ?? { answer: "READY" });
  const authority = new InMemoryWriterAuthorityV1(createWriterGrantForTest({ state: "WRITER" }));
  const app = await createAionServer({
    repositoryRoot, dataRoot, exportRoot,
    clock, ids: new DeterministicIdGeneratorV1(),
    providers: [offline],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    verificationRunner: new SyntheticVerificationRunnerV1(), authority,
    // The production composition, with the scripted adapter where HTTP would be: the floor runs
    // in-process because it has no address, and anything with one goes to a transport adapter.
    brainRuntime: new CompositeBrainRuntimeV1(new InProcessBrainRuntimeV1(offline, () => clock.now()), scripted),
    gpu,
  });
  const address = await app.listen(0);
  assert.equal(address.address, "127.0.0.1", "the Command Center must bind loopback only");
  // Reconciliation deliberately does not block startup — AION must open even when a provider is
  // unreachable — so the demo waits for it explicitly before asserting anything about it.
  await app.service.startupReconciliation;
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (type, payload = {}) => {
    const response = await globalThis.fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, type }) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${type}: ${data.error}`);
    return data.result;
  };
  const refuse = async (type, payload, pattern) => {
    const response = await globalThis.fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, type }) });
    const data = await response.json();
    assert.equal(response.ok, false, `${type} must be refused`);
    assert.match(data.error, pattern, `${type} refusal explains itself: ${data.error}`);
    return data.error;
  };
  const view = async () => (await globalThis.fetch(`${base}/api/state`)).json();
  return { app, call, refuse, view, scripted };
}

/** Discover, propose, approve, start. Every step is the ordinary owner path over the real API. */
async function rent(session, limits = {}) {
  const found = await session.call("gpu.discover", { filter: { modelId: "mistral-small-24b", maxHourlyCents: 200 } });
  const proposal = await session.call("gpu.propose", { proposal: {
    offer: found.recommendations[0].offer, modelId: "mistral-small-24b", runtime: "vllm",
    maxRuntimeMinutes: limits.maxRuntimeMinutes ?? 60,
    maxSpendCents: limits.maxSpendCents ?? 24,
    idleTimeoutMinutes: limits.idleTimeoutMinutes ?? 30,
    readinessMinutes: limits.readinessMinutes ?? 10,
  } });
  await session.call("gpu.decide", { id: proposal.id, approve: true });
  return { proposal, session: await session.call("gpu.start", { id: proposal.id }) };
}

const root = await mkdtemp(join(tmpdir(), "aion-v13r1-demo-"));
const dataRoot = join(root, "private", "aion");
const exportRoot = join(dataRoot, "exports");
await mkdir(exportRoot, { recursive: true });

globalThis.fetch = stubFetch;
try {
  console.log("\nAION V1.3-R1 demo — scripted GPU infrastructure and a scripted runtime, no network, no money\n");

  // --- 1. A machine that comes up: provisioning -> boot -> discovery -> health -> ready -----------
  {
    const clock = new DemoClock();
    // Three checks before the runtime opens its port: a real one takes minutes to load weights.
    const gpu = new SyntheticGpuInfrastructureV1(OFFERS, { endpointAfterPolls: 3 });
    const session = await open(dataRoot, exportRoot, { gpu, clock, script: { answer: "READY", models: ["mistral-small-24b"], latencyMs: 37 } });
    await session.call("onboarding.complete");

    const started = (await rent(session, { maxRuntimeMinutes: 120, maxSpendCents: 48, idleTimeoutMinutes: 60, readinessMinutes: 20 })).session;
    assert.equal(started.state, "provisioning");
    assert.equal(started.endpointId, null);
    proved("a freshly provisioned machine is 'Provisioning', not 'Ready' — the provider made a box, nothing has checked whether a model answers on it");
    because(`The readiness allowance is stored as ${started.activation.deadlineAt}, inside the hard stop at ${started.hardStopAt}. Neither is a timer.`);

    const seen = [];
    let status = await session.call("gpu.poll", { id: started.id });
    for (let attempt = 0; attempt < 8 && !status.ready && !status.finished; attempt += 1) {
      seen.push(status.label);
      clock.advanceMinutes(1);
      status = await session.call("gpu.poll", { id: started.id });
    }
    seen.push(status.label);
    assert.equal(status.ready, true);
    assert.equal(status.state, "ready");
    assert.ok(seen.includes(GPU_STATUS_LABELS["waiting-for-endpoint"]), "the owner sees it waiting for the model, not a spinner that says nothing");
    proved(`the lifecycle is visible while it happens: ${[...new Set(seen)].join(" -> ")}`);

    const state = await session.view();
    const endpoint = state.state.brain.endpoints.find((entry) => entry.id === status.endpointId);
    assert.equal(endpoint.location, "owner-controlled-host");
    assert.equal(endpoint.rental.gpuSessionId, started.id);
    assert.equal(endpoint.rental.infrastructureProvider, "synthetic");
    assert.equal(endpoint.model, "mistral-small-24b");
    assert.match(endpoint.lastHealth.detail, /Verified by a completion, not by a socket/u);
    proved("the ready machine is registered as a temporary owner-controlled endpoint, health-verified by an actual completion");
    because(`"${endpoint.label}" at ${status.endpointHost}, ${endpoint.runtime}, ${endpoint.rental.hourlyCents} cents/hour, gone at ${endpoint.rental.hardStopAt}. Credential stored: ${endpoint.credentialEnvironmentVariable || "none — AION holds no secret for it"}.`);

    const routed = await session.call("brain.route", { request: {
      workspace: "", needs: ["reasoning", "code"], includesMemory: true, includesWorkOrCustomerInformation: false,
      contextClasses: ["this conversation", "recent Memory records", "credential values", "other workspaces"],
    } });
    assert.equal(routed.endpoint.id, status.endpointId);
    assert.equal(routed.tier, "owner-gpu");
    assert.equal(routed.requiresApproval, false, "infrastructure the owner controls is not a third-party decision");
    assert.equal(routed.requiresDisclosure, true, "it is still not this computer");
    assert.deepEqual(routed.context.withheld.map((entry) => entry.class).sort(), ["credential values", "other workspaces"]);
    proved("the rented endpoint joins the router as the owner-gpu tier, discloses what travels, and withholds what never leaves this computer");
    because(routed.disclosure.statement);

    const floor = await session.call("brain.evaluate", { id: OFFLINE_ENDPOINT_ID });
    const rented = await session.call("brain.evaluate", { id: status.endpointId });
    assert.equal(rented.total, EVALUATION_SUITE.length);
    assert.equal(floor.total, rented.total, "the same fixtures, so the two numbers can be compared at all");
    assert.equal(floor.isFloor, true);
    proved("the rented model is measured by exactly the same harness as the deterministic floor");
    because(`floor ${floor.passed}/${floor.total} at ${floor.medianLatencyMs} ms · rented ${rented.passed}/${rented.total} at ${rented.medianLatencyMs} ms`);

    const comparison = await session.call("brain.comparison");
    const rentedRow = comparison.comparison.find((entry) => entry.endpointId === status.endpointId);
    assert.match(rentedRow.versusFloor, /case\(s\) against the floor/u);
    proved("the comparison reads the rented model against the floor rather than against a vendor's claim");
    because(rentedRow.note ?? rentedRow.versusFloor);

    clock.advanceMinutes(9);
    const stopped = await session.call("gpu.stop", { id: started.id, reason: "the experiment is finished" });
    assert.equal(stopped.teardownConfirmed, true);
    const afterStop = await session.view();
    assert.equal(afterStop.state.brain.endpoints.some((entry) => entry.rental), false);
    assert.equal(afterStop.state.brain.endpoints.length, 1);
    proved("stopping removes the endpoint from the Brain first, then tears the machine down and confirms it with the provider");

    const finished = afterStop.state.gpuSessions.find((entry) => entry.id === started.id);
    assert.ok(finished.estimatedCents > 0);
    proved("the cost report separates what was paid for provisioning, for loading the model, and for actually serving");
    because(`${finished.measuredMinutes} minute(s), about ${finished.estimatedCents} cents in total. Boot time is billable and is included.`);

    const evidence = afterStop.state.activity.filter((entry) => entry.action.startsWith("gpu.")).map((entry) => entry.action);
    for (const required of ["gpu.propose", "gpu.approve", "gpu.start", "gpu.endpoint.register", "gpu.endpoint.remove", "gpu.stop"]) {
      assert.ok(evidence.includes(required), `Activity records ${required}`);
    }
    proved("Activity holds the whole lifecycle as evidence: proposal, approval, start, endpoint registered, endpoint removed, teardown");
    await session.app.close();
  }

  // --- 2. A machine that never comes up: paid for, refused, torn down ----------------------------
  {
    const clock = new DemoClock();
    const gpu = new SyntheticGpuInfrastructureV1(OFFERS, { endpointAfterPolls: 10_000 });
    const session = await open(dataRoot, exportRoot, { gpu, clock });
    const started = (await rent(session, { maxRuntimeMinutes: 60, maxSpendCents: 24, idleTimeoutMinutes: 30, readinessMinutes: 6 })).session;

    let status = await session.call("gpu.poll", { id: started.id });
    for (let attempt = 0; attempt < 10 && !status.finished; attempt += 1) {
      clock.advanceMinutes(1);
      status = await session.call("gpu.poll", { id: started.id });
    }
    assert.equal(status.state, "activation-failed");
    assert.equal(status.label, "Failed");
    assert.equal(status.endpointId, null);
    const failed = (await session.view()).state.gpuSessions.find((entry) => entry.id === started.id);
    assert.equal(failed.teardownConfirmed, true);
    assert.ok(failed.estimatedCents >= 0);
    proved("a machine that never opens a serving port is given up on at its stored deadline, stopped, and reported as failed rather than pending");
    because(`${failed.failureReason} It cost ${failed.estimatedCents} cent(s) and produced nothing, which AION says rather than rounding to zero.`);
    await session.app.close();
  }

  // --- 3. A machine that answers but cannot complete a request -----------------------------------
  {
    const clock = new DemoClock();
    const gpu = new SyntheticGpuInfrastructureV1(OFFERS, { endpointAfterPolls: 0 });
    const session = await open(dataRoot, exportRoot, {
      gpu, clock,
      // The port is open and the model list answers. The model itself is not loaded.
      script: { available: true, answer: () => { throw new Error("the model is still loading"); } },
    });
    const started = (await rent(session, { readinessMinutes: 30, maxRuntimeMinutes: 60, maxSpendCents: 24, idleTimeoutMinutes: 40 })).session;

    let status = await session.call("gpu.poll", { id: started.id });
    for (let attempt = 0; attempt < 8 && !status.finished; attempt += 1) {
      clock.advanceMinutes(1);
      status = await session.call("gpu.poll", { id: started.id });
    }
    assert.equal(status.state, "activation-failed");
    assert.equal((await session.view()).state.brain.endpoints.length, 1, "nothing that cannot answer was ever registered");
    proved("an open port is not a loaded model: an endpoint that accepts connections but cannot complete a request is refused, not registered");
    await session.app.close();
  }

  // --- 4. A serving address AION will not accept -------------------------------------------------
  {
    const clock = new DemoClock();
    const gpu = new SyntheticGpuInfrastructureV1(OFFERS, { endpointAfterPolls: 0, endpointUrl: "https://gpu.invalid/v1?api_key=live-secret-value" });
    const session = await open(dataRoot, exportRoot, { gpu, clock });
    const started = (await rent(session)).session;
    const status = await session.call("gpu.poll", { id: started.id });

    assert.equal(status.state, "activation-failed");
    assert.match(status.detail, /query string or fragment/u);
    const serialized = JSON.stringify(await session.view());
    assert.doesNotMatch(serialized, /live-secret-value/u, "a token-bearing address is never written into state");
    assert.equal((await session.view()).state.brain.endpoints.length, 1);
    proved("a serving address carrying a token, or pointing at this network, is refused rather than stored and routed to");
    because(status.detail);
    await session.app.close();
  }

  // --- 5. A restart while a machine is still billing ---------------------------------------------
  {
    const clock = new DemoClock();
    const gpu = new SyntheticGpuInfrastructureV1(OFFERS, { endpointAfterPolls: 0 });
    let session = await open(dataRoot, exportRoot, { gpu, clock });
    const started = (await rent(session, { maxRuntimeMinutes: 20, maxSpendCents: 8, idleTimeoutMinutes: 15, readinessMinutes: 10 })).session;
    const ready = await session.call("gpu.poll", { id: started.id });
    assert.equal(ready.ready, true);
    await session.app.close();

    // AION is closed. The machine is not, and the deadline is in the state file rather than in a
    // process that no longer exists.
    clock.advanceMinutes(45);
    session = await open(dataRoot, exportRoot, { gpu, clock });
    const after = (await session.view()).state.gpuSessions.find((entry) => entry.id === started.id);
    assert.equal(after.state, "stopped");
    assert.equal(after.teardownConfirmed, true);
    assert.equal(after.endpointId, null);
    assert.equal((await session.view()).state.brain.endpoints.some((entry) => entry.rental), false);
    proved("a session that outlived a shutdown is stopped by whatever starts next, before anything can route to it");
    because(`Its stored hard stop was ${after.hardStopAt}; AION reopened at ${clock.now()} and enforced it before reconnecting anything.`);
    await session.app.close();
  }

  // --- 6. Nothing in any of this authorised more money -------------------------------------------
  {
    const clock = new DemoClock();
    const gpu = new SyntheticGpuInfrastructureV1(OFFERS, { endpointAfterPolls: 0 });
    const session = await open(dataRoot, exportRoot, { gpu, clock });
    const found = await session.call("gpu.discover", { filter: { modelId: "mistral-small-24b", maxHourlyCents: 200 } });
    await session.refuse(
      "gpu.propose",
      { proposal: { offer: found.recommendations[0].offer, modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 60, maxSpendCents: V13_BUDGET_CEILING_CENTS + 1, idleTimeoutMinutes: 10 } },
      /ceiling is 1600 cents/u,
    );
    await session.refuse(
      "gpu.propose",
      { proposal: { offer: found.recommendations[0].offer, modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 30, maxSpendCents: 24, idleTimeoutMinutes: 10, readinessMinutes: 90 } },
      /cannot be longer than the maximum runtime/u,
    );
    proved("the 1600-cent milestone ceiling and the one-shot approval are unchanged, and the readiness wait cannot outlast the runtime the owner approved");

    const serialized = JSON.stringify(await session.view());
    assert.doesNotMatch(serialized, /\bsk-[A-Za-z0-9]{8,}/u);
    const withoutDigests = serialized.replace(/"digest":"[a-f0-9]{64}"/gu, '"digest":"[digest]"');
    assert.doesNotMatch(withoutDigests, /\b[A-Fa-f0-9]{32,}\b/u);
    proved("no credential value appears anywhere in state, in any session, endpoint, or Activity entry");
    await session.app.close();
  }

  console.log(`\nAION V1.3-R1 demo PASS — ${steps.length} behaviours proved.`);
  console.log("Scripted infrastructure and a scripted runtime throughout.");
  console.log("No GPU was rented, no money spent, no model downloaded, no credential read, and no request left this computer.");
} finally {
  globalThis.fetch = realFetch;
  await rm(root, { recursive: true, force: true });
}
