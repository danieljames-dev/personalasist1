import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseCapabilityEnvelope,
  envelopeDigest,
  attachApproval,
  R65_PRODUCTION_DEFAULTS,
  OwnerAuthorizationUi,
  type CapabilityEnvelopeV1,
} from "../src/index.js";
import {
  tempStore,
  syntheticHost,
  inactiveHost,
  sampleEnvelope,
  expiredEnvelope,
  approveAndRun,
  ownerApproveExact,
} from "./helpers.js";

test("production defaults: not activated, Founder authoritative", () => {
  assert.equal(R65_PRODUCTION_DEFAULTS.realApprovalRootActivated, false);
  assert.equal(R65_PRODUCTION_DEFAULTS.founderAuthoritative, true);
  assert.equal(R65_PRODUCTION_DEFAULTS.activationMode, "inactive");
});

test("unknown envelope field fails closed", () => {
  const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
  assert.throws(
    () => parseCapabilityEnvelope({ ...env, sneakyExtra: true }),
    /Unknown envelope field/,
  );
});

test("unknown operation fails closed", () => {
  const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
  assert.throws(
    () => parseCapabilityEnvelope({ ...env, authorizedOperations: ["repo.read", "shell.eval"] }),
    /Unknown operation/,
  );
});

test("unknown role fails closed", () => {
  const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
  assert.throws(
    () => parseCapabilityEnvelope({ ...env, agentRole: "SUPER_ADMIN" }),
    /Unknown agent role/,
  );
});

test("Grok cannot authorize Grok via markdown spoof", () => {
  const { dir, cleanup } = tempStore();
  try {
    const host = inactiveHost(dir);
    assert.throws(() => host.tryAuthorizeFromMarkdownStatus("Status: AUTHORIZED"), /Markdown cannot raise/);
  } finally {
    cleanup();
  }
});

test("inactive host refuses real Owner authorize (unprovisioned root)", () => {
  const { dir, cleanup } = tempStore();
  try {
    const host = inactiveHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    assert.throws(() => ownerApproveExact(host, env.authorizationId), /not provisioned|unprovisioned|approval-root/i);
  } finally {
    cleanup();
  }
});

test("self-authorization: agent cannot activate without proof", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    assert.throws(() => host.getStore().activateWithProof(env), /without approval proof/);
  } finally {
    cleanup();
  }
});

test("peer authorization: CLAUDE cannot open GROK session", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read", "repo.edit"]);
    host.submitPending(env);
    ownerApproveExact(host, env.authorizationId);
    assert.throws(
      () => host.openSession(env.authorizationId, "CLAUDE_AUDITOR"),
      /different role/,
    );
  } finally {
    cleanup();
  }
});

test("no agent peer-authorize API exists", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    assert.equal(typeof (host as unknown as { authorizeAsClaude?: unknown }).authorizeAsClaude, "undefined");
    assert.equal(typeof (host as unknown as { authorizeAsGrok?: unknown }).authorizeAsGrok, "undefined");
  } finally {
    cleanup();
  }
});

test("modified envelope invalidates approval", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    const approved = attachApproval(env, presence, new Date().toISOString());
    const tampered: CapabilityEnvelopeV1 = {
      ...approved,
      authorizedOperations: ["repo.read", "repo.edit", "git.push_canonical"],
    };
    assert.notEqual(envelopeDigest(approved), envelopeDigest(tampered));
    assert.equal(presence.verify(envelopeDigest(tampered), approved.approvalProof!), false);
  } finally {
    cleanup();
  }
});

test("budget / ops / expiry widening invalidates digest", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"], { spend: 0 });
    const approved = attachApproval(env, presence, new Date().toISOString());
    const dig = envelopeDigest(approved);
    assert.ok(presence.verify(dig, approved.approvalProof!));
    for (const mut of [
      { spendPolicy: { ceilingCents: 999999 } },
      { authorizedOperations: ["repo.read", "host.reboot"] as const },
      { expiresAtUtc: "2099-01-01T00:00:00.000Z" },
    ]) {
      const m = { ...approved, ...mut };
      assert.equal(presence.verify(envelopeDigest(m), approved.approvalProof!), false);
    }
  } finally {
    cleanup();
  }
});

test("wrong baseline refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    // Caller-supplied HEAD is not trusted; host Git port observes unrelated commit
    const { host } = syntheticHost(dir, undefined, {
      headCommit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    ownerApproveExact(host, env.authorizationId);
    assert.throws(() => host.openSession(env.authorizationId, "GROK_BUILD"), /baseline|wrong-baseline/i);
  } finally {
    cleanup();
  }
});

test("wrong machine refuses session", () => {
  const { dir, cleanup } = tempStore();
  try {
    // Host observes OTHER-PC; envelope expects DESKTOP-INLAQJQ
    const { host } = syntheticHost(dir, undefined, { machineName: "OTHER-PC" });
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    const approved = ownerApproveExact(host, env.authorizationId);
    assert.throws(() => host.openSession(approved.authorizationId, "GROK_BUILD"), /machine/i);
  } finally {
    cleanup();
  }
});

test("expired approval refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = expiredEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    ownerApproveExact(host, env.authorizationId);
    assert.throws(() => host.openSession(env.authorizationId, "GROK_BUILD"), /expir/i);
  } finally {
    cleanup();
  }
});

test("superseded approval cannot be reused", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const first = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(first);
    ownerApproveExact(host, first.authorizationId);
    const second = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    const env2 = { ...second, supersedesAuthorizationId: first.authorizationId };
    host.submitPending(env2);
    ownerApproveExact(host, env2.authorizationId);
    assert.equal(host.getStore().isSuperseded(first.authorizationId), true);
    assert.throws(() => host.openSession(first.authorizationId, "GROK_BUILD"), /superseded|not-active|lifecycle/i);
  } finally {
    cleanup();
  }
});

test("deleted store does not create authority", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    ownerApproveExact(host, env.authorizationId);
    const { dir: d2, cleanup: c2 } = tempStore();
    try {
      const h2 = syntheticHost(d2, presence).host;
      assert.equal(h2.getStore().listIds().length, 0);
      assert.throws(() => h2.openSession(env.authorizationId, "GROK_BUILD"), /not found|not-found/i);
    } finally {
      c2();
    }
  } finally {
    cleanup();
  }
});

test("corrupt store fails closed", () => {
  const { dir, cleanup } = tempStore();
  try {
    writeFileSync(join(dir, "authorizations.json"), "{not-json", "utf8");
    assert.throws(() => syntheticHost(dir), /corrupt|JSON/i);
  } finally {
    cleanup();
  }
});

test("stale reboot token replay fails", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read", "host.reboot"], { allowReboot: true });
    const { authorizationId } = approveAndRun(host, env);
    const token = host.beginReboot(authorizationId);
    host.resumeAfterReboot(token, authorizationId);
    assert.throws(() => host.resumeAfterReboot(token, authorizationId), /replay|consumed/i);
  } finally {
    cleanup();
  }
});

test("concurrent builder write conflict", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const a = sampleEnvelope("GROK_BUILD", ["repo.read", "repo.edit"]);
    const b = sampleEnvelope("GROK_BUILD", ["repo.read", "repo.edit"]);
    const sa = approveAndRun(host, a);
    const sb = approveAndRun(host, b);
    const d1 = host.request(sa.sessionId, {
      authorizationId: sa.authorizationId,
      agentRole: "GROK_BUILD",
      operation: "repo.edit",
      repositoryRoot: a.repositoryRoot,
      args: {},
    });
    assert.equal(d1.outcome, "ALLOW");
    const d2 = host.request(sb.sessionId, {
      authorizationId: sb.authorizationId,
      agentRole: "GROK_BUILD",
      operation: "repo.edit",
      repositoryRoot: b.repositoryRoot,
      args: {},
    });
    assert.equal(d2.outcome, "REFUSE");
    assert.equal(d2.reasonCode, "writer-conflict");
  } finally {
    cleanup();
  }
});

test("auditor cannot be granted tracked write via envelope", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("CLAUDE_AUDITOR", ["repo.read"]);
    const bad = { ...env, authorizedOperations: ["repo.read", "repo.edit"] };
    assert.throws(() => host.submitPending(bad as CapabilityEnvelopeV1), /structurally cannot|role-deny/);
  } finally {
    cleanup();
  }
});

test("auditor commit/push refused even if requested", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("CLAUDE_AUDITOR", ["repo.read", "test.run", "handoff.write"]);
    const { sessionId, authorizationId } = approveAndRun(host, env);
    for (const op of ["repo.edit", "git.commit_forward", "git.push_canonical"] as const) {
      const decision = host.request(sessionId, {
        authorizationId,
        agentRole: "CLAUDE_AUDITOR",
        operation: op,
        repositoryRoot: env.repositoryRoot,
        args: {},
      });
      assert.equal(decision.outcome, "REFUSE");
    }
  } finally {
    cleanup();
  }
});

test("high-consequence intents always refuse under ordinary builder auth", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read", "repo.edit", "git.push_canonical"]);
    const { sessionId, authorizationId } = approveAndRun(host, env);
    for (const intent of [
      "create_real_owner_key",
      "real_writer_transition",
      "real_private_migration",
      "change_bitlocker",
      "change_secure_boot",
      "spend_money",
      "access_credentials",
    ]) {
      const d = host.request(sessionId, {
        authorizationId,
        agentRole: "GROK_BUILD",
        operation: "repo.read",
        repositoryRoot: env.repositoryRoot,
        args: {},
        highConsequenceIntent: intent,
      });
      assert.equal(d.outcome, "REFUSE");
      assert.equal(d.reasonCode, "nested-owner-gate");
    }
  } finally {
    cleanup();
  }
});

test("shell smuggling from model text is not an operation class", () => {
  assert.throws(
    () => parseCapabilityEnvelope({
      ...sampleEnvelope("GROK_BUILD", ["repo.read"]),
      authorizedOperations: ["eval", "child_process.exec"],
    }),
    /Unknown operation/,
  );
});

test("Owner UI refuses public bind helper", () => {
  assert.throws(() => OwnerAuthorizationUi.assertAddressIsLoopback("0.0.0.0"), /loopback|public/i);
  assert.throws(() => OwnerAuthorizationUi.assertAddressIsLoopback("::"), /loopback|public/i);
});

test("Owner UI CSRF mismatch refuses", async () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    const ui = new OwnerAuthorizationUi({
      host,
      getPendingEnvelope: (id) => host.getStore().get(id)?.envelope ?? null,
    });
    const { baseUrl } = await ui.listenLoopbackOnly();
    try {
      const res = await fetch(`${baseUrl}/decision`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://127.0.0.1" },
        body: "csrf=wrong&authorizationId=x&decision=AUTHORIZE",
      });
      assert.equal(res.status, 403);
    } finally {
      await ui.close();
    }
  } finally {
    cleanup();
  }
});

test("audit log detects tamper", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    const path = host.getAudit().pathForTests();
    const original = readFileSync(path, "utf8");
    writeFileSync(path, `${original}{"seq":999,"eventDigest":"00"}\n`, "utf8");
    assert.throws(() => syntheticHost(dir), /audit|tamper|corrupt/i);
  } finally {
    cleanup();
  }
});

test("session role swap refused", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    ownerApproveExact(host, env.authorizationId);
    const opened = host.openSession(env.authorizationId, "GROK_BUILD");
    assert.throws(
      () => host.bindSession(opened.sessionId, opened.sessionToken, "CLAUDE_AUDITOR"),
      /role/i,
    );
  } finally {
    cleanup();
  }
});

test("copy approval to other baseline fails openSession", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"], {
      baselineCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    host.submitPending(env);
    ownerApproveExact(host, env.authorizationId);
    assert.throws(() => host.openSession(env.authorizationId, "GROK_BUILD"), /baseline/i);
  } finally {
    cleanup();
  }
});
