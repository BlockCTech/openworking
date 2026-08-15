<script>
  let { ctx, tick } = $props()

  let editorEl = null
  // Tracks the promptDraft value currently reflected in the DOM. renderer.js has many call sites
  // that set ctx.state.promptDraft directly (send, revert restore/redo, suggestions, ...) without
  // a way to reach into this component's DOM — each one used to need its own manual re-sync call,
  // and it was easy to add a new site and forget (see sendPrompt(), which cleared the draft on
  // send but left the contenteditable showing the stale text). The effect below closes that class
  // of bug once: any external change to promptDraft gets picked up the next time this component's
  // `tick` bumps (i.e. the next render()), no per-call-site sync required.
  let syncedDraft = null

  function tokenRangeAtCaret(text, caret, direction) {
    let offset = 0
    for (const token of ctx.parsePromptTokens(text)) {
      const raw = token.type === "token" ? token.raw : token.text
      const start = offset
      const end = offset + raw.length
      offset = end
      if (token.type !== "token") continue
      if (direction === "backward" && caret === end) return { start, end }
      if (direction === "forward" && caret === start) return { start, end }
    }
    return null
  }

  function removeComposerTokenBoundary({ text, caret, direction }) {
    const range = tokenRangeAtCaret(String(text || ""), Number(caret || 0), direction)
    if (!range) return { text, caret }
    return {
      text: `${text.slice(0, range.start)}${text.slice(range.end)}`,
      caret: range.start
    }
  }

  function promptEditorText(editor) {
    if (!editor) return ""
    const chunks = []
    const visit = (node) => {
      if (!node) return
      if (node.nodeType === Node.TEXT_NODE) {
        chunks.push(node.textContent || "")
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      if (node.dataset?.tokenRaw) {
        chunks.push(node.dataset.tokenRaw)
        return
      }
      if (node.tagName === "BR") {
        chunks.push("\n")
        return
      }
      for (const child of node.childNodes) visit(child)
    }
    for (const child of editor.childNodes) visit(child)
    return chunks.join("").replace(/\u00a0/g, " ")
  }

  function promptEditorNodeLength(node) {
    if (!node) return 0
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent || "").length
    if (node.nodeType !== Node.ELEMENT_NODE) return 0
    if (node.dataset?.tokenRaw) return node.dataset.tokenRaw.length
    if (node.tagName === "BR") return 1
    let total = 0
    for (const child of node.childNodes) total += promptEditorNodeLength(child)
    return total
  }

  function promptEditorTokenAncestor(editor, node) {
    let current = node && node.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
    while (current && current !== editor) {
      if (current.dataset?.tokenRaw) return current
      current = current.parentElement
    }
    return null
  }

  function promptEditorOffsetForNode(editor, targetNode) {
    let total = 0
    for (const child of editor.childNodes) {
      if (child === targetNode) return total
      total += promptEditorNodeLength(child)
    }
    return total
  }

  function promptEditorOffsetWithin(root, targetNode, targetOffset) {
    if (targetNode === root) {
      let total = 0
      for (let index = 0; index < targetOffset; index += 1) total += promptEditorNodeLength(root.childNodes[index])
      return total
    }
    let total = 0
    const walk = (node) => {
      if (!node) return false
      if (node === targetNode) {
        if (node.nodeType === Node.TEXT_NODE) total += Math.min(targetOffset, (node.textContent || "").length)
        else {
          for (let index = 0; index < targetOffset; index += 1) total += promptEditorNodeLength(node.childNodes[index])
        }
        return true
      }
      if (node.nodeType === Node.TEXT_NODE) {
        total += (node.textContent || "").length
        return false
      }
      if (node.nodeType === Node.ELEMENT_NODE && node.dataset?.tokenRaw) {
        total += node.dataset.tokenRaw.length
        return false
      }
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "BR") {
        total += 1
        return false
      }
      for (const child of node.childNodes) {
        if (walk(child)) return true
      }
      return false
    }
    walk(root)
    return total
  }

  function promptEditorCaret(editor) {
    if (!editor) return 0
    const selection = window.getSelection?.()
    if (!selection?.rangeCount) return promptEditorText(editor).length
    const { anchorNode, anchorOffset } = selection
    if (!anchorNode || !editor.contains(anchorNode)) return promptEditorText(editor).length
    const tokenNode = promptEditorTokenAncestor(editor, anchorNode)
    if (tokenNode) {
      const tokenStart = promptEditorOffsetForNode(editor, tokenNode)
      return anchorOffset > 0 ? tokenStart + promptEditorNodeLength(tokenNode) : tokenStart
    }
    return promptEditorOffsetWithin(editor, anchorNode, anchorOffset)
  }

  function setPromptSelection(editor, rangeBuilder) {
    const selection = window.getSelection?.()
    if (!selection) return
    const range = document.createRange()
    rangeBuilder(range)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  function placeCaretAtTextOffset(editor, offset) {
    if (!editor) return
    let remaining = Math.max(0, Math.min(offset, promptEditorText(editor).length))
    for (const child of editor.childNodes) {
      const length = promptEditorNodeLength(child)
      if (remaining > length) {
        remaining -= length
        continue
      }
      if (child.nodeType === Node.TEXT_NODE) {
        setPromptSelection(editor, (range) => range.setStart(child, remaining))
        return
      }
      if (child.nodeType === Node.ELEMENT_NODE && child.dataset?.tokenRaw) {
        setPromptSelection(editor, (range) => {
          if (remaining <= 0) range.setStartBefore(child)
          else range.setStartAfter(child)
        })
        return
      }
      if (child.nodeType === Node.ELEMENT_NODE && child.tagName === "BR") {
        setPromptSelection(editor, (range) => range.setStartAfter(child))
        return
      }
      remaining -= length
    }
    setPromptSelection(editor, (range) => range.setStart(editor, editor.childNodes.length))
  }

  function autosize(editor) {
    if (!editor) return
    editor.style.height = "auto"
    editor.style.height = `${Math.min(editor.scrollHeight, 200)}px`
  }

  function syncFromState(caret = null) {
    if (!editorEl) return
    editorEl.innerHTML = ctx.renderPromptTokensHtml(ctx.state.promptDraft, ctx.state.pendingFileMentions)
    autosize(editorEl)
    if (caret !== null) placeCaretAtTextOffset(editorEl, caret)
    syncedDraft = ctx.state.promptDraft
  }

  function insertPlainTextAtSelection(editor, text) {
    const selection = window.getSelection?.()
    if (!editor || !selection?.rangeCount) return
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    range.setStart(node, node.textContent.length)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  function handleInput() {
    // Skip while an IME composition is in progress to avoid corrupting it.
    if (ctx.state.promptComposing) return
    ctx.state.promptDraft = promptEditorText(editorEl)
    // The DOM already reflects this value (it's what the user just typed) — mark it synced so the
    // external-change effect below doesn't rewrite the editor and clobber the caret on next tick.
    syncedDraft = ctx.state.promptDraft
    ctx.syncPendingFileMentions(ctx.state.promptDraft, { rerender: false })
    autosize(editorEl)
    syncSendButton()
    // Opens the command/file-mention menu for a trailing "/word" or "@word" before the caret.
    ctx.syncPromptAssist(editorEl)
  }

  // The send button is legacy {@html} markup that only regenerates on a full render(), which
  // would drop this editor's focus/caret — so toggle its disabled class imperatively instead.
  function syncSendButton() {
    const send = document.querySelector(".send")
    if (send) send.classList.toggle("disabled", ctx.state.promptSubmitInFlight || !ctx.state.promptDraft.trim())
  }

  function handleKeydown(event) {
    if (event.isComposing || ctx.state.promptComposing) return
    if (ctx.state.commandMenu.open) {
      const candidates = ctx.commandCandidates(ctx.state.commandMenu.query)
      if (event.key === "ArrowDown") {
        event.preventDefault()
        ctx.state.commandMenu.index = Math.min(ctx.state.commandMenu.index + 1, Math.max(candidates.length - 1, 0))
        ctx.state.promptAssistKeyboardActive = true
        ctx.paintCommandMenu()
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        ctx.state.commandMenu.index = Math.max(ctx.state.commandMenu.index - 1, 0)
        ctx.state.promptAssistKeyboardActive = true
        ctx.paintCommandMenu()
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        const choice = candidates[ctx.state.commandMenu.index]
        if (choice) ctx.selectCommand(choice.name)
        else ctx.closeCommandMenu()
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        ctx.closeCommandMenu()
        return
      }
    }
    if (ctx.state.fileMentionMenu.open) {
      const candidates = ctx.fileMentionCandidates(ctx.state.fileMentionMenu.query)
      if (event.key === "ArrowDown") {
        event.preventDefault()
        ctx.state.fileMentionMenu.index = Math.min(ctx.state.fileMentionMenu.index + 1, Math.max(candidates.length - 1, 0))
        ctx.state.promptAssistKeyboardActive = true
        ctx.paintPromptAssistMenu()
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        ctx.state.fileMentionMenu.index = Math.max(ctx.state.fileMentionMenu.index - 1, 0)
        ctx.state.promptAssistKeyboardActive = true
        ctx.paintPromptAssistMenu()
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        const choice = candidates[ctx.state.fileMentionMenu.index]
        if (choice) ctx.selectFileMention(choice).catch((error) => ctx.showToast(error.message))
        else ctx.closeFileMentionMenu()
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        ctx.closeFileMentionMenu()
        return
      }
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      const next = removeComposerTokenBoundary({
        text: ctx.state.promptDraft,
        caret: promptEditorCaret(editorEl),
        direction: event.key === "Backspace" ? "backward" : "forward"
      })
      if (next.text !== ctx.state.promptDraft) {
        event.preventDefault()
        ctx.state.promptDraft = next.text
        syncFromState(next.caret)
        syncSendButton()
        ctx.syncPendingFileMentions(ctx.state.promptDraft, { rerender: false })
        return
      }
    }
    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault()
      insertPlainTextAtSelection(editorEl, "\n")
      handleInput()
      return
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      ctx.sendPrompt(ctx.state.promptDraft)
    }
  }

  function handleCompositionStart() {
    ctx.state.promptComposing = true
  }

  function handleCompositionEnd() {
    ctx.state.promptComposing = false
    handleInput()
  }

  function handlePaste(event) {
    event.preventDefault()
    insertPlainTextAtSelection(editorEl, event.clipboardData?.getData("text/plain") || "")
    handleInput()
    syncFromState(promptEditorCaret(editorEl))
  }

  function editorAction(node) {
    editorEl = node
    syncFromState(null)
    syncSendButton()
    node.addEventListener("input", handleInput)
    node.addEventListener("keydown", handleKeydown)
    node.addEventListener("paste", handlePaste)
    node.addEventListener("compositionstart", handleCompositionStart)
    node.addEventListener("compositionend", handleCompositionEnd)
    return {
      destroy() {
        node.removeEventListener("input", handleInput)
        node.removeEventListener("keydown", handleKeydown)
        node.removeEventListener("paste", handlePaste)
        node.removeEventListener("compositionstart", handleCompositionStart)
        node.removeEventListener("compositionend", handleCompositionEnd)
        editorEl = null
      }
    }
  }

  // ctx.state is a plain object (not Svelte-reactive), so renderer.js mutating promptDraft alone
  // is invisible here — `tick` is the one real reactive source, bumped by every full render(). On
  // each bump, check whether promptDraft moved since the last DOM sync (from typing or an explicit
  // syncFromState call) and, if so, pull the new value in. Skipped while composing so an unrelated
  // render() can't stomp on an in-progress IME composition.
  $effect(() => {
    void $tick
    if (!editorEl || ctx.state.promptComposing) return
    if (ctx.state.promptDraft === syncedDraft) return
    syncFromState(ctx.state.promptDraft.length)
  })
</script>

<div id="promptInput" class="prompt-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder={ctx.state.composerPlaceholder} use:editorAction></div>
