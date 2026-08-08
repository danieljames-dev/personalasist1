import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ADAPTATION_BOUNDARY, AionAssistantV1, DeterministicClockV1, DeterministicIdGeneratorV1,
  DeterministicModelProviderV1, InMemoryStateRepositoryV1, LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1, NodePrivateBackupV1, SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1, assertNoOwnerDataTraining,
} from "../src/index.js";

/** Every lesson below is invented. No owner behaviour, customer, or employer is referenced. */

async function assistant() {
  const root = await mkdtemp(join(tmpdir(), "aion-learning-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  return new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
}

test("a model may propose a lesson but never decide it is now how things are done", async () => {
  const service = await assistant();
  const proposed = await service.recordLesson({ statement: "Short messages get answered faster.", guidance: "Keep it to two lines." }, "provider-proposal");
  assert.equal(proposed.claim.class, "hypothesis", "a proposal is a hypothesis, whatever it was asked to be");
  assert.equal(proposed.claim.provenance.sourceType, "provider-proposal");

  await assert.rejects(
    () => service.recordLesson({ class: "owner-confirmed", statement: "This is definitely true." }, "provider-proposal"),
    /Only the owner can record/iu,
  );

  const owned = await service.recordLesson({ statement: "Confirming an appointment the day before reduces no-shows.", supportedBy: ["own-records-2030-q1"] });
  assert.equal(owned.claim.class, "learned-strategy", "the owner recording a lesson records a strategy");
});

test("a lesson that keeps failing stops being recommended and says so", async () => {
  const service = await assistant();
  const lesson = await service.recordLesson({ statement: "Call before nine in the morning.", supportedBy: ["own-records"], guidance: "Try early." });
  assert.equal((await service.lessons())[0]?.standing.summary, "Never actually tried. It is a suggestion, not a track record.");

  await service.recordLessonOutcome(lesson.id, { result: "worked", detail: "Reached two of three." });
  assert.equal((await service.lessons()).length, 1);

  for (const detail of ["No answer.", "No answer again.", "Voicemail."]) {
    await service.recordLessonOutcome(lesson.id, { result: "did-not-work", detail });
  }
  assert.deepEqual(await service.lessons(), [], "AION stops offering a lesson its own record argues against");

  const state = await service.snapshot();
  const stored = state.lessons.find((entry) => entry.id === lesson.id)!;
  assert.equal(stored.outcomes.length, 4, "every outcome is kept, including the ones that did not work");
  assert.match(state.activity.find((entry) => entry.action === "lesson.outcome")!.summary, /Followed/u);
});

test("turning a lesson off keeps it rather than pretending it was never learned", async () => {
  const service = await assistant();
  const lesson = await service.recordLesson({ statement: "Batch follow-ups on Fridays.", supportedBy: ["own-records"] });
  await service.setLessonEnabled(lesson.id, false);
  assert.deepEqual(await service.lessons(), []);

  const stored = (await service.snapshot()).lessons.find((entry) => entry.id === lesson.id)!;
  assert.equal(stored.enabled, false);
  assert.equal(stored.claim.statement, "Batch follow-ups on Fridays.");

  await service.setLessonEnabled(lesson.id, true);
  assert.equal((await service.lessons()).length, 1, "it comes back intact");
});

test("lessons are ordered by track record, not by age", async () => {
  const service = await assistant();
  const untried = await service.recordLesson({ statement: "Send a summary after every call.", supportedBy: ["a"] });
  const proven = await service.recordLesson({ statement: "Confirm the day before.", supportedBy: ["b"] });
  for (const _ of [0, 1, 2]) await service.recordLessonOutcome(proven.id, { result: "worked" });

  const ordered = await service.lessons();
  assert.deepEqual(ordered.map((entry) => entry.id), [proven.id, untried.id]);
  assert.equal(ordered[0]?.standing.worked, 3);
});

test("the learning summary separates what is confirmed from what was merely suggested", async () => {
  const service = await assistant();
  assert.match((await service.learningSummary()).summary, /learned nothing yet. It will not pretend otherwise/u);

  await service.recordLesson({ statement: "A suggestion.", }, "provider-proposal");
  await service.recordLesson({ statement: "Something that worked.", supportedBy: ["own-records"] });
  const summary = await service.learningSummary();
  assert.equal(summary.confirmed, 1);
  assert.equal(summary.proposed, 1);
  assert.match(summary.summary, /The proposed ones are suggestions AION has not verified/u);
});

test("promotion goes through the same path and history as any other claim", async () => {
  const service = await assistant();
  const proposed = await service.recordLesson({ statement: "Weekly digests reduce churn." }, "provider-proposal");
  const promoted = await service.promoteLesson(proposed.id, "learned-strategy", "Held over two quarters of my own records.");
  assert.equal(promoted.claim.class, "learned-strategy");
  assert.deepEqual(promoted.claim.promotions.map((entry) => entry.to), ["learned-strategy"]);
  await assert.rejects(() => service.promoteLesson(proposed.id, "evidence", "no"), /cannot become/iu);
});

test("learning survives replacing the model, because none of it was inside the model", async () => {
  const service = await assistant();
  await service.recordLesson({ statement: "Confirm the day before.", supportedBy: ["own-records"] });
  const endpoint = await service.addBrainEndpoint({ label: "Home GPU", runtime: "vllm", location: "owner-controlled-host", baseUrl: "https://gpu.invalid", model: "open-weights-large" });
  await service.updateBrainSettings({ primaryEndpointId: endpoint.id });

  await service.removeBrainEndpoint(endpoint.id);
  const after = await service.lessons();
  assert.equal(after.length, 1, "the lesson is untouched by the model changing");
  assert.equal(after[0]?.claim.statement, "Confirm the day before.");
});

test("lessons are workspace-scoped like everything else", async () => {
  const service = await assistant();
  const brand = await service.createWorkspace({ label: "Fernhill Studio" });
  await service.updateSettings({ activeWorkspace: brand.id });
  const lesson = await service.recordLesson({ statement: "Ship on Tuesdays.", supportedBy: ["own-records"] });

  await service.updateSettings({ activeWorkspace: "personal" });
  assert.deepEqual(await service.lessons(), []);
  await assert.rejects(() => service.recordLessonOutcome(lesson.id, { result: "worked" }), /different workspace/iu);
});

test("a scoped lesson must name what it is about", async () => {
  const service = await assistant();
  await assert.rejects(() => service.recordLesson({ statement: "Something.", scope: "relationship", supportedBy: ["a"] }), /must name what it is about/iu);
  const scoped = await service.recordLesson({ statement: "This one prefers text.", scope: "relationship", subjectRef: "relationship-123", supportedBy: ["a"] });
  assert.equal(scoped.subjectRef, "relationship-123");
  assert.equal((await service.lessons({ kind: "relationship", subjectRef: "relationship-999" })).length, 0, "it does not apply to a different subject");
  assert.equal((await service.lessons({ kind: "relationship", subjectRef: "relationship-123" })).length, 1);
});

test("AION does not train on owner data and the boundary refuses rather than describing itself as ready", () => {
  assert.equal(ADAPTATION_BOUNDARY.implemented, false);
  assert.equal(ADAPTATION_BOUNDARY.requiresSeparateAuthorization, true);
  assert.equal(ADAPTATION_BOUNDARY.requiresDatasetManifest, true);
  assert.match(ADAPTATION_BOUNDARY.statement, /does not fine-tune anything and does not train on your data/u);

  assert.doesNotThrow(() => assertNoOwnerDataTraining({ usesOwnerData: false, authorized: false, manifestRef: "" }));
  assert.throws(() => assertNoOwnerDataTraining({ usesOwnerData: true, authorized: false, manifestRef: "" }), /separate explicit authorisation and a dataset manifest/iu);
  assert.throws(() => assertNoOwnerDataTraining({ usesOwnerData: true, authorized: true, manifestRef: "manifest-1" }), /does not implement training/iu);
});

test("an outcome must be one of the recorded results, not free text", async () => {
  const service = await assistant();
  const lesson = await service.recordLesson({ statement: "Something.", supportedBy: ["a"] });
  await assert.rejects(() => service.recordLessonOutcome(lesson.id, { result: "sort of great" }), /must be one of/iu);
});
