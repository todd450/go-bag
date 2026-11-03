const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

test("an exact age sets the age group and daily calories", () => {
  const { json } = load();
  const got = json(`[{years:0},{years:2},{years:3},{years:12},{years:16},{years:40},{years:70},{age:"child"},{}].map(m => [groupOf(m), kcalFor(m)])`);
  assert.deepEqual(got, [["infant", 800], ["infant", 1000], ["child", 1000], ["child", 1800], ["teen", 2200], ["adult", 2000], ["senior", 1800], ["child", 1600], ["adult", 2000]]);
});

test("evacuation water is 3.8 L a person and 1 L a pet, for each day", () => {
  const { run } = load({ fixture: "tests/household" });
  // 5 people and a dog for 3 days.
  assert.equal(run(`model().results.find(r => r.hz.id === "evacuation").rows.find(x => x.cat === "water").need`), Math.round((5 * 3.8 + 1) * 3));
});

test("a kit marked for one person is sized for one, without the pets", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.kits.find(k => k.id === "go").serves = 1`);
  assert.equal(run(`model().kitRes.go.rows.find(x => x.cat === "water").need`), Math.round(3.8 * 3));
});

test("expired items don't count", () => {
  const { run } = load({ fixture: "tests/household" });
  assert.equal(run(`model().stocks.evacuate.count.medications || 0`), 0);
  run(`S.items.find(i => i.id === "i7").expires = "2999-01"`);
  assert.equal(run(`model().stocks.evacuate.count.medications`), 1);
});
