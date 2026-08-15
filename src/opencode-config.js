const crypto = require("node:crypto")
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
  include_reasoning: true
}
const DEFAULT_MODEL_ID = "gpt-4o-mini"
// Native per-session reasoning variants (opencode v2): the runtime switches variant per prompt
// instead of the app rewriting model options and reloading the runtime.
const DEFAULT_MODEL_VARIANTS = {
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
  xhigh: { reasoningEffort: "xhigh" }
}
// The product ships exactly one model. These are the single source of truth for the
// pin: DEFAULT_CONFIG below builds its provider/model map from them, and main.js
// rejects any session model that names a different provider. The OpenCode runtime
// additionally advertises its own built-in `opencode` providers over GET /api/model;
// the app never surfaces those, and `model`/`small_model` here keep the server from
// falling back to one.
// The provider/model the bundled DEFAULT_CONFIG ships with. Users are free to point the
// gateway at their own endpoint and add models — nothing pins a chat to these.
const DEFAULT_PROVIDER_ID = "gateway"
const DEFAULT_MODEL_REF = `${DEFAULT_PROVIDER_ID}/${DEFAULT_MODEL_ID}`
const DEFAULT_MODEL_CONFIG = {
  name: DEFAULT_MODEL_ID,
  modalities: DEFAULT_MODEL_MODALITIES,
  limit: DEFAULT_MODEL_LIMIT,
  reasoning: true,
  temperature: true,
  tool_call: true,
  // Wire field the pinned gateway actually streams reasoning deltas under. Verified twice: the
  // migration's own captured evidence (.agents/evidence/v2-real-llm-stream.jsonl) and a live
  // request/response dump taken while diagnosing a tool-call bug both show `delta.reasoning`,
  // never `delta.reasoning_content` (a v1-era / other-vendor convention this was copied from
  // without re-checking against this gateway). With the wrong field name reasoning text streams
  // in and is silently discarded because OpenCode is told to look for a field that never arrives.
  interleaved: { field: "reasoning" },
  options: DEFAULT_MODEL_OPTIONS,
  variants: DEFAULT_MODEL_VARIANTS
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
  "If the request is ambiguous or you are missing information you need to plan well, ASK the user first: use the `question` tool to present concrete multiple-choice questions instead of guessing. Prefer asking a few sharp questions over producing a plan built on assumptions.",
  "Once you understand the task, use the `todowrite` tool to record the plan as a checklist of concrete steps — one todo per step — so progress can be tracked while the plan is later executed. Keep the todos in sync as your understanding changes.",
  "Also present the plan in your reply: clear, well-structured, with explicit numbered steps, the files involved, and the trade-offs of your approach.",
  "Be thorough rather than terse — explain why each step matters.",
  ANSWER_IN_USER_LANGUAGE
].join(" ")
const DEFAULT_AGENT_CONFIG = {
  build: { prompt: DEFAULT_BUILD_PROMPT },
  plan: { prompt: DEFAULT_PLAN_PROMPT }
}
// Previous shipped defaults for each agent prompt. `ensureDefaultAgentPrompt`
// upgrades a saved prompt to the current default only when it byte-matches one
// of these — i.e. the user never customized it. A user's own prompt (matching
// none of these) is always preserved. Append the outgoing string here whenever
// DEFAULT_BUILD_PROMPT / DEFAULT_PLAN_PROMPT changes.
const LEGACY_DEFAULT_AGENT_PROMPTS = {
  build: [],
  plan: [
    // v1 — before the question/todowrite plan-native guidance was added.
    [
      "You are a software architect operating in plan mode. You read and analyze but do not edit files.",
      "Analyze the request and the relevant code thoroughly before proposing anything.",
      "Present a clear, well-structured plan with explicit numbered steps, the files involved, and the trade-offs of your approach.",
      "Be thorough rather than terse — explain why each step matters.",
      ANSWER_IN_USER_LANGUAGE
    ].join(" ")
  ]
}

// The bundled provider is a generic OpenAI-compatible API gateway. Users point it
// at their own endpoint (and key) from the Config screen on first run; the example
// model entry exists so the Config screen has something to show and can be renamed
// by editing opencode.json directly.
const DEFAULT_CONFIG = {
  "$schema": "https://opencode.ai/config.json",
  // NOTE: the top-level `model` / `small_model` keys are deliberately NOT set. The bundled
  // models.dev schema types them as a closed enum of ~5.2k public model refs, so a custom
  // provider ref like `gateway/gpt-4o-mini` fails offline Ajv validation and the profile
  // refuses to write. The active model is chosen per session in the composer instead.
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
      if (model.interleaved === undefined) model.interleaved = clone(DEFAULT_MODEL_CONFIG.interleaved)
      if (!model.variants) model.variants = clone(DEFAULT_MODEL_VARIANTS)
      model.options ||= {}
      normalizeModelOptionAliases(model.options)
      // Reasoning effort is a native variant now, not a model option — drop the legacy key so a
      // profile written by an older build stops pinning one effort level for every session.
      delete model.options.reasoningEffort
      for (const [key, value] of Object.entries(DEFAULT_MODEL_OPTIONS)) {
        if (model.options[key] === undefined) model.options[key] = value
      }
      // Agent progress is an app-managed default, independent of the model effort
      // selector. Keep it enabled when backfilling profiles that previously disabled
      // or removed it.
      model.options.include_reasoning = true
    }
  }
  return config
}

function normalizeModelOptionAliases(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return options
  if (Object.hasOwn(options, "reasoning_effort")) {
    if (options.reasoningEffort === undefined) options.reasoningEffort = options.reasoning_effort
    delete options.reasoning_effort
  }
  if (Object.hasOwn(options, "includeReasoning")) {
    if (options.include_reasoning === undefined) options.include_reasoning = options.includeReasoning
    delete options.includeReasoning
  }
  return options
}

// Back-fill the default system prompts for the build/plan agents. Fills a prompt
// when one is missing, and upgrades a prompt that still matches a previously
// shipped default (see LEGACY_DEFAULT_AGENT_PROMPTS) to the current default — so
// existing profiles pick up improvements. A prompt the user customized (matching
// neither the current nor any legacy default) is never overwritten.
function ensureDefaultAgentPrompt(config) {
  config.agent ||= {}
  for (const [name, agent] of Object.entries(DEFAULT_AGENT_CONFIG)) {
    config.agent[name] ||= {}
    const current = config.agent[name].prompt
    const isLegacyDefault = (LEGACY_DEFAULT_AGENT_PROMPTS[name] || []).includes(current)
    if (current === undefined || isLegacyDefault) config.agent[name].prompt = agent.prompt
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
    const wrapped = new Error(`Failed to read opencode config at ${configPath}: ${error.message}`, { cause: error })
    wrapped.code = error.code
    wrapped.invalidConfig = error instanceof SyntaxError || error.message === "opencode config must be a JSON object."
    throw wrapped
  }
}

function writeOpencodeConfig(config, configPath = defaultConfigPath()) {
  assertValidOpencodeConfig(config)
  const serialized = `${JSON.stringify(config, null, 2)}\n`
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  let mode = 0o600
  try {
    mode = fs.statSync(configPath).mode & 0o777
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  const tempPath = `${configPath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  try {
    fs.writeFileSync(tempPath, serialized, { mode })
    fs.renameSync(tempPath, configPath)
  } finally {
    try { fs.rmSync(tempPath, { force: true }) } catch { /* best-effort temp cleanup */ }
  }
  return { path: configPath, exists: true, config }
}

function corruptBackupPath(configPath, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, "-")
  const base = `${configPath}.corrupt-${stamp}`
  let candidate = `${base}.bak`
  let suffix = 1
  while (fs.existsSync(candidate)) candidate = `${base}-${suffix++}.bak`
  return candidate
}

// Preserve the exact invalid file before replacing it. writeOpencodeConfig is atomic, so if the
// replacement fails the original remains in place and the caller can enter blocked recovery mode.
function recoverInvalidOpencodeConfig(configPath, now = new Date()) {
  const backupPath = corruptBackupPath(configPath, now)
  fs.copyFileSync(configPath, backupPath, fs.constants.COPYFILE_EXCL)
  const written = writeOpencodeConfig(clone(DEFAULT_CONFIG), configPath)
  return { ...written, backupPath }
}

function ensureOpencodeConfig(configPath = defaultConfigPath()) {
  const current = readOpencodeConfig(configPath)
  if (current.exists) return current
  return writeOpencodeConfig(current.config, configPath)
}

// References live in the single global config's `references` name-keyed map (resources/opencode/schemas/
// opencode-config.schema.json: Config.properties.references — a sibling deprecated `reference` key has the
// identical shape). There is no per-project config file and no server-side mutation endpoint for these
// (GET /api/reference is read-only) — add/remove is entirely this client-side read-modify-write.
function listReferenceEntries(configPath = defaultConfigPath()) {
  const { config } = readOpencodeConfig(configPath)
  return clone(config.references || {})
}

function addReferenceEntry(name, entry, configPath = defaultConfigPath()) {
  const trimmedName = String(name || "").trim()
  if (!trimmedName) throw new Error("Reference name is required.")
  const current = readOpencodeConfig(configPath)
  const config = current.config
  config.references ||= {}
  if (Object.hasOwn(config.references, trimmedName)) {
    throw new Error(`A reference named "${trimmedName}" already exists.`)
  }
  config.references[trimmedName] = entry
  // writeOpencodeConfig runs assertValidOpencodeConfig before touching disk, so a malformed entry
  // (e.g. neither a valid Local nor Git shape) throws here without corrupting the existing file.
  return writeOpencodeConfig(config, configPath)
}

function removeReferenceEntry(name, configPath = defaultConfigPath()) {
  const trimmedName = String(name || "").trim()
  const current = readOpencodeConfig(configPath)
  const config = current.config
  if (!config.references || !Object.hasOwn(config.references, trimmedName)) {
    throw new Error(`No reference named "${trimmedName}" exists.`)
  }
  delete config.references[trimmedName]
  return writeOpencodeConfig(config, configPath)
}

module.exports = {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_CONFIG,
  DEFAULT_MODEL_CONFIG,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_LIMIT,
  DEFAULT_MODEL_MODALITIES,
  DEFAULT_MODEL_OPTIONS,
  DEFAULT_MODEL_REF,
  DEFAULT_PROVIDER_ID,
  LEGACY_DEFAULT_AGENT_PROMPTS,
  SUPERPOWERS_PLUGIN,
  assertValidOpencodeConfig,
  corruptBackupPath,
  defaultConfigPath,
  ensureDefaultAgentPrompt,
  ensureDefaultManagedModelConfig,
  readOpencodeConfig,
  normalizeModelOptionAliases,
  recoverInvalidOpencodeConfig,
  writeOpencodeConfig,
  ensureOpencodeConfig,
  listReferenceEntries,
  addReferenceEntry,
  removeReferenceEntry
}
