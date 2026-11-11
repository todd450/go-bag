// The Kits tab's one-column desktop layout (#135), in the two places a second opinion found it wrong:
// - "+ Add a kit" opens its form on a line of its own, under the kit cards, and no card grows to the form's height.
//   With no kits yet, the form is under "Add the first one below", as that sentence says.
// - Until a bag or box is named, "What holds this kit" is only as wide as its button at desktop width (861px and up).
//   At 860px and under the open kit keeps the 3 : 2 split it had before #135.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chrome } = require("./phone");
const { openChrome } = require("../tools/screenshots");
const { wrap } = require("../tools/page");

const skip = !chrome && "no Chrome found (set CHROME)";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Loads a made-up household's Kits tab at one width and returns what `expr` (run in the page) measures
async function measure(fixture, width, expr) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-kits-"));
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, wrap(undefined, fixture));
  const page = await openChrome(chrome);
  const ev = async e => {
    const r = await page.send("Runtime.evaluate", { expression: e, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${e}: ${r.exceptionDetails.exception?.description}`);
    return r.result.value;
  };
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false });
    const loaded = page.once("Page.loadEventFired");
    await page.send("Page.navigate", { url: `file://${file}#kits` });
    await loaded;
    for (let i = 0; i < 50 && !await ev("S.loaded"); i++) await sleep(50);
    return await ev(`(() => { const box = e => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      S.view = "kits"; ${expr} })()`);
  } finally {
    await page.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

// The kit cards before and after the form opens, the form, and the empty state's sentence
const ADD_FORM = `S.addKit = false; render();
  const cards = () => [...document.querySelectorAll(".kits-list .tag")].map(box);
  const before = cards();
  S.addKit = true; render();
  const form = document.querySelector(".kits-list > form"), none = document.querySelector(".kits-list p");
  return { before, after: cards(), form: form && box(form), none: none && box(none), list: box(document.querySelector(".kits-list")),
    kit: box(document.querySelector(".kit-main")), scroll: document.documentElement.scrollWidth, w: innerWidth };`;

for (const [fixture, widths] of [
  ["tests/household", [861, 1280, 1440, 1920]],
  ["fixtures/empty-and-one/one-person", [861, 1280, 1920]],
  ["fixtures/empty-and-one/big-household", [1280]],
]) {
  test(`${fixture}: at desktop width "+ Add a kit" opens under the kit cards, and no card changes size`, { skip }, async () => {
    for (const w of widths) {
      const r = await measure(fixture, w, ADD_FORM), at = `${fixture} at ${w}px`;
      assert.ok(r.form, `${at}: the form shows`);
      assert.ok(r.before.length, `${at}: there are kit cards`);
      const low = Math.max(...r.after.map(c => c.bottom));
      assert.ok(r.form.top >= low, `${at}: the form starts at ${r.form.top}, under the last card's bottom at ${low}`);
      assert.deepEqual(r.after.map(c => c.height), r.before.map(c => c.height), `${at}: every card is as tall as before the form opened`);
      assert.ok(r.form.width <= 420.5, `${at}: the form is ${r.form.width}px wide, at most 420`);
      assert.ok(Math.abs(r.form.left - r.list.left) <= 1, `${at}: the form starts at the list's left edge`);
      assert.ok(r.kit.top >= r.form.bottom, `${at}: the open kit starts under the form`);
      assert.ok(r.scroll <= r.w, `${at}: the page scrolls sideways (${r.scroll}px)`);
    }
  });
}

test("with no kits yet, at desktop width the form is below the sentence that says \"below\"", { skip }, async () => {
  for (const w of [861, 1280, 1920]) {
    const r = await measure("fixtures/empty-and-one/new-household", w, ADD_FORM), at = `new-household at ${w}px`;
    assert.ok(r.form && r.none, `${at}: the sentence and the form show`);
    assert.ok(r.form.top >= r.none.bottom, `${at}: the form starts at ${r.form.top}, under the sentence's bottom at ${r.none.bottom}`);
    assert.ok(r.form.width <= 420.5, `${at}: the form is ${r.form.width}px wide, at most 420`);
  }
});

// Readiness and "What holds this kit", side by side in the open kit, with no bag or box named
const KIT_TOP = `render();
  const top = document.querySelector(".kit-top"), card = top.querySelector(".ctr-card"), btn = card.querySelector(".ctr-add");
  return { ready: box(top.children[0]), card: box(card), btn: btn && box(btn) };`;

test("until a bag or box is named, its card is as wide as its button from 861px, and two fifths of the kit at 860px and under", { skip }, async () => {
  for (const w of [700, 860]) {
    const r = await measure("tests/household", w, KIT_TOP), at = `at ${w}px`;
    assert.ok(r.btn, `${at}: the kit has no bag or box yet`);
    assert.ok(Math.abs(r.card.top - r.ready.top) <= 1, `${at}: the two are side by side`);
    const share = r.card.width / (r.card.width + r.ready.width);
    assert.ok(Math.abs(share - 0.4) < 0.01, `${at}: the card takes ${share.toFixed(3)} of the row, as before #135 (3 : 2)`);
  }
  for (const w of [861, 1280]) {
    const r = await measure("tests/household", w, KIT_TOP), at = `at ${w}px`;
    assert.ok(r.btn, `${at}: the kit has no bag or box yet`);
    assert.ok(Math.abs(r.card.top - r.ready.top) <= 1, `${at}: the two are side by side`);
    assert.ok(r.card.width < r.btn.width + 80, `${at}: the card (${r.card.width}px) is only as wide as its button (${r.btn.width}px) and its padding`);
    assert.ok(r.ready.width > r.card.width * 2, `${at}: readiness takes the rest`);
  }
});
