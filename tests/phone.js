// Layout at phone width needs a real browser. Headless Chrome won't make a window narrower than 500px,
// so each household runs in a 390px-wide iframe (its own viewport, so the page's media queries see 390),
// and the page reports what it measured into the DOM that --dump-dom prints. Tests skip when there's no Chrome.
// Each page draws classic scrollbars, 15px wide, as Linux Chrome (CI's) and Windows do: a Mac's overlay scrollbars take
// no width, so a layout a scrollbar squeezes would pass on a Mac and fail in CI.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { wrap } = require("../tools/page.js");

const chrome = process.env.CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(f => fs.existsSync(f));
const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

const CLASSIC = "<style>::-webkit-scrollbar { width: 15px; height: 15px; background: #ddd; }</style>";

// Loads `url` in a headless Chrome of its own and returns the page as it stands once it has settled (--dump-dom).
// `dir` is the caller's scratch folder; `flags` go ahead of the address. A Chrome killed from outside before it
// answers (seen on a laptop whose main checkout ran the checks while another run had Chrome up: SIGKILL within
// milliseconds, nothing printed) is started again, three starts at most, each with a profile of its own, since a
// killed Chrome leaves its profile locked. A Chrome that runs out its time, or exits with an error, is a failure.
function dumpDom(url, dir, { flags = [], budget = 5000, timeout = 60000, starts = 3, bin = chrome } = {}) {
  for (let n = 1; ; n++) {
    try {
      return execFileSync(bin, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${path.join(dir, "profile-" + n)}`, ...flags,
        `--virtual-time-budget=${budget}`, "--dump-dom", url], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout, maxBuffer: 1e8 });
    } catch (e) {
      const killed = e.signal && e.code !== "ETIMEDOUT";
      if (!killed || n >= starts) { if (killed) e.message = `Chrome was killed (${e.signal}) in each of ${n} starts: ${e.message}`; throw e; }
    }
  }
}

// (The dump holds every frame's copy of the page, so dumpDom reads it with a buffer far past execFileSync's 1 MB.)
// Runs `measure` inside the page for each fixture, at 390px wide, and returns a Map of fixture to what it returned.
function atPhoneWidth(fixtures, measure) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-phone-"));
  try {
    const attr = s => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const frames = fixtures.map(f => `<iframe data-f="${attr(f)}" style="width:390px;height:844px;border:0" srcdoc="${attr(wrap(undefined, f) + CLASSIC)}"></iframe>`).join("");
    const probe = `<script>onload = () => setTimeout(() => { document.body.dataset.out = JSON.stringify([...document.querySelectorAll("iframe")].map(fr => [fr.dataset.f, fr.contentWindow.eval("(" + ${JSON.stringify(String(measure))} + ")()")])); }, 1000);</script>`;
    fs.writeFileSync(path.join(dir, "probe.html"), `<!doctype html><body>${frames}${probe}</body>`);
    const out = dumpDom(`file://${path.join(dir, "probe.html")}`, dir);
    const m = out.match(/<body data-out="([^"]*)"/);
    assert.ok(m, "the page reported nothing");
    return new Map(JSON.parse(unesc(m[1])));
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
}

module.exports = { chrome, atPhoneWidth, dumpDom, CLASSIC };
