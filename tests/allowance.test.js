// The daily Claude allowance (issue #75): api/sample.mjs calls Claude only after the caller's
// household has claimed one call from today's allowance, and fails closed when it can't tell.
// fetch is stubbed and the Anthropic SDK is replaced by a stand-in, so nothing here touches the
// network or needs an install.
const test = require("node:test");
const assert = require("node:assert/strict");
const { register } = require("node:module");

// Sentinels: none of them may ever travel as the caller's credentials.
process.env.SUPABASE_URL = "https://db.example";
process.env.SUPABASE_PUBLISHABLE_KEY = "pk-publishable";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sk-service-role";
process.env.ANTHROPIC_API_KEY = "sk-ant-secret";

// The SDK is not installed in CI: point its import at a stand-in that reports each call to Claude.
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier !== "@anthropic-ai/sdk") return next(specifier, context);
    return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(
      "export default class Anthropic {" +
      "  constructor() { this.beta = { messages: { stream: (...a) => globalThis.claudeStandIn(...a) } }; }" +
      "}" +
      "Anthropic.RateLimitError = class extends Error {};" +
      "Anthropic.BadRequestError = class extends Error {};") };
  }`));

const TOKEN = "caller-access-token";
let calls; // every fetch, as { url, headers }
let claudeCalls;
let rpc; // name -> () => Response | Promise (thrown = network error)

globalThis.claudeStandIn = () => {
  claudeCalls++;
  const reply = { stop_reason: "end_turn", content: [{ type: "text", text: '{"ok":true}' }] };
  return {
    finalMessage: async () => reply,
    async *[Symbol.asyncIterator]() { yield { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } }; },
    abort() {},
  };
};
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)) });
  const name = String(url).split("/rpc/")[1];
  if (!rpc[name]) throw new Error("unexpected fetch " + url);
  return rpc[name]();
};
const ok = value => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
const member = () => ok(true);

test.beforeEach(() => { calls = []; claudeCalls = 0; rpc = { is_member: member, claim_claude_call: () => ok(true) }; });

// ---------- claimCall ----------
test("claimCall maps the database's answer to ok, over or error", async () => {
  const { claimCall } = await import("../api/_allowance.mjs");
  const cases = [
    [() => ok(true), "ok"],
    [() => ok(false), "over"],
    [() => new Response('{"code":"PGRST202"}', { status: 404 }), "error"], // migration not applied yet
    [() => new Response("{}", { status: 500 }), "error"],
    [() => new Response("{}", { status: 401 }), "error"],
    [() => { throw new TypeError("fetch failed"); }, "error"],
    [() => ok(null), "error"],
    [() => ok("true"), "error"],
    [() => new Response("not json", { status: 200 }), "error"],
  ];
  for (const [answer, want] of cases) {
    rpc.claim_claude_call = answer;
    assert.equal(await claimCall(TOKEN), want, `${answer} should be ${want}`);
  }
});

test("claimCall asks with the caller's own token and no other key", async () => {
  const { claimCall } = await import("../api/_allowance.mjs");
  await claimCall(TOKEN);
  assert.equal(calls.length, 1);
  const [{ url, headers }] = calls;
  assert.equal(url, "https://db.example/rest/v1/rpc/claim_claude_call");
  assert.equal(headers.authorization, `Bearer ${TOKEN}`);
  const sent = JSON.stringify(headers);
  for (const secret of ["sk-service-role", "sk-ant-secret"]) assert.ok(!sent.includes(secret), `never sends ${secret}`);
});

test("claimCall without a token claims nothing and fails closed", async () => {
  const { claimCall } = await import("../api/_allowance.mjs");
  assert.equal(await claimCall(""), "error");
  assert.equal(await claimCall(undefined), "error");
  assert.equal(calls.length, 0);
});

// ---------- api/sample.mjs: no Claude without a claimed call ----------
const post = async (body, token = TOKEN) => {
  const { POST } = await import("../api/sample.mjs");
  return POST(new Request("https://go-bag.example/api/sample", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
};
const claims = () => calls.filter(c => c.url.endsWith("/claim_claude_call")).length;
const GOOD = [
  { mode: "json", prompt: "List the hazards." },
  { mode: "text", prompt: "Review the plan." },
  { mode: "json", prompt: "What is in this photo?", images: [{ media_type: "image/jpeg", data: "AAAA" }] },
];

test("a household with a call left reaches Claude once, after one claim", async () => {
  for (const body of GOOD) {
    calls = []; claudeCalls = 0;
    const res = await post(body);
    await res.text();
    assert.equal(res.status, 200, body.mode);
    assert.equal(claims(), 1, "one claim per request");
    assert.equal(claudeCalls, 1, "one call to Claude");
  }
});

test("a household past its allowance gets rate_limited and Claude is never called", async () => {
  rpc.claim_claude_call = () => ok(false);
  for (const body of GOOD) {
    const res = await post(body);
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { code: "rate_limited" });
  }
  assert.equal(claudeCalls, 0);
});

test("when the allowance can't be checked, the answer is unavailable and Claude is never called", async () => {
  const failures = [
    () => new Response('{"code":"PGRST202"}', { status: 404 }),
    () => new Response("{}", { status: 500 }),
    () => { throw new TypeError("fetch failed"); },
    () => ok(null),
  ];
  for (const answer of failures) {
    rpc.claim_claude_call = answer;
    const res = await post(GOOD[0]);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { code: "unavailable" });
  }
  assert.equal(claudeCalls, 0);
});

test("a malformed request never uses the allowance", async () => {
  const bad = [
    "not json",
    {},
    { mode: "speak", prompt: "hi" },
    { mode: "json", prompt: "" },
    { mode: "json", prompt: "x".repeat(200_001) },
    { mode: "json", prompt: "hi", images: "nope" },
    { mode: "json", prompt: "hi", images: Array(5).fill({ media_type: "image/png", data: "AA" }) },
    { mode: "json", prompt: "hi", images: [{ media_type: "image/svg+xml", data: "AA" }] },
  ];
  for (const body of bad) {
    const res = await post(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal(claims(), 0);
  assert.equal(claudeCalls, 0);
});

test("someone who isn't a member never uses the allowance", async () => {
  rpc.is_member = () => ok(false);
  assert.equal((await post(GOOD[0])).status, 403);
  rpc.is_member = () => new Response("{}", { status: 401 });
  assert.equal((await post(GOOD[0])).status, 401);
  assert.equal(claims(), 0);
  assert.equal(claudeCalls, 0);
});
