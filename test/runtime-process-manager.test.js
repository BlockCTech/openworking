const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const AdmZip = require("adm-zip")
const { RuntimeProcessManager, buildPromptParts, projectMessagePart, projectRuntimeEvent, projectToolMetadata, resolveRuntimeBin, resolveUserPath, pathHasExecutable, translationGatewayEnv } = require("../src/runtime/process-manager")

test("translation gateway env resolves managed config without exposing extra provider fields", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-gateway-"))
  const configPath = path.join(temp, "opencode.json")
  fs.writeFileSync(configPath, JSON.stringify({
    provider: {
      managed: {
        options: { baseURL: "https://gateway.example/v1", apiKey: "{env:GATEWAY_KEY}", ignored: "do-not-export" },
        models: { "gemma/model": {} }
      }
    }
  }))

  assert.deepEqual(translationGatewayEnv(configPath, { GATEWAY_KEY: "secret" }), {
    OPENWORKING_TRANSLATION_BASE_URL: "https://gateway.example/v1",
    OPENWORKING_TRANSLATION_API_KEY: "secret",
    OPENWORKING_TRANSLATION_MODEL: "gemma/model"
  })
})

test("resolveUserPath preserves the current PATH entries and dedupes", async () => {
  const originalPath = process.env.PATH
  try {
    const unique = path.join(os.tmpdir(), `openworking-path-${Date.now()}`)
    // Duplicate an entry to confirm dedup; include a unique marker dir to confirm preservation.
    process.env.PATH = [unique, "/usr/bin", "/usr/bin", unique].join(path.delimiter)
    const resolved = await resolveUserPath({ force: true })
    const parts = resolved.split(path.delimiter)

    // Every current PATH entry survives.
    assert.ok(parts.includes(unique))
    assert.ok(parts.includes("/usr/bin"))
    // No duplicates in the merged result.
    assert.equal(new Set(parts).size, parts.length)
  } finally {
    process.env.PATH = originalPath
    await resolveUserPath({ force: true })
  }
})

test("resolveUserPath caches and returns the same value until forced", async () => {
  const originalPath = process.env.PATH
  try {
    process.env.PATH = "/usr/bin"
    const first = await resolveUserPath({ force: true })
    process.env.PATH = "/somewhere/else"
    // Without force, the cached value (from the previous force call) is returned unchanged.
    assert.equal(await resolveUserPath(), first)
    // Forcing picks up the new PATH.
    assert.notEqual(await resolveUserPath({ force: true }), first)
  } finally {
    process.env.PATH = originalPath
    await resolveUserPath({ force: true })
  }
})

test("resolveUserPath includes a fallback dir holding npx even when the login shell yields nothing", async () => {
  // The login shell can time out / error on a heavy ~/.zshrc and return []. As long as the merged
  // PATH still contains a dir with `npx`, local stdio MCP servers (e.g. `npx backlog-mcp-server`)
  // can be spawned. Simulate that by putting a dir that holds an executable `npx` onto the PATH.
  const originalPath = process.env.PATH
  const npxDir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-npx-"))
  fs.writeFileSync(path.join(npxDir, "npx"), "#!/bin/sh\n", { mode: 0o755 })
  try {
    process.env.PATH = npxDir
    const resolved = await resolveUserPath({ force: true })
    const parts = resolved.split(path.delimiter)
    assert.ok(parts.includes(npxDir), "fallback dir holding npx must survive into the resolved PATH")
  } finally {
    process.env.PATH = originalPath
    fs.rmSync(npxDir, { recursive: true, force: true })
    await resolveUserPath({ force: true })
  }
})

test("pathHasExecutable detects an executable on the PATH and reports its absence", () => {
  const npxDir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-hasexec-"))
  fs.writeFileSync(path.join(npxDir, "npx"), "#!/bin/sh\n", { mode: 0o755 })
  try {
    const withNpx = [npxDir, "/no/such/dir"].join(path.delimiter)
    assert.equal(pathHasExecutable(withNpx, "npx"), true)
    assert.equal(pathHasExecutable("/no/such/dir", "npx"), false)
    assert.equal(pathHasExecutable("", "npx"), false)
  } finally {
    fs.rmSync(npxDir, { recursive: true, force: true })
  }
})

test("tool metadata projection keeps only allowlisted artifact fields", () => {
  assert.deepEqual(projectToolMetadata({
    artifacts: [{ path: "/tmp/report.pdf", filename: "report.pdf", mime: "application/pdf", secret: "remove" }],
    quality: "warning",
    warnings: ["Check layout"],
    secret: "remove"
  }), {
    artifacts: [{ path: "/tmp/report.pdf", filename: "report.pdf", mime: "application/pdf" }],
    quality: "warning",
    warnings: ["Check layout"]
  })
})

test("tool metadata projection forwards the unified diff and filepath", () => {
  const diff = "@@ -1 +1 @@\n-old line\n+new line"
  assert.deepEqual(projectToolMetadata({
    diff,
    filepath: "/project/src/main.js",
    diagnostics: { "/project/src/main.js": [{ message: "drop me" }] },
    secret: "remove"
  }), {
    artifacts: [],
    quality: "verified",
    warnings: [],
    diff,
    filepath: "/project/src/main.js"
  })
})

test("tool metadata projection lists files for multi-file patch diffs", () => {
  const diff = "@@ -1 +1 @@\n-a\n+b"
  assert.deepEqual(projectToolMetadata({
    diff,
    files: ["a.js", "b.js", 7]
  }), {
    artifacts: [],
    quality: "verified",
    warnings: [],
    diff,
    files: ["a.js", "b.js"]
  })
})

test("tool metadata projection truncates oversized diffs", () => {
  const diff = "+x\n".repeat(100000)
  const projected = projectToolMetadata({ diff, filepath: "/project/big.js" })
  assert.equal(projected.diffTruncated, true)
  assert.equal(projected.diff.length, 200000)
  assert.ok(diff.startsWith(projected.diff))
})

test("tool metadata projection returns null when nothing is allowlisted", () => {
  assert.equal(projectToolMetadata({ secret: "remove", diff: "" }), null)
})

test("text part projection preserves the synthetic flag", () => {
  assert.deepEqual(projectMessagePart({
    id: "part_synthetic",
    sessionID: "sess_one",
    messageID: "msg_user",
    type: "text",
    synthetic: true,
    text: "Called the Read tool with the following input: {}"
  }), {
    id: "part_synthetic",
    sessionID: "sess_one",
    messageID: "msg_user",
    type: "text",
    text: "Called the Read tool with the following input: {}",
    synthetic: true
  })

  assert.equal("synthetic" in projectMessagePart({
    id: "part_plain",
    sessionID: "sess_one",
    messageID: "msg_user",
    type: "text",
    text: "Plain prompt"
  }), false)
})

test("reasoning part projection keeps only the text content across the boundary", () => {
  assert.deepEqual(projectMessagePart({
    id: "part_reasoning",
    sessionID: "sess_one",
    messageID: "msg_assistant",
    type: "reasoning",
    text: "Let me think about this…",
    metadata: { provider: "secret" },
    time: { start: 1, end: 2 }
  }), {
    id: "part_reasoning",
    sessionID: "sess_one",
    messageID: "msg_assistant",
    type: "reasoning",
    text: "Let me think about this…"
  })
})

test("question.asked projection whitelists prompt and option display fields", () => {
  const projected = projectRuntimeEvent({
    type: "question.asked",
    properties: {
      sessionID: "sess_one",
      requestID: "q1",
      header: "Pick an approach",
      questions: [{
        question: "Which approach should I take?",
        multiple: true,
        options: [
          { label: "Doc + script", value: "both", description: "Recommended", secret: "drop" },
          "doc-only"
        ]
      }],
      secret: "drop"
    }
  })

  assert.deepEqual(projected, {
    type: "question.asked",
    sessionID: "sess_one",
    requestID: "q1",
    question: {
      header: "Pick an approach",
      questions: [{
        question: "Which approach should I take?",
        multiple: true,
        options: [
          { label: "Doc + script", value: "both", description: "Recommended" },
          { label: "doc-only", value: "doc-only" }
        ]
      }]
    }
  })
})

test("question.asked projection accepts a single question string and falls back to id", () => {
  const projected = projectRuntimeEvent({
    type: "question.asked",
    properties: { sessionID: "sess_one", id: "q9", question: "Continue?" }
  })
  assert.equal(projected.requestID, "q9")
  assert.equal(projected.question.questions[0].question, "Continue?")
  assert.deepEqual(projected.question.questions[0].options, [])
})

test("question reply/reject projection forwards only ids", () => {
  for (const type of ["question.replied", "question.rejected"]) {
    assert.deepEqual(projectRuntimeEvent({ type, properties: { sessionID: "sess_one", requestID: "q1", extra: "drop" } }), {
      type, sessionID: "sess_one", requestID: "q1"
    })
  }
})

test("permission.asked projection whitelists display fields and flattens metadata into details", () => {
  const projected = projectRuntimeEvent({
    type: "permission.asked",
    properties: {
      sessionID: "sess_one",
      requestID: "p1",
      title: "Allow edit to src/index.js?",
      permission: "backlog_update_issue",
      type: "edit",
      pattern: "src/**",
      callID: "call_42",
      metadata: { issueIdOrKey: "TSD-131", statusId: 2, nested: { a: 1 }, empty: null },
      secret: "drop"
    }
  })

  assert.deepEqual(projected, {
    type: "permission.asked",
    sessionID: "sess_one",
    requestID: "p1",
    permission: {
      title: "Allow edit to src/index.js?",
      permission: "backlog_update_issue",
      type: "edit",
      pattern: "src/**",
      callID: "call_42",
      details: [
        { key: "issueIdOrKey", value: "TSD-131" },
        { key: "statusId", value: "2" },
        { key: "nested", value: "{\"a\":1}" }
      ]
    }
  })
})

test("permission.replied projection forwards only ids and drops malformed events", () => {
  assert.deepEqual(projectRuntimeEvent({ type: "permission.replied", properties: { sessionID: "sess_one", requestID: "p1" } }), {
    type: "permission.replied", sessionID: "sess_one", requestID: "p1"
  })
  assert.equal(projectRuntimeEvent({ type: "permission.asked", properties: { sessionID: "sess_one" } }), null)
  assert.equal(projectRuntimeEvent({ type: "question.asked", properties: { requestID: "q1" } }), null)
})

test("prompt parts route an office attachment as a local path instead of a model file part", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-prompt-office-"))
  const input = path.join(temp, "事業.xlsx")
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from("<Types/>"))
  zip.addFile("xl/workbook.xml", Buffer.from("<workbook><sheets><sheet name=\"QA\" sheetId=\"1\"/></sheets></workbook>"))
  zip.addFile("xl/sharedStrings.xml", Buffer.from("<sst><si><t>確認事項</t></si></sst>"))
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from("<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c></row></sheetData></worksheet>"))
  zip.writeZip(input)

  const parts = buildPromptParts({
    prompt: "Hãy dịch file này sang tiếng Việt",
    attachments: [{
      url: pathToFileURL(input).href,
      filename: "事業.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }]
  })

  assert.equal(parts.some((part) => part.type === "file"), false)
  assert.equal(parts.length, 1)
  assert.equal(parts[0].type, "text")
  assert.match(parts[0].text, /Hãy dịch file này sang tiếng Việt/)
  assert.match(parts[0].text, /gateway accepts text\/images, not raw document binaries/)
  assert.match(parts[0].text, /call the translate_document tool with the exact local inputPath/)
  assert.match(parts[0].text, /Do not claim an output path unless it is returned in translate_document metadata\.artifacts/)
  assert.match(parts[0].text, /Attached files \(local paths\):/)
  assert.match(parts[0].text, new RegExp(`- ${input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  assert.match(parts[0].text, /## XLSX attachment: 事業\.xlsx/)
  assert.match(parts[0].text, /Sheet: QA/)
  assert.match(parts[0].text, /確認事項/)
})

test("prompt parts route a markdown attachment as a local path instead of a model file part", () => {
  const parts = buildPromptParts({
    prompt: "Dịch file này sang tiếng Việt",
    attachments: [{
      url: "file:///tmp/template.md",
      filename: "template.md",
      mime: "text/markdown"
    }]
  })

  assert.equal(parts.some((part) => part.type === "file"), false)
  assert.equal(parts.length, 1)
  assert.equal(parts[0].type, "text")
  assert.match(parts[0].text, /Dịch file này sang tiếng Việt/)
  assert.match(parts[0].text, /DOCX, Markdown, PDF, PPTX, or XLSX/)
  assert.match(parts[0].text, /- \/tmp\/template\.md/)
})

test("prompt parts downgrade application/octet-stream attachments to local path text", () => {
  const parts = buildPromptParts({
    prompt: "Read this file",
    attachments: [{
      url: "file:///tmp/app/api/api_v1/endpoints/health_check.py",
      filename: "health_check.py",
      mime: "application/octet-stream"
    }]
  })

  assert.equal(parts.some((part) => part.type === "file"), false)
  assert.equal(parts.length, 1)
  assert.equal(parts[0].type, "text")
  assert.match(parts[0].text, /Read this file/)
  assert.match(parts[0].text, /cannot be sent to the model as a binary file part/)
  assert.match(parts[0].text, /\/tmp\/app\/api\/api_v1\/endpoints\/health_check\.py/)
})

test("prompt parts keep pdf and image attachments as model file parts", () => {
  const parts = buildPromptParts({
    prompt: "Summarize",
    attachments: [
      { url: "file:///tmp/report.pdf", filename: "report.pdf", mime: "application/pdf" },
      { url: "file:///tmp/diagram.png", filename: "diagram.png", mime: "image/png" }
    ]
  })

  assert.deepEqual(parts, [
    { type: "file", url: "file:///tmp/report.pdf", filename: "report.pdf", mime: "application/pdf" },
    { type: "file", url: "file:///tmp/diagram.png", filename: "diagram.png", mime: "image/png" },
    { type: "text", text: "Summarize" }
  ])
})

test("prompt parts split a mixed pdf and office attachment set", () => {
  const parts = buildPromptParts({
    prompt: "Translate the deck",
    attachments: [
      { url: "file:///tmp/report.pdf", filename: "report.pdf", mime: "application/pdf" },
      { url: "file:///tmp/deck.pptx", filename: "deck.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }
    ]
  })

  const fileParts = parts.filter((part) => part.type === "file")
  assert.deepEqual(fileParts, [
    { type: "file", url: "file:///tmp/report.pdf", filename: "report.pdf", mime: "application/pdf" }
  ])
  const textPart = parts.find((part) => part.type === "text")
  assert.match(textPart.text, /- \/tmp\/deck\.pptx/)
  assert.equal(textPart.text.includes("report.pdf"), false)
})

test("runtime binary resolves to bundled opencode dependency by default", () => {
  const previous = process.env.OPENWORKING_RUNTIME_BIN
  const previousOpencode = process.env.OPENCODE_BIN
  delete process.env.OPENWORKING_RUNTIME_BIN
  delete process.env.OPENCODE_BIN

  try {
    const runtimePlatform = process.platform === "win32" ? "windows" : process.platform
    const executable = process.platform === "win32" ? "opencode.exe" : "opencode"
    const platformRuntime = path.join(__dirname, "..", "node_modules", `opencode-${runtimePlatform}-${process.arch}`, "bin", executable)
    const wrapperRuntime = path.join(__dirname, "..", "node_modules", "opencode-ai", "bin", "opencode.exe")
    assert.equal(resolveRuntimeBin(), fs.existsSync(platformRuntime) ? platformRuntime : wrapperRuntime)
  } finally {
    if (previous === undefined) delete process.env.OPENWORKING_RUNTIME_BIN
    else process.env.OPENWORKING_RUNTIME_BIN = previous
    if (previousOpencode === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = previousOpencode
  }
})

test("runtime binary falls back to packaged platform opencode dependency", () => {
  const previous = Object.getOwnPropertyDescriptor(process, "resourcesPath")
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-packaged-runtime-"))
  const runtimePlatform = process.platform === "win32" ? "windows" : process.platform
  const executable = process.platform === "win32" ? "opencode.exe" : "opencode"
  const runtimePath = path.join(temp, "app.asar.unpacked", "node_modules", `opencode-${runtimePlatform}-fallback`, "bin", executable)
  fs.mkdirSync(path.dirname(runtimePath), { recursive: true })
  fs.writeFileSync(runtimePath, "")

  try {
    Object.defineProperty(process, "resourcesPath", { value: temp, configurable: true })
    assert.equal(resolveRuntimeBin(), runtimePath)
  } finally {
    if (previous) Object.defineProperty(process, "resourcesPath", previous)
    else delete process.resourcesPath
  }
})

test("runtime manager opens a project and exposes explicit session APIs", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-runtime-"))
  const projectPath = path.join(temp, "project")
  const secondProjectPath = path.join(temp, "second-project")
  fs.mkdirSync(projectPath)
  fs.mkdirSync(secondProjectPath)
  const configPath = path.join(temp, "opencode.json")
  fs.writeFileSync(configPath, JSON.stringify({
    provider: {
      gateway: {
        options: { baseURL: "http://127.0.0.1:49152/api/v1", apiKey: "gateway-key" },
        models: { "gpt-4o-mini": {} }
      }
    }
  }))
  const capturePath = path.join(temp, "capture.json")
  const fakeRuntimePath = path.join(temp, "fake-opencode.js")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
const fs = require("node:fs")
const http = require("node:http")
const port = Number(process.argv[process.argv.indexOf("--port") + 1])
const capturePath = ${JSON.stringify(capturePath)}
const capture = {
  cwd: process.cwd(),
  config: process.env.OPENCODE_CONFIG,
  configDir: process.env.OPENCODE_CONFIG_DIR,
  xdgConfigHome: process.env.XDG_CONFIG_HOME,
  dataHome: process.env.XDG_DATA_HOME,
  stateHome: process.env.XDG_STATE_HOME,
  cacheHome: process.env.XDG_CACHE_HOME,
  projectId: process.env.OPENWORKING_PROJECT_ID,
  projectPath: process.env.OPENWORKING_PROJECT_PATH,
  translationBaseURL: process.env.OPENWORKING_TRANSLATION_BASE_URL,
  translationApiKey: process.env.OPENWORKING_TRANSLATION_API_KEY,
  translationModel: process.env.OPENWORKING_TRANSLATION_MODEL,
  pathType: typeof process.env.PATH,
  pathValue: process.env.PATH
}
const sessions = [
  { id: "sess_existing", title: "Existing session", directory: process.cwd() },
  { id: "sess_other", title: "Other project", directory: "/tmp/other-project" }
]
function save() { fs.writeFileSync(capturePath, JSON.stringify(capture)) }
function body(req, done) {
  let raw = ""
  req.on("data", chunk => { raw += chunk })
  req.on("end", () => done(raw ? JSON.parse(raw) : {}))
}
save()
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json")
  if (req.url === "/global/health") return res.end(JSON.stringify({ ok: true }))
  if (req.url === "/command" && req.method === "GET") return res.end(JSON.stringify([
    { name: "init", description: "guided AGENTS.md setup", source: "command", template: "Create or update AGENTS.md $ARGUMENTS", hints: ["$ARGUMENTS"] },
    { name: "find-bugs", description: "Inspect code for likely defects.", source: "skill", template: "long skill template body", agent: "build", model: "gemma/model", hints: [] },
    { name: "mcp-thing", description: "from an MCP server", source: "mcp", template: "x", hints: [] }
  ]))
  if (req.url === "/session/sess_new/command" && req.method === "POST") return body(req, data => {
    capture.command = data
    save()
    res.end(JSON.stringify({ ok: true }))
  })
  if (req.url.startsWith("/session?") && req.method === "GET") {
    // OpenCode GET /session is directory-scoped via the directory query param.
    const dir = new URL(req.url, "http://x").searchParams.get("directory")
    const scoped = dir ? sessions.filter((s) => s.directory === dir) : sessions
    return res.end(JSON.stringify(scoped))
  }
  if (req.url === "/session" && req.method === "GET") return res.end(JSON.stringify(sessions))
  if (req.url === "/session" && req.method === "POST") return body(req, data => {
    capture.created = data
    sessions.unshift({ id: "sess_new", title: data.title, directory: process.cwd() })
    save()
    res.end(JSON.stringify(sessions[0]))
  })
  if (req.url.startsWith("/session/sess_new/message?")) {
    return res.end(JSON.stringify([{
      info: { id: "msg_ready", sessionID: "sess_new", role: "assistant" },
      parts: [
        { id: "part_ready", sessionID: "sess_new", messageID: "msg_ready", type: "text", text: "Ready" },
        { id: "part_file", sessionID: "sess_new", messageID: "msg_ready", type: "file", filename: "report.pdf", mime: "application/pdf", url: "file:///private/report.pdf" }
      ]
    }]))
  }
  if (req.url === "/session/sess_existing/message?limit=100") {
    return res.end(JSON.stringify([{
      info: { id: "msg_existing", sessionID: "sess_existing", role: "assistant" },
      parts: [
        { id: "part_existing", sessionID: "sess_existing", messageID: "msg_existing", type: "text", text: "Existing session message" }
      ]
    }]))
  }
  if (req.url === "/session/sess_new/prompt_async" && req.method === "POST") return body(req, data => {
    capture.prompt = data
    save()
    res.end(JSON.stringify({ ok: true }))
  })
  if (req.url === "/event") {
    res.setHeader("Content-Type", "text/event-stream")
    return res.writeHead(200)
  }
  res.writeHead(404)
  res.end()
})
server.listen(port, "127.0.0.1")
process.on("SIGTERM", () => process.exit(0))
`)
  fs.chmodSync(fakeRuntimePath, 0o755)

  const previousRuntimeBin = process.env.OPENWORKING_RUNTIME_BIN
  const previousConfigPath = process.env.OPENWORKING_OPENCODE_CONFIG_PATH
  process.env.OPENWORKING_RUNTIME_BIN = fakeRuntimePath
  process.env.OPENWORKING_OPENCODE_CONFIG_PATH = configPath

  const manager = new RuntimeProcessManager({
    userDataPath: path.join(temp, "user-data"),
    profile: { profileDir: path.join(temp, "profile"), configPath },
    emit() {}
  })
  const project = { id: "proj_local", name: "Local Project", path: projectPath }

  try {
    const snapshot = await manager.openProject({ project })
    const firstPid = snapshot.runtime.pid
    const captured = JSON.parse(fs.readFileSync(capturePath, "utf8"))

    assert.equal(snapshot.status, "running")
    assert.equal(snapshot.runtime.cwd, projectPath)
    assert.equal(snapshot.runtime.configPath, configPath)
    assert.equal(snapshot.activeSessionId, null)
    assert.equal(captured.cwd, fs.realpathSync(projectPath))
    assert.equal(captured.config, configPath)
    assert.equal(captured.configDir, path.join(temp, "profile"))
    assert.equal(captured.xdgConfigHome, path.join(temp, "profile", "xdg-config"))
    assert.equal(captured.dataHome, path.join(temp, "profile", "data"))
    assert.equal(captured.stateHome, path.join(temp, "profile", "state"))
    assert.equal(captured.cacheHome, path.join(temp, "profile", "cache"))
    assert.equal(captured.projectId, "proj_local")
    assert.equal(captured.projectPath, projectPath)
    assert.equal(captured.translationBaseURL, "http://127.0.0.1:49152/api/v1")
    assert.equal(captured.translationApiKey, "gateway-key")
    assert.equal(captured.translationModel, "gpt-4o-mini")
    assert.equal(captured.pathType, "string")
    assert.notEqual(captured.pathValue, "[object Promise]")
    assert.equal(JSON.stringify(snapshot).includes("gateway-key"), false)

    assert.equal((await manager.openProject({ project })).runtime.pid, firstPid)
    assert.deepEqual(await manager.listSessions(), [
      { id: "sess_existing", title: "Existing session", directory: fs.realpathSync(projectPath) }
    ])
    // listSessionsForDirectory passes ?directory= so the renderer can populate any project's
    // sidebar history from this one server. Each call returns only that directory's sessions.
    assert.deepEqual(await manager.listSessionsForDirectory("/tmp/other-project"), [
      { id: "sess_other", title: "Other project", directory: "/tmp/other-project" }
    ])
    assert.deepEqual(await manager.listSessionsForDirectory(fs.realpathSync(projectPath)), [
      { id: "sess_existing", title: "Existing session", directory: fs.realpathSync(projectPath) }
    ])

    assert.equal((await manager.createSession({ title: "New session" })).id, "sess_new")
    assert.deepEqual((await manager.listMessages({ sessionId: "sess_new" }))[0].parts, [
      { id: "part_ready", sessionID: "sess_new", messageID: "msg_ready", type: "text", text: "Ready" },
      { id: "part_file", sessionID: "sess_new", messageID: "msg_ready", type: "file", filename: "report.pdf", mime: "application/pdf" }
    ])
    await manager.sendPrompt({
      sessionId: "sess_new",
      prompt: "Explain the project",
      attachments: [
        { type: "file", url: "file:///tmp/report.pdf", filename: "report.pdf", mime: "application/pdf" },
        { type: "file", url: "file:///tmp/image.png", filename: "image.png", mime: "image/png" }
      ],
      agent: "plan",
      model: { providerID: "gateway", modelID: "gpt-4o-mini" }
    })
    assert.equal(manager.snapshot().activeSessionId, "sess_new")
    await manager.listMessages({ sessionId: "sess_existing" })
    assert.equal(manager.snapshot().activeSessionId, "sess_new")

    const afterPrompt = JSON.parse(fs.readFileSync(capturePath, "utf8"))
    assert.deepEqual(afterPrompt.created, { title: "New session" })
    assert.deepEqual(afterPrompt.prompt, {
      parts: [
        { type: "file", url: "file:///tmp/report.pdf", filename: "report.pdf", mime: "application/pdf" },
        { type: "file", url: "file:///tmp/image.png", filename: "image.png", mime: "image/png" },
        { type: "text", text: "Explain the project" }
      ],
      agent: "plan",
      model: { providerID: "gateway", modelID: "gpt-4o-mini" }
    })

    assert.deepEqual(await manager.listCommands(), [
      { name: "init", description: "guided AGENTS.md setup", source: "command", agent: undefined, model: undefined, hints: ["$ARGUMENTS"] },
      { name: "find-bugs", description: "Inspect code for likely defects.", source: "skill", agent: "build", model: "gemma/model", hints: [] },
      { name: "mcp-thing", description: "from an MCP server", source: "mcp", agent: undefined, model: undefined, hints: [] }
    ])
    await manager.sendCommand({
      sessionId: "sess_new",
      command: "init",
      arguments: "focus on the build steps",
      agent: "build",
      model: { providerID: "gateway", modelID: "gpt-4o-mini" }
    })
    const afterCommand = JSON.parse(fs.readFileSync(capturePath, "utf8"))
    assert.deepEqual(afterCommand.command, {
      command: "init",
      arguments: "focus on the build steps",
      agent: "build",
      model: "gateway/gpt-4o-mini"
    })

    await manager.sendCommand({
      sessionId: "sess_new",
      command: "init",
      arguments: "without an explicit model",
      agent: "build"
    })
    const afterCommandWithoutModel = JSON.parse(fs.readFileSync(capturePath, "utf8"))
    assert.deepEqual(afterCommandWithoutModel.command, {
      command: "init",
      arguments: "without an explicit model",
      agent: "build"
    })

    const switched = await manager.openProject({
      project: { id: "proj_second", name: "Second Project", path: secondProjectPath }
    })
    assert.equal(switched.status, "running")
    assert.equal(switched.runtime.cwd, secondProjectPath)
    assert.notEqual(switched.runtime.pid, firstPid)
  } finally {
    await manager.stop()
    if (previousRuntimeBin === undefined) delete process.env.OPENWORKING_RUNTIME_BIN
    else process.env.OPENWORKING_RUNTIME_BIN = previousRuntimeBin
    if (previousConfigPath === undefined) delete process.env.OPENWORKING_OPENCODE_CONFIG_PATH
    else process.env.OPENWORKING_OPENCODE_CONFIG_PATH = previousConfigPath
  }
})

test("runtime manager aborts the active session through opencode", async () => {
  const emitted = []
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/session/sess_new/abort" && req.method === "POST") {
      captured = { authorization: req.headers.authorization }
      return res.end("true")
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-abort",
    emit(channel, payload) {
      emitted.push({ channel, payload })
    }
  })
  manager.child = {}
  manager.state.status = "running"
  manager.state.activity = "running"
  manager.state.activeSessionId = "sess_new"
  manager.state.runtime = {
    serverUrl: `http://127.0.0.1:${port}`,
    auth: { username: "opencode", password: "pw" }
  }
  manager.sessionStatuses.sess_new = { type: "busy" }

  try {
    assert.equal(await manager.abortSession({ sessionId: "sess_new" }), true)
    assert.deepEqual(captured, {
      authorization: `Basic ${Buffer.from("opencode:pw").toString("base64")}`
    })
    assert.equal(manager.snapshot().activity, "idle")
    assert.deepEqual(manager.snapshot().activeSessionStatus, { type: "idle" })
    assert.ok(emitted.some((event) => (
      event.channel === "runtime:stream" &&
      event.payload.type === "session.aborted" &&
      event.payload.sessionID === "sess_new"
    )))
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("runtime manager keeps busy state when abort fails", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/session/sess_new/abort" && req.method === "POST") {
      res.writeHead(500)
      return res.end(JSON.stringify({ error: "abort failed" }))
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-abort-failed",
    emit() {}
  })
  manager.child = {}
  manager.state.status = "running"
  manager.state.activity = "running"
  manager.state.activeSessionId = "sess_new"
  manager.state.runtime = {
    serverUrl: `http://127.0.0.1:${port}`,
    auth: { username: "opencode", password: "pw" }
  }
  manager.sessionStatuses.sess_new = { type: "busy" }

  try {
    await assert.rejects(
      () => manager.abortSession({ sessionId: "sess_new" }),
      /HTTP 500/
    )
    assert.equal(manager.snapshot().activity, "running")
    assert.deepEqual(manager.snapshot().activeSessionStatus, { type: "busy" })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("runtime manager deletes a session through opencode", async () => {
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/session/sess_new" && req.method === "DELETE") {
      captured = { method: req.method, authorization: req.headers.authorization }
      return res.end("true")
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-delete",
    emit() {}
  })
  manager.child = {}
  manager.state.status = "running"
  manager.state.activeSessionId = "sess_new"
  manager.state.runtime = {
    serverUrl: `http://127.0.0.1:${port}`,
    auth: { username: "opencode", password: "pw" }
  }
  manager.sessionStatuses.sess_new = { type: "idle" }

  try {
    assert.equal(await manager.deleteSession({ sessionId: "sess_new" }), true)
    assert.deepEqual(captured, {
      method: "DELETE",
      authorization: `Basic ${Buffer.from("opencode:pw").toString("base64")}`
    })
    assert.equal(manager.snapshot().activeSessionId, null)
    assert.equal(Object.prototype.hasOwnProperty.call(manager.sessionStatuses, "sess_new"), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("runtime manager renames a session through opencode", async () => {
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/session/sess_new" && req.method === "PATCH") {
      let raw = ""
      req.on("data", (chunk) => {
        raw += chunk
      })
      req.on("end", () => {
        captured = {
          method: req.method,
          authorization: req.headers.authorization,
          body: raw ? JSON.parse(raw) : null
        }
        res.end(JSON.stringify({ id: "sess_new", title: "Renamed session" }))
      })
      return
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-rename",
    emit() {}
  })
  manager.child = {}
  manager.state.status = "running"
  manager.state.activeSessionId = "sess_new"
  manager.state.runtime = {
    serverUrl: `http://127.0.0.1:${port}`,
    auth: { username: "opencode", password: "pw" }
  }

  try {
    assert.deepEqual(await manager.renameSession({ sessionId: "sess_new", title: "  Renamed session  " }), {
      id: "sess_new",
      title: "Renamed session"
    })
    assert.deepEqual(captured, {
      method: "PATCH",
      authorization: `Basic ${Buffer.from("opencode:pw").toString("base64")}`,
      body: { title: "Renamed session" }
    })
    assert.equal(manager.snapshot().activeSessionId, "sess_new")
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("runtime manager validates session renames before sending a request", async () => {
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-rename-validate",
    emit() {}
  })
  manager.child = {}
  manager.state.status = "running"
  manager.state.runtime = {
    serverUrl: "http://127.0.0.1:1",
    auth: { username: "opencode", password: "pw" }
  }

  await assert.rejects(
    () => manager.renameSession({ sessionId: "", title: "Renamed session" }),
    /Select a session before renaming it\./
  )
  await assert.rejects(
    () => manager.renameSession({ sessionId: "sess_new", title: "   " }),
    /Session title is required\./
  )
})

test("runtime manager surfaces delete failures without clearing the active session", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/session/sess_new" && req.method === "DELETE") {
      res.writeHead(500)
      return res.end(JSON.stringify({ error: "delete failed" }))
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-delete-failed",
    emit() {}
  })
  manager.child = {}
  manager.state.status = "running"
  manager.state.activeSessionId = "sess_new"
  manager.state.runtime = {
    serverUrl: `http://127.0.0.1:${port}`,
    auth: { username: "opencode", password: "pw" }
  }

  try {
    await assert.rejects(
      () => manager.deleteSession({ sessionId: "sess_new" }),
      /HTTP 500/
    )
    assert.equal(manager.snapshot().activeSessionId, "sess_new")
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("reload respawns the running project so updated credentials take effect", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-reload-"))
  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  const configPath = path.join(temp, "opencode.json")
  const writeConfig = (apiKey) => fs.writeFileSync(configPath, JSON.stringify({
    provider: {
      gateway: {
        options: { baseURL: "http://127.0.0.1:49152/api/v1", apiKey },
        models: { "gpt-4o-mini": {} }
      }
    }
  }))
  writeConfig("old-key")
  const capturePath = path.join(temp, "capture.json")
  const fakeRuntimePath = path.join(temp, "fake-opencode.js")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
const fs = require("node:fs")
const http = require("node:http")
const port = Number(process.argv[process.argv.indexOf("--port") + 1])
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ apiKey: process.env.OPENWORKING_TRANSLATION_API_KEY }))
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json")
  if (req.url === "/global/health") return res.end(JSON.stringify({ ok: true }))
  if (req.url === "/event") { res.setHeader("Content-Type", "text/event-stream"); return res.writeHead(200) }
  res.writeHead(404)
  res.end()
})
server.listen(port, "127.0.0.1")
process.on("SIGTERM", () => process.exit(0))
`)
  fs.chmodSync(fakeRuntimePath, 0o755)

  const previousRuntimeBin = process.env.OPENWORKING_RUNTIME_BIN
  const previousConfigPath = process.env.OPENWORKING_OPENCODE_CONFIG_PATH
  process.env.OPENWORKING_RUNTIME_BIN = fakeRuntimePath
  process.env.OPENWORKING_OPENCODE_CONFIG_PATH = configPath

  const manager = new RuntimeProcessManager({
    userDataPath: path.join(temp, "user-data"),
    profile: { profileDir: path.join(temp, "profile"), configPath },
    emit() {}
  })
  const project = { id: "proj_local", name: "Local Project", path: projectPath }

  try {
    const first = await manager.openProject({ project })
    assert.equal(JSON.parse(fs.readFileSync(capturePath, "utf8")).apiKey, "old-key")

    writeConfig("new-key")
    const reloaded = await manager.reload()
    assert.equal(reloaded.status, "running")
    assert.notEqual(reloaded.runtime.pid, first.runtime.pid)
    assert.equal(JSON.parse(fs.readFileSync(capturePath, "utf8")).apiKey, "new-key")
  } finally {
    await manager.stop()
    if (previousRuntimeBin === undefined) delete process.env.OPENWORKING_RUNTIME_BIN
    else process.env.OPENWORKING_RUNTIME_BIN = previousRuntimeBin
    if (previousConfigPath === undefined) delete process.env.OPENWORKING_OPENCODE_CONFIG_PATH
    else process.env.OPENWORKING_OPENCODE_CONFIG_PATH = previousConfigPath
  }
})

test("reload is a no-op when no runtime is running", async () => {
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-reload-noop",
    emit() {}
  })
  const snapshot = await manager.reload()
  assert.equal(snapshot.status, "idle")
  assert.equal(manager.child, null)
})

test("concurrent openProject calls for the same project share the in-flight start", async () => {
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-concurrent-start",
    emit() {}
  })
  const project = { id: "proj_local", name: "Local", path: "/tmp/openworking-runtime-concurrent-start/project" }
  let calls = 0
  let resolveStart
  manager._openProject = async ({ project: requestedProject }) => {
    calls += 1
    await new Promise((resolve) => { resolveStart = resolve })
    manager.child = {}
    manager.state.status = "running"
    manager.state.project = requestedProject
    manager.state.runtime = { cwd: requestedProject.path }
    return manager.snapshot()
  }

  const first = manager.openProject({ project })
  const second = manager.openProject({ project })
  resolveStart()
  const [firstSnapshot, secondSnapshot] = await Promise.all([first, second])

  assert.equal(calls, 1)
  assert.equal(firstSnapshot.status, "running")
  assert.equal(secondSnapshot.status, "running")
})

test("concurrent openProject calls retry serially after a failed start", async () => {
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-concurrent-retry",
    emit() {}
  })
  const project = { id: "proj_local", name: "Local", path: "/tmp/openworking-runtime-concurrent-retry/project" }
  const resolvers = []
  let calls = 0
  manager._openProject = async ({ project: requestedProject }) => {
    calls += 1
    const callNumber = calls
    await new Promise((resolve) => { resolvers.push(resolve) })
    if (callNumber === 1) throw new Error("first start failed")
    manager.child = {}
    manager.state.status = "running"
    manager.state.project = requestedProject
    manager.state.runtime = { cwd: requestedProject.path }
    return manager.snapshot()
  }

  const first = manager.openProject({ project }).catch((error) => error.message)
  const second = manager.openProject({ project })
  const third = manager.openProject({ project })
  resolvers[0]()
  while (resolvers.length < 2) await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls, 2)
  resolvers[1]()
  const [firstResult, secondSnapshot, thirdSnapshot] = await Promise.all([first, second, third])

  assert.equal(firstResult, "first start failed")
  assert.equal(calls, 2)
  assert.equal(secondSnapshot.status, "running")
  assert.equal(thirdSnapshot.status, "running")
})

test("runtime startup failures include recent child stderr", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-runtime-startup-fail-"))
  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  const fakeRuntimePath = path.join(temp, "fake-opencode.js")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
console.error("fatal startup detail")
process.exit(2)
`)
  fs.chmodSync(fakeRuntimePath, 0o755)

  const previousRuntimeBin = process.env.OPENWORKING_RUNTIME_BIN
  process.env.OPENWORKING_RUNTIME_BIN = fakeRuntimePath
  const manager = new RuntimeProcessManager({
    userDataPath: path.join(temp, "user-data"),
    profile: { profileDir: path.join(temp, "profile"), configPath: path.join(temp, "profile", "opencode.json") },
    emit() {}
  })

  try {
    await assert.rejects(
      manager.openProject({ project: { id: "proj_local", name: "Local", path: projectPath } }),
      /fatal startup detail/
    )
    assert.match(manager.snapshot().lastError, /fatal startup detail/)
  } finally {
    if (previousRuntimeBin === undefined) delete process.env.OPENWORKING_RUNTIME_BIN
    else process.env.OPENWORKING_RUNTIME_BIN = previousRuntimeBin
  }
})

test("runtime manager projects stream events independently from the diagnostic timeline", () => {
  const emitted = []
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-stream",
    emit(channel, payload) {
      emitted.push({ channel, payload })
    }
  })
  manager.state.activeSessionId = "sess_active"

  manager.handleRuntimeEvent({
    type: "session.status",
    properties: { sessionID: "sess_active", status: { type: "busy" } }
  })
  manager.handleRuntimeEvent({
    type: "message.part.updated",
    properties: {
      sessionID: "sess_active",
      part: {
        id: "part_tool",
        sessionID: "sess_active",
        messageID: "msg_assistant",
        type: "tool",
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: "src/index.js" },
          title: "Read src/index.js",
          output: "do not forward this output"
        }
      }
    }
  })
  manager.handleRuntimeEvent({
    type: "message.part.updated",
    properties: {
      sessionID: "sess_active",
      part: {
        id: "part_file",
        sessionID: "sess_active",
        messageID: "msg_assistant",
        type: "file",
        filename: "report.pdf",
        mime: "application/pdf",
        url: "file:///private/report.pdf"
      }
    }
  })
  for (let index = 0; index < 301; index += 1) {
    manager.handleRuntimeEvent({
      type: "message.part.delta",
      properties: {
        sessionID: "sess_active",
        messageID: "msg_assistant",
        partID: "part_text",
        field: "text",
        delta: String(index)
      }
    })
  }

  const stream = emitted.filter((event) => event.channel === "runtime:stream").map((event) => event.payload)
  assert.deepEqual(manager.snapshot().activeSessionStatus, { type: "busy" })
  assert.equal(manager.snapshot().activity, "running")
  assert.equal(manager.snapshot().timeline.length, 300)
  assert.ok(manager.snapshot().logs.some((entry) => entry.message === "[Tool] Tool read completed successfully."))
  assert.deepEqual(stream[1], {
    type: "message.part.updated",
    sessionID: "sess_active",
    part: {
      id: "part_tool",
      sessionID: "sess_active",
      messageID: "msg_assistant",
      type: "tool",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "src/index.js" },
        title: "Read src/index.js",
        error: undefined
      }
    }
  })
  assert.deepEqual(stream[2], {
    type: "message.part.updated",
    sessionID: "sess_active",
    part: {
      id: "part_file",
      sessionID: "sess_active",
      messageID: "msg_assistant",
      type: "file",
      filename: "report.pdf",
      mime: "application/pdf"
    }
  })
  assert.equal(stream.at(-1).delta, "300")

  manager.handleRuntimeEvent({
    type: "session.status",
    properties: { sessionID: "sess_active", status: { type: "retry", attempt: 2, message: "Rate limited" } }
  })
  assert.equal(manager.snapshot().activeSessionStatus.type, "retry")
  assert.equal(manager.snapshot().activity, "running")

  manager.handleRuntimeEvent({ type: "session.idle", properties: { sessionID: "sess_active" } })
  assert.deepEqual(manager.snapshot().activeSessionStatus, { type: "idle" })

  manager.handleRuntimeEvent({
    type: "session.error",
    properties: { sessionID: "sess_active", error: { data: { message: "Provider failed" } } }
  })
  assert.equal(manager.snapshot().lastError, "Provider failed")

  manager.sessionStatuses.sess_background = { type: "busy" }
  manager.handleRuntimeEvent({
    type: "session.error",
    properties: { sessionID: "sess_background", error: { data: { message: "Background failed" } } }
  })
  assert.deepEqual(manager.sessionStatuses.sess_background, { type: "idle" })
  assert.equal(manager.snapshot().lastError, "Provider failed")
})

test("runtime manager snapshot exposes a per-session status map for sidebar badges", () => {
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-session-statuses",
    emit() {}
  })
  manager.state.activeSessionId = "sess_active"

  // Two sessions running concurrently: the one on screen and a backgrounded one.
  manager.handleRuntimeEvent({
    type: "session.status",
    properties: { sessionID: "sess_active", status: { type: "busy" } }
  })
  manager.handleRuntimeEvent({
    type: "session.status",
    properties: { sessionID: "sess_background", status: { type: "busy" } }
  })

  const snapshot = manager.snapshot()
  // Both sessions surface as busy so the renderer can badge each one independently.
  assert.deepEqual(snapshot.sessionStatuses, {
    sess_active: { type: "busy" },
    sess_background: { type: "busy" }
  })
  // Mutating the snapshot must not leak back into the manager's internal map.
  snapshot.sessionStatuses.sess_active = { type: "idle" }
  assert.deepEqual(manager.sessionStatuses.sess_active, { type: "busy" })

  // The backgrounded session going idle is reflected without touching the active one.
  manager.handleRuntimeEvent({ type: "session.idle", properties: { sessionID: "sess_background" } })
  assert.deepEqual(manager.snapshot().sessionStatuses, {
    sess_active: { type: "busy" },
    sess_background: { type: "idle" }
  })
})

test("runtime manager reconnects the event stream until it is stopped", async () => {
  const previousFetch = global.fetch
  let requests = 0
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-reconnect",
    emit() {}
  })
  manager.child = {}
  manager.state.status = "running"
  global.fetch = async () => {
    requests += 1
    return {
      ok: true,
      body: {
        getReader() {
          return { read: async () => ({ done: true }) }
        }
      }
    }
  }

  try {
    manager.startEventStream("http://127.0.0.1:1", "auth")
    await new Promise((resolve) => setTimeout(resolve, 450))
    assert.ok(requests >= 2)

    manager.stopEventStream()
    const stoppedAt = requests
    await new Promise((resolve) => setTimeout(resolve, 450))
    assert.equal(requests, stoppedAt)
  } finally {
    manager.stopEventStream()
    manager.child = null
    global.fetch = previousFetch
  }
})

// The opencode HTTP API dropped the `/request/` path segment from the session-scoped
// reply/reject endpoints in 1.17.x. These tests pin the exact URL + body the manager
// sends so a future runtime bump that moves them is caught before it breaks the
// in-chat approve/reject and question flows.
function readyManager(serverUrl) {
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-hitl",
    emit() {}
  })
  manager.child = {}
  manager.state.status = "running"
  manager.state.activeSessionId = "sess_new"
  manager.state.runtime = {
    serverUrl,
    auth: { username: "opencode", password: "pw" }
  }
  return manager
}

test("reads wait for an in-flight restart instead of throwing 'Runtime is not running'", async () => {
  let served = 0
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "GET" && req.url.startsWith("/session/sess_x/message")) {
      served += 1
      return res.end(JSON.stringify([]))
    }
    res.writeHead(404); res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  // Simulate the stop→spawn window: not yet running, with a lifecycle op that will flip to running.
  manager.state.status = "starting"
  manager.child = null
  let resolveLifecycle
  manager.lifecycle = new Promise((resolve) => { resolveLifecycle = resolve })
  try {
    const pending = manager.listMessages({ sessionId: "sess_x" }) // issued mid-restart
    // Hasn't thrown; it's waiting. Now finish the "restart".
    manager.state.status = "running"
    manager.child = {}
    resolveLifecycle()
    await pending // resolves instead of throwing
    assert.equal(served, 1)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("listMessages forwards a directory query so a cross-project chat can be viewed without a restart", async () => {
  let capturedUrl = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "GET" && req.url.startsWith("/session/sess_x/message")) {
      capturedUrl = req.url
      return res.end(JSON.stringify([]))
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    await manager.listMessages({ sessionId: "sess_x", directory: "/Users/me/other-project" })
    assert.match(capturedUrl, /directory=%2FUsers%2Fme%2Fother-project/)
    // Without a directory it must NOT append the param (unchanged behavior for the active project).
    await manager.listMessages({ sessionId: "sess_x" })
    assert.equal(capturedUrl.includes("directory="), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("answerQuestion posts to the non-session question reply endpoint", async () => {
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "POST" && /^\/question\/[^/]+\/reply$/.test(req.url)) {
      let raw = ""
      req.on("data", (chunk) => { raw += chunk })
      req.on("end", () => {
        captured = { url: req.url, body: raw ? JSON.parse(raw) : {} }
        res.end("true")
      })
      return
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    await manager.answerQuestion({ sessionId: "sess_new", requestID: "q1", answers: [["yes"]] })
    assert.equal(captured.url, "/question/q1/reply")
    assert.equal(captured.url.includes("/session/"), false)
    assert.deepEqual(captured.body, { answers: [["yes"]] })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("rejectQuestion posts to the non-session question reject endpoint", async () => {
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "POST" && /^\/question\/[^/]+\/reject$/.test(req.url)) {
      captured = { url: req.url }
      return res.end("true")
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    await manager.rejectQuestion({ sessionId: "sess_new", requestID: "q1" })
    assert.equal(captured.url, "/question/q1/reject")
    assert.equal(captured.url.includes("/session/"), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("listMcpStatus projects the runtime status map down to name + status", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/mcp" && req.method === "GET") {
      return res.end(JSON.stringify({
        slack: { status: "failed", error: "server unavailable", secret: "drop" },
        sentry: { status: "connected" }
      }))
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    // The real failure reason in `error` is preserved; unrelated fields (secret) are dropped.
    assert.deepEqual(await manager.listMcpStatus(), [
      { name: "slack", status: "failed", error: "server unavailable" },
      { name: "sentry", status: "connected" }
    ])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("startMcpAuth posts to the auth endpoint and returns the authorization url", async () => {
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/mcp/slack/auth" && req.method === "POST") {
      captured = { url: req.url, authorization: req.headers.authorization }
      return res.end(JSON.stringify({ authorizationUrl: "https://slack.com/oauth/authorize?x=1", oauthState: "abc" }))
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    assert.deepEqual(await manager.startMcpAuth("slack"), {
      authorizationUrl: "https://slack.com/oauth/authorize?x=1",
      oauthState: "abc"
    })
    assert.deepEqual(captured, {
      url: "/mcp/slack/auth",
      authorization: `Basic ${Buffer.from("opencode:pw").toString("base64")}`
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("authenticateMcp posts to the authenticate endpoint and resolves when the callback completes", async () => {
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/mcp/slack/auth/authenticate" && req.method === "POST") {
      captured = { url: req.url }
      return res.end(JSON.stringify({ status: "connected" }))
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    assert.deepEqual(await manager.authenticateMcp("slack"), { status: "connected" })
    assert.equal(captured.url, "/mcp/slack/auth/authenticate")
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("mcp status events project to a whitelisted name + status shape", () => {
  assert.deepEqual(projectRuntimeEvent({
    type: "mcp.status.needs_auth",
    properties: { name: "slack", secret: "drop" }
  }), { type: "mcp.status.needs_auth", name: "slack", status: "needs_auth" })

  assert.deepEqual(projectRuntimeEvent({
    type: "mcp.status.connected",
    properties: { name: "slack" }
  }), { type: "mcp.status.connected", name: "slack", status: "connected" })

  assert.deepEqual(projectRuntimeEvent({
    type: "mcp.browser.open.failed",
    properties: { mcpName: "slack", url: "https://slack.com/oauth", secret: "drop" }
  }), { type: "mcp.browser.open.failed", name: "slack", url: "https://slack.com/oauth" })

  assert.equal(projectRuntimeEvent({ type: "mcp.status.connected", properties: {} }), null)
})

test("replyPermission posts to the non-session permission reply endpoint", async () => {
  // OpenCode v1.17 serves the reply at /permission/{requestID}/reply. The old session-scoped
  // path (/session/{id}/permission/{id}/reply) does not exist and is silently swallowed by the
  // web UI fallback (HTTP 200 HTML), which left tools stuck "Processing" after approval.
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "POST" && /^\/permission\/[^/]+\/reply$/.test(req.url)) {
      let raw = ""
      req.on("data", (chunk) => { raw += chunk })
      req.on("end", () => {
        captured = { url: req.url, body: raw ? JSON.parse(raw) : {} }
        res.end("true")
      })
      return
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    await manager.replyPermission({ sessionId: "sess_new", requestID: "p1", reply: "reject", message: "no" })
    assert.equal(captured.url, "/permission/p1/reply")
    assert.equal(captured.url.includes("/session/"), false)
    assert.deepEqual(captured.body, { reply: "reject", message: "no" })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
