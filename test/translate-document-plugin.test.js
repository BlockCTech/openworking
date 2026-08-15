const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const translationRuntime = require("../resources/opencode/document-tools/runtime.cjs")

async function loadTool(filename) {
  const pluginPath = path.join(__dirname, "..", "resources", "opencode", "plugins", filename)
  const plugin = await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}-${Math.random()}`)
  let registered
  await plugin.default.setup({
    tool: {
      async transform(callback) {
        callback({ add(tool) { registered = tool } })
      }
    }
  })
  return registered
}

function schemaFor(tool) {
  return tool.input["~standard"].jsonSchema.input()
}

test("managed translation plugins expose non-overlapping direct schemas outside Code Mode", async () => {
  const documentTool = await loadTool("translate_document.mjs")
  const officeTool = await loadTool("translate_office_document.mjs")
  const documentSchema = schemaFor(documentTool)
  const officeSchema = schemaFor(officeTool)

  assert.equal(documentTool.name, "translate_document")
  assert.equal(officeTool.name, "translate_office_document")
  assert.deepEqual(documentTool.options, { codemode: false })
  assert.deepEqual(officeTool.options, { codemode: false })
  assert.deepEqual(Object.keys(documentSchema.properties), ["inputPath", "targetLanguage", "sourceLanguage"])
  assert.deepEqual(Object.keys(officeSchema.properties), ["inputPath", "targetLanguage", "sourceLanguage", "mode"])
  assert.deepEqual(documentSchema.required, ["inputPath", "targetLanguage"])
  assert.deepEqual(officeSchema.required, ["inputPath", "targetLanguage"])
  assert.equal(documentSchema.additionalProperties, false)
  assert.equal(officeSchema.additionalProperties, false)
})

test("managed schemas reject aliases, missing fields, crossed formats and PPTX mode before execution", async () => {
  const documentTool = await loadTool("translate_document.mjs")
  const officeTool = await loadTool("translate_office_document.mjs")
  const validateDocument = documentTool.input["~standard"].validate
  const validateOffice = officeTool.input["~standard"].validate

  const legacy = validateDocument({ path: "/tmp/source.md", targetLanguage: "Vietnamese" })
  assert.ok(legacy.issues.some((issue) => issue.path?.[0] === "inputPath"))
  assert.ok(legacy.issues.some((issue) => issue.path?.[0] === "path"))
  assert.ok(validateDocument({ inputPath: "/tmp/source.md" }).issues.some((issue) => issue.path?.[0] === "targetLanguage"))
  assert.ok(validateDocument({ inputPath: "/tmp/source.xlsx", targetLanguage: "Vietnamese" }).issues.some((issue) => issue.path?.[0] === "inputPath"))
  assert.ok(validateOffice({ inputPath: "/tmp/source.docx", targetLanguage: "Vietnamese" }).issues.some((issue) => issue.path?.[0] === "inputPath"))
  assert.ok(validateOffice({ inputPath: "/tmp/source.pptx", targetLanguage: "Vietnamese", mode: "newfile" }).issues.some((issue) => issue.path?.[0] === "mode"))
})

test("document executor preserves translated artifact metadata", async () => {
  const tool = await loadTool("translate_document.mjs")
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-plugin-"))
  const inputPath = path.join(temp, "source.md")
  fs.writeFileSync(inputPath, "```text\nno translatable segments\n```\n")

  const result = await tool.execute({ inputPath, targetLanguage: "Vietnamese" })

  assert.match(result.content, /Translated document created/)
  assert.equal(result.metadata.quality, "verified")
  assert.deepEqual(result.metadata.warnings, [])
  assert.equal(fs.existsSync(result.metadata.artifacts[0].path), true)
  assert.equal(result.metadata.artifacts[0].mime, "text/markdown")
})

test("office executor preserves XLSX artifact and in-place backup metadata", async () => {
  const tool = await loadTool("translate_office_document.mjs")
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-office-plugin-"))
  const newFileInput = path.join(temp, "copy.xlsx")
  const inplaceInput = path.join(temp, "inplace.xlsx")
  const originalTranslateDocument = translationRuntime.translateDocument
  const calls = []
  translationRuntime.translateDocument = async (args) => {
    calls.push(args)
    const artifactPath = args.mode === "inplace" ? args.inputPath : path.join(temp, "copy-translated-vietnamese.xlsx")
    const backupPath = args.mode === "inplace" ? `${args.inputPath}.bak` : undefined
    fs.writeFileSync(artifactPath, "translated workbook")
    if (backupPath) fs.writeFileSync(backupPath, "original workbook")
    return {
      output: "Translated document created.",
      metadata: {
        artifacts: [{ path: artifactPath, filename: path.basename(artifactPath), mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
        ...(backupPath ? { backupPath } : {}),
        quality: "verified",
        warnings: []
      }
    }
  }

  try {
    const copied = await tool.execute({ inputPath: newFileInput, targetLanguage: "Vietnamese", mode: "newfile" })
    const inplace = await tool.execute({ inputPath: inplaceInput, targetLanguage: "Vietnamese", mode: "inplace" })

    assert.deepEqual(calls, [
      { inputPath: newFileInput, targetLanguage: "Vietnamese", mode: "newfile" },
      { inputPath: inplaceInput, targetLanguage: "Vietnamese", mode: "inplace" }
    ])
    assert.equal(copied.metadata.artifacts[0].mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert.equal(fs.existsSync(copied.metadata.artifacts[0].path), true)
    assert.equal(inplace.metadata.artifacts[0].path, inplaceInput)
    assert.equal(fs.existsSync(inplace.metadata.backupPath), true)
    assert.equal(inplace.metadata.quality, "verified")
  } finally {
    translationRuntime.translateDocument = originalTranslateDocument
  }
})

test("plugin executors reject invalid formats before calling the translation engine", async () => {
  const documentTool = await loadTool("translate_document.mjs")
  const officeTool = await loadTool("translate_office_document.mjs")
  const originalTranslateDocument = translationRuntime.translateDocument
  let calls = 0
  translationRuntime.translateDocument = async () => {
    calls += 1
    throw new Error("translation engine must not run")
  }

  try {
    await assert.rejects(
      documentTool.execute({ path: "/tmp/source.md", targetLanguage: "Vietnamese" }),
      /inputPath is required.*Unexpected property: path/
    )
    await assert.rejects(
      documentTool.execute({ inputPath: "/tmp/source.md" }),
      /targetLanguage is required/
    )
    await assert.rejects(
      officeTool.execute({ inputPath: "/tmp/source.docx", targetLanguage: "Vietnamese" }),
      /supports only \.pptx and \.xlsx/
    )
    await assert.rejects(
      officeTool.execute({ inputPath: "/tmp/source.pptx", targetLanguage: "Vietnamese", mode: "newfile" }),
      /mode is only supported for XLSX/
    )
    assert.equal(calls, 0)
  } finally {
    translationRuntime.translateDocument = originalTranslateDocument
  }
})
