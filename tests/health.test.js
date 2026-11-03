const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const levels = run => JSON.parse(run(`JSON.stringify(Object.fromEntries(model().results.filter(r => r.hz.group === "health").map(r => [r.hz.id, r.rel])))`));

test("who lives here sets how likely each health emergency is", () => {
  const { run } = load({ fixture: "tests/household" });
  assert.deepEqual(levels(run), {
    cuts: "high", injury: "moderate", fall: "moderate", burns: "moderate", choking: "moderate", cardiac: "low",
    poison: "moderate", bites: "moderate", anaphylaxis: "high", illness: "moderate", meds: "high", lowsugar: "none", device: "none",
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
  assert.deepEqual([l.lowsugar, l.cardiac, l.device, l.meds], ["high", "moderate", "high", "high"]);
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
