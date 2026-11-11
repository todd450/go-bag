// Visual polish the founder asked for on 11 Nov 2026:
// - On Readiness the ring already shows the score, so the header's copy is hidden while the ring is on screen and is
//   back once the ring has scrolled under the header. On the other tabs it always shows.
// - A bag under half full is drawn shorter (140px empty, the full 240px from half full), with the same bands.
// - At phone width a household card left alone on its row fills the row, and two on a row are equally tall.
// - What it costs is the kits' table. An emergency's cost is on its own row (say each thing once, 11 Nov 2026).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { load } = require("./load");
const { chrome } = require("./phone");
const { openChrome } = require("../tools/screenshots");
const { wrap } = require("../tools/page");

const skip = !chrome && "no Chrome found (set CHROME)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Opens a made-up household at one width on one tab, and hands `steps` a way to run code in the page
async function onPage(fixture, width, hash, steps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-polish-"));
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, wrap(undefined, fixture));
  const page = await openChrome(chrome);
  const ev = async e => {
    const r = await page.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${e}: ${r.exceptionDetails.exception?.description}`);
    return r.result.value;
  };
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    const loaded = page.once("Page.loadEventFired");
    await page.send("Page.navigate", { url: `file://${file}#${hash}` });
    await loaded;
    for (let i = 0; i < 50 && !await ev("S.loaded"); i++) await sleep(50);
    assert.ok(await ev("S.loaded"), `${fixture} never loaded at ${width}px`);
    return await steps(ev);
  } finally {
    await page.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

// The header score's opacity, and where the ring and the header end, after scrolling to y and letting a frame draw
const SCORE = y => `new Promise(ok => { scrollTo(0, ${y}); requestAnimationFrame(() => requestAnimationFrame(() => {
  const s = document.querySelector("#hdr-score"), ring = document.querySelector(".sum-score .ring"), top = document.querySelector(".top").getBoundingClientRect();
  const r = ring.getBoundingClientRect();
  ok({ opacity: +getComputedStyle(s).opacity, text: s.textContent, ringTop: r.top, ring: r.bottom, header: top.bottom, tall: top.height, y: scrollY });
})); })`;

for (const width of [390, 1440]) for (const notice of [false, true]) {
  test(`at ${width}px${notice ? ", with a notice above the tab," : ""} the header's score hides on Readiness while the ring shows, and is back once the ring has scrolled away`, { skip }, async () => {
    await onPage("tests/household", width, "overview", async ev => {
      const at = y => ev(SCORE(y));
      const plain = await at(0);
      // A notice ("Not saving") sits above the tab and pushes the ring down the page
      if (notice) await ev(`S.live = false, render(), 1`);
      const top = await at(0);
      if (notice) assert.ok(top.ring > plain.ring + 30, `the notice pushed the ring down (${plain.ring} to ${top.ring})`);
      assert.ok(top.text.includes("17"), "the header still holds the score");
      assert.ok(top.ring > top.header, "the ring is on screen at the top of the page");
      assert.equal(top.opacity, 0, "the header's copy is hidden while the ring shows");
      // Scrolled until the ring's top is a few pixels from the header, which by then sticks to the top of the screen: all of it still shows
      const whole = await at(Math.floor(top.ringTop - top.tall) - 4);
      assert.ok(whole.ringTop >= whole.header, `the whole ring (top ${whole.ringTop}) still shows under the header (${whole.header})`);
      assert.equal(whole.opacity, 0, `the header's copy is still hidden at ${whole.y}px`);
      // Scrolled until the ring is just under the header
      const gone = await at(Math.ceil(top.ring - top.tall) + 1);
      if (process.env.POLISH_DEBUG) console.log(width, notice, top, whole, gone);
      assert.ok(gone.ring <= gone.header, `the ring (${gone.ring}) is under the header (${gone.header})`);
      assert.equal(gone.opacity, 1, `the header's copy is back at ${gone.y}px`);
      assert.equal((await at(1200)).opacity, 1, "and stays further down");
      assert.equal((await at(0)).opacity, 0, "and hides again back at the top");
    });
  });
}
for (const width of [390, 1440]) test(`at ${width}px the header's score always shows on Kits and Household`, { skip }, async () => {
  for (const tab of ["kits", "household"]) await onPage("tests/household", width, tab, async ev => {
    assert.equal((await ev(`new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(() => ok(+getComputedStyle(document.querySelector("#hdr-score")).opacity))))`)), 1, tab);
  });
});

// bagFig's drawing of `ml` millilitres of items in a 40 L bag: its height, and its bands' labels
const bag = (app, lines) => {
  const html = app.run(`bagFig({ g: 0, ml: ${lines.reduce((a, l) => a + l[1], 0)}, bagG: 0,
    lines: ${JSON.stringify(lines)}.map(([name, ml], i) => ({ g: 0, ml, it: { id: "i" + i, name, category: "food" } })) }, { kg: 15, L: 40 }, "ml")`);
  return { h: +html.match(/class="bag[^>]*style="height:(\d+)px"/)[1],
    bands: [...html.matchAll(/class="bag-b"[^>]*height:(\d+)px"><span class="ell">([^<]*)</g)].map(m => [m[2], +m[1]]),
    free: /class="bag-free">[^<]+</.test(html) };
};

test("a bag under half full is drawn shorter, from 140px empty to the full 240px at half full and over", () => {
  const app = load({ fixture: "tests/household" });
  const h = ml => bag(app, [["Water", ml]]).h;
  assert.equal(h(0), 140, "empty");
  assert.equal(h(10000), 190, "a quarter full");
  assert.equal(h(20000), 240, "half full");
  assert.equal(h(30000), 240, "three quarters full");
  assert.equal(h(40000), 240, "full");
  assert.ok(h(4000) < h(8000) && h(8000) < h(16000), "it grows as it fills");
  assert.equal(h(60000), 360, "half as much again over the limit rises above the rim, as before");
});

test("the shorter bag names the same items as the full-height one, each band tall enough for its label", () => {
  const app = load({ fixture: "tests/household" });
  // 6 L and 3 L in 40 L: 35px and 17px of a 231px stack, so the 3 L band is under 18px alone but is not merged with others
  const two = bag(app, [["Blanket", 6000], ["Jumper cables", 3200]]);
  assert.ok(two.h < 240, `drawn ${two.h}px tall`);
  assert.deepEqual(two.bands.map(b => b[0]), ["Blanket", "Jumper cables"], "both named");
  assert.ok(two.bands.every(b => b[1] >= 18), "each band fits its label");
  assert.ok(two.free, "the free band says what's left");
  // Two items under 18px at full height merge into one band there, and so here
  const small = bag(app, [["Blanket", 6000], ["Whistle", 300], ["Matches", 200]]);
  assert.deepEqual(small.bands.map(b => b[0]), ["Blanket", "2 small items"]);
  const sum = small.bands.reduce((a, b) => a + b[1], 0);
  assert.ok(sum <= small.h - 9, `bands ${sum}px fit the ${small.h - 9}px stack`);
  // 3.2 L is 18px of the full-height stack but under 18px of this shorter one. Merging by the drawn height would make
  // the two of them "2 small items"; merging as at full height keeps both names.
  const three = bag(app, [["Blanket", 6000], ["Radio", 3200], ["Lantern", 3200]]);
  assert.ok(three.h < 240, `drawn ${three.h}px tall`);
  assert.ok(3200 * (three.h - 9) / 40000 < 18, "each smaller item is under 18px at the drawn height");
  assert.deepEqual(three.bands.map(b => b[0]), ["Blanket", "Radio", "Lantern"], "all three named");
  assert.ok(three.bands.every(b => b[1] >= 18), "each band fits its label");
  assert.ok(three.bands.reduce((a, b) => a + b[1], 0) <= three.h - 9, "and they fit the stack");
});

// Every household card's box at 390px, in rows by their top edge
const CARDS = `(() => { const list = document.querySelector(".hh-people"), l = list.getBoundingClientRect(), rows = {};
  for (const c of list.children) { const r = c.getBoundingClientRect(); (rows[Math.round(r.top)] ||= []).push({ w: r.width, h: r.height, add: c.classList.contains("hh-add") }); }
  return JSON.stringify({ width: l.width, rows: Object.values(rows), scroll: document.documentElement.scrollWidth, w: innerWidth }); })()`;

for (const fixture of ["tests/household", "fixtures/empty-and-one/big-household", "fixtures/empty-and-one/one-person"]) {
  test(`${fixture}: at 390px a household card alone on its row fills it, and two on a row are equally tall`, { skip }, async () => {
    await onPage(fixture, 390, "household", async ev => {
      const r = JSON.parse(await ev(CARDS));
      assert.ok(r.rows.length, "there are cards");
      r.rows.forEach((row, i) => {
        assert.ok(row.length <= 2, `row ${i + 1} holds ${row.length} cards`);
        const wide = row.reduce((a, c) => a + c.w, 0) + (row.length - 1) * 10;
        assert.ok(Math.abs(wide - r.width) <= 1, `row ${i + 1}: its ${row.length} card(s) span ${wide}px of the row's ${r.width}px`);
        if (row.length === 2) {
          assert.ok(Math.abs(row[0].w - row[1].w) <= 1, `row ${i + 1}: both cards are equally wide (${row[0].w}, ${row[1].w})`);
          assert.ok(Math.abs(row[0].h - row[1].h) <= 1, `row ${i + 1}: both cards are equally tall (${row[0].h}, ${row[1].h})`);
        }
      });
      assert.ok(r.rows.some(row => row.length === 2) || r.rows.length < 3, "cards still pair up two a row");
      assert.ok(r.scroll <= r.w, `the page scrolls sideways (${r.scroll}px)`);
    });
  });
}

// What it costs: its tables
const costTables = html => [...html.match(/<section class="costs[\s\S]*?<\/section>/)[0].matchAll(/<table class="cost-t">([\s\S]*?)<\/table>/g)].map(t => ({
  head: [...t[1].matchAll(/<th scope="col">([^<]*)</g)].map(m => m[1]),
  rows: [...t[1].matchAll(/<th scope="row">([^<]*)</g)].map(m => m[1]) }));

test("What it costs is the kits' table alone: an emergency's cost is on its own row", () => {
  const app = load({ fixture: "tests/household" });
  const [kits, ...more] = costTables(app.run(`viewOverview(model())`));
  assert.deepEqual(more, [], "one table");
  assert.deepEqual(kits.head, ["Kit", "Spent", "To finish"]);
  assert.deepEqual([...kits.rows].sort(), app.json(`S.kits.map(k => k.name)`).sort());
});

// Each emergency's row: what it says it costs to be ready, beside what hzCost works out
const ROW_COSTS = `(() => { const M = model(), h = household(); return M.results.map(r => { const c = hzCost(r, h).toGet;
  return { id: r.hz.id, off: LEVELS[r.rel][1] === 0 || !!(r.hz.vehicle && h.vehicles === 0), total: Math.round(c.total), unpriced: c.unpriced,
    shown: (hzRow(r, h, M).match(/<span class="hz-cost">([\\s\\S]*?)<\\/span><\\/span>/) || [])[1] ?? null }; }); })()`;
const plain = h => h.replace(/<[^>]*>/g, "");

test("an emergency's row says what it still costs to be ready, as its opened panel does, and nothing when there is nothing to buy", () => {
  for (const fixture of ["tests/household", "fixtures/empty-and-one/big-household", "fixtures/empty-and-one/one-person"]) {
    const app = load({ fixture });
    const rows = app.json(ROW_COSTS);
    let shown = 0;
    for (const r of rows) {
      const want = r.off || !(r.total || r.unpriced) ? null : `${r.total ? "$" + r.total.toLocaleString("en-US") : "Unpriced"} to be ready`;
      assert.equal(r.shown === null ? null : plain(r.shown), want, `${fixture} ${r.id}`);
      shown += want !== null;
    }
    assert.ok(shown > 3, `${fixture}: ${shown} rows show a cost`);
  }
  // An emergency that doesn't apply shows no cost
  const app = load({ fixture: "tests/household" });
  app.run(`S.hazards = { ...S.hazards, levels: Object.fromEntries(HAZARDS.map(z => [z.id, "none"])) }`);
  assert.deepEqual(app.json(ROW_COSTS).filter(r => r.off && r.shown !== null), [], "no cost on a row that is off");
});

test("an emergency's cost sits under its score, clear of its needs, at phone and desktop width", { skip }, async () => {
  for (const width of [390, 1440]) await onPage("tests/household", width, "overview", async ev => {
    const rows = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll(".hz-row")].filter(r => r.querySelector(".hz-cost")).map(r => { const b = s => { const x = r.querySelector(s).getBoundingClientRect(); return { l: x.left, r: x.right, t: x.top, b: x.bottom }; };
      return { cost: b(".hz-cost"), pct: b(".pct"), needs: b(".hz-needs") }; }))`));
    assert.ok(rows.length > 3, `${width}px: ${rows.length} rows with a cost`);
    for (const [i, r] of rows.entries()) {
      assert.ok(Math.abs(r.cost.r - r.pct.r) <= 1, `${width}px row ${i}: the cost ends where the score does (${r.cost.r}, ${r.pct.r})`);
      assert.ok(r.cost.t >= r.pct.b - 1, `${width}px row ${i}: under the score`);
      assert.ok(r.needs.r <= r.cost.l + 1, `${width}px row ${i}: the needs stop before it (${r.needs.r} then ${r.cost.l})`);
    }
    assert.ok(await ev(`document.documentElement.scrollWidth <= innerWidth`), `${width}px: the page doesn't scroll sideways`);
  });
});
