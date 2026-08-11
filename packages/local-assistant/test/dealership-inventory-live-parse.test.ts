import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInventorySaveItems,
  parsePublicInventoryHtml,
} from "../src/connectors/dealership-inventory.js";

const now = "2026-08-12T12:00:00.000Z";
let n = 0;
const nextId = (k: string) => `${k}-${++n}`;

const sampleHtml = `
<script>
window.addEventListener("load", function() {
var inventorySaveItemsObj = {
"dg-inline-save-inv-5YFB4MDEXTP490712": {
"marketingSeries": "Corolla",
"marketingName": "Corolla LE",
"year": 2026,
"vin": "5YFB4MDEXTP490712",
"price": 0.0,
"advertisedPrice": 25248.0,
"vdpHref": "https://www.lakelandtoyota.com/vehicledetailsvin.aspx?vin=5YFB4MDEXTP490712",
"salesClass": "new",
"brand": "Toyota"
},
"dg-inline-save-inv-5YFB4MDEXTP490712-mobile": {
"marketingSeries": "Corolla",
"marketingName": "Corolla LE",
"year": 2026,
"vin": "5YFB4MDEXTP490712",
"advertisedPrice": 25248.0,
"brand": "Toyota",
"salesClass": "new"
}
};
});
</script>
<script type="application/ld+json">
{"@type":"ItemList","itemListElement":[{"@type":"ListItem","position":1,"name":"2026 Toyota Camry SE","identifier":"4T1G11AK5PU123456","url":"https://example/v"}]}
</script>
`;

test("parseInventorySaveItems extracts model trim price without inventing zeros", () => {
  n = 0;
  const rows = parseInventorySaveItems(sampleHtml, "https://www.lakelandtoyota.com/searchnew.aspx", now, nextId, "new");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.vin, "5YFB4MDEXTP490712");
  assert.equal(rows[0]!.make, "Toyota");
  assert.equal(rows[0]!.model, "Corolla");
  assert.equal(rows[0]!.trim, "LE");
  assert.equal(rows[0]!.advertisedPrice, 25248);
  assert.equal(rows[0]!.sourceType, "public-dealer-site");
});

test("parsePublicInventoryHtml merges save-items and list-item without fixture class", () => {
  n = 0;
  const rows = parsePublicInventoryHtml(sampleHtml, "https://www.lakelandtoyota.com/searchnew.aspx", now, nextId, "new");
  const vins = new Set(rows.map((r) => r.vin));
  assert.ok(vins.has("5YFB4MDEXTP490712"));
  assert.ok(vins.has("4T1G11AK5PU123456"));
  assert.ok(rows.every((r) => r.sourceType === "public-dealer-site"));
  const camry = rows.find((r) => r.vin === "4T1G11AK5PU123456");
  assert.equal(camry?.year, 2026);
  assert.equal(camry?.make, "Toyota");
  assert.match(String(camry?.model || ""), /Camry/i);
});
