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
const sessionID = "ses_progress"
const assistantMessageID = "msg_progress"
const toolSessionID = "ses_tool_calling"
const toolAssistantMessageID = "msg_tool_calling"
const toolCallID = "chatcmpl-tool-websearch"
const toolQuery = "nhiệt độ đà nẵng hôm nay"
const toolFinalAnswer = "Da Nang weather result"
const liveProgress = `LIVE_PROGRESS_BOUNDARY_START ${"0123456789".repeat(160)} LIVE_PROGRESS_BOUNDARY_END`
const thoughtEnvelope = `<|channel|>thought ${liveProgress}<channel|>`
const secondProgress = "Preparing the final response."
const finalAnswer = "FINAL_ANSWER_OUTSIDE_PROGRESS_CARD"
let phase = "idle"
let toolPhase = "idle"

function json(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(value))
}

function sendEvent(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

function broadcast(type, data, extra = {}) {
  const event = { type, created: Date.now(), data, ...extra }
  for (const client of clients) sendEvent(client, event)
}

function session() {
  return {
    id: sessionID,
    title: "Agent progress fixture",
    projectID: "fake-project",
    location: { directory },
    time: { created: 1, updated: Date.now() }
  }
}

function toolSession() {
  return {
    id: toolSessionID,
    title: "Tool calling fixture",
    projectID: "fake-project",
    location: { directory },
    time: { created: 2, updated: Date.now() }
  }
}

function hydratedMessages() {
  const user = {
    id: "msg_user",
    sessionID,
    type: "user",
    time: { created: 1 },
    text: "Run the progress fixture"
  }
  if (phase !== "settled") return [user]
  return [
    user,
    {
      id: assistantMessageID,
      sessionID,
      type: "assistant",
      time: { created: 2, completed: 3 },
      tokens: { input: 5, output: 6, reasoning: 7 },
      content: [
        { id: `${assistantMessageID}:reasoning:0`, type: "reasoning", text: liveProgress },
        {
          id: "tool_fixture",
          type: "tool",
          tool: "read",
          state: {
            status: "completed",
            input: { filePath: "src/renderer.js" },
            output: "fixture output"
          }
        },
        { id: `${assistantMessageID}:reasoning:1`, type: "reasoning", text: secondProgress },
        { id: `${assistantMessageID}:2`, type: "text", text: finalAnswer }
      ]
    }
  ]
}

function hydratedToolMessages() {
  const user = {
    id: "msg_tool_user",
    sessionID: toolSessionID,
    type: "user",
    time: { created: 1 },
    text: toolQuery
  }
  if (toolPhase !== "settled") return [user]
  return [
    user,
    {
      id: toolAssistantMessageID,
      sessionID: toolSessionID,
      type: "assistant",
      time: { created: 2, completed: 3 },
      tokens: { input: 5, output: 6, reasoning: 0 },
      content: [
        {
          id: `${toolAssistantMessageID}:tool:${toolCallID}`,
          type: "tool",
          tool: "websearch",
          state: {
            status: "completed",
            input: { query: toolQuery }
          }
        },
        { id: `${toolAssistantMessageID}:1`, type: "text", text: toolFinalAnswer }
      ]
    }
  ]
}

function startProgress(res) {
  if (phase !== "idle") return json(res, { ok: true, phase })
  phase = "streaming"
  broadcast("session.execution.started", { sessionID })
  broadcast("session.step.started", { sessionID, assistantMessageID, agent: "build", model: {} })
  // Reproduce a provider leaking its thought channel through the normal text stream. The app's
  // stream pacer splits this large delta, including both control markers, across many repaint ticks.
  broadcast("session.text.delta", {
    sessionID,
    assistantMessageID,
    ordinal: 0,
    delta: thoughtEnvelope
  })
  // Running, not completed: while the turn is streaming the tool is still in flight, which is what
  // suppresses the Thinking row (hasRunningTool in src/thread-stream.js). Emitting "completed" here
  // left no running tool at all, so the row stayed up and .tool-step never reflected live work.
  broadcast("message.part.updated", {
    sessionID,
    part: {
      id: "tool_fixture",
      sessionID,
      messageID: assistantMessageID,
      type: "tool",
      tool: "read",
      state: {
        status: "running",
        input: { filePath: "src/renderer.js" }
      }
    }
  })
  return json(res, { ok: true, phase })
}

function finishProgress(res) {
  if (phase !== "streaming") return json(res, { ok: true, phase })
  phase = "settled"
  // Settle the tool that startProgress left running, so the finished turn matches the hydrated
  // message shape above (status "completed", with its output).
  broadcast("message.part.updated", {
    sessionID,
    part: {
      id: "tool_fixture",
      sessionID,
      messageID: assistantMessageID,
      type: "tool",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "src/renderer.js" },
        output: "fixture output"
      }
    }
  })
  broadcast("session.reasoning.delta", {
    sessionID,
    assistantMessageID,
    ordinal: 1,
    delta: secondProgress
  })
  broadcast("session.reasoning.ended", {
    sessionID,
    assistantMessageID,
    ordinal: 1,
    text: secondProgress
  }, { durable: { aggregateID: sessionID, seq: 1, version: 1 } })
  broadcast("session.text.delta", {
    sessionID,
    assistantMessageID,
    ordinal: 2,
    delta: finalAnswer
  })
  broadcast("session.step.ended", {
    sessionID,
    assistantMessageID,
    finish: "stop",
    cost: 0,
    tokens: { input: 5, output: 6, reasoning: 7 }
  })
  broadcast("session.execution.succeeded", { sessionID })
  return json(res, { ok: true, phase })
}

function startToolCalling(res) {
  if (toolPhase !== "idle") return json(res, { ok: true, phase: toolPhase })
  toolPhase = "streaming"
  broadcast("session.execution.started", { sessionID: toolSessionID })
  broadcast("session.step.started", {
    sessionID: toolSessionID,
    assistantMessageID: toolAssistantMessageID,
    agent: "build",
    model: {}
  })
  broadcast("session.tool.input.started", {
    sessionID: toolSessionID,
    assistantMessageID: toolAssistantMessageID,
    id: toolCallID,
    name: "websearch"
  }, { durable: { aggregateID: toolSessionID, seq: 1, version: 1 } })
  broadcast("session.tool.input.ended", {
    sessionID: toolSessionID,
    assistantMessageID: toolAssistantMessageID,
    id: toolCallID,
    text: JSON.stringify({ query: toolQuery })
  }, { durable: { aggregateID: toolSessionID, seq: 2, version: 1 } })
  broadcast("session.tool.called", {
    sessionID: toolSessionID,
    assistantMessageID: toolAssistantMessageID,
    id: toolCallID,
    input: { query: toolQuery },
    executed: false
  }, { durable: { aggregateID: toolSessionID, seq: 3, version: 1 } })
  return json(res, { ok: true, phase: toolPhase })
}

function finishToolCalling(res) {
  if (toolPhase !== "streaming") return json(res, { ok: true, phase: toolPhase })
  toolPhase = "settled"
  broadcast("session.tool.success", {
    sessionID: toolSessionID,
    assistantMessageID: toolAssistantMessageID,
    id: toolCallID,
    content: [{ type: "text", text: "private fixture output" }],
    executed: false
  }, { durable: { aggregateID: toolSessionID, seq: 4, version: 2 } })
  broadcast("session.step.ended", {
    sessionID: toolSessionID,
    assistantMessageID: toolAssistantMessageID,
    finish: "tool-calls",
    cost: 0,
    tokens: { input: 5, output: 1, reasoning: 0 }
  })
  broadcast("session.step.started", {
    sessionID: toolSessionID,
    assistantMessageID: toolAssistantMessageID,
    agent: "build",
    model: {}
  })
  broadcast("session.text.delta", {
    sessionID: toolSessionID,
    assistantMessageID: toolAssistantMessageID,
    ordinal: 1,
    delta: toolFinalAnswer
  })
  broadcast("session.step.ended", {
    sessionID: toolSessionID,
    assistantMessageID: toolAssistantMessageID,
    finish: "stop",
    cost: 0,
    tokens: { input: 5, output: 6, reasoning: 0 }
  })
  broadcast("session.execution.succeeded", { sessionID: toolSessionID })
  return json(res, { ok: true, phase: toolPhase })
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
  if (url.pathname === "/api/session/active") {
    const active = {}
    if (phase === "streaming") active[sessionID] = { status: "running" }
    if (toolPhase === "streaming") active[toolSessionID] = { status: "running" }
    return json(res, { data: active })
  }
  if (url.pathname === "/api/session") return json(res, { data: [session(), toolSession()], cursor: {} })
  if (url.pathname === `/api/session/${sessionID}`) return json(res, { data: session() })
  if (url.pathname === `/api/session/${toolSessionID}`) return json(res, { data: toolSession() })
  if (url.pathname === `/api/session/${sessionID}/message`) {
    return json(res, { data: hydratedMessages(), cursor: {} })
  }
  if (url.pathname === `/api/session/${toolSessionID}/message`) {
    return json(res, { data: hydratedToolMessages(), cursor: {} })
  }
  if (url.pathname === `/api/session/${sessionID}/pending`) return json(res, { data: [] })
  if (url.pathname === `/api/session/${toolSessionID}/pending`) return json(res, { data: [] })
  if (/^\/api\/experimental\/session\/[^/]+\/log$/.test(url.pathname)) {
    res.writeHead(200, { "Content-Type": "text/event-stream" })
    sendEvent(res, { type: "log.synced", aggregateID: sessionID })
    return res.end()
  }
  if (url.pathname === "/api/model" || url.pathname === "/api/command" || url.pathname === "/api/skill") {
    return json(res, { data: [] })
  }
  if (url.pathname === "/api/mcp") return json(res, { data: {} })
  if (url.pathname === "/__test/start") return startProgress(res)
  if (url.pathname === "/__test/finish") return finishProgress(res)
  if (url.pathname === "/__test/start-tool") return startToolCalling(res)
  if (url.pathname === "/__test/finish-tool") return finishToolCalling(res)
  return json(res, { data: null }, 404)
})

server.listen(port, "127.0.0.1", () => {
  if (portFile) fs.writeFileSync(portFile, String(port))
})

function shutdown() {
  server.close(() => process.exit(0))
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
