#!/usr/bin/env node
// Which commit is live on Vercel? Reads production's /app (or a built dist/ folder, or a saved copy of
// /app), takes the page back out of the wrapper tools/build-web.js puts around it, fetches the
// runtime.js, signin.js and core.js it loads, and prints the newest commit on <ref> whose page and those
// scripts all match what is served, byte for byte. A merge that only changes web/runtime.js (such as
// #95) or core.js (#113) is found too, which matching the page alone would miss. The landing at / is not checked.
// Exits 0 with the commit, 1 when no commit matches (saying which file doesn't), 2 when it can't read
// the site.
//   node tools/live-commit.js [url, dist/ folder or saved app page; default https://go-bag.vercel.app/app] [ref, default origin/main]
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROD = "https://go-bag.vercel.app/app";
// What is served, and the file in the repo it is built from, byte for byte.
const FILES = { page: "emergency-kit-audit.html", "runtime.js": "web/runtime.js", "signin.js": "web/signin.js", "core.js": "core.js" };
const OPEN = "</head><body>", CLOSE = "</body></html>";

// The page out of tools/page.js's wrapper, and the paths of the scripts the wrapper loads.
function unwrap(html) {
  const open = html.indexOf(OPEN), close = html.lastIndexOf(CLOSE);
  if (!html.startsWith("<!doctype html><html><head>") || open < 0 || close < open)
    throw new Error("that isn't the app page built by tools/build-web.js (the landing is at /, the app at /app)");
  const scripts = {};
  for (const m of html.slice(0, open).matchAll(/<script src="(\/(runtime|signin|core)\.js[^"]*)"><\/script>/g)) scripts[m[2] + ".js"] = m[1];
  return { page: html.slice(open + OPEN.length, close), scripts };
}

// The served files as Buffers, keyed like FILES. A saved page alone has no scripts to compare.
async function readLive(src = PROD) {
  if (/^https?:\/\//.test(src)) {
    const get = async url => {
      const r = await fetch(url, { cache: "no-store", headers: { "cache-control": "no-cache" } });
      if (!r.ok) throw new Error(`couldn't fetch ${url}: ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    };
    const { page, scripts } = unwrap((await get(src)).toString("utf8"));
    const live = { page: Buffer.from(page) };
    for (const [name, p] of Object.entries(scripts)) live[name] = await get(new URL(p, src).href);
    return live;
  }
  const dir = fs.existsSync(src) && fs.statSync(src).isDirectory();
  const html = fs.readFileSync(dir ? path.join(src, "app", "index.html") : src, "utf8");
  const live = { page: Buffer.from(unwrap(html).page) };
  if (dir) for (const name of ["runtime.js", "signin.js", "core.js"]) live[name] = fs.readFileSync(path.join(src, name));
  return live;
}

const git = (cwd, args, input) => execFileSync("git", args, { cwd, input, encoding: "utf8", maxBuffer: 1e8 }).trim();
// null where the file didn't exist yet (web/ came with #48), without git's message about it.
const blobAt = (cwd, c, file) => {
  try { return execFileSync("git", ["rev-parse", "-q", "--verify", `${c}:${file}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return null; }
};

// { commit } for the newest commit on `ref` that changed one of the files and whose versions of them
// all match `live`; else { commit: null, files: { name: newest commit with that file as served, or null } }.
function liveCommit(live, ref = "origin/main", cwd = path.join(__dirname, "..")) {
  const names = Object.keys(live).filter(n => FILES[n]);
  const want = Object.fromEntries(names.map(n => [n, git(cwd, ["hash-object", "--stdin"], live[n])]));
  const commits = git(cwd, ["log", "--format=%H", ref, "--", ...names.map(n => FILES[n])]).split("\n").filter(Boolean);
  const files = Object.fromEntries(names.map(n => [n, null]));
  for (const c of commits) {
    const ok = names.filter(n => blobAt(cwd, c, FILES[n]) === want[n]);
    if (ok.length === names.length) return { commit: c };
    for (const n of ok) files[n] ??= c;
  }
  return { commit: null, files };
}

if (require.main === module) {
  const src = process.argv[2] || PROD, ref = process.argv[3] || "origin/main";
  readLive(src).then(live => {
    const { commit, files } = liveCommit(live, ref);
    if (commit) { console.log(commit); return; }
    console.error(`no commit on ${ref} matches what ${src} serves:`);
    for (const [n, c] of Object.entries(files)) console.error(`  ${n} (${FILES[n]}): ${c ? "matches " + c + ", but not alongside the others" : "matches no commit"}`);
    process.exit(1);
  }, e => { console.error(e.message); process.exit(2); });
}
module.exports = { unwrap, readLive, liveCommit, PROD };
