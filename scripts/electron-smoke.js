const { spawn } = require("node:child_process")
const fs = require("node:fs")
const http = require("node:http")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")
const WebSocket = require("ws")

function findFreePort(hostname = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, hostname, () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let raw = ""
        res.setEncoding("utf8")
        res.on("data", (chunk) => {
          raw += chunk
        })
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw))
          } catch (error) {
            reject(error)
          }
        })
      })
      .on("error", reject)
  })
}

async function waitForTarget(port) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15000) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json`)
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // Electron is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("Timed out waiting for Electron debugger target.")
}

function connectDebugger(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()

  ws.on("message", (message) => {
    const payload = JSON.parse(message.toString())
    if (!payload.id || !pending.has(payload.id)) return
    const { resolve, reject } = pending.get(payload.id)
    pending.delete(payload.id)
    if (payload.error) reject(new Error(payload.error.message))
    else resolve(payload.result)
  })

  return new Promise((resolve, reject) => {
    ws.once("open", () => {
      resolve({
        send(method, params = {}) {
          const requestId = ++id
          ws.send(JSON.stringify({ id: requestId, method, params }))
          return new Promise((requestResolve, requestReject) => {
            pending.set(requestId, { resolve: requestResolve, reject: requestReject })
          })
        },
        close() {
          ws.close()
        }
      })
    })
    ws.once("error", reject)
  })
}

async function main() {
  const packagedDesktopBin = process.env.OPENWORKING_DESKTOP_BIN
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "openworking-electron-"))
  const userDataPath = path.join(temp, "user-data")
  const projectPath = path.join(temp, "project")
  fs.mkdirSync(userDataPath, { recursive: true })
  fs.mkdirSync(projectPath)
  const projectSrcPath = path.join(projectPath, "src")
  const projectDocsPath = path.join(projectPath, "docs")
  fs.mkdirSync(projectSrcPath)
  fs.mkdirSync(projectDocsPath)
  const projectCodePath = path.join(projectSrcPath, "renderer.js")
  fs.writeFileSync(projectCodePath, "export const escaped = '<tag>'\n")
  fs.writeFileSync(path.join(projectDocsPath, "diagram.md"), [
    "# Diagram preview",
    "",
    "```mermaid",
    "sequenceDiagram",
    "    participant CP2",
    "    participant DIP as データ連携基盤",
    "    participant MIWS",
    "",
    "    CP2->>CP2: requestId を発行",
    "    CP2->>DIP: 面接日程の変更依頼 requestId",
    "    DIP->>MIWS: 面接日程の変更依頼 requestId",
    "    MIWS->>MIWS: 依頼内容を検証",
    "    MIWS->>MIWS: 面接日程が変更される",
    "    MIWS->>MIWS: Outbox に変更イベントを保存 eventId",
    "    MIWS->>DIP: APIレスポンス accepted / eventId",
    "    DIP->>CP2: APIレスポンス accepted / eventId",
    "    CP2->>CP2: 受付状態と eventId を記録",
    "    MIWS->>DIP: 面接日程変更イベント eventId",
    "    DIP->>CP2: 面接日程変更イベント eventId",
    "    CP2->>CP2: eventId で重複確認",
    "    CP2->>CP2: 面接日程の変更を反映",
    "```",
    "",
    "```js",
    "console.log('plain code')",
    "```",
    "",
    "```mermaid",
    "flowchart LR",
    "  A -->",
    "```",
    ""
  ].join("\n"))
  fs.writeFileSync(path.join(userDataPath, "projects.json"), `${JSON.stringify({
    projects: [{
      id: "proj_smoke",
      name: "Smoke Project",
      path: projectPath,
      addedAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString()
    }]
  }, null, 2)}\n`)

  const debugPort = await findFreePort()
  const electronBin = packagedDesktopBin || path.join(__dirname, "..", "node_modules", ".bin", "electron")
  const child = spawn(electronBin, [`--remote-debugging-port=${debugPort}`, ...(packagedDesktopBin ? [] : ["."])], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      OPENWORKING_USER_DATA_DIR: userDataPath,
      OPENWORKING_OPENCODE_CONFIG_PATH: path.join(temp, "opencode.json"),
      ...(packagedDesktopBin ? {} : { OPENWORKING_RUNTIME_BIN: "/does/not/exist" })
    },
    stdio: ["ignore", "pipe", "pipe"]
  })

  let stderr = ""
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString()
  })

  let client
  try {
    const target = await waitForTarget(debugPort)
    client = await connectDebugger(target.webSocketDebuggerUrl)
    await client.send("Runtime.enable")

    const expression = `
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, ${packagedDesktopBin ? 1800 : 300}))
        const runtime = await window.openworking.runtime.get()
        const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const waitForImages = () => Promise.all(Array.from(document.images).map((image) => {
          if (image.complete) return Promise.resolve()
          return new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true })
            image.addEventListener("error", resolve, { once: true })
          })
        }))
        const atLatest = () => {
          const thread = document.querySelector(".thread-scroll")
          return thread && thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 1
        }
        const latestDistance = () => {
          const thread = document.querySelector(".thread-scroll")
          return thread ? thread.scrollHeight - thread.scrollTop - thread.clientHeight : null
        }
        const waitUntil = async (callback, timeout = 3000) => {
          const startedAt = Date.now()
          while (Date.now() - startedAt < timeout) {
            if (callback()) return true
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          return false
        }
        const hasCompactToolStepStatus = (step, statusSelector) => {
          const label = step?.querySelector(".tool-copy strong")
          const status = step?.querySelector(statusSelector)
          const messageCard = step?.closest(".message-card")
          if (!label || !status || !messageCard) return false
          const labelRect = label.getBoundingClientRect()
          const statusRect = status.getBoundingClientRect()
          const messageRect = messageCard.getBoundingClientRect()
           const labelStatusGap = statusRect.left - labelRect.right
           const statusRightGutter = messageRect.right - statusRect.right
           const isSameLine = Math.abs(statusRect.top - labelRect.top) < 10
           return isSameLine && labelStatusGap >= 0 && statusRightGutter > 0
        }

        const smokeProject = { id: "proj_smoke", name: "Smoke Project", path: ${JSON.stringify(projectPath)} }
        state.projects = state.projects.some((project) => project.id === smokeProject.id) ? state.projects : [smokeProject, ...state.projects]
        state.activeProjectId = "proj_smoke"
        state.expanded.add(state.activeProjectId)
        state.activeSessionId = null
        state.sessionsByProject[state.activeProjectId] = []
        render()
        await nextPaint()
        await waitForImages()
        const bodyText = document.body.textContent

        state.activeSessionId = "sess_scroll_smoke"
        state.sessionsByProject[state.activeProjectId] = [{ id: state.activeSessionId, title: "Scroll smoke" }]
        hydrateActiveThread(Array.from({ length: 24 }, (_, index) => ({
          id: "msg_smoke_" + index,
          role: index % 2 ? "assistant" : "user",
          text: "Scroll smoke message " + index + "\\n" + "Long line ".repeat(20)
        })))
        render({ threadScroll: "latest" })
        await nextPaint()
        await waitForImages()
        state.popover = "plus"
        render()
        await nextPaint()
        document.querySelector('[data-action="togglePlanMode"]').click()
        await nextPaint()
        const hidesPlanProposalOnToggle =
          state.mode === "plan" &&
          !document.querySelector(".plan-proposal") &&
          !document.body.textContent.includes("Proposed a plan")
        const planThread = activeThread()
        planThread.messages.push({
          id: "msg_plan_user",
          role: "user",
          parts: [{ id: "part_plan_user", messageID: "msg_plan_user", type: "text", text: "Plan the next fix" }]
        })
        state.planProposal = {
          sessionId: state.activeSessionId,
          afterMessageIndex: planThread.messages.length - 1
        }
        handleRuntimeStream({
          type: "message.part.updated",
          sessionID: state.activeSessionId,
          part: {
            id: "part_plan_reply",
            messageID: "msg_plan_reply",
            type: "text",
            text: "Implementation plan\\n" + "Detailed step. ".repeat(30)
          }
        })
        handleRuntimeStream({ type: "session.idle", sessionID: state.activeSessionId })
        await nextPaint()
        const showsPlanProposalAfterPlanReply =
          Boolean(document.querySelector(".plan-proposal")) &&
          document.body.textContent.includes("Proposed a plan")
        const inlinePlanRendersMarkdown =
          Boolean(document.querySelector(".document-viewer .doc-content")) &&
          !document.querySelector(".document-viewer .doc-code")
        const originalSendPrompt = sendPrompt
        let acceptedPlanPrompt = ""
        sendPrompt = async (prompt) => {
          acceptedPlanPrompt = prompt
        }
        await acceptPlan()
        await nextPaint()
        sendPrompt = originalSendPrompt
        const acceptPlanClosesViewer =
          !document.querySelector(".document-viewer") &&
          state.mode === "agent" &&
          acceptedPlanPrompt.includes("approved")
        state.mode = "agent"
        state.planProposal = null
        state.planAutoOpened = null
        state.planAccepted = null
        render({ threadScroll: "latest" })
        await nextPaint()
        const openedAtLatest = atLatest()
        const openedLatestDistance = latestDistance()
        const hasSidebarAccount = Boolean(document.querySelector(".side-user"))
        const hasNoAssistantAvatars = !document.querySelector(".ai-av")
        const hasWideChat =
          getComputedStyle(document.querySelector(".thread-inner")).maxWidth === "1440px" &&
          getComputedStyle(document.querySelector(".composer-dock .composer")).maxWidth === "1440px"
        const replyComposerMinHeight = parseFloat(getComputedStyle(document.querySelector(".composer-dock textarea")).minHeight)
        const hasCompactReplyComposer = replyComposerMinHeight >= 58 && replyComposerMinHeight < 88
        window.resizeTo(980, 680)
        await new Promise((resolve) => setTimeout(resolve, 100))
        await nextPaint()
        const narrowMain = document.querySelector(".main").getBoundingClientRect()
        const narrowComposer = document.querySelector(".composer-dock .composer").getBoundingClientRect()
        const narrowThreadStyle = getComputedStyle(document.querySelector(".thread-inner"))
        const keepsNarrowGutters =
          window.outerWidth <= 1000 &&
          parseFloat(narrowThreadStyle.paddingLeft) >= 32 &&
          narrowComposer.left - narrowMain.left >= 31 &&
          narrowMain.right - narrowComposer.right >= 31

        let thread = document.querySelector(".thread-scroll")
        thread.scrollTop = 0
        handleRuntimeStream({
          type: "message.part.updated",
          sessionID: state.activeSessionId,
          part: { id: "part_stream", messageID: "msg_stream", type: "text", text: "Inbound while reading " }
        })
        handleRuntimeStream({
          type: "message.part.delta",
          sessionID: state.activeSessionId,
          messageID: "msg_stream",
          partID: "part_stream",
          field: "text",
          delta: "history"
        })
        await nextPaint()
        thread = document.querySelector(".thread-scroll")
        const preservedHistoryPosition = thread.scrollTop === 0
        const textStreamingBeforeIdle = document.body.textContent.includes("Inbound while reading history")

        thread.scrollTop = thread.scrollHeight
        handleRuntimeStream({
          type: "message.part.delta",
          sessionID: state.activeSessionId,
          messageID: "msg_stream",
          partID: "part_stream",
          field: "text",
          delta: " while following latest"
        })
        await nextPaint()
        const followedLatest = atLatest()
        const followedLatestDistance = latestDistance()

        handleRuntimeStream({ type: "session.status", sessionID: state.activeSessionId, status: { type: "busy" } })
        await nextPaint()
        const hasThinkingFallback = document.body.textContent.includes("Thinking")

        handleRuntimeStream({
          type: "message.part.updated",
          sessionID: state.activeSessionId,
          part: {
            id: "part_tool",
            messageID: "msg_stream",
            type: "tool",
            tool: "read",
            state: { status: "running", input: { filePath: "CLAUDE.md" } }
          }
        })
        await nextPaint()
        let runningToolStep = document.querySelector(".tool-step.running")
        const hasRunningTool = runningToolStep?.textContent.includes("Reading file")
        const keepsRunningToolStatusCompact = hasCompactToolStepStatus(runningToolStep, ".tool-processing")
        const runningStepStartsOpen =
          runningToolStep?.getAttribute("aria-expanded") === "true" &&
          document.querySelector(".tool-step-details")?.textContent.includes("CLAUDE.md")
        runningToolStep?.click()
        await nextPaint()
        runningToolStep = document.querySelector(".tool-step.running")
        const runningStepCanClose =
          runningToolStep?.getAttribute("aria-expanded") === "false" &&
          !runningToolStep?.closest(".tool-result").querySelector(".tool-step-details")
        runningToolStep?.click()
        await nextPaint()
        runningToolStep = document.querySelector(".tool-step.running")
        const runningStepCanReopen =
          runningToolStep?.getAttribute("aria-expanded") === "true" &&
          runningToolStep?.closest(".tool-result").querySelector(".tool-step-details")?.textContent.includes("CLAUDE.md")

        handleRuntimeStream({
          type: "message.part.updated",
          sessionID: state.activeSessionId,
          part: {
            id: "part_tool",
            messageID: "msg_stream",
            type: "tool",
            tool: "read",
            state: {
              status: "completed",
              input: { filePath: "CLAUDE.md" },
              metadata: {
                diff: "@@ -1 +1 @@\\n-old\\n+new",
                filepath: "CLAUDE.md"
              }
            }
          }
        })
        await nextPaint()
        let completedToolStep = document.querySelector(".tool-step.completed")
        const keepsCompletedTool = completedToolStep?.textContent.includes("Read file")
        const keepsCompletedToolStatusCompact = hasCompactToolStepStatus(completedToolStep, ".tool-state")
        const completedStepStartsClosed =
          completedToolStep?.getAttribute("aria-expanded") === "false" &&
          !completedToolStep?.closest(".tool-result").querySelector(".tool-step-details")
        completedToolStep?.click()
        await nextPaint()
        completedToolStep = document.querySelector(".tool-step.completed")
        const completedStepCanReopen =
          completedToolStep?.getAttribute("aria-expanded") === "true" &&
          completedToolStep?.closest(".tool-result").querySelector(".tool-step-details")?.textContent.includes("CLAUDE.md")
        const hidesReadFileRef = !document.querySelector(".file-ref-chip")
        const hidesReadDiff = !document.querySelector(".changes-summary")

        handleRuntimeStream({
          type: "message.part.updated",
          sessionID: state.activeSessionId,
          part: {
            id: "part_write_markdown",
            messageID: "msg_stream",
            type: "tool",
            tool: "write",
            state: {
              status: "running",
              input: { filePath: "_template_vi.md" }
            }
          }
        })
        await nextPaint()
        const hidesRunningWriteFileRef =
          ![...document.querySelectorAll(".file-ref-chip")]
            .some((chip) => chip.textContent.includes("_template_vi.md"))

        handleRuntimeStream({
          type: "message.part.updated",
          sessionID: state.activeSessionId,
          part: {
            id: "part_write_markdown",
            messageID: "msg_stream",
            type: "tool",
            tool: "write",
            state: {
              status: "error",
              input: { filePath: "_template_vi.md" },
              error: "File does not exist"
            }
          }
        })
        await nextPaint()
        const hidesErroredWriteFileRef =
          ![...document.querySelectorAll(".file-ref-chip")]
            .some((chip) => chip.textContent.includes("_template_vi.md"))

        handleRuntimeStream({
          type: "message.part.updated",
          sessionID: state.activeSessionId,
          part: {
            id: "part_write_code",
            messageID: "msg_stream",
            type: "tool",
            tool: "write",
            state: {
              status: "completed",
              input: { filePath: "src/renderer.js" },
              metadata: {
                diff: "@@ -1 +1 @@\\n-old\\n+export const escaped = '<tag>'",
                filepath: "src/renderer.js"
              }
            }
          }
        })
        await nextPaint()
        const codeFileChip = document.querySelector(".file-ref-chip")
        const showsCodeFileRef =
          codeFileChip?.textContent.includes("renderer.js") &&
          codeFileChip?.textContent.includes("Code · JS")
        const showsWriteDiff =
          document.querySelector(".changes-summary")?.textContent.includes("1 file") &&
          document.querySelector(".changes-summary")?.textContent.includes("renderer.js")
        codeFileChip?.click()
        await new Promise((resolve) => setTimeout(resolve, 100))
        await nextPaint()
        // A file with a diff opens on the Diff tab: the unified diff view renders
        // with the added line tinted, and the full-file Code view is not shown yet.
        const rendersDiffViewer =
          Boolean(document.querySelector(".diff-view .diff-line.add")) &&
          document.querySelector(".diff-view")?.textContent.includes("export const escaped = '<tag>'") &&
          !document.querySelector(".doc-code")
        // Switching to the Code tab shows the full highlighted file (escaped, no injection).
        document.querySelector('[data-doc-tab="code"]')?.click()
        await nextPaint()
        const rendersCodeViewer =
          document.querySelector(".doc-code")?.textContent.includes("export const escaped = '<tag>'") &&
          !document.querySelector(".doc-content")

        await openDocument("docs/diagram.md")
        await waitUntil(() => !document.querySelector(".mermaid-block[data-mermaid-pending='true']"))
        await nextPaint()
        const rendersMermaidDiagram =
          Boolean(document.querySelector(".document-viewer .doc-content .mermaid-block.rendered svg")) &&
          document.querySelector(".document-viewer .doc-content")?.textContent.includes("Diagram preview")
        const mermaidSvgRect = document.querySelector(".document-viewer .doc-content .mermaid-block.rendered svg")?.getBoundingClientRect()
        const rendersMermaidAtReadableSize =
          mermaidSvgRect?.width > 300 &&
          mermaidSvgRect?.height > 180
        const mermaidSvgSize = mermaidSvgRect ? Math.round(mermaidSvgRect.width) + "x" + Math.round(mermaidSvgRect.height) : ""
        const keepsNonMermaidCodeBlock =
          [...document.querySelectorAll(".document-viewer .doc-content pre code")]
            .some((code) => code.textContent.includes("console.log('plain code')"))
        const showsMermaidFallback =
          document.querySelector(".document-viewer .doc-content .mermaid-block.error .mermaid-source")?.textContent.includes("A -->")

        handleRuntimeStream({
          type: "message.part.updated",
          sessionID: state.activeSessionId,
          part: {
            id: "part_patch_code",
            messageID: "msg_stream",
            type: "tool",
            tool: "apply_patch",
            state: {
              status: "completed",
              input: { files: ["src/renderer.js"] },
              metadata: {
                diff: "@@ -1 +1 @@\\n-export const escaped = '<tag>'\\n+export const escaped = '<patch>'",
                files: ["src/renderer.js"]
              }
            }
          }
        })
        await nextPaint()
        const showsApplyPatchDiff =
          document.querySelector(".changes-summary")?.textContent.includes("renderer.js") &&
          document.querySelector(".changes-summary")?.textContent.includes("+1")

        handleRuntimeStream({
          type: "message.part.updated",
          sessionID: state.activeSessionId,
          part: {
            id: "part_translate_document",
            messageID: "msg_stream",
            type: "tool",
            tool: "translate_document",
            state: {
              status: "completed",
              input: { inputPath: "/tmp/manual.pdf" },
              metadata: {
                artifacts: [{ path: "/tmp/manual-translated-vietnamese.pdf", filename: "manual-translated-vietnamese.pdf", mime: "application/pdf" }],
                quality: "warning",
                warnings: ["Review translated layout"]
              }
            }
          }
        })
        await nextPaint()
        const artifactChip = document.querySelector("[data-open-artifact]")
        const hasTranslationArtifact =
          artifactChip?.textContent.includes("manual-translated-vietnamese.pdf") &&
          document.querySelector(".artifact-warning")?.textContent.includes("Review translated layout")
        const keepsArtifactOutsideCollapsedStep =
          document.querySelector('[data-tool-step="msg_stream:part_translate_document"]')?.getAttribute("aria-expanded") === "false" &&
          Boolean(artifactChip)

        handleRuntimeStream({
          type: "message.part.updated",
          sessionID: state.activeSessionId,
          part: {
            id: "part_error",
            messageID: "msg_stream",
            type: "tool",
            tool: "bash",
            state: { status: "error", title: "Run npm test", input: { description: "npm test" }, error: "Command failed" }
          }
        })
        await nextPaint()
        const errorToolStep = document.querySelector(".tool-step.error")
        const errorStepStartsOpen =
          errorToolStep?.getAttribute("aria-expanded") === "true" &&
          errorToolStep?.closest(".tool-result").querySelector(".tool-step-details")?.textContent.includes("Command failed")

        handleRuntimeStream({
          type: "session.status",
          sessionID: state.activeSessionId,
          status: { type: "retry", attempt: 2, message: "Rate limited" }
        })
        await nextPaint()
        const hasRetryRow = document.body.textContent.includes("Retrying attempt 2") && document.body.textContent.includes("Rate limited")

        state.pendingAttachments = [{ id: "attachment_smoke", filename: "draft.pdf", mime: "application/pdf" }]
        render()
        await nextPaint()
        const hasAttachmentChip = document.querySelector(".composer-attachments")?.textContent.includes("draft.pdf")
        document.querySelector('[data-remove-attachment="attachment_smoke"]').click()
        await nextPaint()
        const removesAttachmentChip = !document.querySelector(".composer-attachments")

        activeThread().messages.push({
          id: "msg_attachment_smoke",
          role: "user",
          parts: [
            { id: "part_attachment_smoke", messageID: "msg_attachment_smoke", type: "file", filename: "history.pdf", mime: "application/pdf" },
            { id: "part_attachment_text", messageID: "msg_attachment_smoke", type: "text", text: "Review this file" }
          ]
        })
        renderThreadContent({ threadScroll: "latest" })
        await nextPaint()
        const keepsHistoryAttachment = document.querySelector(".message-attachments")?.textContent.includes("history.pdf")
        const hasUserMessageCard = Boolean(document.querySelector(".msg-user .message-card"))
        const hasAssistantMessageCard = Boolean(document.querySelector(".msg-ai .message-card"))
        const attachmentCopyButton = document.querySelector('[data-copy-message="msg_attachment_smoke"]')
        const assistantCopyButton = document.querySelector('[data-copy-message="msg_stream"]')
        const copyActionHiddenUntilFocus = getComputedStyle(attachmentCopyButton?.closest(".message-actions")).opacity === "0"
        attachmentCopyButton?.focus()
        await new Promise((resolve) => setTimeout(resolve, 300))
        const copyActionVisibleOnFocus = getComputedStyle(attachmentCopyButton?.closest(".message-actions")).opacity === "1"
        attachmentCopyButton?.click()
        await new Promise((resolve) => setTimeout(resolve, 50))
        const copiesMessageWithToast = document.querySelector(".toast")?.textContent.includes("Message copied")
        const usesLocalRendererAssets = Array.from(document.querySelectorAll("script[src], link[href]"))
          .every((element) => !String(element.getAttribute("src") || element.getAttribute("href")).startsWith("http"))

        document.querySelector('[data-nav="config"]').click()
        await new Promise((resolve) => setTimeout(resolve, 50))
        const apiKey = document.querySelector('[data-field="providerApiKey"]')
        apiKey.value = "smoke-secret"
        apiKey.dispatchEvent(new Event("input"))
        render()
        await nextPaint()
        const configText = document.body.textContent
        const effectiveConfig = document.querySelector(".config-json").value
        const inputModalities = document.querySelector('[data-model-modalities="input"]')
        const originalInputModalities = inputModalities.value
        inputModalities.value = originalInputModalities + ", docx"
        inputModalities.dispatchEvent(new Event("input"))
        await nextPaint()
        const showsInvalidModality = document.querySelector("[data-model-error]")?.textContent.includes("docx")
        let blocksInvalidModalitySave = false
        try {
          await saveConfig()
        } catch (error) {
          blocksInvalidModalitySave = error.message.includes("docx")
        }
        const persistedConfig = await window.openworking.config.get()
        const keepsInvalidModalityOutOfProfile =
          !persistedConfig.config.provider.gateway.models["gpt-4o-mini"].modalities.input.includes("docx")
        inputModalities.value = originalInputModalities
        inputModalities.dispatchEvent(new Event("input"))
        const model = state.config.provider.gateway.models["gpt-4o-mini"]
        return {
          hasBrand: document.title.includes("OpenWorking"),
          hasNewSession: bodyText.includes("New session"),
          hasPrompt: bodyText.includes("What should we work on in") && bodyText.includes("Smoke Project"),
          hasAddProject: Boolean(document.querySelector('[data-action="addProject"]')),
          hasConfigNav: bodyText.includes("Config"),
          hidesPlanProposalOnToggle,
          showsPlanProposalAfterPlanReply,
          inlinePlanRendersMarkdown,
          acceptPlanClosesViewer,
          openedAtLatest,
          openedLatestDistance,
          preservedHistoryPosition,
          followedLatest,
          followedLatestDistance,
          textStreamingBeforeIdle,
          hasThinkingFallback,
          hasRunningTool,
          keepsRunningToolStatusCompact,
          runningStepStartsOpen,
          runningStepCanClose,
          runningStepCanReopen,
          keepsCompletedTool,
          keepsCompletedToolStatusCompact,
          completedStepStartsClosed,
          completedStepCanReopen,
          hidesReadFileRef,
          hidesReadDiff,
          hidesRunningWriteFileRef,
          hidesErroredWriteFileRef,
          showsCodeFileRef,
          showsWriteDiff,
          rendersDiffViewer,
          rendersCodeViewer,
          rendersMermaidDiagram,
          rendersMermaidAtReadableSize,
          mermaidSvgSize,
          keepsNonMermaidCodeBlock,
          showsMermaidFallback,
          showsApplyPatchDiff,
          hasTranslationArtifact,
          keepsArtifactOutsideCollapsedStep,
          errorStepStartsOpen,
          hasRetryRow,
          hasAttachmentChip,
          removesAttachmentChip,
          keepsHistoryAttachment,
          hasUserMessageCard,
          hasAssistantMessageCard,
          hasUserCopyAction: Boolean(attachmentCopyButton),
          hasAssistantCopyAction: Boolean(assistantCopyButton),
          copyActionHiddenUntilFocus,
          copyActionVisibleOnFocus,
          copiesMessageWithToast,
          usesLocalRendererAssets,
          hasSidebarAccount,
          hasNoAssistantAvatars,
          hasWideChat,
          hasCompactReplyComposer,
          keepsNarrowGutters,
          hasLockedConfigFields:
            document.querySelectorAll(".form [readonly]").length >= 5 &&
            !document.querySelector('[data-action="newProvider"]') &&
            !document.querySelector('[data-model-modalities="output"]'),
          protectsApiKey:
            document.querySelector('[data-field="providerApiKey"]')?.type === "password" &&
            effectiveConfig.includes("[redacted]") &&
            !effectiveConfig.includes("smoke-secret"),
          showsInvalidModality,
          blocksInvalidModalitySave,
          keepsInvalidModalityOutOfProfile,
          hasPdfModelModality:
            document.querySelector('[data-model-modalities="input"]')?.value.split(",").map((item) => item.trim()).includes("pdf") &&
            configText.includes("App profile JSON") &&
            configText.includes('"pdf"') &&
            model.modalities.input.includes("pdf"),
          hasBuiltInSkills:
            configText.includes("Built-in skills") &&
            configText.includes("explain-project") &&
            configText.includes("find-bugs") &&
            configText.includes("write-tests") &&
            configText.includes("summarize-changes") &&
            configText.includes("code-review") &&
            configText.includes("docs-update") &&
            configText.includes("pdf") &&
            configText.includes("pptx") &&
            configText.includes("skill-creator") &&
            configText.includes("xlsx") &&
            configText.includes("docx") &&
            configText.includes("translate-document") &&
            configText.includes("translate-office-document") &&
            configText.includes("webapp-testing") &&
            document.querySelectorAll("[data-skill-toggle]").length === 14,
          runtimeStatus: runtime.status,
          runtimeLastError: runtime.lastError,
          runtimeCommand: runtime.runtime?.command,
          runtimeArgs: runtime.runtime?.args,
          runtimeLogs: runtime.logs?.slice(-5),
          hasTeamCopy:
            bodyText.includes("Acme Inc") ||
            bodyText.includes("Team projects") ||
            bodyText.includes("Invite") ||
            bodyText.includes("Shared knowledge") ||
            bodyText.includes("presence")
        }
      })()
    `
    const result = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    const value = result.result.value
    if (
      !value?.hasBrand ||
      !value.hasNewSession ||
      !value.hasPrompt ||
      !value.hasAddProject ||
      !value.hasConfigNav ||
      !value.hidesPlanProposalOnToggle ||
      !value.showsPlanProposalAfterPlanReply ||
      !value.inlinePlanRendersMarkdown ||
      !value.acceptPlanClosesViewer ||
      !value.openedAtLatest ||
      !value.preservedHistoryPosition ||
      !value.followedLatest ||
      !value.textStreamingBeforeIdle ||
      !value.hasThinkingFallback ||
      !value.hasRunningTool ||
      !value.keepsRunningToolStatusCompact ||
      !value.runningStepStartsOpen ||
      !value.runningStepCanClose ||
      !value.runningStepCanReopen ||
      !value.keepsCompletedTool ||
      !value.keepsCompletedToolStatusCompact ||
      !value.completedStepStartsClosed ||
      !value.completedStepCanReopen ||
      !value.hidesReadFileRef ||
      !value.hidesReadDiff ||
      !value.hidesRunningWriteFileRef ||
      !value.hidesErroredWriteFileRef ||
      !value.showsCodeFileRef ||
      !value.showsWriteDiff ||
      !value.rendersDiffViewer ||
      !value.rendersCodeViewer ||
      !value.rendersMermaidDiagram ||
      !value.rendersMermaidAtReadableSize ||
      !value.keepsNonMermaidCodeBlock ||
      !value.showsMermaidFallback ||
      !value.showsApplyPatchDiff ||
      !value.hasTranslationArtifact ||
      !value.keepsArtifactOutsideCollapsedStep ||
      !value.errorStepStartsOpen ||
      !value.hasRetryRow ||
      !value.hasAttachmentChip ||
      !value.removesAttachmentChip ||
      !value.keepsHistoryAttachment ||
      !value.hasUserMessageCard ||
      !value.hasAssistantMessageCard ||
      !value.hasUserCopyAction ||
      !value.hasAssistantCopyAction ||
      !value.copyActionHiddenUntilFocus ||
      !value.copyActionVisibleOnFocus ||
      !value.copiesMessageWithToast ||
      !value.usesLocalRendererAssets ||
      !value.hasSidebarAccount ||
      !value.hasNoAssistantAvatars ||
      !value.hasWideChat ||
      !value.hasCompactReplyComposer ||
      !value.keepsNarrowGutters ||
      !value.hasLockedConfigFields ||
      !value.protectsApiKey ||
      !value.showsInvalidModality ||
      !value.blocksInvalidModalitySave ||
      !value.keepsInvalidModalityOutOfProfile ||
      !value.hasPdfModelModality ||
      !value.hasBuiltInSkills
    ) {
      throw new Error(`Expected local desktop shell, received ${JSON.stringify(value)}`)
    }
    if (value.hasTeamCopy) {
      throw new Error(`Expected team/sharing copy to be removed, received ${JSON.stringify(value)}`)
    }
    if (packagedDesktopBin && value.runtimeStatus !== "running") {
      throw new Error(`Expected packaged desktop to launch bundled opencode runtime, received ${JSON.stringify(value)}`)
    }
    console.log("electron smoke passed")
  } finally {
    if (client) client.close()
    child.kill("SIGINT")
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL")
    }, 1000).unref()
  }

  if (stderr.includes("Uncaught")) {
    throw new Error(stderr)
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
