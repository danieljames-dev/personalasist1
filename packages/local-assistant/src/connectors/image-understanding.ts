/**
 * Image understanding (Checkpoint G).
 *
 * Prefer a free local multimodal path when available (Ollama vision, etc.).
 * On this desktop profile (Ryzen 7 5700G, ~32 GB RAM, iGPU), CPU vision models
 * are acceptable. Until a provider is wired, AION stores image bytes and returns
 * a clear IMAGE_EXTRACTION_PROVIDER_REQUIRED status rather than inventing OCR.
 */

import {
  REFUSING_LOOPBACK_TRANSPORT_V1,
  classifyEndpointV1,
  isOutwardRefusalV1,
  type EndpointClassV1,
  type LoopbackTransportPortV1,
  type OutwardTransportPortV1,
} from "../outward-transport.js";

export type ImageUnderstandingCodeV1 =
  | "READY"
  | "IMAGE_EXTRACTION_PROVIDER_REQUIRED"
  | "LOCAL_FALLBACK_METADATA_ONLY"
  | "VISION_CALL_FAILED"
  /** Configured endpoint is not this machine, and remote inference is not an enabled capability. */
  | "VISION_REMOTE_NOT_AUTHORIZED";

export interface ImageUnderstandingStatusV1 {
  code: ImageUnderstandingCodeV1;
  provider: string | null;
  message: string;
  localMultimodalRecommended: string[];
  /** Base URL if env configured (no live probe). */
  ollamaBaseUrl: string | null;
  visionModel: string | null;
  /**
   * Whether the configured endpoint is actually on this machine.
   *
   * Reported rather than assumed. "Local vision" was the module's name, not a property of the
   * configuration, and an Owner reading a READY status deserves to know which machine it means.
   */
  endpointClass: EndpointClassV1;
}

export interface ImageExtractionResultV1 {
  description: string;
  extractedText: string;
  facts: string[];
  confidence: number;
  provider: string;
  code: ImageUnderstandingCodeV1;
}

export function resolveOllamaBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.AION_OLLAMA_BASE_URL?.trim() || env.OLLAMA_HOST?.trim() || "";
  if (!raw) return null;
  // OLLAMA_HOST is often host:port without scheme
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, "");
  return `http://${raw.replace(/\/$/, "")}`;
}

/** Probe env for a configured vision endpoint (no paid default). */
export function imageUnderstandingStatus(env: NodeJS.ProcessEnv = process.env): ImageUnderstandingStatusV1 {
  const ollama = resolveOllamaBaseUrl(env);
  const visionModel = env.AION_VISION_MODEL?.trim() || null;
  const endpointClass = classifyEndpointV1(ollama);
  /*
   * A configured endpoint that is not this machine is remote inference, and reporting it READY was
   * the defect: readiness of configuration became a claim about permission. Say so instead.
   */
  if (ollama && visionModel && endpointClass === "REMOTE") {
    return {
      code: "VISION_REMOTE_NOT_AUTHORIZED",
      provider: null,
      message:
        `The configured vision endpoint (${new URL(ollama).host}) is not on this machine, so using it would send the image off it. `
        + "That is remote inference and needs the vision.remoteInference outward capability, which is not enabled. "
        + "Point AION_OLLAMA_BASE_URL at a loopback address to use the local path.",
      localMultimodalRecommended: [],
      ollamaBaseUrl: ollama,
      visionModel,
      endpointClass,
    };
  }
  if (ollama && visionModel && endpointClass === "LOOPBACK") {
    return {
      code: "READY",
      provider: `ollama:${visionModel}`,
      message: "Local vision model configured via AION_VISION_MODEL + Ollama base URL. Image describe uses that path when bytes are provided.",
      localMultimodalRecommended: [],
      ollamaBaseUrl: ollama,
      visionModel,
      endpointClass,
    };
  }
  return {
    code: "IMAGE_EXTRACTION_PROVIDER_REQUIRED",
    provider: null,
    message:
      "Image bytes are stored under private intake. No local multimodal vision model is configured yet. Recommended free local options for this machine: Ollama + a small vision model (e.g. moondream or llava-phi3) with CPU fallback. Optional cloud multimodal requires separate Owner authority.",
    localMultimodalRecommended: [
      "ollama pull moondream",
      "ollama pull llava-phi3",
      "set AION_VISION_MODEL=moondream",
      "set AION_OLLAMA_BASE_URL=http://127.0.0.1:11434",
    ],
    ollamaBaseUrl: ollama,
    visionModel,
    endpointClass,
  };
}

/**
 * Metadata-only extraction when no vision provider is available.
 * Never fabricates OCR text from pixels.
 */
export function extractImageMetadataOnly(input: {
  filename: string;
  mimeType: string;
  byteLength: number;
}): ImageExtractionResultV1 {
  return {
    description: `Image file ${input.filename} (${input.mimeType}, ${input.byteLength} bytes). Vision extraction not configured.`,
    extractedText: "",
    facts: [],
    confidence: 0,
    provider: "metadata-only",
    code: "LOCAL_FALLBACK_METADATA_ONLY",
  };
}

/**
 * Best-effort local Ollama vision describe. Never invents text on failure —
 * falls back to metadata-only with a clear code.
 */
export async function extractImageWithLocalVision(input: {
  filename: string;
  mimeType: string;
  byteLength: number;
  /** Raw image bytes */
  bytes: Uint8Array | Buffer;
  env?: NodeJS.ProcessEnv;
  /** Abort / timeout ms */
  timeoutMs?: number;
  /**
   * Transport for the *loopback* call only, supplied by the application. It is reached after the
   * endpoint has been proven to be on this machine, so it cannot carry the image anywhere else.
   */
  loopback?: LoopbackTransportPortV1;
  /**
   * Approved outward transport, required before a non-loopback endpoint may be used at all.
   * Absent — which is the current state of this repository — means a remote endpoint refuses.
   */
  outward?: OutwardTransportPortV1;
  /** Override prompt (e.g. VIN-focused OCR). */
  prompt?: string;
}): Promise<ImageExtractionResultV1> {
  const env = input.env ?? process.env;
  const status = imageUnderstandingStatus(env);

  /*
   * The destination used to come straight from AION_OLLAMA_BASE_URL with no check, so setting two
   * environment variables was enough to make the Command Center base64 the Owner's photo and POST
   * it to a third party — through a function named `extractImageWithLocalVision`. The word "local"
   * was in the name and nowhere in the code.
   *
   * It is in the code now. A non-loopback endpoint is remote inference and needs the capability;
   * without it nothing is encoded and nothing is sent.
   */
  if (status.endpointClass === "REMOTE") {
    if (!status.ollamaBaseUrl || !status.visionModel) return extractImageMetadataOnly(input);
    if (input.outward === undefined) {
      const metadata = extractImageMetadataOnly(input);
      return {
        ...metadata,
        code: "VISION_REMOTE_NOT_AUTHORIZED",
        provider: "remote-not-authorized",
        description:
          `${metadata.description} The configured vision endpoint (${new URL(status.ollamaBaseUrl).host}) `
          + "is not this machine, so the image was not sent anywhere. Remote inference needs the "
          + "vision.remoteInference capability.",
      };
    }
  } else if (status.code !== "READY" || !status.ollamaBaseUrl || !status.visionModel) {
    return extractImageMetadataOnly(input);
  }

  const b64 = Buffer.from(input.bytes).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 45_000);
  try {
    const endpoint = `${status.ollamaBaseUrl}/api/generate`;
    const request: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: status.visionModel,
        stream: false,
        prompt:
          input.prompt ||
          "Describe this image for a personal CRM assistant. List any readable text (OCR) and concrete objects. Do not invent names, phone numbers, or facts that are not visible. Be concise.",
        images: [b64],
      }),
    };
    /*
     * Two transports, chosen by what the endpoint provably is. The loopback one re-checks the
     * address rather than trusting this branch, so a mistake here refuses instead of sending.
     */
    const res = status.endpointClass === "REMOTE"
      ? await input.outward!.request("vision.remoteInference", endpoint, request)
      : await (input.loopback ?? REFUSING_LOOPBACK_TRANSPORT_V1).request(endpoint, request);
    if (!res.ok) {
      return {
        ...extractImageMetadataOnly(input),
        code: "VISION_CALL_FAILED",
        description: `Image stored; local vision HTTP ${res.status}. Metadata only.`,
        provider: status.provider || "ollama",
      };
    }
    const json = (await res.json()) as { response?: string };
    const text = String(json.response ?? "").trim().slice(0, 100_000);
    if (!text) {
      return {
        ...extractImageMetadataOnly(input),
        code: "VISION_CALL_FAILED",
        description: "Image stored; vision model returned empty text.",
        provider: status.provider || "ollama",
      };
    }
    return {
      description: text.slice(0, 4000),
      extractedText: text,
      facts: [],
      confidence: 55,
      provider: status.provider || `ollama:${status.visionModel}`,
      code: "READY",
    };
  } catch (err) {
    // A refusal is the boundary working; saying "the call failed or timed out" would hide that.
    if (isOutwardRefusalV1(err)) {
      return {
        ...extractImageMetadataOnly(input),
        code: "VISION_REMOTE_NOT_AUTHORIZED",
        description: `Image file ${input.filename} stored. Nothing was sent: ${err instanceof Error ? err.message : String(err)}`,
        provider: "remote-not-authorized",
      };
    }
    return {
      ...extractImageMetadataOnly(input),
      code: "VISION_CALL_FAILED",
      description: `Image file ${input.filename} stored. Local vision call failed or timed out — no invented OCR.`,
      provider: status.provider || "ollama",
    };
  } finally {
    clearTimeout(timer);
  }
}
