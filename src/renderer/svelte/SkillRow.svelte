<script>
  // 1:1 translation of renderer.js renderSkillRow(). Custom skills get the accent icon +
  // "Active" tag; built-ins get a "Built-in" tag + a chevron affordance. data-name carries the
  // searchable text filterSkillsDom() matches against, and the .row class is the hook it toggles.
  let { ctx, skill } = $props()

  let builtin = $derived(Boolean(skill.builtIn))
  let desc = $derived(skill.description || skill.path || "")
  let haystack = $derived(`${skill.name} ${desc}`.toLowerCase())
</script>

<button
  class="row {builtin ? '' : 'custom'}"
  data-skill-open={skill.name}
  data-skill-builtin={builtin ? "1" : "0"}
  data-name={haystack}
  onclick={(e) => ctx.actions.click("data-skill-open", e)}
>
  <span class="row-ic">{@html ctx.skillIcon(skill.name)}</span>
  <span class="row-main">
    <span class="row-name">
      <span class="nm">{skill.name}</span>
      {#if !builtin}<span class="tag on"><span class="dt"></span>Active</span>{/if}
    </span>
    <span class="row-desc">{desc}</span>
  </span>
  <span class="row-meta">
    {#if builtin}
      <span class="tag">Built-in</span><span class="row-act">{@html ctx.icon("chevRight")}</span>
    {:else}
      <span class="row-act">{@html ctx.icon("dots")}</span>
    {/if}
  </span>
</button>
