// Each kit's Packed | To get switch (issue #118, part of #115). Packed shows what a kit showed before. To get shows the
// kit's share of the shopping list, with its sum and Share list (Order and Spend up to are Review's, #121), then a Review
// chip, which opens the whole list (viewShop) in a sheet over the page, with a Close button. Which side is on, and
// whether Review is open, live in memory only.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");

const households = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

// The switch: two buttons in a .seg group, "Packed · N" then "To get · N". Packed is checked against main without it.
const SWITCH = /<div class="seg[^"]*" role="group"[^>]*><button [^>]*>Packed · \d+<\/button><button [^>]*>To get · \d+<\/button><\/div>/g;

/* Packed, byte for byte main's. Each kit of each household is drawn on Packed in eight ways (no lines or every gap
   planned, writer or read-only, Flat-lay or List) with the clock fixed, so an expiry date never moves what it says, and
   new ids counted, so a planned tile's line id is the same on every run (#120). Main's drawings are recorded as hashes in MAIN, so CI compares against them with no git history. A change that
   alters Packed on purpose records them again, from that change's page:
     GO_BAG_PAGE=<page.html> node tests/kit-toget.test.js --record */
function packed() {
  const out = {}, now = Date.UTC(2026, 10, 9);
  for (const fixture of households) {
    const app = load({ fixture });
    app.run(`(D => { globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [${now}])); } static now() { return ${now}; } }; })(Date)`);
    app.run(`(n => { globalThis.crypto = { randomUUID: () => "id" + ++n }; })(0)`);
    for (const id of app.json("S.kits.map(k => k.id)")) {
      const draws = [];
      for (const lines of ["S.shopping = null", "S.shopping = null; ACT.shopAddAll()"]) for (const w of [true, false]) for (const list of [false, true]) {
        draws.push(app.run(`${lines}; S.canWrite = ${w}; S.view = "kits"; S.openKit = ${JSON.stringify(id)}; S.listKit = ${list} ? S.openKit : null;
          (k => kitDetail(k, model().kitRes[k.id], model()))(S.kits.find(k => k.id === S.openKit))`).replace(SWITCH, ""));
      }
      out[`${fixture} ${id}`] = crypto.createHash("sha256").update(JSON.stringify(draws)).digest("hex").slice(0, 20);
    }
  }
  return out;
}
if (process.argv.includes("--record")) { console.log(JSON.stringify(packed(), null, 1)); process.exit(0); }
const MAIN = {
 "tests/household go": "ef0bbe9cc28dc217af71",
 "tests/household home": "64bfd73a06044d7f9cb0",
 "tests/household car": "5cba926623a346d4f528",
 "fixtures/data-and-account-shapes/essential-tags go": "91c51647253b34554f6b",
 "fixtures/data-and-account-shapes/essential-tags home": "8bd9b306cfd1835fa80e",
 "fixtures/data-and-account-shapes/essential-tags car": "0b8584db57258d70faa8",
 "fixtures/data-and-account-shapes/odd-container c-null": "ab13f8e2d192d2fe4537",
 "fixtures/data-and-account-shapes/odd-container c-array": "451e405d2adcafe6e96c",
 "fixtures/data-and-account-shapes/odd-container c-string": "155bc9a0781a92191c75",
 "fixtures/data-and-account-shapes/odd-container c-boat": "656b97c3f67c026f90d0",
 "fixtures/data-and-account-shapes/odd-container c-neg": "2d32fc389d9ff625fda6",
 "fixtures/data-and-account-shapes/odd-container c-long": "397a664977e50bf71156",
 "fixtures/data-and-account-shapes/odd-container c-home": "4e8a77a1c8c626cbfc1f",
 "fixtures/data-and-account-shapes/odd-values k": "ff86c532f2b5f8f12cf9",
 "fixtures/data-and-account-shapes/odd-values g": "d4d8a225bab9403295c3",
 "fixtures/empty-and-one/big-household g": "38bafcde29d2ab6d8495",
 "fixtures/empty-and-one/big-household h": "d4ed60a6b04a8a618e1b",
 "fixtures/empty-and-one/big-household c": "05d70e85e40a3ff7b114",
 "fixtures/empty-and-one/one-person k": "b2f3c0870a5fdf6bfccd",
 "fixtures/phone-width/box-container car": "be3a55f3d692582a0951",
 "fixtures/phone-width/box-container go": "ae481d23c0eacfdbc0f8",
 "fixtures/phone-width/box-container home": "16229a5c4fe675cb37cd",
 "fixtures/phone-width/long-container go": "7073a4d22ba297bfb4a2",
 "fixtures/phone-width/long-container car": "8949b42a222e0fc740da",
 "fixtures/phone-width/long-container home": "61b9b97e2cfe0811dab0",
 "fixtures/phone-width/long-essentials go": "1b1bfaea11862e071d08",
 "fixtures/phone-width/long-essentials home": "68707f3bbd52e3901877",
 "fixtures/phone-width/long-essentials car": "ef3499545c292e0bdae1",
 "fixtures/phone-width/long-kit-name home": "3c729db1a24ae25ac4d7",
 "fixtures/phone-width/long-kit-name car": "896ded9050753874f2c5",
 "fixtures/phone-width/long-kit-name go": "2e46a67975eb8ecf39c5"
};

const { chrome, atPhoneWidth } = require("./phone");
const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = html => unesc(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
// A tag's attributes, read back from their escaped values, and its data-* ones as a button's dataset
const attrs = tag => Object.fromEntries([...tag.matchAll(/ ([a-z-]+)(?:="([^"]*)")?/g)].map(m => [m[1], unesc(m[2] ?? "")]));
const dataset = tag => Object.fromEntries(Object.entries(attrs(tag)).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5), v]));
// Every button: its label, its data-* as the click handler hands them to its ACT, and whether it is pressed
const buttons = html => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, a, body]) => ({ label: text(body), ds: dataset(a), pressed: attrs(a)["aria-pressed"] }));
// The switch's two sides as [label, pressed]. A kit has exactly one switch.
function sides(html) {
  const all = html.match(SWITCH) || [];
  assert.equal(all.length, 1, "one switch");
  return buttons(all[0]).map(b => [b.label, b.pressed]);
}
const count = (html, side) => +sides(html).find(([l]) => l.startsWith(side))[0].match(/\d+$/)[0];
// Taps the one button labelled `label` (or "`label` · N", for the switch's sides), as a click does
function press(app, html, label) {
  const bs = buttons(html).filter(b => b.ds.act && (b.label === label || b.label.startsWith(label + " · ")));
  assert.equal(bs.length, 1, `one "${label}" button`);
  return app.run(`ACT[${JSON.stringify(bs[0].ds.act)}](${JSON.stringify({ dataset: bs[0].ds })})`);
}
const kitsTab = app => app.run(`S.view = "kits"; viewKits(model())`);
// Opens a kit the way its tag on the Kits tab does, and returns the tab; getSide then taps To get
const open = (app, id) => { app.run(`S.view = "kits"; ACT.openKit({ dataset: { id: ${JSON.stringify(id)} } })`); return kitsTab(app); };
const getSide = (app, id) => { press(app, open(app, id), "To get"); return kitsTab(app); };
// What a kit's To get shows below the switch: its open lines (ids), its gaps (keys, from their Plan buttons, which a
// read-only viewer doesn't get), how many gap rows, and its buttons
function toGet(html) {
  const at = html.search(SWITCH);
  assert.ok(at >= 0, "a switch");
  const body = html.slice(at).replace(SWITCH, "");
  return {
    body,
    lines: [...body.matchAll(/<li class="shop-row[^"]*">[\s\S]*?<\/li>/g)].map(([r]) => attrs(r.match(/<input [^>]*>/)[0])["data-id"]).sort(),
    gaps: buttons(body).filter(b => b.ds.act === "shopAdd").map(b => `${b.ds.cat}|${b.ds.essential || ""}`).sort(),
    gapRows: (body.match(/<li class="shop-gap">/g) || []).length,
    buttons: buttons(body),
  };
}
// The Review sheet on the Kits tab, or "" when it's closed
const sheet = html => html.match(/<div class="review-sheet stack" role="dialog"[\s\S]*$/)?.[0] || "";
// What a kit's To get should list: the open lines shopKit sends to it, and its kitGaps that aren't on the list
const want = (app, id) => app.json(`(id => { const M = model(), on = splitListed(M.gaps).on;
  return { lines: shopItems().filter(e => !e.done && shopKit(e) === id).map(e => e.id).sort(), gaps: kitGaps(M, id).filter(g => !on.includes(g)).map(gapKey).sort() }; })(${JSON.stringify(id)})`);
// Every write the page makes, recorded as [col, id]
function recordWrites(app) {
  app.run(`globalThis.WRITES = []; setDoc = (s => (...a) => { WRITES.push([a[0], a[1]]); return s(...a); })(setDoc);
    delDoc = (d => (...a) => { WRITES.push(["delete", a[0], a[1]]); return d(...a); })(delDoc)`);
  return () => app.json("WRITES");
}
// Lines of every sort: half the gaps planned, cycling through each kit, "Not in a kit yet", no kit and a kit that's gone,
// plus a typed line, an unknown category and a ticked line.
const SEED = `(() => { const M = model(), to = [...S.kits.map(k => k.id), "none", "", "gone"];
  S.shopping = { items: [
    ...M.gaps.filter((g, i) => i % 2 === 0).map((g, i) => ({ ...shopFromGap(g, M.h), kitId: to[i % to.length] })),
    { id: "typed", cat: "", text: "Spare reading glasses", done: false, at: 1 },
    { id: "odd", cat: "retired-category", text: "Old entry", qty: "two", done: false },
    ...(M.gaps[1] ? [{ ...shopFromGap(M.gaps[1], M.h), id: "ticked", done: true, inKit: S.kits[0]?.id }] : []),
  ] }; })()`;
const CASES = { "no lines": "S.shopping = null", "every gap planned": "S.shopping = null; ACT.shopAddAll()", "lines given kits": SEED };
const NAMES = { go: "Hall closet go-bag", home: "Basement bin", car: "Trunk bag" };

test("Packed · N counts the kit's items, and To get · N its open lines plus its gaps not on the list", async () => {
  const app = load({ fixture: "tests/household" });
  const counts = () => Object.keys(NAMES).map(id => sides(open(app, id)).map(([l]) => l));
  const shown = [["Packed · 3", "To get · 9"], ["Packed · 3", "To get · 28"], ["Packed · 1", "To get · 3"]];
  assert.deepEqual(counts(), shown);
  app.run("ACT.shopAddAll()");
  assert.deepEqual(counts(), shown, "every gap is now an open line in the same kit");
  // Ticking one of a kit's lines, from its row on To get, puts it in the kit
  for (const id of Object.keys(NAMES)) {
    const html = getSide(app, id), line = toGet(html).lines[0], was = [count(html, "Packed"), count(html, "To get")];
    await app.fire("change", { dataset: { change: "shopTick", id: line }, checked: true });
    const now = kitsTab(app);
    assert.deepEqual([count(now, "Packed"), count(now, "To get")], [was[0] + 1, was[1] - 1], `${NAMES[id]}: ticking ${line}`);
  }
});

test("with Packed on, every kit shows Packed pressed under its header, and without the switch its markup is main's", () => {
  for (const fixture of households) {
    const app = load({ fixture });
    for (const id of app.json("S.kits.map(k => k.id)")) {
      for (const w of [true, false]) {
        app.run(`S.canWrite = ${w}`);
        const html = open(app, id), at = html.search(SWITCH);
        assert.deepEqual(sides(html).map(([, p]) => p), ["true", "false"], `${fixture} ${id}`);
        assert.ok(html.indexOf("</h2>") < at && at < html.indexOf("Kit readiness"), `${fixture} ${id}: under the header, above the panels`);
      }
    }
  }
  const now = packed();
  assert.deepEqual(Object.keys(now), Object.keys(MAIN), "the same kits as main");
  for (const key of Object.keys(MAIN)) assert.equal(now[key], MAIN[key], `${key}: Packed differs from main's (record main's page with --record to compare)`);
});

test("the Trunk bag's To get lists its three gaps, plans them into the Trunk bag, and shares only its lines", async () => {
  const app = load({ fixture: "tests/household" }), writes = recordWrites(app);
  let t = toGet(getSide(app, "car"));
  assert.deepEqual(t.gaps, ["car|", "comfort|", "first_aid|"]);
  assert.equal(t.gapRows, 3);
  const others = app.json(`(M => [...kitGaps(M, "go"), ...kitGaps(M, "home")].map(gapKey))(model())`);
  assert.equal(others.length, 37);
  assert.ok(others.every(k => !t.gaps.includes(k)), "none of the other kits' gaps");
  assert.match(text(t.body), /Not on your list yet · 3/);
  for (const b of t.buttons.filter(b => /^shopAdd/.test(b.ds.act))) assert.equal(b.ds.kit, "car", b.label);
  assert.ok(t.buttons.some(b => b.ds.act === "shopAddTop" && b.label === "Plan the top 3"));
  assert.ok(!t.buttons.some(b => b.ds.act === "shopShare"), "no tools with nothing on the list");
  assert.deepEqual(writes(), [], "showing To get writes nothing");

  const plan = t.buttons.find(b => b.ds.act === "shopAdd");
  app.run(`ACT.shopAdd(${JSON.stringify({ dataset: plan.ds })})`);
  assert.deepEqual(writes(), [["household", "shopping"]], "one write");
  const [line, ...more] = app.json("shopItems()");
  assert.equal(more.length, 0);
  assert.equal(line.kitId, "car");
  t = toGet(kitsTab(app));
  assert.deepEqual(t.lines, [line.id], "the planned gap is now the Trunk bag's line");
  assert.equal(t.gaps.length, 2);
  assert.equal(count(kitsTab(app), "To get"), 3, "a gap planned is still one thing to get");

  // Plan the top 2, then the tools: Share list carries the kit, and shares only the Trunk bag's lines
  press(app, kitsTab(app), "Plan the top 2");
  assert.deepEqual(app.json("shopItems().map(e => e.kitId)"), ["car", "car", "car"]);
  app.run(`ACT.shopAddAll(); globalThis.SHARED = []; navigator.share = d => { SHARED.push(d); return Promise.resolve(); }`);
  t = toGet(kitsTab(app));
  assert.equal(t.lines.length, 3);
  const share = t.buttons.filter(b => b.ds.act === "shopShare");
  assert.deepEqual(share.map(b => b.ds), [{ act: "shopShare", kit: "car" }]);
  assert.match(text(t.body), /3 to buy/);
  assert.ok(!t.body.includes('id="shop-sort"') && !t.body.includes('id="shop-budget"'), "no Order or Spend up to $: they're Review's");
  assert.match(text(t.body), /About \$\d+/, "the sum");
  await app.run(`ACT.shopShare(${JSON.stringify({ dataset: share[0].ds })})`);
  const lines = app.json(`shopItems().filter(e => !e.done && shopKit(e) === "car").map(x => { const i = shopInfo(x, model()); return "- " + i.line + (i.sub && i.sub !== i.line ? " (" + i.sub + ")" : ""); })`);
  const [title, ...rest] = app.json("SHARED")[0].text.split("\n");
  assert.equal(title, "Emergency kit shopping list");
  assert.deepEqual(rest, lines);
  assert.equal(app.json("shopItems().filter(e => !e.done).length"), 40, "while the list holds every kit's lines");
});

for (const name of households) {
  test(`${name}: each kit's To get lists exactly the lines shopKit sends it and its gaps not on the list`, () => {
    for (const [label, setup] of Object.entries(CASES)) {
      const app = load({ fixture: name });
      app.run(setup);
      for (const id of app.json("S.kits.map(k => k.id)")) {
        const html = getSide(app, id), t = toGet(html), at = `${name}, ${label}, ${id}`, w = want(app, id);
        assert.deepEqual({ lines: t.lines, gaps: t.gaps }, w, at);
        assert.equal(t.gapRows, w.gaps.length, `${at}: one row per gap`);
        const n = app.run(`S.items.filter(i => i.kitId === ${JSON.stringify(id)}).length`);
        assert.deepEqual(sides(html), [[`Packed · ${n}`, "false"], [`To get · ${w.lines.length + w.gaps.length}`, "true"]], at);
        // The tools are the kit's own, and To get replaces the panels: no readiness, contents, checklist or photos
        assert.deepEqual(t.buttons.filter(b => b.ds.act === "shopShare").map(b => b.ds.kit), w.lines.length ? [id] : [], `${at}: Share list`);
        for (const b of t.buttons.filter(b => /^shopAdd/.test(b.ds.act))) assert.equal(b.ds.kit, id, `${at}: ${b.label}`);
        assert.doesNotMatch(t.body, /Kit readiness|class="fl-|class="ess-blk"|Weight and space|Photograph the contents|<table/, at);
        assert.deepEqual(t.buttons.filter(b => b.label === "Review").map(b => b.ds.act), ["allKits"], `${at}: the Review chip`);
        assert.ok(text(t.body).length > "Review".length, `${at}: says something above the chip`);
      }
    }
  });
}

test("opening a kit, or the same one again, starts it on Packed", () => {
  const app = load({ fixture: "tests/household" });
  for (const [how, id] of [["openKit", "home"], ["gotoKit", "car"], ["openKit", "go"], ["gotoKit", "go"]]) {
    assert.deepEqual(sides(getSide(app, "go")).map(([, p]) => p), ["false", "true"]);
    app.run(`ACT.${how}({ dataset: { id: ${JSON.stringify(id)} } })`);
    assert.deepEqual(sides(kitsTab(app)).map(([, p]) => p), ["true", "false"], `${how} ${id}`);
    assert.match(kitsTab(app), /Kit readiness/, `${how} ${id}`);
    // From Review, too
    press(app, getSide(app, "go"), "Review");
    app.run(`ACT.${how}({ dataset: { id: ${JSON.stringify(id)} } })`);
    assert.deepEqual(sides(kitsTab(app)).map(([, p]) => p), ["true", "false"], `${how} ${id} from Review`);
    assert.equal(sheet(kitsTab(app)), "", `${how} ${id}: Review closes`);
  }
  // A fresh load starts on Packed
  assert.deepEqual(sides(load({ fixture: "tests/household" }).run(`S.view = "kits"; S.openKit = "car"; viewKits(model())`)).map(([, p]) => p), ["true", "false"]);
});

test("Review from the Trunk bag's To get opens the whole list over it, and Close returns to its To get", () => {
  const app = load({ fixture: "tests/household" });
  app.run(SEED);
  press(app, getSide(app, "car"), "Review");
  const html = kitsTab(app), all = app.run("viewShop(model())"), s = sheet(html);
  assert.ok(s.includes(all), "Review is viewShop");
  assert.equal((s.match(SWITCH) || []).length, 0, "no kit in the sheet");
  assert.equal((html.match(SWITCH) || []).length, 1, "the Trunk bag's To get stays behind it");
  assert.match(html, /<div class="kits-grid" inert>/, "and can't be reached while it's open");
  assert.ok(s.indexOf("Close") < s.indexOf(all), "Close is above the list");
  press(app, html, "Close");
  const again = kitsTab(app), w = want(app, "car");
  assert.deepEqual(sides(again), [["Packed · 1", "false"], [`To get · ${w.lines.length + w.gaps.length}`, "true"]]);
  assert.equal(sheet(again), "");
  assert.match(again, /<h2>Trunk bag<\/h2>/);
});

test("a kit's name renders as text in the switch's label and in Review", () => {
  const app = load({ fixture: "tests/household" });
  const evil = ["<img src=x onerror=alert(1)>", '" onfocus="alert(2)', "<b>bold</b> & 'quoted'"];
  app.run(`S.kits.push(...${JSON.stringify(evil)}.map((name, i) => ({ id: "x" + i, name, type: ["go", "car", "home"][i], createdAt: 9 + i })))`);
  app.run("ACT.shopAddAll()");
  evil.forEach((name, i) => {
    const pages = [open(app, "x" + i), getSide(app, "x" + i)];
    press(app, pages[1], "Review");
    pages.push(kitsTab(app));
    for (const html of pages) assert.doesNotMatch(html, /<img src|<b>bold|" onfocus="/, name);
    for (const html of pages.slice(0, 2)) assert.equal(attrs(html.match(SWITCH)[0].match(/^<div [^>]*>/)[0])["aria-label"], name, "the switch is labelled with the kit's name");
    assert.ok(text(sheet(pages[2])).includes(`Goes in ${name}`), "its name in Review's Goes in choices");
    press(app, pages[2], "Close");
  });
});

test("with no kits, the Kits tab says to pick or add a kit, with Review under it, and adding a kit opens it on Packed", async () => {
  const app = load({ fixture: "fixtures/empty-and-one/new-household" });
  const html = kitsTab(app);
  assert.match(text(html), /Pick a kit to see its contents, or add one\. Review/);
  assert.equal(sheet(html), "", "Review is closed");
  assert.equal((html.match(SWITCH) || []).length, 0);
  assert.match(html, /data-submit="newKit"/, "the add-a-kit form is open, as today");
  press(app, html, "Review");
  assert.ok(sheet(kitsTab(app)).includes(app.run("viewShop(model())")), "Review opens");
  press(app, kitsTab(app), "Close");
  // Adding a kit through the form
  const add = async (name, type) => {
    app.run(`(q => { const v = { "#nk-name": ${JSON.stringify(name)}, "#nk-type": ${JSON.stringify(type)}, "#nk-where": "" };
      document.querySelector = s => s in v ? { value: v[s], focus() {} } : q(s); })(document.querySelector)`);
    await app.fire("submit", { dataset: { submit: "newKit" }, reset() {} });
    return app.json(`S.kits.find(k => k.name === ${JSON.stringify(name)}).id`);
  };
  const id = await add("First bag", "go");
  let now = kitsTab(app);
  assert.equal(app.run("S.openKit"), id);
  assert.match(now, /<h2>First bag<\/h2>/);
  assert.deepEqual(sides(now).map(([, p]) => p), ["true", "false"]);
  // A kit added after Review opens on Packed too
  press(app, getSide(app, id), "Review");
  press(app, kitsTab(app), "Close");
  const car = await add("Car kit", "car");
  now = kitsTab(app);
  assert.equal(app.run("S.openKit"), car);
  assert.match(now, /<h2>Car kit<\/h2>/);
  assert.deepEqual(sides(now).map(([, p]) => p), ["true", "false"]);
});

test("switching sides, Review and Close write nothing and store nothing", () => {
  const app = load({ fixture: "tests/household" }), writes = recordWrites(app);
  app.run(`ACT.shopAddAll(); globalThis.STORED = []; globalThis.localStorage = globalThis.sessionStorage = { setItem: (...a) => STORED.push(a), getItem: () => null, removeItem: (...a) => STORED.push(a) };`);
  const before = writes().length, docs = app.json("{ kits: S.kits, items: S.items, shopping: S.shopping, profile: S.profile }");
  for (const id of Object.keys(NAMES)) {
    press(app, getSide(app, id), "Packed");
    press(app, kitsTab(app), "To get");
    press(app, kitsTab(app), "Review");
    press(app, kitsTab(app), "Close");
    press(app, kitsTab(app), "Review");
    app.run("render()");
  }
  app.run(`ACT.gotoKit({ dataset: { id: "go" } }); render()`);
  assert.deepEqual(writes().slice(before), []);
  assert.deepEqual(app.json("STORED"), []);
  assert.deepEqual(app.json("{ kits: S.kits, items: S.items, shopping: S.shopping, profile: S.profile }"), docs, "no doc changes");
});

test("read-only viewers can switch to To get and open Review, with no Plan, Plan the top N, × or add form", async () => {
  const app = load({ fixture: "tests/household" });
  for (const setup of ["S.shopping = null", "ACT.shopAddAll()", SEED]) {
    app.run(`S.canWrite = true; ${setup}`);
    if (setup !== "S.shopping = null") await app.run(`shopTick(shopItems().find(e => !e.done && shopKit(e)).id, true)`);
    app.run("S.canWrite = false");
    for (const id of Object.keys(NAMES)) {
      const get = getSide(app, id);
      press(app, get, "Review");
      const all = kitsTab(app);
      for (const html of [get, all]) {
        for (const act of ["shopAdd", "shopAddTop", "shopDel", "shopClear", "shopAddAll", "shopAddFree"]) assert.doesNotMatch(html, new RegExp(`data-act="${act}"`), `${setup} ${id}: ${act}`);
        assert.doesNotMatch(html, /shop-new|data-submit/, `${setup} ${id}: no add form`);
      }
      assert.equal(toGet(get).gapRows, want(app, id).gaps.length, `${setup} ${id}: the gaps still show`);
      assert.ok(sheet(all).includes(app.run("viewShop(model())")), `${setup} ${id}: Review shows`);
      press(app, all, "Close");
    }
  }
});

// Every household the phone check covers: the standard one, and each phone-width and empty-and-one fixture
const PHONE = ["tests/household", ...households.filter(h => /^fixtures\/(phone-width|empty-and-one)\//.test(h))];
test("at 390px a kit's To get and Review never scroll sideways, with no lines and with every gap planned", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  // Two households a run: Chrome prints each page whole, and more would overflow what execFileSync reads back
  const seen = new Map();
  for (let i = 0; i < PHONE.length; i += 2) for (const [f, r] of measure(PHONE.slice(i, i + 2))) seen.set(f, r);
  assert.equal(seen.size, PHONE.length);
  // Where focus lands after each tap, so a keyboard user keeps their place as the column redraws
  const FOCUS = { "To get": /^To get · \d+$/, Review: /^Close$/, Close: /^Review$/ };
  let kits = 0;
  for (const [f, shots] of seen) {
    assert.ok(shots.length >= 2, `${f}: measured`);
    for (const s of shots) {
      const at = `${f}, ${s.at}`, side = s.at.split(", ")[1]?.replace(/^\S+ /, "");
      assert.equal(s.width, 390, at);
      assert.ok(s.shown, `${at}: rendered`);
      assert.ok(s.scroll <= s.width, `${at}: scrolls sideways (${s.scroll}px)`);
      assert.deepEqual(s.out, [], `${at}: these stick out of the screen`);
      if (FOCUS[side]) assert.match(s.focus, FOCUS[side], `${at}: focus`);
      kits += side === "To get";
    }
  }
  assert.ok(kits >= 20, `only ${kits} To get shots`);
});
function measure(fixtures) {
  return atPhoneWidth(fixtures, () => {
    const view = document.querySelector("#v-kits"), shots = [];
    // A tap as the keyboard makes it: on the focused button
    const tap = f => { const b = [...view.querySelectorAll("button")].find(f); if (b) { b.focus(); b.click(); } return !!b; };
    const look = (at, shown) => {
      const w = innerWidth;
      const a = document.activeElement;
      shots.push({ at, shown, width: w, scroll: document.documentElement.scrollWidth, focus: a && a.tagName === "BUTTON" ? a.textContent.trim() : "",
        out: [...view.querySelectorAll("*")].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.left < -0.5 || r.right > w + 0.5); }).map(e => e.tagName + "." + e.getAttribute("class")) });
    };
    for (const lines of ["no", "every gap as"]) {
      const M = model();
      S.shopping = lines === "no" ? null : { items: M.gaps.map(g => shopFromGap(g, M.h)) };
      S.view = "kits"; render();
      if (!S.kits.length) {
        look(`${lines} lines, no kits`, !!view.querySelector('[data-act="allKits"]'));
        look(`${lines} lines, no-kits Review`, tap(b => b.textContent === "Review") && !!view.querySelector(".review-sheet .shop-gap, .review-sheet .shop-row"));
        look(`${lines} lines, no-kits Close`, tap(b => b.textContent === "Close") && !view.querySelector(".review-sheet"));
      }
      for (const k of S.kits) {
        tap(b => b.dataset.act === "openKit" && b.dataset.id === k.id);
        look(`${lines} lines, ${k.id} To get`, tap(b => b.textContent.startsWith("To get")) && !!view.querySelector('[data-act="allKits"]'));
        look(`${lines} lines, ${k.id} Review`, tap(b => b.textContent === "Review") && !!view.querySelector(".review-sheet"));
        look(`${lines} lines, ${k.id} Close`, tap(b => b.textContent === "Close") && !view.querySelector(".review-sheet") && !!view.querySelector('[data-act="allKits"]'));
      }
    }
    return shots;
  });
}

// Review puts the list's fields on the Kits tab, so a hidden tab that kept its markup could put their ids on the page twice
test("after Review and every other tab, every id on the page is unique, and Review's add field is the one read", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const seen = atPhoneWidth(["tests/household", "fixtures/empty-and-one/new-household"], () => {
    const dup = () => { const ids = [...document.querySelectorAll("[id]")].map(e => e.id); return ids.filter((x, i) => ids.indexOf(x) !== i); };
    const tab = v => document.querySelector(`#tabs button[data-v="${v}"]`).click(), steps = [];
    const step = at => steps.push({ at, dup: dup(), fields: document.querySelectorAll("#shop-new").length });
    // Review over the Kits tab, closed before each other tab (the tabs can't be reached while it's open), and opened again
    const review = () => { if (S.kits.length) [...document.querySelectorAll("#v-kits button")].find(b => b.textContent.startsWith("To get")).click(); document.querySelector('#v-kits [data-act="allKits"]').click(); };
    tab("kits"); review(); step("kits");
    for (const v of ["overview", "household"]) { ACT.allBack(); tab(v); step(v); tab("kits"); review(); step("kits"); }
    // Typing a line on Review: the field it reads is the one on screen, which it then clears
    const f = document.querySelector("#v-kits #shop-new");
    f.value = "Spare reading glasses";
    f.form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    return { steps, left: f.value };
  });
  for (const [f, r] of seen) {
    // Review is open on Kits, the one tab with the field
    for (const s of r.steps) assert.deepEqual([s.dup, s.fields], [[], s.at === "kits" ? 1 : 0], `${f}, ${s.at}`);
    assert.equal(r.left, "", `${f}: Review's field was read`);
  }
});
