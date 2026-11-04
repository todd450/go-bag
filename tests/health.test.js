const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const levels = run => JSON.parse(run(`JSON.stringify(Object.fromEntries(model().results.filter(r => r.hz.group === "health").map(r => [r.hz.id, r.rel])))`));

test("who lives here sets how likely each health emergency is", () => {
  const { run } = load({ fixture: "tests/household" });
  assert.deepEqual(levels(run), {
    cuts: "high", injury: "moderate", fall: "moderate", burns: "moderate", choking: "moderate", heartattack: "low", cardiac: "low",
    poison: "moderate", overdose: "low", co: "low", bites: "moderate", anaphylaxis: "high", illness: "moderate", meds: "high",
    asthma: "none", seizure: "none", lowsugar: "none", device: "none",
  });
});

test("two adults with no pets or conditions get lower defaults", () => {
  const { run } = load();
  run(`S.profile = { members: [{ years: 35 }, { years: 37 }], pets: [], vehicles: 1 }`);
  const l = levels(run);
  assert.deepEqual([l.cuts, l.choking, l.poison, l.bites, l.burns, l.anaphylaxis, l.meds], ["moderate", "low", "low", "low", "low", "none", "none"]);
});

test("diabetes, a heart condition and a medical device switch on their emergencies", () => {
  const { run } = load();
  run(`S.profile = { members: [{ years: 70, conditions: ["diabetes", "heart", "device"] }], pets: [], vehicles: 0 }`);
  const l = levels(run);
  assert.deepEqual([l.lowsugar, l.heartattack, l.cardiac, l.device, l.meds], ["high", "moderate", "moderate", "high", "high"]);
});

test("asthma, seizures and opioid medication switch on their emergencies, with rescue medicine for each person", () => {
  const { run, json } = load();
  run(`S.profile = { members: [{ years: 40, conditions: ["opioids"] }, { years: 12, conditions: ["asthma", "seizures"] }, { years: 8, conditions: ["asthma"] }], pets: [], vehicles: 0 }`);
  const l = levels(run);
  assert.deepEqual([l.asthma, l.seizure, l.overdose], ["high", "high", "moderate"]);
  const need = (id, cat) => json(`model().results.find(r => r.hz.id === ${JSON.stringify(id)}).rows.find(x => x.cat === ${JSON.stringify(cat)}).need`);
  assert.equal(need("asthma", "breathing"), 2);
  assert.equal(need("seizure", "seizure"), 1);
});

test("everyday pain relievers don't count as an inhaler, aspirin or naloxone", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.profile.members[0].conditions = ["asthma"]`);
  const scores = () => json(`Object.fromEntries(model().results.filter(r => ["asthma", "heartattack", "overdose"].includes(r.hz.id)).map(r => [r.hz.id, r.score]))`);
  const before = scores();
  run(`S.items.push({ id: "m1", kitId: "go", name: "Ibuprofen", category: "medications", qty: 3 })`);
  assert.deepEqual(scores(), before);
  run(`S.items.push({ id: "m2", kitId: "go", name: "Albuterol inhaler", category: "breathing", qty: 1 })`);
  assert.ok(scores().asthma > before.asthma);
});

test("a carbon monoxide alarm counts in the home supply, not in a go-bag", () => {
  const { run, json } = load({ fixture: "tests/household" });
  const co = () => json(`model().results.find(r => r.hz.id === "co").score`);
  run(`S.items.push({ id: "a1", kitId: "go", name: "CO alarm", category: "co_alarm", qty: 1 })`);
  assert.equal(co(), 0);
  run(`S.items.find(i => i.id === "a1").kitId = "home"`);
  assert.equal(co(), 100);
});

test("the location check never rates health or everyday emergencies", () => {
  const { run, json } = load();
  const prompt = run("hazardPrompt()");
  for (const id of json(`HAZARDS.filter(h => h.group).map(h => h.id)`)) assert.ok(!prompt.includes(`\n${id} — `), id);
});

test("every supply type an emergency needs has a label and an icon", () => {
  const { json } = load();
  assert.deepEqual(json(`[...new Set(HAZARDS.flatMap(h => h.needs))].filter(c => !CATS[c] || !ICONS[c])`), []);
});
