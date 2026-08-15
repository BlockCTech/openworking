<script>
  import BrowserCard from "./BrowserCard.svelte"
  import McpServerCard from "./McpServerCard.svelte"

  let { ctx, tick } = $props()
  const click = (attr) => (event) => ctx.actions.click(attr, event)
  let servers = $derived.by(() => { void $tick; return ctx.state.mcpServers || [] })
</script>

<section class="tabpanel" data-panel="extensions" data-svelte-island>
  <div class="pnl-head">
    <div><h1>Extensions</h1><p>MCP servers that give the agent extra tools. Browse the directory to connect apps.</p></div>
    <div class="grow"></div>
    <button class="btn-up" data-action="openPermissionsModal" onclick={click("data-action")}>{@html ctx.icon("gear")}<span>Permissions</span></button>
    <button class="btn-up" data-action="openMcpModal" onclick={click("data-action")}>{@html ctx.icon("plus")}<span>Add custom app</span></button>
    <button class="btn-primary" data-action="openConnectorDirectory" onclick={click("data-action")}>{@html ctx.icon("search")}<span>Browse directory</span></button>
  </div>
  <div class="sec-lbl">Connected<span class="sc">{servers.length} server{servers.length === 1 ? "" : "s"}</span></div>
  {#if servers.length}
    <div class="card">{#each servers as server (server.name)}<McpServerCard {ctx} {server} />{/each}</div>
  {:else}
    <div class="config-note">No apps connected yet. Browse the directory or click "Add custom app".</div>
  {/if}
  <div class="sec-lbl" style="margin-top:34px">Browser control</div>
  <BrowserCard {ctx} />
  {#if ctx.state.mcpError && !ctx.state.mcpErrorTarget && !ctx.state.mcpModalOpen}<div class="config-note field-error">{ctx.state.mcpError}</div>{/if}
</section>
