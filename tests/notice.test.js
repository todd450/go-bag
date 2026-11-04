const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { load, ROOT } = require("./load");

// The notice that explains the lower readiness after the five checklist categories began counting named
// essentials (#34), while items saved before then are still untagged (#38).
const scenarios = ["tests/household", ...fs.readdirSync(path.join(ROOT, "fixtures"), { recursive: true })
  .filter(f => f.endsWith(".json")).map(f => path.join("fixtures", f.slice(0, -5)))];

// The standard household plus untagged items in each of the five categories: some the name guesses, some it can't.
const EXTRA = [
  { id: "x1", kitId: "go", name: "Cash envelope ($100)", category: "documents", qty: 1 },
  { id: "x2", kitId: "go", name: "Zip pouch of papers", category: "documents", qty: 1 },
  { id: "x3", kitId: "home", name: "Hand-crank radio", category: "communication", qty: 1 },
  { id: "x4", kitId: "home", name: "Duct tape", category: "tools", qty: 1 },
  { id: "x5", kitId: "go", name: "Pocket knife", category: "tools", qty: 1 },
  { id: "x6", kitId: "go", name: "Advil, 24 tablets", category: "medications", qty: 1 },
  { id: "x7", kitId: "car", name: "Fire blanket", category: "fire_safety", qty: 1 },
];
function withUntagged() {
  const app = load({ fixture: "tests/household" });
  app.run(`S.items.push(...${JSON.stringify(EXTRA)})`);
  return app;
}
// A stand-in db that records every write.
function standInDb(app) {
  app.run(`var writes = []; db = { doc: p => ({ set: async d => { writes.push([p, d]); }, delete: async () => { writes.push([p, null]); } }) };`);
  return () => app.json("writes");
}
const FIVE = ["documents", "fire_safety", "communication", "tools", "medications"];
const overview = app => app.run("viewOverview(model())");
// The notice, read from the rendered Readiness tab: null when there is none.
function notice(html) {
  const at = html.search(/<div class="notice[^"]*"[^>]*data-note="tags"/);
  if (at < 0) return null;
  // Everything up to the panel that follows it.
  const end = html.indexOf('<div class="panel', at);
  const box = html.slice(at, end < 0 ? undefined : end);
  const lead = box.match(/<p[^>]*>([\s\S]*?)<\/p>/)[1].replace(/<[^>]*>/g, " ");
  return { at, html: box, nums: (lead.match(/\d+/g) || []).map(Number) };
}

// A: each of the five rows counted the old way, any items toward the old need: 2 for tools, one per person
// on daily medicines (at least 1) for Medication supply cut off's medications, and 1 for the rest; every
// other row as it is now. Worked out here from the items in each emergency's kits.
function oldCountScore(app) {
  const M = app.json(`model().active.map(r => ({ id: r.hz.id, wt: r.wt, types: kitsFor(r.hz), rows: r.rows.map(x => ({ cat: x.cat, w: x.w, cov: x.cov })) }))`);
  const onMeds = app.json("household().members.filter(onDailyMeds).length");
  const oldNeed = (cat, id) => cat === "tools" ? 2 : cat === "medications" && id === "meds" ? Math.max(1, onMeds) : 1;
  const kits = app.json("S.kits"), items = app.json("S.items.map(it => ({ ...it, expired: expState(it) === 'expired' }))");
  let sum = 0, tw = 0;
  for (const r of M) {
    const ids = new Set(kits.filter(k => r.types.includes(k.type)).map(k => k.id));
    const rows = r.rows.map(x => {
      if (!FIVE.includes(x.cat)) return x;
      const n = items.filter(it => ids.has(it.kitId) && it.category === x.cat && !it.expired).reduce((a, it) => a + Math.max(1, Number(it.qty) || 0), 0);
      return { ...x, cov: Math.min(1, n / oldNeed(x.cat, r.id)) };
    });
    const score = Math.round(100 * rows.reduce((a, x) => a + x.w * x.cov, 0) / rows.reduce((a, x) => a + x.w, 0));
    sum += r.wt * score; tw += r.wt;
  }
  return Math.round(sum / tw);
}
// B: the household score with every name guess saved, worked out on a second copy of the page.
function guessedScore(app) {
  const items = app.json(`S.items.map(it => Object.hasOwn(ESSENTIALS, it.category) && !essentialOf(it) && expState(it) !== "expired" && guessEssential(it) ? { ...it, essential: guessEssential(it) } : it)`);
  const copy = load({ fixture: "tests/household" });
  copy.run(`S.items = ${JSON.stringify(items)}`);
  return copy.json("model().overall");
}

test("with untagged items, Readiness shows the notice above Next steps, with the old, tagged and current scores", () => {
  const app = withUntagged();
  const html = overview(app);
  const n = notice(html);
  assert.ok(n, "a notice");
  const next = html.indexOf(">Next steps<");
  assert.ok(next > 0 && n.at < next, "it comes before Next steps");
  const A = oldCountScore(app), B = guessedScore(app), C = app.json("model().overall");
  assert.deepEqual(n.nums, [A, B, C]);
  assert.ok(A > C, `the old count (${A}) is above today's (${C}), so the scenario shows a drop`);
  assert.ok(B > C, `the guesses (${B}) add to today's (${C})`);
});

test("the old count asks one medicine per person on daily medicines, as it did before named essentials", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`const ms = S.profile.members; ms[0].conditions = ["meds"]; ms[1].conditions = ["meds"]; ms[2].conditions = ["diabetes"];
    S.items.push({ id: "m1", kitId: "go", name: "Pill organiser", category: "medications", qty: 1 })`);
  assert.equal(app.json("household().members.filter(onDailyMeds).length"), 3, "three people on daily medicines");
  const n = notice(overview(app));
  assert.ok(n, "a notice");
  assert.equal(n.nums[0], oldCountScore(app));
  // With three on daily medicines and one medicine, the old Medication supply row was a third covered, so
  // two more medicines raise A.
  const one = n.nums[0];
  app.run(`S.items.push({ id: "m2", kitId: "home", name: "Insulin pens", category: "medications", qty: 2 })`);
  const two = notice(overview(app)).nums[0];
  assert.equal(two, oldCountScore(app));
  assert.ok(two > one, `two more medicines raise the old count (${one} → ${two})`);
});

test("the notice says why it dropped, naming the five categories", () => {
  const app = withUntagged();
  const n = notice(overview(app));
  const why = n.html.match(/<details[\s\S]*?<\/details>/)?.[0];
  assert.ok(why, "a details");
  assert.match(why, /<summary>[^<]+<\/summary>/);
  for (const c of FIVE) assert.ok(why.replace(/&amp;/g, "&").includes(app.json(`catLabel(${JSON.stringify(c)})`)), c);
});

test("the numbers follow the items: a third tool and a tagged item move them", () => {
  const app = withUntagged();
  app.run(`S.items.push({ id: "x8", kitId: "home", name: "Shut-off wrench", category: "tools", qty: 1, essential: "shutoff_wrench" }); S.items.find(i => i.id === "x2").essential = "records"`);
  assert.deepEqual(notice(overview(app)).nums, [oldCountScore(app), guessedScore(app), app.json("model().overall")]);
});

test("working out the tagged score leaves the items as they were and writes nothing", () => {
  const app = withUntagged();
  const writes = standInDb(app);
  const before = app.json("S.items");
  app.run("var keep = S.items");
  for (const v of app.json("VIEWS")) app.run(`S.view = ${JSON.stringify(v)}; render()`);
  overview(app);
  assert.deepEqual(app.json("S.items"), before);
  assert.equal(app.run("S.items === keep"), true, "the same list, not a copy");
  assert.deepEqual(writes(), []);
});

test("an open tag review keeps the notice above it, and the guessed score ignores picks not yet saved", async () => {
  const app = withUntagged();
  const want = notice(overview(app)).nums;
  app.run("ACT.tagOpen()");
  await app.fire("change", { dataset: { change: "tagPick", id: "x2" }, value: "records" });
  const html = overview(app), n = notice(html);
  assert.ok(n && n.at < html.indexOf('class="tg"'));
  assert.deepEqual(n.nums, want);
});

test("no notice once nothing is left to tag", () => {
  const app = withUntagged();
  app.run(`for (const it of S.items) if (Object.hasOwn(ESSENTIALS, it.category) && !essentialOf(it)) it.essential = "none"`);
  assert.equal(notice(overview(app)), null, "every item tagged");

  const none = load({ fixture: "tests/household" });
  none.run(`S.items = S.items.filter(it => !Object.hasOwn(ESSENTIALS, it.category))`);
  assert.equal(notice(overview(none)), null, "no items in the five categories");

  const expired = load({ fixture: "tests/household" });
  expired.run(`S.items.find(i => i.id === "i3").expires = "2000-01"`);
  assert.equal(notice(overview(expired)), null, "only an expired one, which nothing can tag");
});

test("across every scenario the notice shows exactly when there is something to tag", () => {
  for (const name of scenarios) {
    const app = load({ fixture: name });
    const toTag = app.run("tagRows().length") > 0 && app.json("model().overall") != null;
    assert.equal(!!notice(overview(app)), toTag, name);
  }
  assert.equal(notice(overview(load({ fixture: "fixtures/empty-and-one/new-household" }))), null);
});

test("dismissing hides it until the page reloads, and writes nothing", () => {
  const app = withUntagged();
  const writes = standInDb(app);
  const html = overview(app);
  assert.match(notice(html).html, /data-act="tagNoteOff"/);
  app.run("ACT.tagNoteOff()");
  const after = overview(app);
  assert.equal(notice(after), null);
  assert.match(after, /data-act="tagOpen"/, "the Tag step stays");
  app.run(`S.items.push({ id: "x9", kitId: "go", name: "Whistle", category: "communication", qty: 1 })`);
  assert.equal(notice(overview(app)), null, "a new untagged item doesn't bring it back");
  assert.deepEqual(writes(), []);
  assert.ok(notice(overview(withUntagged())), "a fresh page shows it again");
});

test("the notice renders on every scenario, read-only too", () => {
  for (const name of scenarios) {
    const app = load({ fixture: name });
    app.run("S.canWrite = false");
    assert.doesNotThrow(() => app.run("for (const v of VIEWS) { S.view = v; render(); }"), name);
  }
});
