#!/usr/bin/env node
// Prints the page wrapped the way claude.ai wraps it (doctype, charset, viewport), with core.js
// ahead of it, for preview.sh and screenshots.js. With a fixture (named like tests/household or fixtures/empty-and-one/one-person),
// it also loads tools/fixture-db.js, so the page starts with that made-up household in it.
//   node tools/page.js [page.html, default the repo's] [fixture]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

const js = s => s.replace(/<\/(script)/gi, "<\\/$1"); // keep "</script>" inside data or code from closing the tag

// The core's script tag (issue #113): the page's script needs core.js to have run first. Previews and
// screenshots carry it inline, so their one file works anywhere; tools/build-web.js passes its own tag, which
// serves /core.js as a file. A page from before the split carries its core inline and gets "".
const coreTag = (file = path.join(ROOT, "core.js")) => `<script>${js(fs.readFileSync(file, "utf8"))}</script>`;

// `extraHead` is added to <head> as is: tools/build-web.js uses it for the Vercel runtime's scripts.
function wrap(page = path.join(ROOT, "emergency-kit-audit.html"), fixture, extraHead = "", core = coreTag()) {
  let head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + extraHead + core;
  if (fixture) {
    const data = fs.readFileSync(path.join(ROOT, fixture + ".json"), "utf8");
    head += `<script>window.GO_BAG_FIXTURE = ${js(JSON.stringify(JSON.parse(data)))};</script>`;
    head += `<script>${js(fs.readFileSync(path.join(__dirname, "fixture-db.js"), "utf8"))}</script>`;
  }
  return `<!doctype html><html><head>${head}</head><body>${fs.readFileSync(page, "utf8")}</body></html>\n`;
}

if (require.main === module) process.stdout.write(wrap(process.argv[2] || undefined, process.argv[3]));
module.exports = { wrap, coreTag, ROOT };
