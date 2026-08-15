<script>
  // Projects is Svelte-owned; renderMain() remains the markup source for settings, skills
  // shell, and session screen (header/composer/empty thread host). Events are served by the
  // host delegation in index.js. The thread and prompt-editor islands mount into hosts this
  // markup carries.
  let { ctx, tick } = $props()
  import ProjectsScreen from "./ProjectsScreen.svelte"

  let html = $derived.by(() => {
    void $tick
    return ctx.renderMain()
  })
</script>

{#if ctx.state.nav === "projects"}
  <ProjectsScreen {ctx} {tick} />
{:else}
  {@html html}
{/if}
