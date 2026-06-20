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
  { name: "translate-document", description: "Translate PDF, DOCX and Markdown files into new structure-preserving document artifacts." },
  { name: "translate-office-document", description: "Translate PPTX and XLSX files; for XLSX, create a new translated workbook or add a translated sheet beside each original in place." },
  { name: "webapp-testing", description: "Test local web applications with focused browser automation." }
]

const icons = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 5H6.5A2.5 2.5 0 0 0 4 7.5v10A2.5 2.5 0 0 0 6.5 20h10a2.5 2.5 0 0 0 2.5-2.5V12"/><path d="M18.4 3.6a2 2 0 0 1 2.8 2.8L12.8 15l-3.8 1 1-3.8z"/></svg>',
  chevRight: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  chevDown: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  attach: '<svg viewBox="0 0 24 24"><path d="M19 11.5 12.5 18a4 4 0 0 1-5.7-5.7l7-7a2.7 2.7 0 0 1 3.8 3.8l-7 7a1.3 1.3 0 0 1-1.9-1.9l6.3-6.3"/></svg>',
  agent: '<svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/></svg>',
  ask: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 1.8-2 3M12 16.5h.01"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24"><path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z"/></svg>',
  blocks: '<svg viewBox="0 0 24 24"><path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2"/><rect x="14" y="2" width="8" height="8" rx="1"/></svg>',
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
  sidebarRight: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>',
  chevUpDown: '<svg viewBox="0 0 24 24"><path d="m8 9 4-4 4 4"/><path d="m16 15-4 4-4-4"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M7 18a4.2 4.2 0 0 1-.4-8.38 5 5 0 0 1 9.61-1.1A3.8 3.8 0 0 1 17.5 18z"/></svg>',
  logout: '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  server: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'
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

// Curated catalog of well-known remote MCP servers, surfaced as one-click presets in the
// Extensions marketplace. This is a static prefill list (no network call, no remote
// registry) — clicking a card just opens the Add Custom App modal pre-filled. `needsClientApp`
// marks servers that do NOT support dynamic client registration and require a pre-registered
// OAuth app (clientId/clientSecret), e.g. Slack.
const MCP_PRESETS = [
  {
    id: "slack",
    name: "Slack",
    url: "https://mcp.slack.com/mcp",
    blurb: "Search channels, read and post messages.",
    icon: "activity",
    iconUrl: "https://images.icon-icons.com/2699/PNG/512/slack_logo_icon_170727.png",
    needsClientApp: true,
    docsUrl: "https://docs.slack.dev/ai/mcp/"
  },
  {
    id: "backlog",
    name: "Backlog",
    // Backlog is a local stdio MCP server (run via npx), not a remote URL. It requires the
    // BACKLOG_DOMAIN + BACKLOG_API_KEY env vars — pre-filled here with blank values for the user.
    type: "local",
    command: "npx backlog-mcp-server",
    env: [
      { key: "BACKLOG_DOMAIN", value: "" },
      { key: "BACKLOG_API_KEY", value: "" }
    ],
    blurb: "Manage projects, issues, and pull requests on Nulab Backlog.",
    icon: "blocks",
    iconUrl: "https://devio2023-media.developers.io/wp-content/uploads/2018/02/backlog-favicon.svg",
    docsUrl: "https://github.com/nulab/backlog-mcp-server"
  }
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
  userMessageFileRefs,
  messageText,
  removeOptimisticUser,
  resetThread,
  threadIsBusy
} = window.OpenWorkingThreadStream

const { parseUnifiedDiff } = window.OpenWorkingDiffView

const state = {
  nav: "session",
  projects: [],
  activeProjectId: null,
  activeSessionId: null,
  sessionsByProject: {},
  // One live thread per session, keyed by sessionId. Background sessions keep their
  // thread (and its streaming state) alive while another session is on screen, so a
  // long task in session A is not lost when the user switches to / creates session B.
  // The `null` key holds the "new session" draft thread before the session exists.
  threads: new Map(),
  toolDisclosure: new Map(),
  document: null,
  expanded: new Set(),
  showAll: new Set(),
  runtime: null,
  configPath: "",
  config: null,
  customSkills: [],
  mcpServers: [],
  mcpStatus: {},                   // name -> "connected" | "needs_auth" | "failed" | "disabled"
  mcpStatusError: {},              // name -> opencode's real failure reason (from GET /mcp), if any
  mcpAuthenticating: {},           // name -> true while an auth flow is in progress
  skillsTab: "skills",             // skills | mcp (mcp tab is the Extensions marketplace)
  mcpModalOpen: false,
  mcpSaving: false,
  mcpError: null,
  mcpErrorTarget: null,            // server name an inline error belongs to, or null for panel-level
  // Draft for the Add/Edit Custom App modal:
  // { name, type, url, command, headers: [{key,value}],
  //   oauthMode: "auto"|"custom"|"disabled", oauthClientId, oauthClientSecret, oauthScope,
  //   oauthAdvancedOpen, hasStoredSecret }
  mcpDraft: null,
  mcpEditTarget: null,             // name of the server being edited, or null when adding
  mcpDeleteTarget: null,           // { name } của MCP server chờ xác nhận xóa
  mcpRemoving: false,
  modalityErrors: {},
  providerId: "gateway",
  mode: "agent",
  planAutoOpened: null,
  planAccepted: null,
  planProposal: null,
  selectedModelKey: "",
  promptDraft: "",
  pendingAttachments: [],
  pendingFileMentions: [],
  commands: [],
  commandMenu: { open: false, query: "", index: 0 },
  fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
  popover: null,
  sessionMenu: null,          // sessionId đang mở menu, hoặc null
  sessionDeleteTarget: null,  // { id, title } của session chờ xác nhận xóa trong modal
  sessionRenameTarget: null,  // { sessionId, projectId, title, label } của session đang đổi tên
  sessionRenameDraft: "",
  sessionRenameError: null,
  sessionRenaming: false,
  sessionRenameAutoFocus: false,
  sessionRenameFocusId: null,
  projectMenu: null,          // projectId đang mở menu "...", hoặc null
  projectRenameTarget: null,  // { projectId, name } của project đang đổi tên
  projectRenameDraft: "",
  projectRenameError: null,
  projectRenaming: false,
  projectRenameAutoFocus: false,
  projectDeleteTarget: null,  // { id, name } của project chờ xác nhận gỡ trong modal
  projectRemoving: false,
  sidebarCollapsed: false,
  rightSidebarOpen: false,
  fileTreeProjectId: null,
  fileTreeLoading: new Set(),
  fileTreeError: "",
  fileTreeExpanded: new Set(),
  fileTreeChildren: new Map(),
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
  settingsSection: "provider",     // provider | account | advanced
  skillPreview: null,              // { name, builtIn } của skill đang xem, hoặc null
  skillPreviewContent: null,
  skillPreviewLoading: false,
  skillPreviewError: null,
  skillUninstalling: false,
  // Per-question multi-select draft state, keyed by `${requestID}:${questionIndex}`:
  // { selected: Set<value>, other: string }
  questionDrafts: new Map()
}

const THREAD_SCROLL_THRESHOLD = 80
const SIDEBAR_WIDTH_KEY = "openworking:sidebar-w"
const SIDEBAR_MIN_WIDTH = 200
const SIDEBAR_MAX_WIDTH = 480
const RIGHT_FILE_WIDTH_KEY = "openworking:right-file-sidebar-w"
const RIGHT_FILE_MIN_WIDTH = 180
const RIGHT_FILE_MAX_WIDTH = 420
const DOCUMENT_WIDTH_KEY = "openworking:document-viewer-w"
const DOCUMENT_MIN_WIDTH = 300
const DOCUMENT_MAX_WIDTH = 900

function setSidebarWidth(width) {
  const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)))
  document.documentElement.style.setProperty("--sidebar-w", `${clamped}px`)
  return clamped
}

function setRightFileSidebarWidth(width) {
  const clamped = Math.max(RIGHT_FILE_MIN_WIDTH, Math.min(RIGHT_FILE_MAX_WIDTH, Math.round(width)))
  document.documentElement.style.setProperty("--right-sidebar-w", `${clamped}px`)
  return clamped
}

function setDocumentViewerWidth(width) {
  const clamped = Math.max(DOCUMENT_MIN_WIDTH, Math.min(DOCUMENT_MAX_WIDTH, Math.round(width)))
  document.documentElement.style.setProperty("--document-w", `${clamped}px`)
  return clamped
}

function applyStoredSidebarWidth() {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  if (Number.isFinite(stored) && stored > 0) setSidebarWidth(stored)
}

function applyStoredRightFileSidebarWidth() {
  const stored = Number(localStorage.getItem(RIGHT_FILE_WIDTH_KEY))
  if (Number.isFinite(stored) && stored > 0) setRightFileSidebarWidth(stored)
}

function applyStoredDocumentViewerWidth() {
  const stored = Number(localStorage.getItem(DOCUMENT_WIDTH_KEY))
  if (Number.isFinite(stored) && stored > 0) setDocumentViewerWidth(stored)
}

applyStoredSidebarWidth()
applyStoredRightFileSidebarWidth()
applyStoredDocumentViewerWidth()

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

function resetFileTree(projectId = state.activeProjectId) {
  state.fileTreeProjectId = projectId || null
  state.fileTreeLoading.clear()
  state.fileTreeError = ""
  state.fileTreeExpanded.clear()
  state.fileTreeChildren.clear()
  if (state.fileMentionMenu.projectId !== (projectId || null)) {
    state.fileMentionMenu = { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: projectId || null, loadPromise: null }
  }
}

function closeFileMentionMenu() {
  state.fileMentionMenu.open = false
  state.fileMentionMenu.query = ""
  state.fileMentionMenu.index = 0
  paintPromptAssistMenu()
}

function selectableProjectFiles() {
  if (state.fileMentionMenu.projectId !== state.activeProjectId) return []
  return state.fileMentionMenu.files
}

function fileMentionCandidates(query = "") {
  const needle = String(query || "").toLowerCase()
  const files = selectableProjectFiles()
  if (!needle) return files.slice(0, 12)
  const basenameStarts = []
  const pathStarts = []
  const basenameIncludes = []
  const pathIncludes = []
  for (const filePath of files) {
    const lowerPath = filePath.toLowerCase()
    const lowerName = filename(filePath).toLowerCase()
    if (lowerName.startsWith(needle)) basenameStarts.push(filePath)
    else if (lowerPath.startsWith(needle)) pathStarts.push(filePath)
    else if (lowerName.includes(needle)) basenameIncludes.push(filePath)
    else if (lowerPath.includes(needle)) pathIncludes.push(filePath)
  }
  return [...basenameStarts, ...pathStarts, ...basenameIncludes, ...pathIncludes].slice(0, 12)
}

async function ensureProjectFileCandidates() {
  const project = selectedProject()
  if (!project) return []
  if (state.fileMentionMenu.projectId !== project.id) {
    state.fileMentionMenu = { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: project.id, loadPromise: null }
  }
  if (state.fileMentionMenu.files.length) return state.fileMentionMenu.files
  if (state.fileMentionMenu.loadPromise) return state.fileMentionMenu.loadPromise

  const crawl = async (directoryPath = "") => {
    const listing = await window.openworking.files.list({
      directoryPath,
      options: { mode: "visible-openable-files", recursive: true }
    })
    return (listing.children || []).filter((child) => child.type === "file" && child.openable).map((child) => child.path)
  }

  state.fileMentionMenu.loading = true
  state.fileMentionMenu.error = ""
  paintPromptAssistMenu()
  state.fileMentionMenu.loadPromise = crawl("")
    .then((files) => {
      if (state.fileMentionMenu.projectId === project.id) {
        state.fileMentionMenu.files = files.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
      }
      return state.fileMentionMenu.files
    })
    .catch((error) => {
      if (state.fileMentionMenu.projectId === project.id) {
        state.fileMentionMenu.error = error.message || "Could not load project files."
      }
      return []
    })
    .finally(() => {
      if (state.fileMentionMenu.projectId === project.id) {
        state.fileMentionMenu.loading = false
        state.fileMentionMenu.loadPromise = null
      }
      paintPromptAssistMenu()
    })
  return state.fileMentionMenu.loadPromise
}

function projectSessions(projectId) {
  return state.sessionsByProject[projectId] || []
}

function selectedSession() {
  return projectSessions(state.activeProjectId).find((session) => session.id === state.activeSessionId) || null
}

// Returns the live thread for a session, creating and storing one on first access.
// `null` is a valid key — it holds the draft thread for an unsaved "new session".
function ensureThread(sessionId = state.activeSessionId) {
  let thread = state.threads.get(sessionId)
  if (!thread) {
    thread = createThreadStream(sessionId)
    state.threads.set(sessionId, thread)
  }
  return thread
}

// The thread currently shown in the chat pane (the active session's thread).
function activeThread() {
  return ensureThread(state.activeSessionId)
}

// A session shows a "running" badge if either its in-memory thread is mid-flight or
// the server reports it busy (covers sessions never opened in this renderer session).
function sessionBusy(sessionId) {
  if (threadIsBusy(state.threads.get(sessionId))) return true
  return state.runtime?.sessionStatuses?.[sessionId]?.type === "busy"
}

function threadAbortable() {
  return threadIsBusy(activeThread())
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

function sessionDisplayTitle(session) {
  return session?.title || session?.label || "Untitled session"
}

function hydrateActiveThread(messages, status) {
  const thread = activeThread()
  // A fresh thread (no messages yet) is being populated from the server for the
  // first time → clear the per-session view state. An already-live background thread
  // keeps its disclosure/document state so returning to it looks unchanged.
  if (thread.sessionId !== state.activeSessionId || !thread.messages.length) {
    state.document = null
  }
  hydrateThread(thread, state.activeSessionId, messages, status)
}

// Resets the *draft* thread used before a session exists. Switching to a real
// session never resets that session's thread — its history must survive.
function resetActiveThread(sessionId = null) {
  state.document = null
  state.planAutoOpened = null
  state.planAccepted = null
  state.planProposal = null
  state.threads.set(sessionId, resetThread(ensureThread(sessionId), sessionId))
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
  state.mcpServers = activeConfig.mcp || []
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
  renderSessionBadges()
}

const SESSION_LIFECYCLE_EVENTS = new Set(["session.status", "session.idle", "session.aborted", "session.error"])

function handleRuntimeStream(event) {
  // Connection (re)established → reconcile every known thread from the server.
  if (event?.type === "runtime.stream.connected") {
    scheduleRefresh()
    return
  }
  // Route each event to its own session's thread, even if that session is not on
  // screen — this is what keeps a backgrounded session streaming. We only touch a
  // thread we already track (active or previously opened); unknown sessions are
  // picked up lazily by the periodic refresh when the user opens them.
  // MCP connection-status events carry no sessionID; update the badge in place.
  if (event?.type && event.type.startsWith("mcp.")) {
    handleMcpStreamEvent(event)
    return
  }
  const sessionId = event?.sessionID
  if (!sessionId) return
  const thread = state.threads.get(sessionId)
  if (!thread) {
    // We are not tracking this session's thread yet, but a lifecycle change still
    // moves its sidebar badge (busy/idle) — repaint badges without a full render.
    if (SESSION_LIFECYCLE_EVENTS.has(event.type)) renderSessionBadges()
    return
  }
  const result = applyThreadEvent(thread, event)
  const isActive = sessionId === state.activeSessionId
  if (SESSION_LIFECYCLE_EVENTS.has(event.type)) {
    if (isActive) updateComposerSubmitButton()
    renderSessionBadges()
  }
  if (result.changed && isActive) {
    maybeAutoOpenPlan()
    scheduleThreadRender()
  }
  if (result.reconcile) scheduleRefresh()
}

// Live-update MCP server connection status from runtime stream events. Only repaint
// when the MCP panel is on screen to avoid spurious full renders.
function handleMcpStreamEvent(event) {
  if (!event?.name) return
  if (event.type === "mcp.browser.open.failed") {
    // The browser failed to open automatically; surface the link so the user can
    // complete authentication manually.
    state.mcpError = `Could not open the browser. Open this link to authenticate ${event.name}: ${event.url}`
    state.mcpErrorTarget = event.name
  } else if (event.status) {
    state.mcpStatus = { ...state.mcpStatus, [event.name]: event.status }
    if (event.status !== "needs_auth") state.mcpAuthenticating = { ...state.mcpAuthenticating, [event.name]: false }
  }
  if (state.nav === "skills" && state.skillsTab === "mcp") render()
}

// Apply a status array from GET /mcp into the status + error maps.
function applyMcpStatusList(status) {
  const map = {}
  const errors = {}
  for (const entry of Array.isArray(status) ? status : []) {
    if (!entry?.name) continue
    map[entry.name] = entry.status
    if (entry.error) errors[entry.name] = entry.error
  }
  state.mcpStatus = map
  state.mcpStatusError = errors
}

// Fetch MCP connection status from the runtime and repaint the panel. Errors are
// swallowed (e.g. no project open yet) so the panel still renders.
async function refreshMcpStatus() {
  try {
    applyMcpStatusList(await window.openworking.mcp.status())
    if (state.nav === "skills" && state.skillsTab === "mcp") render()
  } catch {
    // Runtime not ready; leave status empty.
  }
}

function activePlanProposal() {
  const proposal = state.planProposal
  return proposal?.sessionId === state.activeSessionId ? proposal : null
}

function latestPlanMessage() {
  const proposal = activePlanProposal()
  if (!proposal) return null
  const messages = activeThread().messages || []
  for (let i = messages.length - 1; i > proposal.afterMessageIndex; i--) {
    if (messages[i].role === "assistant") return messages[i]
  }
  return null
}

function latestPlanFileRef() {
  const message = latestPlanMessage()
  if (!message) return null
  return messageFileRefs(message)[0] || null
}

function latestPlanText() {
  const message = latestPlanMessage()
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
  showDocument({
    requestedPath: INLINE_PLAN_PATH, path: "", name: "Plan", relativePath: "Plan",
    content: text, loading: false, error: "", truncated: false, renderMode: "markdown"
  })
}

function maybeAutoOpenPlan() {
  if (!activePlanProposal()) return
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
  const status = activeThread().status?.type
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
  if (!text) return ""
  const renderer = new marked.Renderer()
  renderer.code = ({ text: code, lang }) => {
    const language = (lang || "").match(/\S+/)?.[0] || ""
    if (language.toLowerCase() === "mermaid") {
      return `<div class="mermaid-block" data-mermaid-pending="true"><pre class="mermaid-source"><code>${escapeHtml(code)}</code></pre></div>`
    }
    const normalized = hljs.getLanguage(language) ? language : "plaintext"
    const highlighted = normalized === "plaintext"
      ? escapeHtml(code)
      : hljs.highlight(code, { language: normalized }).value
    return `<pre><code class="hljs language-${escapeHtml(normalized)}">${highlighted}</code></pre>\n`
  }
  return marked.parse(text, {
    renderer
  })
}

let mermaidInitialized = false
let mermaidRenderId = 0

function ensureMermaid() {
  if (!window.mermaid) return false
  if (!mermaidInitialized) {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark"
    })
    mermaidInitialized = true
  }
  return true
}

function markMermaidError(block, source, message) {
  block.classList.add("error")
  block.innerHTML = `
    <div class="mermaid-error">${escapeHtml(message || "Could not render Mermaid diagram.")}</div>
    <pre class="mermaid-source"><code>${escapeHtml(source)}</code></pre>
  `
}

async function renderMermaidDiagrams(root = document) {
  const blocks = [...root.querySelectorAll(".mermaid-block[data-mermaid-pending='true']")]
  if (!blocks.length) return
  if (!ensureMermaid()) {
    for (const block of blocks) {
      block.removeAttribute("data-mermaid-pending")
      const source = block.querySelector(".mermaid-source code")?.textContent || ""
      markMermaidError(block, source, "Mermaid renderer is unavailable.")
    }
    return
  }
  for (const block of blocks) {
    block.removeAttribute("data-mermaid-pending")
    const source = block.querySelector(".mermaid-source code")?.textContent || ""
    try {
      const { svg } = await window.mermaid.render(`mermaid-${++mermaidRenderId}`, source)
      if (!block.isConnected) continue
      block.classList.add("rendered")
      block.innerHTML = svg
    } catch (error) {
      if (!block.isConnected) continue
      markMermaidError(block, source, error.message)
    }
  }
}

function scheduleMermaidRender(root = document) {
  requestAnimationFrame(() => renderMermaidDiagrams(root).catch(() => {}))
}

function renderThreadContent({ threadScroll = "preserve" } = {}) {
  const inner = document.querySelector(".thread-inner")
  if (!inner) return
  const previousThreadScroll = captureThreadScroll()
  inner.innerHTML = renderThreadRows()
  bindMessageActions(inner)
  bindArtifactActions(inner)
  bindToolStepActions(inner)
  bindFileRefActions(inner)
  bindPendingPromptActions(inner)
  inner.querySelectorAll("[data-action]").forEach((element) => element.addEventListener("click", handleAction))
  scheduleMermaidRender(inner)
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
        <div class="app${state.sidebarCollapsed ? " collapsed" : ""}${state.document ? " has-doc" : ""}${state.rightSidebarOpen ? " right-open" : ""}">
          ${renderSidebar()}
          ${renderMain()}
          ${state.document ? renderDocumentViewer() : ""}
          ${state.rightSidebarOpen ? renderRightFileSidebar() : ""}
        </div>
      </div>
      ${renderForceUpdate()}
      ${renderSkillUploadModal()}
      ${renderDeleteSessionModal()}
      ${renderRenameSessionModal()}
      ${renderProjectDeleteModal()}
      ${renderProjectRenameModal()}
      ${renderMcpModal()}
      ${renderMcpDeleteModal()}
      <div id="toastHost"></div>
    </div>
  `
  bindEvents()
  renderToast()
  scheduleMermaidRender()
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

function renderRenameSessionModal() {
  const target = state.sessionRenameTarget
  if (!target) return ""
  const disableActions = state.sessionRenaming ? " disabled" : ""
  const currentLabel = sessionDisplayTitle(target)
  return `
    <div class="update-backdrop" ${state.sessionRenaming ? "" : 'data-action="cancelRenameSession"'}>
      <div class="confirm-modal rename-modal" role="dialog" aria-modal="true" aria-labelledby="renameSessionTitle" data-stop-click>
        <div class="confirm-title" id="renameSessionTitle">Rename session</div>
        <div class="rename-modal-body">
          <p>Current title: “${escapeHtml(currentLabel)}”</p>
          <label for="renameSessionInput">
            Session title
            <input
              id="renameSessionInput"
              type="text"
              value="${escapeHtml(state.sessionRenameDraft)}"
              placeholder="Untitled session"
              data-session-rename-input
              ${state.sessionRenaming ? "disabled" : ""}
            >
          </label>
          <div class="field-error">${state.sessionRenameError ? escapeHtml(state.sessionRenameError) : ""}</div>
        </div>
        <div class="confirm-actions">
          <button class="secondary-btn${disableActions}" data-action="cancelRenameSession">Cancel</button>
          <button class="primary-btn${disableActions}" data-action="confirmRenameSession">Rename</button>
        </div>
      </div>
    </div>
  `
}

function renderProjectDeleteModal() {
  const target = state.projectDeleteTarget
  if (!target) return ""
  const disableActions = state.projectRemoving ? " disabled" : ""
  return `
    <div class="update-backdrop" ${state.projectRemoving ? "" : 'data-action="cancelRemoveProject"'}>
      <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="removeProjectTitle" data-stop-click>
        <div class="confirm-title" id="removeProjectTitle">Remove project?</div>
        <p>“${escapeHtml(target.name)}” will be removed from this list. Your files on disk are not deleted.</p>
        <div class="confirm-actions">
          <button class="secondary-btn${disableActions}" data-action="cancelRemoveProject">Cancel</button>
          <button class="danger-btn${disableActions}" data-action="confirmRemoveProject">Remove</button>
        </div>
      </div>
    </div>
  `
}

function renderProjectRenameModal() {
  const target = state.projectRenameTarget
  if (!target) return ""
  const disableActions = state.projectRenaming ? " disabled" : ""
  return `
    <div class="update-backdrop" ${state.projectRenaming ? "" : 'data-action="cancelRenameProject"'}>
      <div class="confirm-modal rename-modal" role="dialog" aria-modal="true" aria-labelledby="renameProjectTitle" data-stop-click>
        <div class="confirm-title" id="renameProjectTitle">Rename project</div>
        <div class="rename-modal-body">
          <p>Current name: “${escapeHtml(target.name)}”</p>
          <label for="renameProjectInput">
            Project name
            <input
              id="renameProjectInput"
              type="text"
              value="${escapeHtml(state.projectRenameDraft)}"
              placeholder="Project name"
              data-project-rename-input
              ${state.projectRenaming ? "disabled" : ""}
            >
          </label>
          <div class="field-error">${state.projectRenameError ? escapeHtml(state.projectRenameError) : ""}</div>
        </div>
        <div class="confirm-actions">
          <button class="secondary-btn${disableActions}" data-action="cancelRenameProject">Cancel</button>
          <button class="primary-btn${disableActions}" data-action="confirmRenameProject">Rename</button>
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
  return `
    <aside class="sidebar"${state.sidebarCollapsed ? ' aria-hidden="true" inert' : ""}>
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
        <button class="nav-item ${state.nav === "skills" ? "active" : ""}" data-nav="skills">
          ${icon("blocks")}<span>Skills</span>
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
        <button class="side-user ${state.nav === "config" ? "active" : ""}" data-nav="config">
          <span class="su-av">OW</span>
          <span class="su-meta">
            <span class="su-name">OpenWorking</span>
            <span class="su-sub">Local</span>
          </span>
        </button>
      </div>
    </aside>
    <div class="sidebar-resizer" data-resizer></div>
  `
}

function renderRightFileSidebar() {
  const project = selectedProject()
  const rootChildren = state.fileTreeChildren.get("")
  let body
  if (!project) {
    body = `<div class="file-tree-state">Open a project to browse files.</div>`
  } else if (state.fileTreeProjectId !== project.id || (state.fileTreeLoading.has("") && !rootChildren)) {
    body = `<div class="file-tree-state">Loading files...</div>`
  } else if (state.fileTreeError && !rootChildren) {
    body = `<div class="file-tree-state error">${escapeHtml(state.fileTreeError)}</div>`
  } else if (!rootChildren?.length) {
    body = `<div class="file-tree-state">No files found.</div>`
  } else {
    body = `<div class="file-tree">${renderFileTreeRows("", 0)}</div>`
  }
  return `
    <div class="right-file-resizer" data-right-file-resizer></div>
    <aside class="right-file-sidebar">
      <div class="right-file-head">
        <span class="right-file-title">Files</span>
        <span class="right-file-project" title="${escapeHtml(project?.path || "")}">${escapeHtml(project?.name || "")}</span>
      </div>
      ${state.fileTreeError && rootChildren ? `<div class="file-tree-alert">${escapeHtml(state.fileTreeError)}</div>` : ""}
      <div class="right-file-scroll">${body}</div>
    </aside>
  `
}

function renderFileTreeRows(directoryPath, depth) {
  const children = state.fileTreeChildren.get(directoryPath) || []
  return children.map((entry) => {
    const padding = 10 + depth * 14
    if (entry.type === "directory") {
      const open = state.fileTreeExpanded.has(entry.path)
      const loaded = state.fileTreeChildren.has(entry.path)
      const loading = state.fileTreeLoading.has(entry.path)
      return `
        <div class="file-tree-node">
          <button class="file-tree-row directory ${open ? "open" : ""}" data-tree-dir="${escapeHtml(entry.path)}" style="--tree-pad:${padding}px" title="${escapeHtml(entry.path)}">
            <span class="file-tree-chev">${icon(open ? "chevDown" : "chevRight")}</span>
            <span class="file-tree-icon">${icon("folder")}</span>
            <span class="file-tree-name">${escapeHtml(entry.name)}</span>
          </button>
          ${open ? `
            <div class="file-tree-children">
              ${loading && !loaded ? `<div class="file-tree-state inline" style="--tree-pad:${padding + 28}px">Loading...</div>` : renderFileTreeRows(entry.path, depth + 1)}
            </div>
          ` : ""}
        </div>
      `
    }
    return `
      <button class="file-tree-row file ${entry.openable ? "" : "disabled"} ${state.document?.requestedPath === entry.path ? "active" : ""}" ${entry.openable ? `data-tree-file="${escapeHtml(entry.path)}"` : ""} style="--tree-pad:${padding + 22}px" title="${escapeHtml(entry.path)}">
        <span class="file-tree-icon">${icon("doc")}</span>
        <span class="file-tree-name">${escapeHtml(entry.name)}</span>
      </button>
    `
  }).join("")
}

function renderProjectGroup(project) {
  const sessions = projectSessions(project.id)
  const open = state.expanded.has(project.id)
  const shown = state.showAll.has(project.id) ? sessions : sessions.slice(0, 5)
  return `
    <div class="proj-group">
      <div class="proj-head-wrap">
        <button class="proj-head ${open ? "open" : ""} ${project.id === state.activeProjectId ? "active-proj" : ""}" data-open-project="${escapeHtml(project.id)}">
          <span class="fic">${icon("folder")}</span>
          <span class="pname">${escapeHtml(project.name)}</span>
        </button>
        <span class="padd" title="New session" data-new-session="${escapeHtml(project.id)}">${icon("plus")}</span>
        <button class="proj-kebab" data-project-menu="${escapeHtml(project.id)}" title="Options">${icon("dots")}</button>
        ${state.projectMenu === project.id ? `
          <div class="pop project-pop">
            <button class="pop-item" data-project-rename="${escapeHtml(project.id)}" data-project-name="${escapeHtml(project.name)}">
              ${icon("edit")}<span>Rename</span>
            </button>
            <button class="pop-item danger" data-project-delete="${escapeHtml(project.id)}" data-project-name="${escapeHtml(project.name)}">
              ${icon("trash")}<span>Remove</span>
            </button>
          </div>` : ""}
      </div>
      ${open ? `
        <div class="sessions">
          ${sessions.length ? shown.map((session) => `
            <div class="session-row-wrap ${session.id === state.activeSessionId ? "active" : ""}" data-session-row="${escapeHtml(session.id)}">
              <button class="session-row" data-session-id="${escapeHtml(session.id)}" data-project-id="${escapeHtml(project.id)}">
                <span class="session-busy-dot ${sessionBusy(session.id) ? "on" : ""}" title="Running"></span>
                <span class="stitle">${escapeHtml(sessionDisplayTitle(session))}</span>
                <span class="stime">${escapeHtml(relativeTime(sessionUpdatedAt(session)))}</span>
              </button>
              <button class="session-kebab" data-session-menu="${escapeHtml(session.id)}" title="Options">${icon("dots")}</button>
              ${state.sessionMenu === session.id ? `
                <div class="pop session-pop">
                  <button class="pop-item" data-session-rename="${escapeHtml(session.id)}" data-session-project="${escapeHtml(project.id)}" data-session-title="${escapeHtml(session.title || "")}" data-session-label="${escapeHtml(sessionDisplayTitle(session))}">
                    ${icon("edit")}<span>Rename</span>
                  </button>
                  <button class="pop-item danger" data-session-delete="${escapeHtml(session.id)}" data-session-title="${escapeHtml(sessionDisplayTitle(session))}">
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
  if (state.nav === "settings" || state.nav === "config") return renderSettingsScreen()
  if (state.nav === "skills") return renderSkillsScreen()
  return renderSessionScreen()
}

function renderHeader(title, subtitle) {
  const label = runtimeLabel()
  const fileTitle = state.rightSidebarOpen ? "Close files" : "Open current folder"
  return `
    <div class="main-head">
      <button class="head-icon-btn head-sidebar-btn" data-action="toggleSidebar" title="Show sidebar" aria-label="Show sidebar">
        ${icon("sidebarToggle")}
      </button>
      <div class="head-copy"><div class="head-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div><div class="head-path" title="${escapeHtml(subtitle || "")}">${escapeHtml(subtitle || "")}</div></div>
      <div class="head-actions">
        <button class="status-pill ${label}" data-action="toggleDiagnostics"><span class="status-dot"></span>${escapeHtml(label)}</button>
        <button class="head-icon-btn ${state.rightSidebarOpen ? "active" : ""}" data-action="toggleRightSidebar" title="${fileTitle}" aria-label="${fileTitle}">
          ${icon("sidebarRight")}
        </button>
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
  const thread = activeThread()
  const status = thread.status || { type: "idle" }
  const awaiting = pendingPrompts()
  return `
    ${thread.messages.map(renderThreadMessage).join("")}
    ${status.type === "busy" && !hasRunningTool(thread) && !awaiting ? renderThinkingRow() : ""}
    ${status.type === "retry" ? renderRetryRow(status) : ""}
    ${renderPendingPermissions()}
    ${renderPendingQuestions()}
    ${renderPlanProposal()}
  `
}

function planProposalRef() {
  if (!activePlanProposal()) return undefined
  const status = activeThread().status || { type: "idle" }
  if (status.type === "busy" || status.type === "retry") return undefined
  if (pendingPrompts()) return undefined
  if (state.planAccepted === state.activeSessionId) return undefined
  const message = latestPlanMessage()
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
  const thread = activeThread()
  const questions = thread.pendingQuestions?.length || 0
  const permissions = thread.pendingPermissions?.length || 0
  return questions + permissions
}

function renderThreadMessage(message) {
  const actions = renderMessageActions(message)
  if (message.role === "user") {
    const projectFiles = selectableProjectFiles()
    const text = messageText(message, projectFiles)
    const attachments = message.parts.filter((part) => part.type === "file")
    const fileMentions = userMessageFileRefs(message, projectFiles)
    return text || attachments.length || fileMentions.length
      ? `<div class="msg-user"><div class="message-stack user-message"><div class="message-card bubble">${text ? `<div>${renderTextWithFileMentions(text, fileMentions)}</div>` : ""}${renderAttachmentChips(attachments)}</div>${actions}</div></div>`
      : ""
  }
  const parts = message.parts.map(renderAssistantPart).join("")
  if (!parts) return ""
  const fileRefs = renderFileRefChips(messageFileRefs(message))
  const changes = renderMessageChanges(message)
  return `<div class="msg-ai"><div class="message-stack assistant-message"><div class="message-card ai-body">${parts}${fileRefs}${changes}</div>${actions}</div></div>`
}

const MUTATING_FILE_TOOLS = new Set(["edit", "write", "apply_patch"])
const VIEWABLE_FILE_EXTENSIONS = new Set([
  ".md", ".markdown",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".css", ".scss", ".html",
  ".json", ".jsonc", ".yml", ".yaml", ".toml", ".xml",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".cpp", ".h", ".cs", ".php", ".sql",
  ".vue", ".svelte", ".astro",
  ".sh", ".bash", ".zsh"
])
const MARKDOWN_FILE_EXTENSIONS = new Set([".md", ".markdown"])
const VIEWABLE_FILE_BASENAMES = new Set(["Dockerfile", "Makefile", "Procfile", ".gitignore", ".eslintrc", ".prettierrc", ".editorconfig"])

function fileExtension(value) {
  const name = filename(value)
  const index = name.lastIndexOf(".")
  return index > 0 ? name.slice(index).toLowerCase() : ""
}

function isViewableFilePath(value) {
  const name = filename(value)
  return VIEWABLE_FILE_BASENAMES.has(name) || VIEWABLE_FILE_EXTENSIONS.has(fileExtension(value))
}

function isMarkdownFilePath(value) {
  return MARKDOWN_FILE_EXTENSIONS.has(fileExtension(value))
}

function fileRefKind(value) {
  const extension = fileExtension(value)
  if (MARKDOWN_FILE_EXTENSIONS.has(extension)) return "Document · MD"
  if (extension) return `Code · ${extension.slice(1).toUpperCase()}`
  return "Code"
}

function messageFileRefs(message) {
  const refs = new Map()
  for (const part of message.parts || []) {
    if (part.type !== "tool") continue
    if (!MUTATING_FILE_TOOLS.has(part.tool)) continue
    if (part.state?.status !== "completed") continue
    const candidates = []
    if (part.tool === "edit" || part.tool === "write") {
      candidates.push(part.state?.input?.filePath)
    }
    if (part.tool === "apply_patch") {
      candidates.push(part.state?.metadata?.filepath)
      if (Array.isArray(part.state?.metadata?.files)) candidates.push(...part.state.metadata.files)
    }
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate) continue
      if (!isViewableFilePath(candidate)) continue
      if (!refs.has(candidate)) refs.set(candidate, { path: candidate, name: filename(candidate), kind: fileRefKind(candidate) })
    }
  }
  return [...refs.values()]
}

function renderFileRefChips(refs) {
  if (!refs.length) return ""
  return `
    <div class="file-refs">
      ${refs.map((ref) => `
        <button class="file-ref-chip ${state.document?.requestedPath === ref.path ? "active" : ""}" data-open-file="${escapeHtml(ref.path)}" title="${escapeHtml(ref.path)}">
          ${icon("doc")}<span><strong>${escapeHtml(ref.name)}</strong><small>${escapeHtml(ref.kind)}</small></span>
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
  const path = doc.path || doc.requestedPath || doc.name
  const hasDiff = Boolean(doc.diff)
  // "diff" only when there is a diff to show; otherwise fall back to the file's
  // natural render mode (markdown for .md, code for everything else).
  const tab = hasDiff && doc.tab === "diff" ? "diff" : "code"
  const previewTabLabel = (doc.renderMode || (isMarkdownFilePath(path) ? "markdown" : "code")) === "markdown" ? "Preview" : "Code"
  let body
  if (doc.loading) {
    body = `<div class="doc-state">Loading…</div>`
  } else if (doc.error) {
    body = `<div class="doc-state error">${escapeHtml(doc.error)}</div>`
  } else if (tab === "diff") {
    body = renderUnifiedDiff(doc.diff, path)
  } else if (doc.previewMode === "pdf") {
    body = `${renderArtifactExternalAction(doc)}<iframe class="doc-pdf" src="${escapeHtml(doc.url || "")}" title="${escapeHtml(doc.name || "PDF preview")}"></iframe>`
  } else if (doc.previewMode === "external") {
    body = renderArtifactShell(doc)
  } else if ((doc.renderMode || (isMarkdownFilePath(path) ? "markdown" : "code")) === "markdown") {
    body = `${renderArtifactExternalAction(doc)}<div class="doc-content assistant-text">${renderMarkdown(doc.content)}</div>${doc.truncated ? `<small class="doc-truncated">File truncated.</small>` : ""}`
  } else {
    body = `<pre class="doc-code"><code class="hljs">${highlightCode(doc.content, path)}</code></pre>${doc.truncated ? `<small class="doc-truncated">File truncated.</small>` : ""}`
  }
  const tabs = hasDiff
    ? `<div class="doc-tabs" role="tablist">
        <button class="doc-tab" role="tab" data-doc-tab="diff" aria-selected="${tab === "diff"}">Diff</button>
        <button class="doc-tab" role="tab" data-doc-tab="code" aria-selected="${tab === "code"}">${previewTabLabel}</button>
      </div>`
    : ""
  return `
    <div class="document-resizer" data-document-resizer></div>
    <aside class="document-viewer">
      <div class="doc-head">
        <div class="doc-crumbs">${breadcrumb}</div>
        ${tabs}
        <button class="doc-close" data-action="closeDocument" title="Close" aria-label="Close">${icon("x")}</button>
      </div>
      <div class="doc-scroll">${body}</div>
    </aside>
  `
}

function artifactTypeLabel(doc) {
  const extension = String(doc.extension || fileExtension(doc.path || doc.requestedPath || "")).replace(/^\./, "").toUpperCase()
  if (extension) return extension
  return doc.mime || "Artifact"
}

function renderArtifactExternalAction(doc) {
  if (!doc.artifact || !doc.path || doc.loading || doc.error) return ""
  return `
    <div class="doc-artifact-actions">
      <span>${escapeHtml(artifactTypeLabel(doc))} artifact preview</span>
      <button class="secondary-btn" data-action="openExternalArtifact" data-artifact-path="${escapeHtml(doc.path)}">${icon("arrowUp")}Open externally</button>
    </div>
  `
}

function renderArtifactShell(doc) {
  return `
    <div class="doc-artifact-shell">
      ${icon("doc")}
      <strong>${escapeHtml(doc.name || filename(doc.path))}</strong>
      <span>${escapeHtml(artifactTypeLabel(doc))} preview is available as file metadata in this panel.</span>
      <small>${escapeHtml(doc.path || "")}</small>
      <button class="secondary-btn" data-action="openExternalArtifact" data-artifact-path="${escapeHtml(doc.path || "")}">${icon("arrowUp")}Open externally</button>
    </div>
  `
}

// Finds the most recent diff produced for `filePath` across the active thread's
// messages, so opening a file can default to its Diff tab. Reuses collectMessageDiffs.
function findDiffForPath(filePath) {
  if (!filePath) return null
  let found = null
  for (const message of activeThread().messages || []) {
    for (const entry of collectMessageDiffs(message)) {
      if (entry.filepath === filePath) found = entry.diff
    }
  }
  return found
}

async function openDocument(filePath, { diff = null, tab = null } = {}) {
  if (!filePath) return
  const renderMode = isMarkdownFilePath(filePath) ? "markdown" : "code"
  const resolvedDiff = diff || findDiffForPath(filePath)
  const resolvedTab = tab || (resolvedDiff ? "diff" : "code")
  showDocument({ requestedPath: filePath, path: filePath, name: filename(filePath), relativePath: "", content: "", loading: true, error: "", renderMode, diff: resolvedDiff, tab: resolvedTab })
  try {
    const doc = await window.openworking.files.read(filePath)
    if (state.document?.requestedPath !== filePath) return
    state.document = { requestedPath: filePath, ...doc, loading: false, error: "", renderMode, diff: resolvedDiff, tab: resolvedTab }
  } catch (error) {
    if (state.document?.requestedPath !== filePath) return
    state.document = { requestedPath: filePath, path: filePath, name: filename(filePath), relativePath: "", content: "", loading: false, error: error.message, renderMode, diff: resolvedDiff, tab: resolvedTab }
  }
  render()
}

function switchDocumentTab(tab) {
  if (!state.document || (tab !== "diff" && tab !== "code")) return
  if (state.document.tab === tab) return
  state.document.tab = tab
  render()
}

function appElement() {
  return document.querySelector(".app")
}

function afterTransitionOrTimeout(element, callback, timeout = 240) {
  if (!element) {
    callback()
    return
  }
  let done = false
  const finish = () => {
    if (done) return
    done = true
    element.removeEventListener("transitionend", onTransitionEnd)
    clearTimeout(timer)
    callback()
  }
  const onTransitionEnd = (event) => {
    if (event.target === element) finish()
  }
  const timer = setTimeout(finish, timeout)
  element.addEventListener("transitionend", onTransitionEnd)
}

function syncSidebarCollapsedDom(collapsed = state.sidebarCollapsed) {
  const app = appElement()
  if (app) app.classList.toggle("collapsed", collapsed)
  const sidebar = document.querySelector(".sidebar")
  if (!sidebar) return
  if (collapsed) {
    sidebar.setAttribute("aria-hidden", "true")
    sidebar.setAttribute("inert", "")
  } else {
    sidebar.removeAttribute("aria-hidden")
    sidebar.removeAttribute("inert")
  }
}

function startPanelOpenTransition(preopenClass) {
  const app = appElement()
  if (!app) return
  app.classList.add(preopenClass)
  requestAnimationFrame(() => {
    const current = appElement()
    if (!current) return
    current.classList.remove(preopenClass)
  })
}

function showDocument(document) {
  const opening = !state.document
  state.document = document
  render()
  if (opening) startPanelOpenTransition("document-preopen")
}

function closeDocument() {
  if (!state.document) return
  const app = appElement()
  if (!app) {
    state.document = null
    render()
    return
  }
  app.classList.add("document-closing")
  afterTransitionOrTimeout(app, () => {
    state.document = null
    render()
  })
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed
  syncSidebarCollapsedDom()
}

async function toggleRightSidebar() {
  if (state.rightSidebarOpen) {
    const app = appElement()
    if (!app) {
      state.rightSidebarOpen = false
      render()
      return
    }
    app.classList.add("right-sidebar-closing")
    afterTransitionOrTimeout(app, () => {
      state.rightSidebarOpen = false
      render()
    })
    return
  }
  const project = selectedProject()
  if (!project) {
    showToast("Open a project before browsing files.")
    return
  }
  state.rightSidebarOpen = true
  if (state.fileTreeProjectId !== project.id) resetFileTree(project.id)
  render()
  startPanelOpenTransition("right-sidebar-preopen")
  await loadFileTreeDirectory("")
}

async function loadFileTreeDirectory(directoryPath = "", { force = false } = {}) {
  const project = selectedProject()
  if (!project) return
  if (state.fileTreeProjectId !== project.id) resetFileTree(project.id)
  const key = String(directoryPath || "")
  if (!force && state.fileTreeChildren.has(key)) return
  state.fileTreeLoading.add(key)
  state.fileTreeError = ""
  render()
  try {
    const listing = await window.openworking.files.list(key)
    if (state.fileTreeProjectId !== project.id) return
    state.fileTreeChildren.set(listing.path || "", listing.children || [])
  } catch (error) {
    state.fileTreeError = error.message || "Could not load files."
  } finally {
    state.fileTreeLoading.delete(key)
    render()
  }
}

async function toggleFileTreeDirectory(directoryPath) {
  const key = String(directoryPath || "")
  if (state.fileTreeExpanded.has(key)) {
    state.fileTreeExpanded.delete(key)
    render()
    return
  }
  state.fileTreeExpanded.add(key)
  render()
  await loadFileTreeDirectory(key)
}

async function openFileTreeFile(filePath) {
  await openDocument(filePath)
}

function renderMessageActions(message) {
  if (!messageCopyText(message)) return ""
  return `<div class="message-actions"><button class="message-action" data-copy-message="${escapeHtml(message.id)}" title="Copy message" aria-label="Copy message">${icon("copy")}</button></div>`
}

function renderAssistantPart(part) {
  if (part.type === "text") {
    return part.text ? `<div class="assistant-text">${renderMarkdown(part.text)}</div>` : ""
  }
  if (part.type === "reasoning") return renderReasoningRow(part)
  if (part.type === "error") return renderErrorPart(part)
  if (part.type === "tool") return renderToolRow(part)
  return ""
}

// The model's "thinking" stream (OpenCode `reasoning` part). Shown above the answer
// as a dimmed, always-expanded block — it is not the answer, so it stays visually
// distinct and never feeds copy/plan detection (those filter on type === "text").
function renderReasoningRow(part) {
  if (!String(part.text || "").trim()) return ""
  return `
    <div class="reasoning-block">
      <div class="reasoning-label">${icon("sparkle")}<span>Suy nghĩ</span></div>
      <div class="reasoning-text assistant-text">${renderMarkdown(part.text)}</div>
    </div>
  `
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

function renderFileMentionChips(fileMentions, { removable = false } = {}) {
  if (!fileMentions.length) return ""
  return `
    <div class="${removable ? "composer-file-mentions" : "message-file-mentions"}">
      ${fileMentions.map((fileMention) => `
        <span class="file-mention-chip" title="${escapeHtml(fileMention.path)}">
          ${icon("doc")}<span>${escapeHtml(fileMention.token || `@${fileMention.name}`)}</span>
          ${removable ? `<button data-remove-file-mention="${escapeHtml(fileMention.token)}" title="Remove ${escapeHtml(fileMention.token || fileMention.name)}">${icon("x")}</button>` : ""}
        </span>
      `).join("")}
    </div>
  `
}

function renderInlineFileMention(fileMention) {
  const label = fileMention.token || `@${fileMention.name}`
  return `<span class="file-mention-token" title="${escapeHtml(fileMention.path)}"><span>${escapeHtml(label)}</span></span>`
}

function findFileMentionMatches(text, fileMentions) {
  const prompt = String(text || "")
  const matches = []
  for (const fileMention of fileMentions) {
    const token = String(fileMention?.token || "")
    if (!token) continue
    const pattern = new RegExp(`(^|\\s)(${escapeRegex(token)})(?=$|\\s)`, "g")
    let match = null
    while ((match = pattern.exec(prompt))) {
      const prefix = match[1] || ""
      const start = match.index + prefix.length
      matches.push({ start, end: start + token.length, fileMention })
      if (pattern.lastIndex === match.index) pattern.lastIndex += 1
    }
  }
  return matches.sort((left, right) => left.start - right.start || left.end - right.end)
}

function renderTextWithFileMentions(text, fileMentions) {
  const message = String(text || "")
  const matches = findFileMentionMatches(message, fileMentions)
  if (!matches.length) return escapeHtml(message).replaceAll("\n", "<br>")

  let html = ""
  let cursor = 0
  for (const match of matches) {
    if (match.start < cursor) continue
    html += escapeHtml(message.slice(cursor, match.start)).replaceAll("\n", "<br>")
    html += renderInlineFileMention(match.fileMention)
    cursor = match.end
  }
  html += escapeHtml(message.slice(cursor)).replaceAll("\n", "<br>")
  return html
}

function renderPromptOverlayHtml(promptText, fileMentions = []) {
  const prompt = String(promptText || "")
  const liveMentions = livePendingFileMentions(prompt, fileMentions)
  if (!liveMentions.length) return escapeHtml(prompt).replaceAll("\n", "<br>")
  return renderTextWithFileMentions(prompt, liveMentions)
}

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function fileMentionTokenPattern(token) {
  return new RegExp(`(^|\\s)${escapeRegex(token)}(?=$|\\s)`)
}

function livePendingFileMentions(promptText, pendingFileMentions = state.pendingFileMentions) {
  const prompt = String(promptText || "")
  return pendingFileMentions.filter((fileMention) => fileMention?.token && fileMentionTokenPattern(fileMention.token).test(prompt))
}

function resolveFileMentionsFromPrompt(promptText, files = selectableProjectFiles()) {
  const prompt = String(promptText || "")
  if (!prompt.includes("@")) return []
  const mentions = []
  const seen = new Set()
  const pattern = /(^|\s)@([^\s@]+)(?=$|\s)/g
  let match = null
  while ((match = pattern.exec(prompt))) {
    const candidate = match[2]
    const token = `@${candidate}`
    if (seen.has(token)) continue
    let filePath = files.includes(candidate) ? candidate : null
    if (!filePath) {
      const basenameMatches = files.filter((file) => filename(file) === candidate)
      if (basenameMatches.length === 1) filePath = basenameMatches[0]
    }
    if (!filePath) continue
    const resolvedToken = fileMentionTokenForPath(filePath, files)
    if (!fileMentionTokenPattern(resolvedToken).test(prompt)) continue
    seen.add(resolvedToken)
    mentions.push({ token: resolvedToken, path: filePath, name: filename(filePath) })
  }
  return mentions
}

function collectLiveFileMentions(promptText, overrides = {}) {
  const pendingFileMentions = overrides.pendingFileMentions ?? state.pendingFileMentions
  const files = overrides.files ?? selectableProjectFiles()
  const prompt = String(promptText || "")
  const livePending = livePendingFileMentions(prompt, pendingFileMentions)
  if (livePending.length !== pendingFileMentions.length && !overrides.pendingFileMentions) {
    state.pendingFileMentions = livePending
  }
  const byToken = new Map()
  for (const fileMention of [
    ...livePending,
    ...resolveFileMentionsFromPrompt(prompt, files)
  ]) {
    if (!fileMention?.token || !fileMentionTokenPattern(fileMention.token).test(prompt)) continue
    byToken.set(fileMention.token, fileMention)
  }
  return [...byToken.values()]
}

async function fileMentionsForSubmit(prompt, command) {
  if (command) return []
  if (String(prompt || "").includes("@")) await ensureProjectFileCandidates()
  return collectLiveFileMentions(prompt)
}

function syncPendingFileMentions(promptText, { rerender = false, promptInput = null } = {}) {
  const live = livePendingFileMentions(promptText)
  if (live.length === state.pendingFileMentions.length) return live
  state.pendingFileMentions = live
  if (rerender) {
    const selectionStart = promptInput?.selectionStart ?? null
    const selectionEnd = promptInput?.selectionEnd ?? selectionStart
    render()
    const freshInput = document.getElementById("promptInput")
    if (freshInput && selectionStart !== null && selectionEnd !== null) {
      freshInput.focus()
      freshInput.setSelectionRange(selectionStart, selectionEnd)
      freshInput.style.height = "auto"
      freshInput.style.height = `${Math.min(freshInput.scrollHeight, 200)}px`
      syncPromptOverlay(freshInput)
    }
  }
  return live
}

function applyPendingFileMentions(promptText, fileMentions) {
  let prompt = String(promptText || "")
  for (const fileMention of fileMentions) {
    if (!fileMention?.token || !fileMention?.path) continue
    const pattern = new RegExp(`(^|\\s)(${escapeRegex(fileMention.token)})(?=$|\\s)`, "g")
    prompt = prompt.replace(pattern, (_, prefix) => `${prefix}\`${fileMention.path}\``)
  }
  return prompt
}

function fileMentionTokenForPath(filePath, files = selectableProjectFiles()) {
  const normalizedPath = String(filePath || "").trim()
  if (!normalizedPath) return "@"
  const basename = filename(normalizedPath)
  const duplicates = files.filter((candidate) => filename(candidate) === basename)
  return duplicates.length > 1 ? `@${normalizedPath}` : `@${basename}`
}

function filterPromptAttachments(attachments, fileMentions, { forceTextOnly = false } = {}) {
  const pending = Array.isArray(attachments) ? attachments.slice() : []
  if (!pending.length) return pending
  if (forceTextOnly && Array.isArray(fileMentions) && fileMentions.length) return []
  if (!Array.isArray(fileMentions) || !fileMentions.length) return pending
  const mentionedNames = new Set(fileMentions.map((fileMention) => String(fileMention?.name || filename(fileMention?.path || "") || "").trim()).filter(Boolean))
  // ponytail: stale attachment ids from the old @file flow are worse than dropping a duplicate of the same file name.
  return pending.filter((attachment) => !mentionedNames.has(String(attachment?.filename || "").trim()))
}

function computePromptAttachments({ command, pendingAttachments, fileMentions }) {
  return command
    ? []
    : filterPromptAttachments(pendingAttachments, fileMentions, {
        forceTextOnly: true
      })
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
  const pending = activeThread().pendingQuestions || []
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

// The card header names the action: prefer an explicit title, else the tool name
// (e.g. `backlog_update_issue`), so the user knows exactly which tool is being approved.
function permissionHeader(request) {
  if (request.title) return String(request.title)
  if (request.permission) return `Run ${request.permission}?`
  return "Allow this action?"
}

// Renders the per-argument detail rows (e.g. issueIdOrKey: TSD-131, statusId: 2) so the user can
// see exactly what the gated tool will do before approving.
function renderPermissionDetails(request) {
  const details = Array.isArray(request.details) ? request.details : []
  if (!details.length) return ""
  const rows = details.map((detail) => `
    <div class="ask-permission-detail">
      <span class="ask-permission-detail-key">${escapeHtml(detail.key)}</span>
      <span class="ask-permission-detail-value">${escapeHtml(detail.value)}</span>
    </div>
  `).join("")
  return `<div class="ask-permission-details">${rows}</div>`
}

// Renders the tool-approval card OpenCode raises when an action is gated to "ask".
function renderPendingPermissions() {
  const pending = activeThread().pendingPermissions || []
  if (!pending.length) return ""
  return pending.map(renderPermissionCard).join("")
}

function renderPermissionCard(request) {
  const summary = permissionSummary(request)
  const details = renderPermissionDetails(request)
  return `
    <div class="ask-card permission-card" data-permission-card="${escapeHtml(request.requestID)}">
      <div class="ask-card-header">${escapeHtml(permissionHeader(request))}</div>
      ${summary ? `<div class="ask-permission-meta">${escapeHtml(summary)}</div>` : ""}
      ${details || (summary ? "" : `<div class="ask-permission-meta">No additional details.</div>`)}
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


// Maps a previewed file's extension to a highlight.js language. Only the common
// languages bundled in the @highlightjs/cdn-assets build are listed; anything not
// here falls back to plain escaped text in highlightCode.
const HLJS_LANGUAGE_BY_EXTENSION = {
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".tsx": "typescript",
  ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust",
  ".java": "java", ".kt": "kotlin", ".swift": "swift",
  ".c": "c", ".h": "c", ".cpp": "cpp", ".cs": "csharp", ".php": "php", ".sql": "sql",
  ".css": "css", ".scss": "scss", ".html": "xml", ".xml": "xml",
  ".vue": "xml", ".svelte": "xml", ".astro": "xml",
  ".json": "json", ".jsonc": "json", ".yml": "yaml", ".yaml": "yaml", ".toml": "ini",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash"
}
// Dockerfile grammar is not in the bundled highlight.js "common" build, so it is
// intentionally omitted and falls back to plain text.
const HLJS_LANGUAGE_BY_BASENAME = { Makefile: "makefile" }

// Highlights previewed source by file extension: the returned string is already
// HTML-escaped by hljs, and any miss (unknown language or thrown error) falls
// back to escapeHtml so the panel never breaks or injects.
function highlightCode(content, path) {
  const language = HLJS_LANGUAGE_BY_BASENAME[filename(path)] || HLJS_LANGUAGE_BY_EXTENSION[fileExtension(path)]
  if (!language || !hljs.getLanguage(language)) return escapeHtml(content)
  try {
    return hljs.highlight(content, { language }).value
  } catch (error) {
    return escapeHtml(content)
  }
}

// Renders a unified diff as a GitHub-style two-gutter view: old/new line numbers
// plus the line content, with added/removed lines tinted green/red and hunk
// boundaries shown as "N unmodified lines" separators. Line content is run
// through highlightCode so it keeps per-language colors; everything is escaped.
function renderUnifiedDiff(diff, path) {
  const rows = parseUnifiedDiff(diff)
  if (!rows.length) return `<div class="doc-state">No changes to display.</div>`
  let lastNewNo = 0
  const html = rows.map((row) => {
    if (row.type === "hunk") {
      // The jump from the last rendered new-line to this hunk's start is the
      // count of unmodified lines collapsed between hunks.
      const skipped = lastNewNo ? Math.max(0, row.newStart - lastNewNo - 1) : 0
      lastNewNo = row.newStart - 1
      const label = skipped > 0 ? `${skipped} unmodified line${skipped === 1 ? "" : "s"}` : escapeHtml(row.text)
      return `<div class="diff-hunk"><span class="diff-hunk-label">${label}</span></div>`
    }
    const content = `<code class="hljs">${highlightCode(row.text, path)}</code>`
    if (row.type === "add") {
      lastNewNo = row.newNo
      return `<div class="diff-line add"><span class="diff-gutter"></span><span class="diff-gutter">${row.newNo}</span><span class="diff-mark">+</span>${content}</div>`
    }
    if (row.type === "del") {
      return `<div class="diff-line del"><span class="diff-gutter">${row.oldNo}</span><span class="diff-gutter"></span><span class="diff-mark">-</span>${content}</div>`
    }
    lastNewNo = row.newNo
    return `<div class="diff-line"><span class="diff-gutter">${row.oldNo}</span><span class="diff-gutter">${row.newNo}</span><span class="diff-mark"></span>${content}</div>`
  }).join("")
  return `<div class="diff-view">${html}</div>`
}

// Renders one file row in the inline "Changes" card. Clicking it opens the diff
// in the document-viewer panel (Diff tab) rather than expanding inline. Rows
// without a resolvable file path are shown read-only (no panel to open).
function renderDiffRow(key, { filepath, label, diff, truncated }) {
  const displayLabel = label || (filepath ? filename(filepath) : "Changes")
  const { additions, deletions } = diffStats(diff)
  const openable = Boolean(filepath) && isViewableFilePath(filepath)
  const active = openable && state.document?.requestedPath === filepath && state.document?.tab === "diff"
  const head = `
        ${icon("doc")}
        <span class="tool-diff-name">${escapeHtml(displayLabel)}</span>
        <span class="tool-diff-stats"><span class="diff-add">+${additions}</span><span class="diff-del">-${deletions}</span></span>
        <span class="tool-chevron">${icon("chevRight")}</span>`
  return `
    <div class="tool-diff-block">
      ${openable
        ? `<button class="tool-diff-head${active ? " active" : ""}" data-open-file="${escapeHtml(filepath)}" data-open-tab="diff" title="${escapeHtml(filepath)}">${head}</button>`
        : `<div class="tool-diff-head readonly"${filepath ? ` title="${escapeHtml(filepath)}"` : ""}>${head}</div>`}
    </div>
  `
}

// Walks the tool parts of a single message and collects the latest diff per file.
function collectMessageDiffs(message) {
  const byFile = new Map()
  for (const part of message?.parts || []) {
    if (part.type !== "tool") continue
    if (!MUTATING_FILE_TOOLS.has(part.tool)) continue
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
        <button class="artifact-chip ${state.document?.requestedPath === artifact.path || state.document?.path === artifact.path ? "active" : ""}" data-open-artifact="${escapeHtml(artifact.path)}" title="${escapeHtml(artifact.path)}">
          ${icon("doc")}<span><strong>${escapeHtml(artifact.filename)}</strong><small>${escapeHtml(artifact.path)}</small></span>
        </button>
      `).join("")}
      ${warnings.map((warning) => `<small class="artifact-warning">${escapeHtml(warning)}</small>`).join("")}
    </div>
  `
}

function renderThinkingRow() {
  return `<div class="msg-ai stream-row"><div class="thinking"><img class="thinking-logo" src="./assets/logo.png" alt="" width="24" height="24"><span>Thinking</span></div></div>`
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
  return `<div class="pop pop-up prompt-pop cmd-pop"><div class="pop-label">Commands</div>${rows}</div>`
}

function renderFileMentionMenu() {
  if (!state.fileMentionMenu.open) return ""
  const candidates = fileMentionCandidates(state.fileMentionMenu.query)
  let rows = ""
  if (state.fileMentionMenu.loading) rows = `<div class="pop-empty">Loading files…</div>`
  else if (state.fileMentionMenu.error) rows = `<div class="pop-empty">${escapeHtml(state.fileMentionMenu.error)}</div>`
  else if (candidates.length) {
    rows = candidates.map((filePath, position) => `
      <button class="pop-item cmd-item ${position === state.fileMentionMenu.index ? "active" : ""}" data-file-mention="${escapeHtml(filePath)}">
        <span><strong>@${escapeHtml(filename(filePath))}</strong><small>${escapeHtml(filePath)}</small></span>
        <span class="cmd-source">file</span>
      </button>`).join("")
  } else rows = `<div class="pop-empty">No matching files.</div>`
  return `<div class="pop pop-up prompt-pop cmd-pop"><div class="pop-label">Project files</div>${rows}</div>`
}

function renderComposer(project, dock = false) {
  const planOn = state.mode === "plan"
  const model = selectedModel()
  const abortable = threadAbortable()
  return `
    <div class="composer">
      <div class="ta-wrap">
        ${renderCommandMenu()}
        ${renderFileMentionMenu()}
        <div class="prompt-overlay" aria-hidden="true">
          <div id="promptOverlay" class="prompt-overlay-text">${renderPromptOverlayHtml(state.promptDraft, state.pendingFileMentions)}</div>
        </div>
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
        <span class="model-label">${escapeHtml(model?.name || "No model configured")}</span>
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
                <button class="small-icon-btn" data-rename-project="${escapeHtml(project.id)}" data-project-name="${escapeHtml(project.name)}" title="Rename">${icon("edit")}</button>
                <button class="small-icon-btn danger" data-remove-project="${escapeHtml(project.id)}" data-project-name="${escapeHtml(project.name)}" title="Remove">${icon("trash")}</button>
              </article>
            `).join("") : `<div class="admin-empty">Add a folder to start.</div>`}
          </div>
        </section>
      </div>
    </main>
  `
}

const SETTINGS_SECTIONS = [
  { id: "provider", label: "Provider & Model", icon: "gear" },
  { id: "advanced", label: "Advanced", icon: "book" }
]

function renderSettingsScreen() {
  const section = SETTINGS_SECTIONS.some((entry) => entry.id === state.settingsSection) ? state.settingsSection : "provider"
  return `
    <main class="main">
      ${renderHeader("Settings", state.configPath)}
      <div class="settings-screen">
        <nav class="settings-sidebar">
          ${SETTINGS_SECTIONS.map((entry) => `
            <button class="settings-nav-item ${entry.id === section ? "active" : ""}" data-settings-section="${entry.id}">
              ${icon(entry.icon)}<span>${escapeHtml(entry.label)}</span>
            </button>
          `).join("")}
        </nav>
        <div class="settings-content admin-content">
          ${section === "provider" ? renderSettingsProvider() : ""}
          ${section === "advanced" ? renderSettingsAdvanced() : ""}
        </div>
      </div>
    </main>
  `
}

function renderSettingsProvider() {
  const provider = currentProvider()
  const modelLines = Object.entries(provider?.models || {}).map(([id, model]) => `${id}${model?.name && model.name !== id ? ` = ${model.name}` : ""}`).join("\n")
  return `
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
  `
}

function renderSettingsAdvanced() {
  const configJson = redactedConfigJson()
  return `
    <section class="admin-panel config-json-panel">
      <div class="panel-head"><div><h1>App profile JSON</h1><p>Complete OpenCode config managed by this desktop app.</p></div></div>
      <label>Effective config<textarea class="config-json" readonly rows="18">${escapeHtml(configJson)}</textarea></label>
      <div class="config-note">Save the Provider form to write this profile at ${escapeHtml(state.configPath)}.</div>
    </section>
    <section class="admin-panel">
      <div class="panel-head"><div><h1>Runtime diagnostics</h1><p>Live OpenCode server status for this session.</p></div></div>
      ${renderDiagnostics()}
    </section>
  `
}

function renderSkillsScreen() {
  const tab = state.skillsTab === "mcp" ? "mcp" : "skills"
  return `
    <main class="main">
      ${renderHeader("Skills", "Bundled and custom OpenCode skills")}
      <div class="admin-content skills-screen">
        <div class="skills-tabs">
          <button class="skills-tab ${tab === "skills" ? "active" : ""}" data-skills-tab="skills">${icon("blocks")}<span>Skills</span></button>
          <button class="skills-tab ${tab === "mcp" ? "active" : ""}" data-skills-tab="mcp">${icon("server")}<span>Extensions</span></button>
        </div>
        ${tab === "mcp" ? renderMcpPanel() : renderSkillsPanel()}
      </div>
      ${renderSkillPreviewModal()}
    </main>
  `
}

function renderSkillsPanel() {
  const builtIn = BUILT_IN_SKILLS.map((skill) => ({ ...skill, builtIn: true }))
  const custom = state.customSkills.map((skill) => ({ ...skill, builtIn: false }))
  return `
    <section class="admin-panel skills-panel">
      <div class="panel-head"><div><h1>Skills</h1><p>Click a skill to preview its SKILL.md. Custom skills can be uninstalled.</p></div><button class="secondary-btn" data-action="openSkillUpload">${icon("arrowUp")}Upload skill</button></div>
      <div class="skill-list">
        ${[...builtIn, ...custom].map((skill) => `
          <button class="skill-list-item" data-skill-open="${escapeHtml(skill.name)}" data-skill-builtin="${skill.builtIn ? "1" : "0"}">
            <span class="sli-text">
              <strong>${escapeHtml(skill.name)}</strong>
              <small>${escapeHtml(skill.description || skill.path || "")}</small>
            </span>
            <span class="sli-badge ${skill.builtIn ? "builtin" : "custom"}">${skill.builtIn ? "Built-in" : "Installed"}</span>
          </button>
        `).join("")}
      </div>
      <div class="config-note">Profile skills directory: ${escapeHtml(state.configPath.replace(/opencode\.json$/, "skills"))}</div>
    </section>
  `
}

function mcpServerSubtitle(server) {
  if (server.type === "local") return Array.isArray(server.command) ? server.command.join(" ") : ""
  return server.url || ""
}

// Resolve the connection state of a server into a status pill + whether an auth action
// is offered. Returns { pill: html, action: "authenticate"|"reconnect"|null }.
function mcpStatusInfo(server) {
  const oauthEligible = server.type === "remote" && server.oauth !== false
  if (state.mcpAuthenticating?.[server.name]) {
    return { pill: `<span class="mcp-pill mcp-pill-pending">Authenticating…</span>`, action: null }
  }
  const status = state.mcpStatus?.[server.name]
  if (!server.enabled) return { pill: `<span class="mcp-pill mcp-pill-muted">Disabled</span>`, action: null }
  if (status === "connected") return { pill: `<span class="mcp-pill mcp-pill-ok">Connected</span>`, action: null }
  if (status === "failed") {
    return { pill: `<span class="mcp-pill mcp-pill-bad">Failed</span>`, action: oauthEligible ? "reconnect" : null }
  }
  if (status === "needs_auth") {
    return { pill: `<span class="mcp-pill mcp-pill-warn">Needs auth</span>`, action: oauthEligible ? "authenticate" : null }
  }
  if (status === "needs_client_registration") {
    return { pill: `<span class="mcp-pill mcp-pill-warn">Needs OAuth app</span>`, action: oauthEligible ? "authenticate" : null }
  }
  return { pill: "", action: null }
}

function renderMcpServerCard(server) {
  const { pill, action } = mcpStatusInfo(server)
  // Prefer the transient action error (from a click); otherwise show opencode's persistent
  // connect-failure reason from GET /mcp so the real cause is always visible on a failed card.
  const errorText = (state.mcpError && state.mcpErrorTarget === server.name)
    ? state.mcpError
    : (state.mcpStatusError?.[server.name] || "")
  const error = errorText ? `<div class="mcp-card-error">${escapeHtml(errorText)}</div>` : ""
  const authBtn = action
    ? `<button class="secondary-btn" data-action="authenticateMcp" data-mcp-name="${escapeHtml(server.name)}">${icon("arrowUp")}${action === "reconnect" ? "Reconnect" : "Authenticate"}</button>`
    : ""
  // On a failed connect, offer a reset that clears any stale stored OAuth state before re-auth —
  // this recovers from a partial/dynamic registration left by an earlier attempt.
  const clearBtn = action === "reconnect"
    ? `<button class="secondary-btn" data-action="clearMcpAuth" data-mcp-name="${escapeHtml(server.name)}" title="Clear stored credentials and authenticate again">${icon("trash")}Reset auth</button>`
    : ""
  return `
    <div class="mcp-card">
      <div class="mcp-card-main">
        <span class="mcp-card-icon">${icon("server")}</span>
        <span class="mcp-card-text">
          <strong>${escapeHtml(server.name)}</strong>
          <small>${escapeHtml(mcpServerSubtitle(server))}</small>
        </span>
        ${pill}
      </div>
      <div class="mcp-card-actions">
        ${authBtn}
        ${clearBtn}
        <button class="secondary-btn" data-action="editMcp" data-mcp-name="${escapeHtml(server.name)}">${icon("edit")}Edit</button>
        <span class="mcp-pill mcp-pill-type">${server.type === "remote" ? "Remote" : "Local"}</span>
        <button class="switch ${server.enabled ? "on" : ""}" role="switch" aria-checked="${server.enabled ? "true" : "false"}" data-mcp-toggle="${escapeHtml(server.name)}" data-mcp-enabled="${server.enabled ? "1" : "0"}" title="${server.enabled ? "Disable" : "Enable"}"></button>
        <button class="small-icon-btn mcp-delete" data-action="removeMcp" data-mcp-name="${escapeHtml(server.name)}" aria-label="Remove ${escapeHtml(server.name)}">${icon("trash")}</button>
      </div>
      ${error}
    </div>
  `
}

function renderMcpPresetCard(preset) {
  const connected = (state.mcpServers || []).some((server) => server.name === preset.id)
  // Prefer a remote image when the preset ships an iconUrl (e.g. Slack, Backlog), otherwise
  // fall back to the inline SVG from the icon map.
  const iconHtml = preset.iconUrl
    ? `<img class="mcp-card-img" src="${escapeHtml(preset.iconUrl)}" alt="${escapeHtml(preset.name)}" loading="lazy">`
    : icon(preset.icon)
  return `
    <div class="mcp-preset ${connected ? "connected" : ""}">
      <div class="mcp-preset-head">
        <span class="mcp-card-icon">${iconHtml}</span>
        <strong>${escapeHtml(preset.name)}</strong>
        ${preset.needsClientApp ? `<span class="mcp-pill mcp-pill-type">OAuth app</span>` : ""}
      </div>
      <p class="mcp-preset-blurb">${escapeHtml(preset.blurb)}</p>
      ${connected
        ? `<button class="secondary-btn" disabled>${icon("check")}Added</button>`
        : `<button class="secondary-btn" data-action="connectPreset" data-preset-id="${escapeHtml(preset.id)}">${icon("plus")}Connect</button>`}
    </div>
  `
}

function renderMcpPanel() {
  const servers = state.mcpServers || []
  return `
    <section class="admin-panel skills-panel">
      <div class="panel-head"><div><h1>Extensions (MCP servers)</h1><p>Each extension is an MCP server that gives the agent extra tools. Pick a featured app or connect your own.</p></div><button class="primary-btn" data-action="openMcpModal">${icon("plus")}Add Custom App</button></div>

      <div class="mcp-section-label">Featured</div>
      <div class="mcp-preset-grid">
        ${MCP_PRESETS.map(renderMcpPresetCard).join("")}
      </div>

      <div class="mcp-section-label">Connected</div>
      <div class="mcp-card-list">
        ${servers.length ? servers.map(renderMcpServerCard).join("") : `<div class="config-note">No apps connected yet. Pick a featured app above or click "Add Custom App".</div>`}
      </div>
      ${state.mcpError && !state.mcpErrorTarget && !state.mcpModalOpen ? `<div class="config-note field-error">${escapeHtml(state.mcpError)}</div>` : ""}
    </section>
  `
}

function renderMcpOauthSection(draft) {
  const lock = state.mcpSaving ? "disabled" : ""
  const mode = draft.oauthMode || "auto"
  const advanced = !!draft.oauthAdvancedOpen
  const secretPlaceholder = draft.hasStoredSecret ? "•••• (stored — leave blank to keep)" : "Paste the OAuth client secret"
  return `
    <div class="mcp-field-label">Authentication</div>
    <div class="mcp-type-toggle">
      <button class="mcp-type-opt ${mode === "auto" ? "active" : ""}" data-mcp-oauth-mode="auto" ${lock}>Auto</button>
      <button class="mcp-type-opt ${mode === "custom" ? "active" : ""}" data-mcp-oauth-mode="custom" ${lock}>OAuth app</button>
      <button class="mcp-type-opt ${mode === "disabled" ? "active" : ""}" data-mcp-oauth-mode="disabled" ${lock}>None</button>
    </div>
    <div class="config-note mcp-oauth-hint">${
      mode === "auto" ? "The server registers a client automatically (works for most MCP servers). You'll sign in after adding."
      : mode === "custom" ? "Use this for servers that need a pre-registered OAuth app, such as Slack MCP."
      : "No OAuth — the server is reached directly (or via custom headers)."
    }</div>
    ${mode === "custom" ? `
      <button class="mcp-advanced-toggle" data-action="toggleMcpAdvanced" ${lock}>${icon(advanced ? "chevDown" : "chevRight")}Advanced OAuth</button>
      ${advanced ? `
        <div class="mcp-advanced">
          <label for="mcpOauthClientId">OAuth client ID
            <input id="mcpOauthClientId" type="text" value="${escapeHtml(draft.oauthClientId || "")}" placeholder="Paste the OAuth client ID" data-mcp-field="oauthClientId" ${lock}>
          </label>
          <label for="mcpOauthClientSecret">OAuth client secret
            <input id="mcpOauthClientSecret" type="password" value="${escapeHtml(draft.oauthClientSecret || "")}" placeholder="${escapeHtml(secretPlaceholder)}" data-mcp-field="oauthClientSecret" autocomplete="off" ${lock}>
          </label>
          <label for="mcpOauthScope">OAuth scopes
            <input id="mcpOauthScope" type="text" value="${escapeHtml(draft.oauthScope || "")}" placeholder="Optional, space-separated scopes" data-mcp-field="oauthScope" ${lock}>
          </label>
          <div class="mcp-warning">Keep client secrets out of chats and source control. Store only credentials issued for this app.</div>
          ${draft.presetDocsUrl ? `<button class="link-btn" data-action="openMcpDocs" data-docs-url="${escapeHtml(draft.presetDocsUrl)}">${icon("book")}Where do I get these?</button>` : ""}
        </div>
      ` : ""}
    ` : ""}
  `
}

function renderMcpModal() {
  const draft = state.mcpDraft
  if (!state.mcpModalOpen || !draft) return ""
  const editing = !!state.mcpEditTarget
  const disable = state.mcpSaving ? " disabled" : ""
  const isRemote = draft.type !== "local"
  const headers = Array.isArray(draft.headers) ? draft.headers : []
  const env = Array.isArray(draft.env) ? draft.env : []
  return `
    <div class="update-backdrop" ${state.mcpSaving ? "" : 'data-action="closeMcpModal"'}>
      <div class="confirm-modal rename-modal mcp-modal" role="dialog" aria-modal="true" aria-labelledby="mcpModalTitle" data-stop-click>
        <div class="confirm-title" id="mcpModalTitle">${editing ? "Edit App" : "Add Custom App"}</div>
        <p>Connect a custom MCP server by URL or local command.</p>
        <div class="rename-modal-body">
          <label for="mcpName">
            App name
            <input id="mcpName" type="text" value="${escapeHtml(draft.name)}" placeholder="sentry-mcp" data-mcp-field="name" ${editing || state.mcpSaving ? "disabled" : ""}>
          </label>
          <div class="mcp-field-label">Type</div>
          <div class="mcp-type-toggle">
            <button class="mcp-type-opt ${isRemote ? "active" : ""}" data-mcp-type="remote" ${disable}>Remote (URL)</button>
            <button class="mcp-type-opt ${isRemote ? "" : "active"}" data-mcp-type="local" ${disable}>Local (command)</button>
          </div>
          ${isRemote ? `
            <label for="mcpUrl">
              Server URL
              <input id="mcpUrl" type="text" value="${escapeHtml(draft.url)}" placeholder="https://mcp.sentry.dev/mcp" data-mcp-field="url" ${state.mcpSaving ? "disabled" : ""}>
            </label>
            ${renderMcpOauthSection(draft)}
            <div class="mcp-headers">
              <div class="mcp-field-label">Custom headers</div>
              ${headers.map((header, index) => `
                <div class="mcp-headers-row">
                  <input type="text" value="${escapeHtml(header.key)}" placeholder="Header" data-mcp-header="key" data-mcp-header-index="${index}" ${state.mcpSaving ? "disabled" : ""}>
                  <input type="text" value="${escapeHtml(header.value)}" placeholder="Value" data-mcp-header="value" data-mcp-header-index="${index}" ${state.mcpSaving ? "disabled" : ""}>
                  <button class="small-icon-btn" data-action="removeMcpHeader" data-mcp-header-index="${index}" aria-label="Remove header" ${disable}>${icon("x")}</button>
                </div>
              `).join("")}
              <button class="link-btn" data-action="addMcpHeader" ${disable}>${icon("plus")}Add header</button>
            </div>
          ` : `
            <label for="mcpCommand">
              Command
              <input id="mcpCommand" type="text" value="${escapeHtml(draft.command)}" placeholder="npx -y some-mcp-server" data-mcp-field="command" ${state.mcpSaving ? "disabled" : ""}>
            </label>
            <div class="mcp-headers">
              <div class="mcp-field-label">Environment variables</div>
              ${env.map((row, index) => `
                <div class="mcp-headers-row">
                  <input type="text" value="${escapeHtml(row.key)}" placeholder="KEY" data-mcp-env="key" data-mcp-env-index="${index}" ${state.mcpSaving ? "disabled" : ""}>
                  <input type="text" value="${escapeHtml(row.value)}" placeholder="Value" data-mcp-env="value" data-mcp-env-index="${index}" ${state.mcpSaving ? "disabled" : ""}>
                  <button class="small-icon-btn" data-action="removeMcpEnv" data-mcp-env-index="${index}" aria-label="Remove variable" ${disable}>${icon("x")}</button>
                </div>
              `).join("")}
              <button class="link-btn" data-action="addMcpEnv" ${disable}>${icon("plus")}Add variable</button>
            </div>
          `}
          <div class="field-error">${state.mcpError && state.mcpModalOpen ? escapeHtml(state.mcpError) : ""}</div>
        </div>
        <div class="confirm-actions">
          <button class="secondary-btn${disable}" data-action="closeMcpModal">Cancel</button>
          <button class="primary-btn${disable}" data-action="submitMcpServer">${icon(editing ? "save" : "plus")}${state.mcpSaving ? "Saving…" : (editing ? "Save changes" : "Add App")}</button>
        </div>
      </div>
    </div>
  `
}

function renderMcpDeleteModal() {
  const target = state.mcpDeleteTarget
  if (!target) return ""
  const disableActions = state.mcpRemoving ? " disabled" : ""
  return `
    <div class="update-backdrop" ${state.mcpRemoving ? "" : 'data-action="cancelRemoveMcp"'}>
      <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="removeMcpTitle" data-stop-click>
        <div class="confirm-title" id="removeMcpTitle">Remove MCP server?</div>
        <p>“${escapeHtml(target.name)}” will be disconnected and removed from your config.</p>
        <div class="confirm-actions">
          <button class="secondary-btn${disableActions}" data-action="cancelRemoveMcp">Cancel</button>
          <button class="danger-btn${disableActions}" data-action="confirmRemoveMcp">Remove</button>
        </div>
      </div>
    </div>
  `
}

function stripSkillFrontmatter(markdown) {
  const text = String(markdown || "")
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return match ? text.slice(match[0].length).replace(/^\s+/, "") : text
}

function renderSkillPreviewModal() {
  const preview = state.skillPreview
  if (!preview) return ""
  let body
  if (state.skillPreviewLoading) {
    body = `<div class="skill-preview-state">Loading SKILL.md...</div>`
  } else if (state.skillPreviewError) {
    body = `<div class="skill-preview-state error">${escapeHtml(state.skillPreviewError)}</div>`
  } else {
    body = `<div class="skill-preview-md assistant-text">${renderMarkdown(stripSkillFrontmatter(state.skillPreviewContent))}</div>`
  }
  return `
    <div class="update-backdrop" ${state.skillUninstalling ? "" : 'data-action="closeSkillPreview"'}>
      <div class="skill-preview-modal" role="dialog" aria-modal="true" aria-labelledby="skillPreviewTitle" data-stop-click>
        <div class="skill-preview-head">
          <div class="sph-title">
            <span class="sli-icon">${icon("sparkle")}</span>
            <div><h1 id="skillPreviewTitle">${escapeHtml(preview.name)}</h1><small>${preview.builtIn ? "Built-in skill" : "Custom skill"}</small></div>
          </div>
          <button class="small-icon-btn" data-action="closeSkillPreview" aria-label="Close preview">${icon("x")}</button>
        </div>
        <div class="skill-preview-body">${body}</div>
        <div class="skill-preview-foot">
          <button class="danger-btn ${state.skillUninstalling ? "disabled" : ""}" data-action="uninstallSkill" data-skill-name="${escapeHtml(preview.name)}" ${preview.builtIn ? "disabled" : ""}>
            ${icon("trash")}<span>${state.skillUninstalling ? "Uninstalling..." : "Uninstall"}</span>
          </button>
        </div>
      </div>
    </div>
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

// Toggles the per-session "running" dots in the sidebar in place, so a session
// going busy/idle (including a backgrounded one) updates its badge without a full
// re-render that would disrupt scroll/focus elsewhere.
function renderSessionBadges() {
  document.querySelectorAll("[data-session-row]").forEach((row) => {
    const dot = row.querySelector(".session-busy-dot")
    if (dot) dot.classList.toggle("on", sessionBusy(row.dataset.sessionRow))
  })
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

function bindFileRefActions(root = document) {
  root.querySelectorAll("[data-open-file]").forEach((element) => element.addEventListener("click", () =>
    openDocument(element.dataset.openFile, { tab: element.dataset.openTab || null }).catch((error) => showToast(error.message))))
}

function bindDocTabActions(root = document) {
  root.querySelectorAll("[data-doc-tab]").forEach((element) => element.addEventListener("click", () => switchDocumentTab(element.dataset.docTab)))
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
  const request = (activeThread().pendingQuestions || []).find((item) => item.requestID === requestID)
  const questionCount = Array.isArray(request?.questions) ? request.questions.length : 1
  // The runtime expects one answer entry per question prompt in the request.
  const answers = Array.from({ length: questionCount }, (_value, i) => (i === index ? answer : []))
  if (!state.activeSessionId) throw new Error("No active session for this question.")
  await window.openworking.runtime.answerQuestion({ sessionId: state.activeSessionId, requestID, answers })
  clearQuestionDrafts(requestID)
  clearPendingQuestion(activeThread(), requestID)
  renderThreadContent()
}

async function dismissQuestion(requestID) {
  if (!state.activeSessionId) throw new Error("No active session for this question.")
  await window.openworking.runtime.rejectQuestion({ sessionId: state.activeSessionId, requestID })
  clearQuestionDrafts(requestID)
  clearPendingQuestion(activeThread(), requestID)
  renderThreadContent()
}

async function replyPermission(requestID, decision) {
  if (!state.activeSessionId) throw new Error("No active session for this request.")
  await window.openworking.runtime.replyPermission({ sessionId: state.activeSessionId, requestID, reply: decision })
  clearPendingPermission(activeThread(), requestID)
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
  document.querySelectorAll("[data-document-resizer]").forEach((element) => element.addEventListener("mousedown", startDocumentViewerResize))
  document.querySelectorAll("[data-right-file-resizer]").forEach((element) => element.addEventListener("mousedown", startRightFileSidebarResize))
  document.querySelectorAll("[data-tree-dir]").forEach((element) => element.addEventListener("click", () => toggleFileTreeDirectory(element.dataset.treeDir).catch((error) => showToast(error.message))))
  document.querySelectorAll("[data-tree-file]").forEach((element) => element.addEventListener("click", () => openFileTreeFile(element.dataset.treeFile).catch((error) => showToast(error.message))))
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
  document.querySelectorAll("[data-session-rename]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation()
    state.sessionRenameTarget = {
      sessionId: element.dataset.sessionRename,
      projectId: element.dataset.sessionProject,
      title: element.dataset.sessionTitle || "",
      label: element.dataset.sessionLabel || "Untitled session",
    }
    state.sessionRenameDraft = element.dataset.sessionTitle || ""
    state.sessionRenameError = null
    state.sessionRenaming = false
    state.sessionRenameAutoFocus = true
    state.sessionMenu = null
    render()
  }))
  document.querySelectorAll("[data-session-rename-input]").forEach((element) => {
    element.addEventListener("input", () => {
      state.sessionRenameDraft = element.value
      state.sessionRenameError = null
    })
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault()
        confirmRenameSession().catch((error) => showToast(error.message))
      }
      if (event.key === "Escape" && !state.sessionRenaming) {
        event.preventDefault()
        closeRenameSessionModal()
      }
    })
  })
  if (state.sessionRenameTarget && state.sessionRenameAutoFocus) {
    const input = document.querySelector("[data-session-rename-input]")
    if (input) {
      input.focus()
      input.select()
    }
    state.sessionRenameAutoFocus = false
  }
  if (state.sessionRenameFocusId) {
    const trigger = [...document.querySelectorAll("[data-session-menu]")].find((element) => element.dataset.sessionMenu === state.sessionRenameFocusId)
    trigger?.focus()
    state.sessionRenameFocusId = null
  }
  document.querySelectorAll("[data-project-menu]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation()
    const id = element.dataset.projectMenu
    state.projectMenu = state.projectMenu === id ? null : id
    render()
  }))
  document.querySelectorAll("[data-project-rename]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation()
    openRenameProjectModal(element.dataset.projectRename, element.dataset.projectName || "")
  }))
  document.querySelectorAll("[data-project-delete]").forEach((element) => element.addEventListener("click", (event) => {
    event.stopPropagation()
    state.projectDeleteTarget = { id: element.dataset.projectDelete, name: element.dataset.projectName || "this project" }
    state.projectRemoving = false
    state.projectMenu = null
    render()
  }))
  document.querySelectorAll("[data-project-rename-input]").forEach((element) => {
    element.addEventListener("input", () => {
      state.projectRenameDraft = element.value
      state.projectRenameError = null
    })
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault()
        confirmRenameProject().catch((error) => showToast(error.message))
      }
      if (event.key === "Escape" && !state.projectRenaming) {
        event.preventDefault()
        closeRenameProjectModal()
      }
    })
  })
  if (state.projectRenameTarget && state.projectRenameAutoFocus) {
    const input = document.querySelector("[data-project-rename-input]")
    if (input) {
      input.focus()
      input.select()
    }
    state.projectRenameAutoFocus = false
  }
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
  document.querySelectorAll("[data-settings-section]").forEach((element) => element.addEventListener("click", () => {
    state.settingsSection = element.dataset.settingsSection
    render()
  }))
  document.querySelectorAll("[data-skill-open]").forEach((element) => element.addEventListener("click", () => {
    openSkillPreview(element.dataset.skillOpen, element.dataset.skillBuiltin === "1")
  }))
  document.querySelectorAll("[data-skills-tab]").forEach((element) => element.addEventListener("click", () => {
    state.skillsTab = element.dataset.skillsTab
    render()
    if (state.skillsTab === "mcp") refreshMcpStatus()
  }))
  document.querySelectorAll("[data-mcp-type]").forEach((element) => element.addEventListener("click", () => {
    if (state.mcpSaving || !state.mcpDraft) return
    state.mcpDraft.type = element.dataset.mcpType
    state.mcpError = null
    render()
  }))
  document.querySelectorAll("[data-mcp-toggle]").forEach((element) => element.addEventListener("click", () => {
    toggleMcpEnabled(element.dataset.mcpToggle, element.dataset.mcpEnabled !== "1")
  }))
  document.querySelectorAll("[data-mcp-field]").forEach((element) => element.addEventListener("input", () => {
    if (!state.mcpDraft) return
    state.mcpDraft[element.dataset.mcpField] = element.value
  }))
  document.querySelectorAll("[data-mcp-oauth-mode]").forEach((element) => element.addEventListener("click", () => {
    if (state.mcpSaving || !state.mcpDraft) return
    const mode = element.dataset.mcpOauthMode
    state.mcpDraft.oauthMode = mode
    if (mode === "custom") state.mcpDraft.oauthAdvancedOpen = true
    state.mcpError = null
    render()
  }))
  document.querySelectorAll("[data-mcp-header]").forEach((element) => element.addEventListener("input", () => {
    if (!state.mcpDraft) return
    const index = Number(element.dataset.mcpHeaderIndex)
    const row = state.mcpDraft.headers?.[index]
    if (row) row[element.dataset.mcpHeader] = element.value
  }))
  document.querySelectorAll("[data-mcp-env]").forEach((element) => element.addEventListener("input", () => {
    if (!state.mcpDraft) return
    const index = Number(element.dataset.mcpEnvIndex)
    const row = state.mcpDraft.env?.[index]
    if (row) row[element.dataset.mcpEnv] = element.value
  }))
  document.querySelectorAll("[data-rename-project]").forEach((element) => element.addEventListener("click", () => openRenameProjectModal(element.dataset.renameProject, element.dataset.projectName || "")))
  document.querySelectorAll("[data-remove-project]").forEach((element) => element.addEventListener("click", () => {
    state.projectDeleteTarget = { id: element.dataset.removeProject, name: element.dataset.projectName || "this project" }
    state.projectRemoving = false
    render()
  }))
  document.querySelectorAll("[data-remove-attachment]").forEach((element) => element.addEventListener("click", () => removeAttachment(element.dataset.removeAttachment)))
  document.querySelectorAll("[data-remove-file-mention]").forEach((element) => element.addEventListener("click", () => removeFileMention(element.dataset.removeFileMention)))
  bindMessageActions()
  bindArtifactActions()
  bindToolStepActions()
  bindFileRefActions()
  bindDocTabActions()
  bindPendingPromptActions()
  bindSkillUploadDrop()
  document.querySelectorAll("[data-command]").forEach((element) => element.addEventListener("mousedown", (event) => {
    event.preventDefault()
    selectCommand(element.dataset.command)
  }))
  const promptInput = document.getElementById("promptInput")
  if (promptInput) {
    promptInput.style.height = "auto"
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, 200)}px`
    syncPromptOverlay(promptInput)
    promptInput.addEventListener("input", () => {
      state.promptDraft = promptInput.value
      syncPendingFileMentions(promptInput.value, { rerender: true, promptInput })
      const liveInput = document.getElementById("promptInput") || promptInput
      const send = document.querySelector(".send")
      if (send) send.classList.toggle("disabled", !threadAbortable() && !liveInput.value.trim())
      liveInput.style.height = "auto"
      liveInput.style.height = `${Math.min(liveInput.scrollHeight, 200)}px`
      syncPromptOverlay(liveInput)
      syncPromptAssist(liveInput)
    })
    promptInput.addEventListener("scroll", () => {
      syncPromptOverlay(promptInput)
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
      if (state.fileMentionMenu.open) {
        const candidates = fileMentionCandidates(state.fileMentionMenu.query)
        if (event.key === "ArrowDown") {
          event.preventDefault()
          state.fileMentionMenu.index = Math.min(state.fileMentionMenu.index + 1, Math.max(candidates.length - 1, 0))
          paintPromptAssistMenu()
          return
        }
        if (event.key === "ArrowUp") {
          event.preventDefault()
          state.fileMentionMenu.index = Math.max(state.fileMentionMenu.index - 1, 0)
          paintPromptAssistMenu()
          return
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault()
          const choice = candidates[state.fileMentionMenu.index]
          if (choice) selectFileMention(choice).catch((error) => showToast(error.message))
          else closeFileMentionMenu()
          return
        }
        if (event.key === "Escape") {
          event.preventDefault()
          closeFileMentionMenu()
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
  paintPromptAssistMenu()
}

function paintPromptAssistMenu() {
  const wrap = document.querySelector(".ta-wrap")
  if (!wrap) return
  const existing = wrap.querySelector(".prompt-pop")
  if (existing) existing.remove()
  const html = renderCommandMenu() || renderFileMentionMenu()
  if (html) wrap.insertAdjacentHTML("afterbegin", html)
  wrap.querySelectorAll("[data-command]").forEach((element) => element.addEventListener("mousedown", (event) => {
    event.preventDefault()
    selectCommand(element.dataset.command)
  }))
  wrap.querySelectorAll("[data-file-mention]").forEach((element) => element.addEventListener("mousedown", (event) => {
    event.preventDefault()
    selectFileMention(element.dataset.fileMention).catch((error) => showToast(error.message))
  }))
}

function syncPromptOverlay(promptInput) {
  const overlay = document.getElementById("promptOverlay")
  const overlayFrame = overlay?.parentElement
  if (!overlay || !overlayFrame || !promptInput) return
  overlay.innerHTML = renderPromptOverlayHtml(promptInput.value, state.pendingFileMentions)
  overlayFrame.scrollTop = promptInput.scrollTop
}

function syncPromptAssist(promptInput) {
  const caret = promptInput.selectionStart ?? promptInput.value.length
  const beforeCaret = promptInput.value.slice(0, caret)
  const commandMatch = beforeCaret.match(/(?:^|\s)\/([\w-]*)$/)
  if (commandMatch) {
    state.commandMenu = { open: true, query: commandMatch[1], index: 0 }
    state.fileMentionMenu.open = false
    paintPromptAssistMenu()
    return
  }
  const fileMatch = beforeCaret.match(/(?:^|\s)@([^\s@]*)$/)
  if (fileMatch) {
    state.commandMenu = { open: false, query: "", index: 0 }
    state.fileMentionMenu.open = true
    state.fileMentionMenu.query = fileMatch[1]
    state.fileMentionMenu.index = 0
    if (state.fileMentionMenu.projectId !== state.activeProjectId) {
      state.fileMentionMenu.files = []
      state.fileMentionMenu.loading = false
      state.fileMentionMenu.error = ""
      state.fileMentionMenu.loadPromise = null
      state.fileMentionMenu.projectId = state.activeProjectId
    }
    paintPromptAssistMenu()
    ensureProjectFileCandidates().catch((error) => showToast(error.message))
    return
  }
  state.commandMenu = { open: false, query: "", index: 0 }
  state.fileMentionMenu.open = false
  state.fileMentionMenu.query = ""
  state.fileMentionMenu.index = 0
  paintPromptAssistMenu()
}

function closeCommandMenu() {
  state.commandMenu = { open: false, query: "", index: 0 }
  paintPromptAssistMenu()
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
  state.fileMentionMenu.open = false
  promptInput.value = next
  promptInput.focus()
  promptInput.setSelectionRange(before.length, before.length)
  promptInput.style.height = "auto"
  promptInput.style.height = `${Math.min(promptInput.scrollHeight, 200)}px`
  syncPromptOverlay(promptInput)
  const send = document.querySelector(".send")
  if (send) send.classList.toggle("disabled", !threadAbortable() && !next.trim())
  paintPromptAssistMenu()
}

async function selectFileMention(filePath) {
  const promptInput = document.getElementById("promptInput")
  if (!filePath || !promptInput) {
    closeFileMentionMenu()
    return
  }
  const token = fileMentionTokenForPath(filePath)
  const value = promptInput.value
  const caret = promptInput.selectionStart ?? value.length
  const before = value.slice(0, caret).replace(/(^|\s)@([^\s@]*)$/, `$1${token}`)
  const after = value.slice(caret)
  const spacer = after && /^\s/.test(after) ? "" : " "
  const next = `${before}${spacer}${after}`
  state.promptDraft = next
  state.pendingFileMentions = [
    ...state.pendingFileMentions.filter((fileMention) => fileMention.token !== token),
    { token, path: filePath, name: filename(filePath) }
  ]
  closeFileMentionMenu()
  render()
  const freshInput = document.getElementById("promptInput")
  if (freshInput) {
    freshInput.focus()
    const selection = before.length + spacer.length
    freshInput.setSelectionRange(selection, selection)
    freshInput.style.height = "auto"
    freshInput.style.height = `${Math.min(freshInput.scrollHeight, 200)}px`
    syncPromptOverlay(freshInput)
  }
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

function startRightFileSidebarResize(event) {
  event.preventDefault()
  const sidebar = document.querySelector(".right-file-sidebar")
  if (!sidebar) return
  const startX = event.clientX
  const startWidth = sidebar.getBoundingClientRect().width
  document.body.style.cursor = "col-resize"
  document.body.style.userSelect = "none"

  let width = startWidth
  const onMove = (moveEvent) => {
    width = setRightFileSidebarWidth(startWidth + startX - moveEvent.clientX)
  }
  const onUp = () => {
    document.removeEventListener("mousemove", onMove)
    document.removeEventListener("mouseup", onUp)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    localStorage.setItem(RIGHT_FILE_WIDTH_KEY, String(width))
  }
  document.addEventListener("mousemove", onMove)
  document.addEventListener("mouseup", onUp)
}

function startDocumentViewerResize(event) {
  event.preventDefault()
  const viewer = document.querySelector(".document-viewer")
  if (!viewer) return
  const startX = event.clientX
  const startWidth = viewer.getBoundingClientRect().width
  document.body.style.cursor = "col-resize"
  document.body.style.userSelect = "none"

  let width = startWidth
  const onMove = (moveEvent) => {
    width = setDocumentViewerWidth(startWidth + startX - moveEvent.clientX)
  }
  const onUp = () => {
    document.removeEventListener("mousemove", onMove)
    document.removeEventListener("mouseup", onUp)
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    localStorage.setItem(DOCUMENT_WIDTH_KEY, String(width))
  }
  document.addEventListener("mousemove", onMove)
  document.addEventListener("mouseup", onUp)
}

async function copyMessage(messageId) {
  const message = activeThread().messages.find((item) => item.id === messageId)
  const text = message ? messageCopyText(message) : ""
  if (!text) return
  await window.openworking.clipboard.writeText(text)
  showToast("Message copied")
}

async function openArtifact(artifactPath) {
  if (!artifactPath) return
  showDocument({ requestedPath: artifactPath, path: artifactPath, name: filename(artifactPath), relativePath: "", content: "", loading: true, error: "", artifact: true, previewMode: "loading", renderMode: "markdown", tab: "code" })
  try {
    const preview = await window.openworking.artifacts.preview(artifactPath)
    if (state.document?.requestedPath !== artifactPath) return
    const renderMode = preview.previewMode === "markdown" ? "markdown" : preview.previewMode
    state.document = { requestedPath: artifactPath, ...preview, artifact: true, loading: false, error: "", renderMode, tab: "code" }
  } catch (error) {
    if (state.document?.requestedPath !== artifactPath) return
    state.document = { requestedPath: artifactPath, path: artifactPath, name: filename(artifactPath), relativePath: "", content: "", loading: false, error: error.message, artifact: true, previewMode: "error", renderMode: "markdown", tab: "code" }
  }
  render()
}

async function openArtifactExternally(artifactPath) {
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
    if (action === "toggleSidebar") toggleSidebar()
    if (action === "toggleRightSidebar") await toggleRightSidebar()
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
    if (action === "closeSkillPreview") {
      if (state.skillUninstalling) return
      state.skillPreview = null
      state.skillPreviewContent = null
      state.skillPreviewError = null
      render()
    }
    if (action === "uninstallSkill") {
      await uninstallSkill(event.currentTarget.dataset.skillName)
    }
    if (action === "openMcpModal") openMcpModal()
    if (action === "closeMcpModal") closeMcpModal()
    if (action === "submitMcpServer") await submitMcpServer()
    if (action === "connectPreset") openMcpModalForPreset(event.currentTarget.dataset.presetId)
    if (action === "editMcp") openMcpModalForEdit(event.currentTarget.dataset.mcpName)
    if (action === "toggleMcpAdvanced") {
      state.mcpDraft.oauthAdvancedOpen = !state.mcpDraft.oauthAdvancedOpen
      render()
    }
    if (action === "openMcpDocs") {
      const url = event.currentTarget.dataset.docsUrl
      if (url) await window.openworking.mcp.openDocs(url)
    }
    if (action === "addMcpHeader") {
      state.mcpDraft.headers = [...(state.mcpDraft.headers || []), { key: "", value: "" }]
      render()
    }
    if (action === "removeMcpHeader") {
      const index = Number(event.currentTarget.dataset.mcpHeaderIndex)
      state.mcpDraft.headers = (state.mcpDraft.headers || []).filter((_, i) => i !== index)
      render()
    }
    if (action === "addMcpEnv") {
      state.mcpDraft.env = [...(state.mcpDraft.env || []), { key: "", value: "" }]
      render()
    }
    if (action === "removeMcpEnv") {
      const index = Number(event.currentTarget.dataset.mcpEnvIndex)
      state.mcpDraft.env = (state.mcpDraft.env || []).filter((_, i) => i !== index)
      render()
    }
    if (action === "removeMcp") {
      state.mcpDeleteTarget = { name: event.currentTarget.dataset.mcpName }
      state.mcpRemoving = false
      render()
    }
    if (action === "authenticateMcp") {
      await authenticateMcp(event.currentTarget.dataset.mcpName)
    }
    if (action === "clearMcpAuth") {
      await authenticateMcp(event.currentTarget.dataset.mcpName, { clear: true })
    }
    if (action === "cancelRemoveMcp") {
      if (state.mcpRemoving) return
      state.mcpDeleteTarget = null
      render()
    }
    if (action === "confirmRemoveMcp") await confirmRemoveMcp()
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
    if (action === "cancelRenameSession") closeRenameSessionModal()
    if (action === "confirmRenameSession") await confirmRenameSession()
    if (action === "cancelRemoveProject") {
      state.projectDeleteTarget = null
      render()
    }
    if (action === "confirmRemoveProject") {
      const target = state.projectDeleteTarget
      state.projectDeleteTarget = null
      render()
      if (target) await removeProject(target.id)
    }
    if (action === "cancelRenameProject") closeRenameProjectModal()
    if (action === "confirmRenameProject") await confirmRenameProject()
    if (action === "toggleDiagnostics") {
      state.diagnosticsOpen = !state.diagnosticsOpen
      render()
    }
    if (action === "stopRuntime") {
      await window.openworking.runtime.stop()
      render()
    }
    if (action === "closeDocument") closeDocument()
    if (action === "openExternalArtifact") await openArtifactExternally(event.currentTarget.dataset.artifactPath)
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

function removeFileMention(token) {
  if (!token) return
  const promptInput = document.getElementById("promptInput")
  const currentValue = promptInput?.value ?? state.promptDraft
  const next = currentValue.replace(token, "").replace(/\s{2,}/g, " ")
  state.pendingFileMentions = state.pendingFileMentions.filter((fileMention) => fileMention.token !== token)
  state.promptDraft = next
  render()
  const freshInput = document.getElementById("promptInput")
  if (freshInput) {
    freshInput.focus()
    const caret = next.length
    freshInput.setSelectionRange(caret, caret)
    freshInput.style.height = "auto"
    freshInput.style.height = `${Math.min(freshInput.scrollHeight, 200)}px`
    syncPromptOverlay(freshInput)
  }
}

async function clearPendingAttachments() {
  const ids = state.pendingAttachments.map((attachment) => attachment.id)
  state.pendingAttachments = []
  state.pendingFileMentions = []
  if (ids.length) await window.openworking.attachments.discard(ids)
}

async function abortSession() {
  if (!state.activeSessionId || !threadAbortable()) return
  await window.openworking.runtime.abortSession({ sessionId: state.activeSessionId })
  activeThread().status = { type: "idle" }
  updateComposerSubmitButton()
  renderSessionBadges()
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
  const switchingProject = state.activeProjectId !== projectId
  state.activeProjectId = projectId
  resetFileTree(projectId)
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
    // Opening a different project's runtime drops the old project's sessions — clear
    // their in-memory threads so background state from another workspace can't leak.
    if (switchingProject) pruneThreads(sessions.map((session) => session.id))
    if (selectLatest && sessions[0]) {
      state.activeSessionId = sessions[0].id
      hydrateActiveThread(await window.openworking.runtime.listMessages({ sessionId: sessions[0].id }), state.runtime.activeSessionStatus)
      scrollLatest = true
    }
  } finally {
    state.loading = false
    render({ threadScroll: scrollLatest ? "latest" : "preserve" })
  }
  if (state.rightSidebarOpen) loadFileTreeDirectory("").catch((error) => showToast(error.message))
}

// Drops threads for sessions no longer present, keeping the active/draft threads.
// Prevents unbounded growth and cross-project bleed of background session state.
function pruneThreads(keepSessionIds) {
  const keep = new Set([...keepSessionIds, state.activeSessionId, null])
  for (const sessionId of [...state.threads.keys()]) {
    if (!keep.has(sessionId)) state.threads.delete(sessionId)
  }
}

function chooseSessionAfterRuntimeReconnect(currentSessionId, sessions) {
  if (!currentSessionId) return null
  return sessions.some((session) => session.id === currentSessionId) ? currentSessionId : null
}

async function ensureRuntimeProject(projectId, { preserveSessionId = null } = {}) {
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) return null

  state.loading = true
  render()
  try {
    state.runtime = await window.openworking.runtime.openProject(project)
    state.commands = await window.openworking.runtime.listCommands().catch(() => [])
    state.commandMenu = { open: false, query: "", index: 0 }
    const sessions = await window.openworking.runtime.listSessions()
    state.sessionsByProject[projectId] = sessions
    return chooseSessionAfterRuntimeReconnect(preserveSessionId, sessions)
  } finally {
    state.loading = false
    render()
  }
}

async function newSession(projectId, { clearAttachments = true } = {}) {
  if (!projectId) return
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) return
  if (clearAttachments) await clearPendingAttachments()
  state.activeProjectId = projectId
  resetFileTree(projectId)
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
  if (state.rightSidebarOpen) loadFileTreeDirectory("").catch((error) => showToast(error.message))
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
  // If we already hold a live thread for this session that is mid-flight (busy), keep
  // it as-is — re-hydrating from the server would drop streamed parts not yet
  // persisted there. Idle or first-time threads hydrate from the server as before.
  const existing = state.threads.get(sessionId)
  if (!existing || !threadIsBusy(existing)) {
    hydrateActiveThread(await window.openworking.runtime.listMessages({ sessionId }))
  }
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
  state.threads.delete(sessionId)
  if (state.activeSessionId === sessionId) {
    state.activeSessionId = null
    resetActiveThread()
  }
  state.sessionMenu = null
  render()
}

function closeRenameSessionModal({ restoreFocus = true } = {}) {
  if (restoreFocus && state.sessionRenameTarget?.sessionId) {
    state.sessionRenameFocusId = state.sessionRenameTarget.sessionId
  }
  state.sessionRenameTarget = null
  state.sessionRenameDraft = ""
  state.sessionRenameError = null
  state.sessionRenaming = false
  state.sessionRenameAutoFocus = false
  render()
}

async function runWithRuntimeProject(projectId, work) {
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) throw new Error("Could not find that project.")

  const previousRuntimeProjectId = state.runtime?.project?.id || null
  const previousProject = state.projects.find((item) => item.id === previousRuntimeProjectId) || null
  const shouldSwitch = previousRuntimeProjectId !== projectId || state.runtime?.status !== "running"
  const shouldRestore = Boolean(previousProject && previousRuntimeProjectId !== projectId)

  if (shouldSwitch) {
    state.loading = true
    render()
    state.runtime = await window.openworking.runtime.openProject(project)
    state.commands = await window.openworking.runtime.listCommands().catch(() => [])
    state.commandMenu = { open: false, query: "", index: 0 }
  }

  try {
    return await work()
  } finally {
    try {
      if (shouldRestore && previousProject) {
        state.runtime = await window.openworking.runtime.openProject(previousProject)
        state.commands = await window.openworking.runtime.listCommands().catch(() => [])
        state.commandMenu = { open: false, query: "", index: 0 }
      }
    } finally {
      if (shouldSwitch) {
        state.loading = false
        render()
      }
    }
  }
}

async function confirmRenameSession() {
  const target = state.sessionRenameTarget
  if (!target?.sessionId || !target.projectId) {
    closeRenameSessionModal({ restoreFocus: false })
    return
  }
  const trimmedTitle = state.sessionRenameDraft.trim()
  if (!trimmedTitle) {
    state.sessionRenameError = "Session title is required."
    state.sessionRenameAutoFocus = true
    render()
    return
  }
  if (trimmedTitle === (target.title || "").trim()) {
    closeRenameSessionModal()
    return
  }
  if (target.projectId !== state.activeProjectId && threadIsBusy(activeThread())) {
    state.sessionRenameError = "Finish the active session before renaming from another project."
    state.sessionRenameAutoFocus = true
    render()
    return
  }

  state.sessionRenaming = true
  state.sessionRenameError = null
  render()

  try {
    await runWithRuntimeProject(target.projectId, async () => {
      if (state.runtime?.project?.id !== target.projectId || state.runtime?.status !== "running") {
        throw new Error("Could not open the session workspace.")
      }
      await window.openworking.runtime.renameSession({ sessionId: target.sessionId, title: trimmedTitle })
      state.sessionsByProject[target.projectId] = await window.openworking.runtime.listSessions()
    })
    closeRenameSessionModal()
  } catch (error) {
    state.sessionRenaming = false
    state.sessionRenameError = error.message || "Could not rename session."
    state.sessionRenameAutoFocus = true
    render()
  }
}

async function acceptPlan() {
  // Accepting a plan switches out of Plan mode into Execution mode (build agent)
  // and asks the agent to carry out the plan it just proposed.
  state.planAccepted = state.activeSessionId
  state.planProposal = null
  state.mode = "agent"
  state.document = null
  render()
  await sendPrompt("The plan above is approved. Please execute it.")
}

async function rejectPlan() {
  // Rejecting a plan stops the current session response (if any) and dismisses the
  // proposal card. The plan is abandoned with no follow-up prompt.
  if (threadAbortable()) await abortSession()
  state.planAccepted = state.activeSessionId  // marks the proposal resolved -> card hides
  state.planProposal = null
  render()
}

async function sendPrompt(rawPrompt) {
  state.commandMenu = { open: false, query: "", index: 0 }
  state.fileMentionMenu.open = false
  state.fileMentionMenu.query = ""
  state.fileMentionMenu.index = 0
  const prompt = String(rawPrompt || "").trim()
  const project = selectedProject()
  if (!prompt || !project) return
  const commandMatch = prompt.match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/)
  const command = commandMatch && findCommand(commandMatch[1]) ? commandMatch[1] : null
  const commandArgs = command ? (commandMatch[2] || "") : ""
  const fileMentions = command ? [] : await fileMentionsForSubmit(prompt, command)
  const attachments = computePromptAttachments({
    command,
    pendingAttachments: state.pendingAttachments,
    fileMentions
  })
  const effectivePrompt = command ? prompt : applyPendingFileMentions(prompt, fileMentions)
  const mode = modes.find((item) => item.id === state.mode) || modes[0]
  if (state.runtime?.project?.id !== project.id || state.runtime.status !== "running") {
    state.activeSessionId = await ensureRuntimeProject(project.id, { preserveSessionId: state.activeSessionId })
  }
  if (!state.activeSessionId) {
    const title = prompt.length > 54 ? `${prompt.slice(0, 53).trim()}...` : prompt
    const session = await window.openworking.runtime.createSession({ title })
    state.activeSessionId = session.id
    state.sessionsByProject[project.id] ||= []
    state.sessionsByProject[project.id].unshift(session)
    // Discard the unsaved "new session" draft thread and start a clean thread under
    // the real session id, so subsequent stream events route to it by sessionID.
    state.threads.delete(null)
    resetActiveThread(session.id)
  }
  const thread = activeThread()
  const optimisticId = addOptimisticUser(thread, prompt, attachments, {
    fileRefs: fileMentions,
    signatureText: command ? undefined : effectivePrompt
  })
  if (mode.id === "plan") {
    const afterMessageIndex = thread.messages.findIndex((message) => message.id === optimisticId)
    state.planProposal = {
      sessionId: state.activeSessionId,
      afterMessageIndex: afterMessageIndex === -1 ? thread.messages.length - 1 : afterMessageIndex
    }
    state.planAccepted = null
    state.planAutoOpened = null
  } else if (state.planProposal?.sessionId === state.activeSessionId) {
    state.planProposal = null
  }
  const sentAttachmentIds = new Set(attachments.map((attachment) => attachment.id))
  thread.status = { type: "busy" }
  state.promptDraft = ""
  if (!command && sentAttachmentIds.size) {
    state.pendingAttachments = state.pendingAttachments.filter((attachment) => !sentAttachmentIds.has(attachment.id))
  }
  if (!command) state.pendingFileMentions = state.pendingFileMentions.filter((fileMention) => !fileMentions.some((sent) => sent.token === fileMention.token))
  render({ threadScroll: "latest" })
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
        prompt: effectivePrompt,
        attachmentIds: attachments.map((attachment) => attachment.id),
        agent: mode.agent,
        model: model ? { providerID: model.providerID, modelID: model.modelID } : undefined
      })
    }
    render({ threadScroll: "latest" })
  } catch (error) {
    removeOptimisticUser(thread, optimisticId)
    if (state.planProposal?.sessionId === state.activeSessionId) state.planProposal = null
    thread.status = { type: "idle" }
    state.promptDraft = prompt
    if (!command && attachments.length) {
      const pendingIds = new Set(state.pendingAttachments.map((attachment) => attachment.id))
      state.pendingAttachments = [
        ...attachments.filter((attachment) => !pendingIds.has(attachment.id)),
        ...state.pendingAttachments
      ]
    }
    if (!command && fileMentions.length) {
      const pendingTokens = new Set(state.pendingFileMentions.map((fileMention) => fileMention.token))
      state.pendingFileMentions = [
        ...fileMentions.filter((fileMention) => !pendingTokens.has(fileMention.token)),
        ...state.pendingFileMentions
      ]
    }
    render({ threadScroll: "latest" })
    throw error
  }
}

function openRenameProjectModal(projectId, name) {
  state.projectRenameTarget = { projectId, name: name || "" }
  state.projectRenameDraft = name || ""
  state.projectRenameError = null
  state.projectRenaming = false
  state.projectRenameAutoFocus = true
  state.projectMenu = null
  render()
}

function closeRenameProjectModal() {
  state.projectRenameTarget = null
  state.projectRenameDraft = ""
  state.projectRenameError = null
  state.projectRenaming = false
  state.projectRenameAutoFocus = false
  render()
}

async function confirmRenameProject() {
  const target = state.projectRenameTarget
  if (!target?.projectId) {
    closeRenameProjectModal()
    return
  }
  const trimmedName = state.projectRenameDraft.trim()
  if (!trimmedName) {
    state.projectRenameError = "Project name is required."
    render()
    return
  }
  state.projectRenaming = true
  render()
  try {
    await window.openworking.projects.rename(target.projectId, trimmedName)
    state.projects = await window.openworking.projects.list()
    closeRenameProjectModal()
  } catch (error) {
    state.projectRenaming = false
    state.projectRenameError = error.message
    render()
  }
}

async function removeProject(projectId) {
  if (state.activeProjectId === projectId) await clearPendingAttachments()
  await window.openworking.projects.remove(projectId)
  state.projects = await window.openworking.projects.list()
  delete state.sessionsByProject[projectId]
  if (state.activeProjectId === projectId) {
    state.activeProjectId = state.projects[0]?.id || null
    resetFileTree(state.activeProjectId)
    state.activeSessionId = null
    state.threads.clear()
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
  for (const server of Object.values(config?.mcp || {})) {
    if (server?.oauth && typeof server.oauth === "object" && server.oauth.clientSecret) {
      server.oauth.clientSecret = "[redacted]"
    }
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

async function openSkillPreview(name, builtIn) {
  state.skillPreview = { name, builtIn: !!builtIn }
  state.skillPreviewContent = null
  state.skillPreviewError = null
  state.skillPreviewLoading = true
  render()
  try {
    const result = await window.openworking.skills.read(name)
    state.skillPreviewContent = result?.content || ""
  } catch (error) {
    state.skillPreviewError = error.message
  } finally {
    state.skillPreviewLoading = false
    render()
  }
}

async function uninstallSkill(name) {
  if (state.skillUninstalling || !name) return
  state.skillUninstalling = true
  render()
  try {
    const result = await window.openworking.skills.uninstall(name)
    state.customSkills = result?.customSkills || state.customSkills.filter((skill) => skill.name !== name)
    state.skillPreview = null
    state.skillPreviewContent = null
    state.skillPreviewError = null
    showToast(`Uninstalled ${name}`)
  } catch (error) {
    state.skillPreviewError = error.message
  } finally {
    state.skillUninstalling = false
    render()
  }
}

function newMcpDraft(overrides = {}) {
  return {
    name: "",
    type: "remote",
    url: "",
    command: "",
    headers: [],
    env: [],                    // [{key, value}] environment variables for local servers
    oauthMode: "auto",          // auto | custom | disabled
    oauthClientId: "",
    oauthClientSecret: "",
    oauthScope: "",
    oauthAdvancedOpen: false,
    hasStoredSecret: false,
    presetDocsUrl: "",
    ...overrides
  }
}

function openMcpModal() {
  state.mcpModalOpen = true
  state.mcpEditTarget = null
  state.mcpSaving = false
  state.mcpError = null
  state.mcpDraft = newMcpDraft()
  render()
}

function openMcpModalForPreset(presetId) {
  const preset = MCP_PRESETS.find((entry) => entry.id === presetId)
  if (!preset) return openMcpModal()
  state.mcpModalOpen = true
  state.mcpEditTarget = null
  state.mcpSaving = false
  state.mcpError = null
  state.mcpDraft = newMcpDraft({
    name: preset.id,
    type: preset.type === "local" ? "local" : "remote",
    url: preset.url || "",
    command: preset.command || "",
    env: Array.isArray(preset.env) ? preset.env.map((row) => ({ ...row })) : [],
    oauthMode: preset.needsClientApp ? "custom" : "auto",
    oauthAdvancedOpen: !!preset.needsClientApp,
    presetDocsUrl: preset.docsUrl || ""
  })
  render()
}

function openMcpModalForEdit(name) {
  const server = (state.mcpServers || []).find((entry) => entry.name === name)
  if (!server) return
  let oauthMode = "auto"
  let oauthClientId = ""
  let oauthScope = ""
  let hasStoredSecret = false
  if (server.oauth === false) {
    oauthMode = "disabled"
  } else if (server.oauth && typeof server.oauth === "object") {
    oauthMode = "custom"
    oauthClientId = server.oauth.clientId || ""
    oauthScope = server.oauth.scope || ""
    hasStoredSecret = !!server.oauth.hasClientSecret
  }
  state.mcpModalOpen = true
  state.mcpEditTarget = name
  state.mcpSaving = false
  state.mcpError = null
  state.mcpDraft = newMcpDraft({
    name: server.name,
    type: server.type,
    url: server.url || "",
    command: Array.isArray(server.command) ? server.command.join(" ") : "",
    headers: Object.entries(server.headers || {}).map(([key, value]) => ({ key, value })),
    env: Object.entries(server.environment || {}).map(([key, value]) => ({ key, value })),
    oauthMode,
    oauthClientId,
    oauthScope,
    oauthAdvancedOpen: oauthMode === "custom",
    hasStoredSecret
  })
  render()
}

function closeMcpModal() {
  if (state.mcpSaving) return
  state.mcpModalOpen = false
  state.mcpEditTarget = null
  state.mcpDraft = null
  state.mcpError = null
  render()
}

// Translate the modal draft into the payload buildMcpServer/updateMcpServer expects.
function serializeMcpDraft(draft) {
  if (draft.type === "local") {
    const environment = {}
    for (const row of draft.env || []) {
      const key = String(row.key || "").trim()
      if (key) environment[key] = String(row.value ?? "")
    }
    const payload = { name: draft.name.trim(), type: "local", command: draft.command }
    if (Object.keys(environment).length) payload.environment = environment
    return payload
  }
  const headers = {}
  for (const row of draft.headers || []) {
    const key = String(row.key || "").trim()
    if (key) headers[key] = String(row.value ?? "")
  }
  let oauth
  if (draft.oauthMode === "disabled") {
    oauth = false
  } else if (draft.oauthMode === "custom") {
    // Omit a blank secret on edit so updateMcpServer preserves the stored one.
    oauth = { clientId: draft.oauthClientId, scope: draft.oauthScope }
    if (String(draft.oauthClientSecret || "").trim()) oauth.clientSecret = draft.oauthClientSecret
  } else {
    oauth = true // auto-negotiate → buildMcpServer omits the key
  }
  return {
    name: draft.name.trim(),
    type: "remote",
    url: draft.url,
    oauth,
    headers
  }
}

async function submitMcpServer() {
  const draft = state.mcpDraft
  if (state.mcpSaving || !draft) return
  if (!draft.name.trim()) {
    state.mcpError = "App name is required."
    render()
    return
  }
  if (draft.type === "remote" && !draft.url.trim()) {
    state.mcpError = "Server URL is required."
    render()
    return
  }
  if (draft.type === "local" && !draft.command.trim()) {
    state.mcpError = "Command is required."
    render()
    return
  }
  if (draft.type === "remote" && draft.oauthMode === "custom" && !String(draft.oauthClientId || "").trim()) {
    state.mcpError = "OAuth client ID is required for a pre-registered OAuth app."
    render()
    return
  }
  const editing = !!state.mcpEditTarget
  state.mcpSaving = true
  state.mcpError = null
  render()
  try {
    const payload = serializeMcpDraft(draft)
    const result = editing
      ? await window.openworking.mcp.update(state.mcpEditTarget, payload)
      : await window.openworking.mcp.add(payload)
    state.mcpServers = result?.servers || state.mcpServers
    state.mcpModalOpen = false
    state.mcpEditTarget = null
    state.mcpDraft = null
    showToast(`${editing ? "Updated" : "Added"} ${draft.name.trim()}`)
    // A freshly added/edited OAuth server reports needs_auth once the runtime reconnects.
    refreshMcpStatus()
  } catch (error) {
    state.mcpError = error.message
  } finally {
    state.mcpSaving = false
    render()
  }
}

async function authenticateMcp(name, { clear = false } = {}) {
  const serverName = String(name || "")
  if (!serverName || state.mcpAuthenticating?.[serverName]) return
  state.mcpAuthenticating = { ...state.mcpAuthenticating, [serverName]: true }
  state.mcpError = null
  state.mcpErrorTarget = null
  render()
  try {
    const result = clear
      ? await window.openworking.mcp.clearAuth(serverName)
      : await window.openworking.mcp.authenticate(serverName)
    if (result?.error) {
      state.mcpError = result.error
      state.mcpErrorTarget = serverName
    } else {
      if (result.servers) state.mcpServers = result.servers
      applyMcpStatusList(result.status)
      if (state.mcpStatus[serverName] === "connected") showToast(`Connected ${serverName}`)
    }
  } catch (error) {
    state.mcpError = error.message
  } finally {
    state.mcpAuthenticating = { ...state.mcpAuthenticating, [serverName]: false }
    render()
  }
}

async function toggleMcpEnabled(name, enabled) {
  try {
    const result = await window.openworking.mcp.setEnabled(name, enabled)
    state.mcpServers = result?.servers || state.mcpServers
    render()
  } catch (error) {
    showToast(error.message)
  }
}

async function confirmRemoveMcp() {
  const target = state.mcpDeleteTarget
  if (!target?.name || state.mcpRemoving) return
  state.mcpRemoving = true
  render()
  try {
    const result = await window.openworking.mcp.remove(target.name)
    state.mcpServers = result?.servers || state.mcpServers.filter((server) => server.name !== target.name)
    state.mcpDeleteTarget = null
    showToast(`Removed ${target.name}`)
  } catch (error) {
    showToast(error.message)
  } finally {
    state.mcpRemoving = false
    render()
  }
}

async function reloadConfig() {
  const configResult = await window.openworking.config.get()
  state.configPath = configResult.path
  state.config = configResult.config
  state.customSkills = configResult.customSkills || []
  state.mcpServers = configResult.mcp || []
  state.providerId = Object.keys(state.config.provider || {})[0] || "gateway"
  selectedModel()
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    applyPendingFileMentions,
    chooseSessionAfterRuntimeReconnect,
    collectLiveFileMentions,
    computePromptAttachments,
    escapeRegex,
    fileMentionTokenForPath,
    fileMentionTokenPattern,
    filterPromptAttachments,
    livePendingFileMentions,
    renderPromptOverlayHtml,
    renderTextWithFileMentions,
    resolveFileMentionsFromPrompt
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".composer")) {
      if (state.commandMenu.open) closeCommandMenu()
      if (state.fileMentionMenu.open) closeFileMentionMenu()
    }
    let dirty = false
    if (state.sessionMenu && !event.target.closest(".session-row-wrap")) {
      state.sessionMenu = null
      dirty = true
    }
    if (state.projectMenu && !event.target.closest(".proj-head-wrap")) {
      state.projectMenu = null
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
}
