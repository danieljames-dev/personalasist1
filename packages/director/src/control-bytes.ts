/**
 * The one control-byte set this package refuses.
 *
 * Win32 native APIs terminate at a NUL, so a string that contains one is not
 * the string that will be opened. Every other C0 control and DEL is the same
 * class: the validated token and the consumed token stop being the same token.
 * Written as escapes so a raw control byte never sits in source.
 */
export const CONTROL_BYTES = /[\u0000-\u001f\u007f]/;

/**
 * One token leaf for the package. Empty, non-string, and control-bearing
 * values are not tokens. Three copies of this function used to live in
 * adapters, process-identity, and run-intent; they were byte-identical
 * today and would have drifted the first time one site "fixed" trim.
 */
export function asUsableToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || CONTROL_BYTES.test(trimmed)) return null;
  return trimmed;
}
