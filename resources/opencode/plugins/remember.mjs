import fs from "node:fs"
import path from "node:path"

const MEMORY_MARKER = "<!-- OpenWorking managed memory."
const PROJECT_ID_PATTERN = /^proj_[a-f0-9]{16}$/

function createRuntimeInput() {
  const properties = {
    fact: {
      type: "string",
      minLength: 3,
      description: "A short, self-contained durable fact to remember. Do not store secrets or transient task details."
    },
    scope: {
      type: "string",
      enum: ["global", "project"],
      description: "Use project for project-specific facts (default), or global for preferences that apply everywhere."
    }
  }
  const jsonSchema = {
    type: "object",
    properties,
    required: ["fact"],
    additionalProperties: false
  }

  return {
    ...jsonSchema,
    "~standard": {
      version: 1,
      vendor: "openworking",
      validate(value) {
        const issues = []
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return { issues: [{ message: "Expected an object." }] }
        }
        if (typeof value.fact !== "string" || value.fact.replace(/\s+/g, " ").trim().length < 3) {
          issues.push({ message: "fact must contain at least 3 characters.", path: ["fact"] })
        }
        if (value.scope !== undefined && !["global", "project"].includes(value.scope)) {
          issues.push({ message: "scope must be global or project.", path: ["scope"] })
        }
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(properties, key)) issues.push({ message: `Unexpected property: ${key}.`, path: [key] })
        }
        return issues.length ? { issues } : { value }
      },
      jsonSchema: {
        input() {
          return jsonSchema
        }
      }
    }
  }
}

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

async function executeRemember(args) {
  const validation = createRuntimeInput()["~standard"].validate(args)
  if (validation.issues) throw new Error(validation.issues.map((issue) => issue.message).join(" "))

  const scope = validation.value.scope === "global" ? "global" : "project"
  const text = validation.value.fact.replace(/\s+/g, " ").trim()
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
    return { content: `Already remembered (${scope}): ${text}` }
  }
  const separator = current.endsWith("\n") ? "" : "\n"
  fs.writeFileSync(filePath, `${current}${separator}- ${text}\n`)
  return { content: `Remembered (${scope}): ${text}` }
}

export default {
  id: "openworking.remember",
  async setup(context) {
    await context.tool.transform((tools) => {
      tools.add({
        name: "remember",
        description:
          "Save one durable fact for future chats. Use project scope for project-specific facts and global scope for lasting preferences. Do not store secrets or transient task details.",
        input: createRuntimeInput(),
        options: { codemode: false },
        execute: executeRemember
      })
    })
  }
}
