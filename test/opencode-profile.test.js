const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const AdmZip = require("adm-zip")
const {
  BUILT_IN_SKILLS,
  ensureOpenworkingProfile,
  installCustomSkillArchive,
  listCustomSkills,
  readSkillMarkdown,
  uninstallCustomSkill,
  addMcpServer,
  updateMcpServer,
  listMcpServers,
  removeMcpServer,
  setMcpServerEnabled,
  syncBuiltInSkills,
  syncBuiltInTools,
  writeEditableProfileConfig,
  writeProfileConfig
} = require("../src/opencode-profile")

function createSkillArchive(temp, name, entries) {
  const archive = new AdmZip()
  for (const [entryName, contents] of Object.entries(entries)) {
    if (contents && typeof contents === "object" && contents.unsafeName) {
      archive.addFile(entryName, Buffer.from(contents.contents))
      archive.getEntry(entryName).entryName = contents.unsafeName
    } else {
      archive.addFile(entryName, Buffer.from(contents))
    }
  }
  const archivePath = path.join(temp, name)
  archive.writeZip(archivePath)
  return archivePath
}

test("bootstraps an isolated profile with the offline built-in skill bundle", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-profile-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  assert.equal(profile.profileDir, path.join(temp, "opencode-profile"))
  assert.equal(profile.configPath, path.join(profile.profileDir, "opencode.json"))
  assert.equal(profile.skills.skillsDir, path.join(profile.profileDir, "skills"))
  assert.equal(profile.tools.toolsDir, path.join(profile.profileDir, "tools"))
  assert.equal(fs.existsSync(path.join(profile.tools.toolsDir, "translate_document.js")), true)
  assert.equal(fs.existsSync(path.join(profile.tools.runtimeDir, "runtime.cjs")), true)
  assert.equal(fs.existsSync(path.join(profile.tools.runtimeDir, "schema.cjs")), true)
  assert.equal(fs.existsSync(path.join(profile.tools.runtimeDir, "pdfium.wasm")), true)
  assert.deepEqual(
    fs.readdirSync(profile.skills.skillsDir).sort(),
    BUILT_IN_SKILLS.map((skill) => skill.name).sort()
  )

  const config = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.deepEqual(config.plugin, [])
  for (const skill of BUILT_IN_SKILLS) {
    assert.equal(config.permission.skill[skill.name], "allow")
    assert.match(fs.readFileSync(path.join(profile.skills.skillsDir, skill.name, "SKILL.md"), "utf8"), new RegExp(`name: ${skill.name}`))
  }
})

test("tool sync is idempotent and preserves user custom tools", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-profile-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const wrapper = path.join(profile.tools.toolsDir, "translate_document.js")
  const custom = path.join(profile.tools.toolsDir, "custom_user_tool.js")
  fs.writeFileSync(custom, "export default {}\n")
  const manifestBefore = fs.statSync(profile.tools.manifestPath).mtimeMs
  const wrapperBefore = fs.statSync(wrapper).mtimeMs

  syncBuiltInTools(profile.profileDir)

  assert.equal(fs.statSync(profile.tools.manifestPath).mtimeMs, manifestBefore)
  assert.equal(fs.statSync(wrapper).mtimeMs, wrapperBefore)
  assert.equal(fs.readFileSync(custom, "utf8"), "export default {}\n")
})

test("sync is idempotent and skill permission deny is preserved", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-profile-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const manifestBefore = fs.statSync(profile.skills.manifestPath).mtimeMs
  const skillPath = path.join(profile.skills.skillsDir, BUILT_IN_SKILLS[0].name, "SKILL.md")
  const skillBefore = fs.statSync(skillPath).mtimeMs

  syncBuiltInSkills(profile.profileDir)
  assert.equal(fs.statSync(profile.skills.manifestPath).mtimeMs, manifestBefore)
  assert.equal(fs.statSync(skillPath).mtimeMs, skillBefore)

  const config = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  config.permission.skill["find-bugs"] = "deny"
  writeProfileConfig(profile, config)
  ensureOpenworkingProfile({ userDataPath: temp })
  const saved = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.equal(saved.permission.skill["find-bugs"], "deny")
})

test("migrates managed model defaults without replacing explicit capabilities", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-profile-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const config = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  const model = config.provider.gateway.models["gpt-4o-mini"]
  delete model.modalities
  delete model.limit
  delete model.reasoning
  delete model.temperature
  delete model.tool_call
  delete model.options
  fs.writeFileSync(profile.configPath, `${JSON.stringify(config, null, 2)}\n`)

  ensureOpenworkingProfile({ userDataPath: temp })
  const migrated = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  const migratedModel = migrated.provider.gateway.models["gpt-4o-mini"]
  assert.deepEqual(migratedModel.modalities, {
    input: ["text", "image", "pdf"],
    output: ["text"]
  })
  assert.deepEqual(migratedModel.limit, { context: 128000, output: 32000 })
  assert.equal(migratedModel.reasoning, true)
  assert.equal(migratedModel.temperature, true)
  assert.equal(migratedModel.tool_call, true)
  assert.deepEqual(migratedModel.options, {
    max_completion_tokens: 32000,
    reasoning_effort: "high",
    include_reasoning: true
  })

  migratedModel.modalities = {
    input: ["text"],
    output: ["text"]
  }
  migratedModel.limit = { context: 64000, output: 16000 }
  migratedModel.options.max_completion_tokens = 16000
  writeProfileConfig(profile, migrated)
  const saved = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  const savedModel = saved.provider.gateway.models["gpt-4o-mini"]
  assert.deepEqual(savedModel.modalities.input, ["text"])
  assert.deepEqual(savedModel.limit, { context: 64000, output: 16000 })
  assert.equal(savedModel.options.max_completion_tokens, 16000)
})

test("editable profile saves preserve locked provider and model fields", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-profile-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const edits = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  const provider = edits.provider.gateway
  const model = provider.models["gpt-4o-mini"]
  provider.npm = "malicious-package"
  provider.name = "Changed name"
  provider.options.baseURL = "https://example.test/v1"
  provider.options.apiKey = "custom-key"
  model.name = "changed-model"
  model.modalities.input = ["text"]
  model.modalities.output = ["image"]
  edits.provider.injected = { npm: "malicious-package", options: {}, models: {} }
  edits.plugin = ["local-plugin"]
  edits.permission.skill["find-bugs"] = "deny"

  writeEditableProfileConfig(profile, edits)

  const saved = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.equal(saved.provider.gateway.npm, "@ai-sdk/openai-compatible")
  assert.equal(saved.provider.gateway.name, "OpenAI-compatible Gateway")
  assert.equal(saved.provider.gateway.options.baseURL, "https://example.test/v1")
  assert.equal(saved.provider.gateway.options.apiKey, "custom-key")
  assert.equal(saved.provider.gateway.models["gpt-4o-mini"].name, "gpt-4o-mini")
  assert.deepEqual(saved.provider.gateway.models["gpt-4o-mini"].modalities, {
    input: ["text"],
    output: ["text"]
  })
  assert.equal(saved.provider.injected, undefined)
  assert.deepEqual(saved.plugin, ["local-plugin"])
  assert.equal(saved.permission.skill["find-bugs"], "deny")
})

test("bootstraps default agent prompts and preserves them across a config-screen save", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-profile-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  const bootstrapped = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.equal(typeof bootstrapped.agent.build.prompt, "string")
  assert.ok(bootstrapped.agent.build.prompt.length > 0)
  assert.equal(typeof bootstrapped.agent.plan.prompt, "string")
  assert.ok(bootstrapped.agent.plan.prompt.length > 0)

  // The Config screen only submits provider/plugin/skill edits; the agent block
  // must survive the save untouched.
  writeEditableProfileConfig(profile, { plugin: ["local-plugin"] })

  const saved = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.equal(saved.agent.build.prompt, bootstrapped.agent.build.prompt)
  assert.equal(saved.agent.plan.prompt, bootstrapped.agent.plan.prompt)
})

test("back-fills agent prompts into an existing profile on relaunch", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-profile-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  // Simulate a profile created before agent prompts existed.
  const legacy = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  delete legacy.agent
  fs.writeFileSync(profile.configPath, `${JSON.stringify(legacy, null, 2)}\n`)

  ensureOpenworkingProfile({ userDataPath: temp })

  const saved = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.equal(typeof saved.agent.build.prompt, "string")
  assert.ok(saved.agent.build.prompt.length > 0)
  assert.equal(typeof saved.agent.plan.prompt, "string")
  assert.ok(saved.agent.plan.prompt.length > 0)
})

test("sync replaces changed resource trees, removes retired managed skills and preserves custom skills", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-profile-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const sourceDir = path.join(temp, "bundle")
  fs.cpSync(profile.skills.sourceDir, sourceDir, { recursive: true })

  const reference = path.join("pdf", "references", "host-tools.md")
  const sourceReference = path.join(sourceDir, reference)
  const targetReference = path.join(profile.skills.skillsDir, reference)
  assert.equal(fs.readFileSync(targetReference, "utf8"), fs.readFileSync(sourceReference, "utf8"))

  fs.appendFileSync(sourceReference, "\nUse the narrowest available command.\n")
  fs.writeFileSync(path.join(profile.skills.skillsDir, "pdf", "obsolete.md"), "remove me\n")

  const customDir = path.join(profile.skills.skillsDir, "custom-skill")
  fs.mkdirSync(customDir)
  fs.writeFileSync(path.join(customDir, "SKILL.md"), "---\nname: custom-skill\ndescription: Keep this user skill\n---\n")

  const retiredDir = path.join(profile.skills.skillsDir, "retired-managed")
  fs.mkdirSync(retiredDir)
  fs.writeFileSync(path.join(retiredDir, "SKILL.md"), "---\nname: retired-managed\ndescription: Remove this retired skill\n---\n")
  const manifest = JSON.parse(fs.readFileSync(profile.skills.manifestPath, "utf8"))
  manifest.skills["retired-managed"] = "retired"
  fs.writeFileSync(profile.skills.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  syncBuiltInSkills(profile.profileDir, sourceDir)

  assert.equal(fs.readFileSync(targetReference, "utf8"), fs.readFileSync(sourceReference, "utf8"))
  assert.equal(fs.existsSync(path.join(profile.skills.skillsDir, "pdf", "obsolete.md")), false)
  assert.equal(fs.existsSync(customDir), true)
  assert.equal(fs.existsSync(retiredDir), false)
})

test("installs custom skill archive with root SKILL.md into the app profile", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-custom-skill-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const archivePath = createSkillArchive(temp, "root-skill.zip", {
    "SKILL.md": "---\nname: custom-root\ndescription: Custom root skill\n---\nUse this skill.\n",
    "references/details.md": "Reference text\n"
  })

  const result = installCustomSkillArchive(profile, archivePath)

  assert.equal(result.name, "custom-root")
  assert.equal(result.description, "Custom root skill")
  assert.equal(fs.readFileSync(path.join(profile.skills.skillsDir, "custom-root", "SKILL.md"), "utf8").includes("Use this skill."), true)
  assert.equal(fs.readFileSync(path.join(profile.skills.skillsDir, "custom-root", "references", "details.md"), "utf8"), "Reference text\n")
  const config = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.equal(config.permission.skill["custom-root"], "allow")
  assert.deepEqual(listCustomSkills(profile).map((skill) => skill.name), ["custom-root"])
})

test("installs custom skill archive with one top-level folder", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-custom-skill-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const archivePath = createSkillArchive(temp, "folder-skill.skill", {
    "folder-skill/SKILL.md": "---\nname: folder-skill\ndescription: Folder skill\n---\n",
    "folder-skill/references/details.md": "Reference text\n"
  })

  installCustomSkillArchive(profile, archivePath)

  assert.equal(fs.existsSync(path.join(profile.skills.skillsDir, "folder-skill", "SKILL.md")), true)
  assert.equal(fs.existsSync(path.join(profile.skills.skillsDir, "folder-skill", "references", "details.md")), true)
})

test("rejects invalid custom skill archives", () => {
  const cases = [
    {
      name: "missing-skill.zip",
      entries: { "README.md": "No skill\n" },
      message: /include a SKILL\.md/
    },
    {
      name: "missing-description.zip",
      entries: { "SKILL.md": "---\nname: missing-description\n---\n" },
      message: /include a description/
    },
    {
      name: "bad-name.zip",
      entries: { "SKILL.md": "---\nname: Bad_Name\ndescription: Bad name\n---\n" },
      message: /Skill name must use/
    },
    {
      name: "folder-mismatch.zip",
      entries: { "outer/SKILL.md": "---\nname: inner\ndescription: Mismatch\n---\n" },
      message: /folder name must match/
    },
    {
      name: "traversal.zip",
      entries: { "safe.md": { unsafeName: "../SKILL.md", contents: "---\nname: traversal\ndescription: Unsafe\n---\n" } },
      message: /Unsafe zip entry/
    },
    {
      name: "builtin.zip",
      entries: { "SKILL.md": "---\nname: pdf\ndescription: Duplicate built in\n---\n" },
      message: /built in/
    }
  ]

  for (const testCase of cases) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-custom-skill-"))
    const profile = ensureOpenworkingProfile({ userDataPath: temp })
    const archivePath = createSkillArchive(temp, testCase.name, testCase.entries)

    assert.throws(() => installCustomSkillArchive(profile, archivePath), testCase.message)
  }
})

test("rejects duplicate custom skill archives and preserves custom skills during built-in sync", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-custom-skill-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const archivePath = createSkillArchive(temp, "duplicate.zip", {
    "SKILL.md": "---\nname: duplicate-skill\ndescription: First install\n---\n"
  })

  installCustomSkillArchive(profile, archivePath)
  assert.throws(() => installCustomSkillArchive(profile, archivePath), /already exists/)

  syncBuiltInSkills(profile.profileDir)
  assert.equal(fs.existsSync(path.join(profile.skills.skillsDir, "duplicate-skill", "SKILL.md")), true)
})

test("reads SKILL.md for built-in and custom skills and rejects invalid names", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-skill-read-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const archivePath = createSkillArchive(temp, "readable.zip", {
    "SKILL.md": "---\nname: readable-skill\ndescription: Readable skill\n---\nBody text here.\n"
  })
  installCustomSkillArchive(profile, archivePath)

  const custom = readSkillMarkdown(profile, "readable-skill")
  assert.equal(custom.name, "readable-skill")
  assert.equal(custom.content.includes("Body text here."), true)

  const builtIn = readSkillMarkdown(profile, "pdf")
  assert.equal(builtIn.content.startsWith("---"), true)

  assert.throws(() => readSkillMarkdown(profile, "../escape"), /Skill name must use/)
  assert.throws(() => readSkillMarkdown(profile, "not-installed"), /no SKILL\.md/)
})

test("uninstalls custom skills and refuses to remove built-ins", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-skill-uninstall-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const archivePath = createSkillArchive(temp, "removable.zip", {
    "SKILL.md": "---\nname: removable-skill\ndescription: Removable skill\n---\n"
  })
  installCustomSkillArchive(profile, archivePath)
  assert.equal(JSON.parse(fs.readFileSync(profile.configPath, "utf8")).permission.skill["removable-skill"], "allow")

  const result = uninstallCustomSkill(profile, "removable-skill")
  assert.equal(result.name, "removable-skill")
  assert.equal(fs.existsSync(path.join(profile.skills.skillsDir, "removable-skill")), false)
  assert.equal("removable-skill" in (JSON.parse(fs.readFileSync(profile.configPath, "utf8")).permission?.skill || {}), false)

  assert.throws(() => uninstallCustomSkill(profile, "pdf"), /built in/)
  assert.throws(() => uninstallCustomSkill(profile, "removable-skill"), /not installed/)
})

test("installs HITL tool gates declared via askToolPermissions and leaves other tools alone", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-skill-ask-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const archivePath = createSkillArchive(temp, "gated.zip", {
    "SKILL.md": "---\nname: gated-skill\ndescription: Gated skill\naskToolPermissions: backlog_add_issue, backlog_update_issue, backlog_add_issue_comment, backlog_delete_issue\n---\n"
  })

  installCustomSkillArchive(profile, archivePath)

  const config = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.equal(config.permission.skill["gated-skill"], "allow")
  assert.equal(config.permission.backlog_add_issue, "ask")
  assert.equal(config.permission.backlog_update_issue, "ask")
  assert.equal(config.permission.backlog_add_issue_comment, "ask")
  assert.equal(config.permission.backlog_delete_issue, "ask")
  // Read tools are never gated.
  assert.equal("backlog_get_issue" in config.permission, false)
  assert.equal("backlog_get_project" in config.permission, false)
})

test("skills without askToolPermissions add no tool gates", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-skill-noask-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const archivePath = createSkillArchive(temp, "plain.zip", {
    "SKILL.md": "---\nname: plain-skill\ndescription: Plain skill\n---\n"
  })

  installCustomSkillArchive(profile, archivePath)

  const config = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.equal(config.permission.skill["plain-skill"], "allow")
  // A skill that declares no askToolPermissions must not add any MCP tool gates.
  const backlogKeys = Object.keys(config.permission).filter((key) => key.startsWith("backlog_"))
  assert.deepEqual(backlogKeys, [])
})

test("uninstall removes HITL tool gates but respects user overrides", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-skill-ask-clean-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })
  const archivePath = createSkillArchive(temp, "gated.zip", {
    "SKILL.md": "---\nname: gated-skill\ndescription: Gated skill\naskToolPermissions: backlog_add_issue, backlog_update_issue, backlog_delete_issue\n---\n"
  })
  installCustomSkillArchive(profile, archivePath)

  // User deliberately changes one gate to "allow" — that choice must survive uninstall.
  const edited = readProfileConfigForTest(profile)
  edited.permission.backlog_update_issue = "allow"
  writeProfileConfig(profile, edited)

  uninstallCustomSkill(profile, "gated-skill")

  const config = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.equal("backlog_add_issue" in config.permission, false)
  assert.equal("backlog_delete_issue" in config.permission, false)
  // The user-overridden key is preserved.
  assert.equal(config.permission.backlog_update_issue, "allow")
  assert.equal("gated-skill" in (config.permission.skill || {}), false)
})

function readProfileConfigForTest(profile) {
  return JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
}

test("adds a remote MCP server and round-trips through listMcpServers", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-mcp-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  const added = addMcpServer(profile, {
    name: "sentry-mcp",
    type: "remote",
    url: "https://mcp.sentry.dev/mcp",
    oauth: true,
    headers: { "X-Foo": "bar", "": "ignored" }
  })

  assert.equal(added.name, "sentry-mcp")
  assert.equal(added.type, "remote")
  assert.equal(added.enabled, true)

  const saved = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.deepEqual(saved.mcp["sentry-mcp"], {
    type: "remote",
    url: "https://mcp.sentry.dev/mcp",
    enabled: true,
    headers: { "X-Foo": "bar" }
  })
  // OAuth checked → `oauth` omitted so the runtime auto-detects.
  assert.equal("oauth" in saved.mcp["sentry-mcp"], false)

  const listed = listMcpServers(profile)
  assert.deepEqual(listed.map((server) => server.name), ["sentry-mcp"])
  assert.deepEqual(listed[0].headers, { "X-Foo": "bar" })
})

test("disables OAuth auto-detection when the checkbox is unchecked", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-mcp-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  addMcpServer(profile, { name: "no-oauth", type: "remote", url: "https://example.test/mcp", oauth: false })

  const saved = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.equal(saved.mcp["no-oauth"].oauth, false)
  assert.equal("headers" in saved.mcp["no-oauth"], false)
})

test("adds a local MCP server and splits the command into an array", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-mcp-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  const added = addMcpServer(profile, { name: "my-local", type: "local", command: "npx  -y   some-mcp-server" })
  assert.deepEqual(added.command, ["npx", "-y", "some-mcp-server"])

  const saved = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.deepEqual(saved.mcp["my-local"], {
    type: "local",
    command: ["npx", "-y", "some-mcp-server"],
    enabled: true
  })
})

test("adds a local MCP server with environment variables and round-trips them", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-mcp-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  const added = addMcpServer(profile, {
    name: "backlog",
    type: "local",
    command: "npx backlog-mcp-server",
    environment: { BACKLOG_DOMAIN: "example.backlog.com", BACKLOG_API_KEY: "secret-key", BLANK_KEY: "" }
  })
  assert.deepEqual(added.command, ["npx", "backlog-mcp-server"])
  assert.deepEqual(added.environment, {
    BACKLOG_DOMAIN: "example.backlog.com",
    BACKLOG_API_KEY: "secret-key",
    BLANK_KEY: ""
  })

  const saved = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.deepEqual(saved.mcp["backlog"], {
    type: "local",
    command: ["npx", "backlog-mcp-server"],
    enabled: true,
    environment: { BACKLOG_DOMAIN: "example.backlog.com", BACKLOG_API_KEY: "secret-key", BLANK_KEY: "" }
  })

  const listed = listMcpServers(profile).find((entry) => entry.name === "backlog")
  assert.deepEqual(listed.environment, {
    BACKLOG_DOMAIN: "example.backlog.com",
    BACKLOG_API_KEY: "secret-key",
    BLANK_KEY: ""
  })

  const updated = updateMcpServer(profile, "backlog", {
    type: "local",
    command: "npx backlog-mcp-server",
    environment: { BACKLOG_DOMAIN: "updated.backlog.com", BACKLOG_API_KEY: "new-key" }
  })
  assert.deepEqual(updated.environment, {
    BACKLOG_DOMAIN: "updated.backlog.com",
    BACKLOG_API_KEY: "new-key"
  })
})

test("omits the environment key for a local MCP server with no env vars", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-mcp-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  addMcpServer(profile, { name: "bare", type: "local", command: "npx some-server" })
  const saved = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.ok(!("environment" in saved.mcp["bare"]))
})

test("rejects invalid MCP server input", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-mcp-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  assert.throws(() => addMcpServer(profile, { name: "Bad_Name", type: "remote", url: "https://x.test" }), /name must use/)
  assert.throws(() => addMcpServer(profile, { name: "no-url", type: "remote", url: "  " }), /server URL/)
  assert.throws(() => addMcpServer(profile, { name: "no-cmd", type: "local", command: "   " }), /requires a command/)
  assert.throws(() => addMcpServer(profile, { name: "bad-type", type: "websocket", url: "https://x.test" }), /must be "remote" or "local"/)

  addMcpServer(profile, { name: "dupe", type: "remote", url: "https://x.test/mcp" })
  assert.throws(() => addMcpServer(profile, { name: "dupe", type: "remote", url: "https://y.test/mcp" }), /already exists/)
})

test("stores a pre-registered OAuth app and redacts the client secret in the view", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-mcp-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  const added = addMcpServer(profile, {
    name: "slack",
    type: "remote",
    url: "https://mcp.slack.com/mcp",
    oauth: { clientId: " client-123 ", clientSecret: " secret-xyz ", scope: "channels:read chat:write" }
  })

  // The view never exposes the raw secret — only a boolean flag.
  assert.deepEqual(added.oauth, {
    clientId: "client-123",
    scope: "channels:read chat:write",
    callbackPort: undefined,
    redirectUri: "",
    hasClientSecret: true
  })

  const saved = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.deepEqual(saved.mcp.slack.oauth, {
    clientId: "client-123",
    clientSecret: "secret-xyz",
    scope: "channels:read chat:write"
  })
})

test("validates the OAuth callback port", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-mcp-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  assert.throws(
    () => addMcpServer(profile, { name: "bad-port", type: "remote", url: "https://x.test/mcp", oauth: { clientId: "a", callbackPort: 70000 } }),
    /callback port/
  )
  const added = addMcpServer(profile, { name: "ok-port", type: "remote", url: "https://x.test/mcp", oauth: { clientId: "a", callbackPort: "20000" } })
  assert.equal(added.oauth.callbackPort, 20000)
})

test("updateMcpServer preserves the stored secret when left blank and rejects unknown names", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-mcp-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  addMcpServer(profile, {
    name: "slack",
    type: "remote",
    url: "https://mcp.slack.com/mcp",
    oauth: { clientId: "client-1", clientSecret: "secret-1", scope: "old:scope" }
  })
  setMcpServerEnabled(profile, "slack", false)

  // Edit scopes but leave the secret blank → the stored secret must survive, and the
  // enabled flag must be preserved.
  const updated = updateMcpServer(profile, "slack", {
    type: "remote",
    url: "https://mcp.slack.com/mcp",
    oauth: { clientId: "client-1", clientSecret: "", scope: "new:scope" }
  })
  assert.equal(updated.oauth.hasClientSecret, true)
  assert.equal(updated.enabled, false)

  const saved = JSON.parse(fs.readFileSync(profile.configPath, "utf8"))
  assert.equal(saved.mcp.slack.oauth.clientSecret, "secret-1")
  assert.equal(saved.mcp.slack.oauth.scope, "new:scope")
  assert.equal(saved.mcp.slack.enabled, false)

  assert.throws(() => updateMcpServer(profile, "ghost", { type: "remote", url: "https://x.test/mcp" }), /does not exist/)
})

test("toggles enabled and removes MCP servers", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-mcp-"))
  const profile = ensureOpenworkingProfile({ userDataPath: temp })

  addMcpServer(profile, { name: "toggle-me", type: "remote", url: "https://x.test/mcp" })

  setMcpServerEnabled(profile, "toggle-me", false)
  assert.equal(JSON.parse(fs.readFileSync(profile.configPath, "utf8")).mcp["toggle-me"].enabled, false)
  assert.equal(listMcpServers(profile)[0].enabled, false)

  setMcpServerEnabled(profile, "toggle-me", true)
  assert.equal(listMcpServers(profile)[0].enabled, true)

  const result = removeMcpServer(profile, "toggle-me")
  assert.equal(result.name, "toggle-me")
  assert.equal("toggle-me" in (JSON.parse(fs.readFileSync(profile.configPath, "utf8")).mcp || {}), false)

  assert.throws(() => setMcpServerEnabled(profile, "toggle-me", false), /does not exist/)
  assert.throws(() => removeMcpServer(profile, "toggle-me"), /does not exist/)
})
