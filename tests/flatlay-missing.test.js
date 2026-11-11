// The flat-lay's dashed tiles (issue #62): each named essential a kit is missing shows as a dashed tile in its
// zone, after the zone's present tiles, and tapping it plans it into that kit (#120). tests/ghost-tiles.test.js has
// the tiles' prices and their planned states.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");

const scenarios = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
// A soft hyphen (U+00AD) and <wbr> are only places a label may break, so text leaves them out
const text = html => unesc(html.replace(/<wbr>/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/\u00ad/g, "")).trim();
const kitHtml = (run, id) => run(`S.view = "kits"; S.openKit = ${JSON.stringify(id)}; viewKits(model())`);
const pick = (body, re) => text((body.match(re) || ["", ""])[1]);

// The Contents panel's zones, each with its present and dashed tiles in the order shown.
function zones(html) {
  return [...html.matchAll(/<section class="fl-zone"[^>]*>([\s\S]*?)<\/section>/g)].map(([, z]) => ({
    label: pick(z, /<h3[^>]*>([\s\S]*?)<\/h3>/),
    tiles: [...z.matchAll(/<li class="fl-tile([^"]*)"([^>]*)>([\s\S]*?)<\/li>/g)].map(([, cls, attrs, body]) => {
      const b = body.match(/<button([^>]*)>/);
      return {
        miss: cls.trim().split(/\s+/).includes("miss"), attrs, body,
        name: pick(body, /<span class="fl-name"[^>]*>([\s\S]*?)<\/span>/),
        gain: pick(body, /<span class="gain[^"]*"[^>]*>([\s\S]*?)<\/span>/),
        all: text(body),
        button: b && {
          dataset: Object.fromEntries([...b[1].matchAll(/data-([a-z]+)="([^"]*)"/g)].map(m => [m[1], unesc(m[2])])),
          label: unesc((b[1].match(/aria-label="([^"]*)"/) || ["", ""])[1]),
        },
      };
    }),
  }));
}
const dashed = html => zones(html).flatMap(z => z.tiles.filter(t => t.miss).map(t => ({ ...t, zone: z.label })));
// What the kit's checklist says is missing: one entry per row.ess entry without `have`.
const missing = (app, kit) => app.json(`(() => { const M = model(), r = M.kitRes[${JSON.stringify(kit)}];
  return r.rows.filter(row => row.ess).flatMap(row => row.ess.filter(e => !e.have).map(e => ({ cat: row.cat, id: e.id, label: e.label }))); })()`);
// The checklist's missing chips for a kit, as label → gain.
const chipGains = (app, kit) => {
  const html = app.run(`(() => { const M = model(); return kitChecklist(S.kits.find(k => k.id === ${JSON.stringify(kit)}), M.kitRes[${JSON.stringify(kit)}], M); })()`);
  return new Map([...html.matchAll(/<span class="chip ess miss">([\s\S]*?)<\/span>(?=<span class="chip|<\/div>)/g)].map(([, body]) => {
    const g = body.match(/<span class="gain"[^>]*>\+(\d+) pts?<\/span>/);
    return [text(body.replace(/<span class="vh">[^<]*<\/span>/, "").replace(/ · <span class="gain"[\s\S]*$/, "")), g ? +g[1] : 0];
  }));
};
const zoneOfCat = (app, cat) => app.run(`zoneOf(${JSON.stringify(cat)}).label`);
// A measure for atPhoneWidth that is handed plan(on). plan(true) plans the household's gaps round its kits in turn, then
// with no kit, leaving every fifth off the list, so a kit's tiles show every state: a price, Planned · price, Planned
// for another kit and Planned · no kit yet. plan(false) puts the household's own list back.
const withStates = measure => `() => { const keep = S.shopping, plan = on => { S.shopping = keep; if (!on) return;
  const M = model(), ids = [...S.kits.map(k => k.id), "none"];
  S.shopping = { items: M.gaps.flatMap((g, i) => i % 5 === 4 ? [] : [{ ...shopFromGap(g, M.h), kitId: ids[i % ids.length] }]) }; };
  try { return (${measure})(plan); } finally { plan(false); } }`;

test("every kit in every scenario shows one dashed tile per missing essential, in its category's zone, after the present tiles", () => {
  let seen = 0;
  for (const fixture of scenarios) {
    const app = load({ fixture });
    for (const kit of app.json("S.kits.map(k => k.id)")) {
      const where = `${fixture} ${kit}`, html = kitHtml(app.run, kit);
      const want = missing(app, kit), got = dashed(html);
      assert.equal(got.length, want.length, `${where}: dashed tiles`);
      const key = x => `${x.zone} | ${x.name}`;
      assert.deepEqual(got.map(key).sort(), want.map(e => `${zoneOfCat(app, e.cat)} | ${e.label}`).sort(), `${where}: each in its zone`);
      for (const z of zones(html)) {
        assert.ok(z.tiles.length, `${where}: ${z.label} shows only with tiles in it`);
        const first = z.tiles.findIndex(t => t.miss);
        if (first >= 0) assert.ok(z.tiles.slice(first).every(t => t.miss), `${where}: ${z.label}: dashed tiles come after present ones`);
      }
      for (const t of got) assert.doesNotMatch(t.body, /NaN|undefined|Infinity|\[object|function/, `${where}: ${t.name}`);
      seen += got.length;
    }
  }
  assert.ok(seen > 20, "the scenarios have missing essentials to show");
});

test("a zone that holds only missing essentials still shows", () => {
  const app = load({ fixture: "tests/household" });
  const zs = zones(kitHtml(app.run, "go"));
  const docs = zs.find(z => z.label === "Documents & cash");
  assert.ok(docs, "Documents & cash shows with nothing in it");
  assert.ok(docs.tiles.length && docs.tiles.every(t => t.miss));
});

test("counted categories never get a dashed tile", () => {
  for (const fixture of scenarios) {
    const app = load({ fixture });
    for (const kit of app.json("S.kits.map(k => k.id)")) {
      const counted = app.json(`model().kitRes[${JSON.stringify(kit)}].rows.filter(r => !r.ess).map(r => catLabel(r.cat))`);
      const names = dashed(kitHtml(app.run, kit)).map(t => t.name);
      const essLabels = new Set(app.json("Object.values(ESSENTIALS).flat().map(e => e.label)"));
      for (const n of names) assert.ok(essLabels.has(n) || /prescriptions|^Prescriptions \(\d+ of \d+\)$/.test(n), `${fixture} ${kit}: "${n}" is a named essential`);
      for (const c of counted) assert.ok(!names.includes(c), `${fixture} ${kit}: ${c} has no dashed tile`);
      assert.ok(!dashed(kitHtml(app.run, kit)).some(t => t.zone === "Water & food"), `${fixture} ${kit}: no dashed water or food`);
    }
  }
});

test("prescriptions show once per person on daily medication, named when there is one", () => {
  const app = load({ fixture: "tests/household" });
  const rx = () => dashed(kitHtml(app.run, "go")).filter(t => /prescriptions/i.test(t.name)).map(t => [t.zone, t.name]);
  app.run(`S.items = S.items.filter(i => i.category !== "medications")`);
  assert.deepEqual(rx(), [["First aid & medicine", "Sam's prescriptions"]]);
  app.run(`S.profile.members[0].conditions = ["meds"]`);
  assert.deepEqual(rx(), [["First aid & medicine", "Prescriptions (1 of 2)"], ["First aid & medicine", "Prescriptions (2 of 2)"]]);
  app.run(`S.profile.members.forEach(m => { m.conditions = []; })`);
  assert.deepEqual(rx(), []);
});

test("a household name holding markup renders escaped in its prescriptions tile", () => {
  const app = load({ fixture: "tests/household" });
  const evil = `<img src=x onerror=alert(1)>"`;
  app.run(`S.items = S.items.filter(i => i.category !== "medications"); S.profile.members[1].label = ${JSON.stringify(evil)}`);
  const html = kitHtml(app.run, "go");
  assert.ok(!html.includes("<img src=x"), "no raw markup");
  const t = dashed(html).find(t => t.name === `${evil}'s prescriptions`);
  assert.ok(t, "the tile names the person");
  assert.equal(t.button.label, `Plan ${evil}'s prescriptions for Hall closet go-bag`);
});

test("an untagged item in an essentials category is a present tile, and its essential is still a dashed tile", () => {
  const app = load({ fixture: "fixtures/data-and-account-shapes/essential-tags" });
  const zs = zones(kitHtml(app.run, "go"));
  const docs = zs.find(z => z.label === "Documents & cash");
  const present = docs.tiles.filter(t => !t.miss).map(t => t.attrs.match(/data-id="([^"]*)"/)[1]).sort();
  assert.deepEqual(present, ["d1", "d2", "d5"], "the untagged d5 is a present tile");
  assert.deepEqual(docs.tiles.filter(t => t.miss).map(t => t.name).sort(), ["Insurance cards", "Records (USB or printed)"]);
  const home = zones(kitHtml(app.run, "home"));
  // t3 has an empty tag: it shows, and the tools it could be stay missing
  const tools = home.find(z => z.label === "Tools & safety");
  assert.ok(tools.tiles.some(t => !t.miss && /data-id="t3"/.test(t.attrs)));
  assert.ok(tools.tiles.some(t => t.miss && t.name === "Duct tape"));
});

test("each dashed tile's +N is the checklist chip's gain, and tapping plans that line into the kit for exactly those points", () => {
  for (const fixture of ["tests/household", "fixtures/phone-width/long-essentials", "fixtures/data-and-account-shapes/essential-tags", "fixtures/empty-and-one/big-household"]) {
    const app = load({ fixture });
    for (const kit of app.json("S.kits.map(k => k.id)")) {
      const chips = chipGains(app, kit);
      for (const t of dashed(kitHtml(app.run, kit))) {
        const where = `${fixture} ${kit} ${t.name}`;
        assert.ok(chips.has(t.name), `${where}: the checklist has it`);
        assert.equal(t.gain ? parseInt(t.gain, 10) : 0, chips.get(t.name), `${where}: same points as the chip`);
        if (t.gain) assert.match(t.gain, /^\+(1 pt|[1-9]\d* pts)$/);
      }
    }
  }
  const app = load({ fixture: "tests/household" });
  let checked = 0;
  for (const kit of ["go", "home", "car"]) {
    for (;;) {
      const t = dashed(kitHtml(app.run, kit)).find(t => t.button?.dataset.act === "shopAdd" && t.gain);
      if (!t) break;
      const before = app.json("shopItems()").length;
      const want = parseInt(t.gain, 10);
      app.run(`ACT[${JSON.stringify(t.button.dataset.act)}](${JSON.stringify({ dataset: t.button.dataset })})`);
      const after = app.json("shopItems()");
      assert.equal(after.length, before + 1, `${t.name}: one line`);
      const line = after.at(-1);
      assert.equal(line.cat, t.button.dataset.cat);
      assert.equal(line.essential, t.button.dataset.essential);
      assert.equal(t.button.dataset.kit, kit, `${t.name}: the button names its kit`);
      assert.equal(line.kitId, kit, `${t.name}: planned into the kit it was tapped in`);
      app.run(`globalThis.LINE = shopItems().at(-1); S.shopping = { items: shopItems().slice(0, -1) }`);
      assert.equal(app.run("(() => { const M = model(); return scoreIfShopped(M, [LINE]) - M.overall; })()"), want, `${t.name}: ticking it adds the points shown`);
      app.run("S.shopping = { items: [...shopItems(), LINE] }");
      checked++;
    }
  }
  assert.ok(checked >= 3, "some tiles were tapped");
});

test("a dashed tile's button is Plan, named for the essential and the kit, and once planned it says so", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`globalThis.WRITES = []; setDoc = ((s) => (...a) => { WRITES.push(a); return s(...a); })(setDoc)`);
  const t = dashed(kitHtml(app.run, "home")).find(t => t.name === "Fire blanket");
  assert.ok(t && t.button, "Fire blanket is a button");
  assert.deepEqual(t.button.dataset, { act: "shopAdd", cat: "fire_safety", essential: "fire_blanket", kit: "home" });
  assert.equal(t.button.label, "Plan Fire blanket for Basement bin");
  assert.equal((t.body.match(/<button/g) || []).length, 1, "one button");
  app.run(`ACT.shopAdd(${JSON.stringify({ dataset: t.button.dataset })})`);
  assert.deepEqual(app.json("WRITES").map(w => [w[0], w[1]]), [["household", "shopping"]]);
  assert.deepEqual(app.json("shopItems()").filter(e => e.essential === "fire_blanket").map(e => e.kitId), ["home"]);

  const again = dashed(kitHtml(app.run, "home")).find(t => t.name === "Fire blanket");
  assert.ok(again.button, "planned for this kit, it is a button");
  assert.deepEqual(again.button.dataset, { act: "flEdit", id: app.json("shopItems()[0].id") }, "that opens its line, and plans nothing");
  assert.equal((again.body.match(/<button/g) || []).length, 1, "one button");
  assert.match(again.all, /Planned · \$20\b/);
  assert.equal(app.json("shopItems()").filter(e => e.essential === "fire_blanket").length, 1, "rendering again adds nothing");
  // The checklist and the tile agree
  assert.match(app.run(`(() => { const M = model(); return kitChecklist(S.kits[1], M.kitRes.home, M); })()`), /Fire blanket/);
});

test("with two people on daily medication, tapping one prescriptions tile leaves the other to plan", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.items = S.items.filter(i => i.category !== "medications"); S.profile.members[0].conditions = ["meds"]`);
  const rx = () => dashed(kitHtml(app.run, "go")).filter(t => /^Prescriptions/.test(t.name));
  const [a] = rx();
  app.run(`ACT.shopAdd(${JSON.stringify({ dataset: a.button.dataset })})`);
  const now = rx();
  assert.equal(now.filter(t => t.button?.dataset.act === "shopAdd").length, 1);
  assert.equal(now.filter(t => /Planned/.test(t.all)).length, 1);
});

test("with several people on daily medication, every prescriptions tap plans the tile tapped and flips that tile", () => {
  const cases = [["tests/household", `S.items = S.items.filter(i => i.category !== "medications"); S.profile.members[0].conditions = ["meds"]`],
    ["fixtures/empty-and-one/big-household", ""]];
  for (const [fixture, setup] of cases) {
    const app = load({ fixture });
    if (setup) app.run(setup);
    for (const kit of app.json("S.kits.map(k => k.id)")) {
      const rx = () => dashed(kitHtml(app.run, kit)).filter(t => /^Prescriptions \(\d+ of \d+\)$/.test(t.name));
      if (rx().length < 2) continue;
      app.run("S.shopping = { items: [] }");
      for (let taps = 0; ; taps++) {
        const now = rx(), listed = now.filter(t => /Planned/.test(t.all)).map(t => t.name);
        const t = now.find(t => t.button?.dataset.act === "shopAdd");
        if (!t) {
          assert.equal(listed.length, now.length, `${fixture} ${kit}: every prescriptions tile ends up on the list`);
          assert.ok(taps >= 2, `${fixture} ${kit}: tapped more than one`);
          break;
        }
        // Every tile that can be tapped flips itself, so try each one, last first
        for (const b of now.filter(x => x.button?.dataset.act === "shopAdd").reverse()) {
          const where = `${fixture} ${kit} ${b.name}`;
          app.run(`globalThis.SAVED = S.shopping; ACT.shopAdd(${JSON.stringify({ dataset: b.button.dataset })})`);
          assert.equal(app.json("shopItems().at(-1).name"), b.name, `${where}: the new line is the tile tapped`);
          const after = rx(), me = after.find(x => x.name === b.name);
          assert.match(me.all, /Planned · /, `${where}: the tile tapped reads Planned`);
          assert.equal(me.button?.dataset.act, "flEdit", `${where}: and no longer plans`);
          for (const n of listed) assert.match(after.find(x => x.name === n).all, /Planned/, `${where}: ${n} stays planned`);
          app.run("S.shopping = SAVED");
        }
        app.run(`ACT.shopAdd(${JSON.stringify({ dataset: t.button.dataset })})`);
      }
    }
  }
});

test("a missing essential that is no household gap shows no plan", () => {
  const app = load({ fixture: "tests/household" });
  // Every gap the household has for fire safety is covered: the home kit's fire blanket counts nowhere else
  const noGap = app.json(`(() => { const M = model(); return Object.entries(M.kitRes).flatMap(([k, r]) => r.rows.filter(row => row.ess)
    .flatMap(row => row.ess.filter(e => !e.have && !essGap(M, row.cat, e)).map(e => [k, e.label]))); })()`);
  assert.ok(noGap.length, "the household has a kit-only miss");
  for (const [kit, label] of noGap) {
    const t = dashed(kitHtml(app.run, kit)).find(t => t.name === label);
    assert.ok(t, `${kit} ${label}`);
    assert.equal(t.button, null, `${kit} ${label}: no add`);
    assert.equal(t.gain, "", `${kit} ${label}: no points`);
    assert.doesNotMatch(t.all, /Planned/);
  }
});

test("read-only viewers see the dashed tiles with no button", () => {
  for (const fixture of ["tests/household", "fixtures/phone-width/long-essentials"]) {
    const app = load({ fixture });
    app.run("S.canWrite = false");
    for (const kit of app.json("S.kits.map(k => k.id)")) {
      const ts = dashed(kitHtml(app.run, kit));
      assert.equal(ts.length, missing(app, kit).length, `${fixture} ${kit}`);
      for (const t of ts) assert.doesNotMatch(t.body, /<button|data-act/, `${fixture} ${kit} ${t.name}`);
    }
  }
});

test("an empty kit's Contents panel shows only dashed tiles", () => {
  const app = load({ fixture: "fixtures/empty-and-one/new-household" });
  app.run(`S.kits.push({ id: "e", name: "New bag", type: "go", createdAt: 1 }, { id: "h", name: "New bin", type: "home", createdAt: 2 })`);
  for (const kit of ["e", "h"]) {
    const html = kitHtml(app.run, kit);
    const ts = zones(html).flatMap(z => z.tiles);
    assert.ok(ts.length > 0, `${kit}: shows what to get`);
    assert.ok(ts.every(t => t.miss), `${kit}: only dashed tiles`);
    assert.equal(ts.length, missing(app, kit).length);
  }
});

test("at 390px kits with many missing essentials don't scroll sideways and keep 4 tiles a row", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const fixtures = ["fixtures/phone-width/long-essentials", "fixtures/empty-and-one/big-household", "fixtures/empty-and-one/new-household"];
  const seen = atPhoneWidth(fixtures, withStates(plan => {
    if (!S.kits.length) S.kits.push({ id: "e", name: "New bag", type: "go", createdAt: 1 }, { id: "h", name: "New bin", type: "home", createdAt: 2 });
    S.profile = S.profile || {};
    return [false, true].flatMap(planned => { plan(planned); return S.kits.map(k => {
      S.view = "kits"; S.openKit = k.id; render();
      const miss = [...document.querySelectorAll("#v-kits .fl-tile.miss")];
      const grids = [...document.querySelectorAll("#v-kits section.fl-zone .fl-grid")].map(g => {
        const ts = [...g.querySelectorAll(".fl-tile")].map(t => t.getBoundingClientRect());
        return { n: ts.length, firstRow: ts.filter(r => Math.abs(r.top - ts[0].top) < 1).length };
      });
      return {
        kit: k.name + (planned ? ", planned" : ""), width: innerWidth, scroll: document.documentElement.scrollWidth, n: miss.length, grids,
        states: miss.filter(t => /Planned/.test(t.textContent)).length,
        inside: miss.every(t => { const r = t.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }),
        whole: miss.every(t => [...t.querySelectorAll(".fl-name, .gain, .fl-note")].every(n => n.scrollWidth <= n.clientWidth + 1)),
        fills: miss.every(t => { const b = t.querySelector("button"); if (!b) return true; const r = t.getBoundingClientRect(), q = b.getBoundingClientRect(); return q.width >= r.width - 3 && q.height >= r.height - 3; }),
      };
    }); });
  }));
  let n = 0, states = 0;
  for (const f of fixtures) {
    const kits = seen.get(f);
    assert.ok(kits && kits.length, `${f}: no kits measured`);
    for (const k of kits) {
      const where = `${f}, ${k.kit}`;
      assert.equal(k.width, 390, where);
      assert.ok(k.scroll <= k.width, `${where}: scrolls sideways (${k.scroll}px wide)`);
      assert.ok(k.inside, `${where}: a dashed tile is off screen`);
      assert.ok(k.whole, `${where}: a dashed tile's text runs wider than the tile`);
      assert.ok(k.fills, `${where}: a dashed tile's button doesn't fill the tile`);
      for (const g of k.grids) assert.equal(g.firstRow, Math.min(4, g.n), `${where}: a zone of ${g.n} shows ${g.firstRow} in its first row`);
      n += k.n; states += k.states;
    }
  }
  assert.ok(n > 0, "dashed tiles were measured");
  assert.ok(states > 10, "planned tiles were measured");
});

test("at 390px every dashed tile shows its whole label and note, breaking inside a word only when the word is wider than the tile", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const fixtures = ["tests/household", "fixtures/phone-width/long-essentials", "fixtures/empty-and-one/big-household"];
  const seen = atPhoneWidth(fixtures, withStates(plan => {
    const out = [];
    for (const planned of [false, true]) for (const k of S.kits) {
      plan(planned);
      S.view = "kits"; S.openKit = k.id; render();
      for (const n of document.querySelectorAll("#v-kits .fl-tile.miss :is(.fl-name, .fl-note)")) {
        // Each letter of the label, across its text nodes, with the line it sits on. A label may break at a space, after
        // a hyphen or soft hyphen, and where a <wbr> splits its text: each piece between those that fits on a line stays whole.
        const r = document.createRange(), pieces = [[]], probe = document.createElement("span");
        for (const t of [...n.childNodes].filter(c => c.nodeType === 3)) {
          if (pieces.at(-1).length) pieces.push([]);
          for (let i = 0; i < t.length; i++) {
            r.setStart(t, i); r.setEnd(t, i + 1);
            const ch = t.data[i];
            if (/\s/.test(ch)) { if (pieces.at(-1).length) pieces.push([]); continue; }
            // A letter just after a line break also reports an empty box at the end of the line before: take its own box
            const box = [...r.getClientRects()].filter(b => b.width > 0).at(-1) || r.getBoundingClientRect();
            pieces.at(-1).push([ch, Math.round(box.top)]);
            if (ch === "-" || ch === "\u00ad") pieces.push([]);
          }
        }
        const label = n.textContent.replace(/\u00ad/g, "");
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
        n.appendChild(probe);
        const split = [];
        for (const p of pieces.filter(p => p.length)) {
          probe.textContent = p.map(c => c[0]).join("").replace(/\u00ad/g, "");
          if (probe.getBoundingClientRect().width <= n.clientWidth && new Set(p.map(c => c[1])).size > 1) split.push(probe.textContent);
        }
        probe.remove();
        out.push({ where: `${k.name}${planned ? ", planned" : ""}: ${label}`, clipped: n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1, split });
      }
    }
    return out;
  }));
  let n = 0;
  for (const f of fixtures) {
    const names = seen.get(f);
    assert.ok(names && names.length, `${f}: no dashed tiles measured`);
    for (const x of names) {
      assert.ok(!x.clipped, `${f}, ${x.where}: the label is cut off`);
      assert.deepEqual(x.split, [], `${f}, ${x.where}: a word that fits on a line breaks between letters`);
      n++;
    }
  }
  assert.ok(n > 40, "dashed tiles were measured");
});
