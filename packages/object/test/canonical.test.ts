import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAionFrameV1,
  canonicalizeValueV1,
  equalDigestV1,
  MAX_SAFE_CANONICAL_INTEGER,
  ObjectErrorV1,
  parseCanonicalJsonV1,
  Sha256ObjectDigestV1,
} from "../src/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function code(operation: () => unknown): string | undefined {
  try {
    operation();
    return undefined;
  } catch (error) {
    return error instanceof ObjectErrorV1 ? error.code : "unexpected";
  }
}

test("ACJ-1 canonical bytes are insertion-independent UTF-8 with UTF-16 key ordering", () => {
  const first = { z: 1, a: "caf\u00e9", "\ue000": 3, "\ud800\udc00": 2 };
  const second = { "\ud800\udc00": 2, "\ue000": 3, a: "caf\u00e9", z: 1 };
  const firstBytes = canonicalizeValueV1(first);
  const secondBytes = canonicalizeValueV1(second);
  assert.deepEqual(firstBytes, secondBytes);
  assert.equal(decoder.decode(firstBytes), "{\"a\":\"caf\u00e9\",\"z\":1,\"\ud800\udc00\":2,\"\ue000\":3}");
  assert.equal(firstBytes.at(-1), "}".charCodeAt(0));
});

test("ACJ-1 rejects normalization defects and unsupported value kinds without output", () => {
  assert.equal(code(() => canonicalizeValueV1("e\u0301")), "invalid-string");
  assert.equal(code(() => canonicalizeValueV1("\ud800")), "invalid-string");
  for (const value of [1.5, -0, Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n, new Date()]) {
    assert.equal(code(() => canonicalizeValueV1(value)), "unsupported-value-kind");
  }
  const arrayWithSideProperty = [1] as number[] & { extra?: number };
  arrayWithSideProperty.extra = 2;
  assert.equal(code(() => canonicalizeValueV1(arrayWithSideProperty)), "unsupported-value-kind");
});

test("NF-1 boundaries are exact for structured and raw values", () => {
  assert.equal(decoder.decode(canonicalizeValueV1(MAX_SAFE_CANONICAL_INTEGER)), String(MAX_SAFE_CANONICAL_INTEGER));
  assert.equal(decoder.decode(canonicalizeValueV1(-MAX_SAFE_CANONICAL_INTEGER)), String(-MAX_SAFE_CANONICAL_INTEGER));
  assert.equal(code(() => canonicalizeValueV1(MAX_SAFE_CANONICAL_INTEGER + 1)), "integer-out-of-range");
  assert.equal(code(() => canonicalizeValueV1(-MAX_SAFE_CANONICAL_INTEGER - 1)), "integer-out-of-range");
  assert.equal(code(() => parseCanonicalJsonV1(encoder.encode("9007199254740992"))), "integer-out-of-range");
  assert.equal(code(() => parseCanonicalJsonV1(encoder.encode("-9007199254740992"))), "integer-out-of-range");
});

test("raw parser rejects duplicate members, BOM, invalid UTF-8, float syntax, and trailing input", () => {
  assert.equal(code(() => parseCanonicalJsonV1(encoder.encode('{"a":1,"a":2}'))), "duplicate-member");
  try {
    parseCanonicalJsonV1(encoder.encode('{"sensitive-key":1,"sensitive-key":2}'));
    assert.fail("duplicate member should reject");
  } catch (error) {
    assert.equal(error instanceof ObjectErrorV1, true);
    assert.equal(`${(error as ObjectErrorV1).location} ${(error as Error).message}`.includes("sensitive-key"), false);
  }
  assert.equal(code(() => parseCanonicalJsonV1(Uint8Array.from([0xef, 0xbb, 0xbf, 0x6e, 0x75, 0x6c, 0x6c]))), "invalid-string");
  assert.equal(code(() => parseCanonicalJsonV1(Uint8Array.from([0xed, 0xa0, 0x80]))), "invalid-string");
  assert.equal(code(() => parseCanonicalJsonV1(encoder.encode("1.0"))), "unsupported-value-kind");
  assert.equal(code(() => parseCanonicalJsonV1(encoder.encode("1 null"))), "unsupported-value-kind");
  assert.equal(code(() => parseCanonicalJsonV1(encoder.encode('{"a":1,}'))), "unsupported-value-kind");
  assert.equal(code(() => parseCanonicalJsonV1(encoder.encode('[1,]'))), "unsupported-value-kind");
});

test("AION Frame v1 is deterministic, length-prefixed, and domain-separated", () => {
  const payload = canonicalizeValueV1({ value: 1 });
  const base = {
    frameVersion: "1" as const,
    purpose: "aion.object.integrity" as const,
    profileId: "acj-1",
    contractFamily: "aion.object",
    contractVersion: "1",
    context: "aion.schema.synthetic:1",
  };
  const frame = buildAionFrameV1(base, payload);
  const repeat = buildAionFrameV1(base, payload);
  const other = buildAionFrameV1({ ...base, purpose: "aion.event.integrity" }, payload);
  assert.deepEqual(frame, repeat);
  assert.notDeepEqual(frame, other);
  assert.deepEqual([...frame.slice(0, 4)], [0, 0, 0, 1]);
  const digest = new Sha256ObjectDigestV1();
  const first = digest.digest("sha-256", frame);
  assert.equal(equalDigestV1(first, digest.digest("sha-256", repeat)), true);
  assert.equal(equalDigestV1(first, digest.digest("sha-256", other)), false);
});

test("frame validation rejects invalid text and oversized fields", () => {
  const payload = encoder.encode("null");
  const fields = {
    frameVersion: "1" as const,
    purpose: "aion.object.integrity" as const,
    profileId: "acj-1",
    contractFamily: "aion.object",
    contractVersion: "1",
    context: "",
  };
  assert.equal(code(() => buildAionFrameV1({ ...fields, profileId: "" }, payload)), "frame-length-overflow");
  assert.equal(code(() => buildAionFrameV1({ ...fields, context: "x".repeat(1025) }, payload)), "frame-length-overflow");
});
