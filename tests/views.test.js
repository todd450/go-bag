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

test("the Readiness tab groups emergencies, with a star on raised ones", () => {
  const { run } = load({ fixture: "tests/household" });
  run(`S.hazards.importance = { burns: "most" }; S.openHz = new Set(["burns"]);`);
  const html = run("viewOverview(model())");
  for (const label of ["Disasters and outages", "Health emergencies", "Everyday"]) assert.ok(html.includes(label), label);
  assert.equal((html.match(/class="pri"/g) || []).length, 1);
  assert.match(html, /data-change="importance"/);
});

test("names people type are escaped", () => {
  const { run } = load({ fixture: "tests/household" });
  const evil = `<img src=x onerror=alert(1)>`;
  run(`S.profile.members[0].label = ${JSON.stringify(evil)}; S.kits[0].name = ${JSON.stringify(evil)}; syncDraft();`);
  for (const v of ["viewHousehold()", "viewOverview(model())", "viewKits(model())"]) assert.ok(!run(v).includes(evil), v);
});

test("a refill due within a week becomes a next step", () => {
  const { run } = load({ fixture: "tests/household" });
  const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  run(`S.plan = { meds: [{ who: "Sam", name: "Levothyroxine", refill: "${day(3)}" }] }`);
  assert.ok(run(`nextActions(model()).acts.some(a => a.kind === "refill")`));
  run(`S.plan.meds[0].refill = "${day(30)}"`);
  assert.ok(!run(`nextActions(model()).acts.some(a => a.kind === "refill")`));
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

test("next steps that mix setup and supplies count only the supplies", () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.items.find(i => i.id === "i3").essential = "extinguisher"`); // tagged, so no tag step takes a slot
  const kinds = json("nextActions(model()).acts.map(a => a.kind)");
  assert.deepEqual(kinds, ["plan", "gap", "gap"]);
  const html = run("viewOverview(model())");
  assert.match(html, /Your next 3 steps/);
  assert.match(html, /Adding the 2 supplies below takes readiness from \d+ to \d+\./);
  assert.doesNotMatch(html, /these 2 gaps/);
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
  const pages = { score: "viewOverview(model())", "kit-table": "viewKits(model())", household: "viewHousehold()", shop: "viewShop(model())", plan: "viewPlan(model())", review: "viewPlan(model())" };
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

// ---------- Checklist blocks: the five categories of named essentials, in an emergency and in a kit ----------
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
// Each block in a piece of HTML: its name, its "X of Y", its pills (present or missing, label, points), its
// Add button's text and data, and all of its text.
function blocks(html) {
  return [...html.matchAll(/<section class="ess-blk"[^>]*>([\s\S]*?)<\/section>/g)].map(([, blk]) => {
    const head = blk.match(/<div class="ess-h">([\s\S]*?)<\/div>/)[1];
    const chips = (blk.match(/<div class="chips">([\s\S]*?)<\/div>/) || ["", ""])[1];
    const pills = chips.split('<span class="chip ess ').slice(1).map(p => {
      const text = plain(p.replace(/^[^>]*>/, "").replace(/<span class="vh">[^<]*<\/span>/g, ""));
      return { have: p.startsWith("full"), label: text.split(" · ")[0], gain: +(p.match(/class="gain"[^>]*>\+(\d+)</) || [0, 0])[1], text };
    });
    const btn = blk.match(/<button[^>]*data-act="shopAddBlock"[^>]*>([^<]*)<\/button>/);
    const data = btn ? Object.fromEntries([...btn[0].matchAll(/data-([a-z]+)="([^"]*)"/g)].map(m => [m[1], unesc(m[2])]).filter(([k]) => k !== "act")) : null;
    return { name: plain(head.replace(/<span class="of">[\s\S]*$/, "")), of: plain((head.match(/<span class="of">([^<]*)</) || ["", ""])[1]),
      pills, button: btn ? plain(btn[1]) : null, data, text: plain(blk.replace(/<span class="vh">[^<]*<\/span>/g, "")) };
  });
}
const houseFire = run => { run(`S.openHz = new Set(["housefire"])`); return run(`(M => hzRow(M.results.find(r => r.hz.id === "housefire"), M.h, M))(model())`); };

test("an opened house fire shows Documents & cash as a block: 1 of 4, Cash in, the other three missing", () => {
  const { run } = screenshotCase();
  const bs = blocks(houseFire(run));
  const docs = bs.find(b => b.name === "Documents & cash");
  assert.ok(docs, `blocks: ${bs.map(b => b.name)}`);
  assert.equal(docs.of, "1 of 4");
  assert.deepEqual(docs.pills.filter(p => p.have).map(p => p.label), ["Cash"]);
  assert.deepEqual(docs.pills.filter(p => !p.have).map(p => p.label).sort(), ["ID copies", "Insurance cards", "Records (USB or printed)"]);
  const meds = bs.find(b => b.name === "Medications");
  assert.equal(meds.of, "1 of 3");
  assert.equal(meds.pills.find(p => p.have).text, "Pain or fever reliever · 4 items, counts once");
  // Present pills come first, then missing ones by points
  for (const b of bs) {
    const firstMiss = b.pills.findIndex(p => !p.have);
    assert.ok(firstMiss < 0 || b.pills.slice(firstMiss).every(p => !p.have), b.name);
    const gains = b.pills.filter(p => !p.have).map(p => p.gain);
    assert.deepEqual(gains, [...gains].sort((x, y) => y - x), b.name);
  }
});

test("no block reads more than it needs, in any scenario, emergency or kit", () => {
  const apps = [...countFixtures.map(f => [f, load({ fixture: f })]), ["screenshot case", screenshotCase()]];
  for (const [name, { run, json }] of apps) {
    run(`syncDraft(); S.showOff = true; S.openHz = new Set(HAZARDS.map(h => h.id))`);
    const pages = [run("viewOverview(model())")];
    for (const id of json("S.kits.map(k => k.id)")) pages.push(run(`S.openKit = ${JSON.stringify(id)}; viewKits(model())`));
    const all = pages.flatMap(blocks);
    assert.ok(all.length > 0, name);
    for (const b of all) {
      assert.doesNotMatch(b.text, /\b4 of 1\b/, name);
      for (const [, x, y] of b.text.matchAll(/\b(\d+) of (\d+)\b/g)) assert.ok(+x <= +y, `${name}: ${b.name} reads ${x} of ${y}`);
      const [have, need] = b.of.split(" of ").map(Number);
      assert.equal(b.pills.length, need, `${name}: ${b.name} has a pill per essential`);
      assert.equal(b.pills.filter(p => p.have).length, have, `${name}: ${b.name}`);
    }
  }
});

test("each missing pill's points are what its shopping line adds, and a pill worth 0 shows none", () => {
  const { run, json } = screenshotCase();
  const bs = blocks(houseFire(run));
  const points = Object.fromEntries(json(`(() => { const M = model();
    return M.gaps.filter(g => g.essential).map(g => [g.cat + "|" + g.label, Math.max(0, scoreIfShopped(M, [shopFromGap(g, M.h)]) - M.overall)]); })()`));
  const cats = json(`Object.fromEntries(Object.keys(ESSENTIALS).map(c => [catLabel(c), c]))`);
  let shown = 0;
  for (const b of bs) for (const p of b.pills.filter(p => !p.have)) {
    const key = cats[b.name] + "|" + p.label;
    assert.ok(key in points, `${key} is a gap`);
    assert.equal(p.gain, points[key], key);
    if (!points[key]) assert.doesNotMatch(p.text, /\+\d/, `${key} shows no gain`);
    shown += p.gain > 0;
  }
  assert.ok(shown > 0, "some pill is worth points");
});

test("Add N to list adds the block's unlisted missing essentials once, each with its essential", () => {
  const { run, json } = screenshotCase();
  run(`ACT.shopAdd({ dataset: { cat: "documents", essential: "insurance" } })`);
  const docs = blocks(houseFire(run)).find(b => b.name === "Documents & cash");
  assert.equal(docs.button, "Add 2 to list");
  const before = json("shopItems().length");
  run(`ACT.shopAddBlock({ dataset: ${JSON.stringify(docs.data)} })`);
  const added = json("shopItems()").slice(before);
  assert.deepEqual(added.map(e => [e.cat, e.essential]).sort(), [["documents", "id_copies"], ["documents", "records"]]);
  run(`ACT.shopAddBlock({ dataset: ${JSON.stringify(docs.data)} })`);
  assert.equal(json("shopItems().length"), before + 2, "a second tap adds nothing");
  assert.equal(blocks(houseFire(run)).find(b => b.name === "Documents & cash").button, null, "no button once every one is listed");
  assert.doesNotMatch(run("viewOverview(model())"), /Add 0 to list/);
});

test("counted categories stay chips under Counted by amount", () => {
  const { run } = screenshotCase();
  const html = houseFire(run);
  assert.deepEqual(blocks(html).map(b => b.name).sort(), ["Documents & cash", "Fire safety", "Medications"]);
  assert.ok(html.includes("Counted by amount"));
  const counted = html.slice(html.indexOf("Counted by amount"));
  for (const cat of ["Light", "Clothing"]) assert.match(counted, new RegExp(`<span class="chip[^"]*">(<svg[\\s\\S]*?</svg>)?${cat} · \\d+ of \\d+</span>`), cat);
});

test("the kit panel uses the same blocks, and the kit list names what's missing", () => {
  const { run } = screenshotCase();
  run(`S.openKit = "go"`);
  const bs = blocks(run("viewKits(model())"));
  const docs = bs.find(b => b.name === "Documents & cash");
  assert.equal(docs.of, "1 of 4");
  assert.deepEqual(docs.pills.filter(p => p.have).map(p => p.label), ["Cash"]);
  assert.match(bs.find(b => b.name === "Medications").text, /4 items, counts once/);
  assert.deepEqual(bs.map(b => b.name).sort(), ["Comms", "Documents & cash", "Medications", "Tools"]);
  const line = plain(run(`kitRow(S.kits.find(k => k.id === "go"), model().kitRes.go)`).match(/<p class="kit-miss[^>]*>([\s\S]*?)<\/p>/)[1]);
  assert.match(line, /^Missing ID copies, insurance cards and \d+ more\./);
  assert.doesNotMatch(line, /\bcash\b/i);
});

test("a person's name holding markup is escaped in their prescriptions pill", () => {
  const { run } = screenshotCase();
  const evil = `<img src=x onerror=alert(1)>`;
  run(`S.profile.members[1].label = ${JSON.stringify(evil)}`);
  const html = houseFire(run);
  assert.ok(!html.includes(evil));
  const meds = blocks(html).find(b => b.name === "Medications");
  assert.ok(meds.pills.some(p => p.label === `${evil}'s prescriptions`), meds.pills.map(p => p.label).join(" / "));
  run(`S.openKit = "go"`);
  assert.ok(!run("viewKits(model())").includes(evil));
  assert.ok(!run("viewOverview(model())").includes(evil));
});

test("a block names its items still to tag and its expired items, which don't count", () => {
  const { run } = screenshotCase();
  run(`S.items.push({ id: "z1", kitId: "go", name: "Zip pouch of papers", category: "documents", qty: 1 })`);
  const bs = blocks(houseFire(run));
  assert.match(bs.find(b => b.name === "Documents & cash").text, /\b1 item still to tag: Zip pouch of papers\b/);
  assert.match(bs.find(b => b.name === "Medications").text, /\bOld ibuprofen expired 2020-01, so it doesn't count\b/);
  run(`S.items.push({ id: "z2", kitId: "go", name: "Folder", category: "documents", qty: 1, essential: "none" }, { id: "z3", kitId: "go", name: "Binder", category: "documents", qty: 1 })`);
  assert.match(blocks(houseFire(run)).find(b => b.name === "Documents & cash").text, /\b2 items still to tag: Zip pouch of papers and Binder\b/);
});

// Layout at phone width, in a real browser (tests/phone.js). Skipped when there's no Chrome.
const { chrome, atPhoneWidth } = require("./phone");

test("at 390px every block shows its bar and nothing scrolls sideways, in opened emergencies and kit panels", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const fixtures = ["tests/household", "fixtures/phone-width/long-essentials", "fixtures/empty-and-one/big-household"];
  const seen = atPhoneWidth(fixtures, () => {
    const look = where => ({ where, width: innerWidth, scroll: document.documentElement.scrollWidth,
      bars: [...document.querySelectorAll(`#v-${S.view} .ess-blk .bar`)].map(b => b.getBoundingClientRect().width),
      rowBars: [...document.querySelectorAll(`#v-${S.view} .hz-row > .bar`)].map(b => b.getBoundingClientRect().width) });
    S.view = "overview"; S.showOff = true; S.openHz = new Set(HAZARDS.map(h => h.id)); render();
    const views = [look("opened emergencies")];
    for (const k of S.kits) { S.view = "kits"; S.openKit = k.id; render(); views.push(look(`kit ${k.name}`)); }
    return views;
  });
  for (const f of fixtures) {
    const views = seen.get(f);
    assert.ok(views && views[0].bars.length > 0 && views[0].rowBars.length > 0, `${f}: no blocks or rows in its opened emergencies`);
    for (const v of views) {
      assert.equal(v.width, 390, `${f}, ${v.where}: the viewport isn't 390px`);
      assert.ok(v.scroll <= v.width, `${f}, ${v.where}: scrolls sideways (${v.scroll}px wide)`);
      assert.ok(v.bars.every(w => w > 0), `${f}, ${v.where}: a block's bar is hidden (widths ${v.bars.join(", ")})`);
      assert.ok(v.rowBars.every(w => w === 0), `${f}, ${v.where}: an emergency row's own bar shows on a phone`);
    }
  }
});
