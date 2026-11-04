const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const levels = run => JSON.parse(run(`JSON.stringify(Object.fromEntries(model().results.filter(r => r.hz.group === "health").map(r => [r.hz.id, r.rel])))`));

test("who lives here sets how likely each health emergency is", () => {
  const { run } = load({ fixture: "tests/household" });
  assert.deepEqual(levels(run), {
    cuts: "high", injury: "moderate", fall: "moderate", burns: "moderate", choking: "moderate", heartattack: "low", cardiac: "low",
    poison: "moderate", overdose: "low", co: "moderate", bites: "moderate", anaphylaxis: "high", illness: "moderate", meds: "high",
    asthma: "none", seizure: "none", lowsugar: "none", device: "none",
  });
});

test("two adults with no pets or conditions get lower defaults", () => {
  const { run } = load();
  run(`S.profile = { members: [{ years: 35 }, { years: 37 }], pets: [], vehicles: 1 }`);
  const l = levels(run);
  assert.deepEqual([l.cuts, l.choking, l.poison, l.bites, l.burns, l.anaphylaxis, l.meds], ["moderate", "low", "low", "low", "low", "none", "none"]);
  assert.deepEqual([l.heartattack, l.overdose, l.co, l.asthma, l.seizure], ["low", "low", "low", "none", "none"]);
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

test("seizure and opioid medication count as daily medication, so a closed pharmacy cuts them off", () => {
  const { run } = load();
  for (const c of ["seizures", "opioids"]) {
    run(`S.profile = { members: [{ label: "Kim", years: 30, conditions: [${JSON.stringify(c)}] }], pets: [], vehicles: 0 }`);
    assert.equal(levels(run).meds, "high", c);
    assert.match(run(`buyGuide("medications", 1, "", "home", household()).tip`), /Kim also needs a spare week/, c);
  }
});

test("carbon monoxide is likelier in a house than an apartment", () => {
  const { run } = load();
  const co = home => { run(`S.profile = { members: [{ years: 40 }], pets: [], vehicles: 0, home: ${JSON.stringify(home)} }`); return levels(run).co; };
  assert.deepEqual(["House", "Townhouse", "Mobile home", "Apartment or condo", "Other"].map(co), ["moderate", "moderate", "moderate", "low", "low"]);
});

test("items saved before their supply type existed are offered a move, and moving them counts them", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.profile.members[0].conditions = ["asthma"]; S.items.push(
    { id: "r1", kitId: "go", name: "Albuterol inhaler", category: "medications", qty: 1 },
    { id: "r2", kitId: "home", name: "Kidde CO alarm", category: "poison", qty: 1 },
    { id: "r3", kitId: "go", name: "Aspirin 325 mg", category: "medications", qty: 1 },
    { id: "r4", kitId: "car", name: "Chewable aspirin 81 mg", category: "first_aid", qty: 1 })`);
  assert.deepEqual(json(`refileable().map(x => [x.it.id, x.to])`), [["r1", "breathing"], ["r2", "co_alarm"], ["r4", "aspirin"]]);
  assert.ok(json(`nextActions(model()).acts.some(a => a.kind === "refile")`));
  const before = json(`Object.fromEntries(model().results.map(r => [r.hz.id, r.score]))`);
  run(`ACT.refile()`);
  const after = json(`Object.fromEntries(model().results.map(r => [r.hz.id, r.score]))`);
  assert.deepEqual(json(`S.items.filter(i => /^r/.test(i.id)).map(i => i.category)`), ["breathing", "co_alarm", "medications", "aspirin"]);
  assert.ok(after.asthma > before.asthma && after.co > before.co && after.heartattack > before.heartattack);
  assert.deepEqual(json(`refileable()`), []);
});

test("nitroglycerin is filed as a medication, so it can't stand in for aspirin", () => {
  const { json } = load();
  assert.match(json(`CATS.medications[1]`), /nitroglycerin/);
  assert.doesNotMatch(json(`CATS.aspirin[1]`).replace(/\(.*\)/, ""), /nitroglycerin/);
});
