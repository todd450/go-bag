// What it costs (issue #138): what's been spent on each kit and each emergency, and what the rest would cost.
// An item costs what was paid for it (`paid`, from a receipt), else its current price (`unitPrice` × qty, Amazon by
// default), else the shopping list's own price for the same category and amount. What's still to get is priced the way
// the shopping list prices it, so the household figure is what the plan bar shows with every gap planned.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");

const households = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];
const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = html => unesc(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
const cost = (app, it, kt = "home") => app.json(`itemCost(${JSON.stringify(it)}, ${JSON.stringify(kt)}, household())`);

test("an item costs what was paid, else its current price times its quantity, else the shopping list's price", () => {
  const app = load({ fixture: "tests/household" });
  const jugs = { kitId: "home", name: "Water jugs", category: "water", qty: 1, liters: 26 };
  assert.deepEqual(cost(app, { ...jugs, paid: 31.5, unitPrice: 25 }), { price: 31.5, src: "paid" });
  assert.deepEqual(cost(app, { ...jugs, paid: 0 }), { price: 0, src: "paid" }, "a gift was paid $0, not unknown");
  assert.deepEqual(cost(app, { ...jugs, qty: 2, unitPrice: 24.99 }), { price: 49.98, src: "price" });
  assert.deepEqual(cost(app, jugs), { price: app.run(`buyGuide("water", 26, "L", "home", household()).price`), src: "estimate" });
  assert.equal(cost(app, jugs).price, 22, "one 7-gallon container's worth, as the list prices it");
  assert.equal(cost(app, { ...jugs, paid: "" }).src, "estimate", "a cleared paid field doesn't count as $0");
  assert.equal(cost(app, { ...jugs, paid: null }).src, "estimate");
  assert.equal(cost(app, { ...jugs, paid: -4 }).src, "estimate");
});

test("the estimate follows the kit: water in a go-bag is priced as bottles, in a home bin as containers", () => {
  const app = load({ fixture: "tests/household" });
  const w = { category: "water", qty: 1, liters: 12 };
  assert.equal(cost(app, w, "go").price, 6);
  assert.equal(cost(app, w, "home").price, 22);
});

test("a named essential is priced as that essential, and prescriptions and Other are left unpriced", () => {
  const app = load({ fixture: "tests/household" });
  assert.equal(cost(app, { category: "fire_safety", essential: "escape_ladder", qty: 1 }).price, 45);
  assert.deepEqual(cost(app, { category: "medications", essential: "prescriptions", qty: 1 }), { price: null, src: "estimate" });
  assert.deepEqual(cost(app, { category: "other", qty: 3 }), { price: null, src: "estimate" });
  const s = app.json(`spentOn([{ category: "medications", essential: "prescriptions", qty: 1, kitId: "go" }, { category: "light", qty: 2, kitId: "go" }], household())`);
  assert.deepEqual(s, { total: 24, unpriced: 1, paid: 0, n: 2 }, "an unpriced item is counted as unpriced, not as $0");
});

test("example items are left out of what's been spent", () => {
  const app = load({ fixture: "tests/household" });
  const before = app.json(`spentOn(S.items, household())`).total;
  app.run(`S.items.push({ id: "x1", kitId: "go", category: "first_aid", qty: 1, paid: 500, example: true })`);
  assert.equal(app.json(`spentOn(S.items, household())`).total, before);
});

test("a kit's spend is its items'; what it still needs prices its own checklist's shortfall, and a full kit needs $0", () => {
  for (const name of households) {
    const app = load({ fixture: name });
    const kits = app.json(`(() => { const M = model(); return S.kits.map(k => ({ id: k.id, score: M.kitRes[k.id].score, c: kitCost(k, M.kitRes[k.id], M.h),
      items: spentOn(S.items.filter(i => i.kitId === k.id), M.h) })); })()`);
    for (const k of kits) {
      assert.deepEqual(k.c.spent, k.items, `${name} ${k.id}: spend is its own items'`);
      if (k.score === 100) assert.deepEqual(k.c.toGet, { total: 0, unpriced: 0 }, `${name} ${k.id}: a full kit needs nothing`);
      assert.ok(k.c.toGet.total >= 0);
    }
  }
});

test("tests/household: what the go-bag still needs is what each short line of its checklist costs at the list's prices", () => {
  const app = load({ fixture: "tests/household" });
  const got = app.json(`(() => { const M = model(), k = S.kits.find(k => k.id === "go"); return kitCost(k, M.kitRes.go, M.h).toGet; })()`);
  const want = app.json(`(() => { const M = model(), r = M.kitRes.go; let total = 0, unpriced = 0;
    for (const row of r.rows) { if (row.cov >= 1) continue;
      const ps = row.ess ? row.ess.filter(e => !e.have).map(e => essentialGuide(e.id, r.kh).price) : [buyGuide(row.cat, row.need - row.have, row.unit || "", "go", r.kh).price];
      for (const p of ps) p == null ? unpriced++ : total += p; }
    return { total, unpriced }; })()`);
  assert.deepEqual(got, want);
  assert.ok(got.total > 0);
});

test("the household's to-get is what the plan bar shows once every gap is planned, on every household", () => {
  for (const name of households) {
    const app = load({ fixture: name });
    const toGet = app.json(`householdCost(model()).toGet`);
    app.run(`S.shopping = null; ACT.shopAddAll()`);
    const left = app.json(`shopItems().filter(e => !e.done).length`);
    if (!left) { assert.equal(toGet.total, 0, name); continue; }
    const bar = text(app.run(`viewKits(model())`)).match(/planned · about \$([\d,]+)/);
    assert.equal(toGet.total, +bar[1].replace(/,/g, ""), `${name}: the plan bar's sum`);
  }
});

test("an emergency counts what's in the kits it uses and the categories it needs, and prices what it's short", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.items.find(i => i.id === "i6").paid = 60`); // jumper cables, in the car kit
  const by = app.json(`(() => { const M = model(); return Object.fromEntries(M.results.map(r => [r.hz.id, hzCost(r, M.h)])); })()`);
  assert.equal(by.stranded.spent.paid, 60, "the car kit's jumper cables count toward being stranded on the road");
  assert.equal(by.earthquake.spent.paid, 0, "but not toward an earthquake, which doesn't use the car kit or need car gear");
  const r = app.json(`(() => { const M = model(), r = M.results.find(r => r.hz.id === "earthquake"); return { cats: r.rows.map(x => x.cat), kits: kitsFor(r.hz) }; })()`);
  const want = app.json(`spentOn(itemsIn(${JSON.stringify(r.kits)}).filter(i => ${JSON.stringify(r.cats)}.includes(i.category)), household())`);
  assert.deepEqual(by.earthquake.spent, want);
  const full = app.json(`(() => { const M = model(); return M.results.filter(r => r.score === 100).map(r => hzCost(r, M.h).toGet); })()`);
  for (const t of full) assert.deepEqual(t, { total: 0, unpriced: 0 });
});

test("the overview shows the household's spend and to-get, each kit's, and each emergency that applies", () => {
  const app = load({ fixture: "tests/household" });
  const html = app.run(`viewOverview(model())`), t = text(html);
  const hh = app.json(`householdCost(model())`);
  assert.match(t, new RegExp(`\\$${hh.spent.total.toLocaleString("en-US")} spent`));
  assert.match(t, new RegExp(`\\$${hh.toGet.total.toLocaleString("en-US")} to close every gap`));
  const sec = text(html.match(/<section class="costs[^"]*"[\s\S]*?<\/section>/)?.[0] || "");
  assert.ok(sec, "a What it costs section");
  for (const k of app.json(`S.kits.map(k => k.name)`)) assert.ok(sec.includes(k), `lists ${k}`);
  const applies = app.json(`(() => { const M = model(); return M.results.filter(r => LEVELS[r.rel][1] > 0 && !(r.hz.vehicle && M.h.vehicles === 0)).map(r => r.hz.name); })()`);
  for (const n of applies) assert.ok(sec.includes(n), `lists ${n}`);
  const off = app.json(`(() => { const M = model(); return M.results.filter(r => LEVELS[r.rel][1] === 0).map(r => r.hz.name); })()`);
  for (const n of off) assert.ok(!sec.includes(n), `leaves out ${n}, which doesn't apply`);
});

test("a kit's readiness panel and an opened emergency say what's been spent and what the rest costs", () => {
  const app = load({ fixture: "tests/household" });
  const kit = app.run(`(() => { const M = model(), k = S.kits.find(k => k.id === "go"); return kitReadyPanel(k, M.kitRes.go, M); })()`);
  const kc = app.json(`(() => { const M = model(); return kitCost(S.kits.find(k => k.id === "go"), M.kitRes.go, M.h); })()`);
  assert.match(text(kit), new RegExp(`\\$${Math.round(kc.spent.total)} spent`));
  assert.match(text(kit), new RegExp(`\\$${kc.toGet.total.toLocaleString("en-US")} more to finish it`));
  const hz = app.run(`(() => { const M = model(), r = M.results.find(r => r.hz.id === "earthquake"); return hzPanel(r, M.h, M, r.rows); })()`);
  assert.match(text(hz), /spent on what it needs/);
});

test("Paid $ on an item saves dollars and cents, and clearing it goes back to the estimate", async () => {
  const app = load({ fixture: "tests/household" });
  const fields = app.json(`itemFields(S.items.find(i => i.id === "i5")).map(f => f[1])`);
  assert.ok(fields.includes("Paid $"));
  await app.fire("change", { dataset: { change: "item", id: "i5", f: "paid" }, value: "23.456" });
  assert.equal(app.json(`S.items.find(i => i.id === "i5").paid`), 23.46);
  assert.equal(cost(app, app.json(`S.items.find(i => i.id === "i5")`), "go").src, "paid");
  await app.fire("change", { dataset: { change: "item", id: "i5", f: "paid" }, value: "" });
  assert.equal(app.json(`S.items.find(i => i.id === "i5").paid ?? null`), null);
  assert.equal(cost(app, app.json(`S.items.find(i => i.id === "i5")`), "go").src, "estimate");
});
