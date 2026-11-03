const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

test("a car kit is scored on everyday comfort, counted double", () => {
  const { json } = load({ fixture: "tests/household" });
  const row = json(`model().kitRes.car.rows.find(x => x.cat === "comfort")`);
  assert.equal(row.need, 4);
  assert.equal(row.w, 2);
});

test("a stocked comfort pouch raises the car kit's score", () => {
  const { run } = load({ fixture: "tests/household" });
  const before = run("model().kitRes.car.score");
  run(`S.items.push({ id: "c1", kitId: "car", name: "Comfort pouch", category: "comfort", qty: 4 })`);
  assert.ok(run("model().kitRes.car.score") > before);
});

test("small mishaps on the road include the kids' comfort when there are kids", () => {
  const { json, run } = load({ fixture: "tests/household" });
  assert.ok(json(`model().results.find(r => r.hz.id === "mishap").rows.map(x => x.cat)`).includes("kids"));
  run(`S.profile.members = [{ years: 40 }]`);
  assert.ok(!json(`model().results.find(r => r.hz.id === "mishap").rows.map(x => x.cat)`).includes("kids"));
});
