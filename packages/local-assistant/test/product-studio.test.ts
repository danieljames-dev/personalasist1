import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, DeterministicClockV1, DeterministicIdGeneratorV1, DeterministicModelProviderV1,
  InMemoryStateRepositoryV1, LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1,
  SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  buildClaim, claimBalance, promoteClaim, settledClaims,
} from "../src/index.js";
import type { KnowledgeClaimV1 } from "../src/index.js";

/**
 * Every opportunity, competitor, and market below is invented. No real product, business, or
 * market research is referenced, and no network call is made anywhere in this suite.
 */

async function studio() {
  const root = await mkdtemp(join(tmpdir(), "aion-studio-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  const service = new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers: [new DeterministicModelProviderV1()],
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
  const brand = await service.createWorkspace({ label: "Quillfeather Labs" });
  await service.updateSettings({ activeWorkspace: brand.id });
  return { service, workspaceId: brand.id };
}

const idea = {
  title: "Shift-handover notes for small clinics",
  problem: "Handover happens verbally and details are lost between shifts.",
  targetCustomer: "Practice managers at clinics with fewer than twenty staff.",
  proposedSolution: "A shared handover note with a fixed structure.",
  problemSeverity: 8, reachability: 5, ownerAdvantage: 6, effort: 6,
};

test("a new opportunity scores zero and says why, because nothing is established yet", async () => {
  const { service } = await studio();
  const created = await service.createOpportunity(idea);
  assert.equal(created.stage, "idea");
  assert.deepEqual(created.claims, []);

  const { score, balance, caution } = await service.assessOpportunity(created.id);
  assert.equal(score.total, 0, "a confident-sounding idea with nothing behind it scores zero");
  assert.equal(score.evidenceStrength, 0);
  assert.match(score.explanation, /This is an idea, not a finding/u);
  assert.match(balance.summary, /nothing to conclude from/iu);
  assert.match(caution, /AION did not gather market evidence for this and cannot/u);
});

test("the score rises only when claims are actually confirmed, not when they are reworded", async () => {
  const { service } = await studio();
  const created = await service.createOpportunity(idea);

  const withGuesses = await service.addOpportunityClaim(created.id, { class: "assumption", statement: "Clinics would pay for this." });
  await service.addOpportunityClaim(created.id, { class: "hypothesis", statement: "Handover errors cause repeat appointments." });
  const guessScore = (await service.assessOpportunity(created.id)).score;
  assert.equal(guessScore.evidenceStrength, 0, "assumptions and hypotheses are not evidence");
  assert.equal(guessScore.total, 0);

  // Rewording changes nothing at all.
  await service.updateOpportunity(created.id, { problem: "Handover happens verbally and important details are lost between shifts, repeatedly." });
  assert.equal((await service.assessOpportunity(created.id)).score.total, 0, "better prose does not raise the score");

  const assumption = withGuesses.claims[0]!;
  await service.promoteOpportunityClaim(created.id, assumption.id, "fact", "Three practice managers told me directly and I recorded the calls.");
  const confirmed = await service.assessOpportunity(created.id);
  assert.equal(confirmed.score.evidenceStrength, 50, "one of two live claims is now settled");
  assert.ok(confirmed.score.total > 0, "confirming a claim is what moves the score");
  assert.match(confirmed.score.explanation, /1 settled of 2 live claims/u);
});

test("a model cannot record a fact, only propose something the owner may promote", async () => {
  const { service } = await studio();
  const created = await service.createOpportunity(idea);

  await assert.rejects(
    () => service.addOpportunityClaim(created.id, { class: "fact", statement: "The market is worth ten million." }, "provider-proposal"),
    /Only the owner can record a fact/iu,
  );
  await assert.rejects(
    () => service.addOpportunityClaim(created.id, { class: "owner-confirmed", statement: "Confirmed by me, honest." }, "provider-proposal"),
    /Only the owner can record/iu,
  );

  const proposed = await service.addOpportunityClaim(created.id, { class: "hypothesis", statement: "Clinics may prefer paper." }, "provider-proposal");
  const claim = proposed.claims.at(-1)!;
  assert.equal(claim.class, "hypothesis");
  assert.equal(claim.provenance.sourceType, "provider-proposal", "the proposal is recorded as a proposal");
  assert.deepEqual(settledClaims(proposed.claims), [], "nothing a model said counts as settled");
});

test("a claim that only means something with a citation cannot be recorded without one", async () => {
  const { service } = await studio();
  const created = await service.createOpportunity(idea);
  for (const claimClass of ["observation", "evidence", "inference", "learned-strategy"] as const) {
    await assert.rejects(
      () => service.addOpportunityClaim(created.id, { class: claimClass, statement: "Something happened." }),
      /must cite what it rests on/iu,
      `${claimClass} needs a source`,
    );
  }
  const cited = await service.addOpportunityClaim(created.id, { class: "observation", statement: "Two clinics keep a paper log.", supportedBy: ["visit-notes-2030-01-02"] });
  assert.equal(cited.claims.at(-1)?.supportedBy.length, 1);
});

test("promotion follows a declared path, keeps the history, and refuses shortcuts", () => {
  const claim = buildClaim(
    { class: "hypothesis", statement: "Weekly digests reduce churn." },
    { id: "claim-1", workspace: "personal", now: "2030-01-01T00:00:00.000Z", actor: "owner", sourceRef: "owner-entry" },
  );
  assert.throws(() => promoteClaim(claim, "evidence", "because", "2030-01-02T00:00:00.000Z"), /cannot become/iu);
  assert.throws(() => promoteClaim(claim, "fact", "", "2030-01-02T00:00:00.000Z"), /requires a reason/iu);

  const promoted = promoteClaim(claim, "fact", "Measured over two quarters.", "2030-01-02T00:00:00.000Z");
  assert.equal(promoted.class, "fact");
  assert.deepEqual(promoted.promotions, [{ at: "2030-01-02T00:00:00.000Z", from: "hypothesis", to: "fact", reason: "Measured over two quarters." }]);
  assert.equal(claim.class, "hypothesis", "the original is not mutated");

  const confirmed = promoteClaim(promoted, "owner-confirmed", "Checked again.", "2030-01-03T00:00:00.000Z");
  assert.equal(confirmed.promotions.length, 2, "the whole history of the belief is kept");
  assert.throws(() => promoteClaim(confirmed, "fact", "back again", "2030-01-04T00:00:00.000Z"), /already final/iu);
});

test("superseding a claim keeps it rather than deleting it", async () => {
  const { service } = await studio();
  const created = await service.createOpportunity(idea);
  const first = (await service.addOpportunityClaim(created.id, { class: "assumption", statement: "Clinics buy annually." })).claims.at(-1)!;
  const second = (await service.addOpportunityClaim(created.id, { class: "assumption", statement: "Clinics buy monthly." })).claims.at(-1)!;

  const after = await service.supersedeOpportunityClaim(created.id, first.id, second.id);
  const superseded = after.claims.find((claim) => claim.id === first.id)!;
  assert.equal(superseded.enabled, false);
  assert.equal(superseded.supersededBy, second.id);
  assert.equal(superseded.statement, "Clinics buy annually.", "the old belief is still readable");
  assert.equal(claimBalance(after.claims).unverified, 1, "a superseded claim no longer counts toward the balance");
});

test("an experiment states its success criteria first and its result cannot be rewritten", async () => {
  const { service } = await studio();
  const created = await service.createOpportunity(idea);
  const hypothesis = (await service.addOpportunityClaim(created.id, { class: "hypothesis", statement: "Managers will trial a structured note." })).claims.at(-1)!;

  await assert.rejects(() => service.addExperiment(created.id, { title: "Trial", method: "Ask five clinics." }), /Success criteria is required/iu);
  const withExperiment = await service.addExperiment(created.id, {
    hypothesisId: hypothesis.id, title: "Five-clinic trial", method: "Ask five clinics to use it for a week.",
    successCriteria: "At least three still using it after seven days.",
  });
  const experiment = withExperiment.experiments[0]!;
  assert.equal(experiment.status, "proposed");
  assert.equal(experiment.completedAt, null);

  const refuted = await service.completeExperiment(created.id, experiment.id, "refuted", "One clinic continued; four stopped after two days.");
  assert.equal(refuted.experiments[0]?.status, "refuted");
  await assert.rejects(
    () => service.completeExperiment(created.id, experiment.id, "supported", "Actually it went well."),
    /already has a recorded result/iu,
    "a finished experiment cannot be reinterpreted into a different conclusion",
  );
});

test("an untested hypothesis and an unresearched competitor note are both called out", async () => {
  const { service } = await studio();
  const created = await service.createOpportunity(idea);
  await service.addOpportunityClaim(created.id, { class: "hypothesis", statement: "Nobody else does this well." });
  await service.addCompetitorNote(created.id, { name: "Wrenfield Systems", observation: "I think their product is clunky." });

  const { caution, openQuestions } = await service.assessOpportunity(created.id);
  assert.match(caution, /1 hypothesis\(es\) have no completed experiment behind them/u);
  assert.match(caution, /impressions rather than researched observations/u);
  assert.deepEqual(openQuestions, ["hypothesis: Nobody else does this well."]);

  const cited = await service.addCompetitorNote(created.id, { name: "Marlowe Health", observation: "Their pricing page lists three tiers.", sourceRef: "https://example.invalid/pricing captured 2030-01-02" });
  assert.equal(cited.competitors[1]?.sourceRef.startsWith("owner-impression"), false);
});

test("Product Studio is workspace-scoped like everything else", async () => {
  const { service, workspaceId } = await studio();
  const created = await service.createOpportunity(idea);
  assert.equal(created.workspace, workspaceId);

  await service.updateSettings({ activeWorkspace: "personal" });
  assert.deepEqual(await service.opportunities(), [], "another workspace sees none of it");
  await assert.rejects(() => service.assessOpportunity(created.id), /different workspace/iu);
  await assert.rejects(() => service.updateOpportunity(created.id, { title: "Reached across" }), /different workspace/iu);
});

test("settled claims are the only ones a summary may state as true", () => {
  const now = "2030-01-01T00:00:00.000Z";
  const make = (id: string, claimClass: KnowledgeClaimV1["class"], supportedBy: string[] = []) =>
    buildClaim({ class: claimClass, statement: `${claimClass} ${id}`, supportedBy }, { id, workspace: "personal", now, actor: "owner", sourceRef: "owner-entry" });
  const claims = [
    make("a", "fact"), make("b", "owner-confirmed"), make("c", "assumption"),
    make("d", "hypothesis"), make("e", "inference", ["a"]), make("f", "observation", ["a"]),
  ];
  assert.deepEqual(settledClaims(claims).map((claim) => claim.id), ["a", "b"]);
  const balance = claimBalance(claims);
  assert.equal(balance.settled, 2);
  assert.equal(balance.unverified, 4);
  assert.match(balance.summary, /Treat the unverified ones as open questions, not findings/u);
});
