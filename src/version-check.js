const fs = require("node:fs")
const http = require("node:http")
const https = require("node:https")
const path = require("node:path")
const { execFileSync } = require("node:child_process")

const REQUEST_TIMEOUT_MS = 5000

// There is no public update server. The whole update flow only activates when a
// self-hosted version API is configured via OPENWORKING_VERSION_API_BASE (or an
// explicit baseURL); otherwise checks report "ok" and the UI stays silent.
function resolveBaseURL(explicit) {
  const base = explicit || process.env.OPENWORKING_VERSION_API_BASE || ""
  return base ? String(base).replace(/\/+$/, "") : null
}

function versionCheckConfigured(explicit) {
  return Boolean(resolveBaseURL(explicit))
}

function platformParam(platform) {
  if (platform === "darwin") return "macos"
  if (platform === "win32") return "windows"
  if (platform === "linux") return "linux"
  return null
}

function transportFor(url) {
  return url.protocol === "https:" ? https : http
}

function requestJson(url, { timeout = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = transportFor(parsed).request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers: { Accept: "application/json" }
      },
      (res) => {
        let raw = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => {
          raw += chunk
        })
        res.on("end", () => {
          let body = null
          try {
            body = raw ? JSON.parse(raw) : null
          } catch {
            body = null
          }
          resolve({ statusCode: res.statusCode, body })
        })
      }
    )
    req.setTimeout(timeout, () => req.destroy(new Error("Version check timed out")))
    req.on("error", reject)
    req.end()
  })
}

// Calls the public version-check API and projects the response into a small,
// fail-open shape the renderer can act on directly. The server owns all semver
// comparison; we only read its boolean flags.
async function checkDesktopVersion({ currentVersion, platform, baseURL, arch = process.arch } = {}) {
  const apiBase = resolveBaseURL(baseURL)
  if (!apiBase) return { status: "ok", reason: "disabled" }

  const queryPlatform = platformParam(platform)
  if (!queryPlatform) return { status: "ok", reason: "unsupported-platform" }

  const url = new URL(`${apiBase}/api/v1/desktop-app/version`)
  url.searchParams.set("platform", queryPlatform)
  if (currentVersion) url.searchParams.set("current_version", currentVersion)

  let result
  try {
    result = await requestJson(url.toString())
  } catch {
    // Network error / timeout — fail open so the user is not locked out.
    return { status: "ok", reason: "error" }
  }

  const { statusCode, body } = result
  if (statusCode === 404) return { status: "ok", reason: "not-configured" }
  if (statusCode < 200 || statusCode >= 300 || !body) return { status: "ok", reason: "error" }

  // Intel (x64) builds — including ones running under Rosetta, which still
  // report process.arch === "x64" — need the x64 DMG. Fall back to the default
  // (arm64) URL when the server hasn't published an intel-specific one yet.
  const downloadUrl =
    arch === "x64" ? body.download_url_intel || body.download_url || null : body.download_url || null

  const payload = {
    latestVersion: body.latest_version || null,
    downloadUrl,
    releaseNotes: body.release_notes || null
  }
  if (body.update_required) return { status: "force", ...payload }
  if (body.update_available) return { status: "soft", ...payload }
  return { status: "ok" }
}

// Downloads the installer at `downloadUrl` into `destDir`, following redirects,
// reporting progress via the optional `onProgress(percent)` callback. Returns
// the absolute path of the written file. Only https URLs are accepted.
function downloadInstaller({ downloadUrl, destDir, onProgress, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed
    try {
      parsed = new URL(downloadUrl)
    } catch {
      reject(new Error("Invalid download URL"))
      return
    }
    if (parsed.protocol !== "https:") {
      reject(new Error("Refusing to download from a non-https URL"))
      return
    }

    const fileName = path.basename(parsed.pathname) || "OpenWorking-update.dmg"
    const destPath = path.join(destDir, fileName)

    const get = (target, redirectsLeft) => {
      https
        .get(target, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            if (redirectsLeft <= 0) {
              reject(new Error("Too many redirects while downloading update"))
              return
            }
            get(new URL(res.headers.location, target).toString(), redirectsLeft - 1)
            return
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume()
            reject(new Error(`Download failed: HTTP ${res.statusCode}`))
            return
          }

          const total = Number(res.headers["content-length"]) || 0
          let received = 0
          const out = fs.createWriteStream(destPath)
          res.on("data", (chunk) => {
            received += chunk.length
            if (total && typeof onProgress === "function") {
              onProgress(Math.min(100, Math.round((received / total) * 100)))
            }
          })
          res.pipe(out)
          out.on("finish", () => out.close(() => resolve(destPath)))
          out.on("error", (error) => {
            fs.rm(destPath, { force: true }, () => reject(error))
          })
        })
        .on("error", reject)
    }

    get(parsed.toString(), maxRedirects)
  })
}

// Parses the device/mount-point table printed by `hdiutil attach -plist` is
// overkill here; the plain stdout ends each line with a tab-separated mount
// point. Return the last column of the line whose mount point lives under /.
function parseMountPoint(stdout) {
  const lines = String(stdout || "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
  for (const line of lines) {
    // Columns are tab-separated; the mount point is the final column and is an
    // absolute path (e.g. "/Volumes/OpenWorking" or a /tmp random mount).
    const match = line.match(/(\/[^\t]+)\s*$/)
    if (match && match[1].startsWith("/")) return match[1]
  }
  return null
}

// Installs a freshly downloaded macOS .dmg over the running app bundle:
// mount → copy the .app over `appBundlePath` with ditto → detach → remove the
// .dmg. Throws (with a readable message) if any step fails so the caller can
// fall back to the manual drag-to-Applications flow. macOS-only.
//
// `exec` is injectable so tests can drive it without spawning real processes.
function installDmg({ dmgPath, appBundlePath, exec = execFileSync, fileSystem = fs } = {}) {
  if (process.platform !== "darwin") {
    throw new Error("Automatic install is only supported on macOS")
  }
  if (!dmgPath || !appBundlePath) {
    throw new Error("installDmg requires dmgPath and appBundlePath")
  }

  let mountPoint = null
  try {
    const attachOut = exec(
      "hdiutil",
      ["attach", dmgPath, "-nobrowse", "-noautoopen", "-mountrandom", "/tmp"],
      { encoding: "utf8" }
    )
    mountPoint = parseMountPoint(attachOut)
    if (!mountPoint) throw new Error("Could not determine the mount point for the update")

    const bundle = fileSystem
      .readdirSync(mountPoint)
      .find((entry) => entry.endsWith(".app"))
    if (!bundle) throw new Error("No .app bundle found inside the update image")

    const sourceApp = path.join(mountPoint, bundle)
    // ditto preserves permissions, symlinks and code signatures; copying over
    // the existing bundle replaces the running app in place.
    exec("ditto", [sourceApp, appBundlePath], { encoding: "utf8" })
  } finally {
    if (mountPoint) {
      try {
        exec("hdiutil", ["detach", mountPoint, "-force"], { encoding: "utf8" })
      } catch {
        // Best-effort unmount; ignore failures.
      }
    }
  }

  // Only reached when the copy above succeeded (a thrown error skips this).
  // On failure we keep the .dmg so the caller can fall back to opening it.
  try {
    fileSystem.rmSync(dmgPath, { force: true })
  } catch {
    // Best-effort cleanup of the downloaded image.
  }
}

module.exports = {
  checkDesktopVersion,
  downloadInstaller,
  installDmg,
  parseMountPoint,
  platformParam,
  versionCheckConfigured
}
