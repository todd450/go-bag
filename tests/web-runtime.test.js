// The Vercel runtime (web/runtime.js, issues #48 and #78): the window.claude it gives the page outside
// claude.ai, scoped to the signed-in account's own household. It runs here against a stand-in
// Supabase client, so no network and no install.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { load, ROOT } = require("./load");

const RUNTIME = fs.readFileSync(path.join(ROOT, "web", "runtime.js"), "utf8");
const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const HID = "6f1c2a4e-9b3d-4c7a-8e21-0d5f3b9a7c11";
const OTHER = "0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SESSION = { access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1", email: "sam@example.com" } };

// A stand-in for supabase-js: one `docs` table in memory keyed like the real one (household, col, id),
// rpc answers per function name, a Broadcast channel that records its topic and config and lets the
// test push messages through it, a storage bucket that records its paths, and a switch to make the
// next write fail. `log` keeps the order of setAuth and subscribe.
function fakeSupabase({ session = SESSION, rpc = {}, rows = [] } = {}) {
  const key = r => `${r.household_id}/${r.col}/${r.id}`;
  const table = new Map(rows.map(r => [key({ household_id: HID, ...r }), { household_id: HID, ...r }]));
  const writes = [], reads = [], rpcCalls = [], log = [], uploads = [], removes = [], signIns = [];
  const channels = [];
  const authFns = [];
  let failNext = null, failRead = null;
  const answers = { my_household: () => ({ data: HID, error: null }), ...rpc };
  const matches = (r, filters) => filters.every(([k, v]) => r[k] === v);
  const run = st => {
    if (st.op === "select") {
      reads.push(st);
      if (failRead) { const error = failRead; failRead = null; return { data: null, error }; }
      const found = [...table.values()].filter(r => matches(r, st.filters)).map(r => Object.fromEntries(st.cols.split(",").map(c => [c, r[c]])));
      if (st.single) return { data: found[0] ?? null, error: null };
      return { data: st.range ? found.slice(st.range[0], st.range[1] + 1) : found, error: null };
    }
    writes.push(st);
    if (failNext) { const error = failNext; failNext = null; return { error }; }
    if (st.op === "upsert") table.set(key(st.row), st.row);
    if (st.op === "delete") for (const [k, r] of table) if (matches(r, st.filters)) table.delete(k);
    return { error: null };
  };
  const query = name => {
    const st = { op: "select", table: name, filters: [], cols: "" };
    const q = {
      select: cols => { st.cols = cols; return q; }, order: () => q, range: (a, z) => { st.range = [a, z]; return q; },
      upsert: (row, opts) => { st.op = "upsert"; st.row = row; st.opts = opts; return q; },
      delete: () => { st.op = "delete"; return q; },
      eq: (k, v) => { st.filters.push([k, v]); return q; },
      maybeSingle: () => { st.single = true; return q; },
      then: (ok, bad) => Promise.resolve(run(st)).then(ok, bad),
    };
    return q;
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: fn => { authFns.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
      signOut: async opts => { log.push("signOut:" + (opts?.scope ?? "global")); session = null; return { error: null }; },
      signInWithOtp: async () => ({}),
    },
    rpc: async name => { rpcCalls.push(name); const a = answers[name]; if (!a) return { data: null, error: { message: "no such function" } }; return a(); },
    from: name => query(name),
    channel: (topic, opts) => {
      const ch = { topic, opts, listeners: [], status: null };
      const api = {
        on: (type, filter, fn) => { ch.listeners.push({ type, filter, fn }); return api; },
        subscribe: cb => { log.push("subscribe"); ch.status = cb; cb("SUBSCRIBED"); return api; },
      };
      channels.push(ch);
      return api;
    },
    realtime: { setAuth: async token => { log.push("setAuth:" + token); } },
    storage: { from: bucket => ({
      upload: async (p, _blob, opts) => { uploads.push({ bucket, path: p, opts }); return { error: null }; },
      remove: async paths => { removes.push({ bucket, paths }); return { error: null }; },
    }) },
  };
  // Sends a Broadcast message the way supabase-js hands it to an `on("broadcast")` listener.
  const broadcast = (event, payload) => {
    for (const ch of channels) for (const l of ch.listeners) if (l.type === "broadcast" && l.filter?.event === event) l.fn({ type: "broadcast", event, payload });
  };
  return {
    client, table, writes, reads, rpcCalls, log, uploads, removes, channels, signIns, broadcast,
    authChange: (event, s) => authFns.forEach(fn => fn(event, s)),
    failNextWrite: e => { failNext = e; },
    failNextRead: e => { failRead = e; },
  };
}

// Runs web/runtime.js in its own context and returns the window.claude it made.
// `storage` is the browser's localStorage as a Map (left out, there is none, as in a private window that blocks it).
function runtime({ search = "", dom = null, storage = null, ...opts } = {}) {
  const sb = fakeSupabase(opts);
  const replaced = [], reloads = [], heard = {};
  const window = {
    supabase: { createClient: () => sb.client },
    GO_BAG_CONFIG: { supabaseUrl: "https://db.example", supabaseKey: "pk" },
    goBagSignIn: (...args) => sb.signIns.push({ client: args[0], argc: args.length, opts: args.length > 1 ? JSON.parse(JSON.stringify(args[1])) : undefined }),
  };
  const document = { body: {}, head: { append() {} }, addEventListener: (type, fn) => (heard[type] ||= []).push(fn), cookie: "", visibilityState: "visible", ...dom };
  const localStorage = storage && { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) };
  vm.runInNewContext(RUNTIME, {
    window, document, crypto: globalThis.crypto, queueMicrotask, setTimeout, TextDecoder,
    location: { search, pathname: "/app", origin: "https://go-bag.example", reload: () => reloads.push(1) },
    history: { replaceState: (_s, _t, url) => replaced.push(url) },
    ...(localStorage ? { localStorage } : {}),
  });
  // Comes back to the tab, the way the browser tells the page.
  const comeBack = () => (heard.visibilitychange || []).forEach(fn => fn());
  return { claude: window.claude, sb, document, replaced, reloads, comeBack };
}

const pending = (p, ms = 30) => Promise.race([p.then(() => "resolved"), new Promise(r => setTimeout(() => r("pending"), ms))]);
// Through JSON, because objects built in the runtime's context have that context's prototypes.
const plain = x => JSON.parse(JSON.stringify(x));
const docsOf = snap => plain(snap.docs.map(d => ({ id: d.id, ...d.data() })));
const filtersOf = st => Object.fromEntries(st.filters);

/* ---------- the gate ---------- */

test("signed in, it asks for the caller's household, never is_member, and every capability resolves", async () => {
  const { claude, sb, document } = runtime();
  for (const name of ["db", "assets", "sample", "user"]) assert.ok(await claude.use(name), name);
  assert.deepEqual(sb.rpcCalls, ["my_household"]);
  assert.equal(await (await claude.use("user")).canEdit(), true);
  assert.equal((await (await claude.use("sample")).limits()).images.maxCount, 4);
  assert.equal(await claude.use("camera"), null, "a capability the shim doesn't have resolves null, as on claude.ai");
  assert.match(document.cookie, /^gb_at=tok; Path=\/_blob;/, "photos need the token in a cookie");
  assert.equal(sb.signIns.length, 0, "no card over the page");
});

test("signed out, the sign-in card is asked for once and nothing resolves", async () => {
  const { claude, sb } = runtime({ session: null });
  assert.equal(await pending(claude.use("db")), "pending");
  assert.equal(await pending(claude.use("user")), "pending");
  assert.equal(sb.signIns.length, 1);
  assert.equal(sb.signIns[0].client, sb.client, "the card gets the runtime's own client");
  assert.equal(sb.signIns[0].argc, 1, "goBagSignIn(sb): the form, not the unavailable card");
  assert.deepEqual(sb.rpcCalls, [], "no household is made for nobody");
});

test("an rpc error, a thrown call or any answer that isn't a household id shows the unavailable card, and nothing resolves", async () => {
  const cases = {
    "an error": () => ({ data: null, error: { message: "boom" } }),
    "a thrown call": () => { throw new Error("network"); },
    "null": () => ({ data: null, error: null }),
    "true": () => ({ data: true, error: null }),
    "a name": () => ({ data: "family", error: null }),
    "a uuid with something after it": () => ({ data: HID + "/x", error: null }),
    "a list": () => ({ data: [HID], error: null }),
  };
  for (const [name, answer] of Object.entries(cases)) {
    const { claude, sb } = runtime({ rpc: { my_household: answer } });
    assert.equal(await pending(claude.use("db")), "pending", name);
    assert.deepEqual(sb.signIns.map(s => s.opts), [{ state: "unavailable" }], name);
    assert.equal(sb.reads.length + sb.channels.length, 0, `${name}: nothing is read or listened to`);
  }
});

test("?signout signs out on this device only, puts /app in the address, then shows the sign-in card", async () => {
  const { claude, sb, replaced } = runtime({ search: "?signout" });
  assert.equal(await pending(claude.use("db")), "pending");
  assert.equal(sb.log[0], "signOut:local", "Log out on a phone leaves the family's other devices signed in");
  assert.deepEqual(replaced, ["/app"]);
  assert.equal(sb.signIns.length, 1);
});

/* ---------- the account button and Log out (#154) ---------- */

// Just enough DOM for the account button: elements that keep their attributes and children, a page
// header (.top-in) holding the brand, the tabs and .hdr-end with the score (#hdr-score) unless `header: false`
// (or with no .hdr-end, an older page's header, when `end: false`), and a document still parsing when `loading` is set.
function fakeDom({ header = true, end = true, loading = false } = {}) {
  const find = (node, sel) => {
    for (const c of node.children) {
      if (sel === "." + c.className || sel === "#" + c.id) return c;
      const deeper = find(c, sel);
      if (deeper) return deeper;
    }
    return null;
  };
  const el = (tag, props) => ({
    tag, attrs: {}, children: [], textContent: "", className: "", id: "", ...props,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    append(...kids) { this.children.push(...kids); },
    insertBefore(kid, ref) { this.children.splice(this.children.indexOf(ref), 0, kid); },
    querySelector(sel) { return find(this, sel); },
  });
  const top = header ? el("div") : null;
  const score = el("div", { className: "hdr-score", id: "hdr-score" });
  top?.append(el("div", { className: "brand" }), el("nav", { className: "tabs" }), ...(end ? [el("div", { className: "hdr-end", children: [score] })] : [score]));
  const styles = [], waiting = [];
  const dom = {
    readyState: loading ? "loading" : "complete",
    createElement: el,
    querySelector: sel => (sel === ".top-in" ? top : top && find(top, sel)),
    head: { append: (...k) => styles.push(...k) },
    addEventListener: (type, fn) => { if (type === "DOMContentLoaded") waiting.push(fn); },
  };
  const parsed = () => { dom.readyState = "interactive"; waiting.splice(0).forEach(fn => fn()); };
  return { dom, top, styles, parsed };
}
// Every element under the header, depth first, and the account buttons among them
const all = node => node.children.flatMap(c => [c, ...all(c)]);
const accounts = top => all(top).filter(c => c.className === "gb-acct");
const text = node => node.textContent + node.children.map(text).join("");

test("signed in, an account button with the person's initial goes at the right end of the header, after the score, once", async () => {
  const { dom, top, styles } = fakeDom();
  const { claude } = runtime({ dom });
  await claude.use("db");
  await claude.use("user");
  await settle();
  const [box, ...more] = accounts(top);
  assert.equal(more.length, 0, "one button, however many capabilities resolve");
  assert.equal(box.tag, "details", "a disclosure: it opens from the keyboard with no script");
  const end = top.querySelector(".hdr-end");
  assert.deepEqual(end.children.map(c => c.className), ["hdr-score", "gb-acct"], "after the score, at the row's end");
  const [sum, menu] = box.children;
  assert.equal(sum.tag, "summary");
  assert.equal(sum.attrs["aria-label"], "Account: signed in as sam@example.com", "says whose account it is");
  assert.equal(text(sum), "S", "the email's initial");
  assert.match(text(menu), /Signed in as\s*sam@example\.com/, "the panel says who is signed in");
  const out = all(menu).find(c => c.tag === "a");
  assert.equal(out.attrs.href, "/app?signout");
  assert.equal(out.textContent, "Log out");
  assert.equal(styles.length, 1, "its own small style, in the page's colours");
  assert.match(styles[0].textContent, /\.gb-acct\{/);
});

test("the email reaches the account button as text, never as markup", async () => {
  const { dom, top } = fakeDom();
  const { claude } = runtime({ dom, session: { ...SESSION, user: { ...SESSION.user, email: '<img src=x onerror=alert(1)>@example.com' } } });
  await claude.use("db");
  const [box] = accounts(top);
  assert.ok(box, "a button");
  assert.ok(all(box).every(c => !("innerHTML" in c)), "nothing is set as HTML");
  assert.equal(text(box.children[0]), "I", "the first letter or digit, upper-cased");
});

test("an older page with no .hdr-end still gets the account button, at the end of the header's row", async () => {
  const { dom, top } = fakeDom({ end: false });
  const { claude } = runtime({ dom });
  await claude.use("db");
  assert.deepEqual(top.children.map(c => c.className), ["brand", "tabs", "hdr-score", "gb-acct"]);
});

test("the account button waits for the header when the page is still parsing", async () => {
  const { dom, top, parsed } = fakeDom({ loading: true });
  const { claude } = runtime({ dom });
  await claude.use("db");
  assert.equal(accounts(top).length, 0);
  parsed();
  assert.equal(accounts(top).length, 1);
});

test("signed out, or with no household, there is no account button: the sign-in card has the page", async () => {
  for (const opts of [{ session: null }, { rpc: { my_household: () => ({ data: null, error: { message: "boom" } }) } }]) {
    const { dom, top } = fakeDom();
    const { claude } = runtime({ dom, ...opts });
    assert.equal(await pending(claude.use("db")), "pending");
    assert.equal(accounts(top).length, 0);
  }
});

test("a page with no header still gets every capability, just no account button", async () => {
  const { dom } = fakeDom({ header: false });
  const { claude } = runtime({ dom });
  for (const name of ["db", "assets", "sample", "user"]) assert.ok(await claude.use(name), name);
});

test("signing out elsewhere, or signing in as someone else, reloads the page", async () => {
  const { claude, sb, reloads } = runtime();
  await claude.use("db");
  sb.authChange("TOKEN_REFRESHED", { ...SESSION, access_token: "tok2" });
  assert.equal(reloads.length, 0);
  sb.authChange("SIGNED_IN", { ...SESSION, user: { id: "u2" } });
  assert.equal(reloads.length, 1, "another account means another household");
  sb.authChange("SIGNED_OUT", null);
  assert.equal(reloads.length, 2);
});

/* ---------- db ---------- */

test("collections and household docs answer from the server, only the caller's household's rows", async () => {
  const { claude, sb } = runtime({ rows: [
    { col: "kits", id: "k1", data: { name: "Car" } },
    { col: "household", id: "profile", data: { location: "Anytown" } },
    { household_id: OTHER, col: "kits", id: "k2", data: { name: "Not ours" } },
  ] });
  const db = await claude.use("db");
  const kits = await new Promise(r => db.collection("kits").onSnapshot(r));
  assert.deepEqual(docsOf(kits), [{ id: "k1", name: "Car" }]);
  assert.equal(kits.metadata.fromCache, false);
  assert.ok(sb.reads.every(st => filtersOf(st).household_id === HID), "every read names the household");
  const profile = await new Promise(r => db.doc("household/profile").onSnapshot(r));
  assert.equal(profile.exists, true);
  assert.deepEqual(plain(profile.data()), { location: "Anytown" });
  const plan = await new Promise(r => db.doc("household/plan").onSnapshot(r));
  assert.equal(plan.exists, false);
  assert.equal(plan.data(), undefined);
});

test("a write carries the household and upserts on its key; a delete filters on household, col and id", async () => {
  const { claude, sb } = runtime();
  const db = await claude.use("db");
  await db.doc("items/i1").set({ name: "Water", qty: 2 });
  const up = sb.writes.at(-1);
  assert.equal(up.op, "upsert");
  assert.equal(up.table, "docs");
  assert.deepEqual({ ...up.row, updated_at: typeof up.row.updated_at }, { household_id: HID, col: "items", id: "i1", data: { name: "Water", qty: 2 }, updated_at: "string" });
  assert.ok(!Number.isNaN(Date.parse(up.row.updated_at)), "updated_at is a time");
  assert.deepEqual(plain(up.opts), { onConflict: "household_id,col,id" });

  await db.doc("items/i1").delete();
  const del = sb.writes.at(-1);
  assert.equal(del.op, "delete");
  assert.deepEqual(filtersOf(del), { household_id: HID, col: "items", id: "i1" });
});

test("a write shows at once and rolls back if Supabase refuses it", async () => {
  const { claude, sb } = runtime();
  const db = await claude.use("db");
  const seen = [];
  db.collection("items").onSnapshot(s => seen.push(docsOf(s)));
  await settle();
  await db.doc("items/i1").set({ name: "Water", qty: 2 });
  assert.deepEqual(seen.at(-1), [{ id: "i1", name: "Water", qty: 2 }]);
  assert.deepEqual(sb.table.get(`${HID}/items/i1`).data, { name: "Water", qty: 2 });

  sb.failNextWrite({ code: "42501", message: "denied" });
  await assert.rejects(db.doc("items/i1").set({ name: "Changed" }), e => e.code === "invalid_argument");
  assert.deepEqual(seen.at(-1), [{ id: "i1", name: "Water", qty: 2 }], "the refused write was rolled back");

  sb.failNextWrite({ code: "500", message: "down" });
  await assert.rejects(db.doc("items/i1").delete(), e => e.code === "unavailable");
  assert.deepEqual(seen.at(-1), [{ id: "i1", name: "Water", qty: 2 }], "the refused delete was rolled back");

  await db.doc("items/i1").delete();
  assert.deepEqual(seen.at(-1), []);
  assert.equal(sb.table.has(`${HID}/items/i1`), false);
});

/* ---------- live updates ---------- */

test("live updates come on the household's own private channel, joined with the session's token", async () => {
  const { claude, sb } = runtime();
  await claude.use("db");
  await settle();
  assert.equal(sb.channels.length, 1, "one channel");
  const [ch] = sb.channels;
  assert.equal(ch.topic, `household:${HID}`);
  assert.equal(ch.opts?.config?.private, true);
  assert.deepEqual(ch.listeners.map(l => l.type), ["broadcast", "broadcast", "broadcast"]);
  assert.deepEqual(ch.listeners.map(l => l.filter.event).sort(), ["delete", "insert", "update"]);
  assert.ok(!ch.listeners.some(l => l.type === "postgres_changes"), "never postgres_changes");
  assert.deepEqual(sb.log.slice(0, 2), ["setAuth:tok", "subscribe"], "the token is set before joining");

  sb.authChange("TOKEN_REFRESHED", { ...SESSION, access_token: "tok2" });
  assert.equal(sb.log.at(-1), "setAuth:tok2", "a refreshed token reaches Realtime");
  await claude.use("items");
  assert.equal(sb.channels.length, 1, "still one channel");
});

test("an insert or update reads that one doc and shows it; a delete drops it", async () => {
  const { claude, sb } = runtime();
  const db = await claude.use("db");
  const seen = [];
  db.collection("kits").onSnapshot(s => seen.push(docsOf(s)));
  await settle();

  sb.table.set(`${HID}/kits/k9`, { household_id: HID, col: "kits", id: "k9", data: { name: "Go bag" } });
  sb.broadcast("insert", { col: "kits", id: "k9" });
  await settle();
  assert.deepEqual(seen.at(-1), [{ id: "k9", name: "Go bag" }]);
  const read = sb.reads.at(-1);
  assert.deepEqual(filtersOf(read), { household_id: HID, col: "kits", id: "k9" }, "that one doc, in this household");
  assert.equal(read.cols, "data");

  sb.table.set(`${HID}/kits/k9`, { household_id: HID, col: "kits", id: "k9", data: { name: "Go bag 2" } });
  sb.broadcast("update", { col: "kits", id: "k9" });
  await settle();
  assert.deepEqual(seen.at(-1), [{ id: "k9", name: "Go bag 2" }]);

  sb.broadcast("delete", { col: "kits", id: "k9" });
  await settle();
  assert.deepEqual(seen.at(-1), []);
});

test("a live update that is stale, unknown or malformed never shows the wrong thing", async () => {
  const { claude, sb } = runtime({ rows: [{ col: "kits", id: "k1", data: { name: "Car" } }] });
  const db = await claude.use("db");
  const seen = [];
  db.collection("kits").onSnapshot(s => seen.push(docsOf(s)));
  await settle();
  const before = sb.reads.length;

  for (const bad of [{ col: "secrets", id: "x" }, { col: "kits" }, { id: "k1" }, null, "kits/k1", { col: "kits", id: 7 }]) sb.broadcast("update", bad);
  await settle();
  assert.equal(sb.reads.length, before, "nothing is read for a message that names no known doc");
  assert.deepEqual(seen.at(-1), [{ id: "k1", name: "Car" }]);

  // An update whose read finds the row gone drops it, as the server has it.
  sb.table.delete(`${HID}/kits/k1`);
  sb.broadcast("update", { col: "kits", id: "k1" });
  await settle();
  assert.deepEqual(seen.at(-1), []);

  // A read still on its way when the doc is deleted can't bring it back.
  sb.table.set(`${HID}/kits/k2`, { household_id: HID, col: "kits", id: "k2", data: { name: "Old" } });
  sb.broadcast("update", { col: "kits", id: "k2" });
  sb.broadcast("delete", { col: "kits", id: "k2" });
  await settle();
  assert.deepEqual(seen.at(-1), [], "the delete wins over the earlier read");
});

test("a rejoin reloads everything, since changes made while the socket was down never arrive", async () => {
  const { claude, sb } = runtime();
  const db = await claude.use("db");
  const seen = [];
  db.collection("kits").onSnapshot(s => seen.push(docsOf(s)));
  await settle();
  sb.table.set(`${HID}/kits/k5`, { household_id: HID, col: "kits", id: "k5", data: { name: "Missed" } });
  sb.channels[0].status("SUBSCRIBED");
  await settle();
  assert.deepEqual(seen.at(-1), [{ id: "k5", name: "Missed" }]);
});

/* ---------- one draw, and none for nothing new (#159) ---------- */

const ALL = [["kits"], ["items"], ["household", "profile"], ["household", "hazards"], ["household", "review"], ["household", "shopping"], ["household", "plan"]];
// Listens the way the page does, on both collections and the five household docs, and counts what each hears.
function listenAll(db) {
  const heard = Object.fromEntries(ALL.map(([c, id]) => [id || c, 0])), ticks = [];
  let tick = 0;
  for (const [c, id] of ALL) {
    const on = () => { heard[id || c]++; ticks.push(tick); queueMicrotask(() => tick++); };
    if (id) db.doc(`${c}/${id}`).onSnapshot(on); else db.collection(c).onSnapshot(on);
  }
  return { heard, ticks, total: () => Object.values(heard).reduce((a, b) => a + b, 0) };
}
const SOME = [
  { col: "kits", id: "k1", data: { name: "Car", where: { room: "garage", shelf: 2 } } },
  { col: "items", id: "i1", data: { name: "Water", qty: 2 } },
  { col: "household", id: "profile", data: { location: "Anytown" } },
  { col: "household", id: "plan", data: { meet: "The oak" } },
];

test("when the household loads, every listener hears once and all in the same tick, so the page can draw once", async () => {
  const { claude } = runtime({ rows: SOME });
  const l = listenAll(await claude.use("db"));
  await settle();
  assert.deepEqual(l.heard, { kits: 1, items: 1, profile: 1, hazards: 1, review: 1, shopping: 1, plan: 1 });
  assert.deepEqual(l.ticks, [0, 0, 0, 0, 0, 0, 0], "no microtask ran between the first and the last");
});

test("coming back to the tab, or a rejoin, with nothing changed tells the page nothing", async () => {
  const { claude, sb, comeBack } = runtime({ rows: SOME });
  const l = listenAll(await claude.use("db"));
  await settle();
  const reads = sb.reads.length;
  // The database hands a doc back with its keys in its own order: that is not a change.
  sb.table.set(`${HID}/kits/k1`, { household_id: HID, col: "kits", id: "k1", data: { where: { shelf: 2, room: "garage" }, name: "Car" } });
  comeBack();
  await settle();
  sb.channels[0].status("SUBSCRIBED");
  await settle();
  assert.ok(sb.reads.length > reads, "it did read again");
  assert.equal(l.total(), 7, "and nobody heard a thing");
});

test("coming back to a change tells only the listeners on what changed, once each", async () => {
  const { claude, sb, comeBack } = runtime({ rows: SOME });
  const db = await claude.use("db");
  const l = listenAll(db);
  const seen = [];
  db.collection("kits").onSnapshot(s => seen.push(docsOf(s)));
  await settle();
  const put = (col, id, data) => sb.table.set(`${HID}/${col}/${id}`, { household_id: HID, col, id, data });

  put("kits", "k1", { name: "Car", where: { room: "garage", shelf: 3 } });
  comeBack();
  await settle();
  assert.deepEqual(l.heard, { kits: 2, items: 1, profile: 1, hazards: 1, review: 1, shopping: 1, plan: 1 }, "a change deep in one kit");
  assert.equal(seen.at(-1)[0].where.shelf, 3);

  put("household", "plan", { meet: "The gate" });
  sb.table.delete(`${HID}/items/i1`);
  put("household", "review", { done: true });
  comeBack();
  await settle();
  assert.deepEqual(l.heard, { kits: 2, items: 2, profile: 1, hazards: 1, review: 2, shopping: 1, plan: 2 }, "a changed doc, a deleted item and a new doc");
  assert.deepEqual(l.ticks.slice(-3), [l.ticks.at(-1), l.ticks.at(-1), l.ticks.at(-1)], "all three in one tick");
});

test("a save or a live update to one household doc is heard by that doc's listener alone", async () => {
  const { claude, sb } = runtime({ rows: SOME });
  const db = await claude.use("db");
  const l = listenAll(db);
  await settle();
  await db.doc("household/plan").set({ meet: "The gate" });
  assert.deepEqual(l.heard, { kits: 1, items: 1, profile: 1, hazards: 1, review: 1, shopping: 1, plan: 2 });

  sb.table.set(`${HID}/household/profile`, { household_id: HID, col: "household", id: "profile", data: { location: "Elsewhere" } });
  sb.broadcast("update", { col: "household", id: "profile" });
  await settle();
  assert.deepEqual(l.heard, { kits: 1, items: 1, profile: 2, hazards: 1, review: 1, shopping: 1, plan: 2 });

  sb.failNextWrite({ code: "500", message: "down" });
  await assert.rejects(db.doc("household/plan").set({ meet: "Nowhere" }));
  assert.equal(l.heard.plan, 4, "the refused save shows and rolls back");
  assert.equal(l.total(), 11, "and no other listener hears it");
});

test("the page's own save coming back as a live update tells it nothing", async () => {
  const { claude, sb } = runtime({ rows: SOME });
  const db = await claude.use("db");
  const l = listenAll(db);
  await settle();
  await db.doc("items/i2").set({ name: "Torch", qty: 1 });
  await db.doc("items/i1").delete();
  assert.equal(l.heard.items, 3);
  sb.broadcast("insert", { col: "items", id: "i2" });
  sb.broadcast("delete", { col: "items", id: "i1" });
  await settle();
  assert.equal(l.heard.items, 3, "what came back is what the page already shows");
  assert.equal(l.total(), 9);
});

/* ---------- the read that doesn't wait for the household (#159) ---------- */

// Holds back the database's answer to "which household is mine" until the test lets it go.
function heldHousehold(answer = HID) {
  let go;
  const held = new Promise(r => { go = r; });
  return { rpc: { my_household: () => held.then(() => ({ data: answer, error: null })) }, go: () => go() };
}

test("a first visit reads the household's docs only once the database has said which household it is, then remembers it", async () => {
  const storage = new Map(), h = heldHousehold();
  const { claude, sb } = runtime({ rows: SOME, storage, rpc: h.rpc });
  const use = claude.use("db");
  await settle();
  assert.equal(sb.reads.length, 0, "nothing to name yet");
  h.go();
  const kits = await new Promise(async r => (await use).collection("kits").onSnapshot(r));
  assert.equal(docsOf(kits).length, 1);
  assert.equal(storage.get("gb_hid:u1"), HID, "kept under the account, not for whoever signs in next");
  assert.equal(storage.size, 1);
});

test("on a later visit the read starts at once, beside the household lookup, and is the only read", async () => {
  const storage = new Map([["gb_hid:u1", HID.toUpperCase()]]), h = heldHousehold();
  const { claude, sb } = runtime({ rows: SOME, storage, rpc: h.rpc });
  const use = claude.use("db");
  await settle();
  assert.equal(sb.reads.length, 1, "already reading while the lookup is out");
  assert.equal(filtersOf(sb.reads[0]).household_id, HID);
  assert.equal(await pending(use), "pending", "but nothing is handed to the page until the database answers");
  // Another phone saves after that read, before the channel has joined: no live update will ever say so.
  sb.table.set(`${HID}/kits/k1`, { household_id: HID, col: "kits", id: "k1", data: { name: "Car, repacked" } });
  h.go();
  const l = listenAll(await use);
  const seen = [];
  (await use).collection("kits").onSnapshot(s => seen.push(docsOf(s)));
  await settle(6);
  assert.equal(sb.reads.length, 2, "read once more after the channel joined");
  assert.equal(seen.at(-1)[0].name, "Car, repacked", "so the save made in between shows");
  assert.equal(l.heard.kits, 2, "drawn for the change");
  assert.equal(l.total(), 8, "and for nothing else");
});

test("a later visit with nothing saved in between reads once more after the channel joins, and draws nothing for it", async () => {
  const storage = new Map([["gb_hid:u1", HID]]);
  const { claude, sb } = runtime({ rows: SOME, storage });
  const l = listenAll(await claude.use("db"));
  await settle(6);
  assert.equal(sb.reads.length, 2);
  assert.equal(l.total(), 7, "one hearing each, from the first load");
  await settle(6);
  assert.equal(sb.reads.length, 2, "and only once more");
});

test("a remembered household the database no longer agrees with is dropped, and its rows never reach the page", async () => {
  const storage = new Map([["gb_hid:u1", OTHER], ["gb_hid:u2", OTHER]]);
  const { claude, sb } = runtime({ storage, rows: [...SOME, { household_id: OTHER, col: "kits", id: "k2", data: { name: "Not ours" } }] });
  const db = await claude.use("db");
  const kits = await new Promise(r => db.collection("kits").onSnapshot(r));
  assert.deepEqual(docsOf(kits).map(k => k.id), ["k1"], "the stand-in has no row-level security, so this is the runtime's own doing");
  assert.equal(filtersOf(sb.reads.at(-1)).household_id, HID);
  assert.equal(storage.get("gb_hid:u1"), HID, "and the right one is remembered now");
  assert.equal(storage.get("gb_hid:u2"), OTHER, "another account's is left alone");
});

test("a remembered value that is no household id, an early read that fails, or no storage at all: the page still loads", async () => {
  const junk = runtime({ rows: SOME, storage: new Map([["gb_hid:u1", "x' or 1=1"]]), rpc: heldHousehold().rpc });
  junk.claude.use("db");
  await settle();
  assert.equal(junk.sb.reads.length, 0, "nothing is read for a value that isn't an id");

  const flaky = runtime({ rows: SOME, storage: new Map([["gb_hid:u1", HID]]) });
  flaky.sb.failNextRead({ message: "down" });
  const kits = await new Promise(async r => (await flaky.claude.use("db")).collection("kits").onSnapshot(r));
  assert.equal(docsOf(kits).length, 1, "read again once the household is known");

  const none = runtime({ rows: SOME });
  const again = await new Promise(async r => (await none.claude.use("db")).collection("kits").onSnapshot(r));
  assert.equal(docsOf(again).length, 1);

  const refused = runtime({ rows: SOME, storage: new Map([["gb_hid:u1", HID]]), rpc: { my_household: () => ({ data: null, error: { message: "no" } }) } });
  assert.equal(await pending(refused.claude.use("db")), "pending", "no household, no page, whatever was remembered");
});

/* ---------- assets ---------- */

test("photos go in the household's folder, and the page keeps its <uuid>.<ext> ids", async () => {
  const { claude, sb } = runtime();
  const assets = await claude.use("assets");
  const { id } = await assets.upload({ type: "image/jpeg" }, { type: "image/jpeg" });
  assert.match(id, new RegExp(`^${UUID}\\.jpg$`));
  assert.equal(sb.uploads.length, 1);
  assert.equal(sb.uploads[0].bucket, "photos");
  assert.equal(sb.uploads[0].path, `${HID}/${id}`);
  assert.equal(plain(sb.uploads[0].opts).upsert, false, "never overwrites");

  const png = await assets.upload({ type: "image/png" });
  assert.match(png.id, new RegExp(`^${UUID}\\.png$`));

  await assets.delete(id);
  assert.deepEqual(plain(sb.removes), [{ bucket: "photos", paths: [`${HID}/${id}`] }]);
});

test("a photo id that could reach outside the household's folder is refused", async () => {
  const { claude, sb } = runtime();
  const assets = await claude.use("assets");
  for (const bad of ["../x.jpg", `${OTHER}/${crypto.randomUUID()}.jpg`, "", "a/b", undefined]) {
    await assert.rejects(assets.delete(bad), e => e.code === "invalid_argument", String(bad));
  }
  assert.equal(sb.removes.length, 0);
});

/* ---------- the page on the runtime ---------- */

test("the page boots on the Vercel runtime and loads the standard household", async () => {
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "household.json"), "utf8"));
  const rows = [
    ...["kits", "items"].flatMap(col => f[col].map(({ id, ...data }) => ({ col, id, data }))),
    ...["profile", "hazards"].map(id => ({ col: "household", id, data: f[id] })),
  ];
  const { claude } = runtime({ rows });
  const app = load({ boot: true, claude });
  await settle(6);
  assert.equal(app.json("S.loaded"), true);
  assert.equal(app.json("S.live"), true);
  assert.equal(app.json("S.kits.length"), f.kits.length);
  assert.equal(app.json("S.items.length"), f.items.length);
  assert.deepEqual(app.json("S.profile"), f.profile);
});

/* ---------- the build ---------- */

test("the page draws once when the household arrives, and at once for each change after that", async () => {
  const f = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "household.json"), "utf8"));
  const rows = [
    ...["kits", "items"].flatMap(col => f[col].map(({ id, ...data }) => ({ col, id, data }))),
    ...["profile", "hazards"].map(id => ({ col: "household", id, data: f[id] })),
  ];
  const { claude, sb, comeBack } = runtime({ rows });
  const app = load({ boot: true, claude });
  app.run("globalThis.__draws = 0; { const r = render; render = function () { __draws++; return r.apply(this, arguments); }; }");
  await settle(6);
  assert.equal(app.json("S.loaded"), true);
  assert.equal(app.json("__draws"), 1, "seven snapshots, one draw");

  comeBack();
  await settle(6);
  assert.equal(app.json("__draws"), 1, "back on the tab with nothing new: no draw");

  const db = await claude.use("db");
  await db.doc("items/new1").set({ name: "Torch", qty: 1, kitId: f.kits[0].id });
  assert.equal(app.json("__draws"), 2, "a save draws before it returns");
  assert.equal(app.json("S.items.length"), f.items.length + 1);
  sb.broadcast("insert", { col: "items", id: "new1" });
  await settle(6);
  assert.equal(app.json("__draws"), 2, "and its echo draws nothing");
});

const walk = (dir, base = "") => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(path.join(dir, e.name), base + e.name + "/") : [base + e.name]);

function withBuild(env, fn) {
  const { build } = require("../tools/build-web");
  const { render } = require("../tools/landing");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-web-"));
  const stub = path.join(out, "stub-supabase.js");
  fs.writeFileSync(stub, "window.supabase = {};");
  const warned = [], warn = console.warn;
  console.warn = (...a) => warned.push(a.join(" "));
  try {
    const dist = path.join(out, "dist");
    build(dist, env, stub);
    return fn({ dist, read: f => fs.readFileSync(path.join(dist, f), "utf8"), render, warned, build, stub });
  } finally { console.warn = warn; fs.rmSync(out, { recursive: true, force: true }); }
}
const BASE = { SUPABASE_URL: "https://db.example", SUPABASE_PUBLISHABLE_KEY: "pk" };
const configOf = html => {
  const m = html.match(/<script>window\.GO_BAG_CONFIG = ([\s\S]*?);<\/script>/);
  assert.ok(m, "the head sets GO_BAG_CONFIG");
  return JSON.parse(m[1]);
};

test("the build needs Supabase's address and key", () => {
  const { build } = require("../tools/build-web");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-web-"));
  try {
    for (const env of [{}, { SUPABASE_URL: "https://db.example" }, { SUPABASE_PUBLISHABLE_KEY: "pk" }])
      assert.throws(() => build(path.join(out, "dist"), env, __filename), /SUPABASE_URL/);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test("the build puts the landing at / and the page, wrapped byte for byte, at /app", () => {
  withBuild({ ...BASE, SUPABASE_PUBLISHABLE_KEY: "pk</script><script>alert(1)</script>", CONTACT_EMAIL: "hello@go-bag.example" }, ({ dist, read, render }) => {
    assert.deepEqual(walk(dist).sort(), ["app/index.html", "core.js", "index.html", "runtime.js", "signin.js", "supabase.js"]);

    const html = read("app/index.html");
    const page = fs.readFileSync(path.join(ROOT, "emergency-kit-audit.html"), "utf8");
    assert.ok(html.includes(`<body>${page}</body>`), "the page is copied unchanged");
    const head = html.slice(0, html.indexOf("<body>"));
    const at = ["window.GO_BAG_CONFIG", "/supabase.js?v=", "/signin.js?v=", "/runtime.js?v=", "/core.js?v="].map(s => head.indexOf(s));
    assert.ok(at.every(i => i >= 0), "config, supabase-js, the sign-in card, the runtime and the core all load");
    assert.deepEqual([...at].sort((a, b) => a - b), at, "in that order: config, supabase, signin, runtime, core");
    assert.equal(head.match(/<\/script>/g).length, 5, "config values can't close the script tag");
    assert.equal((head.match(/<script>/g) || []).length, 1, "the core is served as its own file, not inlined: only the config is inline");
    assert.equal(configOf(html).supabaseKey, "pk</script><script>alert(1)</script>", "the value still arrives whole");

    for (const name of ["supabase.js", "signin.js", "runtime.js", "core.js"]) {
      const v = head.match(new RegExp(`/${name.replace(".", "\\.")}\\?v=([0-9a-f]+)"`))[1];
      const hash = require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(dist, name))).digest("hex");
      assert.ok(hash.startsWith(v) && v.length >= 8, `${name} is loaded by its content hash`);
    }
    assert.equal(read("signin.js"), fs.readFileSync(path.join(ROOT, "web", "signin.js"), "utf8"));
    assert.equal(read("runtime.js"), fs.readFileSync(path.join(ROOT, "web", "runtime.js"), "utf8"));
    assert.equal(read("core.js"), fs.readFileSync(path.join(ROOT, "core.js"), "utf8"));

    const landing = read("index.html");
    assert.equal(landing, render({ contactEmail: "hello@go-bag.example" }));
    assert.ok(!/<script\s+src/i.test(landing), "the landing loads no scripts");
  });
});

test("CONTACT_EMAIL reaches the landing and SENDER_EMAIL the sign-in card's config", () => {
  withBuild({ ...BASE, CONTACT_EMAIL: "hello@go-bag.example", SENDER_EMAIL: "links@go-bag.example" }, ({ read, warned }) => {
    assert.ok(read("index.html").includes("mailto:hello@go-bag.example"));
    assert.deepEqual(configOf(read("app/index.html")), { supabaseUrl: "https://db.example", supabaseKey: "pk", senderEmail: "links@go-bag.example" });
    assert.deepEqual(warned, []);
  });
  withBuild({ ...BASE, CONTACT_EMAIL: "hello@go-bag.example" }, ({ read }) => {
    assert.ok(!("senderEmail" in configOf(read("app/index.html"))), "no sender line without SENDER_EMAIL");
  });
});

test("without CONTACT_EMAIL the build still succeeds, and says what's missing", () => {
  for (const unset of [{}, { CONTACT_EMAIL: "" }]) {
    withBuild({ ...BASE, ...unset }, ({ read, render, warned }) => {
      assert.equal(read("index.html"), render({ contactEmail: "" }));
      assert.deepEqual(warned, ["build-web: CONTACT_EMAIL is not set; the landing's privacy line has no deletion address. Set it before opening."]);
    });
  }
});

/* ---------- vercel.json ---------- */

test("vercel.json serves / and /app fresh, the scripts forever, and photos through /_blob", () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  assert.equal(v.outputDirectory, "dist");
  const headerFor = (source, key) => (v.headers.find(h => h.source === source)?.headers || []).find(h => h.key === key)?.value;
  for (const p of ["/", "/app", "/app/"]) assert.equal(headerFor(p, "Cache-Control"), "no-cache", p);
  // Every script the app page loads is kept for a year: each one's address carries a hash of its content (the build test above).
  assert.equal(headerFor("/(supabase|signin|runtime|core).js", "Cache-Control"), "public, max-age=31536000, immutable");
  assert.equal(headerFor("/(.*)", "X-Content-Type-Options"), "nosniff");
  assert.equal(headerFor("/(.*)", "Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(headerFor("/(.*)", "X-Frame-Options"), "DENY");
  assert.deepEqual(v.rewrites.find(r => r.source === "/_blob/:id"), { source: "/_blob/:id", destination: "/api/blob?id=:id" });
  for (const p of ["/app", "/app/"]) assert.equal(v.rewrites.find(r => r.source === p)?.destination, "/app/index.html", `${p} is served, not redirected`);
  assert.ok(!("trailingSlash" in v) && !("cleanUrls" in v), "no setting that redirects /app and /app/ into each other");
  assert.ok(!(v.redirects || []).some(r => /^\/app/.test(r.source)), "no redirect on /app");
});

test("Claude's JSON answers parse even with a stray code fence or sentence around them", async () => {
  const { parseJson } = await import("../api/_json.mjs");
  assert.deepEqual(parseJson('[{"id":"a"}]'), [{ id: "a" }]);
  assert.deepEqual(parseJson('```json\n{"hazards":[]}\n```'), { hazards: [] });
  assert.deepEqual(parseJson('Here you go: {"a":1} Hope that helps.'), { a: 1 });
  assert.throws(() => parseJson("no json here"), e => e.code === "invalid_json");
});
