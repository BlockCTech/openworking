// Runtime wire contract: the OpenCode server's endpoint paths, event envelope shape and
// event/part type names, expressed as DATA rather than inline string literals.
//
// A spike against real opencode2 v0.0.0-next-16350 showed v2 changes three axes at once: every
// path gains an `/api` prefix and permission/question replies become session-scoped, the SSE
// payload key moves from `properties` to `data`, and several event type names are renamed or
// removed. Unknown event types are dropped silently, so a wrong contract produces a blank thread
// with no error — hence one centralized, diffable, unit-testable surface. Pure data and pure
// functions: no I/O, no state.
//
// Evidence: .agents/evidence/v2-openapi-0.0.0-next-16350.json, .agents/evidence/v2-real-event-stream.jsonl
// Plan: .agents/plans/2026-07-28-opencode-v2-migration.md

const RUNTIME_MAJOR_V2 = 2

// Message part types accepted from the runtime; anything else is dropped by projectMessagePart.
// Deliberately NOT the list thread-stream.js projects — that layer also emits `file-ref` and
// `error` parts, which the app synthesizes and which never arrive over the wire.
//
// v2 still serves parts under `SessionV1.*` schemas, and its union keeps all four of these
// (alongside agent/compaction/patch/retry/snapshot/step-*/subtask, which we drop).
// `SessionV1.ToolState` retains status/input/title/metadata/time/error, so tool artifact and
// diff surfacing is unaffected.
const V2_PART_TYPES = ["text", "tool", "file", "reasoning"]

// Every path below was read from the OpenAPI document served by a real `opencode2 serve`
// (0.0.0-next-16350) and archived under .agents/evidence/ — none of it transcribed from docs.

const V2_ENDPOINTS = {
  health: ({ serverUrl }) => `${serverUrl}/api/health`,
  events: ({ serverUrl }) => `${serverUrl}/api/event`,
  sessions: ({ serverUrl }) => `${serverUrl}/api/session`,
  sessionsByDirectory: ({ serverUrl, directory }) =>
    `${serverUrl}/api/session?directory=${encodeURIComponent(directory)}`,
  sessionsByParent: ({ serverUrl, parentId, limit = 100 }) =>
    `${serverUrl}/api/session?parentID=${encodeURIComponent(parentId)}&limit=${limit}&order=asc`,
  sessionActive: ({ serverUrl }) => `${serverUrl}/api/session/active`,
  session: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}`,
  sessionLog: ({ serverUrl, sessionId, after, follow = false }) => {
    const afterParam = Number.isFinite(after) ? `&after=${after}` : ""
    return `${serverUrl}/api/experimental/session/${encodeURIComponent(sessionId)}/log?follow=${follow ? "true" : "false"}${afterParam}`
  },
  // `order=asc` is required, not cosmetic: v2 defaults this endpoint to `desc`, which renders the
  // thread upside down. Verified live — with no order param the assistant came back at index 0
  // and the older user message at index 1. Per the v2 OpenAPI ("Do not combine with order"),
  // `order` applies only to the first page, so callers send it once and only `cursor` after that.
  sessionMessages: ({ serverUrl, sessionId, limit, directory, cursor }) => {
    const dirParam = directory ? `&directory=${encodeURIComponent(directory)}` : ""
    const pageParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "&order=asc"
    return `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/message?limit=${limit}${pageParam}${dirParam}`
  },
  sessionPending: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/pending`,
  // v2 has no `prompt_async`; `/prompt` is already async — it returns SessionPending.User
  // immediately and idleness is observed separately (there is also a `/wait` endpoint).
  sessionPrompt: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/prompt`,
  sessionCommand: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/command`,
  sessionSkill: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/skill`,
  // `abort` was renamed to `interrupt`.
  sessionAbort: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/interrupt`,
  sessionFork: ({ serverUrl, sessionId, directory }) => {
    const dirParam = directory ? `?directory=${encodeURIComponent(directory)}` : ""
    return `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/fork${dirParam}`
  },
  sessionRename: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/rename`,
  sessionAgent: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/agent`,
  sessionModel: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/model`,
  sessionCompact: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/compact`,
  // The set of messages the model would currently see as context (post-compaction if a compaction
  // has run). Used to refill the context-usage ring after `session.compaction.ended`, where the
  // last observed inputTokens is stale.
  sessionContext: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/context`,
  sessionRevertStage: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/revert/stage`,
  sessionRevertClear: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/revert/clear`,
  sessionRevertCommit: ({ serverUrl, sessionId }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/revert/commit`,
  commands: ({ serverUrl }) => `${serverUrl}/api/command`,
  skills: ({ serverUrl }) => `${serverUrl}/api/skill`,
  // VCS working-copy status and diffs. Unlike every other endpoint here, these take the target
  // directory as an OpenAPI `deepObject` param (`location[directory]`), NOT the flat `directory`
  // that `sessionsByDirectory` above uses. This is load-bearing and was verified against a live
  // server with two separate repos: a flat `?directory=` is silently IGNORED — the server answers
  // HTTP 200 with the files of ITS OWN cwd. Copying the sessionsByDirectory shape here would make
  // the Changes panel show another worktree's files with no error, so the brackets stay encoded.
  vcsStatus: ({ serverUrl, directory }) =>
    `${serverUrl}/api/vcs/status?location%5Bdirectory%5D=${encodeURIComponent(directory)}`,
  // `mode` is required, not optional: omitting it returns HTTP 400 (verified live).
  vcsDiff: ({ serverUrl, directory, mode = "working" }) =>
    `${serverUrl}/api/vcs/diff?location%5Bdirectory%5D=${encodeURIComponent(directory)}&mode=${encodeURIComponent(mode)}`,
  // GET-only (no POST/PUT/DELETE variant in the OpenAPI path list) — add/remove is a client-side
  // concern against the global opencode.json `references` map. Same deepObject param as above.
  // CAVEAT: a live spike against v0.0.0-next-16365 with a real `references` entry returned
  // `data: []` in every permutation tried (no location, matching directory, path inside vs.
  // outside it) — 200 but never populated from config. Not re-probed against the current pin.
  references: ({ serverUrl, directory }) =>
    `${serverUrl}/api/reference?location%5Bdirectory%5D=${encodeURIComponent(directory)}`,
  // Durable "Allow always" permission decisions. `projectID` is optional in the OpenAPI spec;
  // this app has no server-side project registry wired up (no `/api/project` call anywhere), so
  // it is omitted and the list comes back unfiltered — each PermissionSaved.Info still carries
  // its own `projectID`, which the settings UI surfaces per row instead of using it to filter.
  permissionSaved: ({ serverUrl }) => `${serverUrl}/api/permission/saved`,
  permissionSavedItem: ({ serverUrl, id }) =>
    `${serverUrl}/api/permission/saved/${encodeURIComponent(id)}`,
  permissionPending: ({ serverUrl }) => `${serverUrl}/api/permission/request`,
  questionPending: ({ serverUrl }) => `${serverUrl}/api/question/request`,
  formPending: ({ serverUrl }) => `${serverUrl}/api/form/request`,
  formReply: ({ serverUrl, sessionId, formID }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/form/${encodeURIComponent(formID)}/reply`,
  formCancel: ({ serverUrl, sessionId, formID }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/form/${encodeURIComponent(formID)}/cancel`,
  // Filesystem endpoints the runtime itself resolves file scope/ignore rules for. Same deepObject
  // `location[directory]` param as vcsStatus/vcsDiff/references above.
  fsFind: ({ serverUrl, directory, query, type, limit }) => {
    const typeParam = type ? `&type=${encodeURIComponent(type)}` : ""
    const limitParam = Number.isFinite(limit) ? `&limit=${limit}` : ""
    return `${serverUrl}/api/fs/find?location%5Bdirectory%5D=${encodeURIComponent(directory)}&query=${encodeURIComponent(query)}${typeParam}${limitParam}`
  },
  fsList: ({ serverUrl, directory, path = "" }) => {
    const pathParam = path ? `&path=${encodeURIComponent(path)}` : ""
    return `${serverUrl}/api/fs/list?location%5Bdirectory%5D=${encodeURIComponent(directory)}${pathParam}`
  },
  // Response is `application/octet-stream`, not JSON — callers must use a binary-aware request
  // helper, not requestJson.
  fsRead: ({ serverUrl, directory, path }) =>
    `${serverUrl}/api/fs/read/${path.split("/").map(encodeURIComponent).join("/")}?location%5Bdirectory%5D=${encodeURIComponent(directory)}`,
  // PTY / shell terminal. Live-spiked against the earlier bundled opencode2 binary (v0.0.0-next-16365):
  // create/list/get/update(resize)/remove all work exactly as documented, using the same
  // deepObject `location[directory]` param as vcsStatus/vcsDiff/references above.
  pty: ({ serverUrl, directory }) =>
    `${serverUrl}/api/pty?location%5Bdirectory%5D=${encodeURIComponent(directory)}`,
  ptyItem: ({ serverUrl, ptyId, directory }) =>
    `${serverUrl}/api/pty/${encodeURIComponent(ptyId)}?location%5Bdirectory%5D=${encodeURIComponent(directory)}`,
  // GET /api/pty/{ptyID}/connect is a WebSocket upgrade (OpenAPI `x-websocket: true`). The
  // documented auth path — POST /api/pty/{ptyID}/connect-token — is CONFIRMED BROKEN in that
  // build: every variant tried live (empty body, {}, no Content-Type, Origin, X-Requested-With,
  // no query string) returned 403 {"_tag":"ForbiddenError","message":"Invalid PTY connect token
  // request"}, so there is deliberately no ptyConnectToken entry — do not build against it.
  // What works, live-verified: the handshake accepts the same HTTP Basic-auth header as every
  // other request, with no ticket. RuntimeProcessManager.connectPty attaches Authorization.
  ptyConnect: ({ serverUrl, ptyId, directory }) =>
    `${serverUrl.replace(/^http/, "ws")}/api/pty/${encodeURIComponent(ptyId)}/connect?location%5Bdirectory%5D=${encodeURIComponent(directory)}`,
  mcp: ({ serverUrl }) => `${serverUrl}/api/mcp`,
  mcpServer: ({ serverUrl, name, path = "" }) =>
    `${serverUrl}/api/mcp/${encodeURIComponent(name)}${path}`,
  mcpConnect: ({ serverUrl, name }) =>
    `${serverUrl}/api/mcp/${encodeURIComponent(name)}/connect`,
  mcpDisconnect: ({ serverUrl, name }) =>
    `${serverUrl}/api/mcp/${encodeURIComponent(name)}/disconnect`,
  // Inverse of the v1 quirk: v2 reply routes ARE session-scoped. Using the v1 (unscoped)
  // shape here returns a clean 404 rather than v1's silent-200 hang — verified against the
  // running server — so a mistake is loud, but the sessionId is now required.
  permissionReply: ({ serverUrl, sessionId, requestID }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/permission/${encodeURIComponent(requestID)}/reply`,
  questionReply: ({ serverUrl, sessionId, requestID }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/question/${encodeURIComponent(requestID)}/reply`,
  questionReject: ({ serverUrl, sessionId, requestID }) =>
    `${serverUrl}/api/session/${encodeURIComponent(sessionId)}/question/${encodeURIComponent(requestID)}/reject`
}

// v2 event names. Five v1 events we consumed no longer exist; the mapping is NOT 1:1:
//   - `session.aborted`      -> `session.execution.interrupted`
//   - `message.part.delta`   -> `session.text.delta` (different payload fields, see below)
//   - the four `mcp.status.*`-> a single `mcp.status.changed` carrying `data.server`
// `catalogUpdated`/`commandUpdated` are new and load-bearing: v2 populates its command and
// skill catalog asynchronously (GET /api/command answers 200 with an empty list for seconds
// after health passes), so the app must refresh on these instead of caching the first reply.
const V2_EVENTS = {
  serverConnected: "server.connected",
  sessionCreated: "session.created",
  sessionDeleted: "session.deleted",
  sessionForked: "session.forked",
  sessionSynthetic: "session.synthetic",
  sessionStatus: "session.status",
  sessionIdle: "session.idle",
  sessionExecutionStarted: "session.execution.started",
  sessionAborted: "session.execution.interrupted",
  sessionError: "session.error",
  messageUpdated: "message.updated",
  messagePartUpdated: "message.part.updated",
  messagePartDelta: "session.text.delta",
  questionAsked: "question.asked",
  questionReplied: "question.replied",
  questionRejected: "question.rejected",
  permissionAsked: "permission.asked",
  permissionReplied: "permission.replied",
  formCreated: "form.created",
  formReplied: "form.replied",
  formCancelled: "form.cancelled",
  mcpStatusChanged: "mcp.status.changed",
  catalogUpdated: "catalog.updated",
  commandUpdated: "command.updated",
  skillUpdated: "skill.updated",
  // "reference.updated" is confirmed present in the OpenAPI evidence's event-name list, but was
  // never observed on the wire during the /api/reference spike above (see the `references`
  // endpoint comment) — no reference config change was ever reflected back, consistent with the
  // endpoint itself not yet returning configured data in this pinned version.
  referenceUpdated: "reference.updated",
  // Unlike reference.updated above, these ARE confirmed live: subscribed to /api/event before a
  // short-lived pty (`echo quick-output; exit 7`) and saw both arrive in order with the documented
  // shapes ({data:{info:Pty}} created, {data:{id,exitCode}} exited). pty.updated and pty.deleted
  // come from the OpenAPI schema only — their shapes mirror these, but they were not exercised.
  ptyCreated: "pty.created",
  ptyUpdated: "pty.updated",
  ptyExited: "pty.exited",
  ptyDeleted: "pty.deleted",
  // A completed agent turn. `session.idle` exists in the v2 schema but was NOT observed on the
  // wire for a normal turn — a real LLM reply ended with session.execution.succeeded and no
  // session.idle. Both are treated as "turn finished" so the thread never stays stuck busy.
  sessionExecutionSucceeded: "session.execution.succeeded",
  // Start of an assistant turn. v2 emits no `message.updated` for the assistant message, so this
  // is what tells the app a new assistant message exists (it carries assistantMessageID).
  sessionStepStarted: "session.step.started",
  // End of an assistant turn, carrying `finish`, `cost` and `tokens`. v2 never emits
  // `message.updated`, so without projecting this the message never reaches a "completed" state:
  // the footer's duration/token line stays hidden and any completion-gated UI never fires.
  sessionStepEnded: "session.step.ended",
  // Reasoning streams on its own event family: v2 has no `field` discriminator and splits answer
  // text from reasoning by event name instead.
  //
  // Both events are load-bearing — the delta alone is not enough. The delta is declared
  // `e.ephemeral` while started/ended are `e.durable`, and ephemeral events are not replayed, so
  // a reconnect or a client joining mid-turn loses them. `ended` is authoritative: its `text` is
  // required and the runtime's reducer OVERWRITES with it (`delta: text += data.delta` vs
  // `ended: text = data.text`), so mapping only the delta drops reasoning on any missed delta.
  sessionReasoningDelta: "session.reasoning.delta",
  sessionReasoningEnded: "session.reasoning.ended",
  // Failure counterparts of the two events above. A failed turn emits these INSTEAD of
  // `session.execution.succeeded` / `session.step.ended`, so leaving them unmapped strands the
  // thread in `busy` forever with no error shown.
  sessionExecutionFailed: "session.execution.failed",
  sessionToolInputStarted: "session.tool.input.started",
  sessionToolInputEnded: "session.tool.input.ended",
  sessionToolCalled: "session.tool.called",
  sessionToolProgress: "session.tool.progress",
  sessionToolSuccess: "session.tool.success",
  sessionToolFailed: "session.tool.failed",
  sessionStepFailed: "session.step.failed",
  sessionAgentSelected: "session.agent.selected",
  sessionModelSelected: "session.model.selected",
  sessionInputAdmitted: "session.input.admitted",
  sessionInputPromoted: "session.input.promoted",
  sessionCompactionAdmitted: "session.compaction.admitted",
  sessionCompactionStarted: "session.compaction.started",
  sessionCompactionDelta: "session.compaction.delta",
  sessionCompactionEnded: "session.compaction.ended",
  sessionCompactionFailed: "session.compaction.failed",
  sessionRevertStaged: "session.revert.staged",
  sessionRevertCleared: "session.revert.cleared",
  sessionRevertCommitted: "session.revert.committed",
  // Working-copy watch events. Mapped and projected, but no runtime through the pinned
  // 0.0.0-next-17055 ships the native `@parcel/watcher-<platform>-<arch>` binding that core
  // resolves through, and it is not a dependency — optional or otherwise — of @opencode-ai/cli.
  // A next-16365 live probe showed directory watching log "watcher backend not supported" and
  // no-op: file creates/edits/deletes produced no event while `catalog.updated` still arrived,
  // ruling out an SSE-side fault. The Changes panel refreshes off session-idle / focus /
  // branch-switch instead. These stay mapped so it becomes realtime once a runtime ships it.
  filesystemChanged: "filesystem.changed",
  vcsBranchUpdated: "vcs.branch.updated"
}

// Two more v1→v2 shape changes, confirmed against a live server with a real LLM reply. Both are
// invisible until the wrong shape is sent, and both fail in ways that are easy to misread:
//
//  1. Prompt body is `{ text, files }`, NOT v1's `{ parts: [...] }` — sending `parts` returns
//     HTTP 400 `Missing key at ["text"]`. Each file matches
//     components.schemas["PromptInput.FileAttachment"] in
//     .agents/evidence/v2-openapi-1.18.8-latest.json: { uri (required), name?, description?,
//     source? }. There is no `/api/attachment` endpoint — this inline shape, built by
//     buildPromptBody() below, is the only wire contract for attachments, local or external.
//  2. REST `GET .../message` returns flat messages using `content[]` — no `info` wrapper, and
//     `role` is now `type`. The SSE stream is unaffected: `message.part.updated.data.part` is
//     still the v1-shaped `SessionV1.*` union, so part projection carries over.
//
// v2's text delta also carries `{assistantMessageID, ordinal, delta}` with NO `field` key; text
// vs reasoning is distinguished by event name (session.text.* vs session.reasoning.*).
const V2_PROMPT_BODY_KEY = "text"
const V2_MESSAGE_CONTENT_KEY = "content"

const V2_CONTRACT = {
  major: RUNTIME_MAJOR_V2,
  promptBodyKey: V2_PROMPT_BODY_KEY,
  messageContentKey: V2_MESSAGE_CONTENT_KEY,
  // Observed on the real wire: { id, created, type, durable:{aggregateID,seq,version}, data:{...} }
  eventPayloadKey: "data",
  // v2 wraps JSON responses: { data: ..., location: ... }, and list responses add `cursor`.
  responseEnvelopeKey: "data",
  endpoints: V2_ENDPOINTS,
  events: V2_EVENTS,
  partTypes: V2_PART_TYPES,
  serveArgs: ({ port, hostname }) => ["serve", "--port", String(port), "--hostname", hostname]
}

const CONTRACTS = new Map([[RUNTIME_MAJOR_V2, V2_CONTRACT]])

// Resolve the contract for a runtime major version. Unknown majors throw rather than falling
// back: stale URLs against a newer server can fail as a blank thread rather than a loud error.
function runtimeContract(major = RUNTIME_MAJOR_V2) {
  const contract = CONTRACTS.get(Number(major))
  if (!contract) throw new Error(`Unsupported OpenCode runtime major version: ${major}`)
  return contract
}

// Read an SSE event's payload without hardcoding the envelope key.
function eventPayload(event, contract = V2_CONTRACT) {
  return event?.[contract.eventPayloadKey] || {}
}

// Unwrap a JSON response body that may be enveloped. v1 returns bare values.
function responseData(body, contract = V2_CONTRACT) {
  const key = contract.responseEnvelopeKey
  if (!key) return body
  if (body && typeof body === "object" && !Array.isArray(body) && key in body) return body[key]
  return body
}

function validateSessionInputPayload(payload) {
  const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId.trim() : ""
  const inputId = typeof payload?.inputId === "string" ? payload.inputId.trim() : ""
  const delivery = typeof payload?.delivery === "string" ? payload.delivery.trim() : ""
  if (!sessionId) throw new Error("Session ID is required.")
  if (!/^msg_[A-Za-z0-9_-]{8,128}$/.test(inputId)) throw new Error("A valid input ID is required.")
  if (delivery !== "queue" && delivery !== "steer") throw new Error("Delivery must be queue or steer.")
  return { sessionId, inputId, delivery, resume: payload?.resume !== false }
}

module.exports = {
  RUNTIME_MAJOR_V2,
  V2_CONTRACT,
  runtimeContract,
  eventPayload,
  responseData,
  validateSessionInputPayload
}
