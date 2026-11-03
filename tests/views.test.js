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

test("each tab opens with one short line, and the full explanation sits behind How this works", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`syncDraft(); S.openKit = "go"`);
  const words = html => html.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length;
  const pages = { score: "viewOverview(model())", "kit-table": "viewKits(model())", household: "viewHousehold()", shop: "viewShop(model())", plan: "viewPlan(model())", review: "viewPlan(model())" };
  for (const [id, view] of Object.entries(pages)) {
    const html = run(view);
    assert.match(html, new RegExp(`<details class="how" data-how="${id}" ><summary>How this works</summary><p>[^<]{60,}`), id);
    const intro = html.match(new RegExp(`<p class="(?:small )?muted"[^>]*>((?:(?!</p>)[\\s\\S])*)</p>\\s*<details class="how" data-how="${id}"`));
    assert.ok(intro, `${id} has a line right before it`);
    assert.ok(words(intro[1]) <= 15, `${id} intro is ${words(intro[1])} words`);
  }
  run(`S.how.add("shop")`);
  assert.match(run("viewShop(model())"), /data-how="shop" open>/, "an opened explanation stays open on re-render");
});
