/**
 * Executor output, kept small enough that a flood cannot fill the disk or the Director.
 *
 * An executor that prints forever used to be a storage incident: stdout landed in memory and on
 * disk without a ceiling, and the failure that finally killed the run was the last thing still
 * on the machine. Three bounds stop that. They are not preferences.
 *
 * ```
 * live tail   256 KiB   what is kept in memory for inspection
 * per file      8 MiB   stdout.log / stderr.log each
 * per run      16 MiB   total raw input across both streams; beyond this the run is halted
 * ```
 *
 * The tail is what is kept, not the head. The end of a log is where the failure is. When bytes
 * are dropped, the buffer starts with a marker that says how many — a log that silently omits
 * its middle is worse than one that says it was truncated, because a reader trusts what is there.
 *
 * ## Redaction is a safety net, not a guarantee
 *
 * Obvious secret shapes are replaced *before* anything is written to the live tail or the sink:
 * bearer tokens, `Authorization:` headers, `ghp_` / `github_pat_` tokens, `sk-` API keys, AWS
 * key ids, and private-key blocks. The rest of the line is kept — the surrounding context is
 * usually what a debugger needs. This is best-effort matching of accidental output. It will not
 * catch every secret, a novel encoding, or a token the next vendor invents, and it must not be
 * treated as a confidentiality boundary.
 *
 * A secret that arrives split across two `write` calls is still redacted when the secret
 * itself (not the whole line) fits in the tail hold (`SECRET_TAIL_BYTES`, 4 KiB). The
 * overflow path keeps that bounded tail rather than clearing the hold. `flush` force-emits
 * an unterminated PRIVATE KEY block as `[REDACTED]`, not as plaintext.
 *
 * ## Clock and sink are injected
 *
 * Bounds are testable without writing megabytes to disk. The clock stamps truncation and halt
 * so those events do not depend on `Date.now`. The sink is how a file would be updated: append
 * while under the file bound, replace with marker-plus-tail once the head has been dropped.
 * This module does not kill the executor. It reports that the run must be halted; the run
 * manager is what sends the signal.
 */
import type { IsoTimestamp } from "./contracts.js";

export const LIVE_TAIL_BYTES = 256 * 1024;
export const FILE_LOG_BYTES = 8 * 1024 * 1024;
export const RUN_LOG_BYTES = 16 * 1024 * 1024;

export const BOUNDED_LOG_SCHEMA_V1 = "aion.director.bounded-log.v1" as const;

export type LogStreamV1 = "stdout" | "stderr";

/** Wall clock for truncation and halt stamps. Tests inject a fixed instant. */
export interface ClockV1 {
  now(): IsoTimestamp;
}

/**
 * Durable destination for one stream's bounded file image.
 *
 * `append` is used only while the file is still under the per-file bound. `replace` is used
 * the moment the head is dropped, and on every write after that, so the file keeps the tail.
 */
export interface LogSinkV1 {
  append(bytes: Uint8Array): void;
  replace(bytes: Uint8Array): void;
}

export interface MemoryLogSinkV1 extends LogSinkV1 {
  contents(): Buffer;
}

export interface BoundedLogDepsV1 {
  readonly clock: ClockV1;
  readonly sinks: { readonly stdout: LogSinkV1; readonly stderr: LogSinkV1 };
}

export interface StreamReportV1 {
  readonly liveTruncated: boolean;
  readonly fileTruncated: boolean;
  readonly droppedLiveBytes: number;
  readonly droppedFileBytes: number;
  readonly livePayloadBytes: number;
  readonly filePayloadBytes: number;
  readonly truncatedAt: IsoTimestamp | null;
}

export interface BoundedLogReportV1 {
  readonly schema: typeof BOUNDED_LOG_SCHEMA_V1;
  readonly runBytesIn: number;
  readonly mustHalt: boolean;
  readonly haltReason: string | null;
  readonly haltedAt: IsoTimestamp | null;
  readonly lastWriteAt: IsoTimestamp | null;
  readonly stdout: StreamReportV1;
  readonly stderr: StreamReportV1;
}

export interface LogWriteResultV1 {
  readonly mustHalt: boolean;
  readonly haltReason: string | null;
  readonly liveTruncated: boolean;
  readonly fileTruncated: boolean;
}

export interface BoundedLogV1 {
  write(stream: LogStreamV1, chunk: string | Uint8Array): LogWriteResultV1;
  flush(): void;
  markDrainIncomplete(): void;
  liveTail(stream: LogStreamV1): Buffer;
  fileImage(stream: LogStreamV1): Buffer;
  report(): BoundedLogReportV1;
}

const REDACTED = "[REDACTED]";

/**
 * Incomplete secrets are held in a small suffix, never in the whole buffer. Scanning a 16 MiB
 * flood for a prefix of `sk-` at every index is how a bound-test hangs the process.
 */
/** Line-sized token hold. Still bounded so a 16 MiB flood cannot be scanned unbounded. */
const MAX_PEM_HOLD = 64 * 1024;
export const MAX_TOKEN_HOLD = MAX_PEM_HOLD;
/** Tail kept when a line exceeds MAX_TOKEN_HOLD so a split secret still redacts. */
const SECRET_TAIL_BYTES = 4 * 1024;

/**
 * Marker written when the head of a bound has been dropped.
 *
 * `dropped` is payload bytes that are no longer present — not including the marker itself.
 */
export function truncationMarker(droppedBytes: number): string {
  return `\n[AION_LOG_TRUNCATED dropped=${droppedBytes}]\n`;
}

export function runLogBoundExceededReason(runBytesIn: number): string {
  return `run log input exceeded ${RUN_LOG_BYTES} bytes (${runBytesIn} raw bytes ingested); the executor must be halted and the process killed`;
}

export function createMemoryLogSink(): MemoryLogSinkV1 {
  let bytes = Buffer.alloc(0);
  return {
    append(chunk) {
      bytes = Buffer.concat([bytes, Buffer.from(chunk)]);
    },
    replace(chunk) {
      bytes = Buffer.from(chunk);
    },
    contents() {
      return bytes;
    },
  };
}

export function createFixedClock(now: IsoTimestamp): ClockV1 {
  return { now: () => now };
}

/**
 * Best-effort redaction of accidental secret-shaped output.
 *
 * Not a confidentiality guarantee. Novel encodings, wrapped tokens, and anything that does not
 * match the shapes below will pass through.
 */
/** Same terminator the holdback and the redactor use. One spelling. */
const PRIVATE_KEY_END_LINE = /-----END [A-Z0-9 ]*PRIVATE KEY-----[^\n]*\n/;

/** One private-key BEGIN line. Referenced by holdback, flush, and redaction. */
const PRIVATE_KEY_BEGIN_LINE = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----/;

export function privateKeyBlockIsClosed(text: string): boolean {
  return PRIVATE_KEY_END_LINE.test(text);
}

export function firstUnterminatedPemBegin(pending: string): number {
  const finder = new RegExp(PRIVATE_KEY_BEGIN_LINE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = finder.exec(pending)) !== null) {
    if (!privateKeyBlockIsClosed(pending.slice(match.index))) return match.index;
  }
  return -1;
}

export function redactLogText(text: string): string {
  const closedBlock = new RegExp(
    `${PRIVATE_KEY_BEGIN_LINE.source}\\r?\\n[\\s\\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----`,
    "g",
  );
  let out = text.replace(
    closedBlock,
    `-----BEGIN $1-----\n${REDACTED}\n-----END $1-----`,
  );
  out = out.replace(
    /((?:Proxy-)?Authorization:\s+)(\S+)(?:\s+(\S+))?/gi,
    (_m, head: string, scheme: string, cred: string | undefined) =>
      cred === undefined ? head + REDACTED : `${head}${scheme} ${REDACTED}`,
  );
  out = out.replace(/(?<![A-Za-z-])Bearer\s+\S+/g, `Bearer ${REDACTED}`);
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{8,}/g, REDACTED);
  out = out.replace(/\bghp_[A-Za-z0-9_]{8,}/g, REDACTED);
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED);
  out = out.replace(/(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{10,}/g, REDACTED);
  return out;
}

function asLogStream(stream: string): LogStreamV1 | null {
  return stream === "stdout" || stream === "stderr" ? stream : null;
}

export function createBoundedLog(deps: BoundedLogDepsV1): BoundedLogV1 {
  const stdout = emptyStream();
  const stderr = emptyStream();
  const streams = Object.assign(Object.create(null), { stdout, stderr }) as Record<LogStreamV1, StreamState>;
  let runBytesIn = 0;
  let mustHalt = false;
  let haltReason: string | null = null;
  let haltedAt: IsoTimestamp | null = null;
  let lastWriteAt: IsoTimestamp | null = null;

  function ingestRedacted(stream: LogStreamV1, payload: Buffer): void {
    if (payload.length === 0) return;
    const state = streams[stream];
    const sink = deps.sinks[stream];
    const instant = lastWriteAt ?? deps.clock.now();

    const nextLive = Buffer.concat([state.livePayload, payload]);
    if (nextLive.length > LIVE_TAIL_BYTES) {
      const dropped = nextLive.length - LIVE_TAIL_BYTES;
      state.livePayload = nextLive.subarray(dropped);
      state.droppedLiveBytes += dropped;
      state.liveTruncated = true;
      state.truncatedAt ??= instant;
    } else {
      state.livePayload = nextLive;
    }

    const nextFile = Buffer.concat([state.filePayload, payload]);
    if (nextFile.length > FILE_LOG_BYTES) {
      const dropped = nextFile.length - FILE_LOG_BYTES;
      state.filePayload = nextFile.subarray(dropped);
      state.droppedFileBytes += dropped;
      state.fileTruncated = true;
      state.truncatedAt ??= instant;
      sink.replace(fileImageOf(state));
    } else {
      state.filePayload = nextFile;
      sink.append(payload);
    }
  }

  function emitPending(stream: LogStreamV1, force: boolean): void {
    const state = streams[stream];
    if (state.pending.length === 0) return;
    if (force) {
      const emit = redactOpenPrivateKey(state.pending);
      state.pending = "";
      if (emit.length === 0) return;
      ingestRedacted(stream, Buffer.from(redactLogText(emit), "utf8"));
      return;
    }
    const split = splitHoldback(state.pending);
    state.pending = split.hold;
    if (split.emit.length === 0) return;
    ingestRedacted(stream, Buffer.from(redactLogText(split.emit), "utf8"));
  }

  function noteHaltIfNeeded(): void {
    if (runBytesIn <= RUN_LOG_BYTES || mustHalt) return;
    mustHalt = true;
    haltReason = runLogBoundExceededReason(runBytesIn);
    haltedAt = deps.clock.now();
  }

  function write(stream: LogStreamV1, chunk: string | Uint8Array): LogWriteResultV1 {
    const name = asLogStream(stream);
    if (name === null) {
      throw new Error(`bounded log stream must be stdout or stderr, not ${String(stream)}`);
    }
    const raw = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    lastWriteAt = deps.clock.now();
    runBytesIn += raw.length;
    streams[name].pending += raw.toString("utf8");
    emitPending(name, false);
    noteHaltIfNeeded();
    const state = streams[name];
    return {
      mustHalt,
      haltReason,
      liveTruncated: state.liveTruncated,
      fileTruncated: state.fileTruncated,
    };
  }

  function flush(): void {
    lastWriteAt = deps.clock.now();
    emitPending("stdout", true);
    emitPending("stderr", true);
    noteHaltIfNeeded();
  }

  function reportStream(state: StreamState): StreamReportV1 {
    return {
      liveTruncated: state.liveTruncated,
      fileTruncated: state.fileTruncated,
      droppedLiveBytes: state.droppedLiveBytes,
      droppedFileBytes: state.droppedFileBytes,
      livePayloadBytes: state.livePayload.length,
      filePayloadBytes: state.filePayload.length,
      truncatedAt: state.truncatedAt,
    };
  }

  return {
    write,
    flush,
    markDrainIncomplete() {
      write("stdout", "\n[AION_LOG_TRUNCATED dropped=unknown reason=stream-drain-timeout]\n");
    },
    liveTail(stream) {
      const name = asLogStream(stream);
      if (name === null) {
        throw new Error(`bounded log stream must be stdout or stderr, not ${String(stream)}`);
      }
      return liveTailOf(streams[name]);
    },
    fileImage(stream) {
      const name = asLogStream(stream);
      if (name === null) {
        throw new Error(`bounded log stream must be stdout or stderr, not ${String(stream)}`);
      }
      return fileImageOf(streams[name]);
    },
    report() {
      return {
        schema: BOUNDED_LOG_SCHEMA_V1,
        runBytesIn,
        mustHalt,
        haltReason,
        haltedAt,
        lastWriteAt,
        stdout: reportStream(stdout),
        stderr: reportStream(stderr),
      };
    },
  };
}

interface StreamState {
  pending: string;
  livePayload: Buffer;
  filePayload: Buffer;
  liveTruncated: boolean;
  fileTruncated: boolean;
  droppedLiveBytes: number;
  droppedFileBytes: number;
  truncatedAt: IsoTimestamp | null;
}

function emptyStream(): StreamState {
  return {
    pending: "",
    livePayload: Buffer.alloc(0),
    filePayload: Buffer.alloc(0),
    liveTruncated: false,
    fileTruncated: false,
    droppedLiveBytes: 0,
    droppedFileBytes: 0,
    truncatedAt: null,
  };
}

function liveTailOf(state: StreamState): Buffer {
  if (!state.liveTruncated) return state.livePayload;
  return Buffer.concat([Buffer.from(truncationMarker(state.droppedLiveBytes)), state.livePayload]);
}

function fileImageOf(state: StreamState): Buffer {
  if (!state.fileTruncated) return state.filePayload;
  return Buffer.concat([Buffer.from(truncationMarker(state.droppedFileBytes)), state.filePayload]);
}

/**
 * Hold back bytes that might be the start of a secret so a chunk boundary cannot leak them.
 *
 * Every redaction regex assumes whole lines. An unclosed private-key block is held from its
 * `BEGIN` line until the same `END … PRIVATE KEY-----` line the redactor needs, plus its
 * newline. Otherwise the entire unterminated last line is held. Incomplete-starter scanning
 * is not a second spelling of "block open".
 */
function splitHoldback(pending: string): { emit: string; hold: string } {
  const begin = firstUnterminatedPemBegin(pending);
  if (begin >= 0) {
    const held = pending.slice(begin);
    if (held.length > MAX_PEM_HOLD) {
      return { emit: pending, hold: "" };
    }
    return { emit: pending.slice(0, begin), hold: held };
  }

  const lastNl = pending.lastIndexOf("\n");
  const lineStart = lastNl + 1;
  let emit = pending.slice(0, lineStart);
  let hold = pending.slice(lineStart);
  if (hold.length > MAX_TOKEN_HOLD) {
    const keepFrom = secretHoldStart(hold);
    if (keepFrom >= 0) {
      emit += hold.slice(0, keepFrom);
      hold = hold.slice(keepFrom);
      if (hold.length > SECRET_TAIL_BYTES) {
        emit += hold.slice(0, hold.length - SECRET_TAIL_BYTES);
        hold = hold.slice(hold.length - SECRET_TAIL_BYTES);
      }
    } else {
      emit += hold;
      hold = "";
    }
  }
  return { emit, hold };
}

const SECRET_STARTERS = ["ghp_", "github_pat_", "sk-", "AKIA", "Bearer ", "Authorization:", "-----BEGIN "] as const;
const SECRET_STARTER_MAX = Math.max(...SECRET_STARTERS.map((item) => item.length));

function longestSecretStarterPrefixSuffix(hold: string): number {
  const limit = Math.min(SECRET_STARTER_MAX, hold.length);
  for (let n = limit; n >= 1; n -= 1) {
    const suffix = hold.slice(hold.length - n);
    if (SECRET_STARTERS.some((starter) => starter.startsWith(suffix) && suffix.length < starter.length)) {
      return hold.length - n;
    }
  }
  return -1;
}

function secretHoldStart(hold: string): number {
  const windowStart = Math.max(0, hold.length - SECRET_TAIL_BYTES - 32);
  const window = hold.slice(windowStart);
  let earliest = -1;
  for (const starter of SECRET_STARTERS) {
    const at = window.lastIndexOf(starter);
    if (at < 0) continue;
    const abs = windowStart + at;
    if (earliest < 0 || abs < earliest) earliest = abs;
  }
  if (earliest >= 0) return earliest;
  return longestSecretStarterPrefixSuffix(hold);
}

function redactOpenPrivateKey(pending: string): string {
  const begin = firstUnterminatedPemBegin(pending);
  if (begin < 0) return pending;
  const held = pending.slice(begin);
  const match = new RegExp(`^${PRIVATE_KEY_BEGIN_LINE.source}`).exec(held);
  if (match === null) return pending;
  return `${pending.slice(0, begin)}-----BEGIN ${match[1]}-----\n[REDACTED]\n`;
}
