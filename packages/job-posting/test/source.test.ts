import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { prepareJobPostingSourceV1 } from "../src/source.js";
import { inputRoot, structuredFixture, syntheticPostingInput } from "./helpers.js";

test("structured source preserves exact fields, digest, parser, filename, and relative path", async (t) => {
  const fixture = await structuredFixture(t);
  const prepared = await prepareJobPostingSourceV1(fixture.request);
  const bytes = await readFile(fixture.sourcePath);
  assert.deepEqual(prepared.fields.title, syntheticPostingInput().title);
  assert.deepEqual(prepared.fields.location, { state: "unknown" });
  assert.deepEqual(prepared.fields.compensation, syntheticPostingInput().compensation);
  assert.equal(prepared.contentDigest.digest, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(prepared.parser.parserName, "aion.job-posting.structured-json");
  assert.equal(prepared.originalFilename, "synthetic-posting.json");
  assert.equal(prepared.approvedRelativePath, "synthetic-posting.json");
});

test("Markdown maps exact text only to description and performs no heading or semantic inference", async (t) => {
  const { approved } = await inputRoot(t);
  const sourcePath = join(approved, "posting.md");
  const text = "# Synthetic Architect\n\nCompany: Example Alpha\n\nRequired: Imaginary Skill\n";
  await writeFile(sourcePath, text, "utf8");
  const prepared = await prepareJobPostingSourceV1({
    version: "1", importOperationId: "phase8.synthetic.markdown", ownerId: (await import("./helpers.js")).OWNER_ID,
    actorId: (await import("./helpers.js")).ACTOR_ID,
    approvedInputRoot: { version: "1", reference: "synthetic", absolutePath: approved },
    sourcePath: { version: "1", absolutePath: sourcePath }, sourceType: "markdown",
    target: { mode: "create" }, listingCurrentness: { version: "1", state: "unknown" },
  });
  assert.deepEqual(prepared.fields.description, { state: "supplied", value: text });
  for (const [key, value] of Object.entries(prepared.fields)) {
    if (key !== "description") assert.equal(value.state, "not-supplied", `${key} must not be inferred`);
  }
});

test("plain text maps exact text only to description and preserves trailing bytes", async (t) => {
  const { approved } = await inputRoot(t);
  const sourcePath = join(approved, "posting.txt");
  const text = "Synthetic text line one\r\nSynthetic text line two\r\n";
  await writeFile(sourcePath, text, "utf8");
  const { OWNER_ID, ACTOR_ID } = await import("./helpers.js");
  const prepared = await prepareJobPostingSourceV1({
    version: "1", importOperationId: "phase8.synthetic.text", ownerId: OWNER_ID, actorId: ACTOR_ID,
    approvedInputRoot: { version: "1", reference: "synthetic", absolutePath: approved },
    sourcePath: { version: "1", absolutePath: sourcePath }, sourceType: "text",
    target: { mode: "create" }, listingCurrentness: { version: "1", state: "unknown" },
  });
  assert.deepEqual(prepared.fields.description, { state: "supplied", value: text });
});

test("structured source rejects unknown fields, unsupported numeric values, BOM, NUL, and mismatched extension", async (t) => {
  const { approved } = await inputRoot(t);
  const { OWNER_ID, ACTOR_ID } = await import("./helpers.js");
  const base = (sourcePath: string, sourceType: "structured-json" | "markdown") => ({
    version: "1" as const, importOperationId: "phase8.synthetic.reject", ownerId: OWNER_ID, actorId: ACTOR_ID,
    approvedInputRoot: { version: "1" as const, reference: "synthetic", absolutePath: approved },
    sourcePath: { version: "1" as const, absolutePath: sourcePath }, sourceType,
    target: { mode: "create" as const }, listingCurrentness: { version: "1" as const, state: "unknown" as const },
  });
  const cases: [string, Uint8Array | string, "structured-json" | "markdown"][] = [
    ["unknown.json", JSON.stringify({ ...syntheticPostingInput(), extra: "no" }), "structured-json"],
    ["version.json", JSON.stringify({ ...syntheticPostingInput(), contractVersion: "aion.job-posting-input.v2" }), "structured-json"],
    ["float.json", JSON.stringify({ ...syntheticPostingInput(), compensation: { state: "supplied", currency: "USD", minimumMinorUnits: 1.5, maximumMinorUnits: null } }), "structured-json"],
    ["bom.md", new Uint8Array([0xef, 0xbb, 0xbf, 0x78]), "markdown"],
    ["nul.md", new Uint8Array([0x78, 0x00]), "markdown"],
    ["wrong.txt", "text", "markdown"],
  ];
  for (const [name, content, sourceType] of cases) {
    const path = join(approved, name);
    await writeFile(path, content);
    await assert.rejects(() => prepareJobPostingSourceV1(base(path, sourceType)));
  }
});
