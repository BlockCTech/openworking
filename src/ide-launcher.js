const { execFile } = require("node:child_process")

// macOS application name for each supported IDE id, passed to `open -a`. "system" has no
// entry here — the caller handles it separately via shell.openPath (Finder/OS default),
// not through this app-launch table.
const IDE_APP_NAMES = {
  vscode: "Visual Studio Code",
  cursor: "Cursor",
  antigravity: "Antigravity IDE"
}

function ideAppName(ideId) {
  return IDE_APP_NAMES[ideId] || null
}

// Launches `projectPath` in the macOS app registered for `ideId` via `open -a <app> <path>`.
// Uses an argument array (no shell), mirroring installDmg's use of execFileSync in
// version-check.js — paths with spaces/special characters need no manual quoting and can't
// be interpreted as shell syntax. `exec` is injectable so tests can drive this without
// spawning a real process.
function openInIde(ideId, projectPath, { exec = execFile, platform = process.platform } = {}) {
  const appName = ideAppName(ideId)
  if (!appName) return Promise.reject(new Error(`Unsupported IDE: ${ideId}`))
  if (platform !== "darwin") {
    return Promise.reject(new Error("IDE shortcuts are currently supported on macOS only. Use System to open the project folder."))
  }
  return new Promise((resolve, reject) => {
    exec("open", ["-a", appName, projectPath], (error) => {
      if (error) {
        reject(new Error(`Could not open ${appName}. Is it installed?`))
        return
      }
      resolve()
    })
  })
}

module.exports = { IDE_APP_NAMES, ideAppName, openInIde }
