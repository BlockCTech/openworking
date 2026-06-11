const SUPERPOWERS_PLUGIN = "superpowers@git+https://github.com/obra/superpowers.git"
const ALLOWED_MODEL_MODALITIES = ["text", "audio", "image", "video", "pdf"]
const BUILT_IN_SKILLS = [
  { name: "explain-project", description: "Explain project structure and execution paths." },
  { name: "find-bugs", description: "Inspect code for likely defects and risky behavior." },
  { name: "write-tests", description: "Add focused automated tests." },
  { name: "summarize-changes", description: "Summarize repository changes and impact." },
  { name: "code-review", description: "Review changes for bugs and missing tests." },
  { name: "docs-update", description: "Update documentation to match behavior." },
  { name: "pdf", description: "Read, create, transform and validate PDF documents." },
  { name: "pptx", description: "Read, create, edit and visually validate presentations." },
  { name: "skill-creator", description: "Create and validate reusable OpenCode-native skills." },
  { name: "xlsx", description: "Read, create, edit and validate spreadsheet workbooks." },
  { name: "docx", description: "Read, create, edit and visually validate Word documents." },
  { name: "translate-document", description: "Translate PDF and DOCX files into new layout-preserving document artifacts." },
  { name: "translate-office-document", description: "Translate PPTX and XLSX files into new layout-preserving Office artifacts." },
  { name: "webapp-testing", description: "Test local web applications with focused browser automation." }
]

const icons = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 5H6.5A2.5 2.5 0 0 0 4 7.5v10A2.5 2.5 0 0 0 6.5 20h10a2.5 2.5 0 0 0 2.5-2.5V12"/><path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L12.8 15l-3.8 1 1-3.8z"/></svg>',
  chevRight: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  chevDown: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  attach: '<svg viewBox="0 0 24 24"><path d="M19 11.5 12.5 18a4 4 0 0 1-5.7-5.7l7-7a2.7 2.7 0 0 1 3.8 3.8l-7 7a1.3 1.3 0 0 1-1.9-1.9l6.3-6.3"/></svg>',
  agent: '<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/></svg>',
  ask: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 1.8-2 3M12 16.5h.01"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24"><path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z"/></svg>',
  arrowUp: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z"/><path d="M5 18a2 2 0 0 1 2-2h11"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 3 4 14h6l-1 7 9-11h-6z"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
  activity: '<svg viewBox="0 0 24 24"><path d="M3 12h4l2.5 7 5-15 2.5 8H21"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M8 10v8M12 10v8M16 10v8M5 6l1 15h12l1-15"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m4 12 5 5L20 6"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="12" rx="2"/><path d="M5 16H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>',
  folderPlus: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 12v4M10 14h4"/></svg>',
  collapse: '<svg viewBox="0 0 24 24"><path d="M9 4 5 8m0 0h3.5M5 8V4.5"/><path d="M15 20l4-4m0 0h-3.5M19 16v3.5"/></svg>',
  sidebarToggle: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>',
  chevUpDown: '<svg viewBox="0 0 24 24"><path d="m8 9 4-4 4 4"/><path d="m16 15-4 4-4-4"/></svg>'
}

const modes = [
  { id: "agent", agent: "build", label: "Agent", icon: "agent", sub: "Reads & edits files in the project" },
  { id: "plan", agent: "plan", label: "Plan", icon: "ask", sub: "Reads only - proposes a plan first" }
]

const chips = [
  { label: "Explain this project", icon: "book", text: "Give me a high-level overview of how this project is structured." },
  { label: "Find a bug", icon: "bolt", text: "Look through the project and find likely bugs or issues." },
  { label: "Write tests", icon: "doc", text: "Add unit tests for the core modules in this project." },
  { label: "Summarize changes", icon: "activity", text: "Summarize the most recent changes in this project." }
]

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
  removeOptimisticUser,
  resetThread
} = window.OpenWorkingThreadStream

const state = {
  nav: "session",
  projects: [],
  activeProjectId: null,
  activeSessionId: null,
  sessionsByProject: {},
  thread: createThreadStream(),
  toolDisclosure: new Map(),
  diffDisclosure: new Map(),
  document: null,
  expanded: new Set(),
  showAll: new Set(),
  runtime: null,
  configPath: "",
  config: null,
  customSkills: [],
  modalityErrors: {},
  providerId: "gateway",
  mode: "agent",
  planAutoOpened: null,
  planAccepted: null,
  selectedModelKey: "",
  promptDraft: "",
  pendingAttachments: [],
  commands: [],
  commandMenu: { open: false, query: "", index: 0 },
  popover: null,
  sessionMenu: null,          // sessionId đang mở menu, hoặc null
  sessionDeleteTarget: null,  // { id, title } của session chờ xác nhận xóa trong modal
  sidebarCollapsed: false,
  diagnosticsOpen: false,
  toast: null,
  loading: false,
  versionGate: null,
  updating: false,
  downloadProgress: null,
  installStatus: null,
  skillUploadOpen: false,
  skillUploading: false,
  skillUploadError: null,
  // Per-question multi-select draft state, keyed by `${requestID}:${questionIndex}`:
  // { selected: Set<value>, other: string }
  questionDrafts: new Map()
}

const THREAD_SCROLL_THRESHOLD = 80
const SIDEBAR_WIDTH_KEY = "openworking:sidebar-w"
const SIDEBAR_MIN_WIDTH = 200
const SIDEBAR_MAX_WIDTH = 480

function setSidebarWidth(width) {
  const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)))
  document.documentElement.style.setProperty("--sidebar-w", `${clamped}px`)
  return clamped
}

function applyStoredSidebarWidth() {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  if (Number.isFinite(stored) && stored > 0) setSidebarWidth(stored)
}

applyStoredSidebarWidth()

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function icon(name) {
  return icons[name] || ""
}

function selectedProject() {
  return state.projects.find((project) => project.id === state.activeProjectId) || null
}

function projectSessions(projectId) {
  return state.sessionsByProject[projectId] || []
}

function selectedSession() {
  return projectSessions(state.activeProjectId).find((session) => session.id === state.activeSessionId) || null
}

function threadAbortable() {
  return state.thread.status?.type === "busy" || state.thread.status?.type === "retry"
}

function providerEntries() {
  return Object.entries(state.config?.provider || {})
}

function currentProvider() {
  const providers = state.config?.provider || {}
  if (!providers[state.providerId]) {
    state.providerId = Object.keys(providers)[0] || "gateway"
  }
  return providers[state.providerId] || null
}

function skillEnabled(name) {
  return state.config?.permission?.skill?.[name] !== "deny"
}

function modelOptions() {
  return providerEntries().flatMap(([providerID, provider]) => {
    const models = Object.entries(provider.models || {})
    return models.map(([modelID, model]) => ({
      key: `${providerID}/${modelID}`,
      providerID,
      modelID,
      name: model?.name && model.name !== modelID
        ? model.name
        : models.length === 1 && provider.name
          ? provider.name
          : modelID,
      sub: `${provider.name || providerID} - local config`
    }))
  })
}

function selectedModel() {
  const models = modelOptions()
  if (!models.some((model) => model.key === state.selectedModelKey)) {
    state.selectedModelKey = models[0]?.key || ""
  }
  return models.find((model) => model.key === state.selectedModelKey) || null
}

function runtimeLabel() {
  if (state.loading || state.runtime?.status === "starting" || state.runtime?.status === "stopping") return "starting"
  if (state.runtime?.status === "error") return "error"
  if (state.runtime?.status === "running" && state.runtime.activity === "running") return "running"
  return "idle"
}

function relativeTime(value) {
  const time = new Date(value || 0).getTime()
  if (!time) return ""
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000))
  if (seconds < 60) return "now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`
  return `${Math.floor(seconds / 604800)}w`
}

function sessionUpdatedAt(session) {
  return session.time?.updated || session.time?.created || session.updatedAt || session.createdAt
}

function hydrateActiveThread(messages, status) {
  if (state.thread.sessionId !== state.activeSessionId) {
    state.toolDisclosure.clear()
    state.diffDisclosure.clear()
    state.document = null
    state.planAutoOpened = null
    state.planAccepted = null
  }
  hydrateThread(state.thread, state.activeSessionId, messages, status)
}

function resetActiveThread(sessionId = null) {
  state.toolDisclosure.clear()
  state.diffDisclosure.clear()
  state.document = null
  state.planAutoOpened = null
  state.planAccepted = null
  resetThread(state.thread, sessionId)
}

function showToast(message) {
  state.toast = message
  renderToast()
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => {
    state.toast = null
    renderToast()
  }, 2400)
}

function applyVersionGate(gate) {
  if (gate && (gate.status === "force" || gate.status === "soft")) {
    state.versionGate = gate
    render()
  }
}

async function checkAppVersion() {
  try {
    applyVersionGate(await window.openworking.version.check())
  } catch {
    // Fail open — never block the app on a version-check failure.
  }
}

async function startUpdateDownload() {
  const gate = state.versionGate
  if (!gate?.downloadUrl || state.updating) return
  state.updating = true
  state.downloadProgress = 0
  state.installStatus = "downloading"
  render()
  try {
    await window.openworking.version.downloadAndInstall(gate.downloadUrl)
    // On a successful auto-install the app relaunches and this renderer is torn
    // down, so we never reach here. If we do, the update was opened manually.
    showToast("Installer opened — follow the prompts to update.")
  } catch (error) {
    showToast(error.message)
  } finally {
    state.updating = false
    state.downloadProgress = null
    state.installStatus = null
    render()
  }
}

async function loadInitialState() {
  const [projects, activeConfig, runtime] = await Promise.all([
    window.openworking.projects.list(),
    window.openworking.config.get(),
    window.openworking.runtime.get()
  ])
  state.projects = projects
  state.configPath = activeConfig.path
  state.config = activeConfig.config
  state.customSkills = activeConfig.customSkills || []
  state.providerId = Object.keys(state.config.provider || {})[0] || "gateway"
  state.runtime = runtime
  selectedModel()
  window.openworking.onRuntimeUpdate(handleRuntimeUpdate)
  window.openworking.onRuntimeStream(handleRuntimeStream)
  window.openworking.onVersionGate((gate) => applyVersionGate(gate))
  window.openworking.onVersionDownloadProgress((percent) => {
    state.downloadProgress = percent
    render()
  })
  window.openworking.onVersionInstallStatus((status) => {
    state.installStatus = status
    render()
  })
  if (projects[0]) {
    state.activeProjectId = projects[0].id
    state.expanded.add(projects[0].id)
  }
  render()
  checkAppVersion()
  if (projects[0]) {
    await openProject(projects[0].id, { selectLatest: false }).catch((error) => showToast(error.message))
  }
}

function handleRuntimeUpdate(runtime) {
  state.runtime = runtime
  renderRuntimeStatus()
}

function handleRuntimeStream(event) {
  const result = applyThreadEvent(state.thread, event)
  if (event?.type === "session.status" || event?.type === "session.idle" || event?.type === "session.aborted" || event?.type === "session.error") {
    updateComposerSubmitButton()
  }
  if (result.changed) {
    maybeAutoOpenPlan()
    scheduleThreadRender()
  }
  if (result.reconcile) scheduleRefresh()
}

// In Plan mode, the plan agent often writes a plan markdown file. Surface it in
// the document-viewer panel automatically the first time it appears for a session.
function latestAssistantMessage() {
  const messages = state.thread.messages || []
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i]
  }
  return null
}

function latestPlanFileRef() {
  const message = latestAssistantMessage()
  if (!message) return null
  return messageFileRefs(message)[0] || null
}

function latestPlanText() {
  const message = latestAssistantMessage()
  return message ? (messageText(message) || "").trim() : ""
}

// Sentinel requestedPath for an inline (text-only) plan rendered in the panel.
const INLINE_PLAN_PATH = "__plan__"

// Minimum assistant text length to treat a prose reply as a proposed plan when
// the plan agent answered without writing a markdown file.
const PLAN_TEXT_MIN_LENGTH = 200

// Render a text-only plan (no file on disk) in the document-viewer panel.
function openInlinePlan(text) {
  if (!text) return
  state.document = {
    requestedPath: INLINE_PLAN_PATH, path: "", name: "Plan", relativePath: "Plan",
    content: text, loading: false, error: "", truncated: false
  }
  render()
}

function maybeAutoOpenPlan() {
  if (state.mode !== "plan") return
  const sessionId = state.activeSessionId
  if (!sessionId || state.planAutoOpened === sessionId) return
  const ref = latestPlanFileRef()
  if (ref) {
    state.planAutoOpened = sessionId
    if (state.document?.requestedPath !== ref.path) openDocument(ref.path)
    return
  }
  // No plan file written (common for prose-only plan agents): fall back to the
  // assistant's text, but only once the reply has finished streaming.
  const status = state.thread.status?.type
  if (status === "busy" || status === "retry") return
  const text = latestPlanText()
  if (text.length < PLAN_TEXT_MIN_LENGTH) return
  state.planAutoOpened = sessionId
  if (state.document?.requestedPath !== INLINE_PLAN_PATH) openInlinePlan(text)
}

function updateComposerSubmitButton() {
  const send = document.querySelector(".send")
  if (!send) return
  const abortable = threadAbortable()
  const label = abortable ? "Stop response" : "Send"
  send.classList.toggle("disabled", !abortable && !state.promptDraft.trim())
  send.dataset.action = abortable ? "abortSession" : "sendPrompt"
  send.title = label
  send.setAttribute("aria-label", label)
  send.innerHTML = icon(abortable ? "stop" : "arrowUp")
}

function scheduleRefresh() {
  clearTimeout(scheduleRefresh.timer)
  scheduleRefresh.timer = setTimeout(() => refreshSessionData().catch(() => {}), 180)
}

async function refreshSessionData() {
  if (state.runtime?.status !== "running" || state.runtime.project?.id !== state.activeProjectId) return
  state.sessionsByProject[state.activeProjectId] = await window.openworking.runtime.listSessions()
  if (state.activeSessionId) {
    hydrateActiveThread(await window.openworking.runtime.listMessages({ sessionId: state.activeSessionId }))
  }
  render()
}

function captureThreadScroll() {
  const thread = document.querySelector(".thread-scroll")
  if (!thread) return null

  return {
    scrollTop: thread.scrollTop,
    stickToLatest: thread.scrollHeight - thread.scrollTop - thread.clientHeight <= THREAD_SCROLL_THRESHOLD
  }
}

function restoreThreadScroll(previous, threadScroll) {
  const thread = document.querySelector(".thread-scroll")
  if (!thread) return

  if (threadScroll === "latest" || previous?.stickToLatest) {
    thread.scrollTop = thread.scrollHeight
    return
  }

  if (previous) thread.scrollTop = previous.scrollTop
}

function renderMarkdown(text) {
  if (!text) return "";
  return marked.parse(text, {
    highlight: function(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
    langPrefix: 'hljs language-'
  });
}

function renderThreadContent({ threadScroll = "preserve" } = {}) {
  const inner = document.querySelector(".thread-inner")
  if (!inner) return
  const previousThreadScroll = captureThreadScroll()
  inner.innerHTML = renderThreadRows()
  bindMessageActions(inner)
  bindArtifactActions(inner)
  bindToolStepActions(inner)
  bindDiffToggleActions(inner)
  bindFileRefActions(inner)
  bindPendingPromptActions(inner)
  inner.querySelectorAll("[data-action]").forEach((element) => element.addEventListener("click", handleAction))
  restoreThreadScroll(previousThreadScroll, threadScroll)
}

function scheduleThreadRender() {
  if (scheduleThreadRender.frame) return
  scheduleThreadRender.frame = requestAnimationFrame(() => {
    scheduleThreadRender.frame = null
    renderThreadContent()
  })
}

function render({ threadScroll = "preserve" } = {}) {
  const previousThreadScroll = captureThreadScroll()

  document.getElementById("root").innerHTML = `
    <div class="desktop">
      <div class="window">
        <div class="app${state.sidebarCollapsed ? " collapsed" : ""}${state.document ? " has-doc" : ""}">
          ${renderSidebar()}
          ${renderMain()}
          ${state.document ? renderDocumentViewer() : ""}
        </div>
      </div>
      ${renderForceUpdate()}
      ${renderSkillUploadModal()}
      ${renderDeleteSessionModal()}
      <div id="toastHost"></div>
    </div>
  `
  bindEvents()
  renderToast()
  restoreThreadScroll(previousThreadScroll, threadScroll)
}

function updateButtonLabel() {
  if (state.updating) {
    if (state.installStatus === "installing") return "Installing…"
    if (state.installStatus === "relaunching") return "Restarting…"
    const percent = typeof state.downloadProgress === "number" ? ` ${state.downloadProgress}%` : "…"
    return `Downloading${percent}`
  }
  return "Update now"
}

function renderForceUpdate() {
  const gate = state.versionGate
  if (gate?.status !== "force") return ""
  const version = gate.latestVersion ? ` ${escapeHtml(gate.latestVersion)}` : ""
  const notes = gate.releaseNotes ? `<p class="update-notes">${escapeHtml(gate.releaseNotes)}</p>` : ""
  return `
    <div class="update-backdrop">
      <div class="update-modal" role="dialog" aria-modal="true">
        <div class="update-title">Update required</div>
        <p>A new version${version} is required to keep using OpenWorking. Please update to continue.</p>
        ${notes}
        <button class="primary-btn ${state.updating ? "disabled" : ""}" data-action="startUpdate">${escapeHtml(updateButtonLabel())}</button>
      </div>
    </div>
  `
}

function renderSkillUploadModal() {
  if (!state.skillUploadOpen) return ""
  return `
    <div class="update-backdrop">
      <div class="skill-upload-modal" role="dialog" aria-modal="true" aria-labelledby="skillUploadTitle">
        <div class="skill-upload-head">
          <h1 id="skillUploadTitle">Upload skill</h1>
          <button class="small-icon-btn" data-action="closeSkillUpload" aria-label="Close upload dialog">${icon("x")}</button>
        </div>
        <button class="skill-dropzone ${state.skillUploading ? "disabled" : ""}" data-action="chooseSkillArchive" data-skill-drop>
          ${icon("folderPlus")}
          <span>${state.skillUploading ? "Installing skill..." : "Drag and drop or click to upload"}</span>
        </button>
        ${state.skillUploadError ? `<div class="alert">${escapeHtml(state.skillUploadError)}</div>` : ""}
        <div class="skill-requirements">
          <strong>File requirements</strong>
          <ul>
            <li><code>SKILL.md</code> must contain skill name and description in YAML frontmatter.</li>
            <li><code>.zip</code> or <code>.skill</code> must include a <code>SKILL.md</code> file.</li>
          </ul>
        </div>
      </div>
    </div>
  `
}

function renderDeleteSessionModal() {
  const target = state.sessionDeleteTarget
  if (!target) return ""
  return `
    <div class="update-backdrop" data-action="cancelDeleteSession">
      <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="deleteSessionTitle" data-stop-click>
        <div class="confirm-title" id="deleteSessionTitle">Delete session?</div>
        <p>“${escapeHtml(target.title)}” will be permanently deleted. This can’t be undone.</p>
        <div class="confirm-actions">
          <button class="secondary-btn" data-action="cancelDeleteSession">Cancel</button>
          <button class="danger-btn" data-action="confirmDeleteSession">Delete</button>
        </div>
      </div>
    </div>
  `
}

function renderUpdatePill() {
  const gate = state.versionGate
  if (gate?.status !== "soft") return ""
  const title = gate.latestVersion ? `Version ${escapeHtml(gate.latestVersion)} available` : "Update available"
  return `
    <button class="update-pill ${state.updating ? "disabled" : ""}" data-action="startUpdate" title="${title}">
      ${escapeHtml(state.updating ? updateButtonLabel() : "Update")}
    </button>
  `
}

function renderSidebar() {
  if (state.sidebarCollapsed) {
    return `<button class="sidebar-reopen" data-action="toggleSidebar" title="Show sidebar">${icon("sidebarToggle")}</button>`
  }
  return `
    <aside class="sidebar">
      <div class="side-top">
        ${renderUpdatePill()}
        <button class="side-collapse-btn" data-action="toggleSidebar" title="Collapse sidebar">${icon("sidebarToggle")}</button>
      </div>
      <div class="side-scroll">
        <button class="new-session" data-action="newSession" ${selectedProject() ? "" : "disabled"}>
          ${icon("edit")}<span>New session</span><span class="kbd">&#8984;N</span>
        </button>
        <button class="nav-item ${state.nav === "projects" ? "active" : ""}" data-nav="projects">
          ${icon("folder")}<span>Projects</span><span class="count">${state.projects.length}</span>
        </button>
        <button class="nav-item ${state.nav === "config" ? "active" : ""}" data-nav="config">
          ${icon("gear")}<span>Config</span>
        </button>
        <div class="side-label">
          <span class="sl-title">Projects</span>
          <div class="sl-actions">
            <button class="sl-act" title="Collapse all" data-action="collapseAll">${icon("collapse")}</button>
            <button class="sl-act" title="Add project" data-action="addProject">${icon("folderPlus")}</button>
          </div>
        </div>
        ${state.projects.map(renderProjectGroup).join("")}
      </div>
      <div class="side-foot">
        <div class="side-user">
          <span class="su-av">OW</span>
          <span class="su-meta">
            <span class="su-name">OpenWorking</span>
            <span class="su-sub">Local</span>
          </span>
        </div>
      </div>
    </aside>
    <div class="sidebar-resizer" data-resizer></div>
  `
}

function renderProjectGroup(project) {
  const sessions = projectSessions(project.id)
  const open = state.expanded.has(project.id)
  const shown = state.showAll.has(project.id) ? sessions : sessions.slice(0, 5)
  return `
    <div class="proj-group">
      <button class="proj-head ${open ? "open" : ""} ${project.id === state.activeProjectId ? "active-proj" : ""}" data-open-project="${escapeHtml(project.id)}">
        <span class="fic">${icon("folder")}</span>
        <span class="pname">${escapeHtml(project.name)}</span>
        <span class="padd" title="New session" data-new-session="${escapeHtml(project.id)}">${icon("plus")}</span>
      </button>
      ${open ? `
        <div class="sessions">
          ${sessions.length ? shown.map((session) => `
            <div class="session-row-wrap ${session.id === state.activeSessionId ? "active" : ""}">
              <button class="session-row" data-session-id="${escapeHtml(session.id)}" data-project-id="${escapeHtml(project.id)}">
                <span class="stitle">${escapeHtml(session.title || "Untitled session")}</span>
                <span class="stime">${escapeHtml(relativeTime(sessionUpdatedAt(session)))}</span>
              </button>
              <button class="session-kebab" data-session-menu="${escapeHtml(session.id)}" title="Options">${icon("dots")}</button>
              ${state.sessionMenu === session.id ? `
                <div class="pop session-pop">
                  <button class="pop-item danger" data-session-delete="${escapeHtml(session.id)}" data-session-title="${escapeHtml(session.title || "Untitled session")}">
                    ${icon("trash")}<span>Delete</span>
                  </button>
                </div>` : ""}
            </div>
          `).join("") : `<div class="session-empty">${state.loading && project.id === state.activeProjectId ? "Loading..." : "No chats"}</div>`}
          ${sessions.length > 5 ? `<button class="session-more" data-show-all="${escapeHtml(project.id)}">${state.showAll.has(project.id) ? "Show less" : "Show more"}</button>` : ""}
        </div>
      ` : ""}
    </div>
  `
}

function renderMain() {
  if (state.nav === "projects") return renderProjectsScreen()
  if (state.nav === "config") return renderConfigScreen()
  return renderSessionScreen()
}

function renderHeader(title, subtitle) {
  const label = runtimeLabel()
  return `
    <div class="main-head">
      <div><div class="head-title">${escapeHtml(title)}</div><div class="head-path">${escapeHtml(subtitle || "")}</div></div>
      <div class="head-actions">
        <button class="status-pill ${label}" data-action="toggleDiagnostics"><span class="status-dot"></span>${escapeHtml(label)}</button>
      </div>
    </div>
    ${state.diagnosticsOpen ? renderDiagnostics() : ""}
  `
}

function renderSessionScreen() {
  const project = selectedProject()
  if (!project) {
    return `<main class="main">${renderHeader("OpenWorking", state.configPath)}<div class="empty-state"><h1>Add a local project</h1><p>Choose a folder to start a local OpenCode session.</p><button class="primary-btn" data-action="addProject">${icon("plus")}Add project</button></div></main>`
  }
  const session = selectedSession()
  return `
    <main class="main">
      ${renderHeader(session?.title || project.name, project.path)}
      ${session ? renderThread(project) : renderNewSession(project)}
    </main>
  `
}

function renderNewSession(project) {
  return `
    <div class="content">
      <div class="work">
        <div class="work-intro">
          <div class="eyebrow">New session</div>
          <h1>What should we work on in <span class="project-dot"></span>${escapeHtml(project.name)}?</h1>
          <p>OpenWorking runs the task locally inside this project folder.</p>
        </div>
        ${renderComposer(project)}
        <div class="chips">${chips.map((chip, index) => `<button class="chip" data-chip="${index}">${icon(chip.icon)}<span>${escapeHtml(chip.label)}</span></button>`).join("")}</div>
      </div>
    </div>
  `
}

function renderThread(project) {
  return `
    <div class="thread-scroll">
      <div class="thread-inner">${renderThreadRows()}</div>
    </div>
    <div class="composer-dock">${renderComposer(project, true)}</div>
  `
}

function renderThreadRows() {
  const status = state.thread.status || { type: "idle" }
  const awaiting = pendingPrompts()
  return `
    ${state.thread.messages.map(renderThreadMessage).join("")}
    ${status.type === "busy" && !hasRunningTool(state.thread) && !awaiting ? renderThinkingRow() : ""}
    ${status.type === "retry" ? renderRetryRow(status) : ""}
    ${renderPendingPermissions()}
    ${renderPendingQuestions()}
    ${renderPlanProposal()}
  `
}

function planProposalRef() {
  if (state.mode !== "plan") return undefined
  const status = state.thread.status || { type: "idle" }
  if (status.type === "busy" || status.type === "retry") return undefined
  if (pendingPrompts()) return undefined
  if (state.planAccepted === state.activeSessionId) return undefined
  const message = latestAssistantMessage()
  if (!message) return undefined
  const fileRef = messageFileRefs(message)[0]
  if (fileRef) return fileRef
  return (messageText(message) || "").trim().length >= PLAN_TEXT_MIN_LENGTH ? null : undefined
}

function renderPlanProposal() {
  const ref = planProposalRef()
  if (ref === undefined) return ""
  return `
    <div class="plan-proposal">
      <div class="plan-proposal-head">
        <span class="plan-proposal-dot"></span>
        <strong>Proposed a plan</strong>
        ${ref
          ? `<button class="plan-proposal-open" data-open-file="${escapeHtml(ref.path)}">Open plan</button>`
          : `<button class="plan-proposal-open" data-action="openPlanText">Open plan</button>`}
      </div>
      <div class="plan-proposal-actions">
        <button class="plan-btn danger" data-action="rejectPlan">Reject</button>
        <button class="plan-btn ghost" data-action="revisePlan">Revise…</button>
        <button class="plan-btn primary" data-action="acceptPlan">Accept &amp; execute</button>
      </div>
    </div>
  `
}

function pendingPrompts() {
  const questions = state.thread.pendingQuestions?.length || 0
  const permissions = state.thread.pendingPermissions?.length || 0
  return questions + permissions
}

function renderThreadMessage(message) {
  const actions = renderMessageActions(message)
  if (message.role === "user") {
    const text = messageText(message)
    const attachments = message.parts.filter((part) => part.type === "file")
    return text || attachments.length
      ? `<div class="msg-user"><div class="message-stack user-message"><div class="message-card bubble">${text ? `<div>${escapeHtml(text).replaceAll("\n", "<br>")}</div>` : ""}${renderAttachmentChips(attachments)}</div>${actions}</div></div>`
      : ""
  }
  const parts = message.parts.map(renderAssistantPart).join("")
  if (!parts) return ""
  const fileRefs = renderFileRefChips(messageFileRefs(message))
  const changes = renderMessageChanges(message)
  return `<div class="msg-ai"><div class="message-stack assistant-message"><div class="message-card ai-body">${parts}${fileRefs}${changes}</div>${actions}</div></div>`
}

const MARKDOWN_FILE_RE = /\.(md|markdown)$/i

function messageFileRefs(message) {
  const refs = new Map()
  for (const part of message.parts || []) {
    if (part.type !== "tool") continue
    if (!["read", "edit", "write"].includes(part.tool)) continue
    const candidate = part.state?.input?.filePath || part.state?.metadata?.filepath
    if (typeof candidate !== "string" || !candidate) continue
    if (!MARKDOWN_FILE_RE.test(candidate)) continue
    if (!refs.has(candidate)) refs.set(candidate, { path: candidate, name: filename(candidate) })
  }
  return [...refs.values()]
}

function renderFileRefChips(refs) {
  if (!refs.length) return ""
  return `
    <div class="file-refs">
      ${refs.map((ref) => `
        <button class="file-ref-chip ${state.document?.requestedPath === ref.path ? "active" : ""}" data-open-file="${escapeHtml(ref.path)}" title="${escapeHtml(ref.path)}">
          ${icon("doc")}<span><strong>${escapeHtml(ref.name)}</strong><small>Document · MD</small></span>
        </button>
      `).join("")}
    </div>
  `
}

function renderDocumentViewer() {
  const doc = state.document
  if (!doc) return ""
  const crumbs = (doc.relativePath || doc.name || "").split(/[\\/]/).filter(Boolean)
  const breadcrumb = crumbs.length
    ? crumbs.map((crumb, index) => `<span class="doc-crumb${index === crumbs.length - 1 ? " current" : ""}">${escapeHtml(crumb)}</span>`).join(`<span class="doc-crumb-sep">${icon("chevRight")}</span>`)
    : escapeHtml(doc.name || "")
  let body
  if (doc.loading) {
    body = `<div class="doc-state">Loading…</div>`
  } else if (doc.error) {
    body = `<div class="doc-state error">${escapeHtml(doc.error)}</div>`
  } else {
    body = `<div class="doc-content assistant-text">${renderMarkdown(doc.content)}</div>${doc.truncated ? `<small class="doc-truncated">File truncated.</small>` : ""}`
  }
  return `
    <aside class="document-viewer">
      <div class="doc-head">
        <div class="doc-crumbs">${breadcrumb}</div>
        <button class="doc-close" data-action="closeDocument" title="Close" aria-label="Close">${icon("x")}</button>
      </div>
      <div class="doc-scroll">${body}</div>
    </aside>
  `
}

async function openDocument(filePath) {
  if (!filePath) return
  state.document = { requestedPath: filePath, path: filePath, name: filename(filePath), relativePath: "", content: "", loading: true, error: "" }
  render()
  try {
    const doc = await window.openworking.files.read(filePath)
    if (state.document?.requestedPath !== filePath) return
    state.document = { requestedPath: filePath, ...doc, loading: false, error: "" }
  } catch (error) {
    if (state.document?.requestedPath !== filePath) return
    state.document = { requestedPath: filePath, path: filePath, name: filename(filePath), relativePath: "", content: "", loading: false, error: error.message }
  }
  render()
}

function closeDocument() {
  state.document = null
  render()
}

function renderMessageActions(message) {
  if (!messageCopyText(message)) return ""
  return `<div class="message-actions"><button class="message-action" data-copy-message="${escapeHtml(message.id)}" title="Copy message" aria-label="Copy message">${icon("copy")}</button></div>`
}

function renderAssistantPart(part) {
  if (part.type === "text") {
    return part.text ? `<div class="assistant-text">${renderMarkdown(part.text)}</div>` : ""
  }
  if (part.type === "error") return renderErrorPart(part)
  if (part.type === "tool") return renderToolRow(part)
  return ""
}

function renderErrorPart(part) {
  const title = part.title || "Request failed"
  const detail = part.detail || "OpenCode session failed."
  return `
    <div class="assistant-error">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(detail)}</span>
    </div>
  `
}

function filename(value) {
  return String(value || "").split(/[\\/]/).filter(Boolean).pop() || ""
}

function renderAttachmentChips(attachments, { removable = false } = {}) {
  if (!attachments.length) return ""
  return `
    <div class="${removable ? "composer-attachments" : "message-attachments"}">
      ${attachments.map((attachment) => `
        <span class="attachment-chip" title="${escapeHtml(attachment.mime)}">
          ${icon("doc")}<span>${escapeHtml(attachment.filename)}</span>
          ${removable ? `<button data-remove-attachment="${escapeHtml(attachment.id)}" title="Remove ${escapeHtml(attachment.filename)}">${icon("x")}</button>` : ""}
        </span>
      `).join("")}
    </div>
  `
}

function toolInfo(part) {
  const input = part.state?.input || {}
  const files = Array.isArray(input.files) ? input.files : []
  const mapping = {
    read: { icon: "book", activeLabel: "Reading file", completedLabel: "Read file", subtitle: filename(input.filePath) },
    list: { icon: "folder", activeLabel: "Listing files", completedLabel: "Listed files", subtitle: input.path },
    glob: { icon: "activity", activeLabel: "Searching files", completedLabel: "Searched files", subtitle: input.pattern },
    grep: { icon: "activity", activeLabel: "Searching text", completedLabel: "Searched text", subtitle: input.pattern },
    bash: { icon: "bolt", activeLabel: "Running command", completedLabel: "Ran command", subtitle: input.description },
    edit: { icon: "doc", activeLabel: "Editing file", completedLabel: "Edited file", subtitle: filename(input.filePath) },
    write: { icon: "doc", activeLabel: "Writing file", completedLabel: "Wrote file", subtitle: filename(input.filePath) },
    apply_patch: { icon: "doc", activeLabel: "Applying patch", completedLabel: "Applied patch", subtitle: files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "" },
    skill: { icon: "sparkle", activeLabel: "Loading skill", completedLabel: "Loaded skill", subtitle: input.name },
    translate_document: { icon: "doc", activeLabel: "Translating document", completedLabel: "Translated document", subtitle: filename(input.inputPath) },
    task: { icon: "agent", activeLabel: "Running task", completedLabel: "Completed task", subtitle: input.description }
  }
  const fallback = part.state?.title || part.tool || "Tool"
  return mapping[part.tool] || { icon: "activity", activeLabel: fallback, completedLabel: fallback, subtitle: "" }
}

function toolStepKey(part) {
  return `${part.messageID || ""}:${part.id || ""}`
}

function defaultToolStepOpen(status) {
  return status === "pending" || status === "running" || status === "error"
}

function toolStepDisclosure(part, status) {
  const key = toolStepKey(part)
  let disclosure = state.toolDisclosure.get(key)
  if (!disclosure || disclosure.status !== status) {
    disclosure = { status, open: defaultToolStepOpen(status) }
    state.toolDisclosure.set(key, disclosure)
  }
  return { key, open: disclosure.open }
}

function toolStepLabel(info, status) {
  if (status === "completed") return info.completedLabel
  if (status === "error") return `${info.activeLabel} failed`
  return info.activeLabel
}

function renderToolDetails(part, info, error) {
  const title = part.state?.title
  const rows = [
    title && title !== info.activeLabel ? ["Title", title] : null,
    info.subtitle ? ["Input", info.subtitle] : null,
    error ? ["Error", error] : null
  ].filter(Boolean)
  return `
    <div class="tool-step-details">
      ${rows.length ? rows.map(([label, value]) => `<div class="tool-detail ${label === "Error" ? "error" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("") : `<small>No additional details.</small>`}
    </div>
  `
}

function renderToolRow(part) {
  const info = toolInfo(part)
  const status = part.state?.status || "pending"
  const error = status === "error" ? part.state?.error : ""
  const disclosure = toolStepDisclosure(part, status)
  const processing = status === "pending" || status === "running"
  return `
    <div class="tool-result">
      <button class="tool-step ${escapeHtml(status)}" data-tool-step="${escapeHtml(disclosure.key)}" aria-expanded="${disclosure.open}">
        <span class="tool-copy"><strong>${escapeHtml(toolStepLabel(info, status))}</strong></span>
        ${processing ? `<span class="tool-processing"><i></i><span>Processing</span></span>` : `<span class="tool-state">${escapeHtml(status)}</span>`}
        <span class="tool-chevron">${icon("chevRight")}</span>
      </button>
      ${disclosure.open ? renderToolDetails(part, info, error) : ""}
      ${status === "completed" ? renderToolArtifacts(part.state?.metadata) : ""}
    </div>
  `
}

const OTHER_OPTION_VALUE = "__openworking_other__"

function questionDraftKey(requestID, index) {
  return `${requestID}:${index}`
}

function questionDraft(requestID, index) {
  const key = questionDraftKey(requestID, index)
  let draft = state.questionDrafts.get(key)
  if (!draft) {
    draft = { selected: new Set(), other: "" }
    state.questionDrafts.set(key, draft)
  }
  return draft
}

// Renders the Human-in-the-loop multiple-choice cards the agent raises via the question
// tool. Single-select questions submit on click; multi-select questions collect choices
// and submit via a button. An "Other" option exposes a free-text field.
function renderPendingQuestions() {
  const pending = state.thread.pendingQuestions || []
  if (!pending.length) return ""
  return pending.map(renderQuestionCard).join("")
}

function renderQuestionCard(request) {
  const questions = Array.isArray(request.questions) ? request.questions : []
  if (!questions.length) return ""
  return `
    <div class="ask-card question-card" data-question-card="${escapeHtml(request.requestID)}">
      ${request.header ? `<div class="ask-card-header">${escapeHtml(request.header)}</div>` : ""}
      ${questions.map((question, index) => renderQuestionPrompt(request, question, index)).join("")}
      <div class="ask-card-foot">
        <button class="ask-dismiss" data-question-dismiss="${escapeHtml(request.requestID)}">Dismiss</button>
      </div>
    </div>
  `
}

function renderQuestionPrompt(request, question, index) {
  const options = Array.isArray(question.options) ? question.options : []
  const multiple = question.multiple === true
  const draft = multiple || question.optional ? questionDraft(request.requestID, index) : null
  const rows = options.map((option, optionIndex) => {
    const value = String(option.value ?? option.label ?? "")
    const checked = draft ? draft.selected.has(value) : false
    return `
      <button class="ask-option ${checked ? "selected" : ""}" data-question-option="${escapeHtml(request.requestID)}" data-question-index="${index}" data-question-value="${escapeHtml(value)}" data-question-multiple="${multiple ? "1" : "0"}">
        <span class="ask-option-index">${optionIndex + 1}</span>
        <span class="ask-option-body">
          <strong>${escapeHtml(String(option.label ?? value))}</strong>
          ${option.description ? `<small>${escapeHtml(String(option.description))}</small>` : ""}
        </span>
        ${multiple ? `<span class="ask-check">${checked ? icon("check") : ""}</span>` : `<span class="ask-chevron">${icon("chevRight")}</span>`}
      </button>
    `
  }).join("")
  const otherText = draft ? draft.other : ""
  return `
    <div class="ask-question" data-question-prompt="${escapeHtml(request.requestID)}" data-question-index="${index}">
      <div class="ask-question-text">${escapeHtml(String(question.question || ""))}</div>
      <div class="ask-options">${rows}</div>
      <div class="ask-other">
        <input type="text" class="ask-other-input" placeholder="Other…" data-question-other="${escapeHtml(request.requestID)}" data-question-index="${index}" value="${escapeHtml(otherText)}" />
        ${multiple
          ? `<button class="ask-submit" data-question-submit="${escapeHtml(request.requestID)}" data-question-index="${index}">Submit</button>`
          : `<button class="ask-submit ghost" data-question-other-submit="${escapeHtml(request.requestID)}" data-question-index="${index}">Send</button>`}
      </div>
    </div>
  `
}

function permissionSummary(request) {
  const parts = []
  if (request.type) parts.push(String(request.type))
  if (request.pattern) parts.push(String(request.pattern))
  else if (request.callID) parts.push(`call ${request.callID}`)
  return parts.join(" · ")
}

// Renders the tool-approval card OpenCode raises when an action is gated to "ask".
function renderPendingPermissions() {
  const pending = state.thread.pendingPermissions || []
  if (!pending.length) return ""
  return pending.map(renderPermissionCard).join("")
}

function renderPermissionCard(request) {
  const summary = permissionSummary(request)
  return `
    <div class="ask-card permission-card" data-permission-card="${escapeHtml(request.requestID)}">
      <div class="ask-card-header">${escapeHtml(request.title || "Allow this action?")}</div>
      ${summary ? `<div class="ask-permission-meta">${escapeHtml(summary)}</div>` : ""}
      <div class="ask-permission-actions">
        <button class="ask-permission-btn allow" data-permission-reply="${escapeHtml(request.requestID)}" data-permission-decision="once">Allow once</button>
        <button class="ask-permission-btn always" data-permission-reply="${escapeHtml(request.requestID)}" data-permission-decision="always">Always allow</button>
        <button class="ask-permission-btn reject" data-permission-reply="${escapeHtml(request.requestID)}" data-permission-decision="reject">Reject</button>
      </div>
    </div>
  `
}

function diffStats(diff) {
  let additions = 0
  let deletions = 0
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++
  }
  return { additions, deletions }
}

function highlightDiff(diff) {
  try {
    return hljs.highlight(diff, { language: "diff" }).value
  } catch (error) {
    return escapeHtml(diff)
  }
}

// Renders one collapsible file diff. `key` identifies the disclosure state.
function renderDiffRow(key, { filepath, label, diff, truncated }) {
  let disclosure = state.diffDisclosure.get(key)
  if (!disclosure) {
    disclosure = { open: false }
    state.diffDisclosure.set(key, disclosure)
  }
  const displayLabel = label || (filepath ? filename(filepath) : "Changes")
  const { additions, deletions } = diffStats(diff)
  return `
    <div class="tool-diff-block">
      <button class="tool-diff-head" data-diff-toggle="${escapeHtml(key)}" aria-expanded="${disclosure.open}"${filepath ? ` title="${escapeHtml(filepath)}"` : ""}>
        ${icon("doc")}
        <span class="tool-diff-name">${escapeHtml(displayLabel)}</span>
        <span class="tool-diff-stats"><span class="diff-add">+${additions}</span><span class="diff-del">-${deletions}</span></span>
        <span class="tool-chevron">${icon("chevRight")}</span>
      </button>
      ${disclosure.open ? `<pre class="tool-diff"><code class="hljs language-diff">${highlightDiff(diff)}</code></pre>${truncated ? `<small class="tool-diff-truncated">Diff truncated</small>` : ""}` : ""}
    </div>
  `
}

// Walks the tool parts of a single message and collects the latest diff per file.
function collectMessageDiffs(message) {
  const byFile = new Map()
  for (const part of message?.parts || []) {
    if (part.type !== "tool") continue
    const metadata = part.state?.metadata
    const diff = metadata?.diff
    if (typeof diff !== "string" || !diff) continue
    const filepath = metadata.filepath
      || (Array.isArray(metadata.files) && metadata.files.length ? metadata.files.join(", ") : "")
    const fileKey = filepath || part.id
    const label = Array.isArray(metadata.files) && metadata.files.length > 1
      ? `${metadata.files.length} files`
      : (filepath ? filename(filepath) : "Changes")
    // Later parts overwrite earlier ones → keep the most recent diff per file.
    byFile.set(fileKey, { fileKey, filepath, label, diff, truncated: metadata.diffTruncated === true })
  }
  return [...byFile.values()]
}

// Renders the "Changes" card inline beneath the assistant message that produced
// the edits. Diffs are scoped to this message only — disclosure keys are namespaced
// by message id so each card keeps its own open/closed state.
function renderMessageChanges(message) {
  const diffs = collectMessageDiffs(message)
  if (!diffs.length) return ""
  let additions = 0
  let deletions = 0
  for (const entry of diffs) {
    const stats = diffStats(entry.diff)
    additions += stats.additions
    deletions += stats.deletions
  }
  return `
    <div class="changes-summary">
      <div class="changes-head">
        <strong>Changes</strong>
        <span class="changes-meta">
          <span>${diffs.length} file${diffs.length === 1 ? "" : "s"}</span>
          <span class="tool-diff-stats"><span class="diff-add">+${additions}</span><span class="diff-del">-${deletions}</span></span>
        </span>
      </div>
      <div class="changes-list">
        ${diffs.map((entry) => renderDiffRow(`changes:${message.id}:${entry.fileKey}`, entry)).join("")}
      </div>
    </div>
  `
}

function renderToolArtifacts(metadata) {
  const artifacts = Array.isArray(metadata?.artifacts) ? metadata.artifacts : []
  const warnings = Array.isArray(metadata?.warnings) ? metadata.warnings : []
  if (!artifacts.length && !warnings.length) return ""
  return `
    <div class="tool-artifacts ${metadata?.quality === "warning" ? "warning" : ""}">
      ${artifacts.map((artifact) => `
        <button class="artifact-chip" data-open-artifact="${escapeHtml(artifact.path)}" title="${escapeHtml(artifact.path)}">
          ${icon("doc")}<span><strong>${escapeHtml(artifact.filename)}</strong><small>${escapeHtml(artifact.path)}</small></span>
        </button>
      `).join("")}
      ${warnings.map((warning) => `<small class="artifact-warning">${escapeHtml(warning)}</small>`).join("")}
    </div>
  `
}

function renderThinkingRow() {
  return `<div class="msg-ai stream-row"><div class="thinking"><i></i><i></i><i></i><span>Thinking</span></div></div>`
}

function renderRetryRow(status) {
  return `<div class="msg-ai stream-row"><div class="retry-row"><strong>Retrying${Number.isInteger(status.attempt) ? ` attempt ${status.attempt}` : ""}</strong>${status.message ? `<span>${escapeHtml(status.message)}</span>` : ""}</div></div>`
}

function selectableCommands() {
  return state.commands.filter((command) => command.source === "command" || command.source === "skill")
}

function commandCandidates(query = "") {
  const needle = String(query || "").toLowerCase()
  return selectableCommands().filter((command) => String(command.name || "").toLowerCase().startsWith(needle))
}

function findCommand(name) {
  const needle = String(name || "").toLowerCase()
  return selectableCommands().find((command) => String(command.name || "").toLowerCase() === needle) || null
}

function renderCommandMenu() {
  if (!state.commandMenu.open) return ""
  const candidates = commandCandidates(state.commandMenu.query)
  const rows = candidates.length
    ? candidates.map((command, position) => `
        <button class="pop-item cmd-item ${position === state.commandMenu.index ? "active" : ""}" data-command="${escapeHtml(command.name)}">
          <span><strong>/${escapeHtml(command.name)}</strong><small>${escapeHtml(command.description || "")}</small></span>
          <span class="cmd-source">${escapeHtml(command.source)}</span>
        </button>`).join("")
    : `<div class="pop-empty">No matching commands.</div>`
  return `<div class="pop pop-up cmd-pop"><div class="pop-label">Commands</div>${rows}</div>`
}

function renderComposer(project, dock = false) {
  const planOn = state.mode === "plan"
  const model = selectedModel()
  const abortable = threadAbortable()
  return `
    <div class="composer">
      <div class="ta-wrap">
        ${renderCommandMenu()}
        <textarea id="promptInput" rows="1" placeholder="${dock ? "Reply to" : "Describe a task for"} ${escapeHtml(project.name)}...">${escapeHtml(state.promptDraft)}</textarea>
      </div>
      ${renderAttachmentChips(state.pendingAttachments, { removable: true })}
      <div class="composer-bar">
        <div class="popover-anchor">
          <button class="icon-btn" data-popover="plus" title="More">${icon("plus")}</button>
          ${state.popover === "plus" ? `<div class="pop pop-up plus-pop">
            <button class="pop-item" data-action="attachment">${icon("attach")}<span><strong>Add photos & files</strong></span></button>
            <div class="pop-divider"></div>
            <button class="pop-toggle ${planOn ? "on" : ""}" data-action="togglePlanMode" aria-pressed="${planOn}" title="${planOn ? "Plan mode on - reads only, proposes a plan first" : "Plan mode off - Execution mode reads & edits files"}">
              ${icon("ask")}<span>Plan mode</span><span class="switch ${planOn ? "on" : ""}"></span>
            </button>
          </div>` : ""}
        </div>
        <span class="mode-label ${planOn ? "plan" : ""}">${planOn ? "Plan" : "Execution"}</span>
        <span class="spacer"></span>
        <div class="popover-anchor">
          <button class="pill" data-popover="model">${icon("sparkle")}<span>${escapeHtml(model?.name || "No model configured")}</span>${icon("chevDown")}</button>
          ${state.popover === "model" ? `<div class="pop pop-up model-pop"><div class="pop-label">Model</div>${modelOptions().map((item) => `<button class="pop-item" data-model="${escapeHtml(item.key)}"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.sub)}</small></span>${item.key === state.selectedModelKey ? icon("check") : ""}</button>`).join("") || `<div class="pop-empty">Add a model in Config.</div>`}</div>` : ""}
        </div>
        <button class="send ${abortable || state.promptDraft.trim() ? "" : "disabled"}" data-action="${abortable ? "abortSession" : "sendPrompt"}" title="${abortable ? "Stop response" : "Send"}" aria-label="${abortable ? "Stop response" : "Send"}">${icon(abortable ? "stop" : "arrowUp")}</button>
      </div>
    </div>
  `
}

function renderProjectsScreen() {
  return `
    <main class="main">
      ${renderHeader("Projects", `${state.projects.length} local project${state.projects.length === 1 ? "" : "s"}`)}
      <div class="admin-content">
        <section class="admin-panel">
          <div class="panel-head"><div><h1>Local projects</h1><p>Folder entries stay on this machine.</p></div><button class="primary-btn" data-action="addProject">${icon("plus")}Add</button></div>
          <div class="project-cards">
            ${state.projects.length ? state.projects.map((project) => `
              <article class="project-card ${project.id === state.activeProjectId ? "active" : ""}">
                <button class="project-main" data-open-project="${escapeHtml(project.id)}"><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.path)}</span></button>
                <button class="small-icon-btn" data-rename-project="${escapeHtml(project.id)}" title="Rename">${icon("edit")}</button>
                <button class="small-icon-btn danger" data-remove-project="${escapeHtml(project.id)}" title="Remove">${icon("trash")}</button>
              </article>
            `).join("") : `<div class="admin-empty">Add a folder to start.</div>`}
          </div>
        </section>
      </div>
    </main>
  `
}

function renderConfigScreen() {
  const provider = currentProvider()
  const modelLines = Object.entries(provider?.models || {}).map(([id, model]) => `${id}${model?.name && model.name !== id ? ` = ${model.name}` : ""}`).join("\n")
  const pluginLines = Array.isArray(state.config?.plugin) ? state.config.plugin.join("\n") : ""
  const configJson = redactedConfigJson()
  return `
    <main class="main">
      ${renderHeader("Config", state.configPath)}
      <div class="admin-content config-grid">
        <section class="admin-panel">
          <div class="panel-head"><div><h1>Provider</h1><p>OpenAI-compatible local config</p></div><button class="primary-btn" data-action="saveConfig">${icon("save")}Save</button></div>
          <div class="form">
            <label>Provider ID<input readonly value="${escapeHtml(state.providerId)}"></label>
            <label>NPM package<input readonly value="${escapeHtml(provider?.npm || "@ai-sdk/openai-compatible")}"></label>
            <label>Name<input readonly value="${escapeHtml(provider?.name || "")}"></label>
            <label>baseURL<input data-field="providerBaseURL" value="${escapeHtml(provider?.options?.baseURL || "")}"></label>
            <label>apiKey<input type="password" autocomplete="off" data-field="providerApiKey" value="${escapeHtml(provider?.options?.apiKey || "")}"></label>
            <label>Models<textarea readonly rows="5">${escapeHtml(modelLines)}</textarea></label>
            <div class="model-capabilities">
              <div><strong>Model capabilities</strong><small>Comma-separated OpenCode modalities. Include <code>pdf</code> to send PDF attachments directly.</small></div>
              ${Object.entries(provider?.models || {}).map(([id, model]) => `
                <div class="model-capability">
                  <strong>${escapeHtml(id)}</strong>
                  <label>Input modalities<input data-model-id="${escapeHtml(id)}" data-model-modalities="input" value="${escapeHtml(modalityList(model, "input"))}"><small class="field-error" data-model-error="${escapeHtml(id)}">${escapeHtml(modalityError(id))}</small></label>
                  <label>Output modalities<input readonly value="${escapeHtml(modalityList(model, "output"))}"></label>
                </div>
              `).join("") || `<div class="config-note">Add a model to configure its modalities.</div>`}
            </div>
          </div>
        </section>
        <section class="admin-panel">
          <div class="panel-head"><div><h1>Plugins</h1><p>${providerEntries().length} configured provider${providerEntries().length === 1 ? "" : "s"}</p></div><button class="secondary-btn" data-action="addSuperpowers">${icon("plus")}Superpowers</button></div>
          <div class="provider-tabs">${providerEntries().map(([id]) => `<button class="${id === state.providerId ? "active" : ""}" data-provider="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join("")}</div>
          <label>Plugin list<textarea data-field="plugins" rows="9">${escapeHtml(pluginLines)}</textarea></label>
          <div class="config-note">Config file: ${escapeHtml(state.configPath)}</div>
        </section>
        <section class="admin-panel skills-panel">
          <div class="panel-head"><div><h1>Skills</h1><p>Bundled and custom OpenCode skills loaded from this app profile.</p></div><button class="secondary-btn" data-action="openSkillUpload">${icon("arrowUp")}Upload skill</button></div>
          <div class="skill-groups">
            <div class="skill-group">
              <div class="skill-group-title"><strong>Built-in skills</strong><small>Bundled locally and available offline.</small></div>
              <div class="skill-list">
                ${BUILT_IN_SKILLS.map((skill) => `
                  <label class="skill-row">
                    <span><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.description)}</small></span>
                    <input type="checkbox" data-skill-toggle="${escapeHtml(skill.name)}" ${skillEnabled(skill.name) ? "checked" : ""}>
                  </label>
                `).join("")}
              </div>
            </div>
            <div class="skill-group">
              <div class="skill-group-title"><strong>Custom skills</strong><small>Installed under the app-managed OpenCode profile.</small></div>
              <div class="skill-list">
                ${state.customSkills.length ? state.customSkills.map((skill) => `
                  <div class="skill-row custom-skill-row">
                    <span><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.description || skill.path || "")}</small></span>
                    <span class="skill-status">${icon("check")}Installed</span>
                  </div>
                `).join("") : `<div class="admin-empty">Upload a .zip or .skill archive to add a custom skill.</div>`}
              </div>
            </div>
          </div>
          <div class="config-note">Profile skills directory: ${escapeHtml(state.configPath.replace(/opencode\.json$/, "skills"))}</div>
        </section>
        <section class="admin-panel config-json-panel">
          <div class="panel-head"><div><h1>App profile JSON</h1><p>Complete OpenCode config managed by this desktop app.</p></div></div>
          <label>Effective config<textarea class="config-json" readonly rows="20">${escapeHtml(configJson)}</textarea></label>
          <div class="config-note">Save the form above to write this profile at ${escapeHtml(state.configPath)}.</div>
        </section>
      </div>
    </main>
  `
}

function renderDiagnostics() {
  const runtime = state.runtime || {}
  const logs = runtime.logs || []
  return `
    <section class="diagnostics">
      <div class="diag-head"><strong>Runtime diagnostics</strong>${runtime.status === "running" ? `<button class="secondary-btn" data-action="stopRuntime">${icon("stop")}Stop</button>` : ""}</div>
      ${runtime.lastError ? `<div class="alert">${escapeHtml(runtime.lastError)}</div>` : ""}
      <div class="diag-grid">
        <span>cwd</span><strong>${escapeHtml(runtime.runtime?.cwd || selectedProject()?.path || "Not selected")}</strong>
        <span>config</span><strong>${escapeHtml(runtime.runtime?.configPath || state.configPath)}</strong>
        <span>profile</span><strong>${escapeHtml(runtime.runtime?.configDir || "Not running")}</strong>
        <span>server</span><strong>${escapeHtml(runtime.runtime?.serverUrl || "Not running")}</strong>
      </div>
      <div class="logs">${logs.length ? logs.slice(-12).map((log) => `<div><span>${escapeHtml(log.level)}</span>${escapeHtml(log.message)}</div>`).join("") : `<div><span>log</span>No runtime logs.</div>`}</div>
    </section>
  `
}

function renderRuntimeStatus() {
  const pill = document.querySelector(".status-pill")
  if (!pill) return
  const label = runtimeLabel()
  pill.className = `status-pill ${label}`
  pill.innerHTML = `<span class="status-dot"></span>${escapeHtml(label)}`
}

function renderToast() {
  const host = document.getElementById("toastHost")
  if (!host) return
  host.innerHTML = state.toast ? `<div class="toast">${icon("check")}<span>${escapeHtml(state.toast)}</span></div>` : ""
}

function bindMessageActions(root = document) {
  root.querySelectorAll("[data-copy-message]").forEach((element) => element.addEventListener("click", () => copyMessage(element.dataset.copyMessage).catch((error) => showToast(error.message))))
}

function bindArtifactActions(root = document) {
  root.querySelectorAll("[data-open-artifact]").forEach((element) => element.addEventListener("click", () => openArtifact(element.dataset.openArtifact).catch((error) => showToast(error.message))))
}

function bindToolStepActions(root = document) {
  root.querySelectorAll("[data-tool-step]").forEach((element) => element.addEventListener("click", () => {
    const disclosure = state.toolDisclosure.get(element.dataset.toolStep)
    if (!disclosure) return
    disclosure.open = !disclosure.open
    renderThreadContent()
  }))
}

function bindDiffToggleActions(root = document) {
  root.querySelectorAll("[data-diff-toggle]").forEach((element) => element.addEventListener("click", () => {
    const disclosure = state.diffDisclosure.get(element.dataset.diffToggle)
    if (!disclosure) return
    disclosure.open = !disclosure.open
    renderThreadContent()
  }))
}

function bindFileRefActions(root = document) {
  root.querySelectorAll("[data-open-file]").forEach((element) => element.addEventListener("click", () => openDocument(element.dataset.openFile).catch((error) => showToast(error.message))))
}

function bindPendingPromptActions(root = document) {
  root.querySelectorAll("[data-question-option]").forEach((element) => element.addEventListener("click", () => {
    const requestID = element.dataset.questionOption
    const index = Number(element.dataset.questionIndex)
    const value = element.dataset.questionValue
    if (element.dataset.questionMultiple === "1") {
      const draft = questionDraft(requestID, index)
      draft.selected.has(value) ? draft.selected.delete(value) : draft.selected.add(value)
      renderThreadContent()
    } else {
      submitQuestion(requestID, index, [value]).catch((error) => showToast(error.message))
    }
  }))
  root.querySelectorAll("[data-question-other]").forEach((element) => element.addEventListener("input", () => {
    const draft = questionDraft(element.dataset.questionOther, Number(element.dataset.questionIndex))
    draft.other = element.value
  }))
  root.querySelectorAll("[data-question-other-submit]").forEach((element) => element.addEventListener("click", () => {
    const requestID = element.dataset.questionOtherSubmit
    const index = Number(element.dataset.questionIndex)
    const other = questionDraft(requestID, index).other.trim()
    if (!other) {
      showToast("Type an answer or pick an option.")
      return
    }
    submitQuestion(requestID, index, [other]).catch((error) => showToast(error.message))
  }))
  root.querySelectorAll("[data-question-submit]").forEach((element) => element.addEventListener("click", () => {
    const requestID = element.dataset.questionSubmit
    const index = Number(element.dataset.questionIndex)
    const draft = questionDraft(requestID, index)
    const answers = [...draft.selected]
    if (draft.other.trim()) answers.push(draft.other.trim())
    if (!answers.length) {
      showToast("Select at least one option.")
      return
    }
    submitQuestion(requestID, index, answers).catch((error) => showToast(error.message))
  }))
  root.querySelectorAll("[data-question-dismiss]").forEach((element) => element.addEventListener("click", () => {
    dismissQuestion(element.dataset.questionDismiss).catch((error) => showToast(error.message))
  }))
  root.querySelectorAll("[data-permission-reply]").forEach((element) => element.addEventListener("click", () => {
    replyPermission(element.dataset.permissionReply, element.dataset.permissionDecision).catch((error) => showToast(error.message))
  }))
}

function clearQuestionDrafts(requestID) {
  for (const key of [...state.questionDrafts.keys()]) {
    if (key.startsWith(`${requestID}:`)) state.questionDrafts.delete(key)
  }
}

async function submitQuestion(requestID, index, answer) {
  const request = (state.thread.pendingQuestions || []).find((item) => item.requestID === requestID)
  const questionCount = Array.isArray(request?.questions) ? request.questions.length : 1
  // The runtime expects one answer entry per question prompt in the request.
  const answers = Array.from({ length: questionCount }, (_value, i) => (i === index ? answer : []))
  if (!state.activeSessionId) throw new Error("No active session for this question.")
  await window.openworking.runtime.answerQuestion({ sessionId: state.activeSessionId, requestID, answers })
  clearQuestionDrafts(requestID)
  clearPendingQuestion(state.thread, requestID)
  renderThreadContent()
}

async function dismissQuestion(requestID) {
  if (!state.activeSessionId) throw new Error("No active session for this question.")
  await window.openworking.runtime.rejectQuestion({ sessionId: state.activeSessionId, requestID })
  clearQuestionDrafts(requestID)
  clearPendingQuestion(state.thread, requestID)
  renderThreadContent()
}

async function replyPermission(requestID, decision) {
  if (!state.activeSessionId) throw new Error("No active session for this request.")
  await window.openworking.runtime.replyPermission({ sessionId: state.activeSessionId, requestID, reply: decision })
  clearPendingPermission(state.thread, requestID)
  renderThreadContent()
}

function bindSkillUploadDrop(root = document) {
  root.querySelectorAll("[data-skill-drop]").forEach((element) => {
    element.addEventListener("dragover", (event) => {
      event.preventDefault()
      element.classList.add("dragging")
    })
    element.addEventListener("dragleave", () => {
      element.classList.remove("dragging")
    })
    element.addEventListener("drop", (event) => {
      event.preventDefault()
      element.classList.remove("dragging")
      const file = event.dataTransfer?.files?.[0]
      const filePath = file ? window.openworking.skills.pathForFile(file) : ""
      if (!filePath) {
        showToast("Drop a .zip or .skill file from disk.")
        return
      }
      uploadSkill(filePath).catch((error) => showToast(error.message))
    })
  })
}

function bindEvents() {
  document.querySelectorAll("[data-nav]").forEach((element) => element.addEventListener("click", () => {
    state.nav = element.dataset.nav
    state.popover = null
    render()
  }))
  document.querySelectorAll("[data-action]").forEach((element) => element.addEventListener("click", handleAction))
  document.querySelectorAll("[data-resizer]").forEach((element) => element.addEventListener("mousedown", startSidebarResize))
  document.querySelectorAll("[data-open-project]").forEach((element) => element.addEventListener("click", () => openProject(element.dataset.openProject)))
  document.querySelectorAll("[data-new-session]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation()
    newSession(element.dataset.newSession)
  }))
  document.querySelectorAll("[data-session-id]").forEach((element) => element.addEventListener("click", () => selectSession(element.dataset.projectId, element.dataset.sessionId)))
  document.querySelectorAll("[data-session-menu]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation()
    const id = element.dataset.sessionMenu
    state.sessionMenu = state.sessionMenu === id ? null : id
    render()
  }))
  document.querySelectorAll("[data-session-delete]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation()
    state.sessionDeleteTarget = { id: element.dataset.sessionDelete, title: element.dataset.sessionTitle || "Untitled session" }
    state.sessionMenu = null
    render()
  }))
  document.querySelectorAll("[data-stop-click]").forEach((element) => element.addEventListener("click", (event) => event.stopPropagation()))
  document.querySelectorAll("[data-show-all]").forEach((element) => element.addEventListener("click", () => {
    const id = element.dataset.showAll
    state.showAll.has(id) ? state.showAll.delete(id) : state.showAll.add(id)
    render()
  }))
  document.querySelectorAll("[data-popover]").forEach((element) => element.addEventListener("click", () => {
    state.popover = state.popover === element.dataset.popover ? null : element.dataset.popover
    render()
    document.getElementById("promptInput")?.focus()
  }))
  document.querySelectorAll("[data-model]").forEach((element) => element.addEventListener("click", () => {
    state.selectedModelKey = element.dataset.model
    state.popover = null
    render()
  }))
  document.querySelectorAll("[data-chip]").forEach((element) => element.addEventListener("click", () => sendPrompt(chips[Number(element.dataset.chip)].text)))
  document.querySelectorAll("[data-provider]").forEach((element) => element.addEventListener("click", () => {
    state.providerId = element.dataset.provider
    render()
  }))
  document.querySelectorAll("[data-field]").forEach((element) => element.addEventListener("input", () => updateConfigField(element.dataset.field, element.value)))
  document.querySelectorAll("[data-model-modalities]").forEach((element) => element.addEventListener("input", () => updateModelModalities(element.dataset.modelId, element.dataset.modelModalities, element.value)))
  document.querySelectorAll("[data-skill-toggle]").forEach((element) => element.addEventListener("change", () => {
    state.config.permission ||= {}
    state.config.permission.skill ||= {}
    state.config.permission.skill[element.dataset.skillToggle] = element.checked ? "allow" : "deny"
  }))
  document.querySelectorAll("[data-rename-project]").forEach((element) => element.addEventListener("click", () => renameProject(element.dataset.renameProject)))
  document.querySelectorAll("[data-remove-project]").forEach((element) => element.addEventListener("click", () => removeProject(element.dataset.removeProject)))
  document.querySelectorAll("[data-remove-attachment]").forEach((element) => element.addEventListener("click", () => removeAttachment(element.dataset.removeAttachment)))
  bindMessageActions()
  bindArtifactActions()
  bindToolStepActions()
  bindDiffToggleActions()
  bindFileRefActions()
  bindPendingPromptActions()
  bindSkillUploadDrop()
  document.querySelectorAll("[data-command]").forEach((element) => element.addEventListener("mousedown", (event) => {
    event.preventDefault()
    selectCommand(element.dataset.command)
  }))
  const promptInput = document.getElementById("promptInput")
  if (promptInput) {
    promptInput.addEventListener("input", () => {
      state.promptDraft = promptInput.value
      const send = document.querySelector(".send")
      if (send) send.classList.toggle("disabled", !threadAbortable() && !promptInput.value.trim())
      promptInput.style.height = "auto"
      promptInput.style.height = `${Math.min(promptInput.scrollHeight, 200)}px`
      syncCommandMenu(promptInput)
    })
    promptInput.addEventListener("keydown", (event) => {
      if (state.commandMenu.open) {
        const candidates = commandCandidates(state.commandMenu.query)
        if (event.key === "ArrowDown") {
          event.preventDefault()
          state.commandMenu.index = Math.min(state.commandMenu.index + 1, Math.max(candidates.length - 1, 0))
          paintCommandMenu()
          return
        }
        if (event.key === "ArrowUp") {
          event.preventDefault()
          state.commandMenu.index = Math.max(state.commandMenu.index - 1, 0)
          paintCommandMenu()
          return
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault()
          const choice = candidates[state.commandMenu.index]
          if (choice) selectCommand(choice.name)
          else closeCommandMenu()
          return
        }
        if (event.key === "Escape") {
          event.preventDefault()
          closeCommandMenu()
          return
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        sendPrompt(promptInput.value)
      }
    })
  }
}

// Updates only the slash-command menu DOM in place, so the textarea value/caret/focus
// survive (a full render() would rebuild the composer and drop the caret).
function paintCommandMenu() {
  const wrap = document.querySelector(".ta-wrap")
  if (!wrap) return
  const existing = wrap.querySelector(".cmd-pop")
  if (existing) existing.remove()
  const html = renderCommandMenu()
  if (html) wrap.insertAdjacentHTML("afterbegin", html)
  wrap.querySelectorAll("[data-command]").forEach((element) => element.addEventListener("mousedown", (event) => {
    event.preventDefault()
    selectCommand(element.dataset.command)
  }))
}

function syncCommandMenu(promptInput) {
  const caret = promptInput.selectionStart ?? promptInput.value.length
  const match = promptInput.value.slice(0, caret).match(/(?:^|\s)\/([\w-]*)$/)
  if (!match) {
    closeCommandMenu()
    return
  }
  state.commandMenu = { open: true, query: match[1], index: 0 }
  paintCommandMenu()
}

function closeCommandMenu() {
  state.commandMenu = { open: false, query: "", index: 0 }
  paintCommandMenu()
}

function selectCommand(name) {
  const command = findCommand(name)
  const promptInput = document.getElementById("promptInput")
  if (!command || !promptInput) {
    closeCommandMenu()
    return
  }
  const value = promptInput.value
  const caret = promptInput.selectionStart ?? value.length
  const before = value.slice(0, caret).replace(/(^|\s)\/([\w-]*)$/, `$1/${command.name} `)
  const next = `${before}${value.slice(caret)}`
  state.promptDraft = next
  state.commandMenu = { open: false, query: "", index: 0 }
  promptInput.value = next
  promptInput.focus()
  promptInput.setSelectionRange(before.length, before.length)
  promptInput.style.height = "auto"
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 200)}px`
  const send = document.querySelector(".send")
  if (send) send.classList.toggle("disabled", !threadAbortable() && !next.trim())
  paintCommandMenu()
}

function startSidebarResize(event) {
  event.preventDefault()
  const sidebar = document.querySelector(".sidebar")
  if (!sidebar) return
  const left = sidebar.getBoundingClientRect().left
  document.body.style.cursor = "col-resize"
  document.body.style.userSelect = "none"

  let width = SIDEBAR_MIN_WIDTH
  const onMove = (moveEvent) => {
    width = setSidebarWidth(moveEvent.clientX - left)
  }
  const onUp = () => {
    document.removeEventListener("mousemove", onMove)
    document.removeEventListener("mouseup", onUp)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width))
  }
  document.addEventListener("mousemove", onMove)
  document.addEventListener("mouseup", onUp)
}

async function copyMessage(messageId) {
  const message = state.thread.messages.find((item) => item.id === messageId)
  const text = message ? messageCopyText(message) : ""
  if (!text) return
  await window.openworking.clipboard.writeText(text)
  showToast("Message copied")
}

async function openArtifact(artifactPath) {
  await window.openworking.artifacts.open(artifactPath)
  showToast("Artifact opened")
}

async function handleAction(event) {
  try {
    const action = event.currentTarget.dataset.action
    if (action === "addProject") await addProject()
    if (action === "collapseAll") {
      state.expanded.clear()
      render()
    }
    if (action === "toggleSidebar") {
      state.sidebarCollapsed = !state.sidebarCollapsed
      render()
    }
    if (action === "newSession") await newSession(state.activeProjectId)
    if (action === "togglePlanMode") {
      // Keep the "+" popover open so the user can see the switch flip.
      state.mode = state.mode === "plan" ? "agent" : "plan"
      render()
    }
    if (action === "acceptPlan") await acceptPlan()
    if (action === "rejectPlan") await rejectPlan()
    if (action === "revisePlan") document.getElementById("promptInput")?.focus()
    if (action === "openPlanText") openInlinePlan(latestPlanText())
    if (action === "sendPrompt") await sendPrompt(document.getElementById("promptInput")?.value)
    if (action === "abortSession") await abortSession()
    if (action === "saveConfig") await saveConfig()
    if (action === "addSuperpowers") addSuperpowers()
    if (action === "openSkillUpload") {
      state.skillUploadOpen = true
      state.skillUploadError = null
      render()
    }
    if (action === "closeSkillUpload") {
      state.skillUploadOpen = false
      state.skillUploadError = null
      render()
    }
    if (action === "chooseSkillArchive") await uploadSkill()
    if (action === "cancelDeleteSession") {
      state.sessionDeleteTarget = null
      render()
    }
    if (action === "confirmDeleteSession") {
      const target = state.sessionDeleteTarget
      state.sessionDeleteTarget = null
      render()
      if (target) await deleteSession(target.id)
    }
    if (action === "toggleDiagnostics") {
      state.diagnosticsOpen = !state.diagnosticsOpen
      render()
    }
    if (action === "stopRuntime") {
      await window.openworking.runtime.stop()
      render()
    }
    if (action === "closeDocument") closeDocument()
    if (action === "attachment") {
      // Triggered from the "+" popover - close it so the menu does not stay open.
      state.popover = null
      await pickAttachments()
    }
    if (action === "startUpdate") await startUpdateDownload()
  } catch (error) {
    showToast(error.message)
  }
}

async function addProject() {
  const project = await window.openworking.projects.add()
  if (!project) return
  state.projects = await window.openworking.projects.list()
  await newSession(project.id)
}

async function pickAttachments() {
  const picked = await window.openworking.attachments.pick()
  const known = new Set(state.pendingAttachments.map((attachment) => attachment.id))
  for (const attachment of picked) {
    if (known.has(attachment.id)) continue
    known.add(attachment.id)
    state.pendingAttachments.push(attachment)
  }
  render()
  document.getElementById("promptInput")?.focus()
}

async function removeAttachment(id) {
  state.pendingAttachments = state.pendingAttachments.filter((attachment) => attachment.id !== id)
  render()
  document.getElementById("promptInput")?.focus()
  await window.openworking.attachments.discard([id])
}

async function clearPendingAttachments() {
  const ids = state.pendingAttachments.map((attachment) => attachment.id)
  state.pendingAttachments = []
  if (ids.length) await window.openworking.attachments.discard(ids)
}

async function abortSession() {
  if (!state.activeSessionId || !threadAbortable()) return
  await window.openworking.runtime.abortSession({ sessionId: state.activeSessionId })
  state.thread.status = { type: "idle" }
  updateComposerSubmitButton()
  renderThreadContent()
}

async function openProject(projectId, { selectLatest = true } = {}) {
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) return
  const sameProject = state.activeProjectId === projectId
  if (sameProject && state.expanded.has(projectId) && state.nav === "session" && state.runtime?.project?.id === projectId) {
    state.expanded.delete(projectId)
    render()
    return
  }
  await clearPendingAttachments()
  state.activeProjectId = projectId
  state.activeSessionId = null
  resetActiveThread()
  state.nav = "session"
  state.expanded.add(projectId)
  state.loading = true
  let scrollLatest = false
  render()
  try {
    state.runtime = await window.openworking.runtime.openProject(project)
    state.commands = await window.openworking.runtime.listCommands().catch(() => [])
    state.commandMenu = { open: false, query: "", index: 0 }
    const sessions = await window.openworking.runtime.listSessions()
    state.sessionsByProject[projectId] = sessions
    if (selectLatest && sessions[0]) {
      state.activeSessionId = sessions[0].id
      hydrateActiveThread(await window.openworking.runtime.listMessages({ sessionId: sessions[0].id }), state.runtime.activeSessionStatus)
      scrollLatest = true
    }
  } finally {
    state.loading = false
    render({ threadScroll: scrollLatest ? "latest" : "preserve" })
  }
}

async function newSession(projectId, { clearAttachments = true } = {}) {
  if (!projectId) return
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) return
  if (clearAttachments) await clearPendingAttachments()
  state.activeProjectId = projectId
  state.activeSessionId = null
  resetActiveThread()
  state.nav = "session"
  state.expanded.add(projectId)
  render()
  if (state.runtime?.project?.id !== projectId || state.runtime.status !== "running") {
    state.loading = true
    render()
    try {
      state.runtime = await window.openworking.runtime.openProject(project)
      state.sessionsByProject[projectId] = await window.openworking.runtime.listSessions()
    } finally {
      state.loading = false
      render()
    }
  }
  document.getElementById("promptInput")?.focus()
}

async function selectSession(projectId, sessionId) {
  await clearPendingAttachments()
  if (state.runtime?.project?.id !== projectId || state.runtime.status !== "running") {
    await openProject(projectId, { selectLatest: false })
  }
  state.activeProjectId = projectId
  state.activeSessionId = sessionId
  state.nav = "session"
  hydrateActiveThread(await window.openworking.runtime.listMessages({ sessionId }))
  render({ threadScroll: "latest" })
}

async function deleteSession(sessionId) {
  const projectId = state.activeProjectId
  try {
    await window.openworking.runtime.deleteSession({ sessionId })
  } catch (error) {
    showToast(error.message || "Could not delete session.")
    return
  }
  state.sessionsByProject[projectId] = await window.openworking.runtime.listSessions()
  if (state.activeSessionId === sessionId) {
    state.activeSessionId = null
    resetActiveThread()
  }
  state.sessionMenu = null
  render()
}

async function acceptPlan() {
  // Accepting a plan switches out of Plan mode into Execution mode (build agent)
  // and asks the agent to carry out the plan it just proposed.
  state.planAccepted = state.activeSessionId
  state.mode = "agent"
  render()
  await sendPrompt("The plan above is approved. Please execute it.")
}

async function rejectPlan() {
  // Rejecting a plan stops the current session response (if any) and dismisses the
  // proposal card. The plan is abandoned with no follow-up prompt.
  if (threadAbortable()) await abortSession()
  state.planAccepted = state.activeSessionId  // marks the proposal resolved -> card hides
  render()
}

async function sendPrompt(rawPrompt) {
  state.commandMenu = { open: false, query: "", index: 0 }
  const prompt = String(rawPrompt || "").trim()
  const project = selectedProject()
  if (!prompt || !project) return
  const commandMatch = prompt.match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/)
  const command = commandMatch && findCommand(commandMatch[1]) ? commandMatch[1] : null
  const commandArgs = command ? (commandMatch[2] || "") : ""
  const attachments = command ? [] : state.pendingAttachments.slice()
  if (state.runtime?.project?.id !== project.id || state.runtime.status !== "running") {
    await newSession(project.id, { clearAttachments: false })
  }
  if (!state.activeSessionId) {
    const title = prompt.length > 54 ? `${prompt.slice(0, 53).trim()}...` : prompt
    const session = await window.openworking.runtime.createSession({ title })
    state.activeSessionId = session.id
    state.sessionsByProject[project.id] ||= []
    state.sessionsByProject[project.id].unshift(session)
    resetActiveThread(session.id)
  }
  const optimisticId = addOptimisticUser(state.thread, prompt, attachments)
  const sentAttachmentIds = new Set(attachments.map((attachment) => attachment.id))
  state.thread.status = { type: "busy" }
  state.promptDraft = ""
  if (!command && sentAttachmentIds.size) {
    state.pendingAttachments = state.pendingAttachments.filter((attachment) => !sentAttachmentIds.has(attachment.id))
  }
  render({ threadScroll: "latest" })
  const mode = modes.find((item) => item.id === state.mode) || modes[0]
  const model = selectedModel()
  try {
    if (command) {
      await window.openworking.runtime.sendCommand({
        sessionId: state.activeSessionId,
        command,
        arguments: commandArgs,
        agent: mode.agent,
        model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined
      })
    } else {
      await window.openworking.runtime.sendPrompt({
        sessionId: state.activeSessionId,
        prompt,
        attachmentIds: attachments.map((attachment) => attachment.id),
        agent: mode.agent,
        model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined
      })
    }
    render({ threadScroll: "latest" })
  } catch (error) {
    removeOptimisticUser(state.thread, optimisticId)
    state.thread.status = { type: "idle" }
    state.promptDraft = prompt
    if (!command && attachments.length) {
      const pendingIds = new Set(state.pendingAttachments.map((attachment) => attachment.id))
      state.pendingAttachments = [
        ...attachments.filter((attachment) => !pendingIds.has(attachment.id)),
        ...state.pendingAttachments
      ]
    }
    render({ threadScroll: "latest" })
    throw error
  }
}

async function renameProject(projectId) {
  const project = state.projects.find((item) => item.id === projectId)
  const name = window.prompt("Project name", project?.name || "")
  if (name === null) return
  await window.openworking.projects.rename(projectId, name)
  state.projects = await window.openworking.projects.list()
  render()
}

async function removeProject(projectId) {
  if (state.activeProjectId === projectId) await clearPendingAttachments()
  await window.openworking.projects.remove(projectId)
  state.projects = await window.openworking.projects.list()
  delete state.sessionsByProject[projectId]
  if (state.activeProjectId === projectId) {
    state.activeProjectId = state.projects[0]?.id || null
    state.activeSessionId = null
    resetActiveThread()
  }
  render()
}

function updateConfigField(field, value) {
  if (field === "plugins") {
    state.config.plugin = value.split("\n").map((line) => line.trim()).filter(Boolean)
    return
  }
  const provider = ensureProvider()
  if (field === "providerBaseURL") provider.options.baseURL = value.trim()
  if (field === "providerApiKey") provider.options.apiKey = value
}

function ensureProvider() {
  state.config.provider ||= {}
  state.config.provider[state.providerId] ||= { npm: "@ai-sdk/openai-compatible", name: "", options: {}, models: {} }
  state.config.provider[state.providerId].options ||= {}
  state.config.provider[state.providerId].models ||= {}
  return state.config.provider[state.providerId]
}

function modalityList(model, type) {
  return Array.isArray(model?.modalities?.[type]) ? model.modalities[type].join(", ") : ""
}

function modalityError(modelId) {
  const invalid = invalidModalities(ensureProvider().models[modelId])
  return invalid.length ? `Unsupported modalities: ${invalid.join(", ")}` : ""
}

function parseModalities(value) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))]
}

function invalidModalities(model) {
  return Array.isArray(model?.modalities?.input)
    ? model.modalities.input.filter((item) => !ALLOWED_MODEL_MODALITIES.includes(item))
    : []
}

function updateModelModalities(modelId, type, value) {
  const model = ensureProvider().models[modelId]
  if (!model || type !== "input") return
  model.modalities ||= {}
  model.modalities.input = parseModalities(value)
  const invalid = invalidModalities(model)
  const key = `${state.providerId}/${modelId}`
  state.modalityErrors[key] = invalid.length ? `Unsupported modalities: ${invalid.join(", ")}` : ""
  const error = document.querySelector(`[data-model-error="${CSS.escape(modelId)}"]`)
  if (error) error.textContent = state.modalityErrors[key]
}

function addSuperpowers() {
  state.config.plugin = Array.isArray(state.config.plugin) ? state.config.plugin : []
  if (!state.config.plugin.includes(SUPERPOWERS_PLUGIN)) state.config.plugin.push(SUPERPOWERS_PLUGIN)
  render()
}

function redactedConfigJson() {
  const config = JSON.parse(JSON.stringify(state.config))
  for (const provider of Object.values(config?.provider || {})) {
    if (provider.options?.apiKey) provider.options.apiKey = "[redacted]"
  }
  return JSON.stringify(config, null, 2)
}

function assertValidInputModalities() {
  for (const provider of Object.values(state.config?.provider || {})) {
    for (const [modelId, model] of Object.entries(provider.models || {})) {
      const invalid = invalidModalities(model)
      if (invalid.length) throw new Error(`Unsupported modalities for ${modelId}: ${invalid.join(", ")}`)
    }
  }
}

async function saveConfig() {
  assertValidInputModalities()
  const result = await window.openworking.config.save(state.config)
  state.configPath = result.path
  state.config = result.config
  state.customSkills = result.customSkills || state.customSkills
  selectedModel()
  render()
  showToast("Config saved")
}

async function uploadSkill(filePath = null) {
  if (state.skillUploading) return
  state.skillUploading = true
  state.skillUploadError = null
  render()
  try {
    const installed = filePath
      ? await window.openworking.skills.installPath(filePath)
      : await window.openworking.skills.upload()
    if (!installed) return
    await reloadConfig()
    state.skillUploadOpen = false
    render()
    showToast(`Installed ${installed.name}`)
  } catch (error) {
    state.skillUploadError = error.message
    render()
  } finally {
    state.skillUploading = false
    render()
  }
}

async function reloadConfig() {
  const configResult = await window.openworking.config.get()
  state.configPath = configResult.path
  state.config = configResult.config
  state.customSkills = configResult.customSkills || []
  state.providerId = Object.keys(state.config.provider || {})[0] || "gateway"
  selectedModel()
}

document.addEventListener("click", (event) => {
  if (state.commandMenu.open && !event.target.closest(".composer")) closeCommandMenu()
  let dirty = false
  if (state.sessionMenu && !event.target.closest(".session-row-wrap")) {
    state.sessionMenu = null
    dirty = true
  }
  if (state.popover && !event.target.closest(".popover-anchor")) {
    state.popover = null
    dirty = true
  }
  if (dirty) render()
})

loadInitialState().catch((error) => {
  document.getElementById("root").innerHTML = `<pre class="fatal">${escapeHtml(error.stack || error.message)}</pre>`
})
