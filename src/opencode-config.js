const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const Ajv2020 = require("ajv/dist/2020")

const SUPERPOWERS_PLUGIN = "superpowers@git+https://github.com/obra/superpowers.git"
const DEFAULT_MODEL_MODALITIES = {
  input: ["text", "image", "pdf"],
  output: ["text"]
}
const DEFAULT_MODEL_LIMIT = {
  context: 128000,
  output: 32000
}
const DEFAULT_MODEL_OPTIONS = {
  max_completion_tokens: 32000,
  reasoning_effort: "high",
  include_reasoning: true
}
const DEFAULT_MODEL_ID = "gpt-4o-mini"
const DEFAULT_MODEL_CONFIG = {
  name: DEFAULT_MODEL_ID,
  modalities: DEFAULT_MODEL_MODALITIES,
  limit: DEFAULT_MODEL_LIMIT,
  reasoning: true,
  temperature: true,
  tool_call: true,
  options: DEFAULT_MODEL_OPTIONS
}

// System prompts that steer the bundled model toward thorough, well-structured
// answers. Without these the model tends to reply tersely. Written in English
// (the model follows English instructions most reliably) but instructed to
// always answer in the user's own language so Vietnamese chats get Vietnamese
// replies and English chats get English replies.
const ANSWER_IN_USER_LANGUAGE =
  "Always respond in the same language the user used in their message. " +
  "If they write in Vietnamese, answer in Vietnamese; if they write in English, answer in English. " +
  "Never force a fixed language."
const DEFAULT_BUILD_PROMPT = [
  "You are a capable software engineering assistant working inside a user's project.",
  "Give complete, well-structured answers. Explain your reasoning, not just the conclusion.",
  "When a question calls for analysis, do not reply with a single terse line — walk through the relevant details.",
  "When you write code, provide a complete, runnable example and explain it step by step.",
  ANSWER_IN_USER_LANGUAGE
].join(" ")
const DEFAULT_PLAN_PROMPT = [
  "You are a software architect operating in plan mode. You read and analyze but do not edit files.",
  "Analyze the request and the relevant code thoroughly before proposing anything.",
  "Present a clear, well-structured plan with explicit numbered steps, the files involved, and the trade-offs of your approach.",
  "Be thorough rather than terse — explain why each step matters.",
  ANSWER_IN_USER_LANGUAGE
].join(" ")
const DEFAULT_AGENT_CONFIG = {
  build: { prompt: DEFAULT_BUILD_PROMPT },
  plan: { prompt: DEFAULT_PLAN_PROMPT }
}

// The bundled provider is a generic OpenAI-compatible API gateway. Users point it
// at their own endpoint (and key) from the Config screen on first run; the example
// model entry exists so the Config screen has something to show and can be renamed
// by editing opencode.json directly.
const DEFAULT_CONFIG = {
  "$schema": "https://opencode.ai/config.json",
  provider: {
    gateway: {
      npm: "@ai-sdk/openai-compatible",
      name: "OpenAI-compatible Gateway",
      options: {
        baseURL: "",
        apiKey: ""
      },
      models: {
        [DEFAULT_MODEL_ID]: DEFAULT_MODEL_CONFIG
      }
    }
  },
  permission: {
    // Gate side-effecting actions behind a user approval prompt (Human-in-the-loop).
    // OpenCode emits `permission.asked` for these, which the desktop app surfaces as an
    // Allow once / Always allow / Reject card before the action runs.
    edit: "ask",
    bash: "ask",
    skill: {}
  },
  agent: DEFAULT_AGENT_CONFIG,
  plugin: []
}

function defaultConfigPath(profileDir) {
  if (process.env.OPENWORKING_OPENCODE_CONFIG_PATH) {
    return path.resolve(process.env.OPENWORKING_OPENCODE_CONFIG_PATH)
  }
  if (profileDir) return path.join(profileDir, "opencode.json")
  return path.join(os.homedir(), ".config", "opencode", "opencode.json")
}

function clone(value) {
  return structuredClone(value)
}

function bundledSchemaDir() {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, "opencode", "schemas")
  if (packaged && fs.existsSync(packaged)) return packaged
  return path.join(__dirname, "..", "resources", "opencode", "schemas")
}

function compileConfigValidator() {
  const schemaDir = bundledSchemaDir()
  const configSchema = JSON.parse(fs.readFileSync(path.join(schemaDir, "opencode-config.schema.json"), "utf8"))
  const modelSchema = JSON.parse(fs.readFileSync(path.join(schemaDir, "models-dev-model.schema.json"), "utf8"))
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  ajv.addSchema(modelSchema)
  return ajv.compile(configSchema)
}

const validateConfig = compileConfigValidator()

function assertConfigObject(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("opencode config must be a JSON object.")
  }
}

function validationErrorPath(error) {
  if (error.keyword === "additionalProperties") {
    return `${error.instancePath || ""}/${error.params.additionalProperty}`
  }
  return error.instancePath || "/"
}

function assertValidOpencodeConfig(config) {
  assertConfigObject(config)
  if (validateConfig(config)) return
  const details = validateConfig.errors
    .map((error) => `${validationErrorPath(error)} ${error.message}`)
    .join("; ")
  throw new Error(`Invalid OpenCode config: ${details}`)
}

// Back-fill sensible defaults for any configured model that predates (or omits)
// the richer model metadata, so the runtime and Config screen always have
// modalities/limits/options to work with.
function ensureDefaultManagedModelConfig(config) {
  for (const provider of Object.values(config.provider || {})) {
    for (const model of Object.values(provider?.models || {})) {
      if (!model || typeof model !== "object") continue
      if (!model.modalities) model.modalities = clone(DEFAULT_MODEL_MODALITIES)
      if (!model.limit) model.limit = clone(DEFAULT_MODEL_LIMIT)
      if (model.reasoning === undefined) model.reasoning = true
      if (model.temperature === undefined) model.temperature = true
      if (model.tool_call === undefined) model.tool_call = true
      model.options ||= {}
      for (const [key, value] of Object.entries(DEFAULT_MODEL_OPTIONS)) {
        if (model.options[key] === undefined) model.options[key] = value
      }
    }
  }
  return config
}

// Back-fill the default system prompts for the build/plan agents into configs
// that predate this feature. Only fills a prompt when one is missing so a user's
// own customization is never overwritten.
function ensureDefaultAgentPrompt(config) {
  config.agent ||= {}
  for (const [name, agent] of Object.entries(DEFAULT_AGENT_CONFIG)) {
    config.agent[name] ||= {}
    if (config.agent[name].prompt === undefined) config.agent[name].prompt = agent.prompt
  }
  return config
}

function readOpencodeConfig(configPath = defaultConfigPath()) {
  try {
    const raw = fs.readFileSync(configPath, "utf8")
    const config = JSON.parse(raw)
    assertConfigObject(config)
    return { path: configPath, exists: true, config }
  } catch (error) {
    if (error.code === "ENOENT") {
      return { path: configPath, exists: false, config: clone(DEFAULT_CONFIG) }
    }
    throw new Error(`Failed to read opencode config at ${configPath}: ${error.message}`)
  }
}

function writeOpencodeConfig(config, configPath = defaultConfigPath()) {
  assertValidOpencodeConfig(config)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return { path: configPath, exists: true, config }
}

function ensureOpencodeConfig(configPath = defaultConfigPath()) {
  const current = readOpencodeConfig(configPath)
  if (current.exists) return current
  return writeOpencodeConfig(current.config, configPath)
}

module.exports = {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_CONFIG,
  DEFAULT_MODEL_CONFIG,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_LIMIT,
  DEFAULT_MODEL_MODALITIES,
  DEFAULT_MODEL_OPTIONS,
  SUPERPOWERS_PLUGIN,
  assertValidOpencodeConfig,
  defaultConfigPath,
  ensureDefaultAgentPrompt,
  ensureDefaultManagedModelConfig,
  readOpencodeConfig,
  writeOpencodeConfig,
  ensureOpencodeConfig
}
