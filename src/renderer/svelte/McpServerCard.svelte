<script>
  let { ctx, server } = $props()
  const click = (attr) => (event) => ctx.actions.click(attr, event)

  let d = $derived.by(() => {
    const { pill, action } = ctx.mcpStatusInfo(server)
    const state = ctx.state
    const error = state.mcpError && state.mcpErrorTarget === server.name
      ? state.mcpError
      : state.mcpStatusError?.[server.name] || ""
    return { pill, action, error, transport: server.type === "remote" ? "http" : "stdio" }
  })
</script>

<div class="row">
  <span class="row-ic">{@html ctx.icon("server")}</span>
  <span class="row-main">
    <span class="row-name"><span class="nm">{server.name}</span>{@html d.pill}</span>
    <span class="srv-sub"><span class="xport">{d.transport}</span><span class="srv-path">{ctx.mcpServerSubtitle(server)}</span></span>
  </span>
  <span class="row-meta">
    {#if d.action === "retry"}
      <button class="btn-ghost" data-action="retryMcp" data-mcp-name={server.name} onclick={click("data-action")}>{@html ctx.icon("arrowUp")}Retry</button>
    {:else if d.action}
      <button class="btn-ghost" data-action="authenticateMcp" data-mcp-name={server.name} onclick={click("data-action")}>{@html ctx.icon("arrowUp")}{d.action === "reconnect" ? "Reconnect" : "Authenticate"}</button>
    {/if}
    {#if d.action === "reconnect"}
      <button class="btn-ghost" data-action="clearMcpAuth" data-mcp-name={server.name} title="Clear stored credentials and authenticate again" onclick={click("data-action")}>{@html ctx.icon("trash")}Reset auth</button>
    {/if}
    <button class="btn-ghost" data-action="editMcp" data-mcp-name={server.name} onclick={click("data-action")}>{@html ctx.icon("edit")}Edit</button>
    <span class="scope">{server.type === "remote" ? "Remote" : "Local"}</span>
    <button class:on={server.enabled} class="tgl" role="switch" aria-checked={server.enabled ? "true" : "false"} data-mcp-toggle={server.name} data-mcp-enabled={server.enabled ? "1" : "0"} title={server.enabled ? "Disable" : "Enable"} onclick={click("data-mcp-toggle")}><span class="knob"></span></button>
    <button class="icon-del" data-action="removeMcp" data-mcp-name={server.name} aria-label={`Remove ${server.name}`} title="Remove" onclick={click("data-action")}>{@html ctx.icon("trash")}</button>
  </span>
  {#if d.error}<div class="mcp-card-error">{d.error}</div>{/if}
</div>
