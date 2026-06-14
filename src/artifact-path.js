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

const VIEWABLE_FILE_EXTENSIONS = new Set([
  ".md", ".markdown",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".css", ".scss", ".html",
  ".json", ".jsonc", ".yml", ".yaml", ".toml", ".xml",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".cpp", ".h", ".cs", ".php", ".sql",
  ".vue", ".svelte", ".astro",
  ".sh", ".bash", ".zsh"
])
const VIEWABLE_FILE_BASENAMES = new Set(["Dockerfile", "Makefile", "Procfile", ".gitignore", ".eslintrc", ".prettierrc", ".editorconfig"])
const IGNORED_PROJECT_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".pnpm-store",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target"
])

function isViewableProjectFile(filePath) {
  const parsed = path.parse(filePath)
  return VIEWABLE_FILE_BASENAMES.has(parsed.base) || VIEWABLE_FILE_EXTENSIONS.has(parsed.ext.toLowerCase())
}

function assertProjectFile(projectPath, filePath) {
  const projectRoot = fs.realpathSync(path.resolve(projectPath))
  const requestedInput = String(filePath)
  const requested = path.isAbsolute(requestedInput)
    ? path.resolve(requestedInput)
    : path.resolve(projectRoot, requestedInput)
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
  if (!isViewableProjectFile(resolved)) {
    throw new Error("Only markdown and common code files can be opened.")
  }
  return resolved
}

function assertProjectDirectory(projectPath, directoryPath = "") {
  const projectRoot = fs.realpathSync(path.resolve(projectPath))
  const requestedInput = String(directoryPath || "")
  const requested = path.isAbsolute(requestedInput)
    ? path.resolve(requestedInput)
    : path.resolve(projectRoot, requestedInput)
  if (!fs.existsSync(requested)) {
    throw new Error("Directory does not exist.")
  }
  const resolved = fs.realpathSync(requested)
  const relative = path.relative(projectRoot, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Directory path is outside the current project.")
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error("Directory path is not a directory.")
  }
  return { projectRoot, resolved, relative }
}

function listProjectDirectory(projectPath, directoryPath = "") {
  const { projectRoot, resolved, relative } = assertProjectDirectory(projectPath, directoryPath)
  const entries = fs.readdirSync(resolved, { withFileTypes: true })
  const children = []
  for (const entry of entries) {
    const type = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : null
    if (!type) continue
    if (type === "directory" && IGNORED_PROJECT_DIRECTORIES.has(entry.name)) continue
    const absolutePath = path.join(resolved, entry.name)
    const childRelativePath = path.relative(projectRoot, absolutePath)
    children.push({
      name: entry.name,
      path: childRelativePath,
      type,
      openable: type === "file" && isViewableProjectFile(absolutePath)
    })
  }
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })
  return {
    path: relative,
    name: relative ? path.basename(resolved) : path.basename(projectRoot) || projectRoot,
    children
  }
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

module.exports = { assertTranslationArtifact, assertProjectFile, assertProjectDirectory, listProjectDirectory, readProjectFileContent }
