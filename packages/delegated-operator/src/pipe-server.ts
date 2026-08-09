/**
 * Local named-pipe IPC for the elevated broker (R6.5.1).
 * Pipe: \\.\pipe\AION-ElevatedOperatorBroker-v1
 * Local only — Windows named pipes are host-local; no TCP.
 */

import { createServer, Socket, type Server } from "node:net";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ElevatedOperatorBroker, type ElevatedBrokerRequestV1 } from "./elevated-broker.js";
import { DelegatedOperatorError } from "./contracts.js";

export const DEFAULT_PIPE_PATH = "\\\\.\\pipe\\AION-ElevatedOperatorBroker-v1";

export interface PipeServerOptions {
  readonly broker: ElevatedOperatorBroker;
  readonly sessionKey: Buffer;
  readonly pipePath?: string;
}

/**
 * HMAC-framed JSON request/response over a named pipe.
 * Transport authentication is NOT authorization — broker still validates envelopes.
 */
export class BrokerPipeServer {
  private server: Server | null = null;
  private readonly broker: ElevatedOperatorBroker;
  private readonly sessionKey: Buffer;
  private readonly pipePath: string;

  constructor(options: PipeServerOptions) {
    this.broker = options.broker;
    this.sessionKey = options.sessionKey;
    this.pipePath = options.pipePath ?? DEFAULT_PIPE_PATH;
  }

  async listen(): Promise<{ pipePath: string }> {
    if (this.server) throw new DelegatedOperatorError("pipe-listen", "Already listening");
    this.server = createServer((socket) => this.onConnection(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      // Local named pipe only; readableAll/writableAll allow local Owner/agent connect.
      // Authorization remains independent (envelope + MAC). Not a public TCP listener.
      this.server!.listen(
        {
          path: this.pipePath,
          readableAll: true,
          writableAll: true,
        },
        () => resolve(),
      );
    });
    return { pipePath: this.pipePath };
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
  }

  private onConnection(socket: Socket): void {
    let buf = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      try {
        const request = this.openFrame(line);
        const decision = this.broker.handle(request);
        socket.write(`${JSON.stringify({ ok: true, decision })}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "pipe error";
        const code = error instanceof DelegatedOperatorError ? error.code : "pipe-error";
        socket.write(`${JSON.stringify({ ok: false, code, message })}\n`);
      } finally {
        socket.end();
      }
    });
  }

  seal(request: ElevatedBrokerRequestV1): string {
    const body = JSON.stringify(request);
    const nonce = randomBytes(16).toString("hex");
    const mac = createHmac("sha256", this.sessionKey).update(`${nonce}|${body}`).digest("hex");
    return JSON.stringify({ nonce, body, mac });
  }

  private openFrame(blob: string): ElevatedBrokerRequestV1 {
    const parsed = JSON.parse(blob) as { nonce?: string; body?: string; mac?: string };
    if (!parsed.nonce || !parsed.body || !parsed.mac) {
      throw new DelegatedOperatorError("pipe-frame", "Invalid pipe frame");
    }
    const expected = createHmac("sha256", this.sessionKey)
      .update(`${parsed.nonce}|${parsed.body}`)
      .digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(parsed.mac, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new DelegatedOperatorError("pipe-mac", "Pipe frame MAC invalid");
    }
    return JSON.parse(parsed.body) as ElevatedBrokerRequestV1;
  }
}

/** Client helper for installed-instance tests. */
export async function sendBrokerPipeRequest(options: {
  readonly pipePath?: string;
  readonly sessionKey: Buffer;
  readonly request: ElevatedBrokerRequestV1;
}): Promise<unknown> {
  const pipePath = options.pipePath ?? DEFAULT_PIPE_PATH;
  const body = JSON.stringify(options.request);
  const nonce = randomBytes(16).toString("hex");
  const mac = createHmac("sha256", options.sessionKey).update(`${nonce}|${body}`).digest("hex");
  const frame = JSON.stringify({ nonce, body, mac });

  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let buf = "";
    socket.setEncoding("utf8");
    socket.connect(pipePath, () => {
      socket.write(`${frame}\n`);
    });
    socket.on("data", (chunk: string) => {
      buf += chunk;
      if (buf.includes("\n")) {
        try {
          resolve(JSON.parse(buf.trim()));
        } catch (e) {
          reject(e);
        } finally {
          socket.end();
        }
      }
    });
    socket.on("error", reject);
  });
}
