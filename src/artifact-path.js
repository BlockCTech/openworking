const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { StringDecoder } = require("node:string_decoder")
const { pathToFileURL } = require("node:url")

const TRANSLATION_ARTIFACT_EXTENSIONS = new Set([".docx", ".md", ".markdown", ".pdf", ".pptx", ".xlsx"])
const TRANSLATION_ARTIFACT_NAME = /^.+-translated-[a-z0-9]+(?:-[a-z0-9]+)*(?:-\d+)?$/
const TRANSLATION_ARTIFACT_MIME_BY_EXTENSION = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}

function assertTranslationArtifact(projectPath, artifactPath) {
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
  if (!TRANSLATION_ARTIFACT_EXTENSIONS.has(extension)) {
    throw new Error("Artifact path is not a translated document artifact.")
  }
  // A translated artifact is either named "<base>-translated-<lang>" (the default
  // new-file mode, which may live anywhere), or the in-place mode overwrites the
  // original document, which keeps its original name. Allow the latter only when it
  // resolves inside the current project root.
  if (TRANSLATION_ARTIFACT_NAME.test(parsed.name)) {
    return resolvedArtifact
  }
  if (projectPath) {
    let projectRoot
    try {
      projectRoot = fs.realpathSync(path.resolve(projectPath))
    } catch {
      throw new Error("Artifact path is not a translated document artifact.")
    }
    const relative = path.relative(projectRoot, resolvedArtifact)
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
      return resolvedArtifact
    }
  }
  throw new Error("Artifact path is not a translated document artifact.")
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

function isHiddenProjectPath(relativePath) {
  return String(relativePath || "")
    .split(/[\\/]/)
    .filter(Boolean)
    .some((segment) => segment.startsWith("."))
}

function normalizeProjectRelativePath(relativePath) {
  return String(relativePath || "").replace(/\\/g, "/")
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

function ignoredRelativePaths(projectRoot, relativePaths) {
  const candidates = relativePaths.filter((relativePath) => relativePath && !isHiddenProjectPath(relativePath))
  if (!candidates.length) return new Set()
  const result = spawnSync("git", ["-C", projectRoot, "check-ignore", "--stdin"], {
    input: `${candidates.join("\n")}\n`,
    encoding: "utf8"
  })
  if (result.status === 0 || result.status === 1) {
    return new Set(String(result.stdout || "").split("\n").filter(Boolean))
  }
  return new Set()
}

function listProjectDirectory(projectPath, directoryPath = "", options = {}) {
  const { projectRoot, resolved, relative } = assertProjectDirectory(projectPath, directoryPath)
  const mode = options && typeof options === "object" ? options.mode : ""
  const recursive = Boolean(options && typeof options === "object" && options.recursive)
  const entries = fs.readdirSync(resolved, { withFileTypes: true })
  const relativePaths = []
  const rawChildren = []
  for (const entry of entries) {
    const type = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : null
    if (!type) continue
    if (type === "directory" && IGNORED_PROJECT_DIRECTORIES.has(entry.name)) continue
    const absolutePath = path.join(resolved, entry.name)
    const childRelativePath = normalizeProjectRelativePath(path.relative(projectRoot, absolutePath))
    rawChildren.push({ entry, type, absolutePath, childRelativePath })
    relativePaths.push(childRelativePath)
  }
  const ignoredPaths = mode === "visible-openable-files" ? ignoredRelativePaths(projectRoot, relativePaths) : null
  const children = []
  for (const child of rawChildren) {
    if (isHiddenProjectPath(child.childRelativePath)) continue
    if (mode === "visible-openable-files") {
      if (ignoredPaths?.has(child.childRelativePath)) continue
      if (child.type === "directory") {
        if (!recursive) continue
        const nested = listProjectDirectory(projectRoot, child.childRelativePath, options)
        children.push(...nested.children)
        continue
      }
      if (!isViewableProjectFile(child.absolutePath)) continue
      children.push({
        name: child.entry.name,
        path: child.childRelativePath,
        type: child.type,
        openable: true
      })
      continue
    }
    children.push({
      name: child.entry.name,
      path: child.childRelativePath,
      type: child.type,
      openable: child.type === "file" && isViewableProjectFile(child.absolutePath)
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

function artifactRelativePath(projectPath, safePath) {
  if (!projectPath) return path.basename(safePath)
  try {
    const projectRoot = fs.realpathSync(path.resolve(projectPath))
    const relative = path.relative(projectRoot, safePath)
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative
  } catch {
    // Fall through to the basename for artifacts outside the active project.
  }
  return path.basename(safePath)
}

function previewTranslationArtifact(projectPath, artifactPath, maxBytes = 2 * 1024 * 1024) {
  const safePath = assertTranslationArtifact(projectPath, artifactPath)
  const extension = path.extname(safePath).toLowerCase()
  const base = {
    path: safePath,
    relativePath: artifactRelativePath(projectPath, safePath),
    name: path.basename(safePath),
    extension,
    mime: TRANSLATION_ARTIFACT_MIME_BY_EXTENSION[extension] || "application/octet-stream"
  }
  if (extension === ".md" || extension === ".markdown") {
    const { content, truncated } = readProjectFileContent(safePath, maxBytes)
    return { ...base, previewMode: "markdown", content, truncated }
  }
  if (extension === ".pdf") {
    return { ...base, previewMode: "pdf", url: pathToFileURL(safePath).href, truncated: false }
  }
  return { ...base, previewMode: "external", truncated: false }
}

module.exports = {
  assertTranslationArtifact,
  assertProjectFile,
  assertProjectDirectory,
  listProjectDirectory,
  previewTranslationArtifact,
  readProjectFileContent
}
