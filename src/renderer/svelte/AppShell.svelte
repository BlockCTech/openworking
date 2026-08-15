<script>
  // Owns #root; mounted once so sub-island hosts below persist across render() calls (tick
  // only). Recovery/banner/onboarding markup still comes from legacy string renderers via
  // {@html}, served by this island's host delegation (see index.js).
  let { ctx, tick } = $props()

  let d = $derived.by(() => {
    void $tick
    const state = ctx.state
    if (state.profile?.status === "blocked") {
      return { blocked: true, recoveryHtml: ctx.renderProfileRecovery() }
    }
    return {
      blocked: false,
      bannerHtml: ctx.renderProfileRecoveryBanner(),
      onboardingHtml: ctx.renderOnboarding(),
      collapsed: Boolean(state.sidebarCollapsed),
      hasDoc: Boolean(state.document),
      rightOpen: Boolean(state.rightSidebarOpen),
      stackedRight: Boolean(state.stackedRightPanels),
      rightPreopen: Boolean(state.rightSidebarPreopen),
      rightClosing: Boolean(state.rightSidebarClosing),
      docPreopen: Boolean(state.documentPreopen),
      docClosing: Boolean(state.documentClosing),
      resizing: Boolean(state.panelResizing)
    }
  })
</script>

{#if d.blocked}
  {@html d.recoveryHtml}
{:else}
  <div class="desktop">
    {@html d.bannerHtml}
    <div class="window">
      <div class="app{d.collapsed ? ' collapsed' : ''}{d.hasDoc ? ' has-doc' : ''}{d.rightOpen ? ' right-open' : ''}{d.stackedRight ? ' stacked-right' : ''}{d.docPreopen ? ' document-preopen' : ''}{d.docClosing ? ' document-closing' : ''}{d.rightPreopen ? ' right-sidebar-preopen' : ''}{d.rightClosing ? ' right-sidebar-closing' : ''}{d.resizing ? ' resizing' : ''}">
        <div id="sidebarRoot" style="display:contents"></div>
        <div id="mainRoot" style="display:contents"></div>
        <div id="documentViewerRoot" style="display:contents"></div>
        <div id="rightFileSidebarRoot" style="display:contents"></div>
      </div>
    </div>
    <div id="modalsRoot" style="display:contents"></div>
    {@html d.onboardingHtml}
    <div id="toastHost"></div>
  </div>
{/if}
