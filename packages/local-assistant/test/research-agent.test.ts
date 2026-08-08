import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  InMemoryStateRepositoryV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1,
  RESEARCH_STEPS, SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1,
  SyntheticDeveloperAgentBridgeV1, describeRun, findContradictions, planResearch, proposeLearning,
  synthesise,
} from "../src/index.js";
import type { ResearchJobV1, ResearchProviderV1 } from "../src/index.js";

/** No network. The provider is scripted and every source is a reserved `.invalid` name. */

const NOW = "2030-01-01T00:00:00.000Z";

function job(overrides: Partial<ResearchJobV1> = {}): ResearchJobV1 {
  return {
    id: "job-1", workspace: "personal", question: "do shorter handover notes reduce errors",
    scope: "owner-supplied-sources",
    limits: { maxSources: 8, maxBytesPerSource: 1024, maxDurationMs: 1000, maxCostCents: 0 },
    state: "complete", seedReferences: [],
    sources: [
      { id: "s1", reference: "https://a.invalid/one", title: "One", retrievedVia: "test", retrievedAt: NOW, bytes: 10, truncated: false, digest: "a" },
      { id: "s2", reference: "https://b.invalid/two", title: "Two", retrievedVia: "test", retrievedAt: NOW, bytes: 10, truncated: false, digest: "b" },
    ],
    findings: [], unresolved: [], costCents: 0, outputDigest: "d",
    failureReason: null, provenance: { sourceType: "owner", sourceRef: "owner-entry", recordedAt: NOW },
    createdAt: NOW, completedAt: NOW,
    ...overrides,
  };
}
const finding = (id: string, statement: string, sourceIds: string[]) =>
  ({ id, statement, class: "observation" as const, sourceIds, confidence: 55, caveat: "" });

async function assistant(provider: ResearchProviderV1) {
  const root = await mkdtemp(join(tmpdir(), "aion-agent-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  return new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    research: provider,
  });
}

test("a plan decomposes the question without inventing scope", () => {
  const plan = planResearch("Do shorter handover notes reduce clinical errors?", "public-web");
  assert.equal(plan.question, "Do shorter handover notes reduce clinical errors?");
  assert.equal(plan.subQuestions.length, 3);
  assert.ok(plan.successCriteria.some((entry) => /attributable to a source AION actually retrieved/u.test(entry)));
  assert.ok(plan.outOfScope.some((entry) => /login, a paywall, or an access control/u.test(entry)));
  assert.ok(plan.outOfScope.some((entry) => /private, local, or link-local address/u.test(entry)));

  const local = planResearch("anything", "local-only");
  assert.ok(local.outOfScope.some((entry) => /scoped local-only/u.test(entry)));
  assert.throws(() => planResearch("", "public-web"), /between 1 and 2000 characters/u);
  assert.deepEqual([...RESEARCH_STEPS], ["plan", "discover", "retrieve", "extract", "compare", "synthesise"]);
});

test("two sources pointing opposite ways are reported, not reconciled", () => {
  const findings = [
    finding("f1", "Shorter handover notes reduce clinical errors.", ["s1"]),
    finding("f2", "Shorter handover notes do not reduce clinical errors.", ["s2"]),
  ];
  const contradictions = findContradictions(findings, job().sources);
  assert.equal(contradictions.length, 1);
  assert.deepEqual(contradictions[0]!.findingIds.sort(), ["f1", "f2"]);
  assert.deepEqual(contradictions[0]!.sourceRefs.sort(), ["https://a.invalid/one", "https://b.invalid/two"]);
  assert.match(contradictions[0]!.detail, /AION has not decided which is right, and will not/u);
});

test("sources that agree are not mistaken for a contradiction", () => {
  const findings = [
    finding("f1", "Shorter handover notes reduce clinical errors.", ["s1"]),
    finding("f2", "Shorter handover notes reduce clinical errors markedly.", ["s2"]),
  ];
  assert.deepEqual(findContradictions(findings, job().sources), []);
});

test("a synthesis reports what pages said and refuses to call any of it a fact", () => {
  const result = synthesise(job({
    findings: [
      finding("f1", "Shorter handover notes reduce clinical errors.", ["s1"]),
      finding("f2", "Shorter handover notes reduce clinical errors.", ["s2"]),
    ],
  }));
  assert.equal(result.confidence, "moderate", "two sources agreeing is moderate evidence, not proof");
  assert.equal(result.supported.length, 1);
  assert.equal(result.supported[0]?.agreement, 2);
  assert.deepEqual(result.supported[0]?.sourceRefs.sort(), ["https://a.invalid/one", "https://b.invalid/two"]);
  assert.match(result.statement, /None of this is a fact/u);
  assert.match(result.statement, /AION has verified none of it/u);
});

test("a single-source claim is counted as such, because that is how research misleads", () => {
  const result = synthesise(job({ findings: [finding("f1", "Shorter handover notes reduce clinical errors.", ["s1"])] }));
  assert.equal(result.confidence, "weak");
  assert.equal(result.singleSourceCount, 1);
  assert.match(result.statement, /1 of them rest on a single source/u);
});

test("a contested result says so and does not pick a side", () => {
  const result = synthesise(job({
    findings: [
      finding("f1", "Shorter handover notes reduce clinical errors.", ["s1"]),
      finding("f2", "Shorter handover notes do not reduce clinical errors.", ["s2"]),
    ],
  }));
  assert.equal(result.confidence, "contested");
  assert.equal(result.supported.length, 0, "a contradicted claim is not presented as supported");
  assert.equal(result.contradictions.length, 1);
  assert.match(result.statement, /reported rather than resolved/u);
});

test("finding nothing is a result rather than a negative answer", () => {
  const result = synthesise(job({ findings: [] }));
  assert.equal(result.confidence, "none");
  assert.match(result.statement, /treat the question as open rather than answered in the negative/u);
  assert.equal(synthesise(job({ state: "proposed" })).statement, "This research job is proposed. Nothing has been established.");
});

test("proposed learning is never a fact, whatever the sources agreed", () => {
  const result = synthesise(job({
    findings: [
      finding("f1", "Shorter handover notes reduce clinical errors.", ["s1"]),
      finding("f2", "Shorter handover notes reduce clinical errors.", ["s2"]),
    ],
  }));
  const proposals = proposeLearning(result);
  assert.ok(proposals.length >= 2);
  assert.equal(proposals.every((entry) => ["observation", "inference", "hypothesis"].includes(entry.class)), true);
  assert.equal(proposals.some((entry) => (entry.class as string) === "fact"), false);
  assert.equal(proposals.every((entry) => entry.confidence <= 70), true, "agreement between pages is not verification");
  assert.equal(proposals.every((entry) => entry.supportedBy.length > 0), true);

  const contested = proposeLearning(synthesise(job({
    findings: [finding("f1", "It works.", ["s1"]), finding("f2", "It does not work.", ["s2"])],
  })));
  assert.equal(contested[0]?.class, "hypothesis");
  assert.match(contested[0]!.statement, /^Sources disagree about:/u);
  assert.equal(contested[0]?.confidence, 20);
});

test("the trace shows what the agent did rather than asking to be trusted", () => {
  const complete = job({ findings: [finding("f1", "A claim.", ["s1"])] });
  const plan = planResearch(complete.question, complete.scope);
  const trace = [
    { step: "plan" as const }, { step: "discover" as const }, { step: "retrieve" as const },
    { step: "extract" as const }, { step: "compare" as const }, { step: "synthesise" as const },
  ];
  const actual = synthesise(complete);
  const described = describeRun(plan, complete, actual, NOW);
  assert.deepEqual(described.map((entry) => entry.step), trace.map((entry) => entry.step));
  assert.match(described.find((entry) => entry.step === "retrieve")!.detail, /2 source\(s\) retrieved/u);
  assert.match(described.find((entry) => entry.step === "compare")!.detail, /No contradictions found/u);
});

test("the agent runs end to end through the service and adopts only a typed lesson", async () => {
  const scripted: ResearchProviderV1 = {
    id: "scripted", reachesNetwork: false,
    async health() { return { available: true, detail: "scripted" }; },
    async run() {
      return {
        sources: [
          { reference: "https://a.invalid/one", title: "One", retrievedVia: "scripted", retrievedAt: NOW, bytes: 10, truncated: false, digest: "a" },
          { reference: "https://b.invalid/two", title: "Two", retrievedVia: "scripted", retrievedAt: NOW, bytes: 10, truncated: false, digest: "b" },
        ],
        findings: [
          { statement: "Shorter handover notes reduce clinical errors.", class: "observation" as const, sourceReferences: ["https://a.invalid/one"], confidence: 55, caveat: "" },
          { statement: "Shorter handover notes reduce clinical errors.", class: "observation" as const, sourceReferences: ["https://b.invalid/two"], confidence: 55, caveat: "" },
        ],
        unresolved: ["Nothing addressed cost."], costCents: 0,
      };
    },
  };
  const service = await assistant(scripted);
  const proposed = await service.proposeResearchJob({ question: "do shorter handover notes reduce errors", scope: "owner-supplied-sources", seedReferences: ["https://a.invalid/one"] });
  await service.approveResearchJob(proposed.id);
  await service.runResearchJob(proposed.id);

  const analysis = await service.analyseResearchJob(proposed.id);
  assert.equal(analysis.synthesis.confidence, "moderate");
  assert.equal(analysis.trace.length, 6);
  assert.ok(analysis.proposedLearning.length >= 1);

  const lesson = await service.adoptResearchLearning(proposed.id, 0);
  assert.equal(lesson.claim.class, "observation", "a model-side proposal never becomes a fact");
  assert.equal(lesson.claim.provenance.sourceType, "provider-proposal");
  assert.ok(lesson.claim.supportedBy.includes(`research:${proposed.id}`));
  assert.ok(lesson.claim.supportedBy.some((entry) => entry.startsWith("https://")));

  await assert.rejects(() => service.adoptResearchLearning(proposed.id, 99), /does not exist/u);
});

test("analysing a job in another workspace is refused", async () => {
  const scripted: ResearchProviderV1 = {
    id: "scripted", reachesNetwork: false,
    async health() { return { available: true, detail: "scripted" }; },
    async run() { return { sources: [], findings: [], unresolved: [], costCents: 0 }; },
  };
  const service = await assistant(scripted);
  const proposed = await service.proposeResearchJob({ question: "anything", scope: "local-only" });
  await service.updateSettings({ activeWorkspace: "work" });
  await assert.rejects(() => service.analyseResearchJob(proposed.id), /different workspace/iu);
});
