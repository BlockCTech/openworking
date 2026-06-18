const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { assertTranslationArtifact, assertProjectFile, assertProjectDirectory, listProjectDirectory, readProjectFileContent } = require("../src/artifact-path")

test("translation artifacts open when they match the translated document convention", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-artifacts-"))
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-artifact-source-"))
  const artifact = path.join(sourceDir, "manual-translated-vietnamese.pdf")
  const markdown = path.join(sourceDir, "manual-translated-vietnamese.md")
  const suffixed = path.join(sourceDir, "manual-translated-vietnamese-2.docx")
  const invalidName = path.join(sourceDir, "outside.pdf")
  const invalidExtension = path.join(sourceDir, "manual-translated-vietnamese.txt")
  fs.writeFileSync(artifact, "translated")
  fs.writeFileSync(markdown, "translated")
  fs.writeFileSync(suffixed, "translated")
  fs.writeFileSync(invalidName, "outside")
  fs.writeFileSync(invalidExtension, "outside")
  const directory = path.join(sourceDir, "deck-translated-vietnamese.pptx")
  fs.mkdirSync(directory)

  assert.equal(assertTranslationArtifact(project, artifact), fs.realpathSync(artifact))
  assert.equal(assertTranslationArtifact(project, markdown), fs.realpathSync(markdown))
  assert.equal(assertTranslationArtifact(project, suffixed), fs.realpathSync(suffixed))
  assert.throws(() => assertTranslationArtifact(project, invalidName), /not a translated document artifact/)
  assert.throws(() => assertTranslationArtifact(project, invalidExtension), /not a translated document artifact/)
  assert.throws(() => assertTranslationArtifact(project, directory), /not a file/)
  assert.throws(() => assertTranslationArtifact(project, path.join(sourceDir, "missing-translated-vietnamese.pdf")), /Artifact does not exist/)
})

test("in-place translated workbooks open when they live inside the project even without the -translated- suffix", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-inplace-"))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-inplace-out-"))
  const inProject = path.join(project, "QA sheet.xlsx")
  const outsideOriginal = path.join(outside, "QA sheet.xlsx")
  const wrongExt = path.join(project, "notes.txt")
  fs.writeFileSync(inProject, "workbook")
  fs.writeFileSync(outsideOriginal, "workbook")
  fs.writeFileSync(wrongExt, "text")

  // The overwritten original keeps its name; allowed because it is inside the project.
  assert.equal(assertTranslationArtifact(project, inProject), fs.realpathSync(inProject))
  // The same name outside the project is rejected (no -translated- suffix, not in project).
  assert.throws(() => assertTranslationArtifact(project, outsideOriginal), /not a translated document artifact/)
  // A non-office extension inside the project is still rejected.
  assert.throws(() => assertTranslationArtifact(project, wrongExt), /not a translated document artifact/)
  // Traversal out of the project via a relative path is rejected.
  assert.throws(() => assertTranslationArtifact(project, path.join(project, "..", path.basename(outside), "QA sheet.xlsx")), /not a translated document artifact/)
  // An inaccessible or missing project root should fail with the artifact gate's
  // intended error instead of leaking fs.realpathSync.
  assert.throws(() => assertTranslationArtifact(path.join(project, "missing-project"), inProject), /not a translated document artifact/)
})

test("project viewable files open only from inside the project tree", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-projfile-"))
  const docsDir = path.join(project, "docs")
  fs.mkdirSync(docsDir, { recursive: true })
  const markdown = path.join(docsDir, "spec.md")
  const code = path.join(docsDir, "app.ts")
  const dockerfile = path.join(docsDir, "Dockerfile")
  const gitignore = path.join(project, ".gitignore")
  fs.writeFileSync(markdown, "# Spec")
  fs.writeFileSync(code, "export const value = 1\n")
  fs.writeFileSync(dockerfile, "FROM node:22\n")
  fs.writeFileSync(gitignore, "node_modules\n")

  // File inside the project resolves to its realpath.
  assert.equal(assertProjectFile(project, markdown), fs.realpathSync(markdown))
  assert.equal(assertProjectFile(project, code), fs.realpathSync(code))
  assert.equal(assertProjectFile(project, path.join("docs", "app.ts")), fs.realpathSync(code))
  assert.equal(assertProjectFile(project, dockerfile), fs.realpathSync(dockerfile))
  assert.equal(assertProjectFile(project, ".gitignore"), fs.realpathSync(gitignore))

  // A path traversal outside the project is rejected.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-outside-"))
  const outsideMd = path.join(outside, "secret.md")
  fs.writeFileSync(outsideMd, "secret")
  assert.throws(() => assertProjectFile(project, outsideMd), /outside the current project/)
  assert.throws(() => assertProjectFile(project, path.join(project, "..", path.basename(outside), "secret.md")), /outside the current project/)

  // Directories and non-viewable files are rejected.
  assert.throws(() => assertProjectFile(project, docsDir), /not a file|common code/)
  const txt = path.join(docsDir, "notes.txt")
  const env = path.join(docsDir, ".env")
  fs.writeFileSync(txt, "notes")
  fs.writeFileSync(env, "SECRET=value")
  assert.throws(() => assertProjectFile(project, txt), /Only markdown and common code files/)
  assert.throws(() => assertProjectFile(project, env), /Only markdown and common code files/)

  // Missing files are rejected.
  assert.throws(() => assertProjectFile(project, path.join(docsDir, "missing.md")), /does not exist/)
})

test("project directories list children inside the project tree", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-projdir-"))
  fs.mkdirSync(path.join(project, "src"), { recursive: true })
  fs.mkdirSync(path.join(project, "node_modules"), { recursive: true })
  fs.mkdirSync(path.join(project, ".git"), { recursive: true })
  fs.mkdirSync(path.join(project, ".cache"), { recursive: true })
  fs.writeFileSync(path.join(project, "README.md"), "# Readme")
  fs.writeFileSync(path.join(project, "notes.txt"), "notes")
  fs.writeFileSync(path.join(project, "src", "app.js"), "console.log('ok')\n")
  fs.writeFileSync(path.join(project, "node_modules", "package.json"), "{}")

  assert.equal(assertProjectDirectory(project, "src").resolved, fs.realpathSync(path.join(project, "src")))

  const root = listProjectDirectory(project, "")
  assert.deepEqual(root.children.map((entry) => entry.name), ["src", "notes.txt", "README.md"])
  assert.deepEqual(root.children.map((entry) => entry.type), ["directory", "file", "file"])
  assert.equal(root.children.find((entry) => entry.name === "README.md").openable, true)
  assert.equal(root.children.find((entry) => entry.name === "notes.txt").openable, false)

  const src = listProjectDirectory(project, "src")
  assert.deepEqual(src.children, [
    { name: "app.js", path: path.join("src", "app.js"), type: "file", openable: true }
  ])
})

test("project directory listing rejects traversal outside the project", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-projdir-"))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-projdir-outside-"))

  assert.throws(() => assertProjectDirectory(project, outside), /outside the current project/)
  assert.throws(() => listProjectDirectory(project, path.join(project, "..", path.basename(outside))), /outside the current project/)
})

test("readProjectFileContent reads small files fully", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-read-"))
  const file = path.join(dir, "small.md")
  fs.writeFileSync(file, "# Hello\n\nWorld")
  const result = readProjectFileContent(file, 1024)
  assert.equal(result.content, "# Hello\n\nWorld")
  assert.equal(result.truncated, false)
})

test("readProjectFileContent truncates large files on a byte boundary", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-read-"))
  const file = path.join(dir, "big.md")
  fs.writeFileSync(file, "a".repeat(5000))
  const result = readProjectFileContent(file, 1000)
  assert.equal(result.truncated, true)
  assert.equal(Buffer.byteLength(result.content, "utf8"), 1000)
})

test("readProjectFileContent does not corrupt multibyte characters at the cut", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-read-"))
  const file = path.join(dir, "ja.md")
  // Each あ is 3 bytes in UTF-8. Truncate at a byte count that lands mid-character.
  fs.writeFileSync(file, "あ".repeat(1000))
  const result = readProjectFileContent(file, 1000) // 1000 % 3 !== 0 → splits a char
  assert.equal(result.truncated, true)
  // No replacement char (U+FFFD) and no NUL byte at the end.
  assert.ok(!result.content.includes("�"), "should not contain replacement char")
  assert.ok(!result.content.includes(" "), "should not contain NUL")
  // All emitted characters are complete あ.
  assert.match(result.content, /^あ+$/)
  assert.equal(result.content.length, 333) // floor(1000 / 3) complete characters
})
