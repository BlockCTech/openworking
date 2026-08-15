<script>
  // 1:1 translation of the removable branch of renderer.js renderAttachmentChips(). The
  // non-removable branch (message-history bubbles) stays on the legacy renderAttachmentChips()
  // string renderer — this component only replaces the composer's pending-attachment row.
  let { ctx, tick } = $props()

  let attachments = $derived.by(() => {
    void $tick
    return ctx.state.pendingAttachments
  })
</script>

{#if attachments.length}
  <div class="composer-attachments">
    {#each attachments as attachment (attachment.id)}
      {@const label = attachment.filename || attachment.description || "Attachment"}
      <span class="attachment-chip" title={attachment.description || attachment.mime || label}>
        {@html ctx.icon("doc")}<span>{label}</span>
        <button type="button" data-remove-attachment={attachment.id} onclick={() => ctx.removeAttachment(attachment.id)} title={`Remove ${label}`}>{@html ctx.icon("x")}</button>
      </span>
    {/each}
  </div>
{/if}
