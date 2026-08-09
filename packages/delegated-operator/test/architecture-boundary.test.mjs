import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("delegated-operator does not import local-assistant service/chat runtime", () => {
  const files = walk(srcDir);
  const banned = /@aion\/local-assistant|from ["'].*\/service\.js["']|openai|anthropic|model-provider/i;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.equal(banned.test(text), false, `banned import pattern in ${file}`);
  }
});

test("no public wildcard listen API in owner-ui source", () => {
  const text = readFileSync(join(srcDir, "owner-ui.ts"), "utf8");
  assert.match(text, /127\.0\.0\.1/);
  assert.doesNotMatch(text, /listen\([^)]*0\.0\.0\.0/);
  assert.doesNotMatch(text, /listen\([^)]*::[^1]/);
});

test("package documents inactive activation", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /Founder remains authoritative/i);
  assert.match(readme, /NO|not activated|INACTIVE/i);
});
