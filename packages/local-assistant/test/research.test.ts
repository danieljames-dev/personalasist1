import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  InMemoryStateRepositoryV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  SyntheticResearchProviderV1, UnavailableResearchProviderV1,
  evaluateResearchUrl, isPrivateIpv4, isPrivateIpv6, settledClaims,
} from "../src/index.js";
import type { ResearchProviderV1 } from "../src/index.js";

/**
 * No network request is made anywhere in this suite. The research provider is a scripted corpus,
 * every URL is on a reserved or `.invalid` name, and the SSRF guard is exercised as pure logic.
 */

const CORPUS = {
  "https://example.invalid/handover-study": {
    title: "Handover practices in small clinics",
    body: "A survey of shift handover practices found that verbal handover loses detail.",
  },
  "https://example.invalid/unrelated": {
    title: "Bicycle maintenance quarterly",
    body: "Chain wear is measured with a gauge.",
  },
};

async function researcher(provider: ResearchProviderV1 = new SyntheticResearchProviderV1(CORPUS)) {
  const root = await mkdtemp(join(tmpdir(), "aion-research-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    research: provider,
  });
  return service;
}

test("AION ships with no research provider and says so rather than reaching out", async () => {
  const root = await mkdtemp(join(tmpdir(), "aion-research-none-"));
  const exports = join(root, "exports"); await mkdir(exports);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
    research: new UnavailableResearchProviderV1(),
  });
  const job = await service.proposeResearchJob({ question: "Anything at all", scope: "public-web" });
  await service.approveResearchJob(job.id);
  await assert.rejects(() => service.runResearchJob(job.id), /No research provider is configured/iu);

  // Nothing about the job was wrong, so it stays approved and will run unchanged once a provider
  // exists. The refusal is recorded rather than swallowed.
  const stored = (await service.researchJobs()).find((entry) => entry.id === job.id)!;
  assert.equal(stored.state, "approved");
  assert.equal(stored.findings.length, 0);
  const recorded = (await service.snapshot()).activity.find((entry) => entry.action === "research.unavailable");
  assert.ok(recorded, "the refusal is in Activity");
  assert.equal(recorded!.outcome, "denied");
  assert.match(recorded!.summary, /No research provider is configured/u);
});

test("proposing a research job runs nothing until the owner approves it", async () => {
  const service = await researcher();
  const job = await service.proposeResearchJob({
    question: "handover", scope: "owner-supplied-sources",
    seedReferences: ["https://example.invalid/handover-study"],
  });
  assert.equal(job.state, "proposed");
  assert.deepEqual(job.sources, []);
  await assert.rejects(() => service.runResearchJob(job.id), /must be approved before it runs/iu);

  await service.approveResearchJob(job.id);
  const complete = await service.runResearchJob(job.id);
  assert.equal(complete.state, "complete");
  assert.equal(complete.sources.length, 1);
  assert.equal(complete.findings.length, 1);
  assert.ok(complete.outputDigest.length === 64, "the exact result is identified by a digest");

  await assert.rejects(() => service.approveResearchJob(job.id), /Only a proposed research job/iu);
});

test("every finding cites a source AION actually retrieved, and uncited ones are discarded", async () => {
  const inventive = {
    id: "inventive", reachesNetwork: false,
    async health() { return { available: true, detail: "scripted" }; },
    async run() {
      return {
        sources: [{ reference: "https://example.invalid/real", title: "Real", retrievedVia: "scripted", retrievedAt: "2030-01-01T00:00:00.000Z", bytes: 10, truncated: false, digest: "a".repeat(64) }],
        findings: [
          { statement: "Backed by the source.", class: "observation" as const, sourceReferences: ["https://example.invalid/real"], confidence: 70, caveat: "" },
          { statement: "I just know this.", class: "observation" as const, sourceReferences: [], confidence: 99, caveat: "" },
          { statement: "Cites something never fetched.", class: "observation" as const, sourceReferences: ["https://example.invalid/ghost"], confidence: 99, caveat: "" },
        ],
        unresolved: [], costCents: 0,
      };
    },
  };
  const service = await researcher(inventive);
  const job = await service.proposeResearchJob({ question: "anything", scope: "owner-supplied-sources", seedReferences: ["https://example.invalid/real"] });
  await service.approveResearchJob(job.id);
  const complete = await service.runResearchJob(job.id);

  assert.equal(complete.findings.length, 1, "only the finding with a real citation survives");
  assert.equal(complete.findings[0]?.statement, "Backed by the source.");
  assert.ok(complete.unresolved.some((entry) => entry.includes("2 finding(s) were discarded")), "the discards are reported, not hidden");
});

test("a research finding becomes a typed claim and never a fact", async () => {
  const service = await researcher();
  const brand = await service.createWorkspace({ label: "Quillfeather Labs" });
  await service.updateSettings({ activeWorkspace: brand.id });
  const opportunity = await service.createOpportunity({ title: "Shift-handover notes" });

  const job = await service.proposeResearchJob({ question: "handover", scope: "owner-supplied-sources", seedReferences: ["https://example.invalid/handover-study"] });
  await service.approveResearchJob(job.id);
  const complete = await service.runResearchJob(job.id);

  const adopted = await service.adoptResearchFinding(job.id, complete.findings[0]!.id, opportunity.id);
  const claim = adopted.claims.at(-1)!;
  assert.equal(claim.class, "observation", "a finding arrives as the class the provider gave it");
  assert.equal(claim.provenance.sourceType, "provider-proposal");
  assert.ok(claim.supportedBy.includes(`research:${job.id}`), "the claim cites the job it came from");
  assert.ok(claim.supportedBy.includes("https://example.invalid/handover-study"), "and the source behind it");
  assert.deepEqual(settledClaims(adopted.claims), [], "adopting research settles nothing on its own");
  assert.deepEqual(adopted.researchJobIds, [job.id]);
});

test("a job that finds nothing says so rather than producing something", async () => {
  const service = await researcher();
  const job = await service.proposeResearchJob({ question: "quantum", scope: "owner-supplied-sources", seedReferences: ["https://example.invalid/unrelated"] });
  await service.approveResearchJob(job.id);
  const complete = await service.runResearchJob(job.id);
  assert.equal(complete.findings.length, 0);
  assert.ok(complete.unresolved.some((entry) => entry.includes("Nothing in the supplied sources")));
});

test("limits are enforced and a job costing more than allowed is refused outright", async () => {
  const expensive = {
    id: "expensive", reachesNetwork: true,
    async health() { return { available: true, detail: "scripted" }; },
    async run() { return { sources: [], findings: [], unresolved: [], costCents: 500 }; },
  };
  const service = await researcher(expensive);
  const job = await service.proposeResearchJob({ question: "anything", scope: "public-web", limits: { maxCostCents: 0 } });
  await service.approveResearchJob(job.id);
  await assert.rejects(() => service.runResearchJob(job.id), /cost 500 cents but was limited to 0/iu);
  assert.equal((await service.researchJobs()).find((entry) => entry.id === job.id)?.state, "failed");
});

test("the URL guard refuses anything that is not a public HTTP endpoint", () => {
  const refused = [
    ["file:///C:/Users/someone/secrets.txt", /only http and https/iu],
    ["ftp://example.invalid/data", /only http and https/iu],
    ["http://user:token@example.invalid/", /username or password/iu],
    ["http://localhost:31415/api/state", /this computer/iu],
    ["http://127.0.0.1/", /private, loopback, or link-local/iu],
    ["http://[::1]/", /private, loopback, or link-local/iu],
    ["http://192.168.1.10/setup", /private, loopback, or link-local/iu],
    ["http://10.0.0.1/", /private, loopback, or link-local/iu],
    ["http://172.16.4.9/", /private, loopback, or link-local/iu],
    ["http://169.254.169.254/latest/meta-data/", /private, loopback, or link-local/iu],
    ["http://100.100.1.1/", /private, loopback, or link-local/iu],
    ["http://[::ffff:10.0.0.5]/", /private, loopback, or link-local/iu],
    ["http://nas.local/admin", /private-network or anonymity-network/iu],
    ["http://something.onion/", /private-network or anonymity-network/iu],
    ["http://intranet/", /not a public hostname/iu],
    ["not a url", /not a valid absolute URL/iu],
    ["", /required/iu],
  ] as const;
  for (const [candidate, pattern] of refused) {
    const verdict = evaluateResearchUrl(candidate);
    assert.equal(verdict.allowed, false, `${candidate || "(empty)"} must be refused`);
    assert.match(verdict.reason, pattern, `${candidate || "(empty)"} explains itself`);
  }

  const allowed = evaluateResearchUrl("https://example.invalid/page?q=1");
  assert.equal(allowed.allowed, true);
  assert.match(allowed.reason, /send no credentials, follow no login/u);
});

test("the address classifiers agree with the guard", () => {
  for (const address of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "100.64.0.1", "169.254.1.1", "172.31.255.255", "192.168.0.1", "198.18.0.1", "224.0.0.1"]) {
    assert.equal(isPrivateIpv4(address), true, `${address} is not public`);
  }
  for (const address of ["8.8.8.8", "203.0.113.4", "172.32.0.1", "100.128.0.1", "192.169.0.1"]) {
    assert.equal(isPrivateIpv4(address), false, `${address} is a routable address`);
  }
  for (const address of ["::1", "fd00::1", "fe80::1", "[::ffff:127.0.0.1]", "ff02::1"]) {
    assert.equal(isPrivateIpv6(address), true, `${address} is not public`);
  }
  assert.equal(isPrivateIpv6("2001:db8::1"), false);
});

test("a job that is meant to use only the owner's sources cannot start with none", async () => {
  const service = await researcher();
  await assert.rejects(() => service.proposeResearchJob({ question: "anything", scope: "owner-supplied-sources" }), /at least one is required/iu);
  await assert.rejects(
    () => service.proposeResearchJob({ question: "anything", scope: "public-web", seedReferences: ["http://192.168.1.5/"] }),
    /private, loopback, or link-local/iu,
    "a seed source passes the same guard as anything else",
  );
});

test("research jobs are workspace-scoped and cannot be adopted across a boundary", async () => {
  const service = await researcher();
  const brandA = await service.createWorkspace({ label: "Alpha Works" });
  const brandB = await service.createWorkspace({ label: "Beta Works" });

  await service.updateSettings({ activeWorkspace: brandA.id });
  const job = await service.proposeResearchJob({ question: "handover", scope: "owner-supplied-sources", seedReferences: ["https://example.invalid/handover-study"] });
  await service.approveResearchJob(job.id);
  const complete = await service.runResearchJob(job.id);

  await service.updateSettings({ activeWorkspace: brandB.id });
  const otherOpportunity = await service.createOpportunity({ title: "Something else entirely" });
  assert.deepEqual(await service.researchJobs(), [], "the job is invisible from the other workspace");
  await assert.rejects(
    () => service.adoptResearchFinding(job.id, complete.findings[0]!.id, otherOpportunity.id),
    /different workspace/iu,
  );
});
