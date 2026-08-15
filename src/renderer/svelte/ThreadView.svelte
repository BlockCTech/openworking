<script>
  // Markup still comes from the legacy renderers via ctx.threadRowSegments(), but keyed each-blocks
  // let a streaming repaint replace only the segments whose html changed — untouched messages keep
  // their DOM (scroll anchors, rendered mermaid, selection). Events go through index.js delegation.
  import SubagentRunTree from "./SubagentRunTree.svelte"

  let { ctx, tick } = $props()

  let segments = $derived.by(() => {
    void $tick
    return ctx.threadRowSegments().map(([key, html]) => ({ key, html }))
  })

  let runTree = $derived.by(() => {
    void $tick
    return ctx.subagentRunTree()
  })
</script>

{#each segments as segment (segment.key)}
  {@html segment.html}
{/each}

<SubagentRunTree tree={runTree} />
