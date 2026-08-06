import assert from "node:assert/strict";
import { test } from "node:test";

import { identityStatusV1, initializeLocalIdentityV1 } from "../src/index.js";
import { cloneState, DeterministicClock, DeterministicGenerator, IDS, MemoryRepository, TIME } from "./helpers.js";

test("first explicit initialization uses injected ports and exactly four ordered generator calls", async () => {
  const repository = new MemoryRepository();
  const generator = new DeterministicGenerator();
  const clock = new DeterministicClock();
  const result = await initializeLocalIdentityV1(repository, generator, clock);
  assert.equal(result.outcome, "initialized");
  assert.deepEqual(generator.calls, ["owner", "principal", "actor", "system-instance"]);
  assert.equal(clock.calls, 1);
  assert.equal(repository.installs, 1);
  assert.equal(repository.lockCalls, 1);
  assert.equal(result.state.createdAt, TIME);
  assert.equal(result.state.records.every(({ createdAt, updatedAt }) => createdAt === TIME && updatedAt === TIME), true);
});

test("second initialization generates no identifiers, preserves timestamps and IDs, and performs no rewrite", async () => {
  const repository = new MemoryRepository();
  const first = await initializeLocalIdentityV1(repository, new DeterministicGenerator(), new DeterministicClock());
  const serialized = JSON.stringify(repository.value);
  const secondGenerator = new DeterministicGenerator([]);
  const secondClock = new DeterministicClock("2030-01-01T00:00:00.000Z");
  const second = await initializeLocalIdentityV1(repository, secondGenerator, secondClock);
  assert.equal(second.outcome, "already-initialized");
  assert.equal(secondGenerator.calls.length, 0);
  assert.equal(secondClock.calls, 0);
  assert.equal(repository.installs, 1);
  assert.equal(JSON.stringify(repository.value), serialized);
  assert.deepEqual(second.state, first.state);
});

test("corrupt or conflicting existing state fails before clock, generation, or replacement write", async () => {
  const validRepository = new MemoryRepository();
  const valid = (await initializeLocalIdentityV1(validRepository, new DeterministicGenerator(), new DeterministicClock())).state;
  for (const existing of ["corrupt", { partial: true }, (() => { const value = cloneState(valid); value.relationships = []; return value; })()]) {
    const repository = new MemoryRepository();
    repository.value = existing;
    const generator = new DeterministicGenerator();
    const clock = new DeterministicClock();
    await assert.rejects(initializeLocalIdentityV1(repository, generator, clock), { code: "identity-state-invalid" });
    assert.equal(generator.calls.length, 0);
    assert.equal(clock.calls, 0);
    assert.equal(repository.installs, 0);
  }
});

test("duplicate generator output fails closed without installing state", async () => {
  const repository = new MemoryRepository();
  const repeated = [IDS[0], IDS[0], IDS[2], IDS[3]];
  await assert.rejects(
    initializeLocalIdentityV1(repository, new DeterministicGenerator(repeated), new DeterministicClock()),
    { code: "identity-state-conflict" },
  );
  assert.equal(repository.installs, 0);
});

test("injected persistence failure returns no success and stores no state", async () => {
  const repository = new MemoryRepository();
  repository.failInstall = true;
  await assert.rejects(initializeLocalIdentityV1(repository, new DeterministicGenerator(), new DeterministicClock()));
  assert.equal(repository.value, null);
});

test("status reports only redacted fingerprints and never complete identifiers", async () => {
  const repository = new MemoryRepository();
  const state = (await initializeLocalIdentityV1(repository, new DeterministicGenerator(), new DeterministicClock())).state;
  const before = identityStatusV1(null);
  assert.deepEqual(before, { version: "1", initialized: false, recordCount: 0, relationshipCount: 0, fingerprints: [] });
  const status = identityStatusV1(state);
  assert.equal(status.recordCount, 4);
  assert.equal(status.relationshipCount, 3);
  assert.equal(status.fingerprints.length, 4);
  const serialized = JSON.stringify(status);
  for (const id of IDS) assert.equal(serialized.includes(id), false);
});
