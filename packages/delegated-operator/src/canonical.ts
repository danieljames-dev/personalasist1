import { createHash, timingSafeEqual } from "node:crypto";
import { DelegatedOperatorError } from "./contracts.js";

/**
 * Deterministic ACJ-style subset: NFC strings, sorted object keys, no undefined,
 * integers only (no float), arrays preserve order. Used for envelope digests.
 */

function isUnicodeScalarString(value: string): boolean {
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

function fail(message: string): never {
  throw new DelegatedOperatorError("canonical-invalid", message);
}

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) fail("Non-safe-integer number.");
    return String(value);
  }
  if (typeof value === "string") {
    if (!isUnicodeScalarString(value) || value.normalize("NFC") !== value) fail("String not NFC/scalar.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const proto = Object.getPrototypeOf(record);
    if (proto !== Object.prototype && proto !== null) fail("Non-plain object.");
    const keys = Object.keys(record).sort();
    for (const key of keys) {
      if (key.normalize("NFC") !== key || !isUnicodeScalarString(key)) fail("Bad object key.");
      if (record[key] === undefined) fail("Undefined member.");
    }
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  fail("Unsupported canonical value.");
}

export function digestCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length !== bb.length || ba.length === 0) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
