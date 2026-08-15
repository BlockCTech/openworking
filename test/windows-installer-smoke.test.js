const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const { findUninstaller, requireUninstaller } = require("../scripts/windows-installer-smoke")

test("installer smoke finds the NSIS uninstaller", () => {
  const fileSystem = { readdirSync: () => ["OpenWorking.exe", "Uninstall OpenWorking.exe"] }
  assert.equal(findUninstaller("unused", fileSystem), "Uninstall OpenWorking.exe")
  assert.equal(
    requireUninstaller("C:\\Programs\\OpenWorking", fileSystem),
    path.join("C:\\Programs\\OpenWorking", "Uninstall OpenWorking.exe")
  )
})

test("installer smoke fails when the NSIS uninstaller is missing", () => {
  const fileSystem = { readdirSync: () => ["OpenWorking.exe"] }
  assert.throws(
    () => requireUninstaller("C:\\Programs\\OpenWorking", fileSystem),
    /NSIS uninstaller was not found/
  )
})
