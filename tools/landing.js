#!/usr/bin/env node
// The public landing page at / (issue #77). web/landing.html is the page; render() fills in what it
// shares with the app, so nothing is written twice: the three :root token blocks are copied from
// emergency-kit-audit.html at render time, and the deletion address comes from the caller
// (the Vercel build passes CONTACT_EMAIL). It returns the whole page as a string.
//   node tools/landing.js [contactEmail] > index.html
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PAGE = path.join(ROOT, "emergency-kit-audit.html");
const TEMPLATE = path.join(ROOT, "web", "landing.html");

// A plain address: dot-separated words before the @, a domain of hyphenated labels with a letters-only
// ending. Nothing that needs escaping in HTML or means something in a mailto: link.
const WORD = "[A-Za-z0-9_+-]+", LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
const PLAIN = new RegExp(`^${WORD}(?:\\.${WORD})*@(?:${LABEL}\\.)+[A-Za-z]{2,}$`);

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The address as given, trimmed (an environment variable often ends in a newline), or "" for none.
function address(contactEmail) {
  if (contactEmail == null) return "";
  if (typeof contactEmail !== "string") throw new Error("landing: contactEmail must be a string");
  const a = contactEmail.trim();
  if (a && (a.length > 254 || !PLAIN.test(a))) throw new Error(`landing: contactEmail is not a plain email address: ${JSON.stringify(a)}`);
  return a;
}

// The top-level rules of a stylesheet, as [prelude, start, end] with end just past the closing brace.
// Comments and quoted strings are skipped, so a brace inside one never counts.
function rules(css) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") { const e = css.indexOf("*/", i + 2); i = e < 0 ? css.length : e + 1; if (!depth) start = i + 1; continue; }
    if (c === '"' || c === "'") { for (i++; i < css.length && css[i] !== c; i++) if (css[i] === "\\") i++; continue; }
    if (c === "{") { if (!depth) start = css.slice(start, i).search(/\S/) + start; depth++; }
    else if (c === "}") { depth--; if (!depth) { out.push([css.slice(start, css.indexOf("{", start)).trim(), start, i + 1]); start = i + 1; } }
    else if (c === ";" && !depth) start = i + 1;
  }
  return out;
}

// The page's design tokens: its light :root block, its prefers-color-scheme: dark block, and its
// [data-theme="dark"] block, byte for byte and in the page's order.
function tokens(page = fs.readFileSync(PAGE, "utf8")) {
  const m = page.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error("landing: the page has no <style>");
  const css = m[1];
  const blocks = rules(css).filter(([pre, s, e]) => /^:root(?![\w-])/.test(pre)
    || (/^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/.test(pre) && /^\{\s*:root(?![\w-])/.test(css.slice(css.indexOf("{", s), e))));
  const light = blocks.filter(([pre]) => pre === ":root"), sys = blocks.filter(([pre]) => pre.startsWith("@media")), dark = blocks.filter(([pre]) => /^:root\[data-theme="dark"\]$/.test(pre));
  if (light.length !== 1 || sys.length !== 1 || dark.length !== 1 || blocks.length !== 3)
    throw new Error("landing: expected the page's three :root blocks (light, prefers-color-scheme: dark, [data-theme=\"dark\"]); update tools/landing.js");
  return blocks.map(([, s, e]) => css.slice(s, e)).join("\n");
}

function fill(template, marker, value) {
  if (template.split(marker).length !== 2) throw new Error(`landing: web/landing.html must hold ${marker} exactly once`);
  return template.replace(marker, () => value);
}

function render({ contactEmail } = {}) {
  const a = address(contactEmail);
  let html = fs.readFileSync(TEMPLATE, "utf8");
  html = fill(html, "/*@tokens*/", tokens());
  html = fill(html, "<!--@delete-->", a ? ` To have everything deleted, email <a href="mailto:${esc(a)}">${esc(a)}</a>.` : "");
  return html;
}

if (require.main === module) {
  try { process.stdout.write(render({ contactEmail: process.argv[2] })); }
  catch (e) { console.error(e.message); process.exit(1); }
}
module.exports = { render, tokens };
