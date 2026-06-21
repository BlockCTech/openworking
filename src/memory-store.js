const fs = require("node:fs")
const path = require("node:path")

// Cross-chat memory: durable facts the assistant should recall across separate chat sessions.
// OpenCode natively loads the global AGENTS.md from its config dir (the app-managed profile) and
// any files listed in opencode.json `instructions` into every session's system prompt. We own two
// memory files inside the profile (never the user's project folder, never ~/.config/opencode):
//
//   <profile>/AGENTS.md             -> global memory (loaded automatically by OpenCode)
//   <profile>/memory/<projectId>.md -> per-project memory (referenced via `instructions`)
//
// A managed memory file is a Markdown bullet list under a recognizable header. We own the file
// via the header marker so we can append/replace it safely and never clobber unrelated content.

const MEMORY_DIR_NAME = "memory"
const GLOBAL_MEMORY_FILE = "AGENTS.md"
const MEMORY_MARKER = "<!-- OpenWorking managed memory."
const SCOPES = ["global", "project"]
const PROJECT_ID_PATTERN = /^proj_[a-f0-9]{16}$/

function memoryHeader(scope) {
  const note = scope === "global"
    ? "Facts the assistant should remember across every chat and project."
    : "Facts the assistant should remember across chats in this project."
  return `${MEMORY_MARKER} ${note} -->\n# Memory\n`
}

function assertProjectId(projectId) {
  const id = String(projectId || "")
  if (!PROJECT_ID_PATTERN.test(id)) throw new Error("Invalid project id for memory store.")
  return id
}

function globalMemoryPath(profileDir) {
  return path.join(profileDir, GLOBAL_MEMORY_FILE)
}

function projectMemoryDir(profileDir) {
  return path.join(profileDir, MEMORY_DIR_NAME)
}

function projectMemoryPath(profileDir, projectId) {
  return path.join(projectMemoryDir(profileDir), `${assertProjectId(projectId)}.md`)
}

function memoryPath(profileDir, scope, projectId) {
  if (scope === "global") return globalMemoryPath(profileDir)
  if (scope === "project") return projectMemoryPath(profileDir, projectId)
  throw new Error(`Invalid memory scope: ${scope}`)
}

// True for an `instructions` entry that points at one of our per-project memory files. Used so we
// can swap the single managed entry to the active project without disturbing a user's own entries.
function isManagedInstruction(profileDir, entry) {
  if (typeof entry !== "string") return false
  const dir = projectMemoryDir(profileDir)
  const resolved = path.resolve(entry)
  return resolved === dir || resolved.startsWith(`${dir}${path.sep}`)
}

// Create a memory file with just the header if it does not exist yet. Idempotent.
function ensureMemoryFile(filePath, scope) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, memoryHeader(scope))
  return filePath
}

function ensureGlobalMemory(profileDir) {
  return ensureMemoryFile(globalMemoryPath(profileDir), "global")
}

function ensureProjectMemory(profileDir, projectId) {
  return ensureMemoryFile(projectMemoryPath(profileDir, projectId), "project")
}

function readMemory(profileDir, scope, projectId) {
  const filePath = memoryPath(profileDir, scope, projectId)
  try {
    return fs.readFileSync(filePath, "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return ""
    throw error
  }
}

// The bullet facts currently stored, trimmed. Used for dedup and for the panel's display.
function listFacts(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.*\S)\s*$/))
    .filter(Boolean)
    .map((match) => match[1].trim())
}

// Append one fact as a Markdown bullet. Creates the file with a header first, skips empty/duplicate
// facts (case-insensitive), and collapses internal whitespace so a multi-line fact stays one bullet.
// Returns { added, fact }.
function appendFact(profileDir, scope, projectId, fact) {
  const text = String(fact || "").replace(/\s+/g, " ").trim()
  if (text.length < 3) throw new Error("Memory fact is too short to be useful.")
  const filePath = ensureMemoryFile(memoryPath(profileDir, scope, projectId), scope)
  const existing = fs.readFileSync(filePath, "utf8")
  if (listFacts(existing).some((entry) => entry.toLowerCase() === text.toLowerCase())) {
    return { added: false, fact: text }
  }
  const separator = existing.endsWith("\n") ? "" : "\n"
  fs.writeFileSync(filePath, `${existing}${separator}- ${text}\n`)
  return { added: true, fact: text }
}

// Replace the full contents of a memory file (used by the Memory tab's editor). An empty body is
// reset to the header so the file stays valid and recognizable. Preserves/restores the header.
function writeMemory(profileDir, scope, projectId, content) {
  const filePath = memoryPath(profileDir, scope, projectId)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const body = String(content == null ? "" : content)
  const normalized = body.includes(MEMORY_MARKER) ? body : `${memoryHeader(scope)}${body}`
  fs.writeFileSync(filePath, normalized.endsWith("\n") ? normalized : `${normalized}\n`)
  return filePath
}

// Ensure opencode.json's `instructions` array contains exactly one managed entry pointing at the
// active project's memory file (absolute path), dropping any previously-managed entry and leaving
// the user's own entries intact. Mutates and returns the config; the caller persists it via the
// validated writeProfileConfig round-trip. `projectId` null clears the managed entry (no project).
function applyProjectInstruction(config, profileDir, projectId) {
  const others = Array.isArray(config.instructions)
    ? config.instructions.filter((entry) => !isManagedInstruction(profileDir, entry))
    : []
  if (projectId) {
    ensureProjectMemory(profileDir, projectId)
    others.push(projectMemoryPath(profileDir, projectId))
  }
  if (others.length) config.instructions = others
  else delete config.instructions
  return config
}

module.exports = {
  GLOBAL_MEMORY_FILE,
  MEMORY_DIR_NAME,
  MEMORY_MARKER,
  SCOPES,
  appendFact,
  applyProjectInstruction,
  ensureGlobalMemory,
  ensureProjectMemory,
  globalMemoryPath,
  isManagedInstruction,
  listFacts,
  memoryHeader,
  memoryPath,
  projectMemoryDir,
  projectMemoryPath,
  readMemory,
  writeMemory
}
