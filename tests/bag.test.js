// The Weight and space panel's bag (issue #64): one bag outline filled with the kit's items, one band per item
// sized from packPlan's lines, coloured by its zone in ZONES, biggest at the bottom, with a Space | Weight toggle
// that opens on the fuller measure and that nothing remembers.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT, PAGE } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");

const scenarios = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = html => unesc(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
const attr = (attrs, name) => { const m = attrs.match(new RegExp(`${name}="([^"]*)"`)); return m ? unesc(m[1]) : undefined; };
const px = (attrs, prop) => { const m = (attr(attrs, "style") || "").match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([\\d.]+)px`)); return m ? +m[1] : undefined; };

// The bag in a piece of HTML: its label, whether it is over, its height and its body's (the outline up to the rim),
// each band (value, item id, member count, zone index, label), the free band's and the over band's text.
function bag(html) {
  const m = html.match(/<div class="bag\b([^"]*)"([^>]*)>/);
  if (!m) return null;
  const bands = [...html.matchAll(/<div class="bag-b\b([^"]*)"([^>]*)>([\s\S]*?)<\/div>/g)].map(([, cls, attrs, body]) => ({
    v: +attr(attrs, "data-v"), id: attr(attrs, "data-id"), n: +(attr(attrs, "data-n") || 1), small: attr(attrs, "data-n") != null,
    zone: ((attr(attrs, "style") || "").match(/--c:\s*var\(--zone-(\d+)\)/) || [])[1], h: px(attrs, "height"), label: text(body), body,
  }));
  const free = html.match(/<div class="bag-free"[^>]*>([\s\S]*?)<\/div>/), over = html.match(/<div class="bag-over"([^>]*)>([\s\S]*?)<\/div>/);
  const body = html.match(/<div class="bag-body"([^>]*)>/);
  return {
    cls: m[1].trim().split(/\s+/).filter(Boolean), role: attr(m[2], "role"), label: attr(m[2], "aria-label"), h: px(m[2], "height"),
    bodyH: body && px(body[1], "height"), bands, free: free && text(free[1]), over: over && { text: text(over[2]), h: px(over[1], "height") },
  };
}
const buttons = html => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, body]) => ({
  label: text(body), dataset: Object.fromEntries([...attrs.matchAll(/data-([a-z]+)="([^"]*)"/g)].map(m => [m[1], unesc(m[2])])), pressed: attr(attrs, "aria-pressed"),
}));
const toggle = html => buttons(html).filter(b => b.label === "Space" || b.label === "Weight");
const pressed = html => toggle(html).filter(b => b.pressed === "true").map(b => b.label);
const press = (app, html, label) => {
  const b = toggle(html).find(b => b.label === label && b.dataset.act);
  assert.ok(b, `a "${label}" button`);
  app.run(`ACT[${JSON.stringify(b.dataset.act)}](${JSON.stringify({ dataset: b.dataset })})`);
};
// The open kit's Kits tab, after opening it the way a tap on its card does.
const open = (app, id) => { app.run(`ACT.openKit({ dataset: { id: ${JSON.stringify(id)} } })`); return kitsTab(app); };
const kitsTab = app => app.run(`S.view = "kits"; viewKits(model())`);
const plan = (app, id) => app.json(`(() => { const M = model(), k = S.kits.find(k => k.id === ${JSON.stringify(id)}), r = M.kitRes[k.id], lim = kitLimits(k, r.h);
  const P = packPlan(k, r, lim); return { lim, g: P.g, ml: P.ml, lines: P.lines.map(l => ({ id: l.it.id, cat: l.it.category, g: l.g, ml: l.ml })) }; })()`);
// The measures a kit's bag can show, as [toggle label, packPlan field, unit].
const MEASURES = { Space: ["ml", "L"], Weight: ["g", "lb"] };

test("on every go-bag and car kit the bands add up to packPlan's load, each in its category's zone", () => {
  let checked = 0;
  for (const fixture of scenarios) {
    const app = load({ fixture });
    const Z = app.json("ZONES"), zoneIx = c => { const i = Z.findIndex(z => z.cats.includes(c)); return i < 0 ? Z.length - 1 : i; };
    for (const kit of app.json(`S.kits.filter(k => k.type === "go" || k.type === "car").map(k => k.id)`)) {
      const P = plan(app, kit), where = `${fixture} ${kit}`;
      let html = open(app, kit);
      if (!P.lines.length) { assert.equal(bag(html), null, `${where}: an empty kit has no bag`); continue; }
      const shown = P.lim.kg ? ["Space", "Weight"] : ["Space"];
      for (const label of shown) {
        if (toggle(html).length) { press(app, html, label); html = kitsTab(app); }
        const b = bag(html), [f] = MEASURES[label];
        assert.ok(b, `${where}: a bag`);
        assert.deepEqual(pressed(html), toggle(html).length ? [label] : [], `${where}: ${label} is the one pressed`);
        const sum = b.bands.reduce((a, x) => a + x.v, 0);
        assert.ok(Math.abs(sum - P[f]) <= P.lines.length, `${where} ${label}: bands add to ${sum}, packPlan says ${P[f]}`);
        assert.equal(b.bands.reduce((a, x) => a + x.n, 0), P.lines.length, `${where} ${label}: every item is in one band`);
        assert.ok(b.bands.filter(x => x.small).length <= 1, `${where} ${label}: one small-items band at most`);
        for (const x of b.bands) {
          assert.ok(Number.isFinite(x.v) && x.v >= 0, `${where}: band value ${x.v}`);
          if (x.small) { assert.match(x.label, new RegExp(`^${x.n} small items?\\b`), `${where}: "${x.label}"`); continue; }
          const line = P.lines.find(l => l.id === x.id);
          assert.ok(line, `${where}: band ${x.id} is an item of the kit`);
          assert.equal(+x.zone, zoneIx(line.cat), `${where}: ${x.id}'s colour is its zone's`);
          assert.equal(x.v, Math.round(line[f]), `${where}: ${x.id} is sized by its load`);
        }
        const sized = b.bands.filter(x => !x.small).map(x => x.v);
        assert.deepEqual(sized, [...sized].sort((a, c) => c - a), `${where} ${label}: biggest first in the markup, which is the bottom`);
        assert.doesNotMatch(html.slice(html.indexOf('<div class="bag')), /NaN|undefined|Infinity|\[object/, where);
        checked++;
      }
    }
  }
  assert.ok(checked >= 6, `only ${checked} bags checked`);
});

test("saved grams and ml size a band over the estimate, and changing ml changes it by exactly that", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`Object.assign(S.items.find(i => i.id === "i4"), { grams: 9000, ml: 20000 });`);
  const band = (label, id) => { const h = open(app, "go"); press(app, h, label); return bag(kitsTab(app)).bands.find(x => x.id === id); };
  const est = app.json(`itemLoad({ ...S.items.find(i => i.id === "i4"), grams: 0, ml: 0 })`);
  assert.notEqual(est.ml, 20000);
  assert.equal(band("Space", "i4").v, 20000);
  assert.equal(band("Weight", "i4").v, 9000);
  app.run(`S.items.find(i => i.id === "i4").ml = 26500;`);
  assert.equal(band("Space", "i4").v - 20000, 6500);
  assert.match(band("Space", "i4").label, /26[.,]5 L/);
});

test("a go-bag over its carry limit rises above the rim in the over class; one that fits shows what's to spare", () => {
  const app = load({ fixture: "tests/household" });
  let b = bag((h => (press(app, h, "Weight"), kitsTab(app)))(open(app, "go")));
  assert.ok(!b.cls.includes("over") && !b.over, "the household's go-bag fits");
  assert.match(b.free, /^[\d.,]+ lb to spare$/);
  app.run(`S.items.push(
    { id: "w1", kitId: "go", name: "Water bottles", category: "water", qty: 24, liters: 12 },
    { id: "w2", kitId: "go", name: "Gallon jugs", category: "water", qty: 4, liters: 15 },
    { id: "f1", kitId: "go", name: "Canned chili", category: "food", qty: 10, kcal: 4000 });`);
  const P = plan(app, "go");
  b = bag((h => (press(app, h, "Weight"), kitsTab(app)))(open(app, "go")));
  assert.ok(b.cls.includes("over"), "the bag is in the over class");
  assert.match(b.over.text, /^[\d.,]+ lb over$/);
  const lb = +b.over.text.replace(/[^\d.]/g, "");
  assert.ok(Math.abs(lb - (P.g - P.lim.kg * 1000) / 453.59237) <= 0.05, `${lb} lb over`);
  assert.ok(b.over.h > 0 && b.h > b.bodyH && Math.abs(b.h - b.bodyH - b.over.h) <= 1, "the over band sits above the rim");
  assert.equal(b.free, null, "no free band when over");
  // Space still fits in 40 L, and shows what's free
  b = bag((h => (press(app, h, "Space"), kitsTab(app)))(kitsTab(app)));
  assert.match(b.free || "", /^[\d.,]+ L free$/);
});

test("a car kit shows Space only; a go-bag opens on its fuller measure, and nothing remembers the choice", () => {
  const app = load({ fixture: "tests/household" });
  let car = open(app, "car");
  assert.deepEqual(toggle(car).filter(b => b.dataset.act), [], "no toggle on a car kit");
  assert.match(bag(car).label, / L packed$/);
  // The household's go-bag: 3.6 of 40 L (9%) is fuller than 2.5 of 33 lb (8%)
  let go = open(app, "go");
  assert.deepEqual(toggle(go).map(b => b.label), ["Space", "Weight"]);
  assert.deepEqual(pressed(go), ["Space"]);
  press(app, go, "Weight");
  go = kitsTab(app);
  assert.deepEqual(pressed(go), ["Weight"]);
  assert.match(bag(go).label, / lb packed$/);
  // Opening another kit and coming back goes back to the fuller measure, by the card or by the Overview's link
  open(app, "car");
  assert.deepEqual(pressed(open(app, "go")), ["Space"]);
  press(app, kitsTab(app), "Weight");
  app.run(`ACT.gotoKit({ dataset: { id: "car" } }); ACT.gotoKit({ dataset: { id: "go" } })`);
  assert.deepEqual(pressed(kitsTab(app)), ["Space"]);
  // A lower carry limit makes Weight the fuller, so it opens there
  app.run(`S.kits.find(k => k.id === "go").carryKg = 3;`);
  open(app, "car");
  assert.deepEqual(pressed(open(app, "go")), ["Weight"]);
  // A go-bag with no carry limit (nobody can carry) shows Space only
  app.run(`S.profile.members = S.profile.members.map(m => ({ ...m, conditions: [], age: 2, birthYear: undefined })); delete S.kits.find(k => k.id === "go").carryKg;`);
  const P = plan(app, "go");
  if (P.lim.kg == null) {
    go = open(app, "go");
    assert.deepEqual(toggle(go).filter(b => b.dataset.act), [], "no Weight button without a carry limit");
    assert.match(bag(go).label, / L packed$/);
  }
  // A fresh load starts on the fuller measure too
  assert.equal(load({ fixture: "tests/household" }).json("S.bagM"), null);
});

test("the bag's label reads <have> of <limit> <unit> packed", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.kits.find(k => k.id === "go").carryKg = 9; S.kits.find(k => k.id === "go").bagL = 32.5;`);
  const P = plan(app, "go");
  const h = open(app, "go");
  const b = bag(h);
  assert.equal(b.role, "img");
  const f1 = n => (Math.round(n * 10) / 10).toLocaleString();
  const space = `${f1(P.ml / 1000)} of ${f1(32.5)} L packed`, weight = `${f1(P.g / 453.59237)} of ${f1(9 * 1000 / 453.59237)} lb packed`;
  press(app, h, "Space");
  assert.equal(bag(kitsTab(app)).label, space);
  press(app, kitsTab(app), "Weight");
  assert.equal(bag(kitsTab(app)).label, weight);
});

test("odd values render with no NaN, and a one-item kit draws one band and the free band", () => {
  const odd = load({ fixture: "fixtures/data-and-account-shapes/odd-values" });
  for (const kit of odd.json(`S.kits.map(k => k.id)`)) {
    let html = open(odd, kit);
    for (const label of ["Space", "Weight"]) {
      if (toggle(html).some(b => b.label === label)) { press(odd, html, label); html = kitsTab(odd); }
      assert.doesNotMatch(html, /NaN|undefined|Infinity/, `${kit} ${label}`);
    }
  }
  const one = load({ fixture: "fixtures/empty-and-one/one-person" });
  const kits = one.json(`S.kits.filter(k => (k.type === "go" || k.type === "car") && S.items.filter(i => i.kitId === k.id).length === 1).map(k => k.id)`);
  assert.ok(kits.length, "the fixture has a one-item go-bag or car kit");
  for (const kit of kits) {
    const b = bag(open(one, kit));
    assert.equal(b.bands.length, 1, `${kit}: one band`);
    assert.match(b.free, /^[\d.,]+ (L free|lb to spare)$/, `${kit}: the free band`);
  }
});

test("a category named like an Object property weighs as Other, so no band is NaN", () => {
  const { json } = load();
  for (const c of ["constructor", "toString", "__proto__"]) assert.deepEqual(json(`itemLoad({ category: ${JSON.stringify(c)}, qty: 2 })`), json(`itemLoad({ category: "other", qty: 2 })`), c);
});

test("item names in bands are escaped", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`Object.assign(S.items.find(i => i.id === "i4"), { name: '<img src=x onerror="alert(1)">&', ml: 30000 });`);
  const html = open(app, "go");
  const band = bag(html).bands.find(x => x.id === "i4");
  assert.ok(!/<img/.test(band.body), "no raw markup");
  assert.ok(band.label.startsWith('<img src=x onerror="alert(1)">&'), band.label);
});

test("Best pack, Take out and Lighter swaps read the same whichever measure the bag shows", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.items.push(
    { id: "w1", kitId: "go", name: "Water bottles", category: "water", qty: 24, liters: 12 },
    { id: "s1", kitId: "go", name: "Sleeping bag", category: "shelter", qty: 2 },
    { id: "l9", kitId: "go", name: "Lantern", category: "light", qty: 3 });`);
  const below = html => text(html.slice(html.indexOf("<p class=\"small muted\">Suggested")));
  const h = open(app, "go");
  press(app, h, "Space");
  const s = below(kitsTab(app));
  press(app, kitsTab(app), "Weight");
  const w = below(kitsTab(app));
  assert.equal(s, w);
  for (const part of ["Best pack within your limits", "Take out", "Lighter swaps"]) assert.ok(s.includes(part), part);
});

test("zone colours are tokens, defined once in :root, with no hex colour in the bag's styles and none added to the dark blocks", () => {
  const html = fs.readFileSync(PAGE, "utf8"), css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const blocks = [...css.matchAll(/:root(?:\[data-theme="dark"\]|:not\(\[data-theme="light"\]\))?\s*\{[^}]*\}/g)].map(m => m[0]);
  const [light, ...dark] = blocks;
  assert.ok(light.startsWith(":root {") && dark.length === 2, "the :root block and two dark blocks");
  const { json } = load(), n = json("ZONES.length");
  for (let i = 0; i < n; i++) assert.equal((light.match(new RegExp(`--zone-${i}:`, "g")) || []).length, 1, `--zone-${i} is defined once in :root`);
  assert.equal((css.match(/--zone-\d+:/g) || []).length, n, "no zone token is defined anywhere else");
  for (const d of dark) assert.doesNotMatch(d, /--zone/, "the dark blocks get no zone copy");
  const bagRules = [...css.matchAll(/[^{}]*\.bag[^{}]*\{[^}]*\}/g)].map(m => m[0]);
  assert.ok(bagRules.length >= 3, "the bag has its styles");
  for (const r of bagRules) assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, r.trim().split("{")[0]);
});

test("at 390px every kit with a bag shows it with height and nothing scrolls sideways", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const fixtures = ["tests/household", "fixtures/phone-width/long-essentials", "fixtures/empty-and-one/big-household"];
  const seen = atPhoneWidth(fixtures, () => S.kits.flatMap(k => ["ml", "g"].map(m => {
    S.view = "kits"; S.openKit = k.id; S.bagM = { id: k.id, m }; render();
    const b = document.querySelector("#v-kits .bag");
    return { kit: k.name + " " + m, items: S.items.some(i => i.kitId === k.id), limited: !!kitLimits(k, household()), h: b ? b.getBoundingClientRect().height : -1,
      inside: !b || [b, ...b.querySelectorAll("*")].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }),
      width: innerWidth, scroll: document.documentElement.scrollWidth };
  })));
  for (const f of fixtures) {
    const kits = seen.get(f);
    assert.ok(kits && kits.length, `${f}: no kits measured`);
    let bags = 0;
    for (const k of kits) {
      const where = `${f}, ${k.kit}`;
      assert.equal(k.width, 390, `${where}: the viewport isn't 390px`);
      assert.ok(k.scroll <= k.width, `${where}: scrolls sideways (${k.scroll}px wide)`);
      if (!k.limited || !k.items) continue;
      assert.ok(k.h > 0, `${where}: the bag has no height`);
      assert.ok(k.inside, `${where}: part of the bag is off screen`);
      bags++;
    }
    assert.ok(bags > 0, `${f}: no bag measured`);
  }
});
