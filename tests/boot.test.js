// The boot sequence: what the page subscribes to, when it counts as loaded, and that the preview's
// fixture database and the tests' useFixture load a household the same way.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { load, ROOT } = require("./load");

// Lets the page's capability requests resolve, so its subscriptions are in place.
const settle = () => new Promise(r => setImmediate(r));

// A stand-in claude.ai whose database records every subscription and answers only when told to.
function recordingClaude() {
  const subs = [];
  const ref = name => ({ onSnapshot: cb => { subs.push({ name, cb }); return () => {}; } });
  const db = { collection: ref, doc: ref };
  return { subs, claude: { use: async n => (n === "db" ? db : null) } };
}
const answer = ({ name, cb }, fromCache = false) => cb(name.includes("/")
  ? { metadata: { fromCache }, exists: false, data: () => undefined }
  : { metadata: { fromCache }, docs: [] });

test("the page counts as loaded only once every subscription has answered from the server", async () => {
  const { subs, claude } = recordingClaude();
  const { json } = load({ boot: true, claude });
  await settle();
  assert.ok(subs.length > 2, "the page subscribes to its collections and household docs");
  for (const s of subs) {
    assert.equal(json("S.loaded"), false, `loaded before ${s.name} answered`);
    answer(s, true);
    assert.equal(json("S.loaded"), false, `a cached answer from ${s.name} counted`);
    answer(s);
  }
  assert.equal(json("S.loaded"), true, "every subscription answered, but the page never counted as loaded");
  assert.equal(json("S.slow"), false);
});

test("every household doc the page subscribes to is one the tests load from a fixture", async () => {
  const { subs, claude } = recordingClaude();
  const { json } = load({ boot: true, claude });
  await settle();
  const docs = subs.map(s => s.name).filter(n => n.startsWith("household/")).map(n => n.slice("household/".length));
  assert.deepEqual(docs.sort(), json("HOUSEHOLD_DOCS").sort());
});

// Boots the whole page against tools/fixture-db.js serving a fixture, the way preview.sh and
// screenshots.js run it, and lets every snapshot arrive.
async function preview(name) {
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, name + ".json"), "utf8"));
  const queue = [], window = { GO_BAG_FIXTURE: fixture };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "tools", "fixture-db.js"), "utf8"), { window, setTimeout: fn => queue.push(fn) });
  const app = load({ boot: true, claude: window.claude });
  await settle();
  while (queue.length) queue.shift()();
  return app;
}
const household = app => app.json(`Object.fromEntries([...HOUSEHOLD_DOCS, "kits", "items"].map(k => [k, S[k]]))`);

const fixtures = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

for (const name of fixtures) {
  test(`${name}: the preview loads the same household as the tests, and counts as loaded`, async () => {
    const app = await preview(name);
    assert.equal(app.json("S.loaded"), true);
    assert.deepEqual(household(app), household(load({ fixture: name })));
  });
}

test("a fixture's saved review loads in the tests as it does in the preview", async () => {
  const name = "fixtures/data-and-account-shapes/odd-values";
  const saved = load({ fixture: name }).json("S.review");
  assert.ok(saved?.text, "the fixture has a review and the tests load it");
  assert.deepEqual(saved, (await preview(name)).json("S.review"));
});
