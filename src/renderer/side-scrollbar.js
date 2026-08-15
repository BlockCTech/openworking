// Custom overlay scrollbar for the left sidebar (.side-scroll).
//
// Why not the native bar: a native thumb's length is always viewport ÷ content, so a long session
// list produces a long thumb and there is no CSS to shorten it. Hiding the native bar and drawing
// our own <div> lets us cap the thumb at THUMB_MAX regardless of how much content there is.
//
// .side-scroll stays a real overflow scroller, so wheel, trackpad momentum, keyboard paging and
// the existing captureSidebarScroll/restoreSidebarScroll in renderer.js all keep working untouched
// — this module only mirrors scroll state onto a decorative thumb and writes scrollTop back when
// the user drags it.
(function exposeSideScrollbar(root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  if (root) root.OpenWorkingSideScrollbar = api
})(typeof window === "object" ? window : globalThis, function createSideScrollbar() {
  // Thumb length stays proportional to content (viewport ÷ content), like a native bar, so a
  // longer session list reads as a shorter thumb. Only a floor is applied: past a few thousand
  // pixels of content the proportional length collapses to a sliver that is hard to grab.
  const THUMB_MIN = 28
  // How long the bar stays visible after the last scroll event before fading out again.
  const FADE_MS = 900

  // Wheel damping. Deltas at or above WHEEL_NOTCH_PX are treated as discrete wheel notches and
  // scaled by WHEEL_DAMPING; smaller deltas are trackpad gestures and are left alone so macOS
  // momentum keeps working. WHEEL_LINE_PX converts DOM_DELTA_LINE events to pixels first.
  const WHEEL_DAMPING = 0.45
  const WHEEL_NOTCH_PX = 40
  const WHEEL_LINE_PX = 16

  // Marks the elements we've already wired so bindEvents() can call sync() on every render
  // without stacking duplicate listeners.
  const WIRED = "__owSideScrollbarWired"

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  // Reads geometry and paints the thumb. Safe to call at any time; a no-op when the sidebar
  // isn't mounted (settings screens, collapsed sidebar, tests running headless).
  function sync(doc) {
    const scroller = (doc || document).querySelector(".side-scroll")
    if (!scroller) return
    const bar = scroller.parentElement?.querySelector(".side-scrollbar")
    const thumb = bar?.querySelector(".side-scrollbar-thumb")
    if (!bar || !thumb) return

    const { scrollHeight, clientHeight, scrollTop } = scroller
    const scrollable = scrollHeight - clientHeight

    // Nothing to scroll — hide the bar entirely rather than showing a full-height thumb.
    if (scrollable <= 1) {
      bar.classList.add("empty")
      return
    }
    bar.classList.remove("empty")

    const track = bar.clientHeight
    const proportional = track * (clientHeight / scrollHeight)
    const thumbLen = clamp(Math.round(proportional), Math.min(THUMB_MIN, track), track)
    const top = Math.round((scrollTop / scrollable) * (track - thumbLen))

    thumb.style.height = `${thumbLen}px`
    thumb.style.transform = `translateY(${clamp(top, 0, track - thumbLen)}px)`
  }

  // Converts a pointer position within the track into a scrollTop and applies it.
  function scrollToPointer(scroller, bar, thumbLen, pointerY, grabOffset) {
    const rect = bar.getBoundingClientRect()
    const track = bar.clientHeight
    const scrollable = scroller.scrollHeight - scroller.clientHeight
    const range = track - thumbLen
    if (range <= 0) return
    const offset = clamp(pointerY - rect.top - grabOffset, 0, range)
    scroller.scrollTop = (offset / range) * scrollable
  }

  // Wires listeners once per mounted sidebar. Idempotent: renderer.js calls this after every
  // render, and re-entry on an already-wired scroller just re-syncs geometry.
  function attach(doc) {
    const target = doc || document
    const scroller = target.querySelector(".side-scroll")
    if (!scroller) return
    const bar = scroller.parentElement?.querySelector(".side-scrollbar")
    const thumb = bar?.querySelector(".side-scrollbar-thumb")
    if (!bar || !thumb) return

    if (scroller[WIRED]) {
      sync(target)
      return
    }
    scroller[WIRED] = true

    let fadeTimer = null
    const flash = () => {
      bar.classList.add("visible")
      if (fadeTimer) clearTimeout(fadeTimer)
      fadeTimer = setTimeout(() => bar.classList.remove("visible"), FADE_MS)
    }

    scroller.addEventListener("scroll", () => {
      sync(target)
      flash()
    }, { passive: true })

    // Damp the mouse wheel, which moves far too much per notch in the sidebar's short rows.
    //
    // Only discrete wheel hardware is touched. A macOS trackpad reports many small pixel deltas
    // (and the OS drives momentum), so scaling those would fight the inertia and feel broken —
    // those events fall through untouched. A real wheel notch is a large single delta, and
    // DOM_DELTA_LINE means the browser is reporting lines rather than pixels.
    scroller.addEventListener("wheel", (event) => {
      if (event.ctrlKey) return // pinch-zoom gesture, not a scroll
      const isLineMode = event.deltaMode === 1
      const isWheelNotch = isLineMode || Math.abs(event.deltaY) >= WHEEL_NOTCH_PX
      if (!isWheelNotch || event.deltaY === 0) return

      const raw = isLineMode ? event.deltaY * WHEEL_LINE_PX : event.deltaY
      event.preventDefault()
      scroller.scrollTop += raw * WHEEL_DAMPING
    }, { passive: false })

    // Content height changes as projects expand/collapse and sessions stream in; observing the
    // scroller keeps the thumb correct without hooking every render path.
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => sync(target))
      observer.observe(scroller)
      if (scroller.firstElementChild) observer.observe(scroller.firstElementChild)
    }

    // Drag the thumb. Mirrors startRightFileSidebarResize: listeners go on window so the drag
    // survives the pointer leaving the 8px bar, and are removed on mouseup.
    thumb.addEventListener("mousedown", (event) => {
      event.preventDefault()
      event.stopPropagation()
      const thumbRect = thumb.getBoundingClientRect()
      const grabOffset = event.clientY - thumbRect.top
      const thumbLen = thumbRect.height
      bar.classList.add("visible", "dragging")

      const onMove = (moveEvent) => {
        scrollToPointer(scroller, bar, thumbLen, moveEvent.clientY, grabOffset)
        sync(target)
      }
      const onUp = () => {
        bar.classList.remove("dragging")
        window.removeEventListener("mousemove", onMove)
        window.removeEventListener("mouseup", onUp)
      }
      window.addEventListener("mousemove", onMove)
      window.addEventListener("mouseup", onUp)
    })

    // Click anywhere on the track (outside the thumb) jumps there, centring the thumb.
    bar.addEventListener("mousedown", (event) => {
      if (event.target === thumb) return
      const thumbLen = thumb.getBoundingClientRect().height
      scrollToPointer(scroller, bar, thumbLen, event.clientY, thumbLen / 2)
      sync(target)
    })

    sync(target)
  }

  return { attach, sync, THUMB_MIN, WHEEL_DAMPING }
})
