import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeValueV1,
  buildAionFrameV1,
  MAX_ARRAY_ELEMENTS,
  MAX_CANONICAL_OUTPUT_BYTES,
  MAX_IDENTIFIER_BYTES,
  MAX_MEMBER_NAME_BYTES,
  MAX_NESTING_DEPTH,
  MAX_OBJECT_MEMBERS,
  MAX_RAW_INPUT_BYTES,
  MAX_STRING_BYTES,
  MAX_TOTAL_VALUE_NODES,
  ObjectErrorV1,
  parseCanonicalJsonV1,
  validateCanonicalIdentifierV1,
  validateCanonicalValueV1,
} from "../src/index.js";

const encoder = new TextEncoder();

function error(operation: () => unknown): ObjectErrorV1 | undefined {
  try {
    operation();
    return undefined;
  } catch (caught) {
    return caught instanceof ObjectErrorV1 ? caught : undefined;
  }
}

function nestedArrays(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

test("L-01 raw-byte maximum accepts exact and rejects one beyond", () => {
  const exact = encoder.encode(`${" ".repeat(MAX_RAW_INPUT_BYTES - 4)}null`);
  assert.equal(exact.byteLength, MAX_RAW_INPUT_BYTES);
  assert.equal(parseCanonicalJsonV1(exact), null);
  const failure = error(() => parseCanonicalJsonV1(new Uint8Array(MAX_RAW_INPUT_BYTES + 1)));
  assert.equal(failure?.code, "limit-exceeded");
  assert.equal(failure?.limitId, "L-01");
});

test("L-04 nesting maximum accepts exact and rejects one beyond on both entry paths", () => {
  validateCanonicalValueV1(nestedArrays(MAX_NESTING_DEPTH));
  assert.equal(error(() => validateCanonicalValueV1(nestedArrays(MAX_NESTING_DEPTH + 1)))?.limitId, "L-04");
  parseCanonicalJsonV1(encoder.encode(`${"[".repeat(MAX_NESTING_DEPTH)}null${"]".repeat(MAX_NESTING_DEPTH)}`));
  assert.equal(error(() => parseCanonicalJsonV1(encoder.encode(`${"[".repeat(MAX_NESTING_DEPTH + 1)}null${"]".repeat(MAX_NESTING_DEPTH + 1)}`)))?.limitId, "L-04");
});

test("L-05 member maximum accepts exact and rejects one beyond on both entry paths", () => {
  const exact = Object.fromEntries(Array.from({ length: MAX_OBJECT_MEMBERS }, (_, index) => [`k${index}`, null]));
  const over = { ...exact, overflow: null };
  validateCanonicalValueV1(exact);
  assert.equal(error(() => validateCanonicalValueV1(over))?.limitId, "L-05");
  const rawExact = encoder.encode(JSON.stringify(exact));
  parseCanonicalJsonV1(rawExact);
  assert.equal(error(() => parseCanonicalJsonV1(encoder.encode(JSON.stringify(over))))?.limitId, "L-05");
});

test("L-06 array maximum accepts exact and rejects one beyond on both entry paths", () => {
  const exact = Array.from({ length: MAX_ARRAY_ELEMENTS }, () => null);
  const over = [...exact, null];
  validateCanonicalValueV1(exact);
  assert.equal(error(() => validateCanonicalValueV1(over))?.limitId, "L-06");
  parseCanonicalJsonV1(encoder.encode(JSON.stringify(exact)));
  assert.equal(error(() => parseCanonicalJsonV1(encoder.encode(JSON.stringify(over))))?.limitId, "L-06");
});

function nodeBoundary(extra: number): null[][] {
  const lengths = [65_535, 65_535, 65_535, 65_534 + extra];
  return lengths.map((length) => Array.from({ length }, () => null));
}

test("L-07 total-node maximum accepts exact and rejects the crossing node", () => {
  const exact = nodeBoundary(0);
  assert.equal(1 + exact.length + exact.reduce((sum, part) => sum + part.length, 0), MAX_TOTAL_VALUE_NODES);
  validateCanonicalValueV1(exact);
  assert.equal(error(() => validateCanonicalValueV1(nodeBoundary(1)))?.limitId, "L-07");
  parseCanonicalJsonV1(encoder.encode(JSON.stringify(exact)));
  assert.equal(error(() => parseCanonicalJsonV1(encoder.encode(JSON.stringify(nodeBoundary(1)))))?.limitId, "L-07");
});

test("L-08 string and L-10 member-name maxima are inclusive", () => {
  validateCanonicalValueV1("x".repeat(MAX_STRING_BYTES));
  assert.equal(error(() => validateCanonicalValueV1("x".repeat(MAX_STRING_BYTES + 1)))?.limitId, "L-08");
  parseCanonicalJsonV1(encoder.encode(JSON.stringify("x".repeat(MAX_STRING_BYTES))));
  assert.equal(error(() => parseCanonicalJsonV1(encoder.encode(JSON.stringify("x".repeat(MAX_STRING_BYTES + 1)))))?.limitId, "L-08");
  validateCanonicalValueV1({ ["k".repeat(MAX_MEMBER_NAME_BYTES)]: null });
  assert.equal(error(() => validateCanonicalValueV1({ ["k".repeat(MAX_MEMBER_NAME_BYTES + 1)]: null }))?.limitId, "L-10");
  parseCanonicalJsonV1(encoder.encode(JSON.stringify({ ["k".repeat(MAX_MEMBER_NAME_BYTES)]: null })));
  assert.equal(error(() => parseCanonicalJsonV1(encoder.encode(JSON.stringify({ ["k".repeat(MAX_MEMBER_NAME_BYTES + 1)]: null }))))?.limitId, "L-10");
});

test("L-12 and L-13 frame text maxima accept exact and reject one beyond", () => {
  const fields = {
    frameVersion: "1" as const,
    purpose: "aion.object.integrity" as const,
    profileId: "acj-1",
    contractFamily: "aion.object",
    contractVersion: "1",
    context: "x".repeat(1024),
  };
  buildAionFrameV1(fields, encoder.encode("null"));
  const failure = error(() => buildAionFrameV1({ ...fields, context: "x".repeat(1025) }, encoder.encode("null")));
  assert.equal(failure?.code, "frame-length-overflow");
  assert.equal(failure?.limitId, "L-13");
});

test("L-11 identifier maximum is inclusive and returns invalid-identifier above", () => {
  validateCanonicalIdentifierV1("i".repeat(MAX_IDENTIFIER_BYTES), "$.identifier");
  const failure = error(() => validateCanonicalIdentifierV1("i".repeat(MAX_IDENTIFIER_BYTES + 1), "$.identifier"));
  assert.equal(failure?.code, "invalid-identifier");
  assert.equal(failure?.limitId, "L-11");
});

test("L-02 canonical-output maximum accepts exact and emits no oversized output", () => {
  const overhead = 13;
  const finalLength = MAX_CANONICAL_OUTPUT_BYTES - (3 * MAX_STRING_BYTES) - overhead;
  const exact = ["a".repeat(MAX_STRING_BYTES), "b".repeat(MAX_STRING_BYTES), "c".repeat(MAX_STRING_BYTES), "d".repeat(finalLength)];
  assert.equal(canonicalizeValueV1(exact).byteLength, MAX_CANONICAL_OUTPUT_BYTES);
  const failure = error(() => canonicalizeValueV1([...exact.slice(0, 3), "d".repeat(finalLength + 1)]));
  assert.equal(failure?.code, "limit-exceeded");
  assert.equal(failure?.limitId, "L-02");
});
