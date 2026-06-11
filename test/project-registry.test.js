const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { ProjectRegistry, projectIdForPath } = require("../src/project-registry")

test("project registry persists local projects and deduplicates by path", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-registry-"))
  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  const registry = new ProjectRegistry(path.join(temp, "app-data"))

  const first = registry.add(projectPath)
  const second = registry.add(projectPath)
  const projects = registry.list()

  assert.equal(first.id, projectIdForPath(projectPath))
  assert.equal(second.id, first.id)
  assert.equal(projects.length, 1)
  assert.equal(projects[0].path, projectPath)
  assert.ok(projects[0].lastOpenedAt)
})

test("project registry renames and removes entries without deleting files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-registry-"))
  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  const registry = new ProjectRegistry(path.join(temp, "app-data"))
  const project = registry.add(projectPath)

  const renamed = registry.rename(project.id, "Renamed Project")
  const remaining = registry.remove(project.id)

  assert.equal(renamed.name, "Renamed Project")
  assert.deepEqual(remaining, [])
  assert.ok(fs.existsSync(projectPath))
})
