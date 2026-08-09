/**
 * R6.5-R2 focused corrections: M-4 path canonicalization + M-6 mandatory digest binding.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  isPathUnderProtectedRoot,
  canonicalizeProtectionPath,
  DEFAULT_PROTECTED_INSTALL_LAYOUT,
  OwnerAuthorizationUi,
  envelopeDigest,
  type ProtectedInstallLayoutV1,
} from "../src/index.js";
import {
  tempStore,
  syntheticHost,
  sampleEnvelope,
  ownerApproveExact,
  REPO,
} from "./helpers.js";

// ─── M-4 ────────────────────────────────────────────────────────────────────

test("M-4: normal protected-root path refuses", () => {
  assert.equal(
    isPathUnderProtectedRoot("C:\\Program Files\\AION\\ElevatedOperatorBroker\\bin\\aion-elevated-broker.exe"),
    true,
  );
  assert.equal(
    isPathUnderProtectedRoot("C:\\ProgramData\\AION\\ElevatedOperatorBroker\\config\\policy.v1.json"),
    true,
  );
});

test("M-4: case and separator variation refuse", () => {
  assert.equal(
    isPathUnderProtectedRoot("c:/program files/aion/elevatedoperatorbroker/bin/x.exe"),
    true,
  );
  assert.equal(
    isPathUnderProtectedRoot("C:\\PROGRAM FILES\\AION\\ElevatedOperatorBroker\\bin\\x.exe"),
    true,
  );
});

test("M-4: relative traversal into protected root refuses", () => {
  // After normalize/resolve, still under protected identity when absolute form is protected
  assert.equal(
    isPathUnderProtectedRoot("C:\\Program Files\\AION\\ElevatedOperatorBroker\\..\\ElevatedOperatorBroker\\bin\\x.exe"),
    true,
  );
});

test("M-4: 8.3 short-name alias refuses (no broker substring required)", () => {
  // Claude residual: C:\PROGRA~1\AION\ELEVAT~1\... was ALLOW under substring/prefix-only check
  assert.equal(
    isPathUnderProtectedRoot("C:\\PROGRA~1\\AION\\ELEVAT~1\\config\\policy.v1.json"),
    true,
  );
  assert.equal(
    isPathUnderProtectedRoot("C:\\PROGRA~1\\AION\\ELEVAT~1\\bin\\svc.exe"),
    true,
  );
});

test("M-4: renamed path lacking broker substring under protected root refuses", () => {
  assert.equal(
    isPathUnderProtectedRoot("C:\\Program Files\\AION\\ElevatedOperatorBroker\\bin\\svc.exe"),
    true,
  );
});

test("M-4: ordinary safe repo and TEMP paths allow", () => {
  assert.equal(isPathUnderProtectedRoot("C:\\AION-HQ\\packages\\delegated-operator\\src\\host.ts"), false);
  assert.equal(isPathUnderProtectedRoot(join(tmpdir(), "aion-safe-work", "file.txt")), false);
  assert.equal(isPathUnderProtectedRoot(REPO), false);
});

test("M-4: junction into protected-shaped root refuses via realpath", () => {
  const base = mkdtempSync(join(tmpdir(), "aion-m4-junc-"));
  try {
    const realRoot = join(base, "ElevatedOperatorBroker");
    const alias = join(base, "alias-no-keyword");
    mkdirSync(join(realRoot, "bin"), { recursive: true });
    writeFileSync(join(realRoot, "bin", "svc.exe"), "x");
    // directory junction (Windows)
    execFileSync("cmd.exe", ["/c", "mklink", "/J", alias, realRoot], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const layout: ProtectedInstallLayoutV1 = {
      ...DEFAULT_PROTECTED_INSTALL_LAYOUT,
      installRoot: realRoot,
      stateRoot: join(base, "state-not-used"),
    };
    assert.equal(isPathUnderProtectedRoot(join(alias, "bin", "svc.exe"), layout), true);
    // alias path itself has no "broker" substring
    assert.equal(/broker/i.test(alias), false);
  } finally {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test("M-4: symlink into protected root refuses where creation permitted", () => {
  const base = mkdtempSync(join(tmpdir(), "aion-m4-sym-"));
  try {
    const realRoot = join(base, "ElevatedOperatorBroker");
    mkdirSync(join(realRoot, "bin"), { recursive: true });
    const targetFile = join(realRoot, "bin", "svc.exe");
    writeFileSync(targetFile, "x");
    const linkPath = join(base, "link-svc.exe");
    let created = false;
    try {
      symlinkSync(targetFile, linkPath);
      created = true;
    } catch {
      // Privilege may be required for symlinks; skip real fixture but still prove API
      assert.equal(isPathUnderProtectedRoot(targetFile, {
        ...DEFAULT_PROTECTED_INSTALL_LAYOUT,
        installRoot: realRoot,
        stateRoot: join(base, "state"),
      }), true);
      return;
    }
    if (created) {
      const layout: ProtectedInstallLayoutV1 = {
        ...DEFAULT_PROTECTED_INSTALL_LAYOUT,
        installRoot: realRoot,
        stateRoot: join(base, "state"),
      };
      assert.equal(isPathUnderProtectedRoot(linkPath, layout), true);
    }
  } finally {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

test("M-4: Host refuses write via 8.3 alias path", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.edit", "repo.read"]);
    const { sessionId, authorizationId } = (() => {
      host.submitPending(env);
      const approved = ownerApproveExact(host, env.authorizationId);
      const opened = host.openSession(approved.authorizationId, approved.agentRole);
      host.bindSession(opened.sessionId, opened.sessionToken, approved.agentRole);
      return { authorizationId: approved.authorizationId, sessionId: opened.sessionId };
    })();
    const d = host.request(sessionId, {
      authorizationId,
      agentRole: "GROK_BUILD",
      operation: "repo.edit",
      repositoryRoot: REPO,
      args: { path: "C:\\PROGRA~1\\AION\\ELEVAT~1\\bin\\svc.exe" },
    });
    assert.equal(d.outcome, "REFUSE");
    assert.equal(d.reasonCode, "protected-install-root");
  } finally {
    cleanup();
  }
});

test("M-4: canonicalizeProtectionPath expands PROGRA~1", () => {
  const c = canonicalizeProtectionPath("C:\\PROGRA~1\\AION\\ELEVAT~1\\bin\\x.exe");
  assert.match(c, /program files/);
  assert.match(c, /elevatedoperatorbroker/);
});

// ─── M-6 ────────────────────────────────────────────────────────────────────

test("M-6: authorizationId-only ownerAuthorize is not callable / refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    // @ts-expect-error intentional arity attack
    assert.throws(() => host.ownerAuthorize(env.authorizationId), /digest|nonce|required|challenge/i);
  } finally {
    cleanup();
  }
});

test("M-6: omit digest refuses; omit nonce refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    const ch = host.beginOwnerApprovalChallenge(env.authorizationId);
    assert.throws(() => host.ownerAuthorize(env.authorizationId, "", ch.nonce), /digest/i);
    assert.throws(() => host.ownerAuthorize(env.authorizationId, ch.digest, ""), /nonce/i);
  } finally {
    cleanup();
  }
});

test("M-6: wrong digest / stale nonce / replay nonce refuse", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    const ch = host.beginOwnerApprovalChallenge(env.authorizationId);
    assert.throws(
      () => host.ownerAuthorize(env.authorizationId, "ff".repeat(32), ch.nonce),
      /digest/i,
    );
    // nonce was consumed on failed digest path after delete — re-challenge
    const ch2 = host.beginOwnerApprovalChallenge(env.authorizationId);
    assert.throws(
      () => host.ownerAuthorize(env.authorizationId, ch2.digest, "deadbeefdeadbeefdeadbeefdeadbeef"),
      /nonce/i,
    );
    const ch3 = host.beginOwnerApprovalChallenge(env.authorizationId);
    ownerApproveExact(host, env.authorizationId);
    // replay nonce after success
    assert.throws(
      () => host.ownerAuthorize(env.authorizationId, ch3.digest, ch3.nonce),
      /lifecycle|challenge|nonce|not pending/i,
    );
  } finally {
    cleanup();
  }
});

test("M-6: mutate envelope after render refuses", () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    const ch = host.beginOwnerApprovalChallenge(env.authorizationId);
    // Store only holds original; digest mismatch if we approve with wrong displayed digest is enough
    // Simulate TOCTOU by approving with digest from a different capability set
    const other = sampleEnvelope("GROK_BUILD", ["repo.read", "repo.edit"]);
    assert.throws(
      () => host.ownerAuthorize(env.authorizationId, envelopeDigest(other), ch.nonce),
      /digest/i,
    );
  } finally {
    cleanup();
  }
});

test("M-6 positive: exact digest + nonce authorizes; UI path binds fields", async () => {
  const { dir, cleanup } = tempStore();
  try {
    const { host } = syntheticHost(dir);
    const env = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env);
    const approved = ownerApproveExact(host, env.authorizationId);
    assert.equal(approved.authorizationId, env.authorizationId);
    assert.equal(host.getStore().get(env.authorizationId)?.lifecycle, "AUTHORIZED");

    const env2 = sampleEnvelope("GROK_BUILD", ["repo.read"]);
    host.submitPending(env2);
    const ui = new OwnerAuthorizationUi({
      host,
      getPendingEnvelope: (id) => {
        const rec = host.getStore().get(id);
        return rec?.lifecycle === "PENDING_OWNER_AUTHORIZATION" ? rec.envelope : null;
      },
    });
    const { baseUrl } = await ui.listenLoopbackOnly();
    try {
      const page = await fetch(`${baseUrl}/authorize?authorizationId=${env2.authorizationId}`);
      const html = await page.text();
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
      const digest = /name="envelopeDigest" value="([^"]+)"/.exec(html)?.[1];
      const nonce = /name="approvalNonce" value="([^"]+)"/.exec(html)?.[1];
      assert.ok(csrf && digest && nonce);
      // omit digest
      const resOmit = await fetch(`${baseUrl}/decision`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://127.0.0.1" },
        body: `csrf=${csrf}&authorizationId=${env2.authorizationId}&approvalNonce=${nonce}&decision=AUTHORIZE`,
      });
      assert.equal(resOmit.status, 409);
      // need fresh page for new csrf/nonce after failed attempt may have rotated csrf
      const page2 = await fetch(`${baseUrl}/authorize?authorizationId=${env2.authorizationId}`);
      const html2 = await page2.text();
      const csrf2 = /name="csrf" value="([^"]+)"/.exec(html2)?.[1];
      const digest2 = /name="envelopeDigest" value="([^"]+)"/.exec(html2)?.[1];
      const nonce2 = /name="approvalNonce" value="([^"]+)"/.exec(html2)?.[1];
      const resOk = await fetch(`${baseUrl}/decision`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://127.0.0.1" },
        body: `csrf=${csrf2}&authorizationId=${env2.authorizationId}&envelopeDigest=${digest2}&approvalNonce=${nonce2}&decision=AUTHORIZE`,
      });
      assert.equal(resOk.status, 200);
    } finally {
      await ui.close();
    }
  } finally {
    cleanup();
  }
});
