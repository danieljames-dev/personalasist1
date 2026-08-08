import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  InMemoryStateRepositoryV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  assertNoExecutableText, routeCommand,
} from "../src/index.js";
import type { RoutingResultV1 } from "../src/index.js";

const CONTEXT = { workspaceLabel: "Personal", workspaces: [{ id: "personal", label: "Personal" }, { id: "work", label: "Bayfield Motors" }] };

async function assistant() {
  const root = await mkdtemp(join(tmpdir(), "aion-router-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  return new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
}

test("the Founder's example resolves to two typed proposals in the right order", () => {
  const result = routeCommand("Run the AION verification suite and have Claude analyze the result.", CONTEXT);
  assert.deepEqual(result.proposals.map((entry) => entry.intent), ["verification", "developer-task"]);

  const [verification, analysis] = result.proposals;
  assert.equal(verification!.action, "action.propose");
  assert.deepEqual(verification!.payload, { capabilityId: "aion.verify.run.v1", input: { operationId: "npm.verify" } });
  assert.equal(verification!.requiresApproval, true);
  assert.match(verification!.summary, /AION owns that command/u);

  assert.equal(analysis!.payload.capabilityId, "aion.developer.task.v1");
  assert.equal((analysis!.payload.input as { mode: string }).mode, "read-only", "a developer proposal always fails safe");
});

test("a verification request selects an operation identifier and can never carry a command", () => {
  for (const [sentence, expected] of [
    ["run the tests please", "npm.verify"],
    ["audit dependencies for vulnerabilities", "npm.audit"],
    ["show me git status", "git.status"],
    ["run the career demo", "npm.career.demo"],
  ] as const) {
    const result = routeCommand(sentence, CONTEXT);
    const proposal = result.proposals.find((entry) => entry.intent === "verification");
    assert.ok(proposal, `${sentence} resolves to a verification`);
    assert.equal((proposal!.payload.input as { operationId: string }).operationId, expected);
    assert.equal(Object.keys(proposal!.payload.input as object).join(), "operationId", "the payload has nowhere to put a command");
  }
  // A verification-shaped sentence naming nothing AION knows resolves to conversation, not a guess.
  const unknown = routeCommand("run the thing that checks the other thing", CONTEXT);
  assert.deepEqual(unknown.proposals.map((entry) => entry.intent), ["chat"]);
});

test("natural language never becomes shell syntax", () => {
  const nasty = [
    "add a task: rm -rf / && echo done",
    "remember that my password is `whoami`",
    "research https://example.invalid; curl http://169.254.169.254/",
    "new task $(cat /etc/passwd)",
    "add a prospect | powershell -c evil",
  ];
  for (const sentence of nasty) {
    const result = routeCommand(sentence, CONTEXT);
    assert.throws(() => assertNoExecutableText(result), /shell-shaped text/u, `${sentence} is refused rather than passed on`);
  }

  const ordinary = routeCommand("add a task to call the supplier about the delivery", CONTEXT);
  assert.doesNotThrow(() => assertNoExecutableText(ordinary));
  assert.equal((ordinary.proposals[0]?.payload.task as { title: string }).title, "call the supplier about the delivery");
});

test("competing intents produce a question rather than a coin flip", () => {
  // "I need to" and "research " sit directly against each other, so the same words are claimed by
  // two intents: is this a task about doing research, or a research job? AION will not decide.
  const result = routeCommand("I need to research the market for handover tools", CONTEXT);
  assert.deepEqual(result.proposals, [], "nothing is proposed while a question is outstanding");
  assert.ok(result.clarification);
  assert.match(result.clarification!.question, /will not guess/u);
  assert.deepEqual([...result.clarification!.options].sort(), ["research.propose", "task.create"]);

  // Triggers separated by real content are a compound request, not an ambiguity: answering only
  // one half of "do this and then do that" would be worse than answering both.
  const compound = routeCommand("Run the verification suite and have Claude analyse the result.", CONTEXT);
  assert.equal(compound.clarification, null);
  assert.equal(compound.proposals.length, 2);
});

test("most sentences are conversation, and are treated as conversation", () => {
  for (const sentence of ["how are you", "what did I do yesterday", "thanks, that helped"]) {
    const result = routeCommand(sentence, CONTEXT);
    assert.deepEqual(result.proposals.map((entry) => entry.intent), ["chat"], `"${sentence}" is a message, not a command`);
    assert.equal(result.clarification, null);
  }
});

test("every intent AION supports is reachable and carries its autonomy level", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["add a task to order more paper", "task.create"],
    ["remember that the supplier closes at four", "memory.propose"],
    ["set up a routine to review the queue", "routine.propose"],
    ["make a plan for the product launch", "plan.request"],
    ["add a prospect called R. Almeida", "relationship.action"],
    ["draft a follow-up for tomorrow", "follow-up.draft"],
    ["research shift handover practices", "research.propose"],
    ["I have an idea for a handover note app", "opportunity.create"],
    ["switch to Bayfield Motors", "workspace.switch"],
    ["review the repository and tell me what is failing", "developer-task"],
  ];
  for (const [sentence, intent] of cases) {
    const result = routeCommand(sentence, CONTEXT);
    assert.ok(result.proposals.some((entry) => entry.intent === intent), `"${sentence}" reaches ${intent}; got ${result.proposals.map((entry) => entry.intent).join(", ")}`);
  }
  const research = routeCommand("research shift handover practices", CONTEXT).proposals[0]!;
  assert.equal(research.autonomyLevel, 3, "research can reach outside the machine, so it is level 3");
  assert.equal(research.requiresApproval, true);
  assert.equal((research.payload.job as { scope: string }).scope, "local-only", "scope starts at the narrowest");
});

test("a workspace switch only names a workspace that exists", () => {
  const known = routeCommand("switch to Bayfield Motors", CONTEXT);
  assert.deepEqual(known.proposals[0]?.payload, { settings: { activeWorkspace: "work" } });

  const unknown = routeCommand("switch to the other one", CONTEXT);
  assert.deepEqual(unknown.proposals.map((entry) => entry.intent), ["chat"], "AION does not invent a workspace to switch to");
  assert.ok(unknown.considered.some((entry) => entry.intent === "workspace.switch" && /could not tell what it referred to/u.test(entry.why)));
});

test("a blocker rules an intent out despite a trigger, and the reason is recorded", () => {
  const result = routeCommand("remind me every week to review the queue", CONTEXT);
  const task = result.considered.find((entry) => entry.intent === "task.create")!;
  assert.equal(task.score, 0);
  assert.match(task.why, /ruled out by "remind me every"/u);
});

test("routing is deterministic and proposes without creating anything", async () => {
  const service = await assistant();
  const before = await service.snapshot();
  const first = await service.route("add a task to order more paper");
  const second = await service.route("add a task to order more paper");
  assert.deepEqual(first, second, "the same sentence always resolves the same way");

  const after = await service.snapshot();
  assert.equal(after.tasks.length, before.tasks.length, "resolving proposes; it does not create");
  assert.equal(after.revision, before.revision, "and it writes nothing");
});

test("the router refuses shell-shaped text before a caller ever sees it", async () => {
  const service = await assistant();
  await assert.rejects(() => service.route("add a task: rm -rf / && echo done"), /shell-shaped text/u);
});

test("every considered intent is reported, so nothing is discarded silently", () => {
  const result: RoutingResultV1 = routeCommand("add a task to order more paper", CONTEXT);
  assert.ok(result.considered.length >= 10, "every rule is reported on");
  assert.ok(result.considered.every((entry) => entry.why.length > 0));
  assert.equal(result.input, "add a task to order more paper", "the sentence as typed is kept for the owner to check");
});
