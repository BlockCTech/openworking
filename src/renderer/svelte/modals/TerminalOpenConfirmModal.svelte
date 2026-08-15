<script>
  // The renderer-side confirm step opening a shell goes through (see the PTY goal's M2 decision
  // note: the server's permission.asked/reply mechanism is tied to an active chat session's tool
  // call and has no entry point for a session-less action like this).
  let { ctx, tick } = $props()

  const click = (attr) => (e) => ctx.actions.click(attr, e)

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    if (!state.terminalConfirmOpen) return null
    return { projectName: ctx.selectedProject()?.name || "this project" }
  })
</script>

{#if d}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="update-backdrop" data-svelte-island data-action="closeTerminalConfirm" onclick={click("data-action")}>
    <div class="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="terminalConfirmTitle" data-stop-click>
      <div class="confirm-title" id="terminalConfirmTitle">Open a terminal?</div>
      <p>This opens a shell with access to “{d.projectName}”. Anything you type runs on your machine, the same as opening Terminal yourself.</p>
      <div class="confirm-actions">
        <button class="secondary-btn" data-action="closeTerminalConfirm" onclick={click("data-action")}>Cancel</button>
        <button class="primary-btn" data-action="confirmOpenTerminal" onclick={click("data-action")}>Open Terminal</button>
      </div>
    </div>
  </div>
{/if}
