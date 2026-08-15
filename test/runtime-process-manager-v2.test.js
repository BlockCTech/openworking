const test = require("node:test")
const assert = require("node:assert/strict")

// Focused coverage of the v2 wire shapes that differ hardest from v1 — the envelope, the renamed
// and collapsed events, the prompt body and the flat message envelope. Broader manager behaviour
// lives in runtime-process-manager.test.js.

const {
  RuntimeProcessManager,
  buildCommandBody,
  buildSkillBody,
  buildPromptBody,
  normalizeModelRef,
  projectFileSystemEntry,
  projectMessage,
  projectPendingInput,
  projectRuntimeEvent,
  projectSavedPermission,
  projectSessionRevert
} = require("../src/runtime/process-manager")

function readyManager(serverUrl, options = {}) {
  const manager = new RuntimeProcessManager({ userDataPath: "/tmp/ow-v2-gap", emit() {}, ...options })
  manager.child = {}
  manager.state.status = "running"
  manager.state.runtime = { serverUrl, auth: { username: "opencode", password: "pw" } }
  return manager
}

// Payloads below mirror what a real opencode2 emitted during a live LLM turn — see
// .agents/evidence/v2-real-llm-stream.jsonl. They are regression guards against the silent
// failure mode: unknown event shapes project to null and vanish without an error.

test("v2 events are projected from `data`, not `properties`", () => {
  assert.deepEqual(
    projectRuntimeEvent({
      id: "evt_1",
      type: "session.idle",
      durable: { aggregateID: "ses_1", seq: 4, version: 1 },
      data: { sessionID: "ses_1" }
    }),
    { type: "session.idle", sessionID: "ses_1" }
  )
  // A v1-shaped event must NOT resolve under the v2 contract.
  assert.equal(projectRuntimeEvent({ type: "session.idle", properties: { sessionID: "ses_1" } }), null)
})

// The projection layer maps v2's runtime names back to the app's canonical (v1) vocabulary, so
// thread-stream.js and renderer.js keep matching on the names they already use.
test("v2 renamed lifecycle events project onto the app's canonical names", () => {
  assert.deepEqual(
    projectRuntimeEvent({ type: "session.execution.interrupted", data: { sessionID: "ses_1", reason: "user" } }),
    { type: "session.aborted", sessionID: "ses_1" }
  )
  assert.deepEqual(
    projectRuntimeEvent({ type: "session.status", data: { sessionID: "ses_1", status: { type: "busy" } } }),
    { type: "session.status", sessionID: "ses_1", status: { type: "busy" } }
  )
  // The v1 spelling no longer exists in v2 and must be dropped rather than half-projected.
  assert.equal(projectRuntimeEvent({ type: "session.aborted", data: { sessionID: "ses_1" } }), null)
})

// v2 collapses the four v1 mcp.status.* events into one, carrying the server in the payload.
// The renderer matches on the `mcp.` prefix and reads `name`, so that shape must be preserved.
test("v2 mcp.status.changed projects into the renderer's name/status shape", () => {
  assert.deepEqual(
    projectRuntimeEvent({ type: "mcp.status.changed", data: { server: "backlog", status: "connected" } }),
    { type: "mcp.status.changed", name: "backlog", status: "connected" }
  )
  assert.deepEqual(
    projectRuntimeEvent({ type: "mcp.status.changed", data: { server: "backlog" } }),
    { type: "mcp.status.changed", name: "backlog" }
  )
  assert.equal(projectRuntimeEvent({ type: "mcp.status.changed", data: {} }), null)
})

// Observed on a real LLM turn: v2 ends with `session.execution.succeeded` and emits NO
// `session.idle`, even though that event exists in the schema. Without this mapping the thread
// would stay busy forever after every reply.
test("v2 execution.succeeded is projected as session.idle", () => {
  assert.deepEqual(
    projectRuntimeEvent({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } }),
    { type: "session.idle", sessionID: "ses_1" }
  )
})

// v2 emits no `message.updated` for the assistant message. `session.step.started` is the first
// event carrying its id, so it must create the message that the text deltas then append to.
test("v2 step.started creates the assistant message the deltas append to", () => {
  assert.deepEqual(
    projectRuntimeEvent({
      type: "session.step.started",
      created: 1000,
      data: { sessionID: "ses_1", assistantMessageID: "msg_1", agent: "build", model: {} }
    }),
    {
      type: "message.updated",
      sessionID: "ses_1",
      // time.created is carried so the footer can compute elapsed once step.ended lands.
      info: { id: "msg_1", sessionID: "ses_1", role: "assistant", time: { created: 1000 } }
    }
  )
  assert.equal(
    projectRuntimeEvent({ type: "session.step.started", data: { sessionID: "ses_1" } }),
    null
  )
})

// v2 emits no completion message of its own, so without projecting step.ended the message never
// reaches `stats.completed` — which hid the duration/token footer and gated affordances forever.
test("v2 step.ended completes the assistant message with tokens and cost", () => {
  assert.deepEqual(
    projectRuntimeEvent({
      type: "session.step.ended",
      created: 3500,
      data: {
        sessionID: "ses_1",
        assistantMessageID: "msg_1",
        finish: "stop",
        cost: 0,
        tokens: { input: 4824, output: 4, reasoning: 0 }
      }
    }),
    {
      type: "message.updated",
      sessionID: "ses_1",
      info: {
        id: "msg_1",
        sessionID: "ses_1",
        role: "assistant",
        time: { completed: 3500 },
        tokens: { input: 4824, output: 4, reasoning: 0 },
        cost: 0
      }
    }
  )
  assert.equal(projectRuntimeEvent({ type: "session.step.ended", data: { sessionID: "ses_1" } }), null)
})

// v1 multiplexed answer text and reasoning through one delta event and told them apart with
// `field`; v2 splits them by event name. Without this mapping reasoning was dropped entirely.
test("v2 reasoning deltas project as reasoning, in their own part", () => {
  const reasoning = projectRuntimeEvent({
    type: "session.reasoning.delta",
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "thinking" }
  })
  assert.equal(reasoning.type, "message.part.delta")
  assert.equal(reasoning.field, "reasoning")
  assert.equal(reasoning.delta, "thinking")

  const text = projectRuntimeEvent({
    type: "session.text.delta",
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "answer" }
  })
  assert.equal(text.field, "text")
  // Same message and ordinal, so the ids must still differ or the two streams would share a part.
  assert.notEqual(reasoning.partID, text.partID)
})

// The "Thinking" row never appeared because v2 emits NO `session.status` — the only event that
// moved a session into "busy". A live turn was execution.started -> step.started -> text.* ->
// step.ended -> execution.succeeded, so the turn opener has to synthesize the busy status.
test("v2 execution.started opens the turn as busy so the Thinking row can render", () => {
  const started = projectRuntimeEvent({
    type: "session.execution.started",
    data: { sessionID: "ses_1" }
  })
  assert.equal(started.type, "session.status")
  assert.equal(started.sessionID, "ses_1")
  assert.deepEqual(started.status, { type: "busy" })

  // ...and the turn still settles: succeeded canonicalizes to idle, or the row would never clear.
  const succeeded = projectRuntimeEvent({
    type: "session.execution.succeeded",
    data: { sessionID: "ses_1" }
  })
  assert.equal(succeeded.type, "session.idle")
  assert.equal(projectRuntimeEvent({ type: "session.execution.started", data: {} }), null)
})

// The delta is declared `e.ephemeral` in the runtime while `ended` is `e.durable`, so deltas are
// never replayed and a reconnect (or a client joining mid-turn) loses them. `ended` carries the
// full authoritative text, so leaving it unmapped dropped reasoning outright in exactly that case.
test("v2 reasoning ended projects the full text onto the delta's part", () => {
  const delta = projectRuntimeEvent({
    type: "session.reasoning.delta",
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "think" }
  })
  const ended = projectRuntimeEvent({
    type: "session.reasoning.ended",
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, text: "thinking it through" }
  })
  assert.equal(ended.type, "message.part.updated")
  assert.equal(ended.sessionID, "ses_1")
  assert.equal(ended.part.type, "reasoning")
  assert.equal(ended.part.messageID, "msg_1")
  assert.equal(ended.part.text, "thinking it through")
  // Must land on the SAME part the deltas built, or the block renders twice. Asserted against the
  // delta's own id so the two synthetic-id formulas cannot drift apart in a refactor.
  assert.equal(ended.part.id, delta.partID)
})

test("v2 reasoning ended without ordinal or message id is dropped, not thrown", () => {
  assert.equal(projectRuntimeEvent({
    type: "session.reasoning.ended",
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", text: "no ordinal" }
  }), null)
  assert.equal(projectRuntimeEvent({
    type: "session.reasoning.ended",
    data: { sessionID: "ses_1", ordinal: 0, text: "no message id" }
  }), null)
})

// Regression: a turn can contain several steps (tool call -> step ends -> next step starts), all
// sharing ONE assistantMessageID. Completing on every step made the message flip
// completed -> incomplete -> completed, so the copy/fork actions flickered on each tool call.
test("v2 only completes the message on the step that finishes the turn", () => {
  const midTurn = projectRuntimeEvent({
    type: "session.step.ended",
    created: 1500,
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", finish: "tool-calls", tokens: { output: 3 } }
  })
  assert.equal(midTurn.type, "message.updated")
  assert.equal(midTurn.info.time, undefined, "a tool-call step must not mark the turn complete")
  assert.deepEqual(midTurn.info.tokens, { output: 3 }, "usage still accrues mid-turn")

  const finalStep = projectRuntimeEvent({
    type: "session.step.ended",
    created: 2500,
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", finish: "stop", tokens: { output: 9 } }
  })
  assert.equal(finalStep.info.time.completed, 2500)
})

// Regression: handleRuntimeEvent keys off the CANONICAL name, so `session.execution.succeeded`
// has to canonicalize to session.idle. Without it sessionStatuses stayed "busy" forever and the
// "Thinking" row remained on screen after the reply had finished.
test("v2 execution outcomes drive the manager's busy/idle bookkeeping", () => {
  const emitted = []
  const manager = new RuntimeProcessManager({
    userDataPath: "/tmp/ow-idle",
    emit(channel, payload) {
      emitted.push({ channel, payload })
    }
  })
  manager.state.activeSessionId = "ses_1"
  manager.handleRuntimeEvent({ type: "session.execution.started", data: { sessionID: "ses_1" } })
  assert.deepEqual(manager.sessionStatuses.ses_1, { type: "busy" })
  assert.deepEqual(manager.snapshot().activeSessionStatus, { type: "busy" })
  assert.equal(manager.state.activity, "running")
  assert.deepEqual(
    emitted.find((entry) => entry.channel === "runtime:stream")?.payload,
    { type: "session.status", sessionID: "ses_1", status: { type: "busy" } }
  )
  assert.deepEqual(
    emitted.findLast((entry) => entry.channel === "runtime:update")?.payload.sessionStatuses.ses_1,
    { type: "busy" }
  )

  manager.handleRuntimeEvent({ type: "session.execution.succeeded", data: { sessionID: "ses_1" } })
  assert.deepEqual(manager.sessionStatuses.ses_1, { type: "idle" })
  assert.equal(manager.state.activity, "idle")

  const failed = new RuntimeProcessManager({ userDataPath: "/tmp/ow-idle-2", emit() {} })
  failed.state.activeSessionId = "ses_2"
  failed.handleRuntimeEvent({ type: "session.status", data: { sessionID: "ses_2", status: { type: "busy" } } })
  failed.handleRuntimeEvent({ type: "session.execution.failed", data: { sessionID: "ses_2", error: { data: { message: "boom" } } } })
  assert.deepEqual(failed.sessionStatuses.ses_2, { type: "idle" }, "a failed turn must also settle")
})

// v2 populates its command/skill catalog asynchronously: GET /api/command answers 200 with an
// empty list for seconds after health passes. Without this the UI would keep the empty result.
test("v2 catalog events collapse into a single refresh signal", () => {
  for (const type of ["catalog.updated", "command.updated", "skill.updated"]) {
    assert.deepEqual(projectRuntimeEvent({ type, data: {} }), { type: "runtime.catalog.updated" })
  }
})

test("v2 reference.updated projects to a bare refresh signal", () => {
  assert.deepEqual(projectRuntimeEvent({ type: "reference.updated", data: { anything: "not forwarded" } }), { type: "reference.updated" })
})

// Unlike reference.updated above, these are confirmed live on the wire (see the goal spec's
// live-spike notes) — created/updated carry the full Pty under data.info, exited/deleted carry
// only data.id (+ exitCode for exited).
test("v2 pty.created and pty.updated project the full Pty info, dropping a malformed entry", () => {
  const info = { id: "pty_1", title: "shell", command: "/bin/sh", args: ["-c", "x"], cwd: "/project", status: "running", pid: 42 }
  assert.deepEqual(
    projectRuntimeEvent({ type: "pty.created", data: { info } }),
    { type: "pty.created", pty: { id: "pty_1", title: "shell", command: "/bin/sh", args: ["-c", "x"], cwd: "/project", status: "running", pid: 42, exitCode: null } }
  )
  assert.deepEqual(
    projectRuntimeEvent({ type: "pty.updated", data: { info } }),
    { type: "pty.updated", pty: { id: "pty_1", title: "shell", command: "/bin/sh", args: ["-c", "x"], cwd: "/project", status: "running", pid: 42, exitCode: null } }
  )
  assert.equal(projectRuntimeEvent({ type: "pty.created", data: { info: { title: "no id" } } }), null)
})

test("v2 pty.exited and pty.deleted project only the id (+ exit code)", () => {
  assert.deepEqual(
    projectRuntimeEvent({ type: "pty.exited", data: { id: "pty_1", exitCode: 7 } }),
    { type: "pty.exited", ptyId: "pty_1", exitCode: 7 }
  )
  assert.deepEqual(
    projectRuntimeEvent({ type: "pty.deleted", data: { id: "pty_1" } }),
    { type: "pty.deleted", ptyId: "pty_1" }
  )
  assert.equal(projectRuntimeEvent({ type: "pty.exited", data: {} }), null)
})

test("v2 permission and question asks still project their display fields", () => {
  const permission = projectRuntimeEvent({
    type: "permission.asked",
    data: {
      id: "per_1",
      sessionID: "ses_1",
      action: "edit",
      resources: ["gate_test.txt"],
      metadata: { filePath: "gate_test.txt" }
    }
  })
  assert.equal(permission.type, "permission.asked")
  assert.equal(permission.sessionID, "ses_1")
  assert.equal(permission.requestID, "per_1")

  const question = projectRuntimeEvent({
    type: "question.asked",
    data: { id: "q_1", sessionID: "ses_1", questions: [{ question: "Continue?", options: ["yes", "no"] }] }
  })
  assert.equal(question.requestID, "q_1")
  assert.equal(question.question.questions[0].question, "Continue?")
})

test("v2 tool lifecycle uses data.id and keeps one canonical part identity", () => {
  const base = { sessionID: "ses_1", assistantMessageID: "msg_1", id: "tool_1" }
  const started = projectRuntimeEvent({
    type: "session.tool.input.started",
    data: { ...base, name: "websearch" }
  })
  const called = projectRuntimeEvent({
    type: "session.tool.called",
    data: { ...base, input: { query: "today weather" } }
  })
  const succeeded = projectRuntimeEvent({
    type: "session.tool.success",
    data: { ...base, metadata: { provider: "exa" } }
  })
  assert.equal(started.part.id, "msg_1:tool:tool_1")
  assert.equal(called.part.id, started.part.id)
  assert.equal(succeeded.part.id, started.part.id)
  assert.equal(started.part.tool, "websearch")
  assert.deepEqual(called.part.state.input, { query: "today weather" })
  assert.equal(succeeded.part.state.status, "completed")
  assert.equal(projectRuntimeEvent({
    type: "session.tool.called",
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", callID: "legacy", input: {} }
  }), null)
})

test("v2 structured form events project only renderer-safe fields", () => {
  const created = projectRuntimeEvent({
    type: "form.created",
    data: {
      form: {
        id: "frm_1",
        sessionID: "ses_1",
        title: "Web Search",
        metadata: { kind: "websearch.provider", secret: "drop" },
        fields: [{
          key: "choice",
          description: "Allow web search?",
          type: "string",
          required: true,
          custom: false,
          pattern: "drop",
          options: [{ value: "allow", label: "Allow", internal: "drop" }]
        }]
      }
    }
  })
  assert.deepEqual(created, {
    type: "form.created",
    sessionID: "ses_1",
    form: {
      id: "frm_1",
      sessionID: "ses_1",
      title: "Web Search",
      kind: "websearch.provider",
      fields: [{
        key: "choice",
        type: "string",
        description: "Allow web search?",
        required: true,
        options: [{ value: "allow", label: "Allow" }]
      }]
    }
  })
  assert.deepEqual(projectRuntimeEvent({ type: "form.replied", data: { id: "frm_1", sessionID: "ses_1", answer: { choice: "allow" } } }), {
    type: "form.replied", sessionID: "ses_1", formID: "frm_1"
  })
  assert.deepEqual(projectRuntimeEvent({ type: "form.cancelled", data: { id: "frm_1", sessionID: "ses_1" } }), {
    type: "form.cancelled", sessionID: "ses_1", formID: "frm_1"
  })
})

// v2 sends { assistantMessageID, ordinal, delta } and has NO `field` key — text vs reasoning is
// the event name. The renderer's pacer gates on `field === "text"`, so the projection must
// supply both the canonical type and a synthesized partID/field for it to keep working.
test("v2 text deltas project through the app's delta channel", () => {
  const projected = projectRuntimeEvent({
    type: "session.text.delta",
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "STREAM_OK" }
  })
  assert.equal(projected.type, "message.part.delta")
  assert.equal(projected.sessionID, "ses_1")
  assert.equal(projected.messageID, "msg_1")
  assert.equal(projected.partID, "msg_1:0")
  assert.equal(projected.field, "text")
  assert.equal(projected.delta, "STREAM_OK")
})

// Verified against a live server: posting v1's `{parts}` returns HTTP 400
// `Missing key at ["text"]`, so this reshaping is required, not cosmetic.
test("v2 prompt and command bodies carry stable input admission fields", () => {
  const body = buildPromptBody({ prompt: "hello" })
  assert.equal(body.text, "hello")
  assert.equal(body.parts, undefined)
  assert.equal(body.files, undefined)

  const withFile = buildPromptBody({
    inputId: "msg_12345678",
    prompt: "describe this",
    attachments: [{ url: "data:image/png;base64,AAA", filename: "a.png", mime: "image/png" }],
    agents: [{ name: "reviewer" }],
    metadata: { source: "composer" },
    delivery: "queue",
    resume: false
  })
  assert.equal(withFile.id, "msg_12345678")
  assert.equal(withFile.text, "describe this")
  assert.deepEqual(withFile.files, [
    { uri: "data:image/png;base64,AAA", name: "a.png", description: "image/png" }
  ])
  assert.deepEqual(withFile.agents, [{ name: "reviewer" }])
  assert.deepEqual(withFile.metadata, { source: "composer" })
  assert.equal(withFile.delivery, "queue")
  assert.equal(withFile.resume, false)
  assert.equal(withFile.agent, undefined)
  assert.equal(withFile.model, undefined)

  assert.deepEqual(buildCommandBody({
    inputId: "msg_abcdefgh",
    command: "init",
    arguments: "focus on tests",
    delivery: "steer",
    resume: true
  }), {
    id: "msg_abcdefgh",
    command: "init",
    arguments: "focus on tests",
    delivery: "steer",
    resume: true
  })

  assert.deepEqual(buildSkillBody({
    skill: " explain-project ",
    resume: false
  }), {
    skill: "explain-project",
    resume: false
  })
})

test("v2 skill activation posts the native body and preserves SkillNotFoundError details", async () => {
  const http = require("node:http")
  const requests = []
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => { raw += chunk })
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null })
      if (req.url.endsWith("/missing-skill/skill")) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ _tag: "SkillNotFoundError", skill: "explain-project" }))
        return
      }
      res.writeHead(204)
      res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
    assert.equal(await manager.activateSkill({
      sessionId: "ses_1",
      skill: "explain-project",
      resume: false
    }), true)
    await assert.rejects(
      manager.activateSkill({ sessionId: "missing-skill", skill: "explain-project", resume: false }),
      /HTTP 404:.*SkillNotFoundError.*explain-project/
    )
    await assert.rejects(
      manager.activateSkill({ sessionId: "ses_1", skill: "", resume: false }),
      /Skill is required/
    )
    await assert.rejects(
      manager.activateSkill({ sessionId: "ses_1", skill: "explain-project", resume: "false" }),
      /Skill resume must be a boolean/
    )
    assert.deepEqual(requests, [
      {
        method: "POST",
        url: "/api/session/ses_1/skill",
        body: { skill: "explain-project", resume: false }
      },
      {
        method: "POST",
        url: "/api/session/missing-skill/skill",
        body: { skill: "explain-project", resume: false }
      }
    ])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("v2 pending inputs and lifecycle events expose only renderer-safe fields", () => {
  const raw = {
    id: "msg_12345678",
    sessionID: "ses_1",
    admittedSeq: 7,
    timeCreated: 1234,
    type: "user",
    delivery: "queue",
    data: {
      text: "queued prompt",
      files: [{
        uri: "file:///private/project/secret.txt",
        name: "secret.txt",
        description: "text/plain",
        privateField: "drop"
      }],
      metadata: { secret: "drop" }
    },
    privateField: "drop"
  }
  assert.deepEqual(projectPendingInput(raw), {
    id: "msg_12345678",
    sessionID: "ses_1",
    type: "user",
    admittedSeq: 7,
    timeCreated: 1234,
    delivery: "queue",
    text: "queued prompt",
    files: [{ name: "secret.txt", description: "text/plain" }]
  })
  assert.deepEqual(projectPendingInput({
    id: "cmp_1",
    sessionID: "ses_1",
    admittedSeq: 8,
    timeCreated: { privateField: "drop" },
    type: "compaction",
    data: { checkpoint: "must not cross IPC" }
  }), {
    id: "cmp_1",
    sessionID: "ses_1",
    type: "compaction",
    admittedSeq: 8
  })

  const admitted = projectRuntimeEvent({
    type: "session.input.admitted",
    created: 1234,
    durable: { seq: 7 },
    data: {
      sessionID: "ses_1",
      inputID: "msg_12345678",
      input: raw
    }
  })
  assert.deepEqual(admitted, {
    type: "session.input.admitted",
    sessionID: "ses_1",
    inputID: "msg_12345678",
    input: {
      id: "msg_12345678",
      sessionID: "ses_1",
      type: "user",
      admittedSeq: 7,
      timeCreated: 1234,
      delivery: "queue",
      text: "queued prompt",
      files: [{ name: "secret.txt", description: "text/plain" }]
    }
  })
  assert.deepEqual(projectRuntimeEvent({
    type: "session.input.promoted",
    data: { sessionID: "ses_1", inputID: "msg_12345678", privateField: "drop" }
  }), {
    type: "session.input.promoted",
    sessionID: "ses_1",
    inputID: "msg_12345678"
  })

  const manager = new RuntimeProcessManager({ userDataPath: "/tmp/ow-input-diagnostics", emit() {} })
  manager.handleRuntimeEvent({
    type: "session.input.admitted",
    created: 1234,
    durable: { seq: 7 },
    data: { sessionID: "ses_1", inputID: "msg_12345678", input: raw }
  })
  const diagnostic = manager.snapshot().timeline.at(-1)
  assert.deepEqual(diagnostic.payload, {
    sessionID: "ses_1",
    inputID: "msg_12345678",
    inputType: "user",
    delivery: "queue",
    admittedSeq: 7
  })
  assert.equal(JSON.stringify(diagnostic).includes("queued prompt"), false)
  assert.equal(JSON.stringify(diagnostic).includes("secret.txt"), false)
})

test("v2 model references use providerID/id/variant", () => {
  assert.deepEqual(
    normalizeModelRef({ providerID: "openworking", id: "gemma", variant: "high" }),
    { providerID: "openworking", id: "gemma", variant: "high" }
  )
  assert.deepEqual(
    normalizeModelRef({ providerID: "openworking", modelID: "legacy-id" }),
    { providerID: "openworking", id: "legacy-id" }
  )
  assert.equal(normalizeModelRef({ id: "missing-provider" }), null)
})

test("v2 compaction and revert events project only renderer-safe state", () => {
  assert.deepEqual(projectRuntimeEvent({
    type: "session.model.selected",
    data: {
      sessionID: "ses_1",
      model: { providerID: "openworking", id: "gemma", variant: "xhigh" }
    }
  }), {
    type: "session.model.selected",
    sessionID: "ses_1",
    model: { providerID: "openworking", id: "gemma", variant: "xhigh" }
  })

  assert.deepEqual(projectRuntimeEvent({
    type: "session.compaction.admitted",
    data: { sessionID: "ses_1", inputID: "inp_1" }
  }), {
    type: "session.compaction.admitted",
    sessionID: "ses_1",
    inputID: "inp_1"
  })
  assert.deepEqual(projectRuntimeEvent({
    type: "session.compaction.delta",
    data: { sessionID: "ses_1", delta: "private checkpoint" }
  }), {
    type: "session.compaction.delta",
    sessionID: "ses_1"
  })

  const revert = {
    messageID: "msg_1",
    snapshot: "private-snapshot",
    patch: "private-diff",
    files: [{
      file: "src/app.js",
      status: "modified",
      additions: 4,
      deletions: 2,
      patch: "private-file-diff"
    }]
  }
  assert.deepEqual(projectSessionRevert(revert), {
    messageID: "msg_1",
    files: [{ file: "src/app.js", status: "modified", additions: 4, deletions: 2 }]
  })
  assert.deepEqual(projectRuntimeEvent({
    type: "session.revert.staged",
    data: { sessionID: "ses_1", revert }
  }), {
    type: "session.revert.staged",
    sessionID: "ses_1",
    revert: {
      messageID: "msg_1",
      files: [{ file: "src/app.js", status: "modified", additions: 4, deletions: 2 }]
    }
  })

  const manager = new RuntimeProcessManager({ userDataPath: "/tmp/ow-revert-diagnostics", emit() {} })
  manager.handleRuntimeEvent({
    type: "session.revert.staged",
    data: { sessionID: "ses_1", revert }
  })
  const diagnostic = manager.snapshot().timeline.at(-1)
  assert.deepEqual(diagnostic.payload, {
    sessionID: "ses_1",
    status: "staged",
    fileCount: 1
  })
  assert.equal(JSON.stringify(diagnostic).includes("src/app.js"), false)
  assert.equal(JSON.stringify(diagnostic).includes("msg_1"), false)
})

// v2 REST messages are flat and use `content[]` with no `info` wrapper; `role` is now `type`.
// The exact payload below was returned by a real server for a real model turn.
test("v2 flat messages normalize into the projected info/parts envelope", () => {
  const projected = projectMessage({
    id: "msg_1",
    sessionID: "ses_1",
    time: { created: 1785250886389, completed: 1785250886399 },
    type: "assistant",
    agent: "build",
    model: { id: "google/gemma-4-31B-it", providerID: "openworking" },
    content: [{ type: "text", text: "OQ4_PASS" }],
    finish: "stop",
    cost: 0,
    tokens: { input: 4804, output: 6 }
  })
  assert.equal(projected.info.id, "msg_1")
  assert.equal(projected.info.sessionID, "ses_1")
  assert.equal(projected.info.role, "assistant")
  assert.deepEqual(projected.info.tokens, { input: 4804, output: 6 })
  assert.equal(projected.parts.length, 1)
  assert.equal(projected.parts[0].type, "text")
  assert.equal(projected.parts[0].text, "OQ4_PASS")
  // v2 content entries carry no ids; synthesized ones keep projectMessagePart's guard satisfied.
  assert.equal(projected.parts[0].messageID, "msg_1")
  assert.ok(projected.parts[0].id)
})

test("v2 user message files hydrate as safe attachment parts", () => {
  const projected = projectMessage({
    id: "msg_user_files",
    sessionID: "ses_1",
    time: { created: 1785250886389 },
    type: "user",
    text: "Review the attachment",
    files: [{
      data: "private-base64",
      mime: "image/png",
      source: { type: "uri", uri: "file:///private/source.png" },
      name: "diagram.png",
      description: "Architecture diagram"
    }]
  })

  assert.deepEqual(projected.parts, [
    {
      id: "msg_user_files:0",
      sessionID: "ses_1",
      messageID: "msg_user_files",
      type: "text",
      text: "Review the attachment"
    },
    {
      id: "msg_user_files:1",
      sessionID: "ses_1",
      messageID: "msg_user_files",
      type: "file",
      filename: "diagram.png",
      mime: "image/png"
    }
  ])
  assert.equal(JSON.stringify(projected).includes("private-base64"), false)
  assert.equal(JSON.stringify(projected).includes("file:///private/source.png"), false)
})

test("v2 message normalization keeps accepting an already v1-shaped envelope", () => {
  const projected = projectMessage({
    info: { id: "msg_1", sessionID: "ses_1", role: "assistant" },
    parts: [{ id: "prt_1", messageID: "msg_1", sessionID: "ses_1", type: "text", text: "hi" }]
  })
  assert.equal(projected.info.role, "assistant")
  assert.equal(projected.parts[0].text, "hi")
})

// Regression for the "thread wipes itself and re-runs" bug: v2 wraps message lists in
// { data, cursor }, and an unwrapped read returned [] on every call. Because the post-turn
// rehydrate assigns that result straight onto thread.messages, the whole conversation vanished
// and the retained optimistic prompt was left alone, looking like the turn had restarted.
test("v2 message lists are unwrapped from the data envelope", async () => {
  const http = require("node:http")
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({
      data: [
        { id: "msg_a", sessionID: "ses_1", type: "assistant", content: [{ type: "text", text: "ANSWER" }] },
        { id: "msg_u", sessionID: "ses_1", type: "user", time: { created: 1 }, text: "ask" }
      ],
      cursor: { previous: null, next: null }
    }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = new RuntimeProcessManager({ userDataPath: "/tmp/ow-envelope", emit() {} })
    manager.child = {}
    manager.state.status = "running"
    manager.state.runtime = {
      serverUrl: `http://127.0.0.1:${server.address().port}`,
      auth: { username: "opencode", password: "pw" }
    }
    const messages = await manager.listMessages({ sessionId: "ses_1" })
    assert.equal(messages.length, 2, "an unwrapped envelope yields [] and wipes the thread")
    assert.equal(messages[0].parts[0].text, "ANSWER")
    // A v2 user message has no content[] — only `text`. Without synthesizing a part from it the
    // rehydrated user turn has zero parts, fails to match the optimistic bubble, and duplicates.
    assert.equal(messages[1].info.role, "user")
    assert.deepEqual(messages[1].parts.map((part) => part.text), ["ask"])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// Regression: v2 defaults GET /message to `order=desc`, so without pinning asc the rehydrate
// rebuilt the thread newest-first — the reply above the prompt that produced it.
test("v2 message lists are requested oldest-first", async () => {
  const http = require("node:http")
  let requestedUrl = null
  const server = http.createServer((req, res) => {
    requestedUrl = req.url
    res.setHeader("Content-Type", "application/json")
    // Mirror the server: honour asc, and return newest-first for anything else.
    const ordered = [
      { id: "msg_u", sessionID: "ses_1", type: "user", time: { created: 1 }, text: "ask" },
      { id: "msg_a", sessionID: "ses_1", type: "assistant", time: { created: 2 }, content: [{ type: "text", text: "ANSWER" }] }
    ]
    const data = req.url.includes("order=asc") ? ordered : [...ordered].reverse()
    res.end(JSON.stringify({ data, cursor: { previous: null, next: null } }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = new RuntimeProcessManager({ userDataPath: "/tmp/ow-order", emit() {} })
    manager.child = {}
    manager.state.status = "running"
    manager.state.runtime = {
      serverUrl: `http://127.0.0.1:${server.address().port}`,
      auth: { username: "opencode", password: "pw" }
    }
    const messages = await manager.listMessages({ sessionId: "ses_1" })
    assert.match(requestedUrl, /order=asc/)
    assert.deepEqual(messages.map((message) => message.info.role), ["user", "assistant"])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("v2 subagent run trees hydrate from family, active sessions and durable logs", async () => {
  const http = require("node:http")
  const requests = []
  const logs = {
    ses_root: [{
      type: "session.tool.input.started",
      created: 10,
      durable: { aggregateID: "ses_root", seq: 1, version: 1 },
      data: { sessionID: "ses_root", assistantMessageID: "msg_1", id: "call_1", name: "subagent" }
    }, {
      type: "session.tool.called",
      created: 20,
      durable: { aggregateID: "ses_root", seq: 2, version: 1 },
      data: {
        sessionID: "ses_root",
        assistantMessageID: "msg_1",
        id: "call_1",
        input: { agent: "review", description: "Review the patch", prompt: "private" }
      }
    }, {
      type: "session.tool.success",
      created: 30,
      durable: { aggregateID: "ses_root", seq: 3, version: 1 },
      data: {
        sessionID: "ses_root",
        assistantMessageID: "msg_1",
        id: "call_1",
        metadata: { sessionID: "ses_child", status: "completed" }
      }
    }],
    ses_child: [{
      type: "session.execution.succeeded",
      created: 40,
      durable: { aggregateID: "ses_child", seq: 4, version: 1 },
      data: { sessionID: "ses_child" }
    }]
  }
  const server = http.createServer((req, res) => {
    requests.push(req.url)
    if (req.url === "/api/session/active") {
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ data: {} }))
      return
    }
    if (req.url.startsWith("/api/session?parentID=")) {
      const parentID = new URL(req.url, "http://local").searchParams.get("parentID")
      const data = parentID === "ses_root"
        ? [
            { id: "ses_child", parentID: "ses_root", agent: "review", title: "Review", time: { created: 1 } },
            { id: "ses_fork", parentID: "ses_root", fork: { sessionID: "ses_root" }, title: "Fork" }
          ]
        : []
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ data, cursor: {} }))
      return
    }
    const match = /^\/api\/experimental\/session\/([^/]+)\/log/.exec(req.url)
    if (match) {
      const sessionID = decodeURIComponent(match[1])
      const after = Number(new URL(req.url, "http://local").searchParams.get("after") ?? -1)
      const items = (logs[sessionID] || []).filter((event) => event.durable.seq > after)
      const seq = Math.max(-1, ...(logs[sessionID] || []).map((event) => event.durable.seq))
      res.writeHead(200, { "Content-Type": "text/event-stream" })
      for (const event of [...items, { type: "log.synced", aggregateID: sessionID, seq }]) {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      res.end()
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const emitted = []
    const manager = new RuntimeProcessManager({
      userDataPath: "/tmp/ow-subagents",
      emit(channel, payload) { emitted.push({ channel, payload }) }
    })
    manager.child = {}
    manager.state.status = "running"
    manager.state.runtime = {
      serverUrl: `http://127.0.0.1:${server.address().port}`,
      auth: { username: "opencode", password: "pw" }
    }

    const tree = await manager.listSubagentRuns({ sessionId: "ses_root" })
    assert.equal(tree.runs.length, 1)
    assert.deepEqual(tree.runs[0], {
      sessionId: "ses_child",
      parentSessionId: "ses_root",
      agent: "review",
      description: "Review the patch",
      title: "Review",
      status: "succeeded",
      finishedAt: 40,
      children: []
    })
    assert.equal(JSON.stringify(tree).includes("private"), false)

    await manager.listSubagentRuns({ sessionId: "ses_root" })
    assert.ok(requests.some((url) => url.includes("/ses_root/log?follow=false&after=3")))
    assert.ok(requests.some((url) => url.includes("/ses_child/log?follow=false&after=4")))

    manager.handleRuntimeEvent({
      type: "session.execution.failed",
      created: 50,
      durable: { aggregateID: "ses_child", seq: 5, version: 1 },
      data: { sessionID: "ses_child", error: { message: "private failure" } }
    })
    const update = emitted.findLast((event) => event.payload?.type === "subagent.run-tree.updated")
    assert.equal(update.payload.tree.runs[0].status, "failed")
    assert.equal(JSON.stringify(update.payload).includes("private failure"), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("v2 pending list and prompt admission preserve stable ids, delivery and FIFO", async () => {
  const http = require("node:http")
  const requests = []
  const pending = [
    {
      id: "msg_queue0002",
      sessionID: "ses_1",
      admittedSeq: 2,
      timeCreated: 20,
      type: "user",
      delivery: "queue",
      data: { text: "second" }
    },
    {
      id: "msg_steer0001",
      sessionID: "ses_1",
      admittedSeq: 1,
      timeCreated: 10,
      type: "user",
      delivery: "steer",
      data: { text: "first", metadata: { private: true } }
    }
  ]
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (chunk) => { raw += chunk })
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null })
      res.setHeader("Content-Type", "application/json")
      if (req.method === "GET") {
        res.end(JSON.stringify({ data: pending }))
        return
      }
      const body = JSON.parse(raw)
      res.end(JSON.stringify({
        data: {
          id: body.id,
          sessionID: "ses_1",
          admittedSeq: 3,
          timeCreated: 30,
          type: "user",
          delivery: body.delivery,
          data: { text: body.text || `/${body.command} ${body.arguments}`.trim() }
        }
      }))
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = new RuntimeProcessManager({ userDataPath: "/tmp/ow-pending", emit() {} })
    manager.child = {}
    manager.state.status = "running"
    manager.state.runtime = {
      serverUrl: `http://127.0.0.1:${server.address().port}`,
      auth: { username: "opencode", password: "pw" }
    }

    assert.deepEqual((await manager.listPendingInputs({ sessionId: "ses_1" })).map((item) => item.id), [
      "msg_queue0002",
      "msg_steer0001"
    ])
    assert.deepEqual(await manager.sendPrompt({
      sessionId: "ses_1",
      inputId: "msg_prompt0003",
      prompt: "queued",
      delivery: "queue",
      resume: true
    }), {
      id: "msg_prompt0003",
      sessionID: "ses_1",
      type: "user",
      admittedSeq: 3,
      timeCreated: 30,
      delivery: "queue",
      text: "queued"
    })
    await manager.sendCommand({
      sessionId: "ses_1",
      inputId: "msg_command004",
      command: "init",
      arguments: "now",
      delivery: "steer",
      resume: true
    })
    assert.deepEqual(requests, [
      { method: "GET", url: "/api/session/ses_1/pending", body: null },
      {
        method: "POST",
        url: "/api/session/ses_1/prompt",
        body: { id: "msg_prompt0003", text: "queued", delivery: "queue", resume: true }
      },
      {
        method: "POST",
        url: "/api/session/ses_1/command",
        body: {
          id: "msg_command004",
          command: "init",
          arguments: "now",
          delivery: "steer",
          resume: true
        }
      }
    ])
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// A failed turn emits these INSTEAD of succeeded/step.ended. Dropping them left the thread busy
// forever with no error shown.
test("v2 failure events settle the turn instead of being dropped", () => {
  assert.deepEqual(
    projectRuntimeEvent({ type: "session.execution.failed", data: { sessionID: "ses_1", error: { data: { message: "boom" } } } }),
    { type: "session.error", sessionID: "ses_1", error: "boom" }
  )
  const stepFailed = projectRuntimeEvent({
    type: "session.step.failed",
    created: 99,
    data: { sessionID: "ses_1", assistantMessageID: "msg_1", error: { name: "x" }, tokens: { output: 2 } }
  })
  assert.equal(stepFailed.type, "message.updated")
  assert.equal(stepFailed.info.time.completed, 99)
})

test("v2 message projection drops messages without an id", () => {
  assert.equal(projectMessage({ content: [] }), null)
  assert.equal(projectMessage(null), null)
})

// End-to-end through the real consumer: the raw v2 event sequence below is exactly what a live
// opencode2 emitted for one LLM turn (see .agents/evidence/v2-real-llm-stream.jsonl). Feeding it
// through projection into thread-stream must render the reply and settle the thread to idle —
// this is the regression guard for the "blank thread, no error" failure mode.
test("a real v2 turn renders through thread-stream and settles to idle", () => {
  const { createThreadStream, applyThreadEvent } = require("../src/thread-stream")
  const sessionID = "ses_1"
  const assistantMessageID = "msg_1"
  const thread = createThreadStream(sessionID)

  const rawTurn = [
    { type: "session.execution.started", data: { sessionID } },
    { type: "session.step.started", data: { sessionID, assistantMessageID, agent: "build", model: {} } },
    { type: "session.text.started", data: { sessionID, assistantMessageID, ordinal: 0 } },
    { type: "session.text.delta", data: { sessionID, assistantMessageID, ordinal: 0, delta: "PHASE3_STREAM_OK" } },
    { type: "session.execution.succeeded", data: { sessionID } }
  ]
  for (const raw of rawTurn) {
    const projected = projectRuntimeEvent(raw)
    if (projected) applyThreadEvent(thread, projected)
  }

  const text = thread.messages.flatMap((message) =>
    (message.parts || []).filter((part) => part.type === "text").map((part) => part.text)
  )
  assert.deepEqual(text, ["PHASE3_STREAM_OK"])
  assert.equal(thread.status.type, "idle")
})

test("a multi-step v2 turn preserves live reasoning, tool, reasoning, and final-text order", () => {
  const { createThreadStream, applyThreadEvent } = require("../src/thread-stream")
  const sessionID = "ses_trace"
  const assistantMessageID = "msg_trace"
  const thread = createThreadStream(sessionID)
  const rawTurn = [
    { type: "session.execution.started", data: { sessionID } },
    { type: "session.step.started", data: { sessionID, assistantMessageID, agent: "build", model: {} } },
    { type: "session.reasoning.delta", data: { sessionID, assistantMessageID, ordinal: 0, delta: "Inspecting." } },
    { type: "session.reasoning.ended", data: { sessionID, assistantMessageID, ordinal: 0, text: "Inspecting." } },
    { type: "session.tool.input.started", data: { sessionID, assistantMessageID, id: "tool_search", name: "websearch" } },
    { type: "session.tool.called", data: { sessionID, assistantMessageID, id: "tool_search", input: { query: "weather" } } },
    { type: "session.tool.success", data: { sessionID, assistantMessageID, id: "tool_search", metadata: { provider: "exa" } } },
    { type: "session.step.ended", data: { sessionID, assistantMessageID, finish: "tool-calls", tokens: { output: 1, reasoning: 1 } } },
    { type: "session.step.started", data: { sessionID, assistantMessageID, agent: "build", model: {} } },
    { type: "session.reasoning.delta", data: { sessionID, assistantMessageID, ordinal: 1, delta: "Summarizing." } },
    { type: "session.reasoning.ended", data: { sessionID, assistantMessageID, ordinal: 1, text: "Summarizing." } },
    { type: "session.text.delta", data: { sessionID, assistantMessageID, ordinal: 2, delta: "Final answer." } },
    { type: "session.step.ended", data: { sessionID, assistantMessageID, finish: "stop", tokens: { output: 3, reasoning: 2 } } },
    { type: "session.execution.succeeded", data: { sessionID } }
  ]
  for (const raw of rawTurn) {
    const projected = projectRuntimeEvent(raw)
    if (projected) applyThreadEvent(thread, projected)
  }
  const message = thread.messages.find((item) => item.id === assistantMessageID)
  assert.deepEqual(message.parts.map((part) => [part.type, part.text || part.tool, part.state?.status]), [
    ["reasoning", "Inspecting.", undefined],
    ["tool", "websearch", "completed"],
    ["reasoning", "Summarizing.", undefined],
    ["text", "Final answer.", undefined]
  ])
  assert.equal(thread.status.type, "idle")
})

// --- VCS / working-copy events --------------------------------------------------------------
// These carry no session, so they bypass the thread machinery entirely and exist only to tell the
// Changes panel that something on disk moved. Only whitelisted fields may cross the IPC boundary.
test("v2 projects working-copy events and drops unlisted fields", () => {
  assert.deepEqual(
    projectRuntimeEvent({
      type: "filesystem.changed",
      data: { file: "src/app.js", event: "change", absolutePath: "/Users/me/secret/src/app.js" }
    }),
    { type: "filesystem.changed", file: "src/app.js", event: "change" }
  )

  assert.deepEqual(
    projectRuntimeEvent({ type: "vcs.branch.updated", data: { branch: "feat/x", sha: "deadbeef" } }),
    { type: "vcs.branch.updated", branch: "feat/x" }
  )
})

test("v2 working-copy events tolerate missing payload fields", () => {
  assert.deepEqual(
    projectRuntimeEvent({ type: "filesystem.changed", data: {} }),
    { type: "filesystem.changed", file: "", event: "" }
  )
  assert.deepEqual(
    projectRuntimeEvent({ type: "vcs.branch.updated", data: {} }),
    { type: "vcs.branch.updated", branch: "" }
  )
})

// --- Context meter / saved permissions / fs picker (opencode-v2-feature-backlog gap fill) ----

test("projectSavedPermission forwards safe fields and drops an entry with no id", () => {
  assert.deepEqual(
    projectSavedPermission({ id: "prm_1", projectID: "prj_1", action: "shell", resource: "npm *" }),
    { id: "prm_1", projectId: "prj_1", action: "shell", resource: "npm *" }
  )
  assert.equal(projectSavedPermission({ action: "shell" }), null)
  assert.equal(projectSavedPermission(null), null)
})

test("projectFileSystemEntry forwards path/type and drops malformed entries", () => {
  assert.deepEqual(projectFileSystemEntry({ path: "src/app.js", type: "file" }), { path: "src/app.js", type: "file" })
  assert.equal(projectFileSystemEntry({ path: "src", type: "socket" }), null)
  assert.equal(projectFileSystemEntry({ type: "file" }), null)
  assert.equal(projectFileSystemEntry(null), null)
})

test("sessionContext reads tokens.input off the last assistant message in the returned set", async () => {
  const http = require("node:http")
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({
      data: [
        { id: "msg_u", type: "user" },
        { id: "msg_a1", type: "assistant", tokens: { input: 500, output: 10, reasoning: 0, cache: { read: 0, write: 0 } } },
        { id: "msg_a2", type: "assistant", tokens: { input: 1234, output: 20, reasoning: 0, cache: { read: 0, write: 0 } } }
      ]
    }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
    assert.deepEqual(await manager.sessionContext({ sessionId: "ses_1" }), { messageCount: 3, inputTokens: 1234 })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("sessionContext returns null for an empty context and a null inputTokens when no message carries usage", async () => {
  const http = require("node:http")
  let call = 0
  const server = http.createServer((req, res) => {
    call += 1
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ data: call === 1 ? [] : [{ id: "msg_u", type: "user" }] }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
    assert.equal(await manager.sessionContext({ sessionId: "ses_1" }), null)
    assert.deepEqual(await manager.sessionContext({ sessionId: "ses_1" }), { messageCount: 1, inputTokens: null })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("sessionContext requires a session id", async () => {
  const manager = readyManager("http://127.0.0.1:1")
  await assert.rejects(() => manager.sessionContext({}), /Select a session/)
})

test("listSavedPermissions has no project filter, and removeSavedPermission DELETEs by id", async () => {
  const http = require("node:http")
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url })
    res.setHeader("Content-Type", "application/json")
    if (req.method === "DELETE") { res.end(); return }
    res.end(JSON.stringify({
      data: [
        { id: "prm_1", projectID: "prj_1", action: "shell", resource: "npm *" },
        { path: "dropped, no id" }
      ]
    }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
    const saved = await manager.listSavedPermissions()
    assert.deepEqual(saved, [{ id: "prm_1", projectId: "prj_1", action: "shell", resource: "npm *" }])
    assert.equal(requests[0].url, "/api/permission/saved")

    await manager.removeSavedPermission("prm_1")
    assert.equal(requests[1].method, "DELETE")
    assert.equal(requests[1].url, "/api/permission/saved/prm_1")
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("structured form pending/reply/cancel methods use the v2 endpoints", async () => {
  const http = require("node:http")
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null })
      if (req.method === "GET") {
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ data: [{
          id: "frm_1",
          sessionID: "ses_1",
          title: "Web Search",
          fields: [{ key: "choice", type: "string", required: true, options: [{ value: "allow", label: "Allow" }] }]
        }] }))
        return
      }
      res.statusCode = 204
      res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = new RuntimeProcessManager({ userDataPath: "/tmp/ow-forms", emit() {} })
    manager.child = {}
    manager.state.status = "running"
    manager.state.runtime = {
      serverUrl: `http://127.0.0.1:${server.address().port}`,
      auth: { username: "opencode", password: "pw" }
    }
    const pending = await manager.listPendingForms()
    assert.equal(pending[0].requestID, "frm_1")
    await manager.replyForm({ sessionId: "ses_1", formID: "frm_1", answer: { choice: "allow" } })
    await manager.cancelForm({ sessionId: "ses_1", formID: "frm_2" })
    assert.deepEqual(requests.map((request) => [request.method, request.url]), [
      ["GET", "/api/form/request"],
      ["POST", "/api/session/ses_1/form/frm_1/reply"],
      ["POST", "/api/session/ses_1/form/frm_2/cancel"]
    ])
    assert.deepEqual(requests[1].body, { answer: { choice: "allow" } })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

// Command.Info carries no source field on the real v2 API (verified live against a real
// opencode2 serve: name/template/description/agent/model/subtask only, additionalProperties:
// false) and skills live entirely separately behind /api/skill. Before this, listCommands()
// expected a source discriminator that never arrives, so selectableCommands() in renderer.js
// (filtering on source === "command" || source === "skill") matched nothing and the "/command"
// menu was always empty regardless of how many commands or skills were actually installed.
test("listCommands tags commands and skills itself instead of trusting a source field the wire never sends", async () => {
  const http = require("node:http")
  const fs = require("node:fs")
  const os = require("node:os")
  const path = require("node:path")
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "ow-listcommands-"))
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url === "/api/command") {
      res.end(JSON.stringify({ data: [{ name: "review", template: "review changes", description: "review changes" }] }))
      return
    }
    if (req.url === "/api/skill") {
      res.end(JSON.stringify({ data: [{ id: "find-bugs", name: "find-bugs", description: "Inspect code for likely defects.", location: path.join(profileDir, "skills", "find-bugs", "SKILL.md") }] }))
      return
    }
    res.end("{}")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`, { profile: { profileDir } })
    manager.state.runtime.cwd = profileDir
    const commands = await manager.listCommands()
    assert.equal(commands.length, 2)
    assert.equal(commands[0].source, "command")
    assert.equal(commands[1].source, "skill")
    assert.equal(commands[1].name, "find-bugs")
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})

test("removeSavedPermission requires an id", async () => {
  const manager = readyManager("http://127.0.0.1:1")
  await assert.rejects(() => manager.removeSavedPermission(""), /ID is required/)
})

test("findFiles skips the request entirely for a blank query", async () => {
  const http = require("node:http")
  let called = false
  const server = http.createServer((req, res) => { called = true; res.end("{}") })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
    assert.deepEqual(await manager.findFiles("/project", {}), [])
    assert.equal(called, false)
  } finally {
    server.close()
  }
})

test("findFiles and listFsEntries request the deepObject location[directory] and project safe fields", async () => {
  const http = require("node:http")
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push(req.url)
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({
      data: [{ path: "src/app.js", type: "file" }, { malformed: true }]
    }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
    const found = await manager.findFiles("/project", { query: "app", type: "file", limit: 10 })
    assert.deepEqual(found, [{ path: "src/app.js", type: "file" }])
    assert.match(decodeURIComponent(requests[0]), /location\[directory\]=\/project/)
    assert.match(requests[0], /query=app&type=file&limit=10/)

    const listed = await manager.listFsEntries("/project", "src")
    assert.deepEqual(listed, [{ path: "src/app.js", type: "file" }])
    assert.match(requests[1], /path=src/)
  } finally {
    server.close()
  }
})

test("readFsFile decodes the octet-stream body to utf8", async () => {
  const http = require("node:http")
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/octet-stream")
    res.end("hello from the server")
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
    assert.deepEqual(await manager.readFsFile("/project", "src/app.js"), { content: "hello from the server", truncated: false })
  } finally {
    server.close()
  }
})

test("readFsFile truncates rather than buffering past maxBytes", async () => {
  const http = require("node:http")
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/octet-stream")
    res.write("chunk-one-")
    res.write("chunk-two-is-way-past-the-limit")
    res.end()
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const manager = readyManager(`http://127.0.0.1:${server.address().port}`)
    const result = await manager.readFsFile("/project", "big.txt", { maxBytes: 5 })
    assert.equal(result.truncated, true)
  } finally {
    server.close()
  }
})

test("readFsFile requires a path", async () => {
  const manager = readyManager("http://127.0.0.1:1")
  await assert.rejects(() => manager.readFsFile("/project", ""), /path is required/)
})
