const { app, BrowserWindow, clipboard, ipcMain, dialog, Menu, shell } = require("electron")
const fs = require("node:fs")
const path = require("node:path")
const { assertTranslationArtifact, assertProjectFile, listProjectDirectory, previewTranslationArtifact, readProjectFileContent } = require("./artifact-path")
const { AttachmentRegistry } = require("./attachment-registry")
const { ensureOpenworkingProfile, installCustomSkillArchive, listCustomSkills, readSkillMarkdown, uninstallCustomSkill, addMcpServer, updateMcpServer, listMcpServers, removeMcpServer, setMcpServerEnabled, readProfileConfig, setActiveProjectMemory, writeEditableProfileConfig } = require("./opencode-profile")
const { SCOPES, ensureProjectMemory, readMemory, writeMemory } = require("./memory-store")
const { ProjectRegistry } = require("./project-registry")
const { PinRegistry } = require("./pin-registry")
const { RuntimeProcessManager } = require("./runtime/process-manager")
const { BACKLOG_PACKAGE, backlogCommand, ensureBacklogServer, isLegacyBacklogNpxCommand } = require("./mcp-install")
const { checkDesktopVersion, downloadInstaller, installDmg, versionCheckConfigured } = require("./version-check")

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

let mainWindow = null
let projectRegistry = null
let pinRegistry = null
let runtimeManager = null
let opencodeProfile = null
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
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
// Other roles keep the standard behavior. Non-macOS platforms keep Electron's
// default menu (the only packaged target is macOS today).
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
  ipcMain.handle("projects:list", () => projectRegistry.list())
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

  ipcMain.handle("pins:list", () => pinRegistry.list())
  ipcMain.handle("pins:set", (_event, { sessionId, pinned, meta }) => pinRegistry.set(sessionId, pinned, meta))

  ipcMain.handle("config:get", () => ({
    ...readProfileConfig(opencodeProfile),
    customSkills: listCustomSkills(opencodeProfile),
    mcp: listMcpServers(opencodeProfile)
  }))
  ipcMain.handle("config:save", async (_event, config) => {
    const result = writeEditableProfileConfig(opencodeProfile, config)
    await runtimeManager.reload()
    return { ...result, customSkills: listCustomSkills(opencodeProfile) }
  })
  ipcMain.handle("skills:upload", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Upload an OpenCode skill",
      filters: [{ name: "OpenCode skills", extensions: ["zip", "skill"] }],
      properties: ["openFile"]
    })
    if (result.canceled || !result.filePaths.length) return null
    const installed = installCustomSkillArchive(opencodeProfile, result.filePaths[0])
    await runtimeManager.reload()
    return installed
  })
  ipcMain.handle("skills:installPath", async (_event, filePath) => {
    const installed = installCustomSkillArchive(opencodeProfile, String(filePath || ""))
    await runtimeManager.reload()
    return installed
  })
  ipcMain.handle("skills:read", (_event, skillName) => readSkillMarkdown(opencodeProfile, skillName))
  ipcMain.handle("skills:uninstall", async (_event, skillName) => {
    const result = uninstallCustomSkill(opencodeProfile, skillName)
    await runtimeManager.reload()
    return { ...result, customSkills: listCustomSkills(opencodeProfile) }
  })

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
    await ensureBacklogServer(opencodeProfile.profileDir)
    return { ...server, command: backlogCommand(opencodeProfile.profileDir) }
  }

  // Ensure an already-stored Backlog connector is installed and using the node-based command.
  // Migrates a legacy `npx backlog-mcp-server` command in place (preserving env). No-op for others.
  async function ensureBacklogConnectorReady(name) {
    const stored = readProfileConfig(opencodeProfile).config.mcp?.[name]
    if (!stored || (name !== "backlog" && !commandUsesBacklog(stored.command))) return
    await ensureBacklogServer(opencodeProfile.profileDir)
    if (isLegacyBacklogNpxCommand(stored.command)) {
      updateMcpServer(opencodeProfile, name, {
        type: "local",
        command: backlogCommand(opencodeProfile.profileDir),
        environment: stored.environment || {}
      })
    }
  }

  ipcMain.handle("mcp:list", () => listMcpServers(opencodeProfile))
  ipcMain.handle("mcp:add", async (_event, server) => {
    try {
      const prepared = await prepareBacklogCommand(server)
      const added = addMcpServer(opencodeProfile, prepared)
      await runtimeManager.reload()
      return { server: added, servers: listMcpServers(opencodeProfile) }
    } catch (error) {
      return { error: error.message }
    }
  })
  ipcMain.handle("mcp:update", async (_event, { name, server }) => {
    const updated = updateMcpServer(opencodeProfile, name, server)
    await runtimeManager.reload()
    return { server: updated, servers: listMcpServers(opencodeProfile) }
  })
  ipcMain.handle("mcp:setEnabled", async (_event, { name, enabled }) => {
    try {
      // Enabling a Backlog connector (possibly added before the node-based launcher, or never
      // installed) ensures the package and migrates a legacy `npx` command to `node <entry>`.
      if (enabled) await ensureBacklogConnectorReady(name)
      setMcpServerEnabled(opencodeProfile, name, enabled)
      await runtimeManager.reload()
      return { servers: listMcpServers(opencodeProfile) }
    } catch (error) {
      return { error: error.message }
    }
  })
  ipcMain.handle("mcp:remove", async (_event, name) => {
    removeMcpServer(opencodeProfile, name)
    await runtimeManager.reload()
    return { servers: listMcpServers(opencodeProfile) }
  })
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
  // Drive the OAuth flow ourselves: startMcpAuth returns the authorization URL (opencode also
  // stands up its loopback callback server), we open it in the browser, then authenticateMcp waits
  // for the callback to complete. Opening the URL from the main process is more reliable than
  // relying on opencode's internal browser-open inside a headless `serve`.
  async function runMcpAuth(serverName) {
    const { authorizationUrl } = await runtimeManager.startMcpAuth(serverName)
    if (authorizationUrl) await shell.openExternal(authorizationUrl)
    await runtimeManager.authenticateMcp(serverName)
    return {
      servers: listMcpServers(opencodeProfile),
      status: await runtimeManager.listMcpStatus()
    }
  }
  ipcMain.handle("mcp:authenticate", async (_event, name) => {
    try {
      return await runMcpAuth(String(name || ""))
    } catch (error) {
      return { error: error.message }
    }
  })
  // Retry a (typically local) MCP server that failed to connect — e.g. a stdio server whose `npx`
  // could not be found on a stale PATH. Reload first so opencode picks up a freshly resolved PATH,
  // then re-connect and report the new status (with opencode's real failure reason if it still fails).
  ipcMain.handle("mcp:connect", async (_event, name) => {
    const serverName = String(name || "")
    try {
      // For Backlog, make sure the package is installed and the command is the node-based launcher
      // before retrying — this is what recovers a connector that failed under the old npx command.
      await ensureBacklogConnectorReady(serverName)
      await runtimeManager.reload()
      await runtimeManager.connectMcp(serverName)
      return {
        servers: listMcpServers(opencodeProfile),
        status: await runtimeManager.listMcpStatus()
      }
    } catch (error) {
      return { error: error.message }
    }
  })
  ipcMain.handle("mcp:clearAuth", async (_event, name) => {
    const serverName = String(name || "")
    try {
      const result = runtimeManager.clearMcpAuth(serverName)
      // Reload so the running opencode server picks up the cleared auth store, then re-auth fresh.
      await runtimeManager.reload()
      return { cleared: result.cleared, ...(await runMcpAuth(serverName)) }
    } catch (error) {
      return { error: error.message }
    }
  })

  // Cross-chat memory: read/write the global and active-project memory files. The active project
  // comes from the runtime snapshot (its id keys the per-project file). Global memory always exists.
  function activeProjectId() {
    return runtimeManager.snapshot().project?.id || null
  }
  ipcMain.handle("memory:get", () => {
    const profileDir = opencodeProfile.profileDir
    const projectId = activeProjectId()
    if (projectId) ensureProjectMemory(profileDir, projectId)
    return {
      global: readMemory(profileDir, "global"),
      project: projectId ? readMemory(profileDir, "project", projectId) : "",
      projectId,
      hasProject: !!projectId
    }
  })
  ipcMain.handle("memory:save", async (_event, { scope, content }) => {
    if (!SCOPES.includes(scope)) throw new Error(`Invalid memory scope: ${scope}`)
    const profileDir = opencodeProfile.profileDir
    const projectId = activeProjectId()
    if (scope === "project" && !projectId) throw new Error("Open a project before editing its memory.")
    writeMemory(profileDir, scope, projectId, content)
    // Re-read so OpenCode picks up the edited files on the next session.
    if (runtimeManager.snapshot().status === "running") await runtimeManager.reload()
    return {
      global: readMemory(profileDir, "global"),
      project: projectId ? readMemory(profileDir, "project", projectId) : "",
      projectId,
      hasProject: !!projectId
    }
  })

  ipcMain.handle("attachments:pick", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Attach files",
      properties: ["openFile", "multiSelections"]
    })
    if (result.canceled || !result.filePaths.length) return []
    return attachmentRegistry.add(result.filePaths)
  })
  ipcMain.handle("attachments:addProjectFile", async (_event, filePath) => {
    const projectPath = runtimeManager.snapshot().project?.path
    if (!projectPath) throw new Error("Open a project before attaching a file.")
    const safePath = assertProjectFile(projectPath, filePath)
    return attachmentRegistry.addResolved([safePath])[0] || null
  })
  ipcMain.handle("attachments:discard", (_event, ids) => {
    attachmentRegistry.discard(Array.isArray(ids) ? ids : [])
  })

  ipcMain.handle("clipboard:writeText", (_event, text) => clipboard.writeText(String(text ?? "")))
  ipcMain.handle("artifacts:open", async (_event, artifactPath) => {
    const projectPath = runtimeManager.snapshot().project?.path
    if (!projectPath) throw new Error("Open a project before opening an artifact.")
    const safePath = assertTranslationArtifact(projectPath, artifactPath)
    const error = await shell.openPath(safePath)
    if (error) throw new Error(error)
    return safePath
  })
  ipcMain.handle("artifacts:preview", async (_event, artifactPath) => {
    const projectPath = runtimeManager.snapshot().project?.path
    if (!projectPath) throw new Error("Open a project before previewing an artifact.")
    return previewTranslationArtifact(projectPath, artifactPath)
  })

  ipcMain.handle("files:read", async (_event, filePath) => {
    const projectPath = runtimeManager.snapshot().project?.path
    if (!projectPath) throw new Error("Open a project before opening a file.")
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
  ipcMain.handle("files:list", async (_event, payload) => {
    const projectPath = runtimeManager.snapshot().project?.path
    if (!projectPath) throw new Error("Open a project before listing files.")
    const directoryPath = typeof payload === "string" ? payload : payload?.directoryPath
    const options = payload && typeof payload === "object" ? payload.options : undefined
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
    const dmgPath = await downloadInstaller({
      downloadUrl: String(downloadUrl ?? ""),
      destDir,
      onProgress: (percent) => send("version:download-progress", percent)
    })

    const appBundlePath = app.isPackaged ? resolveAppBundlePath(app.getPath("exe")) : null
    // In dev (electron .) there is no .app to replace, and on non-macOS we have
    // no installer. Fall back to opening the image so the user can install it
    // manually rather than silently doing nothing.
    if (!appBundlePath || process.platform !== "darwin") {
      const error = await shell.openPath(dmgPath)
      if (error) throw new Error(error)
      return dmgPath
    }

    try {
      send("version:install-status", "installing")
      installDmg({ dmgPath, appBundlePath })
    } catch (installError) {
      // Permission denied on /Applications, mount failure, etc. Fall back to the
      // manual drag-to-Applications flow so the user is never stuck.
      const error = await shell.openPath(dmgPath)
      if (error) throw new Error(installError.message)
      return dmgPath
    }

    send("version:install-status", "relaunching")
    app.relaunch()
    app.quit()
    return appBundlePath
  })

  ipcMain.handle("runtime:get", () => runtimeManager.snapshot())
  ipcMain.handle("runtime:openProject", async (_event, { project }) => {
    opencodeProfile = ensureOpenworkingProfile({ userDataPath: app.getPath("userData") })
    runtimeManager.profile = opencodeProfile
    // Point cross-chat memory's `instructions` entry at this project before the runtime reads config.
    setActiveProjectMemory(opencodeProfile, project.id)
    projectRegistry.touch(project.id)
    return runtimeManager.openProject({ project })
  })
  ipcMain.handle("runtime:start", async (_event, { project }) => {
    opencodeProfile = ensureOpenworkingProfile({ userDataPath: app.getPath("userData") })
    runtimeManager.profile = opencodeProfile
    // Point cross-chat memory's `instructions` entry at this project before the runtime reads config.
    setActiveProjectMemory(opencodeProfile, project.id)
    projectRegistry.touch(project.id)
    return runtimeManager.openProject({ project })
  })
  ipcMain.handle("runtime:stop", () => runtimeManager.stop())
  // Best-effort reads (listSessions/listSessionsForDirectory/listCommands) fill the sidebar and the
  // slash-command menu and are always treated as optional by the renderer (it does .catch(() => [])).
  // A transient failure — the server stopping/restarting mid-request → ECONNRESET / socket hang up —
  // must resolve to [] rather than reject, or Electron logs a noisy "Error occurred in handler" for
  // every dropped socket. waitUntilReady() handles the orderly case; this catch covers the racy one.
  ipcMain.handle("runtime:listSessions", async () => {
    try {
      return await runtimeManager.listSessions()
    } catch {
      return []
    }
  })
  ipcMain.handle("runtime:listSessionsForDirectory", async (_event, { directory } = {}) => {
    try {
      return await runtimeManager.listSessionsForDirectory(directory)
    } catch {
      return []
    }
  })
  ipcMain.handle("runtime:listCommands", async () => {
    try {
      return await runtimeManager.listCommands()
    } catch {
      return []
    }
  })
  ipcMain.handle("runtime:createSession", (_event, payload) => runtimeManager.createSession(payload))
  ipcMain.handle("runtime:renameSession", (_event, payload) => runtimeManager.renameSession(payload))
  ipcMain.handle("runtime:sendPrompt", async (_event, payload) => {
    const attachmentIds = Array.isArray(payload?.attachmentIds) ? payload.attachmentIds : []
    const attachments = attachmentRegistry.resolve(attachmentIds)
    const result = await runtimeManager.sendPrompt({ ...payload, attachments })
    attachmentRegistry.discard(attachmentIds)
    return result
  })
  ipcMain.handle("runtime:listMessages", (_event, payload) => runtimeManager.listMessages(payload))
  ipcMain.handle("runtime:sendCommand", (_event, payload) => runtimeManager.sendCommand(payload))
  ipcMain.handle("runtime:abortSession", (_event, payload) => runtimeManager.abortSession(payload))
  ipcMain.handle("runtime:deleteSession", (_event, payload) => runtimeManager.deleteSession(payload))
  ipcMain.handle("runtime:answerQuestion", (_event, payload) => runtimeManager.answerQuestion(payload))
  ipcMain.handle("runtime:rejectQuestion", (_event, payload) => runtimeManager.rejectQuestion(payload))
  ipcMain.handle("runtime:replyPermission", (_event, payload) => runtimeManager.replyPermission(payload))
}

app.whenReady().then(() => {
  projectRegistry = new ProjectRegistry(app.getPath("userData"))
  pinRegistry = new PinRegistry(app.getPath("userData"))
  opencodeProfile = ensureOpenworkingProfile({ userDataPath: app.getPath("userData") })
  runtimeManager = new RuntimeProcessManager({
    userDataPath: app.getPath("userData"),
    profile: opencodeProfile,
    emit: send
  })
  registerIpc()
  const appMenu = buildAppMenu()
  if (appMenu) Menu.setApplicationMenu(appMenu)
  createWindow()
})

app.on("window-all-closed", async () => {
  attachmentRegistry.clear()
  if (runtimeManager) await runtimeManager.stop()
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", async () => {
  if (runtimeManager) await runtimeManager.stop()
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
