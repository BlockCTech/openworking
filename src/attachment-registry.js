const crypto = require("node:crypto")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const mime = require("mime-types")

function publicAttachment(attachment) {
  return {
    id: attachment.id,
    filename: attachment.filename,
    mime: attachment.mime
  }
}

class AttachmentRegistry {
  constructor({ createId = () => crypto.randomUUID(), lookupMime = mime.lookup } = {}) {
    this.createId = createId
    this.lookupMime = lookupMime
    this.attachments = new Map()
    this.idsByPath = new Map()
  }

  add(filePaths = []) {
    return this.addResolved(filePaths.map((filePath) => path.resolve(String(filePath))))
  }

  addResolved(filePaths = []) {
    const result = []
    for (const filePath of filePaths) {
      const resolvedPath = String(filePath)
      let attachment = this.attachments.get(this.idsByPath.get(resolvedPath))
      if (!attachment) {
        attachment = {
          id: this.createId(),
          filePath: resolvedPath,
          filename: path.basename(resolvedPath),
          mime: this.lookupMime(resolvedPath) || "application/octet-stream"
        }
        this.attachments.set(attachment.id, attachment)
        this.idsByPath.set(resolvedPath, attachment.id)
      }
      result.push(publicAttachment(attachment))
    }
    return result
  }

  resolve(ids = []) {
    return [...new Set(ids)].map((id) => {
      const attachment = this.attachments.get(id)
      if (!attachment) throw new Error("Attachment is no longer available. Select the file again.")
      return {
        type: "file",
        url: pathToFileURL(attachment.filePath).href,
        filename: attachment.filename,
        mime: attachment.mime
      }
    })
  }

  discard(ids = []) {
    for (const id of new Set(ids)) {
      const attachment = this.attachments.get(id)
      if (!attachment) continue
      this.attachments.delete(id)
      this.idsByPath.delete(attachment.filePath)
    }
  }

  clear() {
    this.attachments.clear()
    this.idsByPath.clear()
  }
}

module.exports = { AttachmentRegistry }
