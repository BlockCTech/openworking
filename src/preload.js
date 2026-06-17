const { contextBridge, ipcRenderer, webUtils } = require("electron")

contextBridge.exposeInMainWorld("openworking", {
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    add: () => ipcRenderer.invoke("projects:add"),
    remove: (projectId) => ipcRenderer.invoke("projects:remove", projectId),
    rename: (projectId, name) => ipcRenderer.invoke("projects:rename", projectId, name),
    touch: (projectId) => ipcRenderer.invoke("projects:touch", projectId)
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
    setEnabled: (name, enabled) => ipcRenderer.invoke("mcp:setEnabled", { name, enabled }),
    remove: (name) => ipcRenderer.invoke("mcp:remove", name)
  },
  attachments: {
    pick: () => ipcRenderer.invoke("attachments:pick"),
    discard: (ids) => ipcRenderer.invoke("attachments:discard", ids)
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke("clipboard:writeText", text)
  },
  artifacts: {
    open: (artifactPath) => ipcRenderer.invoke("artifacts:open", artifactPath)
  },
  files: {
    read: (filePath) => ipcRenderer.invoke("files:read", filePath),
    list: (relativePath) => ipcRenderer.invoke("files:list", relativePath)
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
    listCommands: () => ipcRenderer.invoke("runtime:listCommands"),
    createSession: (payload) => ipcRenderer.invoke("runtime:createSession", payload),
    renameSession: (payload) => ipcRenderer.invoke("runtime:renameSession", payload),
    sendPrompt: (payload) => ipcRenderer.invoke("runtime:sendPrompt", payload),
    sendCommand: (payload) => ipcRenderer.invoke("runtime:sendCommand", payload),
    abortSession: (payload) => ipcRenderer.invoke("runtime:abortSession", payload),
    deleteSession: (payload) => ipcRenderer.invoke("runtime:deleteSession", payload),
    listMessages: (payload) => ipcRenderer.invoke("runtime:listMessages", payload),
    answerQuestion: (payload) => ipcRenderer.invoke("runtime:answerQuestion", payload),
    rejectQuestion: (payload) => ipcRenderer.invoke("runtime:rejectQuestion", payload),
    replyPermission: (payload) => ipcRenderer.invoke("runtime:replyPermission", payload)
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
  }
})
