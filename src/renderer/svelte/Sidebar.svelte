<script>
  // Markup keeps the original classes/data-* attributes so delegated listeners and Playwright
  // selectors keep working. The view-model is re-derived per tick; keyed each-blocks patch only
  // what changed, so DOM nodes (and scroll/focus) survive.
  import ProjectGroup from "./ProjectGroup.svelte"
  import SessionRow from "./SessionRow.svelte"

  let { ctx, tick } = $props()

  const UPDATE_RING_RADIUS = 9
  const UPDATE_RING_CIRCUMFERENCE = 2 * Math.PI * UPDATE_RING_RADIUS

  function sessionVm(project, session) {
    const state = ctx.state
    const projectId = project?.id || ""
    const rowKey = ctx.sessionRowKey(projectId, session.id)
    return {
      id: session.id,
      projectId,
      rowKey,
      active: projectId === state.activeProjectId && session.id === state.activeSessionId,
      busy: Boolean(ctx.sessionBusy(session.id)),
      title: ctx.sessionDisplayTitle(session),
      rawTitle: session.title || "",
      time: ctx.relativeTime(ctx.sessionUpdatedAt(session)),
      updatedAt: ctx.sessionUpdatedAt(session) || "",
      pinned: state.pinnedSessions.has(session.id),
      menuOpen: state.sessionMenu === rowKey
    }
  }

  function projectVm(project) {
    const state = ctx.state
    const sessions = ctx.projectSessions(project.id)
    const sessionLoad = ctx.projectSessionLoad(project.id)
    const rest = sessions.filter((session) => !state.pinnedSessions.has(session.id))
    const showAll = state.showAll.has(project.id)
    return {
      id: project.id,
      name: project.name,
      pinned: Boolean(project.pinned),
      open: state.expanded.has(project.id),
      active: project.id === state.activeProjectId,
      menuOpen: state.projectMenu === project.id,
      loadStatus: sessionLoad.status,
      restCount: rest.length,
      showAll,
      sessions: (showAll ? rest : rest.slice(0, 5)).map((session) => sessionVm(project, session))
    }
  }

  // Mirrors the legacy bindEvents() block that returns focus to the session kebab after the
  // rename modal closes. Runs here because the sidebar DOM is island-owned now.
  $effect(() => {
    const id = ctx.state.sessionRenameFocusId
    if (!id) return
    const trigger = [...document.querySelectorAll("[data-session-menu]")].find((element) => element.dataset.sessionMenu === id)
    trigger?.focus()
    ctx.state.sessionRenameFocusId = null
  })

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    const gate = state.versionGate
    const pinnedSessionRows = [...state.pinnedSessions.entries()]
      .filter(([sessionId]) => !state.subagentSessionIds.has(sessionId))
      .map(([sessionId, meta]) => {
      const live = (state.sessionsByProject[meta.projectId] || []).find((session) => session.id === sessionId)
      const session = live || { id: sessionId, title: meta.title, time: { updated: meta.updatedAt } }
      return sessionVm({ id: meta.projectId }, session)
      })
    return {
      collapsed: Boolean(state.sidebarCollapsed),
      nav: state.nav,
      canNewSession: Boolean(ctx.selectedProject()),
      updatePill: gate?.status === "soft"
        ? {
            title: gate.latestVersion ? `Version ${gate.latestVersion} available` : "Update available",
            label: state.updating ? ctx.updateButtonLabel() : "Update",
            disabled: Boolean(state.updating),
            progressPct: state.updating && state.installStatus === "downloading" && typeof state.downloadProgress === "number"
              ? Math.max(0, Math.min(100, state.downloadProgress))
              : null
          }
        : null,
      hasPinned: ctx.hasPinnedItems(),
      pinnedSessionRows,
      pinnedProjects: state.projects.filter((project) => project.pinned).map(projectVm),
      projects: state.projects.filter((project) => !project.pinned).map(projectVm),
      settingsActive: state.nav === "config"
    }
  })
</script>

<aside class="sidebar" data-svelte-island aria-hidden={d.collapsed ? "true" : null} inert={d.collapsed}>
  <div class="side-top">
    {#if d.updatePill}
      <button class="update-pill {d.updatePill.disabled ? 'disabled' : ''}" data-action="startUpdate" title={d.updatePill.title} onclick={(e) => ctx.actions.click("data-action", e)}>
        {#if d.updatePill.progressPct !== null}
          <svg class="update-pill-ring" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r={UPDATE_RING_RADIUS} fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3"></circle>
            <circle cx="12" cy="12" r={UPDATE_RING_RADIUS} fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-dasharray={UPDATE_RING_CIRCUMFERENCE} stroke-dashoffset={UPDATE_RING_CIRCUMFERENCE * (1 - d.updatePill.progressPct / 100)} transform="rotate(-90 12 12)"></circle>
          </svg>
        {/if}
        {d.updatePill.label}
      </button>
    {/if}
    <button class="side-collapse-btn" data-action="toggleSidebar" title="Collapse sidebar" onclick={(e) => ctx.actions.click("data-action", e)}>{@html ctx.icon("sidebarToggle")}</button>
  </div>
  <div class="side-brand">
    <span>OpenWorking</span>
  </div>
  <div class="side-scroll">
    <button class="nav-item new-session" data-action="newSession" disabled={!d.canNewSession} onclick={(e) => ctx.actions.click("data-action", e)}>
      {@html ctx.icon("edit")}<span>New chat</span>
    </button>
    <button class="nav-item {d.nav === 'projects' ? 'active' : ''}" data-nav="projects" onclick={(e) => ctx.actions.click("data-nav", e)}>
      {@html ctx.icon("folder")}<span>Projects</span>
    </button>
    <button class="nav-item {d.nav === 'skills' ? 'active' : ''}" data-nav="skills" onclick={(e) => ctx.actions.click("data-nav", e)}>
      {@html ctx.icon("blocks")}<span>Skills</span>
    </button>
    {#if d.hasPinned}
      <div class="side-label">
        <span class="sl-title">Pinned</span>
      </div>
      {#if d.pinnedSessionRows.length}
        <div class="pinned-list">
          {#each d.pinnedSessionRows as row (row.rowKey)}
            <SessionRow {ctx} {row} />
          {/each}
        </div>
      {/if}
      {#each d.pinnedProjects as group (group.id)}
        <ProjectGroup {ctx} {group} />
      {/each}
    {/if}
    <div class="side-label">
      <span class="sl-title">Projects</span>
      <div class="sl-actions">
        <button class="sl-act" title="Collapse all" data-action="collapseAll" onclick={(e) => ctx.actions.click("data-action", e)}>{@html ctx.icon("collapse")}</button>
        <button class="sl-act" title="Add project" data-action="addProject" onclick={(e) => ctx.actions.click("data-action", e)}>{@html ctx.icon("plus")}</button>
      </div>
    </div>
    {#each d.projects as group (group.id)}
      <ProjectGroup {ctx} {group} />
    {/each}
  </div>
  <!-- Overlay scrollbar for .side-scroll (native bar is hidden in CSS). Geometry and drag
       handling live in src/renderer/side-scrollbar.js, wired from bindEvents(). Sibling of
       .side-scroll so it can be absolutely positioned against .sidebar. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="side-scrollbar empty" data-svelte-island aria-hidden="true">
    <div class="side-scrollbar-thumb"></div>
  </div>
  <div class="side-foot">
    <button class="side-user {d.settingsActive ? 'active' : ''}" data-nav="config" onclick={(e) => ctx.actions.click("data-nav", e)}>
      <span class="su-av">OW</span>
      <span class="su-meta">
        <span class="su-name">OpenWorking</span>
        <span class="su-sub">Local</span>
      </span>
    </button>
  </div>
</aside>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="sidebar-resizer" data-svelte-island data-resizer data-tip-main="Click to collapse" data-tip-sub="Drag to resize" data-tip-key="&#8984;B" onmousedown={(e) => ctx.actions.mousedown("data-resizer", e)}></div>
