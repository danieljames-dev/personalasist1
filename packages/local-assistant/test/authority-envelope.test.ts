/**
 * Owner authority envelope — expansion flags, spend USD0, kill switches, safety.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultAuthorityEnvelope,
  emailSendSafetyCheck,
  evaluateExternalGate,
  formatAuthorityEnvelopeReport,
  jobApplySafetyCheck,
} from "../src/authority-envelope.js";
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
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NOW = "2030-06-10T12:00:00.000Z";

test("envelope defaults: external authorized, spend USD 0", () => {
  const e = defaultAuthorityEnvelope(NOW);
  assert.equal(e.emailSend, true);
  assert.equal(e.jobApplicationSubmit, true);
  assert.equal(e.spend.totalAutonomousSpendCapUsd, 0);
  const spend = evaluateExternalGate(e, "spend");
  assert.equal(spend.allowed, false);
  assert.match(spend.reason, /USD 0|budget/i);
  assert.equal(evaluateExternalGate(e, "email_send").allowed, true);
  assert.equal(evaluateExternalGate(e, "real_import").allowed, true);
});

test("kill switch blocks email send", () => {
  const e = defaultAuthorityEnvelope(NOW);
  e.kill.pauseEmailSend = true;
  const g = evaluateExternalGate(e, "email_send");
  assert.equal(g.allowed, false);
  assert.equal(g.class, "KILL");
});

test("email safety rejects ambiguous recipient and contracts", () => {
  assert.equal(
    emailSendSafetyCheck({
      toAddress: "bad",
      toName: "x",
      subject: "hi",
      body: "hello",
      workspace: "work",
      relationshipId: null,
      reason: "follow-up",
    }).allowed,
    false,
  );
  assert.equal(
    emailSendSafetyCheck({
      toAddress: "a@b.com",
      toName: "A",
      subject: "hi",
      body: "I hereby agree to a binding contract and wire $5000",
      workspace: "work",
      relationshipId: "r1",
      reason: "deal",
    }).allowed,
    false,
  );
  assert.equal(
    emailSendSafetyCheck({
      toAddress: "a@b.com",
      toName: "A",
      subject: "Follow up",
      body: "Thanks for chatting about the Tacoma. Happy to answer questions.",
      workspace: "work",
      relationshipId: "r1",
      reason: "commitment follow-up",
    }).allowed,
    true,
  );
});

test("job apply safety requires fit threshold", () => {
  assert.equal(
    jobApplySafetyCheck({
      employer: "Acme",
      title: "AE",
      fitScore: 40,
      coverDraft: "draft",
      resumeNotes: "notes",
    }).allowed,
    false,
  );
  assert.equal(
    jobApplySafetyCheck({
      employer: "Acme",
      title: "AE",
      fitScore: 75,
      coverDraft: "draft grounded",
      resumeNotes: "real skills",
    }).allowed,
    true,
  );
});

test("service: ensure envelope + spend blocked + external audit", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-auth-"));
  const exports = join(root, "exports");
  await mkdir(exports);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(),
    ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(),
    backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  const env = await service.ensureAuthorityEnvelope();
  assert.equal(env.realDataImport, true);
  assert.match(formatAuthorityEnvelopeReport(env), /EMAIL_SEND_AUTHORITY/);

  const send = await service.sendEmailAuthorized({
    toAddress: "customer@example.com",
    toName: "Customer",
    subject: "Follow up",
    body: "Thanks for your interest in the Tacoma.",
    reason: "Open commitment follow-up",
    evidence: ["commitment:test"],
  });
  // Without Gmail READY → owner_required or simulated path, not unauth success
  assert.ok(["owner_required", "simulated", "blocked"].includes(send.result));

  await service.setAuthorityKillSwitches({ pauseEmailSend: true });
  const blocked = await service.sendEmailAuthorized({
    toAddress: "customer@example.com",
    toName: "Customer",
    subject: "Follow up",
    body: "Thanks for your interest.",
    reason: "test",
  });
  assert.equal(blocked.result, "blocked");

  const actions = await service.listExternalActions({});
  assert.ok(actions.actions.length >= 1);
  assert.match(actions.reply, /EXTERNAL ACTIONS|none recorded/i);
});
