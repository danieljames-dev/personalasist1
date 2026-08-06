import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { test, type TestContext } from "node:test";

import {
  CAREER_FACTS_INPUT_VERSION_V1,
  CAREER_INPUT_MAX_RAW_BYTES_V1,
  preflightCareerInputV1,
  type CareerInputFileKindV1,
} from "../src/index.js";

async function roots(t: TestContext) {
  const fixture = await mkdtemp(join(tmpdir(), "aion-career-input-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const approved = join(fixture, "approved");
  const outside = join(fixture, "outside");
  await mkdir(approved);
  await mkdir(outside);
  return { fixture, approved, outside };
}

function request(approved: string, input: string, expectedKind?: CareerInputFileKindV1) {
  return {
    version: "1" as const,
    approvedRoot: { version: "1" as const, reference: "synthetic-career-input", absolutePath: approved },
    inputPath: { version: "1" as const, absolutePath: input },
    ...(expectedKind === undefined ? {} : { expectedKind }),
  };
}

test("accepted file extensions are case-insensitive and final-extension only", async (t) => {
  const { approved } = await roots(t);
  for (const name of ["notes.md", "plain.txt", "UPPER.JSON"]) {
    const path = join(approved, name);
    const body = name.toLocaleLowerCase("en-US").endsWith(".json")
      ? JSON.stringify({ contractVersion: CAREER_FACTS_INPUT_VERSION_V1, entries: [] })
      : "synthetic evidence";
    await writeFile(path, body, "utf8");
    assert.equal((await preflightCareerInputV1(request(approved, path))).accepted, true);
  }
  const misleading = join(approved, "resume.txt.exe");
  await writeFile(misleading, "synthetic", "utf8");
  const result = await preflightCareerInputV1(request(approved, misleading));
  assert.equal(result.accepted, false);
  if (!result.accepted) assert.equal(result.error.code, "unsupported-extension");
});

test("unsupported extension, no extension, directory, and missing file reject safely", async (t) => {
  const { approved } = await roots(t);
  for (const path of [join(approved, "input.pdf"), join(approved, "input")]) {
    await writeFile(path, "synthetic", "utf8");
    const result = await preflightCareerInputV1(request(approved, path));
    assert.equal(result.accepted, false);
    if (!result.accepted) assert.equal(result.error.code, "unsupported-extension");
  }
  const directory = join(approved, "directory.txt");
  await mkdir(directory);
  for (const path of [directory, join(approved, "missing.txt")]) {
    const result = await preflightCareerInputV1(request(approved, path));
    assert.equal(result.accepted, false);
    if (!result.accepted) assert.equal(result.error.code, "input-not-file");
  }
});

test("explicit approved root contains valid children and rejects traversal and sibling prefix", async (t) => {
  const { approved, fixture, outside } = await roots(t);
  const inside = join(approved, "inside.txt");
  const escaped = join(outside, "outside.txt");
  await writeFile(inside, "synthetic inside", "utf8");
  await writeFile(escaped, "synthetic outside", "utf8");
  assert.equal((await preflightCareerInputV1(request(approved, inside))).accepted, true);
  for (const path of [resolve(approved, "..", "outside", "outside.txt"), `${approved}-sibling${join("", "outside.txt")}`]) {
    const result = await preflightCareerInputV1(request(approved, path));
    assert.equal(result.accepted, false);
    if (!result.accepted) {
      assert.equal(result.error.code, "path-rejected");
      assert.equal(JSON.stringify(result).includes(fixture), false);
    }
  }
});

test("cross-drive and device paths fail closed", { skip: process.platform !== "win32" }, async (t) => {
  const { approved } = await roots(t);
  const currentDrive = parse(approved).root.slice(0, 1).toUpperCase();
  const otherDrive = currentDrive === "Z" ? "Y" : "Z";
  for (const path of [`${otherDrive}:\\synthetic\\input.txt`, "\\\\?\\C:\\synthetic\\input.txt"]) {
    const result = await preflightCareerInputV1(request(approved, path));
    assert.equal(result.accepted, false);
    if (!result.accepted) assert.equal(result.error.code, "path-rejected");
  }
});

test("external file link escape rejects with truthful capability skip", async (t) => {
  const { approved, outside } = await roots(t);
  const external = join(outside, "outside.txt");
  const link = join(approved, "linked.txt");
  await writeFile(external, "synthetic outside", "utf8");
  try {
    await symlink(external, link, "file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      t.skip("OS denied synthetic file-symlink creation with EPERM.");
      return;
    }
    throw error;
  }
  const result = await preflightCareerInputV1(request(approved, link));
  assert.equal(result.accepted, false);
  if (!result.accepted) assert.equal(result.error.code, "path-rejected");
});

test("strict UTF-8 accepts valid input and rejects invalid bytes, BOM, UTF-16, and NUL", async (t) => {
  const { approved } = await roots(t);
  const cases: Array<{ name: string; bytes: Uint8Array; code?: string }> = [
    { name: "valid.txt", bytes: new TextEncoder().encode("Synthetic UTF-8 text") },
    { name: "invalid.txt", bytes: Uint8Array.from([0xc3, 0x28]), code: "invalid-utf8" },
    { name: "bom.txt", bytes: Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]), code: "bom-rejected" },
    { name: "utf16.txt", bytes: Uint8Array.from([0xff, 0xfe, 0x61, 0x00]), code: "unsupported-encoding" },
    { name: "nul.txt", bytes: Uint8Array.from([0x61, 0x00, 0x62]), code: "nul-byte-rejected" },
  ];
  for (const item of cases) {
    const path = join(approved, item.name);
    await writeFile(path, item.bytes);
    const result = await preflightCareerInputV1(request(approved, path));
    assert.equal(result.accepted, item.code === undefined);
    if (!result.accepted) assert.equal(result.error.code, item.code);
  }
});

test("raw byte limit is inclusive and one byte beyond rejects before parsing", async (t) => {
  const { approved } = await roots(t);
  const exact = join(approved, "exact.txt");
  const over = join(approved, "over.txt");
  await writeFile(exact, Buffer.alloc(CAREER_INPUT_MAX_RAW_BYTES_V1, 0x61));
  await writeFile(over, Buffer.alloc(CAREER_INPUT_MAX_RAW_BYTES_V1 + 1, 0x61));
  const exactResult = await preflightCareerInputV1(request(approved, exact));
  assert.equal(exactResult.accepted, true);
  if (exactResult.accepted) assert.equal(exactResult.byteLength, CAREER_INPUT_MAX_RAW_BYTES_V1);
  const overResult = await preflightCareerInputV1(request(approved, over));
  assert.equal(overResult.accepted, false);
  if (!overResult.accepted) assert.equal(overResult.error.code, "input-too-large");
});

test("JSON preflight identifies contracts, rejects malformed and mismatched kinds, and returns no body or path", async (t) => {
  const { approved, fixture } = await roots(t);
  const path = join(approved, "facts.json");
  await writeFile(path, JSON.stringify({ contractVersion: CAREER_FACTS_INPUT_VERSION_V1, entries: [] }), "utf8");
  const accepted = await preflightCareerInputV1(request(approved, path, "career-facts"));
  assert.equal(accepted.accepted, true);
  if (accepted.accepted) {
    assert.equal(accepted.kind, "career-facts");
    assert.equal(accepted.contractVersion, CAREER_FACTS_INPUT_VERSION_V1);
    assert.deepEqual(accepted.summary, {
      contentReturned: false, pathReturned: false, ingestionPerformed: false,
      persistencePerformed: false, networkPerformed: false,
    });
  }
  const serialized = JSON.stringify(accepted);
  assert.equal(serialized.includes(fixture), false);
  assert.equal(serialized.includes("entries"), false);

  const mismatch = await preflightCareerInputV1(request(approved, path, "job-posting"));
  assert.equal(mismatch.accepted, false);
  if (!mismatch.accepted) assert.equal(mismatch.error.code, "kind-mismatch");

  await writeFile(path, "{malformed", "utf8");
  const malformed = await preflightCareerInputV1(request(approved, path));
  assert.equal(malformed.accepted, false);
  if (!malformed.accepted) assert.equal(malformed.error.code, "malformed-json");

  await writeFile(path, '{"contractVersion":"aion.career-facts-input.v1","entries":[],"entries":[]}', "utf8");
  const duplicate = await preflightCareerInputV1(request(approved, path));
  assert.equal(duplicate.accepted, false);
  if (!duplicate.accepted) assert.equal(duplicate.error.code, "malformed-json");
});

test("evidence preflight is read-only and preserves source bytes", async (t) => {
  const { approved } = await roots(t);
  const path = join(approved, "evidence.md");
  const source = Buffer.from("Synthetic evidence\r\nPreserved exactly\n", "utf8");
  await writeFile(path, source);
  const before = await readFile(path);
  const result = await preflightCareerInputV1(request(approved, path, "resume-evidence"));
  assert.equal(result.accepted, true);
  if (result.accepted) assert.equal(result.kind, "resume-evidence");
  assert.deepEqual(await readFile(path), before);
});
