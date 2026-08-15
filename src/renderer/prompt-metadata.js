// Selected-prompt (command/skill) metadata persistence, extracted from renderer.js. Pure
// localStorage helpers keyed by session id — no `state`/DOM dependency, injected via init().
// Exposed on window.OpenWorkingPromptMetadata.
(function exposePromptMetadata(root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  if (root) root.OpenWorkingPromptMetadata = api
})(typeof window === "object" ? window : globalThis, function createPromptMetadata() {
  const SELECTED_PROMPT_METADATA_KEY = "openworking:selected-prompt-metadata"

  function loadSelectedPromptMetadata() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SELECTED_PROMPT_METADATA_KEY) || "{}")
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  function persistSelectedPromptMetadata(store) {
    try {
      localStorage.setItem(SELECTED_PROMPT_METADATA_KEY, JSON.stringify(store || {}))
    } catch {
      // Ignore — persistence is best-effort.
    }
  }

  function recordSelectedPromptMetadata(sessionId, userOrdinal, metadata) {
    if (!sessionId || !metadata || (!metadata.selectedCommand && !metadata.selectedSkill)) return
    const store = loadSelectedPromptMetadata()
    const entries = Array.isArray(store[sessionId]) ? store[sessionId] : []
    const nextEntry = {
      userOrdinal,
      ...(metadata.signatureText ? { signatureText: metadata.signatureText } : {}),
      ...(metadata.selectedCommand ? { selectedCommand: metadata.selectedCommand } : {}),
      ...(metadata.selectedSkill ? { selectedSkill: metadata.selectedSkill } : {})
    }
    const nextEntries = entries.filter((entry) => entry?.userOrdinal !== userOrdinal)
    nextEntries.push(nextEntry)
    nextEntries.sort((left, right) => (left?.userOrdinal || 0) - (right?.userOrdinal || 0))
    store[sessionId] = nextEntries.slice(-100)
    persistSelectedPromptMetadata(store)
  }

  function clearSelectedPromptMetadata(sessionId) {
    if (!sessionId) return
    const store = loadSelectedPromptMetadata()
    if (!Object.prototype.hasOwnProperty.call(store, sessionId)) return
    delete store[sessionId]
    persistSelectedPromptMetadata(store)
  }

  function applyPersistedPromptMetadataToThread(sessionId, thread) {
    if (!sessionId || !thread?.messages?.length) return false
    const entries = loadSelectedPromptMetadata()[sessionId]
    if (!Array.isArray(entries) || !entries.length) return false
    let changed = false
    let userOrdinal = 0
    for (const message of thread.messages) {
      if (message?.role !== "user") continue
      const entry = entries.find((item) => item?.userOrdinal === userOrdinal)
      userOrdinal += 1
      if (!entry) continue
      if (!message.selectedCommand && entry.selectedCommand) {
        message.selectedCommand = entry.selectedCommand
        changed = true
      }
      if (!message.selectedSkill && entry.selectedSkill) {
        message.selectedSkill = entry.selectedSkill
        changed = true
      }
      if (!message.signatureText && entry.signatureText) {
        message.signatureText = entry.signatureText
        changed = true
      }
    }
    return changed
  }

  return {
    init() {},
    loadSelectedPromptMetadata,
    persistSelectedPromptMetadata,
    recordSelectedPromptMetadata,
    clearSelectedPromptMetadata,
    applyPersistedPromptMetadataToThread
  }
})
