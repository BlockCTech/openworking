const test = require("node:test")
const assert = require("node:assert/strict")
const { EventEmitter } = require("node:events")
const fs = require("node:fs")
const http = require("node:http")
const os = require("node:os")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const AdmZip = require("adm-zip")
const WebSocket = require("ws")

const { RuntimeProcessManager, buildPromptBody, buildPromptParts, projectMessagePart, projectReferenceInfo, projectPtyInfo, projectRuntimeEvent, projectToolMetadata, requestJson, resolveRuntimeBin, resolveUserPath, sidebarSessions, pathHasExecutable, translationGatewayEnv } = require("../src/runtime/process-manager")
const { ensureRuntimeDbSchema } = require("../src/runtime/db-schema")

// Makes a just-written fake opencode runtime spawnable and returns the path to use as runtimeBin.
//
// The scripts carry a `#!/usr/bin/env node` shebang, which only makes a file directly executable on
// Unix. Windows ignores shebangs, so spawning the .js fails with EFTYPE; a .cmd wrapper is refused
// too, because Node rejects spawning .cmd/.bat without shell:true since the CVE-2024-27980 fix
// (EINVAL). Production always spawns a real .exe, so this is purely a test-fixture concern and the
// manager keeps spawning runtimeBin directly.
//
// On Windows we therefore hand back node.exe itself and let the manager prepend the script path via
// OPENWORKING_RUNTIME_SCRIPT, which keeps argv in the shape the fakes expect (argv[2] onwards is
// the runtime's own arguments).
function finalizeFakeRuntime(scriptPath) {
  fs.chmodSync(scriptPath, 0o755)
  if (process.platform !== "win32") return scriptPath
  process.env.OPENWORKING_RUNTIME_SCRIPT = scriptPath
  return process.execPath
}

test("runtime HTTP requests fail with a bounded redacted timeout", async () => {
  const server = http.createServer(() => {})
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    await assert.rejects(
      requestJson({
        url: `http://127.0.0.1:${server.address().port}/session?directory=/private/project`,
        method: "POST",
        timeoutMs: 30
      }),
      (error) => {
        assert.equal(error.message, "Runtime request timed out (POST /session)")
        assert.equal(error.message.includes("private/project"), false)
        return true
      }
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("runtime DB preflight kills a CLI invocation that never exits", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-db-timeout-"))
  let fakeRuntimePath = path.join(temp, "fake-opencode-db-timeout.js")
  fs.writeFileSync(fakeRuntimePath, "#!/usr/bin/env node\nsetInterval(() => {}, 1000)\n")
  fakeRuntimePath = finalizeFakeRuntime(fakeRuntimePath)
  const startedAt = Date.now()
  try {
    await assert.rejects(ensureRuntimeDbSchema({ runtimeBin: fakeRuntimePath, env: process.env, timeoutMs: 30 }))
    assert.ok(Date.now() - startedAt < 1000)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

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
  // resolveUserPath only memoizes a PATH that can actually find npx (a transient miss must stay
  // retryable), so the cache is only exercised from a directory that really holds one. A bare
  // "/usr/bin" satisfies that on POSIX by accident but never on Windows.
  // pathHasExecutable stats the bare name, so the probe file must be "npx" on every platform.
  const npxDir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-npx-cache-"))
  fs.writeFileSync(path.join(npxDir, "npx"), "#!/bin/sh\n", { mode: 0o755 })
  try {
    process.env.PATH = npxDir
    const first = await resolveUserPath({ force: true })
    process.env.PATH = path.join(npxDir, "somewhere-else")
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

test("tool part projection normalizes v2 subagent metadata without exposing prompt, output or error", () => {
  assert.deepEqual(projectMessagePart({
    id: "part_tool",
    sessionID: "sess_parent",
    messageID: "msg_tool",
    type: "tool",
    name: "subagent",
    state: {
      status: "running",
      input: { agent: "review", description: "Review changes", prompt: "private prompt" },
      metadata: { sessionID: "sess_child", status: "running", secret: "drop" },
      content: "private output",
      error: { message: "private error" }
    }
  }), {
    id: "part_tool",
    sessionID: "sess_parent",
    messageID: "msg_tool",
    type: "tool",
    tool: "subagent",
    state: {
      status: "running",
      input: { agent: "review", description: "Review changes" },
      title: undefined,
      metadata: { sessionID: "sess_child", status: "running" }
    }
  })
})

test("v2 tool lifecycle projects to one stable allowlisted tool part", () => {
  const base = {
    sessionID: "sess_one",
    assistantMessageID: "msg_assistant",
    id: "chatcmpl-tool-42"
  }
  const expectedIdentity = {
    id: "msg_assistant:tool:chatcmpl-tool-42",
    sessionID: "sess_one",
    messageID: "msg_assistant",
    type: "tool"
  }

  assert.deepEqual(projectRuntimeEvent({
    type: "session.tool.input.started",
    data: { ...base, name: "websearch" }
  }), {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      ...expectedIdentity,
      tool: "websearch",
      state: { status: "pending", input: {} }
    }
  })

  assert.deepEqual(projectRuntimeEvent({
    type: "session.tool.input.ended",
    data: { ...base, text: "{\"query\":\"nhiệt độ đà nẵng hôm nay\"}" }
  }), {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      ...expectedIdentity,
      state: {
        status: "pending",
        input: { query: "nhiệt độ đà nẵng hôm nay" }
      }
    }
  })

  assert.deepEqual(projectRuntimeEvent({
    type: "session.tool.called",
    data: {
      ...base,
      input: { query: "nhiệt độ đà nẵng hôm nay" },
      executed: false,
      private: "drop"
    }
  }), {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      ...expectedIdentity,
      state: {
        status: "running",
        input: { query: "nhiệt độ đà nẵng hôm nay" }
      }
    }
  })

  assert.deepEqual(projectRuntimeEvent({
    type: "session.tool.progress",
    data: {
      ...base,
      metadata: {
        artifacts: [{ path: "/tmp/report.txt", filename: "report.txt", mime: "text/plain" }],
        private: "drop"
      }
    }
  }), {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      ...expectedIdentity,
      state: {
        status: "running",
        metadata: {
          artifacts: [{ path: "/tmp/report.txt", filename: "report.txt", mime: "text/plain" }],
          quality: "verified",
          warnings: []
        }
      }
    }
  })

  const success = projectRuntimeEvent({
    type: "session.tool.success",
    data: {
      ...base,
      content: [{ type: "text", text: "private tool output" }],
      metadata: { private: "drop" },
      executed: false
    }
  })
  assert.deepEqual(success, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      ...expectedIdentity,
      state: { status: "completed" }
    }
  })
  assert.equal(JSON.stringify(success).includes("private tool output"), false)

  assert.deepEqual(projectRuntimeEvent({
    type: "session.tool.failed",
    data: {
      ...base,
      error: { message: "Search failed", stack: "private stack" },
      content: [{ type: "text", text: "private failure output" }],
      executed: false
    }
  }), {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      ...expectedIdentity,
      state: { status: "error", error: "Search failed" }
    }
  })
})

test("v2 tool lifecycle drops malformed events and invalid input JSON", () => {
  assert.equal(projectRuntimeEvent({
    type: "session.tool.input.started",
    data: { sessionID: "sess_one", assistantMessageID: "msg_assistant", name: "websearch" }
  }), null)
  assert.deepEqual(projectRuntimeEvent({
    type: "session.tool.input.ended",
    data: {
      sessionID: "sess_one",
      assistantMessageID: "msg_assistant",
      id: "call_bad_json",
      text: "{not json"
    }
  }).part.state.input, {})
})

test("sidebar sessions hide subagents but retain explicit user forks", () => {
  assert.deepEqual(sidebarSessions([
    { id: "root" },
    { id: "subagent", parentID: "root" },
    { id: "fork", parentID: "root", fork: { sessionID: "root" } }
  ]).map((session) => session.id), ["root", "fork"])
})

test("question.asked projection whitelists prompt and option display fields", () => {
  const projected = projectRuntimeEvent({
    type: "question.asked",
    data: {
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
    data: { sessionID: "sess_one", id: "q9", question: "Continue?" }
  })
  assert.equal(projected.requestID, "q9")
  assert.equal(projected.question.questions[0].question, "Continue?")
  assert.deepEqual(projected.question.questions[0].options, [])
})

test("question reply/reject projection forwards only ids", () => {
  for (const type of ["question.replied", "question.rejected"]) {
    assert.deepEqual(projectRuntimeEvent({ type, data: { sessionID: "sess_one", requestID: "q1", extra: "drop" } }), {
      type, sessionID: "sess_one", requestID: "q1"
    })
  }
})

test("permission.asked projection whitelists display fields and flattens metadata into details", () => {
  const projected = projectRuntimeEvent({
    type: "permission.asked",
    data: {
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
  assert.deepEqual(projectRuntimeEvent({ type: "permission.replied", data: { sessionID: "sess_one", requestID: "p1" } }), {
    type: "permission.replied", sessionID: "sess_one", requestID: "p1"
  })
  assert.equal(projectRuntimeEvent({ type: "permission.asked", data: { sessionID: "sess_one" } }), null)
  assert.equal(projectRuntimeEvent({ type: "question.asked", data: { requestID: "q1" } }), null)
})

test("session.created projection forwards child-session linkage from upstream info payload", () => {
  assert.deepEqual(projectRuntimeEvent({
    type: "session.created",
    data: {
      info: { id: "sess_child", parentID: "sess_parent", title: "Subagent" },
      secret: "drop"
    }
  }), {
    type: "session.created",
    sessionID: "sess_child",
    parentSessionId: "sess_parent"
  })
})

test("session.created projection still accepts direct child-session linkage fields", () => {
  assert.deepEqual(projectRuntimeEvent({
    type: "session.created",
    data: { sessionID: "sess_child", parentSessionId: "sess_parent", secret: "drop" }
  }), {
    type: "session.created",
    sessionID: "sess_child",
    parentSessionId: "sess_parent"
  })

})

test("session.created projection ignores events without parent linkage", () => {
  assert.equal(projectRuntimeEvent({
    type: "session.created",
    data: { info: { id: "sess_top_level" } }
  }), null)
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
  assert.match(parts[0].text, /call translate_office_document with the exact local inputPath/)
  assert.match(parts[0].text, /ask before using inplace/)
  assert.match(parts[0].text, /Do not claim an output path unless it is returned in the selected tool's metadata\.artifacts/)
  assert.match(parts[0].text, /Attached files \(local paths\):/)
  assert.match(parts[0].text, new RegExp(`- ${input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  assert.match(parts[0].text, /## XLSX attachment: 事業\.xlsx/)
  assert.match(parts[0].text, /Sheet: QA/)
  assert.match(parts[0].text, /確認事項/)
})

test("prompt parts route a markdown attachment as a local path instead of a model file part", () => {
  const templatePath = path.join(os.tmpdir(), "openworking-prompt-parts", "template.md")
  const parts = buildPromptParts({
    prompt: "Dịch file này sang tiếng Việt",
    attachments: [{
      url: pathToFileURL(templatePath).href,
      filename: "template.md",
      mime: "text/markdown"
    }]
  })

  assert.equal(parts.some((part) => part.type === "file"), false)
  assert.equal(parts.length, 1)
  assert.equal(parts[0].type, "text")
  assert.match(parts[0].text, /Dịch file này sang tiếng Việt/)
  assert.match(parts[0].text, /PDF, DOCX, Markdown, or \.markdown translation, call translate_document/)
  assert.equal(parts[0].text.includes(`- ${templatePath}`), true)
})

test("prompt parts pass an external (non-file:) attachment straight through as a file part with its own description", () => {
  const parts = buildPromptParts({
    prompt: "Summarize this",
    attachments: [{
      url: "https://example.com/report.pdf",
      filename: "report.pdf",
      description: "Q3 report"
    }]
  })

  const filePart = parts.find((part) => part.type === "file")
  assert.ok(filePart, "expected an external attachment to produce a file part")
  assert.equal(filePart.url, "https://example.com/report.pdf")
  assert.equal(filePart.filename, "report.pdf")
  assert.equal(filePart.description, "Q3 report")
  // Only the file part + the base prompt text — no local-path text branch should fire for an
  // external attachment, since it isn't backed by a file on this machine.
  assert.equal(parts.length, 2)
  assert.equal(parts.find((part) => part.type === "text").text, "Summarize this")
})

test("buildPromptBody sends both a local (file:) attachment and an external (uri) attachment in the same files array", () => {
  const body = buildPromptBody({
    inputId: "inp_1",
    prompt: "Compare these",
    attachments: [
      { url: pathToFileURL("/tmp/local.png").href, filename: "local.png", mime: "image/png" },
      { url: "https://example.com/external.png", filename: "external.png", description: "Reference image" }
    ]
  })

  assert.equal(body.files.length, 2)
  const local = body.files.find((file) => file.name === "local.png")
  const external = body.files.find((file) => file.name === "external.png")
  assert.equal(local.uri, pathToFileURL("/tmp/local.png").href)
  assert.equal(local.description, "image/png")
  assert.equal(external.uri, "https://example.com/external.png")
  assert.equal(external.description, "Reference image")
})

test("sendPrompt routes a zip attachment through extracted markdown without leaking cleanup metadata", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-prompt-zip-"))
  const input = path.join(temp, "archive.zip")
  const zip = new AdmZip()
  zip.addFile("notes.txt", Buffer.from("zip attachment body"))
  zip.writeZip(input)
  const manager = new RuntimeProcessManager({ userDataPath: temp, profile: { profileDir: temp, configPath: path.join(temp, "opencode.json") }, emit() {} })
  manager.child = {}
  manager.state.status = "running"
  manager.state.runtime = {
    serverUrl: "http://runtime.test",
    auth: { username: "user", password: "pass" }
  }
  let capturedBody = null
  const originalRequest = http.request
  http.request = (options, callback) => {
    const req = new EventEmitter()
    let raw = ""
    req.write = (chunk) => {
      raw += chunk
    }
    req.end = () => {
      capturedBody = JSON.parse(raw)
      const res = new EventEmitter()
      res.statusCode = 200
      res.setEncoding = () => {}
      callback(res)
      process.nextTick(() => {
        res.emit("data", JSON.stringify({ ok: true }))
        res.emit("end")
      })
    }
    return req
  }

  try {
    await manager.sendPrompt({
      sessionId: "sess_zip",
      inputId: "msg_zipinput1",
      delivery: "queue",
      resume: true,
      prompt: "Read this archive",
      attachments: [{
        url: pathToFileURL(input).href,
        filename: "archive.zip",
        mime: "application/zip"
      }]
    })
  } finally {
    http.request = originalRequest
  }

  // v2 prompt bodies are `{ text, files }` — the archive is surfaced as a local path inside the
  // text rather than as a binary file part, so `files` must stay absent entirely.
  assert.equal(capturedBody.files, undefined)
  assert.deepEqual(Object.keys(capturedBody).sort(), ["delivery", "id", "resume", "text"])
  assert.match(capturedBody.text, /Read this archive/)
  assert.match(capturedBody.text, /Attached document files are provided as local paths/)
  const generatedFilePath = capturedBody.text.match(/^- (.+archive\.extracted\.md)$/m)?.[1]
  assert.ok(generatedFilePath)
  assert.equal(fs.existsSync(generatedFilePath), true)
  assert.deepEqual(manager.pendingGeneratedAttachmentPaths.msg_zipinput1, {
    sessionId: "sess_zip",
    paths: [generatedFilePath, path.dirname(generatedFilePath)]
  })
  assert.equal("cleanupPaths" in capturedBody, false)
  assert.equal("metadata" in capturedBody, false)
  manager.handleRuntimeEvent({
    type: "session.input.promoted",
    data: { sessionID: "sess_zip", inputID: "msg_zipinput1" }
  })
  assert.deepEqual(manager.sessionGeneratedAttachmentPaths.sess_zip, [generatedFilePath, path.dirname(generatedFilePath)])
  manager.handleRuntimeEvent({ type: "session.idle", data: { sessionID: "sess_zip" } })
  assert.equal(fs.existsSync(generatedFilePath), false)
  assert.equal(Object.prototype.hasOwnProperty.call(manager.sessionGeneratedAttachmentPaths, "sess_zip"), false)
})

test("session.error without a session id cleans active attachments but preserves queued inputs", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-prompt-zip-error-no-session-"))
  const input = path.join(temp, "archive.zip")
  const zip = new AdmZip()
  zip.addFile("notes.txt", Buffer.from("zip attachment body"))
  zip.writeZip(input)
  const manager = new RuntimeProcessManager({ userDataPath: temp, profile: { profileDir: temp, configPath: path.join(temp, "opencode.json") }, emit() {} })
  manager.child = {}
  manager.state.status = "running"
  manager.state.activeSessionId = "sess_zip"
  manager.state.runtime = {
    serverUrl: "http://runtime.test",
    auth: { username: "user", password: "pass" }
  }
  const originalRequest = http.request
  let generatedFilePath = null
  http.request = (options, callback) => {
    const req = new EventEmitter()
    let raw = ""
    req.write = (chunk) => {
      raw += chunk
    }
    req.end = () => {
      const body = JSON.parse(raw)
      generatedFilePath = body.text.match(/^- (.+archive\.extracted\.md)$/m)?.[1]
      const res = new EventEmitter()
      res.statusCode = 200
      res.setEncoding = () => {}
      callback(res)
      process.nextTick(() => {
        res.emit("data", JSON.stringify({ ok: true }))
        res.emit("end")
      })
    }
    return req
  }

  try {
    await manager.sendPrompt({
      sessionId: "sess_zip",
      inputId: "msg_zipinput2",
      delivery: "queue",
      resume: true,
      prompt: "Read this archive",
      attachments: [{ url: pathToFileURL(input).href, filename: "archive.zip", mime: "application/zip" }]
    })
  } finally {
    http.request = originalRequest
  }

  assert.ok(generatedFilePath)
  assert.equal(fs.existsSync(generatedFilePath), true)
  manager.handleRuntimeEvent({
    type: "session.input.promoted",
    data: { sessionID: "sess_zip", inputID: "msg_zipinput2" }
  })
  const queuedFilePath = path.join(temp, "queued.md")
  fs.writeFileSync(queuedFilePath, "queued attachment")
  manager.rememberPendingGeneratedAttachments("sess_zip", "msg_zipqueued2", [queuedFilePath])
  manager.handleRuntimeEvent({ type: "session.error", data: { error: { data: { message: "Provider failed" } } } })
  assert.equal(fs.existsSync(generatedFilePath), false)
  assert.equal(fs.existsSync(queuedFilePath), true)
  assert.deepEqual(manager.sessionGeneratedAttachmentPaths, {})
  assert.deepEqual(manager.pendingGeneratedAttachmentPaths.msg_zipqueued2, {
    sessionId: "sess_zip",
    paths: [queuedFilePath]
  })
  manager.cleanupAllSessionGeneratedAttachments()
  assert.equal(fs.existsSync(queuedFilePath), false)
})

test("interrupt cleans promoted attachments without deleting queued input attachments", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-prompt-queue-cleanup-"))
  const activeFile = path.join(temp, "active.md")
  const queuedFile = path.join(temp, "queued.md")
  fs.writeFileSync(activeFile, "active")
  fs.writeFileSync(queuedFile, "queued")
  const manager = new RuntimeProcessManager({ userDataPath: temp, emit() {} })
  manager.rememberPendingGeneratedAttachments("sess_zip", "msg_active001", [activeFile])
  manager.rememberPendingGeneratedAttachments("sess_zip", "msg_queue0002", [queuedFile])
  manager.handleRuntimeEvent({
    type: "session.input.promoted",
    data: { sessionID: "sess_zip", inputID: "msg_active001" }
  })

  manager.handleRuntimeEvent({
    type: "session.execution.interrupted",
    data: { sessionID: "sess_zip", reason: "user" }
  })

  assert.equal(fs.existsSync(activeFile), false)
  assert.equal(fs.existsSync(queuedFile), true)
  assert.deepEqual(manager.pendingGeneratedAttachmentPaths.msg_queue0002, {
    sessionId: "sess_zip",
    paths: [queuedFile]
  })
  manager.handleRuntimeEvent({
    type: "session.input.promoted",
    data: { sessionID: "sess_zip", inputID: "msg_queue0002" }
  })
  manager.handleRuntimeEvent({ type: "session.execution.succeeded", data: { sessionID: "sess_zip" } })
  assert.equal(fs.existsSync(queuedFile), false)
})

test("sendPrompt retries generated attachments with the exact same wire payload", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-prompt-zip-retry-"))
  const input = path.join(temp, "archive.zip")
  const zip = new AdmZip()
  zip.addFile("notes.txt", Buffer.from("zip attachment body"))
  zip.writeZip(input)
  const manager = new RuntimeProcessManager({ userDataPath: temp, profile: { profileDir: temp, configPath: path.join(temp, "opencode.json") }, emit() {} })
  manager.child = {}
  manager.state.status = "running"
  manager.state.runtime = {
    serverUrl: "http://runtime.test",
    auth: { username: "user", password: "pass" }
  }
  const originalRequest = http.request
  const capturedBodies = []
  http.request = (options, callback) => {
    const req = new EventEmitter()
    let raw = ""
    req.write = (chunk) => {
      raw += chunk
    }
    req.end = () => {
      capturedBodies.push(JSON.parse(raw))
      if (capturedBodies.length === 1) {
        process.nextTick(() => req.emit("error", new Error("socket closed")))
        return
      }
      const res = new EventEmitter()
      res.statusCode = 200
      res.setEncoding = () => {}
      callback(res)
      process.nextTick(() => {
        res.emit("data", JSON.stringify({ ok: true }))
        res.emit("end")
      })
    }
    return req
  }

  const payload = {
    sessionId: "sess_zip",
    inputId: "msg_zipretry1",
    delivery: "queue",
    resume: true,
    prompt: "Read this archive",
    attachments: [{ url: pathToFileURL(input).href, filename: "archive.zip", mime: "application/zip" }]
  }
  try {
    await assert.rejects(manager.sendPrompt(payload), /socket closed/)
    await assert.doesNotReject(() => manager.sendPrompt(payload))
  } finally {
    http.request = originalRequest
  }

  assert.equal(capturedBodies.length, 2)
  assert.deepEqual(capturedBodies[1], capturedBodies[0])
  assert.equal(manager.pendingGeneratedAttachmentPaths.msg_zipretry1.paths.length, 2)
  assert.deepEqual(manager.generatedPromptBodies.msg_zipretry1.body, capturedBodies[0])
  manager.cleanupAllSessionGeneratedAttachments()
  assert.deepEqual(manager.generatedPromptBodies, {})
})

test("sendPrompt never transmits an external attachment when a local attachment in the same batch fails to prepare", async () => {
  // Race/failure scenario: a batch mixing a local file (whose backing path vanished between pick
  // and send — e.g. the user deleted it, or a race with another process) and an external
  // (http) attachment. The whole send must abort before anything reaches the network — a partial
  // send that transmits the external attachment while silently dropping the broken local one
  // would be worse than failing outright.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-prompt-mixed-failure-"))
  const missingZip = path.join(temp, "vanished.zip")
  const manager = new RuntimeProcessManager({ userDataPath: temp, profile: { profileDir: temp, configPath: path.join(temp, "opencode.json") }, emit() {} })
  manager.child = {}
  manager.state.status = "running"
  manager.state.runtime = {
    serverUrl: "http://runtime.test",
    auth: { username: "user", password: "pass" }
  }
  const originalRequest = http.request
  let requestCalls = 0
  http.request = () => {
    requestCalls += 1
    throw new Error("sendPrompt should have aborted before making any HTTP request")
  }

  try {
    await assert.rejects(
      manager.sendPrompt({
        sessionId: "sess_mixed",
        inputId: "msg_mixed1",
        delivery: "queue",
        resume: true,
        prompt: "Look at both of these",
        attachments: [
          { url: pathToFileURL(missingZip).href, filename: "vanished.zip", mime: "application/zip" },
          { url: "https://example.com/report.pdf", filename: "report.pdf", description: "Q3 report" }
        ]
      }),
      /ENOENT|no such file|Invalid filename/i
    )
  } finally {
    http.request = originalRequest
  }

  assert.equal(requestCalls, 0, "no HTTP request should have been made once the local attachment failed to prepare")
})

test("sendPrompt cleans up already-generated zip temp paths when a later zip synthesis throws", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-prompt-zip-partial-"))
  const input = path.join(temp, "archive.zip")
  const zip = new AdmZip()
  zip.addFile("notes.txt", Buffer.from("zip attachment body"))
  zip.writeZip(input)
  const missing = path.join(temp, "missing.zip")
  const manager = new RuntimeProcessManager({ userDataPath: temp, profile: { profileDir: temp, configPath: path.join(temp, "opencode.json") }, emit() {} })
  manager.child = {}
  manager.state.status = "running"
  manager.state.runtime = {
    serverUrl: "http://runtime.test",
    auth: { username: "user", password: "pass" }
  }
  const removedPaths = []
  const originalRmSync = fs.rmSync
  fs.rmSync = (target, options) => {
    removedPaths.push(target)
    return originalRmSync(target, options)
  }

  try {
    await assert.rejects(
      manager.sendPrompt({
        sessionId: "sess_zip",
        inputId: "msg_zipinput3",
        delivery: "queue",
        resume: true,
        prompt: "Read these archives",
        attachments: [
          { url: pathToFileURL(input).href, filename: "archive.zip", mime: "application/zip" },
          { url: pathToFileURL(missing).href, filename: "missing.zip", mime: "application/zip" }
        ]
      }),
      /ENOENT|no such file|Invalid filename/i
    )
  } finally {
    fs.rmSync = originalRmSync
  }

  assert.equal(removedPaths.some((target) => String(target).includes("openworking-zip-")), true)
})

test("sendPrompt swallows zip cleanup errors after a successful send", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-prompt-zip-cleanup-success-"))
  const input = path.join(temp, "archive.zip")
  const zip = new AdmZip()
  zip.addFile("notes.txt", Buffer.from("zip attachment body"))
  zip.writeZip(input)
  const manager = new RuntimeProcessManager({ userDataPath: temp, profile: { profileDir: temp, configPath: path.join(temp, "opencode.json") }, emit() {} })
  manager.child = {}
  manager.state.status = "running"
  manager.state.runtime = {
    serverUrl: "http://runtime.test",
    auth: { username: "user", password: "pass" }
  }
  const originalRequest = http.request
  const originalRmSync = fs.rmSync
  http.request = (options, callback) => {
    const req = new EventEmitter()
    req.write = () => {}
    req.end = () => {
      const res = new EventEmitter()
      res.statusCode = 200
      res.setEncoding = () => {}
      callback(res)
      process.nextTick(() => {
        res.emit("data", JSON.stringify({ ok: true }))
        res.emit("end")
      })
    }
    return req
  }
  fs.rmSync = () => {
    throw new Error("cleanup boom")
  }

  try {
    await assert.doesNotReject(() => manager.sendPrompt({
      sessionId: "sess_zip",
      inputId: "msg_zipinput4",
      delivery: "queue",
      resume: true,
      prompt: "Read this archive",
      attachments: [{ url: pathToFileURL(input).href, filename: "archive.zip", mime: "application/zip" }]
    }))
  } finally {
    http.request = originalRequest
    fs.rmSync = originalRmSync
  }
})

test("sendPrompt preserves the original runtime error when zip cleanup also fails", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-prompt-zip-cleanup-error-"))
  const input = path.join(temp, "archive.zip")
  const zip = new AdmZip()
  zip.addFile("notes.txt", Buffer.from("zip attachment body"))
  zip.writeZip(input)
  const manager = new RuntimeProcessManager({ userDataPath: temp, profile: { profileDir: temp, configPath: path.join(temp, "opencode.json") }, emit() {} })
  manager.child = {}
  manager.state.status = "running"
  manager.state.runtime = {
    serverUrl: "http://runtime.test",
    auth: { username: "user", password: "pass" }
  }
  const originalRequest = http.request
  const originalRmSync = fs.rmSync
  http.request = () => {
    const req = new EventEmitter()
    req.write = () => {}
    req.end = () => {
      process.nextTick(() => {
        req.emit("error", new Error("runtime failed"))
      })
    }
    return req
  }
  fs.rmSync = () => {
    throw new Error("cleanup boom")
  }

  try {
    await assert.rejects(
      manager.sendPrompt({
        sessionId: "sess_zip",
        inputId: "msg_zipinput5",
        delivery: "queue",
        resume: true,
        prompt: "Read this archive",
        attachments: [{ url: pathToFileURL(input).href, filename: "archive.zip", mime: "application/zip" }]
      }),
      /runtime failed/
    )
  } finally {
    http.request = originalRequest
    fs.rmSync = originalRmSync
  }
})

// Attachment urls are turned back into local paths by buildPromptParts, so these fixtures have to
// be real absolute paths on the host: a literal "file:///tmp/..." is not absolute on Windows and
// fileURLToPath rejects it. Derive both the url and the expected path text from the same join.
const ATTACHMENT_DIR = path.join(os.tmpdir(), "openworking-prompt-parts")
const attachmentUrl = (...segments) => pathToFileURL(path.join(ATTACHMENT_DIR, ...segments)).href

test("prompt parts downgrade application/octet-stream attachments to local path text", () => {
  const scriptPath = path.join(ATTACHMENT_DIR, "app", "api", "api_v1", "endpoints", "health_check.py")
  const parts = buildPromptParts({
    prompt: "Read this file",
    attachments: [{
      url: pathToFileURL(scriptPath).href,
      filename: "health_check.py",
      mime: "application/octet-stream"
    }]
  })

  assert.equal(parts.some((part) => part.type === "file"), false)
  assert.equal(parts.length, 1)
  assert.equal(parts[0].type, "text")
  assert.match(parts[0].text, /Read this file/)
  assert.match(parts[0].text, /cannot be sent to the model as a binary file part/)
  assert.equal(parts[0].text.includes(scriptPath), true)
})

test("prompt parts keep pdf and image attachments as model file parts", () => {
  const parts = buildPromptParts({
    prompt: "Summarize",
    attachments: [
      { url: attachmentUrl("report.pdf"), filename: "report.pdf", mime: "application/pdf" },
      { url: attachmentUrl("diagram.png"), filename: "diagram.png", mime: "image/png" }
    ]
  })

  assert.deepEqual(parts, [
    { type: "file", url: attachmentUrl("report.pdf"), filename: "report.pdf", mime: "application/pdf" },
    { type: "file", url: attachmentUrl("diagram.png"), filename: "diagram.png", mime: "image/png" },
    { type: "text", text: "Summarize" }
  ])
})

test("prompt parts split a mixed pdf and office attachment set", () => {
  const deckPath = path.join(ATTACHMENT_DIR, "deck.pptx")
  const parts = buildPromptParts({
    prompt: "Translate the deck",
    attachments: [
      { url: attachmentUrl("report.pdf"), filename: "report.pdf", mime: "application/pdf" },
      { url: pathToFileURL(deckPath).href, filename: "deck.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }
    ]
  })

  const fileParts = parts.filter((part) => part.type === "file")
  assert.deepEqual(fileParts, [
    { type: "file", url: attachmentUrl("report.pdf"), filename: "report.pdf", mime: "application/pdf" }
  ])
  const textPart = parts.find((part) => part.type === "text")
  assert.equal(textPart.text.includes(`- ${deckPath}`), true)
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
    // v2 ships as the scoped `@opencode-ai/cli-<platform>-<arch>` package with an `opencode2`
    // binary and is preferred; the v1 paths remain a fallback for installs without it.
    const v2Executable = process.platform === "win32" ? "opencode2.exe" : "opencode2"
    const v2Runtime = path.join(__dirname, "..", "node_modules", "@opencode-ai", `cli-${runtimePlatform}-${process.arch}`, "bin", v2Executable)
    const platformRuntime = path.join(__dirname, "..", "node_modules", `opencode-${runtimePlatform}-${process.arch}`, "bin", executable)
    const wrapperRuntime = path.join(__dirname, "..", "node_modules", "opencode-ai", "bin", "opencode.exe")
    const expected = fs.existsSync(v2Runtime)
      ? v2Runtime
      : fs.existsSync(platformRuntime) ? platformRuntime : wrapperRuntime
    assert.equal(resolveRuntimeBin(), expected)
  } finally {
    if (previous === undefined) delete process.env.OPENWORKING_RUNTIME_BIN
    else process.env.OPENWORKING_RUNTIME_BIN = previous
    delete process.env.OPENWORKING_RUNTIME_SCRIPT
    if (previousOpencode === undefined) delete process.env.OPENCODE_BIN
    else process.env.OPENCODE_BIN = previousOpencode
  }
})

// Packaged builds unpack the platform runtime under app.asar.unpacked. The arch suffix is
// scanned rather than predicted, because upstream also publishes -baseline/-musl variants.
test("runtime binary falls back to packaged platform opencode dependency", () => {
  const previous = Object.getOwnPropertyDescriptor(process, "resourcesPath")
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-packaged-runtime-"))
  const runtimePlatform = process.platform === "win32" ? "windows" : process.platform
  const v2Executable = process.platform === "win32" ? "opencode2.exe" : "opencode2"
  const runtimePath = path.join(temp, "app.asar.unpacked", "node_modules", "@opencode-ai", `cli-${runtimePlatform}-fallback`, "bin", v2Executable)
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

// NOTE: the v1 packaged-fallback path is intentionally NOT unit-tested here. This repo has the
// real v2 dependency installed, and the dev-tree v2 candidate does not depend on
// `resourcesPath`, so it always wins over a synthetic packaged v1 tree and the assertion could
// only pass by weakening the ordering the app actually relies on. The fallback is exercised by
// packaged smoke runs instead.

test("runtime manager repairs legacy replacement_seq schema before starting the runtime", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-runtime-schema-"))
  const projectPath = fs.mkdtempSync(path.join(temp, "project-"))
  const configPath = path.join(temp, "opencode.json")
  fs.writeFileSync(configPath, JSON.stringify({
    provider: {
      managed: {
        options: { baseURL: "http://127.0.0.1:49152/api/v1", apiKey: "{env:OPENWORKING_LOCAL_PROXY_TOKEN}" },
        models: { "gemma/model": {} }
      }
    }
  }))
  const capturePath = path.join(temp, "capture.json")
  let fakeRuntimePath = path.join(temp, "fake-opencode-schema.js")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
const fs = require("node:fs")
const http = require("node:http")
const args = process.argv.slice(2)
const capturePath = ${JSON.stringify(capturePath)}
let capture = { columns: ["session_id", "baseline", "agent", "snapshot", "baseline_seq", "revision"], dbQueries: [] }
if (fs.existsSync(capturePath)) {
  try { capture = JSON.parse(fs.readFileSync(capturePath, "utf8")) } catch {}
}
function save() { fs.writeFileSync(capturePath, JSON.stringify(capture)) }

if (args[0] === "db") {
  const query = args[1] || ""
  capture.dbQueries.push(query)
  if (query.includes("PRAGMA table_info(session_context_epoch)")) {
    save()
    process.stdout.write(JSON.stringify(capture.columns.map((name, index) => ({ cid: index, name }))))
    process.exit(0)
  }
  if (query.includes("ALTER TABLE session_context_epoch ADD COLUMN replacement_seq")) {
    if (!capture.columns.includes("replacement_seq")) capture.columns.splice(5, 0, "replacement_seq")
    capture.altered = true
    save()
    process.exit(0)
  }
  if (query.includes("UPDATE session_context_epoch SET replacement_seq = baseline_seq")) {
    capture.backfilled = true
    save()
    process.exit(0)
  }
  save()
  process.stdout.write("[]")
  process.exit(0)
}

if (args[0] !== "serve") process.exit(0)
const port = Number(args[args.indexOf("--port") + 1])
capture.started = true
save()
if (process.argv[2] === "db") {
  const query = process.argv[3] || ""
  if (query.includes("PRAGMA table_info(session_context_epoch)")) {
    process.stdout.write(JSON.stringify([
      { cid: 0, name: "session_id" },
      { cid: 1, name: "baseline" },
      { cid: 2, name: "agent" },
      { cid: 3, name: "snapshot" },
      { cid: 4, name: "baseline_seq" },
      { cid: 5, name: "replacement_seq" },
      { cid: 6, name: "revision" }
    ]))
    process.exit(0)
  }
  process.stdout.write("[]")
  process.exit(0)
}
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json")
  if (req.url === "/api/health") return res.end(JSON.stringify({ ok: true }))
  if (req.url === "/api/session") return res.end(JSON.stringify([]))
  if (req.url === "/api/command") return res.end(JSON.stringify([]))
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
  fakeRuntimePath = finalizeFakeRuntime(fakeRuntimePath)

  const previousRuntimeBin = process.env.OPENWORKING_RUNTIME_BIN
  const previousConfigPath = process.env.OPENWORKING_OPENCODE_CONFIG_PATH
  process.env.OPENWORKING_RUNTIME_BIN = fakeRuntimePath
  process.env.OPENWORKING_OPENCODE_CONFIG_PATH = configPath

  const manager = new RuntimeProcessManager({
    userDataPath: path.join(temp, "user-data"),
    profile: { profileDir: path.join(temp, "profile"), configPath },
    emit() {}
  })

  try {
    const snapshot = await manager.openProject({
      project: { id: "proj_schema", name: "Schema Project", path: projectPath }
    })
    const captured = JSON.parse(fs.readFileSync(capturePath, "utf8"))

    assert.equal(snapshot.status, "running")
    assert.equal(captured.started, true)
    assert.equal(captured.altered, true)
    assert.equal(captured.backfilled, true)
    assert.ok(captured.columns.includes("replacement_seq"))
    assert.deepEqual(captured.dbQueries, [
      "PRAGMA table_info(session_context_epoch)",
      "ALTER TABLE session_context_epoch ADD COLUMN replacement_seq INTEGER",
      "UPDATE session_context_epoch SET replacement_seq = baseline_seq WHERE replacement_seq IS NULL"
    ])
  } finally {
    await manager.stop()
    if (previousRuntimeBin === undefined) delete process.env.OPENWORKING_RUNTIME_BIN
    else process.env.OPENWORKING_RUNTIME_BIN = previousRuntimeBin
    delete process.env.OPENWORKING_RUNTIME_SCRIPT
    if (previousConfigPath === undefined) delete process.env.OPENWORKING_OPENCODE_CONFIG_PATH
    else process.env.OPENWORKING_OPENCODE_CONFIG_PATH = previousConfigPath
  }
})

test("runtime manager skips ALTER when replacement_seq already exists but still runs backfill", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-runtime-schema-current-"))
  const projectPath = fs.mkdtempSync(path.join(temp, "project-"))
  const configPath = path.join(temp, "opencode.json")
  fs.writeFileSync(configPath, JSON.stringify({
    provider: {
      managed: {
        options: { baseURL: "http://127.0.0.1:49152/api/v1", apiKey: "{env:OPENWORKING_LOCAL_PROXY_TOKEN}" },
        models: { "gemma/model": {} }
      }
    }
  }))
  const capturePath = path.join(temp, "capture.json")
  let fakeRuntimePath = path.join(temp, "fake-opencode-schema-current.js")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
const fs = require("node:fs")
const http = require("node:http")
const args = process.argv.slice(2)
const capturePath = ${JSON.stringify(capturePath)}
  let capture = { dbQueries: [] }
if (fs.existsSync(capturePath)) {
  try { capture = JSON.parse(fs.readFileSync(capturePath, "utf8")) } catch {}
}
function save() { fs.writeFileSync(capturePath, JSON.stringify(capture)) }

if (args[0] === "db") {
  const query = args[1] || ""
  capture.dbQueries.push(query)
  save()
  if (query.includes("PRAGMA table_info(session_context_epoch)")) {
    process.stdout.write(JSON.stringify([
      { cid: 0, name: "session_id" },
      { cid: 1, name: "baseline" },
      { cid: 2, name: "agent" },
      { cid: 3, name: "snapshot" },
      { cid: 4, name: "baseline_seq" },
      { cid: 5, name: "replacement_seq" },
      { cid: 6, name: "revision" }
    ]))
    process.exit(0)
  }
  if (query.includes("ALTER TABLE session_context_epoch ADD COLUMN replacement_seq")) {
    capture.unexpectedMutation = query
    save()
    process.exit(0)
  }
  if (query.includes("UPDATE session_context_epoch SET replacement_seq = baseline_seq")) {
    capture.backfilled = true
    save()
    process.exit(0)
  }
  save()
  process.exit(0)
}

const port = Number(args[args.indexOf("--port") + 1])
capture.started = true
save()
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json")
  if (req.url === "/api/health") return res.end(JSON.stringify({ ok: true }))
  if (req.url === "/api/session") return res.end(JSON.stringify([]))
  if (req.url === "/api/command") return res.end(JSON.stringify([]))
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
  fakeRuntimePath = finalizeFakeRuntime(fakeRuntimePath)

  const previousRuntimeBin = process.env.OPENWORKING_RUNTIME_BIN
  const previousConfigPath = process.env.OPENWORKING_OPENCODE_CONFIG_PATH
  process.env.OPENWORKING_RUNTIME_BIN = fakeRuntimePath
  process.env.OPENWORKING_OPENCODE_CONFIG_PATH = configPath

  const manager = new RuntimeProcessManager({
    userDataPath: path.join(temp, "user-data"),
    profile: { profileDir: path.join(temp, "profile"), configPath },
    emit() {}
  })

  try {
    const snapshot = await manager.openProject({
      project: { id: "proj_schema_current", name: "Schema Current", path: projectPath }
    })
    const captured = JSON.parse(fs.readFileSync(capturePath, "utf8"))

    assert.equal(snapshot.status, "running")
    assert.equal(captured.started, true)
    assert.deepEqual(captured.dbQueries, [
      "PRAGMA table_info(session_context_epoch)",
      "UPDATE session_context_epoch SET replacement_seq = baseline_seq WHERE replacement_seq IS NULL"
    ])
    assert.equal(captured.backfilled, true)
    assert.equal(captured.unexpectedMutation, undefined)
  } finally {
    await manager.stop()
    if (previousRuntimeBin === undefined) delete process.env.OPENWORKING_RUNTIME_BIN
    else process.env.OPENWORKING_RUNTIME_BIN = previousRuntimeBin
    delete process.env.OPENWORKING_RUNTIME_SCRIPT
    if (previousConfigPath === undefined) delete process.env.OPENWORKING_OPENCODE_CONFIG_PATH
    else process.env.OPENWORKING_OPENCODE_CONFIG_PATH = previousConfigPath
  }
})

test("runtime manager keeps starting when runtime db repair preflight fails", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-runtime-schema-fallback-"))
  const projectPath = fs.mkdtempSync(path.join(temp, "project-"))
  const configPath = path.join(temp, "opencode.json")
  fs.writeFileSync(configPath, JSON.stringify({
    provider: {
      managed: {
        options: { baseURL: "http://127.0.0.1:49152/api/v1", apiKey: "{env:OPENWORKING_LOCAL_PROXY_TOKEN}" },
        models: { "gemma/model": {} }
      }
    }
  }))
  const capturePath = path.join(temp, "capture.json")
  let fakeRuntimePath = path.join(temp, "fake-opencode-schema-fallback.js")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
const fs = require("node:fs")
const http = require("node:http")
const args = process.argv.slice(2)
const capturePath = ${JSON.stringify(capturePath)}
let capture = { dbQueries: [] }
if (fs.existsSync(capturePath)) {
  try { capture = JSON.parse(fs.readFileSync(capturePath, "utf8")) } catch {}
}
function save() { fs.writeFileSync(capturePath, JSON.stringify(capture)) }

if (args[0] === "db") {
  capture.dbQueries.push(args[1] || "")
  save()
  console.error("db preflight failed")
  process.exit(1)
}

const port = Number(args[args.indexOf("--port") + 1])
capture.started = true
save()
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json")
  if (req.url === "/api/health") return res.end(JSON.stringify({ ok: true }))
  if (req.url === "/api/session") return res.end(JSON.stringify([]))
  if (req.url === "/api/command") return res.end(JSON.stringify([]))
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
  fakeRuntimePath = finalizeFakeRuntime(fakeRuntimePath)

  const previousRuntimeBin = process.env.OPENWORKING_RUNTIME_BIN
  const previousConfigPath = process.env.OPENWORKING_OPENCODE_CONFIG_PATH
  process.env.OPENWORKING_RUNTIME_BIN = fakeRuntimePath
  process.env.OPENWORKING_OPENCODE_CONFIG_PATH = configPath

  const manager = new RuntimeProcessManager({
    userDataPath: path.join(temp, "user-data"),
    profile: { profileDir: path.join(temp, "profile"), configPath },
    emit() {}
  })

  try {
    const snapshot = await manager.openProject({
      project: { id: "proj_schema_fallback", name: "Schema Fallback", path: projectPath }
    })
    const captured = JSON.parse(fs.readFileSync(capturePath, "utf8"))

    assert.equal(snapshot.status, "running")
    assert.equal(captured.started, true)
    assert.deepEqual(captured.dbQueries, ["PRAGMA table_info(session_context_epoch)"])
    assert.ok(manager.snapshot().logs.some((entry) => String(entry.message || "").includes("Runtime DB schema repair skipped: db preflight failed")))
  } finally {
    await manager.stop()
    if (previousRuntimeBin === undefined) delete process.env.OPENWORKING_RUNTIME_BIN
    else process.env.OPENWORKING_RUNTIME_BIN = previousRuntimeBin
    delete process.env.OPENWORKING_RUNTIME_SCRIPT
    if (previousConfigPath === undefined) delete process.env.OPENWORKING_OPENCODE_CONFIG_PATH
    else process.env.OPENWORKING_OPENCODE_CONFIG_PATH = previousConfigPath
  }
})

test("runtime manager retries replacement_seq backfill after a prior partial migration", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-runtime-schema-retry-"))
  const projectPath = fs.mkdtempSync(path.join(temp, "project-"))
  const configPath = path.join(temp, "opencode.json")
  fs.writeFileSync(configPath, JSON.stringify({
    provider: {
      managed: {
        options: { baseURL: "http://127.0.0.1:49152/api/v1", apiKey: "{env:OPENWORKING_LOCAL_PROXY_TOKEN}" },
        models: { "gemma/model": {} }
      }
    }
  }))
  const capturePath = path.join(temp, "capture.json")
  let fakeRuntimePath = path.join(temp, "fake-opencode-schema-retry.js")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
const fs = require("node:fs")
const http = require("node:http")
const args = process.argv.slice(2)
const capturePath = ${JSON.stringify(capturePath)}
let capture = { dbQueries: [], backfillAttempts: 0 }
if (fs.existsSync(capturePath)) {
  try { capture = JSON.parse(fs.readFileSync(capturePath, "utf8")) } catch {}
}
function save() { fs.writeFileSync(capturePath, JSON.stringify(capture)) }

if (args[0] === "db") {
  const query = args[1] || ""
  capture.dbQueries.push(query)
  if (query.includes("PRAGMA table_info(session_context_epoch)")) {
    save()
    process.stdout.write(JSON.stringify([
      { cid: 0, name: "session_id" },
      { cid: 1, name: "baseline" },
      { cid: 2, name: "agent" },
      { cid: 3, name: "snapshot" },
      { cid: 4, name: "baseline_seq" },
      { cid: 5, name: "replacement_seq" },
      { cid: 6, name: "revision" }
    ]))
    process.exit(0)
  }
  if (query.includes("UPDATE session_context_epoch SET replacement_seq = baseline_seq")) {
    capture.backfillAttempts += 1
    save()
    if (capture.backfillAttempts === 1) {
      console.error("backfill failed once")
      process.exit(1)
    }
    process.exit(0)
  }
  save()
  process.exit(0)
}

const port = Number(args[args.indexOf("--port") + 1])
capture.started = true
save()
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json")
  if (req.url === "/api/health") return res.end(JSON.stringify({ ok: true }))
  if (req.url === "/api/session") return res.end(JSON.stringify([]))
  if (req.url === "/api/command") return res.end(JSON.stringify([]))
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
  fakeRuntimePath = finalizeFakeRuntime(fakeRuntimePath)

  const previousRuntimeBin = process.env.OPENWORKING_RUNTIME_BIN
  const previousConfigPath = process.env.OPENWORKING_OPENCODE_CONFIG_PATH
  process.env.OPENWORKING_RUNTIME_BIN = fakeRuntimePath
  process.env.OPENWORKING_OPENCODE_CONFIG_PATH = configPath

  const manager = new RuntimeProcessManager({
    userDataPath: path.join(temp, "user-data"),
    profile: { profileDir: path.join(temp, "profile"), configPath },
    emit() {}
  })

  try {
    await manager.openProject({
      project: { id: "proj_schema_retry_1", name: "Schema Retry 1", path: projectPath }
    })
    await manager.stop()
    await manager.openProject({
      project: { id: "proj_schema_retry_2", name: "Schema Retry 2", path: projectPath }
    })
    const captured = JSON.parse(fs.readFileSync(capturePath, "utf8"))

    assert.equal(captured.started, true)
    assert.equal(captured.backfillAttempts, 2)
    assert.deepEqual(captured.dbQueries.filter((query) => query.includes("UPDATE session_context_epoch SET replacement_seq")), [
      "UPDATE session_context_epoch SET replacement_seq = baseline_seq WHERE replacement_seq IS NULL",
      "UPDATE session_context_epoch SET replacement_seq = baseline_seq WHERE replacement_seq IS NULL"
    ])
    assert.ok(manager.snapshot().logs.some((entry) => String(entry.message || "").includes("Runtime DB schema repair skipped: backfill failed once")))
  } finally {
    await manager.stop()
    if (previousRuntimeBin === undefined) delete process.env.OPENWORKING_RUNTIME_BIN
    else process.env.OPENWORKING_RUNTIME_BIN = previousRuntimeBin
    delete process.env.OPENWORKING_RUNTIME_SCRIPT
    if (previousConfigPath === undefined) delete process.env.OPENWORKING_OPENCODE_CONFIG_PATH
    else process.env.OPENWORKING_OPENCODE_CONFIG_PATH = previousConfigPath
  }
})

test("runtime manager opens a project and exposes explicit session APIs", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-runtime-"))
  const projectPath = path.join(temp, "project")
  const secondProjectPath = path.join(temp, "second-project")
  fs.mkdirSync(projectPath)
  fs.mkdirSync(secondProjectPath)
  const configPath = path.join(temp, "opencode.json")
  const runtimeConfigPath = path.join(temp, "opencode-v2.json")
  fs.writeFileSync(configPath, JSON.stringify({
    provider: {
      gateway: {
        options: { baseURL: "http://127.0.0.1:49152/api/v1", apiKey: "gateway-key" },
        models: { "gpt-4o-mini": {} }
      }
    }
  }))
  fs.writeFileSync(runtimeConfigPath, JSON.stringify({ providers: {} }))
  const capturePath = path.join(temp, "capture.json")
  let fakeRuntimePath = path.join(temp, "fake-opencode.js")
  const commandsDir = path.join(temp, "profile", "commands")
  fs.mkdirSync(commandsDir, { recursive: true })
  fs.writeFileSync(path.join(commandsDir, "stale-command"), "/stale-command\n")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
const fs = require("node:fs")
const http = require("node:http")
const path = require("node:path")
if (process.argv[2] === "db") {
  const query = process.argv[3] || ""
  if (query.includes("PRAGMA table_info(session_context_epoch)")) {
    process.stdout.write(JSON.stringify([
      { cid: 0, name: "session_id" },
      { cid: 1, name: "baseline" },
      { cid: 2, name: "agent" },
      { cid: 3, name: "snapshot" },
      { cid: 4, name: "baseline_seq" },
      { cid: 5, name: "replacement_seq" },
      { cid: 6, name: "revision" }
    ]))
    process.exit(0)
  }
  process.stdout.write("[]")
  process.exit(0)
}
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
  // v2 nests the project directory under location; the manager flattens it onto directory
  // before it crosses IPC, because the renderer groups the sidebar by that field.
  { id: "sess_existing", title: "Existing session", location: { directory: process.cwd() } },
  { id: "sess_child", title: "Subagent session", location: { directory: process.cwd() }, parentID: "sess_existing" },
  { id: "sess_other", title: "Other project", location: { directory: "/tmp/other-project" } },
  { id: "sess_other_child", title: "Other project subagent", location: { directory: "/tmp/other-project" }, parentSessionId: "sess_other" }
]
const skillCatalog = [
  { name: "find-bugs", description: "Inspect code for likely defects.", location: path.join(process.env.OPENCODE_CONFIG_DIR, "skills", "find-bugs", "SKILL.md"), slash: true, content: "---\\nname: find-bugs\\n" },
  { name: "repo-review", description: "Inspect repo-local agents skill.", location: path.join(process.cwd(), ".agents", "skills", "repo-review", "SKILL.md"), slash: true, content: "---\\nname: repo-review\\n" },
  { name: "home-review", description: "Inspect home agents skill.", location: path.join(process.env.HOME, ".agents", "skills", "home-review", "SKILL.md"), slash: true, content: "---\\nname: home-review\\n" },
  { name: "repo-opencode", description: "Inspect repo-local opencode skill.", location: path.join(process.cwd(), ".opencode", "skills", "repo-opencode", "SKILL.md"), slash: true, content: "---\\nname: repo-opencode\\n" },
  { name: "home-config-opencode", description: "Inspect home config opencode skill.", location: path.join(process.env.HOME, ".config", "opencode", "skills", "home-config-opencode", "SKILL.md"), slash: true, content: "---\\nname: home-config-opencode\\n" }
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
  if (req.url === "/api/health") return res.end(JSON.stringify({ ok: true }))
  // Command.Info carries no source field on the real v2 API (name/template/description/agent/
  // model/subtask only, additionalProperties:false) - every /api/command entry is a plain custom
  // command. Skills live entirely separately behind /api/skill (skillCatalog below).
  if (req.url === "/api/command" && req.method === "GET") return res.end(JSON.stringify([
    { name: "init", description: "guided AGENTS.md setup", template: "Create or update AGENTS.md $ARGUMENTS", hints: ["$ARGUMENTS"] },
    { name: "bad/name", description: "unsafe command name", template: "broken", hints: [] }
  ]))
  if (req.url === "/api/skill" && req.method === "GET") return res.end(JSON.stringify(skillCatalog))
  if (req.url === "/api/session/sess_new/command" && req.method === "POST") return body(req, data => {
    capture.command = data
    save()
    res.end(JSON.stringify({ ok: true }))
  })
  if (req.url.startsWith("/api/session?") && req.method === "GET") {
    // OpenCode GET /session is directory-scoped via the directory query param.
    const dir = new URL(req.url, "http://x").searchParams.get("directory")
    const scoped = dir ? sessions.filter((s) => (s.location ? s.location.directory : s.directory) === dir) : sessions
    return res.end(JSON.stringify({
      data: scoped,
      cursor: { previous: null, next: null }
    }))
  }
  if (req.url === "/api/session" && req.method === "GET") return res.end(JSON.stringify({
    data: sessions,
    cursor: { previous: null, next: null }
  }))
  if (req.url === "/api/session" && req.method === "POST") return body(req, data => {
    capture.created = data
    sessions.unshift({ id: "sess_new", title: "Untitled", directory: process.cwd(), agent: data.agent, model: data.model })
    save()
    res.end(JSON.stringify(sessions[0]))
  })
  if (req.url === "/api/session/sess_new/rename" && req.method === "POST") return body(req, data => {
    capture.renamed = data
    sessions[0].title = data.title
    save()
    res.writeHead(204)
    res.end()
  })
  // Mirror the real v2 validation: the message endpoint caps limit at 200 and rejects anything
  // larger. Without this guard the stub happily served limit=100000, which is why the export
  // regression only ever reproduced against a live server.
  if (req.method === "GET" && req.url.startsWith("/api/session/") && req.url.includes("/message?")) {
    const limit = Number(new URL(req.url, "http://x").searchParams.get("limit"))
    if (Number.isFinite(limit) && limit > 200) {
      return res.writeHead(400).end(JSON.stringify({
        _tag: "InvalidRequestError",
        message: "Expected a value less than or equal to 200, got " + limit,
        kind: "Query"
      }))
    }
  }
  // v2 wraps message lists in { data, cursor } and serves flat messages: assistants use
  // content[], users carry a bare text field and no content key at all.
  if (req.url.startsWith("/api/session/sess_new/message?")) {
    return res.end(JSON.stringify({
      data: [
        {
          id: "msg_ready",
          sessionID: "sess_new",
          type: "assistant",
          content: [
            { id: "part_ready", sessionID: "sess_new", messageID: "msg_ready", type: "text", text: "Ready" },
            { id: "part_file", sessionID: "sess_new", messageID: "msg_ready", type: "file", filename: "report.pdf", mime: "application/pdf", url: "file:///private/report.pdf" }
          ]
        }
      ],
      cursor: { previous: null, next: null }
    }))
  }
  if (req.method === "GET" && req.url.split("?")[0] === "/api/session/sess_existing") {
    return res.end(JSON.stringify({ data: sessions.find((session) => session.id === "sess_existing") }))
  }
  if (req.method === "GET" && req.url.startsWith("/api/session/sess_existing/message?limit=200&order=asc")) {
    const parsed = new URL(req.url, "http://x")
    if (parsed.searchParams.get("directory") !== process.cwd()) return res.writeHead(400).end(JSON.stringify({ error: "wrong directory" }))
    return res.end(JSON.stringify({
      data: [{
        id: "msg_export",
        sessionID: "sess_existing",
        type: "assistant",
        providerID: "raw-provider",
        content: [{
          id: "part_export",
          sessionID: "sess_existing",
          messageID: "msg_export",
          type: "file",
          filename: "private.pdf",
          mime: "application/pdf",
          url: "file:///private/private.pdf"
        }]
      }],
      cursor: { previous: null, next: null }
    }))
  }
  if (req.url === "/api/session/sess_existing/message?limit=100&order=asc") {
    return res.end(JSON.stringify({
      data: [
        {
          id: "msg_existing",
          sessionID: "sess_existing",
          type: "assistant",
          content: [
            { id: "part_existing", sessionID: "sess_existing", messageID: "msg_existing", type: "text", text: "Existing session message" }
          ]
        },
        { id: "msg_user", sessionID: "sess_existing", type: "user", time: { created: 1 }, text: "Ask something" }
      ],
      cursor: { previous: null, next: null }
    }))
  }
  if (req.url === "/api/session/sess_new/prompt" && req.method === "POST") return body(req, data => {
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
  fakeRuntimePath = finalizeFakeRuntime(fakeRuntimePath)

  const previousRuntimeBin = process.env.OPENWORKING_RUNTIME_BIN
  const previousConfigPath = process.env.OPENWORKING_OPENCODE_CONFIG_PATH
  process.env.OPENWORKING_RUNTIME_BIN = fakeRuntimePath
  process.env.OPENWORKING_OPENCODE_CONFIG_PATH = configPath

  const manager = new RuntimeProcessManager({
    userDataPath: path.join(temp, "user-data"),
    profile: { profileDir: path.join(temp, "profile"), configPath, xdgConfigPath: runtimeConfigPath },
    emit() {}
  })
  const project = { id: "proj_local", name: "Local Project", path: projectPath }

  try {
    const snapshot = await manager.openProject({ project })
    const firstPid = snapshot.runtime.pid
    const captured = JSON.parse(fs.readFileSync(capturePath, "utf8"))

    assert.equal(snapshot.status, "running")
    assert.equal(snapshot.runtime.cwd, projectPath)
    assert.equal(snapshot.runtime.configPath, runtimeConfigPath)
    assert.equal(snapshot.activeSessionId, null)
    assert.equal(captured.cwd, fs.realpathSync(projectPath))
    assert.equal(captured.config, runtimeConfigPath)
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
    // `directory` is present on the projected result even though the runtime sent `location`.
    assert.deepEqual(await manager.listSessions(), [
      { id: "sess_existing", title: "Existing session", location: { directory: fs.realpathSync(projectPath) }, directory: fs.realpathSync(projectPath) }
    ])
    // listSessionsForDirectory passes ?directory= so the renderer can populate any project's
    // sidebar history from this one server. Each call returns only that directory's sessions.
    assert.deepEqual(await manager.listSessionsForDirectory("/tmp/other-project"), [
      { id: "sess_other", title: "Other project", location: { directory: "/tmp/other-project" }, directory: "/tmp/other-project" }
    ])
    assert.deepEqual(await manager.listSessionsForDirectory(fs.realpathSync(projectPath)), [
      { id: "sess_existing", title: "Existing session", location: { directory: fs.realpathSync(projectPath) }, directory: fs.realpathSync(projectPath) }
    ])

    assert.equal((await manager.createSession({
      title: "New session",
      agent: "plan",
      model: { providerID: "openworking", id: "google/gemma-4-31B-it", variant: "high" }
    })).id, "sess_new")
    assert.deepEqual((await manager.listMessages({ sessionId: "sess_new" }))[0].parts, [
      { id: "part_ready", sessionID: "sess_new", messageID: "msg_ready", type: "text", text: "Ready" },
      { id: "part_file", sessionID: "sess_new", messageID: "msg_ready", type: "file", filename: "report.pdf", mime: "application/pdf" }
    ])
    assert.deepEqual(await manager.getSessionExport({
      sessionId: "sess_existing",
      directory: fs.realpathSync(projectPath)
    }), {
      // The stub serves the session record straight from its session list, which is the v2 shape
      // (location.directory), and export passes it through unprojected.
      info: {
        id: "sess_existing",
        title: "Existing session",
        location: { directory: fs.realpathSync(projectPath) }
      },
      // Export keeps the runtime's raw v2 message shape (content[], no renderer projection), so
      // the private file url survives here even though listMessages() strips it.
      messages: [{
        id: "msg_export",
        sessionID: "sess_existing",
        type: "assistant",
        providerID: "raw-provider",
        content: [{
          id: "part_export",
          sessionID: "sess_existing",
          messageID: "msg_export",
          type: "file",
          filename: "private.pdf",
          mime: "application/pdf",
          url: "file:///private/private.pdf"
        }]
      }]
    })
    await manager.sendPrompt({
      sessionId: "sess_new",
      inputId: "msg_runtimeprompt",
      delivery: "queue",
      resume: true,
      prompt: "Explain the project",
      attachments: [
        // sendPrompt resolves these back to local paths, so they must be absolute on the host.
        { type: "file", url: attachmentUrl("report.pdf"), filename: "report.pdf", mime: "application/pdf" },
        { type: "file", url: attachmentUrl("image.png"), filename: "image.png", mime: "image/png" }
      ]
    })
    assert.equal(manager.snapshot().activeSessionId, "sess_new")
    await manager.listMessages({ sessionId: "sess_existing" })
    assert.equal(manager.snapshot().activeSessionId, "sess_new")

    const afterPrompt = JSON.parse(fs.readFileSync(capturePath, "utf8"))
    assert.deepEqual(afterPrompt.created, {
      agent: "plan",
      model: { providerID: "openworking", id: "google/gemma-4-31B-it", variant: "high" }
    })
    assert.deepEqual(afterPrompt.renamed, { title: "New session" })
    // v2 prompt bodies are `{ text, files }`; v1's `parts` array returns HTTP 400.
    assert.deepEqual(afterPrompt.prompt, {
      id: "msg_runtimeprompt",
      text: "Explain the project",
      files: [
        { uri: attachmentUrl("report.pdf"), name: "report.pdf", description: "application/pdf" },
        { uri: attachmentUrl("image.png"), name: "image.png", description: "image/png" }
      ],
      delivery: "queue",
      resume: true
    })

    const commands = await manager.listCommands()
    assert.deepEqual(commands.slice(0, 2), [
      {
        name: "init",
        description: "guided AGENTS.md setup",
        source: "command",
        agent: undefined,
        model: undefined,
        hints: ["$ARGUMENTS"],
        path: path.join(temp, "profile", "commands", "init"),
        extra: { name: "init", description: "guided AGENTS.md setup", template: "Create or update AGENTS.md $ARGUMENTS", hints: ["$ARGUMENTS"], source: "command" }
      },
      {
        name: "find-bugs",
        description: "Inspect code for likely defects.",
        source: "skill",
        agent: undefined,
        model: undefined,
        hints: [],
        path: path.join(temp, "profile", "skills", "find-bugs", "SKILL.md"),
        locationFamily: "managed_profile",
        extra: { name: "find-bugs", description: "Inspect code for likely defects.", location: commands[1].path, slash: true, content: "---\nname: find-bugs\n", source: "skill" }
      }
    ])
    assert.deepEqual(commands[2], {
      name: "repo-review",
      description: "Inspect repo-local agents skill.",
      source: "skill",
      agent: undefined,
      model: undefined,
      hints: [],
      path: commands[2].path,
      locationFamily: "repo_agents",
      extra: { name: "repo-review", description: "Inspect repo-local agents skill.", location: commands[2].path, slash: true, content: "---\nname: repo-review\n", source: "skill" }
    })
    // This path comes from the filesystem, so its separator is the platform's own.
    assert.equal(commands[2].path.endsWith(path.join(".agents", "skills", "repo-review", "SKILL.md")), true)
    assert.deepEqual(commands[3], {
      name: "home-review",
      description: "Inspect home agents skill.",
      source: "skill",
      agent: undefined,
      model: undefined,
      hints: [],
      path: path.join(os.homedir(), ".agents", "skills", "home-review", "SKILL.md"),
      locationFamily: "home_agents",
      extra: { name: "home-review", description: "Inspect home agents skill.", location: commands[3].path, slash: true, content: "---\nname: home-review\n", source: "skill" }
    })
    assert.deepEqual(commands[4], {
      name: "repo-opencode",
      description: "Inspect repo-local opencode skill.",
      source: "skill",
      agent: undefined,
      model: undefined,
      hints: [],
      path: commands[4].path,
      locationFamily: "repo_opencode",
      extra: { name: "repo-opencode", description: "Inspect repo-local opencode skill.", location: commands[4].path, slash: true, content: "---\nname: repo-opencode\n", source: "skill" }
    })
    assert.equal(commands[4].path.endsWith(path.join(".opencode", "skills", "repo-opencode", "SKILL.md")), true)
    assert.deepEqual(commands[5], {
      name: "home-config-opencode",
      description: "Inspect home config opencode skill.",
      source: "skill",
      agent: undefined,
      model: undefined,
      hints: [],
      path: path.join(os.homedir(), ".config", "opencode", "skills", "home-config-opencode", "SKILL.md"),
      locationFamily: "home_config_opencode",
      extra: { name: "home-config-opencode", description: "Inspect home config opencode skill.", location: commands[5].path, slash: true, content: "---\nname: home-config-opencode\n", source: "skill" }
    })
    assert.equal(commands.length, 6)
    assert.equal(fs.existsSync(path.join(temp, "profile", "commands", "init")), true)
    assert.equal(fs.existsSync(path.join(temp, "profile", "commands", "stale-command")), false)
    await manager.sendCommand({
      sessionId: "sess_new",
      inputId: "msg_runtimecommand1",
      command: "init",
      arguments: "focus on the build steps",
      delivery: "queue",
      resume: true
    })
    const afterCommand = JSON.parse(fs.readFileSync(capturePath, "utf8"))
    assert.deepEqual(afterCommand.command, {
      id: "msg_runtimecommand1",
      command: "init",
      arguments: "focus on the build steps",
      delivery: "queue",
      resume: true
    })

    await manager.sendCommand({
      sessionId: "sess_new",
      inputId: "msg_runtimecommand2",
      command: "init",
      arguments: "without an explicit model",
      delivery: "steer",
      resume: true
    })
    const afterCommandWithoutModel = JSON.parse(fs.readFileSync(capturePath, "utf8"))
    assert.deepEqual(afterCommandWithoutModel.command, {
      id: "msg_runtimecommand2",
      command: "init",
      arguments: "without an explicit model",
      delivery: "steer",
      resume: true
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
    delete process.env.OPENWORKING_RUNTIME_SCRIPT
    if (previousConfigPath === undefined) delete process.env.OPENWORKING_OPENCODE_CONFIG_PATH
    else process.env.OPENWORKING_OPENCODE_CONFIG_PATH = previousConfigPath
  }
})

test("runtime manager merges skill catalog wrapper responses into slash entries", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-runtime-skill-wrapper-"))
  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  const configPath = path.join(temp, "opencode.json")
  fs.writeFileSync(configPath, JSON.stringify({ provider: {} }))
  let fakeRuntimePath = path.join(temp, "fake-opencode-skill-wrapper.js")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
const http = require("node:http")
const path = require("node:path")
if (process.argv[2] === "db") {
  process.stdout.write(JSON.stringify([{ cid: 0, name: "replacement_seq" }]))
  process.exit(0)
}
const port = Number(process.argv[process.argv.indexOf("--port") + 1])
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json")
  if (req.url === "/api/health") return res.end(JSON.stringify({ ok: true }))
  if (req.url === "/api/session") return res.end(JSON.stringify([]))
  // Skills never appear inside /api/command on the real v2 API (Command.Info has no source
  // field) — this wrapper only needs to prove the {location, data} v2 envelope unwraps correctly
  // for an empty command catalog.
  if (req.url === "/api/command" && req.method === "GET") {
    return res.end(JSON.stringify({
      location: { directory: process.cwd(), project: { id: "proj_wrapper", directory: process.cwd() } },
      data: []
    }))
  }
  // "fallback-skill" has no location, exercising skillCommandInfo's managed_profile default —
  // Skill.Info requires location per schema, but the fallback still matters defensively.
  if (req.url === "/api/skill" && req.method === "GET") {
    return res.end(JSON.stringify({
      location: { directory: process.cwd(), project: { id: "proj_wrapper", directory: process.cwd() } },
      data: [
        { name: "wrapper-skill", description: "wrapper description", slash: true, location: path.join(process.env.HOME, ".opencode", "skills", "wrapper-skill", "SKILL.md"), content: "---\\nname: wrapper-skill\\n" },
        { name: "fallback-skill", description: "fallback skill description", slash: true, location: "", content: "---\\nname: fallback-skill\\n" }
      ]
    }))
  }
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
  fakeRuntimePath = finalizeFakeRuntime(fakeRuntimePath)

  const previousRuntimeBin = process.env.OPENWORKING_RUNTIME_BIN
  const previousConfigPath = process.env.OPENWORKING_OPENCODE_CONFIG_PATH
  process.env.OPENWORKING_RUNTIME_BIN = fakeRuntimePath
  process.env.OPENWORKING_OPENCODE_CONFIG_PATH = configPath

  const manager = new RuntimeProcessManager({
    userDataPath: path.join(temp, "user-data"),
    profile: { profileDir: path.join(temp, "profile"), configPath },
    emit() {}
  })

  try {
    await manager.openProject({ project: { id: "proj_wrapper", name: "Wrapper Project", path: projectPath } })
    const commands = await manager.listCommands()
    assert.deepEqual(commands[0], {
      name: "wrapper-skill",
      description: "wrapper description",
      source: "skill",
      agent: undefined,
      model: undefined,
      hints: [],
      path: path.join(os.homedir(), ".opencode", "skills", "wrapper-skill", "SKILL.md"),
      locationFamily: "home_opencode",
      extra: { name: "wrapper-skill", description: "wrapper description", slash: true, location: path.join(process.env.HOME, ".opencode", "skills", "wrapper-skill", "SKILL.md"), content: "---\nname: wrapper-skill\n", source: "skill" }
    })
    assert.deepEqual(commands[1], {
      name: "fallback-skill",
      description: "fallback skill description",
      source: "skill",
      agent: undefined,
      model: undefined,
      hints: [],
      path: path.join(temp, "profile", "skills", "fallback-skill", "SKILL.md"),
      locationFamily: "managed_profile",
      extra: { name: "fallback-skill", description: "fallback skill description", slash: true, location: "", content: "---\nname: fallback-skill\n", source: "skill" }
    })
    assert.equal(commands.length, 2)
  } finally {
    await manager.stop()
    if (previousRuntimeBin === undefined) delete process.env.OPENWORKING_RUNTIME_BIN
    else process.env.OPENWORKING_RUNTIME_BIN = previousRuntimeBin
    delete process.env.OPENWORKING_RUNTIME_SCRIPT
    if (previousConfigPath === undefined) delete process.env.OPENWORKING_OPENCODE_CONFIG_PATH
    else process.env.OPENWORKING_OPENCODE_CONFIG_PATH = previousConfigPath
  }
})

test("runtime manager keeps command catalog working when skill catalog fetch fails", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-runtime-skill-fail-"))
  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  const configPath = path.join(temp, "opencode.json")
  fs.writeFileSync(configPath, JSON.stringify({ provider: {} }))
  let fakeRuntimePath = path.join(temp, "fake-opencode-skill-fail.js")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
const http = require("node:http")
if (process.argv[2] === "db") {
  process.stdout.write(JSON.stringify([{ cid: 0, name: "replacement_seq" }]))
  process.exit(0)
}
const port = Number(process.argv[process.argv.indexOf("--port") + 1])
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json")
  if (req.url === "/api/health") return res.end(JSON.stringify({ ok: true }))
  if (req.url === "/api/session") return res.end(JSON.stringify([]))
  if (req.url === "/api/command" && req.method === "GET") {
    return res.end(JSON.stringify([
      { name: "real-command", description: "a real custom command", template: "do the thing", hints: [] }
    ]))
  }
  if (req.url === "/api/skill" && req.method === "GET") {
    res.writeHead(500)
    return res.end(JSON.stringify({ error: "skill catalog unavailable" }))
  }
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
  fakeRuntimePath = finalizeFakeRuntime(fakeRuntimePath)

  const previousRuntimeBin = process.env.OPENWORKING_RUNTIME_BIN
  const previousConfigPath = process.env.OPENWORKING_OPENCODE_CONFIG_PATH
  process.env.OPENWORKING_RUNTIME_BIN = fakeRuntimePath
  process.env.OPENWORKING_OPENCODE_CONFIG_PATH = configPath

  const manager = new RuntimeProcessManager({
    userDataPath: path.join(temp, "user-data"),
    profile: { profileDir: path.join(temp, "profile"), configPath },
    emit() {}
  })

  try {
    await manager.openProject({ project: { id: "proj_fallback", name: "Fallback Project", path: projectPath } })
    const commands = await manager.listCommands()
    assert.deepEqual(commands, [{
      name: "real-command",
      description: "a real custom command",
      source: "command",
      agent: undefined,
      model: undefined,
      hints: [],
      path: path.join(temp, "profile", "commands", "real-command"),
      extra: { name: "real-command", description: "a real custom command", template: "do the thing", hints: [], source: "command" }
    }])
    assert.ok(manager.snapshot().logs.some((entry) => String(entry.message || "").includes("Skill catalog fetch failed: HTTP 500")))
  } finally {
    await manager.stop()
    if (previousRuntimeBin === undefined) delete process.env.OPENWORKING_RUNTIME_BIN
    else process.env.OPENWORKING_RUNTIME_BIN = previousRuntimeBin
    delete process.env.OPENWORKING_RUNTIME_SCRIPT
    if (previousConfigPath === undefined) delete process.env.OPENWORKING_OPENCODE_CONFIG_PATH
    else process.env.OPENWORKING_OPENCODE_CONFIG_PATH = previousConfigPath
  }
})

test("runtime manager aborts the active session through opencode", async () => {
  const emitted = []
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/api/session/sess_new/interrupt" && req.method === "POST") {
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
    assert.equal(manager.snapshot().activity, "running", "the interrupt response is not a lifecycle event")
    assert.deepEqual(manager.snapshot().activeSessionStatus, { type: "busy" })
    manager.handleRuntimeEvent({
      type: "session.execution.interrupted",
      data: { sessionID: "sess_new", reason: "user" }
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
    if (req.url === "/api/session/sess_new/interrupt" && req.method === "POST") {
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
    if (req.url === "/api/session/sess_new" && req.method === "DELETE") {
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

test("runtime manager forks a session through opencode", async () => {
  const captured = []
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/api/session/sess_parent/fork?directory=%2Ftmp%2Fother" && req.method === "POST") {
      let raw = ""
      req.on("data", (chunk) => {
        raw += chunk
      })
      req.on("end", () => {
        captured.push({ url: req.url, method: req.method, authorization: req.headers.authorization, raw })
        res.end(JSON.stringify({ data: { id: "sess_fork_mid", title: "Forked mid", directory: "/tmp/other" } }))
      })
      return
    }
    if (req.url === "/api/session/sess_parent/fork" && req.method === "POST") {
      let raw = ""
      req.on("data", (chunk) => {
        raw += chunk
      })
      req.on("end", () => {
        captured.push({ url: req.url, method: req.method, authorization: req.headers.authorization, raw })
        res.end(JSON.stringify({ data: { id: "sess_fork_full", title: "Forked full" } }))
      })
      return
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-fork",
    emit() {}
  })
  manager.child = {}
  manager.state.status = "running"
  manager.state.activeSessionId = "sess_parent"
  manager.state.runtime = {
    serverUrl: `http://127.0.0.1:${port}`,
    auth: { username: "opencode", password: "pw" }
  }

  try {
    assert.equal((await manager.forkSession({ sessionId: "sess_parent", messageId: "msg_next", directory: "/tmp/other" })).id, "sess_fork_mid")
    assert.equal(manager.snapshot().activeSessionId, "sess_fork_mid")
    assert.equal((await manager.forkSession({ sessionId: "sess_parent" })).id, "sess_fork_full")
    assert.equal(manager.snapshot().activeSessionId, "sess_fork_full")
    assert.deepEqual(captured, [
      {
        url: "/api/session/sess_parent/fork?directory=%2Ftmp%2Fother",
        method: "POST",
        authorization: `Basic ${Buffer.from("opencode:pw").toString("base64")}`,
        raw: JSON.stringify({ boundary: { type: "before", messageID: "msg_next" } })
      },
      {
        url: "/api/session/sess_parent/fork",
        method: "POST",
        authorization: `Basic ${Buffer.from("opencode:pw").toString("base64")}`,
        raw: JSON.stringify({ boundary: { type: "through" } })
      }
    ])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("runtime manager renames a session through opencode", async () => {
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/api/session/sess_new/rename" && req.method === "POST") {
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
        res.writeHead(204)
        res.end()
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
      method: "POST",
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

test("runtime manager uses native model, compaction and revert v2 contracts without restarting", async () => {
  const captured = []
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => {
      raw += chunk
    })
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : undefined
      captured.push({ method: req.method, url: req.url, body })
      res.setHeader("Content-Type", "application/json")
      if (req.method === "GET" && req.url === "/api/model") {
        res.end(JSON.stringify({
          data: [
            {
              providerID: "openworking",
              id: "gemma",
              name: "Gemma",
              enabled: true,
              limit: { context: 128000 },
              settings: { apiKey: "must-not-cross-ipc" },
              variants: [{ id: "medium", settings: { reasoningEffort: "medium" } }, { id: "xhigh" }]
            },
            { providerID: "disabled", id: "hidden", enabled: false }
          ]
        }))
        return
      }
      if (req.method === "POST" && req.url === "/api/session/sess_new/compact") {
        res.end(JSON.stringify({ data: { id: "inp_compact" } }))
        return
      }
      if (req.method === "POST" && req.url === "/api/session/sess_new/revert/stage") {
        res.end(JSON.stringify({
          data: {
            messageID: "msg_user",
            snapshot: "private",
            patch: "private",
            files: [{ file: "src/app.js", status: "modified", additions: 3, deletions: 1 }]
          }
        }))
        return
      }
      res.writeHead(204)
      res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  const originalChild = manager.child
  manager.state.runtime.pid = 12345

  try {
    // listModels() is gone on purpose — the app pins one model and never reads the
    // runtime's catalog, which also advertises unsupported built-in providers.
    assert.equal(manager.listModels, undefined)

    await manager.selectSessionAgent({ sessionId: "sess_new", agent: "plan" })
    await manager.selectSessionModel({
      sessionId: "sess_new",
      model: { providerID: "openworking", id: "gemma", variant: "xhigh" }
    })
    manager.sessionStatuses.sess_new = { type: "busy" }
    assert.deepEqual(await manager.compactSession({ sessionId: "sess_new" }), {
      status: "admitted",
      reason: "manual",
      inputID: "inp_compact"
    })
    assert.deepEqual(await manager.compactSession({ sessionId: "sess_new" }), {
      status: "admitted",
      reason: "manual",
      inputID: "inp_compact"
    })

    manager.sessionStatuses.sess_new = { type: "idle" }
    assert.deepEqual(await manager.stageSessionRevert({
      sessionId: "sess_new",
      messageId: "msg_user",
      files: true
    }), {
      messageID: "msg_user",
      files: [{ file: "src/app.js", status: "modified", additions: 3, deletions: 1 }]
    })
    await manager.clearSessionRevert({ sessionId: "sess_new" })
    await manager.commitSessionRevert({ sessionId: "sess_new" })

    assert.strictEqual(manager.child, originalChild)
    assert.equal(manager.snapshot().runtime.pid, 12345)
    assert.deepEqual(captured, [
      // No GET /api/model: the model is pinned, so the catalog is never fetched.
      { method: "POST", url: "/api/session/sess_new/agent", body: { agent: "plan" } },
      {
        method: "POST",
        url: "/api/session/sess_new/model",
        body: { model: { providerID: "openworking", id: "gemma", variant: "xhigh" } }
      },
      { method: "POST", url: "/api/session/sess_new/compact", body: {} },
      {
        method: "POST",
        url: "/api/session/sess_new/revert/stage",
        body: { messageID: "msg_user", files: true }
      },
      { method: "POST", url: "/api/session/sess_new/revert/clear", body: undefined },
      { method: "POST", url: "/api/session/sess_new/revert/commit", body: undefined }
    ])

    manager.sessionStatuses.sess_new = { type: "busy" }
    await assert.rejects(
      manager.stageSessionRevert({ sessionId: "sess_new", messageId: "msg_user" }),
      /Wait for the session to finish/
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("runtime manager surfaces delete failures without clearing the active session", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/api/session/sess_new" && req.method === "DELETE") {
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
  let fakeRuntimePath = path.join(temp, "fake-opencode.js")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
const fs = require("node:fs")
const http = require("node:http")
if (process.argv[2] === "db") {
  const query = process.argv[3] || ""
  if (query.includes("PRAGMA table_info(session_context_epoch)")) {
    process.stdout.write(JSON.stringify([
      { cid: 0, name: "session_id" },
      { cid: 1, name: "baseline" },
      { cid: 2, name: "agent" },
      { cid: 3, name: "snapshot" },
      { cid: 4, name: "baseline_seq" },
      { cid: 5, name: "replacement_seq" },
      { cid: 6, name: "revision" }
    ]))
    process.exit(0)
  }
  process.stdout.write("[]")
  process.exit(0)
}
const port = Number(process.argv[process.argv.indexOf("--port") + 1])
fs.writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ apiKey: process.env.OPENWORKING_TRANSLATION_API_KEY }))
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json")
  if (req.url === "/api/health") return res.end(JSON.stringify({ ok: true }))
  if (req.url === "/event") { res.setHeader("Content-Type", "text/event-stream"); return res.writeHead(200) }
  res.writeHead(404)
  res.end()
})
server.listen(port, "127.0.0.1")
process.on("SIGTERM", () => process.exit(0))
`)
  fakeRuntimePath = finalizeFakeRuntime(fakeRuntimePath)

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
    delete process.env.OPENWORKING_RUNTIME_SCRIPT
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

test("concurrent createSession calls share one request and clear the guard after settle", async () => {
  let createCalls = 0
  let shouldFail = false
  const originalRequest = http.request
  http.request = (options, callback) => {
    const req = new EventEmitter()
    req.write = () => {}
    req.end = () => {
      const isCreate = options.path === "/api/session"
      if (isCreate) createCalls += 1
      const response = new EventEmitter()
      response.statusCode = isCreate && shouldFail ? 500 : (isCreate ? 200 : 204)
      response.setEncoding = () => {}
      setTimeout(() => {
        callback(response)
        if (isCreate) {
          response.emit("data", shouldFail
            ? JSON.stringify({ error: "create failed" })
            : JSON.stringify({ id: `sess_${createCalls}`, title: "Untitled" }))
        }
        response.emit("end")
      }, 25)
    }
    req.destroy = () => {}
    assert.match(options.path, /^\/api\/session(?:\/sess_\d+\/rename)?$/)
    assert.equal(options.method, "POST")
    return req
  }
  const manager = readyManager("http://127.0.0.1:43123")

  try {
    const [first, second] = await Promise.all([
      manager.createSession({ title: "New session" }),
      manager.createSession({ title: "Ignored duplicate title" })
    ])
    assert.equal(createCalls, 1)
    assert.strictEqual(first, second)
    assert.equal(first.id, "sess_1")
    assert.equal(manager.createSessionInFlight, null)

    shouldFail = true
    await assert.rejects(Promise.all([
      manager.createSession({ title: "Will fail" }),
      manager.createSession({ title: "Will also fail" })
    ]), /create failed/)
    assert.equal(createCalls, 2)
    assert.equal(manager.createSessionInFlight, null)

    shouldFail = false
    assert.equal((await manager.createSession({ title: "Retry works" })).id, "sess_3")
    assert.equal(createCalls, 3)
  } finally {
    http.request = originalRequest
  }
})

test("runtime startup failures include recent child stderr", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-runtime-startup-fail-"))
  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  let fakeRuntimePath = path.join(temp, "fake-opencode.js")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
if (process.argv[2] === "db") {
  const query = process.argv[3] || ""
  if (query.includes("PRAGMA table_info(session_context_epoch)")) {
    process.stdout.write(JSON.stringify([
      { cid: 0, name: "session_id" },
      { cid: 1, name: "baseline" },
      { cid: 2, name: "agent" },
      { cid: 3, name: "snapshot" },
      { cid: 4, name: "baseline_seq" },
      { cid: 5, name: "replacement_seq" },
      { cid: 6, name: "revision" }
    ]))
    process.exit(0)
  }
  process.stdout.write("[]")
  process.exit(0)
}
console.error("fatal startup detail")
process.exit(2)
`)
  fakeRuntimePath = finalizeFakeRuntime(fakeRuntimePath)

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
    delete process.env.OPENWORKING_RUNTIME_SCRIPT
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
    data: { sessionID: "sess_active", status: { type: "busy" } }
  })
  manager.handleRuntimeEvent({
    type: "message.part.updated",
    data: {
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
    data: {
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
    // v2 streams text as session.text.delta with { assistantMessageID, ordinal } and no `field`;
    // the projection normalizes it back onto the app's message.part.delta shape.
    manager.handleRuntimeEvent({
      type: "session.text.delta",
      data: {
        sessionID: "sess_active",
        assistantMessageID: "msg_assistant",
        ordinal: 0,
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
    data: { sessionID: "sess_active", status: { type: "retry", attempt: 2, message: "Rate limited" } }
  })
  assert.equal(manager.snapshot().activeSessionStatus.type, "retry")
  assert.equal(manager.snapshot().activity, "running")

  manager.handleRuntimeEvent({ type: "session.idle", data: { sessionID: "sess_active" } })
  assert.deepEqual(manager.snapshot().activeSessionStatus, { type: "idle" })

  manager.handleRuntimeEvent({
    type: "session.error",
    data: { sessionID: "sess_active", error: { data: { message: "Provider failed" } } }
  })
  assert.equal(manager.snapshot().lastError, "Provider failed")

  manager.sessionStatuses.sess_background = { type: "busy" }
  manager.handleRuntimeEvent({
    type: "session.error",
    data: { sessionID: "sess_background", error: { data: { message: "Background failed" } } }
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
    data: { sessionID: "sess_active", status: { type: "busy" } }
  })
  manager.handleRuntimeEvent({
    type: "session.status",
    data: { sessionID: "sess_background", status: { type: "busy" } }
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
  manager.handleRuntimeEvent({ type: "session.idle", data: { sessionID: "sess_background" } })
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
function readyManager(serverUrl, options = {}) {
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/openworking-runtime-hitl",
    emit() {},
    ...options
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

test("createSession clears its in-flight guard after a timeout and allows retry", async () => {
  let calls = 0
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/api/session") return res.end("[]")
    calls += 1
    if (calls === 1) return
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ id: "sess_retry", title: "Retry" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`, { requestTimeoutMs: 30 })
  try {
    await assert.rejects(manager.createSession({ title: "First" }), /Runtime request timed out \(POST \/api\/session\)/)
    assert.equal(manager.createSessionInFlight, null)
    assert.deepEqual(await manager.createSession({ title: "Retry" }), { id: "sess_retry", title: "Retry" })
    assert.equal(calls, 2)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("session export pages through cursors instead of requesting an oversized limit", async () => {
  // 450 messages across the 200-per-page cap: two full pages plus a partial third.
  const all = Array.from({ length: 450 }, (_, index) => ({
    id: `msg_${index}`,
    sessionID: "sess_long",
    type: "assistant",
    content: [{ id: `part_${index}`, sessionID: "sess_long", messageID: `msg_${index}`, type: "text", text: `m${index}` }]
  }))
  const requests = []
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "GET" && req.url === "/api/session/sess_long") {
      return res.end(JSON.stringify({ data: { id: "sess_long", title: "Long session" } }))
    }
    if (req.method === "GET" && req.url.startsWith("/api/session/sess_long/message?")) {
      const params = new URL(req.url, "http://x").searchParams
      const limit = Number(params.get("limit"))
      requests.push({ limit, cursor: params.get("cursor"), order: params.get("order") })
      // Same server-side rule as the real runtime.
      if (limit > 200) {
        return res.writeHead(400).end(JSON.stringify({
          _tag: "InvalidRequestError",
          message: `Expected a value less than or equal to 200, got ${limit}\n  at ["limit"]`,
          kind: "Query"
        }))
      }
      const offset = Number(params.get("cursor") || 0)
      const page = all.slice(offset, offset + limit)
      const nextOffset = offset + page.length
      return res.end(JSON.stringify({
        data: page,
        cursor: { previous: null, next: nextOffset < all.length ? String(nextOffset) : null }
      }))
    }
    res.writeHead(404); res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    const exported = await manager.getSessionExport({ sessionId: "sess_long" })
    assert.equal(exported.info.title, "Long session")
    // Every message survives the paging, in order and without duplicates.
    assert.equal(exported.messages.length, 450)
    assert.deepEqual(exported.messages.map((message) => message.id), all.map((message) => message.id))
    // Three pages: order only on the first, cursor only on the rest, never an oversized limit.
    assert.deepEqual(requests, [
      { limit: 200, cursor: null, order: "asc" },
      { limit: 200, cursor: "200", order: null },
      { limit: 200, cursor: "400", order: null }
    ])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("session export stops paging when the server repeats a cursor", async () => {
  // A server that always returns the same `next` must not spin the export loop forever.
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "GET" && req.url === "/api/session/sess_loop") {
      return res.end(JSON.stringify({ data: { id: "sess_loop", title: "Loop" } }))
    }
    if (req.method === "GET" && req.url.startsWith("/api/session/sess_loop/message?")) {
      return res.end(JSON.stringify({
        data: [{ id: "msg_loop", sessionID: "sess_loop", type: "assistant", content: [] }],
        cursor: { previous: null, next: "stuck" }
      }))
    }
    res.writeHead(404); res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    const exported = await manager.getSessionExport({ sessionId: "sess_loop" })
    // First page, then the repeated cursor is followed once and recognised as a loop.
    assert.equal(exported.messages.length, 2)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("health probing cannot exceed the total startup deadline", async () => {
  const server = http.createServer(() => {})
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`, {
    healthRequestTimeoutMs: 50,
    healthStartupTimeoutMs: 80,
    healthRetryDelayMs: 20
  })
  const startedAt = Date.now()
  try {
    await assert.rejects(
      manager.waitForHealth(`http://127.0.0.1:${server.address().port}`, null),
      /Runtime did not become healthy/
    )
    assert.ok(Date.now() - startedAt < 250)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("reads wait for an in-flight restart instead of throwing 'Runtime is not running'", async () => {
  let served = 0
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "GET" && req.url.startsWith("/api/session/sess_x/message")) {
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

test("reads wait during an actual reload stop-to-start lifecycle", async () => {
  const manager = readyManager("http://127.0.0.1:43123")
  manager.state.project = { id: "proj_1", path: "/tmp/project" }
  const originalRequest = http.request

  let stopCalls = 0
  let openCalls = 0
  let releaseStop
  let requestCount = 0
  manager.stop = async () => {
    stopCalls += 1
    manager.child = null
    manager.state.status = "stopping"
    await new Promise((resolve) => { releaseStop = resolve })
    manager.state.status = "stopped"
    return manager.snapshot()
  }
  manager._openProject = async ({ project }) => {
    openCalls += 1
    manager.state.project = project
    manager.state.status = "running"
    manager.child = {}
    manager.state.runtime = {
      ...manager.state.runtime,
      cwd: project.path
    }
    return manager.snapshot()
  }

  http.request = (options, callback) => {
    requestCount += 1
    const req = new EventEmitter()
    req.write = () => {}
    req.end = () => {
      const response = new EventEmitter()
      response.statusCode = 200
      response.setEncoding = () => {}
      setTimeout(() => {
        callback(response)
        response.emit("data", JSON.stringify([]))
        response.emit("end")
      }, 0)
    }
    req.destroy = () => {}
    return req
  }

  try {
    const reloaded = manager.reload()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(stopCalls, 1)
    assert.equal(openCalls, 0)
    const read = manager.listMessages({ sessionId: "sess_x" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(requestCount, 0)

    releaseStop()
    await Promise.all([reloaded, read])
    assert.equal(openCalls, 1)
    assert.equal(requestCount, 1)
    assert.equal(manager.lifecycle, null)
  } finally {
    http.request = originalRequest
  }
})

test("listMessages forwards a directory query so a cross-project chat can be viewed without a restart", async () => {
  let capturedUrl = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "GET" && req.url.startsWith("/api/session/sess_x/message")) {
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

// v2 inverts the v1 quirk: reply routes ARE session-scoped. Using the old unscoped shape now
// returns a clean 404 instead of v1's silent 200 hang, but the sessionId is required.
test("answerQuestion posts to the session-scoped question reply endpoint", async () => {
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "POST" && /^\/api\/session\/[^/]+\/question\/[^/]+\/reply$/.test(req.url)) {
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
    assert.equal(captured.url, "/api/session/sess_new/question/q1/reply")
    assert.deepEqual(captured.body, { answers: [["yes"]] })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("rejectQuestion posts to the session-scoped question reject endpoint", async () => {
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "POST" && /^\/api\/session\/[^/]+\/question\/[^/]+\/reject$/.test(req.url)) {
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
    assert.equal(captured.url, "/api/session/sess_new/question/q1/reject")
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// This fixture is the shape a real opencode2 actually answers with, captured from a live
// 0.0.0-next-17055 running two local MCP servers (one healthy, one with a missing binary):
//   { location: {...}, data: [ { name, status: { status, error? } } ] }
// The previous fixture here was a bare flat map, which the runtime never sends — so the
// envelope was fed straight to Object.entries() and every caller saw two fake servers named
// "location" and "data" with status "unknown", and real MCP status never reached the UI.
test("listMcpStatus unwraps the v2 envelope and the nested status object", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/api/mcp" && req.method === "GET") {
      return res.end(JSON.stringify({
        location: { directory: "/tmp/project", project: { id: "global" } },
        data: [
          { name: "broken", status: { status: "failed", error: "Executable not found in $PATH" }, secret: "drop" },
          { name: "good", status: { status: "connected" } }
        ]
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
      { name: "broken", status: "failed", error: "Executable not found in $PATH" },
      { name: "good", status: "connected" }
    ])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// applyMcpConfig() registers a newly added MCP server without restarting the runtime. It polls
// /api/mcp until the server shows up, so a slow first answer must not trigger a needless restart.
test("applyMcpConfig returns without reloading once the added server appears", async () => {
  let polls = 0
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/api/mcp" && req.method === "GET") {
      polls += 1
      // Empty on the first poll, then present — the runtime settles asynchronously.
      const data = polls < 2 ? [] : [{ name: "slack", status: { status: "pending" } }]
      return res.end(JSON.stringify({ location: {}, data }))
    }
    res.writeHead(404)
    res.end("{}")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  manager.state.project = { id: "p1", path: "/tmp/p1" }
  let reloaded = false
  manager.reload = async () => { reloaded = true }
  try {
    await manager.applyMcpConfig({ expect: ["slack"], timeoutMs: 4000 })
    assert.equal(reloaded, false, "must not restart when the server registers")
    assert.ok(polls >= 2, "must keep polling past an empty first answer")
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// The dangerous failure is silent: the server never registers and the user is left with a connector
// that does nothing. Falling back to a full restart is what makes that safe.
test("applyMcpConfig falls back to reload when the server never appears", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/api/mcp" && req.method === "GET") {
      return res.end(JSON.stringify({ location: {}, data: [] }))
    }
    res.writeHead(404)
    res.end("{}")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  manager.state.project = { id: "p1", path: "/tmp/p1" }
  let reloaded = false
  manager.reload = async () => { reloaded = true }
  try {
    await manager.applyMcpConfig({ expect: ["slack"], timeoutMs: 600 })
    assert.equal(reloaded, true, "must restart rather than silently do nothing")
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// Escape hatch for a release where hot-reload misbehaves in the field.
test("applyMcpConfig always reloads when OPENWORKING_FORCE_RUNTIME_RELOAD=1", async () => {
  const manager = readyManager("http://127.0.0.1:1")
  manager.state.project = { id: "p1", path: "/tmp/p1" }
  let reloaded = false
  manager.reload = async () => { reloaded = true }
  const previous = process.env.OPENWORKING_FORCE_RUNTIME_RELOAD
  process.env.OPENWORKING_FORCE_RUNTIME_RELOAD = "1"
  try {
    await manager.applyMcpConfig({ expect: ["slack"] })
    assert.equal(reloaded, true)
  } finally {
    if (previous === undefined) delete process.env.OPENWORKING_FORCE_RUNTIME_RELOAD
    else process.env.OPENWORKING_FORCE_RUNTIME_RELOAD = previous
  }
})

// Keep the flat name -> status map working: it is what the app's own tests and any older
// runtime answer with, and the unwrap must not regress it.
test("listMcpStatus still projects a flat status map", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/api/mcp" && req.method === "GET") {
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
    if (req.url === "/api/mcp/slack/auth" && req.method === "POST") {
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
      url: "/api/mcp/slack/auth",
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
    if (req.url === "/api/mcp/slack/auth/authenticate" && req.method === "POST") {
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
    assert.equal(captured.url, "/api/mcp/slack/auth/authenticate")
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// Writes a minimal opencode.json into a fresh temp dir and returns its path. `backlog` controls
// whether an mcp.backlog entry is present and its `enabled` flag.
function writeBacklogConfig({ backlog }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-warmup-"))
  const config = {}
  if (backlog !== "absent") {
    config.mcp = { backlog: { type: "local", command: ["node", "x"], enabled: backlog === "enabled" } }
  }
  const configPath = path.join(dir, "opencode.json")
  fs.writeFileSync(configPath, JSON.stringify(config))
  return configPath
}

test("warmUpBacklogMcp connects the Backlog server when the connector is enabled", async () => {
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/api/mcp/backlog/connect" && req.method === "POST") {
      captured = { url: req.url, authorization: req.headers.authorization }
      return res.end(JSON.stringify({ status: "connected" }))
    }
    res.writeHead(404)
    res.end(JSON.stringify({ error: "not found" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const configPath = writeBacklogConfig({ backlog: "enabled" })
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`, { profile: { configPath } })
  try {
    await manager.connectMcp("backlog") // direct call exercises the same path warmUp uses
    assert.equal(captured.url, "/api/mcp/backlog/connect")
    assert.equal(captured.authorization, `Basic ${Buffer.from("opencode:pw").toString("base64")}`)

    // Fire-and-forget: warmUpBacklogMcp returns void, so wait for the request to land.
    captured = null
    manager.warmUpBacklogMcp()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(captured?.url, "/api/mcp/backlog/connect")
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(path.dirname(configPath), { recursive: true, force: true })
  }
})

test("warmUpBacklogMcp is a no-op when Backlog is disabled or unconfigured", async () => {
  for (const backlog of ["disabled", "absent"]) {
    let hit = false
    const server = http.createServer((req, res) => {
      if (req.url === "/api/mcp/backlog/connect") hit = true
      res.writeHead(404)
      res.end()
    })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    const configPath = writeBacklogConfig({ backlog })
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`, { profile: { configPath } })
    try {
      assert.equal(manager.backlogConnectorEnabled(), false, `expected disabled for ${backlog}`)
      manager.warmUpBacklogMcp()
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(hit, false, `expected no connect request for ${backlog}`)
    } finally {
      await new Promise((resolve) => server.close(resolve))
      fs.rmSync(path.dirname(configPath), { recursive: true, force: true })
    }
  }
})

test("warmUpBacklogMcp swallows a failing connect and logs a warning", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500)
    res.end(JSON.stringify({ error: "boom" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const configPath = writeBacklogConfig({ backlog: "enabled" })
  const logs = []
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`, { profile: { configPath } })
  const originalLog = manager.log.bind(manager)
  manager.log = (level, message, ...rest) => {
    logs.push({ level, message })
    return originalLog(level, message, ...rest)
  }
  try {
    // Must not throw or produce an unhandled rejection.
    assert.equal(manager.warmUpBacklogMcp(), undefined)
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok(logs.some((entry) => entry.level === "warn" && /Backlog MCP warm-up skipped/.test(entry.message)))
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(path.dirname(configPath), { recursive: true, force: true })
  }
})

// v2 collapses v1's four mcp.status.* event names into a single `mcp.status.changed` carrying
// the server in the payload. The renderer matches on the `mcp.` prefix and reads `name`/`status`,
// so the projection must keep producing that shape.
test("mcp status events project to a whitelisted name + status shape", () => {
  assert.deepEqual(projectRuntimeEvent({
    type: "mcp.status.changed",
    data: { server: "slack", status: "needs_auth", secret: "drop" }
  }), { type: "mcp.status.changed", name: "slack", status: "needs_auth" })

  assert.deepEqual(projectRuntimeEvent({
    type: "mcp.status.changed",
    data: { server: "slack", status: "connected" }
  }), { type: "mcp.status.changed", name: "slack", status: "connected" })

  // The status field is optional on the wire; the name alone is enough to project.
  assert.deepEqual(projectRuntimeEvent({
    type: "mcp.status.changed",
    data: { server: "slack" }
  }), { type: "mcp.status.changed", name: "slack" })

  assert.equal(projectRuntimeEvent({ type: "mcp.status.changed", data: {} }), null)
  // The v1 names no longer exist and must be dropped rather than half-projected.
  assert.equal(projectRuntimeEvent({ type: "mcp.status.connected", data: { name: "slack" } }), null)
})

test("replyPermission posts to the session-scoped permission reply endpoint", async () => {
  // OpenCode v1.17 serves the reply at /permission/{requestID}/reply. The old session-scoped
  // path (/session/{id}/permission/{id}/reply) does not exist and is silently swallowed by the
  // web UI fallback (HTTP 200 HTML), which left tools stuck "Processing" after approval.
  let captured = null
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "POST" && /^\/api\/session\/[^/]+\/permission\/[^/]+\/reply$/.test(req.url)) {
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
    const outcome = await manager.replyPermission({ sessionId: "sess_new", requestID: "p1", reply: "reject", message: "no" })
    assert.equal(captured.url, "/api/session/sess_new/permission/p1/reply")
    assert.deepEqual(captured.body, { reply: "reject", message: "no" })
    assert.equal(outcome.ok, true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// --- VCS Changes panel ------------------------------------------------------------------------
// Spins a real server replying with the payload shapes captured from a live opencode2
// (.agents/evidence/v2-openapi-0.0.0-next-16350.json + a manual probe against `opencode2 serve`).
async function withVcsServer(handler, run) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-vcs-"))
  const manager = new RuntimeProcessManager({
    userDataPath: temp,
    profile: { profileDir: temp, configPath: path.join(temp, "opencode.json") },
    emit() {}
  })
  manager.child = {}
  manager.state.status = "running"
  manager.state.runtime = {
    serverUrl: `http://127.0.0.1:${port}`,
    cwd: "/project",
    auth: { username: "user", password: "pass" }
  }
  try {
    return await run(manager)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

const vcsLocation = { directory: "/project", project: { id: "p", directory: "/project" } }

test("vcsStatus projects only whitelisted fields and asks for the requested worktree", async () => {
  let requestedUrl = ""
  await withVcsServer(
    (req, res) => {
      requestedUrl = req.url
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({
        location: vcsLocation,
        data: [
          { file: "added.txt", additions: 2, deletions: 0, status: "added", absolutePath: "/secret/added.txt" },
          { file: "gone.txt", additions: 0, deletions: 5, status: "deleted" },
          // Malformed rows must be dropped or clamped rather than reaching the renderer as-is.
          { file: "", additions: 1, deletions: 1, status: "modified" },
          { file: "odd.txt", additions: -4, deletions: null, status: "bogus" }
        ]
      }))
    },
    async (manager) => {
      const result = await manager.vcsStatus("/worktree/feature")
      assert.deepEqual(result.files, [
        { file: "added.txt", status: "added", additions: 2, deletions: 0 },
        { file: "gone.txt", status: "deleted", additions: 0, deletions: 5 },
        { file: "odd.txt", status: "modified", additions: 0, deletions: 0 }
      ])
      assert.equal(result.truncated, false)
      // The requested directory - not the runtime's cwd - is what the server is asked about, and
      // it must use the deepObject form (a flat `directory=` is silently ignored by the server).
      assert.match(decodeURIComponent(requestedUrl), /location\[directory\]=\/worktree\/feature/)
      assert.equal(/[?&]directory=/.test(requestedUrl), false)
    }
  )
})

test("vcsStatus caps a huge file list before it reaches the renderer", async () => {
  await withVcsServer(
    (req, res) => {
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({
        location: vcsLocation,
        data: Array.from({ length: 5000 }, (_, index) => ({
          file: `file-${index}.txt`, additions: 1, deletions: 0, status: "modified"
        }))
      }))
    },
    async (manager) => {
      const result = await manager.vcsStatus("/project")
      assert.equal(result.files.length, 2000)
      assert.equal(result.truncated, true)
    }
  )
})

test("vcsDiff truncates an oversized patch and flags it", async () => {
  const hugePatch = "diff --git a/big.txt b/big.txt\n" + "+line\n".repeat(120000)
  await withVcsServer(
    (req, res) => {
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({
        location: vcsLocation,
        data: [
          { file: "small.txt", patch: "diff --git a/small.txt b/small.txt\n+hi\n", additions: 1, deletions: 0, status: "modified" },
          { file: "big.txt", patch: hugePatch, additions: 120000, deletions: 0, status: "modified" }
        ]
      }))
    },
    async (manager) => {
      const big = await manager.vcsDiff("/project", { file: "big.txt" })
      assert.equal(big.truncated, true)
      assert.equal(big.patch.length, 200000)
      assert.ok(hugePatch.startsWith(big.patch))

      const small = await manager.vcsDiff("/project", { file: "small.txt" })
      assert.equal(small.truncated, false)
      assert.match(small.patch, /^diff --git/)

      // A file with no entry in the response resolves to null rather than another file's patch.
      assert.equal(await manager.vcsDiff("/project", { file: "absent.txt" }), null)
    }
  )
})

test("vcsDiff requests the working mode and a per-file patch", async () => {
  const urls = []
  await withVcsServer(
    (req, res) => {
      urls.push(req.url)
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ location: vcsLocation, data: [] }))
    },
    async (manager) => {
      await manager.vcsDiff("/project", { file: "a.txt" })
      assert.match(urls[0], /mode=working/)
    }
  )
})

test("vcsStatus and vcsDiff no-op without a directory or file", async () => {
  let called = false
  await withVcsServer(
    (req, res) => {
      called = true
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ location: vcsLocation, data: [] }))
    },
    async (manager) => {
      assert.deepEqual(await manager.vcsStatus(""), { files: [], truncated: false })
      assert.equal(await manager.vcsDiff("/project", { file: "" }), null)
      assert.equal(await manager.vcsDiff("", { file: "a.txt" }), null)
      assert.equal(called, false)
    }
  )
})

test("projectReferenceInfo forwards safe fields and drops an entry with no name", () => {
  assert.deepEqual(
    projectReferenceInfo({ name: "readme", path: "/project/README.md", description: "project readme", hidden: false, source: { type: "local", path: "/project/README.md" } }),
    { name: "readme", path: "/project/README.md", description: "project readme", hidden: false, source: { type: "local", path: "/project/README.md" } }
  )
  assert.equal(projectReferenceInfo({ path: "/no/name" }), null)
  assert.equal(projectReferenceInfo(null), null)
})

test("listReferences requests the deepObject location[directory] and projects only safe fields", async () => {
  let requestedUrl = ""
  const server = http.createServer((req, res) => {
    requestedUrl = req.url
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({
      location: { directory: "/project" },
      data: [
        { name: "readme", path: "/project/README.md", description: "project readme", hidden: false, source: { type: "local", path: "/project/README.md" } },
        { name: "upstream", description: "upstream repo", source: { type: "git", repository: "https://example.com/repo.git", branch: "main" } },
        // Malformed row (no name) must be dropped rather than reaching the renderer as-is.
        { path: "/should/be/dropped" }
      ]
    }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
    const result = await manager.listReferences("/project")
    assert.deepEqual(result, [
      { name: "readme", path: "/project/README.md", description: "project readme", hidden: false, source: { type: "local", path: "/project/README.md" } },
      { name: "upstream", path: "", description: "upstream repo", hidden: false, source: { type: "git", repository: "https://example.com/repo.git", branch: "main" } }
    ])
    // Same deepObject form as vcsStatus/vcsDiff — a flat `directory=` is silently ignored by the server.
    assert.match(decodeURIComponent(requestedUrl), /location\[directory\]=\/project/)
  } finally {
    server.close()
  }
})

test("projectPtyInfo forwards safe fields, defaults status to running, and drops an entry with no id", () => {
  assert.deepEqual(
    projectPtyInfo({ id: "pty_abc", title: "shell", command: "/bin/sh", args: ["-c", "echo hi"], cwd: "/project", status: "running", pid: 123 }),
    { id: "pty_abc", title: "shell", command: "/bin/sh", args: ["-c", "echo hi"], cwd: "/project", status: "running", pid: 123, exitCode: null }
  )
  assert.deepEqual(
    projectPtyInfo({ id: "pty_done", title: "shell", command: "/bin/sh", args: [], cwd: "/project", status: "exited", pid: 123, exitCode: 7 }),
    { id: "pty_done", title: "shell", command: "/bin/sh", args: [], cwd: "/project", status: "exited", pid: 123, exitCode: 7 }
  )
  assert.equal(projectPtyInfo({ title: "no id" }), null)
  assert.equal(projectPtyInfo(null), null)
})

test("createPty/listPtys/getPty/resizePty/removePty request the deepObject location[directory] and project only safe fields", async () => {
  const requests = []
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => { raw += chunk })
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null })
      res.setHeader("Content-Type", "application/json")
      if (req.method === "DELETE") { res.statusCode = 204; res.end(); return }
      if (req.method === "GET" && req.url.startsWith("/api/pty?")) {
        res.end(JSON.stringify({ location: { directory: "/project" }, data: [{ id: "pty_1", title: "t", command: "/bin/sh", args: [], cwd: "/project", status: "running", pid: 1 }, { title: "dropped" }] }))
        return
      }
      res.end(JSON.stringify({
        location: { directory: "/project" },
        data: { id: "pty_1", title: "t", command: "/bin/sh", args: ["-c", "x"], cwd: "/project", status: "running", pid: 42 }
      }))
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`)

    const created = await manager.createPty("/project", { command: "/bin/sh", args: ["-c", "x"], title: "t" })
    assert.deepEqual(created, { id: "pty_1", title: "t", command: "/bin/sh", args: ["-c", "x"], cwd: "/project", status: "running", pid: 42, exitCode: null })
    assert.equal(requests[0].method, "POST")
    assert.match(decodeURIComponent(requests[0].url), /location\[directory\]=\/project/)
    assert.deepEqual(requests[0].body, { command: "/bin/sh", args: ["-c", "x"], title: "t" })

    const listed = await manager.listPtys("/project")
    assert.deepEqual(listed, [{ id: "pty_1", title: "t", command: "/bin/sh", args: [], cwd: "/project", status: "running", pid: 1, exitCode: null }])

    const fetched = await manager.getPty("pty_1", "/project")
    assert.equal(fetched.id, "pty_1")
    assert.match(requests[2].url, /\/api\/pty\/pty_1\?/)

    const resized = await manager.resizePty("pty_1", "/project", { rows: 40, cols: 120 })
    assert.equal(requests[3].method, "PUT")
    assert.deepEqual(requests[3].body, { size: { rows: 40, cols: 120 } })
    assert.ok(resized)

    await manager.removePty("pty_1", "/project")
    assert.equal(requests[4].method, "DELETE")
  } finally {
    server.close()
  }
})

// A real ws.Server, not a mock — the manager's connectPty() is the only thing in this app that
// speaks WebSocket, so the transport itself is worth exercising for real.
function withPtyWebSocketServer(onConnection, testFn) {
  return new Promise((resolvePromise, rejectPromise) => {
    const wss = new WebSocket.Server({ port: 0, host: "127.0.0.1" }, async () => {
      wss.on("connection", onConnection)
      try {
        await testFn(wss.address().port)
        resolvePromise()
      } catch (error) {
        rejectPromise(error)
      } finally {
        wss.close()
      }
    })
  })
}

test("connectPty authenticates the handshake with Basic auth and relays text frames as pty.data, dropping binary frames", async () => {
  let capturedAuth = null
  await withPtyWebSocketServer(
    (socket, req) => {
      capturedAuth = req.headers.authorization
      socket.send("hello from pty")
      socket.send(Buffer.from([0x00, 0x7b, 0x7d]), { binary: true })
    },
    async (port) => {
      const emitted = []
      const manager = readyManager(`http://127.0.0.1:${port}`, { emit: (channel, payload) => emitted.push({ channel, payload }) })
      manager.connectPty("pty_1", "/project")
      await new Promise((resolve) => setTimeout(resolve, 200))
      manager.closeAllPtyConnections()

      assert.equal(capturedAuth, "Basic b3BlbmNvZGU6cHc=") // opencode:pw, matching readyManager's fixture auth
      const stream = emitted.filter((event) => event.channel === "runtime:stream").map((event) => event.payload)
      assert.deepEqual(stream[0], { type: "pty.connected", ptyId: "pty_1" })
      assert.deepEqual(stream[1], { type: "pty.data", ptyId: "pty_1", data: "hello from pty" })
      // The binary checkpoint frame must never surface as pty.data — only text frames do.
      assert.equal(stream.some((event) => event.type === "pty.data" && event.data !== "hello from pty"), false)
    }
  )
})

test("connectPty distinguishes a clean shell exit (close code 4404) from a real connection loss", async () => {
  await withPtyWebSocketServer(
    (socket) => { socket.close(4404, "session exited") },
    async (port) => {
      const emitted = []
      const manager = readyManager(`http://127.0.0.1:${port}`, { emit: (channel, payload) => emitted.push({ channel, payload }) })
      manager.connectPty("pty_exit", "/project")
      await new Promise((resolve) => setTimeout(resolve, 200))

      const disconnected = emitted.find((event) => event.payload?.type === "pty.disconnected")
      assert.deepEqual(disconnected.payload, { type: "pty.disconnected", ptyId: "pty_exit", exited: true, code: 4404, reason: "session exited" })
    }
  )
})

test("connectPty's write() only sends once the socket is open, and close() tears the connection down", async () => {
  const receivedFromClient = []
  await withPtyWebSocketServer(
    (socket) => { socket.on("message", (data) => receivedFromClient.push(data.toString())) },
    async (port) => {
      const manager = readyManager(`http://127.0.0.1:${port}`, { emit() {} })
      const handle = manager.connectPty("pty_write", "/project")
      // Fires before the WS is open — must be a silent no-op, not a throw.
      handle.write("too-early")
      await new Promise((resolve) => setTimeout(resolve, 200))
      handle.write("hello-server")
      await new Promise((resolve) => setTimeout(resolve, 200))
      handle.close()

      assert.deepEqual(receivedFromClient, ["hello-server"])
      assert.equal(manager.ptyConnections.has("pty_write"), false)
    }
  )
})

// writePty/disconnectPty look ptyId up in this.ptyConnections directly, rather than requiring the
// caller (main.js's pty:write/pty:disconnect IPC handlers) to hold connectPty()'s return value —
// avoids a second, parallel piece of bookkeeping in main.js that could drift from the manager's
// own (already-correct) connection tracking.
test("writePty/disconnectPty look up the connection by ptyId instead of needing the connectPty() return value", async () => {
  const receivedFromClient = []
  await withPtyWebSocketServer(
    (socket) => { socket.on("message", (data) => receivedFromClient.push(data.toString())) },
    async (port) => {
      const manager = readyManager(`http://127.0.0.1:${port}`, { emit() {} })
      manager.connectPty("pty_lookup", "/project") // return value intentionally discarded
      await new Promise((resolve) => setTimeout(resolve, 200))

      manager.writePty("pty_lookup", "via-lookup")
      await new Promise((resolve) => setTimeout(resolve, 200))
      assert.deepEqual(receivedFromClient, ["via-lookup"])

      // Writing to a ptyId with no open connection is a silent no-op, not a throw.
      manager.writePty("pty_never_connected", "ignored")

      manager.disconnectPty("pty_lookup")
      assert.equal(manager.ptyConnections.has("pty_lookup"), false)
    }
  )
})

test("closeAllPtyConnections closes every tracked pty websocket (what stop() and the runtime-exit handler both call)", async () => {
  const serverSockets = []
  await withPtyWebSocketServer(
    (socket) => serverSockets.push(socket),
    async (port) => {
      const manager = readyManager(`http://127.0.0.1:${port}`, { emit() {} })
      manager.connectPty("pty_a", "/project")
      manager.connectPty("pty_b", "/project")
      await new Promise((resolve) => setTimeout(resolve, 200))
      assert.equal(manager.ptyConnections.size, 2)

      manager.closeAllPtyConnections()

      assert.equal(manager.ptyConnections.size, 0)
    }
  )
})

// The property this task actually needs proven: cleanup must not be reachable ONLY through
// manager.stop() — an external kill of the runtime process (crash, force-quit, anything that
// doesn't go through stop()) must still close tracked PTY sockets, because Node's child "exit"
// event fires regardless of what caused the exit. closeAllPtyConnections() is called from BOTH
// stop() and the child "exit" handler (see process-manager.js) specifically so there is no
// bypass; this test kills the real child directly, never calling stop(), to prove the exit
// handler alone is enough.
test("killing the runtime process directly (bypassing stop()) still clears tracked PTY connections via the exit handler", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-pty-lifecycle-"))
  const projectPath = path.join(temp, "project")
  fs.mkdirSync(projectPath)
  let fakeRuntimePath = path.join(temp, "fake-opencode.js")
  fs.writeFileSync(fakeRuntimePath, `#!/usr/bin/env node
const http = require("node:http")
if (process.argv[2] === "db") {
  process.stdout.write("[]")
  process.exit(0)
}
const port = Number(process.argv[process.argv.indexOf("--port") + 1])
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json")
  if (req.url === "/api/health") return res.end(JSON.stringify({ healthy: true }))
  res.writeHead(404)
  res.end(JSON.stringify({ error: "not found" }))
})
server.listen(port, "127.0.0.1")
`)
  fakeRuntimePath = finalizeFakeRuntime(fakeRuntimePath)

  const previousRuntimeBin = process.env.OPENWORKING_RUNTIME_BIN
  process.env.OPENWORKING_RUNTIME_BIN = fakeRuntimePath
  const manager = new RuntimeProcessManager({
    userDataPath: path.join(temp, "user-data"),
    profile: { profileDir: path.join(temp, "profile"), configPath: path.join(temp, "profile", "opencode.json") },
    emit() {}
  })

  try {
    await manager.openProject({ project: { id: "proj_lifecycle", name: "Lifecycle", path: projectPath } })
    // The fake runtime has no real PTY WebSocket endpoint — irrelevant here, since
    // ptyConnections is populated synchronously by connectPty() before the handshake resolves.
    manager.connectPty("pty_orphan_check", projectPath)
    assert.equal(manager.ptyConnections.size, 1)

    const exitPromise = manager.exitPromise
    manager.child.kill("SIGKILL") // bypasses stop() entirely
    await exitPromise

    assert.equal(manager.ptyConnections.size, 0, "the exit handler must clear tracked PTY connections even when stop() was never called")
  } finally {
    await manager.stop()
    if (previousRuntimeBin === undefined) delete process.env.OPENWORKING_RUNTIME_BIN
    else process.env.OPENWORKING_RUNTIME_BIN = previousRuntimeBin
    delete process.env.OPENWORKING_RUNTIME_SCRIPT
  }
})

// A permission the runtime has forgotten (restart, session abort, a rejected sibling) answers
// with 404 PermissionNotFoundError. That is an expected outcome, not a failure: it must resolve
// so the renderer can retire the card, instead of throwing an Error whose message carried the
// raw HTTP/JSON body through IPC and into a toast.
test("replyPermission reports an expired request instead of throwing the raw 404", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    res.writeHead(404)
    res.end(JSON.stringify({
      _tag: "PermissionNotFoundError",
      requestID: "per_gone",
      message: "Permission request not found: per_gone"
    }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    const outcome = await manager.replyPermission({ sessionId: "sess_new", requestID: "per_gone", reply: "once" })
    assert.deepEqual(outcome, { ok: false, reason: "expired" })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("answerQuestion and rejectQuestion report an expired request the same way", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    res.writeHead(404)
    res.end(JSON.stringify({ _tag: "QuestionNotFoundError", requestID: "q_gone", message: "Question request not found: q_gone" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    assert.deepEqual(
      await manager.answerQuestion({ sessionId: "sess_new", requestID: "q_gone", answers: [["yes"]] }),
      { ok: false, reason: "expired" }
    )
    assert.deepEqual(
      await manager.rejectQuestion({ sessionId: "sess_new", requestID: "q_gone" }),
      { ok: false, reason: "expired" }
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// Only a stale-request 404 is swallowed. A real server failure must still surface.
test("replyPermission still throws on non-404 failures", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500)
    res.end(JSON.stringify({ error: "boom" }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    await assert.rejects(
      () => manager.replyPermission({ sessionId: "sess_new", requestID: "p1", reply: "once" }),
      /HTTP 500/
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("listPendingPermissions reads GET /permission and normalizes id to requestID", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.method === "GET" && req.url === "/permission") {
      // The list endpoint returns Info objects keyed by `id`, not `requestID`.
      res.end(JSON.stringify([
        { id: "per_live", sessionID: "sess_new", permission: "bash", metadata: { command: "ls" } },
        { id: "per_nosession" },
        { sessionID: "sess_new" }
      ]))
      return
    }
    res.writeHead(404)
    res.end("{}")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    const pending = await manager.listPendingPermissions()
    // Entries missing an id or a sessionID cannot be matched to a card, so they are dropped.
    assert.equal(pending.length, 1)
    assert.equal(pending[0].requestID, "per_live")
    assert.equal(pending[0].sessionID, "sess_new")
    assert.equal(pending[0].permission, "bash")
    assert.deepEqual(pending[0].details, [{ key: "command", value: "ls" }])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// A failed lookup must be distinguishable from "nothing is pending" — the renderer evicts cards
// based on this list, and treating an error as an empty list would delete live cards.
test("listPendingPermissions returns null when the lookup fails", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500)
    res.end("{}")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
  try {
    assert.equal(await manager.listPendingPermissions(), null)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// A 200 carrying a body catalogItems() cannot read (an unknown envelope, or the HTML fallback a
// wrong URL silently returns) would flatten to `[]` — which the renderer treats as authoritative
// evidence that nothing is pending, and uses to evict every live card. It must be null instead.
test("listPendingPermissions returns null for a 200 with an unrecognised payload shape", async () => {
  for (const body of ['{"permissions":[{"id":"per_live","sessionID":"s1"}]}', '"<html>ok</html>"', "123"]) {
    const server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json")
      res.end(body)
    })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
    try {
      assert.equal(await manager.listPendingPermissions(), null, `should not evict on body: ${body}`)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

// The two shapes catalogItems() genuinely understands must still read as an authoritative empty
// list, otherwise expired cards would never be swept.
test("listPendingPermissions returns [] for a real empty list in either envelope", async () => {
  for (const body of ["[]", '{"data":[]}']) {
    const server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json")
      res.end(body)
    })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
    try {
      assert.deepEqual(await manager.listPendingPermissions(), [], `should be authoritative for: ${body}`)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }
})

test("listPendingQuestions returns null when the runtime is not running", async () => {
  const manager = readyManager("http://127.0.0.1:1")
  manager.state.status = "stopped"
  assert.equal(await manager.listPendingQuestions(), null)
})

// The permission hint text is shared with the renderer via src/error-hints.js, which carries no
// leading newline. launchErrorMessage concatenates it into a log line, so the separator must
// still be added here.
test("launchErrorMessage separates the permission hint from the message with a newline", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-hint-"))
  try {
    const manager = new RuntimeProcessManager({ userDataPath: temp, profile: { profileDir: temp, configPath: path.join(temp, "opencode.json") }, emit() {} })
    const message = manager.launchErrorMessage("spawn opencode EACCES")
    assert.match(message, /^spawn opencode EACCES\nmacOS may be blocking access/)

    assert.equal(manager.launchErrorMessage("runtime did not become healthy"), "runtime did not become healthy")
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
})
