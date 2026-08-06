import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, parse, resolve } from "node:path";
import { after, before, test } from "node:test";

import {
  authorizeLocalPath,
  authorizeLocalTextInput,
  recheckAuthorizedPath,
  type PathAuthorizationRequestV1,
} from "../src/index.js";

let fixture = "";
let approvedRoot = "";
let outsideRoot = "";

before(() => {
  fixture = mkdtempSync(join(tmpdir(), "aion-privacy-boundary-"));
  approvedRoot = join(fixture, "approved");
  outsideRoot = join(fixture, "outside");
  mkdirSync(join(approvedRoot, "nested"), { recursive: true });
  mkdirSync(outsideRoot);
  for (const name of ["input.json", "notes.md", "plain.txt", "UPPER.TXT", "resume.txt.exe"]) {
    writeFileSync(join(approvedRoot, "nested", name), "synthetic fixture", "utf8");
  }
  writeFileSync(join(outsideRoot, "outside.txt"), "synthetic fixture", "utf8");
});

after(() => rmSync(fixture, { recursive: true, force: true }));

function request(path: string, root = approvedRoot): PathAuthorizationRequestV1 {
  return {
    version: "1",
    operation: "read-file",
    approvedRoot: { version: "1", reference: "private-career-input", absolutePath: root },
    requestedPath: { version: "1", absolutePath: path },
  };
}

function reason(path: string, root = approvedRoot): string {
  const result = authorizeLocalPath(request(path, root));
  assert.equal(result.authorized, false);
  return result.error.reason;
}

test("direct and nested children are accepted", () => {
  assert.equal(authorizeLocalPath(request(join(approvedRoot, "direct.txt"))).authorized, true);
  assert.equal(authorizeLocalPath(request(join(approvedRoot, "nested", "plain.txt"))).authorized, true);
});

test("the approved root itself is rejected unless explicitly permitted", () => {
  assert.equal(reason(approvedRoot), "approved-root-target-rejected");
  assert.equal(authorizeLocalPath({ ...request(approvedRoot), allowApprovedRoot: true }).authorized, true);
});

test("sibling-prefix and parent-traversal escapes are rejected", () => {
  assert.equal(reason(`${approvedRoot}-sibling${join("", "file.txt")}`), "path-outside-approved-root");
  assert.equal(reason(resolve(approvedRoot, "..", "outside", "outside.txt")), "path-outside-approved-root");
});

test("relative, empty, padded, and malformed inputs are rejected", () => {
  assert.equal(reason(join("nested", "plain.txt")), "relative-path-rejected");
  assert.equal(reason(""), "requested-path-invalid");
  assert.equal(reason(" padded "), "requested-path-invalid");
  assert.equal(reason("bad\0path"), "requested-path-invalid");
});

test("cross-volume paths are rejected", { skip: process.platform !== "win32" }, () => {
  const currentDrive = parse(approvedRoot).root.slice(0, 1).toUpperCase();
  const otherDrive = currentDrive === "Z" ? "Y" : "Z";
  assert.equal(reason(`${otherDrive}:\\synthetic\\input.txt`), "cross-volume-rejected");
});

test("Windows path comparison is case-insensitive", { skip: process.platform !== "win32" }, () => {
  const alteredCase = approvedRoot.toUpperCase();
  assert.equal(authorizeLocalPath(request(join(alteredCase, "nested", "plain.txt"), alteredCase)).authorized, true);
});

test("UNC and Windows device namespaces are rejected", () => {
  assert.equal(reason("\\\\server\\share\\input.txt"), "unc-path-rejected");
  assert.equal(reason("\\\\?\\C:\\private\\input.txt"), "device-path-rejected");
  assert.equal(reason("\\\\.\\C:\\private\\input.txt"), "device-path-rejected");
});

test("nearest existing parent protects a new nested destination", () => {
  const target = join(approvedRoot, "nested", "new", "deeper", "output.txt");
  const result = authorizeLocalPath(request(target));
  assert.equal(result.authorized, true);
  if (result.authorized) assert.equal(result.resolvedPath, resolve(target));
  assert.equal(recheckAuthorizedPath(request(target)).authorized, true);
});

test("an internal directory link remains contained", (t) => {
  const link = join(approvedRoot, "internal-link");
  try {
    symlinkSync(join(approvedRoot, "nested"), link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`local link capability unavailable: ${(error as NodeJS.ErrnoException).code ?? "unknown"}`);
    return;
  }
  assert.equal(authorizeLocalPath(request(join(link, "plain.txt"))).authorized, true);
});

test("an external directory link or junction is rejected", (t) => {
  const link = join(approvedRoot, "external-link");
  try {
    symlinkSync(outsideRoot, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`local link capability unavailable: ${(error as NodeJS.ErrnoException).code ?? "unknown"}`);
    return;
  }
  assert.equal(reason(join(link, "outside.txt")), "link-or-reparse-escape");
});

test("an external file symlink is rejected", (t) => {
  const link = join(approvedRoot, "external-file.txt");
  try {
    symlinkSync(join(outsideRoot, "outside.txt"), link, "file");
  } catch (error) {
    t.skip(`file symlink capability unavailable: ${(error as NodeJS.ErrnoException).code ?? "unknown"}`);
    return;
  }
  assert.equal(reason(link), "link-or-reparse-escape");
});

test("initial text input policy accepts only JSON, Markdown, and text", () => {
  for (const name of ["input.json", "notes.md", "plain.txt", "UPPER.TXT"]) {
    assert.equal(authorizeLocalTextInput(request(join(approvedRoot, "nested", name))).authorized, true);
  }
  const doubleExtension = authorizeLocalTextInput(request(join(approvedRoot, "nested", "resume.txt.exe")));
  assert.equal(doubleExtension.authorized, false);
  if (!doubleExtension.authorized) assert.equal(doubleExtension.error.reason, "unsupported-extension");
});

test("input policy rejects directories and missing files", () => {
  for (const path of [join(approvedRoot, "nested"), join(approvedRoot, "nested", "missing.txt")]) {
    const result = authorizeLocalTextInput(request(path));
    assert.equal(result.authorized, false);
    if (!result.authorized) assert.equal(result.error.reason, "target-not-file");
  }
});

test("rejections contain stable privacy-safe data only", () => {
  const secret = process.env.AION_PRIVACY_TEST_SECRET ?? "synthetic-secret-value";
  const outside = join(outsideRoot, `${secret}.txt`);
  const result = authorizeLocalPath(request(outside));
  assert.equal(result.authorized, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(fixture), false);
  assert.equal(serialized.includes(basename(outside)), false);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("synthetic fixture"), false);
});
