// Modality gating for the attachment picker/send path against the selected model's
// modalities.input — the app pins its model(s) from local profile config (src/opencode-config.js:
// DEFAULT_MODEL_MODALITIES) rather than reading a live runtime catalog (see the comment on
// modelOptions() in renderer.js for why), so this reads model.modalities, not model.capabilities.
// Pure, no `state`/DOM dependency — exposed on window.OpenWorkingAttachmentCapabilities.
(function exposeAttachmentCapabilities(root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  if (root) root.OpenWorkingAttachmentCapabilities = api
})(typeof window === "object" ? window : globalThis, function createAttachmentCapabilities() {
  // Mirrors ALLOWED_MODEL_MODALITIES in renderer.js / DEFAULT_MODEL_MODALITIES in
  // src/opencode-config.js — the fixed set of modality strings model.modalities.input/output use.
  function attachmentModalityForMime(mime) {
    if (typeof mime !== "string" || !mime) return null
    if (mime.startsWith("image/")) return "image"
    if (mime.startsWith("audio/")) return "audio"
    if (mime.startsWith("video/")) return "video"
    if (mime === "application/pdf") return "pdf"
    if (mime.startsWith("text/")) return "text"
    return null
  }

  // Fails open: missing modality data, or a mime this module can't classify into one of the
  // five known modalities, is allowed through rather than blocked — better to risk one bad send
  // than reject a legitimate attachment because the mapping doesn't cover it.
  function modelAcceptsAttachmentMime(model, mime) {
    const input = model?.modalities?.input
    if (!Array.isArray(input) || !input.length) return true
    const modality = attachmentModalityForMime(mime)
    if (!modality) return true
    return input.includes(modality)
  }

  function unsupportedAttachments(attachments, model) {
    return (attachments || []).filter((attachment) => !modelAcceptsAttachmentMime(model, attachment?.mime))
  }

  return {
    init() {},
    attachmentModalityForMime,
    modelAcceptsAttachmentMime,
    unsupportedAttachments
  }
})
