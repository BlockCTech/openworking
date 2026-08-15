// OpenCode **v2** config: shape translation + validation.
//
// Kept in its own module rather than branching inside opencode-config.js because the two
// vocabularies barely overlap, and because the authoring v1 config must remain stable
// while the runtime copy is translated for OpenCode v2.
//
// Why a hand-written validator instead of Ajv + a schema, as v1 uses:
//   - Upstream publishes NO v2 config schema. Verified against a running opencode2: /schema.json,
//     /config.json and /api/config/schema all 404, the OpenAPI document holds 347 component
//     schemas and not one of them is a Config, and nothing schema-shaped ships in the npm package.
//   - The bundled v1 Ajv schema actively rejects v2. Running the real validator on a v2 config
//     produced: "/providers must NOT have additional properties; /permissions …; /agents …;
//     /plugins must NOT have additional properties" — it would block every write.
//   - v2 itself tolerates unknown keys (a junk key still loaded the rest of the config fine),
//     so a strict full-surface schema would be stricter than the runtime and reject valid input.
// The validator below therefore checks only the keys WE write, and deliberately allows any other
// key through. It is a guard against our own bugs, not a model of the entire v2 config surface.
//
// Evidence: .agents/evidence/v2-openapi-0.0.0-next-16350.json, .agents/evidence/v2-real-llm-stream.jsonl
// Plan: .agents/plans/2026-07-28-opencode-v2-migration.md

const { V2_CONTRACT } = require("./runtime/runtime-contract")

// Verified working end-to-end: a real prompt through this provider shape reached the gateway
// and the model replied. The alternative documented spelling
// ("@opencode-ai/ai/providers/openai-compatible") is UNTESTED — do not swap without re-testing.
const V2_PROVIDER_PACKAGE = "aisdk:@ai-sdk/openai-compatible"

// v1 tool names -> v2 permission actions: `bash`->`shell`, `task`->`subagent`, `write`/`patch`
// collapse into v2's single `edit` action. Unknown/MCP tools pass through as-is, matching v2's
// `<server>_<tool>` action convention.
const V2_PERMISSION_ACTION_BY_V1_TOOL = { bash: "shell", task: "subagent", write: "edit", patch: "edit", edit: "edit" }

// Inverse of the map above, kept separate rather than derived: `write` and `patch` both map to
// `edit`, so a naive `new Map(entries.map(reverse))` would make the last one processed win and
// silently mislabel `edit` as `patch` when translating v2 permissions back to v1's tool-keyed
// shape. `edit` is the canonical v1 spelling for that action.
const V1_TOOL_BY_V2_ACTION = { shell: "bash", subagent: "task", edit: "edit" }

const V2_PERMISSION_EFFECTS = new Set(["allow", "ask", "deny"])

function clone(value) {
  return structuredClone(value)
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function v2PermissionAction(v1Tool) {
  return V2_PERMISSION_ACTION_BY_V1_TOOL[v1Tool] || v1Tool
}

// Translate v1's tool-keyed permission MAP into v2's ordered permission ARRAY.
//
// This is the largest semantic change in the migration, not a rename. In v2 the LAST matching
// rule wins, so emission order is load-bearing: broad rules first, specific ones after. We emit
//   1. global tool gates  (edit/shell/…)   - broadest
//   2. per-skill rules    (action "skill")  - specific, must be able to override the above
// Anything the caller passes in an unexpected shape is skipped rather than guessed at.
function toV2Permissions(v1Permission) {
  if (!isPlainObject(v1Permission)) return []
  const rules = []
  for (const [key, value] of Object.entries(v1Permission)) {
    if (key === "skill") continue
    if (typeof value !== "string" || !V2_PERMISSION_EFFECTS.has(value)) continue
    rules.push({ action: v2PermissionAction(key), resource: "*", effect: value })
  }
  const skills = v1Permission.skill
  if (isPlainObject(skills)) {
    for (const [name, effect] of Object.entries(skills)) {
      if (typeof effect !== "string" || !V2_PERMISSION_EFFECTS.has(effect)) continue
      rules.push({ action: "skill", resource: name, effect })
    }
  }
  return rules
}

// Inverse of toV2Permissions, so the settings UI and skill install/uninstall can keep reasoning
// in the v1 map shape they already use (see ensureSkillPermissions in opencode-profile.js, which
// does `Object.hasOwn` membership tests that have no array equivalent).
function fromV2Permissions(v2Permissions) {
  const permission = { skill: {} }
  if (!Array.isArray(v2Permissions)) return permission
  for (const rule of v2Permissions) {
    if (!isPlainObject(rule)) continue
    const { action, resource, effect } = rule
    if (typeof action !== "string" || !V2_PERMISSION_EFFECTS.has(effect)) continue
    if (action === "skill") {
      if (typeof resource === "string" && resource) permission.skill[resource] = effect
      continue
    }
    permission[V1_TOOL_BY_V2_ACTION[action] || action] = effect
  }
  return permission
}

// v1 model -> v2 model. v2 has no `options`: the overlay slots are settings/headers/body, and
// non-protocol request extensions belong in `body` (confirmed — Model.Info exposes
// settings/headers/body and no options key). `modalities` becomes
// `capabilities.input/output`, `tool_call` becomes `capabilities.tools`; `limit` is unchanged.
function toV2Model(modelId, v1Model) {
  const model = { modelID: modelId }
  if (!isPlainObject(v1Model)) return model
  if (typeof v1Model.name === "string") model.name = v1Model.name
  const capabilities = {}
  if (v1Model.tool_call !== undefined) capabilities.tools = Boolean(v1Model.tool_call)
  if (isPlainObject(v1Model.modalities)) {
    if (Array.isArray(v1Model.modalities.input)) capabilities.input = [...v1Model.modalities.input]
    if (Array.isArray(v1Model.modalities.output)) capabilities.output = [...v1Model.modalities.output]
  }
  if (Object.keys(capabilities).length) model.capabilities = capabilities
  if (isPlainObject(v1Model.limit)) model.limit = clone(v1Model.limit)
  if (isPlainObject(v1Model.options) && Object.keys(v1Model.options).length) {
    const body = toV2RequestBody(v1Model.options)
    if (Object.keys(body).length) model.body = body
  }
  const compatibility = isPlainObject(v1Model.compatibility) ? clone(v1Model.compatibility) : {}
  if (
    isPlainObject(v1Model.options) &&
    Object.hasOwn(v1Model.options, "max_completion_tokens") &&
    compatibility.maxTokensField === undefined
  ) {
    compatibility.maxTokensField = "max_completion_tokens"
  }
  if (isPlainObject(v1Model.interleaved) && typeof v1Model.interleaved.field === "string") {
    compatibility.reasoningField = v1Model.interleaved.field
  }
  if (Object.keys(compatibility).length) model.compatibility = compatibility
  if (isPlainObject(v1Model.variants)) {
    model.variants = Object.entries(v1Model.variants)
      .filter(([id, variant]) => id && isPlainObject(variant))
      .map(([id, variant]) => ({ id, settings: clone(variant) }))
  }
  return model
}

// v1 stores the reasoning knob as camelCase `reasoningEffort` and the v1 provider SDK renames it
// to the OpenAI-compatible `reasoning_effort` before it reaches the wire. v2's `body` is a raw
// request overlay with no such normalization, so the camelCase spelling would be sent verbatim
// and the gateway would ignore it. Verified by capturing the real HTTP body in
// test/opencode-reasoning-wire.test.js.
const V2_BODY_KEY_BY_V1_OPTION = { reasoningEffort: "reasoning_effort", includeReasoning: "include_reasoning" }

// OpenCode v2 rejects these before making an HTTP request because its protocol layer owns them.
// Keep this in sync with PROTOCOL_BODY_OVERLAY_DENYLIST in the bundled v2 runtime. Old managed
// profiles can contain fields such as `stream: true`; they remain untouched in the authoring
// config but must never be copied into the runtime's model.body overlay.
const V2_PROTOCOL_BODY_OVERLAY_DENYLIST = new Set([
  "anthropic_version",
  "content",
  "contents",
  "frequencyPenalty",
  "frequency_penalty",
  "generationConfig",
  "inferenceConfig",
  "input",
  "maxTokens",
  "max_tokens",
  "messages",
  "model",
  "presencePenalty",
  "presence_penalty",
  "responseFormat",
  "response_format",
  "seed",
  "stop",
  "stopSequences",
  "stop_sequences",
  "stream",
  "streamOptions",
  "stream_options",
  "system",
  "systemInstruction",
  "system_instruction",
  "temperature",
  "thinking",
  "toolChoice",
  "toolConfig",
  "tool_choice",
  "tool_config",
  "tools",
  "topK",
  "topP",
  "top_k",
  "top_p"
])

function toV2RequestBody(v1Options) {
  const body = {}
  for (const [key, value] of Object.entries(v1Options)) {
    const bodyKey = V2_BODY_KEY_BY_V1_OPTION[key] || key
    if (V2_PROTOCOL_BODY_OVERLAY_DENYLIST.has(bodyKey)) continue
    body[bodyKey] = clone(value)
  }
  return body
}

// v1 provider -> v2 provider: `npm` -> `package`, `options` -> `settings`.
function toV2Provider(v1Provider) {
  const provider = { package: V2_PROVIDER_PACKAGE }
  if (!isPlainObject(v1Provider)) return provider
  if (typeof v1Provider.name === "string") provider.name = v1Provider.name
  const options = isPlainObject(v1Provider.options) ? v1Provider.options : {}
  const settings = {}
  if (typeof options.baseURL === "string") settings.baseURL = options.baseURL
  if (typeof options.apiKey === "string") settings.apiKey = options.apiKey
  if (Object.keys(settings).length) provider.settings = settings
  if (isPlainObject(v1Provider.models)) {
    provider.models = {}
    for (const [id, model] of Object.entries(v1Provider.models)) {
      provider.models[id] = toV2Model(id, model)
    }
  }
  return provider
}

// v1 `compaction.preserve_recent_tokens` -> v2 `compaction.keep.tokens`, `reserved` -> `buffer`.
// `tail_turns` has no v2 equivalent and is dropped rather than guessed at.
function toV2Compaction(v1Compaction) {
  if (!isPlainObject(v1Compaction)) return undefined
  const compaction = {}
  if (typeof v1Compaction.auto === "boolean") compaction.auto = v1Compaction.auto
  if (typeof v1Compaction.preserve_recent_tokens === "number") {
    compaction.keep = { tokens: v1Compaction.preserve_recent_tokens }
  }
  if (typeof v1Compaction.reserved === "number") compaction.buffer = v1Compaction.reserved
  return Object.keys(compaction).length ? compaction : undefined
}

// Translate a full v1 config into v2 shape.
//
// `share: "disabled"` is set explicitly rather than left to the default: the local-first product
// boundary forbids sharing session content with any remote service, and relying on an upstream
// default would silently change behaviour if that default ever moves.
function toV2Config(v1Config) {
  if (!isPlainObject(v1Config)) throw new Error("opencode config must be a JSON object.")
  const v2 = { share: "disabled" }

  if (isPlainObject(v1Config.provider)) {
    v2.providers = {}
    for (const [id, provider] of Object.entries(v1Config.provider)) {
      v2.providers[id] = toV2Provider(provider)
    }
  }

  const permissions = toV2Permissions(v1Config.permission)
  if (permissions.length) v2.permissions = permissions

  if (isPlainObject(v1Config.agent)) {
    v2.agents = {}
    for (const [name, agent] of Object.entries(v1Config.agent)) {
      const next = {}
      if (isPlainObject(agent)) {
        // `prompt` -> `system`; `disable` -> `disabled`; `maxSteps` -> `steps`.
        if (typeof agent.prompt === "string") next.system = agent.prompt
        if (typeof agent.system === "string") next.system = agent.system
        if (agent.disable !== undefined) next.disabled = Boolean(agent.disable)
        if (agent.maxSteps !== undefined) next.steps = agent.maxSteps
        if (typeof agent.description === "string") next.description = agent.description
        if (typeof agent.mode === "string") next.mode = agent.mode
      }
      v2.agents[name] = next
    }
  }

  // `plugin` -> `plugins`. v1 plugins do not run under v2 (the plugin API changed), so the list
  // is carried across for fidelity but is expected to be empty in practice.
  if (Array.isArray(v1Config.plugin)) v2.plugins = clone(v1Config.plugin)

  // `mcp.<name>` -> `mcp.servers.<name>`, with `enabled: true` inverted to `disabled: false`.
  //
  // `codemode: false` is pinned because v2 defaults it to TRUE, and that default silently breaks
  // MCP tool calling for every model that is not strong enough to write code. Under Code Mode an
  // MCP server's tools are NOT sent as function schemas at all; they are published in a catalog
  // the model is expected to drive by writing `tools["<server>"].<tool>(...)` inside the built-in
  // `execute` tool. Verified on the wire against the pinned runtime: with the default in force the
  // request carried only the 12 built-ins (which register themselves `codemode: false`) and none
  // of the ~135 connected MCP tools, so google/gemma-4-31B-it answered with the catalog syntax as
  // plain TEXT — `<|tool_call>call:tools["mcp-memory"].get_usage_guide{}<tool_call|>` — which ends
  // the turn with finish `stop` and runs no tool.
  //
  // v1 had no such mode: its MCP tools were always flat `<server>_<tool>` function schemas. Pinning
  // false is therefore what preserves v1 behaviour across the migration, not a new opinion. An
  // explicit `codemode` in the authoring config still wins, so opting back in stays possible.
  if (isPlainObject(v1Config.mcp)) {
    const servers = {}
    for (const [name, server] of Object.entries(v1Config.mcp)) {
      if (!isPlainObject(server)) continue
      const next = clone(server)
      if (Object.hasOwn(next, "enabled")) {
        next.disabled = !next.enabled
        delete next.enabled
      }
      if (!Object.hasOwn(next, "codemode")) next.codemode = false
      servers[name] = next
    }
    v2.mcp = { servers }
  }

  // Unchanged keys, copied only when present.
  if (v1Config.instructions !== undefined) v2.instructions = clone(v1Config.instructions)
  if (typeof v1Config.model === "string") v2.model = v1Config.model

  const compaction = toV2Compaction(v1Config.compaction)
  if (compaction) v2.compaction = compaction

  return v2
}

// Minimal validation: only the keys we write. Unknown keys are allowed on purpose — the runtime
// tolerates them, and rejecting them would make us stricter than the server we are configuring.
function validateV2Config(config) {
  const errors = []
  if (!isPlainObject(config)) return ["config must be a JSON object"]

  if (config.share !== undefined && !["manual", "auto", "disabled"].includes(config.share)) {
    errors.push(`/share must be one of manual|auto|disabled, got ${JSON.stringify(config.share)}`)
  }

  if (config.providers !== undefined) {
    if (!isPlainObject(config.providers)) errors.push("/providers must be an object")
    else {
      for (const [id, provider] of Object.entries(config.providers)) {
        if (!isPlainObject(provider)) { errors.push(`/providers/${id} must be an object`); continue }
        if (provider.package !== undefined && typeof provider.package !== "string") {
          errors.push(`/providers/${id}/package must be a string`)
        }
        if (provider.settings !== undefined && !isPlainObject(provider.settings)) {
          errors.push(`/providers/${id}/settings must be an object`)
        }
        // v1 spellings are the likeliest bug: they validate as "unknown keys" but silently do nothing.
        if (provider.npm !== undefined) errors.push(`/providers/${id}/npm is v1-only; use package`)
        if (provider.options !== undefined) errors.push(`/providers/${id}/options is v1-only; use settings`)
        if (provider.models !== undefined) {
          if (!isPlainObject(provider.models)) errors.push(`/providers/${id}/models must be an object`)
          else {
            for (const [modelId, model] of Object.entries(provider.models)) {
              const at = `/providers/${id}/models/${modelId}`
              if (!isPlainObject(model)) { errors.push(`${at} must be an object`); continue }
              if (typeof model.modelID !== "string" || !model.modelID) {
                errors.push(`${at}/modelID is required and must be a non-empty string`)
              }
              if (model.capabilities !== undefined && !isPlainObject(model.capabilities)) {
                errors.push(`${at}/capabilities must be an object`)
              }
              if (model.modalities !== undefined) errors.push(`${at}/modalities is v1-only; use capabilities`)
              if (model.tool_call !== undefined) errors.push(`${at}/tool_call is v1-only; use capabilities.tools`)
              if (model.options !== undefined) errors.push(`${at}/options is v1-only; use body`)
              if (model.compatibility !== undefined) {
                if (!isPlainObject(model.compatibility)) {
                  errors.push(`${at}/compatibility must be an object`)
                } else {
                  if (
                    model.compatibility.maxTokensField !== undefined &&
                    !["max_tokens", "max_completion_tokens"].includes(model.compatibility.maxTokensField)
                  ) {
                    errors.push(`${at}/compatibility/maxTokensField must be max_tokens or max_completion_tokens`)
                  }
                  if (
                    model.compatibility.reasoningField !== undefined &&
                    typeof model.compatibility.reasoningField !== "string"
                  ) {
                    errors.push(`${at}/compatibility/reasoningField must be a string`)
                  }
                }
              }
              if (model.body !== undefined) {
                if (!isPlainObject(model.body)) errors.push(`${at}/body must be an object`)
                else {
                  for (const key of Object.keys(model.body)) {
                    if (V2_PROTOCOL_BODY_OVERLAY_DENYLIST.has(key)) {
                      errors.push(`${at}/body/${key} is protocol-owned and cannot be overlaid`)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (config.permissions !== undefined) {
    if (!Array.isArray(config.permissions)) errors.push("/permissions must be an array")
    else {
      config.permissions.forEach((rule, index) => {
        const at = `/permissions/${index}`
        if (!isPlainObject(rule)) { errors.push(`${at} must be an object`); return }
        if (typeof rule.action !== "string" || !rule.action) errors.push(`${at}/action must be a non-empty string`)
        if (typeof rule.resource !== "string" || !rule.resource) errors.push(`${at}/resource must be a non-empty string`)
        if (!V2_PERMISSION_EFFECTS.has(rule.effect)) {
          errors.push(`${at}/effect must be one of allow|ask|deny, got ${JSON.stringify(rule.effect)}`)
        }
      })
    }
  }

  if (config.agents !== undefined) {
    if (!isPlainObject(config.agents)) errors.push("/agents must be an object")
    else {
      for (const [name, agent] of Object.entries(config.agents)) {
        if (!isPlainObject(agent)) { errors.push(`/agents/${name} must be an object`); continue }
        if (agent.system !== undefined && typeof agent.system !== "string") {
          errors.push(`/agents/${name}/system must be a string`)
        }
        if (agent.prompt !== undefined) errors.push(`/agents/${name}/prompt is v1-only; use system`)
        if (agent.disable !== undefined) errors.push(`/agents/${name}/disable is v1-only; use disabled`)
        if (agent.maxSteps !== undefined) errors.push(`/agents/${name}/maxSteps is v1-only; use steps`)
      }
    }
  }

  if (config.compaction !== undefined) {
    if (!isPlainObject(config.compaction)) errors.push("/compaction must be an object")
    else {
      const { compaction } = config
      if (compaction.preserve_recent_tokens !== undefined) {
        errors.push("/compaction/preserve_recent_tokens is v1-only; use keep.tokens")
      }
      if (compaction.reserved !== undefined) errors.push("/compaction/reserved is v1-only; use buffer")
      if (compaction.keep !== undefined && typeof compaction.keep?.tokens !== "number") {
        errors.push("/compaction/keep/tokens must be a number")
      }
      if (compaction.buffer !== undefined && typeof compaction.buffer !== "number") {
        errors.push("/compaction/buffer must be a number")
      }
    }
  }

  if (config.plugins !== undefined && !Array.isArray(config.plugins)) errors.push("/plugins must be an array")

  if (config.mcp !== undefined) {
    if (!isPlainObject(config.mcp)) errors.push("/mcp must be an object")
    else if (config.mcp.servers !== undefined && !isPlainObject(config.mcp.servers)) {
      errors.push("/mcp/servers must be an object")
    } else if (isPlainObject(config.mcp.servers)) {
      // A non-boolean `codemode` is worth erroring on rather than passing through: the runtime
      // reads it for truthiness, so a stray string like "false" turns Code Mode back ON and
      // reintroduces the silent no-tools failure this migration pins it off to avoid.
      for (const [name, server] of Object.entries(config.mcp.servers)) {
        if (isPlainObject(server) && server.codemode !== undefined && typeof server.codemode !== "boolean") {
          errors.push(`/mcp/servers/${name}/codemode must be a boolean`)
        }
      }
    }
  }

  // v1 top-level keys that would be silently ignored by v2 rather than erroring.
  for (const [v1Key, v2Key] of [
    ["provider", "providers"],
    ["permission", "permissions"],
    ["agent", "agents"],
    ["plugin", "plugins"],
    ["autoshare", "share"],
    ["snapshot", "snapshots"],
    ["attachment", "media"],
    ["command", "commands"],
    ["reference", "references"]
  ]) {
    if (config[v1Key] !== undefined) errors.push(`/${v1Key} is v1-only; use ${v2Key}`)
  }

  return errors
}

function assertValidV2Config(config) {
  const errors = validateV2Config(config)
  if (errors.length) throw new Error(`Invalid OpenCode v2 config: ${errors.join("; ")}`)
}

module.exports = {
  V2_PROVIDER_PACKAGE,
  V2_PERMISSION_ACTION_BY_V1_TOOL,
  V1_TOOL_BY_V2_ACTION,
  assertValidV2Config,
  fromV2Permissions,
  toV2Compaction,
  toV2Config,
  toV2Model,
  toV2Permissions,
  toV2Provider,
  validateV2Config,
  contract: V2_CONTRACT
}
