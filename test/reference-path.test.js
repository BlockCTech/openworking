const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { assertReferencePath, buildReferenceEntry } = require("../src/reference-path")

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-reference-path-"))
  fs.mkdirSync(path.join(root, "docs"))
  fs.writeFileSync(path.join(root, "docs", "notes.md"), "notes")
  return root
}

test("assertReferencePath accepts a file inside the project", () => {
  const root = makeProject()
  const resolved = assertReferencePath(root, path.join(root, "docs", "notes.md"))
  assert.equal(resolved, fs.realpathSync(path.join(root, "docs", "notes.md")))
})

test("assertReferencePath accepts a directory inside the project (unlike assertProjectFile)", () => {
  const root = makeProject()
  const resolved = assertReferencePath(root, path.join(root, "docs"))
  assert.equal(resolved, fs.realpathSync(path.join(root, "docs")))
})

test("assertReferencePath accepts the project root itself", () => {
  const root = makeProject()
  const resolved = assertReferencePath(root, root)
  assert.equal(resolved, fs.realpathSync(root))
})

test("assertReferencePath rejects a path outside the project", () => {
  const root = makeProject()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-reference-path-outside-"))
  assert.throws(() => assertReferencePath(root, outside), /outside the current project/)
})

test("assertReferencePath rejects a symlink that escapes the project boundary", () => {
  const root = makeProject()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-reference-path-outside-"))
  fs.writeFileSync(path.join(outside, "secret.txt"), "top secret")
  const link = path.join(root, "escape-link")
  fs.symlinkSync(path.join(outside, "secret.txt"), link)
  assert.throws(() => assertReferencePath(root, link), /outside the current project/)
})

test("assertReferencePath rejects a path that does not exist", () => {
  const root = makeProject()
  assert.throws(() => assertReferencePath(root, path.join(root, "missing.txt")), /does not exist/)
})

test("assertReferencePath resolves a relative path against the project root", () => {
  const root = makeProject()
  const resolved = assertReferencePath(root, "docs/notes.md")
  assert.equal(resolved, fs.realpathSync(path.join(root, "docs", "notes.md")))
})

test("buildReferenceEntry builds a local entry with the realpath-resolved path", () => {
  const root = makeProject()
  const entry = buildReferenceEntry(root, { path: "docs/notes.md", description: "project notes" })
  assert.deepEqual(entry, { path: fs.realpathSync(path.join(root, "docs", "notes.md")), description: "project notes" })
})

test("buildReferenceEntry builds a git entry with branch/description/hidden", () => {
  const entry = buildReferenceEntry("/unused", {
    repository: "https://example.com/repo.git",
    branch: "main",
    description: "upstream",
    hidden: true
  })
  assert.deepEqual(entry, { repository: "https://example.com/repo.git", branch: "main", description: "upstream", hidden: true })
})

test("buildReferenceEntry rejects an empty repository", () => {
  assert.throws(() => buildReferenceEntry("/unused", { repository: "  " }), /Repository is required/)
})

test("buildReferenceEntry rejects a payload with neither path nor repository", () => {
  assert.throws(() => buildReferenceEntry("/unused", { description: "no source" }), /needs either a local path or a git repository/)
})

test("buildReferenceEntry rejects a local path outside the project before any config write would happen", () => {
  const root = makeProject()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-reference-path-outside-"))
  // The exact scenario the References IPC handler depends on: a path escaping the project throws
  // synchronously here, so main.js's addReferenceEntry() call (which comes after this in the
  // handler) is never reached — proven by this call never returning an entry to write.
  assert.throws(() => buildReferenceEntry(root, { path: outside }), /outside the current project/)
})
