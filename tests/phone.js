// Layout at phone width needs a real browser. Headless Chrome won't make a window narrower than 500px,
// so each household runs in a 390px-wide iframe (its own viewport, so the page's media queries see 390),
// and the page reports what it measured into the DOM that --dump-dom prints. Tests skip when there's no Chrome.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { wrap } = require("../tools/page.js");

const chrome = process.env.CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(f => fs.existsSync(f));
const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// Runs `measure` inside the page for each fixture, at 390px wide, and returns a Map of fixture to what it returned.
function atPhoneWidth(fixtures, measure) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-phone-"));
  try {
    const attr = s => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const frames = fixtures.map(f => `<iframe data-f="${attr(f)}" style="width:390px;height:844px;border:0" srcdoc="${attr(wrap(undefined, f))}"></iframe>`).join("");
    const probe = `<script>onload = () => setTimeout(() => { document.body.dataset.out = JSON.stringify([...document.querySelectorAll("iframe")].map(fr => [fr.dataset.f, fr.contentWindow.eval("(" + ${JSON.stringify(String(measure))} + ")()")])); }, 1000);</script>`;
    fs.writeFileSync(path.join(dir, "probe.html"), `<!doctype html><body>${frames}${probe}</body>`);
    const out = execFileSync(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${path.join(dir, "profile")}`,
      "--virtual-time-budget=5000", "--dump-dom", `file://${path.join(dir, "probe.html")}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 });
    const m = out.match(/<body data-out="([^"]*)"/);
    assert.ok(m, "the page reported nothing");
    return new Map(JSON.parse(unesc(m[1])));
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
}

module.exports = { chrome, atPhoneWidth };
