(function exposeThreadStream(root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  if (root) root.OpenWorkingThreadStream = api
})(typeof window === "object" ? window : globalThis, function createThreadStreamApi() {
  let optimisticId = 0
  const OFFICE_ATTACHMENT_CONTEXT_MARKER = "Attached Office files are provided as local paths plus extracted text context"
  const NO_RESPONSE_DETAIL = "The request ended without a response. Check provider/model/API key or runtime diagnostics."

  function idleStatus() {
    return { type: "idle" }
  }

  function createThreadStream(sessionId = null) {
    return {
      sessionId,
      status: idleStatus(),
      messages: [],
      pendingQuestions: [],
      pendingPermissions: []
    }
  }

  function resetThread(thread, sessionId = null) {
    thread.sessionId = sessionId
    thread.status = idleStatus()
    thread.messages = []
    thread.pendingQuestions = []
    thread.pendingPermissions = []
    return thread
  }

  function projectPart(part, fallbackId) {
    if (!part) return null
    if (part.type === "text") {
      return {
        id: part.id || fallbackId,
        sessionID: part.sessionID,
        messageID: part.messageID,
        type: "text",
        text: part.text || "",
        ...(part.synthetic === true ? { synthetic: true } : {})
      }
    }
    if (part.type === "tool") {
      const metadata = part.state?.metadata
      return {
        id: part.id || fallbackId,
        sessionID: part.sessionID,
        messageID: part.messageID,
        type: "tool",
        tool: part.tool,
        state: {
          status: part.state?.status || "pending",
          input: part.state?.input || {},
          title: part.state?.title,
          error: part.state?.error,
          ...(metadata ? { metadata } : {})
        }
      }
    }
    if (part.type === "file") {
      return {
        id: part.id || fallbackId,
        sessionID: part.sessionID,
        messageID: part.messageID,
        type: "file",
        filename: part.filename || "file",
        mime: part.mime || "application/octet-stream"
      }
    }
    if (part.type === "error") {
      return {
        id: part.id || fallbackId,
        messageID: part.messageID,
        type: "error",
        title: part.title || "Request failed",
        detail: part.detail || "OpenCode session failed.",
        synthetic: true
      }
    }
    return null
  }

  function isToolBoilerplateText(part) {
    return part.type === "text" && /^Called the .+ tool with the following input:/i.test(String(part.text || "").trim())
  }

  function officeAttachmentPromptText(part) {
    if (part.type !== "text") return null
    const text = String(part.text || "")
    const index = text.indexOf(OFFICE_ATTACHMENT_CONTEXT_MARKER)
    if (index === -1) return null
    return text.slice(0, index).trim()
  }

  // OpenCode injects synthetic text parts (e.g. "Called the Read tool with the
  // following input: {...}") around attachment/tool handling. Those are runtime
  // metadata, not chat content, and they also break optimistic dedup.
  function isSyntheticUserText(role, part) {
    return role === "user" && part.type === "text" && part.synthetic === true
  }

  function shouldDropPart(role, part) {
    return isToolBoilerplateText(part) || isSyntheticUserText(role, part)
  }

  function normalizePart(role, part) {
    if (shouldDropPart(role, part)) return null
    if (role === "user") {
      const promptText = officeAttachmentPromptText(part)
      if (promptText !== null) {
        if (!promptText) return null
        return { ...part, text: promptText }
      }
    }
    return part
  }

  function normalizeParts(role, parts) {
    return parts.map((part) => normalizePart(role, part)).filter(Boolean)
  }

  function normalizeMessage(message, index) {
    const info = message?.info || message || {}
    const id = info.id || message?.id || `hydrate_${index}`
    const role = info.role || message?.role
    if (role !== "user" && role !== "assistant") return null

    const rawParts = Array.isArray(message?.parts)
      ? message.parts
      : message?.text
        ? [{ id: `${id}_text`, type: "text", text: message.text }]
        : []
    const parts = rawParts
      .map((part, partIndex) => projectPart(part, `${id}_part_${partIndex}`))
      .filter(Boolean)
      .map((part) => normalizePart(role, part))
      .filter(Boolean)

    return { id, role, parts }
  }

  function messageText(message) {
    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
  }

  function messageCopyText(message) {
    const text = messageText(message)
    if (message.role !== "user") return text

    return [
      ...message.parts
        .filter((part) => part.type === "file")
        .map((part) => `@${part.filename}`),
      ...(text ? [text] : [])
    ].join("\n")
  }

  function messageSignature(message) {
    return JSON.stringify({
      text: messageText(message),
      files: message.parts
        .filter((part) => part.type === "file")
        .map((part) => ({ filename: part.filename, mime: part.mime }))
    })
  }

  function hashString(value) {
    let hash = 0
    const text = String(value || "")
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0
    }
    return Math.abs(hash).toString(36)
  }

  function sessionErrorDetail(error) {
    if (typeof error === "string") return error
    return error?.data?.message || error?.message || "OpenCode session failed."
  }

  function assistantMessageHasOutput(message) {
    return message.role === "assistant" && message.parts.some((part) => {
      if (part.type === "text") return Boolean(String(part.text || "").trim())
      return part.type === "tool" || part.type === "file"
    })
  }

  function lastUserMessage(thread) {
    for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
      if (thread.messages[index].role === "user") return thread.messages[index]
    }
    return null
  }

  function hasAssistantOutputAfterLastUser(thread) {
    for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
      const message = thread.messages[index]
      if (message.role === "user") return false
      if (assistantMessageHasOutput(message)) return true
    }
    return true
  }

  function appendSyntheticError(thread, { title, detail }) {
    const user = lastUserMessage(thread)
    const dedupeKey = `${title}\n${detail}\n${user ? messageSignature(user) : ""}`
    const id = `synthetic_error_${hashString(dedupeKey)}`
    if (thread.messages.some((message) => message.id === id)) return false
    thread.messages.push({
      id,
      role: "assistant",
      syntheticError: true,
      afterMessageId: user?.id,
      afterSignature: user ? messageSignature(user) : null,
      parts: [{
        id: `${id}_part`,
        messageID: id,
        type: "error",
        title,
        detail,
        synthetic: true
      }]
    })
    return true
  }

  function insertRetainedSyntheticMessages(messages, retained) {
    for (const message of retained) {
      if (messages.some((item) => item.id === message.id)) continue
      const targetIndex = messages.findIndex((item) => (
        item.role === "user" &&
        (item.id === message.afterMessageId || (message.afterSignature && messageSignature(item) === message.afterSignature))
      ))
      if (targetIndex === -1) {
        messages.push(message)
      } else {
        messages.splice(targetIndex + 1, 0, message)
      }
    }
  }

  function removeMatchingOptimistic(thread, message) {
    if (message.role !== "user") return
    const signature = messageSignature(message)
    const index = thread.messages.findIndex((item) => (
      item.optimistic &&
      item.id !== message.id &&
      messageSignature(item) === signature
    ))
    if (index !== -1) thread.messages.splice(index, 1)
  }

  function optimisticMatchesPart(message, part) {
    if (!message.optimistic || message.role !== "user") return false
    if (part.type === "file") {
      return message.parts.some((item) => (
        item.type === "file" &&
        item.filename === part.filename &&
        item.mime === part.mime
      ))
    }
    if (part.type === "text") return messageText(message) === (officeAttachmentPromptText(part) ?? part.text)
    return false
  }

  function findMatchingOptimisticForPart(thread, part) {
    return thread.messages.find((message) => optimisticMatchesPart(message, part)) || null
  }

  function messageHasEquivalentPart(message, part) {
    return message.parts.some((item) => {
      if (item.type !== part.type) return false
      if (part.type === "file") return item.filename === part.filename && item.mime === part.mime
      if (part.type === "text") return item.text === part.text
      return item.id === part.id
    })
  }

  function adoptMatchingOptimistic(thread, part) {
    const message = findMatchingOptimisticForPart(thread, part)
    if (!message) return null
    const previousId = message.id
    message.id = part.messageID
    for (const item of message.parts) {
      if (item.messageID === previousId) item.messageID = part.messageID
    }
    return message
  }

  function removeEmptyMessage(thread, id) {
    const index = thread.messages.findIndex((message) => message.id === id && !message.parts.length)
    if (index !== -1) thread.messages.splice(index, 1)
    return index !== -1
  }

  function inferPartRole(thread, part) {
    if (part.type === "tool") return "assistant"
    if (part.type === "file") return "user"
    if (part.type === "text" && (
      part.synthetic === true ||
      officeAttachmentPromptText(part) !== null ||
      findMatchingOptimisticForPart(thread, part)
    )) return "user"
    return "assistant"
  }

  function hydrateThread(thread, sessionId, messages, status) {
    const sameSession = thread.sessionId === sessionId
    const previousMessages = sameSession ? thread.messages.slice() : []
    const optimistic = sameSession
      ? previousMessages
        .map((message, index) => ({ message, index }))
        .filter((entry) => entry.message.optimistic)
      : []
    const syntheticErrors = sameSession
      ? previousMessages.filter((message) => message.syntheticError)
      : []
    const normalized = Array.isArray(messages)
      ? messages.map(normalizeMessage).filter(Boolean)
      : []

    thread.sessionId = sessionId
    thread.status = status || (sameSession ? thread.status : idleStatus()) || idleStatus()
    thread.messages = normalized
    if (!sameSession) {
      // Pending questions/permissions belong to the live session; drop them when switching.
      thread.pendingQuestions = []
      thread.pendingPermissions = []
    } else {
      if (!Array.isArray(thread.pendingQuestions)) thread.pendingQuestions = []
      if (!Array.isArray(thread.pendingPermissions)) thread.pendingPermissions = []
    }
    for (const { message, index } of optimistic) {
      const matched = normalized.some((item) => item.role === "user" && messageSignature(item) === messageSignature(message))
      if (!matched) {
        const precedingIds = previousMessages.slice(0, index).map((item) => item.id)
        const insertAfter = precedingIds.reduce((lastIndex, id) => {
          const currentIndex = thread.messages.findIndex((item) => item.id === id)
          return currentIndex === -1 ? lastIndex : currentIndex
        }, -1)
        thread.messages.splice(insertAfter + 1, 0, message)
      }
    }
    insertRetainedSyntheticMessages(thread.messages, syntheticErrors)
    return thread
  }

  function addOptimisticUser(thread, text, attachments = []) {
    const id = `local_${++optimisticId}`
    thread.messages.push({
      id,
      role: "user",
      optimistic: true,
      parts: [
        ...attachments.map((attachment, index) => ({
          id: `${id}_file_${index}`,
          messageID: id,
          type: "file",
          filename: attachment.filename,
          mime: attachment.mime
        })),
        { id: `${id}_text`, messageID: id, type: "text", text }
      ]
    })
    return id
  }

  function removeOptimisticUser(thread, id) {
    const index = thread.messages.findIndex((message) => message.id === id && message.optimistic)
    if (index !== -1) thread.messages.splice(index, 1)
    for (let errorIndex = thread.messages.length - 1; errorIndex >= 0; errorIndex -= 1) {
      const message = thread.messages[errorIndex]
      if (message.syntheticError && message.afterMessageId === id) thread.messages.splice(errorIndex, 1)
    }
  }

  function upsertMessage(thread, message) {
    removeMatchingOptimistic(thread, message)
    const index = thread.messages.findIndex((item) => item.id === message.id)
    if (index === -1) {
      if (message.role === "user" && !message.parts.length && thread.messages.some((item) => item.optimistic)) {
        return null
      }
      thread.messages.push(message)
      return message
    }
    const existing = thread.messages[index]
    const parts = message.parts?.length ? message.parts : existing.parts || []
    thread.messages[index] = { ...existing, ...message, parts: normalizeParts(message.role, parts) }
    removeMatchingOptimistic(thread, thread.messages[index])
    return thread.messages[index]
  }

  function ensureMessage(thread, messageID, role) {
    const existing = thread.messages.find((message) => message.id === messageID)
    if (existing) {
      existing.role = role || existing.role
      existing.parts = normalizeParts(existing.role, existing.parts || [])
      return existing
    }
    const message = { id: messageID, role, parts: [] }
    thread.messages.push(message)
    return message
  }

  function upsertPart(message, part) {
    const index = message.parts.findIndex((item) => item.id === part.id)
    if (index === -1) {
      message.parts.push(part)
      return
    }
    message.parts[index] = part
  }

  function upsertPendingRequest(list, entry) {
    const index = list.findIndex((item) => item.requestID === entry.requestID)
    if (index === -1) list.push(entry)
    else list[index] = entry
    return true
  }

  function removePendingRequest(list, requestID) {
    const index = list.findIndex((item) => item.requestID === requestID)
    if (index === -1) return false
    list.splice(index, 1)
    return true
  }

  function applyThreadEvent(thread, event) {
    if (!event?.type) return { changed: false, reconcile: false }
    if (event.type === "runtime.stream.connected") return { changed: false, reconcile: true }
    if (!thread.sessionId || event.sessionID !== thread.sessionId) return { changed: false, reconcile: false }

    if (event.type === "session.status") {
      thread.status = event.status || idleStatus()
      return { changed: true, reconcile: false }
    }
    if (event.type === "session.idle") {
      const wasActive = thread.status.type === "busy" || thread.status.type === "retry"
      thread.status = idleStatus()
      if (wasActive && !hasAssistantOutputAfterLastUser(thread)) {
        appendSyntheticError(thread, {
          title: "No response produced",
          detail: NO_RESPONSE_DETAIL
        })
      }
      return { changed: true, reconcile: true }
    }
    if (event.type === "session.aborted") {
      thread.status = idleStatus()
      thread.pendingQuestions = []
      thread.pendingPermissions = []
      return { changed: true, reconcile: true }
    }
    if (event.type === "session.error") {
      thread.status = idleStatus()
      appendSyntheticError(thread, {
        title: "Request failed",
        detail: sessionErrorDetail(event.error)
      })
      return { changed: true, reconcile: true }
    }
    if (event.type === "message.updated") {
      const message = normalizeMessage(event.info, thread.messages.length)
      if (!message) return { changed: false, reconcile: false }
      const updated = upsertMessage(thread, message)
      return { changed: Boolean(updated), reconcile: false }
    }
    if (event.type === "message.part.updated") {
      const part = projectPart(event.part, event.part?.id)
      if (!part) return { changed: false, reconcile: false }
      const existing = thread.messages.find((message) => message.id === part.messageID)
      const role = existing?.role || inferPartRole(thread, part)
      const normalizedPart = normalizePart(role, part)
      if (!normalizedPart) return { changed: false, reconcile: false }
      if (role === "user") {
        const adopted = adoptMatchingOptimistic(thread, normalizedPart)
        if (adopted) {
          removeEmptyMessage(thread, normalizedPart.messageID)
          return { changed: true, reconcile: false }
        }
        if (existing && messageHasEquivalentPart(existing, normalizedPart)) return { changed: false, reconcile: false }
      }
      const message = ensureMessage(thread, normalizedPart.messageID, role)
      upsertPart(message, normalizedPart)
      message.parts = normalizeParts(message.role, message.parts)
      if (message.role === "user") removeMatchingOptimistic(thread, message)
      return { changed: true, reconcile: false }
    }
    if (event.type === "message.part.delta" && event.field === "text") {
      const existing = thread.messages.find((message) => message.id === event.messageID)
      const message = ensureMessage(thread, event.messageID, existing?.role || "assistant")
      let part = message.parts.find((item) => item.id === event.partID)
      if (!part) {
        part = { id: event.partID, messageID: event.messageID, type: "text", text: "" }
        message.parts.push(part)
      }
      if (part.type !== "text") return { changed: false, reconcile: false }
      part.text += event.delta || ""
      return { changed: true, reconcile: false }
    }
    if (event.type === "question.asked" && event.requestID) {
      if (!Array.isArray(thread.pendingQuestions)) thread.pendingQuestions = []
      upsertPendingRequest(thread.pendingQuestions, { requestID: event.requestID, ...(event.question || {}) })
      return { changed: true, reconcile: false }
    }
    if ((event.type === "question.replied" || event.type === "question.rejected") && event.requestID) {
      if (!Array.isArray(thread.pendingQuestions)) thread.pendingQuestions = []
      const changed = removePendingRequest(thread.pendingQuestions, event.requestID)
      return { changed, reconcile: false }
    }
    if (event.type === "permission.asked" && event.requestID) {
      if (!Array.isArray(thread.pendingPermissions)) thread.pendingPermissions = []
      upsertPendingRequest(thread.pendingPermissions, { requestID: event.requestID, ...(event.permission || {}) })
      return { changed: true, reconcile: false }
    }
    if (event.type === "permission.replied" && event.requestID) {
      if (!Array.isArray(thread.pendingPermissions)) thread.pendingPermissions = []
      const changed = removePendingRequest(thread.pendingPermissions, event.requestID)
      return { changed, reconcile: false }
    }
    return { changed: false, reconcile: false }
  }

  function hasRunningTool(thread) {
    for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
      const message = thread.messages[index]
      if (message.role === "user") return false
      if (message.parts.some((part) => (
        part.type === "tool" && (part.state?.status === "pending" || part.state?.status === "running")
      ))) return true
    }
    return false
  }

  function clearPendingQuestion(thread, requestID) {
    if (!Array.isArray(thread.pendingQuestions)) return false
    return removePendingRequest(thread.pendingQuestions, requestID)
  }

  function clearPendingPermission(thread, requestID) {
    if (!Array.isArray(thread.pendingPermissions)) return false
    return removePendingRequest(thread.pendingPermissions, requestID)
  }

  return {
    addOptimisticUser,
    applyThreadEvent,
    clearPendingPermission,
    clearPendingQuestion,
    createThreadStream,
    hasRunningTool,
    hydrateThread,
    messageCopyText,
    messageText,
    removeOptimisticUser,
    resetThread
  }
})
