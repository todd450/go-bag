const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");

// Shopping lines name a checked Amazon product from the curated PICKS table (issue #97, decided on #94):
// its quantity and an "On Amazon" link to its page. Links come only from PICKS, never from a line's text,
// so no household data reaches Amazon.

const DP = /^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}$/;
const MEMBERS = ["Alex", "Sam", "Jordan", "Riley", "Casey"];
const FIXTURES = ["tests/household", "fixtures/data-and-account-shapes/essential-tags", "fixtures/data-and-account-shapes/odd-values",
  "fixtures/empty-and-one/big-household", "fixtures/empty-and-one/new-household", "fixtures/empty-and-one/one-person", "fixtures/phone-width/long-essentials"];
const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const amazonHrefs = html => [...html.matchAll(/href="([^"]*amazon[^"]*)"/gi)].map(m => unesc(m[1]));
// One row of the rendered list: from its <li> to the next, found by the checkbox's id.
function rowOf(html, id) {
  const at = html.indexOf(`id="shop-${id}"`);
  assert.ok(at >= 0, `row ${id} is on the list`);
  const start = html.lastIndexOf('<li class="shop-row', at), end = html.indexOf("</li>", at);
  return html.slice(start, end);
}

// The household with every gap on the list (what "Add all" does), plus a go-bag water line and a home
// shelter line, which this household's own gaps don't include.
function household() {
  const app = load({ fixture: "tests/household" });
  app.run("ACT.shopAddAll()");
  app.run(`S.shopping.items.push(
    { id: "gowater", cat: "water", qty: 30, unit: "L", text: "Drinking water: 30 L", kits: ["go"], kitId: "go", done: false },
    { id: "homeshelter", cat: "shelter", qty: 2, unit: "", text: "Shelter × 2", kits: ["home"], kitId: "home", done: false },
    { id: "oldfire", cat: "fire_safety", qty: 1, unit: "", text: "Fire safety × 1", kits: ["home"], kitId: "home", done: false })`);
  return app;
}
const idOf = (run, where) => run(`shopItems().find(e => ${where})?.id`);

test("every pick is a plain amazon.com product page and every search a fixed phrase, with no tag", () => {
  const { json } = load();
  const picks = json("PICKS");
  const keys = Object.keys(picks);
  const products = ["water_home", "water_go", "food_go", "extinguisher", "radio", "masks", "blanket_go", "light", "first_aid", "co_alarm",
    "fire_blanket", "escape_ladder", "whistle", "multitool", "duct_tape", "shutoff_wrench"];
  for (const k of products) assert.ok(picks[k]?.url, `${k} is a product pick`);
  assert.ok(picks.food_home?.q, "the mixed food line is a search");
  assert.equal(picks.water_go.heavy, true, "a case of water is heavy to ship");
  for (const k of keys) {
    const p = picks[k], text = JSON.stringify(p);
    assert.doesNotMatch(text, /tag=|\?|&/, `${k} holds no tag, query string or extra parameter`);
    if ("url" in p) {
      assert.match(p.url, DP, `${k} links to a product page`);
      assert.ok(typeof p.name === "string" && p.name.trim(), `${k} names its product`);
      assert.deepEqual(json(`amazonLink({ amazonUrl: PICKS[${JSON.stringify(k)}].url })`), { href: p.url, exact: true }, `${k} counts as an exact link`);
      assert.deepEqual(Object.keys(p).filter(f => !["name", "url", "heavy"].includes(f)), [], `${k} has only name, url and heavy`);
    } else {
      assert.ok(typeof p.q === "string" && p.q.trim(), `${k} is a non-empty search`);
      assert.deepEqual(Object.keys(p), ["q"], `${k} is a search and nothing else`);
    }
  }
  assert.equal(new Set(products.map(k => picks[k].url)).size, products.length, "no two keys share a product");
});

test("every pick a line names is in PICKS, a product's quantity is a whole number, and line, price and tip keep their shape", () => {
  for (const fx of FIXTURES) {
    const { json } = load({ fixture: fx });
    const bad = json(`(() => { const h = household(), bad = [];
      for (const cat of [...Object.keys(CATS), "nope"]) for (const kt of ["go", "home", "car"])
        for (const q of [0, 0.4, 1, 2, 5, 10, 11, 12.5, 26.5, 100, 3600, 53800, "", "x", null])
          for (const ess of [undefined, "", "none", ...essentialList(cat).map(e => e.id)]) {
            const b = buyGuide(cat, q, "", kt, h, ess), at = [cat, kt, q, ess].join("/");
            const extra = Object.keys(b).filter(k => !["line", "price", "tip", "pick", "qty"].includes(k));
            if (extra.length) bad.push(at + " has " + extra);
            if ("pick" in b && !Object.hasOwn(PICKS, b.pick)) bad.push(at + " names " + b.pick);
            const product = !!PICKS[b.pick]?.url;
            if (product !== "qty" in b) bad.push(at + (product ? " has a product but no qty" : " has a qty but no product"));
            if ("qty" in b && !(Number.isInteger(b.qty) && b.qty >= 1)) bad.push(at + " qty " + b.qty);
          }
      return bad; })()`);
    assert.deepEqual(bad, [], fx);
  }
});

test("a product's quantity is the count its bold line names", () => {
  const { json } = load({ fixture: "tests/household" });
  const lines = json(`(() => { const h = household(), out = [];
    for (const q of [1, 12, 13, 26.5, 27, 60, 125, 400]) out.push(["water_home", buyGuide("water", q, "L", "home", h)], ["water_go", buyGuide("water", q, "L", "go", h)], ["water_go", buyGuide("water", q, "L", "car", h)]);
    for (const n of [1, 3, 10, 11, 25]) out.push(["masks", buyGuide("masks", n, "", "home", h)], ["light", buyGuide("light", n, "", "go", h)]);
    return out; })()`);
  for (const [pick, b] of lines) {
    assert.equal(b.pick, pick, b.line);
    assert.equal(b.qty, Number(b.line.match(/\d+/)[0]), `qty ${b.qty} is the count in "${b.line}"`);
  }
});

test("lines with nothing to buy online say why and link nowhere", () => {
  const { run, json } = household();
  const html = run("viewShop(model())");
  const rows = {
    allergy: [`e.cat === "allergy"`, /Prescription/i],
    prescriptions: [`e.essential === "prescriptions"`, /Prescription/i],
    clothing: [`e.cat === "clothing"`, /From home/i],
    "home shelter": [`e.id === "homeshelter"`, /From home/i],
    "ID copies": [`e.essential === "id_copies"`, /From home/i],
    trauma: [`e.cat === "trauma"`, /medical supplier/i],
  };
  for (const [name, [where, reason]] of Object.entries(rows)) {
    const id = idOf(run, where);
    assert.ok(id, `the list has a ${name} line`);
    assert.equal(json(`shopInfo(shopItems().find(e => e.id === "${id}"), model()).pick ?? null`), null, `${name} has no pick`);
    const row = rowOf(html, id);
    assert.deepEqual(amazonHrefs(row), [], `${name} links nowhere`);
    assert.match(row, reason, `${name} says why`);
  }
});

test("the mixed food line searches a fixed phrase, and no Amazon link carries a member's name", () => {
  for (const fx of FIXTURES) {
    const { run, json } = load({ fixture: fx });
    run("ACT.shopAddAll()");
    const html = run("viewShop(model())");
    const allowed = json(`Object.values(PICKS).map(p => p.url || "https://www.amazon.com/s?k=" + encodeURIComponent(p.q))`);
    for (const href of amazonHrefs(html)) assert.ok(allowed.includes(href), `${fx}: ${href} comes from PICKS`);
  }
  const { run, json } = household();
  const html = run("viewShop(model())");
  const food = rowOf(html, idOf(run, `e.cat === "food"`));
  assert.deepEqual(amazonHrefs(food), [json(`"https://www.amazon.com/s?k=" + encodeURIComponent(PICKS.food_home.q)`)]);
  assert.match(food, /Mixed groceries/i);
  const hrefs = amazonHrefs(html);
  assert.ok(hrefs.length > 5, "the list has Amazon links");
  for (const href of hrefs) for (const name of MEMBERS) assert.ok(!href.toLowerCase().includes(name.toLowerCase()), `${href} holds ${name}`);
});

test("a picked line names its product and quantity and links to exactly its page in a new tab", () => {
  const { run, json } = household();
  const html = run("viewShop(model())");
  const picks = json("PICKS");
  const lines = json(`shopItems().filter(e => !e.done).map(e => ({ id: e.id, ...shopInfo(e, model()) })).filter(i => PICKS[i.pick]?.url)`);
  for (const k of ["water_home", "water_go", "light", "masks", "first_aid", "co_alarm", "blanket_go", "extinguisher", "radio", "whistle", "fire_blanket", "escape_ladder"])
    assert.ok(lines.some(i => i.pick === k), `the household's list has a ${k} line`);
  for (const i of lines) {
    const row = rowOf(html, i.id), p = picks[i.pick];
    const a = row.match(/<a [^>]*href="https:\/\/www\.amazon\.com[^>]*>[^<]*<\/a>/g);
    assert.equal(a?.length, 1, `${i.pick}: one Amazon link`);
    assert.equal(unesc(a[0].match(/href="([^"]*)"/)[1]), p.url, `${i.pick}: the link is the pick's page`);
    assert.match(a[0], /target="_blank"/);
    assert.match(a[0], /rel="noopener noreferrer"/);
    assert.match(a[0], /On Amazon/);
    assert.ok(unesc(row).includes(p.name), `${i.pick}: names ${p.name}`);
    assert.match(row, new RegExp(`Qty ${i.qty}\\b`), `${i.pick}: shows Qty ${i.qty}`);
    assert.equal(/Heavy to ship/.test(row), !!p.heavy, `${i.pick}: heavy note only on a heavy pick`);
  }
  const water = rowOf(html, "gowater");
  assert.match(water, /<[^>]*style="color:var\(--warn\)"[^>]*>[^<]*Heavy to ship/, "the go-bag water line warns it is heavy to ship");
  // The old category lines for fire safety and comms map to the same products as their essentials.
  assert.equal(json(`shopInfo(shopItems().find(e => e.id === "oldfire"), model()).pick`), "extinguisher");
  assert.equal(json(`buyGuide("communication", 1, "", "home", household()).pick`), "radio");
});

test("the note above the list shows only while a line still to buy has a product", async () => {
  const note = /tracking tag/i;
  const { run } = household();
  assert.match(run("viewShop(model())"), note);
  // Only lines with no product left to buy: the note goes.
  run(`S.shopping.items = S.shopping.items.filter(e => !PICKS[shopInfo(e, model()).pick]?.url)`);
  assert.ok(run("shopItems().length") > 0, "lines are left");
  assert.doesNotMatch(run("viewShop(model())"), note);
  // Every product line ticked: the note goes too.
  const b = household();
  for (const id of b.json(`shopItems().filter(e => PICKS[shopInfo(e, model()).pick]?.url).map(e => e.id)`)) await b.run(`shopTick("${id}", true)`);
  assert.doesNotMatch(b.run("viewShop(model())"), note);
});

test("ticking a picked line adds exactly its points, makes an item with no amazonUrl, and hides the pick", async () => {
  const { run, json } = household();
  const id = run(`shopItems().find(e => PICKS[shopInfo(e, model()).pick]?.url && shopKit(e) && shopInfo(e, model()).gain > 0).id`);
  const before = run("model().overall"), gain = run(`shopInfo(shopItems().find(e => e.id === "${id}"), model()).gain`);
  await run(`shopTick("${id}", true)`);
  assert.equal(run("model().overall"), before + gain);
  const item = json(`S.items.find(i => i.id === shopItems().find(e => e.id === "${id}").itemId)`);
  assert.ok(item, "the tick made a kit item");
  assert.equal("amazonUrl" in item, false, "the new item has no amazonUrl (D4)");
  const row = rowOf(run("viewShop(model())"), id);
  assert.deepEqual(amazonHrefs(row), [], "a ticked line shows no link");
  assert.doesNotMatch(row, /Qty \d/, "a ticked line shows no pick");
});

test("at 390px the pick line sits under the tip and its link is at least 40px tall", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const seen = atPhoneWidth(["tests/household"], () => {
    const M = model();
    S.shopping = { items: M.gaps.map(g => shopFromGap(g, M.h)) };
    S.view = "kits"; render(); ACT.allKits();
    return { width: innerWidth, scroll: document.documentElement.scrollWidth,
      rows: [...document.querySelectorAll(".shop-row")].filter(r => r.querySelector(".shop-chk a.buy")).map(r => {
        const a = r.querySelector(".shop-chk a.buy").getBoundingClientRect(), tip = r.querySelector(".shop-tip")?.getBoundingClientRect();
        return { link: a.height, under: !tip || a.top >= tip.bottom - 1, inside: a.right <= innerWidth };
      }) };
  }).get("tests/household");
  assert.equal(seen.width, 390);
  assert.ok(seen.rows.length >= 5, "rows with links are on the list");
  assert.ok(seen.scroll <= seen.width, `the list scrolls sideways (${seen.scroll}px)`);
  for (const r of seen.rows) {
    assert.ok(r.link >= 40, `a link is ${r.link}px tall`);
    assert.ok(r.under, "the pick line sits under the tip");
    assert.ok(r.inside, "the link is on screen");
  }
});
