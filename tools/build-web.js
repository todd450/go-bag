#!/usr/bin/env node
// Builds the Vercel site into dist/ (issue #48): the page wrapped the way tools/page.js wraps it for
// previews, plus supabase-js and web/runtime.js, which stand in for claude.ai's window.claude.
// The page itself is copied byte for byte. Vercel runs this as `npm run build`.
//   SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... node tools/build-web.js [outDir]
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { wrap, ROOT } = require("./page");

// `supabaseJs` is the browser build of supabase-js; tests pass a stand-in, so they need no install.
function build(out = path.join(ROOT, "dist"), env = process.env, supabaseJs = require.resolve("@supabase/supabase-js/dist/umd/supabase.js", { paths: [ROOT] })) {
  const supabaseUrl = env.SUPABASE_URL, supabaseKey = env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error("build-web: set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (locally: doppler run -- npm run build)");

  const files = {
    "supabase.js": fs.readFileSync(supabaseJs),
    "runtime.js": fs.readFileSync(path.join(ROOT, "web", "runtime.js")),
  };
  // Content hashes in the URLs, so a new deploy is never served an old cached script.
  const v = name => crypto.createHash("sha256").update(files[name]).digest("hex").slice(0, 10);
  const js = s => s.replace(/</g, "\\u003c");
  const head =
    `<script>window.GO_BAG_CONFIG = ${js(JSON.stringify({ supabaseUrl, supabaseKey }))};</script>` +
    `<script src="/supabase.js?v=${v("supabase.js")}"></script>` +
    `<script src="/runtime.js?v=${v("runtime.js")}"></script>`;

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(out, name), buf);
  fs.writeFileSync(path.join(out, "index.html"), wrap(undefined, undefined, head));
  return out;
}

if (require.main === module) {
  try { console.log("build-web: wrote " + build(process.argv[2] ? path.resolve(process.argv[2]) : undefined)); }
  catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { build };
