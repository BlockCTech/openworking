const test = require("node:test")
const assert = require("node:assert/strict")

const { resolveRegisteredProjectDirectory } = require("../src/project-context")

const project = {
  id: "project-a",
  path: "/workspace/project-a",
  activeWorktreePath: "/workspace/project-a-worktree"
}

test("project context returns only registered path values", () => {
  assert.equal(resolveRegisteredProjectDirectory(project, project.path), project.path)
  assert.equal(resolveRegisteredProjectDirectory(project, project.activeWorktreePath), project.activeWorktreePath)
  assert.equal(resolveRegisteredProjectDirectory(project), project.activeWorktreePath)
})

test("project context rejects unknown and mismatched directories", () => {
  assert.throws(() => resolveRegisteredProjectDirectory(null, project.path), /Project not found/)
  assert.throws(() => resolveRegisteredProjectDirectory(project, "/workspace/project-b"), /does not match/)
  assert.throws(() => resolveRegisteredProjectDirectory(project, "/workspace/project-a/../project-b"), /does not match/)
})

// The VCS Changes panel resolves its target directory through this same helper, so a project
// sitting on a switched worktree must report that worktree - never the main checkout. Mixing the
// two is the specific failure the panel has to avoid: both paths are "valid" for the project, so
// a wrong pick produces a plausible-looking list of the wrong directory's changes.
test("project context resolves a worktree project to the worktree, not the main checkout", () => {
  // No explicit directory: the active worktree wins.
  assert.equal(resolveRegisteredProjectDirectory(project), project.activeWorktreePath)
  // An explicit worktree directory is preserved rather than collapsed back to project.path.
  assert.equal(
    resolveRegisteredProjectDirectory(project, project.activeWorktreePath),
    project.activeWorktreePath
  )
  // A project with no worktree still resolves to its own path.
  const plain = { id: "project-b", path: "/workspace/project-b" }
  assert.equal(resolveRegisteredProjectDirectory(plain), plain.path)
  // Another project's worktree path is not reachable through this project.
  assert.throws(
    () => resolveRegisteredProjectDirectory(plain, project.activeWorktreePath),
    /does not match/
  )
})
