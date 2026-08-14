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
 * A secret that arrives split across two `write` calls is still redacted: each stream holds
 * back an incomplete token prefix (and an unclosed `BEGIN`/`END` key block) until the next
 * chunk completes it, or until `flush` forces the remainder through the same redaction.
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
const MAX_TOKEN_HOLD = MAX_PEM_HOLD;
const MAX_STARTER_LEN = 14; // "Authorization:"

/** Longest starter we have to recognise as a *prefix* at a chunk boundary. */
const HOLD_STARTERS: ReadonlyArray<{ readonly min: string; readonly full: string }> = [
  { min: "Auth", full: "Authorization:" },
  { min: "B", full: "Bearer " },
  { min: "g", full: "ghp_" },
  { min: "g", full: "github_pat_" },
  { min: "s", full: "sk-" },
  { min: "A", full: "AKIA" },
  { min: "-----BEGIN", full: "-----BEGIN " },
];

const STARTER_FIND = /Authorization:|Bearer |ghp_|github_pat_|sk-|AKIA|-----BEGIN /gi;

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
export function redactLogText(text: string): string {
  let out = text.replace(
    /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----\r?\n[\s\S]*?-----END \1-----/g,
    `-----BEGIN $1-----\n${REDACTED}\n-----END $1-----`,
  );
  out = out.replace(/Authorization:\s+Bearer\s+\S+/gi, `Authorization: Bearer ${REDACTED}`);
  out = out.replace(/Authorization:\s+(?!Bearer\b)\S+/gi, `Authorization: ${REDACTED}`);
  out = out.replace(/(?<![A-Za-z-])Bearer\s+\S+/g, `Bearer ${REDACTED}`);
  out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{8,}/g, REDACTED);
  out = out.replace(/\bghp_[A-Za-z0-9_]{8,}/g, REDACTED);
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED);
  out = out.replace(/(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{10,}/g, REDACTED);
  return out;
}

export function createBoundedLog(deps: BoundedLogDepsV1): BoundedLogV1 {
  const stdout = emptyStream();
  const stderr = emptyStream();
  const streams: Record<LogStreamV1, StreamState> = { stdout, stderr };
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
    const split = force ? { emit: state.pending, hold: "" } : splitHoldback(state.pending);
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
    const raw = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    lastWriteAt = deps.clock.now();
    runBytesIn += raw.length;
    streams[stream].pending += raw.toString("utf8");
    emitPending(stream, false);
    noteHaltIfNeeded();
    const state = streams[stream];
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
    liveTail(stream) {
      return liveTailOf(streams[stream]);
    },
    fileImage(stream) {
      return fileImageOf(streams[stream]);
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
 * Complete lines are emitted (and redacted) immediately. An unclosed private-key block is held
 * from its `BEGIN` line. An incomplete token prefix at the end of an unfinished line is held
 * until a terminator arrives or `flush` forces redaction of whatever is left.
 */
function splitHoldback(pending: string): { emit: string; hold: string } {
  const begin = pending.lastIndexOf("-----BEGIN ");
  if (begin >= 0 && pending.indexOf("-----END ", begin) < 0) {
    const held = pending.slice(begin);
    if (held.length > MAX_PEM_HOLD) {
      return { emit: pending, hold: "" };
    }
    return { emit: pending.slice(0, begin), hold: held };
  }

  const lastNl = pending.lastIndexOf("\n");
  const lineStart = lastNl + 1;
  const rest = pending.slice(lineStart);
  const split = splitTokenPrefix(rest);
  let emit = pending.slice(0, lineStart) + split.emit;
  let hold = split.hold;
  if (hold.length > MAX_TOKEN_HOLD) {
    // Mirror the PEM overflow: emit the whole hold. Retaining a starter-less
    // tail is how a 358-char token leaked after the front was redacted.
    emit += hold;
    hold = "";
  }
  return { emit, hold };
}

function splitTokenPrefix(text: string): { emit: string; hold: string } {
  const incomplete = earliestIncompleteStarter(text);
  if (incomplete >= 0) {
    return { emit: text.slice(0, incomplete), hold: text.slice(incomplete) };
  }
  const prefixAt = trailingStarterPrefix(text);
  if (prefixAt >= 0) {
    return { emit: text.slice(0, prefixAt), hold: text.slice(prefixAt) };
  }
  return { emit: text, hold: "" };
}

function earliestIncompleteStarter(text: string): number {
  STARTER_FIND.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STARTER_FIND.exec(text)) !== null) {
    const start = match.index;
    const after = text.slice(start + match[0].length);
    if (/[\s,;]/.test(after)) continue;
    return start;
  }
  return -1;
}

function trailingStarterPrefix(text: string): number {
  const start = Math.max(0, text.length - MAX_STARTER_LEN);
  for (let index = start; index < text.length; index += 1) {
    if (isStarterPrefix(text.slice(index))) return index;
  }
  return -1;
}

function isStarterPrefix(rest: string): boolean {
  const lower = rest.toLowerCase();
  if (lower.length === 0) return false;
  for (const starter of HOLD_STARTERS) {
    const full = starter.full.toLowerCase();
    // Min is 1 for token starters so "g"/"B"/"s" hold. Authorization stays
    // "Auth" and AKIA stays "AKI" so a 16 MiB flood of `a` is not held back
    // one byte at a time.
    if (
      full.startsWith(lower)
      && lower.length >= starter.min.length
      && lower.length < full.length
    ) {
      return true;
    }
  }
  return false;
}
