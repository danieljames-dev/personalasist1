import { createHash, timingSafeEqual } from "node:crypto";
import {
  ObjectErrorV1,
  type CanonicalValueV1,
  type ObjectCanonicalSerializerV1,
  type ObjectDigestV1,
  type ValidatedCanonicalValueV1,
} from "./contracts.js";

export const ACJ_1_PROFILE = "acj-1" as const;
export const RESOURCE_LIMITS_PROFILE = "aion-resource-limits-1" as const;
export const MAX_SAFE_CANONICAL_INTEGER = 9_007_199_254_740_991;
export const MAX_RAW_INPUT_BYTES = 4 * 1024 * 1024;
export const MAX_CANONICAL_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_NESTING_DEPTH = 64;
export const MAX_OBJECT_MEMBERS = 4_096;
export const MAX_ARRAY_ELEMENTS = 65_536;
export const MAX_TOTAL_VALUE_NODES = 262_144;
export const MAX_STRING_BYTES = 1024 * 1024;
export const MAX_MEMBER_NAME_BYTES = 1_024;
export const MAX_IDENTIFIER_BYTES = 256;
export const MAX_FRAME_TEXT_BYTES = 1_024;

const encoder = new TextEncoder();
const FRAME_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/;

function fail(
  code: ConstructorParameters<typeof ObjectErrorV1>[0],
  location: string,
  message: string,
  limitId?: string,
): never {
  throw new ObjectErrorV1(code, location, message, limitId);
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function validateCanonicalStringV1(value: unknown, location: string): asserts value is string {
  if (typeof value !== "string" || !isUnicodeScalarString(value) || value.normalize("NFC") !== value) {
    fail("invalid-string", location, "Canonical string validation failed.");
  }
  if (byteLength(value) > MAX_STRING_BYTES) {
    fail("limit-exceeded", location, "Canonical string exceeds L-08.", "L-08");
  }
}

export function validateCanonicalIdentifierV1(value: unknown, location: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    fail("invalid-identifier", location, "Canonical identifier validation failed.");
  }
  validateCanonicalStringV1(value, location);
  if (byteLength(value) > MAX_IDENTIFIER_BYTES) {
    fail("invalid-identifier", location, "Canonical identifier exceeds L-11.", "L-11");
  }
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

interface VisitFrame {
  readonly value: unknown;
  readonly location: string;
  readonly depth: number;
  readonly leave?: object;
}

export function validateCanonicalValueV1(value: unknown): ValidatedCanonicalValueV1 {
  let nodes = 0;
  const active = new WeakSet<object>();
  const stack: VisitFrame[] = [{ value, location: "$", depth: 0 }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    if (frame.leave) {
      active.delete(frame.leave);
      continue;
    }

    nodes += 1;
    if (nodes > MAX_TOTAL_VALUE_NODES) {
      fail("limit-exceeded", frame.location, "Canonical value exceeds L-07.", "L-07");
    }

    const current = frame.value;
    if (current === null || typeof current === "boolean") continue;
    if (typeof current === "number") {
      if (!Number.isFinite(current) || !Number.isInteger(current) || Object.is(current, -0)) {
        fail("unsupported-value-kind", frame.location, "Canonical numbers must be finite non-negative-zero integers.");
      }
      if (!Number.isSafeInteger(current) || Math.abs(current) > MAX_SAFE_CANONICAL_INTEGER) {
        fail("integer-out-of-range", frame.location, "Canonical integer is outside NF-1.");
      }
      continue;
    }
    if (typeof current === "string") {
      validateCanonicalStringV1(current, frame.location);
      continue;
    }
    if (typeof current !== "object") {
      fail("unsupported-value-kind", frame.location, "Value kind is outside ACJ-1.");
    }
    if (active.has(current)) {
      fail("unsupported-value-kind", frame.location, "Cyclic values are outside ACJ-1.");
    }

    const nextDepth = frame.depth + 1;
    if (nextDepth > MAX_NESTING_DEPTH) {
      fail("limit-exceeded", frame.location, "Canonical value exceeds L-04.", "L-04");
    }
    active.add(current);
    stack.push({ value: null, location: frame.location, depth: frame.depth, leave: current });

    if (Array.isArray(current)) {
      if (current.length > MAX_ARRAY_ELEMENTS) {
        fail("limit-exceeded", frame.location, "Canonical array exceeds L-06.", "L-06");
      }
      if (Object.getOwnPropertySymbols(current).length > 0 || Object.keys(current).length !== current.length) {
        fail("unsupported-value-kind", frame.location, "Array side properties are outside ACJ-1.");
      }
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
          fail("unsupported-value-kind", `${frame.location}[${index}]`, "Sparse arrays are outside ACJ-1.");
        }
        stack.push({ value: descriptor.value, location: `${frame.location}[${index}]`, depth: nextDepth });
      }
      continue;
    }

    if (!isPlainRecord(current)) {
      fail("unsupported-value-kind", frame.location, "Only plain Object values are in ACJ-1.");
    }
    const symbols = Object.getOwnPropertySymbols(current);
    if (symbols.length > 0) {
      fail("invalid-key", frame.location, "Symbol keys are outside ACJ-1.");
    }
    const keys = Object.keys(current);
    if (keys.length > MAX_OBJECT_MEMBERS) {
      fail("limit-exceeded", frame.location, "Canonical Object exceeds L-05.", "L-05");
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (key === undefined || key.length === 0 || !isUnicodeScalarString(key) || key.normalize("NFC") !== key) {
        fail("invalid-key", frame.location, "Canonical member name validation failed.");
      }
      if (byteLength(key) > MAX_MEMBER_NAME_BYTES) {
        fail("limit-exceeded", frame.location, "Canonical member name exceeds L-10.", "L-10");
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
        fail("unsupported-value-kind", `${frame.location}.${key}`, "Accessor and non-enumerable values are outside ACJ-1.");
      }
      stack.push({ value: descriptor.value, location: `${frame.location}.*`, depth: nextDepth });
    }
  }

  return value as ValidatedCanonicalValueV1;
}

function serializeValidated(value: CanonicalValueV1): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => serializeValidated(entry)).join(",")}]`;
  const record = value as { readonly [key: string]: CanonicalValueV1 };
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serializeValidated(record[key] as CanonicalValueV1)}`);
  return `{${entries.join(",")}}`;
}

export function canonicalizeValidatedValueV1(value: ValidatedCanonicalValueV1): Uint8Array {
  const bytes = encoder.encode(serializeValidated(value));
  if (bytes.byteLength > MAX_CANONICAL_OUTPUT_BYTES) {
    fail("limit-exceeded", "$", "Canonical output exceeds L-02.", "L-02");
  }
  return bytes;
}

export function canonicalizeValueV1(value: unknown): Uint8Array {
  return canonicalizeValidatedValueV1(validateCanonicalValueV1(value));
}

type ScanFrame =
  | { kind: "object"; state: "key-or-end" | "colon" | "value" | "comma-or-end"; members: number }
  | { kind: "array"; state: "value-or-end" | "comma-or-end"; elements: number };

class RawStructureScannerV1 {
  #index = 0;
  #nodes = 0;
  #rootComplete = false;
  readonly #stack: ScanFrame[] = [];

  constructor(private readonly source: string) {}

  scan(): void {
    while (true) {
      this.#skipWhitespace();
      const frame = this.#stack.at(-1);
      if (!frame) {
        if (this.#rootComplete) {
          if (this.#index !== this.source.length) fail("unsupported-value-kind", "$", "Raw JSON contains trailing content.");
          return;
        }
        this.#consumeValue();
        continue;
      }
      if (frame.kind === "object") this.#scanObject(frame);
      else this.#scanArray(frame);
    }
  }

  #skipWhitespace(): void {
    while (this.#index < this.source.length && /[\u0009\u000a\u000d\u0020]/.test(this.source[this.#index] ?? "")) {
      this.#index += 1;
    }
  }

  #scanObject(frame: Extract<ScanFrame, { kind: "object" }>): void {
    const token = this.source[this.#index];
    if (frame.state === "key-or-end") {
      if (token === "}") {
        if (frame.members > 0) fail("unsupported-value-kind", "$", "Raw JSON Object has a trailing comma.");
        this.#index += 1;
        this.#stack.pop();
        return;
      }
      if (token !== '"') fail("invalid-key", "$", "Raw JSON Object key is invalid.");
      this.#skipString();
      frame.members += 1;
      if (frame.members > MAX_OBJECT_MEMBERS) fail("limit-exceeded", "$", "Raw JSON exceeds L-05.", "L-05");
      frame.state = "colon";
      return;
    }
    if (frame.state === "colon") {
      if (token !== ":") fail("unsupported-value-kind", "$", "Raw JSON Object is malformed.");
      this.#index += 1;
      frame.state = "value";
      return;
    }
    if (frame.state === "value") {
      this.#consumeValue();
      frame.state = "comma-or-end";
      return;
    }
    if (token === "}") {
      this.#index += 1;
      this.#stack.pop();
      return;
    }
    if (token !== ",") fail("unsupported-value-kind", "$", "Raw JSON Object is malformed.");
    this.#index += 1;
    frame.state = "key-or-end";
  }

  #scanArray(frame: Extract<ScanFrame, { kind: "array" }>): void {
    const token = this.source[this.#index];
    if (frame.state === "value-or-end") {
      if (token === "]") {
        if (frame.elements > 0) fail("unsupported-value-kind", "$", "Raw JSON array has a trailing comma.");
        this.#index += 1;
        this.#stack.pop();
        return;
      }
      frame.elements += 1;
      if (frame.elements > MAX_ARRAY_ELEMENTS) fail("limit-exceeded", "$", "Raw JSON exceeds L-06.", "L-06");
      this.#consumeValue();
      frame.state = "comma-or-end";
      return;
    }
    if (token === "]") {
      this.#index += 1;
      this.#stack.pop();
      return;
    }
    if (token !== ",") fail("unsupported-value-kind", "$", "Raw JSON array is malformed.");
    this.#index += 1;
    frame.state = "value-or-end";
  }

  #consumeValue(): void {
    this.#skipWhitespace();
    this.#nodes += 1;
    if (this.#nodes > MAX_TOTAL_VALUE_NODES) fail("limit-exceeded", "$", "Raw JSON exceeds L-07.", "L-07");
    const token = this.source[this.#index];
    if (token === "{" || token === "[") {
      this.#index += 1;
      if (this.#stack.length + 1 > MAX_NESTING_DEPTH) fail("limit-exceeded", "$", "Raw JSON exceeds L-04.", "L-04");
      this.#stack.push(token === "{"
        ? { kind: "object", state: "key-or-end", members: 0 }
        : { kind: "array", state: "value-or-end", elements: 0 });
      this.#rootComplete = true;
      return;
    }
    if (token === '"') this.#skipString();
    else if (token === "t" && this.source.slice(this.#index, this.#index + 4) === "true") this.#index += 4;
    else if (token === "f" && this.source.slice(this.#index, this.#index + 5) === "false") this.#index += 5;
    else if (token === "n" && this.source.slice(this.#index, this.#index + 4) === "null") this.#index += 4;
    else if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) this.#skipNumber();
    else fail("unsupported-value-kind", "$", "Raw JSON value is invalid.");
    this.#rootComplete = true;
  }

  #skipString(): void {
    this.#index += 1;
    let escaped = false;
    while (this.#index < this.source.length) {
      const character = this.source[this.#index];
      if (!escaped && character === '"') {
        this.#index += 1;
        return;
      }
      if (!escaped && character !== undefined && character.charCodeAt(0) < 0x20) {
        fail("invalid-string", "$", "Raw JSON string contains a control character.");
      }
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      this.#index += 1;
    }
    fail("invalid-string", "$", "Raw JSON string is truncated.");
  }

  #skipNumber(): void {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.source.slice(this.#index));
    if (!match) fail("unsupported-value-kind", "$", "Raw JSON number is malformed.");
    this.#index += match[0].length;
    const next = this.source[this.#index];
    if (next !== undefined && !/[\u0009\u000a\u000d\u0020,}\]]/.test(next)) {
      fail("unsupported-value-kind", "$", "Raw JSON number is malformed.");
    }
  }
}

class RawCanonicalJsonParserV1 {
  #index = 0;
  #nodes = 0;

  constructor(private readonly source: string) {}

  parse(): CanonicalValueV1 {
    this.#skipWhitespace();
    const value = this.#parseValue(0, "$");
    this.#skipWhitespace();
    if (this.#index !== this.source.length) {
      fail("unsupported-value-kind", "$", "Raw JSON contains trailing content.");
    }
    return value;
  }

  #skipWhitespace(): void {
    while (this.#index < this.source.length && /[\u0009\u000a\u000d\u0020]/.test(this.source[this.#index] ?? "")) {
      this.#index += 1;
    }
  }

  #countNode(location: string): void {
    this.#nodes += 1;
    if (this.#nodes > MAX_TOTAL_VALUE_NODES) {
      fail("limit-exceeded", location, "Raw JSON exceeds L-07.", "L-07");
    }
  }

  #parseValue(depth: number, location: string): CanonicalValueV1 {
    this.#countNode(location);
    const token = this.source[this.#index];
    if (token === "{") return this.#parseObject(depth + 1, location);
    if (token === "[") return this.#parseArray(depth + 1, location);
    if (token === '"') return this.#parseString(location, false);
    if (token === "t" && this.source.slice(this.#index, this.#index + 4) === "true") {
      this.#index += 4;
      return true;
    }
    if (token === "f" && this.source.slice(this.#index, this.#index + 5) === "false") {
      this.#index += 5;
      return false;
    }
    if (token === "n" && this.source.slice(this.#index, this.#index + 4) === "null") {
      this.#index += 4;
      return null;
    }
    if (token === "-" || (token !== undefined && token >= "0" && token <= "9")) {
      return this.#parseNumber(location);
    }
    fail("unsupported-value-kind", location, "Raw JSON value is invalid.");
  }

  #assertDepth(depth: number, location: string): void {
    if (depth > MAX_NESTING_DEPTH) {
      fail("limit-exceeded", location, "Raw JSON exceeds L-04.", "L-04");
    }
  }

  #parseObject(depth: number, location: string): CanonicalValueV1 {
    this.#assertDepth(depth, location);
    this.#index += 1;
    this.#skipWhitespace();
    const output: Record<string, CanonicalValueV1> = Object.create(null) as Record<string, CanonicalValueV1>;
    const keys = new Set<string>();
    let count = 0;
    if (this.source[this.#index] === "}") {
      this.#index += 1;
      return output;
    }
    while (true) {
      if (this.source[this.#index] !== '"') fail("invalid-key", location, "Raw JSON Object key is invalid.");
      const key = this.#parseString(`${location}.*`, true);
      if (keys.has(key)) fail("duplicate-member", `${location}.*`, "Raw JSON contains a duplicate member.");
      keys.add(key);
      count += 1;
      if (count > MAX_OBJECT_MEMBERS) fail("limit-exceeded", location, "Raw JSON exceeds L-05.", "L-05");
      this.#skipWhitespace();
      if (this.source[this.#index] !== ":") fail("unsupported-value-kind", location, "Raw JSON Object is malformed.");
      this.#index += 1;
      this.#skipWhitespace();
      output[key] = this.#parseValue(depth, `${location}.*`);
      this.#skipWhitespace();
      const delimiter = this.source[this.#index];
      if (delimiter === "}") {
        this.#index += 1;
        return output;
      }
      if (delimiter !== ",") fail("unsupported-value-kind", location, "Raw JSON Object is malformed.");
      this.#index += 1;
      this.#skipWhitespace();
    }
  }

  #parseArray(depth: number, location: string): CanonicalValueV1 {
    this.#assertDepth(depth, location);
    this.#index += 1;
    this.#skipWhitespace();
    const output: CanonicalValueV1[] = [];
    if (this.source[this.#index] === "]") {
      this.#index += 1;
      return output;
    }
    while (true) {
      if (output.length >= MAX_ARRAY_ELEMENTS) fail("limit-exceeded", location, "Raw JSON exceeds L-06.", "L-06");
      output.push(this.#parseValue(depth, `${location}[${output.length}]`));
      this.#skipWhitespace();
      const delimiter = this.source[this.#index];
      if (delimiter === "]") {
        this.#index += 1;
        return output;
      }
      if (delimiter !== ",") fail("unsupported-value-kind", location, "Raw JSON array is malformed.");
      this.#index += 1;
      this.#skipWhitespace();
    }
  }

  #parseString(location: string, key: boolean): string {
    const start = this.#index;
    this.#index += 1;
    let escaped = false;
    while (this.#index < this.source.length) {
      const character = this.source[this.#index];
      if (!escaped && character === '"') {
        this.#index += 1;
        const token = this.source.slice(start, this.#index);
        let decoded: unknown;
        try {
          decoded = JSON.parse(token) as unknown;
        } catch {
          fail(key ? "invalid-key" : "invalid-string", location, "Raw JSON string is malformed.");
        }
        if (typeof decoded !== "string") fail("invalid-string", location, "Raw JSON string is invalid.");
        if (key) {
          if (decoded.length === 0 || !isUnicodeScalarString(decoded) || decoded.normalize("NFC") !== decoded) {
            fail("invalid-key", location, "Raw JSON member name is invalid.");
          }
          if (byteLength(decoded) > MAX_MEMBER_NAME_BYTES) {
            fail("limit-exceeded", location, "Raw JSON member name exceeds L-10.", "L-10");
          }
        } else {
          validateCanonicalStringV1(decoded, location);
        }
        return decoded;
      }
      if (!escaped && character !== undefined && character.charCodeAt(0) < 0x20) {
        fail(key ? "invalid-key" : "invalid-string", location, "Raw JSON string contains a control character.");
      }
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      this.#index += 1;
    }
    fail(key ? "invalid-key" : "invalid-string", location, "Raw JSON string is truncated.");
  }

  #parseNumber(location: string): number {
    const remaining = this.source.slice(this.#index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(remaining);
    if (!match) fail("unsupported-value-kind", location, "Raw JSON number is malformed.");
    const token = match[0];
    this.#index += token.length;
    const next = this.source[this.#index];
    if (next !== undefined && !/[\u0009\u000a\u000d\u0020,}\]]/.test(next)) {
      fail("unsupported-value-kind", location, "Raw JSON number is malformed.");
    }
    if (token.includes(".") || token.includes("e") || token.includes("E") || token === "-0") {
      fail("unsupported-value-kind", location, "Raw canonical numbers must be integers and not negative zero.");
    }
    let exact: bigint;
    try {
      exact = BigInt(token);
    } catch {
      fail("unsupported-value-kind", location, "Raw JSON number is malformed.");
    }
    const bound = BigInt(MAX_SAFE_CANONICAL_INTEGER);
    if (exact < -bound || exact > bound) fail("integer-out-of-range", location, "Raw integer is outside NF-1.");
    return Number(exact);
  }
}

export function parseCanonicalJsonV1(input: Uint8Array): CanonicalValueV1 {
  if (!(input instanceof Uint8Array) || input.byteLength > MAX_RAW_INPUT_BYTES) {
    fail("limit-exceeded", "$", "Raw canonical input exceeds L-01.", "L-01");
  }
  if (input.byteLength >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) {
    fail("invalid-string", "$", "UTF-8 BOM is not permitted.");
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    fail("invalid-string", "$", "Raw input is not valid UTF-8.");
  }
  new RawStructureScannerV1(source).scan();
  return new RawCanonicalJsonParserV1(source).parse();
}

export class Acj1CanonicalSerializerV1 implements ObjectCanonicalSerializerV1 {
  canonicalize(value: unknown): Uint8Array {
    return canonicalizeValueV1(value);
  }
}

export interface AionFrameFieldsV1 {
  readonly frameVersion: "1";
  readonly purpose:
    | "aion.object.integrity"
    | "aion.event.integrity"
    | "aion.export.integrity"
    | "aion.fixture.digest"
    | "aion.release.artifact"
    | "aion.signature";
  readonly profileId: string;
  readonly contractFamily: string;
  readonly contractVersion: string;
  readonly context: string;
}

function frameText(value: string, location: string, allowEmpty: boolean, limitId = "L-12"): Uint8Array {
  if ((!allowEmpty && value.length === 0) || value.normalize("NFC") !== value || !isUnicodeScalarString(value)) {
    fail("frame-length-overflow", location, "AION Frame textual field is invalid.");
  }
  if (value.length > 0 && !FRAME_IDENTIFIER.test(value)) {
    fail("frame-length-overflow", location, "AION Frame identifier grammar failed.");
  }
  const bytes = encoder.encode(value);
  if (bytes.byteLength > MAX_FRAME_TEXT_BYTES) {
    fail("frame-length-overflow", location, "AION Frame textual field exceeds its accepted limit.", limitId);
  }
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function u64(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

export function buildAionFrameV1(fields: AionFrameFieldsV1, canonicalPayload: Uint8Array): Uint8Array {
  if (fields.frameVersion !== "1") fail("unknown-frame-version", "$.frameVersion", "Unknown frame version.");
  const registeredPurposes = new Set<AionFrameFieldsV1["purpose"]>([
    "aion.object.integrity",
    "aion.event.integrity",
    "aion.export.integrity",
    "aion.fixture.digest",
    "aion.release.artifact",
    "aion.signature",
  ]);
  if (!registeredPurposes.has(fields.purpose)) {
    fail("unregistered-purpose", "$.purpose", "Unregistered AION Frame purpose.");
  }
  if (!(canonicalPayload instanceof Uint8Array) || canonicalPayload.byteLength > MAX_CANONICAL_OUTPUT_BYTES) {
    fail("frame-length-overflow", "$.payload", "AION Frame payload exceeds L-02.", "L-02");
  }

  const textFields = [
    frameText(fields.frameVersion, "$.frameVersion", false),
    frameText(fields.purpose, "$.purpose", false),
    frameText(fields.profileId, "$.profileId", false),
    frameText(fields.contractFamily, "$.contractFamily", false),
    frameText(fields.contractVersion, "$.contractVersion", false),
    frameText(fields.context, "$.context", true, "L-13"),
  ];
  const total = textFields.reduce((sum, item) => sum + 4 + item.byteLength, 0) + 8 + canonicalPayload.byteLength;
  if (!Number.isSafeInteger(total)) fail("frame-length-overflow", "$", "AION Frame length overflowed.");
  const output = new Uint8Array(total);
  let offset = 0;
  for (const field of textFields) {
    output.set(u32(field.byteLength), offset);
    offset += 4;
    output.set(field, offset);
    offset += field.byteLength;
  }
  output.set(u64(canonicalPayload.byteLength), offset);
  offset += 8;
  output.set(canonicalPayload, offset);
  return output;
}

export class Sha256ObjectDigestV1 implements ObjectDigestV1 {
  digest(algorithm: "sha-256", framedBytes: Uint8Array): string {
    if (algorithm !== "sha-256") fail("invalid-object", "$.integrity.algorithm", "Digest algorithm is not registered.");
    return createHash("sha256").update(framedBytes).digest("hex");
  }
}

export function equalDigestV1(expected: string, actual: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(expected) || !/^[0-9a-f]{64}$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}
