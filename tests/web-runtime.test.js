// The Vercel runtime (web/runtime.js, issue #48): the window.claude it gives the page outside
// claude.ai. It runs here against a stand-in Supabase client, so no network and no install.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { load, ROOT } = require("./load");

const RUNTIME = fs.readFileSync(path.join(ROOT, "web", "runtime.js"), "utf8");
const settle = () => new Promise(r => setImmediate(r));
const SESSION = { access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { email: "sam@example.com" } };

// A stand-in for supabase-js: one `docs` table in memory, a Realtime channel the test can push
// changes through, and a switch to make the next write fail.
function fakeSupabase({ session = SESSION, member = true, rows = [] } = {}) {
  const table = new Map(rows.map(r => [`${r.col}/${r.id}`, r]));
  const writes = [];
  let onChange, failNext = null;
  const run = st => {
    if (st.op === "select") return { data: [...table.values()].slice(st.range[0], st.range[1] + 1), error: null };
    writes.push(st);
    if (failNext) { const error = failNext; failNext = null; return { error }; }
    if (st.op === "upsert") table.set(`${st.row.col}/${st.row.id}`, st.row);
    if (st.op === "delete") { const f = Object.fromEntries(st.filters); table.delete(`${f.col}/${f.id}`); }
    return { error: null };
  };
  const query = () => {
    const st = { op: "select", filters: [] };
    const q = {
      select: () => q, order: () => q, range: (a, z) => { st.range = [a, z]; return q; },
      upsert: row => { st.op = "upsert"; st.row = row; return q; },
      delete: () => { st.op = "delete"; return q; },
      eq: (k, v) => { st.filters.push([k, v]); return q; },
      then: (ok, bad) => Promise.resolve(run(st)).then(ok, bad),
    };
    return q;
  };
  const client = {
    auth: { getSession: async () => ({ data: { session } }), onAuthStateChange() {}, signOut: async () => {}, signInWithOtp: async () => ({}) },
    rpc: async () => ({ data: member, error: null }),
    from: () => query(),
    channel: () => { const ch = { on: (_e, _f, fn) => { onChange = fn; return ch; }, subscribe: cb => { cb("SUBSCRIBED"); return ch; } }; return ch; },
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) },
  };
  return { client, table, writes, emit: p => onChange(p), failNextWrite: e => { failNext = e; } };
}

// Runs web/runtime.js in its own context and returns the window.claude it made.
function runtime(opts) {
  const sb = fakeSupabase(opts);
  const cards = [];
  const el = () => ({ addEventListener() {}, querySelector: () => el(), append() {}, innerHTML: "", className: "" });
  const window = { supabase: { createClient: () => sb.client }, GO_BAG_CONFIG: { supabaseUrl: "https://db.example", supabaseKey: "pk" } };
  const document = {
    body: { append: x => cards.push(x) }, head: { append() {} }, createElement: el,
    addEventListener() {}, cookie: "", visibilityState: "visible",
  };
  vm.runInNewContext(RUNTIME, {
    window, document, crypto: globalThis.crypto, queueMicrotask, setTimeout, TextDecoder,
    location: { search: "", origin: "https://go-bag.example" }, history: { replaceState() {} },
  });
  return { claude: window.claude, sb, cards, document };
}

const pending = (p, ms = 30) => Promise.race([p.then(() => "resolved"), new Promise(r => setTimeout(() => r("pending"), ms))]);
// Through JSON, because objects built in the runtime's context have that context's prototypes.
const plain = x => JSON.parse(JSON.stringify(x));
const docsOf = snap => plain(snap.docs.map(d => ({ id: d.id, ...d.data() })));

test("a signed-in member gets every capability the page asks for", async () => {
  const { claude, document } = runtime();
  for (const name of ["db", "assets", "sample", "user"]) assert.ok(await claude.use(name), name);
  assert.equal(await (await claude.use("user")).canEdit(), true);
  assert.equal((await (await claude.use("sample")).limits()).images.maxCount, 4);
  assert.equal(await claude.use("camera"), null, "a capability the shim doesn't have resolves null, as on claude.ai");
  assert.match(document.cookie, /^gb_at=tok; Path=\/_blob;/, "photos need the token in a cookie");
});

test("signed out, nothing resolves and the sign-in card covers the page", async () => {
  const { claude, cards } = runtime({ session: null });
  assert.equal(await pending(claude.use("db")), "pending");
  assert.equal(cards.length, 1);
});

test("someone not on the allowlist gets no data, only the not-on-the-list card", async () => {
  const { claude, cards } = runtime({ member: false });
  assert.equal(await pending(claude.use("db")), "pending");
  assert.equal(cards.length, 1);
});

test("collections and household docs answer from the server, never from cache", async () => {
  const { claude } = runtime({ rows: [
    { col: "kits", id: "k1", data: { name: "Car" } },
    { col: "household", id: "profile", data: { location: "Anytown" } },
  ] });
  const db = await claude.use("db");
  const kits = await new Promise(r => db.collection("kits").onSnapshot(r));
  assert.deepEqual(docsOf(kits), [{ id: "k1", name: "Car" }]);
  assert.equal(kits.metadata.fromCache, false);
  const profile = await new Promise(r => db.doc("household/profile").onSnapshot(r));
  assert.equal(profile.exists, true);
  assert.deepEqual(plain(profile.data()), { location: "Anytown" });
  const plan = await new Promise(r => db.doc("household/plan").onSnapshot(r));
  assert.equal(plan.exists, false);
  assert.equal(plan.data(), undefined);
});

test("a write shows at once, saves as one row, and rolls back if Supabase refuses it", async () => {
  const { claude, sb } = runtime();
  const db = await claude.use("db");
  const seen = [];
  db.collection("items").onSnapshot(s => seen.push(docsOf(s)));
  await settle();
  await db.doc("items/i1").set({ name: "Water", qty: 2 });
  assert.deepEqual(seen.at(-1), [{ id: "i1", name: "Water", qty: 2 }]);
  assert.deepEqual(sb.table.get("items/i1").data, { name: "Water", qty: 2 });

  sb.failNextWrite({ code: "42501", message: "denied" });
  await assert.rejects(db.doc("items/i1").set({ name: "Changed" }), e => e.code === "invalid_argument");
  assert.deepEqual(seen.at(-1), [{ id: "i1", name: "Water", qty: 2 }], "the refused write was rolled back");

  await db.doc("items/i1").delete();
  assert.deepEqual(seen.at(-1), []);
  assert.equal(sb.table.has("items/i1"), false);
});

test("changes from another device arrive through Realtime", async () => {
  const { claude, sb } = runtime();
  const db = await claude.use("db");
  const seen = [];
  db.collection("kits").onSnapshot(s => seen.push(docsOf(s)));
  await settle();
  sb.emit({ eventType: "INSERT", new: { col: "kits", id: "k9", data: { name: "Go bag" } } });
  assert.deepEqual(seen.at(-1), [{ id: "k9", name: "Go bag" }]);
  sb.emit({ eventType: "UPDATE", new: { col: "kits", id: "k9", data: { name: "Go bag 2" } } });
  assert.deepEqual(seen.at(-1), [{ id: "k9", name: "Go bag 2" }]);
  sb.emit({ eventType: "DELETE", old: { col: "kits", id: "k9" } });
  assert.deepEqual(seen.at(-1), []);
});

test("the page boots on the Vercel runtime and loads the standard household", async () => {
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "household.json"), "utf8"));
  const rows = [
    ...["kits", "items"].flatMap(col => f[col].map(({ id, ...data }) => ({ col, id, data }))),
    ...["profile", "hazards"].map(id => ({ col: "household", id, data: f[id] })),
  ];
  const { claude } = runtime({ rows });
  const app = load({ boot: true, claude });
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(app.json("S.loaded"), true);
  assert.equal(app.json("S.live"), true);
  assert.equal(app.json("S.kits.length"), f.kits.length);
  assert.equal(app.json("S.items.length"), f.items.length);
  assert.deepEqual(app.json("S.profile"), f.profile);
});

test("the Vercel build wraps the page byte for byte and loads the runtime before it", () => {
  const { build } = require("../tools/build-web");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-web-"));
  const stub = path.join(out, "stub-supabase.js");
  fs.writeFileSync(stub, "window.supabase = {};");
  try {
    assert.throws(() => build(path.join(out, "dist"), {}, stub), /SUPABASE_URL/);
    build(path.join(out, "dist"), { SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk</script>" }, stub);
    const html = fs.readFileSync(path.join(out, "dist", "index.html"), "utf8");
    const page = fs.readFileSync(path.join(ROOT, "emergency-kit-audit.html"), "utf8");
    assert.ok(html.includes(`<body>${page}</body>`), "the page is copied unchanged");
    const head = html.slice(0, html.indexOf("<body>"));
    assert.ok(head.indexOf("/supabase.js?v=") < head.indexOf("/runtime.js?v="), "supabase-js loads before the runtime");
    assert.ok(!head.includes("pk</script>"), "config values can't close the script tag");
    assert.deepEqual(fs.readdirSync(path.join(out, "dist")).sort(), ["index.html", "runtime.js", "supabase.js"]);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test("Claude's JSON answers parse even with a stray code fence or sentence around them", async () => {
  const { parseJson } = await import("../api/_json.mjs");
  assert.deepEqual(parseJson('[{"id":"a"}]'), [{ id: "a" }]);
  assert.deepEqual(parseJson('```json\n{"hazards":[]}\n```'), { hazards: [] });
  assert.deepEqual(parseJson('Here you go: {"a":1} Hope that helps.'), { a: 1 });
  assert.throws(() => parseJson("no json here"), e => e.code === "invalid_json");
});
