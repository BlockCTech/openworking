<script>
  let { tree } = $props()

  function countRuns(runs) {
    return (runs || []).reduce((count, run) => count + 1 + countRuns(run.children), 0)
  }

  function statusLabel(status) {
    if (status === "succeeded") return "Succeeded"
    if (status === "failed") return "Failed"
    return "Running"
  }

  function statusIcon(status) {
    if (status === "succeeded") return "✓"
    if (status === "failed") return "!"
    return "●"
  }

  let count = $derived(countRuns(tree?.runs))
</script>

{#snippet runNode(run, depth)}
  <li class="subagent-run-node" role="treeitem" aria-level={depth + 1} aria-selected="false" style={`--subagent-indent:${depth * 18}px`}>
    <div class="subagent-run-row">
      <span class="subagent-run-connector" aria-hidden="true"></span>
      <span class="subagent-run-copy">
        <strong>{run.agent || "Subagent"}</strong>
        <span>{run.description || run.title || "Subagent task"}</span>
      </span>
      <span class="subagent-run-status {run.status}" aria-label={`Status: ${statusLabel(run.status)}`}>
        <span aria-hidden="true">{statusIcon(run.status)}</span>
        {statusLabel(run.status)}
      </span>
    </div>
    {#if run.children?.length}
      <ul class="subagent-run-children" role="group">
        {#each run.children as child (child.sessionId)}
          {@render runNode(child, depth + 1)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

{#if tree?.runs?.length}
  <section class="subagent-run-tree" aria-label="Subagent runs">
    <header>
      <strong>Subagent runs</strong>
      <span>{count} {count === 1 ? "run" : "runs"}</span>
    </header>
    <ul class="subagent-run-list" role="tree" aria-label="Subagent execution tree">
      {#each tree.runs as run (run.sessionId)}
        {@render runNode(run, 0)}
      {/each}
    </ul>
    {#if tree.truncated}
      <p class="subagent-run-truncated">Showing first 100 runs.</p>
    {/if}
  </section>
{/if}
