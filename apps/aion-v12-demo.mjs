#!/usr/bin/env node
/**
 * Complete AION V1.2 synthetic proof.
 *
 * Everything below is invented: a fictional side business, a fictional supplier, a fictional
 * product idea, and a scripted research corpus, all created in a temporary directory and removed
 * afterwards. There is no owner content, no employer system, no real market research, no external
 * account, no live model, no GPU, and no network call of any kind. The scenario is driven through
 * the real loopback Command Center HTTP API, so what is proved is the product surface rather than
 * a set of function calls.
 *
 * What this demo is for: showing that the independence claim is a property and not a slogan. The
 * headline moment is near the end, where every configured endpoint that is not the built-in
 * offline provider is deleted and AION is shown still holding everything it knows.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  DeveloperAgentCapabilityV1, LocalEchoCapabilityV1, SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1, SyntheticBuildPipelineV1, SyntheticDeveloperAgentBridgeV1,
  SyntheticResearchProviderV1, SyntheticVerificationRunnerV1, VerificationCapabilityV1,
} from "../packages/local-assistant/dist/index.js";
import { createAionServer } from "./aion/server.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const BUSINESS = "Harbourline Goods";        // fictional
const SUPPLIER = "Ridgeway Supply";          // fictional
const steps = [];
const proved = (label) => { steps.push(label); console.log(`  ok  ${label}`); };
/** Prints a refusal in AION's own words, so the evidence is what it said rather than a paraphrase. */
const because = (message) => console.log(`      ${message}`);

/** A scripted research corpus. Reserved `.invalid` names; the provider opens no socket. */
const CORPUS = {
  "https://example.invalid/handover-study": {
    title: "Handover practices in small clinics",
    body: "A survey of handover practices found that verbal handover loses detail between shifts.",
  },
};

async function open(dataRoot, exportRoot) {
  const developerAgents = new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]);
  const verificationRunner = new SyntheticVerificationRunnerV1();
  const app = await createAionServer({
    repositoryRoot, dataRoot, exportRoot,
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1(), new DeveloperAgentCapabilityV1(developerAgents, repositoryRoot), new VerificationCapabilityV1(verificationRunner)]),
    developerAgents, verificationRunner,
    research: new SyntheticResearchProviderV1(CORPUS),
    pipeline: new SyntheticBuildPipelineV1(),
    // The brain runtime is never reached in this demo: no endpoint is probed and no completion is
    // requested, so nothing here can open a socket even by accident.
    brainRuntime: {
      supports: () => false,
      probe: async () => { throw new Error("the demo never probes an endpoint"); },
      detect: async () => [],
      complete: async () => { throw new Error("the demo never runs a completion"); },
    },
  });
  const address = await app.listen(0);
  assert.equal(address.address, "127.0.0.1", "the Command Center must bind loopback only");
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (type, payload = {}) => {
    const response = await fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, type }) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${type}: ${data.error}`);
    return data.result;
  };
  const refuse = async (type, payload, pattern) => {
    const response = await fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, type }) });
    const data = await response.json();
    assert.equal(response.ok, false, `${type} must be refused`);
    assert.match(data.error, pattern, `${type} refusal explains itself: ${data.error}`);
    return data.error;
  };
  const view = async () => (await fetch(`${base}/api/state`)).json();
  return { app, call, refuse, view };
}

const root = await mkdtemp(join(tmpdir(), "aion-v12-demo-"));
const dataRoot = join(root, "private", "aion");
const exportRoot = join(dataRoot, "exports");
await mkdir(exportRoot, { recursive: true });

try {
  console.log(`\nAION V1.2 demo — fictional business "${BUSINESS}", scripted sources, no network\n`);
  const { app, call, refuse, view } = await open(dataRoot, exportRoot);

  // --- Workspaces --------------------------------------------------------------------------
  await call("onboarding.complete");
  const workspace = await call("workspace.create", { workspace: { label: BUSINESS, purpose: "A small side business.", brand: { name: "Harbourline", positioning: "Durable everyday carry", audience: "commuters" } } });
  assert.equal(workspace.kind, "business");
  proved("a business workspace is created alongside Personal and Work, with an owner-supplied brand identity");

  await call("settings.update", { settings: { activeWorkspace: "work" } });
  await call("customer.create", { customer: { displayName: "A work prospect" } });
  await call("settings.update", { settings: { activeWorkspace: workspace.id } });
  const fresh = await call("relationship.find", { query: { kind: "all" } });
  assert.deepEqual(fresh.relationships, []);
  proved("a new workspace starts genuinely empty: nothing is copied into it from Personal or Work");

  const supplier = await call("relationship.create", { relationship: { displayName: SUPPLIER, relationshipType: "vendor", organisation: "Ridgeway", role: "account manager" } });
  assert.equal(supplier.origin, "owner-created", "a record the owner made for their own business is theirs");
  await refuse("customer.update", { id: supplier.id, change: { notes: "reached across" } }, /different workspace|Work workspace/iu);
  proved("the Relationship Core serves a vendor as readily as a customer, and still refuses across a workspace boundary");

  await refuse("relationship.create", { relationship: { displayName: "Someone", ssn: "000-00-0000" } }, /identity, credit, banking, or financing/iu);
  await refuse("relationship.create", { relationship: { displayName: "Someone", notes: "card 4111 1111 1111 1111" } }, /payment-card-length number/iu);
  proved("identity and payment material is refused by field name and by value shape, in every workspace");

  // --- Product Studio ----------------------------------------------------------------------
  const opportunity = await call("opportunity.create", { opportunity: {
    title: "Shift-handover notes for small clinics",
    problem: "Handover happens verbally and details are lost between shifts.",
    problemSeverity: 8, reachability: 5, ownerAdvantage: 6, effort: 6,
  } });
  const empty = await call("opportunity.assess", { id: opportunity.id });
  assert.equal(empty.score.total, 0);
  assert.match(empty.caution, /AION did not gather market evidence for this and cannot/u);
  proved("a confident-sounding opportunity with nothing behind it scores zero and says why");

  await call("opportunity.claim", { id: opportunity.id, claim: { class: "assumption", statement: "Clinics would pay for this." } });
  await call("opportunity.claim", { id: opportunity.id, claim: { class: "hypothesis", statement: "Handover errors cause repeat appointments." } });
  await call("opportunity.update", { id: opportunity.id, change: { problem: "Handover happens verbally and important details are repeatedly lost between shifts." } });
  assert.equal((await call("opportunity.assess", { id: opportunity.id })).score.total, 0);
  proved("rewording the problem statement does not raise the score; only confirming a claim does");

  await refuse("opportunity.claim", { id: opportunity.id, claim: { class: "observation", statement: "Everyone hates handover." } }, /must cite what it rests on/iu);
  proved("a class that only means something with a citation cannot be recorded without one");

  // --- Governed research -------------------------------------------------------------------
  const job = await call("research.propose", { job: { question: "handover", scope: "owner-supplied-sources", seedReferences: ["https://example.invalid/handover-study"] } });
  assert.equal(job.state, "proposed");
  await refuse("research.run", { id: job.id }, /must be approved before it runs/iu);
  proved("proposing research runs nothing: a job waits for an approval like any other consequential action");

  await refuse("research.propose", { job: { question: "the router admin page", scope: "public-web", seedReferences: ["http://192.168.1.1/setup"] } }, /private, loopback, or link-local/iu);
  const verdict = await call("research.check-url", { url: "http://169.254.169.254/latest/meta-data/" });
  assert.equal(verdict.allowed, false);
  proved("the URL guard refuses your own network and the cloud metadata address before any request is made");
  because(verdict.reason);

  await call("research.approve", { id: job.id });
  const completed = await call("research.run", { id: job.id });
  assert.equal(completed.findings.length, 1);
  assert.equal(completed.findings[0].class, "observation");
  proved("a completed research job cites the source it actually retrieved, and its finding is an observation rather than a fact");

  const adopted = await call("research.adopt", { id: job.id, findingId: completed.findings[0].id, opportunityId: opportunity.id });
  const carried = adopted.claims.at(-1);
  assert.equal(carried.class, "observation");
  assert.ok(carried.supportedBy.includes(`research:${job.id}`));
  proved("carrying a finding into Product Studio produces a typed claim with its sources, not a fact");

  const promoted = await call("opportunity.claim.promote", { id: opportunity.id, claimId: carried.id, to: "fact", reason: "I read the source myself." });
  const raised = await call("opportunity.assess", { id: opportunity.id });
  assert.ok(raised.score.total > 0);
  assert.equal(promoted.claims.find((c) => c.id === carried.id).promotions.length, 1);
  proved("the owner promoting a checked claim is what moves the score, and the previous class stays in its history");

  // --- Product Studio linkage ------------------------------------------------------------------
  const studioTask = await call("task.create", { task: { title: "Draft the handover note format" } });
  const studioPlan = await call("plan.create", { goal: "Validate the handover note", steps: [{ title: "Ask five clinics" }] });
  const withTask = await call("opportunity.task.link", { id: opportunity.id, taskId: studioTask.id });
  const withBoth = await call("opportunity.plan.link", { id: opportunity.id, planId: studioPlan.id });
  assert.deepEqual(withTask.taskIds, [studioTask.id]);
  assert.deepEqual(withBoth.planIds, [studioPlan.id]);
  const twice = await call("opportunity.task.link", { id: opportunity.id, taskId: studioTask.id });
  assert.deepEqual(twice.taskIds, [studioTask.id], "linking twice does not accumulate a duplicate");
  proved("an opportunity links to a Task and a Plan, and linking twice adds nothing");

  await refuse("opportunity.update", { id: opportunity.id, change: { taskIds: [studioTask.id] } }, /unexpected field/iu);
  await refuse("opportunity.task.link", { id: opportunity.id, taskId: "no-such-task" }, /was not found/iu);
  proved("the generic editor still refuses to write taskIds, and a reference that does not resolve is refused");

  // A task that genuinely exists, in a workspace this opportunity cannot reach.
  await call("settings.update", { settings: { activeWorkspace: "work" } });
  const workTask = await call("task.create", { task: { title: "A task that belongs to Work" } });
  await call("settings.update", { settings: { activeWorkspace: workspace.id } });
  const crossed = await refuse("opportunity.task.link", { id: opportunity.id, taskId: workTask.id }, /different workspace/iu);
  const unchanged = await call("opportunity.assess", { id: opportunity.id });
  assert.deepEqual(unchanged.opportunity.taskIds, [studioTask.id], "the refused link changed nothing");
  proved("a cross-workspace link is refused and leaves the opportunity exactly as it was");
  because(crossed);

  await call("task.transition", { id: studioTask.id, state: "completed", reason: "Format agreed." });
  const afterCompletion = await call("opportunity.assess", { id: opportunity.id });
  assert.deepEqual(afterCompletion.opportunity.taskIds, [studioTask.id], "completing work does not erase the link");
  assert.equal(afterCompletion.linkedWork.tasks.completed, 1);
  proved("a linked Task stays linked once completed: a link is a durable historical reference");
  because(afterCompletion.linkedWork.summary);

  // --- The model-independent brain -----------------------------------------------------------
  const before = await view();
  assert.equal(before.state.brain.mode, "local-preferred");
  assert.equal(before.state.brain.remoteFallbackEnabled, false);
  assert.equal(before.independence.independent, true);
  proved("AION starts model-independent: local preferred, remote proprietary fallback off, and an offline floor that cannot be removed");

  const gpu = await call("brain.endpoint.add", { endpoint: {
    label: "Rented GPU", runtime: "vllm", location: "owner-controlled-host",
    baseUrl: "https://gpu.invalid", model: "open-weights-large", hostLabel: "rented hourly",
    credentialEnvironmentVariable: "AION_GPU_TOKEN",
    capabilities: { reasoning: true, code: true, structuredJson: true, contextTokens: 65536 },
  } });
  const vendor = await call("brain.endpoint.add", { endpoint: {
    label: "A vendor API", runtime: "openai-compatible", location: "third-party-service",
    baseUrl: "https://api.invalid", model: "some-large-model",
    capabilities: { reasoning: true, code: true, structuredJson: true, toolProposal: true, vision: true, embeddings: true, contextTokens: 1000000 },
  } });
  const serialized = JSON.stringify(await view());
  assert.ok(serialized.includes("AION_GPU_TOKEN"), "the variable name is stored so you can see what AION reads");
  proved("an owner-rented GPU is a first-class endpoint, and AION stores the name of a credential variable rather than any value");

  const maximum = await call("brain.route", { request: { workspace: workspace.id, needs: ["reasoning"], includesMemory: false, includesWorkOrCustomerInformation: false, contextClasses: ["this conversation"] } });
  assert.equal(maximum.endpoint.id, gpu.id);
  await call("brain.settings", { change: { mode: "maximum-capability" } });
  const preferred = await call("brain.route", { request: { workspace: workspace.id, needs: ["reasoning"], includesMemory: false, includesWorkOrCustomerInformation: false, contextClasses: ["this conversation"] } });
  assert.equal(preferred.endpoint.id, gpu.id, "the vendor scores higher, but fallback is off");
  assert.match(preferred.reason, /remote proprietary fallback is off/u);
  proved("Maximum Capability prefers the strongest endpoint you control, and never treats a capability preference as consent to send context out");

  await call("brain.settings", { change: { remoteFallbackEnabled: true } });
  const offered = await call("brain.route", { request: { workspace: workspace.id, needs: ["vision"], includesMemory: true, includesWorkOrCustomerInformation: false, contextClasses: ["this conversation", "two Memory records"] } });
  assert.equal(offered.endpoint.id, vendor.id);
  assert.equal(offered.requiresApproval, true);
  assert.match(offered.disclosure.statement, /may retain, log, or train on what it receives/u);
  assert.match(offered.disclosure.statement, /Your Memory records are included/u);
  proved("reaching a third-party endpoint always discloses the destination, the workspace, and whether Memory is included, and still needs approval");

  await call("brain.settings", { change: { mode: "local-only", remoteFallbackEnabled: false } });
  const localOnly = await call("brain.route", { request: { workspace: workspace.id, needs: ["vision"], includesMemory: false, includesWorkOrCustomerInformation: false, contextClasses: [] } });
  assert.equal(localOnly.allowed, false);
  await call("brain.settings", { change: { mode: "local-preferred", offlineMode: true } });
  const offline = await call("brain.route", { request: { workspace: workspace.id, needs: ["reasoning"], includesMemory: false, includesWorkOrCustomerInformation: false, contextClasses: [] } });
  assert.equal(offline.allowed, false);
  assert.match(offline.reason, /will not reach out to complete it/u);
  proved("Local Only refuses a third party outright, and offline mode refuses even the owner's own rented GPU");

  // --- Learning ----------------------------------------------------------------------------
  await call("brain.settings", { change: { offlineMode: false } });
  const lesson = await call("lesson.record", { lesson: { statement: "Confirming a delivery date in writing prevents a chased email later.", supportedBy: ["own-records"], guidance: "Always confirm in writing." } });
  await call("lesson.outcome", { id: lesson.id, outcome: { result: "worked" } });
  const weak = await call("lesson.record", { lesson: { statement: "Cold emails on Mondays work best.", supportedBy: ["a-hunch"] } });
  for (const _ of [0, 1, 2]) await call("lesson.outcome", { id: weak.id, outcome: { result: "did-not-work" } });
  const offered2 = await call("lesson.list");
  assert.deepEqual(offered2.lessons.map((l) => l.id), [lesson.id]);
  proved("a lesson that has failed more often than it has worked stops being offered, and is kept rather than deleted");

  // --- Development projects -------------------------------------------------------------------
  const project = await call("project.create", { project: { title: "Handover note app", summary: "A shared handover note.", opportunityId: opportunity.id } });
  await call("project.specify", { id: project.id, specification: { problem: "Handover detail is lost between shifts.", acceptance: ["A note can be written and read."] } });
  await call("project.advance", { id: project.id, stage: "specification", reason: "Specification written." });
  await call("project.plan", { id: project.id, steps: ["Sketch the note format", "Build the form", "Test with two people"] });
  await call("project.advance", { id: project.id, stage: "plan", reason: "Plan drafted." });
  await call("project.advance", { id: project.id, stage: "tasks", reason: "Steps agreed." });
  await call("project.proposal", { id: project.id, proposal: { summary: "Add the note form and a test.", mode: "workspace-write" } });
  await refuse("project.advance", { id: project.id, stage: "implementation", reason: "the agent says it is ready" }, /No agent raises its own authority/u);
  proved("a developer agent may propose a change to a project and can never authorise it");

  await call("project.approve", { id: project.id, stage: "implementation", note: "Reviewed the proposal myself." });
  await call("project.advance", { id: project.id, stage: "implementation", reason: "Approved." });
  await call("project.step", { id: project.id, step: "build" });
  await call("project.advance", { id: project.id, stage: "verification", reason: "Built." });
  await refuse("project.advance", { id: project.id, stage: "review", reason: "looks right" }, /Review rests on evidence/u);
  await call("project.step", { id: project.id, step: "test" });
  await call("project.advance", { id: project.id, stage: "review", reason: "Tests ran." });
  await call("project.step", { id: project.id, step: "preview" });
  const previewed = await call("project.advance", { id: project.id, stage: "preview", reason: "Preview built." });
  assert.match(previewed.runs.find((r) => r.step === "preview").previewUrl, /^http:\/\/127\.0\.0\.1/u);
  proved("a review needs evidence behind it, a preview needs something that actually built, and a preview is reachable from this computer only");

  await call("project.advance", { id: project.id, stage: "owner-approved", reason: "Looks right to me." });
  await call("project.deployment", { id: project.id, deployment: { target: "a public host", summary: "Put it where the clinic can use it.", consequences: "Anyone with the address could read notes. This cannot be undone once seen." } });
  await call("project.approve", { id: project.id, stage: "deployed", note: "I accept the consequences." });
  const denied = await refuse("project.advance", { id: project.id, stage: "deployed", reason: "go" }, /AION cannot deploy/u);
  proved("AION cannot deploy: it prepares and records a deployment, and then refuses to perform one");
  because(denied);

  // --- The command router -----------------------------------------------------------------
  const routed = await call("command.route", { text: "Run the AION verification suite and have Claude analyze the result." });
  assert.deepEqual(routed.proposals.map((p) => p.intent), ["verification", "developer-task"]);
  assert.deepEqual(routed.proposals[0].payload, { capabilityId: "aion.verify.run.v1", input: { operationId: "npm.verify" } });
  assert.equal(routed.proposals[1].payload.input.mode, "read-only");
  proved("an ordinary sentence resolves to typed proposals: a verification chosen by identifier, and a read-only developer task");

  await refuse("command.route", { text: "add a task: rm -rf / && echo done" }, /shell-shaped text/u);
  const ambiguous = await call("command.route", { text: "I need to research the market for handover tools" });
  assert.deepEqual(ambiguous.proposals, []);
  assert.match(ambiguous.clarification.question, /will not guess/u);
  proved("natural language never becomes shell syntax, and a genuinely ambiguous sentence produces a question rather than a guess");

  // --- Away from home -----------------------------------------------------------------------
  const away = await view();
  assert.equal(away.remoteAccess.enabled, false);
  assert.equal(away.remoteAccess.publiclyExposed, false);
  assert.ok(away.remoteAccess.boundary.willNot.some((entry) => entry.includes("open a port on your router")));
  assert.match(away.remoteAccess.addressScope.detail, /Only this computer can reach AION/u);
  proved("AION is loopback-only by default and states what it will never do: no router port, no tunnel, no wildcard, and network reach is never authentication");

  // --- The headline: delete every model and see what survives --------------------------------
  const knowledgeBefore = await view();
  await call("brain.endpoint.remove", { id: gpu.id });
  await call("brain.endpoint.remove", { id: vendor.id });
  await refuse("brain.endpoint.remove", { id: "deterministic-offline" }, /cannot be removed/iu);
  const after = await view();

  assert.equal(after.state.brain.endpoints.length, 1, "only the offline floor remains");
  assert.equal(after.independence.independent, true);
  assert.equal(after.state.relationships.length, knowledgeBefore.state.relationships.length);
  assert.equal(after.state.opportunities[0].claims.length, knowledgeBefore.state.opportunities[0].claims.length);
  assert.equal(after.state.researchJobs[0].findings.length, knowledgeBefore.state.researchJobs[0].findings.length);
  assert.equal(after.state.lessons.length, knowledgeBefore.state.lessons.length);
  assert.equal(after.state.projects.length, knowledgeBefore.state.projects.length);
  assert.deepEqual(after.state.workspaces.map((w) => w.id), knowledgeBefore.state.workspaces.map((w) => w.id));
  proved("every configured model is deleted and AION still holds every workspace, relationship, claim, finding, lesson, and project");

  const chat = await call("conversation.create", { title: "Still working" });
  const turn = await call("chat.send", { id: chat.id, content: "Hello" });
  assert.ok(turn.message.content.length > 0);
  proved("with no model configured at all, AION still starts, still answers, and still remains useful");

  const atClose = await view();
  await app.close();

  // --- It survives a restart too ---------------------------------------------------------------
  const reopened = await open(dataRoot, exportRoot);
  const reloaded = await reopened.view();
  assert.deepEqual(reloaded.state.workspaces, atClose.state.workspaces);
  assert.deepEqual(reloaded.state.opportunities, atClose.state.opportunities);
  assert.deepEqual(reloaded.state.relationships, atClose.state.relationships);
  assert.deepEqual(reloaded.state.lessons, atClose.state.lessons);
  assert.deepEqual(reloaded.state.brain, atClose.state.brain);
  assert.equal(reloaded.state.revision, atClose.state.revision, "reopening writes no revision at all");
  const persisted = reloaded.state.opportunities.find((o) => o.id === opportunity.id);
  assert.deepEqual(persisted.taskIds, [studioTask.id], "the Task link survived the restart");
  assert.deepEqual(persisted.planIds, [studioPlan.id], "so did the Plan link");
  await reopened.app.close();
  proved("closing and reopening AION reloads byte-identical state, with the offline floor intact and no migration churn");

  console.log(`\nAION V1.2 demo PASS — ${steps.length} behaviours proved.`);
  console.log(`Fictional business "${BUSINESS}", fictional supplier "${SUPPLIER}", and a scripted source corpus.`);
  console.log("No owner data, employer system, market research, external account, live model, GPU, network call, or permanent state was used or left behind.\n");
} finally {
  await rm(root, { recursive: true, force: true });
}
