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
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";
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
  /**
   * True when an injected sink threw. The run must not report success
   * with an empty log and no indication anything was lost.
   */
  readonly sinkFailed: boolean;
}

export interface LogWriteResultV1 {
  readonly mustHalt: boolean;
  readonly haltReason: string | null;
  readonly liveTruncated: boolean;
  readonly fileTruncated: boolean;
}

export interface BoundedLogV1 {
  write(stream: LogStreamV1, chunk: string | Uint8Array): LogWriteResultV1;
  /**
   * Durability flush on a live log. Emits completed lines and closed
   * blocks. Does not end the secret-holdback regime: an open PEM or an
   * incomplete token stays held so a later write cannot leak past a
   * mid-run flush.
   */
  flush(): void;
  /**
   * True end-of-stream. Call only after the pumps are detached.
   */
  seal(): void;
  markDrainIncomplete(stream?: LogStreamV1): void;
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

/** File-backed sink for `stdout.log` / `stderr.log` under a run root. */
export function createFileLogSink(filePath: string): LogSinkV1 {
  // Construction is not a write. Truncating here destroyed the previous
  // log on every refused retry, including ones that never spawned.
  let prepared = false;
  const prepare = (): void => {
    if (prepared) return;
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, Buffer.alloc(0));
    prepared = true;
  };
  return {
    append(bytes) {
      prepare();
      appendFileSync(filePath, Buffer.from(bytes));
    },
    replace(bytes) {
      prepare();
      writeFileSync(filePath, Buffer.from(bytes));
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

/** First BEGIN, whether the following block is closed or still open. */
function firstPemBegin(pending: string): number {
  const match = new RegExp(PRIVATE_KEY_BEGIN_LINE.source).exec(pending);
  return match === null ? -1 : match.index;
}

export function redactLogText(text: string): string {
  const closedBlock = new RegExp(
    `${PRIVATE_KEY_BEGIN_LINE.source}[\\s\\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----`,
    "g",
  );
  let out = text.replace(
    closedBlock,
    `-----BEGIN $1-----\n${REDACTED}\n-----END $1-----`,
  );
  out = out.replace(
    /((?:Proxy-)?Authorization"?[^\S\r\n]*:[^\S\r\n]*)(?:(Bearer|Basic|Digest|Negotiate|NTLM|Token|ApiKey)([^\S\r\n]+))?[^\s\r\n]+/gi,
    (_m, head: string, scheme: string | undefined, space: string | undefined) =>
      `${head}${scheme ?? ""}${space ?? ""}${REDACTED}`,
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
  let sinkFailed = false;

  const writeSink = (op: () => void): void => {
    try {
      op();
    } catch {
      sinkFailed = true;
    }
  };

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
      writeSink(() => sink.replace(fileImageOf(state)));
    } else {
      state.filePayload = nextFile;
      writeSink(() => sink.append(payload));
    }
  }

  function accountHoldbackDrop(stream: LogStreamV1, state: StreamState, droppedBytes: number): void {
    if (droppedBytes <= 0) return;
    const instant = lastWriteAt ?? deps.clock.now();
    state.droppedLiveBytes += droppedBytes;
    state.droppedFileBytes += droppedBytes;
    state.liveTruncated = true;
    state.fileTruncated = true;
    state.truncatedAt ??= instant;
    // The report already counted these bytes. Re-image so the on-disk
    // artifact carries `[AION_LOG_TRUNCATED dropped=N]`. Do not add the
    // marker length to droppedFileBytes.
    writeSink(() => deps.sinks[stream].replace(fileImageOf(state)));
  }

  function emitPending(stream: LogStreamV1, force: boolean): void {
    const state = streams[stream];
    if (force) {
      state.pending += state.decoder.end();
      state.decoder = new StringDecoder("utf8");
    }
    if (state.pending.length === 0) return;
    if (force) {
      // pemOverflow means we are between a consumed BEGIN and its END.
      // Flush must not ship the held body as plaintext just because the
      // block never terminated. Drop when there is neither a BEGIN nor
      // an END line left to emit.
      if (state.pemOverflow && !PRIVATE_KEY_BEGIN_LINE.test(state.pending)) {
        // pemOverflow means the retained bytes are known private-key body.
        // The module's one terminator spelling requires the trailing
        // newline. An END without it is still open: drop the body.
        // A closed block still must not ship the retained body — emit
        // only from the END line, same as the split-time overflow tail.
        if (!privateKeyBlockIsClosed(state.pending)) {
          const dropped = Buffer.byteLength(state.pending, "utf8");
          state.pending = "";
          state.pemOverflow = true;
          accountHoldbackDrop(stream, state, dropped);
          return;
        }
        const endFinder = new RegExp(PRIVATE_KEY_END_LINE.source);
        const endMatch = endFinder.exec(state.pending);
        if (endMatch !== null && endMatch.index !== undefined) {
          const discarded = state.pending.slice(0, endMatch.index);
          const emit = state.pending.slice(endMatch.index);
          state.pending = "";
          state.pemOverflow = false;
          accountHoldbackDrop(stream, state, Buffer.byteLength(discarded, "utf8"));
          if (emit.length > 0) {
            ingestRedacted(stream, Buffer.from(redactLogText(emit), "utf8"));
          }
          return;
        }
      }
      const hadOpenBegin = firstUnterminatedPemBegin(state.pending) >= 0 || state.pemOverflow;
      const redacted = redactOpenPrivateKey(state.pending);
      const stillOpen = hadOpenBegin && !privateKeyBlockIsClosed(redacted.text);
      state.pending = "";
      state.pemOverflow = stillOpen;
      accountHoldbackDrop(stream, state, redacted.droppedBytes);
      if (redacted.text.length === 0) return;
      ingestRedacted(stream, Buffer.from(redactLogText(redacted.text), "utf8"));
      return;
    }
    const split = splitHoldback(state);
    state.pending = split.hold;
    accountHoldbackDrop(stream, state, split.droppedBytes);
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
    streams[name].pending += streams[name].decoder.write(raw);
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
    emitDurability("stdout");
    emitDurability("stderr");
    noteHaltIfNeeded();
  }

  function seal(): void {
    lastWriteAt = deps.clock.now();
    emitPending("stdout", true);
    emitPending("stderr", true);
    noteHaltIfNeeded();
  }

  function emitDurability(stream: LogStreamV1): void {
    const state = streams[stream];
    state.pending += state.decoder.end();
    state.decoder = new StringDecoder("utf8");
    if (state.pending.length === 0) return;
    const openPem = state.pemOverflow || firstUnterminatedPemBegin(state.pending) >= 0;
    const secretAt = secretHoldStart(state.pending);
    const starterAt = longestSecretStarterPrefixSuffix(state.pending);
    if (openPem || secretAt >= 0 || starterAt >= 0) {
      const split = splitHoldback(state);
      state.pending = split.hold;
      if (openPem) state.pemOverflow = true;
      accountHoldbackDrop(stream, state, split.droppedBytes);
      if (split.emit.length > 0) {
        ingestRedacted(stream, Buffer.from(redactLogText(split.emit), "utf8"));
      }
      return;
    }
    const redacted = redactOpenPrivateKey(state.pending);
    state.pending = "";
    accountHoldbackDrop(stream, state, redacted.droppedBytes);
    if (redacted.text.length === 0) return;
    ingestRedacted(stream, Buffer.from(redactLogText(redacted.text), "utf8"));
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
    seal,
    markDrainIncomplete(stream?: LogStreamV1) {
      lastWriteAt = deps.clock.now();
      const marker = Buffer.from("\n[AION_LOG_TRUNCATED dropped=unknown reason=stream-drain-timeout]\n", "utf8");
      const names: readonly LogStreamV1[] = stream === "stderr" || stream === "stdout"
        ? [stream]
        : ["stdout", "stderr"];
      for (const name of names) {
        ingestRedacted(name, marker);
      }
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
        sinkFailed,
      };
    },
  };
}

interface StreamState {
  pending: string;
  decoder: StringDecoder;
  livePayload: Buffer;
  filePayload: Buffer;
  liveTruncated: boolean;
  fileTruncated: boolean;
  droppedLiveBytes: number;
  droppedFileBytes: number;
  truncatedAt: IsoTimestamp | null;
  /**
   * True while a BEGIN was consumed by the overflow path and its END has
   * not yet been emitted. Reset when the END is emitted or the hold is
   * force-dropped. Not "ever overflowed".
   */
  pemOverflow: boolean;
}

function emptyStream(): StreamState {
  return {
    pending: "",
    decoder: new StringDecoder("utf8"),
    livePayload: Buffer.alloc(0),
    filePayload: Buffer.alloc(0),
    liveTruncated: false,
    fileTruncated: false,
    droppedLiveBytes: 0,
    droppedFileBytes: 0,
    truncatedAt: null,
    pemOverflow: false,
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
function splitHoldback(state: StreamState): { emit: string; hold: string; droppedBytes: number } {
  const pending = state.pending;
  // pemOverflow: any BEGIN starts a new block. firstUnterminatedPemBegin
  // skips a closed second key and would emit the retained first-key tail.
  const begin = state.pemOverflow ? firstPemBegin(pending) : firstUnterminatedPemBegin(pending);
  if (begin >= 0) {
    const held = pending.slice(begin);
    if (state.pemOverflow) {
      // A second BEGIN arrived while the overflow tail still held the
      // first key's body. Those retained bytes are known private-key
      // material: drop them. Do not emit pending.slice(0, begin).
      const droppedPrefix = pending.slice(0, begin);
      const droppedBytes = Buffer.byteLength(droppedPrefix, "utf8");
      if (held.length > MAX_PEM_HOLD) {
        const tailStart = Math.max(0, held.length - SECRET_TAIL_BYTES);
        return {
          emit: "",
          hold: held.slice(tailStart),
          droppedBytes: droppedBytes + Buffer.byteLength(held.slice(0, tailStart), "utf8"),
        };
      }
      state.pemOverflow = false;
      if (privateKeyBlockIsClosed(held)) {
        return { emit: held, hold: "", droppedBytes };
      }
      return { emit: "", hold: held, droppedBytes };
    }
    if (held.length > MAX_PEM_HOLD) {
      state.pemOverflow = true;
      const tailStart = Math.max(begin, pending.length - SECRET_TAIL_BYTES);
      const redacted = redactOpenPrivateKey(pending.slice(0, tailStart));
      return {
        emit: redacted.text,
        hold: pending.slice(tailStart),
        droppedBytes: redacted.droppedBytes,
      };
    }
    return { emit: pending.slice(0, begin), hold: held, droppedBytes: 0 };
  }

  // Overflow tail: BEGIN was already redacted; emit END without the body.
  // Gated on pemOverflow so a bare END line on a stream that never overflowed
  // cannot delete the preceding ordinary output.
  if (state.pemOverflow && !PRIVATE_KEY_BEGIN_LINE.test(pending)) {
    const endFinder = /-----END [A-Z0-9 ]*PRIVATE KEY-----[^\n]*\n/;
    const endMatch = endFinder.exec(pending);
    if (endMatch !== null && endMatch.index !== undefined) {
      state.pemOverflow = false;
      const discarded = pending.slice(0, endMatch.index);
      return {
        emit: pending.slice(endMatch.index),
        hold: "",
        droppedBytes: Buffer.byteLength(discarded, "utf8"),
      };
    }
    // Stay in the hold. The generic last-newline emit would ship the
    // 64-column PEM body as plaintext. Keep only the bounded tail.
    if (pending.length > SECRET_TAIL_BYTES) {
      const hold = pending.slice(pending.length - SECRET_TAIL_BYTES);
      return {
        emit: "",
        hold,
        droppedBytes: Buffer.byteLength(pending.slice(0, pending.length - SECRET_TAIL_BYTES), "utf8"),
      };
    }
    return { emit: "", hold: pending, droppedBytes: 0 };
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
  return { emit, hold, droppedBytes: 0 };
}

// Holdback anchors, lower-cased. Must cover every redactor match of
// `((?:Proxy-)?Authorization"?[^\S\r\n]*:)` — including `authorization:`,
// `Authorization :`, `Authorization":`, and `proxy-authorization:`.
// `authorization` is the shared stem; both sides of the scan are folded.
const SECRET_STARTERS = [
  "ghp_",
  "github_pat_",
  "sk-",
  "akia",
  "bearer ",
  "authorization",
  "proxy-authorization",
  "-----begin ",
] as const;
const SECRET_STARTER_MAX = Math.max(...SECRET_STARTERS.map((item) => item.length));

function longestSecretStarterPrefixSuffix(hold: string): number {
  const folded = hold.toLowerCase();
  const limit = Math.min(SECRET_STARTER_MAX, folded.length);
  for (let n = limit; n >= 1; n -= 1) {
    const suffix = folded.slice(folded.length - n);
    if (SECRET_STARTERS.some((starter) => starter.startsWith(suffix) && suffix.length < starter.length)) {
      return hold.length - n;
    }
  }
  return -1;
}

function secretHoldStart(hold: string): number {
  const windowStart = Math.max(0, hold.length - SECRET_TAIL_BYTES - 32);
  const window = hold.slice(windowStart);
  const folded = window.toLowerCase();
  let earliest = -1;
  for (const starter of SECRET_STARTERS) {
    const at = folded.lastIndexOf(starter);
    if (at < 0) continue;
    const abs = windowStart + at;
    if (earliest < 0 || abs < earliest) earliest = abs;
  }
  if (earliest >= 0) return earliest;
  return longestSecretStarterPrefixSuffix(hold);
}

function redactOpenPrivateKey(pending: string): { text: string; droppedBytes: number } {
  const begin = firstUnterminatedPemBegin(pending);
  if (begin < 0) return { text: pending, droppedBytes: 0 };
  const held = pending.slice(begin);
  const match = new RegExp(`^${PRIVATE_KEY_BEGIN_LINE.source}`).exec(held);
  if (match === null) return { text: pending, droppedBytes: 0 };
  const discarded = held.slice(match[0].length);
  return {
    text: `${pending.slice(0, begin)}-----BEGIN ${match[1]}-----\n[REDACTED]\n`,
    droppedBytes: Buffer.byteLength(discarded, "utf8"),
  };
}
