<script>
  // One recursion level of the right file sidebar's tree. Reads the bridged fileTree* fields
  // directly so lazy directory loads update the subtree fine-grained.
  import FileTreeNode from "./FileTreeNode.svelte"

  let { ctx, path, depth } = $props()

  const click = (attr) => (e) => ctx.actions.click(attr, e)

  let entries = $derived(ctx.state.fileTreeChildren.get(path) || [])
  let padding = $derived(10 + depth * 14)

  // Right-click "Add to chat": clamp so the menu never opens off the right edge (the file tree is
  // the rightmost panel). The popup itself lives in RightFileSidebar.svelte as a sibling of
  // <aside class="right-file-sidebar">, not nested inside it - that element's `contain: layout
  // paint` (for its slide transition) would otherwise clip a position:fixed popup to its own box.
  function openFileContextMenu(event, filePath) {
    event.preventDefault()
    const menuWidth = 180
    ctx.state.fileTreeContextMenu = {
      path: filePath,
      x: Math.min(event.clientX, window.innerWidth - menuWidth - 8),
      y: Math.min(event.clientY, window.innerHeight - 48)
    }
  }
</script>

{#each entries as entry (entry.path)}
  {#if entry.type === "directory"}
    {@const open = ctx.state.fileTreeExpanded.has(entry.path)}
    {@const loaded = ctx.state.fileTreeChildren.has(entry.path)}
    {@const loading = ctx.state.fileTreeLoading.has(entry.path)}
    <div class="file-tree-node">
      <button class="file-tree-row directory {open ? 'open' : ''}" data-tree-dir={entry.path} style="--tree-pad:{padding}px" title={entry.path} onclick={click("data-tree-dir")}>
        <span class="file-tree-chev">{@html ctx.icon(open ? "chevDown" : "chevRight")}</span>
        <span class="file-tree-icon">{@html ctx.icon("folder")}</span>
        <span class="file-tree-name">{entry.name}</span>
      </button>
      {#if open}
        <!-- --tree-pad is repeated here (not just on the row) so .file-tree-children::before can
             draw its indent guide under the parent chevron. -->
        <div class="file-tree-children" style="--tree-pad:{padding}px">
          {#if loading && !loaded}
            <div class="file-tree-state inline" style="--tree-pad:{padding + 28}px">Loading...</div>
          {:else}
            <FileTreeNode {ctx} path={entry.path} depth={depth + 1} />
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <button
      class="file-tree-row file {entry.openable ? '' : 'disabled'} {ctx.state.document?.requestedPath === entry.path ? 'active' : ''}"
      data-tree-file={entry.openable ? entry.path : null}
      style="--tree-pad:{padding + 22}px"
      title={entry.path}
      onclick={entry.openable ? click("data-tree-file") : null}
      oncontextmenu={entry.openable ? (e) => openFileContextMenu(e, entry.path) : null}
    >
      <span class="file-tree-icon">{@html ctx.icon("doc")}</span>
      <span class="file-tree-name">{entry.name}</span>
    </button>
  {/if}
{/each}
