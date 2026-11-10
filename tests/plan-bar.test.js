// The plan bar (issue #122, part of #115): on the Kits tab, whenever the shopping list has open lines, a bar says how many
// are planned, about what they cost (summed as Review sums them, prescriptions unpriced) and where readiness lands once
// they're all packed (scoreIfBought of the open lines, Review's own number), with a Review button that opens #121's sheet.
// On phones it's fixed just above the bottom nav; on a desktop it's a sticky card in a third column beside the kit.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { load, ROOT } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");
const { openChrome } = require("../tools/screenshots");
const { wrap } = require("../tools/page");

const households = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];
const PHONE = ["tests/household", ...households.filter(h => /^fixtures\/(phone-width|empty-and-one)\//.test(h))];

const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = html => unesc(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
const tap = (app, act, ds = {}) => app.run(`ACT.${act}({ dataset: ${JSON.stringify(ds)} })`);
const kitsTab = app => app.run(`S.view = "kits"; viewKits(model())`);
const barOf = html => html.match(/<aside class="plan-bar"[\s\S]*?<\/aside>/)?.[0] || "";
// What the bar reads: N planned, about $X, and readiness A → P
function bar(html) {
  const t = text(barOf(html));
  if (!t) return null;
  const n = t.match(/(\d+) planned · about \$([\d,]+)/), r = t.match(/Readiness (\d+) → (\d+) once packed/);
  return { n: n && +n[1], cost: n && +n[2].replace(/,/g, ""), from: r && +r[1], to: r && +r[2] };
}
const EVERY_GAP = "S.shopping = null; ACT.shopAddAll()";

test("tests/household: planning the CPR shield, aspirin and CO alarm reads 3 planned, about $45, 17 → 43; ticking the shield, 2, $35, 31 → 43", async () => {
  const app = load({ fixture: "tests/household" });
  assert.equal(app.run("model().overall"), 17);
  for (const cat of ["cpr", "aspirin", "co_alarm"]) tap(app, "shopAdd", { cat });
  assert.deepEqual(bar(kitsTab(app)), { n: 3, cost: 45, from: 17, to: 43 });
  const cpr = app.json(`shopItems().find(e => e.cat === "cpr")`);
  await app.run(`shopTick(${JSON.stringify(cpr.id)}, true)`);
  assert.equal(app.json(`S.items.find(i => i.category === "cpr" && i.source === "list")?.kitId`), app.json(`S.kits.find(k => k.name === "Basement bin").id`), "the shield went into the Basement bin");
  assert.deepEqual(bar(kitsTab(app)), { n: 2, cost: 35, from: 31, to: 43 });
});

test("with every gap planned, on every household, the bar's numbers are Review's: its count, its sum and scoreIfBought of the open lines", () => {
  for (const name of households) {
    const app = load({ fixture: name });
    app.run(EVERY_GAP);
    const b = bar(kitsTab(app)), review = text(app.run("viewShop(model())"));
    const want = app.json(`(() => { const M = model(), left = shopItems().filter(e => !e.done); return { n: left.length, A: M.overall, P: scoreIfBought(left) }; })()`);
    assert.ok(b, `${name}: the bar shows`);
    assert.equal(b.n, want.n, `${name}: N is the open lines`);
    assert.match(review, new RegExp(`\\b${want.n} to buy\\b`), `${name}: Review's count`);
    const sum = +review.match(/About \$([\d,]+)/)[1].replace(/,/g, "");
    assert.equal(b.cost, sum, `${name}: $X is Review's sum`);
    assert.deepEqual([b.from, b.to], [want.A, want.P], `${name}: A → P is overall → scoreIfBought`);
    if (want.P > want.A) assert.match(review, new RegExp(`Buying it all takes readiness from ${want.A} to ${want.P}\\b`), `${name}: Review's number`);
  }
});

test("prescriptions aren't priced: the sum leaves them out, as Review's does", () => {
  const app = load({ fixture: "tests/household" });
  app.run(EVERY_GAP);
  const rx = app.json(`(() => { const M = model(); return shopItems().filter(e => !e.done && shopInfo(e, M).price === null).length; })()`);
  assert.ok(rx > 0, "the household has a prescription line");
  const total = app.json(`(() => { const M = model(); return shopItems().filter(e => !e.done).reduce((a, e) => a + (shopInfo(e, M).price || 0), 0); })()`);
  assert.equal(bar(kitsTab(app)).cost, total);
});

test("no open lines, no bar; and none on the Readiness, Household or Plan tabs", async () => {
  for (const name of households) {
    const app = load({ fixture: name });
    app.run("S.shopping = null");
    assert.equal(barOf(kitsTab(app)), "", `${name}: nothing planned`);
    app.run(EVERY_GAP);
    // Everything ticked: still no open lines
    app.run(`S.shopping.items.forEach(e => { e.done = true; })`);
    assert.equal(barOf(kitsTab(app)), "", `${name}: everything ticked`);
  }
  const app = load({ fixture: "tests/household" });
  app.run(EVERY_GAP);
  for (const v of ["overview", "household", "plan"]) {
    const html = app.run(`(v => { S.view = v; const M = model(); return v === "overview" ? viewOverview(M) : v === "household" ? viewHousehold() : viewPlan(M); })(${JSON.stringify(v)})`);
    assert.equal(barOf(html), "", v);
  }
  // On the Kits tab, with the open kit on Packed and on To get
  assert.ok(barOf(kitsTab(app)), "Packed");
  app.run(`ACT.kitSide({ dataset: { v: "get" } })`);
  assert.ok(barOf(kitsTab(app)), "To get");
});

test("its Review button opens the sheet", () => {
  for (const name of ["tests/household", "fixtures/empty-and-one/new-household"]) {
    const app = load({ fixture: name });
    app.run(EVERY_GAP);
    const btn = barOf(kitsTab(app)).match(/<button [^>]*>([\s\S]*?)<\/button>/);
    // It reads Review, and its name tells it apart from a kit's To get chip, which opens the same sheet
    assert.equal(text(btn[1].replace(/<span class="vh">[\s\S]*?<\/span>/g, "")), "Review", name);
    assert.notEqual(text(btn[1]), "Review", `${name}: a name of its own`);
    const act = btn[0].match(/data-act="([^"]*)"/)[1];
    tap(app, act);
    assert.match(kitsTab(app), /<div class="review-sheet stack" role="dialog"/, `${name}: the sheet is open`);
  }
});

test("read-only viewers see the bar, and drawing it writes nothing", () => {
  const app = load({ fixture: "tests/household" });
  app.run(EVERY_GAP);
  app.run(`S.canWrite = false; globalThis.WRITES = 0; setDoc = (s => (...a) => { WRITES++; return s(...a); })(setDoc)`);
  const html = barOf(kitsTab(app));
  assert.ok(html, "the bar shows");
  assert.equal(app.run("WRITES"), 0);
  assert.deepEqual([...html.matchAll(/data-act="([^"]*)"/g)].map(m => m[1]), ["allKits"], "its only control opens Review");
});

// At 390px, with every gap planned: the bar is above the bottom nav and clear of it, the Kits tab's last element ends
// above the bar when scrolled to the bottom, and nothing scrolls sideways. On the open kit's Packed and To get sides.
test("at 390px the bar sits above the bottom nav, never covers the Kits tab's last row, and nothing scrolls sideways", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const seen = new Map();
  // Two households a run: Chrome prints each page whole, and more would overflow what execFileSync reads back
  for (let i = 0; i < PHONE.length; i += 2) for (const [f, r] of measurePhone(PHONE.slice(i, i + 2))) seen.set(f, r);
  assert.equal(seen.size, PHONE.length);
  for (const [f, sides] of seen) for (const [side, r] of Object.entries(sides)) {
    const at = `${f}, ${side}`;
    assert.equal(r.width, 390, at);
    assert.ok(r.bar, `${at}: the bar shows`);
    assert.ok(r.bar.height > 0 && r.bar.top >= 0, `${at}: the bar is on screen (${JSON.stringify(r.bar)})`);
    assert.ok(r.bar.bottom <= r.nav.top + 0.5, `${at}: the bar ends at ${r.bar.bottom}, over the nav at ${r.nav.top}`);
    assert.ok(r.nav.top - r.bar.bottom <= 1, `${at}: the bar sits just above the nav, not ${r.nav.top - r.bar.bottom}px above it`);
    assert.ok(r.last <= r.bar.top + 0.5, `${at}: scrolled to the bottom, the tab's last element ends at ${r.last}, under the bar at ${r.bar.top}`);
    assert.ok(r.scroll <= r.width, `${at}: the page scrolls sideways (${r.scroll}px)`);
    assert.deepEqual(r.out, [], `${at}: these stick out of the screen`);
  }
});
function measurePhone(fixtures) {
  return atPhoneWidth(fixtures, () => {
    S.shopping = null; ACT.shopAddAll();
    const look = side => {
      S.view = "kits"; S.allKits = null; S.toGet = side === "get" ? S.openKit : null; render();
      scrollTo(0, document.documentElement.scrollHeight);
      const w = innerWidth, bar = document.querySelector(".plan-bar"), r = bar?.getBoundingClientRect(), nav = document.querySelector("#tabs").getBoundingClientRect();
      // Every element the tab draws, but the bar and the grid that holds it, whose bottom padding is room for the bar
      const tab = document.querySelector("#v-kits"), grid = tab.querySelector(".kits-grid");
      const rest = [...tab.querySelectorAll("*")].filter(e => e !== grid && !bar.contains(e) && e.getBoundingClientRect().height);
      return { width: w, scroll: document.documentElement.scrollWidth, bar: r && { top: r.top, bottom: r.bottom, height: r.height }, nav: { top: nav.top },
        last: Math.max(...rest.map(e => e.getBoundingClientRect().bottom)),
        out: [...tab.querySelectorAll("*")].filter(e => { const b = e.getBoundingClientRect(); return b.width && (b.left < -0.5 || b.right > w + 0.5); }).map(e => e.tagName + "." + e.getAttribute("class")) };
    };
    return { packed: look("packed"), get: look("get") };
  });
}

// At 1280px: the bar is a card in a third column, right of the kit, and stays in view as the page scrolls
test("at 1280px the bar is a card in a column right of the kit, and stays in view when the page scrolls", { skip: !chrome && "no Chrome found (set CHROME)" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-planbar-"));
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, wrap(undefined, "tests/household"));
  const page = await openChrome(chrome);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = async e => {
    const r = await page.send("Runtime.evaluate", { expression: e, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${e}: ${r.exceptionDetails.exception?.description}`);
    return r.result.value;
  };
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const loaded = page.once("Page.loadEventFired");
    await page.send("Page.navigate", { url: `file://${file}#kits` });
    await loaded;
    for (let i = 0; i < 50 && !await ev("S.loaded"); i++) await sleep(50);
    const at = y => ev(`(() => { S.shopping = null; ACT.shopAddAll(); S.view = "kits"; render(); scrollTo(0, ${y});
      const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      const grid = document.querySelector(".kits-grid"), bar = document.querySelector(".plan-bar");
      return { bar: bar && box(bar), kit: box(grid.children[1]), list: box(grid.children[0]), h: innerHeight, header: box(document.querySelector(".top")).bottom, scrolled: scrollY, high: document.documentElement.scrollHeight }; })()`);
    const top = await at(0);
    assert.ok(top.bar, "the bar shows");
    assert.ok(top.bar.left >= top.kit.right, `the bar (${top.bar.left}) is right of the kit (${top.kit.right})`);
    assert.ok(top.kit.left >= top.list.right, "the kit is right of the kit list, as before");
    assert.ok(top.bar.top < top.kit.bottom && top.bar.bottom > top.kit.top, "beside the kit, not under it");
    assert.ok(top.high > top.h + 600, "the page is tall enough to scroll");
    const down = await at(top.high);
    assert.ok(down.scrolled > 600, "the page scrolled");
    assert.ok(down.bar.top >= down.header && down.bar.bottom <= down.h, `the bar stays in view, below the sticky header at ${down.header} (${JSON.stringify(down.bar)})`);
    assert.ok(down.bar.left >= down.kit.right, "still right of the kit");
  } finally {
    await page.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
