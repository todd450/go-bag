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
