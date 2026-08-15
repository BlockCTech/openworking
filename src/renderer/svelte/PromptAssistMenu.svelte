<script>
  // 1:1 translation of renderer.js renderCommandMenu()/renderFileMentionMenu(). Rows are keyed
  // so Svelte reuses existing DOM nodes across ticks instead of flickering on arrow-key repaints.
  let { ctx, tick } = $props()

  let containerEl = $state(null)
  // Last pointer position we treated as a genuine move, to filter out synthetic mouse events
  // that scrollIntoView (below) can trigger by shifting rows under a stationary cursor.
  let lastPointer = null

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    const keyboardActive = Boolean(state.promptAssistKeyboardActive)
    if (state.commandMenu.open) {
      const candidates = ctx.commandCandidates(state.commandMenu.query)
      return {
        kind: "command",
        keyboardActive,
        label: "Commands",
        index: state.commandMenu.index,
        empty: "No matching commands.",
        rows: candidates.map((command) => ({
          key: command.name,
          primary: `/${command.name}`,
          secondary: command.description || "",
          source: command.source,
          select: () => ctx.selectCommand(command.name)
        }))
      }
    }
    if (state.fileMentionMenu.open) {
      if (state.fileMentionMenu.loading) return { kind: "file", keyboardActive, label: "Project files", index: -1, empty: "Loading files…", rows: [] }
      if (state.fileMentionMenu.error) return { kind: "file", keyboardActive, label: "Project files", index: -1, empty: state.fileMentionMenu.error, rows: [] }
      const candidates = ctx.fileMentionCandidates(state.fileMentionMenu.query)
      return {
        kind: "file",
        keyboardActive,
        label: "Project files",
        index: state.fileMentionMenu.index,
        empty: "No matching files.",
        rows: candidates.map((filePath) => ({
          key: filePath,
          primary: `@${ctx.filename(filePath)}`,
          secondary: filePath,
          source: "file",
          select: () => ctx.selectFileMention(filePath).catch((error) => ctx.showToast(error.message))
        }))
      }
    }
    return null
  })

  // Keeps the highlighted row visible as ArrowUp/ArrowDown moves the selection past the
  // scrollable menu's edges.
  $effect(() => {
    if (!d) return
    void d.index
    containerEl?.querySelector(".pop-item.active")?.scrollIntoView({ block: "nearest" })
  })

  // The mouse only reclaims `index` once it genuinely moves, so it can't fight keyboard
  // navigation (state.promptAssistKeyboardActive, set by PromptEditor.svelte's arrow keys).
  function handlePointerMove(event, index) {
    if (lastPointer && lastPointer.x === event.clientX && lastPointer.y === event.clientY) return
    lastPointer = { x: event.clientX, y: event.clientY }
    if (!d) return
    if (d.kind === "command") ctx.state.commandMenu.index = index
    else if (d.kind === "file") ctx.state.fileMentionMenu.index = index
    ctx.state.promptAssistKeyboardActive = false
    ctx.paintPromptAssistMenu()
  }
</script>

{#if d}
  <div class="pop pop-up prompt-pop cmd-pop" class:keyboard-nav={d.keyboardActive} bind:this={containerEl}>
    <div class="pop-label">{d.label}</div>
    {#if d.rows.length}
      {#each d.rows as row, index (row.key)}
        <button
          type="button"
          class="pop-item cmd-item"
          class:active={index === d.index}
          onpointermove={(event) => handlePointerMove(event, index)}
          onmousedown={(event) => {
            event.preventDefault()
            row.select()
          }}
        >
          <span><strong>{row.primary}</strong><small>{row.secondary}</small></span>
          <span class="cmd-source">{row.source}</span>
        </button>
      {/each}
    {:else}
      <div class="pop-empty">{d.empty}</div>
    {/if}
  </div>
{/if}
