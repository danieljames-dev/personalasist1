/**
 * One-shot probe of Lakeland Toyota public inventory pages.
 * Does not write state. Owner-authorized public fetch only.
 */
const urls = [
  "https://www.lakelandtoyota.com/searchnew.aspx",
  "https://www.lakelandtoyota.com/searchused.aspx",
  "https://www.lakelandtoyota.com/inventorylineup.aspx",
  "https://www.lakelandtoyota.com/",
];

for (const url of urls) {
  try {
    const res = await fetch(url, {
      headers: {
        accept: "text/html,application/json",
        "user-agent": "AION-InventoryResearch/1.0 (owner-authorized public inventory; no login)",
      },
      signal: AbortSignal.timeout(25_000),
      redirect: "follow",
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(buf.slice(0, 800_000));
    const vins = [
      ...new Set(
        (text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || [])
          .map((v) => v.toUpperCase())
          .filter((v) => !/[IOQ]/.test(v)),
      ),
    ];
    const vinJson = (text.match(/"vin"\s*:\s*"[A-HJ-NPR-Z0-9]{17}"/gi) || []).length;
    const ld = (text.match(/application\/ld\+json/gi) || []).length;
    const apiHints = (text.match(/ws-inv|getInventory|inventory-data|DealerInspire|dealer\.com|srp-inventory/gi) || [])
      .slice(0, 8);
    console.log(
      JSON.stringify({
        url,
        status: res.status,
        bytes: buf.length,
        finalUrl: res.url,
        vins: vins.length,
        sampleVins: vins.slice(0, 5),
        vinJson,
        ld,
        apiHints,
        head: text.slice(0, 160).replace(/\s+/g, " "),
      }),
    );
  } catch (e) {
    console.log(JSON.stringify({ url, err: String(e?.message || e).slice(0, 160) }));
  }
}
