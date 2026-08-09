#!/usr/bin/env node
/**
 * AION V1.3 independence and research proof.
 *
 * Everything is invented or scripted: a fictional business, a scripted GPU marketplace, a scripted
 * set of web pages served by a stub, and a deterministic clock. No GPU is rented, no money is
 * spent, no model is downloaded, no credential is read, and no real network request is made. The
 * only "provider" that answers is the deterministic offline floor that ships with AION.
 *
 * The thing this demo exists to show is the one that is easy to claim and hard to prove: with
 * every configured model removed and every credential gone, AION still works — and the parts that
 * spend money or reach the internet refuse rather than improvise.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  EVALUATION_SUITE, InMemoryWriterAuthorityV1, InProcessBrainRuntimeV1, LocalEchoCapabilityV1,
  OFFLINE_ENDPOINT_ID, SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1, SyntheticGpuInfrastructureV1, SyntheticVerificationRunnerV1,
  UnavailableGpuInfrastructureV1, V13_BUDGET_CEILING_CENTS, createWriterGrantForTest, scoreCase,
} from "../packages/local-assistant/dist/index.js";
import { PublicUrlResearchProviderV1 } from "./aion/research-fetch.mjs";
import { createAionServer } from "./aion/server.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const BUSINESS = "Quillfeather Labs";     // fictional
const steps = [];
const proved = (label) => { steps.push(label); console.log(`  ok  ${label}`); };
const because = (message) => console.log(`      ${message}`);

/** A scripted GPU marketplace. Prices invented; nothing here is a real offer. */
const OFFERS = [
  { offerRef: "synthetic-cheap", gpuName: "RTX 3090", vramGb: 24, hourlyCents: 22, storageCentsPerHour: 2, reliability: 92, diskGb: 60, verified: true },
  { offerRef: "synthetic-fast", gpuName: "RTX 4090", vramGb: 24, hourlyCents: 38, storageCentsPerHour: 2, reliability: 98, diskGb: 100, verified: true },
  { offerRef: "synthetic-huge", gpuName: "A100", vramGb: 80, hourlyCents: 140, storageCentsPerHour: 5, reliability: 99, diskGb: 200, verified: true },
];

/** A scripted web, served without a socket. Two pages that disagree, on purpose. */
const PAGES = {
  "https://one.invalid/handover": '<html><head><title>Handover survey</title></head><body><p>Structured handover notes reduce missed detail between shifts.</p></body></html>',
  "https://two.invalid/handover": '<html><head><title>Ward study</title></head><body><p>Structured handover notes do not reduce missed detail between shifts.</p></body></html>',
};
const RESOLVER = async () => [{ address: "203.0.113.10", family: 4 }];
/**
 * The scripted web.
 *
 * Loopback passes through to the real transport, because that is the demo talking to its own
 * Command Center. Everything else must be one of the two scripted pages: anything AION tried to
 * reach that is not in the table gets a 404 rather than a real request, so a mistake in this file
 * cannot quietly turn into network traffic.
 */
function stubFetch(url, init) {
  const target = String(url);
  if (target.startsWith("http://127.0.0.1:")) return realFetch(url, init);
  const page = PAGES[target];
  if (!page) return Promise.resolve(new Response("not found", { status: 404, headers: { "content-type": "text/html" } }));
  return Promise.resolve(new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }));
}

async function open(dataRoot, exportRoot, { gpu } = {}) {
  const developerAgents = new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]);
  const offline = new DeterministicModelProviderV1();
  const authority = new InMemoryWriterAuthorityV1(createWriterGrantForTest({ state: "WRITER" }));
  const app = await createAionServer({
    repositoryRoot, dataRoot, exportRoot,
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [offline],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    developerAgents, authority,
    verificationRunner: new SyntheticVerificationRunnerV1(),
    research: new PublicUrlResearchProviderV1({ resolver: RESOLVER, now: () => "2030-01-01T00:00:00.000Z" }),
    // Only the in-process adapter: the demo can evaluate the floor and reaches no address at all.
    brainRuntime: new InProcessBrainRuntimeV1(offline, () => "2030-01-01T00:00:00.000Z"),
    gpu: gpu ?? new UnavailableGpuInfrastructureV1(),
  });
  const address = await app.listen(0);
  assert.equal(address.address, "127.0.0.1", "the Command Center must bind loopback only");
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
  return { app, call, refuse, view };
}

const root = await mkdtemp(join(tmpdir(), "aion-v13-demo-"));
const dataRoot = join(root, "private", "aion");
const exportRoot = join(dataRoot, "exports");
await mkdir(exportRoot, { recursive: true });

const realFetch = globalThis.fetch;
try {
  console.log(`\nAION V1.3 demo — fictional business "${BUSINESS}", scripted marketplace and scripted pages, no network\n`);
  let session = await open(dataRoot, exportRoot);
  await session.call("onboarding.complete");
  const workspace = await session.call("workspace.create", { workspace: { label: BUSINESS } });
  await session.call("settings.update", { settings: { activeWorkspace: workspace.id } });

  // --- The floor has a number ------------------------------------------------------------------
  const floorRun = await session.call("brain.evaluate", { id: OFFLINE_ENDPOINT_ID });
  assert.equal(floorRun.isFloor, true);
  assert.equal(floorRun.total, EVALUATION_SUITE.length);
  assert.equal(floorRun.runtime, "deterministic-offline");
  proved("the deterministic floor is benchmarked in-process, with no endpoint address invented for it");
  because(floorRun.summary);

  const comparison = await session.call("brain.comparison");
  assert.equal(comparison.comparison[0]?.versusFloor, "this is the floor");
  proved("the floor is recorded as the baseline every later model is read against");

  // --- Local runtime and models are prepared, not installed -------------------------------------
  const detected = await session.call("brain.detect");
  const profiles = await session.call("gpu.models");
  assert.ok(profiles.local.length >= 3 && profiles.rented.length >= 4);
  proved(`local runtime detection found ${detected.runtimes.length} runtime(s) at documented loopback addresses; AION installed nothing and downloaded nothing`);
  because(profiles.note);

  // --- Renting is refused without a provider ----------------------------------------------------
  await session.refuse("gpu.discover", { filter: {} }, /rents nothing until you configure one/u);
  proved("with no GPU provider configured AION can rent nothing, and says so rather than failing obscurely");
  await session.app.close();

  // --- With a scripted marketplace: discovery, bounded approval, stop conditions -----------------
  session = await open(dataRoot, exportRoot, { gpu: new SyntheticGpuInfrastructureV1(OFFERS) });
  await session.call("settings.update", { settings: { activeWorkspace: workspace.id } });
  const found = await session.call("gpu.discover", { filter: { modelId: "mistral-small-24b", maxHourlyCents: 200 } });
  assert.equal(found.ceilingCents, V13_BUDGET_CEILING_CENTS);
  assert.ok(found.recommendations.length >= 2);
  assert.equal(found.recommendations[0].offer.offerRef, "synthetic-cheap", "the cheapest machine that fits leads, not the biggest");
  proved("discovery scores capability before price and offers framed experiments, all sized well inside the ceiling");
  because(found.recommendations[0].why);

  // 600 minutes at 24 cents/hour is 240 cents, against a 100-cent limit. AION does the arithmetic
  // itself rather than trusting the two numbers to be consistent.
  const overrun = await session.refuse(
    "gpu.propose",
    { proposal: { offer: found.recommendations[0].offer, modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 600, maxSpendCents: 100, idleTimeoutMinutes: 10 } },
    /could cost 240 cents, above the 100-cent limit/u,
  );
  await session.refuse(
    "gpu.propose",
    { proposal: { offer: found.recommendations[0].offer, modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 30, maxSpendCents: 5000, idleTimeoutMinutes: 10 } },
    /ceiling is 1600 cents and this proposal asks for 5000/u,
  );
  proved("a proposal whose own arithmetic could breach its limit, or the milestone ceiling, is refused before the owner ever sees it");
  because(overrun);

  const proposal = await session.call("gpu.propose", { proposal: { offer: found.recommendations[0].offer, modelId: "mistral-small-24b", runtime: "vllm", maxRuntimeMinutes: 30, maxSpendCents: 30, idleTimeoutMinutes: 10 } });
  await session.refuse("gpu.start", { id: proposal.id }, /needs an approved proposal/u);
  proved("provisioning refuses without an approval, whatever else is true");
  because(proposal.disclosure);

  await session.call("gpu.decide", { id: proposal.id, approve: true });
  const started = await session.call("gpu.start", { id: proposal.id });
  // Provisioning, not running, and no endpoint: the provider has made a machine and nothing has
  // checked whether a model answers on it. Turning that into a usable endpoint is the V1.3-R1
  // demo's subject; what matters here is that AION does not claim it already is one.
  assert.equal(started.state, "provisioning");
  assert.equal(started.endpointId, null);
  assert.ok(Date.parse(started.hardStopAt) > Date.parse(started.startedAt));
  assert.ok(Date.parse(started.activation.deadlineAt) <= Date.parse(started.hardStopAt), "the readiness allowance is stored and never outlives the hard stop");
  await session.refuse("gpu.start", { id: proposal.id }, /is consumed/u);
  proved("an approval is one-shot, and both the readiness allowance and the hard stop are stored rather than held in timers");

  const stopped = await session.call("gpu.stop", { id: started.id, reason: "demo teardown" });
  assert.equal(stopped.teardownConfirmed, true);
  proved("stopping confirms teardown with the provider rather than assuming it");
  await session.app.close();

  // --- Governed live research, against a scripted web -------------------------------------------
  globalThis.fetch = stubFetch;
  session = await open(dataRoot, exportRoot);
  await session.call("settings.update", { settings: { activeWorkspace: workspace.id } });

  await session.refuse(
    "research.propose",
    { job: { question: "the router", scope: "public-web", seedReferences: ["http://192.168.1.1/setup"] } },
    /private, loopback, or link-local/u,
  );
  const metadata = await session.call("research.check-url", { url: "http://169.254.169.254/latest/meta-data/" });
  assert.equal(metadata.allowed, false);
  proved("research refuses your own network and the cloud metadata address before any request is made");

  const job = await session.call("research.propose", { job: { question: "handover notes", scope: "owner-supplied-sources", seedReferences: Object.keys(PAGES) } });
  await session.call("research.approve", { id: job.id });
  const complete = await session.call("research.run", { id: job.id });
  assert.equal(complete.sources.length, 2);
  assert.equal(complete.findings.every((f) => f.class === "observation"), true, "a finding is never a fact");
  proved("an approved job reads the pages the owner named and quotes them, attributed, as observations");

  const analysis = await session.call("research.analyse", { id: job.id });
  assert.equal(analysis.synthesis.confidence, "contested");
  assert.equal(analysis.synthesis.contradictions.length, 1);
  assert.equal(analysis.synthesis.supported.length, 0);
  proved("two sources that disagree are reported as contested; AION does not pick a side");
  because(analysis.synthesis.statement);

  const lesson = await session.call("research.learn", { id: job.id, index: 0 });
  assert.equal(lesson.claim.class, "hypothesis");
  assert.ok(lesson.claim.supportedBy.some((entry) => entry.startsWith("research:")));
  proved("research becomes a typed, sourced lesson and never a fact");

  const opportunity = await session.call("opportunity.create", { opportunity: { title: "Handover notes" } });
  const adopted = await session.call("research.adopt", { id: job.id, findingId: complete.findings[0].id, opportunityId: opportunity.id });
  assert.equal(adopted.claims.at(-1).class, "observation");
  proved("Product Studio consumes a research finding with its provenance intact");
  await session.app.close();
  globalThis.fetch = realFetch;

  // --- Routing, context, and cost ---------------------------------------------------------------
  session = await open(dataRoot, exportRoot);
  await session.call("settings.update", { settings: { activeWorkspace: workspace.id } });
  const gpuEndpoint = await session.call("brain.endpoint.add", { endpoint: {
    label: "Rented GPU", runtime: "vllm", location: "owner-controlled-host", baseUrl: "https://gpu.invalid",
    model: "mistral-small-24b", credentialEnvironmentVariable: "AION_GPU_TOKEN",
    capabilities: { reasoning: true, code: true, structuredJson: true, contextTokens: 32768 },
  } });
  const routed = await session.call("brain.route", { request: {
    workspace: workspace.id, needs: ["reasoning"], includesMemory: true, includesWorkOrCustomerInformation: false,
    contextClasses: ["this conversation", "two Memory records", "complete Memory database", "other workspaces"],
  } });
  assert.equal(routed.tier, "owner-gpu");
  assert.equal(routed.context.memoryLimit, 8);
  assert.deepEqual(routed.context.withheld.map((w) => w.class).sort(), ["complete Memory database", "other workspaces"]);
  proved("routing names its tier, and context minimisation withholds what never leaves this computer");
  because(routed.context.statement);

  const simple = await session.call("brain.route", { request: {
    workspace: workspace.id, needs: ["conversation"], includesMemory: false, includesWorkOrCustomerInformation: false, contextClasses: ["this conversation"],
  } });
  assert.equal(simple.tier, "deterministic-floor", "simple work stays on the floor rather than reaching for the rented machine");
  proved("Local Preferred takes the cheapest and most private tier that can do the work");

  const cost = await session.call("gpu.cost");
  assert.equal(cost.verdict.recommendation, "not-enough-evidence");
  proved("AION refuses to recommend buying hardware without enough measured evidence, and says how much it needs");
  because(cost.verdict.detail);

  // --- The headline: remove every model and see what survives -----------------------------------
  const before = await session.view();
  await session.call("brain.endpoint.remove", { id: gpuEndpoint.id });
  await session.refuse("brain.endpoint.remove", { id: OFFLINE_ENDPOINT_ID }, /cannot be removed/u);
  const after = await session.view();

  assert.equal(after.state.brain.endpoints.length, 1);
  assert.equal(after.independence.independent, true);
  assert.equal(after.state.opportunities.length, before.state.opportunities.length);
  assert.equal(after.state.researchJobs.length, before.state.researchJobs.length);
  assert.equal(after.state.lessons.length, before.state.lessons.length);
  assert.equal(after.state.evaluations.length, before.state.evaluations.length);
  assert.equal(after.state.gpuSessions.length, before.state.gpuSessions.length);
  proved("every configured model is deleted and AION keeps every workspace, opportunity, research job, lesson, benchmark, and GPU record");

  const chat = await session.call("conversation.create", { title: "Still working" });
  const turn = await session.call("chat.send", { id: chat.id, content: "Hello" });
  assert.ok(turn.message.content.length > 0);
  proved("with no model configured and no credential anywhere, AION still starts, still answers, and still remains useful");

  // Content digests are required and are not secrets, so they are excluded before the scan.
  // Everything else key-shaped must be absent: AION stores variable names, never values.
  const serialized = JSON.stringify(after).replace(/"[A-Za-z]*[Dd]igest":"[a-f0-9]{64}"/gu, '"digest":"[content]"');
  assert.doesNotMatch(serialized, /\bsk-[A-Za-z0-9]{8,}|\b[A-Fa-f0-9]{40,}\b/u);
  assert.match(serialized, /AION_GPU_TOKEN/u, "the variable NAME is stored, so the owner can see what AION reads");
  proved("no credential value appears anywhere in state, only the names of environment variables");

  const atClose = await session.view();
  await session.app.close();

  const reopened = await open(dataRoot, exportRoot);
  const reloaded = await reopened.view();
  assert.deepEqual(reloaded.state.workspaces, atClose.state.workspaces);
  assert.deepEqual(reloaded.state.gpuSessions, atClose.state.gpuSessions);
  assert.deepEqual(reloaded.state.evaluations, atClose.state.evaluations);
  assert.equal(reloaded.state.revision, atClose.state.revision, "reopening writes no revision at all");
  assert.equal(reloaded.viewer, "console");
  await reopened.app.close();
  proved("closing and reopening reloads byte-identical state, with the offline floor intact");

  console.log(`\nAION V1.3 demo PASS — ${steps.length} behaviours proved.`);
  console.log(`Fictional business "${BUSINESS}", a scripted GPU marketplace, and two scripted pages that disagree.`);
  console.log("No GPU was rented, no money spent, no model downloaded, no credential read, and no real network request made.\n");
} finally {
  globalThis.fetch = realFetch;
  await rm(root, { recursive: true, force: true });
}
