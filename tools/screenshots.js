#!/usr/bin/env node
// Before/after screenshots of every tab, at phone and desktop width, with a made-up household loaded.
//   node tools/screenshots.js <out dir> [fixture, default tests/household] [base ref, default origin/main]
// Shoots this checkout's page into <out>/after and the base ref's page into <out>/before, both with
// the same fixture, writes <out>/compare.html (each pair side by side, images embedded, so it is one
// file to send), and prints which shots changed. Each shot is the whole tab, top to bottom.
//
// Needs Google Chrome or Chromium (set CHROME to its path if it isn't found) and Node 22, whose
// built-in WebSocket drives Chrome over the DevTools protocol. Plain `chrome --screenshot` can't be
// used: headless Chrome won't make a window narrower than 500px, so a "390px" shot is really a
// 500px layout cropped. Device emulation gives a true phone viewport.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { wrap, coreTag, ROOT } = require("./page.js");

const SIZES = { phone: { width: 390, height: 844, mobile: true }, desktop: { width: 1440, height: 900, mobile: false } };
const MAX_HEIGHT = 8000;
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  if (fs.existsSync(MAC_CHROME)) return MAC_CHROME;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try { return execFileSync("which", [name], { encoding: "utf8" }).trim(); } catch (_) {}
  }
  return null;
}

// Opens a page in headless Chrome and returns its session: send(method, params), once(event), close() and the
// Chrome's pid. Starting Chrome takes about a second, so a process's pages share one Chrome (issue #147); each page
// is a new tab that starts with none of the storage or settings of any page before it, as a new Chrome's would.
// Chrome quits once its last page has been closed for IDLE ms.
// A Chrome that starts but never answers (seen on a busy machine: it sits on about:blank and the test waits for
// ever) is killed and replaced, three starts at most, so a stall fails the run instead of hanging it.
const IDLE = 500;
let shared = null;
async function openChrome(chrome, { wait = 20000, starts = 3 } = {}) {
  for (let n = 1; ; n++) {
    if (!shared || shared.chrome !== chrome || shared.dead) shared = startChrome(chrome);
    const browser = shared;
    // A start's own failure, not a late one from the start before it, which is given up on and still winding down
    let failed;
    const page = await within(openPage(browser).catch(e => { failed = e; return null; }), wait, null);
    if (page) return page;
    quit(browser);
    if (n >= starts) throw failed || new Error(`Chrome didn't answer within ${wait / 1000}s in ${starts} starts`);
  }
}

// The promise's own result, or `otherwise` once ms have passed. The timer is cleared, so it never holds the process open.
function within(promise, ms, otherwise) {
  let timer;
  return Promise.race([promise, new Promise(ok => { timer = setTimeout(ok, ms, otherwise); })]).finally(() => clearTimeout(timer));
}

function startChrome(chrome) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-shots-"));
  const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const browser = { chrome, proc, profile, pages: 0, idle: null, dead: false };
  browser.exited = new Promise(ok => { proc.once("exit", ok); proc.once("error", ok); });
  browser.ready = (async () => {
    const portFile = path.join(profile, "DevToolsActivePort");
    for (let i = 0; i < 100 && !fs.existsSync(portFile) && !browser.dead; i++) await sleep(100);
    if (browser.dead) throw new Error("Chrome was given up on before it answered");
    const [port, wsPath] = fs.readFileSync(portFile, "utf8").split("\n");
    const ws = browser.ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
    if (browser.dead) { ws.close(); throw new Error("Chrome was given up on before it answered"); }
    let next = 0;
    const waiting = new Map();
    browser.events = new Map(); // a page's session id to the listeners waiting on its events
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id && waiting.has(m.id)) { const [ok, fail] = waiting.get(m.id); waiting.delete(m.id); m.error ? fail(new Error(m.error.message)) : ok(m.result); }
      else if (m.method && browser.events.has(m.sessionId)) browser.events.get(m.sessionId).splice(0).forEach(e => e(m));
    };
    browser.call = (method, params = {}, sid) => new Promise((ok, fail) => {
      const id = ++next; waiting.set(id, [ok, fail]); ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
    });
  })();
  return browser;
}

async function openPage(browser) {
  await browser.ready;
  clearTimeout(browser.idle);
  browser.pages++;
  const { call } = browser;
  let targetId;
  try {
    ({ targetId } = await call("Target.createTarget", { url: "about:blank" }));
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    const events = [];
    browser.events.set(sessionId, events);
    const send = (method, params) => call(method, params, sessionId);
    const once = method => new Promise(ok => { const w = m => (m.method === method ? ok(m) : events.push(w)); events.push(w); });
    await send("Page.enable");
    // What a page could leave for the next is what it stored: screen size, touch and the like are the tab's own, and
    // each page has a new tab. Every file:// page shares one store, which Chrome won't clear from outside ("Internal
    // error"), so a blank file:// page clears it. (A browser context per page would too, but then Chrome takes over
    // 5s to quit.)
    const blank = path.join(browser.profile, "blank.html");
    if (!fs.existsSync(blank)) fs.writeFileSync(blank, "<!doctype html><title>blank</title>");
    const loaded = once("Page.loadEventFired");
    await send("Page.navigate", { url: `file://${blank}` });
    await loaded;
    const cleared = await send("Runtime.evaluate", { awaitPromise: true, expression: `(async () => { localStorage.clear(); sessionStorage.clear();
      await Promise.all((await indexedDB.databases()).map(d => new Promise(ok => { const r = indexedDB.deleteDatabase(d.name); r.onsuccess = r.onerror = r.onblocked = ok; })));
      return localStorage.length + (await indexedDB.databases()).length; })()` });
    if (cleared.exceptionDetails || cleared.result.value !== 0) throw new Error(`a new page's storage didn't clear: ${cleared.exceptionDetails?.exception?.description || cleared.result.value}`);
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      browser.events.delete(sessionId);
      await within(call("Target.closeTarget", { targetId }).catch(() => {}), 2000);
      done(browser);
    };
    return { send, once, close, pid: browser.proc.pid };
  } catch (e) {
    if (targetId) call("Target.closeTarget", { targetId }).catch(() => {});
    done(browser);
    throw e;
  }
}

// A page is closed: once none is open for IDLE ms, Chrome quits, so it never outlives the process that started it
function done(browser) {
  if (--browser.pages > 0 || browser.dead) return;
  browser.idle = setTimeout(() => quit(browser), IDLE);
}

async function quit(browser) {
  if (browser.dead) return browser.exited;
  browser.dead = true;
  clearTimeout(browser.idle);
  const { proc, ws } = browser;
  if (shared === browser) shared = null;
  // Browser.close shuts down Chrome's helper processes too: on Linux a plain kill can leave them writing to
  // the profile after the main process exits, and the folder then won't delete (ENOTEMPTY).
  if (ws?.readyState === WebSocket.OPEN) await within(browser.call("Browser.close").catch(() => {}), 2000);
  ws?.close();
  if (proc.exitCode === null && proc.signalCode === null) await within(browser.exited, 5000);
  proc.kill();
  await browser.exited;
  // A leftover temp folder is harmless, so cleaning it up never fails a test.
  try { fs.rmSync(browser.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
}

// The tabs a page has, read from its own VIEWS by a copy of the tests' loader (tests/load.js), so a
// tab added to the page is shot with no edit here. The loader reads its page from GO_BAG_PAGE once,
// when it is first required, so each page is read in a fresh Node. Throws if the loader can't read it.
const LOADER = path.join(ROOT, "tests", "load.js");
function viewsOf(page, loader = LOADER) {
  const code = `process.stdout.write(JSON.stringify(require(${JSON.stringify(loader)}).load().json("VIEWS")))`;
  try {
    return JSON.parse(execFileSync(process.execPath, ["-e", code],
      { env: { ...process.env, GO_BAG_PAGE: page }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch (e) {
    const why = String(e.stderr || "").split("\n").find(l => /^\w*Error\b/.test(l)) || e.message;
    throw new Error(`can't read the tabs of ${page} with ${loader}: ${why}`);
  }
}

// Every tab either page has, once each: this change's tabs in its order, then any only the base has.
// Each page is read with its own version's loader, since a change may move the page's boot sequence
// and update tests/load.js to match. The base is read with its loader (baseLoader, when the base ref
// has one) or else this checkout's; if neither can, the change's tabs are shot, with a warning.
function tabs(base, change, { baseLoader, loader = LOADER, warn = console.warn } = {}) {
  const ours = viewsOf(change, loader);
  const errors = [];
  for (const l of [...new Set([baseLoader, loader])].filter(Boolean)) {
    try { return [...new Set([...ours, ...viewsOf(base, l)])]; } catch (e) { errors.push(e.message); }
  }
  warn(`Warning: shooting only this change's tabs; the base page's tabs couldn't be read (${errors.join("; ")}).`);
  return ours;
}

async function shoot(page, file, view, size, png, n) {
  const { width, height, mobile } = SIZES[size];
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  const loaded = page.once("Page.loadEventFired");
  // A new query string makes each shot a fresh load: the page reads its tab from the hash only at start.
  await page.send("Page.navigate", { url: `file://${file}?shot=${n}#${view}` });
  await loaded;
  await sleep(600); // the fixture database answers on the next tick; let every render and font settle
  const { result } = await page.send("Runtime.evaluate", { expression: "document.documentElement.scrollHeight" });
  const full = Math.min(Math.max(result.value, height), MAX_HEIGHT);
  // Grow the viewport to the whole page, so the fixed tab bar sits at the bottom of the shot, where
  // it is when you scroll to the end, instead of floating at the first screen's edge.
  await page.send("Emulation.setDeviceMetricsOverride", { width, height: full, deviceScaleFactor: 1, mobile });
  await sleep(200);
  const { data } = await page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height: full, scale: 1 } });
  fs.writeFileSync(png, Buffer.from(data, "base64"));
}

async function main([outArg, fixture = "tests/household", base = "origin/main"]) {
  if (!outArg) { console.error("usage: node tools/screenshots.js <out dir> [fixture] [base ref]"); return 2; }
  const chrome = findChrome();
  if (!chrome) { console.error("No Chrome found. Install Google Chrome or set CHROME to its path."); return 1; }
  const out = path.resolve(outArg);
  const dirs = { before: path.join(out, "before"), after: path.join(out, "after") };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(out, "base-page.html"), execFileSync("git", ["-C", ROOT, "show", `${base}:emergency-kit-audit.html`]));
  // The base's core.js goes beside its page (where tests/load.js looks for it), and runs before it. A base from
  // before the split (#113) has none: its core is inline in its page.
  const baseCore = path.join(out, "core.js");
  fs.rmSync(baseCore, { force: true });
  try { fs.writeFileSync(baseCore, execFileSync("git", ["-C", ROOT, "show", `${base}:core.js`], { stdio: ["ignore", "pipe", "ignore"] })); } catch (_) {}
  fs.writeFileSync(path.join(dirs.before, "index.html"), wrap(path.join(out, "base-page.html"), fixture, "", fs.existsSync(baseCore) ? coreTag(baseCore) : ""));
  fs.writeFileSync(path.join(dirs.after, "index.html"), wrap(undefined, fixture));

  // The base ref's own loader reads the base page's tabs; a ref from before tests/load.js has none.
  let baseLoader;
  try {
    const js = execFileSync("git", ["-C", ROOT, "show", `${base}:tests/load.js`], { stdio: ["ignore", "pipe", "ignore"] });
    fs.writeFileSync(baseLoader = path.join(out, "base-load.js"), js);
  } catch (_) {}
  const views = tabs(path.join(out, "base-page.html"), path.join(ROOT, "emergency-kit-audit.html"), { baseLoader });

  const page = await openChrome(chrome);
  const rows = [];
  try {
    let n = 0;
    for (const view of views) for (const size of Object.keys(SIZES)) {
      const name = `${view}-${size}.png`;
      for (const dir of Object.values(dirs)) await shoot(page, path.join(dir, "index.html"), view, size, path.join(dir, name), ++n);
      const [a, b] = Object.values(dirs).map(d => fs.readFileSync(path.join(d, name)));
      rows.push({ name, changed: !a.equals(b), a, b });
    }
  } finally { await page.close(); }

  const img = buf => `<img src="data:image/png;base64,${buf.toString("base64")}">`;
  fs.writeFileSync(path.join(out, "compare.html"), `<!doctype html><meta charset="utf-8"><title>Before and after</title>
<style>body{font:14px system-ui;margin:16px;background:#fff;color:#111}h2{margin:32px 0 8px}.pair{display:flex;gap:16px;align-items:flex-start}
.pair div{flex:1;min-width:0}img{max-width:100%;border:1px solid #ccc}.same{color:#888}</style>
<h1>${base} (left) and this change (right), with ${fixture}</h1>
${rows.map(r => `<h2 class="${r.changed ? "" : "same"}">${r.name.replace(".png", "")}: ${r.changed ? "changed" : "unchanged"}</h2>
<div class="pair"><div>${img(r.a)}</div><div>${img(r.b)}</div></div>`).join("\n")}
`);
  const changed = rows.filter(r => r.changed).map(r => r.name);
  console.log(changed.length ? `Changed: ${changed.join(", ")}` : "No shot changed.");
  console.log(`Screenshots in ${out}/before and ${out}/after; side by side in ${out}/compare.html`);
  return 0;
}

module.exports = { tabs, findChrome, openChrome };

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => { console.error(e.message); process.exitCode = 1; });
}
