import assert from "node:assert/strict";
import test from "node:test";
import { classifyCaptureText } from "../src/universal-capture.js";

const now = "2030-06-01T12:00:00.000Z";

test("capture: Add Sarah as prospect — not She", () => {
  const c = classifyCaptureText(
    "Add Sarah as a prospect. She is interested in a Camry under 30000.",
    now,
  );
  assert.equal(c.personName, "Sarah");
});

test("capture: pronouns are not person names", () => {
  const c = classifyCaptureText("She is interested in a Camry.", now);
  assert.equal(c.personName, null);
});

test("capture: talked to John still works", () => {
  const c = classifyCaptureText(
    "I just talked to John. He liked the Limited but needs to talk to his wife. Call Thursday.",
    now,
  );
  assert.equal(c.personName, "John");
  assert.ok(c.followUpWhen === "thursday" || c.followUpWhen);
});
