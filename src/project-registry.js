const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")

function projectIdForPath(projectPath) {
  return `proj_${crypto.createHash("sha256").update(projectPath).digest("hex").slice(0, 16)}`
}

class ProjectRegistry {
  constructor(userDataPath) {
    this.registryPath = path.join(userDataPath, "projects.json")
  }

  list() {
    try {
      const raw = fs.readFileSync(this.registryPath, "utf8")
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed.projects) ? parsed.projects : []
    } catch (error) {
      if (error.code === "ENOENT") return []
      throw error
    }
  }

  add(projectPath) {
    const resolvedPath = path.resolve(projectPath)
    const stat = fs.statSync(resolvedPath)
    if (!stat.isDirectory()) {
      throw new Error(`Selected path is not a directory: ${resolvedPath}`)
    }

    const now = new Date().toISOString()
    const id = projectIdForPath(resolvedPath)
    const projects = this.list().filter((project) => project.id !== id)
    const existing = this.list().find((project) => project.id === id)
    const project = {
      id,
      name: path.basename(resolvedPath) || resolvedPath,
      path: resolvedPath,
      addedAt: existing?.addedAt || now,
      lastOpenedAt: now,
      pinned: existing?.pinned || false
    }

    projects.unshift(project)
    this.save(projects)
    return project
  }

  rename(projectId, name) {
    const nextName = String(name || "").trim()
    if (!nextName) throw new Error("Project name is required.")

    const projects = this.list()
    const next = projects.map((project) =>
      project.id === projectId ? { ...project, name: nextName } : project
    )
    this.save(next)
    return next.find((project) => project.id === projectId) || null
  }

  touch(projectId) {
    const projects = this.list()
    const now = new Date().toISOString()
    const next = projects.map((project) =>
      project.id === projectId ? { ...project, lastOpenedAt: now } : project
    )
    this.save(next)
    return next.find((project) => project.id === projectId) || null
  }

  setPinned(projectId, pinned) {
    const projects = this.list()
    const next = projects.map((project) =>
      project.id === projectId ? { ...project, pinned: Boolean(pinned) } : project
    )
    this.save(next)
    return next.find((project) => project.id === projectId) || null
  }

  remove(projectId) {
    const projects = this.list().filter((project) => project.id !== projectId)
    this.save(projects)
    return projects
  }

  save(projects) {
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true })
    fs.writeFileSync(this.registryPath, `${JSON.stringify({ projects }, null, 2)}\n`)
  }
}

module.exports = { ProjectRegistry, projectIdForPath }
