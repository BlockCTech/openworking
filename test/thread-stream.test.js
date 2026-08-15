const test = require("node:test")
const assert = require("node:assert/strict")
const {
  admitPendingInput,
  addOptimisticUser,
  applyThreadEvent,
  clearPendingPermission,
  clearPendingQuestion,
  createThreadStream,
  fileRefsFromBacktickPaths,
  hasRunningTool,
  hydrateThread,
  LIVE_STREAM_GRACE_MS,
  messageCopyText,
  needsThreadRehydration,
  userMessageFileRefs,
  messageText,
  promotePendingInput,
  removeOptimisticUser,
  threadIsBusy
} = require("../src/thread-stream")

function pendingUser(id, admittedSeq, delivery = "queue", text = id, sessionID = "sess_one") {
  return { id, sessionID, type: "user", admittedSeq, timeCreated: admittedSeq * 10, delivery, text }
}

function officeContextText(prompt = "Hãy dịch file này sang tiếng Việt") {
  return [
    prompt,
    "Attached document files are provided as local paths plus extracted text context when available because the configured gateway accepts text/images, not raw document binaries.",
    "For PDF, DOCX, Markdown, or .markdown translation, call translate_document with the exact local inputPath. For PPTX or XLSX translation, call translate_office_document with the exact local inputPath. Do not use shell/write scripts for translation artifacts. For XLSX, omit mode or use newfile unless the user explicitly requests modifying the same workbook; if overwrite intent is ambiguous, ask before using inplace. After an Office translation, use the pptx or xlsx skill to validate the returned artifact. Do not claim an output path unless it is returned in the selected tool's metadata.artifacts.",
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

test("thread stream hides the native core skill message from chat hydration", () => {
  const thread = createThreadStream("sess_one")
  hydrateThread(thread, "sess_one", [
    {
      info: { id: "msg_skill", role: "skill" },
      parts: [{ id: "part_skill", type: "text", text: "Expanded internal skill body" }]
    },
    {
      info: { id: "msg_user", role: "user" },
      parts: [{ id: "part_user", type: "text", text: "Explain this project" }]
    }
  ])

  assert.equal(thread.messages.length, 1)
  assert.equal(thread.messages[0].id, "msg_user")
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

test("thread stream preserves selected skill metadata on optimistic user messages", () => {
  const thread = createThreadStream("sess_one")
  const selectedSkill = {
    kind: "skill",
    label: "use-backlog",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/use-backlog/SKILL.md",
    raw: "[use-backlog](/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/use-backlog/SKILL.md)",
    args: "for this ticket"
  }

  addOptimisticUser(thread, `${selectedSkill.raw} ${selectedSkill.args}`, [], {
    signatureText: `${selectedSkill.raw} ${selectedSkill.args}`,
    selectedSkill
  })

  assert.deepEqual(thread.messages[0].selectedSkill, selectedSkill)
  assert.equal(thread.messages[0].signatureText, `${selectedSkill.raw} ${selectedSkill.args}`)
})

test("thread stream preserves selected command metadata on optimistic user messages", () => {
  const thread = createThreadStream("sess_one")
  const selectedCommand = {
    kind: "command",
    label: "review",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review",
    raw: "[review](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review)",
    args: "for this diff"
  }

  addOptimisticUser(thread, `${selectedCommand.raw} ${selectedCommand.args}`, [], {
    signatureText: `${selectedCommand.raw} ${selectedCommand.args}`,
    selectedCommand
  })

  assert.deepEqual(thread.messages[0].selectedCommand, selectedCommand)
  assert.equal(thread.messages[0].signatureText, `${selectedCommand.raw} ${selectedCommand.args}`)
})

test("thread stream collapses an expanded selected-skill runtime prompt into one user bubble", () => {
  const thread = createThreadStream("sess_one")
  const selectedSkill = {
    kind: "skill",
    label: "understand-dashboard",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/understand-dashboard/SKILL.md",
    raw: "[understand-dashboard](/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/understand-dashboard/SKILL.md)",
    args: "đọc `src/api.py` rồi giải thích"
  }

  addOptimisticUser(thread, `${selectedSkill.raw} ${selectedSkill.args}`, [], {
    signatureText: `${selectedSkill.raw} ${selectedSkill.args}`,
    selectedSkill,
    fileRefs: [{ token: "@api.py", path: "src/api.py", name: "api.py" }]
  })

  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [{
      id: "part_text",
      messageID: "msg_user",
      type: "text",
      text: [
        `# /${selectedSkill.label}`,
        "",
        "Start the Understand Anything dashboard for the current project.",
        "",
        "## Instructions",
        "",
        `If \`${selectedSkill.args}\` contains a path, file, or code symbol, open the dashboard for that target instead of the whole project.`
      ].join("\n")
    }]
  }])

  assert.equal(thread.messages.filter((message) => message.role === "user").length, 1)
  assert.equal(thread.messages[0].id, "msg_user")
  assert.equal(messageText(thread.messages[0]), `${selectedSkill.raw} đọc @api.py rồi giải thích`)
  assert.equal(messageCopyText(thread.messages[0]), `${selectedSkill.raw} đọc @api.py rồi giải thích`)
  assert.deepEqual(thread.messages[0].selectedSkill, selectedSkill)
  assert.deepEqual(
    thread.messages[0].parts.filter((part) => part.type === "file-ref"),
    [{ id: "msg_user_ref_0", messageID: "msg_user", type: "file-ref", token: "@api.py", path: "src/api.py", name: "api.py" }]
  )
  assert.equal(
    thread.messages[0].parts.find((part) => part.type === "text")?.text,
    [
      `# /${selectedSkill.label}`,
      "",
      "Start the Understand Anything dashboard for the current project.",
      "",
      "## Instructions",
      "",
      `If \`${selectedSkill.args}\` contains a path, file, or code symbol, open the dashboard for that target instead of the whole project.`
    ].join("\n")
  )
})

test("thread stream collapses a real skill body (H1 title + base-directory footer) into one user bubble", () => {
  // The runtime expands a skill by emitting the verbatim SKILL.md body — which starts with the
  // skill's own H1 title (e.g. `# Explain Project`, NOT `# /explain-project`) and has no
  // `## Instructions` header — plus an injected "Base directory for this skill" footer that names
  // `.../skills/<label>`. Dedup must key off that footer, not the command-style markers.
  const thread = createThreadStream("sess_one")
  const selectedSkill = {
    kind: "skill",
    label: "explain-project",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/explain-project/SKILL.md",
    raw: "/explain-project",
    args: "Hãy giải thích dự án này cho tôi."
  }

  addOptimisticUser(thread, `${selectedSkill.raw} ${selectedSkill.args}`, [], {
    signatureText: `${selectedSkill.raw} ${selectedSkill.args}`,
    selectedSkill
  })

  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [{
      id: "part_text",
      messageID: "msg_user",
      type: "text",
      text: [
        "# Explain Project",
        "",
        "Inspect the repository before answering. Describe the main entry points, important modules, data flow, runtime dependencies and the commands used to develop or verify the project. Prefer a concise map with concrete file references.",
        "",
        "Base directory for this skill: /Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/explain-project",
        "Relative paths in this skill (e.g., scripts/, references/) are relative to this base directory.",
        "",
        selectedSkill.args
      ].join("\n")
    }]
  }])

  assert.equal(thread.messages.filter((message) => message.role === "user").length, 1)
  assert.equal(thread.messages[0].id, "msg_user")
  assert.deepEqual(thread.messages[0].selectedSkill, selectedSkill)
  // The bubble renders the raw slash command the user typed, not the expanded body.
  assert.equal(messageText(thread.messages[0]), `${selectedSkill.raw} ${selectedSkill.args}`)
})

test("thread stream collapses expanded selected-command runtime context into one user bubble", () => {
  const thread = createThreadStream("sess_one")
  const selectedCommand = {
    kind: "command",
    label: "review",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review",
    raw: "[review](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review)",
    args: "for this diff"
  }

  addOptimisticUser(thread, `${selectedCommand.raw} ${selectedCommand.args}`, [], {
    signatureText: `${selectedCommand.raw} ${selectedCommand.args}`,
    selectedCommand
  })

  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [{
      id: "part_text",
      messageID: "msg_user",
      type: "text",
      text: [
        `# /${selectedCommand.label}`,
        "",
        "Review the current changes in the project.",
        "",
        "## Instructions",
        "",
        `Use \`${selectedCommand.args}\` as the review focus for this run.`
      ].join("\n")
    }]
  }])

  assert.equal(thread.messages.filter((message) => message.role === "user").length, 1)
  assert.equal(thread.messages[0].id, "msg_user")
  assert.equal(messageText(thread.messages[0]), `${selectedCommand.raw} ${selectedCommand.args}`)
  assert.equal(messageCopyText(thread.messages[0]), `${selectedCommand.raw} ${selectedCommand.args}`)
  assert.deepEqual(thread.messages[0].selectedCommand, selectedCommand)
})

test("thread stream collapses a real built-in command echo (no # /<label> header) into one user bubble", () => {
  // Real opencode built-in commands (/init, /review) expand to their own prompt templates:
  // no `# /<label>` first line, no `## Instructions` section, no injected footer — the typed
  // arguments are substituted somewhere inside the body. Dedup must still adopt the echo.
  const thread = createThreadStream("sess_one")
  const selectedCommand = {
    kind: "command",
    label: "init",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/init",
    raw: "/init",
    args: "check cho tôi command này"
  }

  addOptimisticUser(thread, `${selectedCommand.raw} ${selectedCommand.args}`, [], {
    signatureText: `${selectedCommand.raw} ${selectedCommand.args}`,
    selectedCommand
  })

  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [{
      id: "part_text",
      messageID: "msg_user",
      type: "text",
      text: [
        "Create or update `AGENTS.md` for this repository.",
        "",
        "The goal is a compact instruction file that helps future OpenCode sessions avoid mistakes and ramp up quickly.",
        "",
        "User-provided focus or constraints (honor these):",
        selectedCommand.args,
        "",
        "## How to investigate",
        "",
        "Read the highest-value sources first."
      ].join("\n")
    }]
  }])

  assert.equal(thread.messages.filter((message) => message.role === "user").length, 1)
  assert.equal(thread.messages[0].id, "msg_user")
  assert.deepEqual(thread.messages[0].selectedCommand, selectedCommand)
  assert.equal(messageText(thread.messages[0]), `${selectedCommand.raw} ${selectedCommand.args}`)
})

test("thread stream loose command adoption never steals another optimistic's exact echo", () => {
  const thread = createThreadStream("sess_one")
  const selectedCommand = {
    kind: "command",
    label: "init",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/init",
    raw: "/init",
    args: ""
  }

  addOptimisticUser(thread, selectedCommand.raw, [], {
    signatureText: selectedCommand.raw,
    selectedCommand
  })
  addOptimisticUser(thread, "hello world, please review this", [], {
    signatureText: "hello world, please review this"
  })

  // The plain prompt's echo arrives first (runtime-confirmed user role): the exact-text
  // optimistic must claim it even though the args-less command optimistic is loose-eligible.
  applyThreadEvent(thread, {
    type: "message.updated",
    sessionID: "sess_one",
    info: { id: "msg_prompt", role: "user" }
  })
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: { id: "part_prompt", messageID: "msg_prompt", type: "text", text: "hello world, please review this" }
  })

  // Then the command's expanded echo arrives and is adopted by the command optimistic.
  applyThreadEvent(thread, {
    type: "message.updated",
    sessionID: "sess_one",
    info: { id: "msg_command", role: "user" }
  })
  applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: "part_command",
      messageID: "msg_command",
      type: "text",
      text: "Create or update `AGENTS.md` for this repository.\n\nThe goal is a compact instruction file."
    }
  })

  const userMessages = thread.messages.filter((message) => message.role === "user")
  assert.equal(userMessages.length, 2)
  const promptMessage = userMessages.find((message) => message.id === "msg_prompt")
  assert.ok(promptMessage)
  assert.equal(promptMessage.selectedCommand, undefined)
  assert.equal(messageText(promptMessage), "hello world, please review this")
  const commandMessage = userMessages.find((message) => message.id === "msg_command")
  assert.ok(commandMessage)
  assert.deepEqual(commandMessage.selectedCommand, selectedCommand)
  assert.equal(messageText(commandMessage), selectedCommand.raw)
})

test("thread stream collapses a bare selected skill without args into one user bubble", () => {
  const thread = createThreadStream("sess_one")
  const selectedSkill = {
    kind: "skill",
    label: "use-backlog",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/use-backlog/SKILL.md",
    raw: "[use-backlog](/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/use-backlog/SKILL.md)",
    args: ""
  }

  addOptimisticUser(thread, selectedSkill.raw, [], {
    signatureText: selectedSkill.raw,
    selectedSkill
  })

  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [{
      id: "part_text",
      messageID: "msg_user",
      type: "text",
      text: [
        `# /${selectedSkill.label}`,
        "",
        "## Instructions",
        "",
        "Use the backlog workflow for the current task."
      ].join("\n")
    }]
  }])

  assert.equal(thread.messages.filter((message) => message.role === "user").length, 1)
  assert.equal(thread.messages[0].id, "msg_user")
  assert.equal(messageText(thread.messages[0]), selectedSkill.raw)
  assert.equal(messageCopyText(thread.messages[0]), selectedSkill.raw)
  assert.deepEqual(thread.messages[0].selectedSkill, selectedSkill)
})

test("thread stream does not collapse arbitrary user text that merely mentions a selected skill", () => {
  const thread = createThreadStream("sess_one")
  const selectedSkill = {
    kind: "skill",
    label: "understand-dashboard",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/understand-dashboard/SKILL.md",
    raw: "[understand-dashboard](/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/understand-dashboard/SKILL.md)",
    args: "skill này tác dụng gì?"
  }

  addOptimisticUser(thread, `${selectedSkill.raw} ${selectedSkill.args}`, [], {
    signatureText: `${selectedSkill.raw} ${selectedSkill.args}`,
    selectedSkill
  })

  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [{
      id: "part_text",
      messageID: "msg_user",
      type: "text",
      text: `Tôi vừa gõ /${selectedSkill.label} và hỏi: ${selectedSkill.args}`
    }]
  }])

  assert.equal(thread.messages.filter((message) => message.role === "user").length, 2)
  assert.equal(thread.messages[0].optimistic, true)
  assert.equal(thread.messages[1].id, "msg_user")
})

test("thread stream does not collapse a near-miss hash-skill prompt without internal template markers", () => {
  const thread = createThreadStream("sess_one")
  const selectedSkill = {
    kind: "skill",
    label: "understand-dashboard",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/understand-dashboard/SKILL.md",
    raw: "[understand-dashboard](/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/understand-dashboard/SKILL.md)",
    args: "đọc `src/api.py` rồi giải thích"
  }

  addOptimisticUser(thread, `${selectedSkill.raw} ${selectedSkill.args}`, [], {
    signatureText: `${selectedSkill.raw} ${selectedSkill.args}`,
    selectedSkill
  })

  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_user", role: "user" },
    parts: [{
      id: "part_text",
      messageID: "msg_user",
      type: "text",
      text: [
        `# /${selectedSkill.label}`,
        "",
        "## Instructions",
        "",
        selectedSkill.args,
        "",
        "Skill summary: dashboard notes for later."
      ].join("\n")
    }]
  }])

  assert.equal(thread.messages.filter((message) => message.role === "user").length, 2)
  assert.equal(thread.messages[0].optimistic, true)
  assert.equal(thread.messages[1].id, "msg_user")
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

test("fileRefsFromBacktickPaths recognizes a path:N-M or path:N snippet suffix and carries it through the token", () => {
  const files = ["src/app.js", "foo/README.md"]

  assert.deepEqual(
    fileRefsFromBacktickPaths("refactor `src/app.js:120-134` please", files),
    [{ token: "@app.js:120-134", path: "src/app.js", name: "app.js:120-134", raw: "src/app.js:120-134" }]
  )
  assert.deepEqual(
    fileRefsFromBacktickPaths("look at `src/app.js:57`", files),
    [{ token: "@app.js:57", path: "src/app.js", name: "app.js:57", raw: "src/app.js:57" }]
  )
  // A path with a suffix that doesn't resolve to a known project file is ignored, same as a plain
  // unknown path.
  assert.deepEqual(fileRefsFromBacktickPaths("see `missing.js:1-2`", files), [])

  // Two snippets from the SAME file at different ranges must each keep their own ref/token -
  // deduping by path alone (the pre-fix behavior) would have silently dropped the second one.
  assert.deepEqual(
    fileRefsFromBacktickPaths("compare `src/app.js:1-5` and `src/app.js:40-45`", files),
    [
      { token: "@app.js:1-5", path: "src/app.js", name: "app.js:1-5", raw: "src/app.js:1-5" },
      { token: "@app.js:40-45", path: "src/app.js", name: "app.js:40-45", raw: "src/app.js:40-45" }
    ]
  )
})

test("messageText renders a snippet mention's chip token from a reconciled message with no file-ref parts", () => {
  const thread = createThreadStream("sess_snippet_reconcile")
  thread.messages.push({
    id: "msg_user",
    role: "user",
    parts: [{
      id: "part_text",
      messageID: "msg_user",
      type: "text",
      text: "Refactor `src/app.js:120-134` please"
    }]
  })

  assert.deepEqual(userMessageFileRefs(thread.messages[0], ["src/app.js"]), [
    { token: "@app.js:120-134", path: "src/app.js", name: "app.js:120-134", raw: "src/app.js:120-134" }
  ])
  assert.equal(messageText(thread.messages[0], ["src/app.js"]), "Refactor @app.js:120-134 please")
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

test("thread stream turns a hydrated thought channel into clean agent progress", () => {
  const thread = createThreadStream("sess_one")
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_assistant", role: "assistant" },
    parts: [{
      id: "part_thought",
      messageID: "msg_assistant",
      type: "text",
      text: "<|channel|>thought I will first check the git status.<channel|>"
    }]
  }])

  assert.equal(thread.messages[0].parts.length, 1)
  assert.equal(thread.messages[0].parts[0].type, "reasoning")
  assert.equal(thread.messages[0].parts[0].text, "I will first check the git status.")
  assert.equal(messageText(thread.messages[0]), "")
  assert.equal(messageCopyText(thread.messages[0]), "")
})

test("thread stream buffers a split thought-channel marker without exposing control text", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, { type: "message.updated", sessionID: "sess_one", info: { id: "msg_a", role: "assistant" } })

  for (const delta of ["<|chan", "nel|>thought I will ", "check.<chan", "nel|>"]) {
    applyThreadEvent(thread, {
      type: "message.part.delta",
      sessionID: "sess_one",
      messageID: "msg_a",
      partID: "part_thought",
      field: "text",
      delta
    })
    assert.equal(messageText(thread.messages[0]), "")
    assert.equal(thread.messages[0].parts.some((part) => /<\|?channel|channel\|>/.test(part.text || "")), false)
  }

  assert.equal(thread.messages[0].parts.length, 1)
  assert.equal(thread.messages[0].parts[0].type, "reasoning")
  assert.equal(thread.messages[0].parts[0].text, "I will check.")
})

// The provider leaks a single-pipe open marker as well as a double-pipe one, and appends the
// envelope to real prose rather than sending it alone. Both spellings, at any offset, are stripped.
function assistantTextPart(text) {
  return { id: "part_x", messageID: "msg_x", type: "text", text }
}

function hydratedAssistantParts(text) {
  const thread = createThreadStream("sess_one")
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_x", role: "assistant" },
    parts: [assistantTextPart(text)]
  }])
  return thread.messages[0].parts
}

function hydratedAssistantPart(text) {
  const parts = hydratedAssistantParts(text)
  return parts.find((part) => part.type === "text") || parts[0] || { type: "text", text: "" }
}

function streamedAssistantParts(text, size = 3) {
  const thread = createThreadStream("sess_one")
  for (let index = 0; index < text.length; index += size) {
    applyThreadEvent(thread, {
      type: "message.part.delta",
      sessionID: "sess_one",
      messageID: "msg_x",
      partID: "part_x",
      field: "text",
      delta: text.slice(index, index + size)
    })
  }
  return thread.messages[0].parts
}

function streamedAssistantPart(text, size = 3) {
  const parts = streamedAssistantParts(text, size)
  return parts.find((part) => part.type === "text") || parts[0] || { type: "text", text: "" }
}

for (const [label, open] of [["single-pipe", "<|channel>thought"], ["double-pipe", "<|channel|>thought"]]) {
  for (const [mode, build] of [["hydrated", hydratedAssistantPart], ["streamed", streamedAssistantPart]]) {
    test(`thread stream strips a ${label} thought channel that stands alone (${mode})`, () => {
      const part = build(`${open} I will check the diff.<channel|>`)
      assert.equal(part.type, "reasoning")
      assert.equal(part.text, "I will check the diff.")
    })

    test(`thread stream strips a ${label} thought channel appended to real prose (${mode})`, () => {
      const prose = "First, I'll read the current code and the tests."
      const part = build(`${prose}${open} <channel|>`)
      assert.equal(part.type, "text")
      assert.equal(part.text, prose)
    })

    test(`thread stream keeps answer text that follows a ${label} thought channel (${mode})`, () => {
      const part = build(`${open} hidden<channel|>Real answer here.`)
      assert.equal(part.type, "text")
      assert.equal(part.text, "Real answer here.")
    })
  }
}

// A leak can put an answer and a private thought in one text part. Dropping either loses real
// content — the raw capture had a single part carrying 1235 characters of thought.
test("thread stream splits an answer that carries a leaked thought into two parts", () => {
  const thread = createThreadStream("sess_one")
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_x", role: "assistant" },
    parts: [assistantTextPart("Tôi sẽ tạo test case.<channel|><|channel>thought\nI want to verify this.")]
  }])
  const parts = thread.messages[0].parts

  assert.equal(parts.length, 2)
  assert.equal(parts[0].type, "text")
  assert.equal(parts[0].text, "Tôi sẽ tạo test case.")
  assert.equal(parts[1].type, "reasoning")
  assert.equal(parts[1].text, "I want to verify this.")
  // the thought must not reach the answer or the clipboard
  assert.equal(messageText(thread.messages[0]), "Tôi sẽ tạo test case.")
  assert.equal(messageCopyText(thread.messages[0]), "Tôi sẽ tạo test case.")
})

for (const [mode, build] of [["hydrated", hydratedAssistantParts], ["streamed", streamedAssistantParts]]) {
  test(`thread stream preserves a thought-before-answer part order (${mode})`, () => {
    const parts = build("<|channel|>thought hidden<channel|>Final answer.")
    assert.deepEqual(parts.map((part) => [part.type, part.text]), [
      ["reasoning", "hidden"],
      ["text", "Final answer."]
    ])
  })
}

test("thread stream does not duplicate a derived thought part as deltas keep arriving", () => {
  const thread = createThreadStream("sess_one")
  const text = "Answer here.<channel|><|channel>thought\nPrivate reasoning."
  for (let index = 0; index < text.length; index += 4) {
    applyThreadEvent(thread, {
      type: "message.part.delta",
      sessionID: "sess_one",
      messageID: "msg_x",
      partID: "part_x",
      field: "text",
      delta: text.slice(index, index + 4)
    })
  }
  const parts = thread.messages[0].parts
  assert.equal(parts.length, 2)
  assert.equal(parts.filter((part) => part.type === "reasoning").length, 1)
  assert.equal(parts[0].text, "Answer here.")
  assert.equal(parts[1].text, "Private reasoning.")
})

// The six shapes below are the ones a raw SSE capture actually produced.
for (const [mode, build] of [["hydrated", hydratedAssistantPart], ["streamed", streamedAssistantPart]]) {
  // (a) stray close marker mid-part, right before the next turn begins
  test(`thread stream drops a bare stray close marker mid answer (${mode})`, () => {
    const part = build("Let's start with MODE D.<channel|>[MODE D] Checking the diff.")
    assert.equal(part.type, "text")
    assert.equal(part.text, "Let's start with MODE D.[MODE D] Checking the diff.")
  })

  // (b) stray close marker at the very end of the part
  test(`thread stream drops a bare stray close marker at the end of an answer (${mode})`, () => {
    const part = build("Tôi sẽ kiểm tra lại xử lý output của agent.<channel|>")
    assert.equal(part.type, "text")
    assert.equal(part.text, "Tôi sẽ kiểm tra lại xử lý output của agent.")
  })

  // (c) close immediately followed by a fresh open, both leaked into the text stream
  test(`thread stream routes thought that follows a back-to-back close and open (${mode})`, () => {
    const part = build("Tôi sẽ tạo test case tái hiện lỗi.<channel|><|channel>thought\nI want to verify this.")
    assert.equal(part.type, "text")
    assert.equal(part.text, "Tôi sẽ tạo test case tái hiện lỗi.")
  })

  // (d) bare open marker, then private thought content leaking as answer text
  test(`thread stream keeps thought after a bare open marker out of the answer (${mode})`, () => {
    const part = build("<|channel>thought\nI want to verify if this leaks.")
    assert.equal(part.type, "reasoning")
    assert.equal(part.text, "I want to verify if this leaks.")
  })

  // (e) the model writing about the protocol, marker inside a code span
  test(`thread stream leaves a marker quoted in a code span untouched (${mode})`, () => {
    const text = "It does NOT match `<|channel>thought`. But the spellings list includes it."
    const part = build(text)
    assert.equal(part.type, "text")
    assert.equal(part.text, text)
  })

  // (f) same, inside a string literal in quoted source
  test(`thread stream leaves a marker quoted in a string literal untouched (${mode})`, () => {
    const text = 'SPELLINGS = ["<|channel|>thought", "<|channel>thought", "<channel|>thought"]'
    const part = build(text)
    assert.equal(part.type, "text")
    assert.equal(part.text, text)
  })

  test(`thread stream leaves a marker inside a fenced code block untouched (${mode})`, () => {
    const text = "Example:\n```text\n<|channel|>thought\nliteral payload\n```"
    const part = build(text)
    assert.equal(part.type, "text")
    assert.equal(part.text, text)
  })
}

// An agent reasoning about this very code quotes the marker spellings inside its thought.
// Closing the channel there spills the rest of the thought into the visible answer.
const THOUGHT_QUOTING_MARKERS = [
  "The code was modified to handle multiple open marker spellings:",
  'THOUGHT_CHANNEL_OPEN_SPELLINGS = ["<|channel|>thought", "<|channel>thought", "<channel|>thought"].',
  "Then splitThoughtChannel separates prose from the thought channel."
].join(" ")

for (const [mode, build] of [["hydrated", hydratedAssistantPart], ["streamed", streamedAssistantPart]]) {
  test(`thread stream keeps a thought that quotes the marker spellings inside the channel (${mode})`, () => {
    const part = build(`<|channel|>thought ${THOUGHT_QUOTING_MARKERS}<channel|>`)
    assert.equal(part.type, "reasoning")
    assert.equal(part.text, THOUGHT_QUOTING_MARKERS)
  })
}

// The same agent quotes an opening marker inside a code span with nothing following it, so
// only the surrounding backticks and quotes mark it as content rather than protocol.
const THOUGHT_QUOTING_BARE_MARKER = 'User is reporting an issue where the text `"<|channel|>"` '
  + "(which looks like the closing tag of a `<|channel|>` block) appears in the output."

for (const [mode, build] of [["hydrated", hydratedAssistantPart], ["streamed", streamedAssistantPart]]) {
  test(`thread stream keeps a thought that quotes a bare opening marker inside the channel (${mode})`, () => {
    const part = build(`<|channel|>thought ${THOUGHT_QUOTING_BARE_MARKER}<channel|>`)
    assert.equal(part.type, "reasoning")
    assert.equal(part.text, THOUGHT_QUOTING_BARE_MARKER)
  })
}

// One character per delta is the only chunking that lands a boundary right after "<" / "<|".
for (const answer of ["<div>Hello world</div> is the markup", "<?php echo 1; ?>", "<|endoftext|>"]) {
  test(`thread stream never swallows an answer starting with '<': ${answer}`, () => {
    const part = streamedAssistantPart(answer, 1)
    assert.equal(part.type, "text")
    assert.equal(part.text, answer)
  })
}

test("thread stream keeps a marker-like suffix in a completed hydrated answer", () => {
  const text = "A comparison ends with x <"
  const part = hydratedAssistantPart(text)
  assert.equal(part.type, "text")
  assert.equal(part.text, text)
})

test("thread stream releases a buffered marker-like suffix when the turn completes", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, {
    type: "message.part.delta",
    sessionID: "sess_one",
    messageID: "msg_x",
    partID: "part_x",
    field: "text",
    delta: "A comparison ends with x <"
  })
  assert.equal(thread.messages[0].parts[0].text, "A comparison ends with x ")

  applyThreadEvent(thread, {
    type: "message.updated",
    sessionID: "sess_one",
    info: { id: "msg_x", role: "assistant", time: { completed: 123 } }
  })
  assert.equal(thread.messages[0].parts[0].text, "A comparison ends with x <")
  assert.equal(Object.hasOwn(thread.messages[0].parts[0], "thoughtChannelSource"), false)
})

test("thread stream leaves ordinary prose that mentions a channel marker as assistant text", () => {
  const text = "Explain the `<|channel|>thought` marker in this protocol."
  const prefixNearMiss = "<|channel|>thoughtful prose is still a normal answer."
  const thread = createThreadStream("sess_one")
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_assistant", role: "assistant" },
    parts: [{ id: "part_text", messageID: "msg_assistant", type: "text", text }]
  }, {
    info: { id: "msg_near_miss", role: "assistant" },
    parts: [{ id: "part_near_miss", messageID: "msg_near_miss", type: "text", text: prefixNearMiss }]
  }])

  assert.equal(thread.messages[0].parts[0].type, "text")
  assert.equal(messageText(thread.messages[0]), text)
  assert.equal(thread.messages[1].parts[0].type, "text")
  assert.equal(messageText(thread.messages[1]), prefixNearMiss)
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

test("thread stream merges replayed v2 tool lifecycle updates without losing identity or input", () => {
  const thread = createThreadStream("sess_one")
  const partID = "msg_assistant:tool:call_websearch"
  const update = (part) => applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: partID,
      sessionID: "sess_one",
      messageID: "msg_assistant",
      type: "tool",
      ...part
    }
  })

  update({ tool: "websearch", state: { status: "pending", input: {} } })
  update({ state: { status: "pending", input: { query: "nhiệt độ đà nẵng hôm nay" } } })
  update({ state: { status: "running" } })
  update({ state: { status: "running" } }) // durable replay

  const message = thread.messages.find((item) => item.id === "msg_assistant")
  assert.equal(message.parts.length, 1)
  assert.deepEqual(message.parts[0], {
    id: partID,
    sessionID: "sess_one",
    messageID: "msg_assistant",
    type: "tool",
    tool: "websearch",
    state: {
      status: "running",
      input: { query: "nhiệt độ đà nẵng hôm nay" },
      title: undefined,
      error: undefined
    }
  })
  assert.equal(hasRunningTool(thread), true)

  update({ state: { status: "completed" } })
  assert.equal(message.parts.length, 1)
  assert.equal(message.parts[0].tool, "websearch")
  assert.deepEqual(message.parts[0].state.input, { query: "nhiệt độ đà nẵng hôm nay" })
  assert.equal(message.parts[0].state.status, "completed")
  assert.equal(hasRunningTool(thread), false)

  update({ state: { status: "running" } }) // stale replay after the terminal event
  assert.equal(message.parts.length, 1)
  assert.equal(message.parts[0].state.status, "completed")
  assert.equal(hasRunningTool(thread), false)
})

test("thread stream keeps allowlisted tool metadata while merging terminal state", () => {
  const thread = createThreadStream("sess_one")
  const update = (state) => applyThreadEvent(thread, {
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: "msg_assistant:tool:call_report",
      sessionID: "sess_one",
      messageID: "msg_assistant",
      type: "tool",
      tool: state.status === "pending" ? "translate_document" : undefined,
      state
    }
  })

  update({ status: "pending", input: { inputPath: "/tmp/report.docx" } })
  update({
    status: "running",
    metadata: {
      artifacts: [{ path: "/tmp/report-vi.docx", filename: "report-vi.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }],
      quality: "verified",
      warnings: []
    }
  })
  update({ status: "error", error: "Translation failed" })

  const part = thread.messages[0].parts[0]
  assert.equal(part.tool, "translate_document")
  assert.deepEqual(part.state.input, { inputPath: "/tmp/report.docx" })
  assert.equal(part.state.error, "Translation failed")
  assert.equal(part.state.metadata.artifacts[0].filename, "report-vi.docx")
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

test("thread stream tracks structured forms and clears them on reply or cancel", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, {
    type: "form.created",
    sessionID: "sess_one",
    form: { id: "frm_1", sessionID: "sess_one", title: "Web Search", fields: [{ key: "choice", type: "string", options: [] }] }
  })
  assert.equal(thread.pendingForms.length, 1)
  assert.equal(thread.pendingForms[0].requestID, "frm_1")
  applyThreadEvent(thread, { type: "form.replied", sessionID: "sess_one", formID: "frm_1" })
  assert.equal(thread.pendingForms.length, 0)
  applyThreadEvent(thread, {
    type: "form.created",
    sessionID: "sess_one",
    form: { id: "frm_2", sessionID: "sess_one", title: "Choose", fields: [{ key: "provider", type: "string", options: [] }] }
  })
  applyThreadEvent(thread, { type: "form.cancelled", sessionID: "sess_one", formID: "frm_2" })
  assert.equal(thread.pendingForms.length, 0)
})

test("thread stream clears pending questions, permissions, and forms on abort, and keeps them across hydrate", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, {
    type: "question.asked", sessionID: "sess_one", requestID: "q1",
    question: { questions: [{ question: "?", options: [] }] }
  })
  applyThreadEvent(thread, {
    type: "permission.asked", sessionID: "sess_one", requestID: "p1",
    permission: { title: "Allow?" }
  })
  applyThreadEvent(thread, {
    type: "form.created", sessionID: "sess_one",
    form: { id: "f1", sessionID: "sess_one", fields: [{ key: "choice", type: "string" }] }
  })
  assert.equal(thread.pendingQuestions.length, 1)
  assert.equal(thread.pendingPermissions.length, 1)
  assert.equal(thread.pendingForms.length, 1)

  applyThreadEvent(thread, { type: "session.aborted", sessionID: "sess_one" })
  assert.equal(thread.pendingQuestions.length, 0)
  assert.equal(thread.pendingPermissions.length, 0)
  assert.equal(thread.pendingForms.length, 0)

  // Hydrate must NOT drop pending state: the runtime is still blocked on the user's answer, so
  // discarding the card here left it unanswerable and the tool hung until it failed.
  applyThreadEvent(thread, {
    type: "question.asked", sessionID: "sess_one", requestID: "q2",
    question: { questions: [{ question: "?", options: [] }] }
  })
  assert.equal(thread.pendingQuestions.length, 1)
  hydrateThread(thread, "sess_two", [])
  assert.equal(thread.pendingQuestions.length, 1)
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
  assert.equal(needsThreadRehydration(emptyBusy, { type: "busy" }), false)

  const staleBusy = createThreadStream("sess_stale")
  addOptimisticUser(staleBusy, "Hello")
  staleBusy.status = { type: "busy" }
  assert.equal(needsThreadRehydration(staleBusy, { type: "idle" }), true)

  const stuckBusy = createThreadStream("sess_stuck")
  addOptimisticUser(stuckBusy, "Hello")
  stuckBusy.status = { type: "busy" }
  assert.equal(needsThreadRehydration(stuckBusy, { type: "busy" }), false)

  const liveStream = createThreadStream("sess_live")
  addOptimisticUser(liveStream, "Hello")
  liveStream.status = { type: "busy" }
  applyThreadEvent(liveStream, {
    type: "message.part.updated",
    sessionID: "sess_live",
    part: { id: "part_1", messageID: "msg_a", type: "text", text: "Working on it" }
  })
  assert.equal(needsThreadRehydration(liveStream, { type: "busy" }, liveStream.lastEventAt + LIVE_STREAM_GRACE_MS - 1), false)
  assert.equal(needsThreadRehydration(liveStream, { type: "busy" }, liveStream.lastEventAt + LIVE_STREAM_GRACE_MS + 1), true)

  const stalePartial = createThreadStream("sess_partial")
  addOptimisticUser(stalePartial, "Hello")
  stalePartial.status = { type: "busy" }
  applyThreadEvent(stalePartial, {
    type: "message.part.updated",
    sessionID: "sess_partial",
    part: { id: "part_1", messageID: "msg_a", type: "text", text: "Partial answer" }
  })
  stalePartial.lastStreamEventAt = Date.now() - LIVE_STREAM_GRACE_MS - 1
  stalePartial.lastAssistantOutputAt = stalePartial.lastStreamEventAt
  stalePartial.lastEventAt = stalePartial.lastStreamEventAt
  assert.equal(needsThreadRehydration(stalePartial, { type: "busy" }, stalePartial.lastEventAt + LIVE_STREAM_GRACE_MS + 1), true)

  const liveTool = createThreadStream("sess_tool")
  addOptimisticUser(liveTool, "Read config")
  liveTool.status = { type: "busy" }
  applyThreadEvent(liveTool, {
    type: "message.part.updated",
    sessionID: "sess_tool",
    part: {
      id: "part_tool",
      messageID: "msg_tool",
      type: "tool",
      tool: "read",
      state: { status: "running", input: { filePath: "src/index.js" } }
    }
  })
  assert.equal(needsThreadRehydration(liveTool, { type: "busy" }, liveTool.lastEventAt + LIVE_STREAM_GRACE_MS + 1), false)

  const liveQuestion = createThreadStream("sess_question")
  addOptimisticUser(liveQuestion, "Choose one")
  liveQuestion.status = { type: "busy" }
  applyThreadEvent(liveQuestion, {
    type: "message.part.updated",
    sessionID: "sess_question",
    part: { id: "part_q", messageID: "msg_q", type: "text", text: "Need your input" }
  })
  applyThreadEvent(liveQuestion, {
    type: "question.asked",
    sessionID: "sess_question",
    requestID: "q1",
    question: { title: "Pick", questions: [] }
  })
  assert.equal(needsThreadRehydration(liveQuestion, { type: "busy" }, liveQuestion.lastEventAt + LIVE_STREAM_GRACE_MS + 1), false)
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

test("thread stream preserves progress, tool and final-text order without duplicating durable progress", () => {
  const thread = createThreadStream("sess_one")
  const events = [
    {
      type: "message.part.delta", sessionID: "sess_one", messageID: "msg_a",
      partID: "msg_a:reasoning:0", field: "reasoning", delta: "Inspecting"
    },
    {
      type: "message.part.updated", sessionID: "sess_one",
      part: {
        id: "msg_a:reasoning:0", sessionID: "sess_one", messageID: "msg_a",
        type: "reasoning", text: "Inspecting the project."
      }
    },
    {
      type: "message.part.updated", sessionID: "sess_one",
      part: {
        id: "tool_0", sessionID: "sess_one", messageID: "msg_a", type: "tool", tool: "read",
        state: { status: "completed", input: { filePath: "src/index.js" }, output: "ok" }
      }
    },
    {
      type: "message.part.delta", sessionID: "sess_one", messageID: "msg_a",
      partID: "msg_a:reasoning:1", field: "reasoning", delta: "Reviewing"
    },
    {
      type: "message.part.updated", sessionID: "sess_one",
      part: {
        id: "msg_a:reasoning:1", sessionID: "sess_one", messageID: "msg_a",
        type: "reasoning", text: "Reviewing the result."
      }
    },
    {
      type: "message.part.delta", sessionID: "sess_one", messageID: "msg_a",
      partID: "msg_a:2", field: "text", delta: "Final answer."
    }
  ]
  for (const event of events) applyThreadEvent(thread, event)

  const message = thread.messages.find((item) => item.id === "msg_a")
  assert.deepEqual(message.parts.map((part) => part.id), [
    "msg_a:reasoning:0",
    "tool_0",
    "msg_a:reasoning:1",
    "msg_a:2"
  ])
  assert.deepEqual(
    message.parts.filter((part) => part.type === "reasoning").map((part) => part.text),
    ["Inspecting the project.", "Reviewing the result."]
  )
  assert.equal(messageCopyText(message), "Final answer.")
})

// The bug this guards: reasoning deltas are ephemeral in the runtime and are never replayed, so on
// a reconnect (or a client joining mid-turn) the ONLY reasoning the app sees is the durable
// `session.reasoning.ended`, which the manager projects as a whole-part update. If that cannot
// create the part on its own, the reasoning block never appears at all.
test("thread stream renders a reasoning part that arrives with no preceding deltas", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, {
    type: "message.part.updated", sessionID: "sess_one",
    part: {
      id: "msg_a:reasoning:0", sessionID: "sess_one", messageID: "msg_a",
      type: "reasoning", text: "reasoned without any delta"
    }
  })

  const message = thread.messages.find((item) => item.id === "msg_a")
  const reasoning = message.parts.find((part) => part.id === "msg_a:reasoning:0")
  assert.equal(reasoning.type, "reasoning")
  assert.equal(reasoning.text, "reasoned without any delta")
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

test("thread stream captures assistant runtime + token stats from message.updated", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, {
    type: "message.updated",
    sessionID: "sess_one",
    info: {
      id: "msg_a",
      role: "assistant",
      time: { created: 1000, completed: 1000 + 12000 },
      tokens: { input: 200000, output: 50000, reasoning: 1300 },
      cost: 0.42
    }
  })

  const stats = thread.messages[0].stats
  assert.equal(stats.completed, true)
  assert.equal(stats.elapsedMs, 12000)
  assert.equal(stats.createdAt, 1000)
  assert.equal(stats.totalTokens, 251300)
  assert.equal(stats.inputTokens, 200000)
  assert.equal(stats.cost, 0.42)
})

test("thread stream exposes createdAt on an in-flight assistant message so the live clock can start", () => {
  const thread = createThreadStream("sess_one")
  // Streaming: time.created is set but not completed, no tokens yet.
  applyThreadEvent(thread, {
    type: "message.updated",
    sessionID: "sess_one",
    info: { id: "msg_a", role: "assistant", time: { created: 5000 } }
  })

  const stats = thread.messages[0].stats
  assert.ok(stats, "a created-only message should still yield stats")
  assert.equal(stats.completed, false)
  assert.equal(stats.createdAt, 5000)
  assert.equal(stats.elapsedMs, null)
  assert.equal(stats.totalTokens, 0)
  assert.equal(stats.inputTokens, 0)
})

test("thread stream keeps final stats when a later partial message.updated lacks them", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, {
    type: "message.updated",
    sessionID: "sess_one",
    info: {
      id: "msg_a",
      role: "assistant",
      time: { created: 1000, completed: 13000 },
      tokens: { input: 200000, output: 50000, reasoning: 1300 }
    }
  })
  // A stray later update with no time/tokens must not wipe the settled stats.
  applyThreadEvent(thread, {
    type: "message.updated",
    sessionID: "sess_one",
    info: { id: "msg_a", role: "assistant" }
  })

  const stats = thread.messages[0].stats
  assert.ok(stats, "stats should survive a stats-less follow-up update")
  assert.equal(stats.completed, true)
  assert.equal(stats.totalTokens, 251300)
})

test("pending inputs stay FIFO, admit idempotently and keep queue positions", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "third", [], {
    id: "msg_queue0003",
    delivery: "queue",
    inputState: "submitting"
  })
  assert.equal(admitPendingInput(thread, pendingUser("msg_queue0003", 3, "queue", "third")), true)
  assert.equal(admitPendingInput(thread, pendingUser("msg_queue0001", 1, "queue", "first")), true)
  assert.equal(admitPendingInput(thread, pendingUser("msg_steer0002", 2, "steer", "steer now")), true)
  assert.equal(admitPendingInput(thread, pendingUser("msg_queue0003", 3, "queue", "third")), true)

  assert.deepEqual(thread.pendingInputs.map((input) => input.id), [
    "msg_queue0001",
    "msg_steer0002",
    "msg_queue0003"
  ])
  assert.deepEqual(thread.messages.map((message) => message.id), [
    "msg_queue0001",
    "msg_steer0002",
    "msg_queue0003"
  ])
  assert.equal(thread.messages.filter((message) => message.id === "msg_queue0003").length, 1)
  assert.equal(thread.messages.find((message) => message.id === "msg_queue0001").queuePosition, 1)
  assert.equal(thread.messages.find((message) => message.id === "msg_steer0002").inputState, "steering")
  assert.equal(thread.messages.find((message) => message.id === "msg_queue0003").queuePosition, 2)
})

test("promotion handles response/event reordering without resurrecting an input", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "late event", [], {
    id: "msg_lateevent",
    delivery: "queue",
    inputState: "submitting"
  })

  assert.equal(promotePendingInput(thread, "msg_lateevent"), true)
  assert.equal(thread.messages[0].inputState, "running")
  assert.equal(admitPendingInput(thread, pendingUser("msg_lateevent", 4, "queue", "late event")), false)
  assert.deepEqual(thread.pendingInputs, [])
  assert.equal(thread.messages.length, 1)

  applyThreadEvent(thread, {
    type: "session.input.admitted",
    sessionID: "sess_one",
    inputID: "msg_other0001",
    input: pendingUser("msg_other0001", 5, "steer", "change direction")
  })
  applyThreadEvent(thread, {
    type: "session.input.promoted",
    sessionID: "sess_one",
    inputID: "msg_other0001"
  })
  assert.equal(thread.messages.find((message) => message.id === "msg_other0001").inputState, "steered")
  assert.deepEqual(thread.pendingInputs, [])
})

test("hydration restores pending FIFO without duplicate bubbles and hides scheduler-only inputs", () => {
  const thread = createThreadStream("sess_one")
  addOptimisticUser(thread, "same stable input", [], {
    id: "msg_pending001",
    delivery: "queue",
    inputState: "delivery-unknown"
  })
  hydrateThread(thread, "sess_one", [{
    info: { id: "msg_history01", role: "user" },
    parts: [{ id: "part_history", messageID: "msg_history01", type: "text", text: "already running" }]
  }], { type: "busy" }, [
    pendingUser("msg_pending002", 2, "queue", "second"),
    { id: "cmp_pending", sessionID: "sess_one", type: "compaction", admittedSeq: 3 },
    pendingUser("msg_pending001", 1, "queue", "same stable input"),
    pendingUser("msg_other_ses", 0, "queue", "wrong session", "sess_other")
  ])

  assert.deepEqual(thread.pendingInputs.map((input) => input.id), [
    "msg_pending001",
    "msg_pending002",
    "cmp_pending"
  ])
  assert.deepEqual(thread.messages.map((message) => message.id), [
    "msg_history01",
    "msg_pending001",
    "msg_pending002"
  ])
  assert.equal(thread.messages.filter((message) => message.id === "msg_pending001").length, 1)
  assert.equal(thread.messages.find((message) => message.id === "msg_history01").inputState, "running")
  assert.equal(thread.messages.find((message) => message.id === "msg_pending001").queuePosition, 1)
  assert.equal(thread.messages.find((message) => message.id === "msg_pending002").queuePosition, 2)
})

test("interrupt settles only the active input and preserves the queued FIFO", () => {
  const thread = createThreadStream("sess_one")
  admitPendingInput(thread, pendingUser("msg_active001", 1, "queue", "active"))
  admitPendingInput(thread, pendingUser("msg_queue0002", 2, "queue", "next"))
  admitPendingInput(thread, pendingUser("msg_queue0003", 3, "queue", "last"))
  promotePendingInput(thread, "msg_active001")
  thread.status = { type: "busy" }

  applyThreadEvent(thread, { type: "session.aborted", sessionID: "sess_one" })

  assert.deepEqual(thread.pendingInputs.map((input) => input.id), ["msg_queue0002", "msg_queue0003"])
  assert.deepEqual([...thread.activeInputIds], [])
  assert.equal(thread.messages.find((message) => message.id === "msg_active001").inputState, undefined)
  assert.equal(thread.messages.find((message) => message.id === "msg_queue0002").queuePosition, 1)
  assert.equal(thread.messages.find((message) => message.id === "msg_queue0003").queuePosition, 2)
})

// A permission card is the runtime blocking on the user's answer. Hydrating the thread used to
// drop it whenever the session id changed, which left the runtime waiting on a card that no
// longer existed anywhere in the UI — the tool hung and eventually failed with a bare error.
test("hydrating a different session keeps a pending permission answerable", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, {
    type: "permission.asked",
    sessionID: "sess_one",
    requestID: "perm_1",
    permission: { permission: "edit", title: "Edit README.md" }
  })
  assert.equal(thread.pendingPermissions.length, 1)

  hydrateThread(thread, "sess_two", [], { type: "idle" })

  assert.equal(thread.pendingPermissions.length, 1, "the card must survive so the user can still answer it")
  assert.equal(thread.pendingPermissions[0].requestID, "perm_1")
})

test("replying to a permission still clears it", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, { type: "permission.asked", sessionID: "sess_one", requestID: "perm_1", permission: { permission: "edit" } })
  applyThreadEvent(thread, { type: "permission.replied", sessionID: "sess_one", requestID: "perm_1" })
  assert.equal(thread.pendingPermissions.length, 0)
})

test("aborting the session still clears pending permissions", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, { type: "permission.asked", sessionID: "sess_one", requestID: "perm_1", permission: { permission: "edit" } })
  applyThreadEvent(thread, { type: "session.aborted", sessionID: "sess_one" })
  assert.equal(thread.pendingPermissions.length, 0, "an aborted turn genuinely ends the request")
})

test("thread stream buffers a fragmented thought marker without leaking text", () => {
  const thread = createThreadStream("sess_one")
  const deltas = ["<|", "chan", "nel|>", "thought ", "I am thinking..."];
  for (const delta of deltas) {
    applyThreadEvent(thread, {
      type: "message.part.delta",
      sessionID: "sess_one",
      messageID: "msg_1",
      partID: "part_1",
      field: "text",
      delta
    });
  }
  const msg = thread.messages.find(m => m.id === "msg_1");
  const part = msg.parts.find(p => p.id === "part_1");
  assert.strictEqual(part.type, "reasoning");
  assert.strictEqual(part.text, "I am thinking...");
})

test("a pending question is still there when the user returns to the session", () => {
  const thread = createThreadStream("sess_one")
  applyThreadEvent(thread, {
    type: "question.asked", sessionID: "sess_one", requestID: "q1",
    question: { questions: [{ question: "?", options: [] }] }
  })
  hydrateThread(thread, "sess_two", [])
  hydrateThread(thread, "sess_one", [])
  assert.equal(thread.pendingQuestions.length, 1)
  assert.equal(thread.pendingQuestions[0].requestID, "q1")
})
