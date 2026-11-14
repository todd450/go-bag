// The header the founder picked on #154 (option A, 14 Nov 2026), after Airbnb's:
// - Desktop: one row. The wordmark is left, the tabs are centred with an illustrated icon beside each label and a
//   3px underline under the selected one, and the score and the account button (web/runtime.js's, on Vercel) are right.
// - Phone: the tabs are the bottom bar, with the same icons, and a short dark bar marks the selected one.
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
const markup = fs.readFileSync(path.join(__dirname, "..", "emergency-kit-audit.html"), "utf8");

test("each tab's icon is an illustrated picture, hidden from screen readers, with gradient ids no other element uses", () => {
  const icons = load().json("TAB_ICON");
  const ids = [];
  for (const [tab, svg] of Object.entries(icons)) {
    assert.match(svg, /^<svg class="art" viewBox="0 0 48 48" aria-hidden="true">/, `${tab}: one 48×48 picture, not read aloud`);
    assert.match(svg, /<(linear|radial)Gradient /, `${tab}: drawn with depth, not a line icon`);
    ids.push(...[...svg.matchAll(/ id="([^"]+)"/g)].map(m => m[1]));
  }
  assert.equal(new Set(ids).size, ids.length, "no two icons share a gradient id");
  const rest = markup.replace(/const TAB_ICON = \{[\s\S]*?\n\};/, "");
  for (const id of ids) assert.ok(!rest.includes(`"${id}"`), `${id} is the icon's own`);
});

// Opens the standard household at one width on one tab, with a stand-in for the runtime's 40px account button
async function onPage(width, hash, steps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-header-"));
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, wrap(undefined, "tests/household"));
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
    assert.ok(await ev("S.loaded"), `never loaded at ${width}px`);
    await ev(`(d => { d.className = "gb-acct"; d.style.cssText = innerWidth > 640 ? "width:40px;height:40px;flex:none" : "width:34px;height:34px;flex:none"; document.querySelector(".hdr-end").append(d); return 1; })(document.createElement("div"))`);
    return await steps(ev);
  } finally {
    await page.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

const box = sel => `(r => r && { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width })(document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect())`;
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

for (const width of [1440, 1024, 800, 760, 641]) {
  test(`at ${width}px the header is one row: wordmark, tabs with their icons, then the score and the account, none overlapping`, { skip }, async () => {
    await onPage(width, "kits", async ev => {
      const [top, brand, nav, end, score, acct] = await Promise.all([".top", ".brand", "#tabs", ".hdr-end", "#hdr-score", ".gb-acct"].map(s => ev(box(s))));
      assert.ok(top.height <= 82, `one row, ${top.height}px tall`);
      for (const [name, b] of Object.entries({ brand, nav, end })) assert.ok(b.top >= top.top && b.bottom <= top.bottom + 1, `${name} is inside the header's row`);
      assert.ok(brand.right <= nav.left && nav.right <= end.left, "wordmark, tabs, then the end group, left to right");
      assert.ok(!overlap(brand, nav) && !overlap(nav, end), "nothing overlaps");
      assert.ok(score.width > 0 && score.right <= acct.left, "the score, then the account button");
      assert.ok(Math.abs(acct.right - (top.right - Math.max(16, (top.width - 1320) / 2 + 16))) < 1, "the account button ends at the page's right gutter");
      assert.ok(await ev("document.scrollingElement.scrollWidth <= innerWidth"), "nothing scrolls sideways");
      const tabs = await ev(`[...document.querySelectorAll("#tabs button")].map(b => { const s = getComputedStyle(b), i = b.querySelector(".art").getBoundingClientRect();
        return { v: b.dataset.v, current: b.getAttribute("aria-current"), line: s.borderBottomWidth, lineColor: s.borderBottomColor, icon: i.width, color: s.color }; })`);
      const ink = await ev(`getComputedStyle(document.body).color`);
      for (const t of tabs) {
        assert.ok(t.icon >= 28, `${t.v}: its icon is ${t.icon}px`);
        if (t.current === "page") assert.deepEqual([t.line, t.lineColor, t.color], ["3px", ink, ink], `${t.v}, selected: dark, with a 3px dark underline`);
        else assert.notEqual(t.color, ink, `${t.v}: grey when not selected`);
      }
    });
  });
}

test("at 390px the tabs are a bottom bar with the same icons, the selected one marked on the bar's top edge", { skip }, async () => {
  await onPage(390, "kits", async ev => {
    const [top, nav, brand, acct] = await Promise.all([".top", "#tabs", ".brand", ".gb-acct"].map(s => ev(box(s))));
    assert.ok(top.height <= 60, `a slim top bar, ${top.height}px tall`);
    assert.ok(Math.abs(nav.bottom - 844) < 1, "the tabs sit at the bottom of the screen");
    assert.ok(brand.right < acct.left && acct.top >= top.top && acct.bottom <= top.bottom, "the account button is in the top bar, right of the wordmark");
    const mark = await ev(`(b => { const m = getComputedStyle(b, "::before"), r = b.getBoundingClientRect(), n = b.closest("nav").getBoundingClientRect();
      return { v: b.dataset.v, h: m.height, bg: m.backgroundColor, top: r.top + parseFloat(m.top) - n.top, icon: b.querySelector(".art").getBoundingClientRect().width }; })(document.querySelector('#tabs [aria-current="page"]'))`);
    assert.equal(mark.v, "kits");
    assert.equal(mark.h, "3px");
    assert.equal(mark.bg, await ev(`getComputedStyle(document.body).color`), "in the page's ink");
    assert.ok(Math.abs(mark.top) <= 1, `on the bar's top edge (${mark.top}px from it)`);
    assert.equal(mark.icon, 32);
    assert.equal(await ev(`[...document.querySelectorAll('#tabs button:not([aria-current="page"])')].map(b => getComputedStyle(b, "::before").content).join()`), "none,none", "only the selected tab is marked");
    assert.ok(await ev("document.scrollingElement.scrollWidth <= innerWidth"), "nothing scrolls sideways");
  });
});
