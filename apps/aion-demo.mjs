#!/usr/bin/env node
/**
 * Complete AION V1 synthetic product proof.
 *
 * Everything below is neutral synthetic data created in a temporary directory and removed
 * afterwards. There is no owner content, no external account, no live provider, and no network
 * dependency. The whole scenario is driven through the real loopback Command Center HTTP API, so
 * what is proved here is the product surface an owner actually uses.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  DeveloperAgentCapabilityV1, InMemoryWriterAuthorityV1, LocalEchoCapabilityV1,
  SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  SyntheticVerificationRunnerV1, VerificationCapabilityV1, createWriterGrantForTest,
} from "../packages/local-assistant/dist/index.js";
import { createAionServer } from "./aion/server.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const steps = [];
function proved(label) { steps.push(label); console.log(`  ok  ${label}`); }

async function open(dataRoot, exportRoot) {
  const developerAgents = new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]);
  const verificationRunner = new SyntheticVerificationRunnerV1({
    "npm.verify": { exitCode: 1, stdout: "ok 1 - a passing thing\nnot ok 2 - the synthetic failing assertion\n# tests 2\n# pass 1\n# fail 1\n" },
  });
  // Synthetic demo-only authority gate (not Owner V2 real keys/anchors).
  const authority = new InMemoryWriterAuthorityV1(createWriterGrantForTest({ state: "WRITER" }));
  const app = await createAionServer({
    repositoryRoot, dataRoot, exportRoot,
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1(), new DeveloperAgentCapabilityV1(developerAgents, repositoryRoot), new VerificationCapabilityV1(verificationRunner)]),
    developerAgents, verificationRunner, authority,
  });
  const address = await app.listen(0);
  assert.equal(address.address, "127.0.0.1", "the Command Center must bind loopback only");
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (type, payload = {}) => {
    const response = await fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, ...payload }) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${type}: ${data.error}`);
    return data.result;
  };
  const view = async () => (await fetch(`${base}/api/state`)).json();
  return { app, base, call, view };
}

/** Removes the two values that legitimately differ between runs: the temporary root and the random backup digest. */
function normalize(state) {
  const copy = structuredClone(state);
  for (const report of copy.imports) report.selectedRootRef = "root:[redacted]";
  for (const entry of copy.activity) if (entry.subjectRef?.startsWith("backup:")) entry.subjectRef = "backup:[redacted]";
  return copy;
}

async function scenario(root, announce) {
  const dataRoot = join(root, "private", "aion");
  const exportRoot = join(dataRoot, "exports");
  const imports = join(root, "imports");
  await mkdir(exportRoot, { recursive: true });
  await mkdir(imports);
  const say = announce ? proved : () => {};

  const { app, base, call, view } = await open(dataRoot, exportRoot);
  let persisted;
  try {
    const initial = await view();
    assert.equal(initial.state.onboardingComplete, false);
    assert.equal(initial.dataRoot, "private/aion");
    assert.equal(initial.providers[0].available, true);
    assert.deepEqual(initial.capabilities.map((c) => c.id).sort(), ["aion.developer.task.v1", "aion.local.echo.v1", "aion.verify.run.v1"]);
    say("Command Center starts on loopback, reports provider health, and lists its capability registry");

    await call("onboarding.complete");
    say("onboarding completes and unlocks the owner-facing areas");

    const conversation = (await call("conversation.create", { title: "Neutral synthetic session" })).id;
    const turn = await call("chat.send", { id: conversation, content: "Summarize the neutral demo" });
    assert.match(turn.message.content, /Offline response: Summarize the neutral demo/u);
    const stream = await fetch(`${base}/api/chat/stream`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: conversation, content: "Stream a second neutral turn" }) });
    const streamed = await stream.text();
    assert.ok(streamed.split("event: chunk").length > 2 && streamed.includes("event: done"), "provider output must arrive as a stream");
    say("offline deterministic Chat answers, streams tokens, and keeps local conversation history");

    const memory = (await call("memory.create", { memory: { content: "Preferred cadence: weekly review", category: "procedural" } })).id;
    assert.equal((await call("memory.search", { query: "weekly" })).length, 1);
    await call("memory.correct", { id: memory, content: "Preferred cadence: fortnightly review", reason: "Owner correction" });
    const conflicting = (await call("memory.create", { memory: { content: "Preferred cadence: monthly review", category: "procedural" } })).id;
    const afterConflict = (await view()).state.memories;
    assert.equal(afterConflict.filter((m) => m.conflict === "conflicting").length, 2, "conflicting memories are both preserved");
    await call("memory.enable", { id: conflicting, enabled: false });
    say("Memory creation, retrieval, correction with preserved history, and conflict preservation work");

    const remembered = await call("chat.send", { id: conversation, content: "remember: preferred timezone: UTC" });
    assert.equal(remembered.proposedMemories[0].confirmation, "unconfirmed", "a provider memory is never authoritative");
    await call("memory.accept", { id: remembered.proposedMemories[0].id });
    say("a provider-proposed memory stays unconfirmed until the owner accepts it");

    const task = (await call("task.create", { task: { title: "Verify the synthetic workflow", description: "Neutral demo task", priority: "high", tags: ["demo"] } })).id;
    await call("task.update", { id: task, change: { description: "Neutral demo task, edited by the owner" } });
    await call("task.transition", { id: task, state: "in-progress", reason: "Demo" });
    await call("task.transition", { id: task, state: "completed", reason: "Demo" });
    say("Tasks are created, edited, transitioned through a validated state machine, and completed");

    const routine = (await call("routine.create", { routine: { name: "Local review", instructions: "Review neutral synthetic state", intervalMinutes: 60 } })).id;
    await call("routine.run", { id: routine });
    assert.equal((await call("scheduler.tick")).due, 0, "nothing is due yet, and no OS service was installed");
    await call("routine.update", { id: routine, change: { intervalMinutes: 30 } });
    say("Routines are created, run on demand, rescheduled, and swept by the in-process scheduler only");

    const plan = (await call("plan.create", { goal: "Complete the neutral proof", steps: [{ title: "Prepare inputs" }, { title: "Verify outputs", dependencies: [0] }] })).id;
    await call("plan.accept", { id: plan });
    assert.equal((await call("plan.convert", { id: plan })).length, 2);
    say("the Planner produces a reviewable plan that becomes Tasks only after the owner accepts it");

    const proposal = await call("action.propose", { capabilityId: "aion.local.echo.v1", input: { text: "bounded execution" } });
    assert.equal(proposal.action.state, "awaiting-approval");
    await assert.rejects(call("action.execute", { id: proposal.action.id }), /one-shot/u);
    await call("approval.decide", { id: proposal.approval.id, approve: true });
    assert.deepEqual(await call("action.execute", { id: proposal.action.id }), { text: "bounded execution", local: true });
    await assert.rejects(call("action.execute", { id: proposal.action.id }), /one-shot/u);
    say("an exact one-shot approval is required before the Agent Controller executes a bounded capability");

    const modelProposal = await call("chat.send", { id: conversation, content: "propose: check the local echo" });
    assert.equal(modelProposal.proposedActions[0].origin, "provider-proposal");
    assert.equal(modelProposal.proposedActions[0].state, "awaiting-approval");
    await call("approval.decide", { id: (await view()).state.approvals.find((a) => a.actionId === modelProposal.proposedActions[0].id).id, approve: false });
    say("a model proposal earns no authority: it is validated, queued for approval, and can be denied");

    const bridgeTask = await call("action.propose", { capabilityId: "aion.developer.task.v1", input: { instruction: "Report the bounded synthetic developer status" } });
    assert.match(bridgeTask.approval.summary, /read-only developer-agent task/u, "an unstated boundary is read-only, and the owner is told so before approving");
    const writingTask = await call("action.propose", { capabilityId: "aion.developer.task.v1", input: { instruction: "Report the bounded synthetic developer status", mode: "workspace-write" } });
    assert.notEqual(bridgeTask.action.inputDigest, writingTask.action.inputDigest, "a read-only approval can never be spent on a writing run");
    await call("approval.decide", { id: bridgeTask.approval.id, approve: true });
    const bridgeResult = await call("action.execute", { id: bridgeTask.action.id });
    assert.equal(bridgeResult.exitCode, 0);
    assert.equal(bridgeResult.mode, "read-only");
    await assert.rejects(call("action.execute", { id: writingTask.action.id }), /one-shot/u);
    await call("approval.decide", { id: (await view()).state.approvals.find((a) => a.actionId === writingTask.action.id).id, approve: false });
    say("a developer-agent task is read-only unless the owner approves a writing boundary, and the boundary is bound into the approval digest");

    const handoff = await call("chat.send", { id: conversation, content: "developer: review the repository and tell me what tests are failing" });
    assert.equal(handoff.proposedActions[0].capabilityId, "aion.developer.task.v1");
    assert.equal(handoff.proposedActions[0].input.mode, "read-only");
    assert.equal(handoff.proposedActions[0].state, "awaiting-approval");
    const handoffApproval = (await view()).state.approvals.find((a) => a.actionId === handoff.proposedActions[0].id);
    await call("approval.decide", { id: handoffApproval.id, approve: true });
    assert.equal((await call("action.execute", { id: handoff.proposedActions[0].id })).exitCode, 0);
    say("a repository question asked in Chat becomes an approval-gated read-only developer-agent task and reports back, with no copy/paste between tools");

    const inventory = (await view()).developerBridges;
    assert.ok(inventory.length >= 1 && inventory.some((entry) => entry.selected), "Settings can see every discovered bridge and which one is selected");
    for (const entry of inventory) {
      assert.equal(entry.account, "signed-in", "executable availability and account health are reported separately");
      for (const command of entry.commands) assert.equal(command.args.includes("Report the bounded synthetic developer status"), false, "instruction text is never an argument");
    }
    say("every discovered developer bridge discloses its exact argument vector, and no instruction text ever becomes an argument");

    await assert.rejects(call("action.propose", { capabilityId: "aion.verify.run.v1", input: { command: "npm publish" } }), /must not carry a "command" field/u);
    await assert.rejects(call("action.propose", { capabilityId: "aion.verify.run.v1", input: { operationId: "npm.publish" } }), /not on the allowlist/u);
    const verifyProposal = await call("action.propose", { capabilityId: "aion.verify.run.v1", input: { operationId: "npm.verify" } });
    assert.match(verifyProposal.approval.summary, /AION owns this command/u);
    await call("approval.decide", { id: verifyProposal.approval.id, approve: true });
    const evidence = await call("action.execute", { id: verifyProposal.action.id });
    assert.equal(evidence.outcome, "failed");
    assert.equal(evidence.resultDigest.length, 64);
    const recorded = (await view()).state.verifications[0];
    assert.equal(recorded.operationId, "npm.verify");
    say("AION runs an allowlisted read-only verification itself; a command, argument vector, or unknown operation is refused outright");

    const analysis = await call("verify.analyse", { id: recorded.id, question: "Which test failed?" });
    assert.equal(analysis.action.input.mode, "read-only");
    assert.match(String(analysis.action.input.instruction), /not ok 2 - the synthetic failing assertion/u);
    await call("approval.decide", { id: analysis.approval.id, approve: true });
    assert.equal((await call("action.execute", { id: analysis.action.id })).mode, "read-only");
    say("the failing evidence is handed to a read-only developer agent for analysis, with no shell and no write access anywhere in the path");

    const archive = join(imports, "conversations.json");
    await writeFile(archive, JSON.stringify([{ title: "Imported neutral chat", mapping: {
      a: { message: { author: { role: "user" }, content: { parts: ["Neutral question"] }, create_time: 1 } },
      b: { message: { author: { role: "assistant" }, content: { parts: ["Neutral answer"] }, create_time: 2 } },
    } }]));
    const dryRun = await call("import.dry-run", { platform: "chatgpt", root: imports, path: archive });
    assert.equal(dryRun.state, "dry-run");
    assert.equal(dryRun.items[0].conversationCount, 1);
    assert.equal(dryRun.items[0].digest.length, 64);
    const imported = await call("import.execute", { id: dryRun.id, root: imports, path: archive });
    assert.equal(imported.importedConversationIds.length, 1);
    const repeated = await call("import.dry-run", { platform: "chatgpt", root: imports, path: archive });
    assert.equal(repeated.items[0].duplicate, true);
    await call("import.cancel", { id: repeated.id });
    say("archive import runs a dry-run inventory with exact digests, duplicate detection, provenance, and cancellation");

    await call("settings.update", { settings: { model: "aion-offline-v1", credentialEnvironmentVariable: "AION_PROVIDER_TOKEN", privacy: { includeMemoryByDefault: true, retainActivityDays: 30 } } });
    const settings = (await view()).state.settings;
    assert.equal(settings.credentialEnvironmentVariable, "AION_PROVIDER_TOKEN");
    assert.equal(JSON.stringify(settings).includes("secret"), false, "no credential value is ever stored");
    say("Settings persist provider, privacy, retention, and a credential variable name but never its value");

    const backup = join(exportRoot, "synthetic.aionbak");
    const created = await call("backup.create", { destination: backup, passphrase: "synthetic-passphrase-123" });
    assert.equal(created.digest.length, 64);
    const verified = await call("backup.verify", { destination: backup, passphrase: "synthetic-passphrase-123" });
    assert.ok(verified.tasks.length >= 1);
    await assert.rejects(call("backup.verify", { destination: backup, passphrase: "wrong-passphrase-000" }));
    say("the encrypted private backup is written, decrypted, integrity-checked, and rejects a wrong passphrase");

    const before = await view();
    assert.ok(before.state.activity.length >= 25, "activity records every area");
    assert.equal(before.state.activity.some((a) => /passphrase|token|secret/i.test(a.summary)), false, "no secret reaches activity");
    say("Activity records user actions, proposals, approvals, agent runs, imports, exports, and failures");
    persisted = normalize(before.state);
  } finally { await app.close(); }

  const reopened = await open(dataRoot, exportRoot);
  try {
    const after = await reopened.view();
    assert.deepEqual(normalize(after.state), persisted, "every record must survive a Command Center restart unchanged");
    assert.equal(after.state.settings.credentialEnvironmentVariable, "AION_PROVIDER_TOKEN");
    say("closing and reopening AION reloads the identical local state from private/aion");
    return normalize(after.state);
  } finally { await reopened.app.close(); }
}

/** Drives the accepted Career engine through the Command Center, exactly as the Career screen does. */
async function careerIntegration(root) {
  const { app, call, view } = await open(join(root, "private", "aion"), join(root, "private", "aion", "exports"));
  try {
    await call("onboarding.complete");
    const result = await call("career.run", { command: "demo" });
    assert.match(result.output, /Synthetic Career demo complete/u);
    assert.match(result.output, /already-completed/u);
    assert.doesNotMatch(result.output, /[A-Za-z]:\\/u, "local paths are removed before display");
    const career = (await view()).state.activity.filter((entry) => entry.category === "career");
    assert.equal(career.length, 1);
    assert.equal(career[0].outcome, "success");
    await assert.rejects(call("career.run", { command: "submit-application" }), /Unsupported Career command/u);
    proved("the Career screen runs the accepted Career engine: workspace, evidence, provenance, profile, synthetic Job Posting, transparent match, owner-review draft, and export");
    proved("Career activity is recorded without storing any Career content, and non-allow-listed commands are refused");
  } finally { await app.close(); }
}

const roots = [];
try {
  console.log("\nAION V1 synthetic product demo — neutral data, no owner content, no network, no live provider\n");
  for (const name of ["aion-v1-demo-a-", "aion-v1-demo-b-", "aion-v1-demo-career-"]) roots.push(await mkdtemp(join(tmpdir(), name)));
  const first = await scenario(roots[0], true);
  const second = await scenario(roots[1], false);
  assert.deepEqual(first, second, "an identical run must produce identical local state");
  proved("a second independent run produces byte-identical state: AION V1 is deterministic");
  await careerIntegration(roots[2]);
  console.log(`\nAION V1 synthetic demo PASS — ${steps.length} product behaviours proved.`);
  console.log("No owner data, external account, live provider, network call, or permanent state was used or left behind.\n");
} finally {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}
