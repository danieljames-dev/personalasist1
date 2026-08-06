import { MAX_RAW_INPUT_BYTES, ObjectErrorV1, parseCanonicalJsonV1 } from "@aion/object";
import {
  authorizeLocalTextInput,
  type ApprovedRootV1,
  type ExplicitInputPathV1,
  type PathBoundaryReasonV1,
} from "@aion/privacy-boundary";
import { open } from "node:fs/promises";
import { extname } from "node:path";

import {
  CareerInputErrorV1,
  type CareerInputFileKindV1,
  type CareerInputValidationErrorV1,
  validateCareerInputContractV1,
} from "./contracts.js";

export const CAREER_INPUT_MAX_RAW_BYTES_V1 = MAX_RAW_INPUT_BYTES;

export interface CareerInputPreflightRequestV1 {
  readonly version: "1";
  readonly approvedRoot: ApprovedRootV1;
  readonly inputPath: ExplicitInputPathV1;
  readonly expectedKind?: CareerInputFileKindV1;
}

export interface CareerInputPreflightSummaryV1 {
  readonly contentReturned: false;
  readonly pathReturned: false;
  readonly ingestionPerformed: false;
  readonly persistencePerformed: false;
  readonly networkPerformed: false;
}

export type CareerInputPreflightResultV1 =
  | {
      readonly version: "1";
      readonly accepted: true;
      readonly kind: CareerInputFileKindV1;
      readonly extension: ".json" | ".md" | ".txt";
      readonly byteLength: number;
      readonly utf8: "valid";
      readonly bom: "absent";
      readonly contractVersion: string | null;
      readonly summary: CareerInputPreflightSummaryV1;
    }
  | {
      readonly version: "1";
      readonly accepted: false;
      readonly error: CareerInputValidationErrorV1;
      readonly summary: CareerInputPreflightSummaryV1;
    };

const SUMMARY: CareerInputPreflightSummaryV1 = Object.freeze({
  contentReturned: false,
  pathReturned: false,
  ingestionPerformed: false,
  persistencePerformed: false,
  networkPerformed: false,
});

function reject(error: CareerInputErrorV1): CareerInputPreflightResultV1 {
  return { version: "1", accepted: false, error: error.toValidationError(), summary: SUMMARY };
}

function pathError(reason: PathBoundaryReasonV1): CareerInputErrorV1 {
  if (reason === "unsupported-extension") {
    return new CareerInputErrorV1("unsupported-extension", "path", "Only JSON, Markdown, and text files are supported.");
  }
  if (reason === "target-not-file") {
    return new CareerInputErrorV1("input-not-file", "path", "An existing regular file is required.");
  }
  return new CareerInputErrorV1("path-rejected", "path", "The explicit path failed approved-root validation.");
}

function inputExtension(value: string): ".json" | ".md" | ".txt" {
  const extension = extname(value).toLocaleLowerCase("en-US");
  if (extension !== ".json" && extension !== ".md" && extension !== ".txt") {
    throw new CareerInputErrorV1("unsupported-extension", "path", "Only JSON, Markdown, and text files are supported.");
  }
  return extension;
}

function validRequest(request: CareerInputPreflightRequestV1): boolean {
  if (typeof request !== "object" || request === null || Array.isArray(request)) return false;
  const keys = Object.keys(request);
  if (!keys.every((key) => ["approvedRoot", "expectedKind", "inputPath", "version"].includes(key))) return false;
  return request.version === "1"
    && typeof request.approvedRoot === "object" && request.approvedRoot !== null
    && request.approvedRoot.version === "1"
    && typeof request.approvedRoot.reference === "string"
    && typeof request.approvedRoot.absolutePath === "string"
    && typeof request.inputPath === "object" && request.inputPath !== null
    && request.inputPath.version === "1"
    && typeof request.inputPath.absolutePath === "string";
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function hasUnsupportedBom(bytes: Uint8Array): boolean {
  return (bytes.byteLength >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)))
    || (bytes.byteLength >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff);
}

function decodeUtf8(bytes: Uint8Array): string {
  if (hasUtf8Bom(bytes)) throw new CareerInputErrorV1("bom-rejected", "encoding", "UTF-8 BOM is not permitted.");
  if (hasUnsupportedBom(bytes)) throw new CareerInputErrorV1("unsupported-encoding", "encoding", "Only UTF-8 without BOM is supported.");
  if (bytes.includes(0)) throw new CareerInputErrorV1("nul-byte-rejected", "encoding", "NUL bytes are not permitted.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CareerInputErrorV1("invalid-utf8", "encoding", "Input is not valid UTF-8.");
  }
}

function evidenceKind(expected: CareerInputFileKindV1 | undefined): CareerInputFileKindV1 {
  if (expected === undefined || expected === "evidence-text") return "evidence-text";
  if (expected === "resume-evidence" || expected === "work-history-evidence") return expected;
  throw new CareerInputErrorV1("kind-mismatch", "contract", "The expected input kind does not match a text evidence file.");
}

async function readBounded(handle: Awaited<ReturnType<typeof open>>): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(MAX_RAW_INPUT_BYTES + 1);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, null);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > MAX_RAW_INPUT_BYTES) {
    throw new CareerInputErrorV1("input-too-large", "bytes", "Input exceeds the accepted raw-byte limit.");
  }
  return buffer.subarray(0, offset);
}

export async function preflightCareerInputV1(request: CareerInputPreflightRequestV1): Promise<CareerInputPreflightResultV1> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    if (!validRequest(request)) throw new CareerInputErrorV1("request-invalid", "request", "A closed version-1 preflight request is required.");
    const extension = inputExtension(request.inputPath.absolutePath);
    const pathRequest = {
      version: "1" as const,
      operation: "read-file" as const,
      approvedRoot: request.approvedRoot,
      requestedPath: request.inputPath,
    };
    const first = authorizeLocalTextInput(pathRequest);
    if (!first.authorized) throw pathError(first.error.reason);
    const second = authorizeLocalTextInput({
      ...pathRequest,
      requestedPath: { version: "1", absolutePath: first.resolvedPath },
    });
    if (!second.authorized) throw pathError(second.error.reason);

    handle = await open(second.resolvedPath, "r");
    const state = await handle.stat();
    if (!state.isFile()) throw new CareerInputErrorV1("input-not-file", "path", "An existing regular file is required.");
    if (state.size > MAX_RAW_INPUT_BYTES) throw new CareerInputErrorV1("input-too-large", "bytes", "Input exceeds the accepted raw-byte limit.");
    const bytes = await readBounded(handle);
    decodeUtf8(bytes);

    let kind: CareerInputFileKindV1;
    let contractVersion: string | null = null;
    if (extension === ".json") {
      let parsed: unknown;
      try {
        parsed = parseCanonicalJsonV1(bytes);
      } catch (error) {
        if (error instanceof ObjectErrorV1 && error.code === "limit-exceeded" && error.limitId === "L-01") {
          throw new CareerInputErrorV1("input-too-large", "bytes", "Input exceeds the accepted raw-byte limit.");
        }
        throw new CareerInputErrorV1("malformed-json", "contract", "JSON input is malformed or outside the accepted value domain.");
      }
      const validated = validateCareerInputContractV1(parsed);
      kind = validated.kind;
      contractVersion = validated.contractVersion;
      if (request.expectedKind !== undefined && request.expectedKind !== kind) {
        throw new CareerInputErrorV1("kind-mismatch", "contract", "The expected input kind does not match the contract.");
      }
    } else {
      kind = evidenceKind(request.expectedKind);
    }

    return {
      version: "1",
      accepted: true,
      kind,
      extension,
      byteLength: bytes.byteLength,
      utf8: "valid",
      bom: "absent",
      contractVersion,
      summary: SUMMARY,
    };
  } catch (error) {
    if (error instanceof CareerInputErrorV1) return reject(error);
    return reject(new CareerInputErrorV1("io-failed", "path", "The explicitly selected file could not be validated safely."));
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
