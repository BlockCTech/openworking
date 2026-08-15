const fs = require("node:fs")
const path = require("node:path")

// Realpath boundary gate for local References — narrower cousin of artifact-path.js's
// assertProjectFile: that helper also restricts to a fixed set of "viewable" file extensions and
// rejects directories, but ConfigV2.Reference.Local (resources/opencode/schemas/opencode-config.schema.json)
// explicitly supports "local directory references" with no file-type restriction.
function assertReferencePath(projectPath, requestedPath) {
  const projectRoot = fs.realpathSync(path.resolve(projectPath))
  const requestedInput = String(requestedPath)
  const requested = path.isAbsolute(requestedInput)
    ? path.resolve(requestedInput)
    : path.resolve(projectRoot, requestedInput)
  if (!fs.existsSync(requested)) {
    throw new Error("Reference path does not exist.")
  }
  const resolved = fs.realpathSync(requested)
  const relative = path.relative(projectRoot, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Reference path is outside the current project.")
  }
  return resolved
}

// Builds the config `references` map entry ({path,...} or {repository,...}) for an add request,
// running the realpath boundary gate for a local path BEFORE returning — so a caller that adds
// this straight into config (main.js's references:add handler) can never write a path outside the
// project, because building the entry throws first.
function buildReferenceEntry(directory, payload) {
  const description = typeof payload?.description === "string" && payload.description.trim()
    ? payload.description.trim()
    : undefined
  const hidden = typeof payload?.hidden === "boolean" ? payload.hidden : undefined
  if (payload?.path !== undefined) {
    const safePath = assertReferencePath(directory, payload.path)
    return { path: safePath, ...(description ? { description } : {}), ...(hidden !== undefined ? { hidden } : {}) }
  }
  if (payload?.repository !== undefined) {
    const repository = String(payload.repository || "").trim()
    if (!repository) throw new Error("Repository is required.")
    return {
      repository,
      ...(typeof payload?.branch === "string" && payload.branch.trim() ? { branch: payload.branch.trim() } : {}),
      ...(description ? { description } : {}),
      ...(hidden !== undefined ? { hidden } : {})
    }
  }
  throw new Error("A reference needs either a local path or a git repository.")
}

module.exports = { assertReferencePath, buildReferenceEntry }
