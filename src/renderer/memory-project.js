// Memory-project selection helpers, extracted from renderer.js. Pure reads/writes of shared
// `state` (projects, activeProjectId, selectedMemoryProjectId, memory, memoryDraft) — no DOM, no
// calls back into render/loadMemory/showToast. Injected via init(). Exposed on
// window.OpenWorkingMemoryProject.
(function exposeMemoryProject(root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  if (root) root.OpenWorkingMemoryProject = api
})(typeof window === "object" ? window : globalThis, function createMemoryProject() {
  // Injected via init(): { state }.
  let ctx = {}

  function selectedProject() {
    const { state } = ctx
    return state.projects.find((project) => project.id === state.activeProjectId) || null
  }

  // All directories a project's sessions may legitimately live under: its main path, plus the
  // active worktree if one is selected and different. Sessions are matched against this whole set
  // (not just the runtime's current directory) so switching worktrees never hides a project's
  // history from sessions created in a different worktree.
  function projectAllPaths(project) {
    return [...new Set([project.path, project.activeWorktreePath].filter(Boolean))]
  }

  function memoryProjectById(projectId) {
    const { state } = ctx
    return state.projects.find((project) => project.id === projectId) || null
  }

  function normalizeMemoryProjectId(projectId) {
    return memoryProjectById(projectId)?.id || null
  }

  function effectiveMemoryProjectId() {
    const { state } = ctx
    return normalizeMemoryProjectId(state.selectedMemoryProjectId)
      || normalizeMemoryProjectId(state.memory?.projectId)
      || normalizeMemoryProjectId(state.activeProjectId)
      || state.projects[0]?.id
      || null
  }

  function selectedMemoryProject() {
    return memoryProjectById(effectiveMemoryProjectId())
  }

  // True when the editable draft for a scope diverges from the last-loaded on-disk memory, i.e. the
  // user has unsaved edits in that scope's textarea.
  function isMemoryScopeDirty(scope) {
    const { state } = ctx
    if (!state.memoryDraft || !state.memory) return false
    return (state.memoryDraft[scope] ?? "") !== (state.memory[scope] ?? "")
  }

  function resetMemorySelectionToActiveProject() {
    const { state } = ctx
    state.selectedMemoryProjectId = normalizeMemoryProjectId(state.activeProjectId)
  }

  return {
    init(deps) { ctx = deps || {} },
    selectedProject,
    projectAllPaths,
    memoryProjectById,
    normalizeMemoryProjectId,
    effectiveMemoryProjectId,
    selectedMemoryProject,
    isMemoryScopeDirty,
    resetMemorySelectionToActiveProject
  }
})
