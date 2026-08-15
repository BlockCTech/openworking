#!/usr/bin/env node

// Minimal fake OpenCode v2 server for the PTY smoke flow: open a terminal -> type a command ->
// see its echoed output -> close -> confirm the underlying "process" is gone. Separate from
// fake-opencode-v2-attachments.js (built for a different flow) so the two fixtures don't grow
// coupled to unrelated features.

const fs = require("node:fs")
const http = require("node:http")
const path = require("node:path")
const WebSocket = require(path.join(__dirname, "..", "node_modules", "ws"))

if (process.argv[2] === "db") {
  process.stdout.write("[]\n")
  process.exit(0)
}

const portIndex = process.argv.indexOf("--port")
const port = Number(process.argv[portIndex + 1])
const directory = process.env.OPENWORKING_FAKE_PROJECT_DIR || process.cwd()
const portFile = process.env.OPENWORKING_FAKE_RUNTIME_PORT_FILE
const clients = new Set()

let sessionSeq = 0
const sessions = []
let ptySeq = 0
const ptys = new Map() // id -> { id, title, command, args, cwd, status, pid }

function json(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(value))
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ""
    req.on("data", (chunk) => { raw += chunk })
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })
}

function sendEvent(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function broadcastEvent(event) {
  for (const res of clients) sendEvent(res, event)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)

  if (url.pathname === "/api/health") return json(res, { data: { healthy: true } })

  if (url.pathname === "/api/event") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" })
    clients.add(res)
    sendEvent(res, { type: "server.connected", created: Date.now(), data: {} })
    req.on("close", () => clients.delete(res))
    return
  }

  if (url.pathname === "/api/model") return json(res, { data: [] })
  if (url.pathname === "/api/command" || url.pathname === "/api/skill") return json(res, { data: [] })
  if (url.pathname === "/api/mcp") return json(res, { data: {} })
  if (url.pathname === "/api/session/active") return json(res, { data: {} })

  if (url.pathname === "/api/session" && req.method === "POST") {
    const body = await readBody(req)
    sessionSeq += 1
    const session = {
      id: `ses_${sessionSeq}`,
      title: body.title || "Fake session",
      projectID: "fake-project",
      location: { directory },
      model: body.model || null,
      time: { created: sessionSeq, updated: sessionSeq }
    }
    sessions.push(session)
    return json(res, { data: session })
  }
  if (url.pathname === "/api/session" && req.method === "GET") {
    if (url.searchParams.get("parentID")) return json(res, { data: [], cursor: {} })
    return json(res, { data: sessions, cursor: {} })
  }
  if (/^\/api\/session\/[^/]+\/pending$/.test(url.pathname)) return json(res, { data: [] })

  // PTY: create/list/get/update/remove.
  if (url.pathname === "/api/pty" && req.method === "POST") {
    const body = await readBody(req)
    ptySeq += 1
    const pty = {
      id: `pty_${ptySeq}`,
      title: body.title || "terminal",
      command: body.command || "/bin/sh",
      args: Array.isArray(body.args) ? body.args : [],
      cwd: body.cwd || directory,
      status: "running",
      pid: 10000 + ptySeq
    }
    ptys.set(pty.id, pty)
    broadcastEvent({ type: "pty.created", data: { info: pty } })
    return json(res, { location: { directory }, data: pty })
  }
  if (url.pathname === "/api/pty" && req.method === "GET") {
    return json(res, { location: { directory }, data: [...ptys.values()] })
  }
  const ptyItemMatch = /^\/api\/pty\/([^/]+)$/.exec(url.pathname)
  if (ptyItemMatch && req.method === "GET") {
    const pty = ptys.get(decodeURIComponent(ptyItemMatch[1]))
    if (!pty) return json(res, { _tag: "PtyNotFoundError" }, 404)
    return json(res, { location: { directory }, data: pty })
  }
  if (ptyItemMatch && req.method === "PUT") {
    const pty = ptys.get(decodeURIComponent(ptyItemMatch[1]))
    if (!pty) return json(res, { _tag: "PtyNotFoundError" }, 404)
    return json(res, { location: { directory }, data: pty })
  }
  if (ptyItemMatch && req.method === "DELETE") {
    const id = decodeURIComponent(ptyItemMatch[1])
    const pty = ptys.get(id)
    if (pty) { pty.status = "exited"; pty.exitCode = 0 }
    ptys.delete(id)
    broadcastEvent({ type: "pty.deleted", data: { id } })
    res.writeHead(204)
    return res.end()
  }

  json(res, { data: null }, 404)
})

// PTY connect: a plain Basic-auth WebSocket upgrade, no ticket (matches the pinned real runtime's
// confirmed-working behavior — see the PTY goal's spec for the live-spike evidence). Echoes any
// input straight back, prefixed, so the smoke spec can assert real round-trip I/O.
const wss = new WebSocket.Server({ noServer: true })
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  const match = /^\/api\/pty\/([^/]+)\/connect$/.exec(url.pathname)
  if (!match) { socket.destroy(); return }
  const ptyId = decodeURIComponent(match[1])
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.send("fake-shell ready\r\n")
    // xterm sends one message per keystroke, so echoing each message straight back would emit
    // "echo: h", "echo: e", ... Buffer until Enter and echo the whole line, the way a shell does.
    let line = ""
    ws.on("message", (data) => {
      for (const char of data.toString()) {
        if (char === "\r" || char === "\n") {
          ws.send(`echo: ${line}\r\n`)
          line = ""
          continue
        }
        line += char
      }
    })
    ws.on("close", () => {})
    // Exposed for the test to simulate an external close (e.g. DELETE) if needed later.
    ws.ptyId = ptyId
  })
})

server.listen(port, "127.0.0.1", () => {
  if (portFile) fs.writeFileSync(portFile, String(port))
})

function shutdown() {
  server.close(() => process.exit(0))
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
