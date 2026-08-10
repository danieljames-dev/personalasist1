import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQueuedImportSource,
  csvRowToRelationship,
  parseSimpleCsv,
} from "../src/import-queue.js";

test("parse simple csv with header", () => {
  const { headers, rows } = parseSimpleCsv("name,email,company\nJane,jane@t.com,Acme\n");
  assert.deepEqual(headers, ["name", "email", "company"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.name, "Jane");
});

test("csv row maps to relationship payload", () => {
  const p = csvRowToRelationship({ name: "Jane", email: "j@t.com", company: "Acme" });
  assert.ok(p);
  assert.equal(p!.displayName, "Jane");
  assert.equal(p!.organisation, "Acme");
});

test("queued import source is owner-selected only", () => {
  const s = buildQueuedImportSource(
    { path: "C:\\Owner\\Selected\\folder", kind: "folder", associateWith: "owner" },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", now: "2030-01-01T00:00:00.000Z" },
  );
  assert.equal(s.status, "queued");
  assert.equal(s.associateWith, "owner");
  assert.match(s.path, /Selected/);
  assert.ok(s.stats);
  assert.equal(s.stats.filesDiscovered, 0);
  assert.deepEqual(s.errorLog, []);
});
