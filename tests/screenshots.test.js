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
