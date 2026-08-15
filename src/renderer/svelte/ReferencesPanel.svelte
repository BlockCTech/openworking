<script>
  // referenceDraft is intentionally NOT state-bridged (submitted over IPC, mirrors mcpDraft) — the
  // data-reference-field input handler mutates it directly without a repaint, so typing keeps the
  // caret in place; the form's inputs are effectively uncontrolled after their initial paint.
  let { ctx, tick } = $props()
  const click = (attr) => (event) => ctx.actions.click(attr, event)
  const input = (attr) => (event) => ctx.actions.input(attr, event)

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    return {
      loading: state.referencesLoading,
      references: state.references || [],
      error: state.referencesError || "",
      formOpen: state.referenceFormOpen,
      draft: state.referenceDraft || { kind: "path", name: "", path: "", repository: "", branch: "", description: "" },
      saving: state.referenceSaving,
      removing: state.referenceRemoving
    }
  })
</script>

<section class="tabpanel" data-panel="references" data-svelte-island>
  <div class="pnl-head">
    <div><h1>References</h1><p>Local folders or git repositories the agent can consult for extra context in this project.</p></div>
    <div class="grow"></div>
    {#if !d.formOpen}
      <button class="btn-up" data-action="openReferenceForm" onclick={click("data-action")}>{@html ctx.icon("plus")}<span>Add reference</span></button>
    {/if}
  </div>

  {#if d.formOpen}
    <div class="card ref-form">
      <label for="refName">Name
        <input id="refName" type="text" value={d.draft.name} placeholder="design-docs" data-reference-field="name" disabled={d.saving} oninput={input("data-reference-field")}>
      </label>
      <div class="mcp-field-label">Source</div>
      <div class="mcp-type-toggle">
        <button class="mcp-type-opt {d.draft.kind === 'path' ? 'active' : ''}" data-reference-kind="path" disabled={d.saving} onclick={click("data-reference-kind")}>Local path</button>
        <button class="mcp-type-opt {d.draft.kind === 'git' ? 'active' : ''}" data-reference-kind="git" disabled={d.saving} onclick={click("data-reference-kind")}>Git repository</button>
      </div>
      {#if d.draft.kind === "git"}
        <label for="refRepository">Repository URL
          <input id="refRepository" type="text" value={d.draft.repository} placeholder="https://github.com/org/repo" data-reference-field="repository" disabled={d.saving} oninput={input("data-reference-field")}>
        </label>
        <label for="refBranch">Branch (optional)
          <input id="refBranch" type="text" value={d.draft.branch} placeholder="main" data-reference-field="branch" disabled={d.saving} oninput={input("data-reference-field")}>
        </label>
      {:else}
        <label for="refPath">Path (relative to the project, or absolute)
          <input id="refPath" type="text" value={d.draft.path} placeholder="docs/architecture" data-reference-field="path" disabled={d.saving} oninput={input("data-reference-field")}>
        </label>
      {/if}
      <label for="refDescription">Description (optional)
        <input id="refDescription" type="text" value={d.draft.description} placeholder="What the agent should know this is for" data-reference-field="description" disabled={d.saving} oninput={input("data-reference-field")}>
      </label>
      <div class="field-error">{d.error}</div>
      <div class="confirm-actions">
        <button class="secondary-btn{d.saving ? ' disabled' : ''}" data-action="closeReferenceForm" onclick={click("data-action")}>Cancel</button>
        <button class="primary-btn{d.saving ? ' disabled' : ''}" data-action="addReference" onclick={click("data-action")}>{@html ctx.icon("plus")}{d.saving ? "Adding…" : "Add reference"}</button>
      </div>
    </div>
  {/if}

  {#if d.loading}
    <div class="config-note">Loading references…</div>
  {:else if d.references.length}
    <div class="card">
      {#each d.references as reference (reference.name)}
        <div class="row">
          <span class="row-ic">{@html ctx.icon(reference.repository ? "branch" : "folder")}</span>
          <span class="row-main">
            <span class="row-name">
              <span class="nm">{reference.name}</span>
              {#if reference.available === false}<span class="tag ref-broken">Missing</span>{/if}
            </span>
            <span class="row-desc">{reference.repository || reference.path}{reference.description ? ` — ${reference.description}` : ""}</span>
          </span>
          <span class="row-meta">
            <button class="icon-del" data-reference-remove={reference.name} aria-label={`Remove ${reference.name}`} title="Remove" disabled={d.removing === reference.name} onclick={click("data-reference-remove")}>{@html ctx.icon("trash")}</button>
          </span>
        </div>
      {/each}
    </div>
  {:else if !d.formOpen}
    <div class="config-note">No references yet. Add a local folder or git repository for the agent to consult.</div>
  {/if}
  {#if d.error && !d.formOpen}<div class="config-note field-error">{d.error}</div>{/if}
</section>
