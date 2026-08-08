import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  FileStateRepositoryV1, InMemoryStateRepositoryV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1,
  NodePrivateBackupV1, OPPORTUNITY_LINK_KINDS, SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  linkOpportunityRecord, linkedWorkSummary, routeCommand, unlinkOpportunityRecord,
} from "../src/index.js";
import type { OpportunityLinkKindV1 } from "../src/index.js";

/**
 * Product Studio linkage. Every opportunity, task, and plan below is invented, lives in a
 * temporary directory, and is removed with it. No live owner record is read or written.
 */

async function studio(repository?: InMemoryStateRepositoryV1) {
  const root = await mkdtemp(join(tmpdir(), "aion-link-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  const service = new AionAssistantV1({
    repository: repository ?? new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  const brand = await service.createWorkspace({ label: "Quillfeather Labs" });
  await service.updateSettings({ activeWorkspace: brand.id });
  return { service, workspaceId: brand.id, root };
}

async function seeded() {
  const context = await studio();
  const opportunity = await context.service.createOpportunity({ title: "Shift-handover notes" });
  const task = await context.service.createTask({ title: "Draft the note format" });
  const plan = await context.service.createPlan("Validate the handover note", [{ title: "Ask five clinics" }]);
  return { ...context, opportunity, task, plan };
}

test("1. a task links to an opportunity", async () => {
  const { service, opportunity, task } = await seeded();
  const linked = await service.linkOpportunityTask(opportunity.id, task.id);
  assert.deepEqual(linked.taskIds, [task.id]);
  assert.deepEqual(linked.planIds, []);
  const recorded = (await service.snapshot()).activity.find((entry) => entry.action === "opportunity.task.link");
  assert.ok(recorded, "the link is recorded in Activity");
  assert.match(recorded!.summary, /the task itself is unchanged and keeps its own history/u);
});

test("2. a plan links to an opportunity", async () => {
  const { service, opportunity, plan } = await seeded();
  const linked = await service.linkOpportunityPlan(opportunity.id, plan.id);
  assert.deepEqual(linked.planIds, [plan.id]);
  assert.deepEqual(linked.taskIds, []);
});

test("3. linking twice is idempotent and never accumulates a duplicate", async () => {
  const { service, opportunity, task, plan } = await seeded();
  await service.linkOpportunityTask(opportunity.id, task.id);
  const again = await service.linkOpportunityTask(opportunity.id, task.id);
  assert.deepEqual(again.taskIds, [task.id], "still exactly one");

  await service.linkOpportunityPlan(opportunity.id, plan.id);
  const planAgain = await service.linkOpportunityPlan(opportunity.id, plan.id);
  assert.deepEqual(planAgain.planIds, [plan.id]);

  // A no-op link records nothing, so Activity does not fill with repeats of the same fact.
  const entries = (await service.snapshot()).activity.filter((entry) => entry.action.startsWith("opportunity.task.link"));
  assert.equal(entries.length, 1, "the second link is silent because nothing changed");
});

test("4. a task unlinks", async () => {
  const { service, opportunity, task } = await seeded();
  await service.linkOpportunityTask(opportunity.id, task.id);
  const unlinked = await service.unlinkOpportunityTask(opportunity.id, task.id);
  assert.deepEqual(unlinked.taskIds, []);
  const state = await service.snapshot();
  assert.equal(state.tasks.find((entry) => entry.id === task.id)?.title, "Draft the note format", "the task itself survives");
  assert.equal(state.tasks.find((entry) => entry.id === task.id)?.history.length, 1, "and so does its history");
});

test("5. a plan unlinks", async () => {
  const { service, opportunity, plan } = await seeded();
  await service.linkOpportunityPlan(opportunity.id, plan.id);
  const unlinked = await service.unlinkOpportunityPlan(opportunity.id, plan.id);
  assert.deepEqual(unlinked.planIds, []);
  assert.equal((await service.snapshot()).plans.find((entry) => entry.id === plan.id)?.steps.length, 1, "the plan and its steps survive");
});

test("6. a task reference that does not resolve is refused", async () => {
  const { service, opportunity } = await seeded();
  await assert.rejects(() => service.linkOpportunityTask(opportunity.id, "task-that-never-existed"), /Task was not found/iu);
  await assert.rejects(() => service.linkOpportunityTask(opportunity.id, ""), /reference is required/iu);
});

test("7. a plan reference that does not resolve is refused", async () => {
  const { service, opportunity } = await seeded();
  await assert.rejects(() => service.linkOpportunityPlan(opportunity.id, "plan-that-never-existed"), /Plan was not found/iu);
});

test("8. a task in another workspace is refused", async () => {
  const { service, opportunity } = await seeded();
  // A task that genuinely exists, but belongs to Work rather than to this brand.
  await service.updateSettings({ activeWorkspace: "work" });
  const elsewhere = await service.createTask({ title: "A task that belongs to Work" });
  await service.updateSettings({ activeWorkspace: (await service.snapshot()).opportunities[0]!.workspace });

  await assert.rejects(() => service.linkOpportunityTask(opportunity.id, elsewhere.id), /belongs to a different workspace/iu);
  assert.deepEqual((await service.snapshot()).opportunities.find((o) => o.id === opportunity.id)?.taskIds, [], "nothing was written");
});

test("9. a plan in another workspace is refused", async () => {
  const { service, opportunity } = await seeded();
  await service.updateSettings({ activeWorkspace: "personal" });
  const elsewhere = await service.createPlan("A personal plan", [{ title: "One step" }]);
  await service.updateSettings({ activeWorkspace: (await service.snapshot()).opportunities[0]!.workspace });

  await assert.rejects(() => service.linkOpportunityPlan(opportunity.id, elsewhere.id), /belongs to a different workspace/iu);
  assert.deepEqual((await service.snapshot()).opportunities.find((o) => o.id === opportunity.id)?.planIds, []);
});

test("10. a failed link leaves the opportunity exactly as it was", async () => {
  const { service, opportunity, task } = await seeded();
  await service.linkOpportunityTask(opportunity.id, task.id);
  const before = (await service.snapshot()).opportunities.find((o) => o.id === opportunity.id)!;

  await assert.rejects(() => service.linkOpportunityTask(opportunity.id, "nonexistent"), /was not found/iu);
  await assert.rejects(() => service.linkOpportunityPlan(opportunity.id, "nonexistent"), /was not found/iu);

  const after = (await service.snapshot()).opportunities.find((o) => o.id === opportunity.id)!;
  assert.deepEqual(after, before, "byte for byte, including updatedAt");
});

test("11. links survive a restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-link-restart-"));
  const dataRoot = join(root, "private", "aion");
  const ports = () => ({
    repository: new FileStateRepositoryV1(dataRoot), clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()], capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(join(root, "exports")),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  const first = new AionAssistantV1(ports());
  const brand = await first.createWorkspace({ label: "Selkirk Bindery" });
  await first.updateSettings({ activeWorkspace: brand.id });
  const opportunity = await first.createOpportunity({ title: "Ledger notebooks" });
  const task = await first.createTask({ title: "Source the paper" });
  const plan = await first.createPlan("Pilot run", [{ title: "Bind ten" }]);
  await first.linkOpportunityTask(opportunity.id, task.id);
  await first.linkOpportunityPlan(opportunity.id, plan.id);
  const before = await first.snapshot();

  const reopened = await new AionAssistantV1(ports()).snapshot();
  assert.deepEqual(reopened.opportunities, before.opportunities, "the links reload unchanged");
  assert.deepEqual(reopened.opportunities[0]?.taskIds, [task.id]);
  assert.deepEqual(reopened.opportunities[0]?.planIds, [plan.id]);
  assert.equal(reopened.revision, before.revision, "reopening writes no revision and needs no migration");
});

test("12. an opportunity created before linkage existed stays valid", async () => {
  const { service, opportunity, task } = await seeded();
  // The shape a V1.2 opportunity had before this correction: the arrays exist and are empty.
  assert.deepEqual(opportunity.taskIds, []);
  assert.deepEqual(opportunity.planIds, []);
  assert.equal((await service.assessOpportunity(opportunity.id)).linkedWork.summary, "No task is linked to this opportunity.");

  // And it accepts a link later without anything having to migrate it.
  const linked = await service.linkOpportunityTask(opportunity.id, task.id);
  assert.deepEqual(linked.taskIds, [task.id]);
  assert.deepEqual((await service.snapshot()).migrations.map((m) => m.migration), [], "no migration was needed to add a link");
});

test("13. a linked task that is completed or cancelled stays linked, and the summary says which", async () => {
  const { service, opportunity } = await seeded();
  const doing = await service.createTask({ title: "Still going" });
  const done = await service.createTask({ title: "Finished" });
  const dropped = await service.createTask({ title: "Abandoned" });
  for (const task of [doing, done, dropped]) await service.linkOpportunityTask(opportunity.id, task.id);
  await service.transitionTask(done.id, "completed");
  await service.transitionTask(dropped.id, "cancelled");

  const assessed = await service.assessOpportunity(opportunity.id);
  assert.equal(assessed.opportunity.taskIds.length, 3, "a link is a durable historical reference; finishing work does not erase it");
  assert.deepEqual(assessed.linkedWork.tasks, { total: 3, open: 1, completed: 1, cancelled: 1, missing: 0 });
  assert.match(assessed.linkedWork.summary, /3 linked task\(s\): 1 open, 1 completed, 1 cancelled/u);

  // Cancelling the last open one leaves a mix, and the warning deliberately does NOT fire: one
  // task did complete, so "nothing is being worked on" would overstate it.
  await service.transitionTask(doing.id, "cancelled");
  const mixed = await service.assessOpportunity(opportunity.id);
  assert.match(mixed.linkedWork.summary, /3 linked task\(s\): 0 open, 1 completed, 2 cancelled/u);
  assert.doesNotMatch(mixed.linkedWork.summary, /Every linked task was cancelled/u);

  // An opportunity whose every linked task was cancelled reads as exactly that.
  const abandoned = await service.createOpportunity({ title: "Abandoned idea" });
  for (const title of ["First attempt", "Second attempt"]) {
    const task = await service.createTask({ title });
    await service.linkOpportunityTask(abandoned.id, task.id);
    await service.transitionTask(task.id, "cancelled");
  }
  const bleak = await service.assessOpportunity(abandoned.id);
  assert.deepEqual(bleak.linkedWork.tasks, { total: 2, open: 0, completed: 0, cancelled: 2, missing: 0 });
  assert.match(bleak.linkedWork.summary, /Every linked task was cancelled, so nothing here is actually being worked on/u);
});

test("14. the typed path is what is exposed, and the router proposes it without inventing operands", () => {
  const context = { workspaceLabel: "Quillfeather Labs", workspaces: [{ id: "personal", label: "Personal" }] };
  const routed = routeCommand("link the task to the opportunity", context);
  const proposal = routed.proposals.find((entry) => entry.intent === "opportunity.link");
  assert.ok(proposal, "the sentence reaches the linkage intent");
  assert.equal(proposal!.action, "opportunity.task.link");
  assert.deepEqual(proposal!.payload, { id: "", taskId: "" }, "the router proposes the operation and no identifier");
  assert.equal(proposal!.requiresApproval, true);
  assert.match(proposal!.summary, /AION will not guess which two/u);

  const planRouted = routeCommand("link the plan to the opportunity", context);
  const planProposal = planRouted.proposals.find((entry) => entry.intent === "opportunity.link");
  assert.equal(planProposal?.action, "opportunity.plan.link");
  assert.deepEqual(planProposal?.payload, { id: "", planId: "" });
});

test("15. the generic editor still cannot write taskIds or planIds", async () => {
  const { service, opportunity, task } = await seeded();
  for (const field of ["taskIds", "planIds", "researchJobIds", "projectIds", "relationshipIds", "claims"]) {
    await assert.rejects(
      () => service.updateOpportunity(opportunity.id, { [field]: [task.id] }),
      /unexpected field/iu,
      `${field} is not writable through the generic edit path`,
    );
  }
  assert.deepEqual((await service.snapshot()).opportunities[0]?.taskIds, [], "and nothing leaked through");
});

test("16. the pure link helpers are total: they refuse a bad kind and never mutate their input", () => {
  const now = "2030-01-01T00:00:00.000Z";
  const opportunity = { title: "x", taskIds: ["a"], planIds: [], updatedAt: now } as never;
  assert.throws(() => linkOpportunityRecord(opportunity, "relationship" as OpportunityLinkKindV1, "a", now), /must be one of: task, plan/u);
  assert.throws(() => unlinkOpportunityRecord(opportunity, "" as OpportunityLinkKindV1, "a", now), /must be one of: task, plan/u);
  assert.deepEqual([...OPPORTUNITY_LINK_KINDS], ["task", "plan"]);

  const result = linkOpportunityRecord(opportunity, "task", "b", now);
  assert.deepEqual(result.opportunity.taskIds, ["a", "b"]);
  assert.deepEqual((opportunity as unknown as { taskIds: string[] }).taskIds, ["a"], "the input is not mutated");
  assert.equal(linkOpportunityRecord(opportunity, "task", "a", now).changed, false);
  assert.equal(unlinkOpportunityRecord(opportunity, "task", "never-linked", now).changed, false, "removing what is not there is a no-op, not an error");
});

test("a link whose record is deleted afterwards is reported as missing rather than hidden", async () => {
  const { service, opportunity, task } = await seeded();
  await service.linkOpportunityTask(opportunity.id, task.id);
  // Nothing in AION deletes a Task today, so this models the reference outliving its record.
  const summary = linkedWorkSummary({ ...opportunity, taskIds: [task.id, "vanished"], planIds: ["also-gone"] }, [{ id: task.id, state: "ready" }], []);
  assert.equal(summary.tasks.missing, 1);
  assert.equal(summary.plans.missing, 1);
  assert.match(summary.summary, /2 link\(s\) point at a record that no longer exists/u);

  // And the reference can still be cleared, which is why unlink does not resolve the record.
  const cleared = await service.unlinkOpportunityTask(opportunity.id, task.id);
  assert.deepEqual(cleared.taskIds, []);
});

test("linkage is workspace-scoped end to end, including from another workspace", async () => {
  const { service, opportunity, task } = await seeded();
  await service.linkOpportunityTask(opportunity.id, task.id);
  await service.updateSettings({ activeWorkspace: "personal" });
  await assert.rejects(() => service.linkOpportunityTask(opportunity.id, task.id), /different workspace/iu);
  await assert.rejects(() => service.unlinkOpportunityTask(opportunity.id, task.id), /different workspace/iu);
  await assert.rejects(() => service.assessOpportunity(opportunity.id), /different workspace/iu);
});
