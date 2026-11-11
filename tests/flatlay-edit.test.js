// Editing an item from its flat-lay tile (issue #63): tapping a present tile opens that item's fields in place, the
// same inputs as its List row (one function draws both), written through the same data-change="item" handler.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { load, ROOT } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");
const { openChrome } = require("../tools/screenshots");
const { wrap } = require("../tools/page");

const scenarios = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? unesc(m[1]) : null; };
const kits = app => app.json("S.kits.map(k => k.id)");
const flat = (app, kit) => app.run(`S.view = "kits"; S.openKit = ${JSON.stringify(kit)}; S.listKit = null; viewKits(model())`);
const list = (app, kit) => app.run(`S.view = "kits"; S.openKit = ${JSON.stringify(kit)}; S.listKit = S.openKit; viewKits(model())`)
  .match(/<table class="inv">[\s\S]*?<\/table>/)[0];
// Every input and select in a piece of HTML, as its whole opening tag, with the attributes a test reads
const controls = html => [...html.matchAll(/<(input|select)\b[^>]*>/g)].map(([tag]) => ({
  tag, id: attr(tag, "id"), change: attr(tag, "data-change"), itemId: attr(tag, "data-id"), f: attr(tag, "data-f"),
  value: tag.startsWith("<select") ? null : attr(tag, "value"), placeholder: attr(tag, "placeholder"),
}));
// The item controls in one List row: the row holding the item's name input
const rowOf = (table, id) => [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1])
  .find(r => controls(r).some(c => c.f === "name" && c.itemId === id));
// The present tiles' buttons, as the click handler hands them to their ACT
const tileButtons = html => [...html.matchAll(/<li class="fl-tile(?![^"]*\bmiss\b)[^"]*"[^>]*>([\s\S]*?)<\/li>/g)].map(([li, body]) => {
  const b = body.match(/<button\b[^>]*>/);
  return { li, body, button: b && b[0], dataset: b && Object.fromEntries([...b[0].matchAll(/data-([a-z]+)="([^"]*)"/g)].map(m => [m[1], unesc(m[2])])),
    expanded: b && attr(b[0], "aria-expanded"), label: b && attr(b[0], "aria-label") };
});
// The opened fields, wherever they are drawn in the flat-lay: every item control outside the table
const opened = html => controls(html).filter(c => c.change === "item");
const tap = (app, b) => app.run(`ACT[${JSON.stringify(b.dataset.act)}](${JSON.stringify({ dataset: b.dataset, id: attr(b.button, "id") })})`);
const tapItem = (app, kit, id) => {
  const b = tileButtons(flat(app, kit)).find(t => t.dataset?.id === id);
  assert.ok(b, `${kit}: a tile button for ${id}`);
  tap(app, b);
  return flat(app, kit);
};
// What each field's control must say for an item, from its stored doc
const expected = (app, it) => app.json(`(it => ({
  name: it.name == null ? "" : String(it.name), qty: String(Math.max(1, num(it.qty))), liters: String(num(it.liters) || ""), kcal: String(num(it.kcal) || ""),
  grams: num(it.grams) ? String(lb1(num(it.grams))) : "", ml: num(it.ml) ? String(num(it.ml) / 1000) : "", expires: String(it.expires || ""), paid: String(dollars(it.paid) ?? ""),
  gramsEst: String(lb1(itemLoad(it).estG)), mlEst: String(Math.round(itemLoad(it).estMl / 100) / 10), ess: essentialList(it.category).length > 0,
}))(S.items.find(i => i.id === ${JSON.stringify(it)}))`);
const IDS = { name: "name", category: "cat", essential: "ess", qty: "qty", liters: "l", kcal: "k", grams: "g", ml: "ml", paid: "paid", expires: "exp" };

function checkFields(app, cs, id, where) {
  const want = expected(app, id);
  assert.ok(cs.filter(c => c.f).every(c => c.change === "item" && c.itemId === id), `${where}: every field is the item's, on data-change="item"`);
  const fs = cs.filter(c => c.f);
  assert.deepEqual(fs.map(c => c.f), ["name", "category", ...want.ess ? ["essential"] : [], "qty", "liters", "kcal", "grams", "ml", "paid", "expires"], `${where}: the fields, in order`);
  for (const c of fs) {
    assert.equal(c.id, `it-${id}-${IDS[c.f]}`, `${where}: ${c.f} id`);
    assert.equal(c.change, "item", `${where}: ${c.f} data-change`);
    if (c.value != null) assert.equal(c.value, want[c.f], `${where}: ${c.f} value`);
  }
  assert.equal(fs.find(c => c.f === "grams").placeholder, want.gramsEst, `${where}: lb estimate`);
  assert.equal(fs.find(c => c.f === "ml").placeholder, want.mlEst, `${where}: Size L estimate`);
}

test("List's rows keep every field's id, data-change, data-id, data-f and value, in every scenario, writable or not", () => {
  for (const fixture of scenarios) for (const w of [true, false]) {
    const app = load({ fixture });
    app.run(`S.canWrite = ${w}`);
    for (const kit of kits(app)) {
      const table = list(app, kit);
      for (const id of app.json(`S.items.filter(i => i.kitId === ${JSON.stringify(kit)}).map(i => i.id)`)) {
        const row = rowOf(table, id), where = `${fixture} ${kit} ${id}${w ? "" : " read-only"}`;
        assert.ok(row, `${where}: a row`);
        checkFields(app, controls(row), id, where);
        for (const c of controls(row).filter(c => c.change === "item")) assert.equal(/\sdisabled\b/.test(c.tag), !w, `${where}: ${c.f} disabled only when read-only`);
      }
    }
  }
});

test("an opened tile shows exactly its List row's inputs, tag for tag", () => {
  for (const fixture of scenarios) {
    const app = load({ fixture });
    for (const kit of kits(app)) for (const id of app.json(`S.items.filter(i => i.kitId === ${JSON.stringify(kit)}).map(i => i.id)`)) {
      const html = tapItem(app, kit, id), where = `${fixture} ${kit} ${id}`;
      const tile = opened(html);
      checkFields(app, tile, id, where);
      assert.ok(tile.every(c => c.itemId === id), `${where}: only that item's fields`);
      const row = controls(rowOf(list(app, kit), id)).filter(c => c.change === "item");
      assert.deepEqual(tile.map(c => c.tag), row.map(c => c.tag), `${where}: the same inputs as the row`);
      app.run("S.listKit = null");
      // The row's name cell carries the Amazon link and the note; so does the opened tile
      const amazon = app.run(`amazonA(S.items.find(i => i.id === ${JSON.stringify(id)}))`);
      if (amazon) assert.ok(html.includes(amazon), `${where}: the Amazon link`);
    }
  }
});

test("tapping a tile opens only that item, tapping it or another closes it, and opening a kit closes it", () => {
  const app = load({ fixture: "tests/household" });
  let html = flat(app, "go");
  const ts = tileButtons(html);
  assert.ok(ts.length >= 3);
  for (const t of ts) {
    assert.match(t.button, /^<button type="button"/, "a real button");
    assert.equal(t.expanded, "false");
    assert.equal(t.label, `${unesc(t.body.match(/<span class="fl-name">([\s\S]*?)<\/span>/)[1])}, edit`);
    assert.equal(t.dataset.id, attr(t.li, "data-id"));
  }
  assert.deepEqual(opened(html), [], "nothing is open at first");

  const [a, b] = ts.map(t => t.dataset.id);
  html = tapItem(app, "go", a);
  assert.deepEqual(tileButtons(html).map(t => [t.dataset.id, t.expanded]), ts.map(t => [t.dataset.id, String(t.dataset.id === a)]));
  assert.deepEqual([...new Set(opened(html).map(c => c.itemId))], [a]);
  assert.ok(html.indexOf(`id="it-${a}-name"`) > html.indexOf(`data-id="${a}"`), "the fields come after their tile");

  html = tapItem(app, "go", b);
  assert.deepEqual(tileButtons(html).filter(t => t.expanded === "true").map(t => t.dataset.id), [b], "another tile closes the first");
  assert.deepEqual([...new Set(opened(html).map(c => c.itemId))], [b]);

  html = tapItem(app, "go", b);
  assert.ok(tileButtons(html).every(t => t.expanded === "false"), "tapping it again closes it");
  assert.deepEqual(opened(html), []);

  for (const open of [`ACT.openKit({ dataset: { id: "home" } })`, `ACT.gotoKit({ dataset: { id: "home" } })`, `ACT.openKit({ dataset: { id: "go" } })`]) {
    tapItem(app, "go", a);
    app.run(open);
    for (const kit of ["go", "home"]) {
      html = flat(app, kit);
      assert.deepEqual(opened(html), [], `${open}: ${kit} has nothing open`);
      assert.ok(tileButtons(html).every(t => t.expanded === "false"), open);
    }
  }
  // Opening a tile changes no doc and stores nothing
  assert.doesNotMatch(app.run("JSON.stringify({ kits: S.kits, items: S.items })"), /flOpen|expanded/);
});

// A stand-in setDoc that records each write and stores it, the way the page does with no database
const recording = app => app.run(`globalThis.WRITES = []; setDoc = async (col, id, data) => { WRITES.push([col, id, data]);
  const i = S[col].findIndex(x => x.id === id); S[col][i] = { id, ...data }; }`);
// Opens an item's tile, leaving it open when it already is
const openItem = (app, kit, id) => tileButtons(flat(app, kit)).find(t => t.dataset?.id === id)?.expanded === "true" ? flat(app, kit) : tapItem(app, kit, id);
async function changeField(app, kit, id, f, value) {
  const html = openItem(app, kit, id);
  const c = opened(html).find(c => c.f === f);
  assert.ok(c, `${id}: an opened ${f} field`);
  const target = { dataset: { change: c.change, id: c.itemId, f: c.f }, value };
  await app.fire("change", target);
  return target;
}

test("a change from an opened tile writes the item doc once, with only that field different", async () => {
  const app = load({ fixture: "tests/household" });
  recording(app);
  const cases = [
    ["go", "i4", "qty", "3", () => 3],
    ["go", "i5", "grams", "2.5", () => app.run("gOfLb('2.5')")],
    ["go", "i4", "ml", "1.2", () => 1200],
    ["home", "i2", "kcal", "5000", () => 5000],
    ["go", "i7", "expires", "2031-05", () => "2031-05"],
    ["go", "i5", "name", "  Head torch  ", () => "Head torch"],
  ];
  for (const [kit, id, f, value, want] of cases) {
    const before = app.json(`strip(S.items.find(i => i.id === ${JSON.stringify(id)}))`);
    app.run("WRITES.length = 0");
    await changeField(app, kit, id, f, value);
    const w = app.json("WRITES");
    assert.equal(w.length, 1, `${f}: one write`);
    assert.deepEqual(w[0].slice(0, 2), ["items", id]);
    assert.deepEqual(w[0][2], { ...before, [f]: want() }, `${f}: only ${f} changed`);
  }
  // The same value again writes nothing
  app.run("WRITES.length = 0");
  await changeField(app, "go", "i4", "qty", "3");
  assert.deepEqual(app.json("WRITES"), []);
});

test("an Essential picked on an opened tile is saved when it's one of the category's, and refused when it isn't", async () => {
  const app = load({ fixture: "fixtures/data-and-account-shapes/essential-tags" });
  recording(app);
  const before = app.json(`strip(S.items.find(i => i.id === "d5"))`);
  const good = app.json(`essentialList("documents").map(e => e.id)`).find(e => e !== before.essential);
  await changeField(app, "go", "d5", "essential", good);
  assert.deepEqual(app.json("WRITES"), [["items", "d5", { ...before, essential: good }]]);

  for (const [kit, id, bad] of [["go", "d1", "radio"], ["go", "d1", "flare_gun"], ["go", "c1", "toString"], ["go", "t1", ""]]) {
    app.run("WRITES.length = 0");
    const was = app.json(`S.items.find(i => i.id === ${JSON.stringify(id)})`);
    await changeField(app, kit, id, "essential", bad);
    assert.deepEqual(app.json("WRITES"), [], `${id}: ${bad} is refused`);
    assert.deepEqual(app.json(`S.items.find(i => i.id === ${JSON.stringify(id)})`), was, `${id}: its doc is unchanged`);
  }
});

test("the opened tile's Essential picker shows only for the five checklist categories", () => {
  const app = load({ fixture: "fixtures/data-and-account-shapes/essential-tags" });
  const five = app.json("Object.keys(ESSENTIALS)");
  assert.equal(five.length, 5);
  let shown = 0, hidden = 0;
  for (const kit of kits(app)) for (const it of app.json(`S.items.filter(i => i.kitId === ${JSON.stringify(kit)})`)) {
    const ess = opened(tapItem(app, kit, it.id)).filter(c => c.f === "essential");
    if (five.includes(it.category)) { assert.equal(ess.length, 1, it.id); shown++; }
    else { assert.equal(ess.length, 0, it.id); hidden++; }
  }
  assert.ok(shown && hidden);
});

test("read-only viewers get tiles with no button and no inputs, even with a tile marked open", () => {
  for (const fixture of ["tests/household", "fixtures/data-and-account-shapes/essential-tags", "fixtures/phone-width/long-essentials"]) {
    const app = load({ fixture });
    for (const kit of kits(app)) {
      const id = app.json(`(S.items.find(i => i.kitId === ${JSON.stringify(kit)}) || {}).id || null`);
      if (!id) continue;
      tapItem(app, kit, id);
      app.run("S.canWrite = false");
      const html = flat(app, kit);
      const ts = tileButtons(html);
      assert.ok(ts.length, `${fixture} ${kit}`);
      for (const t of ts) assert.doesNotMatch(t.body, /<button|<input|<select|data-act|data-change/, `${fixture} ${kit} ${t.li.slice(0, 60)}`);
      assert.deepEqual(opened(html), [], `${fixture} ${kit}: no fields`);
      app.run("S.canWrite = true");
    }
  }
});

test("a name or note holding markup stays escaped on the tile's button and in its opened fields", () => {
  const app = load({ fixture: "tests/household" });
  const evil = `<img src=x onerror=alert(1)>"'`;
  app.run(`S.items.push({ id: "x1", kitId: "go", name: ${JSON.stringify(evil)}, category: "tools", note: ${JSON.stringify(evil)}, shopQuery: ${JSON.stringify(evil)} })`);
  const html = tapItem(app, "go", "x1");
  assert.ok(!html.includes("<img src=x"), "no raw markup");
  const t = tileButtons(html).find(t => t.dataset.id === "x1");
  assert.equal(t.label, `${evil}, edit`);
  assert.equal(opened(html).find(c => c.f === "name").value, evil);
});

test("at 390px, with a tile open in each kit, the fields sit under its row across the grid and nothing scrolls sideways", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const fixtures = ["tests/household", "fixtures/phone-width/long-essentials"];
  const seen = atPhoneWidth(fixtures, () => S.kits.flatMap(k => {
    S.view = "kits"; S.openKit = k.id; S.listKit = null; render();
    // Open the first tile, a tile in a checklist category (the widest fields) and the last tile of each kit
    const bs = [...document.querySelectorAll("#v-kits .fl-tile button[aria-expanded]")];
    const five = Object.keys(ESSENTIALS), catOf = b => S.items.find(i => i.id === b.dataset.id)?.category;
    const pick = [...new Set([bs[0], bs.find(b => five.includes(catOf(b))), bs.at(-1)].filter(Boolean))];
    return pick.map(b0 => {
      const id = b0.dataset.id;
      S.flOpen = null; render();
      document.querySelector(`#v-kits .fl-tile button[data-id="${id}"]`).click();
      const b = document.querySelector(`#v-kits .fl-tile button[data-id="${id}"]`);
      const tile = b.closest(".fl-tile"), grid = tile.closest(".fl-grid"), panel = grid.querySelector(".fl-fields");
      const tr = tile.getBoundingClientRect(), gr = grid.getBoundingClientRect(), pr = panel && panel.getBoundingClientRect();
      const all = [...grid.querySelectorAll(".fl-tile")], at = all.indexOf(tile);
      const row = all.filter(t => Math.abs(t.getBoundingClientRect().top - tr.top) < 1).length;
      return {
        kit: k.name, id, width: innerWidth, scroll: document.documentElement.scrollWidth, expanded: b.getAttribute("aria-expanded"),
        panel: !!pr, below: pr && pr.top >= tr.bottom - 1, across: pr && Math.abs(pr.left - gr.left) < 1 && Math.abs(pr.right - gr.right) < 1,
        row, want: Math.min(4, all.length - Math.floor(at / 4) * 4),
        inside: !!pr && [...panel.querySelectorAll("input, select, a")].every(e => { const r = e.getBoundingClientRect(); return r.left >= pr.left - 1 && r.right <= pr.right + 1; }),
        ess: !!document.getElementById(`it-${id}-ess`),
      };
    });
  }));
  for (const f of fixtures) {
    const opens = seen.get(f);
    assert.ok(opens && opens.length, `${f}: nothing opened`);
    assert.ok(opens.some(o => o.ess), `${f}: no open tile had an Essential picker`);
    for (const o of opens) {
      const where = `${f}, ${o.kit}, ${o.id}`;
      assert.equal(o.width, 390, `${where}: the viewport isn't 390px`);
      assert.equal(o.expanded, "true", where);
      assert.ok(o.panel, `${where}: no fields`);
      assert.ok(o.scroll <= o.width, `${where}: scrolls sideways (${o.scroll}px wide)`);
      assert.ok(o.below, `${where}: the fields aren't under the tile`);
      assert.ok(o.across, `${where}: the fields don't span the grid`);
      assert.ok(o.inside, `${where}: a field runs out of the panel`);
      assert.equal(o.row, o.want, `${where}: the tile's row broke up`);
    }
  }
});

// Every category, and every essential of each, is tried on one item, so every label the two selects can show is measured
test("at 390px, an opened tile's Category and Essential show the chosen option whole, whichever it is", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const fixture = "fixtures/phone-width/long-essentials";
  const seen = atPhoneWidth([fixture], () => {
    const out = { n: 0, longest: 0, cut: [] }, it = S.items[0], k = S.kits.find(k => k.id === it.kitId);
    const picks = Object.keys(CATS).flatMap(c => ["", "none", ...essentialList(c).map(e => e.id)].map(e => [c, e]));
    for (const [cat, ess] of picks) {
      it.category = cat; it.essential = ess;
      S.view = "kits"; S.openKit = k.id; S.listKit = null; S.flOpen = it.id; render();
      // A copy of each select holding only its chosen option, sized to that option, beside the real one
      for (const sel of document.querySelectorAll("#v-kits .fl-fields select")) {
        const one = sel.cloneNode(false), opt = sel.selectedOptions[0];
        if (opt) one.append(opt.cloneNode(true));
        one.removeAttribute("id"); one.style.cssText = "position:absolute;visibility:hidden;width:auto";
        sel.after(one);
        const need = one.getBoundingClientRect().width, has = sel.getBoundingClientRect().width;
        one.remove();
        out.n++; if (sel.dataset.f === "essential") out.longest = Math.max(out.longest, opt ? opt.text.length : 0);
        if (has + 0.5 < need) out.cut.push(`${cat}/${ess || "untagged"}: its ${sel.dataset.f} shows "${opt?.text}" in ${Math.round(has)}px, but needs ${Math.round(need)}px`);
      }
    }
    return out;
  });
  const s = seen.get(fixture);
  assert.ok(s && s.n, "nothing measured");
  assert.deepEqual(s.cut, [], `${s.cut.length} of ${s.n} selects cut their chosen option`);
  assert.ok(s.longest > 20, "a long essential's name was measured");
});

/* Real input, in Chrome: a field saves on blur, and the save redraws the kit. A tap or Tab that blurs the field must
   still land where it was aimed, on the redrawn page. */
test("a tap or Tab that saves an edited field still lands on what it was aimed at, with real mouse, touch and keyboard", { skip: !chrome && "no Chrome found (set CHROME)" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-input-"));
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, wrap(undefined, "fixtures/phone-width/long-essentials"));
  const page = await openChrome(chrome);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const ev = async e => {
    const r = await page.send("Runtime.evaluate", { expression: e, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${e}: ${r.exceptionDetails.exception?.description}`);
    return r.result.value;
  };
  const at = sel => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: "center" });
    const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  /* A finger or a button goes down, stays a moment (timers run before it lifts), and comes up; the press is done once
     the page has had its click. A finger is raw touch points, so Chrome makes the pointer, touch, mouse and click events
     a phone does (Linux headless Chrome's synthesizeTapGesture fires no click at all, even on a bare button). */
  const press = async (sel, how) => {
    const [x, y] = await at(sel), clicks = await ev("clicks");
    if (how === "touch") await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    else await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await sleep(60);
    if (how === "touch") await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    else await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    for (let i = 0; i < 100 && await ev("clicks") === clicks; i++) await sleep(20);
    assert.ok(await ev("clicks") > clicks, `${how}: pressing ${sel} gave the page no click`);
    await sleep(50); // a redraw the save owes runs in the task after the click
  };
  const key = async (key, code = key) => {
    const vk = key === "Tab" ? 9 : key.charCodeAt(0);
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, text: key.length === 1 ? key : undefined });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk });
    await sleep(20);
  };
  const type = async (sel, text) => {
    await ev(`(e => { e.focus(); e.select?.(); })(document.querySelector(${JSON.stringify(sel)}))`);
    await page.send("Input.insertText", { text });
  };
  const item = async id => JSON.parse(await ev(`JSON.stringify(S.items.find(i => i.id === ${JSON.stringify(id)}))`));
  const active = () => ev("document.activeElement.id || document.activeElement.tagName");
  const start = async (how, list) => {
    await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.send("Emulation.setTouchEmulationEnabled", { enabled: how === "touch" });
    const loaded = page.once("Page.loadEventFired");
    await page.send("Page.navigate", { url: `file://${file}?${how}${list ? "-list" : ""}#kits` });
    await loaded;
    for (let i = 0; i < 50 && !await ev("S.loaded"); i++) await sleep(50);
    await ev(`window.clicks = 0; addEventListener("click", () => clicks++, true); S.openKit = "go"; S.listKit = ${list ? '"go"' : "null"}; render()`);
  };
  try {
    for (const how of ["mouse", "touch"]) {
      await start(how);
      await press('.fl-ed[data-id="g3"]', how);
      assert.equal(await ev("S.flOpen"), "g3", `${how}: the first tap opens Ibuprofen`);
      await type("#it-g3-qty", "5");
      await press('.fl-ed[data-id="g6"]', how);
      assert.equal((await item("g3")).qty, 5, `${how}: the edited Qty is saved`);
      assert.equal(await ev("S.flOpen"), "g6", `${how}: the tap that saved Qty opens the tile it landed on`);
      assert.equal(await active(), "fl-g6", `${how}: focus is on the tapped tile`);

      // The same in List: a button pressed while a row's field holds an unsaved value
      await start(how, true);
      await type("#it-g3-qty", "4");
      await press('[data-act="kitView"][data-v="flat"]', how);
      assert.equal((await item("g3")).qty, 4, `${how}: List's edited Qty is saved`);
      assert.equal(await ev("S.listKit"), null, `${how}: the Flat-lay button pressed after the edit switches to Flat-lay`);
    }

    // Tab out of an edited field lands on the next field. (Headless Chrome's month field takes no typed keys and
    // keeps Tab, so Expires isn't driven here; a tap moving focus to a tile is checked above.)
    await start("mouse");
    await press('.fl-ed[data-id="g3"]', "mouse");
    await type("#it-g3-g", "2");
    await key("Tab");
    await sleep(150);
    assert.equal((await item("g3")).grams, await ev("gOfLb(2)"), "Tab saves lb");
    assert.equal(await active(), "it-g3-ml", "Tab from lb lands on Size L");
  } finally {
    await page.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
