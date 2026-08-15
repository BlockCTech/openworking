<script>
  // Base Skills tab rendered by the shared Svelte router. 1:1 translation of renderer.js
  // renderSkillsPanel(): two tiers only — user-uploaded custom skills and the bundled built-ins.
  // The search box and the All/Installed/Built-in filters are DOM passes (filterSkillsDom), not
  // reactive derivations, so the input keeps focus and caret across repaints; the $effect below
  // re-applies the active query/filter after every tick that rebuilds these rows.
  import SkillRow from "./SkillRow.svelte"

  let { ctx, tick } = $props()

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    const builtIn = ctx.builtInSkills.map((skill) => ({ ...skill, builtIn: true }))
    const custom = state.customSkills.map((skill) => ({ ...skill, builtIn: false }))
    const filter = ["installed", "builtin"].includes(state.skillsFilter) ? state.skillsFilter : "all"
    return { builtIn, custom, filter, query: state.skillsQuery || "" }
  })

  $effect(() => {
    void d
    ctx.filterSkillsDom?.()
  })
</script>

<section class="tabpanel" data-panel="skills" data-svelte-island>
  <div class="pnl-head">
    <div>
      <h1>Skills</h1>
      <p>Reusable instructions the agent invokes automatically. Click any skill to preview its SKILL.md.</p>
    </div>
    <button class="btn-up" data-action="openSkillUpload" onclick={(e) => ctx.actions.click("data-action", e)}>{@html ctx.icon("arrowUp")}<span>Upload skill</span></button>
  </div>

  <div class="toolbar">
    <label class="searchbox">
      {@html ctx.icon("search")}
      <input type="text" placeholder="Search skills…" value={d.query} data-skills-search oninput={(e) => ctx.actions.input("data-skills-search", e)}>
    </label>
    <div class="filters" role="tablist">
      <button class="filter {d.filter === 'all' ? 'active' : ''}" data-skills-filter="all" onclick={(e) => ctx.actions.click("data-skills-filter", e)}>All <span class="fc">{d.builtIn.length + d.custom.length}</span></button>
      <button class="filter {d.filter === 'installed' ? 'active' : ''}" data-skills-filter="installed" onclick={(e) => ctx.actions.click("data-skills-filter", e)}>Installed <span class="fc">{d.custom.length}</span></button>
      <button class="filter {d.filter === 'builtin' ? 'active' : ''}" data-skills-filter="builtin" onclick={(e) => ctx.actions.click("data-skills-filter", e)}>Built-in <span class="fc">{d.builtIn.length}</span></button>
    </div>
  </div>

  <div class="grp {d.filter === 'builtin' ? 'hidden' : ''}" data-group="installed">
    <div class="grp-lbl">Installed<span class="gc">Custom · removable</span></div>
    {#if d.custom.length}
      <div class="card">
        {#each d.custom as skill (skill.name)}
          <SkillRow {ctx} {skill} />
        {/each}
      </div>
    {:else}
      <div class="config-note">No custom skills installed yet. Use "Upload skill" to add one.</div>
    {/if}
  </div>

  <div class="grp {d.filter === 'installed' ? 'hidden' : ''}" data-group="builtin">
    <div class="grp-lbl">Built-in<span class="gc">{d.builtIn.length}</span></div>
    <div class="card">
      {#each d.builtIn as skill (skill.name)}
        <SkillRow {ctx} {skill} />
      {/each}
    </div>
  </div>

  <div class="empty" id="skill-empty">
    {@html ctx.icon("search")}
    <div class="e1">No skills found</div>
    <div class="e2">Try a different search term.</div>
  </div>
</section>
