// Review (issue #121) under real input, in Chrome: what a double-click, a double tap, a tick, a × and a change of kit do
// in the sheet. These two tests spend most of their time in the pauses a person's clicks have, so they run in a file of
// their own, beside the rest of Review's tests (tests/review.test.js) instead of after them (issue #147).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chrome, CLASSIC } = require("./phone");
const { openChrome } = require("../tools/screenshots");
const { wrap } = require("../tools/page");

/* Real input, in Chrome: a Plan puts its new lines above its own button, so what sits under the pointer changes. A
   double-click or a double tap must do what one click does: its second click never ticks, removes or plans the row that
   moved there. The same holds for a tick and a ×, whose rows move away from under the pointer. Plan the top N and Plan
   are in a kit's To get; the tick and × in Review, which is a panel over the page on a desktop. */
test("a double-click or double tap on Plan, Plan the top N, a tick or × does what one click does", { skip: !chrome && "no Chrome found (set CHROME)" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-dblclick-"));
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, wrap(undefined, "tests/household"));
  const page = await openChrome(chrome);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = async e => {
    const r = await page.send("Runtime.evaluate", { expression: e, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${e}: ${r.exceptionDetails.exception?.description}`);
    return r.result.value;
  };
  const toGet = id => ev(`S.view = "kits"; S.allKits = null; S.openKit = ${JSON.stringify(id)}; S.toGet = S.openKit; render(); 1`);
  const at = sel => ev(`(() => { const e = ${sel}; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  // Two presses at one spot, 90 ms apart, which the browser counts as one double-click (or double tap). Each press
  // carries its own event time, as a real finger's does: Chrome only sends the second once the first is handled, and
  // on a slow machine (CI) that redraw would otherwise push the second press's time past the double-tap window.
  const twice = async (sel, how) => {
    const [x, y] = await at(sel);
    const t0 = Date.now() / 1000;
    for (const clickCount of [1, 2]) {
      const timestamp = t0 + (clickCount - 1) * 0.09;
      if (how === "touch") {
        await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }], timestamp });
        await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: timestamp + 0.01 });
      } else {
        // "quick": two single clicks (detail 1 each), as a browser that doesn't count taps sends a double tap
        const n = how === "quick" ? 1 : clickCount;
        await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: n, timestamp });
        await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: n, timestamp: timestamp + 0.01 });
      }
      await sleep(90);
    }
    // A save redraws in the click's own task. The wait is so the next press is a separate action, past the page's
    // 350 ms double-tap time, as a person's next click would be.
    await sleep(400);
  };
  const state = async () => JSON.parse(await ev("JSON.stringify({ open: shopItems().filter(x => !x.done).map(x => x.id), done: shopItems().filter(x => x.done).map(x => x.id), items: S.items.length, score: model().overall })"));
  try {
    for (const [how, width] of [["mouse", 390], ["mouse", 1200], ["touch", 390], ["quick", 390]]) {
      const was = `${how} at ${width}px`;
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
      await page.send("Emulation.setTouchEmulationEnabled", { enabled: how === "touch" });
      const loaded = page.once("Page.loadEventFired");
      await page.send("Page.navigate", { url: `file://${file}?${how}-${width}#kits` });
      await loaded;
      for (let i = 0; i < 50 && !await ev("S.loaded"); i++) await sleep(50);
      await sleep(200);
      const start = await state();

      // Plan the top N, twice over: each double-click plans that kit's top N once, and ticks nothing
      for (const round of [1, 2]) {
        await toGet("go");
        const before = await state(), n = await ev(`Math.min(5, document.querySelectorAll("#v-kits .shop-gap").length)`);
        await twice(`document.querySelector('#v-kits [data-act="shopAddTop"]')`, how);
        const after = await state();
        assert.equal(after.open.length, before.open.length + n, `${was}, Plan the top N round ${round}: plans its top ${n} once`);
        assert.deepEqual(after.done, [], `${was}, Plan the top N round ${round}: ticks nothing`);
        assert.equal(after.items, start.items, `${was}, Plan the top N round ${round}: puts nothing in a kit`);
        assert.equal(after.score, start.score, `${was}, Plan the top N round ${round}: readiness doesn't move`);
      }
      // A single Plan, three times over: each double-click plans one line, and removes none
      await toGet("car");
      for (const round of [1, 2, 3]) {
        const before = await state();
        await twice(`document.querySelector('#v-kits [data-act="shopAdd"]')`, how);
        const after = await state();
        assert.equal(after.open.length, before.open.length + 1, `${was}, Trunk bag's Plan round ${round}: plans one line`);
        assert.deepEqual(before.open.filter(id => !after.open.includes(id)), [], `${was}, Trunk bag's Plan round ${round}: removes no line`);
        assert.deepEqual(after.done, [], `${was}, Trunk bag's Plan round ${round}: ticks nothing`);
      }
      // A tick and a × in Review: the row below moves up under the pointer, and stays as it was
      await ev(`ACT.allKits(); 1`);
      const box = await ev(`(r => [r.left, r.right])(document.querySelector(".review-sheet").getBoundingClientRect())`);
      if (width > 640) assert.ok(box[0] > 0 && box[1] < width, `${was}: Review is a panel over the page (${box})`);
      else assert.deepEqual(box, [0, width], `${was}: Review covers the screen`);
      let before = await state();
      await twice(`document.querySelector(".review-sheet .shop-row .shop-chk")`, how);
      let after = await state();
      assert.equal(after.done.length, 1, `${was}: a double-click on a tick ticks one line`);
      assert.equal(after.open.length, before.open.length - 1, `${was}: and leaves the rest open`);
      before = after;
      await twice(`document.querySelector('.review-sheet .shop-row [data-act="shopDel"]')`, how);
      after = await state();
      assert.equal(after.open.length, before.open.length - 1, `${was}: a double-click on × removes one line`);
      assert.deepEqual(after.done, before.done, `${was}: and ticks nothing`);
    }
  } finally {
    await page.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

/* Real input, in Chrome, with classic scrollbars: acting on a row deep in a long Review keeps the sheet where it was
   scrolled to and keeps focus in the sheet, at phone and desktop width. A tick, a × and a change of kit each redraw the
   page. Opening Review from a #shop link puts focus in the sheet too. */
test("a tick, a × or a change of kit deep in Review keeps its scroll and keeps focus in the sheet", { skip: !chrome && "no Chrome found (set CHROME)" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-keep-"));
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, wrap(undefined, "tests/household") + CLASSIC);
  const page = await openChrome(chrome);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = async e => {
    const r = await page.send("Runtime.evaluate", { expression: e, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${e}: ${r.exceptionDetails.exception?.description}`);
    return r.result.value;
  };
  // How far the sheet is scrolled, whichever box scrolls it, and whether focus is in the sheet
  const where = () => ev(`({ y: [".review-bg", ".review-sheet"].reduce((a, s) => a + (document.querySelector(s)?.scrollTop || 0), 0),
    inSheet: !!document.querySelector('[role="dialog"]')?.contains(document.activeElement) })`);
  // A row's control that is on screen, clear of the screen's edges
  const onScreen = sel => `[...document.querySelectorAll('.review-sheet .shop-row ${sel}')].find(e => { const r = e.getBoundingClientRect(); return r.top > 120 && r.bottom < innerHeight - 40; })`;
  const click = async sel => {
    const [x, y] = await ev(`(r => [r.left + r.width / 2, r.top + r.height / 2])(${sel}.getBoundingClientRect())`);
    for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    await sleep(400);
  };
  try {
    for (const width of [390, 1440]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
      const loaded = page.once("Page.loadEventFired");
      await page.send("Page.navigate", { url: `file://${file}?${width}#shop` });
      await loaded;
      for (let i = 0; i < 50 && !await ev("S.loaded"); i++) await sleep(50);
      await sleep(200);
      assert.equal((await where()).inSheet, true, `${width}px: a #shop link puts focus in the sheet`);
      await ev(`ACT.shopAddAll(); [".review-bg", ".review-sheet"].forEach(s => document.querySelector(s).scrollTop = 1500); 1`);
      const start = await where();
      assert.ok(start.y > 1000, `${width}px: the sheet scrolled (${start.y})`);
      start.inSheet = true;
      await click(onScreen(`input[type="checkbox"]`));
      assert.deepEqual(await where(), start, `${width}px: a tick keeps the sheet's scroll and focus`);
      await click(onScreen(`[data-act="shopDel"]`));
      assert.deepEqual(await where(), start, `${width}px: a × keeps the sheet's scroll and focus`);
      await ev(`(s => { s.focus(); s.value = s.options[2].value; s.dispatchEvent(new Event("change", { bubbles: true })); })(${onScreen("select")}); 1`);
      await sleep(100);
      assert.deepEqual(await where(), start, `${width}px: a change of kit keeps the sheet's scroll and focus`);
    }
  } finally {
    await page.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
