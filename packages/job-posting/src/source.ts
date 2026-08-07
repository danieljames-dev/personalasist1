import {
  CAREER_INPUT_MAX_RAW_BYTES_V1,
  preflightCareerInputV1,
  validateJobPostingInputV1,
} from "@aion/career-input";
import { parseCanonicalJsonV1 } from "@aion/object";
import { authorizeLocalTextInput } from "@aion/privacy-boundary";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { basename, relative } from "node:path";
import {
  descriptionOnlyFieldsV1,
  fieldsFromStructuredInputV1,
  JobPostingOperationErrorV1,
  validateJobPostingImportRequestV1,
  type JobPostingContentDigestV1,
  type JobPostingFieldsV1,
  type JobPostingImportRequestV1,
  type JobPostingParserDescriptorV1,
} from "./contracts.js";

export interface PreparedJobPostingSourceV1 {
  readonly request: JobPostingImportRequestV1;
  readonly contentDigest: JobPostingContentDigestV1;
  readonly originalFilename: string;
  readonly approvedRelativePath: string;
  readonly parser: JobPostingParserDescriptorV1;
  readonly fields: JobPostingFieldsV1;
}

function parser(sourceType: JobPostingImportRequestV1["sourceType"]): JobPostingParserDescriptorV1 {
  return {
    version: "1",
    parserName: sourceType === "structured-json" ? "aion.job-posting.structured-json"
      : sourceType === "markdown" ? "aion.job-posting.markdown-description"
        : "aion.job-posting.text-description",
    parserVersion: "1",
  };
}

function extension(sourceType: JobPostingImportRequestV1["sourceType"]): ".json" | ".md" | ".txt" {
  return sourceType === "structured-json" ? ".json" : sourceType === "markdown" ? ".md" : ".txt";
}

async function boundedRead(path: string): Promise<Uint8Array> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, "r");
    const state = await handle.stat();
    if (!state.isFile() || state.size > CAREER_INPUT_MAX_RAW_BYTES_V1) {
      throw new JobPostingOperationErrorV1("source-read-failed", "source", "The selected source is not an accepted bounded regular file.");
    }
    const buffer = Buffer.allocUnsafe(CAREER_INPUT_MAX_RAW_BYTES_V1 + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > CAREER_INPUT_MAX_RAW_BYTES_V1) {
      throw new JobPostingOperationErrorV1("source-read-failed", "source", "The selected source exceeds the accepted raw-input limit.");
    }
    return buffer.subarray(0, offset);
  } catch (error) {
    if (error instanceof JobPostingOperationErrorV1) throw error;
    throw new JobPostingOperationErrorV1("source-read-failed", "source", "The explicitly selected source could not be read safely.");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function decode(bytes: Uint8Array): string {
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new JobPostingOperationErrorV1("source-changed", "source", "The source changed after preflight validation.");
  }
  if (bytes.includes(0)) throw new JobPostingOperationErrorV1("source-changed", "source", "The source changed after preflight validation.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {
    throw new JobPostingOperationErrorV1("source-changed", "source", "The source changed after preflight validation.");
  }
}

export async function prepareJobPostingSourceV1(value: unknown): Promise<PreparedJobPostingSourceV1> {
  const request = validateJobPostingImportRequestV1(value);
  const preflight = await preflightCareerInputV1({
    version: "1",
    approvedRoot: request.approvedInputRoot,
    inputPath: request.sourcePath,
    expectedKind: request.sourceType === "structured-json" ? "job-posting" : "evidence-text",
  });
  if (!preflight.accepted) {
    throw new JobPostingOperationErrorV1("preflight-rejected", "preflight", `Career input preflight rejected the source (${preflight.error.code}).`);
  }
  if (preflight.extension !== extension(request.sourceType)) {
    throw new JobPostingOperationErrorV1("unsupported-source", "preflight", "The source extension does not match its explicit source type.");
  }
  const pathRequest = {
    version: "1" as const,
    operation: "read-file" as const,
    approvedRoot: request.approvedInputRoot,
    requestedPath: request.sourcePath,
  };
  const authorization = authorizeLocalTextInput(pathRequest);
  if (!authorization.authorized) {
    throw new JobPostingOperationErrorV1("preflight-rejected", "preflight", "The selected source failed approved-root validation.");
  }
  const recheck = authorizeLocalTextInput({
    ...pathRequest,
    requestedPath: { version: "1", absolutePath: authorization.resolvedPath },
  });
  if (!recheck.authorized) {
    throw new JobPostingOperationErrorV1("preflight-rejected", "preflight", "The selected source failed approved-root recheck.");
  }
  const bytes = await boundedRead(recheck.resolvedPath);
  if (bytes.byteLength !== preflight.byteLength) {
    throw new JobPostingOperationErrorV1("source-changed", "source", "The source changed after preflight validation.");
  }
  const text = decode(bytes);
  const contentDigest: JobPostingContentDigestV1 = {
    algorithm: "sha-256",
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
  let fields: JobPostingFieldsV1;
  if (request.sourceType === "structured-json") {
    let parsed: unknown;
    try { parsed = parseCanonicalJsonV1(bytes); } catch {
      throw new JobPostingOperationErrorV1("contract-invalid", "contract", "The structured Job Posting source is invalid.");
    }
    try { fields = fieldsFromStructuredInputV1(validateJobPostingInputV1(parsed)); } catch {
      throw new JobPostingOperationErrorV1("contract-invalid", "contract", "The structured Job Posting source is invalid.");
    }
  } else {
    fields = descriptionOnlyFieldsV1(text);
  }
  const approvedRelativePath = relative(request.approvedInputRoot.absolutePath, recheck.resolvedPath).replaceAll("\\", "/");
  if (approvedRelativePath.length === 0 || approvedRelativePath.startsWith("../") || approvedRelativePath === ".."
    || /^[A-Za-z]:/.test(approvedRelativePath)) {
    throw new JobPostingOperationErrorV1("preflight-rejected", "preflight", "The approved relative source path is invalid.");
  }
  return {
    request,
    contentDigest,
    originalFilename: basename(recheck.resolvedPath),
    approvedRelativePath,
    parser: parser(request.sourceType),
    fields,
  };
}
