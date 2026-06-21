import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"

const require = createRequire(import.meta.url)
const schema = require("../document-tools/schema.cjs")

// Cross-chat memory: persist a durable fact so it is recalled in future chats. This tool runs
// inside the OpenCode runtime, so it cannot import the app's src/memory-store.js — it resolves the
// same app-managed profile from env the desktop app sets when it spawns `opencode serve`:
//   OPENCODE_CONFIG_DIR  -> the profile dir (where AGENTS.md / memory/ live)
//   OPENWORKING_PROJECT_ID -> the active project's id (proj_<sha256-16>)
// The file format mirrors src/memory-store.js: a Markdown bullet list under a managed header.

const MEMORY_MARKER = "<!-- OpenWorking managed memory."
const PROJECT_ID_PATTERN = /^proj_[a-f0-9]{16}$/

function profileDir() {
  const dir = process.env.OPENCODE_CONFIG_DIR
  if (!dir) throw new Error("Cross-chat memory is unavailable: OPENCODE_CONFIG_DIR is not set.")
  return dir
}

function memoryHeader(scope) {
  const note = scope === "global"
    ? "Facts the assistant should remember across every chat and project."
    : "Facts the assistant should remember across chats in this project."
  return `${MEMORY_MARKER} ${note} -->\n# Memory\n`
}

function memoryPath(scope) {
  const dir = profileDir()
  if (scope === "global") return path.join(dir, "AGENTS.md")
  const projectId = String(process.env.OPENWORKING_PROJECT_ID || "")
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error("Project-scoped memory needs an open project. Use scope \"global\" instead.")
  }
  return path.join(dir, "memory", `${projectId}.md`)
}

function existingFacts(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.*\S)\s*$/))
    .filter(Boolean)
    .map((match) => match[1].trim())
}

export default {
  description:
    "Save a durable fact to cross-chat memory so it is automatically recalled in future chats. " +
    "Use for lasting user preferences, project facts, conventions, and decisions — not transient " +
    "details of the current conversation. Choose scope \"project\" for facts specific to the current " +
    "project, or \"global\" for personal preferences that apply everywhere.",
  args: {
    fact: schema
      .string()
      .min(3)
      .describe("The fact to remember, as a short self-contained sentence (e.g. \"User prefers Vietnamese replies\")."),
    scope: schema
      .enum(["global", "project"])
      .describe("\"global\" for facts that apply to every project, \"project\" for facts about the current project only.")
  },
  async execute(args) {
    const scope = args.scope === "global" ? "global" : "project"
    const text = String(args.fact || "").replace(/\s+/g, " ").trim()
    if (text.length < 3) throw new Error("That fact is too short to remember.")

    const filePath = memoryPath(scope)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    let current = ""
    try {
      current = fs.readFileSync(filePath, "utf8")
    } catch (error) {
      if (error.code !== "ENOENT") throw error
      current = memoryHeader(scope)
    }
    if (existingFacts(current).some((entry) => entry.toLowerCase() === text.toLowerCase())) {
      return `Already remembered (${scope}): ${text}`
    }
    const separator = current.endsWith("\n") ? "" : "\n"
    fs.writeFileSync(filePath, `${current}${separator}- ${text}\n`)
    return `Remembered (${scope}): ${text}`
  }
}
