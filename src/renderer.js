const SUPERPOWERS_PLUGIN = "superpowers@git+https://github.com/obra/superpowers.git"
const ALLOWED_MODEL_MODALITIES = ["text", "audio", "image", "video", "pdf"]
const REASONING_OPTIONS = [
  { id: "none", label: "None", shortLabel: "None", title: "None - let the model decide its own reasoning effort (nothing is forced)" },
  { id: "medium", label: "Medium", shortLabel: "Medium", title: "Medium reasoning effort" },
  { id: "high", label: "High", shortLabel: "High", title: "High reasoning effort" },
  { id: "xhigh", label: "Extra High", shortLabel: "Extra High", title: "Extra High reasoning effort" }
]
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
  { name: "webapp-testing", description: "Test local web applications with focused browser automation." },
  { name: "cross-chat-memory", description: "Remember durable facts, preferences and decisions so they carry across separate chats." },
  { name: "browser-use", description: "Drive the user's logged-in Chrome through the browser_* tools." },
  { name: "backlog", description: "Query Backlog issues, projects and PRs via the backlog_* tools with the correct argument shapes." }
]

const TOKEN_KINDS = {
  "skill": "sparkle",
  "file": "doc",
  "command": "bolt",
}

// Context-free rendering helpers live in src/renderer/util.js, loaded as an ordered <script> before
// this file (window.OpenWorkingRendererUtil). Destructured here so existing call sites and the
// module.exports surface stay unchanged.
const { icons, escapeHtml, escapeRegex, icon, resizeTipAttrs, relativeTime, filename, fileExtension } =
  (typeof window === "object" && window.OpenWorkingRendererUtil) || require("./renderer/util")

// Overlay scrollbar for the sidebar; see src/renderer/side-scrollbar.js for why the native bar
// can't be used. Attached from bindEvents() after each render (the call is idempotent).
const sideScrollbar =
  (typeof window === "object" && window.OpenWorkingSideScrollbar) || require("./renderer/side-scrollbar")

const modes = [
  { id: "agent", agent: "build", label: "Agent", icon: "agent", sub: "Reads & edits files in the project" },
  { id: "plan", agent: "plan", label: "Plan", icon: "ask", sub: "Reads only - proposes a plan first" }
]

const chips = [
  { icon: "doc", text: "Dịch file sang tiếng Việt, giữ nguyên cấu trúc và định dạng." },
  { icon: "book", text: "/code-review Review branch hiện tại so với develop" },
  { icon: "bolt", text: "Hãy list cho tôi các task cần phải làm trên backlog của dự án" },
  { icon: "doc", text: "/explain-project Hãy giải thích dự án này cho tôi." }
]

// The first-run guided tour (ONBOARDING_STEPS + render/position/behavior) now lives in
// src/renderer/onboarding.js (destructured near the state block below).

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
    // Backlog is a local stdio MCP server, not a remote URL. The command shown here is the package
    // reference; the main process installs it on-demand into the app profile and rewrites the
    // command to `node <entry>` so it never runs through npx (which a project's devEngines can
    // break). It requires BACKLOG_DOMAIN + BACKLOG_API_KEY — pre-filled blank for the user.
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
  admitPendingInput,
  addOptimisticUser,
  applyThreadEvent,
  clearPendingForm,
  clearPendingPermission,
  clearPendingQuestion,
  createThreadStream,
  hasRunningTool,
  hydrateThread,
  markInputDeliveryUnknown,
  messageCopyText,
  needsThreadRehydration,
  userMessageFileRefs,
  messageText,
  removeOptimisticUser,
  resetThread,
  threadIsBusy
} = window.OpenWorkingThreadStream

const { parseUnifiedDiff } = window.OpenWorkingDiffView

// Permission-failure hint text, shared with the main process so the runtime launch error and a
// failed file-edit tool row give the same actionable sentence. See src/error-hints.js.
const { filePermissionHint: filePermissionHintText } =
  (typeof window === "object" && window.OpenWorkingErrorHints) || require("./error-hints")

// Markdown / mermaid / syntax-highlight / diff rendering lives in src/renderer/markup.js. It takes
// its util + diff-view helpers via init() so it does not re-read them from globals. The require()
// fallback is for the node:test harness, which does not stub window.OpenWorkingMarkup.
const markup = (typeof window === "object" && window.OpenWorkingMarkup) || require("./renderer/markup")
markup.init({ escapeHtml, filename, fileExtension, parseUnifiedDiff })
const {
  renderMarkdown,
  ensureMermaid,
  markMermaidError,
  renderMermaidDiagrams,
  scheduleMermaidRender,
  diffStats,
  highlightCode,
  renderUnifiedDiff,
  stripSkillFrontmatter
} = markup

const state = {
  nav: "session",
  profile: null,
  profileRetrying: false,
  projects: [],
  activeProjectId: null,
  activeSessionId: null,
  sessionsByProject: {},
  sessionLoadsByProject: {},       // projectId -> { status, generation, error, autoRetried }
  sessionLoadSeq: 0,
  messageLoadsBySession: {},       // `${projectId}:${sessionId}` -> { status, generation, error, projectId }
  messageLoadSeq: 0,
  subagentRunTreesByRoot: new Map(),
  subagentSessionIds: new Set(),
  subagentRunLoadSeq: 0,
  subagentRunEpoch: 0,
  // One live thread per session, keyed by sessionId. Background sessions keep their
  // thread (and its streaming state) alive while another session is on screen, so a
  // long task in session A is not lost when the user switches to / creates session B.
  // The `null` key holds the "new session" draft thread before the session exists.
  threads: new Map(),
  // Fork marker per forked session. Value is the last cloned message id; null means show the
  // marker before any continuation if OpenCode returns an empty fork.
  forkMarkers: new Map(),
  // Pinned chat sessions, keyed by sessionId → { projectId, title, updatedAt }. Pinning
  // is an app-side preference (sessions are owned by OpenCode core), persisted via the
  // pins:* IPC with cached metadata so the flat, cross-project Pinned section renders
  // even for sessions whose project runtime is not currently running.
  pinnedSessions: new Map(),
  document: null,
  expanded: new Set(),
  showAll: new Set(),
  runtime: null,
  configPath: "",
  // Git branch/worktree info cached PER PROJECT id, so the composer's git control can only ever
  // render the project it is actually drawing (renderGitControl(project) looks up by that project's
  // id) — it is structurally impossible to show another project's branch/worktree. Populated lazily
  // on render and force-refreshed after our own checkout/worktree-switch mutations.
  gitInfoByProject: new Map(),     // projectId -> {isGitRepo, currentBranch, branches, worktrees}
  gitInfoLoading: new Set(),       // projectIds with a git:info request in flight (dedupe + no render loop)
  config: null,
  customSkills: [],
  managedPlugins: [],
  mcpServers: [],
  browserStatus: null,             // { chromeInstalled, hostInstalled, extensionId, … } from browser:status
  browserBusy: false,              // true while installing the native host
  browserError: null,              // last browser-bridge action error
  browserSetupOpen: false,         // instructional extension-install popup visibility
  mcpStatus: {},                   // name -> "connected" | "needs_auth" | "failed" | "disabled"
  mcpStatusError: {},              // name -> opencode's real failure reason (from GET /mcp), if any
  mcpAuthenticating: {},           // name -> true while an auth flow is in progress
  skillsTab: "skills",             // skills | plugins | mcp | memory | references (mcp is Extensions)
  projectsQuery: "",               // reactive search text on the Svelte Projects screen
  skillsQuery: "",                 // live search text on the Skills tab (DOM-filtered, no re-render)
  skillsFilter: "all",             // all | installed | builtin — which skill group(s) to show
  newSessionProjectQuery: "",      // live search text in the New session composer project popover
  memory: null,                    // { global, project, projectId, hasProject } once loaded
  selectedMemoryProjectId: null,   // project targeted by the Memory tab selector; must not change activeProjectId
  memoryLoadSeq: 0,                // latest in-flight Memory-tab load; older responses are ignored
  memoryDraft: null,               // { global, project } edited text, mirrors `memory` while editing
  memoryLoading: false,
  memorySaving: null,              // "global" | "project" while a save is in flight
  memoryError: null,
  mcpModalOpen: false,
  mcpSaving: false,
  mcpError: null,
  permissionsModalOpen: false,
  permissionsList: [],
  permissionsLoading: false,
  permissionsError: null,
  permissionsRemoving: null,     // id currently being revoked, or null
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
  modelRefBySession: new Map(),
  agentBySession: new Map(),
  newSessionModelRef: null,
  modelSelectionBusy: false,
  revertConfirmTarget: null,
  revertSubmitting: false,
  revertError: null,
  revertDraftBySession: new Map(),
  planAutoOpened: null,
  planAccepted: null,
  planProposal: null,
  planCardExpanded: false,         // whether the inline Plan card body is expanded (collapsed by default)
  agentProgressExpanded: new Set(), // completed assistant message ids expanded by the user
  expandedToolErrors: new Set(),   // tool part ids whose failure details are expanded; keyed by part id so it survives streaming repaints
  selectedModelKey: "",
  promptDraft: "",
  promptComposing: false,
  composerPlaceholder: "",
  firstSendInFlight: false,
  promptSubmitInFlight: false,
  unknownInputSubmissions: new Map(),
  pendingAttachments: [],
  pendingFileMentions: [],
  commands: [],
  references: [],
  referencesLoading: false,
  referencesError: null,
  referenceFormOpen: false,        // whether the inline add-reference form is expanded
  // Add-reference form draft: { kind: "path"|"git", name, path, repository, branch, description }.
  // Not state-bridged (submitted over IPC, mirrors mcpDraft) — text inputs mutate it directly
  // without a repaint so the caret stays put.
  referenceDraft: null,
  referenceSaving: false,
  referenceRemoving: null,         // name of the reference currently being removed
  commandMenu: { open: false, query: "", index: 0 },
  fileMentionMenu: { open: false, query: "", index: 0, files: [], loading: false, error: "", projectId: null, loadPromise: null },
  promptAssistKeyboardActive: false,
  popover: null,
  sessionMenu: null,          // row key `${projectId}:${sessionId}` đang mở menu, hoặc null
  sessionDeleteTarget: null,  // { sessionId, projectId, title } của session chờ xác nhận xóa trong modal
  sessionDeleting: false,
  sessionDeleteError: null,
  sessionRenameTarget: null,  // { sessionId, projectId, title, label } của session đang đổi tên
  sessionRenameDraft: "",
  sessionRenameError: null,
  sessionRenaming: false,
  sessionRenameAutoFocus: false,
  sessionRenameFocusId: null,
  projectMenu: null,          // projectId đang mở menu "...", hoặc null
  ideMenu: null,               // projectId whose "choose IDE" split-button dropdown is open, or null
  projectRenameTarget: null,  // { projectId, name } của project đang đổi tên
  projectRenameDraft: "",
  projectRenameError: null,
  projectRenaming: false,
  projectRenameAutoFocus: false,
  projectDeleteTarget: null,  // { id, name } của project chờ xác nhận gỡ trong modal
  projectRemoving: false,
  projectDeleteError: null,
  sidebarCollapsed: false,
  rightSidebarOpen: false,
  rightSidebarPreopen: false,
  rightSidebarClosing: false,
  rightSidebarTab: "files",   // "files" | "changes" — tab đang chọn trong right sidebar
  // Terminal: an independent bottom dock below the chat (toggled from the header button next to
  // the IDE split button), not a right-sidebar tab — see renderTerminalDock() / #terminalDockRoot.
  terminalPanelOpen: false,    // whether the bottom terminal dock is visible
  terminalConfirmOpen: false,  // showing the "Open a terminal?" confirm modal
  // Terminals are remembered PER PROJECT: switching away detaches the socket but leaves the shell
  // running on the runtime, so coming back reattaches it (cwd, env and any running job survive)
  // instead of stranding it. terminalProjectId/terminalPtyId stay the single "currently attached"
  // slot, which is what terminalBridge, the pty.data filter and write/resize are all built around.
  terminalPtyByProject: new Map(), // projectId -> ptyId, incl. detached-but-alive shells
  terminalProjectId: null,     // project the attached terminalPtyId belongs to
  terminalPtyId: null,         // the ATTACHED pty's id, or null when nothing is attached
  terminalStatus: "idle",      // idle | creating | connecting | connected | lost | exited
  terminalError: null,
  vcsProjectId: null,         // project mà vcsFiles đang mô tả, để bỏ kết quả về trễ khi đổi project
  vcsFiles: [],               // [{ file, status, additions, deletions }]
  vcsLoading: false,
  vcsError: "",
  vcsTruncated: false,
  documentPreopen: false,
  documentClosing: false,
  panelResizing: false,
  fileTreeProjectId: null,
  fileTreeLoading: new Set(),
  fileTreeError: "",
  fileTreeExpanded: new Set(),
  fileTreeChildren: new Map(),
  fileTreeContextMenu: null,
  fileSearchQuery: "",
  fileSearchResults: [],
  fileSearchLoading: false,
  fileSearchError: "",
  stackedRightPanels: false,  // Files+Code layout: false = side-by-side (default), true = stacked (Files on top)
  diagnosticsOpen: false,
  toast: null,
  loading: false,
  onboarding: null,                // null = tour not running; { step } while the first-run tour is active
  versionGate: null,
  updating: false,
  downloadProgress: null,
  installStatus: null,
  skillUploadOpen: false,
  skillUploading: false,
  skillUploadError: null,
  settingsSection: "provider",     // provider | account | advanced
  themeMode: "system",             // system | light | dark (Appearance toggle; hydrated at boot)
  skillPreview: null,              // { name, builtIn } của skill đang xem, hoặc null
  skillPreviewContent: null,
  skillPreviewLoading: false,
  skillPreviewError: null,
  skillUninstalling: false,
  // Per-question multi-select draft state, keyed by `${sessionId}:${requestID}:${questionIndex}`:
  // { selected: Set<value>, other: string }
  questionDrafts: new Map(),
  // Per-form answer objects, keyed by `${sessionId}:${formID}`.
  formDrafts: new Map()
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
const STACKED_RIGHT_MODE_KEY = "openworking:stacked-right-panels"
const STACKED_RIGHT_WIDTH_KEY = "openworking:stacked-right-w"
const STACKED_RIGHT_MIN_WIDTH = 300
const STACKED_RIGHT_MAX_WIDTH = 900
const STACKED_TOP_HEIGHT_KEY = "openworking:stacked-top-h"
const STACKED_TOP_MIN_HEIGHT = 120
const STACKED_TOP_MAX_HEIGHT = 600
const TERMINAL_DOCK_HEIGHT_KEY = "openworking:terminal-dock-h"
const TERMINAL_DOCK_MIN_HEIGHT = 190
const TERMINAL_DOCK_MAX_HEIGHT = 340
// Height of .terminal-dock-resizer, which sits between the chat and the dock and is not part of
// either — see the gutter it occupies in styles.css.
const TERMINAL_DOCK_GUTTER = 7
// Floor the chat keeps when the terminal dock shares .main with it. The dock is the only child of
// .main that does not shrink, so without this budget it would eat the thread and then the composer
// (and, once .main overflows, get clipped mid-row itself) on a short window. Sized to keep the
// composer plus a couple of message lines usable — the vertical analogue of CHAT_MIN_WIDTH.
const CHAT_MIN_HEIGHT = 220
// Minimum the chat column must keep when the document preview shares the row, so
// the side-by-side grid can never be squeezed into a single stacked column.
const CHAT_MIN_WIDTH = 360
const NARROW_VIEWPORT_WIDTH = 820
// Resizer gutters in the grid (sidebar↔chat is absolute, so only chat↔doc and
// doc↔right-file count here).
const GRID_GUTTER = 7
const EXPANDED_KEY = "openworking:expanded-projects"
const THEME_KEY = "openworking:theme"
// The three user-selectable appearance modes. "system" follows the OS light/dark
// setting live; the others force a fixed palette. Order matches the Appearance toggle.
const THEME_MODES = ["system", "light", "dark"]
const DEFAULT_IDE_KEY = "openworking:defaultIde"

const renderCounters = {
  full: 0,
  sidebar: 0,
  thread: 0,
  document: 0,
  skillsPanel: 0,
  mark(kind) {
    if (!Object.prototype.hasOwnProperty.call(this, kind)) return
    this[kind] += 1
  },
  snapshot() {
    return {
      full: this.full,
      sidebar: this.sidebar,
      thread: this.thread,
      document: this.document,
      skillsPanel: this.skillsPanel
    }
  },
  reset() {
    this.full = 0
    this.sidebar = 0
    this.thread = 0
    this.document = 0
    this.skillsPanel = 0
  }
}

const projectSessionLoadPromises = new Map()
const sessionMessageLoadPromises = new Map()
const subagentRunLoadPromises = new Map()
const subagentRunLoadGenerations = new Map()

// Domain-logic modules live in src/renderer/*.js, with the same require()-fallback + init() pattern.
const promptMetadata = (typeof window === "object" && window.OpenWorkingPromptMetadata) || require("./renderer/prompt-metadata")
promptMetadata.init()
const {
  loadSelectedPromptMetadata,
  persistSelectedPromptMetadata,
  recordSelectedPromptMetadata,
  clearSelectedPromptMetadata,
  applyPersistedPromptMetadataToThread
} = promptMetadata

const attachmentCapabilities = (typeof window === "object" && window.OpenWorkingAttachmentCapabilities) || require("./renderer/attachment-capabilities")
attachmentCapabilities.init()
const { unsupportedAttachments } = attachmentCapabilities

const memoryProject = (typeof window === "object" && window.OpenWorkingMemoryProject) || require("./renderer/memory-project")
memoryProject.init({ state })
const {
  selectedProject,
  projectAllPaths,
  memoryProjectById,
  normalizeMemoryProjectId,
  effectiveMemoryProjectId,
  selectedMemoryProject,
  isMemoryScopeDirty,
  resetMemorySelectionToActiveProject
} = memoryProject

// First-run guided tour lives in src/renderer/onboarding.js. `render` is a hoisted declaration so it
// is safe to pass here. ONBOARDING_STEPS/LAST_STEP are re-exported from the module.
const onboarding = (typeof window === "object" && window.OpenWorkingOnboarding) || require("./renderer/onboarding")
onboarding.init({ state, render, icon, escapeHtml, REASONING_OPTIONS })
const {
  ONBOARDING_STEPS,
  ONBOARDING_LAST_STEP,
  hasSeenOnboarding,
  markOnboardingSeen,
  prepareOnboardingStep,
  startOnboarding,
  advanceOnboarding,
  finishOnboarding,
  skipOnboarding,
  renderOnboarding,
  renderOnboardingDemo,
  positionOnboarding
} = onboarding

// Svelte islands (src/renderer/svelte/, bundled to src/renderer/dist/svelte-islands.js) are the
// only render path: index.html loads the bundle before this file, and the node:test harness
// evaluates it into its jsdom window before requiring this module. A missing bundle is a build
// error — fail loudly instead of white-screening.
const svelteIslands = (typeof window === "object" && window.OpenWorkingSvelteIslands) || null
if (!svelteIslands) {
  const bundleMessage = "OpenWorking renderer bundle missing — run `npm run build:renderer` (every npm dev/test/pack script does this automatically)."
  if (typeof document !== "undefined") {
    const fatalRoot = document.getElementById("root")
    if (fatalRoot) fatalRoot.innerHTML = `<pre class="fatal">${bundleMessage}</pre>`
  }
  throw new Error(bundleMessage)
}

// Island-side event dispatch: Svelte components own their DOM events (the delegated #root
// dispatcher skips [data-svelte-island] subtrees) but reuse the exact same handler tables
// (DELEGATED_CLICK/INPUT/MOUSEDOWN + rename keydown), so behavior stays identical and no
// handler logic is duplicated. The [data-stop-click] boundary rule mirrors dispatchDelegated.
function dispatchIslandEvent(table, attribute, event) {
  const element = event.currentTarget
  const stopBoundary = event.target.closest?.("[data-stop-click]") || null
  if (stopBoundary && element !== stopBoundary && element.contains?.(stopBoundary)) return
  for (const [attr, handler] of table) {
    if (attr !== attribute) continue
    const { shim } = delegationShim(event, element)
    handler(shim)
    return
  }
}

const islandActions = {
  click: (attribute, event) => dispatchIslandEvent(DELEGATED_CLICK, attribute, event),
  input: (attribute, event) => dispatchIslandEvent(DELEGATED_INPUT, attribute, event),
  mousedown: (attribute, event) => dispatchIslandEvent(DELEGATED_MOUSEDOWN, attribute, event),
  renameKeydown: (event) => handleRenameKeydown(event, event.currentTarget),
  // Full-table delegation for islands whose inner markup still comes from the string renderers
  // (thread, main screen, app shell): the island attaches host listeners that walk the same
  // ordered tables, so every data-* interaction behaves identically. Islands nest (thread inside
  // main inside shell), so two rules keep a single click from dispatching twice:
  //  1. nearest-island guard — a host only dispatches when the event's nearest island root is
  //     the host itself (the inner island owns its own events);
  //  2. per-event handled flag — the deepest island dispatches first (bubbling order) and marks
  //     the event. This covers the case where the handler re-renders synchronously and detaches
  //     event.target: closest() then walks a detached tree, finds no island root, and rule 1
  //     alone would let every ancestor island dispatch the same click again (toggle handlers
  //     would cancel themselves — the header IDE menu / right-sidebar bug).
  delegate: (event, kind, host) => {
    if (event.openworkingIslandDelegated) return
    if (host) {
      const nearest = event.target.closest?.("[data-svelte-island]")
      if (nearest && nearest !== host) return
    }
    event.openworkingIslandDelegated = true
    const table = kind === "input" ? DELEGATED_INPUT : kind === "mousedown" ? DELEGATED_MOUSEDOWN : DELEGATED_CLICK
    dispatchDelegatedTable(event, table)
  }
}

// Reactive state bridge (phase 2): UI-local fields move into a $state backing store so Svelte
// islands track them fine-grained; legacy code keeps reading/writing state.xxx through the
// installed getters/setters, and Set/Map fields stay reactive across in-place mutation AND
// reassignment (wrapped as SvelteSet/SvelteMap). Fields that cross IPC/structured-clone
// boundaries (auth, config, projects, sessionsByProject, pinnedSessions, mcpDraft, catalog,
// customSkills, mcpServers) are intentionally NOT bridged — islands see those through the
// paint→tick fallback instead, and $state proxies never leave the renderer.
svelteIslands.bindStateBridge(state, [
    "nav", "sidebarCollapsed", "expanded", "showAll", "sessionMenu", "projectMenu", "projectsQuery",
    "skillsTab", "skillsQuery", "skillsFilter", "updating", "installStatus",
    "downloadProgress", "versionGate", "skillUploadOpen", "skillUploading", "skillUploadError",
    "skillPreview", "skillPreviewContent", "skillPreviewLoading", "skillPreviewError", "skillUninstalling",
    "browserStatus", "browserBusy", "browserError", "browserSetupOpen", "browserRelease",
    "browserReleaseLoading", "browserDownloading", "mcpStatus", "mcpStatusError", "mcpAuthenticating", "mcpErrorTarget",
    "selectedMemoryProjectId", "memory", "memoryDraft", "memoryLoading", "memorySaving", "memoryError",
    "referencesLoading", "referencesError", "referenceFormOpen", "referenceSaving", "referenceRemoving",
    "sessionDeleteTarget", "sessionDeleting", "sessionDeleteError",
    "sessionRenameTarget", "sessionRenameDraft", "sessionRenameError", "sessionRenaming",
    "sessionRenameAutoFocus", "sessionRenameFocusId",
    "revertConfirmTarget", "revertSubmitting", "revertError",
    "projectDeleteTarget", "projectRemoving", "projectDeleteError",
    "projectRenameTarget", "projectRenameDraft", "projectRenameError", "projectRenaming", "projectRenameAutoFocus",
    "mcpModalOpen", "mcpSaving", "mcpError", "mcpEditTarget", "mcpDeleteTarget", "mcpRemoving",
    "permissionsModalOpen", "permissionsList", "permissionsLoading", "permissionsError", "permissionsRemoving",
    "document", "rightSidebarOpen", "rightSidebarPreopen", "rightSidebarClosing",
    "documentPreopen", "documentClosing", "panelResizing",
    "fileTreeChildren", "fileTreeExpanded", "fileTreeLoading", "fileTreeError", "fileTreeProjectId",
    "fileTreeContextMenu", "stackedRightPanels",
    "fileSearchQuery", "fileSearchResults", "fileSearchLoading", "fileSearchError",
    "rightSidebarTab", "vcsFiles", "vcsLoading", "vcsError", "vcsTruncated", "vcsProjectId",
    "terminalPanelOpen", "terminalConfirmOpen", "terminalProjectId", "terminalPtyId", "terminalStatus", "terminalError"
])

const sidebarIsland = svelteIslands.sidebarIsland
sidebarIsland.init({
  captureSidebarScroll,
  restoreSidebarScroll,
  renderDiagnostics: renderCounters,
  state,
  icon,
  relativeTime,
  selectedProject,
  hasPinnedItems,
  projectSessions,
  projectSessionLoad,
  sessionBusy,
  sessionDisplayTitle,
  sessionUpdatedAt,
  sessionRowKey,
  updateButtonLabel,
  actions: islandActions
})

const screenSessionIsland = svelteIslands.screenSessionIsland
// The island renders the thread as keyed segments (threadRowSegments) and delegates host events
// through the shared handler tables via actions.
screenSessionIsland.init({
  captureThreadScroll,
  restoreThreadScroll,
  scheduleMermaidRender,
  renderDiagnostics: renderCounters,
  threadRowSegments,
  subagentRunTree,
  actions: islandActions
})

const documentViewerIsland = svelteIslands.documentViewerIsland
// The island renders the viewer from state.document via the markup helpers.
documentViewerIsland.init({
  state,
  scheduleMermaidRender,
  renderDiagnostics: renderCounters,
  actions: islandActions,
  icon,
  filename,
  fileExtension,
  renderMarkdown,
  highlightCode,
  renderUnifiedDiff,
  isViewableFilePath,
  isMarkdownFilePath,
  artifactTypeLabel,
  insertFileMentionAtCaret,
  selectionLineRange,
  buildMatchRanges,
  switchMarkdownView
})

const modalsIsland = svelteIslands.modalsIsland
modalsIsland.init({
  state,
  actions: islandActions,
  icon,
  skillIcon,
  selectedProject,
  sessionDisplayTitle,
  updateButtonLabel,
  mcpPresets: MCP_PRESETS,
  renderMarkdown,
  stripSkillFrontmatter,
  scheduleMermaidRender,
  renderDiagnostics: renderCounters
})

// Plain object shared by reference with the mounted TerminalPanel island (same trick `state`
// itself relies on) — lets renderer.js write incoming pty.data chunks straight into the live
// xterm.js buffer without routing every chunk through a full Svelte re-render/tick, which would
// be wasteful for a fast-streaming terminal and could disrupt scroll position/focus.
const terminalBridge = { write: null }

const rightFileSidebarIsland = svelteIslands.rightFileSidebarIsland
rightFileSidebarIsland.init({
  state,
  actions: islandActions,
  icon,
  selectedProject,
  renderDiagnostics: renderCounters,
  insertFileMentionAtCaret,
  toggleStackedRightPanels,
  searchProjectFiles
})

// Terminal now lives in its own dock below the chat (see renderTerminalDock/#terminalDockRoot),
// not as a right-sidebar tab — a separate island, own ctx.
const terminalDockIsland = svelteIslands.terminalDockIsland
terminalDockIsland.init({
  state,
  actions: islandActions,
  icon,
  selectedProject,
  renderDiagnostics: renderCounters,
  terminalBridge,
  writeToTerminal,
  resizeTerminal,
  terminalBelongsToActiveProject
})

// Main screen area + app shell: renderMain()/the shell strings stay the markup source, rendered
// through {@html} in the islands; hosts under the shell persist across full renders, so all
// islands above tick instead of remounting.
const mainIsland = svelteIslands.mainIsland
mainIsland.init({
  state,
  actions: islandActions,
  renderMain,
  icon,
  relativeTime,
  projectInitials,
  projectHue,
  sortProjectsByPin,
  renderDiagnostics: renderCounters
})

const promptEditorIsland = svelteIslands.promptEditorIsland
promptEditorIsland.init({
  state,
  renderPromptTokensHtml,
  parsePromptTokens,
  syncPendingFileMentions,
  threadAbortable,
  syncPromptAssist,
  commandCandidates,
  paintCommandMenu,
  selectCommand,
  closeCommandMenu,
  fileMentionCandidates,
  paintPromptAssistMenu,
  selectFileMention,
  closeFileMentionMenu,
  showToast,
  sendPrompt,
  renderDiagnostics: renderCounters
})

const promptAssistMenuIsland = svelteIslands.promptAssistMenuIsland
promptAssistMenuIsland.init({
  state,
  commandCandidates,
  fileMentionCandidates,
  filename,
  selectCommand,
  selectFileMention,
  showToast,
  paintPromptAssistMenu,
  renderDiagnostics: renderCounters
})

const attachmentChipsIsland = svelteIslands.attachmentChipsIsland
attachmentChipsIsland.init({
  state,
  icon,
  removeAttachment,
  renderDiagnostics: renderCounters
})

const appShellIsland = svelteIslands.appShellIsland
appShellIsland.init({
  state,
  actions: islandActions,
  renderProfileRecovery,
  renderProfileRecoveryBanner,
  renderOnboarding,
  renderDiagnostics: renderCounters
})

const screenSkillsIsland = svelteIslands.screenSkillsIsland
screenSkillsIsland.init({
  state,
  filterSkillsDom,
  renderDiagnostics: renderCounters,
  icon,
  skillIcon,
  mcpStatusInfo,
  mcpServerSubtitle,
  selectedMemoryProject,
  isMemoryScopeDirty,
  builtInSkills: BUILT_IN_SKILLS,
  actions: islandActions
})

function setSidebarWidth(width) {
  const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)))
  document.documentElement.style.setProperty("--sidebar-w", `${clamped}px`)
  return clamped
}

// Largest the Files panel may be without forcing the chat column below its minimum. Mirrors
// maxDocumentViewerWidth() below: measured live, so the clamp tracks window size, sidebar
// collapse state, and whether the document viewer is open.
function maxRightFileSidebarWidth() {
  const app = document.querySelector(".app")
  const total = app ? app.getBoundingClientRect().width : window.innerWidth
  const sidebar = state.sidebarCollapsed ? null : document.querySelector(".sidebar")
  const sidebarW = sidebar ? sidebar.getBoundingClientRect().width : 0
  const documentViewer = state.document ? document.querySelector(".document-viewer") : null
  const documentW = documentViewer ? documentViewer.getBoundingClientRect().width + GRID_GUTTER : 0
  const budget = total - sidebarW - documentW - GRID_GUTTER - CHAT_MIN_WIDTH
  const cap = Math.max(RIGHT_FILE_MIN_WIDTH, Math.min(RIGHT_FILE_MAX_WIDTH, Math.round(budget)))
  return Number.isFinite(cap) ? cap : RIGHT_FILE_MAX_WIDTH
}

function setRightFileSidebarWidth(width) {
  const max = maxRightFileSidebarWidth()
  // Every input is guarded: one `NaNpx` track invalidates the whole grid-template-columns.
  const upper = Number.isFinite(max) ? max : RIGHT_FILE_MAX_WIDTH
  const requested = Number.isFinite(width) ? Math.round(width) : RIGHT_FILE_MIN_WIDTH
  const clamped = Math.max(RIGHT_FILE_MIN_WIDTH, Math.min(upper, requested))
  const safe = Number.isFinite(clamped) ? clamped : RIGHT_FILE_MIN_WIDTH
  document.documentElement.style.setProperty("--right-sidebar-w", `${safe}px`)
  return safe
}

let narrowSidebarActive = false
function syncSidebarForViewport(width = window.innerWidth) {
  const narrow = Number.isFinite(width) && width <= NARROW_VIEWPORT_WIDTH
  if (narrow && !narrowSidebarActive && !state.sidebarCollapsed) {
    state.sidebarCollapsed = true
    syncSidebarCollapsedDom(true)
  }
  narrowSidebarActive = narrow
  return narrow
}

// Largest the document preview may be without forcing the chat column below its
// minimum. Measures the live layout so the clamp tracks the current window size,
// sidebar collapse state, and whether the right-file sidebar is open.
function maxDocumentViewerWidth() {
  const app = document.querySelector(".app")
  const total = app ? app.getBoundingClientRect().width : window.innerWidth
  const sidebar = state.sidebarCollapsed ? null : document.querySelector(".sidebar")
  const sidebarW = sidebar ? sidebar.getBoundingClientRect().width : 0
  const rightSidebar = state.rightSidebarOpen ? document.querySelector(".right-file-sidebar") : null
  const rightW = rightSidebar ? rightSidebar.getBoundingClientRect().width + GRID_GUTTER : 0
  const budget = total - sidebarW - rightW - GRID_GUTTER - CHAT_MIN_WIDTH
  const cap = Math.max(DOCUMENT_MIN_WIDTH, Math.min(DOCUMENT_MAX_WIDTH, Math.round(budget)))
  return Number.isFinite(cap) ? cap : DOCUMENT_MAX_WIDTH
}

function setDocumentViewerWidth(width) {
  const max = maxDocumentViewerWidth()
  // Guard every input: a non-finite width or max would otherwise produce a
  // `NaNpx` track, which invalidates the whole grid-template-columns and
  // collapses the side-by-side panels into one stacked column.
  const upper = Number.isFinite(max) ? max : DOCUMENT_MAX_WIDTH
  const requested = Number.isFinite(width) ? Math.round(width) : DOCUMENT_MIN_WIDTH
  const clamped = Math.max(DOCUMENT_MIN_WIDTH, Math.min(upper, requested))
  const safe = Number.isFinite(clamped) ? clamped : DOCUMENT_MIN_WIDTH
  document.documentElement.style.setProperty("--document-w", `${safe}px`)
  return safe
}

// Stacked layout's shared column width, kept separate from --document-w/--right-sidebar-w
// so switching modes never mixes the two up.
function setStackedRightWidth(width) {
  const requested = Number.isFinite(width) ? Math.round(width) : STACKED_RIGHT_MIN_WIDTH
  const safe = Math.max(STACKED_RIGHT_MIN_WIDTH, Math.min(STACKED_RIGHT_MAX_WIDTH, requested))
  document.documentElement.style.setProperty("--stacked-right-w", `${safe}px`)
  return safe
}

// Stacked layout's Files/Code height split, stored as the Files (top) panel's height in px;
// Code (bottom) takes the remainder via minmax(0, 1fr).
function setStackedTopHeight(height) {
  const requested = Number.isFinite(height) ? Math.round(height) : STACKED_TOP_MIN_HEIGHT
  const safe = Math.max(STACKED_TOP_MIN_HEIGHT, Math.min(STACKED_TOP_MAX_HEIGHT, requested))
  document.documentElement.style.setProperty("--stacked-top-h", `${safe}px`)
  return safe
}

// Tallest the terminal dock may be without pushing the chat below CHAT_MIN_HEIGHT. Measures the
// live layout for the same reason maxDocumentViewerWidth does: the budget depends on the current
// window height and on the header, neither of which is a constant.
function maxTerminalDockHeight() {
  const main = document.querySelector(".main")
  const total = main ? main.getBoundingClientRect().height : window.innerHeight
  const head = main ? main.querySelector(".main-head") : null
  const headH = head ? head.getBoundingClientRect().height : 0
  const budget = total - headH - TERMINAL_DOCK_GUTTER - CHAT_MIN_HEIGHT
  const cap = Math.max(TERMINAL_DOCK_MIN_HEIGHT, Math.min(TERMINAL_DOCK_MAX_HEIGHT, Math.round(budget)))
  return Number.isFinite(cap) ? cap : TERMINAL_DOCK_MAX_HEIGHT
}

// Terminal dock height (below the chat, see renderTerminalDock). Anchored to the bottom of
// .main, so unlike setStackedTopHeight this is the BOTTOM panel's own height directly, not a
// top-panel height with the remainder implied. The upper bound is the live budget above, not the
// absolute ceiling — a 640px dock is fine on a tall window and destroys the chat on a short one.
function setTerminalDockHeight(height) {
  const max = maxTerminalDockHeight()
  const upper = Number.isFinite(max) ? max : TERMINAL_DOCK_MAX_HEIGHT
  const requested = Number.isFinite(height) ? Math.round(height) : TERMINAL_DOCK_MIN_HEIGHT
  const clamped = Math.max(TERMINAL_DOCK_MIN_HEIGHT, Math.min(upper, requested))
  const safe = Number.isFinite(clamped) ? clamped : TERMINAL_DOCK_MIN_HEIGHT
  document.documentElement.style.setProperty("--terminal-dock-h", `${safe}px`)
  return safe
}

// Mirrors documentViewerWidthForResize: re-clamp from the user's STORED intent, not from the
// current (already clamped) value, so widening the window again restores the size they picked
// instead of leaving the dock stuck at whatever a narrow window forced it down to.
function terminalDockHeightForResize() {
  const stored = Number(localStorage.getItem(TERMINAL_DOCK_HEIGHT_KEY))
  if (Number.isFinite(stored) && stored > 0) return stored
  const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--terminal-dock-h"))
  return Number.isFinite(current) && current > 0 ? current : TERMINAL_DOCK_MAX_HEIGHT
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

// Width to re-clamp the document preview to on a resize: the stored width when the user has
// dragged one, else whatever it is laid out at now. Never DOCUMENT_MAX_WIDTH — that would widen
// an untouched panel on the first resize instead of leaving it alone.
function documentViewerWidthForResize() {
  const stored = Number(localStorage.getItem(DOCUMENT_WIDTH_KEY))
  if (Number.isFinite(stored) && stored > 0) return stored
  const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--document-w"))
  return Number.isFinite(current) && current > 0 ? current : DOCUMENT_MAX_WIDTH
}

function applyStoredStackedRightWidth() {
  const stored = Number(localStorage.getItem(STACKED_RIGHT_WIDTH_KEY))
  if (Number.isFinite(stored) && stored > 0) setStackedRightWidth(stored)
}

function applyStoredStackedTopHeight() {
  const stored = Number(localStorage.getItem(STACKED_TOP_HEIGHT_KEY))
  if (Number.isFinite(stored) && stored > 0) setStackedTopHeight(stored)
}

function applyStoredTerminalDockHeight() {
  const stored = Number(localStorage.getItem(TERMINAL_DOCK_HEIGHT_KEY))
  if (Number.isFinite(stored) && stored > 0) setTerminalDockHeight(stored)
}

function applyStoredStackedRightMode() {
  state.stackedRightPanels = localStorage.getItem(STACKED_RIGHT_MODE_KEY) === "1"
}

// Reads the persisted set of expanded sidebar project ids. Returns an empty Set on missing or
// malformed storage so a corrupt value can never throw during startup.
function loadStoredExpanded() {
  try {
    const ids = JSON.parse(localStorage.getItem(EXPANDED_KEY) || "[]")
    return new Set(Array.isArray(ids) ? ids : [])
  } catch (error) {
    return new Set()
  }
}

// Writes the current expanded set back to storage. A storage failure must not break a render.
function persistExpanded() {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...state.expanded]))
  } catch (error) {
    // Ignore — persistence is best-effort.
  }
}

// Selected-prompt metadata persistence (loadSelectedPromptMetadata / persistSelectedPromptMetadata /
// recordSelectedPromptMetadata / clearSelectedPromptMetadata / applyPersistedPromptMetadataToThread)
// now lives in src/renderer/prompt-metadata.js (destructured above).

// First-run onboarding tour lifecycle. All storage access is try/catch: a broken localStorage
// (private mode) at worst shows the tour again next launch — it must never throw during render.
// Onboarding behavior (hasSeenOnboarding / start / advance / finish / skip / prepareOnboardingStep)
// now lives in src/renderer/onboarding.js (destructured above).

// Appearance theme (system | light | dark).
// The choice is a pure renderer/CSS concern: it toggles data-theme on <html>,
// which flips the CSS custom-property palette in styles.css. Persisted in
// localStorage (same best-effort pattern as the sidebar widths above) so it
// survives restarts with no main-process/IPC involvement.
const systemDarkQuery = typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null

// Returns a valid mode, defaulting to "system" on missing/corrupt/unknown storage.
function storedThemeMode() {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return THEME_MODES.includes(value) ? value : "system"
  } catch {
    return "system"
  }
}

// Default IDE for the "Open in IDE" split-button — same storage pattern as the theme mode
// above: renderer-only localStorage, no main-process/IPC involvement. An unrecognized stored
// value is harmless here (ideOption() falls back to "system" wherever it's consumed), so unlike
// storedThemeMode this doesn't need to validate against the known id list itself.
function storedDefaultIde() {
  try {
    return localStorage.getItem(DEFAULT_IDE_KEY) || "system"
  } catch {
    return "system"
  }
}

// Resolves a mode to the concrete palette to paint. "system" reads the OS setting.
function resolveTheme(mode) {
  if (mode === "light" || mode === "dark") return mode
  return systemDarkQuery && systemDarkQuery.matches ? "dark" : "light"
}

// Stamps the resolved palette on <html>. Dark is the default (no attribute) so a
// pre-render call here matches the CSS default and avoids any flash. Also swaps the
// highlight.js stylesheet so fenced code stays legible in the active palette. Guarded
// for the node:test harness, which loads this module with no `document`.
function applyResolvedTheme(mode) {
  if (typeof document === "undefined" || !document.documentElement) return
  const resolved = resolveTheme(mode)
  const root = document.documentElement
  if (resolved === "dark") root.removeAttribute("data-theme")
  else root.setAttribute("data-theme", resolved)
  const hljsDark = document.getElementById("hljs-dark")
  const hljsLight = document.getElementById("hljs-light")
  if (hljsDark) hljsDark.disabled = resolved !== "dark"
  if (hljsLight) hljsLight.disabled = resolved === "dark"
}

// Persists the choice, updates state, and repaints the palette immediately so the
// whole app switches on the same frame the toggle is clicked.
function setThemeMode(mode) {
  const next = THEME_MODES.includes(mode) ? mode : "system"
  state.themeMode = next
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch {
    // Ignore — persistence is best-effort.
  }
  applyResolvedTheme(next)
}

// Boot-time: read the stored choice into state and paint before the first render.
function applyStoredTheme() {
  state.themeMode = storedThemeMode()
  applyResolvedTheme(state.themeMode)
}

// When the user is on "system", follow live OS light/dark changes without a reload.
if (systemDarkQuery) {
  const onSystemThemeChange = () => {
    if (state.themeMode === "system") applyResolvedTheme("system")
  }
  if (typeof systemDarkQuery.addEventListener === "function") {
    systemDarkQuery.addEventListener("change", onSystemThemeChange)
  } else if (typeof systemDarkQuery.addListener === "function") {
    systemDarkQuery.addListener(onSystemThemeChange) // Safari/older WebKit fallback
  }
}

applyStoredTheme()
applyStoredSidebarWidth()
applyStoredRightFileSidebarWidth()
applyStoredDocumentViewerWidth()
applyStoredStackedRightMode()
applyStoredStackedRightWidth()
applyStoredStackedTopHeight()
applyStoredTerminalDockHeight()
syncSidebarForViewport()

// Re-clamp the document preview when the window shrinks so the side-by-side grid
// keeps fitting (instead of overflowing/collapsing). Only relevant while a
// document is open; the persisted value is left untouched so widening the window
// again restores the user's chosen size up to the stored bound. The Files panel
// needs no equivalent: its track is minmax(0, …) and yields on its own.
window.addEventListener("resize", () => {
  syncSidebarForViewport()
  // Same re-clamp for the terminal dock, and for the same reason: it does not shrink on its own,
  // so a window shrunk while it is open would otherwise squeeze the chat out of the layout.
  if (state.terminalPanelOpen) setTerminalDockHeight(terminalDockHeightForResize())
  if (!state.document) return
  setDocumentViewerWidth(documentViewerWidthForResize())
})

// Keep the onboarding spotlight glued to its anchor when the window is resized.
window.addEventListener("resize", () => {
  if (state.onboarding) positionOnboarding()
})

// Refocusing the window is the one reliable signal that files changed OUTSIDE the app (the user
// edited in their IDE, ran a build, switched branch in a terminal). The runtime cannot tell us:
// its filesystem watcher has no native backend in the pinned build. Debounced and tab-gated, so
// this costs nothing unless the Changes tab is actually on screen.
window.addEventListener("focus", () => {
  scheduleVcsRefresh()
})

// Memory-project selection helpers (selectedProject / projectAllPaths / memoryProjectById /
// normalizeMemoryProjectId / effectiveMemoryProjectId / selectedMemoryProject / isMemoryScopeDirty /
// resetMemorySelectionToActiveProject) now live in src/renderer/memory-project.js (destructured
// above). openMemoryScreen stays here — it orchestrates render()/loadMemory()/showToast(), not pure
// domain logic.
function openMemoryScreen(projectId = null) {
  state.nav = "skills"
  state.skillsTab = "memory"
  state.selectedMemoryProjectId = normalizeMemoryProjectId(projectId) || normalizeMemoryProjectId(state.activeProjectId)
  closeRightSidebarForNav()
  render()
  loadMemory().catch((error) => showToast(error?.message || "Failed to load memory."))
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
      ...selectedProjectContext(project),
      options: { mode: "visible-openable-files", recursive: true }
    })
    return (listing.children || []).filter((child) => child.type === "file" && child.openable).map((child) => child.path)
  }

  state.fileMentionMenu.loading = true
  state.fileMentionMenu.error = ""
  paintPromptAssistMenu()
  state.fileMentionMenu.loadPromise = crawl("")
    .then((files) => {
      const sortedFiles = files.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
      if (state.fileMentionMenu.projectId === project.id) {
        state.fileMentionMenu.files = sortedFiles
      }
      return sortedFiles
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

function projectSessionLoad(projectId) {
  return state.sessionLoadsByProject[projectId] || { status: "idle", generation: 0, error: "", autoRetried: false }
}

function markProjectSessionLoading(projectId) {
  const previous = projectSessionLoad(projectId)
  state.sessionLoadsByProject[projectId] = {
    ...previous,
    status: "loading",
    generation: ++state.sessionLoadSeq,
    error: ""
  }
  return state.sessionLoadsByProject[projectId].generation
}

function failProjectSessionLoad(projectId, error) {
  const previous = projectSessionLoad(projectId)
  state.sessionLoadsByProject[projectId] = {
    ...previous,
    status: "error",
    error: error?.message || "Could not load chats."
  }
}

function loadProjectSessions(projectId) {
  const existing = projectSessionLoadPromises.get(projectId)
  const previous = projectSessionLoad(projectId)
  if (existing?.generation === previous.generation && previous.status === "loading") return existing.promise
  const generation = previous.status === "loading" && previous.generation
    ? previous.generation
    : ++state.sessionLoadSeq
  if (previous.status !== "loading") {
    state.sessionLoadsByProject[projectId] = {
      status: "loading",
      generation,
      error: "",
      autoRetried: previous.autoRetried || false
    }
  }
  scheduleSidebarRender()
  const promise = (async () => {
    try {
      const sessions = await window.openworking.runtime.listSessions()
      if (projectSessionLoad(projectId).generation !== generation) return projectSessions(projectId)
      const next = setProjectSessions(projectId, sessions, "active")
      state.sessionLoadsByProject[projectId] = {
        status: "ready",
        generation,
        error: "",
        autoRetried: projectSessionLoad(projectId).autoRetried || false
      }
      return next
    } catch (error) {
      if (projectSessionLoad(projectId).generation === generation) failProjectSessionLoad(projectId, error)
      throw error
    } finally {
      if (projectSessionLoadPromises.get(projectId)?.promise === promise) {
        projectSessionLoadPromises.delete(projectId)
      }
      scheduleSidebarRender()
    }
  })()
  projectSessionLoadPromises.set(projectId, { generation, promise })
  return promise
}

function autoRetryProjectSessions(projectId) {
  if (!projectId || state.runtime?.status !== "running" || state.runtime?.project?.id !== projectId) return
  const load = projectSessionLoad(projectId)
  if (load.status === "ready" || load.autoRetried) return
  state.sessionLoadsByProject[projectId] = { ...load, autoRetried: true }
  loadProjectSessions(projectId).catch(() => {})
}

async function retryProjectSessions(projectId) {
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) return
  const load = projectSessionLoad(projectId)
  state.sessionLoadsByProject[projectId] = { ...load, autoRetried: false, error: "" }
  if (state.runtime?.status === "running" && state.runtime?.project?.id === projectId) {
    await loadProjectSessions(projectId)
    return
  }
  await openProject(projectId, { selectLatest: false })
}

function sessionMessageLoad(projectId, sessionId) {
  return state.messageLoadsBySession[sessionRowKey(projectId, sessionId)] || { status: "idle", generation: 0, error: "", projectId: null }
}

function listPendingInputsForSession(sessionId) {
  if (typeof window.openworking.runtime.listPendingInputs !== "function") return Promise.resolve([])
  return window.openworking.runtime.listPendingInputs({ sessionId })
}

function loadSessionMessages(project, sessionId) {
  const loadKey = sessionRowKey(project.id, sessionId)
  const existing = sessionMessageLoadPromises.get(loadKey)
  if (existing) return existing
  const directory = projectSessions(project.id).find((session) => session.id === sessionId)?.directory
    || project.activeWorktreePath
    || project.path
  const generation = ++state.messageLoadSeq
  state.messageLoadsBySession[loadKey] = { status: "loading", generation, error: "", projectId: project.id }
  if (state.activeProjectId === project.id && state.activeSessionId === sessionId) renderThreadContent({ threadScroll: "preserve" })
  const promise = (async () => {
    try {
      loadSubagentRunTree(sessionId)
      const [messages, pendingInputs] = await Promise.all([
        window.openworking.runtime.listMessages({ sessionId, directory }),
        listPendingInputsForSession(sessionId)
      ])
      if (sessionMessageLoad(project.id, sessionId).generation !== generation) return false
      state.messageLoadsBySession[loadKey] = { status: "ready", generation, error: "", projectId: project.id }
      hydrateSessionThread(project.id, sessionId, messages, state.runtime?.sessionStatuses?.[sessionId], pendingInputs)
      return true
    } catch (error) {
      if (sessionMessageLoad(project.id, sessionId).generation === generation) {
        state.messageLoadsBySession[loadKey] = {
          status: "error",
          generation,
          error: error?.message || "Could not load this chat.",
          projectId: project.id
        }
      }
      throw error
    } finally {
      sessionMessageLoadPromises.delete(loadKey)
      if (state.activeProjectId === project.id && state.activeSessionId === sessionId) renderThreadContent({ threadScroll: "preserve" })
    }
  })()
  sessionMessageLoadPromises.set(loadKey, promise)
  return promise
}

async function retrySessionMessages(projectId, sessionId) {
  const project = state.projects.find((item) => item.id === projectId)
  if (!project || state.activeSessionId !== sessionId) return
  await loadSessionMessages(project, sessionId)
}

// Renderer-side path compare (no realpath available here): trim a trailing separator and
// compare. Mirrors the intent of process-manager's samePath for matching a session's
// `directory` against a project's `path`.
function samePathish(left, right) {
  if (!left || !right) return false
  const normalize = (value) => String(value).replace(/[/\\]+$/, "")
  return normalize(left) === normalize(right)
}

function sessionRowKey(projectId, sessionId) {
  return `${projectId || ""}:${sessionId || ""}`
}

function dedupeSessions(sessions) {
  const seen = new Set()
  const unique = []
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session?.id || seen.has(session.id)) continue
    seen.add(session.id)
    unique.push(session)
  }
  return unique
}

function removeTrackedSubagentSessions(sessions) {
  return (Array.isArray(sessions) ? sessions : []).filter((session) => !state.subagentSessionIds.has(session?.id))
}

function sortSessionsByUpdated(sessions) {
  const timestamp = (session) => {
    const value = session?.time?.updated
    if (value === null || value === undefined || value === "") return Number.NEGATIVE_INFINITY
    const parsed = typeof value === "number" ? value : new Date(value).getTime()
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
  }
  return (Array.isArray(sessions) ? sessions : [])
    .map((session, index) => ({ session, index, updatedAt: timestamp(session) }))
    .sort((left, right) => right.updatedAt - left.updatedAt || left.index - right.index)
    .map((entry) => entry.session)
}

// Keeps only sessions whose `directory` matches one of the given project path(s) (a single
// string, or an array — a project has more than one valid directory once it has a worktree: its
// main path plus whichever worktree is currently active — see projectAllPaths). /session?directory=
// is already directory-scoped, so this is a defensive filter against any session tagged with a
// sibling/child directory leaking into a project's list. Sessions without `directory` are only
// accepted from the active runtime list, not from directory-scoped background fetches.
function sessionsForProjectPath(sessions, projectPaths) {
  const paths = Array.isArray(projectPaths) ? projectPaths : [projectPaths]
  return (Array.isArray(sessions) ? sessions : []).filter((session) =>
    session?.directory && paths.some((projectPath) => samePathish(session.directory, projectPath))
  )
}

function activeSessionsForProjectPath(sessions, projectPaths) {
  const paths = Array.isArray(projectPaths) ? projectPaths : [projectPaths]
  return (Array.isArray(sessions) ? sessions : []).filter((session) =>
    session?.id && (!session.directory || paths.some((projectPath) => samePathish(session.directory, projectPath)))
  )
}

function setProjectSessions(projectId, sessions, source = "directory") {
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) return []
  const next = sortSessionsByUpdated(removeTrackedSubagentSessions(dedupeSessions(
    source === "active"
      ? activeSessionsForProjectPath(sessions, projectAllPaths(project))
      : sessionsForProjectPath(sessions, projectAllPaths(project))
  )))
  const nextIds = new Set(next.map((session) => session.id))
  if (nextIds.size) {
    for (const [otherProjectId, otherSessions] of Object.entries(state.sessionsByProject)) {
      if (otherProjectId === projectId || !Array.isArray(otherSessions)) continue
      const filtered = otherSessions.filter((session) => !nextIds.has(session.id))
      if (filtered.length !== otherSessions.length) state.sessionsByProject[otherProjectId] = filtered
    }
  }
  state.sessionsByProject[projectId] = next
  for (const session of next) {
    if (session?.model?.providerID && (session.model.id || session.model.modelID)) {
      state.modelRefBySession.set(session.id, normalizeModelRef(session.model))
    }
    if (session?.agent) state.agentBySession.set(session.id, session.agent)
  }
  return next
}

function pruneTrackedSubagentSession(sessionId) {
  if (!sessionId) return false
  let changed = false
  for (const [projectId, sessions] of Object.entries(state.sessionsByProject)) {
    if (!Array.isArray(sessions)) continue
    const filtered = sessions.filter((session) => session?.id !== sessionId)
    if (filtered.length !== sessions.length) {
      state.sessionsByProject[projectId] = filtered
      changed = true
    }
  }
  return changed
}

function collectSubagentRunIds(runs, ids = new Set()) {
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run?.sessionId || ids.has(run.sessionId)) continue
    ids.add(run.sessionId)
    collectSubagentRunIds(run.children, ids)
  }
  return ids
}

function rebuildTrackedSubagentSessionIds() {
  const ids = new Set()
  for (const tree of state.subagentRunTreesByRoot.values()) collectSubagentRunIds(tree?.runs, ids)
  state.subagentSessionIds = ids
  let changed = false
  for (const sessionId of ids) changed = pruneTrackedSubagentSession(sessionId) || changed
  return changed
}

function applySubagentRunTree(tree) {
  const rootSessionId = typeof tree?.rootSessionId === "string" ? tree.rootSessionId : ""
  if (!rootSessionId || !Array.isArray(tree.runs) || !Number.isFinite(tree.revision)) return false
  const current = state.subagentRunTreesByRoot.get(rootSessionId)
  if (current && tree.revision < current.revision) return false
  state.subagentRunTreesByRoot.set(rootSessionId, tree)
  rebuildTrackedSubagentSessionIds()
  scheduleSidebarRender()
  if (rootSessionId === state.activeSessionId) scheduleThreadRender()
  return true
}

function clearSubagentRunTrees() {
  state.subagentRunEpoch += 1
  state.subagentRunTreesByRoot = new Map()
  state.subagentSessionIds = new Set()
  subagentRunLoadPromises.clear()
  subagentRunLoadGenerations.clear()
}

function subagentRunTree() {
  return state.activeSessionId ? state.subagentRunTreesByRoot.get(state.activeSessionId) || null : null
}

function loadSubagentRunTree(sessionId) {
  if (!sessionId || typeof window.openworking.runtime.listSubagentRuns !== "function") return Promise.resolve(null)
  const existing = subagentRunLoadPromises.get(sessionId)
  if (existing) return existing
  const generation = ++state.subagentRunLoadSeq
  const epoch = state.subagentRunEpoch
  subagentRunLoadGenerations.set(sessionId, generation)
  const promise = window.openworking.runtime.listSubagentRuns({ sessionId })
    .then((tree) => {
      if (epoch !== state.subagentRunEpoch || subagentRunLoadGenerations.get(sessionId) !== generation) return null
      applySubagentRunTree(tree)
      return tree
    })
    .catch(() => null)
    .finally(() => {
      if (subagentRunLoadPromises.get(sessionId) === promise) subagentRunLoadPromises.delete(sessionId)
    })
  subagentRunLoadPromises.set(sessionId, promise)
  return promise
}

// Populates sidebar history for EVERY project from the single running server. OpenCode's
// GET /session is scoped by directory, so we ask the one running server once per project
// `directory`. Requests run SEQUENTIALLY (not a parallel burst) and only while the runtime is
// running — if the server stops or the active project changes mid-loop we bail, so the fill never
// fights a project switch's server restart (the source of the ECONNRESET storm). A single
// in-flight guard coalesces the openProject + refreshSessionData triggers into one pass. Empty
// directory responses still leave existing lists alone; non-empty unsafe responses clear stale rows.
function loadAllSessions() {
  if (loadAllSessions.inFlight) return loadAllSessions.inFlight
  loadAllSessions.inFlight = (async () => {
    if (state.runtime?.status !== "running") return
    const activeProjectId = state.activeProjectId
    for (const project of state.projects) {
      if (state.runtime?.status !== "running" || state.activeProjectId !== activeProjectId) break
      // Query every directory this project's sessions could live under (main path + active
      // worktree, if different) — /session?directory= only ever answers for one directory at a
      // time, so a project with a selected worktree needs one call per directory to keep showing
      // history from worktrees it isn't currently running in.
      const results = await Promise.all(
        projectAllPaths(project).map((path) => window.openworking.runtime.listSessionsForDirectory(path).catch(() => []))
      )
      const sessions = results.flat()
      if (sessions.length) setProjectSessions(project.id, sessions, "directory")
    }
  })().finally(() => { loadAllSessions.inFlight = null })
  return loadAllSessions.inFlight
}

// Pinned projects float to the top, keeping registry order within each group.
function sortProjectsByPin(projects) {
  return [
    ...projects.filter((project) => project.pinned),
    ...projects.filter((project) => !project.pinned)
  ]
}

// Builds the sessionId → metadata map from the pins:list IPC array.
function pinsToMap(pins) {
  return new Map((pins || []).map((pin) => [pin.sessionId, {
    projectId: pin.projectId || null,
    title: pin.title || "",
    updatedAt: pin.updatedAt || null
  }]))
}

function selectedSession() {
  return projectSessions(state.activeProjectId).find((session) => session.id === state.activeSessionId) || null
}

function selectedProjectContext(project = selectedProject()) {
  if (!project) return null
  return {
    projectId: project.id,
    directory: selectedSession()?.directory || project.activeWorktreePath || project.path
  }
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

function configuredModelOptions() {
  return providerEntries().flatMap(([providerID, provider]) => {
    const models = Object.entries(provider.models || {})
    return models.map(([modelID, model]) => ({
      key: `${providerID}/${modelID}`,
      providerID,
      id: modelID,
      modelID,
      name: model?.name && model.name !== modelID
        ? model.name
        : models.length === 1 && provider.name
          ? provider.name
          : modelID,
      sub: `${provider.name || providerID} - local config`,
      contextLimit: typeof model?.limit?.context === "number" ? model.limit.context : undefined,
      variants: Object.keys(model?.variants || {}).map((id) => ({ id })),
      // { input: [...], output: [...] } — same modality strings as ALLOWED_MODEL_MODALITIES /
      // DEFAULT_MODEL_MODALITIES (opencode-config.js). Used to gate attachment modality support.
      modalities: model?.modalities && typeof model.modalities === "object" ? model.modalities : undefined
    }))
  })
}

// The app ships exactly one model (see DEFAULT_CONFIG in opencode-config.js), so the
// only source of truth is the local profile config. The runtime's own catalog
// (GET /api/model) also advertises the built-in `opencode` providers, which this
// product neither configures nor supports — it is deliberately not consulted here.
function modelOptions() {
  return configuredModelOptions()
}

function normalizeModelRef(model) {
  if (!model || typeof model !== "object") return null
  const providerID = String(model.providerID || "").trim()
  const id = String(model.id || model.modelID || "").trim()
  if (!providerID || !id) return null
  const variant = String(model.variant || "").trim()
  return { providerID, id, ...(variant ? { variant } : {}) }
}

function modelRefKey(model) {
  const ref = normalizeModelRef(model)
  return ref ? `${ref.providerID}/${ref.id}` : ""
}

function currentModelRef() {
  const models = modelOptions()
  const fallback = normalizeModelRef(models[0])
  if (state.activeSessionId) {
    const existing = normalizeModelRef(state.modelRefBySession.get(state.activeSessionId) || selectedSession()?.model)
    if (existing && models.some((model) => model.key === modelRefKey(existing))) return existing
    if (fallback) state.modelRefBySession.set(state.activeSessionId, fallback)
    return fallback
  }
  const draft = normalizeModelRef(state.newSessionModelRef)
  if (draft && models.some((model) => model.key === modelRefKey(draft))) return draft
  state.newSessionModelRef = fallback
  return fallback
}

function selectedModel() {
  const ref = currentModelRef()
  if (!ref) return null
  return modelOptions().find((model) => model.key === modelRefKey(ref)) || null
}

function normalizeReasoningMode(mode) {
  return typeof mode === "string" && mode.trim() ? mode.trim() : "none"
}

function reasoningModeLabel(mode) {
  const normalized = normalizeReasoningMode(mode)
  return REASONING_OPTIONS.find((option) => option.id === normalized)?.label
    || normalized.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function reasoningModeShortLabel(mode) {
  const normalized = normalizeReasoningMode(mode)
  return REASONING_OPTIONS.find((option) => option.id === normalized)?.shortLabel || reasoningModeLabel(normalized)
}

function reasoningModeTitle(mode) {
  const normalized = normalizeReasoningMode(mode)
  return REASONING_OPTIONS.find((option) => option.id === normalized)?.title || `${reasoningModeLabel(normalized)} model variant`
}

function currentReasoningMode() {
  return normalizeReasoningMode(currentModelRef()?.variant || "none")
}

async function setCurrentReasoningMode(mode, { keepPopover = false } = {}) {
  const current = currentModelRef()
  if (!current || state.modelSelectionBusy) return
  const next = normalizeReasoningMode(mode)
  const nextRef = { providerID: current.providerID, id: current.id, ...(next !== "none" ? { variant: next } : {}) }
  if (state.activeSessionId) {
    const sessionId = state.activeSessionId
    const previous = normalizeModelRef(state.modelRefBySession.get(sessionId) || current)
    state.modelRefBySession.set(sessionId, nextRef)
    state.modelSelectionBusy = true
    render()
    try {
      await window.openworking.runtime.selectSessionModel({ sessionId, model: nextRef })
      updateSessionMetadata(sessionId, { model: nextRef })
    } catch (error) {
      if (previous) state.modelRefBySession.set(sessionId, previous)
      showToast(error.message || "Could not change model variant.")
    } finally {
      state.modelSelectionBusy = false
    }
  } else {
    state.newSessionModelRef = nextRef
  }
  if (!keepPopover) state.popover = null
  render()
  document.getElementById("promptInput")?.focus()
}

function updateSessionMetadata(sessionId, changes) {
  for (const [projectId, sessions] of Object.entries(state.sessionsByProject)) {
    if (!Array.isArray(sessions)) continue
    state.sessionsByProject[projectId] = sessions.map((session) => (
      session?.id === sessionId ? { ...session, ...changes } : session
    ))
  }
}

function runtimeLabel() {
  if (state.loading || state.runtime?.status === "starting" || state.runtime?.status === "stopping") return "starting"
  if (state.runtime?.status === "error") return "error"
  if (state.runtime?.status === "running" && state.runtime.activity === "running") return "running"
  return "idle"
}

function sessionUpdatedAt(session) {
  return session.time?.updated || session.time?.created || session.updatedAt || session.createdAt
}

function sessionDisplayTitle(session) {
  return session?.title || session?.label || "Untitled session"
}

function hydrateSessionThread(projectId, sessionId, messages, status, pendingInputs) {
  const thread = ensureThread(sessionId)
  const isActive = state.activeProjectId === projectId && state.activeSessionId === sessionId
  // A fresh thread (no messages yet) is being populated from the server for the
  // first time → clear the per-session view state. An already-live background thread
  // keeps its disclosure/document state so returning to it looks unchanged.
  if (isActive && (thread.sessionId !== sessionId || !thread.messages.length)) {
    state.document = null
  }
  hydrateThread(thread, sessionId, messages, status, pendingInputs)
  applyPersistedPromptMetadataToThread(sessionId, thread)
  return thread
}

function hydrateActiveThread(messages, status, pendingInputs) {
  return hydrateSessionThread(state.activeProjectId, state.activeSessionId, messages, status, pendingInputs)
}

// Resets the *draft* thread used before a session exists. Switching to a real
// session never resets that session's thread — its history must survive.
function resetActiveThread(sessionId = null) {
  state.document = null
  state.planAutoOpened = null
  state.planAccepted = null
  state.planProposal = null
  state.planCardExpanded = false
  state.threads.set(sessionId, resetThread(ensureThread(sessionId), sessionId))
}

function showToast(message) {
  state.toast = message
  renderToast()
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => {
    state.toast = null
    renderToast()
  }, 5000)
  if (typeof showToast.timer?.unref === "function") showToast.timer.unref()
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
    // down, so we never reach here. If we do, manual installation is required.
    showToast("Installer ready — follow the prompts to update.")
  } catch (error) {
    showToast(error.message)
  } finally {
    state.updating = false
    state.downloadProgress = null
    state.installStatus = null
    render()
  }
}

async function loadReadyState() {
  const [projects, activeConfig, runtime, pins] = await Promise.all([
    window.openworking.projects.list(),
    window.openworking.config.get(),
    window.openworking.runtime.get(),
    window.openworking.pins.list()
  ])
  state.projects = projects
  state.pinnedSessions = pinsToMap(pins)
  state.configPath = activeConfig.path
  state.config = activeConfig.config
  // Personalization (currently just defaultIde) is app-local UI preference, stored in
  // localStorage (same as the Appearance theme mode above) — attach it to state.config so
  // existing reads of state.config?.personalization?.defaultIde keep working.
  state.config.personalization = { defaultIde: storedDefaultIde() }
  state.customSkills = activeConfig.customSkills || []
  state.managedPlugins = activeConfig.managedPlugins || []
  state.mcpServers = activeConfig.mcp || []
  state.providerId = Object.keys(state.config.provider || {})[0] || "gateway"
  state.runtime = runtime
  selectedModel()
  // Restore the accordions the user had open last session, pruning ids for projects that no
  // longer exist. The active project is always opened below so the very first run still shows
  // its sessions even with empty storage.
  for (const id of loadStoredExpanded()) {
    if (projects.some((project) => project.id === id)) state.expanded.add(id)
  }
  if (projects[0]) {
    state.activeProjectId = projects[0].id
    state.expanded.add(projects[0].id)
  }
  persistExpanded()
  render()
  checkAppVersion()
  if (projects[0]) {
    // openProject() loads the active project's sessions AND calls loadAllSessions() to fill in
    // history for every other expanded/pinned accordion from the same server.
    await openProject(projects[0].id, { selectLatest: false }).catch((error) => showToast(error.message))
  }
  // First-run tour: only once, and never over a forced update (startOnboarding gates that).
  if (!hasSeenOnboarding()) startOnboarding()
}

async function loadInitialState() {
  state.profile = await window.openworking.profile.getStatus()
  if (state.profile.status === "blocked") {
    render()
    return
  }
  await loadReadyState()
}

function handleProfileUpdate(profile) {
  state.profile = profile
  if (profile.status === "blocked") render()
}

async function retryProfile() {
  if (state.profileRetrying) return
  state.profileRetrying = true
  render()
  try {
    state.profile = await window.openworking.profile.retry()
    if (state.profile.status === "blocked") {
      render()
      return
    }
    await loadReadyState()
  } finally {
    state.profileRetrying = false
    if (state.profile?.status === "blocked") render()
  }
}

async function openProfileFolder() {
  await window.openworking.profile.openFolder()
}

function handleRuntimeUpdate(runtime) {
  const activeSessionId = state.activeSessionId
  const previousProjectId = state.runtime?.project?.id || null
  const previousCompactionStatus = activeSessionId
    ? state.runtime?.compactionStatuses?.[activeSessionId]?.status
    : null
  const previousStatus = state.runtime?.status
  state.runtime = runtime
  if (
    previousProjectId !== (runtime?.project?.id || null) ||
    (previousStatus === "running" && runtime?.status !== "running")
  ) {
    clearSubagentRunTrees()
    scheduleSidebarRender()
    scheduleThreadRender()
  }
  const nextCompactionStatus = activeSessionId
    ? runtime?.compactionStatuses?.[activeSessionId]?.status
    : null
  if (previousCompactionStatus !== nextCompactionStatus) render()
  else {
    renderRuntimeStatus()
    renderSessionBadges()
  }
  if (runtime?.status !== "running" && runtime?.project?.id) {
    const load = projectSessionLoad(runtime.project.id)
    state.sessionLoadsByProject[runtime.project.id] = { ...load, autoRetried: false }
  }
  if (previousStatus !== "running" && runtime?.status === "running") {
    autoRetryProjectSessions(runtime.project?.id)
    // A restart (e.g. switching projects) wipes the runtime's in-memory pending requests, so
    // every card carried over from before it is already dead.
    reconcilePendingRequests().catch(() => {})
  }
}

const SESSION_LIFECYCLE_EVENTS = new Set(["session.status", "session.idle", "session.aborted", "session.error"])
const STREAM_PACE_DELAY_MS = 40
const STREAM_SEGMENT_TARGET_CHARS = 8
const STREAM_SEGMENT_MAX_CHARS = 12
const STREAM_BACKLOG_SEGMENT_THRESHOLD = 160
const STREAM_BACKLOG_BATCH_SIZE = 2
const STREAM_TERMINAL_EVENTS = new Set(["session.idle", "session.error", "session.aborted"])

function charCount(value) {
  return Array.from(String(value || "")).length
}

function splitLongToken(token, maxChars = STREAM_SEGMENT_MAX_CHARS) {
  const chars = Array.from(token)
  const chunks = []
  for (let index = 0; index < chars.length; index += maxChars) {
    chunks.push(chars.slice(index, index + maxChars).join(""))
  }
  return chunks
}

function splitStreamDeltaSegments(delta, {
  targetChars = STREAM_SEGMENT_TARGET_CHARS,
  maxChars = STREAM_SEGMENT_MAX_CHARS
} = {}) {
  const text = String(delta || "")
  if (!text) return []
  const tokens = text.match(/\s+|[^\s]+/gu) || []
  const segments = []
  let current = ""
  const flush = () => {
    if (!current) return
    segments.push(current)
    current = ""
  }

  for (const token of tokens) {
    const tokenLength = charCount(token)
    if (tokenLength > maxChars) {
      flush()
      segments.push(...splitLongToken(token, maxChars))
      continue
    }
    const nextLength = charCount(current) + tokenLength
    if (current && nextLength > maxChars && charCount(current) >= Math.min(targetChars, maxChars)) {
      flush()
    }
    current += token
    if (charCount(current) >= targetChars && /[\s.,!?;:)\]}]$/u.test(current)) flush()
  }
  flush()
  return segments
}

function pacedPartKey(messageID, partID) {
  return `${messageID || ""}\u0000${partID || ""}`
}

function createStreamPacer({
  applyEvent,
  delayMs = STREAM_PACE_DELAY_MS,
  splitDelta = splitStreamDeltaSegments,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer)
} = {}) {
  const sessions = new Map()
  const ensureSession = (sessionID) => {
    let entry = sessions.get(sessionID)
    if (!entry) {
      entry = { sessionID, queue: [], deferred: [], partCounts: new Map(), timer: null }
      sessions.set(sessionID, entry)
    }
    return entry
  }
  const incrementPart = (entry, key) => {
    entry.partCounts.set(key, (entry.partCounts.get(key) || 0) + 1)
  }
  const decrementPart = (entry, key) => {
    const next = (entry.partCounts.get(key) || 0) - 1
    if (next > 0) entry.partCounts.set(key, next)
    else entry.partCounts.delete(key)
  }
  const finishIfIdle = (entry) => {
    if (entry.queue.length || entry.timer || entry.partCounts.size) return
    const deferred = entry.deferred.splice(0)
    for (const event of deferred) applyEvent(event)
    if (!entry.queue.length && !entry.timer && !entry.deferred.length && !entry.partCounts.size) {
      sessions.delete(entry.sessionID)
    }
  }
  const schedule = (entry) => {
    if (entry.timer || !entry.queue.length) return
    entry.timer = setTimer(() => {
      entry.timer = null
      const batchSize = entry.queue.length > STREAM_BACKLOG_SEGMENT_THRESHOLD
        ? Math.min(STREAM_BACKLOG_BATCH_SIZE, entry.queue.length)
        : 1
      for (let index = 0; index < batchSize; index += 1) {
        const item = entry.queue.shift()
        if (!item) break
        applyEvent(item.event)
        decrementPart(entry, item.key)
      }
      if (entry.queue.length) schedule(entry)
      else finishIfIdle(entry)
    }, delayMs)
  }

  const api = {
    enqueue(event) {
      if (!event?.sessionID || typeof event.delta !== "string") return false
      const segments = splitDelta(event.delta)
      if (!segments.length) return false
      const entry = ensureSession(event.sessionID)
      const key = pacedPartKey(event.messageID, event.partID)
      for (const segment of segments) {
        incrementPart(entry, key)
        entry.queue.push({ key, event: { ...event, delta: segment } })
      }
      schedule(entry)
      return true
    },
    defer(event) {
      if (!event?.sessionID) return false
      ensureSession(event.sessionID).deferred.push(event)
      return true
    },
    flushSession(sessionID) {
      const entry = sessions.get(sessionID)
      if (!entry) return false
      if (entry.timer) {
        clearTimer(entry.timer)
        entry.timer = null
      }
      while (entry.queue.length) {
        const item = entry.queue.shift()
        applyEvent(item.event)
        decrementPart(entry, item.key)
      }
      const deferred = entry.deferred.splice(0)
      for (const event of deferred) applyEvent(event)
      sessions.delete(sessionID)
      return true
    },
    clearSession(sessionID) {
      const entry = sessions.get(sessionID)
      if (!entry) return false
      if (entry.timer) clearTimer(entry.timer)
      sessions.delete(sessionID)
      return true
    },
    flushAll() {
      for (const sessionID of [...sessions.keys()]) api.flushSession(sessionID)
    },
    hasPendingSession(sessionID) {
      const entry = sessions.get(sessionID)
      return Boolean(entry && (entry.queue.length || entry.deferred.length || entry.partCounts.size || entry.timer))
    },
    hasPendingPart(sessionID, messageID, partID) {
      return Boolean(sessions.get(sessionID)?.partCounts.has(pacedPartKey(messageID, partID)))
    }
  }
  return api
}

// Agent progress uses OpenCode's `reasoning` wire field and must be paced alongside text.
// Otherwise its authoritative part.updated can overtake the queued deltas on screen.
function isPaceableDelta(event) {
  return event?.type === "message.part.delta" && (event.field === "text" || event.field === "reasoning")
}

function isTextPartUpdate(event) {
  return event?.type === "message.part.updated" &&
    (event.part?.type === "text" || event.part?.type === "reasoning")
}

// `session.step.ended` becomes a message.updated carrying `time.completed`, and only the step
// that finishes the turn sets it — see projectRuntimeEvent in runtime/process-manager.js.
function isTurnCompletionUpdate(event) {
  return event?.type === "message.updated" && event.info?.time?.completed != null
}

function maybeConsumePacedRuntimeEvent(event, activeSessionId = state.activeSessionId, pacer = streamPacer) {
  if (!event?.sessionID || event.sessionID !== activeSessionId) return false
  // Plan proposals render the server stream as-is. In particular, do not hold
  // their final message/lifecycle events behind the renderer's cosmetic 40 ms
  // pacing queue; completion of the assistant message drives the Plan card UI.
  if (state.planProposal?.sessionId === event.sessionID) return false
  if (isPaceableDelta(event)) return pacer.enqueue(event)
  if (isTextPartUpdate(event) && pacer.hasPendingPart(event.sessionID, event.part?.messageID, event.part?.id)) {
    return pacer.defer(event)
  }
  // The pinned gateway sends the whole reasoning and the whole answer in one delta each, then
  // ends the step ~50 ms later. Settling the message that early — while the pacer is still
  // painting those characters — collapses the reasoning rows into the Agent progress card
  // mid-stream, so completion travels with the queue rather than around it.
  if (isTurnCompletionUpdate(event) && pacer.hasPendingSession(event.sessionID)) {
    return pacer.defer(event)
  }
  if (STREAM_TERMINAL_EVENTS.has(event.type) && pacer.hasPendingSession(event.sessionID)) {
    if (event.type === "session.aborted") {
      pacer.flushSession(event.sessionID)
      return false
    }
    return pacer.defer(event)
  }
  return false
}

// Ticks the live "elapsed" clock on the loading indicators once per second while the
// active thread is busy. Stream events alone are too sparse (there can be long silent
// gaps before the first token), so a dedicated interval drives the repaint. It is
// self-cancelling: it clears on idle and defensively inside its own tick.
let liveClockTimer = null
function syncLiveClock() {
  const busy = threadIsBusy(activeThread())
  if (busy && !liveClockTimer) {
    liveClockTimer = setInterval(() => {
      if (!threadIsBusy(activeThread())) {
        clearInterval(liveClockTimer)
        liveClockTimer = null
        return
      }
      scheduleThreadRender()
    }, 1000)
  } else if (!busy && liveClockTimer) {
    clearInterval(liveClockTimer)
    liveClockTimer = null
  }
}

function applyRuntimeStreamEvent(event) {
  const sessionId = event?.sessionID
  if (!sessionId) return
  if (
    (event.type === "session.input.admitted" || event.type === "session.input.promoted") &&
    event.inputID
  ) {
    confirmInputSubmission(event.inputID)
  }
  if (event.type === "session.model.selected" && event.model) {
    const model = normalizeModelRef(event.model)
    if (model) {
      state.modelRefBySession.set(sessionId, model)
      updateSessionMetadata(sessionId, { model })
      if (sessionId === state.activeSessionId) render()
    }
    return
  }
  if (event.type === "session.agent.selected") {
    state.agentBySession.set(sessionId, event.agent)
    updateSessionMetadata(sessionId, { agent: event.agent })
    return
  }
  if (event.type === "session.compaction.delta") return
  if (event.type.startsWith("session.compaction.")) {
    const statuses = { ...(state.runtime?.compactionStatuses || {}) }
    if (event.type === "session.compaction.admitted") {
      statuses[sessionId] = { status: "admitted", reason: event.reason || "manual" }
    } else if (event.type === "session.compaction.started") {
      statuses[sessionId] = { status: "running", reason: event.reason || "manual" }
    } else if (event.type === "session.compaction.ended") {
      // freshAfter is the message count at the moment compaction finished: the thread's LAST
      // assistant message at that instant still reports its PRE-compaction token count, so
      // resolveContextUsage must not trust it as current usage. Once a real new turn appends
      // messages past this count, the thread's own stats are current again and take over —
      // without this snapshot, a status of "ended" would otherwise never clear (nothing else
      // resets compactionStatuses) and the ring would stay stuck on stale/fetched forever.
      const freshAfter = state.threads.get(sessionId)?.messages?.length ?? 0
      statuses[sessionId] = { status: "ended", reason: event.reason || "manual", freshAfter }
      if (sessionId === state.activeSessionId) showToast("Context compacted")
      scheduleRefresh()
      refreshSessionContextUsage(sessionId)
    } else if (event.type === "session.compaction.failed") {
      statuses[sessionId] = { status: "failed", reason: event.reason || "manual", error: event.error || "Compaction failed." }
      if (sessionId === state.activeSessionId) showToast(event.error || "Compaction failed.")
    }
    if (state.runtime) state.runtime = { ...state.runtime, compactionStatuses: statuses }
    if (sessionId === state.activeSessionId) render()
    return
  }
  if (event.type.startsWith("session.revert.")) {
    if (event.type === "session.revert.staged") updateSessionMetadata(sessionId, { revert: event.revert })
    else {
      updateSessionMetadata(sessionId, { revert: null })
      state.revertDraftBySession.delete(sessionId)
    }
    refreshProjectFilesAfterRevertEvent(sessionId)
    scheduleRefresh()
    if (sessionId === state.activeSessionId) render()
    return
  }
  const thread = ensureThread(sessionId)
  const result = applyThreadEvent(thread, event) || {}
  const isActive = sessionId === state.activeSessionId
  const affectsGlobalPermissionUi = event.type === "permission.asked" || event.type === "permission.replied"
  if (SESSION_LIFECYCLE_EVENTS.has(event.type)) {
    if (isActive) updateComposerSubmitButton()
    renderSessionBadges()
  }
  if (result.changed && (isActive || affectsGlobalPermissionUi)) {
    if (isActive) maybeAutoOpenPlan()
    if (isActive) scheduleThreadRender()
    else renderThreadContent()
  }
  if (result.reconcile) {
    scheduleRefresh({ forceThreads: event.type === "session.input.promoted" && !result.changed })
  }
  syncLiveClock()
}

const streamPacer = createStreamPacer({ applyEvent: applyRuntimeStreamEvent })

function flushActiveStreamPacing() {
  if (state.activeSessionId) streamPacer.flushSession(state.activeSessionId)
}

// The References tab is not always the visible surface an update needs to reach — mirrors
// loadMemory/saveMemory's paintSkillsPanelOrRender-or-render split.
function paintReferencesOrRender() {
  if (state.nav === "skills" && state.skillsTab === "references") paintSkillsPanelOrRender()
  else render()
}

// Re-fetches the active project's reference list, scoped so a slow response from a project the
// user has since navigated away from can never overwrite what's on screen for the new one.
// `silent` (used for the background reference.updated event) skips the loading/error UI and only
// repaints when the References tab actually happens to be open — a stream event arriving while
// the user is elsewhere in the app must not force a full-app render.
function refreshReferences({ silent = false } = {}) {
  const project = selectedProject()
  if (!project || typeof window.openworking.references?.list !== "function") return Promise.resolve()
  const projectId = project.id
  if (!silent) {
    state.referencesLoading = true
    state.referencesError = null
    paintReferencesOrRender()
  }
  return window.openworking.references.list(selectedProjectContext(project)).then((references) => {
    if (state.activeProjectId !== projectId) return
    state.references = references
  }).catch((error) => {
    if (silent || state.activeProjectId !== projectId) return
    state.referencesError = error?.message || "Failed to load references."
  }).finally(() => {
    if (state.activeProjectId !== projectId) return
    if (!silent) state.referencesLoading = false
    const referencesTabOpen = state.nav === "skills" && state.skillsTab === "references"
    if (!silent || referencesTabOpen) paintReferencesOrRender()
  })
}

function openReferenceForm() {
  state.referenceDraft = { kind: "path", name: "", path: "", repository: "", branch: "", description: "" }
  state.referenceFormOpen = true
  state.referencesError = null
  paintReferencesOrRender()
}

function closeReferenceForm() {
  state.referenceFormOpen = false
  state.referenceDraft = null
  state.referencesError = null
  paintReferencesOrRender()
}

async function addReference() {
  const draft = state.referenceDraft
  const project = selectedProject()
  if (!draft || !project || state.referenceSaving) return
  state.referenceSaving = true
  state.referencesError = null
  paintReferencesOrRender()
  try {
    const payload = {
      name: draft.name,
      ...(draft.kind === "git"
        ? { repository: draft.repository, ...(draft.branch ? { branch: draft.branch } : {}) }
        : { path: draft.path }),
      ...(draft.description ? { description: draft.description } : {})
    }
    await window.openworking.references.add(payload, selectedProjectContext(project))
    state.referenceFormOpen = false
    state.referenceDraft = null
    await refreshReferences()
  } catch (error) {
    state.referencesError = error?.message || "Failed to add reference."
  } finally {
    state.referenceSaving = false
    paintReferencesOrRender()
  }
}

async function removeReference(name) {
  const project = selectedProject()
  if (!project || !name || state.referenceRemoving) return
  state.referenceRemoving = name
  state.referencesError = null
  paintReferencesOrRender()
  try {
    await window.openworking.references.remove(name, selectedProjectContext(project))
    await refreshReferences()
  } catch (error) {
    state.referencesError = error?.message || "Failed to remove reference."
  } finally {
    state.referenceRemoving = null
    paintReferencesOrRender()
  }
}

function handleRuntimeStream(event) {
  // Connection (re)established → reconcile every known thread from the server. Pending
  // permission/question cards need their own pass: the events that retire them may have been
  // emitted while the stream was down, and the stream has no replay cursor to recover them.
  if (event?.type === "runtime.stream.connected") {
    scheduleRefresh({ forceThreads: true })
    reconcilePendingRequests().catch(() => {})
    return
  }
  if (event?.type === "subagent.run-tree.updated") {
    applySubagentRunTree(event.tree)
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
  if (event?.type === "runtime.catalog.updated") {
    window.openworking.runtime.listCommands()
      .then((commands) => { state.commands = commands })
      .then(() => scheduleThreadRender())
      .catch(() => {})
    return
  }
  if (event?.type === "reference.updated") {
    refreshReferences({ silent: true })
    return
  }
  // PTY stream: pty.data is the hot path (every output chunk) — write straight into the live
  // xterm buffer via terminalBridge rather than a state mutation + render(), so a fast-streaming
  // terminal never triggers a full app repaint per chunk. pty.connected/pty.disconnected are rare
  // lifecycle transitions and go through normal bridged state + render() like everything else.
  if (event?.type === "pty.data") {
    if (event.ptyId === state.terminalPtyId) terminalBridge.write?.(event.data)
    return
  }
  if (event?.type === "pty.connected") {
    if (event.ptyId === state.terminalPtyId) { state.terminalStatus = "connected"; state.terminalError = null; render() }
    return
  }
  if (event?.type === "pty.disconnected") {
    if (event.ptyId === state.terminalPtyId) { state.terminalStatus = event.exited ? "exited" : "lost"; render() }
    return
  }
  // Working-copy refresh signals for the Changes panel. `filesystem.changed` is the natural
  // trigger but never fires on the pinned runtime (no watcher backend — see runtime-contract.js),
  // so a finished agent turn is the practical signal that files on disk just changed.
  // scheduleVcsRefresh() is a no-op unless the Changes tab is actually open.
  // session.idle deliberately falls through: it is also a session-lifecycle event that the
  // thread machinery below must still see.
  if (event?.type === "session.idle") scheduleVcsRefresh()
  if (event?.type === "filesystem.changed" || event?.type === "vcs.branch.updated") {
    scheduleVcsRefresh()
    return
  }
  if (event?.type === "session.created") return
  if (!event?.sessionID) return
  if (maybeConsumePacedRuntimeEvent(event)) {
    return
  }
  applyRuntimeStreamEvent(event)
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
  if (state.nav === "skills" && state.skillsTab === "mcp") paintSkillsPanelOrRender()
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
    if (state.nav === "skills" && state.skillsTab === "mcp") paintSkillsPanelOrRender()
  } catch {
    // Runtime not ready; leave status empty.
  }
}

// Browser-use bridge: fetch native-host/extension install status for the Extensions screen card.
async function refreshBrowserStatus() {
  try {
    state.browserStatus = await window.openworking.browser.status()
    // Refresh the setup popup's live status chips when it's open; otherwise only repaint the panel
    // when the Extensions tab is actually showing (off-tab this is a silent status-cache update).
    if (state.browserSetupOpen) render()
    else if (state.nav === "skills" && state.skillsTab === "mcp") paintSkillsPanelOrRender()
  } catch {
    // Bridge unavailable (older main); leave the card in its default state.
  }
}

async function installBrowserHost() {
  state.browserBusy = true
  state.browserError = null
  // See loadMemory() for why this paint is deferred by a frame: installHost() often resolves
  // within a frame, and painting synchronously both before and after would tear the panel down
  // twice in a row (flash/flicker) instead of once.
  const showLoadingFrame = requestAnimationFrame(() => {
    if (state.nav === "skills" && state.skillsTab === "mcp") paintSkillsPanelOrRender()
    else render()
  })
  try {
    await window.openworking.browser.installHost()
    state.browserStatus = await window.openworking.browser.status()
  } catch (error) {
    state.browserError = error.message
  } finally {
    cancelAnimationFrame(showLoadingFrame)
    state.browserBusy = false
    if (state.nav === "skills" && state.skillsTab === "mcp") paintSkillsPanelOrRender()
    else render()
  }
}

async function openBrowserExtension() {
  state.browserError = null
  try {
    await window.openworking.browser.openExtensionPage()
  } catch (error) {
    state.browserError = error.message
    repaintBrowser()
  }
}

// Repaint after a browser action. The setup popup is mounted in the top-level render tree, so while
// it's open we must do a full render() — paintSkillsPanelOrRender() only patches the Extensions panel
// island and would never insert/update the modal. Otherwise patch the panel in place when it shows.
function repaintBrowser() {
  if (state.browserSetupOpen) { render(); return }
  if (state.nav === "skills" && state.skillsTab === "mcp") paintSkillsPanelOrRender()
  else render()
}

// Open the extension-install popup and refresh what it shows: live host/Chrome status + the release
// metadata (download link + version) from the extension API. Both are best-effort; on failure the
// popup still renders with its bundled-folder fallback.
function openBrowserSetup() {
  state.browserSetupOpen = true
  state.browserError = null
  repaintBrowser()
  refreshBrowserStatus()
}

function closeBrowserSetup() {
  state.browserSetupOpen = false
  // Full render: the modal lives in the top-level render tree, so removing it needs render(), not the
  // panel-only patch repaintBrowser() would take once the flag is already false.
  render()
}

// Cross-chat memory: load both scopes into state, seeding the editable draft. Called when the
// Memory tab is opened. Re-seeds the draft from disk so the editor reflects the assistant's writes.
// `preserveGlobalDraft` keeps unsaved global-memory text when a reload is only about switching the
// project selector — global memory is project-independent, so a project switch must not clobber it.
async function loadMemory({ preserveGlobalDraft = false } = {}) {
  const loadSeq = ++state.memoryLoadSeq
  const keepGlobal = preserveGlobalDraft && isMemoryScopeDirty("global")
  const preservedGlobal = keepGlobal ? state.memoryDraft?.global ?? "" : null
  state.memoryLoading = true
  state.memoryError = null
  // Defer the "loading" paint by a frame and cancel it if the (usually fast, local) read already
  // resolved by then — painting synchronously both before and right after a sub-frame await tears
  // the panel down twice in a row, which reads as a flash/flicker rather than a real loading state.
  const showLoadingFrame = requestAnimationFrame(() => {
    if (loadSeq !== state.memoryLoadSeq) return
    if (state.nav === "skills" && state.skillsTab === "memory") paintSkillsPanelOrRender()
    else render()
  })
  try {
    const targetProjectId = effectiveMemoryProjectId()
    const memory = await window.openworking.memory.get(targetProjectId)
    if (loadSeq !== state.memoryLoadSeq) return
    state.memory = memory
    state.selectedMemoryProjectId = normalizeMemoryProjectId(memory.projectId) || targetProjectId || null
    state.memoryDraft = { global: keepGlobal ? preservedGlobal : (memory.global || ""), project: memory.project || "" }
  } catch (error) {
    if (loadSeq !== state.memoryLoadSeq) return
    state.memoryError = error?.message || "Failed to load memory."
  } finally {
    cancelAnimationFrame(showLoadingFrame)
    if (loadSeq !== state.memoryLoadSeq) return
    state.memoryLoading = false
    if (state.nav === "skills" && state.skillsTab === "memory") paintSkillsPanelOrRender()
  }
}

async function saveMemory(scope) {
  if (!["global", "project"].includes(scope) || state.memorySaving) return
  const content = state.memoryDraft?.[scope] ?? ""
  const targetProjectId = effectiveMemoryProjectId()
  state.memorySaving = scope
  state.memoryError = null
  if (state.nav === "skills" && state.skillsTab === "memory") paintSkillsPanelOrRender()
  else render()
  try {
    const memory = await window.openworking.memory.save(scope, content, targetProjectId)
    state.memory = memory
    state.selectedMemoryProjectId = normalizeMemoryProjectId(memory.projectId) || targetProjectId || null
    state.memoryDraft = { global: memory.global || "", project: memory.project || "" }
  } catch (error) {
    state.memoryError = error?.message || "Failed to save memory."
  } finally {
    state.memorySaving = null
    if (state.nav === "skills" && state.skillsTab === "memory") paintSkillsPanelOrRender()
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

function latestPlanText() {
  const message = latestPlanMessage()
  return message ? (messageText(message) || "").trim() : ""
}

// True when this assistant message is the plan produced for the active proposal.
// Used by renderThreadMessage to render it as a collapsible Plan card instead of
// raw prose. Compares by id since upsert mutates messages in place.
function isPlanMessage(message) {
  if (!activePlanProposal()) return false
  return Boolean(message?.id) && message.id === latestPlanMessage()?.id
}

// Minimum assistant text length to treat a prose reply as a proposed plan when
// the plan agent answered without writing a markdown file.
const PLAN_TEXT_MIN_LENGTH = 200

// The plan is rendered as a collapsible card inline in the chat thread (see
// renderPlanCardMessage), so it is no longer mirrored into the right-side
// document viewer. This keeps `state.planAutoOpened` reset while a proposal is
// active; opening any document panel for a plan is intentionally not done here.
function maybeAutoOpenPlan() {
  if (!activePlanProposal()) state.planAutoOpened = null
}

function updateComposerSubmitButton() {
  const send = document.querySelector(".send")
  if (!send) return
  const startingChat = state.firstSendInFlight && !state.activeSessionId
  const abortable = threadAbortable()
  const submitting = state.promptSubmitInFlight
  const label = startingChat ? "Starting chat" : submitting ? "Sending prompt" : abortable ? "Queue prompt" : "Send"
  send.classList.toggle("disabled", startingChat || submitting || !state.promptDraft.trim())
  send.classList.toggle("pending", startingChat || submitting)
  send.dataset.action = "sendPrompt"
  send.disabled = startingChat || submitting
  send.title = label
  send.setAttribute("aria-label", label)
  send.innerHTML = startingChat || submitting ? '<span class="submit-spinner" aria-hidden="true"></span>' : icon("arrowUp")
  const stop = document.querySelector(".send-stop")
  if (stop) stop.classList.toggle("hidden", !abortable)
  const menu = document.querySelector(".send-menu")
  if (menu) menu.classList.toggle("hidden", !abortable)
}

function scheduleRefresh({ forceThreads = false } = {}) {
  scheduleRefresh.forceThreads = scheduleRefresh.forceThreads || forceThreads
  clearTimeout(scheduleRefresh.timer)
  scheduleRefresh.timer = setTimeout(() => {
    const force = Boolean(scheduleRefresh.forceThreads)
    scheduleRefresh.forceThreads = false
    refreshSessionData({ forceThreads: force }).catch(() => {})
  }, 180)
}

async function reconcileThread(sessionId) {
  const thread = state.threads.get(sessionId)
  const serverStatus = state.runtime?.sessionStatuses?.[sessionId]
  if (!thread || !needsThreadRehydration(thread, serverStatus)) return
  const [messages, pendingInputs] = await Promise.all([
    window.openworking.runtime.listMessages({ sessionId }),
    listPendingInputsForSession(sessionId)
  ])
  hydrateThread(thread, sessionId, messages, serverStatus, pendingInputs)
  applyPersistedPromptMetadataToThread(sessionId, thread)
}

async function refreshSessionData({ forceThreads = false } = {}) {
  if (state.runtime?.status !== "running" || state.runtime.project?.id !== state.activeProjectId) return
  setProjectSessions(state.activeProjectId, await window.openworking.runtime.listSessions(), "active")
  // Refresh the other expanded/pinned accordions' history (per-directory; coalesced via in-flight guard).
  await loadAllSessions()
  const activeId = state.activeSessionId
  if (activeId) loadSubagentRunTree(activeId)
  const staleIds = [...state.threads.keys()].filter((id) => (
    id && (forceThreads || needsThreadRehydration(state.threads.get(id), state.runtime?.sessionStatuses?.[id]))
  ))
  let touchedBackground = false
  let backgroundError = null
  try {
    for (const id of staleIds) {
      if (id === activeId) continue
      touchedBackground = true
      await reconcileThread(id)
    }
  } catch (error) {
    backgroundError = error
  } finally {
    if (backgroundError && touchedBackground && activeId) {
      await window.openworking.runtime.listMessages({ sessionId: activeId }).catch(() => {})
    }
  }
  if (backgroundError) throw backgroundError
  if (activeId && (forceThreads || needsThreadRehydration(state.threads.get(activeId), state.runtime?.sessionStatuses?.[activeId]))) {
    const serverStatus = state.runtime?.sessionStatuses?.[activeId]
    const [messages, pendingInputs] = await Promise.all([
      window.openworking.runtime.listMessages({ sessionId: activeId }),
      listPendingInputsForSession(activeId)
    ])
    hydrateActiveThread(messages, serverStatus, pendingInputs)
  } else if (touchedBackground && activeId) {
    // listMessages updates the runtime's active session; restore focus after background reconciles.
    await window.openworking.runtime.listMessages({ sessionId: activeId })
  }
  // Background refresh touches session lists (sidebar) and the active thread; repaint both
  // surgically instead of rebuilding the whole window.
  scheduleSidebarRender()
  scheduleThreadRender()
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

function captureSidebarScroll() {
  const sidebar = document.querySelector(".side-scroll")
  return sidebar ? sidebar.scrollTop : null
}

function restoreSidebarScroll(previous) {
  if (previous === null) return
  const sidebar = document.querySelector(".side-scroll")
  if (sidebar) sidebar.scrollTop = previous
}

// renderMarkdown / ensureMermaid / markMermaidError / renderMermaidDiagrams / scheduleMermaidRender
// now live in src/renderer/markup.js (destructured above).

function renderThreadContent({ threadScroll = "preserve" } = {}) {
  screenSessionIsland.paintThreadInto(undefined, { threadScroll })
}

function scheduleThreadRender() {
  screenSessionIsland.scheduleThreadPaint()
}

// Repaints ONLY the sidebar subtree (#sidebarRoot) in place. Clicks are delegated from #root, so
// replacing innerHTML needs no rebinding — this is O(sidebar) instead of the O(whole-DOM) full
// render() + bindEvents() rebuild. Used by sidebar-only state changes (open project, expand/
// collapse, session-list fill, pin/menu toggles, show-more).
function renderSidebarInto() {
  sidebarIsland.paintInto()
}

function scheduleSidebarRender() {
  sidebarIsland.schedulePaint()
}

// Coalesces full renders into one per animation frame. Full render() rebuilds the whole #root
// tree, so background-driven bursts (session refresh, stream reconciles) that each ask for a
// repaint would otherwise thrash the DOM. Interactive paths still call render() directly so the
// UI updates synchronously on click. Prefer scheduleSidebarRender()/scheduleThreadRender() when
// only part of the UI changed.
function scheduleRender() {
  if (scheduleRender.frame) return
  scheduleRender.frame = requestAnimationFrame(() => {
    scheduleRender.frame = null
    render()
  })
}

// Full repaint: rebuilds all of #root. Clicks/inputs are handled by the delegated #root listeners
// (installDelegatedListeners), so this NO LONGER rebinds listeners — bindEvents() now only runs the
// few imperative post-render bits (focus a rename input, size the prompt textarea). Even so, a full
// render() rebuilds the whole tree, so prefer the narrower paths when only part of the UI changed:
//   - scheduleSidebarRender() for sidebar-only changes (open project, expand/collapse, pin, menus)
//   - scheduleThreadRender() for the active thread
//   - scheduleRender() to coalesce a full repaint across a burst of background updates
function render({ threadScroll = "preserve" } = {}) {
  renderCounters.mark("full")
  const previousSidebarScroll = captureSidebarScroll()
  const previousThreadScroll = captureThreadScroll()

  // The app shell island owns all of #root (including the blocked-profile recovery branch,
  // derived inside AppShell). Its hosts persist across renders, so the sub-island paints below
  // are ticks (fine-grained patches), not remounts. Order matters: shell first (hosts), then
  // main (carries the skills-panel/thread hosts), then the rest, then the imperative
  // post-render bits that expect the DOM to be in place.
  appShellIsland.paintInto()
  sidebarIsland.paintInto()
  mainIsland.paintInto()
  promptEditorIsland.paintInto()
  promptAssistMenuIsland.paintInto()
  attachmentChipsIsland.paintInto()
  terminalDockIsland.paintInto()
  screenSkillsIsland.paintPanelInto()
  screenSessionIsland.paintThreadInto()
  modalsIsland.paintInto()
  documentViewerIsland.paintInto()
  rightFileSidebarIsland.paintInto()
  bindEvents()
  renderToast()
  scheduleMermaidRender()
  // Directory and Projects searches are reactive inside their Svelte owners.
  restoreSidebarScroll(previousSidebarScroll)
  restoreThreadScroll(previousThreadScroll, threadScroll)
  positionOnboarding()
  // Keep the live-elapsed clock in sync on any full render (session switch, hydrate,
  // initial load) — not just stream events, where the active thread may have changed.
  syncLiveClock()
}

function renderProfileRecovery() {
  const profile = state.profile || {}
  return `
    <main class="profile-recovery">
      <section class="profile-recovery-card" role="alert" aria-labelledby="profileRecoveryTitle">
        <div class="profile-recovery-icon">${icon("gear")}</div>
        <h1 id="profileRecoveryTitle">OpenWorking profile needs attention</h1>
        <p>${escapeHtml(profile.message || "The app could not initialize its local OpenCode profile.")}</p>
        ${profile.stage ? `<div class="profile-recovery-detail"><span>Stage</span><strong>${escapeHtml(profile.stage)}</strong></div>` : ""}
        ${profile.configPath ? `<div class="profile-recovery-detail"><span>Config</span><strong>${escapeHtml(profile.configPath)}</strong></div>` : ""}
        <div class="profile-recovery-actions">
          <button class="primary-btn" data-action="retryProfile" ${state.profileRetrying ? "disabled" : ""}>${state.profileRetrying ? "Retrying…" : "Retry"}</button>
          <button class="secondary-btn" data-action="openProfileFolder">Open Profile Folder</button>
        </div>
      </section>
      <div id="toastHost"></div>
    </main>
  `
}

function renderProfileRecoveryBanner() {
  if (state.profile?.status !== "recovered") return ""
  return `
    <div class="profile-recovery-banner" role="status">
      <span>${escapeHtml(state.profile.message || "The invalid OpenCode config was reset.")}</span>
      ${state.profile.backupPath ? `<code>${escapeHtml(state.profile.backupPath)}</code>` : ""}
      <button class="btn-ghost" data-action="openProfileFolder">Open Profile Folder</button>
    </div>
  `
}

// renderOnboarding / renderOnboardingDemo / positionOnboarding now live in
// src/renderer/onboarding.js (destructured above).

function paintSkillsPanel() {
  return screenSkillsIsland.paintPanelInto()
}

function paintSkillsPanelOrRender() {
  if (!paintSkillsPanel()) render()
}

function paintDocumentViewer() {
  return documentViewerIsland.paintInto()
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













function hasPinnedItems() {
  return [...state.pinnedSessions.keys()].some((sessionId) => !state.subagentSessionIds.has(sessionId)) ||
    state.projects.some((project) => project.pinned)
}




function renderMain() {
  if (state.nav === "projects") return ""
  if (state.nav === "settings" || state.nav === "config") return renderSettingsScreen()
  if (state.nav === "skills") return renderSkillsScreen()
  return renderSessionScreen()
}

function renderHeader(title, project) {
  const fileTitle = state.rightSidebarOpen ? "Close files" : "Open current folder"
  const terminalTitle = state.terminalPanelOpen ? "Close terminal" : "Open terminal"
  // `project` is only passed by the session screen (renderSessionScreen), which is the sole
  // place with a project to open in an IDE. Guard on `.id` because the Settings screen call
  // site passes a stray second argument (state.configPath, a string) that must not trigger this.
  const showIdeButton = project && project.id
  // The Files panel browses the active session's project — offering it (or leaving it open)
  // outside the session screen doesn't make sense. See closeRightSidebarForNav().
  const showFilesButton = state.nav === "session"
  // Terminal is project-scoped the same way the IDE button is (not session-scoped), so it shares
  // that button's visibility rule and sits right next to it.
  const showTerminalButton = showIdeButton
  return `
    <div class="main-head">
      <button class="head-icon-btn head-sidebar-btn" data-action="toggleSidebar" title="Show sidebar" aria-label="Show sidebar">
        ${icon("sidebarToggle")}
      </button>
      <div class="head-copy"><div class="head-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div></div>
      <div class="head-actions">
        ${showIdeButton ? renderIdeSplitButton(project) : ""}
        ${showTerminalButton ? `
        <button class="head-icon-btn ${state.terminalPanelOpen ? "active" : ""}" data-action="toggleTerminalPanel" title="${terminalTitle}" aria-label="${terminalTitle}">
          ${icon("terminal")}
        </button>` : ""}
        ${showFilesButton ? `
        <button class="head-icon-btn ${state.rightSidebarOpen ? "active" : ""}" data-action="toggleRightSidebar" title="${fileTitle}" aria-label="${fileTitle}">
          ${icon("sidebarRight")}
        </button>` : ""}
      </div>
    </div>
    ${state.diagnosticsOpen ? renderDiagnostics() : ""}
  `
}

function renderSessionScreen() {
  const project = selectedProject()
  if (!project) {
    return `<main class="main">${renderHeader("OpenWorking")}<div class="empty-state"><h1>Add a local project</h1><p>Choose a folder to start a local OpenCode session.</p><button class="primary-btn" data-action="addProject">${icon("plus")}Add project</button></div></main>`
  }
  const session = selectedSession()
  return `
    <main class="main">
      ${renderHeader(session?.title || project.name, project)}
      <div class="main-body">
        ${session ? renderThread(project) : renderNewSession(project)}
      </div>
      ${renderTerminalDock()}
    </main>
  `
}

// A VSCode-style dock below the chat (not a right-sidebar tab) — toggled from the header button
// next to the IDE split button. #terminalDockRoot is a fresh host every repaint (see
// terminalDockIsland's comment in svelte/index.js), only present while the dock is open.
function renderTerminalDock() {
  if (!state.terminalPanelOpen) return ""
  return `
    <div class="terminal-dock-resizer" data-terminal-dock-resizer title="Drag to resize"></div>
    <div class="terminal-dock" id="terminalDockRoot"></div>
  `
}

function renderNewSession(project) {
  return `
    <div class="new-session-content">
      <div class="new-session-scroll">
        <div class="new-session-hero">
          <div class="new-session-logo" aria-hidden="true">
            <img class="new-session-logo-dark" src="./assets/logo_dark.png" alt="">
            <img class="new-session-logo-light" src="./assets/logo_white.png" alt="">
          </div>
          <h1>What should we do today?</h1>
        </div>
        <div class="suggestion-grid">${chips.map((chip, index) => `
          <button class="suggestion-card" data-chip="${index}">
            ${icon(chip.icon)}
            <span>${escapeHtml(chip.text)}</span>
          </button>
        `).join("")}</div>
      </div>
      <div class="new-session-composer-dock">${renderComposer(project, true, true)}</div>
    </div>
  `
}

function renderThread(project) {
  // The thread island mounts into the empty .thread-inner right after this markup lands (see
  // the paint block in render()); the composer stays on the string path.
  return `
    <div class="thread-scroll">
      <div class="thread-inner"></div>
    </div>
    <div class="composer-dock">${renderRevertBanner()}${renderComposer(project, true)}</div>
  `
}

function activeSessionRevert() {
  return selectedSession()?.revert || null
}

function renderRevertBanner() {
  const revert = activeSessionRevert()
  if (!revert) return ""
  const draft = state.revertDraftBySession.get(state.activeSessionId)
  const fileCount = Array.isArray(revert.files) ? revert.files.length : 0
  const filePaths = (revert.files || []).map((file) => file.file).filter(Boolean)
  const messageLabel = draft?.messageCount
    ? `${draft.messageCount} message${draft.messageCount === 1 ? "" : "s"}`
    : "Conversation changes"
  return `
    <div class="revert-banner" role="status">
      <div>
        <strong>Revert staged</strong>
        <span>${escapeHtml(messageLabel)} hidden${fileCount ? ` · ${fileCount} file${fileCount === 1 ? "" : "s"} restored` : ""}</span>
        ${filePaths.length ? `<span class="revert-banner-files" title="${escapeHtml(filePaths.join("\n"))}">${filePaths.map(escapeHtml).join(" · ")}</span>` : ""}
      </div>
      <div class="revert-banner-actions">
        <button class="secondary-btn" data-action="redoSessionRevert">Redo</button>
        <button class="primary-btn" data-action="commitSessionRevert">Keep revert</button>
      </div>
    </div>
  `
}

// Tracks the turn, not the first token: hiding this on the first visible character made a long
// pause mid-answer look like the agent had stopped. A running tool still suppresses it, since
// the tool row already shows "Processing".
function shouldRenderThinkingRow(thread, status, awaiting) {
  return status.type === "busy" && !hasRunningTool(thread) && !awaiting
}

function renderThreadRows() {
  const thread = activeThread()
  const status = thread.status || { type: "idle" }
  const awaiting = pendingPrompts()
  const messageLoad = sessionMessageLoad(state.activeProjectId, state.activeSessionId)
  return `
    ${messageLoad.status === "loading" && !thread.messages.length ? '<div class="thread-load-state">Loading chat...</div>' : ""}
    ${messageLoad.status === "error" && !thread.messages.length ? `<div class="thread-load-state error"><span>Could not load this chat</span><button data-retry-session-messages="${escapeHtml(state.activeSessionId || "")}" data-project-id="${escapeHtml(messageLoad.projectId || state.activeProjectId || "")}">Retry</button></div>` : ""}
    ${renderThreadMessages(thread.messages)}
    ${shouldRenderThinkingRow(thread, status, awaiting) ? renderThinkingRow(thread) : ""}
    ${status.type === "retry" ? renderRetryRow(status) : ""}
    ${renderPendingPermissions()}
    ${renderPendingQuestions()}
    ${renderPendingForms()}
    ${renderPlanProposal()}
  `
}

function renderThreadMessages(messages) {
  const markerAfter = state.forkMarkers.get(state.activeSessionId)
  if (markerAfter === null && !messages.length) return renderForkMarker()
  return messages.map((message) => `${renderThreadMessage(message)}${message.id === markerAfter ? renderForkMarker() : ""}`).join("")
}

// Keyed [key, html] segments of the active thread, mirroring renderThreadRows() piece by piece.
// The Svelte thread island renders these in a keyed each-block, so a streaming repaint only
// replaces the DOM of segments whose html actually changed — untouched messages keep their DOM
// (and scroll anchors, rendered mermaid, selection) across paints. renderThreadRows() stays the
// legacy string path; the "thread row segments join matches renderThreadRows" test keeps the two
// orchestrations from drifting.
function threadRowSegments() {
  const thread = activeThread()
  const status = thread.status || { type: "idle" }
  const awaiting = pendingPrompts()
  const messageLoad = sessionMessageLoad(state.activeProjectId, state.activeSessionId)
  const markerAfter = state.forkMarkers.get(state.activeSessionId)
  const segments = []
  if (messageLoad.status === "loading" && !thread.messages.length) {
    segments.push(["load", '<div class="thread-load-state">Loading chat...</div>'])
  }
  if (messageLoad.status === "error" && !thread.messages.length) {
    segments.push(["load-error", `<div class="thread-load-state error"><span>Could not load this chat</span><button data-retry-session-messages="${escapeHtml(state.activeSessionId || "")}" data-project-id="${escapeHtml(messageLoad.projectId || state.activeProjectId || "")}">Retry</button></div>`])
  }
  if (markerAfter === null && !thread.messages.length) {
    segments.push(["fork:start", renderForkMarker()])
  } else {
    for (const message of thread.messages) {
      segments.push([`msg:${message.id}`, renderThreadMessage(message)])
      if (message.id === markerAfter) segments.push([`fork:${message.id}`, renderForkMarker()])
    }
  }
  if (shouldRenderThinkingRow(thread, status, awaiting)) {
    segments.push(["thinking", renderThinkingRow(thread)])
  }
  if (status.type === "retry") {
    segments.push(["retry", renderRetryRow(status)])
  }
  segments.push(["permissions", renderPendingPermissions()])
  segments.push(["questions", renderPendingQuestions()])
  segments.push(["forms", renderPendingForms()])
  segments.push(["plan-proposal", renderPlanProposal()])
  return segments
}

function renderForkMarker() {
  return `
    <div class="fork-marker" role="note" aria-label="Forked from conversation">
      <span class="fork-marker-line"></span>
      <span class="fork-marker-label">${icon("fork")}<span>Forked from conversation</span></span>
      <span class="fork-marker-line"></span>
    </div>
  `
}

// A Plan proposal is settled only after the latest assistant message itself is
// complete and the turn has no remaining runtime work. `session.idle` alone is
// insufficient because OpenCode may emit it briefly between tool steps.
function planProposalSettled(message = latestPlanMessage()) {
  if (!activePlanProposal() || !message?.stats?.completed) return false
  const thread = activeThread()
  if (threadIsBusy(thread)) return false
  if (pendingPrompts()) return false
  if (hasRunningTool(thread)) return false
  return true
}

// Whether the Reject/Revise/Accept action strip should show. The plan must have
// FINISHED streaming and the turn must be settled. Requires a plan message with
// a file ref or enough prose to be a real plan.
function planProposalReady() {
  if (!activePlanProposal()) return false
  if (state.planAccepted === state.activeSessionId) return false
  const message = latestPlanMessage()
  if (!planProposalSettled(message)) return false
  if (messageFileRefs(message)[0]) return true
  return (messageText(message) || "").trim().length >= PLAN_TEXT_MIN_LENGTH
}

function renderPlanProposal() {
  if (!planProposalReady()) return ""
  return `
    <div class="plan-proposal">
      <div class="plan-proposal-head">
        <span class="plan-proposal-dot"></span>
        <strong>Proposed a plan</strong>
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
  const forms = thread.pendingForms?.length || 0
  return questions + permissions + forms
}

function renderThreadMessage(message) {
  const actions = message.inputState ? "" : renderMessageActions(message)
  if (message.role === "user") {
    const projectFiles = selectableProjectFiles()
    const text = messageText(message, projectFiles)
    const attachments = message.parts.filter((part) => part.type === "file")
    const fileMentions = userMessageFileRefs(message, projectFiles)
    const inputStatus = renderInputStatus(message)
    return text || attachments.length || fileMentions.length
      ? `<div class="msg-user"><div class="message-stack user-message"><div class="message-card bubble">${text ? `<div>${renderPromptTokensHtml(text, fileMentions)}</div>` : ""}${renderAttachmentChips(attachments)}</div>${inputStatus}${actions}</div></div>`
      : ""
  }
  if (isPlanMessage(message)) return renderPlanCardMessage(message, actions)
  const parts = renderAssistantMessageParts(message)
  if (!parts) return ""
  const changes = renderMessageChanges(message)
  return `<div class="msg-ai"><div class="message-stack assistant-message"><div class="message-card ai-body">${parts}${changes}</div>${actions}</div></div>`
}

function renderInputStatus(message) {
  const labels = {
    submitting: "Submitting…",
    queued: `Queued${message.queuePosition ? ` #${message.queuePosition}` : ""}`,
    steering: "Steering…",
    running: "Running",
    steered: "Applied to current run",
    "delivery-unknown": "Delivery not confirmed"
  }
  const label = labels[message.inputState]
  if (!label) return ""
  const retry = message.inputState === "delivery-unknown"
    ? `<button type="button" data-retry-input="${escapeHtml(message.id)}">Retry</button>`
    : ""
  return `<div class="input-status ${escapeHtml(message.inputState)}"><span>${escapeHtml(label)}</span>${retry}</div>`
}

// Renders the plan-mode assistant reply as a single collapsible "Plan" card
// inline in the thread (replacing the raw prose + the old right-side document
// panel). The plan prose (text parts) goes in the card body; any non-text parts
// (e.g. a `todowrite` checklist) render underneath so progress stays visible.
// Collapse is CSS-only (max-height + fade mask) so the full markdown is always in
// the DOM and expand/collapse is instant with no re-render race while streaming.
function renderPlanCardMessage(message, actions) {
  const planText = (messageText(message) || "").trim()
  const otherParts = renderAssistantMessageParts(message, { excludeText: true })
  if (!planText && !otherParts) return ""
  // While the plan is still streaming, keep the card expanded so the user watches
  // it grow and hide the toggle (there is nothing settled to collapse yet). Once
  // it settles, the card collapses to a preview (the resting state) with a toggle,
  // unless the user has explicitly expanded it.
  const streaming = !planProposalSettled(message)
  const expanded = streaming || state.planCardExpanded
  const firstLine = planText.split("\n").map((line) => line.trim()).find(Boolean) || "Plan"
  const changes = renderMessageChanges(message)
  // The whole header row is the toggle (users click "the card", not just a small
  // control). While streaming the header is a static div — there is nothing to
  // collapse yet, and the click would fight the live repaint.
  const head = streaming
    ? `<div class="plan-card-head">
          <span class="plan-card-icon">${icon("ask")}</span>
          <strong class="plan-card-name">Plan</strong>
        </div>`
    : `<button type="button" class="plan-card-head" data-action="togglePlanCard" aria-expanded="${expanded}">
          <span class="plan-card-icon">${icon("ask")}</span>
          <strong class="plan-card-name">Plan</strong>
          <span class="plan-card-toggle">${expanded ? "Collapse" : "Expand"}${icon("chevDown")}</span>
        </button>`
  // While collapsed, the preview area (title + faded body) is itself a click
  // target so clicking anywhere in the card expands it. When expanded we drop the
  // handler so links/code inside the plan stay clickable and don't collapse it.
  // Keyboard activation lives on the header <button>; the preview is a mouse
  // convenience only, so it takes no role/tabindex (avoids a focusable control
  // that Enter/Space can't operate).
  const previewIsClickable = !streaming && !expanded
  const previewAttrs = previewIsClickable ? ` data-action="togglePlanCard"` : ""
  return `<div class="msg-ai"><div class="message-stack assistant-message"><div class="message-card ai-body">
      <div class="plan-card ${expanded ? "expanded" : "collapsed"}">
        ${head}
        <div class="plan-card-preview"${previewAttrs}>
          <div class="plan-card-title">${escapeHtml(firstLine)}</div>
          ${planText ? `<div class="plan-card-body assistant-text">${renderMarkdown(planText)}</div>` : ""}
          ${otherParts ? `<div class="plan-card-parts">${otherParts}</div>` : ""}
        </div>
      </div>
      ${changes}
    </div>${actions}</div></div>`
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


function artifactTypeLabel(doc) {
  const extension = String(doc.extension || fileExtension(doc.path || doc.requestedPath || "")).replace(/^\./, "").toUpperCase()
  if (extension) return extension
  return doc.mime || "Artifact"
}



function ipcErrorMessage(error) {
  return String(error?.message || error || "").replace(/^Error invoking remote method '[^']+': Error: /, "")
}

// Finds the most recent diff produced for `filePath` across the active thread's
// messages, so opening a file can default to its Diff tab. Reuses collectMessageDiffs.
function findDiffForPath(filePath) {
  if (!filePath) return null
  let found = null
  for (const message of activeThread().messages || []) {
    for (const entry of collectMessageDiffs(message)) {
      if (entry.filepath === filePath || entry.fileKey === filePath) found = entry.diff
    }
  }
  return found
}

async function openDocument(filePath, { diff = null, tab = null } = {}) {
  if (!filePath) return
  const project = selectedProject()
  if (!project) return
  const renderMode = isMarkdownFilePath(filePath) ? "markdown" : "code"
  const resolvedDiff = diff || findDiffForPath(filePath)
  const resolvedTab = tab || (resolvedDiff ? "diff" : "code")
  showDocument({ requestedPath: filePath, path: filePath, name: filename(filePath), relativePath: "", content: "", loading: true, error: "", renderMode, diff: resolvedDiff, tab: resolvedTab })
  try {
    const doc = await window.openworking.files.read(filePath, selectedProjectContext(project))
    if (state.document?.requestedPath !== filePath) return
    state.document = { requestedPath: filePath, ...doc, loading: false, error: "", renderMode, diff: resolvedDiff, tab: resolvedTab }
  } catch (error) {
    if (state.document?.requestedPath !== filePath) return
    state.document = { requestedPath: filePath, path: filePath, name: filename(filePath), relativePath: "", content: "", loading: false, error: error.message, renderMode, diff: resolvedDiff, tab: resolvedTab }
  }
  if (!paintDocumentViewer()) render()
}

function switchDocumentTab(tab) {
  if (!state.document || (tab !== "diff" && tab !== "code")) return
  if (state.document.tab === tab) return
  state.document.tab = tab
  if (!paintDocumentViewer()) render()
}

// Preview/Raw toggle for a markdown document, independent of the Diff/Code tab above - switching
// view always steps out of the diff (tab: "code") so the markdown body itself is what's showing.
function switchMarkdownView(view) {
  if (!state.document || (view !== "preview" && view !== "raw")) return
  if (state.document.tab === "code" && state.document.mdView === view) return
  state.document.tab = "code"
  state.document.mdView = view
  if (!paintDocumentViewer()) render()
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

// Drives a one-shot open transition via a state flag rather than an imperative classList
// mutation — AppShell.svelte's `.app` class is fully derived from state on every render(), so a
// class added outside that derivation gets wiped by the next unrelated render() before its CSS
// transition finishes (visible as a jump/snap). Keeping the flag in state means it survives ticks.
function startPanelOpenTransition(flagName) {
  state[flagName] = true
  render()
  requestAnimationFrame(() => {
    state[flagName] = false
    render()
  })
}

function showDocument(document) {
  const opening = !state.document
  state.document = document
  render()
  if (opening) startPanelOpenTransition("documentPreopen")
}

function closeDocument() {
  if (!state.document) return
  state.documentClosing = true
  render()
  afterTransitionOrTimeout(appElement(), () => {
    state.documentClosing = false
    state.document = null
    render()
  })
}

// Character offset of (targetNode, targetOffset) within root's flattened text. Walking text
// nodes (not DOM siblings) keeps this aligned with plain-text doc.content regardless of how
// highlight.js's <span> markup splits it.
function textOffsetWithinElement(root, targetNode, targetOffset) {
  let total = 0
  let found = false
  let result = 0
  const walk = (node) => {
    if (found) return
    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        result = total + Math.min(targetOffset, (node.textContent || "").length)
      } else {
        let childTotal = 0
        for (let index = 0; index < targetOffset && index < node.childNodes.length; index += 1) {
          childTotal += (node.childNodes[index].textContent || "").length
        }
        result = total + childTotal
      }
      found = true
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += (node.textContent || "").length
      return
    }
    for (const child of node.childNodes) {
      walk(child)
      if (found) return
    }
  }
  walk(root)
  return found ? result : total
}

function lineAtContentOffset(content, offset) {
  return content.slice(0, Math.max(0, offset)).split("\n").length
}

// Maps a DOM selection inside <pre class="doc-code"> to 1-based {startLine, endLine}; null for
// an empty selection or one outside preElement. A Range's end is "one past" the last included
// char, so endOffset steps back one before counting lines - else crossing into the next line's
// start would over-report an extra selected line.
function selectionLineRange(preElement, range, content) {
  if (!preElement || !range || range.collapsed) return null
  if (!preElement.contains(range.startContainer) || !preElement.contains(range.endContainer)) return null
  const text = String(content || "")
  const startOffset = textOffsetWithinElement(preElement, range.startContainer, range.startOffset)
  const endOffsetRaw = textOffsetWithinElement(preElement, range.endContainer, range.endOffset)
  const endOffset = Math.max(startOffset, endOffsetRaw - 1)
  return {
    startLine: lineAtContentOffset(text, startOffset),
    endLine: lineAtContentOffset(text, endOffset)
  }
}

// Reverse of textOffsetWithinElement: resolves root's SORTED flat text offsets (findTextMatches'
// {start, end} pairs already come out in order) to their {node, offset} in ONE walk of root,
// instead of one walk per offset - re-walking the whole tree per match was O(matches x content
// length) and visibly stalled typing in the search box on larger files.
function nodeAtTextOffsets(root, sortedOffsets) {
  const results = new Array(sortedOffsets.length)
  let index = 0
  let consumed = 0
  let lastTextNode = null
  const walk = (node) => {
    if (index >= sortedOffsets.length) return
    if (node.nodeType === Node.TEXT_NODE) {
      lastTextNode = node
      const length = (node.textContent || "").length
      while (index < sortedOffsets.length && sortedOffsets[index] <= consumed + length) {
        results[index] = { node, offset: Math.max(0, sortedOffsets[index] - consumed) }
        index++
      }
      consumed += length
      return
    }
    for (const child of node.childNodes) {
      walk(child)
      if (index >= sortedOffsets.length) return
    }
  }
  walk(root)
  // Any offsets beyond the end of root's text (or an empty root) clamp to the very end.
  const fallback = lastTextNode ? { node: lastTextNode, offset: (lastTextNode.textContent || "").length } : { node: root, offset: 0 }
  while (index < sortedOffsets.length) results[index++] = fallback
  return results
}

// Every non-overlapping, case-insensitive occurrence of query in content, as flat {start, end}
// offsets in order. Scanning resumes from a match's end (not its start), so overlaps are never
// double-counted. Returns [] for an empty query rather than matching everywhere.
function findTextMatches(content, query) {
  const text = String(content || "")
  const needle = String(query || "")
  if (!needle) return []
  const haystack = text.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  const matches = []
  let searchFrom = 0
  while (searchFrom <= haystack.length) {
    const index = haystack.indexOf(lowerNeedle, searchFrom)
    if (index === -1) break
    matches.push({ start: index, end: index + needle.length })
    searchFrom = index + needle.length
  }
  return matches
}

// Bridges plain-text search (findTextMatches) to real DOM Ranges for the CSS Custom Highlight
// API, resolving every match's start/end in one nodeAtTextOffsets walk instead of one per match -
// what made typing in the search box freeze on larger files.
function buildMatchRanges(root, content, query) {
  const matches = findTextMatches(content, query)
  if (!matches.length) return []
  const boundaries = []
  for (const { start, end } of matches) boundaries.push(start, end)
  const resolved = nodeAtTextOffsets(root, boundaries)
  const ranges = []
  for (let i = 0; i < matches.length; i++) {
    const from = resolved[i * 2]
    const to = resolved[i * 2 + 1]
    const range = document.createRange()
    range.setStart(from.node, from.offset)
    range.setEnd(to.node, to.offset)
    ranges.push(range)
  }
  return ranges
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed
  syncSidebarCollapsedDom()
}

// The Files panel browses the active session's project — it only makes sense on the session
// screen (including its "new session" init state, also nav "session"). Call this right after
// changing state.nav elsewhere so a panel left open doesn't linger over unrelated screens; closes
// with the same animation as the toggle button instead of vanishing instantly.
function closeRightSidebarForNav() {
  if (state.nav === "session" || !state.rightSidebarOpen || state.rightSidebarClosing) return
  state.rightSidebarClosing = true
  afterTransitionOrTimeout(appElement(), () => {
    state.rightSidebarClosing = false
    state.rightSidebarOpen = false
    render()
  })
}

async function toggleRightSidebar() {
  if (state.rightSidebarOpen) {
    state.rightSidebarClosing = true
    render()
    afterTransitionOrTimeout(appElement(), () => {
      state.rightSidebarClosing = false
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
  startPanelOpenTransition("rightSidebarPreopen")
  if (state.rightSidebarTab === "changes") await loadVcsStatus()
  else await loadFileTreeDirectory("")
}

// Only meaningful with both Files and Code open (the toggle is hidden otherwise) - switches
// side-by-side (default) for stacked (Files on top, Code below). Persisted like the panel widths.
// The stacked Files-above-Code layout only exists while a document shares the column: its CSS is
// scoped to `.app.has-doc.right-open.stacked-right`. Anything choosing behaviour by layout must ask
// this, not the raw flag, which stays on after the document closes.
function stackedRightPanelsActive() {
  return Boolean(state.stackedRightPanels && state.document)
}

function toggleStackedRightPanels() {
  state.stackedRightPanels = !state.stackedRightPanels
  localStorage.setItem(STACKED_RIGHT_MODE_KEY, state.stackedRightPanels ? "1" : "0")
  render()
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
    const listing = await window.openworking.files.list({ directoryPath: key, ...selectedProjectContext(project) })
    if (state.fileTreeProjectId !== project.id) return
    state.fileTreeChildren.set(listing.path || "", listing.children || [])
  } catch (error) {
    state.fileTreeError = error.message || "Could not load files."
  } finally {
    state.fileTreeLoading.delete(key)
    render()
  }
}

// Debounced search across the whole project via GET /api/fs/find (server-side scope/ignore
// rules), used by the Files tab's search box as an alternative to browsing the tree by hand.
// A blank query clears results immediately rather than waiting out the debounce.
function searchProjectFiles(query) {
  state.fileSearchQuery = query
  clearTimeout(searchProjectFiles.timer)
  if (!query.trim()) {
    state.fileSearchResults = []
    state.fileSearchLoading = false
    state.fileSearchError = ""
    render()
    return
  }
  state.fileSearchLoading = true
  render()
  searchProjectFiles.timer = setTimeout(async () => {
    const project = selectedProject()
    const context = selectedProjectContext(project)
    if (!context) return
    try {
      const results = await window.openworking.fs.find(query, { limit: 100 }, context)
      if (state.fileSearchQuery !== query) return
      state.fileSearchResults = results
      state.fileSearchError = ""
    } catch (error) {
      if (state.fileSearchQuery !== query) return
      state.fileSearchError = error.message || "Search failed."
    } finally {
      if (state.fileSearchQuery === query) state.fileSearchLoading = false
      render()
    }
  }, 200)
}

// --- VCS Changes panel -----------------------------------------------------------------------
// The panel lists working-copy status only; a file's patch is fetched lazily when the user opens
// that row, so a huge diff can never stall the list itself.

function resetVcsState(projectId = null) {
  state.vcsProjectId = projectId
  state.vcsFiles = []
  state.vcsError = ""
  state.vcsTruncated = false
}

async function loadVcsStatus() {
  const project = selectedProject()
  if (!project) {
    resetVcsState(null)
    render()
    return
  }
  if (state.vcsProjectId !== project.id) resetVcsState(project.id)
  state.vcsLoading = true
  state.vcsError = ""
  render()
  try {
    const result = await window.openworking.vcs.status(project.id, selectedProjectContext(project))
    // The user may have switched project while this was in flight; a late reply must not paint
    // one project's changes into another's panel.
    if (selectedProject()?.id !== project.id) return
    state.vcsProjectId = project.id
    state.vcsFiles = Array.isArray(result?.files) ? result.files : []
    state.vcsTruncated = Boolean(result?.truncated)
  } catch (error) {
    if (selectedProject()?.id !== project.id) return
    state.vcsError = ipcErrorMessage(error) || "Could not load changes."
  } finally {
    if (selectedProject()?.id === project.id) {
      state.vcsLoading = false
      render()
    }
  }
}

// Refresh triggers fire in bursts (a finished agent turn touches many files, and window focus can
// coincide with an idle event), so coalesce them into one request.
let vcsRefreshTimer = null
function scheduleVcsRefresh() {
  if (!state.rightSidebarOpen || state.rightSidebarTab !== "changes") return
  if (vcsRefreshTimer) clearTimeout(vcsRefreshTimer)
  vcsRefreshTimer = setTimeout(() => {
    vcsRefreshTimer = null
    loadVcsStatus().catch(() => {})
  }, 300)
}

async function openVcsDiff(file) {
  if (!file) return
  const project = selectedProject()
  if (!project) return
  try {
    const result = await window.openworking.vcs.diff(project.id, file, selectedProjectContext(project))
    // A deleted file has no contents to read, so route it straight to the diff rather than
    // letting openDocument try (and fail) to load the file body.
    const entry = state.vcsFiles.find((item) => item.file === file)
    if (entry?.status === "deleted") {
      showDocument({
        requestedPath: file, path: file, name: filename(file), relativePath: file,
        content: "", loading: false, error: "", renderMode: "code",
        diff: result?.patch || "", tab: "diff"
      })
      if (!paintDocumentViewer()) render()
      return
    }
    await openDocument(file, { diff: result?.patch || null, tab: "diff" })
  } catch (error) {
    showToast(ipcErrorMessage(error) || "Could not load diff.")
  }
}

async function selectRightSidebarTab(tab) {
  const next = tab === "changes" ? "changes" : "files"
  if (state.rightSidebarTab === next) return
  state.rightSidebarTab = next
  render()
  if (next === "changes") await loadVcsStatus()
  else await loadFileTreeDirectory("")
}

function toggleTerminalPanel() {
  state.terminalPanelOpen = !state.terminalPanelOpen
  render()
  // Opening is the point where this project's remembered shell should come back; closing detaches
  // it so no socket is held for a dock nobody is looking at.
  if (state.terminalPanelOpen) {
    // The stored height was clamped against whatever the window was last time. Re-clamp now that
    // the dock is in the DOM and maxTerminalDockHeight() can measure the real budget.
    setTerminalDockHeight(terminalDockHeightForResize())
    syncTerminalForActiveProject()
  } else detachAttachedTerminal()
}

// Whether the dock should currently render a live terminal, i.e. the attached pty is this
// project's. Projects with a remembered-but-detached shell answer false here until
// syncTerminalForActiveProject() has reattached them.
function terminalBelongsToActiveProject() {
  return Boolean(state.terminalPtyId) && state.terminalProjectId === state.activeProjectId
}

// Shells kept alive across project switches are real processes on the runtime, so the registry
// cannot grow without bound — hold at most this many, closing the least recently attached.
const MAX_REMEMBERED_TERMINALS = 5

// Ends a shell belonging to a project that is NOT the active one, so the context is built from the
// project id alone: selectedProjectContext() reads selectedSession(), which belongs to whatever
// project is on screen and would hand main a directory from the wrong project. With no directory,
// main resolves the project's own effective path (resolveProjectContext in main.js).
function closeRememberedTerminal(ptyId, projectId) {
  window.openworking.pty.disconnect(ptyId).catch(() => {})
  window.openworking.pty.remove(ptyId, { projectId }).catch(() => {})
}

// Records a project's shell and enforces the cap. Re-inserting on every attach (not just on
// create) is what makes Map's insertion order an LRU order, so the entry evicted first is the one
// whose terminal the user has gone longest without looking at. Evicted shells are CLOSED, not just
// forgotten — forgetting is exactly what stranded them before this registry existed.
function rememberTerminal(projectId, ptyId) {
  state.terminalPtyByProject.delete(projectId)
  state.terminalPtyByProject.set(projectId, ptyId)
  while (state.terminalPtyByProject.size > MAX_REMEMBERED_TERMINALS) {
    const [oldestProjectId, oldestPtyId] = state.terminalPtyByProject.entries().next().value
    // The attached terminal was just touched, so it sorts last and cannot be the oldest here.
    // Bail rather than skip anyway: closing the shell the user is typing into is the one outcome
    // this cap must never produce, and `break` also keeps the loop from spinning forever.
    if (oldestProjectId === state.terminalProjectId) break
    state.terminalPtyByProject.delete(oldestProjectId)
    closeRememberedTerminal(oldestPtyId, oldestProjectId)
  }
}

// Drops the socket for the attached terminal WITHOUT removing the pty: the shell keeps running on
// the runtime so the project it belongs to can pick it back up later. Closing for real (removePty)
// only happens through closeTerminal().
// Returns whether it actually tore an attachment down, so callers can skip a repaint when
// nothing changed.
function detachAttachedTerminal() {
  const ptyId = state.terminalPtyId
  if (!ptyId) return false
  state.terminalPtyId = null
  state.terminalProjectId = null
  state.terminalStatus = "idle"
  state.terminalError = null
  window.openworking.pty.disconnect(ptyId).catch(() => {})
  return true
}

// Called from every project-switch entry point and when the dock is opened. Detaches whatever
// belongs to the project being left, then reattaches this project's remembered shell if the dock
// is actually open — nothing is connected for a dock the user cannot see.
async function syncTerminalForActiveProject() {
  if (state.terminalPtyId && state.terminalProjectId === state.activeProjectId) return
  const detached = detachAttachedTerminal()
  const project = selectedProject()
  // Nothing to repaint when the panel is closed and no attached terminal was torn down —
  // selectSession already painted, and a second full render would undo its thread-scroll intent.
  if (!state.terminalPanelOpen || !project) {
    if (detached) render()
    return
  }
  const context = selectedProjectContext(project)
  let ptyId = state.terminalPtyByProject.get(project.id)
  if (!ptyId) {
    // Nothing remembered in this renderer session, but the runtime may still be running a shell
    // for this project from before a renderer reload — adopt it rather than stranding it and
    // spawning a second one. Failure here is not interesting: it just means "no terminal yet".
    const running = await window.openworking.pty.list(context).catch(() => [])
    ptyId = running.find((pty) => pty.status !== "exited")?.id
    if (!ptyId) { render(); return }
  }
  state.terminalPtyId = ptyId
  state.terminalProjectId = project.id
  // After claiming the slot, never before: rememberTerminal refuses to evict state.terminalProjectId,
  // and that guard is only meaningful once this attachment is the one it is protecting. Doubles as
  // an LRU touch, so the cap evicts by "longest untouched" rather than by when it was opened.
  rememberTerminal(project.id, ptyId)
  state.terminalStatus = "connecting"
  render()
  try {
    await window.openworking.pty.connect(ptyId, context)
    // The runtime replays nothing on connect (same caveat reconnectTerminal documents), so the
    // shell is alive but the buffer is empty. Say that outright — a blank panel after switching
    // back reads as "my terminal is gone" otherwise.
    terminalBridge.write?.("\r\n\x1b[90m--- reattached, scrollback not restored (press Enter for a prompt) ---\x1b[0m\r\n")
  } catch {
    // The shell died while we were away (or the runtime restarted). Forget it so the panel offers
    // a clean "Open Terminal" instead of retrying a pty that no longer exists.
    state.terminalPtyByProject.delete(project.id)
    state.terminalPtyId = null
    state.terminalProjectId = null
    state.terminalStatus = "idle"
    render()
  }
}

function openTerminalConfirm() {
  if (!selectedProject()) return
  state.terminalConfirmOpen = true
  render()
}

function closeTerminalConfirm() {
  state.terminalConfirmOpen = false
  render()
}

async function confirmOpenTerminal() {
  // Guards against a rapid double-click on "Open Terminal" (or the confirm modal's Open button)
  // spawning two shells — the modal closes on the very first click, but the async create/connect
  // round-trip leaves a window where a second click event could otherwise re-enter this function.
  if (state.terminalStatus === "creating" || state.terminalStatus === "connecting") return
  const project = selectedProject()
  if (!project) { closeTerminalConfirm(); return }
  state.terminalConfirmOpen = false
  state.terminalStatus = "creating"
  state.terminalError = null
  render()
  try {
    const context = selectedProjectContext(project)
    const pty = await window.openworking.pty.create({}, context)
    state.terminalPtyId = pty.id
    state.terminalProjectId = project.id
    rememberTerminal(project.id, pty.id)   // after the slot is claimed — see the note in syncTerminalForActiveProject
    state.terminalStatus = "connecting"
    render()
    await window.openworking.pty.connect(pty.id, context)
    // Flips to "connected" once the pty.connected stream event arrives (handleRuntimeStream).
  } catch (error) {
    state.terminalStatus = "idle"
    state.terminalPtyId = null
    state.terminalProjectId = null
    state.terminalError = error?.message || "Failed to open terminal."
    render()
  }
}

async function reconnectTerminal() {
  const project = selectedProject()
  if (!project || !state.terminalPtyId || !terminalBelongsToActiveProject()) return
  state.terminalStatus = "connecting"
  state.terminalError = null
  render()
  // The server never replays history to a reconnecting socket — mark the gap visibly in the
  // live xterm buffer instead of silently resuming as if nothing happened.
  terminalBridge.write?.("\r\n\x1b[90m--- reconnecting ---\x1b[0m\r\n")
  try {
    await window.openworking.pty.connect(state.terminalPtyId, selectedProjectContext(project))
  } catch (error) {
    state.terminalStatus = "lost"
    state.terminalError = error?.message || "Failed to reconnect."
    render()
  }
}

// Called directly from the mounted xterm.js instance's onData/resize handlers (not through
// ctx.actions.click) — these fire on every keystroke and on every panel resize, far too often to
// route through the delegated action-dispatch table built for discrete button clicks.
function writeToTerminal(data) {
  if (!state.terminalPtyId || !terminalBelongsToActiveProject()) return
  window.openworking.pty.write(state.terminalPtyId, data)
}

function resizeTerminal(rows, cols) {
  const project = selectedProject()
  if (!project || !state.terminalPtyId || !terminalBelongsToActiveProject()) return
  window.openworking.pty.resize(state.terminalPtyId, { rows, cols }, selectedProjectContext(project)).catch(() => {})
}

async function closeTerminal() {
  const ptyId = state.terminalPtyId
  const project = selectedProject()
  // The only path that really ends a shell, so it is also the only one that forgets it — a plain
  // project switch deliberately keeps the entry so the shell can be reattached (see
  // syncTerminalForActiveProject).
  if (state.terminalProjectId) state.terminalPtyByProject.delete(state.terminalProjectId)
  state.terminalPtyId = null
  state.terminalProjectId = null
  state.terminalStatus = "idle"
  state.terminalError = null
  render()
  if (!ptyId) return
  try { await window.openworking.pty.disconnect(ptyId) } catch { /* best-effort */ }
  if (project) {
    try { await window.openworking.pty.remove(ptyId, selectedProjectContext(project)) } catch { /* best-effort */ }
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

// "251.3k" / "1.2M" / raw for < 1000.
function formatTokenCount(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// Below 60% is comfortable (green), 60-84% is worth noticing (amber), 85%+ is close to
// the limit (red) — shared by the composer's trigger ring and the popup so they never drift.
function contextThresholdColor(pct) {
  if (pct >= 85) return "var(--red)"
  if (pct >= 60) return "var(--amber)"
  return "var(--green)"
}

// Small donut-progress ring for the context-window indicator: a muted track circle plus
// a threshold-colored arc drawn via stroke-dasharray/stroke-dashoffset, rotated so the arc
// starts at 12 o'clock. Not one of util.js's static icons — this one is generated per pct.
const CONTEXT_RING_RADIUS = 9
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS
function renderContextRing(pct) {
  const clamped = Math.max(0, Math.min(100, pct))
  const offset = CONTEXT_RING_CIRCUMFERENCE * (1 - clamped / 100)
  const color = contextThresholdColor(clamped)
  return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="${CONTEXT_RING_RADIUS}" fill="none" stroke="var(--border)" stroke-width="2.5"/><circle cx="12" cy="12" r="${CONTEXT_RING_RADIUS}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${CONTEXT_RING_CIRCUMFERENCE}" stroke-dashoffset="${offset}" transform="rotate(-90 12 12)"/></svg>`
}

// Context window usage for the composer indicator: used = inputTokens of the most recent
// assistant message (the full conversation sent as context for that turn), total = the
// active model's declared context limit. Returns null (hide the indicator) when either is
// missing — a fresh thread with no assistant reply yet, or a model with no declared limit.
function contextWindowUsage(thread, model) {
  const total = model?.contextLimit
  if (!thread || !total) return null
  for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
    const message = thread.messages[i]
    if (message.role === "assistant" && message.stats?.inputTokens) {
      const used = message.stats.inputTokens
      return { used, total, pct: Math.min(100, Math.round((used / total) * 100)) }
    }
  }
  return null
}

// Composer context-ring source. The thread's own stats (contextWindowUsage) are ground truth for
// the tokens the model actually saw on ITS most recent turn — but right after a compaction ends,
// that "most recent turn" is still the one from BEFORE compaction ran, so its inputTokens is a
// stale, pre-compaction number that must not be shown as current.
//  - compaction.freshAfter (set in applyRuntimeStreamEvent) is the thread's message count at the
//    instant compaction finished. Once the thread grows past it, a real new turn has landed and
//    the thread's own stats are trustworthy again — this is what lets the ring recover on its own
//    without anything else having to reset compactionStatuses (nothing else does).
//  - Until then, prefer GET /api/session/{id}/context (fetched once by refreshSessionContextUsage)
//    for the true post-compaction count, falling back to a stale placeholder while that request is
//    still in flight.
function resolveContextUsage(compaction, model) {
  const thread = activeThread()
  const freshAfter = compaction?.freshAfter
  const isFresh = typeof freshAfter === "number" && (thread?.messages?.length || 0) > freshAfter
  if (compaction?.status !== "ended" || isFresh) return contextWindowUsage(thread, model)
  if (!model?.contextLimit) return null
  const fetched = state.runtime?.sessionContextUsage?.[state.activeSessionId]
  if (typeof fetched !== "number") return { used: null, total: model.contextLimit, pct: null, stale: true }
  const total = model.contextLimit
  return { used: fetched, total, pct: Math.min(100, Math.round((fetched / total) * 100)) }
}

function assistantMessageActionsSettled() {
  const thread = activeThread()
  if (threadIsBusy(thread)) return false
  if (pendingPrompts()) return false
  if (hasRunningTool(thread)) return false
  return true
}

function renderMessageActions(message) {
  const copyText = messageCopyText(message)
  if (message.role === "assistant") {
    if (!copyText) return ""
    // A completed step/message is not necessarily a completed agent execution. Hide actions for
    // every assistant message while the active thread still has runtime work or a blocker, then
    // restore them once the whole turn settles.
    if (!message.stats?.completed || !assistantMessageActionsSettled()) return ""
    return `<div class="message-actions message-actions-left"><button class="message-action" data-copy-message="${escapeHtml(message.id)}" title="Copy message" aria-label="Copy message">${icon("copy")}</button><button class="message-action" data-fork-message="${escapeHtml(message.id)}" title="Fork chat" aria-label="Fork chat">${icon("fork")}</button></div>`
  }
  if (!copyText) return ""
  const revertDisabled = !sessionRevertAvailable(state.activeSessionId)
  return `<div class="message-actions"><button class="message-action ${revertDisabled ? "disabled" : ""}" data-revert-message="${escapeHtml(message.id)}" title="${revertDisabled ? "Wait for the response to finish" : "Revert to here"}" aria-label="Revert to here" ${revertDisabled ? "disabled" : ""}>${icon("fork")}</button><button class="message-action" data-copy-message="${escapeHtml(message.id)}" title="Copy message" aria-label="Copy message">${icon("copy")}</button></div>`
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

// OpenCode calls this wire part `reasoning`, but it is the agent's streamed progress:
// status narration emitted around tool activity, independent of the selected model
// reasoning effort. Live parts stay expanded; settled turns group them below.
function renderReasoningRow(part) {
  if (!String(part.text || "").trim()) return ""
  return `
    <div class="reasoning-block">
      <div class="reasoning-text assistant-text">${renderMarkdown(part.text)}</div>
    </div>
  `
}

function agentProgressParts(message) {
  return message.parts.filter((part) => (
    part.type === "reasoning" &&
    Boolean(String(part.text || "").trim())
  ))
}

function renderAgentProgressCard(message, progressParts) {
  const expanded = state.agentProgressExpanded.has(message.id)
  const count = progressParts.length
  return `
    <div class="agent-progress-card ${expanded ? "expanded" : "collapsed"}">
      <button type="button" class="agent-progress-head" data-action="toggleAgentProgress" data-progress-message="${escapeHtml(message.id)}" aria-expanded="${expanded}">
        <span class="agent-progress-icon">${icon("activity")}</span>
        <strong>Agent progress</strong>
        <span class="agent-progress-count">· ${count} ${count === 1 ? "update" : "updates"}</span>
        <span class="agent-progress-chevron">${icon("chevDown")}</span>
      </button>
      <div class="agent-progress-body"${expanded ? "" : " hidden"}>
        ${progressParts.map(renderReasoningRow).join("")}
      </div>
    </div>
  `
}

function renderAssistantMessageParts(message, { excludeText = false } = {}) {
  const progressParts = agentProgressParts(message)
  const groupProgress = Boolean(message.stats?.completed && progressParts.length)
  let progressRendered = false
  return message.parts.map((part) => {
    if (excludeText && part.type === "text") return ""
    if (part.type !== "reasoning") return renderAssistantPart(part)
    if (!String(part.text || "").trim()) return ""
    if (!groupProgress) return renderReasoningRow(part)
    if (progressRendered) return ""
    progressRendered = true
    return renderAgentProgressCard(message, progressParts)
  }).join("")
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

function canonicalToken(label, path) {
  return `[${String(label || "")}](${String(path || "")})`
}

function normalizeComparablePath(value) {
  return String(value || "").trim().replace(/\\/g, "/")
}

function skillFamilySuffix(family, label) {
  const trimmedLabel = String(label || "").trim()
  if (family === "managed_profile") return `/opencode-profile/skills/${trimmedLabel}/SKILL.md`
  if (family === "repo_agents" || family === "home_agents") return `/.agents/skills/${trimmedLabel}/SKILL.md`
  if (family === "repo_opencode" || family === "home_opencode") return `/.opencode/skills/${trimmedLabel}/SKILL.md`
  if (family === "repo_config_opencode" || family === "home_config_opencode") return `/.config/opencode/skills/${trimmedLabel}/SKILL.md`
  return ""
}

function isKnownSkillTokenPath(normalizedPath, label, command) {
  const commandPath = normalizeComparablePath(command?.path || "")
  if (!commandPath) return false
  if (normalizedPath !== commandPath) return false
  const commandFamily = String(command?.locationFamily || "")
  if (commandFamily) return commandPath.endsWith(skillFamilySuffix(commandFamily, label))
  return [
    "managed_profile",
    "repo_agents",
    "repo_opencode",
    "repo_config_opencode"
  ].some((family) => commandPath.endsWith(skillFamilySuffix(family, label)))
}

// Parses an optional ":N" / ":N-M" line-range suffix off a file token's label (e.g. "app.js:12-24"),
// so tokenKindForPath can accept snippet labels and applyPendingFileMentions can carry the range
// into the serialized prompt. Null when there's no such suffix; callers fall back to the exact-
// basename check.
function fileMentionLineRange(label, base) {
  const trimmedLabel = String(label || "").trim()
  const prefix = `${base}:`
  if (!base || trimmedLabel === base || !trimmedLabel.startsWith(prefix)) return null
  const match = /^(\d+)(?:-(\d+))?$/.exec(trimmedLabel.slice(prefix.length))
  if (!match) return null
  const start = Number(match[1])
  const end = match[2] !== undefined ? Number(match[2]) : start
  if (start < 1 || end < start) return null
  return { start, end }
}

function tokenKindForPath(path, label = "") {
  const value = String(path || "").trim()
  const normalized = normalizeComparablePath(value)
  const command = findCommand(label)
  if (!value) return null
  if (/^commands\/[\w-]+$/.test(value)) return null
  if (/(^|\/)opencode-profile\/commands\/[^/]+$/i.test(normalized)) {
    const commandPath = normalizeComparablePath(command?.path || "")
    return command?.source === "command" && commandPath === normalized ? "command" : null
  }
  if (command?.source === "skill") {
    if (isKnownSkillTokenPath(normalized, label, command)) return "skill"
  }
  const base = filename(value)
  const trimmedLabel = String(label || "").trim()
  const isPlainFileLabel = base && trimmedLabel === base
  const isSnippetFileLabel = base && Boolean(fileMentionLineRange(label, base))
  if (/^(?!https?:\/\/)(?!mailto:)(?!#).+/.test(value) && (isPlainFileLabel || isSnippetFileLabel)) {
    return "file"
  }
  return null
}

function parsePromptTokens(text) {
  const input = String(text || "")
  const tokens = []
  const pattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g
  let cursor = 0
  let match = null

  while ((match = pattern.exec(input))) {
    if (match.index > cursor) tokens.push({ type: "text", text: input.slice(cursor, match.index) })
    const [, label, path] = match
    const kind = tokenKindForPath(path, label)
    if (kind) tokens.push({ type: "token", kind, label, path, raw: match[0] })
    else tokens.push({ type: "text", text: match[0] })
    cursor = match.index + match[0].length
  }
  if (cursor < input.length) tokens.push({ type: "text", text: input.slice(cursor) })
  return tokens
}

function promptTitleText(promptText) {
  return parsePromptTokens(promptText).map((part) => (part.type === "token" ? part.label : part.text).trim()).join(" ").trim()
}

function renderCanonicalToken(token) {
  const modifier = token.kind === "skill" || token.kind === "command" ? ` ${token.kind}-token` : ""
  const iconName = TOKEN_KINDS[token.kind] || ""
  return `<span class="file-mention-token${modifier}" contenteditable="false" title="${escapeHtml(token.path)}" data-token-kind="${escapeHtml(token.kind)}" data-token-raw="${escapeHtml(token.raw)}">${icon(iconName)}<span>${escapeHtml(token.label)}</span></span>`
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

function renderPromptTokensHtml(text, fileMentions = []) {
  const prompt = String(text || "")
  const parts = parsePromptTokens(prompt)
  const liveMentions = livePendingFileMentions(prompt, fileMentions)
  if (parts.some((part) => part.type === "token")) {
    return parts.map((part) => {
      if (part.type === "text") return renderTextWithFileMentions(part.text, liveMentions)
      return renderCanonicalToken(part)
    }).join("")
  }
  if (liveMentions.length) return renderTextWithFileMentions(prompt, liveMentions)
  return escapeHtml(prompt).replaceAll("\n", "<br>")
}

function renderPromptOverlayHtml(promptText, fileMentions = []) {
  return renderPromptTokensHtml(promptText, fileMentions)
}

function replaceComposerQuery({ text, caret, trigger, label, path, source }) {
  const value = String(text || "")
  const beforeCaret = value.slice(0, caret)
  const pattern = trigger === "file"
    ? /(^|\s)@([^\s@]*)$/
    : /(^|\s)\/([\w-]*)$/
  const replacement = trigger === "file"
    ? canonicalToken(label, path)
    : canonicalToken(label, path)
  const replaced = beforeCaret.replace(pattern, `$1${replacement}`)
  return {
    text: `${replaced}${value.slice(caret)}`,
    caret: replaced.length
  }
}

function commandTokenPath(command) {
  if (!command) return ""
  if (command.source === "skill" || command.source === "command") return String(command.path || "").trim()
  return ""
}

function leadingCommandToken(promptText) {
  const prompt = String(promptText || "").trim()
  if (!prompt) return null
  const commandMatch = prompt.match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/)
  const slashCommand = commandMatch ? findCommand(commandMatch[1]) : null
  if (commandMatch && slashCommand) {
    // Raw slash input must preserve the same selected metadata as a menu-inserted token while
    // still routing by catalog source: commands use /command, skills use /skill then /prompt.
    const args = commandMatch[2] || ""
    const raw = `/${slashCommand.name}`
    const tokenMeta = {
      label: slashCommand.name,
      path: commandTokenPath(slashCommand),
      raw,
      args
    }
    return {
      command: slashCommand.source === "command" ? slashCommand.name : null,
      skill: slashCommand.source === "skill" ? slashCommand.name : null,
      args,
      entry: slashCommand,
      ...(slashCommand.source === "skill"
        ? { selectedSkill: { kind: "skill", ...tokenMeta } }
        : { selectedCommand: { kind: "command", ...tokenMeta } })
    }
  }
  const parts = parsePromptTokens(prompt)
  if (!parts.length || parts[0].type !== "token") return null
  if (parts[0].kind !== "skill" && parts[0].kind !== "command") return null
  const tokenCommand = findCommand(parts[0].label)
  if (!tokenCommand) return null
  const args = parts.slice(1).map((part) => part.type === "token" ? part.raw : part.text).join("").trimStart()
  if (tokenCommand.source === "skill") {
    return {
      command: null,
      skill: tokenCommand.name,
      args,
      entry: tokenCommand,
      selectedSkill: {
        kind: "skill",
        label: tokenCommand.name,
        path: commandTokenPath(tokenCommand),
        raw: parts[0].raw,
        args
      }
    }
  }
    return {
      command: tokenCommand.name,
      skill: null,
      args,
      entry: tokenCommand,
      selectedCommand: {
        kind: "command",
        label: tokenCommand.name,
        path: commandTokenPath(tokenCommand),
        raw: parts[0].raw,
        args
      }
  }
}

function tokenRangeAtCaret(text, caret, direction) {
  let offset = 0
  for (const token of parsePromptTokens(text)) {
    const raw = token.type === "token" ? token.raw : token.text
    const start = offset
    const end = offset + raw.length
    offset = end
    if (token.type !== "token") continue
    if (direction === "backward" && caret === end) return { start, end }
    if (direction === "forward" && caret === start) return { start, end }
  }
  return null
}

function removeComposerTokenBoundary({ text, caret, direction }) {
  const range = tokenRangeAtCaret(String(text || ""), Number(caret || 0), direction)
  if (!range) return { text, caret }
  return {
    text: `${text.slice(0, range.start)}${text.slice(range.end)}`,
    caret: range.start
  }
}

function promptEditorText(editor) {
  if (!editor) return ""
  const chunks = []
  const visit = (node) => {
    if (!node) return
    if (node.nodeType === Node.TEXT_NODE) {
      chunks.push(node.textContent || "")
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    if (node.dataset?.tokenRaw) {
      chunks.push(node.dataset.tokenRaw)
      return
    }
    if (node.tagName === "BR") {
      chunks.push("\n")
      return
    }
    for (const child of node.childNodes) visit(child)
  }
  for (const child of editor.childNodes) visit(child)
  return chunks.join("").replace(/\u00a0/g, " ")
}

function promptEditorNodeLength(node) {
  if (!node) return 0
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").length
  if (node.nodeType !== Node.ELEMENT_NODE) return 0
  if (node.dataset?.tokenRaw) return node.dataset.tokenRaw.length
  if (node.tagName === "BR") return 1
  let total = 0
  for (const child of node.childNodes) total += promptEditorNodeLength(child)
  return total
}

function promptEditorTokenAncestor(editor, node) {
  let current = node && node.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
  while (current && current !== editor) {
    if (current.dataset?.tokenRaw) return current
    current = current.parentElement
  }
  return null
}

function promptEditorCaret(editor) {
  if (!editor) return 0
  const selection = window.getSelection?.()
  if (!selection?.rangeCount) return promptEditorText(editor).length
  const { anchorNode, anchorOffset } = selection
  if (!anchorNode || !editor.contains(anchorNode)) return promptEditorText(editor).length
  const tokenNode = promptEditorTokenAncestor(editor, anchorNode)
  if (tokenNode) {
    const tokenStart = promptEditorOffsetForNode(editor, tokenNode)
    return anchorOffset > 0 ? tokenStart + promptEditorNodeLength(tokenNode) : tokenStart
  }
  return promptEditorOffsetWithin(editor, anchorNode, anchorOffset)
}

function promptEditorOffsetWithin(root, targetNode, targetOffset) {
  if (targetNode === root) {
    let total = 0
    for (let index = 0; index < targetOffset; index += 1) total += promptEditorNodeLength(root.childNodes[index])
    return total
  }
  let total = 0
  const walk = (node) => {
    if (!node) return false
    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) total += Math.min(targetOffset, (node.textContent || "").length)
      else {
        for (let index = 0; index < targetOffset; index += 1) total += promptEditorNodeLength(node.childNodes[index])
      }
      return true
    }
    if (node.nodeType === Node.TEXT_NODE) {
      total += (node.textContent || "").length
      return false
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.dataset?.tokenRaw) {
      total += node.dataset.tokenRaw.length
      return false
    }
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "BR") {
      total += 1
      return false
    }
    for (const child of node.childNodes) {
      if (walk(child)) return true
    }
    return false
  }
  walk(root)
  return total
}

function promptEditorOffsetForNode(editor, targetNode) {
  let total = 0
  for (const child of editor.childNodes) {
    if (child === targetNode) return total
    total += promptEditorNodeLength(child)
  }
  return total
}

function setPromptSelection(editor, rangeBuilder) {
  const selection = window.getSelection?.()
  if (!selection) return
  const range = document.createRange()
  rangeBuilder(range)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function placeCaretAtTextOffset(editor, offset) {
  if (!editor) return
  let remaining = Math.max(0, Math.min(offset, promptEditorText(editor).length))
  for (const child of editor.childNodes) {
    const length = promptEditorNodeLength(child)
    if (remaining > length) {
      remaining -= length
      continue
    }
    if (child.nodeType === Node.TEXT_NODE) {
      setPromptSelection(editor, (range) => range.setStart(child, remaining))
      return
    }
    if (child.nodeType === Node.ELEMENT_NODE && child.dataset?.tokenRaw) {
      setPromptSelection(editor, (range) => {
        if (remaining <= 0) range.setStartBefore(child)
        else range.setStartAfter(child)
      })
      return
    }
    if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "BR") {
      setPromptSelection(editor, (range) => range.setStartAfter(child))
      return
    }
    remaining -= length
  }
  setPromptSelection(editor, (range) => range.setStart(editor, editor.childNodes.length))
}

function autosizePromptEditor(editor) {
  if (!editor) return
  editor.style.height = "auto"
  editor.style.height = `${Math.min(editor.scrollHeight, 200)}px`
}

function syncPromptEditor(editor, caret = null) {
  if (!editor) return
  editor.innerHTML = renderPromptTokensHtml(state.promptDraft)
  autosizePromptEditor(editor)
  if (caret !== null) placeCaretAtTextOffset(editor, caret)
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

function canonicalFileMentions(promptText) {
  return parsePromptTokens(promptText)
    .filter((part) => part.type === "token" && part.kind === "file")
    .map((part) => ({ token: part.raw, path: part.path, name: part.label }))
}

async function fileMentionsForSubmit(prompt, command, {
  pendingFileMentions = state.pendingFileMentions,
  files = selectableProjectFiles()
} = {}) {
  if (String(prompt || "").includes("@")) files = await ensureProjectFileCandidates()
  const byToken = new Map()
  for (const fileMention of [
    ...canonicalFileMentions(prompt),
    ...collectLiveFileMentions(prompt, { pendingFileMentions, files })
  ]) {
    if (!fileMention?.token) continue
    byToken.set(fileMention.token, fileMention)
  }
  return [...byToken.values()]
}

function fileMentionNeedsAttachment(fileMention) {
  const filePath = String(fileMention?.path || "")
  return /\.zip$/i.test(filePath)
}

function syncPendingFileMentions(promptText, { rerender = false, promptInput = null } = {}) {
  const live = livePendingFileMentions(promptText)
  if (live.length === state.pendingFileMentions.length) return live
  state.pendingFileMentions = live
  if (rerender) {
    render()
    const freshInput = document.getElementById("promptInput")
    if (freshInput) {
      freshInput.focus()
      syncPromptEditor(freshInput)
    }
  }
  return live
}

function applyPendingFileMentions(promptText, fileMentions) {
  let prompt = String(promptText || "")
  for (const fileMention of fileMentions) {
    if (!fileMention?.token || !fileMention?.path) continue
    const range = fileMentionLineRange(fileMention.name, filename(fileMention.path))
    const serializedPath = range
      ? `${fileMention.path}:${range.start}${range.end > range.start ? `-${range.end}` : ""}`
      : fileMention.path
    const pattern = new RegExp(`(^|\\s)(${escapeRegex(fileMention.token)})(?=$|\\s)`, "g")
    prompt = prompt.replace(pattern, (_, prefix) => `${prefix}\`${serializedPath}\``)
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

// OpenCode's `todowrite` tool carries the plan/progress checklist in
// `state.input.todos` ([{ content, status }], status ∈ pending|in_progress|
// completed|cancelled). Read it defensively so minor schema differences (e.g.
// `text` instead of `content`) still render.
function planTodos(part) {
  const todos = part?.state?.input?.todos
  if (!Array.isArray(todos)) return []
  return todos
    .map((todo) => ({
      text: String(todo?.content ?? todo?.text ?? todo?.title ?? "").trim(),
      status: String(todo?.status ?? "pending")
    }))
    .filter((todo) => todo.text)
}

function planTodoSummary(todos) {
  if (!Array.isArray(todos) || !todos.length) return ""
  const done = todos.filter((todo) => String(todo?.status) === "completed").length
  return `${done}/${todos.length} done`
}

const TODO_STATUS_LABELS = {
  pending: "To do",
  in_progress: "In progress",
  completed: "Done",
  cancelled: "Cancelled"
}

function renderPlanTodos(part) {
  const todos = planTodos(part)
  if (!todos.length) return ""
  const rows = todos.map((todo) => {
    const status = TODO_STATUS_LABELS[todo.status] ? todo.status : "pending"
    const mark = status === "completed" ? icon("check") : status === "cancelled" ? icon("x") : ""
    return `
      <div class="plan-todo ${escapeHtml(status)}">
        <span class="plan-todo-check">${mark}</span>
        <span class="plan-todo-text">${escapeHtml(todo.text)}</span>
        <span class="plan-todo-status">${escapeHtml(TODO_STATUS_LABELS[status])}</span>
      </div>
    `
  }).join("")
  return `<div class="plan-todos">${rows}</div>`
}

const TOOL_ERROR_MAX = 600

// A failed tool part carries the runtime's own message in state.error. Only trust it while the
// part is actually errored — some parts keep a stale error from an earlier attempt that later
// succeeded. Truncate here (at display time) rather than at the IPC boundary, where the field is
// shared with other consumers.
function toolErrorText(part) {
  if (part?.state?.status !== "error") return ""
  const raw = String(part.state.error ?? "").trim()
  if (!raw) return ""
  return raw.length > TOOL_ERROR_MAX ? `${raw.slice(0, TOOL_ERROR_MAX)}…` : raw
}

// OpenCode's edit tool replaces an exact `oldString` and throws prose on failure. Map the
// recognisable shapes to one actionable sentence each, so a red "Editing file failed" row tells
// the user whether to retry, re-read, or fix permissions. Order matters: the multiple-match and
// not-found messages both mention oldString.
const TOOL_ERROR_HINTS = [
  [/multiple matches/i,
    "The text to replace appears more than once — ask the agent to include more surrounding context."],
  [/could not find oldstring/i,
    "The text to replace was not found (whitespace or indentation may differ) — ask the agent to re-read the file and retry."],
  [/matched span is much larger/i,
    "The match was rejected as too broad — ask the agent to re-read the file and use the exact oldString."],
  [/oldstring cannot be empty/i,
    "No text to replace was provided — ask the agent to use write if a full-file replacement is intended."],
  [/no changes to apply/i,
    "The new text is identical to the old text, so there was nothing to change."],
  [/ENOENT|no such file/i,
    "The file does not exist at that path — check the filename."],
  // Anchored to the approval-prompt phrasing specifically. A bare /rejected|aborted/ also matched
  // unrelated failures like "connection aborted by peer" or a model-side "rejected the input",
  // telling the user to retry an approval that was never the cause.
  [/permission denied by user|denied by user|rejected by user|user rejected|request(?:ed)? (?:was )?rejected|aborted by user|user aborted/i,
    "The action was rejected or stopped at the approval prompt — send the request again to allow it."]
]

function toolErrorHint(message) {
  const text = String(message || "")
  if (!text) return ""
  for (const [pattern, hint] of TOOL_ERROR_HINTS) {
    if (pattern.test(text)) return hint
  }
  return filePermissionHintText(text)
}

function toolInfo(part) {
  const input = part.state?.input || {}
  const files = Array.isArray(input.files) ? input.files : []
  const mapping = {
    // The pinned "-next" runtime renamed this tool's field from v1's `filePath` to `path`
    // (verified live: real session data shows `input:{"path":"..."}`, never `filePath`).
    read: { activeLabel: "Reading file", completedLabel: "Read file", subtitle: filename(input.path || input.filePath) },
    list: { activeLabel: "Listing files", completedLabel: "Listed files", subtitle: input.path },
    glob: { activeLabel: "Searching files", completedLabel: "Searched files", subtitle: input.pattern },
    grep: { activeLabel: "Searching text", completedLabel: "Searched text", subtitle: input.pattern },
    bash: { activeLabel: "Running command", completedLabel: "Ran command", subtitle: input.command || input.description },
    // v2 renamed the shell tool from v1's "bash" (see V2_PERMISSION_ACTION_BY_V1_TOOL in
    // opencode-config-v2.js); the actual command lives in `input.command`, not `description`.
    shell: { activeLabel: "Running command", completedLabel: "Ran command", subtitle: input.command || input.description },
    edit: { activeLabel: "Editing file", completedLabel: "Edited file", subtitle: filename(input.filePath) },
    write: { activeLabel: "Writing file", completedLabel: "Wrote file", subtitle: filename(input.filePath) },
    apply_patch: { activeLabel: "Applying patch", completedLabel: "Applied patch", subtitle: files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "" },
    // The pinned "-next" runtime renamed this tool's field from v1's `name` to `id` (verified
    // live: real session data for the same skill tool shows `input:{"id":"brainstorming"}`,
    // never `name` — this is what made every "Loaded skill" row show no skill name at all).
    skill: { activeLabel: "Loading skill", completedLabel: "Loaded skill", subtitle: input.id || input.name },
    websearch: { activeLabel: "Searching the web", completedLabel: "Searched the web", subtitle: input.query },
    translate_document: { activeLabel: "Translating document", completedLabel: "Translated document", subtitle: filename(input.inputPath) },
    translate_office_document: { activeLabel: "Translating Office document", completedLabel: "Translated Office document", subtitle: filename(input.inputPath) },
    subagent: { activeLabel: "Subagent running", completedLabel: "Subagent completed", subtitle: input.description },
    task: { activeLabel: "Subagent running", completedLabel: "Subagent completed", subtitle: input.description },
    todowrite: { activeLabel: "Updating plan", completedLabel: "Updated plan", subtitle: planTodoSummary(input.todos) },
    todoread: { activeLabel: "Reading plan", completedLabel: "Read plan", subtitle: "" }
  }
  const fallback = part.state?.title || part.tool || "Tool"
  return mapping[part.tool] || { activeLabel: fallback, completedLabel: fallback, subtitle: "" }
}

function toolStepLabel(info, status, isSubagent = false) {
  const label = status === "completed"
    ? info.completedLabel
    : (status === "error" ? `${info.activeLabel} failed` : info.activeLabel)
  // Keep the subtitle on error too — the filename is the first thing needed to act on a failure.
  // The [subagent] marker has to survive that: without it a failed subagent step is indistinguish-
  // able from a main-agent one in a thread where both fail.
  const prefixed = isSubagent ? `[subagent] ${label}` : label
  if (info.subtitle) return `${prefixed} - ${info.subtitle}`
  return prefixed
}

function renderToolDetails(part, info, error) {
  const title = part.state?.title
  const hint = toolErrorHint(error)
  const rows = [
    title && title !== info.activeLabel ? ["Title", title, ""] : null,
    info.subtitle ? ["Input", info.subtitle, ""] : null,
    error ? ["Error", error, "error wrap"] : null,
    hint ? ["Fix", hint, "hint wrap"] : null
  ].filter(Boolean)
  return `
    <div class="tool-step-details">
      ${rows.length ? rows.map(([label, value, cls]) => `<div class="tool-detail ${cls}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("") : `<small>No additional details.</small>`}
    </div>
  `
}

// Only failed rows become expandable buttons — a plain read/grep row has nothing to reveal, and
// making every one of them focusable would clutter keyboard navigation of a long thread.
function renderToolRow(part) {
  const info = toolInfo(part)
  const status = part.state?.status || "pending"
  const processing = status === "pending" || status === "running"
  const error = toolErrorText(part)
  const expanded = Boolean(error) && state.expandedToolErrors.has(part.id)
  const copy = `<span class="tool-copy"><strong>${escapeHtml(toolStepLabel(info, status, part.tool === "task"))}</strong></span>`
  const badge = processing
    ? `<span class="tool-processing"><i></i><span>Processing</span></span>`
    : `<span class="tool-state">${escapeHtml(status)}</span>`
  const head = error
    ? `<button type="button" class="tool-step ${escapeHtml(status)}" data-tool-error="${escapeHtml(part.id)}" aria-expanded="${expanded}"><span class="tool-chevron">${icon("chevRight")}</span>${copy}${badge}</button>`
    : `<div class="tool-step ${escapeHtml(status)}">${copy}${badge}</div>`
  return `
    <div class="tool-result">
      ${head}
      ${expanded ? renderToolDetails(part, info, error) : ""}
      ${part.tool === "todowrite" ? renderPlanTodos(part) : ""}
      ${status === "completed" ? renderToolArtifacts(part.state?.metadata) : ""}
    </div>
  `
}

const OTHER_OPTION_VALUE = "__openworking_other__"

function questionDraftKey(sessionId, requestID, index) {
  return `${sessionId || ""}:${requestID}:${index}`
}

function questionDraft(sessionId, requestID, index) {
  const key = questionDraftKey(sessionId, requestID, index)
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
  const thread = state.threads.get(state.activeSessionId)
  const pending = thread?.pendingQuestions || []
  if (!pending.length) return ""
  return pending.map((req) => renderQuestionCard({ ...req, sessionId: state.activeSessionId })).join("")
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
  const draft = multiple || question.optional ? questionDraft(request.sessionId, request.requestID, index) : null
  const rows = options.map((option, optionIndex) => {
    const value = String(option.value ?? option.label ?? "")
    const checked = draft ? draft.selected.has(value) : false
    return `
      <button class="ask-option ${checked ? "selected" : ""}" data-question-option="${escapeHtml(request.requestID)}" data-question-session="${escapeHtml(request.sessionId)}" data-question-index="${index}" data-question-value="${escapeHtml(value)}" data-question-multiple="${multiple ? "1" : "0"}">
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

function formDraftKey(sessionId, formID) {
  return `${sessionId || ""}:${formID || ""}`
}

function formDraft(request) {
  const key = formDraftKey(request.sessionId, request.id)
  let answer = state.formDrafts.get(key)
  if (!answer) {
    answer = {}
    for (const field of request.fields || []) {
      if (field.default !== undefined) answer[field.key] = Array.isArray(field.default) ? [...field.default] : field.default
    }
    state.formDrafts.set(key, answer)
  }
  return answer
}

function formFieldActive(field, answer) {
  if (!Array.isArray(field.when) || !field.when.length) return true
  return field.when.every((condition) => {
    const current = answer[condition.key]
    if (current === undefined) return false
    const hit = Array.isArray(current) ? current.includes(condition.value) : current === condition.value
    return condition.op === "eq" ? hit : !hit
  })
}

function activeFormFields(request, answer) {
  const activeAnswer = {}
  return (request.fields || []).filter((field) => {
    const active = formFieldActive(field, activeAnswer)
    if (active && answer[field.key] !== undefined) activeAnswer[field.key] = answer[field.key]
    return active
  })
}

function renderFormField(request, field, answer) {
  if (!formFieldActive(field, answer)) return ""
  const value = answer[field.key]
  const title = field.title || field.description || field.key
  const description = field.title && field.description ? `<small>${escapeHtml(field.description)}</small>` : ""
  let control = ""
  if (field.type === "string" && Array.isArray(field.options)) {
    control = `<div class="ask-options">${field.options.map((option, index) => `
      <button class="ask-option ${value === option.value ? "selected" : ""}" data-form-option="${escapeHtml(request.id)}" data-form-key="${escapeHtml(field.key)}" data-form-value="${escapeHtml(option.value)}">
        <span class="ask-option-index">${index + 1}</span>
        <span class="ask-option-body"><strong>${escapeHtml(option.label)}</strong>${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}</span>
        <span class="ask-check">${value === option.value ? icon("check") : ""}</span>
      </button>`).join("")}</div>`
  } else if (field.type === "multiselect") {
    const selected = Array.isArray(value) ? value : []
    control = `<div class="ask-options">${(field.options || []).map((option, index) => `
      <button class="ask-option ${selected.includes(option.value) ? "selected" : ""}" data-form-multiselect="${escapeHtml(request.id)}" data-form-key="${escapeHtml(field.key)}" data-form-value="${escapeHtml(option.value)}">
        <span class="ask-option-index">${index + 1}</span>
        <span class="ask-option-body"><strong>${escapeHtml(option.label)}</strong>${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}</span>
        <span class="ask-check">${selected.includes(option.value) ? icon("check") : ""}</span>
      </button>`).join("")}</div>`
  } else if (field.type === "boolean") {
    control = `<button class="ask-option ${value === true ? "selected" : ""}" data-form-boolean="${escapeHtml(request.id)}" data-form-key="${escapeHtml(field.key)}"><span class="ask-option-body"><strong>${value === true ? "Yes" : "No"}</strong></span><span class="ask-check">${value === true ? icon("check") : ""}</span></button>`
  } else if (field.type === "external") {
    control = `<div class="form-external-url">${escapeHtml(field.url)}</div><button class="ask-option ${value === true ? "selected" : ""}" data-form-external="${escapeHtml(request.id)}" data-form-key="${escapeHtml(field.key)}"><span class="ask-option-body"><strong>I have completed this step</strong></span><span class="ask-check">${value === true ? icon("check") : ""}</span></button>`
  } else {
    const numeric = field.type === "number" || field.type === "integer"
    control = `<input class="form-input" data-form-input="${escapeHtml(request.id)}" data-form-key="${escapeHtml(field.key)}" type="${numeric ? "number" : field.format === "email" ? "email" : field.format === "date" ? "date" : "text"}" ${field.type === "integer" ? 'step="1"' : ""} ${field.minimum !== undefined ? `min="${field.minimum}"` : ""} ${field.maximum !== undefined ? `max="${field.maximum}"` : ""} ${field.minLength !== undefined ? `minlength="${field.minLength}"` : ""} ${field.maxLength !== undefined ? `maxlength="${field.maxLength}"` : ""} placeholder="${escapeHtml(field.placeholder || "")}" value="${escapeHtml(value ?? "")}" />`
  }
  return `<div class="form-field"><div class="ask-question-text">${escapeHtml(title)}${field.required || field.type === "external" ? " *" : ""}</div>${description}${control}</div>`
}

function renderPendingForms() {
  const thread = state.threads.get(state.activeSessionId)
  const pending = thread?.pendingForms || []
  if (!pending.length) return ""
  return pending.map((form) => {
    const request = { ...form, sessionId: state.activeSessionId }
    const answer = formDraft(request)
    const fields = activeFormFields(request, answer)
    const busy = isRequestReplyInFlight(request.sessionId, request.id)
    return `<div class="ask-card form-card" data-form-card="${escapeHtml(request.id)}">
      <div class="ask-card-header">${escapeHtml(request.title || "Input required")}</div>
      <div class="form-fields">${fields.map((field) => renderFormField(request, field, answer)).join("")}</div>
      <div class="form-actions">
        <button class="ask-dismiss" data-form-cancel="${escapeHtml(request.id)}"${busy ? " disabled" : ""}>Cancel</button>
        <button class="ask-submit" data-form-submit="${escapeHtml(request.id)}"${busy ? " disabled" : ""}>${busy ? "Sending…" : "Continue"}</button>
      </div>
    </div>`
  }).join("")
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
  const allPending = []
  for (const [sessionId, thread] of state.threads) {
    if (thread.pendingPermissions?.length) {
      allPending.push(...thread.pendingPermissions.map(req => ({ ...req, sessionId })))
    }
  }
  if (!allPending.length) return ""
  return allPending.map(renderPermissionCard).join("")
}

function renderPermissionCard(request) {
  const summary = permissionSummary(request)
  const details = renderPermissionDetails(request)
  // While a reply is airborne the buttons are disabled rather than merely ignored. The click guard
  // alone left them enabled and silently dropped the second click, which reads as a dead button.
  const busy = isRequestReplyInFlight(request.sessionId, request.requestID)
  const disabled = busy ? " disabled" : ""
  return `
    <div class="ask-card permission-card" data-permission-card="${escapeHtml(request.requestID)}">
      <div class="ask-card-header">${escapeHtml(permissionHeader(request))} ${request.sessionId && request.sessionId !== state.activeSessionId ? `<small>(Session: ${request.sessionId})</small>` : ""}</div>
      ${summary ? `<div class="ask-permission-meta">${escapeHtml(summary)}</div>` : ""}
      ${details || (summary ? "" : `<div class="ask-permission-meta">No additional details.</div>`)}
      <div class="ask-permission-actions">
        <button class="ask-permission-btn allow" data-permission-reply="${escapeHtml(request.requestID)}" data-permission-session="${escapeHtml(request.sessionId)}" data-permission-decision="once"${disabled}>Allow once</button>
        <button class="ask-permission-btn always" data-permission-reply="${escapeHtml(request.requestID)}" data-permission-session="${escapeHtml(request.sessionId)}" data-permission-decision="always"${disabled}>Always allow</button>
        <button class="ask-permission-btn reject" data-permission-reply="${escapeHtml(request.requestID)}" data-permission-session="${escapeHtml(request.sessionId)}" data-permission-decision="reject"${disabled}>Reject</button>
      </div>
      ${busy ? `<div class="ask-permission-meta">Sending…</div>` : ""}
    </div>
  `
}

// diffStats / highlightCode / renderUnifiedDiff (and their hljs language maps) now live in
// src/renderer/markup.js (destructured above).

// Renders one file row in the inline "Changes" card. Clicking it opens the diff
// in the document-viewer panel (Diff tab) rather than expanding inline. Rows
// without a resolvable file path are shown read-only (no panel to open).
function renderDiffRow(key, { fileKey, filepath, label, diff, truncated }) {
  const displayLabel = label || (filepath ? filename(filepath) : "Changes")
  const { additions, deletions } = diffStats(diff)
  const openable = Boolean(filepath && isViewableFilePath(filepath)) || Boolean(diff)
  const active = openable && state.document?.requestedPath === (filepath || fileKey) && state.document?.tab === "diff"
  const head = `
        ${icon("doc")}
        <span class="tool-diff-name">${escapeHtml(displayLabel)}</span>
        <span class="tool-diff-stats"><span class="diff-add">+${additions}</span><span class="diff-del">-${deletions}</span></span>
        <span class="tool-chevron">${icon("chevRight")}</span>`
  return `
    <div class="tool-diff-block">
      ${openable
        ? `<button class="tool-diff-head${active ? " active" : ""}" data-open-file="${escapeHtml(filepath || fileKey)}" data-open-tab="diff" title="${escapeHtml(filepath || filename(filepath || fileKey))}">${head}</button>`
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
      || part.state?.input?.filePath
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
          ${icon("doc")}<span><strong>${escapeHtml(artifact.filename)}</strong></span>
        </button>
      `).join("")}
      ${warnings.map((warning) => `<small class="artifact-warning">${escapeHtml(warning)}</small>`).join("")}
    </div>
  `
}

function renderThinkingRow(thread) {
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

function renderReasoningMenu(selected) {
  const model = selectedModel()
  const available = [
    REASONING_OPTIONS[0],
    ...(Array.isArray(model?.variants) ? model.variants : []).map((variant) => {
      const known = REASONING_OPTIONS.find((option) => option.id === variant.id)
      return known || {
        id: variant.id,
        label: reasoningModeLabel(variant.id),
        shortLabel: reasoningModeShortLabel(variant.id),
        title: `${reasoningModeLabel(variant.id)} variant`
      }
    })
  ]
  const rows = available.map((option) => `
    <button class="reasoning-option ${option.id === selected ? "active" : ""}" data-reasoning-mode="${escapeHtml(option.id)}" title="${escapeHtml(option.title)}" aria-label="${escapeHtml(option.title)}">
      <span class="reasoning-dot"></span>
      <span>${escapeHtml(option.shortLabel)}</span>
    </button>
  `).join("")
  return `
    <div class="pop pop-up reasoning-pop">
      <div class="reasoning-pop-head">
        <span>Variant</span><strong>${escapeHtml(selected === "none" ? "Base" : reasoningModeLabel(selected))}</strong>
        <button class="reasoning-help" type="button" aria-label="About reasoning effort" title="About reasoning effort">
          ${icon("ask")}
          <span class="reasoning-help-tip" role="tooltip">
            <strong>Model variant</strong>
            <span>Base does not select a variant. Every other choice comes from the current OpenCode model catalog.</span>
          </span>
        </button>
      </div>
      <div class="reasoning-pop-scale-labels"><span>Faster</span><span>Smarter</span></div>
      <div class="reasoning-scale">${rows}</div>
    </div>
  `
}

function renderContextPopover({ used, total, pct, stale = false }) {
  const safePct = Number.isFinite(pct) ? pct : 0
  const color = contextThresholdColor(safePct)
  const compaction = state.activeSessionId ? state.runtime?.compactionStatuses?.[state.activeSessionId] : null
  const pending = compaction?.status === "admitted" || compaction?.status === "running"
  const statusText = compaction?.status === "admitted"
    ? "Compaction queued"
    : compaction?.status === "running"
      ? "Compacting context…"
      : compaction?.status === "ended" && stale
        ? "Compacted; usage updates after the next response."
        : compaction?.status === "failed"
          ? compaction.error || "Compaction failed."
          : ""
  return `
    <div class="pop pop-up context-pop">
      <div class="context-pop-head">${renderContextRing(safePct)}<span>Context window</span><strong style="color: ${color}">${stale ? "Pending" : `${safePct}%`}</strong></div>
      ${stale ? "" : `<div class="context-pop-track"><div class="context-pop-fill" style="width: ${safePct}%; background: ${color}"></div></div>`}
      <div class="context-pop-count">${stale ? `Usage pending / ${escapeHtml(formatTokenCount(total))}` : `${escapeHtml(formatTokenCount(used))} / ${escapeHtml(formatTokenCount(total))}`}</div>
      ${statusText ? `<div class="context-pop-status ${compaction?.status === "failed" ? "error" : ""}">${escapeHtml(statusText)}</div>` : ""}
      ${state.activeSessionId ? `<button class="secondary-btn context-compact-btn ${pending ? "disabled" : ""}" data-action="compactSession" ${pending ? "disabled" : ""}>${pending ? "Compaction queued" : "Compact now"}</button>` : ""}
    </div>
  `
}

function renderGitPopoverList(items, { emptyLabel, currentValue, dataAttr, labelKey }) {
  if (!items.length) return `<div class="pop-empty">${escapeHtml(emptyLabel)}</div>`
  return items
    .map((item) => {
      const value = item[labelKey]
      let label = value
      if (labelKey === "path") {
        const pathSplit = value.split("/")
        label = pathSplit[Math.max(pathSplit.length - 1, 0)]
      }
      const isCurrent = value === currentValue
      return `
        <button class="pop-item git-pop-item ${isCurrent ? "active" : ""}" ${dataAttr}="${escapeHtml(value)}" title="${escapeHtml(value)}">
          <span>${escapeHtml(label)}</span>
          ${isCurrent ? icon("check") : ""}
        </button>`
    })
    .join("")
}

// A branch already checked out by another worktree can't be checked out here too — git refuses
// with "already checked out at <path>". Only offer: the active worktree's own branch, plus any
// local branch not currently claimed by a different worktree.
function selectableBranches(gitInfo) {
  const usedElsewhere = new Set(
    gitInfo.worktrees.filter((worktree) => !worktree.isCurrent && worktree.branch).map((worktree) => worktree.branch)
  )
  return gitInfo.branches.filter((branch) => !usedElsewhere.has(branch.name))
}

function renderGitPopover(gitInfo) {
  const worktreeRows = renderGitPopoverList(gitInfo.worktrees, {
    emptyLabel: "No worktrees found.",
    currentValue: gitInfo.worktrees.find((w) => w.isCurrent)?.path,
    dataAttr: "data-git-worktree",
    labelKey: "path"
  })
  const branchRows = renderGitPopoverList(selectableBranches(gitInfo), {
    emptyLabel: "No local branches found.",
    currentValue: gitInfo.currentBranch,
    dataAttr: "data-git-branch",
    labelKey: "name"
  })
  return `
    <div class="pop pop-up git-pop">
      <div class="git-pop-col">
        <div class="pop-label">${icon("folder")}<span>Worktrees</span></div>
        <div class="git-pop-col-list">${worktreeRows}</div>
      </div>
      <div class="git-pop-col">
        <div class="pop-label">${icon("branch")}<span>Branches</span></div>
        <div class="git-pop-col-list">${branchRows}</div>
      </div>
    </div>
  `
}

function renderGitControl(project) {
  if (!project) return ""
  const gitInfo = state.gitInfoByProject.get(project.id)
  // Never loaded yet for THIS project: kick off a background load (self-healing — any code path
  // that shows a project's composer gets the right info without wiring ensureGitInfo into it) and
  // render nothing this frame. Because the lookup is keyed by project.id, a not-yet-loaded or
  // stale entry can only ever hide/mismatch its OWN project, never surface a different one.
  if (gitInfo === undefined) {
    ensureGitInfo(project.id)
    return ""
  }
  if (!gitInfo.isGitRepo) return ""
  const buttonTitle = `Switch branch or worktree. Current branch : ${escapeHtml(gitInfo.currentBranch || "detached")}`
  return `
    <div class="popover-anchor">
      <button class="reasoning-control git-branch-control" data-popover="git" title="${buttonTitle}" aria-label="${buttonTitle}">
        ${icon("branch")}<span>${escapeHtml(gitInfo.currentBranch || "detached")}</span>
      </button>
      ${state.popover === "git" ? renderGitPopover(gitInfo) : ""}
    </div>
  `
}

function renderNewSessionProjectPopover(project) {
  const rows = state.projects.map((item) => `
    <button class="pop-item project-selector-item ${item.id === project.id ? "active" : ""}" data-new-session-project="${escapeHtml(item.id)}" data-project-search="${escapeHtml(`${item.name} ${item.path}`.toLowerCase())}" title="${escapeHtml(item.path)}">
      ${icon("folder")}<span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.path)}</small></span>${item.id === project.id ? icon("check") : ""}
    </button>
  `).join("")
  return `
    <div class="pop pop-up project-selector-pop">
      <label class="project-selector-search">
        ${icon("search")}
        <input id="newSessionProjectSearch" type="text" value="${escapeHtml(state.newSessionProjectQuery)}" placeholder="Search projects" aria-label="Search projects" data-new-session-project-search>
      </label>
      <div class="project-selector-list">${rows}</div>
      <div class="pop-empty project-selector-empty" hidden>No projects match your search.</div>
      <div class="pop-divider"></div>
      <button class="pop-item" data-action="addProjectFromComposer">${icon("plus")}<span><strong>New project</strong></span></button>
    </div>
  `
}

function renderNewSessionProjectControl(project) {
  return `
    <div class="popover-anchor">
      <button class="reasoning-control project-selector-control" data-popover="project" title="Change project" aria-label="Change project">
        ${icon("folder")}<span>${escapeHtml(project.name)}</span>${icon("chevDown")}
      </button>
      ${state.popover === "project" ? renderNewSessionProjectPopover(project) : ""}
    </div>
  `
}

function renderComposer(project, dock = false, showProjectSelector = false) {
  const planOn = state.mode === "plan"
  const model = selectedModel()
  const compaction = state.activeSessionId ? state.runtime?.compactionStatuses?.[state.activeSessionId] : null
  const contextUsage = resolveContextUsage(compaction, model)
  const reasoningMode = currentReasoningMode()
  const abortable = threadAbortable()
  const startingChat = state.firstSendInFlight && !state.activeSessionId
  const placeholder = `${dock && !showProjectSelector ? "Reply to" : "Describe a task for"} ${project.name}...`
  // Bridged to PromptEditor.svelte, which reads it via ctx.state.composerPlaceholder.
  state.composerPlaceholder = placeholder
  return `
    <div class="composer">
      <div class="ta-wrap">
        <div id="promptAssistMenuRoot"></div>
        <div id="promptEditorRoot"></div>
      </div>
      <div id="attachmentChipsRoot"></div>
      <div class="composer-bar">
        <div class="popover-anchor">
          <button class="icon-btn" data-popover="plus" title="More">${icon("plus")}</button>
          ${state.popover === "plus" ? `<div class="pop pop-up plus-pop">
            <button class="pop-item" data-action="attachment">${icon("attach")}<span><strong>Add photos & files</strong></span></button>
            ${state.activeSessionId ? `<button class="pop-item ${sessionRevertAvailable(state.activeSessionId) ? "" : "disabled"}" data-action="undoSession" ${sessionRevertAvailable(state.activeSessionId) ? "" : "disabled"}>${icon("fork")}<span><strong>Undo last prompt</strong></span></button>` : ""}
            <div class="pop-divider"></div>
            <button class="pop-toggle ${planOn ? "on" : ""}" data-action="togglePlanMode" aria-pressed="${planOn}" title="${planOn ? "Plan mode on - reads only, proposes a plan first" : "Plan mode off - Execution mode reads & edits files"}">
              ${icon("ask")}<span>Plan mode</span><span class="switch ${planOn ? "on" : ""}"></span>
            </button>
          </div>` : ""}
        </div>
        ${showProjectSelector ? renderNewSessionProjectControl(project) : ""}
        <span class="mode-label ${planOn ? "plan" : ""}">${planOn ? "Plan" : "Execution"}</span>
        ${renderGitControl(project)}
        <span class="spacer"></span>
        ${startingChat ? '<span class="composer-submit-status">Starting chat...</span>' : ""}
        <span class="model-label" title="${escapeHtml(model?.name || "No model configured")}">${escapeHtml(model?.name || "No model configured")}</span>
        <div class="popover-anchor">
          <button class="reasoning-control ${reasoningMode !== "none" ? "on" : ""}" data-popover="reasoning" title="${escapeHtml(reasoningModeTitle(reasoningMode))}" aria-label="${escapeHtml(reasoningModeTitle(reasoningMode))}">
            <span>${escapeHtml(reasoningModeShortLabel(reasoningMode))}</span>${icon("chevDown")}
          </button>
          ${state.popover === "reasoning" ? renderReasoningMenu(reasoningMode) : ""}
        </div>
        ${contextUsage ? `<div class="popover-anchor">
          <button class="context-ring-btn${contextUsage.stale ? " compacted" : ""}" data-popover="context" title="${contextUsage.stale ? "Context compacted; usage updates after the next response" : `Context window: ${contextUsage.pct}% used`}" aria-label="${contextUsage.stale ? "Context compacted; usage updates after the next response" : `Context window: ${contextUsage.pct}% used`}">${renderContextRing(contextUsage.stale ? 0 : contextUsage.pct)}</button>
          ${state.popover === "context" ? renderContextPopover(contextUsage) : ""}
        </div>` : ""}
        <button class="send-stop ${abortable ? "" : "hidden"}" data-action="abortSession" title="Stop current response" aria-label="Stop current response">${icon("stop")}</button>
        <div class="popover-anchor send-split">
          <button class="send ${startingChat || state.promptSubmitInFlight ? "disabled pending" : state.promptDraft.trim() ? "" : "disabled"}" data-action="sendPrompt" title="${startingChat ? "Starting chat" : state.promptSubmitInFlight ? "Sending prompt" : abortable ? "Queue prompt" : "Send"}" aria-label="${startingChat ? "Starting chat" : state.promptSubmitInFlight ? "Sending prompt" : abortable ? "Queue prompt" : "Send"}" ${startingChat || state.promptSubmitInFlight ? "disabled" : ""}>${startingChat || state.promptSubmitInFlight ? '<span class="submit-spinner" aria-hidden="true"></span>' : icon("arrowUp")}</button>
          <button class="send-menu ${abortable ? "" : "hidden"}" data-popover="delivery" title="Choose prompt delivery" aria-label="Choose prompt delivery">${icon("chevDown")}</button>
          ${state.popover === "delivery" && abortable ? `<div class="pop pop-up delivery-pop">
            <button class="pop-item" data-action="sendPrompt">${icon("book")}<span><strong>Queue after current run</strong><small>Runs next in FIFO order</small></span></button>
            <button class="pop-item" data-action="steerPrompt">${icon("bolt")}<span><strong>Steer current run</strong><small>Applies at the next safe step</small></span></button>
          </div>` : ""}
        </div>
      </div>
    </div>
  `
}

// Initials for a project's monogram: first letters of the first two words (splitting on
// -, _, or space), else the first two characters. Mirrors the design's initials().
function projectInitials(name) {
  const parts = String(name || "").replace(/[_-]+/g, " ").split(" ").filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return String(name || "?").slice(0, 2).toUpperCase() || "?"
}

// Stable hue (0-359) derived from the project id so each card's monogram gradient is
// deterministic across renders (the design hand-picked a hue per mock project).
function projectHue(id) {
  let hash = 0
  const str = String(id || "")
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0
  return hash % 360
}

// Supported IDEs for the "Open in IDE" split-button and the future
// Default IDE picker (Personalization settings, task-004). vscode/cursor/antigravity use the
// PNG brand logos copied into src/assets/ (source: cursor-64px.png, visual-studio-code-64px.png,
// google-antigravity-64px.png); "system" has no brand logo and keeps the "monitor" SVG icon.
const IDE_OPTIONS = [
  { id: "system", label: "System default", icon: "monitor" },
  { id: "vscode", label: "VS Code", asset: "ide-vscode.png" },
  { id: "cursor", label: "Cursor", asset: "ide-cursor.png" },
  { id: "antigravity", label: "Antigravity IDE", asset: "ide-antigravity.png" }
]
// The split-button dropdown offers a specific-IDE override, not "system" (that's just the
// unconfigured default, not a real app to switch to).
const IDE_OVERRIDE_OPTIONS = IDE_OPTIONS.filter((option) => option.id !== "system")

function ideOption(id) {
  return IDE_OPTIONS.find((option) => option.id === id) || IDE_OPTIONS[0]
}

// Cursor's source PNG is a pale/monochrome mark that's invisible without a solid backing
// (.ide-icon-cursor gives it one); VS Code and Antigravity are full-color and render as-is.
function ideIconMarkup(option) {
  if (!option.asset) return icon(option.icon)
  const cursorClass = option.id === "cursor" ? " ide-icon-cursor" : ""
  return `<img class="ide-icon${cursorClass}" src="./assets/${option.asset}" alt="">`
}

function renderIdeSplitButton(project) {
  const defaultIde = ideOption(state.config?.personalization?.defaultIde)
  const menuOpen = state.ideMenu === project.id
  return `
    <div class="ide-split-btn" data-stop-click>
      <button class="ide-split-main" data-open-ide="${escapeHtml(project.id)}" title="Open in ${escapeHtml(defaultIde.label)}" aria-label="Open in ${escapeHtml(defaultIde.label)}">${ideIconMarkup(defaultIde)}</button>
      <button class="ide-split-arrow ${menuOpen ? "on" : ""}" data-ide-menu="${escapeHtml(project.id)}" title="Choose IDE" aria-label="Choose IDE">${icon("chevDown")}</button>
      ${menuOpen ? `
        <div class="pop ide-pop">
          ${IDE_OVERRIDE_OPTIONS.map((option) => `
            <button class="pop-item ide-label" data-open-ide="${escapeHtml(project.id)}" data-ide-override="${option.id}">
              ${ideIconMarkup(option)}<span>${escapeHtml(option.label)}</span>
            </button>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `
}

const SETTINGS_SECTIONS = [
  { id: "provider", label: "Provider & Model", icon: "gear" },
  { id: "advanced", label: "Advanced", icon: "book" },
  { id: "personalization", label: "Personalization", icon: "personalization" }
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
          ${section === "personalization" ? renderSettingsPersonalization() : ""}
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

// Appearance toggle options — mirrors THEME_MODES order (system | light | dark).
// "system" is the default and tracks the OS setting (see the reference mockup).
const THEME_OPTIONS = [
  { id: "system", label: "System", icon: "monitor" },
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" }
]

function renderSettingsAdvanced() {
  const configJson = redactedConfigJson()
  return `
    <section class="admin-panel">
      <div class="panel-head replay-tour">
        <div><h1>Guided tour</h1><p>Replay the first-run walkthrough of projects, sessions, modes, reasoning, and skills.</p></div>
        <button class="secondary-btn" data-action="replayOnboarding">${icon("sparkle")}Replay tour</button>
      </div>
    </section>
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

// A single Icon → Label → Checkmark row shared by the Personalization "Elegant List" groups
// (Default IDE, Appearance). `iconMarkup` is pre-rendered (an <img> for IDE brand logos, an
// inline SVG string for theme icons) and `dataAttr` supplies whichever data-* the row is
// wired to (data-personalization-field/value for IDE rows, data-theme-mode for theme rows —
// see DELEGATED_CLICK).
function renderOptionRow({ iconMarkup, label, active, dataAttr }) {
  return `
    <button class="option-row ${active ? "active" : ""}" ${dataAttr} role="radio" aria-checked="${active ? "true" : "false"}">
      ${iconMarkup}<span class="option-row-label">${escapeHtml(label)}</span>
      ${active ? icon("check") : ""}
    </button>`
}

function renderSettingsPersonalization() {
  const activeIde = ideOption(state.config?.personalization?.defaultIde).id
  const activeTheme = THEME_MODES.includes(state.themeMode) ? state.themeMode : "system"
  const activeThemeIndex = Math.max(0, THEME_OPTIONS.findIndex((option) => option.id === activeTheme))
  return `
    <section class="admin-panel">
      <div class="panel-head"><div><h1>Default IDE</h1><p>Choose which app opens when you click a project's IDE button.</p></div></div>
      <div class="personalization-list" role="radiogroup" aria-label="Default IDE">
        ${IDE_OPTIONS.map((option) => renderOptionRow({
          iconMarkup: ideIconMarkup(option),
          label: option.label,
          active: option.id === activeIde,
          dataAttr: `data-personalization-field="defaultIde" data-personalization-value="${option.id}"`
        })).join("")}
      </div>
    </section>
    <section class="admin-panel theme-choose">
      <div class="panel-head"><div><h1>Appearance</h1><p>Match your system, or force light or dark.</p></div></div>
      <div class="theme-seg" role="radiogroup" aria-label="Appearance">
        <div class="theme-seg-thumb" style="transform: translateX(${activeThemeIndex * 38}px)"></div>
        ${THEME_OPTIONS.map((option) => `
          <button
            class="theme-seg-btn ${option.id === activeTheme ? "active" : ""}"
            role="radio"
            aria-checked="${option.id === activeTheme ? "true" : "false"}"
            title="${escapeHtml(option.label)}"
            aria-label="${escapeHtml(option.label)}"
            data-theme-mode="${option.id}"
          >${icon(option.icon)}</button>`).join("")}
      </div>
    </section>
  `
}

function renderSkillsScreen() {
  const tab = ["plugins", "mcp", "memory", "references"].includes(state.skillsTab) ? state.skillsTab : "skills"
  // The panel host starts empty; render() paints the active panel island right after this
  // markup lands (same pattern as the sidebar/thread hosts).
  const panel = ""
  const segBtn = (id, label, ic) => `
    <button class="seg-btn ${tab === id ? "active" : ""}" data-skills-tab="${id}">${icon(ic)}<span>${label}</span></button>`
  return `
    <main class="main">
      ${renderHeader("Skills")}
      <div class="skills-screen">
        <div class="sk-wrap">
          <div class="seg" role="tablist">
            ${segBtn("skills", "Skills", "blocks")}
            ${segBtn("plugins", "Plugins", "bolt")}
            ${segBtn("mcp", "Extensions", "server")}
            ${segBtn("memory", "Memory", "brain")}
            ${segBtn("references", "References", "folder")}
          </div>
          <div data-skills-panel-host style="display:contents">${panel}</div>
        </div>
      </div>
    </main>
  `
}

// Cross-chat memory: editable text for the global memory (applies everywhere) and a chosen
// project's memory. The Memory tab's project selector is view/edit only: it must not switch the
// app's active project or alter which project's memory the runtime currently has loaded.
// Pick an existing icon for a skill row by name, falling back to a generic sparkle.
const SKILL_ICONS = {
  "explain-project": "book", "find-bugs": "ask", "write-tests": "check",
  "summarize-changes": "doc", "code-review": "blocks", "docs-update": "doc",
  pdf: "doc", pptx: "doc", docx: "doc", xlsx: "doc",
  "skill-creator": "sparkle",
  "webapp-testing": "activity", "cross-chat-memory": "brain", "browser-use": "server",
  backlog: "check"
}
function skillIcon(name) { return icon(SKILL_ICONS[name] || "sparkle") }

// Live-filter the Skills tab rows against state.skillsQuery / state.skillsFilter by toggling DOM
// visibility — no re-render, so the search input keeps focus and caret. Mirrors the design's
// runSearch(). Safe to call when the Skills tab isn't mounted (it just finds nothing).
function filterSkillsDom() {
  const query = (state.skillsQuery || "").trim().toLowerCase()
  const filter = ["installed", "builtin"].includes(state.skillsFilter) ? state.skillsFilter : "all"
  const groups = document.querySelectorAll('[data-panel="skills"] .grp')
  let anyVisible = false
  groups.forEach((group) => {
    const hiddenByFilter = filter !== "all" && group.dataset.group !== filter
    group.classList.toggle("hidden", hiddenByFilter)
    if (hiddenByFilter) return
    let shown = 0
    group.querySelectorAll(".row").forEach((row) => {
      const hit = !query || (row.dataset.name || "").includes(query)
      row.style.display = hit ? "" : "none"
      if (hit) shown++
    })
    group.style.display = shown ? "" : "none"
    if (shown) anyVisible = true
  })
  const empty = document.getElementById("skill-empty")
  if (empty) empty.style.display = anyVisible ? "none" : "block"
}

function filterNewSessionProjectsDom() {
  const query = (state.newSessionProjectQuery || "").trim().toLowerCase()
  const list = document.querySelector(".project-selector-list")
  if (!list) return
  let anyVisible = false
  list.querySelectorAll(".project-selector-item").forEach((item) => {
    const hit = !query || (item.dataset.projectSearch || "").includes(query)
    item.hidden = !hit
    if (hit) anyVisible = true
  })
  const empty = document.querySelector(".project-selector-empty")
  if (empty) empty.hidden = anyVisible
}

function mcpServerSubtitle(server) {
  if (server.type === "local") return Array.isArray(server.command) ? server.command.join(" ") : ""
  return server.url || ""
}

// Resolve the connection state of a server into a status pill + whether an auth action
// is offered. Returns { pill: html, action: "authenticate"|"reconnect"|"retry"|null }.
function mcpStatusInfo(server) {
  const oauthEligible = server.type === "remote" && server.oauth !== false
  if (state.mcpAuthenticating?.[server.name]) {
    return { pill: `<span class="mcp-pill mcp-pill-pending">Connecting…</span>`, action: null }
  }
  const status = state.mcpStatus?.[server.name]
  if (!server.enabled) return { pill: `<span class="mcp-pill mcp-pill-muted">Disabled</span>`, action: null }
  if (status === "connected") return { pill: `<span class="mcp-pill mcp-pill-ok">Connected</span>`, action: null }
  if (status === "failed") {
    // Remote OAuth servers re-run the auth flow; local stdio servers (e.g. a bad PATH) just retry the connect.
    return { pill: `<span class="mcp-pill mcp-pill-bad">Failed</span>`, action: oauthEligible ? "reconnect" : "retry" }
  }
  if (status === "needs_auth") {
    return { pill: `<span class="mcp-pill mcp-pill-warn">Needs auth</span>`, action: oauthEligible ? "authenticate" : null }
  }
  if (status === "needs_client_registration") {
    return { pill: `<span class="mcp-pill mcp-pill-warn">Needs OAuth app</span>`, action: oauthEligible ? "authenticate" : null }
  }
  return { pill: "", action: null }
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

function clearQuestionDrafts(sessionId, requestID) {
  for (const key of [...state.questionDrafts.keys()]) {
    if (key.startsWith(`${sessionId || ""}:${requestID}:`)) state.questionDrafts.delete(key)
  }
}

const EXPIRED_PERMISSION_MESSAGE = "Yêu cầu quyền này đã hết hạn. Phiên có thể đã dừng hoặc dịch vụ đã khởi động lại — hãy gửi lại yêu cầu."
const EXPIRED_QUESTION_MESSAGE = "Câu hỏi này đã hết hạn. Phiên có thể đã dừng hoặc dịch vụ đã khởi động lại — hãy gửi lại yêu cầu."
const EXPIRED_FORM_MESSAGE = "Biểu mẫu này đã hết hạn. Phiên có thể đã dừng hoặc dịch vụ đã khởi động lại — hãy thử lại yêu cầu."

// A fast double-click used to send the same requestID twice — the runtime drops it on the first
// reply, and the second got a 404 that looked like an expiry. Track what is airborne, ignore
// repeat clicks, and render the affected card as disabled so the wait is visible.
const inFlightRequestReplies = new Set()

function requestReplyKey(sessionId, requestID) {
  return `${sessionId}:${requestID}`
}

function isRequestReplyInFlight(sessionId, requestID) {
  return inFlightRequestReplies.has(requestReplyKey(sessionId, requestID))
}

function beginRequestReply(sessionId, requestID) {
  const key = requestReplyKey(sessionId, requestID)
  if (inFlightRequestReplies.has(key)) return null
  inFlightRequestReplies.add(key)
  // Repaint so the card shows its disabled/"Sending…" state for the duration of the round-trip.
  renderThreadContent()
  return key
}

// Releases the in-flight lock. Repaints when the card survived the reply (a genuine failure keeps
// it so the user can retry) so its buttons become clickable again instead of staying stuck.
function endRequestReply(key) {
  inFlightRequestReplies.delete(key)
  renderThreadContent()
}

async function submitQuestion(requestID, index, answer, sessionId = state.activeSessionId) {
  if (!sessionId) throw new Error("No active session for this question.")
  const key = beginRequestReply(sessionId, requestID)
  if (!key) return
  const thread = state.threads.get(sessionId)
  const request = (thread?.pendingQuestions || []).find((item) => item.requestID === requestID)
  const questionCount = Array.isArray(request?.questions) ? request.questions.length : 1
  // The runtime expects one answer entry per question prompt in the request.
  const answers = Array.from({ length: questionCount }, (_value, i) => (i === index ? answer : []))
  try {
    const outcome = await window.openworking.runtime.answerQuestion({ sessionId, requestID, answers })
    clearQuestionDrafts(sessionId, requestID)
    if (thread) clearPendingQuestion(thread, requestID)
    renderThreadContent()
    if (outcome && outcome.ok === false) showToast(EXPIRED_QUESTION_MESSAGE)
  } finally {
    endRequestReply(key)
  }
}

async function dismissQuestion(requestID, sessionId = state.activeSessionId) {
  if (!sessionId) throw new Error("No active session for this question.")
  const key = beginRequestReply(sessionId, requestID)
  if (!key) return
  try {
    const outcome = await window.openworking.runtime.rejectQuestion({ sessionId, requestID })
    clearQuestionDrafts(sessionId, requestID)
    const thread = state.threads.get(sessionId)
    if (thread) clearPendingQuestion(thread, requestID)
    renderThreadContent()
    if (outcome && outcome.ok === false) showToast(EXPIRED_QUESTION_MESSAGE)
  } finally {
    endRequestReply(key)
  }
}

// An expired request resolves to `{ ok: false, reason: "expired" }` rather than throwing, so the
// card is cleared on that path too. Leaving it on screen was the reason a stale card could be
// clicked over and over, each click reproducing the same raw 404. Genuine failures (network,
// 5xx) still throw, and the caller's .catch keeps the card so the user can retry.
async function replyPermission(requestID, decision, sessionId = state.activeSessionId) {
  if (!sessionId) throw new Error("No active session for this request.")
  const key = beginRequestReply(sessionId, requestID)
  if (!key) return
  try {
    const outcome = await window.openworking.runtime.replyPermission({ sessionId, requestID, reply: decision })

    // Clear the permission from the specific thread that owns it
    const thread = state.threads.get(sessionId)
    if (thread) clearPendingPermission(thread, requestID)

    renderThreadContent()
    if (outcome && outcome.ok === false) showToast(EXPIRED_PERMISSION_MESSAGE)
  } finally {
    endRequestReply(key)
  }
}

function formAnswerError(request, answer) {
  for (const field of activeFormFields(request, answer)) {
    const value = answer[field.key]
    if (field.type === "external" && value !== true) return `Complete ${field.title || field.description || field.key} before continuing.`
    if (field.required && (value === undefined || value === "" || (Array.isArray(value) && !value.length))) {
      return `Answer ${field.title || field.description || field.key} before continuing.`
    }
    if ((field.type === "number" || field.type === "integer") && value !== undefined && !Number.isFinite(value)) {
      return `Enter a valid number for ${field.title || field.description || field.key}.`
    }
  }
  return ""
}

async function submitForm(formID, sessionId = state.activeSessionId) {
  if (!sessionId) throw new Error("No active session for this form.")
  const thread = state.threads.get(sessionId)
  const request = (thread?.pendingForms || []).find((item) => item.id === formID)
  if (!request) return
  const answer = formDraft({ ...request, sessionId })
  const error = formAnswerError(request, answer)
  if (error) {
    showToast(error)
    return
  }
  const key = beginRequestReply(sessionId, formID)
  if (!key) return
  try {
    const submittedAnswer = Object.fromEntries(activeFormFields(request, answer).flatMap((field) => (
      answer[field.key] === undefined ? [] : [[field.key, answer[field.key]]]
    )))
    const outcome = await window.openworking.runtime.replyForm({ sessionId, formID, answer: submittedAnswer })
    if (thread) clearPendingForm(thread, formID)
    state.formDrafts.delete(formDraftKey(sessionId, formID))
    renderThreadContent()
    if (outcome && outcome.ok === false) showToast(EXPIRED_FORM_MESSAGE)
  } finally {
    endRequestReply(key)
  }
}

async function cancelForm(formID, sessionId = state.activeSessionId) {
  if (!sessionId) throw new Error("No active session for this form.")
  const key = beginRequestReply(sessionId, formID)
  if (!key) return
  try {
    const outcome = await window.openworking.runtime.cancelForm({ sessionId, formID })
    const thread = state.threads.get(sessionId)
    if (thread) clearPendingForm(thread, formID)
    state.formDrafts.delete(formDraftKey(sessionId, formID))
    renderThreadContent()
    if (outcome && outcome.ok === false) showToast(EXPIRED_FORM_MESSAGE)
  } finally {
    endRequestReply(key)
  }
}

// OpenCode forgets pending permissions/questions on runtime restart, session abort, and when a
// sibling permission is rejected — sometimes without publishing any event, and the SSE stream
// has no replay cursor to recover what was missed while it was down. Cards therefore outlive the
// requests they represent. Ask the runtime what is actually still pending and drop the rest.
async function reconcilePendingRequests() {
  if (state.runtime?.status !== "running") return
  const runtime = window.openworking?.runtime
  if (!runtime?.listPendingPermissions || !runtime?.listPendingQuestions) return
  const [permissions, questions, forms] = await Promise.all([
    runtime.listPendingPermissions().catch(() => null),
    runtime.listPendingQuestions().catch(() => null),
    runtime.listPendingForms ? runtime.listPendingForms().catch(() => null) : Promise.resolve(null)
  ])
  // The running server speaks only for its own project, so a card may only be evicted if its
  // session belongs to that project. Three sources, all authoritative for the active runtime:
  // the project's known sessions, the active session (which always belongs to it, and covers the
  // window before sessionsByProject has loaded), and any session the list itself names.
  const scopeSessionIds = new Set(
    projectSessions(state.runtime?.project?.id).map((session) => session.id).filter(Boolean)
  )
  if (state.activeSessionId) scopeSessionIds.add(state.activeSessionId)
  for (const item of [...(permissions || []), ...(questions || []), ...(forms || [])]) {
    if (item?.sessionID) scopeSessionIds.add(String(item.sessionID))
  }
  // `null` means the lookup failed; only an actual list is evidence a request is gone. Evicting
  // on a failed call would delete live cards the user still needs to answer.
  let changed = false
  if (Array.isArray(permissions)) {
    changed = evictMissingRequests("pendingPermissions", permissions, scopeSessionIds) || changed
  }
  if (Array.isArray(questions)) {
    changed = evictMissingRequests("pendingQuestions", questions, scopeSessionIds) || changed
  }
  if (Array.isArray(forms)) {
    for (const form of forms) {
      if (!form?.sessionID || !form?.id) continue
      const thread = ensureThread(String(form.sessionID))
      if (!Array.isArray(thread.pendingForms)) thread.pendingForms = []
      const index = thread.pendingForms.findIndex((item) => item.id === form.id)
      const normalized = { ...form, requestID: form.id }
      if (index === -1) {
        thread.pendingForms.push(normalized)
        changed = true
      } else {
        thread.pendingForms[index] = normalized
      }
    }
    changed = evictMissingRequests("pendingForms", forms, scopeSessionIds) || changed
  }
  if (changed) {
    renderThreadContent()
    renderSessionBadges()
  }
}

// The pending list comes from the ONE running server, which is spawned against a single project
// directory — it can only speak for sessions of the active project. state.threads, by contrast,
// outlives project switches (it is cleared only on project delete / logout), so it still holds
// threads from every project visited this launch. Sweeping those against this list would read
// "absent from the active project's runtime" as "expired" and silently delete another project's
// live cards. Restrict eviction to sessions the list is actually authoritative for.
function evictMissingRequests(field, alive, scopeSessionIds) {
  const liveIds = new Set(alive.map((item) => item?.requestID).filter(Boolean))
  let changed = false
  for (const [sessionId, thread] of state.threads.entries()) {
    if (!scopeSessionIds.has(sessionId)) continue
    const pending = thread?.[field]
    if (!Array.isArray(pending) || !pending.length) continue
    // A reply already in flight has likely been removed from the runtime's pending map, so the
    // list would report it as gone. Its own handler owns the card; leave it alone.
    const kept = pending.filter((item) => (
      liveIds.has(item.requestID) || inFlightRequestReplies.has(`${sessionId}:${item.requestID}`)
    ))
    if (kept.length === pending.length) continue
    thread[field] = kept
    changed = true
  }
  return changed
}

// All click/input/keydown/mousedown wiring now lives in the delegated #root listeners
// (installDelegatedListeners). bindEvents() keeps only the imperative, per-element bits that
// must run AFTER each render() rebuilds #root: focus/select of a freshly-rendered rename input,
// restoring focus to a session kebab after a rename, and sizing the prompt editor.
function bindEvents() {
  // Focus management lives in the island components ($effect on the autofocus flags); the only
  // imperative post-render bit left is sizing the prompt editor.
  const promptInput = document.getElementById("promptInput")
  if (promptInput) {
    autosizePromptEditor(promptInput)
  }
  // Wires listeners once and re-measures the thumb; the sidebar's content height changes as
  // projects expand and sessions stream in. Guarded because the scrollbar is decorative — it
  // must never be able to abort bindEvents() and leave the UI half-rendered.
  try {
    sideScrollbar.attach(document)
  } catch (error) {
    console.warn("side scrollbar sync failed", error)
  }
}

// Updates only the slash-command menu DOM in place, so the textarea value/caret/focus
// survive (a full render() would rebuild the composer and drop the caret).
function paintCommandMenu() {
  paintPromptAssistMenu()
}

function paintPromptAssistMenu() {
  promptAssistMenuIsland.paintInto()
}

function syncPromptAssist(promptInput) {
  // Typing resets menu navigation back to mouse control.
  state.promptAssistKeyboardActive = false
  const caret = promptEditorCaret(promptInput)
  const beforeCaret = state.promptDraft.slice(0, caret)
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
  const next = replaceComposerQuery({
    text: state.promptDraft,
    caret: promptEditorCaret(promptInput),
    trigger: "slash",
    label: command.name,
    path: commandTokenPath(command),
    source: command.source
  })
  state.promptDraft = next.text
  state.commandMenu = { open: false, query: "", index: 0 }
  state.fileMentionMenu.open = false
  promptInput.focus()
  syncPromptEditor(promptInput, next.caret)
  const send = document.querySelector(".send")
  if (send) send.classList.toggle("disabled", state.promptSubmitInFlight || !next.text.trim())
  paintPromptAssistMenu()
}

async function selectFileMention(filePath) {
  const promptInput = document.getElementById("promptInput")
  if (!filePath || !promptInput) {
    closeFileMentionMenu()
    return
  }
  const caret = promptEditorCaret(promptInput)
  const currentValue = state.promptDraft
  const after = currentValue.slice(caret)
  const next = replaceComposerQuery({
    text: currentValue,
    caret,
    trigger: "file",
    label: filename(filePath),
    path: filePath
  })
  const spacer = after && /^\s/.test(after) ? "" : " "
  state.promptDraft = spacer ? `${next.text}${spacer}` : next.text
  closeFileMentionMenu()
  promptInput.focus()
  syncPromptEditor(promptInput, next.caret + spacer.length)
  const send = document.querySelector(".send")
  if (send) send.classList.toggle("disabled", state.promptSubmitInFlight || !state.promptDraft.trim())
}

// Entry point for "Add to chat" from outside the composer (Files panel context menu,
// DocumentViewer header/selection button): inserts a file-mention token at the caret instead of
// replacing a trailing @query like selectFileMention does. Reuses promptEditorCaret's existing
// fallback to end-of-text when the editor isn't focused, so no separate check is needed here.
function insertFileMentionAtCaret(path, { label } = {}) {
  const filePath = String(path || "").trim()
  if (!filePath) return
  const token = canonicalToken(label || filename(filePath), filePath)
  const promptInput = document.getElementById("promptInput")
  const currentValue = state.promptDraft
  const caret = promptInput ? promptEditorCaret(promptInput) : currentValue.length
  const before = currentValue.slice(0, caret)
  const after = currentValue.slice(caret)
  const leftSpacer = before && !/\s$/.test(before) ? " " : ""
  const rightSpacer = after && /^\s/.test(after) ? "" : " "
  state.promptDraft = `${before}${leftSpacer}${token}${rightSpacer}${after}`
  const nextCaret = before.length + leftSpacer.length + token.length + rightSpacer.length
  if (promptInput) {
    promptInput.focus()
    syncPromptEditor(promptInput, nextCaret)
  }
  const send = document.querySelector(".send")
  if (send) send.classList.toggle("disabled", state.promptSubmitInFlight || !state.promptDraft.trim())
}

// Shared divider-drag driver. `apply(clientX)` sets the new width (clamped) and
// returns it; the latest width is persisted under `storageKey` on release.
// Width writes are coalesced into one rAF so we touch layout at most once per
// frame, and `.app.resizing` suppresses every panel transition so the dragged
// edge tracks the cursor 1:1 instead of easing toward each new value.
// `onClick` (optional) fires when the pointer is released without moving — used
// by the sidebar divider to double as a collapse toggle.
function startDividerResize(event, { apply, storageKey, initialWidth, onClick, axis = "x" }) {
  event.preventDefault()
  state.panelResizing = true
  render()
  document.body.style.cursor = axis === "y" ? "row-resize" : "col-resize"
  document.body.style.userSelect = "none"

  let width = initialWidth
  let moved = false
  let pendingPos = null
  let frame = null
  const flush = () => {
    frame = null
    if (pendingPos === null) return
    width = apply(pendingPos)
    pendingPos = null
  }
  const onMove = (moveEvent) => {
    moved = true
    pendingPos = axis === "y" ? moveEvent.clientY : moveEvent.clientX
    if (frame === null) frame = requestAnimationFrame(flush)
  }
  const onUp = () => {
    document.removeEventListener("mousemove", onMove)
    document.removeEventListener("mouseup", onUp)
    if (frame !== null) { cancelAnimationFrame(frame); flush() }
    state.panelResizing = false
    render()
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    if (!moved) {
      if (onClick) onClick()
      return
    }
    localStorage.setItem(storageKey, String(width))
  }
  document.addEventListener("mousemove", onMove)
  document.addEventListener("mouseup", onUp)
}

function startSidebarResize(event) {
  const sidebar = document.querySelector(".sidebar")
  if (!sidebar) return
  const left = sidebar.getBoundingClientRect().left
  startDividerResize(event, {
    apply: (clientX) => setSidebarWidth(clientX - left),
    storageKey: SIDEBAR_WIDTH_KEY,
    initialWidth: SIDEBAR_MIN_WIDTH,
    onClick: toggleSidebar,
  })
}

// In stacked mode, the "right-file-resizer" sits between Files (top) and Code (bottom) instead
// of beside Files, becoming the vertical divider that drags --stacked-top-h up/down.
function startStackedSplitResize(event) {
  const topPanel = document.querySelector(".right-file-sidebar")
  if (!topPanel) return
  const startY = event.clientY
  const startHeight = topPanel.getBoundingClientRect().height
  startDividerResize(event, {
    apply: (clientY) => setStackedTopHeight(startHeight + clientY - startY),
    storageKey: STACKED_TOP_HEIGHT_KEY,
    initialWidth: startHeight,
    axis: "y",
  })
}

function startRightFileSidebarResize(event) {
  // Route on whether the stacked layout is ACTUALLY in effect, not just on the flag. Every stacked
  // rule in styles.css is scoped to `.app.has-doc…`, so with no document open the layout is plain
  // side-by-side and --stacked-top-h is read by nothing. The flag alone would send the drag to the
  // vertical split and the resizer would look dead: hover still shows the resize cursor, the drag
  // still runs, nothing moves. Worse, the flag persists and its only off-switch (the layout toggle
  // in RightFileSidebar.svelte) is itself hidden while no document is open, so closing the document
  // used to strand the sidebar as permanently unresizable.
  if (stackedRightPanelsActive()) {
    startStackedSplitResize(event)
    return
  }
  const sidebar = document.querySelector(".right-file-sidebar")
  if (!sidebar) return
  const startX = event.clientX
  const startWidth = sidebar.getBoundingClientRect().width
  startDividerResize(event, {
    apply: (clientX) => setRightFileSidebarWidth(startWidth + startX - clientX),
    storageKey: RIGHT_FILE_WIDTH_KEY,
    initialWidth: startWidth,
  })
}

// The resizer sits at the dock's TOP edge; dragging up (negative clientY delta) must grow the
// dock since it's anchored to the bottom of .main — the inverse sign from startStackedSplitResize,
// whose resizer sits below a TOP panel where dragging down grows it.
function startTerminalDockResize(event) {
  const dock = document.querySelector(".terminal-dock")
  if (!dock) return
  const startY = event.clientY
  const startHeight = dock.getBoundingClientRect().height
  startDividerResize(event, {
    apply: (clientY) => setTerminalDockHeight(startHeight - (clientY - startY)),
    storageKey: TERMINAL_DOCK_HEIGHT_KEY,
    initialWidth: startHeight,
    axis: "y",
  })
}

function startDocumentViewerResize(event) {
  const viewer = document.querySelector(".document-viewer")
  if (!viewer) return
  const startX = event.clientX
  const startWidth = viewer.getBoundingClientRect().width
  if (state.stackedRightPanels) {
    startDividerResize(event, {
      apply: (clientX) => setStackedRightWidth(startWidth + startX - clientX),
      storageKey: STACKED_RIGHT_WIDTH_KEY,
      initialWidth: startWidth,
    })
    return
  }
  startDividerResize(event, {
    apply: (clientX) => setDocumentViewerWidth(startWidth + startX - clientX),
    storageKey: DOCUMENT_WIDTH_KEY,
    initialWidth: startWidth,
  })
}

async function copyMessage(messageId) {
  const message = activeThread().messages.find((item) => item.id === messageId)
  const text = message ? messageCopyText(message) : ""
  if (!text) return
  await window.openworking.clipboard.writeText(text)
  showToast("Message copied")
}

function sessionRevertAvailable(sessionId = state.activeSessionId) {
  if (!sessionId || sessionBusy(sessionId)) return false
  const compaction = state.runtime?.compactionStatuses?.[sessionId]
  return compaction?.status !== "admitted" && compaction?.status !== "running"
}

function refreshProjectFilesAfterRevertEvent(sessionId) {
  const projectId = Object.entries(state.sessionsByProject).find(([, sessions]) =>
    Array.isArray(sessions) && sessions.some((session) => session?.id === sessionId)
  )?.[0] || (sessionId === state.activeSessionId ? state.activeProjectId : null)
  if (!projectId) return
  resetFileTree(projectId)
  ensureGitInfo(projectId, { force: true }).catch(() => {})
  if (state.rightSidebarOpen && projectId === state.activeProjectId) {
    loadFileTreeDirectory("").catch((error) => showToast(error.message))
  }
}

function rawUserMessageText(message) {
  if (message?.role !== "user") return ""
  const projected = (messageText(message, selectableProjectFiles()) || "").trim()
  if (projected) return projected
  return (message.parts || [])
    .filter((part) => part.type === "text" && !part.synthetic)
    .map((part) => part.text || "")
    .join("\n\n")
    .trim()
}

function openRevertConfirmation(messageId, { restoreDraft = false } = {}) {
  const sessionId = state.activeSessionId
  const project = selectedProject()
  if (!sessionId || !project) throw new Error("Select a chat before undoing it.")
  if (!sessionRevertAvailable(sessionId)) throw new Error("Wait for the session to finish before undoing it.")
  const messages = activeThread().messages || []
  const index = messages.findIndex((message) => message.id === messageId)
  const message = index === -1 ? null : messages[index]
  if (!message || message.role !== "user") throw new Error("Only user messages can be used as a revert boundary.")
  const existingDraft = state.revertDraftBySession.get(sessionId)
  const projectFiles = selectableProjectFiles()
  const projectedFileRefs = userMessageFileRefs(message, projectFiles)
  const fileRefs = projectedFileRefs.length
    ? projectedFileRefs
    : (message.parts || []).filter((part) => part.type === "file-ref")
  if (
    restoreDraft &&
    !activeSessionRevert() &&
    (state.promptDraft.trim() || state.pendingAttachments.length || state.pendingFileMentions.length)
  ) {
    throw new Error("Send or clear the current draft before undoing the last prompt.")
  }
  const gitInfo = state.gitInfoByProject.get(project.id)
  state.revertConfirmTarget = {
    sessionId,
    projectId: project.id,
    messageId,
    restoreDraft,
    text: rawUserMessageText(message),
    fileRefs: fileRefs.map((part) => ({
      token: part.token,
      path: part.path,
      name: part.name
    })),
    attachmentNames: [
      ...(existingDraft?.attachmentNames || []),
      ...(message.parts || []).filter((part) => part.type === "file").map((part) => part.filename)
    ].filter((name, nameIndex, names) => name && names.indexOf(name) === nameIndex),
    messageCount: Math.max(
      1,
      messages.slice(index).filter((item) => item.role === "user" || item.role === "assistant").length
    ) + (existingDraft?.messageCount || 0),
    isGitRepo: Boolean(gitInfo?.isGitRepo),
    repeated: Boolean(existingDraft)
  }
  state.revertError = null
  state.revertSubmitting = false
  state.popover = null
  render()
}

function undoLastPrompt() {
  const messages = activeThread().messages || []
  const message = [...messages].reverse().find((item) => item.role === "user" && rawUserMessageText(item))
  if (!message) throw new Error("There is no user prompt to undo.")
  openRevertConfirmation(message.id, { restoreDraft: true })
}

async function refreshAfterRevert(projectId, sessionId, operation) {
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) throw new Error("Could not find that chat's project.")
  const directory = selectedSession()?.directory || project.activeWorktreePath || project.path
  const result = await runWithRuntimeProject(projectId, async () => {
    const value = await operation()
    const [sessions, messages, pendingInputs] = await Promise.all([
      window.openworking.runtime.listSessions(),
      window.openworking.runtime.listMessages({ sessionId, directory }),
      listPendingInputsForSession(sessionId)
    ])
    return { value, sessions, messages, pendingInputs }
  })
  setProjectSessions(projectId, result.sessions, "active")
  const thread = ensureThread(sessionId)
  hydrateThread(thread, sessionId, result.messages, state.runtime?.sessionStatuses?.[sessionId], result.pendingInputs)
  applyPersistedPromptMetadataToThread(sessionId, thread)
  resetFileTree(projectId)
  ensureGitInfo(projectId, { force: true }).catch(() => {})
  if (state.rightSidebarOpen && projectId === state.activeProjectId) {
    loadFileTreeDirectory("").catch((error) => showToast(error.message))
  }
  return result.value
}

async function confirmStageSessionRevert() {
  const target = state.revertConfirmTarget
  if (!target || state.revertSubmitting) return
  state.revertSubmitting = true
  state.revertError = null
  render()
  try {
    const revert = await refreshAfterRevert(target.projectId, target.sessionId, () => (
      window.openworking.runtime.stageSessionRevert({
        sessionId: target.sessionId,
        messageId: target.messageId,
        files: true
      })
    ))
    state.revertDraftBySession.set(target.sessionId, {
      restoreDraft: Boolean(target.restoreDraft || state.revertDraftBySession.get(target.sessionId)?.restoreDraft),
      messageCount: target.messageCount,
      attachmentNames: target.attachmentNames
    })
    updateSessionMetadata(target.sessionId, { revert })
    if (target.restoreDraft) {
      state.promptDraft = target.text
      state.pendingFileMentions = target.fileRefs
    }
    state.revertConfirmTarget = null
    if (target.attachmentNames.length) {
      showToast(`Reattach ${target.attachmentNames.length} external file${target.attachmentNames.length === 1 ? "" : "s"} before sending.`)
    }
    render({ threadScroll: "latest" })
  } catch (error) {
    state.revertError = error.message || "Could not stage the revert."
  } finally {
    state.revertSubmitting = false
    render()
  }
}

async function settleSessionRevert(action) {
  const sessionId = state.activeSessionId
  const project = selectedProject()
  if (!sessionId || !project || !activeSessionRevert()) return
  const draft = state.revertDraftBySession.get(sessionId)
  const operation = action === "clear"
    ? () => window.openworking.runtime.clearSessionRevert({ sessionId })
    : () => window.openworking.runtime.commitSessionRevert({ sessionId })
  await refreshAfterRevert(project.id, sessionId, operation)
  updateSessionMetadata(sessionId, { revert: null })
  if (action === "clear" && draft?.restoreDraft) {
    state.promptDraft = ""
    state.pendingFileMentions = []
  }
  state.revertDraftBySession.delete(sessionId)
  showToast(action === "clear" ? "Revert redone" : "Revert kept")
  render({ threadScroll: "latest" })
}

async function forkAssistantMessage(messageId) {
  const project = selectedProject()
  const sessionId = state.activeSessionId
  if (!project || !sessionId) throw new Error("Select a chat before forking it.")
  const thread = activeThread()
  const messages = thread.messages || []
  const index = messages.findIndex((item) => item.id === messageId)
  const message = index === -1 ? null : messages[index]
  if (!message || message.role !== "assistant") throw new Error("Only assistant responses can be forked.")

  const runtimeAlive = state.runtime?.status === "running" || state.runtime?.status === "starting"
  if (!runtimeAlive) {
    await openProject(project.id, { selectLatest: false })
  }

  const nextMessageId = messages[index + 1]?.id
  const directory = selectedSession()?.directory || project.path
  const forked = await window.openworking.runtime.forkSession({
    sessionId,
    ...(nextMessageId ? { messageId: nextMessageId } : {}),
    directory
  })
  if (!forked?.id) throw new Error("OpenCode did not return a forked session.")

  flushActiveStreamPacing()
  const forkedModel = normalizeModelRef(forked.model || currentModelRef())
  if (forkedModel) state.modelRefBySession.set(forked.id, forkedModel)
  if (forked.agent) state.agentBySession.set(forked.id, forked.agent)
  state.activeProjectId = project.id
  state.activeSessionId = forked.id
  state.nav = "session"
  state.expanded.add(project.id)
  persistExpanded()

  const sessions = typeof window.openworking.runtime.listSessionsForDirectory === "function"
    ? await window.openworking.runtime.listSessionsForDirectory(project.path)
    : await window.openworking.runtime.listSessions()
  setProjectSessions(
    project.id,
    sessions.length ? sessions : [forked, ...projectSessions(project.id)],
    sessions.length ? "directory" : "active"
  )
  const [forkMessages, forkPendingInputs] = await Promise.all([
    window.openworking.runtime.listMessages({ sessionId: forked.id, directory: project.path }),
    listPendingInputsForSession(forked.id)
  ])
  state.forkMarkers.set(forked.id, forkMessages[forkMessages.length - 1]?.id || null)
  hydrateActiveThread(forkMessages, state.runtime?.sessionStatuses?.[forked.id], forkPendingInputs)
  showToast("Chat forked")
  render({ threadScroll: "latest" })
}

async function openArtifact(artifactPath) {
  if (!artifactPath) return
  const context = selectedProjectContext()
  if (!context) return
  showDocument({ requestedPath: artifactPath, path: artifactPath, name: filename(artifactPath), relativePath: "", content: "", loading: true, error: "", artifact: true, previewMode: "loading", renderMode: "markdown", tab: "code" })
  try {
    const preview = await window.openworking.artifacts.preview(artifactPath, context)
    if (state.document?.requestedPath !== artifactPath) return
    const renderMode = preview.previewMode === "markdown" ? "markdown" : preview.previewMode
    state.document = { requestedPath: artifactPath, ...preview, artifact: true, loading: false, error: "", renderMode, tab: "code" }
  } catch (error) {
    if (state.document?.requestedPath !== artifactPath) return
    state.document = { requestedPath: artifactPath, path: artifactPath, name: filename(artifactPath), relativePath: "", content: "", loading: false, error: ipcErrorMessage(error), artifact: true, previewMode: "error", renderMode: "markdown", tab: "code" }
  }
  if (!paintDocumentViewer()) render()
}

async function openArtifactExternally(artifactPath) {
  const context = selectedProjectContext()
  if (!context) return
  await window.openworking.artifacts.open(artifactPath, context)
  showToast("Artifact opened")
}

// Keyed action table (same shape as the DELEGATED_* tables). Each entry maps a data-action value to
// a handler that receives the click event. Replaces a 140-line sequential if-chain; behavior is
// identical because every action string was unique (at most one branch ever matched), and the few
// early `return`s in the old chain are preserved as early returns inside each handler.
const ACTION_HANDLERS = {
  retryProfile: () => retryProfile(),
  openProfileFolder: () => openProfileFolder(),
  onboardingNext: () => advanceOnboarding(1),
  onboardingBack: () => advanceOnboarding(-1),
  onboardingSkip: () => skipOnboarding(),
  onboardingDone: () => finishOnboarding(),
  replayOnboarding: () => startOnboarding({ replay: true }),
  addProject: () => addProject(),
  addProjectFromComposer: () => addProjectFromComposer(),
  collapseAll: () => {
    state.expanded.clear()
    persistExpanded()
    scheduleSidebarRender()
  },
  toggleSidebar: () => toggleSidebar(),
  toggleRightSidebar: () => toggleRightSidebar(),
  toggleTerminalPanel: () => toggleTerminalPanel(),
  refreshVcs: () => { loadVcsStatus().catch(() => {}) },
  newSession: () => newSession(state.activeProjectId),
  togglePlanMode: () => {
    // Keep the "+" popover open so the user can see the switch flip.
    state.mode = state.mode === "plan" ? "agent" : "plan"
    render()
  },
  acceptPlan: () => acceptPlan(),
  rejectPlan: () => rejectPlan(),
  revisePlan: () => { document.getElementById("promptInput")?.focus() },
  togglePlanCard: () => { state.planCardExpanded = !state.planCardExpanded; scheduleThreadRender() },
  toggleAgentProgress: (event) => {
    const messageId = event.currentTarget.dataset.progressMessage
    if (!messageId) return
    if (state.agentProgressExpanded.has(messageId)) state.agentProgressExpanded.delete(messageId)
    else state.agentProgressExpanded.add(messageId)
    scheduleThreadRender()
  },
  sendPrompt: () => sendPrompt(state.promptDraft),
  steerPrompt: () => {
    state.popover = null
    sendPrompt(state.promptDraft, { delivery: "steer" })
  },
  abortSession: () => abortSession(),
  saveConfig: () => saveConfig(),
  addSuperpowers: () => addSuperpowers(),
  openSkillUpload: () => {
    state.skillUploadOpen = true
    state.skillUploadError = null
    render()
  },
  closeSkillUpload: () => {
    state.skillUploadOpen = false
    state.skillUploadError = null
    render()
  },
  chooseSkillArchive: () => uploadSkill(),
  closeSkillPreview: () => {
    if (state.skillUninstalling) return
    state.skillPreview = null
    state.skillPreviewContent = null
    state.skillPreviewError = null
    render()
  },
  uninstallSkill: (event) => uninstallSkill(event.currentTarget.dataset.skillName),
  openReferenceForm: () => openReferenceForm(),
  closeReferenceForm: () => closeReferenceForm(),
  addReference: () => addReference(),
  openTerminalConfirm: () => openTerminalConfirm(),
  closeTerminalConfirm: () => closeTerminalConfirm(),
  confirmOpenTerminal: () => confirmOpenTerminal(),
  reconnectTerminal: () => reconnectTerminal(),
  closeTerminal: () => closeTerminal(),
  openMcpModal: () => openMcpModal(),
  closeMcpModal: () => closeMcpModal(),
  submitMcpServer: () => submitMcpServer(),
  connectPreset: (event) => openMcpModalForPreset(event.currentTarget.dataset.presetId),
  editMcp: (event) => openMcpModalForEdit(event.currentTarget.dataset.mcpName),
  toggleMcpAdvanced: () => {
    state.mcpDraft.oauthAdvancedOpen = !state.mcpDraft.oauthAdvancedOpen
    render()
  },
  openMcpDocs: async (event) => {
    const url = event.currentTarget.dataset.docsUrl
    if (url) await window.openworking.mcp.openDocs(url)
  },
  openPermissionsModal: () => openPermissionsModal(),
  closePermissionsModal: () => closePermissionsModal(),
  revokeSavedPermission: (event) => revokeSavedPermission(event.currentTarget.dataset.permissionId),
  installBrowserHost: () => installBrowserHost(),
  openBrowserExtension: () => openBrowserExtension(),
  openBrowserSetup: () => openBrowserSetup(),
  closeBrowserSetup: () => closeBrowserSetup(),
  addMcpHeader: () => {
    state.mcpDraft.headers = [...(state.mcpDraft.headers || []), { key: "", value: "" }]
    render()
  },
  removeMcpHeader: (event) => {
    const index = Number(event.currentTarget.dataset.mcpHeaderIndex)
    state.mcpDraft.headers = (state.mcpDraft.headers || []).filter((_, i) => i !== index)
    render()
  },
  addMcpEnv: () => {
    state.mcpDraft.env = [...(state.mcpDraft.env || []), { key: "", value: "" }]
    render()
  },
  removeMcpEnv: (event) => {
    const index = Number(event.currentTarget.dataset.mcpEnvIndex)
    state.mcpDraft.env = (state.mcpDraft.env || []).filter((_, i) => i !== index)
    render()
  },
  removeMcp: (event) => {
    state.mcpDeleteTarget = { name: event.currentTarget.dataset.mcpName }
    state.mcpRemoving = false
    render()
  },
  authenticateMcp: (event) => authenticateMcp(event.currentTarget.dataset.mcpName),
  clearMcpAuth: (event) => authenticateMcp(event.currentTarget.dataset.mcpName, { clear: true }),
  retryMcp: (event) => reconnectMcp(event.currentTarget.dataset.mcpName),
  cancelRemoveMcp: () => {
    if (state.mcpRemoving) return
    state.mcpDeleteTarget = null
    render()
  },
  confirmRemoveMcp: () => confirmRemoveMcp(),
  cancelDeleteSession: () => {
    if (state.sessionDeleting) return
    state.sessionDeleteTarget = null
    state.sessionDeleteError = null
    render()
  },
  confirmDeleteSession: () => confirmDeleteSession(),
  cancelRenameSession: () => closeRenameSessionModal(),
  confirmRenameSession: () => confirmRenameSession(),
  cancelRemoveProject: () => {
    if (state.projectRemoving) return
    state.projectDeleteTarget = null
    state.projectDeleteError = null
    render()
  },
  confirmRemoveProject: async () => {
    const target = state.projectDeleteTarget
    if (!target || state.projectRemoving) return
    state.projectRemoving = true
    state.projectDeleteError = null
    render()
    try {
      await removeProject(target.id)
      state.projectDeleteTarget = null
    } catch (error) {
      state.projectDeleteError = ipcErrorMessage(error)
    } finally {
      state.projectRemoving = false
      render()
    }
  },
  cancelRenameProject: () => closeRenameProjectModal(),
  confirmRenameProject: () => confirmRenameProject(),
  toggleDiagnostics: () => {
    state.diagnosticsOpen = !state.diagnosticsOpen
    render()
  },
  stopRuntime: async () => {
    await window.openworking.runtime.stop()
    render()
  },
  compactSession: () => compactActiveSession(),
  undoSession: () => undoLastPrompt(),
  cancelSessionRevert: () => {
    if (state.revertSubmitting) return
    state.revertConfirmTarget = null
    state.revertError = null
    render()
  },
  confirmSessionRevert: () => confirmStageSessionRevert(),
  redoSessionRevert: () => settleSessionRevert("clear"),
  commitSessionRevert: () => settleSessionRevert("commit"),
  closeDocument: () => closeDocument(),
  openExternalArtifact: (event) => openArtifactExternally(event.currentTarget.dataset.artifactPath),
  attachment: async () => {
    // Triggered from the "+" popover - close it so the menu does not stay open.
    state.popover = null
    await pickAttachments()
  },
  startUpdate: () => startUpdateDownload()
}

async function handleAction(event) {
  try {
    const handler = ACTION_HANDLERS[event.currentTarget.dataset.action]
    if (handler) await handler(event)
  } catch (error) {
    showToast(error.message)
  }
}

async function addProject({ stripProjectFiles = false } = {}) {
  const project = await window.openworking.projects.add()
  if (!project) return
  state.projects = await window.openworking.projects.list()
  if (stripProjectFiles) {
    state.promptDraft = stripProjectFileContext(state.promptDraft)
    await clearPendingAttachments()
  }
  await newSession(project.id, { clearAttachments: !stripProjectFiles })
}

async function addProjectFromComposer() {
  state.popover = null
  state.newSessionProjectQuery = ""
  await addProject({ stripProjectFiles: true })
}

async function pickAttachments() {
  const picked = await window.openworking.attachments.pick()
  const model = selectedModel()
  const unsupported = unsupportedAttachments(picked, model)
  const supported = unsupported.length ? picked.filter((attachment) => !unsupported.includes(attachment)) : picked
  const known = new Set(state.pendingAttachments.map((attachment) => attachment.id))
  for (const attachment of supported) {
    if (known.has(attachment.id)) continue
    known.add(attachment.id)
    state.pendingAttachments.push(attachment)
  }
  if (unsupported.length) {
    const ids = unsupported.map((attachment) => attachment.id)
    await window.openworking.attachments.discard(ids).catch(() => {})
    const names = unsupported.map((attachment) => attachment.filename).join(", ")
    showToast(`${model?.name || "The selected model"} doesn't support: ${names}`)
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
  const currentValue = state.promptDraft
  const next = currentValue.replace(token, "").replace(/\s{2,}/g, " ")
  state.pendingFileMentions = state.pendingFileMentions.filter((fileMention) => fileMention.token !== token)
  state.promptDraft = next
  render()
  const freshInput = document.getElementById("promptInput")
  if (freshInput) {
    freshInput.focus()
    const caret = next.length
    syncPromptEditor(freshInput, caret)
  }
}

async function clearPendingAttachments() {
  const ids = state.pendingAttachments.map((attachment) => attachment.id)
  state.pendingAttachments = []
  state.pendingFileMentions = []
  if (ids.length) await window.openworking.attachments.discard(ids)
}

function stripProjectFileContext(promptText, fileMentions = state.pendingFileMentions) {
  let prompt = parsePromptTokens(promptText)
    .map((part) => part.type === "token" && part.kind === "file" ? "" : part.type === "token" ? part.raw : part.text)
    .join("")
  for (const fileMention of fileMentions) {
    if (!fileMention?.token) continue
    prompt = prompt.replace(fileMentionTokenPattern(fileMention.token), (_, prefix) => prefix)
  }
  return prompt.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim()
}

function fillSuggestion(index) {
  const suggestion = chips[Number(index)]
  if (!suggestion) return
  state.promptDraft = suggestion.text
  state.popover = null
  render()
  const promptInput = document.getElementById("promptInput")
  if (!promptInput) return
  promptInput.focus()
  syncPromptEditor(promptInput, state.promptDraft.length)
}

function promptSubmissionBlocksNavigation() {
  if (!state.promptSubmitInFlight) return false
  showToast("Wait for the current prompt to be admitted before switching chats.")
  return true
}

async function switchNewSessionProject(projectId) {
  if (promptSubmissionBlocksNavigation()) return
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) return
  state.popover = null
  state.newSessionProjectQuery = ""
  if (project.id === state.activeProjectId) {
    render()
    document.getElementById("promptInput")?.focus()
    return
  }
  state.promptDraft = stripProjectFileContext(state.promptDraft)
  await clearPendingAttachments()
  await openProject(project.id, { selectLatest: false })
  document.getElementById("promptInput")?.focus()
}

async function abortSession() {
  if (!state.activeSessionId || !threadAbortable()) return
  flushActiveStreamPacing()
  await window.openworking.runtime.abortSession({ sessionId: state.activeSessionId })
}

// Called once after `session.compaction.ended` (see applyRuntimeStreamEvent). A failed fetch
// leaves the existing stale placeholder in place; the ring recovers on the session's next reply
// via contextWindowUsage regardless.
async function refreshSessionContextUsage(sessionId) {
  try {
    const result = await window.openworking.runtime.sessionContext({ sessionId })
    const usage = { ...(state.runtime?.sessionContextUsage || {}), [sessionId]: typeof result?.inputTokens === "number" ? result.inputTokens : null }
    if (state.runtime) state.runtime = { ...state.runtime, sessionContextUsage: usage }
    if (sessionId === state.activeSessionId) render()
  } catch {
    // Leave the stale placeholder; see the comment above.
  }
}

async function compactActiveSession() {
  const sessionId = state.activeSessionId
  if (!sessionId) return
  const current = state.runtime?.compactionStatuses?.[sessionId]
  if (current?.status === "admitted" || current?.status === "running") return
  const statuses = {
    ...(state.runtime?.compactionStatuses || {}),
    [sessionId]: { status: "admitted", reason: "manual" }
  }
  state.runtime = { ...state.runtime, compactionStatuses: statuses }
  render()
  try {
    await window.openworking.runtime.compactSession({ sessionId })
  } catch (error) {
    statuses[sessionId] = { status: "failed", reason: "manual", error: error.message || "Compaction failed." }
    state.runtime = { ...state.runtime, compactionStatuses: { ...statuses } }
    render()
    showToast(error.message || "Compaction failed.")
  }
}

async function openProject(projectId, { selectLatest = true } = {}) {
  if (promptSubmissionBlocksNavigation()) return
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) return
  const sameProject = state.activeProjectId === projectId
  if (sameProject && state.expanded.has(projectId) && state.nav === "session" && state.runtime?.status === "running" && state.runtime?.project?.id === projectId) {
    state.expanded.delete(projectId)
    persistExpanded()
    render()
    return
  }
  const switchingProject = state.activeProjectId !== projectId
  state.activeProjectId = projectId
  if (switchingProject) resetMemorySelectionToActiveProject()
  resetFileTree(projectId)
  syncTerminalForActiveProject()
  state.activeSessionId = null
  resetActiveThread()
  state.nav = "session"
  state.expanded.add(projectId)
  persistExpanded()
  await activateProjectRuntime(project, { selectLatest, switchingProject })
}

function toggleProject(projectId) {
  if (!state.projects.some((project) => project.id === projectId)) return
  state.expanded.has(projectId) ? state.expanded.delete(projectId) : state.expanded.add(projectId)
  persistExpanded()
  scheduleSidebarRender()
}

// Restarts the OpenCode runtime for `project` (or, for a worktree switch, an object with the
// same id/name but a different `path`) and reloads its session list. Shared by openProject
// (switching between projects) and switchWorktree (switching worktree within the same
// project) — the latter must always restart even though activeProjectId doesn't change, which
// is why this is split out from openProject's "already open, just toggle" short-circuit above.
async function activateProjectRuntime(project, { selectLatest = true, switchingProject = true, preserveSession = false } = {}) {
  await clearPendingAttachments()
  flushActiveStreamPacing()
  const sessionLoadGeneration = !preserveSession ? markProjectSessionLoading(project.id) : null
  state.commands = []
  state.loading = true
  let scrollLatest = false
  let runtimeReady = false
  render()
  try {
    state.runtime = await window.openworking.runtime.openProject(project)
    runtimeReady = state.runtime?.status === "running"
    // preserveSession (worktree switch within the same project) intentionally skips all of
    // this: OpenCode's session list is scoped to the runtime's cwd, so replacing it here would
    // make the currently-viewed session vanish from state.sessionsByProject and bounce the
    // screen to "New session". The background loadAllSessions() sweep below still refreshes
    // the sidebar (via scheduleSidebarRender, not a full render), so it stays eventually
    // accurate without disturbing what's on screen right now.
    if (!preserveSession) {
      const sessions = await loadProjectSessions(project.id)
      // Opening a different project's runtime drops the old project's sessions — clear
      // their in-memory threads so background state from another workspace can't leak.
      if (switchingProject) pruneThreads(sessions.map((session) => session.id))
      if (selectLatest && sessions[0]) {
        state.activeSessionId = sessions[0].id
        await loadSessionMessages(project, sessions[0].id)
        scrollLatest = true
      }
    }
  } catch (error) {
    // The runtime failed to start (e.g. macOS blocked file access to the project folder
    // after an upgrade). Surface it as an error toast rather than silently rendering an
    // empty session list that looks like the project simply has no history.
    const currentLoad = projectSessionLoad(project.id)
    if (!preserveSession && currentLoad.status === "loading" && currentLoad.generation === sessionLoadGeneration) {
      failProjectSessionLoad(project.id, error)
    }
    showToast(error?.message || "Could not open this workspace.")
  } finally {
    state.loading = false
    render({ threadScroll: scrollLatest ? "latest" : "preserve" })
  }
  if (runtimeReady) {
    window.openworking.runtime.listCommands().then((commands) => {
      if (state.runtime?.project?.id !== project.id) return
      state.commands = commands
      state.commandMenu = { open: false, query: "", index: 0 }
      // Command/skill chips rendered above as literal text since state.commands was
      // still empty; repaint now that it's known so they resolve to tokens.
      scheduleThreadRender()
    }).catch(() => {})
    // Branch/worktree metadata is optional and must not delay the visible chat history.
    // The session UI has already rendered above; await only to preserve activateProjectRuntime's
    // existing completion contract for callers such as switchWorktree.
    await ensureGitInfo(project.id, { force: true }).catch(() => {})
  }
  // Fill the other expanded/pinned accordions' history AFTER the active project has settled, so a
  // slow/failed background fetch never delays or breaks the active load. Fire-and-forget; repaint
  // when done. The in-flight guard coalesces this with refreshSessionData's trigger.
  loadAllSessions().then(() => scheduleSidebarRender()).catch(() => {})
  if (state.rightSidebarOpen) {
    // Covers both opening a project and switching worktree within one: the runtime's cwd moved,
    // so whichever right-hand tab is open is now describing the wrong directory.
    if (state.rightSidebarTab === "changes") {
      resetVcsState(project.id)
      loadVcsStatus().catch(() => {})
    } else {
      loadFileTreeDirectory("").catch((error) => showToast(error.message))
    }
  }
}

// Loads git branch/worktree info for `projectId` into state.gitInfoByProject. Keyed by project,
// so the response always lands in that project's own cache slot — a slow/stale response can never
// overwrite a different project's entry, which is what made the old single-global gitInfo leak
// across projects. Deduped via gitInfoLoading unless `force` (used after our own checkout/switch
// mutations, where a warm cache entry must be replaced). Returns a promise callers may await.
function ensureGitInfo(projectId, { force = false } = {}) {
  if (!projectId) return Promise.resolve()
  if (!force && (state.gitInfoByProject.has(projectId) || state.gitInfoLoading.has(projectId))) {
    return Promise.resolve()
  }
  const api = window.openworking?.git
  if (!api?.info) return Promise.resolve()
  const notGit = { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }
  state.gitInfoLoading.add(projectId)
  return Promise.resolve()
    .then(() => api.info(projectId))
    // Always cache a definite value (a falsy response falls back to notGit). renderGitControl
    // re-triggers this whenever the cache entry is `undefined`, so leaving it unset on a falsy
    // response would spin an endless render→ensureGitInfo→scheduleRender loop.
    .then((info) => { state.gitInfoByProject.set(projectId, info || notGit) })
    .catch(() => { state.gitInfoByProject.set(projectId, notGit) })
    .finally(() => {
      state.gitInfoLoading.delete(projectId)
      scheduleRender()
    })
}

// Turns a raw git IPC rejection into a user-facing message. The rejected message reads like
// "Error invoking remote method 'git:checkoutBranch': Error: error: <git stderr>". Git's stderr
// usually ends with an actionable "Please … Aborting" hint — that's the only part worth showing,
// so surface it when present; otherwise strip the Electron/Error/error: prefixes so the toast shows
// git's own text without the IPC noise.
function gitErrorMessage(error, fallback) {
  const raw = String(error?.message || "")
  const hint = raw.match(/Please [\s\S]*/)
  if (hint) return hint[0].trim()
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    .replace(/^(?:Error:\s*)+/i, "")
    .replace(/^error:\s*/i, "")
    .trim()
  return cleaned || fallback
}

async function switchWorktree(worktreePath) {
  if (promptSubmissionBlocksNavigation()) return
  const project = selectedProject()
  if (!project || worktreePath === (project.activeWorktreePath || project.path)) {
    state.popover = null
    render()
    return
  }
  state.popover = null
  state.loading = true
  render()
  try {
    const { project: updatedProject } = await window.openworking.git.switchWorktree(project.id, worktreePath)
    state.projects = state.projects.map((item) => (item.id === updatedProject.id ? updatedProject : item))
    await activateProjectRuntime({ ...updatedProject, path: updatedProject.activeWorktreePath || updatedProject.path }, { preserveSession: true })
  } catch (error) {
    state.loading = false
    showToast(gitErrorMessage(error, "Could not switch worktree."))
    render()
  }
}

async function checkoutBranch(branchName) {
  const project = selectedProject()
  if (!project) return
  if (state.gitInfoByProject.get(project.id)?.currentBranch === branchName) {
    state.popover = null
    render()
    return
  }
  state.popover = null
  render()
  try {
    await window.openworking.git.checkoutBranch(project.id, branchName)
    await ensureGitInfo(project.id, { force: true })
    // The working copy just moved to another branch, so any listed change is stale.
    if (state.rightSidebarOpen && state.rightSidebarTab === "changes") {
      resetVcsState(project.id)
      await loadVcsStatus()
    }
  } catch (error) {
    showToast(gitErrorMessage(error, "Could not checkout branch."))
  } finally {
    render()
  }
}

// state.expandedToolErrors is keyed by tool-part id, not session id, so a discarded thread cannot
// clean up after itself the way forkMarkers/reasoningBySession do. Walk the thread being dropped
// and forget its part ids. Without this the Set grows for the life of the process, and because a
// part id falls back to an index-derived value when the runtime omits one (thread-stream.js), a
// stale id can collide with a later part and render an unrelated error row pre-expanded.
function forgetToolErrorExpansion(sessionId) {
  const thread = state.threads.get(sessionId)
  if (!thread || !state.expandedToolErrors.size) return
  for (const message of thread.messages || []) {
    for (const part of message?.parts || []) {
      if (part?.id) state.expandedToolErrors.delete(part.id)
    }
  }
}

// Drops threads for sessions no longer present, keeping the active/draft threads.
// Prevents unbounded growth and cross-project bleed of background session state.
function pruneThreads(keepSessionIds) {
  const keep = new Set([...keepSessionIds, state.activeSessionId, null])
  for (const sessionId of [...state.threads.keys()]) {
    if (!keep.has(sessionId)) {
      streamPacer.clearSession(sessionId)
      forgetToolErrorExpansion(sessionId)
      state.threads.delete(sessionId)
      state.forkMarkers.delete(sessionId)
      state.modelRefBySession.delete(sessionId)
      state.agentBySession.delete(sessionId)
      state.revertDraftBySession.delete(sessionId)
    }
  }
}

function chooseSessionAfterRuntimeReconnect(currentSessionId, sessions) {
  if (!currentSessionId) return null
  return sessions.some((session) => session.id === currentSessionId) ? currentSessionId : null
}

async function ensureRuntimeProject(projectId, { preserveSessionId = null } = {}) {
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) return null

  const sessionLoadGeneration = markProjectSessionLoading(projectId)
  state.loading = true
  render()
  try {
    state.runtime = await window.openworking.runtime.openProject(project)
    const sessions = await loadProjectSessions(projectId)
    window.openworking.runtime.listCommands().then((commands) => {
      if (state.runtime?.project?.id !== projectId) return
      state.commands = commands
      state.commandMenu = { open: false, query: "", index: 0 }
      // Same as activateProjectRuntime: chips rendered before the command list arrived
      // need a thread repaint to resolve into tokens.
      scheduleThreadRender()
    }).catch(() => {})
    return chooseSessionAfterRuntimeReconnect(preserveSessionId, sessions)
  } catch (error) {
    const currentLoad = projectSessionLoad(projectId)
    if (currentLoad.status === "loading" && currentLoad.generation === sessionLoadGeneration) {
      failProjectSessionLoad(projectId, error)
    }
    throw error
  } finally {
    state.loading = false
    render()
  }
}

async function newSession(projectId, { clearAttachments = true } = {}) {
  if (promptSubmissionBlocksNavigation()) return
  if (!projectId) return
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) return
  if (clearAttachments) await clearPendingAttachments()
  flushActiveStreamPacing()
  state.activeProjectId = projectId
  resetFileTree(projectId)
  syncTerminalForActiveProject()
  state.activeSessionId = null
  resetActiveThread()
  state.nav = "session"
  state.expanded.add(projectId)
  persistExpanded()
  render()
  if (state.runtime?.project?.id !== projectId || state.runtime.status !== "running") {
    const sessionLoadGeneration = markProjectSessionLoading(projectId)
    state.loading = true
    render()
    try {
      state.runtime = await window.openworking.runtime.openProject(project)
      await loadProjectSessions(projectId)
    } catch (error) {
      const currentLoad = projectSessionLoad(projectId)
      if (currentLoad.status === "loading" && currentLoad.generation === sessionLoadGeneration) {
        failProjectSessionLoad(projectId, error)
      }
      throw error
    } finally {
      state.loading = false
      render()
    }
  }
  if (state.rightSidebarOpen) loadFileTreeDirectory("").catch((error) => showToast(error.message))
  document.getElementById("promptInput")?.focus()
}

async function selectSession(projectId, sessionId) {
  if (promptSubmissionBlocksNavigation()) return
  // A pinned session caches its projectId; if it's missing (legacy pin) or its project
  // was removed, the click would have nothing to point at.
  const project = state.projects.find((item) => item.id === projectId)
  if (!project) {
    showToast("This chat's project is no longer available. Re-pin it from the project to restore the link.")
    return
  }
  const switchingProject = state.activeProjectId !== projectId
  const existing = state.threads.get(sessionId)
  const hasCachedMessages = Boolean(existing?.messages?.length)
  // clearPendingAttachments drops renderer state synchronously, then awaits the registry cleanup.
  // Start that cleanup now, but do not put it in front of the first cached-thread paint.
  const attachmentCleanup = clearPendingAttachments().catch((error) => {
    showToast(error?.message || "Could not discard pending attachments.")
  })
  // Selecting any session dismisses an open context menu — including one left open on a different
  // row. The document-click handler can't catch this because each row is its own .session-row-wrap,
  // so a click on another row stays "inside" a wrap and never trips the outside-click close.
  state.sessionMenu = null
  // Clicking a session must never collapse its accordion — keep it expanded regardless of how the
  // runtime is doing (it may still be starting up from a fresh app launch).
  state.expanded.add(projectId)
  persistExpanded()
  if (state.activeSessionId !== sessionId) flushActiveStreamPacing()
  state.activeProjectId = projectId
  state.activeSessionId = sessionId
  state.nav = "session"
  if (!hasCachedMessages) {
    state.messageLoadsBySession[sessionRowKey(projectId, sessionId)] = {
      status: "loading",
      generation: ++state.messageLoadSeq,
      error: "",
      projectId
    }
  }
  // Paint the selected row and any cached thread before runtime startup or HTTP hydration.
  render({ threadScroll: "latest" })
  // VIEW the chat without switching projects: OpenCode serves any project's history from the one
  // running server when we pass its `directory`. We deliberately do NOT restart the server when it
  // is already running on a different project — restarting on every cross-project click is what
  // caused the ECONNRESET/"not running" storm. Sending a prompt still restarts to the right cwd via
  // ensureRuntimeProject in sendPrompt.
  //
  // Only cold-start when there is genuinely NO live runtime. If one is already starting/running,
  // do NOT call openProject — its same-project branch would TOGGLE the accordion CLOSED, and the
  // directory-scoped listMessages below waits for the in-flight start via the runtime's
  // waitUntilReady() anyway. ("starting" means the user clicked before init finished.)
  const runtimeAlive = state.runtime?.status === "running" || state.runtime?.status === "starting"
  if (!runtimeAlive) {
    await activateProjectRuntime(project, { selectLatest: false, switchingProject })
  }
  if (state.activeSessionId !== sessionId) flushActiveStreamPacing()
  state.activeProjectId = projectId
  syncTerminalForActiveProject()
  state.activeSessionId = sessionId
  state.nav = "session"
  loadSubagentRunTree(sessionId)
  // The composer's git control keys off the active project (renderGitControl(project) → the
  // gitInfoByProject cache), so viewing another project's chat here — even without restarting the
  // runtime — shows that project's branch/worktree automatically; no explicit refresh needed.
  // Re-hydrate unless the session is genuinely still streaming (local + server busy
  // with streamed output already in memory). Stale busy threads missed stream events
  // during backgrounding or SSE reconnect and must fetch from the server.
  const serverStatus = state.runtime?.sessionStatuses?.[sessionId]
  if (needsThreadRehydration(existing, serverStatus)) {
    try {
      await loadSessionMessages(project, sessionId)
    } catch (error) {
      showToast(hasCachedMessages ? "Could not refresh chat." : error.message || "Could not load this chat.")
    }
  }
  await attachmentCleanup
}

async function deleteSession(target) {
  const sessionId = target?.sessionId
  const projectId = target?.projectId
  if (!sessionId || !projectId) {
    throw new Error("Could not identify that session's project.")
  }
  if (projectId !== state.activeProjectId && threadIsBusy(activeThread())) {
    throw new Error("Finish the active session before deleting from another project.")
  }
  await runWithRuntimeProject(projectId, async () => {
    if (state.runtime?.project?.id !== projectId || state.runtime?.status !== "running") {
      throw new Error("Could not open the session workspace.")
    }
    await window.openworking.runtime.deleteSession({ sessionId })
    setProjectSessions(projectId, await window.openworking.runtime.listSessions(), "active")
  })
  forgetToolErrorExpansion(sessionId)
  state.threads.delete(sessionId)
  state.forkMarkers.delete(sessionId)
  state.modelRefBySession.delete(sessionId)
  state.agentBySession.delete(sessionId)
  state.revertDraftBySession.delete(sessionId)
  clearSelectedPromptMetadata(sessionId)
  if (state.activeProjectId === projectId && state.activeSessionId === sessionId) {
    state.activeSessionId = null
    resetActiveThread()
  }
  state.sessionMenu = null
  render()
}

async function exportSession({ projectId, sessionId } = {}) {
  const project = state.projects.find((item) => item.id === projectId)
  const session = projectSessions(projectId).find((item) => item.id === sessionId)
  if (!project || !sessionId) throw new Error("Could not identify that session's project.")
  const directory = session?.directory || project.activeWorktreePath || project.path
  return window.openworking.runtime.exportSession({ projectId, sessionId, directory })
}

async function confirmDeleteSession() {
  const target = state.sessionDeleteTarget
  if (!target?.sessionId || !target.projectId) {
    state.sessionDeleteTarget = null
    state.sessionDeleteError = null
    state.sessionDeleting = false
    render()
    return
  }
  if (state.sessionDeleting) return
  state.sessionDeleting = true
  state.sessionDeleteError = null
  render()
  try {
    await deleteSession(target)
    state.sessionDeleteTarget = null
    state.sessionDeleteError = null
    state.sessionDeleting = false
    render()
  } catch (error) {
    state.sessionDeleting = false
    state.sessionDeleteError = error.message || "Could not delete session."
    render()
  }
}

async function togglePin(sessionId, pinned, meta = {}) {
  try {
    const pins = await window.openworking.pins.set(sessionId, pinned, meta)
    state.pinnedSessions = pinsToMap(pins)
  } catch (error) {
    showToast(error.message || "Could not update pin.")
    return
  }
  // Pin/unpin only reshuffles the sidebar's Pinned section + accordions.
  scheduleSidebarRender()
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

  try {
    if (shouldSwitch) {
      state.loading = true
      render()
      state.runtime = await window.openworking.runtime.openProject(project)
      state.commands = await window.openworking.runtime.listCommands().catch(() => [])
      state.commandMenu = { open: false, query: "", index: 0 }
    }
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
      setProjectSessions(target.projectId, await window.openworking.runtime.listSessions(), "active")
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

function sameModelRef(left, right) {
  const a = normalizeModelRef(left)
  const b = normalizeModelRef(right)
  return Boolean(a && b) && a.providerID === b.providerID && a.id === b.id && (a.variant || "") === (b.variant || "")
}

async function ensureSessionSelection(sessionId, agent, model, session = selectedSession()) {
  const knownAgent = state.agentBySession.get(sessionId) || session?.agent
  if (agent && knownAgent !== agent) {
    if (typeof window.openworking.runtime.selectSessionAgent === "function") {
      await window.openworking.runtime.selectSessionAgent({ sessionId, agent })
    }
    state.agentBySession.set(sessionId, agent)
    updateSessionMetadata(sessionId, { agent })
  }
  const modelRef = normalizeModelRef(model)
  const knownModel = normalizeModelRef(session?.model)
  if (modelRef && !sameModelRef(knownModel, modelRef)) {
    if (typeof window.openworking.runtime.selectSessionModel === "function") {
      await window.openworking.runtime.selectSessionModel({ sessionId, model: modelRef })
    }
    state.modelRefBySession.set(sessionId, modelRef)
    updateSessionMetadata(sessionId, { model: modelRef })
  }
}

function createPromptInputId() {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `msg_${uuid.replaceAll("-", "")}`
  const fallback = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  return `msg_${fallback.replace(/[^A-Za-z0-9_-]/g, "")}`
}

async function findSubmittedInput(sessionId, inputId) {
  try {
    const [pendingInputs, messages] = await Promise.all([
      listPendingInputsForSession(sessionId),
      window.openworking.runtime.listMessages({ sessionId })
    ])
    const pending = pendingInputs.find((input) => input.id === inputId)
    if (pending) return { pending, promoted: false }
    const promoted = messages.some((message) => (message.info?.id || message.id) === inputId)
    return promoted ? { pending: null, promoted: true } : null
  } catch {
    return null
  }
}

function confirmInputSubmission(inputId, submission = state.unknownInputSubmissions.get(inputId)) {
  if (submission) submission.confirmed = true
  state.unknownInputSubmissions.delete(inputId)
  const attachmentIds = submission?.kind === "prompt" && Array.isArray(submission.payload?.attachmentIds)
    ? submission.payload.attachmentIds
    : []
  if (!attachmentIds.length || typeof window.openworking.attachments?.discard !== "function") {
    return Promise.resolve()
  }
  return Promise.resolve(window.openworking.attachments.discard(attachmentIds)).catch(() => {})
}

async function reconcileSubmittedInput(thread, submission, inputId) {
  if (submission.confirmed) return true
  const recovered = await findSubmittedInput(submission.sessionId, inputId)
  if (recovered?.pending) admitPendingInput(thread, recovered.pending)
  else if (recovered?.promoted) {
    applyThreadEvent(thread, {
      type: "session.input.promoted",
      sessionID: submission.sessionId,
      inputID: inputId
    })
  }
  if (!recovered) return false
  await confirmInputSubmission(inputId, submission)
  return true
}

async function retryUnknownInput(inputId) {
  const submission = state.unknownInputSubmissions.get(inputId)
  if (!submission) return
  const thread = ensureThread(submission.sessionId)
  const message = thread.messages.find((item) => item.id === inputId)
  if (message) message.inputState = "submitting"
  scheduleThreadRender()
  try {
    const pending = submission.kind === "command"
      ? await window.openworking.runtime.sendCommand(submission.payload)
      : await window.openworking.runtime.sendPrompt(submission.payload)
    if (pending) admitPendingInput(thread, pending)
    await confirmInputSubmission(inputId, submission)
    scheduleThreadRender()
  } catch (error) {
    if (await reconcileSubmittedInput(thread, submission, inputId)) {
      scheduleThreadRender()
      return
    }
    markInputDeliveryUnknown(thread, inputId)
    scheduleThreadRender()
    showToast(error.message || "Could not confirm prompt delivery.")
  }
}

async function sendPrompt(rawPrompt, { delivery = "queue" } = {}) {
  if (state.promptSubmitInFlight) return
  state.commandMenu = { open: false, query: "", index: 0 }
  state.fileMentionMenu.open = false
  state.fileMentionMenu.query = ""
  state.fileMentionMenu.index = 0
  state.popover = null
  const prompt = String(rawPrompt || "").trim()
  const project = selectedProject()
  if (!prompt || !project) return
  const targetSessionId = state.activeSessionId
  const targetSession = projectSessions(project.id).find((session) => session.id === targetSessionId) || null
  const targetProjectContext = selectedProjectContext(project)
  const targetPendingAttachments = state.pendingAttachments.slice()
  const targetPendingFileMentions = state.pendingFileMentions.slice()
  const targetMode = modes.find((item) => item.id === state.mode) || modes[0]
  const targetModelRef = currentModelRef()
  const inputId = createPromptInputId()
  // Arm the first-send guard synchronously, before any await, when there's no
  // session yet. Two rapid clicks (e.g. double-clicking a starter chip) would
  // otherwise both clear the awaits below before either armed the guard inside
  // the block, creating two sessions at once.
  let ownsFirstSendGuard = false
  if (!state.activeSessionId) {
    if (state.firstSendInFlight) return
    state.firstSendInFlight = true
    ownsFirstSendGuard = true
    render()
  }
  state.promptSubmitInFlight = true
  updateComposerSubmitButton()
  const leadingCommand = leadingCommandToken(prompt)
  const command = leadingCommand?.command || null
  const skill = leadingCommand?.skill || null
  const slashArgs = leadingCommand?.args || ""
  const fileMentionSource = command || skill ? slashArgs : prompt
  let fileMentions
  const materializedMentionAttachments = []
  let textFileMentions
  try {
    fileMentions = await fileMentionsForSubmit(fileMentionSource, command, {
      pendingFileMentions: targetPendingFileMentions,
      files: selectableProjectFiles()
    })
    const attachmentFileMentions = fileMentions.filter(fileMentionNeedsAttachment)
    textFileMentions = fileMentions.filter((fileMention) => !fileMentionNeedsAttachment(fileMention))
    for (const fileMention of attachmentFileMentions) {
      const attachment = await window.openworking.attachments.addProjectFile(fileMention.path, targetProjectContext)
      if (attachment) materializedMentionAttachments.push(attachment)
    }
  } catch (error) {
    // Release the first-send guard if prep failed before the main try/finally,
    // otherwise it would stay armed and block every future first send.
    if (ownsFirstSendGuard) {
      state.firstSendInFlight = false
      render()
    }
    state.promptSubmitInFlight = false
    updateComposerSubmitButton()
    showToast(error.message || "Could not send prompt.")
    return
  }
  const attachments = computePromptAttachments({
    command,
    pendingAttachments: targetPendingAttachments,
    fileMentions: textFileMentions
  })
  attachments.push(...materializedMentionAttachments)
  const unsupported = unsupportedAttachments(attachments, selectedModel())
  if (unsupported.length) {
    // Caught here even though pickAttachments() already gates the same check, because the
    // selected model can change after attaching (or the attachment can arrive via an @mention,
    // which never goes through pickAttachments()) — this is the last checkpoint before any
    // network call, per the "block before send, not after a failed round-trip" requirement.
    if (ownsFirstSendGuard) {
      state.firstSendInFlight = false
      render()
    }
    state.promptSubmitInFlight = false
    updateComposerSubmitButton()
    const names = unsupported.map((attachment) => attachment.filename).join(", ")
    showToast(`${selectedModel()?.name || "The selected model"} doesn't support: ${names}. Remove it or switch model before sending.`)
    return
  }
  const effectiveSlashArgs = command || skill
    ? applyPendingFileMentions(slashArgs, textFileMentions)
    : slashArgs
  const effectivePrompt = skill
    ? effectiveSlashArgs.trim() || "Apply the activated skill."
    : command
      ? prompt
      : applyPendingFileMentions(prompt, textFileMentions)
  const effectiveCommandArgs = command ? effectiveSlashArgs : slashArgs
  const selectedSkillToken = leadingCommand?.selectedSkill || null
  const selectedCommandToken = leadingCommand?.selectedCommand || null
  if (selectedSkillToken && !command) selectedSkillToken.args = applyPendingFileMentions(selectedSkillToken.args, textFileMentions)
  let thread = null
  let optimisticId = null
  let selectedPromptMetadata = null
  let dispatchedSubmission = null
  let submissionSessionId = targetSessionId
  const submissionSessionIsActive = () => (
    state.activeProjectId === project.id && state.activeSessionId === submissionSessionId
  )
  try {
    if (state.runtime?.project?.id !== project.id || state.runtime.status !== "running") {
      const preservedSessionId = await ensureRuntimeProject(project.id, { preserveSessionId: submissionSessionId })
      if (submissionSessionId && preservedSessionId !== submissionSessionId) {
        throw new Error("The target chat is no longer available.")
      }
    }
    if (!submissionSessionId) {
      const titleText = promptTitleText(prompt) || prompt
      const title = titleText.length > 54 ? `${titleText.slice(0, 53).trim()}...` : titleText
      const session = await window.openworking.runtime.createSession({
        title,
        agent: targetMode.agent,
        model: targetModelRef || undefined
      })
      submissionSessionId = session.id
      if (targetModelRef) state.modelRefBySession.set(session.id, targetModelRef)
      state.agentBySession.set(session.id, targetMode.agent)
      setProjectSessions(project.id, [session, ...projectSessions(project.id)], "active")
      if (state.activeProjectId === project.id && state.activeSessionId === targetSessionId) {
        state.activeSessionId = session.id
        state.newSessionModelRef = null
        // Discard the unsaved "new session" draft thread and start a clean thread under
        // the real session id, so subsequent stream events route to it by sessionID.
        state.threads.delete(null)
        resetActiveThread(session.id)
      }
    } else {
      await ensureSessionSelection(submissionSessionId, targetMode.agent, targetModelRef, targetSession)
    }
    thread = ensureThread(submissionSessionId)
    optimisticId = addOptimisticUser(thread, prompt, attachments, {
      id: inputId,
      delivery,
      inputState: "submitting",
      fileRefs: fileMentions,
      signatureText: command ? prompt : effectivePrompt,
      selectedSkill: selectedSkillToken || undefined,
      selectedCommand: selectedCommandToken || undefined
    })
    if (selectedSkillToken || selectedCommandToken) {
      selectedPromptMetadata = {
        userOrdinal: thread.messages.filter((message) => message.role === "user").length - 1,
        signatureText: command ? prompt : effectivePrompt,
        selectedSkill: selectedSkillToken || undefined,
        selectedCommand: selectedCommandToken || undefined
      }
    }
    if (targetMode.id === "plan" && submissionSessionIsActive()) {
      const afterMessageIndex = thread.messages.findIndex((message) => message.id === optimisticId)
      state.planProposal = {
        sessionId: submissionSessionId,
        afterMessageIndex: afterMessageIndex === -1 ? thread.messages.length - 1 : afterMessageIndex
      }
      state.planAccepted = null
      state.planAutoOpened = null
      state.planCardExpanded = false
    } else if (state.planProposal?.sessionId === submissionSessionId) {
      state.planProposal = null
    }
    const sentAttachmentIds = new Set(attachments.map((attachment) => attachment.id))
    if (submissionSessionIsActive()) {
      state.promptDraft = ""
      if (sentAttachmentIds.size) {
        state.pendingAttachments = state.pendingAttachments.filter((attachment) => !sentAttachmentIds.has(attachment.id))
      }
      state.pendingFileMentions = state.pendingFileMentions.filter((fileMention) => !fileMentions.some((sent) => sent.token === fileMention.token))
    }
    render({ threadScroll: submissionSessionIsActive() ? "latest" : "preserve" })
    if (command) {
      dispatchedSubmission = {
        kind: "command",
        sessionId: submissionSessionId,
        payload: {
          sessionId: submissionSessionId,
          inputId,
          command,
          arguments: effectiveCommandArgs,
          delivery,
          resume: true
        }
      }
      state.unknownInputSubmissions.set(inputId, dispatchedSubmission)
      const pending = await window.openworking.runtime.sendCommand(dispatchedSubmission.payload)
      if (pending) admitPendingInput(thread, pending)
    } else {
      if (skill) {
        await window.openworking.runtime.activateSkill({
          sessionId: submissionSessionId,
          skill,
          resume: false
        })
      }
      dispatchedSubmission = {
        kind: "prompt",
        sessionId: submissionSessionId,
        payload: {
          sessionId: submissionSessionId,
          inputId,
          prompt: effectivePrompt,
          attachmentIds: attachments.map((attachment) => attachment.id),
          delivery,
          resume: true
        }
      }
      state.unknownInputSubmissions.set(inputId, dispatchedSubmission)
      const pending = await window.openworking.runtime.sendPrompt(dispatchedSubmission.payload)
      if (pending) admitPendingInput(thread, pending)
    }
    await confirmInputSubmission(inputId, dispatchedSubmission)
    state.revertDraftBySession.delete(submissionSessionId)
    updateSessionMetadata(submissionSessionId, { revert: null })
    if (selectedPromptMetadata) {
      recordSelectedPromptMetadata(submissionSessionId, selectedPromptMetadata.userOrdinal, selectedPromptMetadata)
    }
    render({ threadScroll: submissionSessionIsActive() ? "latest" : "preserve" })
  } catch (error) {
    const definitiveRejection = /HTTP \d{3}:/.test(String(error?.message || ""))
    if (thread && optimisticId && dispatchedSubmission && !definitiveRejection) {
      if (!(await reconcileSubmittedInput(thread, dispatchedSubmission, inputId))) {
        markInputDeliveryUnknown(thread, inputId)
        showToast("Prompt delivery was not confirmed. Retry will reuse the same input ID.")
      }
      render({ threadScroll: submissionSessionIsActive() ? "latest" : "preserve" })
      return
    }
    state.unknownInputSubmissions.delete(inputId)
    if (thread && optimisticId) removeOptimisticUser(thread, optimisticId)
    if (state.planProposal?.sessionId === submissionSessionId) state.planProposal = null
    if (submissionSessionIsActive()) {
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
    }
    render({ threadScroll: submissionSessionIsActive() ? "latest" : "preserve" })
    showToast(error.message || "Could not send prompt.")
  } finally {
    state.promptSubmitInFlight = false
    if (ownsFirstSendGuard) {
      state.firstSendInFlight = false
      render({ threadScroll: state.activeSessionId ? "latest" : "preserve" })
    } else {
      updateComposerSubmitButton()
    }
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
  if (state.runtime?.project?.id === projectId) {
    const stoppedRuntime = await window.openworking.runtime.stop()
    if (stoppedRuntime) state.runtime = stoppedRuntime
  }
  if (state.activeProjectId === projectId) await clearPendingAttachments()
  await window.openworking.projects.remove(projectId)
  state.projects = await window.openworking.projects.list()
  delete state.sessionsByProject[projectId]
  delete state.sessionLoadsByProject[projectId]
  projectSessionLoadPromises.delete(projectId)
  for (const key of Object.keys(state.messageLoadsBySession)) {
    if (state.messageLoadsBySession[key]?.projectId === projectId) delete state.messageLoadsBySession[key]
  }
  for (const key of sessionMessageLoadPromises.keys()) {
    if (key.startsWith(`${projectId}:`)) sessionMessageLoadPromises.delete(key)
  }
  // Drop this project's cached git info too: project ids are path hashes, so re-adding the same
  // folder later would otherwise read a stale entry before the fresh load lands.
  state.gitInfoByProject.delete(projectId)
  state.gitInfoLoading.delete(projectId)
  state.expanded.delete(projectId)
  // A removed project can never be switched back to, so its remembered shell would be unreachable
  // for the rest of the session — forget it (and drop the socket if it happens to be attached).
  state.terminalPtyByProject.delete(projectId)
  if (state.terminalProjectId === projectId) detachAttachedTerminal()
  persistExpanded()
  if (state.activeProjectId === projectId) {
    state.activeProjectId = state.projects[0]?.id || null
    resetFileTree(state.activeProjectId)
    state.activeSessionId = null
    state.threads.clear()
    state.expandedToolErrors.clear()
    resetActiveThread()
  }
  render()
}

async function toggleProjectPin(projectId, pinned) {
  try {
    await window.openworking.projects.setPinned(projectId, pinned)
    state.projects = await window.openworking.projects.list()
  } catch (error) {
    showToast(error.message || "Could not update pin.")
    return
  }
  state.projectMenu = null
  // On the Projects screen the pin also drives the card grid (pin badge, .on icon,
  // data-pinned for the next toggle, and pinned-first sort), so a full render() is
  // needed there — it repaints the grid AND the sidebar. Elsewhere, pinning only
  // moves the project between the sidebar's Pinned/Projects sections.
  if (state.nav === "projects") render()
  else scheduleSidebarRender()
}

// Opens `projectId` in `ideOverride` (one of IDE_OVERRIDE_OPTIONS' ids) or, if omitted, the
// configured default IDE (from localStorage — see storedDefaultIde). The main process can't
// read renderer localStorage, so this resolves the concrete id here rather than in the
// "open-ide" handler in src/main.js. Errors (project not found, app not installed, unsupported
// id) are surfaced as a toast rather than a crash.
async function openIde(projectId, ideOverride = null) {
  const ideId = ideOverride || ideOption(state.config?.personalization?.defaultIde).id
  try {
    await window.openworking.ide.open(projectId, ideId)
  } catch (error) {
    showToast(error.message || "Could not open IDE.")
  }
}

// Updates the Personalization "Default IDE" row and persists it to localStorage — same
// storage pattern as setThemeMode above (renderer-only, best-effort, no revert-on-failure).
function setDefaultIde(ideId) {
  const previous = ideOption(state.config?.personalization?.defaultIde).id
  if (ideId === previous) return
  state.config.personalization ||= {}
  state.config.personalization.defaultIde = ideId
  try {
    localStorage.setItem(DEFAULT_IDE_KEY, ideId)
  } catch {
    // Ignore — persistence is best-effort.
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

// Saved "Allow always" rules, read from GET /api/permission/saved (see permissions:listSaved in
// main.js for why the list is unfiltered by project). Opening the modal always reloads: this is a
// security-relevant list and must never show a stale revoke state.
async function openPermissionsModal() {
  state.permissionsModalOpen = true
  state.permissionsError = null
  render()
  await loadSavedPermissions()
}

function closePermissionsModal() {
  if (state.permissionsRemoving) return
  state.permissionsModalOpen = false
  render()
}

async function loadSavedPermissions() {
  state.permissionsLoading = true
  state.permissionsError = null
  render()
  try {
    state.permissionsList = await window.openworking.permissions.listSaved()
  } catch (error) {
    state.permissionsError = error.message || "Could not load saved permissions."
  } finally {
    state.permissionsLoading = false
    render()
  }
}

async function revokeSavedPermission(id) {
  if (!id || state.permissionsRemoving) return
  state.permissionsRemoving = id
  render()
  try {
    await window.openworking.permissions.removeSaved(id)
    state.permissionsList = state.permissionsList.filter((entry) => entry.id !== id)
  } catch (error) {
    state.permissionsError = error.message || "Could not revoke that permission."
  } finally {
    state.permissionsRemoving = null
    render()
  }
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
    // mcp:add can fail while installing an on-demand server (e.g. Backlog offline) — keep the modal
    // open and surface the real reason instead of pretending it was added.
    if (result?.error) {
      state.mcpError = result.error
      return
    }
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

// Retry connecting a failed (typically local stdio) MCP server. Reloads the runtime so a freshly
// resolved PATH is picked up, then re-connects — recovering from a bad PATH without a manual
// disable/enable. Reuses `mcpAuthenticating` as the busy flag so the card shows "Connecting…".
async function reconnectMcp(name) {
  const serverName = String(name || "")
  if (!serverName || state.mcpAuthenticating?.[serverName]) return
  state.mcpAuthenticating = { ...state.mcpAuthenticating, [serverName]: true }
  state.mcpError = null
  state.mcpErrorTarget = null
  render()
  try {
    const result = await window.openworking.mcp.connect(serverName)
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
    state.mcpErrorTarget = serverName
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
  state.managedPlugins = configResult.managedPlugins || []
  state.mcpServers = configResult.mcp || []
  state.providerId = Object.keys(state.config.provider || {})[0] || "gateway"
  selectedModel()
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    applyPendingFileMentions,
    canonicalToken,
    chooseSessionAfterRuntimeReconnect,
    collectLiveFileMentions,
    computePromptAttachments,
    escapeRegex,
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
    renderPromptOverlayHtml,
    renderTextWithFileMentions,
    replaceComposerQuery,
    resolveFileMentionsFromPrompt,
    setProjectSessions,
    sessionRowKey,
    sortSessionsByUpdated,
    __test: {
      renderToolRow,
      toolStepLabel,
      toolErrorText,
      toolErrorHint,
      activateProjectRuntime,
      applyPersistedPromptMetadataToThread,
      confirmDeleteSession,
      deleteSession,
      exportSession,
      forkAssistantMessage,
      refreshSessionData,
      currentReasoningMode,
      modelOptions,
      selectedModel,
      contextWindowUsage,
      resolveContextUsage,
      refreshSessionContextUsage,
      contextThresholdColor,
      compactActiveSession,
      searchProjectFiles,
      openPermissionsModal,
      closePermissionsModal,
      loadSavedPermissions,
      revokeSavedPermission,
      confirmStageSessionRevert,
      settleSessionRevert,
      renderContextRing,
      renderContextPopover,
      renderRevertBanner,
      fillSuggestion,
      filterNewSessionProjectsDom,
      renderComposer,
      renderNewSession,
      renderNewSessionProjectPopover,
      renderGitControl,
      renderGitPopover,
      selectableBranches,
      switchWorktree,
      ensureGitInfo,
      gitErrorMessage,
      loadVcsStatus,
      scheduleVcsRefresh,
      openVcsDiff,
      selectRightSidebarTab,
      toggleTerminalPanel,
      resetVcsState,
      renderMessageActions,
      renderPlanProposal,
      renderThreadMessages,
      renderThreadMessage,
      renderThreadRows,
      threadRowSegments,
      shouldRenderThinkingRow,
      renderToolRow,
      applySubagentRunTree,
      collectSubagentRunIds,
      loadSubagentRunTree,
      subagentRunTree,
      retryUnknownInput,
      selectSession,
      toggleProject,
      sendPrompt,
      autoRetryProjectSessions,
      handleRuntimeUpdate,
      reconcilePendingRequests,
      replyPermission,
      renderPendingForms,
      submitForm,
      cancelForm,
      submitQuestion,
      dismissQuestion,
      loadProjectSessions,
      markProjectSessionLoading,
      projectSessionLoad,
      retryProjectSessions,
      loadSessionMessages,
      sessionMessageLoad,
      retrySessionMessages,
      stripProjectFileContext,
      switchNewSessionProject,
      setCurrentReasoningMode,
      openRevertConfirmation,
      undoLastPrompt,
      state,
      dispatchDelegated: dispatchDelegatedTable,
      delegationShim,
      createStreamPacer,
      flushActiveStreamPacing,
      handleRuntimeStream,
      handleProfileUpdate,
      loadInitialState,
      loadMemory,
      refreshReferences,
      openReferenceForm,
      closeReferenceForm,
      addReference,
      removeReference,
      openTerminalConfirm,
      closeTerminalConfirm,
      confirmOpenTerminal,
      reconnectTerminal,
      closeTerminal,
      writeToTerminal,
      resizeTerminal,
      syncTerminalForActiveProject,
      detachAttachedTerminal,
      setTerminalDockHeight,
      maxTerminalDockHeight,
      terminalBelongsToActiveProject,
      terminalBridge,
      maybeConsumePacedRuntimeEvent,
      planProposalReady,
      planProposalSettled,
      paintDocumentViewer,
      paintSkillsPanel,
      removeProject,
      render,
      renderProfileRecoveryBanner,
      renderCounters,
      renderSidebarInto,
      renderThreadContent,
      saveMemory,
      splitStreamDeltaSegments,
      streamPacer,
      handleAction,
      insertFileMentionAtCaret,
      selectionLineRange,
      nodeAtTextOffsets,
      findTextMatches,
      buildMatchRanges,
      resolveTheme,
      storedThemeMode,
      setThemeMode,
      storedDefaultIde,
      setDefaultIde,
      syncSidebarForViewport,
      maxRightFileSidebarWidth,
      setRightFileSidebarWidth,
      documentViewerWidthForResize,
      // DELEGATED_CLICK is a `const` (TDZ) at exports-eval time, so expose it via a getter.
      getDelegatedClick: () => DELEGATED_CLICK,
      getDelegatedInput: () => DELEGATED_INPUT
    }
  }
}

// Event delegation: a single set of listeners on #root replaces the per-render
// querySelectorAll(...).forEach(addEventListener) storm that bindEvents() used to run on every
// repaint. Each click/input/keydown/mousedown is matched against an ordered table of
// [attribute|selector] → handler. Handlers keep reading `event.currentTarget.dataset` / calling
// `event.stopPropagation()` exactly as before — the dispatcher hands them a small shim whose
// currentTarget is the matched element and whose stopPropagation() ends dispatch for this event.
// Ordering matters: more-specific targets (a session kebab/menu) are listed BEFORE the row they
// sit inside, reproducing the old stopPropagation() guards that kept a kebab click from also
// selecting the row.

// Build the per-handler shim. `stop()` flips a flag the dispatcher checks to stop walking the
// table, matching the old event.stopPropagation() semantics (each element used to own its
// listener, so a stopPropagation there simply meant "no other handler runs for this click").
function delegationShim(event, element) {
  let stopped = false
  const shim = {
    type: event.type,
    key: event.key,
    shiftKey: event.shiftKey,
    // Pointer coordinates are needed by the resizer mousedown handlers
    // (startSidebarResize / startDocumentViewerResize / startRightFileSidebarResize)
    // to seed the drag origin — without them startX is undefined and the resize
    // computes NaN.
    clientX: event.clientX,
    clientY: event.clientY,
    dataTransfer: event.dataTransfer,
    target: event.target,
    currentTarget: element,
    stopPropagation() { stopped = true },
    preventDefault() { event.preventDefault() }
  }
  return { shim, isStopped: () => stopped }
}

// Click handlers, most-specific first. Each entry: [attribute, handler(shim)].
const DELEGATED_CLICK = [
  ["data-tool-error", (e) => {
    const id = e.currentTarget.dataset.toolError
    if (state.expandedToolErrors.has(id)) state.expandedToolErrors.delete(id)
    else state.expandedToolErrors.add(id)
    scheduleThreadRender()
  }],
  ["data-session-menu", (e) => {
    const id = e.currentTarget.dataset.sessionMenu
    const projectId = e.currentTarget.dataset.sessionProject || ""
    const key = sessionRowKey(projectId, id)
    state.sessionMenu = state.sessionMenu === key ? null : key
    scheduleSidebarRender()
  }],
  ["data-session-pin", (e) => {
    state.sessionMenu = null
    const meta = {
      projectId: e.currentTarget.dataset.pinProject || null,
      title: e.currentTarget.dataset.pinTitle || "",
      updatedAt: e.currentTarget.dataset.pinUpdated || null
    }
    togglePin(e.currentTarget.dataset.sessionPin, e.currentTarget.dataset.pinned !== "1", meta).catch((error) => showToast(error.message))
  }],
  ["data-session-export", (e) => {
    state.sessionMenu = null
    scheduleSidebarRender()
    exportSession({
      sessionId: e.currentTarget.dataset.sessionExport,
      projectId: e.currentTarget.dataset.sessionProject
    }).then((result) => {
      if (!result?.canceled) showToast("Session exported.")
    }).catch((error) => {
      // Surface the runtime's own reason (e.g. an HTTP 400 from the message endpoint) instead of a
      // generic toast that forced diagnosis through the terminal log. `ipcErrorMessage` degrades to
      // the bare "Error" label for a message-less rejection, which tells the user nothing.
      const reason = ipcErrorMessage(error)
      showToast(reason && reason !== "Error" ? reason : "Could not export session.")
    })
  }],
  ["data-session-delete", (e) => {
    state.sessionDeleteTarget = {
      sessionId: e.currentTarget.dataset.sessionDelete,
      projectId: e.currentTarget.dataset.sessionProject,
      title: e.currentTarget.dataset.sessionTitle || "Untitled session"
    }
    state.sessionDeleting = false
    state.sessionDeleteError = null
    state.sessionMenu = null
    render()
  }],
  ["data-session-rename", (e) => {
    state.sessionRenameTarget = {
      sessionId: e.currentTarget.dataset.sessionRename,
      projectId: e.currentTarget.dataset.sessionProject,
      title: e.currentTarget.dataset.sessionTitle || "",
      label: e.currentTarget.dataset.sessionLabel || "Untitled session",
    }
    state.sessionRenameDraft = e.currentTarget.dataset.sessionTitle || ""
    state.sessionRenameError = null
    state.sessionRenaming = false
    state.sessionRenameAutoFocus = true
    state.sessionMenu = null
    render()
  }],
  ["data-session-id", (e) => selectSession(e.currentTarget.dataset.projectId, e.currentTarget.dataset.sessionId)],
  ["data-retry-project-sessions", (e) => {
    retryProjectSessions(e.currentTarget.dataset.retryProjectSessions).catch((error) => showToast(error.message))
  }],
  ["data-retry-session-messages", (e) => {
    retrySessionMessages(e.currentTarget.dataset.projectId, e.currentTarget.dataset.retrySessionMessages).catch((error) => showToast(error.message))
  }],
  ["data-project-menu", (e) => {
    const id = e.currentTarget.dataset.projectMenu
    state.projectMenu = state.projectMenu === id ? null : id
    scheduleSidebarRender()
  }],
  ["data-project-pin", (e) => {
    toggleProjectPin(e.currentTarget.dataset.projectPin, e.currentTarget.dataset.pinned !== "1").catch((error) => showToast(error.message))
  }],
  ["data-project-rename", (e) => openRenameProjectModal(e.currentTarget.dataset.projectRename, e.currentTarget.dataset.projectName || "")],
  ["data-project-delete", (e) => {
    state.projectDeleteTarget = { id: e.currentTarget.dataset.projectDelete, name: e.currentTarget.dataset.projectName || "this project" }
    state.projectRemoving = false
    state.projectDeleteError = null
    state.projectMenu = null
    render()
  }],
  ["data-project-memory", (e) => openMemoryScreen(e.currentTarget.dataset.projectMemory)],
  ["data-new-session", (e) => newSession(e.currentTarget.dataset.newSession)],
  ["data-new-session-project", (e) => switchNewSessionProject(e.currentTarget.dataset.newSessionProject).catch((error) => showToast(error.message))],
  ["data-ide-menu", (e) => {
    const id = e.currentTarget.dataset.ideMenu
    state.ideMenu = state.ideMenu === id ? null : id
    render()
  }],
  ["data-open-ide", (e) => {
    const projectId = e.currentTarget.dataset.openIde
    const ideOverride = e.currentTarget.dataset.ideOverride || null
    state.ideMenu = null
    render()
    openIde(projectId, ideOverride)
  }],
  ["data-toggle-project", (e) => toggleProject(e.currentTarget.dataset.toggleProject)],
  ["data-open-project", (e) => openProject(e.currentTarget.dataset.openProject)],
  ["data-show-all", (e) => {
    const id = e.currentTarget.dataset.showAll
    state.showAll.has(id) ? state.showAll.delete(id) : state.showAll.add(id)
    scheduleSidebarRender()
  }],
  ["data-nav", (e) => {
    const nextNav = e.currentTarget.dataset.nav
    if (state.nav === "skills" && state.skillsTab === "memory" && e.currentTarget.dataset.nav !== "skills") {
      resetMemorySelectionToActiveProject()
    }
    state.nav = nextNav
    state.popover = null
    closeRightSidebarForNav()
    render()
    if (state.nav === "skills" && state.skillsTab === "memory") {
      loadMemory().catch((error) => showToast(error?.message || "Failed to load memory."))
    }
  }],
  ["data-tree-dir", (e) => toggleFileTreeDirectory(e.currentTarget.dataset.treeDir).catch((error) => showToast(error.message))],
  ["data-tree-file", (e) => openFileTreeFile(e.currentTarget.dataset.treeFile).catch((error) => showToast(error.message))],
  ["data-popover", (e) => {
    const next = state.popover === e.currentTarget.dataset.popover ? null : e.currentTarget.dataset.popover
    state.popover = next
    if (next === "project") state.newSessionProjectQuery = ""
    render()
    if (next === "project") document.getElementById("newSessionProjectSearch")?.focus()
    else document.getElementById("promptInput")?.focus()
  }],
  ["data-git-worktree", (e) => switchWorktree(e.currentTarget.dataset.gitWorktree).catch((error) => showToast(error.message))],
  ["data-git-branch", (e) => checkoutBranch(e.currentTarget.dataset.gitBranch).catch((error) => showToast(error.message))],
  ["data-reasoning-mode", (e) => setCurrentReasoningMode(e.currentTarget.dataset.reasoningMode, { keepPopover: true }).catch((error) => showToast(error.message))],
  ["data-chip", (e) => fillSuggestion(e.currentTarget.dataset.chip)],
  ["data-provider", (e) => {
    state.providerId = e.currentTarget.dataset.provider
    render()
  }],
  ["data-settings-section", (e) => {
    state.settingsSection = e.currentTarget.dataset.settingsSection
    render()
  }],
  ["data-theme-mode", (e) => {
    const mode = e.currentTarget.dataset.themeMode
    if (mode === state.themeMode) return
    setThemeMode(mode)   // flips the palette on this frame (data-theme on <html>)
    render()             // repaint so the toggle's active segment updates
  }],
  ["data-personalization-field", (e) => {
    const field = e.currentTarget.dataset.personalizationField
    const value = e.currentTarget.dataset.personalizationValue
    if (field === "defaultIde") setDefaultIde(value)
  }],
  ["data-skill-open", (e) => openSkillPreview(e.currentTarget.dataset.skillOpen, e.currentTarget.dataset.skillBuiltin === "1")],
  ["data-skills-tab", (e) => {
    const nextTab = e.currentTarget.dataset.skillsTab
    if (state.skillsTab === "memory" && nextTab !== "memory") resetMemorySelectionToActiveProject()
    if (state.skillsTab === "references" && nextTab !== "references") {
      state.referenceFormOpen = false
      state.referenceDraft = null
      state.referencesError = null
    }
    state.skillsTab = nextTab
    render()
    if (state.skillsTab === "mcp") { refreshMcpStatus(); refreshBrowserStatus() }
    if (state.skillsTab === "memory") loadMemory()
    if (state.skillsTab === "references") refreshReferences()
  }],
  ["data-skills-filter", (e) => {
    state.skillsFilter = e.currentTarget.dataset.skillsFilter
    render()
  }],
  ["data-memory-save", (e) => saveMemory(e.currentTarget.dataset.memorySave)],
  ["data-reference-kind", (e) => {
    if (state.referenceSaving || !state.referenceDraft) return
    state.referenceDraft.kind = e.currentTarget.dataset.referenceKind === "git" ? "git" : "path"
    paintReferencesOrRender()
  }],
  ["data-reference-remove", (e) => removeReference(e.currentTarget.dataset.referenceRemove)],
  ["data-mcp-type", (e) => {
    if (state.mcpSaving || !state.mcpDraft) return
    state.mcpDraft.type = e.currentTarget.dataset.mcpType
    state.mcpError = null
    render()
  }],
  ["data-mcp-toggle", (e) => toggleMcpEnabled(e.currentTarget.dataset.mcpToggle, e.currentTarget.dataset.mcpEnabled !== "1")],
  ["data-mcp-oauth-mode", (e) => {
    if (state.mcpSaving || !state.mcpDraft) return
    const mode = e.currentTarget.dataset.mcpOauthMode
    state.mcpDraft.oauthMode = mode
    if (mode === "custom") state.mcpDraft.oauthAdvancedOpen = true
    state.mcpError = null
    render()
  }],
  ["data-rename-project", (e) => openRenameProjectModal(e.currentTarget.dataset.renameProject, e.currentTarget.dataset.projectName || "")],
  ["data-remove-project", (e) => {
    state.projectDeleteTarget = { id: e.currentTarget.dataset.removeProject, name: e.currentTarget.dataset.projectName || "this project" }
    state.projectRemoving = false
    state.projectDeleteError = null
    render()
  }],
  ["data-remove-attachment", (e) => removeAttachment(e.currentTarget.dataset.removeAttachment)],
  ["data-remove-file-mention", (e) => removeFileMention(e.currentTarget.dataset.removeFileMention)],
  // Thread-row actions (these used to be wired by bindMessageActions/etc. on every renderThreadContent).
  ["data-copy-message", (e) => copyMessage(e.currentTarget.dataset.copyMessage).catch((error) => showToast(error.message))],
  ["data-fork-message", (e) => forkAssistantMessage(e.currentTarget.dataset.forkMessage).catch((error) => showToast(error.message))],
  ["data-revert-message", (e) => {
    try {
      openRevertConfirmation(e.currentTarget.dataset.revertMessage)
    } catch (error) {
      showToast(error.message)
    }
  }],
  ["data-retry-input", (e) => {
    retryUnknownInput(e.currentTarget.dataset.retryInput).catch((error) => showToast(error.message))
  }],
  ["data-open-artifact", (e) => openArtifact(e.currentTarget.dataset.openArtifact).catch((error) => showToast(error.message))],
  ["data-open-file", (e) => openDocument(e.currentTarget.dataset.openFile, { tab: e.currentTarget.dataset.openTab || null }).catch((error) => showToast(error.message))],
  ["data-doc-tab", (e) => switchDocumentTab(e.currentTarget.dataset.docTab)],
  ["data-right-tab", (e) => { selectRightSidebarTab(e.currentTarget.dataset.rightTab).catch(() => {}) }],
  ["data-vcs-file", (e) => { openVcsDiff(e.currentTarget.dataset.vcsFile).catch(() => {}) }],
  ["data-question-option", (e) => {
    const requestID = e.currentTarget.dataset.questionOption
    const sessionId = state.activeSessionId
    const index = Number(e.currentTarget.dataset.questionIndex)
    const value = e.currentTarget.dataset.questionValue
    if (e.currentTarget.dataset.questionMultiple === "1") {
      const draft = questionDraft(sessionId, requestID, index)
      draft.selected.has(value) ? draft.selected.delete(value) : draft.selected.add(value)
      renderThreadContent()
    } else {
      submitQuestion(requestID, index, [value], sessionId).catch((error) => showToast(error.message))
    }
  }],
  ["data-question-other-submit", (e) => {
    const requestID = e.currentTarget.dataset.questionOtherSubmit
    const sessionId = state.activeSessionId
    const index = Number(e.currentTarget.dataset.questionIndex)
    const other = questionDraft(sessionId, requestID, index).other.trim()
    if (!other) {
      showToast("Type an answer or pick an option.")
      return
    }
    submitQuestion(requestID, index, [other], sessionId).catch((error) => showToast(error.message))
  }],
  ["data-question-submit", (e) => {
    const requestID = e.currentTarget.dataset.questionSubmit
    const sessionId = state.activeSessionId
    const index = Number(e.currentTarget.dataset.questionIndex)
    const draft = questionDraft(sessionId, requestID, index)
    const answers = [...draft.selected]
    if (draft.other.trim()) answers.push(draft.other.trim())
    if (!answers.length) {
      showToast("Select at least one option.")
      return
    }
    submitQuestion(requestID, index, answers, sessionId).catch((error) => showToast(error.message))
  }],
  ["data-question-dismiss", (e) => dismissQuestion(e.currentTarget.dataset.questionDismiss).catch((error) => showToast(error.message))],
  ["data-permission-reply", (e) => {
    const sessionId = e.currentTarget.dataset.permissionSession || state.activeSessionId
    return replyPermission(e.currentTarget.dataset.permissionReply, e.currentTarget.dataset.permissionDecision, sessionId).catch((error) => showToast(error.message))
  }],
  ["data-form-option", (e) => {
    const formID = e.currentTarget.dataset.formOption
    const request = (activeThread().pendingForms || []).find((item) => item.id === formID)
    if (!request) return
    formDraft({ ...request, sessionId: state.activeSessionId })[e.currentTarget.dataset.formKey] = e.currentTarget.dataset.formValue
    renderThreadContent()
  }],
  ["data-form-multiselect", (e) => {
    const formID = e.currentTarget.dataset.formMultiselect
    const request = (activeThread().pendingForms || []).find((item) => item.id === formID)
    if (!request) return
    const answer = formDraft({ ...request, sessionId: state.activeSessionId })
    const fieldKey = e.currentTarget.dataset.formKey
    const value = e.currentTarget.dataset.formValue
    const selected = Array.isArray(answer[fieldKey]) ? [...answer[fieldKey]] : []
    const index = selected.indexOf(value)
    if (index === -1) selected.push(value)
    else selected.splice(index, 1)
    answer[fieldKey] = selected
    renderThreadContent()
  }],
  ["data-form-boolean", (e) => {
    const formID = e.currentTarget.dataset.formBoolean
    const request = (activeThread().pendingForms || []).find((item) => item.id === formID)
    if (!request) return
    const answer = formDraft({ ...request, sessionId: state.activeSessionId })
    const fieldKey = e.currentTarget.dataset.formKey
    answer[fieldKey] = answer[fieldKey] !== true
    renderThreadContent()
  }],
  ["data-form-external", (e) => {
    const formID = e.currentTarget.dataset.formExternal
    const request = (activeThread().pendingForms || []).find((item) => item.id === formID)
    if (!request) return
    formDraft({ ...request, sessionId: state.activeSessionId })[e.currentTarget.dataset.formKey] = true
    renderThreadContent()
  }],
  ["data-form-submit", (e) => submitForm(e.currentTarget.dataset.formSubmit).catch((error) => showToast(error.message))],
  ["data-form-cancel", (e) => cancelForm(e.currentTarget.dataset.formCancel).catch((error) => showToast(error.message))],
  // data-action is the broad fallback — checked last so specific attributes win.
  ["data-action", (e) => handleAction(e)],
]

// input handlers, most-specific first.
const DELEGATED_INPUT = [
  ["data-form-input", (e) => {
    const formID = e.currentTarget.dataset.formInput
    const request = (activeThread().pendingForms || []).find((item) => item.id === formID)
    if (!request) return
    const fieldKey = e.currentTarget.dataset.formKey
    const field = (request.fields || []).find((item) => item.key === fieldKey)
    const raw = e.currentTarget.value
    formDraft({ ...request, sessionId: state.activeSessionId })[fieldKey] =
      field?.type === "number" || field?.type === "integer" ? (raw === "" ? undefined : Number(raw)) : raw
  }],
  ["data-session-rename-input", (e) => {
    state.sessionRenameDraft = e.currentTarget.value
    state.sessionRenameError = null
  }],
  ["data-project-rename-input", (e) => {
    state.projectRenameDraft = e.currentTarget.value
    state.projectRenameError = null
  }],
  ["data-memory-project", (e) => {
    if (state.memorySaving) return
    state.selectedMemoryProjectId = normalizeMemoryProjectId(e.currentTarget.value)
    // Only the project scope changes when switching the selector; keep unsaved global-memory edits.
    loadMemory({ preserveGlobalDraft: true }).catch((error) => {
      state.memoryError = error?.message || "Failed to load memory."
      render()
    })
  }],
  ["data-field", (e) => updateConfigField(e.currentTarget.dataset.field, e.currentTarget.value)],
  ["data-model-modalities", (e) => updateModelModalities(e.currentTarget.dataset.modelId, e.currentTarget.dataset.modelModalities, e.currentTarget.value)],
  ["data-projects-search", (e) => {
    state.projectsQuery = e.currentTarget.value
  }],
  ["data-new-session-project-search", (e) => {
    state.newSessionProjectQuery = e.currentTarget.value
    filterNewSessionProjectsDom()
  }],
  ["data-skills-search", (e) => {
    state.skillsQuery = e.currentTarget.value
    filterSkillsDom()
  }],
  ["data-memory-field", (e) => {
    if (!state.memoryDraft) return
    state.memoryDraft[e.currentTarget.dataset.memoryField] = e.currentTarget.value
    // Light up the editor's "dirty" dot without re-rendering (keeps caret/focus).
    e.currentTarget.closest(".editor")?.classList.add("dirty")
  }],
  ["data-reference-field", (e) => {
    if (!state.referenceDraft) return
    state.referenceDraft[e.currentTarget.dataset.referenceField] = e.currentTarget.value
  }],
  ["data-mcp-header", (e) => {
    if (!state.mcpDraft) return
    const index = Number(e.currentTarget.dataset.mcpHeaderIndex)
    const row = state.mcpDraft.headers?.[index]
    if (row) row[e.currentTarget.dataset.mcpHeader] = e.currentTarget.value
  }],
  ["data-mcp-env", (e) => {
    if (!state.mcpDraft) return
    const index = Number(e.currentTarget.dataset.mcpEnvIndex)
    const row = state.mcpDraft.env?.[index]
    if (row) row[e.currentTarget.dataset.mcpEnv] = e.currentTarget.value
  }],
  ["data-mcp-field", (e) => {
    if (!state.mcpDraft) return
    state.mcpDraft[e.currentTarget.dataset.mcpField] = e.currentTarget.value
  }],
  ["data-question-other", (e) => {
    const draft = questionDraft(state.activeSessionId, e.currentTarget.dataset.questionOther, Number(e.currentTarget.dataset.questionIndex))
    draft.other = e.currentTarget.value
  }],
]

// mousedown handlers (preventDefault to keep textarea focus while clicking a menu item).
const DELEGATED_MOUSEDOWN = [
  ["data-command", (e) => {
    e.preventDefault()
    selectCommand(e.currentTarget.dataset.command)
  }],
  ["data-file-mention", (e) => {
    e.preventDefault()
    selectFileMention(e.currentTarget.dataset.fileMention).catch((error) => showToast(error.message))
  }],
  ["data-resizer", (e) => startSidebarResize(e)],
  ["data-document-resizer", (e) => startDocumentViewerResize(e)],
  ["data-right-file-resizer", (e) => startRightFileSidebarResize(e)],
  ["data-terminal-dock-resizer", (e) => startTerminalDockResize(e)],
]

// Walk an ordered table for the first matching ancestor of event.target and run its handler.
// `[data-stop-click]` (used on modal content) is a boundary: a matched element that lives OUTSIDE
// that boundary (e.g. the backdrop's data-action="cancel…") is skipped when the click originated
// INSIDE the modal, mirroring the old per-element event.stopPropagation() on the modal content.
// Buttons inside the modal still match normally since they sit within the boundary.
// The ordered table walk, used by the island host listeners (islandActions.delegate) — every
// interactive element lives inside an island now, so there is no #root-level table dispatch.
function dispatchDelegatedTable(event, table) {
  const stopBoundary = event.target.closest?.("[data-stop-click]") || null
  for (const [attribute, handler] of table) {
    const element = event.target.closest?.(`[${attribute}]`)
    if (!element) continue
    // If a stop-click boundary exists and the matched element is an ancestor of it (outside the
    // protected content), this click must not trigger that handler — skip to the next entry.
    if (stopBoundary && element !== stopBoundary && element.contains?.(stopBoundary)) continue
    const { shim, isStopped } = delegationShim(event, element)
    handler(shim)
    if (isStopped()) return
    return
  }
}

// The two rename inputs share Enter=confirm / Escape=close keydown behavior.
function handleRenameKeydown(event, element) {
  if (element.matches("[data-session-rename-input]")) {
    if (event.key === "Enter") {
      event.preventDefault()
      confirmRenameSession().catch((error) => showToast(error.message))
    }
    if (event.key === "Escape" && !state.sessionRenaming) {
      event.preventDefault()
      closeRenameSessionModal()
    }
    return
  }
  if (element.matches("[data-project-rename-input]")) {
    if (event.key === "Enter") {
      event.preventDefault()
      confirmRenameProject().catch((error) => showToast(error.message))
    }
    if (event.key === "Escape" && !state.projectRenaming) {
      event.preventDefault()
      closeRenameProjectModal()
    }
  }
}

// A single floating tooltip that follows the cursor over any resize divider
// (elements carrying data-tip-main, written by resizeTipAttrs). Delegated on
// document so it survives re-renders without rebinding; appears after a short
// hover delay and hides on leave or while a drag is in progress (.app.resizing).
function attachResizeTip() {
  const tip = document.createElement("div")
  tip.className = "resize-tip"
  document.body.appendChild(tip)

  const OFFSET_X = 16  // keep the box clear of the cursor
  const GAP = 8        // min distance from the viewport edge
  let target = null    // the resizer currently hovered
  let showTimer = null

  const hide = () => {
    tip.classList.remove("visible")
    target = null
    if (showTimer) { clearTimeout(showTimer); showTimer = null }
  }

  const place = (x, y) => {
    // Measure after the content is set so width/height are accurate.
    const w = tip.offsetWidth
    const h = tip.offsetHeight
    let left = x + OFFSET_X
    if (left + w + GAP > window.innerWidth) left = x - OFFSET_X - w  // flip left near the right edge
    let top = y - h / 2
    top = Math.max(GAP, Math.min(top, window.innerHeight - h - GAP))
    tip.style.left = `${Math.max(GAP, left)}px`
    tip.style.top = `${top}px`
  }

  document.addEventListener("mousemove", (event) => {
    // A drag is in progress — never show a hint.
    if (document.querySelector(".app.resizing")) { hide(); return }
    const resizer = event.target.closest?.("[data-tip-main]")
    if (!resizer) { if (target) hide(); return }
    if (resizer !== target) {
      target = resizer
      const key = resizer.dataset.tipKey
      const keyChip = key ? `<span class="tip-key">${escapeHtml(key)}</span>` : ""
      tip.innerHTML = `<span class="tip-main">${escapeHtml(resizer.dataset.tipMain || "")}${keyChip}</span><span class="tip-sub">${escapeHtml(resizer.dataset.tipSub || "")}</span>`
      if (showTimer) clearTimeout(showTimer)
      showTimer = setTimeout(() => { tip.classList.add("visible") }, 300)
    }
    place(event.clientX, event.clientY)
  })
  // Hide immediately when a drag starts (mousedown on a resizer).
  document.addEventListener("mousedown", (event) => {
    if (event.target.closest?.("[data-tip-main]")) hide()
  })
  window.addEventListener("blur", hide)
}

// Attach the #root listeners exactly once. Table dispatch happens island-side (the islands
// attach their own host listeners walking the same tables). Prompt editor input/keydown/paste/
// composition handling is owned by PromptEditor.svelte's own action, not registered here. What's
// left on #root is the skill-upload drag/drop delegation below.
function installDelegatedListeners() {
  const root = document.getElementById("root")
  if (!root || root.dataset.delegated === "1") return
  root.dataset.delegated = "1"

  // Cmd/Ctrl+B toggles the sidebar from anywhere (mirrors the divider tooltip
  // hint). Listens on window so it fires regardless of focus; toggling the
  // sidebar never steals text focus, so it is safe inside the composer.
  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "b") {
      event.preventDefault()
      toggleSidebar()
    }
    if (event.key === "Escape" && state.fileTreeContextMenu) {
      state.fileTreeContextMenu = null
      render()
    }
  })

  // The skill-upload dropzone is a single transient element; delegate its drag/drop off #root.
  root.addEventListener("dragover", (event) => {
    const zone = event.target.closest?.("[data-skill-drop]")
    if (!zone) return
    event.preventDefault()
    zone.classList.add("dragging")
  })
  root.addEventListener("dragleave", (event) => {
    const zone = event.target.closest?.("[data-skill-drop]")
    if (zone) zone.classList.remove("dragging")
  })
  root.addEventListener("drop", (event) => {
    const zone = event.target.closest?.("[data-skill-drop]")
    if (!zone) return
    event.preventDefault()
    zone.classList.remove("dragging")
    const file = event.dataTransfer?.files?.[0]
    const filePath = file ? window.openworking.skills.pathForFile(file) : ""
    if (!filePath) {
      showToast("Drop a .zip or .skill file from disk.")
      return
    }
    uploadSkill(filePath).catch((error) => showToast(error.message))
  })

  attachResizeTip()
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
    if (state.ideMenu && !event.target.closest(".ide-split-btn")) {
      state.ideMenu = null
      dirty = true
    }
    if (state.popover && !event.target.closest(".popover-anchor")) {
      state.popover = null
      dirty = true
    }
    if (state.fileTreeContextMenu && !event.target.closest(".mini-context-menu")) {
      state.fileTreeContextMenu = null
      dirty = true
    }
    if (dirty) render()
  })

  installDelegatedListeners()
  window.openworking.onProfileUpdate(handleProfileUpdate)
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
  loadInitialState().catch((error) => {
    document.getElementById("root").innerHTML = `<pre class="fatal">${escapeHtml(error.stack || error.message)}</pre>`
  })
}
