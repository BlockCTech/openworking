<script>
  // 1:1 translation of renderer.js renderMcpModal() + renderMcpOauthSection(). state.mcpDraft is
  // intentionally NOT state-bridged (it is submitted over IPC), so structural edits re-derive via
  // the paint tick that every mutating handler's render() call produces; text inputs mutate the
  // draft through the shared handlers without re-rendering, which keeps the caret in place.
  let { ctx, tick } = $props()

  const click = (attr) => (e) => ctx.actions.click(attr, e)
  const input = (attr) => (e) => ctx.actions.input(attr, e)

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    const draft = state.mcpDraft
    if (!state.mcpModalOpen || !draft) return null
    const mode = draft.oauthMode || "auto"
    return {
      draft,
      editing: Boolean(state.mcpEditTarget),
      saving: Boolean(state.mcpSaving),
      isRemote: draft.type !== "local",
      headers: Array.isArray(draft.headers) ? draft.headers : [],
      env: Array.isArray(draft.env) ? draft.env : [],
      error: state.mcpError && state.mcpModalOpen ? state.mcpError : "",
      oauth: {
        mode,
        advanced: Boolean(draft.oauthAdvancedOpen),
        secretPlaceholder: draft.hasStoredSecret ? "•••• (stored — leave blank to keep)" : "Paste the OAuth client secret",
        hint: mode === "auto" ? "The server registers a client automatically (works for most MCP servers). You'll sign in after adding."
          : mode === "custom" ? "Use this for servers that need a pre-registered OAuth app, such as Slack MCP."
          : "No OAuth — the server is reached directly (or via custom headers)."
      }
    }
  })
</script>

{#if d}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="update-backdrop" data-svelte-island data-action={d.saving ? null : "closeMcpModal"} onclick={click("data-action")}>
    <div class="confirm-modal rename-modal mcp-modal" role="dialog" aria-modal="true" aria-labelledby="mcpModalTitle" data-stop-click>
      <div class="confirm-title" id="mcpModalTitle">{d.editing ? "Edit App" : "Add Custom App"}</div>
      <p>Connect a custom MCP server by URL or local command.</p>
      <div class="rename-modal-body">
        <label for="mcpName">
          App name
          <input id="mcpName" type="text" value={d.draft.name} placeholder="sentry-mcp" data-mcp-field="name" disabled={d.editing || d.saving} oninput={input("data-mcp-field")}>
        </label>
        <div class="mcp-field-label">Type</div>
        <div class="mcp-type-toggle">
          <button class="mcp-type-opt {d.isRemote ? 'active' : ''}" data-mcp-type="remote" disabled={d.saving} onclick={click("data-mcp-type")}>Remote (URL)</button>
          <button class="mcp-type-opt {d.isRemote ? '' : 'active'}" data-mcp-type="local" disabled={d.saving} onclick={click("data-mcp-type")}>Local (command)</button>
        </div>
        {#if d.isRemote}
          <label for="mcpUrl">
            Server URL
            <input id="mcpUrl" type="text" value={d.draft.url} placeholder="https://mcp.sentry.dev/mcp" data-mcp-field="url" disabled={d.saving} oninput={input("data-mcp-field")}>
          </label>
          <div class="mcp-field-label">Authentication</div>
          <div class="mcp-type-toggle">
            <button class="mcp-type-opt {d.oauth.mode === 'auto' ? 'active' : ''}" data-mcp-oauth-mode="auto" disabled={d.saving} onclick={click("data-mcp-oauth-mode")}>Auto</button>
            <button class="mcp-type-opt {d.oauth.mode === 'custom' ? 'active' : ''}" data-mcp-oauth-mode="custom" disabled={d.saving} onclick={click("data-mcp-oauth-mode")}>OAuth app</button>
            <button class="mcp-type-opt {d.oauth.mode === 'disabled' ? 'active' : ''}" data-mcp-oauth-mode="disabled" disabled={d.saving} onclick={click("data-mcp-oauth-mode")}>None</button>
          </div>
          <div class="config-note mcp-oauth-hint">{d.oauth.hint}</div>
          {#if d.oauth.mode === "custom"}
            <button class="mcp-advanced-toggle" data-action="toggleMcpAdvanced" disabled={d.saving} onclick={click("data-action")}>{@html ctx.icon(d.oauth.advanced ? "chevDown" : "chevRight")}Advanced OAuth</button>
            {#if d.oauth.advanced}
              <div class="mcp-advanced">
                <label for="mcpOauthClientId">OAuth client ID
                  <input id="mcpOauthClientId" type="text" value={d.draft.oauthClientId || ""} placeholder="Paste the OAuth client ID" data-mcp-field="oauthClientId" disabled={d.saving} oninput={input("data-mcp-field")}>
                </label>
                <label for="mcpOauthClientSecret">OAuth client secret
                  <input id="mcpOauthClientSecret" type="password" value={d.draft.oauthClientSecret || ""} placeholder={d.oauth.secretPlaceholder} data-mcp-field="oauthClientSecret" autocomplete="off" disabled={d.saving} oninput={input("data-mcp-field")}>
                </label>
                <label for="mcpOauthScope">OAuth scopes
                  <input id="mcpOauthScope" type="text" value={d.draft.oauthScope || ""} placeholder="Optional, space-separated scopes" data-mcp-field="oauthScope" disabled={d.saving} oninput={input("data-mcp-field")}>
                </label>
                <div class="mcp-warning">Keep client secrets out of chats and source control. Store only credentials issued for this app.</div>
                {#if d.draft.presetDocsUrl}
                  <button class="link-btn" data-action="openMcpDocs" data-docs-url={d.draft.presetDocsUrl} onclick={click("data-action")}>{@html ctx.icon("book")}Where do I get these?</button>
                {/if}
              </div>
            {/if}
          {/if}
          <div class="mcp-headers">
            <div class="mcp-field-label">Custom headers</div>
            {#each d.headers as header, index}
              <div class="mcp-headers-row">
                <input type="text" value={header.key} placeholder="Header" data-mcp-header="key" data-mcp-header-index={index} disabled={d.saving} oninput={input("data-mcp-header")}>
                <input type="text" value={header.value} placeholder="Value" data-mcp-header="value" data-mcp-header-index={index} disabled={d.saving} oninput={input("data-mcp-header")}>
                <button class="small-icon-btn" data-action="removeMcpHeader" data-mcp-header-index={index} aria-label="Remove header" disabled={d.saving} onclick={click("data-action")}>{@html ctx.icon("x")}</button>
              </div>
            {/each}
            <button class="link-btn" data-action="addMcpHeader" disabled={d.saving} onclick={click("data-action")}>{@html ctx.icon("plus")}Add header</button>
          </div>
        {:else}
          <label for="mcpCommand">
            Command
            <input id="mcpCommand" type="text" value={d.draft.command} placeholder="npx -y some-mcp-server" data-mcp-field="command" disabled={d.saving} oninput={input("data-mcp-field")}>
          </label>
          <div class="mcp-headers">
            <div class="mcp-field-label">Environment variables</div>
            {#each d.env as row, index}
              <div class="mcp-headers-row">
                <input type="text" value={row.key} placeholder="KEY" data-mcp-env="key" data-mcp-env-index={index} disabled={d.saving} oninput={input("data-mcp-env")}>
                <input type="text" value={row.value} placeholder="Value" data-mcp-env="value" data-mcp-env-index={index} disabled={d.saving} oninput={input("data-mcp-env")}>
                <button class="small-icon-btn" data-action="removeMcpEnv" data-mcp-env-index={index} aria-label="Remove variable" disabled={d.saving} onclick={click("data-action")}>{@html ctx.icon("x")}</button>
              </div>
            {/each}
            <button class="link-btn" data-action="addMcpEnv" disabled={d.saving} onclick={click("data-action")}>{@html ctx.icon("plus")}Add variable</button>
          </div>
        {/if}
        <div class="field-error">{d.error}</div>
      </div>
      <div class="confirm-actions">
        <button class="secondary-btn{d.saving ? ' disabled' : ''}" data-action="closeMcpModal" onclick={click("data-action")}>Cancel</button>
        <button class="primary-btn{d.saving ? ' disabled' : ''}" data-action="submitMcpServer" onclick={click("data-action")}>{@html ctx.icon(d.editing ? "save" : "plus")}{d.saving ? "Saving…" : (d.editing ? "Save changes" : "Add App")}</button>
      </div>
    </div>
  </div>
{/if}
