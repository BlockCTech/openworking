const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const AdmZip = require("adm-zip")
const {
  MAX_ENTRY_BYTES,
  OVERSIZED_MARKER,
  zipAttachmentContext
} = require("../src/zip-attachment-context")

function tempPath(prefix, name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return path.join(directory, name)
}

function createZip(zipPath, entries) {
  const zip = new AdmZip()
  for (const entry of entries) zip.addFile(entry.name, Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body))
  zip.writeZip(zipPath)
}

function createDocxBuffer(text) {
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("word/document.xml", Buffer.from(`<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`))
  return zip.toBuffer()
}

test("zip attachment context writes one markdown file with supported text and ignored nested zip markers", () => {
  const archive = tempPath("openworking-zip-context-", "sample.zip")
  createZip(archive, [
    { name: "README.md", body: "# Hello\nThis is readable." },
    { name: "src/index.ts", body: "export const value = 1\n" },
    { name: "nested.zip", body: "fake nested zip body" },
    { name: "assets/logo.png", body: "\u0000\u0001\u0002" }
  ])

  const result = zipAttachmentContext({
    filePath: archive,
    filename: "sample.zip",
    mime: "application/zip"
  })

  assert.equal(path.extname(result.filePath), ".md")
  assert.equal(result.filename, "sample.extracted.md")
  assert.ok(result.cleanupPaths.includes(result.filePath))

  const markdown = fs.readFileSync(result.filePath, "utf8")
  assert.match(markdown, /^# Extracted from: sample\.zip/m)
  assert.match(markdown, /README\.md/)
  assert.match(markdown, /src\/index\.ts/)
  assert.match(markdown, /nested\.zip \(ignored nested zip\)/)
  assert.match(markdown, /assets\/logo\.png \(binary, listed only\)/)
  assert.match(markdown, /## Extracted content/)
})

test("zip attachment context prioritizes manifest files before other readable files", () => {
  const archive = tempPath("openworking-zip-priority-", "priority.zip")
  createZip(archive, [
    { name: "notes/random.txt", body: "random" },
    { name: "src/app.ts", body: "console.log('src')\n" },
    { name: "package.json", body: "{\"name\":\"demo\"}" }
  ])

  const result = zipAttachmentContext({
    filePath: archive,
    filename: "priority.zip",
    mime: "application/zip"
  })

  const markdown = fs.readFileSync(result.filePath, "utf8")
  assert.ok(markdown.indexOf("package.json") < markdown.indexOf("src/app.ts"))
  assert.ok(markdown.indexOf("package.json") < markdown.indexOf("notes/random.txt"))
})

test("zip attachment context truncates large archives with explicit markers", () => {
  const archive = tempPath("openworking-zip-budget-", "budget.zip")
  createZip(archive, [
    { name: "README.md", body: "x".repeat(9000) },
    { name: "src/huge.ts", body: "y".repeat(9000) }
  ])

  const result = zipAttachmentContext({
    filePath: archive,
    filename: "budget.zip",
    mime: "application/zip"
  })

  const markdown = fs.readFileSync(result.filePath, "utf8")
  assert.match(markdown, /\[Truncated: per-file limit reached\]/)
})

test("zip attachment context skips oversized readable entries before inflation and reports real entry totals", () => {
  const archive = tempPath("openworking-zip-oversized-", "oversized.zip")
  createZip(archive, [
    { name: "README.md", body: "small" },
    { name: "huge.txt", body: "x".repeat(MAX_ENTRY_BYTES + 1) }
  ])

  const result = zipAttachmentContext({
    filePath: archive,
    filename: "oversized.zip",
    mime: "application/zip"
  })

  const markdown = fs.readFileSync(result.filePath, "utf8")
  assert.match(markdown, /- Total entries: 2/)
  assert.match(markdown, /- Oversized entries skipped before extraction: 1/)
  assert.match(markdown, /huge\.txt/)
  assert.match(markdown, new RegExp(OVERSIZED_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
})

test("zip attachment context extracts docx entries through the office materialization path", () => {
  const archive = tempPath("openworking-zip-docx-", "office.zip")
  createZip(archive, [
    { name: "docs/spec.docx", body: createDocxBuffer("Hello from docx") }
  ])

  const result = zipAttachmentContext({
    filePath: archive,
    filename: "office.zip",
    mime: "application/zip"
  })

  const markdown = fs.readFileSync(result.filePath, "utf8")
  assert.match(markdown, /### docs\/spec\.docx/)
  assert.match(markdown, /## DOCX attachment: spec\.docx/)
  assert.match(markdown, /Hello from docx/)
  assert.doesNotMatch(markdown, /openworking-zip-/)
})
