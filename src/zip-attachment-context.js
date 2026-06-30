const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const crypto = require("node:crypto")
const AdmZip = require("adm-zip")
const { officeAttachmentContext } = require("./office-attachment-context")

const ZIP_MIME = "application/zip"
const MARKDOWN_MIME = "text/markdown"
const MAX_ENTRIES = 50
const MAX_EXTRACTED_FILES = 20
const MAX_FILE_CHARS = 8000
const MAX_MARKDOWN_CHARS = 120000
const MAX_ENTRY_BYTES = 120000
const ARCHIVE_MARKER = "[Truncated: archive budget reached]"
const OMITTED_MARKER = "[Omitted: additional files not extracted]"
const NESTED_ZIP_MARKER = "[Ignored nested zip]"
const PER_FILE_MARKER = "[Truncated: per-file limit reached]"
const OVERSIZED_MARKER = `[Skipped: entry exceeds pre-inflate size limit of ${MAX_ENTRY_BYTES} bytes]`
const DOCS_PREFIXES = ["docs/", "src/", "app/", "lib/"]
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".csv",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".java",
  ".go",
  ".rb",
  ".php",
  ".sh",
  ".css",
  ".html",
  ".sql",
  ".toml"
])
const OFFICE_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx"])

function normalizedName(entry) {
  return String(entry.entryName || "").replaceAll("\\", "/")
}

function priorityGroup(name, extension) {
  const base = path.posix.basename(name).toLowerCase()
  if (
    base.startsWith("readme") ||
    base.startsWith("changelog") ||
    base === "package.json" ||
    base.startsWith("tsconfig") ||
    base === "pyproject.toml" ||
    /^requirements.*\.txt$/.test(base) ||
    base === "go.mod" ||
    base === "cargo.toml"
  ) return 0
  if (DOCS_PREFIXES.some((prefix) => name.startsWith(prefix))) return 1
  if (TEXT_EXTENSIONS.has(extension)) return 2
  if (OFFICE_EXTENSIONS.has(extension)) return 3
  return 4
}

function describeEntry(entry, index) {
  const name = normalizedName(entry)
  const extension = path.posix.extname(name).toLowerCase()
  const isNestedZip = extension === ".zip"
  const isOffice = OFFICE_EXTENSIONS.has(extension)
  const isText = TEXT_EXTENSIONS.has(extension)
  const extractable = !entry.isDirectory && !isNestedZip && (isText || isOffice)
  return {
    entry,
    index,
    name,
    extension,
    isNestedZip,
    isOffice,
    isText,
    extractable,
    priority: priorityGroup(name, extension),
    uncompressedSize: Number(entry.header?.size || entry.entrySize || 0),
    compressedSize: Number(entry.header?.compressedSize || entry.compressedSize || 0)
  }
}

function languageHint(extension) {
  const hints = {
    ".md": "md",
    ".js": "js",
    ".ts": "ts",
    ".tsx": "tsx",
    ".jsx": "jsx",
    ".py": "py",
    ".java": "java",
    ".go": "go",
    ".rb": "rb",
    ".php": "php",
    ".sh": "sh",
    ".css": "css",
    ".html": "html",
    ".sql": "sql",
    ".json": "json",
    ".xml": "xml",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "toml",
    ".csv": "csv",
    ".txt": "text"
  }
  return hints[extension] || "text"
}

function limitText(text) {
  if (text.length <= MAX_FILE_CHARS) return { text, truncated: false }
  return {
    text: `${text.slice(0, MAX_FILE_CHARS)}\n${PER_FILE_MARKER}`,
    truncated: true
  }
}

function officeMime(extension) {
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  if (extension === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  if (extension === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  return ""
}

function readTextEntry(entry) {
  return entry.getData().toString("utf8")
}

function isOversizedEntry(item) {
  return item.uncompressedSize > MAX_ENTRY_BYTES || item.compressedSize > MAX_ENTRY_BYTES
}

function officeEntryContext(tempDir, item) {
  const tempPath = path.join(tempDir, `${crypto.randomUUID()}${item.extension}`)
  fs.writeFileSync(tempPath, item.entry.getData())
  try {
    return officeAttachmentContext({
      filePath: tempPath,
      filename: path.posix.basename(item.name),
      mime: officeMime(item.extension)
    }).replace(tempPath, item.name)
  } finally {
    fs.rmSync(tempPath, { force: true })
  }
}

function extractedBlock(tempDir, item) {
  if (isOversizedEntry(item)) return { text: `### ${item.name}\n${OVERSIZED_MARKER}`, truncated: false, skipped: true }
  const raw = item.isOffice ? officeEntryContext(tempDir, item) : readTextEntry(item.entry)
  const limited = limitText(raw)
  if (item.isOffice) return { text: `### ${item.name}\n${limited.text}`, truncated: limited.truncated }
  return {
    text: `### ${item.name}\n\`\`\`${languageHint(item.extension)}\n${limited.text}\n\`\`\``,
    truncated: limited.truncated
  }
}

function trimMarkdown(markdown) {
  if (markdown.length <= MAX_MARKDOWN_CHARS) return markdown
  const limit = Math.max(0, MAX_MARKDOWN_CHARS - ARCHIVE_MARKER.length - 1)
  return `${markdown.slice(0, limit)}\n${ARCHIVE_MARKER}`
}

function zipAttachmentContext({ filePath, filename, mime }) {
  const archiveName = filename || path.basename(filePath)
  const zip = new AdmZip(filePath)
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-zip-"))
  try {
    const outputPath = path.join(tempDir, `${path.basename(archiveName, path.extname(archiveName))}.extracted.md`)
    const allEntries = zip.getEntries().filter((entry) => !entry.isDirectory)
    const entries = allEntries
      .slice(0, MAX_ENTRIES)
      .map(describeEntry)

    const extractableEntries = entries
      .filter((entry) => entry.extractable)
      .sort((left, right) => left.priority - right.priority || left.index - right.index)
    const extractedEntries = extractableEntries.slice(0, MAX_EXTRACTED_FILES)
    const listedEntries = [...entries].sort((left, right) => left.priority - right.priority || left.index - right.index)
    const ignoredNestedZips = entries.filter((entry) => entry.isNestedZip).length
    const oversizedEntries = entries.filter((entry) => entry.extractable && isOversizedEntry(entry)).length
    const officeEntries = entries.filter((entry) => entry.isOffice).length
    const readableEntries = entries.filter((entry) => entry.extractable).length
    const listedOnlyEntries = entries.filter((entry) => !entry.extractable && !entry.isNestedZip).length
    const contentBlocks = []
    let sawPerFileTruncation = false
    for (const entry of extractedEntries) {
      const block = extractedBlock(tempDir, entry)
      if (block.truncated) sawPerFileTruncation = true
      contentBlocks.push(block.text)
    }

    const lines = [
      `# Extracted from: ${archiveName}`,
      "",
      "## Summary",
      `- Total entries: ${allEntries.length}${allEntries.length > MAX_ENTRIES ? ` (showing first ${MAX_ENTRIES})` : ""}`,
      `- Readable entries: ${readableEntries}`,
      `- Office entries: ${officeEntries}`,
      `- Ignored nested zips: ${ignoredNestedZips}`,
      `- Oversized entries skipped before extraction: ${oversizedEntries}`,
      `- Binary entries listed only: ${listedOnlyEntries}`,
      "",
      "## File list",
      ...listedEntries.map((entry) => {
        if (entry.isNestedZip) return `- ${entry.name} (ignored nested zip)`
        if (!entry.extractable) return `- ${entry.name} (binary, listed only)`
        if (isOversizedEntry(entry)) return `- ${entry.name} (${OVERSIZED_MARKER})`
        return `- ${entry.name}`
      }),
      "",
      "## Extracted content"
    ]

    if (!contentBlocks.length) lines.push("- No readable files extracted.")
    else lines.push(...contentBlocks)
    if (extractableEntries.length > MAX_EXTRACTED_FILES) lines.push(OMITTED_MARKER)
    if (allEntries.length > MAX_ENTRIES) lines.push(ARCHIVE_MARKER)
    if (sawPerFileTruncation) lines.push(PER_FILE_MARKER)
    if (ignoredNestedZips) lines.push(NESTED_ZIP_MARKER)

    const markdown = trimMarkdown(lines.join("\n\n"))
    fs.writeFileSync(outputPath, markdown, "utf8")

    return {
      filePath: outputPath,
      filename: path.basename(outputPath),
      mime: MARKDOWN_MIME,
      cleanupPaths: [outputPath, tempDir],
      metadata: {
        archivePath: filePath,
        generatedFilePath: outputPath,
        cleanupPaths: [outputPath, tempDir]
      }
    }
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true })
    throw error
  }
}

module.exports = {
  MARKDOWN_MIME,
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_EXTRACTED_FILES,
  MAX_FILE_CHARS,
  MAX_MARKDOWN_CHARS,
  OVERSIZED_MARKER,
  ZIP_MIME,
  zipAttachmentContext
}
