import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, APPROVAL_REQUIRED_STAGES, DeterministicClockV1, DeterministicIdGeneratorV1,
  DeterministicModelProviderV1, InMemoryStateRepositoryV1, LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1, NodePrivateBackupV1, PIPELINE_STEPS, SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1, SyntheticBuildPipelineV1, SyntheticDeveloperAgentBridgeV1,
} from "../src/index.js";
import type { BuildPipelinePortV1 } from "../src/index.js";

/** Every project below is invented. Nothing is built, deployed, or written outside a temp dir. */

async function assistant(options: { pipeline?: BuildPipelinePortV1 | null } = {}) {
  // `null` means deliberately no pipeline. A default parameter would not distinguish that from
  // "not specified", which is exactly the case one of these tests needs to exercise.
  const pipeline = options.pipeline === null ? undefined : options.pipeline ?? new SyntheticBuildPipelineV1();
  const root = await mkdtemp(join(tmpdir(), "aion-project-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    ...(pipeline ? { pipeline } : {}),
  });
  const brand = await service.createWorkspace({ label: "Hollowbrook Software" });
  await service.updateSettings({ activeWorkspace: brand.id });
  return service;
}

async function readyForImplementation(service: AionAssistantV1) {
  const project = await service.createProject({ title: "Handover note app", summary: "A small shared note." });
  await service.setProjectSpecification(project.id, { problem: "Handover detail is lost between shifts.", acceptance: ["A note can be written and read."] });
  await service.advanceProject(project.id, "specification", "Specification written.");
  await service.setProjectPlan(project.id, ["Sketch the note format", "Build the form", "Test with two people"]);
  await service.advanceProject(project.id, "plan", "Plan drafted.");
  await service.advanceProject(project.id, "tasks", "Steps agreed.");
  return project.id;
}

/** Walks a project all the way to owner-approved, which is as far as AION can take one. */
async function walkToOwnerApproved(service: AionAssistantV1) {
  const id = await readyForImplementation(service);
  await service.approveProjectStage(id, "implementation", "Reviewed the proposal myself.");
  await service.advanceProject(id, "implementation", "Approved.");
  await service.runProjectStep(id, "build");
  await service.advanceProject(id, "verification", "Built.");
  await service.runProjectStep(id, "test");
  await service.advanceProject(id, "review", "Tests ran.");
  await service.runProjectStep(id, "preview");
  await service.advanceProject(id, "preview", "Preview built.");
  await service.advanceProject(id, "owner-approved", "Looks right to me.");
  return id;
}

test("stages are not skipped, and each refusal names the actual obstacle", async () => {
  const service = await assistant();
  const project = await service.createProject({ title: "Handover note app" });
  await assert.rejects(() => service.advanceProject(project.id, "implementation", "let's go"), /can move to specification, abandoned, not to "implementation"/u);
  await assert.rejects(() => service.advanceProject(project.id, "specification", "skip it"), /Write the specification before moving/iu);

  await service.setProjectSpecification(project.id, { problem: "Handover detail is lost." });
  await service.advanceProject(project.id, "specification", "Written.");
  await assert.rejects(() => service.advanceProject(project.id, "tasks", "onwards"), /can move to plan, idea, abandoned/u);
  await service.advanceProject(project.id, "plan", "Plan drafted.");
  await assert.rejects(() => service.advanceProject(project.id, "tasks", "onwards"), /A plan with at least one step is needed/u);
});

test("no agent authorises itself: an implementation stage needs an approval naming that stage", async () => {
  const service = await assistant();
  const id = await readyForImplementation(service);

  await service.recordAgentProposal(id, { summary: "Add the note form and a test.", mode: "workspace-write" });
  await assert.rejects(
    () => service.advanceProject(id, "implementation", "the agent says it is ready"),
    /needs an approval naming that stage. No agent raises its own authority/u,
    "a proposal from an agent is not an authorisation",
  );

  await service.approveProjectStage(id, "implementation", "Reviewed the proposal myself.");
  const advanced = await service.advanceProject(id, "implementation", "Approved.");
  assert.equal(advanced.stage, "implementation");
  assert.equal(advanced.approvals[0]?.actor, "owner");
  assert.deepEqual(APPROVAL_REQUIRED_STAGES, ["implementation", "deployed"]);
});

test("an approval only exists for a stage that changes something", async () => {
  const service = await assistant();
  const project = await service.createProject({ title: "Handover note app" });
  await assert.rejects(() => service.approveProjectStage(project.id, "review", "looks fine"), /does not need an approval/iu);
  await assert.rejects(() => service.approveProjectStage(project.id, "not-a-stage", ""), /not a project stage/iu);
});

test("review rests on evidence, and preview on something that actually built", async () => {
  const service = await assistant();
  const id = await readyForImplementation(service);
  await service.approveProjectStage(id, "implementation", "Approved.");
  await service.advanceProject(id, "implementation", "Approved.");

  await service.runProjectStep(id, "build");
  await service.advanceProject(id, "verification", "Built.");
  await assert.rejects(() => service.advanceProject(id, "review", "looks right"), /Review rests on evidence/u);

  await service.runProjectStep(id, "test");
  await service.advanceProject(id, "review", "Tests ran.");
  await assert.rejects(() => service.advanceProject(id, "preview", "let me see it"), /needs a preview that actually built/u);

  await service.runProjectStep(id, "preview");
  const previewed = await service.advanceProject(id, "preview", "Preview built.");
  assert.equal(previewed.stage, "preview");
  const preview = previewed.runs.find((run) => run.step === "preview")!;
  assert.match(preview.previewUrl!, /^http:\/\/127\.0\.0\.1/u, "a preview is reachable from this computer only");
});

test("AION cannot deploy, and preparing one records intent without creating the ability", async () => {
  const service = await assistant();
  const id = await walkToOwnerApproved(service);

  await assert.rejects(() => service.prepareDeployment(id, { target: "a public host", summary: "Put it up." }), /Deployment consequences is required/iu);
  const prepared = await service.prepareDeployment(id, {
    target: "a public host", summary: "Put the note app where the clinic can use it.",
    consequences: "Anyone with the address could read notes. This cannot be undone once seen.",
  });
  assert.equal(prepared.deployment?.state, "prepared");
  assert.equal(prepared.stage, "owner-approved", "owner-approved is as far as AION takes a project");

  await service.approveProjectStage(id, "deployed", "I accept the consequences.");
  await assert.rejects(
    () => service.advanceProject(id, "deployed", "go"),
    /AION cannot deploy/u,
    "an approval records intent; it does not conjure a capability that does not exist",
  );
  assert.match(await service.projects().then((list) => list[0]!.standing), /AION cannot carry it out/u);
});

test("without a pipeline AION says so rather than pretending to build", async () => {
  const service = await assistant({ pipeline: null });
  const project = await service.createProject({ title: "Handover note app" });
  await assert.rejects(() => service.runProjectStep(project.id, "build"), /No build pipeline is configured/iu);

  const withPipeline = await assistant();
  const other = await withPipeline.createProject({ title: "Handover note app" });
  await assert.rejects(() => withPipeline.runProjectStep(other.id, "deploy"), /must be one of: install, build, test, preview/u);
  assert.deepEqual([...PIPELINE_STEPS], ["install", "build", "test", "preview"], "the step set is closed; a caller names one, never a command");
});

test("a pipeline cannot publish, and the port pins that rather than trusting it", () => {
  // `canPublish` is typed `false`, so an adapter that could put something where other people can
  // reach it cannot satisfy the port without the port itself being changed.
  const pipeline: BuildPipelinePortV1 = new SyntheticBuildPipelineV1();
  assert.equal(pipeline.canPublish, false);
  assert.equal(new SyntheticBuildPipelineV1({ test: "failed" }).canPublish, false);
});

test("a failing pipeline step is recorded as failing", async () => {
  const service = await assistant({ pipeline: new SyntheticBuildPipelineV1({ build: "failed" }) });
  const project = await service.createProject({ title: "Handover note app" });
  const after = await service.runProjectStep(project.id, "build");
  assert.equal(after.runs[0]?.outcome, "failed");
  assert.match(await service.projects().then((list) => list[0]!.standing), /Nothing has been tested/u);
});

test("verification evidence attached to a project must be a run that actually happened", async () => {
  const service = await assistant();
  const project = await service.createProject({ title: "Handover note app" });
  await assert.rejects(() => service.attachProjectVerification(project.id, "verification-that-never-ran"), /was not found/iu);
});

test("projects are workspace-scoped and link only to opportunities in the same workspace", async () => {
  const service = await assistant();
  const opportunity = await service.createOpportunity({ title: "Shift handover" });
  const linked = await service.createProject({ title: "Handover note app", opportunityId: opportunity.id });
  assert.equal(linked.opportunityId, opportunity.id);

  const other = await service.createWorkspace({ label: "Marlowe Press" });
  await service.updateSettings({ activeWorkspace: other.id });
  assert.deepEqual(await service.projects(), []);
  await assert.rejects(() => service.createProject({ title: "Reached across", opportunityId: opportunity.id }), /different workspace/iu);
  await assert.rejects(() => service.advanceProject(linked.id, "specification", "reached across"), /different workspace/iu);
});

test("a project standing states what has not happened as plainly as what has", async () => {
  const service = await assistant();
  const project = await service.createProject({ title: "Handover note app" });
  const standing = await service.projects().then((list) => list[0]!.standing);
  assert.match(standing, /is at idea/u);
  assert.match(standing, /No specification has been written/u);
  assert.match(standing, /No plan yet/u);
  assert.match(standing, /Nothing has been tested/u);
  assert.match(standing, /No stage has been approved/u);
  assert.ok(project.history.length === 1, "the history starts with the project being opened");
});
