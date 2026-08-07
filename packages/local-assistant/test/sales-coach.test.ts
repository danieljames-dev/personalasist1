import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  InMemoryStateRepositoryV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1,
  SALES_ROUTINE_TEMPLATES, SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../src/index.js";

/** Fictional dealership, fictional people. */
async function salesFloor() {
  const root = await mkdtemp(join(tmpdir(), "aion-coach-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(), clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()], capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  await service.updateSettings({ activeWorkspace: "work", workspaceLabels: { personal: "Personal", work: "Bayfield Motors" } });
  const customer = await service.createCustomer({
    displayName: "T. Okafor", source: "internet enquiry", communicationPreference: "email",
    interests: [{ kind: "vehicle", description: "seven-seat SUV" }], objections: ["the monthly payment feels high"],
  });
  return { service, customer };
}

test("coaching is deterministic and never invents a fact AION was not told", async () => {
  const { service, customer } = await salesFloor();
  for (const kind of ["call-preparation", "appointment-preparation", "discovery-questions", "next-action"]) {
    const first = await service.coach(kind, { customerId: customer.id });
    const second = await service.coach(kind, { customerId: customer.id });
    assert.deepEqual(first, second, `${kind} is deterministic`);
    assert.equal(first.draft, false);
    const text = first.lines.join("\n");
    // No price, payment, rate, or stock number may ever be fabricated.
    assert.doesNotMatch(text, /\$\s?\d|\b\d+(?:\.\d+)?\s?%|\bAPR\b|\bMSRP\b|\bin stock\b/iu, `${kind} states no invented commercial fact`);
  }
  const prep = await service.coach("call-preparation", { customerId: customer.id });
  assert.match(prep.lines.join("\n"), /confirm current figures.*AION does not know this/u, "a needed fact is marked for confirmation instead of guessed");
  assert.match(prep.lines.join("\n"), /the monthly payment feels high/u, "it uses what the owner actually recorded");
});

test("a follow-up draft is clearly a draft and is never sent", async () => {
  const { service, customer } = await salesFloor();
  for (const channel of ["text", "email"]) {
    const draft = await service.coach("follow-up-draft", { customerId: customer.id, channel });
    assert.equal(draft.draft, true);
    assert.match(draft.lines[0]!, /DRAFT ONLY — AION does not send messages/u);
    assert.match(draft.lines.join("\n"), /seven-seat SUV/u, "the draft is grounded in the recorded interest");
    assert.doesNotMatch(draft.lines.join("\n"), /\$\s?\d|\bAPR\b/iu, "a draft quotes no figure AION invented");
  }
  const state = await service.snapshot();
  assert.equal(state.activity.some((entry) => /sent|delivered/iu.test(entry.summary)), false, "nothing records a message being sent");
});

test("objection, discovery and role-play helpers work from recorded material only", async () => {
  const { service, customer } = await salesFloor();
  const objection = await service.coach("objection-prompts", { customerId: customer.id, objection: "the monthly payment feels high" });
  assert.match(objection.lines.join("\n"), /monthly payment feels high/u);
  assert.match(objection.lines.join("\n"), /AION does not know this/u);
  const play = await service.coach("role-play", { customerId: customer.id, scenario: "payment objection at the desk" });
  assert.match(play.lines.join("\n"), /Practice scaffolding/u);
  assert.match(play.lines.join("\n"), /seven-seat SUV/u);
  await assert.rejects(service.coach("objection-prompts", { customerId: customer.id }), /Objection is invalid/u);
  await assert.rejects(service.coach("definitely-not-a-kind", { customerId: customer.id }), /not recognised/u);
});

test("the day views summarise the real queue and label the source honestly", async () => {
  const { service, customer } = await salesFloor();
  await service.addCustomerFollowUp(customer.id, { dueAt: "2030-01-01T09:00:00.000Z", channel: "email", reason: "Send SUV comparison." });
  await service.addCustomerAppointment(customer.id, { at: "2030-01-01T15:00:00.000Z", location: "showroom" });

  const queue = await service.coach("follow-up-queue", { onDate: "2030-01-01" });
  assert.match(queue.lines.join("\n"), /T\. Okafor · email · Send SUV comparison\./u);
  const plan = await service.coach("morning-plan", { onDate: "2030-01-01" });
  assert.match(plan.lines.join("\n"), /Appointments today: 1/u);
  assert.match(plan.lines.join("\n"), /Follow-ups due: 1/u);
  const recap = await service.coach("end-of-day-recap", { onDate: "2030-01-01" });
  assert.match(recap.lines.join("\n"), /AION's own records, not any dealership system's numbers/u);
});

test("routine templates are offered, never activated on their own", async () => {
  const { service } = await salesFloor();
  const templates = service.salesRoutineTemplates();
  assert.deepEqual(templates.map((entry) => entry.id), ["morning-plan", "midday-follow-up", "appointment-confirmation", "end-of-day-recap"]);
  assert.equal((await service.snapshot()).routines.length, 0, "no routine exists until the owner creates one");

  const routine = await service.createRoutineFromTemplate("end-of-day-recap");
  assert.equal(routine.name, "End-of-Day Recap");
  assert.equal(routine.workspace, "work");
  assert.equal((await service.snapshot()).routines.length, 1);
  await assert.rejects(service.createRoutineFromTemplate("not-a-template"), /not recognised/u);
  assert.equal(SALES_ROUTINE_TEMPLATES.every((entry) => entry.intervalMinutes > 0), true);
});

test("metrics are owner-entered whole numbers, one day at a time, labelled as the owner's own", async () => {
  const { service } = await salesFloor();
  const entry = await service.recordSalesMetrics("2030-01-01", { newLeads: 4, calls: 22, contacts: 9, appointmentsSet: 3, appointmentsShown: 2, sales: 1, followUpsCompleted: 7 }, "Busy Saturday.");
  assert.equal(entry.workspace, "work");
  assert.equal(entry.origin, "owner-created");
  assert.equal(entry.counts.calls, 22);

  // Re-entering the same day replaces it rather than double counting.
  await service.recordSalesMetrics("2030-01-01", { calls: 25 });
  const state = await service.snapshot();
  assert.equal(state.salesMetrics.filter((item) => item.date === "2030-01-01").length, 1);
  assert.equal(state.salesMetrics[0]?.counts.calls, 25);
  assert.equal(state.salesMetrics[0]?.counts.sales, 0, "an omitted count is zero, never carried over");

  await service.recordSalesMetrics("2030-01-02", { calls: 10, sales: 2 });
  const summary = await service.salesSummary("2030-01-01", "2030-01-02");
  assert.equal(summary.days, 2);
  assert.equal(summary.entered, 2);
  assert.equal(summary.totals.calls, 35);
  assert.equal(summary.totals.sales, 2);
  assert.match(summary.source, /Not a dealership CRM figure/u);

  await assert.rejects(service.recordSalesMetrics("01-01-2030", {}), /YYYY-MM-DD/u);
  await assert.rejects(service.recordSalesMetrics("2030-01-01", { calls: -1 }), /whole number/u);
  await assert.rejects(service.recordSalesMetrics("2030-01-01", { calls: 1.5 }), /whole number/u);
  await assert.rejects(service.recordSalesMetrics("2030-01-01", { commission: 500 }), /unexpected field/u, "AION does not collect pay or commission");
  await assert.rejects(service.salesSummary("2030-01-05", "2030-01-01"), /inverted/u);
});

test("coaching and metrics are unavailable outside the Work workspace", async () => {
  const { service, customer } = await salesFloor();
  await service.updateSettings({ activeWorkspace: "personal" });
  await assert.rejects(service.coach("call-preparation", { customerId: customer.id }), /Work workspace/u);
  await assert.rejects(service.recordSalesMetrics("2030-01-01", { calls: 1 }), /Work workspace/u);
  await assert.rejects(service.salesSummary("2030-01-01", "2030-01-01"), /Work workspace/u);
  await assert.rejects(service.createRoutineFromTemplate("morning-plan"), /Work workspace/u);
});

test("no coaching template hard-codes a manufacturer, dealership, or CRM", () => {
  const serialized = JSON.stringify(SALES_ROUTINE_TEMPLATES);
  for (const vendor of ["Toyota", "Lakeland", "VinSolutions", "Elead", "CDK", "Reynolds", "DealerSocket", "Salesforce"]) {
    assert.equal(serialized.includes(vendor), false, `no ${vendor} concept is baked into a routine template`);
  }
});
