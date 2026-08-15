// Actionable hints for failure messages, shared between the runtime launch path in the main
// process (RuntimeProcessManager#launchErrorMessage) and the chat tool-error row in the
// renderer, so a permission-shaped failure gets one concrete sentence instead of a bare EACCES.
// Loads either as a plain CommonJS require (main process, node:test) or as an ordered <script>
// exposing window.OpenWorkingErrorHints, mirroring src/renderer/util.js.
(function exposeErrorHints(root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  if (root) root.OpenWorkingErrorHints = api
})(typeof window === "object" ? window : globalThis, function createErrorHints() {
  const FILE_PERMISSION_PATTERN = /\b(EACCES|EPERM|Operation not permitted|permission denied)\b/i

  function filePermissionHint(message) {
    if (!FILE_PERMISSION_PATTERN.test(String(message))) return ""
    return "macOS may be blocking access to the project folder. Grant file access to the app in System Settings › Privacy & Security › Files and Folders, then reopen the project."
  }

  return { filePermissionHint, FILE_PERMISSION_PATTERN }
})
