// Kit photos through /_blob/<id> (api/blob.mjs, issue #72): each household's photos sit in its own
// `<household_id>/` folder of the `photos` bucket, and the folder always comes from the database's
// my_household_id(), never from the request. fetch is stubbed, so no network and no install.
const test = require("node:test");
const assert = require("node:assert/strict");

const SUPABASE = "https://stub.supabase.test";
const ID = "0f8fad5b-d9cb-469f-a165-70867728950e.jpg";
const HID = "6c1d3b5e-2a47-4f0e-9b8c-1d2e3f4a5b6c";
const OTHER = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

let blob;
test.before(async () => {
  process.env.SUPABASE_URL = SUPABASE;
  process.env.SUPABASE_PUBLISHABLE_KEY = "pk_stub";
  blob = await import("../api/blob.mjs");
});

// A stand-in for Supabase: answers my_household_id and the sign call, and records every request.
function stub({ household = HID, rpc, sign } = {}) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, search: u.search, init });
    if (u.pathname === "/rest/v1/rpc/my_household_id") {
      if (rpc) return rpc();
      return new Response(JSON.stringify(household), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.pathname.startsWith("/storage/v1/object/sign/")) {
      if (sign) return sign(u);
      const object = u.pathname.slice("/storage/v1/object/sign/".length);
      return new Response(JSON.stringify({ signedURL: `/object/sign/${object}?token=signed` }), { status: 200 });
    }
    return new Response("unexpected", { status: 599 });
  };
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

const get = (id, { cookie = "gb_at=tok", query = "", headers = {} } = {}) =>
  blob.GET(new Request(`https://go-bag.test/api/blob?id=${encodeURIComponent(id)}${query}`, {
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  }));

async function withStub(opts, fn) {
  const s = stub(opts);
  try { return await fn(s.calls); } finally { s.restore(); }
}

test("a signed-in caller's photo is signed in its own household's folder, then redirected to", () =>
  withStub({}, async calls => {
    const r = await get(ID, { cookie: "other=1; gb_at=tok; x=2" });
    assert.equal(r.status, 302);
    const rpc = calls.find(c => c.path === "/rest/v1/rpc/my_household_id");
    assert.ok(rpc, "it asks the database for the caller's household");
    assert.equal(rpc.init.method, "POST");
    assert.equal(new Headers(rpc.init.headers).get("authorization"), "Bearer tok", "with the caller's own token");
    const signs = calls.filter(c => c.path.startsWith("/storage/v1/object/sign/"));
    assert.equal(signs.length, 1);
    assert.equal(signs[0].path, `/storage/v1/object/sign/photos/${HID}/${ID}`);
    assert.equal(new Headers(signs[0].init.headers).get("authorization"), "Bearer tok");
    assert.equal(r.headers.get("location"), `${SUPABASE}/storage/v1/object/sign/photos/${HID}/${ID}?token=signed`);
  }));

test("the folder is whatever my_household_id answers for this token", () =>
  withStub({ household: OTHER }, async calls => {
    const r = await get(ID);
    assert.equal(r.status, 302);
    assert.equal(calls.find(c => c.path.includes("/sign/")).path, `/storage/v1/object/sign/photos/${OTHER}/${ID}`);
  }));

test("no household, or a token the database refuses, is told to sign in and nothing is signed", async () => {
  const cases = [
    { household: null },
    { rpc: () => new Response(JSON.stringify({ message: "JWT expired" }), { status: 401 }) },
  ];
  for (const opts of cases) {
    await withStub(opts, async calls => {
      const r = await get(ID);
      assert.equal(r.status, 401);
      assert.match(await r.text(), /sign in/i);
      assert.equal(calls.filter(c => c.path.includes("/sign/")).length, 0, "nothing is signed");
    });
  }
});

test("no cookie is told to sign in before any fetch", () =>
  withStub({}, async calls => {
    for (const cookie of [null, "gb_at=", "other=tok"]) {
      const r = await get(ID, { cookie });
      assert.equal(r.status, 401);
    }
    assert.equal(calls.length, 0);
  }));

test("an answer from my_household_id that is not a household id signs nothing", async () => {
  for (const household of ["../" + HID, `${HID}/x`, "", 42, { id: HID }, [HID]]) {
    await withStub({ household }, async calls => {
      const r = await get(ID);
      assert.notEqual(r.status, 302, `answer ${JSON.stringify(household)}`);
      assert.equal(calls.filter(c => c.path.includes("/sign/")).length, 0, `answer ${JSON.stringify(household)}`);
    });
  }
});

test("a refused sign gives 404, and Storage or the database unreachable gives 502", async () => {
  for (const status of [400, 403, 404]) {
    await withStub({ sign: () => new Response(JSON.stringify({ error: "not found" }), { status }) }, async () => {
      assert.equal((await get(ID)).status, 404, `sign answered ${status}`);
    });
  }
  await withStub({ sign: () => Promise.reject(new TypeError("fetch failed")) }, async () => {
    assert.equal((await get(ID)).status, 502);
  });
  await withStub({ rpc: () => Promise.reject(new TypeError("fetch failed")) }, async calls => {
    assert.equal((await get(ID)).status, 502);
    assert.equal(calls.filter(c => c.path.includes("/sign/")).length, 0);
  });
  await withStub({ rpc: () => new Response("oops", { status: 500 }) }, async calls => {
    assert.equal((await get(ID)).status, 502);
    assert.equal(calls.filter(c => c.path.includes("/sign/")).length, 0);
  });
  await withStub({ sign: () => new Response("{}", { status: 200 }) }, async () => {
    assert.equal((await get(ID)).status, 502, "a sign answer with no signed URL");
  });
});

test("an id that fails the pattern is not found before any fetch", () =>
  withStub({}, async calls => {
    const bad = ["../x.jpg", "a/b.jpg", "0f8fad5b-d9cb-469f-a165-70867728950e", `${HID}/${ID}`, `../${ID}`,
      `${ID}/../x.jpg`, "0f8fad5b-d9cb-469f-a165-70867728950e.exe", `${ID}\n`, `%2e%2e/${ID}`, ""];
    for (const id of bad) {
      const r = await get(id);
      assert.equal(r.status, 404, `id ${JSON.stringify(id)}`);
    }
    assert.equal(calls.length, 0);
  }));

test("neither a query parameter nor a header can change the folder it signs", () =>
  withStub({}, async calls => {
    const r = await get(ID, {
      query: `&household_id=${OTHER}&household=${OTHER}&folder=${OTHER}&id=${OTHER}/${ID}&path=${OTHER}/${ID}`,
      headers: {
        "x-household-id": OTHER, "x-household": OTHER, "x-folder": OTHER,
        "x-forwarded-prefix": `/${OTHER}`, "x-original-url": `/_blob/${OTHER}/${ID}`,
      },
    });
    assert.equal(r.status, 302);
    const signs = calls.filter(c => c.path.includes("/sign/"));
    assert.deepEqual(signs.map(c => c.path), [`/storage/v1/object/sign/photos/${HID}/${ID}`]);
    for (const c of calls) {
      assert.equal(c.search, "", "nothing from the request rides along in a query");
      assert.ok(!JSON.stringify(c.init).includes(OTHER), "nothing from the request rides along in headers or body");
    }
  }));
