const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { projectIdForPath } = require("../src/project-registry")
const { ensureOpenworkingProfile, readProfileConfig, setActiveProjectMemory } = require("../src/opencode-profile")
const {
  MEMORY_MARKER,
  appendFact,
  applyProjectInstruction,
  ensureGlobalMemory,
  globalMemoryPath,
  isManagedInstruction,
  listFacts,
  projectMemoryPath,
  readMemory,
  writeMemory
} = require("../src/memory-store")

function freshProfile() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-memory-"))
  return ensureOpenworkingProfile({ userDataPath: temp })
}

test("ensureOpenworkingProfile creates a global AGENTS.md with the managed header", () => {
  const profile = freshProfile()
  const filePath = globalMemoryPath(profile.profileDir)
  assert.equal(filePath, path.join(profile.profileDir, "AGENTS.md"))
  assert.equal(fs.existsSync(filePath), true)
  assert.match(fs.readFileSync(filePath, "utf8"), new RegExp(MEMORY_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
})

test("appendFact adds a bullet, preserves the header, and dedups case-insensitively", () => {
  const profile = freshProfile()
  ensureGlobalMemory(profile.profileDir)

  const first = appendFact(profile.profileDir, "global", null, "User prefers Vietnamese replies")
  assert.equal(first.added, true)
  const dup = appendFact(profile.profileDir, "global", null, "user prefers vietnamese REPLIES")
  assert.equal(dup.added, false)

  const content = readMemory(profile.profileDir, "global")
  assert.match(content, /^<!-- OpenWorking managed memory/)
  assert.deepEqual(listFacts(content), ["User prefers Vietnamese replies"])
})

test("appendFact rejects trivially short facts", () => {
  const profile = freshProfile()
  assert.throws(() => appendFact(profile.profileDir, "global", null, "x"), /too short/)
})

test("project memory file is keyed by projectIdForPath", () => {
  const profile = freshProfile()
  const projectId = projectIdForPath("/tmp/some/project")
  appendFact(profile.profileDir, "project", projectId, "The build command is npm run build")
  const filePath = projectMemoryPath(profile.profileDir, projectId)
  assert.equal(filePath, path.join(profile.profileDir, "memory", `${projectId}.md`))
  assert.equal(fs.existsSync(filePath), true)
  assert.deepEqual(listFacts(readMemory(profile.profileDir, "project", projectId)), ["The build command is npm run build"])
})

test("appendFact rejects an invalid project id", () => {
  const profile = freshProfile()
  assert.throws(() => appendFact(profile.profileDir, "project", "not-a-real-id", "anything here"), /Invalid project id/)
})

test("setActiveProjectMemory keeps exactly one managed instructions entry and swaps it per project", () => {
  const profile = freshProfile()
  const idA = projectIdForPath("/tmp/project-a")
  const idB = projectIdForPath("/tmp/project-b")

  setActiveProjectMemory(profile, idA)
  let config = readProfileConfig(profile).config
  let managed = (config.instructions || []).filter((entry) => isManagedInstruction(profile.profileDir, entry))
  assert.deepEqual(managed, [projectMemoryPath(profile.profileDir, idA)])

  setActiveProjectMemory(profile, idB)
  config = readProfileConfig(profile).config
  managed = (config.instructions || []).filter((entry) => isManagedInstruction(profile.profileDir, entry))
  assert.equal(managed.length, 1, "exactly one managed entry after switching projects")
  assert.deepEqual(managed, [projectMemoryPath(profile.profileDir, idB)])
})

test("setActiveProjectMemory preserves a user's own instructions entries", () => {
  const profile = freshProfile()
  const config = readProfileConfig(profile).config
  config.instructions = ["./CONTRIBUTING.md", "docs/*.md"]
  applyProjectInstruction(config, profile.profileDir, projectIdForPath("/tmp/project-x"))
  assert.equal(config.instructions.includes("./CONTRIBUTING.md"), true)
  assert.equal(config.instructions.includes("docs/*.md"), true)
  assert.equal(config.instructions.filter((entry) => isManagedInstruction(profile.profileDir, entry)).length, 1)
})

test("setActiveProjectMemory(null) clears the managed entry but leaves user entries", () => {
  const profile = freshProfile()
  const id = projectIdForPath("/tmp/project-y")
  setActiveProjectMemory(profile, id)
  // add a user entry alongside the managed one, then clear the project
  let config = readProfileConfig(profile).config
  config.instructions.unshift("./README.md")
  applyProjectInstruction(config, profile.profileDir, null)
  assert.deepEqual(config.instructions, ["./README.md"])
})

test("writeMemory restores the header when the editor body lacks it", () => {
  const profile = freshProfile()
  writeMemory(profile.profileDir, "global", null, "- a manually typed fact")
  const content = readMemory(profile.profileDir, "global")
  assert.match(content, new RegExp(MEMORY_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  assert.deepEqual(listFacts(content), ["a manually typed fact"])
})
