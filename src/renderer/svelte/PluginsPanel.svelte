<script>
  let { ctx, tick } = $props()

  let plugins = $derived.by(() => {
    void $tick
    return Array.isArray(ctx.state.managedPlugins) ? ctx.state.managedPlugins : []
  })
</script>

<section class="tabpanel" data-panel="plugins" data-svelte-island>
  <div class="pnl-head">
    <div>
      <h1>Plugins</h1>
      <p>App-managed capabilities exposed directly to the model.</p>
    </div>
  </div>

  <div class="sec-lbl">Built-in<span class="sc">always on</span></div>
  <div class="mini-grid">
    {#each plugins as plugin (plugin.id)}
      <div class="mini" data-plugin-managed={plugin.id}>
        <span class="mini-ic bi">{@html ctx.icon("bolt")}</span>
        <span class="mini-tx">
          <span class="n">{plugin.name}</span>
          <span class="d">
            {plugin.description}{#if plugin.supportedFormats?.length} · {plugin.supportedFormats.join(", ")}{/if}
          </span>
        </span>
        <span class="mini-tag">Built-in</span>
      </div>
    {/each}
  </div>
</section>
