const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const mode = process.argv[2] || "self";
if (mode === "tree") {
  const child = spawn(process.execPath, [__filename, "self"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  child.unref();
  const marker = process.argv[3];
  if (marker) writeFileSync(marker, String(child.pid));
}
setInterval(() => {}, 60_000);
