const { spawn, execFile } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const http = require("node:http")
const net = require("node:net")
const path = require("node:path")
const { fileURLToPath } = require("node:url")
const { defaultConfigPath, readOpencodeConfig } = require("../opencode-config")
const { officeAttachmentContext } = require("../office-attachment-context")

// Document formats the model/gateway should translate through the bundled
// translate_document tool by local path instead of ingesting as a raw `file` part.
const OFFICE_ATTACHMENT_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",   // .docx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"          // .xlsx
])
const MARKDOWN_ATTACHMENT_MIMES = new Set(["text/markdown", "text/x-markdown"])
const EXTRACTABLE_OFFICE_ATTACHMENT_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"          // .xlsx
])

// Build the OpenCode prompt `parts`: media attachments (pdf/image/...) stay as `file`
// parts the model can read; translated document attachments are surfaced as
// local-path lines in the text so the skill can pick them up as translate_document `inputPath`.
function buildPromptParts({ prompt, attachments = [] }) {
  const documentPaths = []
  const officeContexts = []
  const localPaths = []
  const fileParts = []
  for (const attachment of attachments) {
    const localPath = attachmentLocalPath(attachment)
    const extension = path.extname(localPath || attachment.filename || "").toLowerCase()
    const isOffice = OFFICE_ATTACHMENT_MIMES.has(attachment.mime)
    const isMarkdown = MARKDOWN_ATTACHMENT_MIMES.has(attachment.mime) || extension === ".md" || extension === ".markdown"
    if (isOffice || isMarkdown) {
      documentPaths.push(localPath)
      if (EXTRACTABLE_OFFICE_ATTACHMENT_MIMES.has(attachment.mime)) {
        officeContexts.push(officeAttachmentContext({
          filePath: localPath,
          filename: attachment.filename,
          mime: attachment.mime
        }))
      }
      continue
    }
    if (attachment.mime === "application/octet-stream") {
      localPaths.push(attachmentLocalPath(attachment))
      continue
    }
    fileParts.push({
      type: "file",
      url: attachment.url,
      filename: attachment.filename,
      mime: attachment.mime
    })
  }
  const base = String(prompt).trim()
  const sections = [base]
  if (documentPaths.length) {
    sections.push(
      "Attached document files are provided as local paths plus extracted text context when available because the configured gateway accepts text/images, not raw document binaries.",
      "If the user asks to translate a DOCX, Markdown, PDF, PPTX, or XLSX file, call the translate_document tool with the exact local inputPath. Do not use shell/write scripts for translation artifacts. Do not claim an output path unless it is returned in translate_document metadata.artifacts.",
      `Attached files (local paths):\n${documentPaths.map((p) => `- ${p}`).join("\n")}`,
      officeContexts.filter(Boolean).length ? `Extracted Office context:\n${officeContexts.filter(Boolean).join("\n\n")}` : ""
    )
  }
  if (localPaths.length) {
    sections.push(
      "Attached files are provided as local paths because their media type cannot be sent to the model as a binary file part.",
      `Attached files (local paths):\n${localPaths.map((p) => `- ${p}`).join("\n")}`
    )
  }
  const text = sections.filter(Boolean).join("\n\n")
  return [...fileParts, { type: "text", text }]
}

function attachmentLocalPath(attachment) {
  if (typeof attachment.url === "string" && attachment.url.startsWith("file:")) {
    return fileURLToPath(attachment.url)
  }
  return attachment.filename || ""
}

function timestamp() {
  return new Date().toISOString()
}

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function redactString(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/(OPENWORKING_TRANSLATION_API_KEY)=\S+/g, "$1=[redacted]")
    // Raising the opencode log level can surface OAuth material in log lines / query strings.
    // Redact secrets and authorization-code grant material in both `key=value` and `"key":"value"`
    // shapes so nothing sensitive reaches state.logs / the Diagnostics panel.
    .replace(/(client_secret|code_verifier|access_token|refresh_token|id_token|authorization_code)["']?\s*[=:]\s*["']?[A-Za-z0-9._~+/=-]+/gi, "$1=[redacted]")
    .replace(/([?&]code=)[A-Za-z0-9._~+/=-]+/g, "$1[redacted]")
}

function redactValue(value, key = "") {
  if (typeof value === "string") {
    if (/authorization|api[-_]?key|token|secret|password/i.test(key)) return "[redacted]"
    return redactString(value)
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item))
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)]))
  }
  return value
}

function requestJson({ url, method = "GET", body, auth }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const payload = body === undefined ? null : JSON.stringify(body)
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(auth ? { Authorization: auth } : {})
        }
      },
      (res) => {
        let raw = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => {
          raw += chunk
        })
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 500)}`))
            return
          }
          if (!raw) {
            resolve(null)
            return
          }
          try {
            resolve(JSON.parse(raw))
          } catch {
            resolve(raw)
          }
        })
      }
    )
    req.on("error", reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function findFreePort(hostname = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

function resolveRuntimeBin() {
  if (process.env.OPENWORKING_RUNTIME_BIN) return process.env.OPENWORKING_RUNTIME_BIN
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN

  const wrapperExecutable = "opencode.exe"
  const runtimePlatform = process.platform === "win32" ? "windows" : process.platform
  const platformExecutable = process.platform === "win32" ? "opencode.exe" : "opencode"
  const asarMarker = `${path.sep}app.asar`
  const asarIndex = __dirname.indexOf(asarMarker)
  const resourcesFromAsar = asarIndex === -1 ? null : __dirname.slice(0, asarIndex)
  const resourceRoots = [...new Set([process.resourcesPath, resourcesFromAsar].filter(Boolean))]
  const packagedPlatformCandidates = []
  for (const resourceRoot of resourceRoots) {
    const packagedNodeModules = path.join(resourceRoot, "app.asar.unpacked", "node_modules")
    if (!fs.existsSync(packagedNodeModules)) continue
    for (const entry of fs.readdirSync(packagedNodeModules, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(`opencode-${runtimePlatform}-`)) continue
      packagedPlatformCandidates.push(path.join(packagedNodeModules, entry.name, "bin", platformExecutable))
    }
  }
  const candidates = [
    ...resourceRoots.map((resourceRoot) => path.join(resourceRoot, "app.asar.unpacked", "node_modules", `opencode-${runtimePlatform}-${process.arch}`, "bin", platformExecutable)),
    ...packagedPlatformCandidates,
    ...resourceRoots.map((resourceRoot) => path.join(resourceRoot, "app", "node_modules", `opencode-${runtimePlatform}-${process.arch}`, "bin", platformExecutable)),
    ...resourceRoots.map((resourceRoot) => path.join(resourceRoot, "app", "node_modules", "opencode-ai", "bin", wrapperExecutable)),
    path.join(__dirname, "..", "..", "node_modules", "opencode-ai", "bin", wrapperExecutable)
  ].filter(Boolean)
  const bundled = candidates.find((candidate) => fs.existsSync(candidate))
  if (bundled) return bundled
  throw new Error(`Bundled OpenCode runtime was not found. Checked: ${candidates.join(", ")}`)
}

function samePath(left, right) {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right)
  } catch {
    return path.resolve(left) === path.resolve(right)
  }
}

function sessionErrorMessage(error) {
  return error?.data?.message || error?.message || "OpenCode session failed."
}

function resolveEnvTemplate(value, env = process.env) {
  const match = typeof value === "string" && value.match(/^\{env:([^}]+)\}$/)
  return match ? env[match[1]] || "" : value || ""
}

function translationGatewayEnv(configPath, env = process.env) {
  const providers = readOpencodeConfig(configPath).config.provider || {}
  const provider = Object.values(providers)[0]
  const model = Object.keys(provider?.models || {})[0]
  const baseURL = provider?.options?.baseURL
  const apiKey = resolveEnvTemplate(provider?.options?.apiKey, env)
  return {
    ...(baseURL ? { OPENWORKING_TRANSLATION_BASE_URL: baseURL } : {}),
    ...(apiKey ? { OPENWORKING_TRANSLATION_API_KEY: apiKey } : {}),
    ...(model ? { OPENWORKING_TRANSLATION_MODEL: model } : {})
  }
}

// Directories where Node (and therefore `npx`) is commonly installed but which a GUI app launched
// from Finder/Dock never sees: launchd hands the app a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin),
// missing Homebrew, nvm, Volta, etc. Used as a fallback when the login shell can't be queried.
function commonNodeBinDirs(env = process.env) {
  const home = os.homedir()
  const dirs = ["/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".volta", "bin"), path.join(home, ".bun", "bin")]
  // nvm installs one bin dir per Node version; include them all (newest is resolved by opencode's lookup).
  const nvmVersions = path.join(home, ".nvm", "versions", "node")
  try {
    for (const entry of fs.readdirSync(nvmVersions)) {
      dirs.push(path.join(nvmVersions, entry, "bin"))
    }
  } catch {}
  return dirs.filter((dir) => {
    try {
      return fs.statSync(dir).isDirectory()
    } catch {
      return false
    }
  })
}

// The login shell's PATH (set up by ~/.zshrc, ~/.zprofile, nvm, etc.). `-ilc` runs an interactive
// login shell so version managers initialize. POSIX-only — skipped on win32. Returns [] on any failure.
function loginShellPathParts() {
  return new Promise((resolve) => {
    if (process.platform === "win32") return resolve([])
    const shell = process.env.SHELL || "/bin/zsh"
    execFile(shell, ["-ilc", "echo $PATH"], { encoding: "utf8", timeout: 4000 }, (error, stdout) => {
      if (error) return resolve([])
      resolve(String(stdout).trim().split(path.delimiter).filter(Boolean))
    })
  })
}

let cachedUserPath = null

// Builds a PATH that includes the user's real toolchain so spawned local MCP servers (e.g.
// `npx backlog-mcp-server`) resolve. Without this, a packaged macOS app inherits launchd's minimal
// PATH and opencode reports `Executable not found in $PATH: "npx"`. Cached: the login shell is
// queried at most once per app session. Pass `force` in tests to bypass the cache.
async function resolveUserPath({ force = false } = {}) {
  if (cachedUserPath && !force) return cachedUserPath
  const currentParts = (process.env.PATH || "").split(path.delimiter).filter(Boolean)
  const shellParts = await loginShellPathParts()
  const merged = [...shellParts, ...currentParts, ...commonNodeBinDirs()]
  cachedUserPath = Array.from(new Set(merged)).join(path.delimiter)
  return cachedUserPath
}

function commandModelValue(model) {
  if (typeof model === "string") return model.trim() || null
  if (model?.providerID && model?.modelID) return `${model.providerID}/${model.modelID}`
  return null
}

const MAX_DIFF_LENGTH = 200000

function projectToolMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null
  const artifacts = Array.isArray(metadata.artifacts)
    ? metadata.artifacts
      .filter((artifact) => artifact && typeof artifact.path === "string")
      .map((artifact) => ({
        path: artifact.path,
        filename: typeof artifact.filename === "string" ? artifact.filename : path.basename(artifact.path),
        mime: typeof artifact.mime === "string" ? artifact.mime : "application/octet-stream"
      }))
    : []
  const warnings = Array.isArray(metadata.warnings)
    ? metadata.warnings.filter((warning) => typeof warning === "string")
    : []
  const quality = metadata.quality === "warning" ? "warning" : "verified"

  const diffFields = {}
  if (typeof metadata.diff === "string" && metadata.diff.length) {
    if (metadata.diff.length > MAX_DIFF_LENGTH) {
      diffFields.diff = metadata.diff.slice(0, MAX_DIFF_LENGTH)
      diffFields.diffTruncated = true
    } else {
      diffFields.diff = metadata.diff
    }
    if (typeof metadata.filepath === "string" && metadata.filepath) {
      diffFields.filepath = metadata.filepath
    } else if (Array.isArray(metadata.files)) {
      const files = metadata.files.filter((file) => typeof file === "string" && file)
      if (files.length) diffFields.files = files
    }
  }

  if (!artifacts.length && !warnings.length && !diffFields.diff) return null
  return { artifacts, quality, warnings, ...diffFields }
}

function projectMessageInfo(info) {
  if (!info?.id) return null
  return {
    id: info.id,
    sessionID: info.sessionID,
    role: info.role,
    parentID: info.parentID,
    time: info.time
  }
}

function projectMessagePart(part) {
  if (!part?.id || !part.messageID) return null
  if (part.type === "text") {
    return {
      id: part.id,
      sessionID: part.sessionID,
      messageID: part.messageID,
      type: "text",
      text: part.text || "",
      ...(part.synthetic === true ? { synthetic: true } : {})
    }
  }
  if (part.type === "tool") {
    const metadata = projectToolMetadata(part.state?.metadata)
    return {
      id: part.id,
      sessionID: part.sessionID,
      messageID: part.messageID,
      type: "tool",
      tool: part.tool,
      state: {
        status: part.state?.status,
        input: part.state?.input || {},
        title: part.state?.title,
        error: part.state?.error,
        ...(metadata ? { metadata } : {})
      }
    }
  }
  if (part.type === "file") {
    return {
      id: part.id,
      sessionID: part.sessionID,
      messageID: part.messageID,
      type: "file",
      filename: part.filename,
      mime: part.mime
    }
  }
  if (part.type === "reasoning") {
    return {
      id: part.id,
      sessionID: part.sessionID,
      messageID: part.messageID,
      type: "reasoning",
      text: part.text || ""
    }
  }
  return null
}

function projectMessage(message) {
  const info = projectMessageInfo(message?.info)
  if (!info) return null
  return {
    info,
    parts: Array.isArray(message.parts) ? message.parts.map(projectMessagePart).filter(Boolean) : []
  }
}

// The question/permission ask payloads identify the pending request via `requestID`,
// but the underlying Info object may surface it as `id` — accept either.
function requestIdOf(properties) {
  const id = properties?.requestID ?? properties?.id
  return id != null ? String(id) : null
}

// OpenCode's interactive "question" tool asks the user a multiple-choice question.
// Whitelist only the display fields. The runtime may publish either a single `question`
// string or a `questions` array — normalize both into an array of question prompts.
function projectQuestionOption(option) {
  if (option == null) return null
  if (typeof option === "string") return { label: option, value: option }
  return {
    label: option.label != null ? String(option.label) : String(option.value ?? ""),
    value: option.value != null ? option.value : option.label,
    ...(option.description ? { description: String(option.description) } : {})
  }
}

function projectQuestionPrompt(prompt) {
  if (prompt == null) return null
  const text = typeof prompt === "string" ? prompt : prompt.question || prompt.prompt || prompt.label || ""
  const rawOptions = Array.isArray(prompt?.options) ? prompt.options : []
  const options = rawOptions.map(projectQuestionOption).filter(Boolean)
  return {
    question: String(text || ""),
    ...(prompt?.header ? { header: String(prompt.header) } : {}),
    ...(prompt?.multiple === true ? { multiple: true } : {}),
    ...(prompt?.optional === true ? { optional: true } : {}),
    options
  }
}

function projectQuestion(properties) {
  const source = Array.isArray(properties?.questions)
    ? properties.questions
    : properties?.question != null
      ? [properties.question]
      : []
  const questions = source.map(projectQuestionPrompt).filter(Boolean)
  return {
    ...(properties?.header ? { header: String(properties.header) } : {}),
    questions
  }
}

// Flatten a permission's `metadata` object into a small list of displayable key/value strings so
// the renderer can show what is actually being approved (e.g. which ticket, which status). Only
// primitive values are surfaced; nested objects/arrays are JSON-stringified and truncated. This
// keeps the renderer↔main boundary to whitelisted, display-only data.
function projectPermissionDetails(metadata) {
  if (!metadata || typeof metadata !== "object") return []
  const details = []
  for (const [key, value] of Object.entries(metadata)) {
    if (value == null) continue
    let text
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      text = String(value)
    } else {
      try { text = JSON.stringify(value) } catch { continue }
    }
    if (!text) continue
    details.push({ key: String(key), value: text.length > 200 ? `${text.slice(0, 200)}…` : text })
    if (details.length >= 12) break
  }
  return details
}

// OpenCode's permission subsystem asks the user to approve a tool action. Whitelist only the
// display fields needed to describe what is being requested. `permission` is the tool name
// (e.g. `backlog_update_issue`); `metadata` carries the tool call arguments we surface as details.
function projectPermission(properties) {
  const details = projectPermissionDetails(properties?.metadata)
  return {
    ...(properties?.title ? { title: String(properties.title) } : {}),
    ...(properties?.permission ? { permission: String(properties.permission) } : {}),
    ...(properties?.type ? { type: String(properties.type) } : {}),
    ...(properties?.pattern ? { pattern: String(properties.pattern) } : {}),
    ...(properties?.callID ? { callID: String(properties.callID) } : {}),
    ...(details.length ? { details } : {})
  }
}

function projectRuntimeEvent(event) {
  const properties = event?.properties || {}
  if (event?.type === "server.connected") {
    return { type: "runtime.stream.connected" }
  }
  if (event?.type === "session.status" && properties.sessionID) {
    return { type: event.type, sessionID: properties.sessionID, status: properties.status }
  }
  if (event?.type === "session.idle" && properties.sessionID) {
    return { type: event.type, sessionID: properties.sessionID }
  }
  if (event?.type === "session.aborted" && properties.sessionID) {
    return { type: event.type, sessionID: properties.sessionID }
  }
  if (event?.type === "session.error") {
    return { type: event.type, sessionID: properties.sessionID, error: sessionErrorMessage(properties.error) }
  }
  if (event?.type === "message.updated") {
    const info = projectMessageInfo(properties.info)
    if (info?.sessionID) return { type: event.type, sessionID: info.sessionID, info }
  }
  if (event?.type === "message.part.updated") {
    const part = projectMessagePart(properties.part)
    const sessionID = properties.sessionID || part?.sessionID
    if (sessionID && part) return { type: event.type, sessionID, part }
  }
  if (event?.type === "message.part.delta" && properties.sessionID && properties.messageID && properties.partID) {
    return {
      type: event.type,
      sessionID: properties.sessionID,
      messageID: properties.messageID,
      partID: properties.partID,
      field: properties.field,
      delta: properties.delta || ""
    }
  }
  if (event?.type === "question.asked") {
    const requestID = requestIdOf(properties)
    if (properties.sessionID && requestID) {
      return { type: event.type, sessionID: properties.sessionID, requestID, question: projectQuestion(properties) }
    }
  }
  if (event?.type === "question.replied" || event?.type === "question.rejected") {
    const requestID = requestIdOf(properties)
    if (properties.sessionID && requestID) return { type: event.type, sessionID: properties.sessionID, requestID }
  }
  if (event?.type === "permission.asked") {
    const requestID = requestIdOf(properties)
    if (properties.sessionID && requestID) {
      return { type: event.type, sessionID: properties.sessionID, requestID, permission: projectPermission(properties) }
    }
  }
  if (event?.type === "permission.replied") {
    const requestID = requestIdOf(properties)
    if (properties.sessionID && requestID) return { type: event.type, sessionID: properties.sessionID, requestID }
  }
  if (
    event?.type === "mcp.status.needs_auth" ||
    event?.type === "mcp.status.connected" ||
    event?.type === "mcp.status.failed" ||
    event?.type === "mcp.status.disabled"
  ) {
    const name = properties.name || properties.mcpName
    if (name) return { type: event.type, name: String(name), status: event.type.slice("mcp.status.".length) }
  }
  if (event?.type === "mcp.browser.open.failed") {
    const name = properties.mcpName || properties.name
    if (name) return { type: event.type, name: String(name), url: properties.url || "" }
  }
  return null
}

function summarizeRuntimeEvent(event) {
  const projected = projectRuntimeEvent(event)
  if (!projected) return {}
  if (projected.type === "message.part.delta") {
    return { sessionID: projected.sessionID, messageID: projected.messageID, partID: projected.partID, field: projected.field }
  }
  if (projected.type === "message.part.updated") {
    return {
      sessionID: projected.sessionID,
      messageID: projected.part.messageID,
      partID: projected.part.id,
      partType: projected.part.type,
      tool: projected.part.tool,
      status: projected.part.state?.status
    }
  }
  return projected
}

class RuntimeProcessManager {
  constructor({ userDataPath, profile, emit }) {
    this.userDataPath = userDataPath
    this.profile = profile
    this.emit = emit
    this.child = null
    this.eventAbort = null
    this.eventGeneration = 0
    this.eventReconnectTimer = null
    this.exitPromise = null
    this.resolveExit = null
    this.sessionStatuses = {}
    this.state = {
      status: "idle",
      activity: "idle",
      logs: [],
      timeline: [],
      lastError: null,
      runtime: null,
      project: null,
      activeSessionId: null
    }
  }

  snapshot() {
    return {
      ...this.state,
      activeSessionStatus: this.sessionStatuses[this.state.activeSessionId] || { type: "idle" },
      // Per-session status map so the renderer can show a "running" badge for every
      // busy session in the sidebar, not just the one currently on screen. Each entry
      // is already whitelisted to a `{ type }` shape by handleRuntimeEvent.
      sessionStatuses: { ...this.sessionStatuses },
      logs: this.state.logs.slice(-300),
      timeline: this.state.timeline.slice(-300)
    }
  }

  publish() {
    this.emit("runtime:update", this.snapshot())
  }

  log(level, message, extra = {}) {
    if (!message) return
    this.state.logs.push({ at: timestamp(), level, message: redactString(message), extra: redactValue(extra) })
    if (this.state.logs.length > 300) this.state.logs.splice(0, this.state.logs.length - 300)
    this.publish()
  }

  recordTimeline(type, payload = {}) {
    this.state.timeline.push({ at: timestamp(), type, payload: redactValue(payload) })
    if (this.state.timeline.length > 300) this.state.timeline.splice(0, this.state.timeline.length - 300)
  }

  timeline(type, payload = {}) {
    this.recordTimeline(type, payload)
    this.publish()
  }

  emitStream(event) {
    if (event) this.emit("runtime:stream", event)
  }

  auth() {
    if (!this.state.runtime?.auth) {
      throw new Error("Runtime is not ready.")
    }
    return basicAuth(this.state.runtime.auth.username, this.state.runtime.auth.password)
  }

  assertReady() {
    if (this.state.status !== "running" || !this.child || !this.state.runtime?.serverUrl) {
      throw new Error("Runtime is not running.")
    }
  }

  async start({ project }) {
    return this.openProject({ project })
  }

  async reload() {
    const project = this.state.project
    if (!this.child || !project) return this.snapshot()
    await this.stop()
    return this.openProject({ project })
  }

  async openProject({ project }) {
    if (!project?.path) {
      throw new Error("Select a project before opening the runtime.")
    }
    if (
      this.child &&
      this.state.status === "running" &&
      this.state.project?.id === project.id &&
      this.state.runtime?.cwd === project.path
    ) {
      return this.snapshot()
    }
    if (this.child) {
      await this.stop()
    }

    const port = await findFreePort()
    const configDir = this.profile?.profileDir || path.join(this.userDataPath, "opencode-profile")
    const configPath = this.profile?.configPath || defaultConfigPath(configDir)
    const runtimeDataDir = path.join(configDir, "data")
    const runtimeStateDir = path.join(configDir, "state")
    const runtimeCacheDir = path.join(configDir, "cache")
    const runtimeBin = resolveRuntimeBin()
    // `--print-logs` routes opencode's structured logs to stderr (captured into state.logs / the
    // Diagnostics panel) at its default level. Without it, opencode errors — e.g. an MCP OAuth
    // connect failure — only land in opencode's log file and surface to us as an opaque
    // "HTTP 500 UnknownError". We intentionally do NOT raise to --log-level DEBUG, which would dump
    // OAuth request bodies (secrets) into logs. The OPENWORKING_RUNTIME_ARGS override is unchanged.
    const runtimeArgs = process.env.OPENWORKING_RUNTIME_ARGS
      ? process.env.OPENWORKING_RUNTIME_ARGS.split(" ").filter(Boolean)
      : ["serve", "--port", String(port), "--hostname", "127.0.0.1", "--print-logs"]
    const password = `ow_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`
    const serverUrl = `http://127.0.0.1:${port}`
    const auth = basicAuth("opencode", password)

    this.state = {
      status: "starting",
      activity: "idle",
      logs: this.state.logs,
      timeline: this.state.timeline,
      lastError: null,
      runtime: {
        command: runtimeBin,
        args: runtimeArgs,
        cwd: project.path,
        pid: null,
        serverUrl,
        configPath,
        configDir
      },
      project,
      activeSessionId: null
    }
    this.sessionStatuses = {}
    this.publish()
    this.timeline("runtime.launch.requested", {
      command: runtimeBin,
      args: runtimeArgs,
      cwd: project.path,
      configPath,
      configDir
    })
    const userPath = await resolveUserPath()
    const env = {
      ...process.env,
      // Augment PATH with the user's real toolchain so opencode can spawn local MCP servers
      // (e.g. `npx ...`). A packaged macOS app otherwise inherits launchd's minimal PATH.
      PATH: userPath,
      OPENCODE_CONFIG: configPath,
      OPENCODE_CONFIG_DIR: configDir,
      XDG_DATA_HOME: runtimeDataDir,
      XDG_STATE_HOME: runtimeStateDir,
      XDG_CACHE_HOME: runtimeCacheDir,
      OPENCODE_SERVER_USERNAME: "opencode",
      OPENCODE_SERVER_PASSWORD: password,
      OPENWORKING_PROJECT_ID: project.id,
      OPENWORKING_PROJECT_PATH: project.path,
      ...translationGatewayEnv(configPath, process.env)
    }

    try {
      this.child = spawn(runtimeBin, runtimeArgs, {
        cwd: project.path,
        env,
        stdio: ["ignore", "pipe", "pipe"]
      })
    } catch (error) {
      this.failLaunch(error)
      throw error
    }

    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve
    })
    this.state.runtime.pid = this.child.pid
    this.log("info", "Runtime process spawned.", { pid: this.child.pid })

    this.child.stdout.on("data", (data) => {
      this.log("stdout", data.toString().trim())
    })
    this.child.stderr.on("data", (data) => {
      this.log("stderr", data.toString().trim())
    })
    this.child.on("error", (error) => {
      this.failLaunch(error)
      this.child = null
      if (this.resolveExit) this.resolveExit()
      this.resolveExit = null
      this.exitPromise = null
    })
    this.child.on("exit", (code, signal) => {
      const wasStopping = this.state.status === "stopping"
      this.child = null
      this.stopEventStream()
      this.state.status = wasStopping ? "stopped" : code === 0 ? "stopped" : "error"
      this.state.activity = "idle"
      this.state.lastError = code === 0 || wasStopping
        ? null
        : `Runtime exited with code ${code ?? "null"} signal ${signal ?? "null"}`
      this.timeline("runtime.exited", { code, signal })
      this.publish()
      if (this.resolveExit) this.resolveExit()
      this.resolveExit = null
      this.exitPromise = null
    })

    await this.waitForHealth(serverUrl, auth)
    this.state.status = "running"
    this.state.runtime.auth = { username: "opencode", password }
    this.timeline("runtime.running", { serverUrl })
    this.publish()
    this.startEventStream(serverUrl, auth)
    return this.snapshot()
  }

  async stop() {
    this.stopEventStream()
    if (!this.child) {
      this.state.status = "stopped"
      this.state.activity = "idle"
      this.publish()
      return this.snapshot()
    }
    const child = this.child
    const exitPromise = this.exitPromise
    this.state.status = "stopping"
    this.publish()
    this.timeline("runtime.stop.requested")
    child.kill("SIGTERM")
    const forceKill = setTimeout(() => {
      if (this.child === child) child.kill("SIGKILL")
    }, 5000)
    forceKill.unref()
    if (exitPromise) await exitPromise
    clearTimeout(forceKill)
    return this.snapshot()
  }

  async listSessions() {
    this.assertReady()
    const sessions = await requestJson({
      url: `${this.state.runtime.serverUrl}/session`,
      auth: this.auth()
    })
    if (!Array.isArray(sessions)) return []
    return sessions.filter((session) => !session.directory || samePath(session.directory, this.state.runtime.cwd))
  }

  async listCommands() {
    this.assertReady()
    const commands = await requestJson({
      url: `${this.state.runtime.serverUrl}/command`,
      auth: this.auth()
    })
    if (!Array.isArray(commands)) return []
    return commands.map((command) => ({
      name: command.name,
      description: command.description,
      source: command.source,
      agent: command.agent,
      model: command.model,
      hints: Array.isArray(command.hints) ? command.hints : []
    }))
  }

  async listMcpStatus() {
    this.assertReady()
    const result = await requestJson({
      url: `${this.state.runtime.serverUrl}/mcp`,
      auth: this.auth()
    })
    // The runtime returns a map of name -> { status, error? }. opencode's connect path records the
    // real failure reason in `error` (the WARN log only prints the status), so we surface it here —
    // this is how the actual cause of a `failed`/`needs_client_registration` server reaches the UI.
    if (!result || typeof result !== "object") return []
    const entries = Array.isArray(result) ? result : Object.entries(result)
    return entries
      .map((entry) => {
        const [name, info] = Array.isArray(entry) ? entry : [entry?.name, entry]
        if (!name) return null
        const status = typeof info === "string" ? info : info?.status
        const error = info && typeof info === "object" && info.error ? String(info.error) : null
        return { name: String(name), status: status ? String(status) : "unknown", ...(error ? { error } : {}) }
      })
      .filter(Boolean)
  }

  // opencode collapses MCP connect/auth failures into an opaque "HTTP 500 UnknownError" with a
  // `ref`. The real cause is logged to stderr (now captured into state.logs thanks to
  // --print-logs). Pull the most recent error/warn log lines so the renderer can show the actual
  // reason on the MCP card instead of "UnknownError".
  recentRuntimeErrorText(limit = 4) {
    const lines = (this.state.logs || [])
      .filter((entry) => entry.level === "stderr" || entry.level === "error")
      .map((entry) => String(entry.message || ""))
      .filter((message) => /error|fail|unauthor|invalid|oauth|mcp|exception|panic/i.test(message))
      .slice(-limit)
    return lines.join("\n").trim()
  }

  // Wrap an MCP auth/connect HTTP call so a generic opencode 500 is enriched with the real error
  // text from the captured runtime logs.
  async mcpAuthRequest(name, path, label) {
    try {
      return await requestJson({
        url: `${this.state.runtime.serverUrl}/mcp/${encodeURIComponent(name)}${path}`,
        method: "POST",
        auth: this.auth()
      })
    } catch (error) {
      // Give opencode a moment to flush the correlated log line to stderr.
      await new Promise((resolve) => setTimeout(resolve, 150))
      const detail = this.recentRuntimeErrorText()
      this.log("error", `${label} failed for "${name}": ${error.message}${detail ? `\n${detail}` : ""}`)
      if (detail) error.message = `${error.message}\nRuntime log:\n${detail}`
      throw error
    }
  }

  async startMcpAuth(name) {
    this.assertReady()
    if (!name) throw new Error("MCP server name is required.")
    const result = await this.mcpAuthRequest(name, "/auth", "MCP start-auth")
    return {
      authorizationUrl: result?.authorizationUrl || "",
      oauthState: result?.oauthState || null
    }
  }

  async authenticateMcp(name) {
    this.assertReady()
    if (!name) throw new Error("MCP server name is required.")
    return await this.mcpAuthRequest(name, "/auth/authenticate", "MCP authenticate")
  }

  async connectMcp(name) {
    this.assertReady()
    if (!name) throw new Error("MCP server name is required.")
    return await requestJson({
      url: `${this.state.runtime.serverUrl}/mcp/${encodeURIComponent(name)}/connect`,
      method: "POST",
      auth: this.auth()
    })
  }

  async disconnectMcp(name) {
    this.assertReady()
    if (!name) throw new Error("MCP server name is required.")
    return await requestJson({
      url: `${this.state.runtime.serverUrl}/mcp/${encodeURIComponent(name)}/disconnect`,
      method: "POST",
      auth: this.auth()
    })
  }

  // Path to opencode's MCP auth store inside the app-managed profile. opencode persists MCP OAuth
  // material (tokens, dynamically-registered clientInfo, oauthState, codeVerifier) here keyed by
  // the MCP server name. NOTE: this is `mcp-auth.json` — provider/login credentials live in a
  // separate `auth.json`; we must only touch the MCP one.
  authStorePath() {
    const configDir = this.profile?.profileDir || path.join(this.userDataPath, "opencode-profile")
    return path.join(configDir, "data", "opencode", "mcp-auth.json")
  }

  // Remove a server's stale MCP OAuth entry so the next auth starts clean. A failed first attempt
  // (e.g. a dynamic registration before clientId was supplied) can leave partial clientInfo/oauthState
  // that collides with a later pre-registered-app reconnect. Only entries that look like MCP OAuth
  // entries are removed, so provider credentials sharing the name space are left untouched.
  clearMcpAuth(name) {
    const serverName = String(name || "")
    if (!serverName) throw new Error("MCP server name is required.")
    const storePath = this.authStorePath()
    if (!fs.existsSync(storePath)) return { cleared: false }
    let store
    try {
      store = JSON.parse(fs.readFileSync(storePath, "utf8"))
    } catch {
      return { cleared: false }
    }
    const entry = store && store[serverName]
    const looksLikeMcpOauth = entry && typeof entry === "object" &&
      ("tokens" in entry || "clientInfo" in entry || "oauthState" in entry || "codeVerifier" in entry)
    if (!looksLikeMcpOauth) return { cleared: false }
    delete store[serverName]
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2))
    this.log("info", `Cleared stored MCP OAuth credentials for "${serverName}".`)
    return { cleared: true }
  }

  async createSession({ title } = {}) {
    this.assertReady()
    const session = await requestJson({
      url: `${this.state.runtime.serverUrl}/session`,
      method: "POST",
      auth: this.auth(),
      body: title ? { title } : {}
    })
    this.state.activeSessionId = session?.id || null
    this.timeline("session.created", { sessionId: this.state.activeSessionId })
    return session
  }

  async renameSession({ sessionId, title }) {
    this.assertReady()
    const nextTitle = String(title || "").trim()
    if (!sessionId) throw new Error("Select a session before renaming it.")
    if (!nextTitle) throw new Error("Session title is required.")
    this.timeline("session.rename.requested", { sessionId })
    try {
      const session = await requestJson({
        url: `${this.state.runtime.serverUrl}/session/${encodeURIComponent(sessionId)}`,
        method: "PATCH",
        auth: this.auth(),
        body: { title: nextTitle }
      })
      this.timeline("session.rename.completed", { sessionId })
      this.publish()
      return session
    } catch (error) {
      this.log("error", `Rename failed: ${error.message}`)
      this.timeline("session.rename.error", { sessionId, error: error.message })
      throw error
    }
  }

  async listMessages({ sessionId, limit = 100 }) {
    this.assertReady()
    if (!sessionId) return []
    const messages = await requestJson({
      url: `${this.state.runtime.serverUrl}/session/${encodeURIComponent(sessionId)}/message?limit=${limit}`,
      auth: this.auth()
    })
    return Array.isArray(messages) ? messages.map(projectMessage).filter(Boolean) : []
  }

  async sendPrompt({ sessionId, prompt, attachments = [], agent, model }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select or create a session before sending a prompt.")
    if (!String(prompt || "").trim()) throw new Error("Prompt is required.")
    const body = {
      parts: buildPromptParts({ prompt, attachments }),
      ...(agent ? { agent } : {}),
      ...(model?.providerID && model?.modelID ? { model } : {})
    }
    this.state.activeSessionId = sessionId
    this.state.activity = "running"
    this.sessionStatuses[sessionId] = { type: "busy" }
    this.emitStream({ type: "session.status", sessionID: sessionId, status: { type: "busy" } })
    this.timeline("session.prompt.sent", { sessionId, agent, model, attachmentCount: attachments.length })
    const startTime = Date.now()
    this.log("info", `[Prompt] Sending prompt to runtime session ${sessionId} (${agent || "default agent"})...`)
    try {
      const result = await requestJson({
        url: `${this.state.runtime.serverUrl}/session/${encodeURIComponent(sessionId)}/prompt_async`,
        method: "POST",
        auth: this.auth(),
        body
      })
      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      this.log("info", `[Prompt] Prompt accepted by session in ${duration}s.`)
      return result
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      this.state.activity = "idle"
      this.sessionStatuses[sessionId] = { type: "idle" }
      this.emitStream({ type: "session.error", sessionID: sessionId, error: error.message })
      this.log("error", `[Prompt] Prompt failed after ${duration}s: ${error.message}`)
      this.timeline("session.prompt.error", { sessionId, error: error.message })
      throw error
    }
  }

  async sendCommand({ sessionId, command, arguments: args = "", agent, model }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select or create a session before running a command.")
    if (!String(command || "").trim()) throw new Error("Command is required.")
    const commandModel = commandModelValue(model)
    const body = {
      command: String(command).trim(),
      arguments: String(args ?? ""),
      ...(agent ? { agent } : {}),
      ...(commandModel ? { model: commandModel } : {})
    }
    this.state.activeSessionId = sessionId
    this.state.activity = "running"
    this.sessionStatuses[sessionId] = { type: "busy" }
    this.emitStream({ type: "session.status", sessionID: sessionId, status: { type: "busy" } })
    this.timeline("session.command.sent", { sessionId, command: body.command, agent, model })
    const startTime = Date.now()
    this.log("info", `[Command] Dispatching command: /${body.command} to session ${sessionId}...`)
    try {
      const result = await requestJson({
        url: `${this.state.runtime.serverUrl}/session/${encodeURIComponent(sessionId)}/command`,
        method: "POST",
        auth: this.auth(),
        body
      })
      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      this.log("info", `[Command] Command accepted in ${duration}s.`)
      return result
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      this.state.activity = "idle"
      this.sessionStatuses[sessionId] = { type: "idle" }
      this.emitStream({ type: "session.error", sessionID: sessionId, error: error.message })
      this.log("error", `[Command] Command failed after ${duration}s: ${error.message}`)
      this.timeline("session.command.error", { sessionId, command: body.command, error: error.message })
      throw error
    }
  }

  async abortSession({ sessionId }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before stopping a response.")
    this.timeline("session.abort.requested", { sessionId })
    try {
      const result = await requestJson({
        url: `${this.state.runtime.serverUrl}/session/${encodeURIComponent(sessionId)}/abort`,
        method: "POST",
        auth: this.auth()
      })
      this.sessionStatuses[sessionId] = { type: "idle" }
      if (sessionId === this.state.activeSessionId) this.state.activity = "idle"
      this.emitStream({ type: "session.aborted", sessionID: sessionId })
      this.timeline("session.abort.completed", { sessionId })
      this.publish()
      return result
    } catch (error) {
      this.log("error", `Abort failed: ${error.message}`)
      this.timeline("session.abort.error", { sessionId, error: error.message })
      throw error
    }
  }

  async deleteSession({ sessionId }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before deleting it.")
    this.timeline("session.delete.requested", { sessionId })
    try {
      await requestJson({
        url: `${this.state.runtime.serverUrl}/session/${encodeURIComponent(sessionId)}`,
        method: "DELETE",
        auth: this.auth()
      })
      delete this.sessionStatuses[sessionId]
      if (sessionId === this.state.activeSessionId) {
        this.state.activeSessionId = null
        this.state.activity = "idle"
      }
      this.timeline("session.delete.completed", { sessionId })
      this.publish()
      return true
    } catch (error) {
      this.log("error", `Delete failed: ${error.message}`)
      this.timeline("session.delete.error", { sessionId, error: error.message })
      throw error
    }
  }

  // Reply to a pending question.asked request. `answers` is an array (one entry per
  // question prompt) of arrays of selected option values; an "Other" free-text answer is
  // carried as the typed string inside the inner array.
  async answerQuestion({ sessionId, requestID, answers }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before answering a question.")
    if (!requestID) throw new Error("Missing question request id.")
    this.timeline("session.question.reply", { sessionId, requestID })
    try {
      return await requestJson({
        url: `${this.state.runtime.serverUrl}/question/${encodeURIComponent(requestID)}/reply`,
        method: "POST",
        auth: this.auth(),
        body: { answers: Array.isArray(answers) ? answers : [] }
      })
    } catch (error) {
      this.log("error", `Question reply failed: ${error.message}`)
      this.timeline("session.question.reply.error", { sessionId, requestID, error: error.message })
      throw error
    }
  }

  async rejectQuestion({ sessionId, requestID }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before dismissing a question.")
    if (!requestID) throw new Error("Missing question request id.")
    this.timeline("session.question.reject", { sessionId, requestID })
    try {
      return await requestJson({
        url: `${this.state.runtime.serverUrl}/question/${encodeURIComponent(requestID)}/reject`,
        method: "POST",
        auth: this.auth()
      })
    } catch (error) {
      this.log("error", `Question reject failed: ${error.message}`)
      this.timeline("session.question.reject.error", { sessionId, requestID, error: error.message })
      throw error
    }
  }

  // Reply to a pending permission.asked request. `reply` is one of "once" | "always" |
  // "reject"; `message` is an optional reason carried with a rejection.
  async replyPermission({ sessionId, requestID, reply, message }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before responding to a permission request.")
    if (!requestID) throw new Error("Missing permission request id.")
    if (!["once", "always", "reject"].includes(reply)) throw new Error(`Invalid permission reply: ${reply}`)
    this.timeline("session.permission.reply", { sessionId, requestID, reply })
    try {
      return await requestJson({
        url: `${this.state.runtime.serverUrl}/permission/${encodeURIComponent(requestID)}/reply`,
        method: "POST",
        auth: this.auth(),
        body: { reply, ...(message ? { message: String(message) } : {}) }
      })
    } catch (error) {
      this.log("error", `Permission reply failed: ${error.message}`)
      this.timeline("session.permission.reply.error", { sessionId, requestID, error: error.message })
      throw error
    }
  }

  async waitForHealth(serverUrl, auth) {
    const startedAt = Date.now()
    let lastError = null
    while (Date.now() - startedAt < 15000) {
      if (this.state.status === "error") {
        throw new Error(this.state.lastError || "Runtime failed during startup.")
      }
      if (!this.child) {
        throw new Error(this.state.lastError || "Runtime process exited before health check completed.")
      }
      try {
        await requestJson({ url: `${serverUrl}/global/health`, auth })
        return
      } catch (error) {
        lastError = error
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
    }
    const error = new Error(`Runtime did not become healthy: ${lastError?.message || "timeout"}`)
    this.failLaunch(error)
    throw error
  }

  startEventStream(serverUrl, auth) {
    this.stopEventStream()
    this.connectEvents(serverUrl, auth, this.eventGeneration)
  }

  stopEventStream() {
    this.eventGeneration += 1
    if (this.eventAbort) {
      this.eventAbort.abort()
      this.eventAbort = null
    }
    if (this.eventReconnectTimer) {
      clearTimeout(this.eventReconnectTimer)
      this.eventReconnectTimer = null
    }
  }

  scheduleEventReconnect(serverUrl, auth, generation) {
    if (!this.child || this.state.status !== "running" || generation !== this.eventGeneration) return
    if (this.eventReconnectTimer) return
    this.eventReconnectTimer = setTimeout(() => {
      this.eventReconnectTimer = null
      this.connectEvents(serverUrl, auth, generation)
    }, 350)
    this.eventReconnectTimer.unref?.()
  }

  async connectEvents(serverUrl, auth, generation = this.eventGeneration) {
    if (!global.fetch) return
    if (!this.child || this.state.status !== "running" || generation !== this.eventGeneration) return
    const controller = new AbortController()
    this.eventAbort = controller
    try {
      const response = await fetch(`${serverUrl}/event`, {
        headers: { Authorization: auth },
        signal: controller.signal
      })
      if (!response.ok || !response.body) {
        throw new Error(`Runtime event stream returned HTTP ${response.status}.`)
      }
      this.emitStream({ type: "runtime.stream.connected" })
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (this.child && !controller.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split("\n\n")
        buffer = chunks.pop() || ""
        for (const chunk of chunks) {
          const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"))
          if (!dataLine) continue
          try {
            const event = JSON.parse(dataLine.slice(5).trim())
            this.handleRuntimeEvent(event)
          } catch {
            this.timeline("opencode.event.raw", { raw: dataLine.slice(5).trim() })
          }
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        this.log("warn", "Runtime event stream disconnected.", { error: error.message })
      }
    } finally {
      if (this.eventAbort === controller) this.eventAbort = null
      if (!controller.signal.aborted) this.scheduleEventReconnect(serverUrl, auth, generation)
    }
  }

  handleRuntimeEvent(event) {
    const properties = event.properties || {}
    // TEMP DEBUG (remove): dump raw opencode events to stderr when enabled. Lets us
    // see whether the runtime emits incremental message.part.delta for text/reasoning.
    if (process.env.OPENWORKING_DEBUG_EVENTS === "1") {
      const p = properties
      const summary = {
        type: event.type,
        partType: p.part?.type,
        partId: p.part?.id,
        field: p.field,
        deltaLen: typeof p.delta === "string" ? p.delta.length : undefined,
        deltaPreview: typeof p.delta === "string" ? p.delta.slice(0, 24) : undefined,
        textLen: typeof p.part?.text === "string" ? p.part.text.length : undefined,
        textFull: typeof p.part?.text === "string" && p.part.text.length <= 200 ? p.part.text : undefined,
        textTail: typeof p.part?.text === "string" && p.part.text.length > 200 ? p.part.text.slice(-60) : undefined,
        deltaFull: typeof p.delta === "string" ? p.delta : undefined,
        partKeys: p.part && p.part.type && !["text", "tool", "file", "reasoning", "error"].includes(p.part.type)
          ? JSON.stringify(p.part).slice(0, 300)
          : undefined
      }
      process.stderr.write(`[OW-EVENT] ${JSON.stringify(summary)}\n`)
    }
    let publish = false
    if (event.type === "session.status" && properties.sessionID) {
      this.sessionStatuses[properties.sessionID] = properties.status || { type: "idle" }
      if (properties.sessionID === this.state.activeSessionId) {
        this.state.activity = properties.status?.type === "idle" ? "idle" : "running"
        publish = true
      }
    }
    if (event.type === "session.idle" && properties.sessionID) {
      this.sessionStatuses[properties.sessionID] = { type: "idle" }
      if (properties.sessionID === this.state.activeSessionId) {
        this.state.activity = "idle"
        publish = true
      }
    }
    if (event.type === "session.error") {
      if (properties.sessionID) this.sessionStatuses[properties.sessionID] = { type: "idle" }
      if (!properties.sessionID || properties.sessionID === this.state.activeSessionId) {
        this.state.activity = "idle"
        this.state.lastError = sessionErrorMessage(properties.error)
        publish = true
      }
    }
    // Debug tool steps in the Runtime diagnostics logs
    if (event.type === "message.part.updated" && properties.part?.type === "tool") {
      const toolName = properties.part.tool
      const toolStatus = properties.part.state?.status
      const toolError = properties.part.state?.error
      if (toolStatus === "running") {
        this.log("info", `[Tool] Agent started calling tool: ${toolName}`)
      } else if (toolStatus === "complete" || toolStatus === "completed") {
        this.log("info", `[Tool] Tool ${toolName} completed successfully.`)
      } else if (toolStatus === "error") {
        this.log("warn", `[Tool] Tool ${toolName} failed: ${toolError || "Unknown error"}`)
      }
    }
    this.emitStream(projectRuntimeEvent(event))
    this.recordTimeline(event.type || "opencode.event", summarizeRuntimeEvent(event))
    if (publish) this.publish()
  }

  failLaunch(error) {
    this.state.status = "error"
    this.state.activity = "idle"
    this.state.lastError = error.message
    this.log("error", error.message)
    this.timeline("runtime.error", { error: error.message })
    this.publish()
  }
}

module.exports = {
  RuntimeProcessManager,
  buildPromptParts,
  findFreePort,
  projectMessagePart,
  projectRuntimeEvent,
  projectQuestion,
  projectPermission,
  projectToolMetadata,
  requestJson,
  resolveRuntimeBin,
  resolveUserPath,
  translationGatewayEnv
}
