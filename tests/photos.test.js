const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

// Photos stand in as plain objects with the fields a File has; Claude is a stand-in that records
// how many photos each call carried and answers with one item per call.
function withPhotos({ fail = false, reply = null } = {}) {
  const app = load({ fixture: "tests/household" });
  app.run(`
    S.canWrite = true; S.openKit = "go";
    globalThis.calls = [];
    sample = {
      limits: async () => ({ images: { maxCount: 5 } }),
      json: async (prompt, o) => {
        calls.push(o.images.length);
        if (${fail}) throw { code: "rate_limited" };
        return ${JSON.stringify(reply)} || [{ name: "Item from call " + calls.length, category: "tools", qty: 1 }];
      },
    };
    globalThis.photo = (n, type = "image/jpeg") => ({ name: "IMG_" + n + ".jpg", size: 1000 + n, lastModified: n, type });
  `);
  return app;
}
const kitsView = app => app.run(`S.view = "kits"; viewKits(model())`);

test("photos wait in a tray until you read them, one pick or several", () => {
  const app = withPhotos();
  const { run, json } = app;
  run(`addToTray([photo(1)])`);
  run(`addToTray([photo(2), photo(3)])`);
  assert.deepEqual(json(`S.tray.photos.map(p => p.file.name)`), ["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg"]);
  assert.deepEqual(json(`calls`), []);
  assert.match(kitsView(app), /Read 3 photos/);
});

test("the same photo picked twice and files that aren't images are left out", () => {
  const { run, json } = withPhotos();
  run(`addToTray([photo(1), photo(1), photo(2, "application/pdf")])`);
  run(`addToTray([photo(1)])`);
  assert.deepEqual(json(`S.tray.photos.map(p => p.file.name)`), ["IMG_1.jpg"]);
});

test("the tray holds at most TRAY_MAX photos", () => {
  const { run, json } = withPhotos();
  run(`addToTray(Array.from({ length: TRAY_MAX + 3 }, (_, i) => photo(i)))`);
  assert.equal(json(`S.tray.photos.length`), json(`TRAY_MAX`));
});

test("reading sends the tray's photos together and empties it", async () => {
  const { run, json } = withPhotos();
  run(`addToTray([1, 2, 3, 4, 5, 6, 7].map(n => photo(n)))`);
  await run(`ACT.readTray()`);
  // Claude takes 5 images per call here, so 7 photos are read in two calls.
  assert.deepEqual(json(`calls`), [5, 2]);
  assert.equal(json(`S.tray`), null);
  assert.deepEqual(json(`S.draft.rows.map(r => r.name)`), ["Item from call 1", "Item from call 2"]);
});

test("photos read while you're checking a list add to that list", async () => {
  const app = withPhotos();
  const { run, json } = app;
  run(`addToTray([photo(1)])`);
  await run(`ACT.readTray()`);
  assert.doesNotMatch(kitsView(app), /data-act="pickPhotos" disabled/);
  run(`addToTray([photo(2)])`);
  await run(`ACT.readTray()`);
  assert.deepEqual(json(`S.draft.rows.map(r => r.name)`), ["Item from call 1", "Item from call 2"]);
});

test("a failed read keeps the photos so you can try again", async () => {
  const app = withPhotos({ fail: true });
  const { run, json } = app;
  run(`addToTray([photo(1), photo(2)])`);
  await run(`ACT.readTray()`);
  assert.equal(json(`S.tray.photos.length`), 2);
  assert.equal(json(`S.draft`), null);
  assert.match(kitsView(app), /usage limit[\s\S]*Read 2 photos|Read 2 photos[\s\S]*usage limit/);
});

test("removing a photo or clearing the tray, and each kit keeps its own tray", () => {
  const app = withPhotos();
  const { run, json } = app;
  run(`addToTray([photo(1), photo(2)])`);
  run(`ACT.trayDrop({ dataset: { k: S.tray.photos[0].key } })`);
  assert.deepEqual(json(`S.tray.photos.map(p => p.file.name)`), ["IMG_2.jpg"]);
  run(`ACT.trayClear()`);
  assert.equal(json(`S.tray`), null);
  run(`addToTray([photo(1)]); S.openKit = "car"; addToTray([photo(9)])`);
  assert.deepEqual(json(`[S.tray.kitId, S.tray.photos.map(p => p.file.name)]`), ["car", ["IMG_9.jpg"]]);
  run(`S.openKit = "go"`);
  assert.doesNotMatch(kitsView(app), /IMG_9|Read 1 photo/);
});

// The essential Claude suggests for each line. A tag from Claude is input from outside: it is kept only when it is
// an id on the list for the row's own category, and the household checks it in the draft before anything is saved.
const read = async reply => {
  const app = withPhotos({ reply });
  app.run(`addToTray([photo(1)])`);
  await app.run(`ACT.readTray()`);
  return app;
};
// The draft's rows, read from the rendered table: the row's category, and its Essential select's options and value
// (null when the row has none).
const draftRows = app => [...app.run(`draftTable(S.draft)`).match(/<tbody>[\s\S]*<\/tbody>/)[0].matchAll(/<tr>[\s\S]*?<\/tr>/g)].map(([tr]) => {
  const sel = tr.match(/<select[^>]*data-f="essential"[^>]*>[\s\S]*?<\/select>/)?.[0];
  return {
    category: tr.match(/data-f="category"[\s\S]*?<option value="([^"]*)" selected>/)?.[1],
    essential: sel ? { options: [...sel.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]), value: sel.match(/<option value="([^"]*)" selected/)?.[1] ?? "" } : null,
  };
});

test("the photo prompt asks for an essential and lists each category's ids under it", () => {
  const { run, json } = withPhotos();
  const prompt = run(`photoPrompt(S.kits.find(k => k.id === "go"))`);
  assert.match(prompt, /"essential"/);
  const ess = json(`ESSENTIALS`);
  const all = Object.values(ess).flat().map(e => e.id);
  const lines = prompt.split("\n");
  for (const [cat, list] of Object.entries(ess)) {
    const ids = list.map(e => e.id);
    const line = lines.find(l => new RegExp(`^\\W*${cat}\\b`).test(l) && ids.every(id => new RegExp(`\\b${id}\\b`).test(l)));
    assert.ok(line, `a line for ${cat} lists ${ids.join(", ")}`);
    for (const id of all.filter(id => !ids.includes(id))) assert.doesNotMatch(line, new RegExp(`\\b${id}\\b`), `${cat}'s line has no ${id}`);
  }
});

test("a reply's essential is kept only when it is on the list for that row's category", async () => {
  const cases = [
    [{ category: "documents", essential: "cash" }, "cash"],
    [{ category: "communication", essential: "radio" }, "radio"],
    [{ category: "documents", essential: "radio" }, ""],
    [{ category: "documents", essential: "flashlight" }, ""],
    [{ category: "documents", essential: "none" }, ""],
    [{ category: "documents", essential: 7 }, ""],
    [{ category: "documents", essential: {} }, ""],
    [{ category: "documents", essential: ["cash"] }, ""],
    [{ category: "documents", essential: "x".repeat(5000) }, ""],
    [{ category: "documents", essential: "cash".repeat(1250) }, ""],
    [{ category: "documents", essential: " cash" }, ""],
    [{ category: "documents", essential: "constructor" }, ""],
    [{ category: "documents", essential: "__proto__" }, ""],
    [{ category: "documents", essential: null }, ""],
    [{ category: "documents" }, ""],
    [{ category: "water", essential: "cash" }, ""],
    [{ category: "not a category", essential: "cash" }, ""],
  ];
  const app = await read(cases.map(([x], i) => ({ name: "Line " + i, qty: 1, ...x })));
  const rows = app.json(`S.draft.rows`);
  assert.equal(rows.length, cases.length);
  cases.forEach(([x, want], i) => assert.equal(rows[i].essential, want, JSON.stringify(x).slice(0, 80)));
});

test("the draft shows an Essential picker for a documents row and none for a water row", async () => {
  const app = await read([{ name: "Twenty dollar bills", category: "documents", essential: "cash", qty: 5 }, { name: "Water bottles", category: "water", essential: "cash", qty: 6, liters: 3 }]);
  const docs = app.json(`ESSENTIALS.documents.map(e => e.id)`);
  const [money, water] = draftRows(app);
  assert.deepEqual(money.essential, { options: ["", ...docs, "none"], value: "cash" });
  assert.equal(water.essential, null);
  assert.ok(app.json(`S.draft.rows.every(r => typeof r.essential === "string")`));
});

test("changing a draft row's category clears its essential, and a pick is kept until then", async () => {
  const app = await read([{ name: "Twenty dollar bills", category: "documents", essential: "cash", qty: 5 }]);
  await app.fire("input", { dataset: { input: "draft", i: "0", f: "essential" }, value: "insurance" });
  assert.equal(draftRows(app)[0].essential.value, "insurance");
  await app.fire("input", { dataset: { input: "draft", i: "0", f: "category" }, value: "water" });
  assert.equal(app.json(`S.draft.rows[0].essential`), "");
  assert.equal(draftRows(app)[0].essential, null);
  await app.fire("input", { dataset: { input: "draft", i: "0", f: "category" }, value: "communication" });
  assert.deepEqual(draftRows(app)[0].essential, { options: ["", ...app.json(`ESSENTIALS.communication.map(e => e.id)`), "none"], value: "" });
});

test("saving writes an essential valid for the row's final category, and no field otherwise", async () => {
  const app = await read([
    { name: "Twenty dollar bills", category: "documents", essential: "cash", qty: 5 },
    { name: "Water bottles", category: "water", qty: 6, liters: 3 },
    { name: "Hand crank radio", category: "communication", essential: "radio", qty: 1 },
    { name: "Notebook", category: "documents", qty: 1 },
    { name: "Insurance copies", category: "documents", qty: 1 },
  ]);
  // The household says the notebook is none of the essentials. The radio's row is moved without the input
  // handler, so its old tag no longer fits; the insurance copies keep a tag picked by hand.
  app.run(`S.draft.rows[3].essential = "none"; S.draft.rows[2].category = "tools"; S.draft.rows[4].essential = "insurance"`);
  await app.run(`ACT.draftSave()`);
  const saved = Object.fromEntries(app.json(`S.items.filter(i => i.source === "photo")`).map(i => [i.name, i]));
  assert.equal(Object.keys(saved).length, 5);
  assert.equal(saved["Twenty dollar bills"].essential, "cash");
  assert.equal(saved["Notebook"].essential, "none");
  assert.equal(saved["Insurance copies"].essential, "insurance");
  for (const n of ["Water bottles", "Hand crank radio"]) assert.ok(!("essential" in saved[n]), `${n} has no essential field`);
});

test("a saved tag counts: the kit scores what model() reports with the essential in it", async () => {
  const reply = [{ name: "Twenty dollar bills", category: "documents", essential: "cash", qty: 5 }];
  const tagged = await read(reply), untagged = await read(reply);
  const before = tagged.json(`model().kitRes.go.score`);
  untagged.run(`S.draft.rows[0].essential = ""`);
  await tagged.run(`ACT.draftSave()`);
  await untagged.run(`ACT.draftSave()`);
  const docs = app => app.json(`model().kitRes.go.rows.find(r => r.cat === "documents").ess.filter(e => e.have).map(e => e.id)`);
  assert.deepEqual(docs(tagged), ["cash"]);
  assert.deepEqual(docs(untagged), []);
  assert.equal(untagged.json(`model().kitRes.go.score`), before, "an untagged line earns nothing");
  assert.ok(tagged.json(`model().kitRes.go.score`) > before, "the tagged line raises the kit's score");
});
