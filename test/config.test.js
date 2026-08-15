const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_CONFIG,
  DEFAULT_MODEL_ID,
  LEGACY_DEFAULT_AGENT_PROMPTS,
  DEFAULT_MODEL_REF,
  DEFAULT_PROVIDER_ID,
  SUPERPOWERS_PLUGIN,
  ensureDefaultAgentPrompt,
  ensureDefaultManagedModelConfig,
  readOpencodeConfig,
  recoverInvalidOpencodeConfig,
  writeOpencodeConfig,
  ensureOpencodeConfig,
  listReferenceEntries,
  addReferenceEntry,
  removeReferenceEntry
} = require("../src/opencode-config")

// DEFAULT_CONFIG seeds one example provider/model so the Config screen has something to show on
// first run. Users point the gateway at their own endpoint and add models from there — nothing
// restricts a chat to this entry — but the seed itself must stay well-formed.
test("the default config seeds one example provider and model", () => {
  assert.equal(DEFAULT_MODEL_REF, `${DEFAULT_PROVIDER_ID}/${DEFAULT_MODEL_ID}`)
  assert.deepEqual(Object.keys(DEFAULT_CONFIG.provider), [DEFAULT_PROVIDER_ID])
  assert.deepEqual(Object.keys(DEFAULT_CONFIG.provider[DEFAULT_PROVIDER_ID].models), [DEFAULT_MODEL_ID])

  // Top-level `model`/`small_model` are intentionally absent: the bundled models.dev
  // schema types them as a closed enum of public refs, so a custom provider ref fails
  // offline validation. Setting either would make the profile refuse to write.
  assert.equal(DEFAULT_CONFIG.model, undefined)
  assert.equal(DEFAULT_CONFIG.small_model, undefined)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-"))
  const pinned = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  pinned.model = DEFAULT_MODEL_REF
  assert.throws(
    () => writeOpencodeConfig(pinned, path.join(temp, "opencode.json")),
    /\/model must be equal to one of the allowed values/
  )
})

test("creates the default opencode config when the file is missing", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-"))
  const configPath = path.join(temp, ".config", "opencode", "opencode.json")

  const result = ensureOpencodeConfig(configPath)

  assert.equal(result.path, configPath)
  assert.equal(result.exists, true)
  assert.equal(result.config.provider.gateway.options.baseURL, "")
  assert.equal(result.config.provider.gateway.options.apiKey, "")
  const model = result.config.provider.gateway.models[DEFAULT_MODEL_ID]
  assert.equal(model.name, DEFAULT_MODEL_ID)
  assert.deepEqual(model.modalities, {
    input: ["text", "image", "pdf"],
    output: ["text"]
  })
  assert.deepEqual(model.limit, { context: 128000, output: 32000 })
  assert.equal(model.reasoning, true)
  assert.equal(model.temperature, true)
  assert.equal(model.tool_call, true)
  assert.deepEqual(model.interleaved, { field: "reasoning" })
  assert.deepEqual(model.options, {
    max_completion_tokens: 32000,
    include_reasoning: true
  })
  assert.deepEqual(result.config.plugin, [])
  assert.equal(typeof result.config.agent.build.prompt, "string")
  assert.ok(result.config.agent.build.prompt.length > 0)
  assert.equal(typeof result.config.agent.plan.prompt, "string")
  assert.ok(result.config.agent.plan.prompt.length > 0)
  assert.ok(fs.existsSync(configPath))
})

test("back-fills default agent prompts into a config that predates them", () => {
  const legacy = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  delete legacy.agent

  ensureDefaultAgentPrompt(legacy)

  assert.equal(legacy.agent.build.prompt, DEFAULT_AGENT_CONFIG.build.prompt)
  assert.equal(legacy.agent.plan.prompt, DEFAULT_AGENT_CONFIG.plan.prompt)
})

test("does not overwrite a user's customized agent prompt", () => {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  config.agent = { build: { prompt: "my custom prompt" } }

  ensureDefaultAgentPrompt(config)

  assert.equal(config.agent.build.prompt, "my custom prompt")
  // The missing plan agent is still back-filled.
  assert.equal(config.agent.plan.prompt, DEFAULT_AGENT_CONFIG.plan.prompt)
})

test("upgrades a previously shipped default plan prompt to the current default", () => {
  const legacyPlanPrompt = LEGACY_DEFAULT_AGENT_PROMPTS.plan[0]
  assert.equal(typeof legacyPlanPrompt, "string")
  // The legacy prompt must differ from the current one, otherwise the upgrade is a no-op.
  assert.notEqual(legacyPlanPrompt, DEFAULT_AGENT_CONFIG.plan.prompt)

  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
  config.agent = { plan: { prompt: legacyPlanPrompt } }

  ensureDefaultAgentPrompt(config)

  // A saved prompt that still matches an old default is treated as un-customized
  // and upgraded so existing profiles pick up the question/todowrite guidance.
  assert.equal(config.agent.plan.prompt, DEFAULT_AGENT_CONFIG.plan.prompt)
  // The current default mentions the native tools that drive ask-first + tracking.
  assert.match(config.agent.plan.prompt, /question/)
  assert.match(config.agent.plan.prompt, /todowrite/)
})

test("accepts the default config with agent prompts as valid", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-"))
  const configPath = path.join(temp, "opencode.json")
  assert.doesNotThrow(() => writeOpencodeConfig(DEFAULT_CONFIG, configPath))
})

test("writes valid JSON while preserving supported provider and plugin config", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-"))
  const configPath = path.join(temp, "opencode.json")
  const existing = {
    ...DEFAULT_CONFIG,
    provider: {
      ...DEFAULT_CONFIG.provider,
      extra: { npm: "custom", options: {}, models: {} }
    }
  }

  writeOpencodeConfig(existing, configPath)
  fs.chmodSync(configPath, 0o600)
  const loaded = readOpencodeConfig(configPath).config
  loaded.provider.gateway.options.baseURL = "https://example.test/v1"
  loaded.plugin = [SUPERPOWERS_PLUGIN, "local-plugin"]
  writeOpencodeConfig(loaded, configPath)

  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"))
  assert.equal(saved.provider.extra.npm, "custom")
  assert.equal(saved.provider.gateway.options.baseURL, "https://example.test/v1")
  assert.deepEqual(saved.plugin, [SUPERPOWERS_PLUGIN, "local-plugin"])
  // Rewriting must not widen the file's permissions. Windows has no POSIX mode bits, so chmod
  // above is a no-op there and stat reports 0o666 regardless of what we wrote.
  if (process.platform !== "win32") assert.equal(fs.statSync(configPath).mode & 0o777, 0o600)
})

test("rejects invalid OpenCode config without changing the saved file", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-"))
  const configPath = path.join(temp, "opencode.json")
  writeOpencodeConfig(DEFAULT_CONFIG, configPath)
  const original = fs.readFileSync(configPath, "utf8")

  const invalidModality = JSON.parse(original)
  invalidModality.provider.gateway.models[DEFAULT_MODEL_ID].modalities.input.push("docx")
  assert.throws(() => writeOpencodeConfig(invalidModality, configPath), /modalities\/input\/3 must be equal to one of the allowed values/)
  assert.equal(fs.readFileSync(configPath, "utf8"), original)

  const unknownKey = { ...DEFAULT_CONFIG, custom_option: true }
  assert.throws(() => writeOpencodeConfig(unknownKey, configPath), /\/custom_option must NOT have additional properties/)
  assert.equal(fs.readFileSync(configPath, "utf8"), original)

  const invalidShape = { ...DEFAULT_CONFIG, plugin: "not-an-array" }
  assert.throws(() => writeOpencodeConfig(invalidShape, configPath), /\/plugin must be array/)
  assert.equal(fs.readFileSync(configPath, "utf8"), original)
  assert.equal(fs.readdirSync(temp).some((name) => name.endsWith(".tmp")), false)
})

test("backs up invalid config byte-for-byte before atomically resetting it", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-recovery-"))
  const configPath = path.join(temp, "opencode.json")
  const invalid = Buffer.from("{ not-json }\n")
  fs.writeFileSync(configPath, invalid)

  const result = recoverInvalidOpencodeConfig(configPath, new Date("2026-07-10T00:00:00.000Z"))

  assert.deepEqual(fs.readFileSync(result.backupPath), invalid)
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), DEFAULT_CONFIG)
  assert.equal(fs.readdirSync(temp).some((name) => name.endsWith(".tmp")), false)
})

test("keeps the invalid original when creating its recovery backup fails", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-recovery-"))
  const configPath = path.join(temp, "opencode.json")
  const invalid = "{ not-json }\n"
  fs.writeFileSync(configPath, invalid)
  const originalCopy = fs.copyFileSync
  fs.copyFileSync = () => {
    const error = new Error("backup denied")
    error.code = "EACCES"
    throw error
  }
  try {
    assert.throws(() => recoverInvalidOpencodeConfig(configPath), /backup denied/)
    assert.equal(fs.readFileSync(configPath, "utf8"), invalid)
  } finally {
    fs.copyFileSync = originalCopy
  }
})

test("atomic rename failure leaves the existing config unchanged and removes the temp file", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-atomic-"))
  const configPath = path.join(temp, "opencode.json")
  writeOpencodeConfig(DEFAULT_CONFIG, configPath)
  const original = fs.readFileSync(configPath, "utf8")
  const originalRename = fs.renameSync
  fs.renameSync = () => {
    const error = new Error("rename denied")
    error.code = "EACCES"
    throw error
  }
  try {
    const changed = structuredClone(DEFAULT_CONFIG)
    changed.plugin = ["local-plugin"]
    assert.throws(() => writeOpencodeConfig(changed, configPath), /rename denied/)
    assert.equal(fs.readFileSync(configPath, "utf8"), original)
    assert.equal(fs.readdirSync(temp).some((name) => name.endsWith(".tmp")), false)
  } finally {
    fs.renameSync = originalRename
  }
})

test("reset failure preserves both the invalid original and its completed backup", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-recovery-"))
  const configPath = path.join(temp, "opencode.json")
  const invalid = "{ not-json }\n"
  fs.writeFileSync(configPath, invalid)
  const originalRename = fs.renameSync
  fs.renameSync = () => {
    const error = new Error("disk full")
    error.code = "ENOSPC"
    throw error
  }
  try {
    assert.throws(() => recoverInvalidOpencodeConfig(configPath, new Date("2026-07-10T00:00:00.000Z")), /disk full/)
    assert.equal(fs.readFileSync(configPath, "utf8"), invalid)
    const backup = fs.readdirSync(temp).find((name) => name.endsWith(".bak"))
    assert.ok(backup)
    assert.equal(fs.readFileSync(path.join(temp, backup), "utf8"), invalid)
    assert.equal(fs.readdirSync(temp).some((name) => name.endsWith(".tmp")), false)
  } finally {
    fs.renameSync = originalRename
  }
})

test("accepts a local MCP server config that uses a workspace-relative cwd", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-"))
  const configPath = path.join(temp, "opencode.json")
  const withMcp = {
    ...DEFAULT_CONFIG,
    mcp: {
      docs: { type: "local", command: ["node", "server.js"], cwd: "./tools/mcp" }
    }
  }

  assert.doesNotThrow(() => writeOpencodeConfig(withMcp, configPath))
  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"))
  assert.equal(saved.mcp.docs.cwd, "./tools/mcp")

  // The local-first schema must still reject unknown MCP keys.
  const unknownMcpKey = {
    ...DEFAULT_CONFIG,
    mcp: { docs: { type: "local", command: ["node", "server.js"], bogus: true } }
  }
  assert.throws(() => writeOpencodeConfig(unknownMcpKey, configPath), /\/bogus must NOT have additional properties/)
})

// Added in opencode 1.18.7. The offline validator is a frozen snapshot of the upstream
// schema, so a field the runtime accepts must be mirrored here or valid configs get rejected.
test("accepts the subagent_depth nesting limit", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-"))
  const configPath = path.join(temp, "opencode.json")

  assert.doesNotThrow(() => writeOpencodeConfig({ ...DEFAULT_CONFIG, subagent_depth: 2 }, configPath))
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).subagent_depth, 2)

  const negative = { ...DEFAULT_CONFIG, subagent_depth: -1 }
  assert.throws(() => writeOpencodeConfig(negative, configPath), /\/subagent_depth must be >= 0/)

  const fractional = { ...DEFAULT_CONFIG, subagent_depth: 1.5 }
  assert.throws(() => writeOpencodeConfig(fractional, configPath), /\/subagent_depth must be integer/)
})

test("accepts widened interleaved reasoning field shapes", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-"))
  const configPath = path.join(temp, "opencode.json")

  const withInterleaved = (interleaved) => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG))
    const model = Object.values(config.provider[DEFAULT_PROVIDER_ID].models)[0]
    model.interleaved = interleaved
    return config
  }

  // Booleans are no longer pinned to `true` only.
  assert.doesNotThrow(() => writeOpencodeConfig(withInterleaved(false), configPath))
  assert.doesNotThrow(() => writeOpencodeConfig(withInterleaved(true), configPath))

  // Bare-string form, both the known enum and an arbitrary custom field name.
  assert.doesNotThrow(() => writeOpencodeConfig(withInterleaved("reasoning_text"), configPath))
  assert.doesNotThrow(() => writeOpencodeConfig(withInterleaved("custom_reasoning_field"), configPath))

  // Object form with a custom field name.
  assert.doesNotThrow(() => writeOpencodeConfig(withInterleaved({ field: "reasoning_text" }), configPath))
  assert.doesNotThrow(() => writeOpencodeConfig(withInterleaved({ field: "vendor_specific" }), configPath))

  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"))
  assert.deepEqual(Object.values(saved.provider[DEFAULT_PROVIDER_ID].models)[0].interleaved, {
    field: "vendor_specific"
  })

  // The object form still rejects unknown keys and requires `field`.
  assert.throws(() => writeOpencodeConfig(withInterleaved({}), configPath), /must have required property/)
  assert.throws(
    () => writeOpencodeConfig(withInterleaved({ field: "reasoning", bogus: true }), configPath),
    /must NOT have additional properties/
  )
})

test("rejects malformed JSON when reading a saved config", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-"))
  const configPath = path.join(temp, "opencode.json")
  fs.writeFileSync(configPath, "{not-json}\n")

  assert.throws(() => readOpencodeConfig(configPath), /Failed to read opencode config/)
})

test("back-fills model defaults for any provider without replacing explicit values", () => {
  const config = {
    provider: {
      custom: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "https://example.test/v1", apiKey: "" },
        models: {
          "my-model": { name: "my-model", limit: { context: 64000, output: 8000 } }
        }
      }
    }
  }

  ensureDefaultManagedModelConfig(config)

  const model = config.provider.custom.models["my-model"]
  // Explicit values survive the back-fill.
  assert.deepEqual(model.limit, { context: 64000, output: 8000 })
  // Missing metadata is filled in with defaults.
  assert.deepEqual(model.modalities, { input: ["text", "image", "pdf"], output: ["text"] })
  assert.equal(model.reasoning, true)
  assert.equal(model.tool_call, true)
  assert.equal(model.options.max_completion_tokens, 32000)
})

test("listReferenceEntries returns an empty map when no config exists yet or references is unset", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-references-"))
  const configPath = path.join(temp, "opencode.json")
  assert.deepEqual(listReferenceEntries(configPath), {})

  writeOpencodeConfig(DEFAULT_CONFIG, configPath)
  assert.deepEqual(listReferenceEntries(configPath), {})
})

test("addReferenceEntry writes a local or git reference into the references map, not the deprecated reference key", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-references-"))
  const configPath = path.join(temp, "opencode.json")

  addReferenceEntry("my-notes", { path: "/tmp/project/notes.md", description: "project notes" }, configPath)
  addReferenceEntry("upstream", { repository: "https://example.com/repo.git", branch: "main" }, configPath)

  const entries = listReferenceEntries(configPath)
  assert.deepEqual(entries, {
    "my-notes": { path: "/tmp/project/notes.md", description: "project notes" },
    upstream: { repository: "https://example.com/repo.git", branch: "main" }
  })
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"))
  assert.equal(raw.reference, undefined, "must write to `references`, not the deprecated `reference` key")
})

test("addReferenceEntry rejects a duplicate name instead of silently overwriting", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-references-"))
  const configPath = path.join(temp, "opencode.json")
  addReferenceEntry("my-notes", { path: "/tmp/project/notes.md" }, configPath)

  assert.throws(
    () => addReferenceEntry("my-notes", { path: "/tmp/project/other.md" }, configPath),
    /already exists/
  )
  assert.deepEqual(listReferenceEntries(configPath), { "my-notes": { path: "/tmp/project/notes.md" } })
})

test("addReferenceEntry rejects a malformed entry (neither Local nor Git shape) without corrupting the file", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-references-"))
  const configPath = path.join(temp, "opencode.json")
  addReferenceEntry("good-ref", { path: "/tmp/project/notes.md" }, configPath)

  assert.throws(
    () => addReferenceEntry("bad-ref", { description: "neither path nor repository" }, configPath),
    /must match a schema in anyOf/
  )
  // The pre-existing good entry must survive untouched — the failed write never reached disk.
  assert.deepEqual(listReferenceEntries(configPath), { "good-ref": { path: "/tmp/project/notes.md" } })
})

test("removeReferenceEntry deletes a named reference", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-references-"))
  const configPath = path.join(temp, "opencode.json")
  addReferenceEntry("my-notes", { path: "/tmp/project/notes.md" }, configPath)
  addReferenceEntry("upstream", { repository: "https://example.com/repo.git" }, configPath)

  removeReferenceEntry("my-notes", configPath)

  assert.deepEqual(listReferenceEntries(configPath), {
    upstream: { repository: "https://example.com/repo.git" }
  })
})

test("removeReferenceEntry throws for a name that does not exist", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-config-references-"))
  const configPath = path.join(temp, "opencode.json")
  writeOpencodeConfig(DEFAULT_CONFIG, configPath)

  assert.throws(() => removeReferenceEntry("ghost", configPath), /No reference named "ghost" exists/)
})
