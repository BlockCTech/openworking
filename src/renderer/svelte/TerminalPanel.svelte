<script>
  // Bottom terminal dock (see renderTerminalDock in renderer.js). A single remembered terminal per
  // app session (see the goal's out-of-scope note — no multi-terminal management here). The
  // confirm-before-open step lives in TerminalOpenConfirmModal (part of the Modals island), not
  // inline here. The head row always renders (title, and status/actions once a terminal is open)
  // so the dock reads as a stable panel across the no-project / empty / connected states, instead
  // of only gaining chrome once connected.
  import TerminalSurface from "./TerminalSurface.svelte"

  let { ctx, tick } = $props()
  const click = (attr) => (e) => ctx.actions.click(attr, e)

  const STATUS_LABEL = {
    creating: "Opening…",
    connecting: "Connecting…",
    connected: "Connected",
    lost: "Connection lost",
    exited: "Shell exited"
  }

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    return {
      project: ctx.selectedProject(),
      open: ctx.terminalBelongsToActiveProject(),
      status: state.terminalStatus,
      error: state.terminalError || ""
    }
  })
</script>

<div class="terminal-panel">
  <div class="terminal-toolbar">
    <span class="terminal-dock-title">Terminal</span>
    {#if d.open}
      <span class="terminal-status-badge {d.status}"><span class="dt"></span>{STATUS_LABEL[d.status] || d.status}</span>
    {/if}
    <div class="terminal-toolbar-grow"></div>
    {#if d.open && d.status === "lost"}
      <button class="terminal-toolbar-btn" data-action="reconnectTerminal" title="Reconnect" aria-label="Reconnect" onclick={click("data-action")}>{@html ctx.icon("arrowUp")}</button>
    {/if}
    {#if d.open}
      <button class="terminal-toolbar-btn" data-action="closeTerminal" title="Close terminal" aria-label="Close terminal" onclick={click("data-action")}>{@html ctx.icon("trash")}</button>
    {/if}
  </div>
  <div class="terminal-body">
    {#if !d.project}
      <div class="terminal-empty"><p>Open a project to use its terminal.</p></div>
    {:else if !d.open}
      <div class="terminal-empty">
        <div class="terminal-empty-icon">{@html ctx.icon("terminal")}</div>
        <p>No terminal open for this project.</p>
        {#if d.error}<div class="config-note field-error">{d.error}</div>{/if}
        <button class="primary-btn" data-action="openTerminalConfirm" disabled={d.status === "creating"} onclick={click("data-action")}>{@html ctx.icon("plus")}<span>{d.status === "creating" ? "Opening…" : "Open Terminal"}</span></button>
      </div>
    {:else}
      <TerminalSurface {ctx} />
    {/if}
  </div>
</div>
