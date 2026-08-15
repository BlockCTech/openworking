(function exposeThreadStream(root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  if (root) root.OpenWorkingThreadStream = api
})(typeof window === "object" ? window : globalThis, function createThreadStreamApi() {
  let optimisticId = 0
  const OFFICE_ATTACHMENT_CONTEXT_MARKER = "Attached document files are provided as local paths plus extracted text context"
  const NO_RESPONSE_DETAIL = "The request ended without a response. Check provider/model/API key or runtime diagnostics."
  const LIVE_STREAM_STALE_MS = 60 * 1000
  const LIVE_STREAM_GRACE_MS = LIVE_STREAM_STALE_MS
  // The gateway leaks its thought-channel markers into the normal text stream. Spelling varies,
  // and an opening marker is the same token followed by `thought`, so one pattern covers both
  // roles and the capture group says which it is.
  //
  // A real marker is told apart from one the model merely wrote about by whether it stands bare,
  // not by its spelling: quoted markers sit inside a code span or a string literal. A raw SSE
  // capture split 29 occurrences exactly that way — 9 bare, all genuine; 20 quoted, all content.
  const THOUGHT_CHANNEL_MARKER_SOURCE = "<\\|?channel\\|?>(thought)?"
  // Every spelling is a prefix of one of these, which is how a marker still arriving over
  // several deltas is recognised.
  const THOUGHT_CHANNEL_SPELLINGS = [
    "<|channel|>thought", "<|channel>thought", "<channel|>thought", "<channel>thought"
  ]
  const THOUGHT_CHANNEL_MARKER_MAX = Math.max(...THOUGHT_CHANNEL_SPELLINGS.map((item) => item.length))

  function idleStatus() {
    return { type: "idle" }
  }

  function createThreadStream(sessionId = null) {
    return {
      sessionId,
      status: idleStatus(),
      messages: [],
      pendingInputs: [],
      activeInputIds: new Set(),
      promotedInputIds: new Set(),
      pendingQuestions: [],
      pendingPermissions: [],
      pendingForms: [],
      lastStreamEventAt: 0,
      lastEventAt: 0,
      lastAssistantOutputAt: 0
    }
  }

  function resetThread(thread, sessionId = null) {
    thread.sessionId = sessionId
    thread.status = idleStatus()
    thread.messages = []
    thread.pendingInputs = []
    thread.activeInputIds = new Set()
    thread.promotedInputIds = new Set()
    thread.pendingQuestions = []
    thread.pendingPermissions = []
    thread.pendingForms = []
    thread.lastStreamEventAt = 0
    thread.lastEventAt = 0
    thread.lastAssistantOutputAt = 0
    return thread
  }

  function touchThread(thread, at = Date.now()) {
    if (!thread) return 0
    thread.lastEventAt = at
    return at
  }

  function markAssistantOutput(thread, at = Date.now()) {
    if (!thread) return 0
    thread.lastAssistantOutputAt = at
    thread.lastEventAt = at
    return at
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
    if (part.type === "file-ref") {
      return {
        id: part.id || fallbackId,
        sessionID: part.sessionID,
        messageID: part.messageID,
        type: "file-ref",
        token: part.token || "",
        path: part.path || "",
        name: part.name || part.token || part.path || "file"
      }
    }
    if (part.type === "reasoning") {
      return {
        id: part.id || fallbackId,
        sessionID: part.sessionID,
        messageID: part.messageID,
        type: "reasoning",
        text: part.text || ""
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

  // Gemma-family models (e.g. google/gemma-4-31B-it, the bundled default) signal a
  // tool call with a literal control marker like `<tool_call|>`. The runtime lifts
  // the structured call out, but the marker — plus the trailing `}` that closed the
  // tool-call JSON — can leak through as its own text part (observed content:
  // "\n}<tool_call|>\n"), rendering as a stray "}<tool_call|>"/"{" at the end of the
  // answer. Drop text parts whose trimmed content is ONLY these markers (with the
  // stray brace/whitespace around them) — never legitimate prose.
  function isStrayToolCallMarkerText(part) {
    if (part.type !== "text") return false
    const text = String(part.text || "").trim()
    if (!text) return false
    // Fresh non-global regexes per call to avoid shared lastIndex state.
    if (!/<\/?\|?tool[_▁\s]?call\|?>/i.test(text)) return false
    // Only drop if what remains after stripping markers is mere brace/JSON
    // punctuation — i.e. there is no actual answer prose riding along with it.
    const remainder = text.replace(/<\/?\|?tool[_▁\s]?call\|?>/gi, "").trim()
    return remainder === "" || /^[{}\[\],:"'\s]+$/.test(remainder)
  }

  function withoutThoughtChannelState(part, text) {
    const normalized = { ...part, type: "text", text }
    delete normalized.thoughtChannelSource
    return normalized
  }

  function isInsideMarkdownCode(source, index) {
    let delimiterLength = 0
    for (let cursor = 0; cursor < index;) {
      if (source[cursor] !== "`") {
        cursor += 1
        continue
      }
      let end = cursor + 1
      while (source[end] === "`") end += 1
      const runLength = end - cursor
      if (!delimiterLength) delimiterLength = runLength
      else if (runLength === delimiterLength) delimiterLength = 0
      cursor = end
    }
    return delimiterLength > 0
  }

  function isQuotedMarker(source, start, end) {
    const quotes = new Set(["`", '"', "'"])
    return isInsideMarkdownCode(source, start)
      || quotes.has(source[start - 1])
      || quotes.has(source[end])
  }

  // A delta boundary can land anywhere inside "<|channel|>thought", so an unfinished marker is
  // held back rather than painted.
  function looksLikePartialThoughtChannelMarker(tail) {
    if (!tail) return false
    return THOUGHT_CHANNEL_SPELLINGS.some((spelling) => spelling.startsWith(tail))
  }

  // Routes raw assistant text into the prose the user should read and the private thought
  // content. Bare markers switch between the two, quoted ones are copied through, and a close
  // with no open before it — the gateway's most common leak — is dropped.
  function splitThoughtChannel(source, { bufferPartial = false } = {}) {
    const marker = new RegExp(THOUGHT_CHANNEL_MARKER_SOURCE, "g")
    const segments = []
    let cursor = 0
    let inThought = false
    let sawMarker = false
    let trimSegmentStart = false

    const appendSegment = (type, text, trimStart = false) => {
      const value = trimStart ? text.replace(/^\s+/, "") : text
      if (!value) return
      const previous = segments.at(-1)
      if (previous?.type === type) previous.text += value
      else segments.push({ type, text: value })
    }

    for (let hit = marker.exec(source); hit; hit = marker.exec(source)) {
      const start = hit.index
      const end = start + hit[0].length
      // "thought" must end on a real boundary, else this is prose that merely starts the
      // same way (e.g. "<|channel|>thoughtful prose is still a normal answer").
      const after = source[end]
      const isOpen = Boolean(hit[1]) && (!after || /\s/.test(after) || after === "<")
      if ((hit[1] && !isOpen) || isQuotedMarker(source, start, end)) continue

      sawMarker = true
      const before = source.slice(cursor, start)
      appendSegment(inThought ? "reasoning" : "text", before, trimSegmentStart)
      inThought = isOpen
      trimSegmentStart = isOpen
      cursor = end
    }

    let rest = source.slice(cursor)
    let incomplete = inThought
    // A trailing partial marker must not be painted while the rest is in flight.
    for (let length = bufferPartial ? Math.min(rest.length, THOUGHT_CHANNEL_MARKER_MAX - 1) : 0; length > 0; length -= 1) {
      if (!looksLikePartialThoughtChannelMarker(rest.slice(-length))) continue
      if (isInsideMarkdownCode(source, source.length - length)) continue
      rest = rest.slice(0, -length)
      incomplete = true
      break
    }
    appendSegment(inThought ? "reasoning" : "text", rest, trimSegmentStart)
    return { segments, sawMarker, incomplete }
  }

  // Keeps the raw source while deltas arrive so a marker split by the renderer's stream pacer is
  // never painted half-drawn. Returns the parts this one becomes: an envelope on its own turns
  // into reasoning, while an answer carrying a leaked thought splits so neither half is lost.
  function normalizeThoughtChannelPart(role, part, { bufferPartial = false } = {}) {
    const tracked = typeof part.thoughtChannelSource === "string"
    if (role !== "assistant" || (part.type !== "text" && !tracked)) return [part]

    const source = tracked ? part.thoughtChannelSource : String(part.text || "")
    if (!source) return [part]

    const { segments, sawMarker, incomplete } = splitThoughtChannel(source, { bufferPartial })
    // Releasing the tracked state here is what stops an answer that merely opens with "<" from
    // being held as an empty reasoning part forever.
    if (!sawMarker && !incomplete) return [tracked ? withoutThoughtChannelState(part, source) : part]

    const visible = segments.filter((segment) => segment.text.trim())
    if (!visible.length) visible.push({ type: "reasoning", text: "" })
    return visible.map((segment, index) => index === 0
      ? { ...part, type: segment.type, text: segment.text, thoughtChannelSource: source }
      : {
          id: `${part.id}:${segment.type}:${index}`,
          sessionID: part.sessionID,
          messageID: part.messageID,
          type: segment.type,
          text: segment.text,
          thoughtChannelDerived: true
        })
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
    return isToolBoilerplateText(part) || isSyntheticUserText(role, part) || isStrayToolCallMarkerText(part)
  }

  // One raw part can normalize into zero or more ordered parts — see normalizeThoughtChannelPart.
  function normalizePartList(role, part, options) {
    if (shouldDropPart(role, part)) return []
    // Regenerated from the source part each pass; keeping this pass's copy duplicates it per delta.
    if (part.thoughtChannelDerived) return []
    const channelParts = normalizeThoughtChannelPart(role, part, options)
    if (role === "user") {
      const promptText = officeAttachmentPromptText(channelParts[0])
      if (promptText !== null) {
        if (!promptText) return []
        return [{ ...channelParts[0], text: promptText }]
      }
    }
    return channelParts
  }

  function normalizePart(role, part, options) {
    return normalizePartList(role, part, options)[0] || null
  }

  function normalizeParts(role, parts, options) {
    return parts.flatMap((part) => normalizePartList(role, part, options))
  }

  function releaseBufferedThoughtChannelParts(thread) {
    for (const message of thread.messages) {
      if (!message.parts?.some((part) => typeof part.thoughtChannelSource === "string")) continue
      message.parts = normalizeParts(message.role, message.parts)
    }
  }

  // Compact per-response stats for the pinned footer under an assistant message.
  // OpenCode carries these natively on message.info; only assistant messages that
  // actually have numbers get a stats object (else the footer stays hidden).
  function messageStats(info) {
    if (info?.role !== "assistant") return null
    const tokens = info.tokens || {}
    const totalTokens = (tokens.input || 0) + (tokens.output || 0) + (tokens.reasoning || 0)
    const created = info.time?.created
    const completed = info.time?.completed
    const elapsedMs = created && completed ? completed - created : null
    // createdAt is kept raw so the renderer can tick a live "elapsed" clock while
    // the turn is still streaming (Date.now() − createdAt), before completed lands.
    if (!totalTokens && elapsedMs == null && info.cost == null && created == null) return null
    // inputTokens is kept separate from totalTokens: it represents the full conversation
    // context sent for this turn (context window usage), not this turn's total token spend.
    // runTokens (output + reasoning) is what the message-footer/live-suffix display — the
    // cost of this specific run, without double-counting the context size shown elsewhere
    // by the context-window ring.
    const runTokens = (tokens.output || 0) + (tokens.reasoning || 0)
    return { totalTokens, inputTokens: tokens.input || 0, runTokens, elapsedMs, createdAt: created ?? null, cost: info.cost ?? null, completed: Boolean(completed) }
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
      .flatMap((part) => normalizePartList(role, part))

    const stats = messageStats(info)
    // `completedAt` is kept alongside stats purely so upsertMessage can pair it with a createdAt
    // that arrived on an earlier update; messageStats itself can only see one update at a time.
    const completedAt = info.time?.completed ?? null
    if (!stats) return { id, role, parts }
    return completedAt != null ? { id, role, parts, stats, completedAt } : { id, role, parts, stats }
  }

  function basenameFromPath(filePath) {
    const normalized = String(filePath || "").replace(/\\/g, "/")
    const index = normalized.lastIndexOf("/")
    return index === -1 ? normalized : normalized.slice(index + 1)
  }

  const VIEWABLE_FILE_EXTENSIONS = new Set([
    ".md", ".markdown",
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    ".css", ".scss", ".html",
    ".json", ".jsonc", ".yml", ".yaml", ".toml", ".xml",
    ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
    ".c", ".cpp", ".h", ".cs", ".php", ".sql",
    ".vue", ".svelte", ".astro",
    ".sh", ".bash", ".zsh"
  ])
  const VIEWABLE_FILE_BASENAMES = new Set(["Dockerfile", "Makefile", "Procfile", ".gitignore", ".eslintrc", ".prettierrc", ".editorconfig"])

  function isViewableFilePath(filePath) {
    const name = basenameFromPath(filePath)
    if (VIEWABLE_FILE_BASENAMES.has(name)) return true
    const dot = name.lastIndexOf(".")
    if (dot <= 0) return false
    return VIEWABLE_FILE_EXTENSIONS.has(name.slice(dot).toLowerCase())
  }

  // Splits a trailing ":N" or ":N-M" line-range suffix off a backtick-quoted path (renderer.js's
  // applyPendingFileMentions serializes a snippet mention as `path:N-M`) so the bare path can
  // still resolve against known project files. Empty suffix, path unchanged, when there's no match.
  function splitLineRangeSuffix(candidatePath) {
    const match = /^(.*?)(:\d+(?:-\d+)?)$/.exec(String(candidatePath || ""))
    return match ? { path: match[1], suffix: match[2] } : { path: String(candidatePath || ""), suffix: "" }
  }

  function resolveKnownProjectFilePath(candidatePath, projectFiles = []) {
    const path = String(candidatePath || "").trim()
    if (!path || /\s/.test(path)) return null
    if (Array.isArray(projectFiles) && projectFiles.length) {
      if (projectFiles.includes(path)) return path
      const basename = basenameFromPath(path)
      const basenameMatches = projectFiles.filter((file) => basenameFromPath(file) === basename)
      if (basenameMatches.length === 1) return basenameMatches[0]
      return null
    }
    return isViewableFilePath(path) ? path : null
  }

  function tokenForKnownProjectFile(filePath, projectFiles = []) {
    const name = basenameFromPath(filePath)
    if (Array.isArray(projectFiles) && projectFiles.length) {
      const duplicates = projectFiles.filter((file) => basenameFromPath(file) === name)
      return duplicates.length > 1 ? `@${filePath}` : `@${name}`
    }
    return `@${name}`
  }

  function fileRefsFromBacktickPaths(text, projectFiles = []) {
    const refs = []
    const seen = new Set()
    const pattern = /`([^`\n]+)`/g
    let match = null
    while ((match = pattern.exec(String(text || "")))) {
      const raw = match[1]
      // Dedupe by the exact backtick content (not just the resolved path), so two snippets from
      // the same file at different line ranges each still get their own ref/token.
      if (seen.has(raw)) continue
      const { path: candidatePath, suffix } = splitLineRangeSuffix(raw)
      const path = resolveKnownProjectFilePath(candidatePath, projectFiles)
      if (!path) continue
      seen.add(raw)
      const name = `${basenameFromPath(path)}${suffix}`
      const token = `${tokenForKnownProjectFile(path, projectFiles)}${suffix}`
      // `raw` is only included for a snippet mention - renderUserText needs it to replace the
      // exact `path:N-M` text; plain mentions keep {token, path, name} since raw === path for them.
      refs.push(suffix ? { token, path, name, raw } : { token, path, name })
    }
    return refs
  }

  function userMessageFileRefs(message, projectFiles = []) {
    const explicit = message.parts.filter((part) => part.type === "file-ref")
    if (explicit.length) return explicit
    if (message?.role !== "user") return []
    const rawText = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
    return fileRefsFromBacktickPaths(rawText, projectFiles)
  }

  function renderUserText(text, fileRefs = []) {
    let rendered = String(text || "")
    for (const part of fileRefs) {
      // `raw` is the exact backtick content this ref was derived from (path, or path:N-M for a
      // snippet mention) - fall back to `path` for explicit file-ref parts that never had one.
      const raw = String(part?.raw ?? part?.path ?? "").trim()
      const token = String(part?.token || "").trim()
      if (!raw || !token) continue
      rendered = rendered.replaceAll(`\`${raw}\``, token)
    }
    return rendered
  }

  function selectedSkillPromptText(message, projectFiles = []) {
    const selectedSkill = message?.selectedSkill
    if (message?.role !== "user" || !selectedSkill?.raw) return null
    const fileRefs = userMessageFileRefs(message, projectFiles)
    const args = renderUserText(selectedSkill.args, fileRefs).trim()
    return [selectedSkill.raw, args].filter(Boolean).join(" ").trim()
  }

  function selectedCommandPromptText(message, projectFiles = []) {
    const selectedCommand = message?.selectedCommand
    if (message?.role !== "user" || !selectedCommand?.raw) return null
    const fileRefs = userMessageFileRefs(message, projectFiles)
    const args = renderUserText(selectedCommand.args, fileRefs).trim()
    return [selectedCommand.raw, args].filter(Boolean).join(" ").trim()
  }

  function messageText(message, projectFiles = []) {
    const selectedSkillText = selectedSkillPromptText(message, projectFiles)
    if (selectedSkillText !== null) return selectedSkillText
    const selectedCommandText = selectedCommandPromptText(message, projectFiles)
    if (selectedCommandText !== null) return selectedCommandText
    const fileRefs = userMessageFileRefs(message, projectFiles)
    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => message.role === "user" ? renderUserText(part.text, fileRefs) : part.text)
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

  function messageSignatureText(message) {
    if (message.signatureText) return message.signatureText
    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
  }

  function messageSignature(message) {
    return JSON.stringify({
      text: messageSignatureText(message),
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
    return false
  }

  function hasPendingRequest(thread) {
    return Boolean(thread?.pendingQuestions?.length || thread?.pendingPermissions?.length || thread?.pendingForms?.length)
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

  function findMatchingOptimisticMessage(messages, message) {
    if (message?.role !== "user") return null
    const signature = messageSignature(message)
    const strict = messages.find((item) => (
      item.optimistic &&
      item.role === "user" &&
      (
        messageSignature(item) === signature ||
        optimisticSelectedSkillMatchesMessage(item, message) ||
        optimisticSelectedCommandMatchesMessage(item, message)
      )
    ))
    if (strict) return strict
    // Loose command fallback is safe: strict matches above already claimed every exact/marker echo.
    return messages.find((item) => (
      item.optimistic &&
      item.role === "user" &&
      optimisticSelectedCommandMatchesMessage(item, message, true)
    )) || null
  }

  function normalizedTextLines(text) {
    return String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  }

  function realExpandedSelectedSkillMarkers(selectedSkill) {
    if (!selectedSkill?.label) return null
    const args = String(selectedSkill?.args || "").trim()
    const markers = {
      header: `# /${selectedSkill.label}`,
      instructionsHeader: "## Instructions"
    }
    if (args) markers.argsPrefix = `If \`${args}\` contains a path`
    return markers
  }

  // The opencode runtime expands a skill invocation into the verbatim SKILL.md body plus an
  // injected footer that names the skill's base directory as `.../skills/<label>`. Unlike a
  // `.md` command, a skill body does NOT start with `# /<label>` or contain `## Instructions`,
  // so match on that runtime-injected footer marker, which is stable across skill bodies.
  function expandedSkillFooterMatches(selectedSkill, text) {
    const label = String(selectedSkill?.label || "").trim()
    if (!label) return false
    const candidate = String(text || "")
    return candidate.includes("Base directory for this skill") && candidate.includes(`/skills/${label}`)
  }

  function optimisticSelectedSkillMatchesText(selectedSkill, text) {
    if (expandedSkillFooterMatches(selectedSkill, text)) return true
    const markers = realExpandedSelectedSkillMarkers(selectedSkill)
    if (!markers) return false
    const candidate = String(text || "").trim()
    const normalizedLines = normalizedTextLines(candidate)
    if (normalizedLines[0] !== markers.header) return false
    if (!normalizedLines.includes(markers.instructionsHeader)) return false
    if (!markers.argsPrefix) return true
    return normalizedLines.some((line) => line.startsWith(markers.argsPrefix))
  }

  function optimisticSelectedSkillMatchesMessage(optimistic, message) {
    if (!optimistic?.selectedSkill || message?.role !== "user") return false
    return optimisticSelectedSkillMatchesText(optimistic.selectedSkill, messageSignatureText(message))
  }

  function realExpandedSelectedCommandMarkers(selectedCommand) {
    if (!selectedCommand?.label) return null
    return {
      header: `# /${selectedCommand.label}`,
      instructionsHeader: "## Instructions",
      args: String(selectedCommand?.args || "").trim()
    }
  }

  // Built-in commands (e.g. /init, /review) expand with no stable marker to match on, so treat
  // an echo longer than the raw typed command, and containing its args, as a match.
  function expandedCommandEchoMatches(selectedCommand, text) {
    const label = String(selectedCommand?.label || "").trim()
    if (!label) return false
    const candidate = String(text || "").trim()
    if (!candidate) return false
    const args = String(selectedCommand?.args || "").trim()
    const raw = [String(selectedCommand?.raw || `/${label}`).trim(), args].filter(Boolean).join(" ")
    if (candidate.length <= raw.length) return false
    if (!args) return true
    return candidate.includes(args)
  }

  function optimisticSelectedCommandMatchesText(selectedCommand, text, loose = false) {
    if (loose && expandedCommandEchoMatches(selectedCommand, text)) return true
    const markers = realExpandedSelectedCommandMarkers(selectedCommand)
    if (!markers) return false
    const candidate = String(text || "").trim()
    const normalizedLines = normalizedTextLines(candidate)
    if (normalizedLines[0] !== markers.header) return false
    if (!normalizedLines.includes(markers.instructionsHeader)) return false
    if (!markers.args) return true
    return candidate.includes(markers.args) || candidate.includes(`\`${markers.args}\``)
  }

  function optimisticSelectedCommandMatchesMessage(optimistic, message, loose = false) {
    if (!optimistic?.selectedCommand || message?.role !== "user") return false
    return optimisticSelectedCommandMatchesText(optimistic.selectedCommand, messageSignatureText(message), loose)
  }

  function mergeOptimisticUserMetadata(message, optimistic) {
    if (!message || !optimistic) return message
    const fileRefs = optimistic.parts.filter((part) => part.type === "file-ref")
    const merged = {
      ...message,
      signatureText: optimistic.signatureText || message.signatureText || messageSignatureText(message),
      ...(optimistic.selectedSkill ? { selectedSkill: optimistic.selectedSkill } : {}),
      ...(optimistic.selectedCommand ? { selectedCommand: optimistic.selectedCommand } : {})
    }
    if (!fileRefs.length) return merged

    return {
      ...merged,
      parts: [
        ...fileRefs.map((part, index) => ({
          ...part,
          id: `${message.id}_ref_${index}`,
          messageID: message.id
        })),
        ...message.parts.filter((part) => part.type !== "file-ref")
      ]
    }
  }

  function optimisticMatchesPart(message, part, loose = false) {
    if (!message.optimistic || message.role !== "user") return false
    if (part.type === "file") {
      return message.parts.some((item) => (
        item.type === "file" &&
        item.filename === part.filename &&
        item.mime === part.mime
      ))
    }
    if (part.type === "text") {
      const partText = officeAttachmentPromptText(part) ?? part.text
      return messageText(message) === partText || (
        Boolean(message.selectedSkill) &&
        optimisticSelectedSkillMatchesText(message.selectedSkill, partText)
      ) || (
        Boolean(message.selectedCommand) &&
        optimisticSelectedCommandMatchesText(message.selectedCommand, partText, loose)
      )
    }
    return false
  }

  // Strict matches always win before the loose command fallback, so a plain prompt's echo
  // can't be stolen by a pending command optimistic.
  function findMatchingOptimisticForPart(thread, part, { allowLooseCommandMatch = false } = {}) {
    const strict = thread.messages.find((message) => optimisticMatchesPart(message, part))
    if (strict || !allowLooseCommandMatch) return strict || null
    return thread.messages.find((message) => optimisticMatchesPart(message, part, true)) || null
  }

  function messageHasEquivalentPart(message, part) {
    return message.parts.some((item) => {
      if (item.type !== part.type) return false
      if (part.type === "file") return item.filename === part.filename && item.mime === part.mime
      if (part.type === "text") return item.text === part.text
      return item.id === part.id
    })
  }

  function adoptMatchingOptimistic(thread, part, options = {}) {
    const message = findMatchingOptimisticForPart(thread, part, options)
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

  function normalizePendingInput(input) {
    if (!input || typeof input !== "object") return null
    const id = String(input.id || "").trim()
    const sessionID = String(input.sessionID || "").trim()
    const type = String(input.type || "").trim()
    if (!id || !sessionID || !["user", "synthetic", "compaction"].includes(type)) return null
    const admittedSeq = Number(input.admittedSeq)
    const delivery = ["queue", "steer"].includes(input.delivery) ? input.delivery : null
    return {
      id,
      sessionID,
      type,
      ...(Number.isFinite(admittedSeq) && admittedSeq >= 0 ? { admittedSeq } : {}),
      ...(input.timeCreated != null ? { timeCreated: input.timeCreated } : {}),
      ...(delivery ? { delivery } : {}),
      ...(type === "user" ? { text: String(input.text || "") } : {}),
      ...(type === "user" && Array.isArray(input.files)
        ? {
            files: input.files.map((file) => ({
              ...(file?.name ? { name: String(file.name) } : {}),
              ...(file?.description ? { description: String(file.description) } : {})
            }))
          }
        : {})
    }
  }

  function pendingInputState(input) {
    return input?.delivery === "steer" ? "steering" : "queued"
  }

  function pendingInputMessage(input) {
    const id = input.id
    const files = Array.isArray(input.files) ? input.files : []
    return {
      id,
      role: "user",
      inputState: pendingInputState(input),
      delivery: input.delivery,
      parts: [
        ...files.map((file, index) => ({
          id: `${id}_file_${index}`,
          messageID: id,
          type: "file",
          filename: file.name || "Attachment",
          mime: file.description || "application/octet-stream"
        })),
        { id: `${id}_text`, messageID: id, type: "text", text: input.text || "" }
      ]
    }
  }

  function sortPendingInputs(inputs) {
    inputs.sort((left, right) => (
      (left.admittedSeq ?? Number.MAX_SAFE_INTEGER) - (right.admittedSeq ?? Number.MAX_SAFE_INTEGER)
    ))
    return inputs
  }

  function reorderPendingMessages(thread) {
    const pendingUserIds = thread.pendingInputs
      .filter((input) => input.type === "user")
      .map((input) => input.id)
    if (!pendingUserIds.length) return
    const pendingIds = new Set(pendingUserIds)
    const firstIndex = thread.messages.findIndex((message) => pendingIds.has(message.id))
    if (firstIndex === -1) return
    const pendingMessages = new Map(
      thread.messages.filter((message) => pendingIds.has(message.id)).map((message) => [message.id, message])
    )
    const remaining = thread.messages.filter((message) => !pendingIds.has(message.id))
    remaining.splice(
      firstIndex,
      0,
      ...pendingUserIds.map((id) => pendingMessages.get(id)).filter(Boolean)
    )
    thread.messages = remaining
  }

  function refreshPendingMessageStates(thread) {
    const queued = thread.pendingInputs.filter((input) => input.type === "user" && input.delivery === "queue")
    for (const input of thread.pendingInputs) {
      if (input.type !== "user") continue
      const message = thread.messages.find((item) => item.id === input.id)
      if (!message) continue
      message.inputState = pendingInputState(input)
      message.delivery = input.delivery
      if (input.delivery === "queue") message.queuePosition = queued.findIndex((item) => item.id === input.id) + 1
      else delete message.queuePosition
    }
  }

  function admitPendingInput(thread, rawInput) {
    const input = normalizePendingInput(rawInput)
    if (!input || input.sessionID !== thread.sessionId) return false
    if (!(thread.promotedInputIds instanceof Set)) thread.promotedInputIds = new Set()
    if (thread.promotedInputIds.has(input.id)) return false
    if (!Array.isArray(thread.pendingInputs)) thread.pendingInputs = []
    const index = thread.pendingInputs.findIndex((item) => item.id === input.id)
    if (index === -1) thread.pendingInputs.push(input)
    else thread.pendingInputs[index] = input
    sortPendingInputs(thread.pendingInputs)
    if (input.type === "user") {
      let message = thread.messages.find((item) => item.id === input.id)
      if (!message) {
        message = pendingInputMessage(input)
        thread.messages.push(message)
      } else {
        message.optimistic = false
        message.delivery = input.delivery
        message.inputState = pendingInputState(input)
      }
    }
    reorderPendingMessages(thread)
    refreshPendingMessageStates(thread)
    touchThread(thread)
    return true
  }

  function promotePendingInput(thread, inputID) {
    if (!inputID) return false
    if (!Array.isArray(thread.pendingInputs)) thread.pendingInputs = []
    if (!(thread.activeInputIds instanceof Set)) thread.activeInputIds = new Set()
    if (!(thread.promotedInputIds instanceof Set)) thread.promotedInputIds = new Set()
    const index = thread.pendingInputs.findIndex((item) => item.id === inputID)
    const input = index === -1 ? null : thread.pendingInputs[index]
    if (index !== -1) thread.pendingInputs.splice(index, 1)
    thread.promotedInputIds.add(inputID)
    if (thread.promotedInputIds.size > 128) {
      thread.promotedInputIds.delete(thread.promotedInputIds.values().next().value)
    }
    thread.activeInputIds.add(inputID)
    const message = thread.messages.find((item) => item.id === inputID)
    if (message) {
      message.optimistic = false
      message.delivery = input?.delivery || message.delivery
      message.inputState = message.delivery === "steer" ? "steered" : "running"
      delete message.queuePosition
    }
    refreshPendingMessageStates(thread)
    touchThread(thread)
    return Boolean(input || message)
  }

  function markInputDeliveryUnknown(thread, inputID) {
    const message = thread.messages.find((item) => item.id === inputID)
    if (!message) return false
    message.inputState = "delivery-unknown"
    touchThread(thread)
    return true
  }

  function settleActiveInputs(thread) {
    if (!(thread.activeInputIds instanceof Set)) thread.activeInputIds = new Set()
    for (const inputID of thread.activeInputIds) {
      const message = thread.messages.find((item) => item.id === inputID)
      if (message) {
        delete message.inputState
        delete message.queuePosition
      }
    }
    thread.activeInputIds.clear()
  }

  function hydrateThread(thread, sessionId, messages, status, pendingInputs) {
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
      ? messages
        .map(normalizeMessage)
        .filter(Boolean)
        .map((message) => mergeOptimisticUserMetadata(
          message,
          sameSession
            ? previousMessages.find((previous) => previous.id === message.id)
              || findMatchingOptimisticMessage(previousMessages, message)
            : null
        ))
      : []

    const promotedInputIds = sameSession && thread.promotedInputIds instanceof Set
      ? thread.promotedInputIds
      : new Set()
    const projectedPending = Array.isArray(pendingInputs)
      ? sortPendingInputs(pendingInputs
        .map(normalizePendingInput)
        .filter((input) => input?.sessionID === sessionId && !promotedInputIds.has(input.id)))
      : sameSession && Array.isArray(thread.pendingInputs)
        ? thread.pendingInputs.slice()
        : []
    const pendingIds = new Set(projectedPending.map((input) => input.id))

    thread.sessionId = sessionId
    thread.status = status || (sameSession ? thread.status : idleStatus()) || idleStatus()
    thread.messages = normalized
    thread.pendingInputs = projectedPending
    thread.promotedInputIds = new Set(promotedInputIds)
    thread.activeInputIds = sameSession && thread.activeInputIds instanceof Set
      ? new Set(thread.activeInputIds)
      : new Set()
    // Do not clear pending questions/permissions/forms when the renderer reuses a thread object for a
    // different session. The runtime remains blocked on those requests until they are answered;
    // reply/abort events and reconciliation retire cards that are genuinely no longer pending.
    if (!Array.isArray(thread.pendingQuestions)) thread.pendingQuestions = []
    if (!Array.isArray(thread.pendingPermissions)) thread.pendingPermissions = []
    if (!Array.isArray(thread.pendingForms)) thread.pendingForms = []
    for (const input of projectedPending) {
      if (input.type !== "user") continue
      const previous = previousMessages.find((message) => message.id === input.id)
      const message = mergeOptimisticUserMetadata(pendingInputMessage(input), previous)
      const existingIndex = thread.messages.findIndex((item) => item.id === input.id)
      if (existingIndex === -1) thread.messages.push(message)
      else thread.messages[existingIndex] = { ...thread.messages[existingIndex], ...message }
    }
    for (const { message, index } of optimistic) {
      const matched = thread.messages.some((item) => (
        item.role === "user" &&
        (item.id === message.id || messageSignature(item) === messageSignature(message))
      ))
      if (!matched) {
        const precedingIds = previousMessages.slice(0, index).map((item) => item.id)
        const insertAfter = precedingIds.reduce((lastIndex, id) => {
          const currentIndex = thread.messages.findIndex((item) => item.id === id)
          return currentIndex === -1 ? lastIndex : currentIndex
        }, -1)
        thread.messages.splice(insertAfter + 1, 0, message)
      }
    }
    if (thread.status.type === "busy" || thread.status.type === "retry") {
      const visibleUser = [...thread.messages].reverse().find((message) => (
        message.role === "user" && !pendingIds.has(message.id) && !message.optimistic
      ))
      if (!thread.activeInputIds.size && visibleUser) thread.activeInputIds.add(visibleUser.id)
      for (const inputID of thread.activeInputIds) {
        const message = thread.messages.find((item) => item.id === inputID)
        if (message && !pendingIds.has(inputID)) {
          message.inputState = message.delivery === "steer" ? "steered" : "running"
        }
      }
    } else {
      settleActiveInputs(thread)
    }
    refreshPendingMessageStates(thread)
    insertRetainedSyntheticMessages(thread.messages, syntheticErrors)
    touchThread(thread)
    if (hasAssistantOutputAfterLastUser(thread)) markAssistantOutput(thread, thread.lastEventAt)
    return thread
  }

  function addOptimisticUser(thread, text, attachments = [], options = {}) {
    const id = options.id || `local_${++optimisticId}`
    thread.messages.push({
      id,
      role: "user",
      optimistic: true,
      ...(options.delivery ? { delivery: options.delivery } : {}),
      ...(options.inputState ? { inputState: options.inputState } : {}),
      ...(options.signatureText ? { signatureText: options.signatureText } : {}),
      ...(options.selectedSkill ? { selectedSkill: options.selectedSkill } : {}),
      ...(options.selectedCommand ? { selectedCommand: options.selectedCommand } : {}),
      parts: [
        ...attachments.map((attachment, index) => ({
          id: `${id}_file_${index}`,
          messageID: id,
          type: "file",
          filename: attachment.filename,
          mime: attachment.mime
        })),
        ...((Array.isArray(options.fileRefs) ? options.fileRefs : []).map((ref, index) => ({
          id: `${id}_ref_${index}`,
          messageID: id,
          type: "file-ref",
          token: ref.token || "",
          path: ref.path || "",
          name: ref.name || ref.token || ref.path || "file"
        }))),
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

  // Remembers message ids the runtime confirmed as "user" before upsertMessage drops their
  // empty shell, so the part event that follows can still use loose command adoption.
  function confirmedUserMessageIds(thread) {
    if (!(thread.confirmedUserMessageIds instanceof Set)) thread.confirmedUserMessageIds = new Set()
    return thread.confirmedUserMessageIds
  }

  function upsertMessage(thread, message) {
    removeMatchingOptimistic(thread, message)
    const index = thread.messages.findIndex((item) => item.id === message.id)
    if (index === -1) {
      if (message.role === "user" && !message.parts.length && thread.messages.some((item) => item.optimistic)) {
        confirmedUserMessageIds(thread).add(message.id)
        return null
      }
      thread.messages.push(message)
      return message
    }
    const existing = thread.messages[index]
    const parts = message.parts?.length ? message.parts : existing.parts || []
    thread.messages[index] = { ...existing, ...message, parts: normalizeParts(message.role, parts) }
    // A late partial message.updated may lack final stats; don't let it wipe the
    // populated stats a prior (final) event already established.
    if (!message.stats && existing.stats) thread.messages[index].stats = existing.stats
    // The start and end of a turn can arrive as two separate updates (v2 sends no single message
    // carrying both `time.created` and `time.completed`). The completing update therefore has no
    // createdAt of its own, so carry the earlier one forward and derive elapsed from the two real
    // timestamps — otherwise the duration in the footer is permanently null.
    else if (message.stats && message.stats.createdAt == null && existing.stats?.createdAt != null) {
      const createdAt = existing.stats.createdAt
      const completedAt = message.completedAt ?? null
      thread.messages[index].stats = {
        ...message.stats,
        createdAt,
        elapsedMs: message.stats.elapsedMs ?? (completedAt != null ? completedAt - createdAt : null)
      }
    }
    removeMatchingOptimistic(thread, thread.messages[index])
    return thread.messages[index]
  }

  function ensureMessage(thread, messageID, role, normalizationOptions) {
    const existing = thread.messages.find((message) => message.id === messageID)
    if (existing) {
      existing.role = role || existing.role
      existing.parts = normalizeParts(existing.role, existing.parts || [], normalizationOptions)
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
    const existing = message.parts[index]
    if (existing.type === "tool" && part.type === "tool") {
      const existingState = existing.state || {}
      const nextState = part.state || {}
      const nextInput = nextState.input && Object.keys(nextState.input).length
        ? nextState.input
        : existingState.input || {}
      const metadata = nextState.metadata || existingState.metadata
      const existingIsTerminal = existingState.status === "completed" || existingState.status === "error"
      const nextIsActive = nextState.status === "pending" || nextState.status === "running"
      message.parts[index] = {
        ...existing,
        ...part,
        tool: part.tool || existing.tool,
        state: {
          ...existingState,
          ...nextState,
          status: existingIsTerminal && nextIsActive ? existingState.status : nextState.status,
          input: nextInput,
          title: nextState.title || existingState.title,
          error: nextState.error || existingState.error,
          ...(metadata ? { metadata } : {})
        }
      }
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
      touchThread(thread)
      return { changed: true, reconcile: false }
    }
    if (event.type === "session.idle") {
      const wasActive = thread.status.type === "busy" || thread.status.type === "retry"
      thread.status = idleStatus()
      releaseBufferedThoughtChannelParts(thread)
      settleActiveInputs(thread)
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
      releaseBufferedThoughtChannelParts(thread)
      settleActiveInputs(thread)
      thread.pendingQuestions = []
      thread.pendingPermissions = []
      thread.pendingForms = []
      return { changed: true, reconcile: true }
    }
    if (event.type === "session.error") {
      thread.status = idleStatus()
      releaseBufferedThoughtChannelParts(thread)
      settleActiveInputs(thread)
      appendSyntheticError(thread, {
        title: "Request failed",
        detail: sessionErrorDetail(event.error)
      })
      return { changed: true, reconcile: true }
    }
    if (event.type === "session.input.admitted" && event.input) {
      return { changed: admitPendingInput(thread, event.input), reconcile: false }
    }
    if (event.type === "session.input.promoted" && event.inputID) {
      return { changed: promotePendingInput(thread, event.inputID), reconcile: true }
    }
    if (event.type === "message.updated") {
      thread.lastStreamEventAt = Date.now()
      const message = normalizeMessage(event.info, thread.messages.length)
      if (!message) return { changed: false, reconcile: false }
      const updated = upsertMessage(thread, message)
      if (updated?.role === "assistant" && assistantMessageHasOutput(updated)) markAssistantOutput(thread)
      else if (updated) touchThread(thread)
      return { changed: Boolean(updated), reconcile: false }
    }
    if (event.type === "message.part.updated") {
      thread.lastStreamEventAt = Date.now()
      const part = projectPart(event.part, event.part?.id)
      if (!part) return { changed: false, reconcile: false }
      const existing = thread.messages.find((message) => message.id === part.messageID)
      const confirmedUser = existing?.role === "user" || confirmedUserMessageIds(thread).has(part.messageID)
      const role = existing?.role || (confirmedUser ? "user" : inferPartRole(thread, part))
      const normalizedPart = normalizePart(role, part)
      if (!normalizedPart) return { changed: false, reconcile: false }
      if (role === "user") {
        // Loose command adoption only when the role is runtime-confirmed, not merely inferred.
        const adopted = adoptMatchingOptimistic(thread, normalizedPart, {
          allowLooseCommandMatch: confirmedUser
        })
        if (adopted) {
          confirmedUserMessageIds(thread).delete(normalizedPart.messageID)
          removeEmptyMessage(thread, normalizedPart.messageID)
          return { changed: true, reconcile: false }
        }
        if (existing && messageHasEquivalentPart(existing, normalizedPart)) return { changed: false, reconcile: false }
      }
      const message = ensureMessage(thread, normalizedPart.messageID, role)
      upsertPart(message, normalizedPart)
      message.parts = normalizeParts(message.role, message.parts)
      if (message.role === "user") removeMatchingOptimistic(thread, message)
      if (message.role === "assistant" && assistantMessageHasOutput(message)) markAssistantOutput(thread)
      else touchThread(thread)
      return { changed: true, reconcile: false }
    }
    // Answer text and reasoning both arrive as `message.part.delta`, distinguished by `field`.
    // When the part already exists its type wins — it was established by the preceding
    // `message.part.updated`, and that is more authoritative than the delta. When the delta
    // arrives first (always the case on v2, which sends no part.updated for streamed text), the
    // part is created from `field` so reasoning does not get mislabelled as answer text.
    if (event.type === "message.part.delta" && (event.field === "text" || event.field === "reasoning")) {
      thread.lastStreamEventAt = Date.now()
      const existing = thread.messages.find((message) => message.id === event.messageID)
      const message = ensureMessage(thread, event.messageID, existing?.role || "assistant", { bufferPartial: true })
      let part = message.parts.find((item) => item.id === event.partID)
      if (!part) {
        part = { id: event.partID, messageID: event.messageID, type: event.field === "reasoning" ? "reasoning" : "text", text: "" }
        message.parts.push(part)
      }
      if (part.type !== "text" && part.type !== "reasoning") return { changed: false, reconcile: false }
      if (typeof part.thoughtChannelSource === "string") {
        part.thoughtChannelSource += event.delta || ""
      } else {
        part.text = (part.text || "") + (event.delta || "")
      }
      // A delta can complete a stray tool-call-marker part (Gemma emits the marker
      // as text), or extend a provider thought-channel envelope. Re-normalize so
      // neither kind of control marker flickers into the rendered thread.
      message.parts = normalizeParts(message.role, message.parts, { bufferPartial: true })
      if (message.role === "assistant" && assistantMessageHasOutput(message)) markAssistantOutput(thread)
      else touchThread(thread)
      return { changed: true, reconcile: false }
    }
    if (event.type === "question.asked" && event.requestID) {
      if (!Array.isArray(thread.pendingQuestions)) thread.pendingQuestions = []
      upsertPendingRequest(thread.pendingQuestions, { requestID: event.requestID, ...(event.question || {}) })
      touchThread(thread)
      return { changed: true, reconcile: false }
    }
    if ((event.type === "question.replied" || event.type === "question.rejected") && event.requestID) {
      if (!Array.isArray(thread.pendingQuestions)) thread.pendingQuestions = []
      const changed = removePendingRequest(thread.pendingQuestions, event.requestID)
      if (changed) touchThread(thread)
      return { changed, reconcile: false }
    }
    if (event.type === "permission.asked" && event.requestID) {
      if (!Array.isArray(thread.pendingPermissions)) thread.pendingPermissions = []
      upsertPendingRequest(thread.pendingPermissions, { requestID: event.requestID, ...(event.permission || {}) })
      touchThread(thread)
      return { changed: true, reconcile: false }
    }
    if (event.type === "permission.replied" && event.requestID) {
      if (!Array.isArray(thread.pendingPermissions)) thread.pendingPermissions = []
      const changed = removePendingRequest(thread.pendingPermissions, event.requestID)
      if (changed) touchThread(thread)
      return { changed, reconcile: false }
    }
    if (event.type === "form.created" && event.form?.id) {
      if (!Array.isArray(thread.pendingForms)) thread.pendingForms = []
      upsertPendingRequest(thread.pendingForms, { requestID: event.form.id, ...event.form })
      touchThread(thread)
      return { changed: true, reconcile: false }
    }
    if ((event.type === "form.replied" || event.type === "form.cancelled") && event.formID) {
      if (!Array.isArray(thread.pendingForms)) thread.pendingForms = []
      const changed = removePendingRequest(thread.pendingForms, event.formID)
      if (changed) touchThread(thread)
      return { changed, reconcile: false }
    }
    return { changed: false, reconcile: false }
  }

  function threadIsBusy(thread) {
    const type = thread?.status?.type
    return type === "busy" || type === "retry"
  }

  function needsThreadRehydration(thread, serverStatus, now = Date.now()) {
    if (!thread || !threadIsBusy(thread)) return true
    if (serverStatus?.type === "idle") return true
    // Keep the live busy state for sessions that have not emitted assistant output yet.
    if (!hasAssistantOutputAfterLastUser(thread)) return false
    if (hasRunningTool(thread) || hasPendingRequest(thread)) return false
    const lastActivityAt = Math.max(
      thread.lastAssistantOutputAt || 0,
      thread.lastStreamEventAt || 0,
      thread.lastEventAt || 0
    )
    if (!lastActivityAt) return true
    return now - lastActivityAt > LIVE_STREAM_STALE_MS
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

  function clearPendingForm(thread, formID) {
    if (!Array.isArray(thread.pendingForms)) return false
    return removePendingRequest(thread.pendingForms, formID)
  }

  return {
    admitPendingInput,
    addOptimisticUser,
    applyThreadEvent,
    clearPendingPermission,
    clearPendingForm,
    clearPendingQuestion,
    createThreadStream,
    hasRunningTool,
    fileRefsFromBacktickPaths,
    hydrateThread,
    markInputDeliveryUnknown,
    messageCopyText,
    needsThreadRehydration,
    userMessageFileRefs,
    messageText,
    promotePendingInput,
    removeOptimisticUser,
    resetThread,
    threadIsBusy,
    LIVE_STREAM_GRACE_MS
  }
})
