// The page's core (issue #112): data tables, the household model, scoring, shopping and packing, between the
// "core begins" and "core ends" comments. It runs with no page and no stand-in DOM, which is what lets it move
// into a file of its own (#113), and it scores every household exactly as the whole page does.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { load, appScript, ROOT } = require("./load");

function coreScript() {
  const js = appScript({ boot: true });
  const from = js.indexOf("core begins"), to = js.indexOf("core ends");
  assert.ok(from >= 0 && to > from, "the core's start and end comments are in the page's script");
  return js.slice(js.lastIndexOf("\n", from) + 1, js.lastIndexOf("\n", to) + 1);
}

// Only the core, in a context with nothing but JavaScript's own globals (and crypto, for a shopping line's id).
function loadCore() {
  const ctx = vm.createContext({ crypto: globalThis.crypto });
  vm.runInContext(coreScript(), ctx, { filename: "core" });
  const run = code => vm.runInContext(code, ctx);
  return { run, json: code => JSON.parse(run(`JSON.stringify(${code})`)) };
}

const fixture = name => JSON.parse(fs.readFileSync(path.join(ROOT, name + ".json"), "utf8"));
const households = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

// Everything the core works out for a household: each emergency, each kit, the gaps and what closing them is
// worth, each shopping line, and the best pack for each go-bag and car kit.
const SUMMARY = `(M => ({
  overall: M.overall,
  results: M.results.map(r => [r.hz.id, r.rel, r.wt, r.score, r.rows.map(x => [x.cat, x.need, x.have, x.cov])]),
  kits: Object.entries(M.kitRes).map(([id, r]) => [id, r.score, r.rows.map(x => [x.cat, x.need, x.have])]),
  gaps: M.gaps.map(g => [g.cat, g.essential || "", g.imp, scoreIfFilled(M, [g])]),
  shop: M.gaps.map(g => { const e = shopFromGap(g, M.h), i = shopInfo(e, M); return [e.text, e.qty, i.line, i.price, i.gain]; }),
  pack: HOUSEHOLD.kits.map(k => { const lim = kitLimits(k, M.h); if (!lim) return null;
    const P = packPlan(k, M.kitRes[k.id], lim); return [P.g, P.ml, P.best?.score ?? null, P.takeOut.length, P.swaps.length]; }),
}))(model())`;

test("the core runs on its own, with no page, and scores the standard household as the page does", () => {
  const core = loadCore();
  assert.equal(core.run("typeof document + typeof window + typeof S"), "undefinedundefinedundefined");
  const f = fixture("tests/household");
  core.run(`(f => { for (const k of HOUSEHOLD_DOCS) HOUSEHOLD[k] = f[k] || null; HOUSEHOLD.kits = f.kits || []; HOUSEHOLD.items = f.items || []; })(${JSON.stringify(f)})`);
  const page = load({ fixture: "tests/household" });
  const score = core.json("model().overall");
  assert.ok(Number.isInteger(score) && score > 0, `a real score: ${score}`);
  assert.equal(score, page.json("model().overall"));
});

for (const name of households) {
  test(`${name}: the core alone works out everything the page does`, () => {
    const core = loadCore(), f = fixture(name);
    core.run(`(f => { for (const k of HOUSEHOLD_DOCS) HOUSEHOLD[k] = f[k] || null; HOUSEHOLD.kits = f.kits || []; HOUSEHOLD.items = f.items || []; })(${JSON.stringify(f)})`);
    assert.deepEqual(core.json(SUMMARY), load({ fixture: name }).json(SUMMARY));
  });
}

test("the saved household has one owner: S's fields of the same names read and write the core's", () => {
  const { run } = load({ fixture: "tests/household" });
  for (const k of run(`[...HOUSEHOLD_DOCS, "kits", "items"]`)) {
    assert.ok(run(`S.${k} === HOUSEHOLD.${k}`), `S.${k} reads HOUSEHOLD.${k}`);
    run(`S.${k} = { mark: "from S" }`);
    assert.equal(run(`HOUSEHOLD.${k}.mark`), "from S", `S.${k} writes HOUSEHOLD.${k}`);
    run(`HOUSEHOLD.${k} = { mark: "from the core" }`);
    assert.equal(run(`S.${k}.mark`), "from the core", `S.${k} follows HOUSEHOLD.${k}`);
  }
  assert.equal(run(`Object.keys(HOUSEHOLD).sort().join()`), [...run(`HOUSEHOLD_DOCS`), "kits", "items"].sort().join(), "the core keeps the saved household and nothing else");
});
