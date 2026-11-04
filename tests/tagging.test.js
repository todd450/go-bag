const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");

// Tagging items saved before the named essentials: one Next step, one review panel, and nothing written
// until Save. These run on the tagged scenario (#33) and the standard household.
const TAGS = "fixtures/data-and-account-shapes/essential-tags";
const scenarios = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

const tagStep = app => app.json(`nextActions(model()).acts.find(a => a.kind === "tag") || null`);
// The review's rows, read from the rendered panel: [item id, the select's value, the note beside it].
const reviewRows = html => [...html.matchAll(/<li class="tg-row"[\s\S]*?<\/li>/g)].map(([li]) => ({
  id: li.match(/data-change="tagPick" data-id="([^"]*)"/)?.[1],
  value: li.match(/<option value="([^"]*)" selected>/)?.[1] ?? "",
  options: [...li.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]),
  text: li.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'"),
  html: li,
}));
// A stand-in db that records every write, and fails them all when `fail` is set.
function standInDb(app, { fail = false } = {}) {
  app.run(`var writes = []; var toasts = []; toast = m => toasts.push(m);
    db = { doc: p => ({ set: async d => { writes.push([p, d]); if (${fail}) throw new Error("offline"); }, delete: async () => { writes.push([p, null]); } }) };`);
  return { writes: () => app.json("writes"), toasts: () => app.json("toasts") };
}
const untaggedIds = app => app.json(`S.items.filter(it => Object.hasOwn(ESSENTIALS, it.category) && !essentialOf(it) && expState(it) !== "expired").map(it => it.id)`);

test("the standard household is offered its one untagged item, and not the expired one", () => {
  const app = load({ fixture: "tests/household" });
  const step = tagStep(app);
  assert.ok(step, "a tag step");
  assert.match(step.title, /^Tag 1 item\b/);
  assert.equal(app.json(`nextActions(model()).acts[0].kind`), "tag", "Next steps leads with it");
  app.run("ACT.tagOpen()");
  const rows = reviewRows(app.run("viewOverview(model())"));
  assert.deepEqual(rows.map(r => r.id), ["i3"]);
  assert.match(rows[0].text, /Fire extinguisher/);
  assert.doesNotMatch(rows.map(r => r.text).join(" "), /Old ibuprofen/);

  app.run(`S.tag = null; S.items.find(i => i.id === "i3").essential = "extinguisher"`);
  assert.equal(tagStep(app), null, "with every item tagged the step is gone");
});

test("the step counts the untagged, unexpired items in the five categories, and says how many are guessed", () => {
  const app = load({ fixture: TAGS });
  const ids = untaggedIds(app);
  const guessed = app.json(`S.items.filter(it => ${JSON.stringify(ids)}.includes(it.id) && guessEssential(it)).length`);
  const step = tagStep(app);
  assert.match(step.title, new RegExp(`^Tag ${ids.length} items · ${guessed} guessed, ${ids.length - guessed} to pick$`));
  app.run("ACT.tagOpen()");
  const rows = reviewRows(app.run("viewOverview(model())"));
  assert.deepEqual(rows.map(r => r.id).sort(), [...ids].sort());
  assert.ok(!rows.some(r => r.id === "d4"), "an item tagged \"none\" is not offered");
  assert.ok(!rows.some(r => r.id === "m1"), "a tagged item is not offered");
});

test("guesses come from the item's name, and only from its own category's list", () => {
  const { json } = load();
  const guess = (name, category) => json(`guessEssential(${JSON.stringify({ name, category })})`);
  assert.equal(guess("Cash envelope ($200 in small bills)", "documents"), "cash");
  for (const name of ["Ibuprofen 200 mg, 50 tablets", "Children's Tylenol, 4 fl oz", "Acetaminophen 500 mg", "Advil Liqui-Gels"])
    assert.equal(guess(name, "medications"), "pain_reliever", name);
  assert.equal(guess("Fire extinguisher, 2.5 lb", "fire_safety"), "extinguisher");
  assert.equal(guess("Zip pouch of papers", "documents"), "");
  // The same names filed somewhere else get no guess from another category's list.
  assert.equal(guess("Fire extinguisher, 2.5 lb", "tools"), "");
  assert.equal(guess("Cash envelope ($200 in small bills)", "medications"), "");
  assert.equal(guess("Advil Liqui-Gels", "water"), "");
  assert.equal(guess("Advil Liqui-Gels", "__proto__"), "");
  assert.equal(guess("", "documents"), "");
  assert.equal(json(`guessEssential({ category: "documents" })`), "");
});

test("across every scenario, no guess is outside its item's category list", () => {
  for (const name of scenarios) {
    const { json } = load({ fixture: name });
    for (const [cat, g] of json(`S.items.map(it => [it.category, guessEssential(it)])`)) {
      if (g === "") continue;
      assert.ok(json(`essentialList(${JSON.stringify(cat)}).some(e => e.id === ${JSON.stringify(g)})`), `${name}: ${cat}/${g}`);
    }
  }
});

test("the review has one row per item: a select preset to the guess, or a warning to pick one", () => {
  const app = load({ fixture: TAGS });
  app.run("ACT.tagOpen()");
  const html = app.run("viewOverview(model())");
  assert.doesNotMatch(html, /class="acts"/, "the review replaces the Next steps list");
  const rows = reviewRows(html);
  const E = app.json("ESSENTIALS");
  for (const r of rows) {
    const it = app.json(`S.items.find(i => i.id === ${JSON.stringify(r.id)})`);
    const g = app.json(`guessEssential(S.items.find(i => i.id === ${JSON.stringify(r.id)}))`);
    assert.deepEqual(r.options, ["", ...E[it.category].map(e => e.id), "none"], `${r.id} offers its category's essentials in order, then none`);
    assert.match(r.html, /Not one of these/);
    assert.ok(r.text.includes(it.name), r.id);
    assert.ok(r.text.includes(app.json(`catLabel(${JSON.stringify(it.category)})`)), `${r.id} shows its category`);
    assert.ok(r.text.includes(app.json(`S.kits.find(k => k.id === ${JSON.stringify(it.kitId)})?.name || ""`)), `${r.id} shows its kit`);
    assert.equal(r.value, g, `${r.id} is preset to its guess`);
    if (g) assert.match(r.text, /\bguess\b/, r.id);
    else assert.match(r.html, /color:var\(--warn\)[^>]*>Not sure, pick one/, r.id);
  }
  assert.ok(rows.some(r => r.value) && rows.some(r => !r.value), "the scenario has both kinds of row");
  assert.match(html, /Nothing is saved until you tap Save/);
  const n = rows.filter(r => r.value).length;
  assert.match(html, new RegExp(`data-act="tagSave"[^>]*>Save ${n} tags?<`));
  assert.match(html, /data-act="tagCancel"[^>]*>Cancel</);
});

test("opening the review and cancelling it changes nothing and writes nothing", async () => {
  const app = load({ fixture: TAGS });
  const db = standInDb(app);
  const before = app.json("S.items");
  app.run("ACT.tagOpen()");
  await app.fire("change", { dataset: { change: "tagPick", id: "d5" }, value: "records" });
  app.run("viewOverview(model())");
  app.run("ACT.tagCancel()");
  assert.deepEqual(app.json("S.items"), before);
  assert.deepEqual(db.writes(), []);
  assert.equal(app.json("S.tag"), null);
  assert.ok(tagStep(app), "the step is back");
});

test("Save writes one doc per chosen row, each the old doc plus its essential", async () => {
  const app = load({ fixture: TAGS });
  const db = standInDb(app);
  const before = Object.fromEntries(app.json("S.items").map(it => [it.id, it]));
  const ids = untaggedIds(app);
  app.run("ACT.tagOpen()");
  await app.fire("change", { dataset: { change: "tagPick", id: "d5" }, value: "records" });
  await app.fire("change", { dataset: { change: "tagPick", id: "t3" }, value: "none" });
  const guessed = ids.filter(id => app.json(`guessEssential(S.items.find(i => i.id === "${id}"))`));
  // A guessed row put back on "pick one" is left alone.
  await app.fire("change", { dataset: { change: "tagPick", id: guessed[0] }, value: "" });
  const want = { d5: "records", t3: "none" };
  for (const id of guessed.slice(1)) want[id] = app.json(`guessEssential(S.items.find(i => i.id === "${id}"))`);
  await app.run("ACT.tagSave()");
  const writes = db.writes();
  assert.deepEqual(writes.map(([p]) => p).sort(), Object.keys(want).map(id => "items/" + id).sort(), "one write per chosen row and none for the rest");
  for (const [p, doc] of writes) {
    const id = p.slice("items/".length);
    const { id: _, ...old } = before[id];
    assert.deepEqual(doc, { ...old, essential: want[id] }, id);
  }
  assert.ok(db.toasts().some(t => /^Saved\b/.test(t)));
  assert.equal(app.json("S.tag"), null, "the review closes");
});

test("\"Not one of these\" saves \"none\", and the item leaves the count", async () => {
  const app = load({ fixture: "tests/household" });
  app.run("ACT.tagOpen()");
  await app.fire("change", { dataset: { change: "tagPick", id: "i3" }, value: "none" });
  await app.run("ACT.tagSave()");
  assert.equal(app.json(`S.items.find(i => i.id === "i3").essential`), "none");
  assert.equal(tagStep(app), null);
});

test("a value not on the item's category list is not saved", async () => {
  const app = load({ fixture: TAGS });
  const db = standInDb(app);
  app.run("ACT.tagOpen()");
  for (const id of untaggedIds(app)) await app.fire("change", { dataset: { change: "tagPick", id }, value: "" });
  await app.fire("change", { dataset: { change: "tagPick", id: "d5" }, value: "flare_gun" });
  await app.fire("change", { dataset: { change: "tagPick", id: "f3" }, value: "radio" });
  await app.fire("change", { dataset: { change: "tagPick", id: "c3" }, value: "constructor" });
  await app.fire("change", { dataset: { change: "tagPick", id: "t2" }, value: "whistle" });
  assert.match(app.run("viewOverview(model())"), /data-act="tagSave" disabled/);
  await app.run("ACT.tagSave()");
  assert.deepEqual(db.writes(), []);
});

test("the step's points are the score change after Save", async () => {
  for (const name of ["tests/household", TAGS]) {
    const app = load({ fixture: name });
    const step = tagStep(app), before = app.json("model().overall");
    app.run("ACT.tagOpen()");
    await app.run("ACT.tagSave()");
    assert.equal(step.gain, app.json("model().overall") - before, name);
    if (name === "tests/household") assert.ok(step.gain > 0, "tagging the extinguisher adds points");
  }
});

test("when the write fails, the review stays open with the Couldn't save toast", async () => {
  const app = load({ fixture: "tests/household" });
  const db = standInDb(app, { fail: true });
  app.run("ACT.tagOpen()");
  await app.run("ACT.tagSave()");
  assert.ok(db.toasts().some(t => /^Couldn't save/.test(t)));
  assert.ok(!db.toasts().some(t => /^Saved\b/.test(t)));
  assert.notEqual(app.json("S.tag"), null);
  assert.equal(reviewRows(app.run("viewOverview(model())")).length, 1);
});

test("read-only, the Review and Save buttons are disabled", async () => {
  const app = load({ fixture: "tests/household" });
  app.run("S.canWrite = false");
  assert.match(app.run("viewOverview(model())"), /data-act="tagOpen" disabled/);
  app.run("S.tag = { picks: new Map() }");
  assert.match(app.run("viewOverview(model())"), /data-act="tagSave" disabled/);
  const db = standInDb(app);
  await app.run("ACT.tagSave()");
  assert.deepEqual(db.writes(), []);
});

test("the review renders for every scenario, and escapes item names", () => {
  for (const name of scenarios) {
    const app = load({ fixture: name });
    app.run("ACT.tagOpen()");
    assert.doesNotThrow(() => app.run("for (const v of VIEWS) { S.view = v; render(); }"), name);
  }
  const app = load({ fixture: "tests/household" });
  const evil = `<img src=x onerror=alert(1)>`;
  app.run(`S.items.find(i => i.id === "i3").name = ${JSON.stringify(evil)}; S.kits.find(k => k.id === "home").name = ${JSON.stringify(evil)}; ACT.tagOpen()`);
  assert.ok(!app.run("viewOverview(model())").includes(evil));
});

test("a review whose rows all leave some other way closes, and a later untagged item doesn't reopen it", () => {
  // Every way the last row can leave without Save or Cancel: deleted, moved out of the five categories,
  // tagged from elsewhere, or expired. Each while on the Readiness tab and while on another tab.
  const leave = {
    deleted: `S.items = S.items.filter(i => i.id !== "i3")`,
    moved: `S.items.find(i => i.id === "i3").category = "light"`,
    tagged: `S.items.find(i => i.id === "i3").essential = "extinguisher"`,
    expired: `S.items.find(i => i.id === "i3").expires = "2000-01"`,
  };
  for (const [how, code] of Object.entries(leave)) for (const view of ["overview", "kits"]) {
    const app = load({ fixture: "tests/household" });
    app.run(`S.view = ${JSON.stringify(view)}; ACT.tagOpen(); ${code}; render()`);
    app.run(`S.items.push({ id: "n1", kitId: "home", name: "Whistle", category: "communication", qty: 1 }); S.view = "overview"; render()`);
    const html = app.run("viewOverview(model())");
    assert.equal(reviewRows(html).length, 0, `${how}, on ${view}: the review stays closed`);
    assert.match(tagStep(app)?.title || "", /^Tag 1 item\b/, `${how}, on ${view}: the new item is offered as a step`);
    assert.match(html, /data-act="tagOpen"/, `${how}, on ${view}: Next steps is back with its Review button`);
  }
});

test("the review closes when its rows run out even if nothing else renders in between", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`ACT.tagOpen(); S.items = S.items.filter(i => i.id !== "i3")`);
  assert.equal(reviewRows(app.run("viewOverview(model())")).length, 0);
  app.run(`S.items.push({ id: "n1", kitId: "home", name: "Whistle", category: "communication", qty: 1 })`);
  assert.equal(reviewRows(app.run("viewOverview(model())")).length, 0, "the new item waits in Next steps");
});
