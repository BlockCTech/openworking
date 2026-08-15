#!/usr/bin/env node

// Minimal fake OpenCode v2 server for the Native attachment UX smoke flow: attach (local +
// rejected-by-capability) -> send -> Undo -> confirm re-attach is required. Deliberately
// separate from fake-opencode-v2.js (built for the subagent-run-tree spec's hardcoded session
// graph) rather than extended, so the two fixtures don't grow coupled to unrelated features.

const fs = require("node:fs")
const http = require("node:http")

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
let promptSeq = 0

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

  // Text-only capability on purpose: the smoke flow attaches a supported (text) file and an
  // unsupported (image) one, so the picker's capability gate has something real to reject.
  if (url.pathname === "/api/model") {
    return json(res, {
      data: [{
        providerID: "fake-provider",
        id: "fake-model",
        name: "Fake text-only model",
        enabled: true,
        capabilities: { tools: true, input: ["text"], output: ["text"] }
      }]
    })
  }

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

  // createSession follows up with a rename whenever it is given a title (the first prompt of a new
  // session derives one), so a 404 here fails the whole send.
  const renameMatch = /^\/api\/session\/([^/]+)\/rename$/.exec(url.pathname)
  if (renameMatch && req.method === "POST") {
    const body = await readBody(req)
    const session = sessions.find((entry) => entry.id === decodeURIComponent(renameMatch[1]))
    if (!session) return json(res, { data: null }, 404)
    if (body.title) session.title = String(body.title)
    return json(res, { data: session })
  }

  const promptMatch = /^\/api\/session\/([^/]+)\/prompt$/.exec(url.pathname)
  if (promptMatch && req.method === "POST") {
    await readBody(req)
    promptSeq += 1
    return json(res, {
      data: {
        id: `inp_${promptSeq}`,
        sessionID: decodeURIComponent(promptMatch[1]),
        type: "user",
        admittedSeq: promptSeq,
        timeCreated: Date.now()
      }
    })
  }

  const revertStageMatch = /^\/api\/session\/([^/]+)\/revert\/stage$/.exec(url.pathname)
  if (revertStageMatch && req.method === "POST") {
    const body = await readBody(req)
    return json(res, { data: { messageID: body.messageID || body.messageId || "", files: [] } })
  }

  const messagesMatch = /^\/api\/session\/([^/]+)\/message$/.exec(url.pathname)
  if (messagesMatch) return json(res, { data: [], cursor: {} })

  if (/^\/api\/session\/[^/]+\/pending$/.test(url.pathname)) return json(res, { data: [] })

  json(res, { data: null }, 404)
})

server.listen(port, "127.0.0.1", () => {
  if (portFile) fs.writeFileSync(portFile, String(port))
})

function shutdown() {
  server.close(() => process.exit(0))
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
