const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

// A person's own note never scores. When it names a health need that isn't switched on, the page offers
// to switch it on, so a note like "daily blood-pressure medication" can't sit there unscored.
const hints = (run, m) => JSON.parse(run(`JSON.stringify(conditionHints(${JSON.stringify(m)}))`));

test("a note that names a health need suggests switching that need on", () => {
  const { run } = load();
  assert.deepEqual(hints(run, { years: 45, needs: "Daily blood-pressure medication" }), ["meds"]);
  assert.deepEqual(hints(run, { years: 9, needs: "Carries an EpiPen for peanuts, uses an inhaler" }), ["allergy", "asthma"]);
  assert.deepEqual(hints(run, { years: 70, needs: "Uses a CPAP and a walker" }), ["device", "mobility"]);
});

test("no suggestion once the need is on, when the note says no, or for things that aren't health needs", () => {
  const { run } = load();
  assert.deepEqual(hints(run, { years: 45, needs: "Daily blood-pressure medication", conditions: ["meds"] }), []);
  assert.deepEqual(hints(run, { years: 45, needs: "No medications, no allergies" }), []);
  assert.deepEqual(hints(run, { years: 45, needs: "Glasses, heartburn after spicy food" }), []);
  // Diabetes already counts as daily medication, so "insulin pills" doesn't ask for that again.
  assert.deepEqual(hints(run, { years: 60, needs: "Insulin and metformin pills", conditions: ["diabetes"] }), []);
});

test("the household tab offers the suggestion, and taking it switches the need on for that person", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.profile.members[0].needs = "Daily blood-pressure medication"; S.hhDirty = false; syncDraft(); S.view = "household"`);
  const before = run("viewHousehold()");
  assert.match(before, /data-act="condAdd" data-i="0" data-k="meds"/);
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

test("each health emergency says which facts about the household rate it", () => {
  const { run } = load({ fixture: "tests/household" });
  assert.equal(why(run, "choking"), "Your household includes 2 children aged 3 to 12 and 1 child under 3.");
  assert.equal(why(run, "bites"), "Your household includes 2 children aged 3 to 12 and 1 pet.");
  assert.equal(why(run, "meds"), "Your household includes someone on daily medication.");
  assert.equal(why(run, "co"), "You live in a house.");
  assert.equal(why(run, "injury"), "Every household faces this, whoever lives there.");
  assert.equal(why(run, "heartattack"), "Nobody here has a known risk factor for it.");
});

test("a rating the household set itself says so, then gives the facts", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.hazards.levels = { choking: "high", bites: "moderate" }`);
  assert.equal(why(run, "choking"), "You rated this high. Your household includes 2 children aged 3 to 12 and 1 child under 3.");
  // Set to what it would be anyway: nothing to point out.
  assert.equal(why(run, "bites"), "Your household includes 2 children aged 3 to 12 and 1 pet.");
});

test("the hazards list on the household tab never leaves a household-rated emergency blank", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.hazards.levels = { earthquake: "moderate", choking: "high", fall: "high" }; S.hazards.reasons = { earthquake: "Faults nearby." }; syncDraft(); S.view = "household"`);
  const html = run("viewHousehold()");
  const rows = [...html.matchAll(/<div><span><b>([^<]+)<\/b><br><span class="mono small">[^<]*<\/span><\/span><span>([^<]*)<\/span><\/div>/g)].map(m => [m[1], m[2]]);
  assert.deepEqual(rows.map(r => r[0]).sort(), ["Choking", "Earthquake", "Falls, sprains and broken bones"]);
  for (const [name, text] of rows) assert.ok(text.trim(), `${name} has no reason`);
  assert.ok(rows.find(r => r[0] === "Earthquake")[1] === "Faults nearby.");
});

test("the readiness detail for a health emergency explains its rating", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.openHz = new Set(["choking"])`);
  const html = run(`(M => hzRow(M.results.find(r => r.hz.id === "choking"), M.h, M))(model())`);
  assert.match(html, /Your household includes 2 children aged 3 to 12 and 1 child under 3\./);
});
