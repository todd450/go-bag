// The sign-in card (web/signin.js, issue #76): one email form for sign-up and log-in, then a
// "Check your inbox" step. It runs here in its own context with a stand-in DOM and a stand-in
// supabase-js client, the way tests/web-runtime.test.js runs the runtime: no network, no browser.
// The last test lays it out in a real browser, and skips when there's no Chrome.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { ROOT } = require("./load");
const { chrome } = require("./phone");
const { wrap } = require("../tools/page");

const SIGNIN = fs.readFileSync(path.join(ROOT, "web", "signin.js"), "utf8");
const PAGE = fs.readFileSync(path.join(ROOT, "emergency-kit-audit.html"), "utf8");
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
const LONG = "maria.delacruz-whitfield@family-mail.example.org";
const MARKUP = '"<img src=x onerror=alert(1)>"@example.com';

// A stand-in DOM: just enough of Element for the card, recording every element made and every
// string handed to innerHTML, so a test can prove an address never becomes markup.
function fakeDom() {
  const made = [], html = [];
  const doc = { activeElement: null };
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.childNodes = []; this.attrs = {}; this.on = {}; this.className = ""; this.disabled = false; this.value = ""; }
    append(...kids) { for (const k of kids) { const n = typeof k === "string" ? { text: k } : k; if (n.parentNode) n.parentNode.childNodes = n.parentNode.childNodes.filter(c => c !== n); n.parentNode = this; this.childNodes.push(n); } }
    replaceChildren(...kids) { this.childNodes = []; this.append(...kids); }
    get children() { return this.childNodes.filter(n => n instanceof El); }
    set textContent(s) { this.childNodes = [{ text: String(s) }]; }
    get textContent() { return this.childNodes.map(n => n instanceof El ? n.textContent : n.text || "").join(""); }
    set innerHTML(s) { html.push(String(s)); this.childNodes = [{ markup: String(s) }]; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    hasAttribute(k) { return Object.hasOwn(this.attrs, k); }
    addEventListener(type, fn) { (this.on[type] ||= []).push(fn); }
    fire(type) { return Promise.all((this.on[type] || []).map(fn => fn({ type, target: this, preventDefault() {} }))); }
    focus() { doc.activeElement = this; }
  }
  Object.assign(doc, {
    head: new El("head"), body: new El("body"),
    createElement: tag => { const el = new El(tag); made.push(el); return el; },
    addEventListener() {},
  });
  return { document: doc, made, html, El };
}

// Every element under `root`, depth first.
const all = root => root.children.flatMap(c => [c, ...all(c)]);

// Runs web/signin.js in a fresh context and returns what a test needs to drive the card.
function signin({ search = "", hash = "", senderEmail, answer = () => ({ data: {}, error: null }) } = {}) {
  const dom = fakeDom();
  const calls = [], replaced = [], reloads = [];
  const sb = { auth: { signInWithOtp: async arg => { calls.push(JSON.parse(JSON.stringify(arg))); return answer(arg); } } };
  const window = { GO_BAG_CONFIG: senderEmail ? { supabaseUrl: "https://db.example", supabaseKey: "pk", senderEmail } : { supabaseUrl: "https://db.example", supabaseKey: "pk" } };
  const location = { origin: "https://go-bag.example", pathname: "/app", search, hash, reload: () => reloads.push(1) };
  vm.runInNewContext(SIGNIN, {
    window, document: dom.document, location, URLSearchParams,
    history: { replaceState: (...a) => replaced.push(a) },
    // Through the main context's timers and clock, so node:test's mock timers drive the countdown.
    // A real countdown never holds the test run open.
    setInterval: (...a) => { const id = setInterval(...a); id.unref?.(); return id; }, clearInterval: (...a) => clearInterval(...a),
    setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a), Date: globalThis.Date,
  });
  const TEXT = window.goBagSignIn.TEXT;
  const card = () => {
    const c = dom.document.body.children.filter(c => c.className.split(" ").includes("gb-auth"));
    assert.equal(c.length, 1, "one card covers the page");
    return c[0];
  };
  const els = () => all(card());
  const find = (tag, text) => els().find(e => e.tagName === tag && (text === undefined || e.textContent.trim() === text));
  const ui = {
    TEXT, sb, calls, replaced, reloads, dom, card, els, find,
    open: opts => window.goBagSignIn(sb, opts),
    heading: () => find("H2").textContent,
    text: () => card().textContent,
    input: () => find("INPUT"),
    button: label => find("BUTTON", label),
    // Types an address and sends the form, then waits for the answer.
    send: async email => { ui.input().value = email; await find("FORM").fire("submit"); await settle(); },
  };
  return ui;
}

test("start=new and start=login each show their own heading and line, and no start shows Log in", async () => {
  const seen = {};
  for (const search of ["?start=new", "?start=login", "", "?start=bogus"]) {
    const ui = signin({ search });
    await ui.open();
    seen[search] = { heading: ui.heading(), text: ui.text() };
    assert.ok(ui.input(), "there's an email field");
    assert.equal(ui.input().getAttribute("type"), "email");
    assert.ok(ui.button(ui.TEXT.send), "and a send button");
  }
  const { TEXT } = signin();
  assert.equal(seen["?start=new"].heading, TEXT.newHeading);
  assert.ok(seen["?start=new"].text.includes(TEXT.newLead) && seen["?start=new"].text.includes(TEXT.newFoot));
  assert.equal(seen["?start=login"].heading, TEXT.loginHeading);
  assert.ok(seen["?start=login"].text.includes(TEXT.loginLead) && seen["?start=login"].text.includes(TEXT.loginFoot));
  assert.notEqual(TEXT.newHeading, TEXT.loginHeading);
  assert.notEqual(TEXT.newLead, TEXT.loginLead);
  assert.deepEqual(seen[""], seen["?start=login"], "no start reads as Log in");
  assert.deepEqual(seen["?start=bogus"], seen["?start=login"], "an unknown start reads as Log in");
});

test("a valid address is sent once, trimmed and lower-cased, with the link back to /app, then the sent step names it", async () => {
  const ui = signin({ search: "?start=new" });
  await ui.open();
  ui.input().value = "  Maria.DelaCruz-Whitfield@Family-Mail.Example.org ";
  const form = ui.find("FORM");
  await Promise.all([form.fire("submit"), form.fire("submit")]);
  await settle();
  assert.equal(ui.calls.length, 1, "a double submit sends one link");
  assert.deepEqual(ui.calls[0], { email: LONG, options: { emailRedirectTo: "https://go-bag.example/app" } });
  assert.equal(ui.heading(), ui.TEXT.sentHeading);
  const addr = ui.els().filter(e => e.textContent === LONG && e.children.length === 0);
  assert.equal(addr.length, 1, "the address sits whole in its own element");
  assert.ok(!ui.input(), "the form is gone");
  for (const k of ["sentTo", "fromName", "subjectLine", "linkLife", "noEmail", "closeTab", "otherEmail"]) assert.ok(ui.text().includes(ui.TEXT[k]), k);
});

test("an address that isn't whole sends nothing and marks the field", async () => {
  for (const bad of ["maria@gmail", "", "   ", "maria", "@example.com", "maria@", "ma ria@example.com", "maria@example..com"]) {
    const ui = signin();
    await ui.open();
    await ui.send(bad);
    assert.equal(ui.calls.length, 0, `nothing sent for ${JSON.stringify(bad)}`);
    assert.ok(ui.text().includes(ui.TEXT.invalid), bad);
    assert.equal(ui.input().getAttribute("aria-invalid"), "true");
    const msg = ui.els().find(e => e.textContent === ui.TEXT.invalid);
    assert.equal(ui.input().getAttribute("aria-describedby"), msg.getAttribute("id"), "the field points at its message");
    assert.equal(ui.dom.document.activeElement, ui.input(), "focus goes back to the field");
  }
  const ui = signin();
  await ui.open();
  await ui.send("maria@gmail");
  await ui.send("maria@gmail.com");
  assert.equal(ui.calls.length, 1, "once fixed, it sends");
});

test("a 429 says to wait, and any other failure says the send failed", async () => {
  const answers = {
    tooMany: [() => ({ error: { status: 429, code: "over_email_send_rate_limit", message: "rate" } }), () => ({ error: { status: 400, code: "over_email_send_rate_limit" } })],
    sendFailed: [() => ({ error: { status: 500, message: "boom" } }), () => { throw new TypeError("Failed to fetch"); }, () => ({ error: { status: 0 } })],
  };
  for (const [key, list] of Object.entries(answers)) for (const answer of list) {
    const ui = signin({ answer });
    await ui.open();
    await ui.send("alex@example.com");
    assert.equal(ui.calls.length, 1);
    assert.ok(ui.text().includes(ui.TEXT[key]), key);
    assert.equal(ui.heading(), ui.TEXT.loginHeading, "the form stays up");
    assert.equal(ui.input().value, "alex@example.com", "with the address still in it");
    assert.equal(ui.button(ui.TEXT.send).disabled, false, "and the button usable again");
  }
});

test("Send it again waits 60 seconds with a countdown, then sends once more; Use a different email goes back with the address filled", async t => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
  const ui = signin({ search: "?start=new" });
  await ui.open();
  await ui.send("alex@example.com");
  const again = () => ui.els().find(e => e.tagName === "BUTTON" && e.disabled !== undefined && e.textContent !== ui.TEXT.otherEmail);
  assert.equal(again().disabled, true);
  assert.match(again().textContent, /1:00/);
  t.mock.timers.tick(18000);
  assert.equal(again().disabled, true);
  assert.equal(again().textContent, ui.TEXT.resendIn.replace("{time}", "0:42"));
  await again().fire("click");
  await settle();
  assert.equal(ui.calls.length, 1, "a click while it waits sends nothing");
  t.mock.timers.tick(42000);
  assert.equal(again().disabled, false);
  assert.equal(again().textContent, ui.TEXT.resend);
  await again().fire("click");
  await settle();
  assert.equal(ui.calls.length, 2);
  assert.deepEqual(ui.calls[1], ui.calls[0], "the same address, the same link back");
  assert.equal(again().disabled, true, "and it waits again");

  await ui.button(ui.TEXT.otherEmail).fire("click");
  assert.equal(ui.heading(), ui.TEXT.newHeading, "back to the form");
  assert.equal(ui.input().value, "alex@example.com");
  assert.equal(ui.dom.document.activeElement, ui.input());
  t.mock.timers.tick(120000);
  assert.equal(ui.heading(), ui.TEXT.newHeading, "the old countdown doesn't redraw anything");
});

test("a 429 on Send it again says to wait, and holds the button for 5 minutes", async t => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
  let n = 0;
  const ui = signin({ answer: () => (n++ ? { error: { status: 429 } } : { error: null }) });
  await ui.open();
  await ui.send("alex@example.com");
  t.mock.timers.tick(60000);
  await ui.button(ui.TEXT.resend).fire("click");
  await settle();
  assert.equal(ui.heading(), ui.TEXT.sentHeading);
  assert.ok(ui.text().includes(ui.TEXT.tooMany));
  assert.ok(ui.text().includes(ui.TEXT.resendIn.replace("{time}", "5:00")));
  t.mock.timers.tick(300000);
  assert.ok(ui.button(ui.TEXT.resend));
});

test("an expired link, in the hash or the query, gets its own card and is cleared from the address", async () => {
  for (const [search, hash, left] of [
    ["", "#error_code=otp_expired&error=access_denied&error_description=Email+link+is+invalid+or+has+expired", "/app"],
    ["?error_code=otp_expired", "", "/app"],
    ["?start=new&error=access_denied&error_code=otp_expired", "", "/app?start=new"],
  ]) {
    const ui = signin({ search, hash });
    await ui.open();
    assert.equal(ui.heading(), ui.TEXT.expiredHeading, search + hash);
    assert.ok(ui.text().includes(ui.TEXT.expiredLead));
    assert.ok(ui.input(), "with the field");
    assert.ok(ui.button(ui.TEXT.expiredSend), "and the new-link button");
    assert.equal(ui.replaced.length, 1, "the error leaves the address");
    assert.equal(ui.replaced[0][2], left);
    await ui.send("alex@example.com");
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.heading(), ui.TEXT.sentHeading);
  }
});

test("any other error in the link says it didn't work, on the form", async () => {
  for (const [search, hash] of [["", "#error=server_error&error_description=Database+error"], ["?start=new&error=access_denied", ""]]) {
    const ui = signin({ search, hash });
    await ui.open();
    assert.ok(ui.text().includes(ui.TEXT.linkFailed), search + hash);
    assert.ok(ui.input());
    assert.equal(ui.replaced.length, 1);
    assert.doesNotMatch(ui.replaced[0][2], /error/);
  }
  const clean = signin();
  await clean.open();
  assert.equal(clean.replaced.length, 0, "a clean address is left alone");
  assert.ok(!clean.text().includes(clean.TEXT.linkFailed));
});

test("{ state: 'unavailable' } says the household couldn't open, and Try again reloads", async () => {
  const ui = signin();
  await ui.open({ state: "unavailable" });
  assert.equal(ui.heading(), ui.TEXT.unavailableHeading);
  assert.ok(!ui.input(), "no form");
  await ui.button(ui.TEXT.retry).fire("click");
  assert.equal(ui.reloads.length, 1);
});

test("drawn again, the card replaces itself and stops its countdown", async t => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
  const ui = signin();
  await ui.open();
  await ui.send("alex@example.com");
  await ui.open({ state: "unavailable" });
  t.mock.timers.tick(60000);
  ui.card();
  assert.equal(ui.heading(), ui.TEXT.unavailableHeading);
  assert.equal(ui.dom.document.head.children.length, 1, "the styles go in once");
});

test("an address holding markup is shown as text, and nothing is built from it", async () => {
  const ui = signin();
  await ui.open();
  await ui.send(MARKUP);
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.heading(), ui.TEXT.sentHeading);
  assert.ok(ui.els().some(e => e.textContent === MARKUP && e.children.length === 0), "the address is a text node");
  assert.ok(!ui.dom.made.some(e => e.tagName === "IMG"), "no <img> was made");
  assert.ok(!ui.dom.html.some(s => s.includes("img") || s.includes("example.com")), "no address went through innerHTML");
  await ui.button(ui.TEXT.otherEmail).fire("click");
  assert.equal(ui.input().value, MARKUP);
});

test("the sender's address shows only when it's configured", async () => {
  for (const senderEmail of ["sign-in@go-bag.example", undefined]) {
    const ui = signin({ senderEmail });
    await ui.open();
    await ui.send("alex@example.com");
    const from = ui.els().find(e => e.tagName === "DD" && e.textContent.includes(ui.TEXT.fromName));
    assert.ok(from, "a From line names the product");
    assert.equal(from.textContent.includes("(sign-in@go-bag.example)"), !!senderEmail);
    assert.ok(!from.textContent.includes("undefined") && !from.textContent.includes("()"));
  }
});

// The card's CSS, as the card puts it in the page.
async function cardCss() {
  const ui = signin();
  await ui.open();
  return ui.dom.document.head.children.map(s => s.textContent).join("\n");
}

test("the card is drawn only in the page's own tokens, with no colour of its own", async () => {
  const css = await cardCss();
  assert.ok(css.length > 0);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, "no hex colour");
  assert.doesNotMatch(css, /\b(rgba?|hsla?|oklch|lab|lch|color-mix)\(/i, "no colour function");
  assert.doesNotMatch(SIGNIN, /#[0-9a-f]{3}(?:[0-9a-f]{3})?\b(?![\w-])/i, "no hex colour anywhere in the file, the mark included");
  const root = PAGE.match(/:root\s*\{([\s\S]*?)\}/)[1];
  const declared = new Set([...root.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]));
  assert.ok(used.size > 0);
  for (const v of used) assert.ok(declared.has(v), `${v} is declared in the page's :root`);
  for (const m of css.matchAll(/--[\w-]+\s*:/g)) assert.fail(`the card declares a custom property of its own: ${m[0]}`);
});

test("every class the card uses is prefixed gb-auth", async () => {
  const css = await cardCss();
  const cssClasses = [...css.replace(/\{[^}]*\}/g, "{}").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]);
  const ui = signin({ senderEmail: "sign-in@go-bag.example" });
  await ui.open();
  await ui.send("alex@example.com");
  const elClasses = ui.dom.made.flatMap(e => e.className.split(/\s+/).filter(Boolean));
  const svgClasses = ui.dom.html.flatMap(s => [...s.matchAll(/class="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/)));
  assert.ok(cssClasses.length && elClasses.length && svgClasses.length);
  for (const c of [...cssClasses, ...elClasses, ...svgClasses]) assert.match(c, /^gb-auth/, c);
});

test("every string the card shows comes from TEXT", async t => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout", "Date"], now: 0 });
  const { TEXT } = signin();
  const templates = Object.values(TEXT).filter(v => v.includes("{"))
    .map(v => new RegExp("^" + v.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\?\{\w+\}/g, ".+") + "$"));
  const known = new Set(Object.values(TEXT));
  const sender = "sign-in@go-bag.example";
  const shown = [];
  const look = ui => {
    for (const e of ui.els()) {
      for (const n of e.childNodes) if (n.text !== undefined && n.text.trim()) shown.push(n.text);
      for (const a of ["placeholder", "aria-label", "title", "alt", "value"]) if (e.getAttribute(a)) shown.push(e.getAttribute(a));
    }
  };
  const states = [
    [{ search: "?start=new" }, async () => {}],
    [{}, ui => ui.send("maria@gmail")],
    [{ answer: () => ({ error: { status: 429 } }) }, ui => ui.send("alex@example.com")],
    [{ answer: () => ({ error: { status: 500 } }) }, ui => ui.send("alex@example.com")],
    [{ senderEmail: sender }, ui => ui.send("alex@example.com")],
    [{}, async ui => { await ui.send("alex@example.com"); t.mock.timers.tick(60000); }],
    [{ hash: "#error_code=otp_expired" }, async () => {}],
    [{ hash: "#error=server_error" }, async () => {}],
  ];
  for (const [opts, act] of states) {
    const ui = signin(opts);
    await ui.open();
    look(ui);
    await act(ui);
    look(ui);
  }
  const ui = signin();
  await ui.open({ state: "unavailable" });
  look(ui);
  const ok = s => known.has(s) || templates.some(r => r.test(s)) || s === "alex@example.com" || s === "maria@gmail" || s === `(${sender})`;
  for (const s of new Set(shown)) assert.ok(ok(s), `"${s}" is not from TEXT`);
  for (const s of ["sentHeading", "tooMany", "sendFailed", "invalid", "expiredHeading", "linkFailed", "unavailableHeading", "resend"]) assert.ok(shown.includes(TEXT[s]), `${s} was seen`);
});

test("the preview writes one page, with the card and a stand-in client that answers per ?result", async () => {
  const { write, previewClient } = require("../tools/signin-preview");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-signin-"));
  try {
    write(dir);
    assert.deepEqual(fs.readdirSync(dir), ["index.html"]);
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    assert.ok(html.includes(`<body>${PAGE}</body>`), "the page, unchanged");
    assert.ok(html.includes(SIGNIN.trim()), "the card's script, inline");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const ask = async result => (await previewClient("?result=" + result).auth.signInWithOtp({ email: "alex@example.com" })).error;
  assert.equal(await ask("ok"), null);
  assert.equal((await ask("429")).status, 429);
  assert.ok((await ask("fail")).status >= 500);
  assert.equal((await previewClient("").auth.signInWithOtp({ email: "alex@example.com" })).error, null, "no result sends");
});

// In a real browser, at 390 and 1440 px: every state with the long address fits, and nothing scrolls
// sideways. Each frame draws the card over the page, then reports what it measured.
test("at 390 and 1440 px every state fits the long address and nothing scrolls sideways", { skip: !chrome && "no Chrome found (set CHROME)" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-signin-"));
  try {
    const states = {
      form: ["ok", null], sent: ["ok", LONG], tooMany: ["429", LONG], failed: ["fail", LONG],
      invalid: ["ok", "maria.delacruz-whitfield@family-mail"], expired: ["ok", "#error_code=otp_expired"], unavailable: ["ok", "unavailable"],
    };
    const drive = (state, result, arg) => `(async () => {
      const sb = { auth: { signInWithOtp: async () => (${JSON.stringify(result)} === "ok" ? { error: null } : { error: { status: ${JSON.stringify(result)} === "429" ? 429 : 500 } }) } };
      const arg = ${JSON.stringify(arg)};
      await goBagSignIn(sb, arg === "unavailable" ? { state: "unavailable" } : undefined);
      const card = document.querySelector(".gb-auth");
      if (arg && arg.includes("@")) { card.querySelector("input").value = arg; card.querySelector("form").requestSubmit(); }
    })()`;
    const measure = `(() => {
      const card = document.querySelector(".gb-auth"), w = innerWidth;
      const over = [...card.querySelectorAll("*")].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.left < -0.5 || r.right > w + 0.5); }).map(e => e.tagName + "." + e.getAttribute("class"));
      return { h: card.querySelector("h2").textContent, text: card.textContent, sideways: card.scrollWidth > card.clientWidth || document.documentElement.scrollWidth > w, over };
    })()`;
    // The page with the card's script, as a file each frame opens; the expired one opens it with the
    // error Supabase puts in the address.
    fs.writeFileSync(path.join(dir, "page.html"), wrap(undefined, undefined, `<script>${SIGNIN}</script>`));
    const frames = [390, 1440].flatMap(w => Object.entries(states).map(([s, [, arg]]) =>
      `<iframe data-k="${s}@${w}" style="width:${w}px;height:844px;border:0" src="page.html${arg && arg.startsWith("#") ? arg : ""}"></iframe>`)).join("");
    const states_ = JSON.stringify(Object.fromEntries(Object.entries(states).map(([k, [r, a]]) => [k, drive(k, r, a)])));
    // Each frame reports what it measured, or what went wrong.
    const probe = `<script>const S = ${states_.replace(/</g, "\\u003c")}, M = ${JSON.stringify(measure).replace(/</g, "\\u003c")};
      const each = fn => [...document.querySelectorAll("iframe")].map(fr => { try { return [fr.dataset.k, fn(fr)]; } catch (e) { return [fr.dataset.k, { err: String(e) }]; } });
      onload = () => setTimeout(() => {
        each(fr => fr.contentWindow.eval(S[fr.dataset.k.split("@")[0]]));
        setTimeout(() => {
          document.body.dataset.out = JSON.stringify(each(fr => fr.contentWindow.eval(M)));
        }, 1000);
      }, 1000);</script>`;
    fs.writeFileSync(path.join(dir, "probe.html"), `<!doctype html><body>${frames}${probe}</body>`);
    // --allow-file-access-from-files lets the probe reach into frames opened from files.
    const out = execFileSync(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--allow-file-access-from-files", `--user-data-dir=${path.join(dir, "profile")}`,
      "--virtual-time-budget=8000", "--dump-dom", `file://${path.join(dir, "probe.html")}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 });
    const m = out.match(/<body data-out="([^"]*)"/);
    assert.ok(m, "the page reported nothing");
    const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    const got = new Map(JSON.parse(unesc(m[1])));
    const { TEXT } = signin();
    const want = { form: TEXT.loginHeading, sent: TEXT.sentHeading, tooMany: TEXT.loginHeading, failed: TEXT.loginHeading, invalid: TEXT.loginHeading, expired: TEXT.expiredHeading, unavailable: TEXT.unavailableHeading };
    for (const [k, r] of got) {
      const state = k.split("@")[0];
      assert.equal(r.err, undefined, k);
      assert.equal(r.h, want[state], k);
      assert.equal(r.sideways, false, `${k} scrolls sideways`);
      assert.deepEqual(r.over, [], `${k}: these stick out of the screen`);
    }
    assert.ok(got.get("sent@390").text.includes(LONG));
    assert.ok(got.get("tooMany@390").text.includes(TEXT.tooMany));
    assert.ok(got.get("failed@390").text.includes(TEXT.sendFailed));
    assert.ok(got.get("invalid@390").text.includes(TEXT.invalid));
    assert.equal(got.size, 14);
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
});
