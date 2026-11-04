const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

// Photos stand in as plain objects with the fields a File has; Claude is a stand-in that records
// how many photos each call carried and answers with one item per call.
function withPhotos({ fail = false } = {}) {
  const app = load({ fixture: "tests/household" });
  app.run(`
    S.canWrite = true; S.openKit = "go";
    globalThis.calls = [];
    sample = {
      limits: async () => ({ images: { maxCount: 5 } }),
      json: async (prompt, o) => {
        calls.push(o.images.length);
        if (${fail}) throw { code: "rate_limited" };
        return [{ name: "Item from call " + calls.length, category: "tools", qty: 1 }];
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
