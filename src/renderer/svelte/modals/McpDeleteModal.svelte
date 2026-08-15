<script>
  // 1:1 translation of renderer.js renderMcpDeleteModal().
  let { ctx, tick } = $props()

  const click = (attr) => (e) => ctx.actions.click(attr, e)

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    const target = state.mcpDeleteTarget
    if (!target) return null
    return { name: target.name, removing: Boolean(state.mcpRemoving) }
  })
</script>

{#if d}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="update-backdrop" data-svelte-island data-action={d.removing ? null : "cancelRemoveMcp"} onclick={click("data-action")}>
    <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="removeMcpTitle" data-stop-click>
      <div class="confirm-title" id="removeMcpTitle">Remove MCP server?</div>
      <p>“{d.name}” will be disconnected and removed from your config.</p>
      <div class="confirm-actions">
        <button class="secondary-btn{d.removing ? ' disabled' : ''}" data-action="cancelRemoveMcp" onclick={click("data-action")}>Cancel</button>
        <button class="danger-btn{d.removing ? ' disabled' : ''}" data-action="confirmRemoveMcp" onclick={click("data-action")}>Remove</button>
      </div>
    </div>
  </div>
{/if}
