// Runs the app's script (core.js, then the page's own) in a fresh Node context with a stand-in DOM, so tests can call its functions.
// Top-level const/let/function declarations stay reachable through run(), which evaluates code in that context.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const PAGE = process.env.GO_BAG_PAGE || path.join(ROOT, "emergency-kit-audit.html");
// The core (#113), which the page loads before its own script: core.js beside the page. A page from before the
// split has none and carries its core inline.
const CORE = process.env.GO_BAG_CORE || path.join(path.dirname(PAGE), "core.js");
const coreScript = () => (fs.existsSync(CORE) ? fs.readFileSync(CORE, "utf8") : "");

// The page's script. Without `boot` it stops before the boot sequence (first render and the claude.ai
// capability wiring), and tests drive state themselves.
function appScript({ boot = false } = {}) {
  const html = fs.readFileSync(PAGE, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no <script> in the page");
  if (boot) return m[1];
  const cut = m[1].search(/\nsyncDraft\(\);\nrender\(\);/);
  if (cut < 0) throw new Error("boot sequence not found: update tests/load.js");
  return m[1].slice(0, cut);
}

// With `boot`, the page starts the way it does on claude.ai, with `claude` as window.claude (leave it
// out to start with no capabilities, as it does outside claude.ai). `hash` is the address's #part it starts with.
function load({ fixture, boot = false, claude, hash = "" } = {}) {
  const el = () => ({
    addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, setAttribute() {}, focus() {},
    hidden: false, innerHTML: "", textContent: "", style: {}, dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
  });
  const later = [];
  // The page's document listeners, kept so a test can fire an input or change event at them.
  const listeners = {};
  const ctx = vm.createContext({
    console,
    crypto: globalThis.crypto,
    AbortController,
    navigator: {},
    document: { querySelector: el, querySelectorAll: () => [], addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }, getElementById: el, createElement: el, body: el() },
    location: { hash },
    window: { scrollTo() {}, matchMedia: () => ({ matches: true }), claude },
    history: { replaceState() {} },
    // Timers are collected, not run, so toasts and flashes never keep the test process alive.
    setTimeout: fn => later.push(fn),
    clearTimeout() {},
  });
  vm.runInContext(coreScript(), ctx, { filename: "core.js" });
  vm.runInContext(appScript({ boot }), ctx, { filename: "emergency-kit-audit.html" });
  const run = code => vm.runInContext(code, ctx);
  // Values built inside the context have that context's prototypes; JSON gives plain ones for deep asserts.
  const json = code => JSON.parse(run(`JSON.stringify(${code})`));
  // Fires an event of `type` at a stand-in target ({ dataset, value, ... }) and waits for every handler.
  const fire = (type, target) => Promise.all((listeners[type] || []).map(fn => fn({ target: { closest: () => null, ...target }, preventDefault() {} })));
  const app = { run, json, later, fire };
  if (fixture) useFixture(app, fixture);
  return app;
}

// A fixture is a JSON file, named by its path from the repo root without ".json": the standard
// household is tests/household, and the edge cases live under fixtures/, one folder per failure class.
function useFixture(app, name) {
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, name + ".json"), "utf8"));
  // The household docs come from the page's own list, so every doc the page loads, the tests load too.
  app.run(`(f => {
    for (const k of HOUSEHOLD_DOCS) S[k] = f[k] || null;
    S.kits = f.kits || []; S.items = f.items || [];
  })(${JSON.stringify(f)})`);
  return f;
}

module.exports = { load, useFixture, appScript, PAGE, CORE, ROOT };
