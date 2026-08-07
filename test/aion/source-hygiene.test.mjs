import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const TEXT = /\.(ts|mjs|cjs|js|json|md|css|html|ps1|yml|yaml|webmanifest|svg)$/u;

async function trackedTextFiles() {
  const { stdout } = await run("git", ["ls-files"], { cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024 });
  return stdout.split(/\r?\n/u).filter((file) => file && TEXT.test(file));
}

/*
 * Source hygiene the repository enforces rather than remembers.
 *
 * Every failure below is silent: a byte-order mark, a double-encoded character, and a raw control
 * byte all look fine in most editors and break nothing at runtime, so they survive review and
 * accumulate. Two of the three arrived here through a Windows PowerShell round-trip that read
 * UTF-8 as Windows-1252 and wrote it back, which is an easy mistake to repeat.
 *
 * This file is written entirely in escape sequences. Spelling the patterns literally would make
 * the file its own counter-example and fail its own rule.
 */

/** Windows-1252 characters that a UTF-8 continuation byte (0x80-0xBF) is displayed as. */
const CONTINUATION = "[\\u00a0-\\u00bf\\u0152\\u0153\\u0160\\u0161\\u0178\\u017d\\u017e\\u0192"
  + "\\u02c6\\u02dc\\u2013\\u2014\\u2018-\\u201e\\u2020-\\u2022\\u2026\\u2030\\u2039\\u203a\\u20ac\\u2122]";
/*
 * Deliberately narrow. The obvious rule -- any UTF-8 lead byte followed by any continuation byte,
 * seen through Windows-1252 -- looks right and is wrong: legitimate text such as a multiplication
 * sign followed by an en dash matches it, because those are 0xD7 (a Hebrew lead byte) and 0x96 (a
 * continuation byte). Acting on that false positive corrupted five correct documents once already.
 *
 * Only three signatures are used, each effectively impossible in real English prose:
 *   U+00C3 + continuation   accented letters misread (e-acute, a-acute, u-umlaut)
 *   U+00E2 U+20AC           the punctuation block (em dash, curly quotes, ellipsis)
 *   U+00C2 + punctuation    non-breaking space, middot, degree sign, guillemets
 */
const MOJIBAKE = new RegExp(`\\u00c3${CONTINUATION}|\\u00e2\\u20ac|\\u00c2[\\u00a0-\\u00bf]`, "u");

test("no tracked text file carries a byte-order mark", async () => {
  const offenders = [];
  for (const file of await trackedTextFiles()) {
    const bytes = await readFile(join(repositoryRoot, file));
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "a BOM breaks shebangs and JSON parsers and is never intended here");
});

test("no tracked text file contains double-encoded (mojibake) characters", async () => {
  const offenders = [];
  for (const file of await trackedTextFiles()) {
    const text = await readFile(join(repositoryRoot, file), "utf8");
    const line = text.split(/\r?\n/u).findIndex((entry) => MOJIBAKE.test(entry));
    if (line >= 0) offenders.push(`${file}:${line + 1}`);
  }
  assert.deepEqual(offenders, [], "re-encode the file as UTF-8; do not round-trip source through Windows PowerShell");
});

test("the mojibake rule catches real damage without flagging legitimate text", () => {
  const damaged = [
    "ranged \u00e2\u20ac\u201d wide",   // em dash
    "caf\u00c3\u00a9",                   // e-acute
    "1\u00c2\u00b7 5",                   // middot
    "a \u00e2\u20ac\u0153quote\u00e2\u20ac\u009d", // curly quotes
  ];
  for (const sample of damaged) assert.equal(MOJIBAKE.test(sample), true, `should flag: ${JSON.stringify(sample)}`);

  const fine = [
    "1.16\u00d7\u201314.6\u00d7",  // multiplication sign then en dash: the false positive to avoid
    "caf\u00e9 au lait",
    "a \u2014 dash",
    "\u2264 and \u2265",
    "5\u00b0 \u00b1 1",
    "\u4e2d\u6587",
    "\u00f0\u0178 is not a pair we flag",
  ];
  for (const sample of fine) assert.equal(MOJIBAKE.test(sample), false, `should not flag: ${JSON.stringify(sample)}`);
});

test("no tracked text file contains a raw control byte outside tab, newline, and carriage return", async () => {
  const offenders = [];
  for (const file of await trackedTextFiles()) {
    const bytes = await readFile(join(repositoryRoot, file));
    const index = bytes.findIndex((byte) => (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) || byte === 0x7f);
    if (index >= 0) offenders.push(`${file}@${index}`);
  }
  assert.deepEqual(offenders, [], "write control characters as escape sequences so Git can still diff the file as text");
});

test("this suite is itself pure ASCII, so it cannot become its own counter-example", async () => {
  const source = await readFile(join(repositoryRoot, "test/aion/source-hygiene.test.mjs"), "utf8");
  const offending = [...source].find((character) => character.codePointAt(0) > 126);
  assert.equal(offending, undefined, `write it as an escape sequence instead: ${JSON.stringify(offending)}`);
});
