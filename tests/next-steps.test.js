// The next best step on Readiness, a kit's last-checked date, the Ordered mark on a shopping line and the Replace
// line for an item going out of date.
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const text = h => h.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const step = app => app.json("nextStep(model())");
const ym = months => { const d = new Date(); d.setMonth(d.getMonth() + months); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

test("the next best step is the gap worth the most points, then the line worth the most once it is on the list", () => {
  const app = load({ fixture: "tests/household" });
  const best = app.json(`(() => { const M = model(); return splitListed(M.gaps).off.map(g => [gapName(g), gapGain(M, g)]).sort((a, b) => b[1] - a[1])[0]; })()`);
  let s = step(app);
  assert.equal(s.t, `Get ${best[0]}`);
  assert.match(s.d, new RegExp(`^\\+${best[1]} pts?, the most of anything you're missing`));
  assert.match(s.btn, /^data-act="shopAdd" data-cat="/);
  const html = app.run(`viewOverview(model())`);
  assert.match(html, /<section class="panel next" id="next-step"/);
  assert.ok(html.indexOf('id="next-step"') < html.indexOf('class="panel sum"'), "the card is above the score");

  // Its button plans it, and the step is then to buy it
  app.run(`ACT.shopAdd({ dataset: { cat: ${JSON.stringify(app.json("nextStep(model()).btn").match(/data-cat="([^"]*)"/)[1])}, essential: ${JSON.stringify((s.btn.match(/data-essential="([^"]*)"/) || [])[1])} } })`);
  s = step(app);
  const top = app.json(`shopItems().map(e => shopInfo(e, model())).sort((a, b) => b.gain - a.gain)[0]`);
  assert.equal(s.t, `${top.price === 0 ? "From home" : "Buy"}: ${top.line}`);
  assert.equal(s.btn, `data-act="shopOpen"`);

  // A line that's ordered is no longer the thing to do
  app.run(`ACT.shopOrdered({ dataset: { id: shopItems()[0].id } })`);
  assert.doesNotMatch(step(app).t, /^(Buy|From home): /);
});

test("with no kits the step is to add one, and someone who can't write sees no step", () => {
  const app = load({ fixture: "tests/household" });
  app.run("S.canWrite = false");
  assert.equal(step(app), null);
  assert.doesNotMatch(app.run("viewOverview(model())"), /next-step/);
  app.run("S.canWrite = true; S.kits = []; HOUSEHOLD.kits = S.kits; S.items = []; HOUSEHOLD.items = S.items");
  assert.equal(step(app).t, "Add your first kit");
});

test("when nothing is missing the step is an item going out of date, then a kit not looked through, then the plan", () => {
  const app = load({ fixture: "tests/household" });
  // Nothing to buy: every gap is on the list and ordered
  app.run(`ACT.shopAddAll(); S.shopping = { items: shopItems().map(e => ({ ...e, ordered: 1 })) }; HOUSEHOLD.shopping = S.shopping`);
  let s = step(app);
  assert.match(s.t, /^Replace /, "the fixture has an expired item");
  assert.match(s.btn, /data-act="shopReplace"/);
  app.run(`S.items = S.items.map(i => ({ ...i, expires: "" })); HOUSEHOLD.items = S.items`);
  s = step(app);
  assert.match(s.t, /^Look through /);
  assert.match(s.d, /No check is recorded/);
  app.run(`S.kits = S.kits.map(k => ({ ...k, checkedAt: Date.now() })); HOUSEHOLD.kits = S.kits; S.plan = {}; HOUSEHOLD.plan = S.plan`);
  assert.equal(step(app).t, "Finish your family plan");
  app.run(`S.plan = Object.fromEntries(PLAN.map(([k]) => [k, "x"])); HOUSEHOLD.plan = S.plan`);
  assert.equal(step(app), null);
});

test("a kit says when it was last checked: saving a photo read stamps it, and so does saying so", async () => {
  const app = load({ fixture: "tests/household" });
  const raw = () => app.run(`checkedLine(S.kits.find(k => k.id === "go"))`), line = () => text(raw().match(/<span id="kit-chk-t"[^>]*>(.*?)<\/span>/)[1]);
  assert.equal(line(), "No check recorded yet");
  assert.match(raw(), /data-act="kitChecked" data-id="go">I checked it today</);
  assert.match(app.run(`S.view = "kits"; S.openKit = "go"; viewKits(model())`), /class="small kit-chk"/, "it is on the kit's page");
  await app.run(`ACT.kitChecked({ dataset: { id: "go" } })`);
  assert.ok(Date.now() - app.run(`S.kits.find(k => k.id === "go").checkedAt`) < 5000);
  assert.equal(line(), "Checked today");
  assert.doesNotMatch(raw(), /kitChecked/, "the button goes once it's checked today");

  // Seven months on it asks to be looked through again
  app.run(`S.kits = S.kits.map(k => k.id === "go" ? { ...k, checkedAt: Date.now() - 215 * 864e5 } : k); HOUSEHOLD.kits = S.kits`);
  assert.match(line(), /^Last checked .*, 7 months ago\. Time to look through it again$/);
  assert.match(raw(), /class="small kit-chk stale"/);

  // A saved photo read with no new photos still counts as a check
  app.run(`S.draft = { kitId: "go", rows: [], photoIds: [] }`);
  await app.run("saveDraft()");
  assert.equal(line(), "Checked today");
});

test("a line marked ordered stays open, says so, waits at the end and is left off the shared list; ticking it clears the mark", async () => {
  const app = load({ fixture: "tests/household" });
  app.run("ACT.shopAddAll()");
  const id = app.run(`shopItems().find(e => shopKit(e) && shopInfo(e, model()).price > 0).id`);
  const n = app.run("shopItems().length");
  app.run(`ACT.shopOrdered({ dataset: { id: "${id}" } })`);
  const e = app.json(`shopItems().find(e => e.id === "${id}")`);
  assert.ok(e.ordered > 0 && !e.done);
  const row = app.run(`(() => { const M = model(), e = shopItems().find(e => e.id === "${id}"); return shopRow(e, shopInfo(e, M)); })()`);
  assert.match(text(row), /Ordered .*\. Tick it when it arrives/);
  assert.match(row, /data-act="shopOrdered"[^>]*aria-pressed="true"[^>]*>Not ordered</);
  assert.equal(app.run(`(() => { const M = model(); return shopPlan(M, shopItems().filter(e => !e.done)).order.at(-1).id; })()`), id, "it waits at the end");
  assert.match(text(app.run(`(() => { const M = model(), left = shopItems().filter(e => !e.done); return shopTools(M, shopPlan(M, left)); })()`)), new RegExp(`^${n - 1} to buy · 1 ordered`));
  assert.match(text(app.run("viewOverview(model())")), new RegExp(`Shopping list · ${n - 1} to buy · 1 ordered`));
  // Nothing free from home can be ordered
  const free = app.run(`(() => { const M = model(), e = shopItems().find(e => shopInfo(e, M).price === 0); return e ? shopRow(e, shopInfo(e, M)) : ""; })()`);
  assert.doesNotMatch(free, /shopOrdered/);

  await app.run(`shopTick("${id}", true)`);
  const done = app.json(`shopItems().find(e => e.id === "${id}")`);
  assert.equal(done.done, true);
  assert.equal("ordered" in done, false);

  // Pressed again, the mark comes off
  const other = app.run(`shopItems().find(e => !e.done && shopInfo(e, model()).price > 0).id`);
  app.run(`ACT.shopOrdered({ dataset: { id: "${other}" } }); ACT.shopOrdered({ dataset: { id: "${other}" } })`);
  assert.equal(app.run(`"ordered" in shopItems().find(e => e.id === "${other}")`), false);
});

test("an expired item's Replace line is worth the points the item is, and ticking it makes the item count again without adding one", async () => {
  const app = load({ fixture: "tests/household" });
  const old = app.json(`model().exp.find(x => x.st === "expired").it`);
  const html = app.run("viewOverview(model())");
  assert.match(html, new RegExp(`data-act="shopReplace" data-id="${old.id}"[^>]*>Replace<`));
  app.run(`ACT.shopReplace({ dataset: { id: "${old.id}" } })`);
  app.run(`ACT.shopReplace({ dataset: { id: "${old.id}" } })`);
  assert.equal(app.run(`shopItems().filter(e => e.replaces === "${old.id}").length`), 1, "once per item");
  assert.match(app.run("viewOverview(model())"), /class="small muted exp-on">On your list</);
  const line = app.json(`shopItems().find(e => e.replaces === "${old.id}")`);
  assert.equal(line.kitId, old.kitId);
  const info = app.json(`shopInfo(shopItems().find(e => e.replaces === "${old.id}"), model())`);
  assert.equal(info.line, `Replace ${old.name}`);
  assert.equal(info.sub, `Expired ${old.expires}`);

  // The same item with a date still to come counts already: the row promises exactly what ticking adds
  const before = app.run("model().overall"), items = app.run("S.items.length");
  const asNew = app.run(`(() => { const its = S.items; S.items = its.map(i => i.id === "${old.id}" ? { ...i, expires: "" } : i); HOUSEHOLD.items = S.items; const o = model().overall; S.items = its; HOUSEHOLD.items = its; return o; })()`);
  assert.equal(info.gain, asNew - before);
  assert.equal(app.run(`scoreIfBought(shopItems().filter(e => !e.done), model())`), asNew, "and the list's total counts it once");
  await app.run(`shopTick("${line.id}", true)`);
  assert.equal(app.run("model().overall"), asNew);
  assert.equal(app.run("S.items.length"), items, "no second item");
  assert.equal(app.run(`S.items.find(i => i.id === "${old.id}").expires`), "");
  const done = app.json(`shopItems().find(e => e.id === "${line.id}")`);
  assert.equal(done.done, true);
  assert.equal(done.wasExp, old.expires);
  assert.match(text(app.run(`(() => { const M = model(), e = shopItems().find(e => e.id === "${line.id}"); return shopRow(e, shopInfo(e, M)); })()`)), new RegExp(`^Replace ${old.name}`));

  // Unticked, the item has its old date again
  await app.run(`shopTick("${line.id}", false)`);
  assert.equal(app.run(`S.items.find(i => i.id === "${old.id}").expires`), old.expires);
  assert.equal(app.run("model().overall"), before);
});

test("a Replace line for an item not yet expired adds no points and hides no gap", () => {
  const app = load({ fixture: "tests/household" });
  // An item in a category the household is still short of, going out of date next month
  const it = app.json(`(() => { const M = model(), g = M.gaps.find(g => !g.essential && S.items.some(i => i.category === g.cat && !i.expires)); return S.items.find(i => i.category === g.cat && !i.expires); })()`);
  app.run(`S.items = S.items.map(i => i.id === "${it.id}" ? { ...i, expires: "${ym(1)}" } : i); HOUSEHOLD.items = S.items`);
  assert.equal(app.run(`expState(S.items.find(i => i.id === "${it.id}"))`), "soon");
  const off = app.run("splitListed(model().gaps).off.length");
  app.run(`ACT.shopReplace({ dataset: { id: "${it.id}" } })`);
  const info = app.json(`shopInfo(shopItems().at(-1), model())`);
  assert.equal(info.gain, 0);
  assert.equal(info.sub, `Expires ${ym(1)}`);
  assert.equal(app.run("splitListed(model().gaps).off.length"), off, "the gap in its category is still not on the list");
  assert.equal(app.run("scoreIfBought(shopItems(), model())"), app.run("model().overall"));
  // Once the item is gone the line is an ordinary one for the same thing
  app.run(`S.items = S.items.filter(i => i.id !== "${it.id}"); HOUSEHOLD.items = S.items`);
  assert.equal(app.run("splitListed(model().gaps).off.length"), off - 1);
});

test("the plan's contact fields have labels that stay when typed in, and costs spell out what has no price", () => {
  const app = load({ fixture: "tests/household" });
  const hh = app.run(`hhContact({ contactName: "Aunt Rosa", contactPhone: "555 0100" })`);
  assert.match(hh, /<label class="plan-l"><span class="k">Out-of-area contact<\/span><input type="text"[^>]*id="plan-contactName"/);
  assert.match(hh, /<label class="plan-l"><span class="k">Their phone<\/span><input type="tel"[^>]*id="plan-contactPhone"/);
  assert.equal(text(app.run(`costCell({ total: 648, unpriced: 2 })`)), "$648+2 unpriced");
  assert.equal(text(app.run(`costCell({ total: 648, unpriced: 0 })`)), "$648");
});
