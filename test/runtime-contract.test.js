const test = require("node:test")
const assert = require("node:assert/strict")
const {
  RUNTIME_MAJOR_V2,
  V2_CONTRACT,
  runtimeContract,
  eventPayload,
  responseData,
  validateSessionInputPayload
} = require("../src/runtime/runtime-contract")

const SERVER = "http://127.0.0.1:4096"

test("runtimeContract resolves v2 and rejects unknown majors", () => {
  assert.equal(runtimeContract(), V2_CONTRACT)
  assert.equal(runtimeContract(RUNTIME_MAJOR_V2), V2_CONTRACT)
  assert.equal(runtimeContract("2"), V2_CONTRACT)
  // Falling back for an unknown major would ship the wrong URLs at the server, which fails
  // as a silently blank thread instead of a loud error.
  assert.throws(() => runtimeContract(1), /Unsupported OpenCode runtime major version: 1/)
  assert.throws(() => runtimeContract(99), /Unsupported OpenCode runtime major version/)
})

// --- v2 -------------------------------------------------------------------
// Every expectation below mirrors a path in the archived OpenAPI document
// (.agents/evidence/v2-openapi-0.0.0-next-16350.json), which was served by a real
// `opencode2 serve`. These are regression guards against silent drift, not documentation.

test("v2 prefixes every endpoint with /api", () => {
  const e = V2_CONTRACT.endpoints
  assert.equal(e.health({ serverUrl: SERVER }), `${SERVER}/api/health`)
  assert.equal(e.events({ serverUrl: SERVER }), `${SERVER}/api/event`)
  assert.equal(e.sessions({ serverUrl: SERVER }), `${SERVER}/api/session`)
  assert.equal(e.sessionActive({ serverUrl: SERVER }), `${SERVER}/api/session/active`)
  assert.equal(e.commands({ serverUrl: SERVER }), `${SERVER}/api/command`)
  // No `models` endpoint: the app ships a single pinned model and never reads the
  // runtime's model catalog. See DEFAULT_CONFIG in opencode-config.js.
  assert.equal(e.models, undefined)
  assert.equal(e.skills({ serverUrl: SERVER }), `${SERVER}/api/skill`)
  assert.equal(
    e.sessionSkill({ serverUrl: SERVER, sessionId: "ses/a" }),
    `${SERVER}/api/session/ses%2Fa/skill`
  )
  assert.equal(e.mcp({ serverUrl: SERVER }), `${SERVER}/api/mcp`)
  assert.equal(
    e.session({ serverUrl: SERVER, sessionId: "ses_1" }),
    `${SERVER}/api/session/ses_1`
  )
  assert.equal(
    e.sessionRename({ serverUrl: SERVER, sessionId: "ses_1" }),
    `${SERVER}/api/session/ses_1/rename`
  )
  assert.equal(
    e.sessionAgent({ serverUrl: SERVER, sessionId: "ses_1" }),
    `${SERVER}/api/session/ses_1/agent`
  )
  assert.equal(
    e.sessionModel({ serverUrl: SERVER, sessionId: "ses_1" }),
    `${SERVER}/api/session/ses_1/model`
  )
  assert.equal(
    e.sessionCompact({ serverUrl: SERVER, sessionId: "ses_1" }),
    `${SERVER}/api/session/ses_1/compact`
  )
  assert.equal(
    e.sessionPending({ serverUrl: SERVER, sessionId: "ses_1" }),
    `${SERVER}/api/session/ses_1/pending`
  )
  assert.equal(
    e.sessionRevertStage({ serverUrl: SERVER, sessionId: "ses_1" }),
    `${SERVER}/api/session/ses_1/revert/stage`
  )
  assert.equal(
    e.sessionRevertClear({ serverUrl: SERVER, sessionId: "ses_1" }),
    `${SERVER}/api/session/ses_1/revert/clear`
  )
  assert.equal(
    e.sessionRevertCommit({ serverUrl: SERVER, sessionId: "ses_1" }),
    `${SERVER}/api/session/ses_1/revert/commit`
  )
})

test("v2 renames prompt_async to prompt and abort to interrupt", () => {
  const e = V2_CONTRACT.endpoints
  assert.equal(
    e.sessionPrompt({ serverUrl: SERVER, sessionId: "ses_1" }),
    `${SERVER}/api/session/ses_1/prompt`
  )
  assert.equal(
    e.sessionAbort({ serverUrl: SERVER, sessionId: "ses_1" }),
    `${SERVER}/api/session/ses_1/interrupt`
  )
})

// The inverse of the v1 quirk. Getting this wrong is loud in v2 (404) rather than a silent
// 200, but the sessionId is now a required part of the route.
test("v2 permission and question replies are session-scoped", () => {
  const e = V2_CONTRACT.endpoints
  assert.equal(
    e.permissionReply({ serverUrl: SERVER, sessionId: "ses_1", requestID: "per_1" }),
    `${SERVER}/api/session/ses_1/permission/per_1/reply`
  )
  assert.equal(
    e.questionReply({ serverUrl: SERVER, sessionId: "ses_1", requestID: "q_1" }),
    `${SERVER}/api/session/ses_1/question/q_1/reply`
  )
  assert.equal(
    e.questionReject({ serverUrl: SERVER, sessionId: "ses_1", requestID: "q_1" }),
    `${SERVER}/api/session/ses_1/question/q_1/reject`
  )
})

test("v2 form endpoints are session-scoped and encode ids", () => {
  const endpoints = V2_CONTRACT.endpoints
  assert.equal(endpoints.formPending({ serverUrl: "http://runtime" }), "http://runtime/api/form/request")
  assert.equal(endpoints.formReply({ serverUrl: "http://runtime", sessionId: "ses /1", formID: "frm /1" }), "http://runtime/api/session/ses%20%2F1/form/frm%20%2F1/reply")
  assert.equal(endpoints.formCancel({ serverUrl: "http://runtime", sessionId: "ses /1", formID: "frm /1" }), "http://runtime/api/session/ses%20%2F1/form/frm%20%2F1/cancel")
})

test("v2 endpoint builders encode ids and keep optional params optional", () => {
  const e = V2_CONTRACT.endpoints
  assert.equal(
    e.sessionsByDirectory({ serverUrl: SERVER, directory: "/tmp/a b" }),
    `${SERVER}/api/session?directory=%2Ftmp%2Fa%20b`
  )
  assert.equal(
    e.permissionReply({ serverUrl: SERVER, sessionId: "a/b", requestID: "p?1" }),
    `${SERVER}/api/session/a%2Fb/permission/p%3F1/reply`
  )
  // order=asc is load-bearing: v2 defaults to desc, which renders the thread upside down.
  assert.equal(
    e.sessionMessages({ serverUrl: SERVER, sessionId: "ses_1", limit: 100 }),
    `${SERVER}/api/session/ses_1/message?limit=100&order=asc`
  )
  assert.equal(
    e.sessionMessages({ serverUrl: SERVER, sessionId: "ses_1", limit: 50, directory: "/p" }),
    `${SERVER}/api/session/ses_1/message?limit=50&order=asc&directory=%2Fp`
  )
  assert.equal(
    e.sessionFork({ serverUrl: SERVER, sessionId: "ses_1" }),
    `${SERVER}/api/session/ses_1/fork`
  )
  assert.equal(
    e.sessionsByParent({ serverUrl: SERVER, parentId: "ses/a", limit: 25 }),
    `${SERVER}/api/session?parentID=ses%2Fa&limit=25&order=asc`
  )
  assert.equal(
    e.sessionLog({ serverUrl: SERVER, sessionId: "ses/a" }),
    `${SERVER}/api/experimental/session/ses%2Fa/log?follow=false`
  )
  assert.equal(
    e.sessionLog({ serverUrl: SERVER, sessionId: "ses_1", after: 7 }),
    `${SERVER}/api/experimental/session/ses_1/log?follow=false&after=7`
  )
})

// Five v1 events do not exist in v2. This is the highest-risk surface in the migration:
// unknown event types are dropped silently, so a bad mapping shows up as a blank thread
// with no error rather than a failure.
test("v2 remaps the renamed and collapsed event names", () => {
  const v2 = V2_CONTRACT.events
  assert.equal(v2.sessionAborted, "session.execution.interrupted")
  assert.equal(v2.messagePartDelta, "session.text.delta")
  assert.equal(v2.mcpStatusChanged, "mcp.status.changed")
  // The four v1 mcp.status.* names are gone, not renamed one-to-one.
  const names = new Set(Object.values(v2))
  for (const gone of [
    "session.aborted",
    "message.part.delta",
    "mcp.status.needs_auth",
    "mcp.status.connected",
    "mcp.status.failed",
    "mcp.status.disabled"
  ]) {
    assert.equal(names.has(gone), false, `${gone} must not appear in the v2 event table`)
  }
  // Names that genuinely survived unchanged.
  for (const key of [
    "serverConnected",
    "sessionCreated",
    "sessionStatus",
    "sessionIdle",
    "sessionError",
    "messageUpdated",
    "messagePartUpdated",
    "questionAsked",
    "permissionAsked"
  ]) {
    assert.ok(v2[key], `${key} must be named in the v2 event table`)
  }
})

// v2 builds its command/skill catalog asynchronously: GET /api/command answers 200 with an
// empty list for seconds after health passes. Without these events the app would cache that
// empty first response and show no commands at all.
test("v2 names the catalog-refresh events the async catalog needs", () => {
  assert.equal(V2_CONTRACT.events.catalogUpdated, "catalog.updated")
  assert.equal(V2_CONTRACT.events.commandUpdated, "command.updated")
  assert.equal(V2_CONTRACT.events.skillUpdated, "skill.updated")
})

test("v2 names model selection, compaction and revert lifecycle events", () => {
  assert.equal(V2_CONTRACT.events.sessionAgentSelected, "session.agent.selected")
  assert.equal(V2_CONTRACT.events.sessionModelSelected, "session.model.selected")
  assert.deepEqual(
    [
      V2_CONTRACT.events.sessionCompactionAdmitted,
      V2_CONTRACT.events.sessionCompactionStarted,
      V2_CONTRACT.events.sessionCompactionDelta,
      V2_CONTRACT.events.sessionCompactionEnded,
      V2_CONTRACT.events.sessionCompactionFailed
    ],
    [
      "session.compaction.admitted",
      "session.compaction.started",
      "session.compaction.delta",
      "session.compaction.ended",
      "session.compaction.failed"
    ]
  )
  assert.deepEqual(
    [
      V2_CONTRACT.events.sessionRevertStaged,
      V2_CONTRACT.events.sessionRevertCleared,
      V2_CONTRACT.events.sessionRevertCommitted
    ],
    ["session.revert.staged", "session.revert.cleared", "session.revert.committed"]
  )
})

test("v2 names durable input admission and promotion events", () => {
  assert.equal(V2_CONTRACT.events.sessionInputAdmitted, "session.input.admitted")
  assert.equal(V2_CONTRACT.events.sessionInputPromoted, "session.input.promoted")
})

test("v2 names subagent discovery, tool and lifecycle events", () => {
  const events = V2_CONTRACT.events
  assert.deepEqual(
    [
      events.sessionExecutionStarted,
      events.sessionExecutionSucceeded,
      events.sessionExecutionFailed,
      events.sessionAborted
    ],
    [
      "session.execution.started",
      "session.execution.succeeded",
      "session.execution.failed",
      "session.execution.interrupted"
    ]
  )
  assert.deepEqual(
    [
      events.sessionToolInputStarted,
      events.sessionToolInputEnded,
      events.sessionToolCalled,
      events.sessionToolProgress,
      events.sessionToolSuccess,
      events.sessionToolFailed
    ],
    [
      "session.tool.input.started",
      "session.tool.input.ended",
      "session.tool.called",
      "session.tool.progress",
      "session.tool.success",
      "session.tool.failed"
    ]
  )
  assert.equal(events.sessionForked, "session.forked")
  assert.equal(events.sessionDeleted, "session.deleted")
  assert.equal(events.sessionSynthetic, "session.synthetic")
})

test("v2 names structured form lifecycle events", () => {
  assert.deepEqual(
    [V2_CONTRACT.events.formCreated, V2_CONTRACT.events.formReplied, V2_CONTRACT.events.formCancelled],
    ["form.created", "form.replied", "form.cancelled"]
  )
})

test("session input contract validates stable ids, delivery and resume", () => {
  assert.deepEqual(validateSessionInputPayload({
    sessionId: " ses_1 ",
    inputId: " msg_12345678 ",
    delivery: "queue"
  }), {
    sessionId: "ses_1",
    inputId: "msg_12345678",
    delivery: "queue",
    resume: true
  })
  assert.deepEqual(validateSessionInputPayload({
    sessionId: "ses_1",
    inputId: "msg_abcdefgh",
    delivery: "steer",
    resume: false
  }), {
    sessionId: "ses_1",
    inputId: "msg_abcdefgh",
    delivery: "steer",
    resume: false
  })
  assert.throws(() => validateSessionInputPayload({
    sessionId: "ses_1",
    inputId: "local_1",
    delivery: "queue"
  }), /valid input ID/)
  assert.throws(() => validateSessionInputPayload({
    sessionId: "ses_1",
    inputId: "msg_12345678",
    delivery: "later"
  }), /queue or steer/)
})

test("v2 reads the SSE payload from `data` and unwraps enveloped responses", () => {
  assert.equal(V2_CONTRACT.eventPayloadKey, "data")
  assert.equal(V2_CONTRACT.responseEnvelopeKey, "data")
  // Shape captured from the real wire, including the `durable` ordering envelope.
  const live = {
    id: "evt_1",
    type: "session.execution.started",
    durable: { aggregateID: "ses_1", seq: 3, version: 1 },
    data: { sessionID: "ses_1" }
  }
  assert.deepEqual(eventPayload(live, V2_CONTRACT), { sessionID: "ses_1" })
  // A v1-shaped event must not resolve under the v2 contract.
  assert.deepEqual(eventPayload({ type: "x", properties: { sessionID: "ses_1" } }, V2_CONTRACT), {})
  assert.deepEqual(responseData({ data: [{ id: "ses_1" }], cursor: null }, V2_CONTRACT), [
    { id: "ses_1" }
  ])
  assert.deepEqual(responseData({ data: { id: "ses_1" } }, V2_CONTRACT), { id: "ses_1" })
  // Already-unwrapped payloads pass through rather than becoming undefined.
  assert.deepEqual(responseData([{ id: "ses_1" }], V2_CONTRACT), [{ id: "ses_1" }])
})

test("v2 accepts the same runtime part types as v1", () => {
  assert.deepEqual(V2_CONTRACT.partTypes, ["text", "tool", "file", "reasoning"])
})

// The delta is ephemeral (never replayed) while `ended` is durable and carries the authoritative
// full text, so both must be mapped or reasoning is lost on any dropped delta.
test("v2 maps both reasoning events, not just the ephemeral delta", () => {
  assert.equal(V2_CONTRACT.events.sessionReasoningDelta, "session.reasoning.delta")
  assert.equal(V2_CONTRACT.events.sessionReasoningEnded, "session.reasoning.ended")
})

test("v2 serve args drop the v1-only --print-logs flag", () => {
  assert.deepEqual(
    V2_CONTRACT.serveArgs({ port: 4096, hostname: "127.0.0.1" }),
    ["serve", "--port", "4096", "--hostname", "127.0.0.1"]
  )
})

// Both verified against a live server: sending v1's `{parts}` to v2 returns
// HTTP 400 `Missing key at ["text"]`, and v2's REST messages are flat with `content[]`.
test("v2 uses `text` for prompts and `content` for message bodies", () => {
  assert.equal(V2_CONTRACT.promptBodyKey, "text")
  assert.equal(V2_CONTRACT.messageContentKey, "content")
})

test("the contract pins the axes that break silently when wrong", () => {
  assert.equal(V2_CONTRACT.major, 2)
  assert.equal(V2_CONTRACT.eventPayloadKey, "data")
  assert.equal(V2_CONTRACT.responseEnvelopeKey, "data")
  assert.equal(V2_CONTRACT.endpoints.health({ serverUrl: SERVER }), `${SERVER}/api/health`)
})

// The VCS endpoints take the target directory as an OpenAPI `deepObject` param, unlike
// sessionsByDirectory's flat `directory`. Verified against a live server with two separate repos:
// a flat `?directory=` is IGNORED and answers HTTP 200 with the server cwd's files, so getting
// this wrong would show another worktree's changes with no error to notice.
test("v2 VCS endpoints encode the directory as a deepObject location param", () => {
  const directory = "/tmp/work space/repo"
  const encoded = "location%5Bdirectory%5D=%2Ftmp%2Fwork%20space%2Frepo"

  const status = V2_CONTRACT.endpoints.vcsStatus({ serverUrl: SERVER, directory })
  assert.equal(status, `${SERVER}/api/vcs/status?${encoded}`)
  assert.match(status, /location%5Bdirectory%5D=/)
  // A flat `directory=` would be silently ignored by the server.
  assert.equal(/[?&]directory=/.test(status), false)

  // `mode` is required: omitting it returns HTTP 400 (verified live), so it must always be sent.
  assert.equal(
    V2_CONTRACT.endpoints.vcsDiff({ serverUrl: SERVER, directory }),
    `${SERVER}/api/vcs/diff?${encoded}&mode=working`
  )
  assert.equal(
    V2_CONTRACT.endpoints.vcsDiff({ serverUrl: SERVER, directory, mode: "branch" }),
    `${SERVER}/api/vcs/diff?${encoded}&mode=branch`
  )
})

test("v2 maps the working-copy event names", () => {
  assert.equal(V2_CONTRACT.events.filesystemChanged, "filesystem.changed")
  assert.equal(V2_CONTRACT.events.vcsBranchUpdated, "vcs.branch.updated")
})

// PTY endpoints take the target directory as the same deepObject `location[directory]` param as
// vcsStatus/vcsDiff/references. ptyConnect additionally swaps the http(s) scheme for ws(s) and
// carries NO ticket param — a live spike against the pinned opencode2 binary confirmed
// POST /api/pty/{ptyID}/connect-token (the documented ticket endpoint) returns a consistent 403
// in every variant tried, while the WebSocket handshake accepts the same Basic-auth header used
// for every other request with no ticket at all.
test("v2 PTY endpoints encode the directory as a deepObject location param", () => {
  const directory = "/tmp/work space/project"
  const encoded = "location%5Bdirectory%5D=%2Ftmp%2Fwork%20space%2Fproject"

  const collection = V2_CONTRACT.endpoints.pty({ serverUrl: SERVER, directory })
  assert.equal(collection, `${SERVER}/api/pty?${encoded}`)
  assert.equal(/[?&]directory=/.test(collection), false)

  const item = V2_CONTRACT.endpoints.ptyItem({ serverUrl: SERVER, ptyId: "pty_abc123", directory })
  assert.equal(item, `${SERVER}/api/pty/pty_abc123?${encoded}`)
})

test("v2 ptyConnect builds a ws:// URL with no ticket param, swapping the http(s) scheme for ws(s)", () => {
  const directory = "/tmp/project"
  const encoded = "location%5Bdirectory%5D=%2Ftmp%2Fproject"

  const httpUrl = V2_CONTRACT.endpoints.ptyConnect({ serverUrl: "http://127.0.0.1:4096", ptyId: "pty_xyz", directory })
  assert.equal(httpUrl, `ws://127.0.0.1:4096/api/pty/pty_xyz/connect?${encoded}`)
  assert.equal(/ticket=/.test(httpUrl), false)

  const httpsUrl = V2_CONTRACT.endpoints.ptyConnect({ serverUrl: "https://127.0.0.1:4096", ptyId: "pty_xyz", directory })
  assert.equal(httpsUrl, `wss://127.0.0.1:4096/api/pty/pty_xyz/connect?${encoded}`)
})

test("v2 maps the pty lifecycle event names", () => {
  assert.equal(V2_CONTRACT.events.ptyCreated, "pty.created")
  assert.equal(V2_CONTRACT.events.ptyUpdated, "pty.updated")
  assert.equal(V2_CONTRACT.events.ptyExited, "pty.exited")
  assert.equal(V2_CONTRACT.events.ptyDeleted, "pty.deleted")
})

test("v2 sessionContext scopes to the session id", () => {
  assert.equal(
    V2_CONTRACT.endpoints.sessionContext({ serverUrl: SERVER, sessionId: "ses_abc" }),
    `${SERVER}/api/session/ses_abc/context`
  )
})

// projectID is optional in the OpenAPI spec, and this app has no server-side project registry
// wired up (no `/api/project` call anywhere) to supply one, so the endpoint never encodes it.
test("v2 permissionSaved has no project filter and permissionSavedItem encodes the id", () => {
  assert.equal(V2_CONTRACT.endpoints.permissionSaved({ serverUrl: SERVER }), `${SERVER}/api/permission/saved`)
  assert.equal(
    V2_CONTRACT.endpoints.permissionSavedItem({ serverUrl: SERVER, id: "prm_abc/def" }),
    `${SERVER}/api/permission/saved/prm_abc%2Fdef`
  )
})

// Same deepObject `location[directory]` param as vcsStatus/vcsDiff/references/pty above — a flat
// `directory=` is silently ignored by the server (see the vcsStatus test).
test("v2 fs endpoints encode the directory as a deepObject location param", () => {
  const directory = "/tmp/work space/repo"
  const encoded = "location%5Bdirectory%5D=%2Ftmp%2Fwork%20space%2Frepo"

  const find = V2_CONTRACT.endpoints.fsFind({ serverUrl: SERVER, directory, query: "read me" })
  assert.equal(find, `${SERVER}/api/fs/find?${encoded}&query=read%20me`)
  assert.equal(/[?&]directory=/.test(find), false)

  const findTyped = V2_CONTRACT.endpoints.fsFind({ serverUrl: SERVER, directory, query: "x", type: "file", limit: 20 })
  assert.equal(findTyped, `${SERVER}/api/fs/find?${encoded}&query=x&type=file&limit=20`)

  const list = V2_CONTRACT.endpoints.fsList({ serverUrl: SERVER, directory })
  assert.equal(list, `${SERVER}/api/fs/list?${encoded}`)
  const listPath = V2_CONTRACT.endpoints.fsList({ serverUrl: SERVER, directory, path: "src/a b" })
  assert.equal(listPath, `${SERVER}/api/fs/list?${encoded}&path=src%2Fa%20b`)

  const read = V2_CONTRACT.endpoints.fsRead({ serverUrl: SERVER, directory, path: "src/a b.js" })
  assert.equal(read, `${SERVER}/api/fs/read/src/a%20b.js?${encoded}`)
})
