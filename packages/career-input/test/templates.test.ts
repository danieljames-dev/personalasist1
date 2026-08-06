import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  validateCareerFactsInputV1,
  validateCareerPreferencesInputV1,
  validateJobPostingInputV1,
} from "../src/index.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const templateRoot = join(repositoryRoot, "templates", "career");

async function json(name: string): Promise<unknown> {
  const bytes = await readFile(join(templateRoot, name));
  assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

test("exactly three blank closed JSON templates parse and validate", async () => {
  const files = (await readdir(templateRoot)).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(files, ["career-facts.template.json", "career-preferences.template.json", "job-posting.template.json"]);
  const facts = validateCareerFactsInputV1(await json(files[0]!));
  const preferences = validateCareerPreferencesInputV1(await json(files[1]!));
  const posting = validateJobPostingInputV1(await json(files[2]!));
  assert.deepEqual(facts.entries, []);
  assert.equal(preferences.desiredRoles.state, "unknown");
  assert.equal("physicalOrOtherWorkConstraints" in preferences, false);
  assert.equal(posting.title.state, "unknown");
  assert.equal(posting.compensation.state, "unknown");
});

test("Markdown templates are strict UTF-8, neutral, and contain required safety guidance", async () => {
  for (const name of ["resume-evidence.template.md", "work-history-evidence.template.md"]) {
    const bytes = await readFile(join(templateRoot, name));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    assert.equal(text.charCodeAt(0) === 0xfeff, false);
    assert.match(text, /explicitly want considered/i);
    assert.match(text, /must never be committed/i);
    assert.match(text, /secrets, passwords, tokens/i);
    assert.match(text, /Social Security numbers/i);
    assert.match(text, /financial-account/i);
    assert.match(text, /medical details/i);
    assert.match(text, /does not ingest anything/i);
    assert.doesNotMatch(text, /https?:\/\//i);
    assert.doesNotMatch(text, /```|<script|BEGIN (?:RSA|OPENSSH|PRIVATE) KEY/i);
  }
});

test("opening tracked templates has no write or private-state side effect", async () => {
  const before = (await readdir(templateRoot)).sort();
  await Promise.all(before.map((name) => readFile(join(templateRoot, name))));
  assert.deepEqual((await readdir(templateRoot)).sort(), before);
});
