const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");

// Documents & cash, Fire safety, Comms, Tools and Medications score by which named essentials are in
// the kit (ESSENTIALS): one of each counts, a second copy adds nothing, untagged items count nothing
// until they are tagged, and each missing essential is its own gap and shopping line.
const FIVE = ["documents", "fire_safety", "communication", "tools", "medications"];
const scenarios = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

// The standard household with the screenshot case in its go-bag: a cash envelope and four pain relievers.
function screenshotCase() {
  const app = load({ fixture: "tests/household" });
  app.run(`S.items.push(
    { id: "e1", kitId: "go", name: "Cash envelope", category: "documents", qty: 1, essential: "cash" },
    ...[1, 2, 3, 4].map(n => ({ id: "p" + n, kitId: "go", name: "Pain reliever " + n, category: "medications", qty: 1, essential: "pain_reliever" })));`);
  return app;
}
const row = (json, hz, cat) => json(`model().results.find(r => r.hz.id === ${JSON.stringify(hz)}).rows.find(x => x.cat === ${JSON.stringify(cat)})`);

test("the screenshot case reads 1 of 4 for documents and 1 of 3 for medications in a house fire", () => {
  const { run, json } = screenshotCase();
  assert.ok(json(`model().active.some(r => r.hz.id === "housefire")`), "house fire is active");
  const docs = row(json, "housefire", "documents"), meds = row(json, "housefire", "medications");
  assert.deepEqual([docs.have, docs.need], [1, 4]);
  assert.equal(run(`amount(model().results.find(r => r.hz.id === "housefire").rows.find(x => x.cat === "documents"), household())`), "1 of 4");
  assert.deepEqual([meds.have, meds.need], [1, 3]);
  assert.equal(run(`amount(model().results.find(r => r.hz.id === "housefire").rows.find(x => x.cat === "medications"), household())`), "1 of 3");
});

test("no row for the five categories ever has more than it needs, in any scenario, emergency or kit", () => {
  const apps = [...scenarios.map(name => [name, load({ fixture: name })]), ["screenshot case", screenshotCase()]];
  for (const [name, { json }] of apps) {
    const rows = json(`(() => { const M = model(); return [...M.results.flatMap(r => r.rows), ...Object.values(M.kitRes).flatMap(r => r.rows)]
      .filter(x => ${JSON.stringify(FIVE)}.includes(x.cat)).map(x => [x.cat, x.have, x.need]); })()`);
    assert.ok(rows.length > 0, name);
    for (const [cat, have, need] of rows) assert.ok(have <= need && need > 0, `${name}: ${cat} ${have} of ${need}`);
  }
});

// Every score the page shows: the household's, each emergency's and each kit's.
const scores = json => json(`(() => { const M = model(); return { overall: M.overall, results: Object.fromEntries(M.results.map(r => [r.hz.id, r.score])), kits: Object.fromEntries(Object.entries(M.kitRes).map(([k, r]) => [k, r.score])) }; })()`);
// The go-bag counts for a house fire, so an essential added there shows in both.
const raised = (a, b) => b.results.housefire > a.results.housefire && b.kits.go > a.kits.go && b.overall >= a.overall;

test("a second copy of an essential adds nothing", () => {
  const { run, json } = screenshotCase();
  const before = scores(json);
  run(`S.items.push({ id: "e2", kitId: "go", name: "More cash", category: "documents", qty: 3, essential: "cash" })`);
  assert.deepEqual(scores(json), before);
});

test("an untagged item counts nothing until it is tagged", () => {
  const { run, json } = screenshotCase();
  const before = scores(json);
  run(`S.items.push({ id: "u1", kitId: "go", name: "Insurance card copies", category: "documents", qty: 1 })`);
  assert.deepEqual(scores(json), before, "untagged");
  run(`S.items.find(i => i.id === "u1").essential = "none"`);
  assert.deepEqual(scores(json), before, "not one of the essentials");
  run(`S.items.find(i => i.id === "u1").essential = "insurance"`);
  assert.ok(raised(before, scores(json)), "tagged");
});

test("each prescriptions item fills one slot, up to one per person on daily medication", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.items.push(
    { id: "rx1", kitId: "go", name: "Sam's pills", category: "medications", qty: 2, essential: "prescriptions" },
    { id: "rx2", kitId: "go", name: "More of Sam's pills", category: "medications", qty: 1, essential: "prescriptions" })`);
  const meds = () => { const r = row(json, "meds", "medications"); return [r.have, r.need]; };
  // Pain reliever, allergy medicine and Sam's prescriptions: only the prescriptions are in, once.
  assert.deepEqual(meds(), [1, 3]);
  run(`S.profile.members[0].conditions = ["diabetes"]`);
  assert.deepEqual(meds(), [2, 4], "two people on daily medication");
  run(`S.items.find(i => i.id === "rx2").expires = "2020-01"`);
  assert.deepEqual(meds(), [1, 4], "an expired one fills nothing");
});

test("an expired tagged item counts nothing", () => {
  const { run, json } = screenshotCase();
  const before = scores(json);
  run(`S.items.push({ id: "x1", kitId: "go", name: "Old insurance cards", category: "documents", qty: 1, essential: "insurance", expires: "2020-01" })`);
  assert.deepEqual(scores(json), before);
  run(`S.items.find(i => i.id === "x1").expires = "2999-01"`);
  assert.ok(raised(before, scores(json)));
});

test("a need set by an emergency's quantity no longer applies to the five categories", () => {
  const { json } = load({ fixture: "tests/household" });
  const needs = json(`(() => { const M = model(), h = M.h; return [...M.results.flatMap(r => r.rows), ...Object.values(M.kitRes).flatMap(r => r.rows)]
    .filter(x => ${JSON.stringify(FIVE)}.includes(x.cat)).map(x => [x.cat, x.need, essentialsFor(x.cat, h).length]); })()`);
  for (const [cat, need, n] of needs) assert.equal(need, n, cat);
});

test("each missing essential is its own gap, named, with the category kept", () => {
  const { json } = screenshotCase();
  const gaps = json(`model().gaps.filter(g => ${JSON.stringify(FIVE)}.includes(g.cat)).map(g => [g.cat, g.essential])`);
  const docs = gaps.filter(([c]) => c === "documents").map(([, e]) => e).sort();
  assert.deepEqual(docs, ["id_copies", "insurance", "records"]);
  assert.ok(gaps.every(([, e]) => typeof e === "string" && e), "every gap in the five names its essential");
  assert.ok(!gaps.some(([c, e]) => c === "documents" && e === "cash"), "cash is in the go-bag");
  const plan = json(`(() => { const M = model(), g = M.gaps.find(g => g.essential === "insurance"); return { p: gapPlan(g, M.h), e: shopFromGap(g, M.h) }; })()`);
  assert.match(plan.p.title, /Insurance cards/);
  assert.equal(plan.e.cat, "documents");
  assert.equal(plan.e.essential, "insurance");
  assert.equal(plan.e.name, "Insurance cards");
  assert.equal(plan.e.qty, 1);
});

test("two people on daily medication get two prescriptions gaps, and two lines cover them", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.profile.members[0].conditions = ["meds"]`);
  const rx = () => json(`splitListed(model().gaps).off.filter(g => g.essential === "prescriptions").length`);
  assert.equal(rx(), 2);
  run(`ACT.shopAdd({ dataset: { cat: "medications", essential: "prescriptions" } })`);
  assert.equal(rx(), 1);
  run(`ACT.shopAdd({ dataset: { cat: "medications", essential: "prescriptions" } })`);
  assert.equal(rx(), 0);
  assert.equal(json(`shopItems().filter(e => e.essential === "prescriptions").length`), 2);
});

for (const name of [...scenarios, "screenshot case"]) {
  test(`${name}: every gap's next-step points are its shopping line's points`, () => {
    const { json } = name === "screenshot case" ? screenshotCase() : load({ fixture: name });
    const off = json(`(() => { const M = model(); if (M.overall == null) return [];
      return M.gaps.map(g => [g.cat, g.essential, scoreIfFilled(M, [g]) - M.overall, shopInfo(shopFromGap(g, M.h), M).gain]).filter(([, , a, b]) => a !== b); })()`);
    assert.deepEqual(off, []);
  });
}

test("ticking each named line in turn adds the points it showed and makes an item tagged with its essential", async () => {
  const { run, json } = screenshotCase();
  run("ACT.shopAddAll()");
  const ids = json(`shopItems().filter(e => e.essential).map(e => e.id)`);
  assert.ok(ids.length >= 8, `named lines: ${ids.length}`);
  for (const id of ids) {
    const before = run("model().overall");
    const gain = run(`shopInfo(shopItems().find(e => e.id === ${JSON.stringify(id)}), model()).gain`);
    const ess = run(`shopItems().find(e => e.id === ${JSON.stringify(id)}).essential`);
    await run(`shopTick(${JSON.stringify(id)}, true)`);
    assert.equal(run("model().overall"), before + gain, ess);
    const item = json(`S.items.find(i => i.id === shopItems().find(e => e.id === ${JSON.stringify(id)}).itemId)`);
    assert.equal(item.essential, ess);
    assert.equal(json(`essentialOf(${JSON.stringify(item)})`), ess);
  }
});

test("with no kit of the right type, one missing essential is worth less than the whole category's list", () => {
  const { run, json } = screenshotCase();
  run(`S.items = S.items.filter(i => i.kitId === "car"); S.kits = S.kits.filter(k => k.type === "car")`);
  const [one, all, now] = json(`(() => { const M = model(), h = M.h;
    const line = id => ({ cat: "documents", essential: id, kits: ["go"] });
    return [overallIf(M, [line("insurance")]), overallIf(M, essentialsFor("documents", h).map(e => line(e.id))), M.overall]; })()`);
  assert.ok(now < one && one < all, `${now} < ${one} < ${all}`);
  const g = json(`(() => { const M = model(), g = M.gaps.find(g => g.essential === "insurance"); return [scoreIfFilled(M, [g]), overallIf(M, [shopFromGap(g, M.h)])]; })()`);
  assert.equal(g[0], g[1], "an unplaced line is estimated with overallIf");
  assert.equal(g[0], one);
});

test("each kit's item points still add up to its score, with copies of one essential sharing its points", () => {
  for (const app of [screenshotCase(), load({ fixture: "fixtures/data-and-account-shapes/essential-tags" })]) {
    const { json } = app;
    for (const id of json("S.kits.map(k => k.id)")) {
      const [sum, score, pts] = json(`(() => { const M = model(), k = S.kits.find(k => k.id === ${JSON.stringify(id)}), v = itemValues(k, M.kitRes[k.id]);
        return [Object.values(v).reduce((a, x) => a + x.pts, 0), M.kitRes[k.id].score, v]; })()`);
      assert.ok(Math.abs(sum - score) <= 1, `${id}: items ${sum} vs kit ${score}`);
      if (id === "go" && pts.p1) {
        const p = [1, 2, 3, 4].map(n => pts["p" + n].pts);
        assert.ok(p.every(x => Math.abs(x - p[0]) < 1e-9 && x > 0), "the four pain relievers share one essential's points");
        const r = json(`model().kitRes.go`), W = r.rows.reduce((a, x) => a + x.w, 0), meds = r.rows.find(x => x.cat === "medications");
        assert.ok(Math.abs(4 * p[0] - 100 * meds.w / meds.need / W) < 1e-9, "and together they are worth one essential");
      }
    }
  }
});

test("an untagged item in the five categories says to pick its essential", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.items.push({ id: "u1", kitId: "go", name: "Folder of papers", category: "documents", qty: 1 })`);
  const v = json(`(() => { const M = model(), k = S.kits.find(k => k.id === "go"); return itemValues(k, M.kitRes.go).u1; })()`);
  assert.equal(v.pts, 0);
  assert.match(v.note, /essential/i);
});

test("an old shopping line with no essential shows its true points, makes an untagged item, and leaves the essentials to add", async () => {
  const { run, json } = screenshotCase();
  run(`S.shopping = { items: [{ id: "old", cat: "documents", qty: 1, unit: "", name: "Documents & cash", text: "Documents & cash × 1", kits: ["go", "car"], kitId: "", done: false, at: 1 }] }`);
  run(`S.view = "shop"; render()`);
  assert.doesNotThrow(() => run("viewShop(model())"));
  assert.equal(run(`shopInfo(shopItems()[0], model()).gain`), 0);
  const docs = json(`splitListed(model().gaps).off.filter(g => g.cat === "documents").map(g => g.essential).sort()`);
  assert.deepEqual(docs, ["id_copies", "insurance", "records"]);
  assert.ok(json(`nextActions(model()).acts.every(a => a.kind !== "shop")`), "the old line folds no gap into a list step");
  const before = run("model().overall");
  await run(`shopTick("old", true)`);
  assert.equal(run("model().overall"), before);
  const item = json(`S.items.find(i => i.id === shopItems()[0].itemId)`);
  assert.equal(item.category, "documents");
  assert.equal(json(`essentialOf(${JSON.stringify(item)})`), "");
});

test("the next-step button for a missing essential carries its category and essential", async () => {
  const { run, json } = screenshotCase();
  const btn = run(`actBtn({ kind: "gap", g: model().gaps.find(g => g.essential === "insurance") }, 0)`);
  assert.match(btn, /data-act="shopAdd" data-cat="documents" data-essential="insurance"/);
  run(`ACT.shopAdd({ dataset: { cat: "documents", essential: "insurance" } })`);
  assert.deepEqual(json(`shopItems().map(e => [e.cat, e.essential])`), [["documents", "insurance"]]);
  assert.ok(!json(`splitListed(model().gaps).off.some(g => g.essential === "insurance")`), "the listed essential is no longer an open gap");
  // A category alone still adds a counted category's gap, and never one of the five.
  run(`ACT.shopAdd({ dataset: { cat: "documents" } })`);
  assert.equal(json(`shopItems().length`), 1);
  const counted = json(`model().gaps.find(g => !g.essential).cat`);
  run(`ACT.shopAdd({ dataset: { cat: ${JSON.stringify(counted)} } })`);
  assert.deepEqual(json(`shopItems().at(-1).cat`), counted);
});

test("the best pack scores what kitReadiness gives on its items, with tagged essentials and copies", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.kits.find(k => k.id === "go").carryKg = 4; S.items.push(
    { id: "w1", kitId: "go", name: "Water bottles", category: "water", qty: 12, liters: 6 },
    { id: "d1", kitId: "go", name: "Cash", category: "documents", qty: 1, essential: "cash", grams: 50, ml: 50 },
    { id: "d2", kitId: "go", name: "More cash", category: "documents", qty: 1, essential: "cash", grams: 50, ml: 50 },
    { id: "d3", kitId: "go", name: "ID copies", category: "documents", qty: 1, essential: "id_copies", grams: 50, ml: 50 },
    { id: "r1", kitId: "go", name: "Radio", category: "communication", qty: 1, essential: "radio", grams: 600, ml: 900 },
    { id: "t1", kitId: "go", name: "Knife", category: "tools", qty: 2, essential: "multitool", grams: 400, ml: 300 },
    { id: "u1", kitId: "go", name: "Folder", category: "documents", qty: 1 });`);
  const out = json(`(() => { const M = model(), kit = S.kits.find(k => k.id === "go"), r = M.kitRes.go, P = packPlan(kit, r, kitLimits(kit, r.h));
    return { fits: P.fits, best: P.best && { score: P.best.score, real: kitReadiness(kit, r.h, r.drivers, P.best.items).score, leave: P.best.leave.map(x => x.it.id) },
      takeOut: P.takeOut.map(x => x.it.id) }; })()`);
  assert.equal(out.fits, false);
  assert.equal(out.best.score, out.best.real);
  assert.ok(!out.best.leave.includes("u1"), "an untagged item goes in while there is room");
  assert.ok(!out.takeOut.includes("u1"), "and isn't offered to take out");
  assert.ok(out.takeOut.includes("d1") || out.takeOut.includes("d2"), "a second copy of cash is spare");
});

test("a tagged tools item swapped for the lighter multi-tool keeps its tag and its points", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.items.push({ id: "t1", kitId: "go", name: "Hatchet", category: "tools", qty: 1, essential: "multitool", grams: 900, ml: 900 })`);
  const PLAN = `(() => { const M = model(), kit = S.kits.find(k => k.id === "go"), r = M.kitRes.go; return packPlan(kit, r, kitLimits(kit, r.h)); })()`;
  const swap = json(`${PLAN}.swaps.find(x => x.it.id === "t1")`);
  assert.ok(swap, "the multi-tool is offered");
  const before = json("model().kitRes.go.score");
  run(`Object.assign(S.items.find(i => i.id === "t1"), { name: ${JSON.stringify(swap.to)}, grams: PACK.tools.lite.g, ml: PACK.tools.lite.ml })`);
  assert.equal(json(`essentialOf(S.items.find(i => i.id === "t1"))`), "multitool");
  assert.equal(json("model().kitRes.go.score"), before);
});

// The go-bag's best pack, with what it keeps and what one more unit of each left-out item would weigh.
const GO_PACK = `(() => { const M = model(), kit = S.kits.find(k => k.id === "go"), r = M.kitRes.go, lim = kitLimits(kit, r.h), P = packPlan(kit, r, lim);
  return { limG: lim.kg ? lim.kg * 1000 : Infinity, limMl: lim.L * 1000, fits: P.fits, score: P.score,
    best: P.best && { g: P.best.g, ml: P.best.ml, score: P.best.score, real: kitReadiness(kit, r.h, r.drivers, P.best.items).score,
      left: P.best.leave.map(x => { const l = P.lines.find(l => l.it === x.it); return { id: x.it.id, untagged: ${JSON.stringify(FIVE)}.includes(x.it.category) && !essentialOf(x.it) && expState(x.it) !== "expired", g: l.unitG, ml: l.unitMl }; }) } }; })()`;
const untaggedPacks = {
  "untagged items heavier than the carry limit": [5, `
    { id: "u1", kitId: "go", name: "Steel toolbox", category: "tools", qty: 1, grams: 9000 },
    { id: "u2", kitId: "go", name: "Binder of documents", category: "documents", qty: 1, grams: 3000 },
    { id: "w1", kitId: "go", name: "Water", category: "water", qty: 6, liters: 6 },
    { id: "f1", kitId: "go", name: "Food bars", category: "food", qty: 10, kcal: 4000, grams: 1000 }`],
  "many untagged units with estimated weights": [2, `
    { id: "u1", kitId: "go", name: "Tools", category: "tools", qty: 6 },
    { id: "u2", kitId: "go", name: "Papers", category: "documents", qty: 4 }`],
  "room left for an untagged folder": [1.5, `
    { id: "w1", kitId: "go", name: "Water", category: "water", qty: 12, liters: 6 },
    { id: "u1", kitId: "go", name: "Folder", category: "documents", qty: 1 }`],
};

test("untagged items never push the best pack over the kit's limits or change its score, and stay in while there is room", () => {
  for (const [name, [kg, items]] of Object.entries(untaggedPacks)) {
    const { run, json } = load({ fixture: "tests/household" });
    run(`S.kits.find(k => k.id === "go").carryKg = ${kg}; S.items.push(${items});`);
    const P = json(GO_PACK);
    assert.equal(P.fits, false, name);
    assert.ok(P.best.g <= P.limG + 1e-6 && P.best.ml <= P.limMl + 1e-6, `${name}: ${P.best.g} g, ${P.best.ml} ml`);
    assert.equal(P.best.score, P.best.real, name);
    for (const x of P.best.left.filter(x => x.untagged))
      assert.ok(P.best.g + x.g > P.limG + 1e-6 || P.best.ml + x.ml > P.limMl + 1e-6, `${name}: ${x.id} is left out though it fits`);
    run(`S.items = S.items.filter(i => !(${JSON.stringify(FIVE)}.includes(i.category) && !essentialOf(i)))`);
    const without = json(GO_PACK);
    assert.equal(P.best.score, without.best ? without.best.score : without.score, `${name}: the untagged items, which earn nothing, change the best score`);
  }
});

test("a lighter swap is offered only where it keeps the score: tools only for the multi-tool essential", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.items.push(...["duct_tape", "shutoff_wrench", "fire_starter", "multitool", "none", ""].map(e => ({ id: "t_" + (e || "untagged"), kitId: "go", name: "Tool", category: "tools", qty: 1, essential: e })))`);
  const offered = json(`(() => { const M = model(), kit = S.kits.find(k => k.id === "go"), r = M.kitRes.go; return packPlan(kit, r, kitLimits(kit, r.h)).swaps.filter(x => x.it.category === "tools").map(x => x.it.id); })()`);
  assert.deepEqual(offered, ["t_multitool"]);
});

// Making a swap puts the lighter thing in the kit; in the five categories that is the essential it fills.
test("every lighter swap keeps the kit's score, in every scenario", () => {
  const apps = [...scenarios.map(name => [name, load({ fixture: name })]), ["screenshot case", screenshotCase()]];
  const tagged = load({ fixture: "tests/household" });
  tagged.run(`S.items.push(...["duct_tape", "shutoff_wrench", "multitool"].map(e => ({ id: "t_" + e, kitId: "go", name: "Tool", category: "tools", qty: 2, essential: e })))`);
  apps.push(["tagged tools", tagged]);
  let n = 0;
  for (const [name, { run, json }] of apps) {
    const swaps = json(`(() => { const M = model(); return S.kits.filter(k => kitLimits(k, M.h)).flatMap(k => packPlan(k, M.kitRes[k.id], kitLimits(k, M.h)).swaps
      .filter(x => x.it.category !== "food").map(x => ({ kit: k.id, id: x.it.id, to: x.to }))); })()`);
    for (const s of swaps) {
      const before = json(`model().kitRes[${JSON.stringify(s.kit)}].score`);
      run(`(it => { const lite = PACK[CATS[it.category] ? it.category : "other"].lite, q = Math.max(1, num(it.qty));
        Object.assign(it, { name: ${JSON.stringify(s.to)}, grams: lite.g * q, ml: lite.ml * q }, essentialList(it.category).length ? { essential: lite.ess || "" } : {}); })(S.items.find(i => i.id === ${JSON.stringify(s.id)}))`);
      assert.equal(json(`model().kitRes[${JSON.stringify(s.kit)}].score`), before, `${name}: swapping ${s.id} to ${s.to}`);
      n++;
    }
  }
  assert.ok(n > 0, "some swap is offered");
});
