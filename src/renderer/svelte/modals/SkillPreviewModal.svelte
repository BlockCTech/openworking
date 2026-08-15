<script>
  let { ctx } = $props()
  const click = (attr) => (event) => ctx.actions.click(attr, event)

  let d = $derived.by(() => {
    const state = ctx.state
    const preview = state.skillPreview
    if (!preview) return null
    const builtin = Boolean(preview.builtIn)
    return {
      preview,
      builtin,
      subtitle: builtin ? "Built-in skill" : "Custom skill",
      loading: state.skillPreviewLoading,
      error: state.skillPreviewError || "",
      html: ctx.renderMarkdown(ctx.stripSkillFrontmatter(state.skillPreviewContent)),
      busy: state.skillUninstalling
    }
  })

  $effect(() => {
    if (!d || d.loading || d.error) return
    void d.html
    queueMicrotask(() => ctx.scheduleMermaidRender(document.querySelector(".skill-preview-body")))
  })
</script>

{#if d}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="update-backdrop" data-action={d.busy ? undefined : "closeSkillPreview"} onclick={click("data-action")}>
    <div class="skill-preview-modal" role="dialog" aria-modal="true" aria-labelledby="skillPreviewTitle" data-stop-click>
      <div class="skill-preview-head">
        <div class="sph-title"><span class="sli-icon">{@html ctx.icon("sparkle")}</span><div><h1 id="skillPreviewTitle">{d.preview.name}</h1><small>{d.subtitle}</small></div></div>
        <button class="small-icon-btn" data-action="closeSkillPreview" aria-label="Close preview" disabled={d.busy} onclick={click("data-action")}>{@html ctx.icon("x")}</button>
      </div>
      <div class="skill-preview-body">
        {#if d.loading}<div class="skill-preview-state">Loading SKILL.md...</div>
        {:else if d.error}<div class="skill-preview-state error">{d.error}</div>
        {:else}<div class="skill-preview-md assistant-text">{@html d.html}</div>{/if}
      </div>
      <div class="skill-preview-foot">
        <button class:disabled={d.busy} class="danger-btn" data-action="uninstallSkill" data-skill-name={d.preview.name} disabled={d.builtin || d.busy} onclick={click("data-action")}>{@html ctx.icon("trash")}<span>{d.busy ? "Uninstalling..." : "Uninstall"}</span></button>
      </div>
    </div>
  </div>
{/if}
