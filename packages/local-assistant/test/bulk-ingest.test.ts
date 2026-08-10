import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  walkAuthorizedFolder,
  hashBytes,
  isPathInsideRoot,
  isSupportedBulkExtension,
} from "../src/bulk-ingest.js";
import {
  classifyImportMaterial,
  shouldAutoAssociate,
  needsReview,
} from "../src/import-classify.js";
import {
  discoverPrivateLanAddresses,
  buildPhoneUrl,
} from "../src/lan-discovery.js";

function makeTree(): string {
  const root = join(tmpdir(), `aion-bulk-${process.pid}-${Date.now()}`);
  mkdirSync(join(root, "sales", "customer-a"), { recursive: true });
  mkdirSync(join(root, "resume"), { recursive: true });
  mkdirSync(join(root, "brands", "brand-a"), { recursive: true });
  writeFileSync(join(root, "sales", "customer-a", "note.txt"), "Customer Acme follow-up notes.\n");
  writeFileSync(join(root, "sales", "customer-a", "duplicate-copy.txt"), "Customer Acme follow-up notes.\n");
  writeFileSync(join(root, "resume", "resume.md"), "# Resume\n\nWork experience at Northline.\nSkills: negotiation.\n");
  writeFileSync(
    join(root, "brands", "brand-a", "info.json"),
    JSON.stringify({ brand: "Brand A", positioning: "local", audience: "owners" }, null, 2),
  );
  writeFileSync(join(root, "sales", "junk.bin"), Buffer.from([0, 1, 2, 3, 4]));
  writeFileSync(join(root, "sales", "bad.pdf"), "%PDF-1.4 corrupted intentionally with no text streams");
  return root;
}

test("supported extensions cover required types", () => {
  for (const n of ["a.pdf", "b.docx", "c.txt", "d.md", "e.csv", "f.json", "g.png", "h.jpg", "i.jpeg", "j.webp"]) {
    assert.equal(isSupportedBulkExtension(n), true, n);
  }
  assert.equal(isSupportedBulkExtension("x.exe"), false);
});

test("path containment rejects escapes", () => {
  assert.equal(isPathInsideRoot("C:\\Approved", "C:\\Approved\\nested"), true);
  assert.equal(isPathInsideRoot("C:\\Approved", "C:\\Other"), false);
  assert.equal(isPathInsideRoot("C:\\Approved", "C:\\Approved\\..\\Other"), false);
});

test("recursive walk discovers nested files, dedupes batch duplicates, skips junk", () => {
  const root = makeTree();
  try {
    const walk = walkAuthorizedFolder({ folder: root, approvedRoot: root });
    assert.ok(walk.files.length >= 3, `expected nested files, got ${walk.files.length}: ${walk.files.map((f) => f.relativePath).join(",")}`);
    const rels = walk.files.map((f) => f.relativePathPosix.replace(/\\/g, "/"));
    // note.txt and duplicate-copy.txt share content — one is kept (alpha order), one skipped
    assert.ok(
      rels.some((r) => r.includes("customer-a") && (r.includes("note.txt") || r.includes("duplicate-copy.txt"))),
      `expected customer-a file among ${rels.join(",")}`,
    );
    assert.ok(rels.some((r) => r.includes("resume")), `expected resume among ${rels.join(",")}`);
    assert.ok(rels.some((r) => r.includes("info.json")), `expected info.json among ${rels.join(",")}`);
    // duplicate-copy has same content as note.txt — only one content hash in files
    const hashes = walk.files.map((f) => f.contentHash);
    assert.equal(new Set(hashes).size, hashes.length, "batch should not include duplicate hashes");
    const dupSkip = walk.skipped.filter((s) => s.reason === "duplicate-in-batch");
    assert.ok(dupSkip.length >= 1, "duplicate content should be skipped");
    const unsup = walk.skipped.filter((s) => s.reason === "unsupported-type");
    assert.ok(unsup.some((s) => s.relativePath.includes("junk.bin")));
    // provenance fields present
    for (const f of walk.files) {
      assert.ok(f.contentHash.length === 64);
      assert.ok(f.byteLength > 0);
      assert.ok(f.modifiedAtMs > 0);
      assert.ok(f.relativePath);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unchanged already-ingested files are skipped (resume)", () => {
  const root = makeTree();
  try {
    const first = walkAuthorizedFolder({ folder: root, approvedRoot: root });
    const known = new Set(first.files.map((f) => f.contentHash));
    const prov = new Map(
      first.files.map((f) => [
        f.relativePathPosix,
        { contentHash: f.contentHash, byteLength: f.byteLength, modifiedAtMs: f.modifiedAtMs },
      ]),
    );
    const second = walkAuthorizedFolder({
      folder: root,
      approvedRoot: root,
      knownHashes: known,
      knownProvenance: prov,
    });
    assert.equal(second.files.length, 0, "resume should process zero new files");
    assert.ok(second.skipped.some((s) => s.detail?.includes("already-ingested") || s.reason === "duplicate-in-batch"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("symlink/junction escape is rejected when possible", () => {
  const root = makeTree();
  const outside = join(tmpdir(), `aion-outside-${process.pid}-${Date.now()}`);
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "secret.txt"), "should not import");
  const link = join(root, "escape-link");
  try {
    try {
      symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
    } catch (e) {
      // EPERM on some Windows accounts — skip construction but still assert API shape
      if ((e as NodeJS.ErrnoException).code === "EPERM") return;
      throw e;
    }
    const walk = walkAuthorizedFolder({ folder: root, approvedRoot: root });
    const escaped = walk.files.some((f) => f.absolutePath.includes("secret.txt"));
    assert.equal(escaped, false, "must not ingest files via escape link");
    assert.ok(
      walk.skipped.some((s) => s.reason === "symlink-or-junction" || s.reason === "escape") ||
        !walk.files.some((f) => f.relativePath.includes("escape-link")),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("hashBytes is stable", () => {
  const a = hashBytes(Buffer.from("same"));
  const b = hashBytes(Buffer.from("same"));
  assert.equal(a, b);
  assert.notEqual(a, hashBytes(Buffer.from("other")));
});

test("entity classification: resume and brand json", () => {
  const resume = classifyImportMaterial({
    filename: "resume.md",
    relativePath: "resume/resume.md",
    extractedText: "Curriculum vitae\nWork experience at Acme\nSkills: sales",
  });
  assert.ok(resume[0]!.confidence >= 80);
  assert.ok(shouldAutoAssociate(resume));

  const brand = classifyImportMaterial({
    filename: "info.json",
    relativePath: "brands/brand-a/info.json",
    extractedText: JSON.stringify({ brand: "A", positioning: "x", audience: "y" }),
  });
  assert.ok(brand.some((c) => c.kind === "brand"));

  const vague = classifyImportMaterial({
    filename: "note.txt",
    relativePath: "misc/note.txt",
    extractedText: "hello world",
  });
  const rev = needsReview(vague);
  assert.equal(rev.needs, true);
});

test("LAN discovery prefers physical private IPv4 and builds phone URL", () => {
  const fake = {
    Ethernet: [
      {
        address: "192.168.1.77",
        netmask: "255.255.255.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "192.168.1.77/24",
      },
    ],
    "vEthernet (WSL)": [
      {
        address: "172.24.80.1",
        netmask: "255.255.240.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "172.24.80.1/20",
      },
    ],
    Loopback: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ],
    APIPA: [
      {
        address: "169.254.10.10",
        netmask: "255.255.0.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "169.254.10.10/16",
      },
    ],
  };
  const lan = discoverPrivateLanAddresses(fake);
  assert.ok(lan.preferred);
  assert.equal(lan.preferred!.address, "192.168.1.77");
  assert.ok(!lan.candidates.some((c) => c.address.startsWith("169.254.")));
  assert.ok(!lan.candidates.some((c) => c.address === "127.0.0.1"));
  assert.equal(buildPhoneUrl("192.168.1.77", 31415), "http://192.168.1.77:31415/phone");
});
