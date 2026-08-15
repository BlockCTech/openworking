<script>
  // Markdown/diff/code bodies come through the shared markup.js helpers via {@html}; mermaid
  // re-scans run in an $effect after the body content changes.
  let { ctx, tick } = $props()

  const click = (attr) => (e) => ctx.actions.click(attr, e)

  let viewerEl = $state(null)

  let d = $derived.by(() => {
    void $tick
    const doc = ctx.state.document
    if (!doc) return null
    const crumbs = (doc.relativePath || doc.name || "").split(/[\\/]/).filter(Boolean)
    const path = doc.path || doc.requestedPath || doc.name
    const hasDiff = Boolean(doc.diff)
    const hasRealFile = ctx.isViewableFilePath(path)
    const tab = hasDiff && (doc.tab === "diff" || !hasRealFile) ? "diff" : "code"
    const renderMode = doc.renderMode || (ctx.isMarkdownFilePath(path) ? "markdown" : "code")
    // Independent of the Diff/Code tab above: a markdown file always offers a Preview/Raw pair,
    // defaulting to Preview until the user switches (doc.mdView never carries over between files).
    const showMdViewToggle = renderMode === "markdown"
    const mdView = doc.mdView === "raw" ? "raw" : "preview"
    const showExternalAction = Boolean(doc.artifact && doc.path && !doc.loading && !doc.error)
    const showAddToChat = Boolean(hasRealFile && doc.path && !doc.loading && !doc.error)
    let body
    if (doc.loading) body = { kind: "loading" }
    else if (tab === "diff") body = { kind: "diff", html: ctx.renderUnifiedDiff(doc.diff, path) }
    else if (doc.previewMode === "missing") body = { kind: "missing" }
    else if (doc.error) body = { kind: "error", message: doc.error }
    else if (doc.previewMode === "pdf") body = { kind: "pdf", url: doc.url || "", title: doc.name || "PDF preview" }
    else if (doc.previewMode === "external") body = { kind: "external" }
    else if (showMdViewToggle && mdView === "preview") body = { kind: "markdown", html: ctx.renderMarkdown(doc.content) }
    else body = { kind: "code", html: ctx.highlightCode(doc.content, path) }
    // Plain display-only gutter text, joined the same way as the code itself (\n, no soft-wrap -
    // .doc-code is white-space:pre) so it lines up 1:1 without touching the highlighted markup.
    const codeLineNumbers = body.kind === "code"
      ? Array.from({ length: (doc.content || "").split("\n").length }, (_, index) => index + 1).join("\n")
      : ""
    return {
      doc,
      path,
      crumbs: crumbs.length ? crumbs : null,
      fallbackName: doc.name || "",
      hasDiff,
      hasRealFile,
      tab,
      showMdViewToggle,
      mdView,
      truncated: Boolean(doc.truncated),
      showExternalAction,
      showAddToChat,
      codeLineNumbers,
      typeLabel: ctx.artifactTypeLabel(doc),
      shellName: doc.name || ctx.filename(doc.path),
      body
    }
  })

  $effect(() => {
    if (d && (d.body.kind === "markdown" || d.body.kind === "diff") && viewerEl) {
      ctx.scheduleMermaidRender?.(viewerEl)
    }
  })

  // Right-click "Add to chat" for a code-tab text selection: { x, y, startLine, endLine } or null.
  // A floating button that tracked selectionchange was tried first and dropped: it goes stale
  // once scrolled, and its own click raced the selectionchange it triggered. Right-clicking
  // INSIDE a selection preserves it (unlike a left click), so reading window.getSelection() from
  // oncontextmenu is race-free and opens the menu exactly at the cursor.
  let snippetMenu = $state(null)

  function handleCodeContextMenu(event) {
    if (d?.body?.kind !== "code") return
    const preEl = event.currentTarget
    const selection = window.getSelection?.()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const lines = range ? ctx.selectionLineRange(preEl, range, d.doc.content) : null
    if (!lines) return
    event.preventDefault()
    const menuWidth = 170
    snippetMenu = {
      startLine: lines.startLine,
      endLine: lines.endLine,
      x: Math.min(event.clientX, window.innerWidth - menuWidth - 8),
      y: Math.min(event.clientY, window.innerHeight - 48)
    }
  }

  // Only active while the menu is open - closes on outside click or Escape. The Files panel's
  // context menu handles this via renderer.js's global listeners since its trigger/popup live in
  // different components; here both live in this component, so a local effect is simpler.
  $effect(() => {
    if (!snippetMenu) return
    const closeOnOutsideClick = (event) => {
      if (!event.target.closest?.(".mini-context-menu")) snippetMenu = null
    }
    const closeOnEscape = (event) => {
      if (event.key === "Escape") snippetMenu = null
    }
    document.addEventListener("click", closeOnOutsideClick)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("click", closeOnOutsideClick)
      document.removeEventListener("keydown", closeOnEscape)
    }
  })

  // Switching away from the code tab (or closing the doc) must not leave a stale menu pointing
  // at a selection in markup that's no longer even in the DOM.
  $effect(() => {
    if (d?.body?.kind !== "code") snippetMenu = null
  })

  function addSnippetToChat() {
    if (!snippetMenu || !d) return
    const base = ctx.filename(d.doc.path)
    const { startLine, endLine } = snippetMenu
    const label = endLine > startLine ? `${base}:${startLine}-${endLine}` : `${base}:${startLine}`
    ctx.insertFileMentionAtCaret(d.doc.path, { label })
    window.getSelection?.()?.removeAllRanges()
    snippetMenu = null
  }

  // In-file search for the code tab. Highlighting uses the CSS Custom Highlight API instead of
  // wrapping matches in <mark>: a match can straddle plain text and a highlight.js <span>, which
  // would make Range.surroundContents() throw - Custom Highlight paints Ranges without touching
  // the DOM. It's Chromium-only (not in jsdom), so it's guarded behind a feature check.
  let searchOpen = $state(false)
  let searchQuery = $state("")
  let searchMatches = $state([])
  let searchIndex = $state(0)
  let searchInputEl = $state(null)
  // Plain (non-reactive) handle for the pending debounce timeout - also doubles as the "is there
  // an un-searched edit" flag Enter checks below, so it doesn't need its own piece of state.
  let searchDebounceTimer = null
  const SEARCH_DEBOUNCE_MS = 1000

  function clearSearchHighlights() {
    if (!window.CSS?.highlights) return
    CSS.highlights.delete("doc-search-match")
    CSS.highlights.delete("doc-search-current")
  }

  function applySearchHighlights(ranges, index) {
    if (!window.CSS?.highlights || !ranges.length) return
    CSS.highlights.set("doc-search-match", new Highlight(...ranges))
    CSS.highlights.set("doc-search-current", new Highlight(ranges[index]))
  }

  // Scrolls the current match into view only on the axis where it isn't visible, using the
  // match's own rect (not scrollIntoView on its wider/taller parent, which would jump based on
  // the wrong box).
  // Vertical: .doc-scroll owns the panel's scroll; only jumps when the match is outside the
  // middle 25%-75% band, centering it there so an already-visible match stays put.
  // Horizontal: the hljs theme puts overflow-x on <code> itself (not the .doc-code <pre>, which
  // has nothing left to overflow), so <code> is the real scroll box; this is a simple visibility
  // check, nudging to the nearest edge rather than centering.
  function revealCurrentMatch() {
    const range = searchMatches[searchIndex]
    const target = range?.startContainer?.parentElement
    if (!target) return
    const verticalContainer = viewerEl?.querySelector(".doc-scroll")
    const horizontalContainer = viewerEl?.querySelector(".doc-code code")
    if (!verticalContainer || !horizontalContainer || typeof range.getBoundingClientRect !== "function") {
      target.scrollIntoView({ block: "center" })
      return
    }
    const verticalRect = verticalContainer.getBoundingClientRect()
    const horizontalRect = horizontalContainer.getBoundingClientRect()
    if (!verticalRect.height || !horizontalRect.width) {
      target.scrollIntoView({ block: "center" })
      return
    }
    const matchRect = range.getBoundingClientRect()
    const relativeTop = matchRect.top - verticalRect.top
    const outsideVerticalBand = relativeTop < verticalRect.height * 0.25 || relativeTop > verticalRect.height * 0.75
    const outsideHorizontalView = matchRect.left < horizontalRect.left || matchRect.right > horizontalRect.right
    if (outsideVerticalBand) {
      verticalContainer.scrollTop += relativeTop - verticalRect.height / 2 + matchRect.height / 2
    }
    if (outsideHorizontalView) {
      if (matchRect.left < horizontalRect.left) horizontalContainer.scrollLeft -= horizontalRect.left - matchRect.left
      else if (matchRect.right > horizontalRect.right) horizontalContainer.scrollLeft += matchRect.right - horizontalRect.right
    }
  }

  // Actually (re)builds matches for the current query. Runs after the debounce timer below fires,
  // or immediately for Enter / an empty query, so the user is never blocked on the 1s delay.
  function runSearch() {
    const query = searchQuery
    const active = searchOpen && d?.body?.kind === "code"
    if (!active || !query) {
      searchMatches = []
      searchIndex = 0
      clearSearchHighlights()
      return
    }
    const preEl = viewerEl?.querySelector(".doc-code")
    const ranges = preEl ? ctx.buildMatchRanges(preEl, d.doc.content, query) : []
    searchMatches = ranges
    searchIndex = 0
    applySearchHighlights(ranges, 0)
    if (ranges.length) revealCurrentMatch()
  }

  // Debounces search: recomputing matches on every keystroke stalled typing on larger files, so a
  // fresh query waits 1s after the user stops typing; Enter or clearing the query skip the wait.
  $effect(() => {
    const query = searchQuery
    const active = searchOpen && d?.body?.kind === "code"
    if (!active || !query) {
      runSearch()
      return
    }
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null
      runSearch()
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(searchDebounceTimer)
      searchDebounceTimer = null
    }
  })

  $effect(() => {
    if (searchOpen) searchInputEl?.focus()
  })

  // Leaving the code tab (switch to Diff/Preview, or close the doc) must close the search bar too
  // - its matches point at DOM that's about to stop being the visible body.
  $effect(() => {
    if (d?.body?.kind !== "code" && searchOpen) {
      searchOpen = false
      searchQuery = ""
    }
  })

  function openSearch() {
    if (d?.body?.kind !== "code") return
    searchOpen = true
    searchQuery = ""
  }

  function closeSearch() {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
    searchOpen = false
    searchQuery = ""
  }

  function goToSearchMatch(step) {
    if (!searchMatches.length) return
    searchIndex = (searchIndex + step + searchMatches.length) % searchMatches.length
    if (window.CSS?.highlights) CSS.highlights.set("doc-search-current", new Highlight(searchMatches[searchIndex]))
    revealCurrentMatch()
  }

  function handleSearchInputKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault()
      // A pending debounce timer means this query hasn't been searched yet - Enter runs it now
      // instead of waiting out the 1s; once searched, Enter/Shift+Enter navigate matches instead.
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer)
        searchDebounceTimer = null
        runSearch()
      } else {
        goToSearchMatch(event.shiftKey ? -1 : 1)
      }
    } else if (event.key === "Escape") {
      event.preventDefault()
      closeSearch()
    }
  }

  // Cmd/Ctrl+F opens search while viewing the code tab, pre-empting Electron's own in-page find.
  $effect(() => {
    const handleWindowKeydown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f" && d?.body?.kind === "code") {
        event.preventDefault()
        openSearch()
      }
    }
    window.addEventListener("keydown", handleWindowKeydown)
    return () => window.removeEventListener("keydown", handleWindowKeydown)
  })
</script>

{#snippet externalAction()}
  <div class="doc-artifact-actions">
    <span>{d.typeLabel} artifact preview</span>
    <button class="secondary-btn" data-action="openExternalArtifact" data-artifact-path={d.doc.path} onclick={click("data-action")}>{@html ctx.icon("arrowUp")}Open externally</button>
  </div>
{/snippet}

{#if d}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="document-resizer" data-svelte-island data-document-resizer data-tip-main="Drag to resize" data-tip-sub="Adjust preview width" onmousedown={(e) => ctx.actions.mousedown("data-document-resizer", e)}></div>
  <aside class="document-viewer" data-svelte-island bind:this={viewerEl}>
    <div class="doc-head">
      <div class="doc-crumbs">
        {#if d.crumbs}
          {#each d.crumbs as crumb, index}
            {#if index > 0}<span class="doc-crumb-sep">{@html ctx.icon("chevRight")}</span>{/if}
            <span class="doc-crumb{index === d.crumbs.length - 1 ? ' current' : ''}">{crumb}</span>
          {/each}
        {:else}{d.fallbackName}{/if}
      </div>
      {#if d.hasDiff || d.showMdViewToggle}
        <div class="doc-tabs" role="tablist">
          {#if d.hasDiff}
            <button class="doc-tab" role="tab" data-doc-tab="diff" aria-selected={d.tab === "diff"} onclick={click("data-doc-tab")}>Diff</button>
          {/if}
          {#if d.showMdViewToggle}
            <button class="doc-tab" role="tab" data-md-view="preview" aria-selected={d.tab !== "diff" && d.mdView === "preview"} onclick={() => ctx.switchMarkdownView("preview")}>Preview</button>
            <button class="doc-tab" role="tab" data-md-view="raw" aria-selected={d.tab !== "diff" && d.mdView === "raw"} onclick={() => ctx.switchMarkdownView("raw")}>Raw</button>
          {:else if d.hasDiff && d.hasRealFile}
            <button class="doc-tab" role="tab" data-doc-tab="code" aria-selected={d.tab === "code"} onclick={click("data-doc-tab")}>Code</button>
          {/if}
        </div>
      {/if}
      <div class="wrapper-doc-button">
        {#if d.body.kind === "code"}
          <button class="doc-search-toggle" title="Find in file" aria-label="Find in file" onclick={openSearch}>{@html ctx.icon("search")}</button>
        {/if}
        {#if d.showAddToChat}
          <button class="doc-add-to-chat" title="Add to chat" aria-label="Add to chat" onclick={() => ctx.insertFileMentionAtCaret(d.doc.path)}>{@html ctx.icon("plus")}</button>
        {/if}
      </div>
      <button class="doc-close" data-action="closeDocument" title="Close" aria-label="Close" onclick={click("data-action")}>{@html ctx.icon("x")}</button>
    </div>
    {#if searchOpen}
      <div class="doc-search-bar">
        <input
          bind:this={searchInputEl}
          class="doc-search-input"
          type="text"
          placeholder="Find in file"
          bind:value={searchQuery}
          onkeydown={handleSearchInputKeydown}
        />
        <span class="doc-search-count">{searchMatches.length ? `${searchIndex + 1}/${searchMatches.length}` : "0/0"}</span>
        <button class="doc-search-nav" title="Previous match" aria-label="Previous match" onclick={() => goToSearchMatch(-1)}>{@html ctx.icon("arrowUp")}</button>
        <button class="doc-search-nav down" title="Next match" aria-label="Next match" onclick={() => goToSearchMatch(1)}>{@html ctx.icon("arrowUp")}</button>
        <button class="doc-search-close" title="Close search" aria-label="Close search" onclick={closeSearch}>{@html ctx.icon("x")}</button>
      </div>
    {/if}
    <div class="doc-scroll">
      {#if d.body.kind === "loading"}
        <div class="doc-state">Loading…</div>
      {:else if d.body.kind === "diff"}
        {@html d.body.html}
      {:else if d.body.kind === "missing"}
        <div class="doc-state">Unable to load file</div>
      {:else if d.body.kind === "error"}
        <div class="doc-state error">{d.body.message}</div>
      {:else if d.body.kind === "pdf"}
        {#if d.showExternalAction}{@render externalAction()}{/if}
        <iframe class="doc-pdf" src={d.body.url} title={d.body.title}></iframe>
      {:else if d.body.kind === "external"}
        <div class="doc-artifact-shell">
          {@html ctx.icon("doc")}
          <strong>{d.shellName}</strong>
          <span>{d.typeLabel} preview is available as file metadata in this panel.</span>
          <small>{d.doc.path || ""}</small>
          <button class="secondary-btn" data-action="openExternalArtifact" data-artifact-path={d.doc.path || ""} onclick={click("data-action")}>{@html ctx.icon("arrowUp")}Open externally</button>
        </div>
      {:else if d.body.kind === "markdown"}
        {#if d.showExternalAction}{@render externalAction()}{/if}
        <div class="doc-content assistant-text">{@html d.body.html}</div>
        {#if d.truncated}<small class="doc-truncated">File truncated.</small>{/if}
      {:else}
        <div class="doc-code-wrap">
          <div class="doc-code-gutter" aria-hidden="true">{d.codeLineNumbers}</div>
          <pre class="doc-code" oncontextmenu={handleCodeContextMenu}><code class="hljs">{@html d.body.html}</code></pre>
        </div>
        {#if d.truncated}<small class="doc-truncated">File truncated.</small>{/if}
      {/if}
    </div>
  </aside>
  {#if snippetMenu}
    <div class="mini-context-menu" style="left:{snippetMenu.x}px; top:{snippetMenu.y}px">
      <button class="pop-item" onclick={addSnippetToChat}>{@html ctx.icon("plus")}<span>Add to chat</span></button>
    </div>
  {/if}
{/if}
