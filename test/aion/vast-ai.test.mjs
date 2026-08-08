import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VAST_CREDENTIAL_VARIABLE, VastAiInfrastructureV1, buildVastQuery, normaliseVastOffer } from "../../apps/aion/vast-ai.mjs";

/**
 * The Vast.ai adapter, tested without an account, a key, or a network.
 *
 * Everything that can be tested purely is: the response shape, the query built from AION's filter,
 * and the two locks on provisioning. Nothing here reaches Vast.ai, and no credential is read —
 * the environment variable used below is a name this test invents.
 */

const NOW = "2030-01-01T00:00:00.000Z";

/** A bundle shaped like a Vast.ai response. Values invented; no real offer is referenced. */
const BUNDLE = {
  id: 987654,
  gpu_name: "RTX 4090",
  num_gpus: 1,
  gpu_ram: 24_576,
  dph_total: 0.3812,
  storage_cost: 0.15,
  disk_space: 120.7,
  reliability2: 0.9871,
  geolocation: "SE",
  inet_down: 940.2,
  verified: true,
};

test("a Vast bundle normalises into AION's provider-neutral shape", () => {
  const offer = normaliseVastOffer(BUNDLE, NOW);
  assert.equal(offer.provider, "vast-ai");
  assert.equal(offer.offerRef, "987654");
  assert.equal(offer.gpuName, "RTX 4090");
  assert.equal(offer.vramGb, 24, "per-GPU VRAM is converted from MB to whole GB");
  assert.equal(offer.reliability, 99, "reliability is converted from a 0-1 fraction to 0-100");
  assert.equal(offer.region, "SE");
  assert.equal(offer.verified, true);
  assert.equal(offer.retrievedAt, NOW);
});

test("money is whole cents, rounded up, so no float ever reaches a spending limit", () => {
  const offer = normaliseVastOffer(BUNDLE, NOW);
  assert.equal(offer.hourlyCents, 39, "$0.3812/hour rounds up to 39 cents rather than down to 38");
  assert.equal(Number.isSafeInteger(offer.hourlyCents), true);
  assert.equal(Number.isSafeInteger(offer.storageCentsPerHour), true);
  // A machine that costs a fraction of a cent more than predicted must never slip under a limit.
  const cheap = normaliseVastOffer({ ...BUNDLE, dph_total: 0.2001 }, NOW);
  assert.equal(cheap.hourlyCents, 21);
});

test("anything the provider did not report stays absent rather than being invented", () => {
  const sparse = normaliseVastOffer({ id: 1, gpu_name: "Mystery", gpu_ram: 8192, dph_total: 0.1 }, NOW);
  assert.equal(sparse.reliability, null, "an unreported reliability is null, not a plausible default");
  assert.equal(sparse.region, null);
  assert.equal(sparse.verified, null);
  assert.equal(sparse.diskGb, null);
  assert.equal(sparse.storageCentsPerHour, 0);
  assert.equal(sparse.gpuCount, 1);
});

test("a bundle with no usable VRAM is refused rather than guessed at", () => {
  assert.throws(() => normaliseVastOffer({ id: 2, gpu_name: "G", dph_total: 0.1 }, NOW), /must state its VRAM/u);
  assert.throws(() => normaliseVastOffer({ id: 3, gpu_name: "G", gpu_ram: 0, dph_total: 0.1 }, NOW), /must state its VRAM/u);
});

test("the query is built from AION's filter, never from anything a model produced", () => {
  const query = buildVastQuery({ minimumVramGb: 24, maxHourlyCents: 50, minimumReliability: 95, limit: 10 });
  assert.deepEqual(query.gpu_ram, { gte: 24 * 1024 });
  assert.deepEqual(query.dph_total, { lte: 0.5 });
  assert.deepEqual(query.reliability2, { gte: 0.95 });
  assert.deepEqual(query.rentable, { eq: true });
  assert.equal(query.type, "on-demand");
  assert.equal(query.limit, 10);
  assert.deepEqual(query.order, [["dph_total", "asc"]]);

  const unbounded = buildVastQuery({ minimumVramGb: 8, maxHourlyCents: 100, minimumReliability: null, limit: 9999 });
  assert.equal("reliability2" in unbounded, false, "an unset reliability filter is omitted, not defaulted");
  assert.equal(unbounded.limit, 200, "the page size is capped whatever the caller asked for");
});

test("the credential is read by name and its absence is reported as absence", async () => {
  const variableName = "AION_TEST_VAST_KEY_THAT_IS_NOT_SET";
  delete process.env[variableName];
  const adapter = new VastAiInfrastructureV1({ variableName });
  const status = await adapter.credentialStatus();

  assert.equal(status.configured, false);
  assert.equal(status.variableName, variableName, "AION reports the variable NAME");
  assert.match(status.detail, /Do not paste the key into Chat/u);
  assert.match(status.detail, /never stores a credential value/u);
  assert.equal(adapter.provider, "vast-ai");
  assert.equal(DEFAULT_VAST_CREDENTIAL_VARIABLE, "AION_VAST_API_KEY");
});

test("a configured credential is reported as present without its value appearing anywhere", async () => {
  const variableName = "AION_TEST_VAST_KEY_PRESENT";
  process.env[variableName] = "not-a-real-key-0123456789abcdef";
  try {
    const status = await new VastAiInfrastructureV1({ variableName }).credentialStatus();
    assert.equal(status.configured, true);
    assert.equal(JSON.stringify(status).includes("not-a-real-key"), false, "the value never leaves the environment");
    assert.match(status.detail, /stores only the variable name/u);
  } finally { delete process.env[variableName]; }
});

test("provisioning is off unless the composition root deliberately turns it on", async () => {
  const variableName = "AION_TEST_VAST_KEY_PRESENT_2";
  process.env[variableName] = "not-a-real-key-0123456789abcdef";
  try {
    const locked = new VastAiInfrastructureV1({ variableName });
    assert.equal(locked.allowProvisioning, false, "the default is off");
    await assert.rejects(
      () => locked.start({ offerRef: "1", modelId: "m", runtime: "vllm" }, new AbortController().signal),
      /not enabled in this build/u,
      "even with a key present, the adapter will not rent a machine",
    );
  } finally { delete process.env[variableName]; }
});

test("nothing reaches Vast.ai when the variable is unset, including a stop", async () => {
  const variableName = "AION_TEST_VAST_KEY_ABSENT_2";
  delete process.env[variableName];
  const adapter = new VastAiInfrastructureV1({ variableName, allowProvisioning: true });
  const signal = new AbortController().signal;

  await assert.rejects(() => adapter.discover({ minimumVramGb: 8, maxHourlyCents: 50, minimumReliability: null, limit: 5 }, signal), new RegExp(`${variableName} is not set`, "u"));
  await assert.rejects(() => adapter.start({ offerRef: "1", modelId: "m", runtime: "vllm" }, signal), new RegExp(`${variableName} is not set`, "u"));

  // stop swallows the failure into a reported outcome rather than throwing, because a teardown
  // attempt that cannot even be made must still be recorded as unconfirmed.
  const stopped = await adapter.stop("1", signal);
  assert.equal(stopped.stopped, false);
  assert.match(stopped.detail, new RegExp(`${variableName} is not set`, "u"));

  /*
   * status throws instead, and the difference matters. "AION could not ask" and "the machine has
   * failed" are not the same fact, and the readiness bridge tears a machine down when the provider
   * reports failure. Returning `failed` here would mean an environment variable missing from a
   * restarted shell destroyed a paid instance mid-boot. Throwing says AION does not know, which is
   * recorded, redacted, and retried inside the allowance the owner approved.
   */
  await assert.rejects(() => adapter.status("1", signal), new RegExp(`${variableName} is not set`, "u"));
});

test("an invalid variable name is treated as no credential at all", async () => {
  for (const variableName of ["lowercase_name", "has spaces", "1STARTS_WITH_DIGIT", ""]) {
    const status = await new VastAiInfrastructureV1({ variableName }).credentialStatus();
    assert.equal(status.configured, false, `${JSON.stringify(variableName)} is not a usable variable name`);
  }
});
