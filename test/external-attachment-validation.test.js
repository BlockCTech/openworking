const test = require("node:test")
const assert = require("node:assert/strict")
const { validatedExternalAttachments } = require("../src/external-attachment-validation")

test("validatedExternalAttachments returns an empty list when omitted", () => {
  assert.deepEqual(validatedExternalAttachments(undefined), [])
})

test("validatedExternalAttachments rejects a non-array payload", () => {
  assert.throws(() => validatedExternalAttachments({ uri: "https://example.com/a.png" }), /must be a list/)
})

test("validatedExternalAttachments rejects a missing uri", () => {
  assert.throws(() => validatedExternalAttachments([{ name: "a.png" }]), /requires a uri/)
})

test("validatedExternalAttachments rejects a malformed uri", () => {
  assert.throws(() => validatedExternalAttachments([{ uri: "not a url" }]), /not a valid URL/)
})

test("validatedExternalAttachments rejects a non-http(s) scheme", () => {
  assert.throws(
    () => validatedExternalAttachments([{ uri: "file:///etc/passwd" }]),
    /must be http\(s\)/
  )
})

test("validatedExternalAttachments rejects an oversized name or description", () => {
  assert.throws(
    () => validatedExternalAttachments([{ uri: "https://example.com/a.png", name: "x".repeat(201) }]),
    /name is too long/
  )
  assert.throws(
    () => validatedExternalAttachments([{ uri: "https://example.com/a.png", description: "x".repeat(2001) }]),
    /description is too long/
  )
})

test("validatedExternalAttachments maps a valid entry to the internal file-part shape", () => {
  assert.deepEqual(
    validatedExternalAttachments([{ uri: "https://example.com/report.pdf", name: "report.pdf", description: "Q3 report" }]),
    [{ type: "file", url: "https://example.com/report.pdf", filename: "report.pdf", description: "Q3 report" }]
  )
})

test("validatedExternalAttachments omits filename/description when not provided", () => {
  assert.deepEqual(
    validatedExternalAttachments([{ uri: "https://example.com/report.pdf" }]),
    [{ type: "file", url: "https://example.com/report.pdf" }]
  )
})
