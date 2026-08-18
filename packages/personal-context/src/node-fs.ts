/**
 * The real filesystem, exposed through the read-only surface this package is allowed to use.
 *
 * `realpathSync.native` rather than the JavaScript implementation, because the native one is what
 * resolves junctions and reparse points on Windows — and those are exactly the aliases the path
 * boundary exists to catch. It also emits the long form of an 8.3 short name, which is what makes
 * `isResolvedHostPath` usable on the result.
 *
 * Files are read as UTF-8 text. There is no binary path here on purpose: a source adapter that
 * cannot express a byte read cannot be talked into ingesting an archive or an image.
 */

import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";

import type { FileStatV1, PersonalContextFsV1 } from "./path-boundary.js";

export function createNodePersonalContextFs(): PersonalContextFsV1 {
  return {
    realpathSync(path) {
      return realpathSync.native(path);
    },
    lstatSync(path): FileStatV1 {
      const stat = lstatSync(path);
      return {
        isDirectory: () => stat.isDirectory(),
        isFile: () => stat.isFile(),
        isSymbolicLink: () => stat.isSymbolicLink(),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
    },
    readdirSync(path) {
      return readdirSync(path);
    },
    readFileSync(path) {
      return readFileSync(path, "utf8");
    },
  };
}
