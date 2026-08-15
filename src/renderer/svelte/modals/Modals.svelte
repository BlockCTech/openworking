<script>
  // Container for the top-level modals that render() used to inline (renderForceUpdate through
  // renderMcpDeleteModal). Each child derives its own visibility from bridged state, so this
  // component just lists them in the same order as the legacy render() block. Onboarding stays
  // on the legacy path (its island lives in src/renderer/onboarding.js).
  import ForceUpdateModal from "./ForceUpdateModal.svelte"
  import SkillUploadModal from "./SkillUploadModal.svelte"
  import DeleteSessionModal from "./DeleteSessionModal.svelte"
  import RenameSessionModal from "./RenameSessionModal.svelte"
  import ProjectDeleteModal from "./ProjectDeleteModal.svelte"
  import ProjectRenameModal from "./ProjectRenameModal.svelte"
  import McpModal from "./McpModal.svelte"
  import McpDeleteModal from "./McpDeleteModal.svelte"
  import PermissionsModal from "./PermissionsModal.svelte"
  import BrowserSetupModal from "./BrowserSetupModal.svelte"
  import SkillPreviewModal from "./SkillPreviewModal.svelte"
  import SessionRevertModal from "./SessionRevertModal.svelte"
  import TerminalOpenConfirmModal from "./TerminalOpenConfirmModal.svelte"

  let { ctx, tick } = $props()
</script>

<ForceUpdateModal {ctx} {tick} />
<SkillUploadModal {ctx} {tick} />
<DeleteSessionModal {ctx} {tick} />
<RenameSessionModal {ctx} {tick} />
<ProjectDeleteModal {ctx} {tick} />
<ProjectRenameModal {ctx} {tick} />
<McpModal {ctx} {tick} />
<McpDeleteModal {ctx} {tick} />
<PermissionsModal {ctx} {tick} />
<BrowserSetupModal {ctx} {tick} />
<SkillPreviewModal {ctx} {tick} />
<SessionRevertModal {ctx} {tick} />
<TerminalOpenConfirmModal {ctx} {tick} />
