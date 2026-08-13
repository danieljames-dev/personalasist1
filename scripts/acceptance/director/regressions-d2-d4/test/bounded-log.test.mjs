import assert from "node:assert/strict";
import test from "node:test";
import { spawnSafeSync } from "../lib/spawn-safe.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyLogState, ingestChunk, LOG_LIMITS } from "../lib/bounded-log.mjs";

const flood = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "flood-stdout.cjs");

test("live buffer keeps a tail and marks truncation", () => {
  let st = emptyLogState();
  const chunk = Buffer.alloc(80_000, 0x61);
  for (let i = 0; i < 8; i += 1) st = ingestChunk(st, chunk);
  assert.equal(st.truncatedLive, true);
  assert.ok(st.live.length <= LOG_LIMITS.maxLiveBytes + LOG_LIMITS.marker.length);
  assert.match(st.live.toString(), /AION_LOG_TRUNCATED/);
});

test("run-level cap sets haltInput so Director can kill a flooder", () => {
  let st = emptyLogState();
  const chunk = Buffer.alloc(1024 * 1024, 0x62);
  for (let i = 0; i < 20; i += 1) st = ingestChunk(st, chunk);
  assert.equal(st.haltInput, true);
  assert.ok(st.bytesIn > LOG_LIMITS.maxRunRawBytes);
});

test("a real flooding child produces more than the live cap", () => {
  const r = spawnSafeSync(process.execPath, [flood, "5000"], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0);
  assert.ok((r.stdout || "").length > LOG_LIMITS.maxLiveBytes);
});
