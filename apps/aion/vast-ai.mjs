import { assertOutwardEffectAllowed } from "./outward-effect-guard.mjs";
import { normaliseOffer, redactCredentials } from "../../packages/local-assistant/dist/index.js";

/**
 * The Vast.ai infrastructure adapter.
 *
 * Vast.ai rents GPUs. It is not AION's brain, it is not an inference protocol, and nothing about
 * it belongs in the model contracts — this file exists so that swapping it for another host means
 * writing one more adapter and changing nothing else.
 *
 * Three properties matter more than completeness here, because this is the only file in AION that
 * can cost money:
 *
 *   1. **The credential is read by name, at the moment of the request, and never stored.** AION
 *      holds the *name* of an environment variable. It does not search for a key, does not accept
 *      one pasted into Chat, and never writes one anywhere.
 *   2. **Provisioning is off unless the composition root turns it on.** `allowProvisioning`
 *      defaults to false, so even a bug in the service layer cannot rent a machine. The service's
 *      approval check is the boundary; this is the second lock on the same door.
 *   3. **Parsing is separable from transport.** `normaliseVastOffer` is a pure function, so the
 *      shape of a real response can be tested without an account, a key, or a network.
 */

const API_ROOT = "https://console.vast.ai/api/v0";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** The environment variable AION reads by default. The owner may name a different one. */
export const DEFAULT_VAST_CREDENTIAL_VARIABLE = "AION_VAST_API_KEY";

/**
 * Turns one Vast.ai bundle into AION's provider-neutral offer shape.
 *
 * Pure and total: unknown fields are dropped, missing ones stay absent rather than being invented,
 * and prices are converted from dollars-per-hour floats into whole cents so no money arithmetic
 * ever touches a float. Rounding is upward, because a rented machine that costs a fraction of a
 * cent more than AION predicted should never be able to slip under a spending limit.
 */
export function normaliseVastOffer(raw, retrievedAt) {
  const dollarsToCents = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.ceil(value * 100) : 0);
  const gpuCount = Number.isSafeInteger(raw?.num_gpus) && raw.num_gpus > 0 ? raw.num_gpus : 1;
  // Vast reports per-GPU VRAM in MB. AION's contract is whole GB per GPU.
  const vramGb = typeof raw?.gpu_ram === "number" && raw.gpu_ram > 0 ? Math.floor(raw.gpu_ram / 1024) : undefined;
  return normaliseOffer(
    {
      offerRef: String(raw?.id ?? ""),
      gpuName: typeof raw?.gpu_name === "string" && raw.gpu_name.trim() ? raw.gpu_name.trim() : "unspecified GPU",
      gpuCount,
      vramGb,
      hourlyCents: dollarsToCents(raw?.dph_total),
      storageCentsPerHour: dollarsToCents(raw?.storage_cost) / 30 / 24 > 0 ? Math.ceil((raw.storage_cost ?? 0) * 100 / 30 / 24) : 0,
      diskGb: typeof raw?.disk_space === "number" ? Math.floor(raw.disk_space) : undefined,
      // Vast reports reliability as a 0-1 fraction. Anything else is treated as unreported.
      reliability: typeof raw?.reliability2 === "number" && raw.reliability2 >= 0 && raw.reliability2 <= 1 ? Math.round(raw.reliability2 * 100) : undefined,
      region: typeof raw?.geolocation === "string" ? raw.geolocation : undefined,
      netDownMbps: typeof raw?.inet_down === "number" ? raw.inet_down : undefined,
      verified: typeof raw?.verified === "boolean" ? raw.verified : undefined,
    },
    "vast-ai",
    retrievedAt,
  );
}

/** The query Vast.ai expects. Built from AION's filter, never from anything a model produced. */
export function buildVastQuery(filter) {
  return {
    verified: { eq: true },
    rentable: { eq: true },
    gpu_ram: { gte: Math.max(1, Math.floor(filter.minimumVramGb)) * 1024 },
    dph_total: { lte: Math.max(0.01, filter.maxHourlyCents / 100) },
    ...(filter.minimumReliability === null ? {} : { reliability2: { gte: filter.minimumReliability / 100 } }),
    order: [["dph_total", "asc"]],
    type: "on-demand",
    limit: Math.max(1, Math.min(200, filter.limit ?? 20)),
  };
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

export class VastAiInfrastructureV1 {
  provider = "vast-ai";

  /**
   * @param options.variableName  Name of the environment variable holding the API key.
   * @param options.allowProvisioning  Must be explicitly true before `start` will do anything.
   * @param options.now  Clock, injected so results are reproducible in tests.
   */
  constructor(options = {}) {
    this.variableName = options.variableName ?? DEFAULT_VAST_CREDENTIAL_VARIABLE;
    this.allowProvisioning = options.allowProvisioning === true;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * The key, read from the environment at the moment of use.
   *
   * This is the only place the value exists, it exists for the duration of one request, and it is
   * never returned to a caller. AION does not go looking for it: if the variable is not set, the
   * answer is that it is not set.
   */
  #key() {
    if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(this.variableName)) return null;
    const value = process.env[this.variableName];
    return value && value.trim() ? value.trim() : null;
  }

  async #request(path, { method = "GET", body = null, signal } = {}) {
    // A credential in the environment is not permission to spend against it.
    assertOutwardEffectAllowed("vast.api", { path, method });
    const key = this.#key();
    if (!key) throw new Error(`${this.variableName} is not set in this shell, so AION cannot reach Vast.ai. Set it and restart AION; AION stores only the variable name.`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await globalThis.fetch(`${API_ROOT}${path}`, {
        method, signal: controller.signal, redirect: "error",
        headers: { accept: "application/json", authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await readBounded(response);
      if (!response.ok) {
        // The body may echo the request, which may echo the key. Redact before it goes anywhere.
        throw new Error(redactCredentials(`Vast.ai answered ${response.status}: ${text.slice(0, 400)}`));
      }
      try { return JSON.parse(text); } catch { throw new Error("Vast.ai returned something that was not JSON."); }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  async credentialStatus() {
    const configured = this.#key() !== null;
    return {
      configured,
      variableName: this.variableName,
      detail: configured
        ? `${this.variableName} is set in this shell. AION reads it only when it calls Vast.ai and stores only the variable name — never the value.`
        : `${this.variableName} is not set. Set it in the shell that starts AION. Do not paste the key into Chat: AION never stores a credential value and does not need to see one here.`,
    };
  }

  async discover(filter, signal) {
    const payload = await this.#request(`/bundles/?q=${encodeURIComponent(JSON.stringify(buildVastQuery(filter)))}`, { signal });
    const retrievedAt = this.now();
    const bundles = Array.isArray(payload?.offers) ? payload.offers : [];
    const offers = [];
    for (const bundle of bundles) {
      // A bundle AION cannot normalise is skipped rather than guessed at, and the skip is visible
      // in the count the caller reports.
      try { offers.push(normaliseVastOffer(bundle, retrievedAt)); } catch { /* unusable offer */ }
    }
    return offers;
  }

  /**
   * Creates an instance. Refuses unless provisioning was explicitly enabled at construction.
   *
   * The service will not call this without an approved, revalidated, digest-bound proposal. This
   * check exists anyway, because the cost of a mistake here is money rather than a failed test.
   */
  async start(request, signal) {
    if (!this.allowProvisioning) {
      throw new Error("Real Vast.ai provisioning is not enabled in this build. AION can discover and price capacity, and will not rent it until provisioning is deliberately switched on and a bounded proposal is approved.");
    }
    const payload = await this.#request(`/asks/${encodeURIComponent(request.offerRef)}/`, {
      method: "PUT", signal,
      body: {
        client_id: "me",
        image: request.image ?? "vllm/vllm-openai:latest",
        disk: request.diskGb ?? 40,
        label: `aion-${request.modelId}`.slice(0, 60),
        onstart: null,
        runtype: "ssh",
      },
    });
    const instanceRef = String(payload?.new_contract ?? payload?.instance_id ?? "");
    if (!instanceRef) throw new Error("Vast.ai accepted the request but returned no instance reference, so AION cannot track or stop it. Check the Vast.ai console immediately.");
    return { instanceRef, detail: redactCredentials(`Vast.ai instance ${instanceRef} created for ${request.modelId} on ${request.runtime}.`) };
  }

  async stop(instanceRef, signal) {
    try {
      await this.#request(`/instances/${encodeURIComponent(instanceRef)}/`, { method: "DELETE", signal });
      return { stopped: true, detail: `Vast.ai instance ${instanceRef} destroyed.` };
    } catch (error) {
      return { stopped: false, detail: redactCredentials(error?.message ?? "the provider did not answer") };
    }
  }

  /**
   * What Vast.ai says about one machine, in infrastructure terms only.
   *
   * A failure to reach the API **throws** rather than reporting the instance as failed. The two are
   * not the same thing and conflating them is expensive: the readiness bridge tears a machine down
   * when the provider says it has failed, so one flaky request would destroy a paid instance
   * mid-boot. Throwing says "AION does not know", which the bridge records, redacts, and retries
   * inside the allowance the owner approved.
   *
   * The address reported here is a claim, not an endpoint. Validating it and proving something
   * answers on it happens in AION, not in this adapter.
   */
  async status(instanceRef, signal) {
    const payload = await this.#request("/instances/", { signal });
    const instances = Array.isArray(payload?.instances) ? payload.instances : [];
    const found = instances.find((entry) => String(entry?.id ?? "") === String(instanceRef));
    if (!found) return { state: "stopped", detail: "Vast.ai does not list that instance, so it is not running.", endpointUrl: null };
    const actual = String(found.actual_status ?? "").toLowerCase();
    const running = actual === "running";
    // Anything that is neither running nor plainly finished is treated as still coming up. That is
    // the honest reading during a boot, and the readiness deadline bounds how long it can last.
    const state = running ? "running" : ["exited", "stopped", "offline"].includes(actual) ? "stopped" : "provisioning";
    const host = typeof found.public_ipaddr === "string" ? found.public_ipaddr : null;
    const port = found.ports?.["8000/tcp"]?.[0]?.HostPort ?? null;
    return {
      state,
      detail: redactCredentials(`Vast.ai reports ${actual || "an unknown state"}.`),
      endpointUrl: running && host && port ? `http://${host}:${port}/v1` : null,
    };
  }
}
