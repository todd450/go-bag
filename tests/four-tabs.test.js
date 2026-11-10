// Four tabs (issue #119, part of #115): the Shopping tab is folded into Kits, where each kit's To get and All kits (#118)
// hold the list. Nothing on the page opens a "shop" tab any more. An old #shop link, and the toast after adding an
// emergency's missing items to the list, open the Kits tab with All kits open.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, useFixture, PAGE, ROOT } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");

const households = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];
const page = fs.readFileSync(PAGE, "utf8");
// What the browser builds before the script runs: the page without its styles and its script
const markup = page.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<script>[\s\S]*?<\/script>/, "");
// Ways markup could still open the Shopping tab: a tab button, a link to its address, or its section
const SHOP = [/data-v="shop"/, /href="#shop"/, /id="v-shop"/];

// The page's elements kept by selector, so what render() writes into each can be read back, and the addresses the
// page writes, in order
function screen(app) {
  app.run(`globalThis.SHOWN = {}; globalThis.URLS = [];
    document.querySelector = s => SHOWN[s] ||= { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, setAttribute() {},
      focus() {}, reset() {}, hidden: true, innerHTML: "", textContent: "", value: "", style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} } };
    history.replaceState = (_, __, url) => URLS.push(url);`);
}
// Which tabs are showing after a redraw, and whether the Kits tab shows All kits in place of a kit
const shows = app => app.json(`(() => { render(); const on = VIEWS.filter(v => !SHOWN["#v-" + v].hidden);
  return { on, allKits: on.includes("kits") && SHOWN["#v-kits"].innerHTML.includes(viewShop(model())) }; })()`);
// Every write the page makes
function recordWrites(app) {
  app.run(`globalThis.WRITES = [];
    setDoc = (f => (...a) => { WRITES.push(["set", a[0], a[1]]); return f(...a); })(setDoc);
    delDoc = (f => (...a) => { WRITES.push(["delete", a[0], a[1]]); return f(...a); })(delDoc);`);
  return () => app.json("WRITES");
}
const tap = (app, act, ds = {}) => app.run(`ACT.${act}({ dataset: ${JSON.stringify(ds)} })`);
// What a tap on the toast's button does: the toast closes, then its action runs
const tapToast = app => app.run(`(a => { toastAction = null; SHOWN["#toast"].hidden = true; a.run(); })(toastAction)`);

test("the page has four tabs, each with its nav button, its icon and its section", () => {
  const app = load(), views = app.json("VIEWS");
  assert.deepEqual(views, ["overview", "kits", "household", "plan"]);
  const nav = markup.match(/<nav [^>]*id="tabs"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(nav, "the page has its nav");
  assert.deepEqual([...nav[1].matchAll(/<button\b[^>]*>/g)].map(([b]) => b.match(/ data-v="([^"]*)"/)?.[1]), views, "four nav buttons, one per tab, in order");
  assert.deepEqual([...markup.matchAll(/<section [^>]*id="v-([^"]*)"/g)].map(m => m[1]), views, "a section per tab");
  assert.deepEqual(app.json("Object.keys(TAB_ICON)"), views, "an icon per tab, and none for a tab that's gone");
});

test("nothing in the page's markup or script opens a Shopping tab", () => {
  for (const re of SHOP) assert.doesNotMatch(markup, re, "the page's markup");
  assert.doesNotMatch(page, /\bview\s*=\s*["'`]shop["'`]/, 'nothing sets S.view to "shop"');
});

for (const name of households) {
  test(`${name}: no tab links to a Shopping tab, with every gap planned or with none`, () => {
    for (const planned of [false, true]) {
      const app = load({ fixture: name }), at = `${name}, ${planned ? "every gap planned" : "no lines"}`;
      screen(app);
      app.run(`syncDraft(); S.shopping = null; ${planned ? "ACT.shopAddAll();" : ""}`);
      if (planned) assert.equal(app.run("splitListed(model().gaps).off.length"), 0, `${at}: every gap is on the list`);
      const drawn = [];
      const look = label => drawn.push([label, app.run(`render(); ["#v-" + S.view, "#banner", "#hdr-score"].map(s => SHOWN[s].innerHTML).join("")`)]);
      // Every tab, with every emergency open on Readiness, and each kit's Packed, To get and All kits on Kits
      for (const v of app.json("VIEWS")) {
        app.run(`S.view = ${JSON.stringify(v)}; S.showOff = true; S.openHz = new Set(model().results.map(r => r.hz.id))`);
        look(v);
        if (v !== "kits") continue;
        for (const id of app.json("S.kits.map(k => k.id)")) {
          tap(app, "openKit", { id }); look(`${v}, ${id} Packed`);
          tap(app, "kitSide", { v: "get" }); look(`${v}, ${id} To get`);
          tap(app, "allKits"); look(`${v}, ${id} All kits`);
        }
      }
      for (const [label, html] of drawn) {
        assert.ok(html.length, `${at}, ${label}: drew something`);
        for (const re of SHOP) assert.doesNotMatch(html, re, `${at}, ${label}`);
      }
      assert.equal(app.run(`"#v-shop" in SHOWN`), false, `${at}: the page never looks for a Shopping tab's section`);
    }
  });
}

test("an old #shop link starts on Kits with All kits open; #review still starts on Plan, and no hash on Readiness", () => {
  for (const name of households) {
    const kits = load({ fixture: name }).run("S.kits.length");
    for (const [hash, on] of [["#shop", "kits"], ["#review", "plan"], ["", "overview"], ["#kits", "kits"], ["#plan", "plan"]]) {
      const app = load({ fixture: name, hash }), at = `${name}, "${hash}"`;
      screen(app);
      const s = shows(app);
      assert.deepEqual(s.on, [on], `${at}: starts on ${on}`);
      // #kits opens a kit, as it did before; a household with no kits shows All kits on Kits whichever way it came
      if (on === "kits") assert.equal(s.allKits, hash === "#shop" || !kits, `${at}: All kits ${s.allKits ? "open" : "closed"}`);
      if (hash === "#shop" && kits) {
        assert.equal(app.run("S.allKits"), app.run("S.openKit"), `${at}: All kits is open from the kit the Kits tab opened`);
        assert.match(app.run(`SHOWN["#v-kits"].innerHTML`), /data-act="allBack"/, `${at}: with Back to that kit`);
      }
    }
  }
});

test("from an old #shop link, All kits stays open as the household arrives, and lets go once a kit is opened", async () => {
  // The page draws before the household loads, then again as it arrives
  const app = load({ hash: "#shop" });
  screen(app);
  assert.deepEqual(shows(app), { on: ["kits"], allKits: true }, "before the household arrives");
  useFixture(app, "tests/household");
  assert.deepEqual(shows(app), { on: ["kits"], allKits: true }, "once it has arrived");
  tap(app, "allBack");
  assert.deepEqual(shows(app), { on: ["kits"], allKits: false }, "Back shows the kit");
  tap(app, "openKit", { id: "car" });
  assert.deepEqual(shows(app), { on: ["kits"], allKits: false }, "another kit opens on its own page");
  // Deleting the open kit opens the first kit that's left, on its own page
  app.run("S.loaded = true");
  await app.run(`ACT.delKit({ dataset: { id: "car" } })`);
  assert.deepEqual(shows(app), { on: ["kits"], allKits: false }, "after deleting a kit");
});

test("from an old #shop link to a household with no kits, the first kit added opens on its own page", async () => {
  const app = load({ fixture: "fixtures/empty-and-one/new-household", hash: "#shop" });
  screen(app);
  app.run("S.loaded = true");
  assert.deepEqual(shows(app), { on: ["kits"], allKits: true });
  for (const [name, type] of [["Hall bag", "go"], ["Trunk box", "car"]]) {
    app.run(`$("#nk-name").value = ${JSON.stringify(name)}; $("#nk-type").value = ${JSON.stringify(type)}; $("#nk-where").value = ""`);
    await app.fire("submit", { dataset: { submit: "newKit" }, reset() {} });
    assert.equal(app.run("S.kits.find(k => k.id === S.openKit)?.name"), name);
    assert.deepEqual(shows(app), { on: ["kits"], allKits: false }, `${name} opens on its own page`);
  }
  await app.run(`ACT.delKit({ dataset: { id: S.openKit } })`);
  assert.deepEqual(shows(app), { on: ["kits"], allKits: false }, "after deleting one, the kit left opens on its own page");
});

// Every emergency's Add button, as Readiness draws it with every emergency open: its emergency's id and its label
const OPEN = `S.view = "overview"; S.showOff = true; S.openHz = new Set(model().results.map(r => r.hz.id)); render(); SHOWN["#v-overview"].innerHTML`;
const addButtons = app => [...app.run(OPEN).matchAll(/<button [^>]*data-act="shopAddHz"[^>]*>([^<]*)</g)].map(([b, label]) => ({ id: b.match(/ data-id="([^"]*)"/)[1], label }));
// Taps an emergency's Add, then the toast's action: the toast shows the action, which opens Kits on All kits and writes nothing
function addThenSeeList(app, writes, id, at) {
  const left = addButtons(app).some(b => b.id === id), n = writes().length;
  tap(app, "shopAddHz", { id });
  // An emergency with nothing left to add saves nothing, and says it's all on the list already
  assert.equal(writes().length > n, left, `${at}: ${left ? "saves the list" : "saves nothing"}`);
  const t = app.json(`({ label: toastAction?.label, button: SHOWN["#toast-act"].textContent, shown: !SHOWN["#toast-act"].hidden, toast: !SHOWN["#toast"].hidden })`);
  assert.ok(t.label && t.label.trim(), `${at}: the toast has an action`);
  assert.deepEqual([t.button, t.shown, t.toast], [t.label, true, true], `${at}: its button shows, labelled`);
  const saved = () => app.run(`JSON.stringify([S.kits, S.items, ...HOUSEHOLD_DOCS.map(k => S[k])])`), was = saved(), wrote = writes().length;
  tapToast(app);
  assert.deepEqual(shows(app), { on: ["kits"], allKits: true }, `${at}: opens Kits with All kits open`);
  assert.equal(app.run("URLS.at(-1)"), "#kits", `${at}: the address says Kits`);
  assert.equal(writes().length, wrote, `${at}: See list writes nothing`);
  assert.equal(saved(), was, `${at}: and changes nothing saved`);
}

test("every emergency's Add toasts See list, which opens Kits on All kits and writes nothing", () => {
  const app = load({ fixture: "tests/household" }), writes = recordWrites(app);
  screen(app);
  app.run("syncDraft(); S.shopping = null");
  const all = addButtons(app);
  assert.ok(all.filter(b => b.label.includes(" missing ")).length >= 2, `emergencies with "Add the N missing": ${all.map(b => b.label)}`);
  // In turn, so one that an earlier one planned has nothing left to add
  for (const { id } of all) addThenSeeList(app, writes, id, id);
});

for (const name of households.filter(h => h !== "tests/household")) {
  test(`${name}: an emergency's Add toasts See list, which opens Kits on All kits and writes nothing`, () => {
    const app = load({ fixture: name }), writes = recordWrites(app);
    screen(app);
    app.run("syncDraft(); S.shopping = null");
    const first = addButtons(app)[0];
    if (!first) return assert.equal(app.run("splitListed(model().gaps).off.length"), 0, `${name}: no Add button, as there's no gap`);
    // Twice: adding its missing items, then with them all on the list
    for (const k of [1, 2]) addThenSeeList(app, writes, first.id, `${name}, ${first.id} ${k}`);
  });
}

// In Chrome at 390px: an emergency's "Add the N missing" toasts with See list on one line beside the message, the toast
// on screen above the tab bar, and a real tap on See list opens Kits with All kits open
test("at 390px the toast's See list is on one line, and tapping it opens Kits on All kits", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const seen = atPhoneWidth(["tests/household", "fixtures/empty-and-one/new-household"], () => {
    const M = model(), off = new Set(splitListed(M.gaps).off), id = M.results.find(r => hzGaps(M, r).filter(g => off.has(g)).length > 1).hz.id;
    S.openHz = new Set([id]); render();
    document.querySelector(`[data-act="shopAddHz"][data-id="${id}"]`).click();
    // How many lines an element's text takes
    const lines = e => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size; };
    const t = document.querySelector("#toast"), b = document.querySelector("#toast-act"), box = t.getBoundingClientRect();
    const toast = { shown: !t.hidden && !b.hidden, left: box.left, right: box.right, bottom: box.bottom, width: box.width, label: lines(b),
      message: lines(document.querySelector("#toast-msg")), navTop: document.querySelector("#tabs").getBoundingClientRect().top, screen: innerWidth };
    b.click();
    const a = document.activeElement;
    return { toast, view: S.view, current: document.querySelector('#tabs [aria-current="page"]')?.dataset.v, kits: S.kits.length,
      groups: document.querySelectorAll("#v-kits .shop-g").length, focus: a?.id || a?.tagName, closed: t.hidden };
  });
  assert.equal(seen.size, 2);
  for (const [f, r] of seen) {
    const t = r.toast;
    assert.equal(t.screen, 390, f);
    assert.ok(t.shown, `${f}: the toast shows its button`);
    assert.equal(t.label, 1, `${f}: See list is on one line`);
    assert.ok(t.left >= 0 && t.right <= t.screen, `${f}: the toast is on screen (${t.left} to ${t.right})`);
    assert.ok(t.bottom <= t.navTop, `${f}: the toast is above the tab bar`);
    // A message wraps only once the toast is as wide as it can be, the screen less 16px a side
    if (t.message > 1) assert.ok(t.width >= t.screen - 33, `${f}: the message wraps in a toast ${t.width}px wide`);
    assert.deepEqual([r.view, r.current, r.closed], ["kits", "kits", true], `${f}: See list opens Kits, and the toast closes`);
    assert.ok(r.groups > 0, `${f}: All kits is open`);
    if (r.kits) assert.equal(r.focus, "kit-back", `${f}: focus is on Back to the kit`);
  }
});
