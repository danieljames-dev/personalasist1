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
  | "LOCAL_FALLBACK_METADATA_ONLY";

export interface ImageUnderstandingStatusV1 {
  code: ImageUnderstandingCodeV1;
  provider: string | null;
  message: string;
  localMultimodalRecommended: string[];
}

export interface ImageExtractionResultV1 {
  description: string;
  extractedText: string;
  facts: string[];
  confidence: number;
  provider: string;
  code: ImageUnderstandingCodeV1;
}

/** Probe env for a configured vision endpoint (no paid default). */
export function imageUnderstandingStatus(env: NodeJS.ProcessEnv = process.env): ImageUnderstandingStatusV1 {
  const ollama = env.AION_OLLAMA_BASE_URL?.trim() || env.OLLAMA_HOST?.trim();
  const visionModel = env.AION_VISION_MODEL?.trim();
  if (ollama && visionModel) {
    return {
      code: "READY",
      provider: `ollama:${visionModel}`,
      message: "Local vision model configured via AION_VISION_MODEL + Ollama base URL.",
      localMultimodalRecommended: [],
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
