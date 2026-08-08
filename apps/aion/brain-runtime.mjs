import { scoreCase, validateEndpointUrl } from "../../packages/local-assistant/dist/index.js";

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
 * One bounded completion, used by the evaluation harness.
 *
 * There is no streaming and no conversation state: a case is one prompt in, one string out, so the
 * measurement is of the endpoint rather than of AION's plumbing around it.
 */
export async function completeOnce(endpoint, { prompt, context = [], signal }) {
  const base = validateEndpointUrl(endpoint.baseUrl, endpoint.location);
  const token = credential(endpoint);
  const system = context.length ? `Context you may use:\n${context.join("\n")}` : "";
  const startedAt = Date.now();

  if (endpoint.runtime === "ollama") {
    const result = await request(new URL("/api/chat", base).toString(), {
      method: "POST", timeoutMs: COMPLETION_TIMEOUT_MS, signal,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: {
        model: endpoint.model, stream: false,
        messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
      },
    });
    if (!result.ok) throw new Error(`The endpoint answered with status ${result.status}.`);
    const parsed = JSON.parse(result.text);
    return { text: String(parsed?.message?.content ?? ""), latencyMs: Date.now() - startedAt };
  }

  const result = await request(new URL("/v1/chat/completions", base).toString(), {
    method: "POST", timeoutMs: COMPLETION_TIMEOUT_MS, signal,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: {
      model: endpoint.model, stream: false,
      messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
    },
  });
  if (!result.ok) throw new Error(`The endpoint answered with status ${result.status}.`);
  const parsed = JSON.parse(result.text);
  return { text: String(parsed?.choices?.[0]?.message?.content ?? ""), latencyMs: Date.now() - startedAt };
}

/**
 * Runs the synthetic evaluation suite against one endpoint.
 *
 * Cases run in order rather than concurrently, because latency is one of the things being measured
 * and a local runtime queues requests anyway. A case that errors is recorded as a failure with the
 * reason rather than aborting the run: how an endpoint fails is itself part of the evidence.
 */
export async function runEvaluation(endpoint, suite, runtime, signal) {
  const results = [];
  for (const evaluationCase of suite) {
    const startedAt = Date.now();
    try {
      const { text, latencyMs } = await runtime.complete(endpoint, { prompt: evaluationCase.prompt, context: evaluationCase.context, signal });
      results.push(scoreCase(evaluationCase, text, latencyMs));
    } catch (error) {
      results.push(scoreCase(evaluationCase, "", Date.now() - startedAt, safeDetail(error?.message) || "the endpoint failed"));
    }
  }
  return results;
}

/** The adapter, as the port the policy module declares. */
export class HttpBrainRuntimeV1 {
  constructor(now = () => new Date().toISOString()) { this.now = now; }
  probe(endpoint, signal) { return probeEndpoint(endpoint, signal, this.now); }
  detect(signal) { return detectLocalRuntimes(signal); }
  complete(endpoint, request_) { return completeOnce(endpoint, request_); }
}
