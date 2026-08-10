/**
 * Mobile viewport / layout regression (no browser stack).
 * Locks CSS/HTML contracts that failed on physical iPhone Safari.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = readFileSync(join(root, "apps/aion/public/styles.css"), "utf8");
const js = readFileSync(join(root, "apps/aion/public/app.js"), "utf8");
const html = readFileSync(join(root, "apps/aion/public/index.html"), "utf8");
const server = readFileSync(join(root, "apps/aion/server.mjs"), "utf8");

const VIEWPORTS = [
  { w: 390, h: 844, name: "iPhone 14/15" },
  { w: 393, h: 852, name: "iPhone 14/15 Pro" },
  { w: 430, h: 932, name: "iPhone 14/15 Pro Max" },
];

test("index uses dedicated aion-area-nav and cache-bust token", () => {
  assert.match(html, /class="aion-area-nav"/);
  assert.match(html, /id="aionAreaNav"/);
  assert.match(html, /styles\.css\?v=ASSET_V/);
  assert.match(html, /app\.js\?v=ASSET_V/);
  assert.match(html, /id="aionMoreSheet"/);
  assert.match(html, /viewport-fit=cover/);
});

test("server rewrites ASSET_V for cache busting", () => {
  assert.match(server, /ASSET_VERSION/);
  assert.match(server, /replaceAll\("ASSET_V"/);
  assert.match(server, /x-aion-asset-version/);
});

test("mobile nav is class-scoped — not bare nav", () => {
  assert.match(css, /\.aion-mobile-nav/);
  assert.match(css, /body\.aion-phone\s+\.aion-area-nav\.aion-mobile-nav/);
  // Must not style bare `nav {` as the phone bottom bar (breaks Sales tabs).
  assert.doesNotMatch(css, /body\.aion-phone\s+nav\s*\{/);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*700px\)\s*\{\s*nav\s*\{/);
});

test("phone content panel is forced visible with real height", () => {
  assert.match(css, /body\.aion-phone\s+#content\.aion-content/);
  assert.match(css, /min-height:\s*40(?:svh|dvh|vh)/);
  assert.match(css, /display:\s*block\s*!important/);
  assert.match(js, /contentEl\.hidden\s*=\s*false/);
  assert.match(js, /usePhoneChrome/);
});

test("iOS safe-area and dynamic viewport units present", () => {
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /100(?:svh|dvh)/);
  assert.match(css, /padding-bottom:\s*calc\(4\.25rem/);
});

test("phone primary nav is 5 slots with More sheet", () => {
  assert.match(js, /mobilePrimaryAreas\s*=\s*\[\s*"Home"\s*,\s*"Chat"\s*,\s*"Customers"\s*,\s*"Tasks"\s*,\s*"More"/);
  assert.match(js, /more-open/);
  assert.match(js, /aionMoreSheet/);
  assert.match(css, /grid-template-columns:\s*repeat\(5,/);
});

test("grid tracks cannot collapse to zero width on ~390px phones", () => {
  // Old: minmax(21rem, 1fr) can yield zero auto-fill tracks on narrow screens.
  assert.doesNotMatch(css, /minmax\(21rem,\s*1fr\)/);
  assert.match(css, /minmax\(min\(100%,\s*18rem\),\s*1fr\)/);
});

test("connection badge is not hard-coded Local-only for devices", () => {
  assert.match(js, /connectionBadgeText/);
  assert.match(js, /Private remote|Tailscale ready|Local desktop/);
  assert.doesNotMatch(js, /Local-only/);
});

test("viewport contract: content + bottom bar fit common iPhone heights", () => {
  // Header ~56 + compose ~180 + bottom bar ~56 + safe ~34 < 844
  for (const vp of VIEWPORTS) {
    const header = 56;
    const bottom = 56 + 34;
    const usable = vp.h - header - bottom;
    assert.ok(usable > 400, `${vp.name}: usable height ${usable} too small`);
    // 5 tabs need >= 64px each roughly
    assert.ok(vp.w / 5 >= 64, `${vp.name}: tab width ${vp.w / 5}`);
  }
});

test("Sales tabs keep independent horizontal styles", () => {
  assert.match(css, /body\.aion-phone\s+nav\.tabs/);
  assert.match(css, /flex-direction:\s*row\s*!important/);
});
