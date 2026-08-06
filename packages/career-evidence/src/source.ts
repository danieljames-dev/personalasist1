import {
  CAREER_INPUT_MAX_RAW_BYTES_V1,
  preflightCareerInputV1,
  validateCareerFactsInputV1,
  validateCareerPreferencesInputV1,
  type CareerFactInputEntryV1,
  type CareerFactsInputV1,
  type CareerInputFileKindV1,
  type ExplicitDateValueV1,
  type ExplicitTextValueV1,
} from "@aion/career-input";
import { parseCanonicalJsonV1 } from "@aion/object";
import { authorizeLocalTextInput } from "@aion/privacy-boundary";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename, extname, relative } from "node:path";

import {
  CareerEvidenceOperationErrorV1,
  type CareerEvidenceImportRequestV1,
  type CareerFactCandidateV1,
  type CareerFactTypeV1,
  type CareerEvidenceSourceTypeV1,
  type ContentDigestV1,
  type NormalizedCareerFactValueV1,
  type ParserDescriptorV1,
  type SourceLocationIndexV1,
  validateCareerEvidenceImportRequestV1,
} from "./contracts.js";

export interface PreparedCareerEvidenceSourceV1 {
  readonly request: CareerEvidenceImportRequestV1;
  readonly contentDigest: ContentDigestV1;
  readonly originalFilename: string;
  readonly approvedRelativePath: string;
  readonly parser: ParserDescriptorV1;
  readonly locationIndex: SourceLocationIndexV1;
  readonly candidates: readonly CareerFactCandidateV1[];
}

function expectedKind(sourceType: CareerEvidenceSourceTypeV1): CareerInputFileKindV1 {
  switch (sourceType) {
    case "career-facts-json": return "career-facts";
    case "career-preferences-json": return "career-preferences";
    case "resume-evidence-markdown": return "resume-evidence";
    case "work-history-evidence-markdown": return "work-history-evidence";
    case "plain-text-evidence": return "evidence-text";
  }
}

function parserFor(sourceType: CareerEvidenceSourceTypeV1): ParserDescriptorV1 {
  if (sourceType === "career-facts-json") {
    return { version: "1", parserId: "aion.parser.career-facts-json", parserVersion: "1", sourceLocationFormat: "json-pointer-v1" };
  }
  if (sourceType === "career-preferences-json") {
    return { version: "1", parserId: "aion.parser.career-preferences-json", parserVersion: "1", sourceLocationFormat: "json-pointer-v1" };
  }
  return { version: "1", parserId: "aion.parser.career-evidence-text", parserVersion: "1", sourceLocationFormat: "line-number-v1" };
}

function requiredExtension(sourceType: CareerEvidenceSourceTypeV1): ".json" | ".md" | ".txt" {
  if (sourceType === "career-facts-json" || sourceType === "career-preferences-json") return ".json";
  if (sourceType === "plain-text-evidence") return ".txt";
  return ".md";
}

async function boundedRead(path: string): Promise<Uint8Array> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const state = await handle.stat();
    if (!state.isFile() || state.size > CAREER_INPUT_MAX_RAW_BYTES_V1) {
      throw new CareerEvidenceOperationErrorV1("source-read-failed", "source", "The selected source is not an accepted bounded regular file.");
    }
    const buffer = Buffer.allocUnsafe(CAREER_INPUT_MAX_RAW_BYTES_V1 + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > CAREER_INPUT_MAX_RAW_BYTES_V1) {
      throw new CareerEvidenceOperationErrorV1("source-read-failed", "source", "The selected source exceeds the accepted raw-input limit.");
    }
    return buffer.subarray(0, offset);
  } catch (error) {
    if (error instanceof CareerEvidenceOperationErrorV1) throw error;
    throw new CareerEvidenceOperationErrorV1("source-read-failed", "source", "The explicitly selected source could not be read safely.");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function decode(bytes: Uint8Array): string {
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new CareerEvidenceOperationErrorV1("source-changed", "source", "The source changed after preflight validation.");
  }
  if (bytes.includes(0)) throw new CareerEvidenceOperationErrorV1("source-changed", "source", "The source changed after preflight validation.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {
    throw new CareerEvidenceOperationErrorV1("source-changed", "source", "The source changed after preflight validation.");
  }
}

function normalized(value: ExplicitTextValueV1 | ExplicitDateValueV1): NormalizedCareerFactValueV1 {
  if (value.state === "supplied") return { state: "supplied", value: value.value };
  return { state: value.state };
}

function candidate(
  entry: CareerFactInputEntryV1,
  factType: CareerFactTypeV1,
  value: NormalizedCareerFactValueV1,
  sourceLocation: string,
  parser: ParserDescriptorV1,
): CareerFactCandidateV1 {
  const missing = value.state === "unknown" || value.state === "not-applicable";
  const confirmed = !missing && entry.ownerConfirmed;
  const assertion = missing ? "missing" : confirmed ? "owner-confirmed" : "extracted";
  return {
    version: "1",
    sourceClaimId: entry.factId,
    factType,
    normalizedValue: value,
    sourceLocation,
    confidence: missing ? "not-assessed" : confirmed ? "owner-asserted" : "deterministic-extraction",
    ownerConfirmed: confirmed,
    status: { version: "1", verification: "unverified", assertion, conflict: "none" },
    extractionMethod: {
      version: "1",
      method: missing ? "deterministic-missing-state" : confirmed ? "structured-owner-input" : "deterministic-structured-extraction",
      parser,
      ruleId: null,
    },
  };
}

function extractFacts(input: CareerFactsInputV1, parser: ParserDescriptorV1): readonly CareerFactCandidateV1[] {
  const candidates: CareerFactCandidateV1[] = [];
  for (const [entryIndex, entry] of input.entries.entries()) {
    const root = `/entries/${entryIndex}`;
    candidates.push(candidate(entry, entry.factKind, normalized(entry.value), `${root}/value`, parser));
    candidates.push(candidate(entry, "start-date", normalized(entry.startDate), `${root}/startDate`, parser));
    candidates.push(candidate(entry, "end-date", normalized(entry.endDate), `${root}/endDate`, parser));
    for (const [key, factType] of [
      ["responsibilities", "responsibility"],
      ["accomplishments", "accomplishment"],
      ["skills", "skill"],
      ["toolsAndTechnologies", "tool-or-technology"],
    ] as const) {
      for (const [index, value] of entry[key].entries()) {
        candidates.push(candidate(entry, factType, { state: "supplied", value }, `${root}/${key}/${index}`, parser));
      }
    }
  }
  return candidates.sort((left, right) => left.sourceLocation.localeCompare(right.sourceLocation, "en-US"));
}

function lineIndex(text: string): SourceLocationIndexV1 {
  if (text.length === 0) return { version: "1", format: "line-number-v1", lineCount: 0, sectionStartLines: [] };
  const lines = text.split("\n");
  const sectionStartLines = lines.flatMap((line, index) => /^#{1,6} /.test(line) ? [index + 1] : []);
  return { version: "1", format: "line-number-v1", lineCount: lines.length, sectionStartLines };
}

export async function prepareCareerEvidenceSourceV1(value: unknown): Promise<PreparedCareerEvidenceSourceV1> {
  const request = validateCareerEvidenceImportRequestV1(value);
  const expected = expectedKind(request.sourceType);
  const preflight = await preflightCareerInputV1({
    version: "1",
    approvedRoot: request.approvedInputRoot,
    inputPath: request.sourcePath,
    expectedKind: expected,
  });
  if (!preflight.accepted) {
    throw new CareerEvidenceOperationErrorV1("preflight-rejected", "preflight", `Career input preflight rejected the source (${preflight.error.code}).`);
  }
  if (preflight.extension !== requiredExtension(request.sourceType)) {
    throw new CareerEvidenceOperationErrorV1("unsupported-source", "preflight", "The source extension does not match its explicit source type.");
  }
  const pathRequest = {
    version: "1" as const,
    operation: "read-file" as const,
    approvedRoot: request.approvedInputRoot,
    requestedPath: request.sourcePath,
  };
  const authorization = authorizeLocalTextInput(pathRequest);
  if (!authorization.authorized) {
    throw new CareerEvidenceOperationErrorV1("preflight-rejected", "preflight", "The selected source failed approved-root validation.");
  }
  const recheck = authorizeLocalTextInput({
    ...pathRequest,
    requestedPath: { version: "1", absolutePath: authorization.resolvedPath },
  });
  if (!recheck.authorized) {
    throw new CareerEvidenceOperationErrorV1("preflight-rejected", "preflight", "The selected source failed approved-root recheck.");
  }
  const bytes = await boundedRead(recheck.resolvedPath);
  if (bytes.byteLength !== preflight.byteLength) {
    throw new CareerEvidenceOperationErrorV1("source-changed", "source", "The source changed after preflight validation.");
  }
  const contentDigest: ContentDigestV1 = {
    algorithm: "sha-256",
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
  const text = decode(bytes);
  const parser = parserFor(request.sourceType);
  let candidates: readonly CareerFactCandidateV1[] = [];
  let locationIndex: SourceLocationIndexV1;
  if (request.sourceType === "career-facts-json") {
    let parsed: unknown;
    try { parsed = parseCanonicalJsonV1(bytes); } catch {
      throw new CareerEvidenceOperationErrorV1("contract-invalid", "contract", "The structured source is invalid.");
    }
    let input: CareerFactsInputV1;
    try { input = validateCareerFactsInputV1(parsed); } catch {
      throw new CareerEvidenceOperationErrorV1("contract-invalid", "contract", "The structured career-facts source is invalid.");
    }
    candidates = extractFacts(input, parser);
    locationIndex = {
      version: "1",
      format: "json-pointer-v1",
      locations: [...new Set(candidates.map((item) => item.sourceLocation))].sort(),
    };
  } else if (request.sourceType === "career-preferences-json") {
    let parsed: unknown;
    try { parsed = parseCanonicalJsonV1(bytes); } catch {
      throw new CareerEvidenceOperationErrorV1("contract-invalid", "contract", "The structured source is invalid.");
    }
    try { validateCareerPreferencesInputV1(parsed); } catch {
      throw new CareerEvidenceOperationErrorV1("contract-invalid", "contract", "The structured career-preferences source is invalid.");
    }
    locationIndex = { version: "1", format: "json-pointer-v1", locations: ["/contractVersion"] };
  } else {
    locationIndex = lineIndex(text);
  }
  const relativePath = relative(request.approvedInputRoot.absolutePath, recheck.resolvedPath).replaceAll("\\", "/");
  if (relativePath.length === 0 || relativePath.startsWith("../") || relativePath === ".." || /^[A-Za-z]:/.test(relativePath)) {
    throw new CareerEvidenceOperationErrorV1("preflight-rejected", "preflight", "The approved relative source path is invalid.");
  }
  return {
    request,
    contentDigest,
    originalFilename: basename(recheck.resolvedPath),
    approvedRelativePath: relativePath,
    parser,
    locationIndex,
    candidates,
  };
}
