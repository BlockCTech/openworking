<script>
  // 1:1 translation of renderer.js renderForceUpdate().
  let { ctx, tick } = $props()

  let d = $derived.by(() => {
    void $tick
    const gate = ctx.state.versionGate
    if (gate?.status !== "force") return null
    return {
      version: gate.latestVersion ? ` ${gate.latestVersion}` : "",
      notes: gate.releaseNotes || "",
      updating: Boolean(ctx.state.updating),
      label: ctx.updateButtonLabel()
    }
  })
</script>

{#if d}
  <div class="update-backdrop" data-svelte-island>
    <div class="update-modal" role="dialog" aria-modal="true">
      <div class="update-title">Update required</div>
      <p>A new version{d.version} is required to keep using OpenWorking. Please update to continue.</p>
      {#if d.notes}<p class="update-notes">{d.notes}</p>{/if}
      <button class="primary-btn {d.updating ? 'disabled' : ''}" data-action="startUpdate" onclick={(e) => ctx.actions.click("data-action", e)}>{d.label}</button>
    </div>
  </div>
{/if}
