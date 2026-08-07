import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  FileStateRepositoryV1, InMemoryStateRepositoryV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1,
  NodePrivateBackupV1, RELATIONSHIP_CORE_MIGRATION, SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  migrateStateV1, workspaceIdFromLabel,
} from "../src/index.js";
import type { AssistantStateV1 } from "../src/index.js";

/**
 * Every business, brand, person, and product below is invented. Nothing here resembles the
 * Founder's own work, employer, or customers, and no live state is read or written.
 */

async function assistant(repository?: InMemoryStateRepositoryV1) {
  const root = await mkdtemp(join(tmpdir(), "aion-workspace-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  const service = new AionAssistantV1({
    repository: repository ?? new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  return { root, service };
}

test("AION always provides Personal and Work, and they cannot be recreated or removed", async () => {
  const { service } = await assistant();
  const initial = await service.workspaces();
  assert.deepEqual(initial.map((w) => w.id), ["personal", "work"]);
  assert.equal(initial.every((w) => w.builtIn && !w.archived), true);
  assert.equal(initial.every((w) => w.brand === null), true, "a built-in workspace has no brand identity");

  await assert.rejects(() => service.createWorkspace({ label: "Personal", kind: "business", id: "personal" }), /built-in/iu);
  await assert.rejects(() => service.setWorkspaceArchived("work", true), /cannot be archived/iu);
  await assert.rejects(() => service.createWorkspace({ label: "Second job", kind: "work" }), /already exist/iu);
});

test("a business workspace is created empty and nothing is copied into it", async () => {
  const { service } = await assistant();
  // Put something in Personal and something in Work first, so "empty" means something.
  await service.createMemory({ content: "Personal preference: mornings", category: "semantic" });
  await service.updateSettings({ activeWorkspace: "work" });
  await service.createCustomer({ displayName: "T. Okafor (walk-in)" });
  await service.createMemory({ content: "Work note: showroom opens at nine", category: "semantic" });

  const brand = await service.createWorkspace({
    label: "Harbourline Goods", purpose: "A small side business.",
    brand: { name: "Harbourline", positioning: "Durable everyday carry", audience: "commuters", channels: ["web", "market stall"] },
  });
  assert.equal(brand.id, "harbourline-goods");
  assert.equal(brand.kind, "business");
  assert.equal(brand.brand?.positioning, "Durable everyday carry");
  assert.deepEqual(brand.brand?.channels, ["market stall", "web"], "channels are deduplicated and ordered deterministically");

  await service.updateSettings({ activeWorkspace: brand.id });
  const state = await service.snapshot();
  assert.equal(state.memories.filter((m) => m.workspace === brand.id).length, 0, "a new workspace starts with no memories");
  assert.equal(state.relationships.filter((r) => r.workspace === brand.id).length, 0, "and no relationships");
  assert.deepEqual(await service.searchMemories("preference"), [], "nothing from Personal is visible here");
  assert.deepEqual(await service.searchMemories("showroom"), [], "and nothing from Work either");
  assert.deepEqual(await service.findRelationships({ kind: "all" }), [], "the Work customer is not visible from the business");
});

test("workspace isolation holds in both directions once a third workspace exists", async () => {
  const { service } = await assistant();
  const brand = await service.createWorkspace({ label: "Kestrel Studio" });

  await service.updateSettings({ activeWorkspace: brand.id });
  const supplier = await service.createRelationship({ displayName: "Ridgeway Supply", relationshipType: "vendor", organisation: "Ridgeway", role: "account manager" });
  assert.equal(supplier.workspace, brand.id);
  assert.equal(supplier.relationshipType, "vendor");
  assert.equal(supplier.origin, "owner-created", "a record the owner made for their own business is theirs");

  await service.updateSettings({ activeWorkspace: "work" });
  assert.deepEqual(await service.findCustomers({ kind: "all" }), [], "the business vendor is not a Work customer");
  await assert.rejects(() => service.customerTimeline(supplier.id), /different workspace/iu);
  await assert.rejects(() => service.updateCustomer(supplier.id, { notes: "reached across" }), /different workspace/iu);

  await service.updateSettings({ activeWorkspace: "personal" });
  assert.deepEqual(await service.findRelationships({ kind: "all" }), [], "and nothing from either work context reaches Personal");
});

test("a relationship recorded while doing a job stays employer-owned by default", async () => {
  const { service } = await assistant();
  await service.updateSettings({ activeWorkspace: "work" });
  const atWork = await service.createRelationship({ displayName: "M. Halvorsen (enquiry)", relationshipType: "prospect" });
  assert.equal(atWork.origin, "employer-work", "AION does not quietly reclassify an employer's record as personal property");

  const brand = await service.createWorkspace({ label: "Alder & Co" });
  await service.updateSettings({ activeWorkspace: brand.id });
  const ownBusiness = await service.createRelationship({ displayName: "First customer", relationshipType: "customer" });
  assert.equal(ownBusiness.origin, "owner-created");
});

test("archiving a workspace hides it without touching a single record inside it", async () => {
  const { service } = await assistant();
  const brand = await service.createWorkspace({ label: "Tidewater Press" });
  await service.updateSettings({ activeWorkspace: brand.id });
  const contact = await service.createRelationship({ displayName: "Printer", relationshipType: "vendor" });
  await service.createMemory({ content: "Print runs take three weeks", category: "semantic" });

  await service.updateSettings({ activeWorkspace: "personal" });
  const archived = await service.setWorkspaceArchived(brand.id, true);
  assert.equal(archived.archived, true);
  await assert.rejects(() => service.updateSettings({ activeWorkspace: brand.id }), /archived/iu);

  const state = await service.snapshot();
  assert.equal(state.relationships.find((r) => r.id === contact.id)?.displayName, "Printer", "the record is still there");
  assert.equal(state.memories.filter((m) => m.workspace === brand.id).length, 1, "so is the memory");

  await service.setWorkspaceArchived(brand.id, false);
  await service.updateSettings({ activeWorkspace: brand.id });
  assert.equal((await service.findRelationships({ kind: "all" })).length, 1, "reactivating brings the workspace back intact");
});

test("a brand holds owner-supplied products and never invents one", async () => {
  const { service } = await assistant();
  const brand = await service.createWorkspace({ label: "Foxglove Tools", brand: { name: "Foxglove" } });
  assert.deepEqual(brand.brand?.products, [], "a new brand has no products until the owner adds one");

  const withProduct = await service.addBrandProduct(brand.id, { name: "Bench plane", summary: "A hand plane.", status: "in-development", pricingNote: "not decided" });
  assert.equal(withProduct.brand?.products.length, 1);
  assert.equal(withProduct.brand?.products[0]?.status, "in-development");

  const relabelled = await service.updateWorkspace(brand.id, { brand: { name: "Foxglove", positioning: "Hand tools for small shops" } });
  assert.equal(relabelled.brand?.products.length, 1, "editing brand identity never drops the products");
  await assert.rejects(() => service.addBrandProduct("work", { name: "Nothing" }), /business or brand/iu);
});

test("workspace identifiers are deterministic and refuse to collide", async () => {
  assert.equal(workspaceIdFromLabel("Harbourline Goods"), "harbourline-goods");
  assert.equal(workspaceIdFromLabel("  Harbourline   Goods  "), "harbourline-goods", "the same name always produces the same identifier");
  assert.throws(() => workspaceIdFromLabel("   "), /at least one letter/iu);
  assert.throws(() => workspaceIdFromLabel("2024"), /at least one letter/iu);

  const { service } = await assistant();
  await service.createWorkspace({ label: "Harbourline Goods" });
  await assert.rejects(() => service.createWorkspace({ label: "harbourline goods" }), /already exists/iu);
});

test("a label may only be set for a workspace that actually exists", async () => {
  const { service } = await assistant();
  await assert.rejects(() => service.updateSettings({ workspaceLabels: { personal: "Personal", work: "Work", ghost: "Somewhere else" } }), /does not exist/iu);
  const renamed = await service.updateSettings({ workspaceLabels: { personal: "Home", work: "Work" } });
  assert.equal(renamed.workspaceLabels.personal, "Home");
  const registry = await service.workspaces();
  assert.equal(registry.find((w) => w.id === "personal")?.label, "Home", "the registry and the label map never disagree");
});

test("workspaces and promoted relationships survive a restart unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-workspace-restart-"));
  const dataRoot = join(root, "private", "aion");
  const ports = () => ({
    repository: new FileStateRepositoryV1(dataRoot), clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()], capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(join(root, "exports")),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  const first = new AionAssistantV1(ports());
  const brand = await first.createWorkspace({ label: "Selkirk Bindery", brand: { name: "Selkirk" } });
  await first.updateSettings({ activeWorkspace: brand.id });
  await first.createRelationship({ displayName: "Paper merchant", relationshipType: "vendor" });
  const before = await first.snapshot();

  const reopened = await new AionAssistantV1(ports()).snapshot();
  assert.deepEqual(reopened.workspaces, before.workspaces, "the registry reloads unchanged");
  assert.deepEqual(reopened.relationships, before.relationships);
  assert.equal(reopened.revision, before.revision, "reopening writes no revision");
});

/**
 * A synthetic fixture in the *shape* of V1.1 state: the Work-only `customers` collection, with
 * invented values. No real relationship record is read, copied, or parsed.
 */
function v11Fixture(): AssistantStateV1 {
  const at = "2029-06-01T08:00:00.000Z";
  const provenance = { sourceType: "owner" as const, sourceRef: "owner-entry", recordedAt: at };
  return {
    schema: "aion.local-assistant-state.v1", revision: 4, onboardingComplete: true,
    settings: {
      providerId: "deterministic", model: "aion-offline-v1", remoteDisclosureAccepted: false,
      memoryContextEnabled: true, schedulerEnabled: true, externalActionsRequireApproval: true,
      importRoots: [], exportRoot: "", credentialEnvironmentVariable: "", developerBridgeId: "",
      activeWorkspace: "work", workspaceLabels: { personal: "Personal", work: "Bayfield Motors" },
      remoteAccess: { enabled: false, bindAddress: "127.0.0.1", sessionDays: 30 },
      privacy: { includeMemoryByDefault: true, retainActivityDays: 365 },
    },
    conversations: [], memories: [], tasks: [], routines: [], plans: [], actions: [], approvals: [],
    activity: [], imports: [], verifications: [], migrations: [],
    customers: [{
      id: "cust-1", reference: "customer:abcdef0123456789", workspace: "work",
      displayName: "R. Almeida (walk-in)", lifecycle: "negotiating", origin: "employer-work",
      contactMethods: [{ channel: "text", label: "mobile", value: "invented-contact" }],
      communicationPreference: "text", source: "showroom walk-in", notes: "Prefers evenings.",
      interests: [{ kind: "vehicle", description: "midsize hybrid sedan", notedAt: at }],
      objections: ["monthly payment"], preferences: ["evening calls"],
      appointments: [{ id: "appt-1", at, kind: "appointment", location: "showroom", status: "shown", notes: "", createdAt: at }],
      followUps: [{ id: "fu-1", dueAt: at, channel: "phone", reason: "confirm trade appraisal", status: "open", outcome: "", createdAt: at, completedAt: null }],
      nextAction: "call back", nextActionAt: at, lastContactAt: at,
      interactions: [{ id: "int-1", at, kind: "visit", summary: "Came in Saturday.", detail: "", lifecycleAfter: "appointment-shown", actor: "owner" }],
      taskIds: ["task-9"], routineIds: [], planIds: [],
      outcome: { state: "open", at: null, detail: "" }, archived: false, provenance, createdAt: at, updatedAt: at,
    }],
    salesMetrics: [], devices: [], sessions: [], pairingTokens: [], rateLimits: [],
  } as unknown as AssistantStateV1;
}

test("V1.1 customers are promoted into the Relationship Core with their history intact", () => {
  const before = v11Fixture();
  const { state, records } = migrateStateV1(before, "2030-01-01T00:00:00.000Z", (() => { let n = 0; return () => `migration-${n++}`; })());

  assert.ok(records.some((entry) => entry.migration === RELATIONSHIP_CORE_MIGRATION), "the promotion is recorded");
  assert.equal((state as unknown as { customers?: unknown }).customers, undefined, "the old collection is gone, not duplicated");
  assert.equal(state.relationships.length, 1);

  const promoted = state.relationships[0]!;
  const original = (before as unknown as { customers: Array<Record<string, unknown>> }).customers[0]!;
  assert.equal(promoted.id, "cust-1", "the identifier is preserved");
  assert.equal(promoted.reference, original.reference, "so is the stable reference");
  assert.equal(promoted.workspace, "work", "the record does not move workspace");
  assert.equal(promoted.relationshipType, "customer", "it declares the type it always had");
  assert.equal(promoted.lifecycle, "negotiating");
  assert.deepEqual(promoted.interactions, original.interactions, "the timeline is untouched");
  assert.deepEqual(promoted.appointments, original.appointments);
  assert.deepEqual(promoted.followUps, original.followUps);
  assert.deepEqual(promoted.taskIds, ["task-9"], "links to other AION records survive");
  assert.deepEqual(promoted.provenance, original.provenance);
  assert.equal(promoted.organisation, "", "the general fields are added empty rather than guessed at");
  assert.deepEqual(promoted.opportunityIds, []);
});

test("promoting relationships is idempotent and never runs twice", () => {
  const ids = (() => { let n = 0; return () => `migration-${n++}`; })();
  const first = migrateStateV1(v11Fixture(), "2030-01-01T00:00:00.000Z", ids);
  const second = migrateStateV1(first.state, "2030-01-01T00:00:00.000Z", ids);
  assert.equal(second.applied, false, "a second run applies nothing");
  assert.deepEqual(second.state, first.state, "and is byte-identical");
  assert.equal(first.state.relationships.length, 1, "the record is promoted exactly once");
});

test("the registry migration keeps the labels the owner already chose", () => {
  const { state } = migrateStateV1(v11Fixture(), "2030-01-01T00:00:00.000Z", (() => { let n = 0; return () => `migration-${n++}`; })());
  assert.deepEqual(state.workspaces.map((w) => w.label), ["Personal", "Bayfield Motors"], "the workspace the owner named keeps its name");
  assert.equal(state.workspaces.every((w) => w.builtIn), true, "migration invents no workspace the owner did not have");
});
