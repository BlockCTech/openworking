// Svelte render islands, bundled by scripts/build-renderer.js into
// src/renderer/dist/svelte-islands.js and loaded by index.html before renderer.js.
// renderer.js owns state/helpers and passes them in via init(deps); persistent hosts stay
// mounted and repaint by bumping a tick store (state-bridge.svelte.js fields update without one).
import { mount, unmount, flushSync } from "svelte"
import { writable } from "svelte/store"
import Sidebar from "./Sidebar.svelte"
import SkillsPanelRouter from "./SkillsPanelRouter.svelte"
import Modals from "./modals/Modals.svelte"
import DocumentViewer from "./DocumentViewer.svelte"
import RightFileSidebar from "./RightFileSidebar.svelte"
import ThreadView from "./ThreadView.svelte"
import AppShell from "./AppShell.svelte"
import MainView from "./MainView.svelte"
import PromptEditor from "./PromptEditor.svelte"
import PromptAssistMenu from "./PromptAssistMenu.svelte"
import AttachmentChips from "./AttachmentChips.svelte"
import TerminalPanel from "./TerminalPanel.svelte"

export { bindStateBridge } from "./state-bridge.svelte.js"

// Standard mount island: one component, one host, mount-or-tick semantics. `delegate: true`
// also wires the host into the legacy delegated handler tables for islands whose inner markup
// still comes from string renderers.
function createMountIsland(Component, { hostId, diagnostic, delegate = false, persistent = false }) {
  const ctx = {}
  const tick = writable(0)
  let instance = null
  let mountedHost = null
  let container = null

  function attachHostDelegation(host) {
    host.setAttribute("data-svelte-island", "")
    host.addEventListener("click", (event) => ctx.actions?.delegate(event, "click", host))
    host.addEventListener("input", (event) => ctx.actions?.delegate(event, "input", host))
    host.addEventListener("mousedown", (event) => ctx.actions?.delegate(event, "mousedown", host))
  }

  function paintInto(host = document.getElementById(hostId)) {
    if (!host) return false
    ctx.renderDiagnostics?.mark?.(diagnostic)
    // `persistent` is for components holding live state that cannot be rebuilt from `state` — an
    // xterm.js buffer, whose scrollback the runtime never replays. Their host comes from a legacy
    // {@html} renderer and is a BRAND-NEW element on every repaint, so the mount-or-tick path below
    // would tear the component down on every unrelated render (opening the Files sidebar, a
    // streaming message) and silently destroy that state. Mount once into a container this island
    // owns, then re-parent the container: moving a DOM subtree preserves it, replacing one does not.
    if (persistent) {
      if (!container) {
        container = document.createElement("div")
        container.style.display = "contents"   // transparent to the host's own flex/grid layout
        instance = mount(Component, { target: container, props: { ctx, tick } })
      }
      if (container.parentNode !== host) {
        host.innerHTML = ""
        host.appendChild(container)
      }
      tick.update((n) => n + 1)
      flushSync()
      return true
    }
    if (host !== mountedHost || !instance) {
      if (instance) { try { unmount(instance) } catch {} }
      host.innerHTML = ""
      if (delegate) attachHostDelegation(host)
      instance = mount(Component, { target: host, props: { ctx, tick } })
      mountedHost = host
    } else {
      tick.update((n) => n + 1)
    }
    flushSync()
    return true
  }

  function schedulePaint() {
    if (schedulePaint.frame) return
    schedulePaint.frame = requestAnimationFrame(() => {
      schedulePaint.frame = null
      paintInto()
    })
  }

  return {
    init(deps) { Object.assign(ctx, deps || {}) },
    paintInto,
    schedulePaint
  }
}

export const sidebarIsland = createMountIsland(Sidebar, { hostId: "sidebarRoot", diagnostic: "sidebar" })
export const modalsIsland = createMountIsland(Modals, { hostId: "modalsRoot", diagnostic: "modals" })
export const documentViewerIsland = createMountIsland(DocumentViewer, { hostId: "documentViewerRoot", diagnostic: "document" })
export const rightFileSidebarIsland = createMountIsland(RightFileSidebar, { hostId: "rightFileSidebarRoot", diagnostic: "rightFiles" })
// Main screen area: legacy renderMain() markup via {@html}, events via host delegation.
export const mainIsland = createMountIsland(MainView, { hostId: "mainRoot", diagnostic: "main", delegate: true })
// PromptEditor owns its own DOM listeners on the contenteditable node, so no `delegate: true`.
// #promptEditorRoot is a fresh host inside MainView's {@html} composer markup every repaint, so
// it must paint right after mainIsland in the same render() pass.
export const promptEditorIsland = createMountIsland(PromptEditor, { hostId: "promptEditorRoot", diagnostic: "promptEditor" })
// paintPromptAssistMenu() calls paintInto() directly on ArrowUp/ArrowDown, bypassing render();
// since the host node is stable across those calls, the instance ticks instead of remounting,
// which stops the popup from flickering on every key press.
export const promptAssistMenuIsland = createMountIsland(PromptAssistMenu, { hostId: "promptAssistMenuRoot", diagnostic: "promptAssistMenu" })
export const attachmentChipsIsland = createMountIsland(AttachmentChips, { hostId: "attachmentChipsRoot", diagnostic: "attachmentChips" })
// #terminalDockRoot is a fresh host inside MainView's {@html} markup, present only while
// state.terminalPanelOpen is true (see renderTerminalDock in renderer.js), so like
// promptEditorIsland it paints right after mainIsland. Unlike promptEditorIsland it must be
// `persistent`: PromptEditor can be rebuilt from state.promptDraft, but a remounted TerminalPanel
// disposes its xterm and the scrollback is unrecoverable.
export const terminalDockIsland = createMountIsland(TerminalPanel, { hostId: "terminalDockRoot", diagnostic: "terminalDock", persistent: true })

// App shell: owns all of #root, mounted once per launch so sub-island hosts survive render()
// calls. Delegation attaches to the shell's own rendered root for banner/recovery/onboarding
// buttons; nested islands own their events via islandActions.delegate's nearest-island guard.
export const appShellIsland = (() => {
  const ctx = {}
  const tick = writable(0)
  let instance = null
  let mountedHost = null
  let delegatedRoots = new WeakSet()

  function attachShellDelegation(host) {
    for (const element of host.children) {
      if (delegatedRoots.has(element)) continue
      element.setAttribute("data-svelte-island", "")
      element.addEventListener("click", (event) => ctx.actions?.delegate(event, "click", element))
      element.addEventListener("input", (event) => ctx.actions?.delegate(event, "input", element))
      element.addEventListener("mousedown", (event) => ctx.actions?.delegate(event, "mousedown", element))
      delegatedRoots.add(element)
    }
  }

  function paintInto(host = document.getElementById("root")) {
    if (!host) return false
    ctx.renderDiagnostics?.mark?.("shell")
    if (host !== mountedHost || !instance) {
      if (instance) { try { unmount(instance) } catch {} }
      host.innerHTML = ""
      instance = mount(AppShell, { target: host, props: { ctx, tick } })
      mountedHost = host
    } else {
      tick.update((n) => n + 1)
    }
    flushSync()
    // Re-attach delegation every flush: the rendered root element changes on blocked/normal flip.
    attachShellDelegation(host)
    return true
  }

  return {
    init(deps) { Object.assign(ctx, deps || {}) },
    paintInto
  }
})()

// Thread island: same paintThreadInto contract as the other islands here. Its markup
// comes from legacy string renderers, so it delegates all host events through the original
// handler tables; the #root dispatcher skips this subtree via data-svelte-island.
export const screenSessionIsland = (() => {
  const ctx = {}
  const tick = writable(0)
  let instance = null
  let mountedHost = null

  function attachHostDelegation(host) {
    host.setAttribute("data-svelte-island", "")
    host.addEventListener("click", (event) => ctx.actions?.delegate(event, "click", host))
    host.addEventListener("input", (event) => ctx.actions?.delegate(event, "input", host))
    host.addEventListener("mousedown", (event) => ctx.actions?.delegate(event, "mousedown", host))
  }

  function paintThreadInto(inner = document.querySelector(".thread-inner"), { threadScroll = "preserve" } = {}) {
    if (!inner) return false
    ctx.renderDiagnostics?.mark?.("thread")
    const previousThreadScroll = ctx.captureThreadScroll?.()
    if (inner !== mountedHost || !instance) {
      if (instance) { try { unmount(instance) } catch {} }
      inner.innerHTML = ""
      attachHostDelegation(inner)
      instance = mount(ThreadView, { target: inner, props: { ctx, tick } })
      mountedHost = inner
    } else {
      tick.update((n) => n + 1)
    }
    flushSync() // sync DOM before mermaid scheduling and scroll restore below
    ctx.scheduleMermaidRender?.(inner)
    ctx.restoreThreadScroll?.(previousThreadScroll, threadScroll)
    return true
  }

  function scheduleThreadPaint() {
    if (scheduleThreadPaint.frame) return
    let ranSynchronously = false
    const frame = requestAnimationFrame(() => {
      ranSynchronously = true
      scheduleThreadPaint.frame = null
      paintThreadInto()
    })
    // The renderer test harness uses a synchronous RAF. Do not overwrite the callback's null
    // with its return value, or one scheduled input-state paint blocks every later thread paint.
    if (!ranSynchronously) scheduleThreadPaint.frame = frame
  }

  return {
    init(deps) { Object.assign(ctx, deps || {}) },
    paintThreadInto,
    scheduleThreadPaint
  }
})()

export const screenSkillsIsland = (() => {
  const ctx = {}
  const tick = writable(0)
  let instance = null
  let mountedHost = null

  function paintPanelInto(host = document.querySelector("[data-skills-panel-host]")) {
    if (!host || ctx.state?.nav !== "skills") return false
    ctx.renderDiagnostics?.mark?.("skillsPanel")
    if (host !== mountedHost || !instance) {
      if (instance) { try { unmount(instance) } catch {} }
      host.innerHTML = ""
      instance = mount(SkillsPanelRouter, { target: host, props: { ctx, tick } })
      mountedHost = host
    } else {
      tick.update((n) => n + 1)
    }
    return true
  }

  return {
    init(deps) { Object.assign(ctx, deps || {}) },
    paintPanelInto
  }
})()
