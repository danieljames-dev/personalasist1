import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { type CapabilityEnvelopeV1, DelegatedOperatorError } from "./contracts.js";
import { envelopeDigest } from "./envelope.js";
import type { OperatorHost } from "./host.js";

/**
 * Loopback-only Owner authorization UI.
 * Never binds 0.0.0.0 / :: / public interfaces.
 *
 * R6.5-R2 M-6: approval POST binds exact displayed envelope digest + one-time nonce.
 * R6.5.2: when requireElevatedOwnerHelper, AUTHORIZE launches UAC helper and does not
 * mint proofs in-process under the ordinary user (private key is broker-only).
 */

export interface OwnerUiOptions {
  readonly host: OperatorHost;
  readonly getPendingEnvelope: (authorizationId: string) => CapabilityEnvelopeV1 | null;
  readonly port?: number;
  /** When true, AUTHORIZE spawns elevated helper instead of host.ownerAuthorize. */
  readonly requireElevatedOwnerHelper?: boolean;
  readonly ownerApprovalHelperPath?: string;
}

export class OwnerAuthorizationUi {
  private server: Server | null = null;
  private readonly host: OperatorHost;
  private readonly getPending: OwnerUiOptions["getPendingEnvelope"];
  private readonly port: number;
  private readonly requireElevatedOwnerHelper: boolean;
  private readonly ownerApprovalHelperPath: string;
  private csrfToken = randomBytes(24).toString("hex");

  constructor(options: OwnerUiOptions) {
    this.host = options.host;
    this.getPending = options.getPendingEnvelope;
    this.port = options.port ?? 0;
    this.requireElevatedOwnerHelper = options.requireElevatedOwnerHelper === true;
    this.ownerApprovalHelperPath = options.ownerApprovalHelperPath ?? "";
  }

  async listenLoopbackOnly(): Promise<{ port: number; baseUrl: string }> {
    if (this.server) throw new DelegatedOperatorError("ui-listen", "Already listening");
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      // Critical: bind 127.0.0.1 only — never 0.0.0.0
      this.server!.listen(this.port, "127.0.0.1", () => resolve());
    });
    const addr = this.server.address();
    if (!addr || typeof addr === "string") throw new DelegatedOperatorError("ui-listen", "No address");
    return { port: addr.port, baseUrl: `http://127.0.0.1:${addr.port}` };
  }

  /** Test helper: attempt forbidden binds must not be used by production API. */
  static assertAddressIsLoopback(host: string): void {
    if (host !== "127.0.0.1" && host !== "::1") {
      throw new DelegatedOperatorError("public-bind-forbidden", "Owner UI may only bind loopback");
    }
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const hostHeader = req.headers.host ?? "";
      if (!/^127\.0\.0\.1(?::\d+)?$/u.test(hostHeader) && !/^localhost(?::\d+)?$/iu.test(hostHeader)) {
        res.writeHead(421, { "content-type": "text/plain" });
        res.end("Refusing non-loopback Host");
        return;
      }
      const origin = req.headers.origin;
      if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/iu.test(origin)) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("CSRF origin refused");
        return;
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/health") {
        const activated = this.host.activationMode === "activated";
        json(res, 200, {
          ok: true,
          activationMode: this.host.activationMode,
          founderAuthoritative: true,
          founderFallbackAvailable: true,
          realApprovalRootActivated: activated,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/authorize") {
        const id = url.searchParams.get("authorizationId") ?? "";
        const envelope = this.getPending(id);
        if (!envelope) {
          res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
          res.end("<html><body>Unknown pending authorization</body></html>");
          return;
        }
        // M-6: challenge binds exact displayed digest + one-time nonce
        const challenge = this.host.beginOwnerApprovalChallenge(id);
        const digest = challenge.digest;
        if (digest !== envelopeDigest(envelope)) {
          res.writeHead(409, { "content-type": "text/plain" });
          res.end("Digest inconsistency");
          return;
        }
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        res.end(renderPage(envelope, digest, challenge.nonce, this.csrfToken, this.host.activationMode));
        return;
      }

      if (req.method === "POST" && url.pathname === "/decision") {
        const body = await readBody(req, 64 * 1024);
        const params = new URLSearchParams(body);
        const csrf = params.get("csrf") ?? "";
        if (csrf !== this.csrfToken) {
          res.writeHead(403, { "content-type": "text/plain" });
          res.end("CSRF token mismatch");
          return;
        }
        const id = params.get("authorizationId") ?? "";
        const decision = params.get("decision") ?? "";
        const submittedDigest = params.get("envelopeDigest") ?? "";
        const approvalNonce = params.get("approvalNonce") ?? "";
        this.csrfToken = randomBytes(24).toString("hex");
        if (decision === "DENY") {
          this.host.ownerDeny(id);
          json(res, 200, { ok: true, decision: "DENY", founderAuthoritative: true });
          return;
        }
        if (decision === "AUTHORIZE") {
          if (!submittedDigest || !approvalNonce) {
            json(res, 409, {
              ok: false,
              error: "Owner approval requires exact envelopeDigest and approvalNonce",
              founderAuthoritative: true,
            });
            return;
          }
          if (this.requireElevatedOwnerHelper) {
            if (!this.ownerApprovalHelperPath) {
              json(res, 500, { ok: false, error: "Owner approval helper path not configured" });
              return;
            }
            const pending = this.getPending(id);
            if (!pending) {
              json(res, 404, { ok: false, error: "Unknown pending authorization" });
              return;
            }
            // Launch elevated helper — Owner must click UAC YES. No in-process mint.
            try {
              spawn(
                this.ownerApprovalHelperPath,
                [
                  `--authorizationId=${id}`,
                  `--envelopeDigest=${submittedDigest}`,
                  `--approvalNonce=${approvalNonce}`,
                  `--directiveId=${pending.directiveId}`,
                  `--repositoryRoot=${pending.repositoryRoot}`,
                ],
                {
                  detached: true,
                  stdio: "ignore",
                  windowsHide: false,
                },
              ).unref();
            } catch (error) {
              json(res, 500, {
                ok: false,
                error: error instanceof Error ? error.message : "helper launch failed",
              });
              return;
            }
            json(res, 202, {
              ok: true,
              decision: "AUTHORIZE_PENDING_UAC",
              needsElevatedOwnerHelper: true,
              activationMode: this.host.activationMode,
              realApprovalRootActivated: true,
              authorizationId: id,
              founderAuthoritative: true,
              founderFallbackAvailable: true,
            });
            return;
          }
          try {
            // Synthetic/test path: in-process Owner presence (never for live private key)
            const env = this.host.ownerAuthorize(id, submittedDigest, approvalNonce);
            json(res, 200, {
              ok: true,
              decision: "AUTHORIZE",
              activationMode: this.host.activationMode,
              realApprovalRootActivated: this.host.activationMode === "activated",
              authorizationId: env.authorizationId,
              envelopeDigest: envelopeDigest(env),
              founderAuthoritative: true,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "refused";
            json(res, 409, {
              ok: false,
              error: message,
              realApprovalRootActivated: false,
              founderAuthoritative: true,
            });
          }
          return;
        }
        res.writeHead(400);
        res.end("Bad decision");
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(error instanceof Error ? error.message : "error");
    }
  }
}

function renderPage(
  envelope: CapabilityEnvelopeV1,
  digest: string,
  approvalNonce: string,
  csrf: string,
  activationMode: string,
): string {
  const can = envelope.authorizedOperations.join(", ");
  const cannot = envelope.prohibitedOperations.join(", ") || "(see structural role denies)";
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>AION Milestone Authorization</title>
<style>
body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;background:#0b1020;color:#e8ecff}
.card{border:1px solid #334;border-radius:12px;padding:1.25rem;background:#121a33}
.risk{display:inline-block;padding:.2rem .5rem;border-radius:6px;background:#3a2a00;color:#ffd27a}
.forbid{color:#ff8e8e} button{font-size:1rem;padding:.6rem 1.2rem;margin-right:.5rem;border-radius:8px;border:0;cursor:pointer}
.auth{background:#2f6fed;color:#fff}.deny{background:#5a2030;color:#ffd0d0}
code{font-size:.8rem;word-break:break-all}.banner{background:#402010;padding:.75rem;border-radius:8px;margin-bottom:1rem}
</style></head><body>
<div class="banner"><strong>R6.5 INACTIVE MODE</strong> — UI is not a Founder-replacing root.
Founder remains authoritative (breakglass). activationMode=${esc(activationMode)}.
Live approval requires elevated Owner Approval Helper (UAC), not a user-readable key.</div>
<h1>AION MILESTONE AUTHORIZATION</h1>
<div class="card">
<p><strong>Milestone</strong><br/>${esc(envelope.directiveId)}</p>
<p><strong>Agent</strong><br/>${esc(envelope.agentRole)}</p>
<p><strong>Repository</strong><br/>${esc(envelope.repositoryRoot)}</p>
<p><strong>Canonical origin</strong><br/>${esc(envelope.canonicalOrigin)}</p>
<p><strong>Baseline</strong><br/><code>${esc(envelope.baselineCommit)}</code></p>
<p><strong>Risk</strong> <span class="risk">${esc(envelope.riskClass)}</span></p>
<p><strong>Requested capabilities</strong><br/>${esc(can)}</p>
<p class="forbid"><strong>Forbidden / prohibited</strong><br/>${esc(cannot)}</p>
<p><strong>Git</strong>: ${esc(envelope.gitPermissions.join(", "))}</p>
<p><strong>Host</strong>: ${esc(envelope.hostPermissions.join(", "))}</p>
<p><strong>External</strong>: ${esc(envelope.externalActionPolicy)}</p>
<p><strong>Credentials</strong>: ${esc(envelope.credentialPolicy)}</p>
<p><strong>Spend ceiling (cents)</strong>: ${envelope.spendPolicy.ceilingCents}</p>
<p><strong>Expires</strong>: ${esc(envelope.expiresAtUtc)}</p>
<p><strong>Reboot</strong>: allowed=${envelope.rebootPolicy.allowed}, max=${envelope.rebootPolicy.maxReboots}</p>
<p><strong>Nested Owner gates listed</strong>: ${esc(envelope.nestedOwnerGates.join(", ") || "(Host still enforces full catalog)")}</p>
<p><strong>Canonical envelope digest</strong><br/><code id="displayed-digest">${esc(digest)}</code></p>
<form method="POST" action="/decision">
<input type="hidden" name="csrf" value="${esc(csrf)}"/>
<input type="hidden" name="authorizationId" value="${esc(envelope.authorizationId)}"/>
<input type="hidden" name="envelopeDigest" value="${esc(digest)}"/>
<input type="hidden" name="approvalNonce" value="${esc(approvalNonce)}"/>
<button class="auth" type="submit" name="decision" value="AUTHORIZE">AUTHORIZE</button>
<button class="deny" type="submit" name="decision" value="DENY">DENY</button>
</form>
</div></body></html>`;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
