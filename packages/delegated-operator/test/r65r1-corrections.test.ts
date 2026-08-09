/**
 * R6.5-R1 activation-blocker corrections — focused adversarial + positive proofs.
 * REQUEST-SUPPLIED FACTS ARE NEVER TRUSTED OBSERVATIONS.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  parseCapabilityEnvelope,
  isExpired,
  OwnerAuthorizationUi,
  envelopeDigest,
  ElevatedOperatorBroker,
  createSyntheticActivatedBroker,
  BROKER_SCHEMA_VERSION,
  DurableReplayStore,
  ManifestBrokerIntegrityPort,
  StaticHostFactsPort,
  StaticRepositoryFactsPort,
  StaticGitFactsPort,
  ExecGitFactsPort,
  isPathUnderProtectedRoot,
  planProtectedInstallCopy,
  DEFAULT_PROTECTED_INSTALL_LAYOUT,
  digestsMatch,
  type ElevatedBrokerRequestV1,
} from "../src/index.js";
import {
  tempStore,
  syntheticHost,
  sampleEnvelope,
  approveAndRun,
  BASELINE,
  MACHINE,
  ROLE,
  REPO,
  ORIGIN,
} from "./helpers.js";

function baseBrokerReq(
  authorizationId: string,
  digest: string,
  operation: ElevatedBrokerRequestV1["operation"] = "host.read_security",
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
    envelopeDigest: digest,
    requestedAtUtc: new Date().toISOString(),
    ...extra,
  };
}

// ─── M-1 Host / repo / origin binding ───────────────────────────────────────

test("M-1: envelope wrong-repo is refused when host observes different root", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir); // observes C:\AION-HQ
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"], {
      repositoryRoot: "C:\\TOTALLY-OTHER-REPO",
    });
    host.submitPending(env);
    host.ownerAuthorize(env.authorizationId);
    assert.throws(() => host.openSession(env.authorizationId, "GROK_BUILD"), /wrong-repo|Repository root/i);
  } finally {
    cleanup();
  }
});

test("M-1: envelope wrong-origin is refused when host observes canonical origin", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir); // observes ORIGIN
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"], {
      canonicalOrigin: "https://evil.example/x.git",
    });
    host.submitPending(env);
    host.ownerAuthorize(env.authorizationId);
    assert.throws(() => host.openSession(env.authorizationId, "GROK_BUILD"), /wrong-origin|origin/i);
  } finally {
    cleanup();
  }
});

test("M-1 positive: matching host observations allow session", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    const { sessionId, authorizationId } = approveAndRun(host, env);
    const d = host.request(sessionId, {
      authorizationId,
      agentRole: "GROK_BUILD",
      operation: "repo.read",
      repositoryRoot: REPO,
      args: {},
    });
    assert.equal(d.outcome, "ALLOW");
  } finally {
    cleanup();
  }
});

// ─── M-2 Strict expiry ──────────────────────────────────────────────────────

test("M-2: malformed expiresAtUtc refuses at parse (not unlimited)", () => {
  const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
  assert.throws(
    () => parseCapabilityEnvelope({ ...env, expiresAtUtc: "not-a-date" }),
    /invalid-timestamp|canonical UTC/i,
  );
  assert.throws(
    () => parseCapabilityEnvelope({ ...env, expiresAtUtc: "2026-08-09T12:00:00+00:00" }),
    /invalid-timestamp|canonical UTC/i,
  );
  assert.throws(
    () => parseCapabilityEnvelope({ ...env, issuedAtUtc: "garbage", expiresAtUtc: env.expiresAtUtc }),
    /invalid-timestamp|canonical UTC|issuedAtUtc/i,
  );
});

test("M-2: expires before issued refuses", () => {
  const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
  const issued = new Date().toISOString();
  const earlier = new Date(Date.now() - 60_000).toISOString();
  assert.throws(
    () => parseCapabilityEnvelope({ ...env, issuedAtUtc: issued, expiresAtUtc: earlier }),
    /invalid-timestamp|strictly after/i,
  );
});

test("M-2 positive: isExpired true after expiry; false before", () => {
  const issued = new Date(Date.now() - 120_000).toISOString();
  const expires = new Date(Date.now() + 60_000).toISOString();
  const env = sampleEnvelope("GROK_BUILD", ["repo.read"], { issuedAtUtc: issued, expiresAtUtc: expires });
  assert.equal(isExpired(env, new Date().toISOString()), false);
  assert.equal(isExpired(env, new Date(Date.now() + 120_000).toISOString()), true);
});

// ─── M-3 Broker integrity ───────────────────────────────────────────────────

test("M-3: self-referential integrityMaterial is not sufficient — port mismatch refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    // Caller cannot supply both expected and observed: integrity port measures independently
    const integrity = new ManifestBrokerIntegrityPort(
      { binary: "aa".repeat(32) },
      () => ({ binary: "bb".repeat(32) }),
    );
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
      loadEnvelope: (id) => host.getStore().get(id)?.envelope ?? null,
    });
    const d = broker.handle(baseBrokerReq(authorizationId, rec.envelopeDigest));
    assert.equal(d.outcome, "REFUSE");
    assert.equal(d.reasonCode, "broker-integrity");
    assert.equal(d.executed, false);
  } finally {
    cleanup();
  }
});

test("M-3 positive: matching integrity allows activated synthetic broker", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const broker = createSyntheticActivatedBroker({
      presence,
      machineName: MACHINE,
      machineRole: ROLE,
      loadEnvelope: (id) => host.getStore().get(id)?.envelope ?? null,
      headCommit: BASELINE,
      replayStateDir: dir,
    });
    const d = broker.handle(baseBrokerReq(authorizationId, rec.envelopeDigest));
    assert.equal(d.outcome, "ALLOW");
  } finally {
    cleanup();
  }
});

// ─── M-4 Protected install architecture ─────────────────────────────────────

test("M-4: write-capable ops to Program Files broker root refuse (any elevated write op)", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["powershell.repo_operation", "host.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const broker = createSyntheticActivatedBroker({
      presence,
      machineName: MACHINE,
      machineRole: ROLE,
      loadEnvelope: (id) => host.getStore().get(id)?.envelope ?? null,
      headCommit: BASELINE,
      replayStateDir: dir,
    });
    // Path without "broker" substring still under protected root
    const d1 = broker.handle(
      baseBrokerReq(authorizationId, rec.envelopeDigest, "filesystem.authorized_admin_write", {
        args: { path: "C:\\Program Files\\AION\\ElevatedOperatorBroker\\bin\\svc.exe" },
      }),
    );
    assert.equal(d1.outcome, "REFUSE");
    assert.match(d1.reasonCode, /protected-install-root|broker-protected/);

    const d2 = broker.handle(
      baseBrokerReq(authorizationId, rec.envelopeDigest, "repo.authorized_elevated_operation", {
        args: { target: "C:\\ProgramData\\AION\\ElevatedOperatorBroker\\config\\policy.v1.json" },
      }),
    );
    assert.equal(d2.outcome, "REFUSE");
  } finally {
    cleanup();
  }
});

test("M-4: OperatorHost refuses write targeting protected install root", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.edit", "repo.read"]);
    const { sessionId, authorizationId } = approveAndRun(host, env);
    const d = host.request(sessionId, {
      authorizationId,
      agentRole: "GROK_BUILD",
      operation: "repo.edit",
      repositoryRoot: REPO,
      args: { path: "C:\\Program Files\\AION\\ElevatedOperatorBroker\\bin\\aion-elevated-broker.exe" },
    });
    assert.equal(d.outcome, "REFUSE");
    assert.equal(d.reasonCode, "protected-install-root");
  } finally {
    cleanup();
  }
});

test("M-4: planProtectedInstallCopy documents separate install root (no real install)", () => {
  const plan = planProtectedInstallCopy("C:\\AION-HQ");
  assert.equal(plan.installRoot, DEFAULT_PROTECTED_INSTALL_LAYOUT.installRoot);
  assert.ok(plan.subjects.length >= 2);
  assert.equal(isPathUnderProtectedRoot("C:\\Program Files\\AION\\ElevatedOperatorBroker\\bin\\x.exe"), true);
  assert.equal(isPathUnderProtectedRoot("C:\\AION-HQ\\packages\\delegated-operator\\src\\host.ts"), false);
  // Real broker not installed
  assert.equal(ElevatedOperatorBroker.protectedInstallLayout().installRoot.includes("Program Files"), true);
});

// ─── M-5 Durable replay across fresh broker instance ────────────────────────

test("M-5: replay survives fresh broker instance with same state dir", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const req = baseBrokerReq(authorizationId, rec.envelopeDigest);
    const b1 = createSyntheticActivatedBroker({
      presence,
      machineName: MACHINE,
      machineRole: ROLE,
      loadEnvelope: (id) => host.getStore().get(id)?.envelope ?? null,
      headCommit: BASELINE,
      replayStateDir: dir,
    });
    assert.equal(b1.handle(req).outcome, "ALLOW");
    // Fresh instance, same protected state
    const b2 = createSyntheticActivatedBroker({
      presence,
      machineName: MACHINE,
      machineRole: ROLE,
      loadEnvelope: (id) => host.getStore().get(id)?.envelope ?? null,
      headCommit: BASELINE,
      replayStateDir: dir,
    });
    const d2 = b2.handle(req);
    assert.equal(d2.outcome, "REFUSE");
    assert.equal(d2.reasonCode, "replay");
  } finally {
    cleanup();
  }
});

test("M-5: corrupt replay state fails closed", () => {
  const { dir, cleanup } = tempStore();
  try {
    writeFileSync(join(dir, "replay-consumed.v1.json"), "{not-json", "utf8");
    assert.throws(() => new DurableReplayStore(dir), /replay-state-corrupt|fail closed/i);
  } finally {
    cleanup();
  }
});

test("M-5 positive: distinct requestIds are not treated as replay", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host, presence } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["host.read"]);
    const { authorizationId } = approveAndRun(host, env);
    const rec = host.getStore().get(authorizationId)!;
    const broker = createSyntheticActivatedBroker({
      presence,
      machineName: MACHINE,
      machineRole: ROLE,
      loadEnvelope: (id) => host.getStore().get(id)?.envelope ?? null,
      headCommit: BASELINE,
      replayStateDir: dir,
    });
    assert.equal(broker.handle(baseBrokerReq(authorizationId, rec.envelopeDigest)).outcome, "ALLOW");
    assert.equal(broker.handle(baseBrokerReq(authorizationId, rec.envelopeDigest)).outcome, "ALLOW");
  } finally {
    cleanup();
  }
});

// ─── M-6 Owner approval binds exact displayed digest ────────────────────────

test("M-6: POST without digest/nonce refuses when challenge was rendered", async () => {
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
      const html = await page.text();
      assert.match(html, /name="envelopeDigest"/);
      assert.match(html, /name="approvalNonce"/);
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
      assert.ok(csrf);
      // Id-only POST (old attack) must refuse
      const res = await fetch(`${baseUrl}/decision`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://127.0.0.1" },
        body: `csrf=${csrf}&authorizationId=${env.authorizationId}&decision=AUTHORIZE`,
      });
      assert.equal(res.status, 409);
      assert.equal(host.getStore().get(env.authorizationId)?.lifecycle, "PENDING_OWNER_AUTHORIZATION");
    } finally {
      await ui.close();
    }
  } finally {
    cleanup();
  }
});

test("M-6: wrong digest after display refuses (TOCTOU mutate-after-render)", async () => {
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
      const html = await page.text();
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
      const nonce = /name="approvalNonce" value="([^"]+)"/.exec(html)?.[1];
      assert.ok(csrf && nonce);
      const res = await fetch(`${baseUrl}/decision`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://127.0.0.1" },
        body: `csrf=${csrf}&authorizationId=${env.authorizationId}&envelopeDigest=${"ff".repeat(32)}&approvalNonce=${nonce}&decision=AUTHORIZE`,
      });
      assert.equal(res.status, 409);
      assert.equal(host.getStore().get(env.authorizationId)?.lifecycle, "PENDING_OWNER_AUTHORIZATION");
    } finally {
      await ui.close();
    }
  } finally {
    cleanup();
  }
});

test("M-6 positive: exact displayed digest + nonce authorizes", async () => {
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
      const html = await page.text();
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
      const digest = /name="envelopeDigest" value="([^"]+)"/.exec(html)?.[1];
      const nonce = /name="approvalNonce" value="([^"]+)"/.exec(html)?.[1];
      assert.equal(digest, envelopeDigest(env));
      const res = await fetch(`${baseUrl}/decision`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://127.0.0.1" },
        body: `csrf=${csrf}&authorizationId=${env.authorizationId}&envelopeDigest=${digest}&approvalNonce=${nonce}&decision=AUTHORIZE`,
      });
      assert.equal(res.status, 200);
      assert.equal(host.getStore().get(env.authorizationId)?.lifecycle, "AUTHORIZED");
    } finally {
      await ui.close();
    }
  } finally {
    cleanup();
  }
});

// ─── M-7 Independent Git ancestry ───────────────────────────────────────────

test("M-7: caller cannot force-accept forged ordinary-forward boolean", () => {
  const { dir, cleanup } = tempStore();
  try {
    const forgedHead = "f".repeat(40);
    // Git port observes unrelated HEAD; does NOT honor any caller forward flag
    const { host } = syntheticHost(dir, undefined, {
      headCommit: forgedHead,
      // no forwardFrom map entry → not ordinary forward
    });
    const env = sampleEnvelope("GROK_BUILD", ["repo.read", "git.commit_forward", "git.push_canonical"]);
    host.submitPending(env);
    host.ownerAuthorize(env.authorizationId);
    assert.throws(() => host.openSession(env.authorizationId, "GROK_BUILD"), /baseline|wrong-baseline/i);
  } finally {
    cleanup();
  }
});

test("M-7: ExecGitFactsPort observes real TEMP repo ancestry (forward allow)", () => {
  const root = mkdtempSync(join(tmpdir(), "aion-git-fwd-"));
  const bare = mkdtempSync(join(tmpdir(), "aion-git-bare-"));
  try {
    const run = (cwd: string, args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
    run(root, ["init", "-b", "main"]);
    run(root, ["config", "user.email", "test@example.com"]);
    run(root, ["config", "user.name", "Test"]);
    writeFileSync(join(root, "a.txt"), "a");
    run(root, ["add", "a.txt"]);
    run(root, ["commit", "-m", "baseline"]);
    const baseline = run(root, ["rev-parse", "HEAD"]);
    writeFileSync(join(root, "b.txt"), "b");
    run(root, ["add", "b.txt"]);
    run(root, ["commit", "-m", "forward"]);
    const head = run(root, ["rev-parse", "HEAD"]);
    // bare remote
    execFileSync("git", ["init", "--bare", "-b", "main"], { cwd: bare, encoding: "utf8", windowsHide: true });
    run(root, ["remote", "add", "origin", bare]);
    run(root, ["push", "-u", "origin", "main"]);

    const port = new ExecGitFactsPort(root);
    const facts = port.observe(baseline, true);
    assert.equal(facts.headCommit, head);
    assert.equal(facts.isOrdinaryForwardFromBaseline, true);
    assert.equal(facts.branch, "main");

    // Unrelated baseline → not forward
    const fake = port.observe("0".repeat(40), true);
    assert.equal(fake.isOrdinaryForwardFromBaseline, false);
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
      rmSync(bare, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test("M-7 positive: StaticGitFactsPort allows when HEAD equals baseline", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["git.commit_forward", "repo.read"]);
    const { sessionId, authorizationId } = approveAndRun(host, env);
    const d = host.request(sessionId, {
      authorizationId,
      agentRole: "GROK_BUILD",
      operation: "git.commit_forward",
      repositoryRoot: REPO,
      args: {},
    });
    assert.equal(d.outcome, "ALLOW");
  } finally {
    cleanup();
  }
});

test("M-7: ordinary-forward map allows observed descendant only", () => {
  const { dir, cleanup } = tempStore();
  try {
    const head2 = "a".repeat(40);
    const forwardFrom = new Map([[`${BASELINE}->${head2}`, true]]);
    const { host } = syntheticHost(dir, undefined, { headCommit: head2, forwardFrom });
    const env = sampleEnvelope("GROK_BUILD", ["repo.read", "git.push_canonical"]);
    const { sessionId, authorizationId } = approveAndRun(host, env);
    const d = host.request(sessionId, {
      authorizationId,
      agentRole: "GROK_BUILD",
      operation: "git.push_canonical",
      repositoryRoot: REPO,
      args: {},
    });
    assert.equal(d.outcome, "ALLOW");
  } finally {
    cleanup();
  }
});

// ─── Cross-cutting: inactive boundary / digestsMatch ────────────────────────

test("R6.5-R1: digestsMatch empty expected fails closed", () => {
  assert.equal(digestsMatch({}, { a: "1" }), false);
  assert.equal(digestsMatch({ a: "1" }, { a: "1" }), true);
  assert.equal(digestsMatch({ a: "1" }, { a: "2" }), false);
});

test("R6.5-R1: inactive production defaults unchanged", async () => {
  const { R65_PRODUCTION_DEFAULTS } = await import("../src/index.js");
  assert.equal(R65_PRODUCTION_DEFAULTS.elevatedBrokerInstalled, false);
  assert.equal(R65_PRODUCTION_DEFAULTS.elevatedBrokerActivated, false);
  assert.equal(R65_PRODUCTION_DEFAULTS.realApprovalRootActivated, false);
  assert.equal(R65_PRODUCTION_DEFAULTS.founderAuthoritative, true);
});
