<script>
  import ProjectCard from "./ProjectCard.svelte"

  let { ctx, tick } = $props()
  const click = (attr) => (event) => ctx.actions.click(attr, event)
  const input = (attr) => (event) => ctx.actions.input(attr, event)

  let d = $derived.by(() => {
    void $tick
    const query = (ctx.state.projectsQuery || "").trim().toLowerCase()
    const projects = ctx.sortProjectsByPin(ctx.state.projects)
    return {
      count: ctx.state.projects.length,
      projects: query
        ? projects.filter((project) => `${project.name} ${project.path}`.toLowerCase().includes(query))
        : projects,
      query
    }
  })
</script>

<main class="main" data-svelte-island>
  <div class="main-head">
    <button class="head-icon-btn head-sidebar-btn" data-action="toggleSidebar" title="Show sidebar" aria-label="Show sidebar" onclick={click("data-action")}>{@html ctx.icon("sidebarToggle")}</button>
    <div class="head-copy"><div class="head-title" title="Projects">Projects</div></div>
    <div class="head-actions"></div>
  </div>
  {#if ctx.state.diagnosticsOpen}{@html ctx.renderDiagnostics()}{/if}
  <div class="pj-scroll">
    <div class="pj-wrap">
      <div class="pj-head">
        <div><h1>Local projects</h1><p>Folder entries stay on this machine.</p></div>
        <div class="spacer"></div>
        <label class="pj-search">
          {@html ctx.icon("search")}
          <input type="text" placeholder="Search projects" value={ctx.state.projectsQuery || ""} data-projects-search aria-label="Search projects" oninput={input("data-projects-search")} />
        </label>
        <button class="btn-add" data-action="addProject" onclick={click("data-action")}>{@html ctx.icon("plus")}<span>Add</span></button>
      </div>
      <div class="pj-grouplabel"><span class="gl">On this machine</span><span class="gc">{d.count}</span><span class="line"></span></div>
      <div class="pj-grid" id="pj-grid">
        {#each d.projects as project (project.id)}
          <ProjectCard {ctx} {project} />
        {/each}
        <button class="pcard-add" data-action="addProject" onclick={click("data-action")}>
          <div class="ico">{@html ctx.icon("folderPlus")}</div><span class="lbl">Add project</span>
        </button>
      </div>
      {#if d.query && !d.projects.length}<div id="pj-empty" class="admin-empty">No projects match your search.</div>{/if}
    </div>
  </div>
</main>
