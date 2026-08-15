<script>
  // 1:1 translation of renderer.js renderRenameSessionModal(). The autofocus block that lived in
  // bindEvents() runs here as an $effect (bindEvents skips it on the Svelte path).
  let { ctx, tick } = $props()

  const click = (attr) => (e) => ctx.actions.click(attr, e)

  let inputEl = $state(null)

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    const target = state.sessionRenameTarget
    if (!target) return null
    return {
      currentLabel: ctx.sessionDisplayTitle(target),
      draft: state.sessionRenameDraft ?? "",
      renaming: Boolean(state.sessionRenaming),
      error: state.sessionRenameError || ""
    }
  })

  $effect(() => {
    if (d && ctx.state.sessionRenameAutoFocus && inputEl) {
      inputEl.focus()
      inputEl.select()
      ctx.state.sessionRenameAutoFocus = false
    }
  })
</script>

{#if d}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="update-backdrop" data-svelte-island data-action={d.renaming ? null : "cancelRenameSession"} onclick={click("data-action")}>
    <div class="confirm-modal rename-modal" role="dialog" aria-modal="true" aria-labelledby="renameSessionTitle" data-stop-click>
      <div class="confirm-title" id="renameSessionTitle">Rename session</div>
      <div class="rename-modal-body">
        <p>Current title: “{d.currentLabel}”</p>
        <label for="renameSessionInput">
          Session title
          <input
            id="renameSessionInput"
            type="text"
            value={d.draft}
            placeholder="Untitled session"
            data-session-rename-input
            disabled={d.renaming}
            bind:this={inputEl}
            oninput={(e) => ctx.actions.input("data-session-rename-input", e)}
            onkeydown={(e) => ctx.actions.renameKeydown(e)}
          >
        </label>
        <div class="field-error">{d.error}</div>
      </div>
      <div class="confirm-actions">
        <button class="secondary-btn{d.renaming ? ' disabled' : ''}" data-action="cancelRenameSession" onclick={click("data-action")}>Cancel</button>
        <button class="primary-btn{d.renaming ? ' disabled' : ''}" data-action="confirmRenameSession" onclick={click("data-action")}>Rename</button>
      </div>
    </div>
  </div>
{/if}
