const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");

// The named essentials are a stored contract: an item doc's `essential` holds one of these ids, so they
// never change once shipped. New ids may be added; this pins the ones the founder's item docs can hold.
const CONTRACT = {
  documents: [["id_copies", "ID copies"], ["insurance", "Insurance cards"], ["cash", "Cash"], ["records", "Records (USB or printed)"]],
  fire_safety: [["extinguisher", "Fire extinguisher"], ["fire_blanket", "Fire blanket"], ["escape_ladder", "Escape ladder"]],
  communication: [["radio", "Emergency radio"], ["whistle", "Whistle"], ["contact_list", "Printed contact list"]],
  tools: [["multitool", "Multi-tool or knife"], ["duct_tape", "Duct tape"], ["shutoff_wrench", "Utility shut-off wrench"], ["fire_starter", "Lighter or matches"]],
  medications: [["pain_reliever", "Pain or fever reliever"], ["allergy_med", "Allergy medicine"], ["prescriptions"]],
};

const scenarios = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

test("the essentials list has the five checklist categories, with their ids and labels in order", () => {
  const { json } = load();
  const E = json("ESSENTIALS");
  assert.deepEqual(Object.keys(E), Object.keys(CONTRACT));
  for (const [cat, list] of Object.entries(CONTRACT)) {
    assert.deepEqual(E[cat].map(e => e.id), list.map(([id]) => id), cat);
    for (const [i, [id, label]] of list.entries()) {
      assert.equal(typeof E[cat][i].label, "string", id);
      assert.ok(E[cat][i].label.trim(), id);
      if (label) assert.equal(E[cat][i].label, label, id);
    }
  }
});

test("every essential belongs to a real category and no id repeats, is blank or is the reserved \"none\"", () => {
  const { json } = load();
  const E = json("ESSENTIALS"), cats = json("Object.keys(CATS)");
  const ids = Object.values(E).flat().map(e => e.id);
  for (const c of Object.keys(E)) assert.ok(cats.includes(c), c);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.equal(typeof id, "string");
    assert.ok(id.trim() && id !== "none", id);
  }
});

test("an item's tag counts only when it is an id on its current category's list", () => {
  const { json } = load();
  const of = item => json(`essentialOf(${JSON.stringify(item)})`);
  for (const [cat, list] of Object.entries(CONTRACT)) {
    for (const [id] of list) assert.equal(of({ category: cat, essential: id }), id, `${cat}/${id}`);
    assert.equal(of({ category: cat, essential: "none" }), "none", cat);
    // An id from every other category reads as untagged here, so moving an item needs no second write.
    for (const [other, ol] of Object.entries(CONTRACT)) if (other !== cat) for (const [id] of ol) assert.equal(of({ category: cat, essential: id }), "", `${cat}/${id}`);
    for (const bad of ["flare_gun", "Cash", " cash", "", "toString", "constructor", "__proto__", 7, 0, true, {}, { id: "cash" }, ["cash"], null])
      assert.equal(of({ category: cat, essential: bad }), "", `${cat}/${JSON.stringify(bad)}`);
    assert.equal(of({ category: cat }), "", `${cat}/missing`);
  }
  for (const category of ["water", "telepathy", "constructor", "__proto__", 3, null, undefined])
    assert.equal(of({ category, essential: "cash" }), "", String(category));
  assert.equal(of({ essential: "cash" }), "");
  assert.equal(json("essentialOf({})"), "");
});

test("every item in every scenario reads as an id from its own category's list, \"none\" or untagged", () => {
  for (const name of scenarios) {
    const { json } = load({ fixture: name });
    const rows = json(`S.items.map(it => [it.category, it.essential, essentialOf(it)])`);
    const E = json("ESSENTIALS");
    for (const [cat, raw, got] of rows) {
      const listed = Object.hasOwn(E, cat) && E[cat].some(e => e.id === raw);
      assert.equal(got, raw === "none" ? "none" : listed ? raw : "", `${name}: ${cat}/${JSON.stringify(raw)}`);
    }
  }
});

test("the tagged scenario reads each kind of tag the way the rule says", () => {
  const { json } = load({ fixture: "fixtures/data-and-account-shapes/essential-tags" });
  const got = json(`Object.fromEntries(S.items.map(it => [it.id, essentialOf(it)]))`);
  assert.deepEqual(got, {
    d1: "id_copies", d2: "cash", d3: "cash", d4: "none", d5: "",
    f1: "extinguisher", f2: "", f3: "",
    c1: "radio", c2: "", c3: "",
    t1: "multitool", t2: "", t3: "",
    m1: "pain_reliever", m2: "allergy_med", m3: "prescriptions", m4: "prescriptions", m5: "",
    w1: "", x1: "",
  });
});

const meds = (run, json, members) => {
  run(`S.profile = { members: ${JSON.stringify(members)}, pets: [], vehicles: 0 }`);
  return json(`essentialsFor("medications", household())`);
};

test("the standard household needs pain and allergy medicine and Sam's prescriptions", () => {
  const { json } = load({ fixture: "tests/household" });
  assert.deepEqual(json(`essentialsFor("medications", household())`), [
    { id: "pain_reliever", label: "Pain or fever reliever" },
    { id: "allergy_med", label: "Allergy medicine" },
    { id: "prescriptions", label: "Sam's prescriptions" },
  ]);
});

test("prescriptions are needed once per person on daily medication", () => {
  const { run, json } = load();
  const rx = members => meds(run, json, members).filter(e => e.id === "prescriptions");
  assert.deepEqual(rx([{ years: 30 }, { years: 5, conditions: ["allergy", "asthma"] }]), []);
  // Diabetes, seizures and opioids are daily medication too, and a person with several still needs one.
  assert.equal(rx([{ label: "Ana", years: 30, conditions: ["diabetes", "meds"] }]).length, 1);
  for (const c of ["meds", "diabetes", "seizures", "opioids"]) assert.equal(rx([{ years: 30, conditions: [c] }]).length, 1, c);
  assert.equal(rx([{ label: "Ana", conditions: ["seizures"] }, { label: "Ben" }, { label: "Cy", conditions: ["opioids"] }]).length, 2);
  assert.equal(rx([{ conditions: ["meds"] }, { conditions: ["meds"] }, { conditions: ["diabetes"] }, { conditions: ["meds"] }]).length, 4);
  // Odd saved shapes never count as daily medication, and never break the list.
  assert.deepEqual(rx([{ conditions: "meds" }, { conditions: null }, {}]), []);
});

test("one person's prescriptions carry their name, or the page's name for an unnamed person", () => {
  const { run, json } = load();
  assert.deepEqual(meds(run, json, [{ label: "Ana", years: 40 }, { years: 30, conditions: ["meds"] }]).at(-1), { id: "prescriptions", label: "Person 2's prescriptions" });
  // A name is text: the list keeps it as written, and the page escapes it wherever it shows it.
  assert.equal(meds(run, json, [{ label: "<b>Pat</b> & co", conditions: ["heart", "diabetes"] }]).at(-1).label, "<b>Pat</b> & co's prescriptions");
});

test("with several people on daily medication, no prescriptions label claims whose is in the kit", () => {
  const { run, json } = load();
  const members = [{ label: "Ana", conditions: ["meds"] }, { label: "Ben" }, { label: "Cy", conditions: ["diabetes"] }];
  const rx = meds(run, json, members).filter(e => e.id === "prescriptions");
  assert.equal(rx.length, 2);
  for (const { label } of rx) {
    assert.ok(typeof label === "string" && label.trim());
    for (const name of ["Ana", "Ben", "Cy", "Person 1", "Person 3"]) assert.ok(!label.includes(name), label);
  }
  assert.equal(new Set(rx.map(e => e.label)).size, rx.length);
});

test("each named category lists its fixed essentials, and every other category none", () => {
  const { json } = load({ fixture: "tests/household" });
  for (const [cat, list] of Object.entries(CONTRACT)) {
    if (cat === "medications") continue;
    assert.deepEqual(json(`essentialsFor(${JSON.stringify(cat)}, household())`), list.map(([id, label]) => ({ id, label })), cat);
  }
  const others = json("Object.keys(CATS)").filter(c => !(c in CONTRACT));
  assert.ok(others.length > 0);
  for (const cat of [...others, "telepathy", "constructor", "__proto__", "toString", ""])
    assert.deepEqual(json(`essentialsFor(${JSON.stringify(cat)}, household())`), [], cat);
  for (const cat of ["null", "undefined", "7", "{}"]) assert.deepEqual(json(`essentialsFor(${cat}, household())`), [], cat);
});

// Nothing is scored by the tags yet: every score is the same with every tag removed, or with every
// item in the five categories tagged as their first essential.
const scores = (run, json) => json(`(() => { const M = model(); return { overall: M.overall, results: M.results.map(r => [r.hz.id, r.score]), kits: Object.entries(M.kitRes).map(([k, r]) => [k, r.score]) }; })()`);
for (const name of scenarios) {
  test(`${name}: tags change no score yet`, () => {
    const { run, json } = load({ fixture: name });
    const as = scores(run, json);
    run(`S.items = S.items.map(({ essential, ...it }) => it)`);
    assert.deepEqual(scores(run, json), as, "untagged");
    run(`S.items = S.items.map(it => ({ ...it, essential: Object.hasOwn(ESSENTIALS, it.category) ? ESSENTIALS[it.category][0].id : "none" }))`);
    assert.deepEqual(scores(run, json), as, "all tagged");
  });
}
