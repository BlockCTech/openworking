const DEFAULT_MAX_NODES = 100
const DEFAULT_CONCURRENCY = 8
const PENDING_EVENT_LIMIT = 64
const PENDING_SESSION_LIMIT = 200
const TOOL_CALL_LIMIT = 200

function text(value) {
  if (typeof value !== "string") return ""
  return value.trim()
}

function number(value) {
  return Number.isFinite(value) ? Number(value) : undefined
}

function sessionParentId(session) {
  return text(session?.parentID || session?.parentSessionId)
}

function sessionCreatedAt(session) {
  return number(session?.time?.created) ?? number(session?.time?.updated)
}

function sessionFinishedAt(session) {
  return number(session?.time?.completed)
}

function eventSessionId(event) {
  return text(event?.data?.sessionID)
}

function eventSequence(event) {
  return number(event?.durable?.seq)
}

function sourceKey(sessionId, messageId, callId) {
  return `${sessionId}\u0000${messageId}\u0000${callId}`
}

function subagentMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const sessionId = text(metadata.sessionID || metadata.childID)
  if (!sessionId) return null
  const rawStatus = text(metadata.status || metadata.state)
  const status = rawStatus === "running"
    ? "running"
    : rawStatus === "completed"
      ? "succeeded"
      : rawStatus === "error" || rawStatus === "cancelled" || rawStatus === "failed"
        ? "failed"
        : null
  return { sessionId, status }
}

function createNode(sessionId, parentSessionId, session = {}) {
  return {
    sessionId,
    parentSessionId,
    agent: text(session.agent),
    description: "",
    title: text(session.title),
    createdAt: sessionCreatedAt(session),
    startedAt: undefined,
    finishedAt: sessionFinishedAt(session),
    durableStatus: null,
    provisionalStatus: null,
    lifecycleSeq: -1
  }
}

function cloneNode(node) {
  return { ...node }
}

function createRoot(rootSessionId, previous) {
  return {
    rootSessionId,
    nodes: new Map(),
    cursors: new Map(previous?.cursors || []),
    toolCalls: new Map(),
    revision: previous?.revision || 0,
    signature: previous?.signature || "",
    truncated: false,
    hydrationGeneration: (previous?.hydrationGeneration || 0) + 1,
    hydrationBuffer: []
  }
}

function nodeStatus(node) {
  return node.durableStatus || node.provisionalStatus || "succeeded"
}

function projectedNode(node, childrenByParent) {
  return {
    sessionId: node.sessionId,
    parentSessionId: node.parentSessionId,
    ...(node.agent ? { agent: node.agent } : {}),
    ...(node.description ? { description: node.description } : {}),
    ...(node.title ? { title: node.title } : {}),
    status: nodeStatus(node),
    ...(node.startedAt !== undefined ? { startedAt: node.startedAt } : {}),
    ...(node.finishedAt !== undefined ? { finishedAt: node.finishedAt } : {}),
    children: (childrenByParent.get(node.sessionId) || []).map((child) => projectedNode(child, childrenByParent))
  }
}

function projectTree(root) {
  const childrenByParent = new Map()
  for (const node of root.nodes.values()) {
    const siblings = childrenByParent.get(node.parentSessionId) || []
    siblings.push(node)
    childrenByParent.set(node.parentSessionId, siblings)
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => {
      const created = (left.createdAt || 0) - (right.createdAt || 0)
      return created || left.sessionId.localeCompare(right.sessionId)
    })
  }
  return {
    rootSessionId: root.rootSessionId,
    revision: root.revision,
    runs: (childrenByParent.get(root.rootSessionId) || []).map((node) => projectedNode(node, childrenByParent)),
    truncated: root.truncated
  }
}

async function mapLimit(items, limit, run) {
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++]
      await run(item)
    }
  })
  await Promise.all(workers)
}

class SubagentRunTreeTracker {
  constructor({
    onUpdate = () => {},
    maxNodes = DEFAULT_MAX_NODES,
    concurrency = DEFAULT_CONCURRENCY
  } = {}) {
    this.onUpdate = onUpdate
    this.maxNodes = maxNodes
    this.concurrency = concurrency
    this.roots = new Map()
    this.candidateSessions = new Map()
    this.forkSessionIds = new Set()
    this.pendingEvents = new Map()
  }

  reset() {
    this.roots.clear()
    this.candidateSessions.clear()
    this.forkSessionIds.clear()
    this.pendingEvents.clear()
  }

  snapshot(rootSessionId) {
    const root = this.roots.get(rootSessionId)
    if (!root) {
      return { rootSessionId, revision: 0, runs: [], truncated: false }
    }
    return projectTree(root)
  }

  rememberCandidate(session) {
    if (!session?.id) return
    const sessionId = text(session.id)
    if (!sessionId) return
    if (session.fork) this.forkSessionIds.add(sessionId)
    this.candidateSessions.set(sessionId, session)
    while (this.candidateSessions.size > PENDING_SESSION_LIMIT) {
      this.candidateSessions.delete(this.candidateSessions.keys().next().value)
    }
  }

  rememberPending(event) {
    const sessionId = eventSessionId(event)
    if (!sessionId) return
    const events = this.pendingEvents.get(sessionId) || []
    if (events.length < PENDING_EVENT_LIMIT) events.push(event)
    this.pendingEvents.set(sessionId, events)
    while (this.pendingEvents.size > PENDING_SESSION_LIMIT) {
      this.pendingEvents.delete(this.pendingEvents.keys().next().value)
    }
  }

  addNode(root, sessionId, parentSessionId, session = {}) {
    if (!sessionId || !parentSessionId || sessionId === root.rootSessionId) return null
    if (this.forkSessionIds.has(sessionId) || session.fork) return null
    const parentKnown = parentSessionId === root.rootSessionId || root.nodes.has(parentSessionId)
    if (!parentKnown) return null
    let node = root.nodes.get(sessionId)
    if (!node) {
      if (root.nodes.size >= this.maxNodes) {
        root.truncated = true
        return null
      }
      node = createNode(sessionId, parentSessionId, session)
      root.nodes.set(sessionId, node)
    } else {
      node.parentSessionId = parentSessionId
      if (!node.agent) node.agent = text(session.agent)
      if (!node.title) node.title = text(session.title)
      if (node.createdAt === undefined) node.createdAt = sessionCreatedAt(session)
    }
    const pendingEvents = this.pendingEvents.get(sessionId) || []
    this.pendingEvents.delete(sessionId)
    for (const pending of pendingEvents) {
      this.applyToRoot(root, pending, { rememberUnknown: false })
    }
    return node
  }

  updateToolCall(root, key, patch) {
    const call = { ...(root.toolCalls.get(key) || {}), ...patch }
    root.toolCalls.set(key, call)
    while (root.toolCalls.size > TOOL_CALL_LIMIT) {
      root.toolCalls.delete(root.toolCalls.keys().next().value)
    }
    return call
  }

  linkCandidateDescendants(root, parentSessionId) {
    const parents = [parentSessionId]
    let changed = false
    for (let index = 0; index < parents.length; index += 1) {
      const parentId = parents[index]
      for (const candidate of this.candidateSessions.values()) {
        const sessionId = text(candidate?.id)
        if (!sessionId || root.nodes.has(sessionId) || sessionParentId(candidate) !== parentId) continue
        const node = this.addNode(root, sessionId, parentId, candidate)
        if (!node) continue
        this.applyProvisional(node, "running", candidate?.time?.created)
        parents.push(sessionId)
        changed = true
      }
    }
    return changed
  }

  removeNode(root, sessionId) {
    if (!root.nodes.has(sessionId)) return false
    const removing = [sessionId]
    for (let index = 0; index < removing.length; index += 1) {
      const parentId = removing[index]
      for (const node of root.nodes.values()) {
        if (node.parentSessionId === parentId) removing.push(node.sessionId)
      }
    }
    for (const id of removing) root.nodes.delete(id)
    return true
  }

  applyLifecycle(node, event) {
    const seq = eventSequence(event)
    if (seq !== undefined && seq <= node.lifecycleSeq) return false
    if (seq === undefined && node.lifecycleSeq >= 0) return false
    const type = event.type
    const status = type === "session.execution.started"
      ? "running"
      : type === "session.execution.succeeded"
        ? "succeeded"
        : type === "session.execution.failed" || type === "session.execution.interrupted"
          ? "failed"
          : null
    if (!status) return false
    if (seq !== undefined) node.lifecycleSeq = seq
    node.durableStatus = status
    node.provisionalStatus = null
    if (status === "running") {
      node.startedAt = number(event.created) ?? node.startedAt
      node.finishedAt = undefined
    } else {
      node.finishedAt = number(event.created) ?? node.finishedAt
    }
    return true
  }

  applyProvisional(node, status, at) {
    if (!status || node.durableStatus) return false
    if (node.provisionalStatus === status) return false
    node.provisionalStatus = status
    if (status === "running") {
      node.startedAt = number(at) ?? node.startedAt
      node.finishedAt = undefined
    } else {
      node.finishedAt = number(at) ?? node.finishedAt
    }
    return true
  }

  applyToolMetadata(root, event, metadata, input) {
    const found = subagentMetadata(metadata)
    if (!found) return false
    const parentSessionId = eventSessionId(event)
    const candidate = this.candidateSessions.get(found.sessionId) || {}
    const node = this.addNode(root, found.sessionId, parentSessionId, candidate)
    if (!node) return false
    this.linkCandidateDescendants(root, node.sessionId)
    const agent = text(input?.agent || candidate.agent)
    const description = text(input?.description)
    if (agent && node.agent !== agent) {
      node.agent = agent
    }
    if (description && node.description !== description) {
      node.description = description
    }
    if (node.createdAt === undefined) node.createdAt = number(event.created)
    const fallbackStatus = event.type === "session.tool.failed"
      ? "failed"
      : event.type === "session.tool.success"
        ? "succeeded"
        : found.status
    this.applyProvisional(node, fallbackStatus, event.created)
    return true
  }

  applyToRoot(root, event, { rememberUnknown = true } = {}) {
    if (!event?.type) return false
    const data = event.data || {}
    const sessionId = eventSessionId(event)

    if (event.type === "session.deleted" && sessionId) {
      this.removeNode(root, sessionId)
      return true
    }
    if (event.type === "session.forked" && sessionId) {
      this.forkSessionIds.add(sessionId)
      this.removeNode(root, sessionId)
      return true
    }
    if (event.type === "session.created") {
      const info = data.info || data.session || {}
      if (info.id) this.rememberCandidate(info)
      const parentSessionId = sessionParentId(info)
      if (!info.id || !parentSessionId) return false
      const node = this.addNode(root, text(info.id), parentSessionId, info)
      if (!node) return false
      this.applyProvisional(node, "running", event.created ?? info.time?.created)
      this.linkCandidateDescendants(root, node.sessionId)
      return true
    }

    const node = root.nodes.get(sessionId)
    if (
      node &&
      (
        event.type === "session.execution.started" ||
        event.type === "session.execution.succeeded" ||
        event.type === "session.execution.failed" ||
        event.type === "session.execution.interrupted"
      )
    ) {
      this.applyLifecycle(node, event)
      return true
    }

    if (event.type === "session.tool.input.started") {
      if (sessionId !== root.rootSessionId && !root.nodes.has(sessionId)) {
        if (rememberUnknown) this.rememberPending(event)
        return false
      }
      const key = sourceKey(sessionId, data.assistantMessageID, data.id)
      if (text(data.name) !== "subagent") {
        this.updateToolCall(root, key, { isSubagent: false })
        return true
      }
      this.updateToolCall(root, key, { isSubagent: true })
      return true
    }
    if (event.type === "session.tool.called") {
      if (sessionId !== root.rootSessionId && !root.nodes.has(sessionId)) {
        if (rememberUnknown) this.rememberPending(event)
        return false
      }
      const key = sourceKey(sessionId, data.assistantMessageID, data.id)
      if (root.toolCalls.get(key)?.isSubagent === false) {
        root.toolCalls.delete(key)
        return true
      }
      const call = this.updateToolCall(root, key, {
        input: data.input && typeof data.input === "object" ? data.input : {},
        hasInput: true
      })
      if (call.metadata) {
        this.applyToolMetadata(root, {
          ...event,
          type: call.terminalType || event.type,
          data: { ...data, metadata: call.metadata }
        }, call.metadata, call.input)
      }
      if (call.terminalType) root.toolCalls.delete(key)
      return true
    }
    if (
      event.type === "session.tool.progress" ||
      event.type === "session.tool.success" ||
      event.type === "session.tool.failed"
    ) {
      if (sessionId !== root.rootSessionId && !root.nodes.has(sessionId)) {
        if (rememberUnknown) this.rememberPending(event)
        return false
      }
      const key = sourceKey(sessionId, data.assistantMessageID, data.id)
      const terminalType = event.type === "session.tool.progress" ? null : event.type
      if (root.toolCalls.get(key)?.isSubagent === false) {
        if (terminalType) root.toolCalls.delete(key)
        return true
      }
      const call = this.updateToolCall(root, key, {
        isSubagent: true,
        ...(data.metadata ? { metadata: data.metadata } : {}),
        ...(terminalType ? { terminalType } : {})
      })
      const handled = this.applyToolMetadata(root, event, call.metadata, call.input)
      if (terminalType && call.hasInput) root.toolCalls.delete(key)
      return handled
    }
    if (event.type === "session.synthetic" && data.metadata?.source === "subagent") {
      const changed = this.applyToolMetadata(root, event, data.metadata, {
        agent: data.metadata.agent,
        description: data.description
      })
      return changed
    }
    if (event.type === "message.part.updated") {
      const part = data.part
      const toolName = text(part?.name || part?.tool)
      if (part?.type !== "tool" || toolName !== "subagent") return false
      return this.applyToolMetadata(root, event, part.state?.metadata, part.state?.input)
    }

    if (rememberUnknown && sessionId && sessionId !== root.rootSessionId && !node) {
      this.rememberPending(event)
    }
    return false
  }

  publish(root) {
    const tree = projectTree(root)
    const signature = JSON.stringify({ runs: tree.runs, truncated: tree.truncated })
    if (signature === root.signature) return tree
    root.signature = signature
    root.revision += 1
    tree.revision = root.revision
    this.onUpdate(tree)
    return tree
  }

  applyEvent(event) {
    if (!event?.type) return
    const data = event.data || {}
    if (event.type === "session.created") {
      const info = data.info || data.session || {}
      if (info.id) this.rememberCandidate(info)
    }
    if (event.type === "session.forked" && data.sessionID) this.forkSessionIds.add(data.sessionID)
    if (event.type === "session.deleted" && data.sessionID) {
      this.candidateSessions.delete(data.sessionID)
      this.pendingEvents.delete(data.sessionID)
    }
    let handled = false
    for (const root of this.roots.values()) {
      if (root.hydrationBuffer) root.hydrationBuffer.push(event)
      if (this.applyToRoot(root, event, { rememberUnknown: false })) {
        handled = true
        this.publish(root)
      }
    }
    if (!handled) this.rememberPending(event)
  }

  async hydrate(rootSessionId, { listChildren, listActive, readLog }) {
    const rootId = text(rootSessionId)
    if (!rootId) throw new Error("Session ID is required.")
    const previous = this.roots.get(rootId) || createRoot(rootId)
    const generation = previous.hydrationGeneration + 1
    previous.hydrationGeneration = generation
    previous.hydrationBuffer = []
    if (!this.roots.has(rootId)) this.roots.set(rootId, previous)

    const next = createRoot(rootId, previous)
    next.hydrationGeneration = generation
    const queue = [rootId]
    const visited = new Set(queue)

    while (queue.length && next.nodes.size < this.maxNodes) {
      const parents = queue.splice(0, this.concurrency)
      let discoveryError = null
      const families = await Promise.all(parents.map(async (parentId) => {
        try {
          const sessions = await listChildren(parentId, this.maxNodes - next.nodes.size)
          return { parentId, sessions: Array.isArray(sessions) ? sessions : [] }
        } catch (error) {
          discoveryError ||= error
          return { parentId, sessions: [] }
        }
      }))
      if (discoveryError) {
        previous.hydrationBuffer = null
        throw discoveryError
      }
      for (const { parentId, sessions } of families) {
        for (const session of sessions) {
          if (!session?.id || visited.has(session.id)) continue
          visited.add(session.id)
          this.rememberCandidate(session)
          if (session.fork || this.forkSessionIds.has(session.id)) continue
          if (next.nodes.size >= this.maxNodes) {
            next.truncated = true
            break
          }
          const parentSessionId = sessionParentId(session) || parentId
          const old = previous.nodes.get(session.id)
          if (old) {
            next.nodes.set(session.id, {
              ...cloneNode(old),
              parentSessionId,
              agent: text(session.agent) || old.agent,
              title: text(session.title) || old.title,
              createdAt: sessionCreatedAt(session) ?? old.createdAt
            })
          }
          const node = this.addNode(next, session.id, parentSessionId, session)
          if (!node) continue
          queue.push(session.id)
        }
      }
    }
    if (queue.length) next.truncated = true

    let active = {}
    try {
      active = await listActive()
    } catch {}
    const activeIds = new Set(Array.isArray(active) ? active.map((item) => item?.id || item) : Object.keys(active || {}))

    const logSessionIds = [rootId, ...next.nodes.keys()]
    let logError = null
    await mapLimit(logSessionIds, this.concurrency, async (sessionId) => {
      const after = previous.cursors.get(sessionId)
      let items = []
      try {
        items = await readLog(sessionId, after)
      } catch (error) {
        logError ||= error
        return
      }
      let cursor = after
      for (const event of Array.isArray(items) ? items : []) {
        if (event?.type === "log.synced") {
          if (Number.isFinite(event.seq)) cursor = event.seq
          continue
        }
        this.applyToRoot(next, event, { rememberUnknown: false })
        if (Number.isFinite(event?.durable?.seq)) cursor = Math.max(cursor ?? -1, event.durable.seq)
      }
      if (Number.isFinite(cursor)) next.cursors.set(sessionId, cursor)
    })
    if (logError) {
      previous.hydrationBuffer = null
      throw logError
    }

    for (const sessionId of activeIds) {
      const node = next.nodes.get(sessionId)
      if (node) this.applyProvisional(node, "running")
    }
    for (const event of previous.hydrationBuffer || []) {
      this.applyToRoot(next, event, { rememberUnknown: false })
    }

    if (this.roots.get(rootId) !== previous || previous.hydrationGeneration !== generation) {
      return this.snapshot(rootId)
    }
    next.revision = previous.revision
    next.signature = previous.signature
    next.hydrationBuffer = null
    this.roots.set(rootId, next)
    return this.publish(next)
  }
}

module.exports = {
  DEFAULT_MAX_NODES,
  SubagentRunTreeTracker,
  subagentMetadata
}
