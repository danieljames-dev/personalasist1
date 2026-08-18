/**
 * One source, one pass, one receipt that has to be honest about it.
 *
 * The cases that matter are the ones where something went partly wrong. A sync that reads everything
 * and says so is easy; the failure this suite is built around is a sync that reads half the approved
 * scope, or none of it, and still reports success — because that is the version the Owner cannot
 * detect, and it is the version that makes a downstream recommendation confidently thin.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { registerContextSource, setSourceState } from "../src/enrollment.js";
import type { PersonalContextFsV1 } from "../src/path-boundary.js";
import { receiptEarnsCompleted } from "../src/receipts.js";
import { createMemoryPersonalContextStore } from "../src/store.js";
import { syncSource } from "../src/sync.js";
import { declaration, FakeFs, makeSource, NOW } from "./fixtures.js";

const LATER = "2026-08-19T12:00:00Z";

function skillDoc(value: string): string {
  return declaration([
    { category: "SKILL", predicate: "skill", value, observedAt: "2026-07-01T00:00:00Z", temporalState: "CURRENT" },
  ]);
}

function seededStore(source = makeSource()) {
  const store = createMemoryPersonalContextStore();
  store.saveSource(source);
  return store;
}

function folderFs(): FakeFs {
  return new FakeFs()
    .addDir("c:/pc-test/root")
    .addFile("c:/pc-test/root/skills.json", skillDoc("TypeScript"), 1_000)
    .addFile("c:/pc-test/root/README.md", "# not a declaration\n", 2_000);
}

test("a registered, active source is read and reports what it read", () => {
  const store = seededStore();
  const receipt = syncSource("test-source", { store, fs: folderFs(), now: NOW });

  assert.equal(receipt.outcome, "COMPLETED");
  assert.equal(receipt.filesConsidered, 2);
  assert.equal(receipt.filesRead, 2);
  assert.equal(receipt.filesUnsupported, 1);
  assert.equal(receipt.factsExtracted, 1);
  assert.equal(receipt.factsCreated, 1);
  assert.equal(receipt.boundaryEscapeAttempts, 0);
  assert.equal(receiptEarnsCompleted(receipt), true);
});

test("an unregistered source is denied and reads nothing", () => {
  const store = createMemoryPersonalContextStore();
  const receipt = syncSource("never-registered", { store, fs: folderFs(), now: NOW });

  assert.equal(receipt.outcome, "DENIED");
  assert.equal(receipt.denialReason, "SOURCE_NOT_REGISTERED");
  assert.equal(receipt.filesRead, 0);
  assert.equal(store.listFacts().length, 0);
});

test("a disabled source is denied and reads nothing", () => {
  const store = seededStore(makeSource({ activeState: "DISABLED" }));
  const receipt = syncSource("test-source", { store, fs: folderFs(), now: NOW });

  assert.equal(receipt.outcome, "DENIED");
  assert.equal(receipt.denialReason, "SOURCE_DISABLED");
  assert.equal(receipt.filesRead, 0);
  assert.equal(store.listFacts().length, 0);
});

test("a revoked source is denied and reads nothing", () => {
  const store = seededStore(makeSource({ activeState: "REVOKED", revokedAt: NOW }));
  const receipt = syncSource("test-source", { store, fs: folderFs(), now: NOW });

  assert.equal(receipt.outcome, "DENIED");
  assert.equal(receipt.denialReason, "SOURCE_REVOKED");
  assert.equal(store.listFacts().length, 0);
});

test("an expired source is denied even while its state still says ACTIVE", () => {
  const store = seededStore(makeSource({ expiresAt: "2026-01-01T00:00:00Z" }));
  const receipt = syncSource("test-source", { store, fs: folderFs(), now: NOW });
  assert.equal(receipt.outcome, "DENIED");
  assert.equal(receipt.denialReason, "SOURCE_EXPIRED");
});

test("a source revoked after a successful sync cannot be read again, and its facts survive", () => {
  const store = seededStore();
  const fs = folderFs();
  const first = syncSource("test-source", { store, fs, now: NOW });
  assert.equal(first.outcome, "COMPLETED");
  const factsAfterFirst = store.listFacts().map((fact) => fact.factId).sort();
  assert.equal(factsAfterFirst.length, 1);

  const change = setSourceState("test-source", "REVOKED", { store, now: LATER });
  assert.equal(change.changed, true);

  const second = syncSource("test-source", { store, fs, now: LATER });
  assert.equal(second.outcome, "DENIED");
  assert.equal(second.denialReason, "SOURCE_REVOKED");
  // Revocation stops future reads. It does not erase where existing facts came from.
  assert.deepEqual(store.listFacts().map((fact) => fact.factId).sort(), factsAfterFirst);
  assert.equal(store.loadSource("test-source")?.revokedAt, LATER);
});

test("a single approved file syncs as its own root", () => {
  const store = seededStore(
    makeSource({ sourceType: "APPROVED_LOCAL_FILE", location: "c:/pc-test/root/skills.json" }),
  );
  const receipt = syncSource("test-source", { store, fs: folderFs(), now: NOW });

  assert.equal(receipt.outcome, "COMPLETED");
  assert.equal(receipt.filesRead, 1);
  assert.equal(store.listFacts().length, 1);
  assert.equal(store.listFacts()[0]?.sourceReference, ".");
});

test("a folder sync stays inside its bounds and records the refusals", () => {
  const store = seededStore(makeSource({ recursiveAllowed: false }));
  const fs = folderFs()
    .addFile("c:/pc-test/root/nested/more.json", skillDoc("SQL"), 3_000)
    .addDir("c:/pc-test/outside")
    .addLink("c:/pc-test/root/escape", "c:/pc-test/outside");

  const receipt = syncSource("test-source", { store, fs, now: NOW });

  assert.equal(receipt.outcome, "PARTIAL");
  assert.equal(receipt.filesRead, 2);
  assert.equal(receipt.denials.some((denial) => denial.reason === "SYMLINK_NOT_ALLOWED"), true);
  assert.equal(receipt.boundaryEscapeAttempts >= 1, true);
  assert.equal(store.listFacts().every((fact) => fact.value !== "SQL"), true);
});

test("an unchanged source is skipped without reading a single file", () => {
  const store = seededStore();
  const fs = folderFs();
  const first = syncSource("test-source", { store, fs, now: NOW });
  assert.equal(first.outcome, "COMPLETED");
  assert.equal(first.filesRead, 2);

  const second = syncSource("test-source", { store, fs, now: LATER });
  assert.equal(second.outcome, "SKIPPED_UNCHANGED");
  assert.equal(second.filesRead, 0);
  assert.equal(second.factsExtracted, 0);
  assert.equal(second.fingerprintBefore, second.fingerprintAfter);
  assert.equal(store.loadSource("test-source")?.lastSuccessfulSync, LATER);
});

test("a changed source is re-read and the change is reflected without losing the old claim", () => {
  const store = seededStore();
  const fs = folderFs();
  syncSource("test-source", { store, fs, now: NOW });

  fs.touch("c:/pc-test/root/skills.json", skillDoc("Rust"), 9_000);
  const second = syncSource("test-source", { store, fs, now: LATER });

  assert.equal(second.outcome, "COMPLETED");
  assert.equal(second.filesRead, 2);
  assert.notEqual(second.fingerprintBefore, second.fingerprintAfter);
  assert.equal(second.factsCreated, 1);
  assert.equal(second.factsSuperseded, 1);

  const values = store.listFacts().map((fact) => fact.value).sort();
  assert.deepEqual(values, ["Rust", "TypeScript"]);
  const superseded = store.listFacts().find((fact) => fact.value === "TypeScript");
  assert.notEqual(superseded?.supersededBy, null);
});

test("provenance and the source version are persisted, not just computed", () => {
  const store = seededStore();
  syncSource("test-source", { store, fs: folderFs(), now: NOW });

  const fact = store.listFacts()[0];
  assert.ok(fact);
  assert.equal(fact.sourceId, "test-source");
  assert.equal(fact.sourceReference, "skills.json");
  assert.match(fact.evidenceReference, /doc-1/);
  assert.equal(fact.extractedAt, NOW);
  assert.ok(fact.contentFingerprint.length > 0);
  assert.equal(fact.sourceModifiedAt, new Date(1_000).toISOString().replace(/\.\d{3}Z$/, "Z"));

  const source = store.loadSource("test-source");
  assert.equal(source?.version, 2);
  assert.equal(source?.lastAttemptedSync, NOW);
  assert.equal(source?.lastSuccessfulSync, NOW);
  assert.ok(source?.fingerprint);
});

test("every sync leaves a durable receipt, denials included", () => {
  const store = seededStore();
  const fs = folderFs();
  syncSource("test-source", { store, fs, now: NOW });
  setSourceState("test-source", "REVOKED", { store, now: LATER });
  syncSource("test-source", { store, fs, now: LATER });

  const outcomes = store.listReceipts().map((receipt) => receipt.outcome).sort();
  assert.deepEqual(outcomes, ["COMPLETED", "DENIED"]);
  assert.equal(store.listReceipts().every((receipt) => receipt.sourceId === "test-source"), true);
});

test("a file that cannot be read makes the sync partial, never complete", () => {
  const store = seededStore();
  const underlying = folderFs();
  const failing: PersonalContextFsV1 = {
    realpathSync: (path) => underlying.realpathSync(path),
    lstatSync: (path) => underlying.lstatSync(path),
    readdirSync: (path) => underlying.readdirSync(path),
    readFileSync(path) {
      if (path.includes("skills.json")) throw new Error("EACCES");
      return underlying.readFileSync(path);
    },
  };

  const receipt = syncSource("test-source", { store, fs: failing, now: NOW });

  assert.equal(receipt.outcome, "PARTIAL");
  assert.equal(receipt.filesConsidered, 2);
  assert.equal(receipt.filesRead, 1);
  assert.equal(receipt.errors.length, 1);
  assert.equal(receiptEarnsCompleted(receipt), false);
  assert.equal(store.listFacts().length, 0);
});

test("truncation is reported explicitly rather than presented as a full read", () => {
  const store = seededStore(makeSource({ maxFiles: 1 }));
  const receipt = syncSource("test-source", { store, fs: folderFs(), now: NOW });

  assert.equal(receipt.outcome, "PARTIAL");
  assert.equal(receipt.truncatedBy, "MAX_FILES");
  assert.equal(receipt.filesConsidered, 1);
});

test("a root that cannot be resolved fails rather than quietly succeeding with nothing", () => {
  const store = seededStore(makeSource({ location: "c:/pc-test/does-not-exist" }));
  const receipt = syncSource("test-source", { store, fs: folderFs(), now: NOW });

  assert.equal(receipt.outcome, "FAILED");
  assert.equal(receipt.fingerprintAfter, null);
  assert.equal(store.loadSource("test-source")?.version, 1);
  assert.equal(store.loadSource("test-source")?.lastSuccessfulSync, null);
});

test("enrollment refuses what the milestone did not authorize, and accepts what it did", () => {
  const store = createMemoryPersonalContextStore();
  const deps = { store, now: NOW };

  const tooSensitive = registerContextSource(
    {
      sourceId: "confidential-src",
      sourceType: "APPROVED_LOCAL_FOLDER",
      location: "c:/pc-test/root",
      displayName: "Confidential",
      purpose: "test",
      sensitivityClass: "CONFIDENTIAL",
    },
    deps,
  );
  assert.equal(tooSensitive.registered, false);
  assert.equal(tooSensitive.registered === false ? tooSensitive.reason : null, "SENSITIVITY_ABOVE_MILESTONE_CEILING");

  const unanchored = registerContextSource(
    { sourceId: "relative-src", sourceType: "APPROVED_LOCAL_FOLDER", location: "root", displayName: "R", purpose: "test" },
    deps,
  );
  assert.equal(unanchored.registered, false);
  assert.equal(unanchored.registered === false ? unanchored.reason : null, "LOCATION_NOT_IDENTIFIABLE");

  const good = registerContextSource(
    {
      sourceId: "approved-src",
      sourceType: "APPROVED_PROJECT_ARTIFACT",
      location: "c:/pc-test/root",
      displayName: "Approved project artifact",
      purpose: "Bounded acceptance source",
    },
    deps,
  );
  assert.equal(good.registered, true);
  assert.equal(good.registered === true ? good.source.followSymlinksAllowed : null, false);
  assert.equal(good.registered === true ? good.source.activeState : null, "ACTIVE");

  const duplicate = registerContextSource(
    {
      sourceId: "approved-src",
      sourceType: "APPROVED_PROJECT_ARTIFACT",
      location: "c:/pc-test/root",
      displayName: "Again",
      purpose: "test",
    },
    deps,
  );
  assert.equal(duplicate.registered, false);
  assert.equal(duplicate.registered === false ? duplicate.reason : null, "DUPLICATE_SOURCE_ID");
});
