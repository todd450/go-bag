// The Household tab holds who lives here, where, the family plan and Claude's review, as cards that edit in place.
// Each field saves as you leave it (no Save button), a medication shows on the card of the person who takes it, and
// health needs are chips with a picker on each person's card. The wizard keeps its own save at its last step.
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const tab = app => { app.run(`syncDraft(); S.view = "household"`); return app.run("viewHousehold()"); };
// Each person's or pet's card, in order
const cards = html => html.split(`<div class="hh-card`).slice(1).filter(c => !c.startsWith(` hh-add`));
// The local calendar date n days on, as the page counts days: toISOString would give the UTC date, a day ahead in the evening west of UTC
const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(v => String(v).padStart(2, "0")).join("-"); };
const ids = html => [...html.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);

test("a card for each person and pet, with health needs as chips, and no form or Save button", () => {
  const app = load({ fixture: "tests/household" }), html = tab(app), cs = cards(html);
  assert.equal(cs.length, 6, "five people and the dog");
  assert.match(cs[1], /value="Sam"/);
  assert.match(cs[1], /class="chip hn"[^>]*>[\s\S]*?Daily medication<\/button>/, "Sam's daily medication is a chip");
  assert.match(cs[3], /Severe allergy<\/(button|span)>/, "and Riley's allergy");
  assert.match(cs[4], /Diapers, formula, wipes/, "Casey, 2, is sized as a toddler");
  assert.match(cs[5], /value="Dog"/);
  assert.doesNotMatch(html, /<form|Save household|data-submit/, "nothing to submit");
  assert.match(html, /Plan 0 of 8/);
  assert.deepEqual(ids(html).filter((x, i, a) => a.indexOf(x) !== i), [], "every id once");
});

test("a medication shows on its person's card with its refill, and one for nobody listed asks who", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.plan = { meetNear: "The oak", meds: [{ who: "Sam", name: "Lisinopril", refill: "${inDays(5)}" }, { who: "Morgan", name: "Insulin", refill: "" }] }`);
  const html = tab(app), cs = cards(html);
  assert.match(cs[1], /id="med-0-name" value="Lisinopril"/);
  assert.match(cs[1], /class="st warn"[\s\S]*Refill due in 5 days/);
  assert.ok(cs.every((c, i) => i === 1 || !/Lisinopril/.test(c)), "on Sam's card only");
  assert.match(html, /Medication not matched to anyone here[\s\S]*Insulin[\s\S]*id="med-1-who"/, "Insulin asks who takes it");
  assert.match(html, /Plan 1 of 8/);
  assert.deepEqual(ids(html).filter((x, i, a) => a.indexOf(x) !== i), []);
});

test("adding a medication from a card makes it that person's", async () => {
  const app = load({ fixture: "tests/household" });
  assert.match(cards(tab(app))[1], /data-act="planMedAdd" data-who="Sam"/, "Sam takes daily medication, so the card offers one");
  assert.doesNotMatch(cards(tab(app))[0], /planMedAdd/, "Alex doesn't");
  await app.run(`ACT.planMedAdd({ dataset: { who: "Sam" } })`);
  assert.deepEqual(app.json("S.plan.meds"), [{ who: "Sam", name: "", refill: "" }]);
});

test("a household field saves when you leave it; in the wizard it waits for the last step", async () => {
  const app = load({ fixture: "tests/household" });
  tab(app);
  const field = { dataset: { input: "hh", p: "location" }, value: "Eugene, OR", type: "text" };
  await app.fire("input", field);
  assert.equal(app.run("S.profile.location"), "Springfield, OR", "typing alone saves nothing");
  await app.fire("change", field);
  assert.equal(app.run("S.profile.location"), "Eugene, OR");
  assert.equal(app.run("S.hhDirty"), false);
  // The wizard
  app.run(`S.wiz = 0`);
  await app.fire("input", { ...field, value: "Bend, OR" });
  await app.fire("change", { ...field, value: "Bend, OR" });
  assert.equal(app.run("S.profile.location"), "Eugene, OR", "the wizard holds it");
  assert.equal(app.run("S.hhDraft.location"), "Bend, OR");
});

test("what you type in the next field while one saves is kept, and saves when you leave that field", async () => {
  const app = load({ fixture: "tests/household" });
  tab(app);
  app.run(`setDoc = (f => (...a) => { if (a[1] === "profile") S.hhDraft.members[0].label = "Alexa"; return f(...a); })(setDoc)`);
  await app.fire("input", { dataset: { input: "hh", p: "location" }, value: "Eugene, OR", type: "text" });
  await app.fire("change", { dataset: { input: "hh", p: "location" }, value: "Eugene, OR", type: "text" });
  assert.equal(app.run("S.hhDraft.members[0].label"), "Alexa", "the draft keeps it");
  assert.equal(app.run("S.hhDirty"), true, "and still has it to save");
});

test("renaming someone keeps their medications theirs", async () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.plan = { meds: [{ who: "Sam", name: "Lisinopril", refill: "" }, { who: "Alex", name: "Vitamin D", refill: "" }] }`);
  tab(app);
  await app.fire("input", { dataset: { input: "hh", p: "members.1.label" }, value: "Samuel", type: "text" });
  await app.fire("change", { dataset: { input: "hh", p: "members.1.label" }, value: "Samuel", type: "text" });
  assert.deepEqual(app.json("S.plan.meds.map(x => x.who)"), ["Samuel", "Alex"]);
  assert.match(cards(app.run("viewHousehold()"))[1], /Lisinopril/);
});

test("a person's health needs open from their card, and each tick saves", async () => {
  const app = load({ fixture: "tests/household" });
  assert.doesNotMatch(tab(app), /id="hh-m2-c-meds"/, "closed to start");
  app.run(`ACT.condPick({ dataset: { i: "2" } })`);
  const html = app.run("viewHousehold()");
  assert.match(cards(html)[2], /id="hh-m2-c-asthma"/, "Jordan's picker is on Jordan's card");
  assert.equal([...html.matchAll(/class="hh-pick"/g)].length, 1, "one picker at a time");
  await app.fire("change", { dataset: { change: "hhCond", i: "2", k: "asthma" }, checked: true });
  assert.deepEqual(app.json("S.profile.members[2].conditions"), ["asthma"]);
  assert.match(cards(app.run("viewHousehold()"))[2], /Asthma or COPD<\/button>/);
  app.run(`ACT.condPick({ dataset: { i: "2" } })`);
  assert.doesNotMatch(app.run("viewHousehold()"), /class="hh-pick"/, "a second tap closes it");
});

test("removing someone saves at once, and Undo puts them back where they were", async () => {
  const app = load({ fixture: "tests/household" });
  tab(app);
  await app.run(`ACT.hhDel({ dataset: { k: "members", i: "2" } })`);
  assert.deepEqual(app.json("S.profile.members.map(m => m.label)"), ["Alex", "Sam", "Riley", "Casey"]);
  await app.run(`toastAction.run()`);
  assert.deepEqual(app.json("S.profile.members.map(m => m.label)"), ["Alex", "Sam", "Jordan", "Riley", "Casey"]);
  await app.run(`ACT.hhAdd({ dataset: { k: "pets" } })`);
  assert.equal(app.json("S.profile.pets.length"), 2, "a new pet saves straight away too");
});

test("the place strip shows the three likeliest emergencies, and asks for a new check when the town changes", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.hazards = { levels: { wildfire: "high", earthquake: "moderate", flood: "low", winter: "moderate", tornado: "none" }, reasons: {}, assessedAt: 1, location: "Springfield, OR" }`);
  const strip = tab(app).match(/<div class="hh-likely">([\s\S]*?)<\/div>/)?.[1] || "";
  const named = [...strip.matchAll(/<\/span>([^<]+)<\/span>/g)].map(m => m[1]);
  assert.equal(named.length, 3);
  assert.equal(named[0], app.run(`esc(HZ.wildfire.name)`), "the high one first");
  assert.ok(!named.includes(app.run(`esc(HZ.tornado.name)`)));
  assert.match(tab(app), />Check again</);
  app.run(`S.profile.location = "Bend, OR"`);
  assert.match(tab(app), /Check hazards for Bend, OR/);
});

test("a viewer who can't edit sees the household and plan with nothing to change", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.canWrite = false; S.plan = { meetNear: "The oak", meds: [{ who: "Sam", name: "Lisinopril", refill: "" }] }`);
  const html = tab(app);
  assert.doesNotMatch(html, /data-act="(hhAdd|hhDel|condPick|planMedAdd|planMedDel|startWizard)"/);
  for (const [, tag] of html.matchAll(/(<(?:input|select|textarea)\b[^>]*>)/g)) assert.match(tag, /\bdisabled\b/, tag);
});
