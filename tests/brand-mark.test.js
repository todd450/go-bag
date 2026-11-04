// The brand mark (#49, #50): a supply case whose outline fills to a score, in the header at the
// household's score, on each kit card at that kit's, and in the browser tab icon.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, PAGE, ROOT } = require("./load");

const html = fs.readFileSync(PAGE, "utf8");
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];

// What a case is filled to, read from its SVG: null when it draws no fill, 100 when the fill has no
// dash, else the dash length. Both outline halves must agree.
function fillOf(svg) {
  const fills = svg.match(/<path[^>]*pathLength="100"[^>]*>/g) || [];
  if (!fills.length) return null;
  assert.equal(fills.length, 2, `two filled halves in ${svg}`);
  const dash = fills.map(p => { const m = p.match(/stroke-dasharray[:=]\s*"?\s*([\d.]+)[ ,]+([\d.]+)/); return m ? `${m[1]} ${m[2]}` : null; });
  assert.equal(dash[0], dash[1], "both halves fill the same");
  if (dash[0] == null) return 100;
  const [len, of] = dash[0].split(" ").map(Number);
  assert.equal(of, 100, "the dash is out of 100");
  return len;
}
const solidParts = svg => ({ rects: (svg.match(/<rect\b/g) || []).length, paths: (svg.match(/<path\b/g) || []).length });

// The stand-in DOM hands back a fresh element on every lookup; this keeps one per selector, so a test
// can read what render() wrote, and lets the tab icon count its writes.
function keepElements(app) {
  app.run(`(() => {
    const q = document.querySelector, els = globalThis.__els = {};
    const icon = globalThis.__icon = { writes: [], href: "" };
    els['link[rel="icon"]'] = { set href(v) { icon.writes.push(v); icon.href = v; }, get href() { return icon.href; }, setAttribute(k, v) { if (k === "href") this.href = v; } };
    document.querySelector = s => els[s] ||= q(s);
  })()`);
}
const iconSvg = href => { assert.match(href, /^data:image\/svg\+xml,/); return decodeURIComponent(href.slice(href.indexOf(",") + 1)); };

test("the case fills to the score: none at 0, a dash of s out of 100 between, no dash at 100", () => {
  const { run } = load();
  for (const s of [0, 34, 62, 75, 100]) {
    const svg = run(`caseMark(${s}, 28)`);
    assert.match(svg, /^<svg[^>]*viewBox="0 0 64 64"/);
    assert.equal(fillOf(svg), s === 0 ? null : s, `score ${s}`);
    // The handle, seam, latches and cross are always there, so it reads as a case even at 0.
    const parts = solidParts(svg);
    assert.equal(parts.rects, 2, `two latches at ${s}`);
    assert.ok(parts.paths >= 5, `handle, two track halves, seam and cross at ${s}`);
  }
});

test("the case clamps and rounds its score, and never throws on a missing one", () => {
  const { run } = load();
  const fill = s => fillOf(run(`caseMark(${s}, 28)`));
  assert.equal(fill(-5), null);
  assert.equal(fill(140), 100);
  assert.equal(fill(62.4), 62);
  assert.equal(fill(99.6), 100);
  for (const s of ["NaN", "undefined", "null", "'abc'"]) {
    assert.doesNotThrow(() => run(`caseMark(${s}, 28)`), s);
    assert.equal(fill(s), null, s);
  }
});

test("colours come from classes, so dark mode recolours the case", () => {
  const { run } = load();
  for (const s of [0, 62, 100]) assert.doesNotMatch(run(`caseMark(${s}, 28)`), /#[0-9a-f]{3,6}\b|rgb\(|(fill|stroke)="(?!none)/i, `score ${s}`);
});

test("strokes thicken at 32px and below, with round caps", () => {
  const { run } = load();
  const width = size => Number(run(`caseMark(62, ${size})`).match(/stroke-width="([\d.]+)"/)[1]);
  assert.equal(width(24), 6.5);
  assert.equal(width(32), 6.5);
  assert.equal(width(48), 5);
  assert.match(run("caseMark(62, 24)"), /stroke-linecap="round"/);
  assert.match(run("caseMark(62, 24)"), /width="24"[^>]*height="24"|height="24"[^>]*width="24"/);
});

test("the header mark shows the household's score, and each kit card its kit's", () => {
  const app = load({ fixture: "tests/household" });
  keepElements(app);
  app.run("S.loaded = true; render()");
  const M = app.json("(() => { const M = model(); return { overall: M.overall, kits: Object.fromEntries(Object.entries(M.kitRes).map(([k, r]) => [k, r.score])) }; })()");
  assert.ok(M.overall > 0 && M.overall < 100, "the standard household is partway");
  assert.equal(fillOf(app.run(`__els[".brand-mark"].innerHTML`)), M.overall);

  const kits = app.run("viewKits(model())");
  const cards = kits.match(/<button class="tag"[\s\S]*?<\/button>/g) || [];
  assert.equal(cards.length, Object.keys(M.kits).length, "one card per kit");
  for (const card of cards) {
    const id = card.match(/data-id="([^"]+)"/)[1];
    const svg = card.match(/<svg[^>]*viewBox="0 0 64 64"[\s\S]*?<\/svg>/);
    assert.ok(svg, `kit ${id} has a case`);
    assert.match(svg[0], /width="24"/);
    assert.equal(fillOf(svg[0]), M.kits[id] === 0 ? null : M.kits[id], `kit ${id}`);
  }
});

test("the header mark follows the score when an item changes it", () => {
  const app = load({ fixture: "tests/household" });
  keepElements(app);
  app.run("S.loaded = true; render()");
  const before = app.run("model().overall");
  app.run(`S.items.push({ id: "x-water", kitId: S.kits[0].id, name: "Water", category: "water", qty: 40, liters: 4 }); render()`);
  const after = app.run("model().overall");
  assert.notEqual(after, before, "the new item moves the score");
  assert.equal(fillOf(app.run(`__els[".brand-mark"].innerHTML`)), after);
});

test("the page has one tab icon", () => {
  assert.equal((html.match(/<link[^>]*rel="icon"/g) || []).length, 1);
  assert.equal((html.match(/<script/g) || []).length, 1, "the icon is drawn by the page's one script");
});

test("the tab icon shows 75 before data loads, then the live household score, rewritten only when it moves", () => {
  const app = load({ fixture: "tests/household" });
  keepElements(app);
  app.run("render()");
  assert.equal(app.run("S.loaded"), false);
  let svg = iconSvg(app.run("__icon.href"));
  assert.equal(fillOf(svg), 75, "the 75 form before data loads");
  assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, "a standalone SVG");
  assert.match(svg, /<rect[^>]*(fill="#2B59D9"|class=)/i, "on a Cobalt tile");
  assert.match(svg, /stroke-width="6\.5"/, "with the small-size strokes");

  app.run("S.loaded = true; render()");
  const overall = app.run("model().overall");
  assert.equal(fillOf(iconSvg(app.run("__icon.href"))), overall);
  const writes = app.run("__icon.writes.length");

  app.run("render(); render()");
  assert.equal(app.run("__icon.writes.length"), writes, "a re-render at the same score leaves it alone");

  app.run(`S.items.push({ id: "x-water", kitId: S.kits[0].id, name: "Water", category: "water", qty: 40, liters: 4 }); render()`);
  const moved = app.run("model().overall");
  assert.notEqual(moved, overall);
  assert.equal(fillOf(iconSvg(app.run("__icon.href"))), moved);
  assert.equal(app.run("__icon.writes.length"), writes + 1);
});

test("the tab icon at 0 and 100 still draws a case", () => {
  const { run } = load();
  for (const [s, fill] of [[0, null], [100, 100]]) {
    const svg = iconSvg(run(`tabIconHref(${s})`));
    assert.equal(fillOf(svg), fill);
    assert.equal(solidParts(svg).rects, 3, "the tile and two latches");
  }
});

test("every fixture renders the header mark at its own score", () => {
  const scenarios = fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
    .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)));
  for (const name of ["tests/household", ...scenarios]) {
    const app = load({ fixture: name });
    keepElements(app);
    app.run("syncDraft(); S.loaded = true");
    for (const v of app.json("VIEWS")) assert.doesNotThrow(() => app.run(`S.view = "${v}"; render()`), `${name} ${v}`);
    const overall = app.run("model().overall");
    const drawn = s => s ? s : null;
    assert.equal(fillOf(app.run(`__els[".brand-mark"].innerHTML`)), drawn(overall ?? 0), name);
    // With no score at all (nothing to weigh), the tab keeps the 75 form.
    assert.equal(fillOf(iconSvg(app.run("__icon.href"))), drawn(overall ?? 75), `${name} tab icon`);
  }
});

test("the brand is Cobalt, and Partway's orange stays the meter's", () => {
  const decl = name => [...css.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, "g"))].map(m => m[1].trim().toUpperCase());
  assert.deepEqual(decl("brand"), ["#2B59D9", "#8AA8FF", "#8AA8FF"], "light, then both dark blocks");
  assert.deepEqual(decl("brand-track"), ["#CCD8F6", "#28385F", "#28385F"]);
  assert.deepEqual(decl("brand-tint"), ["#E8EEFC"]);
  assert.deepEqual(decl("brand-deep"), ["#1E43AE"]);
  assert.deepEqual(decl("meter"), ["#E0612A", "#F07A45", "#F07A45"]);
  // The old brand orange is left only on --meter, so no var(--brand) can still resolve to it.
  for (const old of ["#E0612A", "#F07A45"]) {
    const uses = (css.match(new RegExp(old, "gi")) || []).length;
    assert.equal(uses, decl("meter").filter(v => v === old).length, `${old} appears only as --meter`);
  }
});
