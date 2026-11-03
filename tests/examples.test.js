const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

// A household that started from the examples: one example kit now holds the family's own items,
// the other is still untouched.
function startedFromExamples() {
  const app = load({ fixture: "tests/household" });
  app.run(`
    S.canWrite = true;
    S.kits = [
      { id: "exgo", type: "go", name: "Hall closet go-bag", example: true, photos: [] },
      { id: "excar", type: "car", name: "Trunk kit", example: true, photos: [] },
    ];
    S.items = [
      { id: "mine", kitId: "exgo", name: "Water bottle", category: "water", qty: 6, liters: 3 },
      { id: "sample", kitId: "excar", name: "Example flares", category: "light", qty: 2, example: true },
    ];
  `);
  return app;
}

test("an example kit holding your own items is no longer shown as an example", () => {
  const { run, json } = startedFromExamples();
  assert.deepEqual(json("S.kits.filter(isExampleKit).map(k => k.id)"), ["excar"]);
  run(`S.view = "kits"; S.openKit = "exgo";`);
  const tags = run("viewKits(model())").match(/<span class="mono">[^<]*<\/span><b>[^<]*/g);
  assert.ok(tags.some(t => t.includes("Hall closet go-bag") && !t.includes("EXAMPLE")));
  assert.ok(tags.some(t => t.includes("Trunk kit") && t.includes("EXAMPLE")));
});

test("Clear examples keeps a kit that holds your items and removes the rest", async () => {
  const { run, json } = startedFromExamples();
  await run("ACT.clearExamples()");
  assert.deepEqual(json("S.kits.map(k => [k.id, !!k.example])"), [["exgo", false]]);
  assert.deepEqual(json("S.items.map(i => i.id)"), ["mine"]);
  assert.equal(run("viewBanner()"), "");
});

test("the banner goes once only examples you've made your own are left", () => {
  const { run } = startedFromExamples();
  assert.match(run("viewBanner()"), /example data/);
  run(`S.items = S.items.filter(i => i.kitId !== "excar"); S.kits = S.kits.filter(k => k.id !== "excar");`);
  assert.equal(run("viewBanner()"), "");
});
