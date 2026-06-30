"use strict"

// Chrome native-messaging host entry point. Chrome launches this process and owns its stdin/stdout
// (uint32-LE framed JSON to/from the extension). Separately we open a loopback 127.0.0.1 server so the
// bundled browser MCP can send commands and receive results; the loopback is protected by a per-launch
// token that the app writes to a sidecar file (the MCP reads the same file). This keeps the only
// privileged surface on 127.0.0.1 + a secret, never on a public interface.
//
// Wiring contract (set by the app's browser bridge at install/launch time, passed via env):
//   OPENWORKING_BROWSER_HOST_DIR        directory the app owns for token/port sidecar files
// The host writes <dir>/host.port after binding; the MCP polls it. Token lives in <dir>/host.token.
//
// IMPORTANT: never write anything to stdout except framed native messages — Chrome treats stray stdout
// bytes as a corrupt frame and kills the host. All diagnostics go to stderr.

const fs = require("node:fs")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")
const { createHostBridge } = require("./bridge")

const MAX_LINE_BYTES = 8 * 1024 * 1024

function hostDir() {
  const fromEnv = process.env.OPENWORKING_BROWSER_HOST_DIR
  if (fromEnv) return fromEnv
  return path.join(os.tmpdir(), "openworking-browser-host")
}

function tokenPath(dir) {
  return path.join(dir, "host.token")
}

function portPath(dir) {
  return path.join(dir, "host.port")
}

// Read the loopback token. Returns null (instead of throwing) when the sidecar is missing/unreadable,
// so the caller can exit cleanly with a diagnostic instead of crashing as an unhandled exception —
// the difference between Chrome's opaque "Native host has exited" and an actionable stderr line.
function readTokenSafe(dir) {
  try {
    const value = fs.readFileSync(tokenPath(dir), "utf8").trim()
    return value || null
  } catch {
    return null
  }
}

// Publish the bound loopback port atomically (write a temp file then rename) so the MCP never reads a
// half-written value. The file content stays just the port number (the MCP parses it with Number()).
function writePortAtomic(dir, port) {
  const target = portPath(dir)
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, String(port))
  fs.renameSync(tmp, target)
}

// Remove the published port so a dead host never leaves a stale port behind (which would make the MCP
// connect to a refused/closed socket). Idempotent and never throws.
function removePort(dir) {
  try {
    fs.rmSync(portPath(dir), { force: true })
  } catch {}
}

// Append a timestamped diagnostic line to <dir>/host.log. Chrome swallows the host's stderr, so this is
// the only way to see what actually happens when Chrome launches the host (startup, port, exit reason).
// Best-effort and never throws so logging can never crash the host. Truncates if the log grows large.
function logLine(dir, message) {
  try {
    const file = path.join(dir, "host.log")
    try {
      if (fs.statSync(file).size > 256 * 1024) fs.rmSync(file, { force: true })
    } catch {}
    fs.appendFileSync(file, `${new Date().toISOString()} pid=${process.pid} ${message}\n`)
  } catch {}
}

// Build the loopback server that relays MCP requests through the bridge. Factored out (and given an
// injectable `createServer`) so it is unit-testable without real sockets. Caps a single un-terminated
// line so a local peer cannot exhaust memory before the token check.
function buildLoopbackServer(bridge, createServer = net.createServer) {
  return createServer((socket) => {
    socket.setEncoding("utf8")
    let buffered = ""
    const reply = (message) => {
      try {
        socket.write(JSON.stringify(message) + "\n")
      } catch {}
    }
    socket.on("data", (chunk) => {
      buffered += chunk
      if (buffered.length > MAX_LINE_BYTES) {
        reply({ ok: false, error: "request too large" })
        socket.destroy()
        return
      }
      let index
      while ((index = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, index)
        buffered = buffered.slice(index + 1)
        if (!line.trim()) continue
        let request
        try {
          request = JSON.parse(line)
        } catch {
          reply({ ok: false, error: "invalid json" })
          continue
        }
        bridge.handleMcpRequest(request, reply)
      }
    })
    socket.on("error", () => {})
  })
}

// Bootstrap the host. Returns an object describing what happened so it is unit-testable:
//   { started: false, reason }  when the token is missing (caller exits 1 with the reason on stderr)
//   { started: true, server, cleanup }  otherwise
// `deps` injects streams/factories for tests; real `main()` uses process stdio + net.
function startHost({
  dir,
  nativeIn = process.stdin,
  nativeOut = process.stdout,
  createServer = net.createServer,
  log = (message) => process.stderr.write(message + "\n")
} = {}) {
  fs.mkdirSync(dir, { recursive: true })

  const token = readTokenSafe(dir)
  if (!token) {
    return { started: false, reason: `browser host: missing or empty host.token in ${dir} — run Install host in the app` }
  }

  const bridge = createHostBridge({ nativeIn, nativeOut, token })
  const server = buildLoopbackServer(bridge, createServer)

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    removePort(dir)
  }

  server.on("error", (error) => {
    log(`browser host loopback error: ${error.message}`)
    cleanup()
    process.exit(1)
  })

  server.listen(0, "127.0.0.1", () => {
    try {
      const port = server.address().port
      writePortAtomic(dir, port)
      log(`listening on 127.0.0.1:${port}`)
    } catch (error) {
      log(`browser host: failed to publish port: ${error.message}`)
      cleanup()
      process.exit(1)
    }
  })

  return { started: true, server, cleanup, bridge }
}

function main() {
  const dir = hostDir()
  logLine(dir, `host launched (argv=${JSON.stringify(process.argv.slice(2))})`)
  const result = startHost({ dir, log: (message) => logLine(dir, message) })
  if (!result.started) {
    logLine(dir, result.reason)
    process.stderr.write(result.reason + "\n")
    process.exit(1)
    return
  }

  const exit = (signal) => {
    logLine(dir, `host exiting (${signal})`)
    result.cleanup()
    process.exit(0)
  }
  // Dead-host hygiene: drop the published port on every exit path so the MCP never targets a stale port.
  process.on("exit", result.cleanup)
  process.on("SIGTERM", () => exit("SIGTERM"))
  // When Chrome closes our stdin, the extension is gone — clean up and exit so we do not linger.
  process.stdin.on("end", () => exit("stdin end"))
}

if (require.main === module) main()

module.exports = {
  hostDir,
  tokenPath,
  portPath,
  readTokenSafe,
  writePortAtomic,
  removePort,
  logLine,
  buildLoopbackServer,
  startHost
}
