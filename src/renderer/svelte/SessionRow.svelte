<script>
  // renderer.js's outside-click handler closes the menu via closest(".session-row-wrap"),
  // so the wrapper class must stay intact. Events dispatch via ctx.actions.
  let { ctx, row } = $props()

  const click = (attr) => (e) => ctx.actions.click(attr, e)
</script>

<div class="session-row-wrap {row.active ? 'active' : ''}" data-session-row={row.id} data-session-row-key={row.rowKey}>
  <button class="session-row" data-session-id={row.id} data-project-id={row.projectId} onclick={click("data-session-id")}>
    <span class="session-busy-dot {row.busy ? 'on' : ''}" title="Running"></span>
    <span class="stitle">{row.title}</span>
    <span class="stime">{row.time}</span>
  </button>
  <button class="session-kebab" data-session-menu={row.id} data-session-project={row.projectId} title="Options" onclick={click("data-session-menu")}>{@html ctx.icon("dots")}</button>
  {#if row.menuOpen}
    <div class="pop session-pop">
      <button class="pop-item" data-session-pin={row.id} data-pinned={row.pinned ? "1" : "0"} data-pin-project={row.projectId} data-pin-title={row.title} data-pin-updated={row.updatedAt} onclick={click("data-session-pin")}>
        {@html ctx.icon("pin")}<span>{row.pinned ? "Unpin chat" : "Pin chat"}</span>
      </button>
      <button class="pop-item" data-session-rename={row.id} data-session-project={row.projectId} data-session-title={row.rawTitle} data-session-label={row.title} onclick={click("data-session-rename")}>
        {@html ctx.icon("edit")}<span>Rename</span>
      </button>
      <button class="pop-item" data-session-export={row.id} data-session-project={row.projectId} onclick={click("data-session-export")}>
        {@html ctx.icon("save")}<span>Export JSON</span>
      </button>
      <button class="pop-item danger" data-session-delete={row.id} data-session-project={row.projectId} data-session-title={row.title} onclick={click("data-session-delete")}>
        {@html ctx.icon("trash")}<span>Delete</span>
      </button>
    </div>
  {/if}
</div>
