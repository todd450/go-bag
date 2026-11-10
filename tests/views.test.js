const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

test("every tab renders for a brand-new household and for a full one", () => {
  for (const fixture of [undefined, "tests/household"]) {
    const { run, json } = load({ fixture });
    run("syncDraft()");
    for (const v of json("VIEWS")) assert.doesNotThrow(() => run(`S.view = "${v}"; render()`), `${v} (${fixture || "empty"})`);
  }
});

test("the Readiness tab groups emergencies, with filled stars on raised ones", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.hazards.importance = { burns: "most" }; S.openHz = new Set(["burns"]);`);
  const html = run("viewOverview(model())");
  for (const label of ["Disasters and outages", "Health emergencies", "Everyday"]) assert.ok(html.includes(label), label);
  assert.deepEqual(html.match(/<span class="imp up"[^>]*>[^<]*</g), ['<span class="imp up" aria-hidden="true">★★<']);
});

test("names people type are escaped", () => {
  const { run } = load({ fixture: "tests/household" });
  const evil = `<img src=x onerror=alert(1)>`;
  run(`S.profile.members[0].label = ${JSON.stringify(evil)}; S.kits[0].name = ${JSON.stringify(evil)}; syncDraft();`);
  for (const v of ["viewHousehold()", "viewOverview(model())", "viewKits(model())"]) assert.ok(!run(v).includes(evil), v);
});

// Every scenario and the standard household, with each kit open in turn and its delete confirmation showing.
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./load");
const countFixtures = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

test("a count of one is never followed by a plural", () => {
  const plural = /\b1 (people|persons|items|kits|pets|photos|gaps|steps|supplies)\b/;
  for (const fixture of countFixtures) {
    const { run, json } = load({ fixture });
    run("syncDraft(); for (const k of S.kits) k.photos = ['p1'];");
    const text = html => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    const pages = [run("viewOverview(model())")];
    for (const id of json("S.kits.map(k => k.id)")) pages.push(run(`S.openKit = ${JSON.stringify(id)}; S.confirm = "kit:" + S.openKit; viewKits(model())`));
    for (const page of pages) assert.doesNotMatch(text(page), plural, fixture);
  }
});

test("the add-a-kit form folds into a button once there is a kit", () => {
  const empty = load().run("viewKits(model())");
  assert.match(empty, /data-submit="newKit"/, "no kits: the form is open");
  assert.doesNotMatch(empty, /data-act="cancelKit"|data-act="addKit"/, "no kits: nothing to cancel back to");

  const { run } = load({ fixture: "tests/household" });
  let html = run("viewKits(model())");
  assert.match(html, /data-act="addKit"/);
  assert.doesNotMatch(html, /data-submit="newKit"/);

  run("ACT.addKit()");
  html = run("viewKits(model())");
  assert.match(html, /data-submit="newKit"/);
  assert.match(html, /data-act="cancelKit"/);
  assert.doesNotMatch(html, /data-act="addKit"/);

  run("ACT.cancelKit()");
  assert.match(run("viewKits(model())"), /data-act="addKit"/);

  run("S.canWrite = false; S.addKit = true");
  html = run("viewKits(model())");
  assert.doesNotMatch(html, /data-act="addKit"|data-submit="newKit"/, "read-only: neither");
});

test("every inventory cell with something in it is labelled for the card layout", () => {
  const { run } = load({ fixture: "tests/household" });
  const tables = [];
  for (const w of [true, false]) {
    run(`S.canWrite = ${w}; S.openKit = "go"; ACT.kitView({ dataset: { v: "list" } })`);
    tables.push(run("viewKits(model())"));
  }
  tables.push(run(`draftTable({ rows: [{ key: "a", name: "Tent", category: "shelter", qty: 1, liters: 0, kcal: 0, lb: 4.4, L: 9, expires: "", shop: "" }] })`));
  for (const html of tables) {
    const table = html.match(/<table class="inv">[\s\S]*?<\/table>/);
    assert.ok(table, "inventory table has class inv");
    const cells = table[0].match(/<td[^>]*>[\s\S]*?<\/td>/g);
    assert.ok(cells.length > 8);
    for (const td of cells) {
      if (/^<td[^>]*><\/td>$/.test(td) || /^<td class="(sel|x-td)"/.test(td)) continue;
      assert.match(td, /^<td[^>]*data-label="[^"]+"/, td.slice(0, 80));
    }
  }
});

test("low, partway and ready scores look different and say so in words", () => {
  const { run, json } = load({ fixture: "tests/household" });
  const look = s => json(`[statusColor(${s}), band(${s})[1]]`);
  assert.deepEqual(look(4), ["var(--warn)", "Low"]);
  assert.deepEqual(look(39), ["var(--warn)", "Low"]);
  assert.deepEqual(look(40), ["var(--meter)", "Partway"]);
  assert.deepEqual(look(67), ["var(--meter)", "Partway"]);
  assert.deepEqual(look(75), ["var(--good)", "Ready"]);
  assert.deepEqual(look(100), ["var(--good)", "Ready"]);
  const overall = json("model().overall");
  const word = json(`band(${overall})[1]`);
  assert.match(run("viewOverview(model())"), new RegExp(`class="band"><i[^>]*></i>${word}<`));
  run(`S.openKit = "go"`);
  assert.match(run("viewKits(model())"), /class="kit-pct"[^>]*>\d+%<\/span><span class="band">/);
});

test("each tab opens with one short line, and the full explanation sits behind How this works", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`syncDraft(); S.openKit = "go"; ACT.kitView({ dataset: { v: "list" } })`);
  const words = html => html.replace(/<[^>]*>/g, " ").trim().split(/\s+/).length;
  const pages = { score: "viewOverview(model())", "kit-table": "viewKits(model())", household: "viewHousehold()", shop: "viewShop(model())" };
  for (const [id, view] of Object.entries(pages)) {
    const html = run(view);
    assert.match(html, new RegExp(`<details class="how" data-how="${id}" ><summary>How this works</summary><p>[^<]{60,}`), id);
    const intro = html.match(new RegExp(`<p class="(?:small )?muted"[^>]*>((?:(?!</p>)[\\s\\S])*)</p>\\s*<details class="how" data-how="${id}"`));
    assert.ok(intro, `${id} has a line right before it`);
    assert.ok(words(intro[1]) <= 15, `${id} intro is ${words(intro[1])} words`);
  }
  run(`S.how.add("shop")`);
  assert.match(run("viewShop(model())"), /data-how="shop" open>/, "an opened explanation stays open on re-render");
});

// ---------- Emergency rows and their panel, and the checklist blocks of a kit (the five categories of named essentials) ----------
// The standard household with the screenshot case in its go-bag: a cash envelope and four pain relievers.
function screenshotCase() {
  const app = load({ fixture: "tests/household" });
  app.run(`S.items.push(
    { id: "e1", kitId: "go", name: "Cash envelope", category: "documents", qty: 1, essential: "cash" },
    ...[1, 2, 3, 4].map(n => ({ id: "p" + n, kitId: "go", name: "Pain reliever " + n, category: "medications", qty: 1, essential: "pain_reliever" })));`);
  return app;
}
const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const plain = html => unesc(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim().replace(/ ([·,.:])/g, "$1").replace(/· /g, " · ").replace(/ +/g, " ");
// Each block in a piece of HTML: its name, its "X of Y", its pills (present or missing, label, points), whether it
// has a button, and all of its text.
function blocks(html) {
  return [...html.matchAll(/<section class="ess-blk"[^>]*>([\s\S]*?)<\/section>/g)].map(([, blk]) => {
    const head = blk.match(/<div class="ess-h">([\s\S]*?)<\/div>/)[1];
    const chips = (blk.match(/<div class="chips">([\s\S]*?)<\/div>/) || ["", ""])[1];
    const pills = chips.split('<span class="chip ess ').slice(1).map(p => {
      const text = plain(p.replace(/^[^>]*>/, "").replace(/<span class="vh">[^<]*<\/span>/g, ""));
      return { have: p.startsWith("full"), label: text.split(" · ")[0], gain: +(p.match(/class="gain"[^>]*>\+(\d+)</) || [0, 0])[1], text };
    });
    return { name: plain(head.replace(/<span class="of">[\s\S]*$/, "")), of: plain((head.match(/<span class="of">([^<]*)</) || ["", ""])[1]),
      pills, button: /<button/.test(blk), text: plain(blk.replace(/<span class="vh">[^<]*<\/span>/g, "")) };
  });
}
const hzHtml = (run, id) => run(`(M => hzRow(M.results.find(r => r.hz.id === ${JSON.stringify(id)}), M.h, M))(model())`);
const houseFire = run => { run(`S.openHz = new Set(["housefire"])`); return hzHtml(run, "housefire"); };
const goKit = run => { run(`S.openKit = "go"`); return run("viewKits(model())"); };
// An emergency row's need tags, in order: state (miss, part, have, or more for "+N more") and text.
const tags = html => (html.match(/<span class="hz-needs">([\s\S]*?)<\/span>\s*<\/div>/) || ["", ""])[1]
  .split('<span class="need ').slice(1).map(p => ({ state: p.slice(0, p.indexOf('"')), text: plain(p.replace(/^[^>]*>/, "").replace(/<span class="vh">[^<]*<\/span>/g, "")) }));
// An opened emergency's needs, one line each: state, name with what's missing, notes, and the amount.
const needs = html => [...html.matchAll(/<div class="hzp-need (\w+)">([\s\S]*?)<\/div>/g)].map(([, state, body]) => {
  const i = body.indexOf('<span class="amt">'), nm = body.slice(0, i).replace(/<span class="vh">[^<]*<\/span>/g, "");
  return { state, text: plain(nm.replace(/<span class="hzp-note[^"]*">[^<]*<\/span>/g, "")),
    notes: [...nm.matchAll(/<span class="hzp-note[^"]*">([^<]*)<\/span>/g)].map(m => plain(m[1])), amount: plain(body.slice(i)) };
});

test("an emergency row names what it needs, missing first, then some, then what you have", () => {
  const { run, json } = screenshotCase();
  const html = hzHtml(run, "housefire");
  assert.deepEqual(tags(html), [
    { state: "miss", text: "Fire safety" }, { state: "miss", text: "Clothing" }, { state: "miss", text: "Pet supplies" },
    { state: "miss", text: "Baby supplies" }, { state: "miss", text: "Kids' comfort" }, { state: "part", text: "Documents & cash 1 of 4" },
    { state: "more", text: "+2 more" }]);
  assert.match(html, /<span class="lik" role="img" aria-label="Moderate likelihood"[^>]*><i class="on"><\/i><i class="on"><\/i><i><\/i><\/span>/);
  assert.match(html, />16%</);
  assert.doesNotMatch(html, /hz-panel/, "closed, it shows no panel");
  // Every emergency: at most six tags, missing before some before have, and "+N more" for the rest
  run(`S.showOff = true`);
  for (const id of json("HAZARDS.map(h => h.id)")) {
    const n = json(`model().results.find(r => r.hz.id === "${id}").rows.length`);
    const t = tags(hzHtml(run, id)), states = t.filter(x => x.state !== "more").map(x => ["miss", "part", "have"].indexOf(x.state));
    assert.ok(states.every(s => s >= 0), id);
    assert.deepEqual(states, [...states].sort((a, b) => a - b), id);
    assert.equal(states.length, Math.min(n, 6), id);
    assert.deepEqual(t.filter(x => x.state === "more").map(x => x.text), n > 6 ? [`+${n - 6} more`] : [], id);
  }
});

// An emergency's pickers, as its row shows them: each one's id, the word on its skin, and the option chosen.
const picks = html => [...html.matchAll(/<span class="pick( ro)?"[^>]*><span[^>]*>([\s\S]*?)<\/span><select id="([^"]+)"([^>]*)>([\s\S]*?)<\/select>/g)]
  .map(([, ro, skin, id, attrs, options]) => ({ id, skin: plain(skin.replace(/<span class="lik"[\s\S]*?<\/span>/, `${(skin.match(/<i class="on">/g) || []).length} bars `)),
    chosen: (options.match(/<option value="([^"]+)" selected>/) || [])[1], ro: !!ro, disabled: /\bdisabled\b/.test(attrs), label: (attrs.match(/aria-label="([^"]*)"/) || [])[1] }));

test("an emergency's likelihood and importance change right on its row, without opening it", async () => {
  const { run, json, fire } = load({ fixture: "tests/household" });
  run(`S.canWrite = true`);
  let html = hzHtml(run, "housefire");
  assert.doesNotMatch(html, /hz-panel/, "closed");
  assert.deepEqual(picks(html), [
    { id: "lv-housefire", skin: "2 bars Moderate", chosen: "moderate", ro: false, disabled: false, label: "How likely House fire is for you" },
    { id: "im-housefire", skin: "☆", chosen: "normal", ro: false, disabled: false, label: "How much House fire matters to you" }]);
  await fire("change", { dataset: { change: "level", id: "housefire" }, value: "high" });
  await fire("change", { dataset: { change: "importance", id: "housefire" }, value: "most" });
  assert.equal(json("S.hazards.levels.housefire"), "high");
  assert.equal(json("S.hazards.importance.housefire"), "most");
  html = hzHtml(run, "housefire");
  assert.deepEqual(picks(html).map(p => [p.skin, p.chosen]), [["3 bars High", "high"], ["★★", "most"]]);
  assert.match(html, /<span class="imp up"/);
  // Back to "As much as the others" drops the saved importance instead of storing the default.
  await fire("change", { dataset: { change: "importance", id: "housefire" }, value: "normal" });
  assert.equal(json("Object.hasOwn(S.hazards.importance, 'housefire')"), false);
  // Opened, its panel has no pickers of its own: they stay on the row.
  run(`S.openHz = new Set(["housefire"])`);
  html = hzHtml(run, "housefire");
  assert.equal((html.match(/<select/g) || []).length, 2);
  assert.doesNotMatch(html.slice(html.indexOf("hz-panel")), /<select/);
  // Someone who can only view sees the same values, with the pickers shown flat and turned off.
  run(`S.canWrite = false`);
  assert.deepEqual(picks(hzHtml(run, "housefire")).map(p => [p.ro, p.disabled]), [[true, true], [true, true]]);
});

test("an emergency that doesn't apply keeps its likelihood picker, at Not relevant, so it can be turned back on", () => {
  const { run } = load({ fixture: "tests/household" });
  const quake = hzHtml(run, "earthquake");
  assert.match(quake, /^<div class="hz-row off">/);
  assert.deepEqual(picks(quake).map(p => [p.id, p.skin, p.chosen]), [["lv-earthquake", "0 bars Not relevant", "none"]], "and no importance picker");
  run(`S.profile.vehicles = 0`);
  const stranded = hzHtml(run, "stranded");
  assert.match(stranded, /No vehicle/);
  assert.doesNotMatch(stranded, /<select/);
});

test("an opened emergency says what's involved: the situation, how bad and how likely, and each need with what's missing", () => {
  const { run } = screenshotCase();
  const html = houseFire(run), text = plain(html);
  assert.match(text, /You leave home with a day of supplies for 5 people and 1 pet\. Counts go-bags and vehicle kits\./);
  assert.match(text, /Life-threatening if you're unprepared: minutes matter, so it counts 4× in your score\./);
  assert.deepEqual(needs(html).map(n => [n.state, n.text, n.amount]), [
    ["miss", "Fire safety · missing fire extinguisher, fire blanket and escape ladder", "0 of 3"],
    ["miss", "Clothing", "0 of 5"],
    ["miss", "Pet supplies", "0 of 1"],
    ["miss", "Baby supplies", "0 of 2"],
    ["miss", "Kids' comfort", "0 of 2"],
    ["part", "Documents & cash · missing ID copies, insurance cards and records (USB or printed)", "1 of 4"],
    ["part", "Medications · missing allergy medicine and Sam's prescriptions", "1 of 3"],
    ["part", "Light", "2 of 3"],
  ]);
  assert.match(html, /data-act="shopAddHz" data-id="housefire"[^>]*>Add the 13 missing to your shopping list</);
});

test("the panel words the situation by where you'd be: home, away, or a health emergency's moment", () => {
  const { run } = load({ fixture: "tests/household" });
  const opened = id => { run(`S.openHz = new Set([${JSON.stringify(id)}])`); return plain(hzHtml(run, id)); };
  assert.match(opened("outage"), /You stay home for 7 days on what you have stored, for 5 people and 1 pet\. Counts home supplies and go-bags\./);
  assert.match(opened("evacuation"), /You leave home with 3 days of supplies for 5 people and 1 pet\./);
  assert.match(opened("stranded"), /You're stuck in the car for up to a day\. Counts vehicle kits\./);
  assert.match(opened("choking"), /Mealtimes, small toys · first minutes\. Counts home supplies, go-bags and vehicle kits\./);
});

test("Add the N missing adds each of the emergency's gaps that isn't on the list yet, once", () => {
  const { run, json } = screenshotCase();
  run(`ACT.shopAdd({ dataset: { cat: "documents", essential: "insurance" } })`);
  assert.match(houseFire(run), />Add the 12 missing to your shopping list</);
  const before = json("shopItems().length");
  run(`ACT.shopAddHz({ dataset: { id: "housefire" } })`);
  const added = json("shopItems()").slice(before).map(e => e.cat + (e.essential ? "|" + e.essential : "")).sort();
  assert.deepEqual(added, ["baby", "clothing", "documents|id_copies", "documents|records", "fire_safety|escape_ladder", "fire_safety|extinguisher",
    "fire_safety|fire_blanket", "kids", "light", "medications|allergy_med", "medications|prescriptions", "pets"]);
  run(`ACT.shopAddHz({ dataset: { id: "housefire" } })`);
  assert.equal(json("shopItems().length"), before + 12, "a second tap adds nothing");
  const html = houseFire(run);
  assert.doesNotMatch(html, /shopAddHz/);
  assert.match(plain(html), /All of it is on your shopping list\./);
  // One gap is named, and a category keeps its acronym
  run(`S.openHz = new Set(["choking"])`);
  assert.match(plain(hzHtml(run, "choking")), /Add CPR & airway to your shopping list/);
  run(`ACT.shopAddHz({ dataset: { id: "choking" } })`);
  assert.deepEqual(json("shopItems().at(-1).cat"), "cpr");
});

test("no block or essentials line reads more than it needs, in any scenario, emergency or kit", () => {
  const apps = [...countFixtures.map(f => [f, load({ fixture: f })]), ["screenshot case", screenshotCase()]];
  for (const [name, { run, json }] of apps) {
    run(`syncDraft(); S.showOff = true; S.openHz = new Set(HAZARDS.map(h => h.id))`);
    const ess = new Set(json("Object.keys(ESSENTIALS).map(catLabel)"));
    const lines = needs(run("viewOverview(model())")).filter(n => ess.has(n.text.split(" · ")[0]));
    assert.ok(lines.length > 0, name);
    for (const n of lines) {
      const [x, y] = n.amount.split(" of ").map(Number);
      assert.ok(x <= y, `${name}: ${n.text} reads ${n.amount}`);
      assert.equal(n.state, x === y ? "have" : x ? "part" : "miss", `${name}: ${n.text}`);
    }
    const all = json("S.kits.map(k => k.id)").flatMap(id => blocks(run(`S.openKit = ${JSON.stringify(id)}; viewKits(model())`)));
    for (const b of all) {
      assert.doesNotMatch(b.text, /\b4 of 1\b/, name);
      for (const [, x, y] of b.text.matchAll(/\b(\d+) of (\d+)\b/g)) assert.ok(+x <= +y, `${name}: ${b.name} reads ${x} of ${y}`);
      const [have, need] = b.of.split(" of ").map(Number);
      assert.equal(b.pills.length, need, `${name}: ${b.name} has a pill per essential`);
      assert.equal(b.pills.filter(p => p.have).length, have, `${name}: ${b.name}`);
    }
  }
});

test("a kit's missing pills show the points their shopping line adds, planned into that kit, and a pill worth 0 shows none", () => {
  const { run, json } = screenshotCase();
  const bs = blocks(goKit(run));
  const points = Object.fromEntries(json(`(() => { const M = model();
    return M.gaps.filter(g => g.essential).map(g => [g.cat + "|" + g.label, Math.max(0, scoreIfShopped(M, [shopFromGap(g, M.h, "go")]) - M.overall)]); })()`));
  const cats = json(`Object.fromEntries(Object.keys(ESSENTIALS).map(c => [catLabel(c), c]))`);
  let shown = 0;
  for (const b of bs) for (const p of b.pills.filter(p => !p.have)) {
    const key = cats[b.name] + "|" + p.label;
    assert.equal(p.gain, points[key] || 0, key);
    if (!points[key]) assert.doesNotMatch(p.text, /\+\d/, `${key} shows no gain`);
    shown += p.gain > 0;
  }
  assert.ok(shown > 0, "some pill is worth points");
  assert.ok(bs.every(b => !b.button), "no block has a button: the kit's tiles plan its gaps");
  // Present pills come first, then missing ones by points
  for (const b of bs) {
    const firstMiss = b.pills.findIndex(p => !p.have);
    assert.ok(firstMiss < 0 || b.pills.slice(firstMiss).every(p => !p.have), b.name);
    const gains = b.pills.filter(p => !p.have).map(p => p.gain);
    assert.deepEqual(gains, [...gains].sort((x, y) => y - x), b.name);
  }
});

test("in a kit, counted categories stay chips under Counted by amount", () => {
  const { run } = screenshotCase();
  const html = goKit(run);
  assert.ok(html.includes("Counted by amount"));
  const counted = html.slice(html.indexOf("Counted by amount"));
  for (const cat of ["Light", "Clothing"]) assert.match(counted, new RegExp(`<span class="chip[^"]*">(<svg[\\s\\S]*?</svg>)?${cat} · \\d+ of \\d+</span>`), cat);
});

test("the kit panel uses the same blocks, and the kit list names what's missing", () => {
  const { run } = screenshotCase();
  const bs = blocks(goKit(run));
  const docs = bs.find(b => b.name === "Documents & cash");
  assert.equal(docs.of, "1 of 4");
  assert.deepEqual(docs.pills.filter(p => p.have).map(p => p.label), ["Cash"]);
  assert.deepEqual(docs.pills.filter(p => !p.have).map(p => p.label).sort(), ["ID copies", "Insurance cards", "Records (USB or printed)"]);
  assert.match(bs.find(b => b.name === "Medications").text, /4 items, counts once/);
  assert.deepEqual(bs.map(b => b.name).sort(), ["Comms", "Documents & cash", "Medications", "Tools"]);
  const line = plain(run(`kitRow(S.kits.find(k => k.id === "go"), model().kitRes.go)`).match(/<p class="kit-miss[^>]*>([\s\S]*?)<\/p>/)[1]);
  assert.match(line, /^Missing ID copies, insurance cards and \d+ more\./);
  assert.doesNotMatch(line, /\bcash\b/i);
});

test("a person's name holding markup is escaped where their prescriptions are named", () => {
  const { run } = screenshotCase();
  const evil = `<img src=x onerror=alert(1)>`;
  run(`S.profile.members[1].label = ${JSON.stringify(evil)}`);
  const html = houseFire(run);
  assert.ok(!html.includes(evil));
  assert.ok(needs(html).find(n => n.text.startsWith("Medications")).text.includes(`${evil}'s prescriptions`), "named in the opened emergency");
  const kit = goKit(run);
  assert.ok(!kit.includes(evil));
  assert.ok(blocks(kit).find(b => b.name === "Medications").pills.some(p => p.label === `${evil}'s prescriptions`), "named in the kit panel");
  assert.ok(!run("viewOverview(model())").includes(evil));
});

test("an opened emergency and a kit block name the items still to tag and the expired ones, which don't count", () => {
  const { run } = screenshotCase();
  run(`S.items.push({ id: "z1", kitId: "go", name: "Zip pouch of papers", category: "documents", qty: 1 })`);
  const line = (html, cat) => needs(html).find(n => n.text.startsWith(cat));
  assert.deepEqual(line(houseFire(run), "Documents & cash").notes, ["1 item still to tag: Zip pouch of papers"]);
  assert.deepEqual(line(houseFire(run), "Medications").notes, ["Old ibuprofen expired 2020-01, so it doesn't count"]);
  assert.match(blocks(goKit(run)).find(b => b.name === "Documents & cash").text, /\b1 item still to tag: Zip pouch of papers\b/);
  run(`S.items.push({ id: "z2", kitId: "go", name: "Folder", category: "documents", qty: 1, essential: "none" }, { id: "z3", kitId: "go", name: "Binder", category: "documents", qty: 1 })`);
  assert.deepEqual(line(houseFire(run), "Documents & cash").notes, ["2 items still to tag: Zip pouch of papers and Binder"]);
});

// Layout at phone width, in a real browser (tests/phone.js). Skipped when there's no Chrome.
const { chrome, atPhoneWidth } = require("./phone");

test("at 390px each emergency keeps its name, pickers and score on one line and its needs on the next, kit blocks show their bars, and nothing scrolls sideways", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const fixtures = ["tests/household", "fixtures/phone-width/long-essentials", "fixtures/empty-and-one/big-household"];
  const seen = atPhoneWidth(fixtures, () => {
    const look = where => ({ where, width: innerWidth, scroll: document.documentElement.scrollWidth,
      bars: [...document.querySelectorAll(`#v-${S.view} .ess-blk .bar`)].map(b => b.getBoundingClientRect().width),
      needs: [...document.querySelectorAll(`#v-${S.view} .hz-needs`)].map(n => n.getBoundingClientRect().height),
      // Each row's first line: how wide its name still is, and how far its pickers and score sit from the name's line.
      lines: [...document.querySelectorAll(`#v-${S.view} .hz-row`)].map(r => { const b = r.querySelector(".hz-tg"), n = b.getBoundingClientRect(), c = r.querySelector(".hz-sc").getBoundingClientRect();
        return { name: b.textContent, width: Math.round(n.width), cut: b.scrollWidth > b.clientWidth, dy: Math.round(Math.abs(n.top + n.bottom - c.top - c.bottom) / 2) }; }),
      panels: document.querySelectorAll(`#v-${S.view} .hz-panel`).length });
    S.view = "overview"; S.showOff = true; S.openHz = new Set(); render();
    const views = [look("emergencies")];
    S.openHz = new Set(HAZARDS.map(h => h.id)); render(); views.push(look("opened emergencies"));
    for (const k of S.kits) { S.view = "kits"; S.openKit = k.id; render(); views.push(look(`kit ${k.name}`)); }
    return views;
  });
  for (const f of fixtures) {
    const [closed, opened, ...kits] = seen.get(f) || [];
    assert.ok(closed && closed.needs.length > 0, `${f}: no emergency rows`);
    assert.ok(closed.needs.every(h => h > 0 && h < 26), `${f}: an emergency's needs wrap past one line (heights ${closed.needs.join(", ")})`);
    for (const l of closed.lines) {
      assert.ok(!l.cut || l.width >= 80, `${f}: ${l.name}'s name is cut to ${l.width}px by its pickers`);
      assert.ok(l.dy <= 4, `${f}: ${l.name}'s pickers sit ${l.dy}px off its name's line`);
    }
    assert.equal(opened.panels, opened.needs.length, `${f}: every opened emergency shows its panel`);
    assert.ok(kits.some(v => v.bars.length > 0), `${f}: no kit block shows a bar`);
    for (const v of [closed, opened, ...kits]) {
      assert.equal(v.width, 390, `${f}, ${v.where}: the viewport isn't 390px`);
      assert.ok(v.scroll <= v.width, `${f}, ${v.where}: scrolls sideways (${v.scroll}px wide)`);
      assert.ok(v.bars.every(w => w > 0), `${f}, ${v.where}: a block's bar is hidden (widths ${v.bars.join(", ")})`);
    }
  }
});
