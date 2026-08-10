/**
 * Image understanding (Checkpoint G).
 *
 * Prefer a free local multimodal path when available (Ollama vision, etc.).
 * On this desktop profile (Ryzen 7 5700G, ~32 GB RAM, iGPU), CPU vision models
 * are acceptable. Until a provider is wired, AION stores image bytes and returns
 * a clear IMAGE_EXTRACTION_PROVIDER_REQUIRED status rather than inventing OCR.
 */

export type ImageUnderstandingCodeV1 =
  | "READY"
  | "IMAGE_EXTRACTION_PROVIDER_REQUIRED"
  | "LOCAL_FALLBACK_METADATA_ONLY"
  | "VISION_CALL_FAILED";

export interface ImageUnderstandingStatusV1 {
  code: ImageUnderstandingCodeV1;
  provider: string | null;
  message: string;
  localMultimodalRecommended: string[];
  /** Base URL if env configured (no live probe). */
  ollamaBaseUrl: string | null;
  visionModel: string | null;
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
  if (ollama && visionModel) {
    return {
      code: "READY",
      provider: `ollama:${visionModel}`,
      message: "Local vision model configured via AION_VISION_MODEL + Ollama base URL. Image describe uses that path when bytes are provided.",
      localMultimodalRecommended: [],
      ollamaBaseUrl: ollama,
      visionModel,
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
  fetchImpl?: typeof fetch;
}): Promise<ImageExtractionResultV1> {
  const env = input.env ?? process.env;
  const status = imageUnderstandingStatus(env);
  if (status.code !== "READY" || !status.ollamaBaseUrl || !status.visionModel) {
    return extractImageMetadataOnly(input);
  }

  const fetchFn = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    return {
      ...extractImageMetadataOnly(input),
      code: "VISION_CALL_FAILED",
      description: `${extractImageMetadataOnly(input).description} (fetch unavailable in this runtime.)`,
    };
  }

  const b64 = Buffer.from(input.bytes).toString("base64");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 45_000);
  try {
    const res = await fetchFn(`${status.ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: status.visionModel,
        stream: false,
        prompt:
          "Describe this image for a personal CRM assistant. List any readable text (OCR) and concrete objects. Do not invent names, phone numbers, or facts that are not visible. Be concise.",
        images: [b64],
      }),
    });
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
  } catch {
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
