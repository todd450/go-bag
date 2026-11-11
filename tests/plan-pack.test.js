// Planning a missing essential into a kit and packing it (issues #120 and #115), from a kit's To get and the checklist.
// A kit's flat-lay shows only what is packed (the founder, 11 Nov 2026: say each thing once), so what was the dashed
// tiles' behaviour is tested here on the list: a line planned into a kit is ticked into that kit, raises readiness by
// the points the kit's checklist chip shows, toasts with Undo, and survives a slow or failed save.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, PAGE, ROOT } = require("./load");

const households = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = html => unesc(html.replace(/<wbr>/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/­/g, "")).trim();

// The checklist's missing chips for a kit, label → points
const chips = (app, kit) => {
  const html = app.run(`(() => { const M = model(); return kitChecklist(S.kits.find(k => k.id === ${JSON.stringify(kit)}), M.kitRes[${JSON.stringify(kit)}], M); })()`);
  return new Map([...html.matchAll(/<span class="chip ess miss">([\s\S]*?)<\/span>(?=<span class="chip|<\/div>)/g)].map(([, body]) => {
    const g = body.match(/<span class="gain"[^>]*>\+(\d+) pts?<\/span>/);
    return [text(body.replace(/<span class="vh">[^<]*<\/span>/, "").replace(/ · <span class="gain"[\s\S]*$/, "")), g ? +g[1] : 0];
  }));
};
// Plans a missing essential into a kit, as "Add to list" in that kit's To get does, and returns its line's id
const planIn = (app, kit, cat, essential) => { app.run(`ACT.shopAdd({ dataset: ${JSON.stringify({ cat, essential, kit })} })`); return app.json("shopItems().at(-1).id"); };
// Ticks a line, as its checkbox on the list does
const pack = (app, id) => app.run(`shopTick(${JSON.stringify(id)}, true)`);
// Every write the page makes, as [set|delete, collection, id], and every toast as { m, a }
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
const ESS = { [PAIN]: ["medications", "pain_reliever"], Whistle: ["communication", "whistle"], "Emergency radio": ["communication", "radio"], "Printed contact list": ["communication", "contact_list"] };

test("the standard household starts at readiness 17 with nothing on the list", () => {
  const app = household();
  assert.equal(app.run("model().overall"), 17);
  assert.equal(app.json("shopItems()").length, 0);
});

test("a kit's flat-lay shows only what is packed: a tile per item, and none for what is missing", () => {
  const page = fs.readFileSync(PAGE, "utf8");
  for (const gone of ["flMiss", "fl-tile miss", "shopPack", "Take off plan"]) assert.ok(!page.includes(gone), `${gone} is not in the page`);
  let kits = 0, empty = 0;
  for (const name of households) {
    const app = load({ fixture: name });
    for (const w of [true, false]) for (const lines of ["null", "{ items: model().gaps.map((g, i) => shopFromGap(g, model().h, S.kits[i % S.kits.length]?.id)) }"]) {
      app.run(`S.canWrite = ${w}; S.shopping = ${lines}`);
      for (const kit of app.json("S.kits.map(k => k.id)")) {
        const out = app.json(`(() => { const M = model(), k = S.kits.find(k => k.id === ${JSON.stringify(kit)}), items = S.items.filter(i => i.kitId === k.id);
          S.view = "kits"; S.openKit = k.id; S.listKit = null; S.toGet = null;
          return { html: kitDetail(k, M.kitRes[k.id], M), items: items.map(i => i.id), missing: M.kitRes[k.id].rows.filter(r => r.ess).flatMap(r => r.ess.filter(e => !e.have).map(e => e.label)) }; })()`);
        const panel = out.html.slice(out.html.indexOf(">Contents<")), tiles = [...panel.matchAll(/<li class="fl-tile([^"]*)"([^>]*)>/g)];
        const at = `${name} ${kit}`;
        assert.deepEqual(tiles.map(t => unesc((t[2].match(/data-id="([^"]*)"/) || [])[1] || "")).sort(), [...out.items].sort(), `${at}: one tile per item, each an item's`);
        assert.doesNotMatch(panel.slice(0, panel.indexOf("kit-ck")), /Planned|class="gain"|data-act="shopAdd"/, `${at}: nothing planned or missing in the flat-lay`);
        if (!out.items.length) { assert.match(text(panel), /Nothing in this kit yet\./, at); empty++; }
        kits++;
      }
    }
  }
  assert.ok(kits > 100 && empty > 0, `${kits} kits, ${empty} of them empty`);
});

test("a chip reads the points ticking its line into this kit adds: the pain reliever is +3, +2 and +1", () => {
  const app = household();
  for (const [kit, n] of Object.entries({ go: 3, home: 2, car: 1 })) {
    assert.equal(chips(app, kit).get(PAIN), n, `${kit}: the chip`);
    assert.equal(app.run(`(() => { const M = model(); return gapGain(M, M.gaps.find(g => g.essential === "pain_reliever"), ${JSON.stringify(kit)}); })()`), n, `${kit}: gapGain with the kit`);
  }
  // Without a kit, gapGain is what it was: the line shopKit routes, which goes to the Basement bin
  assert.equal(app.run(`(() => { const M = model(); return gapGain(M, M.gaps.find(g => g.essential === "pain_reliever")); })()`), 2);
});

test("planning an essential into each kit, then ticking it, raises readiness by exactly that kit's chip", async () => {
  for (const kit of ["go", "home", "car"]) {
    for (const [name, [cat, essential]] of Object.entries(ESS)) {
      const app = household(), gain = chips(app, kit).get(name), where = `${kit} ${name}`;
      assert.ok(gain > 0, `${where}: the chip shows points`);
      const id = planIn(app, kit, cat, essential);
      assert.equal(app.json("shopItems().at(-1).kitId"), kit, `${where}: planned into the kit it was added in`);
      await pack(app, id);
      assert.equal(app.run("model().overall"), 17 + gain, `${where}: +${gain}`);
      assert.deepEqual(app.json(`S.items.filter(i => i.source === "list").map(i => i.kitId)`), [kit], `${where}: the item is in this kit`);
    }
  }
});

test("planning writes the list once, and the line is priced: $5 for the whistle, nothing for what's at home, none for a prescription", () => {
  const app = household();
  const n = writes(app).length;
  planIn(app, "car", "communication", "whistle");
  assert.deepEqual(since(app, n), [["set", "household", "shopping"]], "planning writes the list once");
  const lines = app.json("shopItems()");
  assert.deepEqual(lines.map(l => [l.kitId, l.essential]), [["car", "whistle"]]);
  const price = (cat, essential) => app.json(`(() => { const M = model(), g = M.gaps.find(g => g.cat === ${JSON.stringify(cat)} && g.essential === ${JSON.stringify(essential)}); return shopInfo(shopFromGap(g, M.h, "car"), M).price ?? null; })()`);
  assert.equal(price("communication", "whistle"), 5);
  assert.equal(price("communication", "contact_list"), 0);
  assert.equal(price("medications", "prescriptions"), null);
});

test("the fire extinguisher planned from the Basement bin goes into the Basement bin, not the go-bag", async () => {
  const app = household();
  assert.equal(app.run(`shopKit(shopFromGap(model().gaps.find(g => g.essential === "extinguisher"), model().h))`), "go", "by type it would go in the go-bag");
  const id = planIn(app, "home", "fire_safety", "extinguisher");
  assert.equal(app.json("shopItems().at(-1).kitId"), "home");
  await pack(app, id);
  assert.deepEqual(app.json(`S.items.filter(i => i.source === "list")`).map(i => [i.kitId, i.essential]), [["home", "extinguisher"]]);
});

test("ticking a line puts the item in the kit with a toast and Undo, and Undo takes it out and opens the line again", async () => {
  const app = household();
  const id = planIn(app, "car", "communication", "whistle");
  const n = writes(app).length;
  await pack(app, id);
  const w = since(app, n);
  assert.deepEqual(w.map(x => x.slice(0, 2)), [["set", "items"], ["set", "household"]], "ticking writes the item, then the list");
  assert.equal(w[1][2], "shopping");
  const line = app.json("shopItems()[0]");
  assert.equal(line.done, true);
  assert.equal(line.inKit, "car");
  assert.equal(app.run("model().overall"), 18);
  assert.equal(app.json(`S.items.find(i => i.id === ${JSON.stringify(line.itemId)}).kitId`), "car");
  assert.ok(!chips(app, "car").has("Whistle"), "the whistle is packed, so it is no longer missing");

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
  assert.ok(chips(app, "car").has("Whistle"), "and the whistle is missing again");
});

test("ticking a row's checkbox on the list toasts with Undo too", async () => {
  const app = household();
  const id = planIn(app, "car", "communication", "whistle");
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
  const id = planIn(app, "car", "communication", "whistle");
  slowList(app);
  const packing = pack(app, id);
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

test("ticking twice while the first save is slow puts one item in the kit", async () => {
  const app = household();
  const id = planIn(app, "car", "communication", "whistle");
  slowList(app);
  const first = pack(app, id);
  await settle();
  const second = pack(app, id);
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

// A dropped connection: the item saves, then the list write toasts its error and fails, the way setDoc does.
test("when the list doesn't save, a tick leaves the save error showing and offers no Undo", async () => {
  const app = household();
  const id = planIn(app, "car", "communication", "whistle");
  app.run(`setDoc = (f => (...a) => a[0] === "household"
    ? (toast("Couldn't save. Check your connection and try again."), Promise.reject(new Error("offline"))) : f(...a))(setDoc)`);
  const n = app.json("TOASTS.length");
  await pack(app, id);
  await settle();
  const after = app.json("TOASTS.slice(" + n + ").map(t => ({ m: t.m, label: t.a?.label ?? null }))");
  assert.ok(after.length, "a toast says something went wrong");
  assert.equal(after.at(-1).label, null, "no Undo for a tick that didn't save");
  assert.match(after.at(-1).m, /Couldn't save/, "the save error is the last word");
  assert.equal(app.json("shopItems()[0].done"), false, "the line stays open");
  // and a later tap is not blocked by a tick left half-done
  assert.equal(app.json("ticking.size"), 0);
});

test("taking a line off the list writes the list once and leaves the essential to add again", () => {
  const app = household();
  const id = planIn(app, "car", "communication", "whistle");
  const n = writes(app).length;
  app.run(`ACT.shopDel({ dataset: { id: ${JSON.stringify(id)} } })`);
  assert.deepEqual(since(app, n), [["set", "household", "shopping"]]);
  assert.equal(app.json("shopItems()").length, 0);
  assert.ok(app.json(`splitListed(model().gaps).off.some(g => g.essential === "whistle")`), "the whistle is a gap not on the list again");
});

test("with two people on daily medication, each Add to list plans one person's prescriptions", () => {
  const app = household();
  app.run(`S.items = S.items.filter(i => i.category !== "medications"); S.profile.members[0].conditions = ["meds"]`);
  const off = () => app.json(`splitListed(model().gaps).off.filter(g => g.essential === "prescriptions").map(g => g.label)`);
  assert.deepEqual(off(), ["Prescriptions (1 of 2)", "Prescriptions (2 of 2)"]);
  planIn(app, "go", "medications", "prescriptions");
  assert.deepEqual(off(), ["Prescriptions (2 of 2)"], "the first is planned, the second is still to add");
  planIn(app, "car", "medications", "prescriptions");
  assert.deepEqual(off(), []);
  assert.deepEqual(app.json("shopItems().map(l => l.kitId)"), ["go", "car"], "each into the kit it was added in");
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

test("every kit's chips show the points for that kit, in every household, planned or not", () => {
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
        assert.deepEqual([...cs.keys()].sort(), [...want.keys()].sort(), `${name} ${kit} (${state}): a chip per missing essential`);
        for (const [label, n] of want) { assert.equal(cs.get(label), n, `${name} ${kit} ${label} (${state}): the points for this kit`); seen++; }
      }
    }
  }
  assert.ok(seen > 100, "chips were compared");
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

test("a kit's name holding markup is escaped wherever its To get names it", () => {
  const app = household();
  const evil = `<img src=x onerror=alert(1)>`;
  app.run(`S.canWrite = true; S.kits.find(k => k.id === "car").name = ${JSON.stringify(evil)}`);
  planIn(app, "car", "communication", "whistle");
  for (const kit of ["go", "home", "car"]) for (const side of ["null", JSON.stringify(kit)]) {
    const html = app.run(`S.view = "kits"; S.openKit = "${kit}"; S.toGet = ${side}; viewKits(model())`);
    assert.ok(!html.includes("<img src=x"), `${kit} ${side}: no raw markup`);
  }
});
