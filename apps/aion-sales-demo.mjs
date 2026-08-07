#!/usr/bin/env node
/**
 * Complete AION V1.1 Mobile Sales synthetic proof.
 *
 * Everything below is invented: a fictional dealership, a fictional salesperson, and fictional
 * customers, all created in a temporary directory and removed afterwards. There is no owner
 * content, no employer system, no CRM, no customer record, no external account, no live provider,
 * and no network dependency. The scenario is driven through the real loopback Command Center HTTP
 * API, so what is proved is the product surface a salesperson actually uses on a phone.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  DeveloperAgentCapabilityV1, LocalEchoCapabilityV1, SelectableDeveloperAgentRegistryV1,
  StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1, SyntheticVerificationRunnerV1,
  VerificationCapabilityV1,
} from "../packages/local-assistant/dist/index.js";
import { createAionServer } from "./aion/server.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const DEALERSHIP = "Bayfield Motors";      // fictional
const SALESPERSON = "A. Nakamura";          // fictional
const steps = [];
const proved = (label) => { steps.push(label); console.log(`  ok  ${label}`); };

async function open(dataRoot, exportRoot, treatPeerAsRemote = false) {
  const developerAgents = new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]);
  const verificationRunner = new SyntheticVerificationRunnerV1({
    "npm.verify": { exitCode: 1, stdout: "ok 1 - fine\nnot ok 2 - synthetic sales regression\n# tests 2\n# pass 1\n# fail 1\n" },
  });
  const app = await createAionServer({
    repositoryRoot, dataRoot, exportRoot, treatPeerAsRemote,
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1(), new DeveloperAgentCapabilityV1(developerAgents, repositoryRoot), new VerificationCapabilityV1(verificationRunner)]),
    developerAgents, verificationRunner,
  });
  const address = await app.listen(0);
  assert.equal(address.address, "127.0.0.1", "the Command Center must bind loopback only");
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (type, payload = {}, headers = {}) => {
    const response = await fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ ...payload, type }) });
    const data = await response.json();
    if (!response.ok) throw new Error(`${type}: ${data.error}`);
    return data.result;
  };
  const view = async (headers = {}) => (await fetch(`${base}/api/state`, { headers })).json();
  return { app, base, call, view };
}

const root = await mkdtemp(join(tmpdir(), "aion-sales-demo-"));
const dataRoot = join(root, "private", "aion");
const exportRoot = join(dataRoot, "exports");
await mkdir(exportRoot, { recursive: true });

try {
  console.log(`\nAION V1.1 Mobile Sales demo — fictional dealership "${DEALERSHIP}", fictional customers, no network\n`);
  let pairingCode;
  const { app, base, call, view } = await open(dataRoot, exportRoot);
  try {
    await call("onboarding.complete");
    const initial = await view();
    assert.equal(initial.state.settings.activeWorkspace, "personal");
    assert.equal(initial.remoteAccess.enabled, false);
    assert.equal(initial.remoteAccess.publiclyExposed, false);
    proved("AION starts loopback-only in PERSONAL with private phone access off and nothing exposed");

    // --- Personal material that must never appear in Work ---
    await call("memory.create", { memory: { content: "Personal preference: guitar practice on Sundays", category: "semantic" } });
    await call("task.create", { task: { title: "Personal errand" } });

    await call("settings.update", { settings: { activeWorkspace: "work", workspaceLabels: { personal: "Personal", work: DEALERSHIP } } });
    assert.equal((await view()).state.settings.workspaceLabels.work, DEALERSHIP);
    proved(`the owner switches to the WORK workspace, labelled "${DEALERSHIP}" from their own input`);

    // --- A day on the floor ---
    const walkIn = (await call("customer.create", { customer: { displayName: "R. Iqbal (walk-in)", source: "showroom walk-in", communicationPreference: "text", interests: [{ kind: "vehicle", description: "compact SUV, roof rails" }] } })).id;
    const caller = (await call("customer.create", { customer: { displayName: "M. Osei (phone)", source: "phone enquiry", communicationPreference: "phone", interests: [{ kind: "vehicle", description: "midsize hybrid sedan" }], objections: ["monthly payment feels high"] } })).id;
    proved("two fictional prospects are created as durable Work relationship records");

    await call("customer.interaction", { id: caller, interaction: { kind: "call", summary: "Talked through hybrid running costs.", lifecycleAfter: "contacted" } });
    await call("customer.appointment", { id: caller, appointment: { at: "2030-01-01T15:00:00.000Z", location: "showroom", notes: "Bringing partner." } });
    await call("customer.lifecycle", { id: caller, lifecycle: "appointment-set", summary: "Booked for Saturday." });
    await call("customer.followup", { id: walkIn, followUp: { dueAt: "2030-01-01T09:00:00.000Z", channel: "text", reason: "Send SUV comparison." } });
    proved("interactions, an appointment, a stage change and a follow-up all append to the durable timeline");

    const due = await call("customer.find", { query: { kind: "follow-up-due", onDate: "2030-01-01" } });
    const todayAppointments = await call("customer.find", { query: { kind: "appointments-on", onDate: "2030-01-01" } });
    assert.deepEqual(due.customers.map((c) => c.id), [walkIn]);
    assert.deepEqual(todayAppointments.customers.map((c) => c.id), [caller]);
    proved("the Today view answers who needs a follow-up and who is coming in, deterministically");

    const prep = await call("coach", { kind: "call-preparation", input: { customerId: caller } });
    assert.match(prep.lines.join("\n"), /monthly payment feels high/u);
    assert.doesNotMatch(prep.lines.join("\n"), /\$\s?\d|\bAPR\b|\bMSRP\b/iu);
    assert.match(prep.lines.join("\n"), /AION does not know this/u);
    const draft = await call("coach", { kind: "follow-up-draft", input: { customerId: walkIn, channel: "text" } });
    assert.equal(draft.draft, true);
    assert.match(draft.lines[0], /AION does not send messages/u);
    proved("the Coach prepares a call and drafts a follow-up without inventing price, stock, or finance facts, and sends nothing");

    await call("customer.appointment.status", { id: caller, appointmentId: (await call("customer.timeline", { id: caller })).customer.appointments[0].id, status: "shown" });
    await call("customer.lifecycle", { id: caller, lifecycle: "negotiating", summary: "Discussing trade allowance." });
    await call("customer.outcome", { id: caller, outcome: "sold", detail: "Delivered Saturday." });
    const sold = (await call("customer.timeline", { id: caller })).customer;
    assert.equal(sold.outcome.state, "sold");
    assert.deepEqual(sold.interactions.filter((entry) => entry.lifecycleAfter).map((entry) => entry.lifecycleAfter),
      ["prospect", "contacted", "appointment-set", "negotiating", "sold"]);
    proved("a relationship runs prospect to sale and every earlier state and note remains recoverable");

    await call("customer.followup", { id: caller, followUp: { dueAt: "2030-04-01T14:00:00.000Z", channel: "phone", reason: "Three-month check-in." } });
    assert.equal((await call("customer.timeline", { id: caller })).customer.outcome.state, "sold");
    proved("a post-sale follow-up keeps the relationship alive without reopening or overwriting the outcome");

    const salesTask = (await call("task.create", { task: { title: "Order the roof rails quote" } })).id;
    await call("customer.link.task", { id: walkIn, taskId: salesTask });
    await call("sales.routine.create", { templateId: "end-of-day-recap" });
    await call("memory.create", { memory: { content: "Work note: Saturdays are busiest before noon", category: "procedural" } });
    proved("a Work Task links to a relationship, a routine template is created on request, and a Work Memory is recorded");

    await call("sales.metrics", { date: "2030-01-01", counts: { newLeads: 2, calls: 14, contacts: 6, appointmentsSet: 1, appointmentsShown: 1, sales: 1, followUpsCompleted: 3 } });
    const summary = await call("sales.summary", { from: "2030-01-01", to: "2030-01-01" });
    assert.equal(summary.totals.sales, 1);
    assert.match(summary.source, /Not a dealership CRM figure/u);
    proved("the day's own metrics are recorded and summarised, labelled as the owner's counts rather than a CRM's");

    const recap = await call("coach", { kind: "end-of-day-recap", input: { onDate: "2030-01-01" } });
    assert.match(recap.lines.join("\n"), /Sales recorded: 1/u);
    proved("the end-of-day recap reads back the real day from AION's own records");

    // --- Workspace isolation ---
    await call("settings.update", { settings: { activeWorkspace: "personal" } });
    assert.deepEqual(await call("memory.search", { query: "Saturdays" }), [], "a Work memory is invisible from Personal");
    let refused = false;
    try { await call("customer.find", { query: { kind: "all" } }); } catch { refused = true; }
    assert.equal(refused, true, "relationship search is unavailable in Personal");
    const personal = await call("memory.search", { query: "guitar" });
    assert.equal(personal.length, 1, "personal material is still there, untouched");
    await call("settings.update", { settings: { activeWorkspace: "work" } });
    proved("Work and Personal stay separated: no customer data, no work memory, and no leakage either way");

    // --- Verification evidence analysed by a read-only developer agent ---
    const verifyProposal = await call("action.propose", { capabilityId: "aion.verify.run.v1", input: { operationId: "npm.verify" } });
    await call("approval.decide", { id: verifyProposal.approval.id, approve: true });
    assert.equal((await call("action.execute", { id: verifyProposal.action.id })).outcome, "failed");
    const evidence = (await view()).state.verifications[0];
    const analysis = await call("verify.analyse", { id: evidence.id, question: "What failed?" });
    assert.equal(analysis.action.input.mode, "read-only");
    await call("approval.decide", { id: analysis.approval.id, approve: true });
    assert.equal((await call("action.execute", { id: analysis.action.id })).mode, "read-only");
    proved("AION runs an allowlisted verification itself and a read-only developer agent analyses the evidence, with no shell or write access");

    // --- Pairing a phone. The console issues the code; the phone redeems it. ---
    await call("settings.update", { settings: { remoteAccess: { enabled: true, bindAddress: "127.0.0.1", sessionDays: 30 } } });
    pairingCode = (await call("device.pair.code", { label: "Demo phone" })).code;
    proved("the owner turns on private phone access at the console and issues a one-time pairing code");
  } finally { await app.close(); }

  /*
   * A second instance with treatPeerAsRemote set, so the phone path is exercised honestly rather
   * than assumed. Everything a real phone would do goes through the same code as a real phone.
   */
  const phone = await open(dataRoot, exportRoot, true);
  try {
    const anonymous = await fetch(`${phone.base}/api/state`);
    assert.equal(anonymous.status, 401, "an unpaired device is refused and shown no owner data");
    const shell = await fetch(`${phone.base}/`);
    assert.equal(shell.status, 200, "it may still load the shell so it can render a pairing screen");

    const redeemed = await (await fetch(`${phone.base}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pairingCode }) })).json();
    const bearer = { authorization: `Bearer ${redeemed.result.token}` };
    const onPhone = await phone.view(bearer);
    assert.equal(onPhone.viewer, "device");
    assert.equal(onPhone.state.customers.length, 2, "the phone sees the same Work relationships");
    assert.equal(JSON.stringify(onPhone).includes(pairingCode), false, "the pairing code is never returned again");
    assert.equal(JSON.stringify(onPhone).includes(redeemed.result.token), false, "the session token is never echoed back");
    proved("an unpaired phone is refused, then pairs with the one-time code and works over an Authorization header");

    const reused = await fetch(`${phone.base}/api/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pairingCode }) });
    assert.equal(reused.status, 429, "the code is single use");
    const minting = await fetch(`${phone.base}/api/action`, { method: "POST", headers: { "content-type": "application/json", ...bearer }, body: JSON.stringify({ type: "device.pair.code", label: "Another" }) });
    assert.equal(minting.status, 403, "a phone can never mint a pairing code");
    const changing = await fetch(`${phone.base}/api/action`, { method: "POST", headers: { "content-type": "application/json", ...bearer }, body: JSON.stringify({ type: "settings.update", settings: { remoteAccess: { enabled: false, bindAddress: "127.0.0.1", sessionDays: 30 } } }) });
    assert.equal(changing.status, 403, "a phone can never change how access itself works");
    proved("a paired phone drives AION but cannot mint a code, reuse one, or alter access settings");

    // It can, however, do the actual job.
    const noted = await fetch(`${phone.base}/api/action`, { method: "POST", headers: { "content-type": "application/json", ...bearer }, body: JSON.stringify({ type: "customer.interaction", id: onPhone.state.customers[0].id, interaction: { kind: "note", summary: "Logged from the phone on the lot." } }) });
    assert.equal(noted.status, 200);
    proved("the salesperson records an interaction from the phone, which is the point of the whole slice");
  } finally { await phone.close?.(); await phone.app.close(); }

  const consoleAgain = await open(dataRoot, exportRoot);
  try {
    const before = (await consoleAgain.view()).state;
    const revoked = await consoleAgain.call("device.revoke.all");
    assert.ok(revoked.sessions >= 1);
    const after = (await consoleAgain.view()).state;
    assert.deepEqual(after.customers.map((c) => c.id), before.customers.map((c) => c.id), "revoking every device changes no relationship");
    assert.equal(after.memories.length, before.memories.length, "and no memory");
    assert.equal(after.tasks.length, before.tasks.length, "and no task");
    assert.equal(JSON.stringify(after.activity).includes(pairingCode), false, "no secret ever reached Activity");
    proved("signing out every device ends access and leaves every conversation, memory, task and relationship intact");
  } finally { await consoleAgain.app.close(); }

  const reopened = await open(dataRoot, exportRoot);
  try {
    const state = (await reopened.view()).state;
    assert.equal(state.customers.length, 2, "relationships survive a restart");
    assert.equal(state.customers.find((c) => c.outcome.state === "sold").interactions.length >= 6, true, "so does the whole timeline");
    assert.equal(state.salesMetrics.length, 1);
    assert.equal(state.settings.workspaceLabels.work, DEALERSHIP);
    assert.equal(state.sessions.every((entry) => entry.revokedAt !== null), true, "revoked sessions stay revoked across a restart");
    proved("closing and reopening AION reloads the identical Work state, and revoked devices stay revoked");
  } finally { await reopened.app.close(); }

  console.log(`\nAION V1.1 Mobile Sales demo PASS — ${steps.length} behaviours proved.`);
  console.log(`Fictional dealership "${DEALERSHIP}" and salesperson "${SALESPERSON}". No real customer, employer system, CRM, network call, or permanent state was used or left behind.\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
