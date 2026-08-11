import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailyOperatingReport,
  buildWaitingOnOthers,
  buildWhatChangedSince,
  buildContextDailyView,
} from "../src/daily-operating.js";
import { buildAttentionBoard } from "../src/attention-engine.js";
import { buildCommitment } from "../src/commitments.js";

const now = "2026-08-12T12:00:00.000Z";

test("attention board caps Owner must-do at 5", () => {
  const commits = Array.from({ length: 8 }, (_, i) =>
    buildCommitment(
      {
        committedBy: "Owner",
        committedTo: `P${i}`,
        statement: `Call person ${i}`,
        sourceRef: `t:${i}`,
        confidence: 90,
      },
      { id: `c${i}`, now, workspace: "work" },
    ),
  );
  const board = buildAttentionBoard({
    nowIso: now,
    relationships: [],
    tasks: [],
    commitments: commits,
  });
  assert.ok(board.ownerMustDo.length <= 5);
});

test("waiting on others excludes Owner-authored commitments", () => {
  const other = buildCommitment(
    {
      committedBy: "Alex Buyer",
      committedTo: "Owner",
      statement: "I'll send you the quote tomorrow.",
      sourceRef: "gmail:x",
      confidence: 80,
    },
    { id: "c1", now, workspace: "work" },
  );
  const owner = buildCommitment(
    {
      committedBy: "Owner",
      committedTo: "Alex",
      statement: "I'll call you Friday.",
      sourceRef: "gmail:y",
      confidence: 80,
    },
    { id: "c2", now, workspace: "work" },
  );
  const wait = buildWaitingOnOthers([other, owner], []);
  assert.equal(wait.length, 1);
  assert.equal(wait[0]!.person, "Alex Buyer");
});

test("what changed suppresses brand gap noise", () => {
  const r = buildWhatChangedSince({
    nowIso: now,
    sinceIso: "2026-08-11T12:00:00.000Z",
    activity: [
      { at: "2026-08-11T18:00:00.000Z", action: "brand.gap_scan", summary: "No brand DNA gaps detected." },
      { at: "2026-08-11T18:10:00.000Z", action: "gmail.ingest", summary: "Gmail ingest scanned=25" },
    ],
    commitments: [],
    relationships: [],
    lastSyncAt: "2026-08-11T18:17:00.000Z",
  });
  assert.match(r.reply, /Gmail sync completed/);
  assert.doesNotMatch(r.reply, /brand DNA/);
});

test("daily operating brief is dense and capped", () => {
  const board = buildAttentionBoard({
    nowIso: now,
    relationships: [],
    tasks: [],
    commitments: [],
  });
  const rep = buildDailyOperatingReport({
    nowIso: now,
    board,
    relationships: [],
    commitments: [],
    opportunities: [],
  });
  assert.match(rep.reply, /DAILY OPERATING BRIEF/);
  assert.match(rep.reply, /OWNER MUST DO/);
  assert.match(rep.reply, /WAITING ON OTHERS/);
  assert.match(rep.reply, /LAKELAND TOYOTA/);
  assert.ok(rep.highPriorityCount <= 5);
});

test("context daily view isolates work from personal labels", () => {
  const view = buildContextDailyView({
    context: "work",
    nowIso: now,
    relationships: [],
    commitments: [],
    opportunities: [],
    activity: [],
  });
  assert.match(view.reply, /LAKELAND TOYOTA/);
  assert.doesNotMatch(view.reply, /PERSONAL — DAILY/);
});
