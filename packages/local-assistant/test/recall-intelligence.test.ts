/**
 * Recall wording regressions.
 *
 * The reachable source answers "which campaigns exist for this year/make/model?", not "is this VIN
 * clear?". These tests exist so no future change lets AION tell a customer a car has no recalls on
 * evidence that cannot support it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecallAssessment,
  describeRecallStatus,
  notCheckedRecallAssessment,
  recallComboKey,
  RECALL_SOURCE_LIMITATION,
} from "../src/recall-intelligence.js";

const NOW = "2026-08-12T04:00:00.000Z";
const SOURCE = "https://api.nhtsa.gov/recalls/recallsByVehicle";
const QUERY = { year: "2023", make: "TOYOTA", model: "Camry" };

test("an empty result never becomes a clean bill of health", () => {
  const a = buildRecallAssessment({ ok: true, campaigns: [], query: QUERY, now: NOW, source: SOURCE });
  assert.equal(a.status, "NO_MATCHING_RECORDS_RETURNED");
  assert.equal(a.scope, "YEAR_MAKE_MODEL_CAMPAIGN");
  assert.match(a.statement, /No matching recall records were returned/i);
  assert.match(a.statement, /does not confirm the specific VIN/i);
  // The forbidden claim must not appear anywhere in the rendered answer.
  const rendered = describeRecallStatus(a).toLowerCase();
  assert.ok(!/\bhas no recalls\b/.test(rendered));
  assert.ok(!/\bno open recalls\b/.test(rendered));
  assert.ok(rendered.includes("year_make_model_campaign"));
});

test("a failed lookup is never reassurance", () => {
  const a = buildRecallAssessment({ ok: false, campaigns: [], query: QUERY, now: NOW, source: SOURCE });
  assert.equal(a.status, "LOOKUP_FAILED");
  assert.match(a.statement, /lookup failed/i);
  assert.match(a.statement, /not evidence that the vehicle is clear/i);
});

test("found campaigns are reported with the VIN caveat intact", () => {
  const a = buildRecallAssessment({
    ok: true,
    campaigns: [
      { campaignNumber: "23V123", component: "FUEL PUMP", summary: "s", consequence: "c", remedy: "r", reportReceivedDate: "d" },
      { campaignNumber: "24V456", component: "AIR BAGS", summary: "s", consequence: "c", remedy: "r", reportReceivedDate: "d" },
    ],
    query: QUERY, now: NOW, source: SOURCE,
  });
  assert.equal(a.status, "RECALLS_FOUND");
  assert.equal(a.campaignCount, 2);
  assert.match(a.statement, /must be confirmed by VIN/i);
  const rendered = describeRecallStatus(a);
  assert.ok(rendered.includes("23V123"));
  assert.ok(rendered.includes("FUEL PUMP"));
  assert.ok(rendered.includes(RECALL_SOURCE_LIMITATION));
});

test("unchecked vehicles say so plainly", () => {
  const a = notCheckedRecallAssessment();
  assert.equal(a.status, "NOT_CHECKED");
  assert.match(describeRecallStatus(a), /have not been checked/i);
  assert.match(describeRecallStatus(null), /have not been checked/i);
});

test("combo key collapses identical year/make/model and rejects incomplete input", () => {
  assert.equal(recallComboKey("2023", "toyota", "camry"), "2023|TOYOTA|CAMRY");
  assert.equal(recallComboKey("2023", "TOYOTA", "Camry"), "2023|TOYOTA|CAMRY", "case-insensitive");
  assert.equal(recallComboKey(null, "TOYOTA", "Camry"), null);
  assert.equal(recallComboKey("2023", "", "Camry"), null);
});

test("every assessment carries the source limitation", () => {
  for (const a of [
    buildRecallAssessment({ ok: true, campaigns: [], query: QUERY, now: NOW, source: SOURCE }),
    buildRecallAssessment({ ok: false, campaigns: [], query: QUERY, now: NOW, source: SOURCE }),
    notCheckedRecallAssessment(),
  ]) {
    assert.equal(a.sourceLimitation, RECALL_SOURCE_LIMITATION);
  }
});
