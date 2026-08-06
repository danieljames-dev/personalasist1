import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asActorIdV1,
  asOwnerIdV1,
  asPrincipalIdV1,
  asSystemInstanceIdV1,
  initializeLocalIdentityV1,
  isIdentityIdV1,
  validateLocalIdentityStateV1,
} from "../src/index.js";
import { cloneState, DeterministicClock, DeterministicGenerator, IDS, MemoryRepository } from "./helpers.js";

async function validState() {
  const repository = new MemoryRepository();
  return (await initializeLocalIdentityV1(repository, new DeterministicGenerator(), new DeterministicClock())).state;
}

test("identifier contracts validate canonical UUID v4 values and retain distinct brands", () => {
  assert.equal(isIdentityIdV1(IDS[0]), true);
  const owner = asOwnerIdV1(IDS[0]);
  const principal = asPrincipalIdV1(IDS[1]);
  const actor = asActorIdV1(IDS[2]);
  const system = asSystemInstanceIdV1(IDS[3]);
  assert.deepEqual([owner, principal, actor, system], IDS);
});

test("identifier contracts reject malformed, empty, padded, upper-case, wrong-version, and wrong-variant values", () => {
  for (const value of [
    "", ` ${IDS[0]}`, `${IDS[0]} `, "ABCDEFAB-CDEF-4ABC-8ABC-ABCDEFABCDEF",
    "00000000-0000-3000-8000-000000000001", "00000000-0000-4000-7000-000000000001", "not-an-id",
  ]) assert.equal(isIdentityIdV1(value), false);
});

test("valid local state contains exactly four records and three integral relationships", async () => {
  const state = validateLocalIdentityStateV1(await validState());
  assert.deepEqual(state.records.map(({ kind }) => kind), ["owner", "principal", "actor", "system-instance"]);
  assert.deepEqual(state.relationships.map(({ kind }) => kind), [
    "actor-to-principal", "principal-to-owner", "system-instance-to-owner",
  ]);
  assert.equal(JSON.stringify(state).match(/name|email|username|credential|password|token|employer|biograph|device/gi), null);
});

test("state validation fails closed for missing, duplicate, multiple, mismatched, malformed, unsupported, or profile-bearing state", async () => {
  const source = await validState();
  const mutations: Array<(state: Record<string, unknown>) => void> = [
    (state) => { delete state.contractVersion; },
    (state) => { state.contractVersion = "identity-contract-v2"; },
    (state) => { state.lifecycleStatus = "unknown"; },
    (state) => { state.updatedAt = "2025-01-01T00:00:00.000Z"; },
    (state) => { state.createdAt = "not-a-time"; },
    (state) => { (state.records as unknown[]).pop(); },
    (state) => { (state.records as unknown[]).push(structuredClone((state.records as unknown[])[0])); },
    (state) => { (state.records as Array<Record<string, unknown>>)[1]!.kind = "owner"; },
    (state) => { (state.records as Array<Record<string, unknown>>)[1]!.id = IDS[0]; },
    (state) => { (state.records as Array<Record<string, unknown>>)[0]!.lifecycleStatus = "deleted"; },
    (state) => { (state.records as Array<Record<string, unknown>>)[0]!.updatedAt = "2020-01-01T00:00:00.000Z"; },
    (state) => { (state.relationships as unknown[]).pop(); },
    (state) => { (state.relationships as unknown[]).push(structuredClone((state.relationships as unknown[])[0])); },
    (state) => { (state.relationships as Array<Record<string, unknown>>)[0]!.principalId = IDS[3]; },
    (state) => { (state.records as Array<Record<string, unknown>>)[0]!.id = "malformed"; },
    (state) => { (state.records as Array<Record<string, unknown>>)[0]!.name = "synthetic"; },
    (state) => { state.email = "synthetic@invalid.example"; },
    (state) => { (state.provenance as Record<string, unknown>).source = "imported"; },
  ];
  for (const mutate of mutations) {
    const candidate = cloneState(source);
    mutate(candidate);
    assert.throws(() => validateLocalIdentityStateV1(candidate), { code: "identity-state-invalid" });
  }
});
