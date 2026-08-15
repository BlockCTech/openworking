const test = require("node:test")
const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const http = require("node:http")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")
const { ensureOpenworkingProfile, writeProfileConfig } = require("../src/opencode-profile")

const TEST_PROVIDER_ID = "gateway"
const TEST_MODEL_ID = "gpt-4o-mini"

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

// Every request carries a deadline. Without one a hung socket simply never settles: the await sits
// there consuming the whole test budget and the run dies on the test-level timeout with no clue
// which call stalled, instead of failing fast with the url that did.
function requestJson(url, { method = "GET", body, auth, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const payload = body === undefined ? null : JSON.stringify(body)
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(auth ? { Authorization: auth } : {})
        }
      },
      (res) => {
        let raw = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => {
          raw += chunk
        })
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 500)}`))
            return
          }
          if (!raw) {
            resolve(null)
            return
          }
          try {
            resolve(JSON.parse(raw))
          } catch {
            resolve(raw)
          }
        })
      }
    )
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms (${method} ${parsed.pathname})`))
    })
    req.on("error", reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function readRequestBody(req, done) {
  let raw = ""
  req.setEncoding("utf8")
  req.on("data", (chunk) => {
    raw += chunk
  })
  req.on("end", () => {
    done(raw ? JSON.parse(raw) : {})
  })
}

function findFreePort(hostname = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

// Resolved locally rather than importing process-manager's version: this test spawns the runtime
// directly to inspect the raw provider wire, so it must not depend on app wiring.
function resolveRuntimeBin() {
  const runtimePlatform = process.platform === "win32" ? "windows" : process.platform
  const executable = process.platform === "win32" ? "opencode2.exe" : "opencode2"
  return path.join(__dirname, "..", "node_modules", "@opencode-ai", `cli-${runtimePlatform}-${process.arch}`, "bin", executable)
}

function writeWireMcpFixture(directory) {
  const fixturePath = path.join(directory, "wire-mcp-fixture.cjs")
  fs.writeFileSync(fixturePath, `
"use strict"
const tool = { name: "get_project", description: "Get a Backlog project.", inputSchema: { type: "object", properties: { projectKey: { type: "string" }, projectId: { type: "number" } }, additionalProperties: false } }
let buffered = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffered += chunk
  let newline
  while ((newline = buffered.indexOf("\\n")) !== -1) {
    const line = buffered.slice(0, newline)
    buffered = buffered.slice(newline + 1)
    if (!line.trim()) continue
    const request = JSON.parse(line)
    if (request.id === undefined || request.id === null) continue
    let result
    if (request.method === "initialize") {
      result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "backlog-wire-fixture", version: "1.0.0" } }
    } else if (request.method === "tools/list") {
      result = { tools: [tool] }
    } else if (request.method === "tools/call") {
      result = { content: [{ type: "text", text: "ok" }] }
    } else {
      result = {}
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n")
  }
})
`)
  return fixturePath
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

function stopRuntime(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    const force = setTimeout(() => {
      child.kill("SIGKILL")
    }, 5000)
    child.once("exit", () => {
      clearTimeout(force)
      resolve()
    })
    child.kill("SIGTERM")
  })
}

function withTimeout(promise, ms, message) {
  let timeout
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), ms)
    })
  ]).finally(() => clearTimeout(timeout))
}

async function waitFor(check, ms, message) {
  const deadline = Date.now() + ms
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ""}`)
}

function openCollectedEventStream(serverUrl, auth) {
  const events = []
  let buffer = ""
  let resolveReady
  const ready = new Promise((resolve) => { resolveReady = resolve })
  const parsed = new URL(serverUrl)
  const req = http.request({
    hostname: parsed.hostname,
    port: parsed.port,
    path: "/api/event",
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      Authorization: auth
    }
  })
  req.on("response", (res) => {
    resolveReady()
    res.setEncoding("utf8")
    res.on("data", (chunk) => {
      buffer += chunk
      const frames = buffer.split("\n\n")
      buffer = frames.pop() || ""
      for (const frame of frames) {
        const raw = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
        if (!raw) continue
        try {
          events.push(JSON.parse(raw))
        } catch {}
      }
    })
  })
  req.on("error", () => {})
  req.end()
  return { req, ready, events }
}

async function waitForHealth(serverUrl, auth, logs) {
  const deadline = Date.now() + 60000
  let lastError
  while (Date.now() < deadline) {
    try {
      // Short per-probe timeout: the point of this loop is to retry until the server answers, so a
      // probe must not be allowed to outlive the loop's own deadline. A connection that hangs
      // instead of being refused (seen on Windows runners) would otherwise consume the whole
      // budget in a single attempt and report "did not become healthy" after one try.
      await requestJson(`${serverUrl}/api/health`, { auth, timeoutMs: 2000 })
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }
  throw new Error(`OpenCode server did not become healthy: ${lastError?.message || "timeout"}\n${logs.join("\n").slice(-4000)}`)
}

async function startControlledGateway() {
  const requests = []
  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, "http://127.0.0.1")
    if (req.method === "GET" && parsed.pathname.endsWith("/models")) {
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({
        object: "list",
        data: [{ id: TEST_MODEL_ID, object: "model" }]
      }))
      return
    }
    if (req.method === "POST" && parsed.pathname.endsWith("/chat/completions")) {
      readRequestBody(req, (body) => {
        requests.push({ body, res })
      })
      return
    }
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    server,
    requests,
    baseURL: `http://127.0.0.1:${server.address().port}/api/v1`,
    complete(index) {
      const request = requests[index]
      if (!request || request.res.destroyed || request.res.writableEnded) return false
      const created = Math.floor(Date.now() / 1000)
      request.res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      })
      request.res.write(`data: ${JSON.stringify({
        id: `chatcmpl-controlled-${index}`,
        object: "chat.completion.chunk",
        created,
        model: request.body.model || TEST_MODEL_ID,
        choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }]
      })}\n\n`)
      request.res.write(`data: ${JSON.stringify({
        id: `chatcmpl-controlled-${index}`,
        object: "chat.completion.chunk",
        created,
        model: request.body.model || TEST_MODEL_ID,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })}\n\n`)
      request.res.write("data: [DONE]\n\n")
      request.res.end()
      return true
    },
    completeToolCall(index, name, args) {
      const request = requests[index]
      if (!request || request.res.destroyed || request.res.writableEnded) return false
      const created = Math.floor(Date.now() / 1000)
      request.res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      })
      request.res.write(`data: ${JSON.stringify({
        id: `chatcmpl-controlled-${index}`,
        object: "chat.completion.chunk",
        created,
        model: request.body.model || TEST_MODEL_ID,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: `call-controlled-${index}`,
              type: "function",
              function: { name, arguments: JSON.stringify(args) }
            }]
          },
          finish_reason: null
        }]
      })}\n\n`)
      request.res.write(`data: ${JSON.stringify({
        id: `chatcmpl-controlled-${index}`,
        object: "chat.completion.chunk",
        created,
        model: request.body.model || TEST_MODEL_ID,
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      })}\n\n`)
      request.res.write("data: [DONE]\n\n")
      request.res.end()
      return true
    }
  }
}

async function startMockGateway({ reasoningField = "reasoning" } = {}) {
  let resolveCapture
  const capturedRequest = new Promise((resolve) => {
    resolveCapture = resolve
  })
  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url, "http://127.0.0.1")
    if (req.method === "GET" && parsed.pathname.endsWith("/models")) {
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({
        object: "list",
        data: [{ id: TEST_MODEL_ID, object: "model" }]
      }))
      return
    }
    if (req.method === "POST" && parsed.pathname.endsWith("/chat/completions")) {
      readRequestBody(req, (body) => {
        resolveCapture({ path: parsed.pathname, headers: req.headers, body })
        if (body.stream === false) {
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({
            id: "chatcmpl-openworking-test",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: body.model || TEST_MODEL_ID,
            choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
          }))
          return
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        })
        const created = Math.floor(Date.now() / 1000)
        const chunk = {
          id: "chatcmpl-openworking-test",
          object: "chat.completion.chunk",
          created,
          model: body.model || TEST_MODEL_ID,
          choices: [{ index: 0, delta: { [reasoningField]: "Inspecting the project." }, finish_reason: null }]
        }
        const answer = {
          id: "chatcmpl-openworking-test",
          object: "chat.completion.chunk",
          created,
          model: body.model || TEST_MODEL_ID,
          choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }]
        }
        const done = {
          id: "chatcmpl-openworking-test",
          object: "chat.completion.chunk",
          created,
          model: body.model || TEST_MODEL_ID,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        res.write(`data: ${JSON.stringify(answer)}\n\n`)
        res.write(`data: ${JSON.stringify(done)}\n\n`)
        res.write("data: [DONE]\n\n")
        res.end()
      })
      return
    }
    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  return {
    server,
    baseURL: `http://127.0.0.1:${port}/api/v1`,
    capturedRequest
  }
}

async function captureOpenCodeChatCompletion(t, { variant, reasoningField } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-reasoning-wire-"))
  const gateway = await startMockGateway({ reasoningField })
  let runtime = null
  t.after(async () => {
    await stopRuntime(runtime)
    await closeServer(gateway.server)
  })

  const userDataPath = path.join(temp, "user-data")
  const profile = ensureOpenworkingProfile({ userDataPath })
  const config = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  config.provider[TEST_PROVIDER_ID].options.baseURL = gateway.baseURL
  config.provider[TEST_PROVIDER_ID].options.apiKey = "test-key"
  // Production profiles historically persisted this v1 option. OpenCode v2 owns the stream
  // field and rejects it if the runtime config copies it into model.body.
  config.provider[TEST_PROVIDER_ID].models[TEST_MODEL_ID].options.stream = true
  writeProfileConfig(profile, config)

  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  const port = await findFreePort()
  const password = "wire-test-password"
  const serverUrl = `http://127.0.0.1:${port}`
  const auth = basicAuth("opencode", password)
  const logs = []
  runtime = spawn(resolveRuntimeBin(), ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: projectPath,
    env: {
      ...process.env,
      HOME: path.join(temp, "home"),
      XDG_CONFIG_HOME: profile.xdgConfigHome,
      XDG_DATA_HOME: path.join(profile.profileDir, "data"),
      XDG_STATE_HOME: path.join(profile.profileDir, "state"),
      XDG_CACHE_HOME: path.join(profile.profileDir, "cache"),
      OPENCODE_CONFIG: profile.xdgConfigPath,
      OPENCODE_CONFIG_DIR: profile.profileDir,
      OPENCODE_SERVER_USERNAME: "opencode",
      OPENCODE_SERVER_PASSWORD: password,
      NO_COLOR: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  })
  runtime.stdout.on("data", (data) => logs.push(data.toString().trim()))
  runtime.stderr.on("data", (data) => logs.push(data.toString().trim()))

  await waitForHealth(serverUrl, auth, logs)
  const eventStream = openCollectedEventStream(serverUrl, auth)
  await withTimeout(eventStream.ready, 5000, "Event stream did not connect.")
  t.after(() => {
    eventStream.req.destroy()
  })
  const runtimePid = runtime.pid
  const created = await requestJson(`${serverUrl}/api/session`, {
    method: "POST",
    auth,
    body: {
      agent: "build",
      model: { providerID: TEST_PROVIDER_ID, id: TEST_MODEL_ID }
    }
  })
  const session = created?.data || created
  assert.ok(session?.id)

  if (variant) {
    await requestJson(`${serverUrl}/api/session/${encodeURIComponent(session.id)}/model`, {
      method: "POST",
      auth,
      body: {
        model: { providerID: TEST_PROVIDER_ID, id: TEST_MODEL_ID, variant }
      }
    })
  }
  assert.equal(runtime.pid, runtimePid, "native variant selection must keep the runtime process")
  assert.equal(eventStream.req.destroyed, false, "native variant selection must keep the SSE connection")

  await requestJson(`${serverUrl}/api/session/${encodeURIComponent(session.id)}/prompt`, {
    method: "POST",
    auth,
    body: { text: "Reply with ok." }
  })

  const captured = await withTimeout(
    gateway.capturedRequest,
    30000,
    `Mock gateway did not receive a chat completion request.\n${logs.join("\n").slice(-4000)}`
  )
  await waitFor(
    () => eventStream.events.some((event) => (
      event.type === "session.reasoning.ended" &&
      event.data?.sessionID === session.id
    )),
    10000,
    `OpenCode did not emit durable agent progress.\n${logs.join("\n").slice(-4000)}`
  )
  await waitFor(
    () => eventStream.events.some((event) => (
      event.type === "session.text.delta" &&
      event.data?.sessionID === session.id &&
      event.data?.delta === "ok"
    )),
    10000,
    `OpenCode did not emit the final answer after agent progress.\n${logs.join("\n").slice(-4000)}`
  )
  return { ...captured, runtimeEvents: eventStream.events, sessionID: session.id }
}

test("OpenCode runtime requests agent progress without forcing Base reasoning effort", { timeout: 120000 }, async (t) => {
  const captured = await captureOpenCodeChatCompletion(t, { reasoningField: "reasoning_content" })
  assert.equal(captured.path, "/api/v1/chat/completions")
  assert.equal(captured.body.model, TEST_MODEL_ID)
  assert.equal(captured.body.max_completion_tokens, 32000)
  assert.equal(Object.hasOwn(captured.body, "max_tokens"), false)
  assert.equal(captured.body.stream, true)
  assert.equal(Object.hasOwn(captured.body, "reasoning_effort"), false)
  assert.equal(captured.body.include_reasoning, true)
  assert.equal(Object.hasOwn(captured.body, "reasoningEffort"), false)
  assert.equal(Object.hasOwn(captured.body, "includeReasoning"), false)
  const progressEvents = captured.runtimeEvents.filter((event) => (
    event.data?.sessionID === captured.sessionID &&
    (event.type === "session.reasoning.delta" || event.type === "session.reasoning.ended")
  ))
  assert.ok(progressEvents.some((event) => event.type === "session.reasoning.delta"))
  assert.ok(progressEvents.some((event) => (
    event.type === "session.reasoning.ended" &&
    event.data.text === "Inspecting the project."
  )))
  assert.ok(captured.runtimeEvents.some((event) => (
    event.type === "session.text.delta" &&
    event.data?.sessionID === captured.sessionID &&
    event.data?.delta === "ok"
  )))
})

for (const variant of ["medium", "high", "xhigh"]) {
  test(`OpenCode runtime sends ${variant} native variant on the OpenAI-compatible wire`, { timeout: 120000 }, async (t) => {
    const captured = await captureOpenCodeChatCompletion(t, { variant })
    assert.equal(captured.path, "/api/v1/chat/completions")
    assert.equal(captured.body.model, TEST_MODEL_ID)
    assert.equal(captured.body.max_completion_tokens, 32000)
    assert.equal(Object.hasOwn(captured.body, "max_tokens"), false)
    assert.equal(captured.body.stream, true)
    assert.equal(captured.body.reasoning_effort, variant)
    assert.equal(captured.body.include_reasoning, true)
    assert.equal(Object.hasOwn(captured.body, "reasoningEffort"), false)
    assert.equal(Object.hasOwn(captured.body, "includeReasoning"), false)
  })
}

test("OpenCode runtime sends managed plugins and MCP tools as direct functions", { timeout: 180000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-translate-wire-"))
  const gateway = await startControlledGateway()
  let runtime = null
  t.after(async () => {
    await stopRuntime(runtime)
    gateway.server.closeAllConnections?.()
    await closeServer(gateway.server)
  })

  const profile = ensureOpenworkingProfile({ userDataPath: path.join(temp, "user-data") })
  const config = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  const mcpFixture = writeWireMcpFixture(temp)
  const browserMcpEntry = path.join(__dirname, "..", "resources", "browser-mcp", "index.js")
  config.provider[TEST_PROVIDER_ID].options.baseURL = gateway.baseURL
  config.provider[TEST_PROVIDER_ID].options.apiKey = "test-key"
  config.mcp = {
    browser: { type: "local", command: [process.execPath, browserMcpEntry], enabled: true },
    backlog: { type: "local", command: [process.execPath, mcpFixture], enabled: true }
  }
  writeProfileConfig(profile, config)

  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  const inputPath = path.join(projectPath, "source.md")
  fs.writeFileSync(inputPath, "```text\nno translatable segments\n```\n")
  const port = await findFreePort()
  const password = "translate-wire-test-password"
  const serverUrl = `http://127.0.0.1:${port}`
  const auth = basicAuth("opencode", password)
  const logs = []
  runtime = spawn(resolveRuntimeBin(), ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: projectPath,
    env: {
      ...process.env,
      HOME: path.join(temp, "home"),
      XDG_CONFIG_HOME: profile.xdgConfigHome,
      XDG_DATA_HOME: path.join(profile.profileDir, "data"),
      XDG_STATE_HOME: path.join(profile.profileDir, "state"),
      XDG_CACHE_HOME: path.join(profile.profileDir, "cache"),
      OPENCODE_CONFIG: profile.xdgConfigPath,
      OPENCODE_CONFIG_DIR: profile.profileDir,
      OPENCODE_SERVER_USERNAME: "opencode",
      OPENCODE_SERVER_PASSWORD: password,
      NO_COLOR: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  })
  runtime.stdout.on("data", (data) => logs.push(data.toString().trim()))
  runtime.stderr.on("data", (data) => logs.push(data.toString().trim()))
  await waitForHealth(serverUrl, auth, logs)
  await waitFor(async () => {
    const statuses = await requestJson(`${serverUrl}/api/mcp`, { auth })
    const entries = Array.isArray(statuses?.data) ? statuses.data : Object.entries(statuses?.data || statuses || {}).map(([name, status]) => ({ name, status }))
    const connected = (name) => entries.find((entry) => entry.name === name)?.status?.status === "connected"
    if (connected("browser") && connected("backlog")) return true
    throw new Error(JSON.stringify(statuses))
  }, 15000, `MCP fixtures did not connect.\n${logs.join("\n").slice(-4000)}`)

  const created = await requestJson(`${serverUrl}/api/session`, {
    method: "POST",
    auth,
    body: { agent: "build", model: { providerID: TEST_PROVIDER_ID, id: TEST_MODEL_ID } }
  })
  const session = created?.data || created
  const sessionUrl = `${serverUrl}/api/session/${encodeURIComponent(session.id)}`
  await requestJson(`${sessionUrl}/rename`, {
    method: "POST",
    auth,
    body: { title: "Translate document wire regression" }
  })
  // Held open deliberately: the mock gateway does not answer until this test calls complete(), so
  // this one needs a wider deadline than the default request timeout.
  const prompt = requestJson(`${sessionUrl}/prompt`, {
    method: "POST",
    auth,
    body: { text: "Translate the attached document to Vietnamese." },
    timeoutMs: 120000
  })

  await waitFor(() => gateway.requests.length >= 1, 30000, `Missing first provider request.\n${logs.join("\n").slice(-4000)}`)
  const directTool = gateway.requests[0].body.tools?.find((tool) => tool.function?.name === "translate_document")
  const officeTool = gateway.requests[0].body.tools?.find((tool) => tool.function?.name === "translate_office_document")
  const rememberTool = gateway.requests[0].body.tools?.find((tool) => tool.function?.name === "remember")
  const browserTool = gateway.requests[0].body.tools?.find((tool) => tool.function?.name === "browser_read")
  const browserClickTool = gateway.requests[0].body.tools?.find((tool) => tool.function?.name === "browser_click")
  const backlogTool = gateway.requests[0].body.tools?.find((tool) => tool.function?.name === "backlog_get_project")
  assert.ok(directTool, `translate_document was not sent directly.\n${JSON.stringify(gateway.requests[0].body.tools)}`)
  assert.ok(officeTool, `translate_office_document was not sent directly.\n${JSON.stringify(gateway.requests[0].body.tools)}`)
  assert.ok(rememberTool, `remember was not sent directly.\n${JSON.stringify(gateway.requests[0].body.tools)}`)
  assert.ok(browserTool, `browser_read was not sent directly.\n${JSON.stringify(gateway.requests[0].body.tools)}`)
  assert.ok(browserClickTool, `browser_click was not sent directly.\n${JSON.stringify(gateway.requests[0].body.tools)}`)
  assert.ok(backlogTool, `backlog_get_project was not sent directly.\n${JSON.stringify(gateway.requests[0].body.tools)}`)
  assert.deepEqual(Object.keys(directTool.function.parameters.properties), ["inputPath", "targetLanguage", "sourceLanguage"])
  assert.deepEqual(Object.keys(officeTool.function.parameters.properties), ["inputPath", "targetLanguage", "sourceLanguage", "mode"])
  assert.deepEqual(directTool.function.parameters.required, ["inputPath", "targetLanguage"])
  assert.deepEqual(officeTool.function.parameters.required, ["inputPath", "targetLanguage"])
  assert.deepEqual(Object.keys(rememberTool.function.parameters.properties), ["fact", "scope"])
  assert.deepEqual(rememberTool.function.parameters.required, ["fact"])
  assert.equal(gateway.completeToolCall(0, "translate_document", { inputPath, targetLanguage: "Vietnamese" }), true)

  await waitFor(() => gateway.requests.length >= 2, 30000, `Tool execution did not resume the provider.\n${logs.join("\n").slice(-4000)}`)
  assert.equal(gateway.complete(1), true)
  await withTimeout(prompt, 30000, `Prompt did not finish after the tool call.\n${logs.join("\n").slice(-4000)}`)

  let messages = []
  await waitFor(async () => {
    const payload = await requestJson(`${sessionUrl}/message?limit=20&order=asc`, { auth })
    messages = payload?.data || payload || []
    return messages.some((message) => message.content?.some((part) => part.type === "tool" && part.name === "translate_document"))
  }, 10000, `Translated tool message was not durable.\n${logs.join("\n").slice(-4000)}`)
  const toolPart = messages.flatMap((message) => message.content || []).find((part) => part.type === "tool" && part.name === "translate_document")
  assert.equal(toolPart.state.status, "completed")
  assert.equal(toolPart.state.metadata.quality, "verified")
  assert.equal(toolPart.state.metadata.artifacts.length, 1)
  assert.equal(fs.existsSync(toolPart.state.metadata.artifacts[0].path), true)

  async function assertSchemaRejected(args, expectedField) {
    const requestIndex = gateway.requests.length
    const beforePayload = await requestJson(`${sessionUrl}/message?limit=50&order=asc`, { auth })
    const errorCountBefore = (beforePayload?.data || beforePayload || []).flatMap((message) => message.content || []).filter((part) => (
      part.type === "tool" && part.name === "translate_document" && part.state?.status === "error"
    )).length
    const invalidPrompt = requestJson(`${sessionUrl}/prompt`, {
      method: "POST",
      auth,
      body: { text: "Translate this document." },
      timeoutMs: 120000
    })
    await waitFor(() => gateway.requests.length > requestIndex, 30000, "Missing invalid-call provider request.")
    assert.equal(gateway.completeToolCall(requestIndex, "translate_document", args), true)
    await waitFor(() => gateway.requests.length > requestIndex + 1, 30000, "Schema rejection did not resume the provider.")
    const followup = JSON.stringify(gateway.requests[requestIndex + 1].body.messages)
    assert.match(followup, /Invalid tool input/)
    assert.match(followup, new RegExp(expectedField))
    assert.equal(gateway.complete(requestIndex + 1), true)
    await withTimeout(invalidPrompt, 30000, "Invalid tool-call prompt did not finish.")

    let invalidMessages = []
    await waitFor(async () => {
      const payload = await requestJson(`${sessionUrl}/message?limit=50&order=asc`, { auth })
      invalidMessages = payload?.data || payload || []
      return invalidMessages.flatMap((message) => message.content || []).filter((part) => (
        part.type === "tool" && part.name === "translate_document" && part.state?.status === "error"
      )).length > errorCountBefore
    }, 10000, "Schema-rejected tool message was not durable.")
  }

  const legacyInput = path.join(projectPath, "legacy.md")
  const missingTargetInput = path.join(projectPath, "missing-target.md")
  fs.writeFileSync(legacyInput, "```text\nlegacy path payload\n```\n")
  fs.writeFileSync(missingTargetInput, "```text\nmissing target payload\n```\n")
  const filesBeforeInvalidCalls = fs.readdirSync(projectPath).sort()
  await assertSchemaRejected({ path: legacyInput, targetLanguage: "Vietnamese" }, "inputPath")
  await assertSchemaRejected({ inputPath: missingTargetInput }, "targetLanguage")
  assert.deepEqual(fs.readdirSync(projectPath).sort(), filesBeforeInvalidCalls)
})

test("OpenCode runtime keeps native queue/steer admission durable across duplicate submit, reconnect and interrupt", { timeout: 180000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-queue-wire-"))
  const gateway = await startControlledGateway()
  let runtime = null
  let eventStream = null
  let reconnectedStream = null
  t.after(async () => {
    eventStream?.req.destroy()
    reconnectedStream?.req.destroy()
    await stopRuntime(runtime)
    gateway.server.closeAllConnections?.()
    await closeServer(gateway.server)
  })

  const userDataPath = path.join(temp, "user-data")
  const profile = ensureOpenworkingProfile({ userDataPath })
  const config = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  config.provider[TEST_PROVIDER_ID].options.baseURL = gateway.baseURL
  config.provider[TEST_PROVIDER_ID].options.apiKey = "test-key"
  writeProfileConfig(profile, config)

  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  const port = await findFreePort()
  const password = "queue-wire-test-password"
  const serverUrl = `http://127.0.0.1:${port}`
  const auth = basicAuth("opencode", password)
  const logs = []
  runtime = spawn(resolveRuntimeBin(), ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: projectPath,
    env: {
      ...process.env,
      HOME: path.join(temp, "home"),
      XDG_CONFIG_HOME: profile.xdgConfigHome,
      XDG_DATA_HOME: path.join(profile.profileDir, "data"),
      XDG_STATE_HOME: path.join(profile.profileDir, "state"),
      XDG_CACHE_HOME: path.join(profile.profileDir, "cache"),
      OPENCODE_CONFIG: profile.configPath,
      OPENCODE_CONFIG_DIR: profile.profileDir,
      OPENCODE_SERVER_USERNAME: "opencode",
      OPENCODE_SERVER_PASSWORD: password,
      NO_COLOR: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  })
  runtime.stdout.on("data", (data) => logs.push(data.toString().trim()))
  runtime.stderr.on("data", (data) => logs.push(data.toString().trim()))
  await waitForHealth(serverUrl, auth, logs)

  eventStream = openCollectedEventStream(serverUrl, auth)
  await withTimeout(eventStream.ready, 5000, "Initial event stream did not connect.")
  const runtimePid = runtime.pid
  const created = await requestJson(`${serverUrl}/api/session`, {
    method: "POST",
    auth,
    body: {
      agent: "build",
      model: { providerID: TEST_PROVIDER_ID, id: TEST_MODEL_ID }
    }
  })
  const session = created?.data || created
  assert.ok(session?.id)
  const promptUrl = `${serverUrl}/api/session/${encodeURIComponent(session.id)}/prompt`
  const pendingUrl = `${serverUrl}/api/session/${encodeURIComponent(session.id)}/pending`
  const postPrompt = (id, text, delivery) => requestJson(promptUrl, {
    method: "POST",
    auth,
    body: { id, text, delivery, resume: true },
    timeoutMs: 120000
  })
  const ACTIVE_ID = "msg_wireactive1"
  const QUEUE_ONE_ID = "msg_wirequeue001"
  const STEER_ID = "msg_wiresteer001"
  const QUEUE_TWO_ID = "msg_wirequeue002"

  await postPrompt(ACTIVE_ID, "Hold the active run.", "queue")
  await waitFor(
    () => gateway.requests.length >= 1 &&
      eventStream.events.some((event) => event.type === "session.input.promoted" && event.data?.inputID === ACTIVE_ID),
    30000,
    `The first input was not promoted.\n${logs.join("\n").slice(-4000)}`
  )

  const queueOne = await postPrompt(QUEUE_ONE_ID, "Run second.", "queue")
  await postPrompt(STEER_ID, "Steer the active run.", "steer")
  await postPrompt(QUEUE_TWO_ID, "Run after the second queue item.", "queue")
  const duplicate = await postPrompt(QUEUE_ONE_ID, "Run second.", "queue")
  assert.equal((queueOne?.data || queueOne).id, QUEUE_ONE_ID)
  assert.equal((duplicate?.data || duplicate).id, QUEUE_ONE_ID)

  await waitFor(
    () => [QUEUE_ONE_ID, STEER_ID, QUEUE_TWO_ID].every((id) => (
      eventStream.events.some((event) => event.type === "session.input.admitted" && event.data?.inputID === id)
    )),
    10000,
    "Queued/steered admission events were incomplete."
  )
  const admittedQueueOne = eventStream.events.filter((event) => (
    event.type === "session.input.admitted" && event.data?.inputID === QUEUE_ONE_ID
  ))
  assert.equal(admittedQueueOne.length, 1, "retrying the same input id must not create another admission")
  const steerAdmission = eventStream.events.find((event) => (
    event.type === "session.input.admitted" && event.data?.inputID === STEER_ID
  ))
  assert.equal(steerAdmission.data.input.delivery, "steer")
  assert.equal(gateway.complete(0), true)
  await waitFor(
    () => eventStream.events.some((event) => (
      event.type === "session.input.promoted" && event.data?.inputID === STEER_ID
    )),
    10000,
    "the explicit steer input was admitted but never promoted into the active run"
  )

  const pendingBeforeReconnect = (await requestJson(pendingUrl, { auth })).data
  const queuedBeforeReconnect = pendingBeforeReconnect.filter((input) => input.type === "user" && input.delivery === "queue")
  assert.deepEqual(queuedBeforeReconnect.map((input) => input.id), [QUEUE_ONE_ID, QUEUE_TWO_ID])
  assert.equal(pendingBeforeReconnect.filter((input) => input.id === QUEUE_ONE_ID).length, 1)

  eventStream.req.destroy()
  reconnectedStream = openCollectedEventStream(serverUrl, auth)
  await withTimeout(reconnectedStream.ready, 5000, "Reconnected event stream did not connect.")
  assert.equal(runtime.pid, runtimePid, "renderer/SSE reconnect must not restart the runtime")
  const pendingAfterReconnect = (await requestJson(pendingUrl, { auth })).data
  assert.deepEqual(
    pendingAfterReconnect.filter((input) => input.delivery === "queue").map((input) => input.id),
    [QUEUE_ONE_ID, QUEUE_TWO_ID],
    "pending hydration must preserve queue FIFO after reconnect"
  )

  await requestJson(`${serverUrl}/api/session/${encodeURIComponent(session.id)}/interrupt`, {
    method: "POST",
    auth
  })
  await waitFor(async () => {
    const pending = (await requestJson(pendingUrl, { auth })).data
    return pending.some((input) => input.id === QUEUE_ONE_ID) ||
      [...eventStream.events, ...reconnectedStream.events].some((event) => (
        event.type === "session.input.promoted" && event.data?.inputID === QUEUE_ONE_ID
      ))
  }, 10000, "interrupt lost the first queued input instead of retaining or promoting it")
})
