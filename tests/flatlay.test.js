// The Contents panel on the Kits tab (issue #61): a flat-lay of one tile per item, grouped into the zones of
// ZONES, with the item table behind a List toggle that nothing remembers.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");

const scenarios = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = html => unesc(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
const kitHtml = (run, id) => run(`S.view = "kits"; S.openKit = ${JSON.stringify(id)}; viewKits(model())`);

// The flat-lay in a piece of HTML: each zone's heading, how many tiles it shows, and its items' tiles in the order
// shown.
function zones(html) {
  return [...html.matchAll(/<section class="fl-zone"[^>]*>([\s\S]*?)<\/section>/g)].map(([, z]) => ({
    label: text((z.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || ["", ""])[1]),
    n: (z.match(/<li class="fl-tile/g) || []).length,
    tiles: [...z.matchAll(/<li class="fl-tile((?![^"]*\bmiss\b)[^"]*)"([^>]*)>([\s\S]*?)<\/li>/g)].map(([, cls, attrs, body]) => ({
      id: unesc((attrs.match(/data-id="([^"]*)"/) || ["", ""])[1]), cls: cls.trim().split(/\s+/).filter(Boolean), body,
      name: text((body.match(/<span class="fl-name"[^>]*>([\s\S]*?)<\/span>/) || ["", ""])[1]),
      qty: text((body.match(/<span class="fl-q"[^>]*>([\s\S]*?)<\/span>/) || ["", ""])[1]),
      note: text((body.match(/<span class="fl-note"[^>]*>([\s\S]*?)<\/span>/) || ["", ""])[1]),
      all: text(body),
    })),
  }));
}
const tiles = html => zones(html).flatMap(z => z.tiles);
// A button's data-* attributes, as the click handler hands them to its ACT.
const buttons = html => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, body]) => ({
  attrs, label: text(body), dataset: Object.fromEntries([...attrs.matchAll(/data-([a-z]+)="([^"]*)"/g)].map(m => [m[1], unesc(m[2])])),
  pressed: (attrs.match(/aria-pressed="([^"]*)"/) || [])[1],
}));
const toggle = html => buttons(html).filter(b => b.label === "Flat-lay" || b.label === "List");
function press(app, html, label) {
  const b = buttons(html).find(b => b.label === label && b.dataset.act);
  assert.ok(b, `a "${label}" button`);
  return app.run(`ACT[${JSON.stringify(b.dataset.act)}](${JSON.stringify({ dataset: b.dataset })})`);
}

test("every CATS key sits in exactly one zone, in the order the brief names them", () => {
  const { json } = load();
  const Z = json("ZONES"), cats = json("Object.keys(CATS)");
  assert.deepEqual(Z.map(z => z.label), ["Water & food", "First aid & medicine", "Light, power & comms", "Shelter, clothing & hygiene", "Tools & safety", "Documents & cash", "Family & pets", "Other"]);
  const all = Z.flatMap(z => z.cats);
  assert.deepEqual([...all].sort(), [...cats].sort(), "the zones hold every category and nothing else");
  assert.equal(new Set(all).size, all.length, "no category is in two zones");
  for (const z of Z) assert.ok(z.label && z.cats.length, z.label);
  assert.ok(Z.at(-1).cats.includes("other"));
});

test("every kit in every scenario shows one tile per item, each in its category's zone, zones in ZONES order", () => {
  for (const fixture of scenarios) {
    const app = load({ fixture });
    const Z = app.json("ZONES");
    const zoneOf = c => (Z.find(z => z.cats.includes(c)) || Z.at(-1)).label;
    for (const kit of app.json("S.kits.map(k => k.id)")) {
      const items = app.json(`S.items.filter(i => i.kitId === ${JSON.stringify(kit)})`);
      const html = kitHtml(app.run, kit), where = `${fixture} ${kit}`;
      const zs = zones(html);
      assert.deepEqual(zs.flatMap(z => z.tiles.map(t => t.id)).sort(), items.map(i => i.id).sort(), `${where}: one tile per item`);
      for (const z of zs) {
        assert.ok(z.n, `${where}: ${z.label} has tiles`);
        for (const t of z.tiles) assert.equal(z.label, zoneOf(items.find(i => i.id === t.id).category), `${where}: ${t.id}`);
      }
      const order = zs.map(z => Z.findIndex(x => x.label === z.label));
      assert.deepEqual(order, [...order].sort((a, b) => a - b), `${where}: zones in ZONES order`);
      assert.equal(new Set(order).size, order.length, `${where}: each zone once`);
      for (const t of zs.flatMap(z => z.tiles)) assert.doesNotMatch(t.body, /NaN|undefined|Infinity|\[object|function/, `${where}: ${t.id}`);
    }
  }
});

test("an item whose category isn't in CATS lands in Other, with Other's icon", () => {
  const app = load({ fixture: "fixtures/data-and-account-shapes/odd-values" });
  app.run(`S.items.push({ id: "z1", kitId: "k", name: "Odd one", category: "constructor" }, { id: "z2", kitId: "k", name: "No category" })`);
  const zs = zones(kitHtml(app.run, "k"));
  const other = zs.find(z => z.label === "Other");
  assert.deepEqual(other.tiles.map(t => t.id).sort(), ["a", "z1", "z2"]);
  const otherIcon = app.run("icon('other')");
  for (const t of other.tiles) assert.ok(t.body.includes(otherIcon), `${t.id} shows Other's icon`);
  assert.equal(zs.find(z => z.label === "Water & food").tiles[0].id, "c");
});

test("tiles sort the way the table does by category, then by name", () => {
  const app = load({ fixture: "fixtures/phone-width/long-essentials" });
  app.run(`S.itemSort = "value"; S.items.push(
    { id: "n1", kitId: "go", name: "Zinc tape", category: "tools" }, { id: "n2", kitId: "go", name: "Axe", category: "tools" },
    { id: "n3", kitId: "go", name: "Blanket", category: "shelter" }, { id: "n4", kitId: "go", name: "Apron", category: "clothing" })`);
  const items = app.json(`S.items.filter(i => i.kitId === "go")`);
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const zs = zones(kitHtml(app.run, "go"));
  assert.ok(zs.length >= 4 && zs.some(z => z.tiles.length >= 4));
  for (const z of zs) {
    const got = z.tiles.map(t => t.id);
    const want = [...got].sort((a, b) => String(byId[a].category).localeCompare(String(byId[b].category)) || String(byId[a].name).localeCompare(String(byId[b].name)));
    assert.deepEqual(got, want, z.label);
  }
});

test("a tile shows ×N only over 1 and no second line: its note, litres and kcal stay in its opened fields", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.items.push(
    { id: "q1", kitId: "go", name: "Whistle", category: "communication", qty: 1, note: "Orange, on the strap" },
    { id: "q2", kitId: "go", name: "Bars", category: "food", qty: "3", kcal: 2400 },
    { id: "q3", kitId: "go", name: "Pouches", category: "water", qty: 0, liters: 2.5, note: "" },
    { id: "q4", kitId: "go", name: "Gloves", category: "clothing", qty: "two" },
    { id: "q5", kitId: "go", name: "Tea lights", category: "light", qty: 12, liters: 4, kcal: 900 })`);
  const t = Object.fromEntries(tiles(kitHtml(app.run, "go")).map(x => [x.id, x]));
  assert.equal(t.i5.qty, "×2");
  assert.equal(t.q2.qty, "×3");
  assert.equal(t.q5.qty, "×12");
  for (const id of ["i4", "q1", "q3", "q4"]) assert.equal(t[id].qty, "", `${id} has no badge`);
  for (const x of Object.values(t)) assert.equal(x.note, "", `${x.id} has no note line`);
  assert.doesNotMatch(t.q1.all, /Orange/);
  assert.doesNotMatch(t.q2.all, /kcal/);
  assert.doesNotMatch(t.q3.all, /\bL\b/);
  const home = Object.fromEntries(tiles(kitHtml(app.run, "home")).map(x => [x.id, x]));
  assert.equal(home.i1.all, "×4 Water jugs");
});

test("an expired tile is outlined, struck through and dated, and one expiring soon says when", () => {
  const app = load({ fixture: "tests/household" });
  const soon = new Date(); soon.setMonth(soon.getMonth() + 1);
  const ym = soon.toISOString().slice(0, 7);
  app.run(`S.items.push({ id: "s1", kitId: "go", name: "Batteries", category: "power", qty: 4, expires: "${ym}" }, { id: "s2", kitId: "go", name: "Bad date", category: "power", expires: "soon" })`);
  const t = Object.fromEntries(tiles(kitHtml(app.run, "go")).map(x => [x.id, x]));
  assert.ok(t.i7.cls.includes("expired") && !t.i7.cls.includes("soon"));
  assert.match(t.i7.all, /\bExpired 2020-01\b/);
  assert.ok(t.s1.cls.includes("soon") && !t.s1.cls.includes("expired"));
  assert.match(t.s1.all, new RegExp(`\\bExpires ${ym}\\b`));
  for (const id of ["i4", "i5", "s2"]) {
    assert.deepEqual(t[id].cls, [], id);
    assert.doesNotMatch(t[id].all, /Expire/, id);
  }
});

test("names holding markup render escaped on their tiles, and a note holding markup never reaches one", () => {
  const app = load({ fixture: "tests/household" });
  const evil = `<img src=x onerror=alert(1)>`;
  app.run(`S.items.push({ id: "x1", kitId: "go", name: ${JSON.stringify(evil)}, category: "tools", note: ${JSON.stringify(evil + '"')} }, { id: "x2\\"><b>", kitId: "go", name: "Id", category: "light" })`);
  const html = kitHtml(app.run, "go");
  assert.ok(!html.includes(evil) && !html.includes('x2"><b>'));
  const t = Object.fromEntries(tiles(html).map(x => [x.id, x]));
  assert.equal(t.x1.name, evil);
  assert.equal(t.x1.note, "");
  assert.ok(t['x2"><b>'], "an id holding markup stays one attribute");
});

test("the panel opens on Flat-lay, List shows the item table, and opening another kit goes back", () => {
  const app = load({ fixture: "tests/household" });
  let html = kitHtml(app.run, "go");
  assert.deepEqual(toggle(html).map(b => [b.label, b.pressed]), [["Flat-lay", "true"], ["List", "false"]]);
  assert.doesNotMatch(html, /<table class="inv">/);
  assert.equal(tiles(html).length, 3);

  press(app, html, "List");
  html = app.run("viewKits(model())");
  assert.deepEqual(toggle(html).map(b => [b.label, b.pressed]), [["Flat-lay", "false"], ["List", "true"]]);
  assert.equal(tiles(html).length, 0, "List shows no tiles");
  const table = html.match(/<table class="inv">[\s\S]*?<\/table>/)[0];
  // The table's rows and inputs: one row per item with every field, then the add-by-hand row
  for (const id of ["i4", "i5", "i7"]) {
    for (const f of ["name", "cat", "qty", "l", "k", "g", "ml", "exp"]) assert.match(table, new RegExp(`id="it-${id}-${f}"`), `${id} ${f}`);
    assert.match(table, new RegExp(`id="sel-${id}"`));
    assert.match(table, new RegExp(`data-act="delItem" data-id="${id}"`));
  }
  for (const f of ["name", "cat", "qty", "l", "k", "g", "ml", "exp"]) assert.match(table, new RegExp(`id="add-${f}"`));
  assert.match(html, /How this works/);
  assert.match(html, /Tick anything that's no longer in this kit/);
  app.run(`S.sel.add("i4")`);
  assert.match(app.run("viewKits(model())"), /class="selbar"/, "the select bar shows in List");

  press(app, html, "Flat-lay");
  html = app.run("viewKits(model())");
  assert.equal(toggle(html)[0].pressed, "true");
  assert.equal(tiles(html).length, 3);

  for (const open of [`ACT.openKit({ dataset: { id: "home" } })`, `ACT.gotoKit({ dataset: { id: "go" } })`]) {
    press(app, app.run("viewKits(model())"), "List");
    assert.equal(toggle(app.run("viewKits(model())"))[1].pressed, "true");
    app.run(open);
    html = app.run("viewKits(model())");
    assert.equal(toggle(html)[0].pressed, "true", open);
    assert.ok(tiles(html).length > 0, open);
  }
  // A fresh load, the way the page starts, is on Flat-lay
  assert.equal(toggle(kitHtml(load({ fixture: "tests/household" }).run, "go"))[0].pressed, "true");
});

test("toggling and rendering write nothing and store nothing", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`globalThis.WRITES = []; setDoc = (...a) => { WRITES.push(a); return Promise.resolve(); };
    globalThis.STORED = []; globalThis.localStorage = globalThis.sessionStorage = { setItem: (...a) => STORED.push(a), getItem: () => null, removeItem: (...a) => STORED.push(a) };`);
  const before = app.json("{ kits: S.kits, items: S.items }");
  for (const kit of ["go", "home", "car"]) {
    const html = kitHtml(app.run, kit);
    press(app, html, "List");
    press(app, app.run("viewKits(model())"), "Flat-lay");
    press(app, app.run("viewKits(model())"), "+ Add by hand");
    app.run("render()");
  }
  assert.deepEqual(app.json("WRITES"), []);
  assert.deepEqual(app.json("STORED"), []);
  assert.deepEqual(app.json("{ kits: S.kits, items: S.items }"), before, "no new field on any kit or item doc");
});

test("+ Add by hand switches to List and focuses the add row's name, and read-only viewers get no + Add", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`globalThis.FOCUSED = []; (q => { document.querySelector = s => s === "#add-name" ? { focus() { FOCUSED.push(s); }, value: "" } : q(s); })(document.querySelector)`);
  let html = kitHtml(app.run, "go");
  const add = buttons(html).filter(b => b.label === "+ Add by hand");
  assert.equal(add.length, 1);
  assert.ok(html.lastIndexOf("fl-tile") < html.indexOf("+ Add by hand"), "it is the last tile");
  press(app, html, "+ Add by hand");
  html = app.run("viewKits(model())");
  assert.equal(toggle(html)[1].pressed, "true");
  assert.match(html, /id="add-name"/);
  assert.deepEqual(app.json("FOCUSED"), ["#add-name"]);

  const ro = load({ fixture: "tests/household" });
  ro.run("S.canWrite = false");
  for (const kit of ["go", "home", "car"]) {
    html = kitHtml(ro.run, kit);
    assert.ok(tiles(html).length > 0, kit);
    assert.equal(toggle(html).length, 2, `${kit}: read-only viewers still get the toggle`);
    assert.doesNotMatch(html, /Add by hand/, kit);
    press(ro, html, "List");
    assert.doesNotMatch(ro.run("viewKits(model())"), /id="add-name"/);
  }
});

test("the kit's panels come in order: readiness, photo prompt, Contents, checklist, weight and space", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.kits[0].photos = ["p1"]`);
  const html = kitHtml(app.run, "go");
  const at = re => { const i = html.search(re); assert.ok(i >= 0, String(re)); return i; };
  const marks = [/class="kit-pct"/, /People this kit is for/, /Photograph the contents/, /data-act="pickPhotos"/, /class="photos"/, /class="fl-zone"/, /class="ess-blk"/, /Expired items don't count/, /Weight and space/];
  const pos = marks.map(at);
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b), marks.map(String).join(" < "));
  // The readiness panel ends before Contents starts: the checklist is no longer inside it
  const ready = app.run(`(() => { const M = model(); return kitReadyPanel(S.kits[0], M.kitRes.go, M); })()`);
  assert.doesNotMatch(ready, /ess-blk|Expired items don't count/);
});

test("an empty kit says so under the photo prompt, which explains itself there, and a one-item kit shows one tile", () => {
  const fresh = load({ fixture: "fixtures/empty-and-one/new-household" });
  fresh.run(`S.kits.push({ id: "e", name: "New bag", type: "go", createdAt: 1 })`);
  for (const w of [true, false]) {
    fresh.run(`S.canWrite = ${w}`);
    const html = kitHtml(fresh.run, "e");
    assert.equal(tiles(html).length, 0);
    assert.match(html, /<p class="fl-empty[^"]*">[^<]{5,80}<\/p>/, "one short line says the kit is empty");
    if (w) assert.ok(html.indexOf("Lay items out so labels face up") > 0 && html.indexOf("Photograph the contents") < html.indexOf("fl-empty"), "the photo prompt, with how to do it, comes first");
    else assert.doesNotMatch(html, /Photograph the contents|pickPhotos/, "a viewer who can't write gets no photo prompt");
  }
  const one = load({ fixture: "fixtures/empty-and-one/one-person" });
  const html = kitHtml(one.run, "k");
  assert.deepEqual(tiles(html).map(t => [t.id, t.name, t.note]), [["i", "Water bottle", ""]]);
  // With something packed the prompt is one line: its heading and button, without the how-to
  assert.match(html, /Photograph the contents/);
  assert.doesNotMatch(html, /Lay items out so labels face up/);
  // ...and the how-to is back while photos wait to be read
  one.run(`S.tray = { kitId: "k", photos: [{ key: "a", file: {}, url: "blob:a" }] }`);
  assert.match(kitHtml(one.run, "k"), /Lay items out so labels face up[\s\S]*Read 1 photo/);
  one.run(`S.tray = null`);
  assert.doesNotMatch(html, /fl-empty/);
});

// A writer's tile opens the item's fields (tests/flatlay-edit.test.js); a read-only viewer's does nothing
test("a read-only viewer's present tile is not interactive", () => {
  const app = load({ fixture: "fixtures/phone-width/long-essentials" });
  app.run("S.canWrite = false");
  const ts = tiles(kitHtml(app.run, "go"));
  assert.equal(ts.length, 12);
  for (const t of ts) assert.doesNotMatch(t.body, /<button|<input|<select|data-act|data-change/, t.id);
});

test("at 390px every kit's Contents panel shows 4 tiles a row and nothing scrolls sideways", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const fixtures = ["tests/household", "fixtures/phone-width/long-essentials", "fixtures/empty-and-one/big-household"];
  const seen = atPhoneWidth(fixtures, () => S.kits.map(k => {
    S.view = "kits"; S.openKit = k.id; render();
    const grids = [...document.querySelectorAll("#v-kits section.fl-zone .fl-grid")].map(g => {
      const ts = [...g.querySelectorAll(".fl-tile")].map(t => t.getBoundingClientRect());
      const firstRow = ts.filter(r => Math.abs(r.top - ts[0].top) < 1).length;
      return { n: ts.length, firstRow, inside: ts.every(r => r.left >= 0 && r.right <= innerWidth), names: [...g.querySelectorAll(".fl-name")].every(n => n.scrollWidth <= n.clientWidth + 1) };
    });
    return { kit: k.name, width: innerWidth, scroll: document.documentElement.scrollWidth, grids };
  }));
  for (const f of fixtures) {
    const kits = seen.get(f);
    assert.ok(kits && kits.length, `${f}: no kits measured`);
    let full = 0;
    for (const k of kits) {
      const where = `${f}, ${k.kit}`;
      assert.equal(k.width, 390, `${where}: the viewport isn't 390px`);
      assert.ok(k.scroll <= k.width, `${where}: scrolls sideways (${k.scroll}px wide)`);
      for (const g of k.grids) {
        assert.equal(g.firstRow, Math.min(4, g.n), `${where}: a zone of ${g.n} shows ${g.firstRow} in its first row`);
        assert.ok(g.inside, `${where}: a tile is off screen`);
        assert.ok(g.names, `${where}: a name runs wider than its tile`);
        full += g.n >= 4;
      }
    }
    if (f.includes("long-essentials")) assert.ok(full > 0, `${f}: no zone filled a row of 4`);
  }
});

test("at 390px a tile shows its whole kcal note and its ×N badge never touches the icon, however big the numbers", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const seen = atPhoneWidth(["tests/household"], () => {
    [1000, 10000, 43200, 900000, 9999999, 99999999].forEach((n, i) => S.items.push(
      { id: "k" + i, kitId: "home", name: "Ration bars", category: "food", qty: 1, kcal: n },
      { id: "q" + i, kitId: "home", name: "Water jugs", category: "water", qty: n, liters: n },
      { id: "b" + i, kitId: "home", name: "Rice and beans in bulk", category: "food", qty: n, kcal: n * 100 }));
    S.view = "kits"; S.openKit = "home"; render();
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return [...document.querySelectorAll("#v-kits .fl-tile")].map(t => {
      const tr = t.getBoundingClientRect(), ic = t.querySelector(".fl-top > :first-child").getBoundingClientRect();
      const q = t.querySelector(".fl-q"), note = t.querySelector(".fl-note"), qr = q && q.getBoundingClientRect();
      return {
        id: t.dataset.id, qty: q && q.textContent, note: note && note.textContent,
        noteWhole: !note || (note.scrollWidth <= note.clientWidth + 1 && note.scrollHeight <= note.clientHeight + 1),
        apart: !qr || !hit(qr, ic), qInside: !qr || (qr.left >= tr.left && qr.right <= tr.right),
      };
    });
  }).get("tests/household");
  assert.ok(seen.length >= 18, "the big-number tiles rendered");
  for (const t of seen) {
    assert.ok(t.noteWhole, `${t.id}: "${t.note}" is cut off`);
    assert.ok(t.apart, `${t.id}: the badge "${t.qty}" overlaps the icon`);
    assert.ok(t.qInside, `${t.id}: the badge "${t.qty}" runs out of its tile`);
  }
});

test("a kit with a photo gets a card led by that photo, and one without keeps its type's icon", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.kits.find(k => k.id === "go").photos = ["p1", "p2"]`);
  const cards = [...app.run(`S.view = "kits"; viewKits(model())`).matchAll(/<button class="tag([^"]*)" data-act="openKit" data-id="([^"]*)"[^>]*>\s*<span class="tag-img">([\s\S]*?)<\/span>/g)].map(m => ({ cls: m[1].trim(), id: m[2], img: m[3] }));
  assert.equal(cards.length, app.json(`S.kits.length`));
  for (const c of cards) {
    if (c.id === "go") { assert.equal(c.cls, "ph"); assert.match(c.img, /^<img src="\/_blob\/p1" alt="" loading="lazy" data-pic="p1">$/, "its first photo"); }
    else { assert.equal(c.cls, ""); assert.match(c.img, /^<svg class="ic"/); }
  }
});

test("a kit card whose photo failed to load leads with the kit's next photo, and with its icon when none loads", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.kits.find(k => k.id === "go").photos = ["p1", "p2"]`);
  const card = () => app.run(`S.view = "kits"; viewKits(model())`).match(/<button class="tag([^"]*)" data-act="openKit" data-id="go"[^>]*>\s*<span class="tag-img">([\s\S]*?)<\/span>/).slice(1, 3);
  app.run(`S.badPics.add("p1")`);
  assert.deepEqual(card(), [" ph", `<img src="/_blob/p2" alt="" loading="lazy" data-pic="p2">`]);
  app.run(`S.badPics.add("p2")`);
  const [cls, img] = card();
  assert.equal(cls, ""); assert.match(img, /^<svg class="ic"/);
  // Nothing about the kit is changed: its photos are still its photos
  assert.deepEqual(app.json(`S.kits.find(k => k.id === "go").photos`), ["p1", "p2"]);
});
