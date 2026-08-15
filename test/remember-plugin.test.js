const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { pathToFileURL } = require("node:url")

async function loadTool() {
  const pluginPath = path.join(__dirname, "..", "resources", "opencode", "plugins", "remember.mjs")
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

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

test("remember plugin exposes a direct Standard JSON Schema outside Code Mode", async () => {
  const tool = await loadTool()
  const schema = tool.input["~standard"].jsonSchema.input()

  assert.equal(tool.name, "remember")
  assert.deepEqual(tool.options, { codemode: false })
  assert.deepEqual(Object.keys(schema.properties), ["fact", "scope"])
  assert.deepEqual(schema.required, ["fact"])
  assert.equal(schema.additionalProperties, false)
  assert.ok(tool.input["~standard"].validate({ fact: "Use Vietnamese replies" }).value)
  assert.ok(tool.input["~standard"].validate({ fact: "Use Vietnamese replies", scope: "global" }).value)
  assert.ok(tool.input["~standard"].validate({ fact: "x" }).issues.some((issue) => issue.path?.[0] === "fact"))
  assert.ok(tool.input["~standard"].validate({ fact: "Valid fact", scope: "team" }).issues.some((issue) => issue.path?.[0] === "scope"))
  assert.ok(tool.input["~standard"].validate({ text: "legacy alias" }).issues.some((issue) => issue.path?.[0] === "text"))
})

test("remember plugin persists global and default-project facts and deduplicates them", async () => {
  const tool = await loadTool()
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-remember-plugin-"))
  const projectId = "proj_0123456789abcdef"
  const previousProfileDir = process.env.OPENCODE_CONFIG_DIR
  const previousProjectId = process.env.OPENWORKING_PROJECT_ID
  process.env.OPENCODE_CONFIG_DIR = profileDir
  process.env.OPENWORKING_PROJECT_ID = projectId

  try {
    const globalResult = await tool.execute({ fact: "  User   prefers Vietnamese replies  ", scope: "global" })
    const projectResult = await tool.execute({ fact: "Run npm test before review" })
    const duplicate = await tool.execute({ fact: "run NPM TEST before REVIEW", scope: "project" })

    assert.equal(globalResult.content, "Remembered (global): User prefers Vietnamese replies")
    assert.equal(projectResult.content, "Remembered (project): Run npm test before review")
    assert.equal(duplicate.content, "Already remembered (project): run NPM TEST before REVIEW")
    assert.match(fs.readFileSync(path.join(profileDir, "AGENTS.md"), "utf8"), /- User prefers Vietnamese replies/)
    const projectMemory = fs.readFileSync(path.join(profileDir, "memory", `${projectId}.md`), "utf8")
    assert.equal((projectMemory.match(/^- /gm) || []).length, 1)
    assert.match(projectMemory, /- Run npm test before review/)
  } finally {
    restoreEnvironment("OPENCODE_CONFIG_DIR", previousProfileDir)
    restoreEnvironment("OPENWORKING_PROJECT_ID", previousProjectId)
  }
})

test("remember plugin rejects invalid input before touching profile storage", async () => {
  const tool = await loadTool()
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-remember-invalid-"))
  const previousProfileDir = process.env.OPENCODE_CONFIG_DIR
  process.env.OPENCODE_CONFIG_DIR = profileDir

  try {
    await assert.rejects(tool.execute({ text: "legacy alias" }), /fact must contain at least 3 characters.*Unexpected property: text/)
    await assert.rejects(tool.execute({ fact: "Valid fact", scope: "team" }), /scope must be global or project/)
    assert.deepEqual(fs.readdirSync(profileDir), [])
  } finally {
    restoreEnvironment("OPENCODE_CONFIG_DIR", previousProfileDir)
  }
})
