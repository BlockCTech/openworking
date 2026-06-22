const test = require("node:test")
const assert = require("node:assert/strict")
const { spawnSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { BUILT_IN_SKILLS, ensureOpenworkingProfile } = require("../src/opencode-profile")

test("bundled opencode runtime discovers the offline skill bundle", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-skills-"))
  const userDataPath = path.join(temp, "user-data")
  const profile = ensureOpenworkingProfile({ userDataPath })
  const runtimePlatform = process.platform === "win32" ? "windows" : process.platform
  const executable = process.platform === "win32" ? "opencode.exe" : "opencode"
  const platformRuntime = path.join(__dirname, "..", "node_modules", `opencode-${runtimePlatform}-${process.arch}`, "bin", executable)
  const runtime = fs.existsSync(platformRuntime)
    ? platformRuntime
    : path.join(__dirname, "..", "node_modules", "opencode-ai", "bin", "opencode.exe")
  const inventoryPath = path.join(temp, "skills.json")
  const inventory = fs.openSync(inventoryPath, "w")
  const env = {
    ...process.env,
    HOME: path.join(temp, "home"),
    XDG_CONFIG_HOME: profile.xdgConfigHome,
    XDG_DATA_HOME: path.join(temp, "data"),
    XDG_STATE_HOME: path.join(temp, "state"),
    XDG_CACHE_HOME: path.join(temp, "cache"),
    OPENCODE_CONFIG: profile.configPath,
    OPENCODE_CONFIG_DIR: profile.profileDir
  }

  const result = spawnSync(runtime, ["debug", "skill"], { encoding: "utf8", env, stdio: ["ignore", inventory, "pipe"] })
  fs.closeSync(inventory)
  assert.equal(result.status, 0, result.stderr)
  const skills = JSON.parse(fs.readFileSync(inventoryPath, "utf8"))
  const names = new Set(skills.map((skill) => skill.name))
  for (const skill of BUILT_IN_SKILLS) assert.equal(names.has(skill.name), true, `missing ${skill.name}`)
})
