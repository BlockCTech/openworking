const path = require("node:path")

// Windows npm shims are .cmd files (`electron-builder.cmd`, `npm.cmd`), and since the
// CVE-2024-27980 fix Node refuses to spawn those directly: the call fails with EINVAL and no
// output, which reads like the tool crashed silently.
//
// The obvious workaround, `shell: true`, is worse than it looks — Node concatenates argv into a
// command string without escaping it (DEP0190), so any argument containing a space (a publisher
// name, a path under "Program Files") is re-split by the shell and silently mangled.
//
// Instead invoke the shim through `cmd.exe /c`, which keeps each argument a separate argv entry.
// Returns a [command, args] pair to spread into spawnSync/execFileSync.
function windowsAwareCommand(command, args = []) {
  if (process.platform !== "win32") return [command, args]
  const shim = path.extname(command) ? command : `${command}.cmd`
  return [process.env.COMSPEC || "cmd.exe", ["/c", shim, ...args]]
}

module.exports = { windowsAwareCommand }
