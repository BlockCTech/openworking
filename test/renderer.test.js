const test = require("node:test")
const assert = require("node:assert/strict")

global.window = {
  addEventListener() {},
  removeEventListener() {},
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
  loadAllSessions,
  sessionsForProjectPath,
  loadStoredExpanded,
  persistExpanded,
  renderPromptOverlayHtml,
  renderTextWithFileMentions,
  resolveFileMentionsFromPrompt,
  setProjectSessions,
  sessionRowKey,
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

function fakeSidebarScrollDocument({ resetOnRootRender = false, resetOnSidebarRender = false, scrollTop = 0 } = {}) {
  const root = fakeElement()
  const sidebarRoot = fakeElement()
  const toastHost = fakeElement()
  const sideScroll = fakeElement()
  sideScroll.scrollTop = scrollTop

  let rootHtml = root.innerHTML
  Object.defineProperty(root, "innerHTML", {
    get() { return rootHtml },
    set(value) {
      rootHtml = value
      if (resetOnRootRender) sideScroll.scrollTop = 0
    }
  })

  let sidebarHtml = sidebarRoot.innerHTML
  Object.defineProperty(sidebarRoot, "innerHTML", {
    get() { return sidebarHtml },
    set(value) {
      sidebarHtml = value
      if (resetOnSidebarRender) sideScroll.scrollTop = 0
    }
  })

  return {
    root,
    sidebarRoot,
    sideScroll,
    document: {
      getElementById(id) {
        if (id === "root") return root
        if (id === "sidebarRoot") return sidebarRoot
        if (id === "toastHost") return toastHost
        return null
      },
      querySelector(selector) {
        if (selector === ".side-scroll") return sideScroll
        return null
      },
      querySelectorAll() { return [] },
      addEventListener() {}
    }
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

test("sessionsForProjectPath keeps only directory-matching sessions (trailing slash tolerant)", () => {
  const sessions = [
    { id: "s1", directory: "/Users/me/a" },
    { id: "s2", directory: "/Users/me/a/" },
    { id: "s3", directory: "/Users/me/b" },
    { id: "s4" } // no directory → unsafe for directory-scoped background lists
  ]
  assert.deepEqual(sessionsForProjectPath(sessions, "/Users/me/a").map((s) => s.id), ["s1", "s2"])
  assert.deepEqual(sessionsForProjectPath([], "/Users/me/a"), [])
})

test("setProjectSessions accepts active no-directory sessions and removes that id from other projects", () => {
  const previous = {
    projects: __test.state.projects,
    sessionsByProject: __test.state.sessionsByProject
  }
  try {
    __test.state.projects = [
      { id: "proj_a", path: "/Users/me/a" },
      { id: "proj_b", path: "/Users/me/b" }
    ]
    __test.state.sessionsByProject = {
      proj_b: [
        { id: "shared", directory: "/Users/me/b" },
        { id: "b_only", directory: "/Users/me/b" }
      ]
    }

    const stored = setProjectSessions("proj_a", [
      { id: "shared" },
      { id: "a_only", directory: "/Users/me/a/" },
      { id: "wrong_dir", directory: "/Users/me/b" }
    ], "active")

    assert.deepEqual(stored.map((session) => session.id), ["shared", "a_only"])
    assert.deepEqual(__test.state.sessionsByProject.proj_a.map((session) => session.id), ["shared", "a_only"])
    assert.deepEqual(__test.state.sessionsByProject.proj_b.map((session) => session.id), ["b_only"])
  } finally {
    __test.state.projects = previous.projects
    __test.state.sessionsByProject = previous.sessionsByProject
  }
})

// Saves/restores the renderer state loadAllSessions touches, sets the runtime running, and
// installs a stub runtime; returns a restore() to call in finally.
function withLoadAllSessionsEnv({ projects, sessionsByProject = {}, runtime }) {
  const previous = {
    window: global.window,
    projects: __test.state.projects,
    sessionsByProject: __test.state.sessionsByProject,
    runtime: __test.state.runtime,
    activeProjectId: __test.state.activeProjectId
  }
  __test.state.projects = projects
  __test.state.sessionsByProject = sessionsByProject
  __test.state.runtime = { status: "running" }
  __test.state.activeProjectId = projects[0]?.id || null
  global.window = { openworking: { runtime } }
  return () => {
    global.window = previous.window
    __test.state.projects = previous.projects
    __test.state.sessionsByProject = previous.sessionsByProject
    __test.state.runtime = previous.runtime
    __test.state.activeProjectId = previous.activeProjectId
  }
}

test("loadAllSessions fetches each project directory and fills state for every project", async () => {
  const byDir = {
    "/Users/me/a": [{ id: "s1", directory: "/Users/me/a" }],
    "/Users/me/b": [{ id: "s2", directory: "/Users/me/b" }]
  }
  const restore = withLoadAllSessionsEnv({
    projects: [{ id: "proj_a", path: "/Users/me/a" }, { id: "proj_b", path: "/Users/me/b" }],
    runtime: { listSessionsForDirectory: async (directory) => byDir[directory] || [] }
  })
  try {
    await loadAllSessions()
    assert.deepEqual(__test.state.sessionsByProject.proj_a.map((s) => s.id), ["s1"])
    assert.deepEqual(__test.state.sessionsByProject.proj_b.map((s) => s.id), ["s2"])
  } finally {
    restore()
  }
})

test("loadAllSessions keeps other projects when one directory fetch rejects", async () => {
  const restore = withLoadAllSessionsEnv({
    projects: [{ id: "proj_a", path: "/Users/me/a" }, { id: "proj_b", path: "/Users/me/b" }],
    sessionsByProject: { proj_b: [{ id: "kept" }] },
    runtime: {
      listSessionsForDirectory: async (directory) => {
        if (directory === "/Users/me/a") return [{ id: "s1", directory: "/Users/me/a" }]
        throw new Error("runtime not ready")
      }
    }
  })
  try {
    await loadAllSessions()
    assert.deepEqual(__test.state.sessionsByProject.proj_a.map((s) => s.id), ["s1"])
    // proj_b's fetch failed → its existing list is left untouched, not blanked.
    assert.deepEqual(__test.state.sessionsByProject.proj_b.map((s) => s.id), ["kept"])
  } finally {
    restore()
  }
})

test("loadAllSessions makes no requests when the runtime is not running", async () => {
  let called = false
  const restore = withLoadAllSessionsEnv({
    projects: [{ id: "proj_a", path: "/Users/me/a" }],
    runtime: { listSessionsForDirectory: async () => { called = true; return [] } }
  })
  __test.state.runtime = { status: "starting" } // override the running default
  try {
    await loadAllSessions()
    assert.equal(called, false)
  } finally {
    restore()
  }
})

test("loadAllSessions coalesces concurrent calls into a single pass", async () => {
  let calls = 0
  const restore = withLoadAllSessionsEnv({
    projects: [{ id: "proj_a", path: "/Users/me/a" }],
    runtime: {
      listSessionsForDirectory: async () => {
        calls += 1
        await new Promise((r) => setTimeout(r, 5))
        return [{ id: "s1", directory: "/Users/me/a" }]
      }
    }
  })
  try {
    await Promise.all([loadAllSessions(), loadAllSessions(), loadAllSessions()])
    assert.equal(calls, 1) // the in-flight guard collapsed 3 concurrent calls into one pass
  } finally {
    restore()
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

test("selectSession views a cross-project chat without restarting the runtime", async () => {
  const previousDocument = global.document
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.document = fakeDocument()
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  let openProjectCalled = false
  let listMessagesArgs = null
  global.window.openworking = {
    runtime: {
      async openProject() { openProjectCalled = true; throw new Error("should not restart on view") },
      async listMessages(args) { listMessagesArgs = args; return [] }
    },
    attachments: { async discard() {} }
  }

  const { selectSession, state } = __test
  Object.assign(state, {
    nav: "projects",
    projects: [
      { id: "proj_active", name: "Active", path: "/tmp/active" },
      { id: "proj_other", name: "Other", path: "/tmp/other" }
    ],
    // Runtime is running on the ACTIVE project; we click a chat in the OTHER project.
    activeProjectId: "proj_active",
    activeSessionId: null,
    runtime: { status: "running", project: { id: "proj_active" }, sessionStatuses: {} },
    sessionsByProject: { proj_other: [{ id: "ses_1", directory: "/tmp/other" }] },
    threads: new Map(),
    pendingAttachments: [],
    pendingFileMentions: [],
    toast: null
  })

  try {
    await selectSession("proj_other", "ses_1")

    assert.equal(openProjectCalled, false, "must NOT restart the runtime just to view")
    assert.deepEqual(listMessagesArgs, { sessionId: "ses_1", directory: "/tmp/other" })
    assert.equal(state.activeProjectId, "proj_other")
    assert.equal(state.activeSessionId, "ses_1")
    assert.equal(state.nav, "session")
  } finally {
    state.toast = null
    global.document = previousDocument
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("selectSession dismisses a context menu left open on another row", async () => {
  const previousDocument = global.document
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.document = fakeDocument()
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  global.window.openworking = {
    runtime: {
      async openProject() { throw new Error("should not restart on view") },
      async listMessages() { return [] }
    },
    attachments: { async discard() {} }
  }

  const { selectSession, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_a", name: "A", path: "/tmp/a" }],
    activeProjectId: "proj_a",
    activeSessionId: "ses_1",
    runtime: { status: "running", project: { id: "proj_a" }, sessionStatuses: {} },
    sessionsByProject: { proj_a: [{ id: "ses_1", directory: "/tmp/a" }, { id: "ses_2", directory: "/tmp/a" }] },
    threads: new Map(),
    pendingAttachments: [],
    pendingFileMentions: [],
    toast: null
  })
  // The kebab menu is open on ses_1; the user clicks ses_2's row.
  state.sessionMenu = sessionRowKey("proj_a", "ses_1")

  try {
    await selectSession("proj_a", "ses_2")
    assert.equal(state.sessionMenu, null, "selecting another session must close the open context menu")
    assert.equal(state.activeSessionId, "ses_2")
  } finally {
    state.sessionMenu = null
    state.toast = null
    global.document = previousDocument
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("selectSession during a still-starting runtime keeps the accordion open and does not collapse it", async () => {
  const previousDocument = global.document
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const previousExpanded = __test.state.expanded
  global.document = fakeDocument()
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  let openProjectCalled = false
  global.window.openworking = {
    runtime: {
      // openProject's same-project branch would TOGGLE the accordion CLOSED — clicking a session
      // must never reach it while the runtime is starting.
      async openProject() { openProjectCalled = true; throw new Error("should not cold-start while starting") },
      async listMessages() { return [] }
    },
    attachments: { async discard() {} }
  }

  const { selectSession, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_a", name: "A", path: "/tmp/a" }],
    activeProjectId: "proj_a",
    activeSessionId: null,
    // Runtime is mid-startup (the user clicked before init finished) on this same project.
    runtime: { status: "starting", project: { id: "proj_a" }, sessionStatuses: {} },
    sessionsByProject: { proj_a: [{ id: "ses_1", directory: "/tmp/a" }] },
    threads: new Map(),
    pendingAttachments: [],
    pendingFileMentions: [],
    toast: null
  })
  state.expanded = new Set(["proj_a"])

  try {
    await selectSession("proj_a", "ses_1")

    assert.equal(openProjectCalled, false, "a starting runtime must not trigger openProject's toggle-collapse")
    assert.ok(state.expanded.has("proj_a"), "the clicked project's accordion must stay expanded")
    assert.equal(state.activeSessionId, "ses_1")
  } finally {
    state.toast = null
    state.expanded = previousExpanded
    global.document = previousDocument
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

// Builds a minimal event whose target.closest(selector) matches when the selector's attribute
// is in `attrs`, returning a fake element carrying that attribute's value in dataset.
function fakeDelegatedEvent(attrs) {
  const dataset = {}
  for (const [attr, value] of Object.entries(attrs)) {
    const key = attr.replace(/^data-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    dataset[key] = value
  }
  const target = {
    closest(selector) {
      // selector looks like "[data-foo]" — extract the attribute name.
      const attr = selector.slice(1, -1)
      if (!(attr in attrs)) return null
      return { dataset, matches: (sel) => sel === selector }
    }
  }
  return { type: "click", target, preventDefault() {}, stopPropagation() {} }
}

// Builds a fake element chain [outermost ... innermost]. Each node declares its data-* attrs.
// closest(sel) walks from the node up the chain; contains(other) is true when `other` is at or
// below this node. Returns the innermost node (the event target).
function fakeElementChain(nodes) {
  const elements = nodes.map((attrs) => ({ attrs, parent: null }))
  for (let i = 1; i < elements.length; i++) elements[i].parent = elements[i - 1]
  const depthOf = (el) => elements.indexOf(el)
  for (const el of elements) {
    el.dataset = {}
    for (const [attr, value] of Object.entries(el.attrs)) {
      const key = attr.replace(/^data-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())
      el.dataset[key] = value
    }
    el.matches = (sel) => sel.slice(1, -1) in el.attrs
    el.closest = (sel) => {
      const attr = sel.slice(1, -1)
      let cur = el
      while (cur) {
        if (attr in cur.attrs) return cur
        cur = cur.parent
      }
      return null
    }
    el.contains = (other) => other && depthOf(other) >= depthOf(el)
  }
  return elements[elements.length - 1]
}

test("dispatchDelegated honors the data-stop-click boundary (confirm fires, backdrop cancel does not)", () => {
  const { dispatchDelegated } = __test
  // backdrop[data-action=cancel] > content[data-stop-click] > button[data-action=confirm]
  const target = fakeElementChain([
    { "data-action": "cancelModal" },
    { "data-stop-click": "" },
    { "data-action": "confirmModal" }
  ])
  const seen = []
  const table = [["data-action", (shim) => seen.push(shim.currentTarget.dataset.action)]]
  dispatchDelegated({ type: "click", target, preventDefault() {}, stopPropagation() {} }, table)
  assert.deepEqual(seen, ["confirmModal"], "the confirm button inside the modal must fire, not the backdrop cancel")

  // Clicking the modal content itself (inside the boundary) must NOT trigger the backdrop cancel.
  const contentTarget = fakeElementChain([
    { "data-action": "cancelModal" },
    { "data-stop-click": "" }
  ])
  const seen2 = []
  const table2 = [["data-action", (shim) => seen2.push(shim.currentTarget.dataset.action)]]
  dispatchDelegated({ type: "click", target: contentTarget, preventDefault() {}, stopPropagation() {} }, table2)
  assert.deepEqual(seen2, [], "clicking inside the modal content must not cancel via the backdrop")
})

test("dispatchDelegated runs the matching entry with a shim whose currentTarget is the matched element", () => {
  const { dispatchDelegated } = __test
  let received = null
  const table = [
    ["data-nope", () => { throw new Error("should not match") }],
    ["data-action", (shim) => { received = shim.currentTarget.dataset.action }]
  ]
  dispatchDelegated(fakeDelegatedEvent({ "data-action": "saveConfig" }), table)
  assert.equal(received, "saveConfig")
})

test("dispatchDelegated stops after the first matching entry (most-specific wins)", () => {
  const { dispatchDelegated } = __test
  const calls = []
  // The element carries BOTH attributes; the table lists the specific one first, so only it runs.
  const table = [
    ["data-session-menu", () => calls.push("menu")],
    ["data-session-id", () => calls.push("row")]
  ]
  dispatchDelegated(fakeDelegatedEvent({ "data-session-menu": "ses_1", "data-session-id": "ses_1" }), table)
  assert.deepEqual(calls, ["menu"], "a kebab click must not also trigger the row's selectSession")
})

test("session menu state is scoped by project and session row", () => {
  const previousDocument = global.document
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousSessionMenu = __test.state.sessionMenu
  global.document = fakeDocument()
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { dispatchDelegated, getDelegatedClick } = __test
  try {
    __test.state.sessionMenu = null
    dispatchDelegated(fakeDelegatedEvent({
      "data-session-menu": "ses_1",
      "data-session-project": "proj_a"
    }), getDelegatedClick())
    assert.equal(__test.state.sessionMenu, sessionRowKey("proj_a", "ses_1"))

    dispatchDelegated(fakeDelegatedEvent({
      "data-session-menu": "ses_1",
      "data-session-project": "proj_b"
    }), getDelegatedClick())
    assert.equal(__test.state.sessionMenu, sessionRowKey("proj_b", "ses_1"))

    dispatchDelegated(fakeDelegatedEvent({
      "data-session-menu": "ses_1",
      "data-session-project": "proj_b"
    }), getDelegatedClick())
    assert.equal(__test.state.sessionMenu, null)
  } finally {
    __test.state.sessionMenu = previousSessionMenu
    global.document = previousDocument
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("delete session target carries project id and refreshes the clicked project", async () => {
  const previousDocument = global.document
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const state = __test.state
  const previousState = {
    projects: state.projects,
    sessionsByProject: state.sessionsByProject,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    runtime: state.runtime,
    threads: state.threads,
    sessionDeleteTarget: state.sessionDeleteTarget,
    sessionDeleting: state.sessionDeleting,
    sessionDeleteError: state.sessionDeleteError,
    sessionMenu: state.sessionMenu,
    loading: state.loading,
    toast: state.toast,
    commands: state.commands,
    commandMenu: state.commandMenu
  }
  global.document = fakeDocument()
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  let currentProjectId = "proj_active"
  const openedProjects = []
  let deletedSessionId = null
  global.window.openworking = {
    runtime: {
      async openProject(project) {
        currentProjectId = project.id
        openedProjects.push(project.id)
        return { status: "running", project: { id: project.id }, sessionStatuses: {} }
      },
      async listCommands() { return [] },
      async deleteSession({ sessionId }) {
        deletedSessionId = sessionId
        assert.equal(currentProjectId, "proj_other")
        return true
      },
      async listSessions() {
        if (currentProjectId === "proj_other") return [{ id: "other_remaining", directory: "/tmp/other" }]
        return [{ id: "active_session", directory: "/tmp/active" }]
      }
    }
  }

  const { dispatchDelegated, getDelegatedClick, deleteSession } = __test
  try {
    Object.assign(state, {
      projects: [
        { id: "proj_active", name: "Active", path: "/tmp/active" },
        { id: "proj_other", name: "Other", path: "/tmp/other" }
      ],
      sessionsByProject: {
        proj_active: [{ id: "active_session", directory: "/tmp/active" }],
        proj_other: [{ id: "delete_me", directory: "/tmp/other" }]
      },
      activeProjectId: "proj_active",
      activeSessionId: "active_session",
      runtime: { status: "running", project: { id: "proj_active" }, sessionStatuses: {} },
      threads: new Map([["delete_me", { sessionId: "delete_me", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      sessionDeleteTarget: null,
      sessionDeleting: false,
      sessionDeleteError: null,
      sessionMenu: null,
      loading: false,
      toast: null,
      commands: [],
      commandMenu: { open: false, query: "", index: 0 }
    })

    dispatchDelegated(fakeDelegatedEvent({
      "data-session-delete": "delete_me",
      "data-session-project": "proj_other",
      "data-session-title": "Delete me"
    }), getDelegatedClick())

    assert.deepEqual(state.sessionDeleteTarget, {
      sessionId: "delete_me",
      projectId: "proj_other",
      title: "Delete me"
    })

    await deleteSession(state.sessionDeleteTarget)

    assert.equal(deletedSessionId, "delete_me")
    assert.deepEqual(openedProjects, ["proj_other", "proj_active"])
    assert.deepEqual(state.sessionsByProject.proj_other.map((session) => session.id), ["other_remaining"])
    assert.deepEqual(state.sessionsByProject.proj_active.map((session) => session.id), ["active_session"])
    assert.equal(state.activeSessionId, "active_session")
    assert.equal(state.threads.has("delete_me"), false)
  } finally {
    Object.assign(state, previousState)
    global.document = previousDocument
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("confirm delete session keeps the modal open with loading and inline errors", async () => {
  const previousDocument = global.document
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const state = __test.state
  const previousState = {
    projects: state.projects,
    sessionsByProject: state.sessionsByProject,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    runtime: state.runtime,
    threads: state.threads,
    sessionDeleteTarget: state.sessionDeleteTarget,
    sessionDeleting: state.sessionDeleting,
    sessionDeleteError: state.sessionDeleteError,
    loading: state.loading,
    toast: state.toast
  }
  global.document = fakeDocument()
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  let rejectDelete = null
  global.window.openworking = {
    runtime: {
      async deleteSession() {
        return new Promise((_resolve, reject) => {
          rejectDelete = reject
        })
      },
      async listSessions() {
        throw new Error("should not refresh after delete failure")
      }
    }
  }

  const { confirmDeleteSession } = __test
  try {
    Object.assign(state, {
      projects: [{ id: "proj_active", name: "Active", path: "/tmp/active" }],
      sessionsByProject: { proj_active: [{ id: "delete_me", directory: "/tmp/active" }] },
      activeProjectId: "proj_active",
      activeSessionId: "delete_me",
      runtime: { status: "running", project: { id: "proj_active" }, sessionStatuses: {} },
      threads: new Map(),
      sessionDeleteTarget: { sessionId: "delete_me", projectId: "proj_active", title: "Delete me" },
      sessionDeleting: false,
      sessionDeleteError: null,
      loading: false,
      toast: null
    })

    const pending = confirmDeleteSession()

    assert.equal(state.sessionDeleting, true)
    assert.equal(state.sessionDeleteError, null)
    assert.match(global.document.getElementById("root").innerHTML, /Deleting\.\.\./)

    rejectDelete(new Error("Runtime delete failed"))
    await pending

    assert.deepEqual(state.sessionDeleteTarget, { sessionId: "delete_me", projectId: "proj_active", title: "Delete me" })
    assert.equal(state.sessionDeleting, false)
    assert.equal(state.sessionDeleteError, "Runtime delete failed")
    assert.match(global.document.getElementById("root").innerHTML, /Runtime delete failed/)
  } finally {
    Object.assign(state, previousState)
    global.document = previousDocument
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("DELEGATED_CLICK orders menu/kebab attributes before their enclosing rows", () => {
  const { getDelegatedClick } = __test
  const order = getDelegatedClick().map(([attribute]) => attribute)
  const before = (a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    assert.ok(ia !== -1 && ib !== -1, `${a} and ${b} must both be registered`)
    assert.ok(ia < ib, `${a} must be checked before ${b} so stopPropagation ordering is preserved`)
  }
  // Session kebab/menu items resolve before the row's open handler.
  before("data-session-menu", "data-session-id")
  before("data-session-pin", "data-session-id")
  before("data-session-delete", "data-session-id")
  before("data-session-rename", "data-session-id")
  // Project kebab/menu items resolve before opening the project accordion.
  before("data-project-menu", "data-open-project")
  before("data-project-pin", "data-open-project")
  // data-action is the broad fallback and must be last.
  assert.equal(order[order.length - 1], "data-action")
})

test("renderSidebarInto rewrites only #sidebarRoot and leaves #root untouched", () => {
  const previousDocument = global.document
  const { root, sidebarRoot, sideScroll, document } = fakeSidebarScrollDocument({
    resetOnSidebarRender: true,
    scrollTop: 240
  })
  root.innerHTML = "ORIGINAL_ROOT"
  sidebarRoot.innerHTML = "OLD_SIDEBAR"
  sideScroll.scrollTop = 240
  global.document = document

  const { renderSidebarInto } = __test
  try {
    renderSidebarInto()
    assert.notEqual(sidebarRoot.innerHTML, "OLD_SIDEBAR", "sidebar should be repainted")
    assert.ok(sidebarRoot.innerHTML.includes("sidebar"), "sidebar markup should be present")
    assert.equal(root.innerHTML, "ORIGINAL_ROOT", "#root must not be rewritten by a sidebar-only repaint")
    assert.equal(sideScroll.scrollTop, 240, "sidebar-only repaint must preserve sidebar scroll")
  } finally {
    global.document = previousDocument
  }
})

test("full render preserves sidebar scroll while rebuilding #root", () => {
  const previousDocument = global.document
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const { root, sideScroll, document } = fakeSidebarScrollDocument({
    resetOnRootRender: true,
    scrollTop: 360
  })
  root.innerHTML = "ORIGINAL_ROOT"
  sideScroll.scrollTop = 360
  global.document = document
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    document: state.document,
    rightSidebarOpen: state.rightSidebarOpen,
    diagnosticsOpen: state.diagnosticsOpen,
    sidebarCollapsed: state.sidebarCollapsed,
    toast: state.toast
  }

  try {
    Object.assign(state, {
      nav: "session",
      projects: [],
      activeProjectId: null,
      document: null,
      rightSidebarOpen: false,
      diagnosticsOpen: false,
      sidebarCollapsed: false,
      toast: null
    })

    render()

    assert.notEqual(root.innerHTML, "ORIGINAL_ROOT", "full render should rebuild #root")
    assert.equal(sideScroll.scrollTop, 360, "full render must preserve sidebar scroll")
  } finally {
    Object.assign(state, previousState)
    global.document = previousDocument
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})
