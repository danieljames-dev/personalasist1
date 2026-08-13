const fs = require("node:fs");
const out = process.argv[2];
const payload = {
  argv: process.argv.slice(2),
  nonce: process.env.AION_RUN_NONCE || null,
  cwd: process.cwd(),
};
if (out && out !== "--") fs.writeFileSync(out, JSON.stringify(payload));
else process.stdout.write(JSON.stringify(payload));
