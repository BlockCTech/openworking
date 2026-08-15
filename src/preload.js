const { contextBridge, ipcRenderer, webUtils } = require("electron")

contextBridge.exposeInMainWorld("openworking", {
  profile: {
    getStatus: () => ipcRenderer.invoke("profile:getStatus"),
    retry: () => ipcRenderer.invoke("profile:retry"),
    openFolder: () => ipcRenderer.invoke("profile:openFolder")
  },
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    add: () => ipcRenderer.invoke("projects:add"),
    remove: (projectId) => ipcRenderer.invoke("projects:remove", projectId),
    rename: (projectId, name) => ipcRenderer.invoke("projects:rename", projectId, name),
    touch: (projectId) => ipcRenderer.invoke("projects:touch", projectId),
    setPinned: (projectId, pinned) => ipcRenderer.invoke("projects:setPinned", projectId, pinned)
  },
  pins: {
    list: () => ipcRenderer.invoke("pins:list"),
    set: (sessionId, pinned, meta) => ipcRenderer.invoke("pins:set", { sessionId, pinned, meta })
  },
  git: {
    info: (projectId) => ipcRenderer.invoke("git:info", { projectId }),
    checkoutBranch: (projectId, branchName) => ipcRenderer.invoke("git:checkoutBranch", { projectId, branchName }),
    switchWorktree: (projectId, worktreePath) => ipcRenderer.invoke("git:switchWorktree", { projectId, worktreePath })
  },
  vcs: {
    status: (projectId, context) => ipcRenderer.invoke("vcs:status", { projectId, ...context }),
    diff: (projectId, file, context) => ipcRenderer.invoke("vcs:diff", { projectId, file, ...context })
  },
  ide: {
    open: (projectId, ideOverride) => ipcRenderer.invoke("open-ide", { projectId, ideOverride })
  },
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    save: (config) => ipcRenderer.invoke("config:save", config)
  },
  skills: {
    upload: () => ipcRenderer.invoke("skills:upload"),
    installPath: (filePath) => ipcRenderer.invoke("skills:installPath", filePath),
    read: (name) => ipcRenderer.invoke("skills:read", name),
    uninstall: (name) => ipcRenderer.invoke("skills:uninstall", name),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  mcp: {
    list: () => ipcRenderer.invoke("mcp:list"),
    add: (server) => ipcRenderer.invoke("mcp:add", server),
    update: (name, server) => ipcRenderer.invoke("mcp:update", { name, server }),
    setEnabled: (name, enabled) => ipcRenderer.invoke("mcp:setEnabled", { name, enabled }),
    remove: (name) => ipcRenderer.invoke("mcp:remove", name),
    status: () => ipcRenderer.invoke("mcp:status"),
    connect: (name) => ipcRenderer.invoke("mcp:connect", name),
    authenticate: (name) => ipcRenderer.invoke("mcp:authenticate", name),
    clearAuth: (name) => ipcRenderer.invoke("mcp:clearAuth", name),
    openDocs: (url) => ipcRenderer.invoke("mcp:openDocs", url)
  },
  browser: {
    status: () => ipcRenderer.invoke("browser:status"),
    installHost: () => ipcRenderer.invoke("browser:installHost"),
    openExtensionPage: () => ipcRenderer.invoke("browser:openExtensionPage")
  },
  memory: {
    get: (projectId) => ipcRenderer.invoke("memory:get", { projectId }),
    save: (scope, content, projectId) => ipcRenderer.invoke("memory:save", { scope, content, projectId })
  },
  attachments: {
    pick: () => ipcRenderer.invoke("attachments:pick"),
    addProjectFile: (filePath, context) => ipcRenderer.invoke("attachments:addProjectFile", { filePath, ...context }),
    discard: (ids) => ipcRenderer.invoke("attachments:discard", ids)
  },
  references: {
    list: (context) => ipcRenderer.invoke("references:list", context),
    add: (reference, context) => ipcRenderer.invoke("references:add", { ...reference, ...context }),
    remove: (name, context) => ipcRenderer.invoke("references:remove", { name, ...context })
  },
  permissions: {
    listSaved: () => ipcRenderer.invoke("permissions:listSaved"),
    removeSaved: (id) => ipcRenderer.invoke("permissions:removeSaved", { id })
  },
  pty: {
    create: (options, context) => ipcRenderer.invoke("pty:create", { ...options, ...context }),
    list: (context) => ipcRenderer.invoke("pty:list", context),
    remove: (ptyId, context) => ipcRenderer.invoke("pty:remove", { ptyId, ...context }),
    resize: (ptyId, size, context) => ipcRenderer.invoke("pty:resize", { ptyId, ...size, ...context }),
    connect: (ptyId, context) => ipcRenderer.invoke("pty:connect", { ptyId, ...context }),
    write: (ptyId, data) => ipcRenderer.invoke("pty:write", { ptyId, data }),
    disconnect: (ptyId) => ipcRenderer.invoke("pty:disconnect", { ptyId })
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke("clipboard:writeText", text)
  },
  artifacts: {
    open: (artifactPath, context) => ipcRenderer.invoke("artifacts:open", { artifactPath, ...context }),
    preview: (artifactPath, context) => ipcRenderer.invoke("artifacts:preview", { artifactPath, ...context })
  },
  files: {
    read: (filePath, context) => ipcRenderer.invoke("files:read", { filePath, ...context }),
    list: (payload) => ipcRenderer.invoke("files:list", payload)
  },
  fs: {
    find: (query, options, context) => ipcRenderer.invoke("fs:find", { query, ...options, ...context }),
    list: (path, context) => ipcRenderer.invoke("fs:list", { path, ...context }),
    read: (path, context) => ipcRenderer.invoke("fs:read", { path, ...context })
  },
  version: {
    check: () => ipcRenderer.invoke("version:check"),
    downloadAndInstall: (url) => ipcRenderer.invoke("version:downloadAndInstall", url)
  },
  onVersionGate: (callback) => {
    const listener = (_event, gate) => callback(gate)
    ipcRenderer.on("version:gate", listener)
    return () => ipcRenderer.removeListener("version:gate", listener)
  },
  onVersionDownloadProgress: (callback) => {
    const listener = (_event, percent) => callback(percent)
    ipcRenderer.on("version:download-progress", listener)
    return () => ipcRenderer.removeListener("version:download-progress", listener)
  },
  onVersionInstallStatus: (callback) => {
    const listener = (_event, status) => callback(status)
    ipcRenderer.on("version:install-status", listener)
    return () => ipcRenderer.removeListener("version:install-status", listener)
  },
  runtime: {
    get: () => ipcRenderer.invoke("runtime:get"),
    openProject: (project) => ipcRenderer.invoke("runtime:openProject", { project }),
    start: (payload) => ipcRenderer.invoke("runtime:start", payload?.project ? payload : { project: payload }),
    stop: () => ipcRenderer.invoke("runtime:stop"),
    listSessions: () => ipcRenderer.invoke("runtime:listSessions"),
    listSessionsForDirectory: (directory) => ipcRenderer.invoke("runtime:listSessionsForDirectory", { directory }),
    listSubagentRuns: (payload) => ipcRenderer.invoke("runtime:listSubagentRuns", payload),
    listCommands: () => ipcRenderer.invoke("runtime:listCommands"),
    createSession: (payload) => ipcRenderer.invoke("runtime:createSession", payload),
    renameSession: (payload) => ipcRenderer.invoke("runtime:renameSession", payload),
    selectSessionAgent: (payload) => ipcRenderer.invoke("runtime:selectSessionAgent", payload),
    selectSessionModel: (payload) => ipcRenderer.invoke("runtime:selectSessionModel", payload),
    compactSession: (payload) => ipcRenderer.invoke("runtime:compactSession", payload),
    sessionContext: (payload) => ipcRenderer.invoke("runtime:sessionContext", payload),
    stageSessionRevert: (payload) => ipcRenderer.invoke("runtime:stageSessionRevert", payload),
    clearSessionRevert: (payload) => ipcRenderer.invoke("runtime:clearSessionRevert", payload),
    commitSessionRevert: (payload) => ipcRenderer.invoke("runtime:commitSessionRevert", payload),
    listPendingInputs: (payload) => ipcRenderer.invoke("runtime:listPendingInputs", payload),
    sendPrompt: (payload) => ipcRenderer.invoke("runtime:sendPrompt", payload),
    sendCommand: (payload) => ipcRenderer.invoke("runtime:sendCommand", payload),
    activateSkill: (payload) => ipcRenderer.invoke("runtime:activateSkill", payload),
    abortSession: (payload) => ipcRenderer.invoke("runtime:abortSession", payload),
    deleteSession: (payload) => ipcRenderer.invoke("runtime:deleteSession", payload),
    forkSession: (payload) => ipcRenderer.invoke("runtime:forkSession", payload),
    listMessages: (payload) => ipcRenderer.invoke("runtime:listMessages", payload),
    exportSession: (payload) => ipcRenderer.invoke("runtime:exportSession", payload),
    answerQuestion: (payload) => ipcRenderer.invoke("runtime:answerQuestion", payload),
    rejectQuestion: (payload) => ipcRenderer.invoke("runtime:rejectQuestion", payload),
    replyPermission: (payload) => ipcRenderer.invoke("runtime:replyPermission", payload),
    listPendingPermissions: () => ipcRenderer.invoke("runtime:listPendingPermissions"),
    listPendingQuestions: () => ipcRenderer.invoke("runtime:listPendingQuestions"),
    listPendingForms: () => ipcRenderer.invoke("runtime:listPendingForms"),
    replyForm: (payload) => ipcRenderer.invoke("runtime:replyForm", payload),
    cancelForm: (payload) => ipcRenderer.invoke("runtime:cancelForm", payload)
  },
  onRuntimeUpdate: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on("runtime:update", listener)
    return () => ipcRenderer.removeListener("runtime:update", listener)
  },
  onRuntimeStream: (callback) => {
    const listener = (_event, streamEvent) => callback(streamEvent)
    ipcRenderer.on("runtime:stream", listener)
    return () => ipcRenderer.removeListener("runtime:stream", listener)
  },
  onProfileUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on("profile:update", listener)
    return () => ipcRenderer.removeListener("profile:update", listener)
  }
})
