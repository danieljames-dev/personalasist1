/**
 * Restart safety, and what happens when a stored record is not what it claims to be.
 *
 * The reload case is straightforward and still worth asserting: a second store opened over the same
 * directory has to see the same registry, the same facts, and — the part that is easy to lose — the
 * same conflict and supersession links, because those are the difference between "two employers" and
 * "two employers, and we do not know which is current".
 *
 * The corruption case is where the tempting behaviour is wrong. Skipping a malformed record keeps the
 * process running and makes an approved source silently stop being read, or a conflict silently
 * resolve itself. Both look exactly like success from the outside. So a bad record raises and names
 * its file.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { extractFactsFromFile } from "../src/extraction.js";
import { reconcileFacts } from "../src/reconcile.js";
import {
  createFilePersonalContextStore,
  factRecordPath,
  PersonalContextIntegrityError,
  sourceRecordPath,
} from "../src/store.js";
import { declaration, makeSource, NOW } from "./fixtures.js";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "aion-personal-context-"));
}

function conflictingFacts() {
  const rows = (value: string) => [
    {
      category: "CURRENT_EMPLOYMENT",
      predicate: "title",
      value,
      temporalState: "CURRENT",
      lastConfirmedAt: "2026-08-01T00:00:00Z",
    },
  ];
  const fromResume = extractFactsFromFile({
    source: makeSource({ sourceId: "resume" }),
    sourceReference: "resume.json",
    contents: declaration(rows("Operations Manager"), "owner", "resume-doc"),
    sourceModifiedAt: null,
    now: NOW,
  }).facts;
  const fromCurrentJob = extractFactsFromFile({
    source: makeSource({ sourceId: "current-job" }),
    sourceReference: "current-job.json",
    contents: declaration(rows("Operations Lead"), "owner", "current-job-doc"),
    sourceModifiedAt: null,
    now: NOW,
  }).facts;
  return reconcileFacts([], [...fromResume, ...fromCurrentJob]);
}

test("a store reopened over the same directory sees the same registry, facts and receipts", () => {
  const root = scratch();
  try {
    const first = createFilePersonalContextStore(root);
    first.saveSource(makeSource({ sourceId: "resume", displayName: "Resume" }));
    first.saveSource(makeSource({ sourceId: "current-job", displayName: "Current job record" }));

    const reconciled = conflictingFacts();
    first.saveFacts(reconciled.facts);
    first.saveReceipt({
      schema: "aion.personalContext.syncReceipt.v1",
      receiptId: "receipt-1",
      sourceId: "resume",
      milestoneId: "PERSONAL-CONTEXT-SYNC-V1",
      ownerAuthorizationId: "PERSONAL-CONTEXT-SYNC-V1-20260818T140242Z",
      outcome: "COMPLETED",
      denialReason: null,
      startedAt: NOW,
      completedAt: NOW,
      fingerprintBefore: null,
      fingerprintAfter: "fp",
      sourceVersionBefore: 1,
      sourceVersionAfter: 2,
      filesConsidered: 1,
      filesRead: 1,
      filesUnsupported: 0,
      denials: [],
      boundaryEscapeAttempts: 0,
      truncatedBy: null,
      factsExtracted: 1,
      factsCreated: 1,
      factsUpdated: 0,
      factsSuperseded: 0,
      factsUnchanged: 0,
      conflictsDetected: 0,
      conflictsConfirmed: 0,
      skips: [],
      errors: [],
    });

    const reopened = createFilePersonalContextStore(root);
    assert.deepEqual(reopened.listSources().map((row) => row.sourceId), ["current-job", "resume"]);
    assert.equal(reopened.loadSource("resume")?.displayName, "Resume");
    assert.equal(reopened.listFacts().length, reconciled.facts.length);
    assert.equal(reopened.listReceipts().length, 1);
    assert.equal(reopened.listReceipts()[0]?.outcome, "COMPLETED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("conflict and supersession links survive the reload", () => {
  const root = scratch();
  try {
    const store = createFilePersonalContextStore(root);
    store.saveSource(makeSource({ sourceId: "resume" }));
    store.saveSource(makeSource({ sourceId: "current-job" }));
    const reconciled = conflictingFacts();
    assert.equal(reconciled.conflicts.length, 1);
    store.saveFacts(reconciled.facts);

    const reopened = createFilePersonalContextStore(root);
    const reloaded = reopened.listFacts();
    assert.equal(reloaded.length, 2);
    assert.equal(reloaded.every((row) => row.conflictState === "CONFIRMED"), true);
    for (const row of reloaded) {
      assert.equal(row.conflictsWith.length, 1);
      assert.ok(reloaded.some((other) => other.factId === row.conflictsWith[0]));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a corrupt source record raises and names the file rather than disappearing", () => {
  const root = scratch();
  try {
    const store = createFilePersonalContextStore(root);
    store.saveSource(makeSource({ sourceId: "good" }));
    mkdirSync(join(root, "sources"), { recursive: true });
    writeFileSync(sourceRecordPath(root, "broken"), JSON.stringify({ schema: "aion.personalContext.v1", sourceId: "broken" }), "utf8");

    assert.throws(() => createFilePersonalContextStore(root).listSources(), PersonalContextIntegrityError);
    assert.throws(() => createFilePersonalContextStore(root).loadSource("broken"), PersonalContextIntegrityError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a corrupt fact record raises rather than silently resolving a conflict", () => {
  const root = scratch();
  try {
    const store = createFilePersonalContextStore(root);
    store.saveSource(makeSource({ sourceId: "resume" }));
    store.saveSource(makeSource({ sourceId: "current-job" }));
    store.saveFacts(conflictingFacts().facts);

    mkdirSync(join(root, "facts"), { recursive: true });
    writeFileSync(factRecordPath(root, "corrupt"), "{ not json", "utf8");

    assert.throws(() => createFilePersonalContextStore(root).listFacts(), PersonalContextIntegrityError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a record that would not validate is refused on the way in as well as the way out", () => {
  const root = scratch();
  try {
    const store = createFilePersonalContextStore(root);
    assert.throws(
      () => store.saveSource({ ...makeSource(), sourceId: "../escape" }),
      PersonalContextIntegrityError,
    );
    const good = conflictingFacts().facts[0];
    assert.ok(good);
    assert.throws(
      () => store.saveFacts([{ ...good, eligibleUses: [] }]),
      PersonalContextIntegrityError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a receipt cannot be stored claiming COMPLETED while recording failures", () => {
  const root = scratch();
  try {
    const store = createFilePersonalContextStore(root);
    assert.throws(
      () =>
        store.saveReceipt({
          schema: "aion.personalContext.syncReceipt.v1",
          receiptId: "receipt-lying",
          sourceId: "resume",
          milestoneId: "PERSONAL-CONTEXT-SYNC-V1",
          ownerAuthorizationId: "PERSONAL-CONTEXT-SYNC-V1-20260818T140242Z",
          outcome: "COMPLETED",
          denialReason: null,
          startedAt: NOW,
          completedAt: NOW,
          fingerprintBefore: null,
          fingerprintAfter: "fp",
          sourceVersionBefore: 1,
          sourceVersionAfter: 2,
          filesConsidered: 2,
          filesRead: 1,
          filesUnsupported: 0,
          denials: [],
          boundaryEscapeAttempts: 0,
          truncatedBy: null,
          factsExtracted: 0,
          factsCreated: 0,
          factsUpdated: 0,
          factsSuperseded: 0,
          factsUnchanged: 0,
          conflictsDetected: 0,
          conflictsConfirmed: 0,
          skips: [],
          errors: ["one file could not be read"],
        }),
      PersonalContextIntegrityError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
