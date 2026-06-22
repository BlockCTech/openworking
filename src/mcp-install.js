const fs = require("node:fs")
const path = require("node:path")
const { execFile } = require("node:child_process")
const { resolveUserPath } = require("./runtime/process-manager")

// On-demand installer for local stdio MCP servers that ship as npm packages.
//
// Why this exists: launching a server via `npx <pkg>` runs npm with cwd set to the user's project
// directory (opencode spawns MCP children there). npm then reads that project's package.json and
// can refuse to run — e.g. a project pinning `devEngines.packageManager: pnpm` makes
// `npx backlog-mcp-server` fail with EBADDEVENGINES, surfacing as "MCP error -32000: Connection
// closed". To be immune to whatever package manager / engines a project declares, we install the
// package once into a NEUTRAL directory under the app-managed profile and then launch it with
// plain `node <pkg>/build/index.js` — `node` never reads the cwd's package.json, so no project can
// break it.
//
// Install is on-demand (when the connector is enabled), not bundled, to keep the app small.

// Pin the version so behavior is reproducible; bump intentionally when upgrading.
const BACKLOG_PACKAGE = "backlog-mcp-server"
const BACKLOG_VERSION = "0.12.0"
const BACKLOG_ENTRY = path.join("node_modules", BACKLOG_PACKAGE, "build", "index.js")
const INSTALL_TIMEOUT_MS = 120000

// Root for app-installed MCP server packages, kept separate from the project and from opencode's
// own files so npm operations here are never influenced by a project's package.json.
function mcpServersDir(profileDir) {
  return path.join(profileDir, "mcp-servers")
}

function backlogInstallDir(profileDir) {
  return path.join(mcpServersDir(profileDir), "backlog")
}

function backlogEntryPath(profileDir) {
  return path.join(backlogInstallDir(profileDir), BACKLOG_ENTRY)
}

// True when a command array is the legacy `npx backlog-mcp-server` invocation we now replace.
function isLegacyBacklogNpxCommand(command) {
  if (!Array.isArray(command)) return false
  return command.length >= 2 && command[0] === "npx" && command.includes(BACKLOG_PACKAGE)
}

// Write a minimal package.json (no devEngines / packageManager) so `npm install` in this dir is
// never rejected by engine constraints, regardless of the user's global npm config.
function ensureInstallScaffold(installDir) {
  fs.mkdirSync(installDir, { recursive: true })
  const pkgPath = path.join(installDir, "package.json")
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, `${JSON.stringify({ name: "openworking-mcp-backlog", private: true }, null, 2)}\n`)
  }
}

function runNpmInstall(installDir, pkgSpec, pathValue) {
  return new Promise((resolve, reject) => {
    execFile(
      "npm",
      ["install", pkgSpec, "--no-audit", "--no-fund", "--save-exact"],
      {
        cwd: installDir,
        env: { ...process.env, PATH: pathValue },
        timeout: INSTALL_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024
      },
      (error, _stdout, stderr) => {
        if (!error) return resolve()
        const detail = String(stderr || error.message || "").trim()
        reject(new Error(`Could not install ${pkgSpec}. ${detail}`))
      }
    )
  })
}

// Ensure backlog-mcp-server is installed in the neutral profile dir and return the absolute path to
// its node entry point. Idempotent: returns immediately if already installed. `resolvePath` is
// injectable for tests; it must yield a PATH that contains npm/node.
async function ensureBacklogServer(profileDir, { resolvePath = resolveUserPath } = {}) {
  if (!profileDir) throw new Error("profileDir is required to install the Backlog MCP server.")
  const entry = backlogEntryPath(profileDir)
  if (fs.existsSync(entry)) return entry

  const installDir = backlogInstallDir(profileDir)
  ensureInstallScaffold(installDir)
  const pathValue = await resolvePath()
  await runNpmInstall(installDir, `${BACKLOG_PACKAGE}@${BACKLOG_VERSION}`, pathValue)

  if (!fs.existsSync(entry)) {
    throw new Error(`Installed ${BACKLOG_PACKAGE} but its entry point is missing at ${entry}.`)
  }
  return entry
}

// The command array a Backlog connector should use once the package is installed.
function backlogCommand(profileDir) {
  return ["node", backlogEntryPath(profileDir)]
}

module.exports = {
  BACKLOG_PACKAGE,
  BACKLOG_VERSION,
  backlogInstallDir,
  backlogEntryPath,
  backlogCommand,
  isLegacyBacklogNpxCommand,
  ensureBacklogServer
}
