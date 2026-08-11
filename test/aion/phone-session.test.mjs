/**
 * Phone pairing / upload session durability regressions (static + HTTP).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = "C:\\AION-HQ";

test("app.js does not wipe session token on every 403 (origin glitches)", async () => {
  const js = await readFile(join(root, "apps/aion/public/app.js"), "utf8");
  assert.match(js, /isUnpairedAuthError/);
  assert.match(js, /SESSION_KEY_LEGACY|aion\.sessionToken/);
  // Must not unconditionally clear on 401||403 alone without message check
  assert.doesNotMatch(
    js,
    /if \(response\.status === 401 \|\| response\.status === 403\) \{ setSessionToken\(""\); renderPairing/,
  );
});

test("phone.html shares session key with full app and only unpairs on true auth failure", async () => {
  const html = await readFile(join(root, "apps/aion/public/phone.html"), "utf8");
  assert.match(html, /aion\.session/);
  assert.match(html, /isUnpairedError/);
  assert.doesNotMatch(html, /if \(\/not paired\|401\|403\/i\.test/);
});

test("upload body ceiling allows base64 photo envelope", async () => {
  const server = await readFile(join(root, "apps/aion/server.mjs"), "utf8");
  assert.match(server, /MAX_BODY = 12 \* 1024 \* 1024/);
});
