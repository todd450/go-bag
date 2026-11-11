// tools/live-commit.js, which the ship skill runs after a merge to tell which commit Vercel serves.
// CI checks out one commit, so the history tests use a small git repo of their own.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { unwrap, readLive, liveCommit } = require("../tools/live-commit");
const { build } = require("../tools/build-web");

const ROOT = path.join(__dirname, "..");
const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", CONTACT_EMAIL: "hello@example.com" };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-live-"));
const g = (cwd, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();

// Three commits, like main around #95: the page and both scripts, then a runtime-only change, then docs.
function history() {
  const dir = tmp();
  g(dir, "init", "-q");
  const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  const commit = m => { g(dir, "add", "-A"); g(dir, "commit", "-qm", m); return g(dir, "rev-parse", "HEAD"); };
  put("emergency-kit-audit.html", "<p>page one</p>\n"); put("web/runtime.js", "// runtime one\n"); put("web/signin.js", "// signin\n");
  const c1 = commit("page and scripts");
  put("web/runtime.js", "// runtime two\n");
  const c2 = commit("runtime only");
  put("docs/notes.md", "notes\n");
  const c3 = commit("docs only");
  const live = (page, runtime) => ({ page: Buffer.from(page), "runtime.js": Buffer.from(runtime), "signin.js": Buffer.from("// signin\n") });
  return { dir, c1, c2, c3, live };
}

test("a merge that only changed the runtime is the live commit, not the page's older one", () => {
  const { dir, c2, live } = history();
  assert.deepStrictEqual(liveCommit(live("<p>page one</p>\n", "// runtime two\n"), "HEAD", dir), { commit: c2 });
});

test("a merge that changed neither the page nor the scripts leaves the commit before it as live", () => {
  const { dir, c1, c2, c3, live } = history();
  const found = liveCommit(live("<p>page one</p>\n", "// runtime two\n"), "HEAD", dir).commit;
  assert.notStrictEqual(found, c3);
  assert.strictEqual(found, c2);
  assert.deepStrictEqual(liveCommit(live("<p>page one</p>\n", "// runtime one\n"), "HEAD", dir), { commit: c1 }, "production behind main");
});

// After #113 the page loads core.js too: a merge that only changes the core must still be found.
test("a merge that only changed core.js is the live commit, not the page's older one", () => {
  const { dir, c3 } = history();
  const put = (f, s) => fs.writeFileSync(path.join(dir, f), s);
  const commit = m => { g(dir, "add", "-A"); g(dir, "commit", "-qm", m); return g(dir, "rev-parse", "HEAD"); };
  put("core.js", "// core one\n");
  const c4 = commit("core split out");
  put("core.js", "// core two\n");
  const c5 = commit("core only");
  const live = core => ({ page: Buffer.from("<p>page one</p>\n"), "runtime.js": Buffer.from("// runtime two\n"), "signin.js": Buffer.from("// signin\n"), "core.js": Buffer.from(core) });
  assert.deepStrictEqual(liveCommit(live("// core two\n"), "HEAD", dir), { commit: c5 });
  assert.deepStrictEqual(liveCommit(live("// core one\n"), "HEAD", dir), { commit: c4 }, "production behind main");
  const r = liveCommit(live("// core three\n"), "HEAD", dir);
  assert.strictEqual(r.commit, null);
  assert.strictEqual(r.files["core.js"], null, "the core matches no commit");
  assert.notStrictEqual(r.files.page, undefined);
  assert.ok(c3);
});

test("when nothing matches, it says which file matches no commit", () => {
  const { dir, c2, live } = history();
  const r = liveCommit(live("<p>page one</p>\n", "// runtime three\n"), "HEAD", dir);
  assert.strictEqual(r.commit, null);
  assert.strictEqual(r.files["runtime.js"], null);
  assert.strictEqual(r.files.page, c2, "the newest commit with that page");
});

test("a built dist/ gives back the page and both scripts byte for byte", async () => {
  const out = path.join(tmp(), "dist"), stub = path.join(tmp(), "stub-supabase.js");
  fs.writeFileSync(stub, "window.supabase = {};");
  build(out, env, stub);
  const live = await readLive(out);
  assert.ok(live.page.equals(fs.readFileSync(path.join(ROOT, "emergency-kit-audit.html"))));
  assert.ok(live["runtime.js"].equals(fs.readFileSync(path.join(ROOT, "web/runtime.js"))));
  assert.ok(live["signin.js"].equals(fs.readFileSync(path.join(ROOT, "web/signin.js"))));
  assert.ok(live["core.js"].equals(fs.readFileSync(path.join(ROOT, "core.js"))));
});

test("from a URL it fetches /app and the scripts it names, with their ?v= stamps", async t => {
  const out = path.join(tmp(), "dist"), stub = path.join(tmp(), "stub-supabase.js");
  fs.writeFileSync(stub, "window.supabase = {};");
  build(out, env, stub);
  const asked = [];
  const server = http.createServer((req, res) => {
    asked.push(req.url);
    const u = new URL(req.url, "http://x");
    const f = u.pathname === "/app" ? "app/index.html" : u.pathname === "/" ? "index.html" : u.pathname.slice(1);
    if (!fs.existsSync(path.join(out, f))) { res.writeHead(404); res.end(); return; }
    res.end(fs.readFileSync(path.join(out, f)));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const live = await readLive(base + "/app");
  assert.ok(live.page.equals(fs.readFileSync(path.join(ROOT, "emergency-kit-audit.html"))));
  assert.ok(live["runtime.js"].equals(fs.readFileSync(path.join(ROOT, "web/runtime.js"))));
  assert.ok(live["core.js"].equals(fs.readFileSync(path.join(ROOT, "core.js"))));
  for (const name of ["runtime", "signin", "core"]) assert.ok(asked.some(u => new RegExp(`^/${name}\\.js\\?v=[0-9a-f]{10}$`).test(u)), asked.join(" "));
  await assert.rejects(readLive(base + "/"), /landing is at \//, "the landing is refused with a pointer to /app");
  await assert.rejects(readLive(base + "/nope"), /404/);
});

test("a saved copy of /app is read too, page only", () => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><script src="/runtime.js?v=abc"></script></head><body><p>hi</p></body></html>\n`;
  const { page, scripts } = unwrap(html);
  assert.strictEqual(page, "<p>hi</p>");
  assert.deepStrictEqual(scripts, { "runtime.js": "/runtime.js?v=abc" });
});
