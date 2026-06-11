const test = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const { checkDesktopVersion, platformParam, parseMountPoint, installDmg, versionCheckConfigured } = require("../src/version-check")

// Spins up a local HTTP server that responds with `handler`, points the
// version-check at it via baseURL, runs the check, then tears the server down.
async function withServer(handler, run) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const baseURL = `http://127.0.0.1:${server.address().port}`
  try {
    return await run(baseURL)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function jsonHandler(statusCode, body) {
  return (req, res) => {
    res.writeHead(statusCode, { "Content-Type": "application/json" })
    res.end(body === undefined ? "" : JSON.stringify(body))
  }
}

test("maps process.platform to API platform values", () => {
  assert.equal(platformParam("darwin"), "macos")
  assert.equal(platformParam("win32"), "windows")
  assert.equal(platformParam("linux"), "linux")
  assert.equal(platformParam("freebsd"), null)
})

test("check is disabled when no version API base is configured", async () => {
  assert.equal(versionCheckConfigured(), false)
  const result = await checkDesktopVersion({ currentVersion: "1.0.0", platform: "darwin" })
  assert.equal(result.status, "ok")
  assert.equal(result.reason, "disabled")
})

test("unsupported platform fails open without a request", async () => {
  const result = await checkDesktopVersion({ currentVersion: "1.0.0", platform: "freebsd", baseURL: "http://127.0.0.1:1" })
  assert.equal(result.status, "ok")
  assert.equal(result.reason, "unsupported-platform")
})

test("update_required returns a force gate", async () => {
  await withServer(
    jsonHandler(200, {
      update_available: true,
      update_required: true,
      latest_version: "1.5.0",
      download_url: "https://example.com/GAC-1.5.0.dmg",
      release_notes: "Critical fixes"
    }),
    async (baseURL) => {
      const result = await checkDesktopVersion({ currentVersion: "1.0.0", platform: "darwin", baseURL })
      assert.equal(result.status, "force")
      assert.equal(result.latestVersion, "1.5.0")
      assert.equal(result.downloadUrl, "https://example.com/GAC-1.5.0.dmg")
      assert.equal(result.releaseNotes, "Critical fixes")
    }
  )
})

test("update_available without required returns a soft gate", async () => {
  await withServer(
    jsonHandler(200, {
      update_available: true,
      update_required: false,
      latest_version: "1.5.0",
      download_url: "https://example.com/GAC-1.5.0.dmg"
    }),
    async (baseURL) => {
      const result = await checkDesktopVersion({ currentVersion: "1.4.0", platform: "darwin", baseURL })
      assert.equal(result.status, "soft")
      assert.equal(result.latestVersion, "1.5.0")
    }
  )
})

test("x64 prefers the intel download URL", async () => {
  await withServer(
    jsonHandler(200, {
      update_available: true,
      update_required: false,
      latest_version: "1.4.2",
      download_url: "https://example.com/app-1.4.2-arm64.dmg",
      download_url_intel: "https://example.com/app-1.4.2-x64.dmg"
    }),
    async (baseURL) => {
      const result = await checkDesktopVersion({
        currentVersion: "1.4.0",
        platform: "darwin",
        arch: "x64",
        baseURL
      })
      assert.equal(result.status, "soft")
      assert.equal(result.downloadUrl, "https://example.com/app-1.4.2-x64.dmg")
    }
  )
})

test("x64 falls back to the default URL when no intel URL is present", async () => {
  await withServer(
    jsonHandler(200, {
      update_available: true,
      update_required: false,
      latest_version: "1.4.2",
      download_url: "https://example.com/app-1.4.2-arm64.dmg"
    }),
    async (baseURL) => {
      const result = await checkDesktopVersion({
        currentVersion: "1.4.0",
        platform: "darwin",
        arch: "x64",
        baseURL
      })
      assert.equal(result.downloadUrl, "https://example.com/app-1.4.2-arm64.dmg")
    }
  )
})

test("arm64 uses the default URL and never the intel one", async () => {
  await withServer(
    jsonHandler(200, {
      update_available: true,
      update_required: false,
      latest_version: "1.4.2",
      download_url: "https://example.com/app-1.4.2-arm64.dmg",
      download_url_intel: "https://example.com/app-1.4.2-x64.dmg"
    }),
    async (baseURL) => {
      const result = await checkDesktopVersion({
        currentVersion: "1.4.0",
        platform: "darwin",
        arch: "arm64",
        baseURL
      })
      assert.equal(result.downloadUrl, "https://example.com/app-1.4.2-arm64.dmg")
    }
  )
})

test("up to date returns ok", async () => {
  await withServer(
    jsonHandler(200, { update_available: false, update_required: false, latest_version: "1.5.0" }),
    async (baseURL) => {
      const result = await checkDesktopVersion({ currentVersion: "1.5.0", platform: "darwin", baseURL })
      assert.equal(result.status, "ok")
    }
  )
})

test("404 (not configured) fails open", async () => {
  await withServer(jsonHandler(404, { detail: "No version info available" }), async (baseURL) => {
    const result = await checkDesktopVersion({ currentVersion: "1.0.0", platform: "darwin", baseURL })
    assert.equal(result.status, "ok")
    assert.equal(result.reason, "not-configured")
  })
})

test("5xx fails open", async () => {
  await withServer(jsonHandler(503, { detail: "down" }), async (baseURL) => {
    const result = await checkDesktopVersion({ currentVersion: "1.0.0", platform: "darwin", baseURL })
    assert.equal(result.status, "ok")
    assert.equal(result.reason, "error")
  })
})

test("network error fails open", async () => {
  // Nothing is listening on this port; the request should error and fail open.
  const result = await checkDesktopVersion({
    currentVersion: "1.0.0",
    platform: "darwin",
    baseURL: "http://127.0.0.1:1"
  })
  assert.equal(result.status, "ok")
  assert.equal(result.reason, "error")
})

test("sends current_version and platform query params", async () => {
  await withServer(
    (req, res) => {
      const url = new URL(req.url, "http://127.0.0.1")
      assert.equal(url.pathname, "/api/v1/desktop-app/version")
      assert.equal(url.searchParams.get("platform"), "macos")
      assert.equal(url.searchParams.get("current_version"), "2.3.4")
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ update_available: false, update_required: false }))
    },
    async (baseURL) => {
      await checkDesktopVersion({ currentVersion: "2.3.4", platform: "darwin", baseURL })
    }
  )
})

test("parseMountPoint reads the mount point from hdiutil output", () => {
  const stdout = [
    "/dev/disk4          \tGUID_partition_scheme           \t",
    "/dev/disk4s1        \tApple_HFS                       \t/tmp/dmg.AbCdEf",
    ""
  ].join("\n")
  assert.equal(parseMountPoint(stdout), "/tmp/dmg.AbCdEf")
})

test("parseMountPoint returns null when no mount point is present", () => {
  assert.equal(parseMountPoint("/dev/disk4\tGUID_partition_scheme\t"), null)
  assert.equal(parseMountPoint(""), null)
})

// installDmg shells out to hdiutil/ditto, so we inject a fake exec that records
// the calls and a fake fs. These only run on darwin (the supported platform).
const darwinOnly = process.platform === "darwin" ? test : test.skip

darwinOnly("installDmg mounts, dittos the .app, detaches and removes the dmg", () => {
  const calls = []
  const exec = (cmd, args) => {
    calls.push([cmd, ...args])
    if (cmd === "hdiutil" && args[0] === "attach") {
      return "/dev/disk5s1\tApple_HFS\t/tmp/dmg.XyZ123\n"
    }
    return ""
  }
  let removed = null
  const fileSystem = {
    readdirSync: () => ["OpenWorking.app", "Applications"],
    rmSync: (p) => {
      removed = p
    }
  }

  installDmg({ dmgPath: "/tmp/update.dmg", appBundlePath: "/Applications/OpenWorking.app", exec, fileSystem })

  assert.deepEqual(calls[0], ["hdiutil", "attach", "/tmp/update.dmg", "-nobrowse", "-noautoopen", "-mountrandom", "/tmp"])
  assert.deepEqual(calls[1], ["ditto", "/tmp/dmg.XyZ123/OpenWorking.app", "/Applications/OpenWorking.app"])
  assert.deepEqual(calls[2], ["hdiutil", "detach", "/tmp/dmg.XyZ123", "-force"])
  assert.equal(removed, "/tmp/update.dmg")
})

darwinOnly("installDmg throws and keeps the dmg when no .app is found", () => {
  const exec = (cmd, args) =>
    cmd === "hdiutil" && args[0] === "attach" ? "/dev/disk5s1\tApple_HFS\t/tmp/dmg.Empty\n" : ""
  let removed = false
  const fileSystem = {
    readdirSync: () => ["ReadMe.txt"],
    rmSync: () => {
      removed = true
    }
  }

  assert.throws(
    () => installDmg({ dmgPath: "/tmp/update.dmg", appBundlePath: "/Applications/App.app", exec, fileSystem }),
    /No \.app bundle/
  )
  // The dmg must survive so the caller can fall back to opening it manually.
  assert.equal(removed, false)
})

darwinOnly("installDmg detaches even when ditto fails", () => {
  const calls = []
  const exec = (cmd, args) => {
    calls.push(cmd === "ditto" ? "ditto" : `${cmd} ${args[0]}`)
    if (cmd === "hdiutil" && args[0] === "attach") return "/dev/disk5s1\tApple_HFS\t/tmp/dmg.Fail\n"
    if (cmd === "ditto") throw new Error("Operation not permitted")
    return ""
  }
  const fileSystem = { readdirSync: () => ["App.app"], rmSync: () => {} }

  assert.throws(
    () => installDmg({ dmgPath: "/tmp/update.dmg", appBundlePath: "/Applications/App.app", exec, fileSystem }),
    /Operation not permitted/
  )
  assert.ok(calls.includes("hdiutil detach"), "should still detach the mounted image")
})
