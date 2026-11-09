// The one-off photo move (tools/move-photos.js, issue #89): every kit photo at the root of the `photos`
// bucket goes into the family household's folder, <family_id>/<name>, with Storage's own move, so
// 0003_photo_folders.sql can apply. fetch is a stand-in for Supabase here: no network, no keys.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { main } = require("../tools/move-photos");

const URL_ = "https://stub.supabase.test";
const KEY = "sb_secret_STUB-0123456789-never-print-me";
const FAMILY = "6c1d3b5e-2a47-4f0e-9b8c-1d2e3f4a5b6c";
const OTHER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ENV = { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY };

// n made-up photo names, uuid.ext like the real ones, in name order.
const photos = (n, from = 0) => Array.from({ length: n }, (_, i) =>
  `${(from + i).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000.${["jpg", "png", "webp"][i % 3]}`);

// A stand-in for Supabase: the households table and the `photos` bucket, keyed by object name the
// way storage.objects is. It lists the way Storage does (one folder level, folders as entries with
// id null, at most `limit` entries from `offset`), and moves with Storage's own rules (a destination
// that exists is a Duplicate). Every request is recorded.
function supabase({ households = [{ id: FAMILY, name: "family" }], objects = [], failMove = () => false, pageCap = Infinity } = {}) {
  const bucket = new Map(objects.map(n => [n, { bytes: `file:${n}` }]));
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: u.pathname, search: u.search, method: init.method || "GET", headers: new Headers(init.headers), body });
    if (new Headers(init.headers).get("apikey") !== KEY) return json({ message: "Invalid API key" }, 401);
    if (u.pathname === "/rest/v1/households") {
      const name = (u.searchParams.get("name") || "").replace(/^eq\./, "");
      return json(households.filter(h => !u.searchParams.has("name") || h.name === name).map(h => ({ id: h.id })));
    }
    if (u.pathname === "/storage/v1/object/list/photos") {
      const prefix = (body.prefix || "").replace(/\/+$/, "");
      const inside = prefix ? [...bucket.keys()].filter(n => n.startsWith(prefix + "/")).map(n => n.slice(prefix.length + 1)) : [...bucket.keys()];
      const entries = new Map();
      for (const rest of inside) {
        const slash = rest.indexOf("/");
        if (slash < 0) entries.set(rest, { name: rest, id: `id-${rest}`, metadata: {} });
        else entries.set(rest.slice(0, slash), { name: rest.slice(0, slash), id: null, metadata: null });
      }
      const sorted = [...entries.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      const limit = Math.min(body.limit ?? 100, pageCap);
      return json(sorted.slice(body.offset || 0, (body.offset || 0) + limit));
    }
    if (u.pathname === "/storage/v1/object/move") {
      assert.equal(body.bucketId, "photos");
      if (failMove(body.sourceKey)) return json({ statusCode: "500", error: "Internal", message: "storage hiccup" }, 500);
      if (!bucket.has(body.sourceKey)) return json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400);
      if (bucket.has(body.destinationKey)) return json({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }, 400);
      bucket.set(body.destinationKey, bucket.get(body.sourceKey));
      bucket.delete(body.sourceKey);
      return json({ message: "Successfully moved" });
    }
    return json({ message: "unexpected" }, 599);
  };
  return { fetch, calls, bucket };
}

// Runs the tool against a stand-in and captures what it writes.
async function run(sb, { argv = [], env = ENV } = {}) {
  let stdout = "", stderr = "";
  const code = await main({ argv, env, fetch: sb.fetch, stdout: { write: s => { stdout += s; } }, stderr: { write: s => { stderr += s; } } });
  return { code, stdout, stderr, all: stdout + stderr };
}
const roots = sb => [...sb.bucket.keys()].filter(n => !n.includes("/"));
const changes = sb => sb.calls.filter(c => c.method !== "GET" && !c.path.startsWith("/storage/v1/object/list/"));

test("it refuses to run without SUPABASE_URL or without the service key, and calls nothing", async () => {
  for (const env of [{}, { SUPABASE_URL: URL_ }, { SUPABASE_SERVICE_ROLE_KEY: KEY }, { SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: KEY }, { SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: "  " }]) {
    const sb = supabase({ objects: photos(3) });
    const r = await run(sb, { env });
    assert.notEqual(r.code, 0, `refuses with ${Object.keys(env).join(", ") || "neither"}`);
    assert.equal(sb.calls.length, 0, "it calls nothing");
    assert.match(r.stderr, /SUPABASE_URL/);
    assert.ok(!r.all.includes(KEY));
  }
});

test("run as a command with no keys, it exits non-zero before touching the network", () => {
  const cli = path.join(__dirname, "..", "tools", "move-photos.js");
  const env = { ...process.env };
  delete env.SUPABASE_URL; delete env.SUPABASE_SERVICE_ROLE_KEY;
  assert.throws(() => execFileSync(process.execPath, [cli, "--dry-run"], { env, stdio: ["ignore", "pipe", "pipe"] }),
    e => e.status !== 0 && /SUPABASE_SERVICE_ROLE_KEY/.test(String(e.stderr)));
});

test("an unknown argument, such as a misspelt --dry-run, stops it before anything moves", async () => {
  for (const argv of [["--dryrun"], ["--dry-run", "extra"], ["-n"]]) {
    const sb = supabase({ objects: photos(3) });
    const r = await run(sb, { argv });
    assert.notEqual(r.code, 0);
    assert.equal(changes(sb).length, 0);
    assert.equal(roots(sb).length, 3);
  }
});

test("it refuses unless exactly one household is named family, and moves nothing", async () => {
  const cases = [
    [],
    [{ id: FAMILY, name: "family" }, { id: OTHER, name: "family" }],
    [{ id: OTHER, name: "someone else" }],
    [{ id: "not-a-uuid", name: "family" }],
  ];
  for (const households of cases) {
    const sb = supabase({ households, objects: photos(4) });
    const r = await run(sb);
    assert.notEqual(r.code, 0, `refuses with ${JSON.stringify(households)}`);
    assert.equal(changes(sb).length, 0);
    assert.equal(roots(sb).length, 4);
  }
  const sb = supabase({ objects: photos(1) });
  await run(sb);
  const ask = sb.calls.find(c => c.path === "/rest/v1/households");
  assert.equal(new URLSearchParams(ask.search).get("name"), "eq.family", "it asks for households named family");
  assert.equal(ask.headers.get("authorization"), `Bearer ${KEY}`, "with the service key");
});

test("it moves only root names, each to <family_id>/<name>, with Storage's own move", async () => {
  const root = photos(5);
  const nested = [`${OTHER}/${photos(1, 50)[0]}`, `${FAMILY}/${photos(1, 60)[0]}`];
  const sb = supabase({ objects: [...root, ...nested] });
  const before = new Map(sb.bucket);
  const r = await run(sb);
  assert.equal(r.code, 0, r.stderr);
  const moves = sb.calls.filter(c => c.path === "/storage/v1/object/move");
  assert.deepEqual(moves.map(m => [m.body.sourceKey, m.body.destinationKey]).sort(), root.map(n => [n, `${FAMILY}/${n}`]).sort());
  assert.ok(moves.every(m => m.method === "POST"));
  assert.equal(sb.calls.filter(c => c.path.startsWith("/rest/v1/") && c.path !== "/rest/v1/households").length, 0, "no SQL or table writes");
  assert.deepEqual(roots(sb), []);
  for (const n of root) assert.equal(sb.bucket.get(`${FAMILY}/${n}`), before.get(n), "the same stored file, under its new name");
  for (const n of nested) assert.equal(sb.bucket.get(n), before.get(n), "objects already in a folder stay put");
  assert.match(r.stdout, /moved\D*5\b/i);
  assert.match(r.stdout, /failed\D*0\b/i);
  assert.match(r.stdout, /root count\D*0\b/i);
});

test("it pages through every root object, past the first page", async () => {
  const root = photos(257);
  const sb = supabase({ objects: [...root, `${FAMILY}/${photos(1, 900)[0]}`] });
  const r = await run(sb);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(sb.calls.filter(c => c.path === "/storage/v1/object/move").length, 257);
  assert.deepEqual(roots(sb), []);
  assert.match(r.stdout, /moved\D*257\b/i);
});

test("it pages correctly when the server returns fewer per page than asked", async () => {
  const sb = supabase({ objects: photos(23), pageCap: 10 });
  const r = await run(sb, { argv: ["--dry-run"] });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\b23\b/);
});

test("--dry-run reports the count and the first few names, and changes nothing", async () => {
  const root = photos(100);
  const sb = supabase({ objects: root });
  const before = new Map(sb.bucket);
  const r = await run(sb, { argv: ["--dry-run"] });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(changes(sb).length, 0, "no move or any other change");
  assert.deepEqual(sb.bucket, before);
  assert.match(r.stdout, /\b100\b/);
  assert.ok(r.stdout.includes(root[0]), "shows the first names");
  assert.ok(!r.stdout.includes(root[99]), "only the first few");
  assert.match(r.stdout, /root count\D*100\b/i);
});

test("running it twice is safe: the second run moves nothing and reports 0 at the root", async () => {
  const sb = supabase({ objects: photos(7) });
  assert.equal((await run(sb)).code, 0);
  const after = new Map(sb.bucket);
  const again = await run(sb);
  assert.equal(again.code, 0, again.stderr);
  assert.deepEqual(sb.bucket, after);
  assert.match(again.stdout, /moved\D*0\b/i);
  assert.match(again.stdout, /root count\D*0\b/i);
});

test("a name whose destination already exists is skipped, never overwritten", async () => {
  const [a, b, c] = photos(3);
  const sb = supabase({ objects: [a, b, c, `${FAMILY}/${b}`] });
  sb.bucket.set(`${FAMILY}/${b}`, { bytes: "the copy already in the folder" });
  const r = await run(sb);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(sb.bucket.get(`${FAMILY}/${b}`).bytes, "the copy already in the folder");
  assert.ok(sb.bucket.has(b), "the root copy is left for the founder to compare");
  assert.ok(!sb.calls.some(m => m.path === "/storage/v1/object/move" && m.body.sourceKey === b), "it doesn't try to move it");
  assert.match(r.stdout, /moved\D*2\b/i);
  assert.match(r.stdout, /skipped\D*1\b/i);
  assert.match(r.stdout, /root count\D*1\b/i);
});

test("a destination that appears between the listing and the move is skipped too", async () => {
  const [a, b] = photos(2);
  const sb = supabase({ objects: [a, b] });
  const inner = sb.fetch;
  sb.fetch = async (url, init) => {
    const body = init?.body && JSON.parse(init.body);
    if (body?.sourceKey === a) sb.bucket.set(`${FAMILY}/${a}`, { bytes: "raced" });
    return inner(url, init);
  };
  const r = await run(sb);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(sb.bucket.get(`${FAMILY}/${a}`).bytes, "raced");
  assert.match(r.stdout, /moved\D*1\b/i);
  assert.match(r.stdout, /skipped\D*1\b/i);
});

test("a failed move makes it exit non-zero, and the rest still move", async () => {
  const root = photos(4);
  const sb = supabase({ objects: root, failMove: n => n === root[1] });
  const r = await run(sb);
  assert.notEqual(r.code, 0);
  assert.deepEqual(roots(sb), [root[1]]);
  assert.match(r.stdout + r.stderr, /failed\D*1\b/i);
  assert.ok(r.stderr.includes(root[1]), "it names the one that failed");
  assert.match(r.stdout, /root count\D*1\b/i);
});

test("a network error on a move counts as failed, not as a crash", async () => {
  const root = photos(2);
  const sb = supabase({ objects: root });
  const inner = sb.fetch;
  sb.fetch = async (url, init) => {
    if (url.endsWith("/object/move") && JSON.parse(init.body).sourceKey === root[0]) throw new TypeError("fetch failed");
    return inner(url, init);
  };
  const r = await run(sb);
  assert.notEqual(r.code, 0);
  assert.match(r.stdout + r.stderr, /failed\D*1\b/i);
  assert.match(r.stdout, /moved\D*1\b/i);
});

test("a listing that fails stops it with a non-zero exit before anything moves", async () => {
  const sb = supabase({ objects: photos(3) });
  const inner = sb.fetch;
  sb.fetch = async (url, init) => url.includes("/object/list/") ? new Response("{}", { status: 500 }) : inner(url, init);
  const r = await run(sb);
  assert.notEqual(r.code, 0);
  assert.equal(changes(sb).length, 0);
});

test("a listing that never ends (the same page again and again) stops it instead of looping", { timeout: 5000 }, async () => {
  const page = photos(100).map(name => ({ name, id: `id-${name}` }));
  const sb = supabase({ objects: [] });
  const inner = sb.fetch;
  sb.fetch = async (url, init) => url.includes("/object/list/") ? new Response(JSON.stringify(page), { status: 200 }) : inner(url, init);
  const r = await run(sb, { argv: ["--dry-run"] });
  assert.notEqual(r.code, 0);
});

test("it never writes the service key to stdout or stderr, whatever happens", async () => {
  const echoKey = async () => new Response(JSON.stringify({ message: `bad key ${KEY}` }), { status: 500 });
  const throwsKey = async () => { throw new Error(`could not reach ${URL_} with ${KEY}`); };
  const scenarios = [
    supabase({ objects: photos(3) }),
    supabase({ objects: photos(3), failMove: () => true }),
    supabase({ households: [] }),
    { ...supabase(), fetch: echoKey },
    { ...supabase(), fetch: throwsKey },
  ];
  for (const sb of scenarios) {
    for (const argv of [[], ["--dry-run"]]) {
      const r = await run(sb, { argv });
      assert.ok(!r.all.includes(KEY), `key leaked: ${r.all}`);
      assert.ok(!r.all.includes(KEY.slice(0, 20)), "not even part of it");
    }
  }
});
