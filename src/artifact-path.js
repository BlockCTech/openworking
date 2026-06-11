const fs = require("node:fs")
const path = require("node:path")
const { StringDecoder } = require("node:string_decoder")

const TRANSLATION_ARTIFACT_EXTENSIONS = new Set([".docx", ".pdf", ".pptx", ".xlsx"])
const TRANSLATION_ARTIFACT_NAME = /^.+-translated-[a-z0-9]+(?:-[a-z0-9]+)*(?:-\d+)?$/

function assertTranslationArtifact(_projectPath, artifactPath) {
  const requestedArtifact = path.resolve(String(artifactPath))
  if (!fs.existsSync(requestedArtifact)) {
    throw new Error("Artifact does not exist.")
  }
  const resolvedArtifact = fs.realpathSync(requestedArtifact)
  if (!fs.statSync(resolvedArtifact).isFile()) {
    throw new Error("Artifact path is not a file.")
  }
  const parsed = path.parse(resolvedArtifact)
  const extension = parsed.ext.toLowerCase()
  if (!TRANSLATION_ARTIFACT_EXTENSIONS.has(extension) || !TRANSLATION_ARTIFACT_NAME.test(parsed.name)) {
    throw new Error("Artifact path is not a translated document artifact.")
  }
  return resolvedArtifact
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"])

function assertProjectFile(projectPath, filePath) {
  const projectRoot = fs.realpathSync(path.resolve(projectPath))
  const requested = path.resolve(String(filePath))
  if (!fs.existsSync(requested)) {
    throw new Error("File does not exist.")
  }
  const resolved = fs.realpathSync(requested)
  const relative = path.relative(projectRoot, resolved)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("File path is outside the current project.")
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new Error("File path is not a file.")
  }
  if (!MARKDOWN_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new Error("Only markdown files can be opened.")
  }
  return resolved
}

// Reads a UTF-8 file, truncating to `maxBytes` without corrupting multibyte
// characters at the boundary. Returns { content, truncated }.
function readProjectFileContent(safePath, maxBytes) {
  const stats = fs.statSync(safePath)
  if (stats.size <= maxBytes) {
    return { content: fs.readFileSync(safePath, "utf8"), truncated: false }
  }
  const fd = fs.openSync(safePath, "r")
  try {
    const buffer = Buffer.alloc(maxBytes)
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0)
    // StringDecoder only emits complete code points; a multibyte character
    // split at `bytesRead` is dropped instead of becoming a replacement char.
    const decoder = new StringDecoder("utf8")
    const content = decoder.write(buffer.subarray(0, bytesRead))
    return { content, truncated: true }
  } finally {
    fs.closeSync(fd)
  }
}

module.exports = { assertTranslationArtifact, assertProjectFile, readProjectFileContent }
