// NON-PRODUCTION BENCHMARK PROBE — synthetic shape generators.
//
// Generates adversarial and ordinary JSON shapes for resource-limit measurement.
// Synthetic data only. No personal or owner data. No network. Node built-ins only.
//
// These generators are deliberately simple and allocation-obvious so that measured cost
// reflects the shape under test rather than the generator.

/** Nested arrays to a given depth: [[[...]]] */
export function nestArray(depth) {
  let s = 'null';
  for (let i = 0; i < depth; i++) s = '[' + s + ']';
  return s;
}

/** Nested objects to a given depth: {"a":{"a":{...}}} */
export function nestObject(depth) {
  let s = 'null';
  for (let i = 0; i < depth; i++) s = '{"a":' + s + '}';
  return s;
}

/** One object with N distinct members, values are small integers. */
export function wideObject(members) {
  const parts = new Array(members);
  for (let i = 0; i < members; i++) parts[i] = `"m${i}":${i}`;
  return '{' + parts.join(',') + '}';
}

/** One array with N small integer elements. */
export function largeArray(elements) {
  const parts = new Array(elements);
  for (let i = 0; i < elements; i++) parts[i] = String(i);
  return '[' + parts.join(',') + ']';
}

/** One object with a single very long ASCII string value. */
export function longAsciiString(bytes) {
  return '{"s":"' + 'a'.repeat(bytes) + '"}';
}

/** One object with a long multibyte UTF-8 string (3 bytes per char). */
export function longMultibyteString(chars) {
  return '{"s":"' + '中'.repeat(chars) + '"}';
}

/** Combining characters — NFD form of e-acute repeated. Not NFC. */
export function longCombiningString(chars) {
  return '{"s":"' + 'é'.repeat(chars) + '"}';
}

/** Already-NFC string of the same visual content. */
export function longNfcString(chars) {
  return '{"s":"' + 'é'.repeat(chars) + '"}';
}

/** Object with N members whose NAMES are long. */
export function longMemberNames(members, nameLen) {
  const parts = new Array(members);
  for (let i = 0; i < members; i++) parts[i] = `"${'k'.repeat(nameLen)}${i}":${i}`;
  return '{' + parts.join(',') + '}';
}

/** Deep AND wide: an object tree of given depth where each level has `width` members. */
export function deepAndWide(depth, width) {
  function build(d) {
    if (d === 0) return '0';
    const inner = build(d - 1);
    const parts = new Array(width);
    for (let i = 0; i < width; i++) parts[i] = `"m${i}":${inner}`;
    return '{' + parts.join(',') + '}';
  }
  return build(depth);
}

/** Total node count spread across many small containers. */
export function manySmallContainers(count) {
  const parts = new Array(count);
  for (let i = 0; i < count; i++) parts[i] = '{"a":1}';
  return '[' + parts.join(',') + ']';
}

/** Duplicate members — the case a parsed host value cannot represent. */
export function duplicateMembers(count) {
  const parts = new Array(count);
  for (let i = 0; i < count; i++) parts[i] = '"dup":' + i;
  return '{' + parts.join(',') + '}';
}

/** Malformed: invalid escape sequence, positioned early or late. */
export function invalidEscape(padBytes, late) {
  const pad = 'a'.repeat(padBytes);
  return late ? `{"s":"${pad}\\q"}` : `{"s":"\\q${pad}"}`;
}

/** Malformed: trailing content after a complete value. */
export function trailingContent(padBytes) {
  return '{"a":' + '1'.repeat(1) + '}' + ' '.repeat(padBytes) + 'x';
}

/** Malformed: bad number syntax, positioned late. */
export function malformedNumberLate(padBytes) {
  return '{"pad":"' + 'a'.repeat(padBytes) + '","n":01}';
}

/** Valid JSON whose value is invalid only at the very end (late semantic failure). */
export function lateInvalidValue(padBytes) {
  return '{"pad":"' + 'a'.repeat(padBytes) + '","bad":1.5}'; // float: prohibited by ACJ-1 §8
}

/** Raw bytes: invalid UTF-8 (lone surrogate encoded as CESU-8-style ED A0 80). */
export function invalidUtf8Bytes() {
  return Buffer.from([0x7b, 0x22, 0x73, 0x22, 0x3a, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x7d]);
}

/** Raw bytes: UTF-8 BOM followed by a valid object. */
export function bomBytes() {
  return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}', 'utf8')]);
}

/** Integers at the ACJ-1 §7 boundary. */
export const MAX_SAFE = 9007199254740991; // 2^53 - 1
export function integerBoundary(which) {
  if (which === 'max') return `{"n":${MAX_SAFE}}`;
  if (which === 'min') return `{"n":${-MAX_SAFE}}`;
  if (which === 'over') return `{"n":${MAX_SAFE + 2}}`; // beyond exact double range
  return '{"n":0}';
}

/** Decimal-string and scaled-integer candidate representations (ACJ-1 §9). */
export function decimalCandidates(count) {
  const dec = new Array(count);
  const sca = new Array(count);
  for (let i = 0; i < count; i++) {
    dec[i] = `{"v":"0.${String(i).padStart(3, '0')}"}`;
    sca[i] = `{"v":${i},"scale":3}`;
  }
  return { decimalStrings: dec, scaledIntegers: sca };
}

/** Prohibited binary-float source representations (ACJ-1 §8). */
export function floatSources() {
  return ['{"v":1.5}', '{"v":1e2}', '{"v":-0}', '{"v":0.1}'];
}
