import { runEvaluationSuite, validateEndpointUrl } from "../../packages/local-assistant/dist/index.js";

import { assertOutwardEffectAllowed } from "./outward-effect-guard.mjs";

/**
 * Inference against a loopback runtime stays on this machine; against anything else it does not.
 *
 * validateEndpointUrl permits a third-party-service endpoint, so this file is not unconditionally
 * local. Only the non-loopback case is an outward effect, and only that case is gated -- gating a
 * local model would make the private-by-default path require Owner authority for nothing.
 */
function assertBrainTransportAllowed(url) {
  const host = new URL(String(url)).hostname.toLowerCase();
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  if (loopback) return;
  assertOutwardEffectAllowed("brain.remoteInference", { host });
}

/**
 * The only place AION talks to an inference runtime.
 *
 * Everything about *whether* a request is allowed lives in the policy module and is decided before
 * anything here runs. This file is the narrow adapter that carries out an already-authorised
 * request, and it is deliberately small: probe an endpoint, look at a short fixed list of
 * documented loopback addresses, and run one bounded completion.
 *
 * What it does not do is as important as what it does. It installs nothing, downloads no model,
 * starts no server, and searches no part of the computer. Detection is a handful of requests to
 * addresses that are written down here in full — if a runtime is listening on one of them AION
 * says so, and if not it says that instead of guessing.
 */

const PROBE_TIMEOUT_MS = 4000;
const COMPLETION_TIMEOUT_MS = 120_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

/**
 * Documented default addresses for the runtimes AION supports. A short fixed list, never a scan,
 * and loopback only: detection exists to notice something the owner already installed on this
 * computer, not to find services on their network.
 */
export const DOCUMENTED_RUNTIMES = [
  { runtime: "ollama", baseUrl: "http://127.0.0.1:11434", modelsPath: "/api/tags", label: "Ollama" },
  { runtime: "openai-compatible", baseUrl: "http://127.0.0.1:1234", modelsPath: "/v1/models", label: "An OpenAI-compatible server (LM Studio's default port)" },
  { runtime: "llama-cpp", baseUrl: "http://127.0.0.1:8080", modelsPath: "/v1/models", label: "llama.cpp server" },
  { runtime: "vllm", baseUrl: "http://127.0.0.1:8000", modelsPath: "/v1/models", label: "vLLM" },
];

/** Removes absolute local paths and anything credential-shaped from text that reaches the browser. */
function safeDetail(value) {
  return String(value ?? "")
    .replace(/[A-Za-z]:[\\/][^\s"'<>|]*/gu, "[local path]")
    .replace(/\b(?:sk|key|token|bearer)[-_a-z0-9]{8,}/giu, "[redacted]")
    .slice(0, 500);
}

async function readBounded(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); break; }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function request(url, { method = "GET", body = null, headers = {}, timeoutMs, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const startedAt = Date.now();
  try {
    assertBrainTransportAllowed(url);
    const response = await globalThis.fetch(url, {
      method, signal: controller.signal, redirect: "error",
      headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: response.ok, status: response.status, text: await readBounded(response), latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * The credential for an endpoint, read from the environment variable the owner *named*.
 *
 * AION stores the name and never the value, so this is the only moment a secret exists inside the
 * process, and it never reaches state, Activity, a log, or the browser.
 */
function credential(endpoint) {
  const name = endpoint.credentialEnvironmentVariable;
  if (!name || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(name)) return null;
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function modelNames(runtime, text) {
  try {
    const parsed = JSON.parse(text);
    if (runtime === "ollama") {
      return Array.isArray(parsed?.models) ? parsed.models.map((entry) => String(entry?.name ?? "")).filter(Boolean).slice(0, 50) : [];
    }
    return Array.isArray(parsed?.data) ? parsed.data.map((entry) => String(entry?.id ?? "")).filter(Boolean).slice(0, 50) : [];
  } catch { return []; }
}

/**
 * Asks one configured endpoint whether it is there.
 *
 * A probe is a read: it lists models and nothing else. It never sends a prompt, so probing a
 * third-party endpoint costs nothing and reveals nothing about the owner.
 */
export async function probeEndpoint(endpoint, signal, now = () => new Date().toISOString()) {
  const checkedAt = now();
  if (endpoint.runtime === "deterministic-offline") {
    return { available: true, detail: "The offline provider is always available. It performs no network request and needs no model file.", checkedAt, latencyMs: 0, installedModels: [] };
  }
  let base;
  try { base = validateEndpointUrl(endpoint.baseUrl, endpoint.location); }
  catch (error) { return { available: false, detail: safeDetail(error?.message), checkedAt, latencyMs: null, installedModels: [] }; }

  const path = endpoint.runtime === "ollama" ? "/api/tags" : "/v1/models";
  const token = credential(endpoint);
  try {
    const result = await request(new URL(path, base).toString(), {
      timeoutMs: PROBE_TIMEOUT_MS, signal,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!result.ok) {
      return { available: false, detail: `The endpoint answered with status ${result.status}.${result.status === 401 || result.status === 403 ? ` Check that ${endpoint.credentialEnvironmentVariable || "a credential environment variable"} is set in this shell.` : ""}`, checkedAt, latencyMs: result.latencyMs, installedModels: [] };
    }
    const models = modelNames(endpoint.runtime, result.text);
    const hasModel = !endpoint.model || !models.length || models.some((name) => name === endpoint.model || name.startsWith(`${endpoint.model}:`));
    return {
      available: true,
      detail: hasModel
        ? `Reachable. ${models.length ? `${models.length} model(s) available.` : "It reported no model list."}`
        : `Reachable, but it did not report "${endpoint.model}". Available: ${models.slice(0, 5).join(", ")}.`,
      checkedAt, latencyMs: result.latencyMs, installedModels: models,
    };
  } catch (error) {
    const reason = error?.name === "AbortError" ? `it did not answer within ${PROBE_TIMEOUT_MS} ms` : safeDetail(error?.message) || "the connection failed";
    return { available: false, detail: `Not reachable: ${reason}.`, checkedAt, latencyMs: null, installedModels: [] };
  }
}

/**
 * Looks for a runtime already installed on this computer.
 *
 * Only the addresses in DOCUMENTED_RUNTIMES are tried, all of them loopback. AION reports what
 * answered; adding it as an endpoint is a separate, explicit owner act, because a service
 * listening on a port is not the same thing as a decision to reason on it.
 */
export async function detectLocalRuntimes(signal) {
  const found = [];
  for (const candidate of DOCUMENTED_RUNTIMES) {
    try {
      const result = await request(new URL(candidate.modelsPath, candidate.baseUrl).toString(), { timeoutMs: PROBE_TIMEOUT_MS, signal });
      if (!result.ok) continue;
      const models = modelNames(candidate.runtime, result.text);
      found.push({
        runtime: candidate.runtime, baseUrl: candidate.baseUrl, models,
        detail: `${candidate.label} answered on ${candidate.baseUrl}. ${models.length ? `Models already installed: ${models.slice(0, 10).join(", ")}.` : "It reported no installed model yet — install one with that runtime's own tooling."} AION has not added this as an endpoint, downloaded anything, or changed any setting.`,
      });
    } catch { /* nothing is listening there, which is the ordinary case */ }
  }
  return found;
}

/**
 * Streaming-first HTTP completion.
 *
 * Ollama uses NDJSON (`stream: true`). OpenAI-compatible runtimes use SSE. Partial chunks are
 * buffered; one HTTP chunk is never assumed to be one JSON object. AbortSignal propagates,
 * including already-aborted. Reasoning/thinking fields are emitted on a separate channel with
 * zero authority.
 */
export async function *streamOnce(endpoint, { prompt, context = [], signal }) {
  if (signal?.aborted) throw new Error("Inference cancelled.");
  const base = validateEndpointUrl(endpoint.baseUrl, endpoint.location);
  const token = credential(endpoint);
  const system = context.length ? `Context you may use:\n${context.join("\n")}` : "";
  const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }];
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMPLETION_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) throw new Error("Inference cancelled.");
    if (endpoint.runtime === "ollama") {
      assertBrainTransportAllowed(new URL("/api/chat", base).toString());
      const response = await globalThis.fetch(new URL("/api/chat", base).toString(), {
        method: "POST",
        signal: controller.signal,
        redirect: "error",
        headers,
        body: JSON.stringify({ model: endpoint.model, stream: true, messages }),
      });
      if (!response.ok) throw new Error(`The endpoint answered with status ${response.status}.`);
      yield * parseOllamaNdjson(response, controller.signal);
      return;
    }

    assertBrainTransportAllowed(new URL("/v1/chat/completions", base).toString());
    const response = await globalThis.fetch(new URL("/v1/chat/completions", base).toString(), {
      method: "POST",
      signal: controller.signal,
      redirect: "error",
      headers,
      body: JSON.stringify({ model: endpoint.model, stream: true, messages }),
    });
    if (!response.ok) throw new Error(`The endpoint answered with status ${response.status}.`);
    yield * parseOpenAiSse(response, controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function *parseOllamaNdjson(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  for (;;) {
    if (signal.aborted) { await reader.cancel(); throw new Error("Inference cancelled."); }
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("Provider response exceeds the V1 size limit."); }
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let parsed;
      try { parsed = JSON.parse(line); }
      catch { throw new Error("Malformed Ollama NDJSON frame."); }
      const thinking = parsed?.message?.thinking;
      if (typeof thinking === "string" && thinking) yield { channel: "reasoning", text: thinking };
      const content = parsed?.message?.content;
      if (typeof content === "string" && content) yield { channel: "answer", text: content };
      if (parsed?.done) return;
    }
  }
  const tail = buffer.trim();
  if (tail) {
    try {
      const parsed = JSON.parse(tail);
      const thinking = parsed?.message?.thinking;
      if (typeof thinking === "string" && thinking) yield { channel: "reasoning", text: thinking };
      const content = parsed?.message?.content;
      if (typeof content === "string" && content) yield { channel: "answer", text: content };
    } catch { throw new Error("Malformed Ollama NDJSON frame."); }
  }
}

async function *parseOpenAiSse(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  for (;;) {
    if (signal.aborted) { await reader.cancel(); throw new Error("Inference cancelled."); }
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("Provider response exceeds the V1 size limit."); }
    buffer += decoder.decode(value, { stream: true });
    let separator;
    while ((separator = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, separator).replace(/\r$/u, "");
      buffer = buffer.slice(separator + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") return;
      let parsed;
      try { parsed = JSON.parse(data); }
      catch { throw new Error("Malformed OpenAI-compatible SSE frame."); }
      const delta = parsed?.choices?.[0]?.delta ?? {};
      const reasoning = delta.reasoning_content ?? delta.reasoning ?? parsed?.choices?.[0]?.message?.reasoning;
      if (typeof reasoning === "string" && reasoning) yield { channel: "reasoning", text: reasoning };
      const content = delta.content ?? parsed?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content) yield { channel: "answer", text: content };
    }
  }
}

/**
 * One bounded completion as a thin drain of the streaming primitive.
 */
export async function completeOnce(endpoint, request) {
  const startedAt = Date.now();
  let text = "";
  for await (const chunk of streamOnce(endpoint, request)) {
    if (chunk.channel === "answer") text += chunk.text;
    if (text.length > 100_000) throw new Error("Provider response exceeds the V1 size limit.");
  }
  return { text, latencyMs: Date.now() - startedAt };
}

/**
 * Active evaluation entry point. Uses the domain suite loop with transport redaction.
 * Dead-path note: callers must use this (or service.evaluateEndpoint) rather than a parallel
 * scorer. Redaction is active on the evaluation error path.
 */
export async function runEvaluation(endpoint, suite, runtime, signal) {
  return runEvaluationSuite(endpoint, suite, runtime, { ...(signal ? { signal } : {}), redact: safeDetail });
}

/** The adapter, as the port the policy module declares. */
export class HttpBrainRuntimeV1 {
  constructor(now = () => new Date().toISOString()) { this.now = now; }
  /**
   * Anything with an address. The offline provider has none by design, so it is served by the
   * in-process adapter instead -- inventing a URL for it would make its benchmark meaningless.
   */
  supports(endpoint) { return endpoint.runtime !== "deterministic-offline" && Boolean(endpoint.baseUrl); }
  probe(endpoint, signal) { return probeEndpoint(endpoint, signal, this.now); }
  detect(signal) { return detectLocalRuntimes(signal); }
  stream(endpoint, request) { return streamOnce(endpoint, request); }
  complete(endpoint, request_) { return completeOnce(endpoint, request_); }
}
