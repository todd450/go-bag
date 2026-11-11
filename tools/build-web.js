#!/usr/bin/env node
// Builds the Vercel site into dist/ (issues #48 and #78): the landing at / (tools/landing.js), and at
// /app the page wrapped the way tools/page.js wraps it for previews, plus supabase-js, web/signin.js
// and web/runtime.js, which stand in for claude.ai's window.claude, and core.js, which the page's script
// needs to have run first (#113). The page itself is copied byte
// for byte. Vercel runs this as `npm run build`.
//   SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... [CONTACT_EMAIL=...] [SENDER_EMAIL=...] node tools/build-web.js [outDir]
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { wrap, ROOT } = require("./page");
const landing = require("./landing");

// `supabaseJs` is the browser build of supabase-js; tests pass a stand-in, so they need no install.
function build(out = path.join(ROOT, "dist"), env = process.env, supabaseJs = require.resolve("@supabase/supabase-js/dist/umd/supabase.js", { paths: [ROOT] })) {
  const supabaseUrl = env.SUPABASE_URL, supabaseKey = env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("build-web: set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (locally: doppler run -- npm run build)");
  const contactEmail = env.CONTACT_EMAIL || "";
  if (!contactEmail.trim()) console.warn("build-web: CONTACT_EMAIL is not set; the landing's privacy line has no deletion address. Set it before opening.");
  const config = { supabaseUrl, supabaseKey };
  if (env.SENDER_EMAIL) config.senderEmail = env.SENDER_EMAIL;

  const files = {
    "supabase.js": fs.readFileSync(supabaseJs),
    "signin.js": fs.readFileSync(path.join(ROOT, "web", "signin.js")),
    "runtime.js": fs.readFileSync(path.join(ROOT, "web", "runtime.js")),
    "core.js": fs.readFileSync(path.join(ROOT, "core.js")),
  };
  // Content hashes in the URLs, so a new deploy is never served an old cached script.
  const v = name => crypto.createHash("sha256").update(files[name]).digest("hex").slice(0, 10);
  const tag = name => `<script src="/${name}?v=${v(name)}"></script>`;
  const js = s => s.replace(/</g, "\\u003c");
  const head =
    `<script>window.GO_BAG_CONFIG = ${js(JSON.stringify(config))};</script>` +
    ["supabase.js", "signin.js", "runtime.js"].map(tag).join("");
  files["index.html"] = landing.render({ contactEmail });
  // The core is served as its own file, after the runtime (issue #113), where previews carry it inline.
  files["app/index.html"] = wrap(undefined, undefined, head, tag("core.js"));

  fs.rmSync(out, { recursive: true, force: true });
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
    fs.writeFileSync(path.join(out, name), body);
  }
  return out;
}

if (require.main === module) {
  try { console.log("build-web: wrote " + build(process.argv[2] ? path.resolve(process.argv[2]) : undefined)); }
  catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { build };
