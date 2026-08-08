import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AionAssistantV1, BRAIN_BOUNDARY, BoundaryModelProviderV1, DeterministicClockV1,
  DeterministicIdGeneratorV1, DeterministicModelProviderV1, InMemoryStateRepositoryV1,
  LocalArchiveImportSourceV1, LocalEchoCapabilityV1, NodePrivateBackupV1, OFFLINE_ENDPOINT_ID,
  SelectableDeveloperAgentRegistryV1, StaticCapabilityRegistryV1, SyntheticDeveloperAgentBridgeV1,
  buildEndpoint, capabilityScore, defaultBrainSettings, describeDisclosure, independenceReport,
  isOwnerControlled, offlineEndpoint, routeRequest, validateEndpointUrl,
} from "../src/index.js";
import type { BrainEndpointV1, BrainSettingsV1, ModelProviderV1, RoutingRequestV1 } from "../src/index.js";

/**
 * No network request is made anywhere in this suite. Endpoints are configuration records, and the
 * router is pure policy: it decides whether a request would be allowed, never performs one.
 */

const NOW = "2030-01-01T00:00:00.000Z";
const REQUEST: RoutingRequestV1 = {
  workspace: "personal", workspaceLabel: "Personal", needs: ["conversation"],
  includesMemory: false, includesWorkOrCustomerInformation: false, contextClasses: ["this conversation"],
};

let sequence = 0;
function endpoint(overrides: Record<string, unknown>): BrainEndpointV1 {
  return buildEndpoint(
    {
      label: `endpoint-${sequence}`, runtime: "openai-compatible", location: "owner-controlled-host",
      baseUrl: "https://gpu.invalid", model: "open-weights-large", ...overrides,
    },
    { id: `endpoint-${sequence++}`, now: NOW, existing: [] },
  );
}
function settings(overrides: Partial<BrainSettingsV1> = {}): BrainSettingsV1 {
  const base = defaultBrainSettings(NOW);
  return { ...base, ...overrides, endpoints: overrides.endpoints ?? base.endpoints };
}

async function assistant(providers: ModelProviderV1[] = [new DeterministicModelProviderV1()]) {
  const root = await mkdtemp(join(tmpdir(), "aion-brain-test-"));
  const exports = join(root, "exports"); await mkdir(exports);
  return new AionAssistantV1({
    repository: new InMemoryStateRepositoryV1(),
    clock: new DeterministicClockV1(), ids: new DeterministicIdGeneratorV1(),
    providers,
    capabilities: new StaticCapabilityRegistryV1([new LocalEchoCapabilityV1()]),
    importer: new LocalArchiveImportSourceV1(), backup: new NodePrivateBackupV1(exports),
    developerAgents: new SelectableDeveloperAgentRegistryV1([new SyntheticDeveloperAgentBridgeV1()]),
  });
}

test("AION starts with an offline floor that cannot be configured away", async () => {
  const service = await assistant();
  const brain = await service.brainSettings();
  assert.equal(brain.mode, "local-preferred");
  assert.equal(brain.remoteFallbackEnabled, false, "remote proprietary fallback is off by default");
  assert.equal(brain.offlineMode, false);
  assert.deepEqual(brain.endpoints.map((entry) => entry.id), [OFFLINE_ENDPOINT_ID]);
  await assert.rejects(() => service.removeBrainEndpoint(OFFLINE_ENDPOINT_ID), /cannot be removed/iu);

  const report = await service.independence();
  assert.equal(report.independent, true, "AION is usable with no credential of any kind");
  assert.equal(report.offlineFloorPresent, true);
  assert.match(report.summary, /keep working with every credential deleted, but modestly/u);
});

test("an owner-rented GPU counts as owner-controlled; a vendor API does not", () => {
  const rented = endpoint({ location: "owner-controlled-host", hostLabel: "rented GPU box" });
  const vendor = endpoint({ location: "third-party-service", baseUrl: "https://api.invalid" });
  assert.equal(isOwnerControlled(rented), true, "renting capacity you control is still control");
  assert.equal(isOwnerControlled(vendor), false);
  assert.equal(isOwnerControlled(offlineEndpoint(NOW)), true);
});

test("Local Only never reaches a third-party endpoint, however capable it is", () => {
  const vendor = endpoint({ location: "third-party-service", baseUrl: "https://api.invalid", label: "vendor", capabilities: { reasoning: true, code: true, structuredJson: true, toolProposal: true, vision: true, embeddings: true, contextTokens: 1_000_000 } });
  const decision = routeRequest(settings({ mode: "local-only", endpoints: [offlineEndpoint(NOW), vendor] }), REQUEST);
  assert.equal(decision.allowed, true);
  assert.equal(decision.endpoint?.id, OFFLINE_ENDPOINT_ID);
  assert.match(decision.reason, /No third-party endpoint was considered/u);
  assert.ok(decision.considered.some((entry) => entry.id === vendor.id && !entry.usable && /Local Only/u.test(entry.why)), "the exclusion is stated, not silent");
});

test("offline mode means this computer, not the owner's other machine", () => {
  const ownGpu = endpoint({ location: "owner-controlled-host", label: "home GPU" });
  const brain = settings({ offlineMode: true, endpoints: [offlineEndpoint(NOW), ownGpu] });
  const decision = routeRequest(brain, REQUEST);
  assert.equal(decision.endpoint?.id, OFFLINE_ENDPOINT_ID);
  assert.ok(decision.considered.some((entry) => entry.id === ownGpu.id && /offline mode is on/u.test(entry.why)));

  // And when the only capable endpoint is off-machine, offline mode refuses rather than reaching out.
  const reasoning = { ...REQUEST, needs: ["reasoning"] as const };
  const refused = routeRequest(settings({ offlineMode: true, endpoints: [offlineEndpoint(NOW), endpoint({ capabilities: { reasoning: true } })] }), reasoning);
  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /will not reach out to complete it/u);
});

test("Local Preferred never switches to a third party on its own initiative", () => {
  const vendor = endpoint({ location: "third-party-service", baseUrl: "https://api.invalid", label: "vendor", capabilities: { reasoning: true } });
  const needsReasoning = { ...REQUEST, needs: ["reasoning"] as const };

  const refused = routeRequest(settings({ endpoints: [offlineEndpoint(NOW), vendor] }), needsReasoning);
  assert.equal(refused.allowed, false, "no endpoint the owner controls can do it, and AION does not quietly switch");
  assert.match(refused.reason, /does not switch to vendor on its own/u);

  const withFallback = routeRequest(settings({ remoteFallbackEnabled: true, endpoints: [offlineEndpoint(NOW), vendor] }), needsReasoning);
  assert.equal(withFallback.allowed, true);
  assert.equal(withFallback.requiresApproval, true, "even with fallback on, it is a proposal rather than a switch");
  assert.equal(withFallback.requiresDisclosure, true);
  assert.match(withFallback.reason, /proposing it rather than using it/u);
});

test("Maximum Capability is a capability preference, never consent to send context out", () => {
  const vendor = endpoint({ location: "third-party-service", baseUrl: "https://api.invalid", label: "vendor", capabilities: { reasoning: true, code: true, structuredJson: true, toolProposal: true, vision: true, embeddings: true, contextTokens: 1_000_000 } });
  const ownGpu = endpoint({ label: "home GPU", capabilities: { reasoning: true, contextTokens: 32_768 } });
  assert.ok(capabilityScore(vendor) > capabilityScore(ownGpu), "the vendor endpoint really is the stronger one");

  const held = routeRequest(settings({ mode: "maximum-capability", endpoints: [offlineEndpoint(NOW), ownGpu, vendor] }), REQUEST);
  assert.equal(held.endpoint?.id, ownGpu.id, "with fallback off it stays inside infrastructure the owner controls");
  assert.match(held.reason, /scores higher, but remote proprietary fallback is off/u);

  const offered = routeRequest(settings({ mode: "maximum-capability", remoteFallbackEnabled: true, endpoints: [offlineEndpoint(NOW), ownGpu, vendor] }), REQUEST);
  assert.equal(offered.endpoint?.id, vendor.id);
  assert.equal(offered.requiresApproval, true, "the strongest endpoint still needs approval when it is not yours");
  assert.equal(offered.requiresDisclosure, true);

  const onlyVendor = routeRequest(settings({ mode: "maximum-capability", endpoints: [vendor] }), REQUEST);
  assert.equal(onlyVendor.allowed, false);
  assert.match(onlyVendor.reason, /will not turn a capability preference into permission/u);
});

test("Manual uses the endpoint the owner named, or refuses and says why", () => {
  const ownGpu = endpoint({ label: "home GPU", capabilities: { reasoning: true } });
  const disabled = endpoint({ label: "spare box", enabled: false });

  const chosen = routeRequest(settings({ mode: "manual", manualEndpointId: ownGpu.id, endpoints: [offlineEndpoint(NOW), ownGpu] }), REQUEST);
  assert.equal(chosen.endpoint?.id, ownGpu.id);

  const unusable = routeRequest(settings({ mode: "manual", manualEndpointId: disabled.id, endpoints: [offlineEndpoint(NOW), disabled] }), REQUEST);
  assert.equal(unusable.allowed, false);
  assert.match(unusable.reason, /will not quietly use a different one, but it is turned off/u);

  const unset = routeRequest(settings({ mode: "manual", manualEndpointId: "" }), REQUEST);
  assert.equal(unset.allowed, false);
  assert.match(unset.reason, /AION will not choose for you/u);
});

test("a disclosure names the provider, the destination, the workspace, and what is included", () => {
  const vendor = endpoint({ location: "third-party-service", baseUrl: "https://api.invalid/v1", label: "vendor", model: "some-large-model" });
  const disclosure = describeDisclosure(vendor, {
    workspace: "work", workspaceLabel: "Bayfield Motors", needs: ["conversation"],
    includesMemory: true, includesWorkOrCustomerInformation: true,
    contextClasses: ["this conversation", "two Memory records"],
  });
  assert.equal(disclosure.ownerControlled, false);
  assert.equal(disclosure.destination, "https://api.invalid");
  assert.equal(disclosure.encrypted, true);
  assert.match(disclosure.statement, /third-party service/u);
  assert.match(disclosure.statement, /Workspace: Bayfield Motors/u);
  assert.match(disclosure.statement, /Your Memory records are included/u);
  assert.match(disclosure.statement, /Work or customer information is included/u);
  assert.match(disclosure.statement, /may retain, log, or train on what it receives/u);

  // The owner's own host still gets a disclosure: the prompt still travels somewhere.
  const own = describeDisclosure(endpoint({ label: "home GPU", baseUrl: "http://100.64.1.2:8000" }), REQUEST);
  assert.equal(own.ownerControlled, true);
  assert.match(own.statement, /infrastructure you control/u);
  assert.match(own.statement, /plain HTTP, so anything between here and there can read it/u);

  const local = describeDisclosure(offlineEndpoint(NOW), REQUEST);
  assert.match(local.statement, /Nothing leaves the machine/u);
});

test("an endpoint's declared location must match its address", () => {
  assert.equal(validateEndpointUrl("http://127.0.0.1:11434", "local-machine"), "http://127.0.0.1:11434/");
  assert.throws(() => validateEndpointUrl("https://gpu.invalid", "local-machine"), /must be on this computer/iu);
  assert.throws(() => validateEndpointUrl("http://127.0.0.1:1234", "third-party-service"), /cannot be loopback/iu);
  assert.throws(() => validateEndpointUrl("https://user:secret@gpu.invalid", "owner-controlled-host"), /environment variable, never in the endpoint address/iu);
  assert.throws(() => validateEndpointUrl("ws://gpu.invalid", "owner-controlled-host"), /must be http or https/iu);
});

test("AION stores the name of a credential variable and never a value", async () => {
  const service = await assistant();
  const added = await service.addBrainEndpoint({
    label: "Rented GPU", runtime: "vllm", location: "owner-controlled-host",
    baseUrl: "https://gpu.invalid", model: "open-weights-large",
    credentialEnvironmentVariable: "AION_GPU_TOKEN", hostLabel: "rented hourly",
    capabilities: { reasoning: true, code: true, structuredJson: true, contextTokens: 65_536 },
  });
  assert.equal(added.credentialEnvironmentVariable, "AION_GPU_TOKEN");

  const serialized = JSON.stringify(await service.snapshot());
  assert.equal(serialized.includes("AION_GPU_TOKEN"), true, "the name is stored so the owner can see what AION reads");
  assert.doesNotMatch(serialized, /"credential"\s*:\s*"[^"]+"/u, "no credential value field exists at all");

  await assert.rejects(() => service.addBrainEndpoint({ label: "Bad", runtime: "vllm", location: "owner-controlled-host", baseUrl: "https://gpu2.invalid", model: "m", credentialEnvironmentVariable: "not a variable name" }), /upper-case letters/iu);
});

test("removing an endpoint changes nothing AION knows", async () => {
  const service = await assistant();
  await service.createMemory({ content: "A durable fact the owner recorded", category: "semantic" });
  const added = await service.addBrainEndpoint({ label: "Rented GPU", runtime: "vllm", location: "owner-controlled-host", baseUrl: "https://gpu.invalid", model: "open-weights-large" });
  await service.updateBrainSettings({ primaryEndpointId: added.id });

  await service.removeBrainEndpoint(added.id);
  const after = await service.snapshot();
  assert.equal(after.memories.length, 1, "a model is a reasoning provider, not where information lives");
  assert.equal(after.brain.primaryEndpointId, OFFLINE_ENDPOINT_ID, "the primary falls back to the floor, not to nothing");
  assert.match(after.activity.find((entry) => entry.action === "brain.endpoint.remove")!.summary, /Nothing AION knows was affected/u);
});

test("the independence report answers the acceptance criterion against the real configuration", () => {
  const vendorOnly = settings({ endpoints: [endpoint({ location: "third-party-service", baseUrl: "https://api.invalid", label: "vendor" })] });
  const failing = independenceReport(vendorOnly);
  assert.equal(failing.independent, false);
  assert.match(failing.summary, /This is the state the model-independence requirement exists to prevent/u);

  const healthy = independenceReport(settings({ endpoints: [offlineEndpoint(NOW), endpoint({ label: "home GPU" }), endpoint({ location: "third-party-service", baseUrl: "https://api.invalid", label: "vendor" })] }));
  assert.equal(healthy.independent, true);
  assert.equal(healthy.ownerControlledEndpoints, 2);
  assert.equal(healthy.thirdPartyEndpoints, 1);
  assert.match(healthy.summary, /Delete every third-party credential and AION keeps working/u);
});

test("brain policy governs an ordinary chat turn, not only the Brain screen", async () => {
  const remote = new BoundaryModelProviderV1("remote-generic", "remote", "A remote boundary provider.");
  const service = await assistant([new DeterministicModelProviderV1(), remote]);
  const conversation = await service.createConversation("Policy check");

  // Offline by default: the local provider runs and nothing leaves the machine.
  const local = await service.chatDisclosure(conversation.id);
  assert.equal(local.allowed, true);
  assert.equal(local.requiresDisclosure, false);

  await service.updateSettings({ remoteDisclosureAccepted: true, providerId: "remote-generic" });
  const remoteDecision = await service.chatDisclosure(conversation.id);
  assert.equal(remoteDecision.allowed, true);
  assert.equal(remoteDecision.requiresDisclosure, true, "a remote provider always discloses");

  await service.updateBrainSettings({ mode: "local-only" });
  const refused = await service.chatDisclosure(conversation.id);
  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /Local Only is set and remote-generic is a third-party service/u);
  await assert.rejects(() => service.sendMessage(conversation.id, "Hello"), /Local Only is set/u);

  await service.updateBrainSettings({ mode: "local-preferred", offlineMode: true });
  await assert.rejects(() => service.sendMessage(conversation.id, "Hello"), /Local Only is set|offline/iu);
});

test("the brain boundary states that a model owns no history", () => {
  assert.deepEqual(BRAIN_BOUNDARY.modelOwns, []);
  assert.ok(BRAIN_BOUNDARY.aionOwns.includes("Memory"));
  assert.ok(BRAIN_BOUNDARY.aionOwns.includes("learned strategies"));
  assert.match(BRAIN_BOUNDARY.statement, /Replacing the model changes nothing AION knows/u);
});

test("routing mode changes are validated and recorded as the decisions they are", async () => {
  const service = await assistant();
  await assert.rejects(() => service.updateBrainSettings({ mode: "whatever-is-fastest" }), /Routing mode must be one of/iu);
  await assert.rejects(() => service.updateBrainSettings({ mode: "manual" }), /Manual mode needs an endpoint/iu);
  await assert.rejects(() => service.updateBrainSettings({ primaryEndpointId: "no-such-endpoint" }), /was not found/iu);

  await service.updateBrainSettings({ remoteFallbackEnabled: true });
  const recorded = (await service.snapshot()).activity.find((entry) => entry.action === "brain.settings");
  assert.match(recorded!.summary, /Remote proprietary fallback is ON/u);
});
