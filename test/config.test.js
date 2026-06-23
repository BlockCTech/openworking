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
  SUPERPOWERS_PLUGIN,
  ensureDefaultAgentPrompt,
  ensureDefaultManagedModelConfig,
  readOpencodeConfig,
  writeOpencodeConfig,
  ensureOpencodeConfig
} = require("../src/opencode-config")

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
  assert.deepEqual(model.options, {
    max_completion_tokens: 32000,
    reasoning_effort: "high",
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
  const loaded = readOpencodeConfig(configPath).config
  loaded.provider.gateway.options.baseURL = "https://example.test/v1"
  loaded.plugin = [SUPERPOWERS_PLUGIN, "local-plugin"]
  writeOpencodeConfig(loaded, configPath)

  const saved = JSON.parse(fs.readFileSync(configPath, "utf8"))
  assert.equal(saved.provider.extra.npm, "custom")
  assert.equal(saved.provider.gateway.options.baseURL, "https://example.test/v1")
  assert.deepEqual(saved.plugin, [SUPERPOWERS_PLUGIN, "local-plugin"])
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
