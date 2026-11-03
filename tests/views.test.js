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

// Every scenario and the standard household, with each kit open in turn and its delete confirmation showing.
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./load");
const countFixtures = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

test("a count of one is never followed by a plural", () => {
  const plural = /\b1 (people|persons|items|kits|pets|photos|gaps|steps|supplies)\b/;
  for (const fixture of countFixtures) {
    const { run, json } = load({ fixture });
    run("syncDraft(); for (const k of S.kits) k.photos = ['p1'];");
    const text = html => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    const pages = [run("viewOverview(model())")];
    for (const id of json("S.kits.map(k => k.id)")) pages.push(run(`S.openKit = ${JSON.stringify(id)}; S.confirm = "kit:" + S.openKit; viewKits(model())`));
    for (const page of pages) assert.doesNotMatch(text(page), plural, fixture);
  }
});

test("next steps that mix setup and supplies count only the supplies", () => {
  const { run, json } = load({ fixture: "tests/household" });
  const kinds = json("nextActions(model()).acts.map(a => a.kind)");
  assert.deepEqual(kinds, ["plan", "gap", "gap"]);
  const html = run("viewOverview(model())");
  assert.match(html, /Your next 3 steps/);
  assert.match(html, /Adding the 2 supplies below takes readiness from \d+ to \d+\./);
  assert.doesNotMatch(html, /these 2 gaps/);
});
