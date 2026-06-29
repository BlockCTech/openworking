const test = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")

const extensionDir = path.join(__dirname, "..", "resources", "browser-extension")
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"))

// Chrome derives an unpacked extension's id from the sha256 of its DER public key, first 16 bytes
// mapped into the a-p alphabet. The native host manifest pins this id, so it must match.
function deriveExtensionId(keyB64) {
  const der = Buffer.from(keyB64, "base64")
  const hash = crypto.createHash("sha256").update(der).digest()
  return Array.from(hash.subarray(0, 16)).map((b) => "abcdefghijklmnop"[b >> 4] + "abcdefghijklmnop"[b & 15]).join("")
}

test("manifest is a valid minimal MV3 manifest", () => {
  assert.equal(manifest.manifest_version, 3)
  assert.equal(typeof manifest.name, "string")
  assert.equal(manifest.background.service_worker, "background.js")
  assert.equal(manifest.action.default_popup, "popup.html")
})

test("manifest requests only the minimal permission set and no broad host_permissions", () => {
  // alarms is the keep-alive heartbeat that wakes the MV3 worker to keep the native host alive.
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "alarms", "nativeMessaging", "scripting", "tabs"])
  // Critically, no host_permissions / <all_urls> — DOM access is scoped to the active tab on demand.
  assert.equal("host_permissions" in manifest, false)
})

test("the pinned key derives to the extension id the bridge allowlists", () => {
  assert.equal(typeof manifest.key, "string")
  const { BROWSER_EXTENSION_ID } = require("../src/browser-bridge")
  assert.equal(deriveExtensionId(manifest.key), BROWSER_EXTENSION_ID)
})

test("every file the manifest references exists in the bundle", () => {
  for (const file of ["background.js", "popup.html", "popup.js"]) {
    assert.equal(fs.existsSync(path.join(extensionDir, file)), true, `missing ${file}`)
  }
})
