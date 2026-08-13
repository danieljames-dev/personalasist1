/**
 * Executor stdout/stderr must not fill the disk.
 */
export const LOG_LIMITS = Object.freeze({
  maxLiveBytes: 256 * 1024,
  maxFileBytes: 8 * 1024 * 1024,
  maxRunRawBytes: 16 * 1024 * 1024,
  tailKeepBytes: 64 * 1024,
  marker: "\n[AION_LOG_TRUNCATED]\n",
});

export function ingestChunk(state, chunk, limits = LOG_LIMITS) {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  const next = {
    bytesIn: (state.bytesIn || 0) + buf.length,
    live: Buffer.concat([state.live || Buffer.alloc(0), buf]),
    durable: Buffer.concat([state.durable || Buffer.alloc(0), buf]),
    truncatedLive: Boolean(state.truncatedLive),
    truncatedDurable: Boolean(state.truncatedDurable),
    dropped: state.dropped || 0,
  };
  if (next.live.length > limits.maxLiveBytes) {
    const tail = next.live.subarray(next.live.length - limits.tailKeepBytes);
    next.live = Buffer.concat([Buffer.from(limits.marker), tail]);
    next.truncatedLive = true;
  }
  if (next.durable.length > limits.maxFileBytes) {
    const tail = next.durable.subarray(next.durable.length - limits.tailKeepBytes);
    next.durable = Buffer.concat([Buffer.from(limits.marker), tail]);
    next.truncatedDurable = true;
  }
  if (next.bytesIn > limits.maxRunRawBytes) {
    next.dropped += buf.length;
    next.haltInput = true;
  }
  return next;
}

export function emptyLogState() {
  return {
    bytesIn: 0,
    live: Buffer.alloc(0),
    durable: Buffer.alloc(0),
    truncatedLive: false,
    truncatedDurable: false,
    dropped: 0,
    haltInput: false,
  };
}
