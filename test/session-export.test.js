const test = require("node:test")
const assert = require("node:assert/strict")

const { saveSessionExport, serializeSessionExport, sessionExportFilename } = require("../src/session-export")

test("sessionExportFilename follows the upstream title, slug, id fallback", () => {
  assert.equal(sessionExportFilename({ id: "ses_123", title: "Clone PR in worktree from fork" }), "clone-pr-in-worktree-from-fork.json")
  assert.equal(sessionExportFilename({ id: "ses_123", slug: "my-session-slug" }), "my-session-slug.json")
  assert.equal(sessionExportFilename({ id: "ses_123" }), "ses_123.json")
  assert.equal(sessionExportFilename({ id: "ses_123", title: "!!!" }), "ses_123.json")
})

test("serializeSessionExport preserves the exact export shape and raw fields", () => {
  const data = {
    info: { id: "ses_1", title: "Raw session", summary: { additions: 4 } },
    messages: [{
      info: { id: "msg_1", sessionID: "ses_1", role: "assistant", providerID: "provider" },
      parts: [{ id: "part_1", messageID: "msg_1", type: "file", url: "file:///private/report.pdf" }]
    }]
  }
  assert.deepEqual(JSON.parse(serializeSessionExport(data)), data)
})

test("saveSessionExport returns canceled without writing", async () => {
  let writes = 0
  const result = await saveSessionExport({
    data: { info: { id: "ses_1" }, messages: [] },
    showSaveDialog: async (options) => {
      assert.equal(options.defaultPath, "ses_1.json")
      assert.deepEqual(options.filters, [{ name: "JSON", extensions: ["json"] }])
      return { canceled: true }
    },
    writeFile: async () => { writes += 1 }
  })
  assert.deepEqual(result, { canceled: true })
  assert.equal(writes, 0)
})

test("saveSessionExport writes formatted UTF-8 JSON and propagates write errors", async () => {
  const data = { info: { id: "ses_1", title: "Export me" }, messages: [] }
  let writeArgs
  const result = await saveSessionExport({
    data,
    showSaveDialog: async () => ({ canceled: false, filePath: "/tmp/export-me.json" }),
    writeFile: async (...args) => { writeArgs = args }
  })
  assert.deepEqual(result, { canceled: false })
  assert.deepEqual(writeArgs, ["/tmp/export-me.json", JSON.stringify(data, null, 2), "utf8"])

  await assert.rejects(
    saveSessionExport({
      data,
      showSaveDialog: async () => ({ canceled: false, filePath: "/tmp/export-me.json" }),
      writeFile: async () => { throw new Error("disk full") }
    }),
    /disk full/
  )
})
