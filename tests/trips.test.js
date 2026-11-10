// Review's open lines grouped by the trip that buys them (issue #123, part of #115): tripOf in the core gives each open
// line one trip (from home, pharmacy, Amazon, else one store run), and Review shows the groups in the order From home,
// One store run, Amazon, Pharmacy, each with its heading and count, its lines in the chosen order. With a budget, the rows
// outside the pick stay dimmed, and "Over your budget" sits after the pick summary in the tools.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");

const households = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = html => unesc(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
const rowsOf = html => [...html.matchAll(/<li class="shop-row[^"]*">[\s\S]*?<\/li>/g)].map(([r]) => r);
const idOf = row => unesc(row.match(/<input [^>]*data-id="([^"]*)"/)[1]);
// Review's trip groups, top to bottom: each heading's name and count, and its rows
const groupsOf = html => [...html.matchAll(/<h3 class="trip-hd">([\s\S]*?)<\/h3>\s*<ul class="shop">((?:(?!<\/ul>)[\s\S])*)<\/ul>/g)]
  .map(([, hd, list]) => { const t = text(hd), n = t.match(/(\d+)$/); return { name: t.replace(/\s*\d+$/, ""), n: n && Number(n[1]), rows: rowsOf(list), ids: rowsOf(list).map(idOf) }; });
const view = app => app.run("viewShop(model())");
const ORDER = ["From home", "One store run", "Amazon", "Pharmacy"];
const TRIP = { home: "From home", store: "One store run", amazon: "Amazon", pharmacy: "Pharmacy" };

test("tests/household with every gap planned: From home 4, One store run 23, Amazon 11, Pharmacy 2, in that order", () => {
  const app = load({ fixture: "tests/household" });
  app.run("ACT.shopAddAll()");
  const g = groupsOf(view(app));
  assert.deepEqual(g.map(x => x.name), ORDER);
  assert.deepEqual(g.map(x => x.n), [4, 23, 11, 2], "each heading's count");
  assert.deepEqual(g.map(x => x.ids.length), [4, 23, 11, 2], "each group's rows");
  const keys = ids => app.json(`${JSON.stringify(ids)}.map(id => { const e = shopItems().find(e => e.id === id); return e.essential || e.cat; })`).sort();
  assert.deepEqual(keys(g[0].ids), ["clothing", "contact_list", "id_copies", "insurance"]);
  assert.deepEqual(keys(g[2].ids), ["co_alarm", "escape_ladder", "extinguisher", "fire_blanket", "first_aid", "light", "masks", "radio", "shelter", "water", "whistle"]);
  assert.deepEqual(keys(g[3].ids), ["allergy", "prescriptions"]);
});

test("tripOf: price 0 is from home, no price the pharmacy, a PICKS product Amazon, everything else one store run", () => {
  const app = load({ fixture: "tests/household" });
  app.run("ACT.shopAddAll()");
  const seen = app.json(`(() => { const M = model(); return shopItems().map(e => { const i = shopInfo(e, M);
    return [tripOf(e, M), i.price === 0 ? "home" : i.price === null ? "pharmacy" : PICKS[i.pick]?.url ? "amazon" : "store"]; }); })()`);
  for (const [got, want] of seen) assert.equal(got, want);
  // A typed line has no category and no price: one store run
  assert.equal(app.run(`tripOf({ id: "t", cat: "", text: "Spare reading glasses", done: false }, model())`), "store");
  assert.equal(app.run(`tripOf({ id: "o", cat: "retired-category", text: "Old entry", done: false }, model())`), "store");
});

test("on every household, with every gap planned and a typed line, each open line is in exactly one group, in the chosen order", () => {
  for (const name of households) for (const sort of ["points", "value", "added"]) {
    const app = load({ fixture: name }), at = `${name}, ${sort}`;
    app.run(`S.shopping = null; ACT.shopAddAll(); S.shopping = { items: [...shopItems(), { id: "typed", cat: "", text: "Spare reading glasses", done: false, at: 1 }] }; S.shopSort = ${JSON.stringify(sort)}`);
    const g = groupsOf(view(app));
    const want = app.json(`(() => { const M = model(), P = shopPlan(M, shopItems().filter(e => !e.done));
      return P.order.map(e => [e.id, tripOf(e, M)]); })()`);
    const all = g.flatMap(x => x.ids);
    assert.deepEqual(all.slice().sort(), want.map(([id]) => id).sort(), `${at}: every open line, once`);
    assert.equal(new Set(all).size, all.length, `${at}: no line twice`);
    assert.deepEqual(g.map(x => x.name), ORDER.filter(n => want.some(([, t]) => TRIP[t] === n)), `${at}: groups in order, none empty`);
    for (const x of g) {
      assert.equal(x.n, x.ids.length, `${at}: ${x.name}'s count`);
      assert.deepEqual(x.ids, want.filter(([, t]) => TRIP[t] === x.name).map(([id]) => id), `${at}: ${x.name} holds its lines in the chosen order`);
    }
    assert.ok(g.find(x => x.name === "One store run")?.ids.includes("typed"), `${at}: the typed line is a store run's`);
  }
});

test("Amazon rows each keep one amazon.com/dp/ link, and nothing adds several items to a cart", () => {
  for (const name of households) {
    const app = load({ fixture: name });
    app.run("ACT.shopAddAll()");
    const html = view(app), amazon = groupsOf(html).find(x => x.name === "Amazon");
    if (name === "tests/household") assert.equal(amazon?.rows.length, 11, "the Amazon group is there");
    for (const row of amazon?.rows || []) assert.equal((row.match(/href="https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}"/g) || []).length, 1, `${name}: ${idOf(row)}`);
    assert.doesNotMatch(html, /cart|ASIN\.\d|Quantity\.\d/i, `${name}: no cart link`);
  }
});

test("with Spend up to $60, the dimmed rows are main's, and 'Over your budget' follows the pick summary in the tools", () => {
  const app = load({ fixture: "tests/household" });
  app.run("ACT.shopAddAll(); S.budget = 60");
  const html = view(app);
  // main's pick: the best points per dollar first, while the budget lasts
  const out = app.json(`(() => { const M = model(), left = shopItems().filter(e => !e.done), I = new Map(left.map(e => [e.id, shopInfo(e, M)]));
    const ratio = e => { const i = I.get(e.id); return i.price == null ? -1 : i.price === 0 ? (i.gain ? 1e6 + i.gain : 0) : i.gain / i.price; };
    const pick = new Set(); let spent = 0;
    for (const e of [...left].sort((a, b) => ratio(b) - ratio(a))) { const pr = I.get(e.id).price; if (pr != null && I.get(e.id).gain > 0 && spent + pr <= 60) { pick.add(e.id); spent += pr; } }
    return { out: left.filter(e => !pick.has(e.id)).map(e => e.id).sort(), n: pick.size, spent }; })()`);
  assert.ok(out.n > 0 && out.out.length > 0);
  const rows = groupsOf(html).flatMap(x => x.rows);
  assert.deepEqual(rows.filter(r => / over"/.test(r.match(/^<li [^>]*>/)[0])).map(idOf).sort(), out.out);
  const tools = text(html.match(/<div class="shop-tools">[\s\S]*?<\/div>/)[0]);
  assert.match(tools, new RegExp(`\\$${out.spent} buys ${out.n} items?[\\s\\S]*Over your budget`), "after the pick summary");
  assert.equal((html.match(/Over your budget/g) || []).length, 1, "once");
  assert.doesNotMatch(html, /class="shop-cut/, "no longer inside the list");
  // Without a budget, nothing says it
  app.run("S.budget = 0");
  assert.doesNotMatch(view(app), /Over your budget/);
});

test("Share list's text is #121's for the same lines", async () => {
  const app = load({ fixture: "tests/household" });
  app.run(`ACT.shopAddAll(); S.shopping.items.push({ id: "typed", cat: "", text: "Spare reading glasses", done: false, at: 1 });
    globalThis.SHARED = []; navigator.share = d => { SHARED.push(d); return Promise.resolve(); }`);
  await app.run(`ACT.shopShare({ dataset: {} })`);
  const want = app.run(`"Emergency kit shopping list\\n" + shopItems().filter(x => !x.done).map(x => { const i = shopInfo(x, model()); return "- " + i.line + (i.sub && i.sub !== i.line ? " (" + i.sub + ")" : ""); }).join("\\n")`);
  assert.equal(app.json("SHARED")[0].text, want);
});

// At 390px, Review with every gap planned never scrolls sideways
const PHONE = ["tests/household", ...households.filter(h => /^fixtures\/(phone-width|empty-and-one)\//.test(h))];
test("at 390px Review's trip groups never scroll sideways, with every gap planned", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const seen = new Map();
  for (let i = 0; i < PHONE.length; i += 2) for (const [f, r] of atPhoneWidth(PHONE.slice(i, i + 2), () => {
    const M = model();
    S.shopping = { items: M.gaps.map(g => shopFromGap(g, M.h)) };
    S.view = "kits"; S.allKits = true; render();
    const w = innerWidth, bg = document.querySelector(".review-bg"), sheet = document.querySelector(".review-sheet");
    return { width: w, groups: sheet ? sheet.querySelectorAll(".trip-hd").length : -1, scroll: document.documentElement.scrollWidth,
      wide: [bg, sheet].map(e => e ? e.scrollWidth - e.clientWidth : 0),
      out: [...(sheet?.querySelectorAll("*") || [])].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.left < -0.5 || r.right > w + 0.5); }).map(e => e.tagName + "." + e.getAttribute("class")) };
  })) seen.set(f, r);
  assert.equal(seen.size, PHONE.length);
  for (const [f, v] of seen) {
    assert.equal(v.width, 390, f);
    assert.ok(v.groups > 0, `${f}: the sheet rendered its trip groups`);
    assert.ok(v.scroll <= v.width && v.wide.every(n => n <= 0), `${f}: scrolls sideways (page ${v.scroll}px, ${v.wide}px too wide)`);
    assert.deepEqual(v.out, [], `${f}: these stick out of the screen`);
  }
});
