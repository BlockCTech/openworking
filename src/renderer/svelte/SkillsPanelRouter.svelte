<script>
  import SkillsPanel from "./SkillsPanel.svelte"
  import PluginsPanel from "./PluginsPanel.svelte"
  import ExtensionsPanel from "./ExtensionsPanel.svelte"
  import MemoryPanel from "./MemoryPanel.svelte"
  import ReferencesPanel from "./ReferencesPanel.svelte"

  let { ctx, tick } = $props()
  let tab = $derived(["plugins", "mcp", "memory", "references"].includes(ctx.state.skillsTab) ? ctx.state.skillsTab : "skills")
</script>

{#if tab === "plugins"}
  <PluginsPanel {ctx} {tick} />
{:else if tab === "mcp"}
  <ExtensionsPanel {ctx} {tick} />
{:else if tab === "memory"}
  <MemoryPanel {ctx} {tick} />
{:else if tab === "references"}
  <ReferencesPanel {ctx} {tick} />
{:else}
  <SkillsPanel {ctx} {tick} />
{/if}
