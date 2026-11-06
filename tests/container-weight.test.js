// The container's empty weight (issue #99, part of #96): kits keep one optional `container` object, read only by
// containerOf, and the Weight and space panel counts the bag's own empty weight against the carry limit. Nothing
// writes `container` yet, so a kit without one renders exactly as before.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");

const ODD = "fixtures/data-and-account-shapes/odd-container";
const LB_G = 453.59237;
const scenarios = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = html => unesc(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
const attr = (attrs, name) => { const m = attrs.match(new RegExp(`${name}="([^"]*)"`)); return m ? unesc(m[1]) : undefined; };
// The bag figure in a panel: its raw and read aria-label, its bands from the bottom up, and its over and free text.
function bag(html) {
  const m = html.match(/<div class="bag\b[^"]*"([^>]*)>/);
  if (!m) return null;
  const bands = [...html.matchAll(/<div class="bag-b\b([^"]*)"([^>]*)>([\s\S]*?)<\/div>/g)].map(([, cls, attrs, body]) => ({
    cls: cls.trim(), v: +attr(attrs, "data-v"), id: attr(attrs, "data-id"), small: attr(attrs, "data-n") != null,
    style: attr(attrs, "style") || "", label: text(body), body,
  }));
  const over = html.match(/<div class="bag-over"[^>]*>([\s\S]*?)<\/div>/), free = html.match(/<div class="bag-free"[^>]*>([\s\S]*?)<\/div>/);
  return { rawLabel: m[1].match(/aria-label="([^"]*)"/)[1], label: attr(m[1], "aria-label"), bands, over: over && text(over[1]), free: free && text(free[1]) };
}
const setContainer = (app, id, c) => app.run(`(k => { if (${c === undefined}) delete k.container; else k.container = ${JSON.stringify(c ?? null)}; })(S.kits.find(k => k.id === ${JSON.stringify(id)}))`);
// The kit's Weight and space panel, on measure m ("g" weight, "ml" space, or null for the default).
const panel = (app, id, m = null) => app.run(`(k => { S.bagM = ${JSON.stringify(m)} && { id: k.id, m: ${JSON.stringify(m)} };
  return packPanel(k, kitReadiness(k, household(), model().active)); })(S.kits.find(k => k.id === ${JSON.stringify(id)}))`);
const plan = (app, id) => app.json(`(k => { const r = kitReadiness(k, household(), model().active), lim = kitLimits(k, r.h), P = packPlan(k, r, lim);
  return { lim, fits: P.fits, g: P.g, ml: P.ml, bagG: P.bagG, best: P.best && { g: P.best.g, ml: P.best.ml, score: P.best.score, keep: P.best.keep }, score: P.score }; })(S.kits.find(k => k.id === ${JSON.stringify(id)}))`);
const NAME = "Highland Tactical Major";

test("the pass mark: a go-bag that fits by 1 lb is 1 lb over with a 2 lb bag, and Best pack fits the bag in", () => {
  const app = load({ fixture: "tests/household" });
  const { g } = plan(app, "go");
  app.run(`S.kits.find(k => k.id === "go").carryKg = ${(g + LB_G) / 1000};`);
  // With no container it fits, as on main
  let P = plan(app, "go"), b = bag(panel(app, "go", "g"));
  assert.equal(P.fits, true);
  assert.equal(P.best, null);
  assert.equal(b.over, null);
  assert.match(b.free, /^1 lb to spare$/);
  // A 2 lb (907 g) bag puts it 1 lb over
  setContainer(app, "go", { kind: "backpack", name: NAME, emptyG: 907 });
  P = plan(app, "go"); b = bag(panel(app, "go", "g"));
  assert.equal(P.bagG, 907);
  assert.equal(P.fits, false);
  assert.equal(P.g, g, "P.g stays item weight only");
  assert.equal(b.over, "1 lb over");
  assert.ok(P.best, "a best pack");
  assert.ok(P.best.g + 907 <= P.lim.kg * 1000 + 1e-6, `best ${P.best.g} g + 907 g fits ${P.lim.kg * 1000} g`);
  assert.ok(P.best.g < g, "it leaves something out");
});

test("kitLimits adds container and emptyG and keeps every other field", () => {
  const app = load({ fixture: "tests/household" });
  const before = app.json(`kitLimits(S.kits.find(k => k.id === "go"), household())`);
  assert.equal(before.container, null);
  assert.equal(before.emptyG, 0);
  setContainer(app, "go", { kind: "duffel", name: NAME, emptyG: 1200, size: "19 × 12.5 × 7.5 in", rating: "IP65" });
  const after = app.json(`kitLimits(S.kits.find(k => k.id === "go"), household())`);
  assert.deepEqual(after.container, { kind: "duffel", name: NAME, emptyG: 1200, size: "19 × 12.5 × 7.5 in", rating: "IP65" });
  assert.equal(after.emptyG, 1200);
  const rest = ({ container, emptyG, ...r }) => r;
  assert.deepEqual(rest(after), rest(before));
  // Home supplies have no limits, container or not
  setContainer(app, "home", { kind: "box", emptyG: 2000 });
  assert.equal(app.json(`kitLimits(S.kits.find(k => k.id === "home"), household())`), null);
  assert.equal(app.json(`containerOf(S.kits.find(k => k.id === "home"))`), null);
});

test("containerOf reads the odd containers without throwing, and normalises each value", () => {
  const app = load({ fixture: ODD });
  const all = app.json(`Object.fromEntries(S.kits.map(k => [k.id, containerOf(k)]))`);
  assert.equal(all["c-null"], null);
  assert.equal(all["c-array"], null, "an array is not a container");
  assert.equal(all["c-string"], null, "text is not a container");
  assert.equal(all["c-home"], null, "home supplies have no container");
  assert.deepEqual(all["c-boat"], { kind: "other", name: "Dry sack", emptyG: 0, size: "", rating: "" });
  assert.deepEqual(all["c-neg"], { kind: "duffel", name: "", emptyG: 0, size: "19 × 12.5 × 7.5 in", rating: "IP65" });
  const long = all["c-long"];
  assert.equal(long.kind, "backpack");
  assert.deepEqual([[...long.name].length, [...long.size].length, [...long.rating].length], [60, 40, 20]);
  for (const s of [long.name, long.size, long.rating]) assert.equal(s, s.trim());
  // Every other odd shape a hand-typed or older doc could hold
  for (const c of [undefined, 0, 1, true, "", [], new Date(0).toISOString(), { kind: ["box"] }, { kind: "__proto__" }, { kind: "toString" },
    { emptyG: "907" }, { emptyG: 907.6 }, { emptyG: null }, { emptyG: Infinity }, { emptyG: {} }, { name: 5, size: {}, rating: ["IP65"] }]) {
    setContainer(app, "c-null", c);
    const r = app.json(`containerOf(S.kits.find(k => k.id === "c-null"))`);
    if (r === null) { assert.ok(!c || typeof c !== "object" || Array.isArray(c), JSON.stringify(c)); continue; }
    assert.ok(["backpack", "duffel", "box", "other"].includes(r.kind), JSON.stringify(c));
    assert.ok(Number.isInteger(r.emptyG) && r.emptyG >= 0, JSON.stringify(c));
    for (const k of ["name", "size", "rating"]) assert.equal(typeof r[k], "string", `${JSON.stringify(c)} ${k}`);
  }
  for (const [c, kind, g] of [[{ kind: ["box"] }, "other", 0], [{ kind: "toString" }, "other", 0], [{ emptyG: "907" }, "other", 907], [{ emptyG: 907.6 }, "other", 908]]) {
    setContainer(app, "c-null", c);
    const r = app.json(`containerOf(S.kits.find(k => k.id === "c-null"))`);
    assert.deepEqual([r.kind, r.emptyG], [kind, g], JSON.stringify(c));
  }
  assert.deepEqual(app.json("CONTAINER_KINDS"), { backpack: "Backpack", duffel: "Duffel", box: "Bin or box", other: "Other" });
});

test("the empty weight never changes a score: only what Best pack keeps moves", () => {
  const app = load({ fixture: "tests/household" });
  const { g } = plan(app, "go");
  app.run(`S.kits.find(k => k.id === "go").carryKg = ${(g + LB_G) / 1000};`);
  const scores = () => app.json(`(M => ({ overall: M.overall, kits: Object.fromEntries(Object.entries(M.kitRes).map(([k, r]) => [k, r.score])),
    hazards: M.results.map(r => r.score) }))(model())`);
  const without = scores(), P0 = plan(app, "go");
  setContainer(app, "go", { kind: "backpack", emptyG: 907 });
  setContainer(app, "car", { kind: "box", emptyG: 5000 });
  assert.deepEqual(scores(), without);
  const P1 = plan(app, "go");
  assert.equal(P1.score, P0.score, "the kit's own score is the same");
  assert.ok(P1.best, "Best pack now leaves something out");
  const best = app.json(`(k => { const r = kitReadiness(k, household(), model().active); const P = packPlan(k, r, kitLimits(k, r.h));
    return kitReadiness(k, household(), r.drivers, P.best.items).score; })(S.kits.find(k => k.id === "go"))`);
  assert.equal(P1.best.score, best, "Best pack's points are kitReadiness on the items it keeps");
});

test("the bag's own weight is one grey band at the bottom, named, never a small item, and not in space mode", () => {
  const app = load({ fixture: "tests/household" });
  setContainer(app, "go", { kind: "backpack", name: NAME, emptyG: 1361 });
  let b = bag(panel(app, "go", "g"));
  const own = b.bands[0];
  assert.equal(own.id, undefined, "the bottom band is no item");
  assert.equal(own.small, false, "the bottom band is not the small items");
  assert.equal(own.v, 1361);
  assert.doesNotMatch(own.style, /--zone-/, "grey, not a zone colour");
  assert.match(own.label, new RegExp(`^${NAME} 3 lb$`));
  assert.equal(b.bands.filter(x => !x.id && !x.small).length, 1, "one bag band");
  const P = plan(app, "go");
  assert.ok(b.bands.some(x => x.small), "the household's small items still merge");
  const sum = b.bands.reduce((a, x) => a + x.v, 0);
  assert.ok(Math.abs(sum - P.g - 1361) <= b.bands.length, `bands ${sum} add to items ${P.g} and bag 1361`);
  assert.match(b.free, new RegExp(`^${(Math.round((P.lim.kg * 1000 - P.g - 1361) / LB_G * 10) / 10).toLocaleString()} lb to spare$`));
  // No name: the kind's label
  setContainer(app, "go", { kind: "box", emptyG: 1361 });
  assert.match(bag(panel(app, "go", "g")).bands[0].label, /^Bin or box 3 lb$/);
  // A tiny bag stays its own band, under items that would merge
  setContainer(app, "go", { kind: "duffel", emptyG: 20 });
  b = bag(panel(app, "go", "g"));
  assert.match(b.bands[0].label, /^Duffel 0 lb$/);
  assert.ok(!b.bands[0].small && !b.bands[0].id);
  // In space mode there is no band for the bag
  b = bag(panel(app, "go", "ml"));
  assert.ok(b.bands.every(x => x.id || x.small), "every band is an item or the small items");
  // A car kit shows space only, so never a bag band
  setContainer(app, "car", { kind: "box", name: "Trunk tote", emptyG: 3000 });
  assert.ok(bag(panel(app, "car")).bands.every(x => x.id || x.small));
});

test("the container's name is escaped in its band and in the figure's label", () => {
  const app = load({ fixture: "tests/household" });
  const name = `<b>Big</b> "pack" & 'co'`;
  setContainer(app, "go", { kind: "backpack", name, emptyG: 1000 });
  for (const m of ["g", "ml"]) {
    const html = panel(app, "go", m), b = bag(html);
    assert.doesNotMatch(html, /<b>Big/, "no raw markup");
    assert.ok(!/"pack"/.test(b.rawLabel), "no raw quote in the attribute");
    assert.ok(b.label.includes(name), b.label);
    if (m === "g") assert.ok(b.bands[0].label.startsWith(name), b.bands[0].label);
  }
});

test("the figure's label names the container, and says the bag is included when it is", () => {
  const app = load({ fixture: "tests/household" });
  const kit = `S.kits.find(k => k.id === "go")`;
  app.run(`${kit}.carryKg = 15; ${kit}.bagL = 33.25;`);
  const f1 = n => (Math.round(n * 10) / 10).toLocaleString();
  const P = plan(app, "go");
  const plain = { g: bag(panel(app, "go", "g")).label, ml: bag(panel(app, "go", "ml")).label };
  assert.equal(plain.g, `${f1(P.g / LB_G)} of ${f1(15000 / LB_G)} lb packed`);
  assert.equal(plain.ml, `${f1(P.ml / 1000)} of ${f1(33.25)} L packed`);
  setContainer(app, "go", { kind: "backpack", name: NAME, emptyG: 2000 });
  assert.equal(bag(panel(app, "go", "g")).label, `${f1((P.g + 2000) / LB_G)} of ${f1(15000 / LB_G)} lb packed in the ${NAME}, bag included`);
  assert.equal(bag(panel(app, "go", "ml")).label, `${f1(P.ml / 1000)} of 33.25 L packed in the ${NAME}`);
  setContainer(app, "go", { kind: "duffel", emptyG: 2000 });
  assert.match(bag(panel(app, "go", "g")).label, / lb packed in the duffel, bag included$/);
  assert.match(bag(panel(app, "go", "ml")).label, / L packed in the duffel$/);
  setContainer(app, "go", undefined);
  assert.deepEqual({ g: bag(panel(app, "go", "g")).label, ml: bag(panel(app, "go", "ml")).label }, plain);
});

test("a container with no empty weight changes nothing in weight mode but the label naming it", () => {
  const app = load({ fixture: "tests/household" });
  const without = panel(app, "go", "g"), P0 = plan(app, "go");
  setContainer(app, "go", { kind: "backpack", name: NAME, emptyG: 0 });
  const withC = panel(app, "go", "g");
  assert.notEqual(withC, without);
  const label = /(<div class="bag"[^>]*?) aria-label="[^"]*"/;
  assert.equal(withC.replace(label, "$1"), without.replace(label, "$1"));
  assert.match(bag(withC).label, new RegExp(`packed in the ${NAME}$`), "no \"bag included\" with no bag weight");
  const P1 = plan(app, "go");
  assert.deepEqual({ ...P1, lim: null }, { ...P0, lim: null });
});

test("a bag heavier than the carry limit renders over, and packPlan still returns", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.kits.find(k => k.id === "go").carryKg = 2;`);
  setContainer(app, "go", { kind: "duffel", name: "Steel trunk", emptyG: 9000 });
  const P = plan(app, "go");
  assert.equal(P.fits, false);
  assert.ok(P.best, "a best pack");
  assert.equal(P.best.g, 0, "nothing fits once the bag is in");
  for (const m of ["g", "ml", null]) {
    const html = panel(app, "go", m);
    assert.doesNotMatch(html, /NaN|undefined|Infinity|\[object/, String(m));
  }
  const b = bag(panel(app, "go", "g"));
  assert.match(b.over, /^[\d.,]+ lb over$/);
  assert.equal(+b.over.replace(/[^\d.]/g, ""), Math.round((P.g + 9000 - 2000) / LB_G * 10) / 10);
  assert.match(b.bands[0].label, /^Steel trunk 19[.,]8 lb$/);
  // The default measure counts the bag: it opens on Weight
  assert.match(bag(panel(app, "go")).label, / lb packed in the Steel trunk, bag included$/);
  assert.match(panel(app, "go"), new RegExp(`at ${(Math.round((P.best.g + 9000) / LB_G * 10) / 10).toLocaleString()} lb and`), "Best pack's weight includes the bag");
});

test("the odd containers render every panel with no NaN or raw markup", () => {
  const app = load({ fixture: ODD });
  for (const id of app.json(`S.kits.map(k => k.id)`)) for (const m of ["g", "ml", null]) {
    const html = panel(app, id, m);
    assert.doesNotMatch(html, /NaN|undefined|Infinity|\[object|<b>Bold/, `${id} ${m}`);
  }
});

test("Bag size saves to 0.01 L, so 33.25 L stays 33.25", async () => {
  const app = load({ fixture: "tests/household" });
  await app.fire("change", { dataset: { change: "packLim", id: "go", f: "bagL" }, value: "33.25" });
  assert.equal(app.json(`S.kits.find(k => k.id === "go").bagL`), 33.25);
  await app.fire("change", { dataset: { change: "packLim", id: "car", f: "bagL" }, value: "61.237" });
  assert.equal(app.json(`S.kits.find(k => k.id === "car").bagL`), 61.24);
  assert.match(panel(app, "go"), /id="pk-bagL-go" value="33.25"/);
  assert.match(panel(app, "go"), /step="0.01" id="pk-bagL-go"/);
});

// With no container, every kit's panel is what main rendered before kits had containers. Main's panels are recorded in
// MAIN, so CI compares against them with no git history. The one intended difference: Bag size and Trunk space take
// 0.01 L steps. To record them again from a page, which only a change to a panel's no-container markup should need:
//   GO_BAG_PAGE=<page.html> node tests/container-weight.test.js --record
const MAIN = path.join(__dirname, "container-weight.main.json");
// Every kit whose saved container reads as none (on main, every saved container) as saved, then every kit of every
// scenario with no container, each on the default measure, Weight and Space: its limits without the two new fields,
// then its panel. The clock is fixed, so an expiry date never moves what a panel says.
function panels() {
  const out = {}, now = Date.UTC(2026, 10, 6);
  for (const fixture of scenarios) {
    const app = load({ fixture });
    app.run(`(D => { globalThis.Date = class extends D { constructor(...a) { super(...(a.length ? a : [${now}])); } static now() { return ${now}; } }; })(Date)`);
    const ids = app.json("S.kits.map(k => k.id)"), kit = id => `S.kits.find(k => k.id === ${JSON.stringify(id)})`;
    const draw = (id, as) => { for (const m of [null, "g", "ml"]) out[[fixture, id, as, m].join(" ")] = app.run(`(k => {
      S.bagM = ${JSON.stringify(m)} && { id: k.id, m: ${JSON.stringify(m)} };
      const lim = kitLimits(k, household()), old = lim && Object.fromEntries(Object.entries(lim).filter(([f]) => f !== "container" && f !== "emptyG"));
      return JSON.stringify(old) + packPanel(k, kitReadiness(k, household(), model().active)); })(${kit(id)})`); };
    const none = app.run("typeof containerOf") === "function" ? id => app.run(`containerOf(${kit(id)}) === null`) : () => true;
    for (const id of ids) if (app.run(`${kit(id)}.container !== undefined`) && none(id)) draw(id, "saved");
    app.run("S.kits.forEach(k => delete k.container)");
    for (const id of ids) draw(id, "none");
  }
  return out;
}
if (process.argv.includes("--record")) { fs.writeFileSync(MAIN, JSON.stringify(panels(), null, 1) + "\n"); process.exit(0); }

test("with no container, every kit's panel and limits are byte-for-byte main's", () => {
  const main = JSON.parse(fs.readFileSync(MAIN, "utf8")), now = panels();
  // Every kit main rendered with no container still renders, and every panel main has a record of is unchanged
  for (const key of Object.keys(main)) if (/ none /.test(key)) assert.ok(key in now, `${key}: not rendered any more`);
  const compared = Object.keys(now).filter(key => key in main);
  for (const key of compared) assert.equal(now[key], main[key].replace(/step="0\.5"( id="pk-bagL-)/g, 'step="0.01"$1'), key);
  const kits = new Set(compared.filter(k => / none /.test(k)).map(k => k.split(" ").slice(0, 2).join(" ")));
  assert.ok(kits.size > 10, `only ${kits.size} kits`);
  assert.ok(kits.has("tests/household go") && kits.has("tests/household car"), "the household's go-bag and car kit");
  for (const id of ["c-null", "c-array", "c-string"]) assert.ok(compared.includes(`${ODD} ${id} saved g`), `${id}: a saved container that reads as none`);
});

test("at 390px the odd containers' panels, bag band included, never scroll sideways", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const seen = atPhoneWidth([ODD], () => S.kits.flatMap(k => ["ml", "g"].map(m => {
    // Each container gets an empty weight, so the 60-character name shows in its band
    if (k.container && typeof k.container === "object" && !Array.isArray(k.container)) k.container = { ...k.container, emptyG: 1500 };
    S.view = "kits"; S.openKit = k.id; S.bagM = { id: k.id, m }; render();
    const b = document.querySelector("#v-kits .bag");
    return { kit: k.id + " " + m, limited: !!kitLimits(k, household()), h: b ? b.getBoundingClientRect().height : -1,
      own: !!b && [...b.querySelectorAll(".bag-b")].some(e => !e.dataset.id && !e.dataset.n),
      inside: !b || [b, ...b.querySelectorAll("*")].every(e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }),
      width: innerWidth, scroll: document.documentElement.scrollWidth };
  })));
  const kits = seen.get(ODD);
  assert.ok(kits && kits.length, "no kits measured");
  for (const k of kits) {
    assert.equal(k.width, 390, `${k.kit}: the viewport isn't 390px`);
    assert.ok(k.scroll <= k.width, `${k.kit}: scrolls sideways (${k.scroll}px wide)`);
    if (!k.limited) continue;
    assert.ok(k.h > 0, `${k.kit}: the bag has no height`);
    assert.ok(k.inside, `${k.kit}: part of the bag is off screen`);
  }
  assert.ok(kits.some(k => k.kit === "c-long g" && k.own), "the long-named bag's band is drawn");
});
