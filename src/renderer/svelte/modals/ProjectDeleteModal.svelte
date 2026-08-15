<script>
  // 1:1 translation of renderer.js renderProjectDeleteModal().
  let { ctx, tick } = $props()

  const click = (attr) => (e) => ctx.actions.click(attr, e)

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    const target = state.projectDeleteTarget
    if (!target) return null
    return { name: target.name, removing: Boolean(state.projectRemoving), error: state.projectDeleteError || "" }
  })
</script>

{#if d}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="update-backdrop" data-svelte-island data-action={d.removing ? null : "cancelRemoveProject"} onclick={click("data-action")}>
    <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="removeProjectTitle" data-stop-click>
      <div class="confirm-title" id="removeProjectTitle">Remove project?</div>
      <p>“{d.name}” will be removed from this list. Your files on disk are not deleted.</p>
      <div class="field-error">{d.error}</div>
      <div class="confirm-actions">
        <button class="secondary-btn{d.removing ? ' disabled' : ''}" data-action="cancelRemoveProject" onclick={click("data-action")}>Cancel</button>
        <button class="danger-btn{d.removing ? ' disabled' : ''}" data-action="confirmRemoveProject" onclick={click("data-action")}>Remove</button>
      </div>
    </div>
  </div>
{/if}
