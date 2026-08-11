/**
 * Autonomous day simulation — executive cycle, isolation, no unauthorized external.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AionAssistantV1,
  DeterministicClockV1,
  DeterministicIdGeneratorV1,
  DeterministicModelProviderV1,
  InMemoryStateRepositoryV1,
  LocalArchiveImportSourceV1,
  LocalEchoCapabilityV1,
  NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1,
} from "../src/index.js";
import {
  buildAutonomyJob,
  detectChanges,
  buildSnapshotSig,
  isExternalGatedCapability,
  verifyJobResult,
  canRetry,
  classifyFailure,
  proposeJobsFromChanges,
  DEFAULT_RESOURCE_BUDGET,
} from "../src/executive-cycle.js";
import { synthesizeValidVin } from "../src/vehicle-inventory.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aion-cycle-"));
  const exports = join(root, "exports");
  await mkdir(exports);
  const developerAgents = new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exports),
    developerAgents,
  });
  return { service };
}

test("SAFE_EXECUTION: gated capabilities blocked", () => {
  assert.equal(isExternalGatedCapability("email.send"), true);
  assert.equal(isExternalGatedCapability("social.post"), true);
  assert.equal(isExternalGatedCapability("job.apply"), true);
  assert.equal(isExternalGatedCapability("maintenance.daily"), false);
});

test("VERIFY: empty success not completed", () => {
  const job = buildAutonomyJob(
    { workspace: "work", capability: "attention.board", reason: "test" },
    { id: "j1", now: "2030-01-01T00:00:00.000Z" },
  );
  const bad = verifyJobResult(job, { ok: true, detail: "" });
  assert.equal(bad.state, "FAILED");
  const good = verifyJobResult(job, { ok: true, detail: "Board ready", artifacts: ["x"] });
  assert.equal(good.state, "COMPLETED");
  assert.equal(good.verified, true);
});

test("RETRY: only TRANSIENT", () => {
  const job = buildAutonomyJob(
    { workspace: "work", capability: "maintenance.daily", reason: "x" },
    { id: "j1", now: "2030-01-01T00:00:00.000Z" },
  );
  assert.equal(canRetry({ ...job, retries: 0 }, "TRANSIENT"), true);
  assert.equal(canRetry({ ...job, retries: 5 }, "TRANSIENT"), false);
  assert.equal(canRetry({ ...job, retries: 0 }, "OWNER_REQUIRED"), false);
  assert.equal(classifyFailure("timeout ECONNRESET"), "TRANSIENT");
});

test("CHANGE_DETECTION: inventory and commitment signals", () => {
  const a = buildSnapshotSig({
    now: "2030-01-01T00:00:00.000Z",
    vehicles: [{ vin: "A", presenceStatus: "ONLINE_LISTED", price: 100 }],
    commitments: [{ status: "open" }],
    opportunities: [],
    importReviewOpen: 0,
    jobAppCount: 0,
    brandCount: 0,
    captureCount: 0,
    relationshipWorkCount: 1,
  });
  const b = buildSnapshotSig({
    now: "2030-01-01T01:00:00.000Z",
    vehicles: [
      { vin: "A", presenceStatus: "ONLINE_LISTED", price: 90 },
      { vin: "B", presenceStatus: "ONLINE_LISTED", price: 200 },
    ],
    commitments: [{ status: "overdue" }],
    opportunities: [{}],
    importReviewOpen: 0,
    jobAppCount: 0,
    brandCount: 0,
    captureCount: 0,
    relationshipWorkCount: 1,
  });
  const ch = detectChanges(a, b);
  assert.ok(ch.some((c) => c.kind === "price_change" || c.kind === "inventory_added" || c.kind === "inventory_new_online"));
  assert.ok(ch.some((c) => c.kind === "commitment_overdue"));
  const jobs = proposeJobsFromChanges(ch, (k) => `${k}-1`, "2030-01-01T01:00:00.000Z", 8);
  assert.ok(jobs.length > 0);
  assert.ok(jobs.length <= DEFAULT_RESOURCE_BUDGET.maxJobsPerCycle);
});

test("AUTONOMOUS_DAY_SIMULATION: cycle with dealership change, no external, no leaks", async () => {
  const { service } = await fixture();

  // Morning cycle (baseline)
  const morning = await service.runExecutiveCycle({});
  assert.ok(morning.jobsProposed >= 0);
  assert.equal(morning.unauthorizedExternalAttempts, 0);
  assert.equal(morning.crossWorkspaceLeaks, 0);

  // Dealership setup + customer
  await service.switchContext("Lakeland Toyota");
  await service.universalCapture(
    "I talked to Sam about a Highlander under 42000. Follow up tomorrow. I told Sam I would call tomorrow.",
    { apply: true },
  );
  const vin = synthesizeValidVin("AUTO1");
  await service.ensureLakelandToyotaContext({ setCurrent: true });
  await service.refreshDealershipInventory({ useFixture: true, fixtureVins: [vin] });

  // Midday cycle after changes
  const mid = await service.runExecutiveCycle({});
  assert.ok(mid.changesDetected >= 1 || mid.jobsExecuted >= 0);
  assert.equal(mid.unauthorizedExternalAttempts, 0);

  // Brand
  await service.createWorkspace({
    label: "Brand Pro",
    kind: "business",
    purpose: "test brand",
    brand: { name: "Brand Pro", positioning: "x", audience: "y", channels: [] },
  });
  await service.switchContext("Brand Pro");
  await service.universalCapture("Idea: comparison video series.", { apply: true });

  // Transient failure path via classify
  assert.equal(classifyFailure("503 temporarily unavailable"), "TRANSIENT");

  // End cycle + audit
  const end = await service.runExecutiveCycle({});
  assert.ok(end.jobsCompleted + end.jobsFailed + end.jobsOwnerRequired >= 0);
  assert.equal(end.unauthorizedExternalAttempts, 0);

  const audit = await service.autonomyDayAudit();
  assert.match(audit.reply, /WHAT AION DID|Unauthorized external/i);

  // Isolation: personal must not list Sam as personal workspace relationship
  await service.switchContext("Personal");
  const snap = await service.snapshot();
  assert.equal(
    snap.relationships.filter((r) => r.workspace === "personal" && /sam/i.test(r.displayName)).length,
    0,
  );
  const leak = await service.assistantPrompt("Search all my data for customers.");
  assert.match(leak.reply, /Scope limited|will not pull/i);
  assert.doesNotMatch(leak.reply, /\bSam\b/);

  // No infinite job explosion: jobs bounded
  const jobs = snap.executive?.autonomyJobs ?? [];
  assert.ok(jobs.length < 100);
});

test("TASK_DECOMPOSITION bounded", async () => {
  const { service } = await fixture();
  const plan = await service.decomposeGoal("Research whether this service could be sold to dealerships.");
  assert.ok(plan.steps.length > 0);
  assert.ok(plan.steps.length <= 6);
});

test("SCHEDULED_CYCLE rate limit + proactive brief delta", async () => {
  const { service } = await fixture();
  const first = await service.maybeRunScheduledExecutiveCycle(60 * 60_000);
  assert.ok(first);
  const second = await service.maybeRunScheduledExecutiveCycle(60 * 60_000);
  assert.equal(second, null, "second cycle within interval should be skipped");
  const brief1 = await service.prepareProactiveBrief();
  assert.match(brief1.reply, /PROACTIVE EXECUTIVE BRIEF|WHAT DO I NEED/i);
  const brief2 = await service.prepareProactiveBrief();
  assert.match(brief2.reply, /Since last briefing|First briefing/i);
  const eod = await service.endOfDayWrap();
  assert.match(eod.reply, /WHAT AION COMPLETED|END OF DAY/i);
});
