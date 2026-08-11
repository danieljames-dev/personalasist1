/** Dump HTML context around first VIN for parser improvement. */
const url = "https://www.lakelandtoyota.com/searchnew.aspx";
const res = await fetch(url, {
  headers: {
    accept: "text/html",
    "user-agent": "AION-InventoryResearch/1.0 (owner-authorized public inventory; no login)",
  },
  signal: AbortSignal.timeout(25_000),
});
const text = await res.text();
const m = /"vin"\s*:\s*"([A-HJ-NPR-Z0-9]{17})"/i.exec(text);
if (!m) {
  console.log("no vin json");
  process.exit(0);
}
const start = Math.max(0, (m.index ?? 0) - 800);
const window = text.slice(start, start + 2500);
console.log(window);
console.log("\n--- KEYS ---");
const keys = [...window.matchAll(/"([a-zA-Z0-9_]+)"\s*:/g)].map((x) => x[1]);
console.log([...new Set(keys)].sort().join(", "));
