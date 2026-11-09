const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");

// Every scenario under fixtures/, so a new one is checked as soon as it is added.
const scenarios = fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)));

test("there are edge-case scenarios to run", () => assert.ok(scenarios.length >= 4));

for (const name of scenarios) {
  test(`${name}: every tab renders and every score is a number from 0 to 100`, () => {
    const { run, json } = load({ fixture: name });
    run("syncDraft()");
    for (const v of json("VIEWS")) assert.doesNotThrow(() => run(`S.view = "${v}"; render()`), v);
    const scores = json(`(() => { const M = model(); return [M.overall ?? 0, ...M.results.map(r => r.score), ...Object.values(M.kitRes).map(r => r.score)]; })()`);
    for (const s of scores) assert.ok(Number.isFinite(s) && s >= 0 && s <= 100, `score ${s}`);
    assert.doesNotThrow(() => run("viewShop(model()); reviewPrompt(model())"));
  });
}
