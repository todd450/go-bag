// All kits (issue #117, part of #115): the Shopping tab shows the whole list grouped by the kit each line goes in, oldest
// kit first, with each kit's gaps that aren't on the list yet below its lines, and a No kit yet group last for the lines
// and gaps no kit takes. A Plan button plans a gap into its group's kit through #116's actions. The tools at the top
// (sum, Order, Spend up to, Share list) cover every open line.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");

const households = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = html => unesc(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
// A tag's attributes, read back from their escaped values, and its data-* ones as a button's dataset
const attrs = tag => Object.fromEntries([...tag.matchAll(/ ([a-z-]+)(?:="([^"]*)")?/g)].map(m => [m[1], unesc(m[2] ?? "")]));
const dataset = tag => Object.fromEntries(Object.entries(attrs(tag)).filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5), v]));
// A row's points and price, as its .shop-meta shows them
function meta(li) {
  const m = li.match(/<div class="shop-meta">([\s\S]*?)<\/div>/);
  return { points: +(m?.[1].match(/class="gain[^"]*"[^>]*>\+(\d+)</)?.[1] || 0), price: m?.[1].match(/<span class="small muted">([^<]*)<\/span>/)?.[1] ?? "" };
}
// A line's row on the list, by its id
function lineRow(html, id) {
  const rows = [...html.matchAll(/<li class="shop-row[^"]*">[\s\S]*?<\/li>/g)].map(m => m[0]).filter(r => attrs(r.match(/<input [^>]*>/)[0])["data-id"] === id);
  assert.equal(rows.length, 1, `line ${id} has one row`);
  return rows[0];
}
// The groups on All kits, top to bottom: each one's heading, its open lines (ids, in order, and which are dimmed),
// its gap rows (key, points, price and Plan button) and its "Plan the top N" button.
function groups(html) {
  return [...html.matchAll(/<section class="panel stack shop-g">([\s\S]*?)<\/section>/g)].map(([, g]) => ({
    name: text(g.match(/<h3>([\s\S]*?)<\/h3>/)[1]),
    lines: [...g.matchAll(/<li class="shop-row[^"]*">[\s\S]*?<\/li>/g)].map(([r]) => attrs(r.match(/<input [^>]*>/)[0])["data-id"]),
    over: [...g.matchAll(/<li class="shop-row[^"]*">[\s\S]*?<\/li>/g)].filter(([r]) => / over"/.test(r.match(/^<li [^>]*>/)[0])).map(([r]) => attrs(r.match(/<input [^>]*>/)[0])["data-id"]),
    cut: [...g.matchAll(/<li class="shop-(row|cut)[^"]*">/g)].map(m => m[1]),
    gaps: [...g.matchAll(/<li class="shop-gap">([\s\S]*?)<\/li>/g)].map(([, li]) => {
      const b = li.match(/<button [^>]*data-act="shopAdd"[^>]*>/)?.[0];
      return { ...meta(li), plan: b && dataset(b), key: b && `${dataset(b).cat}|${dataset(b).essential || ""}` };
    }),
    top: g.match(/<button [^>]*data-act="shopAddTop"[^>]*>([^<]*)<\/button>/),
    html: g,
  }));
}
const keyOf = e => e.cat + (e.essential ? ":" + e.essential : "");

// Every write the page makes, recorded as [col, id]
function recordWrites(app) {
  app.run(`globalThis.WRITES = []; setDoc = (s => (...a) => { WRITES.push([a[0], a[1]]); return s(...a); })(setDoc)`);
  return () => app.json("WRITES");
}
const tap = (app, act, ds) => app.run(`ACT.${act}({ dataset: ${JSON.stringify(ds)} })`);

// What each group should hold, worked out from shopKit and kitGaps: the Kits tab's kits, oldest first, then No kit yet
// when it has something. Lines are ids in any order; gaps are keys of the ones not on the list.
const EXPECTED = `(() => { const M = model(), off = splitListed(M.gaps).off, left = shopItems().filter(e => !e.done);
  const of = (id, name) => ({ name, lines: left.filter(e => shopKit(e) === id).map(e => e.id).sort(), gaps: kitGaps(M, id).filter(g => off.includes(g)).map(gapKey).sort() });
  const loose = of("", "No kit yet");
  return [...[...S.kits].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(k => of(k.id, k.name)), ...(loose.lines.length || loose.gaps.length ? [loose] : [])]; })()`;

// Lines of every sort: half the gaps planned, cycling through each kit, "Not in a kit yet", no kit and a kit that's gone,
// plus a typed line, an unknown category and a ticked line.
const SEED = `(() => { const M = model(), to = [...S.kits.map(k => k.id), "none", "", "gone"];
  S.shopping = { items: [
    ...M.gaps.filter((g, i) => i % 2 === 0).map((g, i) => ({ ...shopFromGap(g, M.h), kitId: to[i % to.length] })),
    { id: "typed", cat: "", text: "Spare reading glasses", done: false, at: 1 },
    { id: "odd", cat: "retired-category", text: "Old entry", qty: "two", done: false },
    ...(M.gaps[1] ? [{ ...shopFromGap(M.gaps[1], M.h), id: "ticked", done: true, inKit: S.kits[0]?.id }] : []),
  ] }; })()`;

for (const name of households) {
  test(`${name}: every open line is under the kit it goes in, and every gap not on the list shows once`, () => {
    const cases = { "no lines": "S.shopping = null", "every gap planned": "S.shopping = null; ACT.shopAddAll()", "lines given kits": SEED };
    for (const [label, setup] of Object.entries(cases)) {
      const app = load({ fixture: name });
      app.run(setup);
      const html = app.run("viewShop(model())"), at = `${name}, ${label}`;
      const got = groups(html).map(g => ({ name: g.name, lines: g.lines.slice().sort(), gaps: g.gaps.map(x => x.key).sort() }));
      const want = app.json(EXPECTED);
      // An empty kit name has a heading of its own; every other heading is the kit's name
      assert.ok(got.every(g => g.name.length), `${at}: every group has a heading`);
      assert.deepEqual(got.map(g => ({ ...g, name: null })), want.map(g => ({ ...g, name: null })), at);
      assert.deepEqual(got.map(g => g.name), want.map(g => g.name || got[want.indexOf(g)].name), `${at}: headed by the kit's name, in the Kits tab's order`);
      // Each open line and each gap exactly once across the groups
      const lines = got.flatMap(g => g.lines).sort(), left = app.json(`shopItems().filter(e => !e.done).map(e => e.id).sort()`);
      assert.deepEqual(lines, left, `${at}: every open line once`);
      assert.deepEqual(got.flatMap(g => g.gaps).sort(), app.json(`splitListed(model().gaps).off.map(gapKey).sort()`), `${at}: every gap off the list once`);
      // Ticked lines are under Got it, not in a kit's group
      for (const id of app.json(`shopItems().filter(e => e.done).map(e => e.id)`)) assert.ok(!lines.includes(id) && html.includes(`data-id="${id}"`), `${at}: ${id} is under Got it`);
      // The empty state's buttons are gone
      assert.doesNotMatch(html, /data-act="shopAddAll"/, `${at}: no Add all`);
    }
  });
}

test("with no lines: each kit's share of the gaps, and No kit yet only where a gap has no kit", () => {
  const counts = name => { const app = load({ fixture: name }); return groups(app.run("viewShop(model())")).map(g => [g.name, g.gaps.length, g.lines.length]); };
  assert.deepEqual(counts("tests/household"), [["Hall closet go-bag", 9, 0], ["Basement bin", 28, 0], ["Trunk bag", 3, 0]], "no No kit yet group");
  assert.deepEqual(counts("fixtures/empty-and-one/new-household"), [["No kit yet", 33, 0]]);
  const one = groups(load({ fixture: "fixtures/empty-and-one/one-person" }).run("viewShop(model())"));
  assert.equal(one.at(-1).name, "No kit yet");
  assert.deepEqual(one.at(-1).gaps.map(g => g.key).sort(), ["co_alarm|", "poison|"]);
  // The odd household's own line, in a category the page doesn't know, is under No kit yet
  const odd = load({ fixture: "fixtures/data-and-account-shapes/odd-values" });
  const og = groups(odd.run("viewShop(model())"));
  assert.deepEqual(og.at(-1).lines, ["s1"]);
  assert.equal(og.at(-1).name, "No kit yet");
  assert.ok(og.slice(0, -1).every(g => !g.lines.includes("s1")));
});

// Kits that didn't come from the Add a kit form: no id, an id another kit has, a name that isn't text, a date that isn't one
test("kits from odd data still put every open line and every gap in one group, each kit once", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.kits.push({ name: "No id bag", type: "go", createdAt: 0 }, { id: "car", name: "Second trunk", type: "car", createdAt: 9 },
    { id: "n7", name: 7, type: "home", createdAt: "soon" }, { id: "nn", name: null, type: "boat" })`);
  for (const setup of ["S.shopping = null", "ACT.shopAddAll()", SEED]) {
    app.run(setup);
    let html;
    assert.doesNotThrow(() => { html = app.run("viewShop(model())"); }, setup);
    const gs = groups(html);
    assert.deepEqual(gs.flatMap(g => g.lines).sort(), app.json(`shopItems().filter(e => !e.done).map(e => e.id).sort()`), `${setup}: every open line once`);
    assert.deepEqual(gs.flatMap(g => g.gaps.map(x => x.key)).sort(), app.json(`splitListed(model().gaps).off.map(gapKey).sort()`), `${setup}: every gap off the list once`);
    assert.ok(gs.every(g => g.name), `${setup}: every group has a heading`);
    assert.equal(gs.filter(g => ["Trunk bag", "Second trunk"].includes(g.name)).length, 1, `${setup}: two kits with one id are one group`);
    assert.ok(gs.some(g => g.name === "7"), `${setup}: a number for a name is the heading`);
  }
});

test("a kit with nothing to get still shows, and says so", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.kits.push({ id: "spare", name: "Spare bag", type: "boat", createdAt: 9 })`);
  const g = groups(app.run("viewShop(model())")).at(-1);
  assert.equal(g.name, "Spare bag");
  assert.deepEqual([g.lines, g.gaps], [[], []]);
  assert.ok(text(g.html.replace(/<h3>[\s\S]*?<\/h3>/, "")).length > 0, "it says there is nothing to get");
});

test("a Plan in a kit's group saves one line with that kit, and the gap moves up to the kit's lines", () => {
  const app = load({ fixture: "tests/household" }), writes = recordWrites(app);
  const home = groups(app.run("viewShop(model())"))[1];
  assert.equal(home.name, "Basement bin");
  const plan = home.gaps[0].plan;
  assert.equal(plan.act, "shopAdd");
  assert.equal(plan.kit, "home");
  tap(app, "shopAdd", plan);
  assert.deepEqual(writes(), [["household", "shopping"]], "one write");
  const lines = app.json("shopItems()");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kitId, "home");
  assert.equal(keyOf(lines[0]), plan.cat);
  const after = groups(app.run("viewShop(model())"))[1];
  assert.deepEqual(after.lines, [lines[0].id]);
  assert.equal(after.gaps.length, 27);
});

test("a Plan under No kit yet saves a line with no kit, and it stays under No kit yet", () => {
  const app = load({ fixture: "fixtures/empty-and-one/one-person" }), writes = recordWrites(app);
  const loose = groups(app.run("viewShop(model())")).at(-1);
  const plan = loose.gaps.find(g => g.key === "co_alarm|").plan;
  assert.equal("kit" in plan, false, "no data-kit");
  tap(app, "shopAdd", plan);
  assert.deepEqual(writes(), [["household", "shopping"]], "one write");
  const [line, ...more] = app.json("shopItems()");
  assert.equal(more.length, 0);
  assert.equal(line.kitId, "");
  assert.equal(line.cat, "co_alarm");
  const after = groups(app.run("viewShop(model())")).at(-1);
  assert.equal(after.name, "No kit yet");
  assert.deepEqual(after.lines, [line.id]);
  assert.deepEqual(after.gaps.map(g => g.key), ["poison|"]);
});

test("'Plan the top 3' in the Trunk bag's group saves its three gaps, each with the Trunk bag", () => {
  const app = load({ fixture: "tests/household" }), writes = recordWrites(app);
  const all = groups(app.run("viewShop(model())")), car = all[2];
  assert.equal(car.name, "Trunk bag");
  assert.match(car.top[1], /\b3\b/);
  const top = dataset(car.top[0]);
  assert.deepEqual(top, { act: "shopAddTop", kit: "car" });
  // The other kits offer their top five
  assert.deepEqual(all.slice(0, 2).map(g => [dataset(g.top[0]).kit, g.top[1].match(/\d+/)[0]]), [["go", "5"], ["home", "5"]]);
  tap(app, "shopAddTop", top);
  assert.deepEqual(writes(), [["household", "shopping"]], "one write");
  const lines = app.json("shopItems()");
  assert.deepEqual(lines.map(keyOf).sort(), ["car", "comfort", "first_aid"]);
  assert.deepEqual(lines.map(e => e.kitId), ["car", "car", "car"]);
  const after = groups(app.run("viewShop(model())"))[2];
  assert.deepEqual(after.lines.slice().sort(), lines.map(e => e.id).sort());
  assert.deepEqual([after.gaps, after.top], [[], null], "nothing left to plan");
});

test("'Plan the top N' plans the first N gap rows its kit shows, and only a kit's group has one", () => {
  for (const name of households) {
    const kits = groups(load({ fixture: name }).run("viewShop(model())"));
    for (const [i, g] of kits.entries()) {
      if (!g.top) { assert.ok(!g.gaps.length || g.name === "No kit yet", `${name}: ${g.name} has gaps and no Plan the top N`); continue; }
      const n = Math.min(5, g.gaps.length), app = load({ fixture: name }), had = app.json("shopItems().length");
      assert.match(g.top[1], new RegExp(`\\b${n}\\b`), `${name}: ${g.name}`);
      tap(app, "shopAddTop", dataset(g.top[0]));
      const lines = app.json("shopItems()").slice(had);
      assert.deepEqual(lines.map(e => gapKeyOf(e)), g.gaps.slice(0, n).map(x => x.key), `${name}: ${g.name} plans its top ${n} rows`);
      assert.ok(lines.every(e => e.kitId === dataset(g.top[0]).kit), `${name}: ${g.name}`);
      assert.deepEqual(groups(app.run("viewShop(model())"))[i].lines.slice().sort(), lines.map(e => e.id).sort(), `${name}: they show as ${g.name}'s lines`);
    }
  }
});
const gapKeyOf = e => `${e.cat}|${e.essential || ""}`;

test("a gap's points are gapGain, most first, and the same points and price its line shows once planned", () => {
  for (const name of ["tests/household", "fixtures/empty-and-one/one-person", "fixtures/empty-and-one/new-household", "fixtures/empty-and-one/big-household"]) {
    const app = load({ fixture: name });
    const before = groups(app.run("viewShop(model())"));
    // Each group's gaps: their keys and gapGain, most points first (ties in M.gaps order)
    const want = app.json(`(() => { const M = model(), off = splitListed(M.gaps).off;
      return [...[...S.kits].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).map(k => k.id), ""].map(id => kitGaps(M, id).filter(g => off.includes(g))
        .map(g => [gapKey(g), gapGain(M, g)]).sort((a, b) => b[1] - a[1])).filter((x, i, a) => x.length || i < a.length - 1); })()`);
    assert.deepEqual(before.map(g => g.gaps.map(x => [x.key, x.points])), want, name);
    assert.ok(before.flatMap(g => g.gaps).some(x => x.points > 0), `${name}: some gaps add points`);
    // Plan every gap from its own row, then find each line's row
    const rows = before.flatMap(g => g.gaps);
    for (const r of rows) tap(app, "shopAdd", r.plan);
    const lines = app.json("shopItems()"), html = app.run("viewShop(model())");
    assert.equal(lines.length, rows.length);
    rows.forEach((r, i) => {
      assert.equal(lines[i].kitId, r.plan.kit || "", `${name}: ${r.key} planned into its group's kit`);
      assert.deepEqual(meta(lineRow(html, lines[i].id)), { points: r.points, price: r.price }, `${name}: ${r.key}`);
    });
  }
});

test("with a budget, the rows it leaves out are dimmed in each kit, under 'Over your budget'", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`ACT.shopAddAll(); S.budget = 60`);
  const html = app.run("viewShop(model())"), gs = groups(html);
  // main's pick: the best points per dollar first, while the budget lasts
  const out = app.json(`(() => { const M = model(), left = shopItems().filter(e => !e.done), I = new Map(left.map(e => [e.id, shopInfo(e, M)]));
    const ratio = e => { const i = I.get(e.id); return i.price == null ? -1 : i.price === 0 ? (i.gain ? 1e6 + i.gain : 0) : i.gain / i.price; };
    const pick = new Set(); let spent = 0;
    for (const e of [...left].sort((a, b) => ratio(b) - ratio(a))) { const pr = I.get(e.id).price; if (pr != null && I.get(e.id).gain > 0 && spent + pr <= 60) { pick.add(e.id); spent += pr; } }
    return { out: left.filter(e => !pick.has(e.id)).map(e => e.id).sort(), n: pick.size, spent }; })()`);
  assert.ok(out.n > 0 && out.out.length > 0, "the budget buys some lines and leaves some out");
  assert.deepEqual(gs.flatMap(g => g.over).sort(), out.out, "the dimmed rows are the ones the pick leaves out");
  assert.match(html, /Over your budget/);
  assert.match(text(html), new RegExp(`\\$${out.spent} buys ${out.n} items?`));
  for (const g of gs) {
    // Picked rows first, then the dimmed ones under one "Over your budget"
    const seq = g.cut.join(" ");
    if (g.over.length) assert.match(seq, /^(row )*cut( row)+$/, `${g.name}: ${seq}`);
    else assert.doesNotMatch(seq, /cut/, g.name);
    assert.deepEqual(g.lines.slice(g.lines.length - g.over.length), g.over, `${g.name}: dimmed rows last`);
  }
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
  // All kits' button shares everything: no data-kit
  const btn = app.run("viewShop(model())").match(/<button [^>]*data-act="shopShare"[^>]*>/g);
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
  // A kit the household doesn't have shares everything
  for (const kit of ["nope", "none", ""]) { await app.run(`ACT.shopShare({ dataset: { kit: ${JSON.stringify(kit)} } })`); assert.equal(app.json("SHARED").at(-1).text, main, JSON.stringify(kit)); }
});

test("kit names, an empty name, typed lines and member names render escaped", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.kits.push({ id: "x1", name: '<img src=x onerror=alert(1)>', type: "go", createdAt: 4 }, { id: 'x"2', name: "", type: "car", createdAt: 5 });
    S.profile.members[1].label = '<img src=x onerror=alert(2)>'; S.profile.members[3].label = "<b>Riley</b>";`);
  for (const setup of ["S.shopping = null", `ACT.shopAddAll(); S.shopping.items.push(
      { id: "t1", cat: "", text: '<img src=x onerror=alert(3)>', done: false, at: 1 },
      { id: 't"2', cat: "", text: "<b>typed</b>", done: true, at: 2 },
      { ...S.shopping.items[0], id: "into-x1", kitId: "x1" }, { ...S.shopping.items[1], id: "into-x2", kitId: 'x"2' })`]) {
    app.run(setup);
    let html;
    assert.doesNotThrow(() => { html = app.run("viewShop(model())"); });
    assert.doesNotMatch(html, /<img|<b>Riley|<b>typed/, setup);
    const gs = groups(html);
    assert.ok(gs.some(g => g.name === "<img src=x onerror=alert(1)>"), "the markup kit's heading is its name, as text");
    assert.ok(gs.every(g => g.name.trim()), "the unnamed kit has a heading");
    assert.ok(text(html).includes("<img src=x onerror=alert(2)>"), "the member's name shows as text");
  }
  assert.deepEqual(groups(app.run("viewShop(model())")).find(g => g.lines.includes("into-x1"))?.name, "<img src=x onerror=alert(1)>");
  assert.ok(text(app.run("viewShop(model())")).includes("<img src=x onerror=alert(3)>"), "the typed line shows as text");
});

test("read-only viewers get no Plan, Plan the top N, ×, Clear these or add form, and keep the tools", async () => {
  const app = load({ fixture: "tests/household" });
  app.run(`ACT.shopAddAll()`);
  const id = app.run(`shopItems().find(e => shopKit(e)).id`);
  await app.run(`shopTick("${id}", true)`);
  app.run(`S.canWrite = false`);
  for (const setup of ["", `S.shopping.items = S.shopping.items.filter((e, i) => e.done || i % 3)`, "S.shopping = null"]) {
    app.run(setup);
    const html = app.run("viewShop(model())");
    for (const act of ["shopAdd", "shopAddTop", "shopDel", "shopClear", "shopAddAll"]) assert.doesNotMatch(html, new RegExp(`data-act="${act}"`), `${setup}: ${act}`);
    assert.doesNotMatch(html, /shop-new|data-submit/, `${setup}: no add form`);
    for (const t of html.match(/<(input|select) [^>]*data-change="shop(Tick|Kit)"[^>]*>/g) || []) assert.ok("disabled" in attrs(t), t);
    assert.ok(groups(html).flatMap(g => g.gaps).every(g => !g.plan), "gap rows show without a button");
    if (setup !== "S.shopping = null") {
      assert.match(html, /data-act="shopShare"/);
      assert.match(html, /id="shop-sort"/);
      assert.match(html, /id="shop-budget"/);
      assert.ok(groups(html).some(g => g.gaps.length), "gaps still show");
    }
  }
});

test("the Shopping tab keeps its heading in a wrapper around All kits", () => {
  const app = load({ fixture: "tests/household" });
  const tab = app.run("viewShopTab(model())"), all = app.run("viewShop(model())");
  assert.match(tab, /^\s*<h2[^>]*>[^<]+<\/h2>/);
  assert.equal(tab.replace(/^\s*<h2[^>]*>[^<]+<\/h2>/, "").trim(), all.trim());
  assert.doesNotMatch(all, /<h2/);
  assert.equal(app.run("typeof ACT.shopAddAll"), "function", "Add all stays as an action");
});

// Every household the phone check covers: the standard one, and each phone-width and empty-and-one fixture
const PHONE = ["tests/household", ...households.filter(h => /^fixtures\/(phone-width|empty-and-one)\//.test(h))];
test("at 390px the Shopping tab never scrolls sideways, with no lines and with every gap planned", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  // Two households a run: Chrome prints each page whole, and more would overflow what execFileSync reads back
  const seen = new Map();
  for (let i = 0; i < PHONE.length; i += 2) for (const [f, r] of measure(PHONE.slice(i, i + 2))) seen.set(f, r);
  assert.equal(seen.size, PHONE.length);
  for (const [f, r] of seen) for (const [k, v] of Object.entries(r)) {
    assert.equal(v.width, 390, `${f} ${k}`);
    assert.ok(v.groups > 0, `${f} ${k}: the groups rendered`);
    assert.ok(v.scroll <= v.width, `${f} ${k}: scrolls sideways (${v.scroll}px)`);
    assert.deepEqual(v.out, [], `${f} ${k}: these stick out of the screen`);
  }
});
function measure(fixtures) {
  return atPhoneWidth(fixtures, () => {
    const look = () => {
      render();
      const w = innerWidth, view = document.querySelector("#v-shop");
      return { width: w, scroll: document.documentElement.scrollWidth, groups: view.querySelectorAll(".shop-g").length,
        out: [...view.querySelectorAll("*")].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.left < -0.5 || r.right > w + 0.5); }).map(e => e.tagName + "." + e.getAttribute("class")) };
    };
    S.view = "shop"; S.shopping = null;
    const none = look(), M = model();
    S.shopping = { items: M.gaps.map(g => shopFromGap(g, M.h)) };
    return { none, all: look() };
  });
}
