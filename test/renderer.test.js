const test = require("node:test")
const assert = require("node:assert/strict")

global.window = {
  OpenWorkingThreadStream: {
    addOptimisticUser() {},
    applyThreadEvent() {},
    clearPendingPermission() {},
    clearPendingQuestion() {},
    createThreadStream(sessionId) {
      return { sessionId, messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }
    },
    hasRunningTool() { return false },
    hydrateThread() {},
    messageCopyText() { return "" },
    needsThreadRehydration() { return true },
    userMessageFileRefs() { return [] },
    messageText() { return "" },
    removeOptimisticUser() {},
    resetThread(_thread, sessionId) {
      return { sessionId, messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }
    },
    threadIsBusy() { return false }
  },
  OpenWorkingDiffView: {
    parseUnifiedDiff() { return null }
  }
}

global.localStorage = {
  getItem() { return null },
  setItem() {},
  removeItem() {}
}

const {
  applyPendingFileMentions,
  chooseSessionAfterRuntimeReconnect,
  collectLiveFileMentions,
  computePromptAttachments,
  fileMentionTokenForPath,
  fileMentionTokenPattern,
  filterPromptAttachments,
  livePendingFileMentions,
  loadStoredExpanded,
  persistExpanded,
  renderPromptOverlayHtml,
  renderTextWithFileMentions,
  resolveFileMentionsFromPrompt,
  __test
} = require("../src/renderer")

function fakeElement() {
  return {
    innerHTML: "",
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    addEventListener() {},
    focus() {},
    querySelector() { return null },
    querySelectorAll() { return [] }
  }
}

function fakeDocument() {
  const elements = new Map([
    ["root", fakeElement()],
    ["toastHost", fakeElement()]
  ])
  return {
    getElementById(id) {
      return elements.get(id) || null
    },
    querySelector() { return null },
    querySelectorAll() { return [] },
    addEventListener() {}
  }
}

function backedLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null },
    setItem(key, value) { store.set(key, String(value)) },
    removeItem(key) { store.delete(key) }
  }
}

test("expanded sidebar projects round-trip through localStorage", () => {
  const previousStorage = global.localStorage
  global.localStorage = backedLocalStorage()
  const previousExpanded = __test.state.expanded
  try {
    __test.state.expanded = new Set(["proj_a", "proj_b"])
    persistExpanded()
    assert.deepEqual([...loadStoredExpanded()], ["proj_a", "proj_b"])
  } finally {
    __test.state.expanded = previousExpanded
    global.localStorage = previousStorage
  }
})

test("loadStoredExpanded returns an empty set for missing or malformed storage", () => {
  const previousStorage = global.localStorage
  try {
    global.localStorage = backedLocalStorage()
    assert.equal(loadStoredExpanded().size, 0)
    global.localStorage = backedLocalStorage({ "openworking:expanded-projects": "{not json" })
    assert.equal(loadStoredExpanded().size, 0)
    global.localStorage = backedLocalStorage({ "openworking:expanded-projects": '{"a":1}' })
    assert.equal(loadStoredExpanded().size, 0)
  } finally {
    global.localStorage = previousStorage
  }
})

test("file mentions stay live only for exact standalone tokens", () => {
  const mentions = [{ token: "@health_check.py", path: "src/health_check.py", name: "health_check.py" }]
  assert.match("Read @health_check.py", fileMentionTokenPattern("@health_check.py"))
  assert.deepEqual(livePendingFileMentions("Read @health_check.py", mentions), mentions)
  assert.deepEqual(livePendingFileMentions("Read @health_check.py.", mentions), [])
  assert.deepEqual(livePendingFileMentions("Read @health_check.p", mentions), [])
})

test("@file prompt expansion keeps only text and drops stale same-name attachments", () => {
  const mentions = [{ token: "@health_check.py", path: "src/health_check.py", name: "health_check.py" }]
  assert.equal(
    applyPendingFileMentions("Read @health_check.py", mentions),
    "Read `src/health_check.py`"
  )
  assert.equal(
    applyPendingFileMentions("Read @health_check.py then @health_check.py again", mentions),
    "Read `src/health_check.py` then `src/health_check.py` again"
  )

  const attachments = [
    { id: "old-file-flow", filename: "health_check.py", mime: "application/octet-stream" },
    { id: "real-attachment", filename: "diagram.png", mime: "image/png" }
  ]
  assert.deepEqual(filterPromptAttachments(attachments, mentions), [
    { id: "real-attachment", filename: "diagram.png", mime: "image/png" }
  ])
})

test("renderer submit attachments become text-only only when non-command file mentions are present", () => {
  const mentions = [{ token: "@health_check.py", path: "app/api/api_v1/endpoints/health_check.py", name: "health_check.py" }]
  const attachments = [
    { id: "old-1", filename: "README.md", mime: "application/octet-stream" },
    { id: "old-2", filename: "diagram.png", mime: "image/png" }
  ]

  assert.deepEqual(
    computePromptAttachments({ command: null, pendingAttachments: attachments, fileMentions: mentions }),
    []
  )
  assert.deepEqual(
    computePromptAttachments({ command: null, pendingAttachments: attachments, fileMentions: [] }),
    attachments
  )
  assert.deepEqual(
    computePromptAttachments({ command: "explain-project", pendingAttachments: attachments, fileMentions: mentions }),
    []
  )
})

test("prompt overlay highlights live file mention tokens inline", () => {
  const mentions = [{ token: "@README.md", path: "app/models/api_v2/README.md", name: "README.md" }]
  const html = renderPromptOverlayHtml("đọc @README.md giúp tôi", mentions)
  assert.match(html, /file-mention-token/)
  assert.match(html, /@README\.md/)
})

test("prompt overlay does not highlight invalidated tokens", () => {
  const mentions = [{ token: "@README.md", path: "app/models/api_v2/README.md", name: "README.md" }]
  const html = renderPromptOverlayHtml("đọc @README.md. giúp tôi", mentions)
  assert.doesNotMatch(html, /file-mention-token/)
})

test("user message rendering does not highlight basename substrings inside invalid tokens", () => {
  const mentions = [{ token: "@README.md", path: "app/models/api_v2/README.md", name: "README.md" }]
  const html = renderTextWithFileMentions("đọc @README.mdx giúp tôi", mentions)
  assert.doesNotMatch(html, /file-mention-token/)
  assert.match(html, /@README\.mdx/)
})

test("typed @file tokens resolve from project files without menu selection", () => {
  const files = ["app/api/api_v1/endpoints/health_check.py", "src/api.py"]
  assert.deepEqual(
    resolveFileMentionsFromPrompt("đọc @health_check.py cho tôi", files),
    [{ token: "@health_check.py", path: "app/api/api_v1/endpoints/health_check.py", name: "health_check.py" }]
  )
  assert.deepEqual(resolveFileMentionsFromPrompt("đọc @missing.py cho tôi", files), [])
})

test("collectLiveFileMentions merges menu state with typed tokens", () => {
  const files = ["app/api/api_v1/endpoints/health_check.py"]
  const mentions = collectLiveFileMentions("đọc @health_check.py cho tôi", { files })
  assert.deepEqual(mentions, [
    { token: "@health_check.py", path: "app/api/api_v1/endpoints/health_check.py", name: "health_check.py" }
  ])
})

test("typed @file submit drops stale attachments even without menu selection", () => {
  const files = ["app/api/api_v1/endpoints/health_check.py"]
  const attachments = [
    { id: "old-1", filename: "health_check.py", mime: "application/octet-stream" },
    { id: "old-2", filename: "diagram.png", mime: "image/png" }
  ]
  const mentions = collectLiveFileMentions("đọc @health_check.py cho tôi", { files })
  assert.deepEqual(
    computePromptAttachments({ command: null, pendingAttachments: attachments, fileMentions: mentions }),
    []
  )
})

test("duplicate basenames use path-qualified tokens to avoid silently rewiring mentions", () => {
  const files = [
    "foo/README.md",
    "bar/README.md",
    "src/api.py"
  ]
  assert.equal(fileMentionTokenForPath("src/api.py", files), "@api.py")
  assert.equal(fileMentionTokenForPath("foo/README.md", files), "@foo/README.md")
  assert.equal(fileMentionTokenForPath("bar/README.md", files), "@bar/README.md")
})

test("runtime reconnect keeps the active session when it still exists", () => {
  const sessions = [
    { id: "sess_old", title: "Existing session" },
    { id: "sess_other", title: "Other session" }
  ]

  assert.equal(
    chooseSessionAfterRuntimeReconnect("sess_old", sessions),
    "sess_old"
  )
})

test("runtime reconnect falls back to new-session flow when the active session is gone", () => {
  const sessions = [{ id: "sess_other", title: "Other session" }]

  assert.equal(
    chooseSessionAfterRuntimeReconnect("sess_old", sessions),
    null
  )
  assert.equal(
    chooseSessionAfterRuntimeReconnect(null, sessions),
    null
  )
})

test("refreshSessionData restores the active session when background rehydrate fails", async () => {
  const previousOpenworking = global.window.openworking
  const { refreshSessionData, state } = __test
  const calls = []

  global.window.openworking = {
    runtime: {
      async listSessions() {
        return [{ id: "sess_active" }, { id: "sess_background" }]
      },
      async listMessages({ sessionId }) {
        calls.push(sessionId)
        if (sessionId === "sess_background") throw new Error("background failed")
        return []
      }
    }
  }

  Object.assign(state, {
    activeProjectId: "proj_1",
    activeSessionId: "sess_active",
    sessionsByProject: {},
    threads: new Map([
      ["sess_active", { sessionId: "sess_active", status: { type: "busy" }, messages: [] }],
      ["sess_background", { sessionId: "sess_background", status: { type: "busy" }, messages: [] }]
    ]),
    runtime: {
      status: "running",
      project: { id: "proj_1" },
      sessionStatuses: {
        sess_active: { type: "busy" },
        sess_background: { type: "busy" }
      }
    }
  })

  try {
    await assert.rejects(refreshSessionData(), /background failed/)
    assert.deepEqual(calls, ["sess_background", "sess_active"])
  } finally {
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt restores the draft and surfaces runtime startup failures", async () => {
  const previousDocument = global.document
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const document = fakeDocument()
  global.document = document
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }
  global.window.openworking = {
    runtime: {
      async openProject() {
        throw new Error("Runtime failed to start")
      }
    }
  }

  const { sendPrompt, state } = __test
  const attachment = { id: "att_1", filename: "diagram.png", mime: "image/png" }
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: null,
    sessionsByProject: {},
    threads: new Map(),
    runtime: null,
    auth: { saml2Enabled: false },
    config: {
      provider: {
        mynavitechtus: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "mynavitechtus",
    selectedModelKey: "mynavitechtus/model-one",
    mode: "agent",
    promptDraft: "",
    pendingAttachments: [attachment],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })

  try {
    await sendPrompt("Please inspect this")

    assert.equal(state.promptDraft, "Please inspect this")
    assert.deepEqual(state.pendingAttachments, [attachment])
    assert.equal(state.loading, false)
    assert.equal(state.toast, "Runtime failed to start")
    assert.match(document.getElementById("toastHost").innerHTML, /Runtime failed to start/)
  } finally {
    state.toast = null
    global.document = previousDocument
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})
