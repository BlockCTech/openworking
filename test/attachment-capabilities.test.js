const test = require("node:test")
const assert = require("node:assert/strict")
const { attachmentModalityForMime, modelAcceptsAttachmentMime, unsupportedAttachments } = require("../src/renderer/attachment-capabilities")

test("attachmentModalityForMime classifies the known modality families", () => {
  assert.equal(attachmentModalityForMime("image/png"), "image")
  assert.equal(attachmentModalityForMime("audio/mpeg"), "audio")
  assert.equal(attachmentModalityForMime("video/mp4"), "video")
  assert.equal(attachmentModalityForMime("application/pdf"), "pdf")
  assert.equal(attachmentModalityForMime("text/plain"), "text")
  assert.equal(attachmentModalityForMime("application/zip"), null)
  assert.equal(attachmentModalityForMime(undefined), null)
})

test("modelAcceptsAttachmentMime allows everything when the model has no modality data", () => {
  assert.equal(modelAcceptsAttachmentMime(null, "image/png"), true)
  assert.equal(modelAcceptsAttachmentMime({}, "image/png"), true)
  assert.equal(modelAcceptsAttachmentMime({ modalities: { input: [] } }, "image/png"), true)
})

test("modelAcceptsAttachmentMime allows an unclassifiable mime even with a restricted modality list", () => {
  assert.equal(modelAcceptsAttachmentMime({ modalities: { input: ["text"] } }, "application/zip"), true)
})

test("modelAcceptsAttachmentMime rejects a modality missing from modalities.input", () => {
  const textOnlyModel = { modalities: { input: ["text"] } }
  assert.equal(modelAcceptsAttachmentMime(textOnlyModel, "image/png"), false)
  assert.equal(modelAcceptsAttachmentMime(textOnlyModel, "text/plain"), true)
})

test("modelAcceptsAttachmentMime accepts a modality present in modalities.input", () => {
  const visionModel = { modalities: { input: ["text", "image", "pdf"] } }
  assert.equal(modelAcceptsAttachmentMime(visionModel, "image/png"), true)
  assert.equal(modelAcceptsAttachmentMime(visionModel, "application/pdf"), true)
  assert.equal(modelAcceptsAttachmentMime(visionModel, "audio/mpeg"), false)
})

test("unsupportedAttachments returns only the attachments the model rejects", () => {
  const textOnlyModel = { modalities: { input: ["text"] } }
  const attachments = [
    { id: "a1", filename: "notes.txt", mime: "text/plain" },
    { id: "a2", filename: "photo.png", mime: "image/png" },
    { id: "a3", filename: "clip.mp4", mime: "video/mp4" }
  ]
  const result = unsupportedAttachments(attachments, textOnlyModel)
  assert.deepEqual(result.map((attachment) => attachment.id), ["a2", "a3"])
})

test("unsupportedAttachments returns an empty list for an empty or missing attachment list", () => {
  assert.deepEqual(unsupportedAttachments([], { modalities: { input: ["text"] } }), [])
  assert.deepEqual(unsupportedAttachments(undefined, { modalities: { input: ["text"] } }), [])
})
