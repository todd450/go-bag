// The Essential picker in the kit's inventory and its add-by-hand row: a wrong or missing tag can always be
// fixed by hand (issue #39). Writes are caught at setDoc, the page's one way to save a doc.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");

const scenarios = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

// Loads a scenario and records every doc the page writes, as [collection, id, doc].
function withWrites(fixture) {
  const app = load({ fixture });
  app.run(`globalThis.WRITES = []; (save => { setDoc = (col, id, data) => { WRITES.push([col, id, JSON.parse(JSON.stringify(data))]); return save(col, id, data); }; })(setDoc)`);
  app.writes = () => app.json("WRITES");
  return app;
}

// Each item row of the open kit's inventory, by item id: its cells, and its Essential select if it has one.
function rows(run, kitId) {
  const html = run(`S.openKit = ${JSON.stringify(kitId)}; viewKits(model())`);
  const table = html.match(/<table class="inv">[\s\S]*?<\/table>/)[0];
  const out = {};
  for (const tr of table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g)) {
    const id = tr.match(/id="it-(.+?)-name"/)?.[1] ?? (tr.includes('class="addrow"') ? "+add" : null);
    if (id == null) continue;
    const select = tr.match(/<select[^>]*data-f="essential"[^>]*>[\s\S]*?<\/select>/)?.[0] ?? null;
    out[id] = { tr, select, cells: tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) };
  }
  return { html, table, rows: out };
}
const options = select => [...select.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)].map(([, value, attrs, label]) => ({ value, selected: /\bselected\b/.test(attrs), label }));

test("every item in a checklist category has an Essential picker with its category's essentials, then \"none\"", () => {
  for (const fixture of scenarios) {
    const { run, json } = load({ fixture });
    const E = json("ESSENTIALS");
    for (const kitId of json("S.kits.map(k => k.id)")) {
      const items = json(`S.items.filter(i => i.kitId === ${JSON.stringify(kitId)}).map(i => ({ ...i, tag: essentialOf(i) }))`);
      const { table, rows: got } = rows(run, kitId);
      for (const it of items) {
        const row = got[it.id], where = `${fixture} ${kitId}/${it.id}`;
        assert.ok(row, where);
        if (!Object.hasOwn(E, it.category)) { assert.equal(row.select, null, `${where}: no picker outside the five`); continue; }
        assert.ok(row.select, `${where}: picker`);
        const opts = options(row.select).filter(o => o.value !== "");
        assert.deepEqual(opts.map(o => o.value), [...E[it.category].map(e => e.id), "none"], where);
        for (const o of opts) assert.ok(o.label.trim(), `${where}: ${o.value} has a label`);
        // The picker shows the item's tag as the rule reads it: a stale or odd tag shows as untagged.
        const chosen = options(row.select).filter(o => o.selected).map(o => o.value);
        assert.deepEqual(chosen, [it.tag], where);
        if (it.tag) assert.ok(!options(row.select).some(o => o.value === ""), `${where}: a tagged item has no "pick one" option`);
        else assert.ok(options(row.select)[0].value === "" && options(row.select)[0].label.trim(), `${where}: an untagged item asks to pick one`);
      }
      // One heading per column, so the desktop table lines up, and every row has as many cells.
      const ths = (table.match(/<th[\s>]/g) || []).length;
      for (const [id, row] of Object.entries(got)) assert.equal(row.cells.length, ths, `${fixture} ${kitId}/${id}: cells match headings`);
    }
  }
});

test("the Essential cell is labelled for the card layout, beside Category", () => {
  const { run } = load({ fixture: "tests/household" });
  const { rows: got } = rows(run, "go");
  const cell = got.i7.cells.find(td => td.includes('data-f="essential"'));
  assert.match(cell, /^<td[^>]*data-label="[^"]+"/);
  const at = got.i7.cells.indexOf(cell);
  assert.match(got.i7.cells[at - 1], /data-f="category"/, "it sits right after Category");
  // A row outside the five keeps the column, empty.
  assert.match(got.i4.cells[at], /^<td[^>]*><\/td>$/);
});

test("picking an essential writes the item doc with only `essential` changed", async () => {
  const { run, json, fire, writes } = withWrites("tests/household");
  const old = json(`(({ id, ...rest }) => rest)(S.items.find(i => i.id === "i3"))`);
  const pick = value => fire("change", { dataset: { change: "item", id: "i3", f: "essential" }, value });
  await pick("extinguisher");
  assert.deepEqual(writes(), [["items", "i3", { ...old, essential: "extinguisher" }]]);
  await pick("extinguisher");
  assert.equal(writes().length, 1, "re-picking the same value writes nothing");
  // Another category's essential, an unknown value, the empty "pick one" and odd strings write nothing.
  for (const v of ["cash", "radio", "prescriptions", "flare_gun", "Extinguisher", " extinguisher", "", "constructor", "__proto__", "toString", "hasOwnProperty"]) await pick(v);
  assert.equal(writes().length, 1, "values off the category's list write nothing");
  assert.equal(json(`S.items.find(i => i.id === "i3").essential`), "extinguisher");
  await pick("none");
  assert.deepEqual(writes().at(-1), ["items", "i3", { ...old, essential: "none" }]);
  assert.equal(json(`S.items.find(i => i.id === "i3").essential`), "none");
});

test("an item outside the five categories, or one not in the list, takes no tag", async () => {
  const { fire, writes } = withWrites("tests/household");
  for (const id of ["i1", "i4", "i6"]) for (const value of ["none", "cash", "extinguisher"]) await fire("change", { dataset: { change: "item", id, f: "essential" }, value });
  await fire("change", { dataset: { change: "item", id: "gone", f: "essential" }, value: "none" });
  assert.deepEqual(writes(), []);
});

test("a stale or odd tag is replaced by a pick, and a pick from the stale category writes nothing", async () => {
  const { json, fire, writes } = withWrites("fixtures/data-and-account-shapes/essential-tags");
  const pick = (id, value) => fire("change", { dataset: { change: "item", id, f: "essential" }, value });
  await pick("f2", "radio"); // its stored tag, from Comms: not on Fire safety's list
  assert.deepEqual(writes(), []);
  for (const [id, value] of [["f2", "escape_ladder"], ["c2", "whistle"], ["c3", "radio"], ["t2", "duct_tape"]]) {
    const old = json(`(({ id, ...rest }) => rest)(S.items.find(i => i.id === ${JSON.stringify(id)}))`);
    await pick(id, value);
    assert.deepEqual(writes().at(-1), ["items", id, { ...old, essential: value }], id);
  }
  assert.equal(writes().length, 4);
});

test("tagging the household's fire extinguisher raises the Basement bin's score", async () => {
  const { json, fire } = withWrites("tests/household");
  const before = json("model().kitRes.home.score");
  await fire("change", { dataset: { change: "item", id: "i3", f: "essential" }, value: "extinguisher" });
  const after = json("model().kitRes.home.score");
  assert.ok(after > before, `${before} -> ${after}`);
  const fire_row = json(`model().kitRes.home.rows.find(r => r.cat === "fire_safety")`);
  assert.ok(fire_row.ess.find(e => e.id === "extinguisher").have, "the extinguisher line is filled");
});

test("changing an item's category writes only the category, and its old tag stops counting", async () => {
  const { json, fire, writes } = withWrites("fixtures/data-and-account-shapes/essential-tags");
  const old = json(`(({ id, ...rest }) => rest)(S.items.find(i => i.id === "d2"))`);
  await fire("change", { dataset: { change: "item", id: "d2", f: "category" }, value: "tools" });
  assert.deepEqual(writes(), [["items", "d2", { ...old, category: "tools" }]]);
  assert.equal(json(`essentialOf(S.items.find(i => i.id === "d2"))`), "");
});

test("with no right to edit, every Essential picker is disabled", () => {
  for (const fixture of ["tests/household", "fixtures/data-and-account-shapes/essential-tags"]) {
    const { run, json } = load({ fixture });
    run("S.canWrite = false");
    let seen = 0;
    for (const kitId of json("S.kits.map(k => k.id)")) for (const row of Object.values(rows(run, kitId).rows)) {
      if (!row.select) continue;
      seen++;
      assert.match(row.select.match(/<select[^>]*>/)[0], /\bdisabled\b/, `${fixture} ${kitId}`);
    }
    assert.ok(seen > 0, fixture);
    run("S.canWrite = true");
    for (const kitId of json("S.kits.map(k => k.id)")) for (const row of Object.values(rows(run, kitId).rows))
      if (row.select) assert.doesNotMatch(row.select.match(/<select[^>]*>/)[0], /\bdisabled\b/);
  }
});

// The add-by-hand row, with a stand-in for its inputs. Its Essential cell is rewritten when the category
// changes, the way a browser would: the select inside exists only while the cell's markup has one.
function addRow(app) {
  app.run(`(() => {
    const base = document.querySelector;
    const v = value => ({ value, focus() {} });
    let ess = null;
    const cell = { h: "", get innerHTML() { return this.h; }, set innerHTML(h) {
      this.h = h;
      ess = /id="add-ess"/.test(h) ? v((h.match(/<option value="([^"]*)"[^>]*\\bselected/) || [, (h.match(/<option value="([^"]*)"/) || [])[1]])[1]) : null;
    } };
    const els = globalThis.ADD = { "#add-name": v(""), "#add-cat": v("water"), "#add-qty": v("1"), "#add-l": v(""), "#add-k": v(""), "#add-g": v(""), "#add-ml": v(""), "#add-exp": v(""), "#add-ess-td": cell };
    document.querySelector = s => s === "#add-ess" ? ess : els[s] || base(s);
  })()`);
  const cat = value => { app.run(`ADD["#add-cat"].value = ${JSON.stringify(value)}`); return app.fire("change", { id: "add-cat", dataset: { change: "addCat" }, value }); };
  const essSelect = () => app.run(`document.querySelector("#add-ess")`) ? app.run(`document.querySelector("#add-ess").value`) : null;
  const pickEss = value => app.run(`document.querySelector("#add-ess").value = ${JSON.stringify(value)}`);
  const add = name => { app.run(`ADD["#add-name"].value = ${JSON.stringify(name)}`); return app.run("ACT.addItem()"); };
  return { cat, essSelect, pickEss, add, cell: () => app.run(`ADD["#add-ess-td"].innerHTML`) };
}

test("the add row offers the Essential picker for the category chosen there, and only for the five", async () => {
  const app = withWrites("tests/household");
  const { rows: got } = rows(app.run, "go");
  const add = got["+add"];
  assert.ok(add, "add row");
  assert.match(add.tr, /id="add-cat"[^>]*data-change="addCat"|data-change="addCat"[^>]*id="add-cat"/);
  assert.equal(add.select, null, "Water, the starting category, has no picker");
  assert.ok(add.cells.some(td => /id="add-ess-td"/.test(td) && /data-label="[^"]+"/.test(td)), "the add row has a labelled Essential cell");
  const r = addRow(app);
  const E = app.json("ESSENTIALS");
  for (const c of Object.keys(E)) {
    await r.cat(c);
    assert.deepEqual(options(r.cell()).filter(o => o.value).map(o => o.value), [...E[c].map(e => e.id), "none"], c);
    assert.equal(r.essSelect(), "", `${c}: starts on "pick one"`);
  }
  for (const c of ["water", "light", "car", "other"]) { await r.cat(c); assert.equal(r.cell(), "", c); assert.equal(r.essSelect(), null, c); }
});

test("adding by hand saves `essential` only when it is valid for the final category", async () => {
  const app = withWrites("tests/household");
  app.run(`S.openKit = "go"`);
  const r = addRow(app);
  const saved = () => app.writes().at(-1)[2];

  await r.cat("documents"); r.pickEss("cash"); await r.add("Envelope of twenties");
  assert.equal(saved().name, "Envelope of twenties");
  assert.equal(saved().category, "documents");
  assert.equal(saved().essential, "cash");

  await r.cat("documents"); r.pickEss("none"); await r.add("Notebook");
  assert.equal(saved().essential, "none");

  // Changing the category clears the picker, so nothing picked for the old one is saved.
  await r.cat("documents"); r.pickEss("cash"); await r.cat("water"); await r.add("Water jugs");
  assert.equal(saved().category, "water");
  assert.ok(!("essential" in saved()), "water takes no tag");
  await r.cat("documents"); r.pickEss("cash"); await r.cat("fire_safety"); await r.add("Extinguisher");
  assert.equal(saved().category, "fire_safety");
  assert.ok(!("essential" in saved()), "a reset picker saves no tag");

  // Left on "pick one", nothing is saved; a value off the final category's list is never saved.
  await r.cat("tools"); await r.add("Rope");
  assert.ok(!("essential" in saved()));
  await r.cat("tools"); r.pickEss("cash"); await r.add("Odd");
  assert.ok(!("essential" in saved()));
  await r.cat("tools"); r.pickEss("constructor"); await r.add("Odder");
  assert.ok(!("essential" in saved()));
  assert.equal(app.writes().length, 7);
});

// What the add row shows when it is drawn again: the category its select shows (the selected option, or the
// first), and its Essential select's values and the one shown, or null when it has none.
function addRowShown(run) {
  const tr = rows(run, "go").rows["+add"].tr;
  const cats = options(tr.match(/<select id="add-cat"[^>]*>[\s\S]*?<\/select>/)[0]);
  const ess = tr.match(/<select id="add-ess"[^>]*>[\s\S]*?<\/select>/)?.[0];
  const shown = list => (list.find(o => o.selected) || list[0]).value;
  return { cat: shown(cats), ess: ess ? { values: options(ess).map(o => o.value).filter(Boolean), picked: shown(options(ess)) } : null };
}

test("drawing the add row again keeps its category and its Essential picker together", async () => {
  const app = withWrites("tests/household");
  app.run(`S.openKit = "go"`);
  const E = app.json("ESSENTIALS"), cats = app.json("Object.keys(CATS)");
  const agree = (cat, picked, why) => {
    const shown = addRowShown(app.run);
    assert.equal(shown.cat, cat, `${why}: category`);
    if (Object.hasOwn(E, cat)) assert.deepEqual(shown.ess, { values: [...E[cat].map(e => e.id), "none"], picked }, `${why}: picker`);
    else assert.equal(shown.ess, null, `${why}: no picker`);
  };
  const cat = value => app.fire("change", { id: "add-cat", dataset: { change: "addCat" }, value });
  const ess = value => app.fire("change", { id: "add-ess", dataset: { change: "addEss" }, value });
  agree("water", "", "to start");
  for (const c of cats) { await cat(c); agree(c, "", c); }
  await cat("documents"); await ess("cash");
  agree("documents", "cash", "a picked essential");
  await cat("tools");
  agree("tools", "", "a new category starts on pick one");
  // Values off the lists never leave the row showing one thing and holding another.
  await ess("cash"); agree("tools", "", "an essential off the category's list");
  await cat("constructor"); agree("water", "", "an unknown category");
  // After adding, the row keeps its category and asks for the next item's essential.
  const r = addRow(app);
  await r.cat("documents"); await ess("cash"); r.pickEss("cash"); await r.add("Envelope of twenties");
  assert.equal(app.writes().at(-1)[2].essential, "cash");
  agree("documents", "", "after adding");
});

// The same in a real browser, the way Safari and iPhone leave it: tapping + keeps focus on the category select,
// and render() puts back the focused control's value. Skipped when there's no Chrome.
const { execFileSync } = require("node:child_process");
const os = require("node:os");
const { wrap } = require("../tools/page.js");
const chrome = process.env.CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(f => fs.existsSync(f));
test("in a browser, the add row never shows a checklist category without its Essential picker", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-addrow-"));
  try {
    const probe = `<script>addEventListener("load", () => setTimeout(async () => { try {
      const out = [], q = s => document.querySelector(s), wait = () => new Promise(r => setTimeout(r, 300));
      const look = where => { const c = q("#add-cat"), e = q("#add-ess"); out.push({ where, cat: c.value, ess: e ? [...e.options].map(o => o.value).filter(Boolean) : null, picked: e ? e.value : null }); };
      const pick = (sel, v) => { const n = q(sel); if (!n) return; n.focus(); n.value = v; n.dispatchEvent(new Event("change", { bubbles: true })); };
      S.view = "kits"; S.openKit = "go"; render();
      q("#add-name").value = "Passport copy"; pick("#add-cat", "documents");
      q('[data-act="addItem"]').click(); await wait(); look("after + with Essential left on pick one");
      pick("#add-cat", "fire_safety"); render(); look("drawn again with the category focused");
      pick("#add-ess", "extinguisher"); render(); look("drawn again with the essential focused");
      q("#add-name").value = "Extinguisher"; q("#add-cat").focus(); q('[data-act="addItem"]').click(); await wait(); look("after + with an essential picked");
      out.push({ saved: S.items.filter(i => i.kitId === "go" && i.source === "manual").map(i => [i.name, i.category, i.essential ?? null]), ESS: ESSENTIALS });
      document.body.dataset.out = JSON.stringify(out);
    } catch (e) { document.body.dataset.out = JSON.stringify({ error: String(e && e.stack || e) }); } }, 500));</script>`;
    fs.writeFileSync(path.join(dir, "page.html"), wrap(undefined, "tests/household").replace(/<\/body>(?![\s\S]*<\/body>)/, probe + "</body>"));
    const html = execFileSync(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${path.join(dir, "profile")}`,
      "--virtual-time-budget=5000", "--dump-dom", `file://${path.join(dir, "page.html")}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 });
    const m = html.match(/<body[^>]* data-out="([^"]*)"/);
    assert.ok(m, "the page reported nothing");
    const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    assert.ok(Array.isArray(out), out.error);
    const { saved, ESS } = out.pop();
    for (const v of out) {
      if (Object.hasOwn(ESS, v.cat)) assert.deepEqual(v.ess, [...ESS[v.cat].map(e => e.id), "none"], `${v.where}: ${v.cat} shows its picker`);
      else assert.equal(v.ess, null, `${v.where}: ${v.cat} has no picker`);
    }
    assert.equal(out[0].cat, "documents", "the category the household chose stays");
    assert.equal(out[2].picked, "extinguisher", "a picked essential stays");
    assert.deepEqual(saved, [["Passport copy", "documents", null], ["Extinguisher", "fire_safety", "extinguisher"]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});
