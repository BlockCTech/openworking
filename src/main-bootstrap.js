// Boot sequence for the main process, factored out (with no Electron dependency) so
// the ordering it enforces is unit-testable.
//
// The invariant this guarantees is the whole reason for the extraction: IPC handlers are wired
// before the throw-prone profile sync, and the window is opened after profile state has settled.
// The renderer can therefore query a stable ready/recovered/blocked state without ever racing a
// missing auth handler or a one-shot startup event.
//
// Deps are injected so main.js passes the live Electron implementations and tests can
// drive it with spies.
function bootstrapMainProcess({ registerIpc, applyMenu, createWindow, ensureProfile, onProfileError }) {
  registerIpc()
  applyMenu()
  let result = null
  try {
    result = ensureProfile()
  } catch (error) {
    onProfileError(error)
  }
  createWindow()
  return result
}

module.exports = { bootstrapMainProcess }
