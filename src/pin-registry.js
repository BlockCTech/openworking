const fs = require("node:fs")
const path = require("node:path")

// App-side store of pinned chat sessions. Sessions are owned by OpenCode core and the
// runtime only serves one project at a time, so the app caches enough metadata
// (projectId/title/updatedAt) per pin to render a flat, cross-project "Pinned" list even
// when a session's project runtime is not running. Kept in its own JSON file under
// userData, mirroring ProjectRegistry. Pins for deleted sessions are harmless: they
// simply never match a live session.
//
// On-disk shape: { pins: { [sessionId]: { projectId, title, updatedAt } } }.
class PinRegistry {
  constructor(userDataPath) {
    this.registryPath = path.join(userDataPath, "pinned-sessions.json")
  }

  // Reads raw pins map from disk, normalizing the legacy boolean shape (`true`) into a
  // metadata object so old pins keep working.
  readPins() {
    try {
      const raw = fs.readFileSync(this.registryPath, "utf8")
      const parsed = JSON.parse(raw)
      const pins = parsed && typeof parsed.pins === "object" && parsed.pins ? parsed.pins : {}
      const normalized = {}
      for (const [sessionId, value] of Object.entries(pins)) {
        if (!value) continue
        normalized[sessionId] = value === true
          ? { projectId: null, title: "", updatedAt: null }
          : {
              projectId: value.projectId || null,
              title: typeof value.title === "string" ? value.title : "",
              updatedAt: value.updatedAt || null
            }
      }
      return normalized
    } catch (error) {
      if (error.code === "ENOENT") return {}
      throw error
    }
  }

  list() {
    return Object.entries(this.readPins()).map(([sessionId, meta]) => ({ sessionId, ...meta }))
  }

  set(sessionId, pinned, meta = {}) {
    const id = String(sessionId || "").trim()
    if (!id) throw new Error("Session id is required.")

    const pins = this.readPins()
    if (pinned) {
      pins[id] = {
        projectId: meta.projectId || null,
        title: typeof meta.title === "string" ? meta.title : "",
        updatedAt: meta.updatedAt || null
      }
    } else {
      delete pins[id]
    }

    this.save(pins)
    return Object.entries(pins).map(([entryId, entryMeta]) => ({ sessionId: entryId, ...entryMeta }))
  }

  save(pins) {
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true })
    fs.writeFileSync(this.registryPath, `${JSON.stringify({ pins }, null, 2)}\n`)
  }
}

module.exports = { PinRegistry }
