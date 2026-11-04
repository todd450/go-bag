const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

// The household form a new household starts with: no profile saved yet.
function freshDraft() {
  const { run, json } = load();
  run("S.profile = null; S.hhDirty = false; syncDraft();");
  return json("S.hhDraft");
}

test("clearing an example household leaves the same blank form a new household starts with", async () => {
  const { run, json } = load({ fixture: "tests/household" });
  run(`S.canWrite = true; S.profile = { ...S.profile, example: true }; S.hhDirty = true;`);
  await run("ACT.clearExamples()");
  assert.equal(run("S.profile"), null);
  assert.deepEqual(json("S.hhDraft"), freshDraft());
});

test("each blank form is its own copy, so editing one never leaks into the next", () => {
  const { run, json } = load();
  run(`S.profile = null; S.hhDirty = false; syncDraft();
       S.hhDraft.members.push({ label: "Ana", age: "adult", needs: "" }); S.hhDraft.vehicles = 2;
       S.hhDirty = false; syncDraft();`);
  assert.deepEqual(json("S.hhDraft"), freshDraft());
});
