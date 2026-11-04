// The brand mark (#49, #50): a supply case whose outline fills to a score, in the header at the
// household's score, on each kit card at that kit's, and in the browser tab icon.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { load, PAGE, ROOT } = require("./load");
const { wrap } = require("../tools/page");

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

// In a real browser: the stand-in DOM finds a link anywhere and lays nothing out, so where the icon
// link sits and how much room a kit name gets can only be seen in Chrome.
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(mac)) return mac;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try { return execFileSync("which", [name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch (_) {}
  }
  return null;
}
const chrome = findChrome();
// CI must have Chrome; a laptop without it skips these.
const needsChrome = { skip: !chrome && !process.env.CI && "needs Chrome", timeout: 60000 };

// Loads the page wrapped the way claude.ai wraps it (its markup lands in <body>), with `fixture`, on
// the Kits tab in headless Chrome `width` pixels wide, and returns what `probe` returns once it has
// settled. The web font is left out, so the test makes no network calls.
function inChrome(fixture, width, probe) {
  assert.ok(chrome, "no Chrome found: install it or set CHROME");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-mark-"));
  try {
    const page = wrap(undefined, fixture).replace(/<link[^>]*fonts\.g[^>]*>/g, "").replace(/<\/body>/,
      `<script>addEventListener("load", () => setTimeout(() => { const p = document.createElement("pre"); p.id = "probe";`
      + ` p.textContent = encodeURIComponent(JSON.stringify((${probe})())); document.body.append(p); }, 500));</script></body>`);
    fs.writeFileSync(path.join(dir, "index.html"), page);
    const out = execFileSync(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
      ...(process.platform === "linux" ? ["--no-sandbox"] : []), `--user-data-dir=${path.join(dir, "profile")}`,
      `--window-size=${width},900`, "--virtual-time-budget=5000", "--dump-dom", `file://${path.join(dir, "index.html")}#kits`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 45000 });
    const m = out.match(/<pre id="probe">([^<]*)<\/pre>/);
    assert.ok(m, "the page settled and the probe ran");
    return JSON.parse(decodeURIComponent(m[1]));
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
}

test("in Chrome, the tab icon link sits in <head>, where browsers read it, at the household's score", needsChrome, () => {
  const got = inChrome("tests/household", 1440, () => {
    const links = [...document.querySelectorAll('link[rel~="icon"]')];
    return { inHead: links.map(l => l.parentNode === document.head), href: links[0] && links[0].getAttribute("href"), overall: model().overall };
  });
  assert.deepEqual(got.inHead, [true], "one icon link, in <head>");
  assert.equal(fillOf(iconSvg(got.href)), got.overall || null);
});

for (const fixture of ["tests/household", "fixtures/empty-and-one/big-household"]) {
  for (const width of [500, 1440]) {
    test(`in Chrome, a kit card's case takes no room from its name (${fixture}, ${width}px)`, needsChrome, () => {
      const got = inChrome(fixture, width, () => {
        const box = el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; };
        const cards = [...document.querySelectorAll(".tag")].map(t => ({
          card: box(t), name: box(t.querySelector("b")), mark: box(t.querySelector(".tag-pct svg")), pct: box(t.querySelector(".tag-pct")),
        }));
        const room = () => [...document.querySelectorAll(".tag b")].map(b => b.clientWidth);
        const withCase = room();
        const hide = document.createElement("style");
        hide.textContent = ".tag-pct svg { display: none }";
        document.head.append(hide);
        return { cards, withCase, withoutCase: room() };
      });
      assert.ok(got.cards.length > 0, "the Kits tab shows kit cards");
      assert.deepEqual(got.withCase, got.withoutCase, "each kit name has the same room with the case drawn as without it");
      for (const { card, name, mark, pct } of got.cards) {
        assert.ok(mark.r - mark.l >= 23.5, "the case is drawn at its size");
        assert.ok(mark.t >= card.t && mark.b <= card.b && mark.r <= card.r, "the case sits inside its card");
        assert.ok(pct.l >= name.r, "the score and its case sit clear of the name");
      }
    });
  }
}

// Text on the brand colour (the tab count badge) must read at WCAG AA, 4.5:1, in light mode and in
// both dark blocks. Each dark block falls back to the light value for any token it doesn't set.
test("text on the brand colour is at least 4.5:1 in every theme", () => {
  const block = re => { const m = css.match(re); assert.ok(m, `token block ${re}`); return m[1]; };
  const tokens = src => Object.fromEntries([...src.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map(m => [m[1], m[2]]));
  const light = tokens(block(/(?:^|\n):root\s*\{([\s\S]*?)\n\}/));
  const themes = {
    light,
    "prefers-color-scheme dark": { ...light, ...tokens(block(/:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)\}/)) },
    'data-theme="dark"': { ...light, ...tokens(block(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)) },
  };
  const lum = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  const badge = css.match(/nav\.tabs \.tab-n\s*\{[^}]*\}/)[0];
  assert.match(badge, /background:\s*var\(--brand\)/, "the badge sits on the brand colour");
  assert.match(badge, /[^-]color:\s*var\(--brand-ink\)/, "the badge's text is --brand-ink");
  for (const [name, t] of Object.entries(themes)) {
    assert.ok(t.brand && t["brand-ink"], `${name} has --brand and --brand-ink`);
    const ratio = contrast(t.brand, t["brand-ink"]);
    assert.ok(ratio >= 4.5, `${name}: ${t["brand-ink"]} on ${t.brand} is ${ratio.toFixed(2)}:1`);
  }
});
