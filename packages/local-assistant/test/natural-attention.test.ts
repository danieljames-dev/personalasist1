/**
 * Owner Chat should sound like an assistant — not a CRM diagnostic report.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectNaturalAttentionKind,
  formatNaturalOwnerAttention,
} from "../src/crm-assistant.js";
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
async function serviceFixture() {
  const root = await mkdtemp(join(tmpdir(), "aion-natural-"));
  const exportsRoot = join(root, "exports");
  await mkdir(exportsRoot);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exportsRoot),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  return service;
}

test("detectNaturalAttentionKind maps Owner phrases", () => {
  assert.equal(detectNaturalAttentionKind("Who do I need to call?"), "call");
  assert.equal(detectNaturalAttentionKind("Who should I follow up with?"), "follow_up");
  assert.equal(detectNaturalAttentionKind("What matters today?"), "today");
  assert.equal(detectNaturalAttentionKind("What am I waiting on?"), "waiting");
  assert.equal(detectNaturalAttentionKind("What should I do next?"), "next");
});

test("formatNaturalOwnerAttention never uses diagnostic CRM labels", () => {
  const empty = formatNaturalOwnerAttention({
    kind: "call",
    overdue: [],
    dueSoon: [],
  });
  assert.match(empty, /don'?t currently have a grounded call/i);
  assert.doesNotMatch(empty, /Quiet accounts/i);
  assert.doesNotMatch(empty, /14\+ days/i);
  assert.doesNotMatch(empty, /Active brand workspaces/i);
  assert.doesNotMatch(empty, /FOLLOW-UP INTELLIGENCE/i);
  assert.doesNotMatch(empty, /WAITING ON OTHERS/i);

  const withCall = formatNaturalOwnerAttention({
    kind: "call",
    overdue: [{ customer: "Alex Rivera", reason: "Callback promised", dueAt: "2030-01-01T00:00:00.000Z" }],
    dueSoon: [],
  });
  assert.match(withCall, /Alex Rivera/);
  assert.doesNotMatch(withCall, /Quiet accounts/i);

  const waiting = formatNaturalOwnerAttention({
    kind: "waiting",
    overdue: [],
    dueSoon: [],
    waiting: [],
  });
  assert.match(waiting, /don'?t currently have anything grounded/i);
});

test("assistantPrompt who-do-I-need-to-call is natural and empty-safe", async () => {
  const service = await serviceFixture();
  // Ensure work workspace so CRM relationships scope is normal
  await service.updateSettings({ activeWorkspace: "work" });
  const answer = await service.assistantPrompt("Who do I need to call?");
  assert.doesNotMatch(answer.reply, /Quiet accounts/i);
  assert.doesNotMatch(answer.reply, /Active brand workspaces/i);
  assert.doesNotMatch(answer.reply, /14\+ days/i);
  assert.doesNotMatch(answer.reply, /CRM detail/i);
  assert.match(answer.reply, /don'?t currently have a grounded call|should call|People to call|Coming up soon/i);
});

test("assistantPrompt follow-up / today / waiting natural phrasing", async () => {
  const service = await serviceFixture();
  await service.updateSettings({ activeWorkspace: "work" });

  for (const q of [
    "Who should I follow up with?",
    "What matters today?",
    "What am I waiting on?",
    "What should I do next?",
  ]) {
    const answer = await service.assistantPrompt(q);
    assert.doesNotMatch(answer.reply, /Quiet accounts \(14\+/i, q);
    assert.doesNotMatch(answer.reply, /Active brand workspaces/i, q);
    assert.doesNotMatch(answer.reply, /FOLLOW-UP INTELLIGENCE/i, q);
    assert.doesNotMatch(answer.reply, /WAITING ON OTHERS/i, q);
    assert.doesNotMatch(answer.reply, /OWNER MUST|WHAT ACTUALLY MATTERS TODAY/i, q);
    assert.ok(answer.reply.length > 10, q);
  }
});

test("what should I do next is natural attention not morning diagnostic dump", async () => {
  const service = await serviceFixture();
  await service.updateSettings({ activeWorkspace: "work" });
  const answer = await service.assistantPrompt("What should I do next?");
  assert.equal(answer.action, "owner.natural_attention");
  assert.doesNotMatch(answer.reply, /OWNER MUST/i);
  assert.doesNotMatch(answer.reply, /Quiet accounts/i);
  assert.match(answer.reply, /don'?t currently|Open task|Priority|Nothing urgent|grounded next step/i);
});

test("overdue follow-up surfaces a person to call without diagnostic framing", async () => {
  const service = await serviceFixture();
  await service.updateSettings({ activeWorkspace: "work" });
  const customer = await service.createCustomer({ displayName: "Jordan Lee" });
  await service.addCustomerFollowUp(customer.id, {
    reason: "Promised callback",
    dueAt: "2020-01-01T00:00:00.000Z",
    channel: "phone",
  });
  const answer = await service.assistantPrompt("Who do I need to call?");
  assert.match(answer.reply, /Jordan Lee/i);
  assert.doesNotMatch(answer.reply, /Quiet accounts/i);
  assert.doesNotMatch(answer.reply, /Active brand/i);
});
