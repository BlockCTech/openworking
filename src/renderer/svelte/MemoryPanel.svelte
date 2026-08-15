<script>
  let { ctx, tick } = $props()
  const click = (attr) => (event) => ctx.actions.click(attr, event)
  const input = (attr) => (event) => ctx.actions.input(attr, event)

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    return {
      loading: state.memoryLoading && !state.memory,
      draft: state.memoryDraft || { global: "", project: "" },
      project: ctx.selectedMemoryProject(),
      error: state.memoryError || "",
      saving: state.memorySaving
    }
  })
</script>

{#snippet card(scope, title, subtitle, file, value, disabled)}
  <div class="mem-card">
    <div class="mem-head">
      <div><h2>{title}{#if scope === "project"}<span class="mem-proj"><span class="mem-select"><select data-memory-project disabled={Boolean(d.saving)} oninput={input("data-memory-project")}>{#if ctx.state.projects.length}{#each ctx.state.projects as project (project.id)}<option value={project.id} selected={project.id === d.project?.id}>{project.name}</option>{/each}{:else}<option value="">No saved projects</option>{/if}</select></span></span>{/if}</h2><p>{subtitle}</p></div>
      <button class="mem-save" data-memory-save={scope} disabled={disabled || Boolean(d.saving)} onclick={click("data-memory-save")}>{d.saving === scope ? "Saving…" : "Save"}</button>
    </div>
    <div class:dirty={ctx.isMemoryScopeDirty(scope)} class="editor">
      <div class="editor-bar"><span class="ef">{file}</span><span class="ed"></span></div>
      <textarea data-memory-field={scope} spellcheck="false" disabled={disabled || d.saving === scope} placeholder={disabled ? "Open a project to edit its memory." : "Add a fact the assistant should always remember…"} value={value || ""} oninput={input("data-memory-field")}></textarea>
    </div>
  </div>
{/snippet}

<section class="tabpanel" data-panel="memory" data-svelte-island>
  {#if d.loading}
    <div class="config-note">Loading memory…</div>
  {:else}
    {#if d.error}<div class="config-note field-error">{d.error}</div>{/if}
    {@render card("global", "Global memory", "Facts the assistant recalls in every chat across all projects.", "memory.md", d.draft.global, false)}
    {@render card("project", "Project memory", d.project ? "Facts the assistant recalls only when this project is the active chat project. Choosing here does not switch the active project." : "Choose a saved project to review or edit its memory. This selector does not switch the active project.", d.project ? `${d.project.name}/memory.md` : "memory.md", d.draft.project, !d.project)}
  {/if}
</section>
