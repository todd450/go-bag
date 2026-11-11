// The public landing page at / (issue #77): web/landing.html, rendered by tools/landing.js with the
// app's own design tokens and the deletion address. It shows a made-up household, never real data,
// loads nothing but the app's own fonts, and sends a visitor who is already signed in to /app.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { render } = require("../tools/landing");
const { load, PAGE, ROOT } = require("./load");
const { chrome } = require("./phone");

const page = fs.readFileSync(PAGE, "utf8");
const ADDRESS = "hello@go-bag.example";
const out = render({ contactEmail: ADDRESS });
// What a reader sees: inline tags run into the words around them, block tags break them.
const text = html => html.replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, " ").replace(/<\/?(a|b|i)\b[^>]*>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
// The landing's one stylesheet; the app's page also has a <style> inside its script (the tab icon), so take its first.
const styleOf = (html, { one = html !== page } = {}) => { const m = html.match(/<style>([\s\S]*?)<\/style>/g); if (one) assert.equal(m.length, 1, "one <style>"); return m[0].slice(7, -8); };

// The page's three token blocks: light, the system dark preference, and the dark theme switch.
const TOKENS = [/^:root \{\n[\s\S]*?\n\}$/m, /^@media \(prefers-color-scheme: dark\) \{\n  :root[\s\S]*?\n  \}\n\}$/m, /^:root\[data-theme="dark"\] \{\n[\s\S]*?\n\}$/m];
const tokenBlocks = html => TOKENS.map(re => (styleOf(html).match(re) || [])[0]);
const ownCss = html => tokenBlocks(html).reduce((css, b) => css.replace(b, ""), styleOf(html));

const PRIVACY = "We store your kits, their photos and who lives in your household, including any health needs you add. Only people signed in to your household can see it.";

test("the privacy line is word for word, ending in the deletion address, or without that sentence when there is none", () => {
  assert.ok(text(out).includes(`${PRIVACY} To have everything deleted, email ${ADDRESS}.`), "the whole line with the address");
  assert.ok(out.includes(`href="mailto:${ADDRESS}"`), "the address is a mail link");
  for (const none of [{}, { contactEmail: "" }, { contactEmail: undefined }, { contactEmail: null }, { contactEmail: "   " }]) {
    const t = text(render(none));
    assert.ok(t.includes(PRIVACY), `${JSON.stringify(none)}: the first two sentences`);
    assert.ok(!/deleted|mailto:/.test(render(none)), `${JSON.stringify(none)}: no deletion sentence and no mail link`);
  }
  assert.ok(text(render()).includes(PRIVACY), "render() with no options");
});

test("the footer names the product with no domain", () => {
  const foot = out.match(/<footer[\s\S]*?<\/footer>/);
  assert.ok(foot, "a footer");
  assert.ok(text(foot[0]).includes("Go Bag"));
  assert.ok(!/\b[a-z0-9-]+\.(example|com|app|org|net|io)\b/i.test(text(foot[0])), "no domain in the footer");
});

test("a padded address from the environment is trimmed; anything that isn't a plain address throws", () => {
  assert.ok(text(render({ contactEmail: `  ${ADDRESS}\n` })).includes(`email ${ADDRESS}.`));
  for (const bad of ["<b>@x", "<b>@x.com", 'a@b.co" onmouseover="alert(1)', "a@b.co?subject=hi", "javascript:alert(1)//@x.com",
    "a@b", "@b.co", "a@", "a b@c.co", "a@b .co", "a@@b.co", "a@b.co, c@d.co", "a@b.co\nb@c.co", "a@-b.co", "a@b-.co", ".a@b.co", "a.@b.co", "a..b@c.co",
    "a@b..co", "a%40b@c.co", "a&amp;@b.co", `${"a".repeat(250)}@b.co`, 42, {}, ["a@b.co"], true]) {
    assert.throws(() => render({ contactEmail: bad }), `${JSON.stringify(bad)} throws`);
  }
  for (const good of ["a@b.co", "first.last+tag@mail.example.org", "x_y-z@sub-domain.example"]) {
    assert.ok(text(render({ contactEmail: good })).includes(`email ${good}.`), good);
  }
});

test("both pairs of buttons, top and bottom, link to the sign-in card's two starts", () => {
  const links = [...out.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => [text(m[2]).trim(), m[1]]);
  const create = links.filter(([t]) => t === "Create an account"), login = links.filter(([t]) => t === "Log in");
  assert.ok(create.length >= 2, "Create an account in the hero and the footer");
  assert.ok(login.length >= 3, "Log in in the top bar, the hero and the footer");
  for (const [, href] of create) assert.equal(href, "/app?start=new");
  for (const [, href] of login) assert.equal(href, "/app?start=login");
  const foot = out.match(/<footer[\s\S]*?<\/footer>/)[0];
  assert.ok(foot.includes('href="/app?start=new"') && foot.includes('href="/app?start=login"'), "both again at the bottom");
});

test("the design tokens are the page's own, byte for byte, and the landing writes no colour of its own", () => {
  const mine = tokenBlocks(page), theirs = tokenBlocks(out);
  mine.forEach((b, i) => assert.ok(b, `the page has token block ${i + 1}`));
  assert.deepEqual(theirs, mine, "the three :root blocks are copied unchanged");
  assert.equal((styleOf(out).match(/:root/g) || []).length, 3, "no other :root block");
  const css = ownCss(out);
  assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), "no hex colour in the landing's CSS");
  assert.ok(!/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(css), "no colour function in the landing's CSS");
  assert.ok(!/--[\w-]+\s*:/.test(css), "the landing declares no tokens of its own");
  const declared = new Set([...mine[0].matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  const used = [...out.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]);
  assert.ok(used.length > 10, "the landing styles itself with the tokens");
  for (const v of used) assert.ok(declared.has(v), `${v} is a token of the page's`);
  const markup = out.replace(/<style>[\s\S]*?<\/style>/, "");
  assert.ok(!/(?<!&)#[0-9a-f]{3,8}\b/i.test(markup), "no hex colour in the markup either");
});

test("the case mark is the page's at 75, and the font links are the page's own", () => {
  const app = load();
  const mark = app.run("caseMark(75, 28)");
  assert.ok(out.includes(mark), "the top bar's case mark is caseMark(75, 28)");
  const pageLinks = new Set(page.match(/<link\b[^>]*>/g));
  const links = out.match(/<link\b[^>]*>/g) || [];
  assert.ok(links.some(l => /fonts\.googleapis\.com\/css2\?family=Inter/.test(l)), "the Inter stylesheet");
  for (const l of links) assert.ok(pageLinks.has(l), `${l} is one of the page's`);
});

test("one inline script, and nothing from anywhere but the page's own Google Fonts links", () => {
  assert.equal((out.match(/<script/gi) || []).length, 1, "exactly one <script>");
  assert.match(out, /<script>(?:(?!<\/script>)[\s\S])+<\/script>/, "inline, with no attributes");
  assert.ok(!/<script[^>]*\bsrc\b/i.test(out), "no <script src");
  for (const tag of ["iframe", "object", "embed", "img", "frame", "base", "form"]) assert.ok(!new RegExp(`<${tag}\\b`, "i").test(out), `no <${tag}>`);
  assert.ok(!/@import|url\(/i.test(styleOf(out)), "the CSS pulls in nothing");
  assert.ok(!/\son[a-z]+\s*=/i.test(out), "no inline event handlers");
  const fonts = new Set([...page.matchAll(/<link\b[^>]*href="([^"]+)"/g)].map(m => m[1]).filter(h => /^https:\/\/fonts\.(googleapis|gstatic)\.com\b/.test(h)));
  const urls = [...out.matchAll(/(?:https?:)?\/\/[^\s"'<>)]+/gi)].map(m => m[0]);
  for (const u of urls) assert.ok(fonts.has(u), `${u} is one of the page's Google Fonts links`);
});

test("it shows the made-up household's real numbers and names no one", () => {
  const t = text(out);
  assert.match(t, /\b17\b/); assert.match(t, /\b31\b/); assert.match(t, /\+14\b/); assert.match(t, /\b6%/); assert.match(t, /\b1%/);
  assert.match(t, /\b17 of 100\b/); assert.match(t, /\bLow\b/);
  for (const kit of ["Hall closet go-bag", "Basement bin", "Trunk bag"]) assert.ok(t.includes(kit), kit);
  assert.ok(t.includes("a made-up family of five") || t.includes("A made-up family of five"), "the household is a made-up family of five");
  const household = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "household.json"), "utf8"));
  const names = household.profile.members.map(m => m.label).filter(Boolean);
  assert.ok(names.length >= 5);
  for (const n of names) assert.ok(!new RegExp(`\\b${n.replace(/\W/g, "\\$&")}\\b`, "i").test(t), `${n} is not named`);
});

// The one script, run against a stand-in localStorage the way a browser runs it.
function visit(entries, { storageThrows = false } = {}) {
  const script = out.match(/<script>([\s\S]*?)<\/script>/)[1];
  const replaced = [];
  const store = new Map(Object.entries(entries));
  const localStorage = { get length() { return store.size; }, key: i => [...store.keys()][i] ?? null, getItem: k => store.has(k) ? store.get(k) : null };
  const ctx = { location: { replace: u => replaced.push(u), assign: u => replaced.push("assign " + u), href: "https://site.example/" } };
  if (storageThrows) Object.defineProperty(ctx, "localStorage", { get() { throw new Error("SecurityError: storage is off"); } });
  else ctx.localStorage = localStorage;
  ctx.window = ctx;
  vm.runInNewContext(script, ctx);
  return replaced;
}

test("a visitor with a stored sign-in goes straight to /app; anyone else stays", () => {
  const session = JSON.stringify({ access_token: "x", refresh_token: "y" });
  assert.deepEqual(visit({ "sb-abc-auth-token": session }), ["/app"]);
  assert.deepEqual(visit({ theme: "dark", "sb-proj123-auth-token": session }), ["/app"], "found among other keys");
  assert.deepEqual(visit({}), [], "empty storage");
  assert.deepEqual(visit({ "sb-abc-auth-token": "" }), [], "an emptied session");
  for (const key of ["sb-abc-auth-token-code-verifier", "sb--auth-token", "xsb-abc-auth-token", "sb-abc-auth-tokens", "auth-token", "supabase.auth.token"]) {
    assert.deepEqual(visit({ [key]: session }), [], `${key} is not a session`);
  }
  assert.deepEqual(visit({}, { storageThrows: true }), [], "storage that throws leaves the page standing");
});

// Real layout needs a real browser: each width runs in its own iframe, whose viewport is that wide.
// The font links are taken out and every host is unresolvable, so the test makes no network calls.
// Each frame names its theme, light or dark, so the computer's own appearance setting can't decide what is measured.
function measure(cases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-landing-"));
  try {
    const attr = s => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const offline = out.replace(/<link\b[^>]*>/g, "");
    const frames = cases.map(([w, theme]) => `<iframe data-k="${w} ${theme}" style="width:${w}px;height:900px;border:0" srcdoc="${attr(offline.replace("<html lang=\"en\">", `<html lang="en" data-theme="${theme}">`))}"></iframe>`).join("");
    const probe = String(() => {
      const d = document.documentElement, vw = d.clientWidth;
      const clipped = [...document.querySelectorAll(".btn, h1, h2, h3, p, b")].filter(e => { const r = e.getBoundingClientRect(); return e.scrollWidth > e.clientWidth + 1 || r.right > vw + 0.5 || r.left < -0.5; }).map(e => e.className + ": " + e.textContent.trim().slice(0, 40));
      return { overflow: d.scrollWidth - vw, clipped, bg: getComputedStyle(document.body).backgroundColor, cols: getComputedStyle(document.querySelector(".hero")).gridTemplateColumns.split(" ").length };
    });
    const run = `<script>onload = () => setTimeout(() => { document.body.dataset.out = JSON.stringify([...document.querySelectorAll("iframe")].map(f => [f.dataset.k, f.contentWindow.eval("(" + ${JSON.stringify(probe)} + ")()")])); }, 500);</script>`;
    fs.writeFileSync(path.join(dir, "probe.html"), `<!doctype html><body>${frames}${run}</body>`);
    const dom = execFileSync(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${path.join(dir, "profile")}`, "--host-resolver-rules=MAP * ~NOTFOUND",
      "--virtual-time-budget=5000", "--dump-dom", `file://${path.join(dir, "probe.html")}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 });
    const m = dom.match(/<body data-out="([^"]*)"/);
    assert.ok(m, "the page reported nothing");
    return new Map(JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")));
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
}

test("at 320, 390 and 1440px, light and dark, nothing scrolls sideways and nothing is clipped", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const cases = [320, 390, 1440].flatMap(w => [[w, "light"], [w, "dark"]]);
  const seen = measure(cases);
  for (const [w, theme] of cases) {
    const r = seen.get(`${w} ${theme}`);
    assert.ok(r, `${w} ${theme} measured`);
    assert.ok(r.overflow <= 0, `${w}px ${theme}: scrolls sideways by ${r.overflow}px`);
    assert.deepEqual(r.clipped, [], `${w}px ${theme}: clipped`);
    assert.equal(r.cols, w >= 1440 ? 2 : 1, `${w}px: ${w >= 1440 ? "two columns" : "stacked"}`);
  }
  for (const w of [320, 390, 1440]) assert.notEqual(seen.get(`${w} light`).bg, seen.get(`${w} dark`).bg, `${w}px: the dark tokens apply`);
});

test("the CLI prints the page for an address, and fails without printing for a bad one", () => {
  const cli = path.join(ROOT, "tools", "landing.js");
  assert.equal(execFileSync(process.execPath, [cli, ADDRESS], { encoding: "utf8" }), out);
  assert.equal(execFileSync(process.execPath, [cli], { encoding: "utf8" }), render({}));
  assert.throws(() => execFileSync(process.execPath, [cli, "<b>@x"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
});
