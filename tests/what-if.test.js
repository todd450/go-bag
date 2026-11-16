// What a shopping line is worth, without scoring the household again (issue #158). scoreIfBought used to put
// the line's item in the household and build the whole model once more, for every line on every draw. It now
// adds the item to the stocks the model already counted. These tests hold it to the old answer, to the point,
// on every household, and hold a draw to a fixed number of full models however long the list is.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");

const households = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

// The old way, kept here as the reference: the items really in the household, and a model from scratch.
const SLOW = `function slowIfBought(list) {
  const add = list.filter(e => CATS[e.cat] && shopKit(e)).map(e => ({ id: "_sim", ...itemFromShop(e, shopKit(e)) }));
  HOUSEHOLD.items.push(...add);
  try { return model().overall; } finally { HOUSEHOLD.items.splice(HOUSEHOLD.items.length - add.length); }
}`;
// Every gap as a line: left to find its own kit, sent to each kit in turn, and sent to no kit.
const LINES = `(M => M.gaps.flatMap(g => [shopFromGap(g, M.h), ...HOUSEHOLD.kits.map(k => shopFromGap(g, M.h, k.id)), { ...shopFromGap(g, M.h), kitId: "none" }]))`;

test("on every household, a line, a pair of lines and the whole list score what a model from scratch scores", () => {
  let checked = 0;
  for (const name of households) {
    const app = load({ fixture: name });
    app.run(SLOW);
    const off = app.json(`(() => {
      const M = model(), lines = ${LINES}(M), off = [];
      const same = (what, list) => { const a = scoreIfBought(list, M), b = slowIfBought(list); if (a !== b) off.push([what, a, b]); };
      lines.forEach((e, i) => same("line " + i + " " + e.cat + " " + (e.essential || "") + " -> " + (e.kitId || "its own kit"), [e]));
      for (let i = 0; i + 1 < lines.length; i += 2) same("pair " + i, [lines[i], lines[i + 1]]);
      same("every line", lines);
      same("no lines", []);
      // and the same line twice, which fills a counted category further and an essential once
      if (lines.length) same("one line twice", [lines[0], lines[0]]);
      return { off, n: lines.length };
    })()`);
    assert.deepEqual(off.off, [], `${name}: [what, scoreIfBought, from scratch]`);
    checked += off.n;
  }
  assert.ok(checked > 200, `the households between them have plenty of lines to check (${checked})`);
});

test("it holds for an item past its date, an item in a kit that is gone, and a household with nothing rated", () => {
  const app = load({ fixture: "tests/household" });
  app.run(SLOW);
  const kit = app.json(`HOUSEHOLD.kits.find(k => k.type === "home").id`);
  const cases = app.json(`(() => {
    const M = model(), out = [];
    const same = (what, add) => {
      const a = overallWith(M, add);
      HOUSEHOLD.items.push(...add);
      let b; try { b = model().overall; } finally { HOUSEHOLD.items.splice(HOUSEHOLD.items.length - add.length); }
      out.push([what, a, b]);
    };
    const water = { id: "_sim", kitId: ${JSON.stringify(kit)}, name: "Water", category: "water", qty: 1, liters: 400, kcal: 0 };
    same("in date", [water]);
    same("expired", [{ ...water, expires: "2001-01" }]);
    same("a kit that is gone", [{ ...water, kitId: "no-such-kit" }]);
    same("an unknown category", [{ ...water, category: "no-such-category" }]);
    return out;
  })()`);
  for (const [what, a, b] of cases) assert.equal(a, b, what);
  assert.notEqual(cases[0][1], cases[1][1], "in-date water moves the score and expired water doesn't, so the cases differ");
  app.run(`S.hazards = { levels: Object.fromEntries(HAZARDS.map(h => [h.id, "none"])) }`);
  assert.equal(app.run("model().overall"), null);
  assert.equal(app.run(`(M => scoreIfBought(${LINES}(model()), M))(model())`), null, "nothing rated scores nothing, bought or not");
});

test("an emergency with a mode and kits of its own is filled from its mode's stock, as the model fills it", () => {
  // No emergency is shaped like this today. model() scores one from its mode's stock and ignores its own kits,
  // so a line bought into a kit of its mode moves it, and one bought into its own kits alone doesn't.
  const app = load({ fixture: "tests/household" });
  app.run(SLOW);
  app.run(`HAZARDS.push({ id: "made_up", name: "Made up", severity: "critical", mode: "shelter", kits: ["car"], days: 30, base: () => "high", needs: ["water", "food"] })`);
  const r = app.json(`(() => {
    const M = model(), home = HOUSEHOLD.kits.find(k => k.type === "home").id, car = HOUSEHOLD.kits.find(k => k.type === "car").id;
    const line = kitId => ({ cat: "water", qty: 5000, unit: "L", name: "Water", kits: ["home"], kitId });
    return { active: M.active.some(x => x.hz.id === "made_up"), now: M.overall,
      home: [scoreIfBought([line(home)], M), slowIfBought([line(home)])], car: [scoreIfBought([line(car)], M), slowIfBought([line(car)])] };
  })()`);
  assert.ok(r.active, "the made-up emergency counts");
  assert.equal(r.home[0], r.home[1], "into a home kit");
  assert.equal(r.car[0], r.car[1], "into a car kit");
  assert.ok(r.home[1] > r.now, "water at home moves the score, so the case is a real one");
  assert.notEqual(r.home[1], r.car[1], "and where it goes matters");
});

test("two kits with one id, which the database rules out, still score as the model scores them", () => {
  const app = load({ fixture: "tests/household" });
  app.run(SLOW);
  for (const types of [["home", "car"], ["car", "home"]]) {
    app.run(`S.kits = ${JSON.stringify(types.map(type => ({ id: "dup", type, name: type })))}; S.items = []`);
    const [a, b] = app.json(`(() => { const e = { cat: "water", qty: 500, unit: "L", name: "Water", kits: ["home"], kitId: "dup" }; return [scoreIfBought([e], model()), slowIfBought([e])]; })()`);
    assert.equal(a, b, types.join(" then "));
  }
});

test("scoring a line changes neither the household's items nor the model it was scored from", () => {
  const app = load({ fixture: "tests/household" });
  const r = app.json(`(() => {
    const M = model(), before = JSON.stringify([HOUSEHOLD.items, M]);
    for (const e of ${LINES}(M)) scoreIfBought([e], M);
    return { same: JSON.stringify([HOUSEHOLD.items, M]) === before, again: JSON.stringify(model()) === JSON.stringify(M) };
  })()`);
  assert.deepEqual(r, { same: true, again: true });
});

test("a model built some other way still scores right, from a fresh count of the stock", () => {
  const app = load({ fixture: "tests/household" });
  app.run(SLOW);
  const off = app.json(`(() => { const M = { ...model() }; return ${LINES}(M).map(e => [scoreIfBought([e], M), slowIfBought([e])]).filter(([a, b]) => a !== b); })()`);
  assert.deepEqual(off, []);
});

// How many times a draw builds the whole model. Before #158: Review 44 and Overview 41 on tests/household.
function draws(app) {
  app.run(`if (!globalThis.__counting) { globalThis.__counting = true; const m = model; model = function () { globalThis.__models++; return m.apply(this, arguments); }; }`);
  const count = code => { app.run("globalThis.__models = 0"); app.run(code); return app.run("globalThis.__models"); };
  return {
    overview: count(`S.view = "overview"; viewOverview(model())`),
    kits: count(`S.view = "kits"; S.allKits = null; viewKits(model())`),
    review: count(`S.view = "kits"; S.allKits = 1; viewKits(model())`),
  };
}

test("a draw builds the model a fixed number of times, however many lines and items there are", () => {
  for (const name of households) {
    const app = load({ fixture: name });
    app.run("S.loaded = true; S.shopping = null; ACT.shopAddAll()");
    const few = draws(app);
    for (const [tab, n] of Object.entries(few)) assert.ok(n <= 3, `${name}: ${tab} builds the model ${n} times`);
    // Ten times the items, the list as long as it was: the count doesn't move.
    app.run(`S.items = Array.from({ length: 10 }, (_, n) => S.items.map(i => ({ ...i, id: i.id + "-" + n }))).flat()`);
    const lines = app.run("shopItems().filter(e => !e.done).length");
    const many = draws(app);
    assert.deepEqual(many, few, `${name}: with ten times the items and ${lines} open lines`);
  }
});

test("the model counts each set of kits once, not once for every emergency that draws on it", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`globalThis.__stocks = 0; { const s = stockItems; stockItems = function () { globalThis.__stocks++; return s.apply(this, arguments); }; }`);
  app.run("model()");
  const sets = app.json(`[...new Set([...Object.values(MODES).map(d => d.kits.join()), ...HAZARDS.map(h => kitsFor(h).join())])].length`);
  const kits = app.run("HOUSEHOLD.kits.length");
  assert.equal(app.run("globalThis.__stocks"), sets + kits, `one count per set of kit types (${sets}) and one per kit (${kits})`);
  assert.ok(sets < app.run("HAZARDS.length"), "fewer sets than emergencies");
});
