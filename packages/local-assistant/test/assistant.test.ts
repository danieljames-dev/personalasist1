import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, ClaudeCodeCliDeveloperAgentBridgeV1, CodexCliDeveloperAgentBridgeV1,
  DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  DeveloperAgentCapabilityV1, FileStateRepositoryV1, InMemoryStateRepositoryV1,
  LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1, SyntheticVerificationRunnerV1,
  UnavailableDeveloperAgentBridgeV1, VerificationCapabilityV1,
} from "../src/index.js";
import type { CapabilityV1, ClockV1, DeveloperAgentBridgeV1 } from "../src/index.js";

/** A clock the test drives explicitly, for expiry and retention behaviour. */
class SteppableClock implements ClockV1 {
  constructor(private instant = Date.parse("2030-01-01T00:00:00.000Z")) {}
  now(): string { return new Date(this.instant).toISOString(); }
  advance(milliseconds: number): void { this.instant += milliseconds; }
}

async function fixture(overrides: { clock?: ClockV1; bridges?: readonly DeveloperAgentBridgeV1[]; capabilities?: readonly CapabilityV1[] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "aion-assistant-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  const developerAgents = new SelectableDeveloperAgentRegistryV1(overrides.bridges ?? [new SyntheticDeveloperAgentBridgeV1()]);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(), clock: overrides.clock ?? new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(), providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1(), new DeveloperAgentCapabilityV1(developerAgents, root), ...(overrides.capabilities ?? [])]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports), developerAgents,
  });
  return { root, exports, service, developerAgents };
}

test("offline chat persists history and uses enabled memory context", async () => {
  const { service } = await fixture();
  const memory = await service.createMemory({ content: "Use concise summaries.", category: "procedural" });
  const conversation = await service.createConversation("Test");
  const turn = await service.sendMessage(conversation.id, "Hello");
  assert.match(turn.message.content, /Offline response: Hello/);
  assert.match(turn.message.content, /1 enabled local memory/);
  await service.setMemoryEnabled(memory.id, false);
  assert.equal((await service.snapshot()).conversations[0]?.messages.length, 2);
});

test("chat streams provider chunks before the turn is persisted", async () => {
  const { service } = await fixture();
  const conversation = await service.createConversation("Streaming");
  const chunks: string[] = [];
  const stream = service.streamMessage(conversation.id, "Hello");
  for (;;) { const step = await stream.next(); if (step.done) break; chunks.push(step.value); }
  assert.ok(chunks.length > 1, "provider output arrived as multiple chunks");
  assert.equal(chunks.join(""), (await service.snapshot()).conversations[0]?.messages[1]?.content);
});

test("a provider proposal never executes and never self-confirms", async () => {
  const { service } = await fixture();
  const conversation = await service.createConversation("Proposals");
  const turn = await service.sendMessage(conversation.id, "propose: run the bounded echo");
  assert.equal(turn.proposedActions.length, 1);
  assert.equal(turn.proposedActions[0]?.origin, "provider-proposal");
  assert.equal(turn.proposedActions[0]?.state, "awaiting-approval");
  assert.doesNotMatch(turn.message.content, /AION-PROPOSE/u);
  await assert.rejects(service.executeAction(turn.proposedActions[0]!.id), /approval/iu);

  const remembered = await service.sendMessage(conversation.id, "remember: preferred cadence: weekly");
  assert.equal(remembered.proposedMemories[0]?.confirmation, "unconfirmed");
  assert.equal(remembered.proposedMemories[0]?.provenance.sourceType, "provider-proposal");
  await service.acceptMemory(remembered.proposedMemories[0]!.id);
  assert.equal((await service.snapshot()).memories.find((item) => item.id === remembered.proposedMemories[0]!.id)?.confirmation, "owner-confirmed");
});

test("memory correction preserves history and forget removes the record", async () => {
  const { service } = await fixture();
  const memory = await service.createMemory({ content: "First", category: "semantic" });
  await service.correctMemory(memory.id, "Second", "Owner correction");
  assert.equal((await service.snapshot()).memories[0]?.corrections[0]?.previousContent, "First");
  await service.forgetMemory(memory.id);
  assert.equal((await service.snapshot()).memories.length, 0);
});

test("conflicting memories about one subject are both preserved and flagged", async () => {
  const { service } = await fixture();
  const first = await service.createMemory({ content: "Preferred timezone: UTC", category: "semantic" });
  const second = await service.createMemory({ content: "Preferred timezone: CET", category: "semantic" });
  const flagged = await service.snapshot();
  assert.equal(flagged.memories.length, 2);
  for (const id of [first.id, second.id]) assert.equal(flagged.memories.find((item) => item.id === id)?.conflict, "conflicting");
  await service.setMemoryEnabled(second.id, false);
  const resolved = await service.snapshot();
  assert.equal(resolved.memories.find((item) => item.id === first.id)?.conflict, "none");
  assert.equal(resolved.memories.length, 2, "the disabled memory is retained, not deleted");
});

test("memory export contains every record including corrections", async () => {
  const { service } = await fixture();
  const memory = await service.createMemory({ content: "Exportable", category: "episodic" });
  await service.correctMemory(memory.id, "Exportable and corrected", "Refinement");
  const parsed = JSON.parse(await service.exportMemories()) as { version: string; memories: Array<{ corrections: unknown[] }> };
  assert.equal(parsed.version, "aion.memory-export.v1");
  assert.equal(parsed.memories[0]?.corrections.length, 1);
});

test("tasks enforce transitions and plans convert only after acceptance", async () => {
  const { service } = await fixture();
  const task = await service.createTask({ title: "One" });
  await service.transitionTask(task.id, "completed");
  await assert.rejects(service.transitionTask(task.id, "blocked"));
  const plan = await service.createPlan("Ship", [{ title: "Build" }, { title: "Verify", dependencies: [0] }]);
  await assert.rejects(service.convertPlanToTasks(plan.id));
  await service.acceptPlan(plan.id);
  const created = await service.convertPlanToTasks(plan.id);
  assert.equal(created.length, 2);
  assert.equal(created[0]?.provenance.sourceType, "plan");
  assert.equal((await service.snapshot()).plans[0]?.steps[0]?.status, "converted");
});

test("plan dependencies may only point at earlier steps", async () => {
  const { service } = await fixture();
  await assert.rejects(service.createPlan("Cycle", [{ title: "First", dependencies: [1] }, { title: "Second" }]), /earlier steps/iu);
  await assert.rejects(service.createPlan("Unknown capability", [{ title: "Step", requiredCapabilities: ["aion.not.registered.v1"] }]), /unknown capability/iu);
});

test("routines run deterministically without installing an OS scheduler", async () => {
  const { service } = await fixture();
  const routine = await service.createRoutine({ name: "Review", instructions: "Review local state", intervalMinutes: 1 });
  await service.runRoutine(routine.id);
  const stored = (await service.snapshot()).routines[0]!;
  assert.equal(stored.history.at(-1)?.change, "run:manual");
  assert.ok(stored.nextRunAt);
});

test("the scheduler runs only due, enabled routines and respects the setting", async () => {
  const clock = new SteppableClock();
  const { service } = await fixture({ clock });
  const routine = await service.createRoutine({ name: "Hourly", instructions: "Check state", intervalMinutes: 60 });
  assert.equal(await service.tick(), 0, "nothing is due yet");
  clock.advance(61 * 60_000);
  assert.equal(await service.tick(), 1);
  assert.equal((await service.snapshot()).routines[0]?.lastRunAt, new Date(Date.parse("2030-01-01T00:00:00.000Z") + 61 * 60_000).toISOString());
  await service.updateRoutine(routine.id, { enabled: false });
  clock.advance(10 * 60 * 60_000);
  assert.equal(await service.tick(), 0, "a disabled routine is never due");
  await service.updateRoutine(routine.id, { enabled: true });
  await service.updateSettings({ schedulerEnabled: false });
  clock.advance(10 * 60 * 60_000);
  assert.equal(await service.tick(), 0, "the scheduler setting is honoured");
});

test("actions require an exact one-shot approval", async () => {
  const { service } = await fixture();
  const proposed = await service.proposeAction("aion.local.echo.v1", { text: "bounded" });
  assert.equal(proposed.action.state, "awaiting-approval");
  await assert.rejects(service.executeAction(proposed.action.id));
  await service.decideApproval(proposed.approval!.id, true);
  assert.deepEqual(await service.executeAction(proposed.action.id), { text: "bounded", local: true });
  await assert.rejects(service.executeAction(proposed.action.id), /one-shot/iu);
});

test("an approval authorises one digest only and a denial blocks execution", async () => {
  const { service } = await fixture();
  const first = await service.proposeAction("aion.local.echo.v1", { text: "first" });
  const second = await service.proposeAction("aion.local.echo.v1", { text: "second" });
  assert.notEqual(first.action.inputDigest, second.action.inputDigest);
  await service.decideApproval(first.approval!.id, true);
  await assert.rejects(service.executeAction(second.action.id), /one-shot/iu);
  await service.decideApproval(second.approval!.id, false);
  await assert.rejects(service.executeAction(second.action.id));
  assert.equal((await service.snapshot()).actions.find((item) => item.id === second.action.id)?.state, "cancelled");
});

test("an expired approval fails closed and cancels its action", async () => {
  const clock = new SteppableClock();
  const { service } = await fixture({ clock });
  const proposed = await service.proposeAction("aion.local.echo.v1", { text: "stale" });
  clock.advance(61 * 60_000);
  await service.createTask({ title: "Any write triggers the expiry sweep" });
  const state = await service.snapshot();
  assert.equal(state.approvals.find((item) => item.id === proposed.approval!.id)?.state, "expired");
  assert.equal(state.actions.find((item) => item.id === proposed.action.id)?.state, "cancelled");
  await assert.rejects(service.decideApproval(proposed.approval!.id, true), /no longer pending/iu);
  await assert.rejects(service.executeAction(proposed.action.id));
});

test("capability input validation rejects unregistered and malformed proposals", async () => {
  const { service } = await fixture();
  await assert.rejects(service.proposeAction("aion.not.registered.v1", { text: "x" }), /not registered/iu);
  await assert.rejects(service.proposeAction("aion.local.echo.v1", { text: "" }));
  await assert.rejects(service.proposeAction("aion.local.echo.v1", { text: "x".repeat(1001) }));
});

test("the developer-agent capability is approval-gated and refuses foreign roots", async () => {
  const { root, service } = await fixture();
  await assert.rejects(service.proposeAction("aion.developer.task.v1", { instruction: "Run tests", repositoryRoot: join(root, "elsewhere") }), /approved repository root/iu);
  const proposed = await service.proposeAction("aion.developer.task.v1", { instruction: "Run the bounded synthetic task" });
  assert.equal(proposed.action.state, "awaiting-approval");
  await assert.rejects(service.executeAction(proposed.action.id));
  await service.decideApproval(proposed.approval!.id, true);
  const result = await service.executeAction(proposed.action.id) as { exitCode: number };
  assert.equal(result.exitCode, 0);
});

test("Chat hands a repository question to the developer agent as a read-only proposal only", async () => {
  const { service } = await fixture();
  const conversation = await service.createConversation("Developer hand-off");
  const turn = await service.sendMessage(conversation.id, "developer: review the repository and tell me what tests are failing");
  assert.equal(turn.proposedActions.length, 1);
  const [action] = turn.proposedActions;
  assert.equal(action?.capabilityId, "aion.developer.task.v1");
  assert.equal(action?.origin, "provider-proposal");
  assert.equal(action?.state, "awaiting-approval", "a chat hand-off never executes on its own");
  assert.equal(action?.input.mode, "read-only", "a chat hand-off can only ever propose a read-only task");
  assert.match(String(action?.input.instruction), /what tests are failing/u);
  assert.doesNotMatch(turn.message.content, /AION-PROPOSE/u, "the proposal line never reaches the stored message");

  await assert.rejects(service.executeAction(action!.id), /one-shot/iu);
  const approval = (await service.snapshot()).approvals.find((item) => item.actionId === action!.id)!;
  await service.decideApproval(approval.id, true);
  const result = await service.executeAction(action!.id) as { mode: string; exitCode: number };
  assert.equal(result.mode, "read-only");
  assert.equal(result.exitCode, 0);
});

test("a developer task defaults to read-only and its boundary is bound into the approval digest", async () => {
  const { service } = await fixture();
  const implied = await service.proposeAction("aion.developer.task.v1", { instruction: "List the failing tests" });
  const explicit = await service.proposeAction("aion.developer.task.v1", { instruction: "List the failing tests", mode: "read-only" });
  const writing = await service.proposeAction("aion.developer.task.v1", { instruction: "List the failing tests", mode: "workspace-write" });
  assert.match(implied.approval!.summary, /read-only developer-agent task/u, "the owner is told the boundary before approving");
  assert.match(writing.approval!.summary, /workspace-write developer-agent task/u);
  assert.notEqual(implied.action.inputDigest, writing.action.inputDigest, "a writing task can never reuse a read-only approval");
  assert.notEqual(explicit.action.inputDigest, writing.action.inputDigest);
  await assert.rejects(service.proposeAction("aion.developer.task.v1", { instruction: "Anything", mode: "danger-full-access" }), /read-only or workspace-write/iu);

  await service.decideApproval(implied.approval!.id, true);
  const result = await service.executeAction(implied.action.id) as { mode: string; bridgeId: string; exitCode: number };
  assert.equal(result.mode, "read-only", "an unstated boundary executes as read-only, never as writing");
  assert.equal(result.exitCode, 0);
  assert.equal(result.bridgeId, "synthetic");
  await assert.rejects(service.executeAction(writing.action.id), /one-shot/iu, "the writing task still has no approval of its own");
});

test("Settings choose among the registered developer bridges and never invent one", async () => {
  const named = (id: string, displayName: string): DeveloperAgentBridgeV1 => {
    const inner = new SyntheticDeveloperAgentBridgeV1();
    return { id, displayName, status: async () => ({ ...await inner.status(), bridgeId: id, displayName }), describe: (mode) => inner.describe(mode), run: (task, signal) => inner.run(task, signal) };
  };
  const { service, developerAgents } = await fixture({ bridges: [named("codex", "Codex CLI"), named("claude-code", "Claude Code CLI")] });
  assert.deepEqual((await service.developerBridgeInventory()).map((entry) => entry.bridgeId), ["codex", "claude-code"]);
  assert.equal((await service.developerBridgeStatus()).bridgeId, "codex", "the first registered bridge is AION's default");

  await service.updateSettings({ developerBridgeId: "claude-code" });
  assert.equal((await service.developerBridgeStatus()).bridgeId, "claude-code");
  assert.equal(developerAgents.selected().id, "claude-code");
  const proposed = await service.proposeAction("aion.developer.task.v1", { instruction: "Report the bounded status" });
  assert.match(proposed.approval!.summary, /Claude Code CLI/u, "the approval names the bridge that will run");
  await service.decideApproval(proposed.approval!.id, true);
  assert.equal((await service.executeAction(proposed.action.id) as { bridgeId: string }).bridgeId, "claude-code");

  await assert.rejects(service.updateSettings({ developerBridgeId: "not-installed" }), /not registered/iu);
  assert.equal((await service.snapshot()).settings.developerBridgeId, "claude-code", "a rejected selection changes nothing");
  await service.updateSettings({ developerBridgeId: "" });
  assert.equal((await service.developerBridgeStatus()).bridgeId, "codex", "an empty selection restores AION's default");
});

test("account health is only checked when asked, and reports no account value", async () => {
  const { service } = await fixture();
  assert.equal((await service.developerBridgeStatus()).account, "signed-in");
  const checked = await service.developerBridgeInventory(true);
  assert.equal(checked.length, 1);
  const activity = (await service.snapshot()).activity;
  const record = activity.find((entry) => entry.action === "developer.health");
  assert.ok(record, "an explicit health check is recorded in activity");
  assert.doesNotMatch(record!.summary, /[\w.+-]+@[\w-]+\.[a-z]{2,}/iu, "no account address ever reaches activity");
  assert.match(record!.summary, /no paid call was made/iu);
  assert.equal(JSON.stringify(await service.snapshot()).includes("signed-in"), false, "bridge health is live, never persisted state");
});

test("a real CLI bridge reports a name rather than a local path and refuses unsupported work", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-bridge-test-"));
  const absent = join(root, "definitely-absent", process.platform === "win32" ? "claude.exe" : "claude");
  for (const bridge of [new ClaudeCodeCliDeveloperAgentBridgeV1(root, absent), new CodexCliDeveloperAgentBridgeV1(root, absent)]) {
    const status = await bridge.status({ includeAccount: true });
    assert.equal(status.available, false, "a missing executable is reported unavailable, never fabricated");
    assert.equal(status.executable, null);
    assert.equal(status.account, "unknown");
    assert.doesNotMatch(JSON.stringify(status), /[A-Za-z]:\\|\/tmp\//u, "no local path is ever reported");
    await assert.rejects(bridge.run({ repositoryRoot: join(root, "elsewhere"), instruction: "x", mode: "read-only" }, new AbortController().signal), /approved repository root/iu);
    await assert.rejects(bridge.run({ repositoryRoot: root, instruction: "   ", mode: "read-only" }, new AbortController().signal), /instruction is invalid/iu);
    await assert.rejects(bridge.run({ repositoryRoot: root, instruction: "read\u0007the repository", mode: "read-only" }, new AbortController().signal), /control characters/iu);
    await assert.rejects(bridge.run({ repositoryRoot: root, instruction: "read the repository", mode: "danger-full-access" as never }, new AbortController().signal), /mode is not supported/iu);
  }
  assert.throws(() => new ClaudeCodeCliDeveloperAgentBridgeV1("relative-root", absent), /explicit and normalized/iu);
  assert.throws(() => new CodexCliDeveloperAgentBridgeV1(root, "  "), /must be explicit/iu);
});

test("an unavailable developer bridge reports truthfully and refuses to run", async () => {
  const { service } = await fixture({ bridges: [new UnavailableDeveloperAgentBridgeV1()] });
  const status = await service.developerBridgeStatus();
  assert.equal(status.available, false);
  assert.equal(status.executable, null);
  const proposed = await service.proposeAction("aion.developer.task.v1", { instruction: "Should not run" });
  await service.decideApproval(proposed.approval!.id, true);
  await assert.rejects(service.executeAction(proposed.action.id));
  assert.equal((await service.snapshot()).actions.find((item) => item.id === proposed.action.id)?.state, "failed");
});

/** Runs one allowlisted verification the only way it can be run: proposed, approved, executed. */
async function runVerification(service: AionAssistantV1, operationId: string) {
  const proposed = await service.proposeAction("aion.verify.run.v1", { operationId });
  await service.decideApproval(proposed.approval!.id, true);
  await service.executeAction(proposed.action.id);
  return (await service.snapshot()).verifications[0]!;
}

test("verification evidence is recorded, audited, and bounded", async () => {
  const runner = new SyntheticVerificationRunnerV1({ "npm.verify": { exitCode: 1, stdout: "not ok 7 - a failing thing\n# tests 10\n# pass 9\n# fail 1\n" } });
  const { service } = await fixture({ capabilities: [new VerificationCapabilityV1(runner)] });
  const recorded = await runVerification(service, "npm.verify");
  assert.equal(recorded.operationId, "npm.verify");
  assert.equal(recorded.outcome, "failed");
  assert.equal(recorded.resultDigest.length, 64);
  const state = await service.snapshot();
  const audited = state.activity.find((entry) => entry.action === "verify.run");
  assert.ok(audited, "an allowlisted verification run is audited");
  assert.equal(audited?.outcome, "failed");
  assert.match(audited!.summary, /npm\.verify failed \(exit 1\)/u);
  assert.equal(typeof (service as unknown as { recordVerification?: unknown }).recordVerification, "undefined", "evidence cannot be submitted directly; only an executed capability produces it");
});

test("verification evidence becomes a read-only analysis task that needs no shell or write access", async () => {
  const runner = new SyntheticVerificationRunnerV1({ "npm.verify": { exitCode: 1, stdout: "ok 1 - fine\nnot ok 7 - the failing assertion\n# tests 10\n# pass 9\n# fail 1\n" } });
  const { service } = await fixture({ capabilities: [new VerificationCapabilityV1(runner)] });
  const recorded = await runVerification(service, "npm.verify");

  const proposed = await service.proposeVerificationAnalysis(recorded.id, "Which test failed and why?");
  assert.equal(proposed.action.capabilityId, "aion.developer.task.v1");
  assert.equal(proposed.action.input.mode, "read-only", "analysing evidence never needs write access");
  assert.equal(proposed.action.state, "awaiting-approval");
  const instruction = String(proposed.action.input.instruction);
  assert.match(instruction, /not ok 7 - the failing assertion/u, "the failing line is handed to the analyst");
  assert.match(instruction, /Which test failed and why\?/u);
  assert.match(instruction, /You have no shell and no write access/u);
  assert.ok(instruction.length <= 4000, "the instruction stays inside the capability bound");

  await assert.rejects(service.executeAction(proposed.action.id), /one-shot/iu, "analysis is still approval-gated");
  await service.decideApproval(proposed.approval!.id, true);
  assert.equal((await service.executeAction(proposed.action.id) as { mode: string }).mode, "read-only");
  await assert.rejects(service.proposeVerificationAnalysis("not-a-run"), /was not found/iu);
});

test("the verification capability is the only way a model can cause a command to run", async () => {
  const runner = new SyntheticVerificationRunnerV1();
  const capability = new VerificationCapabilityV1(runner);
  assert.equal(capability.approval, "always", "a verification run always needs the owner's decision");
  // A provider proposal is validated by exactly the same rules as an owner one.
  const { service } = await fixture({ capabilities: [new VerificationCapabilityV1(runner)] });
  await assert.rejects(service.proposeAction("aion.verify.run.v1", { command: "npm publish" }), /must not carry a "command" field/u);
  await assert.rejects(service.proposeAction("aion.verify.run.v1", { operationId: "npm.publish" }), /not on the allowlist/u);
  const proposed = await service.proposeAction("aion.verify.run.v1", { operationId: "npm.audit" });
  assert.equal(proposed.action.state, "awaiting-approval");
  await service.decideApproval(proposed.approval!.id, true);
  const result = await service.executeAction(proposed.action.id) as { operationId: string; outcome: string };
  assert.equal(result.operationId, "npm.audit");
  assert.equal(result.outcome, "passed");
});

test("archive dry run detects duplicates and import preserves conversation boundaries", async () => {
  const { root, service } = await fixture();
  const input = join(root, "conversations.json");
  await writeFile(input, JSON.stringify([{ title: "Synthetic", mapping: { one: { message: { author: { role: "user" }, content: { parts: ["Neutral question"] }, create_time: 1 } }, two: { message: { author: { role: "assistant" }, content: { parts: ["Neutral answer"] }, create_time: 2 } } } }]));
  const report = await service.dryRunImport("chatgpt", root, input);
  assert.equal(report.items[0]?.conversationCount, 1);
  assert.equal(report.state, "dry-run");
  const imported = await service.importConversations(report.id, root, input);
  assert.equal(imported.importedConversationIds.length, 1);
  const conversation = (await service.snapshot()).conversations.find((item) => item.id === imported.importedConversationIds[0]);
  assert.equal(conversation?.messages.length, 2);
  assert.equal(conversation?.messages[0]?.providerId, "import:chatgpt");
  assert.equal(conversation?.memoryContextEnabled, false, "imported history never joins memory context automatically");
  const duplicate = await service.dryRunImport("chatgpt", root, input);
  assert.equal(duplicate.items[0]?.duplicate, true);
  assert.equal((await readFile(input, "utf8")).length > 0, true, "the source archive is unchanged");
});

test("Claude and Grok archive shapes import through their own parser boundary", async () => {
  const { root, service } = await fixture();
  const claude = join(root, "claude.json");
  await writeFile(claude, JSON.stringify({ conversations: [{ name: "Claude thread", chat_messages: [{ sender: "human", text: "Neutral question", created_at: "2030-01-02T00:00:00.000Z" }, { sender: "assistant", text: "Neutral answer" }] }] }));
  const claudeReport = await service.dryRunImport("claude", root, claude);
  assert.equal(claudeReport.items[0]?.conversationCount, 1);
  const grok = join(root, "grok.json");
  await writeFile(grok, JSON.stringify([{ title: "Grok thread", messages: [{ role: "user", content: "Neutral question" }] }]));
  const grokReport = await service.dryRunImport("grok", root, grok);
  assert.equal(grokReport.items[0]?.conversationCount, 1);
  assert.equal((await service.importConversations(grokReport.id, root, grok)).importedConversationIds.length, 1);
});

test("a dry run can be cancelled and cannot then be imported", async () => {
  const { root, service } = await fixture();
  const input = join(root, "cancel.json");
  await writeFile(input, JSON.stringify([{ title: "Synthetic", messages: [{ role: "user", content: "Neutral" }] }]));
  const report = await service.dryRunImport("grok", root, input);
  await service.cancelImport(report.id);
  assert.equal((await service.snapshot()).imports[0]?.state, "cancelled");
  await assert.rejects(service.importConversations(report.id, root, input), /dry run is required/iu);
});

test("an archive changed after its dry run is refused", async () => {
  const { root, service } = await fixture();
  const input = join(root, "changing.json");
  await writeFile(input, JSON.stringify([{ title: "Original", messages: [{ role: "user", content: "Neutral" }] }]));
  const report = await service.dryRunImport("grok", root, input);
  await writeFile(input, JSON.stringify([{ title: "Changed", messages: [{ role: "user", content: "Different" }] }]));
  await assert.rejects(service.importConversations(report.id, root, input), /changed after dry run/iu);
});

test("import selections outside the approved root fail closed", async () => {
  const { root, service } = await fixture();
  await assert.rejects(service.dryRunImport("chatgpt", root, join(root, "..", "outside.json")), /outside the approved root/iu);
  await assert.rejects(service.dryRunImport("chatgpt", "relative-root", join(root, "a.json")), /normalized absolute/iu);
  await assert.rejects(service.dryRunImport("chatgpt", root, "\\\\server\\share\\archive.json"), /normalized absolute|UNC|device/iu);
});

test("private backup encrypts, authenticates, restores, and rejects a wrong passphrase", async () => {
  const { exports, service } = await fixture();
  await service.createTask({ title: "Synthetic" });
  const path = join(exports, "private.aionbak");
  const created = await service.createPrivateBackup(path, "neutral-passphrase-123");
  assert.equal(created.digest.length, 64);
  const restored = await service.verifyPrivateBackup(path, "neutral-passphrase-123");
  assert.equal(restored.tasks.length, 1);
  await assert.rejects(service.verifyPrivateBackup(path, "wrong-passphrase-123"));
  await assert.rejects(service.createPrivateBackup(join(exports, "short.aionbak"), "tooshort"), /12 characters/iu);
  await assert.rejects(service.createPrivateBackup(join(exports, "..", "escape.aionbak"), "neutral-passphrase-123"), /outside the approved root/iu);
});

test("a tampered private backup fails authentication instead of returning data", async () => {
  const { exports, service } = await fixture();
  const path = join(exports, "tampered.aionbak");
  await service.createPrivateBackup(path, "neutral-passphrase-123");
  const envelope = JSON.parse(await readFile(path, "utf8")) as { ciphertext: string };
  const bytes = Buffer.from(envelope.ciphertext, "base64url");
  bytes.writeUInt8(bytes.readUInt8(0) ^ 0xff, 0);
  await writeFile(path, `${JSON.stringify({ ...envelope, ciphertext: bytes.toString("base64url") })}\n`);
  await assert.rejects(service.verifyPrivateBackup(path, "neutral-passphrase-123"));
});

test("settings never accept an undeclared provider or credential value", async () => {
  const { service } = await fixture();
  await assert.rejects(service.updateSettings({ providerId: "unknown" }));
  await assert.rejects(service.updateSettings({ credentialEnvironmentVariable: "lowercase name" }));
  await assert.rejects(service.updateSettings({ privacy: { includeMemoryByDefault: true, retainActivityDays: 0 } }));
  await service.updateSettings({ credentialEnvironmentVariable: "AION_PROVIDER_TOKEN" });
  const stored = (await service.snapshot()).settings;
  assert.equal(stored.credentialEnvironmentVariable, "AION_PROVIDER_TOKEN");
  assert.equal(JSON.stringify(stored).includes("secret"), false);
});

test("activity is retained for exactly the configured window", async () => {
  const clock = new SteppableClock();
  const { service } = await fixture({ clock });
  await service.updateSettings({ privacy: { includeMemoryByDefault: true, retainActivityDays: 1 } });
  await service.createTask({ title: "Old" });
  assert.ok((await service.snapshot()).activity.length >= 2);
  clock.advance(3 * 86_400_000);
  await service.createTask({ title: "New" });
  const activity = (await service.snapshot()).activity;
  assert.equal(activity.length, 1, "only the newest write survives the retention horizon");
  assert.equal(activity[0]?.action, "task.create");
});

test("file-backed state uses an explicit private root, survives reload, and detects revision conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-state-test-"));
  assert.throws(() => new FileStateRepositoryV1(join(root, "somewhere")), /private\/aion root/iu);
  const dataRoot = join(root, "private", "aion");
  const repository = new FileStateRepositoryV1(dataRoot);
  assert.equal(await repository.load(), null);
  const ports = () => ({
    repository: new FileStateRepositoryV1(dataRoot), clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()], capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(join(root, "exports")),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  const first = new AionAssistantV1(ports());
  await first.createTask({ title: "Persisted across a restart" });
  const reloaded = await new AionAssistantV1(ports()).snapshot();
  assert.equal(reloaded.tasks[0]?.title, "Persisted across a restart");
  await assert.rejects(repository.save(reloaded.revision + 5, { ...reloaded, revision: reloaded.revision + 6 }), /revision conflict/iu);
});

test("corrupt or unsupported persisted state fails closed rather than being repaired", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-corrupt-test-"));
  const dataRoot = join(root, "private", "aion");
  await mkdir(dataRoot, { recursive: true });
  await writeFile(join(dataRoot, "state-v1.json"), "{ not valid json");
  await assert.rejects(new FileStateRepositoryV1(dataRoot).load());
  await writeFile(join(dataRoot, "state-v1.json"), JSON.stringify({ schema: "aion.local-assistant-state.v99", revision: 0 }));
  await assert.rejects(new FileStateRepositoryV1(dataRoot).load(), /unsupported/iu);
});
