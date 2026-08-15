const test = require("node:test")
const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const http = require("node:http")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")
const { BUILT_IN_SKILLS, ensureOpenworkingProfile } = require("../src/opencode-profile")
const { assertValidV2Config, toV2Config } = require("../src/opencode-config-v2")

// v1 exposed a `debug skill` CLI subcommand; v2 does not (its `debug` only offers `agents`), so
// the inventory is read over HTTP from GET /api/skill — the same endpoint the app itself uses.
//
// Timing matters here: v2 builds its skill/command catalog ASYNCHRONOUSLY and answers 200 with an
// empty list for several seconds after /api/health starts succeeding. Polling until the catalog
// is populated is part of the contract being verified, not a workaround for flakiness.

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function requestJson(url, { method = "GET", body, auth } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const request = http.request(url, {
      method,
      headers: {
        Authorization: auth,
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {})
      }
    }, (response) => {
      let body = ""
      response.on("data", (chunk) => { body += chunk })
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode} for ${url}`))
          return
        }
        try { resolve(body ? JSON.parse(body) : null) } catch (error) { reject(error) }
      })
    })
    request.on("error", reject)
    if (payload) request.write(payload)
    request.end()
  })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test("bundled opencode runtime discovers the offline skill bundle", { timeout: 180000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-skills-"))
  const userDataPath = path.join(temp, "user-data")
  const profile = ensureOpenworkingProfile({ userDataPath })

  // The profile is authored in v1 vocabulary; translate it for the v2 runtime we spawn so this
  // keeps exercising the real profile pipeline rather than a hand-written fixture.
  const configPath = path.join(temp, "opencode-v2.json")
  const config = toV2Config(JSON.parse(fs.readFileSync(profile.configPath, "utf8")))
  assertValidV2Config(config)
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

  const runtimePlatform = process.platform === "win32" ? "windows" : process.platform
  const executable = process.platform === "win32" ? "opencode2.exe" : "opencode2"
  const runtime = path.join(__dirname, "..", "node_modules", "@opencode-ai", `cli-${runtimePlatform}-${process.arch}`, "bin", executable)

  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath, { recursive: true })
  const port = await findFreePort()
  const password = "skill-inventory-password"
  const serverUrl = `http://127.0.0.1:${port}`
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const logs = []

  const child = spawn(runtime, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: projectPath,
    env: {
      ...process.env,
      HOME: path.join(temp, "home"),
      XDG_CONFIG_HOME: profile.xdgConfigHome,
      XDG_DATA_HOME: path.join(temp, "data"),
      XDG_STATE_HOME: path.join(temp, "state"),
      XDG_CACHE_HOME: path.join(temp, "cache"),
      OPENCODE_CONFIG: configPath,
      OPENCODE_CONFIG_DIR: profile.profileDir,
      OPENCODE_SERVER_USERNAME: "opencode",
      OPENCODE_SERVER_PASSWORD: password,
      NO_COLOR: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  })
  child.stdout.on("data", (data) => logs.push(data.toString().trim()))
  child.stderr.on("data", (data) => logs.push(data.toString().trim()))
  t.after(() => { child.kill("SIGTERM") })

  const deadline = Date.now() + 60000
  let names = new Set()
  let health = null
  while (Date.now() < deadline) {
    await sleep(1000)
    try {
      health = await requestJson(`${serverUrl}/api/health`, { auth })
      const payload = await requestJson(`${serverUrl}/api/skill`, { auth })
      const skills = payload?.data || payload || []
      names = new Set(skills.map((skill) => skill.id || skill.name))
      if (BUILT_IN_SKILLS.every((skill) => names.has(skill.name))) break
    } catch {
      // Server not up yet, or the catalog is still building — keep polling until the deadline.
    }
  }

  for (const skill of BUILT_IN_SKILLS) {
    assert.equal(names.has(skill.name), true, `missing ${skill.name}\n${logs.join("\n").slice(-2000)}`)
  }
  assert.equal(health?.data?.version || health?.version, "0.0.0-next-17292")
  const openapi = await requestJson(`${serverUrl}/openapi.json`, { auth })
  assert.equal(Object.keys(openapi?.paths || {}).length, 104)
  for (const endpoint of [
    "/api/session/{sessionID}/prompt",
    "/api/session/{sessionID}/command",
    "/api/session/{sessionID}/skill",
    "/api/session/{sessionID}/fork"
  ]) {
    assert.ok(openapi.paths[endpoint], `missing OpenAPI endpoint: ${endpoint}`)
  }
  assert.match(JSON.stringify(openapi.paths["/api/session/{sessionID}/fork"]), /boundary/)

  const createdPayload = await requestJson(`${serverUrl}/api/session`, {
    method: "POST",
    auth,
    body: {}
  })
  const session = createdPayload?.data || createdPayload
  assert.ok(session?.id, `session creation failed\n${logs.join("\n").slice(-2000)}`)
  const sessionUrl = `${serverUrl}/api/session/${encodeURIComponent(session.id)}`
  await requestJson(`${sessionUrl}/skill`, {
    method: "POST",
    auth,
    body: { skill: "explain-project", resume: false }
  })
  const promptId = "msg_skillintegration1"
  await requestJson(`${sessionUrl}/prompt`, {
    method: "POST",
    auth,
    body: { id: promptId, text: "Explain the project entry points.", resume: true }
  })

  let messages = []
  const messageDeadline = Date.now() + 10000
  while (Date.now() < messageDeadline) {
    const messagePayload = await requestJson(`${sessionUrl}/message?limit=20&order=asc`, { auth })
    messages = messagePayload?.data || messagePayload || []
    if (messages.some((message) => message.type === "skill") && messages.some((message) => message.id === promptId)) break
    await sleep(100)
  }
  const skillIndex = messages.findIndex((message) => message.type === "skill" && message.skill === "explain-project")
  const promptIndex = messages.findIndex((message) => message.id === promptId && message.type === "user")
  assert.notEqual(skillIndex, -1, `missing native skill message\n${JSON.stringify(messages).slice(-4000)}`)
  assert.notEqual(promptIndex, -1, `missing durable user prompt\n${JSON.stringify(messages).slice(-4000)}`)
  assert.ok(skillIndex < promptIndex, "skill activation must be durable before the follow-up prompt")
})
