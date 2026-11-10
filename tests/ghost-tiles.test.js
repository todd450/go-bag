// Ghost tiles (issue #120, part of #115, decision (b)): a kit's dashed tiles show what each missing essential adds to
// this kit (gapGain with the kit) and what its line costs. A tile not on the list plans the gap into this kit; a tile
// planned for this kit opens Packed it and Take off plan; a tile planned elsewhere says where. The checklist's chips
// show the same points, and its "Add N to list" button is gone.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, PAGE, ROOT } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");

const households = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = html => unesc(html.replace(/<wbr>/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/­/g, "")).trim();
const data = attrs => Object.fromEntries([...attrs.matchAll(/data-([a-z]+)="([^"]*)"/g)].map(m => [m[1], unesc(m[2])]));

// A kit's dashed tiles: name, points, every button on the tile (its data, label and text) and all its text.
function tiles(app, kit) {
  const html = app.run(`S.view = "kits"; S.openKit = ${JSON.stringify(kit)}; viewKits(model())`);
  return [...html.matchAll(/<li class="fl-tile miss([^"]*)"[^>]*>([\s\S]*?)<\/li>/g)].map(([, cls, body]) => ({
    cls: cls.trim().split(/\s+/).filter(Boolean), body,
    name: text((body.match(/<span class="fl-name"[^>]*>([\s\S]*?)<\/span>/) || ["", ""])[1]),
    gain: +((body.match(/<span class="gain[^"]*"[^>]*>\+(\d+)<\/span>/) || [0, 0])[1]),
    buttons: [...body.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, a, inner]) => ({
      data: data(a), id: (a.match(/ id="([^"]*)"/) || [])[1], label: unesc((a.match(/aria-label="([^"]*)"/) || ["", ""])[1]), text: text(inner) })),
    all: text(body),
  }));
}
const tile = (app, kit, name) => {
  const t = tiles(app, kit).find(t => t.name === name);
  assert.ok(t, `${kit}: a ${name} tile`);
  return t;
};
// The checklist's missing chips for a kit, label → points
const chips = (app, kit) => {
  const html = app.run(`(() => { const M = model(); return kitChecklist(S.kits.find(k => k.id === ${JSON.stringify(kit)}), M.kitRes[${JSON.stringify(kit)}], M); })()`);
  return new Map([...html.matchAll(/<span class="chip ess miss">([\s\S]*?)<\/span>(?=<span class="chip|<\/div>)/g)].map(([, body]) => {
    const g = body.match(/<span class="gain"[^>]*>\+(\d+)<\/span>/);
    return [text(body.replace(/<span class="vh">[^<]*<\/span>/, "").replace(/ · <span class="gain"[\s\S]*$/, "")), g ? +g[1] : 0];
  }));
};
// Taps a button the way the page's click handler does, and waits for what it starts
const tap = (app, b) => app.run(`ACT[${JSON.stringify(b.data.act)}](${JSON.stringify({ dataset: b.data, id: b.id })})`);
const button = (t, act, what = t.name) => {
  const b = t.buttons.find(b => b.data.act === act);
  assert.ok(b, `${what}: a ${act} button`);
  return b;
};
const plan = t => t.buttons.find(b => b.data.act === "shopAdd");
// Every write the page makes, as [set|delete, collection, id], and every toast as { m, label }
function household(fixture = "tests/household") {
  const app = load({ fixture });
  app.run(`globalThis.WRITES = []; globalThis.TOASTS = [];
    setDoc = (f => (...a) => { WRITES.push(["set", a[0], a[1]]); return f(...a); })(setDoc);
    delDoc = (f => (...a) => { WRITES.push(["delete", a[0], a[1]]); return f(...a); })(delDoc);
    toast = (f => (m, a) => { TOASTS.push({ m, a }); return f(m, a); })(toast);`);
  return app;
}
const writes = app => app.json("WRITES");
const since = (app, n) => writes(app).slice(n);
const PAIN = "Pain or fever reliever";

test("the standard household starts at readiness 17 with nothing on the list", () => {
  const app = household();
  assert.equal(app.run("model().overall"), 17);
  assert.equal(app.json("shopItems()").length, 0);
});

test("a tile and its chip read the points ticking its line into this kit adds: the pain reliever is +3, +2 and +1, at $16", () => {
  const app = household();
  const want = { go: 3, home: 2, car: 1 };
  for (const [kit, n] of Object.entries(want)) {
    const t = tile(app, kit, PAIN);
    assert.equal(t.gain, n, `${kit}: the tile`);
    assert.equal(chips(app, kit).get(PAIN), n, `${kit}: the chip`);
    assert.match(t.all, /(^| )\$16( |$)/, `${kit}: the tile reads $16`);
    assert.equal(app.run(`(() => { const M = model(); return gapGain(M, M.gaps.find(g => g.essential === "pain_reliever"), ${JSON.stringify(kit)}); })()`), n, `${kit}: gapGain with the kit`);
  }
  // Without a kit, gapGain is what it was: the line shopKit routes, which goes to the Basement bin
  assert.equal(app.run(`(() => { const M = model(); return gapGain(M, M.gaps.find(g => g.essential === "pain_reliever")); })()`), 2);
});

test("planning a tile from each kit, then Packed it, raises readiness by exactly that kit's number", async () => {
  for (const kit of ["go", "home", "car"]) {
    for (const name of [PAIN, "Whistle", "Emergency radio", "Printed contact list"]) {
      const app = household(), t = tile(app, kit, name), where = `${kit} ${name}`;
      tap(app, button(t, "shopAdd", where));
      const line = app.json("shopItems().at(-1)");
      assert.equal(line.kitId, kit, `${where}: planned into the kit it was tapped in`);
      const open = tile(app, kit, name);
      tap(app, button(open, "flEdit", where));
      await tap(app, button(tile(app, kit, name), "shopPack", where));
      assert.equal(app.run("model().overall"), 17 + t.gain, `${where}: +${t.gain}`);
      assert.deepEqual(app.json(`S.items.filter(i => i.source === "list").map(i => i.kitId)`), [kit], `${where}: the item is in this kit`);
    }
  }
});

test("a tile's price is its line's: $ for a price, From home for 0, Rx · pharmacy for a prescription", () => {
  const app = household();
  for (const kit of ["go", "home", "car"]) {
    const ts = tiles(app, kit);
    assert.match(tile(app, kit, "Printed contact list").all, /From home/, `${kit}: contact list`);
    assert.doesNotMatch(tile(app, kit, "Printed contact list").all, /\$/, `${kit}: no dollars on something from home`);
    assert.match(tile(app, kit, "Sam's prescriptions").all, /Rx · pharmacy/, `${kit}: prescriptions`);
    assert.match(tile(app, kit, "Whistle").all, /\$5\b/, `${kit}: whistle`);
    // Each priced tile reads its line's shopInfo price, worked out for this kit
    const prices = app.json(`(() => { const M = model(), r = M.kitRes[${JSON.stringify(kit)}];
      return r.rows.filter(row => row.ess).flatMap(row => row.ess.filter(e => !e.have).map(e => { const g = essGap(M, row.cat, e);
        return [e.label, g ? shopInfo(shopFromGap(g, M.h, ${JSON.stringify(kit)}), M).price ?? null : "none"]; })); })()`);
    for (const [label, p] of prices) {
      const t = ts.find(t => t.name === label);
      if (p === "none") continue;
      const shown = p === null ? "Rx · pharmacy" : p === 0 ? "From home" : `$${p}`;
      assert.ok(t.all.includes(shown), `${kit} ${label}: reads ${shown}, not "${t.all}"`);
    }
  }
});

test("a tile not on the list is a Plan button for this kit; planned, it reads Planned · price, and other kits say where it is", () => {
  const app = household();
  const t = tile(app, "car", "Whistle"), b = plan(t);
  assert.ok(b, "the whistle is a Plan button in the Trunk bag");
  assert.deepEqual(b.data, { act: "shopAdd", cat: "communication", essential: "whistle", kit: "car" });
  assert.equal(b.label, "Plan Whistle for Trunk bag");
  assert.equal(t.buttons.length, 1, "one button");
  assert.doesNotMatch(t.all, /Planned/);

  const n = writes(app).length;
  tap(app, b);
  assert.deepEqual(since(app, n), [["set", "household", "shopping"]], "planning writes the list once");
  const lines = app.json("shopItems()");
  assert.equal(lines.length, 1, "one line");
  assert.equal(lines[0].kitId, "car");
  assert.equal(lines[0].essential, "whistle");

  const planned = tile(app, "car", "Whistle");
  assert.match(planned.all, /Planned · \$5\b/);
  assert.ok(planned.cls.includes("plan"), "the planned tile is marked for its tint");
  assert.equal(plan(planned), undefined, "no Plan button once planned");
  for (const kit of ["go", "home"]) {
    const other = tile(app, kit, "Whistle");
    assert.match(other.all, /Planned for Trunk bag/, `${kit}: says where`);
    assert.equal(other.buttons.length, 0, `${kit}: not a button`);
    assert.ok(!other.cls.includes("plan"), `${kit}: not tinted`);
  }
  assert.equal(app.json("shopItems()").length, 1, "rendering again adds nothing");
});

test("a line with no kit reads Planned · no kit yet, and a line routed by type is planned for the kit it goes in", () => {
  const app = household();
  app.run(`S.shopping = { items: [{ ...shopFromGap(model().gaps.find(g => g.essential === "whistle"), model().h), kitId: "none" }] }`);
  for (const kit of ["go", "home", "car"]) {
    const t = tile(app, kit, "Whistle");
    assert.match(t.all, /Planned · no kit yet/, kit);
    assert.equal(t.buttons.length, 0, `${kit}: not a button`);
  }
  // Planned with no kit picked, shopKit sends the whistle to the Basement bin
  app.run(`S.shopping = { items: [shopFromGap(model().gaps.find(g => g.essential === "whistle"), model().h)] }`);
  assert.equal(app.run("shopKit(shopItems()[0])"), "home");
  assert.match(tile(app, "home", "Whistle").all, /Planned · \$5\b/);
  assert.ok(tile(app, "home", "Whistle").buttons.length, "a planned tile for this kit is a button");
  for (const kit of ["go", "car"]) assert.match(tile(app, kit, "Whistle").all, /Planned for Basement bin/, kit);
});

test("the fire extinguisher planned from the Basement bin goes into the Basement bin, not the go-bag", async () => {
  const app = household();
  assert.equal(app.run(`shopKit(shopFromGap(model().gaps.find(g => g.essential === "extinguisher"), model().h))`), "go", "by type it would go in the go-bag");
  tap(app, plan(tile(app, "home", "Fire extinguisher")));
  assert.equal(app.json("shopItems().at(-1).kitId"), "home");
  tap(app, button(tile(app, "home", "Fire extinguisher"), "flEdit"));
  await tap(app, button(tile(app, "home", "Fire extinguisher"), "shopPack"));
  const put = app.json(`S.items.filter(i => i.source === "list")`);
  assert.deepEqual(put.map(i => [i.kitId, i.essential]), [["home", "extinguisher"]]);
});

test("opening a planned tile shows Packed it and Take off plan on the tile, and writes nothing", () => {
  const app = household();
  tap(app, plan(tile(app, "car", "Whistle")));
  const id = app.json("shopItems()[0].id");
  const closed = tile(app, "car", "Whistle");
  assert.equal(closed.buttons.length, 1, "closed, it is one button");
  const toggle = button(closed, "flEdit");
  assert.equal(toggle.data.id, id, "it opens its line's actions");
  assert.match(closed.body, /aria-expanded="false"/);
  const n = writes(app).length, saved = app.run("JSON.stringify(HOUSEHOLD)");
  tap(app, toggle);
  assert.deepEqual(since(app, n), [], "opening writes nothing");
  assert.equal(app.run("JSON.stringify(HOUSEHOLD)"), saved, "and changes nothing saved");
  const open = tile(app, "car", "Whistle");
  assert.match(open.body, /aria-expanded="true"/);
  assert.deepEqual(open.buttons.map(b => b.text).slice(1), ["Packed it", "Take off plan"]);
  assert.deepEqual(button(open, "shopPack").data, { act: "shopPack", id });
  assert.deepEqual(button(open, "shopDel").data, { act: "shopDel", id });
  // Only this kit's tile opens; the other kits' tiles stay as they were
  for (const kit of ["go", "home"]) assert.equal(tile(app, kit, "Whistle").buttons.length, 0, kit);
  // Tapping it again closes it, still writing nothing
  tap(app, button(open, "flEdit"));
  assert.equal(tile(app, "car", "Whistle").buttons.length, 1);
  assert.deepEqual(since(app, n), []);
});

test("Packed it puts the item in the kit with a toast and Undo, and Undo takes it out and opens the line again", async () => {
  const app = household();
  tap(app, plan(tile(app, "car", "Whistle")));
  const id = app.json("shopItems()[0].id");
  tap(app, button(tile(app, "car", "Whistle"), "flEdit"));
  const n = writes(app).length;
  await tap(app, button(tile(app, "car", "Whistle"), "shopPack"));
  const w = since(app, n);
  assert.deepEqual(w.map(x => x.slice(0, 2)), [["set", "items"], ["set", "household"]], "Packed it writes the item, then the list");
  assert.equal(w[1][2], "shopping");
  const line = app.json("shopItems()[0]");
  assert.equal(line.done, true);
  assert.equal(line.inKit, "car");
  assert.equal(app.run("model().overall"), 18);
  assert.equal(app.json(`S.items.find(i => i.id === ${JSON.stringify(line.itemId)}).kitId`), "car");
  assert.ok(!tiles(app, "car").some(t => t.name === "Whistle"), "the whistle is packed, so its tile has gone");

  const t = app.json("TOASTS.map(t => ({ m: t.m, label: t.a?.label }))").at(-1);
  assert.deepEqual(t, { m: "Put in Trunk bag. Readiness 17 → 18", label: "Undo" });
  const m = writes(app).length;
  await app.run("TOASTS.at(-1).a.run()");
  assert.deepEqual(since(app, m).map(x => x.slice(0, 2)), [["delete", "items"], ["set", "household"]], "Undo deletes the item, then writes the list");
  const back = app.json("shopItems()");
  assert.equal(back.length, 1);
  assert.equal(back[0].id, id);
  assert.equal(back[0].done, false, "the line is open again");
  assert.ok(!("itemId" in back[0]) && !("inKit" in back[0]));
  assert.equal(app.json(`S.items.filter(i => i.source === "list").length`), 0, "the item is out");
  assert.equal(app.run("model().overall"), 17);
  assert.match(tile(app, "car", "Whistle").all, /Planned · \$5\b/, "the tile is planned again");
});

test("ticking a row on the list toasts with Undo too", async () => {
  const app = household();
  app.run(`ACT.shopAdd({ dataset: { cat: "communication", essential: "whistle", kit: "car" } })`);
  const id = app.json("shopItems()[0].id");
  await app.fire("change", { dataset: { change: "shopTick", id }, checked: true });
  await new Promise(r => setImmediate(r)); // the handler starts the tick without waiting for it
  const t = app.json("TOASTS.map(t => ({ m: t.m, label: t.a?.label }))").at(-1);
  assert.deepEqual(t, { m: "Put in Trunk bag. Readiness 17 → 18", label: "Undo" });
  await app.run("TOASTS.at(-1).a.run()");
  assert.equal(app.json("shopItems()[0].done"), false);
  assert.equal(app.run("model().overall"), 17);
});

// On the live site a save resolves before the page's copy of the list catches up, and a slow save leaves time for
// a second tap. HELD keeps each list write unanswered until release(), and land() then applies them in order.
function slowList(app) {
  app.run(`globalThis.HELD = []; globalThis.LANDING = [];
    setDoc = (f => (...a) => a[0] === "household" ? new Promise(r => HELD.push({ a, r })) : f(...a))(setDoc);
    globalThis.release = () => HELD.splice(0).forEach(h => { LANDING.push(h.a); h.r(); });
    globalThis.land = () => { for (const a of LANDING.splice(0)) S[a[1]] = a[2]; render(); };`);
}
const settle = () => new Promise(r => setImmediate(r));

test("Undo tapped before the list has caught up still takes the item out and opens the line again", async () => {
  const app = household();
  tap(app, plan(tile(app, "car", "Whistle")));
  const id = app.json("shopItems()[0].id");
  slowList(app);
  const packing = app.run(`ACT.shopPack({ dataset: { act: "shopPack", id: ${JSON.stringify(id)} } })`);
  await settle();
  assert.ok(!app.json("TOASTS.some(t => t.a?.label === 'Undo')"), "no Undo until the list is saved");
  app.run("release()");
  await packing;
  assert.equal(app.json("TOASTS.map(t => t.a?.label)").at(-1), "Undo");
  assert.equal(app.json("shopItems()[0].done"), false, "the page's list has not caught up yet");
  const undoing = app.run("TOASTS.at(-1).a.run()");
  await settle();
  app.run("release()");
  await undoing;
  app.run("land()");
  assert.equal(app.json(`S.items.filter(i => i.source === "list").length`), 0, "the item is out");
  const line = app.json("shopItems()[0]");
  assert.equal(line.done, false, "the line is open again");
  assert.ok(!("itemId" in line) && !("inKit" in line));
  assert.equal(app.run("model().overall"), 17);
});

test("tapping Packed it twice while the first save is slow puts one item in the kit", async () => {
  const app = household();
  tap(app, plan(tile(app, "car", "Whistle")));
  const id = app.json("shopItems()[0].id");
  slowList(app);
  const pack = () => app.run(`ACT.shopPack({ dataset: { act: "shopPack", id: ${JSON.stringify(id)} } })`);
  const first = pack();
  await settle();
  const second = pack();
  await settle();
  app.run("release()");
  await Promise.all([first, second]);
  await settle();
  app.run("release()");
  app.run("land()");
  assert.equal(app.json(`S.items.filter(i => i.source === "list").length`), 1);
  assert.equal(app.json("shopItems()[0].done"), true);
  assert.equal(app.run("model().overall"), 18);
});

test("Take off plan removes the line, and the tile is a Plan button again", () => {
  const app = household();
  tap(app, plan(tile(app, "car", "Whistle")));
  tap(app, button(tile(app, "car", "Whistle"), "flEdit"));
  const n = writes(app).length;
  tap(app, button(tile(app, "car", "Whistle"), "shopDel"));
  assert.deepEqual(since(app, n), [["set", "household", "shopping"]], "Take off plan writes the list once");
  assert.equal(app.json("shopItems()").length, 0);
  for (const kit of ["go", "home", "car"]) {
    const t = tile(app, kit, "Whistle");
    assert.ok(plan(t), `${kit}: a Plan button again`);
    assert.equal(t.buttons.length, 1, kit);
    assert.doesNotMatch(t.all, /Planned/, kit);
  }
});

test("a later numbered essential says which to plan first, and each plan flips the tile tapped", () => {
  const app = household();
  app.run(`S.items = S.items.filter(i => i.category !== "medications"); S.profile.members[0].conditions = ["meds"]`);
  const rx = kit => tiles(app, kit).filter(t => /^Prescriptions \(\d of 2\)$/.test(t.name));
  const [a, b] = rx("go");
  assert.ok(plan(a), "the first is a Plan button");
  assert.equal(b.buttons.length, 0, "the second is not");
  assert.match(b.all, /Plan 1 of 2 first/);
  assert.match(b.all, /Rx · pharmacy/, "and still shows its price");
  tap(app, plan(a));
  const [a2, b2] = rx("go");
  assert.match(a2.all, /Planned · Rx\b/);
  assert.ok(plan(b2), "the second is a Plan button now");
  for (const kit of ["home", "car"]) {
    const [x, y] = rx(kit);
    assert.match(x.all, /Planned for Hall closet go-bag/, kit);
    assert.ok(plan(y), `${kit}: the second can be planned here`);
  }
  tap(app, plan(rx("car")[1]));
  assert.match(rx("car")[1].all, /Planned · Rx\b/);
  assert.match(rx("go")[1].all, /Planned for Trunk bag/);
});

test("gapLine finds the open line splitListed matches a gap to, in every household", () => {
  for (const name of households) {
    const app = load({ fixture: name });
    for (const lines of ["[]", "model().gaps.map(g => shopFromGap(g, model().h))", "model().gaps.filter((g, i) => i % 2).map(g => shopFromGap(g, model().h))"]) {
      app.run(`S.shopping = { items: ${lines} }; S.shopping.items.forEach((e, i) => { if (i % 3 === 0) e.done = true; })`);
      const out = app.json(`(() => { const M = model(), { on } = splitListed(M.gaps), open = shopItems().filter(x => !x.done);
        const got = M.gaps.map(g => gapLine(M.gaps, g));
        return { on: M.gaps.map(g => on.includes(g)), got: got.map(e => e ? open.indexOf(e) : -1), keys: got.map((e, i) => !e || gapKey(e) === gapKey(M.gaps[i])) }; })()`);
      assert.deepEqual(out.got.map(i => i >= 0), out.on, `${name}: a line exactly for the gaps on the list`);
      const used = out.got.filter(i => i >= 0);
      assert.equal(new Set(used).size, used.length, `${name}: no line is two gaps'`);
      assert.ok(out.keys.every(Boolean), `${name}: each line is its gap's essential`);
    }
  }
});

test("every kit's tiles and chips agree on their points, in every household, planned or not", () => {
  let seen = 0;
  for (const name of households) {
    const app = load({ fixture: name });
    for (const state of ["none", "all"]) {
      if (state === "all") app.run("S.shopping = { items: model().gaps.map((g, i) => shopFromGap(g, model().h, S.kits[i % S.kits.length]?.id)) }");
      for (const kit of app.json("S.kits.map(k => k.id)")) {
        const cs = chips(app, kit);
        // What ticking each missing essential's line into this kit adds, worked out here from scoreIfShopped
        const want = new Map(app.json(`(() => { const M = model(), r = M.kitRes[${JSON.stringify(kit)}];
          return r.rows.filter(row => row.ess).flatMap(row => row.ess.filter(e => !e.have).map(e => { const g = essGap(M, row.cat, e);
            return [e.label, g ? Math.max(0, scoreIfShopped(M, [shopFromGap(g, M.h, ${JSON.stringify(kit)})]) - M.overall) : 0]; })); })()`));
        for (const t of tiles(app, kit)) {
          assert.ok(cs.has(t.name), `${name} ${kit} ${t.name}: on the checklist`);
          assert.equal(t.gain, cs.get(t.name), `${name} ${kit} ${t.name} (${state}): tile and chip`);
          assert.equal(t.gain, want.get(t.name), `${name} ${kit} ${t.name} (${state}): the points for this kit`);
          assert.doesNotMatch(t.body, /NaN|undefined|Infinity|\[object| null\b/, `${name} ${kit} ${t.name}`);
          seen++;
        }
      }
    }
  }
  assert.ok(seen > 100, "tiles were compared");
});

test("the checklist's Add N to list is gone, and a block whose every missing essential is planned says so", () => {
  const page = fs.readFileSync(PAGE, "utf8");
  assert.ok(!page.includes("shopAddBlock"), "shopAddBlock is not in the page");
  for (const name of households) {
    const app = load({ fixture: name });
    assert.equal(app.run(`"shopAddBlock" in ACT`), false);
    for (const kit of app.json("S.kits.map(k => k.id)")) {
      const html = app.run(`S.view = "kits"; S.openKit = ${JSON.stringify(kit)}; viewKits(model())`);
      assert.doesNotMatch(html, /shopAddBlock|>Add \d+ to list</, `${name} ${kit}`);
    }
  }
  const app = household();
  const docs = () => app.run(`S.view = "kits"; S.openKit = "go"; viewKits(model())`).match(/<section class="ess-blk">(?:(?!<\/section>)[\s\S])*Documents &amp; cash[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(docs(), /On your shopping list/);
  for (const e of ["id_copies", "insurance", "cash"]) app.run(`ACT.shopAdd({ dataset: { cat: "documents", essential: "${e}", kit: "go" } })`);
  assert.doesNotMatch(docs(), /On your shopping list/, "one still to plan");
  app.run(`ACT.shopAdd({ dataset: { cat: "documents", essential: "records", kit: "car" } })`);
  assert.match(docs(), /On your shopping list/, "every one planned, wherever it goes");
});

test("read-only viewers see every state with no button", () => {
  const app = household();
  tap(app, plan(tile(app, "car", "Whistle")));
  tap(app, plan(tile(app, "go", PAIN)));
  tap(app, button(tile(app, "car", "Whistle"), "flEdit"));
  app.run(`S.shopping.items.push({ ...shopFromGap(model().gaps.find(g => g.essential === "radio"), model().h), kitId: "none" })`);
  app.run("S.canWrite = false");
  const seen = new Set();
  for (const kit of ["go", "home", "car"]) {
    for (const t of tiles(app, kit)) {
      assert.doesNotMatch(t.body, /<button|data-act/, `${kit} ${t.name}`);
      for (const s of ["Planned · ", "Planned for ", "no kit yet", "$", "From home", "Rx · pharmacy"]) if (t.all.includes(s)) seen.add(s);
    }
  }
  assert.deepEqual([...seen].sort(), ["$", "From home", "Planned · ", "Planned for ", "Rx · pharmacy", "no kit yet"].sort(), "every state was seen");
  assert.ok(tile(app, "car", "Whistle").cls.includes("plan"), "planned for this kit is still tinted");
});

test("a kit's name holding markup is escaped in Planned for and in Plan's label", () => {
  const app = household();
  const evil = `<img src=x onerror=alert(1)>`;
  app.run(`S.kits.find(k => k.id === "car").name = ${JSON.stringify(evil)}`);
  const t = tile(app, "car", "Whistle");
  assert.equal(plan(t).label, `Plan Whistle for ${evil}`);
  tap(app, plan(t));
  for (const kit of ["go", "home"]) {
    const html = app.run(`S.view = "kits"; S.openKit = "${kit}"; viewKits(model())`);
    assert.ok(!html.includes("<img src=x"), `${kit}: no raw markup`);
    assert.ok(tile(app, kit, "Whistle").all.includes(`Planned for ${evil}`), `${kit}: named as text`);
  }
});

test("the planned tile's tint and edge are the brand tokens, with no new colour", () => {
  const page = fs.readFileSync(PAGE, "utf8"), css = page.match(/<style>([\s\S]*?)<\/style>/)[1];
  const rules = [...css.matchAll(/([^{}]*\.fl-tile\.plan(?![\w-])[^{}]*)\{([^}]*)\}/g)].map(m => m[2]).join(";");
  assert.match(rules, /background:\s*var\(--brand-tint\)/);
  assert.match(rules, /border-color:\s*var\(--brand\)/);
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, "only tokens");
});

// In Chrome at 390px, with every state on the tiles and one planned tile open in each kit: nothing scrolls sideways,
// each tile's text and its open actions stay inside it, every note is whole, and the planned tile wears the brand tint.
test("at 390px every state fits its tile, an open tile's actions fit inside it, and long kit names stay whole", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const fixtures = ["tests/household", "fixtures/phone-width/long-kit-name", "fixtures/phone-width/long-essentials"];
  const seen = atPhoneWidth(fixtures, () => {
    const M = model(), ids = [...S.kits.map(k => k.id), "none"];
    S.shopping = { items: M.gaps.flatMap((g, i) => i % 5 === 4 ? [] : [{ ...shopFromGap(g, M.h), kitId: ids[i % ids.length] }]) };
    const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5;
    return S.kits.map(k => {
      S.view = "kits"; S.openKit = k.id; S.flOpen = null; render();
      const first = document.querySelector("#v-kits .fl-tile.plan button");
      if (first) { S.flOpen = first.dataset.id; render(); }
      const tiles = [...document.querySelectorAll("#v-kits .fl-tile.miss")];
      const open = document.querySelector("#v-kits .fl-tile.plan [aria-expanded=true]")?.closest("li");
      const tint = document.createElement("i"); tint.style.color = "var(--brand-tint)"; document.body.append(tint);
      const want = getComputedStyle(tint).color; tint.remove();
      return {
        kit: k.name, width: innerWidth, scroll: document.documentElement.scrollWidth, n: tiles.length,
        states: ["Planned · ", "Planned for ", "no kit yet"].filter(s => tiles.some(t => t.textContent.includes(s))),
        off: tiles.filter(t => !inside(t.getBoundingClientRect(), { left: 0, right: innerWidth })).length,
        cut: tiles.flatMap(t => [...t.querySelectorAll(".fl-name, .fl-note, .gain")].filter(n => n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1).map(n => n.textContent)),
        tinted: [...document.querySelectorAll("#v-kits .fl-tile.plan")].every(t => getComputedStyle(t).backgroundColor === want),
        open: open && {
          acts: [...open.querySelectorAll("button")].slice(1).map(b => b.textContent),
          fit: [...open.querySelectorAll("button")].every(b => inside(b.getBoundingClientRect(), open.getBoundingClientRect()) && b.scrollWidth <= b.clientWidth + 1),
          tall: Math.min(...[...open.querySelectorAll("button")].slice(1).map(b => b.getBoundingClientRect().height)),
        },
      };
    });
  });
  let opened = 0;
  for (const f of fixtures) {
    const kits = seen.get(f);
    assert.ok(kits && kits.length, `${f}: no kits measured`);
    for (const k of kits) {
      const where = `${f}, ${k.kit}`;
      assert.equal(k.width, 390, where);
      assert.ok(k.scroll <= k.width, `${where}: scrolls sideways (${k.scroll}px wide)`);
      assert.equal(k.off, 0, `${where}: a tile is off screen`);
      assert.deepEqual(k.cut, [], `${where}: text cut off`);
      assert.ok(k.tinted, `${where}: a planned tile isn't tinted --brand-tint`);
      if (!k.open) continue;
      assert.deepEqual(k.open.acts, ["Packed it", "Take off plan"], where);
      assert.ok(k.open.fit, `${where}: the open tile's actions run outside it`);
      assert.ok(k.open.tall >= 32, `${where}: an action is ${k.open.tall}px tall, under a 32px tap target`);
      opened++;
    }
    assert.ok(kits.some(k => k.states.length === 3), `${f}: some kit shows every planned state`);
  }
  assert.ok(opened >= 6, "open tiles were measured");
});
