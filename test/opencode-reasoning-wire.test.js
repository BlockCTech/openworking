const test = require("node:test")
const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const http = require("node:http")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")
const { applyModelReasoningMode, ensureOpenworkingProfile, writeProfileConfig } = require("../src/opencode-profile")

const TEST_PROVIDER_ID = "gateway"
const TEST_MODEL_ID = "gpt-4o-mini"

function basicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function requestJson(url, { method = "GET", body, auth } = {}) {
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

function resolveRuntimeBin() {
  const runtimePlatform = process.platform === "win32" ? "windows" : process.platform
  const executable = process.platform === "win32" ? "opencode.exe" : "opencode"
  const platformRuntime = path.join(__dirname, "..", "node_modules", `opencode-${runtimePlatform}-${process.arch}`, "bin", executable)
  if (fs.existsSync(platformRuntime)) return platformRuntime
  return path.join(__dirname, "..", "node_modules", "opencode-ai", "bin", "opencode.exe")
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

function openEventStream(serverUrl, auth) {
  const parsed = new URL(serverUrl)
  const req = http.request({
    hostname: parsed.hostname,
    port: parsed.port,
    path: "/event",
    method: "GET",
    headers: {
      Accept: "text/event-stream",
      Authorization: auth
    }
  })
  req.on("response", (res) => {
    res.resume()
  })
  req.on("error", () => {})
  req.end()
  return req
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

async function waitForHealth(serverUrl, auth, logs) {
  const deadline = Date.now() + 15000
  let lastError
  while (Date.now() < deadline) {
    try {
      await requestJson(`${serverUrl}/global/health`, { auth })
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }
  throw new Error(`OpenCode server did not become healthy: ${lastError?.message || "timeout"}\n${logs.join("\n").slice(-4000)}`)
}

async function startMockGateway() {
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

async function captureOpenCodeChatCompletion(t, { title, configureModel, configureProfile } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-reasoning-wire-"))
  const gateway = await startMockGateway()
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
  configureModel?.(config.provider[TEST_PROVIDER_ID].models[TEST_MODEL_ID])
  writeProfileConfig(profile, config)
  configureProfile?.(profile)

  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  const port = await findFreePort()
  const password = "wire-test-password"
  const serverUrl = `http://127.0.0.1:${port}`
  const auth = basicAuth("opencode", password)
  const logs = []
  runtime = spawn(resolveRuntimeBin(), ["serve", "--port", String(port), "--hostname", "127.0.0.1", "--print-logs", "--pure"], {
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
  const eventStream = openEventStream(serverUrl, auth)
  t.after(() => {
    eventStream.destroy()
  })
  const session = await requestJson(`${serverUrl}/session`, {
    method: "POST",
    auth,
    body: { title: title || "Reasoning wire test" }
  })
  assert.ok(session?.id)

  await requestJson(`${serverUrl}/session/${encodeURIComponent(session.id)}/prompt_async`, {
    method: "POST",
    auth,
    body: {
      parts: [{ type: "text", text: "Reply with ok." }],
      model: { providerID: TEST_PROVIDER_ID, modelID: TEST_MODEL_ID }
    }
  })

  return withTimeout(
    gateway.capturedRequest,
    45000,
    `Mock gateway did not receive a chat completion request.\n${logs.join("\n").slice(-4000)}`
  )
}

test("OpenCode runtime omits reasoning fields when reasoning is none", { timeout: 60000 }, async (t) => {
  const captured = await captureOpenCodeChatCompletion(t, {
    title: "Reasoning none wire test",
    configureModel(model) {
      delete model.options.reasoningEffort
      delete model.options.reasoning_effort
      delete model.options.include_reasoning
      delete model.options.includeReasoning
    }
  })
  assert.equal(captured.path, "/api/v1/chat/completions")
  assert.equal(captured.body.model, TEST_MODEL_ID)
  assert.equal(captured.body.max_completion_tokens, 32000)
  assert.equal(Object.hasOwn(captured.body, "reasoning_effort"), false)
  assert.equal(Object.hasOwn(captured.body, "include_reasoning"), false)
  assert.equal(Object.hasOwn(captured.body, "reasoningEffort"), false)
  assert.equal(Object.hasOwn(captured.body, "includeReasoning"), false)
})

test("OpenCode runtime sends xhigh reasoning effort on the OpenAI-compatible wire", { timeout: 60000 }, async (t) => {
  const captured = await captureOpenCodeChatCompletion(t, {
    title: "Reasoning xhigh wire test",
    configureProfile(profile) {
      applyModelReasoningMode(profile, {
        providerID: TEST_PROVIDER_ID,
        modelID: TEST_MODEL_ID,
        mode: "xhigh"
      })
    }
  })
  assert.equal(captured.path, "/api/v1/chat/completions")
  assert.equal(captured.body.model, TEST_MODEL_ID)
  assert.equal(captured.body.max_completion_tokens, 32000)
  assert.equal(captured.body.reasoning_effort, "xhigh")
  assert.equal(captured.body.include_reasoning, true)
  assert.equal(Object.hasOwn(captured.body, "reasoningEffort"), false)
  assert.equal(Object.hasOwn(captured.body, "includeReasoning"), false)
})
