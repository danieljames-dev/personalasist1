/**
 * The one control-byte set this package refuses.
 *
 * Win32 native APIs terminate at a NUL, so a string that contains one is not
 * the string that will be opened. Every other C0 control and DEL is the same
 * class: the validated token and the consumed token stop being the same token.
 * Written as escapes so a raw control byte never sits in source.
 */
export const CONTROL_BYTES = /[\u0000-\u001f\u007f]/;
