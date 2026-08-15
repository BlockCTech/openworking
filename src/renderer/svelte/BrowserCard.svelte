<script>
  let { ctx } = $props()
  const click = (attr) => (event) => ctx.actions.click(attr, event)
  let status = $derived(ctx.state.browserStatus || {})
  let supported = $derived(status.supported !== false)
  let hostOk = $derived(Boolean(status.hostInstalled))
</script>

<div class="browser-card">
  <div class="browser-top">
    <span class="row-ic">{@html ctx.icon("server")}</span>
    <span class="row-main">
      <span class="row-name"><span class="nm">Browser (Chrome)</span>
        {#if !supported}<span class="mcp-pill mcp-pill-type">Unavailable</span>{:else if hostOk}<span class="mcp-pill mcp-pill-ok">{@html ctx.icon("check")}Host installed</span>{:else}<span class="mcp-pill mcp-pill-type">Not set up</span>{/if}
      </span>
      <span class="row-desc" style="white-space:normal">Let the agent drive your logged-in Chrome tab. Page-changing actions are confirmed before they run.</span>
    </span>
    {#if supported}<span class="browser-actions"><button class="btn-up" data-action="openBrowserSetup" onclick={click("data-action")}>{@html ctx.icon("blocks")}<span>{hostOk ? "Manage extension" : "Set up extension"}</span></button></span>{/if}
  </div>
  {#if !supported}<div class="config-note">{status.reason || "Browser integration is not supported on this platform."}</div>
  {:else if status.chromeInstalled === false}<div class="config-note">Google Chrome (stable) was not found in /Applications. Install it to use this feature.</div>{/if}
  {#if ctx.state.browserError && !ctx.state.browserSetupOpen}<div class="mcp-card-error">{ctx.state.browserError}</div>{/if}
</div>
