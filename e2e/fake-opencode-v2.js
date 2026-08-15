#!/usr/bin/env node

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
const active = { ses_child: { status: "running" } }

const rootLog = [
  {
    type: "session.tool.input.started",
    created: 10,
    durable: { aggregateID: "ses_root", seq: 1, version: 1 },
    data: { sessionID: "ses_root", assistantMessageID: "msg_1", id: "call_1", name: "subagent" }
  },
  {
    type: "session.tool.called",
    created: 20,
    durable: { aggregateID: "ses_root", seq: 2, version: 1 },
    data: {
      sessionID: "ses_root",
      assistantMessageID: "msg_1",
      id: "call_1",
      input: { agent: "review", description: "Review the implementation", prompt: "private fixture prompt" }
    }
  },
  {
    type: "session.tool.progress",
    created: 30,
    durable: { aggregateID: "ses_root", seq: 3, version: 1 },
    data: {
      sessionID: "ses_root",
      assistantMessageID: "msg_1",
      id: "call_1",
      metadata: { sessionID: "ses_child", status: "running" }
    }
  }
]
const childLog = [{
  type: "session.execution.started",
  created: 40,
  durable: { aggregateID: "ses_child", seq: 1, version: 1 },
  data: { sessionID: "ses_child" }
}]

function json(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(value))
}

function session(id, title, extra = {}) {
  return {
    id,
    title,
    projectID: "fake-project",
    location: { directory },
    time: { created: extra.created || 1, updated: extra.updated || extra.created || 1 },
    ...extra
  }
}

function sendEvent(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function appendOutcome(status, broadcast) {
  const type = status === "succeeded" ? "session.execution.succeeded" : "session.execution.failed"
  const event = {
    type,
    created: Date.now(),
    durable: { aggregateID: "ses_child", seq: childLog.at(-1).durable.seq + 1, version: 1 },
    data: {
      sessionID: "ses_child",
      ...(status === "failed" ? { error: { type: "fixture", message: "fixture failure" } } : {})
    }
  }
  childLog.push(event)
  delete active.ses_child
  if (broadcast) {
    for (const client of clients) sendEvent(client, event)
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  if (url.pathname === "/api/health") return json(res, { data: { healthy: true } })
  if (url.pathname === "/api/event") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    })
    clients.add(res)
    sendEvent(res, { type: "server.connected", created: Date.now(), data: {} })
    req.on("close", () => clients.delete(res))
    return
  }
  if (url.pathname === "/api/session/active") return json(res, { data: active })
  if (url.pathname === "/api/session") {
    const parentID = url.searchParams.get("parentID")
    if (parentID === "ses_root") {
      return json(res, {
        data: [
          session("ses_child", "Child subagent", { parentID: "ses_root", agent: "review", created: 2 }),
          session("ses_fork", "User fork", {
            parentID: "ses_root",
            fork: { sessionID: "ses_root" },
            created: 3
          })
        ],
        cursor: {}
      })
    }
    if (parentID) return json(res, { data: [], cursor: {} })
    return json(res, {
      data: [
        session("ses_root", "Root session", { created: 1 }),
        session("ses_child", "Child subagent", { parentID: "ses_root", agent: "review", created: 2 }),
        session("ses_fork", "User fork", {
          parentID: "ses_root",
          fork: { sessionID: "ses_root" },
          created: 3
        })
      ],
      cursor: {}
    })
  }
  const logMatch = /^\/api\/experimental\/session\/([^/]+)\/log$/.exec(url.pathname)
  if (logMatch) {
    const sessionID = decodeURIComponent(logMatch[1])
    const log = sessionID === "ses_root" ? rootLog : sessionID === "ses_child" ? childLog : []
    const after = Number(url.searchParams.get("after") ?? -1)
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    for (const event of log.filter((item) => item.durable.seq > after)) sendEvent(res, event)
    sendEvent(res, {
      type: "log.synced",
      aggregateID: sessionID,
      ...(log.length ? { seq: log.at(-1).durable.seq } : {})
    })
    return res.end()
  }
  const messagesMatch = /^\/api\/session\/([^/]+)\/message$/.exec(url.pathname)
  if (messagesMatch) {
    const sessionID = decodeURIComponent(messagesMatch[1])
    return json(res, {
      data: sessionID === "ses_root"
        ? [{ id: "msg_user", sessionID, type: "user", text: "Run the review", time: { created: 1 } }]
        : [],
      cursor: {}
    })
  }
  if (/^\/api\/session\/[^/]+\/pending$/.test(url.pathname)) return json(res, { data: [] })
  if (url.pathname === "/api/model" || url.pathname === "/api/command" || url.pathname === "/api/skill") {
    return json(res, { data: [] })
  }
  if (url.pathname === "/api/mcp") return json(res, { data: {} })
  if (url.pathname === "/__test/settle") {
    appendOutcome(url.searchParams.get("status"), true)
    return json(res, { ok: true })
  }
  if (url.pathname === "/__test/disconnect-and-settle") {
    for (const client of clients) client.end()
    clients.clear()
    appendOutcome(url.searchParams.get("status"), false)
    return json(res, { ok: true })
  }
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
