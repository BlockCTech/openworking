<script>
  let { ctx, tick } = $props()

  const click = (attr) => (event) => ctx.actions.click(attr, event)

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    const target = state.revertConfirmTarget
    if (!target) return null
    return {
      restoreDraft: Boolean(target.restoreDraft),
      isGitRepo: Boolean(target.isGitRepo),
      repeated: Boolean(target.repeated),
      attachmentCount: target.attachmentNames?.length || 0,
      submitting: Boolean(state.revertSubmitting),
      error: state.revertError || ""
    }
  })
</script>

{#if d}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="update-backdrop" data-svelte-island data-action={d.submitting ? null : "cancelSessionRevert"} onclick={click("data-action")}>
    <div class="confirm-modal revert-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="sessionRevertTitle" data-stop-click>
      <div class="confirm-title" id="sessionRevertTitle">{d.restoreDraft ? "Undo last prompt?" : "Revert to this message?"}</div>
      <p>
        {d.repeated
          ? "This moves the staged boundary to an earlier user message. One Redo restores the complete staged range."
          : "The selected user message and all later messages will be hidden until you keep the revert or Redo it."}
      </p>
      <p>Current project files may be overwritten with their earlier contents.</p>
      {#if d.isGitRepo}
        <p>Review the staged file summary and Git diff before continuing.</p>
      {:else}
        <p>This project is not a Git repository, so only conversation rollback is guaranteed.</p>
      {/if}
      <p class="revert-warning">Databases, processes, network resources, ignored files and changes outside this project are not restored.</p>
      {#if d.attachmentCount}
        <p>{d.attachmentCount} external attachment{d.attachmentCount === 1 ? "" : "s"} will not be reattached automatically.</p>
      {/if}
      <div class="field-error">{d.error}</div>
      <div class="confirm-actions">
        <button class="secondary-btn{d.submitting ? ' disabled' : ''}" data-action="cancelSessionRevert" onclick={click("data-action")}>Cancel</button>
        <button class="danger-btn{d.submitting ? ' disabled' : ''}" data-action="confirmSessionRevert" onclick={click("data-action")}>
          {d.submitting ? "Reverting..." : d.restoreDraft ? "Undo" : "Revert"}
        </button>
      </div>
    </div>
  </div>
{/if}
