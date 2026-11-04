const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

// The standard household's go-bag, overloaded: far more water than one person can carry, heavy food,
// sleeping bags and lanterns.
function heavyGoBag() {
  const app = load({ fixture: "tests/household" });
  app.run(`S.items.push(
    { id: "w1", kitId: "go", name: "Water bottles", category: "water", qty: 24, liters: 12 },
    { id: "w2", kitId: "go", name: "Gallon jugs", category: "water", qty: 4, liters: 15 },
    { id: "f1", kitId: "go", name: "Canned chili", category: "food", qty: 10, kcal: 4000 },
    { id: "s1", kitId: "go", name: "Sleeping bag", category: "shelter", qty: 2 },
    { id: "l9", kitId: "go", name: "Lantern", category: "light", qty: 3 },
    { id: "filt", kitId: "go", name: "Water filter", category: "water", qty: 1 });`);
  return app;
}
const PLAN = `(() => { const M = model(), kit = S.kits.find(k => k.id === "go"), r = M.kitRes.go;
  return { M, kit, r, lim: kitLimits(kit, r.h), P: packPlan(kit, r, kitLimits(kit, r.h)) }; })()`;
// Applies a list of {it, n} removals to the saved items, as ticking them off the kit would.
const REMOVE = `xs => { for (const x of xs) { const it = S.items.find(i => i.id === x.it.id), q = Math.max(1, num(it.qty));
  if (x.n >= q) S.items = S.items.filter(i => i !== it);
  else Object.assign(it, { qty: q - x.n, liters: num(it.liters) * (q - x.n) / q, kcal: num(it.kcal) * (q - x.n) / q }); } }`;

test("weight and size come from the item, else from its litres, calories or category", () => {
  const { json } = load();
  const water = json(`itemLoad({ category: "water", qty: 24, liters: 12 })`);
  assert.equal(water.g, 12 * 1040);
  assert.equal(water.est, true);
  assert.equal(json(`itemLoad({ category: "food", qty: 4, kcal: 1000 })`).g, 400);
  assert.equal(json(`itemLoad({ category: "light", qty: 2 })`).g, 600);
  const own = json(`itemLoad({ category: "water", qty: 24, liters: 12, grams: 13000, ml: 14000 })`);
  assert.deepEqual([own.g, own.ml, own.unitG, own.est], [13000, 14000, 13000 / 24, false]);
});

test("carry limits come from ages, and a go-bag gets its strongest carrier's", () => {
  const { run, json } = load({ fixture: "tests/household" });
  assert.deepEqual(json(`S.profile.members.map(carryKg)`), [15, 15, 2.5, 2, 0]);
  const go = json(`kitLimits(S.kits.find(k => k.id === "go"), household())`);
  assert.deepEqual([go.kg, go.L, go.carrier, go.totalKg, go.carriers], [15, 40, "Alex", 34.5, 4]);
  run(`S.kits.find(k => k.id === "go").carryKg = 9; S.kits.find(k => k.id === "go").bagL = 30;`);
  assert.deepEqual(json(`(l => [l.kg, l.L, l.suggestedKg])(kitLimits(S.kits.find(k => k.id === "go"), household()))`), [9, 30, 15]);
  const car = json(`kitLimits(S.kits.find(k => k.id === "car"), household())`);
  assert.deepEqual([car.kg, car.L], [null, 60]);
  assert.equal(json(`kitLimits(S.kits.find(k => k.id === "home"), household())`), null);
  run(`S.profile.members[0].conditions = ["mobility"];`);
  assert.equal(json(`carryKg(S.profile.members[0])`), 7.5);
});

test("the best pack fits both limits, and leaving out what it says gives exactly its score", () => {
  const { run, json } = heavyGoBag();
  const out = json(`(({ P, lim }) => ({ fits: P.fits, limG: lim.kg * 1000, limMl: lim.L * 1000, best: P.best && { score: P.best.score, g: P.best.g, ml: P.best.ml, leave: P.best.leave.map(x => ({ it: { id: x.it.id }, n: x.n })) }, now: P.score }))(${PLAN})`);
  assert.equal(out.fits, false);
  assert.ok(out.best.g <= out.limG && out.best.ml <= out.limMl, "over a limit");
  assert.ok(out.best.leave.some(x => x.it.id === "filt") === false, "a water filter is always kept");
  run(`(${REMOVE})(${JSON.stringify(out.best.leave)})`);
  assert.equal(json(`model().kitRes.go.score`), out.best.score);
  assert.equal(json(`(${PLAN}).P.fits`), true);
});

test("on a small kit the best pack is the best possible", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.items = S.items.filter(i => i.kitId !== "go"); S.kits.find(k => k.id === "go").carryKg = 3; S.kits.find(k => k.id === "go").bagL = 100;
    S.items.push(
      { id: "a", kitId: "go", name: "Water", category: "water", qty: 2, liters: 2, grams: 2000, ml: 2000 },
      { id: "b", kitId: "go", name: "Cans", category: "food", qty: 2, kcal: 800, grams: 800, ml: 800 },
      { id: "c", kitId: "go", name: "First aid", category: "first_aid", qty: 1, grams: 450, ml: 900 },
      { id: "d", kitId: "go", name: "Torch", category: "light", qty: 2, grams: 300, ml: 400 },
      { id: "e", kitId: "go", name: "Sleeping bag", category: "shelter", qty: 1, grams: 1500, ml: 6000 },
      { id: "f", kitId: "go", name: "Knife", category: "tools", qty: 1, essential: "multitool", grams: 400, ml: 300 },
      { id: "g", kitId: "go", name: "Jacket", category: "clothing", qty: 1, grams: 600, ml: 2500 },
      { id: "h", kitId: "go", name: "Pills", category: "medications", qty: 1, essential: "pain_reliever", grams: 100, ml: 100 });`);
  const best = json(`(${PLAN}).P.best.score`);
  const brute = json(`(() => {
    const { kit, r, lim } = ${PLAN};
    const lines = S.items.filter(i => i.kitId === "go").map(it => ({ it, ...itemLoad(it) }));
    let top = 0;
    const walk = (i, keep, g) => {
      if (g > lim.kg * 1000) return;
      if (i === lines.length) {
        const items = lines.flatMap((l, j) => keep[j] ? [{ ...l.it, qty: keep[j], liters: num(l.it.liters) * keep[j] / l.q, kcal: num(l.it.kcal) * keep[j] / l.q }] : []);
        top = Math.max(top, kitReadiness(kit, r.h, r.drivers, items).score); return;
      }
      for (let n = 0; n <= lines[i].q; n++) walk(i + 1, [...keep, n], g + n * lines[i].unitG);
    };
    walk(0, [], 0);
    return top; })()`);
  assert.equal(best, brute);
});

test("a kit that fits needs no best pack, and taking out its spare items keeps every point", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.items.push({ id: "l2", kitId: "go", name: "Lantern", category: "light", qty: 4 }, { id: "x", kitId: "go", name: "Kayak paddle", category: "other", qty: 1 });`);
  const out = json(`(({ P }) => ({ fits: P.fits, best: P.best, score: P.score, takeOut: P.takeOut.map(x => ({ it: { id: x.it.id }, n: x.n, why: x.why })) }))(${PLAN})`);
  assert.equal(out.fits, true);
  assert.equal(out.best, null);
  const why = Object.fromEntries(out.takeOut.map(x => [x.it.id, x.why]));
  assert.equal(why.i7, "Expired, so it adds nothing");
  assert.equal(why.x, "Not on this kit's checklist");
  assert.ok(out.takeOut.some(x => x.it.id === "l2" || x.it.id === "i5"), "spare lights");
  run(`(${REMOVE})(${JSON.stringify(out.takeOut)})`);
  assert.equal(json(`model().kitRes.go.score`), out.score);
});

test("every lighter swap keeps the score and weighs less", () => {
  const { run, json } = heavyGoBag();
  const swaps = json(`(${PLAN}).P.swaps.map(x => ({ id: x.it.id, cat: x.it.category, saveG: x.saveG, to: x.to }))`);
  assert.deepEqual(swaps.map(x => x.id).sort(), ["f1", "i4", "l9", "s1"]);
  assert.ok(swaps.every(x => x.saveG > 0));
  assert.ok(swaps.some(x => x.to === "2 emergency bivvies"));
  const before = json(`model().kitRes.go.score`);
  for (const x of swaps) {
    run(`(() => { const it = S.items.find(i => i.id === ${JSON.stringify(x.id)}); const q = Math.max(1, num(it.qty)); const lite = PACK[it.category].lite;
      it.name = ${JSON.stringify(x.to)}; it.grams = it.category === "food" ? it.kcal / BAR_KCAL_G : lite.g * q; it.ml = 1; })()`);
    assert.equal(json(`model().kitRes.go.score`), before, x.to);
  }
  assert.deepEqual(json(`(${PLAN}).P.swaps`), [], "swapped items aren't offered again");
});

test("ration bars and headlamps aren't offered as swaps for themselves", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.items.push({ id: "r", kitId: "go", name: "Ration bars", category: "food", qty: 3, kcal: 10800 }, { id: "h", kitId: "go", name: "LED headlamp", category: "light", qty: 2 });`);
  assert.deepEqual(json(`(${PLAN}).P.swaps.map(x => x.it.id)`), ["i4"]);
});

test("the Weight and space panel shows for go-bags and car kits, with the water warning", () => {
  const { run } = heavyGoBag();
  run(`S.view = "kits";`);
  const go = run(`(() => { const M = model(); return kitDetail(S.kits.find(k => k.id === "go"), M.kitRes.go); })()`);
  for (const s of ["Weight and space", "Best pack within your limits", "Take out", "Lighter swaps", "more than one person can carry", "Carry limit"]) assert.ok(go.includes(s), s);
  const car = run(`(() => { const M = model(); return kitDetail(S.kits.find(k => k.id === "car"), M.kitRes.car); })()`);
  assert.ok(car.includes("Trunk space") && !car.includes("Carry limit"));
  const home = run(`(() => { const M = model(); return kitDetail(S.kits.find(k => k.id === "home"), M.kitRes.home); })()`);
  assert.ok(!home.includes("Weight and space"));
});

test("odd weights, sizes and limits render as estimates, never NaN", () => {
  const { run, json } = load({ fixture: "fixtures/data-and-account-shapes/odd-values" });
  const html = run(`(() => { const M = model(); return S.kits.map(k => kitDetail(k, M.kitRes[k.id])).join(""); })()`);
  assert.ok(!/NaN|undefined|Infinity/.test(html));
  const P = json(`(() => { const M = model(), k = S.kits.find(k => k.id === "g"), r = M.kitRes.g, lim = kitLimits(k, r.h); return { lim, P: packPlan(k, r, lim) }; })()`);
  assert.ok(Number.isFinite(P.P.g) && Number.isFinite(P.P.ml));
  assert.equal(P.lim.L, 40);
});

test("Estimate with Claude saves weights only where they're missing", async () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`sample = { json: async prompt => { globalThis.lastPrompt = prompt; return [{ id: "i5", grams: 180, ml: 400 }, { id: "i4", grams: 999, ml: 999 }, { id: "i7", grams: 999, ml: 120 }, { id: "nope", grams: 1 }]; } };
    S.items.find(i => i.id === "i5").name = "Head|lamp"; S.items.find(i => i.id === "i7").grams = 50;`);
  await run(`ACT.packEstimate({ dataset: { id: "go" } })`);
  assert.ok(!json("lastPrompt").includes("i4 |"), "items with both values aren't asked about");
  assert.ok(json("lastPrompt").includes("i5 | Head lamp |"));
  assert.deepEqual(json(`(i => [i.grams, i.ml])(S.items.find(i => i.id === "i5"))`), [180, 400]);
  assert.deepEqual(json(`(i => [i.grams, i.ml])(S.items.find(i => i.id === "i4"))`), [450, 1800]);
  assert.deepEqual(json(`(i => [i.grams, i.ml])(S.items.find(i => i.id === "i7"))`), [50, 120], "a typed weight is kept");
  assert.equal(json("S.packEst"), null);
});

test("weights show and are typed in pounds, and saved data stays in grams and kg", async () => {
  const app = load({ fixture: "tests/household" });
  const { run, json, fire } = app;
  // A 450 g first-aid kit shows as 1 lb in the kit table, under an lb column
  const html = run(`S.openKit = "go"; viewKits(model())`);
  assert.match(html, />lb<\/th>/);
  assert.match(html, /id="it-i4-g" value="1"/);
  assert.doesNotMatch(html, />kg<|in kg| kg\b/);
  // Typing 10 lb saves 4536 g
  await fire("change", { dataset: { change: "item", id: "i4", f: "grams" }, value: "10" });
  assert.equal(json(`S.items.find(i => i.id === "i4").grams`), 4536);
  // A carry limit of 20 lb is saved as kg and shows as 20 lb again
  await fire("change", { dataset: { change: "packLim", id: "go", f: "carryKg" }, value: "20" });
  assert.equal(json(`S.kits.find(k => k.id === "go").carryKg`), 9.07);
  const panel = run(`(k => packPanel(k, kitReadiness(k, household(), model().active)))(S.kits.find(k => k.id === "go"))`);
  assert.match(panel, /id="pk-carryKg-go" value="20"/);
  assert.match(panel, /of 20 lb/);
  assert.doesNotMatch(panel, / kg\b/);
  // Bag size is still litres, half-litre steps
  await fire("change", { dataset: { change: "packLim", id: "go", f: "bagL" }, value: "32.3" });
  assert.equal(json(`S.kits.find(k => k.id === "go").bagL`), 32.5);
});
