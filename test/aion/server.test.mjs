import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  DeveloperAgentCapabilityV1, InMemoryWriterAuthorityV1, LocalEchoCapabilityV1,
  SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  SyntheticVerificationRunnerV1, VerificationCapabilityV1, createWriterGrantForTest,
} from "../../packages/local-assistant/dist/index.js";
import { createAionServer } from "../../apps/aion/server.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");

/** Starts one isolated Command Center over synthetic temporary state only. */
async function withServer(run) {
  const root = await mkdtemp(join(tmpdir(), "aion-server-test-"));
  const developerAgents = new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]);
  // A synthetic verification runner: the suite must never actually shell out to npm or git.
  const verificationRunner = new SyntheticVerificationRunnerV1({ "npm.verify": { exitCode: 1, stdout: "not ok 3 - synthetic failure\n# fail 1\n" } });
  const authority = new InMemoryWriterAuthorityV1(createWriterGrantForTest({ state: "WRITER" }));
  const app = await createAionServer({
    repositoryRoot, dataRoot: join(root, "private", "aion"), exportRoot: join(root, "private", "aion", "exports"),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(), providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1(), new DeveloperAgentCapabilityV1(developerAgents, repositoryRoot), new VerificationCapabilityV1(verificationRunner)]),
    developerAgents, verificationRunner, authority,
  });
  const address = await app.listen(0);
  try { return await run({ app, address, base: `http://127.0.0.1:${address.port}`, root }); }
  finally { await app.close(); await rm(root, { recursive: true, force: true }); }
}
const post = (base, body) => fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("Command Center binds loopback, serves same-origin assets, bounds requests, and shuts down", async () => {
  await withServer(async ({ base, address }) => {
    assert.equal(address.address, "127.0.0.1");
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/u);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(`${base}/api/state`)).status, 200);
    assert.equal((await fetch(`${base}/nope`)).status, 404);
    assert.equal((await fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json", origin: "https://example.invalid" }, body: "{}" })).status, 403);
    const oversized = await fetch(`${base}/api/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "conversation.create", title: "x".repeat(1024 * 1024 + 64) }) });
    assert.equal(oversized.status, 400);
    assert.match((await oversized.json()).error, /1 MiB limit/u);
  });
});

test("the state endpoint exposes providers, the capability registry, and no absolute local path", async () => {
  await withServer(async ({ base }) => {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.dataRoot, "private/aion");
    assert.deepEqual(state.capabilities.map((c) => c.id).sort(), ["aion.developer.task.v1", "aion.local.echo.v1", "aion.verify.run.v1"]);
    assert.equal(state.providers[0].id, "deterministic");
    assert.equal(state.developerBridge.available, true);
    assert.doesNotMatch(JSON.stringify(state), /[A-Za-z]:\\/u, "no absolute local path reaches the browser");
  });
});

test("chat streams provider tokens over the loopback stream endpoint", async () => {
  await withServer(async ({ base }) => {
    await post(base, { type: "onboarding.complete" });
    const conversation = await (await post(base, { type: "conversation.create", title: "Streaming" })).json();
    const response = await fetch(`${base}/api/chat/stream`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: conversation.result.id, content: "Hello" }) });
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/u);
    const text = await response.text();
    assert.ok(text.split("event: chunk").length > 2, "several chunk frames arrived");
    assert.match(text, /event: done/u);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.state.conversations[0].messages.length, 2);
  });
});

test("the Career bridge accepts only allow-listed commands and explicit normalized roots", async () => {
  await withServer(async ({ base }) => {
    const unsupported = await post(base, { type: "career.run", command: "rm -rf", root: repositoryRoot });
    assert.equal(unsupported.status, 400);
    assert.match((await unsupported.json()).error, /Unsupported Career command/u);
    const relative = await post(base, { type: "career.run", command: "profile", root: "private/career" });
    assert.equal(relative.status, 400);
    assert.match((await relative.json()).error, /normalized absolute path/u);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.state.activity.filter((entry) => entry.category === "career").length, 0, "a rejected command records no Career activity");
  });
});

test("a Career field never displaces the action being dispatched, and a bad source type is refused", async () => {
  await withServer(async ({ base }) => {
    // The Career screen carries a source type. It must not be named `type`, and the UI must write
    // the action last, or an ingest with a source type would silently dispatch nothing.
    const js = await readFile(join(repositoryRoot, "apps/aion/public/app.js"), "utf8");
    assert.match(js, /JSON\.stringify\(\{\s*\.\.\.payload,\s*type\s*\}\)/u, "the action type is written after the payload");
    assert.doesNotMatch(js, /api\("career\.run",\s*\{[^}]*[^a-zA-Z]type:/u, "the Career payload carries no field named type");
    assert.match(js, /name="sourceType"/u, "the Career source-type input is named sourceType");

    const invalid = await post(base, { type: "career.run", command: "ingest", root: repositoryRoot, value: "x", sourceType: "Not A Type" });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /Career source type is invalid/u);
    const displaced = await post(base, { type: "career.run", command: "profile", root: "relative" });
    assert.equal(displaced.status, 400);
    assert.match((await displaced.json()).error, /normalized absolute path/u, "the action still dispatched to the Career bridge");
  });
});

test("unsupported actions and unnormalized import paths fail closed with privacy-safe errors", async () => {
  await withServer(async ({ base }) => {
    assert.equal((await post(base, { type: "definitely.not.supported" })).status, 400);
    const traversal = await post(base, { type: "import.dry-run", platform: "chatgpt", root: "..\\elsewhere", path: "..\\elsewhere\\a.json" });
    assert.equal(traversal.status, 400);
    const error = (await traversal.json()).error;
    assert.match(error, /explicit|normalized/u);
    assert.doesNotMatch(error, /[A-Za-z]:\\/u, "errors never disclose an absolute local path");
  });
});

test("an approval is required before the Command Center will execute a capability", async () => {
  await withServer(async ({ base }) => {
    await post(base, { type: "onboarding.complete" });
    const proposed = await (await post(base, { type: "action.propose", capabilityId: "aion.local.echo.v1", input: { text: "bounded" } })).json();
    assert.equal(proposed.result.action.state, "awaiting-approval");
    assert.equal((await post(base, { type: "action.execute", id: proposed.result.action.id })).status, 400);
    await post(base, { type: "approval.decide", id: proposed.result.approval.id, approve: true });
    const executed = await (await post(base, { type: "action.execute", id: proposed.result.action.id })).json();
    assert.deepEqual(executed.result, { text: "bounded", local: true });
  });
});

test("the state endpoint lists every developer bridge with its exact command and no account probe", async () => {
  await withServer(async ({ base }) => {
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.developerBridges.length, 1);
    const bridge = state.developerBridges[0];
    assert.equal(bridge.selected, true);
    assert.equal(bridge.account, "signed-in", "the synthetic bridge needs no account");
    assert.deepEqual(bridge.commands.map((c) => c.mode), ["read-only", "workspace-write"]);
    assert.equal(bridge.commands.find((c) => c.mode === "read-only").args.includes("workspace-write"), false);
    assert.doesNotMatch(JSON.stringify(state.developerBridges), /[A-Za-z]:\\/u, "no local path reaches the browser");

    const health = await (await post(base, { type: "developer.health" })).json();
    assert.equal(health.result.bridges.length, 1);
    const activity = (await (await fetch(`${base}/api/state`)).json()).state.activity;
    assert.ok(activity.some((entry) => entry.action === "developer.health"), "an explicit health check is audited");
  });
});

test("a read-only developer task is approval-gated end to end and cannot be widened after approval", async () => {
  await withServer(async ({ base }) => {
    await post(base, { type: "onboarding.complete" });
    const readOnly = await (await post(base, { type: "action.propose", capabilityId: "aion.developer.task.v1", input: { instruction: "Report which tests are failing. Do not modify anything.", mode: "read-only" } })).json();
    assert.equal(readOnly.result.action.state, "awaiting-approval");
    assert.match(readOnly.result.approval.summary, /read-only developer-agent task/u);
    assert.equal((await post(base, { type: "action.execute", id: readOnly.result.action.id })).status, 400, "no execution before approval");

    const writing = await (await post(base, { type: "action.propose", capabilityId: "aion.developer.task.v1", input: { instruction: "Report which tests are failing. Do not modify anything.", mode: "workspace-write" } })).json();
    assert.notEqual(readOnly.result.action.inputDigest, writing.result.action.inputDigest);

    await post(base, { type: "approval.decide", id: readOnly.result.approval.id, approve: true });
    const executed = await (await post(base, { type: "action.execute", id: readOnly.result.action.id })).json();
    assert.equal(executed.result.mode, "read-only");
    assert.equal(executed.result.exitCode, 0);
    assert.match(executed.result.summary, /without modifying any file/u);
    assert.equal((await post(base, { type: "action.execute", id: writing.result.action.id })).status, 400, "a read-only approval never authorises a writing run");
    assert.equal((await post(base, { type: "action.execute", id: readOnly.result.action.id })).status, 400, "the approval was consumed by its one execution");
  });
});

test("Settings select a registered developer bridge and reject an unregistered one", async () => {
  await withServer(async ({ base }) => {
    await post(base, { type: "onboarding.complete" });
    const rejected = await post(base, { type: "settings.update", settings: { developerBridgeId: "not-installed" } });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /not registered/u);
    assert.equal((await post(base, { type: "settings.update", settings: { developerBridgeId: "synthetic" } })).status, 200);
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.state.settings.developerBridgeId, "synthetic");
    assert.equal(state.developerBridge.bridgeId, "synthetic");
  });
});

test("the verification loop runs end to end over the loopback API without any shell reaching a model", async () => {
  await withServer(async ({ base }) => {
    await post(base, { type: "onboarding.complete" });
    const state = await (await fetch(`${base}/api/state`)).json();
    assert.ok(state.verificationOperations.length >= 2, "the allowlist is published for the owner to read");
    assert.ok(state.verificationOperations.every((o) => o.readOnly === true));

    for (const bad of [{ command: "npm publish" }, { operationId: "npm.publish" }, { operationId: "npm.verify", args: ["--evil"] }]) {
      const refused = await post(base, { type: "action.propose", capabilityId: "aion.verify.run.v1", input: bad });
      assert.equal(refused.status, 400, `refused: ${JSON.stringify(bad)}`);
    }

    const proposed = await (await post(base, { type: "action.propose", capabilityId: "aion.verify.run.v1", input: { operationId: "npm.verify" } })).json();
    assert.equal(proposed.result.action.state, "awaiting-approval");
    assert.equal((await post(base, { type: "action.execute", id: proposed.result.action.id })).status, 400, "verification is approval-gated");
    await post(base, { type: "approval.decide", id: proposed.result.approval.id, approve: true });
    const evidence = await (await post(base, { type: "action.execute", id: proposed.result.action.id })).json();
    assert.equal(evidence.result.outcome, "failed");

    const withEvidence = await (await fetch(`${base}/api/state`)).json();
    const run = withEvidence.state.verifications[0];
    assert.equal(run.operationId, "npm.verify");
    assert.equal(run.resultDigest.length, 64);

    const analysis = await (await post(base, { type: "verify.analyse", id: run.id, question: "What failed?" })).json();
    assert.equal(analysis.result.action.input.mode, "read-only", "analysing evidence never escalates to write access");
    assert.match(String(analysis.result.action.input.instruction), /not ok 3 - synthetic failure/u);
  });
});

test("Personal and Work stay separated across the API and the rendered UI", async () => {
  await withServer(async ({ base }) => {
    await post(base, { type: "onboarding.complete" });
    const personalMemory = await (await post(base, { type: "memory.create", memory: { content: "Personal preference: mornings", category: "semantic" } })).json();
    const personalTask = await (await post(base, { type: "task.create", task: { title: "Personal task" } })).json();
    assert.equal(personalMemory.result.workspace, "personal", "records join the active workspace");

    await post(base, { type: "settings.update", settings: { activeWorkspace: "work", workspaceLabels: { personal: "Personal", work: "Lakeland Toyota" } } });
    const workMemory = await (await post(base, { type: "memory.create", memory: { content: "Personal preference: mornings", category: "semantic" } })).json();
    assert.equal(workMemory.result.workspace, "work");

    // The same statement in two workspaces is two separate facts, not a conflict.
    const state = (await (await fetch(`${base}/api/state`)).json()).state;
    assert.equal(state.memories.every((m) => m.conflict === "none"), true, "an identical subject in another workspace is not a conflict");
    assert.equal(state.settings.workspaceLabels.work, "Lakeland Toyota", "the workplace label is owner-supplied");

    const workSearch = await (await post(base, { type: "memory.search", query: "mornings" })).json();
    assert.equal(workSearch.result.length, 1, "search never crosses the boundary");
    assert.equal(workSearch.result[0].id, workMemory.result.id);
    assert.equal(workSearch.result[0].id !== personalMemory.result.id, true);

    await post(base, { type: "settings.update", settings: { activeWorkspace: "personal" } });
    const personalSearch = await (await post(base, { type: "memory.search", query: "mornings" })).json();
    assert.equal(personalSearch.result.length, 1);
    assert.equal(personalSearch.result[0].id, personalMemory.result.id);

    assert.equal((await post(base, { type: "settings.update", settings: { activeWorkspace: "confidential" } })).status, 400, "an unknown workspace is refused");
    const tasks = (await (await fetch(`${base}/api/state`)).json()).state.tasks;
    assert.equal(tasks.find((t) => t.id === personalTask.result.id).workspace, "personal");

    // The UI must never render another workspace's records.
    const js = await readFile(join(repositoryRoot, "apps/aion/public/app.js"), "utf8");
    assert.match(js, /const scoped = /u, "the UI has an explicit workspace filter");
    for (const collection of ["s.conversations", "s.tasks", "s.routines", "s.memories", "s.plans"]) {
      assert.match(js, new RegExp(`cards\\(scoped\\(${collection.replace(".", "\\.")}\\)`, "u"), `${collection} is rendered through the workspace filter`);
    }
  });
});

test("a salesperson's day runs end to end over the API in Work, and is refused in Personal", async () => {
  await withServer(async ({ base }) => {
    await post(base, { type: "onboarding.complete" });
    // Personal first: the whole Sales surface must be unavailable.
    for (const call of [
      { type: "customer.create", customer: { displayName: "X" } },
      { type: "customer.find", query: { kind: "all" } },
      { type: "coach", kind: "morning-plan", input: {} },
      { type: "sales.metrics", date: "2030-01-01", counts: { calls: 1 } },
    ]) assert.equal((await post(base, call)).status, 400, `${call.type} is refused in Personal`);

    await post(base, { type: "settings.update", settings: { activeWorkspace: "work", workspaceLabels: { personal: "Personal", work: "Bayfield Motors" } } });

    const created = await (await post(base, { type: "customer.create", customer: { displayName: "J. Rivera (walk-in)", source: "walk-in", interests: [{ kind: "vehicle", description: "compact SUV" }] } })).json();
    const id = created.result.id;
    assert.equal(created.result.workspace, "work");

    await post(base, { type: "customer.interaction", id, interaction: { kind: "call", summary: "Talked through the SUV range." } });
    await post(base, { type: "customer.lifecycle", id, lifecycle: "engaged", summary: "Wants to see one." });
    await post(base, { type: "customer.appointment", id, appointment: { at: "2030-01-01T15:00:00.000Z", location: "showroom" } });
    await post(base, { type: "customer.followup", id, followUp: { dueAt: "2030-01-01T09:00:00.000Z", channel: "phone", reason: "Confirm Saturday." } });

    const found = await (await post(base, { type: "customer.find", query: { kind: "follow-up-due", onDate: "2030-01-01" } })).json();
    assert.deepEqual(found.result.customers.map((c) => c.id), [id]);

    const timeline = await (await post(base, { type: "customer.timeline", id })).json();
    assert.ok(timeline.result.customer.interactions.length >= 4, "the durable timeline is available in one call");
    assert.equal(timeline.result.last.kind, "appointment");

    const prep = await (await post(base, { type: "coach", kind: "call-preparation", input: { customerId: id } })).json();
    assert.match(prep.result.lines.join("\n"), /compact SUV/u);
    const draft = await (await post(base, { type: "coach", kind: "follow-up-draft", input: { customerId: id, channel: "text" } })).json();
    assert.equal(draft.result.draft, true);
    assert.match(draft.result.lines[0], /AION does not send messages/u);

    await post(base, { type: "sales.metrics", date: "2030-01-01", counts: { calls: 12, appointmentsSet: 1 } });
    const summary = await (await post(base, { type: "sales.summary", from: "2030-01-01", to: "2030-01-01" })).json();
    assert.equal(summary.result.totals.calls, 12);
    assert.match(summary.result.source, /Not a dealership CRM figure/u);

    // Sensitive material is refused at the transport boundary too, not only in the domain.
    assert.equal((await post(base, { type: "customer.create", customer: { displayName: "Y", ssn: "111-22-3333" } })).status, 400);

    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.state.relationships.length, 1);
    assert.equal(state.salesRoutineTemplates.length, 4, "routine templates are offered but nothing is scheduled");
    assert.equal(state.state.routines.length, 0);
  });
});

test("the Sales UI is phone-first: large targets, one-tap actions, and a timeline in the detail view", async () => {
  const js = await readFile(join(repositoryRoot, "apps/aion/public/app.js"), "utf8");
  const css = await readFile(join(repositoryRoot, "apps/aion/public/styles.css"), "utf8");
  for (const tab of ["TODAY", "FOLLOW-UPS", "APPOINTMENTS", "PROSPECTS", "COACH", "METRICS"]) {
    assert.ok(js.includes(`"${tab}"`), `the ${tab} tab exists`);
  }
  // The quick actions the directive names must be reachable without leaving the floor view.
  for (const action of ["+ Prospect", "+ Note", "Follow-up", "Appointment", "Coach", "Metrics"]) assert.ok(js.includes(action), `${action} is a quick action`);
  for (const action of ["Call Prep", "Add Note", "Follow-up Draft", "Change Stage"]) assert.ok(js.includes(action), `${action} is on the person view`);
  assert.match(js, /Timeline/u, "the person view shows the durable timeline");
  assert.match(css, /@media \(max-width: 700px\)/u, "there is a real phone layout, not just a narrower desktop");
  assert.match(css, /font-size: 16px/u, "inputs are 16px so iOS does not zoom on focus");
  assert.match(css, /min-height: 2\.(?:75|9)rem/u, "tap targets are thumb-sized");
});

test("UI exposes every required owner-facing area and needs no hosted dependency", async () => {
  const html = await readFile(join(repositoryRoot, "apps/aion/public/index.html"), "utf8");
  const js = await readFile(join(repositoryRoot, "apps/aion/public/app.js"), "utf8");
  const css = await readFile(join(repositoryRoot, "apps/aion/public/styles.css"), "utf8");
  for (const area of ["Sales", "People", "Chat", "Brain", "Studio", "Research", "Projects", "Learning", "Tasks", "Routines", "Memory", "Planner", "Approvals", "Verify", "Activity", "Career", "Imports", "Settings"]) {
    assert.match(js, new RegExp(`"${area}"`, "u"), `the ${area} area must exist`);
  }
  for (const [name, text] of [["index.html", html], ["app.js", js], ["styles.css", css]]) {
    /*
     * No remote origin. Loopback is exempt because a loopback address is definitionally not a
     * hosted dependency -- the Brain screen has to be able to show what a local runtime address
     * looks like. Anything else with a scheme is a reference to somebody else's server.
     */
    const origins = [...text.matchAll(/https?:\/\/([^\s"'`)<>]+)/gu)]
      .map((match) => match[1])
      .filter((host) => !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:[/?#]|$)/u.test(host));
    assert.deepEqual(origins, [], `${name} must not reference a remote origin`);
    assert.doesNotMatch(text, /@import\s+url\(|\b(?:cdn|googleapis|gstatic|unpkg|jsdelivr|googletagmanager)\b|gtag\s*\(|\banalytics\.(?:js|track)\b/i, `${name} must not load a hosted dependency`);
  }
  assert.match(js, /esc\(/u, "rendered values must be escaped");
});
