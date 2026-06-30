const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const {
  NATIVE_HOST_NAME,
  BROWSER_EXTENSION_ID,
  chromeNativeMessagingDir,
  hostManifestPath,
  hostManifestContents,
  buildLauncherScript,
  detectChrome,
  installHost,
  status
} = require("../src/browser-bridge")

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openworking-browser-home-"))
}

test("chromeNativeMessagingDir resolves the macOS Chrome stable path", () => {
  const dir = chromeNativeMessagingDir("/Users/x")
  assert.equal(dir, "/Users/x/Library/Application Support/Google/Chrome/NativeMessagingHosts")
  assert.equal(hostManifestPath("/Users/x"), path.join(dir, `${NATIVE_HOST_NAME}.json`))
})

test("host manifest pins exactly the bundled extension id and our launcher", () => {
  const manifest = hostManifestContents("/path/to/run-host.sh")
  assert.equal(manifest.name, NATIVE_HOST_NAME)
  assert.equal(manifest.type, "stdio")
  assert.equal(manifest.path, "/path/to/run-host.sh")
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${BROWSER_EXTENSION_ID}/`])
})

test("launcher shim execs the Electron binary as node against the host script", () => {
  const shim = buildLauncherScript({ execPath: "/A/Electron", hostScript: "/A/host.js", hostDir: "/A/dir" })
  assert.match(shim, /^#!\/bin\/sh/)
  assert.match(shim, /ELECTRON_RUN_AS_NODE=1/)
  assert.match(shim, /OPENWORKING_BROWSER_HOST_DIR='\/A\/dir'/)
  assert.match(shim, /exec '\/A\/Electron' '\/A\/host\.js'/)
})

test("launcher shim quotes paths containing spaces and single quotes safely", () => {
  const shim = buildLauncherScript({
    execPath: "/Apps/My App.app/Electron",
    hostScript: "/it's/host.js",
    hostDir: "/d"
  })
  assert.match(shim, /exec '\/Apps\/My App\.app\/Electron' '\/it'\\''s\/host\.js'/)
})

test("installHost writes a tokened sidecar, an executable launcher and a pinned manifest", () => {
  const home = tempHome()
  const hostDir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-browser-hostdir-"))
  const result = installHost({ home, hostDir, execPath: "/A/Electron", hostScript: "/A/host.js" })

  // Token sidecar exists and is restrictively permissioned.
  const tokenPath = path.join(hostDir, "host.token")
  assert.equal(fs.existsSync(tokenPath), true)
  assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600)
  assert.equal(fs.readFileSync(tokenPath, "utf8").length, 64)

  // Launcher is executable.
  assert.equal(fs.statSync(result.launcherPath).mode & 0o100, 0o100)

  // Manifest is at the Chrome path, pins our extension and points at the launcher.
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, "utf8"))
  assert.equal(manifest.path, result.launcherPath)
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${BROWSER_EXTENSION_ID}/`])
  assert.equal(result.manifestPath, hostManifestPath(home))
})

test("installHost clears a stale host.port so status is honest", () => {
  const home = tempHome()
  const hostDir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-browser-stale-"))
  fs.writeFileSync(path.join(hostDir, "host.port"), "5555")
  installHost({ home, hostDir, execPath: "/A/Electron", hostScript: "/A/host.js" })
  assert.equal(fs.existsSync(path.join(hostDir, "host.port")), false)
})

test("installHost tightens a pre-existing token file with looser permissions to 0600", () => {
  const home = tempHome()
  const hostDir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-browser-tokenperm-"))
  // A token left over from a prior install with world/group-readable perms must not survive a reinstall.
  const tokenPath = path.join(hostDir, "host.token")
  fs.writeFileSync(tokenPath, "stale", { mode: 0o644 })
  fs.chmodSync(tokenPath, 0o644)
  installHost({ home, hostDir, execPath: "/A/Electron", hostScript: "/A/host.js" })
  assert.equal(fs.statSync(tokenPath).mode & 0o777, 0o600)
})

test("status reports hostInstalled only when the manifest is valid and the launcher exists", () => {
  const home = tempHome()
  const hostDir = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-browser-status-"))

  // Before install.
  const before = status({ home, hostDir })
  assert.equal(before.hostInstalled, false)
  assert.equal(before.extensionId, BROWSER_EXTENSION_ID)

  installHost({ home, hostDir, execPath: process.execPath, hostScript: __filename })
  const after = status({ home, hostDir })
  assert.equal(after.hostInstalled, true)
  assert.equal(after.tokenInstalled, true)

  // Tampered manifest (different extension id) must not be reported as installed.
  const manifestPath = hostManifestPath(home)
  const tampered = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  tampered.allowed_origins = ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
  fs.writeFileSync(manifestPath, JSON.stringify(tampered))
  assert.equal(status({ home, hostDir }).hostInstalled, false)
})

test("installHost validates its required dependencies", () => {
  assert.throws(() => installHost({ hostDir: "/d", execPath: "/e" }), /hostScript/)
  assert.throws(() => installHost({ hostDir: "/d", hostScript: "/h" }), /execPath/)
  assert.throws(() => installHost({ execPath: "/e", hostScript: "/h" }), /hostDir/)
})

test("detectChrome returns a shape without throwing", () => {
  const probe = detectChrome(() => false)
  assert.equal(probe.installed, false)
  assert.equal(probe.appPath, null)
})
