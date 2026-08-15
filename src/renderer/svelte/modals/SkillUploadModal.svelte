<script>
  // 1:1 translation of renderer.js renderSkillUploadModal(). Dropzone drag/drop stays on the
  // legacy #root listeners (they match [data-skill-drop] and are not island-guarded).
  let { ctx, tick } = $props()

  const click = (attr) => (e) => ctx.actions.click(attr, e)

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    if (!state.skillUploadOpen) return null
    return { uploading: Boolean(state.skillUploading), error: state.skillUploadError || "" }
  })
</script>

{#if d}
  <div class="update-backdrop" data-svelte-island>
    <div class="skill-upload-modal" role="dialog" aria-modal="true" aria-labelledby="skillUploadTitle">
      <div class="skill-upload-head">
        <h1 id="skillUploadTitle">Upload skill</h1>
        <button class="small-icon-btn" data-action="closeSkillUpload" aria-label="Close upload dialog" onclick={click("data-action")}>{@html ctx.icon("x")}</button>
      </div>
      <button class="skill-dropzone {d.uploading ? 'disabled' : ''}" data-action="chooseSkillArchive" data-skill-drop onclick={click("data-action")}>
        {@html ctx.icon("folderPlus")}
        <span>{d.uploading ? "Installing skill..." : "Drag and drop or click to upload"}</span>
      </button>
      {#if d.error}<div class="alert">{d.error}</div>{/if}
      <div class="skill-requirements">
        <strong>File requirements</strong>
        <ul>
          <li><code>SKILL.md</code> must contain skill name and description in YAML frontmatter.</li>
          <li><code>.zip</code> or <code>.skill</code> must include a <code>SKILL.md</code> file.</li>
        </ul>
      </div>
    </div>
  </div>
{/if}
