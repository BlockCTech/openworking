const path = require("node:path")

function resolveRegisteredProjectDirectory(project, requestedDirectory) {
  if (!project?.path) throw new Error("Project not found.")
  const candidates = [project.path, project.activeWorktreePath].filter(Boolean)
  if (!requestedDirectory) return project.activeWorktreePath || project.path

  const normalizedRequest = path.resolve(String(requestedDirectory))
  const registered = candidates.find((candidate) => path.resolve(candidate) === normalizedRequest)
  if (!registered) throw new Error("Project directory does not match the registered project paths.")
  return registered
}

module.exports = { resolveRegisteredProjectDirectory }
