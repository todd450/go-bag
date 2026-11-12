const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { load, PAGE, CORE, ROOT } = require("./load");
const { tabs } = require("../tools/screenshots");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-tabs-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// A copy of `file` changed by `edit`, in a fresh scratch folder with core.js beside it, as the page has it;
// it fails if the edit changed nothing.
function copyWith(file, edit) {
  const folder = fs.mkdtempSync(path.join(dir, "copy-")), out = path.join(folder, path.basename(file));
  fs.copyFileSync(CORE, path.join(folder, "core.js"));
  const text = fs.readFileSync(file, "utf8");
  const next = edit(text);
  assert.notEqual(next, text, `the edit found nothing to change in ${path.basename(file)}`);
  fs.writeFileSync(out, next);
  return out;
}

// A copy of the page with its tab list edited.
const pageWith = edit => copyWith(PAGE, html =>
  html.replace(/const VIEWS = (\[[^\]]*\]);/, (_, list) => `const VIEWS = ${JSON.stringify(edit(JSON.parse(list)))};`));

// A page whose boot lines read differently, and a loader that finds them, as when one version of the
// page moves its boot sequence and updates tests/load.js to match. The repo's loader can't read it.
const BOOT = "\nsyncDraft();\nrender();";
const MOVED = "\n/* boot */\nsyncDraft();\n\nrender();";
const movedPage = () => copyWith(PAGE, html => html.replace(BOOT, MOVED));
const movedLoader = () => copyWith(path.join(ROOT, "tests", "load.js"), js =>
  js.replace("/\\nsyncDraft\\(\\);\\nrender\\(\\);/", "/\\n\\/\\* boot \\*\\/\\nsyncDraft\\(\\);\\n\\nrender\\(\\);/"));

test("the screenshot tool shoots exactly the page's own tabs", () => {
  assert.deepEqual(tabs(PAGE, PAGE), load().json("VIEWS"));
});

test("a tab added to the page is shot without editing the tool", () => {
  const added = pageWith(v => [...v, "extra"]);
  assert.ok(tabs(PAGE, added).includes("extra"));
  assert.ok(tabs(added, PAGE).includes("extra"));
});

test("when the two versions list different tabs, every tab of either is shot once", () => {
  const renamed = pageWith(v => v.map(t => (t === "household" ? "home-and-plan" : t)));
  const both = tabs(PAGE, renamed);
  for (const t of [...load().json("VIEWS"), "home-and-plan"]) assert.ok(both.includes(t), t);
  assert.equal(new Set(both).size, both.length);
});

test("the base page's tabs are read with the base's own loader, not this change's", () => {
  const warnings = [];
  assert.deepEqual(tabs(movedPage(), PAGE, { baseLoader: movedLoader(), warn: w => warnings.push(w) }), load().json("VIEWS"));
  assert.deepEqual(warnings, []);
});

test("a change that moves the boot sequence and its loader still reads the base's tabs", () => {
  const warnings = [];
  const views = tabs(PAGE, movedPage(), { baseLoader: path.join(ROOT, "tests", "load.js"), loader: movedLoader(), warn: w => warnings.push(w) });
  assert.deepEqual(views, load().json("VIEWS"));
  assert.deepEqual(warnings, []);
});

test("a base no loader can read falls back to this change's tabs, with a warning", () => {
  const warnings = [];
  const added = pageWith(v => [...v, "extra"]);
  assert.deepEqual(tabs(movedPage(), added, { warn: w => warnings.push(w) }), [...load().json("VIEWS"), "extra"]);
  assert.equal(warnings.length, 1);
});

// A Chrome that starts and never answers once hung the whole check (PR 144): it is replaced, then given up on
test("a browser that never answers is started again, then fails the run instead of hanging it", async () => {
  const { openChrome } = require("../tools/screenshots");
  const fake = path.join(dir, "silent-chrome"), log = path.join(dir, "starts");
  fs.writeFileSync(fake, `#!/bin/sh\necho x >> "${log}"\nexec sleep 30\n`, { mode: 0o755 });
  const t0 = Date.now();
  await assert.rejects(openChrome(fake, { wait: 400, starts: 2 }), /didn't answer within 0\.4s in 2 starts/);
  assert.ok(Date.now() - t0 < 5000, "it gives up promptly");
  // The error's own count says both starts were made. The stand-in's log can't be held to exactly two: on a busy
  // machine a start is stopped before its shell has run, so it only shows the stand-in really was started.
  const ran = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").length : 0;
  assert.ok(ran <= 2, `started ${ran} times, never more than asked`);
});

// Starting Chrome is most of what a browser test waits for (issue #147), so one test file's pages share one Chrome.
// Each page still starts clean, as a new Chrome's would: its own storage and screen size, none of the last page's.
// Once the last page closes, Chrome exits, so the test file's process can end.
test("pages opened in turn share one Chrome, each starts clean, and Chrome exits after the last closes", { skip: !require("./phone").chrome && "no Chrome found (set CHROME)" }, async () => {
  const { openChrome } = require("../tools/screenshots");
  const { chrome } = require("./phone");
  const file = path.join(dir, "blank.html");
  fs.writeFileSync(file, "<!doctype html><title>blank</title>");
  // The page's width, and what it found stored before it stored something of its own
  const visit = async page => {
    const loaded = page.once("Page.loadEventFired");
    await page.send("Page.navigate", { url: `file://${file}` });
    await loaded;
    const ev = async e => (await page.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;
    return { width: await ev("innerWidth"), stored: await ev(`(() => { const v = localStorage.getItem("k"); localStorage.setItem("k", "set"); return v; })()`),
      databases: await ev(`(async () => { const n = (await indexedDB.databases()).length;
        await new Promise(ok => { const r = indexedDB.open("k"); r.onsuccess = () => { r.result.close(); ok(); }; }); return n; })()`) };
  };
  const first = await openChrome(chrome);
  try {
    await first.send("Emulation.setDeviceMetricsOverride", { width: 333, height: 600, deviceScaleFactor: 1, mobile: false });
    assert.deepEqual(await visit(first), { width: 333, stored: null, databases: 0 });
  } finally { await first.close(); }
  const second = await openChrome(chrome);
  try {
    assert.ok(Number.isInteger(first.pid), "a page knows its Chrome's process");
    assert.equal(second.pid, first.pid, "the second page opened in the same Chrome");
    const b = await visit(second);
    assert.notEqual(b.width, 333, "the last page's screen size didn't carry over");
    assert.equal(b.stored, null, "nor what it stored");
    assert.equal(b.databases, 0, "nor its databases");
  } finally { await second.close(); }
  const alive = () => { try { process.kill(first.pid, 0); return true; } catch (_) { return false; } };
  for (let i = 0; i < 100 && alive(); i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(alive(), false, "Chrome exits once no page is open");
});
