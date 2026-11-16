// Kit photos through /_blob/<id> (api/blob.mjs, issues #72 and #157): each household's photos sit in its
// own `<household_id>/` folder of the `photos` bucket, and the folder always comes from the database's
// my_household_id(), never from the request. The function sends the photo's bytes for the browser to
// keep, and remembers a token's household for a few minutes. fetch is stubbed, so no network and no install.
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

const READ = "/storage/v1/object/authenticated/";
const BYTES = "the photo's bytes";
const reads = calls => calls.filter(c => c.path.startsWith(READ));

// A stand-in for Supabase: answers my_household_id and the photo read, and records every request.
// Each stub starts with nothing remembered, as a cold function does.
function stub({ household = HID, rpc, read } = {}) {
  blob.households.clear();
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, search: u.search, init });
    if (u.pathname === "/rest/v1/rpc/my_household_id") {
      if (rpc) return rpc();
      // `household` may be a function of the caller's token, for two accounts in two households.
      const token = new Headers(init.headers).get("authorization").replace("Bearer ", "");
      const answer = typeof household === "function" ? household(token) : household;
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.pathname.startsWith(READ)) {
      if (read) return read(u);
      // Storage's own type is whatever the uploader said; the function must not pass it on.
      return new Response(BYTES, { status: 200, headers: { "content-type": "text/html", "content-length": String(BYTES.length),
        "cache-control": "public, max-age=1", "set-cookie": "x=1", etag: '"abc"' } });
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

test("a signed-in caller's photo is read from its own household's folder and sent as bytes", () =>
  withStub({}, async calls => {
    const r = await get(ID, { cookie: "other=1; gb_at=tok; x=2" });
    assert.equal(r.status, 200);
    assert.equal(await r.text(), BYTES);
    const rpc = calls.find(c => c.path === "/rest/v1/rpc/my_household_id");
    assert.ok(rpc, "it asks the database for the caller's household");
    assert.equal(rpc.init.method, "POST");
    assert.equal(new Headers(rpc.init.headers).get("authorization"), "Bearer tok", "with the caller's own token");
    assert.equal(reads(calls).length, 1);
    assert.equal(reads(calls)[0].path, `${READ}photos/${HID}/${ID}`);
    assert.equal(new Headers(reads(calls)[0].init.headers).get("authorization"), "Bearer tok", "Storage checks the caller's own token");
    assert.equal(r.headers.get("location"), null, "no redirect to a link that changes");
  }));

test("the browser is told to keep a photo for a year, and only the browser", () =>
  withStub({}, async () => {
    const r = await get(ID);
    assert.equal(r.headers.get("cache-control"), "private, max-age=31536000, immutable");
  }));

test("the type sent is the id's own, whatever Storage says", async () => {
  const types = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
  for (const [ext, type] of Object.entries(types)) {
    await withStub({}, async () => {
      const r = await get(ID.replace(/jpg$/, ext));
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), type);
    });
  }
});

test("the folder is whatever my_household_id answers for this token", () =>
  withStub({ household: OTHER }, async calls => {
    const r = await get(ID);
    assert.equal(r.status, 200);
    assert.equal(reads(calls)[0].path, `${READ}photos/${OTHER}/${ID}`);
  }));

test("a kit's photos ask the database for the household once, and Storage for every photo", () =>
  withStub({}, async calls => {
    const ids = [ID, ID.replace(/^0/, "1"), ID.replace(/^0/, "2")];
    const rs = await Promise.all(ids.map(id => get(id)));
    assert.deepEqual(rs.map(r => r.status), [200, 200, 200]);
    assert.equal((await get(ID)).status, 200, "and a later one");
    assert.equal(calls.filter(c => c.path === "/rest/v1/rpc/my_household_id").length, 1);
    assert.equal(reads(calls).length, 4, "Storage checks the token on every photo");
  }));

test("a remembered household is one token's only, and is asked again after five minutes", async t => {
  await withStub({}, async calls => {
    const asked = () => calls.filter(c => c.path === "/rest/v1/rpc/my_household_id");
    await get(ID);
    await get(ID, { cookie: "gb_at=another" });
    assert.deepEqual(asked().map(c => new Headers(c.init.headers).get("authorization")), ["Bearer tok", "Bearer another"]);
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    t.mock.timers.tick(4 * 60 * 1000);
    await get(ID);
    assert.equal(asked().length, 2, "still remembered at four minutes");
    t.mock.timers.tick(2 * 60 * 1000);
    await get(ID);
    assert.equal(asked().length, 3, "asked again after five");
  });
});

test("two tokens in two households each read their own folder, remembered or not", () =>
  withStub({ household: token => (token === "theirs" ? OTHER : HID) }, async calls => {
    for (let n = 0; n < 2; n++) {
      await get(ID);
      await get(ID, { cookie: "gb_at=theirs" });
    }
    assert.deepEqual(reads(calls).map(c => [new Headers(c.init.headers).get("authorization"), c.path]), [
      ["Bearer tok", `${READ}photos/${HID}/${ID}`], ["Bearer theirs", `${READ}photos/${OTHER}/${ID}`],
      ["Bearer tok", `${READ}photos/${HID}/${ID}`], ["Bearer theirs", `${READ}photos/${OTHER}/${ID}`],
    ]);
    assert.equal(calls.filter(c => c.path === "/rest/v1/rpc/my_household_id").length, 2);
  }));

test("the photo's length is sent on, and nothing else of Storage's headers", () =>
  withStub({}, async () => {
    const r = await get(ID);
    assert.equal(r.headers.get("content-length"), String(BYTES.length), "so a photo cut off part way is not kept");
    assert.deepEqual([...r.headers.keys()].sort(), ["cache-control", "content-length", "content-type"]);
  }));

test("an encoded photo goes without a length, and an empty one is not served or kept", async () => {
  await withStub({ read: () => new Response(BYTES, { headers: { "content-encoding": "gzip", "content-length": "5" } }) }, async () => {
    const r = await get(ID);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-length"), null);
  });
  await withStub({ read: () => new Response("", { status: 200, headers: { "content-length": "0" } }) }, async () => {
    const r = await get(ID);
    assert.equal(r.status, 502);
    assert.equal(r.headers.get("cache-control"), "no-store");
  });
});

test("the five hundred and first token starts the memory again, and one still being asked keeps its answer", async () => {
  let release;
  const gate = new Promise(res => { release = res; });
  await withStub({ rpc: async () => { await gate; return new Response(JSON.stringify(HID)); } }, async calls => {
    const waiting = get(ID); // asked before the memory fills, answered after it is cleared
    for (let n = 0; n < 499; n++) blob.households.set("t" + n, { at: Date.now(), answer: Promise.resolve({ household: OTHER }) });
    assert.equal(blob.households.size, 500);
    const next = get(ID, { cookie: "gb_at=new" });
    assert.equal(blob.households.size, 1, "only the new token is remembered");
    release();
    assert.equal((await waiting).status, 200);
    assert.equal((await next).status, 200);
    assert.deepEqual(reads(calls).map(c => c.path), [`${READ}photos/${HID}/${ID}`, `${READ}photos/${HID}/${ID}`]);
  });
});

test("callers who shared a failed lookup all get the failure, and the next one asks again", async () => {
  let fail = true;
  await withStub({ rpc: () => fail ? new Response("oops", { status: 500 }) : new Response(JSON.stringify(HID)) }, async calls => {
    const rs = await Promise.all([get(ID), get(ID), get(ID)]);
    assert.deepEqual(rs.map(r => r.status), [502, 502, 502]);
    assert.equal(calls.filter(c => c.path === "/rest/v1/rpc/my_household_id").length, 1);
    fail = false;
    assert.equal((await get(ID)).status, 200);
    assert.equal(reads(calls).length, 1);
  });
});

test("when Storage refuses a photo, the household is forgotten and asked for again", async () => {
  let refuse = true;
  await withStub({ read: () => refuse ? new Response("{}", { status: 400 }) : new Response(BYTES) }, async calls => {
    assert.equal((await get(ID)).status, 404);
    refuse = false;
    assert.equal((await get(ID)).status, 200);
    assert.equal(calls.filter(c => c.path === "/rest/v1/rpc/my_household_id").length, 2);
  });
});

test("no household, or a token the database refuses, is told to sign in, nothing is read, and nothing is remembered", async () => {
  const cases = [
    { household: null },
    { rpc: () => new Response(JSON.stringify({ message: "JWT expired" }), { status: 401 }) },
  ];
  for (const opts of cases) {
    await withStub(opts, async calls => {
      for (let n = 1; n <= 2; n++) {
        const r = await get(ID);
        assert.equal(r.status, 401);
        assert.match(await r.text(), /sign in/i);
        assert.equal(r.headers.get("cache-control"), "no-store");
        assert.equal(calls.filter(c => c.path === "/rest/v1/rpc/my_household_id").length, n, "asked again each time");
      }
      assert.equal(reads(calls).length, 0, "nothing is read");
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

test("an answer from my_household_id that is not a household id reads nothing", async () => {
  for (const household of ["../" + HID, `${HID}/x`, "", 42, { id: HID }, [HID]]) {
    await withStub({ household }, async calls => {
      const r = await get(ID);
      assert.notEqual(r.status, 200, `answer ${JSON.stringify(household)}`);
      assert.equal(reads(calls).length, 0, `answer ${JSON.stringify(household)}`);
    });
  }
});

test("a refused read gives 404, and Storage or the database unreachable gives 502, none of them kept", async () => {
  for (const status of [400, 401, 403, 404, 429, 500, 503]) {
    await withStub({ read: () => new Response(JSON.stringify({ error: "not found" }), { status }) }, async () => {
      const r = await get(ID);
      assert.equal(r.status, 404, `read answered ${status}`);
      assert.equal(r.headers.get("cache-control"), "no-store");
    });
  }
  await withStub({ read: () => Promise.reject(new TypeError("fetch failed")) }, async () => {
    const r = await get(ID);
    assert.equal(r.status, 502);
    assert.equal(r.headers.get("cache-control"), "no-store");
  });
  await withStub({ rpc: () => Promise.reject(new TypeError("fetch failed")) }, async calls => {
    assert.equal((await get(ID)).status, 502);
    assert.equal(reads(calls).length, 0);
  });
  await withStub({ rpc: () => new Response("oops", { status: 500 }) }, async calls => {
    assert.equal((await get(ID)).status, 502);
    assert.equal(reads(calls).length, 0);
  });
  await withStub({ read: () => new Response(null, { status: 200 }) }, async () => {
    assert.equal((await get(ID)).status, 502, "a read with no bytes");
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

test("neither a query parameter nor a header can change the folder it reads", () =>
  withStub({}, async calls => {
    const r = await get(ID, {
      query: `&household_id=${OTHER}&household=${OTHER}&folder=${OTHER}&id=${OTHER}/${ID}&path=${OTHER}/${ID}`,
      headers: {
        "x-household-id": OTHER, "x-household": OTHER, "x-folder": OTHER,
        "x-forwarded-prefix": `/${OTHER}`, "x-original-url": `/_blob/${OTHER}/${ID}`,
      },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(reads(calls).map(c => c.path), [`${READ}photos/${HID}/${ID}`]);
    for (const c of calls) {
      assert.equal(c.search, "", "nothing from the request rides along in a query");
      assert.ok(!JSON.stringify(c.init).includes(OTHER), "nothing from the request rides along in headers or body");
    }
  }));
