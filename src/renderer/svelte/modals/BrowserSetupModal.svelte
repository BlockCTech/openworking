<script>
  let { ctx } = $props()
  const click = (attr) => (event) => ctx.actions.click(attr, event)
  let d = $derived.by(() => {
    const state = ctx.state
    const status = state.browserStatus || {}
    return {
      open: state.browserSetupOpen,
      status,
      hostOk: Boolean(status.hostInstalled),
      chromeMissing: status.chromeInstalled === false,
      downloading: state.browserDownloading,
      release: state.browserRelease,
      releaseLoading: state.browserReleaseLoading,
      busy: state.browserBusy,
      error: state.browserError || ""
    }
  })
</script>

{#if d.open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="update-backdrop" data-action={d.downloading ? undefined : "closeBrowserSetup"} onclick={click("data-action")}>
    <div class="skill-upload-modal" role="dialog" aria-modal="true" aria-labelledby="browserSetupTitle" data-stop-click>
      <div class="skill-upload-head">
        <h1 id="browserSetupTitle">Set up Browser (Chrome)</h1>
        <button class="small-icon-btn" data-action="closeBrowserSetup" aria-label="Close setup dialog" disabled={d.downloading} onclick={click("data-action")}>{@html ctx.icon("x")}</button>
      </div>
      <p class="browser-setup-intro">Install the OpenWorking browser extension so the agent can drive your logged-in Chrome tab. Page-changing actions are always confirmed before they run.</p>
      <div class="browser-setup-status">
        {#if d.chromeMissing}<span class="mcp-pill mcp-pill-type">Chrome not found</span>{:else}<span class="mcp-pill mcp-pill-ok">{@html ctx.icon("check")}Chrome found</span>{/if}
        {#if d.hostOk}<span class="mcp-pill mcp-pill-ok">{@html ctx.icon("check")}Host installed</span>{:else}<span class="mcp-pill mcp-pill-type">Host not installed</span>{/if}
      </div>
      {#if d.chromeMissing}<div class="alert">Google Chrome (stable) was not found in <code>/Applications</code>. Install it first.</div>{/if}
      <ol class="browser-setup-steps">
        <li>
          <div class="bss-title">Download the extension</div>
          {#if d.release?.downloadUrl}
            <button class="btn-primary" data-action="downloadBrowserExtension" disabled={d.downloading} onclick={click("data-action")}>{@html ctx.icon("arrowUp")}<span>{d.downloading ? "Downloading…" : `Download extension${d.release.version ? ` v${d.release.version}` : ""}`}</span></button>
            <p class="browser-setup-hint">Saved to your Downloads folder and revealed in Finder.</p>
          {:else}
            <button class="btn-ghost" data-action="openBrowserExtension" onclick={click("data-action")}>{@html ctx.icon("folder")}<span>Open bundled folder</span></button>
            <p class="browser-setup-hint">{d.releaseLoading ? "Checking for a download link…" : "Download link unavailable — use the bundled extension folder instead."}</p>
          {/if}
        </li>
        <li><div class="bss-title">Unzip the download</div><p>Double-click the downloaded <code>.zip</code> to unpack it into a folder.</p></li>
        <li><div class="bss-title">Load it into Chrome</div><p>Open <code>chrome://extensions</code>, turn on <strong>Developer mode</strong> (top right), click <strong>Load unpacked</strong>, and select the unzipped folder.</p></li>
        <li>
          <div class="bss-title">Install the native host</div>
          <button class="btn-ghost" data-action="installBrowserHost" disabled={d.busy} onclick={click("data-action")}>{@html ctx.icon("arrowUp")}<span>{d.busy ? "Installing…" : d.hostOk ? "Reinstall host" : "Install host"}</span></button>
          <p class="browser-setup-hint">Lets Chrome talk to the app. Required for the browser tools to work.</p>
        </li>
        <li><div class="bss-title">Verify</div><p>In <code>chrome://extensions</code>, confirm the extension ID matches <code>{d.status.extensionId || "the bundled extension id"}</code>.</p></li>
      </ol>
      {#if d.error}<div class="alert">{d.error}</div>{/if}
    </div>
  </div>
{/if}
