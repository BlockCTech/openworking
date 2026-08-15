<script>
  // 1:1 translation of renderer.js renderProjectRenameModal(). Autofocus mirrors the legacy
  // bindEvents() block (skipped on the Svelte path).
  let { ctx, tick } = $props()

  const click = (attr) => (e) => ctx.actions.click(attr, e)

  let inputEl = $state(null)

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    const target = state.projectRenameTarget
    if (!target) return null
    return {
      name: target.name,
      draft: state.projectRenameDraft ?? "",
      renaming: Boolean(state.projectRenaming),
      error: state.projectRenameError || ""
    }
  })

  $effect(() => {
    if (d && ctx.state.projectRenameAutoFocus && inputEl) {
      inputEl.focus()
      inputEl.select()
      ctx.state.projectRenameAutoFocus = false
    }
  })
</script>

{#if d}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="update-backdrop" data-svelte-island data-action={d.renaming ? null : "cancelRenameProject"} onclick={click("data-action")}>
    <div class="confirm-modal rename-modal" role="dialog" aria-modal="true" aria-labelledby="renameProjectTitle" data-stop-click>
      <div class="confirm-title" id="renameProjectTitle">Rename project</div>
      <div class="rename-modal-body">
        <p>Current name: “{d.name}”</p>
        <label for="renameProjectInput">
          Project name
          <input
            id="renameProjectInput"
            type="text"
            value={d.draft}
            placeholder="Project name"
            data-project-rename-input
            disabled={d.renaming}
            bind:this={inputEl}
            oninput={(e) => ctx.actions.input("data-project-rename-input", e)}
            onkeydown={(e) => ctx.actions.renameKeydown(e)}
          >
        </label>
        <div class="field-error">{d.error}</div>
      </div>
      <div class="confirm-actions">
        <button class="secondary-btn{d.renaming ? ' disabled' : ''}" data-action="cancelRenameProject" onclick={click("data-action")}>Cancel</button>
        <button class="primary-btn{d.renaming ? ' disabled' : ''}" data-action="confirmRenameProject" onclick={click("data-action")}>Rename</button>
      </div>
    </div>
  </div>
{/if}
