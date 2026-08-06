# Career Input Threat Model

Status: Sprint 3 Phase 6 reference boundary

## Assets and trust boundary

Potential career input is sensitive owner-controlled data. The boundary accepts only one explicit
local path beneath one explicit approved root and returns no content. Contract validation does not
establish factual accuracy, authenticity, authorization, or safe future use.

## Threats and controls

| Threat | Control |
|---|---|
| Implicit collection or broad filesystem discovery | No scanning, watching, home inference, directory enumeration, archive integration, or default path |
| Traversal, cross-drive, device, link, junction, or reparse escape | Reused Phase 3 path validation plus immediate resolved-path recheck and regular-file handle check |
| Extension spoofing | Final extension allowlist only: `.json`, `.md`, `.txt`, case-insensitive |
| Malformed or ambiguous text | Strict UTF-8, BOM and NUL rejection, no normalization |
| Parser ambiguity or resource exhaustion | ACJ-1 duplicate-key/number/string validation and inclusive 4 MiB raw-input limit |
| Schema smuggling | Closed exact-key contracts and explicit contract-version dispatch |
| Sensitive output leakage | No body or full path in result; stable bounded errors and summary-only success |
| Unexpected side effects | No Object/Identity repository, persistence, network, telemetry, model, database, or vector-store dependency |
| Personal data in fixtures or templates | Deterministic synthetic tests and neutral blank tracked templates only |

## Residual risks

Local operating-system access controls, disk encryption, malware, backup policy, and secure deletion
remain outside this package. Files may change during a local time-of-check/time-of-use window;
rechecks and handle-based reads reduce but cannot eliminate platform races. Preflight proves syntax
and boundary conformance, not semantic truth, source authenticity, safety of embedded prose, or
future provenance. Markdown/text structure is deliberately not parsed. PDF, DOCX, images, OCR,
archives, email, browsers, cloud drives, and AI-assistant archives are unsupported. DG-4b remains
Open, so this is not hostile/public or production-workload evidence.

Phase 7 ingestion, Object creation, matching, ranking, drafting, and applications remain
unauthorized.
