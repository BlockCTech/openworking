const test = require("node:test")
const assert = require("node:assert/strict")
const {
  V2_PROVIDER_PACKAGE,
  assertValidV2Config,
  fromV2Permissions,
  toV2Config,
  toV2Model,
  toV2Permissions,
  toV2Provider,
  validateV2Config
} = require("../src/opencode-config-v2")
const { DEFAULT_CONFIG } = require("../src/opencode-config")

// The provider package string below is the one verified end-to-end against the real gateway:
// a prompt sent through a config built by toV2Config reached the model and it replied.
test("the real DEFAULT_CONFIG translates into a valid v2 config", () => {
  const v2 = toV2Config(DEFAULT_CONFIG)
  assert.deepEqual(validateV2Config(v2), [])

  assert.equal(v2.providers.gateway.package, V2_PROVIDER_PACKAGE)
  assert.equal(
    v2.providers.gateway.settings.baseURL,
    DEFAULT_CONFIG.provider.gateway.options.baseURL
  )
  const model = v2.providers.gateway.models["gpt-4o-mini"]
  assert.equal(model.modelID, "gpt-4o-mini")
  assert.deepEqual(model.capabilities.input, ["text", "image", "pdf"])
  assert.equal(model.capabilities.tools, true)
  // v2 has no `options`; allowed non-protocol request extensions belong in `body`.
  assert.deepEqual(model.body, { max_completion_tokens: 32000, include_reasoning: true })
  assert.deepEqual(model.compatibility, {
    maxTokensField: "max_completion_tokens",
    reasoningField: "reasoning"
  })
  assert.deepEqual(model.variants, [
    { id: "medium", settings: { reasoningEffort: "medium" } },
    { id: "high", settings: { reasoningEffort: "high" } },
    { id: "xhigh", settings: { reasoningEffort: "xhigh" } }
  ])
  assert.equal(model.options, undefined)
  assert.equal(model.modalities, undefined)

  assert.equal(v2.agents.build.system, DEFAULT_CONFIG.agent.build.prompt)
  assert.equal(v2.agents.build.prompt, undefined)

  // None of the v1 top-level keys may survive translation.
  for (const key of ["provider", "permission", "agent", "plugin"]) {
    assert.equal(v2[key], undefined, `${key} must not appear in a v2 config`)
  }
})

// The local-first product boundary forbids sharing session content with a remote service.
// Relying on the upstream default would silently change behaviour if that default moved.
test("share is pinned to disabled rather than left to the upstream default", () => {
  assert.equal(toV2Config({}).share, "disabled")
  assert.equal(toV2Config(DEFAULT_CONFIG).share, "disabled")
})

// This is the largest semantic change: v1 is a tool-keyed map, v2 an ordered array where the
// LAST matching rule wins, so emission order is load-bearing.
test("permission map becomes an ordered array with skills last", () => {
  const rules = toV2Permissions({
    edit: "ask",
    bash: "ask",
    backlog_update_issue: "ask",
    skill: { "translate-document": "allow", "skill-creator": "deny" }
  })
  assert.deepEqual(rules, [
    { action: "edit", resource: "*", effect: "ask" },
    { action: "shell", resource: "*", effect: "ask" },
    { action: "backlog_update_issue", resource: "*", effect: "ask" },
    { action: "skill", resource: "translate-document", effect: "allow" },
    { action: "skill", resource: "skill-creator", effect: "deny" }
  ])
  // Broad tool gates must precede the specific skill rules that need to override them.
  const lastTool = rules.findLastIndex((rule) => rule.action !== "skill")
  const firstSkill = rules.findIndex((rule) => rule.action === "skill")
  assert.ok(lastTool < firstSkill, "skill rules must come after global tool rules")
})

test("bash, task, write and patch are the renamed permission actions", () => {
  assert.deepEqual(toV2Permissions({ bash: "ask" }), [
    { action: "shell", resource: "*", effect: "ask" }
  ])
  assert.deepEqual(toV2Permissions({ task: "ask" }), [
    { action: "subagent", resource: "*", effect: "ask" }
  ])
  assert.deepEqual(toV2Permissions({ write: "allow" }), [
    { action: "edit", resource: "*", effect: "allow" }
  ])
  assert.deepEqual(toV2Permissions({ patch: "allow" }), [
    { action: "edit", resource: "*", effect: "allow" }
  ])
  assert.deepEqual(toV2Permissions({ edit: "allow" }), [
    { action: "edit", resource: "*", effect: "allow" }
  ])
})

test("permission translation round-trips back to the v1 map shape", () => {
  const v1 = { edit: "ask", bash: "ask", task: "deny", skill: { alpha: "allow" } }
  assert.deepEqual(fromV2Permissions(toV2Permissions(v1)), v1)
})

// write/patch both collapse into v2's single `edit` action. A naive inverse built from
// V2_PERMISSION_ACTION_BY_V1_TOOL by reversing [tool, action] pairs would let whichever of
// write/patch/edit is processed last in Object.entries win, silently mislabeling `edit` as
// `patch` (or `write`) when translating v2 permissions back to v1's tool-keyed shape.
test("edit is the canonical v1 spelling when translating a v2 edit rule back", () => {
  assert.deepEqual(fromV2Permissions([{ action: "edit", resource: "*", effect: "ask" }]), {
    edit: "ask",
    skill: {}
  })
})

test("malformed permission entries are skipped, never guessed at", () => {
  assert.deepEqual(toV2Permissions(null), [])
  assert.deepEqual(toV2Permissions({ edit: "maybe" }), [])
  assert.deepEqual(toV2Permissions({ edit: 42 }), [])
  assert.deepEqual(toV2Permissions({ skill: { a: "nope" } }), [])
  assert.deepEqual(fromV2Permissions("not-an-array"), { skill: {} })
})

test("mcp servers are regrouped and the enabled flag is inverted", () => {
  const v2 = toV2Config({
    mcp: {
      browser: { type: "local", command: ["node", "x.js"], enabled: true },
      backlog: { type: "local", command: ["npx", "y"], enabled: false }
    }
  })
  assert.equal(v2.mcp.servers.browser.disabled, false)
  assert.equal(v2.mcp.servers.backlog.disabled, true)
  assert.equal(v2.mcp.servers.browser.enabled, undefined)
  assert.deepEqual(v2.mcp.servers.browser.command, ["node", "x.js"])
})

// v2 defaults `codemode` to true, which stops MCP tools being sent as function schemas and
// publishes them as a Code Mode catalog instead. Models that cannot author `tools["x"].y()` calls
// then emit that syntax as plain text and no tool ever runs, so the migration pins it off to keep
// v1's flat `<server>_<tool>` behaviour.
test("mcp servers opt out of Code Mode so their tools stay function schemas", () => {
  const v2 = toV2Config({
    mcp: {
      browser: { type: "local", command: ["node", "x.js"], enabled: true },
      backlog: { type: "local", command: ["npx", "y"], enabled: false }
    }
  })
  assert.equal(v2.mcp.servers.browser.codemode, false)
  assert.equal(v2.mcp.servers.backlog.codemode, false)
})

test("an explicit codemode in the authoring config is preserved", () => {
  const v2 = toV2Config({
    mcp: { browser: { type: "local", command: ["node", "x.js"], enabled: true, codemode: true } }
  })
  assert.equal(v2.mcp.servers.browser.codemode, true)
})

test("a non-boolean codemode is rejected rather than silently re-enabling Code Mode", () => {
  const errors = validateV2Config({
    mcp: { servers: { browser: { type: "local", command: ["node", "x.js"], codemode: "false" } } }
  })
  assert.ok(errors.some((e) => e.includes("/mcp/servers/browser/codemode must be a boolean")))
  assert.deepEqual(
    validateV2Config({ mcp: { servers: { browser: { type: "local", command: ["n"], codemode: false } } } }),
    []
  )
})

test("agent field renames are applied", () => {
  const v2 = toV2Config({
    agent: { plan: { prompt: "p", disable: true, maxSteps: 7, description: "d" } }
  })
  assert.deepEqual(v2.agents.plan, {
    system: "p",
    disabled: true,
    steps: 7,
    description: "d"
  })
})

test("provider and model translation omits absent fields instead of inventing them", () => {
  assert.deepEqual(toV2Provider({}), { package: V2_PROVIDER_PACKAGE })
  assert.deepEqual(toV2Model("m1", {}), { modelID: "m1" })
  assert.deepEqual(toV2Model("m1", { tool_call: false }), {
    modelID: "m1",
    capabilities: { tools: false }
  })
  // An empty options object must not produce an empty body key.
  assert.equal(toV2Model("m1", { options: {} }).body, undefined)
})

test("model translation selects max_completion_tokens only when that option is configured", () => {
  assert.deepEqual(
    toV2Model("m1", { options: { max_completion_tokens: 32000 } }).compatibility,
    { maxTokensField: "max_completion_tokens" }
  )
  assert.equal(toV2Model("m1", { options: { include_reasoning: true } }).compatibility, undefined)
})

test("model translation merges managed wire fields with unrelated compatibility settings", () => {
  const model = toV2Model("m1", {
    compatibility: { supportsUsageInStreaming: false },
    interleaved: { field: "reasoning" },
    options: { max_completion_tokens: 32000 }
  })
  assert.deepEqual(model.compatibility, {
    supportsUsageInStreaming: false,
    maxTokensField: "max_completion_tokens",
    reasoningField: "reasoning"
  })
})

test("model translation never overlays protocol-owned request fields", () => {
  const model = toV2Model("m1", {
    options: {
      stream: true,
      temperature: 0.5,
      top_p: 0.9,
      tools: [{ type: "function" }],
      max_completion_tokens: 32000,
      include_reasoning: true,
      vendor_extension: "kept"
    }
  })
  assert.deepEqual(model.body, {
    max_completion_tokens: 32000,
    include_reasoning: true,
    vendor_extension: "kept"
  })
  assert.equal(toV2Model("m1", { options: { stream: true } }).body, undefined)
})

test("compaction fields are renamed and tail_turns is dropped", () => {
  const v2 = toV2Config({
    compaction: { auto: false, preserve_recent_tokens: 6000, reserved: 15000, tail_turns: 4 }
  })
  assert.deepEqual(v2.compaction, { auto: false, keep: { tokens: 6000 }, buffer: 15000 })
})

test("compaction is absent from v2 config when v1 never set it", () => {
  assert.equal(toV2Config({}).compaction, undefined)
})

test("toV2Config rejects non-object input", () => {
  assert.throws(() => toV2Config(null), /must be a JSON object/)
  assert.throws(() => toV2Config([]), /must be a JSON object/)
})

// --- validator -------------------------------------------------------------
// The validator exists to catch OUR bugs. It deliberately allows unknown keys: v2 itself
// tolerates them, and being stricter than the runtime would reject valid configs.

test("validator accepts unknown keys because the runtime tolerates them", () => {
  assert.deepEqual(validateV2Config({ some_future_v2_key: 123 }), [])
})

// v1 spellings are the likeliest mistake and the most dangerous: v2 ignores them silently,
// so the config "works" while the setting does nothing at all.
test("validator flags v1 spellings that v2 would silently ignore", () => {
  const errors = validateV2Config({
    provider: {},
    permission: {},
    agent: {},
    plugin: [],
    autoshare: true,
    attachment: {}
  })
  assert.ok(errors.some((e) => e.includes("/provider is v1-only; use providers")))
  assert.ok(errors.some((e) => e.includes("/permission is v1-only; use permissions")))
  assert.ok(errors.some((e) => e.includes("/agent is v1-only; use agents")))
  assert.ok(errors.some((e) => e.includes("/plugin is v1-only; use plugins")))
  assert.ok(errors.some((e) => e.includes("/autoshare is v1-only; use share")))
  // v1's `attachment` key has no v2 equivalent by that name at all — v2 calls it `media` — so a
  // config carrying the old spelling would silently lose every attachment setting it configured.
  assert.ok(errors.some((e) => e.includes("/attachment is v1-only; use media")))
})

test("validator flags v1 spellings nested inside providers and models", () => {
  const errors = validateV2Config({
    providers: {
      p: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: "http://x" },
        models: { m: { modelID: "m", modalities: {}, tool_call: true, options: {} } }
      }
    }
  })
  assert.ok(errors.some((e) => e.includes("/providers/p/npm is v1-only; use package")))
  assert.ok(errors.some((e) => e.includes("/providers/p/options is v1-only; use settings")))
  assert.ok(errors.some((e) => e.includes("modalities is v1-only; use capabilities")))
  assert.ok(errors.some((e) => e.includes("tool_call is v1-only; use capabilities.tools")))
  assert.ok(errors.some((e) => e.includes("models/m/options is v1-only; use body")))
})

test("validator checks the compatibility fields emitted by model translation", () => {
  const errors = validateV2Config({
    providers: {
      p: {
        models: {
          m: {
            modelID: "m",
            compatibility: { maxTokensField: "maxTokens", reasoningField: false }
          }
        }
      }
    }
  })
  assert.ok(errors.some((e) => e.includes("maxTokensField must be max_tokens or max_completion_tokens")))
  assert.ok(errors.some((e) => e.includes("reasoningField must be a string")))
})

test("validator flags v1 compaction spellings", () => {
  const errors = validateV2Config({
    compaction: { preserve_recent_tokens: 6000, reserved: 15000 }
  })
  assert.ok(errors.some((e) => e.includes("/compaction/preserve_recent_tokens is v1-only; use keep.tokens")))
  assert.ok(errors.some((e) => e.includes("/compaction/reserved is v1-only; use buffer")))
})

test("validator accepts the v2 compaction shape", () => {
  assert.deepEqual(validateV2Config({ compaction: { auto: true, keep: { tokens: 8000 }, buffer: 20000 } }), [])
})

test("validator rejects protocol-owned model body overlays before runtime", () => {
  const errors = validateV2Config({
    providers: {
      p: {
        models: {
          m: {
            modelID: "m",
            body: { stream: true, include_reasoning: true }
          }
        }
      }
    }
  })
  assert.ok(errors.some((e) => e.includes("/providers/p/models/m/body/stream is protocol-owned")))
  assert.equal(errors.some((e) => e.includes("include_reasoning")), false)
})

test("validator enforces the permission rule shape and effect enum", () => {
  const errors = validateV2Config({
    permissions: [
      { action: "edit", resource: "*", effect: "ask" },
      { action: "edit", resource: "*", effect: "maybe" },
      { action: "", resource: "*", effect: "allow" },
      "nope"
    ]
  })
  assert.ok(errors.some((e) => e.includes("/permissions/1/effect must be one of allow|ask|deny")))
  assert.ok(errors.some((e) => e.includes("/permissions/2/action must be a non-empty string")))
  assert.ok(errors.some((e) => e.includes("/permissions/3 must be an object")))
  assert.equal(errors.some((e) => e.includes("/permissions/0")), false)
})

test("validator requires modelID and a valid share value", () => {
  assert.ok(
    validateV2Config({ providers: { p: { models: { m: {} } } } })
      .some((e) => e.includes("modelID is required"))
  )
  assert.ok(validateV2Config({ share: "everyone" }).some((e) => e.includes("/share must be one of")))
  assert.deepEqual(validateV2Config({ share: "disabled" }), [])
})

test("assertValidV2Config throws with every error joined", () => {
  assert.throws(() => assertValidV2Config({ provider: {}, share: "everyone" }), (error) => {
    assert.match(error.message, /^Invalid OpenCode v2 config: /)
    assert.match(error.message, /\/share must be one of/)
    assert.match(error.message, /\/provider is v1-only; use providers/)
    return true
  })
  assert.doesNotThrow(() => assertValidV2Config(toV2Config(DEFAULT_CONFIG)))
})
