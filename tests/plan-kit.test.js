// Planning a gap into a kit (issue #116, part of #115, decision (b)): a gap planned from a kit stores that kit's id as
// its shopping line's `kitId`, so ticking it puts the item there. Lines planned with no kit keep shopKit's routing.
// kitGaps(M, kitId) is each kit's share of the household gaps, the ones shopKit would send there; kitGaps(M, "") is
// the gaps no kit takes. Nothing on screen passes a kit yet, so these drive the actions directly.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { load, ROOT } = require("./load");

const households = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

// A shopping list already holding lines of every sort: typed in, ticked, and moved to a kit on its row.
const SEEDED = [
  { id: "typed", cat: "", text: "Spare reading glasses", done: false, at: 1 },
  { id: "ticked", cat: "water", qty: 4, unit: "L", text: "4 L", kits: ["home"], kitId: "", done: true, inKit: "home", at: 2 },
  { id: "moved", cat: "light", qty: 1, unit: "", text: "1", kits: ["go"], kitId: "car", done: false, at: 3 },
];

// The standard household with the seeded list, and every write the page makes recorded as [col, id].
function household() {
  const app = load({ fixture: "tests/household" });
  app.run(`S.shopping = { items: ${JSON.stringify(SEEDED)} };
    globalThis.WRITES = []; setDoc = (s => (...a) => { WRITES.push([a[0], a[1]]); return s(...a); })(setDoc)`);
  return app;
}
const tap = (app, act, dataset) => {
  const before = app.json("WRITES").length;
  app.run(`ACT.${act}({ dataset: ${JSON.stringify(dataset)} })`);
  return app.json("WRITES").slice(before);
};
// The lines a tap added, after checking the lines already there are exactly as they were
function added(app) {
  const items = app.json("shopItems()");
  assert.deepEqual(items.slice(0, SEEDED.length), SEEDED, "the lines already on the list are untouched");
  return items.slice(SEEDED.length);
}
const keyOf = e => e.cat + (e.essential ? ":" + e.essential : "");
const WHISTLE = { cat: "communication", essential: "whistle" };

test("a gap planned from a kit is saved with that kit, and ticking it puts the item there", async () => {
  const app = household();
  assert.equal(app.run("model().overall"), 17);
  assert.equal(app.run("model().gaps.length"), 40);
  assert.deepEqual(tap(app, "shopAdd", { ...WHISTLE, kit: "car" }), [["household", "shopping"]], "one write");
  const [line, ...more] = added(app);
  assert.equal(more.length, 0, "one line");
  assert.equal(line.kitId, "car");
  assert.equal(keyOf(line), "communication:whistle");
  assert.equal(app.run(`shopKit(shopItems().find(e => e.id === "${line.id}"))`), "car");

  const said = app.run(`scoreIfBought([shopItems().find(e => e.id === "${line.id}")])`);
  const shown = app.run(`shopInfo(shopItems().find(e => e.id === "${line.id}"), model()).gain`);
  assert.ok(said > 17, `ticking it raises readiness: ${said}`);
  assert.equal(said - 17, shown, "by the points its row shows");
  await app.run(`shopTick("${line.id}", true)`);
  const put = app.json(`S.items.filter(i => i.source === "list")`);
  assert.equal(put.length, 1);
  assert.equal(put[0].essential, "whistle");
  assert.equal(put[0].kitId, "car", "in the Trunk bag, not the Basement bin");
  assert.equal(app.run("model().overall"), said, "readiness is what scoreIfBought said");
});

test("a gap planned with no kit is saved as before, and ticking it puts the item where it went before", async () => {
  const app = household();
  assert.deepEqual(tap(app, "shopAdd", WHISTLE), [["household", "shopping"]], "one write");
  const [line] = added(app);
  // The line main saves: shopFromGap's keys, worked out from the gap's plan, with no kit picked
  const want = app.json(`(() => { const M = model(), g = M.gaps.find(g => gapKey(g) === "communication|whistle"), p = gapPlan(g, M.h);
    return { cat: g.cat, essential: g.essential, qty: p.qty, unit: p.unit, name: p.name, text: p.text, note: p.hint, kits: p.kits, kitId: "", done: false }; })()`);
  const { id, at, ...rest } = line;
  assert.deepEqual(rest, want);
  assert.ok(typeof id === "string" && id.length > 0 && Number.isFinite(at));

  await app.run(`shopTick("${line.id}", true)`);
  assert.deepEqual(app.json(`S.items.filter(i => i.source === "list").map(i => i.kitId)`), ["home"], "in the Basement bin, as today");
});

test("planned into a kit, a line differs from the one planned with no kit only in its kitId", () => {
  for (const kit of ["go", "home", "car"]) {
    const lines = [undefined, kit].map(k => { const app = household(); tap(app, "shopAdd", { ...WHISTLE, ...(k ? { kit: k } : {}) }); return added(app)[0]; });
    const [plain, planned] = lines.map(({ id, at, kitId, ...rest }) => rest);
    assert.deepEqual(planned, plain, kit);
    assert.deepEqual(lines.map(e => e.kitId), ["", kit]);
  }
});

test("a kit that names none of the household's kits is ignored, and the line is saved with no kit", () => {
  for (const kit of ["nope", "none", '"><b>', "", "CAR", "Trunk bag", "constructor", "__proto__", " car"]) {
    const app = household();
    assert.deepEqual(tap(app, "shopAdd", { ...WHISTLE, kit }), [["household", "shopping"]], JSON.stringify(kit));
    const [line] = added(app);
    assert.equal(line.kitId, "", JSON.stringify(kit));
    assert.equal(app.run(`shopKit(shopItems().find(e => e.id === "${line.id}"))`), "home", JSON.stringify(kit));
  }
  // shopFromGap itself, given anything but a kit's id
  const app = household();
  assert.deepEqual(app.json(`(() => { const M = model(), g = M.gaps[0];
    return [undefined, null, 0, "none", "nope", {}, ["car"]].map(k => shopFromGap(g, M.h, k).kitId); })()`), ["", "", "", "", "", "", ""]);
});

test("'Add the top 5' for a kit adds that kit's gaps worth the most points, each saved with the kit", () => {
  const car = household();
  assert.deepEqual(tap(car, "shopAddTop", { kit: "car" }), [["household", "shopping"]], "one write");
  const three = added(car);
  assert.deepEqual(three.map(keyOf).sort(), ["car", "comfort", "first_aid"], "exactly the Trunk bag's three gaps");
  assert.deepEqual(three.map(e => e.kitId), ["car", "car", "car"]);
  assert.deepEqual(tap(car, "shopAddTop", { kit: "car" }), [], "a second tap writes nothing");
  assert.equal(added(car).length, 3, "and adds nothing");

  const home = household();
  assert.deepEqual(tap(home, "shopAddTop", { kit: "home" }), [["household", "shopping"]], "one write");
  const five = added(home);
  assert.deepEqual(five.map(keyOf), ["cpr", "co_alarm", "allergy", "diagnostics", "trauma"]);
  assert.deepEqual(five.map(e => e.kitId), Array(5).fill("home"));
  assert.deepEqual(home.json(`shopItems().slice(${SEEDED.length}).map(shopKit)`), Array(5).fill("home"));
});

test("'Add the top 5' for a kit skips that kit's gaps already on the list", () => {
  const app = household();
  tap(app, "shopAdd", { cat: "cpr" });
  tap(app, "shopAdd", { cat: "allergy", kit: "go" });
  tap(app, "shopAddTop", { kit: "home" });
  const lines = added(app).slice(2);
  assert.deepEqual(lines.map(keyOf), ["co_alarm", "diagnostics", "trauma", "aspirin", "poison"]);
  assert.deepEqual(lines.map(e => e.kitId), Array(5).fill("home"));
});

test("'Add the top 5' with a kit that names no kit adds what it adds with none", () => {
  const top = dataset => { const app = household(); tap(app, "shopAddTop", dataset); return added(app).map(({ id, at, ...rest }) => rest); };
  const plain = top({});
  assert.equal(plain.length, 5);
  assert.deepEqual(plain.map(e => e.kitId), Array(5).fill(""));
  for (const kit of ["nope", "none", '"><b>', ""]) assert.deepEqual(top({ kit }), plain, JSON.stringify(kit));
});

// The core on its own, as core.test.js runs it: core.js
function loadCore(name) {
  const ctx = vm.createContext({ crypto: globalThis.crypto });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "core.js"), "utf8"), ctx, { filename: "core.js" });
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, name + ".json"), "utf8"));
  vm.runInContext(`(f => { for (const k of HOUSEHOLD_DOCS) HOUSEHOLD[k] = f[k] || null; HOUSEHOLD.kits = f.kits || []; HOUSEHOLD.items = f.items || []; })(${JSON.stringify(f)})`, ctx);
  return code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, ctx));
}
// Each kit's gaps and the gaps no kit takes, as indexes into M.gaps
const SPLIT = `(M => ({ n: M.gaps.length, kits: HOUSEHOLD.kits.map(k => k.id),
  split: Object.fromEntries([...HOUSEHOLD.kits.map(k => k.id), ""].map(id => [id, kitGaps(M, id).map(g => M.gaps.indexOf(g))])),
  routed: HOUSEHOLD.kits.map(k => kitGaps(M, k.id).every(g => shopKit(shopFromGap(g, M.h)) === k.id && shopKit(shopFromGap(g, M.h, k.id)) === k.id)),
  nope: kitGaps(M, "nope").length + kitGaps(M, "none").length }))(model())`;

for (const name of households) {
  test(`${name}: kitGaps puts each household gap in exactly one kit's share, or in no kit's`, () => {
    const { n, kits, split, routed, nope } = loadCore(name)(SPLIT);
    const all = Object.values(split).flat();
    assert.deepEqual(all.slice().sort((a, b) => a - b), [...Array(n).keys()], "each gap exactly once");
    for (const [id, at] of Object.entries(split)) {
      assert.ok(at.every(i => i >= 0), `${id}: gaps from M.gaps`);
      assert.deepEqual(at, at.slice().sort((a, b) => a - b), `${id}: in M.gaps order`);
    }
    assert.deepEqual(routed, kits.map(() => true), "each kit's gaps are the ones its lines go to");
    assert.equal(nope, 0, "no gaps for a kit the household doesn't have");
    // The page works out the same split
    assert.deepEqual(load({ fixture: name }).json(SPLIT), { n, kits, split, routed, nope });
  });
}

test("each kit's share of the gaps, on the standard household and the edge cases", () => {
  const count = name => { const s = loadCore(name)(SPLIT).split; return Object.fromEntries(Object.entries(s).map(([id, at]) => [id, at.length])); };
  assert.deepEqual(count("tests/household"), { go: 9, home: 28, car: 3, "": 0 });
  assert.deepEqual(count("fixtures/empty-and-one/new-household"), { "": 33 });
  const one = loadCore("fixtures/empty-and-one/one-person");
  assert.deepEqual(one(`kitGaps(model(), "").map(g => g.cat).sort()`), ["co_alarm", "poison"]);
});
