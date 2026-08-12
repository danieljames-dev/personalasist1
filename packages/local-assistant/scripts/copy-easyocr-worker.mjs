/** Copy EasyOCR worker next to compiled connector output. */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src", "connectors", "easyocr-worker.py");
const destDir = join(root, "dist", "connectors");
const dest = join(destDir, "easyocr-worker.py");
if (!existsSync(src)) {
  console.error("missing", src);
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log("copied easyocr-worker.py → dist/connectors/");
