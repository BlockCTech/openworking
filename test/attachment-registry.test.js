const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { AttachmentRegistry } = require("../src/attachment-registry")

test("attachment registry returns opaque metadata and resolves trusted file parts", () => {
  let nextId = 0
  const registry = new AttachmentRegistry({ createId: () => `attachment_${++nextId}` })
  const filePath = path.join("/tmp", "outside-project", "report.pdf")

  assert.deepEqual(registry.add([filePath]), [{
    id: "attachment_1",
    filename: "report.pdf",
    mime: "application/pdf"
  }])
  assert.deepEqual(registry.resolve(["attachment_1"]), [{
    type: "file",
    url: "file:///tmp/outside-project/report.pdf",
    filename: "report.pdf",
    mime: "application/pdf"
  }])
})

test("attachment registry deduplicates pending files and falls back for unknown mime types", () => {
  let nextId = 0
  const registry = new AttachmentRegistry({ createId: () => `attachment_${++nextId}` })
  const filePath = path.join("/tmp", "outside-project", "archive.unknown-extension")

  assert.deepEqual(registry.add([filePath, filePath]), [
    { id: "attachment_1", filename: "archive.unknown-extension", mime: "application/octet-stream" },
    { id: "attachment_1", filename: "archive.unknown-extension", mime: "application/octet-stream" }
  ])
  assert.equal(registry.resolve(["attachment_1", "attachment_1"]).length, 1)
})

test("attachment registry discards consumed tokens", () => {
  const registry = new AttachmentRegistry({ createId: () => "attachment_1" })
  registry.add(["/tmp/note.txt"])
  registry.discard(["attachment_1"])

  assert.throws(
    () => registry.resolve(["attachment_1"]),
    /Attachment is no longer available/
  )
})
