import assert from "node:assert/strict";
import test from "node:test";
import {
  OwnerAuthorizationUi,
  envelopeDigest,
  attachApproval,
  parseCapabilityEnvelope,
} from "../src/index.js";
import {
  tempStore,
  syntheticHost,
  sampleEnvelope,
  approveAndRun,
} from "./helpers.js";

test("GROK_BUILD positive mediated path", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", [
      "repo.read",
      "repo.edit",
      "test.run",
      "npm.run",
      "git.status",
      "git.stage",
      "git.commit_forward",
      "git.push_canonical",
      "temp.create",
      "handoff.write",
    ]);
    const { sessionId, authorizationId } = approveAndRun(host, env);
    for (const op of [
      "repo.read",
      "repo.edit",
      "test.run",
      "git.stage",
      "git.commit_forward",
      "git.push_canonical",
      "temp.create",
      "handoff.write",
    ] as const) {
      const { decision, effect } = host.executeMediatedForTests(
        sessionId,
        op,
        "GROK_BUILD",
        authorizationId,
        env.repositoryRoot,
      );
      assert.equal(decision.outcome, "ALLOW", op);
      assert.notEqual(effect, "none", op);
    }
    host.complete(authorizationId);
    assert.equal(host.getStore().get(authorizationId)?.lifecycle, "AWAITING_REVIEW");
  } finally {
    cleanup();
  }
});

test("CLAUDE_AUDITOR positive read/test/temp/handoff", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("CLAUDE_AUDITOR", [
      "repo.read",
      "test.run",
      "npm.run",
      "docker.test",
      "git.status",
      "temp.create",
      "handoff.write",
      "host.read",
    ]);
    const { sessionId, authorizationId } = approveAndRun(host, env);
    for (const op of ["repo.read", "test.run", "docker.test", "temp.create", "handoff.write", "host.read"] as const) {
      const { decision } = host.executeMediatedForTests(
        sessionId,
        op,
        "CLAUDE_AUDITOR",
        authorizationId,
        env.repositoryRoot,
      );
      assert.equal(decision.outcome, "ALLOW", op);
    }
  } finally {
    cleanup();
  }
});

test("reboot resume exact authority", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read", "host.reboot"], { allowReboot: true });
    const { authorizationId, sessionId } = approveAndRun(host, env);
    const token = host.beginReboot(authorizationId);
    assert.equal(host.getStore().get(authorizationId)?.lifecycle, "REBOOT_PENDING");
    host.resumeAfterReboot(token, authorizationId);
    assert.equal(host.getStore().get(authorizationId)?.lifecycle, "RUNNING");
    const d = host.request(sessionId, {
      authorizationId,
      agentRole: "GROK_BUILD",
      operation: "repo.read",
      repositoryRoot: env.repositoryRoot,
      args: {},
    });
    // session still bound in process memory after reboot simulation
    assert.equal(d.outcome, "ALLOW");
  } finally {
    cleanup();
  }
});

test("Owner UI synthetic authorize via loopback", async () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    const ui = new OwnerAuthorizationUi({
      host,
      getPendingEnvelope: (id) => {
        const rec = host.getStore().get(id);
        return rec?.lifecycle === "PENDING_OWNER_AUTHORIZATION" ? rec.envelope : null;
      },
    });
    const { baseUrl } = await ui.listenLoopbackOnly();
    try {
      const page = await fetch(`${baseUrl}/authorize?authorizationId=${env.authorizationId}`);
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.match(html, /AION MILESTONE AUTHORIZATION/);
      assert.match(html, new RegExp(envelopeDigest(env)));
      assert.match(html, /INACTIVE MODE/);
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
      const digestField = /name="envelopeDigest" value="([^"]+)"/.exec(html)?.[1];
      const nonceField = /name="approvalNonce" value="([^"]+)"/.exec(html)?.[1];
      assert.ok(csrf);
      assert.ok(digestField);
      assert.ok(nonceField);
      const res = await fetch(`${baseUrl}/decision`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "http://127.0.0.1",
        },
        body: `csrf=${csrf}&authorizationId=${env.authorizationId}&envelopeDigest=${digestField}&approvalNonce=${nonceField}&decision=AUTHORIZE`,
      });
      const body = await res.json() as { ok: boolean; realApprovalRootActivated: boolean };
      assert.equal(res.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.realApprovalRootActivated, false);
      assert.equal(host.getStore().get(env.authorizationId)?.lifecycle, "AUTHORIZED");
    } finally {
      await ui.close();
    }
  } finally {
    cleanup();
  }
});

test("proof binds to exact digest only", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    const approved = attachApproval(env, presence, new Date().toISOString());
    assert.ok(presence.verify(envelopeDigest(approved), approved.approvalProof!));
    const other = sampleEnvelope("GROK_BUILD", ["repo.read", "test.run"]);
    assert.equal(presence.verify(envelopeDigest(other), approved.approvalProof!), false);
  } finally {
    cleanup();
  }
});

test("parse rejects unsupported schema version", () => {
  const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
  assert.throws(
    () => parseCapabilityEnvelope({ ...env, schemaVersion: "v999" }),
    /Unsupported envelope schema/,
  );
});
