const { app, BrowserWindow, clipboard, ipcMain, dialog, Menu, shell } = require("electron")
const fs = require("node:fs")
const path = require("node:path")
const { assertTranslationArtifact, assertProjectFile, listProjectDirectory, readProjectFileContent } = require("./artifact-path")
const { AttachmentRegistry } = require("./attachment-registry")
const { ensureOpenworkingProfile, installCustomSkillArchive, listCustomSkills, readSkillMarkdown, uninstallCustomSkill, addMcpServer, listMcpServers, removeMcpServer, setMcpServerEnabled, readProfileConfig, writeEditableProfileConfig } = require("./opencode-profile")
const { ProjectRegistry } = require("./project-registry")
const { RuntimeProcessManager } = require("./runtime/process-manager")
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

  ipcMain.handle("mcp:list", () => listMcpServers(opencodeProfile))
  ipcMain.handle("mcp:add", async (_event, server) => {
    const added = addMcpServer(opencodeProfile, server)
    await runtimeManager.reload()
    return { server: added, servers: listMcpServers(opencodeProfile) }
  })
  ipcMain.handle("mcp:setEnabled", async (_event, { name, enabled }) => {
    setMcpServerEnabled(opencodeProfile, name, enabled)
    await runtimeManager.reload()
    return { servers: listMcpServers(opencodeProfile) }
  })
  ipcMain.handle("mcp:remove", async (_event, name) => {
    removeMcpServer(opencodeProfile, name)
    await runtimeManager.reload()
    return { servers: listMcpServers(opencodeProfile) }
  })

  ipcMain.handle("attachments:pick", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Attach files",
      properties: ["openFile", "multiSelections"]
    })
    if (result.canceled || !result.filePaths.length) return []
    return attachmentRegistry.add(result.filePaths)
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
  ipcMain.handle("files:list", async (_event, directoryPath) => {
    const projectPath = runtimeManager.snapshot().project?.path
    if (!projectPath) throw new Error("Open a project before listing files.")
    return listProjectDirectory(projectPath, directoryPath)
  })

  ipcMain.handle("version:check", () =>
    checkDesktopVersion({ currentVersion: app.getVersion(), platform: process.platform })
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
    projectRegistry.touch(project.id)
    return runtimeManager.openProject({ project })
  })
  ipcMain.handle("runtime:start", async (_event, { project }) => {
    opencodeProfile = ensureOpenworkingProfile({ userDataPath: app.getPath("userData") })
    runtimeManager.profile = opencodeProfile
    projectRegistry.touch(project.id)
    return runtimeManager.openProject({ project })
  })
  ipcMain.handle("runtime:stop", () => runtimeManager.stop())
  ipcMain.handle("runtime:listSessions", () => runtimeManager.listSessions())
  ipcMain.handle("runtime:listCommands", () => runtimeManager.listCommands())
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
