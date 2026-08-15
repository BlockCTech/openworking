<script>
  let { ctx, project } = $props()

  const click = (attr) => (event) => ctx.actions.click(attr, event)
  let hue = $derived(ctx.projectHue(project.id))
  let opened = $derived(project.lastOpenedAt ? `Opened ${ctx.relativeTime(project.lastOpenedAt)}` : "Local folder")
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class:pcard={true}
  class:pinned={project.pinned}
  class:sel={project.id === ctx.state.activeProjectId}
  data-open-project={project.id}
  data-name={project.name.toLowerCase()}
  title={project.path}
  onclick={click("data-open-project")}
>
  <div class="pin-badge">{@html ctx.icon("pin")}</div>
  <div class="pcard-top">
    <div class="mono" style={`background:linear-gradient(150deg, oklch(0.62 0.14 ${hue}), oklch(0.5 0.15 ${(hue + 16) % 360}));`}>{ctx.projectInitials(project.name)}</div>
    <div class="pcard-title">
      <div class="nm" title={project.name}>{project.name}</div>
      <div class="sub"><span class="dot"></span>Local folder</div>
    </div>
  </div>
  <div class="pcard-foot">
    <span class="pcard-meta">{opened}</span>
    <div class="pcard-actions">
      <button class="pact" data-project-memory={project.id} data-stop-click title={`Open memory for ${project.name}`} aria-label={`Open memory for ${project.name}`} onclick={click("data-project-memory")}>{@html ctx.icon("brain")}</button>
      <button class:on={project.pinned} class="pact" data-project-pin={project.id} data-pinned={project.pinned ? "1" : "0"} data-stop-click title={project.pinned ? "Unpin" : "Pin"} aria-label={project.pinned ? "Unpin" : "Pin"} onclick={click("data-project-pin")}>{@html ctx.icon("pin")}</button>
      <button class="pact" data-rename-project={project.id} data-project-name={project.name} data-stop-click title="Rename" aria-label="Rename" onclick={click("data-rename-project")}>{@html ctx.icon("edit")}</button>
      <button class="pact danger" data-remove-project={project.id} data-project-name={project.name} data-stop-click title="Remove" aria-label="Remove" onclick={click("data-remove-project")}>{@html ctx.icon("trash")}</button>
    </div>
  </div>
</div>
