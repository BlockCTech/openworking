const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const AdmZip = require("adm-zip")
const { defaultConfigPath, ensureDefaultAgentPrompt, ensureDefaultManagedModelConfig, ensureOpencodeConfig, readOpencodeConfig, writeOpencodeConfig } = require("./opencode-config")
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MCP_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MCP_SERVER_TYPES = ["remote", "local"]

const BUILT_IN_SKILLS = [
  { name: "explain-project", description: "Explain the structure and main execution paths of the current project." },
  { name: "find-bugs", description: "Inspect the current project for likely defects and risky behavior." },
  { name: "write-tests", description: "Add focused automated tests for the requested behavior." },
  { name: "summarize-changes", description: "Summarize repository changes and their impact." },
  { name: "code-review", description: "Review code changes for bugs, regressions and missing tests." },
  { name: "docs-update", description: "Update project documentation to match implemented behavior." },
  { name: "pdf", description: "Read, create, transform and validate PDF documents." },
  { name: "pptx", description: "Read, create, edit and visually validate PowerPoint presentations." },
  { name: "skill-creator", description: "Create and validate reusable OpenCode-native skills." },
  { name: "xlsx", description: "Read, create, edit and validate spreadsheet workbooks." },
  { name: "docx", description: "Read, create, edit and visually validate Word documents." },
  { name: "translate-document", description: "Translate PDF, DOCX and Markdown files into new structure-preserving document artifacts." },
  { name: "translate-office-document", description: "Translate PPTX and XLSX files; for XLSX, create a new translated workbook or add a translated sheet beside each original in place." },
  { name: "webapp-testing", description: "Test local web applications with the project's existing tools or Playwright." }
]
const BUILT_IN_TOOLS = ["translate_document.js"]

function defaultProfileDir(userDataPath) {
  if (process.env.OPENWORKING_OPENCODE_CONFIG_DIR) {
    return path.resolve(process.env.OPENWORKING_OPENCODE_CONFIG_DIR)
  }
  return path.join(userDataPath, "opencode-profile")
}

function bundledOpencodeDir() {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, "opencode")
  if (packaged && fs.existsSync(packaged)) return packaged
  return path.join(__dirname, "..", "resources", "opencode")
}

function bundledSkillsDir() {
  return path.join(bundledOpencodeDir(), "skills")
}

function directoryFiles(directory, relativeDir = "") {
  const files = []
  for (const entry of fs.readdirSync(path.join(directory, relativeDir), { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name)
    if (entry.isDirectory()) files.push(...directoryFiles(directory, relativePath))
    if (entry.isFile()) files.push(relativePath)
  }
  return files.sort()
}

function directoryDigest(directory) {
  const digest = crypto.createHash("sha256")
  for (const relativePath of directoryFiles(directory)) {
    const filePath = path.join(directory, relativePath)
    const mode = fs.statSync(filePath).mode & 0o777
    digest.update(relativePath)
    digest.update("\0")
    digest.update(mode.toString(8))
    digest.update("\0")
    digest.update(fs.readFileSync(filePath))
    digest.update("\0")
  }
  return digest.digest("hex")
}

function readSkillsManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return { skills: {} }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    if (manifest && manifest.skills && typeof manifest.skills === "object" && !Array.isArray(manifest.skills)) return manifest
  } catch {}
  return { skills: {} }
}

function readToolsManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return { tools: {} }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    if (manifest && manifest.tools && typeof manifest.tools === "object" && !Array.isArray(manifest.tools)) return manifest
  } catch {}
  return { tools: {} }
}

function fileDigest(filePath) {
  const digest = crypto.createHash("sha256")
  digest.update(fs.readFileSync(filePath))
  return digest.digest("hex")
}

function syncBuiltInSkills(profileDir, sourceDir = bundledSkillsDir()) {
  const skillsDir = path.join(profileDir, "skills")
  fs.mkdirSync(skillsDir, { recursive: true })
  const manifestPath = path.join(profileDir, ".openworking-skills.json")
  const previous = readSkillsManifest(manifestPath)
  const manifest = {}

  const bundledNames = new Set(BUILT_IN_SKILLS.map((skill) => skill.name))
  for (const name of Object.keys(previous.skills)) {
    if (!bundledNames.has(name)) fs.rmSync(path.join(skillsDir, name), { force: true, recursive: true })
  }

  for (const skill of BUILT_IN_SKILLS) {
    const source = path.join(sourceDir, skill.name)
    const targetDir = path.join(skillsDir, skill.name)
    const digest = directoryDigest(source)
    manifest[skill.name] = digest
    if (fs.existsSync(targetDir) && directoryDigest(targetDir) === digest) continue
    fs.rmSync(targetDir, { force: true, recursive: true })
    fs.cpSync(source, targetDir, { recursive: true })
  }

  const serialized = `${JSON.stringify({ skills: manifest }, null, 2)}\n`
  if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, "utf8") !== serialized) {
    fs.writeFileSync(manifestPath, serialized)
  }
  return { sourceDir, skillsDir, manifestPath, skills: BUILT_IN_SKILLS }
}

function isZipSymlink(entry) {
  return (((entry.header?.attr || 0) >>> 16) & 0o170000) === 0o120000
}

function normalizedZipPath(entryName) {
  const name = String(entryName || "").replace(/\\/g, "/")
  if (!name || path.posix.isAbsolute(name)) return null
  const parts = name.split("/").filter(Boolean)
  if (!parts.length || parts.some((part) => part === "." || part === "..")) return null
  return parts.join("/")
}

function isIgnoredZipEntry(relativePath) {
  return relativePath === ".DS_Store" || relativePath.startsWith("__MACOSX/")
}

function parseSkillFrontmatter(markdown) {
  const lines = String(markdown || "").split(/\r?\n/)
  if (lines[0] !== "---") throw new Error("SKILL.md must start with YAML frontmatter.")
  const end = lines.findIndex((line, index) => index > 0 && line === "---")
  if (end < 0) throw new Error("SKILL.md frontmatter must be closed with ---.")

  const data = {}
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2")
    data[match[1]] = value
  }
  return data
}

function assertValidSkillName(name) {
  if (typeof name !== "string" || name.length < 1 || name.length > 64 || !SKILL_NAME_PATTERN.test(name)) {
    throw new Error("Skill name must use lowercase ASCII letters, digits, and single hyphens only.")
  }
}

function installCustomSkillArchive(profile, archivePath) {
  if (!archivePath || !fs.existsSync(archivePath)) throw new Error("Choose a skill archive to upload.")
  const extension = path.extname(archivePath).toLowerCase()
  if (extension !== ".zip" && extension !== ".skill") throw new Error("Skill archive must be a .zip or .skill file.")

  const zip = new AdmZip(archivePath)
  const files = []
  for (const entry of zip.getEntries()) {
    const relativePath = normalizedZipPath(entry.entryName)
    if (!relativePath) throw new Error(`Unsafe zip entry: ${entry.entryName}`)
    if (isIgnoredZipEntry(relativePath)) continue
    if (isZipSymlink(entry)) throw new Error(`Symlinks are not allowed in skill archives: ${relativePath}`)
    if (!entry.isDirectory) files.push({ entry, relativePath })
  }
  if (!files.length) throw new Error("Skill archive is empty.")

  const rootSkill = files.find((file) => file.relativePath === "SKILL.md")
  const topLevelNames = new Set(files.map((file) => file.relativePath.split("/")[0]))
  let rootPrefix = ""
  let skillFile = rootSkill
  if (!skillFile) {
    if (topLevelNames.size !== 1) throw new Error("Skill archive must contain SKILL.md at the root or inside one top-level folder.")
    rootPrefix = `${[...topLevelNames][0]}/`
    skillFile = files.find((file) => file.relativePath === `${rootPrefix}SKILL.md`)
  }
  if (!skillFile) throw new Error("Skill archive must include a SKILL.md file.")

  const frontmatter = parseSkillFrontmatter(skillFile.entry.getData().toString("utf8"))
  const name = frontmatter.name
  const description = frontmatter.description
  assertValidSkillName(name)
  if (!description) throw new Error("SKILL.md frontmatter must include a description.")
  if (rootPrefix && rootPrefix.slice(0, -1) !== name) throw new Error("Skill folder name must match SKILL.md frontmatter name.")
  if (BUILT_IN_SKILLS.some((skill) => skill.name === name)) throw new Error(`Skill "${name}" is built in and cannot be overwritten.`)

  const skillsDir = path.join(profile.profileDir, "skills")
  const targetDir = path.join(skillsDir, name)
  if (fs.existsSync(targetDir)) throw new Error(`Skill "${name}" already exists.`)

  fs.mkdirSync(targetDir, { recursive: true })
  try {
    for (const file of files) {
      if (rootPrefix && !file.relativePath.startsWith(rootPrefix)) throw new Error(`Unexpected file outside skill folder: ${file.relativePath}`)
      const targetRelativePath = rootPrefix ? file.relativePath.slice(rootPrefix.length) : file.relativePath
      if (!targetRelativePath) continue
      const targetPath = path.join(targetDir, targetRelativePath)
      const resolvedTarget = path.resolve(targetPath)
      if (!resolvedTarget.startsWith(`${path.resolve(targetDir)}${path.sep}`) && resolvedTarget !== path.resolve(targetDir)) {
        throw new Error(`Unsafe zip entry: ${file.relativePath}`)
      }
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.writeFileSync(targetPath, file.entry.getData())
    }

    const config = readProfileConfig(profile).config
    config.permission ||= {}
    config.permission.skill ||= {}
    config.permission.skill[name] = "allow"
    writeProfileConfig(profile, config)
    return { name, description, path: targetDir }
  } catch (error) {
    fs.rmSync(targetDir, { force: true, recursive: true })
    throw error
  }
}

function listCustomSkills(profile) {
  const skillsDir = path.join(profile.profileDir, "skills")
  if (!fs.existsSync(skillsDir)) return []
  const builtInNames = new Set(BUILT_IN_SKILLS.map((skill) => skill.name))
  return fs.readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !builtInNames.has(entry.name))
    .map((entry) => {
      const skillPath = path.join(skillsDir, entry.name, "SKILL.md")
      if (!fs.existsSync(skillPath)) return null
      try {
        const frontmatter = parseSkillFrontmatter(fs.readFileSync(skillPath, "utf8"))
        return {
          name: frontmatter.name || entry.name,
          description: frontmatter.description || "",
          path: path.join(skillsDir, entry.name)
        }
      } catch {
        return {
          name: entry.name,
          description: "",
          path: path.join(skillsDir, entry.name)
        }
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function readSkillMarkdown(profile, skillName) {
  const name = String(skillName || "")
  assertValidSkillName(name)
  const skillPath = path.join(profile.profileDir, "skills", name, "SKILL.md")
  if (!fs.existsSync(skillPath)) throw new Error(`Skill "${name}" has no SKILL.md.`)
  return { name, content: fs.readFileSync(skillPath, "utf8") }
}

function uninstallCustomSkill(profile, skillName) {
  const name = String(skillName || "")
  assertValidSkillName(name)
  if (BUILT_IN_SKILLS.some((skill) => skill.name === name)) {
    throw new Error(`Skill "${name}" is built in and cannot be uninstalled.`)
  }
  const targetDir = path.join(profile.profileDir, "skills", name)
  if (!fs.existsSync(targetDir)) throw new Error(`Skill "${name}" is not installed.`)
  fs.rmSync(targetDir, { force: true, recursive: true })

  const config = readProfileConfig(profile).config
  if (config.permission?.skill && name in config.permission.skill) {
    delete config.permission.skill[name]
    writeProfileConfig(profile, config)
  }
  return { name }
}

function assertValidMcpName(name) {
  if (typeof name !== "string" || name.length < 1 || name.length > 64 || !MCP_NAME_PATTERN.test(name)) {
    throw new Error("MCP server name must use lowercase ASCII letters, digits, and single hyphens only.")
  }
}

function mcpServerView(name, server) {
  const view = { name, type: server.type, enabled: server.enabled !== false }
  if (server.type === "remote") {
    view.url = server.url || ""
    view.headers = server.headers && typeof server.headers === "object" ? { ...server.headers } : {}
    // Surface the OAuth config to the renderer with the client secret redacted — the
    // raw secret must never cross the IPC boundary into renderer state or the JSON preview.
    if (server.oauth === false) {
      view.oauth = false
    } else if (server.oauth && typeof server.oauth === "object") {
      view.oauth = {
        clientId: server.oauth.clientId || "",
        scope: server.oauth.scope || "",
        callbackPort: server.oauth.callbackPort,
        redirectUri: server.oauth.redirectUri || "",
        hasClientSecret: !!server.oauth.clientSecret
      }
    } else {
      view.oauth = undefined
    }
  } else {
    view.command = Array.isArray(server.command) ? [...server.command] : []
  }
  return view
}

function listMcpServers(profile) {
  const config = readProfileConfig(profile).config
  return Object.entries(config.mcp || {})
    .map(([name, server]) => (server && typeof server === "object" ? mcpServerView(name, server) : null))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {}
  const result = {}
  for (const [key, value] of Object.entries(headers)) {
    const trimmedKey = String(key || "").trim()
    if (trimmedKey) result[trimmedKey] = String(value ?? "")
  }
  return result
}

// Build the `oauth` value written to opencode.json from the renderer's input.
//   - false        → disable OpenCode OAuth auto-detection.
//   - object       → a pre-registered OAuth app (clientId/clientSecret/scope/…) for
//                    servers that do not support dynamic client registration (e.g. Slack).
//   - true/omitted → omit `oauth` so the runtime auto-negotiates (DCR + PKCE).
// `existing` is the previously stored oauth object, used to preserve a secret the user
// left blank while editing.
function normalizeOauth(input, existing) {
  if (input === false) return false
  if (!input || typeof input !== "object") return undefined
  const oauth = {}
  const clientId = String(input.clientId || "").trim()
  const scope = String(input.scope || "").trim()
  const redirectUri = String(input.redirectUri || "").trim()
  let clientSecret = String(input.clientSecret || "").trim()
  // Preserve the stored secret when editing and the field was left blank.
  if (!clientSecret && existing && typeof existing === "object" && existing.clientSecret) {
    clientSecret = existing.clientSecret
  }
  if (clientId) oauth.clientId = clientId
  if (clientSecret) oauth.clientSecret = clientSecret
  if (scope) oauth.scope = scope
  if (redirectUri) oauth.redirectUri = redirectUri
  if (input.callbackPort !== undefined && input.callbackPort !== null && input.callbackPort !== "") {
    const port = Number(input.callbackPort)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("OAuth callback port must be an integer between 1 and 65535.")
    }
    oauth.callbackPort = port
  }
  return Object.keys(oauth).length ? oauth : undefined
}

function buildMcpServer(input, existing) {
  const type = input?.type
  if (!MCP_SERVER_TYPES.includes(type)) throw new Error('MCP server type must be "remote" or "local".')

  if (type === "remote") {
    const url = String(input.url || "").trim()
    if (!url) throw new Error("Remote MCP server requires a server URL.")
    const server = { type: "remote", url, enabled: true }
    const headers = normalizeHeaders(input.headers)
    if (Object.keys(headers).length) server.headers = headers
    const oauth = normalizeOauth(input.oauth, existing && existing.type === "remote" ? existing.oauth : undefined)
    if (oauth !== undefined) server.oauth = oauth
    return server
  }

  const command = (Array.isArray(input.command)
    ? input.command
    : String(input.command || "").split(/\s+/))
    .map((part) => String(part).trim())
    .filter(Boolean)
  if (!command.length) throw new Error("Local MCP server requires a command.")
  return { type: "local", command, enabled: true }
}

function addMcpServer(profile, input) {
  const name = String(input?.name || "").trim()
  assertValidMcpName(name)
  const config = readProfileConfig(profile).config
  config.mcp ||= {}
  if (config.mcp[name]) throw new Error(`MCP server "${name}" already exists.`)
  const server = buildMcpServer(input)
  config.mcp[name] = server
  writeProfileConfig(profile, config)
  return mcpServerView(name, server)
}

function updateMcpServer(profile, name, input) {
  const serverName = String(name || "").trim()
  assertValidMcpName(serverName)
  const config = readProfileConfig(profile).config
  const existing = config.mcp && config.mcp[serverName]
  if (!existing) throw new Error(`MCP server "${serverName}" does not exist.`)
  // Rebuild from the new input, preserving the enabled flag and any stored secret the
  // user left blank while editing.
  const server = buildMcpServer({ ...input, type: input?.type || existing.type }, existing)
  server.enabled = existing.enabled !== false
  config.mcp[serverName] = server
  writeProfileConfig(profile, config)
  return mcpServerView(serverName, server)
}

function setMcpServerEnabled(profile, name, enabled) {
  const serverName = String(name || "")
  assertValidMcpName(serverName)
  const config = readProfileConfig(profile).config
  if (!config.mcp || !config.mcp[serverName]) throw new Error(`MCP server "${serverName}" does not exist.`)
  config.mcp[serverName].enabled = !!enabled
  writeProfileConfig(profile, config)
  return mcpServerView(serverName, config.mcp[serverName])
}

function removeMcpServer(profile, name) {
  const serverName = String(name || "")
  assertValidMcpName(serverName)
  const config = readProfileConfig(profile).config
  if (!config.mcp || !config.mcp[serverName]) throw new Error(`MCP server "${serverName}" does not exist.`)
  delete config.mcp[serverName]
  writeProfileConfig(profile, config)
  return { name: serverName }
}

function syncBuiltInTools(profileDir, sourceDir = bundledOpencodeDir()) {
  const sourceToolsDir = path.join(sourceDir, "tools")
  const toolsDir = path.join(profileDir, "tools")
  fs.mkdirSync(toolsDir, { recursive: true })
  const manifestPath = path.join(profileDir, ".openworking-tools.json")
  const previous = readToolsManifest(manifestPath)
  const manifest = {}

  for (const name of Object.keys(previous.tools)) {
    if (!BUILT_IN_TOOLS.includes(name)) fs.rmSync(path.join(toolsDir, name), { force: true })
  }

  for (const name of BUILT_IN_TOOLS) {
    const source = path.join(sourceToolsDir, name)
    const target = path.join(toolsDir, name)
    const digest = fileDigest(source)
    manifest[name] = digest
    if (fs.existsSync(target) && fileDigest(target) === digest) continue
    fs.copyFileSync(source, target)
  }

  const sourceRuntimeDir = path.join(sourceDir, "document-tools")
  const runtimeDir = path.join(profileDir, "document-tools")
  const runtimeDigest = directoryDigest(sourceRuntimeDir)
  if (!fs.existsSync(runtimeDir) || directoryDigest(runtimeDir) !== runtimeDigest) {
    fs.rmSync(runtimeDir, { force: true, recursive: true })
    fs.cpSync(sourceRuntimeDir, runtimeDir, { recursive: true })
  }

  const serialized = `${JSON.stringify({ tools: manifest, documentTools: runtimeDigest }, null, 2)}\n`
  if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, "utf8") !== serialized) {
    fs.writeFileSync(manifestPath, serialized)
  }
  return { sourceDir, toolsDir, runtimeDir, manifestPath, tools: BUILT_IN_TOOLS }
}

function ensureSkillPermissions(config) {
  config.permission ||= {}
  config.permission.skill ||= {}
  for (const skill of BUILT_IN_SKILLS) {
    if (!config.permission.skill[skill.name]) config.permission.skill[skill.name] = "allow"
  }
  return config
}

function ensureOpenworkingProfile({ userDataPath }) {
  const profileDir = defaultProfileDir(userDataPath)
  const configPath = defaultConfigPath(profileDir)
  fs.mkdirSync(profileDir, { recursive: true })
  const skills = syncBuiltInSkills(profileDir)
  const tools = syncBuiltInTools(profileDir)
  const current = ensureOpencodeConfig(configPath)
  const config = ensureDefaultAgentPrompt(ensureSkillPermissions(ensureDefaultManagedModelConfig(current.config)))
  writeOpencodeConfig(config, configPath)
  return { profileDir, configPath, skills, tools }
}

function readProfileConfig(profile) {
  return readOpencodeConfig(profile.configPath)
}

function writeProfileConfig(profile, config) {
  return writeOpencodeConfig(ensureDefaultAgentPrompt(ensureSkillPermissions(ensureDefaultManagedModelConfig(config))), profile.configPath)
}

function writeEditableProfileConfig(profile, edits) {
  const config = readProfileConfig(profile).config
  const submittedProviders = edits?.provider || {}
  for (const [providerId, provider] of Object.entries(config.provider || {})) {
    const submittedProvider = submittedProviders[providerId]
    if (!submittedProvider) continue
    provider.options ||= {}
    if (Object.hasOwn(submittedProvider.options || {}, "baseURL")) provider.options.baseURL = submittedProvider.options.baseURL
    if (Object.hasOwn(submittedProvider.options || {}, "apiKey")) provider.options.apiKey = submittedProvider.options.apiKey
    for (const [modelId, model] of Object.entries(provider.models || {})) {
      const submittedModel = submittedProvider.models?.[modelId]
      if (Object.hasOwn(submittedModel?.modalities || {}, "input")) {
        model.modalities ||= {}
        model.modalities.input = submittedModel.modalities.input
      }
    }
  }
  if (Object.hasOwn(edits || {}, "plugin")) config.plugin = edits.plugin
  config.permission ||= {}
  config.permission.skill ||= {}
  for (const skill of BUILT_IN_SKILLS) {
    if (Object.hasOwn(edits?.permission?.skill || {}, skill.name)) {
      config.permission.skill[skill.name] = edits.permission.skill[skill.name]
    }
  }
  return writeProfileConfig(profile, config)
}

module.exports = {
  BUILT_IN_SKILLS,
  BUILT_IN_TOOLS,
  bundledOpencodeDir,
  bundledSkillsDir,
  defaultProfileDir,
  directoryDigest,
  ensureOpenworkingProfile,
  ensureSkillPermissions,
  installCustomSkillArchive,
  listCustomSkills,
  readSkillMarkdown,
  uninstallCustomSkill,
  addMcpServer,
  updateMcpServer,
  listMcpServers,
  removeMcpServer,
  setMcpServerEnabled,
  readProfileConfig,
  syncBuiltInSkills,
  syncBuiltInTools,
  writeEditableProfileConfig,
  writeProfileConfig
}
