// Runs the app's script in a fresh Node context with a stand-in DOM, so tests can call its functions.
// Top-level const/let/function declarations stay reachable through run(), which evaluates code in that context.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const PAGE = process.env.GO_BAG_PAGE || path.join(ROOT, "emergency-kit-audit.html");

function appScript() {
  const html = fs.readFileSync(PAGE, "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no <script> in the page");
  // Drop the boot sequence (first render and the claude.ai capability wiring); tests drive state themselves.
  const cut = m[1].search(/\nsyncDraft\(\);\nrender\(\);/);
  if (cut < 0) throw new Error("boot sequence not found: update tests/load.js");
  return m[1].slice(0, cut);
}

function load({ fixture } = {}) {
  const el = () => ({
    addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, setAttribute() {},
    hidden: false, innerHTML: "", textContent: "", style: {}, dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
  });
  const later = [];
  const ctx = vm.createContext({
    console,
    crypto: globalThis.crypto,
    AbortController,
    navigator: {},
    document: { querySelector: el, querySelectorAll: () => [], addEventListener() {}, getElementById: el, createElement: el, body: el() },
    location: { hash: "" },
    window: { scrollTo() {}, matchMedia: () => ({ matches: true }) },
    history: { replaceState() {} },
    // Timers are collected, not run, so toasts and flashes never keep the test process alive.
    setTimeout: fn => later.push(fn),
    clearTimeout() {},
  });
  vm.runInContext(appScript(), ctx, { filename: "emergency-kit-audit.html" });
  const run = code => vm.runInContext(code, ctx);
  // Values built inside the context have that context's prototypes; JSON gives plain ones for deep asserts.
  const json = code => JSON.parse(run(`JSON.stringify(${code})`));
  const app = { run, json, later };
  if (fixture) useFixture(app, fixture);
  return app;
}

// A fixture is a JSON file, named by its path from the repo root without ".json": the standard
// household is tests/household, and the edge cases live under fixtures/, one folder per failure class.
function useFixture(app, name) {
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, name + ".json"), "utf8"));
  app.run(`(f => {
    S.profile = f.profile; S.hazards = f.hazards || null; S.plan = f.plan || null; S.shopping = f.shopping || null;
    S.kits = f.kits || []; S.items = f.items || [];
  })(${JSON.stringify(f)})`);
  return f;
}

module.exports = { load, useFixture, appScript, PAGE, ROOT };
