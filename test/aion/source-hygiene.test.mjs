import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..", "..");
const TEXT = /\.(ts|mjs|cjs|js|json|md|css|html|ps1|yml|yaml)$/u;

async function trackedTextFiles() {
  const { stdout } = await run("git", ["ls-files"], { cwd: repositoryRoot, maxBuffer: 8 * 1024 * 1024 });
  return stdout.split(/\r?\n/u).filter((file) => file && TEXT.test(file));
}

/**
 * Source hygiene the repository can enforce rather than remember.
 *
 * Every failure below is silent: a byte-order mark, a double-encoded character, and a raw control
 * byte all look fine in most editors and break nothing at runtime, so they survive review and
 * accumulate. Two of the three arrived here through a Windows PowerShell round-trip that read
 * UTF-8 as Windows-1252 and wrote it back, which is an easy mistake to repeat.
 */
test("no tracked text file carries a byte-order mark", async () => {
  const offenders = [];
  for (const file of await trackedTextFiles()) {
    const bytes = await readFile(join(repositoryRoot, file));
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "a BOM breaks shebangs and JSON parsers and is never intended here");
});

test("no tracked text file contains double-encoded (mojibake) characters", async () => {
  /*
   * Deliberately narrow. The obvious rule -- any UTF-8 lead byte followed by any continuation byte,
   * seen through Windows-1252 -- looks right and is wrong: legitimate text such as a
   * multiplication sign followed by an en dash matches it, because those are 0xD7 (a Hebrew lead
   * byte) and 0x96 (a continuation byte). Flagging that would corrupt correct documents.
   *
   * Only three signatures are used, each effectively impossible in real English prose:
   *   U+00C3 + continuation   accented letters misread (e-acute, a-acute, u-umlaut)
   *   U+00E2 U+20AC           the punctuation block (em dash, curly quotes, ellipsis)
   *   U+00C2 + punctuation    non-breaking space, middot, degree sign, guillemets
   */
  const mojibake = /Ã[-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]|â€|Â[ -¿]/u;
  const offenders = [];
  for (const file of await trackedTextFiles()) {
    const text = await readFile(join(repositoryRoot, file), "utf8");
    const line = text.split(/\r?\n/u).findIndex((entry) => mojibake.test(entry));
    if (line >= 0) offenders.push(`${file}:${line + 1}`);
  }
  assert.deepEqual(offenders, [], "re-encode the file as UTF-8; do not round-trip source through Windows PowerShell");
});

test("the mojibake rule catches real damage without flagging legitimate text", () => {
  const mojibake = /Ã[-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]|â€|Â[ -¿]/u;
  for (const damaged of ["ranged â€” wide", "cafÃ©", "1Â· 5", "a â€œquoteâ€"]) {
    assert.equal(mojibake.test(damaged), true, `should flag: ${JSON.stringify(damaged)}`);
  }
  for (const fine of ["1.16×–14.6×", "café au lait", "a — dash", "≤ and ≥", "5° ± 1", "中文"]) {
    assert.equal(mojibake.test(fine), false, `should not flag: ${JSON.stringify(fine)}`);
  }
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
