// Review (issue #121, part of #115): one sheet for the whole plan, opened from a kit's To get, from the Kits tab with no
// kits, from an old #shop link and from the toast's See list. It replaces #117's All kits. viewShop draws its contents:
// the tools for every open line (sum, Order, Spend up to, Share list), one list of every open line in the chosen order,
// a footnote, Free tonight (the gaps not on the list that cost nothing, added in one write), the gaps no kit takes, then
// Got it. The sheet is a modal dialog: Close and Escape shut it, and focus goes back to the button that opened it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");
// Review's tests under real input, which spend most of their time waiting as a person's clicks do, are in
// tests/review-input.test.js, so they run beside these (issue #147).

const households = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = html => unesc(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
// A tag's attributes, read back from their escaped values, and its data-* ones as a button's dataset
const attrs = tag => Object.fromEntries([...tag.matchAll(/ ([a-z-]+)(?:="([^"]*)")?/g)].map(m => [m[1], unesc(m[2] ?? "")]));
const dataset = tag => Object.fromEntries(Object.entries(attrs(tag)).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5), v]));
const rowsOf = html => [...html.matchAll(/<li class="shop-row[^"]*">[\s\S]*?<\/li>/g)].map(([r]) => r);
const idOf = row => attrs(row.match(/<input [^>]*>/)[0])["data-id"];
const gapsOf = html => [...html.matchAll(/<li class="shop-gap">([\s\S]*?)<\/li>/g)].map(([, li]) => {
  const b = li.match(/<button [^>]*data-act="shopAdd"[^>]*>/)?.[0];
  return { plan: b && dataset(b), key: b && `${dataset(b).cat}|${dataset(b).essential || ""}` };
});
// Review's parts, top to bottom: the open lines in their trip groups (#123: ids in order, and which are dimmed), the
// footnote under them, Free tonight, No kit yet's gap rows, and Got it
function review(html) {
  const list = html.match(/(<h3 class="trip-hd">[\s\S]*?)<p class="small muted">Points overlap/)?.[1] ?? null;
  const loose = html.match(/<section class="panel stack"><h3>No kit yet<\/h3>([\s\S]*?)<\/section>/)?.[1] ?? "";
  const free = html.match(/<div class="panel row review-free">[\s\S]*?(?=<section|<form|<div class="panel stack">|$)/)?.[0] ?? "";
  const got = html.match(/<b>Got it \(\d+\)<\/b>[\s\S]*$/)?.[0] ?? "";
  return {
    lines: list == null ? null : rowsOf(list).map(idOf),
    over: list == null ? [] : rowsOf(list).filter(r => / over"/.test(r.match(/^<li [^>]*>/)[0])).map(idOf),
    rows: list == null ? [] : rowsOf(list),
    loose: gapsOf(loose),
    free: free && { text: text(free), gain: text(free).match(/\+(\d+) → (\d+)/)?.slice(1).map(Number) || null, add: free.match(/<button [^>]*data-act="shopAddFree"[^>]*>([^<]*)</)?.[1] || null },
    got: rowsOf(got).map(idOf),
  };
}
const keyOf = e => `${e.cat}|${e.essential || ""}`;

// Every write the page makes, recorded as [col, id]
function recordWrites(app) {
  app.run(`globalThis.WRITES = []; setDoc = (s => (...a) => { WRITES.push([a[0], a[1]]); return s(...a); })(setDoc)`);
  return () => app.json("WRITES");
}
const tap = (app, act, ds = {}) => app.run(`ACT.${act}({ dataset: ${JSON.stringify(ds)} })`);
const view = app => app.run("viewShop(model())");
// The Kits tab, with the sheet when it's open, and the sheet alone
const kitsTab = app => app.run(`S.view = "kits"; viewKits(model())`);
const sheetOf = html => html.match(/<div class="review-sheet stack" role="dialog"[\s\S]*$/)?.[0] || "";

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
// What Review should show, worked out from the core: the open lines in shopPlan's order, grouped by trip (#123), the gaps not on the list that no
// kit takes, and the free ones (price 0) with the readiness planning them reaches
const EXPECTED = `(() => { const M = model(), off = splitListed(M.gaps).off, left = shopItems().filter(e => !e.done);
  const free = off.filter(g => shopInfo(shopFromGap(g, M.h), M).price === 0), base = scoreIfBought(left);
  const to = free.length ? scoreIfBought([...left, ...free.map(g => shopFromGap(g, M.h))]) : null;
  const order = shopPlan(M, left).order;
  return { order: Object.keys(TRIPS).flatMap(t => order.filter(e => tripOf(e, M) === t)).map(e => e.id), left: left.map(e => e.id), done: shopItems().filter(e => e.done).map(e => e.id),
    loose: off.filter(g => !shopKit(shopFromGap(g, M.h))).map(gapKey).sort(), free: free.map(gapKey), base, to }; })()`;

for (const name of households) {
  test(`${name}: Review lists every open line once, in the chosen order, then Free tonight and the gaps no kit takes`, () => {
    for (const [label, setup] of Object.entries(CASES)) for (const sort of ["points", "value", "added"]) {
      const app = load({ fixture: name });
      app.run(`${setup}; S.shopSort = ${JSON.stringify(sort)}`);
      const html = view(app), r = review(html), want = app.json(EXPECTED), at = `${name}, ${label}, ${sort}`;
      if (!want.left.length) assert.equal(r.lines, null, `${at}: no list and no footnote with nothing to buy`);
      else {
        assert.deepEqual(r.lines, want.order, `${at}: every open line once, by trip, in shopPlan's order`);
        assert.deepEqual(r.over, [], `${at}: nothing dimmed without a budget`);
        // Each row names the kit it goes in, through its Goes in select, where there's a kit to choose
        for (const row of r.rows) {
          const e = app.json(`shopItems().find(e => e.id === ${JSON.stringify(idOf(row))})`);
          if (app.run(`!!CATS[${JSON.stringify(e.cat)}] && S.kits.length > 0`)) assert.match(row, /data-change="shopKit"/, `${at}: ${e.id} has Goes in`);
        }
      }
      assert.deepEqual(r.got, want.done, `${at}: ticked lines are under Got it`);
      assert.deepEqual(r.loose.map(g => g.key).sort(), want.loose, `${at}: No kit yet holds the gaps no kit takes`);
      assert.ok(r.loose.every(g => g.plan && !("kit" in g.plan)), `${at}: each planned with no kit`);
      // Free tonight: shown when a gap not on the list costs nothing
      if (!want.free.length) assert.equal(r.free, "", `${at}: no Free tonight`);
      else {
        assert.equal(r.free.add, `Add all ${want.free.length}`, at);
        assert.deepEqual(r.free.gain, want.to > want.base ? [want.to - want.base, want.to] : null, `${at}: +N → R`);
      }
      // Plan the top N is a kit's; the empty list's Add all is gone
      assert.doesNotMatch(html, /data-act="shopAdd(Top|All)"/, at);
    }
  });
}

test("with no lines: No kit yet holds the new household's 33 gaps, and the one-person household's two", () => {
  const loose = name => review(view(load({ fixture: name }))).loose.map(g => g.key);
  assert.deepEqual(loose("tests/household"), [], "every gap has a kit");
  assert.equal(loose("fixtures/empty-and-one/new-household").length, 33);
  assert.deepEqual(loose("fixtures/empty-and-one/one-person").sort(), ["co_alarm|", "poison|"]);
  // The odd household's own line, in a category the page doesn't know, is on the list
  assert.deepEqual(review(view(load({ fixture: "fixtures/data-and-account-shapes/odd-values" }))).lines, ["s1"]);
});

test("Free tonight: with the CPR shield, aspirin and CO alarm planned, it reads +3 → 46 and Add all 4, against a sum of 43", () => {
  const app = load({ fixture: "tests/household" });
  assert.equal(app.run("model().overall"), 17);
  let r = review(view(app));
  assert.deepEqual(r.free.gain, [3, 20], "with nothing planned: +3 → 20");
  assert.match(r.free.text, /\+3 → 20/);
  assert.equal(r.free.add, "Add all 4");
  for (const cat of ["cpr", "aspirin", "co_alarm"]) tap(app, "shopAdd", { cat });
  const html = view(app);
  assert.match(text(html), /Buying it all takes readiness from 17 to 43\b/);
  r = review(html);
  assert.match(r.free.text, /^Free tonight, from home\b/);
  assert.match(r.free.text, /\+3 → 46/);
  assert.equal(r.free.add, "Add all 4");
  assert.match(html, /Points overlap, so the rows don't add up to the total\./);
});

test("Free tonight's Add all saves its gaps in one write, each with no kit, and the card goes", () => {
  const app = load({ fixture: "tests/household" }), writes = recordWrites(app);
  for (const cat of ["cpr", "aspirin", "co_alarm"]) tap(app, "shopAdd", { cat });
  const had = app.json("shopItems().map(e => e.id)"), n = writes().length;
  tap(app, "shopAddFree");
  assert.deepEqual(writes().slice(n), [["household", "shopping"]], "one write");
  const lines = app.json("shopItems()"), added = lines.filter(e => !had.includes(e.id));
  assert.deepEqual(lines.slice(0, had.length).map(e => e.id), had, "the lines already planned stay");
  assert.deepEqual(added.map(keyOf).sort(), ["clothing|", "communication|contact_list", "documents|id_copies", "documents|insurance"]);
  assert.deepEqual(added.map(e => e.kitId), ["", "", "", ""]);
  assert.ok(added.every(e => e.done === false), "planned, not bought");
  assert.equal(review(view(app)).free, "", "the card goes");
  // Again, with nothing free left: no write
  tap(app, "shopAddFree");
  assert.equal(writes().length, n + 1);
});

test("Add all on every household plans exactly its free gaps, once, and leaves nothing free", () => {
  for (const name of households) for (const [label, setup] of Object.entries(CASES)) {
    const app = load({ fixture: name }), writes = recordWrites(app), at = `${name}, ${label}`;
    app.run(setup);
    const want = app.json(EXPECTED), had = app.json("shopItems().length"), n = writes().length;
    tap(app, "shopAddFree");
    assert.equal(writes().length - n, want.free.length ? 1 : 0, `${at}: one write, or none with nothing free`);
    const added = app.json("shopItems()").slice(had);
    assert.deepEqual(added.map(keyOf), want.free, at);
    assert.ok(added.every(e => e.kitId === ""), `${at}: no kit`);
    assert.equal(review(view(app)).free, "", `${at}: nothing free left`);
  }
});

test("a Plan under No kit yet saves a line with no kit, and it joins the list", () => {
  const app = load({ fixture: "fixtures/empty-and-one/one-person" }), writes = recordWrites(app);
  const plan = review(view(app)).loose.find(g => g.key === "co_alarm|").plan;
  assert.equal("kit" in plan, false, "no data-kit");
  tap(app, "shopAdd", plan);
  assert.deepEqual(writes(), [["household", "shopping"]], "one write");
  const [line, ...more] = app.json("shopItems()");
  assert.equal(more.length, 0);
  assert.deepEqual([line.kitId, line.cat], ["", "co_alarm"]);
  const after = review(view(app));
  assert.deepEqual(after.lines, [line.id]);
  assert.deepEqual(after.loose.map(g => g.key), ["poison|"]);
});

test("with a budget, the rows it leaves out are dimmed, last in their trip, and the tools say 'Over your budget' once", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`ACT.shopAddAll(); S.budget = 60`);
  const html = view(app), r = review(html);
  // main's pick: the best points per dollar first, while the budget lasts
  const out = app.json(`(() => { const M = model(), left = shopItems().filter(e => !e.done), I = new Map(left.map(e => [e.id, shopInfo(e, M)]));
    const ratio = e => { const i = I.get(e.id); return i.price == null ? -1 : i.price === 0 ? (i.gain ? 1e6 + i.gain : 0) : i.gain / i.price; };
    const pick = new Set(); let spent = 0;
    for (const e of [...left].sort((a, b) => ratio(b) - ratio(a))) { const pr = I.get(e.id).price; if (pr != null && I.get(e.id).gain > 0 && spent + pr <= 60) { pick.add(e.id); spent += pr; } }
    return { out: left.filter(e => !pick.has(e.id)).map(e => e.id).sort(), n: pick.size, spent }; })()`);
  assert.ok(out.n > 0 && out.out.length > 0, "the budget buys some lines and leaves some out");
  assert.deepEqual(r.over.slice().sort(), out.out, "the dimmed rows are the ones the pick leaves out");
  assert.equal((html.match(/Over your budget/g) || []).length, 1, "one 'Over your budget'");
  for (const [, g] of html.matchAll(/<h3 class="trip-hd">[\s\S]*?<ul class="shop">((?:(?!<\/ul>)[\s\S])*)<\/ul>/g)) {
    const dim = rowsOf(g).map(row => / over"/.test(row.match(/^<li [^>]*>/)[0]));
    assert.deepEqual(dim, dim.slice().sort(), "dimmed rows last in each trip");
  }
  assert.match(text(html), new RegExp(`\\$${out.spent} buys ${out.n} items?`));
  assert.match(html, /id="shop-sort"/);
  assert.match(html, /id="shop-budget"/);
});

test("Share list shares every open line as it did, and a kit's Share list only that kit's", async () => {
  const app = load({ fixture: "tests/household" });
  app.run(`ACT.shopAddAll(); globalThis.SHARED = []; navigator.share = d => { SHARED.push(d); return Promise.resolve(); }`);
  await app.run(`ACT.shopShare({ dataset: {} })`);
  await app.run(`shareShop()`);
  // main's text: a title line, then each open line in the order added
  const main = app.run(`"Emergency kit shopping list\\n" + shopItems().filter(x => !x.done).map(x => { const i = shopInfo(x, model()); return "- " + i.line + (i.sub && i.sub !== i.line ? " (" + i.sub + ")" : ""); }).join("\\n")`);
  const shared = app.json("SHARED");
  assert.equal(shared.length, 2);
  for (const s of shared) assert.equal(s.text, main);
  // Review's button shares everything: no data-kit
  const btn = view(app).match(/<button [^>]*data-act="shopShare"[^>]*>/g);
  assert.equal(btn.length, 1);
  assert.deepEqual(dataset(btn[0]), { act: "shopShare" });
  // A kit's tools carry its id, and share only its lines
  const car = app.run(`shopTools(model(), shopPlan(model(), shopItems().filter(e => !e.done && shopKit(e) === "car")), S.kits.find(k => k.id === "car"))`);
  assert.deepEqual(dataset(car.match(/<button [^>]*data-act="shopShare"[^>]*>/)[0]), { act: "shopShare", kit: "car" });
  await app.run(`ACT.shopShare({ dataset: { kit: "car" } })`);
  const lines = app.json(`shopItems().filter(e => !e.done && shopKit(e) === "car").map(x => { const i = shopInfo(x, model()); return "- " + i.line + (i.sub && i.sub !== i.line ? " (" + i.sub + ")" : ""); })`);
  assert.equal(lines.length, 3);
  const [title, ...rest] = app.json("SHARED").at(-1).text.split("\n");
  assert.equal(title, "Emergency kit shopping list");
  assert.deepEqual(rest, lines);
  for (const kit of ["nope", "none", ""]) { await app.run(`ACT.shopShare({ dataset: { kit: ${JSON.stringify(kit)} } })`); assert.equal(app.json("SHARED").at(-1).text, main, JSON.stringify(kit)); }
});

test("a kit's To get keeps its sum and Share list, and has no Order or Spend up to", () => {
  const app = load({ fixture: "tests/household" });
  app.run("ACT.shopAddAll()");
  for (const id of app.json("S.kits.map(k => k.id)")) {
    app.run(`ACT.openKit({ dataset: { id: ${JSON.stringify(id)} } }); ACT.kitSide({ dataset: { v: "get" } })`);
    const html = kitsTab(app);
    assert.match(text(html), /About \$\d+/, `${id}: the sum`);
    assert.match(html, new RegExp(`data-act="shopShare" data-kit="${id}"`), `${id}: Share list`);
    assert.doesNotMatch(html, /id="shop-sort"|id="shop-budget"|Spend up to/, `${id}: no Order or Spend up to`);
  }
});

test("kit names and typed lines render escaped in the sheet", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.kits.push({ id: "x1", name: '<img src=x onerror=alert(1)>', type: "go", createdAt: 4 }, { id: 'x"2', name: "", type: "car", createdAt: 5 });
    S.profile.members[1].label = '<img src=x onerror=alert(2)>';`);
  for (const setup of ["S.shopping = null", `ACT.shopAddAll(); S.shopping.items.push(
      { id: "t1", cat: "", text: '<img src=x onerror=alert(3)>', done: false, at: 1 },
      { id: 't"2', cat: "", text: "<b>typed</b>", done: true, at: 2 },
      { ...S.shopping.items[0], id: "into-x1", kitId: "x1" }, { ...S.shopping.items[1], id: "into-x2", kitId: 'x"2' })`]) {
    app.run(setup);
    app.run(`S.openKit = "x1"; ACT.allKits()`);
    let html;
    assert.doesNotThrow(() => { html = sheetOf(kitsTab(app)); });
    assert.ok(html.includes(view(app)), "the sheet holds viewShop");
    assert.doesNotMatch(html, /<img|<b>typed/, setup);
    if (setup !== "S.shopping = null") {
      assert.ok(text(html).includes("Goes in <img src=x onerror=alert(1)>"), "the markup kit's name shows as text");
      assert.ok(text(html).includes("<img src=x onerror=alert(3)>"), "the typed line shows as text");
      assert.ok(text(html).includes("<b>typed</b>"), "and the ticked one");
    }
    tap(app, "allBack");
  }
});

test("read-only viewers get no Add all, Plan, ×, Clear these or add form, and keep Order, Spend up to and Share list", async () => {
  const app = load({ fixture: "tests/household" });
  app.run(`ACT.shopAddAll()`);
  await app.run(`shopTick(shopItems().find(e => shopKit(e)).id, true)`);
  app.run(`S.canWrite = false`);
  for (const setup of ["", `S.shopping.items = S.shopping.items.filter((e, i) => e.done || i % 3)`, "S.shopping = null"]) {
    app.run(setup);
    app.run("ACT.allKits()");
    const html = sheetOf(kitsTab(app));
    for (const act of ["shopAdd", "shopAddTop", "shopDel", "shopClear", "shopAddAll", "shopAddFree"]) assert.doesNotMatch(html, new RegExp(`data-act="${act}"`), `${setup}: ${act}`);
    assert.doesNotMatch(html, /shop-new|data-submit/, `${setup}: no add form`);
    for (const t of html.match(/<(input|select) [^>]*data-change="shop(Tick|Kit)"[^>]*>/g) || []) assert.ok("disabled" in attrs(t), t);
    if (setup === "S.shopping = null") assert.match(html, /Free tonight/, `${setup}: Free tonight still shows what's free`);
    if (setup !== "S.shopping = null") for (const re of [/data-act="shopShare"/, /id="shop-sort"/, /id="shop-budget"/]) assert.match(html, re, setup);
    tap(app, "allBack");
  }
});

test("the sheet is a modal dialog labelled Review, with Close, over the Kits tab it leaves inert", () => {
  for (const fixture of ["tests/household", "fixtures/empty-and-one/new-household"]) {
    const app = load({ fixture });
    app.run(`S.view = "kits"; ACT.allKits()`);
    const html = kitsTab(app), s = sheetOf(html), d = attrs(s.match(/^<div [^>]*>/)[0]);
    assert.deepEqual([d.role, d["aria-modal"]], ["dialog", "true"], fixture);
    const h = s.match(new RegExp(`<(h\\d) id="${d["aria-labelledby"]}">([\\s\\S]*?)</\\1>`));
    assert.equal(text(h?.[2] || ""), "Shopping list", `${fixture}: labelled by its heading`);
    assert.match(s, /<button [^>]*id="review-x"[^>]*data-act="allBack"[^>]*>Close<\/button>/);
    assert.match(html, /<div class="kits-grid" inert>/, `${fixture}: the page behind can't be reached`);
    tap(app, "allBack");
    assert.equal(sheetOf(kitsTab(app)), "", `${fixture}: Close closes it`);
    assert.doesNotMatch(kitsTab(app), /inert/);
  }
});

test("ways in: the To get chip, an old #shop link, the toast's See list, and the Kits tab with no kits", () => {
  // The To get chip reads Review and opens the sheet
  let app = load({ fixture: "tests/household" });
  app.run(`S.view = "kits"; ACT.openKit({ dataset: { id: "car" } }); ACT.kitSide({ dataset: { v: "get" } })`);
  const chip = kitsTab(app).match(/<button [^>]*data-act="allKits"[^>]*>([^<]*)<\/button>/);
  assert.equal(chip[1], "Shopping list");
  tap(app, "allKits");
  assert.ok(sheetOf(kitsTab(app)).includes(view(app)), "the chip opens Review");
  // #shop
  app = load({ fixture: "tests/household", hash: "#shop" });
  assert.equal(app.run("S.view"), "kits");
  assert.ok(sheetOf(kitsTab(app)).includes(view(app)), "#shop opens Review");
  // See list
  app = load({ fixture: "tests/household" });
  app.run(`ACT.shopAddHz({ dataset: { id: model().results.find(r => hzGaps(model(), r).length).hz.id } }); toastAction.run()`);
  assert.equal(app.run("S.view"), "kits");
  assert.ok(sheetOf(kitsTab(app)).includes(view(app)), "See list opens Review");
  // No kits: "Pick a kit…" and a Review button, which opens the sheet with 33 gaps under No kit yet
  app = load({ fixture: "fixtures/empty-and-one/new-household" });
  const tab = kitsTab(app);
  assert.match(text(tab), /Pick a kit to see its contents, or add one\. Shopping list/);
  assert.equal(sheetOf(tab), "");
  assert.equal(tab.match(/<button [^>]*data-act="allKits"[^>]*>([^<]*)<\/button>/)[1], "Shopping list");
  tap(app, "allKits");
  assert.equal(review(sheetOf(kitsTab(app))).loose.length, 33);
});

// In Chrome at 390px: focus moves into the sheet on open and back to the button that opened it on close, by Close and by
// Escape; the page behind doesn't scroll while it's open, and the sheet covers the screen
test("at 390px the sheet takes focus, gives it back on Close and Escape, and stops the page behind scrolling", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const seen = atPhoneWidth(["tests/household", "fixtures/empty-and-one/new-household"], () => {
    S.view = "kits"; render();
    if (S.kits.length) [...document.querySelectorAll("#v-kits button")].find(b => b.textContent.startsWith("To get")).click();
    const opener = () => document.querySelector('#v-kits [data-act="allKits"]');
    const open = () => { const b = opener(); b.focus(); b.click(); const d = document.querySelector('[role="dialog"]'), r = d?.getBoundingClientRect();
      return { open: !!d, focusIn: !!d && d.contains(document.activeElement), overflow: getComputedStyle(document.documentElement).overflow,
        covers: !!r && r.left <= 0 && r.right >= innerWidth && r.top <= 0 && r.bottom >= innerHeight,
        // Its parts keep their own height from the top, not stretched to fill the screen: the heading's row and the add form
        packed: !!d && [...d.querySelectorAll(":scope > .review-hd, :scope > .shop-add")].every(e => e.getBoundingClientRect().height <= 64) }; };
    const closed = () => ({ open: !!document.querySelector('[role="dialog"]'), back: document.activeElement === opener(), overflow: getComputedStyle(document.documentElement).overflow });
    const a = open();
    document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    const esc = closed(), b = open();
    document.querySelector("#review-x").click();
    const close = closed();
    // Household's saved review from Claude is not the sheet: the page still scrolls under it
    S.review = { text: "## What to buy next\n- Water", at: 1 }; S.view = "household"; render();
    return { a, esc, b, close, plan: { article: !!document.querySelector("#v-household article"), overflow: getComputedStyle(document.documentElement).overflow } };
  });
  assert.equal(seen.size, 2);
  for (const [f, r] of seen) {
    for (const o of [r.a, r.b]) assert.deepEqual(o, { open: true, focusIn: true, overflow: "hidden", covers: true, packed: true }, `${f}: open`);
    assert.equal(r.plan.article, true, `${f}: Household shows the saved review`);
    assert.notEqual(r.plan.overflow, "hidden", `${f}: and Household still scrolls`);
    for (const c of [r.esc, r.close]) {
      assert.equal(c.open, false, `${f}: closed`);
      assert.equal(c.back, true, `${f}: focus is back on the button that opened it`);
      assert.notEqual(c.overflow, "hidden", `${f}: the page scrolls again`);
    }
  }
});

// Every household the phone check covers: the standard one, and each phone-width and empty-and-one fixture
const PHONE = ["tests/household", ...households.filter(h => /^fixtures\/(phone-width|empty-and-one)\//.test(h))];
test("at 390px the sheet never scrolls sideways, with no lines and with every gap planned", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  // Two households a run: Chrome prints each page whole, and more would overflow what execFileSync reads back
  const seen = new Map();
  for (let i = 0; i < PHONE.length; i += 2) for (const [f, r] of measure(PHONE.slice(i, i + 2))) seen.set(f, r);
  assert.equal(seen.size, PHONE.length);
  for (const [f, r] of seen) for (const [k, v] of Object.entries(r)) {
    assert.equal(v.width, 390, `${f} ${k}`);
    assert.ok(v.shown, `${f} ${k}: the sheet rendered`);
    assert.ok(v.scroll <= v.width && v.wide.every(n => n <= 0), `${f} ${k}: scrolls sideways (page ${v.scroll}px, backdrop and sheet ${v.wide}px too wide)`);
    assert.deepEqual(v.out, [], `${f} ${k}: these stick out of the screen`);
  }
});
function measure(fixtures) {
  return atPhoneWidth(fixtures, () => {
    const look = () => {
      S.view = "kits"; S.allKits = true; render();
      const w = innerWidth, bg = document.querySelector(".review-bg"), sheet = document.querySelector(".review-sheet");
      return { width: w, shown: !!sheet, scroll: document.documentElement.scrollWidth, wide: [bg, sheet].map(e => e ? e.scrollWidth - e.clientWidth : 0),
        out: [...(sheet?.querySelectorAll("*") || [])].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.left < -0.5 || r.right > w + 0.5); }).map(e => e.tagName + "." + e.getAttribute("class")) };
    };
    S.shopping = null;
    const none = look(), M = model();
    S.shopping = { items: M.gaps.map(g => shopFromGap(g, M.h)) };
    return { none, all: look() };
  });
}
