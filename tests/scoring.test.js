const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const weighted = run => run(`(() => { const M = model();
  return Math.round(M.active.reduce((a, r) => a + r.wt * r.score, 0) / M.active.reduce((a, r) => a + r.wt, 0)) === M.overall; })()`);

test("readiness averages the emergencies, weighted by likelihood times importance", () => {
  const { run } = load({ fixture: "tests/household" });
  assert.ok(weighted(run));
  assert.ok(run(`model().results.every(r => r.wt === LEVELS[r.rel][1] * importanceOf(r.hz.id))`));
});

test("raising an emergency's importance multiplies its weight", () => {
  const { run } = load({ fixture: "tests/household" });
  const base = run(`model().results.find(r => r.hz.id === "housefire").wt`);
  run(`S.hazards.importance = { housefire: "more", burns: "most" }`);
  assert.equal(run(`model().results.find(r => r.hz.id === "housefire").wt`), base * 2);
  assert.equal(run(`model().results.find(r => r.hz.id === "burns").wt`), run(`LEVELS[model().results.find(r => r.hz.id === "burns").rel][1]`) * 3);
  assert.ok(weighted(run));
});

test("raising a well-stocked emergency raises readiness", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.items.push({ id: "b", kitId: "home", category: "burns", qty: 1 }, { id: "f", kitId: "home", category: "first_aid", qty: 1 })`);
  const before = run("model().overall");
  run(`S.hazards.importance = { burns: "most" }`);
  assert.ok(run("model().overall") > before);
});

test("an emergency marked not relevant leaves the score", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.hazards.levels.earthquake = "none"`);
  assert.equal(run(`model().active.some(r => r.hz.id === "earthquake")`), false);
});

test("with no vehicle, road emergencies don't apply", () => {
  const { json, run } = load({ fixture: "tests/household" });
  run(`S.profile.vehicles = 0`);
  assert.deepEqual(json(`model().results.filter(r => r.hz.vehicle).map(r => r.rel)`), ["none", "none"]);
});

test("each item's points add up to its kit's score", () => {
  const { run } = load({ fixture: "tests/household" });
  for (const id of ["go", "home", "car"]) {
    const [sum, score] = run(`(() => { const M = model(), k = S.kits.find(k => k.id === "${id}"), v = itemValues(k, M.kitRes[k.id]);
      return [Object.values(v).reduce((a, x) => a + x.pts, 0), M.kitRes[k.id].score]; })()`);
    assert.ok(Math.abs(sum - score) <= 1, `${id}: items ${sum} vs kit ${score}`);
  }
});

test("a hazard re-check keeps the household's priorities and health levels", async () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.hazards = { assessedAt: 1, levels: { cuts: "low" }, importance: { housefire: "most" } };
    sample = { json: async () => ({ hazards: [{ id: "earthquake", level: "high", why: "On a fault." }, { id: "cuts", level: "none" }], notes: "" }) };`);
  await run("runHazardCheck()");
  const hz = json("S.hazards");
  assert.equal(hz.levels.earthquake, "high");
  assert.equal(hz.levels.cuts, "low");
  assert.deepEqual(hz.importance, { housefire: "most" });
});
