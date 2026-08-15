const { spawn, execFile } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const http = require("node:http")
const net = require("node:net")
const path = require("node:path")
const { fileURLToPath } = require("node:url")
const WebSocket = require("ws")
const { defaultConfigPath, readOpencodeConfig } = require("../opencode-config")
const { filePermissionHint: filePermissionHintText } = require("../error-hints")
const { runtimeXdgConfigHome } = require("../opencode-profile")
const { officeAttachmentContext } = require("../office-attachment-context")
const { ZIP_MIME, zipAttachmentContext } = require("../zip-attachment-context")
const { ensureRuntimeDbSchema } = require("./db-schema")
const { RUNTIME_MAJOR_V2, eventPayload, responseData, runtimeContract } = require("./runtime-contract")
const { SubagentRunTreeTracker } = require("./subagent-run-tree")

// Wire contract in force for this process. The app ships OpenCode v2 only.
// `OPENWORKING_RUNTIME_MAJOR` remains as a troubleshooting escape hatch (and is used by the v1
// regression suite); an unknown value throws rather than falling back, because sending the wrong
// URLs at a server fails as a silently blank thread instead of a loud error.
const CONTRACT = runtimeContract(process.env.OPENWORKING_RUNTIME_MAJOR || RUNTIME_MAJOR_V2)
const ENDPOINTS = CONTRACT.endpoints
const EVENTS = CONTRACT.events

const RUNTIME_REQUEST_TIMEOUT_MS = 15_000
// The /command endpoint is synchronous — it blocks until the model turn completes, unlike
// /prompt which returns immediately. A cold first run (model/agent warm-up + skill expansion)
// routinely exceeds RUNTIME_REQUEST_TIMEOUT_MS, so give command dispatch a generous timeout
// instead of failing the very first command.
const RUNTIME_COMMAND_TIMEOUT_MS = 120_000
const HEALTH_REQUEST_TIMEOUT_MS = 1_000
const MCP_AUTH_REQUEST_TIMEOUT_MS = 120_000

// Server-enforced ceiling on the message endpoint's `limit`. v2 rejects anything larger with
// `HTTP 400 InvalidRequestError ("Expected a value less than or equal to 200, got …")`, so this is
// a hard protocol limit, not a tuning knob — raising it breaks session export outright.
const EXPORT_PAGE_LIMIT = 200

// Document formats the model/gateway should translate through the bundled
// managed translation tools by local path instead of ingesting as a raw `file` part.
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
// local-path lines in the text so the direct translation tools can use them as `inputPath`.
function buildPromptParts({ prompt, attachments = [] }) {
  const documentPaths = []
  const officeContexts = []
  const localPaths = []
  const fileParts = []
  for (const attachment of attachments) {
    // The office/markdown/octet-stream heuristics below all key off a known mime or a real local
    // path — genuine V2 external attachments ({uri, name, description}, no mime, no `file:` url)
    // carry neither, so they skip straight to the generic file part below instead of risking a
    // filename-extension coincidence (e.g. an external "notes.md") routing them into the
    // local-path text branch as if they were a real file on this machine.
    const hasLocalContext = Boolean(attachment.mime) || (typeof attachment.url === "string" && attachment.url.startsWith("file:"))
    if (hasLocalContext) {
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
    }
    fileParts.push({
      type: "file",
      url: attachment.url,
      filename: attachment.filename,
      ...(attachment.mime ? { mime: attachment.mime } : {}),
      ...(attachment.description ? { description: attachment.description } : {})
    })
  }
  const base = String(prompt).trim()
  const sections = [base]
  if (documentPaths.length) {
    sections.push(
      "Attached document files are provided as local paths plus extracted text context when available because the configured gateway accepts text/images, not raw document binaries.",
      "For PDF, DOCX, Markdown, or .markdown translation, call translate_document with the exact local inputPath. For PPTX or XLSX translation, call translate_office_document with the exact local inputPath. Do not use shell/write scripts for translation artifacts. For XLSX, omit mode or use newfile unless the user explicitly requests modifying the same workbook; if overwrite intent is ambiguous, ask before using inplace. After an Office translation, use the pptx or xlsx skill to validate the returned artifact. Do not claim an output path unless it is returned in the selected tool's metadata.artifacts.",
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

// v1 accepts `{ parts: [...] }`. v2 requires `{ text }` and carries binaries in a separate
// `files` array — verified: posting v1's `parts` returns HTTP 400 `Missing key at ["text"]`.
// buildPromptParts stays the single source of prompt composition; this only reshapes its output.
function buildPromptBody({ inputId, prompt, attachments = [], agents, metadata, delivery, resume }) {
  const parts = buildPromptParts({ prompt, attachments })
  if (CONTRACT.promptBodyKey === "parts") return { parts }
  const text = parts
    .filter((part) => part?.type === "text")
    .map((part) => part.text)
    .join("\n\n")
  const files = parts
    .filter((part) => part?.type === "file")
    .map((part) => ({
      uri: part.url,
      ...(part.filename ? { name: part.filename } : {}),
      // External attachments carry a real description; local attachments fall back to mime, as before.
      ...(part.description ? { description: part.description } : part.mime ? { description: part.mime } : {})
    }))
  return {
    ...(inputId ? { id: inputId } : {}),
    text,
    ...(files.length ? { files } : {}),
    ...(Array.isArray(agents) && agents.length ? { agents } : {}),
    ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { metadata } : {}),
    ...(["steer", "queue"].includes(delivery) ? { delivery } : {}),
    ...(typeof resume === "boolean" ? { resume } : {})
  }
}

function buildCommandBody({ inputId, command, arguments: args = "", delivery, resume }) {
  return {
    ...(inputId ? { id: inputId } : {}),
    command: String(command).trim(),
    arguments: String(args ?? ""),
    ...(["steer", "queue"].includes(delivery) ? { delivery } : {}),
    ...(typeof resume === "boolean" ? { resume } : {})
  }
}

function buildSkillBody({ skill, resume }) {
  return {
    skill: String(skill).trim(),
    ...(typeof resume === "boolean" ? { resume } : {})
  }
}

// True for a V2 external attachment ({uri, name, description}, no local file backing it) — as
// opposed to attachmentRegistry-resolved attachments, which always carry a `file:` URL.
function isExternalAttachment(attachment) {
  return typeof attachment?.url === "string" && !attachment.url.startsWith("file:")
}

function synthesizeAttachment(attachment) {
  if (isExternalAttachment(attachment)) return attachment
  const localPath = attachmentLocalPath(attachment)
  const extension = path.extname(localPath || attachment.filename || "").toLowerCase()
  const isZip = attachment.mime === ZIP_MIME || extension === ".zip"
  if (!isZip) return attachment
  const generated = zipAttachmentContext({
    filePath: localPath,
    filename: attachment.filename,
    mime: attachment.mime
  })
  return {
    ...attachment,
    localPath: generated.filePath,
    filename: generated.filename,
    mime: generated.mime,
    cleanupPaths: generated.cleanupPaths,
    metadata: generated.metadata
  }
}

function preparePromptAttachments(attachments = [], cleanupPaths = []) {
  const preparedAttachments = []
  for (const attachment of attachments) {
    const prepared = synthesizeAttachment(attachment)
    preparedAttachments.push(prepared)
    for (const cleanupPath of prepared.cleanupPaths || []) {
      if (cleanupPath && !cleanupPaths.includes(cleanupPath)) cleanupPaths.push(cleanupPath)
    }
  }
  return preparedAttachments
}

function cleanupGeneratedAttachments(cleanupPaths = []) {
  for (const cleanupPath of [...new Set(cleanupPaths)].sort((left, right) => right.length - left.length)) {
    try {
      fs.rmSync(cleanupPath, { recursive: true, force: true })
    } catch {}
  }
}

function attachmentLocalPath(attachment) {
  if (typeof attachment.localPath === "string" && attachment.localPath) return attachment.localPath
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

function requestJson({ url, method = "GET", body, auth, timeoutMs = RUNTIME_REQUEST_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const payload = body === undefined ? null : JSON.stringify(body)
    let timeoutHandle = null
    let settled = false
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      callback(value)
    }
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
            settle(reject, new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 500)}`))
            return
          }
          if (!raw) {
            settle(resolve, null)
            return
          }
          try {
            settle(resolve, JSON.parse(raw))
          } catch {
            settle(resolve, raw)
          }
        })
      }
    )
    if (!settled && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        const error = new Error(`Runtime request timed out (${method} ${parsed.pathname})`)
        settle(reject, error)
        if (typeof req.destroy === "function") req.destroy()
      }, timeoutMs)
    }
    req.on("error", (error) => settle(reject, error))
    if (payload) req.write(payload)
    req.end()
  })
}

// Like requestJson, but for endpoints that answer `application/octet-stream` (fsRead) rather than
// JSON. Aborts once `maxBytes` is exceeded instead of buffering an arbitrarily large file.
function requestBuffer({ url, auth, maxBytes, timeoutMs = RUNTIME_REQUEST_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    let timeoutHandle = null
    let settled = false
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      callback(value)
    }
    const req = http.request(
      { hostname: parsed.hostname, port: parsed.port, path: `${parsed.pathname}${parsed.search}`, method: "GET", headers: { ...(auth ? { Authorization: auth } : {}) } },
      (res) => {
        const chunks = []
        let received = 0
        let truncated = false
        res.on("data", (chunk) => {
          if (truncated) return
          received += chunk.length
          if (Number.isFinite(maxBytes) && received > maxBytes) {
            truncated = true
            res.destroy()
            return
          }
          chunks.push(chunk)
        })
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            settle(reject, new Error(`HTTP ${res.statusCode}`))
            return
          }
          settle(resolve, { buffer: Buffer.concat(chunks), truncated })
        })
        res.on("close", () => {
          if (truncated) settle(resolve, { buffer: Buffer.concat(chunks), truncated })
        })
      }
    )
    if (!settled && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        const error = new Error(`Runtime request timed out (GET ${parsed.pathname})`)
        settle(reject, error)
        if (typeof req.destroy === "function") req.destroy()
      }, timeoutMs)
    }
    req.on("error", (error) => settle(reject, error))
    req.end()
  })
}

async function requestSseJson({ url, auth, timeoutMs = RUNTIME_REQUEST_TIMEOUT_MS }) {
  if (!global.fetch) throw new Error("Runtime event-log reads require fetch.")
  const controller = new AbortController()
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort(new Error("Runtime event-log request timed out.")), timeoutMs)
    : null
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/event-stream",
        ...(auth ? { Authorization: auth } : {})
      },
      signal: controller.signal
    })
    if (!response.ok || !response.body) {
      throw new Error(`Runtime event-log request returned HTTP ${response.status}.`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const items = []
    let buffer = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split(/\r?\n\r?\n/)
      buffer = chunks.pop() || ""
      for (const chunk of chunks) {
        const dataLine = chunk.split(/\r?\n/).find((line) => line.startsWith("data:"))
        if (!dataLine) continue
        items.push(JSON.parse(dataLine.slice(5).trim()))
      }
    }
    buffer += decoder.decode()
    const dataLine = buffer.split(/\r?\n/).find((line) => line.startsWith("data:"))
    if (dataLine) items.push(JSON.parse(dataLine.slice(5).trim()))
    return items
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function sessionListItems(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.data)) return payload.data
  return []
}

function sidebarSessions(sessions) {
  return sessionListItems(sessions).filter((session) => (
    (!session?.parentID && !session?.parentSessionId) || Boolean(session?.fork)
  ))
}

// v1 exposes the session's project directory as `session.directory`; v2 nests it as
// `session.location.directory`. Read both so session filtering works on either runtime.
function sessionDirectory(session) {
  return session?.directory || session?.location?.directory || ""
}

// Normalize a session before it crosses the IPC boundary. Sessions were previously forwarded raw,
// which broke the sidebar on v2: the renderer groups by `session.directory`, and v2 moved that
// field under `location`, so every directory-scoped list filtered down to nothing and each project
// rendered "No chats". Flattening here (rather than in the renderer) keeps the projection boundary
// the event path already maintains, and fixes every consumer at once — several other call sites
// also read `session.directory` directly.
function projectSession(session) {
  if (!session || typeof session !== "object") return session
  const directory = sessionDirectory(session)
  const projected = { ...session, ...(directory ? { directory } : {}) }
  if (session.model) projected.model = normalizeModelRef(session.model)
  if (session.revert) projected.revert = projectSessionRevert(session.revert)
  return projected
}

// True when `payload` is one of the two shapes catalogItems() can actually read. Callers that
// treat an empty result as authoritative (rather than merely "nothing to show") must check this
// first, because catalogItems() cannot distinguish a real empty list from a body it did not
// understand — both come back as `[]`.
function isCatalogPayload(payload) {
  if (Array.isArray(payload)) return true
  return Boolean(payload && typeof payload === "object" && Array.isArray(payload.data))
}

function catalogItems(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === "object" && Array.isArray(payload.data)) return payload.data
  return []
}

function normalizeModelRef(model) {
  if (!model || typeof model !== "object") return null
  const providerID = String(model.providerID || "").trim()
  const id = String(model.id || model.modelID || "").trim()
  if (!providerID || !id) return null
  const variant = String(model.variant || "").trim()
  return { providerID, id, ...(variant ? { variant } : {}) }
}

function projectSessionRevert(revert) {
  if (!revert || typeof revert !== "object" || !revert.messageID) return null
  const files = Array.isArray(revert.files)
    ? revert.files
      .filter((file) => file && typeof file.file === "string")
      .map((file) => ({
        file: file.file,
        status: file.status,
        additions: Number(file.additions) || 0,
        deletions: Number(file.deletions) || 0
      }))
    : []
  return {
    messageID: revert.messageID,
    ...(revert.partID ? { partID: revert.partID } : {}),
    ...(files.length ? { files } : {})
  }
}

function projectPendingInput(input) {
  if (!input || typeof input !== "object") return null
  const id = String(input.id || "").trim()
  const sessionID = String(input.sessionID || "").trim()
  const type = String(input.type || "").trim()
  const admittedSeq = Number(input.admittedSeq)
  if (!id || !sessionID || !["user", "synthetic", "compaction"].includes(type)) return null
  const projected = {
    id,
    sessionID,
    type,
    ...(Number.isFinite(admittedSeq) && admittedSeq >= 0 ? { admittedSeq } : {}),
    ...(Number.isFinite(Number(input.timeCreated)) && Number(input.timeCreated) >= 0
      ? { timeCreated: Number(input.timeCreated) }
      : {})
  }
  if (type === "compaction") return projected
  const delivery = ["queue", "steer"].includes(input.delivery) ? input.delivery : null
  if (delivery) projected.delivery = delivery
  if (type !== "user") return projected
  const data = input.data && typeof input.data === "object" ? input.data : {}
  projected.text = String(data.text || "")
  const files = Array.isArray(data.files)
    ? data.files
      .filter((file) => file && typeof file === "object")
      .map((file) => ({
        ...(file.name ? { name: String(file.name) } : {}),
        ...(file.description ? { description: String(file.description) } : {})
      }))
    : []
  if (files.length) projected.files = files
  return projected
}

function projectAdmittedInput(properties, event) {
  const input = properties?.input
  if (!input || !properties?.inputID || !properties?.sessionID) return null
  return projectPendingInput({
    ...input,
    id: properties.inputID,
    sessionID: properties.sessionID,
    admittedSeq: event?.durable?.seq,
    timeCreated: event?.created
  })
}

function execFileText(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", ...options }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message || "").trim()
        reject(new Error(detail || error.message))
        return
      }
      resolve(String(stdout || ""))
    })
  })
}

function isManagedCommandName(name) {
  return typeof name === "string" && /^[\w-]+$/.test(name)
}

function managedCommandPath(profileDir, name) {
  const safeName = isManagedCommandName(name) ? name : ""
  if (!profileDir || !safeName) return ""
  return path.join(profileDir, "commands", safeName)
}

function managedCommandBody(command) {
  const lines = [`/${command.name}`]
  if (command.description) lines.push("", command.description)
  if (command.agent) lines.push("", `agent: ${command.agent}`)
  if (command.model) lines.push(`model: ${command.model}`)
  if (Array.isArray(command.hints) && command.hints.length) lines.push("", `hints: ${command.hints.join(", ")}`)
  return `${lines.join("\n")}\n`
}

function syncManagedCommandFile(profileDir, command) {
  const filePath = managedCommandPath(profileDir, command?.name)
  if (!filePath || command?.source !== "command") return ""
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const body = managedCommandBody(command)
  if (!fs.existsSync(filePath) || fs.readFileSync(filePath, "utf8") !== body) {
    fs.writeFileSync(filePath, body)
  }
  return filePath
}

function syncManagedCommandFiles(profileDir, commands = []) {
  const fileMap = new Map()
  if (!profileDir) return fileMap
  const commandsDir = path.join(profileDir, "commands")
  fs.mkdirSync(commandsDir, { recursive: true })
  for (const command of commands) {
    const filePath = syncManagedCommandFile(profileDir, command)
    if (filePath) fileMap.set(command.name, filePath)
  }
  for (const entry of fs.readdirSync(commandsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !isManagedCommandName(entry.name) || fileMap.has(entry.name)) continue
    fs.rmSync(path.join(commandsDir, entry.name), { force: true })
  }
  return fileMap
}

const SKILL_PATH_FAMILIES = [
  { family: "repo_agents", relativePrefix: ".agents/skills/", homeSegments: [".agents", "skills"] },
  { family: "repo_opencode", relativePrefix: ".opencode/skills/", homeSegments: [".opencode", "skills"] },
  { family: "repo_config_opencode", relativePrefix: ".config/opencode/skills/", homeSegments: [".config", "opencode", "skills"] }
]

function normalizePathLike(value) {
  return String(value || "").trim().replace(/\\/g, "/")
}

function realPathOrResolved(value) {
  try {
    return fs.realpathSync(value)
  } catch {
    return path.resolve(value)
  }
}

function homeSkillPrefix(homeSegments) {
  return normalizePathLike(path.join(os.homedir(), ...homeSegments)) + "/"
}

function repoSkillPrefix(runtimeCwd, relativePrefix) {
  if (!runtimeCwd) return ""
  return normalizePathLike(path.resolve(realPathOrResolved(runtimeCwd), relativePrefix))
}

function classifySkillPath(rawPath, runtimeCwd = "", profileDir = "") {
  const value = typeof rawPath === "string" ? rawPath.trim() : ""
  if (!value) {
    return {
      family: profileDir ? "managed_profile" : "unknown",
      path: profileDir ? path.join(profileDir, "skills") : ""
    }
  }
  const normalized = normalizePathLike(value)
  const normalizedResolved = path.isAbsolute(value) ? normalizePathLike(realPathOrResolved(value)) : normalized
  if (profileDir) {
    const managedPrefix = normalizePathLike(path.join(profileDir, "skills")) + "/"
    if (normalized.startsWith(managedPrefix) || normalizedResolved.startsWith(managedPrefix)) {
      return { family: "managed_profile", path: value }
    }
  }
  for (const candidate of SKILL_PATH_FAMILIES) {
    if (normalized.startsWith(candidate.relativePrefix)) {
      return {
        family: candidate.family,
        path: runtimeCwd ? path.resolve(runtimeCwd, value) : value
      }
    }
    const homePrefix = homeSkillPrefix(candidate.homeSegments)
    if (path.isAbsolute(value) && (normalized.startsWith(homePrefix) || normalizedResolved.startsWith(homePrefix))) {
      return {
        family: candidate.family.replace(/^repo_/, "home_"),
        path: value
      }
    }
    const repoPrefix = repoSkillPrefix(runtimeCwd, candidate.relativePrefix)
    if (repoPrefix && path.isAbsolute(value) && (normalized.startsWith(repoPrefix) || normalizedResolved.startsWith(repoPrefix))) {
      return {
        family: candidate.family,
        path: value
      }
    }
  }
  return { family: "unknown", path: value }
}

function skillCommandInfo(command, profileDir, runtimeCwd = "") {
  const rawPath = typeof command?.path === "string" ? command.path.trim() : ""
  if (rawPath) return classifySkillPath(rawPath, runtimeCwd, profileDir)
  if (!profileDir) return { family: "unknown", path: "" }
  return {
    family: "managed_profile",
    path: path.join(profileDir, "skills", command.name, "SKILL.md")
  }
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

  // The runtime ships as the scoped package `@opencode-ai/cli-<platform>-<arch>` with an
  // `opencode2` binary.
  const runtimePlatform = process.platform === "win32" ? "windows" : process.platform
  const v2PlatformExecutable = process.platform === "win32" ? "opencode2.exe" : "opencode2"
  const v2PackagePrefix = `cli-${runtimePlatform}-`
  const v2PlatformPackage = `cli-${runtimePlatform}-${process.arch}`
  const asarMarker = `${path.sep}app.asar`
  const asarIndex = __dirname.indexOf(asarMarker)
  const resourcesFromAsar = asarIndex === -1 ? null : __dirname.slice(0, asarIndex)
  const resourceRoots = [...new Set([process.resourcesPath, resourcesFromAsar].filter(Boolean))]
  // Scan unpacked node_modules for a platform package whose arch suffix we do not predict
  // (e.g. the `-baseline` / `-musl` variants upstream publishes). Scoped packages live one
  // directory deeper, under `@opencode-ai/`.
  const packagedPlatformCandidates = []
  for (const resourceRoot of resourceRoots) {
    const packagedScope = path.join(resourceRoot, "app.asar.unpacked", "node_modules", "@opencode-ai")
    if (!fs.existsSync(packagedScope)) continue
    for (const entry of fs.readdirSync(packagedScope, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(v2PackagePrefix)) continue
      packagedPlatformCandidates.push(path.join(packagedScope, entry.name, "bin", v2PlatformExecutable))
    }
  }
  const candidates = [
    ...resourceRoots.map((resourceRoot) => path.join(resourceRoot, "app.asar.unpacked", "node_modules", "@opencode-ai", v2PlatformPackage, "bin", v2PlatformExecutable)),
    ...packagedPlatformCandidates,
    ...resourceRoots.map((resourceRoot) => path.join(resourceRoot, "app", "node_modules", "@opencode-ai", v2PlatformPackage, "bin", v2PlatformExecutable)),
    path.join(__dirname, "..", "..", "node_modules", "@opencode-ai", v2PlatformPackage, "bin", v2PlatformExecutable)
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
// login shell so version managers initialize. POSIX-only — skipped on win32. A heavy ~/.zshrc
// (nvm/pyenv/etc.) can take several seconds to init, so the timeout is generous; even on a timeout
// we salvage whatever the shell already printed if it looks like a PATH. Returns [] on any failure.
function loginShellPathParts() {
  return new Promise((resolve) => {
    if (process.platform === "win32") return resolve([])
    const shell = process.env.SHELL || "/bin/zsh"
    execFile(shell, ["-ilc", "echo $PATH"], { encoding: "utf8", timeout: 10000 }, (error, stdout) => {
      const text = String(stdout || "").trim()
      // On a timeout, `error` is set but stdout may already hold the echoed PATH — keep it if so.
      if (error && !text.includes(path.delimiter)) return resolve([])
      resolve(text.split(path.delimiter).filter(Boolean))
    })
  })
}

// True when any directory on the given PATH string contains an executable `name` (e.g. "npx").
// Used to decide whether a resolved PATH is actually usable for spawning local MCP servers.
function pathHasExecutable(pathString, name) {
  for (const dir of String(pathString || "").split(path.delimiter).filter(Boolean)) {
    try {
      if (fs.statSync(path.join(dir, name)).isFile()) return true
    } catch {}
  }
  return false
}

let cachedUserPath = null

// Builds a PATH that includes the user's real toolchain so spawned local MCP servers (e.g.
// `npx backlog-mcp-server`) resolve. Without this, a packaged macOS app inherits launchd's minimal
// PATH and opencode reports `Executable not found in $PATH: "npx"`. The login shell is queried at
// most once per app session, but we only cache a PATH that actually contains `npx` — caching a
// "bad" PATH (e.g. when the login-shell query timed out and the fallbacks happened to miss) would
// lock the whole session into a broken state where toggling a connector can never recover. Pass
// `force` in tests to bypass the cache.
async function resolveUserPath({ force = false } = {}) {
  if (cachedUserPath && !force) return cachedUserPath
  const currentParts = (process.env.PATH || "").split(path.delimiter).filter(Boolean)
  const shellParts = await loginShellPathParts()
  const merged = [...shellParts, ...currentParts, ...commonNodeBinDirs()]
  const userPath = Array.from(new Set(merged)).join(path.delimiter)
  // Only memoize a usable PATH so a transient miss (slow login shell) can be retried next call.
  if (pathHasExecutable(userPath, "npx")) cachedUserPath = userPath
  return userPath
}

const MAX_DIFF_LENGTH = 200000

// Caps for the VCS Changes panel. The renderer syntax-highlights every diff line, so an
// unbounded patch (a lockfile rewrite, a vendored dump) would block its main thread; and a
// freshly cloned or mass-generated tree can report tens of thousands of changed files. Both are
// trimmed HERE, in main, because the renderer must never receive a payload it cannot survive.
const MAX_VCS_PATCH_LENGTH = MAX_DIFF_LENGTH
const MAX_VCS_STATUS_FILES = 2000

const VCS_FILE_STATUSES = new Set(["added", "deleted", "modified"])

// Whitelist projection for one Vcs.FileStatus entry. Shape verified against a live server:
// { file, status: "added"|"deleted"|"modified", additions, deletions }. Untracked files come back
// as "added". Anything without a usable file path or status is dropped rather than guessed at.
function projectVcsFileStatus(entry) {
  if (!entry || typeof entry !== "object") return null
  const file = typeof entry.file === "string" ? entry.file : ""
  if (!file) return null
  const status = VCS_FILE_STATUSES.has(entry.status) ? entry.status : "modified"
  const count = (value) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
  return { file, status, additions: count(entry.additions), deletions: count(entry.deletions) }
}

function projectVcsFileDiff(entry) {
  const status = projectVcsFileStatus(entry)
  if (!status) return null
  const patch = typeof entry.patch === "string" ? entry.patch : ""
  const truncated = patch.length > MAX_VCS_PATCH_LENGTH
  return { ...status, patch: truncated ? patch.slice(0, MAX_VCS_PATCH_LENGTH) : patch, truncated }
}

// Reference.Info (resources/opencode/schemas/opencode-config.schema.json evidence /
// .agents/evidence/v2-openapi-1.18.8-latest.json): { name, path, description, hidden, source }.
// All fields are non-sensitive catalog metadata (names/paths/descriptions the user themselves
// configured) — forwarded as-is, same allowlist discipline as the other project* functions here.
function projectReferenceInfo(reference) {
  if (!reference || typeof reference !== "object" || typeof reference.name !== "string" || !reference.name) return null
  return {
    name: reference.name,
    path: typeof reference.path === "string" ? reference.path : "",
    description: typeof reference.description === "string" ? reference.description : "",
    hidden: Boolean(reference.hidden),
    source: reference.source && typeof reference.source === "object" ? { ...reference.source } : null
  }
}

// PermissionSaved.Info (.agents/evidence/v2-openapi-0.0.0-next-16350.json): { id, projectID,
// action, resource }. Non-sensitive: the rule the user themselves approved via "Allow always".
function projectSavedPermission(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id) return null
  return {
    id: entry.id,
    projectId: typeof entry.projectID === "string" ? entry.projectID : "",
    action: typeof entry.action === "string" ? entry.action : "",
    resource: typeof entry.resource === "string" ? entry.resource : ""
  }
}

// FileSystem.Entry (.agents/evidence/v2-openapi-0.0.0-next-16350.json): { path, type }.
function projectFileSystemEntry(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.path !== "string" || !entry.path) return null
  if (entry.type !== "file" && entry.type !== "directory") return null
  return { path: entry.path, type: entry.type }
}

// Pty (.agents/evidence/v2-openapi-1.18.8-latest.json): { id, title, command, args, cwd, status,
// pid, exitCode }. All fields are non-sensitive session metadata the caller itself supplied or the
// runtime reports back — no `env` field exists on this schema, so there is nothing secret to
// accidentally forward. Same allowlist discipline as the other project* functions here.
function projectPtyInfo(pty) {
  if (!pty || typeof pty !== "object" || typeof pty.id !== "string" || !pty.id) return null
  return {
    id: pty.id,
    title: typeof pty.title === "string" ? pty.title : "",
    command: typeof pty.command === "string" ? pty.command : "",
    args: Array.isArray(pty.args) ? pty.args.filter((arg) => typeof arg === "string") : [],
    cwd: typeof pty.cwd === "string" ? pty.cwd : "",
    status: pty.status === "exited" ? "exited" : "running",
    pid: Number.isInteger(pty.pid) ? pty.pid : null,
    exitCode: Number.isInteger(pty.exitCode) ? pty.exitCode : null
  }
}

function projectToolMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null
  const subagentFields = {}
  if (typeof metadata.sessionID === "string" && metadata.sessionID) {
    subagentFields.sessionID = metadata.sessionID
    if (metadata.status === "running" || metadata.status === "completed") {
      subagentFields.status = metadata.status
    }
  }
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

  const hasDisplayMetadata = artifacts.length || warnings.length || diffFields.diff
  if (!hasDisplayMetadata && !subagentFields.sessionID) return null
  return {
    ...subagentFields,
    ...(hasDisplayMetadata ? { artifacts, quality, warnings, ...diffFields } : {})
  }
}

function projectMessageInfo(info) {
  if (!info?.id) return null
  return {
    id: info.id,
    sessionID: info.sessionID,
    role: info.role,
    parentID: info.parentID,
    time: info.time,
    tokens: info.tokens,
    cost: info.cost
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
    const toolName = part.tool || part.name
    const metadata = projectToolMetadata(part.state?.metadata)
    const rawInput = part.state?.input && typeof part.state.input === "object" && !Array.isArray(part.state.input)
      ? part.state.input
      : {}
    const input = toolName === "subagent"
      ? {
          ...(typeof rawInput.agent === "string" ? { agent: rawInput.agent } : {}),
          ...(typeof rawInput.description === "string" ? { description: rawInput.description } : {})
        }
      : rawInput
    return {
      id: part.id,
      sessionID: part.sessionID,
      messageID: part.messageID,
      type: "tool",
      tool: toolName,
      state: {
        status: part.state?.status,
        input,
        title: part.state?.title,
        ...(toolName === "subagent" ? {} : { error: part.state?.error }),
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

function toolLifecycleIdentity(properties) {
  const sessionID = typeof properties?.sessionID === "string" ? properties.sessionID : ""
  const messageID = typeof properties?.assistantMessageID === "string" ? properties.assistantMessageID : ""
  const toolID = typeof properties?.id === "string" ? properties.id : ""
  if (!sessionID || !messageID || !toolID) return null
  return {
    sessionID,
    messageID,
    id: `${messageID}:tool:${toolID}`
  }
}

function toolInput(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function toolInputFromText(text) {
  if (typeof text !== "string" || !text) return {}
  try {
    return toolInput(JSON.parse(text))
  } catch {
    return {}
  }
}

function projectToolLifecycleEvent(event, properties) {
  const identity = toolLifecycleIdentity(properties)
  if (!identity) return null
  const part = {
    id: identity.id,
    sessionID: identity.sessionID,
    messageID: identity.messageID,
    type: "tool"
  }
  let state
  if (event.type === EVENTS.sessionToolInputStarted) {
    if (typeof properties.name === "string" && properties.name) part.tool = properties.name
    state = { status: "pending", input: {} }
  } else if (event.type === EVENTS.sessionToolInputEnded) {
    state = { status: "pending", input: toolInputFromText(properties.text) }
  } else if (event.type === EVENTS.sessionToolCalled) {
    state = { status: "running", input: toolInput(properties.input) }
  } else if (event.type === EVENTS.sessionToolProgress) {
    const metadata = projectToolMetadata(properties.metadata)
    state = { status: "running", ...(metadata ? { metadata } : {}) }
  } else if (event.type === EVENTS.sessionToolSuccess) {
    const metadata = projectToolMetadata(properties.metadata)
    state = { status: "completed", ...(metadata ? { metadata } : {}) }
  } else if (event.type === EVENTS.sessionToolFailed) {
    const metadata = projectToolMetadata(properties.metadata)
    state = {
      status: "error",
      error: String(sessionErrorMessage(properties.error)),
      ...(metadata ? { metadata } : {})
    }
  } else {
    return null
  }
  return {
    type: "message.part.updated",
    sessionID: identity.sessionID,
    part: { ...part, state }
  }
}

// v1 returns `{ info: {...}, parts: [...] }`. v2 returns a FLAT message using `content[]`, with
// no `info` wrapper and `role` renamed to `type` — verified against a live server:
//   { id, time, type:"assistant", agent, model, content:[{type:"text",text:"…"}], finish, tokens }
// The SSE stream is unaffected (message.part.updated still carries a v1-shaped part), so only
// this REST envelope needs normalizing before the existing projection runs.
function normalizeMessageEnvelope(message) {
  if (!message || typeof message !== "object") return null
  if (message.info || Array.isArray(message.parts)) return message
  const contentKey = CONTRACT.messageContentKey
  const messageID = message.id
  const sessionID = message.sessionID || message.info?.sessionID
  // Only assistant messages carry `content[]`. A v2 user message has no content key at all — its
  // body is a bare `text` string — so without this it would normalize to zero parts, fail to match
  // the optimistic bubble on rehydrate, and render the user's turn twice.
  const content = Array.isArray(message[contentKey])
    ? [...message[contentKey]]
    : typeof message.text === "string" && message.text
      ? [{ type: "text", text: message.text }]
      : []
  if ((message.role || message.type) === "user" && Array.isArray(message.files)) {
    for (const file of message.files) {
      if (!file || typeof file !== "object") continue
      content.push({
        type: "file",
        filename: file.name || file.description || "Attachment",
        mime: file.mime || "application/octet-stream"
      })
    }
  }
  return {
    info: {
      id: messageID,
      sessionID,
      role: message.role || message.type,
      parentID: message.parentID,
      time: message.time,
      tokens: message.tokens,
      cost: message.cost
    },
    // v2 content entries carry no ids of their own; synthesize stable ones from the message id
    // and index so projectMessagePart's `part.id`/`part.messageID` guard still holds.
    parts: content.map((part, index) => ({
      id: part?.id || `${messageID}:${index}`,
      sessionID,
      messageID,
      ...part
    }))
  }
}

function projectMessage(message) {
  const normalized = normalizeMessageEnvelope(message)
  const info = projectMessageInfo(normalized?.info)
  if (!info) return null
  return {
    info,
    parts: Array.isArray(normalized.parts) ? normalized.parts.map(projectMessagePart).filter(Boolean) : []
  }
}

// The question/permission ask payloads identify the pending request via `requestID`,
// but the underlying Info object may surface it as `id` — accept either.
function requestIdOf(properties) {
  const id = properties?.requestID ?? properties?.id
  return id != null ? String(id) : null
}

// A pending request the runtime forgot about (runtime restart, session abort, or a sibling
// permission that was rejected) answers the reply endpoint with HTTP 404 and one of these
// tags. That is a normal, expected outcome — not a failure worth surfacing as an error — so
// callers turn it into `{ ok: false, reason: "expired" }` instead of throwing.
function isRequestExpiredError(error) {
  const message = String(error?.message || "")
  if (!message.startsWith("HTTP 404") && !message.startsWith("HTTP 409")) return false
  return message.includes("PermissionNotFoundError") ||
    message.includes("QuestionNotFoundError") ||
    message.includes("FormNotFoundError") ||
    message.includes("FormAlreadySettledError")
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

function projectFormOption(option) {
  if (!option || typeof option !== "object") return null
  if (typeof option.value !== "string" || typeof option.label !== "string") return null
  return {
    value: option.value,
    label: option.label,
    ...(typeof option.description === "string" ? { description: option.description } : {})
  }
}

function projectFormWhen(when) {
  if (!when || typeof when !== "object" || typeof when.key !== "string") return null
  if (!["eq", "neq"].includes(when.op)) return null
  if (!["string", "number", "boolean"].includes(typeof when.value)) return null
  return { key: when.key, op: when.op, value: when.value }
}

function projectFormField(field) {
  if (!field || typeof field !== "object" || typeof field.key !== "string") return null
  if (!["string", "number", "integer", "boolean", "multiselect", "external"].includes(field.type)) return null
  const base = {
    key: field.key,
    type: field.type,
    ...(typeof field.title === "string" ? { title: field.title } : {}),
    ...(typeof field.description === "string" ? { description: field.description } : {}),
    ...(field.required === true ? { required: true } : {})
  }
  if (Array.isArray(field.when)) base.when = field.when.map(projectFormWhen).filter(Boolean)
  if (field.type === "external") {
    let url = ""
    try {
      const parsed = new URL(String(field.url || ""))
      if (parsed.protocol === "http:" || parsed.protocol === "https:") url = parsed.toString()
    } catch {}
    return url ? { ...base, url } : null
  }
  if (field.type === "string") {
    if (typeof field.placeholder === "string") base.placeholder = field.placeholder
    if (typeof field.default === "string") base.default = field.default
    if (typeof field.format === "string") base.format = field.format
    if (Number.isInteger(field.minLength)) base.minLength = field.minLength
    if (Number.isInteger(field.maxLength)) base.maxLength = field.maxLength
    if (Array.isArray(field.options)) base.options = field.options.map(projectFormOption).filter(Boolean)
  } else if (field.type === "number" || field.type === "integer") {
    if (typeof field.default === "number" && Number.isFinite(field.default)) base.default = field.default
    if (typeof field.minimum === "number" && Number.isFinite(field.minimum)) base.minimum = field.minimum
    if (typeof field.maximum === "number" && Number.isFinite(field.maximum)) base.maximum = field.maximum
  } else if (field.type === "boolean") {
    if (typeof field.default === "boolean") base.default = field.default
  } else if (field.type === "multiselect") {
    base.options = Array.isArray(field.options) ? field.options.map(projectFormOption).filter(Boolean) : []
    if (Array.isArray(field.default)) base.default = field.default.filter((value) => typeof value === "string")
    if (Number.isInteger(field.minItems)) base.minItems = field.minItems
    if (Number.isInteger(field.maxItems)) base.maxItems = field.maxItems
  }
  return base
}

function projectForm(form) {
  if (!form || typeof form !== "object" || typeof form.id !== "string" || typeof form.sessionID !== "string") return null
  const fields = Array.isArray(form.fields) ? form.fields.map(projectFormField).filter(Boolean) : []
  if (!fields.length) return null
  return {
    id: form.id,
    sessionID: form.sessionID,
    title: typeof form.title === "string" ? form.title : "Input required",
    fields,
    ...(typeof form.metadata?.kind === "string" ? { kind: form.metadata.kind } : {})
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

function projectSessionCreated(event) {
  const properties = eventPayload(event, CONTRACT)
  const info = properties.info || {}
  const sessionID = properties.sessionID || info.id
  const parentSessionId = properties.parentSessionId || info.parentID
  if (!sessionID || !parentSessionId) return null
  return { type: event.type, sessionID, parentSessionId }
}

// The renderer and thread-stream match on the v1 event NAMES, which are the app's canonical
// vocabulary. v2 renames several of them (session.aborted -> session.execution.interrupted,
// message.part.delta -> session.text.delta, the four mcp.status.* -> mcp.status.changed), so the
// projection layer maps every runtime name back to the canonical one. Consumers therefore stay
// runtime-agnostic and no downstream `event.type` comparison has to change.
const CANONICAL_EVENT_BY_RUNTIME_NAME = new Map([
  [EVENTS.sessionStatus, "session.status"],
  [EVENTS.sessionIdle, "session.idle"],
  [EVENTS.sessionAborted, "session.aborted"],
  [EVENTS.sessionError, "session.error"],
  [EVENTS.messageUpdated, "message.updated"],
  [EVENTS.messagePartUpdated, "message.part.updated"],
  [EVENTS.messagePartDelta, "message.part.delta"],
  [EVENTS.questionAsked, "question.asked"],
  [EVENTS.questionReplied, "question.replied"],
  [EVENTS.questionRejected, "question.rejected"],
  [EVENTS.permissionAsked, "permission.asked"],
  [EVENTS.permissionReplied, "permission.replied"],
  // v2 ends a turn with `session.execution.succeeded` and never emits `session.idle`, so this
  // must canonicalize too — otherwise handleRuntimeEvent's busy/idle bookkeeping never runs and
  // sessionStatuses stays "busy" forever, leaving the "Thinking" row on screen after the reply.
  [EVENTS.sessionExecutionSucceeded, "session.idle"],
  [EVENTS.sessionExecutionFailed, "session.error"],
  // The mirror image of the two above, and the reason no "Thinking" row appeared at all: v2 opens
  // a turn with `session.execution.started` and emits NO `session.status`, which is the only event
  // that ever moved a session into "busy". Verified on a live turn — the whole stream was
  // execution.started -> step.started -> text.* -> step.ended -> execution.succeeded, with no
  // session.status anywhere. Canonicalizing to session.status lets the existing busy bookkeeping
  // below run unchanged; projectRuntimeEvent synthesizes the {type:"busy"} status payload.
  [EVENTS.sessionExecutionStarted, "session.status"]
].filter(([runtimeName]) => Boolean(runtimeName)))

function canonicalEventType(runtimeType) {
  return CANONICAL_EVENT_BY_RUNTIME_NAME.get(runtimeType) || runtimeType
}

function projectRuntimeEvent(event) {
  // Payload key is contract-driven: v1 uses `properties`, v2 uses `data`.
  const properties = eventPayload(event, CONTRACT)
  const type = canonicalEventType(event?.type)
  if (event?.type === EVENTS.serverConnected) {
    return { type: "runtime.stream.connected" }
  }
  if (event?.type === EVENTS.sessionCreated) {
    return projectSessionCreated(event)
  }
  if (event?.type === EVENTS.sessionStatus && properties.sessionID) {
    return { type, sessionID: properties.sessionID, status: properties.status }
  }
  if (event?.type === EVENTS.sessionIdle && properties.sessionID) {
    return { type, sessionID: properties.sessionID }
  }
  // v2 ends a normal turn with `session.execution.succeeded` and does NOT emit `session.idle`
  // (observed on a real LLM reply). Without this the thread would stay busy forever.
  if (EVENTS.sessionExecutionSucceeded && event?.type === EVENTS.sessionExecutionSucceeded && properties.sessionID) {
    return { type: "session.idle", sessionID: properties.sessionID }
  }
  // ...and it OPENS a turn with `session.execution.started`, emitting no `session.status` at all,
  // so nothing ever moved the session into "busy" and the "Thinking" row never appeared. The event
  // carries no `status` payload of its own, so the busy status is synthesized here to match the v1
  // shape the renderer and thread-stream already consume.
  if (EVENTS.sessionExecutionStarted && event?.type === EVENTS.sessionExecutionStarted && properties.sessionID) {
    return { type: "session.status", sessionID: properties.sessionID, status: { type: "busy" } }
  }
  // v2 emits no `message.updated` for the assistant message; `session.step.started` is the first
  // event carrying its id, so it is what creates the message the deltas then append to.
  // `time.created` is carried so the footer can compute elapsed time once the step ends.
  if (EVENTS.sessionStepStarted && event?.type === EVENTS.sessionStepStarted && properties.sessionID && properties.assistantMessageID) {
    return {
      type: "message.updated",
      sessionID: properties.sessionID,
      info: {
        id: properties.assistantMessageID,
        sessionID: properties.sessionID,
        role: "assistant",
        time: { created: event.created || Date.now() }
      }
    }
  }
  // A failed turn emits `session.execution.failed` INSTEAD of `.succeeded`, so without this the
  // thread never leaves `busy` and the spinner runs forever with no error surfaced.
  if (EVENTS.sessionExecutionFailed && event?.type === EVENTS.sessionExecutionFailed && properties.sessionID) {
    return {
      type: "session.error",
      sessionID: properties.sessionID,
      error: sessionErrorMessage(properties.error)
    }
  }
  // Likewise a failed step replaces `session.step.ended`; settle the message so it stops
  // presenting as still streaming.
  if (EVENTS.sessionStepFailed && event?.type === EVENTS.sessionStepFailed && properties.sessionID && properties.assistantMessageID) {
    return {
      type: "message.updated",
      sessionID: properties.sessionID,
      info: {
        id: properties.assistantMessageID,
        sessionID: properties.sessionID,
        role: "assistant",
        time: { completed: event.created || Date.now() },
        ...(properties.tokens ? { tokens: properties.tokens } : {}),
        ...(properties.cost != null ? { cost: properties.cost } : {})
      }
    }
  }
  // ...and no completion event either, so `session.step.ended` carries the turn's tokens/cost.
  // A turn can contain SEVERAL steps (tool call → step ends → next step starts), all sharing one
  // assistantMessageID, so `time.completed` is only set on the step that actually finishes the
  // turn. Marking every step complete made the message flip completed→incomplete→completed and
  // the copy/fork actions flicker on each tool call.
  if (EVENTS.sessionStepEnded && event?.type === EVENTS.sessionStepEnded && properties.sessionID && properties.assistantMessageID) {
    const finishesTurn = properties.finish !== "tool-calls"
    return {
      type: "message.updated",
      sessionID: properties.sessionID,
      info: {
        id: properties.assistantMessageID,
        sessionID: properties.sessionID,
        role: "assistant",
        ...(finishesTurn ? { time: { completed: event.created || Date.now() } } : {}),
        ...(properties.tokens ? { tokens: properties.tokens } : {}),
        ...(properties.cost != null ? { cost: properties.cost } : {})
      }
    }
  }
  if (event?.type === EVENTS.sessionAborted && properties.sessionID) {
    return { type, sessionID: properties.sessionID }
  }
  if (event?.type === EVENTS.sessionError) {
    return { type, sessionID: properties.sessionID, error: sessionErrorMessage(properties.error) }
  }
  if (event?.type === EVENTS.messageUpdated) {
    const info = projectMessageInfo(properties.info)
    if (info?.sessionID) return { type, sessionID: info.sessionID, info }
  }
  if (event?.type === EVENTS.messagePartUpdated) {
    const part = projectMessagePart(properties.part)
    const sessionID = properties.sessionID || part?.sessionID
    if (sessionID && part) return { type, sessionID, part }
  }
  // Streaming text deltas. v1 sends { messageID, partID, field, delta } and uses `field` to tell
  // text from reasoning. v2 sends { assistantMessageID, ordinal, delta } with NO `field` — the
  // distinction moved into the event name (session.text.* vs session.reasoning.*). Both are
  // normalized to the v1-shaped payload consumed by the renderer's existing stream pacer.
  const isReasoningDelta = Boolean(EVENTS.sessionReasoningDelta) && event?.type === EVENTS.sessionReasoningDelta
  if ((event?.type === EVENTS.messagePartDelta || isReasoningDelta) && properties.sessionID) {
    const messageID = properties.messageID || properties.assistantMessageID
    // v2 identifies a part by its ordinal within the message rather than by a part id. Reasoning
    // and answer text share the ordinal space, so the field is folded into the synthetic id to
    // keep the two streams in separate parts.
    const partID = properties.partID
      || (messageID != null && properties.ordinal != null
        ? `${messageID}:${isReasoningDelta ? "reasoning:" : ""}${properties.ordinal}`
        : null)
    if (messageID && partID) {
      return {
        type: "message.part.delta",
        sessionID: properties.sessionID,
        messageID,
        partID,
        field: properties.field || (isReasoningDelta ? "reasoning" : "text"),
        delta: properties.delta || ""
      }
    }
  }
  // The authoritative end of a reasoning block. `text` is the full reasoning (required by the
  // schema) and the runtime's reducer overwrites rather than appends, so this is projected as a
  // whole-part update that replaces whatever the ephemeral deltas managed to accumulate. It reuses
  // the delta branch's synthetic partID so both land on the same part instead of rendering twice.
  // `session.reasoning.started` is deliberately NOT mapped: it carries only `state`, no text, so it
  // would just create an empty part that renderReasoningRow discards.
  if (EVENTS.sessionReasoningEnded && event?.type === EVENTS.sessionReasoningEnded && properties.sessionID) {
    const messageID = properties.messageID || properties.assistantMessageID
    if (messageID && properties.ordinal != null) {
      const partID = `${messageID}:reasoning:${properties.ordinal}`
      return {
        type: "message.part.updated",
        sessionID: properties.sessionID,
        part: {
          id: partID,
          sessionID: properties.sessionID,
          messageID,
          type: "reasoning",
          text: typeof properties.text === "string" ? properties.text : ""
        }
      }
    }
  }
  if (
    event?.type === EVENTS.sessionToolInputStarted ||
    event?.type === EVENTS.sessionToolInputEnded ||
    event?.type === EVENTS.sessionToolCalled ||
    event?.type === EVENTS.sessionToolProgress ||
    event?.type === EVENTS.sessionToolSuccess ||
    event?.type === EVENTS.sessionToolFailed
  ) {
    return projectToolLifecycleEvent(event, properties)
  }
  if (event?.type === EVENTS.questionAsked) {
    const requestID = requestIdOf(properties)
    if (properties.sessionID && requestID) {
      return { type, sessionID: properties.sessionID, requestID, question: projectQuestion(properties) }
    }
  }
  if (event?.type === EVENTS.questionReplied || event?.type === EVENTS.questionRejected) {
    const requestID = requestIdOf(properties)
    if (properties.sessionID && requestID) return { type, sessionID: properties.sessionID, requestID }
  }
  if (event?.type === EVENTS.permissionAsked) {
    const requestID = requestIdOf(properties)
    if (properties.sessionID && requestID) {
      return { type, sessionID: properties.sessionID, requestID, permission: projectPermission(properties) }
    }
  }
  if (event?.type === EVENTS.permissionReplied) {
    const requestID = requestIdOf(properties)
    if (properties.sessionID && requestID) return { type, sessionID: properties.sessionID, requestID }
  }
  if (EVENTS.formCreated && event?.type === EVENTS.formCreated) {
    const form = projectForm(properties.form)
    if (form) return { type: "form.created", sessionID: form.sessionID, form }
  }
  if (EVENTS.formReplied && event?.type === EVENTS.formReplied && properties.sessionID && properties.id) {
    return { type: "form.replied", sessionID: properties.sessionID, formID: String(properties.id) }
  }
  if (EVENTS.formCancelled && event?.type === EVENTS.formCancelled && properties.sessionID && properties.id) {
    return { type: "form.cancelled", sessionID: properties.sessionID, formID: String(properties.id) }
  }
  if (EVENTS.sessionAgentSelected && event?.type === EVENTS.sessionAgentSelected && properties.sessionID) {
    return { type, sessionID: properties.sessionID, agent: String(properties.agent || "") }
  }
  if (EVENTS.sessionModelSelected && event?.type === EVENTS.sessionModelSelected && properties.sessionID) {
    const model = normalizeModelRef(properties.model)
    if (model) return { type, sessionID: properties.sessionID, model }
  }
  if (EVENTS.sessionInputAdmitted && event?.type === EVENTS.sessionInputAdmitted) {
    const input = projectAdmittedInput(properties, event)
    if (input) {
      return {
        type,
        sessionID: input.sessionID,
        inputID: input.id,
        input
      }
    }
  }
  if (
    EVENTS.sessionInputPromoted &&
    event?.type === EVENTS.sessionInputPromoted &&
    properties.sessionID &&
    properties.inputID
  ) {
    return {
      type,
      sessionID: String(properties.sessionID),
      inputID: String(properties.inputID)
    }
  }
  if (
    (EVENTS.sessionCompactionAdmitted && event?.type === EVENTS.sessionCompactionAdmitted) ||
    (EVENTS.sessionCompactionStarted && event?.type === EVENTS.sessionCompactionStarted) ||
    (EVENTS.sessionCompactionEnded && event?.type === EVENTS.sessionCompactionEnded)
  ) {
    if (properties.sessionID) {
      return {
        type,
        sessionID: properties.sessionID,
        ...(properties.reason ? { reason: properties.reason } : {}),
        ...(properties.inputID ? { inputID: properties.inputID } : {})
      }
    }
  }
  if (EVENTS.sessionCompactionDelta && event?.type === EVENTS.sessionCompactionDelta && properties.sessionID) {
    // The checkpoint text is intentionally not projected across IPC.
    return { type, sessionID: properties.sessionID }
  }
  if (EVENTS.sessionCompactionFailed && event?.type === EVENTS.sessionCompactionFailed && properties.sessionID) {
    return {
      type,
      sessionID: properties.sessionID,
      ...(properties.reason ? { reason: properties.reason } : {}),
      error: sessionErrorMessage(properties.error)
    }
  }
  if (EVENTS.sessionRevertStaged && event?.type === EVENTS.sessionRevertStaged && properties.sessionID) {
    return { type, sessionID: properties.sessionID, revert: projectSessionRevert(properties.revert) }
  }
  if (
    (EVENTS.sessionRevertCleared && event?.type === EVENTS.sessionRevertCleared) ||
    (EVENTS.sessionRevertCommitted && event?.type === EVENTS.sessionRevertCommitted)
  ) {
    if (properties.sessionID) return { type, sessionID: properties.sessionID }
  }
  // v1 encodes MCP state in the event NAME (mcp.status.connected, …). v2 collapses all four into
  // `mcp.status.changed` and carries the server in the payload. The renderer keys off `mcp.` as a
  // prefix and reads `name`/`status`, so both are projected into that same shape.
  if (
    event?.type === EVENTS.mcpStatusNeedsAuth ||
    event?.type === EVENTS.mcpStatusConnected ||
    event?.type === EVENTS.mcpStatusFailed ||
    event?.type === EVENTS.mcpStatusDisabled
  ) {
    const name = properties.name || properties.mcpName
    if (name) return { type, name: String(name), status: event.type.slice("mcp.status.".length) }
  }
  if (EVENTS.mcpStatusChanged && event?.type === EVENTS.mcpStatusChanged) {
    const name = properties.server || properties.name || properties.mcpName
    if (name) {
      return {
        type,
        name: String(name),
        ...(properties.status ? { status: String(properties.status) } : {})
      }
    }
  }
  if (event?.type === EVENTS.mcpBrowserOpenFailed) {
    const name = properties.mcpName || properties.name
    if (name) return { type, name: String(name), url: properties.url || "" }
  }
  // v2 builds its command/skill catalog asynchronously — GET /api/command answers 200 with an
  // empty list for seconds after health passes. Forward these so the renderer re-fetches instead
  // of showing the empty first response forever.
  if (
    (EVENTS.catalogUpdated && event?.type === EVENTS.catalogUpdated) ||
    (EVENTS.commandUpdated && event?.type === EVENTS.commandUpdated) ||
    (EVENTS.skillUpdated && event?.type === EVENTS.skillUpdated)
  ) {
    return { type: "runtime.catalog.updated" }
  }
  // References list changed (add/remove or, once the pinned runtime actually populates from
  // config — see the caveat on the `references` endpoint in runtime-contract.js — a real
  // server-side change). No payload carries anything renderer-safe to project; this is purely a
  // "go re-fetch" signal for whichever project is currently active.
  if (EVENTS.referenceUpdated && event?.type === EVENTS.referenceUpdated) {
    return { type: "reference.updated" }
  }
  // PTY lifecycle — confirmed live on the wire (unlike reference.updated above). created/updated
  // carry the full Pty under `data.info`; exited/deleted carry only `data.id` (+ exitCode for
  // exited). This is a secondary signal: the terminal panel's primary "did it exit" source is the
  // WebSocket's own close code 4404 (see RuntimeProcessManager.connectPty), but this still lets
  // any other view (e.g. a future PTY list) stay in sync without its own poll.
  if (EVENTS.ptyCreated && event?.type === EVENTS.ptyCreated) {
    const info = projectPtyInfo(properties.info)
    return info ? { type: "pty.created", pty: info } : null
  }
  if (EVENTS.ptyUpdated && event?.type === EVENTS.ptyUpdated) {
    const info = projectPtyInfo(properties.info)
    return info ? { type: "pty.updated", pty: info } : null
  }
  if (EVENTS.ptyExited && event?.type === EVENTS.ptyExited) {
    const ptyId = typeof properties.id === "string" ? properties.id : ""
    return ptyId ? { type: "pty.exited", ptyId, exitCode: Number.isInteger(properties.exitCode) ? properties.exitCode : null } : null
  }
  if (EVENTS.ptyDeleted && event?.type === EVENTS.ptyDeleted) {
    const ptyId = typeof properties.id === "string" ? properties.id : ""
    return ptyId ? { type: "pty.deleted", ptyId } : null
  }
  // Working-copy signals for the Changes panel. Only the fact that something changed crosses the
  // boundary — never file contents. NOTE: `filesystem.changed` does not actually arrive on the
  // pinned runtime (no native watcher binding — see runtime-contract.js), so the panel refreshes
  // off session-idle/focus instead; this branch is kept so it upgrades to realtime for free.
  if (EVENTS.filesystemChanged && event?.type === EVENTS.filesystemChanged) {
    const data = eventPayload(event, CONTRACT)
    return {
      type: "filesystem.changed",
      file: typeof data.file === "string" ? data.file : "",
      event: typeof data.event === "string" ? data.event : ""
    }
  }
  if (EVENTS.vcsBranchUpdated && event?.type === EVENTS.vcsBranchUpdated) {
    const data = eventPayload(event, CONTRACT)
    return { type: "vcs.branch.updated", branch: typeof data.branch === "string" ? data.branch : "" }
  }
  return null
}

function summarizeRuntimeEvent(event) {
  const projected = projectRuntimeEvent(event)
  if (!projected) return {}
  if (projected.type === EVENTS.sessionInputAdmitted || projected.type === EVENTS.sessionInputPromoted) {
    return {
      sessionID: projected.sessionID,
      inputID: projected.inputID,
      ...(projected.input?.type ? { inputType: projected.input.type } : {}),
      ...(projected.input?.delivery ? { delivery: projected.input.delivery } : {}),
      ...(Number.isFinite(projected.input?.admittedSeq) ? { admittedSeq: projected.input.admittedSeq } : {})
    }
  }
  if (projected.type?.startsWith("session.revert.")) {
    return {
      sessionID: projected.sessionID,
      status: projected.type.slice("session.revert.".length),
      fileCount: projected.revert?.files?.length || 0
    }
  }
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
  constructor({
    userDataPath,
    profile,
    emit,
    requestTimeoutMs = RUNTIME_REQUEST_TIMEOUT_MS,
    healthRequestTimeoutMs = HEALTH_REQUEST_TIMEOUT_MS,
    healthStartupTimeoutMs = 15_000,
    healthRetryDelayMs = 350
  }) {
    this.userDataPath = userDataPath
    this.profile = profile
    this.emit = emit
    this.requestTimeoutMs = requestTimeoutMs
    this.healthRequestTimeoutMs = healthRequestTimeoutMs
    this.healthStartupTimeoutMs = healthStartupTimeoutMs
    this.healthRetryDelayMs = healthRetryDelayMs
    this.child = null
    this.eventAbort = null
    this.eventGeneration = 0
    this.eventReconnectTimer = null
    // ptyId -> { socket }. Closed in bulk whenever the runtime stops (see stop() / the child
    // "exit" handler) so a terminal never outlives the server process that backs it.
    this.ptyConnections = new Map()
    this.exitPromise = null
    this.resolveExit = null
    // Tracks an in-flight start/stop so reads can wait for the server to settle instead of
    // throwing "Runtime is not running" during a restart. See waitUntilReady().
    this.lifecycle = null
    this.createSessionInFlight = null
    this.sessionStatuses = {}
    this.compactionStatuses = {}
    this.pendingGeneratedAttachmentPaths = {}
    this.sessionGeneratedAttachmentPaths = {}
    this.generatedPromptBodies = {}
    this.subagentRuns = new SubagentRunTreeTracker({
      onUpdate: (tree) => this.emitStream({ type: "subagent.run-tree.updated", rootSessionId: tree.rootSessionId, tree })
    })
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
      compactionStatuses: { ...this.compactionStatuses },
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

  // Waits for any in-flight start/restart to settle, then asserts the server is up. Read
  // operations call this so a request issued mid-restart waits for the new server instead of
  // throwing "Runtime is not running." Bounded by the lifecycle op itself (which has its own
  // health-check timeout); if no lifecycle is pending and the server is down, this throws as before.
  async waitUntilReady() {
    if (this.lifecycle) {
      try { await this.lifecycle } catch { /* a failed start surfaces via assertReady below */ }
    }
    this.assertReady()
  }

  async start({ project }) {
    return this.openProject({ project })
  }

  async reload() {
    const project = this.state.project
    if (!this.child || !project) return this.snapshot()
    if (this.lifecycle) return this.lifecycle.then(() => this.snapshot())
    const op = (async () => {
      await this.stop()
      return this._openProject({ project })
    })()
    const marker = op.then(() => {}, () => {})
    this.lifecycle = marker
    marker.finally(() => { if (this.lifecycle === marker) this.lifecycle = null })
    return op
  }

  // Register NEWLY ADDED MCP servers without restarting the runtime.
  //
  // opencode >= 0.0.0-next-17055 watches the config file and reconciles `mcp.servers` in place:
  // Config.reload() debounces ~100ms, diffs with isDeepStrictEqual and publishes Config.Event.Updated,
  // which the MCP layer consumes. Verified by A/B probe against a real server — on next-17055 a
  // server written into the config file out-of-process appears on GET /api/mcp within ~500ms under
  // the SAME pid; on next-16985 it never appears. So this must not be used on older runtimes.
  //
  // ADD ONLY. The same probe showed removal and `disabled: true` do NOT take effect: the server
  // stays listed as "pending" indefinitely, even though upstream's reloadConfig() does call
  // removeServer(). Callers that need a server to actually stop must still use reload().
  //
  // The caller MUST have already rewritten the runtime (XDG) config — the runtime reads the
  // translated v2 file, not the app's authoring config, and nothing else re-translates it once we
  // stop calling reload(). If the expected servers do not show up before the deadline we fall back
  // to a full reload() rather than leave the user with a connector that silently did nothing.
  async applyMcpConfig({ expect = [], timeoutMs = 4000 } = {}) {
    if (process.env.OPENWORKING_FORCE_RUNTIME_RELOAD === "1") return this.reload()
    if (!this.child || !this.state.project) return this.snapshot()
    const wanted = expect.map(String).filter(Boolean)
    if (!wanted.length) return this.snapshot()
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      let names
      try {
        names = new Set((await this.listMcpStatus()).map((server) => server.name))
      } catch {
        continue // runtime busy or momentarily unreachable — keep polling until the deadline
      }
      if (wanted.every((name) => names.has(name))) return this.snapshot()
    }
    this.log("warn", "MCP hot-reload did not converge; falling back to a runtime restart")
    return this.reload()
  }

  // Public entry. Records the start as the active lifecycle op so concurrent reads
  // (listMessages/listSessions/…) can await it via waitUntilReady() instead of throwing
  // "Runtime is not running" during the stop→spawn→healthcheck window.
  async openProject({ project }) {
    while (this.lifecycle) {
      const pending = this.lifecycle
      await pending
      if (
        this.child &&
        this.state.status === "running" &&
        this.state.project?.id === project?.id &&
        this.state.runtime?.cwd === project?.path
      ) {
        return this.snapshot()
      }
      if (this.lifecycle !== pending) continue
      break
    }
    const op = this._openProject({ project })
    // A settled-but-not-superseded lifecycle clears itself; a newer openProject overwrites it first.
    const marker = op.then(() => {}, () => {})
    this.lifecycle = marker
    marker.finally(() => { if (this.lifecycle === marker) this.lifecycle = null })
    return op
  }

  async _openProject({ project }) {
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
    const authoringConfigPath = this.profile?.configPath || defaultConfigPath(configDir)
    const configPath = this.profile?.xdgConfigPath || authoringConfigPath
    const xdgConfigHome = this.profile?.xdgConfigHome || runtimeXdgConfigHome(configDir)
    const runtimeDataDir = path.join(configDir, "data")
    const runtimeStateDir = path.join(configDir, "state")
    const runtimeCacheDir = path.join(configDir, "cache")
    const runtimeBin = resolveRuntimeBin()
    // `--print-logs` routes opencode's structured logs to stderr (captured into state.logs / the
    // Diagnostics panel) at its default level. Without it, opencode errors — e.g. an MCP OAuth
    // connect failure — only land in opencode's log file and surface to us as an opaque
    // "HTTP 500 UnknownError". We intentionally do NOT raise to --log-level DEBUG, which would dump
    // OAuth request bodies (secrets) into logs. The OPENWORKING_RUNTIME_ARGS override is unchanged.
    const baseRuntimeArgs = process.env.OPENWORKING_RUNTIME_ARGS
      ? process.env.OPENWORKING_RUNTIME_ARGS.split(" ").filter(Boolean)
      : CONTRACT.serveArgs({ port, hostname: "127.0.0.1" })
    // Test-only: lets a fixture point OPENWORKING_RUNTIME_BIN at node itself and pass the script as
    // the first argument. Windows cannot spawn a shebang .js or a .cmd wrapper directly, and the
    // real runtime is always a native executable, so this stays out of the production path.
    const runtimeArgs = process.env.OPENWORKING_RUNTIME_SCRIPT
      ? [process.env.OPENWORKING_RUNTIME_SCRIPT, ...baseRuntimeArgs]
      : baseRuntimeArgs
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
        configDir,
        xdgConfigHome
      },
      project,
      activeSessionId: null
    }
    this.sessionStatuses = {}
    this.compactionStatuses = {}
    this.subagentRuns.reset()
    this.publish()
    this.timeline("runtime.launch.requested", {
      command: runtimeBin,
      args: runtimeArgs,
      cwd: project.path,
      configPath,
      configDir,
      xdgConfigHome
    })
    const userPath = await resolveUserPath()
    const env = {
      ...process.env,
      // Augment PATH with the user's real toolchain so opencode can spawn local MCP servers
      // (e.g. `npx ...`). A packaged macOS app otherwise inherits launchd's minimal PATH.
      PATH: userPath,
      OPENCODE_CONFIG: configPath,
      OPENCODE_CONFIG_DIR: configDir,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: runtimeDataDir,
      XDG_STATE_HOME: runtimeStateDir,
      XDG_CACHE_HOME: runtimeCacheDir,
      OPENCODE_SERVER_USERNAME: "opencode",
      OPENCODE_SERVER_PASSWORD: password,
      OPENWORKING_PROJECT_ID: project.id,
      OPENWORKING_PROJECT_PATH: project.path,
      ...translationGatewayEnv(authoringConfigPath, process.env)
    }
    try {
      await ensureRuntimeDbSchema({ runtimeBin, env })
    } catch (error) {
      this.log("warn", `Runtime DB schema repair skipped: ${error.message}`)
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
      this.subagentRuns.reset()
      this.cleanupAllSessionGeneratedAttachments()
      this.child = null
      if (this.resolveExit) this.resolveExit()
      this.resolveExit = null
      this.exitPromise = null
    })
    this.child.on("exit", (code, signal) => {
      const wasStopping = this.state.status === "stopping"
      this.child = null
      this.stopEventStream()
      this.closeAllPtyConnections()
      this.subagentRuns.reset()
      this.cleanupAllSessionGeneratedAttachments()
      this.state.status = wasStopping ? "stopped" : code === 0 ? "stopped" : "error"
      this.state.activity = "idle"
      this.state.lastError = code === 0 || wasStopping
        ? null
        : this.launchErrorMessage(`Runtime exited with code ${code ?? "null"} signal ${signal ?? "null"}`)
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
    this.warmUpBacklogMcp()
    return this.snapshot()
  }

  async stop() {
    this.stopEventStream()
    this.closeAllPtyConnections()
    this.subagentRuns.reset()
    if (!this.child) {
      this.cleanupAllSessionGeneratedAttachments()
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
    this.cleanupAllSessionGeneratedAttachments()
    return this.snapshot()
  }

  async listSessions() {
    await this.waitUntilReady()
    const sessions = sidebarSessions(await requestJson({
      url: ENDPOINTS.sessions({ serverUrl: this.state.runtime.serverUrl }),
      auth: this.auth()
    }))
    return sessions
      .filter((session) => {
        const directory = sessionDirectory(session)
        return !directory || samePath(directory, this.state.runtime.cwd)
      })
      .map(projectSession)
  }

  // Lists sessions for an ARBITRARY project directory from the single running server. OpenCode's
  // GET /session is scoped by directory — with no `directory` query it returns only the server's
  // active cwd. Passing `directory` lets the renderer populate sidebar history for every project
  // from the one running server, without spawning a server per project.
  async listSessionsForDirectory(directory) {
    await this.waitUntilReady()
    if (!directory) return []
    const sessions = sidebarSessions(await requestJson({
      url: ENDPOINTS.sessionsByDirectory({ serverUrl: this.state.runtime.serverUrl, directory }),
      auth: this.auth()
    }))
    return sessions.map(projectSession)
  }

  async listSubagentRuns({ sessionId }) {
    await this.waitUntilReady()
    if (!sessionId) throw new Error("Session ID is required.")
    const serverUrl = this.state.runtime.serverUrl
    const auth = this.auth()
    return this.subagentRuns.hydrate(sessionId, {
      listChildren: async (parentId, limit) => {
        const payload = await requestJson({
          url: ENDPOINTS.sessionsByParent({ serverUrl, parentId, limit }),
          auth
        })
        return sessionListItems(payload)
      },
      listActive: async () => {
        const payload = await requestJson({
          url: ENDPOINTS.sessionActive({ serverUrl }),
          auth
        })
        return responseData(payload, CONTRACT) || {}
      },
      readLog: (childSessionId, after) => requestSseJson({
        url: ENDPOINTS.sessionLog({
          serverUrl,
          sessionId: childSessionId,
          after,
          follow: false
        }),
        auth
      })
    })
  }

  // Uncommitted working-copy changes for `directory`. The caller passes the project's EFFECTIVE
  // path, so a project on a switched worktree reports that worktree's changes rather than the
  // main checkout's — the endpoint honours `location[directory]` regardless of the server's cwd.
  async vcsStatus(directory) {
    await this.waitUntilReady()
    if (!directory) return { files: [], truncated: false }
    const payload = await requestJson({
      url: ENDPOINTS.vcsStatus({ serverUrl: this.state.runtime.serverUrl, directory }),
      auth: this.auth()
    })
    const entries = responseData(payload, CONTRACT)
    const files = (Array.isArray(entries) ? entries : []).map(projectVcsFileStatus).filter(Boolean)
    return {
      files: files.slice(0, MAX_VCS_STATUS_FILES),
      truncated: files.length > MAX_VCS_STATUS_FILES
    }
  }

  // Unified diff for a single file. Deliberately per-file: the panel lists status only (cheap) and
  // fetches a patch just for the row the user opened, so one huge file cannot stall the list.
  async vcsDiff(directory, { file, mode = "working" } = {}) {
    await this.waitUntilReady()
    if (!directory || !file) return null
    const payload = await requestJson({
      url: ENDPOINTS.vcsDiff({ serverUrl: this.state.runtime.serverUrl, directory, mode }),
      auth: this.auth()
    })
    const entries = responseData(payload, CONTRACT)
    const match = (Array.isArray(entries) ? entries : []).find((entry) => entry?.file === file)
    return match ? projectVcsFileDiff(match) : null
  }

  // GET-only (see the `references` endpoint comment in runtime-contract.js) — add/remove goes
  // through the project config helpers instead, not this manager.
  async listReferences(directory) {
    await this.waitUntilReady()
    const payload = await requestJson({
      url: ENDPOINTS.references({ serverUrl: this.state.runtime.serverUrl, directory }),
      auth: this.auth()
    })
    return catalogItems(payload).map(projectReferenceInfo).filter(Boolean)
  }

  async listSavedPermissions() {
    await this.waitUntilReady()
    const payload = await requestJson({
      url: ENDPOINTS.permissionSaved({ serverUrl: this.state.runtime.serverUrl }),
      auth: this.auth()
    })
    return catalogItems(payload).map(projectSavedPermission).filter(Boolean)
  }

  async removeSavedPermission(id) {
    await this.waitUntilReady()
    if (!id) throw new Error("A saved permission ID is required.")
    await requestJson({
      url: ENDPOINTS.permissionSavedItem({ serverUrl: this.state.runtime.serverUrl, id }),
      method: "DELETE",
      auth: this.auth()
    })
  }

  async findFiles(directory, { query, type, limit } = {}) {
    await this.waitUntilReady()
    if (!query) return []
    const payload = await requestJson({
      url: ENDPOINTS.fsFind({ serverUrl: this.state.runtime.serverUrl, directory, query, type, limit }),
      auth: this.auth()
    })
    return catalogItems(payload).map(projectFileSystemEntry).filter(Boolean)
  }

  async listFsEntries(directory, path) {
    await this.waitUntilReady()
    const payload = await requestJson({
      url: ENDPOINTS.fsList({ serverUrl: this.state.runtime.serverUrl, directory, path }),
      auth: this.auth()
    })
    return catalogItems(payload).map(projectFileSystemEntry).filter(Boolean)
  }

  // Returns the raw bytes: fsRead answers `application/octet-stream`, unlike every other endpoint
  // this manager calls. Capped at maxBytes (mirrors the 2 MiB cap files:read applies in main.js).
  async readFsFile(directory, path, { maxBytes = 2 * 1024 * 1024 } = {}) {
    await this.waitUntilReady()
    if (!path) throw new Error("A file path is required.")
    const { buffer, truncated } = await requestBuffer({
      url: ENDPOINTS.fsRead({ serverUrl: this.state.runtime.serverUrl, directory, path }),
      auth: this.auth(),
      maxBytes
    })
    return { content: buffer.toString("utf8"), truncated }
  }

  async createPty(directory, { command, args, cwd, title, env } = {}) {
    await this.waitUntilReady()
    const payload = await requestJson({
      url: ENDPOINTS.pty({ serverUrl: this.state.runtime.serverUrl, directory }),
      method: "POST",
      body: {
        command,
        ...(Array.isArray(args) && args.length ? { args } : {}),
        ...(cwd ? { cwd } : {}),
        ...(title ? { title } : {}),
        ...(env && typeof env === "object" ? { env } : {})
      },
      auth: this.auth()
    })
    return projectPtyInfo(responseData(payload, CONTRACT))
  }

  async listPtys(directory) {
    await this.waitUntilReady()
    const payload = await requestJson({
      url: ENDPOINTS.pty({ serverUrl: this.state.runtime.serverUrl, directory }),
      auth: this.auth()
    })
    return catalogItems(payload).map(projectPtyInfo).filter(Boolean)
  }

  async getPty(ptyId, directory) {
    await this.waitUntilReady()
    const payload = await requestJson({
      url: ENDPOINTS.ptyItem({ serverUrl: this.state.runtime.serverUrl, ptyId, directory }),
      auth: this.auth()
    })
    return projectPtyInfo(responseData(payload, CONTRACT))
  }

  async resizePty(ptyId, directory, { rows, cols, title } = {}) {
    await this.waitUntilReady()
    const size = Number.isInteger(rows) && rows > 0 && Number.isInteger(cols) && cols > 0 ? { rows, cols } : undefined
    const payload = await requestJson({
      url: ENDPOINTS.ptyItem({ serverUrl: this.state.runtime.serverUrl, ptyId, directory }),
      method: "PUT",
      body: { ...(size ? { size } : {}), ...(title ? { title } : {}) },
      auth: this.auth()
    })
    return projectPtyInfo(responseData(payload, CONTRACT))
  }

  async removePty(ptyId, directory) {
    await this.waitUntilReady()
    this.closePtyConnection(ptyId)
    await requestJson({
      url: ENDPOINTS.ptyItem({ serverUrl: this.state.runtime.serverUrl, ptyId, directory }),
      method: "DELETE",
      auth: this.auth()
    })
  }

  // Owns the PTY's WebSocket the same way connectEvents() owns the SSE stream: this manager is
  // the only thing that ever talks to the runtime, and every frame is relayed to the renderer via
  // the existing runtime:stream channel (see emitStream) rather than the caller wiring callbacks.
  // Authenticates with plain HTTP Basic auth on the handshake — the documented ticket flow
  // (POST /api/pty/{ptyID}/connect-token) is confirmed broken in the pinned runtime build, see the
  // caveat on ENDPOINTS.ptyConnect in runtime-contract.js.
  connectPty(ptyId, directory) {
    this.closePtyConnection(ptyId)
    const socket = new WebSocket(
      ENDPOINTS.ptyConnect({ serverUrl: this.state.runtime.serverUrl, ptyId, directory }),
      { headers: { Authorization: this.auth() } }
    )
    const entry = { socket }
    this.ptyConnections.set(ptyId, entry)
    socket.on("open", () => this.emitStream({ type: "pty.connected", ptyId }))
    socket.on("message", (data, isBinary) => {
      // Binary frames are a 0x00-prefixed JSON checkpoint marker (e.g. {"cursor":8}), not
      // terminal output — live-verified. Resume/cursor semantics are out of scope for this first
      // cut (see the goal spec), so only text frames (raw PTY bytes) are forwarded.
      if (isBinary) return
      this.emitStream({ type: "pty.data", ptyId, data: data.toString() })
    })
    socket.on("close", (code, reason) => {
      if (this.ptyConnections.get(ptyId) === entry) this.ptyConnections.delete(ptyId)
      // Close code 4404 + reason "session exited" is the server's own signal that the shell
      // process exited normally (live-verified against the pinned runtime) — surfaced distinctly
      // so the terminal UI never lumps a clean exit in with an actual connection failure.
      this.emitStream({
        type: "pty.disconnected",
        ptyId,
        exited: code === 4404,
        code,
        reason: reason ? reason.toString() : ""
      })
    })
    socket.on("error", (error) => {
      this.log("warn", "PTY connection error.", { ptyId, error: error.message })
    })
    return {
      write: (text) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(text)
      },
      close: () => this.closePtyConnection(ptyId)
    }
  }

  // Looked up by ptyId rather than requiring the caller to hold connectPty()'s return value, so
  // main.js's pty:write/pty:disconnect IPC handlers don't need their own parallel bookkeeping —
  // this.ptyConnections is already the single source of truth (and already cleared correctly by
  // closeAllPtyConnections on runtime stop/exit).
  writePty(ptyId, text) {
    const entry = this.ptyConnections.get(ptyId)
    if (entry?.socket?.readyState === WebSocket.OPEN) entry.socket.send(text)
  }

  disconnectPty(ptyId) {
    this.closePtyConnection(ptyId)
  }

  closePtyConnection(ptyId) {
    const entry = this.ptyConnections.get(ptyId)
    if (!entry) return
    this.ptyConnections.delete(ptyId)
    try { entry.socket.close() } catch { /* best-effort */ }
  }

  closeAllPtyConnections() {
    for (const ptyId of [...this.ptyConnections.keys()]) this.closePtyConnection(ptyId)
  }

  async listCommands() {
    await this.waitUntilReady()
    // Command.Info carries no `source`/discriminator field at all (see the OpenAPI schema:
    // name/template/description/agent/model/subtask only, additionalProperties:false) — every
    // entry from this endpoint is unconditionally a plain custom command. Skills live entirely
    // separately behind /api/skill (Skill.Info), never mixed into /api/command. Both are tagged
    // here rather than trusting a `source` the wire never actually sends.
    const commands = catalogItems(await requestJson({
      url: ENDPOINTS.commands({ serverUrl: this.state.runtime.serverUrl }),
      auth: this.auth()
    })).map((command) => ({ ...command, source: "command" }))
    let skills = []
    try {
      skills = catalogItems(await requestJson({
        url: ENDPOINTS.skills({ serverUrl: this.state.runtime.serverUrl }),
        auth: this.auth()
      })).map((skill) => ({ ...skill, source: "skill" }))
    } catch (error) {
      this.log("warn", `Skill catalog fetch failed: ${error.message}`)
    }
    const profileDir = this.profile?.profileDir || ""
    const commandFilePaths = syncManagedCommandFiles(profileDir, commands)
    // Skills were previously only consulted as a lookup map and never actually appended to the
    // projected list, so they never reached the "/command" menu regardless of the source fix
    // above — [...commands, ...skills] is what makes them show up at all.
    const projected = [...commands, ...skills].flatMap((command) => {
      if (command?.source === "command") {
        const commandPath = commandFilePaths.get(command.name)
        if (!commandPath) return []
        return [{
          name: command.name,
          description: command.description,
          source: command.source,
          agent: command.agent,
          model: command.model,
          hints: Array.isArray(command.hints) ? command.hints : [],
          path: commandPath,
          extra: command,
        }]
      }
      const skillInfo = command?.source === "skill"
        ? (
          typeof command?.location === "string" && command.location.trim()
            ? classifySkillPath(command.location, this.state.runtime.cwd, profileDir)
            : skillCommandInfo(command, profileDir, this.state.runtime.cwd)
        )
        : null
      return [{
        name: command.name,
        description: command.description,
        source: command.source,
        agent: command.agent,
        model: command.model,
        hints: Array.isArray(command.hints) ? command.hints : [],
        ...(skillInfo?.path ? { path: skillInfo.path, locationFamily: skillInfo.family } : {}),
        extra: command,
      }]
    })
    return projected
  }

  async listMcpStatus() {
    this.assertReady()
    const result = await requestJson({
      url: ENDPOINTS.mcp({ serverUrl: this.state.runtime.serverUrl }),
      auth: this.auth()
    })
    // opencode's connect path records the real failure reason in `error` (the WARN log only prints
    // the status), so we surface it here — this is how the actual cause of a `failed`/
    // `needs_client_registration` server reaches the UI.
    //
    // Shape: v2 wraps list responses as `{ location, data: [{ name, status: { status, error? } }] }`.
    // Unwrap `data` first — running Object.entries() on the envelope yields "location" and "data" as
    // bogus server names, which is what this used to do, so real MCP status never reached the UI.
    if (!result || typeof result !== "object") return []
    const payload = !Array.isArray(result) && Array.isArray(result.data) ? result.data : result
    if (!payload || typeof payload !== "object") return []
    const entries = Array.isArray(payload) ? payload : Object.entries(payload)
    return entries
      .map((entry) => {
        const [name, info] = Array.isArray(entry) ? entry : [entry?.name, entry]
        if (!name) return null
        // `status` is itself an object in v2 (`status: { status: "failed", error? }`), so unwrap one
        // level before stringifying — otherwise every server reports "[object Object]" — and read
        // `error` from whichever level carries it.
        const raw = typeof info === "string" ? info : info?.status
        const detail = raw && typeof raw === "object" ? raw : null
        const status = detail ? detail.status : raw
        const rawError = (detail && detail.error) || (info && typeof info === "object" ? info.error : null)
        const error = rawError ? String(rawError) : null
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
        url: ENDPOINTS.mcpServer({ serverUrl: this.state.runtime.serverUrl, name, path }),
        method: "POST",
        auth: this.auth(),
        timeoutMs: MCP_AUTH_REQUEST_TIMEOUT_MS
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
      url: ENDPOINTS.mcpConnect({ serverUrl: this.state.runtime.serverUrl, name }),
      method: "POST",
      auth: this.auth()
    })
  }

  // True when the profile has a Backlog connector configured and enabled. Reads the persisted
  // opencode config (same source of truth as main.js's mcp:setEnabled path) via the already-imported
  // readOpencodeConfig, so this stays free of an opencode-profile dependency. A missing config file
  // yields DEFAULT_CONFIG (no mcp.backlog) → false. Scoped to the literal "backlog" name only.
  backlogConnectorEnabled() {
    try {
      const configPath = this.profile?.configPath || this.state.runtime?.configPath
      const { config } = readOpencodeConfig(configPath)
      const server = config.mcp?.["backlog"]
      return !!server && server.enabled !== false
    } catch {
      return false
    }
  }

  // Cold-start the Backlog MCP server in the background right after the runtime is ready, so the
  // user's first tool call doesn't pay for the stdio spawn + MCP handshake + Backlog API auth (that
  // cold-start runs synchronously on first use and often exceeds RUNTIME_REQUEST_TIMEOUT_MS, making
  // the very first backlog_* call fail before a retry succeeds). Fire-and-forget: any failure just
  // logs a warning and the old lazy cold-start behavior still applies. Gated to Backlog only, and
  // only when the connector is enabled. connectMcp is idempotent, so a redundant connect is safe.
  warmUpBacklogMcp() {
    if (!this.backlogConnectorEnabled()) return
    this.connectMcp("backlog").catch((error) => {
      this.log("warn", `Backlog MCP warm-up skipped: ${error.message}`)
    })
  }

  async disconnectMcp(name) {
    this.assertReady()
    if (!name) throw new Error("MCP server name is required.")
    return await requestJson({
      url: ENDPOINTS.mcpDisconnect({ serverUrl: this.state.runtime.serverUrl, name }),
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

  async createSession({ title, agent, model } = {}) {
    this.assertReady()
    if (!this.createSessionInFlight) {
      const modelRef = normalizeModelRef(model)
      const body = {
        ...(agent ? { agent: String(agent) } : {}),
        ...(modelRef ? { model: modelRef } : {})
      }
      this.createSessionInFlight = requestJson({
        url: ENDPOINTS.sessions({ serverUrl: this.state.runtime.serverUrl }),
        method: "POST",
        auth: this.auth(),
        body,
        timeoutMs: this.requestTimeoutMs
      }).then(async (payload) => {
        let session = projectSession(responseData(payload, CONTRACT))
        this.state.activeSessionId = session?.id || null
        const nextTitle = String(title || "").trim()
        if (session?.id && nextTitle) {
          await this.renameSession({ sessionId: session.id, title: nextTitle })
          session = { ...session, title: nextTitle }
        }
        this.timeline("session.created", { sessionId: this.state.activeSessionId })
        return session
      }).finally(() => {
        this.createSessionInFlight = null
      })
    }
    return this.createSessionInFlight
  }

  async renameSession({ sessionId, title }) {
    this.assertReady()
    const nextTitle = String(title || "").trim()
    if (!sessionId) throw new Error("Select a session before renaming it.")
    if (!nextTitle) throw new Error("Session title is required.")
    this.timeline("session.rename.requested", { sessionId })
    try {
      await requestJson({
        url: ENDPOINTS.sessionRename({ serverUrl: this.state.runtime.serverUrl, sessionId }),
        method: "POST",
        auth: this.auth(),
        body: { title: nextTitle }
      })
      this.timeline("session.rename.completed", { sessionId })
      this.publish()
      return { id: sessionId, title: nextTitle }
    } catch (error) {
      this.log("error", `Rename failed: ${error.message}`)
      this.timeline("session.rename.error", { sessionId, error: error.message })
      throw error
    }
  }

  async selectSessionAgent({ sessionId, agent } = {}) {
    this.assertReady()
    const nextAgent = String(agent || "").trim()
    if (!sessionId) throw new Error("Select a session before changing its agent.")
    if (!nextAgent) throw new Error("Agent is required.")
    await requestJson({
      url: ENDPOINTS.sessionAgent({ serverUrl: this.state.runtime.serverUrl, sessionId }),
      method: "POST",
      auth: this.auth(),
      body: { agent: nextAgent }
    })
    this.timeline("session.agent.selected", { sessionId, agent: nextAgent })
    return { sessionId, agent: nextAgent }
  }

  async selectSessionModel({ sessionId, model } = {}) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before changing its model.")
    const modelRef = normalizeModelRef(model)
    if (!modelRef) throw new Error("A valid model is required.")
    await requestJson({
      url: ENDPOINTS.sessionModel({ serverUrl: this.state.runtime.serverUrl, sessionId }),
      method: "POST",
      auth: this.auth(),
      body: { model: modelRef }
    })
    this.timeline("session.model.selected", { sessionId, model: modelRef })
    return { sessionId, model: modelRef }
  }

  async compactSession({ sessionId } = {}) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before compacting it.")
    const current = this.compactionStatuses[sessionId]
    if (current?.status === "admitted" || current?.status === "running") return current
    this.compactionStatuses[sessionId] = { status: "admitted", reason: "manual" }
    this.publish()
    try {
      const pending = responseData(await requestJson({
        url: ENDPOINTS.sessionCompact({ serverUrl: this.state.runtime.serverUrl, sessionId }),
        method: "POST",
        auth: this.auth(),
        body: {}
      }), CONTRACT)
      this.timeline("session.compaction.requested", { sessionId })
      if (pending?.id) this.compactionStatuses[sessionId].inputID = pending.id
      return { ...this.compactionStatuses[sessionId] }
    } catch (error) {
      delete this.compactionStatuses[sessionId]
      this.publish()
      throw error
    }
  }

  // The message set the model currently sees as context. Used to refill the context-usage ring
  // after a compaction ends, when the last streamed inputTokens value is stale. Returns null
  // rather than throwing when the session has no assistant turn yet.
  async sessionContext({ sessionId } = {}) {
    await this.waitUntilReady()
    if (!sessionId) throw new Error("Select a session before reading its context.")
    const payload = await requestJson({
      url: ENDPOINTS.sessionContext({ serverUrl: this.state.runtime.serverUrl, sessionId }),
      auth: this.auth()
    })
    const messages = catalogItems(payload)
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const tokens = messages[i]?.tokens
      if (tokens && typeof tokens.input === "number") return { messageCount: messages.length, inputTokens: tokens.input }
    }
    return messages.length ? { messageCount: messages.length, inputTokens: null } : null
  }

  async stageSessionRevert({ sessionId, messageId, files = true } = {}) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before undoing it.")
    if (!messageId) throw new Error("Select a user message to undo.")
    if (this.sessionStatuses[sessionId]?.type === "busy") {
      throw new Error("Wait for the session to finish before undoing it.")
    }
    const revert = projectSessionRevert(responseData(await requestJson({
      url: ENDPOINTS.sessionRevertStage({ serverUrl: this.state.runtime.serverUrl, sessionId }),
      method: "POST",
      auth: this.auth(),
      body: { messageID: messageId, files: Boolean(files) }
    }), CONTRACT))
    this.timeline("session.revert.staged", { sessionId, status: "staged", fileCount: revert?.files?.length || 0 })
    return revert
  }

  async clearSessionRevert({ sessionId } = {}) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before redoing it.")
    await requestJson({
      url: ENDPOINTS.sessionRevertClear({ serverUrl: this.state.runtime.serverUrl, sessionId }),
      method: "POST",
      auth: this.auth()
    })
    this.timeline("session.revert.cleared", { sessionId, status: "cleared", fileCount: 0 })
    return true
  }

  async commitSessionRevert({ sessionId } = {}) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before keeping its revert.")
    await requestJson({
      url: ENDPOINTS.sessionRevertCommit({ serverUrl: this.state.runtime.serverUrl, sessionId }),
      method: "POST",
      auth: this.auth()
    })
    this.timeline("session.revert.committed", { sessionId, status: "committed", fileCount: 0 })
    return true
  }

  // `directory` targets a session that belongs to a project other than the server's cwd — OpenCode's
  // message endpoint is directory-scoped, so passing it lets the renderer view ANY project's chat
  // history against the one running server, with no restart.
  async listMessages({ sessionId, limit = 100, directory }) {
    await this.waitUntilReady()
    if (!sessionId) return []
    const payload = await requestJson({
      url: ENDPOINTS.sessionMessages({ serverUrl: this.state.runtime.serverUrl, sessionId, limit, directory }),
      auth: this.auth()
    })
    // v2 wraps list responses in `{ data, cursor }`. Without unwrapping, the Array.isArray guard
    // below falls through to [] on every call — and because the post-turn rehydrate assigns this
    // result straight onto thread.messages, an empty list wipes the whole conversation.
    const messages = responseData(payload, CONTRACT)
    return Array.isArray(messages) ? messages.map(projectMessage).filter(Boolean) : []
  }

  async listPendingInputs({ sessionId }) {
    await this.waitUntilReady()
    if (!sessionId) return []
    const payload = await requestJson({
      url: ENDPOINTS.sessionPending({ serverUrl: this.state.runtime.serverUrl, sessionId }),
      auth: this.auth()
    })
    const pending = responseData(payload, CONTRACT)
    return Array.isArray(pending) ? pending.map(projectPendingInput).filter(Boolean) : []
  }

  // Keep full-fidelity export data inside the main process. Unlike listMessages(), this deliberately
  // skips the renderer projection and the 100-message UI limit so the result matches `opencode export`.
  //
  // The message endpoint is paginated: v2 validates `limit` server-side and rejects anything above
  // EXPORT_PAGE_LIMIT with `HTTP 400 InvalidRequestError ("Expected a value less than or equal to
  // 200")`. Do not raise it to grab a long session in one request — that is the bug this loop fixes.
  // Walking `cursor.next` instead keeps the export complete for sessions of any length; capping the
  // page size without paging would silently truncate them.
  async getSessionExport({ sessionId, directory }) {
    await this.waitUntilReady()
    if (!sessionId) throw new Error("Select a session before exporting it.")
    const messagesUrl = (cursor) => ENDPOINTS.sessionMessages({
      serverUrl: this.state.runtime.serverUrl,
      sessionId,
      limit: EXPORT_PAGE_LIMIT,
      directory,
      cursor
    })
    // Only the first page can run alongside the session info; later pages need the previous cursor.
    const [infoPayload, firstPayload] = await Promise.all([
      requestJson({
        url: `${ENDPOINTS.session({ serverUrl: this.state.runtime.serverUrl, sessionId })}${directory ? `?directory=${encodeURIComponent(directory)}` : ""}`,
        auth: this.auth()
      }),
      requestJson({ url: messagesUrl(), auth: this.auth() })
    ])
    const info = responseData(infoPayload, CONTRACT)
    if (!info) throw new Error(`Session not found: ${sessionId}`)

    const messages = []
    const seenCursors = new Set()
    let payload = firstPayload
    for (;;) {
      const page = responseData(payload, CONTRACT)
      if (!Array.isArray(page)) throw new Error(`Failed to load messages for session: ${sessionId}`)
      messages.push(...page)
      // responseData() unwraps to `data`, so the cursor has to come off the raw envelope.
      const next = payload && typeof payload === "object" ? payload.cursor?.next : null
      // Stop on an exhausted, repeated, or empty-page cursor so a misbehaving server cannot spin
      // this loop forever.
      if (!next || seenCursors.has(next) || !page.length) break
      seenCursors.add(next)
      payload = await requestJson({ url: messagesUrl(next), auth: this.auth() })
    }
    return { info, messages }
  }

  async sendPrompt({ sessionId, inputId, prompt, attachments = [], agents, metadata, delivery, resume }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select or create a session before sending a prompt.")
    if (!inputId) throw new Error("Input ID is required.")
    if (!String(prompt || "").trim()) throw new Error("Prompt is required.")
    const cleanupPaths = []
    this.state.activeSessionId = sessionId
    this.timeline("session.prompt.sent", { sessionId, inputId, delivery, attachmentCount: attachments.length })
    const startTime = Date.now()
    this.log("info", `[Prompt] Sending prompt to runtime session ${sessionId}...`)
    try {
      const cachedPrompt = this.generatedPromptBodies[inputId]
      if (cachedPrompt && cachedPrompt.sessionId !== sessionId) {
        throw new Error("Input ID is already associated with another session.")
      }
      let body = cachedPrompt?.body
      if (!body) {
        let preparedAttachments
        try {
          preparedAttachments = preparePromptAttachments(attachments, cleanupPaths)
        } catch (error) {
          cleanupGeneratedAttachments(cleanupPaths)
          throw error
        }
        this.rememberPendingGeneratedAttachments(sessionId, inputId, cleanupPaths)
        body = buildPromptBody({
          inputId,
          prompt,
          attachments: preparedAttachments,
          agents,
          metadata,
          delivery,
          resume
        })
        if (cleanupPaths.length) {
          this.generatedPromptBodies[inputId] = { sessionId, body, promoted: false }
        }
      }
      const result = await requestJson({
        url: ENDPOINTS.sessionPrompt({ serverUrl: this.state.runtime.serverUrl, sessionId }),
        method: "POST",
        auth: this.auth(),
        body
      })
      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      this.log("info", `[Prompt] Prompt accepted by session in ${duration}s.`)
      return projectPendingInput(responseData(result, CONTRACT))
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      if (/^HTTP \d{3}:/.test(String(error.message || ""))) {
        this.releasePendingGeneratedAttachments(inputId)
      }
      this.log("error", `[Prompt] Prompt failed after ${duration}s: ${error.message}`)
      this.timeline("session.prompt.error", { sessionId, inputId, error: error.message })
      throw error
    }
  }

  async sendCommand({ sessionId, inputId, command, arguments: args = "", delivery, resume }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select or create a session before running a command.")
    if (!inputId) throw new Error("Input ID is required.")
    if (!String(command || "").trim()) throw new Error("Command is required.")
    const body = buildCommandBody({ inputId, command, arguments: args, delivery, resume })
    this.state.activeSessionId = sessionId
    this.timeline("session.command.sent", { sessionId, inputId, command: body.command, delivery })
    const startTime = Date.now()
    this.log("info", `[Command] Dispatching command: /${body.command} to session ${sessionId}...`)
    try {
      const result = await requestJson({
        url: ENDPOINTS.sessionCommand({ serverUrl: this.state.runtime.serverUrl, sessionId }),
        method: "POST",
        auth: this.auth(),
        body,
        timeoutMs: RUNTIME_COMMAND_TIMEOUT_MS
      })
      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      this.log("info", `[Command] Command accepted in ${duration}s.`)
      return projectPendingInput(responseData(result, CONTRACT))
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      this.log("error", `[Command] Command failed after ${duration}s: ${error.message}`)
      this.timeline("session.command.error", { sessionId, inputId, command: body.command, error: error.message })
      throw error
    }
  }

  async activateSkill({ sessionId, skill, resume = true }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select or create a session before activating a skill.")
    if (!String(skill || "").trim()) throw new Error("Skill is required.")
    if (typeof resume !== "boolean") throw new Error("Skill resume must be a boolean.")
    const body = buildSkillBody({ skill, resume })
    this.state.activeSessionId = sessionId
    this.timeline("session.skill.sent", { sessionId, skill: body.skill })
    const startTime = Date.now()
    this.log("info", `[Skill] Activating skill: /${body.skill} in session ${sessionId}...`)
    try {
      await requestJson({
        url: ENDPOINTS.sessionSkill({ serverUrl: this.state.runtime.serverUrl, sessionId }),
        method: "POST",
        auth: this.auth(),
        body
      })
      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      this.log("info", `[Skill] Skill activated in ${duration}s.`)
      return true
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2)
      this.log("error", `[Skill] Skill activation failed after ${duration}s: ${error.message}`)
      this.timeline("session.skill.error", { sessionId, skill: body.skill, error: error.message })
      throw error
    }
  }

  async abortSession({ sessionId }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before stopping a response.")
    this.timeline("session.abort.requested", { sessionId })
    try {
      const result = await requestJson({
        url: ENDPOINTS.sessionAbort({ serverUrl: this.state.runtime.serverUrl, sessionId }),
        method: "POST",
        auth: this.auth()
      })
      this.timeline("session.abort.completed", { sessionId })
      return responseData(result, CONTRACT)
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
        url: ENDPOINTS.session({ serverUrl: this.state.runtime.serverUrl, sessionId }),
        method: "DELETE",
        auth: this.auth()
      })
      delete this.sessionStatuses[sessionId]
      delete this.compactionStatuses[sessionId]
      this.releaseActiveGeneratedAttachments(sessionId)
      this.releasePendingGeneratedAttachmentsForSession(sessionId)
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

  async forkSession({ sessionId, messageId, directory } = {}) {
    await this.waitUntilReady()
    if (!sessionId) throw new Error("Select a session before forking it.")
    const body = messageId
      ? { boundary: { type: "before", messageID: messageId } }
      : { boundary: { type: "through" } }
    this.timeline("session.fork.requested", { sessionId, messageId })
    try {
      const session = projectSession(responseData(await requestJson({
        url: ENDPOINTS.sessionFork({ serverUrl: this.state.runtime.serverUrl, sessionId, directory }),
        method: "POST",
        auth: this.auth(),
        body
      }), CONTRACT))
      this.state.activeSessionId = session?.id || null
      this.timeline("session.fork.completed", { sessionId, forkedSessionId: this.state.activeSessionId })
      this.publish()
      return session
    } catch (error) {
      this.log("error", `Fork failed: ${error.message}`)
      this.timeline("session.fork.error", { sessionId, error: error.message })
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
      const result = await requestJson({
        url: ENDPOINTS.questionReply({ serverUrl: this.state.runtime.serverUrl, sessionId, requestID }),
        method: "POST",
        auth: this.auth(),
        body: { answers: Array.isArray(answers) ? answers : [] }
      })
      return { ok: true, result }
    } catch (error) {
      if (isRequestExpiredError(error)) {
        this.timeline("session.question.reply.expired", { sessionId, requestID })
        return { ok: false, reason: "expired" }
      }
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
      const result = await requestJson({
        url: ENDPOINTS.questionReject({ serverUrl: this.state.runtime.serverUrl, sessionId, requestID }),
        method: "POST",
        auth: this.auth()
      })
      return { ok: true, result }
    } catch (error) {
      if (isRequestExpiredError(error)) {
        this.timeline("session.question.reject.expired", { sessionId, requestID })
        return { ok: false, reason: "expired" }
      }
      this.log("error", `Question reject failed: ${error.message}`)
      this.timeline("session.question.reject.error", { sessionId, requestID, error: error.message })
      throw error
    }
  }

  // Reply to a pending permission.asked request. `reply` is one of "once" | "always" |
  // "reject"; `message` is an optional reason carried with a rejection.
  //
  // Resolves to `{ ok: true, result }`, or `{ ok: false, reason: "expired" }` when the runtime
  // no longer knows the request. Expiry is reported as a value rather than an error because
  // Electron's `ipcRenderer.invoke` only serializes `Error.message` (dropping any `code` we
  // attach) and prefixes it with "Error invoking remote method …" — which is how the raw
  // `HTTP 404: {"_tag":"PermissionNotFoundError",…}` string ended up in front of users.
  async replyPermission({ sessionId, requestID, reply, message }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before responding to a permission request.")
    if (!requestID) throw new Error("Missing permission request id.")
    if (!["once", "always", "reject"].includes(reply)) throw new Error(`Invalid permission reply: ${reply}`)
    this.timeline("session.permission.reply", { sessionId, requestID, reply })
    try {
      const result = await requestJson({
        url: ENDPOINTS.permissionReply({ serverUrl: this.state.runtime.serverUrl, sessionId, requestID }),
        method: "POST",
        auth: this.auth(),
        body: { reply, ...(message ? { message: String(message) } : {}) }
      })
      return { ok: true, result }
    } catch (error) {
      if (isRequestExpiredError(error)) {
        this.timeline("session.permission.reply.expired", { sessionId, requestID, reply })
        return { ok: false, reason: "expired" }
      }
      this.log("error", `Permission reply failed: ${error.message}`)
      this.timeline("session.permission.reply.error", { sessionId, requestID, error: error.message })
      throw error
    }
  }

  // OpenCode keeps pending permissions/questions in a process-local, non-persistent Map. Entries
  // vanish on runtime restart, on session abort, and when a sibling permission in the same
  // session is rejected — and the interrupt path publishes NO event at all. The SSE stream has no
  // replay cursor either, so a reconnect silently misses whatever was emitted while it was down.
  // These list endpoints read the very Map the reply endpoint looks up, which makes them the only
  // reliable way to drop cards the runtime has already forgotten.
  //
  // Both resolve to `null` when the lookup itself failed, so callers can tell "the runtime has no
  // pending requests" (`[]`) from "we could not find out" (`null`) and never evict on a blip.
  async listPendingPermissions() {
    return this.listPendingRequests("permission", projectPermission)
  }

  async listPendingQuestions() {
    return this.listPendingRequests("question", projectQuestion)
  }

  async listPendingForms() {
    if (this.state.status !== "running" || !this.state.runtime?.serverUrl) return null
    try {
      const payload = await requestJson({
        url: ENDPOINTS.formPending({ serverUrl: this.state.runtime.serverUrl }),
        auth: this.auth()
      })
      if (!isCatalogPayload(payload)) {
        this.log("warn", "Pending form lookup returned an unrecognised payload shape.")
        return null
      }
      return catalogItems(payload).map(projectForm).filter(Boolean).map((form) => ({ ...form, requestID: form.id }))
    } catch (error) {
      this.log("warn", `Pending form lookup failed: ${error.message}`)
      return null
    }
  }

  async replyForm({ sessionId, formID, answer }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before answering a form.")
    if (!formID) throw new Error("Missing form id.")
    try {
      await requestJson({
        url: ENDPOINTS.formReply({ serverUrl: this.state.runtime.serverUrl, sessionId, formID }),
        method: "POST",
        auth: this.auth(),
        body: { answer: answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {} }
      })
      return { ok: true }
    } catch (error) {
      if (isRequestExpiredError(error)) return { ok: false, reason: "expired" }
      throw error
    }
  }

  async cancelForm({ sessionId, formID }) {
    this.assertReady()
    if (!sessionId) throw new Error("Select a session before cancelling a form.")
    if (!formID) throw new Error("Missing form id.")
    try {
      await requestJson({
        url: ENDPOINTS.formCancel({ serverUrl: this.state.runtime.serverUrl, sessionId, formID }),
        method: "POST",
        auth: this.auth()
      })
      return { ok: true }
    } catch (error) {
      if (isRequestExpiredError(error)) return { ok: false, reason: "expired" }
      throw error
    }
  }

  async listPendingRequests(kind, project) {
    if (this.state.status !== "running" || !this.state.runtime?.serverUrl) return null
    try {
      const payload = await requestJson({
        url: `${this.state.runtime.serverUrl}/${kind}`,
        auth: this.auth()
      })
      // catalogItems() flattens anything it does not recognise to `[]`, which the renderer would
      // read as "the runtime has nothing pending" and use to evict every card. A 200 carrying an
      // unexpected body (an unknown envelope, or the silent HTML fallback a wrong URL returns) is
      // "we could not find out", so it has to come back as `null` like a thrown error does.
      if (!isCatalogPayload(payload)) {
        this.log("warn", `Pending ${kind} lookup returned an unrecognised payload shape.`)
        return null
      }
      return catalogItems(payload)
        .map((item) => {
          const requestID = requestIdOf(item)
          if (!requestID || !item?.sessionID) return null
          return { requestID, sessionID: String(item.sessionID), ...project(item) }
        })
        .filter(Boolean)
    } catch (error) {
      this.log("warn", `Pending ${kind} lookup failed: ${error.message}`)
      return null
    }
  }

  async waitForHealth(serverUrl, auth) {
    const deadline = Date.now() + this.healthStartupTimeoutMs
    let lastError = null
    while (Date.now() < deadline) {
      if (this.state.status === "error") {
        throw new Error(this.state.lastError || "Runtime failed during startup.")
      }
      if (!this.child) {
        throw new Error(this.state.lastError || "Runtime process exited before health check completed.")
      }
      try {
        const remainingMs = Math.max(1, deadline - Date.now())
        await requestJson({
          url: ENDPOINTS.health({ serverUrl }),
          auth,
          timeoutMs: Math.min(this.healthRequestTimeoutMs, remainingMs)
        })
        return
      } catch (error) {
        lastError = error
        const remainingMs = deadline - Date.now()
        if (remainingMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(this.healthRetryDelayMs, remainingMs)))
        }
      }
    }
    const error = new Error(this.launchErrorMessage(`Runtime did not become healthy: ${lastError?.message || "timeout"}`))
    this.failLaunch(error)
    throw error
  }

  recentRuntimeOutput() {
    const lines = []
    for (const entry of this.state.logs.slice(-20)) {
      if (!["stdout", "stderr", "error"].includes(entry.level)) continue
      for (const line of String(entry.message || "").split(/\r?\n/).filter(Boolean)) {
        lines.push(`${entry.level}: ${line}`)
      }
    }
    const output = lines.slice(-8).join("\n").slice(-2000)
    return output ? `\nRecent runtime output:\n${output}` : ""
  }

  launchErrorMessage(message) {
    return `${message}${this.filePermissionHint(message)}${this.recentRuntimeOutput()}`
  }

  // On the first launch after an app upgrade, macOS may withhold file access to the
  // project folder (its TCC grant is bound to the app's code signature, which changes
  // on every unsigned/ad-hoc build). The runtime then fails to spawn or become healthy
  // with a permission error. Detect that shape and add an actionable hint so the user
  // sees "grant file access" instead of a bare "did not become healthy".
  filePermissionHint(message) {
    const hint = filePermissionHintText(message)
    return hint ? `\n${hint}` : ""
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
      const response = await fetch(ENDPOINTS.events({ serverUrl }), {
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
    const properties = eventPayload(event, CONTRACT)
    this.subagentRuns.applyEvent(event)
    // Match on the canonical name: v2 renames several of these, and comparing the raw runtime
    // name here would silently skip the busy/idle bookkeeping below on v2.
    const canonicalType = canonicalEventType(event.type)
    let publish = false
    if (canonicalType === "session.status" && properties.sessionID) {
      // v2's execution.started canonicalizes to session.status but carries no status payload.
      const sessionStatus = event.type === EVENTS.sessionExecutionStarted
        ? { type: "busy" }
        : properties.status || { type: "idle" }
      this.sessionStatuses[properties.sessionID] = sessionStatus
      if (sessionStatus.type === "idle") this.releaseActiveGeneratedAttachments(properties.sessionID)
      if (properties.sessionID === this.state.activeSessionId) {
        this.state.activity = sessionStatus.type === "idle" ? "idle" : "running"
        publish = true
      }
    }
    if (canonicalType === "session.idle" && properties.sessionID) {
      this.sessionStatuses[properties.sessionID] = { type: "idle" }
      this.releaseActiveGeneratedAttachments(properties.sessionID)
      if (properties.sessionID === this.state.activeSessionId) {
        this.state.activity = "idle"
        publish = true
      }
    }
    if (canonicalType === "session.aborted" && properties.sessionID) {
      this.sessionStatuses[properties.sessionID] = { type: "idle" }
      this.releaseActiveGeneratedAttachments(properties.sessionID)
      if (properties.sessionID === this.state.activeSessionId) {
        this.state.activity = "idle"
        publish = true
      }
    }
    if (canonicalType === "session.error") {
      if (properties.sessionID) this.releaseActiveGeneratedAttachments(properties.sessionID)
      else this.cleanupAllActiveGeneratedAttachments()
      if (properties.sessionID) this.sessionStatuses[properties.sessionID] = { type: "idle" }
      if (!properties.sessionID || properties.sessionID === this.state.activeSessionId) {
        this.state.activity = "idle"
        this.state.lastError = sessionErrorMessage(properties.error)
        publish = true
      }
    }
    if (event.type === EVENTS.sessionCompactionAdmitted && properties.sessionID) {
      this.compactionStatuses[properties.sessionID] = {
        status: "admitted",
        reason: properties.reason || "manual",
        ...(properties.inputID ? { inputID: properties.inputID } : {})
      }
      publish = true
    }
    if (event.type === EVENTS.sessionInputPromoted && properties.sessionID && properties.inputID) {
      this.activatePendingGeneratedAttachments(properties.sessionID, properties.inputID)
    }
    if (event.type === EVENTS.sessionCompactionStarted && properties.sessionID) {
      this.compactionStatuses[properties.sessionID] = {
        status: "running",
        reason: properties.reason || "manual"
      }
      publish = true
    }
    if (event.type === EVENTS.sessionCompactionEnded && properties.sessionID) {
      this.compactionStatuses[properties.sessionID] = {
        status: "ended",
        reason: properties.reason || "manual"
      }
      publish = true
    }
    if (event.type === EVENTS.sessionCompactionFailed && properties.sessionID) {
      this.compactionStatuses[properties.sessionID] = {
        status: "failed",
        reason: properties.reason || "manual",
        error: sessionErrorMessage(properties.error)
      }
      publish = true
    }
    if (event.type === EVENTS.sessionStepEnded && properties.sessionID && this.compactionStatuses[properties.sessionID]?.status === "ended") {
      delete this.compactionStatuses[properties.sessionID]
      publish = true
    }
    // Debug tool steps in the Runtime diagnostics logs
    if (canonicalType === "message.part.updated" && properties.part?.type === "tool") {
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

  rememberPendingGeneratedAttachments(sessionId, inputId, cleanupPaths = []) {
    if (!sessionId || !inputId || !cleanupPaths.length) return
    const entry = this.pendingGeneratedAttachmentPaths[inputId] || { sessionId, paths: [] }
    for (const cleanupPath of cleanupPaths) {
      if (cleanupPath && !entry.paths.includes(cleanupPath)) entry.paths.push(cleanupPath)
    }
    this.pendingGeneratedAttachmentPaths[inputId] = entry
  }

  activatePendingGeneratedAttachments(sessionId, inputId) {
    const entry = this.pendingGeneratedAttachmentPaths[inputId]
    if (!entry || entry.sessionId !== sessionId) return
    delete this.pendingGeneratedAttachmentPaths[inputId]
    if (this.generatedPromptBodies[inputId]) this.generatedPromptBodies[inputId].promoted = true
    const known = this.sessionGeneratedAttachmentPaths[sessionId] || []
    for (const cleanupPath of entry.paths) {
      if (cleanupPath && !known.includes(cleanupPath)) known.push(cleanupPath)
    }
    this.sessionGeneratedAttachmentPaths[sessionId] = known
  }

  releasePendingGeneratedAttachments(inputId) {
    const entry = this.pendingGeneratedAttachmentPaths[inputId]
    delete this.pendingGeneratedAttachmentPaths[inputId]
    if (!this.generatedPromptBodies[inputId]?.promoted) delete this.generatedPromptBodies[inputId]
    cleanupGeneratedAttachments(entry?.paths)
  }

  releasePendingGeneratedAttachmentsForSession(sessionId) {
    for (const [inputId, entry] of Object.entries(this.pendingGeneratedAttachmentPaths)) {
      if (entry.sessionId === sessionId) this.releasePendingGeneratedAttachments(inputId)
    }
  }

  releaseActiveGeneratedAttachments(sessionId) {
    if (!sessionId) return
    const cleanupPaths = this.sessionGeneratedAttachmentPaths[sessionId]
    delete this.sessionGeneratedAttachmentPaths[sessionId]
    for (const [inputId, entry] of Object.entries(this.generatedPromptBodies)) {
      if (entry.sessionId === sessionId && entry.promoted) delete this.generatedPromptBodies[inputId]
    }
    cleanupGeneratedAttachments(cleanupPaths)
  }

  cleanupAllActiveGeneratedAttachments() {
    for (const sessionId of Object.keys(this.sessionGeneratedAttachmentPaths)) {
      this.releaseActiveGeneratedAttachments(sessionId)
    }
  }

  cleanupAllSessionGeneratedAttachments() {
    for (const inputId of Object.keys(this.pendingGeneratedAttachmentPaths)) {
      this.releasePendingGeneratedAttachments(inputId)
    }
    this.cleanupAllActiveGeneratedAttachments()
    this.generatedPromptBodies = {}
  }
}

module.exports = {
  RuntimeProcessManager,
  buildPromptBody,
  buildCommandBody,
  buildSkillBody,
  buildPromptParts,
  findFreePort,
  normalizeModelRef,
  projectPendingInput,
  projectMessage,
  projectMessagePart,
  projectReferenceInfo,
  projectSavedPermission,
  projectFileSystemEntry,
  projectPtyInfo,
  projectRuntimeEvent,
  projectSessionRevert,
  projectQuestion,
  projectPermission,
  projectToolMetadata,
  requestJson,
  requestBuffer,
  requestSseJson,
  resolveRuntimeBin,
  resolveUserPath,
  sidebarSessions,
  pathHasExecutable,
  translationGatewayEnv
}
