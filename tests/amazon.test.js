const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

test("a saved Amazon product page wins over the search, and only a plain amazon.com/dp/ link counts", () => {
  const { json } = load();
  assert.deepEqual(json(`amazonLink({ amazonUrl: "https://www.amazon.com/dp/B001CUX6N0", shopQuery: "bite stick" })`), { href: "https://www.amazon.com/dp/B001CUX6N0", exact: true });
  for (const bad of ["javascript:alert(1)", "https://evil.example/dp/B001CUX6N0", "https://www.amazon.com/dp/B001CUX6N0?tag=x", "http://www.amazon.com/dp/B001CUX6N0", 42]) {
    assert.equal(json(`amazonLink({ amazonUrl: ${JSON.stringify(bad)}, shopQuery: "bite stick" })`).exact, false, String(bad));
  }
});

test("the search link encodes the query, and no query means no link", () => {
  const { json } = load();
  assert.equal(json(`amazonLink({ shopQuery: "Neosporin + Pain & Itch 0.5 oz" })`).href, "https://www.amazon.com/s?k=Neosporin%20%2B%20Pain%20%26%20Itch%200.5%20oz");
  for (const it of ["{}", `{ shopQuery: "  " }`, `{ shopQuery: 7 }`, "null"]) assert.equal(json(`amazonLink(${it})`), null, it);
});

test("a photo scan keeps Claude's search and saves it with the item", async () => {
  const { run, json } = load({ fixture: "tests/household" });
  const rows = json(`cleanRows([{ name: "Bite stick", category: "bites", qty: 1, shop: " Cutter BiteMD 0.5 fl oz " }, { name: "Rx bottle", category: "medications", shop: "" }, { name: "Odd", shop: {} }])`);
  assert.deepEqual(rows.map(r => r.shop), ["Cutter BiteMD 0.5 fl oz", "", ""]);
  run(`S.draft = { kitId: S.kits[0].id, rows: cleanRows([{ name: "Bite stick", category: "bites", shop: "Cutter BiteMD 0.5 fl oz" }, { name: "Rx bottle", category: "medications", shop: "" }]), photoIds: [] }`);
  await run("saveDraft()");
  const saved = json(`S.items.filter(i => i.name === "Bite stick" || i.name === "Rx bottle")`);
  assert.equal(saved.find(i => i.name === "Bite stick").shopQuery, "Cutter BiteMD 0.5 fl oz");
  assert.ok(!("shopQuery" in saved.find(i => i.name === "Rx bottle")));
});

test("the kit table links each item to Amazon and escapes what it links", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.openKit = S.kits[0].id;
    const mine = S.items.filter(i => i.kitId === S.openKit);
    mine[0].amazonUrl = "https://www.amazon.com/dp/B001CUX6N0";
    mine[1].shopQuery = '"><img src=x onerror=alert(1)>';`);
  const html = run("viewKits(model())");
  assert.ok(html.includes(`href="https://www.amazon.com/dp/B001CUX6N0"`));
  assert.match(html, /On Amazon ↗/);
  assert.match(html, /Find on Amazon ↗/);
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /rel="noopener noreferrer"/);
});
