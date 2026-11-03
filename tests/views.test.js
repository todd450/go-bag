const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

test("every tab renders for a brand-new household and for a full one", () => {
  for (const fixture of [undefined, "tests/household"]) {
    const { run, json } = load({ fixture });
    run("syncDraft()");
    for (const v of json("VIEWS")) assert.doesNotThrow(() => run(`S.view = "${v}"; render()`), `${v} (${fixture || "empty"})`);
  }
});

test("the Readiness tab groups emergencies, with a star on raised ones", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.hazards.importance = { burns: "most" }; S.openHz = new Set(["burns"]);`);
  const html = run("viewOverview(model())");
  for (const label of ["Disasters and outages", "Health emergencies", "Everyday"]) assert.ok(html.includes(label), label);
  assert.equal((html.match(/class="pri"/g) || []).length, 1);
  assert.match(html, /data-change="importance"/);
});

test("names people type are escaped", () => {
  const { run } = load({ fixture: "tests/household" });
  const evil = `<img src=x onerror=alert(1)>`;
  run(`S.profile.members[0].label = ${JSON.stringify(evil)}; S.kits[0].name = ${JSON.stringify(evil)}; syncDraft();`);
  for (const v of ["viewHousehold()", "viewOverview(model())", "viewKits(model())"]) assert.ok(!run(v).includes(evil), v);
});

test("a refill due within a week becomes a next step", () => {
  const { run } = load({ fixture: "tests/household" });
  const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  run(`S.plan = { meds: [{ who: "Sam", name: "Levothyroxine", refill: "${day(3)}" }] }`);
  assert.ok(run(`nextActions(model()).acts.some(a => a.kind === "refill")`));
  run(`S.plan.meds[0].refill = "${day(30)}"`);
  assert.ok(!run(`nextActions(model()).acts.some(a => a.kind === "refill")`));
});

test("every inventory cell with something in it is labelled for the card layout", () => {
  const { run } = load({ fixture: "tests/household" });
  const tables = [];
  for (const w of [true, false]) {
    run(`S.canWrite = ${w}; S.openKit = "go"`);
    tables.push(run("viewKits(model())"));
  }
  tables.push(run(`draftTable({ rows: [{ key: "a", name: "Tent", category: "shelter", qty: 1, liters: 0, kcal: 0, kg: 2, L: 9, expires: "", shop: "" }] })`));
  for (const html of tables) {
    const table = html.match(/<table class="inv">[\s\S]*?<\/table>/);
    assert.ok(table, "inventory table has class inv");
    const cells = table[0].match(/<td[^>]*>[\s\S]*?<\/td>/g);
    assert.ok(cells.length > 8);
    for (const td of cells) {
      if (/^<td[^>]*><\/td>$/.test(td) || /^<td class="(sel|x-td)"/.test(td)) continue;
      assert.match(td, /^<td[^>]*data-label="[^"]+"/, td.slice(0, 80));
    }
  }
});
