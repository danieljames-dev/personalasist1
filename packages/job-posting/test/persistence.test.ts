import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { FileObjectRepositoryV1 } from "@aion/object";
import { importJobPostingV1, validateJobPostingPayloadV1 } from "../src/index.js";
import { jobPorts, structuredFixture, validationPorts } from "./helpers.js";

test("bounded filesystem repository persists and reloads exact immutable Job Posting revisions", async (t) => {
  const fixture = await structuredFixture(t);
  const objectRoot = join(fixture.root, "private", "object-store");
  await mkdir(objectRoot, { recursive: true });
  const validation = validationPorts();
  const repository = new FileObjectRepositoryV1({ approvedRootAbsolutePath: objectRoot, validationPorts: validation });
  const ports = jobPorts(repository);
  const result = await importJobPostingV1(fixture.request, ports);
  assert.equal(result.outcome, "success");
  const id = ports.idDeriver.derive(fixture.request.importOperationId, "job-posting", fixture.request.ownerId);
  const reloadedRepository = new FileObjectRepositoryV1({ approvedRootAbsolutePath: objectRoot, validationPorts: validation });
  const reloaded = await reloadedRepository.loadCurrent(id);
  assert.equal(reloaded?.revision, 1);
  assert.equal(validateJobPostingPayloadV1(reloaded?.data).sourceProvenance.contentDigest.algorithm, "sha-256");
});

test("injected persistence failure creates no partial valid-looking Object and permits deterministic retry", async (t) => {
  const fixture = await structuredFixture(t);
  const objectRoot = join(fixture.root, "private", "object-store");
  await mkdir(objectRoot, { recursive: true });
  const validation = validationPorts();
  let fail = true;
  const repository = new FileObjectRepositoryV1({
    approvedRootAbsolutePath: objectRoot,
    validationPorts: validation,
    hooks: { beforeInstall: () => { if (fail) throw new Error("synthetic install failure"); } },
  });
  const ports = jobPorts(repository);
  const rejected = await importJobPostingV1(fixture.request, ports);
  assert.equal(rejected.outcome, "rejected");
  assert.equal(rejected.error?.code, "persistence-failed");
  const id = ports.idDeriver.derive(fixture.request.importOperationId, "job-posting", fixture.request.ownerId);
  assert.equal(await repository.loadCurrent(id), null);
  fail = false;
  const retry = await importJobPostingV1(fixture.request, ports);
  assert.equal(retry.outcome, "success");
  assert.equal((await repository.loadCurrent(id))?.revision, 1);
});

test("path traversal and outside-root selection fail closed without any Object write", async (t) => {
  const fixture = await structuredFixture(t);
  const ports = jobPorts();
  const outside = { ...fixture.request, sourcePath: { version: "1" as const, absolutePath: join(fixture.root, "outside.json") } };
  const result = await importJobPostingV1(outside, ports);
  assert.equal(result.outcome, "rejected");
  assert.equal(result.error?.code, "preflight-rejected");
  const id = ports.idDeriver.derive(fixture.request.importOperationId, "job-posting", fixture.request.ownerId);
  assert.equal(await ports.repository.loadCurrent(id), null);
});

test("external source link escape rejects with truthful Windows EPERM skip", async (t) => {
  const fixture = await structuredFixture(t);
  const { symlink, writeFile } = await import("node:fs/promises");
  const outside = join(fixture.root, "outside.json");
  await writeFile(outside, "{}", "utf8");
  const link = join(fixture.approved, "linked.json");
  try {
    await symlink(outside, link, "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("OS denied synthetic file-symlink creation with EPERM.");
      return;
    }
    throw error;
  }
  const result = await importJobPostingV1({ ...fixture.request, sourcePath: { version: "1", absolutePath: link } }, jobPorts());
  assert.equal(result.outcome, "rejected");
  assert.equal(result.error?.code, "preflight-rejected");
});
