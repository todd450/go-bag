// A bin or box drawn as a box (issue #101, part of #96): when a kit's container is kind "box", the Weight and space
// figure's root .bag gets the class `box`, and CSS draws it square-cornered with a lid across the top in place of
// the bag's handle. Every other kind, an unknown one and no container keep today's bag. Only the class differs:
// the bands, small items, free and over bands and the bag's own empty weight are the same inside a box.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");

const BOX = "fixtures/phone-width/box-container", ODD = "fixtures/data-and-account-shapes/odd-container";
const scenarios = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

const kit = id => `S.kits.find(k => k.id === ${JSON.stringify(id)})`;
const setContainer = (app, id, c) => app.run(`(k => { if (${c === undefined}) delete k.container; else k.container = ${JSON.stringify(c)}; })(${kit(id)})`);
// The kit's figure as bagFig draws it on measure m ("ml" space, "g" weight), or null where the panel has none.
const fig = (app, id, m) => app.run(`(k => { const r = kitReadiness(k, household(), model().active), lim = kitLimits(k, r.h);
  return lim && S.items.some(i => i.kitId === k.id) ? bagFig(packPlan(k, r, lim), lim, ${JSON.stringify(m)}) : null; })(${kit(id)})`);
// The measures a kit's figure shows: Weight only with a carry limit.
const measures = (app, id) => app.json(`kitLimits(${kit(id)}, household())?.kg`) ? ["ml", "g"] : ["ml"];
const rootClass = html => html.match(/^<div class="([^"]*)"/)[1].split(" ");
const noLabel = html => html.replace(/ aria-label="[^"]*"/, "");
// The figure as a plain bag: the box class taken off its root, and nothing else.
const unboxed = html => html.replace(/^<div class="bag box\b/, '<div class="bag');
const bandsOf = html => [...html.matchAll(/<div class="(bag-b\b[^"]*|bag-free|bag-over)"[^>]*>/g)].map(m => m[1]);
// The kits a figure is drawn for, in every scenario.
const figured = () => scenarios.flatMap(fixture => {
  const app = load({ fixture });
  return app.json(`S.kits.filter(k => kitLimits(k, household()) && S.items.some(i => i.kitId === k.id)).map(k => k.id)`).map(id => [fixture, id]);
});

test("a kit whose container is a bin or box draws its figure with the box class, in Space and in Weight", () => {
  const app = load({ fixture: "tests/household" });
  for (const id of ["go", "car"]) {
    setContainer(app, id, { kind: "box" });
    for (const m of measures(app, id)) assert.deepEqual(rootClass(fig(app, id, m)), ["bag", "box"], `${id} ${m}`);
  }
  assert.deepEqual(measures(app, "go"), ["ml", "g"], "the go-bag shows both measures");
  const box = load({ fixture: BOX });
  for (const id of ["go", "car"]) for (const m of measures(box, id)) assert.ok(rootClass(fig(box, id, m)).includes("box"), `${BOX} ${id} ${m}`);
  // The car's camp box is packed past its rim, so it is over and boxed at once
  assert.deepEqual(rootClass(fig(box, "car", "ml")), ["bag", "box", "over"]);
});

test("every other kind, an unknown kind and no container keep today's bag: no box class, the same figure as no container", () => {
  const odd = load({ fixture: ODD }), boat = odd.json(`${kit("c-boat")}.container`);
  assert.equal(boat.kind, "boat", "the odd fixture's unknown kind");
  // Kinds the page does not know, and shapes of kind that only look like "box", are never a box
  const others = [{ kind: "backpack" }, { kind: "duffel" }, { kind: "other" }, boat, { kind: "Box" }, { kind: " box" }, { kind: ["box"] },
    { kind: { toString: "box" } }, { kind: 'box" onclick="alert(1)' }, {}, null, "box", [{ kind: "box" }]];
  let checked = 0;
  for (const [fixture, id] of figured()) {
    const app = load({ fixture });
    setContainer(app, id, undefined);
    const plain = Object.fromEntries(measures(app, id).map(m => [m, fig(app, id, m)]));
    for (const c of others) for (const m of Object.keys(plain)) {
      setContainer(app, id, c);
      const html = fig(app, id, m), where = `${fixture} ${id} ${m} ${JSON.stringify(c)}`;
      assert.ok(!rootClass(html).includes("box"), `${where}: no box class`);
      // #99's label names the container; everything else is the figure with no container, byte for byte
      assert.equal(noLabel(html), noLabel(plain[m]), where);
      checked++;
    }
  }
  assert.ok(checked > 100, `only ${checked} figures checked`);
});

test("the stored kind is only compared, never written into the figure", () => {
  const app = load({ fixture: "tests/household" });
  for (const kind of ['box" onclick="alert(1)', "<img src=x>", "boat", "box"]) {
    setContainer(app, "go", { kind, name: "Tote" });
    for (const m of ["ml", "g"]) {
      const html = fig(app, "go", m);
      if (kind !== "box") assert.ok(!html.includes(kind), `${kind} ${m}: not in the markup`);
      assert.match(html, /^<div class="bag( box)?( over)?" role="img"/, `${kind} ${m}`);
    }
  }
});

test("a home kit still has no figure, even with a bin or box saved on it", () => {
  for (const [fixture, id] of [["tests/household", "home"], [BOX, "home"], [ODD, "c-home"]]) {
    const app = load({ fixture });
    setContainer(app, id, { kind: "box", name: "Garage tote", emptyG: 2000 });
    assert.equal(fig(app, id, "ml"), null, `${fixture} ${id}: no limits`);
    app.run(`S.view = "kits"; ACT.openKit({ dataset: { id: ${JSON.stringify(id)} } })`);
    assert.doesNotMatch(app.run(`viewKits(model())`), /class="bag\b/, `${fixture} ${id}: no figure on its page`);
  }
});

test("inside a box the bands, small items, free and over bands and the bag's own weight are a bag's, and only the class differs", () => {
  // Every kit of every scenario, boxed and as each other kind, with the same name and empty weight
  let checked = 0;
  for (const [fixture, id] of figured()) {
    const app = load({ fixture });
    for (const emptyG of [0, 1600]) for (const m of measures(app, id)) {
      setContainer(app, id, { kind: "box", name: "Camp box", emptyG });
      const box = fig(app, id, m);
      for (const kind of ["backpack", "duffel", "other"]) {
        setContainer(app, id, { kind, name: "Camp box", emptyG });
        assert.equal(unboxed(box), fig(app, id, m), `${fixture} ${id} ${m} ${emptyG} g: a ${kind} of the same size`);
        checked++;
      }
    }
  }
  assert.ok(checked > 50, `only ${checked} figures checked`);
  // The fixture's boxes show each band a bag can have: over the rim with small items merged, and by weight the
  // bin's own band at the bottom (first in the stack, which stacks bottom up) with what's to spare above
  const app = load({ fixture: BOX });
  const car = fig(app, "car", "ml"), go = fig(app, "go", "g");
  assert.match(car, /<div class="bag-over"[^>]*><span>[\d.,]+ L over<\/span>/);
  assert.match(car, /data-n="\d+"[^>]*><span class="ell">\d+ small items<\/span>/);
  assert.doesNotMatch(car, /bag-free/, "no free band when over");
  assert.equal(bandsOf(go)[0], "bag-b bag-own", "the bin's empty weight is the bottom band");
  assert.match(go, /<span class="ell">Latching tote<\/span>/);
  assert.equal(bandsOf(go).at(-1), "bag-free");
  assert.match(go, /<div class="bag-free">[\d.,]+ lb to spare<\/div>/);
  assert.doesNotMatch(fig(app, "go", "ml"), /bag-own/, "no empty-weight band by space");
});

test("the box styles draw a square body, a lid across the top and a stack to match, from tokens only", () => {
  const css = fs.readFileSync(path.join(ROOT, "emergency-kit-audit.html"), "utf8").match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const sel of [".bag.box .bag-body", ".bag.box .bag-body::before", ".bag.box .bag-st"]) {
    const rule = css.match(new RegExp(`(?:^|\\n|[},])\\s*${sel.replace(/[.()]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    assert.ok(rule, `a ${sel} rule`);
    assert.doesNotMatch(rule[1], /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, `${sel}: colours come from tokens`);
  }
});

// What the phone-width run in tests/bag.test.js measures, for every kit and measure of a household
const measureBags = () => S.kits.flatMap(k => ["ml", "g"].map(m => {
  S.view = "kits"; S.openKit = k.id; S.bagM = { id: k.id, m }; render();
  const b = document.querySelector("#v-kits .bag"), panel = b && b.closest(".panel"), within = (r, o) => r.left >= o.left && r.right <= o.right && r.top >= o.top;
  const body = b && b.querySelector(".bag-body"), lid = body && getComputedStyle(body, "::before"), over = b && b.querySelector(".bag-over span");
  return { kit: k.name + " " + m, items: S.items.some(i => i.kitId === k.id), limited: !!kitLimits(k, household()), h: b ? b.getBoundingClientRect().height : -1,
    inside: !b || [b, ...b.querySelectorAll("*")].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }),
    width: innerWidth, scroll: document.documentElement.scrollWidth, box: !!b && b.classList.contains("box"),
    // The lid's sides, from the body's: it spans the full top and stays inside the panel
    lid: lid && { left: parseFloat(lid.left), right: parseFloat(lid.right), width: parseFloat(lid.width), body: body.getBoundingClientRect().width,
      inPanel: (r => r.left + parseFloat(lid.left) >= panel.getBoundingClientRect().left && r.right - parseFloat(lid.right) <= panel.getBoundingClientRect().right)(body.getBoundingClientRect()) },
    corner: body && parseFloat(getComputedStyle(body).borderBottomLeftRadius),
    over: over && { inPanel: within(over.getBoundingClientRect(), panel.getBoundingClientRect()), text: over.textContent } };
}));

test("at 390px the boxed figures show with height, never scroll sideways, and the over label and lid stay in the panel", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const kits = atPhoneWidth([BOX], measureBags).get(BOX);
  assert.ok(kits && kits.length, "no kits measured");
  let boxes = 0, overs = 0;
  for (const k of kits) {
    assert.equal(k.width, 390, `${k.kit}: the viewport isn't 390px`);
    assert.ok(k.scroll <= k.width, `${k.kit}: scrolls sideways (${k.scroll}px wide)`);
    if (!k.limited || !k.items) { assert.equal(k.h, -1, `${k.kit}: no figure`); continue; }
    assert.ok(k.h > 0, `${k.kit}: the box has no height`);
    assert.ok(k.inside, `${k.kit}: part of the box is off screen`);
    assert.ok(k.box, `${k.kit}: drawn as a box`);
    assert.ok(k.corner <= 4, `${k.kit}: square-cornered (${k.corner}px)`);
    assert.ok(k.lid.left <= 0 && k.lid.right <= 0 && k.lid.width >= k.lid.body, `${k.kit}: the lid spans the top (${JSON.stringify(k.lid)})`);
    assert.ok(k.lid.inPanel, `${k.kit}: the lid stays in the panel`);
    boxes++;
    if (k.over) { assert.ok(k.over.inPanel, `${k.kit}: "${k.over.text}" is outside the panel`); overs++; }
  }
  assert.ok(boxes >= 3 && overs >= 1, `${boxes} boxes, ${overs} over`);
});

test("at 390px a bag keeps its handle: the lid is the box's alone", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const kits = atPhoneWidth(["tests/household"], measureBags).get("tests/household").filter(k => k.limited && k.items);
  assert.ok(kits.length >= 2, "the household's bags");
  for (const k of kits) {
    assert.ok(!k.box, `${k.kit}: a bag`);
    assert.ok(k.lid.width < k.lid.body / 2 && k.corner > 4, `${k.kit}: the bag's handle and round corners (${JSON.stringify(k.lid)}, ${k.corner}px)`);
  }
});
