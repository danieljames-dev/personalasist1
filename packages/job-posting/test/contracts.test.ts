import assert from "node:assert/strict";
import test from "node:test";
import {
  JOB_POSTING_PAYLOAD_VERSION_V1,
  descriptionOnlyFieldsV1,
  fieldsFromStructuredInputV1,
  validateJobPostingFieldsV1,
  validateJobPostingImportRequestV1,
} from "../src/index.js";
import { ACTOR_ID, OWNER_ID, syntheticPostingInput } from "./helpers.js";

test("structured mapping preserves every explicit field and unknown state exactly", () => {
  const input = syntheticPostingInput();
  const fields = fieldsFromStructuredInputV1(input);
  const { contractVersion: _contractVersion, ...expected } = input;
  assert.deepEqual(fields, expected);
});

test("closed Job Posting fields reject unknown members and unsupported enumerations", () => {
  const fields = fieldsFromStructuredInputV1(syntheticPostingInput());
  assert.doesNotThrow(() => validateJobPostingFieldsV1(fields));
  assert.throws(() => validateJobPostingFieldsV1({ ...fields, inferredTitle: "forbidden" }));
  assert.throws(() => validateJobPostingFieldsV1({ ...fields, workArrangement: { state: "supplied", value: "flexible" } }));
});

test("compensation accepts exact safe minor units and rejects floats, negatives, empty ranges, and inversion", () => {
  const fields = fieldsFromStructuredInputV1(syntheticPostingInput());
  for (const compensation of [
    { state: "supplied", currency: "USD", minimumMinorUnits: 1.25, maximumMinorUnits: 2 },
    { state: "supplied", currency: "USD", minimumMinorUnits: -1, maximumMinorUnits: 2 },
    { state: "supplied", currency: "USD", minimumMinorUnits: null, maximumMinorUnits: null },
    { state: "supplied", currency: "USD", minimumMinorUnits: 3, maximumMinorUnits: 2 },
  ]) assert.throws(() => validateJobPostingFieldsV1({ ...fields, compensation }));
  assert.doesNotThrow(() => validateJobPostingFieldsV1({
    ...fields,
    compensation: { state: "supplied", currency: "USD", minimumMinorUnits: 0, maximumMinorUnits: Number.MAX_SAFE_INTEGER },
  }));
});

test("description-only fields distinguish not supplied from explicit empty", () => {
  const empty = descriptionOnlyFieldsV1("");
  assert.equal(empty.description.state, "explicit-empty");
  assert.equal(empty.title.state, "not-supplied");
  assert.equal(empty.requiredSkills.state, "not-supplied");
  const supplied = descriptionOnlyFieldsV1("# Exact heading\nExact body\n");
  assert.deepEqual(supplied.description, { state: "supplied", value: "# Exact heading\nExact body\n" });
});

test("import request is closed and requires typed identity, explicit paths, target, and currentness", () => {
  const request = {
    version: "1", importOperationId: "phase8.synthetic.request", ownerId: OWNER_ID, actorId: ACTOR_ID,
    approvedInputRoot: { version: "1", reference: "synthetic", absolutePath: "C:\\synthetic" },
    sourcePath: { version: "1", absolutePath: "C:\\synthetic\\posting.json" },
    sourceType: "structured-json", target: { mode: "create" }, listingCurrentness: { version: "1", state: "unknown" },
  };
  assert.doesNotThrow(() => validateJobPostingImportRequestV1(request));
  assert.throws(() => validateJobPostingImportRequestV1({ ...request, score: 100 }));
  assert.throws(() => validateJobPostingImportRequestV1({ ...request, target: { mode: "revision", expectedRevision: 0, jobPostingObjectId: "bad" } }));
  assert.equal(JOB_POSTING_PAYLOAD_VERSION_V1, "aion.job-posting-payload.v1");
});
