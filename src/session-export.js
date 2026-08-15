function sessionExportFilename(session) {
  const id = String(session?.id || "session")
  const name = String(session?.title || session?.slug || id)
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
  return `${clean || id}.json`
}

function serializeSessionExport(data) {
  return JSON.stringify(data, null, 2)
}

async function saveSessionExport({ data, showSaveDialog, writeFile }) {
  const result = await showSaveDialog({
    title: "Export session",
    defaultPath: sessionExportFilename(data.info),
    filters: [{ name: "JSON", extensions: ["json"] }]
  })
  if (result.canceled || !result.filePath) return { canceled: true }
  await writeFile(result.filePath, serializeSessionExport(data), "utf8")
  return { canceled: false }
}

module.exports = { saveSessionExport, serializeSessionExport, sessionExportFilename }
