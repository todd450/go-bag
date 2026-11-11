const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

// A shopping line for a named essential says what to buy for that essential (buyGuide's sixth argument),
// with the category on its sub-line. Lines with no essential keep the category's own suggestion.
const isPrice = p => p === null || p === 0 || (typeof p === "number" && Number.isFinite(p) && p > 0);
// The words of an essential's label worth matching: "Records (USB or printed)" gives records, printed.
const words = label => label.toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 4);

test("every named essential has its own line, price and tip, unlike its category's", () => {
  const { json } = load({ fixture: "tests/household" });
  const all = json(`Object.entries(ESSENTIALS).flatMap(([cat, es]) => es.map(e => ({ cat, id: e.id, label: e.label,
    generic: buyGuide(cat, 1, "", "home", household()), own: buyGuide(cat, 1, "", "home", household(), e.id) })))`);
  assert.ok(all.length >= 17, "every essential is checked");
  for (const { cat, id, label, generic, own } of all) {
    assert.notEqual(own.line, generic.line, `${cat}/${id} has its own line`);
    assert.ok(own.line && own.tip, `${cat}/${id} has a line and a tip`);
    assert.ok(isPrice(own.price), `${cat}/${id} price is a number, From home or Prescription: ${own.price}`);
    assert.ok(words(label).some(w => own.line.toLowerCase().includes(w)), `${cat}/${id} line "${own.line}" names ${label}`);
  }
});

test("the prescriptions line is prescription only and names the one person who needs it", () => {
  const { json } = load({ fixture: "tests/household" });
  const b = json(`buyGuide("medications", 1, "", "go", household(), "prescriptions")`);
  assert.equal(b.price, null);
  assert.match(b.line + " " + b.tip, /\bSam\b/);
  assert.match(b.tip, /pharmacy/i);
  for (const other of ["Alex", "Jordan", "Riley", "Casey"]) assert.doesNotMatch(b.line + b.tip, new RegExp(`\\b${other}\\b`));
});

test("with two people on daily medication, it names both and never says whose is in the kit", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.profile.members[0].conditions = ["diabetes"]`);
  const guide = () => json(`buyGuide("medications", 1, "", "go", household(), "prescriptions")`);
  const none = guide();
  run(`S.items.push({ id: "rx1", kitId: "go", name: "Sam's pills", category: "medications", qty: 1, essential: "prescriptions" })`);
  const one = guide();
  assert.deepEqual(one, none, "the same whichever prescriptions are already in a kit");
  const text = one.line + " " + one.tip;
  assert.match(text, /\bAlex\b/);
  assert.match(text, /\bSam\b/);
  assert.doesNotMatch(text, /\b(Alex|Sam)'s\b/, "no one person's prescriptions");
  assert.equal(one.price, null);
  // The Shopping tab's two prescriptions lines read the same, so neither picks a person.
  run(`ACT.shopAddAll()`);
  const rx = json(`shopItems().filter(e => e.essential === "prescriptions").map(e => shopInfo(e, model()))`);
  assert.equal(rx.length, 1, "one prescriptions line left to buy");
  assert.equal(rx[0].line, one.line);
});

test("an essential line from a gap shows the essential in bold and its category below, for the same points", () => {
  const { json } = load({ fixture: "tests/household" });
  const rows = json(`(() => { const M = model(); return M.gaps.filter(g => g.essential).map(g => {
    const i = shopInfo(shopFromGap(g, M.h), M);
    return { cat: g.cat, ess: g.essential, label: g.label, catLabel: catLabel(g.cat), line: i.line, sub: i.sub, price: i.price,
      own: buyGuide(g.cat, 1, "", "home", M.h, g.essential).line, generic: buyGuide(g.cat, 1, "", "home", M.h).line, gain: i.gain, filled: Math.max(0, scoreIfFilled(M, [g]) - M.overall) }; }); })()`);
  assert.ok(rows.length >= 5, "the household is missing several essentials");
  for (const r of rows) {
    assert.equal(r.line, r.own, `${r.ess} line is the essential's own`);
    assert.notEqual(r.line, r.generic, `${r.ess} line is not the category's`);
    assert.equal(r.sub, r.catLabel, `${r.ess} sub-line is its category`);
    assert.ok(isPrice(r.price), `${r.ess} price`);
    assert.equal(r.gain, r.filled, `${r.ess} points are what filling the gap adds`);
  }
});

test("lines with no essential, and every counted category, keep the category's suggestion", () => {
  const { json } = load({ fixture: "tests/household" });
  const off = json(`(() => { const M = model(), out = [];
    const same = (a, b) => a.line === b.line && a.price === b.price && a.tip === b.tip;
    for (const g of M.gaps.filter(g => !g.essential)) {
      const e = shopFromGap(g, M.h), i = shopInfo(e, M), kt = S.kits.find(k => k.id === shopKit(e))?.type || e.kits[0];
      if (!same(i, buyGuide(e.cat, e.qty, e.unit, kt, M.h))) out.push("gap " + g.cat);
    }
    for (const cat of Object.keys(ESSENTIALS)) {
      const old = { id: "old", cat, qty: 1, unit: "", text: catLabel(cat) + " × 1", kits: ["home"], kitId: "home", done: false };
      if (!same(shopInfo(old, M), buyGuide(cat, 1, "", "home", M.h))) out.push("old line " + cat);
      for (const bad of ["", "none", "not_an_essential", 7]) if (!same(shopInfo({ ...old, essential: bad }, M), buyGuide(cat, 1, "", "home", M.h))) out.push(cat + " " + bad);
      const other = Object.keys(ESSENTIALS).find(c => c !== cat), stray = ESSENTIALS[other][0].id;
      if (!same(buyGuide(cat, 1, "", "home", M.h, stray), buyGuide(cat, 1, "", "home", M.h))) out.push(cat + " with " + other + "'s " + stray);
    }
    return out; })()`);
  assert.deepEqual(off, []);
});

test("a member label holding markup is escaped on the Shopping tab", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.profile.members[1].label = '<img src=x onerror=alert(1)>'; S.profile.members[3].label = '<b>Riley</b>'`);
  run(`ACT.shopAddAll(); S.view = "kits"; ACT.allKits()`);
  assert.match(run(`shopItems().filter(e => e.essential === "prescriptions").map(e => shopInfo(e, model()).line).join()`), /<img/);
  const html = run("viewShop(model())");
  assert.doesNotMatch(html, /<img|<b>Riley/);
  run(`S.profile.members[0].conditions = ["meds"]`);
  assert.doesNotMatch(run("viewShop(model())"), /<img|<b>Riley/, "with two people on daily medication");
});
