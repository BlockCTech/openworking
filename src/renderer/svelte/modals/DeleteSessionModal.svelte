<script>
  // 1:1 translation of renderer.js renderDeleteSessionModal(). Backdrop click cancels unless a
  // delete is in flight; clicks inside the [data-stop-click] content are skipped by the shared
  // dispatch boundary rule, mirroring the legacy dispatcher.
  let { ctx, tick } = $props()

  const click = (attr) => (e) => ctx.actions.click(attr, e)

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    const target = state.sessionDeleteTarget
    if (!target) return null
    return { title: target.title, deleting: Boolean(state.sessionDeleting), error: state.sessionDeleteError || "" }
  })
</script>

{#if d}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="update-backdrop" data-svelte-island data-action={d.deleting ? null : "cancelDeleteSession"} onclick={click("data-action")}>
    <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="deleteSessionTitle" data-stop-click>
      <div class="confirm-title" id="deleteSessionTitle">Delete session?</div>
      <p>“{d.title}” will be permanently deleted. This can’t be undone.</p>
      <div class="field-error">{d.error}</div>
      <div class="confirm-actions">
        <button class="secondary-btn{d.deleting ? ' disabled' : ''}" data-action="cancelDeleteSession" onclick={click("data-action")}>Cancel</button>
        <button class="danger-btn{d.deleting ? ' disabled' : ''}" data-action="confirmDeleteSession" onclick={click("data-action")}>{d.deleting ? "Deleting..." : "Delete"}</button>
      </div>
    </div>
  </div>
{/if}
