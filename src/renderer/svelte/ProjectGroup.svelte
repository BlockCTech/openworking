<script>
  // Presentational: the parent Sidebar re-derives `group` per tick, so this component just
  // renders the given view-model. Events dispatch via ctx.actions into the delegated handlers.
  import SessionRow from "./SessionRow.svelte"
  import { slide } from "svelte/transition"

  let { ctx, group } = $props()

  const click = (attr) => (e) => ctx.actions.click(attr, e)
  const sessionSlideDuration = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? 0
    : 160
</script>

<div class="proj-group">
  <div class="proj-head-wrap">
    <button class="proj-head {group.open ? 'open' : ''} {group.active ? 'active-proj' : ''}" data-toggle-project={group.id} aria-expanded={group.open} onclick={click("data-toggle-project")}>
      <span class="fic" data-folder-state={group.open ? "open" : "closed"}>{@html ctx.icon(group.open ? "folderOpen" : "folder")}</span>
      <span class="pname">{group.name}</span>
    </button>
    <button type="button" class="padd" title="New session" data-new-session={group.id} onclick={click("data-new-session")}>{@html ctx.icon("plus")}</button>
    <button class="proj-kebab" data-project-menu={group.id} title="Options" onclick={click("data-project-menu")}>{@html ctx.icon("dots")}</button>
    {#if group.menuOpen}
      <div class="pop project-pop">
        <button class="pop-item" data-project-pin={group.id} data-pinned={group.pinned ? "1" : "0"} onclick={click("data-project-pin")}>
          {@html ctx.icon("pin")}<span>{group.pinned ? "Unpin project" : "Pin project"}</span>
        </button>
        <button class="pop-item" data-project-rename={group.id} data-project-name={group.name} onclick={click("data-project-rename")}>
          {@html ctx.icon("edit")}<span>Rename</span>
        </button>
        <button class="pop-item danger" data-project-delete={group.id} data-project-name={group.name} onclick={click("data-project-delete")}>
          {@html ctx.icon("trash")}<span>Remove</span>
        </button>
      </div>
    {/if}
  </div>
  {#if group.open}
    <div class="sessions" transition:slide={{ duration: sessionSlideDuration }}>
      {#if group.loadStatus === "error"}
        <div class="session-empty session-load-error"><span>Could not load chats</span><button data-retry-project-sessions={group.id} onclick={click("data-retry-project-sessions")}>Retry</button></div>
      {/if}
      {#if group.restCount}
        {#each group.sessions as row (row.rowKey)}
          <SessionRow {ctx} {row} />
        {/each}
      {:else if group.loadStatus === "loading"}
        <div class="session-empty">Loading...</div>
      {:else if group.loadStatus !== "error"}
        <div class="session-empty">No chats</div>
      {/if}
      {#if group.restCount > 5}
        <button class="session-more" data-show-all={group.id} onclick={click("data-show-all")}>{group.showAll ? "Show less" : "Show more"}</button>
      {/if}
    </div>
  {/if}
</div>
