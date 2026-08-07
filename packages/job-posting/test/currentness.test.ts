import assert from "node:assert/strict";
import test from "node:test";
import { dryRunJobPostingImportV1 } from "../src/index.js";
import { jobPorts, structuredFixture } from "./helpers.js";

test("URL, source reference, import time, and future deadline do not prove listing currentness", async (t) => {
  const fixture = await structuredFixture(t);
  const result = await dryRunJobPostingImportV1(fixture.request, jobPorts());
  assert.equal(result.accepted, true);
  assert.equal(result.currentnessState, "unknown");
  assert.ok(result.warningCodes.includes("listing-currentness-unknown"));
  assert.ok(result.warningCodes.includes("source-reference-inert-not-fetched"));
});

test("explicit owner observation is the only accepted current representation", async (t) => {
  const fixture = await structuredFixture(t);
  const result = await dryRunJobPostingImportV1({
    ...fixture.request,
    listingCurrentness: {
      version: "1", state: "owner-observed-current", basis: "explicit-owner-observation",
      observedAt: "2026-08-06T23:59:00.000Z", ownerConfirmed: true,
    },
  }, jobPorts());
  assert.equal(result.accepted, true);
  assert.equal(result.currentnessState, "owner-observed-current");
  assert.ok(!result.warningCodes.includes("listing-currentness-unknown"));
});

test("future or malformed observation evidence fails closed", async (t) => {
  const fixture = await structuredFixture(t);
  const future = await dryRunJobPostingImportV1({
    ...fixture.request,
    listingCurrentness: {
      version: "1", state: "owner-observed-current", basis: "explicit-owner-observation",
      observedAt: "2099-01-01T00:00:00.000Z", ownerConfirmed: true,
    },
  }, jobPorts());
  assert.equal(future.accepted, false);
  assert.equal(future.error?.code, "currentness-invalid");
  const missingConfirmation = await dryRunJobPostingImportV1({
    ...fixture.request,
    listingCurrentness: {
      version: "1", state: "owner-observed-current", basis: "explicit-owner-observation",
      observedAt: "2026-08-06T23:59:00.000Z",
    },
  }, jobPorts());
  assert.equal(missingConfirmation.accepted, false);
});
