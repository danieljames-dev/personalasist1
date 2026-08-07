import assert from "node:assert/strict";
import test from "node:test";
import {
  AionAssistantV1, DEFAULT_WORKSPACE, DeterministicClockV1, DeterministicIdGeneratorV1,
  DeterministicModelProviderV1, InMemoryStateRepositoryV1, LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1, NodePrivateBackupV1, SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1, WORKSPACE_MIGRATION,
  createEmptyStateV1, migrateStateV1, validateStateV1,
} from "../src/index.js";
import type { AssistantStateV1 } from "../src/index.js";

/**
 * A synthetic fixture reproducing the *shape* of persisted state written before workspaces
 * existed: the same schema string and structural versions, with neutral invented values. No real
 * owner state is read, copied, parsed, or mutated anywhere in this suite.
 */
function preWorkspaceFixture(): AssistantStateV1 {
  const at = "2029-06-01T08:00:00.000Z";
  const provenance = { sourceType: "owner" as const, sourceRef: "owner-entry", recordedAt: at };
  const state = {
    schema: "aion.local-assistant-state.v1",
    revision: 7,
    onboardingComplete: true,
    settings: {
      providerId: "deterministic", model: "aion-offline-v1", remoteDisclosureAccepted: false,
      memoryContextEnabled: true, schedulerEnabled: true, externalActionsRequireApproval: true,
      importRoots: [], exportRoot: "", credentialEnvironmentVariable: "AION_PROVIDER_TOKEN",
      privacy: { includeMemoryByDefault: true, retainActivityDays: 200 },
    },
    conversations: [{ id: "conv-1", title: "Neutral thread", state: "active", memoryContextEnabled: true, createdAt: at, updatedAt: at, messages: [{ id: "msg-1", role: "owner", content: "Neutral question", createdAt: at, providerId: null }] }],
    memories: [{ id: "mem-1", content: "Neutral preference: mornings", category: "semantic", confirmation: "owner-confirmed", conflict: "none", enabled: true, createdAt: at, updatedAt: at, sourceTimestamp: at, provenance, corrections: [{ at, previousContent: "Neutral preference: evenings", correctedContent: "Neutral preference: mornings", reason: "Owner correction" }] }],
    tasks: [{ id: "task-1", title: "Neutral task", description: "", priority: "normal", state: "ready", dueAt: null, tags: ["neutral"], planId: "plan-1", routineId: "routine-1", createdAt: at, completedAt: null, provenance, history: [{ at, actor: "owner", change: "created:ready" }] }],
    routines: [{ id: "routine-1", name: "Neutral routine", instructions: "Review neutral state", enabled: true, intervalMinutes: 60, nextRunAt: at, lastRunAt: null, capabilityIds: [], approvalPolicy: "capability-default", createdAt: at, history: [{ at, actor: "owner", change: "created:enabled" }] }],
    plans: [{ id: "plan-1", goal: "Neutral goal", status: "accepted", createdAt: at, provenance, steps: [{ id: "step-1", order: 1, title: "Neutral step", description: "", dependencies: [], requiredCapabilities: [], approvalRequired: false, expectedOutput: "Completed step", status: "converted", blockedReason: null, taskId: "task-1" }] }],
    actions: [], approvals: [],
    activity: [{ id: "act-1", at, category: "task", action: "task.create", summary: "Task created.", subjectRef: "task-1", outcome: "success" }],
    imports: [],
  };
  return state as unknown as AssistantStateV1;
}

const clock = () => "2030-01-01T00:00:00.000Z";
const ids = () => { let n = 0; return () => `migration-${n++}`; };

test("every pre-workspace record migrates to PERSONAL with nothing else changed", () => {
  const before = preWorkspaceFixture();
  const { state, applied, record } = migrateStateV1(before, clock(), ids());
  assert.equal(applied, true);
  assert.equal(record?.migration, WORKSPACE_MIGRATION);
  assert.equal(record?.defaultWorkspace, "personal");
  assert.deepEqual(record?.assigned, { conversations: 1, memories: 1, tasks: 1, routines: 1, plans: 1, activity: 1, settings: 2 });

  for (const collection of ["conversations", "memories", "tasks", "routines", "plans", "activity"] as const) {
    for (const item of state[collection] as Array<{ workspace: string }>) assert.equal(item.workspace, DEFAULT_WORKSPACE, `${collection} migrated to the documented default`);
  }
  assert.equal(state.settings.activeWorkspace, "personal");
  assert.deepEqual(state.settings.workspaceLabels, { personal: "Personal", work: "Work" });
  assert.equal(state.migrations.length, 1);
});

test("identifiers, provenance, history, timestamps and relationships survive the migration exactly", () => {
  const before = preWorkspaceFixture();
  const { state } = migrateStateV1(before, clock(), ids());

  // Strip only the field the migration is allowed to add; everything else must be untouched.
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === "object") {
      const copy: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) if (key !== "workspace") copy[key] = strip(inner);
      return copy;
    }
    return value;
  };
  const expected = strip(before) as Record<string, unknown>;
  const actual = strip(state) as Record<string, unknown>;
  // The migration legitimately adds these two; compare everything else byte for byte.
  delete (actual as { migrations?: unknown }).migrations;
  delete (expected as { migrations?: unknown }).migrations;
  delete ((actual.settings as Record<string, unknown>)).activeWorkspace;
  delete ((actual.settings as Record<string, unknown>)).workspaceLabels;
  assert.deepEqual(actual, expected, "the migration adds a workspace and changes nothing else");

  const task = state.tasks[0]!;
  assert.equal(task.id, "task-1");
  assert.equal(task.planId, "plan-1", "relationships are preserved");
  assert.equal(task.routineId, "routine-1");
  assert.equal(state.plans[0]?.steps[0]?.taskId, "task-1", "the reverse relationship is preserved");
  assert.equal(state.memories[0]?.corrections.length, 1, "correction history is preserved");
  assert.equal(state.memories[0]?.provenance.recordedAt, "2029-06-01T08:00:00.000Z", "provenance and timestamps are preserved");
  assert.equal(state.conversations[0]?.messages[0]?.id, "msg-1", "nested records are preserved");
});

test("the migration is idempotent: a second run changes nothing and records nothing new", () => {
  const first = migrateStateV1(preWorkspaceFixture(), clock(), ids());
  const second = migrateStateV1(first.state, clock(), ids());
  assert.equal(second.applied, false, "rerunning applies nothing");
  assert.equal(second.record, null);
  assert.deepEqual(second.state, first.state, "rerunning is byte-identical");
  const third = migrateStateV1(second.state, clock(), ids());
  assert.deepEqual(third.state, first.state);
});

test("migration never creates a WORK record and never moves one across the boundary", () => {
  const fixture = preWorkspaceFixture();
  (fixture.memories[0] as { workspace?: string }).workspace = "work";
  const { state, record } = migrateStateV1(fixture, clock(), ids());
  assert.equal(state.memories[0]?.workspace, "work", "an existing workspace is respected, not reassigned");
  assert.equal(record?.assigned.memories, 0);
  assert.equal(state.tasks[0]?.workspace, "personal");
  assert.equal(state.conversations.every((c) => c.workspace === "personal"), true);
  assert.equal((state.memories as Array<{ workspace: string }>).filter((m) => m.workspace === "work").length, 1, "exactly the record that was already work stays work");
});

test("malformed or unsupported state fails closed rather than being guessed at", () => {
  const badWorkspace = preWorkspaceFixture();
  (badWorkspace.tasks[0] as { workspace?: string }).workspace = "confidential";
  assert.throws(() => migrateStateV1(badWorkspace, clock(), ids()), /unrecognised workspace/iu);

  const badActive = preWorkspaceFixture();
  (badActive.settings as { activeWorkspace?: string }).activeWorkspace = "elsewhere";
  assert.throws(() => migrateStateV1(badActive, clock(), ids()), /unrecognised active workspace/iu);

  const missingCollection = preWorkspaceFixture() as unknown as Record<string, unknown>;
  delete missingCollection.tasks;
  assert.throws(() => migrateStateV1(missingCollection as unknown as AssistantStateV1, clock(), ids()), /incomplete/iu);

  assert.throws(() => validateStateV1({ schema: "aion.local-assistant-state.v99", revision: 0 }), /unsupported/iu);
});

test("a loaded pre-workspace state migrates once on startup, is audited, and does not churn on reopen", async () => {
  const repository = new InMemoryStateRepositoryV1();
  await repository.save(0, { ...preWorkspaceFixture(), revision: 1 });
  const ports = () => ({
    repository, clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()], capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(process.cwd()),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  const first = await new AionAssistantV1(ports()).snapshot();
  assert.equal(first.tasks[0]?.workspace, "personal");
  assert.equal(first.migrations.length, 1);
  const audited = first.activity.find((entry) => entry.action === "state.migrate");
  assert.ok(audited, "the migration is recorded in Activity");
  assert.match(audited!.summary, /nothing moved between workspaces/u);
  const revisionAfterMigration = first.revision;

  const reopened = await new AionAssistantV1(ports()).snapshot();
  assert.equal(reopened.revision, revisionAfterMigration, "reopening does not write another revision");
  assert.equal(reopened.migrations.length, 1, "the migration is recorded once");
});

test("a fresh state needs no migration at all", () => {
  const empty = createEmptyStateV1();
  assert.equal(empty.settings.activeWorkspace, "personal");
  assert.deepEqual(empty.migrations, []);
  const { applied, record, state } = migrateStateV1(empty, clock(), ids());
  assert.equal(applied, false, "state born workspace-aware needs no migration and writes no revision");
  assert.equal(record, null);
  assert.deepEqual(state.migrations, [], "nothing is recorded when nothing was assigned");
});
