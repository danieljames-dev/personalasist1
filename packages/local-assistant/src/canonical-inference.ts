/**
 * Streaming-first canonical inference.
 *
 * After routing completes, the bound decision is the execution contract. No path may recompute
 * endpoint, context limits, withheld classes, disclosure, or privacy class. Chat and evaluation
 * both drain the same stream primitive; a completion is only a thin measure wrapper.
 *
 * Reasoning/thinking channels carry ZERO authority: they never create actions, memories, tasks,
 * proposals, or shell syntax. Only the visible answer channel is eligible for structured parsing.
 */

import type { ChatMessageV1, MemoryV1, ModelProviderV1 } from "./contracts.js";
import type { BrainEndpointV1, BrainRuntimePortV1, ContextSelectionV1, RoutingDecisionV1 } from "./brain.js";
import { OFFLINE_ENDPOINT_ID } from "./brain.js";
import { redactCredentials } from "./gpu.js";
import { splitStructuredProposals, type StructuredSplitV1 } from "./structured-output.js";

export type InferenceChannelV1 = "answer" | "reasoning";

export interface InferenceChunkV1 {
  channel: InferenceChannelV1;
  text: string;
}

/**
 * The authoritative execution input after routing.
 *
 * Assembled once from the RoutingDecision and the already-selected memory list. Canonical
 * inference must not accept a raw endpoint plus a separately assembled Memory list.
 */
export interface BoundInferenceEnvelopeV1 {
  decision: RoutingDecisionV1;
  endpoint: BrainEndpointV1;
  context: ContextSelectionV1;
  conversationId: string;
  messages: readonly ChatMessageV1[];
  /** Already capped by context.memoryLimit; withheld classes are never present. */
  memoryContext: readonly Pick<MemoryV1, "id" | "content" | "category">[];
  purpose: "chat" | "evaluation";
  /** Optional profile flag: when true, parse <think>...</think> style tags if present. */
  thinkTagParser?: boolean;
}

export interface CanonicalCompletionV1 {
  answerText: string;
  reasoningText: string;
  latencyMs: number;
  split: StructuredSplitV1;
  /** Redacted error if the stream failed after partial output; null on success. */
  error: string | null;
}

export const CANONICAL_INFERENCE_MAX_CHARS = 100_000;

/**
 * Active redaction boundary for provider/runtime errors before they reach state, Activity, UI,
 * or handoff evidence. Paths and credential-shaped tokens are stripped.
 */
export function redactInferenceDetail(value: unknown): string {
  return redactCredentials(String(value ?? ""))
    .replace(/[A-Za-z]:[\\/][^\s"'<>|]*/gu, "[local path]")
    .replace(/\/(?:home|Users|tmp|var|private)\/[^\s"'<>|]*/gu, "[local path]")
    .slice(0, 500);
}

/**
 * Selects Memory records for a bound decision. The arithmetic lives here so Chat and evaluation
 * cannot diverge: the decision's memoryLimit is authoritative, withheld classes never appear.
 */
export function bindMemoryContext(
  decision: RoutingDecisionV1,
  memories: readonly MemoryV1[],
  workspace: string,
  memoryContextEnabled: boolean,
): Pick<MemoryV1, "id" | "content" | "category">[] {
  if (!decision.allowed || !decision.context) return [];
  if (!memoryContextEnabled || !decision.disclosure?.includesMemory) return [];
  const limit = decision.context.memoryLimit;
  if (limit <= 0) return [];
  // Withheld "complete Memory database" etc. are already excluded by selectContext; we only take
  // enabled records in the conversation workspace, capped by the bound limit.
  return memories
    .filter((item) => item.enabled && item.workspace === workspace)
    .slice(0, limit)
    .map(({ id, content, category }) => ({ id, content, category }));
}

/**
 * Builds the envelope from an allowed routing decision. Throws if the decision is not executable.
 */
export function bindInferenceEnvelope(
  decision: RoutingDecisionV1,
  input: {
    conversationId: string;
    messages: readonly ChatMessageV1[];
    memories: readonly MemoryV1[];
    workspace: string;
    memoryContextEnabled: boolean;
    purpose: "chat" | "evaluation";
    thinkTagParser?: boolean;
  },
): BoundInferenceEnvelopeV1 {
  if (!decision.allowed || !decision.endpoint || !decision.context) {
    throw new Error(decision.reason || "Routing refused this turn; nothing will be sent.");
  }
  return {
    decision,
    endpoint: decision.endpoint,
    context: decision.context,
    conversationId: input.conversationId,
    messages: input.messages,
    memoryContext: bindMemoryContext(decision, input.memories, input.workspace, input.memoryContextEnabled),
    purpose: input.purpose,
    thinkTagParser: input.thinkTagParser === true,
  };
}

/**
 * Isolates reasoning markup from answer text when an endpoint profile opts into think-tag parsing.
 *
 * Malformed/unclosed tags fail safe: the entire remainder is treated as non-authoritative
 * reasoning (no action parsing, no promotion to visible authoritative output).
 */
export function isolateThinkTags(text: string): { answer: string; reasoning: string } {
  const open = /<think(?:ing)?>/iu;
  const close = /<\/think(?:ing)?>/iu;
  let answer = "";
  let reasoning = "";
  let rest = text;
  for (;;) {
    const openMatch = open.exec(rest);
    if (!openMatch) {
      answer += rest;
      break;
    }
    answer += rest.slice(0, openMatch.index);
    rest = rest.slice(openMatch.index + openMatch[0].length);
    const closeMatch = close.exec(rest);
    if (!closeMatch) {
      // Unclosed: remainder is reasoning, not authority.
      reasoning += rest;
      rest = "";
      break;
    }
    reasoning += rest.slice(0, closeMatch.index);
    rest = rest.slice(closeMatch.index + closeMatch[0].length);
  }
  return { answer: answer.trim(), reasoning: reasoning.trim() };
}

export interface CanonicalStreamPortV1 {
  /**
   * Streams bound inference. Implementations must honour AbortSignal, including already-aborted,
   * and must never treat reasoning chunks as executable.
   */
  stream(envelope: BoundInferenceEnvelopeV1, signal: AbortSignal): AsyncIterable<InferenceChunkV1>;
}

/**
 * Drain the canonical stream into a measured completion. Chat may yield chunks to the UI while
 * accumulating; evaluation always uses this (or an equivalent drain of the same stream).
 */
export async function drainCanonicalStream(
  stream: AsyncIterable<InferenceChunkV1>,
  options: { thinkTagParser?: boolean; signal?: AbortSignal } = {},
): Promise<CanonicalCompletionV1> {
  const startedAt = Date.now();
  let answerText = "";
  let reasoningText = "";
  try {
    if (options.signal?.aborted) throw new Error("Inference cancelled.");
    for await (const chunk of stream) {
      if (options.signal?.aborted) throw new Error("Inference cancelled.");
      if (chunk.channel === "reasoning") {
        reasoningText += chunk.text;
        if (reasoningText.length > CANONICAL_INFERENCE_MAX_CHARS) reasoningText = reasoningText.slice(0, CANONICAL_INFERENCE_MAX_CHARS);
      } else {
        answerText += chunk.text;
        if (answerText.length > CANONICAL_INFERENCE_MAX_CHARS) throw new Error("Provider response exceeds the V1 size limit.");
      }
    }
    if (options.thinkTagParser) {
      const isolated = isolateThinkTags(answerText);
      answerText = isolated.answer;
      if (isolated.reasoning) reasoningText = reasoningText ? `${reasoningText}\n${isolated.reasoning}` : isolated.reasoning;
    }
    // Structured control is parsed from the answer channel only. Reasoning has zero authority.
    const split = splitStructuredProposals(answerText);
    return {
      answerText: split.body,
      reasoningText,
      latencyMs: Date.now() - startedAt,
      split,
      error: null,
    };
  } catch (error) {
    const detail = redactInferenceDetail(error instanceof Error ? error.message : error) || "inference failed";
    return {
      answerText,
      reasoningText,
      latencyMs: Date.now() - startedAt,
      split: splitStructuredProposals(answerText),
      error: detail,
    };
  }
}

/**
 * Completes bound inference by draining the stream. Thin wrapper — not a second implementation.
 */
export async function completeCanonical(
  port: CanonicalStreamPortV1,
  envelope: BoundInferenceEnvelopeV1,
  signal: AbortSignal,
): Promise<CanonicalCompletionV1> {
  if (signal.aborted) {
    return {
      answerText: "",
      reasoningText: "",
      latencyMs: 0,
      split: { body: "", actions: [], memories: [], malformed: 0, rejections: [] },
      error: redactInferenceDetail("Inference cancelled."),
    };
  }
  const options: { thinkTagParser?: boolean; signal?: AbortSignal } = { signal };
  if (envelope.thinkTagParser === true) options.thinkTagParser = true;
  return drainCanonicalStream(port.stream(envelope, signal), options);
}

/**
 * Adapts BrainRuntimePortV1 (+ optional stream) and legacy ModelProviderV1 ports into the
 * canonical stream surface. Offline/deterministic endpoints use the in-process provider stream;
 * addressed endpoints use the brain runtime.
 */
export class CompositeCanonicalInferenceV1 implements CanonicalStreamPortV1 {
  constructor(
    private readonly brainRuntime: BrainRuntimePortV1 | null,
    private readonly providers: readonly ModelProviderV1[],
  ) {}

  async *stream(envelope: BoundInferenceEnvelopeV1, signal: AbortSignal): AsyncIterable<InferenceChunkV1> {
    if (signal.aborted) throw new Error("Inference cancelled.");
    const { endpoint } = envelope;

    // Prefer brain runtime stream when the adapter can serve this endpoint.
    if (this.brainRuntime?.supports(endpoint)) {
      if (typeof this.brainRuntime.stream === "function") {
        for await (const chunk of this.brainRuntime.stream(endpoint, {
          prompt: latestOwnerPrompt(envelope.messages),
          context: envelope.memoryContext.map((item) => item.content),
          messages: envelope.messages,
          memoryContext: envelope.memoryContext,
          signal,
        })) {
          yield chunk;
        }
        return;
      }
      // Runtime has complete only: wrap as a single answer chunk (still the same adapter path).
      const result = await this.brainRuntime.complete(endpoint, {
        prompt: latestOwnerPrompt(envelope.messages),
        context: envelope.memoryContext.map((item) => item.content),
        signal,
      });
      if (result.text) yield { channel: "answer", text: result.text };
      return;
    }

    // Legacy provider mapping for the offline floor and fixed provider IDs.
    const provider = resolveProvider(this.providers, endpoint);
    if (!provider) {
      throw new Error(
        `No runtime can execute endpoint "${endpoint.label}" (${endpoint.id}). AION will not invent a transport or fall back to a hidden remote.`,
      );
    }
    for await (const text of provider.stream({
      conversationId: envelope.conversationId,
      messages: envelope.messages,
      memoryContext: envelope.memoryContext,
      model: endpoint.model,
      signal,
    })) {
      yield { channel: "answer", text };
    }
  }
}

function latestOwnerPrompt(messages: readonly ChatMessageV1[]): string {
  return [...messages].reverse().find((item) => item.role === "owner")?.content ?? "";
}

function resolveProvider(providers: readonly ModelProviderV1[], endpoint: BrainEndpointV1): ModelProviderV1 | null {
  const byId = providers.find((entry) => entry.id === endpoint.id);
  if (byId) return byId;
  // Historical: offline endpoint id is deterministic-offline; provider id is deterministic.
  if (endpoint.id === OFFLINE_ENDPOINT_ID || endpoint.runtime === "deterministic-offline") {
    return providers.find((entry) => entry.id === "deterministic" || entry.id === OFFLINE_ENDPOINT_ID) ?? null;
  }
  return null;
}
