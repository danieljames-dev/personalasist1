import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { importCareerEvidenceV1 } from "../src/index.js";
import { ACTOR_ID, evidencePorts, factsRequest, inputFixture, OWNER_ID } from "./helpers.js";

test("closed requests reject missing fields, extra fields, and unsupported source types without writes", async (t) => {
  const fixture = await factsRequest(t);
  for (const request of [
    { ...fixture.request, sourceType: "job-posting-json" },
    { ...fixture.request, unexpected: true },
    { ...fixture.request, importOperationId: "" },
  ]) {
    const ports = evidencePorts();
    const result = await importCareerEvidenceV1(request, ports);
    assert.equal(result.outcome, "rejected");
    assert.equal(result.sourceReference, null);
  }
});

test("traversal and outside-root source selection fail closed without exposing complete paths", async (t) => {
  const fixture = await inputFixture(t);
  const outside = join(fixture.root, "outside");
  await mkdir(outside);
  const sourcePath = join(outside, "facts.json");
  await writeFile(sourcePath, JSON.stringify({ contractVersion: "aion.career-facts-input.v1", entries: [] }), "utf8");
  const ports = evidencePorts();
  const result = await importCareerEvidenceV1({
    version: "1", importOperationId: "phase7.synthetic.escape", ownerId: OWNER_ID, actorId: ACTOR_ID,
    approvedInputRoot: { version: "1", reference: "synthetic-career-input", absolutePath: fixture.approved },
    sourcePath: { version: "1", absolutePath: sourcePath }, sourceType: "career-facts-json",
  }, ports);
  assert.equal(result.outcome, "rejected");
  assert.equal(JSON.stringify(result).includes(fixture.root), false);
});

test("external source link escape rejects with truthful Windows privilege skip", async (t) => {
  const fixture = await inputFixture(t);
  const outside = join(fixture.root, "outside.json");
  const link = join(fixture.approved, "linked.json");
  await writeFile(outside, JSON.stringify({ contractVersion: "aion.career-facts-input.v1", entries: [] }), "utf8");
  try { await symlink(outside, link, "file"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("OS denied synthetic file-symlink creation with EPERM.");
      return;
    }
    throw error;
  }
  const result = await importCareerEvidenceV1({
    version: "1", importOperationId: "phase7.synthetic.link", ownerId: OWNER_ID, actorId: ACTOR_ID,
    approvedInputRoot: { version: "1", reference: "synthetic-career-input", absolutePath: fixture.approved },
    sourcePath: { version: "1", absolutePath: link }, sourceType: "career-facts-json",
  }, evidencePorts());
  assert.equal(result.outcome, "rejected");
});

test("invalid structured content leaves no source or fact persistence", async (t) => {
  const fixture = await inputFixture(t);
  const sourcePath = join(fixture.approved, "invalid.json");
  await writeFile(sourcePath, "{ invalid", "utf8");
  const ports = evidencePorts();
  const operationId = "phase7.synthetic.invalid";
  const result = await importCareerEvidenceV1({
    version: "1", importOperationId: operationId, ownerId: OWNER_ID, actorId: ACTOR_ID,
    approvedInputRoot: { version: "1", reference: "synthetic-career-input", absolutePath: fixture.approved },
    sourcePath: { version: "1", absolutePath: sourcePath }, sourceType: "career-facts-json",
  }, ports);
  assert.equal(result.outcome, "rejected");
  assert.equal(await ports.repository.loadCurrent(ports.idDeriver.derive(operationId, "career-source", "source")), null);
});
