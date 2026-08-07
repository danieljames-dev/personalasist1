import assert from "node:assert/strict";
import test from "node:test";
import { validateCareerFactPayloadV1, validateCareerProfilePayloadV1 } from "@aion/career-evidence";
import { validateJobPostingPayloadV1 } from "@aion/job-posting";
import { evaluateJobMatchV1 } from "../src/index.js";
import { configuration, matchRequest, matchingPorts, setupMatchInputs } from "./helpers.js";

async function evaluation(definitions?: Parameters<typeof setupMatchInputs>[1], config = configuration()) {
  const ports = matchingPorts();
  await setupMatchInputs(ports, definitions);
  const profileObject = await ports.repository.loadCurrent(matchRequest().careerProfileObjectId);
  const jobObject = await ports.repository.loadCurrent(matchRequest().jobPostingObjectId);
  const profile = validateCareerProfilePayloadV1(profileObject!.data);
  const facts = [];
  for (const state of profile.factStates) facts.push({ revision: state.factRevision, payload: validateCareerFactPayloadV1((await ports.repository.loadRevision(state.factId, state.factRevision))!.data) });
  return evaluateJobMatchV1({ request: matchRequest(config), careerProfile: profile, jobPosting: validateJobPostingPayloadV1(jobObject!.data), facts });
}

test("positive deterministic match exposes components, evidence, versions, weights, and limitations", async () => {
  const report = await evaluation();
  assert.equal(report.overallScoreBps > 0, true);
  assert.equal(report.componentScores.length, 10);
  assert.equal(report.matchedRequirements.some((item) => item.requirement === "TypeScript" && item.evidence.length === 1), true);
  assert.equal(report.careerProfile.revision, 1);
  assert.equal(report.jobPosting.revision, 1);
  assert.equal(report.matchingConfiguration.contractVersion, "aion.career-match-configuration.v1");
  assert.match(report.limitations.join(" "), /does not predict hiring probability/);
  assert.equal(Object.hasOwn(report, "relationships"), false);
});

test("missing evidence stays unknown, nonmatching evidence is unmatched, and conflict remains visible", async () => {
  const report = await evaluation([
    { type: "role-title", value: "Different Synthetic Role" },
    { type: "skill", value: "Different Skill" },
    { type: "skill", value: "TypeScript", conflict: true },
  ]);
  assert.equal(report.unmatchedRequirements.some((item) => item.requirement === "Deterministic Testing"), true);
  assert.equal(report.unknownRequirements.some((item) => item.requirement === "TypeScript" && item.outcome === "conflict"), true);
  assert.equal(report.unknownRequirements.some((item) => item.category === "education"), true);
  assert.equal(report.conflicts.some((item) => item.startsWith("Unresolved CareerFact conflict:")), true);
});

test("explicit exclusion and location conflict are disqualifying while compensation is scored only with both evidence sides", async () => {
  const report = await evaluation(undefined, configuration({ excludedRoleTitles: ["Synthetic Platform Steward"], acceptedLocations: ["Different Example City"], minimumCompensation: null }));
  assert.equal(report.overallScoreBps, 0);
  assert.equal(report.componentScores.find((item) => item.component === "role-title-alignment")?.status, "conflict");
  assert.equal(report.componentScores.find((item) => item.component === "location-compatibility")?.status, "conflict");
  assert.equal(report.componentScores.find((item) => item.component === "compensation-compatibility")?.applied, false);
});

test("work arrangement, employment type, compensation, experience, and industry boundaries stay explicit", async () => {
  const report = await evaluation(undefined, configuration({
    acceptedWorkArrangements: ["hybrid"],
    acceptedEmploymentTypes: ["contract"],
    minimumCompensation: { currency: "USD", minimumMinorUnits: 11000000 },
  }));
  assert.equal(report.componentScores.find((item) => item.component === "work-arrangement")?.status, "conflict");
  assert.equal(report.componentScores.find((item) => item.component === "employment-type")?.status, "conflict");
  assert.equal(report.componentScores.find((item) => item.component === "compensation-compatibility")?.status, "conflict");
  assert.equal(report.componentScores.find((item) => item.component === "relevant-experience")?.scoreBps, 10000);
  assert.equal(report.componentScores.find((item) => item.component === "industry-alignment")?.status, "unknown");
  assert.equal(report.unsupportedRequirements.includes("industry-job-evidence-unavailable"), true);
});

test("same evidence and configuration produce byte-identical report data", async () => {
  const first = await evaluation();
  const second = await evaluation();
  assert.deepEqual(second, first);
});
