const test = require("node:test")
const assert = require("node:assert/strict")
const {
  addOptimisticUser,
  applyThreadEvent,
  clearPendingPermission,
  clearPendingQuestion,
  createThreadStream,
  fileRefsFromBacktickPaths,
  hasRunningTool,
  hydrateThread,
  messageCopyText,
  needsThreadRehydration,
  userMessageFileRefs,
  messageText,
  removeOptimisticUser,
  threadIsBusy
} = require("../src/thread-stream")

function officeContextText(prompt = "Hãy dịch file này sang tiếng Việt") {
  return [
    prompt,
    "Attached document files are provided as local paths plus extracted text context when available because the configured gateway accepts text/images, not raw document binaries.",
    "If the user asks to translate a DOCX, Markdown, PDF, PPTX, or XLSX file, call the translate_document tool with the exact local inputPath. Do not use shell/write scripts for translation artifacts. Do not claim an output path unless it is returned in translate_document metadata.artifacts.",
    "Attached files (local paths):\n- /tmp/事業推進QA対応.xlsx",
    "Extracted Office context:\n## XLSX attachment: 事業推進QA対応.xlsx\n\nPath: /tmp/事業推進QA対応.xlsx\n\nSheet: QA\n確認事項"
  ].join("\n\n")
}

test("thread stream builds copyable message text without tool activity", () => {
  assert.equal(messageCopyText({
    role: "user",
    parts: [{ type: "text", text: "Inspect the project" }]
  }), "Inspect the project")

  assert.equal(messageCopyText({
    role: "user",
    parts: [
      { type: "file", filename: "draft.pdf" },
      { type: "file", filename: "diagram.png" },
      { type: "text", text: "Review the files" }
    ]
  }), "@draft.pdf\n@diagram.png\nReview the files")

  assert.equal(messageCopyText({
    role: "user",
    parts: [{ type: "file", filename: "draft.pdf" }]
  }), "@draft.pdf")

  assert.equal(messageCopyText({
    role: "assistant",
    parts: [
      { type: "text", text: "First paragraph" },
      { type: "tool", tool: "read" },
      { type: "text", text: "Second paragraph" }
    ]
  }), "First paragraph\n\nSecond paragraph")

  assert.equal(messageCopyText({
    role: "assistant",
    parts: [{ type: "tool", tool: "read" }]
  }), "")
})

test("thread stream hydrates text and tool parts", () => {
  const thread = createThreadStream()
  hydrateThread(thread, "sess_one", [
    {
      info: { id: "msg_user", role: "user" },
      parts: [{ id: "part_user", type: "text", text: "Inspect the project" }]
    },
    {
      info: { id: "msg_assistant", role: "assistant" },
      parts: [{
        id: "part_tool",
        messageID: "msg_assistant",
        type: "tool",
        tool: "read",
        state: { status: "completed", input: { filePath: "src/index.js" }, output: "large output" }
      }]
    }
  ])

  assert.equal(thread.sessionId, "sess_one")
  assert.equal(messageText(thread.messages[0]), "Inspect the project")
  assert.deepEqual(thread.messages[1].parts[0], {
    id: "part_tool",
    sessionID: undefined,
    messageID: "msg_assistant",
    type: "tool",
    tool: "read",
    state: {
      status: "completed",
      input: { filePath: "src/index.js" },
      title: undefined,
      error: undefined
    }
  })
})

test("thread stream keeps safe file metadata for hydrated and optimistic user messages", () => {
  const thread = createThreadStream("sess_one")
  const optimisticId = addOptimisticUser(thread, "Review the files", [
    { filename: "draft.pdf", mime: "application/pdf" }
  ])

  assert.deepEqual(thread.messages[0].parts[0], {
    id: `${optimisticId}_file_0`,
    messageID: optimisticId,
    type: "file",
    filename: "draft.pdf",
    mime: "application/pdf"
  })

  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [
      { id: "part_file", messageID: "msg_user", type: "file", filename: "draft.pdf", mime: "application/pdf", url: "file:///private/draft.pdf" },
      { id: "part_text", messageID: "msg_user", type: "text", text: "Review the files" }
    ]
  }])

  assert.equal(thread.messages.length, 1)
  assert.deepEqual(thread.messages[0].parts[0], {
    id: "part_file",
    sessionID: undefined,
    messageID: "msg_user",
    type: "file",
    filename: "draft.pdf",
    mime: "application/pdf"
  })
  assert.equal("url" in thread.messages[0].parts[0], false)

  const retryId = addOptimisticUser(thread, "Retry", [])
  removeOptimisticUser(thread, retryId)
  assert.equal(thread.messages.some((message) => message.id === retryId), false)
})

test("thread stream keeps optimistic file-ref chips while deduping against the effective prompt text", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "Hãy đọc cho tôi file @api.py", [], {
    fileRefs: [{ token: "@api.py", path: "src/api.py", name: "api.py" }],
    signatureText: "Hãy đọc cho tôi file `src/api.py`"
  })

  assert.deepEqual(thread.messages[0].parts[0], {
    id: `${thread.messages[0].id}_ref_0`,
    messageID: thread.messages[0].id,
    type: "file-ref",
    token: "@api.py",
    path: "src/api.py",
    name: "api.py"
  })
  assert.equal(messageText(thread.messages[0]), "Hãy đọc cho tôi file @api.py")
  assert.equal(messageCopyText(thread.messages[0]), "Hãy đọc cho tôi file @api.py")

  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [
      { id: "part_text", messageID: "msg_user", type: "text", text: "Hãy đọc cho tôi file `src/api.py`" }
    ]
  }])

  assert.equal(thread.messages.length, 1)
  assert.equal(thread.messages[0].id, "msg_user")
  assert.equal(messageText(thread.messages[0]), "Hãy đọc cho tôi file @api.py")
  assert.equal(thread.messages[0].parts.some((part) => part.type === "file-ref"), true)
  assert.equal(thread.messages[0].parts.find((part) => part.type === "text")?.id, "part_text")
  assert.equal(thread.messages[0].parts.find((part) => part.type === "text")?.text, "Hãy đọc cho tôi file `src/api.py`")
})

test("messageText derives @file display tokens from backtick paths when file-ref parts are missing", () => {
  const thread = createThreadStream("sess_one")
  thread.messages.push({
    id: "msg_user",
    role: "user",
    parts: [{
      id: "part_text",
      messageID: "msg_user",
      type: "text",
      text: "đọc `app/api/api_v1/endpoints/health_check.py` cho tôi"
    }]
  })

  assert.deepEqual(userMessageFileRefs(thread.messages[0]), [{
    token: "@health_check.py",
    path: "app/api/api_v1/endpoints/health_check.py",
    name: "health_check.py"
  }])
  assert.equal(messageText(thread.messages[0]), "đọc @health_check.py cho tôi")
  assert.equal(messageCopyText(thread.messages[0]), "đọc @health_check.py cho tôi")
})

test("fileRefsFromBacktickPaths ignores prose backticks without a viewable file path", () => {
  assert.deepEqual(fileRefsFromBacktickPaths("run `npm run build` now"), [])
  assert.deepEqual(fileRefsFromBacktickPaths("use `some command` here"), [])
})

test("fileRefsFromBacktickPaths only accepts known project files when an index is provided", () => {
  const files = ["app/api/api_v1/endpoints/health_check.py", "foo/README.md", "bar/README.md"]
  assert.deepEqual(
    fileRefsFromBacktickPaths("see `app/api/api_v1/endpoints/health_check.py`", files),
    [{ token: "@health_check.py", path: "app/api/api_v1/endpoints/health_check.py", name: "health_check.py" }]
  )
  assert.deepEqual(fileRefsFromBacktickPaths("see `foo/README.md`", files), [{
    token: "@foo/README.md",
    path: "foo/README.md",
    name: "README.md"
  }])
  assert.deepEqual(fileRefsFromBacktickPaths("see `missing.py`", files), [])
  assert.deepEqual(fileRefsFromBacktickPaths("see `npm run build`", files), [])
})

test("userMessageFileRefs prefers explicit file-ref parts over derived backtick paths", () => {
  const message = {
    role: "user",
    parts: [
      { type: "file-ref", token: "@api.py", path: "src/api.py", name: "api.py" },
      { type: "text", text: "đọc `src/api.py`" }
    ]
  }
  assert.deepEqual(userMessageFileRefs(message), [{
    type: "file-ref",
    token: "@api.py",
    path: "src/api.py",
    name: "api.py"
  }])
})

test("hydrated user text without file-ref parts still renders @file tokens", () => {
  const thread = createThreadStream("sess_one")
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [{
      id: "part_text",
      messageID: "msg_user",
      type: "text",
      text: "đọc `app/api/api_v1/endpoints/health_check.py` cho tôi"
    }]
  }])

  const userMessage = thread.messages.find((message) => message.id === "msg_user")
  assert.ok(userMessage)
  assert.equal(userMessage.parts.some((part) => part.type === "file-ref"), false)
  assert.deepEqual(userMessageFileRefs(userMessage), [{
    token: "@health_check.py",
    path: "app/api/api_v1/endpoints/health_check.py",
    name: "health_check.py"
  }])
  assert.equal(messageText(userMessage), "đọc @health_check.py cho tôi")
})

test("thread stream drops synthetic tool text and dedupes the optimistic user message", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "Dịch file này sang tiếng việt", [
    { filename: "report.pdf", mime: "application/pdf" }
  ])

  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [
      { id: "part_file", messageID: "msg_user", type: "file", filename: "report.pdf", mime: "application/pdf" },
      { id: "part_synthetic", messageID: "msg_user", type: "text", synthetic: true, text: "Called the Read tool with the following input: {\"filePath\":\"/tmp/report.pdf\"}" },
      { id: "part_text", messageID: "msg_user", type: "text", text: "Dịch file này sang tiếng việt" }
    ]
  }])

  assert.equal(thread.messages.length, 1)
  assert.equal(messageText(thread.messages[0]), "Dịch file này sang tiếng việt")
  assert.equal(thread.messages[0].parts.some((part) => part.type === "text" && part.synthetic), false)
})

test("thread stream hides office attachment context in hydrated user messages", () => {
  const thread = createThreadStream("sess_one")
  const contextText = officeContextText()
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [
      { id: "part_file", messageID: "msg_user", type: "file", filename: "事業推進QA対応.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { id: "part_text", messageID: "msg_user", type: "text", text: contextText }
    ]
  }])

  assert.equal(messageText(thread.messages[0]), "Hãy dịch file này sang tiếng Việt")
  assert.equal(messageCopyText(thread.messages[0]), "@事業推進QA対応.xlsx\nHãy dịch file này sang tiếng Việt")
  assert.equal(messageCopyText(thread.messages[0]).includes("Attached document files"), false)
  assert.equal(messageCopyText(thread.messages[0]).includes("確認事項"), false)
})

test("thread stream maps streamed office context text back to the optimistic user message", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "Hãy dịch file này sang tiếng Việt", [
    { filename: "事業推進QA対応.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  ])

  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: "part_file",
      messageID: "msg_user",
      type: "file",
      filename: "事業推進QA対応.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }
  })
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: "part_text",
      messageID: "msg_user",
      type: "text",
      text: officeContextText()
    }
  })

  assert.equal(thread.messages.length, 1)
  assert.equal(thread.messages[0].role, "user")
  assert.equal(messageText(thread.messages[0]), "Hãy dịch file này sang tiếng Việt")
})

test("thread stream drops tool boilerplate but keeps assistant replies", () => {
  const thread = createThreadStream("sess_one")
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_assistant", role: "assistant" },
    parts: [
      { id: "part_text", messageID: "msg_assistant", type: "text", synthetic: true, text: "Called the Read tool with the following input: {}" },
      { id: "part_reply", messageID: "msg_assistant", type: "text", text: "Here is the translation." }
    ]
  }])

  assert.equal(messageText(thread.messages[0]), "Here is the translation.")
})

test("thread stream drops the stray Gemma tool-call marker leaked as a text part", () => {
  const thread = createThreadStream("sess_one")
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_assistant", role: "assistant" },
    parts: [
      { id: "part_reply", messageID: "msg_assistant", type: "text", text: "Tôi sẽ dịch nội dung của file." },
      // Observed real leak from google/gemma-4-31B-it: the tool-call marker plus the
      // brace that closed the tool-call JSON, surfacing as its own text part.
      { id: "part_marker", messageID: "msg_assistant", type: "text", text: "\n}<tool_call|>\n" }
    ]
  }])

  assert.equal(messageText(thread.messages[0]), "Tôi sẽ dịch nội dung của file.")
  assert.equal(thread.messages[0].parts.some((part) => /tool_call/.test(part.text || "")), false)
})

test("thread stream drops a bare tool-call marker text part built up via streaming deltas", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, { type: "message.updated", sessionID: "sess_one", info: { id: "msg_a", role: "assistant" } })
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: { id: "p_marker", messageID: "msg_a", sessionID: "sess_one", type: "text", text: "" }
  })
  applyThreadEvent(thread, {
    type: "message.part.delta",
    sessionID: "sess_one",
    messageID: "msg_a",
    partID: "p_marker",
    field: "text",
    delta: "\n}<tool_call|>\n"
  })

  assert.equal(messageText(thread.messages[0]), "")
  assert.equal(thread.messages[0].parts.some((part) => /tool_call/.test(part.text || "")), false)
})

test("thread stream keeps a real answer that merely contains the word tool_call in prose", () => {
  const thread = createThreadStream("sess_one")
  const answer = "Bạn có thể dùng marker tool_call để báo hiệu một lệnh gọi công cụ trong prompt."
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_assistant", role: "assistant" },
    parts: [{ id: "part_reply", messageID: "msg_assistant", type: "text", text: answer }]
  }])

  assert.equal(messageText(thread.messages[0]), answer)
})

test("thread stream keeps assistant text even if it mentions the office context marker", () => {
  const thread = createThreadStream("sess_one")
  const assistantText = "Attached document files are provided as local paths plus extracted text context is an internal marker."
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_assistant", role: "assistant" },
    parts: [{ id: "part_reply", messageID: "msg_assistant", type: "text", text: assistantText }]
  }])

  assert.equal(messageText(thread.messages[0]), assistantText)
})

test("thread stream does not render streamed user attachment parts as assistant bubbles", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "Không đúng file này là file cũ", [
    { filename: "Screenshot 2026-06-03 at 10.31.48 PM.png", mime: "image/png" }
  ])

  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: "part_synthetic",
      messageID: "msg_user",
      type: "text",
      synthetic: true,
      text: "Called the Read tool with the following input: {\"filePath\":\"/Users/bach/Desktop/Screenshot 2026-06-03 at 10.31.48 PM.png\"}"
    }
  })
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: "part_file",
      messageID: "msg_user",
      type: "file",
      filename: "Screenshot 2026-06-03 at 10.31.48 PM.png",
      mime: "image/png"
    }
  })
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: "part_text",
      messageID: "msg_user",
      type: "text",
      text: "Không đúng file này là file cũ"
    }
  })
  applyThreadEvent(thread, {
    type: "message.updated",
    sessionID: "sess_one",
    info: { id: "msg_user", role: "user" }
  })

  assert.equal(thread.messages.length, 1)
  assert.equal(thread.messages[0].role, "user")
  assert.equal(messageText(thread.messages[0]), "Không đúng file này là file cũ")
})

test("thread stream keeps the next optimistic turn in order while waiting for hydrate", () => {
  const thread = createThreadStream("sess_one")
  hydrateThread(thread, "sess_one", [
    {
      info: { id: "msg_user_1", role: "user" },
      parts: [{ id: "part_user_1", type: "text", text: "First prompt" }]
    },
    {
      info: { id: "msg_assistant_1", role: "assistant" },
      parts: [{ id: "part_assistant_1", type: "text", text: "First reply" }]
    }
  ])
  addOptimisticUser(thread, "Second prompt", [
    { filename: "draft.pdf", mime: "application/pdf" }
  ])

  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: { id: "part_file_2", messageID: "msg_user_2", type: "file", filename: "draft.pdf", mime: "application/pdf" }
  })
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: { id: "part_text_2", messageID: "msg_user_2", type: "text", text: "Second prompt" }
  })
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: { id: "part_assistant_2", messageID: "msg_assistant_2", type: "text", text: "Second reply" }
  })

  assert.deepEqual(thread.messages.map((message) => message.role), ["user", "assistant", "user", "assistant"])
  assert.deepEqual(thread.messages.map(messageText), ["First prompt", "First reply", "Second prompt", "Second reply"])
})

test("thread stream keeps an unmatched slash command prompt before hydrated assistant output", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "/review review change hiện tại")
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: "part_tool",
      messageID: "msg_assistant",
      type: "tool",
      tool: "read",
      state: { status: "completed", input: { filePath: "src/opencode-config.js" } }
    }
  })
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: "part_reply",
      messageID: "msg_assistant",
      type: "text",
      text: "Reviewed current changes."
    }
  })

  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_assistant", role: "assistant" },
    parts: [
      {
        id: "part_tool",
        messageID: "msg_assistant",
        type: "tool",
        tool: "read",
        state: { status: "completed", input: { filePath: "src/opencode-config.js" } }
      },
      {
        id: "part_reply",
        messageID: "msg_assistant",
        type: "text",
        text: "Reviewed current changes."
      }
    ]
  }])

  assert.deepEqual(thread.messages.map((message) => message.role), ["user", "assistant"])
  assert.equal(messageText(thread.messages[0]), "/review review change hiện tại")
  assert.equal(messageText(thread.messages[1]), "Reviewed current changes.")
})

test("thread stream renders streamed assistant parts after a file-attachment prompt", () => {
  // Regression guard: the synthetic-text filter must never suppress the assistant's
  // streamed reply. After the user prompt + attachment, the assistant streams text
  // via message.part.updated and must appear.
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "Hãy dịch file này sang tiếng việt", [
    { filename: "事業推進QA対応.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
  ])
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [
      { id: "u_file", messageID: "msg_user", type: "file", filename: "事業推進QA対応.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { id: "u_synth", messageID: "msg_user", type: "text", synthetic: true, text: "Called the Read tool with the following input: {}" },
      { id: "u_text", messageID: "msg_user", type: "text", text: "Hãy dịch file này sang tiếng việt" }
    ]
  }])

  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: { id: "a_text", messageID: "msg_assistant", type: "text", text: "Đã dịch xong." }
  })

  assert.equal(thread.messages.length, 2)
  assert.equal(messageText(thread.messages[0]), "Hãy dịch file này sang tiếng việt")
  assert.equal(thread.messages[1].role, "assistant")
  assert.equal(messageText(thread.messages[1]), "Đã dịch xong.")
})

test("thread stream keeps translated document artifact metadata on tool parts", () => {
  const thread = createThreadStream("sess_artifact")
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_artifact",
    part: {
      id: "tool_artifact",
      messageID: "msg_artifact",
      type: "tool",
      tool: "translate_document",
      state: {
        status: "completed",
        metadata: {
          artifacts: [{ path: "/tmp/report-translated-vietnamese.pdf", filename: "report-translated-vietnamese.pdf", mime: "application/pdf" }],
          quality: "warning",
          warnings: ["Review layout"]
        }
      }
    }
  })

  assert.equal(thread.messages[0].parts[0].state.metadata.artifacts[0].filename, "report-translated-vietnamese.pdf")
  assert.deepEqual(thread.messages[0].parts[0].state.metadata.warnings, ["Review layout"])
})

test("thread stream appends text deltas and ignores another session", () => {
  const thread = createThreadStream("sess_one")

  assert.deepEqual(applyThreadEvent(thread, {
    type: "message.part.delta",
    sessionID: "sess_two",
    messageID: "msg_assistant",
    partID: "part_text",
    field: "text",
    delta: "Ignored"
  }), { changed: false, reconcile: false })

  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: { id: "part_text", messageID: "msg_assistant", type: "text", text: "Stream" }
  })
  applyThreadEvent(thread, {
    type: "message.part.delta",
    sessionID: "sess_one",
    messageID: "msg_assistant",
    partID: "part_text",
    field: "text",
    delta: "ing"
  })

  assert.equal(messageText(thread.messages[0]), "Streaming")
})

test("thread stream keeps a tool row while its status changes", () => {
  const thread = createThreadStream("sess_one")
  const update = (status) => applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: "part_tool",
      messageID: "msg_assistant",
      type: "tool",
      tool: "read",
      state: { status, input: { filePath: "src/index.js" }, ...(status === "error" ? { error: "Failed" } : {}) }
    }
  })

  for (const status of ["pending", "running", "completed", "error"]) {
    update(status)
    assert.equal(thread.messages[0].parts.length, 1)
    assert.equal(thread.messages[0].parts[0].state.status, status)
    assert.equal(hasRunningTool(thread), status === "pending" || status === "running")
  }

  update("running")
  addOptimisticUser(thread, "Start the next turn")
  assert.equal(hasRunningTool(thread), false)
})

test("thread stream appends and retains session error details", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "Run tests")
  thread.status = { type: "busy" }

  assert.deepEqual(applyThreadEvent(thread, {
    type: "session.error",
    sessionID: "sess_one",
    error: { data: { message: "Provider failed" } }
  }), { changed: true, reconcile: true })

  assert.equal(thread.status.type, "idle")
  assert.equal(thread.messages.length, 2)
  assert.equal(thread.messages[1].role, "assistant")
  assert.equal(thread.messages[1].syntheticError, true)
  assert.deepEqual(thread.messages[1].parts[0], {
    id: `${thread.messages[1].id}_part`,
    messageID: thread.messages[1].id,
    type: "error",
    title: "Request failed",
    detail: "Provider failed",
    synthetic: true
  })

  applyThreadEvent(thread, {
    type: "session.error",
    sessionID: "sess_one",
    error: { data: { message: "Provider failed" } }
  })
  assert.equal(thread.messages.length, 2)

  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [{ id: "part_user", messageID: "msg_user", type: "text", text: "Run tests" }]
  }])

  assert.equal(thread.messages.length, 2)
  assert.equal(thread.messages[0].id, "msg_user")
  assert.equal(thread.messages[1].syntheticError, true)
  assert.equal(thread.messages[1].parts[0].detail, "Provider failed")
})

test("thread stream reports idle turns with no assistant output", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "Explain this project")
  thread.status = { type: "busy" }

  applyThreadEvent(thread, { type: "session.idle", sessionID: "sess_one" })

  assert.equal(thread.status.type, "idle")
  assert.equal(thread.messages.length, 2)
  assert.equal(thread.messages[1].parts[0].type, "error")
  assert.equal(thread.messages[1].parts[0].title, "No response produced")
  assert.equal(
    thread.messages[1].parts[0].detail,
    "The request ended without a response. Check provider/model/API key or runtime diagnostics."
  )

  applyThreadEvent(thread, { type: "session.idle", sessionID: "sess_one" })
  assert.equal(thread.messages.length, 2)
})

test("thread stream treats aborted sessions as idle without synthetic errors", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "Explain this project")
  thread.status = { type: "busy" }

  assert.deepEqual(applyThreadEvent(thread, { type: "session.aborted", sessionID: "sess_one" }), {
    changed: true,
    reconcile: true
  })

  assert.equal(thread.status.type, "idle")
  assert.equal(thread.messages.length, 1)
  assert.equal(thread.messages.some((message) => message.syntheticError), false)
})

test("thread stream keeps partial assistant output after abort", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "Explain this project")
  thread.status = { type: "busy" }
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: { id: "part_text", messageID: "msg_assistant", type: "text", text: "This project" }
  })

  applyThreadEvent(thread, { type: "session.aborted", sessionID: "sess_one" })

  assert.equal(thread.status.type, "idle")
  assert.equal(thread.messages.length, 2)
  assert.equal(messageText(thread.messages[1]), "This project")
  assert.equal(thread.messages.some((message) => message.syntheticError), false)
})

test("thread stream does not report idle as an error after assistant output", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "Explain this project")
  thread.status = { type: "busy" }

  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: { id: "part_text", messageID: "msg_assistant", type: "text", text: "This project is an Electron app." }
  })
  applyThreadEvent(thread, { type: "session.idle", sessionID: "sess_one" })

  assert.equal(thread.messages.length, 2)
  assert.equal(thread.messages.some((message) => message.syntheticError), false)

  addOptimisticUser(thread, "Read package scripts")
  thread.status = { type: "busy" }
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: "part_tool",
      messageID: "msg_tool",
      type: "tool",
      tool: "read",
      state: { status: "running", input: { filePath: "package.json" } }
    }
  })
  applyThreadEvent(thread, { type: "session.idle", sessionID: "sess_one" })

  assert.equal(thread.messages.some((message) => message.syntheticError), false)
})

test("thread stream reconciles lifecycle state and optimistic user messages", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "Run tests")
  thread.status = { type: "busy" }

  hydrateThread(thread, "sess_one", [
    {
      info: { id: "msg_user", role: "user" },
      parts: [{ id: "part_user", type: "text", text: "Run tests" }]
    }
  ])
  assert.equal(thread.messages.length, 1)
  assert.equal(thread.messages[0].id, "msg_user")

  applyThreadEvent(thread, {
    type: "session.status",
    sessionID: "sess_one",
    status: { type: "retry", attempt: 2, message: "Rate limited" }
  })
  assert.equal(thread.status.type, "retry")

  assert.deepEqual(applyThreadEvent(thread, { type: "session.idle", sessionID: "sess_one" }), {
    changed: true,
    reconcile: true
  })
  assert.equal(thread.status.type, "idle")
  assert.deepEqual(applyThreadEvent(thread, { type: "runtime.stream.connected" }), {
    changed: false,
    reconcile: true
  })
})

test("thread stream resets status on session switch and removes a live optimistic duplicate", () => {
  const thread = createThreadStream("sess_one")
  thread.status = { type: "busy" }
  hydrateThread(thread, "sess_two", [])
  assert.equal(thread.status.type, "idle")

  addOptimisticUser(thread, "Inspect the files")
  applyThreadEvent(thread, {
    type: "message.updated",
    sessionID: "sess_two",
    info: { id: "msg_user", role: "user" }
  })
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_two",
    part: { id: "part_user", messageID: "msg_user", type: "text", text: "Inspect the files" }
  })

  assert.equal(thread.messages.length, 1)
  assert.equal(thread.messages[0].id, "msg_user")
})

test("thread stream tracks a pending question and clears it on reply", () => {
  const thread = createThreadStream("sess_one")
  assert.deepEqual(thread.pendingQuestions, [])

  const question = {
    questions: [{
      question: "Which approach should I take?",
      options: [
        { label: "Doc + script", value: "both", description: "Recommended" },
        { label: "Doc only", value: "doc" }
      ]
    }]
  }
  assert.deepEqual(applyThreadEvent(thread, {
    type: "question.asked",
    sessionID: "sess_one",
    requestID: "q1",
    question
  }), { changed: true, reconcile: false })

  assert.equal(thread.pendingQuestions.length, 1)
  assert.equal(thread.pendingQuestions[0].requestID, "q1")
  assert.equal(thread.pendingQuestions[0].questions[0].options[0].value, "both")

  // A re-asked question with the same requestID updates in place rather than duplicating.
  applyThreadEvent(thread, { type: "question.asked", sessionID: "sess_one", requestID: "q1", question })
  assert.equal(thread.pendingQuestions.length, 1)

  assert.deepEqual(applyThreadEvent(thread, {
    type: "question.replied",
    sessionID: "sess_one",
    requestID: "q1"
  }), { changed: true, reconcile: false })
  assert.equal(thread.pendingQuestions.length, 0)
})

test("thread stream clears a pending question on reject and ignores other sessions", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, {
    type: "question.asked",
    sessionID: "sess_two",
    requestID: "q9",
    question: { questions: [{ question: "?", options: [] }] }
  })
  assert.equal(thread.pendingQuestions.length, 0)

  applyThreadEvent(thread, {
    type: "question.asked",
    sessionID: "sess_one",
    requestID: "q1",
    question: { questions: [{ question: "?", options: [] }] }
  })
  assert.equal(thread.pendingQuestions.length, 1)

  applyThreadEvent(thread, { type: "question.rejected", sessionID: "sess_one", requestID: "q1" })
  assert.equal(thread.pendingQuestions.length, 0)
})

test("thread stream tracks a pending permission and clears it on reply", () => {
  const thread = createThreadStream("sess_one")
  assert.deepEqual(thread.pendingPermissions, [])

  applyThreadEvent(thread, {
    type: "permission.asked",
    sessionID: "sess_one",
    requestID: "p1",
    permission: { title: "Allow edit to src/index.js?", type: "edit", pattern: "src/**" }
  })
  assert.equal(thread.pendingPermissions.length, 1)
  assert.equal(thread.pendingPermissions[0].requestID, "p1")
  assert.equal(thread.pendingPermissions[0].title, "Allow edit to src/index.js?")

  applyThreadEvent(thread, { type: "permission.replied", sessionID: "sess_one", requestID: "p1" })
  assert.equal(thread.pendingPermissions.length, 0)
})

test("thread stream clears pending questions and permissions on abort and session switch", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, {
    type: "question.asked", sessionID: "sess_one", requestID: "q1",
    question: { questions: [{ question: "?", options: [] }] }
  })
  applyThreadEvent(thread, {
    type: "permission.asked", sessionID: "sess_one", requestID: "p1",
    permission: { title: "Allow?" }
  })
  assert.equal(thread.pendingQuestions.length, 1)
  assert.equal(thread.pendingPermissions.length, 1)

  applyThreadEvent(thread, { type: "session.aborted", sessionID: "sess_one" })
  assert.equal(thread.pendingQuestions.length, 0)
  assert.equal(thread.pendingPermissions.length, 0)

  // Pending state must not leak across a session switch via hydrate.
  applyThreadEvent(thread, {
    type: "question.asked", sessionID: "sess_one", requestID: "q2",
    question: { questions: [{ question: "?", options: [] }] }
  })
  assert.equal(thread.pendingQuestions.length, 1)
  hydrateThread(thread, "sess_two", [])
  assert.equal(thread.pendingQuestions.length, 0)
  assert.equal(thread.pendingPermissions.length, 0)
})

test("threadIsBusy reflects busy/retry status", () => {
  const thread = createThreadStream("sess_one")
  assert.equal(threadIsBusy(thread), false)
  thread.status = { type: "busy" }
  assert.equal(threadIsBusy(thread), true)
  thread.status = { type: "retry", attempt: 1 }
  assert.equal(threadIsBusy(thread), true)
  thread.status = { type: "idle" }
  assert.equal(threadIsBusy(thread), false)
  assert.equal(threadIsBusy(undefined), false)
})

test("needsThreadRehydration rehydrates idle, stale, and stuck threads but preserves live streams", () => {
  const idle = createThreadStream("sess_idle")
  assert.equal(needsThreadRehydration(idle, { type: "busy" }), true)
  assert.equal(needsThreadRehydration(undefined, { type: "idle" }), true)

  const emptyBusy = createThreadStream("sess_empty")
  emptyBusy.status = { type: "busy" }
  assert.equal(needsThreadRehydration(emptyBusy, { type: "busy" }), true)

  const staleBusy = createThreadStream("sess_stale")
  addOptimisticUser(staleBusy, "Hello")
  staleBusy.status = { type: "busy" }
  assert.equal(needsThreadRehydration(staleBusy, { type: "idle" }), true)

  const stuckBusy = createThreadStream("sess_stuck")
  addOptimisticUser(stuckBusy, "Hello")
  stuckBusy.status = { type: "busy" }
  assert.equal(needsThreadRehydration(stuckBusy, { type: "busy" }), true)

  const liveStream = createThreadStream("sess_live")
  addOptimisticUser(liveStream, "Hello")
  liveStream.status = { type: "busy" }
  applyThreadEvent(liveStream, {
    type: "message.part.updated",
    sessionID: "sess_live",
    part: { id: "part_1", messageID: "msg_a", type: "text", text: "Working on it" }
  })
  assert.equal(needsThreadRehydration(liveStream, { type: "busy" }), false)
})

// Models the renderer's per-session routing: one thread per session, kept live
// concurrently. An event for the backgrounded session B must land on B's thread
// while session A (on screen, busy) is untouched. This is what lets session A keep
// running while the user works in session B without the app "freezing".
test("concurrent per-session threads route events independently", () => {
  const threadA = createThreadStream("sess_a")
  const threadB = createThreadStream("sess_b")

  // A is mid-flight (a long task), B is brand new.
  addOptimisticUser(threadA, "Read the whole repo and summarize")
  threadA.status = { type: "busy" }
  applyThreadEvent(threadA, {
    type: "message.part.updated",
    sessionID: "sess_a",
    part: { id: "a_text", messageID: "msg_a", type: "text", text: "Working on it" }
  })

  // Streamed output for B arrives while A is on screen. Route it to B's thread only.
  const bySession = { sess_a: threadA, sess_b: threadB }
  const events = [
    { type: "message.part.updated", sessionID: "sess_b", part: { id: "b_text", messageID: "msg_b", type: "text", text: "Hello from B" } },
    // A's background task keeps streaming too — must still reach A's thread.
    { type: "message.part.delta", sessionID: "sess_a", messageID: "msg_a", partID: "a_text", field: "text", delta: " — done" },
    { type: "session.idle", sessionID: "sess_b" }
  ]
  for (const event of events) applyThreadEvent(bySession[event.sessionID], event)

  // A retained its streamed output and stays busy (its task is still running).
  assert.equal(messageText(threadA.messages[0]), "Read the whole repo and summarize")
  assert.equal(messageText(threadA.messages[1]), "Working on it — done")
  assert.equal(threadIsBusy(threadA), true)

  // B received only its own event and went idle independently.
  assert.equal(threadB.messages.length, 1)
  assert.equal(messageText(threadB.messages[0]), "Hello from B")
  assert.equal(threadIsBusy(threadB), false)

  // Aborting B leaves A's running task completely unaffected.
  applyThreadEvent(threadB, { type: "session.aborted", sessionID: "sess_b" })
  assert.equal(threadIsBusy(threadA), true)
})

test("thread stream supports optimistic clearing of pending requests", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, {
    type: "question.asked", sessionID: "sess_one", requestID: "q1",
    question: { questions: [{ question: "?", options: [] }] }
  })
  applyThreadEvent(thread, {
    type: "permission.asked", sessionID: "sess_one", requestID: "p1",
    permission: { title: "Allow?" }
  })

  assert.equal(clearPendingQuestion(thread, "q1"), true)
  assert.equal(clearPendingQuestion(thread, "q1"), false)
  assert.equal(thread.pendingQuestions.length, 0)

  assert.equal(clearPendingPermission(thread, "p1"), true)
  assert.equal(thread.pendingPermissions.length, 0)
})

test("thread stream streams reasoning deltas into the reasoning part created by part.updated", () => {
  const thread = createThreadStream("sess_one")
  // OpenCode 1.17.3 wire order: a `message.part.updated` first creates the empty
  // reasoning part (reasoning-start), then `message.part.delta` events with
  // field:"text" stream its content (reasoning-delta). The part *type* lives on
  // the part, not on the delta's `field`.
  applyThreadEvent(thread, {
    type: "message.part.updated", sessionID: "sess_one",
    part: { id: "part_reason", sessionID: "sess_one", messageID: "msg_a", type: "reasoning", text: "" }
  })
  applyThreadEvent(thread, {
    type: "message.part.delta", sessionID: "sess_one", messageID: "msg_a",
    partID: "part_reason", field: "text", delta: "First I "
  })
  applyThreadEvent(thread, {
    type: "message.part.delta", sessionID: "sess_one", messageID: "msg_a",
    partID: "part_reason", field: "text", delta: "consider the inputs."
  })
  // Then the answer text part, same field:"text" delta channel.
  applyThreadEvent(thread, {
    type: "message.part.updated", sessionID: "sess_one",
    part: { id: "part_text", sessionID: "sess_one", messageID: "msg_a", type: "text", text: "" }
  })
  applyThreadEvent(thread, {
    type: "message.part.delta", sessionID: "sess_one", messageID: "msg_a",
    partID: "part_text", field: "text", delta: "Here is the answer."
  })

  const message = thread.messages.find((item) => item.id === "msg_a")
  const reasoning = message.parts.find((part) => part.id === "part_reason")
  const text = message.parts.find((part) => part.id === "part_text")
  assert.equal(reasoning.type, "reasoning")
  assert.equal(reasoning.text, "First I consider the inputs.")
  assert.equal(text.type, "text")
  assert.equal(text.text, "Here is the answer.")
  // Reasoning is not the answer: it stays out of copy text.
  assert.equal(messageCopyText(message), "Here is the answer.")
})

test("thread stream finalizes a streamed reasoning part with the full text on part.updated", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, {
    type: "message.part.updated", sessionID: "sess_one",
    part: { id: "part_reason", sessionID: "sess_one", messageID: "msg_a", type: "reasoning", text: "" }
  })
  applyThreadEvent(thread, {
    type: "message.part.delta", sessionID: "sess_one", messageID: "msg_a",
    partID: "part_reason", field: "text", delta: "partial"
  })
  // finishReasoning replaces the part with the full text — must not double-count.
  applyThreadEvent(thread, {
    type: "message.part.updated", sessionID: "sess_one",
    part: { id: "part_reason", sessionID: "sess_one", messageID: "msg_a", type: "reasoning", text: "partial reasoning done" }
  })

  const message = thread.messages.find((item) => item.id === "msg_a")
  const reasoning = message.parts.find((part) => part.id === "part_reason")
  assert.equal(reasoning.type, "reasoning")
  assert.equal(reasoning.text, "partial reasoning done")
})

test("thread stream hydrates a reasoning part and excludes it from message text", () => {
  const thread = createThreadStream()
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_a", role: "assistant" },
    parts: [
      { id: "part_reason", messageID: "msg_a", type: "reasoning", text: "thinking out loud" },
      { id: "part_text", messageID: "msg_a", type: "text", text: "final answer" }
    ]
  }])

  const message = thread.messages[0]
  assert.equal(message.parts[0].type, "reasoning")
  assert.equal(message.parts[0].text, "thinking out loud")
  assert.equal(messageText(message), "final answer")
})
