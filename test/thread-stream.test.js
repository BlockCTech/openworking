const test = require("node:test")
const assert = require("node:assert/strict")
const {
  addOptimisticUser,
  applyThreadEvent,
  clearPendingPermission,
  clearPendingQuestion,
  createThreadStream,
  hasRunningTool,
  hydrateThread,
  messageCopyText,
  messageText,
  removeOptimisticUser
} = require("../src/thread-stream")

function officeContextText(prompt = "Hãy dịch file này sang tiếng Việt") {
  return [
    prompt,
    "Attached Office files are provided as local paths plus extracted text context because the configured gateway accepts text/images, not raw Office binaries.",
    "If the user asks to translate an Office file, call the translate_document tool with the exact local inputPath. Do not use shell/write scripts for translation artifacts. Do not claim an output path unless it is returned in translate_document metadata.artifacts.",
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
  assert.equal(messageCopyText(thread.messages[0]).includes("Attached Office files"), false)
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

test("thread stream keeps assistant text even if it mentions the office context marker", () => {
  const thread = createThreadStream("sess_one")
  const assistantText = "Attached Office files are provided as local paths plus extracted text context is an internal marker."
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
