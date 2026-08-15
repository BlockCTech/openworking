<script>
  let { ctx, tick } = $props()
  const click = (attr) => (event) => ctx.actions.click(attr, event)

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    return {
      open: state.permissionsModalOpen,
      loading: state.permissionsLoading,
      error: state.permissionsError || "",
      removing: state.permissionsRemoving,
      list: state.permissionsList || []
    }
  })
</script>

{#if d.open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="update-backdrop" data-action="closePermissionsModal" onclick={click("data-action")}>
    <div class="skill-upload-modal" role="dialog" aria-modal="true" aria-labelledby="permissionsTitle" data-stop-click>
      <div class="skill-upload-head">
        <h1 id="permissionsTitle">Saved permissions</h1>
        <button class="small-icon-btn" data-action="closePermissionsModal" aria-label="Close" onclick={click("data-action")}>{@html ctx.icon("x")}</button>
      </div>
      <p class="browser-setup-intro">"Allow always" decisions the agent has been given. Revoking one asks again next time.</p>
      {#if d.loading}
        <div class="config-note">Loading…</div>
      {:else if d.error}
        <div class="alert">{d.error}</div>
      {:else if !d.list.length}
        <div class="config-note">No saved permissions yet.</div>
      {:else}
        <div class="permissions-list">
          {#each d.list as entry (entry.id)}
            <div class="permission-row">
              <div class="permission-row-main">
                <div class="permission-row-action">{entry.action}</div>
                <div class="permission-row-resource">{entry.resource}</div>
              </div>
              <button
                class="secondary-btn danger-btn{d.removing === entry.id ? ' disabled' : ''}"
                data-action="revokeSavedPermission"
                data-permission-id={entry.id}
                disabled={d.removing === entry.id}
                onclick={click("data-action")}
              >{d.removing === entry.id ? "Revoking…" : "Revoke"}</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
