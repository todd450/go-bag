#!/usr/bin/env node
// A preview of the sign-in card (web/signin.js, issue #76) for reviewers: writes <dir>/index.html,
// the page wrapped by tools/page.js with the card over it and a stand-in supabase-js client, so no
// link is ever really sent. Its signInWithOtp answers per the address's ?result:
//   ok (or none)  the link "went"      429  too many links      fail  the send failed
// The card's own parameters work too: ?start=new, ?error_code=otp_expired, #error=server_error.
// More for screenshots: ?email=<address> types it and sends, ?state=unavailable draws that card, and
// ?theme=dark|light sets the page's theme whatever the system's is.
//   d=$(mktemp -d) && node tools/signin-preview.js "$d" && python3 -m http.server 0 --bind 127.0.0.1 --directory "$d"
const fs = require("node:fs");
const path = require("node:path");
const { wrap, ROOT } = require("./page");

// The stand-in client, and what the preview does on load. Both run in the browser, from their
// source, so they use nothing from here.
function previewClient(search) {
  const result = new URLSearchParams(search).get("result") || "ok";
  const answers = {
    429: { status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" },
    fail: { status: 500, code: "unexpected_failure", message: "Error sending magic link email" },
  };
  return { auth: { signInWithOtp: async () => ({ data: {}, error: answers[result] || null }) } };
}

async function start(client) {
  const q = new URLSearchParams(location.search);
  if (["dark", "light"].includes(q.get("theme"))) document.documentElement.dataset.theme = q.get("theme");
  await window.goBagSignIn(client, q.get("state") === "unavailable" ? { state: "unavailable" } : undefined);
  if (q.get("email") === null) return;
  const card = document.querySelector(".gb-auth");
  card.querySelector("input").value = q.get("email");
  card.querySelector("form").requestSubmit();
}

function write(dir) {
  const js = s => s.replace(/<\/(script)/gi, "<\\/$1");
  const signin = fs.readFileSync(path.join(ROOT, "web", "signin.js"), "utf8");
  const head = `<script>${js(signin)}</script>`
    + `<script>(${js(String(start))})((${js(String(previewClient))})(location.search));</script>`;
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "index.html");
  fs.writeFileSync(out, wrap(undefined, undefined, head));
  return out;
}

if (require.main === module) {
  if (!process.argv[2]) { console.error("usage: node tools/signin-preview.js <dir>"); process.exit(1); }
  console.log("signin-preview: wrote " + write(path.resolve(process.argv[2])));
}
module.exports = { write, previewClient };
