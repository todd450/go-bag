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
const { wrap, ROOT } = require("./page.js");

const VIEWS = ["overview", "kits", "shop", "household", "plan"];
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

// Starts headless Chrome and returns a page session: send(method, params) and once(event).
async function openChrome(chrome) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-shots-"));
  const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const [port, wsPath] = fs.readFileSync(portFile, "utf8").split("\n");
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let next = 0, sessionId;
  const waiting = new Map(), events = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && waiting.has(m.id)) { const [ok, fail] = waiting.get(m.id); waiting.delete(m.id); m.error ? fail(new Error(m.error.message)) : ok(m.result); }
    else if (m.method) events.splice(0).forEach(e => e(m));
  };
  const call = (method, params = {}, sid) => new Promise((ok, fail) => {
    const id = ++next; waiting.set(id, [ok, fail]); ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
  });
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  ({ sessionId } = await call("Target.attachToTarget", { targetId, flatten: true }));
  const send = (method, params) => call(method, params, sessionId);
  const once = method => new Promise(ok => { const w = m => (m.method === method ? ok(m) : events.push(w)); events.push(w); });
  const close = async () => {
    ws.close();
    const exited = new Promise(ok => proc.once("exit", ok));
    proc.kill();
    await exited; // Chrome writes to its profile until it exits
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  };
  await send("Page.enable");
  return { send, once, close };
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
  fs.writeFileSync(path.join(dirs.before, "index.html"), wrap(path.join(out, "base-page.html"), fixture));
  fs.writeFileSync(path.join(dirs.after, "index.html"), wrap(undefined, fixture));

  const page = await openChrome(chrome);
  const rows = [];
  try {
    let n = 0;
    for (const view of VIEWS) for (const size of Object.keys(SIZES)) {
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

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => { console.error(e.message); process.exitCode = 1; });
}
