import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTONOMY_LEVELS, AUTONOMY_POLICIES, DEFAULT_GRANTED_AUTONOMY,
  assertSeparateApprover, autonomyPolicy, classifyCapabilityAutonomy, evaluateAutonomy,
} from "../src/index.js";
import type { AutonomyActorV1, AutonomyLevelV1 } from "../src/index.js";

test("the scale runs 0 to 5 and each level states its own consequences", () => {
  assert.deepEqual(AUTONOMY_POLICIES.map((p) => p.level), [...AUTONOMY_LEVELS]);
  assert.equal(AUTONOMY_POLICIES.every((p) => p.label.length > 0 && p.description.length > 0), true);

  // Reading changes nothing and needs nothing. Everything from a local modification upward needs
  // a decision, and the last two are the ones that cannot be taken back.
  assert.equal(autonomyPolicy(0).requiresApproval, false);
  assert.equal(autonomyPolicy(1).requiresApproval, false);
  for (const level of [2, 3, 4, 5] as const) assert.equal(autonomyPolicy(level).requiresApproval, true, `level ${level} requires an approval`);
  for (const level of [0, 1, 2, 3] as const) assert.equal(autonomyPolicy(level).reversible, true, `level ${level} is reversible`);
  for (const level of [4, 5] as const) {
    assert.equal(autonomyPolicy(level).reversible, false, `level ${level} cannot be undone`);
    assert.equal(autonomyPolicy(level).requiresStandingAuthorization, true, `level ${level} needs more than one approval click`);
  }
});

test("no agent raises its own authority", () => {
  // A model proposing something local is fine. The same model proposing to send an email is not,
  // and the refusal names the ceiling rather than quietly downgrading the request.
  const local = evaluateAutonomy("provider-proposal", 1);
  assert.equal(local.allowed, true);

  const external = evaluateAutonomy("provider-proposal", 4);
  assert.equal(external.allowed, false);
  assert.equal(external.granted, 1);
  assert.match(external.reason, /does not raise an actor's own authority/iu);

  // The actor cannot supply its own ceiling: the grant map is a separate argument owned by policy.
  const forged = evaluateAutonomy("provider-proposal", 4, { ...DEFAULT_GRANTED_AUTONOMY, "provider-proposal": 5 });
  assert.equal(forged.allowed, true, "raising the ceiling is possible, but only by changing owner policy");
  assert.equal(evaluateAutonomy("provider-proposal", 4).allowed, false, "the default policy is unaffected by that call");
});

test("every non-owner actor starts low and the owner starts at the top", () => {
  assert.equal(DEFAULT_GRANTED_AUTONOMY.owner, 5);
  for (const actor of ["provider-proposal", "routine", "developer-agent"] as const) {
    assert.equal(DEFAULT_GRANTED_AUTONOMY[actor], 1, `${actor} may read and create locally, and nothing else`);
    assert.equal(evaluateAutonomy(actor, 2).allowed, false, `${actor} cannot modify existing records unaided`);
  }
  assert.equal(DEFAULT_GRANTED_AUTONOMY.system, 2, "AION's own housekeeping never needs to reach outside the machine");
  assert.equal(evaluateAutonomy("system", 3).allowed, false);
});

test("no model approves its own proposal", () => {
  assert.doesNotThrow(() => assertSeparateApprover("provider-proposal", "owner"), "the owner approving a model's proposal is the intended flow");
  assert.doesNotThrow(() => assertSeparateApprover("owner", "owner"));
  for (const approver of ["provider-proposal", "routine", "developer-agent", "system"] as const) {
    assert.throws(() => assertSeparateApprover("provider-proposal", approver), /Only the owner can approve/iu, `${approver} cannot approve`);
    assert.throws(() => assertSeparateApprover("owner", approver), /Only the owner can approve/iu);
  }
});

test("a capability's level comes from what it structurally does, not what it says about itself", () => {
  assert.equal(classifyCapabilityAutonomy({}), 0, "a capability that does nothing observable reads only");
  assert.equal(classifyCapabilityAutonomy({ writesLocalState: true, createsOnly: true }), 1);
  assert.equal(classifyCapabilityAutonomy({ writesLocalState: true }), 2);
  assert.equal(classifyCapabilityAutonomy({ reachesNetwork: true }), 3);
  assert.equal(classifyCapabilityAutonomy({ communicatesExternally: true }), 4);
  assert.equal(classifyCapabilityAutonomy({ spendsMoney: true }), 5);
  assert.equal(classifyCapabilityAutonomy({ irreversible: true }), 5);

  // Conservative where the properties conflict: a network capability that also communicates is
  // judged by the more serious of the two, never the more convenient.
  assert.equal(classifyCapabilityAutonomy({ reachesNetwork: true, communicatesExternally: true }), 4);
  assert.equal(classifyCapabilityAutonomy({ writesLocalState: true, createsOnly: true, spendsMoney: true }), 5);
});

test("unrecognised actors and levels fail closed rather than being guessed at", () => {
  assert.throws(() => evaluateAutonomy("marketing" as AutonomyActorV1, 1), /actor is not recognised/iu);
  assert.throws(() => evaluateAutonomy("owner", 7 as AutonomyLevelV1), /level is not recognised/iu);
  assert.throws(() => evaluateAutonomy("owner", -1 as AutonomyLevelV1), /level is not recognised/iu);
  assert.throws(() => autonomyPolicy(9 as AutonomyLevelV1), /not recognised/iu);
});
