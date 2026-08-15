// V2 PromptInput.FileAttachment shape ({ uri, name, description }) for external, non-local
// attachments — kept separate from attachment-registry.js, which only ever resolves local file
// paths. Extracted from main.js so it can be unit-tested directly (main.js pulls in Electron and
// isn't require-able from a plain Node test).
const EXTERNAL_ATTACHMENT_URI_SCHEMES = new Set(["http:", "https:"])
const EXTERNAL_ATTACHMENT_MAX_NAME_LENGTH = 200
const EXTERNAL_ATTACHMENT_MAX_DESCRIPTION_LENGTH = 2000

function validatedExternalAttachments(list) {
  if (list === undefined) return []
  if (!Array.isArray(list)) throw new Error("External attachments must be a list.")
  return list.map((item) => {
    const uri = typeof item?.uri === "string" ? item.uri.trim() : ""
    if (!uri) throw new Error("Each external attachment requires a uri.")
    let parsed
    try {
      parsed = new URL(uri)
    } catch {
      throw new Error(`External attachment uri is not a valid URL: ${uri}`)
    }
    // file:/data:/etc. would let the renderer route arbitrary local reads through what's meant to
    // be an external-only path; attachmentRegistry is the only sanctioned way to attach local files.
    if (!EXTERNAL_ATTACHMENT_URI_SCHEMES.has(parsed.protocol)) {
      throw new Error(`External attachment uri must be http(s), got: ${parsed.protocol}`)
    }
    const name = typeof item?.name === "string" ? item.name.trim() : ""
    if (name.length > EXTERNAL_ATTACHMENT_MAX_NAME_LENGTH) throw new Error("External attachment name is too long.")
    const description = typeof item?.description === "string" ? item.description.trim() : ""
    if (description.length > EXTERNAL_ATTACHMENT_MAX_DESCRIPTION_LENGTH) {
      throw new Error("External attachment description is too long.")
    }
    return {
      type: "file",
      url: uri,
      ...(name ? { filename: name } : {}),
      ...(description ? { description } : {})
    }
  })
}

module.exports = {
  EXTERNAL_ATTACHMENT_MAX_DESCRIPTION_LENGTH,
  EXTERNAL_ATTACHMENT_MAX_NAME_LENGTH,
  validatedExternalAttachments
}
