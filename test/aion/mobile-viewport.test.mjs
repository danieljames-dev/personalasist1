/**
 * Mobile viewport / layout regression (no browser stack).
 * Locks phone-shell contracts that failed on physical iPhone Safari.
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

test("index has dedicated phone shell and desktop shell", () => {
  assert.match(html, /id="aionPhoneShell"/);
  assert.match(html, /id="aionPhoneContent"/);
  assert.match(html, /id="aionPhoneNav"/);
  assert.match(html, /id="aionDesktopShell"/);
  assert.match(html, /class="aion-mobile-nav"/);
  assert.match(html, /styles\.css\?v=ASSET_V/);
  assert.match(html, /app\.js\?v=ASSET_V/);
});

test("server rewrites ASSET_V for cache busting", () => {
  assert.match(server, /ASSET_VERSION/);
  assert.match(server, /replaceAll\("ASSET_V"/);
});

test("phone shell is flex column with bottom nav as last child", () => {
  assert.match(css, /\.aion-phone-shell\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(css, /body\.aion-phone-mode\s+\.aion-phone-shell/);
  assert.match(css, /\.aion-mobile-nav\s*\{[^}]*flex:\s*0\s+0\s+auto/s);
  assert.match(css, /\.aion-phone-content\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /min-height:\s*0/); // flex scroll fix
});

test("mobiledebug instrumentation exists", () => {
  assert.match(js, /mobiledebug/);
  assert.match(js, /MOBILE CONTENT ROOT ALIVE/);
  assert.match(js, /CHAT PANEL RENDER TEST/);
  assert.match(js, /getBoundingClientRect/);
  assert.match(js, /describeEl/);
  assert.match(css, /aion-mobile-debug-banner/);
  assert.match(css, /aion-dbg-content/);
});

test("chat phone panel has stable ids", () => {
  assert.match(js, /id="aionChatPanel"/);
  assert.match(js, /id="aionChatForm"/);
  assert.match(js, /id="aionChatInput"/);
});

test("phone primary nav is 5 slots with More", () => {
  assert.match(js, /mobilePrimaryAreas\s*=\s*\[\s*"Home"\s*,\s*"Chat"\s*,\s*"Customers"\s*,\s*"Tasks"\s*,\s*"More"/);
  assert.match(css, /grid-template-columns:\s*repeat\(5,/);
});

test("safe-area and dynamic viewport units", () => {
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /100(?:svh|dvh)/);
});

test("grid tracks cannot collapse on ~390px", () => {
  assert.doesNotMatch(css, /minmax\(21rem,\s*1fr\)/);
});

test("connection badge not hard-coded Local-only", () => {
  assert.match(js, /connectionBadgeText/);
  assert.doesNotMatch(js, /Local-only/);
});

test("Knowledge Add Source includes import-root-add and rejects whole drives", () => {
  assert.match(js, /data-form="import-root-add"/);
  assert.match(js, /kind === "import-root-add"/);
  assert.match(js, /Whole drives are not allowed/);
  assert.match(js, /pick-import-folder\.ps1/);
  assert.match(js, /REAL_OWNER_IMPORT_READY/);
});

test("Inventory Walk phone workflow is present", () => {
  assert.match(js, /Inventory Walk/);
  assert.match(js, /inventoryWalkArea/);
  assert.match(js, /data-form="walk-observe"/);
  assert.match(js, /START WALK/);
  assert.match(js, /SAVE · NEXT VEHICLE|NEXT VEHICLE/);
  assert.match(js, /inventory\.walk\.observe/);
  assert.match(js, /dealership-lakeland/);
});

test("viewport contract for common iPhone sizes", () => {
  for (const vp of VIEWPORTS) {
    const usable = vp.h - 56 - 56 - 34;
    assert.ok(usable > 400, `${vp.name}: usable ${usable}`);
    assert.ok(vp.w / 5 >= 64, `${vp.name}: tab width`);
  }
});
