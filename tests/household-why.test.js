const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

// A person's own note never scores. When it names a health need that isn't switched on, the page offers
// to switch it on, so a note like "daily blood-pressure medication" can't sit there unscored.
const hints = (run, needs, conditions) => JSON.parse(run(`JSON.stringify(conditionHints(${JSON.stringify({ years: 45, needs, conditions })}))`));

test("a note that names a health need suggests switching that need on", () => {
  const { run } = load();
  const cases = {
    "Daily blood-pressure medication": ["meds"],
    "Carries an EpiPen for peanuts, uses an inhaler": ["allergy", "asthma"],
    "Uses a CPAP and a walker": ["device", "mobility"],
    "Uses oxygen at night": ["device"],
    "Takes oxycodone after surgery": ["opioids"],
    "Heart condition": ["heart"],
  };
  for (const [note, want] of Object.entries(cases)) assert.deepEqual(hints(run, note), want, note);
});

test("no suggestion for a note that says no, however the phone types the apostrophe", () => {
  const { run } = load();
  for (const note of ["No medications, no allergies", "Doesn't take any medication", "Doesn’t take any medication",
    "Isn’t on any meds", "Off meds since spring", "Stopped her pills", "non-diabetic"]) assert.deepEqual(hints(run, note), [], note);
});

test("no suggestion for words that only look like a health need", () => {
  const { run } = load();
  for (const note of ["Prescription glasses", "Vitamin pills", "Knows where the medicine cabinet is", "Loves candy canes",
    "Dog walker", "Heart of gold", "Heart healthy diet", "Full mobility", "Oxytocin", "Glasses, heartburn after spicy food"]) assert.deepEqual(hints(run, note), [], note);
});

test("no suggestion for a need that is already on, or already counted as daily medication", () => {
  const { run } = load();
  assert.deepEqual(hints(run, "Daily blood-pressure medication", ["meds"]), []);
  assert.deepEqual(hints(run, "Insulin and daily pills", ["diabetes"]), []);
});

test("the household tab offers the suggestion, and taking it switches the need on for that person", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.profile.members[0].needs = "Daily blood-pressure medication"; S.hhDirty = false; syncDraft(); S.view = "household"`);
  assert.match(run("viewHousehold()"), /data-act="condAdd" data-i="0" data-k="meds"/);
  run(`ACT.condAdd({ dataset: { i: "0", k: "meds" } })`);
  assert.deepEqual(json("S.hhDraft.members[0].conditions"), ["meds"]);
  assert.equal(run("S.hhDirty"), true);
  assert.doesNotMatch(run("viewHousehold()"), /data-act="condAdd" data-i="0"/);
  // Nothing is saved until Save, and a read-only viewer sees no suggestion.
  assert.equal(json("S.profile.members[0].conditions ?? null"), null);
  run(`S.hhDraft.members[0].conditions = []; S.canWrite = false`);
  assert.doesNotMatch(run("viewHousehold()"), /data-act="condAdd"/);
});

// Health and everyday emergencies are rated from who lives here, never by the location check, so the
// check writes no reason for them. The page says which facts about the household set the rating.
const why = (run, id) => run(`householdWhy(HAZARDS.find(x => x.id === ${JSON.stringify(id)}), household())`);

test("each health emergency names the facts about the household that raise it, and only those", () => {
  const { run } = load({ fixture: "tests/household" });
  const choking = why(run, "choking");
  assert.match(choking, /2 children aged 3 to 12/);
  assert.match(choking, /1 child under 3/);
  assert.doesNotMatch(choking, /pet|medication/);
  assert.match(why(run, "bites"), /1 pet/);
  assert.match(why(run, "meds"), /daily medication/);
  assert.match(why(run, "co"), /house/);
  assert.doesNotMatch(why(run, "co"), /children/);
});

test("an emergency no household fact raises still gets a reason, different for common and unlikely ones", () => {
  const { run } = load({ fixture: "tests/household" });
  const everyone = why(run, "injury"), nobody = why(run, "heartattack");
  assert.ok(everyone && nobody);
  assert.notEqual(everyone, nobody);
  run(`S.profile.home = "Apartment or condo"`);
  assert.equal(why(run, "co"), nobody, "carbon monoxide in an apartment has no household or home risk");
  assert.ok(why(run, "mishap"));
  assert.notEqual(why(run, "mishap"), everyone, "a road emergency doesn't apply to every household");
});

test("a rating the household set itself leads, with what who lives here would make it", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.hazards.levels = { choking: "high", bites: "moderate", meds: "none" }`);
  assert.match(why(run, "choking"), /^You rated this high \(moderate from who lives here\)\./);
  assert.match(why(run, "choking"), /1 child under 3/);
  assert.match(why(run, "meds"), /not relevant \(high from who lives here\)/);
  // Set to what it would be anyway: nothing to point out.
  assert.doesNotMatch(why(run, "bites"), /You rated/);
  // Without a vehicle, a road emergency says only that.
  run(`S.hazards.levels.mishap = "high"; S.profile.vehicles = 0`);
  assert.doesNotMatch(why(run, "mishap"), /You rated/);
});

test("the hazards list on the household tab never leaves a household-rated emergency blank", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.hazards.levels = { earthquake: "moderate", choking: "high", fall: "high", wildfire: "extreme" }; S.hazards.reasons = { earthquake: "Faults nearby." }; syncDraft(); S.view = "household"`);
  // A saved level the page doesn't know ("extreme") is left out, not a crash.
  const html = run("viewHousehold()");
  const rows = [...html.matchAll(/<div><span><b>([^<]+)<\/b><br><span class="mono small">[^<]*<\/span><\/span><span>([^<]*)<\/span><\/div>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(rows.map(r => r[0]).sort(), ["Choking", "Earthquake", "Falls, sprains and broken bones"]);
  for (const [name, text] of rows) assert.ok(text.trim(), `${name} has no reason`);
  assert.equal(rows.find(r => r[0] === "Earthquake")[1], "Faults nearby.");
});

test("the readiness detail for a health emergency explains its rating", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.openHz = new Set(["choking"])`);
  const html = run(`(M => hzRow(M.results.find(r => r.hz.id === "choking"), M.h, M))(model())`);
  assert.match(html, /1 child under 3/);
});
