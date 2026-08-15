<script>
  // Working-copy changes for the active project/worktree. Lists status only; the patch for a
  // row is fetched lazily by openVcsDiff when the user clicks it, so a huge diff never blocks
  // this list. Clicks go through the delegated tables (data-vcs-file), like the file tree.
  let { ctx, tick } = $props()

  // Rendered inside the right-sidebar island, which is not mounted with `delegate: true`, so
  // clicks must be dispatched through the delegated tables explicitly (as FileTreeNode does).
  const click = (attr) => (e) => ctx.actions.click(attr, e)

  const STATUS_LABEL = { added: "A", modified: "M", deleted: "D" }

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    const project = ctx.selectedProject()
    const files = Array.isArray(state.vcsFiles) ? state.vcsFiles : []
    let body
    if (!project) body = { kind: "state", message: "Open a project to see changes." }
    else if (state.vcsLoading && !files.length) body = { kind: "state", message: "Loading changes..." }
    else if (state.vcsError && !files.length) body = { kind: "error", message: state.vcsError }
    else if (!files.length) body = { kind: "state", message: "No uncommitted changes." }
    else body = { kind: "list" }
    return {
      project,
      files,
      body,
      // A non-fatal error while a previous list is still on screen shows as a banner instead of
      // replacing the content the user is reading.
      alert: state.vcsError && files.length ? state.vcsError : "",
      truncated: Boolean(state.vcsTruncated),
      openPath: state.document?.requestedPath || ""
    }
  })

  let totals = $derived.by(() => {
    let additions = 0
    let deletions = 0
    for (const entry of d?.files || []) {
      additions += entry.additions || 0
      deletions += entry.deletions || 0
    }
    return { additions, deletions }
  })
</script>

{#if d}
  <div class="vcs-head">
    <span class="vcs-count">
      {d.files.length}{d.truncated ? "+" : ""}
      {d.files.length === 1 && !d.truncated ? "file" : "files"}
    </span>
    {#if d.files.length}
      <span class="vcs-totals">
        <span class="vcs-add">+{totals.additions}</span>
        <span class="vcs-del">−{totals.deletions}</span>
      </span>
    {/if}
    <span class="vcs-head-grow"></span>
    <button
      class="vcs-refresh"
      data-action="refreshVcs"
      title="Refresh changes"
      aria-label="Refresh changes"
      disabled={ctx.state.vcsLoading}
      onclick={click("data-action")}
    >{@html ctx.icon("activity")}</button>
  </div>

  {#if d.alert}<div class="file-tree-alert">{d.alert}</div>{/if}
  {#if d.truncated}
    <div class="file-tree-alert">Showing the first {d.files.length} changed files.</div>
  {/if}

  <div class="right-file-scroll">
    {#if d.body.kind === "list"}
      <div class="vcs-list">
        {#each d.files as entry (entry.file)}
          <button
            class="vcs-row{d.openPath === entry.file ? ' active' : ''}"
            data-vcs-file={entry.file}
            title={entry.file}
            onclick={click("data-vcs-file")}
          >
            <span class="vcs-badge {entry.status}">{STATUS_LABEL[entry.status] || "M"}</span>
            <span class="vcs-name">{entry.file}</span>
            <span class="vcs-stat">
              {#if entry.additions}<span class="vcs-add">+{entry.additions}</span>{/if}
              {#if entry.deletions}<span class="vcs-del">−{entry.deletions}</span>{/if}
            </span>
          </button>
        {/each}
      </div>
    {:else if d.body.kind === "error"}
      <div class="file-tree-state error">
        <span class="file-tree-state-icon">{@html ctx.icon("x")}</span>
        <p>{d.body.message}</p>
      </div>
    {:else}
      <div class="file-tree-state">
        <span class="file-tree-state-icon">{@html ctx.icon("branch")}</span>
        <p>{d.body.message}</p>
      </div>
    {/if}
  </div>
{/if}
