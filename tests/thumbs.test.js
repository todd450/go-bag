const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

// Item pictures: Claude says where each item is in the kit's photos (a box), the page cuts it out, keys out the
// surface it lies on (keyOut) and saves a small PNG as the item's `thumb` asset, which its flat-lay tile shows.

// A w×h RGBA image as keyOut takes it: `px(x, y)` gives each pixel's [r, g, b].
const image = (w, h, px) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); data.set([r, g, b, 255], (y * w + x) * 4); }
  return { data, width: w, height: h };
};
// A repeatable wobble of ±n, so a "plain" surface still has the grain of a photo.
const grain = (x, y, n) => ((x * 7919 + y * 104729) % (2 * n + 1)) - n;
const alpha = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

test("keyOut clears a plain surface with grain and keeps the item on it, edge pixels softened", () => {
  const img = image(60, 40, (x, y) => x >= 20 && x < 40 && y >= 10 && y < 30 ? [200, 30, 40] : [180 + grain(x, y, 8), 175 + grain(y, x, 8), 168]);
  const app = load();
  app.run(`globalThis.img = { width: 60, height: 40, data: new Uint8ClampedArray(${JSON.stringify([...img.data])}) }; globalThis.ok = keyOut(img)`);
  assert.equal(app.run(`ok`), true);
  const out = { width: 60, height: 40, data: app.json(`[...img.data]`) };
  for (const [x, y] of [[0, 0], [59, 39], [5, 20], [50, 5]]) assert.equal(alpha(out, x, y), 0, `surface at ${x},${y} is cleared`);
  assert.equal(alpha(out, 30, 20), 255, "the item's middle stays");
  assert.ok(alpha(out, 20, 20) > 0 && alpha(out, 20, 20) < 255, "the item's edge is softened, not cut");
});

test("keyOut leaves a busy surface, or an item the same colour as its surface, as it was", () => {
  const app = load();
  const busy = image(40, 40, (x, y) => [(x * 97 + y * 31) % 256, (x * 13 + y * 151) % 256, (x * y * 7) % 256]);
  const same = image(40, 40, () => [120, 120, 120]);
  for (const [name, img] of [["busy", busy], ["same", same]]) {
    app.run(`globalThis.img = { width: 40, height: 40, data: new Uint8ClampedArray(${JSON.stringify([...img.data])}) }; globalThis.ok = keyOut(img)`);
    assert.equal(app.run(`ok`), false, name);
    assert.deepEqual(app.json(`[...img.data]`), [...img.data], `${name}: no pixel changed`);
  }
});

test("a box counts only as [photo from 1, left, top, right, bottom] inside 0–1000 with some size", () => {
  const { json } = load();
  assert.deepEqual(json(`cleanBox([2, 100, 200, 300, 400])`), [2, 100, 200, 300, 400]);
  for (const bad of [null, "1,2,3,4,5", [1, 100, 200, 300], [0, 1, 2, 300, 400], [1.5, 1, 2, 300, 400], [1, 300, 200, 100, 400],
    [1, 100, 200, 102, 400], [1, -5, 0, 100, 100], [1, 0, 0, 1001, 100], [1, 0, 0, "9", 100]])
    assert.equal(json(`cleanBox(${JSON.stringify(bad)})`), null, JSON.stringify(bad));
});

test("a tile shows the item's picture when it has one, escaped, and its category icon when not", () => {
  const app = load({ fixture: "tests/household" });
  app.run(`S.items.push({ id: "p1", kitId: "go", name: "Whistle", category: "communication", thumb: "abc.png" }, { id: "p2", kitId: "go", name: "Rope", category: "tools", thumb: 'x"><b>' })`);
  const html = app.run(`flTile(S.items.find(i => i.id === "p1")) + "|" + flTile(S.items.find(i => i.id === "p2")) + "|" + flTile(S.items.find(i => i.id === "i4"))`);
  const [p1, p2, plain] = html.split("|");
  assert.match(p1, /<img class="fl-pic" src="\/_blob\/abc\.png" alt=""/);
  assert.doesNotMatch(p1, /<svg/);
  assert.ok(!p2.includes('x"><b>'), "a thumb id holding markup stays inside its attribute");
  assert.doesNotMatch(plain, /fl-pic/);
  assert.match(plain, /<svg class="ic"/);
});

// A scan whose Claude places items by box. Batches hold 2 photos, so a box's photo number counts within its batch.
function scanning(reply) {
  const app = load({ fixture: "tests/household" });
  app.run(`
    S.canWrite = true; S.openKit = "go";
    globalThis.calls = 0; globalThis.cut = []; globalThis.ups = [];
    sample = { limits: async () => ({ images: { maxCount: 2 } }), json: async () => (${JSON.stringify(reply)})[calls++] };
    assets = { upload: async (b, o) => { ups.push([b.from, o.type]); return { id: "t-" + b.from }; }, delete: async () => {} };
    cutThumb = async (photo, box) => { cut.push([photo.n, box]); return { from: photo.n + ":" + box[1] }; };
    shrink = async f => f;
  `);
  return app;
}
const photo = n => ({ n, name: "IMG_" + n + ".jpg", size: n, lastModified: n, type: "image/jpeg" });

test("a scan cuts each placed item from its own photo, across batches, and saving stores its picture", async () => {
  const app = scanning([
    [{ name: "Whistle", category: "communication", box: [2, 10, 20, 110, 220] }, { name: "Rope", category: "tools", box: null }],
    [{ name: "Torch", category: "light", box: [1, 300, 300, 500, 600] }, { name: "Ghost", category: "tools", box: [2, 0, 0, 100, 100] }],
  ]);
  await app.run(`scanPhotos(${JSON.stringify([photo(1), photo(2), photo(3)])})`);
  assert.deepEqual(app.json(`cut`), [[2, [2, 10, 20, 110, 220]], [3, [3, 300, 300, 500, 600]]], "photo 1 of batch 2 is photo 3; a box past the batch is dropped");
  assert.deepEqual(app.json(`S.draft.rows.map(r => [r.name, !!r.pic])`), [["Whistle", true], ["Rope", false], ["Torch", true], ["Ghost", false]]);
  await app.run(`saveDraft()`);
  assert.deepEqual(app.json(`ups.filter(u => u[1] === "image/png")`), [["2:10", "image/png"], ["3:300", "image/png"]]);
  const saved = app.json(`Object.fromEntries(S.items.filter(i => i.source === "photo").map(i => [i.name, i.thumb ?? null]))`);
  assert.deepEqual(saved, { Whistle: "t-2:10", Rope: null, Torch: "t-3:300", Ghost: null });
});

test("a scan with no way to cut pictures, or no assets, still saves every item, just without pictures", async () => {
  const app = scanning([[{ name: "Whistle", category: "communication", box: [1, 10, 20, 110, 220] }]]);
  app.run(`cutThumb = async () => null`);
  await app.run(`scanPhotos(${JSON.stringify([photo(1)])})`);
  app.run(`assets = null`);
  await app.run(`saveDraft()`);
  assert.deepEqual(app.json(`S.items.filter(i => i.source === "photo").map(i => [i.name, "thumb" in i])`), [["Whistle", false]]);
});

test("Add item pictures finds a kit's saved items in its saved photos and writes only their pictures", async () => {
  const app = scanning([
    [{ id: "i4", box: [1, 100, 100, 300, 300] }, { id: "nope", box: [1, 1, 1, 100, 100] }, { id: "i5", box: [3, 1, 1, 100, 100] }],
    [{ id: "i5", box: [1, 500, 500, 700, 700] }],
  ]);
  app.run(`
    const kit = S.kits.find(k => k.id === "go"); kit.photos = ["a.jpg", "b.jpg", "gone.jpg", "c.jpg"];
    globalThis.fetched = [];
    fetch = async url => { fetched.push(url); return url.includes("gone") ? { ok: false } : { ok: true, blob: async () => ({ n: url.slice(7, 8) }) }; };
    globalThis.before = JSON.stringify(S.items.filter(i => i.kitId === "go" && !["i4", "i5"].includes(i.id)));
  `);
  const want = app.json(`S.items.filter(i => i.kitId === "go").map(i => i.id)`);
  assert.ok(want.includes("i4") && want.includes("i5"));
  assert.match(app.run(`S.view = "kits"; viewKits(model())`), /Add item pictures from these photos/);
  await app.run(`findPics()`);
  assert.deepEqual(app.json(`fetched`), ["/_blob/a.jpg", "/_blob/b.jpg", "/_blob/gone.jpg", "/_blob/c.jpg"]);
  assert.deepEqual(app.json(`cut`), [["a", [1, 100, 100, 300, 300]], ["c", [3, 500, 500, 700, 700]]],
    "a photo that won't load is skipped, the second batch only asks for what's left, and box 3 of a 2-photo batch is dropped");
  const items = app.json(`S.items`);
  assert.equal(items.find(i => i.id === "i4").thumb, "t-a:100");
  assert.equal(items.find(i => i.id === "i5").thumb, "t-c:500");
  assert.equal(app.run(`before`), JSON.stringify(items.filter(i => i.kitId === "go" && !["i4", "i5"].includes(i.id))), "other items are untouched");
  assert.equal(app.run(`S.scan`), null);
});

test("Add item pictures only shows to a writer with Claude and assets, for a kit with photos and an item without a picture", () => {
  const app = scanning([]);
  const view = () => app.run(`S.view = "kits"; viewKits(model())`);
  app.run(`S.kits.find(k => k.id === "go").photos = ["a.jpg"]`);
  assert.match(view(), /Add item pictures/);
  for (const [setup, undo] of [["S.canWrite = false", "S.canWrite = true"], ["globalThis.s0 = sample; sample = null", "sample = s0"],
    ["globalThis.a0 = assets; assets = null", "assets = a0"], ["S.kits.find(k => k.id === 'go').photos = []", "S.kits.find(k => k.id === 'go').photos = ['a.jpg']"],
    ["S.items.forEach(i => i.thumb = 'x.png')", "S.items.forEach(i => delete i.thumb)"]]) {
    app.run(setup);
    assert.doesNotMatch(view(), /Add item pictures/, setup);
    app.run(undo);
  }
});

test("deleting a kit deletes its items' pictures along with its photos", async () => {
  const app = scanning([]);
  app.run(`
    globalThis.gone = []; assets.delete = async id => { gone.push(id); };
    S.kits.find(k => k.id === "go").photos = ["a.jpg"];
    S.items.filter(i => i.kitId === "go").forEach((i, n) => { if (n < 2) i.thumb = "t" + n + ".png"; });
  `);
  await app.run(`ACT.delKit({ dataset: { id: "go" } })`);
  assert.deepEqual(app.json(`gone`).sort(), ["a.jpg", "t0.png", "t1.png"]);
});
