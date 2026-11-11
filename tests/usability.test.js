// Usability fixes the founder asked for on 11 Nov 2026:
// - An emergency's score is in plain ink; only one that needs attention is red.
// - Buttons say what they do: "Add to list", "Add the top N" and "Shopping list", and points read "+1 pt", "+3 pts".
// - "Delete kit" sits in a "⋯" menu, away from the Packed and To get switch.
// - An empty field on Household is a box with grey hint text, not blue text that reads as a link.
// - Water reads in gallons first, with litres after.
// - Someone with nothing saved yet starts on Household, where setting up starts.
// (An emergency's two ratings moving off its row is in tests/views.test.js.)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { load } = require("./load");
const { chrome } = require("./phone");
const { openChrome } = require("../tools/screenshots");
const { wrap } = require("../tools/page");

const skip = !chrome && "no Chrome found (set CHROME)";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = h => h.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

async function onPage(fixture, width, hash, steps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-usability-"));
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, wrap(undefined, fixture));
  const page = await openChrome(chrome);
  const ev = async e => {
    const r = await page.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${e}: ${r.exceptionDetails.exception?.description}`);
    return r.result.value;
  };
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    const loaded = page.once("Page.loadEventFired");
    await page.send("Page.navigate", { url: `file://${file}#${hash}` });
    await loaded;
    for (let i = 0; i < 50 && !await ev("S.loaded"); i++) await sleep(50);
    assert.ok(await ev("S.loaded"), `${fixture} never loaded at ${width}px`);
    return await steps(ev);
  } finally {
    await page.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
}

test("an emergency's score is in plain ink, and red only when it needs attention", () => {
  const { run, json } = load({ fixture: "tests/household" });
  const scores = () => json(`(() => { const M = model(), h = household();
    return M.results.map(r => [r.hz.id, r.hz.group === "health" && r.rel === "high" && r.score < 50, (hzRow(r, h, M).match(/<span class="pct"([^>]*)>/) || [])[1]]); })()`);
  let rows = scores();
  assert.ok(rows.length > 10);
  for (const [id, alarm, attrs] of rows) assert.equal(attrs, alarm ? ` style="color:var(--bad)"` : "", id);
  // One that needs attention: a health emergency rated High that scores under 50
  run(`S.items = []; S.hazards = { ...S.hazards, levels: { ...S.hazards?.levels, burns: "high" } }`);
  rows = scores();
  const burns = rows.find(r => r[0] === "burns");
  assert.deepEqual(burns.slice(1), [true, ` style="color:var(--bad)"`]);
  assert.ok(rows.some(r => !r[1] && r[2] === ""), "the others stay plain, however low they score");
});

test("points say they are points: +1 pt, +3 pts", () => {
  const { run } = load({ fixture: "tests/household" });
  assert.deepEqual([1, 2, 3, 12].map(n => run(`pts(${n})`)), ["+1 pt", "+2 pts", "+3 pts", "+12 pts"]);
  // Wherever a gain is shown, it is shown that way
  const html = run(`S.canWrite = true; S.view = "kits"; S.openKit = "go"; S.toGet = "go"; viewKits(model()) + viewShop(model())`);
  const gains = [...html.matchAll(/<span class="gain[^"]*" title="Readiness points[^"]*">([^<]*)<\/span>/g)].map(m => m[1]);
  assert.ok(gains.length > 5, `${gains.length} gains shown`);
  for (const g of gains) assert.match(g, /^\+(1 pt|[1-9]\d* pts)$/);
});

test("buttons say what they do: Add to list, Add the top N and Shopping list, with no Plan or Review", () => {
  for (const fixture of ["tests/household", "fixtures/empty-and-one/new-household"]) {
    const { run } = load({ fixture });
    const html = run(`S.canWrite = true; S.view = "kits"; S.openKit = S.kits[0]?.id || null; S.toGet = S.openKit; viewKits(model())`)
      + run(`S.allKits = true; viewKits(model())`) + run(`S.allKits = null; ACT.shopAddAll?.(); viewKits(model())`);
    const labels = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(m => text(m[1].replace(/<span class="vh">[\s\S]*?<\/span>/g, "")));
    for (const l of labels) assert.doesNotMatch(l, /^(Plan|Review)\b/, `${fixture}: a button reads ${l}`);
    assert.ok(labels.includes("Shopping list"), `${fixture}: Shopping list opens the whole list`);
    assert.match(html, /<h2 id="review-h">Shopping list<\/h2>/, `${fixture}: and that is the sheet's title`);
    if (fixture === "tests/household") {
      assert.ok(labels.includes("Add to list"), "a gap's button");
      assert.ok(labels.some(l => /^Add the top \d$/.test(l)), "the top few at once");
      assert.match(html, /aria-label="Add [^"]+ to your list">Add to list</, "named for a screen reader");
    }
  }
});

test("Delete kit is in the kit's ⋯ menu, and asks before it deletes", () => {
  const { run } = load({ fixture: "tests/household" });
  const detail = () => run(`(k => kitDetail(k, model().kitRes[k.id], model()))(S.kits.find(k => k.id === "go"))`);
  run(`S.canWrite = true; S.view = "kits"; S.openKit = "go"`);
  let html = detail();
  const menu = html.match(/<details class="more"><summary[^>]*aria-label="([^"]*)"[^>]*>([^<]*)<\/summary><div class="more-m">([\s\S]*?)<\/div><\/details>/);
  assert.ok(menu, "the menu");
  assert.match(menu[1], /^More for /);
  assert.equal(menu[2], "⋯");
  assert.match(menu[3], /^<button [^>]*data-act="askConfirm" data-k="kit:go">Delete kit<\/button>$/);
  assert.equal(html.replace(menu[0], "").includes("Delete kit"), false, "nowhere else");
  // Chosen, it asks first, in place of the menu
  run(`ACT.askConfirm({ dataset: { k: "kit:go" } })`);
  html = detail();
  assert.doesNotMatch(html, /<details class="more"/);
  assert.match(html, /data-act="delKit"|data-act="confirm/);
  // Someone who can only view has no menu
  run(`S.confirm = null; S.canWrite = false`);
  assert.doesNotMatch(detail(), /class="more"|Delete kit/);
});

test("the ⋯ menu opens on a tap, closes on a tap elsewhere, and stays on screen at 390px", { skip }, async () => {
  await onPage("tests/household", 390, "kits", async ev => {
    await ev(`S.openKit = "go"; render()`);
    assert.equal(await ev(`document.querySelector("details.more").open`), false, "closed to start");
    await ev(`document.querySelector("details.more summary").click()`);
    const r = await ev(`(d => { const b = d.querySelector(".more-m").getBoundingClientRect(), s = d.querySelector("summary").getBoundingClientRect();
      return { open: d.open, left: b.left, right: b.right, width: document.documentElement.clientWidth, tap: Math.min(s.width, s.height),
        ink: getComputedStyle(d.querySelector(".more-m .btn")).color, bad: getComputedStyle(document.documentElement).getPropertyValue("--bad").trim() }; })(document.querySelector("details.more"))`);
    assert.equal(r.open, true);
    assert.ok(r.left >= 0 && r.right <= r.width, `the menu is on screen (${r.left} to ${r.right} of ${r.width})`);
    assert.ok(r.tap >= 32, `the ⋯ is big enough to tap (${r.tap}px)`);
    await ev(`document.querySelector("h1, .top").click()`);
    assert.equal(await ev(`document.querySelector("details.more").open`), false, "a tap elsewhere closes it");
    // Delete kit in the menu asks first
    await ev(`document.querySelector("details.more summary").click(); document.querySelector('.more-m [data-act="askConfirm"]').click()`);
    assert.equal(await ev(`S.confirm`), "kit:go");
    assert.equal(await ev(`S.kits.some(k => k.id === "go")`), true, "nothing is deleted yet");
  });
});

test("an empty field on Household is a box with grey hint text, and a filled one reads as text", { skip }, async () => {
  await onPage("tests/household", 390, "household", async ev => {
    const r = await ev(`(() => { const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      const probe = c => { const e = document.createElement("i"); e.style.color = c; document.body.append(e); const v = getComputedStyle(e).color; e.remove(); return v; };
      const eds = [...document.querySelectorAll("#v-household :is(input, textarea).ed")].filter(e => !e.disabled && e.offsetParent);
      const look = e => e && { hint: getComputedStyle(e, "::placeholder").color, shadow: getComputedStyle(e).boxShadow, ink: getComputedStyle(e).color };
      const empty = eds.find(e => !e.value && e.placeholder), full = eds.find(e => e.value);
      return { n: eds.length, empty: look(empty), full: look(full), brand: probe(css("--brand")), ink2: probe(css("--ink-2")) }; })()`);
    assert.ok(r.empty && r.full, `an empty and a filled field among ${r.n}`);
    assert.equal(r.empty.hint, r.ink2, "the hint is grey");
    assert.notEqual(r.empty.hint, r.brand, "and not the blue of a link");
    // An outline all round is a 1px inset spread; a filled field keeps only the rule under it
    assert.match(r.empty.shadow, /0px 0px 0px 1px inset/, `an empty field has an outline (${r.empty.shadow})`);
    assert.doesNotMatch(r.full.shadow, /0px 0px 0px 1px inset/, `a filled one has none (${r.full.shadow})`);
  });
});

test("water reads in gallons first, with litres after", () => {
  const { run, json } = load({ fixture: "tests/household" });
  const row = json(`(() => { const M = model(); for (const r of M.results) for (const x of r.rows) if (x.unit === "L" && x.need > 0) return { have: x.have, need: x.need, html: amount(x, household(), "days") }; })()`);
  const f1 = n => String(Math.round(n * 10) / 10);
  assert.equal(text(row.html), `${f1(row.have / 3.785)} of ${f1(row.need / 3.785)} gal (${f1(row.have)} of ${row.need} L)`);
  // The shopping line, too: gallons in its title, litres in its detail
  const line = json(`(() => { const M = model(), g = M.gaps.find(g => g.cat === "water"); const p = g && gapPlan(g, M.h); return p && { title: p.title, detail: p.detail, text: p.text }; })()`);
  assert.ok(line, "the household is short of water");
  {
    assert.match(line.title, /^Add [\d.]+ gallons of drinking water$/);
    assert.match(line.detail, /^[\d.]+ L: /);
    assert.match(line.text, /^Drinking water: [\d.]+ gal \([\d.]+ L\)$/);
  }
  void run;
});

// A stand-in claude.ai whose database answers every subscription with what `docs` holds
function claudeWith(docs) {
  const subs = [];
  const ref = name => ({ onSnapshot: cb => { subs.push({ name, cb }); return () => {}; } });
  const answer = () => { for (const { name, cb } of subs) cb(name.includes("/")
    ? { metadata: {}, exists: name in docs, data: () => docs[name] }
    : { metadata: {}, docs: (docs[name] || []).map(d => ({ id: d.id, data: () => d })) }); };
  return { answer, claude: { use: async n => (n === "db" ? { collection: ref, doc: ref } : null) } };
}
const settle = () => new Promise(r => setImmediate(r));

test("someone with nothing saved yet starts on Household; anyone else, or a link to a tab, starts where they did", async () => {
  const profile = { people: 2, adults: 2, children: 0, pets: 0, vehicles: 1 };
  const kit = { id: "go", name: "Go-bag", kind: "go" };
  for (const [what, docs, hash, want] of [
    ["nothing saved", {}, "", "household"],
    ["nothing saved, opened at #kits", {}, "#kits", "kits"],
    ["a household", { "household/profile": profile }, "", "overview"],
    ["a kit and no household", { kits: [kit] }, "", "overview"]]) {
    const { answer, claude } = claudeWith(docs);
    const { json } = load({ boot: true, claude, hash });
    await settle();
    answer();
    assert.equal(json("S.loaded"), true, what);
    assert.equal(json("S.view"), want, what);
    // What arrives later never moves them again
    answer();
    assert.equal(json("S.view"), want, `${what}: a later answer`);
  }
});

test("a first visit that has moved to another tab stays there when more data arrives", async () => {
  const { answer, claude } = claudeWith({});
  const { run, json } = load({ boot: true, claude });
  await settle();
  answer();
  run(`S.view = "kits"`);
  answer();
  assert.equal(json("S.view"), "kits");
});
