const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { load, PAGE } = require("./load");
const { tabs } = require("../tools/screenshots");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-bag-tabs-"));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

// A copy of the page with its tab list edited, in a fresh scratch folder.
function pageWith(edit) {
  const file = fs.mkdtempSync(path.join(dir, "page-")) + "/page.html";
  const html = fs.readFileSync(PAGE, "utf8");
  const next = html.replace(/const VIEWS = (\[[^\]]*\]);/, (_, list) => `const VIEWS = ${JSON.stringify(edit(JSON.parse(list)))};`);
  assert.notEqual(next, html, "the page's VIEWS was not found");
  fs.writeFileSync(file, next);
  return file;
}

test("the screenshot tool shoots exactly the page's own tabs", () => {
  assert.deepEqual(tabs(PAGE, PAGE), load().json("VIEWS"));
});

test("a tab added to the page is shot without editing the tool", () => {
  const added = pageWith(v => [...v, "extra"]);
  assert.ok(tabs(PAGE, added).includes("extra"));
  assert.ok(tabs(added, PAGE).includes("extra"));
});

test("when the two versions list different tabs, every tab of either is shot once", () => {
  const renamed = pageWith(v => v.map(t => (t === "plan" ? "family-plan" : t)));
  const both = tabs(PAGE, renamed);
  for (const t of [...load().json("VIEWS"), "family-plan"]) assert.ok(both.includes(t), t);
  assert.equal(new Set(both).size, both.length);
});
