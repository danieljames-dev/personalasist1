import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  FileStateRepositoryV1, InMemoryStateRepositoryV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1,
  NodePrivateBackupV1, SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1, queryCustomers,
} from "../src/index.js";
import type { CustomerV1 } from "../src/index.js";

/**
 * Every customer below is invented, and the dealership is fictional. Nothing here resembles a real
 * person, a real employer, or the Founder's own work.
 */
const FICTIONAL_DEALERSHIP = "Bayfield Motors";

async function workspace(overrides: { repository?: InMemoryStateRepositoryV1 } = {}) {
  const root = await mkdtemp(join(tmpdir(), "aion-sales-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  const service = new AionAssistantV1({
    repository: overrides.repository ?? new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  await service.updateSettings({ activeWorkspace: "work", workspaceLabels: { personal: "Personal", work: FICTIONAL_DEALERSHIP } });
  return { root, service };
}

const prospect = { displayName: "R. Almeida (walk-in)", source: "showroom walk-in", interests: [{ kind: "vehicle", description: "midsize hybrid sedan, blue" }], communicationPreference: "text" };

test("a relationship record is durable, work-scoped, and opens with a timeline entry", async () => {
  const { service } = await workspace();
  const customer = await service.createCustomer(prospect);
  assert.equal(customer.workspace, "work");
  assert.equal(customer.lifecycle, "prospect");
  assert.equal(customer.origin, "employer-work", "work relationships default to employer-owned, not personal property");
  assert.match(customer.reference, /^customer:[0-9a-f]{16}$/u, "a stable opaque reference is issued");
  assert.equal(customer.interactions.length, 1);
  assert.equal(customer.interactions[0]?.lifecycleAfter, "prospect");
  assert.equal(customer.outcome.state, "open");
  assert.equal(customer.archived, false);
});

test("the full prospect-to-sale lifecycle accumulates history without losing anything earlier", async () => {
  const { service } = await workspace();
  const created = await service.createCustomer(prospect);
  await service.recordCustomerInteraction(created.id, { kind: "call", summary: "First call; asked about hybrid range.", lifecycleAfter: "contacted" });
  await service.recordCustomerInteraction(created.id, { kind: "text", summary: "Sent brochure.", lifecycleAfter: "engaged" });
  await service.addCustomerAppointment(created.id, { at: "2030-03-02T15:00:00.000Z", location: "showroom", notes: "Bringing spouse." });
  await service.setCustomerLifecycle(created.id, "appointment-set", "Appointment booked for Saturday.");
  const withAppointment = await service.customerTimeline(created.id);
  const appointmentId = withAppointment.customer.appointments[0]!.id;
  await service.setCustomerAppointmentStatus(created.id, appointmentId, "shown");
  await service.setCustomerLifecycle(created.id, "negotiating", "Discussing trade allowance.");
  await service.addCustomerFollowUp(created.id, { dueAt: "2030-03-05T14:00:00.000Z", channel: "phone", reason: "Confirm figures." });
  const beforeClose = await service.customerTimeline(created.id);
  await service.completeCustomerFollowUp(created.id, beforeClose.customer.followUps[0]!.id, "Agreed terms.");
  const sold = await service.setCustomerOutcome(created.id, "sold", "Delivered Saturday.");

  assert.equal(sold.lifecycle, "sold");
  assert.equal(sold.outcome.state, "sold");
  const kinds = sold.interactions.map((entry) => entry.kind);
  assert.deepEqual(kinds, ["lifecycle", "call", "text", "appointment", "lifecycle", "appointment", "lifecycle", "follow-up", "outcome"], "every step is retained in order");
  const states = sold.interactions.filter((entry) => entry.lifecycleAfter).map((entry) => entry.lifecycleAfter);
  assert.deepEqual(states, ["prospect", "contacted", "engaged", "appointment-set", "negotiating", "sold"], "the whole journey is recoverable");
  assert.equal(sold.interactions[1]?.summary, "First call; asked about hybrid range.", "the earliest note is still verbatim");

  // A later follow-up after the sale keeps the relationship alive rather than closing the record.
  await service.addCustomerFollowUp(created.id, { dueAt: "2030-06-01T14:00:00.000Z", channel: "phone", reason: "Three-month check-in." });
  const later = await service.customerTimeline(created.id);
  assert.equal(later.customer.followUps.length, 2);
  assert.equal(later.customer.outcome.state, "sold", "a post-sale follow-up does not reopen or overwrite the outcome");
});

test("an edit never rewrites the timeline, links, outcome, or provenance", async () => {
  const { service } = await workspace();
  const created = await service.createCustomer(prospect);
  await service.recordCustomerInteraction(created.id, { kind: "call", summary: "Discovery call." });
  const before = (await service.customerTimeline(created.id)).customer;

  const edited = await service.updateCustomer(created.id, { displayName: "R. Almeida", notes: "Prefers evenings.", preferences: ["evening contact"] });
  assert.equal(edited.displayName, "R. Almeida");
  assert.equal(edited.notes, "Prefers evenings.");
  assert.deepEqual(edited.interactions, before.interactions, "history is carried across an edit untouched");
  assert.equal(edited.createdAt, before.createdAt);
  assert.deepEqual(edited.provenance, before.provenance);
  assert.equal(edited.lifecycle, before.lifecycle, "an edit cannot silently change the relationship state");

  await assert.rejects(service.updateCustomer(created.id, { interactions: [] }), /accepts only/u, "the timeline is not an editable field");
  await assert.rejects(service.updateCustomer(created.id, { lifecycle: "sold" }), /accepts only/u, "state changes go through the recorded path");
});

test("identity, credit, banking and financing material is refused rather than stored", async () => {
  const { service } = await workspace();
  for (const bad of [
    { displayName: "A", ssn: "111-22-3333" },
    { displayName: "A", socialSecurityNumber: "111223333" },
    { displayName: "A", driversLicense: "X1234567" },
    { displayName: "A", creditScore: 700 },
    { displayName: "A", creditApplication: { amount: 1 } },
    { displayName: "A", bankAccount: "123456789" },
    { displayName: "A", routingNumber: "021000021" },
    { displayName: "A", cardNumber: "4111111111111111" },
    { displayName: "A", dateOfBirth: "1980-01-01" },
    { displayName: "A", income: 90000 },
  ]) {
    await assert.rejects(service.createCustomer(bad), /does not store identity, credit, banking, or financing material/u, JSON.stringify(Object.keys(bad)));
  }
  // The same refusal applies to values hidden inside free text.
  await assert.rejects(service.createCustomer({ displayName: "A", notes: "SSN 111-22-3333 on file" }), /social-security-formatted/u);
  await assert.rejects(service.createCustomer({ displayName: "A", notes: "card 4111 1111 1111 1111" }), /payment-card-length/u);
  // Ordinary descriptive detail is still perfectly acceptable.
  const ok = await service.createCustomer({ displayName: "A", notes: "Phone 555-0142. Interested in a hybrid; trade is a 2016 hatchback in fair condition." });
  assert.match(ok.notes, /2016 hatchback/u, "descriptive trade information is allowed; valuations and finance records are not");
});

test("relationship search answers the daily questions deterministically and never crosses workspaces", async () => {
  const { service } = await workspace();
  const walkIn = await service.createCustomer({ displayName: "Walk-in A", interests: [{ kind: "vehicle", description: "compact SUV" }] });
  const caller = await service.createCustomer({ displayName: "Caller B", interests: [{ kind: "vehicle", description: "midsize hybrid sedan" }] });
  const quiet = await service.createCustomer({ displayName: "Quiet C" });

  await service.addCustomerFollowUp(walkIn.id, { dueAt: "2030-01-01T09:00:00.000Z", channel: "phone", reason: "Callback about SUV." });
  await service.addCustomerAppointment(caller.id, { at: "2030-01-01T16:00:00.000Z", location: "showroom" });
  await service.recordCustomerInteraction(caller.id, { kind: "call", summary: "Spoke today." });
  await service.setCustomerLifecycle(quiet.id, "inactive", "No response.");

  const due = await service.findCustomers({ kind: "follow-up-due", onDate: "2030-01-01" });
  assert.deepEqual(due.map((c) => c.displayName), ["Walk-in A"]);
  const appointments = await service.findCustomers({ kind: "appointments-on", onDate: "2030-01-01" });
  assert.deepEqual(appointments.map((c) => c.displayName), ["Caller B"]);
  const hybrid = await service.findCustomers({ kind: "interested-in", text: "hybrid" });
  assert.deepEqual(hybrid.map((c) => c.displayName), ["Caller B"]);
  const callbacks = await service.findCustomers({ kind: "awaiting-callback" });
  assert.deepEqual(callbacks.map((c) => c.displayName), ["Walk-in A"]);
  const inactive = await service.findCustomers({ kind: "in-stage", stage: "inactive" });
  assert.deepEqual(inactive.map((c) => c.displayName), ["Quiet C"]);
  const stale = await service.findCustomers({ kind: "not-contacted-since", days: 0 });
  assert.equal(stale.some((c) => c.displayName === "Caller B"), false, "someone contacted today is not stale");
  assert.equal(stale.some((c) => c.displayName === "Quiet C"), true);

  const timeline = await service.customerTimeline(caller.id);
  assert.equal(timeline.last?.summary, "Spoke today.", "the last interaction is directly answerable");
  assert.equal(typeof timeline.nextAction.action, "string");

  await assert.rejects(service.findCustomers({ kind: "in-stage" }), /not recognised/u, "an unspecified stage fails closed");
  await assert.rejects(service.findCustomers({ kind: "sql-injection" } as never), /not recognised/u);
  // Deterministic ordering: the same query twice returns the same order.
  assert.deepEqual((await service.findCustomers({ kind: "all" })).map((c) => c.id), (await service.findCustomers({ kind: "all" })).map((c) => c.id));
});

test("relationships are Work-only and never leak into Personal", async () => {
  const { service } = await workspace();
  const customer = await service.createCustomer({ displayName: "Confidential D", notes: "Interested in a pickup." });
  await service.createMemory({ content: "Work note: D prefers mornings", category: "semantic" });

  await service.updateSettings({ activeWorkspace: "personal" });
  await assert.rejects(service.createCustomer({ displayName: "Should not exist" }), /Work workspace/u);
  await assert.rejects(service.updateCustomer(customer.id, { notes: "x" }), /Work workspace/u);
  await assert.rejects(service.findCustomers({ kind: "all" }), /Work workspace/u, "relationship search is unavailable in Personal");

  const personalSearch = await service.searchMemories("mornings");
  assert.deepEqual(personalSearch, [], "a work memory is invisible from Personal");
  const conversation = await service.createConversation("Personal chat");
  const turn = await service.sendMessage(conversation.id, "Hello");
  assert.doesNotMatch(turn.message.content, /enabled local memory/u, "no work memory is fed into a personal conversation");

  const state = await service.snapshot();
  assert.equal(state.customers.every((c) => c.workspace === "work"), true, "every relationship record stays in Work");
  assert.equal(state.memories.filter((m) => m.workspace === "personal").length, 0, "nothing was promoted into Personal");
});

test("archiving hides a relationship without deleting its history, and it can come back", async () => {
  const { service } = await workspace();
  const created = await service.createCustomer(prospect);
  await service.recordCustomerInteraction(created.id, { kind: "call", summary: "Only call." });
  const archived = await service.setCustomerArchived(created.id, true);
  assert.equal(archived.archived, true);
  assert.equal(archived.lifecycle, "inactive");
  assert.ok(archived.interactions.some((entry) => entry.summary === "Only call."), "history survives archiving");

  assert.deepEqual(await service.findCustomers({ kind: "all" }), [], "archived relationships are out of the daily view");
  assert.equal((await service.findCustomers({ kind: "all", includeArchived: true })).length, 1, "they remain findable on request");
  const restored = await service.setCustomerArchived(created.id, false);
  assert.equal(restored.archived, false);
  assert.equal(restored.interactions.filter((entry) => entry.kind === "lifecycle").length, 3);
});

test("relationships survive a restart byte for byte", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-sales-restart-"));
  const dataRoot = join(root, "private", "aion");
  const ports = () => ({
    repository: new FileStateRepositoryV1(dataRoot), clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()], capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(join(root, "exports")),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  const first = new AionAssistantV1(ports());
  await first.updateSettings({ activeWorkspace: "work", workspaceLabels: { personal: "Personal", work: FICTIONAL_DEALERSHIP } });
  const created = await first.createCustomer(prospect);
  await first.recordCustomerInteraction(created.id, { kind: "visit", summary: "Came in Saturday.", lifecycleAfter: "appointment-shown" });
  const before = (await first.snapshot()).customers;

  const reopened = await new AionAssistantV1(ports()).snapshot();
  assert.deepEqual(reopened.customers, before, "relationship records reload unchanged");
  assert.equal(reopened.settings.workspaceLabels.work, FICTIONAL_DEALERSHIP);
  assert.equal(reopened.customers[0]?.interactions.length, 2);
});

test("nothing in the Sales domain depends on a particular employer, brand, or CRM", async () => {
  const { service } = await workspace();
  // The same code serves a completely different sales role with no automotive vocabulary at all.
  await service.updateSettings({ workspaceLabels: { personal: "Personal", work: "Northwind Consulting" } });
  const b2b = await service.createCustomer({ displayName: "Acme Ltd (procurement)", source: "referral", interests: [{ kind: "other", description: "annual support retainer" }] });
  await service.recordCustomerInteraction(b2b.id, { kind: "email", summary: "Sent proposal.", lifecycleAfter: "engaged" });
  const found = await service.findCustomers({ kind: "interested-in", text: "retainer" });
  assert.deepEqual(found.map((c) => c.displayName), ["Acme Ltd (procurement)"]);
  assert.equal(found[0]?.lifecycle, "engaged");

  const state = await service.snapshot();
  const serialized = JSON.stringify(state.customers);
  for (const vendor of ["Toyota", "Lakeland", "VinSolutions", "Elead", "CDK", "Reynolds", "DealerSocket"]) {
    assert.equal(serialized.includes(vendor), false, `no ${vendor} concept is baked into a relationship record`);
  }
});

test("the query engine is a closed shape with no evaluated expression", () => {
  const now = "2030-01-01T12:00:00.000Z";
  const base: CustomerV1[] = [];
  assert.deepEqual(queryCustomers(base, { kind: "all" }, now), []);
  assert.throws(() => queryCustomers(base, { kind: "whatever" } as never, now), /not recognised/u);
  assert.deepEqual(queryCustomers(base, { kind: "interested-in", text: "" }, now), [], "an empty needle matches nothing rather than everything");
});
