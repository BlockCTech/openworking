const test = require("node:test")
const assert = require("node:assert/strict")
const { SubagentRunTreeTracker } = require("../src/runtime/subagent-run-tree")

function durable(type, sessionID, seq, created = seq * 100) {
  return {
    type,
    created,
    durable: { aggregateID: sessionID, seq, version: 1 },
    data: { sessionID }
  }
}

function tool(type, parentID, {
  childID,
  status = "running",
  id = "call_1",
  input
} = {}) {
  if (type === "session.tool.input.started") {
    return {
      type,
      created: 10,
      data: { sessionID: parentID, assistantMessageID: "msg_1", id, name: "subagent" }
    }
  }
  if (type === "session.tool.called") {
    return {
      type,
      created: 20,
      data: { sessionID: parentID, assistantMessageID: "msg_1", id, input: input || {} }
    }
  }
  return {
    type,
    created: 30,
    data: {
      sessionID: parentID,
      assistantMessageID: "msg_1",
      id,
      metadata: { sessionID: childID, status }
    }
  }
}

function hydration({
  families = {},
  active = {},
  logs = {}
} = {}) {
  return {
    listChildren: async (parentID) => families[parentID] || [],
    listActive: async () => active,
    readLog: async (sessionID) => [...(logs[sessionID] || []), {
      type: "log.synced",
      aggregateID: sessionID,
      seq: Math.max(-1, ...(logs[sessionID] || []).map((event) => event.durable?.seq ?? -1))
    }]
  }
}

test("hydrates a stable nested run tree and excludes user-created forks", async () => {
  const tracker = new SubagentRunTreeTracker()
  const tree = await tracker.hydrate("ses_root", hydration({
    families: {
      ses_root: [
        { id: "ses_b", parentID: "ses_root", title: "Second", agent: "review", time: { created: 20 } },
        { id: "ses_a", parentID: "ses_root", title: "First", agent: "build", time: { created: 10 } },
        { id: "ses_fork", parentID: "ses_root", fork: { sessionID: "ses_root" }, title: "User fork" }
      ],
      ses_a: [
        { id: "ses_nested", parentID: "ses_a", title: "Nested", agent: "research", time: { created: 30 } }
      ]
    },
    logs: {
      ses_a: [durable("session.execution.succeeded", "ses_a", 2)],
      ses_b: [durable("session.execution.failed", "ses_b", 3)],
      ses_nested: [durable("session.execution.started", "ses_nested", 1)]
    }
  }))

  assert.deepEqual(tree.runs.map((run) => run.sessionId), ["ses_a", "ses_b"])
  assert.equal(tree.runs[0].status, "succeeded")
  assert.equal(tree.runs[0].children[0].sessionId, "ses_nested")
  assert.equal(tree.runs[0].children[0].status, "running")
  assert.equal(tree.runs[1].status, "failed")
  assert.equal(tree.truncated, false)
})

test("subagent tool metadata links a child and carries agent and description", async () => {
  const tracker = new SubagentRunTreeTracker()
  await tracker.hydrate("ses_root", hydration())

  tracker.applyEvent(tool("session.tool.input.started", "ses_root"))
  tracker.applyEvent(tool("session.tool.called", "ses_root", {
    input: { agent: "review", description: "Audit the patch", prompt: "secret prompt" }
  }))
  tracker.applyEvent(tool("session.tool.progress", "ses_root", { childID: "ses_child" }))

  assert.deepEqual(tracker.snapshot("ses_root").runs, [{
    sessionId: "ses_child",
    parentSessionId: "ses_root",
    agent: "review",
    description: "Audit the patch",
    status: "running",
    startedAt: 30,
    children: []
  }])
  assert.equal(JSON.stringify(tracker.snapshot("ses_root")).includes("secret prompt"), false)
})

test("tool metadata and input merge when progress arrives before the call payload", async () => {
  const tracker = new SubagentRunTreeTracker()
  await tracker.hydrate("ses_root", hydration())

  tracker.applyEvent(tool("session.tool.progress", "ses_root", { childID: "ses_child" }))
  tracker.applyEvent(tool("session.tool.called", "ses_root", {
    input: { agent: "review", description: "Late description", prompt: "private prompt" }
  }))

  const child = tracker.snapshot("ses_root").runs[0]
  assert.equal(child.agent, "review")
  assert.equal(child.description, "Late description")
  assert.equal(child.status, "running")
  assert.equal(JSON.stringify(child).includes("private prompt"), false)

  tracker.applyEvent({
    type: "session.tool.failed",
    created: 40,
    data: { sessionID: "ses_root", assistantMessageID: "msg_1", id: "call_1" }
  })
  assert.equal(tracker.snapshot("ses_root").runs[0].status, "failed")
})

test("buffers terminal lifecycle until child linkage arrives", async () => {
  const tracker = new SubagentRunTreeTracker()
  await tracker.hydrate("ses_root", hydration())

  tracker.applyEvent(durable("session.execution.failed", "ses_child", 4, 400))
  tracker.applyEvent(tool("session.tool.input.started", "ses_root"))
  tracker.applyEvent(tool("session.tool.called", "ses_root", {
    input: { agent: "build", description: "Implement feature" }
  }))
  tracker.applyEvent(tool("session.tool.progress", "ses_root", { childID: "ses_child" }))

  const child = tracker.snapshot("ses_root").runs[0]
  assert.equal(child.status, "failed")
  assert.equal(child.finishedAt, 400)
})

test("authoritative parent linkage replays lifecycle even when descendants arrive first", async () => {
  const tracker = new SubagentRunTreeTracker()
  await tracker.hydrate("ses_root", hydration())

  tracker.applyEvent({
    type: "session.created",
    created: 20,
    data: { info: { id: "ses_nested", parentID: "ses_child", title: "Nested" } }
  })
  tracker.applyEvent(durable("session.execution.failed", "ses_nested", 2, 200))
  tracker.applyEvent({
    type: "session.created",
    created: 10,
    data: { info: { id: "ses_child", parentID: "ses_root", title: "Child" } }
  })

  const child = tracker.snapshot("ses_root").runs[0]
  assert.equal(child.sessionId, "ses_child")
  assert.equal(child.status, "running")
  assert.equal(child.children[0].sessionId, "ses_nested")
  assert.equal(child.children[0].status, "failed")
  assert.equal(child.children[0].finishedAt, 200)
})

test("durable ordering ignores stale lifecycle and terminal state rejects late progress", async () => {
  const tracker = new SubagentRunTreeTracker()
  await tracker.hydrate("ses_root", hydration({
    families: {
      ses_root: [{ id: "ses_child", parentID: "ses_root", time: { created: 1 } }]
    },
    logs: {
      ses_child: [durable("session.execution.succeeded", "ses_child", 8, 800)]
    }
  }))

  tracker.applyEvent(durable("session.execution.started", "ses_child", 7, 700))
  tracker.applyEvent(tool("session.tool.progress", "ses_root", { childID: "ses_child" }))
  assert.equal(tracker.snapshot("ses_root").runs[0].status, "succeeded")

  tracker.applyEvent(durable("session.execution.started", "ses_child", 9, 900))
  assert.equal(tracker.snapshot("ses_root").runs[0].status, "running")
  assert.equal(tracker.snapshot("ses_root").runs[0].finishedAt, undefined)
})

test("reconnect applies only log events after the saved cursor and merges live events", async () => {
  const calls = []
  const tracker = new SubagentRunTreeTracker()
  const base = {
    listChildren: async (parentID) => parentID === "ses_root"
      ? [{ id: "ses_child", parentID: "ses_root", time: { created: 1 } }]
      : [],
    listActive: async () => ({}),
    readLog: async (sessionID, after) => {
      calls.push([sessionID, after])
      return sessionID === "ses_child"
        ? [durable("session.execution.succeeded", "ses_child", 5), {
            type: "log.synced", aggregateID: sessionID, seq: 5
          }]
        : [{ type: "log.synced", aggregateID: sessionID, seq: 2 }]
    }
  }
  await tracker.hydrate("ses_root", base)

  let release
  const waiting = new Promise((resolve) => { release = resolve })
  const reconnect = tracker.hydrate("ses_root", {
    ...base,
    readLog: async (sessionID, after) => {
      calls.push([sessionID, after])
      await waiting
      return [{ type: "log.synced", aggregateID: sessionID, seq: after }]
    }
  })
  tracker.applyEvent(durable("session.execution.failed", "ses_child", 6, 600))
  tracker.applyEvent(durable("session.execution.started", "ses_child", 7, 700))
  const liveRevision = tracker.snapshot("ses_root").revision
  release()
  const tree = await reconnect

  assert.ok(calls.some(([sessionID, after]) => sessionID === "ses_child" && after === 5))
  assert.equal(tree.runs[0].status, "running")
  assert.ok(tree.revision >= liveRevision)

  tracker.applyEvent(durable("session.execution.failed", "ses_child", 8, 800))
  assert.ok(tracker.snapshot("ses_root").revision > tree.revision)
})

test("caps breadth-first discovery and reports truncation", async () => {
  const tracker = new SubagentRunTreeTracker({ maxNodes: 2 })
  const tree = await tracker.hydrate("ses_root", hydration({
    families: {
      ses_root: [
        { id: "ses_1", parentID: "ses_root", time: { created: 1 } },
        { id: "ses_2", parentID: "ses_root", time: { created: 2 } },
        { id: "ses_3", parentID: "ses_root", time: { created: 3 } }
      ]
    }
  }))

  assert.deepEqual(tree.runs.map((run) => run.sessionId), ["ses_1", "ses_2"])
  assert.equal(tree.truncated, true)
})

test("a failed reconnect preserves the last valid tree", async () => {
  const tracker = new SubagentRunTreeTracker()
  await tracker.hydrate("ses_root", hydration({
    families: {
      ses_root: [{ id: "ses_child", parentID: "ses_root", time: { created: 1 } }]
    },
    logs: {
      ses_child: [durable("session.execution.succeeded", "ses_child", 2)]
    }
  }))

  await assert.rejects(tracker.hydrate("ses_root", {
    listChildren: async () => { throw new Error("offline") },
    listActive: async () => ({}),
    readLog: async () => []
  }), /offline/)
  assert.equal(tracker.snapshot("ses_root").runs[0].status, "succeeded")
})
