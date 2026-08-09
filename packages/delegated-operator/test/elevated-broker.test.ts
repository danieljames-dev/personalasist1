import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  ElevatedOperatorBroker,
  createSyntheticActivatedBroker,
  BrokerPipeFraming,
  BROKER_DEFAULTS,
  parseElevatedBrokerRequest,
  BROKER_SCHEMA_VERSION,
  type ElevatedBrokerRequestV1,
  ManifestBrokerIntegrityPort,
  StaticHostFactsPort,
  StaticRepositoryFactsPort,
  StaticGitFactsPort,
} from "../src/index.js";
import {
  tempStore,
  syntheticHost,
  sampleEnvelope,
  expiredEnvelope,
  approveAndRun,
  ownerApproveExact,
  BASELINE,
  MACHINE,
  ROLE,
  REPO,
  ORIGIN,
} from "./helpers.js";

function baseRequest(
  authorizationId: string,
  envelopeDigest: string,
  operation: ElevatedBrokerRequestV1["operation"],
  extra?: Partial<ElevatedBrokerRequestV1>,
): ElevatedBrokerRequestV1 {
  return {
    schemaVersion: BROKER_SCHEMA_VERSION,
    requestId: randomBytes(8).toString("hex"),
    authorizationId,
    agentRole: "GROK_BUILD",
    operation,
    repositoryRoot: REPO,
    machineName: MACHINE,
    args: {},
    envelopeDigest,
    requestedAtUtc: new Date().toISOString(),
    ...extra,
  };
}

function synthBroker(
  dir: string,
  presence: Parameters<typeof createSyntheticActivatedBroker>[0]["presence"],
  loadEnvelope: (id: string) => import("../src/index.js").CapabilityEnvelopeV1 | null,
  extra?: Partial<Parameters<typeof createSyntheticActivatedBroker>[0]>,
) {
  return createSyntheticActivatedBroker({
    presence,
    machineName: MACHINE,
    machineRole: ROLE,
    loadEnvelope,
    headCommit: BASELINE,
    repositoryRoot: REPO,
    canonicalOrigin: ORIGIN,
    replayStateDir: dir,
    ...extra,
  });
}

test("broker defaults: not installed/activated, no UAC disable, no password store", () => {
  assert.equal(BROKER_DEFAULTS.installed, false);
  assert.equal(BROKER_DEFAULTS.activated, false);
  assert.equal(BROKER_DEFAULTS.uacDisabled, false);
  assert.equal(BROKER_DEFAULTS.ownerPasswordStored, false);
  assert.equal(BROKER_DEFAULTS.arbitraryElevatedPowerShellExposed, false);
  assert.equal(BROKER_DEFAULTS.unattendedRoutineElevationAfterFutureActivation, true);
});

test("1 authorized elevated op succeeds without interactive UAC in synthetic activated broker", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.read", "host.reboot"], { allowReboot: true });
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const broker = synthBroker(dir, presence, (id) => host.getStore().get(id)?.envelope ?? null, {
      isSuperseded: (id) => host.getStore().isSuperseded(id),
    });
    const d = broker.handle(baseRequest(authorizationId, rec.envelopeDigest, "host.read_security"));
    assert.equal(d.outcome, "ALLOW");
    assert.equal(d.executed, true);
    assert.equal(d.wouldRequireInteractiveUacIfNotBrokerElevated, true);
  } finally {
    cleanup();
  }
});

test("2 without envelope refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { presence } = syntheticHost(dir);
    const broker = synthBroker(dir, presence, () => null);
    const d = broker.handle(baseRequest("missing", "0".repeat(64), "host.read_security"));
    assert.equal(d.outcome, "REFUSE");
  } finally {
    cleanup();
  }
});

test("3 expired envelope refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = expiredEnvelope("GROK_BUILD", ["host.read"]);
    host.submitPending(env);
    ownerApproveExact(host, env.authorizationId);
    const rec = host.getStore().get(env.authorizationId)!;
    const broker = synthBroker(dir, presence, (id) => host.getStore().get(id)?.envelope ?? null);
    const d = broker.handle(baseRequest(env.authorizationId, rec.envelopeDigest, "host.read_security"));
    assert.equal(d.outcome, "REFUSE");
  } finally {
    cleanup();
  }
});

test("4 superseded envelope refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const first = sampleEnvelope("GROK_BUILD", ["host.read"]);
    host.submitPending(first);
    ownerApproveExact(host, first.authorizationId);
    const second = { ...sampleEnvelope("GROK_BUILD", ["host.read"]), supersedesAuthorizationId: first.authorizationId };
    host.submitPending(second);
    ownerApproveExact(host, second.authorizationId);
    const rec = host.getStore().get(first.authorizationId)!;
    const broker = synthBroker(dir, presence, (id) => host.getStore().get(id)?.envelope ?? null, {
      isSuperseded: (id) => host.getStore().isSuperseded(id),
    });
    const d = broker.handle(baseRequest(first.authorizationId, rec.envelopeDigest, "host.read_security"));
    assert.equal(d.outcome, "REFUSE");
  } finally {
    cleanup();
  }
});

test("5 wrong agent role refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const broker = synthBroker(dir, presence, (id) => host.getStore().get(id)?.envelope ?? null);
    const d = broker.handle(
      baseRequest(authorizationId, rec.envelopeDigest, "host.read_security", { agentRole: "CLAUDE_AUDITOR" }),
    );
    assert.equal(d.outcome, "REFUSE");
  } finally {
    cleanup();
  }
});

test("6 wrong machine refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const broker = synthBroker(dir, presence, (id) => host.getStore().get(id)?.envelope ?? null, {
      machineName: "OTHER-PC",
    });
    const d = broker.handle(baseRequest(authorizationId, rec.envelopeDigest, "host.read_security"));
    assert.equal(d.outcome, "REFUSE");
  } finally {
    cleanup();
  }
});

test("7 wrong repository refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const broker = synthBroker(dir, presence, (id) => host.getStore().get(id)?.envelope ?? null);
    const d = broker.handle(
      baseRequest(authorizationId, rec.envelopeDigest, "host.read_security", {
        repositoryRoot: "C:\\OTHER",
      }),
    );
    assert.equal(d.outcome, "REFUSE");
  } finally {
    cleanup();
  }
});

test("8 modified arguments after approval / digest mismatch refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const broker = synthBroker(dir, presence, (id) => host.getStore().get(id)?.envelope ?? null);
    const d = broker.handle(baseRequest(authorizationId, "ff".repeat(32), "host.read_security"));
    assert.equal(d.outcome, "REFUSE");
    assert.match(d.reasonCode, /tamper|digest/i);
  } finally {
    cleanup();
  }
});

test("9-12 arbitrary PowerShell / EncodedCommand / cmd / executable refuse", () => {
  assert.throws(
    () =>
      parseElevatedBrokerRequest({
        schemaVersion: BROKER_SCHEMA_VERSION,
        requestId: "1",
        authorizationId: "a",
        agentRole: "GROK_BUILD",
        operation: "host.read_security",
        repositoryRoot: REPO,
        machineName: MACHINE,
        args: { cmd: "powershell.exe -Command Get-Process" },
        envelopeDigest: "00".repeat(32),
        requestedAtUtc: new Date().toISOString(),
      }),
    /shell|forbidden/i,
  );
  assert.throws(
    () =>
      parseElevatedBrokerRequest({
        schemaVersion: BROKER_SCHEMA_VERSION,
        requestId: "1",
        authorizationId: "a",
        agentRole: "GROK_BUILD",
        operation: "host.read_security",
        repositoryRoot: REPO,
        machineName: MACHINE,
        args: { x: "powershell.exe -EncodedCommand AAAA" },
        envelopeDigest: "00".repeat(32),
        requestedAtUtc: new Date().toISOString(),
      }),
    /shell|forbidden/i,
  );
  assert.throws(
    () =>
      parseElevatedBrokerRequest({
        schemaVersion: BROKER_SCHEMA_VERSION,
        requestId: "1",
        authorizationId: "a",
        agentRole: "GROK_BUILD",
        operation: "not.a.real.op",
        repositoryRoot: REPO,
        machineName: MACHINE,
        args: {},
        envelopeDigest: "00".repeat(32),
        requestedAtUtc: new Date().toISOString(),
      }),
    /Unknown broker operation/,
  );
});

test("13 model/chat injection cannot invent broker operation classes", () => {
  assert.throws(
    () =>
      parseElevatedBrokerRequest({
        schemaVersion: BROKER_SCHEMA_VERSION,
        requestId: "1",
        authorizationId: "a",
        agentRole: "GROK_BUILD",
        operation: "eval",
        repositoryRoot: REPO,
        machineName: MACHINE,
        args: {},
        envelopeDigest: "00".repeat(32),
        requestedAtUtc: new Date().toISOString(),
      }),
    /Unknown/,
  );
});

test("14 CLAUDE_AUDITOR cannot request builder mutation elevated ops", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("CLAUDE_AUDITOR", ["host.read", "repo.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const broker = synthBroker(dir, presence, (id) => host.getStore().get(id)?.envelope ?? null);
    const d = broker.handle(
      baseRequest(authorizationId, rec.envelopeDigest, "filesystem.authorized_admin_write", {
        agentRole: "CLAUDE_AUDITOR",
      }),
    );
    assert.equal(d.outcome, "REFUSE");
  } finally {
    cleanup();
  }
});

test("15 high-consequence BitLocker refuses under ordinary builder envelope", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.read", "host.reboot", "powershell.repo_operation"], {
      allowReboot: true,
    });
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const broker = synthBroker(dir, presence, (id) => host.getStore().get(id)?.envelope ?? null);
    const d = broker.handle(
      baseRequest(authorizationId, rec.envelopeDigest, "host.read_security", {
        highConsequenceIntent: "bitlocker",
      }),
    );
    assert.equal(d.outcome, "REFUSE");
    assert.equal(d.reasonCode, "high-consequence");
  } finally {
    cleanup();
  }
});

test("16-17 broker config/binary modification refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["powershell.repo_operation", "host.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const broker = synthBroker(dir, presence, (id) => host.getStore().get(id)?.envelope ?? null);
    const d = broker.handle(
      baseRequest(authorizationId, rec.envelopeDigest, "filesystem.authorized_admin_write", {
        args: { path: "C:\\Program Files\\AION\\ElevatedOperatorBroker\\bin\\aion-elevated-broker.exe" },
      }),
    );
    assert.equal(d.outcome, "REFUSE");
    assert.match(d.reasonCode, /protected-install-root|broker-protected|role|not-authorized|host/i);
  } finally {
    cleanup();
  }
});

test("18 stale request replay refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const broker = synthBroker(dir, presence, (id) => host.getStore().get(id)?.envelope ?? null);
    const req = baseRequest(authorizationId, rec.envelopeDigest, "host.read_security");
    assert.equal(broker.handle(req).outcome, "ALLOW");
    const d2 = broker.handle(req);
    assert.equal(d2.outcome, "REFUSE");
    assert.equal(d2.reasonCode, "replay");
  } finally {
    cleanup();
  }
});

test("19 authorized reboot operation can complete autonomously in synthetic broker", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.reboot", "host.read"], { allowReboot: true });
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const broker = synthBroker(dir, presence, (id) => host.getStore().get(id)?.envelope ?? null);
    const d = broker.handle(baseRequest(authorizationId, rec.envelopeDigest, "host.reboot"));
    assert.equal(d.outcome, "ALLOW");
    assert.equal(d.executed, true);
  } finally {
    cleanup();
  }
});

test("20 inactive/not-activated broker refuses (no authority from missing activation)", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const integrity = new ManifestBrokerIntegrityPort({ synthetic: "x" }, () => ({ synthetic: "x" }));
    const broker = new ElevatedOperatorBroker({
      brokerVersion: "0.1.0",
      activated: false,
      installed: false,
      presence,
      hostFacts: new StaticHostFactsPort({ machineName: MACHINE, machineRole: ROLE }),
      repositoryFacts: new StaticRepositoryFactsPort({
        repositoryRoot: REPO,
        canonicalOrigin: ORIGIN,
        branch: "main",
        headCommit: BASELINE,
      }),
      gitFacts: new StaticGitFactsPort({
        repositoryRoot: REPO,
        headCommit: BASELINE,
        branch: "main",
        canonicalOrigin: ORIGIN,
        originMainCommit: BASELINE,
        workingTreeClean: true,
      }),
      integrity,
      replayStateDir: dir,
      loadEnvelope: (id) => host.getStore().get(id)?.envelope ?? null,
    });
    const d = broker.handle(baseRequest(authorizationId, rec.envelopeDigest, "host.read_security"));
    assert.equal(d.outcome, "REFUSE");
    assert.equal(d.reasonCode, "not-activated");
  } finally {
    cleanup();
  }
});

test("pipe framing MAC prevents bare blob reuse without session key", () => {
  const key = randomBytes(32);
  const framing = new BrokerPipeFraming(key);
  const req = baseRequest("auth", "aa".repeat(32), "broker.self_status");
  const sealed = framing.seal(req);
  const opened = framing.open(sealed);
  assert.equal(opened.authorizationId, "auth");
  const other = new BrokerPipeFraming(randomBytes(32));
  assert.throws(() => other.open(sealed), /MAC|pipe/i);
});

test("broker integrity fail-closed on expected/actual mismatch", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { presence } = syntheticHost(dir);
    const integrity = new ManifestBrokerIntegrityPort({ synthetic: "good" }, () => ({ synthetic: "bad" }));
    const broker = new ElevatedOperatorBroker({
      brokerVersion: "0.1.0",
      activated: true,
      installed: false,
      presence,
      hostFacts: new StaticHostFactsPort({ machineName: MACHINE, machineRole: ROLE }),
      repositoryFacts: new StaticRepositoryFactsPort({
        repositoryRoot: REPO,
        canonicalOrigin: ORIGIN,
        branch: "main",
        headCommit: BASELINE,
      }),
      gitFacts: new StaticGitFactsPort({
        repositoryRoot: REPO,
        headCommit: BASELINE,
        branch: "main",
        canonicalOrigin: ORIGIN,
        originMainCommit: BASELINE,
        workingTreeClean: true,
      }),
      integrity,
      replayStateDir: dir,
      loadEnvelope: () => null,
    });
    assert.throws(() => broker.verifyIntegrity(), /integrity/i);
  } finally {
    cleanup();
  }
});

test("service account recommendation is not LocalSystem by default", () => {
  const rec = ElevatedOperatorBroker.recommendedServiceAccount();
  assert.equal(rec.notLocalSystemUnlessRequired, true);
  assert.match(rec.account, /SERVICE|Virtual/i);
});
