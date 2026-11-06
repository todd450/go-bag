// The "What holds this kit" card and its editor (issue #100, concept 1 of #96): under a go-bag's or car kit's
// header, the real bag or box with the facts the founder typed (litres, empty weight, outside size, weather
// rating), and the editor that is the only writer of kit.container. Facts are typed, never guessed.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");
const { chrome, atPhoneWidth } = require("./phone");

const HH = "tests/household", LONG = "fixtures/phone-width/long-container", ODD = "fixtures/data-and-account-shapes/odd-container";
const scenarios = [HH, ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];
const q = JSON.stringify;
const KINDS = ["backpack", "duffel", "box", "other"];

const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const text = html => unesc(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();
const attr = (attrs, name) => { const m = attrs.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? unesc(m[1]) : undefined; };
const dataset = attrs => Object.fromEntries([...attrs.matchAll(/\sdata-([a-z]+)="([^"]*)"/g)].map(([, k, v]) => [k, unesc(v)]));

const kit = (app, id) => app.json(`S.kits.find(k => k.id === ${q(id)})`);
const setKit = (app, id, patch) => app.run(`Object.assign(S.kits.find(k => k.id === ${q(id)}), ${q(patch)})`);
const card = (app, id) => app.run(`(k => containerCard(k, household()))(S.kits.find(k => k.id === ${q(id)}))`);
// Every button in the html: its attributes, data-*, aria-pressed and text.
const buttons = html => [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map(([, attrs, body]) => ({ attrs, ds: dataset(attrs), pressed: attr(attrs, "aria-pressed"), text: text(body) }));
const press = (app, b) => app.run(`ACT[${q(b.ds.act)}]({ dataset: ${q(b.ds)} })`);
const pressText = (app, html, t) => { const b = buttons(html).find(b => b.text === t); assert.ok(b, `no "${t}" button`); return press(app, b); };
// The editor's fields, each as its label's text and its input's attributes.
const fields = html => [...html.matchAll(/<label\b[^>]*>([^<]*)<input([^>]*)>/g)].map(([, label, attrs]) => ({ label: label.trim(), attrs, ds: dataset(attrs), value: attr(attrs, "value") }));
const field = (html, label) => { const f = fields(html).find(f => f.label.startsWith(label)); assert.ok(f, `no field labelled ${label}`); return f; };
const type = (app, id, label, value) => app.fire("input", { dataset: field(card(app, id), label).ds, value });
const form = html => html.match(/<form\b([^>]*)>/);
const save = (app, id) => app.fire("submit", { dataset: dataset(form(card(app, id))[1]) });
const kinds = html => buttons(html).filter(b => b.pressed != null && KINDS.includes(b.ds.k));
// Counts the page's writes from here on.
const countWrites = app => app.run(`globalThis.WRITES = []; (o => { setDoc = (...a) => { WRITES.push(a); return o(...a); }; })(setDoc)`);
const writes = app => app.json("WRITES");

const FULL = { kind: "backpack", name: "Highland Tactical Major", emptyG: 1043, size: "19 × 12.5 × 7.5 in", rating: "IP65" };

test("home supplies get no card, and a read-only viewer of a kit with no container sees none", () => {
  const app = load({ fixture: HH });
  assert.equal(card(app, "home"), "");
  setKit(app, "home", { container: { kind: "box", name: "Garage tote", emptyG: 2000 } });
  assert.equal(card(app, "home"), "", "a home kit with a container still gets no card");
  const detail = app.run(`(k => kitDetail(k, model().kitRes[k.id]))(S.kits.find(k => k.id === "home"))`);
  assert.doesNotMatch(detail, /What holds this kit/);
  app.run("S.canWrite = false");
  for (const id of ["go", "car"]) assert.equal(card(app, id), "", `${id}: a read-only viewer sees no card`);
});

test("the card sits between the kit's header and its readiness panel", () => {
  const app = load({ fixture: HH });
  for (const id of ["go", "car"]) {
    const detail = app.run(`(k => kitDetail(k, model().kitRes[k.id]))(S.kits.find(k => k.id === ${q(id)}))`);
    const c = card(app, id), at = detail.indexOf(c);
    assert.ok(c && at > 0, `${id}: the card is in the kit`);
    assert.ok(detail.indexOf("</h2>") < at, `${id}: after the header`);
    assert.ok(at + c.length <= detail.indexOf("Kit readiness"), `${id}: before the readiness panel`);
  }
});

test("a read-only viewer sees the set facts only: no Change and no dashed chips", () => {
  const app = load({ fixture: HH });
  setKit(app, "go", { bagL: 33.25, container: FULL });
  setKit(app, "car", { container: { kind: "box", name: "Gregory Alpaca" } });
  app.run("S.canWrite = false");
  const go = card(app, "go");
  for (const fact of ["Highland Tactical Major", "33.25 L", "2.3 lb", "19 × 12.5 × 7.5 in", "IP65"]) assert.ok(text(go).includes(fact), `shows ${fact}`);
  const car = card(app, "car");
  assert.ok(text(car).includes("Gregory Alpaca"));
  for (const html of [go, car]) {
    assert.deepEqual(buttons(html), [], "no buttons at all");
    assert.doesNotMatch(html, /data-act=/);
    assert.equal(form(html), null, "no editor");
  }
  assert.doesNotMatch(text(car), /\+/, "no + chips for the facts nobody entered");
  // Even with an editor somehow open for the kit, a reader sees the card
  app.run(`S.ctr = { id: "go" }`);
  assert.equal(form(card(app, "go")), null);
});

test("a writer with no container sees + Add the bag or box, and pressing it opens the editor", () => {
  const app = load({ fixture: HH });
  for (const id of ["go", "car"]) {
    const html = card(app, id), bs = buttons(html);
    assert.match(text(html), /What holds this kit/);
    assert.deepEqual(bs.map(b => b.text), ["+ Add the bag or box"], `${id}: one button`);
    assert.equal(form(html), null);
    press(app, bs[0]);
    const ed = card(app, id);
    assert.ok(form(ed), `${id}: the editor is open`);
    assert.deepEqual(buttons(ed).filter(b => /^(Save|Cancel)$/.test(b.text)).map(b => b.text), ["Save", "Cancel"]);
    pressText(app, ed, "Cancel");
  }
});

test("a fact nobody entered is a dashed + chip, never a number, and no 40 L or 60 L guess shows", () => {
  const app = load({ fixture: HH });
  for (const id of ["go", "car"]) {
    setKit(app, id, { container: { kind: id === "go" ? "duffel" : "box", name: "Plain bag" } });
    const html = card(app, id), bs = buttons(html);
    assert.deepEqual(bs.filter(b => b.text.startsWith("+")).map(b => b.text), ["+ Capacity", "+ Empty weight", "+ Outside size", "+ Weather rating"]);
    assert.deepEqual(bs.filter(b => !b.text.startsWith("+")).map(b => b.text), ["Change"]);
    assert.doesNotMatch(text(html), /\d/, `${id}: no number on the card`);
    // Each dashed chip and Change open the editor
    for (const b of bs) { press(app, b); assert.ok(form(card(app, id)), `${b.text} opens the editor`); app.run("ACT.ctrCancel()"); }
  }
  // A saved size shows, and only the facts still missing stay dashed
  setKit(app, "go", { bagL: 33.25, container: { kind: "duffel", name: "Plain bag", rating: "IP65" } });
  const html = card(app, "go");
  assert.deepEqual(buttons(html).filter(b => b.text.startsWith("+")).map(b => b.text), ["+ Empty weight", "+ Outside size"]);
  assert.ok(text(html).includes("33.25 L"));
  assert.ok(text(html).includes("IP65"));
});

test("the card names the container, else its kind", () => {
  const app = load({ fixture: HH });
  for (const [k, label] of [["backpack", "Backpack"], ["duffel", "Duffel"], ["box", "Bin or box"], ["other", "Other"]]) {
    setKit(app, "go", { container: { kind: k } });
    assert.ok(text(card(app, "go")).includes(label), `${k} reads ${label}`);
  }
  setKit(app, "go", { container: { kind: "box", name: "Gregory Alpaca" } });
  assert.ok(text(card(app, "go")).includes("Gregory Alpaca"));
  assert.ok(!text(card(app, "go")).includes("Bin or box"));
  // Each kind has its own icon
  const svgs = KINDS.map(k => { setKit(app, "go", { container: { kind: k } }); return card(app, "go").match(/<svg[\s\S]*?<\/svg>/)[0]; });
  assert.equal(new Set(svgs).size, 4);
});

test("the kind switch: four aria-pressed buttons in order, exactly one pressed, and pressing one moves it", () => {
  const app = load({ fixture: HH });
  for (const [id, c] of [["go", undefined], ["car", undefined], ["go", { kind: "duffel" }]]) {
    if (c) setKit(app, id, { container: c });
    app.run(`ACT.ctrOpen({ dataset: { id: ${q(id)} } })`);
    let ks = kinds(card(app, id));
    assert.deepEqual(ks.map(b => b.ds.k), KINDS);
    assert.deepEqual(ks.map(b => b.text), ["Backpack", "Duffel", "Bin or box", "Other"]);
    assert.equal(ks.filter(b => b.pressed === "true").length, 1);
    assert.ok(ks.every(b => /^(true|false)$/.test(b.pressed)));
    if (c) assert.equal(ks.find(b => b.pressed === "true").ds.k, "duffel", "the saved kind is pressed");
    for (const k of KINDS) {
      press(app, ks.find(b => b.ds.k === k));
      ks = kinds(card(app, id));
      assert.deepEqual(ks.filter(b => b.pressed === "true").map(b => b.ds.k), [k]);
    }
    app.run("ACT.ctrCancel()");
  }
});

test("pressing a kind keeps what was already typed", async () => {
  const app = load({ fixture: HH });
  app.run(`ACT.ctrOpen({ dataset: { id: "go" } })`);
  await type(app, "go", "Name", "Gregory Alpaca");
  press(app, kinds(card(app, "go"))[2]);
  assert.equal(field(card(app, "go"), "Name").value, "Gregory Alpaca");
});

test("saving every field writes the container once and changes no other key", async () => {
  const app = load({ fixture: HH });
  const before = kit(app, "go");
  countWrites(app);
  pressText(app, card(app, "go"), "+ Add the bag or box");
  pressText(app, card(app, "go"), "Bin or box");
  await type(app, "go", "Name", "Gregory Alpaca");
  await type(app, "go", "Capacity", "50");
  await type(app, "go", "Outside size", "18 × 13 × 12 in");
  await type(app, "go", "Weather rating", "IP65");
  await save(app, "go");
  assert.equal(writes(app).length, 1, "one write");
  assert.deepEqual(kit(app, "go"), { ...before, bagL: 50, container: { kind: "box", name: "Gregory Alpaca", size: "18 × 13 × 12 in", rating: "IP65" } });
  assert.equal(form(card(app, "go")), null, "the editor closes");
});

test("weight saves as whole grams and capacity to 0.01 L; empty or blank fields are left out", async () => {
  const app = load({ fixture: HH });
  app.run(`ACT.ctrOpen({ dataset: { id: "go" } })`);
  await type(app, "go", "Name", "   ");
  await type(app, "go", "Empty weight", "2.3");
  await type(app, "go", "Capacity", "33.25");
  await type(app, "go", "Outside size", "  ");
  await save(app, "go");
  assert.deepEqual(kit(app, "go").container, { kind: "backpack", emptyG: 1043 });
  assert.equal(kit(app, "go").bagL, 33.25);
  app.run(`ACT.ctrOpen({ dataset: { id: "car" } })`);
  await type(app, "car", "Capacity", "49.996");
  await type(app, "car", "Name", "  Gregory Alpaca ");
  await save(app, "car");
  assert.equal(kit(app, "car").bagL, 50);
  assert.deepEqual(kit(app, "car").container, { kind: "box", name: "Gregory Alpaca" });
});

test("saving without touching capacity or weight leaves bagL and emptyG as they were", async () => {
  const app = load({ fixture: HH });
  // bagL absent stays absent
  app.run(`ACT.ctrOpen({ dataset: { id: "car" } })`);
  await type(app, "car", "Name", "Gregory Alpaca");
  await save(app, "car");
  assert.ok(!("bagL" in kit(app, "car")));
  // A saved bagL and emptyG that don't round-trip through the fields stay exactly as saved
  setKit(app, "go", { bagL: 33.256, container: { kind: "duffel", name: "Old", emptyG: 1000 } });
  const before = kit(app, "go");
  app.run(`ACT.ctrOpen({ dataset: { id: "go" } })`);
  const ed = card(app, "go");
  assert.equal(field(ed, "Capacity").value, "33.256");
  assert.equal(field(ed, "Empty weight").value, "2.2");
  await type(app, "go", "Name", "New");
  await save(app, "go");
  assert.deepEqual(kit(app, "go"), { ...before, container: { kind: "duffel", name: "New", emptyG: 1000 } });
  // Typing the same capacity back is no change either
  app.run(`ACT.ctrOpen({ dataset: { id: "go" } })`);
  await type(app, "go", "Capacity", "33.256");
  await save(app, "go");
  assert.equal(kit(app, "go").bagL, 33.256);
});

test("emptying capacity or weight removes them", async () => {
  const app = load({ fixture: HH });
  setKit(app, "go", { bagL: 30, container: { kind: "backpack", name: "Old", emptyG: 900, rating: "IP65" } });
  app.run(`ACT.ctrOpen({ dataset: { id: "go" } })`);
  await type(app, "go", "Capacity", "");
  await type(app, "go", "Empty weight", "");
  await type(app, "go", "Weather rating", "");
  await save(app, "go");
  const k = kit(app, "go");
  assert.ok(!("bagL" in k));
  assert.deepEqual(k.container, { kind: "backpack", name: "Old" });
});

test("what this changes: one line per set fact, with the kit's own guess and carry limit", () => {
  const app = load({ fixture: HH });
  setKit(app, "go", { bagL: 33.25, carryKg: 15, container: { kind: "backpack", emptyG: 1043 } });
  let t = text(card(app, "go"));
  assert.ok(t.includes("Space is now 33.25 L, not the 40 L guess."), t);
  assert.ok(t.includes("The bag's own 2.3 lb comes off the 33 lb carry limit."), t);
  // The limit is the one the panel shows
  setKit(app, "go", { carryKg: 9 });
  assert.ok(text(card(app, "go")).includes("off the 20 lb carry limit."));
  // A car kit: its own guess, and no weight line
  setKit(app, "car", { bagL: 50, container: { kind: "box", emptyG: 2000 } });
  t = text(card(app, "car"));
  assert.ok(t.includes("Space is now 50 L, not the 60 L guess."), t);
  assert.doesNotMatch(t, /carry limit/);
  // Weight only, or no facts: no space line, and no note at all
  setKit(app, "go", { bagL: 0 });
  assert.doesNotMatch(text(card(app, "go")), /Space is now/);
  setKit(app, "go", { container: { kind: "backpack", name: "Plain" } });
  setKit(app, "car", { bagL: 0, container: { kind: "box" } });
  for (const id of ["go", "car"]) assert.doesNotMatch(text(card(app, id)), /Space is now|carry limit|guess/);
});

test("Cancel writes nothing, and opening another kit closes the editor", async () => {
  const app = load({ fixture: HH });
  setKit(app, "go", { container: FULL });
  const before = app.json("S.kits");
  countWrites(app);
  pressText(app, card(app, "go"), "Change");
  await type(app, "go", "Name", "Something else");
  pressText(app, card(app, "go"), "Cancel");
  assert.deepEqual(writes(app), []);
  assert.deepEqual(app.json("S.kits"), before);
  assert.equal(form(card(app, "go")), null);
  // Reopened, it shows what is saved, not what was typed
  pressText(app, card(app, "go"), "Change");
  assert.equal(field(card(app, "go"), "Name").value, FULL.name);
  for (const act of ["openKit", "gotoKit"]) {
    app.run(`ACT.ctrOpen({ dataset: { id: "go" } })`);
    app.run(`ACT[${q(act)}]({ dataset: { id: "car" } })`);
    assert.equal(form(card(app, "go")), null, `${act} closes it`);
    app.run(`ACT[${q(act)}]({ dataset: { id: "go" } })`);
    assert.equal(form(card(app, "go")), null, `${act} back: still closed`);
  }
  assert.deepEqual(writes(app), []);
});

test("a read-only viewer's Save writes nothing", async () => {
  const app = load({ fixture: HH });
  app.run(`ACT.ctrOpen({ dataset: { id: "go" } })`);
  await type(app, "go", "Name", "Gregory Alpaca");
  const f = dataset(form(card(app, "go"))[1]);
  app.run("S.canWrite = false");
  countWrites(app);
  await app.fire("submit", { dataset: f });
  assert.deepEqual(writes(app), []);
  assert.ok(!("container" in kit(app, "go")));
});

test("typed text is escaped in the card and the editor", () => {
  const app = load({ fixture: HH });
  const odd = `<b>Bold</b> "Quoted" & 'x'`;
  setKit(app, "go", { bagL: 20, container: { kind: "box", name: odd, size: odd, rating: `<b>"IP"</b>` } });
  for (const ro of [false, true]) {
    app.run(`S.canWrite = ${!ro}`);
    const html = card(app, "go");
    assert.doesNotMatch(html, /<b>Bold|<b>"IP"/);
    assert.ok(text(html).includes(odd), "the name and size read as typed");
    assert.ok(text(html).includes(`<b>"IP"</b>`), "the rating reads as typed");
  }
  app.run(`S.canWrite = true; ACT.ctrOpen({ dataset: { id: "go" } })`);
  const ed = card(app, "go");
  assert.doesNotMatch(ed, /<b>Bold/);
  assert.equal(field(ed, "Name").value, odd);
  assert.equal(field(ed, "Outside size").value, odd);
  // The odd containers from #99, read and edited
  const o = load({ fixture: ODD });
  for (const id of o.json("S.kits.map(k => k.id)")) {
    for (const ro of [true, false]) {
      o.run(`S.canWrite = ${!ro}; S.ctr = null`);
      const html = card(o, id);
      assert.doesNotMatch(html, /<b>Bold/, `${id}`);
      if (!ro && html) { o.run(`ACT.ctrOpen({ dataset: { id: ${q(id)} } })`); assert.doesNotMatch(card(o, id), /<b>Bold/, `${id} editor`); }
    }
  }
  assert.ok(text(card(o, "c-long")).includes(`Pack <b>Bold</b> "Quoted"`));
});

test("every editor field has a label and the text fields keep their lengths", () => {
  const app = load({ fixture: HH });
  for (const id of ["go", "car"]) {
    app.run(`ACT.ctrOpen({ dataset: { id: ${q(id)} } })`);
    const ed = card(app, id), fs = fields(ed);
    assert.equal(fs.length, (ed.match(/<input\b/g) || []).length, "every input is inside a label");
    assert.deepEqual(fs.map(f => f.label.split(/[ ,(]/)[0]), ["Name", "Capacity", "Empty", "Outside", "Weather"]);
    for (const f of fs) assert.ok(f.label, "the label has text");
    assert.equal(attr(field(ed, "Name").attrs, "maxlength"), "60");
    assert.equal(attr(field(ed, "Outside size").attrs, "maxlength"), "40");
    assert.equal(attr(field(ed, "Weather rating").attrs, "maxlength"), "20");
    assert.equal(attr(field(ed, "Capacity").attrs, "type"), "number");
    assert.equal(attr(field(ed, "Empty weight").attrs, "type"), "number");
    assert.ok(new Set(fs.map(f => attr(f.attrs, "id"))).size === fs.length, "unique ids");
    assert.match(ed, /role="group"[^>]*aria-label="[^"]+"/, "the kind switch is a labelled group");
  }
});

test("every scenario renders its kits with the card, read-only and as a writer, editor open", () => {
  for (const f of scenarios) {
    const app = load({ fixture: f });
    for (const id of app.json("S.kits.map(k => k.id)")) for (const ro of [false, true]) {
      app.run(`S.canWrite = ${!ro}; S.ctr = null`);
      const limited = app.run(`!!kitLimits(S.kits.find(k => k.id === ${q(id)}), household())`);
      const html = card(app, id);
      if (!limited) assert.equal(html, "", `${f} ${id}`);
      if (!ro && limited) { app.run(`ACT.ctrOpen({ dataset: { id: ${q(id)} } })`); assert.ok(form(card(app, id)), `${f} ${id}: editor`); }
    }
  }
});

test("at 390px the card and the open editor never scroll sideways, on every scenario", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  // Three scenarios per Chrome run: each frame carries the whole page, and Chrome's output has to fit Node's buffer.
  const measure = () => S.kits.filter(k => kitLimits(k, household())).flatMap(k => [false, true].map(ed => {
    S.view = "kits"; ACT.openKit({ dataset: { id: k.id } });
    if (ed) ACT.ctrOpen({ dataset: { id: k.id } });
    const c = document.querySelector("#v-kits .ctr-card"), cr = c && c.getBoundingClientRect();
    return { kit: k.id + (ed ? " editor" : ""), found: !!c, form: !!c && c.tagName === "FORM",
      inside: !!c && [...c.querySelectorAll("*")].every(e => { const r = e.getBoundingClientRect(); return r.left >= cr.left - .5 && r.right <= cr.right + .5; }),
      cardIn: !!c && cr.left >= 0 && cr.right <= innerWidth, width: innerWidth, scroll: document.documentElement.scrollWidth };
  }));
  const seen = new Map();
  for (let i = 0; i < scenarios.length; i += 3) for (const [f, m] of atPhoneWidth(scenarios.slice(i, i + 3), measure)) seen.set(f, m);
  for (const f of scenarios) {
    const kits = seen.get(f);
    assert.ok(kits, `${f}: nothing measured`);
    for (const k of kits) {
      assert.equal(k.width, 390, `${f} ${k.kit}: the viewport isn't 390px`);
      assert.ok(k.found, `${f} ${k.kit}: no card`);
      assert.equal(k.form, k.kit.endsWith("editor"), `${f} ${k.kit}: editor state`);
      assert.ok(k.scroll <= k.width, `${f} ${k.kit}: scrolls sideways (${k.scroll}px wide)`);
      assert.ok(k.cardIn, `${f} ${k.kit}: the card is off screen`);
      assert.ok(k.inside, `${f} ${k.kit}: something sticks out of the card`);
    }
  }
  assert.equal(seen.get(LONG).length, 4, "the long-container kits are measured");
});
