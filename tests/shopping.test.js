const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

test("Next steps and the shopping list give every gap the same points", () => {
  const { json } = load({ fixture: "tests/household" });
  const off = json(`(() => { const M = model();
    return M.gaps.map(g => [g.cat, Math.max(0, scoreIfFilled(M, [g]) - M.overall), shopInfo(shopFromGap(g, M.h), M).gain]).filter(([, a, b]) => a !== b); })()`);
  assert.deepEqual(off, []);
});

test("Next steps' 'from X to Y' is the score with all shown gaps bought together", () => {
  const { run } = load({ fixture: "tests/household" });
  const check = () => run(`(() => { const M = model(), N = nextActions(M);
    const shown = N.acts.flatMap(a => a.kind === "gap" ? [a.g] : a.kind === "shop" ? a.gs : []);
    return shown.length > 0 && N.after === scoreIfFilled(M, shown); })()`);
  assert.ok(check(), "nothing listed");
  run(`ACT.shopAdd({ dataset: { cat: nextActions(model()).acts.find(a => a.kind === "gap").g.cat } })`);
  assert.ok(check(), "one gap listed");
});

test("gaps already on the list fold into one step, and new gaps take the freed slots", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.items.find(i => i.id === "i3").essential = "extinguisher"`); // tagged, so no tag step takes a slot
  const before = json(`nextActions(model()).acts.filter(a => a.kind === "gap").map(a => a.g.cat)`);
  for (const cat of before.slice(0, 2)) run(`ACT.shopAdd({ dataset: { cat: "${cat}" } })`);
  const N = json(`(() => { const N = nextActions(model()); return { acts: N.acts.map(a => [a.kind, a.kind === "gap" ? a.g.cat : a.kind === "shop" ? a.gs.map(g => g.cat) : a.title]), more: N.more, total: model().gaps.length }; })()`);
  const shop = N.acts.filter(([k]) => k === "shop");
  assert.equal(shop.length, 1, "one shopping step");
  assert.deepEqual(shop[0][1].sort(), before.slice(0, 2).sort());
  const gapCats = N.acts.filter(([k]) => k === "gap").map(([, c]) => c);
  for (const cat of before.slice(0, 2)) assert.ok(!gapCats.includes(cat), `${cat} isn't also its own step`);
  assert.equal(N.more, N.total - 2 - gapCats.length);
  const html = run("viewOverview(model())");
  assert.match(html, /Buy the 2 things on your list/);
  assert.match(html, /data-act="tab" data-v="shop">Open list</);
  assert.doesNotMatch(html, /On your list ✓/);
});

test("ticking an item puts it in a kit and adds exactly the points its row showed", async () => {
  const { run } = load({ fixture: "tests/household" });
  run("ACT.shopAddAll()");
  const id = run(`shopItems().find(e => shopKit(e) && shopInfo(e, model()).gain > 0).id`);
  const before = run("model().overall");
  const gain = run(`shopInfo(shopItems().find(e => e.id === "${id}"), model()).gain`);
  await run(`shopTick("${id}", true)`);
  assert.equal(run("model().overall"), before + gain);
  assert.equal(run(`shopItems().find(e => e.id === "${id}").done`), true);
  assert.equal(run(`S.items.filter(i => i.source === "list").length`), 1);
  await run(`shopTick("${id}", false)`);
  assert.equal(run("model().overall"), before);
  assert.equal(run(`S.items.filter(i => i.source === "list").length`), 0);
});

test("'Add the top 5' adds the five gaps worth the most points", () => {
  const { json, run } = load({ fixture: "tests/household" });
  const best = json(`(() => { const M = model(); return M.gaps.map(g => scoreIfFilled(M, [g]) - M.overall).sort((a, b) => b - a).slice(0, 5); })()`);
  run("ACT.shopAddTop()");
  assert.deepEqual(json(`shopItems().map(e => shopInfo(e, model()).gain)`).sort((a, b) => b - a), best);
});

test("every supply type has a specific buying suggestion", () => {
  const { json } = load({ fixture: "tests/household" });
  assert.deepEqual(json(`Object.keys(CATS).filter(c => c !== "other" && buyGuide(c, 2, "", "home", household()).line === catLabel(c) + " × 2")`), []);
});

test("buying suggestions follow the household", () => {
  const { run } = load({ fixture: "tests/household" });
  assert.match(run(`buyGuide("food", 20000, "kcal", "home", household()).line`), /sunflower seed butter/);
  assert.equal(run(`buyGuide("allergy", 2, "", "home", household()).price`), null);
  assert.match(run(`buyGuide("comfort", 4, "", "car", household()).line`), /Jordan, Riley and Casey/);
  run(`S.profile.members = [{ years: 30 }]`);
  assert.match(run(`buyGuide("food", 20000, "kcal", "home", household()).line`), /peanut butter/);
});

test("a budget keeps the list to what it can buy, best value first", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`ACT.shopAddAll(); S.view = "shop"; S.budget = 60;`);
  const html = run("viewShop(model())");
  assert.match(html, /Over your budget/);
});

test("ticking with a row to fly from still works where there's no animation", async () => {
  const { run } = load({ fixture: "tests/household" });
  run("ACT.shopAddAll()");
  const id = run(`shopItems().find(e => shopKit(e) && shopInfo(e, model()).gain > 0).id`);
  const before = run("model().overall"), gain = run(`shopInfo(shopItems().find(e => e.id === "${id}"), model()).gain`);
  const row = `{ getBoundingClientRect: () => ({ top: 300, right: 700, height: 40 }) }`;
  await run(`shopTick("${id}", true, ${row})`);
  assert.equal(run("model().overall"), before + gain);
});
