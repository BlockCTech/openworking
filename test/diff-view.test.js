const test = require("node:test")
const assert = require("node:assert/strict")
const { parseUnifiedDiff } = require("../src/diff-view")

test("returns no rows for empty or non-string input", () => {
  assert.deepEqual(parseUnifiedDiff(""), [])
  assert.deepEqual(parseUnifiedDiff(null), [])
  assert.deepEqual(parseUnifiedDiff(undefined), [])
})

test("classifies add, del and context lines with running line numbers", () => {
  const diff = "@@ -1,3 +1,3 @@\n context-a\n-old line\n+new line\n context-b"
  const rows = parseUnifiedDiff(diff)
  assert.deepEqual(rows, [
    { type: "hunk", text: "@@ -1,3 +1,3 @@", oldStart: 1, newStart: 1 },
    { type: "context", text: "context-a", oldNo: 1, newNo: 1 },
    { type: "del", text: "old line", oldNo: 2 },
    { type: "add", text: "new line", newNo: 2 },
    { type: "context", text: "context-b", oldNo: 3, newNo: 3 }
  ])
})

test("tracks separate old/new positions across a multi-hunk diff", () => {
  const diff = [
    "@@ -1,2 +1,2 @@",
    " a",
    "-b",
    "+B",
    "@@ -10,2 +10,3 @@",
    " j",
    "+k",
    " l"
  ].join("\n")
  const rows = parseUnifiedDiff(diff)
  // Second hunk resets both counters to 10.
  const secondHunk = rows.find((row, i) => row.type === "hunk" && i > 0)
  assert.equal(secondHunk.oldStart, 10)
  assert.equal(secondHunk.newStart, 10)
  const added = rows.filter((row) => row.type === "add")
  // First hunk: context "a" is new line 1, so "+B" is new line 2.
  // Second hunk: context "j" is new line 10, so "+k" is new line 11.
  assert.deepEqual(added.map((row) => [row.text, row.newNo]), [["B", 2], ["k", 11]])
})

test("skips file headers and 'no newline' markers", () => {
  const diff = [
    "diff --git a/f.js b/f.js",
    "index 111..222 100644",
    "--- a/f.js",
    "+++ b/f.js",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "\\ No newline at end of file"
  ].join("\n")
  const rows = parseUnifiedDiff(diff)
  assert.deepEqual(rows.map((row) => row.type), ["hunk", "del", "add"])
})

test("handles a single-line hunk header without counts", () => {
  const rows = parseUnifiedDiff("@@ -1 +1 @@\n-a\n+b")
  assert.deepEqual(rows, [
    { type: "hunk", text: "@@ -1 +1 @@", oldStart: 1, newStart: 1 },
    { type: "del", text: "a", oldNo: 1 },
    { type: "add", text: "b", newNo: 1 }
  ])
})
