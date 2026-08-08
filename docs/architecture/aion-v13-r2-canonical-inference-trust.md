# AION V1.3-R2 — Canonical Brain Execution + Evaluator Trust Boundary

Directive: `AION-V1.3-R2-CANONICAL-INFERENCE-TRUST`.

Corrects the V1.3 resource-activation audit findings so that a registered Brain endpoint is the
actual Chat brain, production and evaluation share one streaming-first inference path, and the
synthetic evaluator no longer awards substantial credit to deliberately wrong answers.

## Core rule

A `RoutingDecisionV1` is a **binding execution contract**. After routing:

- endpoint, context limits, withheld classes, disclosure, and privacy class are not recomputed;
- Chat and evaluation both drain `CanonicalInference` / brain-runtime `stream`;
- Memory selection uses `decision.context.memoryLimit` from that same decision.

## Streaming-first

```text
Chat        -> route -> bind envelope -> stream(answer|reasoning) -> UI / structured parse
Evaluation  -> bind  -> stream (same) -> drain -> grader
```

`complete` is only a thin drain-and-measure wrapper. Reasoning/thinking is a separate channel with
**zero authority** (no actions, memories, tasks, or control protocol).

## Structured output

One canonical parser (`structured-output.ts`) accepts compact single-line JSON after the protocol
prefix. Fenced and pretty-printed control forms are rejected without leaking payload into the
visible body. Production and evaluation agree.

## Evaluator

- Version: `aion.evaluator.v2-trust` persisted on every `EvaluationRunV1`
- PRE-AUDIT floor retained as evidence: **1/12**
- POST-AUDIT floor measured separately under the new grader
- F1–F11 false-positive repairs
- Degenerate constant-response guard
- Code grading: behavioural (Docker, pinned `node@sha256:…`) or truthful structural-only

## Code sandbox

- Domain port only: `CodeSandboxPortV1` (no eval/vm/child_process in domain)
- Adapter: `apps/aion/code-sandbox.mjs` (Docker, network=none, read-only, tmpfs, caps dropped)
- Runner image: `docker.io/library/node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32`

## Resource holds (unchanged)

No Ollama install, no model download, no Vast credential search/config, no discovery, no paid GPU.
Real spend must remain **USD 0.00**.

## First local model recommendation

`qwen3:4b-instruct` (non-thinking). Not the thinking-only `qwen3:4b` tag.
