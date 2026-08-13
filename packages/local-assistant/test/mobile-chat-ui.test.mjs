/**
 * Mobile Chat UI contracts, checked against the shipped assets.
 *
 * These are source-level assertions rather than a browser harness, because the defects they pin are
 * source-level: the More menu was dead not through any CSS or Safari subtlety but because the click
 * delegator destructured `area` and never `areaJump`, then returned early when all its known keys
 * were absent — leaving the branch that handles those buttons unreachable. A test that reads the
 * guard catches that class of bug on every commit; a screenshot test would not.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "apps", "aion", "public");
const appJs = readFileSync(join(PUBLIC, "app.js"), "utf8");
const indexHtml = readFileSync(join(PUBLIC, "index.html"), "utf8");

test("every data-area-jump button can reach its handler", () => {
  const guard = appJs.match(/if \(!target && ([^)]*)\) return;/);
  assert.ok(guard, "the early-return guard in the click delegator must still exist to be checked");
  assert.match(
    guard[0],
    /!areaJump/,
    "the guard must account for areaJump, or every More-sheet button silently does nothing",
  );
  assert.match(appJs, /const \{ area: target, areaJump,/, "areaJump must be destructured from the dataset");
});

test("the More sheet's buttons are all reachable control types", () => {
  // Delegation matches closest("button"); a div with data-do never fires.
  const sheet = indexHtml.slice(indexHtml.indexOf('id="aionMoreSheet"'));
  const panel = sheet.slice(0, sheet.indexOf("</div>\n  </div>") + 1);
  const actionable = [...panel.matchAll(/<(\w+)[^>]*data-(?:do|area-jump)=/g)].map((m) => m[1]);
  assert.ok(actionable.length >= 6, `expected the full More sheet, saw ${actionable.length} controls`);
  for (const tag of actionable) {
    assert.equal(tag, "button", `data-do/data-area-jump must sit on a <button>, found <${tag}>`);
  }
});

test("the chat composer offers camera and file attachment without leaving Chat", () => {
  assert.match(appJs, /data-do="attach-camera"/, "a camera control must exist in the composer");
  assert.match(appJs, /data-do="attach-file"/, "a file/photo control must exist in the composer");
  assert.match(appJs, /id="aionCaptureInput"[^>]*capture="environment"/, "iOS needs capture=environment to open the camera");
  assert.match(appJs, /id="aionPickInput"/, "a library/file picker input must exist");
  // The picker must open as a direct result of the tap; iOS Safari ignores a deferred click().
  assert.match(appJs, /verb === "attach-camera" \|\| verb === "attach-file"/);
});

test("an attachment can be previewed and removed before sending", () => {
  assert.match(appJs, /function renderPendingAttachment/);
  assert.match(appJs, /data-do="attach-remove"/);
  assert.match(appJs, /if \(verb === "attach-remove"\)/);
});

test("internal intent labels never render in Owner chat", () => {
  // GENERAL_ASSISTANT_QUERY reached the Owner's phone because the reply card printed reply.intent.
  const chatPanel = appJs.slice(appJs.indexOf('id="aionChatPanel"'), appJs.indexOf('id="aionChatPanel"') + 2000);
  assert.ok(
    !/esc\(reply\.intent/.test(chatPanel),
    "the phone chat reply must not print the routed intent name",
  );
  assert.ok(
    !/Intent: \$\{result\.intent\}/.test(appJs),
    "the toast must not announce an internal intent name either",
  );
  // No screen may print the routed intent — the Owner saw GENERAL_ASSISTANT_QUERY on a reply card.
  assert.ok(
    !/esc\(\s*(?:window\.__aionLastAssistant|reply|result)\.intent/.test(appJs),
    "no reply card anywhere may render the intent name",
  );
});

test("voice input feeds the same Chat composer rather than a separate assistant mode", () => {
  const handler = appJs.slice(appJs.indexOf('verb === "voice-prompt"'));
  const body = handler.slice(0, handler.indexOf("rec.start()"));
  // Prefer MediaRecorder staging; browser speech still appends into the Chat composer.
  assert.match(body, /MediaRecorder/, "laptop mic uses explicit MediaRecorder (not ambient surveillance)");
  assert.match(body, /getUserMedia/, "microphone requires explicit user permission");
  assert.match(body, /getElementById\("aionChatInput"\)/, "browser speech fallback targets Chat composer");
  assert.ok(
    !/ta\.value\s*=\s*text\s*;/.test(body),
    "Chat voice must not overwrite text the Owner already typed",
  );
  assert.match(body, /ta\.value\.trim\(\) \?/, "browser speech transcript should append to existing text");
  // Submission is Chat-owned: recording stages attachment; Send uses audio.voice_to_chat / assistant.prompt
  assert.match(appJs, /audio\.voice_to_chat/, "audio recordings submit through the voice-to-chat foundation");
  assert.match(appJs, /isAudio/, "audio attachments are first-class in the composer");
});

test("the More sheet holds secondary functions, not the core chat intake", () => {
  const sheet = indexHtml.slice(indexHtml.indexOf('id="aionMoreSheet"'));
  const panel = sheet.slice(0, sheet.indexOf("</div>", sheet.indexOf("aion-more-panel")) + 6);
  // Attachment must be reachable without opening More at all; the composer carries it.
  assert.match(appJs, /aion-compose-actions/, "the composer must own the attachment controls");
  assert.ok(panel.includes("Close"), "More must still offer an explicit Close");
});

test("attachments are sent to the assistant with the question, not as a separate errand", () => {
  // Matched on the field rather than the variable holding it: the composer now stages several
  // photos and sends the primary image alongside the prompt, so the local name changed while the
  // behaviour this guards did not.
  assert.match(appJs, /imageBase64: \w+\.base64/, "the image must accompany the prompt");
  assert.match(appJs, /crm\.document\.upload/, "the original must still be preserved");
});

test("the composer stages several photos and sends them as one question", () => {
  // The Owner's actual failure: a second photo silently replaced the first, so three pictures of
  // one car arrived as three unrelated questions.
  assert.match(appJs, /let pendingAttachments = \[\]/, "attachments must be a queue, not one slot");
  assert.match(appJs, /pendingAttachments\.push\(/, "a new photo appends rather than replaces");
  assert.match(appJs, /Array\.from\(input\.files \|\| \[\]\)/, "every picked file is read, not just the first");
  assert.match(appJs, /multiple hidden/, "the picker must allow multi-select");
  assert.match(appJs, /data-do="attach-remove" data-index=/, "each attachment is individually removable");
  assert.match(appJs, /Uploading \$\{i \+ 1\} of \$\{pendingAttachments\.length\}/, "upload progress is per file");
});

test("the microphone reports why it cannot record instead of doing nothing", () => {
  // Over plain http Safari does not expose navigator.mediaDevices at all, and the old handler
  // tested for it and returned in silence — indistinguishable from a dead button.
  assert.match(appJs, /function microphoneDiagnostic\(/, "the mic must be able to explain itself");
  assert.match(appJs, /isSecureContext/, "secure context is the first thing to check");
  assert.match(appJs, /audio\/mp4/, "Safari records mp4, not webm");
  assert.match(appJs, /function preferredRecordingMime\(/, "format is negotiated at runtime");
});
