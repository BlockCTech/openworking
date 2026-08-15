<script>
  // Renders only while the bridged rightSidebarOpen flag is set.
  import FileTreeNode from "./FileTreeNode.svelte"
  import ChangesPanel from "./ChangesPanel.svelte"

  let { ctx, tick } = $props()

  // This island is not mounted with `delegate: true`, so its own DOM must dispatch through the
  // delegated tables explicitly - the same pattern FileTreeNode uses for its rows.
  const click = (attr) => (e) => ctx.actions.click(attr, e)

  let tab = $derived.by(() => {
    void $tick
    return ctx.state.rightSidebarTab === "changes" ? "changes" : "files"
  })

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    if (!state.rightSidebarOpen) return null
    const project = ctx.selectedProject()
    const rootChildren = state.fileTreeChildren.get("")
    let body
    if (!project) body = { kind: "state", message: "Open a project to browse files." }
    else if (state.fileTreeProjectId !== project.id || (state.fileTreeLoading.has("") && !rootChildren)) body = { kind: "state", message: "Loading files..." }
    else if (state.fileTreeError && !rootChildren) body = { kind: "error", message: state.fileTreeError }
    else if (!rootChildren?.length) body = { kind: "state", message: "No files found." }
    else body = { kind: "tree" }
    return {
      project,
      body,
      alert: state.fileTreeError && rootChildren ? state.fileTreeError : "",
      // Only meaningful with both panels open at once - toggling it with just Files open would
      // have nothing to stack against.
      showStackedToggle: Boolean(state.document),
      stacked: Boolean(state.stackedRightPanels),
      search: {
        query: state.fileSearchQuery || "",
        active: Boolean((state.fileSearchQuery || "").trim()),
        loading: state.fileSearchLoading,
        error: state.fileSearchError || "",
        results: state.fileSearchResults || []
      }
    }
  })

  function addFileToChat(filePath) {
    ctx.insertFileMentionAtCaret(filePath)
    ctx.state.fileTreeContextMenu = null
  }
</script>

{#if d}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="right-file-resizer" data-svelte-island data-right-file-resizer data-tip-main="Drag to resize" data-tip-sub="Adjust panel width" onmousedown={(e) => ctx.actions.mousedown("data-right-file-resizer", e)}></div>
  <aside class="right-file-sidebar" data-svelte-island>
    <div class="right-file-head">
      <div class="right-file-head-row">
        <div class="seg right-file-seg" role="tablist">
          <button class="seg-btn {tab === 'files' ? 'active' : ''}" data-right-tab="files" role="tab" aria-selected={tab === "files"} onclick={click("data-right-tab")}>Files</button>
          <button class="seg-btn {tab === 'changes' ? 'active' : ''}" data-right-tab="changes" role="tab" aria-selected={tab === "changes"} onclick={click("data-right-tab")}>Changes</button>
        </div>
        {#if d.showStackedToggle}
          <button
            class="right-file-layout-toggle"
            title={d.stacked ? "Switch to side-by-side" : "Switch to stacked (Files above Code)"}
            aria-label={d.stacked ? "Switch to side-by-side layout" : "Switch to stacked layout"}
            onclick={() => ctx.toggleStackedRightPanels()}
          >{@html ctx.icon(d.stacked ? "layoutColumns" : "layoutRows")}</button>
        {/if}
      </div>
      <span class="right-file-project" title={d.project?.path || ""}>
        {@html ctx.icon("folder")}<span class="right-file-project-name">{d.project?.name || ""}</span>
      </span>
    </div>
    {#if tab === "changes"}
      <ChangesPanel {ctx} {tick} />
    {:else}
      <div class="right-file-search">
        {@html ctx.icon("search")}
        <input
          type="text"
          placeholder="Search files"
          aria-label="Search files"
          value={d.search.query}
          oninput={(e) => ctx.searchProjectFiles(e.currentTarget.value)}
        />
      </div>
      {#if d.alert}<div class="file-tree-alert">{d.alert}</div>{/if}
      <div class="right-file-scroll">
        {#if d.search.active}
          {#if d.search.loading && !d.search.results.length}
            <div class="file-tree-state"><span class="file-tree-state-icon">{@html ctx.icon("search")}</span><p>Searching…</p></div>
          {:else if d.search.error}
            <div class="file-tree-state error"><span class="file-tree-state-icon">{@html ctx.icon("x")}</span><p>{d.search.error}</p></div>
          {:else if !d.search.results.length}
            <div class="file-tree-state"><span class="file-tree-state-icon">{@html ctx.icon("search")}</span><p>No files match "{d.search.query}".</p></div>
          {:else}
            <div class="file-tree file-search-results">
              {#each d.search.results as entry (entry.path)}
                <button
                  class="file-search-row"
                  disabled={entry.type === "directory"}
                  onclick={() => addFileToChat(entry.path)}
                >{@html ctx.icon(entry.type === "directory" ? "folder" : "doc")}<span>{entry.path}</span></button>
              {/each}
            </div>
          {/if}
        {:else if d.body.kind === "tree"}
          <div class="file-tree"><FileTreeNode {ctx} path="" depth={0} /></div>
        {:else if d.body.kind === "error"}
          <div class="file-tree-state error">
            <span class="file-tree-state-icon">{@html ctx.icon("x")}</span>
            <p>{d.body.message}</p>
          </div>
        {:else}
          <div class="file-tree-state">
            <span class="file-tree-state-icon">{@html ctx.icon("folder")}</span>
            <p>{d.body.message}</p>
          </div>
        {/if}
      </div>
    {/if}
  </aside>
  {#if tab === "files" && ctx.state.fileTreeContextMenu}
    <div class="mini-context-menu" style="left:{ctx.state.fileTreeContextMenu.x}px; top:{ctx.state.fileTreeContextMenu.y}px">
      <button class="pop-item" onclick={() => addFileToChat(ctx.state.fileTreeContextMenu.path)}>{@html ctx.icon("plus")}<span>Add to chat</span></button>
    </div>
  {/if}
{/if}
