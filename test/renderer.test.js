const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const { JSDOM } = require("jsdom")

const optimisticUserCalls = []
let optimisticUserId = 0

// jsdom-backed harness: the renderer's single render path mounts the compiled Svelte islands
// into real DOM, so tests exercise the same pipeline as the app. The bundle is built by pretest
// (build:renderer). Frames are made synchronous for determinism. IMPORTANT: global.document is
// attached AFTER require("../src/renderer") below, so the module's boot block (delegated #root
// listeners, window.openworking subscriptions, loadInitialState) stays skipped exactly as it
// always was in this harness — tests drive flows directly.
const jsdomEnv = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: "http://localhost/",
  runScripts: "outside-only",
  pretendToBeVisual: true
})
const jsdomWindow = jsdomEnv.window
jsdomWindow.requestAnimationFrame = (callback) => { callback(); return 1 }
jsdomWindow.cancelAnimationFrame = () => {}
if (!jsdomWindow.Element.prototype.animate) {
  jsdomWindow.Element.prototype.animate = function animate(_keyframes, options = {}) {
    let finish = null
    let cancelled = false
    const animation = {
      currentTime: Number(options.duration) || 0,
      playState: "running",
      effect: {},
      cancel() {
        cancelled = true
        this.playState = "idle"
      },
      get onfinish() { return finish },
      set onfinish(callback) {
        finish = callback
        queueMicrotask(() => {
          if (!cancelled && typeof finish === "function") finish()
        })
      }
    }
    return animation
  }
}

global.window = jsdomWindow

window.OpenWorkingThreadStream = {
    admitPendingInput(thread, input) {
      const message = thread?.messages?.find((item) => item.id === input?.id)
      if (message) {
        message.optimistic = false
        message.inputState = input.delivery === "steer" ? "steering" : "queued"
      }
      return Boolean(message)
    },
    addOptimisticUser(thread, text, attachments = [], options = {}) {
      optimisticUserCalls.push({ thread, text, attachments, options })
      const id = options.id || `local_${++optimisticUserId}`
      if (Array.isArray(thread?.messages)) {
        thread.messages.push({
          id,
          role: "user",
          optimistic: true,
          inputState: options.inputState,
          delivery: options.delivery,
          parts: [{ type: "text", text }]
        })
      }
      return id
    },
    applyThreadEvent() {},
    clearPendingPermission(thread, requestID) {
      if (!Array.isArray(thread?.pendingPermissions)) return false
      const index = thread.pendingPermissions.findIndex((item) => item.requestID === requestID)
      if (index === -1) return false
      thread.pendingPermissions.splice(index, 1)
      return true
    },
    clearPendingForm(thread, formID) {
      if (!Array.isArray(thread?.pendingForms)) return false
      const index = thread.pendingForms.findIndex((item) => item.id === formID)
      if (index === -1) return false
      thread.pendingForms.splice(index, 1)
      return true
    },
    clearPendingQuestion(thread, requestID) {
      if (!Array.isArray(thread?.pendingQuestions)) return false
      const index = thread.pendingQuestions.findIndex((item) => item.requestID === requestID)
      if (index === -1) return false
      thread.pendingQuestions.splice(index, 1)
      return true
    },
    createThreadStream(sessionId) {
      return { sessionId, messages: [], pendingQuestions: [], pendingPermissions: [], pendingForms: [], status: { type: "idle" } }
    },
    hasRunningTool(thread) {
      for (let index = (thread?.messages?.length || 0) - 1; index >= 0; index -= 1) {
        const message = thread.messages[index]
        if (message.role === "user") return false
        if (message.parts.some((part) => (
          part.type === "tool" && (part.state?.status === "pending" || part.state?.status === "running")
        ))) return true
      }
      return false
    },
    hydrateThread(thread, sessionId, messages, status) {
      // Hydration tests pass the messages they expect to land in the thread. Tests that only
      // exercise the surrounding flow pre-seed thread.messages and stub listMessages with [],
      // so an empty list never clears what the test already put there.
      thread.sessionId = sessionId
      if (Array.isArray(messages) && messages.length) thread.messages = messages
      thread.status = status || thread.status || { type: "idle" }
      return thread
    },
    markInputDeliveryUnknown(thread, inputId) {
      const message = thread?.messages?.find((item) => item.id === inputId)
      if (message) message.inputState = "delivery-unknown"
      return Boolean(message)
    },
    messageCopyText(message) {
      return (message?.parts || [])
        .filter((part) => part.type === "text" && !part.synthetic && !part.ignored)
        .map((part) => part.text || "")
        .join("\n")
        .trim()
    },
    needsThreadRehydration() { return true },
    userMessageFileRefs() { return [] },
    messageText() { return "" },
    removeOptimisticUser(thread, inputId) {
      const index = thread?.messages?.findIndex((message) => message.id === inputId) ?? -1
      if (index === -1) return false
      thread.messages.splice(index, 1)
      return true
    },
    resetThread(_thread, sessionId) {
      return { sessionId, messages: [], pendingQuestions: [], pendingPermissions: [], pendingForms: [], status: { type: "idle" } }
    },
    threadIsBusy(thread) {
      const type = thread?.status?.type
      return type === "busy" || type === "retry"
    }
}

window.OpenWorkingDiffView = {
  parseUnifiedDiff() { return null }
}

// Load the islands bundle into the jsdom window as a classic script (same as index.html does),
// so require("../src/renderer") below picks the Svelte islands.
jsdomWindow.eval(fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "dist", "svelte-islands.js"), "utf8"))

global.localStorage = {
  getItem() { return null },
  setItem() {},
  removeItem() {}
}

function resetOptimisticUserCalls() {
  optimisticUserCalls.length = 0
}

function stripInputContract(payload) {
  assert.match(payload.inputId, /^msg_[A-Za-z0-9_-]{8,128}$/)
  assert.equal(payload.delivery, "queue")
  assert.equal(payload.resume, true)
  const { inputId, delivery, resume, ...rest } = payload
  return rest
}

function stripInputContractsFromCalls(calls) {
  return calls.map((call) => (
    (call[0] === "prompt" || call[0] === "command")
      ? [call[0], stripInputContract(call[1])]
      : call
  ))
}

const {
  applyPendingFileMentions,
  chooseSessionAfterRuntimeReconnect,
  collectLiveFileMentions,
  computePromptAttachments,
  canonicalToken,
  fileMentionTokenForPath,
  fileMentionTokenPattern,
  filterPromptAttachments,
  livePendingFileMentions,
  loadAllSessions,
  parsePromptTokens,
  removeComposerTokenBoundary,
  renderPromptTokensHtml,
  sessionsForProjectPath,
  loadStoredExpanded,
  persistExpanded,
  replaceComposerQuery,
  resolveFileMentionsFromPrompt,
  setProjectSessions,
  sessionRowKey,
  sortSessionsByUpdated,
  __test
} = require("../src/renderer")

// Attach the real DOM only after the module loaded (see the harness note above).
global.document = jsdomWindow.document
global.requestAnimationFrame = jsdomWindow.requestAnimationFrame
global.cancelAnimationFrame = jsdomWindow.cancelAnimationFrame
// DOM constructors the renderer references as bare globals (browser-style).
global.Node = jsdomWindow.Node
// The production renderer loads marked/highlight.js before renderer.js. Keep lightweight defaults
// in the shared harness so async Svelte transition paints exercise that same contract.
global.marked = {
  Renderer: class Renderer {},
  parse(text) { return `<p>${text}</p>` }
}
global.hljs = {
  getLanguage() { return false },
  highlight(text) { return { value: text } }
}

function setPromptTestState({ commands = [], pendingAttachments = [] } = {}) {
  Object.assign(__test.state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: "sess_existing",
    sessionsByProject: { proj_1: [{ id: "sess_existing", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "",
    pendingAttachments,
    pendingFileMentions: [],
    commands,
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })
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

test("sidebar project toggle is local-only and swaps neutral closed/open folder icons", () => {
  const previousStorage = global.localStorage
  const previousOpenworking = global.window.openworking
  const state = __test.state
  const previous = {
    projects: state.projects,
    sessionsByProject: state.sessionsByProject,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    expanded: state.expanded,
    nav: state.nav,
    runtime: state.runtime
  }
  const project = { id: "proj_toggle", name: "Toggle", path: "/tmp/toggle" }
  let openCalls = 0
  global.localStorage = backedLocalStorage()
  global.window.openworking = { runtime: { async openProject() { openCalls += 1 } } }
  Object.assign(state, {
    projects: [project],
    sessionsByProject: { [project.id]: [{ id: "sess_toggle", title: "Chat", directory: project.path }] },
    activeProjectId: project.id,
    activeSessionId: "sess_toggle",
    expanded: new Set(),
    nav: "session",
    runtime: { status: "running", project }
  })

  try {
    __test.render()
    let button = document.querySelector(`[data-toggle-project="${project.id}"]`)
    assert.equal(button.getAttribute("aria-expanded"), "false")
    assert.equal(button.querySelector(".fic").dataset.folderState, "closed")
    assert.match(button.querySelector(".fic").innerHTML, /M20 20a2 2/)

    const addProjectButton = document.querySelector('.side-label [data-action="addProject"]')
    assert.match(addProjectButton.innerHTML, /M5 12h14/)

    __test.renderCounters.reset()
    __test.dispatchDelegated(fakeDelegatedEvent({ "data-toggle-project": project.id }), __test.getDelegatedClick())

    button = document.querySelector(`[data-toggle-project="${project.id}"]`)
    assert.equal(button.getAttribute("aria-expanded"), "true")
    assert.equal(button.querySelector(".fic").dataset.folderState, "open")
    assert.match(button.querySelector(".fic").innerHTML, /m6 14 1\.5-2\.9/)
    assert.equal(openCalls, 0)
    assert.equal(state.activeProjectId, project.id)
    assert.equal(state.activeSessionId, "sess_toggle")
    assert.equal(state.nav, "session")
    assert.equal(__test.renderCounters.snapshot().sidebar, 1)
    assert.equal(__test.renderCounters.snapshot().full, 0)
    assert.deepEqual([...loadStoredExpanded()], [project.id])

    const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8")
    assert.doesNotMatch(css, /\.active-proj\s+\.fic\s*\{[^}]*var\(--accent\)/)
    assert.doesNotMatch(css, /\.proj-head:(?:hover|focus(?:-visible)?)\s+\.fic\s*\{/)
    assert.match(css, /\.fic svg\s*\{[^}]*stroke-width:\s*2/)
    assert.match(css, /\.new-session svg, \.nav-item svg\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*stroke-width:\s*2/)
    assert.match(css, /\.sl-actions\s*\{[^}]*opacity:\s*0/)
    assert.match(css, /\.side-label:hover \.sl-actions, \.side-label:focus-within \.sl-actions\s*\{\s*opacity:\s*1/)
  } finally {
    Object.assign(state, previous)
    global.localStorage = previousStorage
    global.window.openworking = previousOpenworking
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

test("narrow viewport auto-collapses the sidebar only when entering the breakpoint", () => {
  const previousCollapsed = __test.state.sidebarCollapsed
  const previousDocument = global.document
  const appClasses = []
  const sidebarAttributes = new Map()
  global.document = {
    querySelector(selector) {
      if (selector === ".app") {
        return { classList: { toggle(name, enabled) { appClasses.push([name, enabled]) } } }
      }
      if (selector === ".sidebar") {
        return {
          setAttribute(name, value) { sidebarAttributes.set(name, value) },
          removeAttribute(name) { sidebarAttributes.delete(name) }
        }
      }
      return null
    }
  }

  try {
    __test.state.sidebarCollapsed = false
    assert.equal(__test.syncSidebarForViewport(700), true)
    assert.equal(__test.state.sidebarCollapsed, true)
    assert.deepEqual(appClasses, [["collapsed", true]])
    assert.equal(sidebarAttributes.get("aria-hidden"), "true")
    assert.equal(sidebarAttributes.get("inert"), "")

    __test.state.sidebarCollapsed = false
    assert.equal(__test.syncSidebarForViewport(700), true)
    assert.equal(__test.state.sidebarCollapsed, false, "manual drawer opening should survive resize events inside the breakpoint")
    assert.equal(__test.syncSidebarForViewport(900), false)
  } finally {
    __test.state.sidebarCollapsed = previousCollapsed
    global.document = previousDocument
  }
})

test("maxRightFileSidebarWidth clamps the Files panel to the live viewport instead of a fixed max", () => {
  const previousDocument = global.document
  const previousSidebarCollapsed = __test.state.sidebarCollapsed
  const previousDocumentState = __test.state.document
  const setProperties = []
  global.document = {
    querySelector(selector) {
      if (selector === ".app") return { getBoundingClientRect: () => ({ width: 700 }) }
      if (selector === ".sidebar") return { getBoundingClientRect: () => ({ width: 0 }) }
      if (selector === ".document-viewer") return { getBoundingClientRect: () => ({ width: 0 }) }
      return null
    },
    documentElement: {
      style: { setProperty: (name, value) => setProperties.push([name, value]) }
    }
  }

  try {
    __test.state.sidebarCollapsed = true
    __test.state.document = null
    assert.equal(__test.maxRightFileSidebarWidth(), 333, "700 total - 0 sidebar - 7 gutter - 360 chat min")
    assert.equal(__test.setRightFileSidebarWidth(500), 333, "requests above the viewport budget clamp to the budget, not the fixed 420 max")
    assert.equal(__test.setRightFileSidebarWidth(50), 180, "the 180px hard floor still wins even when the budget is tighter")
    assert.deepEqual(setProperties.at(-1), ["--right-sidebar-w", "180px"])
  } finally {
    __test.state.sidebarCollapsed = previousSidebarCollapsed
    __test.state.document = previousDocumentState
    global.document = previousDocument
  }
})

test("a window resize keeps the document panel's current width instead of snapping it to the max", () => {
  const previousDocument = global.document
  const previousStorage = global.localStorage
  const previousGetComputedStyle = global.getComputedStyle
  let documentWidth = "520px"
  global.getComputedStyle = () => ({ getPropertyValue: (name) => (name === "--document-w" ? documentWidth : "") })
  global.document = { documentElement: {} }
  global.localStorage = backedLocalStorage()

  try {
    // Never dragged the divider: nothing stored, so the live 520px default must survive.
    assert.equal(__test.documentViewerWidthForResize(), 520)

    documentWidth = "640px"
    assert.equal(__test.documentViewerWidthForResize(), 640, "a width set by a previous clamp is still the one to preserve")

    // Dragged at some point: the stored width is the bound to restore toward.
    global.localStorage.setItem("openworking:document-viewer-w", "700")
    assert.equal(__test.documentViewerWidthForResize(), 700)

    global.localStorage.setItem("openworking:document-viewer-w", "0")
    documentWidth = "not-a-length"
    assert.equal(__test.documentViewerWidthForResize(), 900, "an unusable stored value and an unreadable var fall back to DOCUMENT_MAX_WIDTH")
  } finally {
    global.document = previousDocument
    global.localStorage = previousStorage
    global.getComputedStyle = previousGetComputedStyle
  }
})

function manualTimerPacer(applyEvent) {
  const timers = []
  const pacer = __test.createStreamPacer({
    applyEvent,
    setTimer(callback, delay) {
      const timer = { callback, delay, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer(timer) {
      timer.cleared = true
    }
  })
  return { pacer, timers }
}

function runNextTimer(timers) {
  const timer = timers.shift()
  assert.ok(timer, "expected a scheduled pacing timer")
  assert.equal(timer.delay, 40)
  assert.equal(timer.cleared, false)
  timer.callback()
}

test("stream pacer splits and replays an upstream delta across 40 ms ticks", () => {
  const applied = []
  const { pacer, timers } = manualTimerPacer((event) => applied.push(event))
  const delta = "Xin chao, day la mot doan stream."
  assert.equal(pacer.enqueue({
    type: "message.part.delta",
    sessionID: "sess_one",
    messageID: "msg_a",
    partID: "part_text",
    field: "text",
    delta
  }), true)

  assert.equal(applied.length, 0)
  assert.equal(timers.length, 1)
  runNextTimer(timers)
  assert.ok(applied.length > 0)
  while (timers.length) runNextTimer(timers)
  assert.equal(applied.map((event) => event.delta).join(""), delta)
  assert.ok(applied.every((event) => Array.from(event.delta).length <= 12))
})

test("stream pacer defers authoritative part updates and idle until queued deltas drain", () => {
  const applied = []
  const { pacer, timers } = manualTimerPacer((event) => applied.push(event))
  const base = {
    type: "message.part.delta",
    sessionID: "sess_one",
    messageID: "msg_a",
    partID: "part_reasoning",
    field: "reasoning"
  }
  pacer.enqueue({ ...base, delta: "Inspecting the project." })
  pacer.defer({
    type: "message.part.updated",
    sessionID: "sess_one",
    part: {
      id: "part_reasoning",
      messageID: "msg_a",
      type: "reasoning",
      text: "Inspecting the project."
    }
  })
  pacer.defer({ type: "session.idle", sessionID: "sess_one" })

  assert.equal(applied.length, 0)
  while (timers.length) runNextTimer(timers)
  assert.equal(applied.filter((event) => event.type === "message.part.delta").map((event) => event.delta).join(""), "Inspecting the project.")
  assert.deepEqual(applied.slice(-2).map((event) => event.type), ["message.part.updated", "session.idle"])
})

test("pacing gate applies to active text and Agent progress but not background sessions", () => {
  const calls = []
  const fakePacer = {
    enqueue(event) { calls.push(["enqueue", event.sessionID, event.field]); return true },
    defer(event) { calls.push(["defer", event.type]); return true },
    flushSession(sessionID) { calls.push(["flush", sessionID]); return true },
    hasPendingPart() { return true },
    hasPendingSession() { return true }
  }
  const base = {
    type: "message.part.delta",
    sessionID: "active",
    messageID: "msg_a",
    partID: "part_text",
    delta: "stream"
  }

  assert.equal(__test.maybeConsumePacedRuntimeEvent({ ...base, field: "text" }, "active", fakePacer), true)
  assert.equal(__test.maybeConsumePacedRuntimeEvent({
    ...base,
    partID: "part_reasoning",
    field: "reasoning"
  }, "active", fakePacer), true)
  assert.equal(__test.maybeConsumePacedRuntimeEvent({
    ...base,
    sessionID: "background",
    field: "text"
  }, "active", fakePacer), false)
  assert.deepEqual(calls, [
    ["enqueue", "active", "text"],
    ["enqueue", "active", "reasoning"]
  ])
})

test("turn completion waits for paced content so Agent progress does not collapse mid-stream", () => {
  const calls = []
  let pending = true
  const fakePacer = {
    enqueue() { return true },
    defer(event) { calls.push(["defer", event.type]); return true },
    flushSession() { return true },
    hasPendingPart() { return false },
    hasPendingSession() { return pending }
  }
  const completed = {
    type: "message.updated",
    sessionID: "active",
    info: { id: "msg_a", role: "assistant", time: { completed: 123 } }
  }

  // The gateway ends the turn milliseconds after the text arrives, long before the pacer has
  // painted it, which would collapse the reasoning rows mid-answer.
  assert.equal(__test.maybeConsumePacedRuntimeEvent(completed, "active", fakePacer), true)

  // Interim step updates carry tokens/cost but no completion, and must not be held back.
  assert.equal(__test.maybeConsumePacedRuntimeEvent({
    type: "message.updated",
    sessionID: "active",
    info: { id: "msg_a", role: "assistant", tokens: { output: 5 } }
  }, "active", fakePacer), false)

  pending = false
  assert.equal(__test.maybeConsumePacedRuntimeEvent(completed, "active", fakePacer), false)
  assert.deepEqual(calls, [["defer", "message.updated"]])
})

test("stream delta splitter preserves Unicode and keeps every segment within the cap", () => {
  const input = "đây_là_một_token_rất_dài_không_có_space"
  const segments = __test.splitStreamDeltaSegments(input, { targetChars: 8, maxChars: 10 })
  assert.ok(segments.length > 1)
  assert.equal(segments.join(""), input)
  assert.ok(segments.every((segment) => Array.from(segment).length <= 10))
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

test("sessionsForProjectPath accepts multiple project paths, keeping sessions matching any of them", () => {
  const sessions = [
    { id: "s1", directory: "/Users/me/main" },
    { id: "s2", directory: "/Users/me/worktrees/feature-x" },
    { id: "s3", directory: "/Users/me/other-project" }
  ]
  assert.deepEqual(
    sessionsForProjectPath(sessions, ["/Users/me/main", "/Users/me/worktrees/feature-x"]).map((s) => s.id),
    ["s1", "s2"]
  )
})

test("setProjectSessions keeps sessions from the project's main path AND its active worktree together", () => {
  const previous = {
    projects: __test.state.projects,
    sessionsByProject: __test.state.sessionsByProject
  }
  __test.state.projects = [{ id: "proj_a", path: "/repo", activeWorktreePath: "/repo-worktrees/feature-x" }]
  __test.state.sessionsByProject = {}
  try {
    const sessions = [
      { id: "old_session", directory: "/repo" },
      { id: "worktree_session", directory: "/repo-worktrees/feature-x" },
      { id: "unrelated", directory: "/somewhere-else" }
    ]
    const result = setProjectSessions("proj_a", sessions, "directory")
    assert.deepEqual(result.map((s) => s.id).sort(), ["old_session", "worktree_session"])
  } finally {
    __test.state.projects = previous.projects
    __test.state.sessionsByProject = previous.sessionsByProject
  }
})

test("setProjectSessions accepts active no-directory sessions and removes that id from other projects", () => {
  const previous = {
    projects: __test.state.projects,
    sessionsByProject: __test.state.sessionsByProject,
    subagentSessionIds: __test.state.subagentSessionIds
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
    __test.state.subagentSessionIds = new Set()

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
    __test.state.subagentSessionIds = previous.subagentSessionIds
  }
})

test("setProjectSessions excludes tracked subagent sessions from sidebar state", () => {
  const previous = {
    projects: __test.state.projects,
    sessionsByProject: __test.state.sessionsByProject,
    subagentSessionIds: __test.state.subagentSessionIds
  }
  try {
    __test.state.projects = [{ id: "proj_a", path: "/Users/me/a" }]
    __test.state.sessionsByProject = {}
    __test.state.subagentSessionIds = new Set(["sess_sub"])

    const stored = setProjectSessions("proj_a", [
      { id: "sess_sub", directory: "/Users/me/a" },
      { id: "sess_top", directory: "/Users/me/a" }
    ], "directory")

    assert.deepEqual(stored.map((session) => session.id), ["sess_top"])
    assert.deepEqual(__test.state.sessionsByProject.proj_a.map((session) => session.id), ["sess_top"])
  } finally {
    __test.state.projects = previous.projects
    __test.state.sessionsByProject = previous.sessionsByProject
    __test.state.subagentSessionIds = previous.subagentSessionIds
  }
})

test("sortSessionsByUpdated sorts newest first, keeps ties stable, and puts missing timestamps last", () => {
  const sessions = [
    { id: "missing" },
    { id: "new_numeric", time: { updated: 300 } },
    { id: "tie_first", time: { updated: "2026-08-07T10:00:00.000Z" } },
    { id: "invalid", time: { updated: "not-a-date" } },
    { id: "tie_second", time: { updated: "2026-08-07T10:00:00.000Z" } },
    { id: "old_numeric", time: { updated: 100 } }
  ]
  const sorted = sortSessionsByUpdated(sessions)
  assert.deepEqual(sorted.map((session) => session.id), ["tie_first", "tie_second", "new_numeric", "old_numeric", "missing", "invalid"])
  assert.deepEqual(sessions.map((session) => session.id), ["missing", "new_numeric", "tie_first", "invalid", "tie_second", "old_numeric"])
})

test("setProjectSessions sorts after directory filtering, dedupe, and subagent removal without changing pin order", () => {
  const previous = {
    projects: __test.state.projects,
    sessionsByProject: __test.state.sessionsByProject,
    subagentSessionIds: __test.state.subagentSessionIds,
    pinnedSessions: __test.state.pinnedSessions
  }
  try {
    __test.state.projects = [{ id: "proj_a", path: "/repo", activeWorktreePath: "/worktree" }]
    __test.state.sessionsByProject = {}
    __test.state.subagentSessionIds = new Set(["subagent"])
    __test.state.pinnedSessions = new Map([
      ["older", { projectId: "proj_a" }],
      ["newer", { projectId: "proj_a" }]
    ])

    const stored = setProjectSessions("proj_a", [
      { id: "older", directory: "/repo", time: { updated: 100 } },
      { id: "newer", directory: "/worktree", time: { updated: 300 } },
      { id: "older", directory: "/repo", time: { updated: 999 } },
      { id: "subagent", directory: "/repo", time: { updated: 500 } },
      { id: "wrong", directory: "/elsewhere", time: { updated: 1000 } }
    ], "directory")

    assert.deepEqual(stored.map((session) => session.id), ["newer", "older"])
    assert.deepEqual([...__test.state.pinnedSessions.keys()], ["older", "newer"])
  } finally {
    __test.state.projects = previous.projects
    __test.state.sessionsByProject = previous.sessionsByProject
    __test.state.subagentSessionIds = previous.subagentSessionIds
    __test.state.pinnedSessions = previous.pinnedSessions
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

test("subagent run-tree updates hide child sessions without hiding explicit user forks", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousState = {
    projects: __test.state.projects,
    sessionsByProject: __test.state.sessionsByProject,
    subagentRunTreesByRoot: __test.state.subagentRunTreesByRoot,
    subagentSessionIds: __test.state.subagentSessionIds,
    activeProjectId: __test.state.activeProjectId,
    activeSessionId: __test.state.activeSessionId,
    runtime: __test.state.runtime,
    pinnedSessions: __test.state.pinnedSessions
  }
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  try {
    Object.assign(__test.state, {
      projects: [{ id: "proj_a", path: "/Users/me/a" }],
      sessionsByProject: {
        proj_a: [
          { id: "sess_parent", directory: "/Users/me/a" },
          { id: "sess_sub", parentID: "sess_parent", directory: "/Users/me/a" },
          { id: "sess_fork", parentID: "sess_parent", fork: { sessionID: "sess_parent" }, directory: "/Users/me/a" }
        ]
      },
      subagentRunTreesByRoot: new Map(),
      subagentSessionIds: new Set(),
      activeProjectId: "proj_a",
      activeSessionId: "sess_parent",
      runtime: { status: "running", project: { id: "proj_a" }, sessionStatuses: {} },
      pinnedSessions: new Map([["sess_sub", { projectId: "proj_a", title: "Child" }]])
    })

    // Subagent sessions are detected from the `task` tool part that spawned them — the
    // `session.created` event carries no reliable parent link, so it is ignored on purpose.
    __test.handleRuntimeStream({
      type: "subagent.run-tree.updated",
      rootSessionId: "sess_parent",
      tree: {
        rootSessionId: "sess_parent",
        revision: 1,
        truncated: false,
        runs: [{
          sessionId: "sess_sub",
          parentSessionId: "sess_parent",
          status: "running",
          children: []
        }]
      }
    })

    assert.equal(__test.state.subagentSessionIds.has("sess_sub"), true)
    assert.deepEqual(__test.state.sessionsByProject.proj_a.map((session) => session.id), ["sess_parent", "sess_fork"])
    assert.equal(__test.state.pinnedSessions.has("sess_sub"), true, "suppression must not delete the saved pin")
  } finally {
    Object.assign(__test.state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("subagent run-tree state rejects stale revisions", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousState = {
    subagentRunTreesByRoot: __test.state.subagentRunTreesByRoot,
    subagentSessionIds: __test.state.subagentSessionIds,
    activeSessionId: __test.state.activeSessionId
  }
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  try {
    Object.assign(__test.state, {
      subagentRunTreesByRoot: new Map(),
      subagentSessionIds: new Set(),
      activeSessionId: null
    })
    __test.applySubagentRunTree({
      rootSessionId: "sess_parent",
      revision: 2,
      truncated: false,
      runs: [{ sessionId: "new", parentSessionId: "sess_parent", status: "succeeded", children: [] }]
    })
    __test.applySubagentRunTree({
      rootSessionId: "sess_parent",
      revision: 1,
      truncated: false,
      runs: [{ sessionId: "stale", parentSessionId: "sess_parent", status: "running", children: [] }]
    })
    assert.equal(__test.state.subagentSessionIds.has("new"), true)
    assert.equal(__test.state.subagentSessionIds.has("stale"), false)
  } finally {
    Object.assign(__test.state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("a late tree for another session cannot replace the active session tree", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousState = {
    subagentRunTreesByRoot: __test.state.subagentRunTreesByRoot,
    subagentSessionIds: __test.state.subagentSessionIds,
    activeSessionId: __test.state.activeSessionId
  }
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  try {
    Object.assign(__test.state, {
      subagentRunTreesByRoot: new Map(),
      subagentSessionIds: new Set(),
      activeSessionId: "sess_new"
    })
    __test.applySubagentRunTree({
      rootSessionId: "sess_new",
      revision: 1,
      truncated: false,
      runs: [{ sessionId: "new_child", parentSessionId: "sess_new", status: "running", children: [] }]
    })
    __test.applySubagentRunTree({
      rootSessionId: "sess_old",
      revision: 9,
      truncated: false,
      runs: [{ sessionId: "old_child", parentSessionId: "sess_old", status: "failed", children: [] }]
    })

    assert.equal(__test.subagentRunTree().rootSessionId, "sess_new")
    assert.equal(__test.subagentRunTree().runs[0].sessionId, "new_child")
  } finally {
    Object.assign(__test.state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
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

test("canonical file tokens parse into static chip html", () => {
  const html = renderPromptTokensHtml("Read [README.md](app/models/api_v2/README.md)")
  assert.match(html, /file-mention-token/)
  assert.match(html, /README\.md/)
})

test("canonical skill tokens parse into static chip html", () => {
  const previousCommands = __test.state.commands
  try {
    __test.state.commands = [{
      name: "explain-project",
      source: "skill",
      description: "Explain project",
      path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/explain-project/SKILL.md"
    }]
    const html = renderPromptTokensHtml("Use [explain-project](/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/explain-project/SKILL.md)")
    assert.match(html, /file-mention-token/)
    assert.match(html, /skill-token/)
    assert.match(html, /explain-project/)
  } finally {
    __test.state.commands = previousCommands
  }
})

test("repo-local .agents skill tokens parse into static chip html", () => {
  const previousCommands = __test.state.commands
  try {
    __test.state.commands = [{
      name: "review-skill",
      source: "skill",
      description: "Review from repo-local agents skill",
      path: "/Users/me/workspace/project/.agents/skills/review-skill/SKILL.md"
    }]
    const html = renderPromptTokensHtml("Use [review-skill](/Users/me/workspace/project/.agents/skills/review-skill/SKILL.md)")
    assert.match(html, /file-mention-token/)
    assert.match(html, /skill-token/)
    assert.match(html, /review-skill/)
  } finally {
    __test.state.commands = previousCommands
  }
})

test("home .agents skill tokens parse into static chip html", () => {
  const previousCommands = __test.state.commands
  try {
    __test.state.commands = [{
      name: "home-review",
      source: "skill",
      description: "Review from home agents skill",
      path: "/Users/me/.agents/skills/home-review/SKILL.md",
      locationFamily: "home_agents"
    }]
    const html = renderPromptTokensHtml("Use [home-review](/Users/me/.agents/skills/home-review/SKILL.md)")
    assert.match(html, /file-mention-token/)
    assert.match(html, /skill-token/)
    assert.match(html, /home-review/)
  } finally {
    __test.state.commands = previousCommands
  }
})

test("repo-local .opencode skill tokens parse into static chip html", () => {
  const previousCommands = __test.state.commands
  try {
    __test.state.commands = [{
      name: "repo-opencode",
      source: "skill",
      description: "Review from repo-local opencode skill",
      path: "/Users/me/workspace/project/.opencode/skills/repo-opencode/SKILL.md",
      locationFamily: "repo_opencode"
    }]
    const html = renderPromptTokensHtml("Use [repo-opencode](/Users/me/workspace/project/.opencode/skills/repo-opencode/SKILL.md)")
    assert.match(html, /file-mention-token/)
    assert.match(html, /skill-token/)
    assert.match(html, /repo-opencode/)
  } finally {
    __test.state.commands = previousCommands
  }
})

test("canonical command tokens parse into static chip html", () => {
  const previousCommands = __test.state.commands
  try {
    __test.state.commands = [{
      name: "review",
      source: "command",
      description: "Review changes",
      path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review"
    }]
    const html = renderPromptTokensHtml("Run [review](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review)")
    assert.match(html, /file-mention-token/)
    assert.match(html, /command-token/)
    assert.match(html, /review/)
  } finally {
    __test.state.commands = previousCommands
  }
})

test("mixed skill chip and @file mention both render as chips", () => {
  const previousCommands = __test.state.commands
  try {
    __test.state.commands = [{
      name: "explain-project",
      source: "skill",
      description: "Explain project",
      path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/explain-project/SKILL.md"
    }]
    const html = renderPromptTokensHtml(
      "Use [explain-project](/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/explain-project/SKILL.md) with @README.md",
      [{ token: "@README.md", path: "docs/README.md", name: "README.md" }]
    )
    assert.match(html, /skill-token/)
    assert.match(html, /@README\.md/)
    assert.match(html, /title="docs\/README\.md"/)
  } finally {
    __test.state.commands = previousCommands
  }
})

test("non-managed skill paths stay plain text", () => {
  const previousCommands = __test.state.commands
  try {
    __test.state.commands = [{
      name: "explain-project",
      source: "skill",
      description: "Explain project",
      path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/explain-project/SKILL.md"
    }]
    const html = renderPromptTokensHtml("Use [explain-project](resources/opencode/skills/explain-project/SKILL.md)")
    assert.doesNotMatch(html, /skill-token/)
    assert.match(html, /\[explain-project\]\(resources\/opencode\/skills\/explain-project\/SKILL\.md\)/)
  } finally {
    __test.state.commands = previousCommands
  }
})

test("unknown command tokens stay plain text in the renderer", () => {
  const previousCommands = __test.state.commands
  try {
    __test.state.commands = [{
      name: "review",
      source: "command",
      description: "Review changes",
      path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review"
    }]
    const html = renderPromptTokensHtml("Run [unknown](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/unknown)")
    assert.doesNotMatch(html, /command-token/)
    assert.match(html, /\[unknown\]\(\/Users\/me\/Library\/Application Support\/OpenWorking\/opencode-profile\/commands\/unknown\)/)
  } finally {
    __test.state.commands = previousCommands
  }
})

test("non-supported markdown links stay plain text", () => {
  const html = renderPromptTokensHtml("Read [docs](https://example.com)")
  assert.doesNotMatch(html, /file-mention-token/)
  assert.match(html, /\[docs\]\(https:\/\/example\.com\)/)
})

test("parsePromptTokens leaves unsupported links as text parts", () => {
  assert.deepEqual(parsePromptTokens("Read [docs](https://example.com)"), [
    { type: "text", text: "Read " },
    { type: "text", text: "[docs](https://example.com)" }
  ])
})

test("parsePromptTokens accepts a basename:N-M or basename:N snippet label as a file token", () => {
  const rangeToken = parsePromptTokens("Refactor [renderer.js:120-134](src/renderer.js)")
  assert.deepEqual(rangeToken, [
    { type: "text", text: "Refactor " },
    { type: "token", kind: "file", label: "renderer.js:120-134", path: "src/renderer.js", raw: "[renderer.js:120-134](src/renderer.js)" }
  ])

  const singleLineToken = parsePromptTokens("Look at [renderer.js:57](src/renderer.js)")
  assert.deepEqual(singleLineToken, [
    { type: "text", text: "Look at " },
    { type: "token", kind: "file", label: "renderer.js:57", path: "src/renderer.js", raw: "[renderer.js:57](src/renderer.js)" }
  ])
})

test("parsePromptTokens rejects malformed or mismatched snippet labels as plain text", () => {
  // Wrong basename before the ":" - must not be treated as a file token even though it looks close.
  assert.deepEqual(parsePromptTokens("[other.js:12-24](src/renderer.js)"), [
    { type: "text", text: "[other.js:12-24](src/renderer.js)" }
  ])
  // Non-numeric range.
  assert.deepEqual(parsePromptTokens("[renderer.js:a-b](src/renderer.js)"), [
    { type: "text", text: "[renderer.js:a-b](src/renderer.js)" }
  ])
  // Reversed range (end before start).
  assert.deepEqual(parsePromptTokens("[renderer.js:24-12](src/renderer.js)"), [
    { type: "text", text: "[renderer.js:24-12](src/renderer.js)" }
  ])
  // Zero is not a valid 1-based line number.
  assert.deepEqual(parsePromptTokens("[renderer.js:0](src/renderer.js)"), [
    { type: "text", text: "[renderer.js:0](src/renderer.js)" }
  ])
})

test("applyPendingFileMentions serializes a snippet mention as `path:N-M`, and `path:N` for a single line", () => {
  const rangeMention = [{ token: "[renderer.js:120-134](src/renderer.js)", path: "src/renderer.js", name: "renderer.js:120-134" }]
  assert.equal(
    applyPendingFileMentions("Refactor [renderer.js:120-134](src/renderer.js) please", rangeMention),
    "Refactor `src/renderer.js:120-134` please"
  )

  const singleLineMention = [{ token: "[renderer.js:57](src/renderer.js)", path: "src/renderer.js", name: "renderer.js:57" }]
  assert.equal(
    applyPendingFileMentions("Look at [renderer.js:57](src/renderer.js)", singleLineMention),
    "Look at `src/renderer.js:57`"
  )

  // A plain (non-snippet) file mention keeps its existing bare-path serialization.
  const plainMention = [{ token: "[renderer.js](src/renderer.js)", path: "src/renderer.js", name: "renderer.js" }]
  assert.equal(
    applyPendingFileMentions("Read [renderer.js](src/renderer.js)", plainMention),
    "Read `src/renderer.js`"
  )
})

test("local markdown links with descriptive labels stay plain text", () => {
  const html = renderPromptTokensHtml("Read [docs](notes/guide.md)")
  assert.doesNotMatch(html, /file-mention-token/)
  assert.match(html, /\[docs\]\(notes\/guide\.md\)/)
})

test("file suggestion selection replaces @query with canonical file token", () => {
  const next = replaceComposerQuery({
    text: "read @README.md now",
    caret: 15,
    trigger: "file",
    label: "README.md",
    path: "app/models/api_v2/README.md"
  })
  assert.equal(next.text, "read [README.md](app/models/api_v2/README.md) now")
  assert.equal(next.caret, "read [README.md](app/models/api_v2/README.md)".length)
})

test("slash skill selection replaces /query with a canonical skill token", () => {
  const next = replaceComposerQuery({
    text: "use /understand-dashboard",
    caret: 25,
    trigger: "slash",
    label: "understand-dashboard",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/understand-dashboard/SKILL.md",
    source: "skill"
  })
  assert.equal(
    next.text,
    "use [understand-dashboard](/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/understand-dashboard/SKILL.md)"
  )
  assert.equal(next.caret, "use [understand-dashboard](/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/understand-dashboard/SKILL.md)".length)
})

test("slash skill selection keeps a repo-local .agents skill path", () => {
  const next = replaceComposerQuery({
    text: "use /review-skill",
    caret: 17,
    trigger: "slash",
    label: "review-skill",
    path: "/Users/me/workspace/project/.agents/skills/review-skill/SKILL.md",
    source: "skill"
  })
  assert.equal(
    next.text,
    "use [review-skill](/Users/me/workspace/project/.agents/skills/review-skill/SKILL.md)"
  )
  assert.equal(next.caret, "use [review-skill](/Users/me/workspace/project/.agents/skills/review-skill/SKILL.md)".length)
})

test("slash skill selection keeps a home .config/opencode skill path", () => {
  const next = replaceComposerQuery({
    text: "use /home-config-opencode",
    caret: 26,
    trigger: "slash",
    label: "home-config-opencode",
    path: "/Users/me/.config/opencode/skills/home-config-opencode/SKILL.md",
    source: "skill"
  })
  assert.equal(
    next.text,
    "use [home-config-opencode](/Users/me/.config/opencode/skills/home-config-opencode/SKILL.md)"
  )
  assert.equal(next.caret, "use [home-config-opencode](/Users/me/.config/opencode/skills/home-config-opencode/SKILL.md)".length)
})

test("slash command selection replaces /query with a canonical command token", () => {
  const next = replaceComposerQuery({
    text: "run /review",
    caret: 11,
    trigger: "slash",
    label: "review",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review",
    source: "command"
  })
  assert.equal(next.text, "run [review](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review)")
  assert.equal(next.caret, "run [review](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review)".length)
})

test("slash command selection preserves suffix text after inserting a command token", () => {
  const next = replaceComposerQuery({
    text: "run /review please",
    caret: 11,
    trigger: "slash",
    label: "review",
    path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review",
    source: "command"
  })
  assert.equal(next.text, "run [review](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review) please")
  assert.equal(next.caret, "run [review](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review)".length)
})

test("canonicalToken formats label and path", () => {
  assert.equal(canonicalToken("README.md", "app/models/api_v2/README.md"), "[README.md](app/models/api_v2/README.md)")
})

test("backspace after canonical token removes the whole token", () => {
  const text = "read [README.md](app/models/api_v2/README.md) now"
  const next = removeComposerTokenBoundary({
    text,
    caret: "read [README.md](app/models/api_v2/README.md)".length,
    direction: "backward"
  })
  assert.equal(next.text, "read  now")
  assert.equal(next.caret, "read ".length)
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

test("project session load renders error, retries, and becomes ready", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const previous = {
    nav: __test.state.nav,
    projects: __test.state.projects,
    sessionsByProject: __test.state.sessionsByProject,
    sessionLoadsByProject: __test.state.sessionLoadsByProject,
    runtime: __test.state.runtime,
    expanded: __test.state.expanded
  }
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  let calls = 0
  global.window.openworking = {
    runtime: {
      async listSessions() {
        calls += 1
        if (calls === 1) throw new Error("Runtime request timed out (GET /session)")
        return [{ id: "sess_ready", title: "Recovered" }]
      }
    }
  }
  const project = { id: "proj_load", name: "Load project", path: "/tmp/load" }
  Object.assign(__test.state, {
    nav: "projects",
    auth: { saml2Enabled: false, status: "authenticated" },
    projects: [project],
    sessionsByProject: {},
    sessionLoadsByProject: {},
    runtime: { status: "running", project },
    expanded: new Set([project.id])
  })

  try {
    await assert.rejects(__test.loadProjectSessions(project.id), /timed out/)
    assert.equal(__test.projectSessionLoad(project.id).status, "error")
    // The load-error row now renders only through the sidebar island (the string helper was
    // deleted with the legacy path) — mount and assert against the real sidebar DOM.
    __test.render()
    const sidebarHtml = document.getElementById("sidebarRoot").innerHTML
    assert.match(sidebarHtml, /Could not load chats/)
    assert.match(sidebarHtml, /data-retry-project-sessions="proj_load"/)

    await __test.retryProjectSessions(project.id)
    assert.equal(__test.projectSessionLoad(project.id).status, "ready")
    assert.deepEqual(__test.state.sessionsByProject[project.id].map((session) => session.id), ["sess_ready"])
    assert.equal(calls, 2)
  } finally {
    Object.assign(__test.state, previous)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("runtime recovery auto-reloads the active project's sessions only once", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const previous = {
    projects: __test.state.projects,
    sessionsByProject: __test.state.sessionsByProject,
    sessionLoadsByProject: __test.state.sessionLoadsByProject,
    runtime: __test.state.runtime,
    activeProjectId: __test.state.activeProjectId
  }
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  let calls = 0
  global.window.openworking = {
    runtime: {
      async listSessions() {
        calls += 1
        return [{ id: "sess_recovered" }]
      }
    }
  }
  const project = { id: "proj_recover", name: "Recover", path: "/tmp/recover" }
  Object.assign(__test.state, {
    projects: [project],
    activeProjectId: project.id,
    sessionsByProject: {},
    sessionLoadsByProject: {
      [project.id]: { status: "error", generation: 1, error: "failed", autoRetried: false }
    },
    runtime: { status: "error", project }
  })

  try {
    __test.handleRuntimeUpdate({ status: "running", project })
    await new Promise((resolve) => setTimeout(resolve, 0))
    __test.handleRuntimeUpdate({ status: "running", project })
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.equal(calls, 1)
    assert.equal(__test.projectSessionLoad(project.id).status, "ready")
    assert.equal(__test.projectSessionLoad(project.id).autoRetried, true)
  } finally {
    Object.assign(__test.state, previous)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("stale project session response cannot overwrite a newer generation", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const previous = {
    projects: __test.state.projects,
    sessionsByProject: __test.state.sessionsByProject,
    sessionLoadsByProject: __test.state.sessionLoadsByProject
  }
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  let resolveStale
  const stale = new Promise((resolve) => { resolveStale = resolve })
  let calls = 0
  global.window.openworking = {
    runtime: {
      async listSessions() {
        calls += 1
        if (calls === 1) return stale
        return [{ id: "sess_new" }]
      }
    }
  }
  const project = { id: "proj_generation", name: "Generation", path: "/tmp/generation" }
  Object.assign(__test.state, {
    projects: [project],
    sessionsByProject: {},
    sessionLoadsByProject: {}
  })

  try {
    const staleLoad = __test.loadProjectSessions(project.id)
    __test.markProjectSessionLoading(project.id)
    await __test.loadProjectSessions(project.id)
    resolveStale([{ id: "sess_stale" }])
    await staleLoad

    assert.equal(calls, 2)
    assert.deepEqual(__test.state.sessionsByProject[project.id].map((session) => session.id), ["sess_new"])
  } finally {
    Object.assign(__test.state, previous)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt restores the draft and surfaces runtime startup failures", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
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
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text", "image"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
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
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt blocks with a toast when a pending attachment's modality isn't in the selected model's local-config modalities", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }
  let openProjectCalls = 0
  global.window.openworking = {
    runtime: {
      async openProject() {
        openProjectCalls += 1
        throw new Error("sendPrompt should have blocked before reaching the runtime")
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
    // The app pins its model(s) from local profile config (no live /api/model catalog — see the
    // comment on modelOptions() in renderer.js), so modality gating reads model.modalities here,
    // the same field the Config screen's own modality editor writes.
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "Text-only model", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    newSessionModelRef: null,
    mode: "agent",
    promptDraft: "",
    pendingAttachments: [attachment],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    promptSubmitInFlight: false,
    toast: null
  })

  try {
    await sendPrompt("Please inspect this")

    assert.equal(openProjectCalls, 0)
    assert.equal(state.promptSubmitInFlight, false)
    assert.deepEqual(state.pendingAttachments, [attachment])
    assert.match(state.toast, /Text-only model doesn't support: diagram\.png/)
  } finally {
    state.toast = null
    state.newSessionModelRef = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt ignores concurrent first-send submits while session creation is in flight", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  let createSessionCalls = 0
  let sendPromptCalls = 0
  let sentPromptPayload = null
  let resolveSession = null
  const sessionReady = new Promise((resolve) => {
    resolveSession = resolve
  })
  global.window.openworking = {
    runtime: {
      async createSession() {
        createSessionCalls += 1
        await sessionReady
        return { id: "sess_new", title: "Please inspect this", directory: "/tmp/project" }
      },
      async sendPrompt(payload) {
        sendPromptCalls += 1
        sentPromptPayload = payload
      }
    }
  }

  const { sendPrompt, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: null,
    sessionsByProject: {},
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    modelRefBySession: new Map(),
    agentBySession: new Map(),
    newSessionModelRef: { providerID: "openworking", id: "model-one", variant: "xhigh" },
    promptDraft: "",
    firstSendInFlight: false,
    pendingAttachments: [],
    pendingFileMentions: [],
    commands: [{ name: "review", source: "command", description: "Review changes" }],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })

  try {
    const first = sendPrompt("Please inspect this")
    const second = sendPrompt("Please inspect this")
    assert.equal(state.firstSendInFlight, true)
    assert.match(document.getElementById("root").innerHTML, /Starting chat\.\.\./)
    assert.match(document.getElementById("root").innerHTML, /submit-spinner/)
    await Promise.resolve()

    assert.equal(state.firstSendInFlight, true)
    assert.equal(createSessionCalls, 1)

    resolveSession()
    await Promise.all([first, second])

    assert.equal(createSessionCalls, 1)
    assert.equal(sendPromptCalls, 1)
    assert.equal(state.activeSessionId, "sess_new")
    assert.deepEqual(state.sessionsByProject.proj_1.map((session) => session.id), ["sess_new"])
    assert.equal(state.threads.has("sess_new"), true)
    assert.deepEqual(state.modelRefBySession.get("sess_new"), {
      providerID: "openworking",
      id: "model-one",
      variant: "xhigh"
    })
    assert.equal(state.newSessionModelRef, null)
    assert.deepEqual(stripInputContract(sentPromptPayload), {
      sessionId: "sess_new",
      prompt: "Please inspect this",
      attachmentIds: []
    })
    assert.equal(state.firstSendInFlight, false)
    assert.doesNotMatch(document.getElementById("root").innerHTML, /Starting chat\.\.\./)
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("first-send timeout restores the draft and releases the submit guard for retry", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  let createCalls = 0
  global.window.openworking = {
    runtime: {
      async createSession() {
        createCalls += 1
        throw new Error("Runtime request timed out (POST /session)")
      }
    }
  }

  const { sendPrompt, state } = __test
  const attachment = { id: "att_timeout", filename: "context.txt", mime: "text/plain" }
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_timeout", name: "Timeout", path: "/tmp/timeout" }],
    activeProjectId: "proj_timeout",
    activeSessionId: null,
    sessionsByProject: {},
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_timeout" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "",
    firstSendInFlight: false,
    pendingAttachments: [attachment],
    pendingFileMentions: [],
    commands: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    toast: null
  })

  try {
    await sendPrompt("Keep this draft")
    assert.equal(createCalls, 1)
    assert.equal(state.activeSessionId, null)
    assert.equal(state.firstSendInFlight, false)
    assert.equal(state.promptDraft, "Keep this draft")
    assert.deepEqual(state.pendingAttachments, [attachment])
    assert.equal(state.toast, "Runtime request timed out (POST /session)")

    await sendPrompt("Keep this draft")
    assert.equal(createCalls, 2, "the released guard must allow a deliberate retry")
  } finally {
    state.firstSendInFlight = false
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt dispatches a leading raw slash command through sendCommand", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  const calls = []
  global.window.openworking = {
    runtime: {
      async sendPrompt(payload) {
        calls.push(["prompt", payload])
      },
      async sendCommand(payload) {
        calls.push(["command", payload])
      }
    }
  }

  const { sendPrompt, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: "sess_existing",
    sessionsByProject: { proj_1: [{ id: "sess_existing", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "",
    pendingAttachments: [],
    pendingFileMentions: [],
    commands: [{ name: "review", source: "command", description: "Review changes" }],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })

  try {
    resetOptimisticUserCalls()
    await sendPrompt("/review for this diff")

    assert.deepEqual(stripInputContractsFromCalls(calls), [[
      "command",
      {
        sessionId: "sess_existing",
        command: "review",
        arguments: "for this diff"
      }
    ]])
    assert.equal(optimisticUserCalls.length, 1)
    assert.equal(optimisticUserCalls[0].text, "/review for this diff")
    assert.equal(optimisticUserCalls[0].options.signatureText, "/review for this diff")
    assert.equal(optimisticUserCalls[0].options.selectedSkill, undefined)
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt routes raw skills through activation then prompt and leaves unknown slash input plain", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }
  const attachment = { id: "att_skill", filename: "brief.txt", mime: "text/plain" }
  const calls = []
  global.window.openworking = {
    runtime: {
      async activateSkill(payload) { calls.push(["skill", payload]) },
      async sendPrompt(payload) { calls.push(["prompt", payload]) },
      async sendCommand(payload) { calls.push(["command", payload]) }
    }
  }
  setPromptTestState({
    commands: [{ name: "explain-project", source: "skill", description: "Explain project" }],
    pendingAttachments: [attachment]
  })

  try {
    resetOptimisticUserCalls()
    await __test.sendPrompt("/explain-project Hãy giải thích dự án này cho tôi.")
    await __test.sendPrompt("/explain-project")
    await __test.sendPrompt("/not-in-catalog keep this literal")

    assert.deepEqual(stripInputContractsFromCalls(calls), [
      ["skill", { sessionId: "sess_existing", skill: "explain-project", resume: false }],
      ["prompt", {
        sessionId: "sess_existing",
        prompt: "Hãy giải thích dự án này cho tôi.",
        attachmentIds: ["att_skill"]
      }],
      ["skill", { sessionId: "sess_existing", skill: "explain-project", resume: false }],
      ["prompt", {
        sessionId: "sess_existing",
        prompt: "Apply the activated skill.",
        attachmentIds: []
      }],
      ["prompt", {
        sessionId: "sess_existing",
        prompt: "/not-in-catalog keep this literal",
        attachmentIds: []
      }]
    ])
    assert.equal(calls.some(([kind]) => kind === "command"), false)
    assert.equal(optimisticUserCalls.length, 3, "each submission must create exactly one visible user bubble")
    assert.equal(optimisticUserCalls[0].text, "/explain-project Hãy giải thích dự án này cho tôi.")
    assert.equal(optimisticUserCalls[1].text, "/explain-project")
    assert.deepEqual(optimisticUserCalls[0].attachments, [attachment])
  } finally {
    __test.state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt keeps the skill draft and attachment when activation fails", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }
  const attachment = { id: "att_skill_failure", filename: "brief.txt", mime: "text/plain" }
  let promptCalls = 0
  global.window.openworking = {
    runtime: {
      async activateSkill() {
        throw new Error('HTTP 404: {"_tag":"SkillNotFoundError","skill":"missing-skill"}')
      },
      async sendPrompt() { promptCalls += 1 },
      async sendCommand() {}
    }
  }
  setPromptTestState({
    commands: [{ name: "missing-skill", source: "skill", description: "Missing" }],
    pendingAttachments: [attachment]
  })

  try {
    resetOptimisticUserCalls()
    await __test.sendPrompt("/missing-skill inspect this")

    assert.equal(promptCalls, 0, "activation failure must stop before prompt dispatch")
    assert.equal(__test.state.promptDraft, "/missing-skill inspect this")
    assert.deepEqual(__test.state.pendingAttachments, [attachment])
    assert.equal(__test.state.threads.get("sess_existing").messages.length, 0)
    assert.match(__test.state.toast, /SkillNotFoundError/)
  } finally {
    __test.state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt resolves file mentions inside the follow-up skill prompt", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }
  const calls = []
  global.window.openworking = {
    runtime: {
      async activateSkill(payload) { calls.push(["skill", payload]) },
      async sendPrompt(payload) { calls.push(["prompt", payload]) },
      async sendCommand(payload) { calls.push(["command", payload]) }
    }
  }
  setPromptTestState({
    commands: [{ name: "explain-project", source: "skill", description: "Explain" }]
  })
  __test.state.fileMentionMenu.files = ["/tmp/project/src/api.py"]
  __test.state.fileMentionMenu.projectId = "proj_1"

  try {
    resetOptimisticUserCalls()
    await __test.sendPrompt("/explain-project inspect [api.py](/tmp/project/src/api.py)")

    assert.deepEqual(stripInputContractsFromCalls(calls), [
      ["skill", { sessionId: "sess_existing", skill: "explain-project", resume: false }],
      ["prompt", {
        sessionId: "sess_existing",
        prompt: "inspect `/tmp/project/src/api.py`",
        attachmentIds: []
      }]
    ])
    assert.deepEqual(optimisticUserCalls[0].options.selectedSkill.args, "inspect `/tmp/project/src/api.py`")
  } finally {
    __test.state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt restores the skill draft and attachment after a definitive prompt failure", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }
  const attachment = { id: "att_prompt_failure", filename: "brief.txt", mime: "text/plain" }
  let activations = 0
  global.window.openworking = {
    runtime: {
      async activateSkill() { activations += 1 },
      async sendPrompt() { throw new Error("HTTP 500: prompt failed") },
      async sendCommand() {}
    }
  }
  setPromptTestState({
    commands: [{ name: "explain-project", source: "skill", description: "Explain" }],
    pendingAttachments: [attachment]
  })

  try {
    resetOptimisticUserCalls()
    await __test.sendPrompt("/explain-project inspect this")

    assert.equal(activations, 1)
    assert.equal(__test.state.promptDraft, "/explain-project inspect this")
    assert.deepEqual(__test.state.pendingAttachments, [attachment])
    assert.equal(__test.state.threads.get("sess_existing").messages.length, 0)
    assert.equal(__test.state.toast, "HTTP 500: prompt failed")
  } finally {
    __test.state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt activates a selected skill before sending its arguments as a prompt", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  const calls = []
  global.window.openworking = {
    runtime: {
      async activateSkill(payload) {
        calls.push(["skill", payload])
      },
      async sendPrompt(payload) {
        calls.push(["prompt", payload])
      },
      async sendCommand(payload) {
        calls.push(["command", payload])
      }
    }
  }

  const { sendPrompt, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: "sess_existing",
    sessionsByProject: { proj_1: [{ id: "sess_existing", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "",
    pendingAttachments: [],
    pendingFileMentions: [],
    commands: [{
      name: "use-backlog",
      source: "skill",
      description: "Use backlog skill",
      path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/use-backlog/SKILL.md"
    }],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })

  try {
    resetOptimisticUserCalls()
    await sendPrompt("[use-backlog](/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/use-backlog/SKILL.md) for this ticket")

    assert.deepEqual(stripInputContractsFromCalls(calls), [[
      "skill",
      { sessionId: "sess_existing", skill: "use-backlog", resume: false }
    ], [
      "prompt",
      {
        sessionId: "sess_existing",
        prompt: "for this ticket",
        attachmentIds: []
      }
    ]])
    assert.equal(optimisticUserCalls.length, 1)
    assert.deepEqual(optimisticUserCalls[0].options.selectedSkill, {
      kind: "skill",
      label: "use-backlog",
      path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/use-backlog/SKILL.md",
      raw: "[use-backlog](/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/use-backlog/SKILL.md)",
      args: "for this ticket"
    })
    assert.equal(optimisticUserCalls[0].options.selectedCommand, undefined)
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt keeps a repo-local .agents selected skill token on prompt flow", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  const calls = []
  global.window.openworking = {
    runtime: {
      async activateSkill(payload) {
        calls.push(["skill", payload])
      },
      async sendPrompt(payload) {
        calls.push(["prompt", payload])
      },
      async sendCommand(payload) {
        calls.push(["command", payload])
      }
    }
  }

  const { sendPrompt, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: "sess_existing",
    sessionsByProject: { proj_1: [{ id: "sess_existing", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "",
    pendingAttachments: [],
    pendingFileMentions: [],
    commands: [{
      name: "review-skill",
      source: "skill",
      description: "Repo-local review skill",
      path: "/tmp/project/.agents/skills/review-skill/SKILL.md"
    }],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })

  try {
    resetOptimisticUserCalls()
    await sendPrompt("[review-skill](/tmp/project/.agents/skills/review-skill/SKILL.md) compare this flow")

    assert.deepEqual(stripInputContractsFromCalls(calls), [[
      "skill",
      { sessionId: "sess_existing", skill: "review-skill", resume: false }
    ], [
      "prompt",
      {
        sessionId: "sess_existing",
        prompt: "compare this flow",
        attachmentIds: []
      }
    ]])
    assert.deepEqual(optimisticUserCalls[0].options.selectedSkill, {
      kind: "skill",
      label: "review-skill",
      path: "/tmp/project/.agents/skills/review-skill/SKILL.md",
      raw: "[review-skill](/tmp/project/.agents/skills/review-skill/SKILL.md)",
      args: "compare this flow"
    })
    assert.equal(optimisticUserCalls[0].options.selectedCommand, undefined)
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt keeps a home .opencode selected skill token on prompt flow", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  const calls = []
  global.window.openworking = {
    runtime: {
      async activateSkill(payload) {
        calls.push(["skill", payload])
      },
      async sendPrompt(payload) {
        calls.push(["prompt", payload])
      },
      async sendCommand(payload) {
        calls.push(["command", payload])
      }
    }
  }

  const { sendPrompt, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: "sess_existing",
    sessionsByProject: { proj_1: [{ id: "sess_existing", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "",
    pendingAttachments: [],
    pendingFileMentions: [],
    commands: [{
      name: "home-opencode",
      source: "skill",
      description: "Home opencode skill",
      path: "/Users/me/.opencode/skills/home-opencode/SKILL.md",
      locationFamily: "home_opencode"
    }],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })

  try {
    resetOptimisticUserCalls()
    await sendPrompt("[home-opencode](/Users/me/.opencode/skills/home-opencode/SKILL.md) compare this flow")

    assert.deepEqual(stripInputContractsFromCalls(calls), [[
      "skill",
      { sessionId: "sess_existing", skill: "home-opencode", resume: false }
    ], [
      "prompt",
      {
        sessionId: "sess_existing",
        prompt: "compare this flow",
        attachmentIds: []
      }
    ]])
    assert.deepEqual(optimisticUserCalls[0].options.selectedSkill, {
      kind: "skill",
      label: "home-opencode",
      path: "/Users/me/.opencode/skills/home-opencode/SKILL.md",
      raw: "[home-opencode](/Users/me/.opencode/skills/home-opencode/SKILL.md)",
      args: "compare this flow"
    })
    assert.equal(optimisticUserCalls[0].options.selectedCommand, undefined)
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt creates a new session title from a skill token label instead of its path", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  const createSessionCalls = []
  const calls = []
  global.window.openworking = {
    runtime: {
      async createSession(payload) {
        createSessionCalls.push(payload)
        return { id: "sess_new", title: payload.title, directory: "/tmp/project" }
      },
      async activateSkill(payload) {
        calls.push(["skill", payload])
      },
      async sendPrompt(payload) {
        calls.push(["prompt", payload])
      },
      async sendCommand(payload) {
        calls.push(["command", payload])
      }
    }
  }

  const { sendPrompt, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: null,
    sessionsByProject: {},
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "",
    firstSendInFlight: false,
    pendingAttachments: [],
    pendingFileMentions: [],
    commands: [{
      name: "skill",
      source: "skill",
      description: "Skill",
      path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/skill/SKILL.md"
    }],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })

  try {
    resetOptimisticUserCalls()
    await sendPrompt("[skill](/Users/me/Library/Application Support/OpenWorking/opencode-profile/skills/skill/SKILL.md) này ý nghĩa là gì?")

    assert.deepEqual(createSessionCalls, [{
      title: "skill này ý nghĩa là gì?",
      agent: "build",
      model: { providerID: "openworking", id: "model-one" }
    }])
    assert.deepEqual(stripInputContractsFromCalls(calls), [[
      "skill",
      { sessionId: "sess_new", skill: "skill", resume: false }
    ], [
      "prompt",
      {
        sessionId: "sess_new",
        prompt: "này ý nghĩa là gì?",
        attachmentIds: []
      }
    ]])
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt dispatches a selected command token through sendCommand", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  const calls = []
  global.window.openworking = {
    runtime: {
      async sendPrompt(payload) {
        calls.push(["prompt", payload])
      },
      async sendCommand(payload) {
        calls.push(["command", payload])
      }
    }
  }

  const { sendPrompt, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: "sess_existing",
    sessionsByProject: { proj_1: [{ id: "sess_existing", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "",
    pendingAttachments: [],
    pendingFileMentions: [],
    commands: [{
      name: "review",
      source: "command",
      description: "Review changes",
      path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review"
    }],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })

  try {
    resetOptimisticUserCalls()
    await sendPrompt("[review](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review) for this diff")

    assert.deepEqual(stripInputContractsFromCalls(calls), [[
      "command",
      {
        sessionId: "sess_existing",
        command: "review",
        arguments: "for this diff"
      }
    ]])
    assert.equal(optimisticUserCalls.length, 1)
    assert.equal(optimisticUserCalls[0].text, "[review](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review) for this diff")
    assert.deepEqual(optimisticUserCalls[0].options.selectedCommand, {
      kind: "command",
      label: "review",
      path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review",
      raw: "[review](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review)",
      args: "for this diff"
    })
    assert.equal(optimisticUserCalls[0].options.selectedSkill, undefined)
    assert.equal(
      optimisticUserCalls[0].options.signatureText,
      "[review](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review) for this diff"
    )
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt resolves canonical file tokens inside selected command arguments", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  const calls = []
  global.window.openworking = {
    runtime: {
      async sendPrompt(payload) {
        calls.push(["prompt", payload])
      },
      async sendCommand(payload) {
        calls.push(["command", payload])
      }
    },
    attachments: {
      async addProjectFile(filePath) {
        calls.push(["attachment", filePath])
        return { id: "att_zip", filename: "bundle.zip", mime: "application/octet-stream" }
      }
    }
  }

  const { sendPrompt, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: "sess_existing",
    sessionsByProject: { proj_1: [{ id: "sess_existing", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "",
    pendingAttachments: [{ id: "stale", filename: "bundle.zip", mime: "application/octet-stream" }],
    pendingFileMentions: [],
    commands: [{
      name: "review",
      source: "command",
      description: "Review changes",
      path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review"
    }],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: {
      open: false,
      query: "",
      index: 0,
      files: ["/tmp/project/src/api.py", "/tmp/project/archive/bundle.zip"],
      loading: false,
      error: "",
      projectId: "proj_1",
      loadPromise: null
    },
    loading: false,
    toast: null
  })

  try {
    resetOptimisticUserCalls()
    await sendPrompt("[review](/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review) inspect [api.py](/tmp/project/src/api.py) and [bundle.zip](/tmp/project/archive/bundle.zip)")

    assert.deepEqual(stripInputContractsFromCalls(calls), [
      ["attachment", "/tmp/project/archive/bundle.zip"],
      ["command", {
        sessionId: "sess_existing",
        command: "review",
        arguments: "inspect `/tmp/project/src/api.py` and [bundle.zip](/tmp/project/archive/bundle.zip)"
      }]
    ])
    assert.equal(optimisticUserCalls.length, 1)
    assert.equal(optimisticUserCalls[0].attachments.length, 1)
    assert.deepEqual(optimisticUserCalls[0].options.fileRefs, [
      { token: "[api.py](/tmp/project/src/api.py)", path: "/tmp/project/src/api.py", name: "api.py" },
      { token: "[bundle.zip](/tmp/project/archive/bundle.zip)", path: "/tmp/project/archive/bundle.zip", name: "bundle.zip" }
    ])
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt keeps unknown command-like markdown tokens as plain text", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  const calls = []
  global.window.openworking = {
    runtime: {
      async sendPrompt(payload) {
        calls.push(["prompt", payload])
      },
      async sendCommand(payload) {
        calls.push(["command", payload])
      }
    }
  }

  const { sendPrompt, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: "sess_existing",
    sessionsByProject: { proj_1: [{ id: "sess_existing", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "",
    pendingAttachments: [],
    pendingFileMentions: [],
    commands: [{ name: "use-backlog", source: "skill", description: "Use backlog skill" }],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })

  try {
    resetOptimisticUserCalls()
    await sendPrompt("[unknown](commands/unknown) for this ticket")

    assert.deepEqual(stripInputContractsFromCalls(calls), [[
      "prompt",
      {
        sessionId: "sess_existing",
        prompt: "[unknown](commands/unknown) for this ticket",
        attachmentIds: []
      }
    ]])
    assert.equal(optimisticUserCalls[0].options.selectedSkill, undefined)
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt routes @zip file mentions through attachments instead of inline text", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  const calls = []
  global.window.openworking = {
    attachments: {
      async addProjectFile(filePath, context) {
        calls.push(["attach", filePath, context])
        return { id: "att_zip", filename: "archive.zip", mime: "application/zip" }
      },
      async discard() {}
    },
    runtime: {
      async sendPrompt(payload) {
        calls.push(["prompt", payload])
      }
    }
  }

  const { sendPrompt, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project", activeWorktreePath: "/tmp/project-worktree" }],
    activeProjectId: "proj_1",
    activeSessionId: "sess_existing",
    sessionsByProject: { proj_1: [{ id: "sess_existing", title: "Existing", directory: "/tmp/project-worktree" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "",
    pendingAttachments: [],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: {
      open: false,
      query: "",
      index: 0,
      files: ["docs/archive.zip"],
      loading: false,
      error: "",
      projectId: "proj_1",
      loadPromise: null
    },
    loading: false,
    toast: null
  })

  try {
    await sendPrompt("Read @archive.zip")

    assert.deepEqual(stripInputContractsFromCalls(calls), [
      ["attach", "docs/archive.zip", { projectId: "proj_1", directory: "/tmp/project-worktree" }],
      ["prompt", {
        sessionId: "sess_existing",
        prompt: "Read @archive.zip",
        attachmentIds: ["att_zip"]
      }]
    ])
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("delayed attachment preparation keeps the prompt bound to its original session", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  let releaseAttachment
  let attachmentStarted
  const attachmentGate = new Promise((resolve) => { releaseAttachment = resolve })
  const attachmentStartedGate = new Promise((resolve) => { attachmentStarted = resolve })
  const calls = []
  const discarded = []
  global.window.openworking = {
    attachments: {
      async addProjectFile() {
        attachmentStarted()
        await attachmentGate
        return { id: "att_race_zip", filename: "archive.zip", mime: "application/zip" }
      },
      async discard(ids) {
        discarded.push(ids)
      }
    },
    runtime: {
      async sendPrompt(payload) {
        calls.push(payload)
        return {
          id: payload.inputId,
          sessionID: payload.sessionId,
          type: "user",
          admittedSeq: 4,
          delivery: payload.delivery,
          text: payload.prompt
        }
      }
    }
  }

  const { sendPrompt, state } = __test
  const previousState = { ...state, threads: state.threads }
  const model = { providerID: "openworking", id: "model-one" }
  const bAttachment = { id: "att_b", filename: "b.txt", mime: "text/plain" }
  Object.assign(state, {
    projects: [{ id: "proj_race", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_race",
    activeSessionId: "sess_a",
    sessionsByProject: {
      proj_race: [
        { id: "sess_a", title: "A", agent: "build", model },
        { id: "sess_b", title: "B", agent: "build", model }
      ]
    },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_race" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    modelRefBySession: new Map([["sess_a", model], ["sess_b", model]]),
    agentBySession: new Map([["sess_a", "build"], ["sess_b", "build"]]),
    promptDraft: "Prompt A",
    promptSubmitInFlight: false,
    pendingAttachments: [],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: {
      open: false,
      query: "",
      index: 0,
      files: ["docs/archive.zip"],
      loading: false,
      error: "",
      projectId: "proj_race",
      loadPromise: null
    },
    unknownInputSubmissions: new Map()
  })

  try {
    const sending = sendPrompt("Read @archive.zip")
    await attachmentStartedGate
    state.activeSessionId = "sess_b"
    state.promptDraft = "Draft B"
    state.pendingAttachments = [bAttachment]
    releaseAttachment()
    await sending

    assert.equal(calls.length, 1)
    assert.equal(calls[0].sessionId, "sess_a")
    assert.deepEqual(calls[0].attachmentIds, ["att_race_zip"])
    assert.equal(state.promptDraft, "Draft B")
    assert.deepEqual(state.pendingAttachments, [bAttachment])
    assert.equal(state.threads.get("sess_a").messages.length, 1)
    assert.deepEqual(state.threads.get("sess_b")?.messages || [], [])
    assert.deepEqual(discarded, [["att_race_zip"]])
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("delayed prompt rejection cannot restore one session's draft into another composer", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  let rejectPost
  let postStarted
  const postGate = new Promise((_, reject) => { rejectPost = reject })
  const postStartedGate = new Promise((resolve) => { postStarted = resolve })
  const calls = []
  global.window.openworking = {
    runtime: {
      async sendPrompt(payload) {
        calls.push(payload)
        postStarted()
        return postGate
      }
    }
  }

  const { sendPrompt, state } = __test
  const previousState = { ...state, threads: state.threads }
  const model = { providerID: "openworking", id: "model-one" }
  const attachmentA = { id: "att_a", filename: "a.txt", mime: "text/plain" }
  const attachmentB = { id: "att_b", filename: "b.txt", mime: "text/plain" }
  Object.assign(state, {
    projects: [{ id: "proj_post_race", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_post_race",
    activeSessionId: "sess_a",
    sessionsByProject: {
      proj_post_race: [
        { id: "sess_a", title: "A", agent: "build", model },
        { id: "sess_b", title: "B", agent: "build", model }
      ]
    },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_post_race" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    modelRefBySession: new Map([["sess_a", model], ["sess_b", model]]),
    agentBySession: new Map([["sess_a", "build"], ["sess_b", "build"]]),
    promptDraft: "Prompt A",
    promptSubmitInFlight: false,
    pendingAttachments: [attachmentA],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    unknownInputSubmissions: new Map(),
    toast: null
  })

  try {
    const sending = sendPrompt("Prompt A")
    await postStartedGate
    state.activeSessionId = "sess_b"
    state.promptDraft = "Draft B"
    state.pendingAttachments = [attachmentB]
    rejectPost(new Error("HTTP 500: rejected"))
    await sending

    assert.equal(calls.length, 1)
    assert.equal(calls[0].sessionId, "sess_a")
    assert.equal(state.promptDraft, "Draft B")
    assert.deepEqual(state.pendingAttachments, [attachmentB])
    assert.deepEqual(state.threads.get("sess_a").messages, [])
    assert.equal(state.unknownInputSubmissions.size, 0)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("send button click uses the contenteditable draft instead of promptInput.value", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  const calls = []
  global.window.openworking = {
    runtime: {
      async sendPrompt(payload) {
        calls.push(payload)
      }
    }
  }

  const { handleAction, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: "sess_existing",
    sessionsByProject: { proj_1: [{ id: "sess_existing", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "Send from draft",
    pendingAttachments: [],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })

  try {
    await handleAction({
      currentTarget: {
        dataset: { action: "sendPrompt" }
      }
    })

    assert.deepEqual(calls.map(stripInputContract), [{
      sessionId: "sess_existing",
      prompt: "Send from draft",
      attachmentIds: []
    }])
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("explicit steer dispatches once with the same stable admission contract", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const calls = []
  global.window.openworking = {
    runtime: {
      async sendPrompt(payload) {
        calls.push(payload)
        return {
          id: payload.inputId,
          sessionID: payload.sessionId,
          type: "user",
          admittedSeq: 2,
          delivery: payload.delivery,
          text: payload.prompt
        }
      }
    }
  }

  const { sendPrompt, state } = __test
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    runtime: state.runtime,
    auth: state.auth,
    config: state.config,
    providerId: state.providerId,
    promptSubmitInFlight: state.promptSubmitInFlight,
    pendingAttachments: state.pendingAttachments,
    pendingFileMentions: state.pendingFileMentions,
    commandMenu: state.commandMenu,
    fileMentionMenu: state.fileMentionMenu
  }
  Object.assign(state, {
    projects: [{ id: "proj_steer", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_steer",
    activeSessionId: "sess_steer",
    sessionsByProject: { proj_steer: [{ id: "sess_steer", title: "Existing" }] },
    threads: new Map([["sess_steer", {
      sessionId: "sess_steer",
      messages: [],
      pendingQuestions: [],
      pendingPermissions: [],
      status: { type: "busy" }
    }]]),
    runtime: { status: "running", project: { id: "proj_steer" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    promptSubmitInFlight: false,
    pendingAttachments: [],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null }
  })

  try {
    await sendPrompt("Change direction", { delivery: "steer" })
    assert.equal(calls.length, 1)
    assert.match(calls[0].inputId, /^msg_[A-Za-z0-9_-]{8,128}$/)
    assert.deepEqual(calls[0], {
      sessionId: "sess_steer",
      inputId: calls[0].inputId,
      prompt: "Change direction",
      attachmentIds: [],
      delivery: "steer",
      resume: true
    })
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("definitive HTTP rejection removes the optimistic input and restores the full composer draft", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.window.openworking = {
    runtime: {
      async sendPrompt() {
        throw new Error("HTTP 500: admission rejected")
      }
    }
  }
  const { sendPrompt, state } = __test
  const previousState = { ...state, threads: state.threads }
  const attachment = { id: "att_reject", filename: "draft.png", mime: "image/png" }
  Object.assign(state, {
    projects: [{ id: "proj_reject", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_reject",
    activeSessionId: "sess_reject",
    sessionsByProject: { proj_reject: [{ id: "sess_reject", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_reject" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text", "image"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    promptDraft: "",
    promptSubmitInFlight: false,
    pendingAttachments: [attachment],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    unknownInputSubmissions: new Map(),
    toast: null
  })
  try {
    await sendPrompt("Restore this draft")
    assert.equal(state.promptDraft, "Restore this draft")
    assert.deepEqual(state.pendingAttachments, [attachment])
    assert.deepEqual(state.threads.get("sess_reject").messages, [])
    assert.equal(state.unknownInputSubmissions.size, 0)
    assert.equal(state.toast, "HTTP 500: admission rejected")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("existing-session rapid submits admit only one input", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  let resolveSend
  const sendGate = new Promise((resolve) => { resolveSend = resolve })
  const calls = []
  global.window.openworking = {
    runtime: {
      async sendPrompt(payload) {
        calls.push(payload)
        await sendGate
      }
    }
  }
  const { sendPrompt, state } = __test
  const previousState = { ...state, threads: state.threads }
  Object.assign(state, {
    projects: [{ id: "proj_lock", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_lock",
    activeSessionId: "sess_lock",
    sessionsByProject: { proj_lock: [{ id: "sess_lock", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_lock" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    promptSubmitInFlight: false,
    pendingAttachments: [],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null }
  })
  try {
    const first = sendPrompt("Only once")
    const second = sendPrompt("Only once")
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.length, 1)
    resolveSend()
    await Promise.all([first, second])
    assert.equal(calls.length, 1)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("delivery-unknown retry reuses the exact input id and payload", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => setImmediate(callback)
  const calls = []
  global.window.openworking = {
    runtime: {
      async sendPrompt(payload) {
        calls.push(payload)
        return {
          id: payload.inputId,
          sessionID: payload.sessionId,
          type: "user",
          admittedSeq: 9,
          delivery: payload.delivery,
          text: payload.prompt
        }
      }
    }
  }
  const { retryUnknownInput, state } = __test
  const inputId = "msg_retry0001"
  const payload = {
    sessionId: "sess_retry",
    inputId,
    prompt: "Retry safely",
    attachmentIds: ["att_1"],
    delivery: "queue",
    resume: true
  }
  const previousThreads = state.threads
  const previousUnknown = state.unknownInputSubmissions
  state.threads = new Map([["sess_retry", {
    sessionId: "sess_retry",
    messages: [{
      id: inputId,
      role: "user",
      inputState: "delivery-unknown",
      parts: [{ type: "text", text: "Retry safely" }]
    }],
    pendingQuestions: [],
    pendingPermissions: [],
    status: { type: "busy" }
  }]])
  state.unknownInputSubmissions = new Map([[inputId, {
    sessionId: "sess_retry",
    kind: "prompt",
    payload
  }]])
  try {
    await retryUnknownInput(inputId)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], payload)
    assert.equal(state.unknownInputSubmissions.has(inputId), false)
    assert.equal(state.threads.get("sess_retry").messages[0].inputState, "queued")
  } finally {
    state.threads = previousThreads
    state.unknownInputSubmissions = previousUnknown
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("REST recovery confirms a transport-ambiguous input and discards its attachment token", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  let sentPayload
  const discarded = []
  global.window.openworking = {
    attachments: {
      async discard(ids) {
        discarded.push(ids)
      }
    },
    runtime: {
      async sendPrompt(payload) {
        sentPayload = payload
        throw new Error("socket closed")
      },
      async listPendingInputs({ sessionId }) {
        return [{
          id: sentPayload.inputId,
          sessionID: sessionId,
          type: "user",
          admittedSeq: 7,
          delivery: "queue",
          text: sentPayload.prompt
        }]
      },
      async listMessages() {
        return []
      }
    }
  }

  const { sendPrompt, state } = __test
  const previousState = { ...state, threads: state.threads }
  const attachment = { id: "att_recovered", filename: "context.txt", mime: "text/plain" }
  Object.assign(state, {
    projects: [{ id: "proj_recovered", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_recovered",
    activeSessionId: "sess_recovered",
    sessionsByProject: { proj_recovered: [{ id: "sess_recovered", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_recovered" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    modelRefBySession: new Map(),
    agentBySession: new Map(),
    promptDraft: "Recover me",
    promptSubmitInFlight: false,
    pendingAttachments: [attachment],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    unknownInputSubmissions: new Map()
  })

  try {
    await sendPrompt("Recover me")
    assert.equal(sentPayload.sessionId, "sess_recovered")
    assert.equal(state.unknownInputSubmissions.size, 0)
    assert.deepEqual(discarded, [["att_recovered"]])
    assert.equal(state.threads.get("sess_recovered").messages[0].inputState, "queued")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("late admission clears the retained retry DTO and attachment registration", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  let sentPayload
  const discarded = []
  global.window.openworking = {
    attachments: {
      async discard(ids) {
        discarded.push(ids)
      }
    },
    runtime: {
      async sendPrompt(payload) {
        sentPayload = payload
        throw new Error("socket closed")
      },
      async listPendingInputs() {
        return []
      },
      async listMessages() {
        return []
      }
    }
  }

  const { handleRuntimeStream, sendPrompt, state } = __test
  const previousState = { ...state, threads: state.threads }
  const attachment = { id: "att_late", filename: "context.txt", mime: "text/plain" }
  Object.assign(state, {
    projects: [{ id: "proj_late", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_late",
    activeSessionId: "sess_late",
    sessionsByProject: { proj_late: [{ id: "sess_late", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_late" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    modelRefBySession: new Map(),
    agentBySession: new Map(),
    promptDraft: "Wait for admission",
    promptSubmitInFlight: false,
    pendingAttachments: [attachment],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    unknownInputSubmissions: new Map()
  })

  try {
    await sendPrompt("Wait for admission")
    assert.equal(state.unknownInputSubmissions.has(sentPayload.inputId), true)
    assert.deepEqual(discarded, [])

    handleRuntimeStream({
      type: "session.input.admitted",
      sessionID: "sess_late",
      inputID: sentPayload.inputId,
      input: {
        id: sentPayload.inputId,
        sessionID: "sess_late",
        type: "user",
        admittedSeq: 8,
        delivery: "queue",
        text: sentPayload.prompt
      }
    })
    await Promise.resolve()

    assert.equal(state.unknownInputSubmissions.has(sentPayload.inputId), false)
    assert.deepEqual(discarded, [["att_late"]])
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("admission arriving before a transport error stays confirmed", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  let rejectPost
  let postStarted
  let sentPayload
  let reconciliationCalls = 0
  const postGate = new Promise((_, reject) => { rejectPost = reject })
  const postStartedGate = new Promise((resolve) => { postStarted = resolve })
  const discarded = []
  global.window.openworking = {
    attachments: {
      async discard(ids) {
        discarded.push(ids)
      }
    },
    runtime: {
      async sendPrompt(payload) {
        sentPayload = payload
        postStarted()
        return postGate
      },
      async listPendingInputs() {
        reconciliationCalls += 1
        return []
      },
      async listMessages() {
        reconciliationCalls += 1
        return []
      }
    }
  }

  const { handleRuntimeStream, sendPrompt, state } = __test
  const previousState = { ...state, threads: state.threads }
  const attachment = { id: "att_event_first", filename: "context.txt", mime: "text/plain" }
  Object.assign(state, {
    projects: [{ id: "proj_event_first", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_event_first",
    activeSessionId: "sess_event_first",
    sessionsByProject: { proj_event_first: [{ id: "sess_event_first", title: "Existing" }] },
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_event_first" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    modelRefBySession: new Map(),
    agentBySession: new Map(),
    promptDraft: "Event wins",
    promptSubmitInFlight: false,
    pendingAttachments: [attachment],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    unknownInputSubmissions: new Map()
  })

  try {
    const sending = sendPrompt("Event wins")
    await postStartedGate
    handleRuntimeStream({
      type: "session.input.admitted",
      sessionID: "sess_event_first",
      inputID: sentPayload.inputId,
      input: {
        id: sentPayload.inputId,
        sessionID: "sess_event_first",
        type: "user",
        admittedSeq: 9,
        delivery: "queue",
        text: sentPayload.prompt
      }
    })
    rejectPost(new Error("socket closed"))
    await sending
    await Promise.resolve()

    assert.equal(state.unknownInputSubmissions.has(sentPayload.inputId), false)
    assert.equal(reconciliationCalls, 0)
    assert.deepEqual(discarded, [["att_event_first"]])
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt clears the first-send guard after a session-creation failure", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => {
    callback()
    return 1
  }

  let createSessionCalls = 0
  let shouldFail = true
  let sendPromptCalls = 0
  global.window.openworking = {
    runtime: {
      async createSession() {
        createSessionCalls += 1
        if (shouldFail) throw new Error("session create failed")
        return { id: "sess_retry", title: "Please inspect this", directory: "/tmp/project" }
      },
      async sendPrompt() {
        sendPromptCalls += 1
      }
    }
  }

  const { sendPrompt, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: null,
    sessionsByProject: {},
    threads: new Map(),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    promptDraft: "",
    firstSendInFlight: false,
    pendingAttachments: [],
    pendingFileMentions: [],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })

  try {
    await sendPrompt("Please inspect this")
    assert.equal(createSessionCalls, 1)
    assert.equal(sendPromptCalls, 0)
    assert.equal(state.firstSendInFlight, false)
    assert.equal(state.activeSessionId, null)
    assert.equal(state.toast, "session create failed")

    shouldFail = false
    state.toast = null
    await sendPrompt("Please inspect this")

    assert.equal(createSessionCalls, 2)
    assert.equal(sendPromptCalls, 1)
    assert.equal(state.activeSessionId, "sess_retry")
    assert.equal(state.firstSendInFlight, false)
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("sendPrompt selects the session variant before dispatching slash commands", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  let sentCommandPayload = null
  let selectedModelPayload = null
  global.window.openworking = {
    runtime: {
      async selectSessionModel(payload) {
        selectedModelPayload = payload
      },
      async sendCommand(payload) {
        sentCommandPayload = payload
      }
    }
  }

  const { sendPrompt, state } = __test
  Object.assign(state, {
    nav: "session",
    projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
    activeProjectId: "proj_1",
    activeSessionId: "sess_existing",
    sessionsByProject: { proj_1: [{ id: "sess_existing", directory: "/tmp/project" }] },
    threads: new Map([["sess_existing", { sessionId: "sess_existing", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
    runtime: { status: "running", project: { id: "proj_1" }, sessionStatuses: {} },
    auth: { saml2Enabled: false },
    config: {
      provider: {
        openworking: {
          name: "Provider",
          options: { apiKey: "local-key" },
          models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
        }
      }
    },
    providerId: "openworking",
    mode: "agent",
    modelRefBySession: new Map([[
      "sess_existing",
      { providerID: "openworking", id: "model-one", variant: "high" }
    ]]),
    agentBySession: new Map([["sess_existing", "build"]]),
    newSessionModelRef: null,
    promptDraft: "",
    pendingAttachments: [],
    pendingFileMentions: [],
    commands: [{ name: "init", source: "command", description: "" }],
    commandMenu: { open: false, query: "", index: 0 },
    fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
    loading: false,
    toast: null
  })

  try {
    await sendPrompt("/init focus on setup")

    assert.deepEqual(selectedModelPayload, {
      sessionId: "sess_existing",
      model: { providerID: "openworking", id: "model-one", variant: "high" }
    })
    assert.equal(sentCommandPayload.reasoningMode, undefined)
    assert.equal(sentCommandPayload.model, undefined)
    assert.equal(sentCommandPayload.command, "init")
    assert.equal(sentCommandPayload.arguments, "focus on setup")
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("selectSession views a cross-project chat without restarting the runtime", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
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
      { id: "proj_other", name: "Other", path: "/tmp/other-main" }
    ],
    // Runtime is running on the ACTIVE project; we click a chat in the OTHER project.
    activeProjectId: "proj_active",
    activeSessionId: null,
    runtime: { status: "running", project: { id: "proj_active" }, sessionStatuses: {} },
    sessionsByProject: { proj_other: [{ id: "ses_1", directory: "/tmp/other-worktree" }] },
    threads: new Map(),
    pendingAttachments: [],
    pendingFileMentions: [],
    toast: null
  })

  try {
    await selectSession("proj_other", "ses_1")

    assert.equal(openProjectCalled, false, "must NOT restart the runtime just to view")
    assert.deepEqual(listMessagesArgs, { sessionId: "ses_1", directory: "/tmp/other-worktree" })
    assert.equal(state.activeProjectId, "proj_other")
    assert.equal(state.activeSessionId, "ses_1")
    assert.equal(state.nav, "session")
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("subagent tree hydration failure does not block message history", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  let messageCalls = 0
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.window.openworking = {
    runtime: {
      async listSubagentRuns() { throw new Error("tree unavailable") },
      async listMessages() {
        messageCalls += 1
        return [{
          id: "msg_user",
          role: "user",
          parts: [{ id: "part_user", messageID: "msg_user", type: "text", text: "Hello" }]
        }]
      }
    },
    attachments: { async discard() {} }
  }

  const { selectSession, sessionMessageLoad, state } = __test
  const project = { id: "proj_tree_failure", name: "Tree failure", path: "/tmp/tree-failure" }
  const previousState = {
    nav: state.nav,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    runtime: state.runtime,
    sessionsByProject: state.sessionsByProject,
    messageLoadsBySession: state.messageLoadsBySession,
    threads: state.threads,
    pendingAttachments: state.pendingAttachments,
    pendingFileMentions: state.pendingFileMentions
  }
  try {
    Object.assign(state, {
      nav: "session",
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: null,
      runtime: { status: "running", project, sessionStatuses: {} },
      sessionsByProject: { [project.id]: [{ id: "sess_tree_failure", directory: project.path }] },
      messageLoadsBySession: {},
      threads: new Map(),
      pendingAttachments: [],
      pendingFileMentions: []
    })

    await selectSession(project.id, "sess_tree_failure")

    assert.equal(sessionMessageLoad(project.id, "sess_tree_failure").status, "ready")
    assert.equal(messageCalls, 1)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("selectSession paints cached messages before refresh and repaints only the thread when fresh data arrives", async () => {
  const previousOpenworking = global.window.openworking
  const state = __test.state
  const previous = {
    nav: state.nav,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    runtime: state.runtime,
    sessionsByProject: state.sessionsByProject,
    messageLoadsBySession: state.messageLoadsBySession,
    threads: state.threads,
    pendingAttachments: state.pendingAttachments,
    pendingFileMentions: state.pendingFileMentions,
    gitInfoByProject: state.gitInfoByProject,
    gitInfoLoading: state.gitInfoLoading,
    toast: state.toast
  }
  const project = { id: "proj_cache", name: "Cache", path: "/tmp/cache" }
  let resolveMessages
  let rejectDiscard
  const messagesPending = new Promise((resolve) => { resolveMessages = resolve })
  const discardPending = new Promise((_resolve, reject) => { rejectDiscard = reject })
  let listCalls = 0
  global.window.openworking = {
    runtime: {
      async listMessages() {
        listCalls += 1
        return messagesPending
      }
    },
    attachments: { discard: async () => discardPending }
  }
  Object.assign(state, {
    nav: "session",
    projects: [project],
    activeProjectId: project.id,
    activeSessionId: null,
    runtime: { status: "running", project, sessionStatuses: {} },
    sessionsByProject: { [project.id]: [{ id: "sess_cache", title: "Cached", directory: project.path }] },
    messageLoadsBySession: {},
    threads: new Map([["sess_cache", {
      sessionId: "sess_cache",
      status: { type: "idle" },
      pendingQuestions: [],
      pendingPermissions: [],
      messages: [{ id: "msg_cached", role: "assistant", parts: [{ id: "part_cached", type: "text", text: "Cached answer" }] }]
    }]]),
    pendingAttachments: [{ id: "att_cache", filename: "cache.txt" }],
    pendingFileMentions: [{ token: "@cache.txt", path: "/tmp/cache/cache.txt" }],
    gitInfoByProject: new Map([[project.id, { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }]]),
    gitInfoLoading: new Set(),
    toast: null
  })

  try {
    __test.renderCounters.reset()
    const selection = __test.selectSession(project.id, "sess_cache")

    assert.equal(state.activeSessionId, "sess_cache")
    assert.match(document.getElementById("root").innerHTML, /Cached answer/)
    assert.doesNotMatch(document.getElementById("root").innerHTML, /Loading chat/)
    assert.deepEqual(state.pendingAttachments, [])
    assert.deepEqual(state.pendingFileMentions, [])
    assert.equal(listCalls, 1)
    assert.equal(__test.renderCounters.snapshot().full, 1)

    resolveMessages([{ id: "msg_fresh", role: "assistant", parts: [{ id: "part_fresh", type: "text", text: "Fresh answer" }] }])
    rejectDiscard(new Error("Could not discard test attachment."))
    await selection

    assert.equal(state.threads.get("sess_cache").messages[0].id, "msg_fresh")
    assert.match(document.getElementById("root").innerHTML, /Fresh answer/)
    assert.equal(state.toast, "Could not discard test attachment.")
    assert.equal(__test.renderCounters.snapshot().full, 1, "background hydration must not repaint the full shell")
    assert.ok(__test.renderCounters.snapshot().thread >= 2)
  } finally {
    Object.assign(state, previous)
    global.window.openworking = previousOpenworking
  }
})

test("late session hydration updates its own cache without replacing the newer active chat", async () => {
  const previousOpenworking = global.window.openworking
  const state = __test.state
  const previous = {
    nav: state.nav,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    runtime: state.runtime,
    sessionsByProject: state.sessionsByProject,
    messageLoadsBySession: state.messageLoadsBySession,
    threads: state.threads,
    pendingAttachments: state.pendingAttachments,
    pendingFileMentions: state.pendingFileMentions,
    gitInfoByProject: state.gitInfoByProject,
    gitInfoLoading: state.gitInfoLoading
  }
  const project = { id: "proj_race", name: "Race", path: "/tmp/race" }
  const resolvers = new Map()
  global.window.openworking = {
    runtime: {
      listMessages({ sessionId }) {
        return new Promise((resolve) => resolvers.set(sessionId, resolve))
      }
    },
    attachments: { async discard() {} }
  }
  const cachedThread = (sessionId, text) => ({
    sessionId,
    status: { type: "idle" },
    pendingQuestions: [],
    pendingPermissions: [],
    messages: [{ id: `cached_${sessionId}`, role: "assistant", parts: [{ id: `part_${sessionId}`, type: "text", text }] }]
  })
  Object.assign(state, {
    nav: "session",
    projects: [project],
    activeProjectId: project.id,
    activeSessionId: null,
    runtime: { status: "running", project, sessionStatuses: {} },
    sessionsByProject: { [project.id]: [
      { id: "sess_a", title: "A", directory: project.path },
      { id: "sess_b", title: "B", directory: project.path }
    ] },
    messageLoadsBySession: {},
    threads: new Map([
      ["sess_a", cachedThread("sess_a", "Cached A")],
      ["sess_b", cachedThread("sess_b", "Cached B")]
    ]),
    pendingAttachments: [],
    pendingFileMentions: [],
    gitInfoByProject: new Map([[project.id, { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }]]),
    gitInfoLoading: new Set()
  })

  try {
    const selectingA = __test.selectSession(project.id, "sess_a")
    const selectingB = __test.selectSession(project.id, "sess_b")
    assert.equal(state.activeSessionId, "sess_b")
    assert.match(document.getElementById("root").innerHTML, /Cached B/)

    resolvers.get("sess_b")([{ id: "fresh_b", role: "assistant", parts: [{ id: "part_fresh_b", type: "text", text: "Fresh B" }] }])
    await selectingB
    resolvers.get("sess_a")([{ id: "fresh_a", role: "assistant", parts: [{ id: "part_fresh_a", type: "text", text: "Fresh A" }] }])
    await selectingA

    assert.equal(state.activeSessionId, "sess_b")
    assert.equal(state.threads.get("sess_a").messages[0].id, "fresh_a")
    assert.equal(state.threads.get("sess_b").messages[0].id, "fresh_b")
    assert.match(document.getElementById("root").innerHTML, /Fresh B/)
    assert.doesNotMatch(document.getElementById("root").innerHTML, /Fresh A/)
  } finally {
    Object.assign(state, previous)
    global.window.openworking = previousOpenworking
  }
})

test("cached refresh failure keeps the thread visible and reports a non-blocking refresh error", async () => {
  const previousOpenworking = global.window.openworking
  const state = __test.state
  const previous = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    runtime: state.runtime,
    sessionsByProject: state.sessionsByProject,
    messageLoadsBySession: state.messageLoadsBySession,
    threads: state.threads,
    pendingAttachments: state.pendingAttachments,
    pendingFileMentions: state.pendingFileMentions,
    gitInfoByProject: state.gitInfoByProject,
    gitInfoLoading: state.gitInfoLoading,
    toast: state.toast,
    nav: state.nav
  }
  const project = { id: "proj_refresh_error", name: "Refresh error", path: "/tmp/refresh-error" }
  global.window.openworking = {
    runtime: { async listMessages() { throw new Error("refresh failed") } },
    attachments: { async discard() {} }
  }
  Object.assign(state, {
    projects: [project],
    activeProjectId: project.id,
    activeSessionId: null,
    runtime: { status: "running", project, sessionStatuses: {} },
    sessionsByProject: { [project.id]: [{ id: "sess_cached_error", title: "Cached", directory: project.path }] },
    messageLoadsBySession: {},
    threads: new Map([["sess_cached_error", {
      sessionId: "sess_cached_error",
      status: { type: "idle" },
      pendingQuestions: [],
      pendingPermissions: [],
      messages: [{ id: "cached_error", role: "assistant", parts: [{ id: "cached_error_part", type: "text", text: "Keep cached content" }] }]
    }]]),
    pendingAttachments: [],
    pendingFileMentions: [],
    gitInfoByProject: new Map([[project.id, { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }]]),
    gitInfoLoading: new Set(),
    toast: null,
    nav: "session"
  })

  try {
    await __test.selectSession(project.id, "sess_cached_error")

    assert.equal(state.toast, "Could not refresh chat.")
    assert.match(document.getElementById("root").innerHTML, /Keep cached content/)
    assert.doesNotMatch(__test.renderThreadRows(), /Could not load this chat/)
    assert.equal(__test.sessionMessageLoad(project.id, "sess_cached_error").status, "error")
  } finally {
    Object.assign(state, previous)
    global.window.openworking = previousOpenworking
  }
})

test("uncached session paints loading before a single cold runtime start and preserves the selection", async () => {
  const previousOpenworking = global.window.openworking
  const state = __test.state
  const previous = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    runtime: state.runtime,
    sessionsByProject: state.sessionsByProject,
    sessionLoadsByProject: state.sessionLoadsByProject,
    messageLoadsBySession: state.messageLoadsBySession,
    threads: state.threads,
    pendingAttachments: state.pendingAttachments,
    pendingFileMentions: state.pendingFileMentions,
    commands: state.commands,
    gitInfoByProject: state.gitInfoByProject,
    gitInfoLoading: state.gitInfoLoading,
    loading: state.loading,
    nav: state.nav
  }
  const project = { id: "proj_cold", name: "Cold", path: "/tmp/cold" }
  let resolveOpen
  const openPending = new Promise((resolve) => { resolveOpen = resolve })
  let openCalls = 0
  global.window.openworking = {
    runtime: {
      openProject() {
        openCalls += 1
        return openPending
      },
      async listSessions() { return [{ id: "sess_cold", title: "Cold chat", directory: project.path }] },
      async listMessages() {
        return [{ id: "msg_cold", role: "assistant", parts: [{ id: "part_cold", type: "text", text: "Cold history" }] }]
      },
      listCommands() { return new Promise(() => {}) },
      async listSessionsForDirectory() { return [] }
    },
    attachments: { async discard() {} }
  }
  Object.assign(state, {
    projects: [project],
    activeProjectId: null,
    activeSessionId: null,
    runtime: { status: "stopped", project: null, sessionStatuses: {} },
    sessionsByProject: { [project.id]: [{ id: "sess_cold", title: "Cold chat", directory: project.path }] },
    sessionLoadsByProject: {},
    messageLoadsBySession: {},
    threads: new Map(),
    pendingAttachments: [],
    pendingFileMentions: [],
    commands: [],
    gitInfoByProject: new Map([[project.id, { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }]]),
    gitInfoLoading: new Set(),
    loading: false,
    nav: "session"
  })

  try {
    const selection = __test.selectSession(project.id, "sess_cold")
    assert.equal(state.activeSessionId, "sess_cold")
    assert.match(document.getElementById("root").innerHTML, /Loading chat/)
    await Promise.resolve()
    assert.equal(openCalls, 1)

    resolveOpen({ status: "running", project, sessionStatuses: {} })
    await selection

    assert.equal(openCalls, 1)
    assert.equal(state.activeProjectId, project.id)
    assert.equal(state.activeSessionId, "sess_cold")
    assert.match(document.getElementById("root").innerHTML, /Cold history/)
  } finally {
    Object.assign(state, previous)
    global.window.openworking = previousOpenworking
  }
})

test("message timeout keeps the selected chat visible and offers a working retry", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  let calls = 0
  global.window.openworking = {
    runtime: {
      async listMessages() {
        calls += 1
        if (calls === 1) throw new Error("Runtime request timed out (GET /session/sess_target/message)")
        return []
      }
    },
    attachments: { async discard() {} }
  }

  const { selectSession, state } = __test
  const project = { id: "proj_message", name: "Messages", path: "/tmp/messages" }
  Object.assign(state, {
    nav: "session",
    projects: [project],
    activeProjectId: project.id,
    activeSessionId: "sess_previous",
    runtime: { status: "running", project, sessionStatuses: {} },
    sessionsByProject: {
      [project.id]: [
        { id: "sess_previous", directory: project.path },
        { id: "sess_target", directory: project.path }
      ]
    },
    messageLoadsBySession: {},
    threads: new Map(),
    pendingAttachments: [],
    pendingFileMentions: [],
    toast: null
  })

  try {
    await selectSession(project.id, "sess_target")

    assert.equal(state.activeProjectId, project.id)
    assert.equal(state.activeSessionId, "sess_target", "a load error must not fall back to New session")
    assert.equal(__test.sessionMessageLoad(project.id, "sess_target").status, "error")
    assert.match(__test.renderThreadRows(), /Could not load this chat/)
    assert.match(__test.renderThreadRows(), /data-retry-session-messages="sess_target"/)

    await __test.retrySessionMessages(project.id, "sess_target")
    assert.equal(calls, 2)
    assert.equal(__test.sessionMessageLoad(project.id, "sess_target").status, "ready")
    assert.equal(state.activeSessionId, "sess_target")
  } finally {
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("selectSession shows the viewed project's own branch when its chat is opened without a runtime restart", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const infoRequests = []
  global.window.openworking = {
    runtime: {
      async openProject() { throw new Error("should not restart on view") },
      async listMessages() { return [] }
    },
    git: {
      async info(projectId) {
        infoRequests.push(projectId)
        return { isGitRepo: true, currentBranch: "other-branch", branches: [], worktrees: [] }
      }
    },
    attachments: { async discard() {} }
  }

  const { selectSession, state } = __test
  const previousState = {
    gitInfoByProject: state.gitInfoByProject,
    gitInfoLoading: state.gitInfoLoading
  }
  Object.assign(state, {
    nav: "projects",
    projects: [
      { id: "proj_active", name: "Active", path: "/tmp/active" },
      { id: "proj_other", name: "Other", path: "/tmp/other" }
    ],
    activeProjectId: "proj_active",
    activeSessionId: null,
    runtime: { status: "running", project: { id: "proj_active" }, sessionStatuses: {} },
    sessionsByProject: { proj_other: [{ id: "ses_1", directory: "/tmp/other" }] },
    threads: new Map(),
    pendingAttachments: [],
    pendingFileMentions: [],
    // Stale entry for the previously active project must NOT leak onto proj_other's composer.
    gitInfoByProject: new Map([["proj_active", { isGitRepo: true, currentBranch: "active-branch", branches: [], worktrees: [] }]]),
    gitInfoLoading: new Set(),
    toast: null
  })

  try {
    await selectSession("proj_other", "ses_1")
    // The final render lazy-loads proj_other's git info (keyed by project). Flush microtasks so
    // the async git.info() chain settles.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Only proj_other was queried, and its branch landed in its own cache slot — proj_active's
    // stale entry is untouched, so the composer can never show "active-branch" for proj_other.
    assert.deepEqual(infoRequests, ["proj_other"])
    assert.equal(state.gitInfoByProject.get("proj_other").currentBranch, "other-branch")
    assert.equal(state.gitInfoByProject.get("proj_active").currentBranch, "active-branch")
  } finally {
    Object.assign(state, previousState)
    state.toast = null
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("selectSession dismisses a context menu left open on another row", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
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
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("selectSession during a still-starting runtime keeps the accordion open and does not collapse it", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const previousExpanded = __test.state.expanded
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

function fakeDelegatedInputEvent(attrs, value) {
  const dataset = {}
  for (const [attr, attrValue] of Object.entries(attrs)) {
    const key = attr.replace(/^data-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    dataset[key] = attrValue
  }
  const target = {
    value,
    closest(selector) {
      const attr = selector.slice(1, -1)
      if (!(attr in attrs)) return null
      return { dataset, value, matches: (sel) => sel === selector }
    }
  }
  return { type: "input", target, preventDefault() {}, stopPropagation() {} }
}

test("assistant message actions render copy and fork on the left while user actions stay unchanged", () => {
  const { renderMessageActions } = __test
  // Actions are gated on completion, so a finished turn needs stats.completed.
  const assistantHtml = renderMessageActions({
    id: "msg_ai",
    role: "assistant",
    parts: [{ type: "text", text: "Done" }],
    stats: { completed: true }
  })
  const assistantToolOnlyHtml = renderMessageActions({
    id: "msg_ai_tool",
    role: "assistant",
    parts: [{ type: "tool", tool: "write", state: { status: "completed" } }],
    stats: { completed: true }
  })
  const userHtml = renderMessageActions({
    id: "msg_user",
    role: "user",
    parts: [{ type: "text", text: "Please do this" }]
  })

  assert.match(assistantHtml, /message-actions-left/)
  assert.match(assistantHtml, /data-copy-message="msg_ai"/)
  assert.match(assistantHtml, /data-fork-message="msg_ai"/)
  assert.ok(assistantHtml.indexOf("data-copy-message") < assistantHtml.indexOf("data-fork-message"))
  assert.equal(assistantToolOnlyHtml, "")
  assert.doesNotMatch(userHtml, /message-actions-left/)
  assert.match(userHtml, /data-copy-message="msg_user"/)
  assert.doesNotMatch(userHtml, /data-fork-message/)

  const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8")
  assert.doesNotMatch(css, /\.message-actions\s*\{[^}]*opacity:\s*0/)
  assert.match(css, /\.message-action svg\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px/)
})

// Regression: the actions used to appear after the first streamed character, so copy/fork showed
// up next to the "Thinking" row while the answer was still being written.
test("assistant message actions stay hidden until the turn completes", () => {
  const { renderMessageActions } = __test
  const streaming = {
    id: "msg_stream",
    role: "assistant",
    parts: [{ type: "text", text: "Partial ans" }],
    stats: { completed: false }
  }
  assert.equal(renderMessageActions(streaming), "")
  assert.equal(renderMessageActions({ ...streaming, stats: undefined }), "")
  const done = renderMessageActions({ ...streaming, stats: { completed: true } })
  assert.match(done, /data-copy-message="msg_stream"/)
  assert.match(done, /data-fork-message="msg_stream"/)
})

test("assistant actions stay hidden across the chat until the active thread settles", () => {
  const { renderMessageActions, state } = __test
  const previousSessionId = state.activeSessionId
  const previousThreads = state.threads
  const completed = {
    id: "msg_history",
    role: "assistant",
    parts: [{ type: "text", text: "Earlier completed answer" }],
    stats: { completed: true }
  }
  const user = {
    id: "msg_user",
    role: "user",
    parts: [{ type: "text", text: "Continue" }]
  }
  const thread = {
    sessionId: "sess_actions",
    status: { type: "busy" },
    messages: [completed],
    pendingQuestions: [],
    pendingPermissions: [],
    pendingForms: []
  }

  state.activeSessionId = "sess_actions"
  state.threads = new Map([["sess_actions", thread]])
  try {
    assert.equal(renderMessageActions(completed), "", "busy hides historical assistant actions")
    assert.match(renderMessageActions(user), /data-copy-message="msg_user"/, "user actions stay available")

    thread.status = { type: "retry" }
    assert.equal(renderMessageActions(completed), "")

    thread.status = { type: "idle" }
    thread.pendingQuestions = [{ requestID: "question_1" }]
    assert.equal(renderMessageActions(completed), "", "pending blockers keep assistant actions hidden")

    thread.pendingQuestions = []
    thread.messages.push({
      id: "msg_running_tool",
      role: "assistant",
      parts: [{ type: "tool", tool: "read", state: { status: "running" } }]
    })
    assert.equal(renderMessageActions(completed), "", "a running tool keeps assistant actions hidden")

    thread.messages.pop()
    assert.match(renderMessageActions(completed), /data-copy-message="msg_history"/)
    assert.match(renderMessageActions(completed), /data-fork-message="msg_history"/)
  } finally {
    state.activeSessionId = previousSessionId
    state.threads = previousThreads
  }
})

test("forkAssistantMessage passes the next message as the fork boundary", async () => {
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
    forkMarkers: state.forkMarkers,
    expanded: state.expanded,
    nav: state.nav,
    toast: state.toast
  }
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  let forkArgs = null
  global.window.openworking = {
    runtime: {
      async forkSession(args) {
        forkArgs = args
        return { id: "sess_fork", title: "Forked", directory: "/tmp/project" }
      },
      async listSessionsForDirectory(directory) {
        assert.equal(directory, "/tmp/project")
        return [{ id: "sess_fork", title: "Forked", directory: "/tmp/project" }]
      },
      async listMessages(args) {
        assert.deepEqual(args, { sessionId: "sess_fork", directory: "/tmp/project" })
        return [
          { id: "fork_user_1", role: "user", parts: [{ type: "text", text: "Do it" }] },
          { id: "fork_ai_1", role: "assistant", parts: [{ type: "text", text: "Done" }] }
        ]
      }
    }
  }

  try {
    Object.assign(state, {
      projects: [{ id: "proj", name: "Project", path: "/tmp/project" }],
      sessionsByProject: { proj: [{ id: "sess_parent", title: "Parent", directory: "/tmp/project" }] },
      activeProjectId: "proj",
      activeSessionId: "sess_parent",
      runtime: { status: "running", project: { id: "proj" }, sessionStatuses: {} },
      forkMarkers: new Map(),
      threads: new Map([["sess_parent", {
        sessionId: "sess_parent",
        messages: [
          { id: "msg_user_1", role: "user", parts: [{ type: "text", text: "Do it" }] },
          { id: "msg_ai_1", role: "assistant", parts: [{ type: "text", text: "Done" }] },
          { id: "msg_user_2", role: "user", parts: [{ type: "text", text: "Continue" }] }
        ],
        pendingQuestions: [],
        pendingPermissions: [],
        status: { type: "idle" }
      }]]),
      expanded: new Set(),
      nav: "session",
      toast: null
    })

    await __test.forkAssistantMessage("msg_ai_1")

    assert.deepEqual(forkArgs, {
      sessionId: "sess_parent",
      messageId: "msg_user_2",
      directory: "/tmp/project"
    })
    assert.equal(state.activeSessionId, "sess_fork")
    assert.equal(state.forkMarkers.get("sess_fork"), "fork_ai_1")
    assert.match(__test.renderThreadMessages([{ id: "fork_ai_1", role: "user", parts: [] }]), /Forked from conversation/)
    assert.equal(state.toast, "Chat forked")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("forkAssistantMessage omits the boundary for the latest assistant response", async () => {
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
    forkMarkers: state.forkMarkers,
    expanded: state.expanded,
    nav: state.nav,
    toast: state.toast
  }
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  let forkArgs = null
  global.window.openworking = {
    runtime: {
      async forkSession(args) {
        forkArgs = args
        return { id: "sess_fork_full", title: "Forked", directory: "/tmp/project" }
      },
      async listSessionsForDirectory() {
        return [{ id: "sess_fork_full", title: "Forked", directory: "/tmp/project" }]
      },
      async listMessages() {
        return [
          { id: "fork_user_1", role: "user", parts: [{ type: "text", text: "Do it" }] },
          { id: "fork_ai_1", role: "assistant", parts: [{ type: "text", text: "Done" }] }
        ]
      }
    }
  }

  try {
    Object.assign(state, {
      projects: [{ id: "proj", name: "Project", path: "/tmp/project" }],
      sessionsByProject: { proj: [{ id: "sess_parent", title: "Parent", directory: "/tmp/project" }] },
      activeProjectId: "proj",
      activeSessionId: "sess_parent",
      runtime: { status: "running", project: { id: "proj" }, sessionStatuses: {} },
      forkMarkers: new Map(),
      threads: new Map([["sess_parent", {
        sessionId: "sess_parent",
        messages: [
          { id: "msg_user_1", role: "user", parts: [{ type: "text", text: "Do it" }] },
          { id: "msg_ai_1", role: "assistant", parts: [{ type: "text", text: "Done" }] }
        ],
        pendingQuestions: [],
        pendingPermissions: [],
        status: { type: "idle" }
      }]]),
      expanded: new Set(),
      nav: "session",
      toast: null
    })

    await __test.forkAssistantMessage("msg_ai_1")

    assert.deepEqual(forkArgs, {
      sessionId: "sess_parent",
      directory: "/tmp/project"
    })
    assert.equal(state.activeSessionId, "sess_fork_full")
    assert.equal(state.forkMarkers.get("sess_fork_full"), "fork_ai_1")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

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

test("composer renders catalog variants and keeps a native model ref per session", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const { currentReasoningMode, handleRuntimeStream, renderComposer, setCurrentReasoningMode, state } = __test
  const previous = {
    config: state.config,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    modelRefBySession: state.modelRefBySession,
    agentBySession: state.agentBySession,
    newSessionModelRef: state.newSessionModelRef,
    popover: state.popover,
    providerId: state.providerId,
    modelSelectionBusy: state.modelSelectionBusy,
    toast: state.toast
  }
  const selections = []
  try {
    global.window.openworking = {
      runtime: {
        async selectSessionModel(payload) {
          selections.push(payload)
        }
      }
    }
    state.providerId = "openworking"
    state.activeProjectId = "proj_1"
    state.activeSessionId = null
    state.sessionsByProject = {
      proj_1: [
        { id: "sess_a", model: { providerID: "openworking", id: "google/gemma-4-31B-it" } },
        { id: "sess_b", model: { providerID: "openworking", id: "google/gemma-4-31B-it" } }
      ]
    }
    state.modelRefBySession = new Map()
    state.agentBySession = new Map()
    state.newSessionModelRef = null
    state.popover = "reasoning"
    state.config = {
      provider: {
        openworking: {
          npm: "@ai-sdk/openai-compatible",
          name: "Gemma 4-31B",
          options: { baseURL: "http://127.0.0.1:1234/api/v1", apiKey: "" },
          models: {
            "google/gemma-4-31B-it": {
              name: "google/gemma-4-31B-it",
              modalities: { input: ["text", "image", "pdf"], output: ["text"] },
              options: { max_completion_tokens: 32000 },
              variants: {
                medium: { reasoningEffort: "medium" },
                high: { reasoningEffort: "high" },
                xhigh: { reasoningEffort: "xhigh" }
              }
            }
          }
        }
      }
    }

    const html = renderComposer({ id: "proj_1", name: "Project" })
    assert.match(html, /data-popover="reasoning"/)
    assert.match(html, /class="reasoning-control/)
    assert.match(html, /None - let the model decide its own reasoning effort/)
    assert.match(html, /Base does not select a variant/)
    assert.match(html, /Extra High/)
    assert.doesNotMatch(html, /data-model-reasoning/)
    // The model is pinned: the composer shows a static label, never a picker.
    // A single-model provider displays under the provider's friendly name.
    assert.match(html, /<span class="model-label" title="Gemma 4-31B">Gemma 4-31B<\/span>/)
    assert.doesNotMatch(html, /data-popover="model"/)
    assert.doesNotMatch(html, /data-model=/)

    await setCurrentReasoningMode("xhigh", { keepPopover: true })
    assert.equal(state.popover, "reasoning")
    assert.deepEqual(state.newSessionModelRef, {
      providerID: "openworking",
      id: "google/gemma-4-31B-it",
      variant: "xhigh"
    })

    state.activeSessionId = "sess_a"
    await setCurrentReasoningMode("xhigh")
    state.activeSessionId = "sess_b"
    assert.equal(currentReasoningMode(), "none")
    await setCurrentReasoningMode("medium")
    assert.equal(state.modelRefBySession.get("sess_b").variant, "medium")
    state.activeSessionId = "sess_a"
    assert.equal(currentReasoningMode(), "xhigh")
    handleRuntimeStream({
      type: "session.model.selected",
      sessionID: "sess_a",
      model: { providerID: "openworking", id: "google/gemma-4-31B-it", variant: "high" }
    })
    assert.equal(currentReasoningMode(), "high")
    global.window.openworking.runtime.selectSessionModel = async () => {
      throw new Error("Model switch rejected")
    }
    await setCurrentReasoningMode("medium")
    assert.equal(currentReasoningMode(), "high", "failed selection must roll back the optimistic variant")
    assert.equal(state.toast, "Model switch rejected")
    assert.deepEqual(selections, [
      {
        sessionId: "sess_a",
        model: { providerID: "openworking", id: "google/gemma-4-31B-it", variant: "xhigh" }
      },
      {
        sessionId: "sess_b",
        model: { providerID: "openworking", id: "google/gemma-4-31B-it", variant: "medium" }
      }
    ])
  } finally {
    Object.assign(state, previous)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("modelOptions exposes contextLimit from model.limit.context, undefined when the model declares none", () => {
  const { modelOptions, selectedModel, state } = __test
  const previous = {
    config: state.config,
    providerId: state.providerId,
    activeSessionId: state.activeSessionId,
    newSessionModelRef: state.newSessionModelRef
  }
  try {
    state.providerId = "openworking"
    state.activeSessionId = null
    state.config = {
      provider: {
        openworking: {
          name: "OpenWorking",
          models: {
            "with-limit": { name: "With Limit", limit: { context: 967000, output: 32000 } },
            "no-limit": { name: "No Limit" }
          }
        }
      }
    }

    const options = modelOptions()
    const withLimit = options.find((option) => option.modelID === "with-limit")
    const noLimit = options.find((option) => option.modelID === "no-limit")
    assert.equal(withLimit.contextLimit, 967000)
    assert.equal(noLimit.contextLimit, undefined)

    state.newSessionModelRef = { providerID: "openworking", id: "with-limit" }
    assert.equal(selectedModel().contextLimit, 967000)

    state.newSessionModelRef = { providerID: "openworking", id: "no-limit" }
    assert.equal(selectedModel().contextLimit, undefined)
  } finally {
    Object.assign(state, previous)
  }
})

test("contextWindowUsage computes used/total/pct from the latest assistant message, or null when data is missing", () => {
  const { contextWindowUsage } = __test
  const modelWithLimit = { contextLimit: 967000 }
  const modelWithoutLimit = { contextLimit: undefined }
  const threadWithAssistantReply = {
    messages: [
      { role: "user", parts: [] },
      { role: "assistant", stats: { inputTokens: 230000, totalTokens: 231500 } }
    ]
  }
  const threadWithNoAssistantReply = { messages: [{ role: "user", parts: [] }] }

  // Case 1: enough data -> used/total/pct.
  const usage = contextWindowUsage(threadWithAssistantReply, modelWithLimit)
  assert.deepEqual(usage, { used: 230000, total: 967000, pct: 24 })

  // Case 2: no assistant message yet in the thread -> null (hide the indicator).
  assert.equal(contextWindowUsage(threadWithNoAssistantReply, modelWithLimit), null)

  // Case 3: model has no declared context limit -> null.
  assert.equal(contextWindowUsage(threadWithAssistantReply, modelWithoutLimit), null)

  // No thread at all (e.g. no active session) -> null.
  assert.equal(contextWindowUsage(null, modelWithLimit), null)
})

test("renderContextRing draws a valid two-circle progress ring for any pct, clamped to 0-100", () => {
  const { renderContextRing } = __test
  for (const pct of [0, 24, 50, 100]) {
    const svg = renderContextRing(pct)
    assert.match(svg, /^<svg viewBox="0 0 24 24">.*<\/svg>$/)
    const circleCount = (svg.match(/<circle /g) || []).length
    assert.equal(circleCount, 2, `expected a track circle + progress circle for pct=${pct}`)
    assert.match(svg, /stroke-dasharray="[\d.]+"/)
    assert.match(svg, /stroke-dashoffset="[\d.]+"/)
  }
  // Out-of-range input is clamped rather than producing a negative/overflowing offset.
  assert.doesNotThrow(() => renderContextRing(-10))
  assert.doesNotThrow(() => renderContextRing(150))
})

test("contextThresholdColor maps pct to green/amber/red bands, and both the ring and popup use it", () => {
  const { contextThresholdColor, renderContextRing, renderContextPopover } = __test
  assert.equal(contextThresholdColor(0), "var(--green)")
  assert.equal(contextThresholdColor(59), "var(--green)")
  assert.equal(contextThresholdColor(60), "var(--amber)")
  assert.equal(contextThresholdColor(84), "var(--amber)")
  assert.equal(contextThresholdColor(85), "var(--red)")
  assert.equal(contextThresholdColor(100), "var(--red)")

  assert.match(renderContextRing(25), /stroke="var\(--green\)"/)
  assert.match(renderContextRing(68), /stroke="var\(--amber\)"/)
  assert.match(renderContextRing(91), /stroke="var\(--red\)"/)

  const popup = renderContextPopover({ used: 87000, total: 128000, pct: 68 })
  assert.match(popup, /<svg viewBox="0 0 24 24">/)
  assert.match(popup, /color: var\(--amber\)">68%<\/strong>/)
  assert.match(popup, /width: 68%; background: var\(--amber\)/)
})

test("composer shows the context-ring button and popup when usage data is available, hides it otherwise", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const { renderComposer, state } = __test
  const previous = {
    config: state.config,
    activeSessionId: state.activeSessionId,
    threads: state.threads,
    popover: state.popover,
    providerId: state.providerId,
    runtime: state.runtime,
    modelRefBySession: state.modelRefBySession
  }
  try {
    state.providerId = "openworking"
    state.modelRefBySession = new Map([[
      "sess_ctx",
      { providerID: "openworking", id: "with-limit" }
    ]])
    state.config = {
      provider: {
        openworking: {
          name: "OpenWorking",
          models: { "with-limit": { name: "With Limit", limit: { context: 967000, output: 32000 } } }
        }
      }
    }
    state.activeSessionId = "sess_ctx"
    state.runtime = { status: "running", project: { id: "proj_1" }, sessionStatuses: {}, compactionStatuses: {} }
    state.threads = new Map([["sess_ctx", {
      messages: [{ role: "assistant", stats: { inputTokens: 230000, totalTokens: 231500 } }]
    }]])

    state.popover = null
    let html = renderComposer({ id: "proj_1", name: "Project" })
    assert.match(html, /data-popover="context"/)
    assert.match(html, /class="context-ring-btn"/)
    assert.doesNotMatch(html, /class="pop pop-up context-pop"/)

    state.popover = "context"
    html = renderComposer({ id: "proj_1", name: "Project" })
    assert.match(html, /class="pop pop-up context-pop"/)
    assert.match(html, /Context window/)
    assert.match(html, /230\.0k/)
    assert.match(html, /967\.0k/)
    assert.match(html, />24%</)

    // After compaction, the last assistant token count is stale until the next response.
    state.runtime.compactionStatuses.sess_ctx = { status: "ended", reason: "manual" }
    html = renderComposer({ id: "proj_1", name: "Project" })
    assert.match(html, /Context compacted; usage updates after the next response/)
    assert.match(html, /Usage pending/)
    assert.doesNotMatch(html, /230\.0k/)
    delete state.runtime.compactionStatuses.sess_ctx

    // No assistant message yet in the thread -> the button must not render at all.
    state.threads = new Map([["sess_ctx", { messages: [] }]])
    html = renderComposer({ id: "proj_1", name: "Project" })
    assert.doesNotMatch(html, /data-popover="context"/)

    // Restore the assistant message, but switch to a model with no declared context limit
    // -> the button must not render even though usage data would otherwise be computable.
    state.threads = new Map([["sess_ctx", {
      messages: [{ role: "assistant", stats: { inputTokens: 230000, totalTokens: 231500 } }]
    }]])
    state.config = {
      provider: {
        openworking: {
          name: "OpenWorking",
          models: { "no-limit": { name: "No Limit" } }
        }
      }
    }
    state.modelRefBySession.set("sess_ctx", { providerID: "openworking", id: "no-limit" })
    html = renderComposer({ id: "proj_1", name: "Project" })
    assert.doesNotMatch(html, /data-popover="context"/)
  } finally {
    Object.assign(state, previous)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("manual compaction coalesces requests and projects lifecycle state without chat messages", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const { compactActiveSession, handleRuntimeStream, handleRuntimeUpdate, renderContextPopover, renderCounters, state } = __test
  const previous = {
    activeSessionId: state.activeSessionId,
    runtime: state.runtime,
    threads: state.threads,
    toast: state.toast
  }
  let resolveCompact
  let compactCalls = 0
  try {
    global.window.openworking = {
      runtime: {
        async compactSession() {
          compactCalls += 1
          await new Promise((resolve) => { resolveCompact = resolve })
        }
      }
    }
    state.activeSessionId = "sess_compact"
    state.runtime = {
      status: "running",
      project: { id: "proj_1" },
      sessionStatuses: {},
      compactionStatuses: {}
    }
    state.threads = new Map([["sess_compact", {
      sessionId: "sess_compact",
      messages: [{ id: "msg_1", role: "user", parts: [{ type: "text", text: "Keep me" }] }],
      pendingQuestions: [],
      pendingPermissions: [],
      status: { type: "idle" }
    }]])

    const first = compactActiveSession()
    await compactActiveSession()
    assert.equal(compactCalls, 1)
    assert.equal(state.runtime.compactionStatuses.sess_compact.status, "admitted")
    resolveCompact()
    await first

    handleRuntimeStream({ type: "session.compaction.started", sessionID: "sess_compact", reason: "manual" })
    assert.equal(state.runtime.compactionStatuses.sess_compact.status, "running")
    const messageCount = state.threads.get("sess_compact").messages.length
    const runtimeBeforeDelta = state.runtime
    handleRuntimeStream({ type: "session.compaction.delta", sessionID: "sess_compact" })
    assert.equal(state.threads.get("sess_compact").messages.length, messageCount)
    assert.strictEqual(state.runtime, runtimeBeforeDelta, "checkpoint deltas must not update renderer state")

    handleRuntimeStream({ type: "session.compaction.failed", sessionID: "sess_compact", error: "Try again" })
    assert.equal(state.runtime.compactionStatuses.sess_compact.status, "failed")
    assert.equal(state.toast, "Try again")
    assert.match(renderContextPopover({ used: 2000, total: 10000, pct: 20 }), /Try again/)

    state.runtime.compactionStatuses.sess_compact = { status: "ended", reason: "manual" }
    const ended = renderContextPopover({ used: null, total: 10000, pct: null, stale: true })
    assert.match(ended, /Compacted; usage updates after the next response/)
    assert.match(ended, /Usage pending/)
    assert.doesNotMatch(ended, />0%<\/strong>/)

    renderCounters.reset()
    handleRuntimeUpdate({ ...state.runtime, compactionStatuses: {} })
    assert.equal(renderCounters.snapshot().full, 1, "clearing stale usage after the next response must repaint the composer")
  } finally {
    Object.assign(state, previous)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("Undo stages a user boundary, restores safe references, and Redo clears the baseline", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const {
    confirmStageSessionRevert,
    openRevertConfirmation,
    renderRevertBanner,
    settleSessionRevert,
    undoLastPrompt,
    state
  } = __test
  const previous = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    runtime: state.runtime,
    config: state.config,
    modelRefBySession: state.modelRefBySession,
    agentBySession: state.agentBySession,
    promptDraft: state.promptDraft,
    pendingAttachments: state.pendingAttachments,
    pendingFileMentions: state.pendingFileMentions,
    revertDraftBySession: state.revertDraftBySession,
    revertConfirmTarget: state.revertConfirmTarget,
    revertSubmitting: state.revertSubmitting,
    revertError: state.revertError,
    gitInfoByProject: state.gitInfoByProject,
    rightSidebarOpen: state.rightSidebarOpen,
    toast: state.toast
  }
  const calls = []
  let sessionRevert = null
  try {
    global.window.openworking = {
      runtime: {
        async stageSessionRevert(payload) {
          calls.push(["stage", payload])
          sessionRevert = {
            messageID: payload.messageId,
            files: [{ file: "src/app.js", status: "modified", additions: 2, deletions: 1 }]
          }
          return sessionRevert
        },
        async clearSessionRevert(payload) {
          calls.push(["clear", payload])
          sessionRevert = null
        },
        async commitSessionRevert(payload) {
          calls.push(["commit", payload])
          sessionRevert = null
        },
        async listSessions() {
          return [{
            id: "sess_revert",
            title: "Revert",
            directory: "/tmp/project",
            revert: sessionRevert,
            model: { providerID: "openworking", id: "model-one" }
          }]
        },
        async listMessages(payload) {
          calls.push(["messages", payload])
          return []
        }
      },
      git: {
        async info() {
          return { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }
        }
      }
    }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false },
      projects: [{ id: "proj_1", name: "Project", path: "/tmp/project" }],
      activeProjectId: "proj_1",
      activeSessionId: "sess_revert",
      sessionsByProject: {
        proj_1: [{
          id: "sess_revert",
          title: "Revert",
          directory: "/tmp/project",
          model: { providerID: "openworking", id: "model-one" }
        }]
      },
      threads: new Map([["sess_revert", {
        sessionId: "sess_revert",
        messages: [
          { id: "msg_old", role: "user", parts: [{ type: "text", text: "Earlier prompt" }] },
          {
            id: "msg_latest",
            role: "user",
            parts: [
              { type: "text", text: "Undo this prompt" },
              { type: "file-ref", token: "@app.js", path: "src/app.js", name: "app.js" },
              { type: "file", filename: "diagram.png" }
            ]
          }
        ],
        pendingQuestions: [],
        pendingPermissions: [],
        status: { type: "idle" }
      }]]),
      runtime: {
        status: "running",
        project: { id: "proj_1" },
        sessionStatuses: {},
        compactionStatuses: {}
      },
      config: {
        provider: {
          openworking: {
            name: "Provider",
            models: { "model-one": { name: "Model One" } }
          }
        }
      },
      modelRefBySession: new Map([[
        "sess_revert",
        { providerID: "openworking", id: "model-one" }
      ]]),
      agentBySession: new Map([["sess_revert", "build"]]),
      promptDraft: "",
      pendingAttachments: [],
      pendingFileMentions: [],
      revertDraftBySession: new Map(),
      revertConfirmTarget: null,
      revertSubmitting: false,
      revertError: null,
      gitInfoByProject: new Map([["proj_1", { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }]]),
      rightSidebarOpen: false,
      toast: null
    })

    undoLastPrompt()
    assert.equal(state.revertConfirmTarget.messageId, "msg_latest")
    assert.equal(state.revertConfirmTarget.restoreDraft, true)
    assert.match(document.getElementById("root").innerHTML, /only conversation rollback is guaranteed/)
    assert.match(document.getElementById("root").innerHTML, /external attachment/)

    await confirmStageSessionRevert()
    assert.deepEqual(calls[0], ["stage", {
      sessionId: "sess_revert",
      messageId: "msg_latest",
      files: true
    }])
    assert.equal(state.promptDraft, "Undo this prompt")
    assert.deepEqual(state.pendingFileMentions, [{
      token: "@app.js",
      path: "src/app.js",
      name: "app.js"
    }])
    assert.deepEqual(state.pendingAttachments, [], "external attachments must be reattached manually")
    assert.match(renderRevertBanner(), /1 message hidden/)
    assert.match(renderRevertBanner(), /1 file restored/)
    assert.match(renderRevertBanner(), /src\/app\.js/)
    assert.match(renderRevertBanner(), /Redo/)
    assert.match(renderRevertBanner(), /Keep revert/)

    state.threads.get("sess_revert").messages = [
      { id: "msg_old", role: "user", parts: [{ type: "text", text: "Earlier prompt" }] }
    ]
    undoLastPrompt()
    assert.equal(state.revertConfirmTarget.messageId, "msg_old")
    assert.equal(state.revertConfirmTarget.repeated, true)
    assert.equal(state.revertConfirmTarget.messageCount, 2)
    assert.deepEqual(state.revertConfirmTarget.attachmentNames, ["diagram.png"])
    await confirmStageSessionRevert()
    assert.equal(calls.filter(([type]) => type === "stage").length, 2)
    assert.equal(state.promptDraft, "Earlier prompt")
    assert.match(renderRevertBanner(), /2 messages hidden/)

    await settleSessionRevert("clear")
    assert.equal(calls.some(([type]) => type === "clear"), true)
    assert.equal(state.promptDraft, "")
    assert.deepEqual(state.pendingFileMentions, [])
    assert.equal(state.revertDraftBySession.has("sess_revert"), false)

    openRevertConfirmation("msg_old")
    assert.equal(state.revertConfirmTarget.restoreDraft, false)
    await confirmStageSessionRevert()
    assert.equal(state.promptDraft, "", "Revert to here must not copy the selected prompt")
    await settleSessionRevert("commit")
    assert.equal(calls.some(([type]) => type === "commit"), true)
    assert.equal(state.revertDraftBySession.has("sess_revert"), false)

    global.window.openworking.runtime.stageSessionRevert = async () => {
      throw new Error("Session became busy")
    }
    openRevertConfirmation("msg_old")
    await confirmStageSessionRevert()
    assert.equal(state.sessionsByProject.proj_1[0].revert, null)
    assert.equal(state.promptDraft, "")
    assert.equal(state.revertConfirmTarget.messageId, "msg_old")
    assert.equal(state.revertError, "Session became busy")
  } finally {
    Object.assign(state, previous)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("external revert events clear the local redo baseline and refresh project file state", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const { handleRuntimeStream, state } = __test
  const previous = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    runtime: state.runtime,
    revertDraftBySession: state.revertDraftBySession,
    gitInfoByProject: state.gitInfoByProject,
    gitInfoLoading: state.gitInfoLoading,
    fileTreeProjectId: state.fileTreeProjectId,
    fileTreeLoading: state.fileTreeLoading,
    fileTreeError: state.fileTreeError,
    fileTreeExpanded: state.fileTreeExpanded,
    fileTreeChildren: state.fileTreeChildren,
    rightSidebarOpen: state.rightSidebarOpen
  }
  let gitRefreshes = 0
  try {
    global.window.openworking = {
      git: {
        async info() {
          gitRefreshes += 1
          return { isGitRepo: true, currentBranch: "main", branches: [], worktrees: [] }
        }
      }
    }
    Object.assign(state, {
      projects: [{ id: "proj_sync", name: "Project", path: "/tmp/project" }],
      activeProjectId: "proj_sync",
      activeSessionId: null,
      sessionsByProject: {
        proj_sync: [{ id: "sess_sync", revert: { messageID: "msg_1" } }]
      },
      runtime: { status: "idle", compactionStatuses: {}, sessionStatuses: {} },
      revertDraftBySession: new Map([["sess_sync", {
        restoreDraft: true,
        messageCount: 3,
        attachmentNames: ["diagram.png"]
      }]]),
      gitInfoByProject: new Map([["proj_sync", { isGitRepo: false }]]),
      gitInfoLoading: new Set(),
      fileTreeProjectId: "proj_sync",
      fileTreeLoading: new Set(["src"]),
      fileTreeError: "stale",
      fileTreeExpanded: new Set(["src"]),
      fileTreeChildren: new Map([["", [{ path: "src/app.js" }]]]),
      rightSidebarOpen: false
    })

    handleRuntimeStream({ type: "session.revert.cleared", sessionID: "sess_sync" })
    await new Promise((resolve) => setTimeout(resolve, 220))

    assert.equal(state.sessionsByProject.proj_sync[0].revert, null)
    assert.equal(state.revertDraftBySession.has("sess_sync"), false)
    assert.equal(state.fileTreeChildren.size, 0)
    assert.equal(state.fileTreeExpanded.size, 0)
    assert.equal(state.fileTreeLoading.size, 0)
    assert.equal(state.fileTreeError, "")
    assert.equal(gitRefreshes, 1)
  } finally {
    Object.assign(state, previous)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("assistant responses and the thinking indicator omit elapsed-time metadata", () => {
  const { renderThreadMessage, renderThreadRows, state } = __test
  const previousActiveSessionId = state.activeSessionId
  const previousThreads = state.threads
  const settledHtml = renderThreadMessage({
    id: "assistant-settled",
    role: "assistant",
    stats: { completed: true, elapsedMs: 21000 },
    parts: [{ type: "text", text: "Done" }]
  })

  try {
    state.activeSessionId = "assistant-thinking"
    state.threads = new Map([["assistant-thinking", {
      messages: [{
        id: "assistant-streaming",
        role: "assistant",
        stats: { completed: false, createdAt: Date.now() - 7000 },
        parts: []
      }],
      pendingPermissions: [],
      pendingQuestions: [],
      status: { type: "busy" }
    }]])

    const thinkingHtml = renderThreadRows()
    assert.match(thinkingHtml, /Thinking/)
    assert.doesNotMatch(`${settledHtml}${thinkingHtml}`, /message-footer|live-stats|21s|7s/)
  } finally {
    state.activeSessionId = previousActiveSessionId
    state.threads = previousThreads
  }
})

test("tool rows omit icons and per-tool timing or token stats", () => {
  const { renderThreadMessage } = __test
  const html = renderThreadMessage({
    id: "assistant-tool-ui",
    role: "assistant",
    stats: { completed: false, createdAt: Date.now() - 21000, runTokens: 47200 },
    parts: [{
      id: "tool-1",
      type: "tool",
      tool: "glob",
      state: { status: "running", input: { pattern: "**/*" } }
    }]
  })

  assert.match(html, /Searching files - \*\*\/\*/)
  assert.match(html, /Processing/)
  assert.doesNotMatch(html, /tool-step-icon/)
  assert.doesNotMatch(html, /live-stats|tokens|21s/)
})

test("memory project selector targets the chosen project without changing the active project", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const {
    dispatchDelegated,
    getDelegatedInput,
    loadMemory,
    saveMemory,
    state
  } = __test
  const previousState = {
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    selectedMemoryProjectId: state.selectedMemoryProjectId,
    memory: state.memory,
    memoryDraft: state.memoryDraft,
    memoryLoading: state.memoryLoading,
    memorySaving: state.memorySaving,
    memoryError: state.memoryError,
    nav: state.nav,
    skillsTab: state.skillsTab
  }
  const calls = []
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.window.openworking = {
    memory: {
      async get(projectId) {
        calls.push({ type: "get", projectId })
        return {
          global: "global memory",
          project: projectId ? `memory:${projectId}` : "",
          projectId,
          hasProject: !!projectId,
          activeProjectId: "proj_a"
        }
      },
      async save(scope, content, projectId) {
        calls.push({ type: "save", scope, content, projectId })
        return {
          global: scope === "global" ? content : "global memory",
          project: scope === "project" ? content : (projectId ? `memory:${projectId}` : ""),
          projectId,
          hasProject: !!projectId,
          activeProjectId: "proj_a"
        }
      }
    }
  }

  try {
    state.projects = [
      { id: "proj_a", name: "Project A", path: "/tmp/a" },
      { id: "proj_b", name: "Project B", path: "/tmp/b" }
    ]
    state.activeProjectId = "proj_a"
    state.auth = { status: "authenticated", user: { email: "test@example.com" } }
    state.selectedMemoryProjectId = null
    state.memory = null
    state.memoryDraft = null
    state.memoryLoading = false
    state.memorySaving = null
    state.memoryError = null
    state.nav = "skills"
    state.skillsTab = "memory"

    await loadMemory()
    assert.equal(calls[0].type, "get")
    assert.equal(calls[0].projectId, "proj_a")
    assert.equal(state.activeProjectId, "proj_a")
    __test.render()
    assert.ok(document.querySelector("[data-memory-project]"))
    assert.match(document.querySelector("[data-skills-panel-host]").textContent, /Project B/)

    dispatchDelegated(fakeDelegatedInputEvent({ "data-memory-project": "proj_b" }, "proj_b"), getDelegatedInput())
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(state.selectedMemoryProjectId, "proj_b")
    assert.equal(state.activeProjectId, "proj_a")
    assert.deepEqual(calls[1], { type: "get", projectId: "proj_b" })

    state.memoryDraft.project = "project b memory"
    await saveMemory("project")
    assert.deepEqual(calls[2], { type: "save", scope: "project", content: "project b memory", projectId: "proj_b" })
    assert.equal(state.activeProjectId, "proj_a")

    state.memoryDraft.global = "global update"
    await saveMemory("global")
    assert.deepEqual(calls[3], { type: "save", scope: "global", content: "global update", projectId: "proj_b" })
    assert.equal(state.activeProjectId, "proj_a")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("loadMemory ignores stale responses when project selection changes quickly", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const { loadMemory, state } = __test
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    selectedMemoryProjectId: state.selectedMemoryProjectId,
    memory: state.memory,
    memoryDraft: state.memoryDraft,
    memoryLoading: state.memoryLoading,
    memoryError: state.memoryError,
    memoryLoadSeq: state.memoryLoadSeq,
    nav: state.nav,
    skillsTab: state.skillsTab
  }
  let resolveA = null
  let resolveB = null
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.window.openworking = {
    memory: {
      get(projectId) {
        return new Promise((resolve) => {
          if (projectId === "proj_a") resolveA = () => resolve({
            global: "global a",
            project: "memory:proj_a",
            projectId: "proj_a",
            hasProject: true,
            activeProjectId: "proj_a"
          })
          if (projectId === "proj_b") resolveB = () => resolve({
            global: "global b",
            project: "memory:proj_b",
            projectId: "proj_b",
            hasProject: true,
            activeProjectId: "proj_a"
          })
        })
      }
    }
  }

  try {
    state.projects = [
      { id: "proj_a", name: "Project A", path: "/tmp/a" },
      { id: "proj_b", name: "Project B", path: "/tmp/b" }
    ]
    state.activeProjectId = "proj_a"
    state.selectedMemoryProjectId = "proj_a"
    state.memory = null
    state.memoryDraft = null
    state.memoryLoading = false
    state.memoryError = null
    state.memoryLoadSeq = 0
    state.nav = "skills"
    state.skillsTab = "memory"

    const first = loadMemory()
    state.selectedMemoryProjectId = "proj_b"
    const second = loadMemory()

    resolveB()
    await second
    resolveA()
    await first

    assert.equal(state.selectedMemoryProjectId, "proj_b")
    assert.equal(state.memory.projectId, "proj_b")
    assert.equal(state.memoryDraft.project, "memory:proj_b")
    assert.equal(state.memoryLoading, false)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("switching the memory project keeps unsaved global-memory edits", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const { dispatchDelegated, getDelegatedInput, loadMemory, state } = __test
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    selectedMemoryProjectId: state.selectedMemoryProjectId,
    memory: state.memory,
    memoryDraft: state.memoryDraft,
    memoryLoading: state.memoryLoading,
    memorySaving: state.memorySaving,
    memoryError: state.memoryError,
    memoryLoadSeq: state.memoryLoadSeq,
    nav: state.nav,
    skillsTab: state.skillsTab
  }
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.window.openworking = {
    memory: {
      async get(projectId) {
        return {
          global: "saved global",
          project: projectId ? `memory:${projectId}` : "",
          projectId,
          hasProject: !!projectId,
          activeProjectId: "proj_a"
        }
      }
    }
  }

  try {
    state.projects = [
      { id: "proj_a", name: "Project A", path: "/tmp/a" },
      { id: "proj_b", name: "Project B", path: "/tmp/b" }
    ]
    state.activeProjectId = "proj_a"
    state.selectedMemoryProjectId = "proj_a"
    state.memory = null
    state.memoryDraft = null
    state.memoryLoading = false
    state.memorySaving = null
    state.memoryError = null
    state.memoryLoadSeq = 0
    state.nav = "skills"
    state.skillsTab = "memory"

    await loadMemory()
    assert.equal(state.memoryDraft.global, "saved global")

    // User types unsaved global text, then switches the project selector.
    state.memoryDraft.global = "unsaved global edit"
    dispatchDelegated(fakeDelegatedInputEvent({ "data-memory-project": "proj_b" }, "proj_b"), getDelegatedInput())
    await new Promise((resolve) => setImmediate(resolve))

    // Global draft is preserved; only the project draft follows the new selection.
    assert.equal(state.memoryDraft.global, "unsaved global edit")
    assert.equal(state.memoryDraft.project, "memory:proj_b")
    assert.equal(state.selectedMemoryProjectId, "proj_b")
    assert.equal(state.activeProjectId, "proj_a")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("project memory button opens the memory screen for the clicked project", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const { dispatchDelegated, getDelegatedClick, state } = __test
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    selectedMemoryProjectId: state.selectedMemoryProjectId,
    memory: state.memory,
    memoryDraft: state.memoryDraft,
    memoryLoading: state.memoryLoading,
    memoryError: state.memoryError,
    nav: state.nav,
    skillsTab: state.skillsTab
  }
  const calls = []
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.window.openworking = {
    memory: {
      async get(projectId) {
        calls.push(projectId)
        return {
          global: "global memory",
          project: `memory:${projectId}`,
          projectId,
          hasProject: true,
          activeProjectId: "proj_a"
        }
      }
    }
  }

  try {
    state.projects = [
      { id: "proj_a", name: "Project A", path: "/tmp/a" },
      { id: "proj_b", name: "Project B", path: "/tmp/b" }
    ]
    state.activeProjectId = "proj_a"
    state.selectedMemoryProjectId = null
    state.memory = null
    state.memoryDraft = null
    state.memoryLoading = false
    state.memoryError = null
    state.nav = "projects"
    state.skillsTab = "skills"

    dispatchDelegated(fakeDelegatedEvent({ "data-project-memory": "proj_b" }), getDelegatedClick())
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(state.nav, "skills")
    assert.equal(state.skillsTab, "memory")
    assert.equal(state.selectedMemoryProjectId, "proj_b")
    assert.equal(state.activeProjectId, "proj_a")
    assert.deepEqual(calls, ["proj_b"])
    assert.equal(state.memory?.projectId, "proj_b")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("reopening memory from another screen resets the selector to the active project", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const { dispatchDelegated, getDelegatedClick, state } = __test
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    selectedMemoryProjectId: state.selectedMemoryProjectId,
    memory: state.memory,
    memoryDraft: state.memoryDraft,
    memoryLoading: state.memoryLoading,
    memoryError: state.memoryError,
    nav: state.nav,
    skillsTab: state.skillsTab
  }
  const calls = []
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.window.openworking = {
    memory: {
      async get(projectId) {
        calls.push(projectId)
        return {
          global: "global memory",
          project: `memory:${projectId}`,
          projectId,
          hasProject: true,
          activeProjectId: "proj_a"
        }
      }
    }
  }

  try {
    state.projects = [
      { id: "proj_a", name: "Project A", path: "/tmp/a" },
      { id: "proj_b", name: "Project B", path: "/tmp/b" }
    ]
    state.activeProjectId = "proj_a"
    state.selectedMemoryProjectId = "proj_b"
    state.memory = {
      global: "global memory",
      project: "memory:proj_b",
      projectId: "proj_b",
      hasProject: true,
      activeProjectId: "proj_a"
    }
    state.memoryDraft = { global: "global memory", project: "memory:proj_b" }
    state.memoryLoading = false
    state.memoryError = null
    state.nav = "skills"
    state.skillsTab = "memory"

    dispatchDelegated(fakeDelegatedEvent({ "data-nav": "session" }), getDelegatedClick())
    assert.equal(state.selectedMemoryProjectId, "proj_a")

    dispatchDelegated(fakeDelegatedEvent({ "data-nav": "skills" }), getDelegatedClick())
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(state.nav, "skills")
    assert.equal(state.skillsTab, "memory")
    assert.equal(state.selectedMemoryProjectId, "proj_a")
    assert.deepEqual(calls, ["proj_a"])
    assert.equal(state.memory?.projectId, "proj_a")
    assert.equal(state.memoryDraft?.project, "memory:proj_a")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("project pin toggle repaints the Projects screen immediately", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const { dispatchDelegated, getDelegatedClick, render, state } = __test
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    nav: state.nav,
    projectsQuery: state.projectsQuery
  }
  const root = document.getElementById("root")
  const listCalls = []
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.window.openworking = {
    projects: {
      async setPinned(projectId, pinned) {
        listCalls.push(["setPinned", projectId, pinned])
      },
      async list() {
        listCalls.push(["list"])
        return [
          { id: "proj_a", name: "Project A", path: "/tmp/a", pinned: true },
          { id: "proj_b", name: "Project B", path: "/tmp/b", pinned: false }
        ]
      }
    }
  }

  try {
    state.projects = [
      { id: "proj_a", name: "Project A", path: "/tmp/a", pinned: false },
      { id: "proj_b", name: "Project B", path: "/tmp/b", pinned: false }
    ]
    state.activeProjectId = "proj_a"
    state.nav = "projects"
    state.projectsQuery = "Project"

    render()
    const searchBefore = document.querySelector("[data-projects-search]")
    searchBefore.focus()
    searchBefore.setSelectionRange(searchBefore.value.length, searchBefore.value.length)
    const beforeRoot = root.innerHTML
    assert.match(beforeRoot, /data-project-pin="proj_a"/)

    dispatchDelegated(fakeDelegatedEvent({ "data-project-pin": "proj_a", "data-pinned": "0" }), getDelegatedClick())
    await new Promise((resolve) => setImmediate(resolve))

    assert.deepEqual(listCalls, [["setPinned", "proj_a", true], ["list"]])
    assert.equal(state.projects[0].pinned, true)
    assert.equal(document.querySelector("[data-projects-search]"), searchBefore, "pin updates must not remount the search input")
    assert.equal(document.activeElement, searchBefore)
    assert.notEqual(root.innerHTML, beforeRoot)
    // The .pcard grid marks a pinned project by flipping its pin action to "Unpin".
    assert.match(root.innerHTML, /data-project-pin="proj_a" data-pinned="1"[^>]*title="Unpin"/)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("IDE split-button dropdown toggles and dispatches open-ide with the right override", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  const { dispatchDelegated, getDelegatedClick, render, state } = __test
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    runtime: state.runtime,
    threads: state.threads,
    nav: state.nav,
    ideMenu: state.ideMenu,
    config: state.config
  }
  const openCalls = []
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.window.openworking = {
    ide: {
      async open(projectId, ideOverride) {
        openCalls.push([projectId, ideOverride])
      }
    }
  }

  try {
    state.projects = [{ id: "proj_a", name: "Project A", path: "/tmp/a", pinned: false }]
    state.activeProjectId = "proj_a"
    state.activeSessionId = "sess_a"
    state.sessionsByProject = { proj_a: [{ id: "sess_a", directory: "/tmp/a" }] }
    state.runtime = { status: "running", project: { id: "proj_a" }, sessionStatuses: {} }
    state.threads = new Map()
    // The IDE button lives in the session-screen header now (renderHeader), not on the
    // project card — nav must be "session" (the default) to exercise it.
    state.nav = "session"
    state.ideMenu = null
    // No default IDE configured — openIde() must resolve this to "system" itself now that it
    // no longer relies on the main process to fall back to the personalization store.
    state.config = { personalization: { defaultIde: "system" } }

    render()
    const root = document.getElementById("root")
    assert.match(root.innerHTML, /data-open-ide="proj_a"/)
    assert.doesNotMatch(root.innerHTML, /ide-pop/)
    // Moved to sit immediately left of "Open current folder" in the header's .head-actions.
    const ideButtonIndex = root.innerHTML.indexOf('class="ide-split-btn"')
    const openFolderIndex = root.innerHTML.indexOf("Open current folder")
    assert.ok(ideButtonIndex >= 0 && ideButtonIndex < openFolderIndex, "IDE button should render to the left of Open current folder")

    dispatchDelegated(fakeDelegatedEvent({ "data-ide-menu": "proj_a" }), getDelegatedClick())
    assert.equal(state.ideMenu, "proj_a")
    assert.match(root.innerHTML, /class="pop ide-pop"/)
    assert.match(root.innerHTML, /data-ide-override="cursor"/)
    assert.match(root.innerHTML, /data-ide-override="vscode"/)
    assert.match(root.innerHTML, /data-ide-override="antigravity"/)
    // Cursor's pale mark gets a solid black rounded backing; VS Code/Antigravity (full-color
    // logos) render with no added background.
    assert.match(root.innerHTML, /<img class="ide-icon ide-icon-cursor" src="\.\/assets\/ide-cursor\.png"/)
    assert.match(root.innerHTML, /<img class="ide-icon" src="\.\/assets\/ide-vscode\.png"/)
    assert.match(root.innerHTML, /<img class="ide-icon" src="\.\/assets\/ide-antigravity\.png"/)
    // "system" is the unconfigured default, not a real app to switch to — it must not appear
    // as a dropdown override option.
    assert.doesNotMatch(root.innerHTML, /data-ide-override="system"/)

    dispatchDelegated(fakeDelegatedEvent({ "data-ide-menu": "proj_a" }), getDelegatedClick())
    assert.equal(state.ideMenu, null)
    assert.doesNotMatch(root.innerHTML, /ide-pop/)

    dispatchDelegated(fakeDelegatedEvent({ "data-open-ide": "proj_a" }), getDelegatedClick())
    await new Promise((resolve) => setImmediate(resolve))
    // openIde() resolves the missing override to the configured default ("system") itself now.
    assert.deepEqual(openCalls, [["proj_a", "system"]])

    dispatchDelegated(fakeDelegatedEvent({ "data-open-ide": "proj_a", "data-ide-override": "cursor" }), getDelegatedClick())
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(openCalls, [["proj_a", "system"], ["proj_a", "cursor"]])

    // The Projects grid must no longer render the split-button — it moved, not duplicated.
    state.nav = "projects"
    state.ideMenu = null
    render()
    assert.doesNotMatch(root.innerHTML, /ide-split-btn/)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("session menu state is scoped by project and session row", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousSessionMenu = __test.state.sessionMenu
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
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("session menu renders Export JSON between Rename and Delete", () => {
  const state = __test.state
  const previous = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    sessionLoadsByProject: state.sessionLoadsByProject,
    pinnedSessions: state.pinnedSessions,
    expanded: state.expanded,
    sessionMenu: state.sessionMenu
  }
  try {
    state.projects = [{ id: "proj_a", name: "Project A", path: "/repo", pinned: false }]
    state.activeProjectId = "proj_a"
    state.activeSessionId = "ses_1"
    state.sessionsByProject = { proj_a: [{ id: "ses_1", title: "Exportable", directory: "/repo" }] }
    state.sessionLoadsByProject = { proj_a: { status: "ready", generation: 1, error: "", autoRetried: false } }
    state.pinnedSessions = new Map()
    state.expanded = new Set(["proj_a"])
    state.sessionMenu = sessionRowKey("proj_a", "ses_1")

    __test.render()
    const menu = document.querySelector("[data-session-export='ses_1']")?.closest(".session-pop")
    assert.ok(menu)
    const actions = [...menu.querySelectorAll("button")].map((button) => {
      if (button.hasAttribute("data-session-rename")) return "rename"
      if (button.hasAttribute("data-session-export")) return "export"
      if (button.hasAttribute("data-session-delete")) return "delete"
      return "other"
    })
    assert.deepEqual(actions, ["other", "rename", "export", "delete"])
    assert.equal(menu.querySelector("[data-session-export]")?.textContent.trim(), "Export JSON")
  } finally {
    Object.assign(state, previous)
  }
})

test("session export action uses the clicked session directory and handles success, cancel, and errors", async () => {
  const previousOpenworking = global.window.openworking
  const state = __test.state
  const previous = {
    projects: state.projects,
    sessionsByProject: state.sessionsByProject,
    sessionLoadsByProject: state.sessionLoadsByProject,
    pinnedSessions: state.pinnedSessions,
    expanded: state.expanded,
    sessionMenu: state.sessionMenu,
    toast: state.toast
  }
  const calls = []
  let outcome = { canceled: false }
  global.window.openworking = {
    runtime: {
      async exportSession(payload) {
        calls.push(payload)
        if (outcome instanceof Error) throw outcome
        return outcome
      }
    }
  }

  try {
    state.projects = [{ id: "proj_a", path: "/repo", activeWorktreePath: "/worktree" }]
    state.sessionsByProject = { proj_a: [{ id: "ses_1", directory: "/session-dir" }, { id: "fallback" }] }
    state.sessionLoadsByProject = { proj_a: { status: "ready", generation: 1, error: "", autoRetried: false } }
    state.pinnedSessions = new Map()
    state.expanded = new Set(["proj_a"])
    state.sessionMenu = sessionRowKey("proj_a", "ses_1")
    state.toast = null
    __test.render()
    assert.ok(document.querySelector("[data-session-export='ses_1']"))

    __test.dispatchDelegated(fakeDelegatedEvent({
      "data-session-export": "ses_1",
      "data-session-project": "proj_a"
    }), __test.getDelegatedClick())
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(state.sessionMenu, null)
    assert.equal(document.querySelector("[data-session-export='ses_1']"), null)
    assert.deepEqual(calls[0], { projectId: "proj_a", sessionId: "ses_1", directory: "/session-dir" })
    assert.equal(state.toast, "Session exported.")

    outcome = { canceled: true }
    state.toast = null
    await __test.exportSession({ projectId: "proj_a", sessionId: "fallback" })
    assert.deepEqual(calls[1], { projectId: "proj_a", sessionId: "fallback", directory: "/worktree" })

    __test.dispatchDelegated(fakeDelegatedEvent({
      "data-session-export": "ses_1",
      "data-session-project": "proj_a"
    }), __test.getDelegatedClick())
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(state.toast, null)

    // The real reason reaches the toast: a bare "Could not export session." hid an HTTP 400 from
    // the runtime and forced diagnosis through the terminal log.
    outcome = new Error("Error invoking remote method 'runtime:exportSession': Error: HTTP 400: limit")
    state.toast = null
    __test.dispatchDelegated(fakeDelegatedEvent({
      "data-session-export": "ses_1",
      "data-session-project": "proj_a"
    }), __test.getDelegatedClick())
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(calls[3], { projectId: "proj_a", sessionId: "ses_1", directory: "/session-dir" })
    assert.equal(state.toast, "HTTP 400: limit")

    // Errors with nothing useful to say still fall back to the generic message.
    outcome = new Error("")
    state.toast = null
    __test.dispatchDelegated(fakeDelegatedEvent({
      "data-session-export": "ses_1",
      "data-session-project": "proj_a"
    }), __test.getDelegatedClick())
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(state.toast, "Could not export session.")
  } finally {
    state.projects = previous.projects
    state.sessionsByProject = previous.sessionsByProject
    state.sessionLoadsByProject = previous.sessionLoadsByProject
    state.pinnedSessions = previous.pinnedSessions
    state.expanded = previous.expanded
    state.sessionMenu = previous.sessionMenu
    state.toast = previous.toast
    global.window.openworking = previousOpenworking
  }
})

test("delete session target carries project id and refreshes the clicked project", async () => {
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
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("confirm delete session keeps the modal open with loading and inline errors", async () => {
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
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("render keeps background permission cards but hides background question cards", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const state = __test.state
  const previousState = {
    nav: state.nav,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    runtime: state.runtime,
    threads: state.threads,
    loading: state.loading,
    commands: state.commands,
    commandMenu: state.commandMenu
  }
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  try {
    Object.assign(state, {
      nav: "session",
      projects: [{ id: "proj_a", name: "Project A", path: "/tmp/proj-a" }],
      activeProjectId: "proj_a",
      activeSessionId: "active_session",
      sessionsByProject: { proj_a: [{ id: "active_session", directory: "/tmp/proj-a" }] },
      runtime: { status: "running", project: { id: "proj_a" }, sessionStatuses: {} },
      threads: new Map([
        ["active_session", { sessionId: "active_session", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }],
        ["bg_session", {
          sessionId: "bg_session",
          messages: [],
          pendingQuestions: [{ requestID: "q1", questions: [{ question: "Continue?", options: [{ label: "Yes", value: "yes" }] }] }],
          pendingPermissions: [{ requestID: "p1", title: "Run bash", permission: "bash" }],
          status: { type: "idle" }
        }]
      ]),
      loading: false,
      commands: [],
      commandMenu: { open: false, query: "", index: 0 }
    })

    __test.render()

    const html = document.getElementById("root").innerHTML
    assert.doesNotMatch(html, /Continue\?/)
    assert.match(html, /data-permission-session="bg_session"/)
    assert.match(html, /Session: bg_session/)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

const EXPIRED_PERMISSION_TEXT = "Yêu cầu quyền này đã hết hạn. Phiên có thể đã dừng hoặc dịch vụ đã khởi động lại — hãy gửi lại yêu cầu."

// Sets up a thread carrying one pending permission and one pending question, with a stubbed
// runtime whose list endpoints report what the server still knows about.
function withPendingRequestState(runtimeStub, run) {
  const state = __test.state
  const previousState = {
    runtime: state.runtime,
    threads: state.threads,
    activeSessionId: state.activeSessionId,
    toast: state.toast,
    formDrafts: state.formDrafts
  }
  const previousOpenworking = global.window.openworking
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  Object.assign(state, {
    activeSessionId: "sess_a",
    runtime: { status: "running", project: { id: "proj_a" }, sessionStatuses: {} },
    threads: new Map([
      ["sess_a", {
        sessionId: "sess_a",
        messages: [],
        pendingPermissions: [{ requestID: "per_gone" }, { requestID: "per_live" }],
        pendingQuestions: [{ requestID: "q_gone" }],
        pendingForms: [],
        status: { type: "idle" }
      }]
    ])
  })
  global.window.openworking = { runtime: runtimeStub }
  return Promise.resolve(run(state)).finally(() => {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
    global.requestAnimationFrame = previousRequestAnimationFrame
  })
}

test("reconcilePendingRequests drops cards the runtime no longer knows about", async () => {
  await withPendingRequestState({
    listPendingPermissions: async () => [{ requestID: "per_live", sessionID: "sess_a" }],
    listPendingQuestions: async () => [],
    listPendingForms: async () => [{
      id: "frm_missed",
      requestID: "frm_missed",
      sessionID: "sess_a",
      title: "Web Search",
      fields: [{ key: "choice", type: "string", options: [] }]
    }]
  }, async (state) => {
    await __test.reconcilePendingRequests()
    const thread = state.threads.get("sess_a")
    assert.deepEqual(thread.pendingPermissions.map((item) => item.requestID), ["per_live"])
    assert.deepEqual(thread.pendingQuestions, [])
    assert.deepEqual(thread.pendingForms.map((item) => item.requestID), ["frm_missed"])
  })
})

// The runtime server is spawned against ONE project directory, so its pending list can only speak
// for that project's sessions. state.threads outlives project switches, so a sweep that ignored
// session scope would read "absent from project B's runtime" as "expired" and silently delete
// project A's live, still-answerable cards.
test("reconcilePendingRequests does not evict cards belonging to another project", async () => {
  await withPendingRequestState({
    // Project B's runtime knows about nothing — but that says nothing about project A's session.
    listPendingPermissions: async () => [],
    listPendingQuestions: async () => []
  }, async (state) => {
    state.threads.set("sess_other_project", {
      sessionId: "sess_other_project",
      messages: [],
      pendingPermissions: [{ requestID: "per_other" }],
      pendingQuestions: [{ requestID: "q_other" }],
      status: { type: "idle" }
    })

    await __test.reconcilePendingRequests()

    const other = state.threads.get("sess_other_project")
    assert.deepEqual(other.pendingPermissions.map((item) => item.requestID), ["per_other"],
      "another project's permission card must survive a sweep it was never in scope for")
    assert.deepEqual(other.pendingQuestions.map((item) => item.requestID), ["q_other"])
    // The active project's own cards are still swept normally.
    assert.deepEqual(state.threads.get("sess_a").pendingPermissions, [])
  })
})

// A failed lookup is not evidence that anything expired. Evicting on it would delete live cards
// the user still has to answer.
test("reconcilePendingRequests keeps cards when the lookup fails", async () => {
  await withPendingRequestState({
    listPendingPermissions: async () => null,
    listPendingQuestions: async () => { throw new Error("offline") }
  }, async (state) => {
    await __test.reconcilePendingRequests()
    const thread = state.threads.get("sess_a")
    assert.deepEqual(thread.pendingPermissions.map((item) => item.requestID), ["per_gone", "per_live"])
    assert.deepEqual(thread.pendingQuestions.map((item) => item.requestID), ["q_gone"])
  })
})

test("replyPermission clears the card and warns when the request already expired", async () => {
  await withPendingRequestState({
    replyPermission: async () => ({ ok: false, reason: "expired" })
  }, async (state) => {
    await __test.replyPermission("per_gone", "once", "sess_a")
    const thread = state.threads.get("sess_a")
    // The card must go even though the reply failed — leaving it is what let the user click it
    // repeatedly, reproducing the same 404 each time.
    assert.deepEqual(thread.pendingPermissions.map((item) => item.requestID), ["per_live"])
    // The user sees a plain-language notice, never the raw HTTP/JSON body.
    assert.equal(state.toast, EXPIRED_PERMISSION_TEXT)
    assert.doesNotMatch(state.toast, /HTTP 404|PermissionNotFoundError|invoking remote method/)
  })
})

// The runtime removes a permission from its pending map as soon as it accepts the reply, so a
// reconcile that lands mid-flight would see the card as expired and yank it out from under the
// handler that is about to resolve it.
test("reconcilePendingRequests leaves a card whose reply is still in flight", async () => {
  await withPendingRequestState({
    listPendingPermissions: async () => [],
    listPendingQuestions: async () => [],
    replyPermission: async () => {
      // Reconcile runs while this reply is outstanding, and the runtime has already dropped
      // per_live from its pending map — so the list reports it as gone.
      await __test.reconcilePendingRequests()
      const midFlight = __test.state.threads.get("sess_a").pendingPermissions.map((item) => item.requestID)
      // The in-flight card survives the reconcile; per_gone is correctly evicted.
      assert.deepEqual(midFlight, ["per_live"])
      return { ok: true }
    }
  }, async (state) => {
    await __test.replyPermission("per_live", "once", "sess_a")
    const thread = state.threads.get("sess_a")
    // Once the reply lands, its own handler clears the card — and no expiry warning is shown.
    assert.deepEqual(thread.pendingPermissions, [])
    assert.notEqual(state.toast, EXPIRED_PERMISSION_TEXT)
  })
})

test("replyPermission ignores a repeat click while the first reply is in flight", async () => {
  let calls = 0
  await withPendingRequestState({
    replyPermission: async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return { ok: true }
    }
  }, async () => {
    await Promise.all([
      __test.replyPermission("per_live", "once", "sess_a"),
      __test.replyPermission("per_live", "once", "sess_a")
    ])
    assert.equal(calls, 1)
  })
})

test("websearch provider form renders and submits a typed answer through the v2 form bridge", async () => {
  let submitted = null
  await withPendingRequestState({
    replyForm: async (payload) => {
      submitted = payload
      return { ok: true }
    }
  }, async (state) => {
    state.formDrafts = new Map()
    const thread = state.threads.get("sess_a")
    thread.pendingForms = [{
      id: "frm_websearch",
      requestID: "frm_websearch",
      sessionID: "sess_a",
      title: "Web Search",
      fields: [{
        key: "choice",
        type: "string",
        required: true,
        default: "allow",
        description: "Allow web search?",
        options: [
          { value: "allow", label: "Allow web search via Exa" },
          { value: "disable", label: "Disable web search" }
        ]
      }, {
        key: "provider",
        type: "string",
        default: "brave",
        description: "Choose a provider",
        when: [{ key: "choice", op: "eq", value: "choose" }]
      }]
    }]

    const html = __test.renderPendingForms()
    assert.match(html, /Web Search/)
    assert.match(html, /Allow web search via Exa/)
    assert.match(html, /data-form-submit="frm_websearch"/)
    assert.doesNotMatch(html, /Choose a provider/)

    await __test.submitForm("frm_websearch", "sess_a")
    assert.deepEqual(submitted, {
      sessionId: "sess_a",
      formID: "frm_websearch",
      answer: { choice: "allow" }
    })
    assert.deepEqual(thread.pendingForms, [])
  })
})

test("blocked profile renders recovery without invoking auth or config startup", async () => {
  const previousOpenworking = global.window.openworking
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const state = __test.state
  const previousProfile = state.profile
  let authCalls = 0
  let configCalls = 0
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.window.openworking = {
    profile: {
      async getStatus() {
        return {
          status: "blocked",
          profileDir: "/profile",
          configPath: "/profile/opencode.json",
          stage: "directory",
          message: "EACCES",
          backupPath: null
        }
      }
    },
    auth: { async refresh() { authCalls += 1 } },
    config: { async get() { configCalls += 1 } }
  }

  try {
    await __test.loadInitialState()
    const html = global.document.getElementById("root").innerHTML
    assert.equal(authCalls, 0)
    assert.equal(configCalls, 0)
    assert.match(html, /OpenWorking profile needs attention/)
    assert.match(html, /data-action="retryProfile"/)
    assert.match(html, /EACCES/)
  } finally {
    state.profile = previousProfile
    global.window.openworking = previousOpenworking
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("recovered profile banner preserves the backup path", () => {
  const previous = __test.state.profile
  try {
    __test.state.profile = {
      status: "recovered",
      message: "Config reset",
      backupPath: "/profile/opencode.json.corrupt.bak"
    }
    const html = __test.renderProfileRecoveryBanner()
    assert.match(html, /Config reset/)
    assert.match(html, /opencode\.json\.corrupt\.bak/)
    assert.match(html, /openProfileFolder/)
  } finally {
    __test.state.profile = previous
  }
})

test("an early blocked profile update renders the stateful recovery screen", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previous = __test.state.profile
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  try {
    __test.handleProfileUpdate({ status: "blocked", stage: "config", message: "disk full", configPath: "/profile/opencode.json" })
    assert.match(global.document.getElementById("root").innerHTML, /disk full/)
  } finally {
    __test.state.profile = previous
    global.requestAnimationFrame = previousRequestAnimationFrame
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
  before("data-session-export", "data-session-id")
  before("data-session-delete", "data-session-id")
  before("data-session-rename", "data-session-id")
  // Project kebab/menu items resolve before opening the project accordion.
  before("data-project-menu", "data-open-project")
  before("data-project-pin", "data-open-project")
  // IDE split-button dropdown/open resolve before opening the project card.
  before("data-ide-menu", "data-open-project")
  before("data-open-ide", "data-open-project")
  // data-action is the broad fallback and must be last.
  assert.equal(order[order.length - 1], "data-action")
})

test("missing artifact preview renders a neutral unable-to-load state", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const state = __test.state
  const previousState = {
    nav: state.nav,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    runtime: state.runtime,
    threads: state.threads,
    document: state.document,
    rightSidebarOpen: state.rightSidebarOpen,
    diagnosticsOpen: state.diagnosticsOpen,
    sidebarCollapsed: state.sidebarCollapsed,
    toast: state.toast
  }
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  try {
    Object.assign(state, {
      nav: "session",
      projects: [{ id: "proj_a", name: "Project A", path: "/tmp/proj-a" }],
      activeProjectId: "proj_a",
      activeSessionId: "sess_a",
      sessionsByProject: { proj_a: [{ id: "sess_a", directory: "/tmp/proj-a" }] },
      runtime: { status: "running", project: { id: "proj_a" }, sessionStatuses: {} },
      threads: new Map(),
      document: {
        requestedPath: "/tmp/proj-a/manual-translated-vietnamese.md",
        path: "/tmp/proj-a/manual-translated-vietnamese.md",
        name: "manual-translated-vietnamese.md",
        relativePath: "",
        content: "",
        loading: false,
        error: "",
        artifact: true,
        previewMode: "missing",
        renderMode: "missing",
        tab: "code"
      },
      rightSidebarOpen: false,
      diagnosticsOpen: false,
      sidebarCollapsed: false,
      toast: null
    })

    __test.render()

    const html = document.getElementById("root").innerHTML
    assert.match(html, /Unable to load file/)
    assert.doesNotMatch(html, /doc-state error/)
    assert.doesNotMatch(html, /Open externally/)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("renderSidebarInto repaints only the sidebar island and leaves the main region untouched", () => {
  const { render, renderSidebarInto } = __test
  // Mount the app once so every island host exists, then check that a sidebar-only repaint
  // ticks the sidebar island without touching the main region's DOM (element identity) and
  // preserves the sidebar scroll position (the Svelte tick never replaces the scroll container).
  render()
  const mainBefore = document.getElementById("mainRoot").firstElementChild
  const sideScroll = document.querySelector(".side-scroll")
  assert.ok(sideScroll, "sidebar must be mounted")
  assert.equal(document.querySelector(".side-brand")?.textContent.trim(), "OpenWorking")
  const primaryNav = [...document.querySelectorAll(".side-scroll > .nav-item")]
  assert.deepEqual(primaryNav.map((item) => item.querySelector("span:not(.kbd)")?.textContent), ["New chat", "Projects", "Skills"])
  assert.ok(primaryNav[0].classList.contains("new-session"), "New chat keeps the onboarding selector while sharing nav-item styling")
  sideScroll.scrollTop = 240
  __test.renderCounters.reset()
  renderSidebarInto()
  assert.ok(document.querySelector("aside.sidebar"), "sidebar markup should be present")
  assert.equal(document.getElementById("mainRoot").firstElementChild, mainBefore, "main region must not be rebuilt by a sidebar-only repaint")
  assert.equal(document.querySelector(".side-scroll"), sideScroll, "sidebar scroll container must survive the repaint")
  assert.equal(sideScroll.scrollTop, 240, "sidebar-only repaint must preserve sidebar scroll")
  assert.equal(__test.renderCounters.snapshot().sidebar, 1)
  assert.equal(__test.renderCounters.snapshot().full, 0)
})

test("command list arrival repaints the thread so persisted chips resolve into tokens", async () => {
  // Regression: activateProjectRuntime wipes state.commands, renders the chat history, then
  // loads the command list fire-and-forget. Without a thread repaint when that list arrives,
  // command/skill chips rendered from persisted metadata stay literal [label](path) text
  // after an app restart until some unrelated interaction re-renders.
  const previousOpenworking = global.window.openworking
  const state = __test.state
  const previousState = {
    projects: state.projects,
    sessionsByProject: state.sessionsByProject,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    runtime: state.runtime,
    threads: state.threads,
    nav: state.nav,
    commands: state.commands,
    commandMenu: state.commandMenu,
    pendingAttachments: state.pendingAttachments,
    pendingFileMentions: state.pendingFileMentions,
    loading: state.loading
  }
  let resolveCommands = null
  global.window.openworking = {
    runtime: {
      async openProject(project) {
        return { status: "running", project: { id: project.id }, sessionStatuses: {} }
      },
      async listSessions() { return [{ id: "sess_chip", directory: "/tmp/chip" }] },
      async listMessages() { return [] },
      listCommands() { return new Promise((resolve) => { resolveCommands = resolve }) }
    },
    attachments: { async discard() {} }
  }
  try {
    Object.assign(state, {
      projects: [{ id: "proj_chip", name: "Chip", path: "/tmp/chip" }],
      sessionsByProject: {},
      activeProjectId: "proj_chip",
      activeSessionId: null,
      runtime: null,
      threads: new Map(),
      nav: "session",
      commands: [{ name: "stale", source: "command", path: "/stale" }],
      commandMenu: { open: false, query: "", index: 0 },
      pendingAttachments: [],
      pendingFileMentions: [],
      loading: false
    })

    await __test.activateProjectRuntime(state.projects[0])
    assert.deepEqual(state.commands, [], "activation must render with the stale command list wiped")
    assert.equal(typeof resolveCommands, "function", "listCommands must have been requested")

    __test.renderCounters.reset()
    resolveCommands([{
      name: "review",
      source: "command",
      description: "Review changes",
      path: "/Users/me/Library/Application Support/OpenWorking/opencode-profile/commands/review"
    }])
    await Promise.resolve()
    await Promise.resolve()

    assert.equal(state.commands.length, 1, "resolved command list must be stored")
    assert.ok(
      __test.renderCounters.snapshot().thread >= 1,
      "thread must repaint once the command list arrives so chips resolve"
    )
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
  }
})

test("a reference.updated event refreshes the active project's references, ignoring a stale response for a project since navigated away from", async () => {
  const { handleRuntimeStream, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    references: state.references
  }
  let resolveList = null
  global.window.openworking = {
    references: {
      list() { return new Promise((resolve) => { resolveList = resolve }) }
    }
  }
  try {
    Object.assign(state, {
      projects: [
        { id: "proj_a", name: "A", path: "/tmp/a" },
        { id: "proj_b", name: "B", path: "/tmp/b" }
      ],
      activeProjectId: "proj_a",
      references: []
    })

    handleRuntimeStream({ type: "reference.updated" })
    assert.equal(typeof resolveList, "function", "references.list must have been requested for the active project")

    // User navigates to a different project before the in-flight list() call settles.
    state.activeProjectId = "proj_b"
    resolveList([{ name: "stale-for-a", path: "/tmp/a/notes.md", description: "", hidden: false }])
    await Promise.resolve()
    await Promise.resolve()

    assert.deepEqual(state.references, [], "a response for a project the user has since left must not overwrite state.references")
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
  }
})

test("the References tab renders a Missing badge for a reference whose local path no longer exists, but not for a git-backed reference", async () => {
  const { render, refreshReferences, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    auth: state.auth,
    nav: state.nav,
    skillsTab: state.skillsTab,
    references: state.references,
    referencesLoading: state.referencesLoading,
    referencesError: state.referencesError,
    referenceFormOpen: state.referenceFormOpen,
    referenceDraft: state.referenceDraft
  }
  global.window.openworking = {
    references: {
      async list() {
        return [
          { name: "docs", path: "/tmp/openworking-does-not-exist/docs", description: "Architecture notes", hidden: false, available: false },
          { name: "repo", repository: "https://example.com/org/repo.git", description: "", hidden: false }
        ]
      }
    }
  }
  try {
    state.projects = [{ id: "proj_a", name: "Project A", path: "/tmp/a" }]
    state.activeProjectId = "proj_a"
    state.auth = { status: "authenticated", user: { email: "test@example.com" } }
    state.nav = "skills"
    state.skillsTab = "references"
    state.references = []
    state.referenceFormOpen = false
    state.referenceDraft = null

    await refreshReferences()
    render()

    const panel = document.querySelector("[data-skills-panel-host]")
    assert.ok(panel, "the skills panel host must be mounted")
    const rows = panel.querySelectorAll(".row")
    assert.equal(rows.length, 2)

    const brokenTag = panel.querySelector(".tag.ref-broken")
    assert.ok(brokenTag, "a reference whose local path doesn't exist must render the .ref-broken badge")
    assert.match(brokenTag.textContent, /Missing/)
    assert.match(brokenTag.closest(".row").textContent, /docs/, "the Missing badge must sit inside the broken reference's own row")

    const repoRow = [...rows].find((row) => row.textContent.includes("repo"))
    assert.ok(repoRow, "the git-backed reference must still render")
    assert.equal(repoRow.querySelector(".tag.ref-broken"), null, "a git-backed reference has no local path to check and must not render as broken")
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
  }
})

test("addReference guards against a second call while one is already in flight, so a rapid double-click can't submit twice", async () => {
  const { addReference, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    referenceDraft: state.referenceDraft,
    referenceSaving: state.referenceSaving,
    referencesError: state.referencesError,
    referenceFormOpen: state.referenceFormOpen,
    references: state.references
  }
  let resolveAdd = null
  const addCalls = []
  global.window.openworking = {
    references: {
      add(payload) {
        addCalls.push(payload)
        return new Promise((resolve) => { resolveAdd = resolve })
      },
      async list() { return [] }
    }
  }
  try {
    state.projects = [{ id: "proj_a", name: "Project A", path: "/tmp/a" }]
    state.activeProjectId = "proj_a"
    state.referenceDraft = { kind: "path", name: "docs", path: "docs", repository: "", branch: "", description: "" }
    state.referenceSaving = false
    state.referencesError = null
    state.referenceFormOpen = true

    const first = addReference()
    const second = addReference() // fired before the first settles — must be a no-op, not a duplicate submit

    assert.equal(addCalls.length, 1, "a second addReference() call while one is in flight must not reach the IPC bridge again")

    resolveAdd({ name: "docs", path: "docs" })
    await first
    await second

    assert.equal(state.referenceFormOpen, false, "the form closes once the single in-flight add settles")
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
  }
})

test("confirmOpenTerminal walks idle -> creating -> connecting -> connected as pty.create/connect resolve and the pty.connected stream event arrives", async () => {
  const { confirmOpenTerminal, handleRuntimeStream, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    terminalConfirmOpen: state.terminalConfirmOpen,
    terminalProjectId: state.terminalProjectId,
    terminalPtyId: state.terminalPtyId,
    terminalStatus: state.terminalStatus,
    terminalError: state.terminalError
  }
  const calls = []
  global.window.openworking = {
    pty: {
      async create(options, context) { calls.push(["create", options, context]); return { id: "pty_1", status: "running" } },
      async connect(ptyId, context) { calls.push(["connect", ptyId, context]) }
    }
  }
  try {
    state.projects = [{ id: "proj_a", name: "Project A", path: "/tmp/a" }]
    state.activeProjectId = "proj_a"
    state.terminalConfirmOpen = true
    state.terminalProjectId = null
    state.terminalPtyId = null
    state.terminalStatus = "idle"
    state.terminalError = null

    const opening = confirmOpenTerminal()
    assert.equal(state.terminalConfirmOpen, false, "the confirm modal closes immediately")
    assert.equal(state.terminalStatus, "creating")
    await opening
    assert.equal(state.terminalStatus, "connecting")
    assert.equal(state.terminalPtyId, "pty_1")
    assert.equal(state.terminalProjectId, "proj_a")
    assert.deepEqual(calls.map((call) => call[0]), ["create", "connect"])

    handleRuntimeStream({ type: "pty.connected", ptyId: "pty_1" })
    assert.equal(state.terminalStatus, "connected")
    assert.equal(state.terminalError, null)
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
  }
})

test("confirmOpenTerminal surfaces a create failure without leaving a stale ptyId behind", async () => {
  const { confirmOpenTerminal, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    terminalPtyId: state.terminalPtyId,
    terminalStatus: state.terminalStatus,
    terminalError: state.terminalError
  }
  global.window.openworking = {
    pty: { create: async () => { throw new Error("no shell available") } }
  }
  try {
    state.projects = [{ id: "proj_a", name: "Project A", path: "/tmp/a" }]
    state.activeProjectId = "proj_a"
    state.terminalPtyId = null
    state.terminalStatus = "idle"
    state.terminalError = null

    await confirmOpenTerminal()

    assert.equal(state.terminalStatus, "idle")
    assert.equal(state.terminalPtyId, null)
    assert.match(state.terminalError, /no shell available/)
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
  }
})

test("a pty.disconnected stream event maps exited:true to 'exited' and exited:false to 'lost', scoped to the active ptyId", () => {
  const { handleRuntimeStream, state } = __test
  const previousState = { terminalPtyId: state.terminalPtyId, terminalStatus: state.terminalStatus }
  try {
    state.terminalPtyId = "pty_active"
    state.terminalStatus = "connected"

    // A disconnect event for a DIFFERENT (e.g. previously-closed) pty must not touch current state.
    handleRuntimeStream({ type: "pty.disconnected", ptyId: "pty_other", exited: true })
    assert.equal(state.terminalStatus, "connected")

    handleRuntimeStream({ type: "pty.disconnected", ptyId: "pty_active", exited: false })
    assert.equal(state.terminalStatus, "lost")

    state.terminalStatus = "connected"
    handleRuntimeStream({ type: "pty.disconnected", ptyId: "pty_active", exited: true })
    assert.equal(state.terminalStatus, "exited")
  } finally {
    Object.assign(state, previousState)
  }
})

test("reconnectTerminal writes a visible marker via terminalBridge before re-calling pty.connect, without clearing terminalPtyId", async () => {
  const { reconnectTerminal, terminalBridge, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    terminalPtyId: state.terminalPtyId,
    terminalProjectId: state.terminalProjectId,
    terminalStatus: state.terminalStatus,
    terminalError: state.terminalError
  }
  const written = []
  const previousWrite = terminalBridge.write
  terminalBridge.write = (text) => written.push(text)
  const connectCalls = []
  global.window.openworking = {
    pty: { async connect(ptyId, context) { connectCalls.push([ptyId, context]) } }
  }
  try {
    state.projects = [{ id: "proj_a", name: "Project A", path: "/tmp/a" }]
    state.activeProjectId = "proj_a"
    state.terminalPtyId = "pty_1"
    state.terminalProjectId = "proj_a"
    state.terminalStatus = "lost"
    state.terminalError = null

    await reconnectTerminal()

    assert.equal(written.length, 1, "a reconnect marker must be written into the live xterm buffer")
    assert.match(written[0], /reconnect/i)
    // The marker is appended to the existing buffer, not a reset — terminalBridge.write is the
    // ONLY way scrollback ever gets cleared in this app, and reconnect never calls term.clear().
    assert.deepEqual(connectCalls, [["pty_1", { projectId: "proj_a", directory: "/tmp/a" }]])
    assert.equal(state.terminalPtyId, "pty_1", "reconnect targets the SAME pty, not a new one")
    assert.equal(state.terminalStatus, "connecting")
  } finally {
    terminalBridge.write = previousWrite
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
  }
})

test("closeTerminal disconnects and removes the pty, resetting state to idle even before the IPC calls settle", async () => {
  const { closeTerminal, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    terminalPtyId: state.terminalPtyId,
    terminalProjectId: state.terminalProjectId,
    terminalStatus: state.terminalStatus
  }
  const calls = []
  global.window.openworking = {
    pty: {
      async disconnect(ptyId) { calls.push(["disconnect", ptyId]) },
      async remove(ptyId, context) { calls.push(["remove", ptyId, context]) }
    }
  }
  try {
    state.projects = [{ id: "proj_a", name: "Project A", path: "/tmp/a" }]
    state.activeProjectId = "proj_a"
    state.terminalPtyId = "pty_1"
    state.terminalProjectId = "proj_a"
    state.terminalStatus = "connected"

    const closing = closeTerminal()
    // State resets synchronously so the UI drops back to the empty state immediately.
    assert.equal(state.terminalPtyId, null)
    assert.equal(state.terminalStatus, "idle")
    await closing

    assert.deepEqual(calls, [
      ["disconnect", "pty_1"],
      ["remove", "pty_1", { projectId: "proj_a", directory: "/tmp/a" }]
    ])
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
  }
})

test("confirmOpenTerminal guards against a rapid double-click spawning two shells", async () => {
  const { confirmOpenTerminal, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    terminalConfirmOpen: state.terminalConfirmOpen,
    terminalPtyId: state.terminalPtyId,
    terminalProjectId: state.terminalProjectId,
    terminalStatus: state.terminalStatus,
    terminalError: state.terminalError
  }
  let resolveCreate = null
  const createCalls = []
  global.window.openworking = {
    pty: {
      create(options, context) {
        createCalls.push([options, context])
        return new Promise((resolve) => { resolveCreate = resolve })
      },
      async connect() {}
    }
  }
  try {
    state.projects = [{ id: "proj_a", name: "Project A", path: "/tmp/a" }]
    state.activeProjectId = "proj_a"
    state.terminalConfirmOpen = true
    state.terminalPtyId = null
    state.terminalProjectId = null
    state.terminalStatus = "idle"
    state.terminalError = null

    const first = confirmOpenTerminal()
    const second = confirmOpenTerminal() // fired before the first's create() call settles

    assert.equal(createCalls.length, 1, "a second confirmOpenTerminal() call while one is in flight must not spawn a second shell")

    resolveCreate({ id: "pty_1", status: "running" })
    await first
    await second

    assert.equal(state.terminalPtyId, "pty_1")
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
  }
})

test("switching projects detaches the shell instead of orphaning it, and switching back reattaches the SAME pty", async () => {
  const { syncTerminalForActiveProject, state, terminalBridge } = __test
  const previousOpenworking = global.window.openworking
  const previousBridgeWrite = terminalBridge.write
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    terminalPanelOpen: state.terminalPanelOpen,
    terminalProjectId: state.terminalProjectId,
    terminalPtyId: state.terminalPtyId,
    terminalStatus: state.terminalStatus,
    nav: state.nav
  }
  const calls = []
  global.window.openworking = {
    pty: {
      async connect(ptyId) { calls.push(["connect", ptyId]) },
      async disconnect(ptyId) { calls.push(["disconnect", ptyId]) },
      async remove(ptyId) { calls.push(["remove", ptyId]) },
      async list() { calls.push(["list"]); return [] }
    }
  }
  try {
    // Off the session screen on purpose: this covers the attach/detach state machine, and staying
    // off it keeps render() from mounting a real xterm (jsdom has no matchMedia). That the dock
    // renders and mounts is covered by the header-toggle DOM test instead.
    state.nav = "projects"
    state.projects = [{ id: "proj_a", name: "A", path: "/tmp/a" }, { id: "proj_b", name: "B", path: "/tmp/b" }]
    state.terminalPanelOpen = true
    state.activeProjectId = "proj_a"
    state.terminalPtyByProject = new Map([["proj_a", "pty_a"]])
    state.terminalPtyId = "pty_a"
    state.terminalProjectId = "proj_a"
    state.terminalStatus = "connected"

    // Leave A for B: A's socket drops but its shell must NOT be removed.
    state.activeProjectId = "proj_b"
    await syncTerminalForActiveProject()
    assert.equal(state.terminalPtyId, null, "nothing is attached while B has no terminal")
    assert.equal(state.terminalStatus, "idle")
    assert.deepEqual(calls, [["disconnect", "pty_a"], ["list"]])
    assert.ok(
      !calls.some(([kind]) => kind === "remove"),
      "a project switch must never remove the pty — that would kill the shell it is meant to preserve"
    )
    assert.equal(state.terminalPtyByProject.get("proj_a"), "pty_a", "A's shell stays remembered while detached")

    // Come back to A: the same pty is reattached, not a new one.
    calls.length = 0
    const written = []
    terminalBridge.write = (text) => written.push(text)
    state.activeProjectId = "proj_a"
    await syncTerminalForActiveProject()
    assert.equal(state.terminalPtyId, "pty_a", "returning to A must reattach A's original shell")
    assert.equal(state.terminalProjectId, "proj_a")
    assert.deepEqual(calls, [["connect", "pty_a"]], "no pty.list lookup is needed for a remembered shell")
    assert.match(written.join(""), /scrollback not restored/, "the buffer gap must be stated, not left looking like a lost terminal")
  } finally {
    Object.assign(state, previousState)
    state.terminalPtyByProject = new Map()
    terminalBridge.write = previousBridgeWrite
    global.window.openworking = previousOpenworking
  }
})

test("remembering a 6th shell closes the least recently attached one for real, and never the live one", async () => {
  const { syncTerminalForActiveProject, state, terminalBridge } = __test
  const previousOpenworking = global.window.openworking
  const previousBridgeWrite = terminalBridge.write
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    terminalPanelOpen: state.terminalPanelOpen,
    terminalProjectId: state.terminalProjectId,
    terminalPtyId: state.terminalPtyId,
    terminalStatus: state.terminalStatus,
    nav: state.nav
  }
  const removed = []
  global.window.openworking = {
    pty: {
      async connect() {},
      async disconnect() {},
      async remove(ptyId, context) { removed.push([ptyId, context]) },
      async list() { return [] }
    }
  }
  try {
    state.nav = "projects"   // see the note in the reattach test above
    terminalBridge.write = () => {}
    state.projects = ["p1", "p2", "p3", "p4", "p5", "p6"].map((id) => ({ id, name: id, path: `/tmp/${id}` }))
    state.terminalPanelOpen = true
    // p1 is the oldest, p5 the newest; nothing attached yet.
    state.terminalPtyByProject = new Map([["p1", "pty1"], ["p2", "pty2"], ["p3", "pty3"], ["p4", "pty4"], ["p5", "pty5"]])
    state.terminalPtyId = null
    state.terminalProjectId = null

    // Attaching p2 makes it the most recent, so p1 is now the eviction candidate.
    state.activeProjectId = "p2"
    await syncTerminalForActiveProject()
    assert.deepEqual(removed, [], "staying at the cap must not close anything")

    // p6 is the 6th shell — p1 goes.
    state.activeProjectId = "p6"
    state.terminalPtyByProject.set("p6", "pty6")   // pretend a fresh create landed
    await syncTerminalForActiveProject()

    assert.deepEqual(removed, [["pty1", { projectId: "p1" }]], "the least recently attached shell must be closed on the runtime, not merely dropped from the map")
    assert.equal(state.terminalPtyByProject.has("p1"), false)
    assert.equal(state.terminalPtyByProject.size, 5)
    assert.deepEqual(
      [...state.terminalPtyByProject.keys()],
      ["p3", "p4", "p5", "p2", "p6"],
      "order is least-recently-attached first: p2 moved to the back when it was attached, so p3 is now next to go"
    )
    assert.equal(state.terminalPtyId, "pty6", "the newly attached terminal survives the eviction it triggered")
  } finally {
    Object.assign(state, previousState)
    state.terminalPtyByProject = new Map()
    terminalBridge.write = previousBridgeWrite
    global.window.openworking = previousOpenworking
  }
})

test("a shell that died while detached is forgotten on the failed reattach, so the panel offers a fresh terminal", async () => {
  const { syncTerminalForActiveProject, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    terminalPanelOpen: state.terminalPanelOpen,
    terminalProjectId: state.terminalProjectId,
    terminalPtyId: state.terminalPtyId,
    terminalStatus: state.terminalStatus,
    nav: state.nav
  }
  global.window.openworking = {
    pty: {
      async connect() { throw new Error("pty not found") },
      async disconnect() {},
      async list() { return [] }
    }
  }
  try {
    state.nav = "projects"   // see the note in the reattach test above
    state.projects = [{ id: "proj_a", name: "A", path: "/tmp/a" }]
    state.terminalPanelOpen = true
    state.activeProjectId = "proj_a"
    state.terminalPtyByProject = new Map([["proj_a", "pty_dead"]])
    state.terminalPtyId = null
    state.terminalProjectId = null
    state.terminalStatus = "idle"

    await syncTerminalForActiveProject()

    assert.equal(state.terminalPtyId, null)
    assert.equal(state.terminalStatus, "idle", "a dead shell must not leave the panel stuck on 'connecting'")
    assert.equal(state.terminalPtyByProject.has("proj_a"), false, "the dead pty must be forgotten, not retried forever")
  } finally {
    Object.assign(state, previousState)
    state.terminalPtyByProject = new Map()
    global.window.openworking = previousOpenworking
  }
})

test("with no remembered shell the runtime's own running pty is adopted, so a renderer reload does not strand it", async () => {
  const { syncTerminalForActiveProject, state, terminalBridge } = __test
  const previousOpenworking = global.window.openworking
  const previousBridgeWrite = terminalBridge.write
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    terminalPanelOpen: state.terminalPanelOpen,
    terminalProjectId: state.terminalProjectId,
    terminalPtyId: state.terminalPtyId,
    terminalStatus: state.terminalStatus,
    nav: state.nav
  }
  global.window.openworking = {
    pty: {
      async connect() {},
      async disconnect() {},
      async list() { return [{ id: "pty_exited", status: "exited" }, { id: "pty_live", status: "running" }] }
    }
  }
  try {
    state.nav = "projects"   // see the note in the reattach test above
    terminalBridge.write = () => {}
    state.projects = [{ id: "proj_a", name: "A", path: "/tmp/a" }]
    state.terminalPanelOpen = true
    state.activeProjectId = "proj_a"
    state.terminalPtyByProject = new Map()
    state.terminalPtyId = null
    state.terminalProjectId = null

    await syncTerminalForActiveProject()

    assert.equal(state.terminalPtyId, "pty_live", "an exited pty must be skipped in favour of a live one")
    assert.equal(state.terminalPtyByProject.get("proj_a"), "pty_live")
  } finally {
    Object.assign(state, previousState)
    state.terminalPtyByProject = new Map()
    terminalBridge.write = previousBridgeWrite
    global.window.openworking = previousOpenworking
  }
})

test("nothing is connected while the terminal dock is closed, even for a project with a remembered shell", async () => {
  const { syncTerminalForActiveProject, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    terminalPanelOpen: state.terminalPanelOpen,
    terminalProjectId: state.terminalProjectId,
    terminalPtyId: state.terminalPtyId
  }
  const calls = []
  global.window.openworking = {
    pty: {
      async connect(ptyId) { calls.push(["connect", ptyId]) },
      async disconnect(ptyId) { calls.push(["disconnect", ptyId]) },
      async list() { calls.push(["list"]); return [] }
    }
  }
  try {
    state.projects = [{ id: "proj_a", name: "A", path: "/tmp/a" }]
    state.terminalPanelOpen = false
    state.activeProjectId = "proj_a"
    state.terminalPtyByProject = new Map([["proj_a", "pty_a"]])
    state.terminalPtyId = null
    state.terminalProjectId = null

    await syncTerminalForActiveProject()

    assert.deepEqual(calls, [], "a dock the user cannot see must not hold a socket open")
    assert.equal(state.terminalPtyId, null)
  } finally {
    Object.assign(state, previousState)
    state.terminalPtyByProject = new Map()
    global.window.openworking = previousOpenworking
  }
})

test("terminal dock resize is bounded by the chat's live budget, not just the absolute ceiling", () => {
  const { setTerminalDockHeight, maxTerminalDockHeight } = __test
  const root = document.documentElement
  const previousVar = root.style.getPropertyValue("--terminal-dock-h")
  // Operate on the real .main when a previous test left one rendered — document.querySelector
  // would pick that one over anything appended here, and then the stub would measure the wrong box.
  let main = document.querySelector(".main")
  const createdMain = !main
  if (createdMain) {
    main = document.createElement("main")
    main.className = "main"
    document.body.insertBefore(main, document.body.firstChild)
  }
  let head = main.querySelector(".main-head")
  const createdHead = !head
  if (createdHead) {
    head = document.createElement("div")
    head.className = "main-head"
    main.insertBefore(head, main.firstChild)
  }
  const originals = [[main, main.getBoundingClientRect], [head, head.getBoundingClientRect]]
  const stub = (el, height) => { el.getBoundingClientRect = () => ({ height, width: 0, top: 0, bottom: height, left: 0, right: 0 }) }
  try {
    // 800 tall, 44 header, 7 resizer gutter, 220 reserved for the chat -> 529 available, but the
    // absolute ceiling (340) is now the tighter of the two, so it wins over the live budget.
    stub(main, 800)
    stub(head, 44)
    assert.equal(maxTerminalDockHeight(), 340)
    assert.equal(setTerminalDockHeight(640), 340, "the absolute ceiling must win when it is tighter than the live chat budget")
    assert.equal(setTerminalDockHeight(300), 300, "a height under both bounds is left exactly as asked")
    assert.equal(setTerminalDockHeight(50), 190, "the dock still keeps its own minimum so it stays usable")

    // Short window: the live budget goes negative and undercuts even the floor, so the dock must
    // fall back to its floor rather than returning a nonsense (or negative) height.
    stub(main, 300)
    assert.equal(maxTerminalDockHeight(), 190)
    assert.equal(setTerminalDockHeight(640), 190)

    assert.equal(setTerminalDockHeight(Number.NaN), 190, "a non-finite request must never reach the CSS variable")
    assert.match(root.style.getPropertyValue("--terminal-dock-h"), /^\d+px$/)
  } finally {
    for (const [el, fn] of originals) el.getBoundingClientRect = fn
    if (createdHead) head.remove()
    if (createdMain) main.remove()
    if (previousVar) root.style.setProperty("--terminal-dock-h", previousVar)
    else root.style.removeProperty("--terminal-dock-h")
  }
})

// The registry is what makes a shell reattachable, so every path that really ENDS a shell has to
// take it back out. A leftover entry is invisible in the UI but permanently consumes one of the
// MAX_REMEMBERED_TERMINALS slots and makes the next visit to that project try to reattach a pty
// the runtime already destroyed.
test("closeTerminal forgets the shell it just removed, freeing its slot in the registry", async () => {
  const { closeTerminal, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    terminalPtyId: state.terminalPtyId,
    terminalProjectId: state.terminalProjectId,
    terminalStatus: state.terminalStatus
  }
  global.window.openworking = { pty: { async disconnect() {}, async remove() {} } }
  try {
    state.projects = [{ id: "proj_a", name: "A", path: "/tmp/a" }]
    state.activeProjectId = "proj_a"
    state.terminalPtyByProject = new Map([["proj_a", "pty_1"], ["proj_b", "pty_other"]])
    state.terminalPtyId = "pty_1"
    state.terminalProjectId = "proj_a"
    state.terminalStatus = "connected"

    await closeTerminal()

    assert.equal(state.terminalPtyByProject.has("proj_a"), false, "a closed shell must not stay in the reattach registry")
    assert.equal(state.terminalPtyByProject.get("proj_b"), "pty_other", "closing one project's terminal must not disturb another's")
  } finally {
    Object.assign(state, previousState)
    state.terminalPtyByProject = new Map()
    global.window.openworking = previousOpenworking
  }
})

test("removing a project forgets its shell and drops the socket if that shell was attached", async () => {
  const { removeProject, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    sessionsByProject: state.sessionsByProject,
    terminalPtyId: state.terminalPtyId,
    terminalProjectId: state.terminalProjectId,
    terminalStatus: state.terminalStatus,
    runtime: state.runtime
  }
  const calls = []
  global.window.openworking = {
    pty: {
      async disconnect(ptyId) { calls.push(["disconnect", ptyId]) },
      async remove(ptyId) { calls.push(["remove", ptyId]) }
    },
    projects: {
      async remove() { calls.push(["projects.remove"]) },
      async list() { return [] }
    },
    runtime: { async stop() { return null } }
  }
  try {
    state.runtime = null
    state.projects = [{ id: "proj_gone", name: "Gone", path: "/tmp/gone" }]
    state.activeProjectId = "proj_gone"
    state.sessionsByProject = { proj_gone: [] }
    state.terminalPtyByProject = new Map([["proj_gone", "pty_gone"], ["proj_keep", "pty_keep"]])
    state.terminalPtyId = "pty_gone"
    state.terminalProjectId = "proj_gone"
    state.terminalStatus = "connected"

    await removeProject("proj_gone")

    assert.equal(state.terminalPtyByProject.has("proj_gone"), false, "a removed project can never be revisited, so its shell must not stay remembered")
    assert.equal(state.terminalPtyByProject.get("proj_keep"), "pty_keep", "other projects' shells must survive")
    assert.equal(state.terminalPtyId, null, "the attached socket must be dropped along with the project")
    assert.ok(calls.some(([kind, id]) => kind === "disconnect" && id === "pty_gone"), "the live socket must actually be disconnected")
  } finally {
    Object.assign(state, previousState)
    state.terminalPtyByProject = new Map()
    global.window.openworking = previousOpenworking
  }
})

test("opening the dock re-clamps a stored height that no longer fits the current window", () => {
  const { toggleTerminalPanel, state } = __test
  const root = document.documentElement
  const previousVar = root.style.getPropertyValue("--terminal-dock-h")
  const previousStorage = global.localStorage
  global.localStorage = backedLocalStorage({ "openworking:terminal-dock-h": "640" })
  const previousState = { terminalPanelOpen: state.terminalPanelOpen, activeProjectId: state.activeProjectId }
  let main = document.querySelector(".main")
  const createdMain = !main
  if (createdMain) {
    main = document.createElement("main")
    main.className = "main"
    document.body.insertBefore(main, document.body.firstChild)
  }
  let head = main.querySelector(".main-head")
  const createdHead = !head
  if (createdHead) {
    head = document.createElement("div")
    head.className = "main-head"
    main.insertBefore(head, main.firstChild)
  }
  const originals = [[main, main.getBoundingClientRect], [head, head.getBoundingClientRect]]
  const stub = (el, height) => { el.getBoundingClientRect = () => ({ height, width: 0, top: 0, bottom: height, left: 0, right: 0 }) }
  try {
    // A window far too short for the 640 the user stored on some larger screen.
    stub(main, 400)
    stub(head, 44)
    state.terminalPanelOpen = false
    state.activeProjectId = null

    toggleTerminalPanel()

    assert.equal(state.terminalPanelOpen, true)
    assert.equal(
      root.style.getPropertyValue("--terminal-dock-h"),
      "190px",
      "a stored height from a bigger window must be re-clamped as the dock opens, not applied as-is"
    )
  } finally {
    Object.assign(state, previousState)
    for (const [el, fn] of originals) el.getBoundingClientRect = fn
    if (createdHead) head.remove()
    if (createdMain) main.remove()
    global.localStorage = previousStorage
    if (previousVar) root.style.setProperty("--terminal-dock-h", previousVar)
    else root.style.removeProperty("--terminal-dock-h")
  }
})

test("shrinking the window re-clamps the open dock so it cannot squeeze the chat out", () => {
  const { state } = __test
  const root = document.documentElement
  const previousVar = root.style.getPropertyValue("--terminal-dock-h")
  const previousStorage = global.localStorage
  global.localStorage = backedLocalStorage({ "openworking:terminal-dock-h": "640" })
  const previousState = { terminalPanelOpen: state.terminalPanelOpen, document: state.document }
  let main = document.querySelector(".main")
  const createdMain = !main
  if (createdMain) {
    main = document.createElement("main")
    main.className = "main"
    document.body.insertBefore(main, document.body.firstChild)
  }
  let head = main.querySelector(".main-head")
  const createdHead = !head
  if (createdHead) {
    head = document.createElement("div")
    head.className = "main-head"
    main.insertBefore(head, main.firstChild)
  }
  const originals = [[main, main.getBoundingClientRect], [head, head.getBoundingClientRect]]
  const stub = (el, height) => { el.getBoundingClientRect = () => ({ height, width: 0, top: 0, bottom: height, left: 0, right: 0 }) }
  try {
    stub(main, 400)
    stub(head, 44)
    state.terminalPanelOpen = true
    state.document = null
    root.style.setProperty("--terminal-dock-h", "640px")

    window.dispatchEvent(new window.Event("resize"))

    assert.equal(
      root.style.getPropertyValue("--terminal-dock-h"),
      "190px",
      "the dock does not shrink on its own, so the resize handler has to re-clamp it"
    )
  } finally {
    Object.assign(state, previousState)
    for (const [el, fn] of originals) el.getBoundingClientRect = fn
    if (createdHead) head.remove()
    if (createdMain) main.remove()
    global.localStorage = previousStorage
    if (previousVar) root.style.setProperty("--terminal-dock-h", previousVar)
    else root.style.removeProperty("--terminal-dock-h")
  }
})

test("the 5-shell cap is enforced on the create path too, not only on reattach", async () => {
  const { confirmOpenTerminal, state } = __test
  const previousOpenworking = global.window.openworking
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    terminalConfirmOpen: state.terminalConfirmOpen,
    terminalPtyId: state.terminalPtyId,
    terminalProjectId: state.terminalProjectId,
    terminalStatus: state.terminalStatus
  }
  const removed = []
  global.window.openworking = {
    pty: {
      async create() { return { id: "pty_new", status: "running" } },
      async connect() {},
      async disconnect() {},
      async remove(ptyId, context) { removed.push([ptyId, context]) }
    }
  }
  try {
    state.projects = [{ id: "p6", name: "P6", path: "/tmp/p6" }]
    state.activeProjectId = "p6"
    state.terminalPtyByProject = new Map([["p1", "pty1"], ["p2", "pty2"], ["p3", "pty3"], ["p4", "pty4"], ["p5", "pty5"]])
    state.terminalPtyId = null
    state.terminalProjectId = null
    state.terminalStatus = "idle"

    await confirmOpenTerminal()

    assert.equal(state.terminalPtyByProject.size, 5, "opening a 6th terminal must not grow the registry past the cap")
    assert.deepEqual(removed, [["pty1", { projectId: "p1" }]], "the oldest shell must be closed on the runtime when the create path trips the cap")
    assert.equal(state.terminalPtyByProject.get("p6"), "pty_new", "the terminal just created must be the one kept")
  } finally {
    Object.assign(state, previousState)
    state.terminalPtyByProject = new Map()
    global.window.openworking = previousOpenworking
  }
})

test("writeToTerminal is a silent no-op once terminalPtyId has been cleared (e.g. right after closeTerminal), never writing to a dead pty", () => {
  const { writeToTerminal, state } = __test
  const previousState = { terminalPtyId: state.terminalPtyId, terminalProjectId: state.terminalProjectId, activeProjectId: state.activeProjectId }
  const previousOpenworking = global.window.openworking
  const writeCalls = []
  global.window.openworking = { pty: { write: (...args) => writeCalls.push(args) } }
  try {
    state.activeProjectId = "proj_a"
    state.terminalPtyId = null
    state.terminalProjectId = null

    writeToTerminal("ls -la\n")

    assert.deepEqual(writeCalls, [], "writing after the pty was disconnected/closed must not reach the IPC bridge")
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
  }
})

test("update pill shows a progress ring only while downloading a known percent, not while idle/installing/relaunching", () => {
  const { render, renderSidebarInto, state } = __test
  const previous = { versionGate: state.versionGate, updating: state.updating, installStatus: state.installStatus, downloadProgress: state.downloadProgress }
  try {
    render()
    state.versionGate = { status: "soft", latestVersion: "2.0.0" }

    state.updating = false
    state.installStatus = null
    state.downloadProgress = null
    renderSidebarInto()
    assert.equal(document.querySelector(".update-pill-ring"), null, "idle Update pill has no ring")

    state.updating = true
    state.installStatus = "downloading"
    state.downloadProgress = 24
    renderSidebarInto()
    const ring = document.querySelector(".update-pill-ring")
    assert.ok(ring, "downloading with a known percent shows a ring")
    const arc = ring.querySelectorAll("circle")[1]
    const circumference = 2 * Math.PI * 9
    assert.ok(Math.abs(Number(arc.getAttribute("stroke-dashoffset")) - circumference * (1 - 24 / 100)) < 0.01)

    state.installStatus = "installing"
    state.downloadProgress = null
    renderSidebarInto()
    assert.equal(document.querySelector(".update-pill-ring"), null, "installing (no known percent) has no ring")
  } finally {
    Object.assign(state, previous)
    renderSidebarInto()
  }
})

test("renderThreadContent rewrites only the active thread island", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { render, renderThreadContent, renderCounters, state } = __test
  const previousState = {
    nav: state.nav,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    forkMarkers: state.forkMarkers,
    planProposal: state.planProposal
  }

  try {
    const project = { id: "proj_thread", name: "Thread", path: "/tmp/thread" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_thread",
      sessionsByProject: { [project.id]: [{ id: "sess_thread", directory: project.path }] },
      threads: new Map([["sess_thread", {
        sessionId: "sess_thread",
        messages: [{ id: "msg_1", role: "user", parts: [{ type: "file", filename: "updated-thread.txt", mime: "text/plain" }] }],
        pendingQuestions: [],
        pendingPermissions: [],
        status: { type: "idle" }
      }]]),
      forkMarkers: new Map(),
      planProposal: null
    })
    // Mount the session screen so the thread island host exists, then check a thread-only
    // repaint ticks the thread island without rebuilding the main region (element identity).
    render()
    const mainBefore = document.getElementById("mainRoot").firstElementChild
    renderCounters.reset()

    renderThreadContent()

    assert.equal(document.getElementById("mainRoot").firstElementChild, mainBefore, "main region must not be rebuilt by a thread-only repaint")
    assert.match(document.querySelector(".thread-inner").innerHTML, /updated-thread\.txt/)
    assert.equal(renderCounters.snapshot().thread, 1)
    assert.equal(renderCounters.snapshot().full, 0)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("PromptEditor.svelte mounts a real contenteditable into #promptEditorRoot, syncs typed text to state.promptDraft, and guards input during IME composition", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    promptComposing: state.promptComposing
  }

  try {
    const project = { id: "proj_editor", name: "Editor Project", path: "/tmp/editor" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_editor",
      sessionsByProject: { [project.id]: [{ id: "sess_editor", directory: project.path }] },
      threads: new Map([["sess_editor", { sessionId: "sess_editor", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      promptDraft: "",
      promptComposing: false
    })
    render()

    const host = document.getElementById("promptEditorRoot")
    assert.ok(host, "#promptEditorRoot must be mounted")
    const editor = host.querySelector("#promptInput.prompt-editor")
    assert.ok(editor, "PromptEditor.svelte must render the contenteditable into its host")
    assert.equal(editor.getAttribute("contenteditable"), "true")
    assert.equal(editor.dataset.placeholder, state.composerPlaceholder)

    // Send button lives in the surrounding {@html} composer-bar (not re-rendered on every
    // keystroke), so the editor must toggle its disabled class imperatively as the draft changes.
    const send = document.querySelector(".send")
    assert.ok(send, "send button must be present in the composer-bar")
    assert.ok(send.classList.contains("disabled"), "send starts disabled with an empty draft")

    // Normal typing: set text via the DOM (as a real keystroke would) and fire input.
    editor.textContent = "hello world"
    editor.dispatchEvent(new window.Event("input", { bubbles: true }))
    assert.equal(state.promptDraft, "hello world")
    assert.ok(!send.classList.contains("disabled"), "send becomes enabled once the draft has text")

    editor.textContent = ""
    editor.dispatchEvent(new window.Event("input", { bubbles: true }))
    assert.ok(send.classList.contains("disabled"), "send goes back to disabled when the draft is cleared")

    editor.textContent = "hello world"
    editor.dispatchEvent(new window.Event("input", { bubbles: true }))

    // IME guard: while composing, input must NOT push DOM text into state.promptDraft.
    state.promptDraft = "hello world"
    editor.dispatchEvent(new window.Event("compositionstart", { bubbles: true }))
    assert.equal(state.promptComposing, true)
    editor.textContent = "hello wor(composing)"
    editor.dispatchEvent(new window.Event("input", { bubbles: true }))
    assert.equal(state.promptDraft, "hello world", "input during composition must be ignored")

    editor.dispatchEvent(new window.Event("compositionend", { bubbles: true }))
    assert.equal(state.promptComposing, false)
    assert.equal(state.promptDraft, "hello wor(composing)", "compositionend must flush the composed text")

    // Paste re-syncs the editor and places the caret right after the inserted text — exercises
    // the moved-verbatim caret-offset walk (placeCaretAtTextOffset/promptEditorCaret) end to end.
    editor.textContent = "ab"
    editor.dispatchEvent(new window.Event("input", { bubbles: true }))
    const range = document.createRange()
    range.setStart(editor.firstChild, 1)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    const pasteEvent = new window.Event("paste", { bubbles: true, cancelable: true })
    pasteEvent.clipboardData = { getData: () => "XY" }
    editor.dispatchEvent(pasteEvent)
    assert.equal(state.promptDraft, "aXYb", "pasted text lands at the caret, not appended")
    const afterPaste = window.getSelection()
    assert.equal(editor.textContent, "aXYb")
    assert.equal(afterPaste.anchorNode, editor.firstChild, "caret must be re-anchored inside the re-synced editor")
    assert.equal(afterPaste.anchorOffset, 3, "caret must land right after the pasted text (offset 3 in \"aXYb\")")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("PromptEditor.svelte renders a canonical token as a contenteditable=false chip", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    pendingFileMentions: state.pendingFileMentions
  }

  try {
    const project = { id: "proj_token", name: "Token Project", path: "/tmp/token" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_token",
      sessionsByProject: { [project.id]: [{ id: "sess_token", directory: project.path }] },
      threads: new Map([["sess_token", { sessionId: "sess_token", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      promptDraft: "Read [README.md](app/models/api_v2/README.md) please",
      pendingFileMentions: []
    })
    render()

    const editor = document.getElementById("promptEditorRoot").querySelector("#promptInput.prompt-editor")
    const chip = editor.querySelector(".file-mention-token")
    assert.ok(chip, "canonical token must render as a chip (reuses the proven renderPromptTokensHtml/renderCanonicalToken)")
    assert.equal(chip.getAttribute("contenteditable"), "false")
    assert.equal(chip.dataset.tokenRaw, "[README.md](app/models/api_v2/README.md)")
    assert.match(chip.textContent, /README\.md/)
    // promptEditorText (the caret-offset serializer moved verbatim in Milestone 1) already
    // treats the chip as one atomic unit via its data-token-raw fallback, so the round-trip
    // back to state.promptDraft reproduces the original marker exactly.
    assert.equal(editor.textContent.includes("[README.md](app/models/api_v2/README.md)"), false, "chip renders as its label, not the raw marker text")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("PromptEditor.svelte: Backspace with the caret right after a token removes the whole token, not one character", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    pendingFileMentions: state.pendingFileMentions
  }

  try {
    const project = { id: "proj_bksp", name: "Backspace Project", path: "/tmp/bksp" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_bksp",
      sessionsByProject: { [project.id]: [{ id: "sess_bksp", directory: project.path }] },
      threads: new Map([["sess_bksp", { sessionId: "sess_bksp", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      promptDraft: "read [README.md](app/models/api_v2/README.md) now",
      pendingFileMentions: []
    })
    render()

    const editor = document.getElementById("promptEditorRoot").querySelector("#promptInput.prompt-editor")
    // Place the caret at the start of the trailing " now" text node — the DOM-equivalent of a
    // real cursor sitting immediately after the token chip.
    const trailingTextNode = [...editor.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.startsWith(" now"))
    assert.ok(trailingTextNode, "expected a trailing text node right after the token chip")
    const range = document.createRange()
    range.setStart(trailingTextNode, 0)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)

    const keydown = new window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
    editor.dispatchEvent(keydown)

    assert.equal(state.promptDraft, "read  now", "the whole token marker is removed, not a trailing character")
    assert.equal(keydown.defaultPrevented, true, "native single-character deletion must be suppressed")
    assert.equal(editor.querySelector(".file-mention-token"), null, "chip must be gone from the DOM after re-sync")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("PromptEditor.svelte: paste always strips rich formatting, even when clipboardData carries text/html", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    pendingFileMentions: state.pendingFileMentions
  }

  try {
    const project = { id: "proj_paste", name: "Paste Project", path: "/tmp/paste" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_paste",
      sessionsByProject: { [project.id]: [{ id: "sess_paste", directory: project.path }] },
      threads: new Map([["sess_paste", { sessionId: "sess_paste", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      promptDraft: "",
      pendingFileMentions: []
    })
    render()

    const editor = document.getElementById("promptEditorRoot").querySelector("#promptInput.prompt-editor")
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)

    const pasteEvent = new window.Event("paste", { bubbles: true, cancelable: true })
    pasteEvent.clipboardData = {
      getData: (type) => (type === "text/plain" ? "bold text" : "<b>bold text</b>")
    }
    editor.dispatchEvent(pasteEvent)

    assert.equal(pasteEvent.defaultPrevented, true, "native rich paste must be suppressed")
    assert.equal(state.promptDraft, "bold text")
    assert.equal(editor.querySelector("b"), null, "no HTML formatting element must land in the editor")
    assert.equal(editor.innerHTML.includes("<b>"), false, "the html clipboard payload must never reach innerHTML")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("PromptEditor.svelte: typing \"/\" opens the command menu, ArrowDown/Enter selects and inserts a canonical token", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousScrollIntoView = window.HTMLElement.prototype.scrollIntoView
  let scrollIntoViewCalls = 0
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { scrollIntoViewCalls += 1 }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    pendingFileMentions: state.pendingFileMentions,
    commands: state.commands,
    commandMenu: state.commandMenu
  }

  try {
    const project = { id: "proj_cmd", name: "Command Project", path: "/tmp/cmd" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_cmd",
      sessionsByProject: { [project.id]: [{ id: "sess_cmd", directory: project.path }] },
      threads: new Map([["sess_cmd", { sessionId: "sess_cmd", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      promptDraft: "",
      pendingFileMentions: [],
      commands: [
        { name: "review", source: "command", description: "Review the diff", path: "/opencode-profile/commands/review" },
        { name: "review-deep", source: "command", description: "Deep review", path: "/opencode-profile/commands/review-deep" }
      ],
      commandMenu: { open: false, query: "", index: 0 }
    })
    render()

    const editor = document.getElementById("promptEditorRoot").querySelector("#promptInput.prompt-editor")
    editor.textContent = "/rev"
    const rangeAfterTyping = document.createRange()
    rangeAfterTyping.setStart(editor.firstChild, 4)
    rangeAfterTyping.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(rangeAfterTyping)
    editor.dispatchEvent(new window.Event("input", { bubbles: true }))

    assert.equal(state.commandMenu.open, true, "typing /rev must open the command menu")
    assert.equal(state.commandMenu.query, "rev")
    assert.match(document.querySelector(".ta-wrap").innerHTML, /review-deep/, "menu DOM lists matching commands")

    const popupBeforeNav = document.querySelector(".ta-wrap .prompt-pop")
    assert.ok(popupBeforeNav, "the command menu popup must be in the DOM")

    // ArrowDown moves from "review" (index 0) to "review-deep" (index 1). Regression check for
    // the old paintPromptAssistMenu(), which removed and reinserted the whole popup element on
    // every arrow key (visible flicker): the popup node must be reused, not recreated, and the
    // newly-active row must be scrolled into view.
    editor.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))
    assert.equal(state.commandMenu.index, 1)
    assert.equal(document.querySelector(".ta-wrap .prompt-pop"), popupBeforeNav, "ArrowDown must reuse the existing popup DOM node instead of recreating it")
    assert.ok(scrollIntoViewCalls > 0, "the newly-active row must be scrolled into view")

    // Enter selects the highlighted candidate and inserts its canonical token.
    editor.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    assert.equal(state.commandMenu.open, false, "menu must close after selection")
    assert.equal(state.promptDraft, "[review-deep](/opencode-profile/commands/review-deep)")
    assert.ok(editor.querySelector(".file-mention-token.command-token"), "the selected command must render as a token chip in the live DOM")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    window.HTMLElement.prototype.scrollIntoView = previousScrollIntoView
  }
})

test("PromptEditor.svelte: typing \"@\" opens the file-mention menu, ArrowDown/Enter selects and inserts a file token", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousScrollIntoView = window.HTMLElement.prototype.scrollIntoView
  let scrollIntoViewCalls = 0
  window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() { scrollIntoViewCalls += 1 }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    pendingFileMentions: state.pendingFileMentions,
    fileMentionMenu: state.fileMentionMenu
  }

  try {
    const project = { id: "proj_atmention", name: "At Mention Project", path: "/tmp/atmention" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_atmention",
      sessionsByProject: { [project.id]: [{ id: "sess_atmention", directory: project.path }] },
      threads: new Map([["sess_atmention", { sessionId: "sess_atmention", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      promptDraft: "",
      pendingFileMentions: [],
      // Pre-populated so syncPromptAssist's file branch (and ensureProjectFileCandidates,
      // which returns early once files.length is non-empty) never needs the real
      // window.openworking.files.list IPC call.
      fileMentionMenu: { open: false, query: "", index: 0, files: ["README.md", "app/reading-list.md"], loading: false, error: "", projectId: project.id, loadPromise: null }
    })
    render()

    const editor = document.getElementById("promptEditorRoot").querySelector("#promptInput.prompt-editor")
    editor.textContent = "@rea"
    const range = document.createRange()
    range.setStart(editor.firstChild, 4)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    editor.dispatchEvent(new window.Event("input", { bubbles: true }))

    assert.equal(state.fileMentionMenu.open, true, "typing @rea must open the file-mention menu")
    assert.equal(state.fileMentionMenu.query, "rea")
    assert.match(document.querySelector(".ta-wrap").innerHTML, /reading-list\.md/, "menu DOM lists matching files")

    const popupBeforeNav = document.querySelector(".ta-wrap .prompt-pop")
    assert.ok(popupBeforeNav, "the file-mention menu popup must be in the DOM")

    // Candidates rank basename-starts-with first: "README.md" and "app/reading-list.md" both
    // qualify ("readme"/"reading-list" both start with "rea"); ArrowDown moves off index 0.
    // Same regression check as the command-menu test: the popup node must be reused across
    // ArrowDown presses (no remove+reinsert flicker), and the active row must scroll into view.
    editor.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }))
    assert.equal(state.fileMentionMenu.index, 1)
    assert.equal(document.querySelector(".ta-wrap .prompt-pop"), popupBeforeNav, "ArrowDown must reuse the existing popup DOM node instead of recreating it")
    assert.ok(scrollIntoViewCalls > 0, "the newly-active row must be scrolled into view")

    editor.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    await Promise.resolve()

    assert.equal(state.fileMentionMenu.open, false, "menu must close after selection")
    assert.equal(state.promptDraft, "[reading-list.md](app/reading-list.md) ")
    // selectFileMention must patch the live #promptInput node in place (syncPromptEditor), the
    // same way selectCommand already does — NOT call the app-wide render(). PromptEditor.svelte's
    // use:editorAction runs syncFromState() once at mount and never again: the component takes a
    // `tick` prop from its island but never reads it, so a bare render() after mutating
    // state.promptDraft from outside bumps the tick, changes nothing on screen, and the chip
    // silently never appears — this was the actual bug. Asserting node identity here is a proxy
    // for "the DOM was actually patched", since calling render() wouldn't remount the island
    // either (MainView's {@html} string doesn't encode promptDraft, so it wouldn't even detect a
    // change) — it would just leave the stale, chip-less markup in place.
    const sameEditor = document.getElementById("promptEditorRoot").querySelector("#promptInput.prompt-editor")
    assert.equal(sameEditor, editor, "selectFileMention must patch the existing prompt editor node, not swap it")
    assert.ok(document.activeElement === editor, "the editor must keep focus after selecting a file mention")
    assert.ok(editor.querySelector(".file-mention-token"), "the selected file must render as a token chip")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    window.HTMLElement.prototype.scrollIntoView = previousScrollIntoView
  }
})

test("insertFileMentionAtCaret inserts a file token at the live caret, spaced from surrounding text", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { render, state, insertFileMentionAtCaret } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    pendingFileMentions: state.pendingFileMentions
  }

  try {
    const project = { id: "proj_insert_caret", name: "Insert Caret Project", path: "/tmp/insert-caret" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_insert_caret",
      sessionsByProject: { [project.id]: [{ id: "sess_insert_caret", directory: project.path }] },
      threads: new Map([["sess_insert_caret", { sessionId: "sess_insert_caret", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      promptDraft: "Doc cho toi file nay nhe",
      pendingFileMentions: []
    })
    render()

    const editor = document.getElementById("promptEditorRoot").querySelector("#promptInput.prompt-editor")
    // Place the caret right after "nay" (no trailing/leading space at the split point), to prove
    // the token lands at the live caret with spaces inserted on both sides, not just appended.
    const caretOffset = "Doc cho toi file nay".length
    const range = document.createRange()
    range.setStart(editor.firstChild, caretOffset)
    range.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)

    insertFileMentionAtCaret("src/foo/bar.js")

    assert.equal(state.promptDraft, "Doc cho toi file nay [bar.js](src/foo/bar.js) nhe")
    const sameEditor = document.getElementById("promptEditorRoot").querySelector("#promptInput.prompt-editor")
    assert.equal(sameEditor, editor, "insertFileMentionAtCaret must patch the existing prompt editor node, not swap it")
    assert.ok(editor.querySelector(".file-mention-token"), "the inserted file must render as a token chip")
    assert.ok(document.activeElement === editor, "the editor must be focused after inserting a file mention")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("insertFileMentionAtCaret appends at the end when there is no live caret inside the editor", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { render, state, insertFileMentionAtCaret } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    pendingFileMentions: state.pendingFileMentions
  }

  try {
    const project = { id: "proj_insert_unfocused", name: "Insert Unfocused Project", path: "/tmp/insert-unfocused" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_insert_unfocused",
      sessionsByProject: { [project.id]: [{ id: "sess_insert_unfocused", directory: project.path }] },
      threads: new Map([["sess_insert_unfocused", { sessionId: "sess_insert_unfocused", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      promptDraft: "Xem file kia di",
      pendingFileMentions: []
    })
    render()

    // No selection anchored inside #promptInput (e.g. focus is on a Files-panel context menu
    // instead) - promptEditorCaret falls back to end-of-text, so the token must append there.
    window.getSelection().removeAllRanges()

    insertFileMentionAtCaret("docs/readme.md")

    assert.equal(state.promptDraft, "Xem file kia di [readme.md](docs/readme.md) ")
    const editor = document.getElementById("promptEditorRoot").querySelector("#promptInput.prompt-editor")
    assert.ok(editor.querySelector(".file-mention-token"), "the inserted file must render as a token chip")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("FileTreeNode.svelte: right-click a file opens an \"Add to chat\" context menu that inserts a file token", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    pendingFileMentions: state.pendingFileMentions,
    rightSidebarOpen: state.rightSidebarOpen,
    fileTreeProjectId: state.fileTreeProjectId,
    fileTreeChildren: state.fileTreeChildren,
    fileTreeExpanded: state.fileTreeExpanded,
    fileTreeLoading: state.fileTreeLoading,
    fileTreeError: state.fileTreeError,
    fileTreeContextMenu: state.fileTreeContextMenu
  }

  try {
    const project = { id: "proj_ctxmenu", name: "Ctx Menu Project", path: "/tmp/ctxmenu" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_ctxmenu",
      sessionsByProject: { [project.id]: [{ id: "sess_ctxmenu", directory: project.path }] },
      threads: new Map([["sess_ctxmenu", { sessionId: "sess_ctxmenu", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      promptDraft: "",
      pendingFileMentions: [],
      rightSidebarOpen: true,
      fileTreeProjectId: project.id,
      fileTreeChildren: new Map([["", [
        { type: "file", name: "app.js", path: "src/app.js", openable: true },
        { type: "directory", name: "lib", path: "src/lib" }
      ]]]),
      fileTreeExpanded: new Set(),
      fileTreeLoading: new Set(),
      fileTreeError: "",
      fileTreeContextMenu: null
    })
    render()

    const fileRow = document.querySelector('[data-tree-file="src/app.js"]')
    assert.ok(fileRow, "the file row must render in the Files panel")

    fileRow.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 200 }))
    // Bridged $state updates flush on a microtask, not synchronously - give Svelte a tick first.
    await Promise.resolve()
    assert.equal(state.fileTreeContextMenu?.path, "src/app.js", "right-clicking a file row must open its context menu")

    const menu = document.querySelector(".mini-context-menu")
    const sidebar = document.querySelector(".right-file-sidebar")
    assert.ok(menu, "the context menu popup must render")
    assert.ok(sidebar, "the right file sidebar must be mounted")
    // The sidebar has `contain: layout paint` for its slide transition, which would clip/reposition
    // a position:fixed popup nested inside it - the popup must render as a sibling instead.
    assert.equal(sidebar.contains(menu), false, "the context menu must render OUTSIDE .right-file-sidebar, not nested inside it")

    const addToChat = menu.querySelector(".pop-item")
    assert.ok(addToChat, "the 'Add to chat' menu item must render")
    addToChat.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
    await Promise.resolve()

    assert.equal(state.promptDraft, "[app.js](src/app.js) ")
    assert.equal(state.fileTreeContextMenu, null, "the context menu must close after inserting the token")

    // Directories carry no oncontextmenu handler at all - right-clicking one must not open this menu.
    const dirRow = document.querySelector('[data-tree-dir="src/lib"]')
    dirRow.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
    await Promise.resolve()
    assert.equal(state.fileTreeContextMenu, null, "right-clicking a directory row must not open the file context menu")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

// An xterm.js buffer is live, unrecoverable state: the runtime replays nothing, so a terminal that
// gets torn down and rebuilt comes back blank and the user's scrollback is gone for good. The dock
// host lives inside renderMain()'s {@html}, which hands out a brand-new element on every repaint,
// so ANY unrelated state change (opening the Files sidebar, a streaming chat message) would remount
// the island and dispose the terminal. Node identity is the thing to assert here — a rebuilt panel
// looks identical in the DOM and only differs by being a different element.
test("the terminal dock keeps its DOM (and therefore its xterm buffer) across unrelated re-renders", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    terminalPanelOpen: state.terminalPanelOpen,
    rightSidebarOpen: state.rightSidebarOpen,
    terminalPtyId: state.terminalPtyId,
    terminalProjectId: state.terminalProjectId,
    terminalStatus: state.terminalStatus
  }
  try {
    const project = { id: "proj_dock_identity", name: "Dock Identity", path: "/tmp/dock-identity" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_dock_identity",
      sessionsByProject: { [project.id]: [{ id: "sess_dock_identity", directory: project.path }] },
      threads: new Map([["sess_dock_identity", { sessionId: "sess_dock_identity", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      terminalPanelOpen: true,
      rightSidebarOpen: false,
      terminalPtyId: null,
      terminalProjectId: null,
      terminalStatus: "idle"
    })

    render()
    const firstPanel = document.querySelector(".terminal-panel")
    assert.ok(firstPanel, "the dock must mount before this can be about survival")

    // The reported trigger: toggling the Files sidebar repaints main and used to wipe the terminal.
    state.rightSidebarOpen = true
    render()
    assert.equal(
      document.querySelector(".terminal-panel"),
      firstPanel,
      "opening the Files sidebar must move the terminal, not rebuild it — a new node means xterm was disposed and the scrollback is gone"
    )

    // And it must survive an ordinary repaint with nothing at all changing.
    render()
    assert.equal(document.querySelector(".terminal-panel"), firstPanel, "a plain re-render must not rebuild the terminal either")

    // Closing the dock still removes it; persistence must not mean "never goes away".
    state.terminalPanelOpen = false
    render()
    assert.equal(document.querySelector(".terminal-dock"), null, "closing the dock must still remove it from the layout")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

// Stacked mode is a Files-above-Code split of the DOCUMENT column: every rule implementing it is
// scoped to `.app.has-doc...` in styles.css, so with no document open the layout is plain
// side-by-side no matter what the flag says. The flag is persisted, and its only off-switch is a
// button that itself only renders while a document is open — so closing the document strands the
// user with stackedRightPanels stuck on. If the resizer keeps routing on the flag alone it then
// drives --stacked-top-h, a variable nothing in the current layout reads: the cursor still changes
// on hover, the drag runs, and absolutely nothing moves.
test("with stacked mode left on but no document open, the right-file resizer still resizes the sidebar width", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousStorage = global.localStorage
  global.localStorage = backedLocalStorage()
  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    rightSidebarOpen: state.rightSidebarOpen,
    fileTreeProjectId: state.fileTreeProjectId,
    fileTreeChildren: state.fileTreeChildren,
    stackedRightPanels: state.stackedRightPanels,
    document: state.document
  }
  const previousRightSidebarW = document.documentElement.style.getPropertyValue("--right-sidebar-w")
  const previousStackedTopH = document.documentElement.style.getPropertyValue("--stacked-top-h")
  try {
    const project = { id: "proj_stacked_stranded", name: "Stacked Stranded", path: "/tmp/stacked-stranded" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_stacked_stranded",
      sessionsByProject: { [project.id]: [{ id: "sess_stacked_stranded", directory: project.path }] },
      threads: new Map([["sess_stacked_stranded", { sessionId: "sess_stacked_stranded", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      rightSidebarOpen: true,
      fileTreeProjectId: project.id,
      fileTreeChildren: new Map([["", []]]),
      // The stranding condition: flag on (restored from localStorage), document closed.
      stackedRightPanels: true,
      document: null
    })
    render()
    document.documentElement.style.removeProperty("--stacked-top-h")

    const resizer = document.querySelector('[data-right-file-resizer]')
    assert.ok(resizer, "the resizer must be present — the user can see and hover it, which is why this looks so dead")
    resizer.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 1000, clientY: 200 }))
    document.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: 800, clientY: 400 }))
    document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: 800, clientY: 400 }))

    assert.equal(
      document.documentElement.style.getPropertyValue("--right-sidebar-w"),
      "180px",
      "without a document the layout is side-by-side, so the resizer must drive the sidebar WIDTH"
    )
    assert.equal(
      document.documentElement.style.getPropertyValue("--stacked-top-h"),
      "",
      "it must not drive the stacked split, which nothing in this layout reads — that is the silent no-op"
    )
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.localStorage = previousStorage
    document.documentElement.style.setProperty("--right-sidebar-w", previousRightSidebarW)
    document.documentElement.style.setProperty("--stacked-top-h", previousStackedTopH)
  }
})

// Written while chasing a "sidebar cannot be resized" report. The terminal dock turned out NOT to
// be the cause (that was stacked mode staying on with no document — see the test above), so treat
// this as a plain interaction guard between two panels that share .main, not as evidence about
// that bug: the dock is the only sibling that can take height away from the chat column.
test("the right-file-sidebar resizer keeps working with the terminal dock sharing the layout", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousStorage = global.localStorage
  global.localStorage = backedLocalStorage()
  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    rightSidebarOpen: state.rightSidebarOpen,
    fileTreeProjectId: state.fileTreeProjectId,
    fileTreeChildren: state.fileTreeChildren,
    stackedRightPanels: state.stackedRightPanels,
    terminalPanelOpen: state.terminalPanelOpen,
    terminalPtyId: state.terminalPtyId,
    terminalProjectId: state.terminalProjectId,
    terminalStatus: state.terminalStatus
  }
  const previousRightSidebarW = document.documentElement.style.getPropertyValue("--right-sidebar-w")
  try {
    const project = { id: "proj_right_resize_with_dock", name: "Right Resize With Dock", path: "/tmp/right-resize-with-dock" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_right_resize_with_dock",
      sessionsByProject: { [project.id]: [{ id: "sess_right_resize_with_dock", directory: project.path }] },
      threads: new Map([["sess_right_resize_with_dock", { sessionId: "sess_right_resize_with_dock", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      rightSidebarOpen: true,
      fileTreeProjectId: project.id,
      fileTreeChildren: new Map([["", []]]),
      stackedRightPanels: false,
      terminalPanelOpen: true,
      terminalPtyId: null,
      terminalProjectId: null,
      terminalStatus: "idle"
    })
    render()

    const resizer = document.querySelector('[data-right-file-resizer]')
    assert.ok(resizer, "the right-file-resizer must still be in the DOM with the terminal dock open")
    resizer.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 1000, clientY: 0 }))
    document.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: 800, clientY: 0 }))
    document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: 800, clientY: 0 }))

    assert.equal(
      document.documentElement.style.getPropertyValue("--right-sidebar-w"),
      "180px",
      "the terminal dock being open must not stop the right-file-sidebar drag from writing --right-sidebar-w"
    )
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.localStorage = previousStorage
    document.documentElement.style.setProperty("--right-sidebar-w", previousRightSidebarW)
  }
})

// Regression test: TerminalPanel.svelte's derived state calls ctx.terminalBelongsToActiveProject(),
// and that function was once missing from the init() deps of the island that mounts the panel —
// every other terminal test drives the state machine directly (confirmOpenTerminal/
// handleRuntimeStream/etc.) without ever mounting the real component, so none of them caught that
// the panel threw and rendered nothing at all (no "Open Terminal" button, no empty-state text) the
// moment a user actually opened it. This test mounts the real TerminalPanel through a full
// render() and asserts the button is really in the DOM. The panel has since moved out of the right
// sidebar into its own bottom dock with its own island (terminalDockIsland), which is exactly the
// kind of re-wiring that can drop a ctx dependency again.
test("the header terminal toggle opens a bottom dock (not a right-sidebar tab) that actually renders the 'Open Terminal' button (catches missing ctx wiring)", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    terminalPanelOpen: state.terminalPanelOpen,
    terminalPtyId: state.terminalPtyId,
    terminalProjectId: state.terminalProjectId,
    terminalStatus: state.terminalStatus,
    terminalConfirmOpen: state.terminalConfirmOpen
  }
  try {
    const project = { id: "proj_terminal_render", name: "Terminal Render Project", path: "/tmp/terminal-render" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_terminal_render",
      sessionsByProject: { [project.id]: [{ id: "sess_terminal_render", directory: project.path }] },
      threads: new Map([["sess_terminal_render", { sessionId: "sess_terminal_render", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      terminalPanelOpen: false,
      terminalPtyId: null,
      terminalProjectId: null,
      terminalStatus: "idle"
    })

    render()

    // The header toggle sits next to the IDE split button, independent of the Files sidebar.
    const headerToggle = document.querySelector('[data-action="toggleTerminalPanel"]')
    assert.ok(headerToggle, "the header terminal toggle button must render next to the IDE button")
    assert.equal(headerToggle.title, "Open terminal")
    assert.equal(headerToggle.classList.contains("active"), false)
    assert.equal(document.querySelector(".terminal-dock"), null, "the dock must not exist until toggled open")

    state.terminalPanelOpen = true
    render()

    assert.ok(document.querySelector(".terminal-dock"), "the bottom terminal dock must render below the chat")
    assert.ok(document.querySelector(".terminal-dock-resizer"), "a resize handle must sit above the dock")
    assert.ok(document.querySelector(".terminal-panel"), "the terminal panel must actually mount inside the dock")
    assert.match(document.querySelector(".terminal-dock-title").textContent, /Terminal/, "the dock head must label itself, since it no longer has a tab name to lean on")
    assert.ok(document.querySelector(".terminal-empty-icon"), "the empty state must be a composed icon+message+CTA block, not a bare line of text")
    const openButton = document.querySelector('[data-action="openTerminalConfirm"]')
    assert.ok(openButton, "the 'Open Terminal' button must actually be in the DOM, not just theorized from state")
    assert.match(openButton.textContent, /Open Terminal/)
    assert.match(document.querySelector(".terminal-panel").textContent, /No terminal open for this project/)
    const headerToggleAfter = document.querySelector('[data-action="toggleTerminalPanel"]')
    assert.equal(headerToggleAfter.title, "Close terminal")
    assert.equal(headerToggleAfter.classList.contains("active"), true)

    // Same DOM-mount check for the confirm modal (Modals island, separate ctx from
    // terminalDockIsland) — it only needs ctx.selectedProject(), already wired, but this is
    // asserted for real rather than assumed, per the lesson above.
    state.terminalConfirmOpen = true
    render()
    const modal = document.querySelector("#terminalConfirmTitle")
    assert.ok(modal, "the terminal confirm modal must actually mount")
    assert.equal(modal.textContent, "Open a terminal?")
    assert.match(document.querySelector(".confirm-modal").textContent, /Terminal Render Project/)
    assert.ok(document.querySelector('.confirm-modal [data-action="confirmOpenTerminal"]'))
    state.terminalConfirmOpen = false
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("RightFileSidebar.svelte: the stacked-layout toggle only shows with both panels open, flips state/class/icon, and persists", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousStorage = global.localStorage
  global.localStorage = backedLocalStorage()
  const previousHljs = global.hljs
  global.hljs = { getLanguage() { return false } }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    rightSidebarOpen: state.rightSidebarOpen,
    fileTreeProjectId: state.fileTreeProjectId,
    fileTreeChildren: state.fileTreeChildren,
    document: state.document,
    stackedRightPanels: state.stackedRightPanels
  }

  try {
    const project = { id: "proj_stack_toggle", name: "Stack Toggle Project", path: "/tmp/stack-toggle" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_stack_toggle",
      sessionsByProject: { [project.id]: [{ id: "sess_stack_toggle", directory: project.path }] },
      threads: new Map([["sess_stack_toggle", { sessionId: "sess_stack_toggle", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      rightSidebarOpen: true,
      fileTreeProjectId: project.id,
      fileTreeChildren: new Map([["", []]]),
      document: {
        requestedPath: "src/app.js",
        path: "src/app.js",
        name: "app.js",
        relativePath: "src/app.js",
        content: "line one",
        loading: false,
        error: "",
        renderMode: "code"
      },
      stackedRightPanels: false
    })
    render()

    const toggle = document.querySelector(".right-file-layout-toggle")
    assert.ok(toggle, "the toggle must render when both Files and Code are open")
    assert.ok(!document.querySelector(".app.stacked-right"), "starts side-by-side (no stacked-right class)")

    toggle.click()
    await Promise.resolve()
    assert.equal(state.stackedRightPanels, true)
    assert.ok(document.querySelector(".app.stacked-right"), "clicking must add the stacked-right class")
    assert.equal(localStorage.getItem("openworking:stacked-right-panels"), "1", "the choice must persist to localStorage")

    const toggleAfterFirstClick = document.querySelector(".right-file-layout-toggle")
    toggleAfterFirstClick.click()
    await Promise.resolve()
    assert.equal(state.stackedRightPanels, false)
    assert.ok(!document.querySelector(".app.stacked-right"), "clicking again must remove the stacked-right class")
    assert.equal(localStorage.getItem("openworking:stacked-right-panels"), "0")

    // Only one panel open (Code, no Files) - the toggle has nothing to switch between.
    state.rightSidebarOpen = false
    render()
    assert.ok(!document.querySelector(".right-file-layout-toggle"), "the toggle must not render with only Code open")

    // Only Files open (no Code) - same reasoning in the other direction.
    state.rightSidebarOpen = true
    state.document = null
    render()
    assert.ok(!document.querySelector(".right-file-layout-toggle"), "the toggle must not render with only Files open")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.localStorage = previousStorage
    global.hljs = previousHljs
  }
})

test("stacked-right resize: document-resizer and right-file-resizer write the stacked CSS vars/keys in stacked mode, the side-by-side ones otherwise", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousStorage = global.localStorage
  global.localStorage = backedLocalStorage()
  const previousHljs = global.hljs
  global.hljs = { getLanguage() { return false } }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    rightSidebarOpen: state.rightSidebarOpen,
    fileTreeProjectId: state.fileTreeProjectId,
    fileTreeChildren: state.fileTreeChildren,
    document: state.document,
    stackedRightPanels: state.stackedRightPanels,
    sidebarCollapsed: state.sidebarCollapsed
  }
  const previousDocumentW = document.documentElement.style.getPropertyValue("--document-w")
  const previousRightSidebarW = document.documentElement.style.getPropertyValue("--right-sidebar-w")
  const previousStackedRightW = document.documentElement.style.getPropertyValue("--stacked-right-w")
  const previousStackedTopH = document.documentElement.style.getPropertyValue("--stacked-top-h")

  // A full mousedown -> mousemove -> mouseup drag, mirroring how startDividerResize is actually
  // driven: it only persists to localStorage in mouseup's handler once a mousemove has occurred.
  function drag(resizerSelector, { downX, downY = 0, moveX, moveY = 0 }) {
    const resizer = document.querySelector(resizerSelector)
    resizer.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: downX, clientY: downY }))
    document.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: moveX, clientY: moveY }))
    document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: moveX, clientY: moveY }))
  }

  try {
    const project = { id: "proj_stack_resize", name: "Stack Resize Project", path: "/tmp/stack-resize" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_stack_resize",
      sessionsByProject: { [project.id]: [{ id: "sess_stack_resize", directory: project.path }] },
      threads: new Map([["sess_stack_resize", { sessionId: "sess_stack_resize", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      rightSidebarOpen: true,
      fileTreeProjectId: project.id,
      fileTreeChildren: new Map([["", []]]),
      document: {
        requestedPath: "src/app.js",
        path: "src/app.js",
        name: "app.js",
        relativePath: "src/app.js",
        content: "line one",
        loading: false,
        error: "",
        renderMode: "code"
      },
      stackedRightPanels: false
    })
    render()

    // Side-by-side mode (regression check): each resizer must still drive its own original
    // variable/key, untouched by anything added for the stacked mode.
    drag('[data-right-file-resizer]', { downX: 1000, moveX: 800 })
    // jsdom's getBoundingClientRect() is all-zero, so the live-measured cap collapses to
    // RIGHT_FILE_MIN_WIDTH (180); the point here is only that --right-sidebar-w is what gets written.
    assert.equal(document.documentElement.style.getPropertyValue("--right-sidebar-w"), "180px")
    assert.equal(localStorage.getItem("openworking:right-file-sidebar-w"), "180")

    drag('[data-document-resizer]', { downX: 1000, moveX: 700 })
    // jsdom's getBoundingClientRect() is all-zero, so the live-measured cap collapses to
    // DOCUMENT_MIN_WIDTH (300) - this still proves the side-by-side path (--document-w) is written.
    assert.equal(document.documentElement.style.getPropertyValue("--document-w"), "300px")
    assert.equal(localStorage.getItem("openworking:document-viewer-w"), "300")

    // Switch to stacked mode - the SAME two resizer elements must now drive the stacked
    // variables/keys instead, and must not disturb the side-by-side values just set above.
    state.stackedRightPanels = true
    render()

    drag('[data-document-resizer]', { downX: 1500, moveX: 1000 })
    assert.equal(document.documentElement.style.getPropertyValue("--stacked-right-w"), "500px", "document-resizer must resize the shared column's width in stacked mode")
    assert.equal(localStorage.getItem("openworking:stacked-right-w"), "500")

    drag('[data-right-file-resizer]', { downX: 0, downY: 200, moveX: 0, moveY: 400 })
    assert.equal(document.documentElement.style.getPropertyValue("--stacked-top-h"), "200px", "right-file-resizer must become the vertical Files/Code split divider in stacked mode")
    assert.equal(localStorage.getItem("openworking:stacked-top-h"), "200")

    // The side-by-side values from before switching modes must be exactly as left.
    assert.equal(document.documentElement.style.getPropertyValue("--document-w"), "300px", "switching to stacked mode must not touch the side-by-side document width")
    assert.equal(document.documentElement.style.getPropertyValue("--right-sidebar-w"), "180px", "switching to stacked mode must not touch the side-by-side Files width")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.localStorage = previousStorage
    global.hljs = previousHljs
    document.documentElement.style.setProperty("--document-w", previousDocumentW)
    document.documentElement.style.setProperty("--right-sidebar-w", previousRightSidebarW)
    document.documentElement.style.setProperty("--stacked-right-w", previousStackedRightW)
    document.documentElement.style.setProperty("--stacked-top-h", previousStackedTopH)
  }
})

test("toggling stacked-right layout preserves the open file and the Files tree's browsed state", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousStorage = global.localStorage
  global.localStorage = backedLocalStorage()
  const previousHljs = global.hljs
  global.hljs = { getLanguage() { return false } }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    rightSidebarOpen: state.rightSidebarOpen,
    fileTreeProjectId: state.fileTreeProjectId,
    fileTreeChildren: state.fileTreeChildren,
    fileTreeExpanded: state.fileTreeExpanded,
    document: state.document,
    stackedRightPanels: state.stackedRightPanels
  }

  try {
    const project = { id: "proj_stack_preserve", name: "Stack Preserve Project", path: "/tmp/stack-preserve" }
    const browsedDoc = {
      requestedPath: "src/deep/app.js",
      path: "src/deep/app.js",
      name: "app.js",
      relativePath: "src/deep/app.js",
      content: "line one\nline two",
      loading: false,
      error: "",
      renderMode: "code"
    }
    const expandedFolders = new Set(["src", "src/deep"])
    const treeChildren = new Map([
      ["", [{ type: "directory", name: "src", path: "src" }]],
      ["src", [{ type: "directory", name: "deep", path: "src/deep" }]],
      ["src/deep", [{ type: "file", name: "app.js", path: "src/deep/app.js", openable: true }]]
    ])
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_stack_preserve",
      sessionsByProject: { [project.id]: [{ id: "sess_stack_preserve", directory: project.path }] },
      threads: new Map([["sess_stack_preserve", { sessionId: "sess_stack_preserve", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      rightSidebarOpen: true,
      fileTreeProjectId: project.id,
      fileTreeChildren: treeChildren,
      fileTreeExpanded: expandedFolders,
      document: browsedDoc,
      stackedRightPanels: false
    })
    render()

    assert.ok(document.querySelector('[data-tree-file="src/deep/app.js"].active'), "the open file must be marked active in the tree before switching layout")

    document.querySelector(".right-file-layout-toggle").click()
    await Promise.resolve()

    assert.ok(document.querySelector(".app.stacked-right"), "sanity: layout actually switched to stacked")
    assert.equal(state.document.path, "src/deep/app.js", "the open file must not change when switching to stacked")
    assert.equal(state.document, browsedDoc, "the document object itself must be the same reference, not reloaded/reset")
    assert.deepEqual([...state.fileTreeExpanded], ["src", "src/deep"], "the tree's expanded folders must be untouched")
    assert.equal(state.fileTreeChildren, treeChildren, "the tree's loaded children must not be discarded/reloaded")
    assert.ok(document.querySelector('[data-tree-file="src/deep/app.js"].active'), "the open file must still show as active in the tree while stacked")

    document.querySelector(".right-file-layout-toggle").click()
    await Promise.resolve()

    assert.ok(!document.querySelector(".app.stacked-right"), "sanity: layout actually switched back")
    assert.equal(state.document.path, "src/deep/app.js", "the open file must survive switching back to side-by-side too")
    assert.deepEqual([...state.fileTreeExpanded], ["src", "src/deep"])
    assert.equal(state.fileTreeChildren, treeChildren)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.localStorage = previousStorage
    global.hljs = previousHljs
  }
})

test("PromptEditor.svelte: Enter sends the prompt, Shift+Enter inserts a newline instead", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousOpenworking = global.window.openworking
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const calls = []
  global.window.openworking = {
    runtime: {
      async sendPrompt(payload) {
        calls.push(payload)
      }
    }
  }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    runtime: state.runtime,
    config: state.config,
    providerId: state.providerId,
    mode: state.mode,
    promptDraft: state.promptDraft,
    pendingAttachments: state.pendingAttachments,
    pendingFileMentions: state.pendingFileMentions,
    commandMenu: state.commandMenu,
    fileMentionMenu: state.fileMentionMenu
  }

  try {
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [{ id: "proj_enter", name: "Enter Project", path: "/tmp/enter" }],
      activeProjectId: "proj_enter",
      activeSessionId: "sess_enter",
      sessionsByProject: { proj_enter: [{ id: "sess_enter", title: "Existing" }] },
      threads: new Map(),
      runtime: { status: "running", project: { id: "proj_enter" }, sessionStatuses: {} },
      config: {
        provider: {
          openworking: {
            name: "Provider",
            options: { apiKey: "local-key" },
            models: { "model-one": { name: "model-one", modalities: { input: ["text"], output: ["text"] } } }
          }
        }
      },
      providerId: "openworking",
      mode: "agent",
      promptDraft: "",
      pendingAttachments: [],
      pendingFileMentions: [],
      commandMenu: { open: false, query: "", index: 0 },
      fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null }
    })
    render()

    let editor = document.getElementById("promptEditorRoot").querySelector("#promptInput.prompt-editor")

    // Shift+Enter must insert a newline, not send.
    editor.textContent = "line one"
    editor.dispatchEvent(new window.Event("input", { bubbles: true }))
    const rangeAtEnd = document.createRange()
    rangeAtEnd.setStart(editor.firstChild, "line one".length)
    rangeAtEnd.collapse(true)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(rangeAtEnd)
    const shiftEnter = new window.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true })
    editor.dispatchEvent(shiftEnter)
    assert.equal(shiftEnter.defaultPrevented, true, "native Enter (which would submit a form) must be suppressed")
    assert.equal(state.promptDraft, "line one\n")
    assert.equal(calls.length, 0, "Shift+Enter must not send")

    // Enter during an IME composition must not submit. A real compositionstart (not a synthetic
    // isComposing flag) exercises the same state.promptComposing guard handleInput sets.
    calls.length = 0
    state.promptDraft = "dang go tieng viet"
    editor.dispatchEvent(new window.Event("compositionstart", { bubbles: true }))
    const imeEnter = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    editor.dispatchEvent(imeEnter)
    assert.equal(imeEnter.defaultPrevented, false, "Enter during IME composition must not be intercepted")
    assert.equal(calls.length, 0, "IME composition Enter must not send")
    editor.dispatchEvent(new window.Event("compositionend", { bubbles: true }))

    // Plain Enter sends the current draft and does not touch the DOM itself (sendPrompt owns
    // clearing the draft on success/failure).
    state.promptDraft = "Send via Enter"
    const plainEnter = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    editor.dispatchEvent(plainEnter)
    await Promise.resolve()
    await Promise.resolve()

    assert.equal(plainEnter.defaultPrevented, true, "native Enter must be suppressed so it doesn't also insert a newline")
    assert.deepEqual(calls.map(stripInputContract), [{
      sessionId: "sess_enter",
      prompt: "Send via Enter",
      attachmentIds: []
    }])
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.window.openworking = previousOpenworking
  }
})

test("plan message renders as a collapsible Plan card, not raw prose", () => {
  const { renderThreadMessage, state } = __test
  const previousState = {
    activeSessionId: state.activeSessionId,
    threads: state.threads,
    planProposal: state.planProposal,
    planCardExpanded: state.planCardExpanded
  }
  // Use a todowrite tool part (no text part) so rendering does not depend on the
  // markdown engine, which is not initialized in this node:test harness.
  const planMessage = {
    id: "msg_plan",
    role: "assistant",
    stats: { completed: true },
    parts: [
      { type: "tool", tool: "todowrite", state: { status: "completed", input: { todos: [{ content: "Step 1", status: "pending" }] } } }
    ]
  }
  try {
    state.activeSessionId = "sess_plan"
    state.threads = new Map([["sess_plan", {
      sessionId: "sess_plan",
      messages: [{ id: "msg_user", role: "user", parts: [] }, planMessage],
      pendingQuestions: [],
      pendingPermissions: [],
      status: { type: "idle" }
    }]])
    state.planProposal = { sessionId: "sess_plan", afterMessageIndex: 0 }

    state.planCardExpanded = false
    const collapsed = renderThreadMessage(planMessage)
    assert.match(collapsed, /plan-card collapsed/, "a settled plan should render as a collapsed Plan card")
    assert.match(collapsed, /plan-card-head" data-action="togglePlanCard"/, "the header is a toggle")
    assert.match(collapsed, /plan-card-preview" data-action="togglePlanCard"/, "the collapsed preview area is also click-to-expand")
    assert.match(collapsed, /plan-todo/, "a todowrite part should still render inside/under the card")

    state.planCardExpanded = true
    const expanded = renderThreadMessage(planMessage)
    assert.match(expanded, /plan-card expanded/, "expanded state should reflect in the card class")
    assert.doesNotMatch(expanded, /plan-card-preview" data-action/, "expanded preview drops the click handler so its links stay clickable")

    // While streaming (thread busy) the card is forced expanded and the toggle is hidden.
    state.planCardExpanded = false
    state.threads.get("sess_plan").status = { type: "busy" }
    const streaming = renderThreadMessage(planMessage)
    assert.match(streaming, /plan-card expanded/, "a streaming plan card stays expanded")
    assert.doesNotMatch(streaming, /data-action="togglePlanCard"/, "the toggle is hidden while streaming")
    state.threads.get("sess_plan").status = { type: "idle" }

    // A non-plan assistant message keeps the plain assistant-text path (no card).
    state.planProposal = null
    const plain = renderThreadMessage(planMessage)
    assert.doesNotMatch(plain, /plan-card/, "non-plan messages must not render the Plan card")
    assert.match(plain, /plan-todo/, "the todowrite tool still renders on the plain path")
  } finally {
    Object.assign(state, previousState)
  }
})

test("agent progress stays expanded while streaming and collapses into one card after completion", () => {
  const { renderThreadMessage, state } = __test
  const previousExpanded = state.agentProgressExpanded
  const previousMarked = global.marked
  const message = {
    id: "msg_progress",
    role: "assistant",
    parts: [
      { id: "progress_1", type: "reasoning", text: "Inspecting the repository." },
      { id: "tool_1", type: "tool", tool: "shell", state: { status: "completed", input: { command: "git status" }, output: "clean" } },
      { id: "progress_2", type: "reasoning", text: "Reviewing the relevant files." },
      { id: "text_1", type: "text", text: "Final answer remains visible." }
    ]
  }
  try {
    global.marked = { Renderer: class {}, parse: (text) => `<p>${text}</p>` }
    state.agentProgressExpanded = new Set()

    const streaming = renderThreadMessage(message)
    assert.doesNotMatch(streaming, /agent-progress-card/)
    assert.equal((streaming.match(/class="reasoning-block"/g) || []).length, 2)

    message.stats = { completed: true }
    const collapsed = renderThreadMessage(message)
    assert.equal((collapsed.match(/agent-progress-card/g) || []).length, 1)
    assert.match(collapsed, /Agent progress/)
    assert.match(collapsed, /2 updates/)
    assert.match(collapsed, /aria-expanded="false"/)
    assert.match(collapsed, /agent-progress-body" hidden/)

    const host = document.createElement("div")
    host.innerHTML = collapsed
    const card = host.querySelector(".agent-progress-card")
    assert.ok(card)
    assert.equal(card.querySelector(".tool-step"), null, "tool rows stay outside the progress card")
    assert.ok(host.querySelector(".tool-step"))
    assert.equal(card.textContent.includes("Final answer remains visible."), false)
    assert.equal(host.textContent.includes("Final answer remains visible."), true)
  } finally {
    global.marked = previousMarked
    state.agentProgressExpanded = previousExpanded
  }
})

test("completed agent progress card toggles with aria-expanded through the delegated action", async () => {
  const { handleAction, renderThreadMessage, state } = __test
  const previousExpanded = state.agentProgressExpanded
  const previousMarked = global.marked
  try {
    global.marked = { Renderer: class {}, parse: (text) => `<p>${text}</p>` }
    state.agentProgressExpanded = new Set()
    await handleAction({
      currentTarget: {
        dataset: { action: "toggleAgentProgress", progressMessage: "msg_progress_toggle" }
      }
    })
    assert.equal(state.agentProgressExpanded.has("msg_progress_toggle"), true)
    const expanded = renderThreadMessage({
      id: "msg_progress_toggle",
      role: "assistant",
      stats: { completed: true },
      parts: [{ type: "reasoning", text: "Visible after expanding." }]
    })
    assert.match(expanded, /aria-expanded="true"/)
    assert.doesNotMatch(expanded, /agent-progress-body" hidden/)

    await handleAction({
      currentTarget: {
        dataset: { action: "toggleAgentProgress", progressMessage: "msg_progress_toggle" }
      }
    })
    assert.equal(state.agentProgressExpanded.has("msg_progress_toggle"), false)
  } finally {
    global.marked = previousMarked
    state.agentProgressExpanded = previousExpanded
  }
})

test("Plan card and proposal actions wait for the completed message and settled turn", () => {
  const { planProposalReady, planProposalSettled, renderPlanProposal, renderThreadMessage, state } = __test
  const previousState = {
    activeSessionId: state.activeSessionId,
    threads: state.threads,
    planAccepted: state.planAccepted,
    planProposal: state.planProposal,
    planCardExpanded: state.planCardExpanded
  }
  const planMessage = {
    id: "msg_plan_completion",
    role: "assistant",
    parts: [
      { type: "tool", tool: "write", state: { status: "completed", input: { filePath: "/tmp/plan.md" } } }
    ]
  }
  const thread = {
    sessionId: "sess_plan_completion",
    messages: [{ id: "msg_user", role: "user", parts: [] }, planMessage],
    pendingQuestions: [],
    pendingPermissions: [],
    status: { type: "idle" }
  }

  try {
    state.activeSessionId = "sess_plan_completion"
    state.threads = new Map([["sess_plan_completion", thread]])
    state.planAccepted = null
    state.planProposal = { sessionId: "sess_plan_completion", afterMessageIndex: 0 }
    state.planCardExpanded = false

    // A transient idle must not settle or collapse a message that has not emitted
    // its final message.updated(time.completed) event.
    assert.equal(planProposalSettled(planMessage), false)
    assert.equal(planProposalReady(), false)
    assert.match(renderThreadMessage(planMessage), /plan-card expanded/)
    assert.doesNotMatch(renderThreadMessage(planMessage), /data-action="togglePlanCard"/)
    assert.equal(renderPlanProposal(), "")

    planMessage.stats = { completed: true }
    thread.status = { type: "busy" }
    assert.equal(planProposalSettled(planMessage), false)
    assert.equal(renderPlanProposal(), "")

    thread.status = { type: "idle" }
    thread.pendingQuestions = [{ requestID: "q1" }]
    assert.equal(planProposalSettled(planMessage), false)
    assert.equal(renderPlanProposal(), "")

    thread.pendingQuestions = []
    planMessage.parts[0].state.status = "running"
    assert.equal(planProposalSettled(planMessage), false)
    assert.equal(renderPlanProposal(), "")

    planMessage.parts[0].state.status = "completed"
    assert.equal(planProposalSettled(planMessage), true)
    assert.equal(planProposalReady(), true)
    const collapsed = renderThreadMessage(planMessage)
    assert.match(collapsed, /plan-card collapsed/)
    assert.match(collapsed, /data-action="togglePlanCard"/)
    assert.match(renderPlanProposal(), /Proposed a plan/)
    assert.match(renderPlanProposal(), /data-action="acceptPlan"/)
  } finally {
    Object.assign(state, previousState)
  }
})

test("togglePlanCard flips the expanded state via the delegated action", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { handleAction, state } = __test
  const previousExpanded = state.planCardExpanded
  try {
    state.planCardExpanded = false
    await handleAction({ currentTarget: { dataset: { action: "togglePlanCard" } } })
    assert.equal(state.planCardExpanded, true, "first toggle expands the card")
    await handleAction({ currentTarget: { dataset: { action: "togglePlanCard" } } })
    assert.equal(state.planCardExpanded, false, "second toggle collapses the card")
  } finally {
    state.planCardExpanded = previousExpanded
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("maybeAutoOpenPlan no longer mirrors the plan into the document panel", () => {
  const { renderThreadContent, state } = __test
  // renderThreadContent runs maybeAutoOpenPlan for the active session; a prose plan
  // must NOT open a document (the plan now lives only in the inline card).
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const previousState = {
    activeSessionId: state.activeSessionId,
    threads: state.threads,
    planProposal: state.planProposal,
    document: state.document,
    planAutoOpened: state.planAutoOpened
  }
  try {
    state.document = null
    state.planAutoOpened = null
    state.activeSessionId = "sess_plan"
    state.threads = new Map([["sess_plan", {
      sessionId: "sess_plan",
      messages: [
        { id: "msg_user", role: "user", parts: [] },
        { id: "msg_plan", role: "assistant", parts: [{ type: "text", text: "A".repeat(400) }] }
      ],
      pendingQuestions: [],
      pendingPermissions: [],
      status: { type: "idle" }
    }]])
    state.planProposal = { sessionId: "sess_plan", afterMessageIndex: 0 }

    renderThreadContent()

    assert.equal(state.document, null, "a prose plan must not open the right-side document viewer")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("paintSkillsPanel rewrites only the active skills panel host", () => {
  // The islands bundle resolves `document` in the jsdom window, so a fake host can't intercept
  // its queries - mount the skills screen for real and assert isolation via element identity.
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { render, paintSkillsPanel, renderCounters, state } = __test
  const previousState = {
    nav: state.nav,
    skillsTab: state.skillsTab,
    memory: state.memory,
    memoryDraft: state.memoryDraft,
    memoryLoading: state.memoryLoading,
    memorySaving: state.memorySaving,
    memoryError: state.memoryError,
    projects: state.projects,
    activeProjectId: state.activeProjectId
  }

  try {
    Object.assign(state, {
      nav: "skills",
      auth: { saml2Enabled: false, status: "authenticated" },
      skillsTab: "memory",
      memory: { global: "Global fact", project: "Project fact", hasProject: true },
      memoryDraft: { global: "Global fact", project: "Project fact" },
      memoryLoading: false,
      memorySaving: null,
      memoryError: null,
      projects: [{ id: "proj_1", name: "Project One", path: "/tmp/project-one" }],
      activeProjectId: "proj_1"
    })
    render()
    const sidebarBefore = document.querySelector("aside.sidebar")
    const memoryTextarea = document.querySelector('[data-memory-field="global"]')
    memoryTextarea.focus()
    memoryTextarea.setSelectionRange(4, 4)
    memoryTextarea.value = "Global edited fact"
    memoryTextarea.dispatchEvent(new window.Event("input", { bubbles: true }))
    memoryTextarea.setSelectionRange(4, 4)
    renderCounters.reset()

    assert.equal(paintSkillsPanel(), true)

    const panelHost = document.querySelector("[data-skills-panel-host]")
    assert.match(panelHost.innerHTML, /Global memory/)
    assert.match(panelHost.innerHTML, /Project One/)
    assert.equal(state.memoryDraft.global, "Global edited fact")
    assert.equal(document.querySelector('[data-memory-field="global"]'), memoryTextarea, "memory status updates must not remount the editor")
    assert.equal(document.activeElement, memoryTextarea)
    assert.equal(memoryTextarea.selectionStart, 4)
    assert.ok(memoryTextarea.closest(".editor").classList.contains("dirty"))
    assert.equal(document.querySelector("aside.sidebar"), sidebarBefore, "sidebar must not be rebuilt by a skills-panel repaint")
    assert.equal(renderCounters.snapshot().skillsPanel, 1)
    assert.equal(renderCounters.snapshot().full, 0)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("Skills screen separates 15 built-in skills from three read-only managed plugins", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    skillsTab: state.skillsTab,
    customSkills: state.customSkills,
    catalog: state.catalog,
    managedPlugins: state.managedPlugins
  }

  try {
    Object.assign(state, {
      nav: "skills",
      auth: { saml2Enabled: false, status: "authenticated" },
      skillsTab: "skills",
      customSkills: [],
      catalog: [],
      managedPlugins: [
        {
          id: "openworking.translate-document",
          name: "translate_document",
          description: "Translate PDF, DOCX and Markdown files.",
          tools: ["translate_document"],
          supportedFormats: ["PDF", "DOCX", "Markdown"],
          builtIn: true,
          enabled: true
        },
        {
          id: "openworking.translate-office-document",
          name: "translate_office_document",
          description: "Translate PPTX and XLSX files.",
          tools: ["translate_office_document"],
          supportedFormats: ["PPTX", "XLSX"],
          builtIn: true,
          enabled: true
        },
        {
          id: "openworking.remember",
          name: "remember",
          description: "Persist durable global or project facts.",
          tools: ["remember"],
          supportedFormats: [],
          builtIn: true,
          enabled: true
        }
      ]
    })

    render()
    assert.ok(document.querySelector('[data-skills-tab="plugins"]'))
    // This fork's Skills tab renders grouped .row entries (search + All/Installed/Built-in
    // filters), not the catalog-style .mini grid.
    assert.equal(document.querySelectorAll('[data-panel="skills"] .row').length, 15)
    assert.doesNotMatch(document.querySelector('[data-panel="skills"]').textContent, /translate-document|translate-office-document/)

    state.skillsTab = "plugins"
    render()
    const pluginsPanel = document.querySelector('[data-panel="plugins"]')
    assert.ok(pluginsPanel)
    assert.equal(pluginsPanel.querySelectorAll("[data-plugin-managed]").length, 3)
    assert.match(pluginsPanel.textContent, /Built-in\s*always on/)
    assert.match(pluginsPanel.textContent, /translate_document/)
    assert.match(pluginsPanel.textContent, /PDF, DOCX, Markdown/)
    assert.match(pluginsPanel.textContent, /translate_office_document/)
    assert.match(pluginsPanel.textContent, /PPTX, XLSX/)
    assert.match(pluginsPanel.textContent, /remember/)
    assert.doesNotMatch(pluginsPanel.textContent, /facts\.\s*·/)
    assert.equal(pluginsPanel.querySelectorAll("button, input, select").length, 0)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("paintDocumentViewer repaints only the document viewer island", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  const { render, paintDocumentViewer, renderCounters, state } = __test
  const previousDocumentState = state.document

  try {
    // Mount the shell so the viewer host exists, then check a viewer-only repaint renders the
    // document (loading state) without rebuilding the main region (element identity survives).
    state.document = null
    render()
    const mainBefore = document.getElementById("mainRoot").firstElementChild
    state.document = {
      requestedPath: "/tmp/example.txt",
      path: "/tmp/example.txt",
      name: "example.txt",
      relativePath: "example.txt",
      content: "",
      loading: true,
      error: "",
      renderMode: "code"
    }
    renderCounters.reset()

    assert.equal(paintDocumentViewer(), true)

    assert.ok(document.querySelector(".document-viewer"), "viewer must be mounted by the island")
    assert.match(document.querySelector(".document-viewer .doc-scroll").innerHTML, /Loading…/)
    assert.equal(document.getElementById("mainRoot").firstElementChild, mainBefore, "main region must not be rebuilt by a document repaint")
    assert.equal(renderCounters.snapshot().document, 1)
    assert.equal(renderCounters.snapshot().full, 0)
  } finally {
    state.document = previousDocumentState
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("DocumentViewer.svelte: \"Add to chat\" is hidden while loading, shown for a real file, and inserts a file token on click", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousHljs = global.hljs
  global.hljs = { getLanguage() { return false } }

  const { render, paintDocumentViewer, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    pendingFileMentions: state.pendingFileMentions,
    document: state.document
  }

  try {
    const project = { id: "proj_doc_add", name: "Doc Add Project", path: "/tmp/doc-add" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_doc_add",
      sessionsByProject: { [project.id]: [{ id: "sess_doc_add", directory: project.path }] },
      threads: new Map([["sess_doc_add", { sessionId: "sess_doc_add", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      promptDraft: "",
      pendingFileMentions: [],
      document: {
        requestedPath: "src/app.js",
        path: "src/app.js",
        name: "app.js",
        relativePath: "src/app.js",
        content: "console.log(1)",
        loading: true,
        error: "",
        renderMode: "code"
      }
    })
    render()

    assert.ok(!document.querySelector(".doc-add-to-chat"), "Add to chat must stay hidden while the document is loading")

    state.document = { ...state.document, loading: false }
    assert.equal(paintDocumentViewer(), true)

    const addToChat = document.querySelector(".doc-add-to-chat")
    assert.ok(addToChat, "Add to chat button must render for a real, loaded file")

    addToChat.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))

    assert.equal(state.promptDraft, "[app.js](src/app.js) ")
    const editor = document.getElementById("promptEditorRoot").querySelector("#promptInput.prompt-editor")
    assert.ok(editor.querySelector(".file-mention-token"), "the inserted file must render as a token chip")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.hljs = previousHljs
  }
})

test("selectionLineRange maps a DOM selection inside <pre class=doc-code> to 1-based {startLine, endLine}", () => {
  const { selectionLineRange } = __test

  // Mimics real highlightCode() output (HTML-escaped text with a token in a <span>), exercising
  // the precondition pre.textContent === doc.content with characters that are easiest to mis-escape.
  const pre = document.createElement("pre")
  document.body.appendChild(pre)
  pre.innerHTML = [
    "line one",
    'line &lt;two&gt; <span class="hljs-operator">&amp;</span> three',
    "ünïcödé four",
    "line five",
    "line six"
  ].join("\n")
  const expectedContent = "line one\nline <two> & three\nünïcödé four\nline five\nline six"
  assert.equal(pre.textContent, expectedContent, "highlight markup must not alter the underlying text")

  const [beforeSpan, spanEl, afterSpan] = pre.childNodes
  assert.equal(spanEl.tagName, "SPAN")

  try {
    // Cross-line selection: middle of line 3 ("cödé") to middle of line 5 ("six").
    const crossLine = document.createRange()
    crossLine.setStart(afterSpan, afterSpan.textContent.indexOf("cödé") + 1)
    crossLine.setEnd(afterSpan, afterSpan.textContent.indexOf("six") + 1)
    assert.deepEqual(selectionLineRange(pre, crossLine, expectedContent), { startLine: 3, endLine: 5 })

    // Single-line selection entirely within line 4 ("five").
    const singleLine = document.createRange()
    singleLine.setStart(afterSpan, afterSpan.textContent.indexOf("five"))
    singleLine.setEnd(afterSpan, afterSpan.textContent.indexOf("five") + 2)
    assert.deepEqual(selectionLineRange(pre, singleLine, expectedContent), { startLine: 4, endLine: 4 })

    // From the very start of the file (line 1) into line 2.
    const fromStart = document.createRange()
    fromStart.setStart(beforeSpan, 0)
    fromStart.setEnd(afterSpan, afterSpan.textContent.indexOf("three") + 2)
    assert.deepEqual(selectionLineRange(pre, fromStart, expectedContent), { startLine: 1, endLine: 2 })

    // Selection starting inside the highlighted <span> itself (the "&" text node, line 2) - the
    // walk must attribute its offset correctly even when the boundary node is nested in an element.
    const intoSpan = document.createRange()
    intoSpan.setStart(spanEl.firstChild, 0)
    intoSpan.setEnd(afterSpan, afterSpan.textContent.indexOf("three") + 2)
    assert.deepEqual(selectionLineRange(pre, intoSpan, expectedContent), { startLine: 2, endLine: 2 })

    // Selecting through line 4's trailing newline, but not any real character of line 5, must not
    // over-report an extra selected line - it rounds down to the last fully-touched line.
    const throughTrailingNewline = document.createRange()
    throughTrailingNewline.setStart(afterSpan, afterSpan.textContent.indexOf("five"))
    throughTrailingNewline.setEnd(afterSpan, afterSpan.textContent.indexOf("line six"))
    assert.deepEqual(selectionLineRange(pre, throughTrailingNewline, expectedContent), { startLine: 4, endLine: 4 })

    // Collapsed selection (no drag, just a caret) must return null.
    const collapsed = document.createRange()
    collapsed.setStart(afterSpan, 0)
    collapsed.collapse(true)
    assert.equal(selectionLineRange(pre, collapsed, expectedContent), null)

    // A selection entirely outside the pre element must return null.
    const outsideNode = document.createTextNode("elsewhere on the page")
    document.body.appendChild(outsideNode)
    const outsideRange = document.createRange()
    outsideRange.setStart(outsideNode, 0)
    outsideRange.setEnd(outsideNode, 5)
    assert.equal(selectionLineRange(pre, outsideRange, expectedContent), null)
    outsideNode.remove()
  } finally {
    pre.remove()
  }
})

test("findTextMatches finds case-insensitive, non-overlapping occurrences and returns [] for an empty query", () => {
  const { findTextMatches } = __test

  assert.deepEqual(findTextMatches("hello world", ""), [])
  assert.deepEqual(findTextMatches("hello world", "xyz"), [])
  assert.deepEqual(findTextMatches("Hello World, hello again", "hello"), [
    { start: 0, end: 5 },
    { start: 13, end: 18 }
  ])
  // Overlapping occurrences are not double-counted - scanning resumes from the END of the
  // previous match, not one character past its start.
  assert.deepEqual(findTextMatches("aaaa", "aa"), [
    { start: 0, end: 2 },
    { start: 2, end: 4 }
  ])
})

test("buildMatchRanges turns text matches into real DOM Ranges, correct even across a highlight.js span boundary", () => {
  const { buildMatchRanges } = __test

  const pre = document.createElement("pre")
  document.body.appendChild(pre)
  pre.innerHTML = [
    "function foo() {",
    '  const x = <span class="hljs-string">"hello world"</span>;',
    "  return x",
    "}"
  ].join("\n")
  const content = "function foo() {\n  const x = \"hello world\";\n  return x\n}"
  assert.equal(pre.textContent, content, "highlight markup must not alter the underlying text")

  try {
    // Single match entirely inside one plain text node.
    const fooRanges = buildMatchRanges(pre, content, "foo")
    assert.equal(fooRanges.length, 1)
    assert.equal(fooRanges[0].toString(), "foo")

    // Case-insensitive: query casing differs from the content's actual casing, but the Range
    // must still contain the ORIGINAL text as written in content.
    assert.equal(buildMatchRanges(pre, content, "FUNCTION")[0].toString(), "function")

    // A match starting in plain text before the <span> and ending INSIDE its text node - exactly
    // the case that would throw with Range.surroundContents(), and why Custom Highlight was chosen.
    const crossSpanRanges = buildMatchRanges(pre, content, 'x = "hello')
    assert.equal(crossSpanRanges.length, 1)
    assert.equal(crossSpanRanges[0].toString(), 'x = "hello')

    // No match.
    assert.deepEqual(buildMatchRanges(pre, content, "missing"), [])

    // Multiple matches of the same term, in document order.
    const returnRanges = buildMatchRanges(pre, content, "return")
    assert.equal(returnRanges.length, 1)
    assert.equal(returnRanges[0].toString(), "return")
  } finally {
    pre.remove()
  }
})

test("buildMatchRanges stays fast with thousands of matches in a large file (regression for the typing-freezes-search bug)", () => {
  const { buildMatchRanges, findTextMatches, nodeAtTextOffsets } = __test

  // Reproduces the real trigger: a common short query matching nearly every line of a large file.
  // The old implementation re-walked the whole tree per match boundary - O(matches x content
  // length) - vs. one nodeAtTextOffsets walk at O(content length + matches) here.
  const lineCount = 4000
  const lines = []
  for (let i = 0; i < lineCount; i++) lines.push(`const value${i} = foo(${i});`)
  const content = lines.join("\n")

  const pre = document.createElement("pre")
  document.body.appendChild(pre)
  // Alternate plain text / <span> segments per line, like real hljs output, so the walk actually
  // exercises multiple text nodes rather than one single giant one.
  pre.innerHTML = lines.map((line) => line.replace("foo", '<span class="hljs-title function_">foo</span>')).join("\n")
  assert.equal(pre.textContent, content, "sanity: the span-wrapped markup must not alter the text")

  try {
    // Only find+resolve is what the old implementation made slow - Range construction is a fixed
    // per-match cost that's ~1000x slower in jsdom than Chromium and would swamp the budget below,
    // measuring jsdom instead of the regression this test exists to catch. So only find+resolve is
    // timed; Range construction is used for the correctness assertions below, untimed.
    const start = Date.now()
    const matches = findTextMatches(content, "foo")
    const boundaries = []
    for (const { start: matchStart, end } of matches) boundaries.push(matchStart, end)
    nodeAtTextOffsets(pre, boundaries)
    const elapsedMs = Date.now() - start

    assert.equal(matches.length, lineCount, "must find exactly one match per line")
    // Comfortable margin over the ~15ms this implementation takes, while well under where a
    // reintroduced per-match tree-walk regression would land (extrapolates to well over 1s).
    assert.ok(elapsedMs < 800, `expected match-finding + offset resolution to stay fast at scale, took ${elapsedMs}ms`)

    const ranges = buildMatchRanges(pre, content, "foo")
    assert.equal(ranges.length, lineCount, "must find exactly one match per line")
    assert.equal(ranges[0].toString(), "foo")
    assert.equal(ranges[lineCount - 1].toString(), "foo")
  } finally {
    pre.remove()
  }
})

test("DocumentViewer.svelte: right-clicking a code selection shows an \"Add to chat\" menu that inserts a path:N-M snippet token", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousHljs = global.hljs
  global.hljs = { getLanguage() { return false } }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    pendingFileMentions: state.pendingFileMentions,
    document: state.document
  }

  try {
    const project = { id: "proj_snippet", name: "Snippet Project", path: "/tmp/snippet" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_snippet",
      sessionsByProject: { [project.id]: [{ id: "sess_snippet", directory: project.path }] },
      threads: new Map([["sess_snippet", { sessionId: "sess_snippet", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      promptDraft: "",
      pendingFileMentions: [],
      document: {
        requestedPath: "src/app.js",
        path: "src/app.js",
        name: "app.js",
        relativePath: "src/app.js",
        content: "line one\nline two\nline three\nline four\nline five",
        loading: false,
        error: "",
        renderMode: "code"
      }
    })
    render()

    const pre = document.querySelector(".doc-code")
    const codeEl = pre.querySelector("code")
    const textNode = [...codeEl.childNodes].find((node) => node.nodeType === window.Node.TEXT_NODE)
    assert.ok(textNode, "code body must render as plain escaped text when hljs has no matching grammar")

    // Right-clicking with no selection at all must not show a menu (nothing to add).
    window.getSelection().removeAllRanges()
    pre.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }))
    await Promise.resolve()
    assert.ok(!document.querySelector(".mini-context-menu"), "right-clicking with no selection must not show a menu")

    // Select from the middle of line 2 ("two") to the middle of line 4 ("four"), then right-click
    // INSIDE that selection - a right click preserves the selection, unlike a left click.
    const range = document.createRange()
    range.setStart(textNode, textNode.textContent.indexOf("two"))
    range.setEnd(textNode, textNode.textContent.indexOf("four") + 2)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    pre.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 150, clientY: 250 }))
    await Promise.resolve()

    const menu = document.querySelector(".mini-context-menu")
    assert.ok(menu, "a context menu must appear for a non-empty code selection")
    const viewer = document.querySelector(".document-viewer")
    assert.equal(viewer.contains(menu), false, "the menu must render OUTSIDE .document-viewer, not nested inside it (it has contain: layout paint)")

    const addToChat = menu.querySelector(".pop-item")
    assert.ok(addToChat, "the 'Add to chat' menu item must render")
    addToChat.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))

    assert.equal(state.promptDraft, "[app.js:2-4](src/app.js) ")
    assert.equal(window.getSelection().rangeCount, 0, "the text selection must be cleared after inserting the snippet token")

    await Promise.resolve()
    assert.ok(!document.querySelector(".mini-context-menu"), "the menu must close again after insertion")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.hljs = previousHljs
  }
})

test("DocumentViewer.svelte: the snippet context menu never appears outside the code tab (e.g. markdown preview)", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousMarked = global.marked
  global.marked = {
    Renderer: class Renderer {},
    parse(text) { return `<p>${text}</p>` }
  }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    document: state.document
  }

  try {
    const project = { id: "proj_snippet_md", name: "Snippet Markdown Project", path: "/tmp/snippet-md" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_snippet_md",
      sessionsByProject: { [project.id]: [{ id: "sess_snippet_md", directory: project.path }] },
      threads: new Map([["sess_snippet_md", { sessionId: "sess_snippet_md", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      document: {
        requestedPath: "docs/guide.md",
        path: "docs/guide.md",
        name: "guide.md",
        relativePath: "docs/guide.md",
        content: "# Heading\n\nSome body text here.",
        loading: false,
        error: "",
        renderMode: "markdown"
      }
    })
    render()
    await Promise.resolve()

    assert.ok(!document.querySelector(".doc-code"), "no code <pre> renders for the markdown preview")
    const docBody = document.querySelector(".doc-content")
    assert.ok(docBody, "the markdown body must render")

    const range = document.createRange()
    range.selectNodeContents(docBody)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    docBody.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 60 }))
    await Promise.resolve()

    assert.ok(!document.querySelector(".mini-context-menu"), "the snippet menu must never appear outside the code tab")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.marked = previousMarked
  }
})

test("DocumentViewer.svelte: the code tab shows a line-number gutter matching doc.content, absent for markdown", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousHljs = global.hljs
  global.hljs = { getLanguage() { return false } }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    document: state.document
  }

  try {
    const project = { id: "proj_gutter", name: "Gutter Project", path: "/tmp/gutter" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_gutter",
      sessionsByProject: { [project.id]: [{ id: "sess_gutter", directory: project.path }] },
      threads: new Map([["sess_gutter", { sessionId: "sess_gutter", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      document: {
        requestedPath: "src/app.js",
        path: "src/app.js",
        name: "app.js",
        relativePath: "src/app.js",
        content: "line one\nline two\nline three\nline four\nline five",
        loading: false,
        error: "",
        renderMode: "code"
      }
    })
    render()

    const gutter = document.querySelector(".doc-code-gutter")
    assert.ok(gutter, "the code tab must render a line-number gutter")
    assert.equal(gutter.textContent, "1\n2\n3\n4\n5", "the gutter must list exactly one number per source line")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.hljs = previousHljs
  }
})

test("DocumentViewer.svelte: the line-number gutter never appears outside the code tab (e.g. markdown preview)", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousMarked = global.marked
  global.marked = {
    Renderer: class Renderer {},
    parse(text) { return `<p>${text}</p>` }
  }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    document: state.document
  }

  try {
    const project = { id: "proj_gutter_md", name: "Gutter Markdown Project", path: "/tmp/gutter-md" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_gutter_md",
      sessionsByProject: { [project.id]: [{ id: "sess_gutter_md", directory: project.path }] },
      threads: new Map([["sess_gutter_md", { sessionId: "sess_gutter_md", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      document: {
        requestedPath: "docs/guide.md",
        path: "docs/guide.md",
        name: "guide.md",
        relativePath: "docs/guide.md",
        content: "# Heading\n\nSome body text here.",
        loading: false,
        error: "",
        renderMode: "markdown"
      }
    })
    render()

    assert.ok(!document.querySelector(".doc-code-gutter"), "the line-number gutter must never appear outside the code tab")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.marked = previousMarked
  }
})

test("DocumentViewer.svelte: Cmd/Ctrl+F opens in-file search on the code tab; typing does not search until Enter, next/prev navigate, Escape closes", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousHljs = global.hljs
  global.hljs = { getLanguage() { return false } }
  // jsdom has neither CSS.highlights nor the Highlight constructor (Chromium-only) - stub both
  // with an in-memory Map so the component's calls succeed and are inspectable, without real painting.
  const previousCSS = window.CSS
  const previousHighlight = window.Highlight
  const highlightStore = new Map()
  window.CSS = { highlights: { set: (key, h) => highlightStore.set(key, h), delete: (key) => highlightStore.delete(key) } }
  window.Highlight = class FakeHighlight { constructor(...ranges) { this.ranges = ranges } }
  // .doc-scroll has no real layout in jsdom (0-height rect), so revealCurrentMatch always falls
  // back to scrollIntoView - stub it so that fallback doesn't throw (see the 25%-75% band test).
  const previousScrollIntoView = window.HTMLElement.prototype.scrollIntoView
  window.HTMLElement.prototype.scrollIntoView = function () {}

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    document: state.document
  }

  try {
    const project = { id: "proj_search", name: "Search Project", path: "/tmp/search" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_search",
      sessionsByProject: { [project.id]: [{ id: "sess_search", directory: project.path }] },
      threads: new Map([["sess_search", { sessionId: "sess_search", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      document: {
        requestedPath: "src/app.js",
        path: "src/app.js",
        name: "app.js",
        relativePath: "src/app.js",
        content: "foo bar\nfoo baz\nfoo qux",
        loading: false,
        error: "",
        renderMode: "code"
      }
    })
    render()

    assert.ok(!document.querySelector(".doc-search-bar"), "search must start closed")

    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true }))
    await Promise.resolve()

    const searchInput = document.querySelector(".doc-search-input")
    assert.ok(searchInput, "Cmd+F must open the search bar on the code tab")
    assert.equal(document.querySelector(".doc-search-count").textContent, "0/0", "no query yet - counter reads 0/0")

    searchInput.value = "foo"
    searchInput.dispatchEvent(new window.Event("input", { bubbles: true }))
    await Promise.resolve()

    assert.equal(document.querySelector(".doc-search-count").textContent, "0/0", "typing alone must not search - avoids stalling on large files")
    assert.equal(highlightStore.size, 0, "no highlights until the debounced search actually runs")

    // First Enter has no searched-yet results for this query, so it runs the search immediately
    // instead of waiting out the rest of the debounce.
    searchInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    await Promise.resolve()
    assert.equal(document.querySelector(".doc-search-count").textContent, "1/3", "Enter on an un-searched query runs the search and lands on the first match")
    assert.equal(highlightStore.get("doc-search-match")?.ranges.length, 3, "all matches must be registered on the 'match' highlight")
    assert.equal(highlightStore.get("doc-search-current")?.ranges[0].toString(), "foo", "the current-match highlight must wrap the first occurrence")

    // Second Enter is for an already-searched query, so it navigates instead of re-searching.
    searchInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    await Promise.resolve()
    assert.equal(document.querySelector(".doc-search-count").textContent, "2/3", "Enter must advance to the next match")

    searchInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }))
    await Promise.resolve()
    assert.equal(document.querySelector(".doc-search-count").textContent, "1/3", "Shift+Enter must go back to the previous match")

    searchInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    await Promise.resolve()
    assert.ok(!document.querySelector(".doc-search-bar"), "Escape must close the search bar")
    assert.equal(highlightStore.size, 0, "closing search must clear both custom highlights")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.hljs = previousHljs
    window.CSS = previousCSS
    window.Highlight = previousHighlight
    window.HTMLElement.prototype.scrollIntoView = previousScrollIntoView
  }
})

test("DocumentViewer.svelte: in-file search auto-runs once the user has been idle for 1s, without pressing Enter, and re-debounces on further typing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousHljs = global.hljs
  global.hljs = { getLanguage() { return false } }
  const previousCSS = window.CSS
  const previousHighlight = window.Highlight
  const highlightStore = new Map()
  window.CSS = { highlights: { set: (key, h) => highlightStore.set(key, h), delete: (key) => highlightStore.delete(key) } }
  window.Highlight = class FakeHighlight { constructor(...ranges) { this.ranges = ranges } }
  // .doc-scroll has no real layout in jsdom (0-height rect), so revealCurrentMatch always falls
  // back to scrollIntoView - stub it so that fallback doesn't throw.
  const previousScrollIntoView = window.HTMLElement.prototype.scrollIntoView
  window.HTMLElement.prototype.scrollIntoView = function () {}

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    document: state.document
  }

  try {
    const project = { id: "proj_search_debounce", name: "Search Debounce Project", path: "/tmp/search_debounce" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_search_debounce",
      sessionsByProject: { [project.id]: [{ id: "sess_search_debounce", directory: project.path }] },
      threads: new Map([["sess_search_debounce", { sessionId: "sess_search_debounce", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      document: {
        requestedPath: "src/app.js",
        path: "src/app.js",
        name: "app.js",
        relativePath: "src/app.js",
        content: "foo bar\nfoo baz\nfoo qux",
        loading: false,
        error: "",
        renderMode: "code"
      }
    })
    render()

    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true }))
    await Promise.resolve()

    const searchInput = document.querySelector(".doc-search-input")
    searchInput.value = "foo"
    searchInput.dispatchEvent(new window.Event("input", { bubbles: true }))
    await Promise.resolve()
    assert.equal(document.querySelector(".doc-search-count").textContent, "0/0", "no search immediately after typing")

    t.mock.timers.tick(999)
    await Promise.resolve()
    assert.equal(document.querySelector(".doc-search-count").textContent, "0/0", "still nothing just under the 1s idle threshold")

    // Typing again before the timer fires must push the search out another 1s rather than letting
    // the original timer land on a now-stale query.
    searchInput.value = "baz"
    searchInput.dispatchEvent(new window.Event("input", { bubbles: true }))
    await Promise.resolve()
    t.mock.timers.tick(999)
    await Promise.resolve()
    assert.equal(document.querySelector(".doc-search-count").textContent, "0/0", "typing again resets the 1s debounce window")

    t.mock.timers.tick(1)
    await Promise.resolve()
    assert.equal(document.querySelector(".doc-search-count").textContent, "1/1", "search runs on its own for the latest query once idle for 1s")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.hljs = previousHljs
    window.CSS = previousCSS
    window.Highlight = previousHighlight
    window.HTMLElement.prototype.scrollIntoView = previousScrollIntoView
  }
})

test("DocumentViewer.svelte: in-file search auto-scrolls the current match only on the axis where it isn't already visible (vertical 25%-75% band, horizontal plain visibility)", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousHljs = global.hljs
  global.hljs = { getLanguage() { return false } }
  const previousCSS = window.CSS
  const previousHighlight = window.Highlight
  const highlightStore = new Map()
  window.CSS = { highlights: { set: (key, h) => highlightStore.set(key, h), delete: (key) => highlightStore.delete(key) } }
  window.Highlight = class FakeHighlight { constructor(...ranges) { this.ranges = ranges } }

  // jsdom's getBoundingClientRect() is 0-height and Range has none at all - stub both so the
  // reveal logic can be driven deterministically instead of always hitting the "can't measure" fallback.
  const previousElementRect = window.HTMLElement.prototype.getBoundingClientRect
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 0, bottom: 400, height: 400, left: 0, right: 300, width: 300 }
  }
  const previousRangeRect = window.Range.prototype.getBoundingClientRect
  let matchTop = 0
  let matchLeft = 0
  const matchWidth = 50
  window.Range.prototype.getBoundingClientRect = function () {
    return { top: matchTop, bottom: matchTop + 14, height: 14, left: matchLeft, right: matchLeft + matchWidth, width: matchWidth }
  }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    document: state.document
  }

  try {
    const project = { id: "proj_search_scroll", name: "Search Scroll Project", path: "/tmp/search_scroll" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_search_scroll",
      sessionsByProject: { [project.id]: [{ id: "sess_search_scroll", directory: project.path }] },
      threads: new Map([["sess_search_scroll", { sessionId: "sess_search_scroll", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      document: {
        requestedPath: "src/app.js",
        path: "src/app.js",
        name: "app.js",
        relativePath: "src/app.js",
        content: "foo bar\nfoo baz\nfoo qux",
        loading: false,
        error: "",
        renderMode: "code"
      }
    })
    render()

    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true }))
    await Promise.resolve()

    const searchInput = document.querySelector(".doc-search-input")
    // .doc-scroll owns vertical scrolling; horizontally, the hljs theme puts overflow-x on
    // <code class="hljs"> itself, not its .doc-code <pre> parent.
    const verticalContainer = document.querySelector(".doc-scroll")
    const horizontalContainer = document.querySelector(".doc-code code")

    searchInput.value = "foo"
    matchTop = 200 // inside the vertical 25%-75% band (100-300 of a 400px-tall panel)
    matchLeft = 50 // fully inside the horizontal view (0-300)
    searchInput.dispatchEvent(new window.Event("input", { bubbles: true }))
    await Promise.resolve()
    verticalContainer.scrollTop = 0
    horizontalContainer.scrollLeft = 0
    searchInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    await Promise.resolve()
    assert.equal(document.querySelector(".doc-search-count").textContent, "1/3", "Enter on an un-searched query runs the search")
    assert.equal(verticalContainer.scrollTop, 0, "already inside the vertical band - must not jump vertically")
    assert.equal(horizontalContainer.scrollLeft, 0, "already inside the horizontal view - must not jump horizontally")

    matchTop = 350 // below the vertical band
    matchLeft = 50 // still fully visible horizontally
    verticalContainer.scrollTop = 0
    horizontalContainer.scrollLeft = 0
    searchInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    await Promise.resolve()
    assert.equal(document.querySelector(".doc-search-count").textContent, "2/3")
    assert.ok(verticalContainer.scrollTop > 0, "a match below the band must jump down")
    assert.equal(horizontalContainer.scrollLeft, 0, "still fully visible horizontally - no horizontal jump")

    matchTop = 200 // back inside the vertical band
    matchLeft = 350 // cut off past the right edge (container right = 300)
    verticalContainer.scrollTop = 0
    horizontalContainer.scrollLeft = 0
    searchInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    await Promise.resolve()
    assert.equal(document.querySelector(".doc-search-count").textContent, "3/3")
    assert.equal(verticalContainer.scrollTop, 0, "inside the vertical band - no vertical jump")
    assert.ok(horizontalContainer.scrollLeft > 0, "cut off on the right edge - must jump right, regardless of the vertical band")

    matchTop = 50 // above the vertical band
    matchLeft = -80 // cut off past the left edge
    verticalContainer.scrollTop = 0
    horizontalContainer.scrollLeft = 0
    searchInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    await Promise.resolve()
    assert.equal(document.querySelector(".doc-search-count").textContent, "1/3", "wraps back to the first match")
    assert.ok(verticalContainer.scrollTop < 0, "a match above the band must jump up")
    assert.ok(horizontalContainer.scrollLeft < 0, "cut off on the left edge - must jump left, independently of the vertical jump")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.hljs = previousHljs
    window.CSS = previousCSS
    window.Highlight = previousHighlight
    window.HTMLElement.prototype.getBoundingClientRect = previousElementRect
    if (previousRangeRect) window.Range.prototype.getBoundingClientRect = previousRangeRect
    else delete window.Range.prototype.getBoundingClientRect
  }
})

test("DocumentViewer.svelte: Cmd/Ctrl+F does not open search outside the code tab (e.g. markdown preview)", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousMarked = global.marked
  global.marked = {
    Renderer: class Renderer {},
    parse(text) { return `<p>${text}</p>` }
  }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    document: state.document
  }

  try {
    const project = { id: "proj_search_md", name: "Search Markdown Project", path: "/tmp/search-md" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_search_md",
      sessionsByProject: { [project.id]: [{ id: "sess_search_md", directory: project.path }] },
      threads: new Map([["sess_search_md", { sessionId: "sess_search_md", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      document: {
        requestedPath: "docs/guide.md",
        path: "docs/guide.md",
        name: "guide.md",
        relativePath: "docs/guide.md",
        content: "# Heading\n\nSome body text here.",
        loading: false,
        error: "",
        renderMode: "markdown"
      }
    })
    render()

    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true }))
    await Promise.resolve()

    assert.ok(!document.querySelector(".doc-search-bar"), "Cmd+F must not open search while viewing the markdown preview")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.marked = previousMarked
  }
})

test("DocumentViewer.svelte: markdown Preview/Raw toggle always shows (no diff needed); Raw gets line numbers and the snippet context menu", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousMarked = global.marked
  global.marked = {
    Renderer: class Renderer {},
    parse(text) { return `<p>${text}</p>` }
  }
  const previousHljs = global.hljs
  global.hljs = { getLanguage() { return false } }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    pendingFileMentions: state.pendingFileMentions,
    document: state.document
  }

  try {
    const project = { id: "proj_md_toggle", name: "MD Toggle Project", path: "/tmp/md-toggle" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_md_toggle",
      sessionsByProject: { [project.id]: [{ id: "sess_md_toggle", directory: project.path }] },
      threads: new Map([["sess_md_toggle", { sessionId: "sess_md_toggle", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      promptDraft: "",
      pendingFileMentions: [],
      document: {
        requestedPath: "docs/guide.md",
        path: "docs/guide.md",
        name: "guide.md",
        relativePath: "docs/guide.md",
        content: "line one\nline two\nline three",
        loading: false,
        error: "",
        renderMode: "markdown"
      }
    })
    render()

    // No git diff on this document - the old behavior showed no tab strip at all here.
    const previewBtn = document.querySelector('[data-md-view="preview"]')
    const rawBtn = document.querySelector('[data-md-view="raw"]')
    assert.ok(previewBtn && rawBtn, "Preview/Raw must render for a markdown document even without a diff")
    assert.equal(previewBtn.getAttribute("aria-selected"), "true", "a freshly-opened markdown document defaults to Preview")
    assert.ok(document.querySelector(".doc-content"), "Preview must render the rendered HTML body")
    assert.ok(!document.querySelector(".doc-code"), "no raw <pre> while in Preview")

    rawBtn.click()
    await Promise.resolve()

    assert.equal(rawBtn.getAttribute("aria-selected"), "true", "Raw must become the selected tab")
    assert.ok(!document.querySelector(".doc-content"), "Preview body must not render while in Raw")
    const gutter = document.querySelector(".doc-code-gutter")
    assert.ok(gutter, "Raw must render the line-number gutter, exactly like a regular code file")
    assert.equal(gutter.textContent, "1\n2\n3", "gutter must match the markdown source's own line count")

    // Snippet-to-chat, which only ever activates for body.kind === 'code', must now work here too.
    const pre = document.querySelector(".doc-code")
    const textNode = [...pre.querySelector("code").childNodes].find((node) => node.nodeType === window.Node.TEXT_NODE)
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, textNode.textContent.indexOf("two") + 3)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    pre.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }))
    await Promise.resolve()
    const menu = document.querySelector(".mini-context-menu")
    assert.ok(menu, "right-clicking a selection in Raw markdown must open the snippet 'Add to chat' menu")
    menu.querySelector(".pop-item").dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
    assert.equal(state.promptDraft, "[guide.md:1-2](docs/guide.md) ", "the snippet token must reference the real .md path")

    previewBtn.click()
    await Promise.resolve()
    assert.equal(previewBtn.getAttribute("aria-selected"), "true", "clicking Preview must switch back")
    assert.ok(document.querySelector(".doc-content"), "Preview body must render again")
    assert.ok(!document.querySelector(".doc-code"), "Raw body must be gone once back in Preview")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.marked = previousMarked
    global.hljs = previousHljs
  }
})

test("DocumentViewer.svelte: a markdown document with a diff shows Diff + Preview + Raw together, Diff independent of mdView", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousMarked = global.marked
  global.marked = {
    Renderer: class Renderer {},
    parse(text) { return `<p>${text}</p>` }
  }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    document: state.document
  }

  try {
    const project = { id: "proj_md_diff", name: "MD Diff Project", path: "/tmp/md-diff" }
    // tab defaults to "code" (not "diff") on purpose: the suite-wide OpenWorkingDiffView mock
    // always returns null from parseUnifiedDiff, and rendering the actual diff body crashes on
    // that unrelated pre-existing gap. This test only needs hasDiff for the Diff button to render.
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_md_diff",
      sessionsByProject: { [project.id]: [{ id: "sess_md_diff", directory: project.path }] },
      threads: new Map([["sess_md_diff", { sessionId: "sess_md_diff", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      document: {
        requestedPath: "docs/guide.md",
        path: "docs/guide.md",
        name: "guide.md",
        relativePath: "docs/guide.md",
        content: "line one\nline two",
        diff: "@@ -1,1 +1,1 @@\n-old\n+new",
        tab: "code",
        loading: false,
        error: "",
        renderMode: "markdown"
      }
    })
    render()

    assert.ok(document.querySelector('[data-doc-tab="diff"]'), "Diff tab must render alongside Preview/Raw, not replace them")
    assert.ok(document.querySelector('[data-md-view="preview"]'), "Preview tab must still render")
    assert.ok(document.querySelector('[data-md-view="raw"]'), "Raw tab must still render")
    assert.ok(document.querySelector(".doc-content"), "defaults to Preview even with a diff present")

    document.querySelector('[data-md-view="raw"]').click()
    await Promise.resolve()
    assert.ok(document.querySelector(".doc-code-gutter"), "Raw must take effect even though the document also has a diff")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.marked = previousMarked
  }
})

test("DocumentViewer.svelte: switching to Raw on one markdown file does not carry over to the next one opened", async () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const previousMarked = global.marked
  global.marked = {
    Renderer: class Renderer {},
    parse(text) { return `<p>${text}</p>` }
  }

  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    document: state.document
  }

  try {
    const project = { id: "proj_md_fresh", name: "MD Fresh Project", path: "/tmp/md-fresh" }
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_md_fresh",
      sessionsByProject: { [project.id]: [{ id: "sess_md_fresh", directory: project.path }] },
      threads: new Map([["sess_md_fresh", { sessionId: "sess_md_fresh", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      document: {
        requestedPath: "docs/one.md",
        path: "docs/one.md",
        name: "one.md",
        relativePath: "docs/one.md",
        content: "first file",
        loading: false,
        error: "",
        renderMode: "markdown"
      }
    })
    render()

    document.querySelector('[data-md-view="raw"]').click()
    await Promise.resolve()
    assert.ok(document.querySelector(".doc-code-gutter"), "first document is now in Raw")

    // A brand new document object - as if the user opened a different .md file - carries no mdView.
    state.document = {
      requestedPath: "docs/two.md",
      path: "docs/two.md",
      name: "two.md",
      relativePath: "docs/two.md",
      content: "second file",
      loading: false,
      error: "",
      renderMode: "markdown"
    }
    render()

    assert.ok(document.querySelector(".doc-content"), "a newly-opened markdown document must default back to Preview")
    assert.ok(!document.querySelector(".doc-code-gutter"), "Raw must not carry over from the previously-viewed file")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.marked = previousMarked
  }
})

test("full render preserves sidebar scroll while rebuilding #root", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
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
    __test.renderCounters.reset()
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
    const sideScroll = document.querySelector(".side-scroll")
    assert.ok(sideScroll, "sidebar must be mounted")
    sideScroll.scrollTop = 360
    __test.renderCounters.reset()
    render()
    assert.equal(document.querySelector(".side-scroll").scrollTop, 360, "full render must preserve sidebar scroll")
    assert.equal(__test.renderCounters.snapshot().full, 1)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("storedThemeMode defaults to system for missing/unknown/corrupt values", () => {
  const previousStorage = global.localStorage
  try {
    global.localStorage = backedLocalStorage()
    assert.equal(__test.storedThemeMode(), "system", "missing → system")
    global.localStorage = backedLocalStorage({ "openworking:theme": "purple" })
    assert.equal(__test.storedThemeMode(), "system", "unknown → system")
    global.localStorage = backedLocalStorage({ "openworking:theme": "light" })
    assert.equal(__test.storedThemeMode(), "light", "valid value is preserved")
    global.localStorage = backedLocalStorage({ "openworking:theme": "dark" })
    assert.equal(__test.storedThemeMode(), "dark")
  } finally {
    global.localStorage = previousStorage
  }
})

test("resolveTheme returns the fixed palette for light/dark and never system", () => {
  assert.equal(__test.resolveTheme("light"), "light")
  assert.equal(__test.resolveTheme("dark"), "dark")
  // With no matchMedia in the test harness, system resolves to the light fallback.
  assert.equal(__test.resolveTheme("system"), "light")
})

test("setThemeMode persists the choice and updates state, coercing junk to system", () => {
  const previousStorage = global.localStorage
  const previousMode = __test.state.themeMode
  try {
    const storage = backedLocalStorage()
    global.localStorage = storage
    __test.setThemeMode("dark")
    assert.equal(__test.state.themeMode, "dark")
    assert.equal(storage.getItem("openworking:theme"), "dark")
    __test.setThemeMode("nonsense")
    assert.equal(__test.state.themeMode, "system", "unknown modes fall back to system")
    assert.equal(storage.getItem("openworking:theme"), "system")
  } finally {
    __test.state.themeMode = previousMode
    global.localStorage = previousStorage
  }
})

test("Personalization settings render Default IDE rows + Appearance toggle, both wired", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const { dispatchDelegated, getDelegatedClick, render, state } = __test
  const previousState = {
    nav: state.nav,
    settingsSection: state.settingsSection,
    config: state.config,
    themeMode: state.themeMode
  }
  const root = document.getElementById("root")
  global.requestAnimationFrame = (callback) => { callback(); return 1 }

  try {
    state.nav = "settings"
    state.settingsSection = "personalization"
    state.config = { personalization: { defaultIde: "cursor" } }
    state.themeMode = "dark"

    render()

    // Default IDE: cursor (from state.config.personalization.defaultIde) is the active row.
    assert.match(root.innerHTML, /<button class="option-row active" data-personalization-field="defaultIde" data-personalization-value="cursor"/)
    assert.match(root.innerHTML, /<button class="option-row " data-personalization-field="defaultIde" data-personalization-value="vscode"/)
    // Appearance: segmented toggle (icon-only), dark (state.themeMode) is active, still using
    // data-theme-mode — same handler as before the Elegant List redesign.
    assert.match(root.innerHTML, /<button\s+class="theme-seg-btn active"\s+role="radio"\s+aria-checked="true"\s+title="Dark"\s+aria-label="Dark"\s+data-theme-mode="dark"/)
    assert.match(root.innerHTML, /<button\s+class="theme-seg-btn "\s+role="radio"\s+aria-checked="false"\s+title="Light"\s+aria-label="Light"\s+data-theme-mode="light"/)

    // Advanced no longer renders Appearance — it moved to Personalization.
    state.settingsSection = "advanced"
    render()
    assert.doesNotMatch(root.innerHTML, /data-theme-mode/)
    assert.doesNotMatch(root.innerHTML, /Appearance/)

    // The relocated rows still drive the pre-existing data-theme-mode handler unchanged.
    state.settingsSection = "personalization"
    render()
    dispatchDelegated(fakeDelegatedEvent({ "data-theme-mode": "light" }), getDelegatedClick())
    assert.equal(state.themeMode, "light")
    assert.match(root.innerHTML, /<button\s+class="theme-seg-btn active"\s+role="radio"\s+aria-checked="true"\s+title="Light"\s+aria-label="Light"\s+data-theme-mode="light"/)
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("storedDefaultIde defaults to system for missing values and preserves a stored one", () => {
  const previousStorage = global.localStorage
  try {
    global.localStorage = backedLocalStorage()
    assert.equal(__test.storedDefaultIde(), "system", "missing → system")
    global.localStorage = backedLocalStorage({ "openworking:defaultIde": "vscode" })
    assert.equal(__test.storedDefaultIde(), "vscode", "valid value is preserved")
  } finally {
    global.localStorage = previousStorage
  }
})

test("clicking a Default IDE row persists to localStorage, not config:save", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousStorage = global.localStorage
  const { dispatchDelegated, getDelegatedClick, render, state } = __test
  const previousState = {
    nav: state.nav,
    settingsSection: state.settingsSection,
    config: state.config
  }
  const root = document.getElementById("root")
  const storage = backedLocalStorage()
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.localStorage = storage

  try {
    state.nav = "settings"
    state.settingsSection = "personalization"
    state.config = { personalization: { defaultIde: "system" } }

    render()
    dispatchDelegated(
      fakeDelegatedEvent({ "data-personalization-field": "defaultIde", "data-personalization-value": "vscode" }),
      getDelegatedClick()
    )
    assert.equal(state.config.personalization.defaultIde, "vscode")
    assert.match(root.innerHTML, /<button class="option-row active" data-personalization-field="defaultIde" data-personalization-value="vscode"/)
    assert.equal(storage.getItem("openworking:defaultIde"), "vscode")
  } finally {
    Object.assign(state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
    global.localStorage = previousStorage
  }
})

test("new session renders themed logos, headline, suggestions, then the docked composer", () => {
  const { renderNewSession, state } = __test
  const previous = {
    projects: state.projects,
    popover: state.popover,
    gitInfoByProject: state.gitInfoByProject,
    composerPlaceholder: state.composerPlaceholder
  }
  const project = { id: "proj_new", name: "New Project", path: "/repo/new" }
  state.projects = [project, { id: "proj_other", name: "Other Project", path: "/repo/other" }]
  state.popover = "project"
  state.gitInfoByProject = new Map([[project.id, { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }]])
  try {
    const html = renderNewSession(project)
    const logoIndex = html.indexOf("new-session-logo")
    const headingIndex = html.indexOf("What should we do today?")
    const suggestionsIndex = html.indexOf("suggestion-grid")
    const composerIndex = html.indexOf("new-session-composer-dock")

    assert.match(html, /\.\/assets\/logo_dark\.png/)
    assert.match(html, /\.\/assets\/logo_white\.png/)
    assert.ok(logoIndex < headingIndex)
    assert.ok(headingIndex < suggestionsIndex)
    assert.ok(suggestionsIndex < composerIndex)
    assert.equal((html.match(/class="suggestion-card"/g) || []).length, 4)
    assert.match(html, /Dịch file sang tiếng Việt, giữ nguyên cấu trúc và định dạng\./)
    assert.match(html, /project-selector-control/)
    assert.match(html, /placeholder="Search projects"/)
    assert.match(html, /project-selector-item active[^>]+data-new-session-project="proj_new"/)
    assert.match(html, /data-new-session-project="proj_other"/)
    assert.match(html, /data-action="addProjectFromComposer"/)
    // The contenteditable itself is now a Svelte-owned host (#promptEditorRoot, see
    // PromptEditor.svelte); renderComposer() sets state.composerPlaceholder as a side effect
    // for the mounted component to read, rather than baking the text into this HTML string.
    assert.match(html, /<div id="promptEditorRoot">/)
    assert.equal(state.composerPlaceholder, "Describe a task for New Project...")
  } finally {
    Object.assign(state, previous)
  }
})

test("existing-session composer stays unchanged and does not show the project selector", () => {
  const { renderComposer, state } = __test
  const previousGit = state.gitInfoByProject
  const project = { id: "proj_chat", name: "Chat Project", path: "/repo/chat" }
  state.gitInfoByProject = new Map([[project.id, { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }]])
  try {
    const previousPlaceholder = state.composerPlaceholder
    const html = renderComposer(project, true)
    assert.equal(state.composerPlaceholder, "Reply to Chat Project...")
    assert.doesNotMatch(html, /project-selector-control/)
    state.composerPlaceholder = previousPlaceholder
  } finally {
    state.gitInfoByProject = previousGit
  }
})

test("busy composer keeps Stop, Queue and explicit Steer as independent actions", () => {
  const { renderComposer, state } = __test
  const project = { id: "proj_busy", name: "Busy Project", path: "/repo/busy" }
  const previous = {
    activeSessionId: state.activeSessionId,
    threads: state.threads,
    promptDraft: state.promptDraft,
    popover: state.popover,
    gitInfoByProject: state.gitInfoByProject,
    runtime: state.runtime
  }
  try {
    state.activeSessionId = "sess_busy"
    state.threads = new Map([["sess_busy", {
      sessionId: "sess_busy",
      messages: [],
      pendingQuestions: [],
      pendingPermissions: [],
      status: { type: "busy" }
    }]])
    state.promptDraft = "Follow up"
    state.popover = "delivery"
    state.gitInfoByProject = new Map([[project.id, { isGitRepo: false }]])
    state.runtime = { status: "running", project, sessionStatuses: { sess_busy: { type: "busy" } } }

    const html = renderComposer(project, true)
    assert.match(html, /class="send-stop "/)
    assert.match(html, /data-action="abortSession"/)
    assert.match(html, /class="send [^"]*" data-action="sendPrompt" title="Queue prompt"/)
    assert.match(html, /class="send-menu "/)
    assert.match(html, /data-action="steerPrompt"/)
    assert.match(html, /Queue after current run/)
    assert.match(html, /Steer current run/)
  } finally {
    Object.assign(state, previous)
  }
})

test("suggestion click fills the draft without sending a prompt", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousState = {
    projects: __test.state.projects,
    activeProjectId: __test.state.activeProjectId,
    activeSessionId: __test.state.activeSessionId,
    promptDraft: __test.state.promptDraft,
    gitInfoByProject: __test.state.gitInfoByProject
  }
  const project = { id: "proj_suggestion", name: "Suggestion Project", path: "/repo/suggestion" }
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  Object.assign(__test.state, {
    projects: [project],
    activeProjectId: project.id,
    activeSessionId: null,
    promptDraft: "",
    gitInfoByProject: new Map([[project.id, { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }]])
  })
  try {
    __test.fillSuggestion(0)
    assert.equal(__test.state.promptDraft, "Dịch file sang tiếng Việt, giữ nguyên cấu trúc và định dạng.")
    assert.equal(__test.state.activeSessionId, null)
  } finally {
    Object.assign(__test.state, previousState)
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("new session project search filters by project name and path", () => {
  const previousQuery = __test.state.newSessionProjectQuery
  const items = [
    { dataset: { projectSearch: "desktop-client /repos/desktop-client" }, hidden: false },
    { dataset: { projectSearch: "backend /work/services/api" }, hidden: false }
  ]
  const empty = { hidden: true }
  const previousDocument = global.document
  global.document = {
    querySelector(selector) {
      if (selector === ".project-selector-list") return { querySelectorAll: () => items }
      if (selector === ".project-selector-empty") return empty
      return null
    }
  }
  try {
    __test.state.newSessionProjectQuery = "SERVICES/API"
    __test.filterNewSessionProjectsDom()
    assert.equal(items[0].hidden, true)
    assert.equal(items[1].hidden, false)
    assert.equal(empty.hidden, true)

    __test.state.newSessionProjectQuery = "missing"
    __test.filterNewSessionProjectsDom()
    assert.equal(empty.hidden, false)
  } finally {
    __test.state.newSessionProjectQuery = previousQuery
    global.document = previousDocument
  }
})

test("selecting the current New session project closes the popover without restarting runtime", async () => {
  const previousOpenworking = global.window.openworking
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const previousState = {
    projects: __test.state.projects,
    activeProjectId: __test.state.activeProjectId,
    activeSessionId: __test.state.activeSessionId,
    popover: __test.state.popover,
    gitInfoByProject: __test.state.gitInfoByProject
  }
  const project = { id: "proj_same", name: "Same Project", path: "/repo/same" }
  let openCalls = 0
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.window.openworking = { runtime: { openProject: async () => { openCalls++; return {} } } }
  Object.assign(__test.state, {
    projects: [project],
    activeProjectId: project.id,
    activeSessionId: null,
    popover: "project",
    gitInfoByProject: new Map([[project.id, { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }]])
  })
  try {
    await __test.switchNewSessionProject(project.id)
    assert.equal(openCalls, 0)
    assert.equal(__test.state.popover, null)
  } finally {
    Object.assign(__test.state, previousState)
    global.window.openworking = previousOpenworking
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("switching the New session project keeps ordinary draft text and removes project file context", async () => {
  const previousOpenworking = global.window.openworking
  const previousRequestAnimationFrame = global.requestAnimationFrame
  const state = __test.state
  const previousState = {
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    promptDraft: state.promptDraft,
    pendingAttachments: state.pendingAttachments,
    pendingFileMentions: state.pendingFileMentions,
    runtime: state.runtime,
    gitInfoByProject: state.gitInfoByProject,
    gitInfoLoading: state.gitInfoLoading,
    expanded: state.expanded,
    loading: state.loading
  }
  const oldProject = { id: "proj_old", name: "Old", path: "/repo/old" }
  const nextProject = { id: "proj_next", name: "Next", path: "/repo/next" }
  const discarded = []
  const opened = []
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  global.window.openworking = {
    attachments: { discard: async (ids) => { discarded.push(...ids) } },
    git: { info: async () => ({ isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }) },
    runtime: {
      openProject: async (project) => { opened.push(project.id); return { status: "running", project } },
      listCommands: async () => [],
      listSessions: async () => [],
      listSessionsForDirectory: async () => []
    }
  }
  Object.assign(state, {
    projects: [oldProject, nextProject],
    activeProjectId: oldProject.id,
    activeSessionId: null,
    sessionsByProject: {},
    threads: new Map(),
    promptDraft: "Review [old.js](/repo/old/old.js) @old.js and keep this text",
    pendingAttachments: [{ id: "att_old", name: "old.js" }],
    pendingFileMentions: [{ token: "@old.js", path: "/repo/old/old.js" }],
    runtime: { status: "running", project: oldProject },
    gitInfoByProject: new Map(),
    gitInfoLoading: new Set(),
    expanded: new Set(),
    loading: false
  })
  try {
    await __test.switchNewSessionProject(nextProject.id)
    assert.deepEqual(opened, [nextProject.id])
    assert.deepEqual(discarded, ["att_old"])
    assert.equal(state.activeProjectId, nextProject.id)
    assert.equal(state.activeSessionId, null)
    assert.equal(state.promptDraft, "Review and keep this text")
    assert.deepEqual(state.pendingAttachments, [])
    assert.deepEqual(state.pendingFileMentions, [])
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

// Helper: seed the per-project git cache for one project id and restore afterward.
function withGitInfo(projectId, info, fn) {
  const prevMap = __test.state.gitInfoByProject
  const prevPopover = __test.state.popover
  __test.state.gitInfoByProject = new Map(info === undefined ? [] : [[projectId, info]])
  try {
    return fn()
  } finally {
    __test.state.gitInfoByProject = prevMap
    __test.state.popover = prevPopover
  }
}

test("renderGitControl renders nothing when the project's git info has not loaded", () => {
  // Empty cache: no window.openworking here, so the lazy load is a no-op and it just renders "".
  withGitInfo("proj_x", undefined, () => {
    assert.equal(__test.renderGitControl({ id: "proj_x" }), "")
  })
})

test("renderGitControl renders nothing for a non-git project", () => {
  withGitInfo("proj_x", { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }, () => {
    assert.equal(__test.renderGitControl({ id: "proj_x" }), "")
  })
})

test("renderGitControl renders the passed project's git info, never a different project's (keyed cache)", () => {
  const prevMap = __test.state.gitInfoByProject
  const prevPopover = __test.state.popover
  __test.state.gitInfoByProject = new Map([
    ["proj_a", { isGitRepo: true, currentBranch: "branch-a", branches: [{ name: "branch-a", isCurrent: true }], worktrees: [{ path: "/a", branch: "branch-a", isCurrent: true }] }],
    ["proj_b", { isGitRepo: true, currentBranch: "branch-b", branches: [{ name: "branch-b", isCurrent: true }], worktrees: [{ path: "/b", branch: "branch-b", isCurrent: true }] }]
  ])
  __test.state.popover = null
  try {
    assert.match(__test.renderGitControl({ id: "proj_a" }), />branch-a</)
    assert.doesNotMatch(__test.renderGitControl({ id: "proj_a" }), />branch-b</)
    assert.match(__test.renderGitControl({ id: "proj_b" }), />branch-b</)
    assert.doesNotMatch(__test.renderGitControl({ id: "proj_b" }), />branch-a</)
  } finally {
    __test.state.gitInfoByProject = prevMap
    __test.state.popover = prevPopover
  }
})

test("renderGitControl shows the current branch name for a git project", () => {
  withGitInfo("proj_x", {
    isGitRepo: true,
    currentBranch: "main",
    branches: [{ name: "main", isCurrent: true }],
    worktrees: [{ path: "/repo", branch: "main", isCurrent: true }]
  }, () => {
    __test.state.popover = null
    const html = __test.renderGitControl({ id: "proj_x" })
    assert.match(html, /git-branch-control/)
    assert.match(html, /data-popover="git"/)
    assert.match(html, />main</)
    assert.doesNotMatch(html, /git-pop/)
  })
})

test("renderGitControl opens the popover with Worktrees and Branches sections, marking the active row", () => {
  withGitInfo("proj_x", {
    isGitRepo: true,
    currentBranch: "main",
    branches: [
      { name: "main", isCurrent: true },
      { name: "dev", isCurrent: false }
    ],
    worktrees: [
      { path: "/repo", branch: "main", isCurrent: true },
      { path: "/repo-worktrees/feature-x", branch: "feature-x", isCurrent: false }
    ]
  }, () => {
    __test.state.popover = "git"
    const html = __test.renderGitControl({ id: "proj_x" })
    assert.match(html, /<div class="pop-label"><svg[\s\S]*?<\/svg><span>Worktrees<\/span><\/div>/)
    assert.match(html, /<div class="pop-label"><svg[\s\S]*?<\/svg><span>Branches<\/span><\/div>/)
    assert.match(html, /data-git-worktree="\/repo"/)
    assert.match(html, /data-git-worktree="\/repo-worktrees\/feature-x"/)
    assert.match(html, /data-git-branch="main"/)
    assert.match(html, /data-git-branch="dev"/)
    // The active worktree row and active branch row both render the check icon; the inactive ones do not.
    const activeWorktreeRow = html.match(/<button class="pop-item git-pop-item active" data-git-worktree="\/repo"[\s\S]*?<\/button>/)[0]
    const inactiveWorktreeRow = html.match(/<button class="pop-item git-pop-item " data-git-worktree="\/repo-worktrees\/feature-x"[\s\S]*?<\/button>/)[0]
    assert.match(activeWorktreeRow, /<svg/)
    assert.doesNotMatch(inactiveWorktreeRow, /<svg/)
  })
})

test("renderGitPopover shows empty-state copy when there are no worktrees or branches", () => {
  const html = __test.renderGitPopover({ isGitRepo: true, currentBranch: null, branches: [], worktrees: [] })
  assert.match(html, /No worktrees found\./)
  assert.match(html, /No local branches found\./)
})

test("renderGitPopover lays out Worktrees and Branches as two independently-scrolling columns", () => {
  const html = __test.renderGitPopover({
    isGitRepo: true,
    currentBranch: "main",
    branches: [{ name: "main", isCurrent: true }],
    worktrees: [{ path: "/repo", branch: "main", isCurrent: true }]
  })
  const columns = html.match(/<div class="git-pop-col">/g) || []
  assert.equal(columns.length, 2)
  assert.match(html, /<div class="git-pop-col">\s*<div class="pop-label"><svg[\s\S]*?<\/svg><span>Worktrees<\/span><\/div>\s*<div class="git-pop-col-list">/)
  assert.match(html, /<div class="git-pop-col">\s*<div class="pop-label"><svg[\s\S]*?<\/svg><span>Branches<\/span><\/div>\s*<div class="git-pop-col-list">/)
})

test("selectableBranches keeps the active worktree's branch and unclaimed branches, drops branches checked out by other worktrees", () => {
  const gitInfo = {
    currentBranch: "main",
    branches: [
      { name: "main", isCurrent: true },
      { name: "feature-x", isCurrent: false },
      { name: "unused", isCurrent: false }
    ],
    worktrees: [
      { path: "/repo", branch: "main", isCurrent: true },
      { path: "/repo-worktrees/feature-x", branch: "feature-x", isCurrent: false }
    ]
  }
  const result = __test.selectableBranches(gitInfo)
  assert.deepEqual(result.map((b) => b.name).sort(), ["main", "unused"])
})

test("switchWorktree keeps the currently active session and its thread on screen instead of bouncing to New session", async () => {
  const previousOpenworking = global.window.openworking
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const { switchWorktree, state } = __test
  const previousState = {
    activeProjectId: state.activeProjectId,
    projects: state.projects,
    sessionsByProject: state.sessionsByProject,
    activeSessionId: state.activeSessionId,
    threads: state.threads,
    runtime: state.runtime,
    gitInfoByProject: state.gitInfoByProject,
    gitInfoLoading: state.gitInfoLoading,
    loading: state.loading
  }

  const project = { id: "proj_wt", name: "WT Project", path: "/repo" }
  Object.assign(state, {
    activeProjectId: project.id,
    projects: [project],
    sessionsByProject: { [project.id]: [{ id: "sess_old", title: "Old session" }] },
    activeSessionId: "sess_old",
    threads: new Map([["sess_old", { sessionId: "sess_old", status: { type: "idle" }, messages: [{ id: "m1", role: "user", parts: [] }] }]]),
    runtime: { status: "running", project: { id: project.id } },
    gitInfoByProject: new Map([[project.id, { isGitRepo: true, currentBranch: "main", branches: [], worktrees: [] }]]),
    gitInfoLoading: new Set()
  })

  global.window.openworking = {
    git: {
      switchWorktree: async () => ({
        project: { ...project, activeWorktreePath: "/repo-worktrees/feature-x" }
      }),
      info: async () => ({ isGitRepo: true, currentBranch: "feature-x", branches: [], worktrees: [] })
    },
    runtime: {
      openProject: async (target) => ({ status: "running", project: { id: target.id }, runtime: { cwd: target.path } }),
      listCommands: async () => [],
      // The new worktree has no sessions of its own yet — a naive implementation would fail to
      // find "sess_old" in this (now different) list and fall back to the "New session" screen.
      listSessions: async () => [],
      listSessionsForDirectory: async () => []
    }
  }

  try {
    await switchWorktree("/repo-worktrees/feature-x")

    assert.equal(state.activeSessionId, "sess_old")
    assert.ok(state.threads.has("sess_old"))
    assert.deepEqual(state.threads.get("sess_old").messages, [{ id: "m1", role: "user", parts: [] }])
    assert.equal(state.gitInfoByProject.get(project.id).currentBranch, "feature-x")
    assert.equal(state.loading, false)
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("ensureGitInfo writes each project's response into its own cache slot, so a slow response can't leak across projects", async () => {
  const previousOpenworking = global.window.openworking
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const { ensureGitInfo, state } = __test
  const previousState = {
    activeProjectId: state.activeProjectId,
    projects: state.projects,
    gitInfoByProject: state.gitInfoByProject,
    gitInfoLoading: state.gitInfoLoading
  }

  let resolveA
  Object.assign(state, {
    activeProjectId: "proj_a",
    projects: [{ id: "proj_a", name: "A", path: "/repo-a" }, { id: "proj_b", name: "B", path: "/repo-b" }],
    gitInfoByProject: new Map(),
    gitInfoLoading: new Set()
  })

  global.window.openworking = {
    git: {
      info: async (projectId) => {
        if (projectId === "proj_a") return new Promise((resolve) => { resolveA = resolve })
        return { isGitRepo: true, currentBranch: "b-branch", branches: [], worktrees: [] }
      }
    }
  }

  try {
    const pendingA = ensureGitInfo("proj_a") // A's load starts, does not resolve yet
    state.activeProjectId = "proj_b"          // user switches to B before A comes back
    await ensureGitInfo("proj_b")             // B resolves immediately into B's slot
    assert.equal(state.gitInfoByProject.get("proj_b").currentBranch, "b-branch")

    resolveA({ isGitRepo: true, currentBranch: "a-branch", branches: [], worktrees: [] })
    await pendingA

    // A's late response lands in A's own slot; B's slot (the active project) is untouched.
    assert.equal(state.gitInfoByProject.get("proj_b").currentBranch, "b-branch")
    assert.equal(state.gitInfoByProject.get("proj_a").currentBranch, "a-branch")
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("ensureGitInfo always caches a definite value, even if the IPC resolves falsy, so render can't loop", async () => {
  const previousOpenworking = global.window.openworking
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const { ensureGitInfo, state } = __test
  const previousState = { gitInfoByProject: state.gitInfoByProject, gitInfoLoading: state.gitInfoLoading }
  state.gitInfoByProject = new Map()
  state.gitInfoLoading = new Set()

  global.window.openworking = { git: { info: async () => undefined } }

  try {
    await ensureGitInfo("proj_x")
    // The entry must be SET (not left undefined) — an undefined slot would make renderGitControl
    // re-trigger ensureGitInfo on every frame forever.
    assert.equal(state.gitInfoByProject.has("proj_x"), true)
    assert.deepEqual(state.gitInfoByProject.get("proj_x"), { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] })
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("gitErrorMessage surfaces only git's actionable 'Please …' hint, dropping the IPC and file-list noise", () => {
  const raw = "Error invoking remote method 'git:checkoutBranch': Error: error: Your local changes to the following files would be overwritten by checkout: package-lock.json package.json src/styles.css Please commit your changes or stash them before you switch branches. Aborting"
  assert.equal(
    __test.gitErrorMessage({ message: raw }, "fallback"),
    "Please commit your changes or stash them before you switch branches. Aborting"
  )
})

test("gitErrorMessage strips the Electron/Error/error: prefixes when there is no 'Please' hint", () => {
  const raw = "Error invoking remote method 'git:switchWorktree': Error: That worktree does not belong to this project's repository."
  assert.equal(
    __test.gitErrorMessage({ message: raw }, "fallback"),
    "That worktree does not belong to this project's repository."
  )
})

test("gitErrorMessage falls back when the message is empty", () => {
  assert.equal(__test.gitErrorMessage({ message: "" }, "Could not checkout branch."), "Could not checkout branch.")
  assert.equal(__test.gitErrorMessage(undefined, "Could not checkout branch."), "Could not checkout branch.")
})

test("renderGitPopover's Branches column omits a branch checked out by another worktree", () => {
  const html = __test.renderGitPopover({
    isGitRepo: true,
    currentBranch: "main",
    branches: [
      { name: "main", isCurrent: true },
      { name: "feature-x", isCurrent: false }
    ],
    worktrees: [
      { path: "/repo", branch: "main", isCurrent: true },
      { path: "/repo-worktrees/feature-x", branch: "feature-x", isCurrent: false }
    ]
  })
  assert.match(html, /data-git-branch="main"/)
  assert.doesNotMatch(html, /data-git-branch="feature-x"/)
  // The worktree itself still shows in the Worktrees column even though its branch is hidden from Branches.
  assert.match(html, /data-git-worktree="\/repo-worktrees\/feature-x"/)
})

test("Thinking row stays while the turn is still running, and only busy state clears it", () => {
  const thread = {
    sessionId: "sess_thinking",
    messages: [
      { id: "msg_user", role: "user", parts: [{ id: "p_user", messageID: "msg_user", type: "text", text: "Explain this" }] }
    ],
    pendingQuestions: [],
    pendingPermissions: [],
    status: { type: "busy" }
  }
  assert.equal(__test.shouldRenderThinkingRow(thread, thread.status, 0), true)

  // Streamed text is not the end of the turn, so a long pause after the first tokens must not
  // read as the agent having stopped.
  thread.messages.push({
    id: "msg_assistant",
    role: "assistant",
    parts: [{ id: "p_text", messageID: "msg_assistant", type: "text", text: "Streaming answer" }],
    stats: { completed: false }
  })
  assert.equal(__test.shouldRenderThinkingRow(thread, thread.status, 0), true)

  thread.status = { type: "idle" }
  assert.equal(__test.shouldRenderThinkingRow(thread, thread.status, 0), false)
})

test("Thinking row hides as soon as a real tool call starts", () => {
  const thread = {
    sessionId: "sess_tool_thinking",
    messages: [
      { id: "msg_user", role: "user", parts: [{ id: "p_user", messageID: "msg_user", type: "text", text: "Search weather" }] },
      {
        id: "msg_assistant",
        role: "assistant",
        parts: [{
          id: "msg_assistant:tool:call_websearch",
          messageID: "msg_assistant",
          type: "tool",
          tool: "websearch",
          state: { status: "running", input: { query: "nhiệt độ đà nẵng hôm nay" } }
        }],
        stats: { completed: false }
      }
    ],
    pendingQuestions: [],
    pendingPermissions: [],
    status: { type: "busy" }
  }

  assert.equal(__test.shouldRenderThinkingRow(thread, thread.status, 0), false)
  const html = __test.renderToolRow(thread.messages[1].parts[0])
  assert.match(html, /Searching the web - nhiệt độ đà nẵng hôm nay/)
  assert.match(html, /Processing/)
})

// v2 renames the bash tool to "shell" (see V2_PERMISSION_ACTION_BY_V1_TOOL in opencode-config-v2.js).
// Before this, "shell" fell through toolInfo's generic fallback with an empty subtitle, so the row
// just read "shell" with no indication of what command actually ran.
test("renderToolRow shows the real command for the v2 shell tool", () => {
  const { renderToolRow } = __test
  const html = renderToolRow({
    id: "tool_1",
    type: "tool",
    tool: "shell",
    state: { status: "completed", input: { command: "git status" }, output: "clean" }
  })
  assert.match(html, /Ran command - git status/)
})

test("renderToolRow preserves Office translation progress and artifact metadata", () => {
  const html = __test.renderToolRow({
    id: "tool_office_translation",
    type: "tool",
    tool: "translate_office_document",
    state: {
      status: "completed",
      input: { inputPath: "/tmp/source.xlsx", targetLanguage: "Vietnamese", mode: "inplace" },
      metadata: {
        artifacts: [{ path: "/tmp/source.xlsx", filename: "source.xlsx" }],
        backupPath: "/tmp/source.xlsx.backup",
        quality: "verified",
        warnings: []
      }
    }
  })

  assert.match(html, /Translated Office document - source\.xlsx/)
  assert.match(html, /class="artifact-chip/)
  assert.match(html, /data-open-artifact="\/tmp\/source\.xlsx"/)
})

// The pinned "-next" runtime renamed the skill tool's field from v1's `name` to `id` (verified
// live against a real session: input:{"id":"brainstorming"}). Before this, "Loaded skill" showed
// no skill name at all because toolInfo() only ever read input.name.
test("renderToolRow shows the skill id on the pinned -next runtime's skill tool", () => {
  const { renderToolRow } = __test
  const html = renderToolRow({
    id: "tool_1",
    type: "tool",
    tool: "skill",
    state: { status: "completed", input: { id: "brainstorming" }, output: "" }
  })
  assert.match(html, /Loaded skill - brainstorming/)
})

// Same rename pattern for the read tool: v1's `filePath` became `path` (verified live: real
// session data for a read call shows input:{"path":"..."}, never filePath).
test("renderToolRow shows the file name for the v2 read tool's `path` field", () => {
  const { renderToolRow } = __test
  const html = renderToolRow({
    id: "tool_1",
    type: "tool",
    tool: "read",
    state: { status: "completed", input: { path: "/Users/x/project/README.md" }, output: "" }
  })
  assert.match(html, /Read file - README\.md/)
})

test("tool updates bypass the fake pacing queue", () => {
  const calls = []
  const fakePacer = {
    enqueue(event) { calls.push(["enqueue", event.type]); return true },
    defer(event) { calls.push(["defer", event.type]); return true },
    hasPendingPart() { return true },
    hasPendingSession() { return true }
  }
  const event = {
    type: "message.part.updated",
    sessionID: "active",
    part: {
      id: "msg_a:tool:call_1",
      messageID: "msg_a",
      type: "tool",
      tool: "websearch",
      state: { status: "running", input: { query: "weather" } }
    }
  }

  assert.equal(__test.maybeConsumePacedRuntimeEvent(event, "active", fakePacer), false)
  assert.deepEqual(calls, [])
})

test("thread row segments join matches renderThreadRows and keys stay unique", () => {
  const { state } = __test
  const project = { id: "proj_segments", name: "Segments", path: "/tmp/segments" }
  const thread = {
    sessionId: "sess_segments",
    messages: [
      { id: "msg_user", role: "user", parts: [{ id: "p1", messageID: "msg_user", type: "text", text: "Hello there" }] },
      { id: "msg_user_2", role: "user", parts: [{ id: "p2", messageID: "msg_user_2", type: "text", text: "Second question" }] }
    ],
    pendingQuestions: [],
    pendingPermissions: [],
    status: { type: "retry", attempt: 2, message: "Rate limited" }
  }
  Object.assign(state, {
    nav: "session",
    projects: [project],
    activeProjectId: project.id,
    activeSessionId: "sess_segments",
    sessionsByProject: { [project.id]: [{ id: "sess_segments", directory: project.path }] },
    messageLoadsBySession: {},
    threads: new Map([["sess_segments", thread]]),
    forkMarkers: new Map([["sess_segments", "msg_user"]]),
    pendingAttachments: [],
    pendingFileMentions: [],
    toast: null
  })

  const normalize = (html) => html.replace(/>\s+</g, "><").trim()
  const segments = __test.threadRowSegments()
  assert.equal(normalize(segments.map(([, html]) => html).join("")), normalize(__test.renderThreadRows()))

  const keys = segments.map(([key]) => key)
  assert.equal(new Set(keys).size, keys.length, "segment keys must be unique")
  assert.ok(keys.includes("msg:msg_user"))
  assert.ok(keys.includes("fork:msg_user"))
  assert.ok(keys.includes("msg:msg_user_2"))
  assert.ok(keys.includes("retry"))

  // Empty thread with a start-of-conversation fork marker mirrors the legacy special case.
  state.threads = new Map([["sess_segments", { ...thread, messages: [], status: { type: "idle" } }]])
  state.forkMarkers = new Map([["sess_segments", null]])
  const emptySegments = __test.threadRowSegments()
  assert.equal(normalize(emptySegments.map(([, html]) => html).join("")), normalize(__test.renderThreadRows()))
  assert.ok(emptySegments.map(([key]) => key).includes("fork:start"))
})

test("SubagentRunTree renders nested status-only rows at the end of the active thread", () => {
  const { state } = __test
  const previous = {
    nav: state.nav,
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    messageLoadsBySession: state.messageLoadsBySession,
    forkMarkers: state.forkMarkers,
    subagentRunTreesByRoot: state.subagentRunTreesByRoot
  }
  const project = { id: "proj_tree", name: "Tree", path: "/tmp/tree" }
  try {
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: "proj_tree",
      activeSessionId: "ses_root",
      sessionsByProject: { proj_tree: [{ id: "ses_root", directory: project.path }] },
      threads: new Map([["ses_root", {
        sessionId: "ses_root",
        messages: [],
        pendingQuestions: [],
        pendingPermissions: [],
        status: { type: "idle" }
      }]]),
      messageLoadsBySession: {},
      forkMarkers: new Map(),
      subagentRunTreesByRoot: new Map([["ses_root", {
        rootSessionId: "ses_root",
        revision: 3,
        truncated: true,
        runs: [{
          sessionId: "ses_child",
          parentSessionId: "ses_root",
          agent: "review",
          description: "Review the patch",
          status: "succeeded",
          children: [{
            sessionId: "ses_nested",
            parentSessionId: "ses_child",
            title: "Nested check",
            status: "failed",
            children: []
          }]
        }]
      }]])
    })

    __test.render()
    assert.equal(__test.renderThreadContent(), undefined)
    const card = document.querySelector(".subagent-run-tree")
    assert.ok(card)
    assert.match(card.textContent, /Subagent runs/)
    assert.match(card.textContent, /2 runs/)
    assert.match(card.textContent, /Review the patch/)
    assert.match(card.textContent, /Succeeded/)
    assert.match(card.textContent, /Failed/)
    assert.match(card.textContent, /Showing first 100 runs/)
    assert.equal(card.querySelectorAll('[role="treeitem"]').length, 2)
    assert.equal(card.querySelectorAll('[aria-selected="false"]').length, 2)
    assert.equal(card.textContent.includes("prompt"), false)
  } finally {
    Object.assign(state, previous)
  }
})

test("nested island delegation dispatches a real click exactly once (header IDE menu + right sidebar)", () => {
  const previousRequestAnimationFrame = global.requestAnimationFrame
  global.requestAnimationFrame = (callback) => { callback(); return 1 }
  const { render, state } = __test
  const previousState = {
    nav: state.nav,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    sessionsByProject: state.sessionsByProject,
    threads: state.threads,
    forkMarkers: state.forkMarkers,
    config: state.config,
    gitInfoByProject: state.gitInfoByProject,
    runtime: state.runtime,
    ideMenu: state.ideMenu,
    rightSidebarOpen: state.rightSidebarOpen,
    fileTreeProjectId: state.fileTreeProjectId
  }
  const previousOpenworking = global.window.openworking
  const project = { id: "proj_once", name: "Once", path: "/tmp/once" }
  try {
    Object.assign(state, {
      nav: "session",
      auth: { saml2Enabled: false, status: "authenticated" },
      projects: [project],
      activeProjectId: project.id,
      activeSessionId: "sess_once",
      sessionsByProject: { [project.id]: [{ id: "sess_once", title: "S", directory: project.path }] },
      threads: new Map([["sess_once", { sessionId: "sess_once", messages: [], pendingQuestions: [], pendingPermissions: [], status: { type: "idle" } }]]),
      forkMarkers: new Map(),
      config: { personalization: { defaultIde: "vscode" } },
      gitInfoByProject: new Map([[project.id, { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }]]),
      runtime: { status: "running", project, sessionStatuses: {} },
      ideMenu: null,
      rightSidebarOpen: false
    })
    global.window.openworking = { files: { async list() { return [] } } }
    render()

    // A real bubbling click crosses BOTH island delegation layers (mainRoot then .desktop).
    // The handler re-renders synchronously, detaching event.target — the ancestor island must
    // still not double-dispatch, or every toggle handler cancels itself.
    const arrow = document.querySelector("[data-ide-menu]")
    assert.ok(arrow, "IDE split-button must render in the header")
    arrow.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
    assert.equal(state.ideMenu, project.id, "one click must open the IDE menu (not toggle it back shut)")

    const rightSidebarButton = document.querySelector('[data-action="toggleRightSidebar"]')
    assert.ok(rightSidebarButton, "right-sidebar toggle must render in the header")
    rightSidebarButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }))
    assert.equal(state.rightSidebarOpen, true, "one click must open the right sidebar")
  } finally {
    Object.assign(state, previousState)
    global.window.openworking = previousOpenworking
    global.requestAnimationFrame = previousRequestAnimationFrame
  }
})

test("removeProject stops only the runtime owned by the removed project", async () => {
  const { removeProject, state } = __test
  const previousOpenworking = window.openworking
  const previous = {
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    runtime: state.runtime,
    sessionsByProject: state.sessionsByProject,
    sessionLoadsByProject: state.sessionLoadsByProject,
    expanded: state.expanded
  }
  const removed = []
  let stopCalls = 0
  try {
    Object.assign(state, {
      auth: { status: "unauthenticated" },
      projects: [{ id: "runtime-project", path: "/tmp/runtime" }, { id: "view-project", path: "/tmp/view" }],
      activeProjectId: "view-project",
      runtime: { status: "running", project: { id: "runtime-project", path: "/tmp/runtime" } },
      sessionsByProject: {},
      sessionLoadsByProject: {},
      expanded: new Set()
    })
    window.openworking = {
      runtime: {
        async stop() {
          stopCalls += 1
          return { status: "stopped", project: null }
        }
      },
      projects: {
        async remove(id) { removed.push(id) },
        async list() { return state.projects.filter((project) => !removed.includes(project.id)) }
      }
    }

    await removeProject("runtime-project")
    assert.equal(stopCalls, 1)

    state.runtime = { status: "running", project: { id: "runtime-project", path: "/tmp/runtime" } }
    await removeProject("view-project")
    assert.equal(stopCalls, 1, "removing a different project must not stop the runtime")
  } finally {
    Object.assign(state, previous)
    window.openworking = previousOpenworking
  }
})

test("project removal keeps the project and modal error when runtime stop fails", async () => {
  const { render, state } = __test
  const previousOpenworking = window.openworking
  const previous = {
    auth: state.auth,
    nav: state.nav,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    activeSessionId: state.activeSessionId,
    runtime: state.runtime,
    sessionsByProject: state.sessionsByProject,
    projectDeleteTarget: state.projectDeleteTarget,
    projectRemoving: state.projectRemoving,
    projectDeleteError: state.projectDeleteError
  }
  let removeCalls = 0
  try {
    Object.assign(state, {
      auth: { status: "authenticated", user: { email: "test@example.com" } },
      nav: "projects",
      projects: [{ id: "runtime-project", name: "Runtime project", path: "/tmp/runtime" }],
      activeProjectId: "runtime-project",
      activeSessionId: null,
      runtime: { status: "running", project: { id: "runtime-project", path: "/tmp/runtime" } },
      sessionsByProject: { "runtime-project": [] },
      projectDeleteTarget: { id: "runtime-project", name: "Runtime project" },
      projectRemoving: false,
      projectDeleteError: null
    })
    window.openworking = {
      runtime: { async stop() { throw new Error("Could not stop runtime") } },
      projects: {
        async remove() { removeCalls += 1 },
        async list() { return [] }
      }
    }

    render()
    document.querySelector('[data-action="confirmRemoveProject"]').click()
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(removeCalls, 0)
    assert.equal(state.projects.length, 1)
    assert.deepEqual(state.projectDeleteTarget, { id: "runtime-project", name: "Runtime project" })
    assert.equal(state.projectRemoving, false)
    assert.equal(state.projectDeleteError, "Could not stop runtime")
    assert.match(document.querySelector(".confirm-modal").textContent, /Could not stop runtime/)
  } finally {
    Object.assign(state, previous)
    window.openworking = previousOpenworking
  }
})

test("sidebar omits project and per-project session counts", () => {
  const { render, state } = __test
  const previous = {
    auth: state.auth,
    projects: state.projects,
    activeProjectId: state.activeProjectId,
    sessionsByProject: state.sessionsByProject,
    pinnedSessions: state.pinnedSessions,
    expanded: state.expanded,
    nav: state.nav
  }
  try {
    Object.assign(state, {
      auth: { status: "authenticated", user: { email: "test@example.com" } },
      projects: [{ id: "count-project", name: "Count", path: "/tmp/count" }],
      activeProjectId: "count-project",
      sessionsByProject: {
        "count-project": [
          { id: "pinned", title: "Pinned", directory: "/tmp/count" },
          { id: "regular", title: "Regular", directory: "/tmp/count" }
        ]
      },
      pinnedSessions: new Set(["pinned"]),
      expanded: new Set(),
      nav: "projects"
    })
    render()
    assert.equal(document.querySelector('[data-nav="projects"] .count'), null)
    assert.equal(document.querySelector(".proj-count"), null)
  } finally {
    Object.assign(state, previous)
  }
})

test("Browser Setup renders from Svelte and cannot close while downloading", async () => {
  const { render, state } = __test
  const previousOpenworking = window.openworking
  const previous = {
    auth: state.auth,
    nav: state.nav,
    skillsTab: state.skillsTab,
    browserSetupOpen: state.browserSetupOpen,
    browserDownloading: state.browserDownloading,
    browserStatus: state.browserStatus,
    browserRelease: state.browserRelease,
    mcpServers: state.mcpServers
  }
  try {
    Object.assign(state, {
      auth: { status: "authenticated", user: { email: "test@example.com" } },
      nav: "skills",
      skillsTab: "mcp",
      browserSetupOpen: false,
      browserDownloading: false,
      browserStatus: { chromeInstalled: true, hostInstalled: false },
      browserRelease: { version: "1.2.3", downloadUrl: "https://example.invalid/extension.zip" },
      mcpServers: []
    })
    window.openworking = {
      browser: {
        async status() { return state.browserStatus },
        async release() { return state.browserRelease }
      },
      mcp: { async status() { return [] } }
    }
    render()
    document.querySelector('[data-action="openBrowserSetup"]').click()
    assert.ok(document.getElementById("browserSetupTitle"))

    state.browserDownloading = true
    render()
    document.querySelector(".update-backdrop").click()
    assert.equal(state.browserSetupOpen, true)
    assert.equal(document.querySelector('[data-action="closeBrowserSetup"]').disabled, true)

    state.browserDownloading = false
    render()
    document.querySelector('[data-action="closeBrowserSetup"]').click()
    assert.equal(state.browserSetupOpen, false)
  } finally {
    Object.assign(state, previous)
    window.openworking = previousOpenworking
  }
})

test("skill preview updates Markdown in place", () => {
  const { render, state } = __test
  const previousMarked = global.marked
  const previousHljs = global.hljs
  const previous = {
    auth: state.auth,
    skillPreview: state.skillPreview,
    skillPreviewContent: state.skillPreviewContent,
    skillPreviewLoading: state.skillPreviewLoading,
    skillPreviewError: state.skillPreviewError
  }
  try {
    global.marked = {
      Renderer: class Renderer {},
      parse(text) { return `<h1>${text}</h1>` }
    }
    global.hljs = { getLanguage() { return false } }
    Object.assign(state, {
      auth: { status: "authenticated", user: { email: "test@example.com" } },
      skillPreview: { name: "sample", variant: "custom" },
      skillPreviewContent: "# First",
      skillPreviewLoading: false,
      skillPreviewError: null
    })
    render()
    const modal = document.querySelector(".skill-preview-modal")
    assert.match(modal.textContent, /First/)
    state.skillPreviewContent = "# Updated"
    render()
    assert.equal(document.querySelector(".skill-preview-modal"), modal)
    assert.match(modal.textContent, /Updated/)
  } finally {
    Object.assign(state, previous)
    global.marked = previousMarked
    global.hljs = previousHljs
  }
})

// --- VCS Changes panel -------------------------------------------------------------------------
// The panel lists working-copy status for the active project/worktree and fetches a patch only
// for the row the user opens.

function vcsTestState(overrides = {}) {
  return {
    nav: "session",
    activeProjectId: "proj_vcs",
    projects: [{ id: "proj_vcs", name: "demo", path: "/tmp/demo" }],
    runtime: { status: "running", project: { id: "proj_vcs" } },
    rightSidebarOpen: true,
    rightSidebarTab: "changes",
    vcsProjectId: "proj_vcs",
    vcsFiles: [],
    vcsLoading: false,
    vcsError: "",
    vcsTruncated: false,
    document: null,
    ...overrides
  }
}

test("Changes tab renders working-copy rows and the empty state", async () => {
  const previous = { ...__test.state }
  const previousOpenworking = global.window.openworking
  try {
    Object.assign(__test.state, vcsTestState({
      vcsFiles: [
        { file: "src/added.js", status: "added", additions: 4, deletions: 0 },
        { file: "src/gone.js", status: "deleted", additions: 0, deletions: 7 }
      ]
    }))
    __test.render()
    const html = document.getElementById("rightFileSidebarRoot").innerHTML
    assert.match(html, /data-right-tab="changes"/)
    assert.match(html, /data-vcs-file="src\/added\.js"/)
    assert.match(html, /vcs-badge added/)
    assert.match(html, /vcs-badge deleted/)
    // Totals across the listed files.
    assert.match(html, /\+4/)
    assert.match(html, /7/)

    __test.state.vcsFiles = []
    __test.render()
    assert.match(
      document.getElementById("rightFileSidebarRoot").innerHTML,
      /No uncommitted changes\./
    )
  } finally {
    Object.assign(__test.state, previous)
    global.window.openworking = previousOpenworking
  }
})

test("loadVcsStatus ignores a reply that lands after the project changed", async () => {
  const previous = { ...__test.state }
  const previousOpenworking = global.window.openworking
  try {
    Object.assign(__test.state, vcsTestState())
    global.window.openworking = {
      vcs: {
        async status() {
          // The user switches project while this request is in flight.
          __test.state.activeProjectId = "proj_other"
          __test.state.projects = [{ id: "proj_other", name: "other", path: "/tmp/other" }]
          return { files: [{ file: "stale.js", status: "modified", additions: 1, deletions: 1 }], truncated: false }
        }
      }
    }
    await __test.loadVcsStatus()
    // Painting the previous project's changes into the new project's panel would be a data leak
    // between workspaces, so the late reply must be dropped entirely.
    assert.deepEqual(__test.state.vcsFiles, [])
  } finally {
    Object.assign(__test.state, previous)
    global.window.openworking = previousOpenworking
  }
})

test("loadVcsStatus surfaces a failure as a panel error", async () => {
  const previous = { ...__test.state }
  const previousOpenworking = global.window.openworking
  try {
    Object.assign(__test.state, vcsTestState())
    global.window.openworking = {
      vcs: { async status() { throw new Error("vcs unavailable") } }
    }
    await __test.loadVcsStatus()
    assert.match(__test.state.vcsError, /vcs unavailable/)
    assert.equal(__test.state.vcsLoading, false)
  } finally {
    Object.assign(__test.state, previous)
    global.window.openworking = previousOpenworking
  }
})

test("refresh signals coalesce into one request and only while the Changes tab is open", async () => {
  const previous = { ...__test.state }
  const previousOpenworking = global.window.openworking
  try {
    let calls = 0
    Object.assign(__test.state, vcsTestState())
    global.window.openworking = {
      vcs: { async status() { calls += 1; return { files: [], truncated: false } } }
    }

    // A finished agent turn touches many files; the burst must collapse to a single fetch.
    __test.scheduleVcsRefresh()
    __test.scheduleVcsRefresh()
    __test.scheduleVcsRefresh()
    assert.equal(calls, 0, "refresh is debounced, not immediate")
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(calls, 1)

    // With the Files tab showing, the same signals must not hit the network at all.
    __test.state.rightSidebarTab = "files"
    __test.scheduleVcsRefresh()
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(calls, 1)

    // Nor when the whole panel is closed.
    __test.state.rightSidebarTab = "changes"
    __test.state.rightSidebarOpen = false
    __test.scheduleVcsRefresh()
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.equal(calls, 1)
  } finally {
    Object.assign(__test.state, previous)
    global.window.openworking = previousOpenworking
  }
})

test("opening a changed file fetches its patch and shows the diff tab", async () => {
  const previous = { ...__test.state }
  const previousOpenworking = global.window.openworking
  try {
    const patch = "diff --git a/src/app.js b/src/app.js\n@@ -1 +1,2 @@\n old\n+new\n"
    let diffArgs = null
    Object.assign(__test.state, vcsTestState({
      vcsFiles: [{ file: "src/app.js", status: "modified", additions: 1, deletions: 0 }]
    }))
    global.window.openworking = {
      vcs: {
        async diff(projectId, file) { diffArgs = { projectId, file }; return { file, patch, truncated: false } }
      },
      files: {
        async read(filePath) {
          return { path: filePath, name: "app.js", relativePath: filePath, content: "old\nnew\n" }
        }
      }
    }

    await __test.openVcsDiff("src/app.js")
    assert.deepEqual(diffArgs, { projectId: "proj_vcs", file: "src/app.js" })
    assert.equal(__test.state.document.requestedPath, "src/app.js")
    assert.equal(__test.state.document.tab, "diff")
    assert.equal(__test.state.document.diff, patch)
  } finally {
    Object.assign(__test.state, previous)
    global.window.openworking = previousOpenworking
  }
})

test("opening a deleted file shows its diff without reading the missing file", async () => {
  const previous = { ...__test.state }
  const previousOpenworking = global.window.openworking
  try {
    const patch = "diff --git a/gone.js b/gone.js\ndeleted file mode 100644\n@@ -1 +0,0 @@\n-bye\n"
    let readCalled = false
    Object.assign(__test.state, vcsTestState({
      vcsFiles: [{ file: "gone.js", status: "deleted", additions: 0, deletions: 1 }]
    }))
    global.window.openworking = {
      vcs: { async diff(projectId, file) { return { file, patch, truncated: false } } },
      files: { async read() { readCalled = true; throw new Error("file does not exist") } }
    }

    await __test.openVcsDiff("gone.js")
    // Reading a deleted file would fail and replace the diff with an error message.
    assert.equal(readCalled, false)
    assert.equal(__test.state.document.tab, "diff")
    assert.equal(__test.state.document.diff, patch)
    assert.equal(__test.state.document.error, "")
  } finally {
    Object.assign(__test.state, previous)
    global.window.openworking = previousOpenworking
  }
})

test("switching to the Changes tab loads status, and back to Files loads the tree", async () => {
  const previous = { ...__test.state }
  const previousOpenworking = global.window.openworking
  try {
    let statusCalls = 0
    let listCalls = 0
    Object.assign(__test.state, vcsTestState({ rightSidebarTab: "files" }))
    global.window.openworking = {
      vcs: { async status() { statusCalls += 1; return { files: [], truncated: false } } },
      files: { async list() { listCalls += 1; return { path: "", children: [] } } }
    }

    await __test.selectRightSidebarTab("changes")
    assert.equal(__test.state.rightSidebarTab, "changes")
    assert.equal(statusCalls, 1)

    // Selecting the tab that is already active must not refetch.
    await __test.selectRightSidebarTab("changes")
    assert.equal(statusCalls, 1)

    await __test.selectRightSidebarTab("files")
    assert.equal(__test.state.rightSidebarTab, "files")
    assert.equal(listCalls, 1)
  } finally {
    Object.assign(__test.state, previous)
    global.window.openworking = previousOpenworking
  }
})

// Regression: the right-sidebar island is NOT mounted with `delegate: true`, so its buttons must
// dispatch through ctx.actions.click explicitly. Calling the handlers directly (as the tests above
// do) cannot catch a missing onclick - only a real DOM click can, which is what this asserts.
test("clicking the Changes tab and a file row dispatches through the delegated tables", async () => {
  const previous = { ...__test.state }
  const previousOpenworking = global.window.openworking
  try {
    Object.assign(__test.state, vcsTestState({
      rightSidebarTab: "changes",
      vcsFiles: [{ file: "src/app.js", status: "modified", additions: 1, deletions: 0 }]
    }))
    let statusCalls = 0
    let diffCalls = 0
    global.window.openworking = {
      vcs: {
        async status() { statusCalls += 1; return { files: [], truncated: false } },
        async diff(projectId, file) { diffCalls += 1; return { file, patch: "diff --git a/x b/x\n", truncated: false } }
      },
      files: { async read(filePath) { return { path: filePath, name: "app.js", relativePath: filePath, content: "x" } } }
    }
    __test.render()

    const host = document.getElementById("rightFileSidebarRoot")
    const filesTab = host.querySelector('[data-right-tab="files"]')
    const row = host.querySelector('[data-vcs-file="src/app.js"]')
    assert.ok(filesTab, "Files tab button is rendered")
    assert.ok(row, "changed-file row is rendered")

    // Every one of these buttons needs its own onclick; without it the click is inert.
    row.dispatchEvent(new global.window.MouseEvent("click", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(diffCalls, 1, "clicking a row fetches that file's patch")

    filesTab.dispatchEvent(new global.window.MouseEvent("click", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(__test.state.rightSidebarTab, "files", "clicking Files switches the tab")
  } finally {
    Object.assign(__test.state, previous)
    global.window.openworking = previousOpenworking
  }
})

// --- Context meter recovery after compaction (opencode-v2-feature-backlog gap fill) -----------

// The thread's last assistant message at the moment compaction ends still reports its
// PRE-compaction token count — showing it as current usage would be actively wrong, not just
// stale-looking, since compaction's whole point is shrinking that number.
test("resolveContextUsage ignores the thread's pre-compaction stats right after compaction ends", () => {
  const { resolveContextUsage, state } = __test
  const previous = { activeSessionId: state.activeSessionId, threads: state.threads }
  try {
    state.activeSessionId = "ses_live"
    state.threads = new Map([["ses_live", {
      sessionId: "ses_live",
      messages: [{ role: "assistant", stats: { inputTokens: 4000, completed: true } }]
    }]])
    // freshAfter: 1 means "the thread already had 1 message when compaction ended" — the
    // pre-compaction message above, not a new one — so it must not be trusted as live.
    const usage = resolveContextUsage({ status: "ended", freshAfter: 1 }, { contextLimit: 100000 })
    assert.deepEqual(usage, { used: null, total: 100000, pct: null, stale: true })
  } finally {
    state.activeSessionId = previous.activeSessionId
    state.threads = previous.threads
  }
})

// This is the actual bug fix: nothing else ever resets compactionStatuses[sessionId] away from
// "ended", so without freshAfter the ring would stay stuck on the stale/fetched path forever,
// even once a real new reply landed with its own accurate stats.
test("resolveContextUsage recovers automatically once a real new turn lands after compaction", () => {
  const { resolveContextUsage, state } = __test
  const previous = { activeSessionId: state.activeSessionId, threads: state.threads }
  try {
    state.activeSessionId = "ses_live"
    state.threads = new Map([["ses_live", {
      sessionId: "ses_live",
      messages: [
        { role: "assistant", stats: { inputTokens: 4000, completed: true } }, // pre-compaction
        { role: "assistant", stats: { inputTokens: 1200, completed: true } }  // a real new turn
      ]
    }]])
    const usage = resolveContextUsage({ status: "ended", freshAfter: 1 }, { contextLimit: 100000 })
    assert.deepEqual(usage, { used: 1200, total: 100000, pct: 1 })
  } finally {
    state.activeSessionId = previous.activeSessionId
    state.threads = previous.threads
  }
})

test("resolveContextUsage falls back to a stale placeholder, then to the fetched value, after compaction", () => {
  const { resolveContextUsage, state } = __test
  const previous = { activeSessionId: state.activeSessionId, threads: state.threads, runtime: state.runtime }
  try {
    state.activeSessionId = "ses_compacted"
    state.threads = new Map([["ses_compacted", { sessionId: "ses_compacted", messages: [] }]])
    state.runtime = { compactionStatuses: {} }

    const stale = resolveContextUsage({ status: "ended", freshAfter: 0 }, { contextLimit: 100000 })
    assert.deepEqual(stale, { used: null, total: 100000, pct: null, stale: true })

    state.runtime = { ...state.runtime, sessionContextUsage: { ses_compacted: 2500 } }
    const fetched = resolveContextUsage({ status: "ended", freshAfter: 0 }, { contextLimit: 100000 })
    assert.deepEqual(fetched, { used: 2500, total: 100000, pct: 3 })
  } finally {
    state.activeSessionId = previous.activeSessionId
    state.threads = previous.threads
    state.runtime = previous.runtime
  }
})

// A compaction status object with no freshAfter at all (e.g. hand-built, or from a code path that
// predates this field) must default to the safe/conservative "not fresh" reading, matching the
// original behaviour, rather than accidentally trusting the thread's stats.
test("resolveContextUsage treats a missing freshAfter as not-fresh rather than trusting live stats", () => {
  const { resolveContextUsage, state } = __test
  const previous = { activeSessionId: state.activeSessionId, threads: state.threads }
  try {
    state.activeSessionId = "ses_legacy"
    state.threads = new Map([["ses_legacy", {
      sessionId: "ses_legacy",
      messages: [{ role: "assistant", stats: { inputTokens: 4000, completed: true } }]
    }]])
    const usage = resolveContextUsage({ status: "ended" }, { contextLimit: 100000 })
    assert.deepEqual(usage, { used: null, total: 100000, pct: null, stale: true })
  } finally {
    state.activeSessionId = previous.activeSessionId
    state.threads = previous.threads
  }
})

test("resolveContextUsage hides the indicator before any turn has run and compaction hasn't fired", () => {
  const { resolveContextUsage, state } = __test
  const previous = { activeSessionId: state.activeSessionId, threads: state.threads }
  try {
    state.activeSessionId = "ses_fresh"
    state.threads = new Map([["ses_fresh", { sessionId: "ses_fresh", messages: [] }]])
    assert.equal(resolveContextUsage(null, { contextLimit: 100000 }), null)
  } finally {
    state.activeSessionId = previous.activeSessionId
    state.threads = previous.threads
  }
})

test("refreshSessionContextUsage stores GET /api/session/:id/context's inputTokens keyed by session", async () => {
  const { refreshSessionContextUsage, state } = __test
  const previousOpenworking = global.window.openworking
  const previous = { activeSessionId: state.activeSessionId, runtime: state.runtime }
  try {
    // A different active session than the one refreshed: the render() branch is intentionally
    // not exercised here, keeping this a focused unit test of the state write.
    state.activeSessionId = "ses_other"
    state.runtime = {}
    let requestedSessionId = null
    global.window.openworking = {
      runtime: {
        async sessionContext({ sessionId }) {
          requestedSessionId = sessionId
          return { messageCount: 4, inputTokens: 777 }
        }
      }
    }
    await refreshSessionContextUsage("ses_target")
    assert.equal(requestedSessionId, "ses_target")
    assert.equal(state.runtime.sessionContextUsage.ses_target, 777)
  } finally {
    state.activeSessionId = previous.activeSessionId
    state.runtime = previous.runtime
    global.window.openworking = previousOpenworking
  }
})

test("refreshSessionContextUsage leaves the stale placeholder in place when the fetch fails", async () => {
  const { refreshSessionContextUsage, state } = __test
  const previousOpenworking = global.window.openworking
  const previous = { activeSessionId: state.activeSessionId, runtime: state.runtime }
  try {
    state.activeSessionId = "ses_other"
    state.runtime = {}
    global.window.openworking = { runtime: { async sessionContext() { throw new Error("offline") } } }
    await refreshSessionContextUsage("ses_target")
    assert.equal(state.runtime.sessionContextUsage, undefined)
  } finally {
    state.activeSessionId = previous.activeSessionId
    state.runtime = previous.runtime
    global.window.openworking = previousOpenworking
  }
})

// --- Saved permissions modal (opencode-v2-feature-backlog gap fill) ----------------------------

test("openPermissionsModal loads the saved list and revokeSavedPermission removes one by id", async () => {
  const { openPermissionsModal, closePermissionsModal, revokeSavedPermission, state } = __test
  const previousOpenworking = global.window.openworking
  const previous = {
    permissionsModalOpen: state.permissionsModalOpen,
    permissionsList: state.permissionsList,
    permissionsError: state.permissionsError
  }
  try {
    let removedId = null
    global.window.openworking = {
      permissions: {
        async listSaved() {
          return [
            { id: "prm_1", projectId: "prj_1", action: "shell", resource: "npm *" },
            { id: "prm_2", projectId: "prj_1", action: "edit", resource: "*" }
          ]
        },
        async removeSaved(id) { removedId = id }
      }
    }

    await openPermissionsModal()
    assert.equal(state.permissionsModalOpen, true)
    assert.equal(state.permissionsList.length, 2)

    await revokeSavedPermission("prm_1")
    assert.equal(removedId, "prm_1")
    assert.deepEqual(state.permissionsList.map((entry) => entry.id), ["prm_2"])

    closePermissionsModal()
    assert.equal(state.permissionsModalOpen, false)
  } finally {
    state.permissionsModalOpen = previous.permissionsModalOpen
    state.permissionsList = previous.permissionsList
    state.permissionsError = previous.permissionsError
    global.window.openworking = previousOpenworking
  }
})

test("openPermissionsModal surfaces a load failure instead of throwing", async () => {
  const { openPermissionsModal, state } = __test
  const previousOpenworking = global.window.openworking
  const previous = { permissionsModalOpen: state.permissionsModalOpen, permissionsError: state.permissionsError }
  try {
    global.window.openworking = { permissions: { async listSaved() { throw new Error("offline") } } }
    await openPermissionsModal()
    assert.equal(state.permissionsError, "offline")
  } finally {
    state.permissionsModalOpen = previous.permissionsModalOpen
    state.permissionsError = previous.permissionsError
    global.window.openworking = previousOpenworking
  }
})

// --- File search (fs.find) picker (opencode-v2-feature-backlog gap fill) -----------------------

test("searchProjectFiles debounces, calls fs.find with the active project's context, then clears on a blank query", async () => {
  const { searchProjectFiles, state } = __test
  const previousOpenworking = global.window.openworking
  const previous = { ...state }
  try {
    Object.assign(state, vcsTestState({ fileSearchQuery: "", fileSearchResults: [] }))
    const calls = []
    global.window.openworking = {
      fs: {
        async find(query, options, context) {
          calls.push({ query, options, context })
          return [{ path: "src/app.js", type: "file" }]
        }
      }
    }

    searchProjectFiles("app")
    assert.equal(state.fileSearchLoading, true, "loading flips synchronously so the UI shows a spinner immediately")
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].query, "app")
    assert.equal(calls[0].context.projectId, "proj_vcs")
    assert.deepEqual(state.fileSearchResults, [{ path: "src/app.js", type: "file" }])
    assert.equal(state.fileSearchLoading, false)

    searchProjectFiles("")
    assert.deepEqual(state.fileSearchResults, [])
    assert.equal(state.fileSearchLoading, false)
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(calls.length, 1, "a blank query must not fire a request even after the debounce window")
  } finally {
    Object.assign(state, previous)
    global.window.openworking = previousOpenworking
  }
})

test("searchProjectFiles drops a stale reply when the query changed before it resolved", async () => {
  const { searchProjectFiles, state } = __test
  const previousOpenworking = global.window.openworking
  const previous = { ...state }
  try {
    Object.assign(state, vcsTestState({ fileSearchQuery: "", fileSearchResults: [] }))
    global.window.openworking = {
      fs: {
        async find(query) {
          if (query === "slow") await new Promise((resolve) => setTimeout(resolve, 120))
          return [{ path: `${query}.js`, type: "file" }]
        }
      }
    }

    searchProjectFiles("slow")
    await new Promise((resolve) => setTimeout(resolve, 210))
    searchProjectFiles("fast")
    await new Promise((resolve) => setTimeout(resolve, 250))

    assert.deepEqual(state.fileSearchResults, [{ path: "fast.js", type: "file" }])
  } finally {
    Object.assign(state, previous)
    global.window.openworking = previousOpenworking
  }
})

// --- Failed tool rows -------------------------------------------------------------------
// Regression cover for the bare "Editing file failed  ERROR" row: the runtime's own message was
// projected all the way to the renderer and then dropped, so every distinct edit failure looked
// identical and unactionable.

const ERROR_PART = {
  id: "prt_edit_err",
  type: "tool",
  tool: "edit",
  state: {
    status: "error",
    input: { filePath: "/tmp/proj/README.md" },
    error: "Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings."
  }
}

function withExpandedToolErrors(ids, run) {
  const previous = __test.state.expandedToolErrors
  __test.state.expandedToolErrors = new Set(ids)
  try {
    return run()
  } finally {
    __test.state.expandedToolErrors = previous
  }
}

test("a failed tool row keeps the filename so the user knows which file broke", () => {
  const label = __test.toolStepLabel({ activeLabel: "Editing file", completedLabel: "Edited file", subtitle: "README.md" }, "error")
  assert.equal(label, "Editing file failed - README.md")
})

test("a failed tool row is collapsed by default and hides the raw error until expanded", () => {
  const html = withExpandedToolErrors([], () => __test.renderToolRow(ERROR_PART))
  assert.match(html, /data-tool-error="prt_edit_err"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /Editing file failed - README\.md/)
  assert.ok(!html.includes("Could not find oldString"), "collapsed row must not leak the error body")
})

test("expanding a failed tool row surfaces the runtime message and an actionable hint", () => {
  const html = withExpandedToolErrors(["prt_edit_err"], () => __test.renderToolRow(ERROR_PART))
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /tool-step-details/)
  assert.match(html, /Could not find oldString in the file/)
  assert.match(html, /ask the agent to re-read the file and retry/)
})

test("non-error tool rows stay plain divs, so a long thread does not fill with focusable buttons", () => {
  const part = { id: "prt_read", type: "tool", tool: "read", state: { status: "completed", input: { filePath: "/tmp/a.js" } } }
  const html = withExpandedToolErrors([], () => __test.renderToolRow(part))
  assert.ok(!html.includes("data-tool-error"), "completed row must not be expandable")
  assert.ok(!html.includes("aria-expanded"))
  assert.match(html, /<div class="tool-step completed">/)
})

test("a huge tool error is truncated before it reaches the DOM", () => {
  const part = { ...ERROR_PART, state: { ...ERROR_PART.state, error: "x".repeat(5000) } }
  const text = __test.toolErrorText(part)
  assert.ok(text.length <= 601, `expected truncation, got ${text.length} chars`)
  assert.ok(text.endsWith("…"))
})

test("a stale error left on a part that ultimately succeeded is ignored", () => {
  const part = { ...ERROR_PART, state: { ...ERROR_PART.state, status: "completed" } }
  assert.equal(__test.toolErrorText(part), "")
  const html = withExpandedToolErrors(["prt_edit_err"], () => __test.renderToolRow(part))
  assert.ok(!html.includes("data-tool-error"))
})

test("each real opencode edit failure maps to its own hint", () => {
  const cases = [
    ["No changes to apply: oldString and newString are identical.", /nothing to change/],
    ["oldString cannot be empty when editing an existing file.", /use write if a full-file replacement/],
    ["Refusing replacement because the matched span is much larger than oldString.", /too broad/],
    ["Could not find oldString in the file. It must match exactly, including whitespace, indentation, and line endings.", /re-read the file and retry/],
    ["Found multiple matches for oldString. Provide more surrounding context to make the match unique.", /appears more than once/],
    ["EACCES: permission denied, open '/tmp/proj/README.md'", /System Settings/]
  ]
  for (const [message, expected] of cases) {
    assert.match(__test.toolErrorHint(message), expected, `no hint for: ${message}`)
  }
  assert.equal(__test.toolErrorHint("some unrecognised failure"), "")
  assert.equal(__test.toolErrorHint(""), "")
})

// The approval-prompt hint tells the user to resend the request. A bare /rejected|aborted/ also
// caught transport and model-side failures, sending them to retry an approval that never happened.
test("the approval-prompt hint does not fire on unrelated aborts and rejections", () => {
  for (const message of [
    "connection aborted by peer",
    "Error: request aborted after 30000ms",
    "the model rejected the input as malformed"
  ]) {
    assert.equal(__test.toolErrorHint(message), "", `should not claim an approval prompt for: ${message}`)
  }
  // The genuine approval-prompt shapes still map to the hint.
  for (const message of ["Permission denied by user", "The request was rejected", "aborted by user"]) {
    assert.match(__test.toolErrorHint(message), /approval prompt/, `no approval hint for: ${message}`)
  }
})

// A failed subagent step must stay attributable. The subtitle (filename) is also kept on error,
// so the [subagent] marker has to survive alongside it rather than being skipped by it.
test("a failed subagent tool row keeps both its marker and its subtitle", () => {
  const info = { activeLabel: "Running task", completedLabel: "Ran task", subtitle: "src/app.js" }
  assert.equal(__test.toolStepLabel(info, "error", true), "[subagent] Running task failed - src/app.js")
  assert.equal(__test.toolStepLabel(info, "running", true), "[subagent] Running task - src/app.js")
  assert.equal(__test.toolStepLabel(info, "error", false), "Running task failed - src/app.js")
})

test("a tool error containing markup is escaped, not injected into the thread", () => {
  const part = { ...ERROR_PART, state: { ...ERROR_PART.state, error: "<img src=x onerror=alert(1)>" } }
  const html = withExpandedToolErrors(["prt_edit_err"], () => __test.renderToolRow(part))
  assert.ok(!html.includes("<img src=x"), "raw markup must not survive into the row")
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
})
