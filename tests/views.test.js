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

test("the add-a-kit form folds into a button once there is a kit", () => {
  const empty = load().run("viewKits(model())");
  assert.match(empty, /data-submit="newKit"/, "no kits: the form is open");
  assert.doesNotMatch(empty, /data-act="cancelKit"|data-act="addKit"/, "no kits: nothing to cancel back to");

  const { run } = load({ fixture: "tests/household" });
  let html = run("viewKits(model())");
  assert.match(html, /data-act="addKit"/);
  assert.doesNotMatch(html, /data-submit="newKit"/);

  run("ACT.addKit()");
  html = run("viewKits(model())");
  assert.match(html, /data-submit="newKit"/);
  assert.match(html, /data-act="cancelKit"/);
  assert.doesNotMatch(html, /data-act="addKit"/);

  run("ACT.cancelKit()");
  assert.match(run("viewKits(model())"), /data-act="addKit"/);

  run("S.canWrite = false; S.addKit = true");
  html = run("viewKits(model())");
  assert.doesNotMatch(html, /data-act="addKit"|data-submit="newKit"/, "read-only: neither");
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

test("low, partway and ready scores look different and say so in words", () => {
  const { run, json } = load({ fixture: "tests/household" });
  const look = s => json(`[statusColor(${s}), band(${s})[1]]`);
  assert.deepEqual(look(4), ["var(--warn)", "Low"]);
  assert.deepEqual(look(39), ["var(--warn)", "Low"]);
  assert.deepEqual(look(40), ["var(--meter)", "Partway"]);
  assert.deepEqual(look(67), ["var(--meter)", "Partway"]);
  assert.deepEqual(look(75), ["var(--good)", "Ready"]);
  assert.deepEqual(look(100), ["var(--good)", "Ready"]);
  const overall = json("model().overall");
  const word = json(`band(${overall})[1]`);
  assert.match(run("viewOverview(model())"), new RegExp(`class="band"><i[^>]*></i>${word}<`));
  run(`S.openKit = "go"`);
  assert.match(run("viewKits(model())"), /class="kit-pct"[^>]*>\d+%<\/span><span class="band">/);
});
