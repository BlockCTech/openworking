const { app, BrowserWindow, clipboard, ipcMain, dialog, Menu, shell } = require("electron")
const fs = require("node:fs")
const path = require("node:path")
const { assertTranslationArtifact, assertProjectFile, assertProjectDirectory, listProjectDirectory, previewTranslationArtifact, readProjectFileContent } = require("./artifact-path")
const { AttachmentRegistry } = require("./attachment-registry")
const { validatedExternalAttachments } = require("./external-attachment-validation")
const { bootstrapMainProcess } = require("./main-bootstrap")
const { defaultConfigPath, listReferenceEntries, addReferenceEntry, removeReferenceEntry } = require("./opencode-config")
const { buildReferenceEntry } = require("./reference-path")
const { defaultProfileDir, ensureBrowserMcpServer, ensureOpenworkingProfile, installCustomSkillArchive, listCustomSkills, listManagedPlugins, readSkillMarkdown, uninstallCustomSkill, addMcpServer, updateMcpServer, listMcpServers, removeMcpServer, setMcpServerEnabled, readProfileConfig, setActiveProjectMemory, syncRuntimeXdgConfig, writeEditableProfileConfig } = require("./opencode-profile")
const { ProfileLifecycle, isProfileStorageError } = require("./profile-lifecycle")
const browserBridge = require("./browser-bridge")
const { SCOPES, ensureProjectMemory, readMemory, shouldReloadRuntimeForMemorySave, writeMemory } = require("./memory-store")
const { ProjectRegistry } = require("./project-registry")
const { resolveRegisteredProjectDirectory } = require("./project-context")
const { PinRegistry } = require("./pin-registry")
const { openInIde } = require("./ide-launcher")
const { isGitRepo, getCurrentBranch, listBranches, listWorktrees, checkoutBranch, sameRepository, repairProjectWorktrees } = require("./git-worktree")
const { RuntimeProcessManager } = require("./runtime/process-manager")
const { validateSessionInputPayload } = require("./runtime/runtime-contract")
const { saveSessionExport } = require("./session-export")
const { BACKLOG_PACKAGE, backlogCommand, ensureBacklogServer, isLegacyBacklogNpxCommand } = require("./mcp-install")
const { checkDesktopVersion, downloadInstaller, installDmg, launchWindowsInstaller, verifyWindowsInstaller, versionCheckConfigured } = require("./version-check")
const { windowsPublisherName = "" } = require("../package.json")

// Walks up from the executable path to the enclosing .app bundle directory.
// Returns null when not running from a packaged .app (e.g. `electron .` in dev).
function resolveAppBundlePath(exePath) {
  let current = exePath
  while (current && current !== path.dirname(current)) {
    if (current.endsWith(".app")) return current
    current = path.dirname(current)
  }
  return null
}

// Locate a bundled resource dir in both dev (repo resources/) and packaged (process.resourcesPath).
function resolveBundledResource(...segments) {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, ...segments)
  if (packaged && fs.existsSync(packaged)) return packaged
  return path.join(__dirname, "..", "resources", ...segments)
}

// Shared dir where the browser native host and MCP rendezvous via token/port sidecars.
// MUST live under userData, NOT in ~/Desktop, ~/Documents or ~/Downloads: macOS TCC blocks Chrome from
// executing the native-host launcher inside those protected folders, so the host silently never starts
// (connectNative still returns a port, so the extension popup misleadingly shows "connected"). userData
// is also the local-first home for app-managed state. OPENWORKING_BROWSER_HOST_DIR overrides for dev.
// NOTE: host.token is a loopback secret (written 0600).
function browserHostDir() {
  if (process.env.OPENWORKING_BROWSER_HOST_DIR) return process.env.OPENWORKING_BROWSER_HOST_DIR
  return path.join(app.getPath("userData"), "browser-host")
}

// Declare the bundled browser MCP so opencode serve spawns it. Runs the MCP under the Electron binary in
// node mode (always present in the .app; no system node required) and points it at the shared host dir.
function ensureBrowserMcp(profile = requireReadyProfile()) {
  if (process.platform !== "darwin") return null
  try {
    ensureBrowserMcpServer(profile, {
      command: [process.execPath, resolveBundledResource("browser-mcp", "index.js")],
      environment: {
        ELECTRON_RUN_AS_NODE: "1",
        OPENWORKING_BROWSER_HOST_DIR: browserHostDir()
      }
    })
  } catch (error) {
    if (isProfileStorageError(error)) throw error
    // Non-fatal: the browser feature stays unavailable, but the app must still boot.
    console.error("browser MCP declaration failed:", error.message)
  }
}

let mainWindow = null
let projectRegistry = null
let pinRegistry = null
let runtimeManager = null
let opencodeProfile = null
let profileLifecycle = null
const attachmentRegistry = new AttachmentRegistry()

const APP_DISPLAY_NAME = "OpenWorking"

// Pin userData BEFORE app.setName so that renaming the app (now or later) never
// moves where user data lives. Tests set OPENWORKING_USER_DATA_DIR to redirect.
if (process.env.OPENWORKING_USER_DATA_DIR) {
  app.setPath("userData", process.env.OPENWORKING_USER_DATA_DIR)
} else {
  app.setPath("userData", path.join(app.getPath("appData"), APP_DISPLAY_NAME))
}

// Set the display name (macOS menu bar in dev, About panel). userData was pinned
// above so this never moves storage.
app.setName(APP_DISPLAY_NAME)

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function requiredString(payload, key, label) {
  const value = typeof payload?.[key] === "string" ? payload[key].trim() : ""
  if (!value) throw new Error(`${label} is required.`)
  return value
}

function validatedModelRef(model) {
  const providerID = typeof model?.providerID === "string" ? model.providerID.trim() : ""
  const id = typeof model?.id === "string" ? model.id.trim() : ""
  const variant = typeof model?.variant === "string" ? model.variant.trim() : ""
  if (!providerID || !id) throw new Error("A valid model is required.")
  return { providerID, id, ...(variant ? { variant } : {}) }
}

function validatedSessionPayload(payload) {
  return { sessionId: requiredString(payload, "sessionId", "Session ID") }
}

function validatedFormAnswer(answer) {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) throw new Error("A valid form answer is required.")
  const projected = {}
  for (const [key, value] of Object.entries(answer)) {
    if (!key || typeof key !== "string") throw new Error("A valid form field key is required.")
    if (
      typeof value !== "string" &&
      !(typeof value === "number" && Number.isFinite(value)) &&
      typeof value !== "boolean" &&
      !(Array.isArray(value) && value.every((item) => typeof item === "string"))
    ) throw new Error(`Invalid answer for form field: ${key}`)
    projected[key] = value
  }
  return projected
}

// Projects a config `references` map entry ({[name]: string | ConfigV2.Reference.Local |
// ConfigV2.Reference.Git}) into a flat, renderer-safe shape. A bare string entry is a shorthand
// local path per the bundled config schema. Local-path entries carry `available`, checked with
// fs.existsSync against the stored (already realpath-resolved) path, so the renderer can flag a
// reference whose directory/file has since been moved or deleted without touching Node fs itself
// (contextIsolation blocks that from the renderer). Git entries have no local existence to check.
function projectedConfigReference(name, entry) {
  if (typeof entry === "string" && entry.trim()) return { name, path: entry, description: "", hidden: false, available: fs.existsSync(entry) }
  if (!entry || typeof entry !== "object") return null
  if (typeof entry.path === "string" && entry.path) {
    return { name, path: entry.path, description: typeof entry.description === "string" ? entry.description : "", hidden: Boolean(entry.hidden), available: fs.existsSync(entry.path) }
  }
  if (typeof entry.repository === "string" && entry.repository) {
    return {
      name,
      repository: entry.repository,
      ...(typeof entry.branch === "string" && entry.branch ? { branch: entry.branch } : {}),
      description: typeof entry.description === "string" ? entry.description : "",
      hidden: Boolean(entry.hidden)
    }
  }
  return null
}

// The renderer never gets to name an arbitrary program for pty:create to run — it can only ask
// for "a terminal," and main resolves that to the user's own configured shell. This keeps the
// highest-risk goal in this app (command execution) from also being an arbitrary-binary-execution
// primitive: the actual command a shell runs is whatever the user types afterward, over stdin,
// exactly like opening Terminal.app themselves — not something the renderer chooses up front.
function defaultShellCommand() {
  if (process.platform === "win32") return { command: process.env.COMSPEC || "cmd.exe", args: [] }
  return { command: process.env.SHELL || "/bin/bash", args: [] }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 520,
    minHeight: 680,
    title: APP_DISPLAY_NAME,
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.loadFile(path.join(__dirname, "index.html"))
}

function requireReadyProfile() {
  if (!profileLifecycle) {
    const error = new Error("The OpenWorking profile has not been initialized.")
    error.code = "PROFILE_BLOCKED"
    throw error
  }
  return profileLifecycle.requireReady()
}

async function blockProfile(error) {
  if (!profileLifecycle) return
  profileLifecycle.block(error)
  opencodeProfile = null
  if (runtimeManager) runtimeManager.profile = null
  if (runtimeManager?.snapshot().status !== "idle") {
    try { await runtimeManager.stop() } catch { /* best-effort recovery shutdown */ }
  }
}

async function withProfileOperation(run) {
  const profile = requireReadyProfile()
  try {
    return await run(profile)
  } catch (error) {
    if (isProfileStorageError(error)) await blockProfile(error)
    throw error
  }
}

function profileIpc(run) {
  return (event, ...args) => withProfileOperation((profile) => run(profile, event, ...args))
}

function existingProfileFolder() {
  const snapshot = profileLifecycle.snapshot()
  let candidate = path.dirname(snapshot.configPath || "")
  if (!candidate || candidate === ".") candidate = snapshot.profileDir
  while (candidate && !fs.existsSync(candidate)) {
    const parent = path.dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  return candidate
}

// Touch the project folder from the GUI (main) process BEFORE spawning the runtime.
// The runtime reads the project via a spawned `opencode` child (a non-GUI Bun CLI):
// macOS won't raise its "Allow access" TCC prompt for a background child accessing a
// protected folder (Desktop/Documents/Downloads/iCloud), it just denies silently — so
// on the first launch after an upgrade (when the ad-hoc signature changes and the old
// TCC grant no longer applies) the runtime fails and no sessions load until a second
// launch. Reading the directory here, from the foreground app, makes macOS attribute
// the request to the app and show the prompt at the right moment. A clear error lets
// the renderer explain what happened instead of rendering an empty session list.
// A project's runtime cwd is either its main path or, if the user has switched worktrees,
// the last worktree they selected (persisted as activeWorktreePath). Falls back to the main
// path if the persisted worktree directory was deleted, OR if it does not actually belong to
// this project's repository — the latter self-heals projects.json entries corrupted by the old
// global-gitInfo bug, where a stale popover could write another repo's path here.
function effectiveProjectPath(project) {
  const worktree = project.activeWorktreePath
  if (worktree && fs.existsSync(worktree) && sameRepository(project.path, worktree)) {
    return worktree
  }
  return project.path
}

function resolveProjectContext({ projectId, directory } = {}) {
  const project = projectRegistry.list().find((item) => item.id === projectId)
  if (!project) throw new Error("Project not found.")
  if (directory) return resolveRegisteredProjectDirectory(project, directory)
  return effectiveProjectPath(project)
}

function ensureProjectAccess(projectPath) {
  if (!projectPath) return
  try {
    fs.readdirSync(projectPath)
  } catch (error) {
    if (error.code === "EPERM" || error.code === "EACCES") {
      if (process.platform === "darwin") {
        throw new Error(
          `macOS is blocking access to the project folder (${projectPath}). Allow file access for the app when macOS asks, or grant it in System Settings › Privacy & Security › Files and Folders, then reopen the project.`
        )
      }
      throw new Error(`The app cannot access the project folder (${projectPath}). Check its Windows permissions, then reopen the project.`)
    }
    if (error.code === "ENOENT") {
      throw new Error(`The project folder no longer exists: ${projectPath}`)
    }
    throw error
  }
}

// Reuses the existing version-check flow for the manual "Check for Updates…" menu
// item. When an update is available, the gate is pushed to the renderer so the
// already-built force modal / soft "Update" pill handle the download+install. When
// the user is current (or the check fails), a manual trigger surfaces a dialog;
// the automatic startup check stays silent (fail-open) as before.
async function runUpdateCheck({ manual = false } = {}) {
  let gate
  try {
    gate = await checkDesktopVersion({ currentVersion: app.getVersion(), platform: process.platform })
  } catch {
    gate = { status: "ok", reason: "error" }
  }

  if (gate.status === "force" || gate.status === "soft") {
    send("version:gate", gate)
    return
  }

  if (!manual) return

  if (gate.reason === "error") {
    dialog.showMessageBox(mainWindow, {
      type: "warning",
      message: "Could not check for updates",
      detail: "Please check your network connection and try again.",
      buttons: ["OK"]
    })
    return
  }

  dialog.showMessageBox(mainWindow, {
    type: "info",
    message: "You are on the latest version",
    detail: `${APP_DISPLAY_NAME} ${app.getVersion()}`,
    buttons: ["OK"]
  })
}

// macOS application menu with a Codex-style "Check for Updates…" item under About.
// Other roles keep the standard behavior. Windows keeps Electron's default menu.
function buildAppMenu() {
  if (process.platform !== "darwin") return null
  return Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: "about" },
        // The update flow needs a self-hosted version API (OPENWORKING_VERSION_API_BASE).
        ...(versionCheckConfigured() ? [{ label: "Check for Updates…", click: () => runUpdateCheck({ manual: true }) }] : []),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ])
}

function registerIpc() {
  ipcMain.handle("profile:getStatus", () => profileLifecycle.snapshot())
  ipcMain.handle("profile:retry", async () => {
    if (runtimeManager) {
      try { await runtimeManager.stop() } catch { /* best-effort before profile repair */ }
    }
    return profileLifecycle.initialize({ publish: true })
  })
  ipcMain.handle("profile:openFolder", async () => {
    const folder = existingProfileFolder()
    const error = await shell.openPath(folder)
    if (error) throw new Error(error)
    return folder
  })

  // Repairs projects.json on read: drops any activeWorktreePath that resolves to a different repo
  // than its project (corruption the old global-gitInfo popover bug could persist). Without this the
  // renderer's projectAllPaths would pull that other repo's sessions into this project and hide them
  // from where they belong. The repair persists once so it self-heals for future launches too.
  ipcMain.handle("projects:list", () => {
    const { projects, changed } = repairProjectWorktrees(projectRegistry.list(), {
      exists: (target) => fs.existsSync(target),
      sameRepo: sameRepository
    })
    if (changed) projectRegistry.save(projects)
    return projects
  })
  ipcMain.handle("projects:add", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a local project folder",
      properties: ["openDirectory", "createDirectory"]
    })
    if (result.canceled || !result.filePaths.length) return null
    return projectRegistry.add(result.filePaths[0])
  })
  ipcMain.handle("projects:remove", (_event, projectId) => projectRegistry.remove(projectId))
  ipcMain.handle("projects:rename", (_event, projectId, name) => projectRegistry.rename(projectId, name))
  ipcMain.handle("projects:touch", (_event, projectId) => projectRegistry.touch(projectId))
  ipcMain.handle("projects:setPinned", (_event, projectId, pinned) => projectRegistry.setPinned(projectId, pinned))

  ipcMain.handle("git:info", async (_event, { projectId } = {}) => {
    const project = projectRegistry.list().find((item) => item.id === projectId)
    if (!project) throw new Error("Project not found.")
    const dir = effectiveProjectPath(project)
    if (!isGitRepo(dir)) return { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] }
    const [currentBranch, branches, worktrees] = await Promise.all([
      getCurrentBranch(dir),
      listBranches(dir),
      listWorktrees(dir)
    ])
    return { isGitRepo: true, currentBranch, branches, worktrees }
  })

  ipcMain.handle("git:checkoutBranch", async (_event, { projectId, branchName } = {}) => {
    const project = projectRegistry.list().find((item) => item.id === projectId)
    if (!project) throw new Error("Project not found.")
    const dir = effectiveProjectPath(project)
    await checkoutBranch(dir, branchName)
    return { currentBranch: await getCurrentBranch(dir) }
  })

  ipcMain.handle("git:switchWorktree", async (_event, { projectId, worktreePath } = {}) => {
    const project = projectRegistry.list().find((item) => item.id === projectId)
    if (!project) throw new Error("Project not found.")
    if (!fs.existsSync(worktreePath)) throw new Error(`Worktree folder no longer exists: ${worktreePath}`)
    // Defense in depth: never persist a worktree that isn't part of this project's own repository,
    // so a mis-targeted switch can't corrupt projects.json (the class of bug that pointed one
    // project's activeWorktreePath at an unrelated repo).
    if (!sameRepository(project.path, worktreePath)) {
      throw new Error("That worktree does not belong to this project's repository.")
    }
    const updated = projectRegistry.setActiveWorktree(projectId, worktreePath)
    const runtimeTarget = { ...updated, path: effectiveProjectPath(updated) }
    ensureProjectAccess(runtimeTarget.path)
    projectRegistry.touch(projectId)
    const runtime = await runtimeManager.openProject({ project: runtimeTarget })
    return { project: updated, runtime }
  })

  // Working-copy changes for the Changes panel. resolveProjectContext is the whole security
  // boundary: the renderer-supplied directory must match a registered project path or its active
  // worktree, and it resolves to effectiveProjectPath otherwise — so the panel can only ever
  // report on a directory the user actually opened, and always on the right worktree.
  // Best-effort like mcp:status: the panel is secondary UI and must not error while the runtime
  // is still starting. A genuinely broken request still surfaces through vcs:diff below.
  ipcMain.handle("vcs:status", async (_event, { projectId, directory } = {}) => {
    const projectPath = resolveProjectContext({ projectId, directory })
    try {
      return await runtimeManager.vcsStatus(projectPath)
    } catch {
      return { files: [], truncated: false }
    }
  })

  ipcMain.handle("vcs:diff", async (_event, { projectId, directory, file } = {}) => {
    const projectPath = resolveProjectContext({ projectId, directory })
    if (typeof file !== "string" || !file) throw new Error("File path is required.")
    return await runtimeManager.vcsDiff(projectPath, { file })
  })

  // Opens a project in an external IDE (or the OS default).
  // `ideOverride` is always a concrete id by the time it gets here — the renderer resolves
  // system/vscode/cursor/antigravity from its own localStorage-backed default before calling
  // this (see openIde/setDefaultIde in renderer.js); "system" here is just a defensive fallback.
  ipcMain.handle("open-ide", async (_event, { projectId, ideOverride } = {}) => {
    const project = projectRegistry.list().find((item) => item.id === projectId)
    if (!project) throw new Error("Project not found.")
    const ideId = ideOverride || "system"
    if (ideId === "system") {
      const error = await shell.openPath(project.path)
      if (error) throw new Error(error)
      return { ideId }
    }
    await openInIde(ideId, project.path, { platform: process.platform })
    return { ideId }
  })

  ipcMain.handle("pins:list", () => pinRegistry.list())
  ipcMain.handle("pins:set", (_event, { sessionId, pinned, meta }) => pinRegistry.set(sessionId, pinned, meta))

  ipcMain.handle("config:get", profileIpc(async (profile) => ({
    ...readProfileConfig(profile),
    customSkills: listCustomSkills(profile),
    managedPlugins: listManagedPlugins(),
    mcp: listMcpServers(profile)
  })))
  ipcMain.handle("config:save", profileIpc(async (profile, _event, config) => {
    const result = writeEditableProfileConfig(profile, config)
    await runtimeManager.reload()
    return { ...result, customSkills: listCustomSkills(profile) }
  }))
  ipcMain.handle("skills:upload", profileIpc(async (profile) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Upload an OpenCode skill",
      filters: [{ name: "OpenCode skills", extensions: ["zip", "skill"] }],
      properties: ["openFile"]
    })
    if (result.canceled || !result.filePaths.length) return null
    const installed = installCustomSkillArchive(profile, result.filePaths[0])
    await runtimeManager.reload()
    return installed
  }))
  ipcMain.handle("skills:installPath", profileIpc(async (profile, _event, filePath) => {
    const installed = installCustomSkillArchive(profile, String(filePath || ""))
    await runtimeManager.reload()
    return installed
  }))
  ipcMain.handle("skills:read", profileIpc((profile, _event, skillName) => readSkillMarkdown(profile, skillName)))
  ipcMain.handle("skills:uninstall", profileIpc(async (profile, _event, skillName) => {
    const result = uninstallCustomSkill(profile, skillName)
    await runtimeManager.reload()
    return { ...result, customSkills: listCustomSkills(profile) }
  }))

  // A command (string or array) references the Backlog MCP package — covers the `npx
  // backlog-mcp-server` preset and any user-typed variant. Used to swap in the node-based launcher.
  function commandUsesBacklog(command) {
    if (Array.isArray(command)) return command.some((part) => String(part).includes(BACKLOG_PACKAGE))
    return String(command || "").includes(BACKLOG_PACKAGE)
  }

  // For a Backlog connector, install the package on-demand into the app profile and rewrite the
  // payload's command to `node <entry>` so it never runs through npx (which a project's
  // devEngines/packageManager can break with EBADDEVENGINES). No-op for other servers.
  async function prepareBacklogCommand(server) {
    if (!server || (server.name !== "backlog" && !commandUsesBacklog(server.command))) return server
    const profile = requireReadyProfile()
    await ensureBacklogServer(profile.profileDir)
    return { ...server, command: backlogCommand(profile.profileDir) }
  }

  // Ensure an already-stored Backlog connector is installed and using the node-based command.
  // Migrates a legacy `npx backlog-mcp-server` command in place (preserving env). No-op for others.
  async function ensureBacklogConnectorReady(name) {
    const profile = requireReadyProfile()
    const stored = readProfileConfig(profile).config.mcp?.[name]
    if (!stored || (name !== "backlog" && !commandUsesBacklog(stored.command))) return
    await ensureBacklogServer(profile.profileDir)
    if (isLegacyBacklogNpxCommand(stored.command)) {
      updateMcpServer(profile, name, {
        type: "local",
        command: backlogCommand(profile.profileDir),
        environment: stored.environment || {}
      })
    }
  }

  // Adding an MCP server used to restart the whole runtime, which killed whatever session the user
  // was running. The bundled runtime now reconciles NEW `mcp.servers` in place from the config file,
  // so we re-translate the profile into the runtime (XDG) config — nothing else does that once
  // reload() is gone — and let applyMcpConfig() confirm the server actually appeared, falling back
  // to a full restart if it did not.
  //
  // Only ADD is hot-reloadable. Probed against a real 0.0.0-next-17055: booting with no servers,
  // then writing one into the config, surfaces it on GET /api/mcp within ~500ms under the same pid;
  // but writing that server back out again (or flipping it to `disabled: true`) leaves it listed as
  // "pending" indefinitely. Upstream's reloadConfig() does implement removeServer(), so this looks
  // like a teardown bug rather than a missing feature — until it is fixed, removal and disable must
  // keep restarting the runtime or the server would linger and keep serving tools.
  async function applyMcpAdd(profile, expect = []) {
    syncRuntimeXdgConfig(profile)
    await runtimeManager.applyMcpConfig({ expect })
  }

  ipcMain.handle("mcp:list", profileIpc((profile) => listMcpServers(profile)))
  ipcMain.handle("mcp:add", profileIpc(async (profile, _event, server) => {
    try {
      const prepared = await prepareBacklogCommand(server)
      const added = addMcpServer(profile, prepared)
      await applyMcpAdd(profile, added?.name ? [added.name] : [])
      return { server: added, servers: listMcpServers(profile) }
    } catch (error) {
      if (isProfileStorageError(error)) throw error
      return { error: error.message }
    }
  }))
  // Updating rewrites an existing server (and may rename it), which needs the old one torn down —
  // the runtime cannot do that in place, so this stays a restart.
  ipcMain.handle("mcp:update", profileIpc(async (profile, _event, { name, server }) => {
    const updated = updateMcpServer(profile, name, server)
    await runtimeManager.reload()
    return { server: updated, servers: listMcpServers(profile) }
  }))
  ipcMain.handle("mcp:setEnabled", profileIpc(async (profile, _event, { name, enabled }) => {
    try {
      // Enabling a Backlog connector (possibly added before the node-based launcher, or never
      // installed) ensures the package and migrates a legacy `npx` command to `node <entry>`.
      if (enabled) await ensureBacklogConnectorReady(name)
      setMcpServerEnabled(profile, name, enabled)
      // Disabling must actually stop the server, which hot-reload does not do — restart instead.
      await runtimeManager.reload()
      return { servers: listMcpServers(profile) }
    } catch (error) {
      if (isProfileStorageError(error)) throw error
      return { error: error.message }
    }
  }))
  ipcMain.handle("mcp:remove", profileIpc(async (profile, _event, name) => {
    removeMcpServer(profile, name)
    await runtimeManager.reload()
    return { servers: listMcpServers(profile) }
  }))
  ipcMain.handle("mcp:status", async () => {
    try {
      return await runtimeManager.listMcpStatus()
    } catch {
      // Runtime may not be running yet (no project open); treat as no status.
      return []
    }
  })
  ipcMain.handle("mcp:openDocs", async (_event, url) => {
    // Only open http/https links in the external browser — guard against file://, etc.
    const target = String(url || "")
    if (!/^https?:\/\//i.test(target)) throw new Error("Only http(s) documentation links can be opened.")
    await shell.openExternal(target)
    return true
  })

  // Browser-use bridge: install the Chrome native-messaging host, report status, and open the
  // chrome://extensions page so the user can load/enable the bundled extension. This is the single new
  // guarded IPC group. The host manifest is pinned to our extension id; the loopback is 127.0.0.1 + token.
  const browserUnsupported = () => ({
    supported: false,
    reason: "Browser integration is currently available on macOS only.",
    chromeInstalled: false,
    hostInstalled: false,
    extensionId: browserBridge.BROWSER_EXTENSION_ID
  })
  const requireBrowserPlatform = () => {
    if (process.platform !== "darwin") throw new Error(browserUnsupported().reason)
  }
  ipcMain.handle("browser:status", () =>
    process.platform === "darwin"
      ? { supported: true, ...browserBridge.status({ hostDir: browserHostDir() }) }
      : browserUnsupported()
  )
  ipcMain.handle("browser:installHost", profileIpc((profile) => {
    requireBrowserPlatform()
    const result = browserBridge.installHost({
      hostDir: browserHostDir(),
      execPath: process.execPath,
      hostScript: resolveBundledResource("browser-host", "host.js")
    })
    // Make sure the MCP entry exists too, so a fresh install is immediately usable.
    ensureBrowserMcp(profile)
    return result
  }))
  ipcMain.handle("browser:openExtensionPage", async () => {
    requireBrowserPlatform()
    // chrome://extensions cannot be opened cross-process; the renderer guides the user. We just reveal
    // the bundled, load-unpacked extension folder so they can point Chrome at it.
    const extensionDir = resolveBundledResource("browser-extension")
    const error = await shell.openPath(extensionDir)
    if (error) throw new Error(error)
    return { extensionDir, extensionId: browserBridge.BROWSER_EXTENSION_ID }
  })
  // Drive the OAuth flow ourselves: startMcpAuth returns the authorization URL (opencode also
  // stands up its loopback callback server), we open it in the browser, then authenticateMcp waits
  // for the callback to complete. Opening the URL from the main process is more reliable than
  // relying on opencode's internal browser-open inside a headless `serve`.
  async function runMcpAuth(serverName) {
    const profile = requireReadyProfile()
    const { authorizationUrl } = await runtimeManager.startMcpAuth(serverName)
    if (authorizationUrl) await shell.openExternal(authorizationUrl)
    await runtimeManager.authenticateMcp(serverName)
    return {
      servers: listMcpServers(profile),
      status: await runtimeManager.listMcpStatus()
    }
  }
  ipcMain.handle("mcp:authenticate", profileIpc(async (_profile, _event, name) => {
    try {
      return await runMcpAuth(String(name || ""))
    } catch (error) {
      if (isProfileStorageError(error)) throw error
      return { error: error.message }
    }
  }))
  // Retry a (typically local) MCP server that failed to connect — e.g. a stdio server whose `npx`
  // could not be found on a stale PATH. Reload first so opencode picks up a freshly resolved PATH,
  // then re-connect and report the new status (with opencode's real failure reason if it still fails).
  ipcMain.handle("mcp:connect", profileIpc(async (profile, _event, name) => {
    const serverName = String(name || "")
    try {
      // For Backlog, make sure the package is installed and the command is the node-based launcher
      // before retrying — this is what recovers a connector that failed under the old npx command.
      await ensureBacklogConnectorReady(serverName)
      await runtimeManager.reload()
      await runtimeManager.connectMcp(serverName)
      return {
        servers: listMcpServers(profile),
        status: await runtimeManager.listMcpStatus()
      }
    } catch (error) {
      if (isProfileStorageError(error)) throw error
      return { error: error.message }
    }
  }))
  ipcMain.handle("mcp:clearAuth", profileIpc(async (_profile, _event, name) => {
    const serverName = String(name || "")
    try {
      const result = runtimeManager.clearMcpAuth(serverName)
      // Reload so the running opencode server picks up the cleared auth store, then re-auth fresh.
      await runtimeManager.reload()
      return { cleared: result.cleared, ...(await runMcpAuth(serverName)) }
    } catch (error) {
      if (isProfileStorageError(error)) throw error
      return { error: error.message }
    }
  }))

  // Cross-chat memory: the UI may read/write any saved project's memory file by explicit projectId,
  // but the runtime still treats only runtimeManager.snapshot().project as active for instruction
  // wiring/reloads. Global memory always exists.
  function activeProjectId() {
    return runtimeManager.snapshot().project?.id || null
  }
  function requestedMemoryProjectId(projectId, { requireProject = false } = {}) {
    const id = typeof projectId === "string" && projectId.trim() ? projectId.trim() : null
    if (!id) {
      if (requireProject) throw new Error("Choose a project before editing its memory.")
      return null
    }
    const known = projectRegistry.list().some((project) => project.id === id)
    if (!known) throw new Error("Selected project is no longer available.")
    return id
  }
  function memorySnapshot(targetProjectId) {
    const profileDir = requireReadyProfile().profileDir
    const projectId = requestedMemoryProjectId(targetProjectId)
    if (projectId) ensureProjectMemory(profileDir, projectId)
    return {
      global: readMemory(profileDir, "global"),
      project: projectId ? readMemory(profileDir, "project", projectId) : "",
      projectId,
      hasProject: !!projectId,
      activeProjectId: activeProjectId()
    }
  }
  ipcMain.handle("memory:get", profileIpc((_profile, _event, { projectId } = {}) => {
    return memorySnapshot(projectId)
  }))
  ipcMain.handle("memory:save", profileIpc(async (profile, _event, { scope, content, projectId: targetProjectId } = {}) => {
    if (!SCOPES.includes(scope)) throw new Error(`Invalid memory scope: ${scope}`)
    const profileDir = profile.profileDir
    const projectId = scope === "project"
      ? requestedMemoryProjectId(targetProjectId, { requireProject: true })
      : requestedMemoryProjectId(targetProjectId)
    writeMemory(profileDir, scope, projectId, content)
    // Re-read so OpenCode picks up edited files on the next session, but only reload the running
    // runtime when the edited scope affects the active project.
    const activeId = activeProjectId()
    const shouldReload = shouldReloadRuntimeForMemorySave(scope, projectId, activeId, runtimeManager.snapshot().status)
    if (shouldReload) await runtimeManager.reload()
    return memorySnapshot(projectId)
  }))

  ipcMain.handle("attachments:pick", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Attach files",
      properties: ["openFile", "multiSelections"]
    })
    if (result.canceled || !result.filePaths.length) return []
    return attachmentRegistry.add(result.filePaths)
  })
  ipcMain.handle("attachments:addProjectFile", async (_event, { filePath, projectId, directory } = {}) => {
    const projectPath = resolveProjectContext({ projectId, directory })
    const safePath = assertProjectFile(projectPath, filePath)
    return attachmentRegistry.addResolved([safePath])[0] || null
  })
  ipcMain.handle("attachments:discard", (_event, ids) => {
    attachmentRegistry.discard(Array.isArray(ids) ? ids : [])
  })

  // Config is authoritative (it's the only thing this app writes to, and GET /api/reference is
  // confirmed to always return data: [] against the pinned runtime — see the caveat comment on
  // the `references` entry in runtime-contract.js). Server entries are merged in for any name not
  // already known locally, so this list is correct today and picks up the runtime's own catalog
  // for free once that endpoint actually populates from config.
  ipcMain.handle("references:list", async (_event, payload) => {
    const directory = resolveProjectContext({ projectId: payload?.projectId, directory: payload?.directory })
    const configEntries = listReferenceEntries(requireReadyProfile().configPath)
    const fromConfig = Object.entries(configEntries).map(([name, entry]) => projectedConfigReference(name, entry)).filter(Boolean)
    const knownNames = new Set(fromConfig.map((item) => item.name))
    const fromServer = await runtimeManager.listReferences(directory).catch(() => [])
    return [...fromConfig, ...fromServer.filter((item) => !knownNames.has(item.name))]
  })
  ipcMain.handle("references:add", (_event, payload) => {
    const directory = resolveProjectContext({ projectId: payload?.projectId, directory: payload?.directory })
    const name = requiredString(payload, "name", "Reference name")
    // buildReferenceEntry runs the realpath boundary gate (for a local path) before returning, so
    // a path outside the project throws here and addReferenceEntry below never runs.
    const entry = buildReferenceEntry(directory, payload)
    // addReferenceEntry's return value carries the FULL profile config (including provider API
    // keys) — never forward it to the renderer. Echo back only what was actually added.
    addReferenceEntry(name, entry, requireReadyProfile().configPath)
    return { name, ...entry }
  })
  ipcMain.handle("references:remove", (_event, payload) => {
    const name = requiredString(payload, "name", "Reference name")
    removeReferenceEntry(name, requireReadyProfile().configPath)
  })

  // Unfiltered — see the `permissionSaved` endpoint comment in runtime-contract.js for why there
  // is no project scope to filter by yet.
  ipcMain.handle("permissions:listSaved", async () => runtimeManager.listSavedPermissions())
  ipcMain.handle("permissions:removeSaved", async (_event, payload) => {
    const id = requiredString(payload, "id", "Permission ID")
    await runtimeManager.removeSavedPermission(id)
  })

  ipcMain.handle("fs:find", async (_event, payload) => {
    const directory = resolveProjectContext({ projectId: payload?.projectId, directory: payload?.directory })
    const query = requiredString(payload, "query", "Search query")
    const type = payload?.type === "file" || payload?.type === "directory" ? payload.type : undefined
    const limit = Number.isFinite(payload?.limit) ? payload.limit : undefined
    return runtimeManager.findFiles(directory, { query, type, limit })
  })
  ipcMain.handle("fs:list", async (_event, payload) => {
    const directory = resolveProjectContext({ projectId: payload?.projectId, directory: payload?.directory })
    return runtimeManager.listFsEntries(directory, payload?.path)
  })
  // Gated with the same realpath boundary as files:read: fs/read entries come from the server's
  // own directory listing, but the file it names must still resolve to a real, in-project path on
  // this machine before its content is returned to the renderer.
  ipcMain.handle("fs:read", async (_event, payload) => {
    const directory = resolveProjectContext({ projectId: payload?.projectId, directory: payload?.directory })
    const relativePath = requiredString(payload, "path", "File path")
    assertProjectFile(directory, relativePath)
    return runtimeManager.readFsFile(directory, relativePath)
  })

  ipcMain.handle("pty:create", async (_event, payload) => {
    const directory = resolveProjectContext({ projectId: payload?.projectId, directory: payload?.directory })
    const title = typeof payload?.title === "string" && payload.title.trim() ? payload.title.trim() : undefined
    // A caller-supplied cwd must resolve to a real directory inside the project — same realpath
    // boundary discipline as assertProjectFile/assertReferencePath. No cwd falls back to the
    // project root itself.
    const cwd = payload?.cwd ? assertProjectDirectory(directory, payload.cwd).resolved : directory
    const { command, args } = defaultShellCommand()
    return runtimeManager.createPty(directory, { command, args, cwd, title })
  })
  ipcMain.handle("pty:list", async (_event, payload) => {
    const directory = resolveProjectContext({ projectId: payload?.projectId, directory: payload?.directory })
    return runtimeManager.listPtys(directory)
  })
  ipcMain.handle("pty:remove", async (_event, payload) => {
    const directory = resolveProjectContext({ projectId: payload?.projectId, directory: payload?.directory })
    const ptyId = requiredString(payload, "ptyId", "PTY ID")
    await runtimeManager.removePty(ptyId, directory)
  })
  ipcMain.handle("pty:resize", async (_event, payload) => {
    const directory = resolveProjectContext({ projectId: payload?.projectId, directory: payload?.directory })
    const ptyId = requiredString(payload, "ptyId", "PTY ID")
    const rows = Number(payload?.rows)
    const cols = Number(payload?.cols)
    if (!Number.isInteger(rows) || rows <= 0 || !Number.isInteger(cols) || cols <= 0) {
      throw new Error("A valid terminal size is required.")
    }
    return runtimeManager.resizePty(ptyId, directory, { rows, cols })
  })
  // Output/state reaches the renderer through the existing runtime:stream channel — connectPty()
  // emits pty.connected/pty.data/pty.disconnected on it directly (see process-manager.js), so
  // there is no separate pty:stream channel and no returned value to relay here. Neither this
  // handler nor pty:write below ever pass PTY content through this.log()/this.timeline() (the
  // only two things that reach state.logs / the Diagnostics panel) — terminal input and output
  // never touch diagnostics, by construction, not by redaction.
  ipcMain.handle("pty:connect", (_event, payload) => {
    const directory = resolveProjectContext({ projectId: payload?.projectId, directory: payload?.directory })
    const ptyId = requiredString(payload, "ptyId", "PTY ID")
    runtimeManager.connectPty(ptyId, directory)
  })
  ipcMain.handle("pty:write", (_event, payload) => {
    const ptyId = requiredString(payload, "ptyId", "PTY ID")
    const data = typeof payload?.data === "string" ? payload.data : ""
    runtimeManager.writePty(ptyId, data)
  })
  ipcMain.handle("pty:disconnect", (_event, payload) => {
    const ptyId = requiredString(payload, "ptyId", "PTY ID")
    runtimeManager.disconnectPty(ptyId)
  })

  ipcMain.handle("clipboard:writeText", (_event, text) => clipboard.writeText(String(text ?? "")))
  ipcMain.handle("artifacts:open", async (_event, { artifactPath, projectId, directory } = {}) => {
    const projectPath = resolveProjectContext({ projectId, directory })
    const safePath = assertTranslationArtifact(projectPath, artifactPath)
    const error = await shell.openPath(safePath)
    if (error) throw new Error(error)
    return safePath
  })
  ipcMain.handle("artifacts:preview", async (_event, { artifactPath, projectId, directory } = {}) => {
    const projectPath = resolveProjectContext({ projectId, directory })
    return previewTranslationArtifact(projectPath, artifactPath)
  })

  // Resolves the project by id rather than trusting runtimeManager's currently-running server —
  // selectSession() deliberately views another project's chat without switching the live runtime
  // (avoids an ECONNRESET/restart storm), so the running server's cwd and the project the user is
  // actually looking at can differ. files:read/files:list must always serve the latter.
  ipcMain.handle("files:read", async (_event, { filePath, projectId, directory } = {}) => {
    const projectPath = resolveProjectContext({ projectId, directory })
    const safePath = assertProjectFile(projectPath, filePath)
    const MAX_FILE_BYTES = 2 * 1024 * 1024
    const { content, truncated } = readProjectFileContent(safePath, MAX_FILE_BYTES)
    const projectRoot = fs.realpathSync(path.resolve(projectPath))
    return {
      path: safePath,
      relativePath: path.relative(projectRoot, safePath),
      name: path.basename(safePath),
      content,
      truncated
    }
  })
  ipcMain.handle("files:list", async (_event, { directoryPath, projectId, directory, options } = {}) => {
    const projectPath = resolveProjectContext({ projectId, directory })
    return listProjectDirectory(projectPath, directoryPath, options)
  })

  ipcMain.handle("version:check", () =>
    checkDesktopVersion({
      currentVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch
    })
  )
  ipcMain.handle("version:downloadAndInstall", async (_event, downloadUrl) => {
    const destDir = app.getPath("temp")
    send("version:install-status", "downloading")
    const installerPath = await downloadInstaller({
      downloadUrl: String(downloadUrl ?? ""),
      destDir,
      onProgress: (percent) => send("version:download-progress", percent)
    })

    if (process.platform === "win32") {
      if (!app.isPackaged || !windowsPublisherName) {
        send("version:install-status", "manual")
        shell.showItemInFolder(installerPath)
        return installerPath
      }
      try {
        verifyWindowsInstaller({ installerPath, publisherName: windowsPublisherName })
        send("version:install-status", "installing")
        launchWindowsInstaller({ installerPath })
        setTimeout(() => app.quit(), 100)
        return installerPath
      } catch {
        // Never execute an unverifiable installer. Keep it for inspection and
        // reveal its location so the user can decide what to do manually.
        send("version:install-status", "manual")
        shell.showItemInFolder(installerPath)
        return installerPath
      }
    }

    const appBundlePath = app.isPackaged ? resolveAppBundlePath(app.getPath("exe")) : null
    // In dev (electron .) there is no installed bundle to replace. Fall back to
    // opening the downloaded installer so the user can install it manually.
    if (!appBundlePath || process.platform !== "darwin") {
      const error = await shell.openPath(installerPath)
      if (error) throw new Error(error)
      return installerPath
    }

    try {
      send("version:install-status", "installing")
      installDmg({ dmgPath: installerPath, appBundlePath })
    } catch (installError) {
      // Permission denied on /Applications, mount failure, etc. Fall back to the
      // manual drag-to-Applications flow so the user is never stuck.
      const error = await shell.openPath(installerPath)
      if (error) throw new Error(installError.message)
      return installerPath
    }

    send("version:install-status", "relaunching")
    app.relaunch()
    app.quit()
    return appBundlePath
  })

  ipcMain.handle("runtime:get", () => runtimeManager.snapshot())

  const openProject = profileIpc(async (profile, _event, { project }) => {
    // Resolve the last-selected worktree (if any) before spawning, so reopening a project
    // (including after an app restart) resumes where the user left it, not the main worktree.
    const runtimeTarget = { ...project, path: effectiveProjectPath(project) }
    // Validate folder access in the main process before spawning the runtime child.
    ensureProjectAccess(runtimeTarget.path)
    ensureBrowserMcp(profile)
    // Point cross-chat memory's `instructions` entry at this project before the runtime reads config.
    setActiveProjectMemory(profile, project.id)
    projectRegistry.touch(project.id)
    return runtimeManager.openProject({ project: runtimeTarget })
  })
  ipcMain.handle("runtime:openProject", openProject)
  ipcMain.handle("runtime:start", openProject)
  ipcMain.handle("runtime:stop", () => runtimeManager.stop())
  // The active project's session load is user-visible, so propagate failures to the renderer where
  // it can show Retry instead of silently presenting a false "No chats" state. Directory-scoped
  // background reads and command discovery remain best-effort below.
  ipcMain.handle("runtime:listSessions", () => runtimeManager.listSessions())
  ipcMain.handle("runtime:listSessionsForDirectory", async (_event, { directory } = {}) => {
    try {
      return await runtimeManager.listSessionsForDirectory(directory)
    } catch {
      return []
    }
  })
  ipcMain.handle("runtime:listSubagentRuns", (_event, payload) =>
    runtimeManager.listSubagentRuns(validatedSessionPayload(payload)))
  ipcMain.handle("runtime:listCommands", async () => {
    try {
      return await runtimeManager.listCommands()
    } catch {
      return []
    }
  })
  ipcMain.handle("runtime:createSession", (_event, payload) => runtimeManager.createSession(payload))
  ipcMain.handle("runtime:renameSession", (_event, payload) => runtimeManager.renameSession(payload))
  ipcMain.handle("runtime:selectSessionAgent", (_event, payload) => runtimeManager.selectSessionAgent({
    ...validatedSessionPayload(payload),
    agent: requiredString(payload, "agent", "Agent")
  }))
  ipcMain.handle("runtime:selectSessionModel", (_event, payload) => runtimeManager.selectSessionModel({
    ...validatedSessionPayload(payload),
    model: validatedModelRef(payload?.model)
  }))
  ipcMain.handle("runtime:compactSession", (_event, payload) =>
    runtimeManager.compactSession(validatedSessionPayload(payload)))
  ipcMain.handle("runtime:sessionContext", (_event, payload) =>
    runtimeManager.sessionContext(validatedSessionPayload(payload)))
  ipcMain.handle("runtime:stageSessionRevert", (_event, payload) => {
    if (payload?.files !== true) throw new Error("Session revert must include project files.")
    return runtimeManager.stageSessionRevert({
      ...validatedSessionPayload(payload),
      messageId: requiredString(payload, "messageId", "Message ID"),
      files: true
    })
  })
  ipcMain.handle("runtime:clearSessionRevert", (_event, payload) =>
    runtimeManager.clearSessionRevert(validatedSessionPayload(payload)))
  ipcMain.handle("runtime:commitSessionRevert", (_event, payload) =>
    runtimeManager.commitSessionRevert(validatedSessionPayload(payload)))
  ipcMain.handle("runtime:listPendingInputs", (_event, payload) =>
    runtimeManager.listPendingInputs(validatedSessionPayload(payload)))
  ipcMain.handle("runtime:sendPrompt", async (_event, payload) => {
    const attachmentIds = Array.isArray(payload?.attachmentIds) ? payload.attachmentIds : []
    const attachments = attachmentRegistry.resolve(attachmentIds)
    const externalAttachments = validatedExternalAttachments(payload?.externalAttachments)
    const result = await runtimeManager.sendPrompt({
      ...validateSessionInputPayload(payload),
      prompt: requiredString(payload, "prompt", "Prompt"),
      attachments: [...attachments, ...externalAttachments],
      ...(Array.isArray(payload?.agents) ? { agents: payload.agents } : {}),
      ...(payload?.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
        ? { metadata: payload.metadata }
        : {})
    })
    attachmentRegistry.discard(attachmentIds)
    return result
  })
  ipcMain.handle("runtime:listMessages", (_event, payload) => runtimeManager.listMessages(payload))
  ipcMain.handle("runtime:exportSession", async (_event, payload = {}) => {
    const sessionId = String(payload.sessionId || "")
    if (!sessionId) throw new Error("Select a session before exporting it.")
    const directory = resolveProjectContext(payload)
    const data = await runtimeManager.getSessionExport({ sessionId, directory })
    return saveSessionExport({
      data,
      showSaveDialog: (options) => dialog.showSaveDialog(mainWindow, options),
      writeFile: fs.promises.writeFile
    })
  })
  ipcMain.handle("runtime:sendCommand", (_event, payload) => runtimeManager.sendCommand({
    ...validateSessionInputPayload(payload),
    command: requiredString(payload, "command", "Command"),
    arguments: typeof payload?.arguments === "string" ? payload.arguments : ""
  }))
  ipcMain.handle("runtime:activateSkill", (_event, payload) => {
    const resume = payload?.resume === undefined ? true : payload.resume
    if (typeof resume !== "boolean") throw new Error("Skill resume must be a boolean.")
    return runtimeManager.activateSkill({
      ...validatedSessionPayload(payload),
      skill: requiredString(payload, "skill", "Skill"),
      resume
    })
  })
  ipcMain.handle("runtime:abortSession", (_event, payload) => runtimeManager.abortSession(payload))
  ipcMain.handle("runtime:deleteSession", (_event, payload) => runtimeManager.deleteSession(payload))
  ipcMain.handle("runtime:forkSession", (_event, payload) => runtimeManager.forkSession(payload))
  ipcMain.handle("runtime:answerQuestion", (_event, payload) => runtimeManager.answerQuestion(payload))
  ipcMain.handle("runtime:rejectQuestion", (_event, payload) => runtimeManager.rejectQuestion(payload))
  ipcMain.handle("runtime:replyPermission", (_event, payload) => runtimeManager.replyPermission(payload))
  ipcMain.handle("runtime:listPendingPermissions", () => runtimeManager.listPendingPermissions())
  ipcMain.handle("runtime:listPendingQuestions", () => runtimeManager.listPendingQuestions())
  ipcMain.handle("runtime:listPendingForms", () => runtimeManager.listPendingForms())
  ipcMain.handle("runtime:replyForm", (_event, payload) => runtimeManager.replyForm({
    ...validatedSessionPayload(payload),
    formID: requiredString(payload, "formID", "Form ID"),
    answer: validatedFormAnswer(payload?.answer)
  }))
  ipcMain.handle("runtime:cancelForm", (_event, payload) => runtimeManager.cancelForm({
    ...validatedSessionPayload(payload),
    formID: requiredString(payload, "formID", "Form ID")
  }))
}

app.whenReady().then(() => {
  projectRegistry = new ProjectRegistry(app.getPath("userData"))
  pinRegistry = new PinRegistry(app.getPath("userData"))
  // opencodeProfile stays null until profileLifecycle.initialize() resolves it below — its
  // onReady/onBlocked callbacks are the single writer, so a failed sync leaves the app in the
  // blocked state instead of throwing past bootstrap.
  runtimeManager = new RuntimeProcessManager({
    userDataPath: app.getPath("userData"),
    profile: opencodeProfile,
    emit: send
  })
  const userDataPath = app.getPath("userData")
  const profileDir = defaultProfileDir(userDataPath)
  profileLifecycle = new ProfileLifecycle({
    profileDir,
    configPath: defaultConfigPath(profileDir),
    ensureProfile: () => ensureOpenworkingProfile({ userDataPath }),
    onReady: (profile) => {
      opencodeProfile = profile
      runtimeManager.profile = profile
    },
    onBlocked: (error) => {
      opencodeProfile = null
      runtimeManager.profile = null
      if (error) console.error("Failed to initialize the OpenWorking profile:", error)
    },
    emit: send
  })
  bootstrapMainProcess({
    registerIpc,
    applyMenu: () => {
      const appMenu = buildAppMenu()
      if (appMenu) Menu.setApplicationMenu(appMenu)
    },
    createWindow,
    ensureProfile: () => profileLifecycle.initialize(),
    onProfileError: (error) => {
      console.error("Failed to initialize the OpenWorking profile:", error)
      profileLifecycle.block(error, { publish: false })
    }
  })
  // Registered here, not at module scope: 'activate' must never reach createWindow() before
  // whenReady() resolves, or BrowserWindow construction throws. Clicking the dock icon while
  // the app is still launching can fire 'activate' early - waiting to attach the listener until
  // this callback runs (which only happens after whenReady()) closes that race.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error) => {
  console.error("Startup failed:", error)
})

app.on("window-all-closed", async () => {
  attachmentRegistry.clear()
  if (runtimeManager) await runtimeManager.stop()
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", async () => {
  if (runtimeManager) await runtimeManager.stop()
})
