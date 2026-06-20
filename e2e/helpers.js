const crypto = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const repoRoot = path.join(__dirname, "..")

// Mirror src/project-registry.js projectIdForPath so we can seed projects.json
// directly (the real "Add project" flow opens a native folder dialog that
// Playwright can't drive).
function projectIdForPath(projectPath) {
  return `proj_${crypto.createHash("sha256").update(projectPath).digest("hex").slice(0, 16)}`
}

// Create a throwaway sandbox: a userData dir + a project dir on disk. Returns
// paths plus a cleanup() that removes the whole tree. Tests get an isolated
// userData so they never touch the developer's real Application Support folder.
function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-e2e-"))
  const userDataDir = path.join(root, "user-data")
  const projectDir = path.join(root, "project")
  const opencodeConfigPath = path.join(root, "opencode.json")
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.mkdirSync(projectDir, { recursive: true })
  return {
    root,
    userDataDir,
    projectDir,
    opencodeConfigPath,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}

// Seed projects.json inside a sandbox userData dir so a project shows up in the
// sidebar without the native add-project dialog. Each entry only needs a real
// directory on disk; pass { dir } to point at one (defaults to projectDir).
function seedProjects(userDataDir, projects) {
  const now = new Date().toISOString()
  const entries = projects.map((project) => {
    const resolvedPath = path.resolve(project.dir)
    return {
      id: projectIdForPath(resolvedPath),
      name: project.name || path.basename(resolvedPath),
      path: resolvedPath,
      addedAt: now,
      lastOpenedAt: now
    }
  })
  fs.writeFileSync(
    path.join(userDataDir, "projects.json"),
    `${JSON.stringify({ projects: entries }, null, 2)}\n`
  )
  return entries
}

// Env that boots the app fully offline:
//  - runtime bin -> /does/not/exist so no real opencode serve is spawned.
//  - userData/config redirected into the sandbox.
function sandboxEnv(sandbox) {
  return {
    ...process.env,
    OPENWORKING_RUNTIME_BIN: "/does/not/exist",
    OPENWORKING_USER_DATA_DIR: sandbox.userDataDir,
    OPENWORKING_OPENCODE_CONFIG_PATH: sandbox.opencodeConfigPath,
    // Point the version check at an unreachable host so it fails open (no
    // forced-update modal can ever overlay and block the UI under test).
    OPENWORKING_VERSION_API_BASE: "http://127.0.0.1:1"
  }
}

module.exports = { repoRoot, projectIdForPath, makeSandbox, seedProjects, sandboxEnv }
